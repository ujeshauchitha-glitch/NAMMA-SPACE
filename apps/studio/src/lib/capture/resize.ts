/**
 * Downscale math for the ingest pipeline (T11) — pure, DOM-free, exact.
 * Long edge is clamped to 2048 px; aspect ratio preserved; never returns
 * 0-sized dimensions.
 */
export const MAX_LONG_EDGE = 2048;

export type TargetSize = { width: number; height: number; resized: boolean };

export function computeTargetSize(
  width: number,
  height: number,
  maxLongEdge: number = MAX_LONG_EDGE,
): TargetSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Invalid image dimensions — width and height must be positive numbers.');
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height, resized: false };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}
