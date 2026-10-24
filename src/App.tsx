import { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/shell/AppShell';
import { CaptureStudioWorkspace } from './components/workspace/CaptureStudioWorkspace';
import { LiveScanWorkspace } from './components/workspace/LiveScanWorkspace';
import { SpatialViewerWorkspace } from './components/workspace/SpatialViewerWorkspace';
import { DEFAULT_WORKSPACE, isWorkspaceId, type WorkspaceId } from './components/workspace/workspace';

/**
 * Composition root (T8): owns the active workspace and real connectivity
 * state; renders exactly one workspace panel at a time through AppShell
 * (inactive workspaces unmount — no zombie WebGL canvas).
 */
function resolveInitialWorkspace(): WorkspaceId {
  const requested = new URLSearchParams(window.location.search).get('workspace');
  return requested && isWorkspaceId(requested) ? requested : DEFAULT_WORKSPACE;
}

export default function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(resolveInitialWorkspace);
  const [sceneState, setSceneState] = useState('No scene loaded');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Stable identity so the viewer's mirror-effect doesn't loop.
  const handleSceneState = useCallback((label: string) => setSceneState(label), []);

  const stateLabel = activeWorkspace === 'viewer'
    ? sceneState
    : `Workspace · ${activeWorkspace === 'capture' ? 'capture studio' : 'live scan'}`;

  return (
    <AppShell
      activeWorkspace={activeWorkspace}
      onWorkspaceChange={setActiveWorkspace}
      stateLabel={stateLabel}
      isOnline={isOnline}
    >
      {activeWorkspace === 'capture' && <CaptureStudioWorkspace />}
      {activeWorkspace === 'viewer' && <SpatialViewerWorkspace onStateChange={handleSceneState} />}
      {activeWorkspace === 'scan' && <LiveScanWorkspace />}
    </AppShell>
  );
}
