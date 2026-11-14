import { describe, expect, it } from 'vitest';
import { FADE_CUT_MS, FLIGHT_MAX_MS, fadeCutOpacity, flightDurationMs, flightPose, planFlight } from '../src/lib/routeFlight';
import { faceAngles } from '../src/lib/routeGuidance';
import { lineOfSight, planRoute } from '../src/lib/navigation';
import type { FloorPoint } from '../src/lib/poiIndex';
import type { NavigationGrid } from '../src/types/scene';

// An L-shaped corridor: 4 m along -z, then 3 m along +x. The POI stands 1 m beyond the end, higher up.
const path: FloorPoint[] = [[0, 0], [0, -4], [3, -4]];
const target: [number, number, number] = [4, 2.5, -4];
const plan = planFlight(path, 1.6, 1.6, 90, -10, target);
const forward = (yaw: number) => [-Math.sin((yaw * Math.PI) / 180), -Math.cos((yaw * Math.PI) / 180)];

describe('route flight', () => {
  it('is fast and never longer than 3 s', () => {
    expect(flightDurationMs(0)).toBeGreaterThanOrEqual(700);
    expect(flightDurationMs(7)).toBeLessThan(FLIGHT_MAX_MS);
    expect(flightDurationMs(500)).toBe(FLIGHT_MAX_MS);
  });

  it('starts at the current pose and ends at the route end facing the POI', () => {
    const start = flightPose(plan, 0);
    expect([start.x, start.z, start.yawDegrees, start.pitchDegrees]).toEqual([0, 0, 90, -10]);
    const end = flightPose(plan, 1);
    expect(end.x).toBeCloseTo(3);
    expect(end.z).toBeCloseTo(-4);
    const face = faceAngles([3, 1.6, -4], target);
    expect(end.yawDegrees).toBeCloseTo(face.yawDegrees);
    expect(end.pitchDegrees).toBeCloseTo(face.pitchDegrees);
    const [fx, fz] = forward(end.yawDegrees);
    expect(fx).toBeCloseTo(1); // looking along +x at the POI
    expect(fz).toBeCloseTo(0);
  });

  it('keeps the arrival heading when the POI stands on its approach point', () => {
    const onIt = planFlight(path, 1.6, 1.6, 0, 0, [3, 1.6, -4]);
    const end = flightPose(onIt, 1);
    const [fx, fz] = forward(end.yawDegrees);
    expect(fx).toBeCloseTo(1); // still travelling +x
    expect(fz).toBeCloseTo(0);
    expect(end.pitchDegrees).toBeCloseTo(0);
  });

  it('stays on the route the whole way, eased (slow, fast, slow)', () => {
    const steps = 60;
    const moved: number[] = [];
    let last = flightPose(plan, 0);
    for (let i = 1; i <= steps; i += 1) {
      const pose = flightPose(plan, i / steps);
      const onFirst = Math.abs(pose.x) < 1e-9 && pose.z <= 1e-9 && pose.z >= -4 - 1e-9;
      const onSecond = Math.abs(pose.z + 4) < 1e-9 && pose.x >= -1e-9 && pose.x <= 3 + 1e-9;
      expect(onFirst || onSecond).toBe(true);
      moved.push(Math.hypot(pose.x - last.x, pose.z - last.z));
      last = pose;
    }
    expect(moved[0]).toBeLessThan(moved[30]);
    expect(moved[59]).toBeLessThan(moved[30]);
  });

  it('looks along the route mid-flight', () => {
    const mid = flightPose(plan, 0.3); // on the first leg, travelling -z
    const [fx, fz] = forward(mid.yawDegrees);
    expect(fz).toBeLessThan(-0.9);
    expect(Math.abs(fx)).toBeLessThan(0.45);
  });

  it('a flight sampled on a real grid route never leaves walkable floor', () => {
    // 10 x 10 grid, 1 m cells, a wall at x = 5 except a gap at z = 8.
    const blocked = [];
    for (let z = 0; z < 10; z += 1) if (z !== 8) blocked.push(5 + z * 10);
    const grid: NavigationGrid = { version: 1, coordinateSystem: 'x-z-grid', origin: { x: 0, z: 0 }, cellSize: 1, width: 10, height: 10, blocked, unknown: [], start: { x: 2, z: 1 }, clearanceMetres: 0.3 };
    const planned = planRoute(grid, [2.5, 1.6, 1.5], [8.5, 1.6, 1.5]);
    if (!planned.ok) throw new Error('expected a route through the gap');
    const route: FloorPoint[] = planned.path.map((p): FloorPoint => [p[0], p[2]]);
    expect(Math.max(...route.map((p) => p[1]))).toBeGreaterThan(7.9); // it really goes round through the gap
    const flight = planFlight(route, 1.6, 1.6, 0, 0, [8.5, 1.6, 0.5]);
    let prev = flightPose(flight, 0);
    for (let i = 1; i <= 200; i += 1) {
      const pose = flightPose(flight, i / 200);
      expect(lineOfSight(grid, [prev.x, 0, prev.z], [pose.x, 0, pose.z])).toBe(true);
      prev = pose;
    }
  });
});

describe('fade cut', () => {
  it('fades to black at the half-way cut and back', () => {
    expect(fadeCutOpacity(0)).toBe(1);
    expect(fadeCutOpacity(FADE_CUT_MS / 4)).toBeCloseTo(0.5);
    expect(fadeCutOpacity(FADE_CUT_MS / 2)).toBeCloseTo(0);
    expect(fadeCutOpacity((3 * FADE_CUT_MS) / 4)).toBeCloseTo(0.5);
    expect(fadeCutOpacity(FADE_CUT_MS)).toBe(1);
  });
});
