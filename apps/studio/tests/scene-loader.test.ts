/**
 * Workstream D3 · unified URI/integrity contract for the browser loader.
 *
 * sceneLoader.ts and scripts/validate_all_scenes.py must honour the same
 * rules: bundle-relative, same-directory, same-origin URIs; declared sha256
 * digests verified against the fetched bytes; and distinct, actionable error
 * surfaces (network vs 404 vs oversized vs hash mismatch vs invalid manifest).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SCENE_JSON_BYTES,
  SceneLoadError,
  assetFailureMessage,
  loadSceneBundle,
  resolveSceneUri,
  verifyAssetIntegrity,
} from '../src/lib/sceneLoader';
import type { AssetRef } from '../src/types/scene';

const ORIGIN = 'http://localhost:5173/';
const MANIFEST_URL = '/scenes/fixture/manifest.json';
const ABSOLUTE_MANIFEST_URL = 'http://localhost:5173/scenes/fixture/manifest.json';

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sceneId: 'loader-fixture',
    displayName: 'Loader fixture',
    sceneKind: 'reconstructed-capture',
    description: 'Contract fixture for the D3 loader checks.',
    coordinateSystem: 'right-handed-y-up',
    units: 'metre',
    worldFromReconstruction: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
    bounds: { min: [0, 0, 0], max: [4, 3, 4] },
    startPosition: [1, 1.65, 1],
    startYawDegrees: 0,
    visualAssets: [{ kind: 'glb', uri: 'visual/scene.glb', sha256: 'b'.repeat(64) }],
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

const NAVIGATION = {
  version: 1,
  coordinateSystem: 'x-z-grid',
  origin: { x: 0, z: 0 },
  cellSize: 1,
  width: 4,
  height: 4,
  blocked: [5],
  unknown: [10],
  start: { x: 0, z: 0 },
  clearanceMetres: 0.2,
};

const POIS = [{
  id: 'desk',
  label: 'Desk',
  category: 'service',
  position: [1, 1, 1],
  approachPoint: [1, 1, 2],
  aliases: [],
  confidence: 0.9,
  source: 'operator',
}];

const QUALITY = { status: 'passed', warnings: [], checks: [] };

/** Deterministic mock Response limited to what the loader actually reads. */
function mockResponse(bytes: Uint8Array, status = 200, declaredLength?: number): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-length' ? String(declaredLength ?? bytes.length) : null),
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

function jsonResponse(body: unknown, status = 200): Response {
  return mockResponse(new TextEncoder().encode(JSON.stringify(body)), status);
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => handler(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function expectSceneLoadError(promise: Promise<unknown>, code: string): Promise<SceneLoadError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SceneLoadError);
    const sceneError = error as SceneLoadError;
    expect(sceneError.code).toBe(code);
    return sceneError;
  }
  throw new Error(`expected a SceneLoadError with code ${code}, but the call succeeded`);
}

function expectSceneError(fn: () => unknown, code: string): SceneLoadError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SceneLoadError);
    const sceneError = error as SceneLoadError;
    expect(sceneError.code).toBe(code);
    return sceneError;
  }
  throw new Error(`expected a SceneLoadError with code ${code}, but nothing was thrown`);
}

