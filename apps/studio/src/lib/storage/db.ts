/**
 * IndexedDB access point (T10) — the ONLY module in `src/` that touches
 * `indexedDB` (enforced by grep: `grep -rn "indexedDB" src/ | grep -v
 * src/lib/storage` must be empty).
 *
 *  - `idb` is dynamically imported at open time (lazy chunk, standard §3.5).
 *  - DB `namma-space`, stores `staged-images` (Blob + meta + sha256) and `kv`
 *    (rooms/view-groups/poses/scene JSON snapshots).
 *  - The `IDBFactory` is injectable for node unit tests; the injection window
 *    is the synchronous `indexedDB.open` call inside `idb`'s `openDB`, so the
 *    global is restored before any other task can observe it.
 *  - Every failure leaves this module as a typed `StorageError` (errors.ts).
 */
import type { IDBPDatabase } from 'idb';
import type { ImageMeta } from '../../state/types';
import { StorageError, mapStorageError } from './errors';
import { createImageStore } from './images';
import { createKvStore } from './kv';

export const DB_NAME = 'namma-space';
export const DB_VERSION = 1;
export const STORE_IMAGES = 'staged-images';
export const STORE_KV = 'kv';

/** Blob + meta + sha256 for one staged frame; bytes live only here (T10). */
export type StoredImageRecord = {
  id: string;
  blob: Blob;
  meta: ImageMeta;
  stagedAt: number;
};

export type NammaSpaceSchema = {
  'staged-images': { key: string; value: StoredImageRecord };
  kv: { key: string; value: unknown };
};

export type StorageHandle = {
  putImage(record: StoredImageRecord): Promise<void>;
  getImage(id: string): Promise<StoredImageRecord | null>;
  listImages(): Promise<StoredImageRecord[]>;
  deleteImage(id: string): Promise<void>;
  getKv<T>(key: string): Promise<T | null>;
  putKv<T>(key: string, value: T): Promise<void>;
  close(): void;
};

export type StorageOptions = {
  /** Test seam: an in-memory IDBFactory (tests/storage.test.ts). */
  factory?: IDBFactory;
  /** Database name override (test isolation). */
  name?: string;
};

/**
 * Run `openDB` with `globalThis.indexedDB` temporarily pointing at `factory`.
 * `idb` reads the global exactly once, synchronously, inside `openDB(...)` —
 * so the patch window never crosses an await.
 */
function callWithIndexedDbFactory<T>(factory: IDBFactory | undefined, run: () => T): T {
  if (!factory) return run();
  const scope = globalThis as { indexedDB?: IDBFactory };
  const hadIndexedDb = 'indexedDB' in scope;
  const previous = scope.indexedDB;
  scope.indexedDB = factory;
  try {
    return run();
  } finally {
    if (hadIndexedDb) scope.indexedDB = previous;
    else delete scope.indexedDB;
  }
}

export async function openStorage(options: StorageOptions = {}): Promise<StorageHandle> {
  const platformFactory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!options.factory && !platformFactory) {
    throw new StorageError(
      'unavailable',
      'This browser context does not expose IndexedDB — workspace data cannot be stored locally. Leave private browsing, or allow site data for this origin, then reload.',
    );
  }

  let db: IDBPDatabase<NammaSpaceSchema>;
  try {
    const { openDB } = await import('idb');
    db = await callWithIndexedDbFactory(options.factory, () =>
      openDB<NammaSpaceSchema>(options.name ?? DB_NAME, DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(STORE_IMAGES)) {
            database.createObjectStore(STORE_IMAGES);
          }
          if (!database.objectStoreNames.contains(STORE_KV)) {
            database.createObjectStore(STORE_KV);
          }
        },
      }),
    );
  } catch (error) {
    throw mapStorageError(error, 'unavailable', 'Local storage could not be opened.');
  }

  const handle: StorageHandle = {
    ...createImageStore(db),
    ...createKvStore(db),
    close: () => {
      db.close();
    },
  };
  return handle;
}

let defaultStoragePromise: Promise<StorageHandle> | null = null;

/**
 * App-wide singleton (browser only — node has no IndexedDB and callers get an
 * honest `unavailable` rejection from `openStorage`).
 */
export function getDefaultStorage(): Promise<StorageHandle> {
  defaultStoragePromise ??= openStorage();
  return defaultStoragePromise;
}
