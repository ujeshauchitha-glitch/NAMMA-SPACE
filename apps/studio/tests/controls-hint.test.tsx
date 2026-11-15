import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ControlsHint } from '../src/components/viewer/ControlsHint';
import { CONTROLS_HINT_KEY, controlsHintItems, dismissControlsHint, shouldShowControlsHint } from '../src/components/viewer/controlsHintState';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
};

describe('controls hint state', () => {
  it('shows until dismissed, then never again', () => {
    const store = memory();
    expect(shouldShowControlsHint(store)).toBe(true);
    dismissControlsHint(store);
    expect(store.map.get(CONTROLS_HINT_KEY)).toBe('true');
    expect(shouldShowControlsHint(store)).toBe(false);
  });

  it('survives storage that throws or is missing', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(shouldShowControlsHint(broken)).toBe(true);
    expect(() => dismissControlsHint(broken)).not.toThrow();
    expect(shouldShowControlsHint(null)).toBe(true);
  });

  it('names keys on desktop and gestures on touch', () => {
    expect(controlsHintItems(false)).toEqual(['W A S D to move', 'Drag to look', '/ to search', 'Click a label for details']);
    expect(controlsHintItems(true).join(' ')).toMatch(/Drag to look around.*Tap a label/);
    expect(controlsHintItems(true).join(' ')).not.toMatch(/W A S D/);
  });
});

describe('ControlsHint', () => {
  it('renders the controls and a dismiss button, without a modal', () => {
    const html = renderToStaticMarkup(<ControlsHint touch={false} />);
    expect(html).toContain('Drag to look');
    expect(html).toContain('aria-label="Dismiss controls hint"');
    expect(html).not.toContain('role="dialog"');
  });
});
