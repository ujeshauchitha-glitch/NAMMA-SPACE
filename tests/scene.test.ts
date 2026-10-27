import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { NavigationSchema, SceneManifestSchema } from '../src/types/scene';
import { resolveSceneUri } from '../src/lib/sceneLoader';

describe('scene contracts', () => {
  it('rejects a navigation start outside the grid', () => {
    const result = NavigationSchema.safeParse({
      version: 1,
      coordinateSystem: 'x-z-grid',
      origin: { x: 0, z: 0 },
      cellSize: 1,
      width: 2,
      height: 2,
      blocked: [],
      unknown: [],
      start: { x: 2, z: 0 },
      clearanceMetres: 0.2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects synthetic provenance that is not disclosed', () => {
    const result = SceneManifestSchema.safeParse({
      schemaVersion: 1,
      sceneId: 'bad',
      displayName: 'Bad fixture',
      sceneKind: 'synthetic-demo',
      description: 'test',
      coordinateSystem: 'right-handed-y-up',
      units: 'metre',
      worldFromReconstruction: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      startPosition: [0, 0, 0],
      startYawDegrees: 0,
      visualAssets: [{ kind: 'procedural', uri: 'procedural://fixture' }],
      collisionAsset: null,
      navigationUri: 'navigation/nav.json',
      semanticUri: 'semantic/pois.json',
      qualityUri: 'quality/report.json',
      provenance: { pipeline: 'test', pipelineVersion: '1', capturedAt: '2026-01-01', source: 'unknown', notes: [] },
    });
    expect(result.success).toBe(false);
  });

  it('resolves scene assets relative to the manifest URL', () => {
    expect(resolveSceneUri('/scenes/fixture/manifest.json', 'navigation/nav.json', 'http://localhost:5173/')).toBe('http://localhost:5173/scenes/fixture/navigation/nav.json');
  });

  it('ships a genuine generated GLB fixture with a valid header and length', () => {
    const path = 'public/scenes/glb-fixture/visual/architectural-fixture.glb';
    const data = readFileSync(path);
    expect(data.subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(data.readUInt32LE(4)).toBe(2);
    expect(data.readUInt32LE(8)).toBe(statSync(path).size);
  });

  it('accepts the SYNTHETIC splat fixture, discloses it as synthetic, and its SOG hash matches the file', () => {
    const dir = 'public/scenes/splat-fixture';
    const manifest = SceneManifestSchema.parse(JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')));
    expect(manifest.sceneKind).toBe('synthetic-demo');
    const splat = manifest.visualAssets.find((asset) => asset.kind === 'sog');
    expect(splat).toBeDefined();
    const digest = createHash('sha256').update(readFileSync(`${dir}/${splat!.uri}`)).digest('hex');
    expect(digest).toBe(splat!.sha256);
    // COLMAP reconstructions are Y-down; the manifest must carry the rotation to the viewer's Y-up frame.
    expect(manifest.worldFromReconstruction).toEqual([[1, 0, 0, 0], [0, -1, 0, 0], [0, 0, -1, 0], [0, 0, 0, 1]]);
  });

  it('accepts ply as a visual asset kind', () => {
    expect(() => SceneManifestSchema.shape.visualAssets.parse([{ kind: 'ply', uri: 'visual/scene.ply' }])).not.toThrow();
  });
});
