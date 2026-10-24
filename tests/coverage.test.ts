import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoverageIndicator, coverageState, type CoverageGroup } from '../src/components/capture/CoverageIndicator';
import { PRESET_VIEW_GROUPS, ViewGroupChip, viewGroupOccupied } from '../src/components/capture/ViewGroupChip';

/**
 * Coverage honesty gate (DESIGN_HANDOFF §5.6, spec T7): category occupancy
 * only — zero percentages, zero ring/progressbar elements, hatch exactly when
 * 0 < count < minimum, per-group minimums configurable.
 */

const groups: CoverageGroup[] = [
  { id: 'front', label: 'Front', count: 6 },
  { id: 'rear', label: 'Rear', count: 2, minimum: 3 },
  { id: 'left', label: 'Left', count: 0 },
  { id: 'ceiling', label: 'Ceiling', count: 3, minimum: 3 },
];

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe('coverageState — state-mapping table', () => {
  const table: Array<[count: number, minimum: number | undefined, expected: string]> = [
    [0, undefined, 'empty'],
    [1, undefined, 'occupied'], // default minimum is 1
    [6, undefined, 'occupied'],
    [1, 1, 'occupied'],
    [2, 3, 'partial'], // 0 < count < minimum → hatched
    [2, 4, 'partial'],
    [3, 3, 'occupied'],
    [4, 3, 'occupied'],
    [0, 3, 'empty'],
    [-1, 1, 'empty'],
  ];

  it.each(table)('count=%i minimum=%s → %s', (count, minimum, expected) => {
    expect(coverageState(count, minimum)).toBe(expected);
  });
});

describe('CoverageIndicator', () => {
  const html = markup(createElement(CoverageIndicator, { groups }));

  it('never renders a percentage, ring, or progressbar', () => {
    expect(html).not.toMatch(/\d+\s*%/);
    expect(html).not.toMatch(/<progress\b/);
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toMatch(/border-radius:\s*50%/);
  });

  it('states the caption verbatim: category occupancy, not geometric coverage', () => {
    expect(html).toContain('Category occupancy, not geometric coverage.');
  });

  it('renders the occupancy header as counts, not a ratio score', () => {
    // 2 of 4 groups meet their minimum (front, ceiling)
    expect(html).toContain('>2/4<');
  });

  it('renders one segment per group and marks hatch exactly for partial groups', () => {
    const states = [...html.matchAll(/data-state="([a-z]+)"/g)].map((m) => m[1]);
    expect(states).toEqual(['occupied', 'partial', 'empty', 'occupied']);
    const segmentClasses = [...html.matchAll(/<span data-state="[a-z]+" class="([^"]*)"/g)].map((m) => m[1]);
    expect(segmentClasses).toHaveLength(groups.length);
    // CSS module class names survive (hatched/filled/hollow from the module)
    expect(html).toContain('hatched');
    expect(segmentClasses.filter((cls) => cls.includes('hatched'))).toHaveLength(1);
    expect(segmentClasses.filter((cls) => cls.includes('filled'))).toHaveLength(2);
    expect(segmentClasses.filter((cls) => cls.includes('hollow'))).toHaveLength(1);
  });

  it('carries a text alternative for the bar (never color/shape-only)', () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('Rear: 2 images (partial)');
    expect(html).toContain('Left: 0 images (empty)');
  });

  it('shows the honest legend', () => {
    expect(html).toContain('Minimum: 1 image per group');
  });
});

describe('ViewGroupChip', () => {
  it('ships the §5.5 preset groups in order', () => {
    expect([...PRESET_VIEW_GROUPS]).toEqual(['Front', 'Rear', 'Left', 'Right', 'Ceiling', 'Floor', 'Entrance', 'Detail']);
  });

  it('renders an occupied chip with count and accessible name', () => {
    const html = markup(createElement(ViewGroupChip, { group: { id: 'front', label: 'Front', count: 6 }, selected: true, onToggle: () => {} }));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Front, 6 images"');
    expect(html).toContain('>6<');
  });

  it('renders an empty chip honestly', () => {
    const html = markup(createElement(ViewGroupChip, { group: { id: 'left', label: 'Left', count: 0 }, onToggle: () => {} }));
    expect(html).toContain('aria-label="Left, empty"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('>0<');
  });

  it('maps occupancy without percentages', () => {
    expect(viewGroupOccupied({ count: 1 })).toBe(true);
    expect(viewGroupOccupied({ count: 0 })).toBe(false);
    const html = markup(createElement(ViewGroupChip, { group: { id: 'custom', label: 'Stairwell', count: 0 } }));
    expect(html).not.toMatch(/\d+\s*%/);
  });

  it('supports custom groups appended after the presets', () => {
    const custom = { id: 'custom-1', label: 'Balcony', count: 1, preset: false };
    expect(PRESET_VIEW_GROUPS).not.toContain(custom.label);
    expect(markup(createElement(ViewGroupChip, { group: custom }))).toContain('Balcony');
  });
});

describe('coverage stack renders in node without a DOM', () => {
  it('composes indicator + chips from pure props', () => {
    const combined = markup(
      createElement('div', {},
        createElement(CoverageIndicator, { groups }),
        ...groups.map((group) => createElement(ViewGroupChip, { key: group.id, group })),
      ),
    );
    expect(combined).not.toMatch(/\d+\s*%/);
  });
});
