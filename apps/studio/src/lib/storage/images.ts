/**
 * Staged-image store over IndexedDB (T10).
 *
 * Owns the per-image size guard: raw payloads over 25 MB are rejected
 * **before** any write (and before T11's decode/resize pipeline ever runs on
 * them) with an honest, remedy-carrying error — never a silent skip.
 */
import type { IDBPDatabase } from 'idb';
import { StorageError, mapStorageError } from './errors';
import { STORE_IMAGES, type NammaSpaceSchema, type StoredImageRecord, type StorageHandle } from './db';

/** Raw capture bytes above this never enter decode/resize or storage. */
export const MAX_RAW_IMAGE_BYTES = 25 * 1024 * 1024;

/** Guard shared by storage (here) and the T11 ingest pipeline. Throws typed. */
export function assertImageWithinSizeLimit(bytes: number): void {
  if (bytes <= MAX_RAW_IMAGE_BYTES) return;
  const megabytes = (bytes / (1024 * 1024)).toFixed(1);
  throw new StorageError(
    'payload-too-large',
    `This image is ${megabytes} MB — staged images must be 25 MB or smaller. Export a smaller JPG, then retry.`,
  );
}

export function createImageStore(
  db: IDBPDatabase<NammaSpaceSchema>,
): Pick<StorageHandle, 'putImage' | 'getImage' | 'listImages' | 'deleteImage'> {
  return {
    async putImage(record: StoredImageRecord): Promise<void> {
      assertImageWithinSizeLimit(record.blob.size);
      try {
        await db.put(STORE_IMAGES, record, record.id);
      } catch (error) {
        throw mapStorageError(error, 'io-failure', 'The staged image could not be saved.');
      }
    },

    async getImage(id: string): Promise<StoredImageRecord | null> {
      try {
        const record = await db.get(STORE_IMAGES, id);
        return record ?? null;
      } catch (error) {
        throw mapStorageError(error, 'io-failure', 'The staged image could not be read.');
      }
    },

    async listImages(): Promise<StoredImageRecord[]> {
      try {
        const records = await db.getAll(STORE_IMAGES);
        // Deterministic staging order: stagedAt asc, id asc as the tie-break.
        return records.sort((a, b) => a.stagedAt - b.stagedAt || a.id.localeCompare(b.id));
      } catch (error) {
        throw mapStorageError(error, 'io-failure', 'The staged image list could not be read.');
      }
    },

    async deleteImage(id: string): Promise<void> {
      try {
        await db.delete(STORE_IMAGES, id);
      } catch (error) {
        throw mapStorageError(error, 'io-failure', 'The staged image could not be deleted.');
      }
    },
  };
}
