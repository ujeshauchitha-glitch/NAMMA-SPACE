import { describe, expect, it } from 'vitest';

import {
  CAPTURE_CHANNEL_LABEL,
  PAIRING_ERROR_MESSAGES,
  PAIRING_STATES,
  SESSION_TTL_MS,
  STUN_FALLBACK_URL,
  PairingError,
  createPairingMachine,
  createPairingPeer,
  createSignallingClient,
  generateSessionToken,
  isSessionToken,
  parsePairingMessage,
  parseSignalMessage,
  CaptureStateSchema,
  FrameChunkHeaderSchema,
  type CaptureStateMessage,
  type DataChannelLike,
  type FrameChunkHeader,
  type PairingPeerOptions,
  type PeerConnectionLike,
  type PeerEvent,
  type RTCPeerConnectionFactory,
  type Scheduler,
  type SignalMessage,
  type SignallingEvent,
  type SignallingSocket,
  type SocketFactory,
} from '../src/lib/pairing';
import { illegalPairingReason, PAIRING_TRANSITIONS } from '../src/state/reducer';

/**
 * T18 pairing protocol suite — two in-memory peers, one mock signalling hub,
 * one mock WebRTC world. Zero real network, zero real phone, zero DOM.
 *
 * Timers are either injected (backoff ladder is data, drained manually) or
 * harmless macrotasks (`settle`), so every async chain drains deterministically.
 */

/** One macrotask — lets arbitrary promise-microtask chains fully drain. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* ------------------------------------------------------------------ *
 * manual scheduler — backoff delays become recorded data
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
 * mock signalling hub — in-memory rooms, no sockets leave this file
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
        // sdp / ice — relay verbatim to the other member of this socket's room.
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
    injectRaw(raw: string): void {
      const open = sockets.find((socket) => socket.readyState === 1);
      deliver(open ?? sockets[0], raw);
    },
  };
}

/* ------------------------------------------------------------------ *
 * mock WebRTC world — one shared registry links offers to answers
 * ------------------------------------------------------------------ */

type MockChannel = DataChannelLike & { peer?: MockChannel };

type MockPc = PeerConnectionLike & {
  uid: number;
  local: { type: string; sdp: string } | null;
  remote: { type: string; sdp: string } | null;
  link: MockPc | null;
  localChannel: MockChannel | null;
  addedCandidates: number;
};

