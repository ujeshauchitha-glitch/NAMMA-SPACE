/**
 * Typed ingest failures (T11). Every rejection the pipeline raises is an
 * `IngestError` with a stable code and §9.1-voice copy — honest remedy,
 * never blame, never a silent skip.
 */
export type IngestErrorCode =
  /** HEIC/HEIF container — browsers cannot decode it; remedy copy attached. */
  | 'heic'
  /** Not JPEG/PNG/WebP (magic bytes authoritative, not the file name). */
  | 'unsupported-type'
  /** `createImageBitmap`/canvas re-encode failed (corrupt or truncated file). */
  | 'decode-failed'
  /** WebCrypto digest unavailable or failed (insecure context, etc.). */
  | 'hash-failed';

export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IngestError';
    this.code = code;
  }
}
