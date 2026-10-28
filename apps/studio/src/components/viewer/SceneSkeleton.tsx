import { Skeleton, SkeletonRows } from '../ui/Skeleton';
import styles from './SpatialViewerWorkspace.module.css';

/**
 * Scene-load skeleton (§5.12, T14) — a first-class loading state, not a
 * spinner: `--surface-skeleton` geometry matching the stage it replaces
 * (title bars, 4:3 viewport bone, 2-col kv, list rows) with the shared
 * 1.2 s sweep and 200 ms show-delay.
 *
 * `statusLine` carries the REAL loader/engine status — never invented
 * progress. It is only rendered while the bundle is still loading; once the
 * bundle lands the shell pill (§6.1) already speaks for the engine, so the
 * skeleton keeps bones-only until the viewer reports ready (no duplicated
 * live-region text, no flash between skeleton and canvas).
 */
export type SceneSkeletonProps = {
  /** Real pipeline status to display; empty keeps the skeleton silent. */
  statusLine?: string;
};

export function SceneSkeleton({ statusLine = '' }: SceneSkeletonProps) {
  return (
    <div className={styles.skeletonStage} data-testid="scene-skeleton" aria-busy="true">
      <Skeleton height={20} width="44%" />
      <Skeleton height={11} width="68%" />
      <div className={styles.skeletonBody}>
        <Skeleton className={styles.skeletonViewport} height="100%" radius="var(--radius-3)" />
        <div className={styles.skeletonKv}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      </div>
      <SkeletonRows rows={3} />
      {statusLine !== '' && <p className={styles.skeletonStatus}>{statusLine}</p>}
    </div>
  );
}
