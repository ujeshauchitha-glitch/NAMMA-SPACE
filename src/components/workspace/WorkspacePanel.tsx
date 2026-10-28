import type { ReactNode } from 'react';
import type { WorkspaceId } from './workspace';
import styles from './WorkspacePanel.module.css';

/**
 * The single mounted workspace panel (T8 invariant: exactly one exists at a
 * time — inactive workspaces are unmounted, never kept alive hidden, so no
 * zombie WebGL canvas can survive a tab switch).
 */
export type WorkspacePanelProps = {
  id: WorkspaceId;
  children: ReactNode;
};

export function WorkspacePanel({ id, children }: WorkspacePanelProps) {
  return (
    <section
      role="tabpanel"
      id={`${id}-panel`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      data-testid={`workspace-${id}`}
      className={styles.panel}
    >
      {children}
    </section>
  );
}
