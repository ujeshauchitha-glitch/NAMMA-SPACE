/**
 * Pairing protocol barrel (T18) — one import surface for the pairing core.
 *
 * The core is DOM-independent: sockets, peer connections, timers and
 * WebCrypto are all injected, so anything reachable from here is testable
 * without a browser, a phone, or a network.
 */
export {
  SESSION_TOKEN_PATTERN,
  generateSessionToken,
  isSessionToken,
  type CryptoLike,
  type TokenOptions,
} from './token';

export {
  PAIRING_ERROR_MESSAGES,
  PairingError,
  type PairingErrorCode,
} from './errors';

export {
  PAIRING_STATES,
  SESSION_TTL_MS,
  createPairingMachine,
  type PairingMachine,
  type PairingMachineOptions,
  type PairingTransitionResult,
} from './machine';

export {
  createSignallingClient,
  type Scheduler,
  type SignallingClient,
  type SignallingDeps,
  type SignallingEvent,
  type SignallingSocket,
  type SignallingStatus,
  type SocketFactory,
} from './signalling';

export {
  CAPTURE_CHANNEL_LABEL,
  STUN_FALLBACK_URL,
  createPairingPeer,
  type DataChannelLike,
  type PairingPeer,
  type PairingPeerOptions,
  type PeerConnectionLike,
  type PeerEvent,
  type PeerRole,
  type PeerSignal,
  type RTCPeerConnectionFactory,
} from './peer';

export {
  CaptureStateSchema,
  FrameAckSchema,
  FrameChunkHeaderSchema,
  FrameNackSchema,
  IceCandidateSchema,
  PairingMessageSchema,
  SessionDescriptionSchema,
  SignalMessageSchema,
  parsePairingMessage,
  parseSignalMessage,
  type CaptureStateMessage,
  type FrameAckMessage,
  type FrameChunkHeader,
  type FrameNackMessage,
  type IceCandidateInit,
  type PairingMessage,
  type SessionDescriptionInit,
  type SignalMessage,
} from '../../types/pairing';

export {
  FRAME_CHUNK_BYTES,
  createCaptureState,
  createFrameAck,
  createFrameAssembler,
  planFrameChunks,
  type FrameAssemblyResult,
  type FrameAssembler,
  type PlanFrameOptions,
  type PlannedChunk,
  type PlannedFrame,
} from './messages';

export {
  INSECURE_CONTEXT_REMEDY,
  isSecureContextBlocked,
  readIsSecureContext,
} from './secure-context';

export {
  createPairingSession,
  type PairingSession,
  type PairingSessionEvent,
  type PairingSessionOptions,
  type PairingSessionRole,
  type ReceivedFrame,
  type SendFrameResult,
} from './session';

export { legalPairingPath, pairingSyncActions } from './rail-sync';

export {
  createPairingSyncBridge,
  type PairingSyncBridge,
  type PairingSyncBridgeOptions,
} from './bridge';
