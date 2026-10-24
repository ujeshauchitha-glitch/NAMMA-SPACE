import { NavigationSchema, PoiSchema, QualityReportSchema, SceneManifestSchema, type SceneBundle } from '../types/scene';

async function fetchJson<T>(url: string, parse: (input: unknown) => T): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return parse(await response.json());
}

export function resolveSceneUri(baseUrl: string, uri: string, origin = window.location.href): string {
  return new URL(uri, new URL(baseUrl, origin)).toString();
}

export async function loadSceneBundle(manifestUrl: string): Promise<SceneBundle> {
  const manifest = await fetchJson(manifestUrl, (input) => SceneManifestSchema.parse(input));
  const semanticUrl = resolveSceneUri(manifestUrl, manifest.semanticUri);
  const qualityUrl = resolveSceneUri(manifestUrl, manifest.qualityUri);
  const navigation = manifest.navigationUri
    ? await fetchJson(resolveSceneUri(manifestUrl, manifest.navigationUri), (input) => NavigationSchema.parse(input))
    : null;
  const [rawPois, quality] = await Promise.all([
    fetchJson(semanticUrl, (input) => PoiSchema.array().parse(input)),
    fetchJson(qualityUrl, (input) => QualityReportSchema.parse(input)),
  ]);
  return { manifest, navigation, pois: rawPois, quality };
}

export function resolveAssetUrl(manifestUrl: string, uri: string): string {
  return resolveSceneUri(manifestUrl, uri);
}