function createMockRtc(mode: 'connect' | 'fail' | 'fail-once') {
  let uid = 0;
  const configs: { iceServers: { urls: string }[] }[] = [];
  const pcs: MockPc[] = [];
  const channels: MockChannel[] = [];
  const offers = new Map<string, MockPc>();

  const makeChannel = (label: string): MockChannel => {
    const channel: MockChannel = {
      label,
      readyState: 'connecting',
      send(data) {
        const peer = channel.peer;
        if (peer) queueMicrotask(() => peer.onmessage?.({ data }));
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
    // fail-once: the first *connection attempt* between two host-only peers
    // fails at establishment, forcing both sides through the STUN fallback
    // and a synchronous lockstep rebuild before the retry can connect.
    const hostOnly =
      (configs[a.uid - 1]?.iceServers.length ?? 1) === 0 &&
      (configs[b.uid - 1]?.iceServers.length ?? 1) === 0;
    if (mode === 'fail-once' && hostOnly) {
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

  const factory: RTCPeerConnectionFactory = (config) => {
    configs.push(config);
    const pc: MockPc = {
      uid: ++uid,
      connectionState: 'new',
      local: null,
      remote: null,
      link: null,
      localChannel: null,
      addedCandidates: 0,
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
        queueMicrotask(() => {
          pc.onicecandidate?.({
            candidate: { candidate: `mock-candidate:${pc.uid}`, sdpMid: '0', sdpMLineIndex: 0 },
          });
          if (mode === 'fail') {
            pc.connectionState = 'failed';
            pc.onconnectionstatechange?.();
          }
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
      },
      onicecandidate: null,
      ondatachannel: null,
      onconnectionstatechange: null,
    };
    pcs.push(pc);
    return pc;
  };

  return { factory, configs, pcs, channels };
}

/** Wire one signalling client to one peer, both directions. */
function wire(client: ReturnType<typeof createSignallingClient>, peer: ReturnType<typeof createPairingPeer>): void {
  client.on((event: SignallingEvent) => {
    if (event.type !== 'message') return;
    const message = event.message;
    if (message.type === 'sdp') void peer.handleSignal({ description: message.description });
    if (message.type === 'ice') void peer.handleSignal({ candidate: message.candidate });
  });
  peer.on((event: PeerEvent) => {
    if (event.type === 'offer') client.send({ type: 'sdp', description: event.description });
    if (event.type === 'answer') client.send({ type: 'sdp', description: event.description });
    if (event.type === 'ice') client.send({ type: 'ice', candidate: event.candidate });
  });
}

const captureState: CaptureStateMessage = {
  type: 'capture-state',
  status: 'capturing',
  frameId: 'frame-1',
  at: 1730000000000,
};

const frameChunk: FrameChunkHeader = {
  type: 'frame-chunk',
  frameId: 'frame-1',
  index: 0,
  total: 1,
  bytes: 4096,
  sha256: 'a'.repeat(64),
};

/* ================================================================== *
 * session token
 * ================================================================== */

describe('session token (NS-XXXX)', () => {
  it('generates tokens matching the NS-XXXX shape', () => {
    for (let i = 0; i < 50; i++) {
      expect(isSessionToken(generateSessionToken())).toBe(true);
    }
  });

  it('maps zero-filled entropy to NS-AAAA (alphabet index 0)', () => {
    const token = generateSessionToken({
      crypto: {
        getRandomValues(array) {
          array.fill(0);
          return array;
        },
      },
    });
    expect(token).toBe('NS-AAAA');
  });

  it('rejects out-of-range entropy bytes instead of skewing the alphabet', () => {
    let call = 0;
    const token = generateSessionToken({
      crypto: {
        getRandomValues(array) {
          // First batch: every byte >= 252 → rejected by sampling.
          // Second batch: 0,1,2,3 → A,B,C,D.
          const batch = call++ === 0 ? [255, 255, 255, 255, 255, 255, 255, 255] : [0, 1, 2, 3, 0, 0, 0, 0];
          for (let i = 0; i < array.length; i++) array[i] = batch[i % batch.length];
          return array;
        },
      },
    });
    expect(token).toBe('NS-ABCD');
    expect(call).toBe(2);
  });

  it('throws NO_SECURE_CONTEXT without a usable crypto source', () => {
    expect(() => generateSessionToken({ crypto: null })).toThrowError(
      expect.objectContaining({ code: 'NO_SECURE_CONTEXT' }),
    );
    expect(() => generateSessionToken({ crypto: {} })).toThrowError(
      expect.objectContaining({ code: 'NO_SECURE_CONTEXT' }),
    );
  });

  it('isSessionToken rejects near-misses', () => {
    expect(isSessionToken('NS-AAA')).toBe(false);
    expect(isSessionToken('ns-aaaa')).toBe(false);
    expect(isSessionToken('NS-AAAAA')).toBe(false);
    expect(isSessionToken('XX-AAAA')).toBe(false);
    expect(isSessionToken('')).toBe(false);
  });
});

/* ================================================================== *
 * error taxonomy
 * ================================================================== */

describe('pairing error taxonomy', () => {
  it('exposes exactly the three spec codes with default messages', () => {
    expect(Object.keys(PAIRING_ERROR_MESSAGES).sort()).toEqual(['ICE_FAILED', 'NO_SECURE_CONTEXT', 'SIGNALING_DOWN']);
    for (const code of ['NO_SECURE_CONTEXT', 'SIGNALING_DOWN', 'ICE_FAILED'] as const) {
      const error = new PairingError(code);
      expect(error.code).toBe(code);
      expect(error.name).toBe('PairingError');
      expect(error.message).toBe(PAIRING_ERROR_MESSAGES[code]);
    }
  });
});

/* ================================================================== *
 * state machine
 * ================================================================== */

describe('pairing state machine', () => {
  it('mirrors the canonical T9 state set exactly', () => {
    expect([...PAIRING_STATES].sort()).toEqual(
      ['CAPTURING', 'ERROR', 'IDLE', 'LIVE', 'OFFLINE', 'PAIRING', 'STAGED'].sort(),
    );
    const machine = createPairingMachine();
    expect(machine.state).toBe('IDLE');
    expect(machine.expiresAt).toBeNull();
    expect(machine.remainingMs(0)).toBeNull();
    expect(machine.isExpired(0)).toBe(false);
  });

  it('walks the legal handshake path IDLE → PAIRING → LIVE → CAPTURING → STAGED', () => {
    const machine = createPairingMachine();
    expect(machine.beginSession(0)).toEqual({ ok: true, state: 'PAIRING' });
    expect(machine.expiresAt).toBe(SESSION_TTL_MS);
    expect(machine.send('LIVE', 1)).toEqual({ ok: true, state: 'LIVE' });
    expect(machine.send('CAPTURING', 2)).toEqual({ ok: true, state: 'CAPTURING' });
    expect(machine.send('STAGED', 3)).toEqual({ ok: true, state: 'STAGED' });
    expect(machine.send('LIVE', 4)).toEqual({ ok: true, state: 'LIVE' });
    expect(machine.state).toBe('LIVE');
  });

  it('rejects illegal transitions with the reducer reason', () => {
    const machine = createPairingMachine();
    const result = machine.send('CAPTURING', 0);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe(illegalPairingReason('IDLE', 'CAPTURING'));
    expect(result.reason).toContain('IDLE');
    expect(result.reason).toContain('CAPTURING');
    expect(result.reason).toContain('Expected one of:');
    expect(machine.state).toBe('IDLE');
    expect(machine.can('CAPTURING')).toBe(false);
    expect(machine.can('PAIRING')).toBe(true);
  });

  it('agrees with the reducer table for every state pair', () => {
    for (const from of PAIRING_STATES) {
      for (const to of PAIRING_STATES) {
        // Fresh machine per pair — a successful send would mutate `state`.
        const machine = createPairingMachine({ initial: from });
        const expected = PAIRING_TRANSITIONS[from].includes(to);
        expect(machine.can(to)).toBe(expected);
        const result = machine.send(to, 0);
        expect(result.ok).toBe(expected);
      }
    }
  });

  it('counts down 10 minutes and forces OFFLINE once expired', () => {
    const machine = createPairingMachine();
    machine.beginSession(1_000);
    expect(machine.remainingMs(1_000)).toBe(SESSION_TTL_MS);
    expect(machine.remainingMs(1_000 + 60_000)).toBe(SESSION_TTL_MS - 60_000);
    expect(machine.isExpired(1_000 + SESSION_TTL_MS - 1)).toBe(false);
    expect(machine.isExpired(1_000 + SESSION_TTL_MS)).toBe(true);

    // Expired but not yet ticked: only OFFLINE is reachable.
    const expired = machine.send('LIVE', 1_000 + SESSION_TTL_MS);
    expect(expired.ok).toBe(false);
    if (expired.ok) throw new Error('unreachable');
    expect(expired.reason).toContain('Session expired after 10 minutes');
    expect(machine.send('OFFLINE', 1_000 + SESSION_TTL_MS)).toEqual({ ok: true, state: 'OFFLINE' });
  });

  it('tick performs the forced fall and reports honestly afterwards', () => {
    const machine = createPairingMachine();
    machine.beginSession(0);
    expect(machine.tick(SESSION_TTL_MS - 1)).toBeNull();
    expect(machine.tick(SESSION_TTL_MS)).toEqual({ ok: true, state: 'OFFLINE' });
    expect(machine.state).toBe('OFFLINE');
    expect(machine.tick(SESSION_TTL_MS * 2)).toBeNull();
    expect(machine.remainingMs(SESSION_TTL_MS * 2)).toBe(0);
  });

  it('a rejected beginSession does not reset a running countdown', () => {
    const machine = createPairingMachine();
    machine.beginSession(0);
    expect(machine.beginSession(100).ok).toBe(false); // already PAIRING
    expect(machine.expiresAt).toBe(SESSION_TTL_MS);
    expect(machine.remainingMs(100)).toBe(SESSION_TTL_MS - 100);
  });

  it('honours a custom ttlMs', () => {
    const machine = createPairingMachine({ ttlMs: 5_000 });
    machine.beginSession(0);
    expect(machine.expiresAt).toBe(5_000);
    expect(machine.tick(5_000)).toEqual({ ok: true, state: 'OFFLINE' });
  });
});

/* ================================================================== *
 * zod wire schemas
 * ================================================================== */

describe('wire schemas', () => {
  it('capture-state round-trips and rejects malformed variants', () => {
    const parsed = CaptureStateSchema.parse(captureState);
    expect(parsed).toEqual(captureState);
    expect(CaptureStateSchema.safeParse({ ...captureState, status: 'bogus' }).success).toBe(false);
    expect(CaptureStateSchema.safeParse({ ...captureState, at: -1 }).success).toBe(false);
    expect(CaptureStateSchema.safeParse({ ...captureState, at: 1.5 }).success).toBe(false);
    expect(CaptureStateSchema.safeParse({ ...captureState, frameId: '' }).success).toBe(false);
  });

  it('frame-chunk header round-trips and rejects malformed variants', () => {
    expect(FrameChunkHeaderSchema.parse(frameChunk)).toEqual(frameChunk);
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, sha256: 'A'.repeat(64) }).success).toBe(false);
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, total: 0 }).success).toBe(false);
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, bytes: 0 }).success).toBe(false);
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, index: -1 }).success).toBe(false);
    // sha256 presence is pinned iff the chunk is final (index === total - 1).
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, sha256: undefined }).success).toBe(false);
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, total: 2, sha256: undefined }).success).toBe(true);
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, total: 2, sha256: 'a'.repeat(64) }).success).toBe(false);
    // index must stay within [0, total).
    expect(FrameChunkHeaderSchema.safeParse({ ...frameChunk, index: 1, total: 1 }).success).toBe(false);
  });

  it('parsePairingMessage never coerces garbage', () => {
    expect(parsePairingMessage(JSON.stringify(captureState))).toEqual(captureState);
    expect(parsePairingMessage(JSON.stringify(frameChunk))).toEqual(frameChunk);
    expect(parsePairingMessage('not json')).toBeNull();
    expect(parsePairingMessage('{"type":"bogus"}')).toBeNull();
    expect(parsePairingMessage(JSON.stringify({ type: 'capture-state', status: 'x', at: 0 }))).toBeNull();
    expect(parsePairingMessage('')).toBeNull();
  });

  it('all five signalling envelopes round-trip through parseSignalMessage', () => {
    const envelopes: SignalMessage[] = [
      { type: 'join', session: 'NS-AAAA' },
      { type: 'peer-joined', peerId: 'peer-1' },
      { type: 'sdp', description: { type: 'offer', sdp: 'v=0 mock' } },
      { type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1', sdpMid: '0', sdpMLineIndex: 0 } },
      { type: 'leave' },
    ];
    for (const envelope of envelopes) {
      expect(parseSignalMessage(JSON.stringify(envelope))).toEqual(envelope);
    }
    expect(parseSignalMessage('{"type":"join"}')).toBeNull(); // missing session
    expect(parseSignalMessage('{"type":"sdp","description":{"type":"pranswer","sdp":"x"}}')).toBeNull();
    expect(parseSignalMessage('42')).toBeNull();
  });
});

