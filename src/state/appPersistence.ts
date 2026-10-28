/**
 * App-wide `WorkspacePersistence` (T12): IndexedDB-backed with an honest
 * in-memory fallback for contexts where storage cannot open (private mode,
 * disabled site data). `idb` itself is lazy-imported inside the T10 module,
 * so this file stays light in the entry chunk.
 *
 * Failures never reject the running session: `load` falls back to the memory
 * store (fresh start) and `save` degrades to memory — the operator sees the
 * honest storage error through `onError`, never a silent data loss without
 * a reason.
 */
import { createIdbPersistence, getDefaultStorage, type StorageError } from '../lib/storage';
import { createMemoryPersistence, type WorkspacePersistence } from './persistence';
import type { WorkspaceState } from './types';

export type AppPersistenceOptions = {
  /** Reported when IndexedDB is unavailable or a read/write fails. */
  onStorageError?: (error: StorageError) => void;
};

export function createAppPersistence(options: AppPersistenceOptions = {}): WorkspacePersistence {
  const memory = createMemoryPersistence();
  let idb: WorkspacePersistence | null = null;
  let resolving: Promise<WorkspacePersistence | null> | null = null;

  async function resolve(): Promise<WorkspacePersistence | null> {
    if (idb) return idb;
    resolving ??= (async () => {
      try {
        const storage = await getDefaultStorage();
        idb = createIdbPersistence(storage, { onError: options.onStorageError });
        return idb;
      } catch (error) {
        options.onStorageError?.(error as StorageError);
        return null;
      }
    })();
    return resolving;
  }

  return {
    async load(): Promise<WorkspaceState | null> {
      const impl = await resolve();
      return impl ? impl.load() : memory.load();
    },
    async save(state: WorkspaceState): Promise<void> {
      const impl = await resolve();
      if (impl) await impl.save(state);
      else await memory.save(state);
    },
  };
}
