/**
 * Coverage-visualizer pure core (T22) — pose→matrix math, frame→marker
 * classification, disposal bookkeeping, and the single-context guard.
 *
 * HONESTY (§3.2, T14/T21): the phone frames staged in V1 are measured
 * photographs that carry **no pose data** (`ImageMeta` has width/height/
 * bytes/sha256/source only; the pairing protocol has no pose message). So
 * the visualizer renders a floor grid plus one *grid-plane marker* per staged
 * frame, and every marker is classified `unposed`. A frustum is only ever
 * built for a frame that supplies a real pose — never a guessed one.
 *
 * Everything here is DOM-free and three-free so it unit-tests in node. The
 * three/WebGL render path is an injected adapter (see CoverageVisualizer.tsx)
 * and is exercised only by the T24 e2e remount loop.
 */
import type { CameraPose } from '../../state/types';
import { momentDuration } from '../../motion';

export type Vec3Tuple = readonly [number, number, number];

/**
 * Camera pose in the visualizer's own convention (right-handed, +Y up,
 * metres). Accepts the T9 `CameraPose` shape (`Metres3` position/target) —
 * built on T14's pose model, never a parallel one.
 */
export type FramePose = {
  position: Vec3Tuple;
  /** Where the camera looks. Forward axis. */
  target: Vec3Tuple;
  yawDegrees?: number;
  pitchDegrees?: number;
};

/** A staged frame handed to the visualizer. `pose: null` ⇒ grid marker. */
export type CoverageFrame = {
  id: string;
  label: string;
  pose: FramePose | null;
};

export type FrameClassification = 'frustum' | 'unposed';

/**
 * Real pose ⇒ frustum; no pose ⇒ honest grid-plane marker. There is no
 * third "assume a pose" bucket by design.
 */
export function classifyFrame(frame: CoverageFrame): FrameClassification {
  return frame.pose ? 'frustum' : 'unposed';
}

/** Split a mixed batch exactly once; order preserved within each bucket. */
export function partitionFrames(frames: readonly CoverageFrame[]): {
  posed: CoverageFrame[];
  unposed: CoverageFrame[];
} {
  const posed: CoverageFrame[] = [];
  const unposed: CoverageFrame[] = [];
  for (const frame of frames) {
    (frame.pose ? posed : unposed).push(frame);
  }
  return { posed, unposed };
}

/* ---------------- column-major mat4 (three.js / GL layout) ---------------- */

export type Mat4 = readonly number[]; // length 16, column-major

const DEG_TO_RAD = Math.PI / 180;

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
}

const EPSILON = 1e-6;

/** True when the two vectors are collinear (cross product ≈ 0). */
export function isCollinear(a: Vec3Tuple, b: Vec3Tuple): boolean {
  const c = cross(a, b);
  return Math.hypot(c[0], c[1], c[2]) < EPSILON;
}

/**
 * Look-at view matrix (column-major), the inverse of a camera world matrix
 * looking from `position` toward `target` with +Y up. Degenerate inputs
 * (`position ≈ target`, or a forward parallel to +Y) return `null` rather
 * than a silent zero matrix — the caller keeps its last good matrix.
 */
export function lookAtViewMatrix(
  position: Vec3Tuple,
  target: Vec3Tuple,
  up: Vec3Tuple = [0, 1, 0],
): Mat4 | null {
  const zAxis = normalize(sub(position, target)); // camera looks down -Z
  if (Math.hypot(zAxis[0], zAxis[1], zAxis[2]) < EPSILON) return null; // coincident
  if (isCollinear(zAxis, up)) return null; // gimbal: forward ∥ up
  // Gram–Schmidt: when forward is tilted, up×z is not unit — normalize the
  // derived axes so the basis stays orthonormal and the target maps exactly
  // onto the camera -Z axis (three.js `lookAt` does the same).
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = normalize(cross(zAxis, xAxis));
  // three.js column-major: te[col*4 + row] = axis[col][row], so column `col`
  // holds that axis. Column 0 = x, 1 = y, 2 = z, 3 = translation.
  return [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -dot(xAxis, position), -dot(yAxis, position), -dot(zAxis, position), 1,
  ];
}

/**
 * Camera world matrix from an explicit forward direction (column-major).
 * Forward is the direction the camera looks; it becomes the matrix's -Z
 * column so `camera.getWorldDirection()` reads back the same forward.
 * Returns `null` for a zero-length forward.
 */
