import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TONES, fitScale, gridImageTransform, gridPixels, headingOnMap, minimapDrawKey, minimapTransform, poiAtMapPoint, toFloor, toMap,
  walkableAtMapPoint,
} from '../src/lib/minimap';
import type { NavigationGrid, Poi } from '../src/types/scene';

// 10 x 5 cells of 1 m from (-5, -2.5): x in [-5, 5], z in [-2.5, 2.5]. Cell (2, 1) blocked, (3, 1) unknown.
const grid: NavigationGrid = {
  version: 1, coordinateSystem: 'x-z-grid', origin: { x: -5, z: -2.5 }, cellSize: 1, width: 10, height: 5,
  blocked: [1 * 10 + 2], unknown: [1 * 10 + 3], start: { x: 5, z: 2 }, clearanceMetres: 0.25,
} as NavigationGrid;

const poi = (id: string, x: number, z: number, zone?: [number, number][]): Poi => ({
  id, label: id, category: 'other', position: [x, 1, z], approachPoint: [x, 1.5, z], aliases: [], confidence: 1, source: 'operator', zone,
});

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('minimap transform', () => {
  it('fits the grid inside the canvas less the padding', () => {
    expect(fitScale(grid, 212, 212, 6)).toBe(20); // 200 px over 10 m wide
  });

  it('north-up: grid centre at canvas centre, -z (north) at the top, +x to the right', () => {
    const t = minimapTransform(grid, 212, 212, 'north', { x: 3, z: 1, yawDegrees: 70 });
    const [cx, cy] = toMap(t, 0, 0);
    close(cx, 106); close(cy, 106);
    const [, northY] = toMap(t, 0, -2);
    expect(northY).toBeLessThan(cy);
    const [eastX] = toMap(t, 2, 0);
    expect(eastX).toBeGreaterThan(cx);
  });

  it('heading-up: the visitor is centred and their view direction points straight up', () => {
    for (const yaw of [0, 37, 90, 180, -120]) {
      const pose = { x: 1.5, z: -0.5, yawDegrees: yaw };
      const t = minimapTransform(grid, 200, 160, 'heading', pose);
      const [ux, uy] = toMap(t, pose.x, pose.z);
      close(ux, 100); close(uy, 80);
      const [hx, hy] = headingOnMap(t, yaw);
      close(hx, 0); close(hy, -1);
    }
  });

  it('north-up heading cone follows yaw: yaw 0 faces up, yaw 90 faces left (-x)', () => {
    const t = minimapTransform(grid, 200, 200, 'north', { x: 0, z: 0, yawDegrees: 0 });
    const [ux, uy] = headingOnMap(t, 0);
    close(ux, 0); close(uy, -1);
    const [lx, ly] = headingOnMap(t, 90);
    close(lx, -1); close(ly, 0);
  });

  it('toFloor inverts toMap in both modes', () => {
    for (const mode of ['north', 'heading'] as const) {
      const t = minimapTransform(grid, 180, 240, mode, { x: -2, z: 1, yawDegrees: 33 });
      const [px, py] = toMap(t, 2.25, -1.75);
      const [x, z] = toFloor(t, px, py);
      close(x, 2.25); close(z, -1.75);
    }
  });

  it('the grid bitmap transform puts cell (i, j) where its world corner maps', () => {
    const t = minimapTransform(grid, 200, 200, 'heading', { x: 0, z: 0, yawDegrees: 45 });
    const [a, b, c, d, e, f] = gridImageTransform(grid, t);
    const [i, j] = [4, 3];
    const [wx, wy] = toMap(t, grid.origin.x + i * grid.cellSize, grid.origin.z + j * grid.cellSize);
    close(a * i + c * j + e, wx);
    close(b * i + d * j + f, wy);
  });
});

describe('grid pixels', () => {
  it('colours walkable, obstacle and unfilmed cells in three tones', () => {
    const pixels = gridPixels(grid);
    expect(pixels.length).toBe(10 * 5 * 4);
    const at = (x: number, z: number) => [...pixels.slice((z * 10 + x) * 4, (z * 10 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual(DEFAULT_TONES.walkable);
    expect(at(2, 1)).toEqual(DEFAULT_TONES.blocked);
    expect(at(3, 1)).toEqual(DEFAULT_TONES.unknown);
  });
});

describe('map clicks', () => {
  const t = minimapTransform(grid, 212, 212, 'north', { x: 0, z: 0, yawDegrees: 0 });

  it('picks the nearest pin within the radius', () => {
    const pois = [poi('a', 0, 0), poi('b', 0.3, 0)];
    const [px, py] = toMap(t, 0.25, 0);
    expect(poiAtMapPoint(pois, t, px, py)).toBe('b');
    const [fx, fy] = toMap(t, 3, 2);
    expect(poiAtMapPoint(pois, t, fx, fy)).toBeNull();
  });

  it('falls back to a zone containing the point', () => {
    const pois = [poi('room', 3, 1, [[2, 0], [4, 0], [4, 2], [2, 2]])];
    const [px, py] = toMap(t, 2.4, 1.6);
    expect(poiAtMapPoint(pois, t, px, py)).toBe('room');
  });

  it('returns a floor point only on walkable cells', () => {
    const [wx, wy] = toMap(t, 0.5, 0.5);
    const floor = walkableAtMapPoint(grid, t, wx, wy);
    expect(floor?.[0]).toBeCloseTo(0.5);
    expect(floor?.[1]).toBeCloseTo(0.5);
    const [bx, by] = toMap(t, -2.5, -1); // cell (2, 1): blocked
    expect(walkableAtMapPoint(grid, t, bx, by)).toBeNull();
    const [ux, uy] = toMap(t, -1.5, -1); // cell (3, 1): unfilmed
    expect(walkableAtMapPoint(grid, t, ux, uy)).toBeNull();
    expect(walkableAtMapPoint(grid, t, -50, -50)).toBeNull(); // off the grid
  });
});

describe('redraw key', () => {
  const base = { pose: { x: 1, z: 2, yawDegrees: 10 }, mode: 'north' as const, widthPx: 200, heightPx: 200, selectedId: null, route: null };

  it('ignores sub-centimetre jitter and sub-degree turns', () => {
    expect(minimapDrawKey({ ...base, pose: { x: 1.004, z: 2.003, yawDegrees: 10.2 } })).toBe(minimapDrawKey(base));
  });

  it('changes when the visitor moves, turns, selects, routes or the mode or size changes', () => {
    const key = minimapDrawKey(base);
    expect(minimapDrawKey({ ...base, pose: { x: 1.1, z: 2, yawDegrees: 10 } })).not.toBe(key);
    expect(minimapDrawKey({ ...base, pose: { x: 1, z: 2, yawDegrees: 12 } })).not.toBe(key);
    expect(minimapDrawKey({ ...base, selectedId: 'a' })).not.toBe(key);
    expect(minimapDrawKey({ ...base, route: [[0, 0], [1, 1]] })).not.toBe(key);
    expect(minimapDrawKey({ ...base, mode: 'heading' })).not.toBe(key);
    expect(minimapDrawKey({ ...base, widthPx: 300 })).not.toBe(key);
  });
});
