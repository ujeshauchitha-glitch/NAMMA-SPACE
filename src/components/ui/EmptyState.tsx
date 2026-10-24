import type { ComponentType, ReactNode } from 'react';
import styles from './EmptyState.module.css';

/**
 * Empty state (§5.11): centered column, 40px stroke-only line icon in
 * --line-strong, 15/600 title, 13.5 muted body (max 36 ch), one action.
 * Must state why the state exists and the next real step. No illustrations,
 * no mascots, no encouragement copy (§9.1).
 */
export type EmptyStateIcon = ComponentType<{ className?: string; title?: string }>;

export type EmptyStateProps = {
  icon: EmptyStateIcon;
  title: string;
  /** Why this state exists + the next real step, max ~36ch. */
  body: string;
  /** Single primary action. */
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: IconComponent, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(' ')}>
      <IconComponent className={styles.icon} />
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.body}>{body}</p>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
