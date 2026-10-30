/**
 * T24 · shared Live Scan loopback wiring (helper — not a spec; the filename
 * deliberately does not match Playwright's testMatch).
 *
 * One dev-server signalling relay serves every pairing surface: the desktop
 * host mints an `NS-XXXX` token on the QR card, the "phone" arrives via
 * `?pair=TOKEN` in a second page of the SAME browser context, and the two
 * negotiate a real RTCPeerConnection over the Vite `/ws` relay
 * (scripts/ws-signalling-plugin.ts — `npm run dev` runs it).
 *
 * Real-state rules kept here:
 *  - `connectionState` is read from the actual RTCPeerConnection instances
 *    (constructor instrumented before any app script runs) — never inferred
 *    from UI copy;
 *  - the stage rail is observed through MutationObservers on the real
 *    `data-status` attributes, so even a transient CAPTURING row is recorded;
 *    the rail only moves on observed protocol events (session.ts).
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Fake-camera + software-WebGL launch args (T24 spec §4). The global config
 * already carries swiftshader/gpu-sandbox; specs that need a fake camera
 * restate the full list via per-spec `test.use({ launchOptions })`.
 */
export const FAKE_MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
];

/** Default token pattern from src/lib/pairing/token.ts (NS- + 4 alnum). */
const TOKEN_PATTERN = /^NS-[A-Z0-9]{4}$/;

type RailEntry = { stage: string; status: string };

declare global {
  interface Window {
    __rtcPcs: RTCPeerConnection[];
    __railHistory: RailEntry[];
    __dcMessages: string[];
  }
}

/**
 * Record every real RTCPeerConnection the page constructs AND every string
 * message the `capture` datachannel receives (installed before app scripts
 * via addInitScript, so the pairing session's own factories pick the wrapped
 * surfaces up transparently).
 */
export async function instrumentRtc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__rtcPcs = [];
    window.__dcMessages = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        window.__rtcPcs.push(this);
      }
    };
    // Wrap the IDL onmessage accessor so inbound datachannel traffic is
    // observable WITHOUT altering delivery (the pairing peer assigns
    // `channel.onmessage`; our setter records a faithful passthrough).
    const descriptor = Object.getOwnPropertyDescriptor(
      window.RTCDataChannel.prototype,
      'onmessage',
    );
    if (descriptor?.get && descriptor.set) {
      Object.defineProperty(window.RTCDataChannel.prototype, 'onmessage', {
        configurable: true,
        get(this: RTCDataChannel) {
          return descriptor.get?.call(this);
        },
        set(this: RTCDataChannel, handler: ((event: MessageEvent) => void) | null) {
          const wrapped =
            handler === null
              ? null
              : (event: MessageEvent): void => {
                  if (typeof event.data === 'string') window.__dcMessages.push(event.data);
                  handler.call(this, event);
                };
          descriptor.set?.call(this, wrapped);
        },
      });
    }
  });
}

/** Has any real peer connection on this page reached 'connected'? */
export async function anyPeerConnected(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    window.__rtcPcs.some((pc) => pc.connectionState === 'connected'),
  );
}

/** Poll the real `RTCPeerConnection.connectionState` — the T24 10 s contract. */
export async function expectPeerConnected(page: Page): Promise<void> {
  await expect
    .poll(() => anyPeerConnected(page), {
      timeout: 10_000,
      message: 'RTCPeerConnection did not reach connectionState "connected" within 10 s',
    })
    .toBe(true);
}

/**
 * Attach MutationObservers to the six rail rows and record every
 * `data-status` change. Must be called before the transition under test.
 */
export async function watchStageRail(page: Page): Promise<void> {
  await expect(page.getByTestId('stage-rail')).toBeVisible();
  await page.evaluate(() => {
    window.__railHistory = [];
    const rail = document.querySelector('[data-testid="stage-rail"]');
    if (!rail) throw new Error('stage rail not mounted');
    for (const row of rail.querySelectorAll('li[data-stage][data-status]')) {
      new MutationObserver(() => {
        window.__railHistory.push({
          stage: row.getAttribute('data-stage') ?? '',
          status: row.getAttribute('data-status') ?? '',
        });
      }).observe(row, { attributes: true, attributeFilter: ['data-status'] });
    }
  });
}

export async function railHistory(page: Page): Promise<RailEntry[]> {
  return page.evaluate(() => window.__railHistory ?? []);
}

/**
 * OPT-IN fresh-phone mirror (T24-era workaround, now scenario-scoped).
 *
 * A real first-scan phone arrives with a fresh browser profile — empty IDB.
 * In a single shared e2e context both pages share ONE IndexedDB, so specs
 * whose subject is NOT the hydrate/pairing race use this to mirror that
 * invariant: delete only the workspace snapshot record
 * (`kv/workspace-snapshot.v1`) before the load (staged-image records are
 * left untouched — the workflow spec needs them).
 *
 * T27 follow-up 1: this clear was MASKING the app-level "returning phone"
 * race (desktop snapshot hydrating `pairing: IDLE` over a live session).
 * The loopback/return-phone path therefore now runs with the snapshot
 * KEPT (`openPair(…, { phoneProfile: 'returning' })`) — the store-level
 * fix (`mergePairingOnHydrate`, 9d7f33f) has to hold on its own. Do not
 * re-add this clear to that path; it is the workaround under test.
 */
