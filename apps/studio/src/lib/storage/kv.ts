/**
 * KV store over IndexedDB (T10) — rooms/view-groups/scene selection/camera
 * poses snapshots. Values must be structured-clone-safe plain data
 * (`toPersistedSnapshot` strips object URLs, toasts, and pairing state).
 */
import type { IDBPDatabase } from 'idb';
import { mapStorageError } from './errors';
import { STORE_KV, type NammaSpaceSchema, type StorageHandle } from './db';

export function createKvStore(
  db: IDBPDatabase<NammaSpaceSchema>,
): Pick<StorageHandle, 'getKv' | 'putKv'> {
  return {
    async getKv<T>(key: string): Promise<T | null> {
      try {
        const value = await db.get(STORE_KV, key);
        return (value as T | undefined) ?? null;
      } catch (error) {
        throw mapStorageError(error, 'io-failure', `Local storage could not read "${key}".`);
      }
    },

    async putKv<T>(key: string, value: T): Promise<void> {
      try {
        await db.put(STORE_KV, value, key);
      } catch (error) {
        throw mapStorageError(error, 'io-failure', `Local storage could not write "${key}".`);
      }
    },
  };
}
