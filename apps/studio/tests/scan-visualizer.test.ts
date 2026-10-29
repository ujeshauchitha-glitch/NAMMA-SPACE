import { describe, expect, it } from 'vitest';

import {
  classifyFrame,
  cameraWorldMatrixFromForward,
  createContextGuard,
  createRendererRegistry,
  deriveGridMarker,
  disposeRenderer,
  framesFromPoses,
  isCollinear,
  lookAtViewMatrix,
  partitionFrames,
  poseToViewMatrix,
  poseToWorldMatrix,
  resolveVisualizerDuration,
  yawDegreesOf,
  type CoverageFrame,
  type Mat4,
  type RendererLike,
} from '../src/lib/scan/scene3d';
import { coverageFramesFromStagedImages } from '../src/components/workspace/coverageFrames';
import type { StagedImage } from '../src/state/types';

/**
 * T22 scan-visualizer suite — pure pose→matrix math, unposed classification,
 * disposal bookkeeping, and the single-context guard. No WebGL, no DOM, no
 * three (node env). The real three render path is proven by the T24 e2e
 * remount loop, not here — see the module header for the honesty note.
 */

/* ---------------- helpers ---------------- */

function fakeRenderer(): RendererLike & { contextLost: number; disposed: number } {
  return {
    contextLost: 0,
    disposed: 0,
    forceContextLoss() {
      this.contextLost += 1;
    },
    dispose() {
      this.disposed += 1;
    },
  };
}

/** Transform a point (w=1) by a column-major mat4. */
function transformPoint(m: Mat4, p: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

const close = (actual: readonly number[], expected: readonly number[], precision = 5) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], precision));
};

