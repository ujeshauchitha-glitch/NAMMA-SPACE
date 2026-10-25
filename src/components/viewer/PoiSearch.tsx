import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { SearchField } from '../ui/TextField';
import { CATEGORY_ICONS, ChevronRight, Grid } from '../icons/icons';
import type { Poi } from '../../types/scene';
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
 * Every row carries category icon + label + the mandatory mono subline
 * `CATEGORY · confidence · SOURCE` (§5.14) — never colour alone.
 */

export type PoiSearchProps = {
  /** Filtered rows from `searchPois`. */
  results: Poi[];
  /** Live query text (controlled). */
  query: string;
  /** Currently selected POI id, or null. */
  selectedPoiId: string | null;
  onQueryChange: (nextQuery: string) => void;
  onSelect: (poiId: string) => void;
  /** Workspace-owned ref so ⌘K can focus the field. */
  inputRef: RefObject<HTMLInputElement | null>;
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

/** Mandatory row subline: `CATEGORY · confidence · SOURCE` (§5.14). */
export function formatPoiSubline(poi: Poi): string {
  return `${poi.category.toUpperCase()} · ${poi.confidence.toFixed(2)} · ${poi.source.toUpperCase()}`;
}

export function PoiSearch({
  results,
  query,
  selectedPoiId,
  onQueryChange,
  onSelect,
  inputRef,
}: PoiSearchProps) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);
  activeIndexRef.current = activeIndex;

  // A new result set invalidates the highlight (§5.14: ↑/↓ re-enter from the ends).
  useEffect(() => {
    setActiveIndex(-1);
  }, [query, results.length]);

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
      onSelect(results[index].id);
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
        placeholder="Search rooms, landmarks…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        aria-autocomplete="list"
        aria-haspopup="listbox"
      />
      <div id={listboxId} role="listbox" aria-label="Points of interest" className={styles.poiList}>
        {results.map((poi, index) => {
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
                <small>{formatPoiSubline(poi)}</small>
              </span>
              <ChevronRight className={styles.poiArrow} />
            </button>
          );
        })}
      </div>
      {results.length === 0 && (
        <p className={styles.poiEmpty}>{`No destinations match “${query}”. Try a room name or alias.`}</p>
      )}
    </div>
  );
}
