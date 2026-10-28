/**
 * Pairing session (T21) — the sender→receiver journey controller.
 *
 * One object owns the whole Live Scan protocol path for one side of the
 * pair:
 *
 *   signalling client ⇄ pairing peer (`capture` channel) ⇄ frame protocol
 *   ⇄ pairing machine ⇄ consumer events.
 *
 * Roles: `host` shows the QR (WebRTC **initiator**, receives frames),
 * `joiner` arrives via `?pair=` (responder, captures and sends frames).
 * The role only decides who creates the offer — every frame-handling rule
 * below is symmetric, so the loopback suite can drive either side.
 *
 * Honesty rules kept here:
 *  - Machine states move only on observed events (peer connected, ICE
 *    failed, relay down, expiry, verified frame) — never on a timer that
 *    pretends progress happened.
 *  - A frame is reported `frame` only after SHA-256 verification, and the
 *    ack goes out only after that. A rejection travels back as a
 *    `frame-nack`; the sender retransmits once (configurable) and then
 *    fails loudly with the receiver's own reason.
 *  - An unacknowledged frame times out loudly (`ackTimeoutMs`); the sender
 *    announces `capture-state: idle` so the receiver resets instead of
 *    sitting in CAPTURING forever.
 *  - Transfer failures never fake success and never hide in a log: every
 *    one surfaces as a `transfer-error` event plus a failed
 *    `sendFrame` result.
 *
 * Everything DOM-shaped (socket, peer connection, timers, clock) is
 * injected — `tests/pairing-journey.test.ts` runs two sessions through an
 * in-memory hub and a mock WebRTC world with zero real network.
 */
import type { PairingState } from '../../state/types';
import { PairingError } from './errors';
import { createPairingMachine, SESSION_TTL_MS, type PairingTransitionResult } from './machine';
import {
  createCaptureState,
  createFrameAck,
  createFrameAssembler,
  planFrameChunks,
  type FrameAssembler,
  type PlannedFrame,
} from './messages';
import {
  createPairingPeer,
  type PairingPeer,
  type PeerConnectionLike,
  type PeerEvent,
  type PeerRole,
  type RTCPeerConnectionFactory,
} from './peer';
import {
  createSignallingClient,
  type Scheduler,
  type SignallingClient,
  type SignallingEvent,
  type SignallingSocket,
  type SignallingStatus,
  type SocketFactory,
} from './signalling';
import { isSessionToken } from './token';
import { legalPairingPath } from './rail-sync';
import { createFrameAckTracker, createFrameId, type FrameSendProgress } from '../scan/capture';
import type { FrameChunkHeader, PairingMessage, SignalMessage } from '../../types/pairing';

export type PairingSessionRole = 'host' | 'joiner';

/** One SHA-256-verified inbound frame, ready for the staged-images flow. */
export type ReceivedFrame = {
  frameId: string;
  bytes: number;
  sha256: string;
  data: Uint8Array;
};

export type PairingSessionEvent =
  /** Machine state moved (single event per logical move, hops folded). */
  | { type: 'state'; state: PairingState; reason?: string; deviceId?: string; at: number }
  /** Signalling lifecycle: open / reconnecting / closed / down. */
  | { type: 'signalling'; status: SignallingStatus }
  /** Real chunk sends and the real ack, via the tracker — never simulated. */
  | { type: 'transfer'; progress: FrameSendProgress }
  /** Receiver-side assembly progress (chunks actually received). */
  | { type: 'receive'; frameId: string; received: number; total: number }
  /** Receiver verified + acked an inbound frame. */
  | { type: 'frame'; frame: ReceivedFrame }
  /** A transfer-level failure — always paired with a failed send result. */
  | { type: 'transfer-error'; reason: string; frameId?: string }
  /** Host-only ICE failed once; the single documented STUN retry is running. */
  | { type: 'stun-fallback'; attempt: number }
  /** Session-level failure: ICE_FAILED or SIGNALING_DOWN. */
  | { type: 'error'; error: PairingError };

