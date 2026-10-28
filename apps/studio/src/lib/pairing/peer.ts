/**
 * Pairing peer (T18) — WebRTC handshake over injected connections.
 *
 * Everything DOM-shaped is a narrow structural type (`PeerConnectionLike`,
 * `DataChannelLike`) with an injectable factory, so the protocol suite runs
 * two peers through a mock hub with **zero real network, zero real phone**.
 *
 * Connection strategy (honest about what we can and cannot claim):
 *   1. First attempt uses **host candidates only** (`iceServers: []`) —
 *      same-LAN devices connect directly, no third party involved.
 *   2. On `connectionState === 'failed'` we retry **once** with the public
 *      Google STUN server and emit `stun-fallback` so the UI can say so.
 *   3. A second failure is terminal: `ICE_FAILED`. We never loop forever and
 *      never claim connectivity we did not observe.
 *
 * The data channel is labelled `capture`. Inbound JSON frames are
 * `safeParse`d (`capture-state` / `frame-chunk`); malformed input surfaces
 * as `malformed` and is never coerced or thrown through the socket handler.
 * Inbound `ArrayBuffer` frames arrive verbatim as `bytes` events (binary
 * payloads are opaque to the parser), so the receive side can reassemble a
 * phone frame without any JSON decoding step.
 */
import {
  parsePairingMessage,
  type CaptureStateMessage,
  type FrameAckMessage,
  type FrameChunkHeader,
  type FrameNackMessage,
  type IceCandidateInit,
  type PairingMessage,
  type SessionDescriptionInit,
} from '../../types/pairing';
import { PairingError } from './errors';

export type PeerRole = 'initiator' | 'responder';

/** Channel label agreed in the spec — the only channel we open. */
export const CAPTURE_CHANNEL_LABEL = 'capture';

/** Public STUN fallback, used only after the host-only attempt fails. */
export const STUN_FALLBACK_URL = 'stun:stun.l.google.com:19302';

/* ------------------------------------------------------------------ *
 * injectable WebRTC surface (structural — the real classes satisfy it)
 * ------------------------------------------------------------------ */

export type DataChannelLike = {
  label: string;
  readyState: string;
  send(data: string | ArrayBuffer): void;
  close(): void;
  /** Mirrored frames arrive as `ArrayBuffer` when this is `'arraybuffer'`. */
  binaryType?: string | null;
  onopen: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
};

export type PeerConnectionLike = {
  connectionState: string;
  createDataChannel(label: string): DataChannelLike;
  createOffer(): Promise<SessionDescriptionInit>;
  createAnswer(): Promise<SessionDescriptionInit>;
  setLocalDescription(description: SessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: SessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: IceCandidateInit): Promise<void>;
  close(): void;
  onicecandidate: ((event: { candidate: IceCandidateInit | null }) => void) | null;
  ondatachannel: ((event: { channel: DataChannelLike }) => void) | null;
  onconnectionstatechange: (() => void) | null;
};

export type RTCPeerConnectionFactory = (config: {
  iceServers: { urls: string }[];
}) => PeerConnectionLike;

/* ------------------------------------------------------------------ *
 * events
 * ------------------------------------------------------------------ */

export type PeerEvent =
  | { type: 'offer'; description: SessionDescriptionInit }
  | { type: 'answer'; description: SessionDescriptionInit }
  | { type: 'ice'; candidate: IceCandidateInit }
  | { type: 'connected' }
  /** Host-only ICE failed; retrying once with the public STUN server. */
  | { type: 'stun-fallback'; attempt: number }
  | { type: 'error'; error: PairingError }
  | { type: 'message'; message: PairingMessage }
  | { type: 'malformed'; raw: string }
  /** One inbound binary frame chunk — opaque bytes, not JSON. */
  | { type: 'bytes'; data: ArrayBuffer }
  /** The capture channel closed (local or remote) — sends now fail closed. */
  | { type: 'channel-closed' };

export type PeerSignal = { description: SessionDescriptionInit } | { candidate: IceCandidateInit };

export type PairingPeer = {
  readonly role: PeerRole;
  readonly connectionState: string;
  /** Has the STUN retry already been spent? */
  readonly stunEngaged: boolean;
  /** Open the connection; the initiator also creates the channel + offer. */
  start(): Promise<void>;
  /** Feed one relayed signalling envelope (SDP or trickle ICE). */
  handleSignal(signal: PeerSignal): Promise<void>;
  /** Push a `capture-state` message; `false` when the channel is not open. */
  sendCaptureState(message: CaptureStateMessage): boolean;
  /** Push a `frame-chunk` header; `false` when the channel is not open. */
  sendFrameChunk(header: FrameChunkHeader): boolean;
  /** Push one binary payload chunk; `false` when the channel is not open. */
  sendFramePayload(payload: ArrayBuffer | Uint8Array): boolean;
  /** Push a `frame-ack`; `false` when the channel is not open. */
  sendFrameAck(ack: FrameAckMessage): boolean;
  /** Push a `frame-nack` (verification failed); `false` when not open. */
  sendFrameNack(nack: FrameNackMessage): boolean;
  /** Tear down the connection; further sends fail closed. */
  close(): void;
  /** Subscribe; returns the unsubscribe function. */
  on(handler: (event: PeerEvent) => void): () => void;
};

export type PairingPeerOptions = {
  role: PeerRole;
  createPeerConnection: RTCPeerConnectionFactory;
  /** Disable the STUN retry (tests that assert the first-failure path). */
  stunFallback?: boolean;
};

