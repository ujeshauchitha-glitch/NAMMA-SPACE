/**
 * Pure tween math for the additive engine motion API (T15).
 *
 * No DOM, no PlayCanvas imports — everything the gem's tweens need to be
 * unit-tested without touching PlayCanvasViewer control flow (D-013):
 * progress accumulation, cancellation semantics, easing, angle-safe
 * interpolation, and route-tape draw-progress mapping.
 *
 * Cancellation contract: a cancelled tween reports `done: true` with
 * `progress: 0` — the caller abandons the motion at its current state and
 * can never accidentally "finish" a motion the user killed.
 */

import { momentDuration } from '../motion';

export type Tween = {
  elapsedMs: number;
  durationMs: number;
  cancelled: boolean;
};

export type TweenStep = {
  tween: Tween;
  /** Raw linear progress in [0, 1] (0 for a cancelled tween). */
  progress: number;
  /** True when finished (completion or cancellation). */
  done: boolean;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Create a tween; negative durations normalize to 0 (instant cut). */
export function createTween(durationMs: number): Tween {
  return { elapsedMs: 0, durationMs: Math.max(0, durationMs), cancelled: false };
}

/** Kill a tween — sticky: every later advance stays cancelled at progress 0. */
export function cancelTween(tween: Tween): Tween {
  return { ...tween, cancelled: true };
}

/**
 * Reduced motion resolves a tween's base duration: instant cut (0 ms) vs the
 * designed duration (the engine owns the matchMedia lookup, this owns math).
 * Delegates to the T23 registry so the gate exists in exactly one place.
 */
export function resolveTweenDuration(baseMs: number, reducedMotion: boolean): number {
  return momentDuration(baseMs, reducedMotion);
}

/** Advance by a non-negative delta; returns raw progress for the caller to ease. */
export function advanceTween(tween: Tween, deltaMs: number): TweenStep {
  if (tween.cancelled) return { tween, progress: 0, done: true };
  const elapsedMs = tween.elapsedMs + Math.max(0, deltaMs);
  const done = elapsedMs >= tween.durationMs;
  const progress = done || tween.durationMs === 0 ? 1 : elapsedMs / tween.durationMs;
  return {
    tween: { ...tween, elapsedMs: Math.min(elapsedMs, tween.durationMs) },
    progress,
    done,
  };
}

/** Camera settle ease (§7): expo out — fast start, soft landing. */
export function easeOutExpo(t: number): number {
  const c = clamp01(t);
  if (c === 1) return 1;
  return 1 - 2 ** (-10 * c);
}

/** Tape reveal ease (§7): in-out cubic — slow draw from both ends of the feel. */
export function easeInOutCubic(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/** Interpolate degrees along the shortest arc (yaw/pitch never spin the long way). */
export function lerpAngleDeg(from: number, to: number, t: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta * clamp01(t);
}

/**
 * Route-tape draw progress: how many segments are visible at eased progress
 * `p`. Rounds up so the tape never stalls a frame at the head of the draw.
 */
export function revealCount(p: number, totalSegments: number): number {
  if (totalSegments <= 0) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return totalSegments;
  return Math.ceil(p * totalSegments);
}
