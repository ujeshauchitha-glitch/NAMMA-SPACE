/**
 * Single storage entry point (T10). Everything that reads or writes durable
 * workspace data imports from `src/lib/storage` — no other `src/` file may
 * reference `indexedDB` directly (grep-enforced cross-cutting standard).
 */
export { DB_NAME, DB_VERSION, STORE_IMAGES, STORE_KV, getDefaultStorage, openStorage } from './db';
export type { NammaSpaceSchema, StorageHandle, StorageOptions, StoredImageRecord } from './db';
export { QUOTA_EXCEEDED_MESSAGE, StorageError, isQuotaExceeded, mapStorageError } from './errors';
export type { StorageErrorCode } from './errors';
export { MAX_RAW_IMAGE_BYTES, assertImageWithinSizeLimit, createImageStore } from './images';
export { createKvStore } from './kv';
export { WORKSPACE_SNAPSHOT_KEY, createIdbPersistence } from './persistence';
export type { IdbPersistenceOptions } from './persistence';
