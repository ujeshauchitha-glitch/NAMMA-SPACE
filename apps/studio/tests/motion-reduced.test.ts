import { describe, expect, it, vi } from 'vitest';
import {
  createMotionController,
  momentDuration,
  resolveMotionPrefersReduced,
} from '../src/motion';
import { resolveTweenDuration } from '../src/engine/tween';
import { resolveVisualizerDuration } from '../src/lib/scan/scene3d';

/**
 * T23 pure core · motion registry (reduced-motion decision, single duration
 * gate, kill-path bookkeeping). No DOM, no gsap, no engine — the browser
 * wiring (PlayCanvasViewer, gsap moment helpers) rides on these seams and is
 * verified by the T24 e2e reduced-motion spec.
 */

describe('resolveMotionPrefersReduced — decision table', () => {
  it.each([
    { matchMediaResult: true, expected: true },
    { matchMediaResult: false, expected: false },
  ])('matchMedia=$matchMediaResult → prefersReduced=$expected', ({ matchMediaResult, expected }) => {
    expect(resolveMotionPrefersReduced(matchMediaResult)).toBe(expected);
  });
});

describe('momentDuration — the one gate (0 under reduced, else max(0, base))', () => {
  it.each([0, 1, 120, 360, 600, 700, 900, 1500])('base=%ims keeps its base when motion is allowed', (baseMs) => {
    expect(momentDuration(baseMs, false)).toBe(baseMs);
  });

  it.each([0, 1, 120, 360, 600, 700, 900, 1500])('base=%ims collapses to 0 under reduced motion', (baseMs) => {
    expect(momentDuration(baseMs, true)).toBe(0);
  });

  it('clamps negative bases to 0 when motion is allowed (instant cut, never negative)', () => {
    expect(momentDuration(-10, false)).toBe(0);
    expect(momentDuration(-10, true)).toBe(0);
  });
});

describe('createMotionController — kill-path bookkeeping', () => {
  it('track() registers a kill and returns an untrack that kills exactly once', () => {
    const controller = createMotionController();
    const kill = vi.fn();
    const untrack = controller.track(kill);

    expect(controller.liveCount()).toBe(1);
    expect(kill).not.toHaveBeenCalled();

    untrack();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(controller.liveCount()).toBe(0);
  });

  it('is idempotent under double-kill (StrictMode-safe): a second untrack call does nothing', () => {
    const controller = createMotionController();
    const kill = vi.fn();
    const untrack = controller.track(kill);

    untrack();
    untrack();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(controller.liveCount()).toBe(0);
  });

  it('killAll() kills every live entry and clears the registry', () => {
    const controller = createMotionController();
    const first = vi.fn();
    const second = vi.fn();
    controller.track(first);
    controller.track(second);
    expect(controller.liveCount()).toBe(2);

    controller.killAll();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(controller.liveCount()).toBe(0);
  });

  it('never kills twice in any order: untrack after killAll, and killAll after untrack', () => {
    const controller = createMotionController();
    const viaKillAll = vi.fn();
    const viaUntrack = vi.fn();
    const untrack = controller.track(viaUntrack);
    controller.track(viaKillAll);

    controller.killAll();
    untrack(); // already killed by killAll — must not re-fire
    controller.killAll(); // empty registry — must be a safe no-op

    expect(viaKillAll).toHaveBeenCalledTimes(1);
    expect(viaUntrack).toHaveBeenCalledTimes(1);
    expect(controller.liveCount()).toBe(0);
  });

  it('a fresh controller is empty and killAll() on it is safe', () => {
    const controller = createMotionController();
    expect(controller.liveCount()).toBe(0);
    expect(() => controller.killAll()).not.toThrow();
  });
});

describe('legacy helpers delegate to the registry (pure refactor, no behavior change)', () => {
  const bases = [0, 1, 120, 360, 600, 700, 900, 1500, -10];
  const flags = [false, true];

  it.each(
    bases.flatMap((baseMs) => flags.map((prefersReduced) => ({ baseMs, prefersReduced }))),
  )('resolveTweenDuration($baseMs, $prefersReduced) === momentDuration', ({ baseMs, prefersReduced }) => {
    expect(resolveTweenDuration(baseMs, prefersReduced)).toBe(momentDuration(baseMs, prefersReduced));
  });

  it.each(
    bases.flatMap((baseMs) => flags.map((prefersReduced) => ({ baseMs, prefersReduced }))),
  )('resolveVisualizerDuration($baseMs, $prefersReduced) === momentDuration', ({ baseMs, prefersReduced }) => {
    expect(resolveVisualizerDuration(baseMs, prefersReduced)).toBe(momentDuration(baseMs, prefersReduced));
  });

  it('the preference decision feeds the gate end-to-end (viewer wiring seam)', () => {
    for (const matchMediaResult of [true, false]) {
      const prefersReduced = resolveMotionPrefersReduced(matchMediaResult);
      expect(momentDuration(700, prefersReduced)).toBe(matchMediaResult ? 0 : 700);
    }
  });
});
