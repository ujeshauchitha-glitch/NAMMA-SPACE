import styles from './CoverageIndicator.module.css';

/**
 * Coverage indicator (§5.6) — HONEST: category occupancy, never geometric
 * coverage. One 8 px segment per view group: filled lime = meets minimum,
 * hollow = empty, hatched = images exist but below minimum. Forbidden here,
 * by design and by test: radial % rings, "92 % complete" scores, progress
 * bars implying reconstructed area.
 */

export type CoverageGroupState = 'empty' | 'partial' | 'occupied';

export type CoverageGroup = {
  id: string;
  label: string;
  count: number;
  /** Per-group minimum; default 1 (fixed in V1 UI — editable minimums deferred). */
  minimum?: number;
};

export const COVERAGE_MINIMUM_DEFAULT = 1;

/** Pure state mapping (unit-tested table in tests/coverage.test.ts). */
export function coverageState(count: number, minimum: number = COVERAGE_MINIMUM_DEFAULT): CoverageGroupState {
  if (count <= 0) return 'empty';
  return count >= minimum ? 'occupied' : 'partial';
}

export type CoverageIndicatorProps = {
  groups: CoverageGroup[];
  className?: string;
};

export function CoverageIndicator({ groups, className }: CoverageIndicatorProps) {
  const occupied = groups.filter((group) => coverageState(group.count, group.minimum) === 'occupied').length;
  const summary = groups
    .map((group) => `${group.label}: ${group.count} image${group.count === 1 ? '' : 's'} (${coverageState(group.count, group.minimum)})`)
    .join(', ');
  return (
    <section className={[styles.coverage, className].filter(Boolean).join(' ')} aria-label="View group coverage">
      <header className={styles.header}>
        <span className={styles.title}>View groups</span>
        <span className={styles.count}>{`${occupied}/${groups.length}`}</span>
      </header>
      <div
        className={styles.bar}
        role="img"
        aria-label={summary ? `Category occupancy: ${summary}` : 'No view groups yet'}
      >
        {groups.map((group) => {
          const state = coverageState(group.count, group.minimum);
          return (
            <span
              key={group.id}
              data-state={state}
              className={[styles.segment, state === 'occupied' ? styles.filled : '', state === 'partial' ? styles.hatched : '', state === 'empty' ? styles.hollow : ''].filter(Boolean).join(' ')}
            />
          );
        })}
      </div>
      <p className={styles.legend}>{`Minimum: ${COVERAGE_MINIMUM_DEFAULT} image per group`}</p>
      <p className={styles.caption}>Category occupancy, not geometric coverage.</p>
    </section>
  );
}
