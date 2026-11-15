/**
 * Deep links: ?scene=<name>&poi=<id>&route=1 opens a scene, selects a place and (with route=1) starts
 * guidance to it from the scene's spawn point. Pure helpers; the workspace applies them.
 */

export type DeepLink = { poiId: string | null; route: boolean };

const SCENE_ALIASES: Record<string, string> = { real: 'real-room', room: 'real-room' };
const SCENE_NAME = /^[a-z0-9][a-z0-9-]*$/i;

/** Manifest URL for a ?scene= value: a scene name (or alias), a '/scenes/...' path, else the default. */
export function resolveSceneParam(value: string | null, baseUrl: string, fallbackUrl: string): string {
  if (!value) return fallbackUrl;
  if (value.startsWith('/scenes/')) return `${baseUrl}${value.slice(1)}`;
  const name = SCENE_ALIASES[value] ?? value;
  if (SCENE_NAME.test(name)) return `${baseUrl}scenes/${name}/manifest.json`;
  return fallbackUrl;
}

/** The shortest ?scene= value that resolves back to this manifest URL. */
export function sceneParamFor(sceneUrl: string, baseUrl: string): string {
  const prefix = `${baseUrl}scenes/`;
  if (!sceneUrl.startsWith(prefix)) return sceneUrl;
  const rest = sceneUrl.slice(prefix.length);
  const match = /^([^/]+)\/manifest\.json$/.exec(rest);
  if (match && SCENE_NAME.test(match[1])) return match[1];
  return `/scenes/${rest}`;
}

export function parseDeepLink(search: string): DeepLink {
  const params = new URLSearchParams(search);
  const poiId = params.get('poi')?.trim() || null;
  const route = ['1', 'true', 'yes'].includes((params.get('route') ?? '').toLowerCase());
  return { poiId, route };
}

/** A shareable link to a place: this page with only ?scene, ?poi and (optionally) ?route. */
export function buildPoiLink(location: { origin: string; pathname: string }, sceneParam: string, poiId: string, options: { route?: boolean } = {}): string {
  const params = new URLSearchParams({ scene: sceneParam, poi: poiId });
  if (options.route) params.set('route', '1');
  return `${location.origin}${location.pathname}?${params.toString()}`;
}