/** Column-major mat4 product a·b (apply b first, then a). */
function composeMat4(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/* ---------------- unposed classification (V1 honest path) ---------------- */

describe('frame classification', () => {
  it('classifies a frame without a pose as unposed', () => {
    const frame: CoverageFrame = { id: 'f1', label: 'frame 1', pose: null };
    expect(classifyFrame(frame)).toBe('unposed');
  });

  it('classifies a frame with a real pose as frustum', () => {
    const frame: CoverageFrame = {
      id: 'f1',
      label: 'frame 1',
      pose: { position: [0, 1.5, 0], target: [0, 1.5, -1] },
    };
    expect(classifyFrame(frame)).toBe('frustum');
  });

  it('partitions a mixed batch preserving order within each bucket', () => {
    const posed: CoverageFrame = {
      id: 'p',
      label: 'posed',
      pose: { position: [0, 0, 0], target: [0, 0, -1] },
    };
    const unposed: CoverageFrame = { id: 'u', label: 'unposed', pose: null };
    const { posed: p, unposed: u } = partitionFrames([unposed, posed, { id: 'u2', label: 'u2', pose: null }]);
    expect(p.map((f) => f.id)).toEqual(['p']);
    expect(u.map((f) => f.id)).toEqual(['u', 'u2']);
  });

  it('derives an honest origin-floor marker for an unposed frame', () => {
    const marker = deriveGridMarker({ id: 'f9', label: 'frame 9', pose: null });
    expect(marker.position).toEqual([0, 0, 0]);
    expect(marker.frameId).toBe('f9');
  });
});

/* ---------------- pose → matrix math ---------------- */

describe('pose → matrix math', () => {
  it('cameraWorldMatrixFromForward places position in the translation column', () => {
    const m = cameraWorldMatrixFromForward([1, 2, 3], [0, 0, -1]);
    expect(m).not.toBeNull();
    close([m![12], m![13], m![14]], [1, 2, 3]);
  });

  it('cameraWorldMatrixFromForward keeps local -Z mapped to the forward vector', () => {
    const m = cameraWorldMatrixFromForward([0, 0, 0], [0, 0, -1])!;
    const forward = transformPoint(m, [0, 0, -1]);
    close(forward, [0, 0, 1]); // local -Z = camera forward, so −forward = +Z here
    const up = transformPoint(m, [0, 1, 0]);
    close(up, [0, 1, 0]);
  });

  it('cameraWorldMatrixFromForward maps local -Z to the forward direction', () => {
    const m = cameraWorldMatrixFromForward([0, 0, 0], [1, 0, 0])!;
    // transformPoint composes M·p; local forward (0,0,-1) → −(col 2) = forward.
    const forward = transformPoint(m, [0, 0, -1]);
    close(forward, [1, 0, 0]); // camera looks along world +X
  });

  it('returns null for a zero-length forward', () => {
    expect(cameraWorldMatrixFromForward([0, 0, 0], [0, 0, 0])).toBeNull();
  });

  it('lookAtViewMatrix returns null for a coincident position/target', () => {
    expect(lookAtViewMatrix([1, 1, 1], [1, 1, 1])).toBeNull();
  });

  it('lookAtViewMatrix returns null when forward is parallel to up', () => {
    expect(lookAtViewMatrix([0, 0, 0], [0, 1, 0])).toBeNull(); // straight up
    expect(lookAtViewMatrix([0, 0, 0], [0, -5, 0])).toBeNull(); // straight down
  });

  it('lookAtViewMatrix maps the target to the camera -Z axis', () => {
    const view = lookAtViewMatrix([0, 0, 5], [0, 0, 0])!;
    const targetInCamera = transformPoint(view, [0, 0, 0]);
    // target sits 5 m in front ⇒ z = -5, x/y = 0.
    close(targetInCamera, [0, 0, -5]);
  });

  it('poseToViewMatrix maps the target to the camera -Z axis', () => {
    const pose = { position: [2, 1.6, 3] as const, target: [-1, 1.5, 0] as const };
    const view = poseToViewMatrix(pose)!;
    const targetInCamera = transformPoint(view, [-1, 1.5, 0]);
    // target lies exactly along the view -Z axis ⇒ x=y=0, z = -(distance).
    const distance = Math.hypot(2 - -1, 1.6 - 1.5, 3 - -0);
    close([targetInCamera[0], targetInCamera[1]], [0, 0]);
    expect(targetInCamera[2]).toBeCloseTo(-distance, 4);
  });

  it('poseToWorldMatrix is the exact inverse of poseToViewMatrix (world∘view = I)', () => {
    const pose = { position: [2, 1.6, 3] as const, target: [-1, 1.5, 0] as const };
    const world = poseToWorldMatrix(pose)!;
    const view = poseToViewMatrix(pose)!;
    // Column-major compose: (world·view) maps camera-local → camera-local.
    const product = composeMat4(world, view);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    close(Array.from(product), identity);
  });

  it('reports yaw of a pose forward direction', () => {
    expect(yawDegreesOf({ position: [0, 0, 0], target: [0, 0, -1] })).toBeCloseTo(180, 3);
    expect(yawDegreesOf({ position: [0, 0, 0], target: [1, 0, 0] })).toBeCloseTo(90, 3);
    expect(yawDegreesOf({ position: [0, 0, 0], target: [0, 0, 1] })).toBeCloseTo(0, 3);
  });

  it('detects collinear vectors', () => {
    expect(isCollinear([0, 1, 0], [0, 5, 0])).toBe(true);
    expect(isCollinear([0, 1, 0], [1, 0, 0])).toBe(false);
  });

  it('framesFromPoses maps a T14 CameraPose to a posed frame', () => {
    const frames = framesFromPoses([
      { id: 'cam1', label: 'Cam 1', position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 2, z: 0 }, yawDegrees: 45 },
    ]);
    expect(frames[0].pose?.position).toEqual([1, 2, 3]);
    expect(frames[0].pose?.target).toEqual([0, 2, 0]);
    expect(frames[0].pose?.yawDegrees).toBe(45);
  });
});

/* ---------------- staged images → coverage frames (V1 honest bridge) ---- */

