import { describe, expect, it } from 'vitest';
import { buildPoiLink, parseDeepLink, resolveSceneParam, sceneParamFor } from '../src/lib/deepLink';

const FALLBACK = '/scenes/classroom/manifest.json';

describe('deep links', () => {
  it('parses ?poi and ?route', () => {
    expect(parseDeepLink('?scene=apartment&poi=bathroom&route=1')).toEqual({ poiId: 'bathroom', route: true });
    expect(parseDeepLink('?poi=bathroom')).toEqual({ poiId: 'bathroom', route: false });
    expect(parseDeepLink('?poi=%20&route=0')).toEqual({ poiId: null, route: false });
    expect(parseDeepLink('')).toEqual({ poiId: null, route: false });
    expect(parseDeepLink('?poi=a&route=true').route).toBe(true);
  });

  it('resolves ?scene names, aliases and paths under the deploy base', () => {
    expect(resolveSceneParam('apartment', '/', FALLBACK)).toBe('/scenes/apartment/manifest.json');
    expect(resolveSceneParam('room', '/', FALLBACK)).toBe('/scenes/real-room/manifest.json');
    expect(resolveSceneParam('classroom', '/NAMMA-SPACE/', FALLBACK)).toBe('/NAMMA-SPACE/scenes/classroom/manifest.json');
    expect(resolveSceneParam('/scenes/x/manifest.json', '/NAMMA-SPACE/', FALLBACK)).toBe('/NAMMA-SPACE/scenes/x/manifest.json');
    expect(resolveSceneParam(null, '/', FALLBACK)).toBe(FALLBACK);
    expect(resolveSceneParam('../../etc', '/', FALLBACK)).toBe(FALLBACK);
    expect(resolveSceneParam('https://evil.example/m.json', '/', FALLBACK)).toBe(FALLBACK);
  });

  it('writes the shortest ?scene value that resolves back to the same scene', () => {
    for (const base of ['/', '/NAMMA-SPACE/']) {
      for (const url of [`${base}scenes/apartment/manifest.json`, `${base}scenes/sub/dir/manifest.json`]) {
        const param = sceneParamFor(url, base);
        expect(resolveSceneParam(param, base, FALLBACK)).toBe(url);
      }
    }
    expect(sceneParamFor('/scenes/apartment/manifest.json', '/')).toBe('apartment');
  });

  it('builds a link with only scene, poi and route', () => {
    const link = buildPoiLink({ origin: 'https://site.example', pathname: '/' }, 'apartment', 'front door', { route: true });
    expect(link).toBe('https://site.example/?scene=apartment&poi=front+door&route=1');
    expect(parseDeepLink(new URL(link).search)).toEqual({ poiId: 'front door', route: true });
    expect(buildPoiLink({ origin: 'https://site.example', pathname: '/app/' }, 'classroom', 'start')).toBe('https://site.example/app/?scene=classroom&poi=start');
  });
});
