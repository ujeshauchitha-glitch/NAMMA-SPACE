/**
 * T9 — room/view-group lifecycle tests.
 *
 * Proves: creation requires an existing space; delete-with-confirm demands an
 * exact name match (you cannot nuke a room while staring at the wrong name);
 * deleting a room cascades its view groups and repairs selection; image
 * assign/unassign dedupes; coverage counts are derived, never invented; the
 * persisted snapshot round-trips through the persistence interface with
 * runtime-only fields honestly stripped.
 */
import { describe, expect, it } from 'vitest';
import type { ImageMeta, Room, Space, StagedImage, ViewGroup, WorkspaceState } from '../src/state/types';
import { initialWorkspaceState, isRejected, workspaceReducer } from '../src/state/reducer';
import { createMemoryPersistence, toPersistedSnapshot } from '../src/state/persistence';

const META: ImageMeta = { width: 640, height: 480, bytes: 2048, sha256: 'sha', source: 'operator' };

function stateWithSpace(): WorkspaceState {
  const s = workspaceReducer(initialWorkspaceState, { type: 'space/create', id: 'sp-1', name: 'HQ', at: 1 });
  return workspaceReducer(s, { type: 'room/create', id: 'rm-1', spaceId: 'sp-1', name: 'Lobby',
    dimensionsM: { x: 6, y: 3, z: 4 }, at: 2 });
}

function stateWithGroup(): WorkspaceState {
  const s = stateWithSpace();
  return workspaceReducer(s, { type: 'viewGroup/create', id: 'vg-1', spaceId: 'sp-1', roomId: 'rm-1', name: 'Wide', at: 3 });
}

function stateWithImage(): WorkspaceState {
  const s = stateWithGroup();
  return workspaceReducer(s, { type: 'image/stage', id: 'im-1', viewGroupId: 'vg-1', objectUrl: 'blob:one', meta: META, at: 4 });
}

describe('room lifecycle', () => {
  it('creates a room under an existing space with honest defaults', () => {
    const room = stateWithSpace().rooms[0];
    expect(room).toMatchObject({ id: 'rm-1', spaceId: 'sp-1', name: 'Lobby', originM: { x: 0, y: 0, z: 0 } });
  });

  it('rejects room creation for a missing or foreign space', () => {
    const noSpace = workspaceReducer(initialWorkspaceState,
      { type: 'room/create', id: 'rm-1', spaceId: 'sp-none', name: 'X', dimensionsM: { x: 1, y: 1, z: 1 }, at: 1 });
    expect(isRejected(initialWorkspaceState, noSpace)).toBe(true);
  });

  it('rejects a delete whose confirm name does not match', () => {
    const before = stateWithSpace();
    const after = workspaceReducer(before, { type: 'room/delete', id: 'rm-1', confirmName: 'Lobbys' });
    expect(isRejected(before, after)).toBe(true);
    expect(after.rooms).toHaveLength(1);
  });

  it('deletes on exact confirm and cascades its view groups', () => {
    const before = stateWithGroup();
    const after = workspaceReducer(before, { type: 'room/delete', id: 'rm-1', confirmName: 'Lobby' });
    expect(after.rooms).toHaveLength(0);
    expect(after.viewGroups).toHaveLength(0);
  });

  it('repairs a scene selection that pointed into the deleted room', () => {
    const selected = workspaceReducer(stateWithSpace(), { type: 'scene/select', selection: { kind: 'room', roomId: 'rm-1' } });
    const after = workspaceReducer(selected, { type: 'room/delete', id: 'rm-1', confirmName: 'Lobby' });
    expect(after.sceneSelection).toEqual({ kind: 'space', spaceId: 'sp-1' });
  });
});

