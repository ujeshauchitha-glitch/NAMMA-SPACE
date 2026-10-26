// Camera access + honest failure classification (T21 / design §6 phone capture).
// Kept out of the component so the denial path is unit-testable with an
// injected getUserMedia mock — vitest runs in the node environment.

/** Lifecycle of the camera preview. `error` always carries a real message. */
export type CameraStatus = 'off' | 'starting' | 'live' | 'denied' | 'no-device' | 'error';

/** Exact remedy copy for BOTH the permission-denied and no-device empty states (design handoff). */
export const CAMERA_REMEDY = 'Allow camera access in the address bar, then retry';

export type GetMediaFn = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export type CameraRequestResult =
  | { status: 'live'; stream: MediaStream }
  | { status: 'denied' | 'no-device' | 'error'; message: string };

const DENIED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'NotAllowedError',
  'PermissionDeniedError',
  'SecurityError',
]);

const NO_DEVICE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'NotFoundError',
  'DevicesNotFoundError',
  'OverconstrainedError',
]);

const UNKNOWN_CAMERA_MESSAGE = 'The camera could not be started for an unknown reason.';

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown };
    return typeof name === 'string' ? name : '';
  }
  return '';
}

/** Real failure text when the browser provided one; never invents a cause. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return UNKNOWN_CAMERA_MESSAGE;
}

/** Map a getUserMedia rejection to an honest state. */
export function classifyMediaError(error: unknown): 'denied' | 'no-device' | 'error' {
  const name = errorName(error);
  if (DENIED_ERROR_NAMES.has(name)) return 'denied';
  if (NO_DEVICE_ERROR_NAMES.has(name)) return 'no-device';
  return 'error';
}

/** Request a camera stream; the only side effect is calling `getMedia`. */
export async function requestCamera(
  getMedia: GetMediaFn,
  facingMode: 'user' = 'user',
): Promise<CameraRequestResult> {
  try {
    const stream = await getMedia({ video: { facingMode }, audio: false });
    return { status: 'live', stream };
  } catch (error) {
    return { status: classifyMediaError(error), message: errorMessage(error) };
  }
}

/**
 * Default capture backend. Rejects honestly when `navigator.mediaDevices` is
 * missing (unsupported or non-secure browser context) — the secure-context UX
 * gate lives in LiveScan, so no remedy copy is duplicated here.
 */
export const defaultGetMedia: GetMediaFn = (constraints) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('This browser context does not expose camera capture.'));
  }
  return navigator.mediaDevices.getUserMedia(constraints);
};

/** Stop every track of a live stream (idempotent, null-safe). */
export function stopCameraStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}
