// Camera capture preview (T21 / design §6 phone capture): mirrored 16:9 feed
// with instrument corner brackets, honest permission/device empty states
// carrying the exact remedy copy, and an external <video> ref so the phone
// route can frame-grab through lib/scan/capture (canvas, long edge 1600).
//
// Exports only components (+ type-only props) so react-refresh stays clean:
// pure helpers live in ../../lib/scan/camera.
import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { AlertTriangle, Camera, Lock } from '../icons/icons';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import {
  CAMERA_REMEDY,
  defaultGetMedia,
  requestCamera,
  stopCameraStream,
  type CameraStatus,
  type GetMediaFn,
} from '../../lib/scan/camera';
import styles from './CameraPreview.module.css';

export type CameraPreviewProps = {
  /** When false the well stays mounted but no stream is requested (status "off"). */
  active: boolean;
  /** Injectable getUserMedia — tests drive the denial path without a camera. */
  getMedia?: GetMediaFn;
  facingMode?: 'user';
  /** External ref to the mirrored <video>; the frame-grab target for capture. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  className?: string;
};

export type CameraStatusNoticeProps = {
  status: CameraStatus;
  /** Real getUserMedia failure message for status "error" — never invented. */
  message?: string;
  onRetry?: () => void;
};

const NOTICE_STATUSES: ReadonlySet<CameraStatus> = new Set([
  'starting',
  'denied',
  'no-device',
  'error',
]);

/**
 * Presentational status layer (status → exact copy). Pure, so node-env tests
 * can render the denial path with renderToStaticMarkup — no jsdom required.
 */
export function CameraStatusNotice({
  status,
  message,
  onRetry,
}: CameraStatusNoticeProps): ReactElement | null {
  const action = onRetry ? (
    <Button variant="secondary" onClick={onRetry}>
      Retry
    </Button>
  ) : undefined;

  switch (status) {
    case 'denied':
      return (
        <EmptyState
          icon={Lock}
          title="Camera access denied"
          body={CAMERA_REMEDY}
          action={action}
          className={styles.card}
        />
      );
    case 'no-device':
      return (
        <EmptyState
          icon={Camera}
          title="No camera found"
          body={CAMERA_REMEDY}
          action={action}
          className={styles.card}
        />
      );
    case 'error':
      return (
        <EmptyState
          icon={AlertTriangle}
          title="Camera unavailable"
          body={message ?? 'The camera could not be started.'}
          action={action}
          className={styles.card}
        />
      );
    case 'starting':
      return <p className={styles.startingNote}>Starting camera…</p>;
    case 'live':
    case 'off':
    default:
      return null;
  }
}

export function CameraPreview({
  active,
  getMedia,
  facingMode = 'user',
  videoRef,
  className,
}: CameraPreviewProps): ReactElement {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const getMediaRef = useRef<GetMediaFn>(getMedia ?? defaultGetMedia);
  const [status, setStatus] = useState<CameraStatus>('off');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  // Keep the latest injected backend without re-running the request effect
  // (an inline getMedia prop would otherwise re-trigger it every render).
  useEffect(() => {
    getMediaRef.current = getMedia ?? defaultGetMedia;
  }, [getMedia]);

  useEffect(() => {
    if (!active) {
      setStatus('off');
      return;
    }
    let cancelled = false;
    setStatus('starting');
    void requestCamera(getMediaRef.current, facingMode).then((result) => {
      if (cancelled) {
        if (result.status === 'live') stopCameraStream(result.stream);
        return;
      }
      if (result.status === 'live') {
        streamRef.current = result.stream;
        const video = videoRef?.current ?? internalVideoRef.current;
        if (video) video.srcObject = result.stream;
        setMessage(undefined);
        setStatus('live');
        return;
      }
      setMessage(result.message);
      setStatus(result.status);
    });
    return () => {
      cancelled = true;
      stopCameraStream(streamRef.current);
      streamRef.current = null;
      const video = videoRef?.current ?? internalVideoRef.current;
      if (video) video.srcObject = null;
    };
    // Retry bumps `attempt`; the synced getMedia ref is not a dependency.
  }, [active, attempt, facingMode, videoRef]);

  function handleRetry(): void {
    setAttempt((n) => n + 1);
  }

  function setVideoRefs(node: HTMLVideoElement | null): void {
    internalVideoRef.current = node;
    if (videoRef) videoRef.current = node;
  }

  return (
    <div
      className={[styles.preview, className].filter(Boolean).join(' ')}
      data-testid="camera-preview"
      data-status={status}
      role="group"
      aria-label="Camera preview"
    >
      <div className={styles.well}>
        <video
          ref={setVideoRefs}
          className={styles.video}
          autoPlay
          muted
          playsInline
          data-testid="camera-video"
        />
        {NOTICE_STATUSES.has(status) ? (
          <div className={styles.overlay} data-testid={`camera-${status}`} role="status">
            <CameraStatusNotice status={status} message={message} onRetry={handleRetry} />
          </div>
        ) : null}
        {/* Corner brackets last in the tree so they sit above video + overlay. */}
        <span className={`${styles.bracket} ${styles.bracketTL}`} aria-hidden="true" />
        <span className={`${styles.bracket} ${styles.bracketTR}`} aria-hidden="true" />
        <span className={`${styles.bracket} ${styles.bracketBL}`} aria-hidden="true" />
        <span className={`${styles.bracket} ${styles.bracketBR}`} aria-hidden="true" />
      </div>
    </div>
  );
}
