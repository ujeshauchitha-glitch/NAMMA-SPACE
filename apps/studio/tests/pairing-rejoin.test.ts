import { describe, expect, it } from 'vitest';

import { SignallingRelay } from '../scripts/signalling-relay';
import {
  CAPTURE_CHANNEL_LABEL,
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

/**
 * EX-7 adjacent follow-up — a rejoin REBUILDS the WebRTC connection.
 *
 * The mid-session phone reload used to reach LIVE over a re-established
 * RTCPeerConnection while the `capture` datachannel was never re-created:
 * `peer.ts` creates the channel exactly once per PeerConnection (initiator-
 * only `createPc`), and a second offer on the OLD connection cannot re-send
 * DCEP OPEN — the reloaded side would wait on `ondatachannel` forever and
 * every post-reload capture failed honestly with "The data channel closed
 * before the frame could start".
 *
 * The relay's re-announce is the deterministic rejoin signal: a room only
 * fills to two again after a member's socket closed (PEER_LEFT closes the
 * room at 2→1 — `scripts/signalling-relay.ts`, driven here FOR REAL), so a
 * SECOND `peer-joined` means the other side arrived on a new socket. Both
 * roles then rebuild from scratch (`PairingPeer.restart`, wired in
 * session.ts on the re-announce).
 *
 * This suite drives the real `SignallingRelay` through an in-memory socket
 * factory plus a mock WebRTC world where `pc.close()` closes BOTH channel
 * ends — the invariant under test is behavioural: after a rejoin, a frame
 * crosses end-to-end on a freshly created channel. Zero real network.
 */

/** One macrotask — lets arbitrary promise-microtask chains fully drain. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const frameBytes = (length: number): Uint8Array => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + 7) % 251;
  return out;
};

const START_NOW = 1_730_000_000_000;
const HUGE_TTL_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * manual scheduler — backoff delays become data, drained by hand
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
    /** Fire every scheduled task in due order, draining microtasks after each. */
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
 * relay-backed hub — the REAL SignallingRelay room semantics
 * ------------------------------------------------------------------ */

function createRelayHub() {
  const relay = new SignallingRelay();
  const sockets: SignallingSocket[] = [];
  const clients: { socket: SignallingSocket; client: ReturnType<SignallingRelay['createClient']> }[] = [];

  const socketFactory: SocketFactory = () => {
    const socket: SignallingSocket = {
      readyState: 0,
      send(data) {
        if (socket.readyState !== 1) return;
        relay.handleMessage(client, data);
      },
      close() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        relay.handleClose(client); // explicit leave — PEER_LEFT cascades
        queueMicrotask(() => socket.onclose?.());
      },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const client = relay.createClient(
      // Relay → socket: real ws delivery is async; one microtask models it.
      (data) => {
        if (socket.readyState !== 1) return;
        queueMicrotask(() => socket.onmessage?.({ data }));
      },
      // Relay-initiated close (PEER_LEFT 4001 / ROOM_FULL 4003).
      () => {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        queueMicrotask(() => socket.onclose?.());
      },
    );
    clients.push({ socket, client });
    sockets.push(socket);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.onopen?.();
    });
    return socket;
  };

  return {
    socketFactory,
    /**
     * Transport death seen by BOTH sides at once (network blip): the first
     * socket's failure cascades through the real relay (PEER_LEFT closes the
     * remainder), so draining the backoff clock afterwards reconnects both.
     */
    dropAll(): void {
      for (const entry of [...clients]) {
        if (entry.socket.readyState === 3) continue;
        entry.socket.readyState = 3;
        relay.handleClose(entry.client);
        queueMicrotask(() => entry.socket.onclose?.());
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * mock WebRTC world — linkable pairs; close() kills BOTH channel ends
 * ------------------------------------------------------------------ */

type MockChannel = DataChannelLike & { peer?: MockChannel };

type MockPc = PeerConnectionLike & {
  uid: number;
  local: { type: string; sdp: string } | null;
  remote: { type: string; sdp: string } | null;
  link: MockPc | null;
  localChannel: MockChannel | null;
};

function createMockRtc() {
  let uid = 0;
  const pcs: MockPc[] = [];
  const channels: MockChannel[] = [];
  const offers = new Map<string, MockPc>();

  const closeChannelPair = (channel: MockChannel): void => {
    if (channel.readyState === 'closed') return;
    channel.readyState = 'closed';
    const peer = channel.peer;
    queueMicrotask(() => channel.onclose?.());
    if (peer && peer.readyState !== 'closed') {
      peer.readyState = 'closed';
      queueMicrotask(() => peer.onclose?.());
    }
  };

  const makeChannel = (label: string): MockChannel => {
    const channel: MockChannel = {
      label,
      readyState: 'connecting',
      send(data) {
        if (channel.readyState !== 'open') {
          // Real RTCDataChannel.send throws on a closed channel.
          throw new Error('InvalidStateError: send on a channel that is not open');
        }
        const peer = channel.peer;
        if (!peer) return;
        queueMicrotask(() => peer.onmessage?.({ data }));
      },
      close() {
        closeChannelPair(channel);
      },
      onopen: null,
      onclose: null,
      onmessage: null,
    };
    channels.push(channel);
    return channel;
  };

  const establish = (a: MockPc, b: MockPc): void => {
    // An already-connected/closed side never re-establishes — this is exactly
    // why a second offer on the OLD connection cannot re-create the channel
    // (DCEP OPEN is sent once, when a channel first opens). The mock mirrors
    // that: without a rebuild, the reloaded side gets no `ondatachannel`.
    if (a.connectionState !== 'new' || b.connectionState !== 'new') return;
    const offerer = a.local?.type === 'offer' ? a : b;
    const responder = offerer === a ? b : a;
    for (const pc of [a, b]) {
      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();
    }
    const outbound = offerer.localChannel ?? makeChannel(CAPTURE_CHANNEL_LABEL);
    offerer.localChannel = outbound;
    const inbound = makeChannel(CAPTURE_CHANNEL_LABEL);
    outbound.peer = inbound;
    inbound.peer = outbound;
    outbound.readyState = 'open';
    inbound.readyState = 'open';
    outbound.onopen?.();
    responder.ondatachannel?.({ channel: inbound });
  };

  const maybeEstablish = (pc: MockPc): void => {
    const other = pc.link;
    if (!other) return;
    if (pc.local && pc.remote && other.local && other.remote) establish(pc, other);
  };

  const factory: RTCPeerConnectionFactory = () => {
    const pc: MockPc = {
      uid: ++uid,
      connectionState: 'new',
      local: null,
      remote: null,
      link: null,
      localChannel: null,
      createDataChannel(label) {
        const channel = makeChannel(label);
        pc.localChannel = channel;
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
        // Trickle ICE accepted; the mock world links at SDP time.
      },
      close() {
        pc.connectionState = 'closed';
        // Closing a pc closes the SCTP transport — BOTH channel ends die,
        // here and on the linked pc: no surviving "open" zombie channel.
        if (pc.localChannel) closeChannelPair(pc.localChannel);
        if (pc.link?.localChannel) closeChannelPair(pc.link.localChannel);
      },
      onicecandidate: null,
      ondatachannel: null,
      onconnectionstatechange: null,
    };
    pcs.push(pc);
    return pc;
  };

  return { factory, pcs, channels };
}

/* ------------------------------------------------------------------ *
 * harness — two sessions (plus a "reloaded page") over one real relay
 * ------------------------------------------------------------------ */

type Tracked = {
  session: PairingSession;
  events: PairingSessionEvent[];
  states: string[];
  frames: string[];
  errors: string[];
  transferErrors: string[];
};

function track(session: PairingSession): Tracked {
  const events: PairingSessionEvent[] = [];
  session.on((event) => {
    events.push(event);
  });
  return {
    session,
    events,
    get states() {
      return events.flatMap((event) => (event.type === 'state' ? [event.state] : []));
    },
    get frames() {
      return events.flatMap((event) => (event.type === 'frame' ? [event.frame.frameId] : []));
    },
    get errors() {
      return events.flatMap((event) => (event.type === 'error' ? [event.error.code] : []));
    },
    get transferErrors() {
      return events.flatMap((event) =>
        event.type === 'transfer-error' ? [event.reason] : [],
      );
    },
  };
}

function createRejoinHarness() {
  const hub = createRelayHub();
  const world = createMockRtc();
  const clock = createManualScheduler();
  const token = 'NS-AAAA';

  const common = {
    session: token,
    socketFactory: hub.socketFactory,
    createPeerConnection: world.factory,
    scheduler: clock.scheduler,
    now: (): number => START_NOW,
    ttlMs: HUGE_TTL_MS,
  };

  const openSession = (role: 'host' | 'joiner'): Tracked =>
    track(createPairingSession({ ...common, role }));

  /** Pair a host and a joiner to LIVE; returns both tracked sessions. */
  const connect = async (
    host: Tracked,
    joiner: Tracked,
  ): Promise<void> => {
    host.session.start();
    await settle();
    joiner.session.start();
    await settle();
    await settle();
    await settle();
    expect(host.session.state).toBe('LIVE');
    expect(joiner.session.state).toBe('LIVE');
  };

  /** One frame send with the manual clock — resolves only on ack/failure. */
  const sendFrame = async (
    session: PairingSession,
    data: Uint8Array,
    frameId: string,
  ): Promise<Awaited<ReturnType<PairingSession['sendFrame']>>> => {
    const promise = session.sendFrame(data, frameId);
    await settle();
    return promise;
  };

  return { hub, world, clock, common, openSession, connect, sendFrame };
}

/* ================================================================== *
 * scenario 1 — phone page reload mid-session (the EX-7 adjacent case)
 * ================================================================== */

describe('rejoin — phone page reload mid-session', () => {
  it('rebuilds the connection on the relay re-announce and a SECOND frame crosses end to end', async () => {
    const h = createRejoinHarness();
    const host = h.openSession('host');
    const joiner = h.openSession('joiner');
    await h.connect(host, joiner);

    // First frame: verified + acked on the original `capture` channel.
    const first = await h.sendFrame(joiner.session, frameBytes(96), 'frame-r1');
    expect(first).toEqual({ ok: true, frameId: 'frame-r1', bytes: 96, ackedBytes: 96 });
    await settle();
    expect(host.frames).toEqual(['frame-r1']);
    const channelsAfterFirstPair = h.world.channels.length; // outbound + inbound
    expect(channelsAfterFirstPair).toBe(2);

    // The phone page reloads: its pc + socket die with the page (EX-7
    // adjacent reproduction — the host's channel dies with the remote end).
    joiner.session.close();
    await settle();
    expect(h.world.channels.every((channel) => channel.readyState === 'closed')).toBe(true);

    // The reloaded page re-arrives via `?pair=TOKEN` — a FRESH session.
    const reloaded = h.openSession('joiner');
    reloaded.session.start();
    await settle();
    await settle();

    // The host's signalling client rejoins on its backoff ladder (250 ms);
    // the room refills → the relay re-announces → BOTH sides rebuild.
    expect(h.clock.pending).toBeGreaterThan(0); // the host really is reconnecting
    await h.clock.drain();
    await settle();
    await settle();

    expect(host.session.state).toBe('LIVE');
    expect(reloaded.session.state).toBe('LIVE');
    expect(
      h.world.channels.length,
      'the rebuild did not create a fresh capture channel pair',
    ).toBeGreaterThan(channelsAfterFirstPair);
    expect(h.world.channels[h.world.channels.length - 1]?.readyState).toBe('open');
    expect(host.errors).toEqual([]);
    expect(reloaded.errors).toEqual([]);
    expect(reloaded.transferErrors).toEqual([]);

    // THE INVARIANT: the second capture succeeds end-to-end — the frame is
    // SHA-256-verified and acked on the REBUILT channel, never on a zombie.
    const second = await h.sendFrame(reloaded.session, frameBytes(96), 'frame-r2');
    expect(second).toEqual({ ok: true, frameId: 'frame-r2', bytes: 96, ackedBytes: 96 });
    await settle();
    expect(host.frames).toEqual(['frame-r1', 'frame-r2']);
    expect(host.session.state).toBe('STAGED');
    expect(host.transferErrors).toEqual([]);

    host.session.close();
    reloaded.session.close();
  });

  it('a first room fill does NOT rebuild — the initial pair stays on one connection', async () => {
    const h = createRejoinHarness();
    const host = h.openSession('host');
    const joiner = h.openSession('joiner');
    await h.connect(host, joiner);

    // Exactly one pc per side and one channel pair — `start()` never tore
    // anything down; only a re-announce (below) may rebuild.
    expect(h.world.pcs).toHaveLength(2);
    expect(h.world.channels).toHaveLength(2);
    expect(h.clock.pending).toBe(0); // no reconnect was ever scheduled

    host.session.close();
    joiner.session.close();
  });
});

/* ================================================================== *
 * scenario 2 — signalling blip (NO reload): both sides rejoin live
 * ================================================================== */

describe('rejoin — signalling transport death without a page reload', () => {
  it('both surviving sessions rebuild, the old channels die loudly, and a frame crosses the new one', async () => {
    const h = createRejoinHarness();
    const host = h.openSession('host');
    const joiner = h.openSession('joiner');
    await h.connect(host, joiner);

    const first = await h.sendFrame(joiner.session, frameBytes(96), 'frame-b1');
    expect(first.ok).toBe(true);
    await settle();
    const channelsAfterFirstPair = h.world.channels.length;

    // Transport death on BOTH sockets at once (relay sees both leaves).
    h.hub.dropAll();
    await settle();

    // Both clients climb the backoff ladder; the room refills; the relay
    // re-announces; both rebuild — no silent zombie channel anywhere.
    expect(h.clock.pending).toBeGreaterThan(0);
    await h.clock.drain();
    await settle();
    await settle();

    expect(host.session.state).toBe('LIVE');
    expect(joiner.session.state).toBe('LIVE');
    expect(h.world.channels.length).toBeGreaterThan(channelsAfterFirstPair);
    const oldChannels = h.world.channels.slice(0, channelsAfterFirstPair);
    expect(
      oldChannels.every((channel) => channel.readyState === 'closed'),
      'a pre-rebuild channel still claims to be open — a silent dead channel survived the rejoin',
    ).toBe(true);
    expect(h.world.channels[h.world.channels.length - 1]?.readyState).toBe('open');

    // The SAME (never-reloaded) joiner session captures again — the frame
    // must cross on the rebuilt channel.
    const second = await h.sendFrame(joiner.session, frameBytes(96), 'frame-b2');
    expect(second).toEqual({ ok: true, frameId: 'frame-b2', bytes: 96, ackedBytes: 96 });
    await settle();
    expect(host.frames).toEqual(['frame-b1', 'frame-b2']);
    expect(host.errors).toEqual([]);
    expect(joiner.errors).toEqual([]);
    expect(host.transferErrors).toEqual([]);
    expect(joiner.transferErrors).toEqual([]);

    host.session.close();
    joiner.session.close();
  });
});
