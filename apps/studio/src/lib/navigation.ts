import { rankPois } from './poiSearch';
import type { NavigationGrid, Poi, Vec3 } from '../types/scene';

export type GridCell = { x: number; z: number };

export type RouteResult =
  /** cells/world: the raw grid path (cell centres); path: the same route string-pulled (fewer, straight legs). */
  | { ok: true; cells: GridCell[]; world: Vec3[]; path: Vec3[] }
  | { ok: false; reason: 'invalid-start' | 'invalid-goal' | 'unreachable' | 'invalid-grid'; detail: string };

function isInside(grid: NavigationGrid, cell: GridCell): boolean {
  return cell.x >= 0 && cell.x < grid.width && cell.z >= 0 && cell.z < grid.height;
}

// Captured scenes have thousands of blocked cells; a lookup table keeps the per-frame collision check
// and route search O(1) per cell instead of scanning the index lists.
const occupancyCache = new WeakMap<NavigationGrid, Uint8Array>();

function occupancy(grid: NavigationGrid): Uint8Array {
  let table = occupancyCache.get(grid);
  if (!table) {
    table = new Uint8Array(grid.width * grid.height);
    for (const index of grid.blocked) table[index] = 1;
    for (const index of grid.unknown) table[index] = 1;
    occupancyCache.set(grid, table);
  }
  return table;
}

