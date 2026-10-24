import { Qr } from '../icons/icons';
import { EmptyState } from '../ui/EmptyState';
import { WorkspacePanel } from './WorkspacePanel';
import styles from './LiveScanWorkspace.module.css';

/**
 * 03 LIVE SCAN — honest empty state until the pairing slice (T18–T22)
 * lands the QR card, camera preview, and stage rail. The stub never fakes
 * a connection, a camera, or staged frames (honest-state rules §3.2).
 */
export function LiveScanWorkspace() {
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
