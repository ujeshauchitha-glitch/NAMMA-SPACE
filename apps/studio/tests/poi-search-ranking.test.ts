import { describe, expect, it } from 'vitest';
import { categoryFor, editDistance, matchesNearest, matchWord, MatchTier, nearestByWalking, parseQuery, rankPois, suggestLabels } from '../src/lib/poiSearch';
import { PoiSpatialIndex } from '../src/lib/poiIndex';
import { planRoute, walkingDistance } from '../src/lib/navigation';
import type { NavigationGrid } from '../src/types/scene';
import type { Poi } from '../src/types/scene';

const poi = (id: string, label: string, category: Poi['category'], extra: Partial<Poi> = {}): Poi => ({
  id, label, category, position: [0, 1.6, 0], approachPoint: [0, 1.6, 0], aliases: [], confidence: 0.9, source: 'operator', ...extra,
});

const pois: Poi[] = [
  poi('start', 'Start', 'landmark', { description: 'Where the walkthrough begins.' }),
  poi('reg', 'Registration Desk', 'service', { aliases: ['help desk', 'check-in'], description: 'Collect your badge.' }),
  poi('info', 'Information Point', 'service', { aliases: ['info'] }),
  poi('main', 'Main Hall', 'room', { description: 'Talks and the registration queue.' }),
  poi('north', 'North Entrance', 'entrance', { aliases: ['front door'] }),
  poi('south', 'South Exit', 'entrance'),
  poi('stage', 'Stage', 'landmark', { description: 'Keynote stage.' }),
];
const metres: Record<string, number | null> = { start: 2, reg: 9, info: 4, main: 6, north: 12, south: 3, stage: 7 };
const distanceOf = (p: Poi) => metres[p.id];
const ids = (query: string, opts = {}) => rankPois(pois, query, { distanceOf, ...opts }).map((r) => r.poi.id);

