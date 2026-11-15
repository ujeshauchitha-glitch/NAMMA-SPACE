import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { SearchField } from '../ui/TextField';
import { CATEGORY_ICONS, ChevronRight, Grid } from '../icons/icons';
import type { Poi } from '../../types/scene';
import { CATEGORY_LABELS, type PoiCategory, type RankedResult } from '../../lib/poiSearch';
import { formatDistance } from '../../lib/routeGuidance';
import styles from './PoiSearch.module.css';

/**
 * POI combobox (§5.14) — the right rail's destination search.
 *
 * ARIA 1.0 combobox pattern: the field keeps its implicit `searchbox` role
 * (the pinned T14 contract) while `aria-expanded` / `aria-controls` /
 * `aria-activedescendant` wire it to the always-rendered listbox. The
 * active-descendant is only present while an option is highlighted, so static
 * markup stays honest about state it cannot have.
 *
 * Every row carries category icon + label + the mono subline
 * `CATEGORY · walking distance · confidence · SOURCE` — never colour alone.
 * Results are ranked by src/lib/poiSearch (typo tolerant; "nearest …").
 * Keyboard: "/" (or ⌘K) focuses, ↑/↓ highlight, Enter selects, Esc clears
 * the query, then leaves the field.
 */

export type PoiSearchProps = {
  /** Ranked rows from `rankPois`, with walking distance from the visitor. */
  results: RankedResult[];
  /** Live query text (controlled). */
  query: string;
  /** Currently selected POI id, or null. */
  selectedPoiId: string | null;
  onQueryChange: (nextQuery: string) => void;
  onSelect: (poiId: string) => void;
  /** Workspace-owned ref so ⌘K can focus the field. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Categories present in the scene, with counts, for the filter chips. */
  categories?: { category: PoiCategory; count: number }[];
  category?: PoiCategory | null;
  onCategoryChange?: (category: PoiCategory | null) => void;
  /** Empty state: labels close to what was typed, or (suggestionsKind 'nearby') the nearest destinations. */
  suggestions?: string[];
  suggestionsKind?: 'did-you-mean' | 'nearby';
  /** Enter on the already-selected row (start guidance). */
  onActivate?: (poiId: string) => void;
  /** Authoring view: confidence and source in each row. */
  authoring?: boolean;
};

/**
 * Pure keyboard step for the listbox highlight. Exported for jsdom-free unit
 * tests: `count <= 0` clears the highlight, an out-of-range `current` enters
 * from the far end (down → first, up → last), otherwise the index clamps.
 */
export function nextActiveIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return delta < 0 ? count - 1 : 0;
  const next = current + delta;
  if (next < 0) return 0;
  if (next > count - 1) return count - 1;
  return next;
}

/**
 * Row subline: `CATEGORY · walking distance`, plus `· confidence · SOURCE` in the authoring view.
 * Distance is omitted when unknown.
 */
export function formatPoiSubline(poi: Poi, metres?: number | null, authoring = true): string {
  const walk = metres === undefined ? '' : metres === null ? ' · no route' : ` · ${formatDistance(metres)} walk`;
  const provenance = authoring ? ` · ${poi.confidence.toFixed(2)} · ${poi.source.toUpperCase()}` : '';
  return `${poi.category.toUpperCase()}${walk}${provenance}`;
}

export function PoiSearch({
  results,
  query,
  selectedPoiId,
  onQueryChange,
  onSelect,
  inputRef,
  categories = [],
  category = null,
  onCategoryChange,
  suggestions = [],
  suggestionsKind = 'did-you-mean',
  onActivate,
  authoring = true,
}: PoiSearchProps) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);
  activeIndexRef.current = activeIndex;

  // A new result set invalidates the highlight (§5.14: ↑/↓ re-enter from the ends).
  useEffect(() => {
    setActiveIndex(-1);
  }, [query, results.length, category]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => nextActiveIndex(current, results.length, event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (results.length === 0) return;
      const index = activeIndexRef.current >= 0 && activeIndexRef.current < results.length ? activeIndexRef.current : 0;
      const id = results[index].poi.id;
      if (id === selectedPoiId && onActivate) onActivate(id);
      else onSelect(id);
      return;
    }
    if (event.key === 'Escape') {
      // Esc clears the query first, then leaves the field; the window-level Esc (deselect) waits.
      event.preventDefault();
      event.stopPropagation();
      if (query) onQueryChange('');
      else event.currentTarget.blur();
    }
  };

  const isExpanded = results.length > 0;
  const activeDescendant =
    isExpanded && activeIndex >= 0 && activeIndex < results.length ? `${listboxId}-opt-${activeIndex}` : undefined;

  return (
    <div className={styles.searchWrap}>
      <SearchField
        ref={inputRef}
        label="Search points of interest"
        placeholder="Search, or try “nearest exit”…"
        shortcut="/"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        aria-autocomplete="list"
        aria-haspopup="listbox"
      />
      {categories.length > 1 && onCategoryChange && (
        <div className={styles.chips} role="group" aria-label="Filter by category">
          <button type="button" className={styles.chip} aria-pressed={category === null} onClick={() => onCategoryChange(null)}>All</button>
          {categories.map(({ category: c, count }) => (
            <button key={c} type="button" className={styles.chip} aria-pressed={category === c} onClick={() => onCategoryChange(category === c ? null : c)}>
              {`${CATEGORY_LABELS[c]} ${count}`}
            </button>
          ))}
        </div>
      )}
      <div id={listboxId} role="listbox" aria-label="Points of interest" className={styles.poiList}>
        {results.map(({ poi, metres }, index) => {
          const CategoryIcon = CATEGORY_ICONS[poi.category] ?? Grid;
          return (
            <button
              key={poi.id}
              type="button"
              id={`${listboxId}-opt-${index}`}
              role="option"
              aria-selected={selectedPoiId === poi.id}
              className={`${styles.poiRow} ${selectedPoiId === poi.id ? styles.poiRowSelected : ''} ${
                activeIndex === index ? styles.poiRowActive : ''
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelect(poi.id)}
            >
              <CategoryIcon className={styles.poiIcon} />
              <span className={styles.poiCopy}>
                <strong>{poi.label}</strong>
                <small>{formatPoiSubline(poi, metres, authoring)}</small>
              </span>
              <ChevronRight className={styles.poiArrow} />
            </button>
          );
        })}
      </div>
      {results.length === 0 && (
        <div className={styles.poiEmpty}>
          <p>{query.trim()
            ? `No destinations match “${query}”${category ? ` in ${CATEGORY_LABELS[category]}` : ''}. Try a room name or alias.`
            : `No ${category ? CATEGORY_LABELS[category].toLowerCase() : 'destinations'} in this scene.`}</p>
          {(suggestions.length > 0 || category) && (
            <p className={styles.suggestions}>
              {suggestions.length > 0 && <span>{suggestionsKind === 'nearby' ? 'Nearby: ' : 'Did you mean '}</span>}
              {suggestions.map((label) => (
                <button key={label} type="button" className={styles.suggestion} onClick={() => onQueryChange(label)}>{label}</button>
              ))}
              {category && onCategoryChange && (
                <button type="button" className={styles.suggestion} onClick={() => onCategoryChange(null)}>Search all categories</button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
