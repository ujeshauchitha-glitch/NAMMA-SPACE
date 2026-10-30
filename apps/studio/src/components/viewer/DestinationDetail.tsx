import { Button } from '../ui/Button';
import { MetadataKV } from '../ui/MetadataKV';
import { Route as RouteIcon } from '../icons/icons';
import type { Poi, Vec3 } from '../../types/scene';
import { RouteStatus, type RouteState } from './RouteStatus';
import styles from './SpatialViewerWorkspace.module.css';

/**
 * T16 · destination detail card (§5.15) — kicker, title row (label + category
 * tag + confidence), description, mono kv block, the route status strip, and
 * the `Plot route` / `Jump to view` actions. Honest states: an unreachable
 * destination shows the inline warning row, a scene without navigation
 * disables both actions with a one-line reason. Esc (handled in the workspace)
 * deselects and clears the 3D selection.
 */
export function formatPosition(position: Vec3): string {
  return `${position[0].toFixed(1)}, ${position[2].toFixed(1)}`;
}

export type DestinationDetailProps = {
  poi: Poi;
  routeState: RouteState;
  /** Scene declares a navigation grid; false disables routing entirely. */
  hasNavigation: boolean;
  /** Viewer not ready yet — engine calls would be no-ops. */
  disabled: boolean;
  onRoute: () => void;
  onJump: () => void;
  onClearRoute: () => void;
};

export function DestinationDetail({
  poi,
  routeState,
  hasNavigation,
  disabled,
  onRoute,
  onJump,
  onClearRoute,
}: DestinationDetailProps) {
  const isUnreachable = routeState.status === 'error' && routeState.reason === 'unreachable';
  const actionsDisabled = disabled || !hasNavigation;

  return (
    <div className={styles.selectionCard}>
      <span className={styles.selectionKicker}>Selected destination</span>
      <div className={styles.selectionTitleRow}>
        <strong className={styles.selectionTitle}>{poi.label}</strong>
        <span className={styles.categoryTag}>{poi.category}</span>
        <span className={styles.confidenceTag}>{poi.confidence.toFixed(2)}</span>
      </div>
      <p className={styles.selectionBody}>{poi.description}</p>
      <MetadataKV
        entries={[
          { key: 'APPROACH POINT', value: formatPosition(poi.approachPoint), mono: true },
          { key: 'ROOM', value: poi.roomId ?? '—' },
          { key: 'SOURCE', value: poi.source.toUpperCase() },
        ]}
      />
      <RouteStatus state={routeState} onClear={onClearRoute} onReplot={onRoute} />
      {isUnreachable && (
        <p className={styles.routeWarning}>▲ No walkable route — destination cell unreachable (blocked)</p>
      )}
      <div className={styles.destinationActions}>
        <Button variant="primary" icon={<RouteIcon />} disabled={actionsDisabled} onClick={onRoute}>
          Plot route
        </Button>
        <Button variant="secondary" disabled={actionsDisabled} onClick={onJump}>
          Jump to view
        </Button>
      </div>
      {!hasNavigation && (
        <p className={styles.missingNavReason}>Navigation data is unavailable for this scene — routing is disabled.</p>
      )}
    </div>
  );
}
