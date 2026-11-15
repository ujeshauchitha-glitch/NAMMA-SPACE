import { renderToStaticMarkup } from 'react-dom/server';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { PoiSearch } from '../src/components/viewer/PoiSearch';
import { formatPoiSubline, nextActiveIndex } from '../src/components/viewer/viewerFormat';
import type { RankedResult } from '../src/lib/poiSearch';
import type { Poi } from '../src/types/scene';

/**
 * T16 POI combobox contract (§5.14) — rendered with react-dom/server
 * (jsdom-free, matching the ui-primitives pattern). Keyboard stepping is
 * covered through the exported pure helper; interactive key handling is
 * exercised by tests/e2e/viewer-route.spec.ts.
 */

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

const registrationDesk: Poi = {
  id: 'registration-desk',
  label: 'Registration Desk',
  category: 'service',
  roomId: 'main-hall',
  position: [-3.1, 1.65, -1.1],
  approachPoint: [-3.1, 1.65, -1.1],
  aliases: ['help desk'],
  description: 'Check in and collect your badge.',
  confidence: 0.96,
  source: 'operator',
};

const mainHall: Poi = {
  id: 'main-hall',
  label: 'Main Hall',
  category: 'room',
  position: [0, 1.65, 0],
  approachPoint: [0, 1.65, 0],
  aliases: [],
  confidence: 0.99,
  source: 'synthetic',
};

const ranked = (...pois: Poi[]): RankedResult[] => pois.map((poi, i) => ({ poi, score: 1, metres: i === 0 ? 12.4 : null }));

function render(props: Partial<Parameters<typeof PoiSearch>[0]> = {}) {
  return markup(
    <PoiSearch
      results={[]}
      query=""
      selectedPoiId={null}
      onQueryChange={() => {}}
      onSelect={() => {}}
      inputRef={createRef<HTMLInputElement | null>()}
      {...props}
    />,
  );
}

describe('nextActiveIndex (§5.14 keyboard)', () => {
  it('enters from the far end when the highlight is unset', () => {
    expect(nextActiveIndex(-1, 3, 1)).toBe(0);
    expect(nextActiveIndex(-1, 3, -1)).toBe(2);
  });

  it('clamps at both ends of the result set', () => {
    expect(nextActiveIndex(2, 3, 1)).toBe(2);
    expect(nextActiveIndex(0, 3, -1)).toBe(0);
  });

  it('clears the highlight when there is nothing to step through', () => {
    expect(nextActiveIndex(0, 0, 1)).toBe(-1);
    expect(nextActiveIndex(-1, 0, -1)).toBe(-1);
  });
});

describe('formatPoiSubline (§5.14 mandatory subline)', () => {
  it('renders CATEGORY · walking distance · confidence · SOURCE', () => {
    expect(formatPoiSubline(registrationDesk, 3.24)).toBe('SERVICE · 3.2 m walk · 0.96 · OPERATOR');
    expect(formatPoiSubline(registrationDesk, null)).toBe('SERVICE · no route · 0.96 · OPERATOR');
    expect(formatPoiSubline(registrationDesk)).toBe('SERVICE · 0.96 · OPERATOR');
    expect(formatPoiSubline(registrationDesk, 3.24, false)).toBe('SERVICE · 3.2 m walk'); // visitor view
    expect(formatPoiSubline(mainHall)).toBe('ROOM · 0.99 · SYNTHETIC');
  });
});

describe('PoiSearch (§5.14 combobox)', () => {
  it('keeps the pinned searchbox role and its accessible name', () => {
    const html = render();
    expect(html).toContain('type="search"');
    expect(html).toContain('Search points of interest');
  });

  it('always renders the listbox and reports collapsed state when empty', () => {
    const html = render({ query: 'zzz' });
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-activedescendant');
  });

  it('shows the honest zero-result copy (not an error) with the query echoed', () => {
    const html = render({ query: 'does-not-exist' });
    expect(html).toContain('No destinations match “does-not-exist”. Try a room name or alias.');
    expect(html).not.toContain('role="option"');
  });

  it('renders one option per result with icon, label and the mono subline', () => {
    const html = render({ results: ranked(registrationDesk, mainHall), query: 'reg' });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="option"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toContain('Registration Desk');
    expect(html).toContain('SERVICE · 12 m walk · 0.96 · OPERATOR');
    expect(html).toContain('Main Hall');
    expect(html).toContain('ROOM · no route · 0.99 · SYNTHETIC');
  });

  it('marks only the selected option with aria-selected', () => {
    const html = render({ results: ranked(registrationDesk, mainHall), selectedPoiId: 'main-hall' });
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-selected="false"');
  });

  it('omits aria-activedescendant until a row is highlighted', () => {
    const html = render({ results: ranked(registrationDesk), query: 'reg' });
    expect(html).not.toContain('aria-activedescendant');
  });

  it('renders category chips with counts, the active one pressed', () => {
    const html = render({
      categories: [{ category: 'service', count: 2 }, { category: 'room', count: 1 }],
      category: 'room',
      onCategoryChange: () => {},
    });
    expect(html).toContain('aria-label="Filter by category"');
    expect(html).toContain('Services 2');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Rooms 1</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>All</);
  });

  it('hides the chips when the scene has a single category', () => {
    expect(render({ categories: [{ category: 'room', count: 3 }], onCategoryChange: () => {} })).not.toContain('Filter by category');
  });

  it('offers suggestions and a way out of the category in the empty state', () => {
    const html = render({ query: 'stagge', suggestions: ['Stage'], category: 'room', onCategoryChange: () => {} });
    expect(html).toContain('No destinations match “stagge” in Rooms');
    expect(html).toContain('Did you mean');
    expect(html).toContain('>Stage</button>');
    expect(html).toContain('Search all categories');
  });

  it('labels nearby fallbacks differently from spelling suggestions', () => {
    expect(render({ query: 'zebra', suggestions: ['Front door'], suggestionsKind: 'nearby' })).toContain('Nearby: ');
  });

  it('advertises the "/" shortcut and the nearest query', () => {
    const html = render();
    expect(html).toContain('<kbd');
    expect(html).toContain('>/</kbd>');
    expect(html).toContain('nearest exit');
  });
});
