import { PoiSchema, type NavigationGrid, type Poi, type Vec3 } from '../types/scene';
import { cellToWorld, isWalkable, nearestWalkableCell, worldToCell } from './navigation';
import type { FloorPoint } from './poiIndex';

/**
 * Pure helpers behind the in-app POI editor: placing and moving POIs with an approach point snapped to
 * the nearest walkable cell, unique ids, a per-scene draft in localStorage, and schema-checked
 * import/export of pois.json.
 */

/** Height above the floor at which new pins are placed (roughly waist height, metres). */
export const PIN_HEIGHT_M = 1;

export type EditorContext = {
  grid: NavigationGrid | null;
  /** Floor height (the scene's lowest bound). */
  floorY: number;
  /** Eye height used for approach points, i.e. where the camera stands (the scene's start height). */
  eyeY: number;
};

/** Approach point for a floor position: centre of the nearest walkable cell at eye height, or null. */
export function snapApproach(context: EditorContext, x: number, z: number): Vec3 | null {
  if (!context.grid) return [x, context.eyeY, z];
  const cell = nearestWalkableCell(context.grid, worldToCell(context.grid, [x, 0, z]));
  return cell ? cellToWorld(context.grid, cell, context.eyeY) : null;
}

export function slugify(label: string): string {
  return label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'poi';
}

/** `base`, or `base-2`, `base-3`, … whichever is not taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** A new operator-authored POI at a floor point. Falls back to the point itself if nothing is walkable. */
export function createPoi(context: EditorContext, at: FloorPoint, existing: Poi[], label = 'New place'): Poi {
  const [x, z] = at;
  return {
    id: uniqueId(slugify(label), existing.map((poi) => poi.id)),
    label,
    category: 'other',
    position: [x, context.floorY + PIN_HEIGHT_M, z],
    approachPoint: snapApproach(context, x, z) ?? [x, context.eyeY, z],
    aliases: [],
    confidence: 1,
    source: 'operator',
  };
}

/** Move a POI on the floor; its approach point follows (re-snapped). Height and zone are kept. */
export function movePoi(context: EditorContext, poi: Poi, to: FloorPoint): Poi {
  const [x, z] = to;
  return { ...poi, position: [x, poi.position[1], z], approachPoint: snapApproach(context, x, z) ?? poi.approachPoint };
}

/** True when the POI's approach point is on a walkable cell (always true without a grid). */
export function approachIsWalkable(grid: NavigationGrid | null, poi: Poi): boolean {
  return !grid || isWalkable(grid, worldToCell(grid, poi.approachPoint));
}

/** Parse comma-separated aliases from a text field. */
export function parseAliases(text: string): string[] {
  return [...new Set(text.split(',').map((alias) => alias.trim()).filter(Boolean))];
}

/** pois.json text: validated against the viewer's schema, pretty-printed. Throws on invalid POIs. */
export function exportPois(pois: Poi[]): string {
  return `${JSON.stringify(PoiSchema.array().parse(pois), null, 2)}\n`;
}

/** Parse an imported pois.json; throws an Error with a readable message when it is not valid. */
export function importPois(text: string): Poi[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file.');
  }
  const parsed = PoiSchema.array().safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Not a valid pois.json: ${issue.path.join('.') || 'file'}: ${issue.message}`);
  }
  const ids = parsed.data.map((poi) => poi.id);
  if (new Set(ids).size !== ids.length) throw new Error('Not a valid pois.json: POI ids are not unique.');
  return parsed.data;
}

export const draftKey = (sceneId: string): string => `namma.poiDraft.${sceneId}`;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Saved draft for a scene, or null (missing, unreadable or invalid drafts are ignored). */
export function loadDraft(storage: StorageLike | undefined, sceneId: string): Poi[] | null {
  try {
    const text = storage?.getItem(draftKey(sceneId));
    return text ? importPois(text) : null;
  } catch {
    return null;
  }
}

export function saveDraft(storage: StorageLike | undefined, sceneId: string, pois: Poi[]): void {
  try {
    storage?.setItem(draftKey(sceneId), JSON.stringify(pois));
  } catch {
    // Private mode or full storage: the editor still works, the draft just is not kept.
  }
}

export function clearDraft(storage: StorageLike | undefined, sceneId: string): void {
  try {
    storage?.removeItem(draftKey(sceneId));
  } catch {
    // ignore
  }
}
