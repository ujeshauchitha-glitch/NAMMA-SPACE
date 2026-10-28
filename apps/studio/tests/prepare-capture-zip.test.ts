/**
 * Capture-to-pipeline seam (Workstream C).
 *
 * The studio exports a prepared-capture ZIP (`exportBundle.ts`: root
 * `manifest.json` + `images/<sha256>.jpg`). These tests drive the REAL
 * exporter to build the fixtures, then hand them to the REAL
 * `scripts/prepare_capture.py` and assert on the observable contract:
 * deterministic flat `frames/`, verified digests, preserved room/view-group
 * metadata, and actionable failures for corrupt or hostile archives.
 *
 * Every fixture is tiny synthetic bytes created by the test itself — no
 * real photos ever enter the repo (see .gitignore guarantees).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { buildBundle, type BuildBundleInput } from '../src/lib/capture/exportBundle';

/* ------------------------------------------------------------------ fixtures */

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Synthetic JPEG-magic bytes so the Python sniffer classifies them honestly. */
function fixtureBytes(seed: number, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (let index = 4; index < length; index += 1) bytes[index] = (seed * 37 + index * 11) % 256;
  return bytes;
}

async function fixtureRecord(id: string, seed: number, stagedAt: number) {
  const bytes = fixtureBytes(seed);
  return {
    id,
    blob: new Blob([bytes as BlobPart]),
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

/** Two rooms, three view groups, two images — mirrors the T13 fixture shape. */
async function fixtureInput(): Promise<BuildBundleInput> {
  const [alpha, beta] = await Promise.all([
    fixtureRecord('img-alpha', 2, 1_000),
    fixtureRecord('img-beta', 5, 2_000),
  ]);
  return {
    displayName: 'Seam test space',
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

/* ------------------------------------------------------------------ runners */

type PrepareResult = { code: number; stdout: string; stderr: string };

function runPrepare(input: string, output: string, extraArgs: string[] = []): PrepareResult {
  try {
    const stdout = execFileSync('python3', ['scripts/prepare_capture.py', input, '--output', output, ...extraArgs], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function tempRoot(name: string): string {
  return mkdtempSync(join(tmpdir(), `namma-${name}-`));
}

type ZipFiles = Record<string, Uint8Array>;

async function builtZip(input: BuildBundleInput | Promise<BuildBundleInput> = fixtureInput()): Promise<ZipFiles> {
  const built = await buildBundle(await input);
  return unzipSync(built.bytes);
}

async function writeZip(files: ZipFiles, root: string, name = 'bundle.zip'): Promise<string> {
  const path = join(root, name);
  writeFileSync(path, zipSync(files, { level: 6 }));
  return path;
}

interface FrameManifest {
  source: { kind: string; sha256: string | null };
  sampling: { fps: number | null; limit: number };
  bundle?: {
    displayName: string;
    createdAt: string;
    rooms: Array<{ id: string; name: string; viewGroupIds: string[] }>;
    viewGroups: Array<{ id: string; name: string; roomId: string | null; imageIds: string[] }>;
  };
  frames: Array<{
    id: string;
    path: string;
    sha256: string;
    sourceEntryId: string;
    viewGroupId: string | null;
    roomId: string | null;
    width: number;
    height: number;
    source: string;
    stagedAt: number;
  }>;
  quality: { status: string; warnings: string[] };
}

function readOutputManifest(output: string): FrameManifest {
  return JSON.parse(readFileSync(join(output, 'frame-manifest.json'), 'utf8')) as FrameManifest;
}

/* ------------------------------------------------------------------ tests */

describe('prepare_capture.py consumes the exported bundle ZIP', () => {
  it('round-trips a real exporter bundle: verified frames + preserved rooms/view groups', async () => {
    const root = tempRoot('seam-roundtrip');
    const zip = await writeZip(await builtZip(), root);
    const output = join(root, 'out');

    const result = runPrepare(zip, output);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Prepared 2 frames');

    const manifest = readOutputManifest(output);

    // Flat deterministic frames dir (COLMAP reads it non-recursively).
    const frames = manifest.frames.map((frame) => frame.id);
    expect(frames).toEqual(['frame-00001', 'frame-00002']);
    for (const frame of manifest.frames) {
      const onDisk = join(output, frame.path);
      expect(existsSync(onDisk)).toBe(true);
      const digest = createHash('sha256').update(readFileSync(onDisk)).digest('hex');
      expect(digest).toBe(frame.sha256);
    }

    // Room/view-group metadata survives the seam — no silent loss.
    expect(manifest.bundle?.displayName).toBe('Seam test space');
    expect(manifest.bundle?.rooms.map((room) => room.id)).toEqual(['rm-1', 'rm-2']);
    expect(manifest.bundle?.viewGroups.map((group) => group.id)).toEqual(['vg-1', 'vg-2', 'vg-9']);
    const alpha = manifest.frames.find((frame) => frame.sourceEntryId === 'img-alpha');
    const beta = manifest.frames.find((frame) => frame.sourceEntryId === 'img-beta');
    expect(alpha).toMatchObject({ viewGroupId: 'vg-1', roomId: 'rm-1' });
    expect(beta).toMatchObject({ viewGroupId: 'vg-2', roomId: 'rm-1' });

    // Honest provenance: source kind + digest of the archive itself.
    expect(manifest.source.kind).toBe('prepared-capture-bundle');
    expect(manifest.source.sha256).toBe(createHash('sha256').update(readFileSync(zip)).digest('hex'));
    expect(manifest.sampling).toEqual({ fps: null, limit: 120 });
    expect(manifest.quality.status).toBe('warning'); // synthetic frames are tiny/few — honest, not inflated
  });

  it('refuses a bundle whose archived bytes no longer match the manifest sha256', async () => {
    const root = tempRoot('seam-hash-mismatch');
    const files = await builtZip();
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as { images: Array<{ file: string }> };
    // Corrupt the payload under a manifest entry, keeping the declared digest.
    files[manifest.images[0].file][0] ^= 0xff;
    const zip = await writeZip(files, root);
    const output = join(root, 'out');

    const result = runPrepare(zip, output);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/sha256 mismatch/);
    expect(result.stderr).toContain(manifest.images[0].file);
    expect(result.stderr).toMatch(/corrupt|re-export/i);
    expect(existsSync(join(output, 'frame-manifest.json'))).toBe(false);
  });

  it('refuses a bundle whose payload length disagrees with the declared byte count', async () => {
    const root = tempRoot('seam-size-mismatch');
    const files = await builtZip();
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as { images: Array<{ file: string; bytes: number }> };
    manifest.images[0].bytes += 1; // keep the digest valid; lie only about the size
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    const zip = await writeZip(files, root);

    const result = runPrepare(zip, join(root, 'out'));
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/size mismatch/i);
    expect(result.stderr).toContain(manifest.images[0].file);
  });

  it.each([
    ['invalid JSON', (files: ZipFiles) => {
      files['manifest.json'] = new TextEncoder().encode('{"schemaVersion": 1,');
    }, /not valid JSON/],
    ['unsupported schema version', (files: ZipFiles) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      manifest.schemaVersion = 99;
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    }, /schemaVersion/],
    ['not a prepared-capture bundle', (files: ZipFiles) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      manifest.bundleKind = 'scene-bundle';
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    }, /prepared-capture/],
    ['image referencing an undeclared view group', (files: ZipFiles) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      manifest.images[0].viewGroupId = 'vg-ghost';
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    }, /view group/],
    ['view group referencing an undeclared room', (files: ZipFiles) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      manifest.viewGroups[0].roomId = 'rm-ghost';
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    }, /room/],
    ['image entry pointing outside images/', (files: ZipFiles) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      manifest.images[0].file = '../escape.jpg';
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    }, /images\//],
  ])('rejects a corrupt manifest (%s) with an actionable error', async (_label, mutate, expected) => {
    const root = tempRoot('seam-bad-manifest');
    const files = await builtZip();
    mutate(files);
    const zip = await writeZip(files, root);
    const output = join(root, 'out');

    const result = runPrepare(zip, output);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(expected);
    expect(existsSync(join(output, 'frame-manifest.json'))).toBe(false);
  });

  it('rejects a manifest image reference that is missing from the archive', async () => {
    const root = tempRoot('seam-missing-ref');
    const files = await builtZip();
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as { images: Array<{ file: string }> };
    delete files[manifest.images[1].file];
    const zip = await writeZip(files, root);

    const result = runPrepare(zip, join(root, 'out'));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(manifest.images[1].file);
    expect(result.stderr).toMatch(/not in the archive/);
  });

  it('skips archive files the manifest does not reference and says so', async () => {
    const root = tempRoot('seam-unreferenced');
    const files = await builtZip();
    files['images/deadbeef.jpg'] = fixtureBytes(9);
    files['notes.txt'] = new TextEncoder().encode('stray file');
    const zip = await writeZip(files, root);
    const output = join(root, 'out');

    const result = runPrepare(zip, output);
    expect(result.code).toBe(0);
    const manifest = readOutputManifest(output);
    expect(manifest.frames).toHaveLength(2);
    expect(manifest.quality.warnings.join('\n')).toMatch(/not referenced by manifest\.json/);
    expect(existsSync(join(output, 'frames', 'deadbeef.jpg'))).toBe(false);
  });

  it('refuses path-traversal entries before writing anything', async () => {
    const root = tempRoot('seam-traversal');
    const files = await builtZip();
    files['../evil.jpg'] = fixtureBytes(3);
    files['/absOLUTE.jpg'] = fixtureBytes(4);
    const zip = await writeZip(files, root);
    const output = join(root, 'out');

    const result = runPrepare(zip, output);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/escapes the output directory|absolute path/);
    expect(existsSync(join(root, 'evil.jpg'))).toBe(false);
    expect(existsSync(join(output, 'evil.jpg'))).toBe(false);
    expect(existsSync(join(output, 'frames', 'evil.jpg'))).toBe(false);
  });

  it('handles an empty archive and a manifest with no images', async () => {
    const emptyRoot = tempRoot('seam-empty-zip');
    const emptyZip = await writeZip({}, emptyRoot);
    const emptyResult = runPrepare(emptyZip, join(emptyRoot, 'out'));
    expect(emptyResult.code).toBe(2);
    expect(emptyResult.stderr).toMatch(/no manifest\.json/);

    const noImagesRoot = tempRoot('seam-no-images');
    const files = await builtZip();
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.images = [];
    manifest.counts.images = 0;
    for (const group of manifest.viewGroups) group.imageIds = [];
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    for (const name of Object.keys(files)) if (name.startsWith('images/')) delete files[name];
    const noImagesZip = await writeZip(files, noImagesRoot);
    const noImagesResult = runPrepare(noImagesZip, join(noImagesRoot, 'out'));
    expect(noImagesResult.code).toBe(2);
    expect(noImagesResult.stderr).toMatch(/no images/);
  });

  it('applies --limit with honest truncation reporting', async () => {
    const root = tempRoot('seam-limit');
    const input = await fixtureInput();
    const third = await fixtureRecord('img-third', 7, 3_000);
    input.images.push({ record: third, viewGroupId: 'vg-9' });
    const zip = await writeZip(await builtZip(input), root);
    const output = join(root, 'out');

    const result = runPrepare(zip, output, ['--limit', '2']);
    expect(result.code).toBe(0);
    const manifest = readOutputManifest(output);
    expect(manifest.frames).toHaveLength(2);
    expect(manifest.sampling.limit).toBe(2);
    const truncation = manifest.quality.warnings.join('\n');
    expect(truncation).toMatch(/3 images but --limit is 2/);
    expect(truncation).toMatch(/1 image\(s\) were not prepared/);
  });
});
