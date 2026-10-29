/**
 * Phone-frame ingest (T21) — wires a SHA-256-verified datachannel frame
 * into the T11 staged-images flow.
 *
 * The pairing session only emits `frame` after the received digest matched
 * the sender's, so the bytes entering here are already verified; this
 * helper wraps them as exactly one ingest run labelled
 * `source: 'phone'` — Capture Studio then renders them as
 * `● MEASURED · PHONE`. Every outcome settles as an `IngestResult`:
 * nothing is staged unverified, nothing is dropped silently.
 */
import { ingestFiles, type IngestDeps, type IngestResult } from '../capture';
import type { WorkspaceAction } from '../../state/types';

/** One verified inbound frame — the pairing session `frame` event payload. */
export type PhoneFrame = {
  frameId: string;
  data: Uint8Array;
};

/**
 * Ingest one phone frame through the T11 pipeline with `source: 'phone'`.
 * The frame id becomes the file name (`<frameId>.jpg`) so failures in the
 * result list name the frame that failed, not a synthetic file.
 */
export async function ingestPhoneFrame(
  frame: PhoneFrame,
  deps: IngestDeps,
): Promise<IngestResult[]> {
  // slice() copies into a fresh ArrayBuffer-backed view — BlobPart refuses
  // SharedArrayBuffer-backed views, and the copy keeps caller buffers safe.
  const file = new File([frame.data.slice()], `${frame.frameId}.jpg`, { type: 'image/jpeg' });
  return ingestFiles([file], deps, { source: 'phone' });
}

/** The single store action this helper emits — a staged phone frame. */
export type StagePhoneFrameAction = Extract<WorkspaceAction, { type: 'image/stage' }>;

export type StageVerifiedFrameDeps = {
  /** T11 ingest seam (`putImage` + optional decode/now for tests). */
  ingest: IngestDeps;
  /** Store seam; receives exactly one `image/stage` per verified frame. */
  dispatch: (action: StagePhoneFrameAction) => void;
  /** Honest failure surface — mirrors the workspace toast contract. */
  onError: (title: string, detail: string) => void;
};

/**
 * Verified inbound frame → `image/stage` (the receive-path tail of the T11
 * flow, extracted from Live Scan so the staging contract unit-tests in node).
 *
 * HONESTY (lifecycle §3.3 / spec risk §7.3): display URLs are single-owned —
 * this path stages with the canonical empty `objectUrl` and mints NO registry
 * URL. Live Scan never renders these frames itself (the panel shows a count,
 * the visualizer draws unposed markers), so a URL minted here had no
 * revocation path in this component: repeated pairing sessions accumulated
 * unreclaimed blobs (T25 R3 TRUE POSITIVE). The durable bytes are in storage
 * BEFORE this dispatch, and Capture Studio's restore effect mints the display
 * URL from them when the tile is actually shown — the same canonical state a
 * reload leaves behind (`toPersistedSnapshot` strips objectUrls), so
 * thumbnails behave identically on handoff, in-app switch, and reload.
 *
 * Every outcome settles honestly: ok results dispatch exactly one stage
 * action, failures surface through `onError` with the file that failed, and
 * an unexpected throw is reported rather than swallowed or allowed to reject
 * upward.
 */
export async function stageVerifiedFrame(
  frame: PhoneFrame,
  deps: StageVerifiedFrameDeps,
): Promise<void> {
  try {
    const results = await ingestPhoneFrame(frame, deps.ingest);
    for (const result of results) {
      if (result.ok) {
        deps.dispatch({
          type: 'image/stage',
          id: result.record.id,
          viewGroupId: null,
          objectUrl: '',
          meta: result.record.meta,
          at: result.record.stagedAt,
        });
      } else {
        deps.onError(`${result.file} was not staged`, result.message);
      }
    }
  } catch (error) {
    deps.onError('Phone frame could not be staged', error instanceof Error ? error.message : String(error));
  }
}
