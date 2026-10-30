import { expect, test, type Page } from '@playwright/test';
import {
  FAKE_MEDIA_ARGS,
  captureOneFrame,
  expectPeerConnected,
  openPair,
  railHistory,
  watchStageRail,
  workspaceSnapshotPresent,
} from './pairing';

/**
 * T24 §5 · webrtc-loopback — the whole T21 journey with no physical phone:
 * two pages in ONE browser context (desktop host + `?pair=` joiner) pair over
 * the dev server's `/ws` signalling relay, negotiate a real
 * RTCPeerConnection (asserted at `connectionState === 'connected'` within
 * 10 s), and push one real capture across the `capture` datachannel.
 *
 * T27 follow-up 1 — this is ALSO the return-phone path (T24 written
 * exception 2 → EX-7): the phone runs as a `'returning'` profile, i.e. with
 * the host's stale workspace snapshot (persisted `pairing: IDLE`) still in
 * the shared IndexedDB, and it RELOADS with that snapshot still present.
 * No `clearWorkspaceSnapshot` anywhere on this path — that clear was the
 * workaround masking the hydrate clobber. The store-level fix
 * (`mergePairingOnHydrate`, 9d7f33f) must hold on its own: after the
 * reload the rail has to reach LIVE and must NOT be stuck at IDLE.
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

/**
 * Verified phone-frame count shown by the host's `phone-frames` panel
 * (0 while the panel does not exist). Baseline-relative because the one
 * allowed retry shares the context's IndexedDB: a staged frame from a
 * failed earlier attempt is still honestly there on the next attempt.
 */
async function phoneFrameCount(host: Page): Promise<number> {
  const panel = host.getByTestId('phone-frames');
  if ((await panel.count()) === 0) return 0;
  const match = /(\d+) frames? from the phone/.exec(await panel.innerText());
  return match ? Number(match[1]) : Number.NaN;
}

const framesLabel = (count: number): string => `${count} frame${count === 1 ? '' : 's'} from the phone`;

async function runLoopback(
  context: Parameters<typeof openPair>[0],
  origin: string,
): Promise<void> {
  // Returning phone: the stale snapshot stays in the shared IDB for BOTH
  // the initial pair and the reload below (T27 follow-up 1 / EX-7).
  const { host, phone } = await openPair(context, origin, { phoneProfile: 'returning' });
  const initialFrames = await phoneFrameCount(host);
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
    await expect(host.getByTestId('phone-frames')).toContainText(framesLabel(initialFrames + 1));

    // The joiner rail completed the sender journey too.
    const phoneHistory = await railHistory(phone);
    expect(phoneHistory).toContainEqual({ stage: 'STAGED', status: 'active' });

    // 4. T27 follow-up 1 · return-phone re-check (T24 written exception 2 →
    //    EX-7): reload the phone page with the stale workspace snapshot
    //    STILL in the shared IndexedDB — never call clearWorkspaceSnapshot
    //    here, it is precisely the workaround under test. The re-pairing
    //    session must survive `state/hydrate` (mergePairingOnHydrate,
    //    fix 9d7f33f): the rail reaches LIVE again and is NOT stuck at
    //    IDLE with capture locked — the pre-fix symptom.
    expect(
      await workspaceSnapshotPresent(phone),
      'the stale workspace snapshot vanished before the return-phone reload — this re-check would be vacuous',
    ).toBe(true);

    await phone.reload();
    await expect(phone.getByTestId('camera-preview')).toBeVisible();
    await expectPeerConnected(phone); // a REAL new PC on the reloaded page ≤ 10 s
    await expect(
      phone.locator('li[data-stage="LIVE"][data-status="active"]'),
      'returning phone rail never reached LIVE after reload — the stale snapshot clobbered the re-pairing session (EX-7 regression)',
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      phone.locator('li[data-stage="IDLE"][data-status="active"]'),
      'returning phone rail is stuck at IDLE after reload — hydrate clobber regression (EX-7)',
    ).toHaveCount(0);
    await expect(
      phone.getByTestId('capture-frame'),
      'capture stayed locked after the return-phone reload — the live session did not survive hydrate (EX-7)',
    ).toBeEnabled();

    // 5. EX-7 adjacent observation — RESOLVED: the mid-session reload used to
    //    re-establish the RTCPeerConnection but NOT the `capture` datachannel
    //    (the host never re-created it; a post-reload capture failed honestly
    //    with "The data channel closed before the frame could start"). The
    //    pairing core now rebuilds the connection on the relay's re-announce
    //    (src/lib/pairing rejoin), so a SECOND real frame must cross
    //    end-to-end: capture-state + payload + verified ack on the rebuilt
    //    channel. `captureOneFrame` waits for the real "Frame acknowledged"
    //    receipt, and the host panel only increments on a SHA-256-verified
    //    frame — no timer or local state can fake either signal.
    //    `window.__dcMessages` is cumulative for the page's whole life, so
    //    the capture-state check below is BASELINED against the pre-capture
    //    length — only messages the second capture itself delivered count
    //    (the first capture already pushed `capturing` long before reload).
    const dcMessagesBeforeSecondCapture = await host.evaluate(() => window.__dcMessages.length);
    await captureOneFrame(phone);
    const captureStatesAfterReload = (await host.evaluate(() => window.__dcMessages ?? []))
      .slice(dcMessagesBeforeSecondCapture)
      .map((raw) => {
        try {
          return JSON.parse(raw) as { type?: string; status?: string };
        } catch {
          return null;
        }
      })
      .filter((message): message is { type: string; status?: string } => message?.type === 'capture-state');
    expect(
      captureStatesAfterReload.map((message) => message.status),
      'the second capture delivered no capture-state:capturing to the host datachannel after the return-phone reload — the rebuilt channel did not carry it (EX-7 adjacent regression)',
    ).toContain('capturing');
    await expect(
      host.getByTestId('phone-frames'),
      'the host did not stage a SECOND verified frame after the return-phone reload — the rebuilt capture channel did not carry a frame',
    ).toContainText(framesLabel(initialFrames + 2));
  } finally {
    await host.close().catch(() => undefined);
    await phone.close().catch(() => undefined);
  }
}

test.describe('WebRTC loopback over the dev-server relay (T21/T24)', () => {
  test('two pages connect within 10 s, a capture-state message crosses the datachannel, and a return-phone reload survives hydrate', async ({
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
        console.warn(
          `[webrtc-loopback] attempt ${attempt} failed: ${
            error instanceof Error ? (error.stack ?? String(error)) : String(error)
          }`,
        );
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