export function cameraWorldMatrixFromForward(
  position: Vec3Tuple,
  forward: Vec3Tuple,
): Mat4 | null {
  const f = normalize(forward);
  if (Math.hypot(f[0], f[1], f[2]) < EPSILON) return null;
  // A camera looks along local -Z, so world -Z must equal forward. Column 2
  // holds the true +Z axis (see packing note below), which is therefore
  // −forward.
  const zAxis: Vec3Tuple = [f[0], f[1], f[2]];
  const up: Vec3Tuple = Math.abs(zAxis[1]) > 1 - EPSILON ? [0, 0, 1] : [0, 1, 0];
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = normalize(cross(zAxis, xAxis));
  // three.js column-major: te[col*4 + row] = axis[col][row] ⇒ column `col`
  // holds that axis. Column 0 = x, 1 = y, 2 = z, 3 = translation.
  return [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    position[0], position[1], position[2], 1,
  ];
}

/**
 * Pose → camera world matrix (column-major). Built as the exact inverse of
 * `poseToViewMatrix` so a posed frustum's position and the coverage view
 * agree pixel-for-pixel. Degenerate poses return `null`.
 */
export function poseToWorldMatrix(pose: FramePose): Mat4 | null {
  const view = poseToViewMatrix(pose);
  if (!view) return null;
  return invertRigid(view);
}

/** Inverse of a rigid transform R|t → Rᵀ | −Rᵀt (column-major). */
export function invertRigid(m: Mat4): Mat4 {
  // Rotation is the upper-left 3×3, stored column-major.
  const r = (col: number, row: number) => m[col * 4 + row];
  const inv = new Array<number>(16).fill(0);
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      inv[col * 4 + row] = r(row, col); // transpose
    }
  }
  const t: Vec3Tuple = [m[12], m[13], m[14]];
  inv[12] = -(r(0, 0) * t[0] + r(0, 1) * t[1] + r(0, 2) * t[2]);
  inv[13] = -(r(1, 0) * t[0] + r(1, 1) * t[1] + r(1, 2) * t[2]);
  inv[14] = -(r(2, 0) * t[0] + r(2, 1) * t[1] + r(2, 2) * t[2]);
  inv[15] = 1;
  return inv as unknown as Mat4;
}

/** Pose → view matrix (world → camera). `null` on degenerate pose. */
export function poseToViewMatrix(pose: FramePose): Mat4 | null {
  return lookAtViewMatrix(pose.position, pose.target);
}

/** Readable yaw (deg) a pose's forward makes in the XZ plane, for the HUD. */
export function yawDegreesOf(pose: FramePose): number {
  const forward = sub(pose.target, pose.position);
  // atan2(x, z): 0° faces +Z, +90° faces +X (right-handed, +Y up).
  const yaw = Math.atan2(forward[0], forward[2]) / DEG_TO_RAD;
  return Math.round(yaw * 100) / 100;
}

/* ---------------- grid-plane marker derivation ---------------- */

/**
 * An unposed frame's marker: dropped onto the floor plane at the origin
 * (V1 has no pose, so the marker honestly sits at the scene origin rather
 * than pretending to know where the photo was taken).
 */
export type GridMarker = {
  frameId: string;
  position: Vec3Tuple; // on the y = 0 plane
  label: string;
};

export const FLOOR_Y = 0;

export function deriveGridMarker(frame: CoverageFrame, floorY: number = FLOOR_Y): GridMarker {
  return { frameId: frame.id, position: [0, floorY, 0], label: frame.label };
}

/* ---------------- renderer-lifecycle bookkeeping ---------------- */

/** The renderer seam the visualizer requires — satisfied by a real
 *  three.WebGLRenderer at runtime and by a fake in node tests. */
export type RendererLike = {
  forceContextLoss(): void;
  dispose(): void;
};

/** Construction/destruction tallies; a leak shows as `live() !== 0`. */
export type RendererRegistry = {
  create(make: () => RendererLike): RendererLike;
  dispose(renderer: RendererLike): void;
  /** Current live (created-but-not-disposed) renderers. */
  live(): number;
  /** Total ever created — for "no zombie after N remounts" assertions. */
  created(): number;
};

/**
 * Counts renderers and drives their full teardown. `unmountLeavesZero` and
 * the remount-stability invariant are both assertions on this registry —
 * the seam that makes "unmount leaves zero WebGLRenderer instances" provable
 * in node without a GPU.
 */
