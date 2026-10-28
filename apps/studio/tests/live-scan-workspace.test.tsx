import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  INVALID_PAIR_LINK_BODY,
  LiveScanWorkspace,
  PhoneFramesPanel,
  RELAY_UNAVAILABLE_BODY,
} from '../src/components/workspace/LiveScanWorkspace';
import { readPairToken } from '../src/App';

/**
 * T21 slice-4 SSR suite — the two sides of the Live Scan journey as the
 * entry URL decides them: no `?pair=` → desktop (QR card + rail), valid
 * `?pair=` → phone (camera + capture button), invalid `?pair=` → honest
 * refusal. Node has no window, so effects never run: this asserts the
 * rendered contract, while `tests/pairing-journey.test.ts` proves the
 * session wiring behind it (both sides reach STAGED only on a verified
 * frame-ack).
 */

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe('LiveScanWorkspace — desktop (QR) side', () => {
  it('renders the QR card, stage rail and honest empty state — no camera', () => {
    const html = markup(
      createElement(LiveScanWorkspace, { secureContext: true, hostToken: 'NS-AAAA' }),
    );

    expect(html).toContain('data-testid="workspace-scan"');
    expect(html).toContain('data-testid="pair-card"');
    expect(html).toContain('NS-AAAA'); // token lift: card shows the workspace's room
    expect(html).toContain('data-testid="stage-rail"');
    expect(html).toContain('No phone paired yet');
    expect(html).toContain(
      'Live Scan pairs a phone camera over the local network and stages measured frames into Capture Studio.',
    );
    expect(html).not.toContain('data-testid="camera-preview"');
    // No verified frames yet → no handoff, no fabricated receive summary.
    expect(html).not.toContain('data-testid="open-capture-studio"');
    expect(html).not.toContain('data-testid="phone-frames"');
  });

  it('refuses an invalid host token honestly instead of QR-ing a room nobody hosts', () => {
    const html = markup(
      createElement(LiveScanWorkspace, { secureContext: true, hostToken: 'bogus' }),
    );

    expect(html).toContain('data-testid="live-scan-host-token-invalid"');
    expect(html).not.toContain('data-testid="pair-card"');
    expect(html).not.toContain('No phone paired yet');
    expect(html).not.toContain('data-testid="camera-preview"');
  });
});

describe('LiveScanWorkspace — phone (?pair=) side', () => {
  it('renders the camera and a capture button that stays disabled until paired', () => {
    const html = markup(
      createElement(LiveScanWorkspace, { secureContext: true, pairToken: 'NS-BBBB' }),
    );

    expect(html).toContain('data-testid="workspace-scan"');
    expect(html).toContain('data-testid="camera-preview"');
    expect(html).toContain('data-testid="capture-frame"');
    // No store in SSR → pairing is IDLE → the only button is disabled.
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('data-testid="joiner-waiting"');
    expect(html).toContain('data-testid="stage-rail"');
    // The phone never shows a QR code, and never the desktop empty state.
    expect(html).not.toContain('data-testid="pair-card"');
    expect(html).not.toContain('No phone paired yet');
  });

  it('refuses an invalid ?pair= link with honest copy instead of a dead session', () => {
    const html = markup(
      createElement(LiveScanWorkspace, { secureContext: true, pairToken: 'not-a-token' }),
    );

    expect(html).toContain('data-testid="live-scan-invalid-link"');
    // The full constant contains an apostrophe — assert escape-safe fragments.
    expect(html).toContain('This pairing link is not valid');
    expect(html).toContain('QR code again to get a fresh link.');
    expect(INVALID_PAIR_LINK_BODY).toContain('scan the desktop');
    expect(html).not.toContain('data-testid="camera-preview"');
    expect(html).not.toContain('data-testid="pair-card"');
    expect(html).not.toContain('data-testid="stage-rail"');
  });
});

describe('LiveScanWorkspace — gate precedence', () => {
  it('BLOCKED wins over a pair link (no camera can exist in an insecure context)', () => {
    const html = markup(
      createElement(LiveScanWorkspace, { secureContext: false, pairToken: 'NS-BBBB' }),
    );

    expect(html).toContain('data-testid="live-scan-blocked"');
    expect(html).not.toContain('data-testid="camera-preview"');
    expect(html).not.toContain('live-scan-invalid-link');
  });

  it('the missing-relay gate wins over a pair link', () => {
    const html = markup(
      createElement(LiveScanWorkspace, {
        secureContext: true,
        relayAvailable: false,
        pairToken: 'NS-BBBB',
      }),
    );

    expect(html).toContain('data-testid="live-scan-unavailable"');
    expect(html).toContain(RELAY_UNAVAILABLE_BODY);
    expect(html).not.toContain('data-testid="camera-preview"');
  });
});

describe('PhoneFramesPanel — received frames + Capture Studio handoff', () => {
  it('labels the frames MEASURED · PHONE with the no-pose note and the handoff link', () => {
    const html = markup(createElement(PhoneFramesPanel, { count: 2 }));

    expect(html).toContain('2 frames from the phone');
    expect(html).toContain('● MEASURED · PHONE');
    expect(html).toContain('without pose data');
    expect(html).toContain('data-testid="open-capture-studio"');
    expect(html).toContain('href="/?workspace=capture"');
    expect(html).toContain('Open in Capture Studio');
  });

  it('keeps singular copy for a single frame', () => {
    const html = markup(createElement(PhoneFramesPanel, { count: 1 }));

    expect(html).toContain('1 frame from the phone');
    expect(html).not.toContain('1 frames');
  });
});

describe('?pair= entry parsing (App)', () => {
  it('reads the raw token for downstream validation — no silent coercion', () => {
    expect(readPairToken('?pair=NS-AAAA')).toBe('NS-AAAA');
    expect(readPairToken('?workspace=capture')).toBeNull();
    expect(readPairToken('')).toBeNull();
    // Present-but-invalid values pass through so LiveScanWorkspace can
    // render the honest "link not valid" state instead of dropping them.
    expect(readPairToken('?pair=not-a-token')).toBe('not-a-token');
  });
});