export type SendFrameResult =
  | { ok: true; frameId: string; bytes: number; ackedBytes: number }
  | { ok: false; reason: string };

export type PairingSessionOptions = {
  role: PairingSessionRole;
  /** Room token (`NS-XXXX`) — the same value the QR encodes. */
  session: string;
  /** Injected socket factory; defaults to the browser `WebSocket`. */
  socketFactory?: SocketFactory;
  /** Injected peer factory; defaults to the browser `RTCPeerConnection`. */
  createPeerConnection?: RTCPeerConnectionFactory;
  /** Injected timers (backoff ladder + ack timeout). */
  scheduler?: Scheduler;
  /** Injected clock — machine countdown and ack timestamps read from here. */
  now?: () => number;
  /** Session lifetime; defaults to the spec's 10 minutes. */
  ttlMs?: number;
  /** How long a sent frame may wait for its `frame-ack` (default 15 s). */
  ackTimeoutMs?: number;
  /** Extra attempts after a receiver `frame-nack` (default 1 = one retry). */
  frameRetries?: number;
  /** Disable the single STUN retry (tests that assert first-failure). */
  stunFallback?: boolean;
};

export type PairingSession = {
  readonly role: PairingSessionRole;
  readonly session: string;
  /** Current canonical machine state. */
  readonly state: PairingState;
  readonly signallingStatus: SignallingStatus;
  /** Begin the session and connect signalling (idempotent). */
  start(): void;
  /** Drive the session countdown (UI ticks); forces OFFLINE when elapsed. */
  tick(): PairingTransitionResult | null;
  /** Capture and send one frame; resolves only on a verified ack or a loud failure. */
  sendFrame(data: Uint8Array | ArrayBuffer, frameId?: string): Promise<SendFrameResult>;
  /** Tear down deliberately — never counted as a failure, never retried. */
  close(): void;
  /** Subscribe; returns the unsubscribe function. */
  on(handler: (event: PairingSessionEvent) => void): () => void;
};

type AckOutcome =
  | { kind: 'ack'; ackedBytes: number }
  | { kind: 'nack'; reason: string }
  | { kind: 'timeout' }
  | { kind: 'closed'; reason: string };

type PendingSend = {
  frameId: string;
  timeoutHandle: unknown;
  resolve: (outcome: AckOutcome) => void;
};

/* ------------------------------------------------------------------ *
 * browser defaults (injected away in tests)
 * ------------------------------------------------------------------ */

