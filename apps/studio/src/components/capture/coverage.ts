/** Coverage-per-view-group state (pure; tested in tests/coverage.test.ts). */
export type CoverageGroupState = 'empty' | 'partial' | 'occupied';

/** Images a view group needs before it counts as covered. */
export const COVERAGE_MINIMUM_DEFAULT = 1;

/** Pure state mapping (unit-tested table in tests/coverage.test.ts). */
export function coverageState(count: number, minimum: number = COVERAGE_MINIMUM_DEFAULT): CoverageGroupState {
  if (count <= 0) return 'empty';
  return count >= minimum ? 'occupied' : 'partial';
}
