import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteStatus, type RouteState } from '../src/components/viewer/RouteStatus';

/**
 * T16 route strip live-region contract (review F2) — the polite live region
 * must be mounted before any content arrives so assistive tech observes the
 * transition into a plot/failure, while the visual strip still renders only
 * when there is a value to show (§5.16). Rendered with react-dom/server,
 * matching the poi-search/ui-primitives pattern.
 */

function markup(state: RouteState): string {
  return renderToStaticMarkup(
    <RouteStatus state={state} onClear={() => {}} onReplot={() => {}} />,
  );
}

describe('RouteStatus live region (review F2)', () => {
  it('keeps an empty polite live region mounted while idle', () => {
    const html = markup({ status: 'idle' });
    expect(html).toContain('aria-live="polite"');
    // No visual strip while idle (§5.16) — the region exists but is empty.
    expect(html).not.toContain('ROUTE ·');
    expect(html.replace(/<[^>]*>/g, '').trim()).toBe('');
  });

  it('places the success readout inside the live region', () => {
    const html = markup({ status: 'ok', metres: 24.06, cells: 11 });
    expect(html).toContain('aria-live="polite"');
    // Display rounding happens here, once (review F5).
    expect(html).toContain('✓ ROUTE · 24.1 m · 11 cells · A*');
  });

  it('places the A* failure detail verbatim inside the live region', () => {
    const html = markup({
      status: 'error',
      detail: 'No collision-safe route connects start to goal (blocked)',
      reason: 'unreachable',
    });
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('▲ No collision-safe route connects start to goal (blocked)');
    expect(html).not.toContain('ROUTE ·');
  });
});
