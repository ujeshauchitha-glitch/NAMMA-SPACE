/**
 * Workspace bootstrap (T12) — first-run seeding of the durable T9 state.
 *
 * A fresh browser (no saved snapshot) must open on a usable capture studio:
 * one space, one room, and that room's 8 §5.5 preset view groups. The
 * sequence is dispatched exactly once per mount (ref-guarded so StrictMode's
 * double effect cannot seed duplicates) and is always superseded by a saved
 * snapshot when hydration lands afterwards (state/hydrate replaces state).
 *
 * Preset group names come from `ViewGroupChip` (T7) — one source of truth
 * shared with the chip bar and its contract test.
 */
import { useEffect, useRef } from 'react';
import { PRESET_VIEW_GROUPS } from '../components/capture/ViewGroupChip';
import type { Metres3, RoomId, SpaceId, WorkspaceAction } from './types';
import { useWorkspaceStore } from './workspaceContext';

/** Default interior dimensions for a new room: W × D × H in metres. */
export const DEFAULT_ROOM_DIMENSIONS_M: Metres3 = { x: 6, y: 4, z: 3 };

/**
 * Entity ids are injected by the caller (the reducer itself never generates
 * ids — same determinism rule as timestamps).
 */
export function createEntityId(prefix: string): string {
  const webcrypto = globalThis.crypto;
  if (typeof webcrypto?.randomUUID === 'function') return `${prefix}-${webcrypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create the 8 preset view groups scoped to one room (§5.5 order). */
export function presetGroupCreateActions(
  spaceId: SpaceId,
  roomId: RoomId,
  at: number,
): WorkspaceAction[] {
  return PRESET_VIEW_GROUPS.map((name) => ({
    type: 'viewGroup/create' as const,
    id: createEntityId('vg'),
    spaceId,
    roomId,
    name,
    at,
  }));
}

export function useWorkspaceBootstrap(): void {
  const { state, dispatch, hydrated } = useWorkspaceStore();
  const started = useRef(false);

  useEffect(() => {
    // Wait for the durable snapshot: a saved workspace needs no seed, and a
    // fresh one is seeded exactly once (StrictMode's ref survives the double
    // effect, so the second run returns early).
    if (!hydrated || started.current || state.spaces.length > 0) return;
    started.current = true;

    const at = Date.now();
    const spaceId = createEntityId('space');
    const roomId = createEntityId('room');
    dispatch({ type: 'space/create', id: spaceId, name: 'Untitled space', at });
    dispatch({
      type: 'room/create',
      id: roomId,
      spaceId,
      name: 'Room 01',
      dimensionsM: DEFAULT_ROOM_DIMENSIONS_M,
      at,
    });
    for (const action of presetGroupCreateActions(spaceId, roomId, at)) dispatch(action);
    dispatch({ type: 'scene/select', selection: { kind: 'room', roomId } });
  }, [hydrated, state.spaces.length, dispatch]);
}
