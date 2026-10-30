import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Hud } from '../src/components/viewer/Hud';
import {
  LIVE_ALT_THROTTLE_MS,
  roseRotation,
  throttleDecision,
} from '../src/components/viewer/hudMath';

/**
 * T17 · over-canvas HUD (§5.19) — SSR markup contracts plus the pure math
 * that drives the throttle and the compass. Effects (focus restore, rAF
 * needle, live-region commits) do not run under renderToStaticMarkup and are
 * covered by tests/e2e/viewer-hud.spec.ts.
 */

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

const HUD_PROPS = {
  sceneLabel: 'The Amber Hall',
  sceneMeta: 'GLB · textured mesh fixture',
  isSimulated: true,
  position: [-4.5, 1.6, 3.4] as const,
  selectedPoiName: null,
  isWalkthroughActive: false,
  hintVisible: true,
  isViewerReady: true,
  onEnterWalkthrough: () => {},
  onReset: () => {},
};

describe('Hud markup (§5.19)', () => {
  it('renders the four data-hud-chrome corners for the area AC', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    expect(html).toContain('data-testid="hud"');
    expect(html).toMatch(/data-hud-chrome/g);
    expect((html.match(/data-hud-chrome/g) ?? []).length).toBe(4);
  });

  it('carries the global hud class on every corner (halo focus)', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    expect((html.match(/ class="[^"]*\bhud\b[^"]*"/g) ?? []).length).toBe(4);
  });

  it('renders scene label, meta and the mandatory SIMULATED pill', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    expect(html).toContain('The Amber Hall');
    expect(html).toContain('GLB · textured mesh fixture');
    expect(html).toContain('SIMULATED');
    expect(html).toContain('◇');
  });

  it('omits the SIMULATED pill when the scene is not synthetic', () => {
    const html = markup(<Hud {...HUD_PROPS} isSimulated={false} />);
    expect(html).not.toContain('SIMULATED');
  });

  it('formats coordinates with two decimals and the middle-dot separator', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    expect(html).toContain('data-testid="hud-coords"');
    expect(html).toContain('X -4.50 · Z 3.40');
  });

  it('reflects the hint visibility as data + aria-hidden', () => {
    const visible = markup(<Hud {...HUD_PROPS} hintVisible />);
    expect(visible).toContain('data-testid="hud-hint"');
    expect(visible).toContain('data-hint-visible="true"');
    expect(visible).not.toContain('aria-hidden="true" data-hint-visible');

    const hidden = markup(<Hud {...HUD_PROPS} hintVisible={false} />);
    expect(hidden).toContain('data-hint-visible="false"');
    expect(hidden).toMatch(/data-testid="hud-hint"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-testid="hud-hint"/);
  });

  it('lists the WASD keys and walkthrough prose', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    for (const key of ['W', 'A', 'S', 'D']) {
      expect(html).toContain(`<kbd>${key}</kbd>`);
    }
    expect(html).toContain('Esc exits walkthrough');
  });

  it('toggles the walkthrough button label with the lock state', () => {
    expect(markup(<Hud {...HUD_PROPS} />)).toContain('Enter walkthrough');
    expect(markup(<Hud {...HUD_PROPS} isWalkthroughActive />)).toContain('Walkthrough active');
  });

  it('ships both focusable buttons with their data hooks', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    expect(html).toContain('data-hud-walkthrough');
    expect(html).toContain('data-hud-reset');
    expect(html).toContain('aria-label="Reset viewpoint"');
  });

  it('disables both buttons until the engine reports ready', () => {
    const html = markup(<Hud {...HUD_PROPS} isViewerReady={false} />);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it('ships a visually-hidden polite live region with the position text', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    expect(html).toContain('data-testid="hud-alt"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain('visually-hidden');
    expect(html).toContain('Position X -4.50, Z 3.40');
  });

  it('includes the selected POI name in the live region when present', () => {
    const html = markup(<Hud {...HUD_PROPS} selectedPoiName="Registration Desk" />);
    expect(html).toContain('Position X -4.50, Z 3.40 · Selected: Registration Desk');
  });

  it('keeps the compass decorative (aria-hidden SVG + N glyph)', () => {
    const html = markup(<Hud {...HUD_PROPS} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('N ↑');
    expect(html).toContain('<svg');
  });
});

describe('throttleDecision (live region ≤ 1 commit / 2 s)', () => {
  it('commits when the interval has fully elapsed', () => {
    const decision = throttleDecision(0, LIVE_ALT_THROTTLE_MS);
    expect(decision).toEqual({ commit: true, nextLastCommitAt: LIVE_ALT_THROTTLE_MS, waitMs: null });
  });

  it('defers when the interval has not elapsed, reporting the remaining wait', () => {
    const decision = throttleDecision(0, 500);
    expect(decision).toEqual({
      commit: false,
      nextLastCommitAt: 0,
      waitMs: LIVE_ALT_THROTTLE_MS - 500,
    });
  });

  it('commits on the exact boundary (elapsed === interval)', () => {
    const decision = throttleDecision(1000, 1000 + LIVE_ALT_THROTTLE_MS);
    expect(decision.commit).toBe(true);
    expect(decision.waitMs).toBeNull();
  });

  it('honours a caller-supplied interval', () => {
    expect(throttleDecision(0, 500, 400).commit).toBe(true);
    expect(throttleDecision(0, 399, 400).commit).toBe(false);
  });
});

describe('roseRotation (compass needle tracks the engine yaw)', () => {
  const DEG = Math.PI / 180;

  const dot3 = (a: readonly number[], b: readonly number[]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /** PlayCanvas camera basis for euler-Y yaw ψ (the hudMath.ts contract). */
  const forwardFor = (psi: number): [number, number, number] => [
    -Math.sin(psi * DEG),
    0,
    -Math.cos(psi * DEG),
  ];
  const rightFor = (psi: number): [number, number, number] => [
    Math.cos(psi * DEG),
    0,
    -Math.sin(psi * DEG),
  ];
  /** World north is −Z: the camera's forward at yaw 0. */
  const NORTH: [number, number, number] = [0, 0, -1];

  /**
   * North projected onto the camera-relative screen: x = dot(north, right),
   * y = −dot(north, forward) (screen y grows downward).
   */
  const northScreen = (psi: number): [number, number] => [
    dot3(NORTH, rightFor(psi)),
    -dot3(NORTH, forwardFor(psi)),
  ];

  /** Needle base (0, −1) after a CSS `rotate(θ)` — clockwise in screen space. */
  const needleAfter = (theta: number): [number, number] => [
    Math.sin(theta * DEG),
    -Math.cos(theta * DEG),
  ];

  it('projects north through the engine basis as (sin ψ, −cos ψ)', () => {
    for (const psi of [0, 45, -90, 180, -180, 123.456]) {
      const [x, y] = northScreen(psi);
      expect(x).toBeCloseTo(Math.sin(psi * DEG), 10);
      expect(y).toBeCloseTo(-Math.cos(psi * DEG), 10);
    }
  });

  it.each([0, 90, -90, 180, -180, 37.5, -123.4])(
    'yaw %s°: the rotated needle points along projected north',
    (psi) => {
      const expected = northScreen(psi);
      const needle = needleAfter(roseRotation(psi));
      expect(needle[0]).toBeCloseTo(expected[0], 10);
      expect(needle[1]).toBeCloseTo(expected[1], 10);
    },
  );

  it('keeps the documented sanity directions', () => {
    // Facing north → needle up; facing east (−90°) → north is to the left;
    // facing west (+90°) → north is to the right; facing south (180°) → down.
    const [upX, upY] = needleAfter(roseRotation(0));
    expect(upX).toBeCloseTo(0, 10);
    expect(upY).toBeCloseTo(-1, 10);

    const [leftX, leftY] = needleAfter(roseRotation(-90));
    expect(leftX).toBeCloseTo(-1, 10);
    expect(leftY).toBeCloseTo(0, 10);

    const [rightX, rightY] = needleAfter(roseRotation(90));
    expect(rightX).toBeCloseTo(1, 10);
    expect(rightY).toBeCloseTo(0, 10);

    const [downX, downY] = needleAfter(roseRotation(180));
    expect(downX).toBeCloseTo(0, 10);
    expect(downY).toBeCloseTo(1, 10);
  });

  it('returns a finite rotation for arbitrary yaw input', () => {
    expect(Number.isFinite(roseRotation(123.456))).toBe(true);
    expect(Number.isFinite(roseRotation(-270))).toBe(true);
  });
});
