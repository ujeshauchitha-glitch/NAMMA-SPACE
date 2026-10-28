import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  INSECURE_CONTEXT_REMEDY,
  isSecureContextBlocked,
  readIsSecureContext,
} from '../src/lib/pairing/secure-context';
import { LiveScanWorkspace, RELAY_UNAVAILABLE_BODY } from '../src/components/workspace/LiveScanWorkspace';

/**
 * T19 — honest insecure-context state (§9.2).
 *
 * Two layers: the pure verdict (only an explicit `isSecureContext === false`
 * blocks; `true`/`undefined` never do) and its presentation — BLOCKED renders
 * the exact `npm run dev:lan` remedy instead of the empty-state stub, and the
 * default stub is unchanged when the context is fine or unknown (SSR/node).
 *
 * BLOCKED is UI-derived only: the canonical pairing machine states are
 * untouched, so no test here imports or asserts against the machine.
 */

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe('secure-context verdict (pure)', () => {
  it('only an explicit false blocks', () => {
    expect(isSecureContextBlocked(false)).toBe(true);
    expect(isSecureContextBlocked(true)).toBe(false);
    expect(isSecureContextBlocked(undefined)).toBe(false);
  });

  it('exposes the exact remedy copy verbatim', () => {
    expect(INSECURE_CONTEXT_REMEDY).toBe(
      'Run `npm run dev:lan` — phone cameras require HTTPS.',
    );
  });

  it('readIsSecureContext reports absence as undefined, never as a block', () => {
    expect(readIsSecureContext()).toBeUndefined();
    expect(isSecureContextBlocked(readIsSecureContext())).toBe(false);
  });
});

describe('LiveScanWorkspace — insecure context', () => {
  it('renders BLOCKED with the remedy when isSecureContext is false', () => {
    const html = markup(createElement(LiveScanWorkspace, { secureContext: false }));

    expect(html).toContain('data-testid="live-scan-blocked"');
    expect(html).toContain('Pairing blocked — insecure context');
    expect(html).toContain(INSECURE_CONTEXT_REMEDY);
    expect(html).toContain('data-testid="workspace-scan"'); // still the Scan slot
    // honesty: the misleading empty state must not appear while blocked
    expect(html).not.toContain('No phone paired yet');
  });

  it('keeps the empty-state stub when the context is secure', () => {
    const html = markup(createElement(LiveScanWorkspace, { secureContext: true }));

    expect(html).toContain('No phone paired yet');
    expect(html).not.toContain('live-scan-blocked');
    expect(html).not.toContain(INSECURE_CONTEXT_REMEDY);
  });

  it('defaults to the stub when no context is injected (SSR/node has no window)', () => {
    const html = markup(createElement(LiveScanWorkspace));

    expect(html).toContain('No phone paired yet');
    expect(html).not.toContain('live-scan-blocked');
  });

  it('keeps the honest stub body and Scan slot identity', () => {
    const html = markup(createElement(LiveScanWorkspace, { secureContext: true }));

    expect(html).toContain(
      'Live Scan pairs a phone camera over the local network and stages measured frames into Capture Studio.',
    );
    expect(html).toContain('data-testid="workspace-scan"');
  });
});

describe('LiveScanWorkspace — hosted build without the dev relay', () => {
  it('says Live Scan is development-only instead of offering pairing', () => {
    const html = markup(createElement(LiveScanWorkspace, { secureContext: true, relayAvailable: false }));

    expect(html).toContain('data-testid="live-scan-unavailable"');
    expect(html).toContain(RELAY_UNAVAILABLE_BODY);
    expect(html).toContain('data-testid="workspace-scan"');
    expect(html).not.toContain('No phone paired yet');
  });
});
