import type { Poi } from '../types/scene';

/** A point on the floor plane: [x, z] in metres. */
export type FloorPoint = [number, number];

/** A POI as the index sees it: its position, plus an optional floor zone polygon. */
export type IndexedPoi = Pick<Poi, 'id' | 'position'> & { zone?: FloorPoint[] };

/**
 * Uniform-grid spatial index over POIs on the x/z floor plane.
 *
 * Each POI is stored in the bucket that contains its position; a POI with a zone is also stored in
 * every bucket its zone's bounding box overlaps. Queries look only at the buckets near the query point,
 * so hit tests, "POIs within r metres" and nearest-k stay cheap as a venue grows to hundreds of POIs.
 * Distance to a POI is 0 inside its zone, the distance to the zone's edge outside it, and the distance
 * to its position for a plain point.
 */
export class PoiSpatialIndex<T extends IndexedPoi = IndexedPoi> {
  private readonly buckets = new Map<string, T[]>();

  public constructor(public readonly pois: readonly T[], public readonly cellSize = 2) {
    pois.forEach((poi) => {
      const [minX, minZ, maxX, maxZ] = poi.zone && poi.zone.length >= 3 ? polygonBounds(poi.zone) : [poi.position[0], poi.position[2], poi.position[0], poi.position[2]];
      for (let bx = this.bucket(minX); bx <= this.bucket(maxX); bx += 1) {
        for (let bz = this.bucket(minZ); bz <= this.bucket(maxZ); bz += 1) {
          const key = `${bx}:${bz}`;
          const list = this.buckets.get(key);
          if (list) list.push(poi);
          else this.buckets.set(key, [poi]);
        }
      }
    });
  }

  /** Floor distance from (x, z) to a POI: 0 inside its zone, else to the zone edge or its position. */
  public distance(poi: T, x: number, z: number): number {
    if (poi.zone && poi.zone.length >= 3) {
      return pointInPolygon(x, z, poi.zone) ? 0 : distanceToPolygonEdge(x, z, poi.zone);
    }
    return Math.hypot(poi.position[0] - x, poi.position[2] - z);
  }

  /** POIs within `radius` metres of (x, z), nearest first. */
  public within(x: number, z: number, radius: number): T[] {
    const found = new Map<string, { poi: T; d: number }>();
    for (let bx = this.bucket(x - radius); bx <= this.bucket(x + radius); bx += 1) {
      for (let bz = this.bucket(z - radius); bz <= this.bucket(z + radius); bz += 1) {
        this.buckets.get(`${bx}:${bz}`)?.forEach((poi) => {
          if (found.has(poi.id)) return;
          const d = this.distance(poi, x, z);
          if (d <= radius) found.set(poi.id, { poi, d });
        });
      }
    }
    return [...found.values()].sort((a, b) => a.d - b.d || a.poi.id.localeCompare(b.poi.id)).map(({ poi }) => poi);
  }

  /** The `k` POIs nearest to (x, z), nearest first. Searches outward ring by ring. */
  public nearest(x: number, z: number, k = 1): T[] {
    if (k <= 0 || this.pois.length === 0) return [];
    const best = new Map<string, { poi: T; d: number }>();
    const cx = this.bucket(x);
    const cz = this.bucket(z);
    const maxRing = this.maxRing(cx, cz);
    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (let bx = cx - ring; bx <= cx + ring; bx += 1) {
        for (let bz = cz - ring; bz <= cz + ring; bz += 1) {
          if (Math.max(Math.abs(bx - cx), Math.abs(bz - cz)) !== ring) continue; // ring perimeter only
          this.buckets.get(`${bx}:${bz}`)?.forEach((poi) => {
            if (!best.has(poi.id)) best.set(poi.id, { poi, d: this.distance(poi, x, z) });
          });
        }
      }
      // Anything not yet seen lies at least `ring * cellSize` away, so stop once k found are closer.
      const sorted = [...best.values()].sort((a, b) => a.d - b.d || a.poi.id.localeCompare(b.poi.id));
      if (sorted.length >= k && sorted[k - 1].d <= ring * this.cellSize) return sorted.slice(0, k).map(({ poi }) => poi);
    }
    return [...best.values()].sort((a, b) => a.d - b.d || a.poi.id.localeCompare(b.poi.id)).slice(0, k).map(({ poi }) => poi);
  }

  /** POIs whose zone contains (x, z), smallest zone first (a room inside a hall wins). */
  public zonesAt(x: number, z: number): T[] {
    const hits = (this.buckets.get(`${this.bucket(x)}:${this.bucket(z)}`) ?? [])
      .filter((poi) => poi.zone && poi.zone.length >= 3 && pointInPolygon(x, z, poi.zone));
    return hits.sort((a, b) => Math.abs(polygonArea(a.zone!)) - Math.abs(polygonArea(b.zone!)));
  }

  private bucket(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private maxRing(cx: number, cz: number): number {
    let ring = 0;
    this.buckets.forEach((_, key) => {
      const [bx, bz] = key.split(':').map(Number);
      ring = Math.max(ring, Math.abs(bx - cx), Math.abs(bz - cz));
    });
    return ring;
  }
}

/** Even-odd ray casting test; points exactly on an edge may fall either way. */
export function pointInPolygon(x: number, z: number, polygon: readonly FloorPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** [minX, minZ, maxX, maxZ] of a polygon. */
export function polygonBounds(polygon: readonly FloorPoint[]): [number, number, number, number] {
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/** Signed shoelace area (positive when counter-clockwise in x/z). */
export function polygonArea(polygon: readonly FloorPoint[]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    area += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  }
  return area / 2;
}

/** Area-weighted centroid; falls back to the vertex mean for degenerate polygons. */
export function polygonCentroid(polygon: readonly FloorPoint[]): FloorPoint {
  const area = polygonArea(polygon);
  if (Math.abs(area) < 1e-9) {
    return [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const cross = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    cx += (polygon[j][0] + polygon[i][0]) * cross;
    cz += (polygon[j][1] + polygon[i][1]) * cross;
  }
  return [cx / (6 * area), cz / (6 * area)];
}

function distanceToPolygonEdge(x: number, z: number, polygon: readonly FloorPoint[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    best = Math.min(best, distanceToSegment(x, z, polygon[j], polygon[i]));
  }
  return best;
}

function distanceToSegment(x: number, z: number, a: FloorPoint, b: FloorPoint): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq));
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}
