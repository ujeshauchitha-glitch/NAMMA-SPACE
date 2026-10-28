import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as Icons from '../src/components/icons/icons';
import type { IconProps } from '../src/components/icons/icons';

/**
 * GROUNDTRUTH icon inventory gate (DESIGN_HANDOFF §4.4).
 * 16 px grid · 1.5 px stroke · square caps · miter joins · fill none ·
 * currentColor · aria-hidden by default · role="img"+title for icon-only use.
 * Rendered with react-dom/server — no extra dependencies.
 */

// The full §4.4 inventory list (handoff writes "~26"; the list names these).
const INVENTORY = [
  'Search', 'Route', 'Jump', 'Reset', 'Compass', 'Grid', 'Layers',
  'Camera', 'Upload', 'Qr', 'Check', 'AlertTriangle', 'XSquare', 'Lock',
  'Minus', 'ChevronRight', 'ChevronDown', 'Plus', 'Close', 'Play', 'Pause',
  'Signal', 'Room', 'Service', 'Landmark', 'Furniture', 'Entrance',
] as const;

type IconName = (typeof INVENTORY)[number];

function render(name: IconName, props: IconProps = {}): string {
  const Component = Icons[name];
  return renderToStaticMarkup(createElement(Component, props));
}

describe('GROUNDTRUTH icon set', () => {
  it('exports every icon named in the §4.4 inventory', () => {
    const missing = INVENTORY.filter((name) => typeof Icons[name] !== 'function');
    expect(missing).toEqual([]);
    expect(INVENTORY.length).toBe(27);
  });

  it.each(INVENTORY)('%s renders aria-hidden by default with the drafting-voice contract', (name) => {
    const markup = render(name);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role=');
    expect(markup).toContain('viewBox="0 0 16 16"');
    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('stroke-linecap="square"');
    expect(markup).toContain('stroke-linejoin="miter"');
    expect(markup).toContain('fill="none"');
    expect(markup).toMatch(/<(path|circle|rect)\b/);
  });

  it.each(INVENTORY)('%s supports icon-only usage via role="img" + title', (name) => {
    const markup = render(name, { title: 'Measured point' });
    expect(markup).toContain('role="img"');
    expect(markup).toContain('<title>Measured point</title>');
    expect(markup).not.toContain('aria-hidden');
  });

  it('propagates className for HUD/chip styling', () => {
    expect(render('Search', { className: 'hud-icon' })).toContain('class="hud-icon"');
  });

  it('contains no emoji or retired glyph characters', () => {
    const source = readFileSync('src/components/icons/icons.tsx', 'utf8');
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}⌂↻⌕✦＋]/u);
  });

  it('maps every POI category to an icon (other → Grid)', () => {
    expect(Object.keys(Icons.CATEGORY_ICONS).sort()).toEqual(
      ['entrance', 'furniture', 'landmark', 'other', 'room', 'service'],
    );
    for (const [category, Component] of Object.entries(Icons.CATEGORY_ICONS)) {
      const markup = renderToStaticMarkup(createElement(Component, {}));
      expect(markup, `category ${category}`).toContain('aria-hidden="true"');
    }
  });
});
