/**
 * Pairing state machine (T18) — a thin, testable façade over the T9 kernel.
 *
 * The canonical state set and the legal-transition table live in
 * `src/state/{types,reducer}.ts`; this module **imports** them and never
 * redefines synonyms (`CONNECTED`, `PAIRED`, … do not exist). The one piece
 * of protocol logic it owns is the **10-minute session countdown**, which is
 * the source of truth for expiry:
 *
 *   - `beginSession(at)` mints `expiresAt = at + ttl` and enters `PAIRING`;
 *   - while the session is still active, an elapsed countdown makes `send()`
 *     refuse every target except `OFFLINE` — you cannot keep capturing into
 *     a dead session;
 *   - `tick(at)` performs the actual fall to `OFFLINE` from any active
 *     state; `IDLE`/`ERROR`/`OFFLINE` are left alone and report honestly.
 *
 * Handshake completion maps to `LIVE` (the canonical set has no
 * `CONNECTED`); the protocol test documents that mapping where it fires.
 */
import { PAIRING_STATES, type PairingState } from '../../state/types';
import { PAIRING_TRANSITIONS, illegalPairingReason } from '../../state/reducer';

/** Session lifetime: the 10-minute countdown from the spec. */
export const SESSION_TTL_MS = 10 * 60 * 1000;

export type PairingTransitionResult =
  | { ok: true; state: PairingState }
  | { ok: false; reason: string };

export type PairingMachine = {
  /** Current canonical state. */
  readonly state: PairingState;
  /** When the active session dies, or `null` when no session is running. */
  readonly expiresAt: number | null;
  /** Would `send(to)` be accepted? Pure lookup, no clock involved. */
  can(to: PairingState): boolean;
  /** Attempt a transition; illegal ones are rejected with an honest reason. */
  send(to: PairingState, at: number): PairingTransitionResult;
  /** Mint a session and enter `PAIRING` (renews an expired one). */
  beginSession(at: number): PairingTransitionResult;
  /** Ms left in the session, `0` once expired, `null` with no session. */
  remainingMs(at: number): number | null;
  /** Has the countdown elapsed? `false` when no session is running. */
  isExpired(at: number): boolean;
  /**
   * Advance the countdown. Returns the forced `OFFLINE` transition when the
   * session just expired, or `null` when nothing changed.
   */
  tick(at: number): PairingTransitionResult | null;
};

export type PairingMachineOptions = {
  initial?: PairingState;
  ttlMs?: number;
};

export function createPairingMachine(options: PairingMachineOptions = {}): PairingMachine {
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  let state: PairingState = options.initial ?? 'IDLE';
  let expiresAt: number | null = null;

  const apply = (to: PairingState): PairingTransitionResult => {
    state = to;
    return { ok: true, state };
  };

  const reject = (reason: string): PairingTransitionResult => ({ ok: false, reason });

  const expiredAt = (at: number): boolean => expiresAt !== null && at >= expiresAt;

  /** The four states in which a live session is actually doing work. */
  const isActive = (candidate: PairingState): boolean =>
    candidate === 'PAIRING' || candidate === 'LIVE' || candidate === 'CAPTURING' || candidate === 'STAGED';

  return {
    get state() {
      return state;
    },
    get expiresAt() {
      return expiresAt;
    },

    can(to: PairingState): boolean {
      return PAIRING_TRANSITIONS[state].includes(to);
    },

    send(to: PairingState, at: number): PairingTransitionResult {
      // Expiry outranks the transition table: an elapsed session that is
      // still active may only fall to OFFLINE, never continue as if the
      // countdown never ran. A machine that already fell (or never started)
      // is governed by the table alone — `beginSession` renews the clock.
      if (expiredAt(at) && isActive(state) && to !== 'OFFLINE') {
        return reject(
          `Session expired after ${Math.round(ttlMs / 60000)} minutes — only OFFLINE is reachable from ${state}.`,
        );
      }
      const reason = illegalPairingReason(state, to);
      if (reason !== null) return reject(reason);
      return apply(to);
    },

    beginSession(at: number): PairingTransitionResult {
      const reason = illegalPairingReason(state, 'PAIRING');
      if (reason !== null) return reject(reason);
      // Renew only on success — a rejected attempt must not kill a running
      // session's countdown.
      expiresAt = at + ttlMs;
      return apply('PAIRING');
    },

    remainingMs(at: number): number | null {
      if (expiresAt === null) return null;
      return Math.max(0, expiresAt - at);
    },

    isExpired(at: number): boolean {
      return expiredAt(at);
    },

    tick(at: number): PairingTransitionResult | null {
      if (!expiredAt(at)) return null;
      // Only active states fall; IDLE never entered the session, ERROR
      // already reported a failure, OFFLINE has fallen already.
      if (!isActive(state)) return null;
      return apply('OFFLINE');
    },
  };
}

export { PAIRING_STATES };
export type { PairingState };
