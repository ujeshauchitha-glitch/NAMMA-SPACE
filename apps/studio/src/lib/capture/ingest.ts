/**
 * Capture ingest orchestration (T11).
 *
 * Per file: size guard → magic-byte sniff → decode/resize/re-encode →
 * sha256 of the stored bytes → `putImage`. Every file settles as exactly one
 * `IngestResult` inside a per-file try/catch — one bad file never aborts the
 * batch, and nothing is ever silently skipped. Object URLs are NOT created
 * here: thumbnails mint URLs through `src/lib/objectUrls.ts` (registry) so
 * revocation stays single-owned (lifecycle rule §3.3).
 */
import {
  StorageError,
  assertImageWithinSizeLimit,
  type StorageErrorCode,
  type StoredImageRecord,
} from '../storage';
import type { ImageMeta, ImageSource } from '../../state/types';
import { IngestError, type IngestErrorCode } from './errors';
import { decodeImage, type DecodedImage } from './decode';
import { sha256Hex } from './hash';
import { classifyImageBytes } from './sniff';

export const EMPTY_FILE_MESSAGE = 'This file is empty — no image data to stage.';

export type IngestStage = 'sniff' | 'decode' | 'hash' | 'store' | 'settled';

export type IngestProgress = {
  file: string;
  /** Files fully settled (stored or rejected) after this event. */
  completed: number;
  total: number;
  stage: IngestStage;
};

export type IngestResultBody =
  | { ok: true; record: StoredImageRecord }
  | { ok: false; code: IngestErrorCode | StorageErrorCode; message: string };

export type IngestResult = IngestResultBody & { file: string };

export type IngestDeps = {
  /** Storage write seam — the T10 module's `putImage` in production. */
  putImage: (record: StoredImageRecord) => Promise<void>;
  /** Decode seam; defaults to the real browser pipeline. */
  decode?: (file: Blob) => Promise<DecodedImage>;
  /** Injected clock (deterministic tests). */
  now?: () => number;
};

export type IngestOptions = {
  /** Provenance travels with the data (§5.19): operator picks, phone frames. */
  source?: ImageSource;
  onProgress?: (progress: IngestProgress) => void;
};

function createImageId(): string {
  const webcrypto = globalThis.crypto;
  if (typeof webcrypto?.randomUUID === 'function') return webcrypto.randomUUID();
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function failureOf(error: unknown): { code: IngestErrorCode | StorageErrorCode; message: string } {
  if (error instanceof IngestError) return { code: error.code, message: error.message };
  if (error instanceof StorageError) return { code: error.code, message: error.message };
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: 'decode-failed',
    message: `Staging failed for an unexpected reason — the file was skipped. Technical detail: ${detail}`,
  };
}

export async function ingestFiles(
  files: readonly File[],
  deps: IngestDeps,
  options: IngestOptions = {},
): Promise<IngestResult[]> {
  const decode = deps.decode ?? decodeImage;
  const now = deps.now ?? (() => Date.now());
  const source: ImageSource = options.source ?? 'operator';
  const total = files.length;
  let completed = 0;
  const results: IngestResult[] = [];

  const emit = (file: string, stage: IngestStage) => {
    options.onProgress?.({ file, completed, total, stage });
  };
  const settle = (file: string, result: IngestResultBody) => {
    completed += 1;
    results.push({ ...result, file });
    emit(file, 'settled');
  };

  for (const file of files) {
    try {
      emit(file.name, 'sniff');
      if (file.size === 0) {
        throw new IngestError('unsupported-type', EMPTY_FILE_MESSAGE);
      }
      // Skip decode/resize entirely for oversized raws (risk #5: 8 GB machine).
      assertImageWithinSizeLimit(file.size);

      const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      const classification = classifyImageBytes(header);
      if ('code' in classification) {
        throw new IngestError(classification.code, classification.message);
      }

      emit(file.name, 'decode');
      const decoded = await decode(file);

      emit(file.name, 'hash');
      const bytes = await decoded.blob.arrayBuffer();
      const sha256 = await sha256Hex(bytes);

      emit(file.name, 'store');
      const meta: ImageMeta = {
        width: decoded.width,
        height: decoded.height,
        bytes: decoded.blob.size,
        sha256,
        source,
      };
      const record: StoredImageRecord = {
        id: createImageId(),
        blob: decoded.blob,
        meta,
        stagedAt: now(),
      };
      await deps.putImage(record);
      settle(file.name, { ok: true, record });
    } catch (error) {
      settle(file.name, { ok: false, ...failureOf(error) });
    }
  }

  return results;
}
