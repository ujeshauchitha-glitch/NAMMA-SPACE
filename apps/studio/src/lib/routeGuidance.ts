import type { FloorPoint } from './poiIndex';
import { polylineLength } from './routeGeometry';

/**
 * Turn-by-turn guidance along a drawn route: where the visitor is along it, whether they have left it
 * or arrived, and the next instruction ("Turn left in 3 m").
 *
 * Headings follow the route geometry (atan2(dx, dz)). With y up and the camera's right along +x when
 * facing -z, a heading that increases is a turn to the visitor's left.
 */

/** Typical indoor walking pace used for time estimates (m/s). */
export const ESTIMATE_SPEED_M_S = 1.2;
/** Further than this from the route counts as off route (m). */
export const OFF_ROUTE_M = 1;
/** Within this of the destination counts as arrived (m). */
export const ARRIVE_M = 0.75;
/** Direction changes smaller than this are not announced (degrees). */
export const TURN_THRESHOLD_DEG = 30;

export type RouteProgress = {
  /** Distance travelled along the route to the visitor's nearest point on it (m). */
  along: number;
  remaining: number;
  /** Distance from the visitor to the route (m). */
  offset: number;
  offRoute: boolean;
  arrived: boolean;
};

/** Project a floor position onto the route. */
export function routeProgress(path: readonly FloorPoint[], x: number, z: number): RouteProgress {
  const length = polylineLength(path);
  let best = { along: 0, offset: Infinity };
  let walked = 0;
  for (let i = 1; i < path.length; i += 1) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const dx = bx - ax;
    const dz = bz - az;
    const segment = Math.hypot(dx, dz);
    const t = segment === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (segment * segment)));
    const offset = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (offset < best.offset - 1e-9) best = { along: walked + segment * t, offset };
    walked += segment;
  }
  if (path.length === 1) best = { along: 0, offset: Math.hypot(x - path[0][0], z - path[0][1]) };
  const [ex, ez] = path[path.length - 1];
  return {
    along: best.along,
    remaining: Math.max(0, length - best.along),
    offset: best.offset,
    offRoute: best.offset > OFF_ROUTE_M,
    arrived: Math.hypot(x - ex, z - ez) <= ARRIVE_M,
  };
}

export type Instruction = { kind: 'left' | 'right' | 'arrive'; distance: number };

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** The next turn sharper than TURN_THRESHOLD_DEG after `along` metres, or the arrival. */
export function nextInstruction(path: readonly FloorPoint[], along: number): Instruction {
  let walked = 0;
  for (let i = 1; i < path.length - 1; i += 1) {
    walked += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (walked <= along + 0.05) continue; // already past this corner
    const h1 = Math.atan2(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const h2 = Math.atan2(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    const turn = wrap(h2 - h1);
    if (Math.abs(turn) >= (TURN_THRESHOLD_DEG * Math.PI) / 180) return { kind: turn > 0 ? 'left' : 'right', distance: walked - along };
  }
  return { kind: 'arrive', distance: Math.max(0, polylineLength(path) - along) };
}

export function formatDistance(metres: number): string {
  if (metres < 1) return 'less than 1 m';
  return `${metres < 10 ? metres.toFixed(1).replace(/\.0$/, '') : Math.round(metres)} m`;
}

export function formatInstruction(instruction: Instruction): string {
  if (instruction.kind === 'arrive') return instruction.distance < 1 ? 'Arriving' : `Arrive in ${formatDistance(instruction.distance)}`;
  const turn = instruction.kind === 'left' ? 'Turn left' : 'Turn right';
  return instruction.distance < 1 ? `${turn} now` : `${turn} in ${formatDistance(instruction.distance)}`;
}

/** Estimated walking time for a distance, as a short phrase. */
export function formatWalkTime(metres: number, speed = ESTIMATE_SPEED_M_S): string {
  const seconds = Math.round(metres / speed);
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  return `about ${Math.round(seconds / 60)} min`;
}

/**
 * Camera yaw and pitch (degrees, PlayCanvas euler) that look from `from` toward `to`. The viewer's
 * forward vector is (-sin yaw, -cos yaw) on the floor and a positive pitch looks up.
 */
export function faceAngles(from: readonly [number, number, number], to: readonly [number, number, number]): { yawDegrees: number; pitchDegrees: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return {
    yawDegrees: (Math.atan2(-dx, -dz) * 180) / Math.PI,
    pitchDegrees: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
  };
}
