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
