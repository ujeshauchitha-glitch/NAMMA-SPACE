import { describe, expect, it } from 'vitest';

import {
  FRAME_JPEG_QUALITY,
  MAX_FRAME_LONG_EDGE,
  computeFrameSize,
  createFrameAckTracker,
  createFrameId,
  grabFrame,
  type CanvasContext2DLike,
  type CanvasLike,
  type GrabFrameDeps,
} from '../src/lib/scan/capture';
import {
  CAMERA_REMEDY,
  classifyMediaError,
  defaultGetMedia,
  requestCamera,
  stopCameraStream,
} from '../src/lib/scan/camera';
import { ingestPhoneFrame, type PhoneFrame } from '../src/lib/scan/receive';
import type { StoredImageRecord } from '../src/lib/storage';
import {
  FRAME_CHUNK_BYTES,
  createFrameAssembler,
  planFrameChunks,
} from '../src/lib/pairing/messages';
import { FrameChunkHeaderSchema, PairingMessageSchema, parsePairingMessage, FrameNackSchema } from '../src/types/pairing';

/**
 * T21 scan-capture suite — pure, no browser, no camera, no network.
 *
 * The orientation cases run `grabFrame` against a **software rasterizer**
 * stand-in: a synthetic video source with an asymmetric pattern is drawn
 * through the exact save/translate/scale/drawImage/restore sequence the
 * capture path performs, and the resulting pixels are decoded and asserted.
 * A mirrored save would swap the asymmetric halves — the assertion is on
 * real pixel positions, not on call logs.
 */

/* ------------------------------------------------------------------ *
 * synthetic video source + software canvas
 * ------------------------------------------------------------------ */

type Raster = { width: number; height: number; rgb: Uint8Array };

/** Asymmetric source: left half `lo`, right half `hi`, plus a per-column
 *  ramp so no other flip can alias onto the expected pattern. */
function makeSource(width: number, height: number, lo = 10, hi = 200): {
  videoWidth: number;
  videoHeight: number;
  raster: Raster;
} {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = x < width / 2 ? lo : hi;
      const value = Math.min(255, base + x); // column-unique ramp
      const offset = (y * width + x) * 3;
      rgb[offset] = value;
      rgb[offset + 1] = value;
      rgb[offset + 2] = value;
    }
  }
  return { videoWidth: width, videoHeight: height, raster: { width, height, rgb } };
}

/** Column `x`, row `y` of a raster (first pixel component). */
function pixelAt(raster: Raster, x: number, y: number): number {
  return raster.rgb[(y * raster.width + x) * 3];
}

/** Fixed 16-byte header: magic(4) + u32le width + u32le height + reserved(4). */
const FAKE_BLOB_HEADER_BYTES = 16;

function encodeRaster(raster: Raster): Uint8Array {
  const out = new Uint8Array(FAKE_BLOB_HEADER_BYTES + raster.rgb.length);
  out.set(new TextEncoder().encode('RAW1'), 0);
  new DataView(out.buffer).setUint32(4, raster.width, true);
  new DataView(out.buffer).setUint32(8, raster.height, true);
  out.set(raster.rgb, FAKE_BLOB_HEADER_BYTES);
  return out;
}

async function decodeBlob(blob: Blob): Promise<Raster> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RAW1');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  return { width, height, rgb: bytes.slice(FAKE_BLOB_HEADER_BYTES) };
}

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

type FakeCanvasOptions = { contextNull?: boolean; blobNull?: boolean };

type FakeCanvas = CanvasLike & {
  /** Recorded `toBlob` arguments — asserted for JPEG + quality. */
  lastEncode: { type: string; quality: number | undefined } | null;
  raster: () => Raster;
};

function makeFakeCanvas(width: number, height: number, options: FakeCanvasOptions = {}): FakeCanvas {
  const raster: Raster = { width, height, rgb: new Uint8Array(width * height * 3) };
  const canvas: FakeCanvas = {
    width,
    height,
    lastEncode: null,
    raster: () => raster,
    getContext(type: '2d') {
      if (type !== '2d' || options.contextNull) return null;
      return createContext(raster);
    },
    toBlob(callback, type, quality) {
      canvas.lastEncode = { type, quality };
      // Real canvas sets the blob's type from the requested mime.
      callback(options.blobNull ? null : new Blob([encodeRaster(raster)], { type }));
    },
  };
  return canvas;
}

