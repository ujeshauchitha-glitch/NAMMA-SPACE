import type { GuidanceUpdate } from '../../engine/PlayCanvasViewer';
import { formatDistance } from '../../lib/routeGuidance';
import { Button } from '../ui/Button';
import styles from './SpatialViewerWorkspace.module.css';

export type GuidancePanelProps = {
  guidance: GuidanceUpdate;
  onFollow: () => void;
  onStopFollowing: () => void;
  onEnd: () => void;
};

/** Turn-by-turn panel over the 3D view while a route is being followed. */
export function GuidancePanel({ guidance, onFollow, onStopFollowing, onEnd }: GuidancePanelProps) {
  const done = guidance.status === 'arrived';
  const progress = guidance.total > 0 ? Math.min(1, Math.max(0, 1 - guidance.remaining / guidance.total)) : 1;
  return (
    <section className={styles.guidance} aria-label={`Route to ${guidance.label}`} data-testid="guidance">
      <div aria-live="polite">
        <p className={styles.guidanceStep}>{done ? `You have arrived at ${guidance.label}` : guidance.instruction}</p>
        {!done && (
          <p className={styles.guidanceMeta}>
            {`${formatDistance(guidance.remaining)} to ${guidance.label} · ${guidance.walkTime} walk`}
            {guidance.rerouted ? ' · re-routed' : ''}
          </p>
        )}
      </div>
      <div className={styles.guidanceBar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className={styles.guidanceActions}>
        {!done && (guidance.status === 'following'
          ? <Button variant="secondary" onClick={onStopFollowing}>Stop following</Button>
          : <Button variant="primary" onClick={onFollow}>Follow route</Button>)}
        <Button variant="quiet" onClick={onEnd}>{done ? 'Done' : 'End route'}</Button>
      </div>
    </section>
  );
}
