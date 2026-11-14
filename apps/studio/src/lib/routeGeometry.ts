import type { FloorPoint } from './poiIndex';

/**
 * Geometry for drawing a route on the floor: polyline measures, a continuous ribbon mesh with mitred
 * joins, and points/headings at a distance along the route (for chevrons, guidance and auto-walk).
 * Headings are atan2(dx, dz) in radians, the same convention as the navigation grid's view sectors.
 */

export function polylineLength(points: readonly FloorPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

export type PointOnPath = { x: number; z: number; heading: number; segment: number };

/** Point and travel heading at `distance` metres along the polyline (clamped to its ends). */
export function pointAtDistance(points: readonly FloorPoint[], distance: number): PointOnPath {
  if (points.length === 1) return { x: points[0][0], z: points[0][1], heading: 0, segment: 0 };
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i += 1) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const length = Math.hypot(bx - ax, bz - az);
    if (remaining <= length || i === points.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, heading: Math.atan2(bx - ax, bz - az), segment: i - 1 };
    }
    remaining -= length;
  }
  const [x, z] = points[points.length - 1];
  return { x, z, heading: 0, segment: points.length - 2 };
}

/** The first `distance` metres of a polyline. */
export function slicePolyline(points: readonly FloorPoint[], distance: number): FloorPoint[] {
  if (points.length < 2 || distance <= 0) return points.slice(0, 1);
  const result: FloorPoint[] = [points[0]];
  let remaining = distance;
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (remaining < length) {
      const t = remaining / length;
      result.push([points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]);
      return result;
    }
    result.push(points[i]);
    remaining -= length;
  }
  return result;
}

/** Drop consecutive duplicate points (zero-length legs break joins). */
function dedupe(points: readonly FloorPoint[]): FloorPoint[] {
  return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-6);
}

/**
 * One continuous flat ribbon of `width` metres along the polyline at height y: two vertices per point,
 * offset along the mitre of adjacent legs (limited so sharp turns do not spike). Indices are two
 * triangles per leg.
 */
export function ribbonMesh(points: readonly FloorPoint[], width: number, y: number): { positions: number[]; indices: number[] } {
  const pts = dedupe(points);
  if (pts.length < 2) return { positions: [], indices: [] };
  const half = width / 2;
  const positions: number[] = [];
  const legNormal = (a: FloorPoint, b: FloorPoint): [number, number] => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    return [-dz / length, dx / length]; // left of travel
  };
  for (let i = 0; i < pts.length; i += 1) {
    const before = i > 0 ? legNormal(pts[i - 1], pts[i]) : null;
    const after = i < pts.length - 1 ? legNormal(pts[i], pts[i + 1]) : null;
    let nx: number;
    let nz: number;
    let scale = 1;
    if (before && after) {
      const mx = before[0] + after[0];
      const mz = before[1] + after[1];
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) {
        [nx, nz] = after; // a U-turn: no meaningful mitre
      } else {
        nx = mx / ml;
        nz = mz / ml;
        // Mitre length 1/cos(half turn), capped at 2x so sharp corners stay tidy.
        scale = Math.min(2, 1 / Math.max(1e-3, nx * after[0] + nz * after[1]));
      }
    } else {
      [nx, nz] = (before ?? after)!;
    }
    const [x, z] = pts[i];
    positions.push(x + nx * half * scale, y, z + nz * half * scale, x - nx * half * scale, y, z - nz * half * scale);
  }
  const indices: number[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = 2 * i;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { positions, indices };
}

/** Distances along a route of `length` metres at which chevrons sit, scrolling forward with `phase` metres. */
export function chevronDistances(length: number, spacing: number, phase: number, margin = 0.3): number[] {
  const out: number[] = [];
  const start = ((phase % spacing) + spacing) % spacing;
  for (let d = start + margin; d < length - margin; d += spacing) out.push(d);
  return out;
}
