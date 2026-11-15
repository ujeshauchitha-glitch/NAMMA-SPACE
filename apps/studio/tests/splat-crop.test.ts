import { describe, expect, it } from 'vitest';
import { CROP_MARGIN_M, cropBox, cropModifier, insideCrop } from '../src/engine/splatCrop';

const bounds = { min: [-6.777, 0, -5.64] as [number, number, number], max: [5.212, 2.648, 6.597] as [number, number, number] };

describe('splat crop', () => {
  it('grows the manifest bounds by the 0.3 m margin', () => {
    const box = cropBox(bounds);
    expect(CROP_MARGIN_M).toBe(0.3);
    expect(box.min[0]).toBeCloseTo(-7.077);
    expect(box.min[1]).toBeCloseTo(-0.3);
    expect(box.max[2]).toBeCloseTo(6.897);
  });

  it('keeps splats inside the margin and drops ones beyond it', () => {
    const box = cropBox(bounds);
    expect(insideCrop(box, 0, 1, 0)).toBe(true);
    expect(insideCrop(box, 5.4, 1, 0)).toBe(true); // 0.19 m outside the wall: within the margin
    expect(insideCrop(box, 5.6, 1, 0)).toBe(false);
    expect(insideCrop(box, 0, -0.35, 0)).toBe(false); // under the floor
    expect(insideCrop(box, 0, 3.0, 0)).toBe(false); // above the ceiling
  });

  it('emits all three modifier functions for both shading languages, with the box baked in', () => {
    const { glsl, wgsl } = cropModifier(cropBox(bounds));
    for (const fn of ['modifySplatCenter', 'modifySplatRotationScale', 'modifySplatColor']) {
      expect(glsl).toContain(`void ${fn}(`);
      expect(wgsl).toContain(`fn ${fn}(`);
    }
    expect(glsl).toContain('vec3(-7.077, -0.3,');
    expect(glsl).toContain('color.a = 0.0');
    expect(wgsl).toContain('vec3f(5.512, 2.948,');
    expect(cropModifier({ min: [0, 0, 0], max: [1, 2, 3] }).glsl).toContain('vec3(0.0, 0.0, 0.0)'); // integers stay floats
  });
});
