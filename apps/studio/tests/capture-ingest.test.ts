/**
 * T11 — capture ingest pipeline (pure parts + batch isolation).
 *
 * Covers the spec'd acceptance points:
 *  - sniff table: JPEG/PNG/WebP accepted, HEIC → exact §9.1 remedy,
 *    everything else honestly rejected (magic bytes authoritative — a .jpg
 *    name never promotes rejected content)
 *  - resize math exact (≤2048 px long edge, deterministic rounding)
 *  - sha256 via WebCrypto (known vectors)
 *  - object-URL registry: every create is tracked, every revoke counted
 *  - ingestFiles: one bad file never aborts the batch; progress settles
 *    every file; stored record metadata is verifiable against stored bytes
 *
 * DOM decode (`createImageBitmap`/OffscreenCanvas) is dependency-injected —
 * node has neither; the browser path is covered by e2e (T24).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  HEIC_REMEDY,
  UNSUPPORTED_TYPE_MESSAGE,
  classifyImageBytes,
  computeTargetSize,
  decodeImage,
  ingestFiles,
  sha256Hex,
  sniffImageKind,
  type IngestDeps,
  type IngestProgress,
} from '../src/lib/capture';
import { MAX_RAW_IMAGE_BYTES, type StoredImageRecord } from '../src/lib/storage';
import { activeObjectUrlCount, createObjectUrl, revokeAllObjectUrls, revokeObjectUrl } from '../src/lib/objectUrls';

/* ------------------------------------------------------------------ *
 * byte fixtures
 * ------------------------------------------------------------------ */

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  bytes.set([0x0c, 0x00, 0x00, 0x00], 4); // chunk size
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
  return bytes;
}

function heicBytes(brand: string): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x00, 0x00, 0x00, 0x18], 0); // box size
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  bytes.set(new TextEncoder().encode(brand), 8);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * magic-byte sniffing
 * ------------------------------------------------------------------ */

describe('sniffImageKind (magic bytes are authoritative)', () => {
  it('classifies JPEG, PNG and WebP signatures', () => {
    expect(sniffImageKind(JPEG_BYTES)).toBe('jpeg');
    expect(sniffImageKind(PNG_BYTES)).toBe('png');
    expect(sniffImageKind(webpBytes())).toBe('webp');
  });

  it('classifies HEIC/HEIF containers by ftyp brand (parity with prepare_capture.py)', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'heif', 'mif1']) {
      expect(sniffImageKind(heicBytes(brand))).toBe('heic');
    }
  });

  it('returns unknown for garbage, empty, or lookalike files', () => {
    expect(sniffImageKind(new Uint8Array([]))).toBe('unknown');
    expect(sniffImageKind(new TextEncoder().encode('just some notes, not an image'))).toBe('unknown');
    // BMP has a different signature — honest rejection, not promotion by extension.
    expect(sniffImageKind(new TextEncoder().encode('BM\u0000\u0000'))).toBe('unknown');
    // 'RIFF' but not WebP.
    const wav = new Uint8Array(16);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // 'WAVE'
    expect(sniffImageKind(wav)).toBe('unknown');
    // Truncated PNG (7 of 8 signature bytes).
    expect(sniffImageKind(PNG_BYTES.slice(0, 7))).toBe('unknown');
    // ftyp with an unrecognized brand.
    expect(sniffImageKind(heicBytes('avc1'))).toBe('unknown');
  });
});

