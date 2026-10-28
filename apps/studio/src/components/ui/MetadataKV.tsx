import { useEffect, useRef, useState } from 'react';
import styles from './MetadataKV.module.css';

/**
 * Metadata key-value block (§5.7) — the workhorse of the provenance panel.
 * Two-column grid: 11px mono uppercase key, Archivo 13/500 value, 8px rows.
 * Long values (ids, hashes, URIs) render mono with overflow-wrap + a copy
 * affordance ("Copied ✓" 1.4 s, aria-live polite). Nothing here is truncated
 * without a copy affordance. Digit runs get tabular numerals.
 */
export const COPY_CONFIRM_MS = 1_400;

export type MetadataEntry = {
  key: string;
  value: string;
  /** Force mono for the value (auto-applied for long/hash-like values). */
  mono?: boolean;
  /** Copy affordance (default: on for long values). */
  copy?: boolean;
};

export type MetadataKVProps = {
  entries: MetadataEntry[];
  className?: string;
};

const AUTO_MONO_LENGTH = 24;

function shouldCopy(entry: MetadataEntry): boolean {
  return entry.copy ?? entry.value.length > AUTO_MONO_LENGTH;
}

function isMono(entry: MetadataEntry): boolean {
  return entry.mono ?? entry.value.length > AUTO_MONO_LENGTH;
}

export function MetadataKV({ entries, className }: MetadataKVProps) {
  return (
    <dl className={[styles.kv, className].filter(Boolean).join(' ')}>
      {entries.map((entry) => (
        <MetadataRow key={entry.key} entry={entry} />
      ))}
    </dl>
  );
}

function MetadataRow({ entry }: { entry: MetadataEntry }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onCopy = () => {
    void navigator.clipboard?.writeText(entry.value).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
    });
  };

  return (
    <div className={styles.row}>
      <dt className={styles.key}>{entry.key}</dt>
      <dd className={[styles.value, isMono(entry) ? styles.mono : ''].filter(Boolean).join(' ')}>
        <span className={styles.valueText}>{entry.value}</span>
        {shouldCopy(entry) && (
          <>
            <button type="button" className={styles.copy} onClick={onCopy}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <span role="status" aria-live="polite" className="visually-hidden">
              {copied ? `${entry.key} copied to clipboard` : ''}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}
