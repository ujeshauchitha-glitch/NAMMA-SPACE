/**
 * T19 — insecure-context verdict for pairing (§9.2).
 *
 * A phone camera peer needs `getUserMedia`, which browsers gate behind a
 * secure context. On plain-HTTP LAN origins `window.isSecureContext` is
 * `false`, so pairing cannot honestly pretend to be available.
 *
 * This is a **UI-derived presentation verdict only** — `blocked` is never a
 * canonical pairing machine state; the T18 machine and its states are
 * untouched. `undefined` (SSR, tests, `window` absent) and `true` both mean
 * "not blocked": absence of evidence is never reported as a block.
 */

/** Exact remedy copy shown to the operator (see T19/T20 contract). */
export const INSECURE_CONTEXT_REMEDY = 'Run `npm run dev:lan` — phone cameras require HTTPS.';

/**
 * Derive the presentation verdict from `window.isSecureContext`.
 * Only an explicit `false` blocks; `true`/`undefined` do not.
 */
export function isSecureContextBlocked(isSecureContext: boolean | undefined): boolean {
  return isSecureContext === false;
}

/** Read the current context honestly: absent `window` → `undefined`. */
export function readIsSecureContext(): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.isSecureContext;
}
