import { useEffect, useId, useState } from 'react';
import { Button } from '../ui/Button';
import styles from './SelectionToolbar.module.css';

/**
 * Multi-select toolbar (§6.2 center column): appears above the grid when at
 * least one thumbnail is selected. Assigns the whole selection to a view
 * group of the current room, detaches (unassign) without destroying, or
 * deletes behind a confirm (destructive copy names the count — §5.10).
 */
export type ToolbarGroup = { id: string; label: string };

export type SelectionToolbarProps = {
  count: number;
  groups: ToolbarGroup[];
  onAssign: (viewGroupId: string) => void;
  onUnassign: () => void;
  onDelete: () => void;
  onClear: () => void;
};

export function SelectionToolbar({ count, groups, onAssign, onUnassign, onDelete, onClear }: SelectionToolbarProps) {
  const selectId = useId();
  const [target, setTarget] = useState('');

  // Follow the group list (room switch, new room) without discarding a
  // deliberate choice made in the same list.
  useEffect(() => {
    if (!groups.some((group) => group.id === target)) setTarget(groups[0]?.id ?? '');
  }, [groups, target]);

  if (count === 0) return null;
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Image selection">
      <span className={styles.count}>{`${count} selected`}</span>
      <div className={styles.assign}>
        <label className={styles.groupLabel} htmlFor={selectId}>
          Assign to view group
        </label>
        <select
          id={selectId}
          className={styles.groupSelect}
          value={target}
          disabled={groups.length === 0}
          onChange={(event) => setTarget(event.target.value)}
        >
          {groups.length === 0 && <option value="">No view groups yet</option>}
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label}
            </option>
          ))}
        </select>
      </div>
      <span className={styles.spacer} />
      <Button variant="primary" disabled={!target} onClick={() => onAssign(target)}>
        Assign
      </Button>
      <Button variant="secondary" onClick={onUnassign}>
        Remove
      </Button>
      <Button variant="danger" onClick={onDelete}>
        Delete
      </Button>
      <Button variant="quiet" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
