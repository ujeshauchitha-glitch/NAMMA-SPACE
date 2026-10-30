import type { ReactNode } from 'react';
import { WorkspaceTabs } from './WorkspaceTabs';
import type { WorkspaceId } from '../workspace/workspace';
import styles from './AppShell.module.css';

/**
 * App shell (§6.1): fixed 56 px top nav — survey mark + wordmark
 * NAMMA SPACE · SPATIAL TWIN LAB, scene/processing state pill as a polite
 * live region (§8.4), numbered workspace tabs, session state
 * `● LOCAL` / `◇ OFFLINE`. Workspaces are full-bleed regions below the nav.
 */
export type AppShellProps = {
  activeWorkspace: WorkspaceId;
  onWorkspaceChange: (id: WorkspaceId) => void;
  /** Scene/processing state line — announced politely on change only. */
  stateLabel: string;
  /** Real connectivity: online → ● LOCAL, offline → ◇ OFFLINE (honest, measured). */
  isOnline: boolean;
  /** Open onboarding welcome guide */
  onOpenGuide?: () => void;
  children?: ReactNode;
};

export function AppShell({ activeWorkspace, onWorkspaceChange, stateLabel, isOnline, onOpenGuide, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <div className={styles.brand}>
          <svg className={styles.mark} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 2v20M2 12h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
            <circle cx="12" cy="12" r="1.75" fill="var(--accent-lime)" stroke="none" />
          </svg>
          <span className={styles.wordmark}>Namma Space</span>
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.descriptor}>Spatial Twin Lab</span>
        </div>
        <div className={styles.statePill} role="status" aria-live="polite" data-testid="scene-state">
          {stateLabel}
        </div>
        <WorkspaceTabs value={activeWorkspace} onChange={onWorkspaceChange} />
        {onOpenGuide && (
          <button
            type="button"
            className={styles.guideBtn}
            onClick={onOpenGuide}
            aria-label="Open Namma Space guide"
            title="Open Namma Space guide"
            data-testid="open-guide-button"
          >
            <span className={styles.guideIcon}>?</span>
            <span>Guide</span>
          </button>
        )}
        <span className={[styles.session, isOnline ? '' : styles.sessionOffline].filter(Boolean).join(' ')}>
          {isOnline ? '● LOCAL' : '◇ OFFLINE'}
        </span>
      </header>
      <main className={styles.region}>{children}</main>
    </div>
  );
}
