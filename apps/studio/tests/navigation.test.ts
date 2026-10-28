import { describe, expect, it } from 'vitest';
import { findRoute, inflateNavigationGrid, measureRouteMetres, searchPois, worldToCell } from '../src/lib/navigation';
import type { NavigationGrid, Poi } from '../src/types/scene';

const grid: NavigationGrid = {
  version: 1,
  coordinateSystem: 'x-z-grid',
  origin: { x: 0, z: 0 },
  cellSize: 1,
  width: 7,
  height: 7,
  blocked: [9, 16, 23, 30, 37],
  unknown: [],
  start: { x: 0, z: 0 },
  clearanceMetres: 0.2,
};

describe('A* navigation', () => {
  it('finds a route around a wall', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 6, z: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cells.some((cell) => cell.z > 1)).toBe(true);
  });

  it('rejects blocked destinations', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 2, z: 1 });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-goal' });
  });

  it('rejects a destination outside the map', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-goal' });
  });

  it('converts world positions to grid cells', () => {
    expect(worldToCell(grid, [2.2, 0, 4.8])).toEqual({ x: 2, z: 4 });
  });

  it('does not cut diagonally through two blocked corner cells', () => {
    const cornerGrid: NavigationGrid = { ...grid, width: 3, height: 3, blocked: [1, 3] };
    expect(findRoute(cornerGrid, { x: 0, z: 0 }, { x: 1, z: 1 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('reports disconnected targets as unreachable', () => {
    const disconnected: NavigationGrid = { ...grid, width: 3, height: 3, blocked: [1, 3, 4, 5, 7] };
    expect(findRoute(disconnected, { x: 0, z: 0 }, { x: 2, z: 2 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('inflates a narrow obstacle corridor without diagonal corner leaks', () => {
    const raw: NavigationGrid = { ...grid, width: 9, height: 7, blocked: [28, 29, 30, 32, 33, 34], unknown: [], start: { x: 4, z: 1 }, clearanceMetres: 0.5 };
    const inflated = inflateNavigationGrid(raw);
    expect(inflated.blocked).toEqual(expect.arrayContaining([28, 29, 30, 31, 32, 33, 34]));
    expect(findRoute(raw, { x: 4, z: 1 }, { x: 4, z: 5 }).ok).toBe(true);
    expect(findRoute(inflated, { x: 4, z: 1 }, { x: 4, z: 5 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('POI search', () => {
  const pois: Poi[] = [
    { id: 'desk', label: 'Registration Desk', category: 'service', position: [0, 0, 0], approachPoint: [0, 0, 1], aliases: ['help desk'], confidence: 1, source: 'synthetic' },
    { id: 'hall', label: 'Main Hall', category: 'room', position: [1, 0, 1], approachPoint: [1, 0, 2], aliases: ['exhibition'], confidence: 1, source: 'synthetic' },
  ];

  it('matches labels and aliases deterministically', () => {
    expect(searchPois(pois, 'help')[0]?.id).toBe('desk');
    expect(searchPois(pois, 'hall')[0]?.id).toBe('hall');
    expect(searchPois(pois, '').map((poi) => poi.id)).toEqual(['desk', 'hall']);
  });
});

// T16 · route status strip inputs (§5.16) — new cases only.
describe('route measurement (T16)', () => {
  it('measures a multi-cell route in world metres', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 6, z: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cells.length).toBeGreaterThan(1);
    const metres = measureRouteMetres(result.world);
    expect(metres).toBeGreaterThan(0);
    // cellSize is 1 m; diagonal steps are √2, so the polyline stays under
    // one diagonal per cell.
    expect(metres).toBeLessThanOrEqual(result.cells.length * Math.SQRT2);
  });

  it('returns zero for a single-point path', () => {
    expect(measureRouteMetres([[0, 0, 0]])).toBe(0);
  });

  it('surfaces the unreachable detail verbatim for a blocked destination', () => {
    const disconnected: NavigationGrid = { ...grid, width: 3, height: 3, blocked: [1, 3, 4, 5, 7] };
    const result = findRoute(disconnected, { x: 0, z: 0 }, { x: 2, z: 2 });
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
    if (result.ok) return;
    expect(result.detail).toBe('No collision-safe route connects the current position to this destination.');
  });
});

// Workstream D1 · A* optimality regression (oracle: full Dijkstra in-test).
// The shipped cost model is ortho=1, diagonal=1.4142 with no corner cutting,
// so the admissible+consistent heuristic is octile distance, not Manhattan.
describe('A* optimality against a Dijkstra reference (D1)', () => {
  const DIAG_COST = 1.4142;

  type TestCell = { x: number; z: number };

  const testKey = (cell: TestCell): string => `${cell.x}:${cell.z}`;

  function walkableCells(target: NavigationGrid): Set<string> {
    const set = new Set<string>();
    for (let z = 0; z < target.height; z += 1) {
      for (let x = 0; x < target.width; x += 1) {
        const index = z * target.width + x;
        if (!target.blocked.includes(index) && !target.unknown.includes(index)) set.add(`${x}:${z}`);
      }
    }
    return set;
  }

  function referenceNeighbours(target: NavigationGrid, cell: TestCell, walkable: Set<string>): TestCell[] {
    const out: TestCell[] = [];
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const next = { x: cell.x + dx, z: cell.z + dz };
        if (!walkable.has(testKey(next))) continue;
        if (dx !== 0 && dz !== 0) {
          if (!walkable.has(`${cell.x + dx}:${cell.z}`)) continue;
          if (!walkable.has(`${cell.x}:${cell.z + dz}`)) continue;
        }
        out.push(next);
      }
    }
    return out;
  }

  /** Full Dijkstra over the whole grid — the optimality oracle for A*. */
  function dijkstraCost(target: NavigationGrid, start: TestCell, goal: TestCell): number | null {
    const walkable = walkableCells(target);
    if (!walkable.has(testKey(start)) || !walkable.has(testKey(goal))) return null;
    const dist = new Map<string, number>([[testKey(start), 0]]);
    const settled = new Set<string>();
    for (;;) {
      let bestKey: string | null = null;
      let bestDist = Infinity;
      for (const [k, d] of dist) {
        if (!settled.has(k) && d < bestDist) {
          bestDist = d;
          bestKey = k;
        }
      }
      if (bestKey === null) return null;
      if (bestKey === testKey(goal)) return bestDist;
      settled.add(bestKey);
      const [x, z] = bestKey.split(':').map(Number);
      for (const next of referenceNeighbours(target, { x, z }, walkable)) {
        const nk = testKey(next);
        const step = next.x !== x && next.z !== z ? DIAG_COST : 1;
        const nd = bestDist + step;
        if (nd < (dist.get(nk) ?? Infinity)) dist.set(nk, nd);
      }
    }
  }

  function routeCost(cells: TestCell[]): number {
    let total = 0;
    for (let index = 1; index < cells.length; index += 1) {
      const dx = Math.abs(cells[index].x - cells[index - 1].x);
      const dz = Math.abs(cells[index].z - cells[index - 1].z);
      total += dx === 1 && dz === 1 ? DIAG_COST : 1;
    }
    return total;
  }

  // Counterexample produced by an exhaustive random search over small grids:
  // with the inadmissible Manhattan heuristic, A* pops the goal early at cost
  // 11.8284 while full Dijkstra proves the optimum is 11.2426.
  const counterexample: NavigationGrid = {
    version: 1,
    coordinateSystem: 'x-z-grid',
    origin: { x: 0, z: 0 },
    cellSize: 1,
    width: 8,
    height: 5,
    blocked: [1, 2, 10, 15, 20, 27, 37, 38],
    unknown: [],
    start: { x: 0, z: 0 },
    clearanceMetres: 0.2,
  };

  const meta = { version: 1, coordinateSystem: 'x-z-grid' as const, origin: { x: 0, z: 0 }, cellSize: 1, unknown: [], start: { x: 0, z: 0 }, clearanceMetres: 0.2 };

  const optimalityGrids: Array<{ name: string; grid: NavigationGrid; start: TestCell; goal: TestCell }> = [
    { name: 'open grid', grid: { ...meta, width: 10, height: 10, blocked: [] }, start: { x: 0, z: 0 }, goal: { x: 9, z: 9 } },
    // Wall spanning z=2 with a single gap at x=4.
    {
      name: 'wall with a gap',
      grid: { ...meta, width: 9, height: 5, blocked: [10, 11, 12, 13, 15, 16, 17] },
      start: { x: 0, z: 0 },
      goal: { x: 8, z: 4 },
    },
    // Concave pocket open toward the start — tempts a greedy search into a dead end.
    {
      name: 'dead-end pocket',
      grid: { ...meta, width: 7, height: 7, blocked: [15, 17, 22, 23, 24] },
      start: { x: 0, z: 0 },
      goal: { x: 6, z: 3 },
    },
    // Staircase corridor between two offset walls forces a diagonal slalom.
    {
      name: 'diagonal slalom',
      grid: { ...meta, width: 9, height: 9, blocked: [27, 28, 29, 30, 31, 49, 50, 51, 52, 53] },
      start: { x: 0, z: 0 },
      goal: { x: 8, z: 8 },
    },
    { name: 'Manhattan counterexample', grid: counterexample, start: { x: 0, z: 0 }, goal: { x: 7, z: 4 } },
  ];

  for (const { name, grid: caseGrid, start, goal } of optimalityGrids) {
    it(`returns the Dijkstra-optimal cost on ${name}`, () => {
      const optimal = dijkstraCost(caseGrid, start, goal);
      expect(optimal).not.toBeNull();
      const result = findRoute(caseGrid, start, goal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(routeCost(result.cells)).toBeCloseTo(optimal as number, 9);
    });

    it(`produces a collision-free, corner-safe route on ${name}`, () => {
      const result = findRoute(caseGrid, start, goal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const walkable = walkableCells(caseGrid);
      expect(walkable.has(testKey(result.cells[0]))).toBe(true);
      for (let index = 1; index < result.cells.length; index += 1) {
        const previous = result.cells[index - 1];
        const next = result.cells[index];
        const dx = Math.abs(next.x - previous.x);
        const dz = Math.abs(next.z - previous.z);
        expect(Math.max(dx, dz)).toBe(1);
        expect(walkable.has(testKey(next))).toBe(true);
        if (dx === 1 && dz === 1) {
          expect(walkable.has(`${next.x}:${previous.z}`)).toBe(true);
          expect(walkable.has(`${previous.x}:${next.z}`)).toBe(true);
        }
      }
    });
  }

  it('is deterministic across repeated runs', () => {
    const first = findRoute(counterexample, { x: 0, z: 0 }, { x: 7, z: 4 });
    const second = findRoute(counterexample, { x: 0, z: 0 }, { x: 7, z: 4 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('returns a zero-length route when start equals goal', () => {
    const result = findRoute(counterexample, { x: 3, z: 0 }, { x: 3, z: 0 });
    expect(result).toMatchObject({ ok: true, cells: [{ x: 3, z: 0 }] });
  });

  it('agrees with the Dijkstra reference on an unreachable target', () => {
    const disconnected: NavigationGrid = { ...meta, width: 3, height: 3, blocked: [1, 3, 4, 5, 7] };
    expect(dijkstraCost(disconnected, { x: 0, z: 0 }, { x: 2, z: 2 })).toBeNull();
    expect(findRoute(disconnected, { x: 0, z: 0 }, { x: 2, z: 2 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});
