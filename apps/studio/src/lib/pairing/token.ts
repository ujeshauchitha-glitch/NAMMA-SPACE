/**
 * Session token generator (T18) — `NS-XXXX`, crypto-random.
 *
 * Four uppercase alphanumerics drawn with rejection sampling so the modulo
 * never biases the alphabet (byte % 36 is only used for bytes < 252). The
 * token is the room key for `/ws?session=TOKEN` and the QR payload (T20):
 * 36^4 ≈ 1.7 M combinations, refreshed explicitly by the operator — never
 * silently rotated under a scanning phone (DESIGN_HANDOFF §QR).
 *
 * `crypto` is injectable so the NO_SECURE_CONTEXT branch is testable in
 * Node, where `globalThis.crypto` always exists:
 *   - omitted / `undefined` → fall back to `globalThis.crypto`;
 *   - `null`                → explicitly disable the fallback.
 */
import { PairingError } from './errors';

/** Canonical token shape: `NS-` + 4 uppercase alphanumerics. */
export const SESSION_TOKEN_PATTERN = /^NS-[A-Z0-9]{4}$/;

const TOKEN_BODY_LENGTH = 4;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Largest multiple of 36 that fits in a byte — bytes ≥ this are redrawn. */
const REJECTION_CEILING = 252;

/** The subset of WebCrypto this module needs (real `Crypto` satisfies it). */
export type CryptoLike = {
  getRandomValues(array: Uint8Array): Uint8Array;
};

export type TokenOptions = {
  /** `null` disables the `globalThis.crypto` fallback (test seam). */
  crypto?: CryptoLike | null;
};

function resolveCrypto(options?: TokenOptions): CryptoLike | null {
  if (options && options.crypto !== undefined) return options.crypto;
  return (globalThis.crypto as CryptoLike | undefined) ?? null;
}

/** Generate a fresh `NS-XXXX` session token. Throws `NO_SECURE_CONTEXT`. */
export function generateSessionToken(options?: TokenOptions): string {
  const source = resolveCrypto(options);
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new PairingError('NO_SECURE_CONTEXT');
  }

  const body: string[] = [];
  const buffer = new Uint8Array(TOKEN_BODY_LENGTH * 2);
  while (body.length < TOKEN_BODY_LENGTH) {
    source.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= REJECTION_CEILING) continue; // redraw — keeps the alphabet uniform
      body.push(ALPHABET[byte % ALPHABET.length]);
      if (body.length === TOKEN_BODY_LENGTH) break;
    }
  }
  return `NS-${body.join('')}`;
}

/** Shape check only — never a substitute for server-side room validation. */
export function isSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}
