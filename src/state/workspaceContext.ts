/**
 * Workspace store context + hook (T9).
 *
 * Split from workspaceStore.tsx so that file exports only the provider
 * component (react-refresh/only-export-components stays clean).
 */
import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { WorkspaceAction, WorkspaceState } from './types';

export interface WorkspaceStoreValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  /** True once the persistence load has settled (saved snapshot or empty). */
  hydrated: boolean;
}

export const WorkspaceStoreContext = createContext<WorkspaceStoreValue | null>(null);

export function useWorkspaceStore(): WorkspaceStoreValue {
  const value = useContext(WorkspaceStoreContext);
  if (!value) throw new Error('useWorkspaceStore must be used inside a WorkspaceStoreProvider.');
  return value;
}
