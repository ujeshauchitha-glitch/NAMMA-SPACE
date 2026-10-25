import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject } from 'react';
import { AppShell } from './components/shell/AppShell';
import { CaptureStudioWorkspace } from './components/workspace/CaptureStudioWorkspace';
import { LiveScanWorkspace } from './components/workspace/LiveScanWorkspace';
import { SpatialViewerWorkspace } from './components/workspace/SpatialViewerWorkspace';
import { ToastRegion } from './components/ui/Toast';
import { DEFAULT_WORKSPACE, isWorkspaceId, type WorkspaceId } from './components/workspace/workspace';
import { createAppPersistence } from './state/appPersistence';
import { createEntityId, useWorkspaceBootstrap } from './state/bootstrap';
import { WorkspaceStoreProvider } from './state/workspaceStore';
import { useWorkspaceStore } from './state/workspaceContext';
import type { WorkspaceAction } from './state/types';

/**
 * Composition root (T8 shell, T12 store wiring): owns the active workspace
 * and real connectivity state; renders exactly one workspace panel at a time
 * through AppShell (inactive workspaces unmount — no zombie WebGL canvas).
 *
 * The durable T9 store sits above the shell: IndexedDB-backed persistence
 * with an honest in-memory fallback, first-run seeding, and the toast region
 * (errors announce assertively — §5.9/§8.4).
 */

function resolveInitialWorkspace(): WorkspaceId {
  const requested = new URLSearchParams(window.location.search).get('workspace');
  return requested && isWorkspaceId(requested) ? requested : DEFAULT_WORKSPACE;
}

export default function App() {
  const dispatchRef = useRef<Dispatch<WorkspaceAction> | null>(null);

  // One persistence seam for the whole app. Storage failures surface as
  // assertive toasts instead of breaking the session (T10 error contract).
  const persistence = useMemo(
    () =>
      createAppPersistence({
        onStorageError: (error) =>
          dispatchRef.current?.({
            type: 'toast/push',
            toast: { id: createEntityId('toast'), tone: 'error', title: 'Local storage problem', detail: error.message },
          }),
      }),
    [],
  );

  return (
    <WorkspaceStoreProvider persistence={persistence}>
      <AppInner dispatchRef={dispatchRef} />
    </WorkspaceStoreProvider>
  );
}

function AppInner({ dispatchRef }: { dispatchRef: RefObject<Dispatch<WorkspaceAction> | null> }) {
  // The dispatch is stable for the lifetime of the store; the ref lets
  // persistence callbacks created above reach it after the first render.
  const { state, dispatch } = useWorkspaceStore();
  dispatchRef.current = dispatch;

  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(resolveInitialWorkspace);
  const [sceneState, setSceneState] = useState('No scene loaded');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  // First-run seed: one space, one room, the 8 §5.5 preset view groups.
  useWorkspaceBootstrap();

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
    <>
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
      <ToastRegion
        toasts={state.toasts}
        onDismiss={(id) => dispatch({ type: 'toast/dismiss', id })}
      />
    </>
  );
}
