import { describe, expect, it } from 'vitest';
import {
  LABEL_FADE_START_M,
  LABEL_MAX_M,
  PIN_MAX_PX,
  PIN_MIN_PX,
  focalLengthPx,
  hitTestScreen,
  labelOpacity,
  layoutLabels,
  pinScreenPx,
  pinWorldDiameter,
  type ProjectedLabel,
} from '../src/lib/poiOverlay';

const focal = focalLengthPx(900, 68);

describe('pin sizing', () => {
  it('never exceeds the maximum or drops below the minimum on screen', () => {
    for (const d of [0.05, 0.3, 1, 3, 10, 40, 200]) {
      const px = pinScreenPx(d, focal);
      expect(px).toBeLessThanOrEqual(PIN_MAX_PX);
      expect(px).toBeGreaterThanOrEqual(PIN_MIN_PX);
      // the world diameter really projects back to that pixel size
      expect((pinWorldDiameter(d, focal) * focal) / d).toBeCloseTo(px, 6);
    }
  });

  it('is clamped large when close and small when far', () => {
    expect(pinScreenPx(0.2, focal)).toBe(PIN_MAX_PX);
    expect(pinScreenPx(100, focal)).toBe(PIN_MIN_PX);
  });
});

describe('label fade', () => {
  it('is opaque near, transparent far, linear between', () => {
    expect(labelOpacity(1)).toBe(1);
    expect(labelOpacity(LABEL_FADE_START_M)).toBe(1);
    expect(labelOpacity(LABEL_MAX_M)).toBe(0);
    expect(labelOpacity((LABEL_FADE_START_M + LABEL_MAX_M) / 2)).toBeCloseTo(0.5);
  });
});

describe('label layout', () => {
  const viewport = { width: 1000, height: 600 };
  const label = (id: string, x: number, y: number, distance: number, extra: Partial<ProjectedLabel> = {}): ProjectedLabel =>
    ({ id, x, y, distance, behind: false, width: 80, height: 20, ...extra });

  it('keeps the nearer of two overlapping labels', () => {
    const [far, near] = layoutLabels([label('far', 500, 300, 6), label('near', 510, 305, 2)], viewport);
    expect(near.visible).toBe(true);
    expect(far.visible).toBe(false);
  });

  it('a pinned (selected) label wins over a nearer one', () => {
    const [pinned, near] = layoutLabels([label('pinned', 500, 300, 9, { pinned: true }), label('near', 505, 300, 1)], viewport);
    expect(pinned.visible).toBe(true);
    expect(pinned.opacity).toBe(1);
    expect(near.visible).toBe(false);
  });

  it('hides labels behind the camera, off screen or faded out; keeps separate ones', () => {
    const out = layoutLabels([
      label('behind', 500, 300, 2, { behind: true }),
      label('offscreen', -200, 300, 2),
      label('faded', 100, 100, LABEL_MAX_M + 1),
      label('a', 200, 300, 3),
      label('b', 700, 300, 4),
    ], viewport);
    expect(out.map((l) => [l.id, l.visible])).toEqual([['behind', false], ['offscreen', false], ['faded', false], ['a', true], ['b', true]]);
  });
});

describe('screen hit test', () => {
  const targets = [
    { id: 'near', x: 100, y: 100, radius: 10, distance: 2 },
    { id: 'far', x: 104, y: 100, radius: 6, distance: 9 },
    { id: 'labelled', x: 400, y: 300, radius: 6, distance: 5, label: [360, 270, 440, 290] as [number, number, number, number] },
  ];
  it('hits a pin within its radius plus slop, nearest POI first', () => {
    expect(hitTestScreen(targets, 103, 101)).toBe('near');
    expect(hitTestScreen(targets, 100, 117)).toBe(null);
    expect(hitTestScreen(targets, 100, 115)).toBe('near'); // 10 px radius + 6 px slop
  });
  it('hits a label anywhere inside its rectangle', () => {
    expect(hitTestScreen(targets, 365, 275)).toBe('labelled');
    expect(hitTestScreen(targets, 500, 500)).toBe(null);
  });
});
