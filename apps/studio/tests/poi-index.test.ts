import { describe, expect, it } from 'vitest';
import { PoiSpatialIndex, pointInPolygon, polygonArea, polygonCentroid, rayFloorHit, triangulatePolygon, type FloorPoint, type IndexedPoi } from '../src/lib/poiIndex';

const point = (id: string, x: number, z: number): IndexedPoi => ({ id, position: [x, 1.4, z] });
const square = (x0: number, z0: number, size: number): FloorPoint[] => [[x0, z0], [x0 + size, z0], [x0 + size, z0 + size], [x0, z0 + size]];

describe('polygon helpers', () => {
  it('tests containment with the even-odd rule, including concave shapes', () => {
    const l: FloorPoint[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    expect(pointInPolygon(0.5, 0.5, l)).toBe(true);
    expect(pointInPolygon(3, 0.5, l)).toBe(true);
    expect(pointInPolygon(3, 3, l)).toBe(false); // the notch of the L
    expect(pointInPolygon(-1, 2, l)).toBe(false);
  });

  it('computes area and centroid', () => {
    expect(Math.abs(polygonArea(square(0, 0, 2)))).toBeCloseTo(4);
    expect(polygonCentroid(square(2, 4, 2))).toEqual([3, 5]);
  });
});

describe('PoiSpatialIndex', () => {
  const pois = [point('a', 0, 0), point('b', 3, 0), point('c', 0, 9), point('d', -20, -20)];
  const index = new PoiSpatialIndex(pois, 2);

  it('returns POIs within a radius, nearest first', () => {
    expect(index.within(0.5, 0, 3).map((p) => p.id)).toEqual(['a', 'b']);
    expect(index.within(0, 5, 1)).toEqual([]);
  });

  it('finds the nearest k even when they sit several buckets away', () => {
    expect(index.nearest(0, 8, 1).map((p) => p.id)).toEqual(['c']);
    expect(index.nearest(-15, -15, 2).map((p) => p.id)).toEqual(['d', 'a']);
    expect(index.nearest(100, 100, 10)).toHaveLength(4);
  });

  it('agrees with a brute-force scan on random data', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40 - 20;
    const many = Array.from({ length: 300 }, (_, i) => point(`p${i}`, rand(), rand()));
    const big = new PoiSpatialIndex(many, 1.5);
    for (let q = 0; q < 50; q += 1) {
      const [x, z] = [rand(), rand()];
      const brute = [...many].sort((a, b) => Math.hypot(a.position[0] - x, a.position[2] - z) - Math.hypot(b.position[0] - x, b.position[2] - z) || a.id.localeCompare(b.id));
      expect(big.nearest(x, z, 5).map((p) => p.id)).toEqual(brute.slice(0, 5).map((p) => p.id));
      const r = 3;
      const inRange = brute.filter((p) => Math.hypot(p.position[0] - x, p.position[2] - z) <= r).map((p) => p.id);
      expect(big.within(x, z, r).map((p) => p.id)).toEqual(inRange);
    }
  });

  it('indexes zones by bounding box: inside counts as distance 0, smallest zone wins', () => {
    const hall: IndexedPoi = { id: 'hall', position: [5, 0, 5], zone: square(0, 0, 10) };
    const room: IndexedPoi = { id: 'room', position: [2, 0, 2], zone: square(1, 1, 2) };
    const zoned = new PoiSpatialIndex([hall, room, point('kiosk', 8, 8)], 2);
    expect(zoned.zonesAt(2, 2).map((p) => p.id)).toEqual(['room', 'hall']);
    expect(zoned.zonesAt(8, 2).map((p) => p.id)).toEqual(['hall']);
    expect(zoned.zonesAt(20, 20)).toEqual([]);
    expect(zoned.distance(hall, 9, 9)).toBe(0);
    expect(zoned.distance(room, 4, 2)).toBeCloseTo(1); // 1 m outside the room's right edge
    expect(zoned.within(-1, 5, 1.5).map((p) => p.id)).toEqual(['hall']);
  });
});

describe('floor geometry', () => {
  it('triangulates convex and concave polygons into n-2 triangles covering the area', () => {
    for (const poly of [square(0, 0, 2), [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]] as FloorPoint[], [...square(0, 0, 3)].reverse()]) {
      const tris = triangulatePolygon(poly);
      expect(tris.length / 3).toBe(poly.length - 2);
      let area = 0;
      for (let i = 0; i < tris.length; i += 3) area += Math.abs(polygonArea([poly[tris[i]], poly[tris[i + 1]], poly[tris[i + 2]]]));
      expect(area).toBeCloseTo(Math.abs(polygonArea(poly)));
    }
  });

  it('intersects a camera ray with the floor', () => {
    expect(rayFloorHit([0, 1.5, 0], [0, -1, 1], 0)).toEqual([0, 1.5]);
    expect(rayFloorHit([0, 1.5, 0], [0, 1, 1], 0)).toBeNull(); // looking up
    expect(rayFloorHit([0, 1.5, 0], [1, 0, 0], 0)).toBeNull(); // parallel
  });
});