describe('edit distance', () => {
  it('counts an adjacent transposition as one edit', () => {
    expect(editDistance('strat', 'start')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abcdef', 'zzzzzz', 2)).toBe(3); // stops early above the limit
  });
});

describe('word matching tiers', () => {
  it('prefix > substring > fuzzy', () => {
    expect(matchWord('reg', 'registration')?.tier).toBe(MatchTier.Prefix);
    expect(matchWord('desk', 'helpdesk')?.tier).toBe(MatchTier.Substring);
    expect(matchWord('strat', 'start')?.tier).toBe(MatchTier.Fuzzy);
    expect(matchWord('regsit', 'registration')?.tier).toBe(MatchTier.Fuzzy); // typo in a half-typed word
    expect(matchWord('xy', 'start')).toBeNull();
    expect(matchWord('qqqqq', 'start')).toBeNull();
  });
});

describe('rankPois', () => {
  it('"strat" finds "Start"', () => {
    expect(ids('strat')).toEqual(['start']); // not Registration ("regi-strat-ion"): buried substrings are noise
  });

  it('ranks a label prefix above a description substring', () => {
    // "registration" is the label of reg and only in the description of main.
    expect(ids('registration')).toEqual(['reg', 'main']);
  });

  it('searches aliases, category and description, and needs every word to match', () => {
    expect(ids('front door')).toEqual(['north']);
    expect(ids('check in')).toEqual(['reg']);
    expect(ids('badge')).toEqual(['reg']);
    expect(ids('entrances')).toEqual(['south', 'north']); // the category; equal relevance, nearer first
    expect(ids('desk zebra')).toEqual([]);
  });

  it('orders equally relevant results by walking distance, unreachable last', () => {
    const near = rankPois(pois, 'st', { distanceOf: (p) => (p.id === 'start' ? null : metres[p.id]) }).map((r) => r.poi.id);
    expect(near.indexOf('stage')).toBeLessThan(near.indexOf('start'));
  });

  it('filters by category chip', () => {
    expect(ids('', { category: 'service' })).toEqual(['info', 'reg']);
    expect(ids('desk', { category: 'room' })).toEqual([]);
  });

  it('lists everything nearest-first for an empty query, with distances', () => {
    const all = rankPois(pois, '', { distanceOf });
    expect(all.map((r) => r.poi.id)).toEqual(['start', 'south', 'info', 'main', 'stage', 'reg', 'north']);
    expect(all[0].metres).toBe(2);
  });

  it('answers "nearest <category>" by walking distance', () => {
    expect(ids('nearest entrance')).toEqual(['south', 'north']);
    expect(ids('closest exit')[0]).toBe('south'); // synonym
    expect(ids('nearest entrence')[0]).toBe('south'); // typo
    expect(ids('desk near me')).toEqual(['info', 'reg']); // synonym for services
    expect(ids('nearest stage')).toEqual(['stage']); // not a category: a search, nearest first
  });
});

describe('query parsing', () => {
  it('recognises proximity phrasings', () => {
    expect(parseQuery('Nearest  Exit')).toMatchObject({ kind: 'nearest', category: 'entrance' });
    expect(parseQuery('the closest room')).toMatchObject({ kind: 'nearest', category: 'room' });
    expect(parseQuery('main hall')).toEqual({ kind: 'text', words: ['main', 'hall'] });
    expect(parseQuery('   ')).toEqual({ kind: 'empty' });
    expect(categoryFor('banana')).toBeNull();
  });
});

describe('empty-state suggestions', () => {
  it('offers the closest labels for a query that matches nothing', () => {
    expect(ids('stagge hal')).toEqual([]);
    expect(suggestLabels(pois, 'stagge')).toContain('Stage');
    expect(suggestLabels(pois, 'zzzzzzzzzz')).toEqual([]);
    expect(suggestLabels(pois, 'zebra')).toEqual([]); // nothing genuinely close: no random labels
  });
});

describe('nearestByWalking (spatial index)', () => {
  // 40 x 40 m grid (0.5 m cells) with a long wall at x = 20 open only near z = 38, and POIs scattered.
  const cell = 0.5;
  const w = 80;
  const blocked: number[] = [];
  for (let cz = 0; cz < w; cz += 1) if (cz < 74) blocked.push(40 + cz * w);
  const grid: NavigationGrid = { version: 1, coordinateSystem: 'x-z-grid', origin: { x: 0, z: 0 }, cellSize: cell, width: w, height: w, blocked, unknown: [], start: { x: 2, z: 2 }, clearanceMetres: 0.3 };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const scattered: Poi[] = Array.from({ length: 120 }, (_, i) => {
    const x = 0.75 + rand() * 38.5;
    const z = 0.75 + rand() * 38.5;
    const safeX = Math.abs(x - 20.25) < 1 ? x + 2 : x;
    return poi(`p${i}`, `Point ${i}`, i % 3 === 0 ? 'entrance' : 'service', { position: [safeX, 1.6, z], approachPoint: [safeX, 1.6, z] });
  });
  const index = new PoiSpatialIndex(scattered);
  const me: [number, number, number] = [18, 1.6, 5]; // just left of the wall: things to the right are a long walk

  it('returns exactly the brute-force walking order while planning far fewer routes', () => {
    const parsed = parseQuery('nearest exit');
    if (parsed.kind !== 'nearest') throw new Error('expected a nearest query');
    const distanceOf = (p: Poi) => walkingDistance(grid, me, p);
    const brute = scattered.filter((p) => matchesNearest(parsed, p)).map((p) => ({ id: p.id, m: distanceOf(p) }))
      .filter((r) => r.m !== null).sort((a, b) => a.m! - b.m!).slice(0, 5);
    const { results, evaluated } = nearestByWalking(index, me[0], me[2], (p) => matchesNearest(parsed, p), distanceOf, 5);
    expect(results.map((r) => r.poi.id)).toEqual(brute.map((r) => r.id));
    results.forEach((r, i) => expect(r.metres).toBeCloseTo(brute[i].m!));
    expect(evaluated).toBeLessThan(scattered.filter((p) => matchesNearest(parsed, p)).length / 2);
    // Walking order differs from straight-line order here (the wall), so this is not just the index order.
    const straight = index.nearest(me[0], me[2], scattered.length).filter((p) => p.category === 'entrance').slice(0, 5).map((p) => p.id);
    expect(planRoute(grid, me, [25, 1.6, 5]).ok).toBe(true);
    expect(straight).not.toEqual(results.map((r) => r.poi.id));
  });
});
