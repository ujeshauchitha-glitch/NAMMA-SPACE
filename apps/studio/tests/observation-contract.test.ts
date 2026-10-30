/**
 * T-B — unified Observation contract.
 *
 * One canonical per-frame `Observation` schema (src/types/scene.ts) that the
 * studio export path emits on every staged image entry, converging the three
 * formerly disjoint per-frame schemas (studio ImageMeta, bundle entry zod,
 * Python frame record) without a flag day.
 *
 * Honesty rules under test (they hold everywhere):
 *  - a field whose value was never read is OMITTED, or carries the explicit
 *    unknown marker (`orientation: 'unknown'`, `cameraMetadata.status:
 *    'unknown'`, `qualityResults.status: 'unknown'`) — never guessed;
 *  - no pose, EXIF or video timestamp is ever fabricated;
 *  - legacy manifests (entries without an `observation`) keep parsing.
 */
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  OBSERVATION_NOT_MEASURED,
  buildBundle,
  type BuildBundleInput,
} from '../src/lib/capture/exportBundle';
import {
  ObservationSchema,
  PreparedBundleManifestSchema,
  StagedImageEntrySchema,
  type Observation,
} from '../src/types/scene';
import type { StoredImageRecord } from '../src/lib/storage';

/* ------------------------------------------------------------------ fixtures */

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fixtureBytes(seed: number, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (let index = 4; index < length; index += 1) bytes[index] = (seed * 37 + index * 11) % 256;
  return bytes;
}

async function fixtureRecord(
  id: string,
  seed: number,
  stagedAt: number,
  type = '',
): Promise<StoredImageRecord> {
  const bytes = fixtureBytes(seed);
  return {
    id,
    blob: new Blob([bytes as BlobPart], type ? { type } : undefined),
    meta: {
      width: 640,
      height: 480,
      bytes: bytes.length,
      sha256: await sha256Hex(bytes),
      source: 'operator' as const,
    },
    stagedAt,
  };
}

async function fixtureInput(): Promise<BuildBundleInput> {
  const [alpha, beta] = await Promise.all([
    fixtureRecord('img-alpha', 2, 1_000),
    fixtureRecord('img-beta', 5, 2_000),
  ]);
  return {
    displayName: 'Observation test space',
    createdAt: '2026-10-30T00:00:00.000Z',
    rooms: [{ id: 'rm-1', name: 'Lobby', dimensionsM: [6, 3, 4], originM: [0, 0, 0], createdAt: 100 }],
    viewGroups: [{ id: 'vg-1', name: 'Front', roomId: 'rm-1', createdAt: 150, imageIds: [] }],
    images: [
      { record: beta, viewGroupId: null },
      { record: alpha, viewGroupId: 'vg-1' },
    ],
  };
}

const SHA256_A = 'a'.repeat(64);

function minimalObservation(): Observation {
  return {
    modality: 'photo',
    orientation: 'unknown',
    cameraMetadata: { status: 'unknown' },
    contentHash: SHA256_A,
    qualityResults: { status: 'unknown' },
    provenance: { emitter: 'test-emitter', stage: 'test-stage' },
  };
}

/* ------------------------------------------------------------------ schema */

