import type { Poi } from '../types/scene';

/**
 * Typo-tolerant ranked POI search (in-house, no dependency).
 *
 * Each query word is matched against the words of a POI's label, aliases, category and description.
 * A word match is, best first: a prefix ("reg" → "Registration"), a substring ("desk" in
 * "helpdesk"), or fuzzy: the query word within a small optimal-string-alignment edit distance
 * (adjacent transpositions count as one edit, so "strat" finds "Start") of a word or of that word's
 * prefix of the same length (so a typo in a half-typed word still matches). Every query word must
 * match something; a substring counts only when the query covers at least half of the word. Scores weight the field (label > alias > category > description).
 *
 * "nearest <thing>" / "closest <thing>" / "<thing> near me" asks for proximity instead of relevance:
 * <thing> is a category name or synonym (all POIs of that category), else a normal search, and the
 * caller orders the matches by walking distance.
 */

export type PoiCategory = Poi['category'];

export const CATEGORY_LABELS: Record<PoiCategory, string> = {
  room: 'Rooms',
  service: 'Services',
  landmark: 'Landmarks',
  furniture: 'Furniture',
  entrance: 'Entrances',
  other: 'Other',
};

/** Words that name a category in a "nearest …" query. */
const CATEGORY_WORDS: Record<string, PoiCategory> = {
  room: 'room', rooms: 'room', hall: 'room', classroom: 'room', space: 'room',
  service: 'service', services: 'service', desk: 'service', help: 'service', info: 'service', information: 'service', counter: 'service', reception: 'service',
  landmark: 'landmark', landmarks: 'landmark',
  furniture: 'furniture', seat: 'furniture', seats: 'furniture', chair: 'furniture', table: 'furniture', bench: 'furniture',
  entrance: 'entrance', entrances: 'entrance', exit: 'entrance', exits: 'entrance', door: 'entrance', doors: 'entrance', entry: 'entrance', way: 'entrance',
  other: 'other',
};

export const MatchTier = { Fuzzy: 1, Substring: 2, Prefix: 3 } as const;
export type MatchTier = (typeof MatchTier)[keyof typeof MatchTier];

const FIELD_WEIGHTS = { label: 1, alias: 0.9, category: 0.6, description: 0.4 } as const;
type Field = keyof typeof FIELD_WEIGHTS;

