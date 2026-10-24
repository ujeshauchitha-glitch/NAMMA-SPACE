/**
 * Workspace store provider (T9): React context + useReducer over the pure
 * reducer.
 *
 *  - Hydrates from injected WorkspacePersistence on mount (empty on first run).
 *  - Persists every state change as a structured-clone-safe snapshot.
 *  - The reducer stays pure; all side effects live here.
 *
 * The context value and hook live in workspaceContext.ts.
 */
import { useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { initialWorkspaceState, workspaceReducer } from './reducer';
import { createMemoryPersistence, toPersistedSnapshot, type WorkspacePersistence } from './persistence';
import { WorkspaceStoreContext, type WorkspaceStoreValue } from './workspaceContext';

export function WorkspaceStoreProvider({
  children,
  persistence = createMemoryPersistence(),
}: {
  children: ReactNode;
  persistence?: WorkspacePersistence;
}): ReactNode {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);

  // Hydrate once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await persistence.load();
      if (!cancelled && saved) dispatch({ type: 'state/hydrate', state: saved });
    })();
    return () => {
      cancelled = true;
    };
  }, [persistence]);

  // Persist every settled change (snapshot strips runtime-only fields).
  useEffect(() => {
    void persistence.save(toPersistedSnapshot(state));
  }, [state, persistence]);

  const value: WorkspaceStoreValue = useMemo(() => ({ state, dispatch }), [state]);
  return <WorkspaceStoreContext.Provider value={value}>{children}</WorkspaceStoreContext.Provider>;
}
