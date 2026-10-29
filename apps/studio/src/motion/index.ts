/**
 * T23 · motion registry (pure core) — the single source of truth for the
 * reduced-motion decision, the one duration gate, and kill-path bookkeeping.
 *
 * No DOM, no gsap, no engine: everything here node-tests without a browser
 * (tests/motion-reduced.test.ts). The browser wiring (PlayCanvasViewer's
 * `prefersReducedMotion()`, the engine/visualizer duration helpers) delegates
 * into this module, so the "instant cut under reduced motion" contract lives
 * in exactly one place (`momentDuration`).
 *
 * ========================================================================
 * REMAINING T23 WORK — the 12 §7.3 visual moments are NOT implemented here.
 * This file is the testable pure core + one proof-of-integration wiring
 * (PlayCanvasViewer). The moments below still need their component wiring,
 * a lazy dynamic `import('gsap')` (kept out of the static graph on purpose),
 * and browser/e2e verification under T24 (`emulateMedia({ reducedMotion:
 * 'reduce' })` — unit tests cannot see transform/opacity/FLIP outcomes):
 *
 *   1. Workspace reveal — Flip underline
 *   2. Room creation — FLIP reorder
 *   3. Image→group ghost + chip pulse + count roll
 *   4. Coverage wipe
 *   5. Scene transition — engine crossfade + 900 ms settle ease + HUD rise
 *   6. POI select pulse (engine-side pulseSelection exists; the DOM moment
 *      and its e2e reduced-motion assertion remain)
 *   7. Camera jump-to (delegates the T15 engine tween — wired above the
 *      registry, but the choreography moment list stays open)
 *   8. Route reveal (delegates tape progress)
 *   9. Pairing stage advance
 *  10. Processing-stage ticks
 *  11. Toast
 *  12. Modal
 *
 * Until then `gsap` stays a documented vacuous-dependency EXCEPTION in
 * scripts/check_chunks.py (declared but unimported — honest, not gamed; do
 * NOT add a fake import to silence the check).
 * ========================================================================
 */

/**
 * The preference decision (§7.4). The caller owns the environment lookup
 * (matchMedia guard, SSR safety); this registry owns the decision, so any
 * future policy (e.g. per-surface overrides) changes in one place.
 */
export function resolveMotionPrefersReduced(matchMediaResult: boolean): boolean {
  return matchMediaResult;
}

/**
 * The ONE duration gate: 0 ms (instant cut) under reduced motion, otherwise
 * the designed base clamped to a non-negative duration. Every moment helper
 * and legacy duration function routes through this.
 */
export function momentDuration(baseMs: number, prefersReduced: boolean): number {
  return prefersReduced ? 0 : Math.max(0, baseMs);
}

export type MotionController = {
  /**
   * Register a kill function; returns an untrack that kills + unregisters.
   * The kill fires at most once per track regardless of call order (untrack
   * after killAll, killAll after untrack, repeated untrack) — StrictMode
   * double-invocation safe by construction.
   */
  track(kill: () => void): () => void;
  /** Kill every live entry and clear the registry. Safe on an empty registry. */
  killAll(): void;
  /** Number of tracked, not-yet-killed entries (bookkeeping for tests). */
  liveCount(): number;
};

type KillEntry = { kill: () => void; killed: boolean };

/**
 * Kill-path bookkeeping for choreographed moments: components `track()` the
 * teardown of each in-flight animation and call the returned untrack when it
 * settles naturally, so unmount / pointer-lock / user camera input can
 * `killAll()` without double-killing settled motions.
 */
export function createMotionController(): MotionController {
  const live = new Set<KillEntry>();
  return {
    track(kill) {
      const entry: KillEntry = { kill, killed: false };
      live.add(entry);
      return () => {
        if (entry.killed) return;
        entry.killed = true;
        live.delete(entry);
        kill();
      };
    },
    killAll() {
      for (const entry of [...live]) {
        live.delete(entry);
        if (entry.killed) continue;
        entry.killed = true;
        entry.kill();
      }
    },
    liveCount: () => live.size,
  };
}
