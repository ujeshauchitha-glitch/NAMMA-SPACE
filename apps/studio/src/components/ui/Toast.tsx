import { useEffect } from 'react';
import styles from './Toast.module.css';

/**
 * Toasts (§5.9): bottom-center stack, max 3, auto-dismiss 5 s — errors are
 * persistent with an explicit dismiss. The region is aria-live polite;
 * error toasts announce assertively. Never color-only: glyph + text.
 */
export const TOAST_AUTODISMISS_MS = 5_000;

export type ToastTone = 'info' | 'success' | 'error';

export type ToastMessage = {
  id: string;
  tone: ToastTone;
  title: string;
  /** Optional mono detail line. */
  detail?: string;
  /** Optional action button (e.g. Roll back, Open in Capture Studio). */
  action?: { label: string; onClick: () => void };
};

const TONE_GLYPH: Record<ToastTone, string> = { info: '◇', success: '✓', error: '✕' };

export type ToastRegionProps = {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
};

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  // Max 3 stacked (§5.9) — newest first.
  const visible = toasts.slice(0, 3);
  const polite = visible.filter((toast) => toast.tone !== 'error');
  const assertive = visible.filter((toast) => toast.tone === 'error');
  return (
    <div className={styles.region} aria-label="Notifications">
      <div role="status" aria-live="polite" className={styles.stack}>
        {polite.map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />)}
      </div>
      <div role="status" aria-live="assertive" className={styles.stack}>
        {assertive.map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />)}
      </div>
    </div>
  );
}

export type ToastCardProps = {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
};

export function ToastCard({ toast, onDismiss }: ToastCardProps) {
  useEffect(() => {
    if (toast.tone === 'error') return; // errors are persistent with dismiss (§5.9)
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_AUTODISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div className={[styles.card, toast.tone === 'error' ? styles.error : ''].filter(Boolean).join(' ')}>
      <span className={styles.glyph} aria-hidden="true">{TONE_GLYPH[toast.tone]}</span>
      <div className={styles.body}>
        <p className={styles.title}>{toast.title}</p>
        {toast.detail && <p className={styles.detail}>{toast.detail}</p>}
      </div>
      {toast.action && (
        <button type="button" className={styles.action} onClick={toast.action.onClick}>{toast.action.label}</button>
      )}
      <button type="button" className={styles.dismiss} onClick={() => onDismiss(toast.id)} aria-label={`Dismiss: ${toast.title}`}>✕</button>
    </div>
  );
}
