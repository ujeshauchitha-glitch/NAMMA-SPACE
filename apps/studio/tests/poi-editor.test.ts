import { describe, expect, it } from 'vitest';
import { nearestWalkableCell } from '../src/lib/navigation';
import {
  approachIsWalkable, clearDraft, createPoi, draftKey, exportPois, importPois, loadDraft, movePoi, parseAliases, saveDraft, slugify, snapApproach, uniqueId,
  type EditorContext,
} from '../src/lib/poiEditor';
import type { NavigationGrid } from '../src/types/scene';

// 6 x 4 grid, 1 m cells; only the bottom row (z = 3) and the right column (x = 5) are walkable.
const walkable = new Set([18, 19, 20, 21, 22, 23, 5, 11, 17]);
const grid: NavigationGrid = {
  version: 1, coordinateSystem: 'x-z-grid', origin: { x: 0, z: 0 }, cellSize: 1, width: 6, height: 4,
  blocked: Array.from({ length: 24 }, (_, i) => i).filter((i) => !walkable.has(i)), unknown: [],
  start: { x: 0, z: 3 }, clearanceMetres: 0.25,
};
const context: EditorContext = { grid, floorY: 0, eyeY: 1.45 };

describe('nearest walkable cell', () => {
  it('returns the cell itself when walkable, else the nearest walkable one', () => {
    expect(nearestWalkableCell(grid, { x: 2, z: 3 })).toEqual({ x: 2, z: 3 });
    expect(nearestWalkableCell(grid, { x: 1, z: 2 })).toEqual({ x: 1, z: 3 });
    expect(nearestWalkableCell(grid, { x: 4, z: 0 })).toEqual({ x: 5, z: 0 });
  });
  it('clamps cells outside the grid and respects a search radius', () => {
    expect(nearestWalkableCell(grid, { x: 10, z: 10 })).toEqual({ x: 5, z: 3 });
    expect(nearestWalkableCell(grid, { x: 0, z: 0 }, 1)).toBeNull();
  });
});

describe('POI editor helpers', () => {
  it('snaps a new POI approach point to the nearest walkable cell centre at eye height', () => {
    const poi = createPoi(context, [1.5, 1.5], []);
    expect(poi.position).toEqual([1.5, 1, 1.5]);
    expect(poi.approachPoint).toEqual([1.5, 1.45, 3.5]);
    expect(approachIsWalkable(grid, poi)).toBe(true);
    expect(poi).toMatchObject({ id: 'new-place', category: 'other', source: 'operator' });
  });

  it('keeps ids unique and slugs readable', () => {
    expect(slugify('  Café / Main Hall! ')).toBe('cafe-main-hall');
    expect(uniqueId('desk', ['desk', 'desk-2'])).toBe('desk-3');
    expect(createPoi(context, [5.5, 0.5], [createPoi(context, [0.5, 3.5], [])]).id).toBe('new-place-2');
  });

  it('moves a POI and re-snaps its approach point', () => {
    const moved = movePoi(context, createPoi(context, [0.5, 3.5], []), [4.2, 0.4]);
    expect(moved.position).toEqual([4.2, 1, 0.4]);
    expect(moved.approachPoint).toEqual([5.5, 1.45, 0.5]);
  });

  it('works without a navigation grid', () => {
    expect(snapApproach({ grid: null, floorY: 0, eyeY: 1.6 }, 2, 3)).toEqual([2, 1.6, 3]);
  });

  it('parses aliases', () => {
    expect(parseAliases(' shelf, books,, shelf ')).toEqual(['shelf', 'books']);
  });

  it('exports schema-valid JSON and imports it back; rejects bad files', () => {
    const pois = [createPoi(context, [0.5, 3.5], []), { ...createPoi(context, [5.5, 0.5], [], 'Lab'), zone: [[4, 0], [6, 0], [6, 2]] as [number, number][] }];
    const text = exportPois(pois);
    expect(importPois(text)).toEqual(pois);
    expect(() => importPois('{nope')).toThrow('Not a JSON file');
    expect(() => importPois('[{"id":"x"}]')).toThrow('Not a valid pois.json');
    expect(() => importPois(JSON.stringify([pois[0], pois[0]]))).toThrow('not unique');
    expect(() => exportPois([{ ...pois[0], label: '' }])).toThrow();
  });

  it('keeps a per-scene draft in storage', () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
    const pois = [createPoi(context, [0.5, 3.5], [])];
    expect(loadDraft(storage, 'classroom')).toBeNull();
    saveDraft(storage, 'classroom', pois);
    expect(memory.has(draftKey('classroom'))).toBe(true);
    expect(loadDraft(storage, 'classroom')).toEqual(pois);
    expect(loadDraft(storage, 'apartment')).toBeNull();
    memory.set(draftKey('apartment'), 'garbage');
    expect(loadDraft(storage, 'apartment')).toBeNull();
    clearDraft(storage, 'classroom');
    expect(loadDraft(storage, 'classroom')).toBeNull();
  });
});
