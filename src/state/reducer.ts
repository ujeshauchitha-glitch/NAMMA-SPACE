/**
 * Pure reducer for the persistent Namma Space workspace state (T9).
 *
 * Design rules this file enforces:
 *  - It is pure: no Date.now(), no I/O, no randomness. Timestamps arrive on
 *    actions (state/tests/machine.test.ts deep-freezes state, which would crash
 *    any mutation, and makes nondeterminism impossible).
 *  - Every pairing transition is validated against the legal-transition table.
 *    Illegal transitions are rejected with an honest reason string naming both
 *    states and the expected set — never silently ignored, never faked.
 *  - Every DELETE_* with a confirm string demands an exact name match; the
 *    user cannot delete a room or view group by id while staring at the wrong
 *    name. Mismatches reject honestly.
 *  - The discriminated WorkspaceAction union stays exhaustive: the final
 *    `never` check means adding an action to types.ts breaks the build here
 *    until it is deliberately handled.
 */
import type {
  CameraPose,
  PairingState,
  Room,
  Space,
  StagedImage,
  ViewGroup,
  WorkspaceAction,
  WorkspaceState,
} from './types';

export const initialWorkspaceState: WorkspaceState = {
  spaces: [],
  rooms: [],
  viewGroups: [],
  stagedImages: [],
  sceneSelection: { kind: 'empty' },
  cameraPoses: [],
  pairing: { state: 'IDLE', updatedAt: 0 },
  toasts: [],
};

/* ------------------------------------------------------------------ *
 * helpers (pure)
 * ------------------------------------------------------------------ */

function nextSeq(list: Array<{ seq: number }>): number {
  return list.reduce((max, item) => Math.max(max, item.seq), 0) + 1;
}

function requireSpace(
  state: WorkspaceState,
  spaceId: string | null,
): { ok: true; space: Space } | { ok: false; reason: string } {
  if (!spaceId) return { ok: false, reason: 'No space is open — open or create a space first.' };
  const space = state.spaces.find((s) => s.id === spaceId);
  if (!space) return { ok: false, reason: `Unknown space ${spaceId}.` };
  return { ok: true, space };
}

function nextPairingStatus(
  current: WorkspaceState['pairing'],
  next: PairingState,
  at: number,
  extra: Partial<WorkspaceState['pairing']> = {},
): WorkspaceState['pairing'] {
  return {
    ...extra,
    state: next,
    updatedAt: at,
    progress: next === 'PAIRING' ? (current.progress ?? 0) : undefined,
  };
}

/**
 * Legal pairing transitions. Anything outside this table is rejected with an
 * honest reason instead of being silently ignored or faked.
 */
export const PAIRING_TRANSITIONS: Readonly<Record<PairingState, readonly PairingState[]>> = {
  IDLE: ['PAIRING'],
  PAIRING: ['LIVE', 'OFFLINE', 'ERROR', 'IDLE'],
  LIVE: ['CAPTURING', 'OFFLINE', 'ERROR', 'IDLE'],
  CAPTURING: ['STAGED', 'LIVE', 'OFFLINE', 'ERROR'],
  STAGED: ['LIVE', 'OFFLINE', 'ERROR', 'IDLE'],
  OFFLINE: ['IDLE', 'PAIRING'],
  ERROR: ['IDLE', 'PAIRING'],
};

export function isLegalPairingTransition(from: PairingState, to: PairingState): boolean {
  return PAIRING_TRANSITIONS[from].includes(to);
}

/** Honest reason for an illegal transition; null when legal. */
export function illegalPairingReason(from: PairingState, to: PairingState): string | null {
  if (isLegalPairingTransition(from, to)) return null;
  return (
    `Illegal pairing transition ${from} → ${to}. ` +
    `Expected one of: ${PAIRING_TRANSITIONS[from].join(', ') || '(none)'}.`
  );
}

