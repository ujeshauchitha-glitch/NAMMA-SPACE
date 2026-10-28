/**
 * `WorkspacePersistence` over IndexedDB (T10) — the implementation seam
 * declared by `src/state/persistence.ts`.
 *
 *  - `save` stores a `toPersistedSnapshot` (object URLs, toasts, and pairing
 *    state never reach disk).
 *  - Storage failures are reported through `onError` and never reject:
 *    a full disk must not break the running session, and the honest error
 *    still reaches the caller (log/toast), never a silent swallow.
 *  - `load` returns `null` on an empty store *or* on a read failure (the app
 *    starts from an honest empty state; `onError` carries the reason).
 */
import type { WorkspacePersistence } from '../../state/persistence';
import { toPersistedSnapshot } from '../../state/persistence';
import type { WorkspaceState } from '../../state/types';
import type { StorageHandle } from './db';
import { StorageError, mapStorageError } from './errors';

export const WORKSPACE_SNAPSHOT_KEY = 'workspace-snapshot.v1';

export type IdbPersistenceOptions = {
  onError?: (error: StorageError) => void;
};

export function createIdbPersistence(
  storage: StorageHandle,
  options: IdbPersistenceOptions = {},
): WorkspacePersistence {
  return {
    async load(): Promise<WorkspaceState | null> {
      try {
        return (await storage.getKv<WorkspaceState>(WORKSPACE_SNAPSHOT_KEY)) ?? null;
      } catch (error) {
        options.onError?.(
          mapStorageError(error, 'io-failure', 'The saved workspace could not be read.'),
        );
        return null;
      }
    },

    async save(state: WorkspaceState): Promise<void> {
      try {
        await storage.putKv(WORKSPACE_SNAPSHOT_KEY, toPersistedSnapshot(state));
      } catch (error) {
        options.onError?.(
          mapStorageError(error, 'io-failure', 'The workspace snapshot could not be saved.'),
        );
      }
    },
  };
}
