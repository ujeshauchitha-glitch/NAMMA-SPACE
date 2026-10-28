/**
 * Vertical stage rail (T20 / design §5.17) — the Live Scan narrative column
 * under the QR card. Shape carries state: hollow circle pending, lime disc
 * active, check done, ✕ failed — so the rail reads even in greyscale.
 *
 * The whole `<ol>` is one polite live region (T20 AC): a stage change is
 * announced once, never per-second — the countdown next door stays silent.
 */
import { type ReactElement } from 'react';
import type { PairingStatus } from '../../state/types';
import {
  deriveRailStages,
  formatStageTime,
  type RailStage,
  type RailStageStatus,
} from './stage-rail';
import styles from './StageRail.module.css';

export type StageRailProps = {
  pairing: PairingStatus;
  className?: string;
};

function StageGlyph({ status }: { status: RailStageStatus }): ReactElement {
  if (status === 'done') {
    return (
      <svg
        className={styles.glyph}
        width={16}
        height={16}
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path className={styles.check} d="M4.5 8.5 L7 11 L11.5 5.5" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg
        className={styles.glyph}
        width={16}
        height={16}
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path className={styles.cross} d="M5 5 L11 11 M11 5 L5 11" />
      </svg>
    );
  }
  if (status === 'active') {
    return (
      <svg
        className={styles.glyph}
        width={16}
        height={16}
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <circle className={styles.dotActive} cx="8" cy="8" r="4" />
      </svg>
    );
  }
  return (
    <svg
      className={styles.glyph}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle className={styles.dotPending} cx="8" cy="8" r="4" />
    </svg>
  );
}

function StageRow({ stage }: { stage: RailStage }): ReactElement {
  return (
    <li
      className={styles.row}
      data-stage={stage.key}
      data-status={stage.status}
      aria-current={stage.status === 'active' ? 'step' : undefined}
    >
      <StageGlyph status={stage.status} />
      <span className={styles.label}>{stage.label}</span>
      {stage.detail && <span className={styles.detail}>{stage.detail}</span>}
      {stage.timestamp !== undefined && (
        <span className={styles.time}>{formatStageTime(stage.timestamp)}</span>
      )}
    </li>
  );
}

export function StageRail({ pairing, className }: StageRailProps): ReactElement {
  const stages = deriveRailStages(pairing);
  return (
    <ol
      className={[styles.rail, className].filter(Boolean).join(' ')}
      data-testid="stage-rail"
      aria-live="polite"
    >
      {stages.map((stage) => (
        <StageRow key={stage.key} stage={stage} />
      ))}
    </ol>
  );
}
