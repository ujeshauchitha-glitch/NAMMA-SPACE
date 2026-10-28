import { useCallback, useEffect, useRef, useState } from 'react';
import type { Vec3 } from '../../types/scene';
import { Button } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { Jump, Reset } from '../icons/icons';
import { CompassRose } from './CompassRose';
import { LIVE_ALT_THROTTLE_MS, throttleDecision } from './hudMath';
import styles from './Hud.module.css';

/**
 * T17 · over-canvas HUD (§5.19).
 *
 * Four corner chips float above the 3D stage inside a `pointer-events: none`
 * root so the canvas keeps every drag/wheel; only the two buttons opt back in.
 * Each corner carries the global `hud` class (base.css `.hud :focus-visible`
 * halo) and `data-hud-chrome` so the area AC can sum exactly these boxes.
 *
 * The visually-hidden live region mirrors position + selection for screen
 * readers, throttled to at most one commit every 2 s (AC 4) — the engine
 * reports a new pose every frame, and an unthrottled `aria-live` would flood.
 */
export type HudProps = {
  /** Scene display name shown top-left. */
  sceneLabel: string;
  /** Optional second line (asset kind); hidden with the label ≤560px. */
  sceneMeta?: string;
  /** Mandatory, non-dismissible synthetic marker (§5.19). */
  isSimulated: boolean;
  /** Live camera position; X/Z are rendered with tabular numerals. */
  position: Vec3;
  /** Selected POI name, or null when nothing is selected. */
  selectedPoiName: string | null;
  /** True while pointer lock is held (walkthrough). */
  isWalkthroughActive: boolean;
  /** Hint chip visibility; false after the 4 s auto-hide window. */
  hintVisible: boolean;
  /** Gates both buttons until the engine reports ready. */
  isViewerReady: boolean;
  onEnterWalkthrough: () => void;
  onReset: () => void;
  /** Live yaw source for the compass needle; omitted freezes it at north. */
  getYaw?: () => number | null;
};

/**
 * Commit `text` to a polite live region at most once per `intervalMs`.
 *
 * The first render already carries the initial text (`useState(text)`), so
 * server/SSR markup and the first paint are never empty. After that, a change
 * commits immediately when the interval has elapsed, otherwise a single timer
 * lands the newest value at the end of the window. The pending timer is never
 * rescheduled from the non-commit branch — that would turn the throttle into a
 * debounce and starve updates under a steady per-frame stream.
 *
 * Deliberately local: exporting a hook from a component file would trip
 * `react-refresh/only-export-components`, and the pure decision it wraps
 * (`throttleDecision`) is what the unit tests exercise.
 */
function useThrottledText(text: string, intervalMs: number = LIVE_ALT_THROTTLE_MS): string {
  const [committed, setCommitted] = useState(text);
  const lastRef = useRef(0);
  const latestRef = useRef(text);
  const timerRef = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    timerRef.current = undefined;
    lastRef.current = Date.now();
    setCommitted(latestRef.current);
  }, []);

  // Declared before the throttle effect so `latestRef` is already current
  // when the decision below runs (effects fire in declaration order).
  useEffect(() => {
    latestRef.current = text;
  }, [text]);

  useEffect(() => {
    const decision = throttleDecision(lastRef.current, Date.now(), intervalMs);
    if (decision.commit) {
      // Supersede any pending commit: the fresh text lands now instead.
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      flush();
      // Hold the window open so the next change inside it defers to this one.
      timerRef.current = window.setTimeout(flush, intervalMs);
      return;
    }
    if (timerRef.current === undefined && decision.waitMs !== null) {
      timerRef.current = window.setTimeout(flush, decision.waitMs);
    }
  }, [text, intervalMs, flush]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  return committed;
}

export function Hud({
  sceneLabel,
  sceneMeta,
  isSimulated,
  position,
  selectedPoiName,
  isWalkthroughActive,
  hintVisible,
  isViewerReady,
  onEnterWalkthrough,
  onReset,
  getYaw,
}: HudProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wasActiveRef = useRef(isWalkthroughActive);

  const altText = `Position X ${position[0].toFixed(2)}, Z ${position[2].toFixed(2)}${
    selectedPoiName ? ` · Selected: ${selectedPoiName}` : ''
  }`;
  const committedAlt = useThrottledText(altText);

  // Pointer lock drops focus to the document on exit; hand it back to the
  // walkthrough control so keyboard users are not stranded on <body>.
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isWalkthroughActive;
    if (wasActive && !isWalkthroughActive) {
      rootRef.current?.querySelector<HTMLButtonElement>('[data-hud-walkthrough]')?.focus();
    }
  }, [isWalkthroughActive]);

  const handleEnterWalkthrough = useCallback(() => {
    onEnterWalkthrough();
  }, [onEnterWalkthrough]);

  return (
    <div className={styles.hudRoot} data-testid="hud" ref={rootRef}>
      <div className={`${styles.corner} ${styles.topLeft} hud`} data-hud-chrome>
        <span className={styles.chip}>
          <span className={styles.sceneLabel}>{sceneLabel}</span>
          {/* Mandatory, non-dismissible synthetic label (§5.19). */}
          {isSimulated && <StatusPill state="simulated">SIMULATED</StatusPill>}
          {sceneMeta && <span className={styles.sceneMeta}>{sceneMeta}</span>}
        </span>
      </div>

      <div className={`${styles.corner} ${styles.topRight} hud`} data-hud-chrome>
        <span className={`${styles.chip} ${styles.chipColumn}`}>
          <span className={styles.compassRow}>
            <span aria-hidden="true">N ↑</span>
            <CompassRose getYaw={getYaw} />
          </span>
          <span className={styles.coords} data-testid="hud-coords">
            {`X ${position[0].toFixed(2)} · Z ${position[2].toFixed(2)}`}
          </span>
        </span>
      </div>

      <div className={`${styles.corner} ${styles.bottomLeft} hud`} data-hud-chrome>
        <span
          className={`${styles.chip} ${styles.hintChip}`}
          data-testid="hud-hint"
          data-hint-visible={hintVisible}
          aria-hidden={!hintVisible}
        >
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd>
          <span className={styles.hintMeta}>move · click scene for mouse look · Esc exits walkthrough</span>
        </span>
      </div>

      <div className={`${styles.corner} ${styles.bottomRight} hud`} data-hud-chrome>
        <span className={styles.chip}>
          <Button
            variant="signal"
            data-hud-walkthrough
            disabled={!isViewerReady}
            onClick={handleEnterWalkthrough}
            trailingIcon={<Jump />}
          >
            {isWalkthroughActive ? 'Walkthrough active' : 'Enter walkthrough'}
          </Button>
          <Button
            variant="icon"
            data-hud-reset
            disabled={!isViewerReady}
            aria-label="Reset viewpoint"
            onClick={onReset}
          >
            <Reset />
          </Button>
        </span>
      </div>

      <div className="visually-hidden" role="status" aria-live="polite" data-testid="hud-alt">
        {committedAlt}
      </div>
    </div>
  );
}
