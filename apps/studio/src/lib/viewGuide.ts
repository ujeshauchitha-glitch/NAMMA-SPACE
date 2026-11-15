/**
 * Optional "view guidance": after the visitor stops looking around, ease the view back toward a
 * direction that was actually filmed from where they stand (splats streak when seen from elsewhere).
 * Visitors read that drift as the mouse readjusting itself, so it is OFF unless the URL has ?guide=1
 * (kept for comparison). Without it the camera never turns without input, except explicit actions
 * (search turn-to-face, Follow route, Go to view).
 */

/** After the mouse rests this long the guide may start turning (ms). */
export const GUIDE_DELAY_MS = 350;
/** Per second: about 90% of the way back in one second. */
export const GUIDE_RATE = 2.5;
/** Pitch limit for splat scenes (degrees); at least ±60 so looking up and down is not cut short. */
export const SPLAT_MAX_PITCH_DEG = 60;

export function viewGuideEnabled(search: string): boolean {
  return new URLSearchParams(search).get('guide') === '1';
}

/**
 * Yaw change (degrees) to apply this frame while idle. Zero unless the guide is enabled, the visitor
 * has rested for GUIDE_DELAY_MS and a filmed heading exists. Headings are atan2(dx, dz) radians.
 */
export function idleYawStep(options: { enabled: boolean; msSinceLook: number; heading: number; filmedHeading: number | null; dt: number }): number {
  if (!options.enabled || options.msSinceLook < GUIDE_DELAY_MS || options.filmedHeading === null) return 0;
  const gap = Math.atan2(Math.sin(options.filmedHeading - options.heading), Math.cos(options.filmedHeading - options.heading));
  return ((gap * 180) / Math.PI) * (1 - Math.exp(-GUIDE_RATE * options.dt));
}
