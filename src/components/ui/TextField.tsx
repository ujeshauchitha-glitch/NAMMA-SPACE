import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Search } from '../icons/icons';
import styles from './TextField.module.css';

type TextFieldBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** 11px mono uppercase label above the field (§5.2). */
  label: string;
};

export type TextFieldProps = TextFieldBase & {
  invalid?: boolean;
  /** Honest remedy copy shown under the field when invalid (§9.1 voice). */
  error?: string;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, invalid = false, error, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={fieldId}>{label}</label>
      <input
        ref={ref}
        id={fieldId}
        className={[styles.input, invalid ? styles.invalid : ''].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && error ? errorId : undefined}
        {...rest}
      />
      {invalid && error && (
        <p className={styles.error} id={errorId} role="alert">
          <AlertTriangle className={styles.errorGlyph} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
});

export type SearchFieldProps = Omit<TextFieldBase, 'label'> & {
  /** Visible label is visually hidden; keep it for the a11y tree. */
  label?: string;
  /** Trailing shortcut badge text, e.g. "⌘K" (§5.2). Pass null to hide. */
  shortcut?: string | null;
  leading?: ReactNode;
};

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { label = 'Search', shortcut = '⌘K', leading, className, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = rest.id ?? autoId;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className="visually-hidden" htmlFor={fieldId}>{label}</label>
      <div className={styles.searchBed}>
        <span className={styles.searchIcon} aria-hidden="true">{leading ?? <Search />}</span>
        <input ref={ref} id={fieldId} className={styles.searchInput} type="search" {...rest} />
        {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
      </div>
    </div>
  );
});