const defaultSocketFactory: SocketFactory = (url) => {
  if (typeof WebSocket === 'undefined') {
    throw new Error('This environment has no WebSocket support — signalling cannot start.');
  }
  const resolved = url.startsWith('/')
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${url}`
    : url;
  return new WebSocket(resolved) as unknown as SignallingSocket;
};

const defaultPeerConnectionFactory: RTCPeerConnectionFactory = (config) => {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('This browser has no RTCPeerConnection support — pairing cannot start.');
  }
  return new RTCPeerConnection(config) as unknown as PeerConnectionLike;
};

const defaultScheduler: Scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/* ------------------------------------------------------------------ *
 * controller
 * ------------------------------------------------------------------ */

export function createPairingSession(options: PairingSessionOptions): PairingSession {
  if (!isSessionToken(options.session)) {
    throw new Error(`Invalid pairing session token: ${JSON.stringify(options.session)}`);
  }
  const role: PeerRole = options.role === 'host' ? 'initiator' : 'responder';
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const ackTimeoutMs = options.ackTimeoutMs ?? 15_000;
  const frameRetries = options.frameRetries ?? 1;
  const now = options.now ?? ((): number => Date.now());
  const scheduler = options.scheduler ?? defaultScheduler;
  const socketFactory = options.socketFactory ?? defaultSocketFactory;
  const createPeerConnection = options.createPeerConnection ?? defaultPeerConnectionFactory;

  const machine = createPairingMachine({ ttlMs });
  const assembler: FrameAssembler = createFrameAssembler();
  const tracker = createFrameAckTracker();
  const handlers = new Set<(event: PairingSessionEvent) => void>();

  let closed = false;
  let started = false;
  let signalling: SignallingClient | null = null;
  let peer: PairingPeer | null = null;
  let ownPeerId: string | undefined;
  let signallingStatus: SignallingStatus = 'idle';
  /** Header waiting for its payload byte (ordered channel ⇒ positional). */
  let pendingHeader: FrameChunkHeader | null = null;
  let sending = false;
  let pendingSend: PendingSend | null = null;

  const emit = (event: PairingSessionEvent): void => {
    for (const handler of [...handlers]) handler(event);
  };

  /**
   * Move the machine to `target`, folding intermediate legal hops (the
   * table requires e.g. STAGED → LIVE → CAPTURING) into ONE emitted state
   * event. A rejected hop — only reachable through session expiry — is
   * surfaced with its honest reason instead of being swallowed.
   */
  const advanceTo = (target: PairingState, extra: { reason?: string; deviceId?: string } = {}): boolean => {
    if (machine.state === target) return true;
    for (const hop of legalPairingPath(machine.state, target)) {
      if (hop === machine.state) continue;
      const result = machine.send(hop, now());
      if (!result.ok) {
        emit({ type: 'state', state: machine.state, reason: result.reason, at: now() });
        return false;
      }
    }
    if (machine.state !== target) return false;
    emit({
      type: 'state',
      state: target,
      ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
      deviceId: target === 'LIVE' ? (extra.deviceId ?? ownPeerId) : undefined,
      at: now(),
    });
    return true;
  };

  const fatalSessionError = (error: PairingError): void => {
    settlePending({ kind: 'closed', reason: error.message });
    advanceTo('ERROR', { reason: error.message });
    emit({ type: 'error', error });
  };

  const settlePending = (outcome: AckOutcome): void => {
    if (pendingSend === null) return;
    const current = pendingSend;
    pendingSend = null;
    scheduler.clearTimeout(current.timeoutHandle);
    current.resolve(outcome);
  };

  /* ---------------- inbound frame protocol (receiver side) ------------- */

  const handleAssembly = async (
    header: FrameChunkHeader,
    payload: ArrayBuffer | Uint8Array,
  ): Promise<void> => {
    const result = await assembler.push(header, payload);
    if (result.status === 'pending') {
      emit({ type: 'receive', frameId: result.frameId, received: result.received, total: result.total });
      return;
    }
    if (result.status === 'complete') {
      // Progress reaches 100 % on the very push that completed — emit it
      // before the frame itself so observers see receiving end → staged.
      emit({ type: 'receive', frameId: result.frameId, received: header.total, total: header.total });
      // Verified → stage-worthy: machine first, ack only after verification.
      advanceTo('STAGED');
      const acked = peer?.sendFrameAck(createFrameAck(result.frameId, result.bytes, now())) ?? false;
      if (!acked) {
        emit({
          type: 'transfer-error',
          reason: `Frame ${result.frameId} was verified but the ack could not be sent — the sender will time out.`,
          frameId: result.frameId,
        });
      }
      emit({
        type: 'frame',
        frame: {
          frameId: result.frameId,
          bytes: result.bytes,
          sha256: result.sha256,
          data: result.data,
        },
      });
      return;
    }
    // result.status === 'invalid' — never staged, reported loudly both ways.
    const rejected = peer?.sendFrameNack({
      type: 'frame-nack',
      frameId: header.frameId,
      reason: result.reason,
      at: now(),
    }) ?? false;
    if (!rejected) {
      emit({
        type: 'transfer-error',
        reason: `Frame ${header.frameId} failed verification (${result.reason}) but the rejection could not reach the sender.`,
        frameId: header.frameId,
      });
    }
    emit({
      type: 'transfer-error',
      reason: `Frame ${header.frameId} rejected by the assembler: ${result.reason}`,
      frameId: header.frameId,
    });
  };

  const handlePairingMessage = (message: PairingMessage): void => {
    switch (message.type) {
      case 'capture-state': {
        if (message.status === 'capturing') {
          assembler.reset();
          pendingHeader = null;
          advanceTo('CAPTURING');
          return;
        }
        if (message.status === 'staged') {
          advanceTo('STAGED');
          return;
        }
        // idle: the sender gave up — reset instead of waiting forever.
        assembler.reset();
        pendingHeader = null;
        advanceTo('LIVE');
        return;
      }
      case 'frame-chunk': {
        if (pendingHeader !== null) {
          emit({
            type: 'transfer-error',
            reason: `A frame-chunk header for ${pendingHeader.frameId} was still awaiting its payload when ${message.frameId} arrived — the stream is out of order.`,
            frameId: message.frameId,
          });
        }
        pendingHeader = message;
        return;
      }
      case 'frame-ack': {
        if (pendingSend !== null && pendingSend.frameId === message.frameId) {
          const current = pendingSend;
          pendingSend = null;
          scheduler.clearTimeout(current.timeoutHandle);
          const progress = tracker.onAck({ frameId: message.frameId, bytes: message.bytes });
          if (progress) emit({ type: 'transfer', progress });
          current.resolve({ kind: 'ack', ackedBytes: message.bytes });
        }
        return;
      }
      case 'frame-nack': {
        if (pendingSend !== null && pendingSend.frameId === message.frameId) {
          const current = pendingSend;
          pendingSend = null;
          scheduler.clearTimeout(current.timeoutHandle);
          current.resolve({ kind: 'nack', reason: message.reason });
        }
        return;
      }
      default:
        return;
    }
  };

  /* ---------------- peer events --------------------------------------- */

  const handlePeerEvent = (event: PeerEvent): void => {
    if (closed) return;
    switch (event.type) {
      case 'connected':
        advanceTo('LIVE', { deviceId: ownPeerId });
        return;
      case 'stun-fallback':
        emit({ type: 'stun-fallback', attempt: event.attempt });
        return;
      case 'error':
        fatalSessionError(event.error);
        return;
      case 'offer':
      case 'answer':
        signalling?.send({ type: 'sdp', description: event.description });
        return;
      case 'ice':
        signalling?.send({ type: 'ice', candidate: event.candidate });
        return;
      case 'message':
        handlePairingMessage(event.message);
        return;
      case 'bytes': {
        if (pendingHeader === null) {
          emit({
            type: 'transfer-error',
            reason: 'A binary payload arrived with no frame-chunk header — nothing to assemble.',
          });
          return;
        }
        const header = pendingHeader;
        pendingHeader = null;
        void handleAssembly(header, event.data);
        return;
      }
      case 'malformed':
        emit({
          type: 'transfer-error',
          reason: `A malformed message arrived on the capture channel: ${event.raw.slice(0, 120)}`,
        });
        return;
      case 'channel-closed':
        settlePending({
          kind: 'closed',
          reason: 'The data channel closed during the transfer — the frame was not acknowledged.',
        });
        return;
      default:
        return;
    }
  };

  const ensurePeer = (): PairingPeer => {
    if (peer !== null) return peer;
    peer = createPairingPeer({
      role,
      createPeerConnection,
      ...(options.stunFallback !== undefined ? { stunFallback: options.stunFallback } : {}),
    });
    peer.on(handlePeerEvent);
    return peer;
  };

  /* ---------------- signalling events --------------------------------- */

  const handleSignalMessage = (message: SignalMessage): void => {
    switch (message.type) {
      case 'peer-joined': {
        ownPeerId = message.peerId;
        try {
          const instance = ensurePeer();
          // The host creates the offer — but only now that the room holds
          // two peers (an offer into an empty room is relayed nowhere).
          if (role === 'initiator') void instance.start().catch(() => undefined);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          emit({ type: 'transfer-error', reason });
          advanceTo('ERROR', { reason });
        }
        return;
      }
      case 'sdp': {
        try {
          void ensurePeer()
            .handleSignal({ description: message.description })
            .catch((error: unknown) => {
              emit({
                type: 'transfer-error',
                reason: `The signalling exchange failed — ${error instanceof Error ? error.message : String(error)}`,
              });
            });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          emit({ type: 'transfer-error', reason });
          advanceTo('ERROR', { reason });
        }
        return;
      }
      case 'ice': {
        if (peer === null) return; // ICE without a peer — nothing to feed
        void peer.handleSignal({ candidate: message.candidate }).catch(() => undefined);
        return;
      }
      default:
        return;
    }
  };

  const handleSignallingEvent = (event: SignallingEvent): void => {
    if (closed) return;
    switch (event.type) {
      case 'open':
        signallingStatus = 'open';
        emit({ type: 'signalling', status: 'open' });
        return;
      case 'message':
        handleSignalMessage(event.message);
        return;
      case 'malformed':
        emit({
          type: 'transfer-error',
          reason: `A malformed signalling frame arrived: ${event.raw.slice(0, 120)}`,
        });
        return;
      case 'reconnecting':
        signallingStatus = 'reconnecting';
        emit({ type: 'signalling', status: 'reconnecting' });
        return;
      case 'closed':
        signallingStatus = 'closed';
        emit({ type: 'signalling', status: 'closed' });
        return;
      case 'down':
        signallingStatus = 'down';
        emit({ type: 'signalling', status: 'down' });
        fatalSessionError(event.error);
        return;
      default:
        return;
    }
  };

  /* ---------------- outbound frames (sender side) ---------------------- */

  const sendIdle = (): void => {
    // Best effort: tells the receiver the attempt is over even on failure.
    peer?.sendCaptureState(createCaptureState('idle', undefined, now()));
  };

  const waitForAck = (frameId: string): Promise<AckOutcome> =>
    new Promise<AckOutcome>((resolve) => {
      const timeoutHandle = scheduler.setTimeout(() => {
        if (pendingSend !== null && pendingSend.frameId === frameId) {
          pendingSend = null;
          resolve({ kind: 'timeout' });
        }
      }, ackTimeoutMs);
      pendingSend = { frameId, timeoutHandle, resolve };
    });

  const sendFrame = async (
    data: Uint8Array | ArrayBuffer,
    frameId: string = createFrameId(),
  ): Promise<SendFrameResult> => {
    const fail = (reason: string): SendFrameResult => {
      emit({ type: 'transfer-error', reason, frameId });
      return { ok: false, reason };
    };

    if (sending) return fail('A frame transfer is already in progress — wait for it to settle.');
    if (closed) return fail('The pairing session is closed — start pairing again to capture.');
    if (machine.state !== 'LIVE' && machine.state !== 'CAPTURING' && machine.state !== 'STAGED') {
      return fail(`Cannot send a frame while pairing is ${machine.state}.`);
    }
    if (machine.isExpired(now())) {
      return fail('Session expired — the pairing window closed before the frame could be sent.');
    }
    if (peer === null) {
      return fail('The data channel is not open — pair a device before capturing.');
    }

    sending = true;
    try {
      let planned: PlannedFrame;
      try {
        // Hash once; retransmissions reuse the exact same bytes and digest.
        planned = await planFrameChunks(frameId, data);
      } catch (error) {
        return fail(`Frame could not be prepared — ${error instanceof Error ? error.message : String(error)}`);
      }
      emit({
        type: 'transfer',
        progress: tracker.start({ frameId, bytes: planned.bytes, chunkCount: planned.chunkCount }),
      });

      for (let attempt = 0; attempt <= frameRetries; attempt += 1) {
        if (!advanceTo('CAPTURING')) {
          return fail(`The pairing session ended before the frame could be sent (${machine.state}).`);
        }
        if (!peer.sendCaptureState(createCaptureState('capturing', frameId, now()))) {
          return fail('The data channel closed before the frame could start.');
        }

        let sentChunks = 0;
        for (const chunk of planned.chunks) {
          const headerOk = peer.sendFrameChunk(chunk.header);
          const payloadOk = headerOk && peer.sendFramePayload(chunk.payload);
          if (!headerOk || !payloadOk) {
            return fail(
              `Data channel closed mid-frame after ${sentChunks}/${planned.chunkCount} chunks.`,
            );
          }
          sentChunks += 1;
          const progress = tracker.onSent(chunk.header.index);
          if (progress) emit({ type: 'transfer', progress });
        }

        const outcome = await waitForAck(frameId);
        if (outcome.kind === 'ack') {
          advanceTo('STAGED');
          peer.sendCaptureState(createCaptureState('staged', frameId, now()));
          return { ok: true, frameId, bytes: planned.bytes, ackedBytes: outcome.ackedBytes };
        }
        if (outcome.kind === 'closed') {
          // Connection-level failure: peer/signalling events own the machine
          // state (ICE_FAILED etc. will land on their own).
          return fail(outcome.reason);
        }
        if (outcome.kind === 'nack' && attempt < frameRetries) {
          continue; // honest retransmission of the same verified-at-source bytes
        }
        sendIdle();
        advanceTo('LIVE');
        return outcome.kind === 'nack'
          ? fail(`Frame ${frameId} rejected by the receiver: ${outcome.reason}`)
          : fail(`Frame ${frameId} got no frame-ack within ${ackTimeoutMs} ms — the transfer failed.`);
      }
      return fail(`Frame ${frameId} was not acknowledged after ${frameRetries + 1} attempts.`);
    } finally {
      if (pendingSend !== null) {
        scheduler.clearTimeout(pendingSend.timeoutHandle);
        pendingSend = null;
      }
      sending = false;
    }
  };

  /* ---------------- lifecycle ----------------------------------------- */

  const start = (): void => {
    if (started || closed) return;
    started = true;
    try {
      const begun = machine.beginSession(now());
      if (!begun.ok) {
        emit({ type: 'transfer-error', reason: begun.reason });
        return;
      }
      emit({ type: 'state', state: 'PAIRING', at: now() });
      signalling = createSignallingClient({
        session: options.session,
        socketFactory,
        scheduler,
      });
      signalling.on(handleSignallingEvent);
      signalling.connect();
    } catch (error) {
      // Missing WebSocket/support — honest terminal state, no silent retry.
      const reason = error instanceof Error ? error.message : String(error);
      emit({ type: 'transfer-error', reason });
      advanceTo('ERROR', { reason });
    }
  };

  const tick = (): PairingTransitionResult | null => {
    const result = machine.tick(now());
    if (result !== null && result.ok) {
      emit({
        type: 'state',
        state: 'OFFLINE',
        reason: `Session expired after ${Math.round(ttlMs / 60000)} minute(s).`,
        at: now(),
      });
    }
    return result;
  };

  const close = (): void => {
    if (closed) return;
    settlePending({ kind: 'closed', reason: 'The pairing session closed during the transfer.' });
    if (signalling !== null) {
      signalling.send({ type: 'leave' }); // best effort — the relay closes the room either way
      signalling.close();
    }
    peer?.close();
    if (machine.state !== 'IDLE' && machine.can('OFFLINE')) {
      const fell = machine.send('OFFLINE', now());
      if (fell.ok) {
        emit({ type: 'state', state: 'OFFLINE', reason: 'Pairing closed by this device.', at: now() });
      }
    }
    closed = true;
    started = false;
  };

  return {
    get role() {
      return options.role;
    },
    session: options.session,
    get state() {
      return machine.state;
    },
    get signallingStatus() {
      return signallingStatus;
    },
    start,
    tick,
    sendFrame,
    close,
    on(handler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