describe('scene loader URI policy (D3)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { href: ORIGIN } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves bundle-relative URIs against the manifest directory', () => {
    expect(resolveSceneUri(MANIFEST_URL, 'navigation/nav.json')).toBe('http://localhost:5173/scenes/fixture/navigation/nav.json');
  });

  it('refuses scheme-bearing URIs with an actionable message', () => {
    const error = expectSceneError(() => resolveSceneUri(MANIFEST_URL, 'https://cdn.example.com/nav.json'), 'invalid-uri');
    expect(error.message).toContain('bundle-relative');
  });

  it('refuses absolute URIs', () => {
    expectSceneError(() => resolveSceneUri(MANIFEST_URL, '/etc/nav.json'), 'invalid-uri');
  });

  it('refuses traversal out of the bundle directory', () => {
    const error = expectSceneError(() => resolveSceneUri(MANIFEST_URL, '../shared/nav.json'), 'invalid-uri');
    expect(error.message).toContain('bundle-relative');
  });

  it('refuses a manifest served from another origin', () => {
    const error = expectSceneError(
      () => resolveSceneUri('https://cdn.example.com/scenes/x/manifest.json', 'navigation/nav.json', ORIGIN),
      'cross-origin',
    );
    expect(error.message).toContain('same-origin');
  });

  it('refuses a non-http manifest scheme', () => {
    expectSceneError(() => resolveSceneUri('file:///tmp/scenes/manifest.json', 'navigation/nav.json', ORIGIN), 'cross-origin');
  });

  it('refuses procedural URIs (engine-built assets are never fetched)', () => {
    expectSceneError(() => resolveSceneUri(MANIFEST_URL, 'procedural://amber-hall'), 'invalid-uri');
  });
});

describe('scene loader error surfaces (D3)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { href: ORIGIN } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a complete bundle when every document is valid', async () => {
    stubFetch((url) => {
      if (url.endsWith('manifest.json')) return jsonResponse(baseManifest());
      if (url.endsWith('nav.json')) return jsonResponse(NAVIGATION);
      if (url.endsWith('pois.json')) return jsonResponse(POIS);
      if (url.endsWith('report.json')) return jsonResponse(QUALITY);
      return jsonResponse({}, 404);
    });
    const bundle = await loadSceneBundle(MANIFEST_URL);
    expect(bundle.manifest.sceneId).toBe('loader-fixture');
    expect(bundle.navigation?.width).toBe(4);
    expect(bundle.pois).toHaveLength(1);
    expect(bundle.quality.status).toBe('passed');
  });

  it('loads a bundle without a navigation grid (navigationUri: null)', async () => {
    stubFetch((url) => {
      if (url.endsWith('manifest.json')) return jsonResponse(baseManifest({ navigationUri: null }));
      if (url.endsWith('pois.json')) return jsonResponse(POIS);
      if (url.endsWith('report.json')) return jsonResponse(QUALITY);
      return jsonResponse({}, 404);
    });
    const bundle = await loadSceneBundle(MANIFEST_URL);
    expect(bundle.navigation).toBeNull();
  });

  it('surfaces a 404 as an actionable not-found error', async () => {
    stubFetch(() => jsonResponse({}, 404));
    const error = await expectSceneLoadError(loadSceneBundle(MANIFEST_URL), 'not-found');
    expect(error.message).toContain('404');
    expect(error.message).toContain(ABSOLUTE_MANIFEST_URL);
  });

  it('surfaces a network failure distinctly from a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const network = await expectSceneLoadError(loadSceneBundle(MANIFEST_URL), 'network');
    expect(network.message).toContain('network');

    stubFetch(() => jsonResponse({}, 404));
    const notFound = await expectSceneLoadError(loadSceneBundle(MANIFEST_URL), 'not-found');
    expect(network.message).not.toBe(notFound.message);
  });

  it('rejects an oversized scene document before parsing it', async () => {
    const overLimit = MAX_SCENE_JSON_BYTES + 1;
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(new Uint8Array(0), 200, overLimit)));
    const error = await expectSceneLoadError(loadSceneBundle(MANIFEST_URL), 'too-large');
    expect(error.message).toContain('MiB');
  });

  it('reports malformed JSON as an invalid-json error', async () => {
    stubFetch(() => mockResponse(new TextEncoder().encode('{not json')));
    const error = await expectSceneLoadError(loadSceneBundle(MANIFEST_URL), 'invalid-json');
    expect(error.message).toContain('JSON');
  });

  it('reports schema violations with the failing fields (invalid-manifest)', async () => {
    stubFetch(() => jsonResponse({ schemaVersion: 1 }));
    const error = await expectSceneLoadError(loadSceneBundle(MANIFEST_URL), 'invalid-manifest');
    expect(error.message).toContain('failed validation');
    expect(error.message).toContain('sceneId');
  });

  it('rejects a manifest whose navigationUri escapes the bundle (schema layer)', async () => {
    stubFetch((url) => {
      if (url.endsWith('manifest.json')) return jsonResponse(baseManifest({ navigationUri: '../shared/nav.json' }));
      return jsonResponse({}, 404);
    });
    const error = await expectSceneLoadError(loadSceneBundle(MANIFEST_URL), 'invalid-manifest');
    expect(error.message).toContain('bundle-relative');
  });

  it('rejects a manifest served cross-origin', async () => {
    stubFetch(() => jsonResponse(baseManifest()));
    const error = await expectSceneLoadError(loadSceneBundle('https://cdn.example.com/scenes/x/manifest.json'), 'cross-origin');
    expect(error.message).toContain('same-origin');
  });
});

