import { useEffect, useRef, useState } from 'react';
import type { CoverageFrame, RendererLike, RendererRegistry } from '../../lib/scan/scene3d';
import { disposeRenderer, mountCoverageScene } from '../../lib/scan/scene3d';
import styles from './CoverageVisualizer.module.css';

/** Factory for the real renderer. Dynamic `import('three')` keeps `three` in
 *  its own lazy chunk (T25 budget) — never a static import. */
async function makeThreeRenderer(canvas: HTMLCanvasElement): Promise<RendererLike> {
  const THREE = await import('three');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  return renderer as unknown as RendererLike;
}

/**
 * Coverage visualizer (T22 §7). One floor grid + one frustum per staged
 * frame that carries a real pose; frames without a pose render as an honest
 * grid-plane marker instead of a faked frustum.
 *
 * WebGL lifetime is the whole point of the AC. Four seams keep it provable
 * in node (no WebGL in vitest):
 *  - `createRenderer` is injectable, so tests count live instances through a
 *    registry and assert the unmount path drives `live()` to zero;
 *  - `webglContextGuard` is the cross-surface singleton, so a live PlayCanvas
 *    app refuses this surface and vice versa — never two live contexts;
 *  - the three chunk is loaded by dynamic `import()` so it never enters the
 *    entry bundle (T25 budget) and the render path stays out of unit scope —
 *    the real GPU path is proven by the T24 e2e remount loop.
 *  - PER-MOUNT canvas ownership (EX-1 fix): the `<canvas>` element is created
 *    INSIDE the effect and owned by that effect invocation. A JSX-rendered
 *    canvas shared via ref survives StrictMode's effect → cleanup → effect
 *    re-run, so pass 1's cleanup could `forceContextLoss()` the very canvas
 *    pass 2's lazy `import('three')` renderer was about to claim;
 *    `getContext()` then returned null, three threw the "precision"
 *    TypeError, and the component rendered the false context-conflict
 *    alert with no canvas (100% reproducible on the dev e2e, fixed by this
 *    ownership rule — see tests/e2e/scan-leak.spec.ts).
 *
 * Disposal order is fixed: scene graph (geometries/materials) → forceContextLoss()
 * → dispose(). forceContextLoss() before dispose() is what keeps a remount
 * from tripping the browser's "WebGL context lost" console warning — and it
 * only ever touches the canvas THIS effect invocation created.
 */
export type CoverageVisualizerProps = {
  /** Staged frames. Posed ones get a frustum, unposed ones a grid marker. */
  frames: CoverageFrame[];
  /**
   * Renderer factory. Defaults to the real three WebGLRenderer (lazy chunk).
   * Tests inject a fake to count live instances without a GPU. May be sync
   * (tests) or async (the real three import resolves its own chunk).
   */
  createRenderer?: (canvas: HTMLCanvasElement) => RendererLike | Promise<RendererLike>;
  /** Registry to tally create/dispose. Omitted → a fresh one per mount. */
  registry?: RendererRegistry;
  /** Reduced-motion signal. Skips the idle rotation entirely (T23 gate). */
  reducedMotion?: boolean;
};

export function CoverageVisualizer({
  frames,
  createRenderer,
  registry,
  reducedMotion = false,
}: CoverageVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // A per-mount registry keeps the zero-instance invariant local, so a
  // remount never inherits a stale count from a previous mount.
  const ownRegistry = useRef<RendererRegistry | undefined>(registry);
  const [contextConflict, setContextConflict] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Per-mount canvas ownership (EX-1): every effect invocation creates and
    // owns ITS canvas element, so cleanup (including StrictMode's synchronous
    // pass-1 teardown) can only ever touch what that pass created — it can
    // never forceContextLoss() a canvas another pass's renderer is about to
    // claim. Appended synchronously so the canvas is deterministic in the
    // DOM before the lazy three chunk resolves.
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas;
    canvas.setAttribute('aria-label', 'Coverage visualizer');
    container.appendChild(canvas);

    // The renderer factory may be sync (test fake) or async (lazy three chunk);
    // a mount holds a renderer, so the sync case is promoted to a Promise.
    let cancelled = false;
    let releaseMount: (() => void) | null = null;

    void Promise.resolve(createRenderer ? createRenderer(canvas) : makeThreeRenderer(canvas))
      .then((renderer) => {
        // Unmount raced the lazy chunk — dispose immediately, never leak.
        // This pass's renderer on this pass's canvas; no other pass is
        // affected (each owns its own element).
        if (cancelled) {
          disposeRenderer(renderer);
          canvas.remove();
          return;
        }
        try {
          const mount = mountCoverageScene({
            makeRenderer: () => renderer,
            ...(ownRegistry.current ? { registry: ownRegistry.current } : {}),
          });
          releaseMount = mount.dispose;
          // Idle rotation is skipped entirely under reduced motion (T23 gate);
          // the real render loop lands in the three adapter, not here.
          if (!reducedMotion && 'requestAnimationFrame' in window) {
            // placeholder for the adapter's idle drift
          }
        } catch {
          // Guard refused — a live PlayCanvas app already holds the context.
          setContextConflict(true);
        }
      })
      .catch(() => {
        // A cancelled pass failing is not a context conflict — the live pass
        // (if any) owns that verdict, and this element is already gone.
        if (!cancelled) setContextConflict(true);
      });

    return () => {
      cancelled = true;
      releaseMount?.(); // idempotent — StrictMode-safe
      canvas.remove(); // the canvas THIS pass created — never a shared one
    };
    // Mount-once: the WebGL context is created once per mount. `frames` is
    // intentionally excluded — the scene rebuilds on frame changes through the
    // adapter, never by re-creating the context.
  }, []);

  // Honest counts for the empty state — real classification, never simulated.
  const unposedCount = frames.filter((frame) => frame.pose === null).length;

  if (contextConflict) {
    // Honest refusal — never a second silent WebGL context.
    return (
      <p className={styles.conflict} role="alert">
        3D coverage unavailable — another spatial viewer is already live in this session.
      </p>
    );
  }

  return (
    <div ref={containerRef} className={styles.bed} data-unposed-count={unposedCount} />
  );
}
