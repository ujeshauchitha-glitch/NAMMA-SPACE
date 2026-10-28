/**
 * Workstream D3 · regression guards: `unknown[]` must stay distinct from
 * walkable everywhere navigation is consumed (route planning and step
 * decisions). These guard behaviour the shipped octile A* already implements —
 * they exist so a future refactor cannot silently treat unknown as walkable.
 */
import { describe, expect, it } from 'vitest';
import { findRoute, isWalkable } from '../src/lib/navigation';
import { resolveWalkableStep } from '../src/lib/movement';
import type { NavigationGrid } from '../src/types/scene';

/** 5×5 grid with an unknown column at x=2 (gap at z=2) and a blocked cell at x=4,z=0. */
const grid: NavigationGrid = {
  version: 1,
  coordinateSystem: 'x-z-grid',
  origin: { x: 0, z: 0 },
  cellSize: 1,
  width: 5,
  height: 5,
  blocked: [4], // x=4, z=0
  unknown: [2, 7, 17, 22], // x=2 for z=0,1,3,4 — only (2,2) is verified
  start: { x: 0, z: 0 },
  clearanceMetres: 0.2,
};

const unknownCells = new Set(grid.unknown);
const blockedCells = new Set(grid.blocked);

function assertRouteNeverTouchesOccupied(route: ReturnType<typeof findRoute>): void {
  expect(route.ok).toBe(true);
  if (!route.ok) return;
  for (const cell of route.cells) {
    const index = cell.z * grid.width + cell.x;
    expect(unknownCells.has(index), `route entered unknown cell ${index}`).toBe(false);
    expect(blockedCells.has(index), `route entered blocked cell ${index}`).toBe(false);
  }
}

describe('unknown cells stay non-walkable (D3 regression guards)', () => {
  it('marks unknown cells as not walkable', () => {
    expect(isWalkable(grid, { x: 2, z: 0 })).toBe(false); // index 2
    expect(isWalkable(grid, { x: 2, z: 3 })).toBe(false); // index 17
    expect(isWalkable(grid, { x: 2, z: 2 })).toBe(true); // the verified gap
  });

  it('marks blocked cells as not walkable', () => {
    expect(isWalkable(grid, { x: 4, z: 0 })).toBe(false);
  });

  it('crosses the unknown column only through its verified gap', () => {
    const route = findRoute(grid, { x: 0, z: 0 }, { x: 4, z: 4 });
    assertRouteNeverTouchesOccupied(route);
    // The crossing must leave column x=0 and step through x=3 — never the
    // unknown cells of column x=2.
    if (route.ok) expect(route.cells.some((cell) => cell.x === 3)).toBe(true);
  });

  it('rejects a destination inside unknown space', () => {
    expect(findRoute(grid, { x: 0, z: 0 }, { x: 2, z: 4 })).toMatchObject({ ok: false, reason: 'invalid-goal' });
  });

  it('rejects a start inside unknown space', () => {
    expect(findRoute(grid, { x: 2, z: 0 }, { x: 0, z: 4 })).toMatchObject({ ok: false, reason: 'invalid-start' });
  });

  it('refuses viewer steps into unknown and blocked cells alike', () => {
    expect(resolveWalkableStep(grid, [2.5, 1.65, 3.5])).toBeNull(); // unknown (2,3)
    expect(resolveWalkableStep(grid, [4.5, 1.65, 0.5])).toBeNull(); // blocked
    expect(resolveWalkableStep(grid, [0.5, 1.65, 4.5])).not.toBeNull(); // walkable
  });

  it('keeps unknown cells distinct from blocked cells in the grid itself', () => {
    // Distinct lists: union must not double-count and unknown must survive
    // inflation without being folded into blocked.
    expect(grid.unknown.every((index) => !grid.blocked.includes(index))).toBe(true);
    const startInUnknown = grid.unknown.includes(grid.start.z * grid.width + grid.start.x);
    expect(startInUnknown).toBe(false);
  });
});
