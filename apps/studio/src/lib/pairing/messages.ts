/**
 * Frame chunk protocol (T21) — phone-side planner, desktop-side assembler,
 * and the desktop's verified ack builder.
 *
 * Wire shapes live in `src/types/pairing.ts` (schemas); this module owns
 * protocol *logic* only:
 *
 *  - `planFrameChunks` splits one JPEG frame into ordered `frame-chunk`
 *    header + payload pairs (header JSON first, payload bytes second — the
 *    datachannel stays ordered, so pairing is positional).
 *  - `createFrameAssembler` reassembles those pairs, enforces the header's
 *    byte-length contract, and only reports `complete` after the whole
 *    frame's sha-256 matches the final chunk's digest. Any violation is an
 *    honest `invalid { reason }` — never a guessed frame.
 *  - Progress numbers are never simulated: `FrameSendProgress` (see
 *    `src/lib/scan/capture.ts`) moves only on real sends and real acks.
 */
import type {
  CaptureStateMessage,
  FrameAckMessage,
  FrameChunkHeader,
} from '../../types/pairing';
import { sha256Hex } from '../capture/hash';

/**
 * Payload bytes per chunk (64 KiB). Well under the ~256 KB frame cap from
 * the spec's chunking assumption, and under typical WebRTC message limits.
 */
export const FRAME_CHUNK_BYTES = 65536;

/* ------------------------------------------------------------------ *
 * phone side — planning
 * ------------------------------------------------------------------ */

export type PlannedChunk = {
  header: FrameChunkHeader;
  /** Exact bytes for this chunk; `payload.byteLength === header.bytes`. */
  payload: ArrayBuffer;
};

export type PlannedFrame = {
  frameId: string;
  /** Total frame bytes. */
  bytes: number;
  /** sha-256 (hex) of the complete frame — echoed by the final header. */
  sha256: string;
  chunkCount: number;
  /** Header + payload pairs in send order (headers before their payload). */
  chunks: PlannedChunk[];
};

export type PlanFrameOptions = {
  /** Override the payload size (unit tests); defaults to FRAME_CHUNK_BYTES. */
  chunkBytes?: number;
  /** Precomputed frame digest (hex); skips re-hashing when supplied. */
  sha256?: string;
};

/**
 * Split one frame into ordered chunk pairs. Async only because the frame
 * digest is computed here when the caller has not precomputed it.
 *
 * Every produced header satisfies `FrameChunkHeaderSchema`, including the
 * cross-field rule that only the final chunk carries `sha256`.
 */
export async function planFrameChunks(
  frameId: string,
  data: Uint8Array | ArrayBuffer,
  options: PlanFrameOptions = {},
): Promise<PlannedFrame> {
  if (frameId.length < 1) {
    throw new Error('planFrameChunks needs a non-empty frameId.');
  }
  // slice() yields an ArrayBuffer-backed copy even when the input view
  // aliases a larger buffer, so both the digest and the chunk payloads
  // cover exactly this frame.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
  if (bytes.byteLength === 0) {
    throw new Error('planFrameChunks cannot plan an empty frame.');
  }
  const chunkSize = options.chunkBytes ?? FRAME_CHUNK_BYTES;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`planFrameChunks needs a positive chunk size, got ${chunkSize}.`);
  }

  const sha256 = options.sha256 ?? (await sha256Hex(bytes));
  const chunkCount = Math.ceil(bytes.byteLength / chunkSize);
  const chunks: PlannedChunk[] = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, bytes.byteLength);
    const isFinal = index === chunkCount - 1;
    const header: FrameChunkHeader = {
      type: 'frame-chunk',
      frameId,
      index,
      total: chunkCount,
      bytes: end - start,
      ...(isFinal ? { sha256 } : {}),
    };
    // slice() allocates a fresh, exactly sized buffer per payload.
    chunks.push({ header, payload: bytes.slice(start, end).buffer });
  }

  return { frameId, bytes: bytes.byteLength, sha256, chunkCount, chunks };
}

/* ------------------------------------------------------------------ *
 * lifecycle / ack builders
 * ------------------------------------------------------------------ */

