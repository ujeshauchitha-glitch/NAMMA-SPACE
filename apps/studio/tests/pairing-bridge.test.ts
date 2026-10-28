import { describe, expect, it } from 'vitest';

import { createPairingSyncBridge } from '../src/lib/pairing/bridge';
import type { PairingSessionEvent } from '../src/lib/pairing/session';
import { deriveRailStages } from '../src/components/scan/stage-rail';
import { initialWorkspaceState, workspaceReducer } from '../src/state/reducer';
import type { PairingState, WorkspaceAction, WorkspaceState } from '../src/state/types';

/**
 * T21 bridge unit suite — `createPairingSyncBridge` maps observed session
 * states onto legal T9 reducer actions. Pure: no DOM, no session, no store
 * provider; the reducer itself is the oracle for legality.
 */

const stateEvent = (
  state: PairingState,
  extra: { at?: number; deviceId?: string } = {},
): PairingSessionEvent => ({
  type: 'state',
  state,
  at: extra.at ?? 1,
  ...(extra.deviceId !== undefined ? { deviceId: extra.deviceId } : {}),
});

function createRecordingBridge(initial: PairingState) {
  const actions: WorkspaceAction[] = [];
  let state: WorkspaceState = { ...initialWorkspaceState, pairing: { state: initial, updatedAt: 0 } };
  const bridge = createPairingSyncBridge({
    initial,
    dispatch: (action) => {
      actions.push(action);
      state = workspaceReducer(state, action);
    },
  });
  return { actions, bridge, current: () => state };
}

describe('createPairingSyncBridge', () => {
  it('dispatches nothing for non-state events — those belong to the UI', () => {
    const { actions, bridge } = createRecordingBridge('IDLE');
    bridge.handle({ type: 'signalling', status: 'open' });
    bridge.handle({
      type: 'transfer',
      progress: { frameId: 'f1', chunkCount: 2, sentChunks: 1, acked: false, bytes: 10, ackedBytes: 0 },
    });
    bridge.handle({ type: 'transfer-error', reason: 'channel closed' });
    bridge.handle({ type: 'stun-fallback', attempt: 1 });
    expect(actions).toHaveLength(0);
    expect(bridge.state).toBe('IDLE');
  });

  it('walks the store IDLE → LIVE → STAGED legally, with the peer id at LIVE', () => {
    const { actions, bridge, current } = createRecordingBridge('IDLE');

    bridge.handle(stateEvent('PAIRING', { at: 10 }));
    expect(current().pairing.state).toBe('PAIRING');

    bridge.handle(stateEvent('LIVE', { at: 20, deviceId: 'peer-9' }));
    expect(current().pairing.state).toBe('LIVE');
    expect(current().pairing.deviceId).toBe('peer-9');
    // The LIVE hop is the established action — the only one carrying deviceId.
    expect(actions.some((action) => action.type === 'pairing/established')).toBe(true);

    bridge.handle(stateEvent('CAPTURING', { at: 30 }));
    bridge.handle(stateEvent('STAGED', { at: 40 }));
    expect(current().pairing.state).toBe('STAGED');
    expect(bridge.state).toBe('STAGED');

    const stages = deriveRailStages(current().pairing);
    expect(stages.find((stage) => stage.key === 'STAGED')?.status).toBe('active');
    expect(stages.find((stage) => stage.key === 'CAPTURING')?.status).toBe('done');
    expect(stages.find((stage) => stage.key === 'LIVE')?.status).toBe('done');
    expect(stages.find((stage) => stage.key === 'TERMINAL')?.status).toBe('pending');
  });

  it('a repeated state event dispatches nothing — no duplicate hops, no fake moves', () => {
    const { actions, bridge } = createRecordingBridge('IDLE');
    bridge.handle(stateEvent('PAIRING', { at: 10 }));
    const afterFirst = actions.length;
    bridge.handle(stateEvent('PAIRING', { at: 11 }));
    expect(actions).toHaveLength(afterFirst);
    expect(bridge.state).toBe('PAIRING');
  });

  it('re-initialising from a non-IDLE store still finds legal hops', () => {
    const { bridge, current } = createRecordingBridge('ERROR');
    bridge.handle(stateEvent('PAIRING', { at: 6 }));
    expect(current().pairing.state).toBe('PAIRING'); // ERROR → PAIRING is a table hop
    bridge.handle(stateEvent('LIVE', { at: 7, deviceId: 'peer-2' }));
    expect(current().pairing.state).toBe('LIVE');
    expect(current().pairing.deviceId).toBe('peer-2');
  });
});
