import { Camera } from '../icons/icons';
import { EmptyState } from '../ui/EmptyState';
import { WorkspacePanel } from './WorkspacePanel';
import styles from './CaptureStudioWorkspace.module.css';

/**
 * 01 CAPTURE STUDIO — honest empty state until the capture slice (T12)
 * lands rooms, view groups, and image staging. Nothing here claims a
 * capability the schema cannot back (§5.11 / §9.1).
 */
export function CaptureStudioWorkspace() {
  return (
    <WorkspacePanel id="capture">
      <div className={styles.stub}>
        <EmptyState
          icon={Camera}
          title="No capture sessions yet"
          body="Rooms, staged phone images, and view-group assignment are managed in this workspace."
        />
      </div>
    </WorkspacePanel>
  );
}
