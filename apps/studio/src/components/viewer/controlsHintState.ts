/**
 * First-visit controls hint: shown until the visitor dismisses it, then never again (per browser).
 * Storage is injected so the logic is unit tested; storage failures (private mode, blocked site data)
 * fall back to showing the hint, which is harmless because it never blocks the scene.
 */
export const CONTROLS_HINT_KEY = 'namma-space-controls-hint-dismissed.v1';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export function shouldShowControlsHint(storage: KeyValueStore | null): boolean {
  try {
    return storage?.getItem(CONTROLS_HINT_KEY) !== 'true';
  } catch {
    return true;
  }
}

export function dismissControlsHint(storage: KeyValueStore | null): void {
  try {
    storage?.setItem(CONTROLS_HINT_KEY, 'true');
  } catch {
    // Nothing to persist to: the hint simply stays dismissed for this page view.
  }
}

/** The touch variant says "drag" and "tap" instead of naming keys a phone does not have. */
export function controlsHintItems(touch: boolean): string[] {
  return touch
    ? ['Drag to look around', 'Tap a label for details', 'Route here, then Follow route to walk there']
    : ['W A S D to move', 'Drag to look', '/ to search', 'Click a label for details'];
}
