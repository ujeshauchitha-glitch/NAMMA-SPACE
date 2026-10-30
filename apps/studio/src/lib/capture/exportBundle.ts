/**
 * ZIP bundle export (T13) — lazy `fflate`, deterministic, verifiable.
 *
 * The archive holds exactly two things: `manifest.json` (zod-validated,
 * additive extension of the scene contract) and the staged frames under
 * `images/<sha256>.jpg`. Every manifest digest is recomputed from the bytes
 * that actually go into the ZIP, so an offline checker can verify the bundle
 * with nothing but the archive. Ordering and mtimes are fixed → the same
 * input always produces byte-identical output.
 *
 * Copy rule (§9.1): staged media is *prepared*, never claimed otherwise —
 * `EXPORT_COPY` is grep-verified free of banned wording by
 * tests/bundle-integrity.test.ts.
 */
import type {
  Observation,
  PreparedBundleManifest,
  PreparedRoom,
  PreparedViewGroup,
  StagedImageEntry,
} from '../../types/scene';
import type { StoredImageRecord } from '../storage';
import { sha256Hex } from './hash';
import { createObjectUrl, revokeObjectUrl } from '../objectUrls';

export const MANIFEST_PATH = 'manifest.json';
export const IMAGE_DIR = 'images';
/**
 * Fixed archive timestamp (1980-01-01T00:00:00Z — the ZIP epoch; fflate
 * rejects anything earlier). Keeps every build byte-identical.
 */
const FIXED_MTIME = 315_532_800_000;

/** Every user-facing export string lives here (grep-verified in T13 tests). */
export const EXPORT_COPY = {
  button: 'Export bundle',
  building: 'Building manifest.json + images…',
  note: 'Prepared capture — staged frames and their manifest only.',
  failedTitle: 'Bundle export failed',
  successTitle: (images: number) => `Bundle prepared — ${images} image${images === 1 ? '' : 's'}`,
} as const;

export type BundleRoomInput = Omit<PreparedRoom, 'viewGroupIds'>;
export type BundleViewGroupInput = PreparedViewGroup;
export type BundleImageInput = {
  record: StoredImageRecord;
  viewGroupId: string | null;
  /** Original filename when the studio actually had one; omitted otherwise. */
  sourceFilename?: string;
  /** Override when the frame did not come from a still photograph. */
  modality?: Observation['modality'];
};

export type CaptureContext = {
  projectId?: string;
  spaceId?: string;
  captureSessionId?: string;
};

export type BuildBundleInput = {
  displayName: string;
  /** ISO-8601 injected by the caller (tests inject a fixed stamp). */
  createdAt: string;
  rooms: BundleRoomInput[];
  viewGroups: BundleViewGroupInput[];
  images: BundleImageInput[];
  captureContext?: CaptureContext;
};

/** Quality properties this emitter never measures — copied into every observation. */
export const OBSERVATION_NOT_MEASURED = [
  'blur',
  'exposure consistency',
  'camera coverage',
  'pose registration',
  'scale accuracy',
  'geometry completeness',
  'navigation trustworthiness',
] as const;

function formatFromBlobType(type: string): Observation['format'] | undefined {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpeg';
  return undefined;
}

function modalityFor(image: BundleImageInput): Observation['modality'] {
  if (image.modality) return image.modality;
  return image.record.meta.source === 'phone' ? 'live-frame' : 'photo';
}

function buildObservation(
  image: BundleImageInput,
  sha256: string,
  byteLength: number,
  roomId: string | null,
  context: CaptureContext | undefined,
): Observation {
  const format = formatFromBlobType(image.record.blob.type);
  const observation: Observation = {
    modality: modalityFor(image),
    orientation: 'unknown',
    cameraMetadata: { status: 'unknown' },
    contentHash: sha256,
    qualityResults: {
      status: 'unknown',
      notMeasured: [...OBSERVATION_NOT_MEASURED],
    },
    provenance: {
      emitter: 'namma-space capture studio (browser ingest)',
      stage: 'browser-staging',
    },
    viewGroupId: image.viewGroupId,
    roomId,
    width: image.record.meta.width,
    height: image.record.meta.height,
    bytes: byteLength,
    stagedAt: image.record.stagedAt,
  };
  if (context?.projectId) observation.projectId = context.projectId;
  if (context?.spaceId) observation.spaceId = context.spaceId;
  if (context?.captureSessionId) observation.captureSessionId = context.captureSessionId;
  if (image.sourceFilename) observation.sourceFilename = image.sourceFilename;
  if (format) observation.format = format;
  return observation;
}

export type BuiltBundle = {
  bytes: Uint8Array;
  manifest: PreparedBundleManifest;
  fileNames: string[];
};

const HASH_MISMATCH_MESSAGE =
  'A staged record does not match its stored bytes — the bundle was not written. Re-stage the affected image and retry.';

/** Stable ordering: creation/staging time first, id as the tie-break. */
function byTimeThenId(
  a: { id?: string; record?: { id: string; stagedAt?: number }; createdAt?: number; stagedAt?: number },
  b: { id?: string; record?: { id: string; stagedAt?: number }; createdAt?: number; stagedAt?: number },
): number {
  const at = a.createdAt ?? a.stagedAt ?? a.record?.stagedAt ?? 0;
  const bt = b.createdAt ?? b.stagedAt ?? b.record?.stagedAt ?? 0;
  const aId = a.id ?? a.record?.id ?? '';
  const bId = b.id ?? b.record?.id ?? '';
  return at - bt || aId.localeCompare(bId);
}

