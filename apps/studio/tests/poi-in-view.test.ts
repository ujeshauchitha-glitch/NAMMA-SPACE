import { describe, expect, it } from 'vitest';
import { poiInView } from '../src/lib/navigation';
import type { NavigationGrid } from '../src/types/scene';

// 10 x 10 m, 1 m cells, a wall along x = 5 for z < 8; cell (2, 2) is furniture.
const blocked: number[] = [22];
for (let z = 0; z < 8; z += 1) blocked.push(5 + z * 10);
const grid: NavigationGrid = { version: 1, coordinateSystem: 'x-z-grid', origin: { x: 0, z: 0 }, cellSize: 1, width: 10, height: 10, blocked, unknown: [], start: { x: 1, z: 1 }, clearanceMetres: 0.3 };
const eye: [number, number, number] = [1.5, 1.6, 4.5];
const at = (x: number, z: number, ax = x, az = z) => ({ position: [x, 1.2, z] as [number, number, number], approachPoint: [ax, 1.6, az] as [number, number, number] });

describe('poiInView', () => {
  it('sees POIs on the same side of the wall', () => {
    expect(poiInView(grid, eye, at(3.5, 7.5))).toBe(true);
  });
  it('does not see through the wall', () => {
    expect(poiInView(grid, eye, at(8.5, 4.5))).toBe(false);
  });
  it('uses the approach point for a POI standing on furniture', () => {
    expect(poiInView(grid, eye, at(2.5, 2.5, 2.5, 3.5))).toBe(true);
  });
  it('ignores POIs beyond the range', () => {
    expect(poiInView(grid, eye, at(3.5, 7.5), 2)).toBe(false);
  });
});
