import type { CoverageFrame } from '../../lib/scan/scene3d';
import type { StagedImage } from '../../state/types';

/**
 * V1 bridge from staged images to coverage frames (T22).
 *
 * HONESTY (§3.2): T21's phone frames are measured photographs that carry no
 * pose — `StagedImage` has no pose field and the pairing protocol has no pose
 * message. So every staged frame maps to a grid-plane marker, never a faked
 * frustum. A frustum is only built for a frame that supplies a real pose
 * (see `framesFromPoses` for the T14 camera-pose path).
 *
 * Pure and DOM-free so it unit-tests in node.
 */
export function coverageFramesFromStagedImages(
  images: readonly StagedImage[],
): CoverageFrame[] {
  return images.map((image) => ({
    id: image.id,
    label: image.meta.source === 'phone' ? 'PHONE · MEASURED' : 'OPERATOR · MEASURED',
    pose: null,
  }));
}
