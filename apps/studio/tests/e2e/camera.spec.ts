import { expect, test } from '@playwright/test';
import {
  FAKE_MEDIA_ARGS,
  captureOneFrame,
  expectPeerConnected,
  openPair,
  railHistory,
  watchStageRail,
} from './pairing';

/**
 * T24 §4 · camera.spec — the T21 phone-capture surface with a fake camera
 * device: LIVE (real frames on the mirrored preview) → CAPTURING → STAGED
 * rail advancement driven only by real pairing events, plus the honest
 * permission-denied empty state reached through `context.clearPermissions()`.
 */

// Fake camera + software WebGL (the global config's args are replaced
// wholesale by this per-spec list, so the full set is restated).
// `channel: 'chromium'` is REQUIRED on this machine: Playwright's default
// chrome-headless-shell answers getUserMedia with `NotSupportedError` even
// under --use-fake-device-for-media-stream (proven by tests/e2e/debug-gum
// during T24); the full Chromium (new headless) captures the fake stream.
test.use({ launchOptions: { args: [...FAKE_MEDIA_ARGS] }, channel: 'chromium' });

test.describe('camera capture with a fake device (T21/T24)', () => {
  test('granted: camera goes live and one capture advances the rail LIVE → CAPTURING → STAGED', async ({
    context,
  }) => {
    const origin = test.info().project.use.baseURL ?? 'http://127.0.0.1:5183';
    await context.grantPermissions(['camera'], { origin });
    test.setTimeout(60_000); // full pairing journey: connect ≤10 s + ack ≤15 s + setup
    const { host, phone } = await openPair(context, origin);
    try {
      // The fake device delivers a real stream: status live + real frames.
      await expect(phone.getByTestId('camera-preview')).toHaveAttribute(
        'data-status',
        'live',
        { timeout: 10_000 },
      );
      await expect
        .poll(() =>
          phone.evaluate(() => {
            const video = document.querySelector<HTMLVideoElement>(
              '[data-testid="camera-video"]',
            );
            return video?.videoWidth ?? 0;
          }),
        )
        .toBeGreaterThan(0);

      // Real signalling: the peer connection connects over the dev relay.
      await expectPeerConnected(phone);
      await watchStageRail(phone);
      await expect(phone.locator('li[data-stage="LIVE"][data-status="active"]')).toBeVisible({
        timeout: 10_000,
      });

      // One real capture: grab → datachannel → sha-256 verify → ack.
      await captureOneFrame(phone);
      await expect(phone.getByTestId('send-ack')).toContainText(
        /Frame acknowledged · \d+ bytes/,
      );

      // The joiner's own rail traversed CAPTURING (real send) and landed on
      // STAGED (real verified ack) — recorded via MutationObserver, so a
      // fast pass through CAPTURING cannot be raced past.
      await expect(phone.locator('li[data-stage="STAGED"][data-status="active"]')).toBeVisible({
        timeout: 10_000,
      });
      // LIVE was genuinely traversed: at STAGED, the LIVE row reads "done".
      await expect(phone.locator('li[data-stage="LIVE"][data-status="done"]')).toBeVisible();
      const history = await railHistory(phone);
      const capturingIdx = history.findIndex(
        (entry) => entry.stage === 'CAPTURING' && entry.status === 'active',
      );
      const stagedIdx = history.findIndex(
        (entry) => entry.stage === 'STAGED' && entry.status === 'active',
      );
      expect(capturingIdx, 'CAPTURING row was never active on the joiner rail').toBeGreaterThanOrEqual(0);
      expect(stagedIdx, 'STAGED did not follow CAPTURING on the joiner rail').toBeGreaterThan(capturingIdx);

      // Desktop side stages the verified frame (real events only).
      await expect(host.locator('li[data-stage="STAGED"][data-status="active"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(host.getByTestId('phone-frames')).toContainText('1 frame from the phone');
    } finally {
      await host.close();
      await phone.close();
    }
  });

  test('denied: without camera permission the preview reports the honest empty state with the browser remedy', async ({
    context,
    page,
  }) => {
    const origin = test.info().project.use.baseURL ?? 'http://127.0.0.1:5183';
    // The T24 recipe: grant, then clearPermissions — the next getUserMedia
    // is denied by the browser, exactly like a user blocking the prompt.
    await context.grantPermissions(['camera'], { origin });
    await context.clearPermissions();

    // A valid-format token with no host behind it: the camera request runs
    // on mount regardless of whether a desktop joined the room.
    await page.goto(`${origin}/?pair=NS-DNYD`);
    await expect(page.getByTestId('camera-preview')).toHaveAttribute(
      'data-status',
      'denied',
      { timeout: 10_000 },
    );
    await expect(page.getByTestId('camera-denied')).toBeVisible();
    // Exact remedy copy from src/lib/scan/camera.ts (CAMERA_REMEDY).
    await expect(
      page.getByText('Allow camera access in the address bar, then retry'),
    ).toBeVisible();
  });
});
