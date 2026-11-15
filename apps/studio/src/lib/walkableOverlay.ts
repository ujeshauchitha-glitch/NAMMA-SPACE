import type { NavigationGrid } from '../types/scene';
import { isWalkable } from './navigation';

/** A horizontal run of walkable cells in one grid row: columns x0 (inclusive) to x1 (exclusive). */
export type WalkableRun = { z: number; x0: number; x1: number };

/** Walkable cells merged into row runs, so the floor overlay needs one quad per run instead of per cell. */
export function walkableRuns(grid: NavigationGrid): WalkableRun[] {
  const runs: WalkableRun[] = [];
  for (let z = 0; z < grid.height; z += 1) {
    let start = -1;
    for (let x = 0; x <= grid.width; x += 1) {
      const walkable = x < grid.width && isWalkable(grid, { x, z });
      if (walkable && start < 0) start = x;
      if (!walkable && start >= 0) {
        runs.push({ z, x0: start, x1: x });
        start = -1;
      }
    }
  }
  return runs;
}

/** Flat quads (two triangles each) at height y covering every run, in world metres. */
export function walkableMesh(grid: NavigationGrid, runs: readonly WalkableRun[], y: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const { origin, cellSize } = grid;
  runs.forEach(({ z, x0, x1 }, i) => {
    const left = origin.x + x0 * cellSize;
    const right = origin.x + x1 * cellSize;
    const near = origin.z + z * cellSize;
    const far = near + cellSize;
    positions.push(left, y, near, right, y, near, right, y, far, left, y, far);
    const base = i * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions, indices };
}
