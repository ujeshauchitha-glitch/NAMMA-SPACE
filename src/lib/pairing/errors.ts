/**
 * Pairing failure taxonomy (T18) — exactly three codes, no synonyms.
 *
 * §9.1 voice: honest remedy, never blame, never a silent degradation. The
 * UI (T20/T22) maps these codes to copy; the strings here are the technical
 * detail that travels with the error, not the final on-screen sentence.
 */
export type PairingErrorCode =
  /** WebCrypto unavailable — the page is not a secure context (HTTP on LAN). */
  | 'NO_SECURE_CONTEXT'
  /** Signalling socket closed and every reconnect attempt was exhausted. */
  | 'SIGNALING_DOWN'
  /** ICE never connected, even after the documented STUN fallback. */
  | 'ICE_FAILED';

export const PAIRING_ERROR_MESSAGES: Readonly<Record<PairingErrorCode, string>> = {
  NO_SECURE_CONTEXT:
    'Secure random is unavailable — this page is not a secure context. ' +
    'Run `npm run dev:lan` (HTTPS) or open the app on localhost.',
  SIGNALING_DOWN:
    'The signalling connection dropped and could not be re-established — ' +
    'the session is unreachable until the relay is back.',
  ICE_FAILED:
    'A direct peer connection could not be established, even with the public STUN fallback — ' +
    'both devices may be on isolated networks.',
};

export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode, message: string = PAIRING_ERROR_MESSAGES[code], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PairingError';
    this.code = code;
  }
}
