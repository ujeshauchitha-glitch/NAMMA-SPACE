import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoiCard, formatWalk } from '../src/components/viewer/PoiCard';
import type { Poi } from '../src/types/scene';

const poi: Poi = {
  id: 'desk', label: 'Desk and monitors', category: 'furniture', position: [1, 1, 1], approachPoint: [1, 1.45, 2],
  aliases: [], description: 'Two monitors by the window', confidence: 1, source: 'operator',
};
const card = (walkMetres: number | null | undefined, disabled = false) => renderToStaticMarkup(
  <PoiCard poi={poi} walkMetres={walkMetres} disabled={disabled} onRoute={() => {}} onGoTo={() => {}} onClose={() => {}} />,
);

describe('POI card', () => {
  it('shows name, category, description, walking distance and both actions', () => {
    const html = card(6.34);
    expect(html).toContain('Desk and monitors');
    expect(html).toContain('furniture');
    expect(html).toContain('Two monitors by the window');
    expect(html).toContain('6.3 m walk from where you are');
    expect(html).toContain('Route here');
    expect(html).toContain('Go to view');
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('disabled=""');
  });

  it('disables routing when there is no route, and both actions without a navigation grid', () => {
    expect(card(null).match(/disabled=""/g)).toHaveLength(1);
    expect(card(undefined).match(/disabled=""/g)).toHaveLength(2);
  });

  it('formats walking distance', () => {
    expect(formatWalk(0.2)).toBe('You are here');
    expect(formatWalk(23.6)).toBe('24 m walk from where you are');
    expect(formatWalk(null)).toBe('No walkable route from where you are');
  });
});
