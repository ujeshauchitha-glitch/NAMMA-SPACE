import type { NavigationGrid, Poi, Vec3 } from '../types/scene';

export type GridCell = { x: number; z: number };

export type RouteResult =
  | { ok: true; cells: GridCell[]; world: Vec3[] }
  | { ok: false; reason: 'invalid-start' | 'invalid-goal' | 'unreachable' | 'invalid-grid'; detail: string };

function key(cell: GridCell): string {
  return `${cell.x}:${cell.z}`;
}

function isInside(grid: NavigationGrid, cell: GridCell): boolean {
  return cell.x >= 0 && cell.x < grid.width && cell.z >= 0 && cell.z < grid.height;
}

function isBlocked(grid: NavigationGrid, cell: GridCell): boolean {
  const index = cell.z * grid.width + cell.x;
  return grid.blocked.includes(index) || grid.unknown.includes(index);
}

export function isWalkable(grid: NavigationGrid, cell: GridCell): boolean {
  return isInside(grid, cell) && !isBlocked(grid, cell);
}

/**
 * Inflate occupied cells for a player-radius clearance check. Scene authors
 * can use this when raw geometry has not already been baked into navigation.
 * The shipped fixture's blocked cells already include its documented 0.28m
 * clearance, so the viewer does not apply this a second time.
 */
export function inflateNavigationGrid(grid: NavigationGrid, radiusMetres = grid.clearanceMetres): NavigationGrid {
  const radiusCells = Math.ceil(Math.max(0, radiusMetres) / grid.cellSize);
  if (radiusCells === 0) return { ...grid, blocked: [...grid.blocked], unknown: [...grid.unknown] };
  const occupied = new Set([...grid.blocked, ...grid.unknown]);
  const inflated = new Set(occupied);
  occupied.forEach((index) => {
    const x = index % grid.width;
    const z = Math.floor(index / grid.width);
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        if (dx * dx + dz * dz > radiusCells * radiusCells) continue;
        const nextX = x + dx;
        const nextZ = z + dz;
        if (nextX >= 0 && nextX < grid.width && nextZ >= 0 && nextZ < grid.height) inflated.add(nextZ * grid.width + nextX);
      }
    }
  });
  const unknown = new Set(grid.unknown);
  return {
    ...grid,
    blocked: [...inflated].filter((index) => !unknown.has(index)).sort((a, b) => a - b),
    unknown: [...unknown].sort((a, b) => a - b),
  };
}

export function worldToCell(grid: NavigationGrid, position: Vec3): GridCell {
  return {
    x: Math.floor((position[0] - grid.origin.x) / grid.cellSize),
    z: Math.floor((position[2] - grid.origin.z) / grid.cellSize),
  };
}

export function cellToWorld(grid: NavigationGrid, cell: GridCell, y = 0.05): Vec3 {
  return [
    grid.origin.x + (cell.x + 0.5) * grid.cellSize,
    y,
    grid.origin.z + (cell.z + 0.5) * grid.cellSize,
  ];
}

/**
 * Step costs of the 8-connected grid model used by `findRoute`'s relaxation
 * step (formerly inline literals at the neighbour loop). Named so the
 * heuristic below provably matches the same cost model.
 */
const ORTHOGONAL_STEP_COST = 1;
const DIAGONAL_STEP_COST = 1.4142;

/**
 * Octile distance: the exact cost of the cheapest 8-connected path between two
 * cells on an obstacle-free grid under ORTHOGONAL/DIAGONAL step costs. Every
 * diagonal step covers one unit on each axis, so an optimal path uses
 * min(dx, dz) diagonals plus max(dx, dz) − min(dx, dz) straight steps.
 *
 * Admissible: obstacles and corner-cutting rules can only make real routes
 * more expensive, never cheaper, so h never overestimates the true cost.
 * Consistent: h(a) ≤ c(a, b) + h(b) holds for every orthogonal step
 * (Δh ≤ 1 = c) and every diagonal step (Δh ≤ 1.4142 = c), which is the
 * triangle inequality of the octile metric.
 */
function heuristic(a: GridCell, b: GridCell): number {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  const diagonals = Math.min(dx, dz);
  const straight = Math.max(dx, dz) - diagonals;
  return diagonals * DIAGONAL_STEP_COST + straight * ORTHOGONAL_STEP_COST;
}