/* ================================================================== *
 * signalling client
 * ================================================================== */

describe('signalling client', () => {
  it('connects to /ws?session=TOKEN and joins the room', async () => {
    const hub = createMockHub();
    const client = createSignallingClient({ session: 'NS-AAAA', socketFactory: hub.socketFactory });
    expect(client.url).toBe('/ws?session=NS-AAAA');
    expect(client.status).toBe('idle');
    expect(client.send({ type: 'leave' })).toBe(false); // not open yet

    const events: SignallingEvent[] = [];
    client.on((event) => events.push(event));
    client.connect();
    expect(client.status).toBe('connecting');
    await settle();

    expect(client.status).toBe('open');
    expect(hub.joinLog).toEqual(['NS-AAAA']);
    expect(events.some((event) => event.type === 'open')).toBe(true);

    // connect() while open is a no-op — one socket, one join.
    client.connect();
    await settle();
    expect(hub.socketCount()).toBe(1);
    expect(hub.joinLog).toEqual(['NS-AAAA']);
    expect(client.send({ type: 'leave' })).toBe(true);
    client.close();
  });

  it('reports malformed frames instead of coercing them', async () => {
    const hub = createMockHub();
    const client = createSignallingClient({ session: 'NS-AAAA', socketFactory: hub.socketFactory });
    const events: SignallingEvent[] = [];
    client.on((event) => events.push(event));
    client.connect();
    await settle();

    hub.injectRaw('not json');
    hub.injectRaw('{"type":"bogus"}');
    const malformed = events.filter((event) => event.type === 'malformed');
    expect(malformed).toHaveLength(2);
    client.close();
  });

  it('relays sdp and ice between two peers in the same room', async () => {
    const hub = createMockHub();
    const a = createSignallingClient({ session: 'NS-AAAA', socketFactory: hub.socketFactory });
    const b = createSignallingClient({ session: 'NS-AAAA', socketFactory: hub.socketFactory });
    const seen: SignalMessage[] = [];
    b.on((event) => {
      if (event.type === 'message') seen.push(event.message);
    });
    a.connect();
    b.connect();
    await settle();

    a.send({ type: 'sdp', description: { type: 'offer', sdp: 'v=0 mock' } });
    a.send({ type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1' } });
    await settle();

    // B also saw `peer-joined` when the room filled — filter to the relayed envelopes.
    const relayed = seen.filter((message) => message.type === 'sdp' || message.type === 'ice');
    expect(relayed).toEqual([
      { type: 'sdp', description: { type: 'offer', sdp: 'v=0 mock' } },
      { type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1' } },
    ]);
    a.close();
    b.close();
  });

  it('walks the full backoff ladder then goes down with SIGNALING_DOWN', async () => {
    const hub = createMockHub();
    hub.setAccepting(false);
    const clock = createManualScheduler();
    const client = createSignallingClient({
      session: 'NS-AAAA',
      socketFactory: hub.socketFactory,
      scheduler: clock.scheduler,
    });
    const events: SignallingEvent[] = [];
    client.on((event) => events.push(event));

    client.connect();
    // The refused socket closes on a microtask; let it fail before draining.
    await settle();
    await clock.drain();

    expect(clock.delays).toEqual([250, 500, 1000, 2000, 4000]);
    const reconnects = events.filter(
      (event): event is Extract<SignallingEvent, { type: 'reconnecting' }> => event.type === 'reconnecting',
    );
    expect(reconnects.map((event) => event.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(reconnects.map((event) => event.delayMs)).toEqual([250, 500, 1000, 2000, 4000]);
    expect(client.status).toBe('down');
    const down = events.find((event) => event.type === 'down');
    expect(down && down.type === 'down' ? down.error.code : null).toBe('SIGNALING_DOWN');
    expect(clock.pending).toBe(0); // ladder spent — nothing left scheduled
    expect(hub.socketCount()).toBe(6); // first socket + five retries
  });

  it('drops to SIGNALING_DOWN when an established connection dies', async () => {
    const hub = createMockHub();
    const clock = createManualScheduler();
    const client = createSignallingClient({
      session: 'NS-AAAA',
      socketFactory: hub.socketFactory,
      scheduler: clock.scheduler,
    });
    const events: SignallingEvent[] = [];
    client.on((event) => events.push(event));

    client.connect();
    await settle();
    expect(client.status).toBe('open');

    // Server goes away: every reconnect attempt is refused too.
    hub.setAccepting(false);
    hub.dropAll();
    await clock.drain();

    expect(clock.delays).toEqual([250, 500, 1000, 2000, 4000]);
    expect(client.status).toBe('down');
    expect(events.filter((event) => event.type === 'down')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'open')).toHaveLength(1);
  });

  it('intentional close emits exactly one closed event and never retries', async () => {
    const hub = createMockHub();
    const clock = createManualScheduler();
    const client = createSignallingClient({
      session: 'NS-AAAA',
      socketFactory: hub.socketFactory,
      scheduler: clock.scheduler,
    });
    const events: SignallingEvent[] = [];
    client.on((event) => events.push(event));

    client.connect();
    await settle();
    client.close();

    expect(client.status).toBe('closed');
    expect(events.filter((event) => event.type === 'closed')).toHaveLength(1);
    expect(events.some((event) => event.type === 'reconnecting')).toBe(false);
    expect(clock.pending).toBe(0);
    expect(hub.socketCount()).toBe(1);

    // Closing again is a no-op.
    client.close();
    expect(events.filter((event) => event.type === 'closed')).toHaveLength(1);
  });
});

/* ================================================================== *
 * WebRTC handshake
 * ================================================================== */

describe('WebRTC handshake', () => {
  it('drives two peers through the mock hub to LIVE with host-only ICE', async () => {
    const hub = createMockHub();
    const world = createMockRtc('connect');
    const session = generateSessionToken();

    const clientA = createSignallingClient({ session, socketFactory: hub.socketFactory });
    const clientB = createSignallingClient({ session, socketFactory: hub.socketFactory });
    const initiator = createPairingPeer({ role: 'initiator', createPeerConnection: world.factory });
    const responder = createPairingPeer({ role: 'responder', createPeerConnection: world.factory });

    const initiatorEvents: PeerEvent[] = [];
    const responderEvents: PeerEvent[] = [];
    initiator.on((event) => initiatorEvents.push(event));
    responder.on((event) => responderEvents.push(event));
    wire(clientA, initiator);
    wire(clientB, responder);

    clientA.connect();
    clientB.connect();
    await settle();
    expect(hub.joinLog).toEqual([session, session]);

    await initiator.start();
    await responder.start();
    await settle();

    // Handshake complete → both sides report connected.
    expect(initiatorEvents.filter((event) => event.type === 'connected')).toHaveLength(1);
    expect(responderEvents.filter((event) => event.type === 'connected')).toHaveLength(1);
    expect(initiator.connectionState).toBe('connected');
    expect(responder.connectionState).toBe('connected');
    expect(initiator.stunEngaged).toBe(false);
    expect(responder.stunEngaged).toBe(false);

    // Canonical mapping: handshake completion lands on LIVE (no CONNECTED state).
    const machine = createPairingMachine();
    expect(machine.beginSession(0).ok).toBe(true);
    expect(machine.send('LIVE', 0)).toEqual({ ok: true, state: 'LIVE' });

    // Host-only first attempt — no STUN server was ever configured.
    expect(world.configs).toHaveLength(2);
    for (const config of world.configs) expect(config.iceServers).toEqual([]);

    // ICE actually flowed: every connection received at least one candidate.
    expect(world.pcs).toHaveLength(2);
    for (const pc of world.pcs) expect(pc.addedCandidates).toBeGreaterThanOrEqual(1);

    // capture-state and frame-chunk travel over the `capture` channel.
    expect(initiator.sendCaptureState(captureState)).toBe(true);
    expect(initiator.sendFrameChunk(frameChunk)).toBe(true);
    await settle();
    const received = responderEvents.filter(
      (event): event is Extract<PeerEvent, { type: 'message' }> => event.type === 'message',
    );
    expect(received.map((event) => event.message)).toEqual([captureState, frameChunk]);

    // Malformed inbound frames surface as `malformed`, never thrown.
    const wired = world.channels.find((channel) => channel.onmessage !== null);
    wired?.onmessage?.({ data: 'not json' });
    await settle();
    expect(initiatorEvents.concat(responderEvents).some((event) => event.type === 'malformed')).toBe(true);

    initiator.close();
    responder.close();
    clientA.close();
    clientB.close();
  });

  it('fails host-only ICE, retries once with STUN, then reports ICE_FAILED', async () => {
    const world = createMockRtc('fail');
    const peer = createPairingPeer({ role: 'initiator', createPeerConnection: world.factory });
    const events: PeerEvent[] = [];
    peer.on((event) => events.push(event));

    await peer.start();
    await settle();

    expect(events.filter((event) => event.type === 'offer')).toHaveLength(2);
    const fallbacks = events.filter(
      (event): event is Extract<PeerEvent, { type: 'stun-fallback' }> => event.type === 'stun-fallback',
    );
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.attempt).toBe(1);
    const errors = events.filter(
      (event): event is Extract<PeerEvent, { type: 'error' }> => event.type === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.error.code).toBe('ICE_FAILED');
    expect(peer.stunEngaged).toBe(true);

    // Attempt 1: host-only. Attempt 2: exactly one STUN server, then stop.
    expect(world.configs.map((config) => config.iceServers)).toEqual([[], [{ urls: STUN_FALLBACK_URL }]]);
    expect(STUN_FALLBACK_URL).toBe('stun:stun.l.google.com:19302');

    peer.close();
  });

  it('retries once with STUN after a host-only handshake failure, then connects', async () => {
    const hub = createMockHub();
    const world = createMockRtc('fail-once');
    const session = generateSessionToken();

    const clientA = createSignallingClient({ session, socketFactory: hub.socketFactory });
    const clientB = createSignallingClient({ session, socketFactory: hub.socketFactory });
    const initiator = createPairingPeer({ role: 'initiator', createPeerConnection: world.factory });
    const responder = createPairingPeer({ role: 'responder', createPeerConnection: world.factory });

    const initiatorEvents: PeerEvent[] = [];
    const responderEvents: PeerEvent[] = [];
    initiator.on((event) => initiatorEvents.push(event));
    responder.on((event) => responderEvents.push(event));
    wire(clientA, initiator);
    wire(clientB, responder);

    clientA.connect();
    clientB.connect();
    await settle();
    expect(hub.joinLog).toEqual([session, session]);

    await initiator.start();
    await responder.start();
    await settle();

    // Attempt 1 (host-only) failed → exactly one STUN fallback per side.
    const allEvents = initiatorEvents.concat(responderEvents);
    const fallbacks = allEvents.filter(
      (event): event is Extract<PeerEvent, { type: 'stun-fallback' }> => event.type === 'stun-fallback',
    );
    expect(fallbacks.map((event) => event.attempt)).toEqual([1, 1]);
    expect(initiator.stunEngaged).toBe(true);
    expect(responder.stunEngaged).toBe(true);

    // The retry succeeded — never a terminal ICE_FAILED.
    expect(allEvents.filter((event) => event.type === 'error')).toHaveLength(0);
    expect(initiatorEvents.filter((event) => event.type === 'connected')).toHaveLength(1);
    expect(responderEvents.filter((event) => event.type === 'connected')).toHaveLength(1);
    expect(initiator.connectionState).toBe('connected');
    expect(responder.connectionState).toBe('connected');

    // Config order: two host-only attempts, then two STUN retries.
    expect(world.configs.map((config) => config.iceServers)).toEqual([
      [],
      [],
      [{ urls: STUN_FALLBACK_URL }],
      [{ urls: STUN_FALLBACK_URL }],
    ]);

    // The retried channel actually carries data.
    expect(initiator.sendCaptureState(captureState)).toBe(true);
    await settle();
    const received = responderEvents.filter(
      (event): event is Extract<PeerEvent, { type: 'message' }> => event.type === 'message',
    );
    expect(received.map((event) => event.message)).toEqual([captureState]);

    initiator.close();
    responder.close();
    clientA.close();
    clientB.close();
  });

  it('reports ICE_FAILED immediately when the STUN retry is disabled', async () => {
    const world = createMockRtc('fail');
    const options: PairingPeerOptions = {
      role: 'initiator',
      createPeerConnection: world.factory,
      stunFallback: false,
    };
    const peer = createPairingPeer(options);
    const events: PeerEvent[] = [];
    peer.on((event) => events.push(event));

    await peer.start();
    await settle();

    expect(events.filter((event) => event.type === 'offer')).toHaveLength(1);
    expect(events.some((event) => event.type === 'stun-fallback')).toBe(false);
    const errors = events.filter(
      (event): event is Extract<PeerEvent, { type: 'error' }> => event.type === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.error.code).toBe('ICE_FAILED');
    expect(world.configs.map((config) => config.iceServers)).toEqual([[]]);
    expect(peer.stunEngaged).toBe(false);

    // Sends before the channel is open fail closed; close() is idempotent.
    expect(peer.sendCaptureState(captureState)).toBe(false);
    expect(peer.sendFrameChunk(frameChunk)).toBe(false);
    peer.close();
    peer.close();
    expect(peer.connectionState).toBe('closed');
    expect(peer.sendCaptureState(captureState)).toBe(false);
  });
});
