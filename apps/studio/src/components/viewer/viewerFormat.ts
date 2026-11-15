/** Pure helpers behind the viewer's cards and search list (kept out of the component files for fast refresh). */
import type { Poi, Vec3 } from '../../types/scene';
import { formatDistance } from '../../lib/routeGuidance';

/** "x, z" of a position, one decimal (the destination card's approach point). */
export function formatPosition(position: Vec3): string {
  return `${position[0].toFixed(1)}, ${position[2].toFixed(1)}`;
}

/** Walking distance line: metres along the navigation grid, or why there is none. */
export function formatWalk(walkMetres: number | null | undefined): string {
  if (walkMetres === undefined) return 'Walking distance unavailable: this scene has no navigation grid';
  if (walkMetres === null) return 'No walkable route from where you are';
  if (walkMetres < 0.5) return 'You are here';
  return `${walkMetres < 10 ? walkMetres.toFixed(1) : Math.round(walkMetres)} m walk from where you are`;
}

/**
 * Pure keyboard step for the listbox highlight. Exported for jsdom-free unit
 * tests: `count <= 0` clears the highlight, an out-of-range `current` enters
 * from the far end (down → first, up → last), otherwise the index clamps.
 */
export function nextActiveIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return delta < 0 ? count - 1 : 0;
  const next = current + delta;
  if (next < 0) return 0;
  if (next > count - 1) return count - 1;
  return next;
}

/**
 * Row subline: `CATEGORY · walking distance`, plus `· confidence · SOURCE` in the authoring view.
 * Distance is omitted when unknown.
 */
export function formatPoiSubline(poi: Poi, metres?: number | null, authoring = true): string {
  const walk = metres === undefined ? '' : metres === null ? ' · no route' : ` · ${formatDistance(metres)} walk`;
  const provenance = authoring ? ` · ${poi.confidence.toFixed(2)} · ${poi.source.toUpperCase()}` : '';
  return `${poi.category.toUpperCase()}${walk}${provenance}`;
}