describe('classifyImageBytes (intake copy)', () => {
  it('accepts JPEG, PNG and WebP', () => {
    expect(classifyImageBytes(JPEG_BYTES)).toEqual({ kind: 'jpeg' });
    expect(classifyImageBytes(PNG_BYTES)).toEqual({ kind: 'png' });
    expect(classifyImageBytes(webpBytes())).toEqual({ kind: 'webp' });
  });

  it('answers HEIC with the exact §9.1 remedy', () => {
    expect(classifyImageBytes(heicBytes('heic'))).toEqual({
      code: 'heic',
      message: 'This file is HEIC — export JPG or run the prepare script.',
    });
    expect(HEIC_REMEDY).toBe('This file is HEIC — export JPG or run the prepare script.');
  });

  it('rejects unknown bytes with an honest unsupported message', () => {
    expect(classifyImageBytes(new TextEncoder().encode('nope'))).toEqual({
      code: 'unsupported-type',
      message: UNSUPPORTED_TYPE_MESSAGE,
    });
    expect(UNSUPPORTED_TYPE_MESSAGE).toMatch(/JPEG, PNG, or WebP/);
  });
});

/* ------------------------------------------------------------------ *
 * resize math
 * ------------------------------------------------------------------ */

describe('computeTargetSize (≤2048 px long edge)', () => {
  it('leaves images at or under the cap untouched', () => {
    expect(computeTargetSize(2048, 2048)).toEqual({ width: 2048, height: 2048, resized: false });
    expect(computeTargetSize(1280, 720)).toEqual({ width: 1280, height: 720, resized: false });
    expect(computeTargetSize(1, 1)).toEqual({ width: 1, height: 1, resized: false });
  });

  it('scales wide images to exactly 2048 on the long edge', () => {
    expect(computeTargetSize(4096, 2048)).toEqual({ width: 2048, height: 1024, resized: true });
    expect(computeTargetSize(3000, 2000)).toEqual({ width: 2048, height: 1365, resized: true });
  });

  it('scales portrait images to exactly 2048 on the long edge', () => {
    expect(computeTargetSize(3000, 4000)).toEqual({ width: 1536, height: 2048, resized: true });
    expect(computeTargetSize(1, 3000)).toEqual({ width: 1, height: 2048, resized: true });
  });

  it('rejects invalid dimensions instead of producing NaN', () => {
    expect(() => computeTargetSize(0, 10)).toThrow(/Invalid image dimensions/);
    expect(() => computeTargetSize(10, -5)).toThrow(/Invalid image dimensions/);
  });
});

/* ------------------------------------------------------------------ *
 * sha256 (WebCrypto)
 * ------------------------------------------------------------------ */

