/**
 * Workspace store provider (T9): React context + useReducer over the pure
 * reducer.
 *
 *  - Hydrates from injected WorkspacePersistence on mount (empty on first run).
 *  - Exposes `hydrated` so consumers never seed or restore against a store
 *    whose durable snapshot has not landed yet (T12).
 *  - Persists every state change as a structured-clone-safe snapshot, but only
 *    after hydration — an early empty-state write could clobber the snapshot
 *    the load is about to return.
 *  - The reducer stays pure; all side effects live here.
 *
 * The context value and hook live in workspaceContext.ts.
 */
import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
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
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await persistence.load();
      if (cancelled) return;
      if (saved) dispatch({ type: 'state/hydrate', state: saved });
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [persistence]);

  // Persist every settled change (snapshot strips runtime-only fields) —
  // never before hydration, so the first render cannot overwrite saved data.
  useEffect(() => {
    if (!hydrated) return;
    void persistence.save(toPersistedSnapshot(state));
  }, [state, persistence, hydrated]);

  const value: WorkspaceStoreValue = useMemo(() => ({ state, dispatch, hydrated }), [state, hydrated]);
  return <WorkspaceStoreContext.Provider value={value}>{children}</WorkspaceStoreContext.Provider>;
}
