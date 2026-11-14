import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRoute, isWalkable, lineOfSight, measureRouteMetres, worldToCell } from '../src/lib/navigation';
import type { NavigationGrid, Vec3 } from '../src/types/scene';

const makeGrid = (width: number, height: number, blocked: number[], unknown: number[] = []): NavigationGrid => ({
  version: 1, coordinateSystem: 'x-z-grid', origin: { x: 0, z: 0 }, cellSize: 1, width, height, blocked, unknown,
  start: { x: 0, z: 0 }, clearanceMetres: 0.2,
});
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Independent check: sample each leg densely and require every sample's cell to be walkable. */
function legIsWalkable(grid: NavigationGrid, a: Vec3, b: Vec3): boolean {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / (grid.cellSize * 0.01)) + 1;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p: Vec3 = [a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t];
    if (!isWalkable(grid, worldToCell(grid, p))) return false;
  }
  return true;
}

describe('line of sight', () => {
  const wall = makeGrid(5, 5, [7, 12, 17]); // x = 2, z = 1..3
  it('sees across open floor and not through a wall', () => {
    expect(lineOfSight(wall, [0.5, 0, 0.5], [4.5, 0, 0.5])).toBe(true);
    expect(lineOfSight(wall, [0.5, 0, 2.5], [4.5, 0, 2.5])).toBe(false);
  });
  it('refuses to squeeze diagonally between two blocked cells touching at a corner', () => {
    const pinch = makeGrid(2, 2, [1, 2]); // (1,0) and (0,1) blocked
    expect(lineOfSight(pinch, [0.5, 0, 0.5], [1.5, 0, 1.5])).toBe(false);
  });
  it('treats unknown cells as blocked', () => {
    const fog = makeGrid(3, 1, [], [1]);
    expect(lineOfSight(fog, [0.5, 0, 0.5], [2.5, 0, 0.5])).toBe(false);
  });
});

describe('smoothed paths (property tests)', () => {
  it('stay on walkable cells, keep the endpoints and are never longer than the raw path', () => {
    const random = rng(1234);
    let checked = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      const [w, h] = [16, 12];
      const blocked: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < w * h; i += 1) {
        const r = random();
        if (r < 0.2) blocked.push(i);
        else if (r < 0.26) unknown.push(i);
      }
      const grid = makeGrid(w, h, blocked, unknown);
      const free = Array.from({ length: w * h }, (_, i) => i).filter((i) => isWalkable(grid, { x: i % w, z: Math.floor(i / w) }));
      const a = free[Math.floor(random() * free.length)];
      const b = free[Math.floor(random() * free.length)];
      const route = findRoute(grid, { x: a % w, z: Math.floor(a / w) }, { x: b % w, z: Math.floor(b / w) });
      if (!route.ok) continue;
      checked += 1;
      expect(route.path[0]).toEqual(route.world[0]);
      expect(route.path[route.path.length - 1]).toEqual(route.world[route.world.length - 1]);
      expect(measureRouteMetres(route.path)).toBeLessThanOrEqual(measureRouteMetres(route.world) + 1e-9);
      for (let i = 1; i < route.path.length; i += 1) expect(legIsWalkable(grid, route.path[i - 1], route.path[i])).toBe(true);
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('turns the classroom staircases into a few straight legs', () => {
    const grid = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'scenes', 'classroom', 'navigation', 'grid.json'), 'utf8')) as NavigationGrid;
    const route = findRoute(grid, { x: 116, z: 59 }, { x: 26, z: 68 });
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.path.length).toBeLessThan(route.world.length / 5);
    expect(measureRouteMetres(route.path)).toBeLessThan(measureRouteMetres(route.world));
    for (let i = 1; i < route.path.length; i += 1) expect(legIsWalkable(grid, route.path[i - 1], route.path[i])).toBe(true);
  });
});
