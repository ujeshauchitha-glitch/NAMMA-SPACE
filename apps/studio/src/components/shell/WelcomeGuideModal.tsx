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

type GuideTab = 'quickstart' | 'runbook' | 'capture-rules' | 'video-pipeline';

export function WelcomeGuideModal({ open, onClose, onSelectWorkspace }: WelcomeGuideModalProps) {
  const [activeTab, setActiveTab] = useState<GuideTab>('quickstart');
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

        <nav className={styles.tabNav} aria-label="Guide Sections">
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'quickstart' ? styles.tabActive : ''].join(' ')}
            onClick={() => setActiveTab('quickstart')}
          >
            01 Quick Start
          </button>
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'runbook' ? styles.tabActive : ''].join(' ')}
            onClick={() => setActiveTab('runbook')}
          >
            02 Judges Runbook (0-to-100)
          </button>
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'capture-rules' ? styles.tabActive : ''].join(' ')}
            onClick={() => setActiveTab('capture-rules')}
          >
            03 How to Take Photos/Videos
          </button>
          <button
            type="button"
            className={[styles.tabBtn, activeTab === 'video-pipeline' ? styles.tabActive : ''].join(' ')}
            onClick={() => setActiveTab('video-pipeline')}
          >
            04 Direct Video Pipeline
          </button>
        </nav>

        <div className={styles.content}>
          {activeTab === 'quickstart' && (
            <>
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
                      <strong>Create a project and room:</strong> Organize your physical space into capture areas and view groups (Front, Back, Left, Right).
                    </div>
                  </li>
                  <li className={styles.stepItem}>
                    <span className={styles.stepNum}>2</span>
                    <div>
                      <strong>Upload or capture the room:</strong> Drag & drop photos, upload smartphone MP4 videos, or pair via Live Scan.
                    </div>
                  </li>
                  <li className={styles.stepItem}>
                    <span className={styles.stepNum}>3</span>
                    <div>
                      <strong>Review and prepare observations:</strong> Run automated preflight validation to filter blur and export a signed ZIP capture bundle.
                    </div>
                  </li>
                  <li className={styles.stepItem}>
                    <span className={styles.stepNum}>4</span>
                    <div>
                      <strong>Run supported reconstruction:</strong> Execute the COLMAP camera pose solver and Brush 3D Gaussian Splatting engine on GPU compute.
                    </div>
                  </li>
                  <li className={styles.stepItem}>
                    <span className={styles.stepNum}>5</span>
                    <div>
                      <strong>Explore the generated scene:</strong> Walk through the environment with WASD/mouse look, search destinations, and follow calculated routes.
                    </div>
                  </li>
                </ol>
              </div>

              <div className={styles.architectureNotice}>
                <strong>Compute Architecture Note:</strong> Namma Space hosts its web application, Capture Studio, and 3D spatial viewer serverless on Vercel. Dense 3D reconstruction (COLMAP SfM + Brush 3DGS) runs on an external GPU workstation or pipeline worker.
              </div>
            </>
          )}

          {activeTab === 'runbook' && (
            <div className={styles.guideSection}>
              <h3 className={styles.guideHeading}>Judge & Reviewer Interactive Walkthrough</h3>
              <p className={styles.tabIntro}>Follow this 2-minute runbook to evaluate every working subsystem:</p>

              <div className={styles.runbookSteps}>
                <div className={styles.runbookStep}>
                  <span className={styles.stepTag}>TEST 1</span>
                  <div>
                    <strong>Walkthrough & First-Person Controls (Tab 02):</strong>
                    <p>Switch between the 5 verified demonstration scenes from the header dropdown:</p>
                    <ul>
                      <li><code>Captured Workshop Room (70 Photos)</code>: Full digital twin reconstructed from 70 genuine smartphone photos with architectural concrete floor, corrugated metal walls, wall-mounted sink with yellow shelf, blue travel suitcase, and 2,966 calibrated feature points!</li>
                      <li><code>Nerfstudio Benchmark · Poster (226 Cameras)</code>: Photorealistic multi-view spatial twin from official Nerfstudio capture (226 registered cameras, hardwood floor, gallery walls, folding chair holding the 'PROTECT Your Mental Health' framed poster, 12,977 calibrated 3D points, and 90 KB SOG splat)!</li>
                      <li><code>Synthetic Splat fixture (SOG)</code>: 3D Gaussian Splat model rendered via PlayCanvas WebGL.</li>
                      <li><code>Procedural fixture</code>: Synthetic architectural box room with verified navigation.</li>
                      <li><code>Generated GLB fixture</code>: Mesh model with collision bounds.</li>
                    </ul>
                    <p>Click <strong>Full Screen</strong> (or press <kbd>F</kbd>) for an immersive edge-to-edge view. Click the scene to lock mouse look. Walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>. Press <kbd>Esc</kbd> to release.</p>
                  </div>
                </div>

                <div className={styles.runbookStep}>
                  <span className={styles.stepTag}>TEST 2</span>
                  <div>
                    <strong>POI Search & Collision-Safe A* Navigation:</strong>
                    <p>Press <code>Cmd+K</code> or click <em>Search points of interest</em> in the right rail. Search for <code>Registration</code> or <code>Information</code>. Click a destination, then click <strong>Plot route</strong>. Notice the green walking tape calculated through obstacles. Click <strong>Jump to view</strong> to smoothly fly to the viewpoint.</p>
                  </div>
                </div>

                <div className={styles.runbookStep}>
                  <span className={styles.stepTag}>TEST 3</span>
                  <div>
                    <strong>Capture Studio Staging & ZIP Export (Tab 01):</strong>
                    <p>Click Tab <code>01 Capture Studio</code>. Click <strong>+ Add room</strong>. Drag & drop images into the canvas. Select photos and assign viewpoints (Front/Back/Left/Right). Click <strong>Export bundle</strong> to download the real SHA-256 capture ZIP bundle.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'capture-rules' && (
            <div className={styles.guideSection}>
              <h3 className={styles.guideHeading}>How to Take Photographs or Video for 3D Reconstruction</h3>
              <p className={styles.tabIntro}>Why 5 random photos fail and what photogrammetry mathematically requires:</p>

              <div className={styles.rulesList}>
                <div className={styles.ruleCard}>
                  <strong>1. Capture Density (60 to 120+ Photos or 4K Video)</strong>
                  <p>COLMAP requires dozens of camera ray intersections to triangulate depth. A handful of photos leaves 95% of room surfaces unobserved.</p>
                </div>

                <div className={styles.ruleCard}>
                  <strong>2. High Overlap (70% - 80% Between Adjacent Shots)</strong>
                  <p>Every corner of the room must appear in at least 3-4 consecutive frames. Walk slowly in a continuous orbit around the room perimeter.</p>
                </div>

                <div className={styles.ruleCard}>
                  <strong>3. Zero Motion Blur & Good Lighting</strong>
                  <p>SIFT feature extraction fails on blurry pixels. Hold phone steady, enable 60fps if filming, and keep room evenly lit (turn on room lights, avoid dark shadows).</p>
                </div>

                <div className={styles.ruleCard}>
                  <strong>4. Completely Static Room (No Moving People/Pets)</strong>
                  <p>Structure-from-Motion assumes the physical world does not move. A person walking in the frame creates ghost tie-points that corrupt camera poses.</p>
                </div>

                <div className={styles.ruleCard}>
                  <strong>5. Include Room Anchors on Flat Walls</strong>
                  <p>Plain featureless walls (e.g. blank sheet metal) have zero texture points. Capture corners, baseboards, switchboards, doors, and furniture as visual anchors.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'video-pipeline' && (
            <div className={styles.guideSection}>
              <h3 className={styles.guideHeading}>Direct Video Upload to 3D Digital Twin</h3>
              <p className={styles.tabIntro}>How direct smartphone video processing works in production:</p>

              <div className={styles.architectureFlow}>
                <div className={styles.flowNode}>
                  <strong>1. Browser Upload</strong>
                  <span>Smartphone MP4 / MOV video</span>
                </div>
                <div className={styles.flowArrow}>➔</div>
                <div className={styles.flowNode}>
                  <strong>2. Cloud Storage</strong>
                  <span>S3 / R2 / GCS bucket</span>
                </div>
                <div className={styles.flowArrow}>➔</div>
                <div className={styles.flowNode}>
                  <strong>3. GPU Worker</strong>
                  <span>COLMAP SfM + Brush 3DGS</span>
                </div>
                <div className={styles.flowArrow}>➔</div>
                <div className={styles.flowNode}>
                  <strong>4. Digital Twin</strong>
                  <span>scene.sog + nav-data.json</span>
                </div>
              </div>

              <div className={styles.explanationBox}>
                <p>
                  <strong>Why can't Vercel run this directly?</strong> Vercel serverless functions have a 250 MB execution size limit, a 15–60s timeout, and zero NVIDIA GPUs.
                </p>
                <p>
                  <strong>Production System Architecture:</strong> In production, uploading a video sends the file to an S3 bucket which fires a webhook to a GPU worker pool (Modal Labs, RunPod, or AWS EC2 with NVIDIA RTX/A10G). The worker extracts frames with FFmpeg, solves poses with COLMAP, trains the 3D Gaussian Splat with Brush, compresses it to SOG format, and pushes the scene directly into the viewer!
                </p>
                <p>
                  <strong>Local / Hackathon Execution:</strong> You run the exact worker locally with:
                  <br />
                  <code>python3 apps/studio/scripts/run_pipeline.py clip.mp4 --out public/scenes/my_room</code>
                </p>
              </div>
            </div>
          )}
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
