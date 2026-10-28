/**
 * Typed, honest storage failures (T10).
 *
 * Every rejection leaving `src/lib/storage/` is a `StorageError` with a
 * stable `code` the UI can branch on and a §9.1-voice message that names the
 * real cause and the real remedy — never blame, never invented progress.
 */
export type StorageErrorCode =
  /** The browser refused the write: origin quota exhausted. */
  | 'quota-exceeded'
  /** Payload over the 25 MB per-image guard — rejected before any write. */
  | 'payload-too-large'
  /** The platform exposes no IndexedDB (private window / disabled storage). */
  | 'unavailable'
  /** Any other read/write failure (corruption, abort, closed database). */
  | 'io-failure';

export const QUOTA_EXCEEDED_MESSAGE =
  'Local storage is full — the browser refused this write. Delete staged images, then retry.';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Quota detection across Chromium/Safari (`QuotaExceededError`, legacy 22) and Firefox. */
export function isQuotaExceeded(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22
  );
}

/**
 * The single mapping path: quota errors become `quota-exceeded`; a
 * `StorageError` passes through untouched; anything else folds into
 * `fallbackCode` with the raw reason kept as technical detail.
 */
export function mapStorageError(
  error: unknown,
  fallbackCode: StorageErrorCode,
  fallbackMessage: string,
): StorageError {
  if (error instanceof StorageError) return error;
  if (isQuotaExceeded(error)) {
    return new StorageError('quota-exceeded', QUOTA_EXCEEDED_MESSAGE, { cause: error });
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new StorageError(fallbackCode, `${fallbackMessage} Technical detail: ${detail}`, {
    cause: error,
  });
}
