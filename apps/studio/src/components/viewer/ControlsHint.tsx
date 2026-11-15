import { useState } from 'react';
import { Close } from '../icons/icons';
import { controlsHintItems, dismissControlsHint, shouldShowControlsHint } from './controlsHintState';
import styles from './SpatialViewerWorkspace.module.css';

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const isTouch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** A small first-visit controls hint over the top of the scene; dismissed once, gone for good. */
export function ControlsHint({ touch = isTouch() }: { touch?: boolean }) {
  const [visible, setVisible] = useState(() => shouldShowControlsHint(storage()));
  if (!visible) return null;
  return (
    <aside className={styles.controlsHint} aria-label="Controls" data-testid="controls-hint">
      <ul>
        {controlsHintItems(touch).map((item) => <li key={item}>{item}</li>)}
      </ul>
      <button
        type="button"
        className={styles.controlsHintClose}
        aria-label="Dismiss controls hint"
        onClick={() => {
          dismissControlsHint(storage());
          setVisible(false);
        }}
      >
        <Close />
      </button>
    </aside>
  );
}