export function bundleFileNameFor(isoTimestamp: string): string {
  return `namma-space-prepared-capture-${isoTimestamp.replace(/[:.]/g, '-')}.zip`;
}

export async function buildBundle(input: BuildBundleInput): Promise<BuiltBundle> {
  const { zipSync, strToU8 } = await import('fflate');

  const viewGroups = [...input.viewGroups].sort(byTimeThenId).map((group) => ({ ...group }));
  const roomIds = new Set(input.rooms.map((room) => room.id));
  const rooms = [...input.rooms]
    .sort(byTimeThenId)
    .map((room) => ({
      ...room,
      viewGroupIds: viewGroups.filter((group) => group.roomId === room.id).map((group) => group.id),
    }));

  const roomIdByGroup = new Map<string, string | null>();
  for (const group of viewGroups) roomIdByGroup.set(group.id, group.roomId);

  const sortedImages = [...input.images].sort(byTimeThenId);
  const imageIdsByGroup = new Map<string, string[]>();
  for (const image of sortedImages) {
    if (!image.viewGroupId) continue;
    const list = imageIdsByGroup.get(image.viewGroupId) ?? [];
    list.push(image.record.id);
    imageIdsByGroup.set(image.viewGroupId, list);
  }

  // Rebuild every digest from the bytes that actually ship. A mismatch means
  // the stored record and its blob drifted apart — fail loudly, never write a
  // bundle whose manifest cannot be verified offline.
  const files: Record<string, [Uint8Array, { mtime: number }]> = {};
  const entries: StagedImageEntry[] = [];
  const seen = new Set<string>();

  for (const image of sortedImages) {
    const { record, viewGroupId } = image;
    const raw = await record.blob.arrayBuffer();
    const bytes = new Uint8Array(raw);
    if (bytes.length === 0) throw new Error(HASH_MISMATCH_MESSAGE);
    const sha256 = await sha256Hex(bytes);
    if (sha256 !== record.meta.sha256) throw new Error(HASH_MISMATCH_MESSAGE);

    const file = `${IMAGE_DIR}/${sha256}.jpg`;
    if (!seen.has(sha256)) {
      seen.add(sha256);
      // Fixed mtime keeps the archive byte-identical across builds.
      files[file] = [bytes, { mtime: FIXED_MTIME }];
    }
    const roomId = viewGroupId ? (roomIdByGroup.get(viewGroupId) ?? null) : null;
    entries.push({
      id: record.id,
      viewGroupId,
      sha256,
      bytes: bytes.length,
      width: record.meta.width,
      height: record.meta.height,
      source: record.meta.source,
      stagedAt: record.stagedAt,
      file,
      observation: buildObservation(
        { record, viewGroupId, sourceFilename: image.sourceFilename, modality: image.modality },
        sha256,
        bytes.length,
        roomId,
        input.captureContext,
      ),
    });
  }

  const manifest: PreparedBundleManifest = {
    schemaVersion: 1,
    bundleKind: 'prepared-capture',
    displayName: input.displayName,
    createdAt: input.createdAt,
    provenance: {
      source: 'operator',
      pipeline: 'namma-space capture studio (browser ingest)',
      notes: ['Staged frames and their manifest only — no poses or geometry are claimed.'],
    },
    counts: { images: entries.length, rooms: rooms.length, viewGroups: viewGroups.length },
    rooms: rooms.map((room) => ({ ...room, viewGroupIds: room.viewGroupIds })),
    viewGroups: viewGroups.map((group) => ({ ...group, imageIds: imageIdsByGroup.get(group.id) ?? [] })),
    images: entries,
  };

  // Room/group inputs must reference each other honestly.
  for (const group of viewGroups) {
    if (group.roomId !== null && !roomIds.has(group.roomId)) {
      throw new Error(`View group ${group.id} references a room that is not part of this bundle.`);
    }
  }

  const archive: Record<string, [Uint8Array, { mtime: number }]> = {
    [MANIFEST_PATH]: [strToU8(`${JSON.stringify(manifest, null, 2)}\n`), { mtime: FIXED_MTIME }],
    ...files,
  };
  const bytes = zipSync(archive, { level: 6, mtime: FIXED_MTIME });

  return { bytes, manifest, fileNames: Object.keys(archive) };
}

export type DownloadedBundle = { fileName: string; imageCount: number };

/** Build + download via one revocable object URL (registry-owned, §3.3). */
export async function downloadBundle(input: BuildBundleInput): Promise<DownloadedBundle> {
  const built = await buildBundle(input);
  const url = createObjectUrl(new Blob([built.bytes as BlobPart], { type: 'application/zip' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = bundleFileNameFor(input.createdAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Chromium has queued the download by the time click() returns; revoke on
    // a later task so the URL never outlives its use (§3.3).
    setTimeout(() => revokeObjectUrl(url), 1_000);
  }
  return { fileName: bundleFileNameFor(input.createdAt), imageCount: built.manifest.counts.images };
}