export function createPairingPeer(options: PairingPeerOptions): PairingPeer {
  const { role, createPeerConnection } = options;
  const stunFallback = options.stunFallback ?? true;

  const handlers = new Set<(event: PeerEvent) => void>();
  let pc: PeerConnectionLike | null = null;
  let channel: DataChannelLike | null = null;
  let stunEngaged = false;
  let closed = false;
  /** ICE candidates that arrived before the remote description. */
  let pendingCandidates: IceCandidateInit[] = [];
  let remoteDescriptionSet = false;

  const emit = (event: PeerEvent): void => {
    for (const handler of [...handlers]) handler(event);
  };

  const wireChannel = (next: DataChannelLike): void => {
    if (next.label !== CAPTURE_CHANNEL_LABEL) return;
    channel = next;
    // Deliver binary payloads as `ArrayBuffer` (not Blob) so the receive
    // side can reassemble synchronously.
    next.binaryType = 'arraybuffer';
    next.onclose = () => {
      // Only report a live channel's death — teardown-detached closes are
      // the local side's own doing and never surprise the session.
      if (channel !== next) return;
      channel = null;
      emit({ type: 'channel-closed' });
    };
    next.onmessage = (event) => {
      const raw = event?.data;
      if (typeof raw === 'string') {
        const message = parsePairingMessage(raw);
        if (message) emit({ type: 'message', message });
        else emit({ type: 'malformed', raw });
        return;
      }
      if (raw instanceof ArrayBuffer) {
        emit({ type: 'bytes', data: raw });
        return;
      }
      emit({ type: 'malformed', raw: String(raw) });
    };
  };

  const flushCandidates = async (): Promise<void> => {
    if (!pc || !remoteDescriptionSet) return;
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate);
    }
  };

  const sendOffer = async (): Promise<void> => {
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    emit({ type: 'offer', description: offer });
  };

  const handleConnectionStateChange = (): void => {
    if (!pc || closed) return;
    const state = pc.connectionState;
    if (state === 'connected') {
      emit({ type: 'connected' });
      return;
    }
    if (state !== 'failed') return; // 'disconnected' is transient — wait

    if (stunFallback && !stunEngaged) {
      // Attempt 1 (host-only) failed → rebuild once with STUN.
      stunEngaged = true;
      emit({ type: 'stun-fallback', attempt: 1 });
      teardownPc();
      createPc();
      if (role === 'initiator') void sendOffer().catch(() => undefined);
      return;
    }
    emit({ type: 'error', error: new PairingError('ICE_FAILED') });
  };

  const createPc = (): PeerConnectionLike => {
    const next = createPeerConnection({
      iceServers: stunEngaged ? [{ urls: STUN_FALLBACK_URL }] : [],
    });
    pc = next;
    remoteDescriptionSet = false;
    pendingCandidates = [];

    next.onicecandidate = (event) => {
      if (event?.candidate) emit({ type: 'ice', candidate: event.candidate });
      // `null` = end-of-candidates; nothing to relay.
    };
    next.ondatachannel = (event) => {
      if (event?.channel) wireChannel(event.channel);
    };
    next.onconnectionstatechange = handleConnectionStateChange;

    if (role === 'initiator') {
      wireChannel(next.createDataChannel(CAPTURE_CHANNEL_LABEL));
    }
    return next;
  };

  const teardownPc = (): void => {
    if (!pc) return;
    pc.onicecandidate = null;
    pc.ondatachannel = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      // Already dead — teardown must not throw.
    }
    pc = null;
    channel = null;
  };

  /**
   * One honest send: `false` when the channel is missing, not open, or the
   * underlying `send` throws (a channel the remote side just closed raises
   * `InvalidStateError` in real browsers — never let that escape through a
   * caller's loop).
   */
  const trySend = (data: string | ArrayBuffer): boolean => {
    if (!channel || channel.readyState !== 'open') return false;
    try {
      channel.send(data);
      return true;
    } catch {
      return false;
    }
  };

  return {
    get role() {
      return role;
    },
    get connectionState() {
      return pc?.connectionState ?? 'closed';
    },
    get stunEngaged() {
      return stunEngaged;
    },

    async start(): Promise<void> {
      if (closed) return;
      if (!pc) createPc();
      if (role === 'initiator') await sendOffer();
      // The responder waits for the relayed offer — nothing to send yet.
    },

    async handleSignal(signal: PeerSignal): Promise<void> {
      if (closed) return;
      const conn = pc ?? createPc();

      if ('candidate' in signal) {
        if (remoteDescriptionSet) await conn.addIceCandidate(signal.candidate);
        else pendingCandidates.push(signal.candidate);
        return;
      }

      await conn.setRemoteDescription(signal.description);
      remoteDescriptionSet = true;
      await flushCandidates();

      if (signal.description.type === 'offer') {
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        emit({ type: 'answer', description: answer });
      }
      // An answer completes the exchange; ICE candidates flow from here.
    },

    /**
     * Sends fail closed (`false`) when the channel is missing, not open, or
     * the underlying `send` throws — never thrown through the caller.
     */
    sendCaptureState(message: CaptureStateMessage): boolean {
      return trySend(JSON.stringify(message));
    },

    sendFrameChunk(header: FrameChunkHeader): boolean {
      return trySend(JSON.stringify(header));
    },

    sendFramePayload(payload: ArrayBuffer | Uint8Array): boolean {
      // slice() yields an ArrayBuffer covering exactly this chunk even when
      // the input view aliases a larger frame buffer.
      return trySend(payload instanceof Uint8Array ? payload.slice().buffer : payload);
    },

    sendFrameAck(ack: FrameAckMessage): boolean {
      return trySend(JSON.stringify(ack));
    },

    sendFrameNack(nack: FrameNackMessage): boolean {
      return trySend(JSON.stringify(nack));
    },

    close(): void {
      closed = true;
      teardownPc();
    },

    on(handler: (event: PeerEvent) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
