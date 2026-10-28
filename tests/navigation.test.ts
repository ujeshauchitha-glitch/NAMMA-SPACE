import { describe, expect, it } from 'vitest';
import { findRoute, inflateNavigationGrid, measureRouteMetres, searchPois, worldToCell } from '../src/lib/navigation';
import type { NavigationGrid, Poi } from '../src/types/scene';

const grid: NavigationGrid = {
  version: 1,
  coordinateSystem: 'x-z-grid',
  origin: { x: 0, z: 0 },
  cellSize: 1,
  width: 7,
  height: 7,
  blocked: [9, 16, 23, 30, 37],
  unknown: [],
  start: { x: 0, z: 0 },
  clearanceMetres: 0.2,
};

describe('A* navigation', () => {
  it('finds a route around a wall', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 6, z: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cells.some((cell) => cell.z > 1)).toBe(true);
  });

  it('rejects blocked destinations', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 2, z: 1 });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-goal' });
  });

  it('rejects a destination outside the map', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-goal' });
  });

  it('converts world positions to grid cells', () => {
    expect(worldToCell(grid, [2.2, 0, 4.8])).toEqual({ x: 2, z: 4 });
  });

  it('does not cut diagonally through two blocked corner cells', () => {
    const cornerGrid: NavigationGrid = { ...grid, width: 3, height: 3, blocked: [1, 3] };
    expect(findRoute(cornerGrid, { x: 0, z: 0 }, { x: 1, z: 1 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('reports disconnected targets as unreachable', () => {
    const disconnected: NavigationGrid = { ...grid, width: 3, height: 3, blocked: [1, 3, 4, 5, 7] };
    expect(findRoute(disconnected, { x: 0, z: 0 }, { x: 2, z: 2 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('inflates a narrow obstacle corridor without diagonal corner leaks', () => {
    const raw: NavigationGrid = { ...grid, width: 9, height: 7, blocked: [28, 29, 30, 32, 33, 34], unknown: [], start: { x: 4, z: 1 }, clearanceMetres: 0.5 };
    const inflated = inflateNavigationGrid(raw);
    expect(inflated.blocked).toEqual(expect.arrayContaining([28, 29, 30, 31, 32, 33, 34]));
    expect(findRoute(raw, { x: 4, z: 1 }, { x: 4, z: 5 }).ok).toBe(true);
    expect(findRoute(inflated, { x: 4, z: 1 }, { x: 4, z: 5 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('POI search', () => {
  const pois: Poi[] = [
    { id: 'desk', label: 'Registration Desk', category: 'service', position: [0, 0, 0], approachPoint: [0, 0, 1], aliases: ['help desk'], confidence: 1, source: 'synthetic' },
    { id: 'hall', label: 'Main Hall', category: 'room', position: [1, 0, 1], approachPoint: [1, 0, 2], aliases: ['exhibition'], confidence: 1, source: 'synthetic' },
  ];

  it('matches labels and aliases deterministically', () => {
    expect(searchPois(pois, 'help')[0]?.id).toBe('desk');
    expect(searchPois(pois, 'hall')[0]?.id).toBe('hall');
    expect(searchPois(pois, '').map((poi) => poi.id)).toEqual(['desk', 'hall']);
  });
});

// T16 · route status strip inputs (§5.16) — new cases only.
describe('route measurement (T16)', () => {
  it('measures a multi-cell route in world metres', () => {
    const result = findRoute(grid, { x: 0, z: 0 }, { x: 6, z: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cells.length).toBeGreaterThan(1);
    const metres = measureRouteMetres(result.world);
    expect(metres).toBeGreaterThan(0);
    // cellSize is 1 m; diagonal steps are √2, so the polyline stays under
    // one diagonal per cell.
    expect(metres).toBeLessThanOrEqual(result.cells.length * Math.SQRT2);
  });

  it('returns zero for a single-point path', () => {
    expect(measureRouteMetres([[0, 0, 0]])).toBe(0);
  });

  it('surfaces the unreachable detail verbatim for a blocked destination', () => {
    const disconnected: NavigationGrid = { ...grid, width: 3, height: 3, blocked: [1, 3, 4, 5, 7] };
    const result = findRoute(disconnected, { x: 0, z: 0 }, { x: 2, z: 2 });
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
    if (result.ok) return;
    expect(result.detail).toBe('No collision-safe route connects the current position to this destination.');
  });
});
