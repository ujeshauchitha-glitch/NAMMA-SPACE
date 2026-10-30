import { Button } from '../ui/Button';
import styles from './SpatialViewerWorkspace.module.css';

/**
 * Scene failure panel (§5.11 / T14): the viewport is replaced by an honest
 * error state — the real loader message, a rollback offer (retry the load),
 * and the scene selector in the header remains live as the other way out.
 * Headline + copy are the exact strings the failure-path e2e asserts.
 */
export type SceneErrorPanelProps = {
  /** Real failure message from the loader (never invented progress). */
  message: string;
  /** Scene URL that failed — shown so the operator can see what was asked for. */
  sceneUrl: string;
  onRetry: () => void;
};

export function SceneErrorPanel({ message, sceneUrl, onRetry }: SceneErrorPanelProps) {
  return (
    <div className={styles.errorPanel} role="alert">
      <h2 className={styles.errorTitle}>Scene bundle unavailable</h2>
      <p className={styles.errorBody}>{message}</p>
      <div>
        <Button variant="primary" onClick={onRetry}>Retry scene load</Button>
      </div>
      <p className={styles.helper}>{`Expected fixture: ${sceneUrl}`}</p>
    </div>
  );
}