export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const words = (text: string) => (text ? normalize(text).split(' ').filter(Boolean) : []);

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions), stopping above `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => [i, ...new Array<number>(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Edits allowed for a query word of this length: none below 3 letters, 1 up to 5, then 2. */
export function allowedEdits(length: number): number {
  return length < 3 ? 0 : length <= 5 ? 1 : 2;
}

/** How well one query word matches one field word: a tier plus a 0..1 closeness for fuzzy matches. */
export function matchWord(query: string, word: string): { tier: MatchTier; closeness: number } | null {
  if (word.startsWith(query)) return { tier: MatchTier.Prefix, closeness: 1 };
  // A short query buried in a long word ("strat" in "registration") is noise, not a match.
  if (query.length >= 3 && query.length * 2 >= word.length && word.includes(query)) return { tier: MatchTier.Substring, closeness: 1 };
  const max = allowedEdits(query.length);
  if (max === 0) return null;
  const whole = editDistance(query, word, max);
  const prefix = word.length > query.length ? editDistance(query, word.slice(0, query.length), max) : whole;
  const best = Math.min(whole, prefix);
  if (best > max) return null;
  return { tier: MatchTier.Fuzzy, closeness: 1 - best / (max + 1) };
}

export type SearchHit<T extends Poi = Poi> = { poi: T; score: number; tier: MatchTier; field: Field };

function fieldsOf(poi: Poi): [Field, string[]][] {
  return [
    ['label', words(poi.label)],
    ['alias', poi.aliases.flatMap(words)],
    ['category', [...words(poi.category), ...words(CATEGORY_LABELS[poi.category])]],
    ['description', words(poi.description ?? '')],
  ];
}

/** Score one POI against the query words, or null if some query word matches nothing. */
export function scorePoi<T extends Poi>(poi: T, queryWords: readonly string[]): SearchHit<T> | null {
  if (queryWords.length === 0) return null;
  const fields = fieldsOf(poi);
  let score = 0;
  let worstTier: MatchTier = MatchTier.Prefix;
  let firstField: Field = 'label';
  for (const [qi, q] of queryWords.entries()) {
    let best: { value: number; tier: MatchTier; field: Field } | null = null;
    for (const [field, fieldWords] of fields) {
      for (const [wi, word] of fieldWords.entries()) {
        const m = matchWord(q, word);
        if (!m) continue;
        // Matching the start of the label ("Reg…" for "Registration Desk") ranks above a later word.
        const leading = field === 'label' && wi === 0 ? 0.25 : 0;
        const value = (m.tier + m.closeness - 1 + leading) * FIELD_WEIGHTS[field];
        if (!best || value > best.value) best = { value, tier: m.tier, field };
      }
    }
    if (!best) return null;
    score += best.value;
    worstTier = Math.min(worstTier, best.tier) as MatchTier;
    if (qi === 0) firstField = best.field;
  }
  return { poi, score: score / queryWords.length, tier: worstTier, field: firstField };
}

export type ParsedQuery =
  | { kind: 'empty' }
  | { kind: 'text'; words: string[] }
  | { kind: 'nearest'; category: PoiCategory | null; words: string[]; phrase: string };

const NEAREST = /^(?:(?:the\s+)?(?:nearest|closest|nearby)\s+(.+)|(.+?)\s+(?:near\s+me|nearby|close\s+by))$/;

export function parseQuery(query: string): ParsedQuery {
  const text = normalize(query);
  if (!text) return { kind: 'empty' };
  const near = NEAREST.exec(text);
  if (near) {
    const phrase = (near[1] ?? near[2]).trim();
    const phraseWords = phrase.split(' ').filter(Boolean);
    const category = phraseWords.length === 1 ? categoryFor(phraseWords[0]) : null;
    return { kind: 'nearest', category, words: phraseWords, phrase };
  }
  return { kind: 'text', words: text.split(' ') };
}

/** A category named by a word, allowing a typo ("entrence") and plurals. */
export function categoryFor(word: string): PoiCategory | null {
  if (CATEGORY_WORDS[word]) return CATEGORY_WORDS[word];
  const max = allowedEdits(word.length);
  let best: { category: PoiCategory; distance: number } | null = null;
  for (const [name, category] of Object.entries(CATEGORY_WORDS)) {
    const distance = editDistance(word, name, max);
    if (distance <= max && (!best || distance < best.distance)) best = { category, distance };
  }
  return best?.category ?? null;
}

export type RankedResult<T extends Poi = Poi> = { poi: T; score: number; metres: number | null };

export type SearchOptions = {
  /** Only this category (the filter chips). */
  category?: PoiCategory | null;
  /** Walking distance from the visitor, or null when unreachable / unknown. */
  distanceOf?: (poi: Poi) => number | null;
};

/** Relevance bands: results within one band are ordered by walking distance. */
const band = (score: number) => Math.floor(score * 2) / 2;

const byDistance = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);

/**
 * Ranked search. Text queries sort by relevance band, then walking distance, then label; "nearest"
 * queries and the empty query sort by walking distance.
 */
export function rankPois<T extends Poi>(pois: readonly T[], query: string, options: SearchOptions = {}): RankedResult<T>[] {
  const parsed = parseQuery(query);
  const pool = options.category ? pois.filter((poi) => poi.category === options.category) : pois;
  const distance = options.distanceOf ?? (() => null);
  const withDistance = (poi: T, score: number): RankedResult<T> => ({ poi, score, metres: distance(poi) });
  if (parsed.kind === 'empty') {
    return pool.map((poi) => withDistance(poi, 0)).sort((a, b) => byDistance(a.metres, b.metres) || a.poi.label.localeCompare(b.poi.label));
  }
  if (parsed.kind === 'nearest') {
    const matches = parsed.category
      ? pool.filter((poi) => poi.category === parsed.category).map((poi) => withDistance(poi, 1))
      : pool.flatMap((poi) => { const hit = scorePoi(poi, parsed.words); return hit ? [withDistance(poi, hit.score)] : []; });
    return matches.sort((a, b) => byDistance(a.metres, b.metres) || b.score - a.score);
  }
  return pool
    .flatMap((poi) => { const hit = scorePoi(poi, parsed.words); return hit ? [withDistance(poi, hit.score)] : []; })
    .sort((a, b) => band(b.score) - band(a.score) || byDistance(a.metres, b.metres) || b.score - a.score || a.poi.label.localeCompare(b.poi.label));
}

/** For the empty state: labels closest to what was typed (by edit distance), even beyond the fuzzy limit. */
export function suggestLabels(pois: readonly Poi[], query: string, count = 3): string[] {
  const q = normalize(query).replace(/\s+/g, '');
  if (!q) return [];
  return pois
    .map((poi) => {
      const names = [poi.label, ...poi.aliases].map((n) => normalize(n).replace(/\s+/g, ''));
      const distance = Math.min(...names.map((n) => editDistance(q, n.slice(0, Math.max(q.length, 1)))));
      return { label: poi.label, distance };
    })
    .filter((s) => s.distance <= Math.max(1, Math.ceil(q.length / 3)))
    .sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label))
    .slice(0, count)
    .map((s) => s.label);
}
