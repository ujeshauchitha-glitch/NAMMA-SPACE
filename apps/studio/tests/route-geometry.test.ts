import { describe, expect, it } from 'vitest';
import { chevronDistances, pointAtDistance, polylineLength, ribbonMesh, slicePolyline } from '../src/lib/routeGeometry';
import type { FloorPoint } from '../src/lib/poiIndex';

const L: FloorPoint[] = [[0, 0], [0, 3], [4, 3]]; // 3 m along +z, then 4 m along +x

describe('route polyline', () => {
  it('measures length and finds points with their heading', () => {
    expect(polylineLength(L)).toBe(7);
    expect(pointAtDistance(L, 1)).toMatchObject({ x: 0, z: 1, heading: 0, segment: 0 });
    const p = pointAtDistance(L, 5);
    expect([p.x, p.z]).toEqual([2, 3]);
    expect(p.heading).toBeCloseTo(Math.PI / 2);
    expect(pointAtDistance(L, 99)).toMatchObject({ x: 4, z: 3 });
    expect(pointAtDistance(L, -1)).toMatchObject({ x: 0, z: 0 });
  });

  it('slices the first n metres', () => {
    expect(slicePolyline(L, 4)).toEqual([[0, 0], [0, 3], [1, 3]]);
    expect(slicePolyline(L, 0)).toEqual([[0, 0]]);
    expect(slicePolyline(L, 50)).toEqual(L);
  });
});

describe('ribbon mesh', () => {
  it('is one strip: two vertices per point, two triangles per leg, at the requested height', () => {
    const { positions, indices } = ribbonMesh(L, 0.2, 0.04);
    expect(positions).toHaveLength(3 * 2 * 3);
    expect(indices).toHaveLength(2 * 6);
    for (let i = 1; i < positions.length; i += 3) expect(positions[i]).toBe(0.04);
  });

  it('keeps straight legs exactly the ribbon width and mitres corners', () => {
    const { positions } = ribbonMesh(L, 0.2, 0);
    // first point, leg along +z: left/right are x = -0.1 / +0.1
    expect(positions[0]).toBeCloseTo(-0.1);
    expect(positions[3]).toBeCloseTo(0.1);
    // corner at (0, 3): the mitre is sqrt(2) times the half width, on the 45 degree diagonal
    const [cx, , cz, dx, , dz] = positions.slice(6, 12);
    expect(Math.hypot(cx - dx, cz - dz)).toBeCloseTo(0.2 * Math.SQRT2);
  });

  it('caps the mitre on hairpin turns and ignores duplicate points', () => {
    const hairpin: FloorPoint[] = [[0, 0], [0, 2], [0, 2], [0.05, 0]];
    const { positions } = ribbonMesh(hairpin, 0.2, 0);
    expect(positions).toHaveLength(3 * 2 * 3);
    for (let i = 0; i < positions.length; i += 3) expect(Math.abs(positions[i])).toBeLessThan(0.5);
  });
});

describe('chevrons', () => {
  it('scroll forward with the phase and stay inside the route', () => {
    expect(chevronDistances(5, 1, 0)).toEqual([0.3, 1.3, 2.3, 3.3, 4.3]);
    const moved = chevronDistances(5, 1, 0.5);
    expect(moved[0]).toBeCloseTo(0.8);
    expect(chevronDistances(5, 1, 3.5)).toEqual(moved);
    expect(chevronDistances(0.4, 1, 0)).toEqual([]);
  });
});
