import type { NavigationGrid, Poi } from '../types/scene';
import { isWalkable, worldToCell } from './navigation';
import { pointInPolygon, type FloorPoint } from './poiIndex';

/**
 * Minimap maths (pure; drawn by components/viewer/Minimap.tsx on a 2D canvas).
 *
 * The map shows the floor plane from above. "North" is the scene's -z axis, the direction the camera
 * faces at yaw 0, so north-up puts -z at the top of the map. Heading-up rotates the map about the
 * visitor so their view direction points up.
 */

export type MinimapMode = 'north' | 'heading';

/** 2D affine map from floor (x, z) metres to canvas pixels: px = a·x + c·z + e, py = b·x + d·z + f. */
export type MapTransform = { a: number; b: number; c: number; d: number; e: number; f: number };

export type MapPose = { x: number; z: number; yawDegrees: number };

/** Pixels per metre that fit the whole grid inside the canvas, less a padding on every side. */
export function fitScale(grid: NavigationGrid, widthPx: number, heightPx: number, paddingPx = 6): number {
  const w = grid.width * grid.cellSize;
  const h = grid.height * grid.cellSize;
  return Math.max(1e-6, Math.min((widthPx - 2 * paddingPx) / w, (heightPx - 2 * paddingPx) / h));
}

/**
 * North-up: the grid's centre sits at the canvas centre. Heading-up: the visitor sits at the canvas
 * centre and the map turns by their yaw. Both use the same fit-to-canvas scale.
 */
export function minimapTransform(grid: NavigationGrid, widthPx: number, heightPx: number, mode: MinimapMode, pose: MapPose, paddingPx = 6): MapTransform {
  const s = fitScale(grid, widthPx, heightPx, paddingPx);
  const theta = mode === 'heading' ? (pose.yawDegrees * Math.PI) / 180 : 0;
  const pivotX = mode === 'heading' ? pose.x : grid.origin.x + (grid.width * grid.cellSize) / 2;
  const pivotZ = mode === 'heading' ? pose.z : grid.origin.z + (grid.height * grid.cellSize) / 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const a = s * cos;
  const b = s * sin;
  const c = -s * sin;
  const d = s * cos;
  return { a, b, c, d, e: widthPx / 2 - (a * pivotX + c * pivotZ), f: heightPx / 2 - (b * pivotX + d * pivotZ) };
}

export function toMap(t: MapTransform, x: number, z: number): [number, number] {
  return [t.a * x + t.c * z + t.e, t.b * x + t.d * z + t.f];
}

export function toFloor(t: MapTransform, px: number, py: number): FloorPoint {
  const det = t.a * t.d - t.b * t.c;
  const u = px - t.e;
  const v = py - t.f;
  return [(t.d * u - t.c * v) / det, (-t.b * u + t.a * v) / det];
}

/** The transform that draws the grid bitmap (one pixel per cell) in place: canvas setTransform arguments. */
export function gridImageTransform(grid: NavigationGrid, t: MapTransform): [number, number, number, number, number, number] {
  const s = grid.cellSize;
  const [e, f] = toMap(t, grid.origin.x, grid.origin.z);
  return [t.a * s, t.b * s, t.c * s, t.d * s, e, f];
}

/** Map direction (unit vector, canvas pixels) of the visitor's view: world forward is (-sin yaw, -cos yaw). */
export function headingOnMap(t: MapTransform, yawDegrees: number): [number, number] {
  const yaw = (yawDegrees * Math.PI) / 180;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dx = t.a * fx + t.c * fz;
  const dy = t.b * fx + t.d * fz;
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

export type GridTones = { walkable: [number, number, number, number]; blocked: [number, number, number, number]; unknown: [number, number, number, number] };

export const DEFAULT_TONES: GridTones = {
  walkable: [226, 230, 220, 255],
  blocked: [92, 98, 90, 255],
  unknown: [168, 172, 164, 110],
};

/** RGBA bytes, one pixel per grid cell (row z, column x): walkable, obstacle and unfilmed in three tones. */
export function gridPixels(grid: NavigationGrid, tones: GridTones = DEFAULT_TONES): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(grid.width * grid.height * 4);
  for (let i = 0; i < grid.width * grid.height; i += 1) pixels.set(tones.walkable, i * 4);
  for (const index of grid.unknown) if (index < grid.width * grid.height) pixels.set(tones.unknown, index * 4);
  for (const index of grid.blocked) if (index < grid.width * grid.height) pixels.set(tones.blocked, index * 4);
  return pixels;
}

/** POI under a map click: the nearest pin within `radiusPx`, else a zone containing the point, else null. */
export function poiAtMapPoint(pois: readonly Poi[], t: MapTransform, px: number, py: number, radiusPx = 9): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const poi of pois) {
    const [mx, my] = toMap(t, poi.position[0], poi.position[2]);
    const distance = Math.hypot(mx - px, my - py);
    if (distance <= radiusPx && (!best || distance < best.distance)) best = { id: poi.id, distance };
  }
  if (best) return best.id;
  const [x, z] = toFloor(t, px, py);
  return pois.find((poi) => poi.zone && pointInPolygon(x, z, poi.zone))?.id ?? null;
}

/** The floor point under a map click when it lands on a walkable cell (a "Route here" target), else null. */
export function walkableAtMapPoint(grid: NavigationGrid, t: MapTransform, px: number, py: number): FloorPoint | null {
  const [x, z] = toFloor(t, px, py);
  return isWalkable(grid, worldToCell(grid, [x, 0, z])) ? [x, z] : null;
}

/**
 * Identity of everything the map shows, rounded so that sub-centimetre jitter and sub-degree turns do not
 * trigger a redraw. The component redraws only when this changes.
 */
export function minimapDrawKey(parts: {
  pose: MapPose | null;
  mode: MinimapMode;
  widthPx: number;
  heightPx: number;
  selectedId: string | null;
  route: readonly FloorPoint[] | null;
}): string {
  const pose = parts.pose ? `${Math.round(parts.pose.x * 20)},${Math.round(parts.pose.z * 20)},${Math.round(parts.pose.yawDegrees)}` : '-';
  const route = parts.route ? `${parts.route.length}:${parts.route[0]?.join(',')}:${parts.route[parts.route.length - 1]?.join(',')}` : '-';
  return [pose, parts.mode, parts.widthPx, parts.heightPx, parts.selectedId ?? '-', route].join('|');
}
