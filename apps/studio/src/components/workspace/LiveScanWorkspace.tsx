import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Lock, Qr, Signal } from '../icons/icons';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { WorkspacePanel } from './WorkspacePanel';
import { QrPairingCard } from '../scan/QrPairingCard';
import { StageRail } from '../scan/StageRail';
import { CameraPreview } from '../scan/CameraPreview';
import { CoverageVisualizer } from '../scan/CoverageVisualizer';
import { coverageFramesFromStagedImages } from './coverageFrames';
import styles from './LiveScanWorkspace.module.css';
import {
  INSECURE_CONTEXT_REMEDY,
  createPairingSession,
  createPairingSyncBridge,
  generateSessionToken,
  isSecureContextBlocked,
  isSessionToken,
  readIsSecureContext,
  type PairingSession,
  type ReceivedFrame,
  type SignallingStatus,
} from '../../lib/pairing';
import { stageVerifiedFrame } from '../../lib/scan/receive';
import { grabFrame, type FrameSendProgress } from '../../lib/scan/capture';
import { getDefaultStorage, type StorageHandle } from '../../lib/storage';
import { createEntityId } from '../../state/bootstrap';
import { WorkspaceStoreContext } from '../../state/workspaceContext';
import type { PairingState, PairingStatus } from '../../state/types';

type LiveScanWorkspaceProps = {
  /**
   * Test injection for `window.isSecureContext`. Omitted → read the real
   * context (undefined in SSR/tests → never blocked).
   */
  secureContext?: boolean;
  /**
   * Whether the `/ws` signalling relay exists. It is a Vite dev-server plugin
   * (scripts/ws-signalling-plugin.ts), so a static production build has none.
   */
  relayAvailable?: boolean;
  /**
   * Raw `?pair=` query value from the entry URL. A valid token puts this
   * device on the phone side (WebRTC responder, camera + capture); an
   * invalid one renders an honest "link not valid" state instead of a
   * session that could never pair. `null`/omitted → desktop (QR) side.
   */
  pairToken?: string | null;
  /**
   * Seed for the desktop's session token (tests / hydration). Must be a
   * valid `NS-XXXX` token — an invalid seed is refused honestly rather
   * than QR-ing a room no session hosts.
   */
  hostToken?: string;
};

export const RELAY_UNAVAILABLE_BODY =
  'Pairing needs the signalling relay that only `npm run dev:lan` runs. This hosted build has no relay, so Live Scan is disabled here.';

/** Honest copy for a `?pair=` value that is not a session token. */
export const INVALID_PAIR_LINK_BODY =
  "This pairing link is not valid — scan the desktop's QR code again to get a fresh link.";

/** Render-safe fallback when no WorkspaceStoreProvider is mounted (tests). */
const IDLE_PAIRING: PairingStatus = { state: 'IDLE', updatedAt: 0 };

/** Sender states in which another frame may be captured and sent. */
const SENDABLE: ReadonlySet<PairingState> = new Set<PairingState>(['LIVE', 'CAPTURING', 'STAGED']);

export type PhoneFramesPanelProps = {
  /** Frames staged from the phone (`source: 'phone'`) in this workspace. */
  count: number;
};

/**
 * Desktop receive summary — shown once verified phone frames exist.
 * `● MEASURED · PHONE` matches the Capture Studio tile label, and the
 * honest no-pose note states what the data does NOT carry (§5.19).
 */
export function PhoneFramesPanel({ count }: PhoneFramesPanelProps) {
  return (
    <div className={styles.frames} data-testid="phone-frames">
      <h2 className={styles.framesTitle}>
        {count} frame{count === 1 ? '' : 's'} from the phone
      </h2>
      <p className={styles.framesNote}>
        ● MEASURED · PHONE — each frame is a verified photograph without pose data.
      </p>
      <a className={styles.handoff} href="/?workspace=capture" data-testid="open-capture-studio">
        Open in Capture Studio
      </a>
    </div>
  );
}

/**
 * 03 LIVE SCAN — the sender→receiver journey surface (T20 §5.17–5.18,
 * T21 §6): the desktop side shows the QR card + received frames, the
 * `?pair=` phone side shows the camera preview + capture button. Both
 * sides run the same pairing session controller and mirror its observed
 * states into the store through `createPairingSyncBridge`, so the stage
 * rail only ever reflects real events — never simulated progress
 * (honest-state rules §3.2, T21 AC).
 *
 * T19: when the origin is insecure the camera peer cannot exist, so the
 * panel reports BLOCKED with the LAN remedy instead of a misleading
 * empty state. This is presentation only — the pairing machine itself
 * is untouched (§9.2).
 */
