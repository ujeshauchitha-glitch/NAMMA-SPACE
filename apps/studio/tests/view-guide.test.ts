import { describe, expect, it } from 'vitest';
import { GUIDE_DELAY_MS, idleYawStep, SPLAT_MAX_PITCH_DEG, viewGuideEnabled } from '../src/lib/viewGuide';
import { moveGesture, startGesture } from '../src/lib/lookGesture';

/**
 * Simulates N idle frames the way the viewer runs them: no look input, no keys. The only idle
 * camera mover is the optional view guide, plus a look gesture that never receives a move.
 */
function idleFrames(enabled: boolean, frames: number, start = { yaw: 30, pitch: -12 }) {
  let { yaw } = start;
  const { pitch } = start;
  const filmed = 0; // heading the phone faced: the guide (if on) would turn toward it
  for (let i = 0; i < frames; i += 1) {
    const heading = (yaw * Math.PI) / 180;
    yaw += idleYawStep({ enabled, msSinceLook: 1000 + i * 16, heading, filmedHeading: filmed, dt: 1 / 60 });
  }
  return { yaw, pitch };
}

describe('camera with no input', () => {
  it('keeps yaw and pitch unchanged over 600 idle frames (guide off, the default)', () => {
    expect(idleFrames(false, 600)).toEqual({ yaw: 30, pitch: -12 });
  });

  it('is off unless ?guide=1', () => {
    expect(viewGuideEnabled('')).toBe(false);
    expect(viewGuideEnabled('?scene=apartment&edit=1')).toBe(false);
    expect(viewGuideEnabled('?guide=1')).toBe(true);
  });

  it('with ?guide=1 the old behaviour is still there for comparison', () => {
    expect(Math.abs(idleFrames(true, 120).yaw)).toBeLessThan(5); // drifted toward the filmed heading
    expect(idleYawStep({ enabled: true, msSinceLook: GUIDE_DELAY_MS - 1, heading: 1, filmedHeading: 0, dt: 0.016 })).toBe(0);
    expect(idleYawStep({ enabled: true, msSinceLook: 5000, heading: 1, filmedHeading: null, dt: 0.016 })).toBe(0);
  });

  it('a press that never moves produces no look', () => {
    let g = startGesture(1, 50, 50, 'mouse');
    for (let i = 0; i < 100; i += 1) {
      const step = moveGesture(g, 50, 50);
      expect([step.dx, step.dy]).toEqual([0, 0]);
      g = step.gesture;
    }
  });

  it('allows at least ±60° of pitch in splat scenes', () => {
    expect(SPLAT_MAX_PITCH_DEG).toBeGreaterThanOrEqual(60);
  });
});
