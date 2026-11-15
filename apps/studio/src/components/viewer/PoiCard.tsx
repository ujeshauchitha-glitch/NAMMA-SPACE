import type { Poi } from '../../types/scene';
import { Button } from '../ui/Button';
import styles from './SpatialViewerWorkspace.module.css';
import { formatWalk } from './viewerFormat';

export type PoiCardProps = {
  poi: Poi;
  /** Metres along the grid; null = no route; undefined = scene has no navigation grid. */
  walkMetres: number | null | undefined;
  /** Labels of other POIs within a few metres (from the spatial index). */
  nearby?: string[];
  disabled: boolean;
  onRoute: () => void;
  onGoTo: () => void;
  /** Copy a deep link that opens this place with directions (?scene=&poi=&route=1). */
  onCopyLink?: () => void;
  onClose: () => void;
};

/** Card opened by clicking a POI pin, label or zone in the 3D view. Esc (in the workspace) closes it. */
export function PoiCard({ poi, walkMetres, nearby = [], disabled, onRoute, onGoTo, onCopyLink, onClose }: PoiCardProps) {
  const routable = walkMetres !== undefined && walkMetres !== null;
  return (
    <div className={styles.poiCard} role="dialog" aria-label={`${poi.label} details`} data-testid="poi-card">
      <div className={styles.poiCardHead}>
        <div>
          <p className={styles.poiCardCategory}>{poi.category}</p>
          <h3 className={styles.poiCardTitle}>{poi.label}</h3>
        </div>
        <button type="button" className={styles.poiCardClose} onClick={onClose} aria-label="Close">×</button>
      </div>
      {poi.description && <p className={styles.poiCardText}>{poi.description}</p>}
      <p className={styles.poiCardWalk}>{formatWalk(walkMetres)}</p>
      {nearby.length > 0 && <p className={styles.poiCardWalk}>{`Nearby: ${nearby.join(', ')}`}</p>}
      <div className={styles.poiCardActions}>
        <Button onClick={onRoute} disabled={disabled || !routable}>Route here</Button>
        <Button variant="quiet" onClick={onGoTo} disabled={disabled || walkMetres === undefined}>Go to view</Button>
        {onCopyLink && <Button variant="quiet" onClick={onCopyLink}>Copy link</Button>}
      </div>
    </div>
  );
}
