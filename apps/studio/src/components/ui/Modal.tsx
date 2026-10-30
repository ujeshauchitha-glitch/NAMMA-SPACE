import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './Modal.module.css';

/**
 * Modal / confirm (§5.10): backdrop, shadow-3 dialog, focus trap, Esc closes,
 * focus restored to the opener, aria-modal. Destructive variants must name the
 * object and the consequence (copy provided by the caller, e.g.
 * "Delete Lab 201 and its 14 staged images? This cannot be undone.").
 */
export type ModalProps = {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Footer actions, right-aligned (secondary + primary per §5.10). */
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, children, footer, onClose, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      // Focus trap (§5.10): cycle Tab within the dialog only.
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to the element that opened the modal (§5.10).
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} data-testid="modal-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[styles.dialog, className].filter(Boolean).join(' ')}
      >
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