describe('sha256Hex', () => {
  it('matches the published NIST vector for "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the empty-input vector', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

/* ------------------------------------------------------------------ *
 * object-URL registry (lifecycle rule §3.3)
 * ------------------------------------------------------------------ */

describe('object URL registry', () => {
  it('tracks every created URL and drops it exactly once on revoke', () => {
    revokeAllObjectUrls();
    const url = createObjectUrl(new Blob(['x']));
    expect(url).toMatch(/^blob:/);
    expect(activeObjectUrlCount()).toBe(1);

    revokeObjectUrl(url);
    expect(activeObjectUrlCount()).toBe(0);

    // Double revoke is a no-op — never underflows, never revokes twice.
    revokeObjectUrl(url);
    expect(activeObjectUrlCount()).toBe(0);
  });

  it('revokeAll clears the registry (unmount path)', () => {
    createObjectUrl(new Blob(['a']));
    createObjectUrl(new Blob(['b']));
    expect(activeObjectUrlCount()).toBe(2);
    revokeAllObjectUrls();
    expect(activeObjectUrlCount()).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * ingestFiles (batch orchestration + per-file isolation)
 * ------------------------------------------------------------------ */

describe('ingestFiles', () => {
  it('isolates per-file failures, never aborts the batch, and settles honest progress', async () => {
    const stored = new Map<string, StoredImageRecord>();
    let decodeCalls = 0;
    const decodedBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });

    const deps: IngestDeps = {
      putImage: async (record) => {
        stored.set(record.id, record);
      },
      decode: async (blob) => {
        decodeCalls += 1;
        const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
        if (head[0] === 0x89) throw new Error('decoder exploded'); // PNG fixture
        return { blob: decodedBlob, width: 64, height: 48 };
      },
      now: () => 1_000,
    };

    const files = [
      new File([JPEG_BYTES], 'good.jpg', { type: 'image/jpeg' }),
      new File([heicBytes('mif1')], 'iphone.heic', { type: 'image/heic' }),
      new File([new TextEncoder().encode('not an image')], 'notes.txt', { type: 'text/plain' }),
      new File([new Uint8Array(MAX_RAW_IMAGE_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' }),
      new File([PNG_BYTES], 'corrupt.png', { type: 'image/png' }),
      new File([], 'empty.jpg', { type: 'image/jpeg' }),
    ];

    const progress: IngestProgress[] = [];
    const results = await ingestFiles(files, deps, { onProgress: (update) => progress.push(update) });

    expect(results.map((result) => (result.ok ? 'ok' : result.code))).toEqual([
      'ok',
      'heic',
      'unsupported-type',
      'payload-too-large',
      'decode-failed',
      'unsupported-type',
    ]);

    // Honest copy on the rejections.
    const heicResult = results[1];
    expect(heicResult.ok === false && heicResult.message).toBe(HEIC_REMEDY);
    const emptyResult = results[5];
    expect(emptyResult.ok === false && emptyResult.message).toMatch(/empty/i);

    // One bad file never aborts the batch: the good file still staged.
    expect(stored.size).toBe(1);
    // Decode runs only for sniff-accepted, size-accepted files.
    expect(decodeCalls).toBe(2);

    // Progress: every settled file counted, last event is the batch completion.
    const settled = progress.filter((update) => update.stage === 'settled');
    expect(settled.map((update) => update.completed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progress.at(-1)).toMatchObject({ completed: 6, total: 6, stage: 'settled' });
    expect(progress.some((update) => update.stage === 'decode')).toBe(true);

    // Stored record is verifiable against the actual stored bytes.
    const record = [...stored.values()][0];
    expect(record.id).toBeTypeOf('string');
    expect(record.meta.sha256).toBe(await sha256Hex(new Uint8Array([1, 2, 3, 4])));
    expect(record.meta.bytes).toBe(4);
    expect(record.meta.width).toBe(64);
    expect(record.meta.height).toBe(48);
    expect(record.meta.source).toBe('operator');
    expect(record.stagedAt).toBe(1_000);
  });

  it('records phone provenance when the caller says so', async () => {
    const stored: StoredImageRecord[] = [];
    const deps: IngestDeps = {
      putImage: async (record) => {
        stored.push(record);
      },
      decode: async () => ({ blob: new Blob([new Uint8Array([9])], { type: 'image/jpeg' }), width: 10, height: 5 }),
      now: () => 2_000,
    };

    await ingestFiles([new File([JPEG_BYTES], 'frame.jpg', { type: 'image/jpeg' })], deps, {
      source: 'phone',
    });

    expect(stored[0].meta.source).toBe('phone');
  });

  it('maps an unexpected storage failure to an honest result, not a throw', async () => {
    const deps: IngestDeps = {
      putImage: vi.fn().mockRejectedValue(new Error('disk on fire')),
      decode: async () => ({ blob: new Blob([new Uint8Array([7])], { type: 'image/jpeg' }), width: 8, height: 8 }),
      now: () => 3_000,
    };

    const results = await ingestFiles([new File([JPEG_BYTES], 'a.jpg', { type: 'image/jpeg' })], deps);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].ok === false && results[0].message).toMatch(/disk on fire/);
  });
});

describe('decodeImage environment guard', () => {
  it('fails honestly in an environment without canvas/image decoding', async () => {
    // node has no createImageBitmap — the browser path is e2e-covered (T24).
    await expect(decodeImage(new File([JPEG_BYTES], 'a.jpg'))).rejects.toMatchObject({
      name: 'IngestError',
      code: 'decode-failed',
    });
  });
});
