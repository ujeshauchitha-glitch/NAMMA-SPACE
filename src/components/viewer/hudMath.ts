/**
 * T17 · pure HUD math.
 *
 * Lives in its own module for two reasons:
 *  1. `react-refresh/only-export-components` warns when a `.tsx` component file
 *     exports anything that is not a component — keeping the helpers here lets
 *     `Hud.tsx` / `CompassRose.tsx` stay component-only.
 *  2. vitest runs without jsdom in this repo, so the logic must be exercisable
 *     as plain functions with no DOM and no React renderer.
 */

/** Live-region commit cadence: at most one update every 2 s (AC 4). */
export const LIVE_ALT_THROTTLE_MS = 2000;

export type ThrottleDecision = {
  /** Commit the latest text to the live region now. */
  commit: boolean;
  /** Timestamp to store as the last commit. */
  nextLastCommitAt: number;
  /** Delay until the pending commit, or null when nothing is scheduled. */
  waitMs: number | null;
};

/**
 * Decide whether a throttled live-region text may commit at `now`.
 *
 * A commit is allowed when at least `intervalMs` has elapsed since the last
 * one; otherwise the caller keeps its existing timer and waits `waitMs`.
 * Deliberately stateless — the caller owns `lastCommitAt` so the effect can
 * stay idempotent across re-renders.
 */
export function throttleDecision(
  lastCommitAt: number,
  now: number,
  intervalMs: number = LIVE_ALT_THROTTLE_MS,
): ThrottleDecision {
  const elapsed = now - lastCommitAt;
  if (elapsed >= intervalMs) {
    return { commit: true, nextLastCommitAt: now, waitMs: null };
  }
  return { commit: false, nextLastCommitAt: lastCommitAt, waitMs: intervalMs - elapsed };
}

/**
 * Compass needle rotation for a PlayCanvas camera yaw, in degrees.
 *
 * PlayCanvas yaw `ψ` is the pivot's world euler-Y. The camera faces
 * `(-sin ψ, 0, -cos ψ)` and its right vector is `(cos ψ, 0, -sin ψ)`.
 * Taking world north as `-Z` — the camera's forward at `startYawDegrees: 0`,
 * and east as `+X` — north projects onto the camera-relative screen as
 * `(sin ψ, -cos ψ)`. A needle drawn pointing up `(0, -1)` lands on exactly
 * that direction after a CSS `rotate(ψ)`, so the needle carries the yaw
 * unchanged.
 *
 * Sanity checks: `ψ = 0` → needle up (facing north); `ψ = -90°` (facing east)
 * → needle left (north is to your left); `ψ = +90°` (facing west) → needle
 * right.
 *
 * Rotation is data, not decoration — it is intentionally not suppressed under
 * `prefers-reduced-motion`.
 */
export function roseRotation(yawDegrees: number): number {
  return yawDegrees;
}
