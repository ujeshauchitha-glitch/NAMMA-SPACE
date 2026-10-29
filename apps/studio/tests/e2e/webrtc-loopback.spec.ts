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
 * T24 §5 · webrtc-loopback — the whole T21 journey with no physical phone:
 * two pages in ONE browser context (desktop host + `?pair=` joiner) pair over
 * the dev server's `/ws` signalling relay, negotiate a real
 * RTCPeerConnection (asserted at `connectionState === 'connected'` within
 * 10 s), and push one real capture across the `capture` datachannel.
 *
 * The capture-state crossing is proven through the HOST rail: session.ts
 * only advances the host machine to CAPTURING inside `handlePairingMessage`
 * on a received `capture-state: capturing` message — there is no local timer
 * that could fake it. STAGED on the host additionally requires the verified
 * frame payload to have crossed.
 *
 * Flakiness policy (T24 contract): ONE retry is allowed; a second failure
 * fails loudly here — no silent skip, ever.
 */

// Full Chromium required for the fake camera (see camera.spec.ts note —
// chrome-headless-shell returns NotSupportedError for getUserMedia).
test.use({ launchOptions: { args: [...FAKE_MEDIA_ARGS] }, channel: 'chromium' });

async function runLoopback(
  context: Parameters<typeof openPair>[0],
  origin: string,
): Promise<void> {
  const { host, phone } = await openPair(context, origin);
  try {
    // 1. Real WebRTC: both sides reach connectionState 'connected' ≤ 10 s.
    await expectPeerConnected(host);
    await expectPeerConnected(phone);

    // Both rails reflect the observed handshake (LIVE, real events only).
    await expect(host.locator('li[data-stage="LIVE"][data-status="active"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(phone.locator('li[data-stage="LIVE"][data-status="active"]')).toBeVisible({
      timeout: 10_000,
    });

    // 2. Watch both rails, then push one real frame across the datachannel.
    await watchStageRail(host);
    await watchStageRail(phone);
    await captureOneFrame(phone);
    await expect(phone.getByTestId('send-ack')).toContainText(
      /Frame acknowledged · \d+ bytes/,
    );

    // 3. A capture-state message crossed the datachannel — observed at BOTH
    //    ends of the wire:
    //    (a) the HOST page received a `capture-state` frame on the `capture`
    //        datachannel (recorded by the onmessage wrapper in instrumentRtc);
    //    (b) the host rail reached STAGED, which session.ts only does after
    //        the sha-256-verified frame payload crossed and was acked.
    const hostDcMessages = await host.evaluate(() => window.__dcMessages ?? []);
    const captureStates = hostDcMessages
      .map((raw) => {
        try {
          return JSON.parse(raw) as { type?: string; status?: string };
        } catch {
          return null;
        }
      })
      .filter((message): message is { type: string; status?: string } => message?.type === 'capture-state');
    expect(
      captureStates.length,
      'no capture-state message was received on the host datachannel',
    ).toBeGreaterThan(0);
    expect(
      captureStates.map((message) => message.status),
      'the host never received capture-state: capturing — the sender did not announce the frame',
    ).toContain('capturing');

    const hostHistory = await railHistory(host);
    expect(
      hostHistory,
      'host rail never showed STAGED — the verified frame did not arrive',
    ).toContainEqual({ stage: 'STAGED', status: 'active' });
    await expect(host.getByTestId('phone-frames')).toContainText('1 frame from the phone');

    // The joiner rail completed the sender journey too.
    const phoneHistory = await railHistory(phone);
    expect(phoneHistory).toContainEqual({ stage: 'STAGED', status: 'active' });
  } finally {
    await host.close().catch(() => undefined);
    await phone.close().catch(() => undefined);
  }
}

test.describe('WebRTC loopback over the dev-server relay (T21/T24)', () => {
  test('two pages connect within 10 s and a capture-state message crosses the datachannel', async ({
    context,
  }) => {
    const origin = test.info().project.use.baseURL ?? 'http://127.0.0.1:5183';
    await context.grantPermissions(['camera'], { origin });
    test.setTimeout(120_000); // two full loopback attempts allowed before the loud fail

    let lastFailure: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await runLoopback(context, origin);
        if (attempt === 2) {
          console.warn('[webrtc-loopback] passed on the single allowed retry');
        }
        return;
      } catch (error) {
        lastFailure = error;
        console.warn(`[webrtc-loopback] attempt ${attempt} failed: ${String(error)}`);
      }
    }
    // T24 ask_abort_triggers: flake past the one allowed retry is a LOUD
    // failure — the loopback is a gate, never a silent skip.
    throw new Error(
      'WebRTC loopback FAILED on both attempts — FAILING LOUDLY (no silent skip). ' +
        `Last failure: ${String(lastFailure)}`,
    );
  });
});
