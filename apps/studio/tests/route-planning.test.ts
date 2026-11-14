import { describe, expect, it } from 'vitest';
import { findRoute, isWalkable, planRoute, snapToWalkable, type GridCell } from '../src/lib/navigation';
import type { NavigationGrid } from '../src/types/scene';

const makeGrid = (width: number, height: number, blocked: number[], cellSize = 1): NavigationGrid => ({
  version: 1, coordinateSystem: 'x-z-grid', origin: { x: 0, z: 0 }, cellSize, width, height, blocked, unknown: [],
  start: { x: 0, z: 0 }, clearanceMetres: 0.2,
});

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Cost of a cell path under the same step costs A* uses. */
const pathCost = (cells: GridCell[]) => cells.slice(1).reduce((sum, c, i) => sum + (c.x !== cells[i].x && c.z !== cells[i].z ? 1.4142 : 1), 0);

/** Reference: plain Dijkstra with the same neighbour rules (no corner cutting). */
function dijkstraCost(grid: NavigationGrid, start: GridCell, goal: GridCell): number | null {
  const dist = new Map<string, number>([[`${start.x}:${start.z}`, 0]]);
  const done = new Set<string>();
  for (;;) {
    let best: string | null = null;
    dist.forEach((d, k) => { if (!done.has(k) && (best === null || d < dist.get(best)!)) best = k; });
    if (best === null) return null;
    const [x, z] = (best as string).split(':').map(Number);
    if (x === goal.x && z === goal.z) return dist.get(best)!;
    done.add(best);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const n = { x: x + dx, z: z + dz };
      if (!isWalkable(grid, n)) continue;
      if (dx && dz && !(isWalkable(grid, { x: n.x, z }) && isWalkable(grid, { x, z: n.z }))) continue;
      const nd = dist.get(best)! + (dx && dz ? 1.4142 : 1);
      const k = `${n.x}:${n.z}`;
      if (nd < (dist.get(k) ?? Infinity)) dist.set(k, nd);
    }
  }
}

describe('heap A*', () => {
  it('finds optimal routes (same cost as Dijkstra) on random grids', () => {
    const random = rng(42);
    let checked = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const [w, h] = [12, 10];
      const blocked = Array.from({ length: w * h }, (_, i) => i).filter(() => random() < 0.28);
      const grid = makeGrid(w, h, blocked);
      const free = Array.from({ length: w * h }, (_, i) => i).filter((i) => !blocked.includes(i));
      if (free.length < 2) continue;
      const a = free[Math.floor(random() * free.length)];
      const b = free[Math.floor(random() * free.length)];
      const start = { x: a % w, z: Math.floor(a / w) };
      const goal = { x: b % w, z: Math.floor(b / w) };
      const route = findRoute(grid, start, goal);
      const reference = dijkstraCost(grid, start, goal);
      if (reference === null) {
        expect(route.ok).toBe(false);
      } else {
        expect(route.ok).toBe(true);
        if (route.ok) expect(pathCost(route.cells)).toBeCloseTo(reference, 6);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('snapping', () => {
  // 0.1 m cells; walkable only in the 20 x 20 square x, z in [0, 2) m; everything else (60 x 60) blocked.
  const width = 60;
  const blocked = Array.from({ length: width * width }, (_, i) => i).filter((i) => i % width >= 20 || Math.floor(i / width) >= 20);
  const grid = makeGrid(width, width, blocked, 0.1);

  it('keeps a walkable position and snaps a nearby blocked one to the nearest walkable cell', () => {
    expect(snapToWalkable(grid, [0.55, 1.6, 0.55])).toEqual({ x: 5, z: 5 });
    expect(snapToWalkable(grid, [2.5, 1.6, 1.02])).toEqual({ x: 19, z: 10 }); // 0.55 m outside the square
  });

  it('gives up beyond 1.5 m', () => {
    expect(snapToWalkable(grid, [3.7, 1.6, 1.0])).toBeNull(); // 1.75 m away
  });

  it('routes from a blocked start and to a blocked goal when walkable floor is close', () => {
    const route = planRoute(grid, [2.4, 1.6, 0.2], [0.3, 1.6, 2.6]);
    expect(route.ok).toBe(true);
  });

  it('reports a clear status when no walkable point is nearby', () => {
    expect(planRoute(grid, [5, 1.6, 5], [0.5, 1.6, 0.5])).toMatchObject({ ok: false, reason: 'invalid-start', detail: expect.stringContaining('No walkable point nearby') });
    expect(planRoute(grid, [0.5, 1.6, 0.5], [5, 1.6, 5])).toMatchObject({ ok: false, reason: 'invalid-goal', detail: expect.stringContaining('No walkable point nearby') });
  });
});