describe('coverageFramesFromStagedImages (V1 honest bridge)', () => {
  const base = {
    viewGroupId: null,
    objectUrl: '',
    meta: { width: 1600, height: 900, bytes: 1024, sha256: 'x', source: 'phone' as const },
    stagedAt: 0,
  };

  it('treats staged phone frames as unposed (StagedImage carries no pose)', () => {
    const images: StagedImage[] = [
      { ...base, seq: 1, id: 'img-1' },
      { ...base, seq: 2, id: 'img-2' },
    ];
    const frames = coverageFramesFromStagedImages(images);
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.pose).toBeNull();
      expect(classifyFrame(frame)).toBe('unposed');
    }
  });

  it('preserves seq order so the grid is stable across re-renders', () => {
    const images: StagedImage[] = [
      { ...base, seq: 2, id: 'b' },
      { ...base, seq: 1, id: 'a' },
    ];
    const frames = coverageFramesFromStagedImages(images);
    expect(frames.map((f) => f.id)).toEqual(['b', 'a']);
  });
});

/* ---------------- renderer lifecycle bookkeeping ---------------- */

describe('renderer disposal bookkeeping', () => {
  it('unmount leaves zero live renderers', () => {
    const registry = createRendererRegistry();
    const renderer = registry.create(() => fakeRenderer());
    expect(registry.live()).toBe(1);
    registry.dispose(renderer);
    expect(registry.live()).toBe(0);
  });

  it('forces context loss then disposes exactly once per renderer', () => {
    const registry = createRendererRegistry();
    const renderer = fakeRenderer();
    registry.create(() => renderer);
    registry.dispose(renderer);
    expect(renderer.contextLost).toBe(1);
    expect(renderer.disposed).toBe(1);
  });

  it('double-dispose is idempotent (no double context loss)', () => {
    const registry = createRendererRegistry();
    const renderer = fakeRenderer();
    registry.create(() => renderer);
    registry.dispose(renderer);
    registry.dispose(renderer);
    expect(renderer.contextLost).toBe(1);
    expect(renderer.disposed).toBe(1);
    expect(registry.live()).toBe(0);
  });

  it('5 remounts leave zero live renderers (remount-stability invariant)', () => {
    const registry = createRendererRegistry();
    for (let i = 0; i < 5; i += 1) {
      const renderer = registry.create(() => fakeRenderer());
      registry.dispose(renderer);
    }
    expect(registry.created()).toBe(5);
    expect(registry.live()).toBe(0);
  });

  it('disposeRenderer tears down context then GPU resources', () => {
    const renderer = fakeRenderer();
    disposeRenderer(renderer);
    expect(renderer.contextLost).toBe(1);
    expect(renderer.disposed).toBe(1);
  });
});

/* ---------------- single-context guard (T9/T14 shell invariant) ---------------- */

describe('single-context guard', () => {
  it('first owner acquires, second is refused', () => {
    const guard = createContextGuard();
    expect(guard.acquire('scan-visualizer')).toBe(true);
    expect(guard.acquire('playcanvas-viewer')).toBe(false);
    expect(guard.owner()).toBe('scan-visualizer');
  });

  it('release frees the context for the next owner', () => {
    const guard = createContextGuard();
    guard.acquire('a');
    guard.release('a');
    expect(guard.busy()).toBe(false);
    expect(guard.acquire('b')).toBe(true);
  });

  it('a mismatched release does not free someone else’s context', () => {
    const guard = createContextGuard();
    guard.acquire('a');
    guard.release('b');
    expect(guard.busy()).toBe(true);
    expect(guard.owner()).toBe('a');
  });
});

/* ---------------- reduced motion (T23 seam) ---------------- */

describe('reduced-motion duration gate', () => {
  it('cuts to 0 under reduced motion', () => {
    expect(resolveVisualizerDuration(400, true)).toBe(0);
  });
  it('keeps the designed duration otherwise', () => {
    expect(resolveVisualizerDuration(400, false)).toBe(400);
  });
  it('clamps negatives to 0', () => {
    expect(resolveVisualizerDuration(-10, false)).toBe(0);
  });
});
