import { describe, expect, it } from 'vitest';
import { faceAngles, formatDistance, formatInstruction, formatWalkTime, nextInstruction, routeProgress } from '../src/lib/routeGuidance';
import type { FloorPoint } from '../src/lib/poiIndex';

// Walk 4 m along -z (the camera's default forward), then 3 m along +x: a RIGHT turn for the walker
// (facing -z, +x is to the right), then 2 m along -z again: a LEFT turn.
const path: FloorPoint[] = [[0, 0], [0, -4], [3, -4], [3, -6]];

describe('route progress', () => {
  it('projects the visitor onto the route', () => {
    const p = routeProgress(path, 0.2, -1);
    expect(p.along).toBeCloseTo(1);
    expect(p.remaining).toBeCloseTo(8);
    expect(p.offset).toBeCloseTo(0.2);
    expect(p.offRoute).toBe(false);
    expect(p.arrived).toBe(false);
  });

  it('flags off-route beyond 1 m and arrival within 0.75 m of the destination', () => {
    expect(routeProgress(path, 1.5, -1).offRoute).toBe(true);
    expect(routeProgress(path, 3.3, -5.5).arrived).toBe(true);
    expect(routeProgress(path, 3, -4.9).arrived).toBe(false);
  });
});

describe('next instruction', () => {
  it('announces the next sharp turn with its distance, left and right correctly', () => {
    expect(nextInstruction(path, 1)).toEqual({ kind: 'right', distance: 3 });
    expect(nextInstruction(path, 4.5)).toMatchObject({ kind: 'left' });
    expect(nextInstruction(path, 4.5).distance).toBeCloseTo(2.5);
    expect(nextInstruction(path, 7.5)).toMatchObject({ kind: 'arrive' });
    expect(nextInstruction(path, 7.5).distance).toBeCloseTo(1.5);
  });

  it('ignores gentle bends', () => {
    const gentle: FloorPoint[] = [[0, 0], [0, -4], [0.5, -8]]; // about 7 degrees
    expect(nextInstruction(gentle, 0).kind).toBe('arrive');
  });
});

describe('formatting', () => {
  it('reads naturally', () => {
    expect(formatInstruction({ kind: 'left', distance: 3 })).toBe('Turn left in 3 m');
    expect(formatInstruction({ kind: 'right', distance: 0.4 })).toBe('Turn right now');
    expect(formatInstruction({ kind: 'arrive', distance: 12.4 })).toBe('Arrive in 12 m');
    expect(formatInstruction({ kind: 'arrive', distance: 0.2 })).toBe('Arriving');
    expect(formatDistance(2.46)).toBe('2.5 m');
    expect(formatWalkTime(10)).toBe('about 10 s');
    expect(formatWalkTime(100)).toBe('about 1 min');
  });
});

describe('faceAngles', () => {
  // forward = (-sin yaw, -cos yaw): check the returned yaw really points at the target
  const forward = (yaw: number) => [-Math.sin((yaw * Math.PI) / 180), -Math.cos((yaw * Math.PI) / 180)];
  it('points the camera forward vector at the target on the floor plane', () => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, -3], [-4, 1]]) {
      const { yawDegrees } = faceAngles([0, 1.5, 0], [dx, 1.5, dz]);
      const [fx, fz] = forward(yawDegrees);
      const length = Math.hypot(dx, dz);
      expect(fx).toBeCloseTo(dx / length);
      expect(fz).toBeCloseTo(dz / length);
    }
  });
  it('looks up at higher targets and down at lower ones', () => {
    expect(faceAngles([0, 1.5, 0], [0, 2.5, -1]).pitchDegrees).toBeCloseTo(45);
    expect(faceAngles([0, 1.5, 0], [0, 0.5, -1]).pitchDegrees).toBeCloseTo(-45);
  });
});
