import type { FloorPoint } from './poiIndex';
import { pointAtDistance, polylineLength } from './routeGeometry';
import { faceAngles } from './routeGuidance';

/**
 * "Go to view" as a fast flight along the walking route (so the camera never passes through walls),
 * eased in and out, ending at the destination's approach point facing the POI. Pure: the viewer
 * samples flightPose() every frame.
 */

export const FLIGHT_MAX_MS = 3000;
export const FLIGHT_MIN_MS = 700;
/** Total time of the cross-fade used when there is no route (fade out + fade in). */
export const FADE_CUT_MS = 360;

/** Flight time: grows with route length, never longer than FLIGHT_MAX_MS. */
export function flightDurationMs(lengthMetres: number): number {
  return Math.round(Math.min(FLIGHT_MAX_MS, Math.max(FLIGHT_MIN_MS, 500 + lengthMetres * 120)));
}

/** Smooth in-out ease (cubic). */
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

const smoothstep = (a: number, b: number, t: number) => {
  const c = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return c * c * (3 - 2 * c);
};

const lerpAngle = (from: number, to: number, t: number) => from + (((((to - from) % 360) + 540) % 360) - 180) * t;

export type FlightPlan = {
  path: readonly FloorPoint[];
  length: number;
  fromEyeY: number;
  toEyeY: number;
  fromYaw: number;
  fromPitch: number;
  /** The POI to face on arrival. */
  target: readonly [number, number, number];
};

export function planFlight(path: readonly FloorPoint[], fromEyeY: number, toEyeY: number, fromYaw: number, fromPitch: number, target: readonly [number, number, number]): FlightPlan {
  return { path, length: polylineLength(path), fromEyeY, toEyeY, fromYaw, fromPitch, target };
}

export type FlightPose = { x: number; y: number; z: number; yawDegrees: number; pitchDegrees: number };

/**
 * Camera pose at linear progress `t` (0..1). Position moves along the route with an in-out ease; the
 * view turns from the starting direction to the travel direction (first 15%), looks ahead along the
 * route, then turns to face the POI over the last 30%.
 */
export function flightPose(plan: FlightPlan, t: number): FlightPose {
  const eased = easeInOut(t);
  const along = plan.length * eased;
  const at = pointAtDistance(plan.path, along);
  const y = plan.fromEyeY + (plan.toEyeY - plan.fromEyeY) * eased;
  const end = pointAtDistance(plan.path, plan.length);
  // A POI standing on its own approach point has no direction to face: keep the arrival heading, level.
  const final = Math.hypot(plan.target[0] - end.x, plan.target[2] - end.z) > 0.05
    ? faceAngles([end.x, plan.toEyeY, end.z], plan.target)
    : { yawDegrees: faceAngles([0, 0, 0], [Math.sin(end.heading), 0, Math.cos(end.heading)]).yawDegrees, pitchDegrees: 0 };

  const ahead = pointAtDistance(plan.path, along + 1.5);
  const travelYaw = Math.hypot(ahead.x - at.x, ahead.z - at.z) > 1e-3
    ? faceAngles([at.x, y, at.z], [ahead.x, y, ahead.z]).yawDegrees
    : final.yawDegrees;

  const turnIn = smoothstep(0, 0.15, t);
  const turnOut = smoothstep(0.7, 1, t);
  let yawDegrees = lerpAngle(plan.fromYaw, travelYaw, turnIn);
  yawDegrees = lerpAngle(yawDegrees, final.yawDegrees, turnOut);
  const pitchDegrees = plan.fromPitch + (0 - plan.fromPitch) * turnIn + (final.pitchDegrees - 0) * turnOut;
  return { x: at.x, y, z: at.z, yawDegrees, pitchDegrees };
}

/** Canvas opacity during a fade-cut at elapsed `ms`, and whether the teleport should happen now. */
export function fadeCutOpacity(ms: number, total = FADE_CUT_MS): number {
  const half = total / 2;
  if (ms <= 0) return 1;
  if (ms >= total) return 1;
  return ms < half ? 1 - ms / half : (ms - half) / half;
}
