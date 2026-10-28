import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'signal' | 'quiet' | 'danger' | 'icon';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant;
  /** Loading: swaps label for the dots and sets aria-busy (§5.1). */
  loading?: boolean;
  /** Optional leading icon element (icons render 16px). */
  icon?: ReactNode;
  /** Optional trailing icon element. */
  trailingIcon?: ReactNode;
  children?: ReactNode;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  signal: styles.signal,
  quiet: styles.quiet,
  danger: styles.danger,
  icon: styles.icon,
};

export function Button({
  variant = 'secondary',
  loading = false,
  icon,
  trailingIcon,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // Freeze the button width before the label swaps to the loading dots (§5.1).
  useEffect(() => {
    if (loading && ref.current && !ref.current.style.minWidth) {
      ref.current.style.minWidth = `${ref.current.offsetWidth}px`;
    }
  }, [loading]);

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[styles.button, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading ? (
        <span className={styles.dots} aria-hidden="true">
          <span /><span /><span />
        </span>
      ) : (
        <>
          {icon && <span className={styles.iconSlot} aria-hidden="true">{icon}</span>}
          {children && <span className={styles.label}>{children}</span>}
          {trailingIcon && <span className={styles.iconSlot} aria-hidden="true">{trailingIcon}</span>}
        </>
      )}
    </button>
  );
}
