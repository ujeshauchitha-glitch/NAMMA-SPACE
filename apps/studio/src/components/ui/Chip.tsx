import type { ReactNode } from 'react';
import styles from './Chip.module.css';

/**
 * Chip (§5.5 conventions): mono 10 uppercase, hairline border, radius 2,
 * ~24 px tall. Occupied groups show a filled lime square + count; empty
 * groups a hollow square + count in --text-dim. Toggle = instant, drives
 * filters — use as button with aria-pressed for binary chips.
 */
export type ChipProps = {
  children: ReactNode;
  /** Filled (occupied) vs hollow (empty) square marker. */
  filled?: boolean;
  /** Trailing mono count (e.g. FRONT · 6). */
  count?: number;
  /** Toggle chip: renders a button with aria-pressed. */
  toggle?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  'aria-label'?: string;
};

export function Chip({ children, filled = true, count, toggle = false, selected = false, onClick, className, ...rest }: ChipProps) {
  const content = (
    <>
      <span className={[styles.square, filled ? styles.squareFilled : styles.squareHollow].join(' ')} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </>
  );
  const classes = [styles.chip, selected ? styles.selected : '', className].filter(Boolean).join(' ');
  if (toggle) {
    return (
      <button type="button" className={classes} aria-pressed={selected} onClick={onClick} {...rest}>
        {content}
      </button>
    );
  }
  return <span className={classes} {...rest}>{content}</span>;
}