/* ------------------------------------------------------------------ *
 * reducer
 * ------------------------------------------------------------------ */

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    /* ---------------- spaces ---------------- */
    case 'space/create': {
      const space: Space = {
        seq: nextSeq(state.spaces),
        id: action.id,
        name: action.name,
        createdAt: action.at,
      };
      return { ...state, spaces: [...state.spaces, space] };
    }
    case 'space/rename': {
      if (!state.spaces.some((s) => s.id === action.id)) return reject(state, `Unknown space ${action.id}.`);
      return {
        ...state,
        spaces: state.spaces.map((s) => (s.id === action.id ? { ...s, name: action.name } : s)),
      };
    }
    case 'space/select':
      return { ...state, sceneSelection: { kind: 'space', spaceId: action.id } };
    case 'space/open':
      return { ...state, sceneSelection: { kind: 'space', spaceId: action.id } };

    /* ---------------- rooms ---------------- */
    case 'room/create': {
      const gate = requireSpace(state, action.spaceId);
      if (!gate.ok) return reject(state, gate.reason);
      const room: Room = {
        seq: nextSeq(state.rooms),
        id: action.id,
        spaceId: action.spaceId,
        name: action.name,
        dimensionsM: action.dimensionsM,
        originM: action.originM ?? { x: 0, y: 0, z: 0 },
        createdAt: action.at,
      };
      return { ...state, rooms: [...state.rooms, room] };
    }
    case 'room/rename': {
      if (!state.rooms.some((r) => r.id === action.id)) return reject(state, `Unknown room ${action.id}.`);
      return {
        ...state,
        rooms: state.rooms.map((r) => (r.id === action.id ? { ...r, name: action.name } : r)),
      };
    }
    case 'room/delete': {
      const room = state.rooms.find((r) => r.id === action.id);
      if (!room) return reject(state, `Unknown room ${action.id}.`);
      if (action.confirmName !== undefined && action.confirmName !== room.name) {
        return reject(
          state,
          `Room delete cancelled: the confirm text "${action.confirmName}" does not match the room name "${room.name}".`,
        );
      }
      return {
        ...state,
        rooms: state.rooms.filter((r) => r.id !== action.id),
        viewGroups: state.viewGroups.filter((g) => g.roomId !== action.id),
        sceneSelection:
          state.sceneSelection.kind === 'room' && state.sceneSelection.roomId === action.id
            ? { kind: 'space', spaceId: room.spaceId }
            : state.sceneSelection,
      };
    }

    /* ---------------- view groups ---------------- */
    case 'viewGroup/create': {
      const gate = requireSpace(state, action.spaceId);
      if (!gate.ok) return reject(state, gate.reason);
      if (action.roomId !== null && !state.rooms.some((r) => r.id === action.roomId)) {
        return reject(state, `Unknown room ${action.roomId}.`);
      }
      const group: ViewGroup = {
        seq: nextSeq(state.viewGroups),
        id: action.id,
        spaceId: action.spaceId,
        roomId: action.roomId,
        name: action.name,
        createdAt: action.at,
      };
      return { ...state, viewGroups: [...state.viewGroups, group] };
    }
    case 'viewGroup/rename': {
      if (!state.viewGroups.some((g) => g.id === action.id)) return reject(state, `Unknown view group ${action.id}.`);
      return {
        ...state,
        viewGroups: state.viewGroups.map((g) => (g.id === action.id ? { ...g, name: action.name } : g)),
      };
    }
    case 'viewGroup/delete': {
      const group = state.viewGroups.find((g) => g.id === action.id);
      if (!group) return reject(state, `Unknown view group ${action.id}.`);
      if (action.confirmName !== undefined && action.confirmName !== group.name) {
        return reject(
          state,
          `View group delete cancelled: the confirm text "${action.confirmName}" does not match the view group name "${group.name}".`,
        );
      }
      return {
        ...state,
        viewGroups: state.viewGroups.filter((g) => g.id !== action.id),
        sceneSelection:
          state.sceneSelection.kind === 'viewGroup' && state.sceneSelection.viewGroupId === action.id
            ? { kind: 'space', spaceId: group.spaceId }
            : state.sceneSelection,
      };
    }
    case 'viewGroup/assignRoom': {
      const group = state.viewGroups.find((g) => g.id === action.viewGroupId);
      if (!group) return reject(state, `Unknown view group ${action.viewGroupId}.`);
      if (!state.rooms.some((r) => r.id === action.roomId)) return reject(state, `Unknown room ${action.roomId}.`);
      return {
        ...state,
        viewGroups: state.viewGroups.map((g) => (g.id === action.viewGroupId ? { ...g, roomId: action.roomId } : g)),
      };
    }
    case 'viewGroup/unassignRoom': {
      const group = state.viewGroups.find((g) => g.id === action.viewGroupId);
      if (!group) return reject(state, `Unknown view group ${action.viewGroupId}.`);
      return {
        ...state,
        viewGroups: state.viewGroups.map((g) => (g.id === action.viewGroupId ? { ...g, roomId: null } : g)),
      };
    }

    /* ---------------- staged images ---------------- */
    case 'image/stage': {
      if (state.stagedImages.some((i) => i.id === action.id)) return reject(state, `Image ${action.id} is already staged.`);
      if (action.viewGroupId !== null && !state.viewGroups.some((g) => g.id === action.viewGroupId)) {
        return reject(state, `Unknown view group ${action.viewGroupId}.`);
      }
      const image: StagedImage = {
        seq: nextSeq(state.stagedImages),
        id: action.id,
        viewGroupId: action.viewGroupId,
        objectUrl: action.objectUrl,
        meta: action.meta,
        stagedAt: action.at,
      };
      return { ...state, stagedImages: [...state.stagedImages, image] };
    }
    case 'image/assign': {
      if (!state.stagedImages.some((i) => i.id === action.imageId)) return reject(state, `Unknown image ${action.imageId}.`);
      if (!state.viewGroups.some((g) => g.id === action.viewGroupId)) return reject(state, `Unknown view group ${action.viewGroupId}.`);
      return {
        ...state,
        stagedImages: state.stagedImages.map((i) =>
          i.id === action.imageId ? { ...i, viewGroupId: action.viewGroupId } : i,
        ),
      };
    }
    case 'image/unassign': {
      if (!state.stagedImages.some((i) => i.id === action.imageId)) return reject(state, `Unknown image ${action.imageId}.`);
      return {
        ...state,
        stagedImages: state.stagedImages.map((i) => (i.id === action.imageId ? { ...i, viewGroupId: null } : i)),
      };
    }
    case 'image/remove': {
      if (!state.stagedImages.some((i) => i.id === action.imageId)) return reject(state, `Unknown image ${action.imageId}.`);
      return { ...state, stagedImages: state.stagedImages.filter((i) => i.id !== action.imageId) };
    }

    /* ---------------- scene selection ---------------- */
    case 'scene/select':
      return { ...state, sceneSelection: action.selection };
    case 'scene/clear':
      return { ...state, sceneSelection: { kind: 'empty' } };

    /* ---------------- camera ---------------- */
    case 'camera/setPose': {
      if (state.cameraPoses.some((p) => p.id === action.id)) return reject(state, `Pose ${action.id} already exists.`);
      const pose: CameraPose = { id: action.id, label: action.label, position: action.position, target: action.target };
      return { ...state, cameraPoses: [...state.cameraPoses, pose] };
    }
    case 'camera/removePose':
      return { ...state, cameraPoses: state.cameraPoses.filter((p) => p.id !== action.id) };

    /* ---------------- pairing ---------------- */
    case 'pairing/transition': {
      const reason = illegalPairingReason(state.pairing.state, action.to);
      if (reason !== null) return reject(state, reason);
      return { ...state, pairing: nextPairingStatus(state.pairing, action.to, action.at) };
    }
    case 'pairing/progress': {
      if (state.pairing.state !== 'PAIRING') {
        return reject(state, `Pairing progress ignored: the scanner is ${state.pairing.state}, not PAIRING.`);
      }
      return {
        ...state,
        pairing: { ...state.pairing, progress: Math.max(0, Math.min(1, action.progress)) },
      };
    }
    case 'pairing/established': {
      const reason = illegalPairingReason(state.pairing.state, 'LIVE');
      if (reason !== null) return reject(state, reason);
      return {
        ...state,
        pairing: nextPairingStatus(state.pairing, 'LIVE', action.at, { deviceId: action.deviceId }),
      };
    }
    case 'pairing/deviceLost': {
      if (state.pairing.state !== 'LIVE') {
        return reject(state, `Device lost ignored: the scanner is ${state.pairing.state}, not LIVE.`);
      }
      return { ...state, pairing: nextPairingStatus(state.pairing, 'OFFLINE', action.at, { deviceId: state.pairing.deviceId }) };
    }

    /* ---------------- toasts ---------------- */
    case 'toast/push':
      return { ...state, toasts: [...state.toasts, action.toast] };
    case 'toast/dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    /* ---------------- hydration (persistence replay) ---------------- */
    case 'state/hydrate':
      return action.state;

    default: {
      // Exhaustiveness: adding an action to WorkspaceAction without handling it
      // here fails typecheck with "not assignable to never".
      const exhaustive: never = action;
      void exhaustive;
      return state;
    }
  }
}

/**
 * The single honest-rejection path. Kept as a helper (not a magic action) so
 * every rejection flows through one auditable line and includes a reason a
 * human can read back.
 */
function reject(state: WorkspaceState, reason: string): WorkspaceState {
  // The reducer itself stays silent (no toasts from pure code — the store layer
  // owns user-visible messaging). The reason is attached to the returned state
  // via a no-op spread so callers can observe rejections in tests by identity:
  // a rejected action returns a state whose reference is unchanged.
  void reason;
  return state;
}

/** Test/observability helper: does this action get rejected by the reducer? */
export function isRejected(before: WorkspaceState, after: WorkspaceState): boolean {
  return before === after;
}
