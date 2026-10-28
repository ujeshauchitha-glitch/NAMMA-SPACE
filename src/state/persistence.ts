/**
 * Workspace persistence boundary (T9).
 *
 * The store depends only on this interface; T10 swaps in the IndexedDB
 * implementation. Snapshots are structured-clone-safe plain data — object
 * URLs, toast queues, and the pairing state machine are runtime concerns and
 * are never persisted (a reloaded tab re-pairs from IDLE honestly).
 */
import type { WorkspaceState } from './types';

export interface WorkspacePersistence {
  load(): Promise<WorkspaceState | null>;
  save(state: WorkspaceState): Promise<void>;
}

/** Strip runtime-only fields, producing the durable snapshot shape. */
export function toPersistedSnapshot(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    // Staged-image object URLs die with the tab that minted them; persisting
    // them would resurrect broken blob: links after reload.
    stagedImages: state.stagedImages.map((img) => ({ ...img, objectUrl: '' })),
    pairing: { state: 'IDLE', updatedAt: state.pairing.updatedAt },
    toasts: [],
    sceneSelection: state.sceneSelection,
    cameraPoses: state.cameraPoses,
  };
}

/** In-memory persistence: tests and honest non-persistent fallback. */
export function createMemoryPersistence(initial: WorkspaceState | null = null): WorkspacePersistence {
  let stored: WorkspaceState | null = initial;
  return {
    async load() {
      return stored ? (structuredClone(stored) as WorkspaceState) : null;
    },
    async save(state: WorkspaceState) {
      stored = structuredClone(toPersistedSnapshot(state)) as WorkspaceState;
    },
  };
}
