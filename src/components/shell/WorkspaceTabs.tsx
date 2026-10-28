import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Camera, Compass, Qr } from '../icons/icons';
import { WORKSPACES, type WorkspaceId } from '../workspace/workspace';
import styles from './WorkspaceTabs.module.css';

/**
 * Numbered workspace tabs (§5.3): full tablist pattern — roving tabindex,
 * ←/→ move + activate (wrapping), Home/End, aria-selected, aria-controls.
 * Shortcuts: ⌘/Ctrl+1..3 globally; 1..3 when focus is not in a text field.
 * ≤560px the tablist becomes a fixed bottom bar with icon + index (§6.3).
 */

const TAB_ICONS = { capture: Camera, viewer: Compass, scan: Qr } as const;

export type WorkspaceTabsProps = {
  value: WorkspaceId;
  onChange: (id: WorkspaceId) => void;
};

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function WorkspaceTabs({ value, onChange }: WorkspaceTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const digit = ['1', '2', '3'].indexOf(event.key);
      if (digit === -1 || event.altKey) return;
      if (event.metaKey || event.ctrlKey) {
        // ⌘/Ctrl+1..3 is global — even from inside a text field (§5.3).
        event.preventDefault();
        onChange(WORKSPACES[digit].id);
        return;
      }
      if (event.repeat || isTextEntry(event.target) || isTextEntry(document.activeElement)) return;
      onChange(WORKSPACES[digit].id);
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [onChange]);

  const activeIndex = WORKSPACES.findIndex((workspace) => workspace.id === value);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (activeIndex + 1) % WORKSPACES.length;
    else if (event.key === 'ArrowLeft') nextIndex = (activeIndex + WORKSPACES.length - 1) % WORKSPACES.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = WORKSPACES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = WORKSPACES[nextIndex];
    onChange(next.id);
    requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  return (
    <div role="tablist" aria-label="Workspaces" className={styles.tablist} onKeyDown={onKeyDown}>
      {WORKSPACES.map((workspace, index) => {
        const selected = workspace.id === value;
        const Icon = TAB_ICONS[workspace.id];
        return (
          <button
            key={workspace.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            role="tab"
            id={`tab-${workspace.id}`}
            type="button"
            aria-selected={selected}
            aria-controls={`${workspace.id}-panel`}
            tabIndex={selected ? 0 : -1}
            className={[styles.tab, selected ? styles.selected : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(workspace.id)}
            data-testid={`tab-${workspace.id}`}
          >
            <Icon className={styles.icon} />
            <span className={styles.index}>{workspace.index}</span>
            <span className={styles.label}>{workspace.label}</span>
          </button>
        );
      })}
    </div>
  );
}
