import { describe, expect, it } from 'vitest';
import { walkableMesh, walkableRuns } from '../src/lib/walkableOverlay';
import { isWalkable } from '../src/lib/navigation';
import type { NavigationGrid } from '../src/types/scene';

const makeGrid = (width: number, height: number, blocked: number[], unknown: number[] = []): NavigationGrid => ({
  version: 1, coordinateSystem: 'x-z-grid', origin: { x: -1, z: 2 }, cellSize: 0.5, width, height, blocked, unknown,
  start: { x: 0, z: 0 }, clearanceMetres: 0.25,
}) as NavigationGrid;

describe('walkable overlay', () => {
  it('merges walkable cells into row runs, split by obstacles and unfilmed cells', () => {
    // Row 0: . . # . .   Row 1: . ? . . .
    const grid = makeGrid(5, 2, [2], [6]);
    expect(walkableRuns(grid)).toEqual([
      { z: 0, x0: 0, x1: 2 }, { z: 0, x0: 3, x1: 5 },
      { z: 1, x0: 0, x1: 1 }, { z: 1, x0: 2, x1: 5 },
    ]);
  });

  it('covers exactly the walkable cells (random grids)', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 50; trial += 1) {
      const width = 3 + Math.floor(random() * 12);
      const height = 2 + Math.floor(random() * 8);
      const blocked: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < width * height; i += 1) {
        const r = random();
        if (r < 0.25) blocked.push(i);
        else if (r < 0.35) unknown.push(i);
      }
      const grid = makeGrid(width, height, blocked, unknown);
      const covered = new Set<number>();
      for (const run of walkableRuns(grid)) for (let x = run.x0; x < run.x1; x += 1) covered.add(run.z * width + x);
      for (let z = 0; z < height; z += 1) {
        for (let x = 0; x < width; x += 1) expect(covered.has(z * width + x)).toBe(isWalkable(grid, { x, z }));
      }
    }
  });

  it('builds one quad per run at the given height, in world metres', () => {
    const grid = makeGrid(4, 1, [3]);
    const runs = walkableRuns(grid);
    const { positions, indices } = walkableMesh(grid, runs, 0.02);
    expect(runs).toEqual([{ z: 0, x0: 0, x1: 3 }]);
    expect(positions).toEqual([-1, 0.02, 2, 0.5, 0.02, 2, 0.5, 0.02, 2.5, -1, 0.02, 2.5]);
    expect(indices).toEqual([0, 1, 2, 0, 2, 3]);
  });
});
