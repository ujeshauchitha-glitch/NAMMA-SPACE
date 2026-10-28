/**
 * Workstream D3 · viewer movement contract.
 *
 * The walkthrough step decision is a pure function so the honesty rules are
 * testable without a WebGL context: a step is accepted only into a verified
 * walkable cell, blocked and unknown cells are both refused, and a scene with
 * no navigation grid admits no steps at all (nothing is verified there).
 */
import { describe, expect, it } from 'vitest';
import { resolveWalkableStep } from '../src/lib/movement';
import type { NavigationGrid, Vec3 } from '../src/types/scene';

const grid: NavigationGrid = {
  version: 1,
  coordinateSystem: 'x-z-grid',
  origin: { x: 0, z: 0 },
  cellSize: 1,
  width: 5,
  height: 5,
  blocked: [6], // x=1, z=1
  unknown: [12], // x=2, z=2
  start: { x: 0, z: 0 },
  clearanceMetres: 0.2,
};

describe('walkable step resolution (D3)', () => {
  it('accepts a step into a verified walkable cell', () => {
    const candidate: Vec3 = [3.5, 1.65, 0.5];
    expect(resolveWalkableStep(grid, candidate)).toEqual(candidate);
  });

  it('refuses a step into a blocked cell', () => {
    expect(resolveWalkableStep(grid, [1.5, 1.65, 1.5])).toBeNull();
  });

  it('refuses a step into an unknown cell', () => {
    expect(resolveWalkableStep(grid, [2.5, 1.65, 2.5])).toBeNull();
  });

  it('refuses a step outside the grid', () => {
    expect(resolveWalkableStep(grid, [-0.5, 1.65, 0.5])).toBeNull();
    expect(resolveWalkableStep(grid, [9.5, 1.65, 9.5])).toBeNull();
  });

  it('refuses every step when the scene has no navigation grid', () => {
    expect(resolveWalkableStep(null, [0.5, 1.65, 0.5])).toBeNull();
    expect(resolveWalkableStep(null, [3.5, 1.65, 3.5])).toBeNull();
  });
});
