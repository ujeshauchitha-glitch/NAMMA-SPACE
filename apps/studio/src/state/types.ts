import type { ToastMessage } from '../components/ui/Toast';

/**
 * Domain state kernel (T9). The reducer in reducer.ts is the source of truth
 * for how these shapes evolve; every UI state name is schema-anchored (§9.2):
 * pairing uses exactly the canonical machine states, never synonyms.
 *
 * Timestamps are numbers injected via actions (never Date.now() inside the
 * reducer) so the state machine is deterministic and testable under
 * deep-frozen state.
 */

export type SpaceId = string;
export type RoomId = string;
export type ViewGroupId = string;
export type ImageId = string;
export type SceneUrl = string;

/**
 * Workspace-state vector in metres. The state kernel uses the object form;
 * the scene/engine domain uses tuple `Vec3` from `src/types/scene.ts` and
 * converts at the boundary (never silently reinterpreted).
 */
export type Metres3 = { x: number; y: number; z: number };

export type Space = {
  seq: number;
  id: SpaceId;
  name: string;
  createdAt: number;
};

export type Room = {
  seq: number;
  id: RoomId;
  spaceId: SpaceId;
  name: string;
  /** Interior dimensions in metres; drives honest scale (§6). */
  dimensionsM: Metres3;
  originM: Metres3;
  createdAt: number;
};

export type ViewGroup = {
  seq: number;
  id: ViewGroupId;
  spaceId: SpaceId;
  /** null = space-wide group not yet scoped to a room. */
  roomId: RoomId | null;
  name: string;
  createdAt: number;
};

/** Where a staged frame came from — provenance travels with the data (§5.14). */
export type ImageSource = 'operator' | 'phone';

/** Blob-free image metadata; the bytes live behind the storage module (T10). */
export type ImageMeta = {
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  source: ImageSource;
};

export type StagedImage = {
  seq: number;
  id: ImageId;
  /** null = staged but not yet assigned to a view group. */
  viewGroupId: ViewGroupId | null;
  /** Runtime-only blob URL; stripped from persisted snapshots. */
  objectUrl: string;
  meta: ImageMeta;
  stagedAt: number;
};

export type CameraPose = {
  id: string;
  label: string;
  position: Metres3;
  target: Metres3;
  /** Yaw captured at save time so re-entry can restore the exact view (T14). */
  yawDegrees?: number;
  /** Pitch captured at save time for the same exact-view restore (T14). */
  pitchDegrees?: number;
};

/** §9.2 canonical pairing machine states — nothing else exists. */
export const PAIRING_STATES = [
  'IDLE',
  'PAIRING',
  'LIVE',
  'CAPTURING',
  'STAGED',
  'OFFLINE',
  'ERROR',
] as const;

export type PairingState = (typeof PAIRING_STATES)[number];

export type PairingStatus = {
  state: PairingState;
  deviceId?: string;
  /** Scan progress 0..1 while PAIRING. */
  progress?: number;
  /** Honest failure/transition reason surfaced to the operator. */
  reason?: string;
  updatedAt: number;
};

export type SceneSelection =
  | { kind: 'empty' }
  | { kind: 'space'; spaceId: SpaceId }
  | { kind: 'room'; roomId: RoomId }
  | { kind: 'viewGroup'; viewGroupId: ViewGroupId };

export type WorkspaceState = {
  spaces: Space[];
  rooms: Room[];
  viewGroups: ViewGroup[];
  stagedImages: StagedImage[];
  sceneSelection: SceneSelection;
  cameraPoses: CameraPose[];
  pairing: PairingStatus;
  toasts: ToastMessage[];
};

export type WorkspaceAction =
  | { type: 'space/create'; id: SpaceId; name: string; at: number }
  | { type: 'space/rename'; id: SpaceId; name: string }
  | { type: 'space/select'; id: SpaceId }
  | { type: 'space/open'; id: SpaceId }
  | { type: 'room/create'; id: RoomId; spaceId: SpaceId; name: string; dimensionsM: Metres3; originM?: Metres3; at: number }
  | { type: 'room/rename'; id: RoomId; name: string }
  | { type: 'room/delete'; id: RoomId; confirmName?: string }
  | { type: 'viewGroup/create'; id: ViewGroupId; spaceId: SpaceId; roomId: RoomId | null; name: string; at: number }
  | { type: 'viewGroup/rename'; id: ViewGroupId; name: string }
  | { type: 'viewGroup/delete'; id: ViewGroupId; confirmName?: string }
  | { type: 'viewGroup/assignRoom'; viewGroupId: ViewGroupId; roomId: RoomId }
  | { type: 'viewGroup/unassignRoom'; viewGroupId: ViewGroupId }
  | { type: 'image/stage'; id: ImageId; viewGroupId: ViewGroupId | null; objectUrl: string; meta: ImageMeta; at: number }
  | { type: 'image/assign'; imageId: ImageId; viewGroupId: ViewGroupId }
  | { type: 'image/unassign'; imageId: ImageId }
  | { type: 'image/remove'; imageId: ImageId }
  | { type: 'image/restoreObjectUrl'; imageId: ImageId; objectUrl: string }
  | { type: 'scene/select'; selection: SceneSelection }
  | { type: 'scene/clear' }
  | { type: 'camera/setPose'; id: string; label: string; position: Metres3; target: Metres3 }
  | { type: 'camera/upsertPose'; id: string; label: string; position: Metres3; target: Metres3; yawDegrees: number; pitchDegrees?: number }
  | { type: 'camera/removePose'; id: string }
  | { type: 'pairing/transition'; to: PairingState; at: number }
  | { type: 'pairing/progress'; progress: number }
  | { type: 'pairing/established'; deviceId: string; at: number }
  | { type: 'pairing/deviceLost'; at: number }
  | { type: 'toast/push'; toast: ToastMessage }
  | { type: 'toast/dismiss'; id: string }
  | { type: 'state/hydrate'; state: WorkspaceState };
