import { Lock, Qr } from '../icons/icons';
import { EmptyState } from '../ui/EmptyState';
import { WorkspacePanel } from './WorkspacePanel';
import styles from './LiveScanWorkspace.module.css';
import {
  INSECURE_CONTEXT_REMEDY,
  isSecureContextBlocked,
  readIsSecureContext,
} from '../../lib/pairing/secure-context';

type LiveScanWorkspaceProps = {
  /**
   * Test injection for `window.isSecureContext`. Omitted → read the real
   * context (undefined in SSR/tests → never blocked).
   */
  secureContext?: boolean;
};

/**
 * 03 LIVE SCAN — honest states until the pairing slice (T18–T22) lands the
 * QR card, camera preview, and stage rail. The stub never fakes a
 * connection, a camera, or staged frames (honest-state rules §3.2).
 *
 * T19: when the origin is an insecure context (`isSecureContext === false`)
 * the camera peer cannot exist, so the panel reports BLOCKED with the LAN
 * remedy instead of a misleading empty state. This is presentation only —
 * the pairing machine itself is untouched (§9.2).
 */
export function LiveScanWorkspace({ secureContext }: LiveScanWorkspaceProps = {}) {
  const blocked = isSecureContextBlocked(secureContext ?? readIsSecureContext());

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
      <div className={styles.stub}>
        <EmptyState
          icon={Qr}
          title="No phone paired yet"
          body="Live Scan pairs a phone camera over the local network and stages measured frames into Capture Studio."
        />
      </div>
    </WorkspacePanel>
  );
}
