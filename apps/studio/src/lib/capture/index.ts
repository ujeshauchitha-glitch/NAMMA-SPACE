/**
 * Capture intake + decode pipeline (T11). Pure helpers (sniff, resize, hash)
 * are DOM-free and node-testable; `decodeImage` is the browser path
 * (e2e-covered); `ingestFiles` orchestrates with injectable seams.
 */
export {
  HEIC_BRANDS,
  HEIC_REMEDY,
  UNSUPPORTED_TYPE_MESSAGE,
  classifyImageBytes,
  sniffImageKind,
} from './sniff';
export type { ImageClassification, ImageKind } from './sniff';
export { MAX_LONG_EDGE, computeTargetSize } from './resize';
export type { TargetSize } from './resize';
export { sha256Hex } from './hash';
export { DECODE_FAILED_MESSAGE, JPEG_QUALITY, decodeImage } from './decode';
export type { DecodedImage, DecodeOptions } from './decode';
export { EMPTY_FILE_MESSAGE, ingestFiles } from './ingest';
export type { IngestDeps, IngestOptions, IngestProgress, IngestResult, IngestStage } from './ingest';
export { IngestError } from './errors';
export type { IngestErrorCode } from './errors';
