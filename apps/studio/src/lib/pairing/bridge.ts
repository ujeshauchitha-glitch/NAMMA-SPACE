/**
 * Pairing → store bridge (T21) — turns session state events into legal T9
 * reducer actions so the stage rail follows a live session.
 *
 * The bridge owns a synchronous shadow of the store's pairing state: each
 * `state` event maps through `pairingSyncActions` (legal hops only) from
 * the last state THIS bridge observed, so a burst of events inside one
 * React batch can never dispatch an illegal transition against a stale
 * store snapshot.
 *
 * Non-state events (signalling, transfers, errors) are not dispatched —
 * they belong to the UI, not to the reducer. Nothing here invents state:
 * the session only emits moves it actually observed.
 */
import type { PairingState, WorkspaceAction } from '../../state/types';
import { pairingSyncActions } from './rail-sync';
import type { PairingSessionEvent } from './session';

export type PairingSyncBridgeOptions = {
  /** The store's pairing state when the bridge subscribes. */
  initial: PairingState;
  /** Workspace dispatch (T9 store) — the sink for every mapped action. */
  dispatch: (action: WorkspaceAction) => void;
};

export type PairingSyncBridge = {
  /** Feed one session event; state events become legal store actions. */
  handle(event: PairingSessionEvent): void;
  /** The pairing state this bridge has walked the store to. */
  readonly state: PairingState;
};

export function createPairingSyncBridge(options: PairingSyncBridgeOptions): PairingSyncBridge {
  let state = options.initial;
  return {
    get state() {
      return state;
    },
    handle(event: PairingSessionEvent): void {
      if (event.type !== 'state' || event.state === state) return;
      const actions = pairingSyncActions(state, event.state, event.at, event.deviceId);
      for (const action of actions) options.dispatch(action);
      state = event.state;
    },
  };
}
