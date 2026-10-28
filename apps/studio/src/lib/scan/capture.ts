/**
 * Phone frame capture (T21) — 1600-px JPEG grab and honest send progress.
 *
 * Rules this module keeps:
 *
 *  - The long edge never exceeds `MAX_FRAME_LONG_EDGE` (1600 px), aspect
 *    preserved — enforced here and unit-tested (T21 AC).
 *  - Progress is never simulated: `FrameSendProgress` only moves when the
 *    channel accepted a chunk or the desktop returned a verified `frame-ack`.
 *  - Every DOM touch (`canvas`, `toBlob`) sits behind an injectable seam so
 *    the unit suite runs without a browser.
 */

/** Frames never exceed this on their long edge (T21 spec: cap 1600 px). */
export const MAX_FRAME_LONG_EDGE = 1600;

/** JPEG quality for phone frames — the spec fixes JPEG over raw bytes. */
export const FRAME_JPEG_QUALITY = 0.85;

export type FrameSize = { width: number; height: number };

/**
 * Cap a frame's long edge at 1600 px while preserving aspect ratio.
 * Inputs must be positive finite numbers; sub-pixel results round to at
 * least 1 px so a degenerate aspect can never produce a zero canvas.
 */
export function computeFrameSize(size: FrameSize): FrameSize {
  const { width, height } = size;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`computeFrameSize needs positive dimensions, got ${width}×${height}.`);
  }
  const rounded = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const longEdge = Math.max(rounded.width, rounded.height);
  if (longEdge <= MAX_FRAME_LONG_EDGE) return rounded;
  const scale = MAX_FRAME_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(rounded.width * scale)),
    height: Math.max(1, Math.round(rounded.height * scale)),
  };
}

/* ------------------------------------------------------------------ *
 * DOM seams (structural — real canvas/HTMLCanvasElement satisfy them)
 * ------------------------------------------------------------------ */

export type CanvasContext2DLike = {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  drawImage(source: unknown, dx: number, dy: number, dw: number, dh: number): void;
};

export type CanvasLike = {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasContext2DLike | null;
  toBlob(callback: (blob: Blob | null) => void, type: string, quality?: number): void;
};

/** Structural view of a live `<video>` — only dimensions are read here. */
export type VideoSourceLike = {
  readonly videoWidth: number;
  readonly videoHeight: number;
};

export type GrabFrameDeps = {
  createCanvas(width: number, height: number): CanvasLike;
};

export type GrabFrameOptions = {
  /**
   * Flip the saved frame horizontally (matches the selfie preview).
   *
   * `false` (the default) is the reconstruction-bound behaviour: camera
   * sensors are not mirrored, so saved frames must keep the scene's true
   * left/right orientation. The preview's mirror is CSS-only
   * (`CameraPreview.module.css` `transform: scaleX(-1)`) and never leaks
   * into the bytes — display mirroring and saved-frame orientation are
   * deliberately separate concerns (T21 audit).
   */
  mirror?: boolean;
};

function domCreateCanvas(width: number, height: number): CanvasLike {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const defaultGrabFrameDeps: GrabFrameDeps = { createCanvas: domCreateCanvas };

/**
 * Draw one frame from `video` into a capped canvas and encode it as JPEG.
 *
 * The saved pixels are UNMIRRORED by default so reconstruction-bound frames
 * carry the scene's true orientation; pass `{ mirror: true }` only when the
 * bytes are meant to match the mirrored preview display. The promise rejects
 * with an honest reason — it never resolves an empty blob.
 */
export async function grabFrame(
  video: VideoSourceLike,
  deps: GrabFrameDeps = defaultGrabFrameDeps,
  options: GrabFrameOptions = {},
): Promise<Blob> {
  const { videoWidth, videoHeight } = video;
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth <= 0 || videoHeight <= 0) {
    throw new Error('Camera frame not ready — the preview has no dimensions yet.');
  }
  const { width, height } = computeFrameSize({ width: videoWidth, height: videoHeight });
  const canvas = deps.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Frame encoding unavailable — canvas 2D context could not be created.');
  }

  ctx.save();
  if (options.mirror === true) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', FRAME_JPEG_QUALITY);
  });
  if (blob === null) {
    throw new Error('Frame encoding failed — the browser returned no JPEG blob.');
  }
  return blob;
}

/** Stable per-frame id; crypto.randomUUID when available, honest fallback otherwise. */
export function createFrameId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  return `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ *
 * per-frame send progress (driven only by real sends and real acks)
 * ------------------------------------------------------------------ */

export type FrameSendProgress = {
  frameId: string;
  /** Total chunks planned for this frame. */
  chunkCount: number;
  /** Chunks the channel reported accepted (0..chunkCount, unique indices). */
  sentChunks: number;
  /** True once the desktop's verified `frame-ack` for this frame arrived. */
  acked: boolean;
  /** Total frame bytes (known when the send starts). */
  bytes: number;
  /** Bytes the desktop confirmed in its ack; 0 until it acknowledges. */
  ackedBytes: number;
};

export type FrameAckTracker = {
  /** Begin tracking a new frame; supersedes any previous tracking. */
  start(frame: { frameId: string; bytes: number; chunkCount: number }): FrameSendProgress;
  /** Record one accepted chunk send; `null` for stale/unknown indices. */
  onSent(chunkIndex: number): FrameSendProgress | null;
  /** Record the desktop's verified ack; `null` when the frameId is unknown. */
  onAck(ack: { frameId: string; bytes: number }): FrameSendProgress | null;
  /** Current progress, or `null` before the first `start`. */
  progress(): FrameSendProgress | null;
};

export function createFrameAckTracker(): FrameAckTracker {
  let current: FrameSendProgress | null = null;
  const sent = new Set<number>();

  const snapshot = (): FrameSendProgress => ({ ...current as FrameSendProgress });

  return {
    start(frame): FrameSendProgress {
      if (frame.chunkCount <= 0 || frame.bytes <= 0) {
        throw new Error('Frame tracking needs a positive chunk count and byte length.');
      }
      sent.clear();
      current = {
        frameId: frame.frameId,
        chunkCount: frame.chunkCount,
        sentChunks: 0,
        acked: false,
        bytes: frame.bytes,
        ackedBytes: 0,
      };
      return snapshot();
    },

    onSent(chunkIndex): FrameSendProgress | null {
      if (current === null) return null;
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= current.chunkCount) return null;
      if (!sent.has(chunkIndex)) {
        sent.add(chunkIndex);
        current = { ...current, sentChunks: sent.size };
      }
      return snapshot();
    },

    onAck(ack): FrameSendProgress | null {
      if (current === null || ack.frameId !== current.frameId) return null;
      current = { ...current, acked: true, ackedBytes: ack.bytes };
      return snapshot();
    },

    progress(): FrameSendProgress | null {
      return current === null ? null : snapshot();
    },
  };
}
