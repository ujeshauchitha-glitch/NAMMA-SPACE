import { useEffect, useRef } from 'react';
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

export function ViewerCanvas({ manifest, manifestUrl, navigation, pois, onViewerReady, onViewerDestroyed, onPosition, onStatus }: ViewerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
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
      viewer?.destroy();
      onViewerDestroyed();
    };
  }, [manifest, navigation, onPosition, onStatus, onViewerDestroyed, onViewerReady, pois]);

  return <canvas ref={canvasRef} className="viewer-canvas" tabIndex={0} aria-label={`${manifest.displayName} 3D viewer`} />;
}