function neighbors(grid: NavigationGrid, cell: GridCell): GridCell[] {
  const candidates: Array<{ cell: GridCell; diagonal: boolean }> = [
    { cell: { x: cell.x + 1, z: cell.z }, diagonal: false },
    { cell: { x: cell.x - 1, z: cell.z }, diagonal: false },
    { cell: { x: cell.x, z: cell.z + 1 }, diagonal: false },
    { cell: { x: cell.x, z: cell.z - 1 }, diagonal: false },
    { cell: { x: cell.x + 1, z: cell.z + 1 }, diagonal: true },
    { cell: { x: cell.x - 1, z: cell.z + 1 }, diagonal: true },
    { cell: { x: cell.x + 1, z: cell.z - 1 }, diagonal: true },
    { cell: { x: cell.x - 1, z: cell.z - 1 }, diagonal: true },
  ];

  return candidates
    .filter(({ cell: candidate, diagonal }) => {
      if (!isWalkable(grid, candidate)) return false;
      if (!diagonal) return true;
      return isWalkable(grid, { x: candidate.x, z: cell.z }) && isWalkable(grid, { x: cell.x, z: candidate.z });
    })
    .map(({ cell: candidate }) => candidate);
}

export function findRoute(grid: NavigationGrid, start: GridCell, goal: GridCell): RouteResult {
  const maxIndex = grid.width * grid.height;
  const allIndices = [...grid.blocked, ...grid.unknown];
  const hasDuplicateOccupancy = new Set(allIndices).size !== allIndices.length;
  if (grid.width <= 0 || grid.height <= 0 || allIndices.some((index) => index < 0 || index >= maxIndex) || hasDuplicateOccupancy) {
    return { ok: false, reason: 'invalid-grid', detail: 'The navigation grid dimensions or blocked indices are invalid.' };
  }
  if (grid.start.x >= grid.width || grid.start.z >= grid.height) {
    return { ok: false, reason: 'invalid-grid', detail: 'The navigation start cell is outside the grid bounds.' };
  }
  if (!isWalkable(grid, start)) {
    return { ok: false, reason: 'invalid-start', detail: 'The current position is outside the verified walkable area.' };
  }
  if (!isWalkable(grid, goal)) {
    return { ok: false, reason: 'invalid-goal', detail: 'The destination does not have a verified walkable approach point.' };
  }

  const open = new Map<string, GridCell>([[key(start), start]]);
  const cameFrom = new Map<string, string>();
  const cost = new Map<string, number>([[key(start), 0]]);

  while (open.size > 0) {
    const current = [...open.values()].sort((a, b) => {
      const scoreA = (cost.get(key(a)) ?? Infinity) + heuristic(a, goal);
      const scoreB = (cost.get(key(b)) ?? Infinity) + heuristic(b, goal);
      return scoreA - scoreB || a.z - b.z || a.x - b.x;
    })[0];

    if (!current) break;
    const currentKey = key(current);
    if (current.x === goal.x && current.z === goal.z) {
      const cells: GridCell[] = [current];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor) as string;
        const [x, z] = cursor.split(':').map(Number);
        cells.unshift({ x, z });
      }
      return { ok: true, cells, world: cells.map((cell) => cellToWorld(grid, cell)) };
    }

    open.delete(currentKey);
    for (const next of neighbors(grid, current)) {
      const nextKey = key(next);
      const stepCost = next.x !== current.x && next.z !== current.z ? DIAGONAL_STEP_COST : ORTHOGONAL_STEP_COST;
      const newCost = (cost.get(currentKey) ?? Infinity) + stepCost;
      if (newCost < (cost.get(nextKey) ?? Infinity)) {
        cameFrom.set(nextKey, currentKey);
        cost.set(nextKey, newCost);
        open.set(nextKey, next);
      }
    }
  }

  return { ok: false, reason: 'unreachable', detail: 'No collision-safe route connects the current position to this destination.' };
}

export function findPoi(pois: Poi[], poiId: string): Poi | undefined {
  return pois.find((poi) => poi.id === poiId);
}

/**
 * Walk-length of a route in world metres. `findRoute` returns `world` points
 * already in world coordinates (cell centres × cellSize + origin), so the
 * polyline is summed directly — no cellSize multiplication here.
 */
export function measureRouteMetres(world: Vec3[]): number {
  let total = 0;
  for (let index = 1; index < world.length; index += 1) {
    const [previousX, , previousZ] = world[index - 1];
    const [nextX, , nextZ] = world[index];
    total += Math.hypot(nextX - previousX, nextZ - previousZ);
  }
  return total;
}

export function searchPois(pois: Poi[], query: string): Poi[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return pois;
  return pois
    .map((poi) => {
      const haystack = [poi.label, poi.category, poi.description ?? '', ...poi.aliases].join(' ').toLowerCase();
      const score = haystack.startsWith(normalized) ? 2 : haystack.includes(normalized) ? 1 : 0;
      return { poi, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.poi.label.localeCompare(b.poi.label))
    .map(({ poi }) => poi);
}
