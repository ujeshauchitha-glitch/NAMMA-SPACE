import type { SceneManifest } from '../types/scene';

/**
 * Hide reconstruction "fog": Gaussian splats whose centre lies outside the scene's manifest bounds
 * (plus a margin) are made fully transparent. This uses PlayCanvas's supported work-buffer modifier
 * hook (modifySplatColor receives the splat's centre), so it runs once when the splats are written to
 * the work buffer, not every frame, and needs no reprocessing of the asset. The splat entity is placed
 * with an identity transform, so its space is the manifest's world space.
 */

/** Splats this far outside the declared bounds are still drawn (m). */
export const CROP_MARGIN_M = 0.3;

export function cropBox(bounds: SceneManifest['bounds'], margin = CROP_MARGIN_M): { min: [number, number, number]; max: [number, number, number] } {
  return {
    min: [bounds.min[0] - margin, bounds.min[1] - margin, bounds.min[2] - margin],
    max: [bounds.max[0] + margin, bounds.max[1] + margin, bounds.max[2] + margin],
  };
}

/** The same test the shader runs, for unit tests and tooling. */
export function insideCrop(box: ReturnType<typeof cropBox>, x: number, y: number, z: number): boolean {
  return x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1] && z >= box.min[2] && z <= box.max[2];
}

const num = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const vec = (v: readonly number[], type: string) => `${type}(${v.map(num).join(', ')})`;

/**
 * Work-buffer modifier for PlayCanvas unified gsplat rendering (GSplatComponent.setWorkBufferModifier):
 * it runs once when splats are written to the work buffer, not per frame, and zeroes the alpha of
 * splats whose centre is outside the box. The box is baked in as constants.
 */
export function cropModifier(box: ReturnType<typeof cropBox>): { glsl: string; wgsl: string } {
  const glslMin = vec(box.min, 'vec3');
  const glslMax = vec(box.max, 'vec3');
  const wgslMin = vec(box.min, 'vec3f');
  const wgslMax = vec(box.max, 'vec3f');
  return {
    glsl: `
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {}
void modifySplatColor(vec3 center, inout vec4 color) {
    if (any(lessThan(center, ${glslMin})) || any(greaterThan(center, ${glslMax}))) color.a = 0.0;
}
`,
    wgsl: `
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    if (any(center < ${wgslMin}) || any(center > ${wgslMax})) { (*color).a = 0.0; }
}
`,
  };
}