export function createRendererRegistry(): RendererRegistry {
  const liveSet = new Set<RendererLike>();
  let createdCount = 0;
  return {
    create(make) {
      const renderer = make();
      liveSet.add(renderer);
      createdCount += 1;
      return renderer;
    },
    dispose(renderer) {
      if (!liveSet.has(renderer)) return; // idempotent double-dispose guard
      liveSet.delete(renderer);
      renderer.forceContextLoss();
      renderer.dispose();
    },
    live: () => liveSet.size,
    created: () => createdCount,
  };
}

/** Full teardown for one renderer: context loss first, then dispose. */
export function disposeRenderer(renderer: RendererLike): void {
  renderer.forceContextLoss();
  renderer.dispose();
}

/** Everything the visualizer allocates that must not outlive an unmount. */
export type SceneDisposables = {
  renderer: RendererLike;
  /** Geometries/materials/textures the scene graph holds — disposed before
   *  the renderer so the context isn't torn down under live GPU resources. */
  disposeScene: () => void;
};

/**
 * The effect-free mount seam (T22): the React component's `useEffect` calls
 * this and its cleanup calls the returned `dispose`. Keeping it out of React
 * is what lets the disposal AC ("unmount leaves zero WebGLRenderer
 * instances") be proven in node — no DOM, no jsdom, no GPU.
 *
 * Guarded so it can never co-exist with the PlayCanvas app: `acquire` on the
 * cross-surface singleton fails fast, and the caller renders the honest
 * refusal instead of racing a second WebGL context (T9/T14 invariant).
 */
export type CoverageMount = {
  dispose: () => void;
};

export function mountCoverageScene(options: {
  makeRenderer: () => RendererLike;
  makeScene?: () => { dispose: () => void };
  registry?: RendererRegistry;
  guard?: ContextGuard;
  owner?: string;
}): CoverageMount {
  const {
    makeRenderer,
    makeScene,
    registry = createRendererRegistry(),
    guard = webglContextGuard,
    owner = 'coverage-visualizer',
  } = options;

  if (!guard.acquire(owner)) {
    throw new Error('WebGL context busy — visualizer refused to mount beside a live viewer.');
  }

  const renderer = registry.create(makeRenderer);
  const scene = makeScene?.() ?? null;
  let disposed = false;

  return {
    dispose() {
      if (disposed) return; // StrictMode double-invoke safe
      disposed = true;
      scene?.dispose(); // scene graph first …
      registry.dispose(renderer); // … then context loss + renderer dispose
      guard.release(owner);
    },
  };
}

/* ---------------- single-context invariant (T9/T14 shell rule) ---------------- */

/**
 * The shell may host at most ONE live 3D context at a time (the PlayCanvas
 * app in the viewer, this three visualizer in scan — never both). Mirrors
 * the ViewerCanvas counter so the two surfaces share one rule.
 */
export type ContextGuard = {
  /** Reserve the context; false ⇒ someone else already holds it. */
  acquire(owner: string): boolean;
  release(owner: string): void;
  /** True when a context is currently held. */
  busy(): boolean;
  /** Current owner, or null. */
  owner(): string | null;
};

export function createContextGuard(): ContextGuard {
  let current: string | null = null;
  return {
    acquire(owner) {
      if (current !== null) return false;
      current = owner;
      return true;
    },
    release(owner) {
      if (current === owner) current = null;
    },
    busy: () => current !== null,
    owner: () => current,
  };
}

/**
 * Cross-surface singleton (T22 AC): the visualizer and the PlayCanvas app
 * share ONE guard, so a live 3D context in either surface refuses the other.
 * A fresh guard per call (createContextGuard) is useless for this — the
 * whole point is that both surfaces see the same reservation.
 */
export const webglContextGuard: ContextGuard = createContextGuard();

/* ---------------- reduced motion (T23 seam) ---------------- */

/**
 * How long a settle/idle animation should run. Under reduced motion the
 * visualizer holds a static grid (no idle drift, no settle ease) — same
 * contract as `resolveTweenDuration` in the engine; both delegate to the
 * T23 registry (`momentDuration`) so the gate is defined once.
 */
export function resolveVisualizerDuration(baseMs: number, reducedMotion: boolean): number {
  return momentDuration(baseMs, reducedMotion);
}

/** Map a pose list to the coverage frames the visualizer renders. */
export function framesFromPoses(poses: readonly CameraPose[]): CoverageFrame[] {
  return poses.map((pose) => ({
    id: pose.id,
    label: pose.label,
    pose: {
      position: [pose.position.x, pose.position.y, pose.position.z],
      target: [pose.target.x, pose.target.y, pose.target.z],
      yawDegrees: pose.yawDegrees,
      pitchDegrees: pose.pitchDegrees,
    },
  }));
}