function createContext(raster: Raster): CanvasContext2DLike {
  const stack: Matrix[] = [];
  let ctm: Matrix = { ...IDENTITY };

  return {
    save(): void {
      stack.push({ ...ctm });
    },
    restore(): void {
      ctm = stack.pop() ?? { ...IDENTITY };
    },
    translate(x: number, y: number): void {
      ctm = multiply(ctm, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
    },
    scale(x: number, y: number): void {
      ctm = multiply(ctm, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
    },
    drawImage(source: unknown, dx: number, dy: number, dw: number, dh: number): void {
      const video = source as { raster?: Raster };
      if (!video?.raster) throw new Error('drawImage received a source without pixels');
      const src = video.raster;
      const det = ctm.a * ctm.d - ctm.c * ctm.b;
      if (det === 0) throw new Error('degenerate transform');
      for (let py = dy; py < dy + dh; py += 1) {
        for (let px = dx; px < dx + dw; px += 1) {
          // Inverse-map the destination pixel centre into source space.
          const sx0 = px + 0.5 - ctm.e;
          const sy0 = py + 0.5 - ctm.f;
          const qx = (ctm.d * sx0 - ctm.c * sy0) / det;
          const qy = (-ctm.b * sx0 + ctm.a * sy0) / det;
          const u = Math.floor(((qx - dx) / dw) * src.width);
          const v = Math.floor(((qy - dy) / dh) * src.height);
          if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
          const from = (v * src.width + u) * 3;
          const to = (py * raster.width + px) * 3;
          raster.rgb[to] = src.rgb[from];
          raster.rgb[to + 1] = src.rgb[from + 1];
          raster.rgb[to + 2] = src.rgb[from + 2];
        }
      }
    },
  };
}

/* ================================================================== *
 * frame sizing (T21 AC: frame cap enforced)
 * ================================================================== */

describe('computeFrameSize — 1600 px long-edge cap', () => {
  it('passes small frames through (rounded, aspect intact)', () => {
    expect(computeFrameSize({ width: 640, height: 480 })).toEqual({ width: 640, height: 480 });
    expect(computeFrameSize({ width: 479.4, height: 100.6 })).toEqual({ width: 479, height: 101 });
  });

  it('caps the long edge exactly at MAX_FRAME_LONG_EDGE for both orientations', () => {
    expect(MAX_FRAME_LONG_EDGE).toBe(1600);
    expect(computeFrameSize({ width: 3200, height: 2400 })).toEqual({ width: 1600, height: 1200 });
    expect(computeFrameSize({ width: 2400, height: 3200 })).toEqual({ width: 1200, height: 1600 });
    expect(computeFrameSize({ width: 4000, height: 1000 })).toEqual({ width: 1600, height: 400 });
    expect(computeFrameSize({ width: 1000, height: 4000 })).toEqual({ width: 400, height: 1600 });
  });

  it('never collapses a dimension to zero on extreme aspect ratios', () => {
    expect(computeFrameSize({ width: 16000, height: 4 })).toEqual({ width: 1600, height: 1 });
    expect(computeFrameSize({ width: 4, height: 16000 })).toEqual({ width: 1, height: 1600 });
  });

  it('rejects non-positive or non-finite dimensions', () => {
    for (const bad of [
      { width: 0, height: 10 },
      { width: 10, height: -5 },
      { width: Number.NaN, height: 10 },
      { width: 10, height: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => computeFrameSize(bad)).toThrow(/positive dimensions/);
    }
  });
});

/* ================================================================== *
 * frame grab orientation (audit bug: reconstruction frames must not
 * be silently mirrored; the preview mirror is a separate concern)
 * ================================================================== */

describe('grabFrame — orientation and encoding', () => {
  it('saves an UNMIRRORED frame by default (asymmetric source keeps its left half on the left)', async () => {
    const source = makeSource(8, 4);
    const canvas = makeFakeCanvas(8, 4);
    const deps: GrabFrameDeps = { createCanvas: () => canvas };

    const blob = await grabFrame(source, deps);
    const out = await decodeBlob(blob);

    // Pixel assertion: every column keeps its source position — no flip.
    for (const x of [0, 1, 3, 4, 7]) {
      expect(pixelAt(out, x, 0)).toBe(pixelAt(source.raster, x, 0));
    }
    // Explicit asymmetry check: left edge is the "lo" side, right edge "hi".
    expect(pixelAt(out, 0, 0)).toBeLessThan(pixelAt(out, 7, 0));
  });

  it('mirrors ONLY when explicitly asked (opt-in, preview-matching mode)', async () => {
    const source = makeSource(8, 4);
    const canvas = makeFakeCanvas(8, 4);
    const deps: GrabFrameDeps = { createCanvas: () => canvas };

    const blob = await grabFrame(source, deps, { mirror: true });
    const out = await decodeBlob(blob);

    for (const x of [0, 1, 3, 4, 7]) {
      expect(pixelAt(out, x, 0)).toBe(pixelAt(source.raster, 7 - x, 0));
    }
    expect(pixelAt(out, 0, 0)).toBeGreaterThan(pixelAt(out, 7, 0));
  });

  it('encodes JPEG at the fixed quality and caps the long edge before drawing', async () => {
    const source = makeSource(3200, 1600);
    let created: { width: number; height: number } | null = null;
    let used: FakeCanvas | null = null;
    const deps: GrabFrameDeps = {
      createCanvas(width, height) {
        created = { width, height };
        used = makeFakeCanvas(width, height);
        return used;
      },
    };

    const blob = await grabFrame(source, deps);
    expect(created).toEqual({ width: 1600, height: 800 });
    expect(blob.type).toBe('image/jpeg');
    expect(used?.lastEncode).toEqual({ type: 'image/jpeg', quality: FRAME_JPEG_QUALITY });
    expect(FRAME_JPEG_QUALITY).toBe(0.85);
    expect(MAX_FRAME_LONG_EDGE).toBe(1600);
  });

  it('rejects honestly when the preview has no dimensions yet', async () => {
    const deps: GrabFrameDeps = { createCanvas: () => makeFakeCanvas(8, 4) };
    await expect(grabFrame({ videoWidth: 0, videoHeight: 480 }, deps)).rejects.toThrow(
      /preview has no dimensions/,
    );
    await expect(
      grabFrame({ videoWidth: Number.NaN, videoHeight: 480 }, deps),
    ).rejects.toThrow(/preview has no dimensions/);
  });

  it('rejects when the 2D context is unavailable or the encoder returns nothing', async () => {
    const source = makeSource(8, 4);
    await expect(
      grabFrame(source, { createCanvas: () => makeFakeCanvas(8, 4, { contextNull: true }) }),
    ).rejects.toThrow(/2D context could not be created/);
    await expect(
      grabFrame(source, { createCanvas: () => makeFakeCanvas(8, 4, { blobNull: true }) }),
    ).rejects.toThrow(/returned no JPEG blob/);
  });
});

/* ================================================================== *
 * camera request — denial path (T21 AC: injected getUserMedia mock)
 * ================================================================== */

describe('requestCamera — honest failure classification', () => {
  it('maps NotAllowedError to `denied` with the browser message intact', async () => {
    const getMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    const result = await requestCamera(getMedia, 'user');
    expect(result).toEqual({ status: 'denied', message: 'Permission denied' });
  });

  it('maps NotFoundError / OverconstrainedError to `no-device`', async () => {
    for (const name of ['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError']) {
      const getMedia = () => Promise.reject(Object.assign(new Error('gone'), { name }));
      expect((await requestCamera(getMedia)).status).toBe('no-device');
    }
  });

  it('falls back to `error` without inventing a cause', async () => {
    const getMedia = () => Promise.reject(new Error('driver exploded'));
    expect(await requestCamera(getMedia)).toEqual({ status: 'error', message: 'driver exploded' });
    const noMessage = () => Promise.reject(Object.assign(new Error(''), { name: 'Weird' }));
    const result = await requestCamera(noMessage);
    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('unreachable');
    expect(result.message).toBe('The camera could not be started for an unknown reason.');
  });

  it('resolves `live` with the stream untouched on success', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const result = await requestCamera(() => Promise.resolve(stream), 'user');
    expect(result).toEqual({ status: 'live', stream });
  });

  it('exposes the exact remedy copy used by both empty states', () => {
    expect(CAMERA_REMEDY).toBe('Allow camera access in the address bar, then retry');
    expect(classifyMediaError({ name: 'SecurityError' })).toBe('denied');
  });

  it('defaultGetMedia rejects honestly where mediaDevices does not exist', async () => {
    const mediaPresent = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    if (mediaPresent) return; // real browser — not this suite's environment
    await expect(defaultGetMedia({ video: { facingMode: 'user' }, audio: false })).rejects.toThrow(
      /does not expose camera capture/,
    );
  });

  it('stopCameraStream is idempotent and null-safe', () => {
    const stopped: string[] = [];
    const track = { stop: () => stopped.push('t1') };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    stopCameraStream(stream);
    stopCameraStream(null);
    stopCameraStream(undefined);
    expect(stopped).toEqual(['t1']);
  });
});

/* ================================================================== *
 * message framing — phone side (planFrameChunks)
 * ================================================================== */

describe('planFrameChunks — header/payload framing', () => {
  const bytes = (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = i % 251;
    return out;
  };

  it('splits a frame into ordered chunks; only the final header carries sha256', async () => {
    const data = bytes(100_000);
    const planned = await planFrameChunks('frame-1', data, { chunkBytes: 65536 });

    expect(planned.frameId).toBe('frame-1');
    expect(planned.bytes).toBe(100_000);
    expect(planned.chunkCount).toBe(2);
    expect(planned.chunks).toHaveLength(2);

    const [first, second] = planned.chunks;
    if (!first || !second) throw new Error('unreachable');
    expect(first.header).toEqual({ type: 'frame-chunk', frameId: 'frame-1', index: 0, total: 2, bytes: 65536 });
    expect(second.header.sha256).toBe(planned.sha256);
    expect(first.header.sha256).toBeUndefined();
    // Cross-field schema rule holds for every produced header.
    for (const chunk of planned.chunks) FrameChunkHeaderSchema.parse(chunk.header);
    expect(planned.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Payloads concatenate back to exactly the frame, byte for byte.
    const reassembled = new Uint8Array(planned.chunks.reduce((n, c) => n + c.payload.byteLength, 0));
    let offset = 0;
    for (const chunk of planned.chunks) {
      reassembled.set(new Uint8Array(chunk.payload), offset);
      offset += chunk.payload.byteLength;
    }
    expect(reassembled).toEqual(data);
    // The source buffer was not mutated or aliased into the chunks.
    expect(data[0]).toBe(0);
  });

  it('defaults to FRAME_CHUNK_BYTES and handles single-chunk frames', async () => {
    expect(FRAME_CHUNK_BYTES).toBe(65536);
    const planned = await planFrameChunks('frame-2', bytes(1000));
    expect(planned.chunkCount).toBe(1);
    expect(planned.chunks[0]?.header.sha256).toBe(planned.sha256);
    expect(planned.chunks[0]?.payload.byteLength).toBe(1000);
  });

  it('accepts an ArrayBuffer input and a precomputed digest', async () => {
    const data = bytes(64);
    const planned = await planFrameChunks('frame-3', data.buffer, { sha256: 'b'.repeat(64) });
    expect(planned.sha256).toBe('b'.repeat(64));
    expect(planned.chunks[0]?.header.sha256).toBe('b'.repeat(64));
  });

  it('refuses empty frames, empty ids and nonsensical chunk sizes', async () => {
    await expect(planFrameChunks('f', new Uint8Array(0))).rejects.toThrow(/empty frame/);
    await expect(planFrameChunks('', bytes(10))).rejects.toThrow(/non-empty frameId/);
    await expect(planFrameChunks('f', bytes(10), { chunkBytes: 0 })).rejects.toThrow(/positive chunk size/);
    await expect(planFrameChunks('f', bytes(10), { chunkBytes: 1.5 })).rejects.toThrow(/positive chunk size/);
  });
});

/* ================================================================== *
 * frame assembly — desktop side (verify before reporting complete)
 * ================================================================== */

describe('createFrameAssembler — verified reassembly', () => {
  const bytes = (length: number, seed = 7): Uint8Array => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = (i + seed) % 253;
    return out;
  };

  it('reassembles in order and completes only with a matching sha256', async () => {
    const data = bytes(150_000);
    const planned = await planFrameChunks('frame-a', data, { chunkBytes: 65536 });
    expect(planned.chunkCount).toBe(3);

    const assembler = createFrameAssembler();
    let last = await assembler.push(planned.chunks[0]!.header, planned.chunks[0]!.payload);
    expect(last).toEqual({ status: 'pending', frameId: 'frame-a', received: 1, total: 3 });
    last = await assembler.push(planned.chunks[1]!.header, planned.chunks[1]!.payload);
    expect(last.status).toBe('pending');
    last = await assembler.push(planned.chunks[2]!.header, planned.chunks[2]!.payload);

    expect(last.status).toBe('complete');
    if (last.status !== 'complete') throw new Error('unreachable');
    expect(last.frameId).toBe('frame-a');
    expect(last.bytes).toBe(150_000);
    expect(last.sha256).toBe(planned.sha256);
    expect(last.data).toEqual(data);
  });

  it('reports `invalid` on a sha256 mismatch — never a guessed frame', async () => {
    const data = bytes(4000);
    const planned = await planFrameChunks('frame-b', data, { chunkBytes: 65536 });
    const header = planned.chunks[0]!.header;
    const corrupted = new Uint8Array(planned.chunks[0]!.payload);
    corrupted[10] = (corrupted[10]! + 1) % 256; // same length, different bytes

    const assembler = createFrameAssembler();
    const result = await assembler.push(header, corrupted);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    expect(result.reason).toMatch(/sha256 mismatch/);
    expect(result.reason).toContain(planned.sha256);
  });

  it('enforces the byte-length contract per chunk', async () => {
    const planned = await planFrameChunks('frame-c', bytes(1000), { chunkBytes: 400 });
    const header = planned.chunks[0]!.header;
    const assembler = createFrameAssembler();
    const result = await assembler.push(header, new Uint8Array(header.bytes - 1));
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    expect(result.reason).toMatch(/declared \d+ bytes but payload has/);
  });

  it('rejects mid-frame frameId changes and total changes', async () => {
    const planned = await planFrameChunks('frame-d', bytes(900), { chunkBytes: 300 });
    const assembler = createFrameAssembler();
    await assembler.push(planned.chunks[0]!.header, planned.chunks[0]!.payload);

    const switched = await assembler.push(
      { ...planned.chunks[1]!.header, frameId: 'other-frame' },
      planned.chunks[1]!.payload,
    );
    expect(switched.status).toBe('invalid');
    if (switched.status !== 'invalid') throw new Error('unreachable');
    expect(switched.reason).toMatch(/frame id changed/);
  });

  it('treats a byte-identical duplicate as idempotent but flags divergent duplicates', async () => {
    const planned = await planFrameChunks('frame-e', bytes(900), { chunkBytes: 300 });
    const first = planned.chunks[0]!;
    const assembler = createFrameAssembler();

    await assembler.push(first.header, first.payload);
    const again = await assembler.push(first.header, first.payload);
    expect(again.status).toBe('pending');
    if (again.status !== 'pending') throw new Error('unreachable');
    expect(again.received).toBe(1);

    // A divergent resend arrives as a FRESH buffer with different bytes —
    // copy first, or the mutation would alias the assembler's stored view.
    const divergent = new Uint8Array(first.payload.slice(0));
    divergent[0] = (divergent[0]! + 9) % 256;
    const bad = await assembler.push(first.header, divergent);
    expect(bad.status).toBe('invalid');
    if (bad.status !== 'invalid') throw new Error('unreachable');
    expect(bad.reason).toMatch(/duplicate chunk .* different bytes/);
  });

  it('refuses out-of-range indices and completion without a digest', async () => {
    const planned = await planFrameChunks('frame-f', bytes(100), { chunkBytes: 65536 });
    const assembler = createFrameAssembler();

    const outOfRange = await assembler.push({ ...planned.chunks[0]!.header, index: 5 }, planned.chunks[0]!.payload);
    expect(outOfRange.status).toBe('invalid');
    if (outOfRange.status !== 'invalid') throw new Error('unreachable');
    expect(outOfRange.reason).toMatch(/out of range/);

    const noDigest = await assembler.push(
      { type: 'frame-chunk', frameId: 'frame-g', index: 0, total: 1, bytes: 4 },
      new Uint8Array(4),
    );
    expect(noDigest.status).toBe('invalid');
    if (noDigest.status !== 'invalid') throw new Error('unreachable');
    expect(noDigest.reason).toMatch(/without a final-chunk sha256/);
  });

  it('reset abandons the in-progress frame', async () => {
    const planned = await planFrameChunks('frame-h', bytes(900), { chunkBytes: 300 });
    const assembler = createFrameAssembler();
    await assembler.push(planned.chunks[0]!.header, planned.chunks[0]!.payload);
    assembler.reset();
    const after = await assembler.push(planned.chunks[1]!.header, planned.chunks[1]!.payload);
    // Fresh frame started from chunk 1 with no history — pending, received 1.
    expect(after.status).toBe('pending');
    if (after.status !== 'pending') throw new Error('unreachable');
    expect(after.received).toBe(1);
    expect(after.total).toBe(3);
  });
});

/* ================================================================== *
 * frame-nack — honest wire-level transfer failure (phone ← desktop)
 * ================================================================== */

describe('frame-nack — verified-frame rejection travels back to the sender', () => {
  const nack = {
    type: 'frame-nack',
    frameId: 'frame-1',
    reason: 'frame sha256 mismatch: expected a, got b',
    at: 1_730_000_000_000,
  };

  it('is part of the discriminated pairing-message union', () => {
    expect(FrameNackSchema.parse(nack)).toEqual(nack);
    expect(PairingMessageSchema.safeParse(nack).success).toBe(true);
    expect(parsePairingMessage(JSON.stringify(nack))).toEqual(nack);
  });

  it('never coerces a malformed nack', () => {
    expect(FrameNackSchema.safeParse({ ...nack, frameId: '' }).success).toBe(false);
    expect(FrameNackSchema.safeParse({ ...nack, reason: '' }).success).toBe(false);
    expect(FrameNackSchema.safeParse({ ...nack, at: -1 }).success).toBe(false);
    expect(FrameNackSchema.safeParse({ ...nack, type: 'frame-ack' }).success).toBe(false);
    expect(parsePairingMessage('{"type":"frame-nack"}')).toBeNull();
  });
});

/* ================================================================== *
 * ack bookkeeping (T21 AC: acks drive progress — never simulated)
 * ================================================================== */

describe('createFrameAckTracker — real sends and real acks only', () => {
  it('tracks unique chunk sends and flips to acked only on the matching ack', () => {
    const tracker = createFrameAckTracker();
    expect(tracker.progress()).toBeNull();

    const started = tracker.start({ frameId: 'f-1', bytes: 900, chunkCount: 3 });
    expect(started).toEqual({
      frameId: 'f-1', chunkCount: 3, sentChunks: 0, acked: false, bytes: 900, ackedBytes: 0,
    });

    expect(tracker.onSent(0)?.sentChunks).toBe(1);
    expect(tracker.onSent(2)?.sentChunks).toBe(2);
    expect(tracker.onSent(2)?.sentChunks).toBe(2); // duplicate index: no double count
    expect(tracker.onSent(9)).toBeNull(); // out-of-range: honest null, no growth
    expect(tracker.onSent(-1)).toBeNull();

    // A stale ack for another frame never counts.
    expect(tracker.onAck({ frameId: 'other', bytes: 900 })).toBeNull();
    expect(tracker.progress()?.acked).toBe(false);

    const acked = tracker.onAck({ frameId: 'f-1', bytes: 900 });
    expect(acked?.acked).toBe(true);
    expect(acked?.ackedBytes).toBe(900);
    expect(tracker.progress()?.sentChunks).toBe(2);
  });

  it('a new frame supersedes the previous one', () => {
    const tracker = createFrameAckTracker();
    tracker.start({ frameId: 'f-1', bytes: 100, chunkCount: 1 });
    tracker.onSent(0);
    tracker.start({ frameId: 'f-2', bytes: 200, chunkCount: 2 });
    expect(tracker.progress()).toEqual({
      frameId: 'f-2', chunkCount: 2, sentChunks: 0, acked: false, bytes: 200, ackedBytes: 0,
    });
    expect(tracker.onAck({ frameId: 'f-1', bytes: 100 })).toBeNull();
  });

  it('rejects degenerate frames at start', () => {
    const tracker = createFrameAckTracker();
    expect(() => tracker.start({ frameId: 'f', bytes: 0, chunkCount: 1 })).toThrow(/positive chunk count/);
    expect(() => tracker.start({ frameId: 'f', bytes: 10, chunkCount: 0 })).toThrow(/positive chunk count/);
  });

  it('progress() hands out copies — callers cannot corrupt the tracker', () => {
    const tracker = createFrameAckTracker();
    tracker.start({ frameId: 'f-1', bytes: 100, chunkCount: 1 });
    const snapshot = tracker.progress()!;
    snapshot.sentChunks = 999;
    snapshot.acked = true;
    expect(tracker.progress()?.sentChunks).toBe(0);
    expect(tracker.progress()?.acked).toBe(false);
  });
});

describe('createFrameId', () => {
  it('produces distinct non-empty ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createFrameId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * inbound phone frame → T11 ingest (source: 'phone')
 * ------------------------------------------------------------------ */

describe('ingestPhoneFrame — verified frame → staged image', () => {
  /** Minimal bytes that sniff as JPEG (magic FF D8 FF …). */
  function jpegFrame(frameId: string, length = 64): PhoneFrame {
    const data = new Uint8Array(length);
    data.set([0xff, 0xd8, 0xff, 0xe0], 0);
    return { frameId, data };
  }

  const fakeDecode = async (file: Blob) => ({
    blob: new Blob([await file.arrayBuffer()], { type: 'image/jpeg' }),
    width: 640,
    height: 480,
  });

  it('stages exactly one image labelled source: phone under the frame id', async () => {
    const stored: StoredImageRecord[] = [];
    const results = await ingestPhoneFrame(jpegFrame('frame-p1'), {
      putImage: async (record) => {
        stored.push(record);
      },
      decode: fakeDecode,
      now: () => 1_234,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    if (!results[0] || !results[0].ok) throw new Error('unreachable');
    expect(results[0].file).toBe('frame-p1.jpg');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.meta.source).toBe('phone');
    expect(stored[0]?.meta.width).toBe(640);
    expect(stored[0]?.meta.height).toBe(480);
    expect(stored[0]?.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]?.stagedAt).toBe(1_234);
  });

  it('an empty frame settles as a failed result — never staged, never silent', async () => {
    const stored: StoredImageRecord[] = [];
    const results = await ingestPhoneFrame(
      { frameId: 'frame-empty', data: new Uint8Array(0) },
      {
        putImage: async (record) => {
          stored.push(record);
        },
        decode: async () => {
          throw new Error('decode must not run for an empty frame');
        },
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    if (!results[0] || results[0].ok) throw new Error('unreachable');
    expect(results[0].file).toBe('frame-empty.jpg');
    expect(results[0].message).toMatch(/empty/i);
    expect(stored).toHaveLength(0);
  });
});
