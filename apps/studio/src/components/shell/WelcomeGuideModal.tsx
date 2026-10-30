import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Camera, Compass } from '../icons/icons';
import type { WorkspaceId } from '../workspace/workspace';
import { setWelcomeGuideDismissed } from './welcomeGuideState';
import styles from './WelcomeGuideModal.module.css';

export type WelcomeGuideModalProps = {
  open: boolean;
  onClose: () => void;
  onSelectWorkspace: (id: WorkspaceId) => void;
};

export function WelcomeGuideModal({ open, onClose, onSelectWorkspace }: WelcomeGuideModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleClose = () => {
    if (dontShowAgain) {
      setWelcomeGuideDismissed(true);
    }
    onClose();
  };

  const handleAction = (workspace: WorkspaceId) => {
    handleClose();
    onSelectWorkspace(workspace);
  };

  return (
    <div className={styles.backdrop} role="presentation" onClick={handleClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.brandRow}>
            <svg className={styles.mark} viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 2v20M2 12h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
              <circle cx="12" cy="12" r="1.75" fill="var(--accent-lime)" stroke="none" />
            </svg>
            <div>
              <h1 id="welcome-title" className={styles.title}>NAMMA SPACE</h1>
              <p className={styles.tagline}>Turn physical spaces into navigable digital environments.</p>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={handleClose} aria-label="Close guide">
            ✕
          </button>
        </header>

        <div className={styles.content}>
          <div className={styles.actionsGrid}>
            <div className={styles.actionCard} onClick={() => handleAction('viewer')}>
              <div className={styles.cardIconWrap}>
                <Compass className={styles.cardIcon} />
              </div>
              <h2 className={styles.cardTitle}>Explore a space</h2>
              <p className={styles.cardDesc}>
                Open an available digital twin. Free-roam first-person walkthrough with POI search, A* pathfinding, and Gaussian splat rendering.
              </p>
              <Button variant="primary" onClick={() => handleAction('viewer')} className={styles.cardBtn}>
                Launch Viewer →
              </Button>
            </div>

            <div className={styles.actionCard} onClick={() => handleAction('capture')}>
              <div className={styles.cardIconWrap}>
                <Camera className={styles.cardIcon} />
              </div>
              <h2 className={styles.cardTitle}>Create a space</h2>
              <p className={styles.cardDesc}>
                Start with photographs, smartphone video, or supported phone pairing. Stage captures, check blur & coverage, and export structured bundles.
              </p>
              <Button variant="secondary" onClick={() => handleAction('capture')} className={styles.cardBtn}>
                Open Capture Studio →
              </Button>
            </div>
          </div>

          <div className={styles.guideSection}>
            <h3 className={styles.guideHeading}>How to get started</h3>
            <ol className={styles.stepsList}>
              <li className={styles.stepItem}>
                <span className={styles.stepNum}>1</span>
                <div>
                  <strong>Create a project and room:</strong> Organize your physical space into manageable capture areas and view groups (Front, Back, Left, Right).
                </div>
              </li>
              <li className={styles.stepItem}>
                <span className={styles.stepNum}>2</span>
                <div>
                  <strong>Upload or capture the room:</strong> Drag & drop multiple photos, upload smartphone MP4 video clips, or pair a mobile camera via Live Scan.
                </div>
              </li>
              <li className={styles.stepItem}>
                <span className={styles.stepNum}>3</span>
                <div>
                  <strong>Review and prepare observations:</strong> Run automated preflight validation to filter blurry frames, evaluate overlap, and export a signed ZIP capture bundle.
                </div>
              </li>
              <li className={styles.stepItem}>
                <span className={styles.stepNum}>4</span>
                <div>
                  <strong>Run supported reconstruction:</strong> Execute the COLMAP camera pose solver and Brush 3D Gaussian Splatting engine (distinguished from browser capture — requires workstation GPU).
                </div>
              </li>
              <li className={styles.stepItem}>
                <span className={styles.stepNum}>5</span>
                <div>
                  <strong>Explore the generated scene:</strong> Walk through the finished environment with WASD/mouse look, search destinations, and follow calculated routes.
                </div>
              </li>
            </ol>
          </div>

          <div className={styles.architectureNotice}>
            <strong>Compute Architecture Note:</strong> Namma Space hosts its web application, Capture Studio, and 3D spatial viewer entirely serverless on Vercel. Dense 3D reconstruction (COLMAP SfM + Brush 3DGS) runs on an external GPU workstation or pipeline worker. Synthetic demonstration fixtures are provided for immediate in-browser exploration.
          </div>
        </div>

        <footer className={styles.footer}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>Don't show this automatically on launch</span>
          </label>
          <Button variant="primary" onClick={handleClose}>
            Got it, let's go
          </Button>
        </footer>
      </div>
    </div>
  );
}
