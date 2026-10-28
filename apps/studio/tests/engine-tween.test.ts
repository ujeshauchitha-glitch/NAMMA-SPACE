import { describe, expect, it } from 'vitest';
import {
  advanceTween,
  cancelTween,
  createTween,
  easeInOutCubic,
  easeOutExpo,
  lerpAngleDeg,
  revealCount,
  resolveTweenDuration,
} from '../src/engine/tween';

/**
 * T15 · pure tween/cancel math for the additive engine motion API.
 * No DOM, no engine — this is the module the gem's tweens delegate to, so
 * cancellation and easing are provable without touching PlayCanvasViewer
 * control flow.
 */

describe('tween duration resolution', () => {
  it('keeps the base duration normally and cuts to 0 under reduced motion', () => {
    expect(resolveTweenDuration(700, false)).toBe(700);
    expect(resolveTweenDuration(600, false)).toBe(600);
    expect(resolveTweenDuration(700, true)).toBe(0);
  });
});

describe('createTween / advanceTween', () => {
  it('a zero-duration tween completes immediately at progress 1 (instant cut)', () => {
    const tween = createTween(0);
    const stepped = advanceTween(tween, 16);
    expect(stepped.done).toBe(true);
    expect(stepped.progress).toBe(1);
  });

  it('accumulates elapsed time and reports raw progress', () => {
    let tween = createTween(700);
    let stepped = advanceTween(tween, 200);
    tween = stepped.tween;
    expect(stepped.done).toBe(false);
    expect(stepped.progress).toBeCloseTo(200 / 700, 5);

    stepped = advanceTween(tween, 500);
    expect(stepped.done).toBe(true);
    expect(stepped.progress).toBe(1);
    expect(stepped.tween.elapsedMs).toBe(700);
  });

  it('clamps elapsed to the duration (no overshoot past 1)', () => {
    const tween = createTween(300);
    const stepped = advanceTween(tween, 10_000);
    expect(stepped.tween.elapsedMs).toBe(300);
    expect(stepped.progress).toBe(1);
  });

  it('treats negative deltas as zero (never rewinds)', () => {
    const tween = createTween(500);
    const stepped = advanceTween(tween, -100);
    expect(stepped.tween.elapsedMs).toBe(0);
    expect(stepped.progress).toBe(0);
  });

  it('negative duration is normalized to 0', () => {
    expect(createTween(-50).durationMs).toBe(0);
  });
});

describe('cancelTween', () => {
  it('a cancelled tween reports done with no further progress', () => {
    const tween = cancelTween(createTween(700));
    const stepped = advanceTween(tween, 16);
    expect(stepped.done).toBe(true);
    expect(stepped.progress).toBe(0);
    expect(stepped.tween.elapsedMs).toBe(0);
    expect(stepped.tween.cancelled).toBe(true);
  });

  it('cancel is sticky across advances (a kill cannot be un-killed)', () => {
    let tween = cancelTween(createTween(700));
    let stepped = advanceTween(tween, 100);
    tween = stepped.tween;
    stepped = advanceTween(tween, 100);
    expect(stepped.tween.cancelled).toBe(true);
    expect(stepped.done).toBe(true);
    expect(stepped.progress).toBe(0);
  });
});

describe('easing', () => {
  it('easeOutExpo hits both endpoints exactly', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
  });

  it('easeOutExpo is front-loaded (faster than linear early)', () => {
    expect(easeOutExpo(0.25)).toBeGreaterThan(0.25);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.5);
  });

  it('easeOutExpo is monotonic across sampled progress', () => {
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeOutExpo(Math.min(t, 1));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('easeInOutCubic hits endpoints and crosses 0.5 at the middle', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it('easeInOutCubic is symmetric about the midpoint', () => {
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75), 10);
  });

  it('eased output stays within [0, 1] for any raw progress', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const raw = Math.min(t, 1);
      expect(easeOutExpo(raw)).toBeGreaterThanOrEqual(0);
      expect(easeOutExpo(raw)).toBeLessThanOrEqual(1);
      expect(easeInOutCubic(raw)).toBeGreaterThanOrEqual(0);
      expect(easeInOutCubic(raw)).toBeLessThanOrEqual(1);
    }
  });
});

describe('lerpAngleDeg (camera yaw/pitch interpolation)', () => {
  it('is exact at both ends', () => {
    expect(lerpAngleDeg(10, 70, 0)).toBe(10);
    expect(lerpAngleDeg(10, 70, 1)).toBeCloseTo(70, 10);
  });

  it('interpolates linearly without wrap', () => {
    expect(lerpAngleDeg(10, 70, 0.5)).toBeCloseTo(40, 10);
  });

  it('takes the shortest path across the ±180° seam', () => {
    // 350° → 10° must travel +20° (midpoint 360° ≡ 0°), never -340°.
    const mid = lerpAngleDeg(350, 10, 0.5);
    expect(((mid % 360) + 360) % 360).toBeCloseTo(0, 10);
    const normalized = ((lerpAngleDeg(350, 10, 1) % 360) + 360) % 360;
    expect(normalized).toBeCloseTo(10, 10);
  });

  it('handles descending angles across the seam', () => {
    const mid = lerpAngleDeg(10, 350, 0.5);
    expect(((mid % 360) + 360) % 360).toBeCloseTo(0, 10);
  });
});

describe('revealCount (route-tape draw progress)', () => {
  it('reveals nothing at 0 and everything at 1', () => {
    expect(revealCount(0, 11)).toBe(0);
    expect(revealCount(1, 11)).toBe(11);
  });

  it('is monotonic and rounds up so the tape never stalls', () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const count = revealCount(Math.min(t, 1), 11);
      expect(count).toBeGreaterThanOrEqual(previous);
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(11);
      previous = count;
    }
    expect(revealCount(0.001, 11)).toBe(1);
  });

  it('handles an empty tape without negative counts', () => {
    expect(revealCount(0.5, 0)).toBe(0);
    expect(revealCount(1, 0)).toBe(0);
  });
});
