/**
 * Screen-space maths for POI pins and labels, kept free of the engine so it can be unit-tested.
 *
 * Pins are 3D spheres whose world size is recomputed every frame so their on-screen size stays
 * between PIN_MIN_PX and PIN_MAX_PX at any distance. Labels are HTML elements placed over the canvas
 * from projected POI positions: they fade with distance, hide behind the camera or off screen, and
 * when two overlap the nearer POI keeps its label.
 */

export const PIN_MIN_PX = 12;
export const PIN_MAX_PX = 40;
/** World diameter a pin would have without clamping (metres). */
export const PIN_NOMINAL_M = 0.14;
/** Labels are fully opaque up to LABEL_FADE_START_M and gone beyond LABEL_MAX_M. */
export const LABEL_FADE_START_M = 8;
export const LABEL_MAX_M = 22;

/** Pixels per metre at one metre distance, for a vertical field of view over a viewport height. */
export function focalLengthPx(viewportHeightPx: number, verticalFovDeg: number): number {
  return viewportHeightPx / 2 / Math.tan((verticalFovDeg * Math.PI) / 360);
}

/** On-screen diameter (px) of a pin at `distance` metres, clamped to [PIN_MIN_PX, PIN_MAX_PX]. */
export function pinScreenPx(distance: number, focalPx: number, nominal = PIN_NOMINAL_M): number {
  const raw = (nominal * focalPx) / Math.max(distance, 1e-3);
  return Math.min(PIN_MAX_PX, Math.max(PIN_MIN_PX, raw));
}

/** World diameter (m) that makes a pin at `distance` metres appear `pinScreenPx` pixels wide. */
export function pinWorldDiameter(distance: number, focalPx: number, nominal = PIN_NOMINAL_M): number {
  return (pinScreenPx(distance, focalPx, nominal) * Math.max(distance, 1e-3)) / focalPx;
}

/** Label opacity for a POI `distance` metres away. */
export function labelOpacity(distance: number, fadeStart = LABEL_FADE_START_M, max = LABEL_MAX_M): number {
  if (distance <= fadeStart) return 1;
  if (distance >= max) return 0;
  return 1 - (distance - fadeStart) / (max - fadeStart);
}

export type ProjectedLabel = {
  id: string;
  /** Screen position of the label anchor (bottom centre), CSS pixels. */
  x: number;
  y: number;
  /** Camera-to-POI distance, metres. */
  distance: number;
  /** True when the POI is behind the camera plane. */
  behind: boolean;
  width: number;
  height: number;
  /** Selected or hovered labels are always placed first. */
  pinned?: boolean;
};

export type PlacedLabel = { id: string; x: number; y: number; opacity: number; visible: boolean };

/**
 * Decide which labels show and how opaque they are. Labels are considered nearest first (pinned ones
 * before all others); a label is hidden if it would overlap one already placed, sits behind the camera,
 * leaves the viewport, or has faded out completely.
 */
export function layoutLabels(labels: ProjectedLabel[], viewport: { width: number; height: number }, gapPx = 4): PlacedLabel[] {
  const placed: Array<[number, number, number, number]> = [];
  const order = [...labels].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.distance - b.distance || a.id.localeCompare(b.id));
  const result = new Map<string, PlacedLabel>();
  for (const label of order) {
    const opacity = label.pinned ? 1 : labelOpacity(label.distance);
    const left = label.x - label.width / 2;
    const top = label.y - label.height;
    const rect: [number, number, number, number] = [left - gapPx, top - gapPx, left + label.width + gapPx, top + label.height + gapPx];
    const onScreen = rect[2] > 0 && rect[0] < viewport.width && rect[3] > 0 && rect[1] < viewport.height;
    const overlaps = placed.some((other) => rect[0] < other[2] && rect[2] > other[0] && rect[1] < other[3] && rect[3] > other[1]);
    const visible = !label.behind && onScreen && opacity > 0.02 && !overlaps;
    if (visible) placed.push(rect);
    result.set(label.id, { id: label.id, x: label.x, y: label.y, opacity: visible ? opacity : 0, visible });
  }
  return labels.map((label) => result.get(label.id)!);
}
