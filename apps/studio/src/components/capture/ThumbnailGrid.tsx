import { Check } from '../icons/icons';
import type { ImageSource } from '../../state/types';
import styles from './ThumbnailGrid.module.css';

/**
 * Thumbnail grid (§5.5): `repeat(auto-fill, minmax(96px, 1fr))`, 4:3 cells,
 * cobalt hover outline, 2 px lime selection outline + corner check glyph.
 * Unassigned images carry the 3 px hatched top bar — the system's universal
 * "not yet placed" texture. Every cell is a real `<button>` with
 * `aria-pressed`; source provenance travels on the tile (§5.19).
 */
export type GridImage = {
  id: string;
  /** Staging order, shown in the accessible name ("Staged image 3"). */
  seq: number;
  /** Runtime thumbnail URL (registry-minted); '' while restore is pending. */
  objectUrl: string;
  source: ImageSource;
  assigned: boolean;
};

export type ThumbnailGridProps = {
  images: GridImage[];
  selectedIds: ReadonlySet<string>;
  onToggle: (imageId: string) => void;
};

function sourceLabel(source: ImageSource): string {
  return source === 'phone' ? '● MEASURED · PHONE' : '● MEASURED';
}

export function ThumbnailGrid({ images, selectedIds, onToggle }: ThumbnailGridProps) {
  return (
    <ul className={styles.grid}>
      {images.map((image) => {
        const selected = selectedIds.has(image.id);
        return (
          <li key={image.id} className={styles.cell}>
            <button
              type="button"
              className={[styles.tile, selected ? styles.tileSelected : '', image.assigned ? '' : styles.unassigned]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={selected}
              aria-label={`Staged image ${image.seq}`}
              onClick={() => onToggle(image.id)}
            >
              {image.objectUrl ? (
                <img className={styles.thumb} src={image.objectUrl} alt="" />
              ) : (
                <span className={styles.pending}>preview pending</span>
              )}
              <span className={styles.source}>
                <span aria-hidden="true">{sourceLabel(image.source).slice(0, 1)}</span>
                <span className="visually-hidden">{sourceLabel(image.source)}</span>
              </span>
              {selected && (
                <span className={styles.check} aria-hidden="true">
                  <Check />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
