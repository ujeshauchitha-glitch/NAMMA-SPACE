import type { NavigationGrid, Vec3 } from '../types/scene';
import { isWalkable, worldToCell } from './navigation';

/**
 * D3 · walkthrough step decision (pure, so it is testable without WebGL).
 *
 * A candidate step is accepted only when the destination cell is verified
 * walkable — `isWalkable` refuses blocked AND unknown cells, so the viewer
 * never steps into unverified space. A scene with no navigation grid admits
 * no steps at all: without a grid nothing is verified, and free-roam would
 * be an unverified claim (the viewer surfaces this as a status message
 * instead of silently moving).
 */
export function resolveWalkableStep(grid: NavigationGrid | null, candidate: Vec3): Vec3 | null {
  if (!grid) return null;
  return isWalkable(grid, worldToCell(grid, candidate)) ? candidate : null;
}
