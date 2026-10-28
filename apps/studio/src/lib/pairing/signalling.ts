/**
 * Signalling client (T18) — `/ws?session=TOKEN`, join → `peer-joined` →
 * SDP/ICE relay, with reconnect and honest exhaustion.
 *
 * The socket is injected (`SocketFactory`), so the protocol suite drives the
 * whole handshake through an in-memory hub with zero real network. The
 * scheduler is injected too: backoff delays are *data*, not wall-clock waits.
 *
 * Reconnect policy: deterministic ladder `[250, 500, 1000, 2000, 4000]` ms,
 * at most `maxAttempts` re-connections after the first socket. Every close
 * that we did not ask for counts; when the ladder is spent the client goes
 * `down` and emits `SIGNALING_DOWN` — it never pretends to still be online.
 */
import { parseSignalMessage, type SignalMessage } from '../../types/pairing';
import { PairingError } from './errors';

/** Subset of the DOM `WebSocket` surface this client relies on. */
export type SignallingSocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
};

export type SocketFactory = (url: string) => SignallingSocket;

/** Injectable timer seam — tests flush the backoff ladder manually. */
export type Scheduler = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type SignallingStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'down';

export type SignallingEvent =
  | { type: 'open' }
  | { type: 'message'; message: SignalMessage }
  | { type: 'malformed'; raw: string }
  | { type: 'reconnecting'; attempt: number; delayMs: number }
  | { type: 'closed' }
  | { type: 'down'; error: PairingError };

export type SignallingDeps = {
  /** Room key carried in the query string. */
  session: string;
  /** Injected socket constructor (the T19 relay in production). */
  socketFactory: SocketFactory;
  /** Signalling path; `/ws` matches the T19 plugin route. */
  path?: string;
  /** Origin prefix — `''` keeps the relative URL the test hub expects. */
  baseUrl?: string;
  scheduler?: Scheduler;
  /** Backoff ladder in ms; the last entry repeats if attempts run longer. */
  backoffMs?: readonly number[];
  /** Reconnections allowed after the first socket; exhausted → `down`. */
  maxAttempts?: number;
};

export type SignallingClient = {
  readonly status: SignallingStatus;
  readonly url: string;
  /** Open the socket (no-op while connecting/open/reconnecting). */
  connect(): void;
  /** Intentional close — never counted as a failure, never retried. */
  close(): void;
  /** Send one envelope; `false` means it was dropped (not open). */
  send(message: SignalMessage): boolean;
  /** Subscribe; returns the unsubscribe function. */
  on(handler: (event: SignallingEvent) => void): () => void;
};

const SOCKET_OPEN = 1;
const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 4000] as const;
const DEFAULT_MAX_ATTEMPTS = 5;

const defaultScheduler: Scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSignallingClient(deps: SignallingDeps): SignallingClient {
  const path = deps.path ?? '/ws';
  const baseUrl = deps.baseUrl ?? '';
  const scheduler = deps.scheduler ?? defaultScheduler;
  const backoffMs = deps.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const url = `${baseUrl}${path}?session=${encodeURIComponent(deps.session)}`;

  const handlers = new Set<(event: SignallingEvent) => void>();
  let socket: SignallingSocket | null = null;
  let timer: unknown = null;
  let attempts = 0;
  let intentional = false;
  let status: SignallingStatus = 'idle';

  const emit = (event: SignallingEvent): void => {
    for (const handler of [...handlers]) handler(event);
  };

  const sendRaw = (message: SignalMessage): boolean => {
    if (!socket || socket.readyState !== SOCKET_OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  const scheduleReconnect = (): void => {
    if (intentional) return;
    if (attempts >= maxAttempts) {
      status = 'down';
      emit({ type: 'down', error: new PairingError('SIGNALING_DOWN') });
      return;
    }
    const delayMs = backoffMs[Math.min(attempts, backoffMs.length - 1)];
    attempts += 1;
    status = 'reconnecting';
    emit({ type: 'reconnecting', attempt: attempts, delayMs });
    timer = scheduler.setTimeout(() => {
      timer = null;
      openSocket();
    }, delayMs);
  };

  function openSocket(): void {
    timer = null;
    if (intentional) return;
    status = attempts === 0 ? 'connecting' : 'reconnecting';

    let ended = false;
    const current = deps.socketFactory(url);
    socket = current;

    // Both `onclose` and `onerror` may fire for one failure — `ended`
    // collapses them into a single reconnect decision.
    const end = (): void => {
      if (ended) return;
      ended = true;
      if (socket === current) socket = null;
      if (intentional) {
        if (status !== 'closed') {
          status = 'closed';
          emit({ type: 'closed' });
        }
        return;
      }
      scheduleReconnect();
    };

    current.onopen = () => {
      if (ended) return;
      attempts = 0; // a live socket resets the ladder
      status = 'open';
      emit({ type: 'open' });
      sendRaw({ type: 'join', session: deps.session });
    };

    current.onmessage = (event) => {
      if (ended) return;
      const raw = typeof event?.data === 'string' ? event.data : '';
      const message = parseSignalMessage(raw);
      if (message) emit({ type: 'message', message });
      else emit({ type: 'malformed', raw });
    };

    current.onclose = end;
    current.onerror = end;
  }

  return {
    get status() {
      return status;
    },
    url,

    connect(): void {
      if (status === 'connecting' || status === 'open' || status === 'reconnecting') return;
      intentional = false;
      attempts = 0;
      openSocket();
    },

    close(): void {
      if (status === 'closed') return;
      intentional = true;
      if (timer !== null) {
        scheduler.clearTimeout(timer);
        timer = null;
      }
      const current = socket;
      socket = null;
      status = 'closed';
      try {
        current?.close(1000, 'client closed');
      } catch {
        // A socket that refuses to close is still closed from our side.
      }
      emit({ type: 'closed' });
    },

    send(message: SignalMessage): boolean {
      return sendRaw(message);
    },

    on(handler: (event: SignallingEvent) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
