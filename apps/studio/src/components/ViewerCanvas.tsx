import { useEffect, useRef, useState } from 'react';
import type { NavigationGrid, Poi, SceneManifest, Vec3 } from '../types/scene';
import type { PlayCanvasViewer } from '../engine/PlayCanvasViewer';
import type { GridCell } from '../lib/navigation';

type ViewerCanvasProps = {
  manifest: SceneManifest;
  manifestUrl: string;
  navigation: NavigationGrid | null;
  pois: Poi[];
  onViewerReady: (viewer: PlayCanvasViewer) => void;
  onViewerDestroyed: () => void;
  onPosition: (position: Vec3, cell: GridCell) => void;
  onStatus: (status: string) => void;
};

/**
 * Single-context invariant (T14 / §7.4): the shell may host at most one live
 * PlayCanvas Application. The module counter is incremented synchronously
 * before the lazy engine chunk resolves, so a second mount refuses to init
 * instead of racing a second WebGL context. StrictMode's effect → cleanup →
 * effect cycle returns the count to 0 in between, so it never false-trips.
 */
let liveViewerCount = 0;

export function ViewerCanvas({ manifest, manifestUrl, navigation, pois, onViewerReady, onViewerDestroyed, onPosition, onStatus }: ViewerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contextConflict, setContextConflict] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (liveViewerCount >= 1) {
      setContextConflict(true);
      return;
    }
    liveViewerCount += 1;
    let disposed = false;
    let viewer: PlayCanvasViewer | null = null;
    void import('../engine/PlayCanvasViewer').then(({ PlayCanvasViewer: Viewer }) => {
      if (disposed || !canvasRef.current) return;
      viewer = new Viewer({
        canvas: canvasRef.current,
        manifestUrl,
        manifest,
        navigation,
        pois,
        callbacks: {
          onPosition,
          onStatus,
          onPointerLock: () => undefined,
        },
      });
      onViewerReady(viewer);
    }).catch((error: unknown) => {
      onStatus(`3D engine unavailable: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => {
      disposed = true;
      liveViewerCount -= 1;
      viewer?.destroy();
      onViewerDestroyed();
    };
  }, [manifest, navigation, onPosition, onStatus, onViewerDestroyed, onViewerReady, pois]);

  if (contextConflict) {
    // Honest refusal — never a second silent WebGL context.
    return (
      <p className="viewer-context-conflict" role="alert">
        3D view unavailable — another spatial viewer is already live in this session.
      </p>
    );
  }

  return <canvas ref={canvasRef} className="viewer-canvas" tabIndex={0} aria-label={`${manifest.displayName} 3D viewer`} />;
}
