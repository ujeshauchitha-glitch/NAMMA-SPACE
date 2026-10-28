/**
 * T13 — bundle integrity suite.
 *
 * Builds a ZIP from fixture bytes, unzips it with fflate inside the test,
 * parses `manifest.json` through the zod contract, and verifies every
 * manifest digest against the bytes that actually shipped. Also proves:
 * deterministic (byte-identical) builds, honest copy (no banned wording in
 * the export constants or the manifest), and the hash-mismatch refusal path.
 */
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  EXPORT_COPY,
  IMAGE_DIR,
  MANIFEST_PATH,
  buildBundle,
  bundleFileNameFor,
  type BuildBundleInput,
} from '../src/lib/capture/exportBundle';
import { PreparedBundleManifestSchema } from '../src/types/scene';
import type { StoredImageRecord } from '../src/lib/storage';

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Structurally arbitrary bytes — the bundle never sniffs, it hashes. */
function fixtureBytes(seed: number, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (seed * 37 + index * 11) % 256;
  return bytes;
}

async function fixtureRecord(id: string, seed: number, stagedAt: number): Promise<StoredImageRecord> {
  const bytes = fixtureBytes(seed);
  return {
    id,
    blob: new Blob([bytes as BlobPart]),
    meta: {
      width: 640,
      height: 480,
      bytes: bytes.length,
      sha256: await sha256Hex(bytes),
      source: 'operator',
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
    displayName: 'Test space',
    createdAt: '2026-10-25T00:00:00.000Z',
    rooms: [
      { id: 'rm-2', name: 'Lab', dimensionsM: [6, 3, 4], originM: [0, 0, 0], createdAt: 200 },
      { id: 'rm-1', name: 'Lobby', dimensionsM: [6, 3, 4], originM: [0, 0, 0], createdAt: 100 },
    ],
    viewGroups: [
      { id: 'vg-2', name: 'Rear', roomId: 'rm-1', createdAt: 300, imageIds: [] },
      { id: 'vg-1', name: 'Front', roomId: 'rm-1', createdAt: 150, imageIds: [] },
      { id: 'vg-9', name: 'Detail', roomId: 'rm-2', createdAt: 400, imageIds: [] },
    ],
    images: [
      { record: beta, viewGroupId: 'vg-2' },
      { record: alpha, viewGroupId: 'vg-1' },
    ],
  };
}

describe('prepared capture bundle (T13)', () => {
  it('builds a zip whose manifest parses and whose digests match the shipped bytes', async () => {
    const built = await buildBundle(await fixtureInput());
    const archive = unzipSync(built.bytes);

    expect(Object.keys(archive)[0]).toBe(MANIFEST_PATH);
    const manifest = PreparedBundleManifestSchema.parse(JSON.parse(strFromU8(archive[MANIFEST_PATH])));
    expect(manifest.bundleKind).toBe('prepared-capture');
    expect(manifest.provenance.source).toBe('operator');
    expect(manifest.counts).toEqual({ images: 2, rooms: 2, viewGroups: 3 });

    // Deterministic ordering despite shuffled input.
    expect(manifest.images.map((image) => image.id)).toEqual(['img-alpha', 'img-beta']);
    expect(manifest.rooms.map((room) => room.id)).toEqual(['rm-1', 'rm-2']);
    expect(manifest.viewGroups.map((group) => group.id)).toEqual(['vg-1', 'vg-2', 'vg-9']);
    expect(manifest.rooms[0].viewGroupIds).toEqual(['vg-1', 'vg-2']);

    // Every entry verifiable against the actual bytes in the archive.
    for (const entry of manifest.images) {
      expect(entry.file).toBe(`${IMAGE_DIR}/${entry.sha256}.jpg`);
      const fileBytes = archive[entry.file];
      expect(fileBytes).toBeDefined();
      expect(fileBytes.length).toBe(entry.bytes);
      expect(await sha256Hex(fileBytes)).toBe(entry.sha256);
    }
  });

  it('is byte-identical across builds of the same input (deterministic ordering + fixed mtimes)', async () => {
    const input = await fixtureInput();
    const first = await buildBundle(input);
    const second = await buildBundle(await fixtureInput());
    expect(first.bytes.length).toBe(second.bytes.length);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });

  it('refuses to write a bundle when a record hash does not match its bytes', async () => {
    const input = await fixtureInput();
    input.images[0].record.meta.sha256 = 'f'.repeat(64);
    await expect(buildBundle(input)).rejects.toThrow(/does not match its stored bytes/);
  });

  it('refuses a view group that points outside the bundle rooms', async () => {
    const input = await fixtureInput();
    input.viewGroups[0].roomId = 'rm-ghost';
    await expect(buildBundle(input)).rejects.toThrow(/references a room/);
  });

  it('keeps export copy and manifest free of banned wording (§9.1)', async () => {
    expect(JSON.stringify(EXPORT_COPY).toLowerCase()).not.toContain('reconstruct');
    const built = await buildBundle(await fixtureInput());
    expect(JSON.stringify(built.manifest).toLowerCase()).not.toContain('reconstruct');
    expect(built.fileNames.every((name) => !/reconstruct/i.test(name))).toBe(true);
    // Filename is honest about what the archive is.
    expect(bundleFileNameFor('2026-10-25T12:34:56.000Z')).toBe(
      'namma-space-prepared-capture-2026-10-25T12-34-56-000Z.zip',
    );
    expect(bundleFileNameFor('2026-10-25T12:34:56.000Z')).not.toMatch(/reconstruct/i);
  });
});
