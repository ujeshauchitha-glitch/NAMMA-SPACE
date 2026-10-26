import { useContext } from 'react';
import { Lock, Qr } from '../icons/icons';
import { EmptyState } from '../ui/EmptyState';
import { WorkspacePanel } from './WorkspacePanel';
import { QrPairingCard } from '../scan/QrPairingCard';
import { StageRail } from '../scan/StageRail';
import styles from './LiveScanWorkspace.module.css';
import {
  INSECURE_CONTEXT_REMEDY,
  isSecureContextBlocked,
  readIsSecureContext,
} from '../../lib/pairing/secure-context';
import { WorkspaceStoreContext } from '../../state/workspaceContext';
import type { PairingStatus } from '../../state/types';

type LiveScanWorkspaceProps = {
  /**
   * Test injection for `window.isSecureContext`. Omitted → read the real
   * context (undefined in SSR/tests → never blocked).
   */
  secureContext?: boolean;
};

/** Render-safe fallback when no WorkspaceStoreProvider is mounted (tests). */
const IDLE_PAIRING: PairingStatus = { state: 'IDLE', updatedAt: 0 };

/**
 * 03 LIVE SCAN — right-rail pairing card + stage rail (T20 / §5.17–5.18).
 * The stub never fakes a connection, a camera, or staged frames
 * (honest-state rules §3.2); the rail renders only what `PairingStatus`
 * can defend.
 *
 * T19: when the origin is an insecure context (`isSecureContext === false`)
 * the camera peer cannot exist, so the panel reports BLOCKED with the LAN
 * remedy instead of a misleading empty state. This is presentation only —
 * the pairing machine itself is untouched (§9.2).
 */
export function LiveScanWorkspace({ secureContext }: LiveScanWorkspaceProps = {}) {
  const blocked = isSecureContextBlocked(secureContext ?? readIsSecureContext());
  // Raw useContext: tests render this outside a WorkspaceStoreProvider.
  const store = useContext(WorkspaceStoreContext);
  const pairing = store?.state.pairing ?? IDLE_PAIRING;

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

  return (
    <WorkspacePanel id="scan">
      <div className={styles.layout}>
        <div className={`${styles.stub} ${styles.stubBare}`}>
          <EmptyState
            icon={Qr}
            title="No phone paired yet"
            body="Live Scan pairs a phone camera over the local network and stages measured frames into Capture Studio."
          />
        </div>
        <aside className={styles.rail} aria-label="Pairing">
          {/* wire signallingStatus when the T21 pairing slice exposes it */}
          <QrPairingCard />
          <StageRail pairing={pairing} />
        </aside>
      </div>
    </WorkspacePanel>
  );
}