export async function clearWorkspaceSnapshot(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Never CREATE the DB here — an unversioned open on a fresh origin
    // would mint an empty v1 database the app's upgrade handler skips.
    const known = (await indexedDB.databases()).some((db) => db.name === 'namma-space');
    if (!known) return;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('namma-space');
      request.onerror = () => reject(request.error ?? new Error('idb open failed'));
      request.onsuccess = () => resolve(request.result);
    });
    if (!db.objectStoreNames.contains('kv')) {
      db.close();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const deletion = tx.objectStore('kv').delete('workspace-snapshot.v1');
      deletion.onerror = () => reject(deletion.error ?? new Error('kv delete failed'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('kv transaction failed'));
    });
    db.close();
  });
}

/**
 * Read-only precondition probe: does the shared IndexedDB still hold a
 * `kv/workspace-snapshot.v1` record? Used by the returning-phone path to
 * PROVE the stale snapshot is present before the phone loads/reloads —
 * the opposite direction of the workaround (never deletes anything).
 */
export async function workspaceSnapshotPresent(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const known = (await indexedDB.databases()).some((db) => db.name === 'namma-space');
    if (!known) return false;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('namma-space');
      request.onerror = () => reject(request.error ?? new Error('idb open failed'));
      request.onsuccess = () => resolve(request.result);
    });
    if (!db.objectStoreNames.contains('kv')) {
      db.close();
      return false;
    }
    const present = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').count('workspace-snapshot.v1');
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error ?? new Error('kv count failed'));
    });
    db.close();
    return present;
  });
}

export type PairPages = {
  /** Desktop side — QR host, WebRTC initiator, frame receiver. */
  host: Page;
  /** "Phone" side — `?pair=` joiner, camera capture, frame sender. */
  phone: Page;
  /** The session token both sides joined (read from the host's QR card). */
  token: string;
};

/**
 * Open the host on the scan workspace, read its freshly minted session token
 * off the QR card, then open the phone side on `?pair=TOKEN` — both pages in
 * the supplied context (one browser, one origin, one relay).
 *
 * `phoneProfile` (T27 follow-up 1):
 *  - `'fresh'` (default) — mirror a first-scan phone: the shared workspace
 *    snapshot is cleared before the phone loads (genuinely-fresh-phone
 *    subjects like camera.spec / scan-leak.spec). Not a hydrate test.
 *  - `'returning'` — the T24 written-exception-2 / EX-7 re-check: the host's
 *    stale snapshot (persisted `pairing: IDLE`) is KEPT in the shared IDB,
 *    so the phone pairs THROUGH hydrate, and `clearWorkspaceSnapshot` is
 *    never called. A precondition poll asserts the snapshot really exists
 *    before the phone page opens — no silent fallback to the workaround.
 */
export async function openPair(
  context: BrowserContext,
  origin: string,
  options: { phoneProfile?: 'fresh' | 'returning' } = {},
): Promise<PairPages> {
  const profile = options.phoneProfile ?? 'fresh';

  if (profile === 'fresh') {
    // Mirror the fresh-profile invariant documented on clearWorkspaceSnapshot:
    // a first-scan phone pairs from a profile holding NO workspace snapshot.
    const probe = await context.newPage();
    await probe.goto(`${origin}/`, { waitUntil: 'commit' }); // same origin, no full app boot
    await clearWorkspaceSnapshot(probe);
    await probe.close();
  }

  const host = await context.newPage();
  await instrumentRtc(host);
  await host.goto(`${origin}/?workspace=scan`);
  await expect(host.getByTestId('pair-card')).toBeVisible();
  const token = (await host.getByTestId('pair-session').innerText()).trim();
  expect(token).toMatch(TOKEN_PATTERN);

  if (profile === 'fresh') {
    // The host has written its snapshot by now; the phone must not read it.
    await clearWorkspaceSnapshot(host);
  } else {
    // Returning phone: the stale snapshot MUST be there (the host persists
    // it right after hydration) — assert it, never delete it.
    await expect
      .poll(() => workspaceSnapshotPresent(host), {
        timeout: 10_000,
        message:
          'returning-phone precondition failed: the host never wrote the stale workspace snapshot',
      })
      .toBe(true);
  }

  const phone = await context.newPage();
  await instrumentRtc(phone);
  await phone.goto(`${origin}/?pair=${token}`);
  await expect(phone.getByTestId('camera-preview')).toBeVisible();
  return { host, phone, token };
}

/** Capture one frame on the phone side and wait for the real verified ack. */
export async function captureOneFrame(phone: Page): Promise<void> {
  await expect(phone.getByTestId('capture-frame')).toBeEnabled({ timeout: 10_000 });
  await phone.getByTestId('capture-frame').click();
  await expect(phone.getByTestId('send-ack')).toContainText(
    /Frame acknowledged · \d+ bytes/,
    { timeout: 15_000 },
  );
}
