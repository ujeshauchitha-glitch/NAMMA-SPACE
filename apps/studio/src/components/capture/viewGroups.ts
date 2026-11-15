import type { ViewGroup } from './ViewGroupChip';

/** Group → chip-state mapping used by tests and the chip bar. */
export function viewGroupOccupied(group: Pick<ViewGroup, 'count'>): boolean {
  return group.count > 0;
}