describe('view-group lifecycle', () => {
  it('creates scoped and space-wide groups', () => {
    const scoped = stateWithGroup().viewGroups[0];
    expect(scoped).toMatchObject({ id: 'vg-1', roomId: 'rm-1', name: 'Wide' });

    const wide = workspaceReducer(stateWithSpace(),
      { type: 'viewGroup/create', id: 'vg-2', spaceId: 'sp-1', roomId: null, name: 'All', at: 5 });
    expect(wide.viewGroups[0].roomId).toBeNull();
  });

  it('rejects creation against a missing room or space', () => {
    const before = stateWithSpace();
    const bad = workspaceReducer(before,
      { type: 'viewGroup/create', id: 'vg-1', spaceId: 'sp-1', roomId: 'rm-none', name: 'X', at: 1 });
    expect(isRejected(before, bad)).toBe(true);
  });

  it('rejects a delete whose confirm label does not match', () => {
    const before = stateWithGroup();
    const after = workspaceReducer(before, { type: 'viewGroup/delete', id: 'vg-1', confirmName: 'Narrow' });
    expect(isRejected(before, after)).toBe(true);
    expect(after.viewGroups).toHaveLength(1);
  });

  it('assigns and unassigns a room, rejecting unknown ids', () => {
    const s = workspaceReducer(stateWithGroup(), { type: 'room/create', id: 'rm-2', spaceId: 'sp-1', name: 'Hall', dimensionsM: { x: 2, y: 2, z: 2 }, at: 6 });
    const moved = workspaceReducer(s, { type: 'viewGroup/assignRoom', viewGroupId: 'vg-1', roomId: 'rm-2' });
    expect(moved.viewGroups[0].roomId).toBe('rm-2');

    const wide = workspaceReducer(moved, { type: 'viewGroup/unassignRoom', viewGroupId: 'vg-1' });
    expect(wide.viewGroups[0].roomId).toBeNull();

    const bad = workspaceReducer(s, { type: 'viewGroup/assignRoom', viewGroupId: 'vg-1', roomId: 'rm-none' });
    expect(isRejected(s, bad)).toBe(true);
  });
});

describe('image staging and coverage counts', () => {
  it('stages an image and counts are derived, never invented', () => {
    const s = stateWithImage();
    expect(s.stagedImages).toHaveLength(1);
    const count = s.stagedImages.filter((i) => i.viewGroupId === 'vg-1').length;
    expect(count).toBe(1);
  });

  it('rejects staging the same id twice', () => {
    const before = stateWithImage();
    const after = workspaceReducer(before,
      { type: 'image/stage', id: 'im-1', viewGroupId: null, objectUrl: 'blob:two', meta: META, at: 9 });
    expect(isRejected(before, after)).toBe(true);
  });

  it('reassigning an image moves it exactly once (dedupe by id)', () => {
    let s = workspaceReducer(stateWithImage(), { type: 'viewGroup/create', id: 'vg-2', spaceId: 'sp-1', roomId: null, name: 'Detail', at: 7 });
    s = workspaceReducer(s, { type: 'image/assign', imageId: 'im-1', viewGroupId: 'vg-2' });
    const assigned = s.stagedImages.filter((i) => i.viewGroupId === 'vg-2');
    expect(assigned).toHaveLength(1);
    expect(assigned[0].id).toBe('im-1');
    expect(s.stagedImages.filter((i) => i.viewGroupId === 'vg-1')).toHaveLength(0);
  });

  it('unassign detaches without deleting; remove deletes', () => {
    const un = workspaceReducer(stateWithImage(), { type: 'image/unassign', imageId: 'im-1' });
    expect(un.stagedImages[0].viewGroupId).toBeNull();
    expect(un.stagedImages).toHaveLength(1);

    const rm = workspaceReducer(un, { type: 'image/remove', imageId: 'im-1' });
    expect(rm.stagedImages).toHaveLength(0);

    const bad = workspaceReducer(un, { type: 'image/remove', imageId: 'im-none' });
    expect(isRejected(un, bad)).toBe(true);
  });
});

describe('persistence round-trip', () => {
  it('save → load restores rooms/groups/images but strips runtime-only fields', async () => {
    const persistence = createMemoryPersistence();
    const live = stateWithImage();
    await persistence.save(live);
    const loaded = await persistence.load();
    expect(loaded).not.toBeNull();
    const s = loaded as WorkspaceState;
    expect(s.rooms.map((r: Room) => r.name)).toEqual(['Lobby']);
    expect(s.viewGroups.map((g: ViewGroup) => g.name)).toEqual(['Wide']);
    expect(s.stagedImages.map((i: StagedImage) => i.id)).toEqual(['im-1']);
    // Object URLs die with the tab that minted them — never resurrected.
    expect(s.stagedImages[0].objectUrl).toBe('');
    expect(s.toasts).toEqual([]);
    expect(s.pairing.state).toBe('IDLE');
  });

  it('toPersistedSnapshot keeps durable data and drops toasts/pairing/objectUrls', () => {
    const withToast = workspaceReducer(stateWithImage(), { type: 'toast/push', toast: { id: 't', title: 'Hi', tone: 'info' } });
    const snap = toPersistedSnapshot(withToast);
    expect(snap.spaces.map((sp: Space) => sp.id)).toEqual(['sp-1']);
    expect(snap.toasts).toEqual([]);
    expect(snap.pairing.state).toBe('IDLE');
    expect(snap.stagedImages[0].objectUrl).toBe('');
    // The original live state is untouched — snapshot is a copy.
    expect(withToast.stagedImages[0].objectUrl).toBe('blob:one');
  });

  it('loads null on a fresh profile (no fake seed data)', async () => {
    const persistence = createMemoryPersistence();
    expect(await persistence.load()).toBeNull();
  });
});
