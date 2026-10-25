import { useId, useState, type DragEvent } from 'react';
import { Upload } from '../icons/icons';
import styles from './UploadZone.module.css';

/**
 * Upload affordance (§8.6 / §5.11): a real `<label>` wrapping a
 * keyboard-focusable visually-hidden `<input type="file">` — Enter/Space on
 * the focused input opens the picker, so the whole flow is keyboard-only.
 * Drag-and-drop is progressive enhancement over the same input; dropping
 * never bypasses the ingest pipeline (T11 sniffs bytes, not names).
 */
export type UploadZoneProps = {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Announced politely while a batch is settling (§8.4). */
  busy?: boolean;
};

export function UploadZone({ onFiles, disabled = false, busy = false }: UploadZoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    onFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <label
      className={[styles.zone, dragging ? styles.zoneDragging : ''].filter(Boolean).join(' ')}
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        multiple
        accept="image/*"
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          // Reset so re-dropping the same file still fires a change event.
          event.target.value = '';
        }}
      />
      <Upload className={styles.icon} />
      <strong className={styles.title}>{busy ? 'Staging images…' : 'Choose capture images'}</strong>
      <small className={styles.hint}>JPEG · PNG · WebP — drag and drop also works</small>
    </label>
  );
}
