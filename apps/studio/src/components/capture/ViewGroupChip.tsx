import { Chip } from '../ui/Chip';
import styles from './ViewGroupChip.module.css';

/**
 * View-group chip (§5.5): preset + custom groups, mono 10 uppercase,
 * filled lime square + count when occupied, hollow square + 0 in
 * --text-dim when empty. Toggle is instant (90ms) and drives the grid
 * filter. Pure, data-driven props.
 */

/** §5.5 preset group order; custom groups append after Detail. */
export const PRESET_VIEW_GROUPS = ['Front', 'Rear', 'Left', 'Right', 'Ceiling', 'Floor', 'Entrance', 'Detail'] as const;

export type ViewGroup = {
  id: string;
  label: string;
  count: number;
  minimum?: number;
  preset?: boolean;
};

export type ViewGroupChipProps = {
  group: ViewGroup;
  selected?: boolean;
  onToggle?: (groupId: string) => void;
  className?: string;
};

export function ViewGroupChip({ group, selected = false, onToggle, className }: ViewGroupChipProps) {
  const occupied = group.count > 0;
  return (
    <Chip
      toggle
      selected={selected}
      filled={occupied}
      count={group.count}
      onClick={onToggle ? () => onToggle(group.id) : undefined}
      className={[styles.groupChip, className].filter(Boolean).join(' ')}
      aria-label={occupied ? `${group.label}, ${group.count} images` : `${group.label}, empty`}
    >
      {group.label}
    </Chip>
  );
}

/** Group → chip-state mapping used by tests and the chip bar. */
export function viewGroupOccupied(group: Pick<ViewGroup, 'count'>): boolean {
  return group.count > 0;
}
