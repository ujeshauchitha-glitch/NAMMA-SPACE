import { describe, expect, it } from 'vitest';

import {
  CAPTURE_CHANNEL_LABEL,
  PairingError,
  createPairingSyncBridge,
  parseSignalMessage,
  type DataChannelLike,
  type PeerConnectionLike,
  type RTCPeerConnectionFactory,
  type Scheduler,
  type SignallingSocket,
  type SocketFactory,
} from '../src/lib/pairing';
import {
  createPairingSession,
  type PairingSession,
  type PairingSessionEvent,
} from '../src/lib/pairing/session';
import { legalPairingPath, pairingSyncActions } from '../src/lib/pairing/rail-sync';
import { deriveRailStages } from '../src/components/scan/stage-rail';
import { workspaceReducer, initialWorkspaceState } from '../src/state/reducer';
import type { PairingState, PairingStatus, WorkspaceAction } from '../src/state/types';

/**
 * T21 journey suite — the Live Scan sender→receiver protocol path with
 * **zero real network, zero real WebRTC, zero real phone**.
 *
 * Two `createPairingSession` instances (host = QR side, joiner = `?pair=`
 * side) talk through an in-memory signalling hub and a mock WebRTC world
 * (two linked peer connections + one `capture` datachannel). Every failure
 * branch — corruption, silence, channel death, ICE failure, relay loss,
 * expiry — is driven by the mock world, and timers are a manual scheduler,
 * so the whole journey is deterministic.
 *
 * What this proves is the *protocol*, not device-to-device radio: real
 * two-device behaviour is the T24 e2e loopback's job and is not claimed
 * here.
 */

/** One macrotask — lets arbitrary promise-microtask chains fully drain. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* ------------------------------------------------------------------ *
 * manual scheduler — delays are data, drained by hand
 * ------------------------------------------------------------------ */

