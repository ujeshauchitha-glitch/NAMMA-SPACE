/**
 * Browser decode/re-encode path (T11): `createImageBitmap` → downscale to
 * ≤2048 px long edge → JPEG q0.9 via OffscreenCanvas (canvas fallback).
 * DOM-only; node tests inject a stand-in through `ingestFiles` deps — the
 * real browser path is e2e-covered (T24).
 */
import { IngestError } from './errors';
import { computeTargetSize, MAX_LONG_EDGE } from './resize';

export const JPEG_QUALITY = 0.9;

export const DECODE_FAILED_MESSAGE =
  'This image could not be decoded — the file may be truncated or corrupt. Re-export it as JPG and retry.';

export type DecodedImage = { blob: Blob; width: number; height: number };

export type DecodeOptions = {
  maxLongEdge?: number;
  quality?: number;
};

async function encodeJpeg(
  source: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new IngestError(
        'decode-failed',
        'A 2D canvas context is unavailable — image re-encoding cannot run in this browser.',
      );
    }
    context.drawImage(source, 0, 0, width, height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  }

  if (typeof document === 'undefined') {
    throw new IngestError(
      'decode-failed',
      'No canvas implementation exists in this environment — image re-encoding cannot run.',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new IngestError(
      'decode-failed',
      'A 2D canvas context is unavailable — image re-encoding cannot run in this browser.',
    );
  }
  context.drawImage(source, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else {
          reject(
            new IngestError(
              'decode-failed',
              'The browser could not encode this image as JPEG — it may exceed canvas memory limits. Try a smaller photo.',
            ),
          );
        }
      },
      'image/jpeg',
      quality,
    );
  });
}

/** Decode one file to a stored JPEG. Throws typed `IngestError` on failure. */
export async function decodeImage(file: Blob, options: DecodeOptions = {}): Promise<DecodedImage> {
  const maxLongEdge = options.maxLongEdge ?? MAX_LONG_EDGE;
  const quality = options.quality ?? JPEG_QUALITY;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const target = computeTargetSize(bitmap.width, bitmap.height, maxLongEdge);
      const blob = await encodeJpeg(bitmap, target.width, target.height, quality);
      return { blob, width: target.width, height: target.height };
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (error instanceof IngestError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new IngestError('decode-failed', `${DECODE_FAILED_MESSAGE} Technical detail: ${detail}`, {
      cause: error,
    });
  }
}
