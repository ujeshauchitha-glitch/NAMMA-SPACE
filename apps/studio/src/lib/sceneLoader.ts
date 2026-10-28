import { ZodError } from 'zod';
import {
  NavigationSchema,
  PoiSchema,
  QualityReportSchema,
  SceneManifestSchema,
  isBundleRelativeUri,
  type AssetRef,
  type SceneBundle,
} from '../types/scene';

/* ------------------------------------------------------------------ *
 * D3 · unified URI/integrity contract (mirrored by
 * scripts/validate_scene.py):
 *  - every URI a scene declares is bundle-relative, resolves inside the
 *    declaring manifest's directory, and the manifest itself is served
 *    same-origin over http(s) as the app (dev server, preview, Pages/
 *    Vercel and packaged builds all satisfy this);
 *  - single JSON scene documents are capped at MAX_SCENE_JSON_BYTES;
 *  - a declared sha256 digest is verified against the fetched bytes
 *    before the asset is handed to the renderer;
 *  - failures surface as SceneLoadError with a distinct code and an
 *    actionable message (network vs 404 vs oversized vs hash mismatch
 *    vs invalid manifest), which the workspace renders verbatim.
 * ------------------------------------------------------------------ */

export type SceneLoadErrorCode =
  | 'network'
  | 'not-found'
  | 'http'
  | 'too-large'
  | 'invalid-uri'
  | 'cross-origin'
  | 'invalid-json'
  | 'invalid-manifest'
  | 'hash-mismatch'
  | 'integrity-unavailable';

export class SceneLoadError extends Error {
  public readonly code: SceneLoadErrorCode;

  constructor(code: SceneLoadErrorCode, message: string) {
    super(message);
    this.name = 'SceneLoadError';
    this.code = code;
  }
}

/** Single JSON scene document cap — shared with scripts/validate_scene.py. */
export const MAX_SCENE_JSON_BYTES = 32 * 1024 * 1024;
/**
 * Browser-side hash verification must buffer the whole asset in memory, so
 * it carries its own (larger) cap. The Python validator hashes via streams
 * and is not bound by this number.
 */
export const MAX_ASSET_VERIFY_BYTES = 256 * 1024 * 1024;

function tooLarge(label: string, url: string, bytes: number, maxBytes: number): SceneLoadError {
  return new SceneLoadError(
    'too-large',
    `${label} is ${bytes} bytes — over the ${Math.round(maxBytes / (1024 * 1024))} MiB limit: ${url}`,
  );
}

function assertManifestOrigin(baseUrl: string, origin: string): URL {
  let manifestUrl: URL;
  try {
    manifestUrl = new URL(baseUrl, origin);
  } catch {
    throw new SceneLoadError('invalid-uri', `"${baseUrl}" is not a valid scene manifest URL.`);
  }
  if (manifestUrl.protocol !== 'http:' && manifestUrl.protocol !== 'https:') {
    throw new SceneLoadError('cross-origin', `Scene manifest URLs must use http(s), got ${manifestUrl.protocol}: ${manifestUrl.href}`);
  }
  const page = new URL(origin);
  if (manifestUrl.origin !== page.origin) {
    throw new SceneLoadError(
      'cross-origin',
      `Scene manifest ${manifestUrl.origin} is not same-origin with the app at ${page.origin} — scenes must be served from the app origin.`,
    );
  }
  return manifestUrl;
}

/**
 * Resolve a bundle-relative scene URI against the manifest that declares it,
 * enforcing the shared policy: bundle-relative shape, http(s) manifest, the
 * manifest on the app origin, and containment inside the manifest directory.
 */
export function resolveSceneUri(baseUrl: string, uri: string, origin = window.location.href): string {
  if (uri.startsWith('procedural://')) {
    throw new SceneLoadError('invalid-uri', `"${uri}" is a procedural asset URI — procedural assets are engine-built and never fetched.`);
  }
  if (!isBundleRelativeUri(uri)) {
    throw new SceneLoadError('invalid-uri', `"${uri}" is not a bundle-relative scene URI — declare paths relative to the manifest (no scheme, no leading slash, no '..', no query/fragment).`);
  }
  const manifestUrl = assertManifestOrigin(baseUrl, origin);
  const resolved = new URL(uri, manifestUrl);
  const directory = new URL('./', manifestUrl);
  if (!resolved.href.startsWith(directory.href)) {
    throw new SceneLoadError('invalid-uri', `"${uri}" resolves outside the scene bundle directory ${directory.href} — bundle-relative paths only.`);
  }
  return resolved.href;
}