function createManualScheduler() {
  let seq = 0;
  const tasks = new Map<number, { cb: () => void; ms: number }>();
  const delays: number[] = [];

  const scheduler: Scheduler = {
    setTimeout(callback, ms) {
      const id = ++seq;
      tasks.set(id, { cb: callback, ms });
      return id;
    },
    clearTimeout(handle) {
      tasks.delete(handle as number);
    },
  };

  return {
    scheduler,
    delays,
    get pending(): number {
      return tasks.size;
    },
    async drain(): Promise<void> {
      while (tasks.size > 0) {
        const first = [...tasks.entries()][0];
        if (!first) break;
        const [id, task] = first;
        tasks.delete(id);
        delays.push(task.ms);
        task.cb();
        await settle();
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * in-memory signalling hub (rooms of exactly two, verbatim relay)
 * ------------------------------------------------------------------ */

function createMockHub() {
  const sockets: SignallingSocket[] = [];
  const rooms = new Map<string, Set<SignallingSocket>>();
  const joinLog: string[] = [];
  let accepting = true;
  let peerSeq = 0;

  const deliver = (socket: SignallingSocket, raw: string): void => {
    socket.onmessage?.({ data: raw });
  };

  const socketFactory: SocketFactory = () => {
    const socket: SignallingSocket = {
      readyState: 0,
      send(data) {
        if (socket.readyState !== 1) return;
        const message = parseSignalMessage(data);
        if (!message) return;
        if (message.type === 'join') {
          joinLog.push(message.session);
          let room = rooms.get(message.session);
          if (!room) {
            room = new Set();
            rooms.set(message.session, room);
          }
          room.add(socket);
          if (room.size === 2) {
            for (const member of room) {
              deliver(member, JSON.stringify({ type: 'peer-joined', peerId: `peer-${++peerSeq}` }));
            }
          }
          return;
        }
        if (message.type === 'leave') {
          for (const room of rooms.values()) room.delete(socket);
          return;
        }
        for (const room of rooms.values()) {
          if (!room.has(socket)) continue;
          for (const member of room) {
            if (member !== socket) deliver(member, data);
          }
        }
      },
      close() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        for (const room of rooms.values()) room.delete(socket);
        socket.onclose?.();
      },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    sockets.push(socket);
    if (accepting) {
      socket.readyState = 1;
      queueMicrotask(() => socket.onopen?.());
    } else {
      queueMicrotask(() => socket.close());
    }
    return socket;
  };

  return {
    socketFactory,
    joinLog,
    socketCount: (): number => sockets.length,
    setAccepting(value: boolean): void {
      accepting = value;
    },
    dropAll(): void {
      for (const socket of [...sockets]) socket.close();
    },
  };
}

/* ------------------------------------------------------------------ *
 * mock WebRTC world — linkable pairs with wire-level fault injection
 * ------------------------------------------------------------------ */

type MockChannel = DataChannelLike & { peer?: MockChannel; opened?: boolean };

type MockPc = PeerConnectionLike & {
  uid: number;
  local: { type: string; sdp: string } | null;
  remote: { type: string; sdp: string } | null;
  link: MockPc | null;
  ownChannel: MockChannel | null;
  addedCandidates: number;
};

type RtcOptions = {
  /**
   * Connection behaviour, as in the T18 protocol suite: `fail`/`fail-once`
   * fail at the connection attempt (real ICE timing), never at SDP time.
   */
  mode?: 'connect' | 'fail' | 'fail-once';
  /** Flip one byte of a payload: first delivery only / every delivery. */
  corrupt?: 'once' | 'all';
  /** Deliver payload bytes never (header arrives, bytes do not). */
  dropPayloads?: boolean;
  /** After N delivered payloads, kill both channels (mid-transfer death). */
  closeAfterPayloads?: number;
};

function createMockRtc(options: RtcOptions = {}) {
  const mode = options.mode ?? 'connect';
  let uid = 0;
  let payloadDelivered = 0;
  let corruptedOnce = false;
  const configs: { iceServers: { urls: string }[] }[] = [];
  const pcs: MockPc[] = [];
  const channels: MockChannel[] = [];
  const offers = new Map<string, MockPc>();
  const events: string[] = [];

  const closeChannels = (reason: string): void => {
    events.push(`channels-closed:${reason}`);
    for (const channel of channels) {
      if (channel.readyState === 'closed') continue;
      channel.readyState = 'closed';
      const current = channel;
      queueMicrotask(() => current.onclose?.());
    }
  };

  const makeChannel = (label: string): MockChannel => {
    const channel: MockChannel = {
      label,
      readyState: 'connecting',
      opened: false,
      send(data) {
        if (channel.readyState !== 'open') {
          // Real RTCDataChannel.send throws on a closed channel.
          throw new Error('InvalidStateError: send on a channel that is not open');
        }
        const peer = channel.peer;
        if (!peer) return;
        if (typeof data === 'string') {
          queueMicrotask(() => peer.onmessage?.({ data }));
          return;
        }
        if (options.dropPayloads === true) return;
        let bytes = new Uint8Array(data);
        const shouldCorrupt =
          (options.corrupt === 'all' && bytes.byteLength > 0) ||
          (options.corrupt === 'once' && !corruptedOnce && bytes.byteLength > 0);
        if (shouldCorrupt) {
          corruptedOnce = true;
          bytes = bytes.slice();
          bytes[0] = (bytes[0]! + 1) % 256;
          events.push('payload:corrupted');
          queueMicrotask(() => peer.onmessage?.({ data: bytes.slice().buffer }));
        } else {
          events.push('payload:delivered');
          queueMicrotask(() => peer.onmessage?.({ data }));
        }
        payloadDelivered += 1;
        if (options.closeAfterPayloads !== undefined && payloadDelivered >= options.closeAfterPayloads) {
          closeChannels('after-payload-limit');
        }
      },
      close() {
        channel.readyState = 'closed';
        channel.onclose?.();
      },
      onopen: null,
      onclose: null,
      onmessage: null,
    };
    channels.push(channel);
    return channel;
  };

  const establish = (a: MockPc, b: MockPc): void => {
    if (a.connectionState === 'connected') return;
    // Never establish across a dead link: a `failed`/`closed` side is a
    // real ICE failure, and pretending otherwise would fake a connection
    // the peers never had (ICE-failure tests depend on this).
    const dead = (pc: MockPc): boolean =>
      pc.connectionState === 'failed' || pc.connectionState === 'closed';
    if (dead(a) || dead(b)) return;
    const hostOnly =
      (configs[a.uid - 1]?.iceServers.length ?? 1) === 0 &&
      (configs[b.uid - 1]?.iceServers.length ?? 1) === 0;
    // `fail`/`fail-once` fail where a real ICE stack reports
    // connectivity-check failure — the connection attempt — with both peers
    // failing in the same lockstep. Failing at SDP time instead lets one
    // peer race ahead: its re-offer would be consumed by the other side's
    // pre-failure connection, orphaning the rebuilt connection with no
    // further offers and leaving the responder stuck in PAIRING forever.
    // The initiator's re-offer here is emitted only after its async
    // `createOffer` yields, so the responder always observes the failure
    // and rebuilds before the re-offer arrives — as on a real network,
    // where both peers detect ICE failure independently.
    if (mode === 'fail' || (mode === 'fail-once' && hostOnly)) {
      for (const pc of [a, b]) {
        pc.connectionState = 'failed';
        pc.onconnectionstatechange?.();
      }
      return;
    }
    const offerer = a.local?.type === 'offer' ? a : b;
    const responder = offerer === a ? b : a;
    for (const pc of [a, b]) {
      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();
    }
    const outbound = offerer.ownChannel ?? makeChannel(CAPTURE_CHANNEL_LABEL);
    offerer.ownChannel = outbound;
    const inbound = makeChannel(CAPTURE_CHANNEL_LABEL);
    outbound.peer = inbound;
    inbound.peer = outbound;
    outbound.readyState = 'open';
    inbound.readyState = 'open';
    outbound.opened = true;
    inbound.opened = true;
    outbound.onopen?.();
    inbound.onopen?.();
    responder.ownChannel = inbound;
    responder.ondatachannel?.({ channel: inbound });
    events.push('established');
  };

  const maybeEstablish = (pc: MockPc): void => {
    const other = pc.link;
    if (!other) return;
    if (pc.local && pc.remote && other.local && other.remote) establish(pc, other);
  };

  const factory: RTCPeerConnectionFactory = (config) => {
    configs.push(config);
    const pc: MockPc = {
      uid: ++uid,
      connectionState: 'new',
      local: null,
      remote: null,
      link: null,
      ownChannel: null,
      addedCandidates: 0,
      createDataChannel(label) {
        const channel = makeChannel(label);
        pc.ownChannel = channel;
        return channel;
      },
      async createOffer() {
        return { type: 'offer', sdp: `mock-offer:${pc.uid}` };
      },
      async createAnswer() {
        return { type: 'answer', sdp: `mock-answer:${pc.uid}` };
      },
      async setLocalDescription(description) {
        pc.local = description;
        if (description.type === 'offer') offers.set(description.sdp, pc);
        queueMicrotask(() => {
          pc.onicecandidate?.({
            candidate: { candidate: `mock-candidate:${pc.uid}`, sdpMid: '0', sdpMLineIndex: 0 },
          });
        });
        maybeEstablish(pc);
      },
      async setRemoteDescription(description) {
        pc.remote = description;
        if (description.type === 'offer') {
          const offerer = offers.get(description.sdp);
          if (offerer) {
            pc.link = offerer;
            offerer.link = pc;
          }
        }
        maybeEstablish(pc);
      },
      async addIceCandidate() {
        pc.addedCandidates += 1;
      },
      close() {
        pc.connectionState = 'closed';
        // Session teardown: both ends of the channel see the death, the way
        // a real peer close propagates across the wire.
        if (pc.ownChannel && pc.ownChannel.readyState !== 'closed') {
          pc.ownChannel.readyState = 'closed';
          const own = pc.ownChannel;
          queueMicrotask(() => own.onclose?.());
        }
        const otherChannel = pc.ownChannel?.peer;
        if (otherChannel && otherChannel.readyState !== 'closed') {
          otherChannel.readyState = 'closed';
          queueMicrotask(() => otherChannel.onclose?.());
        }
      },
      onicecandidate: null,
      ondatachannel: null,
      onconnectionstatechange: null,
    };
    pcs.push(pc);
    return pc;
  };

  return {
    factory,
    configs,
    pcs,
    channels,
    events,
    closeChannels,
  };
}

/* ------------------------------------------------------------------ *
 * session harness
 * ------------------------------------------------------------------ */

function track(session: PairingSession): { events: PairingSessionEvent[] } {
  const bag = { events: [] as PairingSessionEvent[] };
  session.on((event) => bag.events.push(event));
  return bag;
}

const statesOf = (events: PairingSessionEvent[]): PairingState[] =>
  events.flatMap((event) => (event.type === 'state' ? [event.state] : []));

const errorsOf = (events: PairingSessionEvent[]): PairingError[] =>
  events.flatMap((event) => (event.type === 'error' ? [event.error] : []));

const transferErrorsOf = (events: PairingSessionEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'transfer-error' ? [event.reason] : []));

const framesOf = (events: PairingSessionEvent[]) =>
  events.flatMap((event) => (event.type === 'frame' ? [event.frame] : []));

const START_NOW = 1_000_000;
const HUGE_TTL = 60 * 60 * 1000; // one hour — "no expiry in this test"

type Harness = {
  hub: ReturnType<typeof createMockHub>;
  world: ReturnType<typeof createMockRtc>;
  clock: ReturnType<typeof createManualScheduler>;
  host: PairingSession;
  joiner: PairingSession;
  hostEvents: PairingSessionEvent[];
  joinerEvents: PairingSessionEvent[];
  /** Advance the injected clock (session expiry tests). */
  setNow(value: number): void;
  connect(): Promise<void>;
};

/**
 * Two sessions on one token: host (QR side, WebRTC initiator) and joiner
 * (`?pair=` side, responder), both connected to the mock hub.
 */
function createHarness(
  rtc: RtcOptions = {},
  sessionOptions: { ttlMs?: number; ackTimeoutMs?: number; frameRetries?: number } = {},
): Harness {
  const hub = createMockHub();
  const world = createMockRtc(rtc);
  const clock = createManualScheduler();
  const token = 'NS-AAAA';
  let fakeNow = START_NOW;
  const now = (): number => fakeNow;

  const common = {
    session: token,
    socketFactory: hub.socketFactory,
    createPeerConnection: world.factory,
    scheduler: clock.scheduler,
    now,
    ttlMs: sessionOptions.ttlMs ?? HUGE_TTL,
    ackTimeoutMs: sessionOptions.ackTimeoutMs ?? 15_000,
    frameRetries: sessionOptions.frameRetries ?? 1,
  };

  const host = createPairingSession({ ...common, role: 'host' });
  const joiner = createPairingSession({ ...common, role: 'joiner' });
  const hostBag = track(host);
  const joinerBag = track(joiner);

  return {
    hub,
    world,
    clock,
    host,
    joiner,
    hostEvents: hostBag.events,
    joinerEvents: joinerBag.events,
    setNow(value: number): void {
      fakeNow = value;
    },
    async connect(): Promise<void> {
      host.start();
      await settle();
      joiner.start();
      await settle();
      await settle();
      await settle();
    },
  };
}

const frameBytes = (length: number): Uint8Array => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + 7) % 251;
  return out;
};

/* ================================================================== *
 * rail/store synchronisation (legal path only — reducer table rules)
 * ================================================================== */

describe('legalPairingPath — machine → store mirroring', () => {
  it('finds the legal hop list between every pair of states', () => {
    expect(legalPairingPath('IDLE', 'IDLE')).toEqual([]);
    expect(legalPairingPath('IDLE', 'PAIRING')).toEqual(['PAIRING']);
    expect(legalPairingPath('IDLE', 'LIVE')).toEqual(['PAIRING', 'LIVE']);
    expect(legalPairingPath('IDLE', 'STAGED')).toEqual(['PAIRING', 'LIVE', 'CAPTURING', 'STAGED']);
    expect(legalPairingPath('STAGED', 'CAPTURING')).toEqual(['LIVE', 'CAPTURING']);
    expect(legalPairingPath('CAPTURING', 'ERROR')).toEqual(['ERROR']);
    // ERROR can re-enter PAIRING directly (reducer table), so the shortest
    // legal fall to OFFLINE is a single re-pair hop, no IDLE round-trip.
    expect(legalPairingPath('ERROR', 'OFFLINE')).toEqual(['PAIRING', 'OFFLINE']);
    expect(legalPairingPath('LIVE', 'OFFLINE')).toEqual(['OFFLINE']);
  });

  it('every path step is legal per the reducer table, and applying a path lands on the target', () => {
    const states: PairingState[] = ['IDLE', 'PAIRING', 'LIVE', 'CAPTURING', 'STAGED', 'OFFLINE', 'ERROR'];
    for (const from of states) {
      for (const to of states) {
        const path = legalPairingPath(from, to);

        // Replay through the real reducer starting at `from`.
        let state = { ...initialWorkspaceState, pairing: { state: from, updatedAt: 0 } as PairingStatus };
        for (const hop of path) {
          state = workspaceReducer(state, { type: 'pairing/transition', to: hop, at: 1 });
          expect(state.pairing.state, `${from} → ${hop} must be accepted`).toBe(hop);
        }
        expect(state.pairing.state, `${from} → ${to} path must land on target`).toBe(to);
      }
    }
  });

  it('pairingSyncActions uses pairing/established for the LIVE hop so deviceId reaches the rail', () => {
    const actions: WorkspaceAction[] = pairingSyncActions('IDLE', 'STAGED', 42, 'peer-7');
    expect(actions.map((action) => action.type)).toEqual([
      'pairing/transition',
      'pairing/established',
      'pairing/transition',
      'pairing/transition',
    ]);
    const live = actions[1];
    if (live?.type !== 'pairing/established') throw new Error('unreachable');
    expect(live.deviceId).toBe('peer-7');

    // The peer id reaches the store at the LIVE hop…
    const afterLive = actions
      .slice(0, 2)
      .reduce((current, action) => workspaceReducer(current, action), initialWorkspaceState);
    expect(afterLive.pairing.state).toBe('LIVE');
    expect(afterLive.pairing.deviceId).toBe('peer-7');

    // …and later plain transitions wipe it: `nextPairingStatus` rebuilds the
    // status without spreading `current` (existing T9 kernel semantics —
    // the rail only shows deviceId on the ACTIVE LIVE row anyway).
    const final = actions
      .slice(2)
      .reduce((current, action) => workspaceReducer(current, action), afterLive);
    expect(final.pairing.state).toBe('STAGED');
    expect(final.pairing.deviceId).toBeUndefined();

    // No deviceId → plain transitions, still legal.
    const plain = pairingSyncActions('STAGED', 'CAPTURING', 7);
    expect(plain.every((action) => action.type === 'pairing/transition')).toBe(true);
  });

  it('the rail reflects a store that walked to STAGED (acks drive rail STAGED)', () => {
    // While LIVE is the active row, the peer id reaches the rail…
    let state = initialWorkspaceState;
    for (const action of pairingSyncActions('IDLE', 'LIVE', 1_000, 'peer-1')) {
      state = workspaceReducer(state, action);
    }
    const liveStages = deriveRailStages(state.pairing);
    expect(liveStages.find((stage) => stage.key === 'LIVE')?.status).toBe('active');
    expect(liveStages.find((stage) => stage.key === 'LIVE')?.detail).toBe('peer-1');

    // …and after the capture cycle STAGED is active with the earlier rows
    // done. Done rows carry no detail — the rail never fabricates
    // per-stage history (deviceId is wiped by later plain transitions,
    // T9 kernel semantics, and the rail reads it only on the active row).
    for (const action of pairingSyncActions('LIVE', 'STAGED', 2_000)) {
      state = workspaceReducer(state, action);
    }
    const stages = deriveRailStages(state.pairing);
    expect(stages.find((stage) => stage.key === 'STAGED')?.status).toBe('active');
    expect(stages.find((stage) => stage.key === 'CAPTURING')?.status).toBe('done');
    expect(stages.find((stage) => stage.key === 'LIVE')?.status).toBe('done');
    expect(stages.find((stage) => stage.key === 'LIVE')?.detail).toBeUndefined();
    expect(stages.find((stage) => stage.key === 'TERMINAL')?.status).toBe('pending');
  });
});

/* ================================================================== *
 * the journey: handshake → frames → acks
 * ================================================================== */

describe('pairing journey — host ⇄ joiner through mock hub + mock WebRTC', () => {
  it('walks both sessions to LIVE on peer join, then transfers a frame end to end with a verified ack', async () => {
    const h = createHarness();
    await h.connect();

    // Both sides joined the same room and completed the handshake.
    expect(h.hub.joinLog).toEqual(['NS-AAAA', 'NS-AAAA']);
    expect(h.host.state).toBe('LIVE');
    expect(h.joiner.state).toBe('LIVE');
    expect(statesOf(h.hostEvents)).toEqual(['PAIRING', 'LIVE']);
    expect(statesOf(h.joinerEvents)).toEqual(['PAIRING', 'LIVE']);
    // deviceId is the server-generated peer id observed at join.
    const live = h.hostEvents.find((event) => event.type === 'state' && event.state === 'LIVE');
    if (live?.type !== 'state') throw new Error('unreachable');
    expect(live.deviceId).toMatch(/^peer-/);
    expect(errorsOf(h.hostEvents)).toHaveLength(0);
    expect(errorsOf(h.joinerEvents)).toHaveLength(0);
    // Host-only first attempt — no STUN involved on the happy path.
    for (const config of h.world.configs) expect(config.iceServers).toEqual([]);

    // Sender side: capture → chunks → ack.
    const data = frameBytes(150_000); // 3 chunks at 64 KiB
    const resultPromise = h.joiner.sendFrame(data, 'frame-j1');
    await settle();
    const result = await resultPromise;

    expect(result).toEqual({ ok: true, frameId: 'frame-j1', bytes: 150_000, ackedBytes: 150_000 });
    expect(h.joiner.state).toBe('STAGED');
    expect(statesOf(h.joinerEvents)).toEqual(['PAIRING', 'LIVE', 'CAPTURING', 'STAGED']);

    // Receiver side: progress events, then the verified frame.
    const received = framesOf(h.hostEvents);
    expect(received).toHaveLength(1);
    expect(received[0]?.frameId).toBe('frame-j1');
    expect(received[0]?.bytes).toBe(150_000);
    expect(received[0]?.data).toEqual(data);
    expect(received[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.host.state).toBe('STAGED');
    expect(statesOf(h.hostEvents)).toEqual(['PAIRING', 'LIVE', 'CAPTURING', 'STAGED']);

    const receiveProgress = h.hostEvents.filter(
      (event): event is Extract<PairingSessionEvent, { type: 'receive' }> => event.type === 'receive',
    );
    expect(receiveProgress.map((event) => event.received)).toEqual([1, 2, 3]);
    expect(receiveProgress.every((event) => event.total === 3)).toBe(true);

    // Sender progress moved only on real sends and the real ack.
    const transfers = h.joinerEvents.filter(
      (event): event is Extract<PairingSessionEvent, { type: 'transfer' }> => event.type === 'transfer',
    );
    expect(transfers.length).toBeGreaterThanOrEqual(4); // 3 sends + ack
    const last = transfers[transfers.length - 1];
    expect(last?.progress).toEqual({
      frameId: 'frame-j1',
      chunkCount: 3,
      sentChunks: 3,
      acked: true,
      bytes: 150_000,
      ackedBytes: 150_000,
    });

    // A second frame walks STAGED → CAPTURING → STAGED legally on both sides.
    const second = await (async () => {
      const promise = h.joiner.sendFrame(frameBytes(20_000), 'frame-j2');
      await settle();
      return promise;
    })();
    expect(second.ok).toBe(true);
    expect(h.host.state).toBe('STAGED');
    expect(h.joiner.state).toBe('STAGED');
    expect(framesOf(h.hostEvents)).toHaveLength(2);
    expect(transferErrorsOf(h.hostEvents)).toHaveLength(0);
    expect(transferErrorsOf(h.joinerEvents)).toHaveLength(0);

    h.joiner.close();
    h.host.close();
  });

  it('surfaces the signalling lifecycle (open → closed) on both sessions', async () => {
    const h = createHarness();
    h.host.start();
    await settle();
    const statuses = (events: PairingSessionEvent[]) =>
      events.flatMap((event) => (event.type === 'signalling' ? [event.status] : []));

    expect(statuses(h.hostEvents)).toEqual(['open']);
    expect(statuses(h.joinerEvents)).toEqual([]);

    h.joiner.start();
    await settle();
    expect(statuses(h.joinerEvents)).toEqual(['open']);

    h.host.close();
    expect(statuses(h.hostEvents)).toEqual(['open', 'closed']);
    expect(h.host.state).toBe('OFFLINE');
    // Intentional close never retries: exactly one socket per session (the
    // joiner's is still open), and draining the backoff clock adds none.
    const socketsAfterClose = h.hub.socketCount();
    expect(socketsAfterClose).toBe(2);
    await h.clock.drain();
    expect(h.hub.socketCount()).toBe(socketsAfterClose);
    h.joiner.close();
  });

  it('close() is idempotent and never forces an illegal transition from ERROR', async () => {
    const h = createHarness({ mode: 'fail' });
    await h.connect();
    await settle();
    expect(h.joiner.state).toBe('ERROR');

    const before = statesOf(h.joinerEvents);
    h.joiner.close();
    h.joiner.close();
    const after = statesOf(h.joinerEvents);
    expect(after).toEqual(before); // stays ERROR — no fake OFFLINE from ERROR
    expect(after[after.length - 1]).toBe('ERROR');
  });
});

/* ================================================================== *
 * transfer failure paths — loud, never silent
 * ================================================================== */

describe('journey failure paths', () => {
  it('hash mismatch on first delivery → receiver nacks → sender retransmits → verified frame lands', async () => {
    const h = createHarness({ corrupt: 'once' });
    await h.connect();

    const data = frameBytes(30_000);
    const promise = h.joiner.sendFrame(data, 'frame-r1');
    await settle();
    const result = await promise;

    // The retransmission succeeded — one clean retry, no data invented.
    expect(result).toEqual({ ok: true, frameId: 'frame-r1', bytes: 30_000, ackedBytes: 30_000 });

    // The receiver reported the mismatch loudly BEFORE the retry landed.
    const hostErrors = transferErrorsOf(h.hostEvents);
    expect(hostErrors).toHaveLength(1);
    expect(hostErrors[0]).toMatch(/sha256 mismatch/);
    expect(hostErrors[0]).toContain('frame-r1');

    // Exactly one verified frame, byte-identical to what was sent.
    const frames = framesOf(h.hostEvents);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toEqual(data);
    expect(h.host.state).toBe('STAGED');
    expect(h.joiner.state).toBe('STAGED');
    // The mismatch never faked a completion and never faked an error state.
    expect(transferErrorsOf(h.joinerEvents)).toHaveLength(0);
    expect(h.joinerEvents.filter((event) => event.type === 'state' && event.state === 'ERROR')).toHaveLength(0);
  });

  it('permanent corruption → retries exhausted → the sender fails loudly with the receiver reason', async () => {
    const h = createHarness({ corrupt: 'all' }, { frameRetries: 1 });
    await h.connect();

    const promise = h.joiner.sendFrame(frameBytes(10_000), 'frame-x1');
    await settle();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('frame-x1');
    expect(result.reason).toMatch(/sha256 mismatch|rejected by the receiver/);

    // Loud on both sides…
    const senderErrors = transferErrorsOf(h.joinerEvents);
    expect(senderErrors.some((reason) => reason.includes('frame-x1'))).toBe(true);
    expect(transferErrorsOf(h.hostEvents).some((reason) => reason.includes('sha256 mismatch'))).toBe(true);
    // …but the receiver never staged an unverified frame.
    expect(framesOf(h.hostEvents)).toHaveLength(0);
    // Both sessions return to LIVE (the attempt is over) and stay usable.
    expect(h.joiner.state).toBe('LIVE');
    expect(h.host.state).toBe('LIVE');
    // The sender told the receiver the attempt ended (capture-state idle).
    expect(h.hostEvents.filter((event) => event.type === 'state' && event.state === 'CAPTURING').length)
      .toBeGreaterThanOrEqual(1);
  });

  it('ack timeout: headers arrive, payloads never do → sender fails loudly after the timeout', async () => {
    const h = createHarness({ dropPayloads: true }, { ackTimeoutMs: 5_000 });
    await h.connect();

    const promise = h.joiner.sendFrame(frameBytes(9_000), 'frame-t1');
    await settle();
    // Nothing resolved — the receiver cannot verify what never arrived.
    let settledResult: Awaited<typeof promise> | null = null;
    void promise.then((value) => {
      settledResult = value;
    });
    await settle();
    expect(settledResult).toBeNull();

    await h.clock.drain();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toMatch(/no frame-ack within 5000 ms/);
    expect(result.reason).toContain('frame-t1');

    expect(transferErrorsOf(h.joinerEvents).some((reason) => reason.includes('no frame-ack'))).toBe(true);
    expect(framesOf(h.hostEvents)).toHaveLength(0);
    // The idle capture-state resets the receiver instead of leaving it CAPTURING.
    expect(h.host.state).toBe('LIVE');
    expect(h.joiner.state).toBe('LIVE');
  });

  it('peer disconnect mid-transfer: the send fails loudly with the exact chunk position', async () => {
    const h = createHarness({ closeAfterPayloads: 1 }, { ackTimeoutMs: 60_000 });
    await h.connect();

    const promise = h.joiner.sendFrame(frameBytes(150_000), 'frame-d1'); // 3 chunks
    await settle();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toMatch(/Data channel closed mid-frame after 1\/3 chunks/);
    // The sender observed the channel death as an event, too.
    expect(transferErrorsOf(h.joinerEvents).some((reason) => reason.includes('mid-frame'))).toBe(true);
    // Never claims completion; the receiver never verified a frame.
    expect(framesOf(h.hostEvents)).toHaveLength(0);
    expect(h.joiner.state).not.toBe('STAGED');
    expect(h.host.state).not.toBe('STAGED');
  });

  it('sending before a peer exists fails closed instead of pretending to transfer', async () => {
    const h = createHarness();
    h.host.start();
    await settle();
    // Joiner never started — no room, no channel.
    const result = await h.host.sendFrame(frameBytes(100), 'frame-early');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toMatch(/Cannot send a frame while pairing is PAIRING/);
    expect(transferErrorsOf(h.hostEvents).length).toBeGreaterThanOrEqual(1);
    expect(h.host.state).toBe('PAIRING'); // pre-flight refusal does not kill the session
    h.host.close();
  });

  it('two concurrent frame sends are refused — one transfer at a time', async () => {
    const h = createHarness();
    await h.connect();

    const first = h.joiner.sendFrame(frameBytes(5_000), 'frame-a');
    const second = h.joiner.sendFrame(frameBytes(5_000), 'frame-b');
    await settle();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) throw new Error('unreachable');
    expect(secondResult.reason).toMatch(/already in progress/);
    expect(firstResult.ok).toBe(true);
    // Exactly one frame landed.
    expect(framesOf(h.hostEvents)).toHaveLength(1);
    expect(framesOf(h.hostEvents)[0]?.frameId).toBe('frame-a');
  });
});

/* ================================================================== *
 * session-level failure branches: ICE, signalling, expiry
 * ================================================================== */

describe('journey session failures', () => {
  it('ICE failure after the STUN retry lands both sessions on ERROR with ICE_FAILED', async () => {
    const h = createHarness({ mode: 'fail' });
    await h.connect();
    await settle();
    await settle();

    expect(h.host.state).toBe('ERROR');
    expect(h.joiner.state).toBe('ERROR');
    const hostErrors = errorsOf(h.hostEvents);
    expect(hostErrors.map((error) => error.code)).toContain('ICE_FAILED');
    expect(errorsOf(h.joinerEvents).map((error) => error.code)).toContain('ICE_FAILED');
    const errorStates = h.hostEvents.filter(
      (event): event is Extract<PairingSessionEvent, { type: 'state' }> =>
        event.type === 'state' && event.state === 'ERROR',
    );
    expect(errorStates[0]?.reason).toContain('direct peer connection');
    // Never faked LIVE/STAGED anywhere.
    expect(statesOf(h.hostEvents)).not.toContain('LIVE');
    expect(statesOf(h.hostEvents)).not.toContain('STAGED');
    // One STUN retry was spent, documented by the peer's own event stream.
    expect(h.hostEvents.some((event) => event.type === 'stun-fallback')).toBe(true);
    expect(h.world.configs.map((config) => config.iceServers).every((servers) => Array.isArray(servers))).toBe(true);
  });

  it('relay unreachable from the first connect → full backoff ladder → SIGNALING_DOWN', async () => {
    const h = createHarness();
    h.hub.setAccepting(false);
    h.host.start();
    await settle();
    await h.clock.drain();

    expect(h.host.state).toBe('ERROR');
    const errors = errorsOf(h.hostEvents);
    expect(errors.map((error) => error.code)).toContain('SIGNALING_DOWN');
    expect(h.hub.socketCount()).toBe(6); // first attempt + 5 retries
    expect(h.clock.delays).toEqual([250, 500, 1000, 2000, 4000]);
    // No peer, no fake LIVE.
    expect(statesOf(h.hostEvents)).toEqual(['PAIRING', 'ERROR']);
  });

  it('session expiry forces OFFLINE (machine countdown is the source of truth)', async () => {
    const h = createHarness({}, { ttlMs: 60_000 });
    await h.connect();
    expect(h.host.state).toBe('LIVE');
    expect(h.joiner.state).toBe('LIVE');

    // 59 999 ms in: the tick finds a live session and changes nothing.
    h.setNow(START_NOW + 59_999);
    expect(h.host.tick()).toBeNull();
    expect(h.host.state).toBe('LIVE');

    // The 10-minute (here: 60 s) mark — forced fall to OFFLINE, no opt-out.
    h.setNow(START_NOW + 60_000);
    const fell = h.host.tick();
    expect(fell).toEqual({ ok: true, state: 'OFFLINE' });
    expect(h.host.state).toBe('OFFLINE');
    expect(statesOf(h.hostEvents)).toContain('OFFLINE');

    // The joiner's own countdown elapsed too — sending into a dead session
    // fails closed with an honest reason instead of pretending to transfer.
    const result = await h.joiner.sendFrame(frameBytes(10), 'frame-late');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toMatch(/OFFLINE|expired/i);
  });
});

/* ================================================================== *
 * store/rail integration — real session events drive the T9 reducer
 * ================================================================== */

describe('session → store → rail (no DOM, no simulated progress)', () => {
  it('walks both stores to STAGED only when a verified frame-ack lands', async () => {
    const h = createHarness();
    let hostStore = initialWorkspaceState;
    let joinerStore = initialWorkspaceState;
    const hostBridge = createPairingSyncBridge({
      initial: hostStore.pairing.state,
      dispatch: (action) => {
        hostStore = workspaceReducer(hostStore, action);
      },
    });
    const joinerBridge = createPairingSyncBridge({
      initial: joinerStore.pairing.state,
      dispatch: (action) => {
        joinerStore = workspaceReducer(joinerStore, action);
      },
    });
    const offHost = h.host.on((event) => hostBridge.handle(event));
    const offJoiner = h.joiner.on((event) => joinerBridge.handle(event));

    await h.connect();
    expect(hostStore.pairing.state).toBe('LIVE');
    expect(joinerStore.pairing.state).toBe('LIVE');
    // The relay's peer id reached both stores with the LIVE hop.
    expect(hostStore.pairing.deviceId).toMatch(/^peer-/);
    expect(joinerStore.pairing.deviceId).toMatch(/^peer-/);

    const promise = h.joiner.sendFrame(frameBytes(40_000), 'frame-i1');
    await settle();
    const result = await promise;
    expect(result.ok).toBe(true);

    // The verified ack — and only the ack — walked both stores to STAGED.
    expect(hostStore.pairing.state).toBe('STAGED');
    expect(joinerStore.pairing.state).toBe('STAGED');
    for (const store of [hostStore, joinerStore]) {
      const stages = deriveRailStages(store.pairing);
      expect(stages.find((stage) => stage.key === 'STAGED')?.status).toBe('active');
      expect(stages.find((stage) => stage.key === 'CAPTURING')?.status).toBe('done');
      expect(stages.find((stage) => stage.key === 'LIVE')?.status).toBe('done');
      expect(stages.find((stage) => stage.key === 'TERMINAL')?.status).toBe('pending');
    }

    offHost();
    offJoiner();
    h.joiner.close();
    h.host.close();
  });
});