describe('visual asset integrity verification (D3)', () => {
  const encoder = new TextEncoder();

  beforeEach(() => {
    vi.stubGlobal('window', { location: { href: ORIGIN } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  it('passes when the fetched bytes match the declared sha256', async () => {
    const bytes = encoder.encode('scene-bytes');
    const asset: AssetRef = { kind: 'glb', uri: 'visual/scene.glb', sha256: await sha256Hex(bytes) };
    const fetchMock = stubFetch(() => mockResponse(bytes));
    await expect(verifyAssetIntegrity(MANIFEST_URL, asset)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects bytes that do not match the declared sha256', async () => {
    const asset: AssetRef = { kind: 'glb', uri: 'visual/scene.glb', sha256: 'c'.repeat(64) };
    stubFetch(() => mockResponse(encoder.encode('tampered-bytes')));
    const error = await expectSceneLoadError(verifyAssetIntegrity(MANIFEST_URL, asset), 'hash-mismatch');
    expect(error.message).toContain('sha256');
    expect(error.message).toContain('corrupt');
  });

  it('never fetches assets that declare no digest (nothing to verify)', async () => {
    const asset: AssetRef = { kind: 'glb', uri: 'visual/scene.glb' };
    const fetchMock = stubFetch(() => mockResponse(encoder.encode('any-bytes')));
    await expect(verifyAssetIntegrity(MANIFEST_URL, asset)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never fetches procedural assets (they are engine-built, not served)', async () => {
    const asset: AssetRef = { kind: 'procedural', uri: 'procedural://amber-hall' };
    const fetchMock = stubFetch(() => mockResponse(encoder.encode('any-bytes')));
    await expect(verifyAssetIntegrity(MANIFEST_URL, asset)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a network failure while verifying as a network error', async () => {
    const asset: AssetRef = { kind: 'glb', uri: 'visual/scene.glb', sha256: 'd'.repeat(64) };
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expectSceneLoadError(verifyAssetIntegrity(MANIFEST_URL, asset), 'network');
  });

  it('refuses to claim integrity when WebCrypto is unavailable', async () => {
    const asset: AssetRef = { kind: 'glb', uri: 'visual/scene.glb', sha256: 'e'.repeat(64) };
    stubFetch(() => mockResponse(encoder.encode('scene-bytes')));
    vi.stubGlobal('crypto', { subtle: undefined });
    const error = await expectSceneLoadError(verifyAssetIntegrity(MANIFEST_URL, asset), 'integrity-unavailable');
    expect(error.message).toContain('HTTPS');
  });

  it('maps asset failures onto distinct, prefixed status messages', () => {
    const asset: AssetRef = { kind: 'glb', uri: 'visual/scene.glb', label: 'Scene GLB', sha256: 'f'.repeat(64) };
    const network = assetFailureMessage(asset, new SceneLoadError('network', 'Could not reach the asset.'));
    const mismatch = assetFailureMessage(asset, new SceneLoadError('hash-mismatch', 'Digest does not match.'));
    expect(network.startsWith('Visual asset unavailable:')).toBe(true);
    expect(mismatch.startsWith('Visual asset integrity failure:')).toBe(true);
    expect(network).not.toBe(mismatch);
  });
});