/** Phone-side capture lifecycle message; `at` is provenance, never ordering. */
export function createCaptureState(
  status: CaptureStateMessage['status'],
  frameId?: string,
  at: number = Date.now(),
): CaptureStateMessage {
  return { type: 'capture-state', status, ...(frameId !== undefined ? { frameId } : {}), at };
}

/**
 * Desktop-side receipt for one sha-verified frame. `at` is the desktop's
 * own clock (provenance only) — the phone never derives timing from it.
 */
export function createFrameAck(
  frameId: string,
  bytes: number,
  at: number = Date.now(),
): FrameAckMessage {
  return { type: 'frame-ack', frameId, bytes, at };
}

/* ------------------------------------------------------------------ *
 * desktop side — assembly
 * ------------------------------------------------------------------ */

export type FrameAssemblyResult =
  | { status: 'pending'; frameId: string; received: number; total: number }
  | { status: 'complete'; frameId: string; bytes: number; sha256: string; data: Uint8Array }
  | { status: 'invalid'; reason: string };

export type FrameAssembler = {
  /**
   * Feed one header + payload pair (headers arrive zod-validated on the
   * wire). Resolves `complete` exactly once per verified frame, then
   * clears itself so the next frame starts fresh.
   */
  push(header: FrameChunkHeader, payload: ArrayBuffer | Uint8Array): Promise<FrameAssemblyResult>;
  /** Abandon the in-progress frame (e.g. a new `capture-state` frameId). */
  reset(): void;
};

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type PendingFrame = {
  frameId: string;
  total: number;
  parts: (Uint8Array | null)[];
  received: number;
  expectedSha256: string | null;
};

export function createFrameAssembler(): FrameAssembler {
  let pending: PendingFrame | null = null;

  const fail = (reason: string): FrameAssemblyResult => {
    pending = null;
    return { status: 'invalid', reason };
  };

  const pendingResult = (): FrameAssemblyResult =>
    pending === null
      ? { status: 'invalid', reason: 'no frame in progress' }
      : { status: 'pending', frameId: pending.frameId, received: pending.received, total: pending.total };

  return {
    async push(header, payload): Promise<FrameAssemblyResult> {
      const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);

      if (header.index >= header.total) {
        return fail(`chunk index ${header.index} out of range for total ${header.total}`);
      }
      if (bytes.byteLength !== header.bytes) {
        return fail(
          `chunk ${header.index} declared ${header.bytes} bytes but payload has ${bytes.byteLength}`,
        );
      }

      if (pending !== null && pending.frameId !== header.frameId) {
        return fail(`frame id changed from ${pending.frameId} to ${header.frameId} mid-frame`);
      }
      if (pending === null) {
        pending = {
          frameId: header.frameId,
          total: header.total,
          parts: Array.from({ length: header.total }, () => null),
          received: 0,
          expectedSha256: null,
        };
      } else if (pending.total !== header.total) {
        return fail(`frame ${header.frameId} total changed from ${pending.total} to ${header.total}`);
      }

      const existing = pending.parts[header.index];
      if (existing !== null) {
        // Ordered reliable channel: a resend must be byte-identical.
        if (equalBytes(existing, bytes)) return pendingResult();
        return fail(`duplicate chunk ${header.index} with different bytes`);
      }

      pending.parts[header.index] = bytes;
      pending.received += 1;
      if (header.sha256 !== undefined) pending.expectedSha256 = header.sha256;

      if (pending.received < pending.total) return pendingResult();

      // All parts in — verify before ever reporting completion.
      const expected = pending.expectedSha256;
      if (expected === null) {
        return fail('frame completed without a final-chunk sha256');
      }
      const totalBytes = pending.parts.reduce((sum, part) => sum + (part === null ? 0 : part.byteLength), 0);
      const data = new Uint8Array(totalBytes);
      let offset = 0;
      for (const part of pending.parts) {
        if (part === null) return fail('frame completed with a missing chunk');
        data.set(part, offset);
        offset += part.byteLength;
      }
      const actual = await sha256Hex(data);
      if (actual !== expected) {
        return fail(`frame sha256 mismatch: expected ${expected}, got ${actual}`);
      }
      const frameId = pending.frameId;
      pending = null;
      return { status: 'complete', frameId, bytes: totalBytes, sha256: actual, data };
    },

    reset(): void {
      pending = null;
    },
  };
}
