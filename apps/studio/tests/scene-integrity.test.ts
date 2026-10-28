/**
 * Workstream D2 · dead-field honesty contract.
 *
 * The renderer applies no reconstruction→world transform and loads no
 * collision mesh, so the schema must reject manifests that promise either.
 * Every value shipped in public/scenes/* is identity/null, so tightening the
 * contract keeps the bundled scenes valid while making non-applicable values
 * fail loudly (same phrases the Python validator enforces — see
 * scripts/validate_scene.py).
 */
import { describe, expect, it } from 'vitest';
import { NavigationSchema, SceneManifestSchema } from '../src/types/scene';

type ManifestInput = Record<string, unknown>;

function baseManifest(overrides: ManifestInput = {}): ManifestInput {
  return {
    schemaVersion: 1,
    sceneId: 'scene-integrity',
    displayName: 'Scene integrity fixture',
    sceneKind: 'reconstructed-capture',
    description: 'Contract fixture for the D2 scene-integrity checks.',
    coordinateSystem: 'right-handed-y-up',
    units: 'metre',
    worldFromReconstruction: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
    bounds: { min: [0, 0, 0], max: [4, 3, 4] },
    startPosition: [1, 1.65, 1],
    startYawDegrees: 0,
    visualAssets: [{ kind: 'glb', uri: 'visual/scene.glb', sha256: 'a'.repeat(64) }],
    collisionAsset: null,
    navigationUri: 'navigation/nav.json',
    semanticUri: 'semantic/pois.json',
    qualityUri: 'quality/report.json',
    provenance: {
      pipeline: 'capture',
      pipelineVersion: '1.0.0',
      capturedAt: '2026-10-29T00:00:00Z',
      source: 'operator capture',
      notes: [],
    },
    ...overrides,
  };
}

function failureMessage(input: ManifestInput): string {
  const result = SceneManifestSchema.safeParse(input);
  expect(result.success, 'expected the manifest to be rejected').toBe(false);
  if (result.success) return '';
  return result.error.issues.map((issue) => issue.message).join(' | ');
}

describe('scene manifest dead fields (D2)', () => {
  it('still accepts the shipped contract shape (identity transform, null collision, bundle-relative URIs)', () => {
    expect(SceneManifestSchema.safeParse(baseManifest()).success).toBe(true);
  });

  it('rejects a non-identity worldFromReconstruction with an actionable identity message', () => {
    const message = failureMessage(baseManifest({
      worldFromReconstruction: [[1, 0, 0, 2], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
    }));
    expect(message).toContain('worldFromReconstruction must be the identity matrix');
  });

  it('rejects a rotation inside worldFromReconstruction (not just translation)', () => {
    const message = failureMessage(baseManifest({
      worldFromReconstruction: [[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
    }));
    expect(message).toContain('identity matrix');
  });

  it('rejects a non-null collisionAsset the viewer would never load', () => {
    const message = failureMessage(baseManifest({
      collisionAsset: { kind: 'glb', uri: 'geometry/collision.glb' },
    }));
    expect(message).toContain('collisionAsset is not supported');
  });

  it('still accepts a null collisionAsset', () => {
    expect(SceneManifestSchema.safeParse(baseManifest({ collisionAsset: null })).success).toBe(true);
  });
});

describe('scene URI policy at the schema layer (D3)', () => {
  it('rejects a cross-origin visual asset URI', () => {
    const message = failureMessage(baseManifest({
      visualAssets: [{ kind: 'glb', uri: 'https://cdn.example.com/scene.glb' }],
    }));
    expect(message).toContain('bundle-relative');
  });

  it('rejects an absolute visual asset URI', () => {
    const message = failureMessage(baseManifest({
      visualAssets: [{ kind: 'glb', uri: '/etc/scene.glb' }],
    }));
    expect(message).toContain('bundle-relative');
  });

  it('rejects a traversal visual asset URI', () => {
    const message = failureMessage(baseManifest({
      visualAssets: [{ kind: 'glb', uri: '../shared/scene.glb' }],
    }));
    expect(message).toContain('bundle-relative');
  });

  it('rejects an absolute semanticUri', () => {
    const message = failureMessage(baseManifest({ semanticUri: '/var/www/pois.json' }));
    expect(message).toContain('bundle-relative');
  });

  it('rejects a traversal qualityUri', () => {
    const message = failureMessage(baseManifest({ qualityUri: '../shared/report.json' }));
    expect(message).toContain('bundle-relative');
  });

  it('rejects a cross-origin navigationUri', () => {
    const message = failureMessage(baseManifest({ navigationUri: 'https://cdn.example.com/nav.json' }));
    expect(message).toContain('bundle-relative');
  });

  it('rejects a malformed sha256 digest on a visual asset', () => {
    const message = failureMessage(baseManifest({
      visualAssets: [{ kind: 'glb', uri: 'visual/scene.glb', sha256: 'NOT-A-DIGEST' }],
    }));
    expect(message).toContain('malformed sha256');
  });

  it('requires procedural assets to declare a procedural:// URI', () => {
    const message = failureMessage(baseManifest({
      visualAssets: [{ kind: 'procedural', uri: 'visual/scene.glb' }],
    }));
    expect(message).toContain('procedural://');
  });

  it('accepts a procedural:// URI on a procedural asset', () => {
    expect(SceneManifestSchema.safeParse(baseManifest({
      visualAssets: [{ kind: 'procedural', uri: 'procedural://amber-hall' }],
    })).success).toBe(true);
  });
});

describe('honesty refinements that must survive D2/D3', () => {
  it('still rejects synthetic scenes that do not disclose their provenance', () => {
    const result = SceneManifestSchema.safeParse(baseManifest({
      sceneKind: 'synthetic-demo',
      provenance: {
        pipeline: 'fixture',
        pipelineVersion: '1',
        capturedAt: '2026-10-29T00:00:00Z',
        source: 'demo data',
        notes: [],
      },
    }));
    expect(result.success).toBe(false);
  });

  it('accepts synthetic scenes that do disclose their provenance', () => {
    expect(SceneManifestSchema.safeParse(baseManifest({
      sceneKind: 'synthetic-demo',
      provenance: {
        pipeline: 'fixture',
        pipelineVersion: '1',
        capturedAt: '2026-10-29T00:00:00Z',
        source: 'Namma Space synthetic demonstration',
        notes: [],
      },
    })).success).toBe(true);
  });

  it('still rejects a navigation start cell listed as unknown', () => {
    const grid = NavigationSchema.safeParse({
      version: 1,
      coordinateSystem: 'x-z-grid',
      origin: { x: 0, z: 0 },
      cellSize: 1,
      width: 3,
      height: 3,
      blocked: [],
      unknown: [4],
      start: { x: 1, z: 1 },
      clearanceMetres: 0.2,
    });
    expect(grid.success).toBe(false);
  });
});