describe('ObservationSchema', () => {
  it('accepts a minimal honest observation and defaults notMeasured to []', () => {
    const parsed = ObservationSchema.parse(minimalObservation());
    // Required markers are always present…
    expect(parsed.orientation).toBe('unknown');
    expect(parsed.cameraMetadata).toEqual({ status: 'unknown' });
    expect(parsed.contentHash).toBe(SHA256_A);
    // …everything not actually read is omitted, and the Python notMeasured
    // pattern defaults honestly.
    expect(parsed.qualityResults).toEqual({ status: 'unknown', notMeasured: [] });
    expect('sourceFilename' in parsed).toBe(false);
    expect('perFrameTimestampSec' in parsed).toBe(false);
    expect('projectId' in parsed).toBe(false);
  });

  it('restricts modality to photo | video-frame | live-frame', () => {
    expect(ObservationSchema.safeParse({ ...minimalObservation(), modality: 'image' }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...minimalObservation(), modality: 'photo' }).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...minimalObservation(), modality: 'video-frame' }).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...minimalObservation(), modality: 'live-frame' }).success).toBe(true);
  });

  it('restricts orientation to EXIF values 1–8 or the explicit unknown marker', () => {
    for (const orientation of [1, 6, 'unknown']) {
      expect(ObservationSchema.safeParse({ ...minimalObservation(), orientation }).success).toBe(true);
    }
    for (const orientation of [0, 9, 'assumed-portrait']) {
      expect(ObservationSchema.safeParse({ ...minimalObservation(), orientation }).success).toBe(false);
    }
  });

  it('never pairs an unknown camera block with invented values', () => {
    const fabricated = { ...minimalObservation(), cameraMetadata: { status: 'unknown' as const, make: 'Canon' } };
    expect(ObservationSchema.safeParse(fabricated).success).toBe(false);
    const recorded = {
      ...minimalObservation(),
      cameraMetadata: { status: 'recorded' as const, make: 'Canon', iso: 400 },
    };
    expect(ObservationSchema.safeParse(recorded).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...minimalObservation(), cameraMetadata: { status: 'recorded' as const, iso: -5 } }).success).toBe(false);
  });

  it('requires a well-formed sha256 content hash', () => {
    expect(ObservationSchema.safeParse({ ...minimalObservation(), contentHash: 'not-a-digest' }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...minimalObservation(), contentHash: 'A'.repeat(64) }).success).toBe(false);
  });

  it('keeps legacy staged entries (without an observation) parsing', () => {
    const legacy = StagedImageEntrySchema.parse({
      id: 'img-legacy',
      viewGroupId: 'vg-1',
      sha256: SHA256_A,
      bytes: 64,
      width: 640,
      height: 480,
      source: 'operator',
      stagedAt: 1_000,
      file: `images/${SHA256_A}.jpg`,
    });
    expect(legacy.observation).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ emission */

describe('buildBundle emits one observation per exported image', () => {
  it('records what the studio knows and marks the rest unknown — never guessed', async () => {
    const built = await buildBundle(await fixtureInput());
    const manifest = PreparedBundleManifestSchema.parse(JSON.parse(strFromU8(unzipSync(built.bytes)['manifest.json'])));

    expect(manifest.images).toHaveLength(2);
    for (const entry of manifest.images) {
      const observation = entry.observation;
      expect(observation).toBeDefined();
      if (!observation) throw new Error('observation missing');
      // Content hash is rebuilt from the bytes that actually ship.
      expect(observation.contentHash).toBe(entry.sha256);
      // Identity/placement the studio actually has.
      expect(observation.viewGroupId).toBe(entry.viewGroupId);
      expect(observation.roomId).toBe(entry.viewGroupId ? 'rm-1' : null);
      expect(observation.stagedAt).toBe(entry.stagedAt);
      expect(observation.width).toBe(entry.width);
      expect(observation.height).toBe(entry.height);
      expect(observation.bytes).toBe(entry.bytes);
      expect(observation.modality).toBe('photo');
      // Explicit unknown markers — EXIF and quality are never read here.
      expect(observation.orientation).toBe('unknown');
      expect(observation.cameraMetadata).toEqual({ status: 'unknown' });
      expect(observation.qualityResults.status).toBe('unknown');
      expect(OBSERVATION_NOT_MEASURED.every((name) => observation.qualityResults.notMeasured.includes(name))).toBe(true);
      expect(observation.provenance).toEqual({
        emitter: 'namma-space capture studio (browser ingest)',
        stage: 'browser-staging',
      });
      // Unknown stays omitted: no filename, no project/space/session ids, no
      // fabricated format, and no video timestamp on a staged still.
      expect('sourceFilename' in observation).toBe(false);
      expect('projectId' in observation).toBe(false);
      expect('spaceId' in observation).toBe(false);
      expect('captureSessionId' in observation).toBe(false);
      expect('format' in observation).toBe(false);
      expect('perFrameTimestampSec' in observation).toBe(false);
    }
  });

  it('emits caller-supplied identity, source filename and measured format when available', async () => {
    const input = await fixtureInput();
    const withPng = await fixtureRecord('img-png', 7, 3_000, 'image/png');
    input.images.push({
      record: withPng,
      viewGroupId: 'vg-1',
      sourceFilename: 'IMG_0042.PNG',
    });
    input.captureContext = { projectId: 'prj-1', spaceId: 'spc-1', captureSessionId: 'cap-1' };

    const { manifest } = await buildBundle(input);
    const pngEntry = manifest.images.find((entry) => entry.id === 'img-png');
    const observation = pngEntry?.observation;
    expect(observation).toBeDefined();
    if (!observation || !pngEntry) throw new Error('observation missing');
    expect(observation.projectId).toBe('prj-1');
    expect(observation.spaceId).toBe('spc-1');
    expect(observation.captureSessionId).toBe('cap-1');
    expect(observation.sourceFilename).toBe('IMG_0042.PNG');
    // Format is measured from the blob MIME type, not invented from the name.
    expect(observation.format).toBe('png');
    expect(pngEntry.file).toBe(`images/${pngEntry.sha256}.jpg`);
  });

  it('stays byte-identical across builds of the same input (observations included)', async () => {
    const build = async () => {
      const input = await fixtureInput();
      input.captureContext = { projectId: 'prj-1', spaceId: 'spc-1', captureSessionId: 'cap-1' };
      input.images[1].sourceFilename = 'IMG_0001.jpg';
      return buildBundle(input);
    };
    const first = await build();
    const second = await build();
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });
});