async function fetchDocument(url: string, label: string, maxBytes: number): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new SceneLoadError('network', `Could not reach ${url} — the scene server did not respond (network error).`);
  }
  if (response.status === 404) {
    throw new SceneLoadError('not-found', `${label} not found (404): ${url} — check the scene path.`);
  }
  if (!response.ok) {
    throw new SceneLoadError('http', `${label} request failed (HTTP ${response.status}): ${url}`);
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw tooLarge(label, url, Number(declared), maxBytes);
  }
  try {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw tooLarge(label, url, buffer.byteLength, maxBytes);
    }
    return buffer;
  } catch (error) {
    if (error instanceof SceneLoadError) throw error;
    throw new SceneLoadError('network', `Could not read ${url} — the connection dropped while downloading the ${label.toLowerCase()}.`);
  }
}

async function fetchSceneJson<T>(url: string, label: string, parse: (input: unknown) => T): Promise<T> {
  const buffer = await fetchDocument(url, label, MAX_SCENE_JSON_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new SceneLoadError('invalid-json', `${label} at ${url} is not valid JSON.`);
  }
  try {
    return parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const summary = error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
        .join('; ');
      const remaining = error.issues.length > 3 ? ` (+${error.issues.length - 3} more issues)` : '';
      throw new SceneLoadError('invalid-manifest', `${label} at ${url} failed validation: ${summary}${remaining}`);
    }
    throw error;
  }
}

export async function loadSceneBundle(manifestUrl: string): Promise<SceneBundle> {
  const absoluteManifestUrl = assertManifestOrigin(manifestUrl, window.location.href).href;
  const manifest = await fetchSceneJson(absoluteManifestUrl, 'Scene manifest', (input) => SceneManifestSchema.parse(input));
  const navigation = manifest.navigationUri
    ? await fetchSceneJson(resolveSceneUri(manifestUrl, manifest.navigationUri), 'Navigation grid', (input) => NavigationSchema.parse(input))
    : null;
  const [pois, quality] = await Promise.all([
    fetchSceneJson(resolveSceneUri(manifestUrl, manifest.semanticUri), 'POI index', (input) => PoiSchema.array().parse(input)),
    fetchSceneJson(resolveSceneUri(manifestUrl, manifest.qualityUri), 'Quality report', (input) => QualityReportSchema.parse(input)),
  ]);
  return { manifest, navigation, pois, quality };
}

/**
 * Verify an asset's declared sha256 against the bytes the server actually
 * sends, before the renderer loads anything. Assets without a digest and
 * procedural assets are never fetched here (nothing to verify / engine-built).
 * The renderer re-requests the same URL afterwards; the HTTP cache serves the
 * verified bytes whenever possible (small accepted TOCTOU window on servers
 * without caching — noted in the D3 tradeoffs).
 */
export async function verifyAssetIntegrity(manifestUrl: string, asset: AssetRef): Promise<void> {
  if (asset.kind === 'procedural' || !asset.sha256) return;
  const url = resolveSceneUri(manifestUrl, asset.uri);
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new SceneLoadError(
      'integrity-unavailable',
      `Cannot verify ${asset.label ?? asset.uri}: WebCrypto is unavailable in this context — serve the scene over HTTPS or localhost to honour its declared sha256.`,
    );
  }
  const buffer = await fetchDocument(url, 'Visual asset', MAX_ASSET_VERIFY_BYTES);
  let digest: ArrayBuffer;
  try {
    digest = await crypto.subtle.digest('SHA-256', buffer);
  } catch {
    throw new SceneLoadError(
      'integrity-unavailable',
      `Cannot verify ${asset.label ?? asset.uri}: WebCrypto digesting failed — serve the scene over HTTPS or localhost to honour its declared sha256.`,
    );
  }
  const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== asset.sha256.toLowerCase()) {
    throw new SceneLoadError(
      'hash-mismatch',
      `Integrity check failed for ${asset.label ?? asset.uri}: sha256 ${hex} does not match the declared ${asset.sha256} — the scene bundle is corrupt or was modified.`,
    );
  }
}

/** Status-strip phrasing for asset failures (distinct, actionable prefixes). */
export function assetFailureMessage(asset: AssetRef, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof SceneLoadError && error.code === 'hash-mismatch') {
    return `Visual asset integrity failure: ${detail}`;
  }
  return `Visual asset unavailable: ${detail}`;
}

export function resolveAssetUrl(manifestUrl: string, uri: string): string {
  return resolveSceneUri(manifestUrl, uri);
}