export function LiveScanWorkspace({
  secureContext,
  relayAvailable = import.meta.env.DEV,
  pairToken = null,
  hostToken,
}: LiveScanWorkspaceProps = {}) {
  const blocked = isSecureContextBlocked(secureContext ?? readIsSecureContext());
  // Raw useContext: tests render this outside a WorkspaceStoreProvider.
  const store = useContext(WorkspaceStoreContext);
  const pairing = store?.state.pairing ?? IDLE_PAIRING;
  const dispatch = store?.dispatch ?? null;

  // Latest refs: session effects run on token changes only, but the store
  // and dispatch they reach must be the current ones.
  const storeRef = useRef(store);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    storeRef.current = store;
    dispatchRef.current = dispatch;
  });

  const isJoiner = pairToken !== null && pairToken !== undefined && isSessionToken(pairToken);
  const invalidPairLink = pairToken !== null && pairToken !== undefined && !isSessionToken(pairToken);

  // Desktop token: the provided seed wins; otherwise mint one here so the
  // QR card and the host session share ONE room (token lift).
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    if (hostToken !== undefined) return isSessionToken(hostToken) ? hostToken : null;
    try {
      return generateSessionToken();
    } catch {
      // No secure RNG — the card's own mint reports the same failure.
      return null;
    }
  });
  const hostSeedInvalid = hostToken !== undefined && sessionToken === null;

  const [signallingStatus, setSignallingStatus] = useState<SignallingStatus>('idle');
  const [sendProgress, setSendProgress] = useState<FrameSendProgress | null>(null);
  const [sendFailure, setSendFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sessionRef = useRef<PairingSession | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const storageRef = useRef<Promise<StorageHandle> | null>(null);

  const pushError = useCallback((title: string, detail?: string) => {
    const current = dispatchRef.current;
    if (!current) return; // no store → nothing can surface a toast (bare renders)
    current({ type: 'toast/push', toast: { id: createEntityId('toast'), tone: 'error', title, detail } });
  }, []);

  const resolveStorage = useCallback(async (): Promise<StorageHandle | null> => {
    storageRef.current ??= getDefaultStorage();
    try {
      return await storageRef.current;
    } catch (error) {
      storageRef.current = null;
      pushError('Local storage unavailable', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [pushError]);

  /** A verified inbound frame → T11 ingest (`source: 'phone'`) → `image/stage`. */
  const stageFrame = useCallback(
    async (frame: ReceivedFrame): Promise<void> => {
      let storage: StorageHandle | null;
      try {
        storage = await resolveStorage();
      } catch (error) {
        // resolveStorage handles its own rejections; this keeps the old
        // wrapper's guarantee that NO stageFrame call ever rejects upward.
        pushError('Phone frame could not be staged', error instanceof Error ? error.message : String(error));
        return;
      }
      if (!storage) return; // resolveStorage already surfaced the failure
      await stageVerifiedFrame(frame, {
        ingest: { putImage: (record) => storage.putImage(record) },
        dispatch: (action) => dispatchRef.current?.(action),
        onError: pushError,
      });
    },
    [pushError, resolveStorage],
  );

  /* ---------------- session lifecycle (one side per URL) ---------------- */

  const pairAvailable = relayAvailable && !blocked;

  useEffect(() => {
    if (!pairAvailable || isJoiner || !sessionToken) return;
    if (!dispatchRef.current) return; // no store → no rail to drive (bare renders)
    let session: PairingSession;
    try {
      session = createPairingSession({ role: 'host', session: sessionToken });
    } catch (error) {
      pushError('Pairing could not start', error instanceof Error ? error.message : String(error));
      return;
    }
    const bridge = createPairingSyncBridge({
      initial: storeRef.current?.state.pairing.state ?? 'IDLE',
      dispatch: (action) => dispatchRef.current?.(action),
    });
    const unsubscribe = session.on((event) => {
      bridge.handle(event);
      if (event.type === 'signalling') setSignallingStatus(event.status);
      if (event.type === 'error') pushError('Pairing failed', event.error.message);
      if (event.type === 'frame') void stageFrame(event.frame);
    });
    session.start();
    return () => {
      session.close(); // deliberate close — OFFLINE first, then silence
      unsubscribe();
      setSignallingStatus('idle');
    };
  }, [pairAvailable, isJoiner, sessionToken, pushError, stageFrame]);

  useEffect(() => {
    if (!pairAvailable || !isJoiner || !pairToken) return;
    if (!dispatchRef.current) return;
    let session: PairingSession;
    try {
      session = createPairingSession({ role: 'joiner', session: pairToken });
    } catch (error) {
      pushError('Pairing could not start', error instanceof Error ? error.message : String(error));
      return;
    }
    const bridge = createPairingSyncBridge({
      initial: storeRef.current?.state.pairing.state ?? 'IDLE',
      dispatch: (action) => dispatchRef.current?.(action),
    });
    const unsubscribe = session.on((event) => {
      bridge.handle(event);
      if (event.type === 'signalling') setSignallingStatus(event.status);
      if (event.type === 'error') pushError('Pairing failed', event.error.message);
      // Real sends and the real ack — the only source of progress numbers.
      if (event.type === 'transfer') setSendProgress(event.progress);
      if (event.type === 'transfer-error') setSendFailure(event.reason);
    });
    session.start();
    sessionRef.current = session;
    return () => {
      session.close();
      unsubscribe();
      sessionRef.current = null;
      setSignallingStatus('idle');
      setSendProgress(null);
      setSendFailure(null);
    };
  }, [pairAvailable, isJoiner, pairToken, pushError]);

  /* ---------------- phone capture (joiner side) ---------------- */

  const canCapture = SENDABLE.has(pairing.state);

  const handleCapture = useCallback(async () => {
    const session = sessionRef.current;
    const video = videoRef.current;
    if (!session || !video) return;
    setSending(true);
    setSendFailure(null);
    try {
      const blob = await grabFrame(video);
      const result = await session.sendFrame(new Uint8Array(await blob.arrayBuffer()));
      if (!result.ok) setSendFailure(result.reason);
    } catch (error) {
      setSendFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }, []);

  /** QR refresh → the host session restarts on the room the new QR encodes. */
  const handleRefreshToken = useCallback((next: string) => setSessionToken(next), []);

  if (!relayAvailable) {
    return (
      <WorkspacePanel id="scan">
        <div className={styles.stub} data-testid="live-scan-unavailable">
          <EmptyState icon={Signal} title="Live Scan is development-only" body={RELAY_UNAVAILABLE_BODY} />
        </div>
      </WorkspacePanel>
    );
  }

  if (blocked) {
    return (
      <WorkspacePanel id="scan">
        <div className={styles.stub} data-testid="live-scan-blocked">
          <EmptyState
            icon={Lock}
            title="Pairing blocked — insecure context"
            body={INSECURE_CONTEXT_REMEDY}
          />
        </div>
      </WorkspacePanel>
    );
  }

  if (invalidPairLink) {
    return (
      <WorkspacePanel id="scan">
        <div className={styles.stub} data-testid="live-scan-invalid-link">
          <EmptyState icon={Qr} title="Pairing link not valid" body={INVALID_PAIR_LINK_BODY} />
        </div>
      </WorkspacePanel>
    );
  }

  if (hostSeedInvalid) {
    return (
      <WorkspacePanel id="scan">
        <div className={styles.stub} data-testid="live-scan-host-token-invalid">
          <EmptyState
            icon={Qr}
            title="Pairing unavailable"
            body="This device's session token is not valid — reload the page to mint a fresh one."
          />
        </div>
      </WorkspacePanel>
    );
  }

  if (isJoiner) {
    // Phone side: camera → grab → datachannel, rail fed by real events.
    return (
      <WorkspacePanel id="scan">
        <div className={styles.layout}>
          <div className={styles.stage}>
            <CameraPreview active videoRef={videoRef} />
            <div className={styles.captureRow}>
              <Button
                variant="primary"
                data-testid="capture-frame"
                onClick={() => void handleCapture()}
                disabled={!canCapture || sending}
                loading={sending}
              >
                Capture frame
              </Button>
              {sendProgress && !sendProgress.acked && (
                <span className={styles.progress} data-testid="send-progress">
                  {sendProgress.sentChunks}/{sendProgress.chunkCount} chunks sent
                </span>
              )}
              {sendProgress?.acked && (
                <span className={styles.progress} data-testid="send-ack">
                  Frame acknowledged · {sendProgress.ackedBytes} bytes
                </span>
              )}
            </div>
            {sendFailure && (
              <p className={styles.failure} role="alert" data-testid="send-failure">
                {sendFailure}
              </p>
            )}
            {!canCapture && (
              <p className={styles.hint} data-testid="joiner-waiting">
                Capture unlocks once the desktop joins this session.
              </p>
            )}
            <p className={styles.hint}>Frames are measured photographs — no pose data travels with them.</p>
          </div>
          <aside className={styles.rail} aria-label="Pairing">
            <StageRail pairing={pairing} />
          </aside>
        </div>
      </WorkspacePanel>
    );
  }

  // Desktop side: QR card + rail, and the received-frames handoff once
  // verified phone frames exist in the store. Every staged frame is unposed
  // in V1, so the visualizer draws grid-plane markers — never frustums.
  const phoneImages = (store?.state.stagedImages ?? []).filter(
    (image) => image.meta.source === 'phone',
  );
  const phoneFrames = coverageFramesFromStagedImages(phoneImages);

  return (
    <WorkspacePanel id="scan">
      <div className={styles.layout}>
        <div className={styles.stage}>
          {phoneFrames.length > 0 ? (
            <>
              <CoverageVisualizer frames={phoneFrames} />
              <PhoneFramesPanel count={phoneFrames.length} />
            </>
          ) : (
            <div className={`${styles.stub} ${styles.stubBare}`}>
              <EmptyState
                icon={Qr}
                title="No phone paired yet"
                body="Live Scan pairs a phone camera over the local network and stages measured frames into Capture Studio."
              />
            </div>
          )}
        </div>
        <aside className={styles.rail} aria-label="Pairing">
          {/* wire signallingStatus so a dead relay shows on the card (T21) */}
          <QrPairingCard
            token={sessionToken ?? undefined}
            signallingStatus={signallingStatus}
            onRefresh={handleRefreshToken}
          />
          <StageRail pairing={pairing} />
        </aside>
      </div>
    </WorkspacePanel>
  );
}
