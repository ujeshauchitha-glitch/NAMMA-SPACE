/**
 * T9 — pairing state machine tests.
 *
 * Proves: exactly the 7 schema-anchored states exist; every legal transition
 * in the table succeeds; every illegal transition is rejected with an honest
 * reason naming both states and the expected set; the reducer is pure (runs
 * against deep-frozen state and injected timestamps).
 */
import { describe, expect, it } from 'vitest';
import { PAIRING_STATES } from '../src/state/types';
import type { PairingState, WorkspaceAction, WorkspaceState } from '../src/state/types';
import {
  PAIRING_TRANSITIONS,
  illegalPairingReason,
  initialWorkspaceState,
  isRejected,
  workspaceReducer,
} from '../src/state/reducer';

/** Deep-freeze so any accidental mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function frozenInitial(): WorkspaceState {
  return deepFreeze(structuredClone(initialWorkspaceState) as WorkspaceState);
}

function transition(from: PairingState, to: PairingState): WorkspaceState {
  const start = deepFreeze({
    ...structuredClone(initialWorkspaceState),
    pairing: { state: from, updatedAt: 0 },
  } satisfies WorkspaceState);
  return workspaceReducer(start, { type: 'pairing/transition', to, at: 1 });
}

describe('pairing state set', () => {
  it('is exactly the seven schema-anchored states', () => {
    expect([...PAIRING_STATES]).toEqual([
      'IDLE',
      'PAIRING',
      'LIVE',
      'CAPTURING',
      'STAGED',
      'OFFLINE',
      'ERROR',
    ]);
  });

  it('covers every state as a transition-table key, with only known targets', () => {
    expect(Object.keys(PAIRING_TRANSITIONS).sort()).toEqual([...PAIRING_STATES].sort());
    for (const targets of Object.values(PAIRING_TRANSITIONS)) {
      for (const target of targets) expect(PAIRING_STATES).toContain(target);
    }
  });
});

describe('legal pairing transitions', () => {
  const legal: Array<[PairingState, PairingState]> = [
    ['IDLE', 'PAIRING'],
    ['PAIRING', 'LIVE'],
    ['PAIRING', 'OFFLINE'],
    ['PAIRING', 'ERROR'],
    ['PAIRING', 'IDLE'],
    ['LIVE', 'CAPTURING'],
    ['LIVE', 'OFFLINE'],
    ['LIVE', 'ERROR'],
    ['LIVE', 'IDLE'],
    ['CAPTURING', 'STAGED'],
    ['CAPTURING', 'LIVE'],
    ['CAPTURING', 'OFFLINE'],
    ['CAPTURING', 'ERROR'],
    ['STAGED', 'LIVE'],
    ['STAGED', 'OFFLINE'],
    ['STAGED', 'ERROR'],
    ['STAGED', 'IDLE'],
    ['OFFLINE', 'IDLE'],
    ['OFFLINE', 'PAIRING'],
    ['ERROR', 'IDLE'],
    ['ERROR', 'PAIRING'],
  ];

  it.each(legal)('%s → %s succeeds and records the new state', (from, to) => {
    const next = transition(from, to);
    expect(next.pairing.state).toBe(to);
    expect(isRejected(structuredClone(initialWorkspaceState) as WorkspaceState, next)).toBe(false);
  });
});

describe('illegal pairing transitions', () => {
  it('rejects IDLE → LIVE with an honest reason naming both states and expectations', () => {
    const reason = illegalPairingReason('IDLE', 'LIVE');
    expect(reason).toBe('Illegal pairing transition IDLE → LIVE. Expected one of: PAIRING.');
  });

  it('rejects every illegal pair and leaves state untouched', () => {
    let checked = 0;
    for (const from of PAIRING_STATES) {
      for (const to of PAIRING_STATES) {
        if (PAIRING_TRANSITIONS[from].includes(to)) continue;
        checked += 1;
        const start = deepFreeze({
          ...structuredClone(initialWorkspaceState),
          pairing: { state: from, updatedAt: 0 },
        } satisfies WorkspaceState);
        const after = workspaceReducer(start, { type: 'pairing/transition', to, at: 5 });
        expect(isRejected(start, after)).toBe(true);
        expect(after.pairing.state).toBe(from);
        const reason = illegalPairingReason(from, to);
        expect(reason).toContain(`${from} → ${to}`);
      }
    }
    // 7 states → 49 pairs, 21 legal ⇒ 28 illegal.
    expect(checked).toBe(28);
  });
});

describe('specialised pairing actions respect the table', () => {
  it('pairing/established only applies from PAIRING', () => {
    const pairing = transition('IDLE', 'PAIRING');
    const live = workspaceReducer(pairing, { type: 'pairing/established', deviceId: 'dev-1', at: 2 });
    expect(live.pairing.state).toBe('LIVE');
    expect(live.pairing.deviceId).toBe('dev-1');

    const idle = frozenInitial();
    const rejected = workspaceReducer(idle, { type: 'pairing/established', deviceId: 'dev-1', at: 2 });
    expect(isRejected(idle, rejected)).toBe(true);
  });

  it('pairing/progress only applies while PAIRING and clamps to 0..1', () => {
    const pairing = transition('IDLE', 'PAIRING');
    const midway = workspaceReducer(pairing, { type: 'pairing/progress', progress: 0.6 });
    expect(midway.pairing.progress).toBe(0.6);
    const over = workspaceReducer(midway, { type: 'pairing/progress', progress: 7 });
    expect(over.pairing.progress).toBe(1);

    const idle = frozenInitial();
    expect(isRejected(idle, workspaceReducer(idle, { type: 'pairing/progress', progress: 0.5 }))).toBe(true);
  });

  it('pairing/deviceLost only applies from LIVE and keeps the deviceId honest', () => {
    const live = workspaceReducer(transition('IDLE', 'PAIRING'), {
      type: 'pairing/established',
      deviceId: 'dev-9',
      at: 3,
    });
    const offline = workspaceReducer(live, { type: 'pairing/deviceLost' });
    expect(offline.pairing.state).toBe('OFFLINE');
    expect(offline.pairing.deviceId).toBe('dev-9');

    const pairing = transition('IDLE', 'PAIRING');
    expect(isRejected(pairing, workspaceReducer(pairing, { type: 'pairing/deviceLost' }))).toBe(true);
  });
});

describe('reducer purity', () => {
  it('every action in the union runs against deep-frozen state without throwing or mutating', () => {
    const start = frozenInitial();
    const actions: WorkspaceAction[] = [
      { type: 'space/create', id: 'sp-1', name: 'Site A', at: 1 },
      { type: 'space/rename', id: 'sp-1', name: 'Site A2' },
      { type: 'space/select', id: 'sp-1' },
      { type: 'room/create', id: 'rm-1', spaceId: 'sp-1', name: 'Lobby', dimensionsM: { x: 5, y: 3, z: 4 }, at: 2 },
      { type: 'room/rename', id: 'rm-1', name: 'Foyer' },
      { type: 'room/delete', id: 'rm-1', confirmName: 'Foyer' },
      { type: 'viewGroup/create', id: 'vg-1', spaceId: 'sp-1', roomId: null, name: 'Wide', at: 3 },
      { type: 'viewGroup/rename', id: 'vg-1', name: 'Wides' },
      { type: 'viewGroup/assignRoom', viewGroupId: 'vg-1', roomId: 'rm-1' },
      { type: 'viewGroup/unassignRoom', viewGroupId: 'vg-1' },
      { type: 'viewGroup/delete', id: 'vg-1', confirmName: 'Wides' },
      { type: 'image/stage', id: 'im-1', viewGroupId: null, objectUrl: 'blob:x', at: 4,
        meta: { width: 100, height: 80, bytes: 1024, sha256: 'abc', source: 'phone' } },
      { type: 'image/remove', imageId: 'im-1' },
      { type: 'scene/select', selection: { kind: 'space', spaceId: 'sp-1' } },
      { type: 'scene/clear' },
      { type: 'camera/setPose', id: 'pose-1', label: 'Door', position: { x: 0, y: 1.6, z: 0 }, target: { x: 1, y: 1.6, z: 1 } },
      { type: 'camera/removePose', id: 'pose-1' },
      { type: 'pairing/transition', to: 'PAIRING', at: 5 },
      { type: 'toast/push', toast: { id: 't-1', title: 'Saved', tone: 'success' } },
      { type: 'toast/dismiss', id: 't-1' },
      { type: 'state/hydrate', state: structuredClone(initialWorkspaceState) as WorkspaceState },
    ];
    for (const action of actions) {
      const after = workspaceReducer(start, action);
      expect(after).toBeTypeOf('object');
    }
    // The frozen original is untouched.
    expect(start.spaces).toHaveLength(0);
    expect(start.pairing.state).toBe('IDLE');
    expect(start.toasts).toHaveLength(0);
  });
});
