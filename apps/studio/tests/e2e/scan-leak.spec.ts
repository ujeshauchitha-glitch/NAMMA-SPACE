import { expect, test, type Page } from '@playwright/test';
import { FAKE_MEDIA_ARGS, captureOneFrame, expectPeerConnected, openPair } from './pairing';

/**
 * T22 AC · scan-leak — the Live Scan coverage visualizer must survive
 * StrictMode remounts with a stable canvas count and no WebGL context-lost
 * noise (the T24-withheld spec, re-landed after the EX-1 fix).
 *
 * The real journey: pair over the dev-server relay, push ONE verified frame
 * across the datachannel so the desktop scan workspace genuinely mounts
 * `CoverageVisualizer`, then remount the scan workspace 5×
 * (scan → capture → scan). After every remount:
 *  - exactly ONE coverage canvas exists (0 while the workspace is away —
 *    the unmount path destroys the canvas it created);
 *  - the honest "3D coverage unavailable" context-conflict alert is absent
 *    (its presence is the EX-1 symptom: StrictMode pass 1's cleanup ran
 *    `forceContextLoss()` on the SHARED canvas, so pass 2's lazy
 *    `import('three')` renderer got `getContext() → null`, three threw the
 *    "precision" TypeError, and the component rendered the refusal forever);
 *  - a console/pageerror trap installed BEFORE the first mount records no
 *    three "precision"/null-context throw, no page error, and no UNEXPECTED
 *    context loss. The only context-lost message tolerated is three's own
 *    `THREE.WebGLRenderer: Context Lost.` marker, which our deliberate
 *    `forceContextLoss()`-before-`dispose()` teardown provably emits (it is
 *    the evidence the disposal ran); the browser's
 *    `WebGL: CONTEXT_LOST_WEBGL: context lost.` warning — the one the T22
 *    disposal order exists to prevent — and any other loss source fail.
 */

// Full Chromium required for the fake camera (same note as camera.spec.ts —
// chrome-headless-shell answers getUserMedia with NotSupportedError).
test.use({ launchOptions: { args: [...FAKE_MEDIA_ARGS] }, channel: 'chromium' });

const coverageCanvas = (page: Page) => page.locator('canvas[aria-label="Coverage visualizer"]');

test.describe('scan coverage visualizer remount leak guard (T22 AC / EX-1)', () => {
  test('5 scan-tab remounts keep a stable canvas count with no WebGL-lost noise', async ({ context }) => {
    const origin = test.info().project.use.baseURL ?? 'http://127.0.0.1:5183';
    await context.grantPermissions(['camera'], { origin });
    test.setTimeout(120_000); // full pairing + frame crossing + 5 remounts

    const { host, phone } = await openPair(context, origin);
    try {
      // Console/pageerror trap — installed BEFORE the visualizer can mount
      // (it only mounts once a verified phone frame is staged, so the very
      // first StrictMode double-invoke is inside the trap's window).
      const allNoise: string[] = [];
      const unexpectedNoise: string[] = [];
      // three's deliberate-teardown marker: emitted by `onContextLost` when
      // WE called forceContextLoss() in the disposal path — expected by
      // design, and never emitted by the browser's own unexpected-loss path.
      const deliberateTeardown = /^THREE\.WebGLRenderer: Context Lost\.$/;
      const unexpectedPattern =
        /precision|Cannot read properties of null|CONTEXT_LOST_WEBGL|context lost/i;
      host.on('console', (message) => {
        if (message.type() !== 'error' && message.type() !== 'warning') return;
        const text = message.text();
        if (!unexpectedPattern.test(text)) return;
        allNoise.push(text);
        if (!deliberateTeardown.test(text)) unexpectedNoise.push(text);
      });
      host.on('pageerror', (error) => {
        allNoise.push(`pageerror: ${error.message}`);
        unexpectedNoise.push(`pageerror: ${error.message}`);
      });

      // Real pairing + one real captured frame (no faked staged images).
      await expectPeerConnected(host);
      await expectPeerConnected(phone);
      await captureOneFrame(phone);

      // The staged frame is verified end-to-end ⇒ the scan workspace mounts
      // the real CoverageVisualizer (never a stub).
      await expect(host.getByTestId('phone-frames')).toContainText('1 frame from the phone');
      await expect(coverageCanvas(host)).toHaveCount(1);
      await expect(host.getByText(/3D coverage unavailable/)).toHaveCount(0);

      for (let remount = 1; remount <= 5; remount += 1) {
        await host.getByTestId('tab-capture').click();
        await expect(host.getByTestId('workspace-capture')).toBeVisible();
        await expect(
          coverageCanvas(host),
          `unmount of remount ${remount} left the coverage canvas behind`,
        ).toHaveCount(0);

        await host.getByTestId('tab-scan').click();
        await expect(host.getByTestId('workspace-scan')).toBeVisible();
        await expect(
          coverageCanvas(host),
          `coverage canvas count unstable after remount ${remount} (EX-1 regression)`,
        ).toHaveCount(1);
        await expect(
          host.getByText(/3D coverage unavailable/),
          `false context-conflict alert after remount ${remount} (EX-1 regression)`,
        ).toHaveCount(0);
      }

      // The console trap saw only our own deliberate teardowns — never a
      // precision/null-context throw, browser context-lost warning, or page
      // error, across the initial StrictMode mount plus 5 remounts.
      expect(
        unexpectedNoise,
        'unexpected WebGL/three noise during visualizer mounts and remounts',
      ).toEqual([]);
      console.warn(`[scan-leak] deliberate teardown markers: ${JSON.stringify(allNoise)}`);
    } finally {
      await host.close().catch(() => undefined);
      await phone.close().catch(() => undefined);
    }
  });
});