function isBlocked(grid: NavigationGrid, cell: GridCell): boolean {
  return occupancy(grid)[cell.z * grid.width + cell.x] === 1;
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

/**
 * Heading (radians, atan2(x, z) of the view direction) to turn toward when the visitor faces a direction
 * nobody filmed from this cell, or null when the current heading is fine or the cell has no view data.
 */
export function filmedHeading(grid: NavigationGrid, cell: GridCell, heading: number): number | null {
  const sectors = grid.viewSectors;
  if (!sectors || !grid.views || !isInside(grid, cell)) return null;
  const mask = grid.views[cell.z * grid.width + cell.x] ?? 0;
  if (!mask) return null;
  const size = (2 * Math.PI) / sectors;
  const filmed = (k: number) => ((mask >> (((k % sectors) + sectors) % sectors)) & 1) === 1;
  const current = Math.floor((((heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / size);
  if (filmed(current)) return null;
  // Nearest edge of a filmed sector on either side.
  for (let step = 1; step < sectors; step += 1) {
    if (filmed(current + step)) return (current + step) * size;
    if (filmed(current - step)) return (current - step + 1) * size;
  }
  return null;
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

/**
 * Binary min-heap of grid cell indices keyed by f = g + h. Ties go to the lower h (closer to the goal),
 * then the lower index, so routes stay deterministic.
 */
class OpenHeap {
  private readonly items: number[] = [];
  private readonly f: Float64Array;
  private readonly h: Float64Array;
  public constructor(f: Float64Array, h: Float64Array) {
    this.f = f;
    this.h = h;
  }
  public get size(): number {
    return this.items.length;
  }
  private less(a: number, b: number): boolean {
    return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && (this.h[a] < this.h[b] || (this.h[a] === this.h[b] && a < b)));
  }
  public push(index: number): void {
    const items = this.items;
    items.push(index);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }
  public pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop() as number;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l], items[m])) m = l;
        if (r < items.length && this.less(items[r], items[m])) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over the 8-connected grid (octile heuristic, no diagonal corner cutting, unknown cells blocked)
 * between two exact cells. The open set is a binary heap with lazy deletion, so a search costs
 * O(n log n) in the cells it touches. Use planRoute() to route between world positions with snapping.
 */
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

  const width = grid.width;
  const g = new Float64Array(maxIndex).fill(Infinity);
  const f = new Float64Array(maxIndex).fill(Infinity);
  const h = new Float64Array(maxIndex);
  const cameFrom = new Int32Array(maxIndex).fill(-1);
  const closed = new Uint8Array(maxIndex);
  const open = new OpenHeap(f, h);
  const startIndex = start.z * width + start.x;
  const goalIndex = goal.z * width + goal.x;
  g[startIndex] = 0;
  h[startIndex] = heuristic(start, goal);
  f[startIndex] = h[startIndex];
  open.push(startIndex);

  while (open.size > 0) {
    const currentIndex = open.pop();
    if (closed[currentIndex]) continue; // stale heap entry (lazy deletion)
    if (currentIndex === goalIndex) {
      const cells: GridCell[] = [];
      for (let cursor = currentIndex; cursor !== -1; cursor = cameFrom[cursor]) cells.push({ x: cursor % width, z: Math.floor(cursor / width) });
      cells.reverse();
      const world = cells.map((cell) => cellToWorld(grid, cell));
      return { ok: true, cells, world, path: smoothPath(grid, world) };
    }
    closed[currentIndex] = 1;
    const current = { x: currentIndex % width, z: Math.floor(currentIndex / width) };
    for (const next of neighbors(grid, current)) {
      const nextIndex = next.z * width + next.x;
      if (closed[nextIndex]) continue;
      const stepCost = next.x !== current.x && next.z !== current.z ? DIAGONAL_STEP_COST : ORTHOGONAL_STEP_COST;
      const tentative = g[currentIndex] + stepCost;
      if (tentative < g[nextIndex]) {
        g[nextIndex] = tentative;
        h[nextIndex] = heuristic(next, goal);
        f[nextIndex] = tentative + h[nextIndex];
        cameFrom[nextIndex] = currentIndex;
        open.push(nextIndex);
      }
    }
  }

  return { ok: false, reason: 'unreachable', detail: 'No collision-safe route connects the current position to this destination.' };
}

/** Default snapping reach for planRoute: a visitor or approach point within 1.5 m of walkable floor. */
export const SNAP_RADIUS_M = 1.5;

/**
 * Walkable cell nearest (straight-line, between cell centres) to a world position, within `maxMetres`;
 * null when there is none that close.
 */
export function snapToWalkable(grid: NavigationGrid, position: Vec3, maxMetres = SNAP_RADIUS_M): GridCell | null {
  const cell = worldToCell(grid, position);
  if (isWalkable(grid, cell)) return cell;
  const reach = Math.ceil(maxMetres / grid.cellSize) + 1;
  let best: GridCell | null = null;
  let bestDistance = Infinity;
  for (let z = cell.z - reach; z <= cell.z + reach; z += 1) {
    for (let x = cell.x - reach; x <= cell.x + reach; x += 1) {
      if (!isWalkable(grid, { x, z })) continue;
      const [cx, , cz] = cellToWorld(grid, { x, z });
      const distance = Math.hypot(cx - position[0], cz - position[2]);
      if (distance <= maxMetres && distance < bestDistance) {
        best = { x, z };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Route between two world positions: both ends snap to the nearest walkable cell within
 * SNAP_RADIUS_M (so a visitor brushing a wall, or a POI approach point just off the floor, still
 * routes), then A* runs between the snapped cells.
 */
export function planRoute(grid: NavigationGrid, from: Vec3, to: Vec3, snapMetres = SNAP_RADIUS_M): RouteResult {
  const start = snapToWalkable(grid, from, snapMetres);
  if (!start) {
    return { ok: false, reason: 'invalid-start', detail: `No walkable point nearby: you are more than ${snapMetres} m from the walkable floor.` };
  }
  const goal = snapToWalkable(grid, to, snapMetres);
  if (!goal) {
    return { ok: false, reason: 'invalid-goal', detail: `No walkable point nearby: the destination is more than ${snapMetres} m from the walkable floor.` };
  }
  return findRoute(grid, start, goal);
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

/** Ranked, typo-tolerant search (see poiSearch.ts); kept for callers that only need the POIs. */
export function searchPois(pois: Poi[], query: string): Poi[] {
  if (!query.trim()) return pois;
  return rankPois(pois, query).map(({ poi }) => poi);
}

/**
 * Walking distance in metres from a world position to a POI's approach point along the navigation grid,
 * or null when either end is off the walkable area or no route connects them.
 */
export function walkingDistance(grid: NavigationGrid, from: Vec3, poi: Pick<Poi, 'approachPoint'>): number | null {
  const route = planRoute(grid, from, poi.approachPoint);
  return route.ok ? measureRouteMetres(route.path) : null;
}

/**
 * Nearest walkable cell to `cell` by breadth-first search over the grid (4-connected), or null when the
 * grid has no walkable cell within `maxRadius` cells. Used to snap POI approach points onto the floor
 * a visitor can actually reach.
 */
export function nearestWalkableCell(grid: NavigationGrid, cell: GridCell, maxRadius = Math.max(grid.width, grid.height)): GridCell | null {
  const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));
  const origin = { x: clamp(cell.x, grid.width), z: clamp(cell.z, grid.height) };
  // Start from the nearest in-grid cell, but measure the search radius from the requested cell.
  const seen = new Set<number>([origin.z * grid.width + origin.x]);
  const queue: GridCell[] = [origin];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (isWalkable(grid, current)) return current;
    if (Math.max(Math.abs(current.x - cell.x), Math.abs(current.z - cell.z)) >= maxRadius) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, z: current.z + dz };
      const index = next.z * grid.width + next.x;
      if (!isInside(grid, next) || seen.has(index)) continue;
      seen.add(index);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Grid line of sight between two world points on the floor: true when every cell the straight segment
 * touches is walkable. Conservative at cell corners (a segment through a corner needs both side cells),
 * so a smoothed route never clips a blocked or unknown cell, and the clearance baked into the grid holds.
 */
export function lineOfSight(grid: NavigationGrid, from: Vec3, to: Vec3): boolean {
  // Continuous cell coordinates.
  const ax = (from[0] - grid.origin.x) / grid.cellSize;
  const az = (from[2] - grid.origin.z) / grid.cellSize;
  const bx = (to[0] - grid.origin.x) / grid.cellSize;
  const bz = (to[2] - grid.origin.z) / grid.cellSize;
  let cx = Math.floor(ax);
  let cz = Math.floor(az);
  const endX = Math.floor(bx);
  const endZ = Math.floor(bz);
  if (!isWalkable(grid, { x: cx, z: cz })) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let tMaxX = stepX === 0 ? Infinity : (stepX > 0 ? cx + 1 - ax : ax - cx) * tDeltaX;
  let tMaxZ = stepZ === 0 ? Infinity : (stepZ > 0 ? cz + 1 - az : az - cz) * tDeltaZ;
  const EPS = 1e-9;
  let guard = Math.abs(endX - cx) + Math.abs(endZ - cz) + 4;
  while ((cx !== endX || cz !== endZ) && guard > 0) {
    guard -= 1;
    if (Math.abs(tMaxX - tMaxZ) < EPS) {
      // Through a corner: both side cells must be walkable, then step diagonally.
      if (!isWalkable(grid, { x: cx + stepX, z: cz }) || !isWalkable(grid, { x: cx, z: cz + stepZ })) return false;
      cx += stepX;
      cz += stepZ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (tMaxX > 1 + EPS && tMaxZ > 1 + EPS && (cx !== endX || cz !== endZ)) {
      // Floating-point drift past the end: finish on the end cell.
      cx = endX;
      cz = endZ;
    }
    if (!isWalkable(grid, { x: cx, z: cz })) return false;
  }
  return true;
}

/**
 * String-pulling: from each kept waypoint, jump to the farthest later waypoint that is in line of
 * sight. Every leg of the result therefore lies on walkable cells, and the result is never longer
 * than the raw path (each leg replaces a detour between the same two points with a straight line).
 */
export function smoothPath(grid: NavigationGrid, points: Vec3[]): Vec3[] {
  if (points.length <= 2) return points.slice();
  const result: Vec3[] = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let candidate = points.length - 1; candidate > anchor + 1; candidate -= 1) {
      if (lineOfSight(grid, points[anchor], points[candidate])) {
        next = candidate;
        break;
      }
    }
    result.push(points[next]);
    anchor = next;
  }
  return result;
}
