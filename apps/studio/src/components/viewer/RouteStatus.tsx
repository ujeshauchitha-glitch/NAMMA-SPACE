import { Button } from '../ui/Button';
import { Close, Route as RouteIcon } from '../icons/icons';
import styles from './SpatialViewerWorkspace.module.css';

/**
 * T16 · route status strip (§5.16) — one polite live region that reports the
 * last plot: `ROUTE · 24.0 m · 11 cells · A*` on success, or the A* failure
 * detail verbatim. Glyphs (✓ / ▲) carry the state so nothing is conveyed by
 * colour alone (§5.17); clear (×) and re-plot actions sit inline.
 *
 * The live region itself is always mounted (empty while idle) so assistive
 * tech observes the transition into a plot/failure rather than a region that
 * mounts already populated; the visual strip inside it still renders only
 * when there is a value to show (review F2).
 */
export type RouteState =
  | { status: 'idle' }
  | { status: 'ok'; metres: number; cells: number }
  | { status: 'error'; detail: string; reason: string };

export type RouteStatusProps = {
  state: RouteState;
  onClear: () => void;
  onReplot: () => void;
};

export function RouteStatus({ state, onClear, onReplot }: RouteStatusProps) {
  const isError = state.status === 'error';

  return (
    <div aria-live="polite">
      {state.status !== 'idle' && (
        <div className={styles.routeStrip}>
          <span className={styles.routeStripText}>
            {isError ? `▲ ${state.detail}` : `✓ ROUTE · ${state.metres.toFixed(1)} m · ${state.cells} cells · A*`}
          </span>
          <span className={styles.routeStripActions}>
            <Button variant="icon" aria-label="Clear route" onClick={onClear}>
              <Close />
            </Button>
            <Button variant="icon" aria-label="Replot walking route" onClick={onReplot}>
              <RouteIcon />
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
