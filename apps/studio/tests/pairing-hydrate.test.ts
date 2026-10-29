/**
 * Hydration vs. live pairing session (fix for the EX-2-class stall recorded
 * in VALIDATION.md: "returning phone" — a stale workspace snapshot in IndexedDB
 * hydrates `pairing: IDLE` over an in-flight pairing session, so the rail is
 * stuck IDLE and capture is locked forever).
 *
 * Invariant both directions:
 *  - NO-CLOBBER: a stale snapshot must never downgrade a live session
 *    (PAIRING / LIVE / CAPTURING / STAGED) to IDLE.
 *  - NO-ZOMBIE:  a genuinely dead session (IDLE / OFFLINE / ERROR) must still
 *    hydrate to the restored slice — no forever-LIVE pairing with no peer.
 *
 * Pure logic (mergePairingOnHydrate + the reducer's state/hydrate case) —
 * node env, no jsdom needed.
 */
import { describe, expect, it } from 'vitest';
import type { PairingStatus, WorkspaceState } from '../src/state/types';
import {
  initialWorkspaceState,
  mergePairingOnHydrate,
  workspaceReducer,
} from '../src/state/reducer';

/** A snapshot as persistence actually delivers it: pairing forced to IDLE. */
function restoredSnapshot(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    ...structuredClone(initialWorkspaceState),
    spaces: [{ seq: 1, id: 'sp-restored', name: 'Restored', createdAt: 10 }],
    pairing: { state: 'IDLE', updatedAt: 5 },
    ...overrides,
  } as WorkspaceState;
}

function live(state: PairingStatus['state'], extra: Partial<PairingStatus> = {}): PairingStatus {
  return { state, updatedAt: 100, ...extra };
}

function idle(): PairingStatus {
  return { state: 'IDLE', updatedAt: 0 };
}

describe('mergePairingOnHydrate — no-clobber direction', () => {
  it('live PAIRING + restored IDLE → keeps the live session (the EX-2 stall)', () => {
    expect(mergePairingOnHydrate(live('PAIRING', { progress: 0.4 }), { state: 'IDLE', updatedAt: 5 }))
      .toEqual(live('PAIRING', { progress: 0.4 }));
  });

  it('live LIVE + restored IDLE → keeps LIVE with its deviceId', () => {
    expect(mergePairingOnHydrate(live('LIVE', { deviceId: 'dev-9' }), { state: 'IDLE', updatedAt: 5 }))
      .toEqual(live('LIVE', { deviceId: 'dev-9' }));
  });

  it('live CAPTURING + restored IDLE → keeps CAPTURING', () => {
    expect(mergePairingOnHydrate(live('CAPTURING', { deviceId: 'dev-9' }), { state: 'IDLE', updatedAt: 5 }).state)
      .toBe('CAPTURING');
  });

  it('live STAGED + restored IDLE → keeps STAGED', () => {
    expect(mergePairingOnHydrate(live('STAGED'), { state: 'IDLE', updatedAt: 5 }).state).toBe('STAGED');
  });
});

describe('mergePairingOnHydrate — no-zombie direction', () => {
  it('live IDLE + restored IDLE (fresh device) → restored wins', () => {
    const restored = { state: 'IDLE' as const, updatedAt: 5 };
    expect(mergePairingOnHydrate(idle(), restored)).toBe(restored);
  });

  it('live OFFLINE + restored IDLE → IDLE (dead session resets honestly)', () => {
    const restored = { state: 'IDLE' as const, updatedAt: 5 };
    expect(mergePairingOnHydrate(live('OFFLINE', { deviceId: 'dev-9' }), restored)).toBe(restored);
  });

  it('live ERROR + restored IDLE → IDLE', () => {
    const restored = { state: 'IDLE' as const, updatedAt: 5 };
    expect(mergePairingOnHydrate(live('ERROR'), restored)).toBe(restored);
  });

  it('no-live fresh device + restored non-IDLE slice → restored wins untouched', () => {
    const restored = { state: 'LIVE' as const, deviceId: 'dev-7', updatedAt: 50 } as PairingStatus;
    expect(mergePairingOnHydrate(idle(), restored)).toBe(restored);
  });
});

describe('mergePairingOnHydrate — both active, defined by updatedAt', () => {
  it('restored active with strictly newer updatedAt → restored wins', () => {
    const restored = { state: 'LIVE' as const, deviceId: 'dev-newer', updatedAt: 200 } as PairingStatus;
    expect(mergePairingOnHydrate(live('PAIRING'), restored)).toBe(restored);
  });

  it('restored active with older updatedAt → live wins', () => {
    expect(mergePairingOnHydrate(live('LIVE', { deviceId: 'dev-live' }), {
      state: 'CAPTURING',
      updatedAt: 50,
    }).deviceId).toBe('dev-live');
  });

  it('restored active with equal updatedAt → live wins (ties favor the session in hand)', () => {
    expect(mergePairingOnHydrate(live('PAIRING'), { state: 'LIVE', updatedAt: 100 }).state).toBe('PAIRING');
  });
});

describe('reducer state/hydrate — wired at the real call site', () => {
  it('hydrating over a live session restores workspace data but preserves pairing', () => {
    const start: WorkspaceState = {
      ...structuredClone(initialWorkspaceState),
      pairing: live('LIVE', { deviceId: 'dev-9' }),
    };
    const after = workspaceReducer(start, { type: 'state/hydrate', state: restoredSnapshot() });
    // Workspace data comes from the snapshot…
    expect(after.spaces).toHaveLength(1);
    expect(after.spaces[0]?.id).toBe('sp-restored');
    // …but the live pairing session survives the stale IDLE snapshot.
    expect(after.pairing.state).toBe('LIVE');
    expect(after.pairing.deviceId).toBe('dev-9');
  });

  it('hydrating a dead session takes the snapshot pairing (no zombie)', () => {
    const start: WorkspaceState = {
      ...structuredClone(initialWorkspaceState),
      pairing: live('OFFLINE', { deviceId: 'dev-9' }),
    };
    const after = workspaceReducer(start, { type: 'state/hydrate', state: restoredSnapshot() });
    expect(after.pairing.state).toBe('IDLE');
    expect(after.pairing.deviceId).toBeUndefined();
  });

  it('hydrating a fresh (never-paired) store is unchanged from before: restored wins', () => {
    const after = workspaceReducer(initialWorkspaceState, {
      type: 'state/hydrate',
      state: restoredSnapshot(),
    });
    expect(after.pairing.state).toBe('IDLE');
    expect(after.spaces[0]?.id).toBe('sp-restored');
  });

  it('stays pure under deep-frozen live state', () => {
    const start = Object.freeze({
      ...structuredClone(initialWorkspaceState),
      pairing: Object.freeze(live('PAIRING', { progress: 0.2 })),
    }) as WorkspaceState;
    const after = workspaceReducer(start, { type: 'state/hydrate', state: restoredSnapshot() });
    expect(after.pairing.state).toBe('PAIRING');
    expect(start.pairing.state).toBe('PAIRING'); // untouched
  });
});
