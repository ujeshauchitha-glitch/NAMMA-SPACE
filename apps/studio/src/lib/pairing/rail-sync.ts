/**
 * Pairing state synchronisation (T21) — maps canonical machine states onto
 * legal hops through the T9 reducer, so the stage rail can follow a live
 * session without ever dispatching an illegal transition.
 *
 * The reducer rejects illegal `pairing/*` actions silently (reference-equal
 * state), so the rule here is: **never send one**. `legalPairingPath` walks
 * `PAIRING_TRANSITIONS` (BFS, shortest path) and `pairingSyncActions`
 * turns that path into dispatchable actions — using `pairing/established`
 * for the LIVE hop that carries a peer id (the only action that records
 * `deviceId`), plain `pairing/transition` for everything else.
 *
 * Pure and DOM-free: exercised against the real reducer in
 * `tests/pairing-journey.test.ts`.
 */
import { PAIRING_TRANSITIONS } from '../../state/reducer';
import type { PairingState, WorkspaceAction } from '../../state/types';

/**
 * Shortest legal hop list from `from` to `to` under the reducer table.
 * `[]` when already there. The pairing table is strongly connected, so a
 * path exists for every pair; a defensive `null` covers a future table
 * that is not.
 */
export function legalPairingPath(from: PairingState, to: PairingState): PairingState[] {
  if (from === to) return [];
  const queue: PairingState[] = [from];
  const previous = new Map<PairingState, PairingState | null>([[from, null]]);
  while (queue.length > 0) {
    const current = queue.shift() as PairingState;
    for (const next of PAIRING_TRANSITIONS[current]) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path: PairingState[] = [to];
        let cursor: PairingState | null = current;
        while (cursor !== null && cursor !== from) {
          path.unshift(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return []; // unreachable with the current table — never invent hops
}

/**
 * Dispatchable actions that walk the store from `from` to `to`.
 *
 * The LIVE hop becomes `pairing/established` only when it directly follows
 * PAIRING — `established` is legal solely from PAIRING (reducer rule) and
 * is the only way a `deviceId` reaches the rail. Later LIVE hops (returning
 * from a capture cycle) stay plain transitions, exactly as the table
 * allows.
 */
export function pairingSyncActions(
  from: PairingState,
  to: PairingState,
  at: number,
  deviceId?: string,
): WorkspaceAction[] {
  const path = legalPairingPath(from, to);
  const actions: WorkspaceAction[] = [];
  let previous = from;
  for (const hop of path) {
    if (hop === 'LIVE' && previous === 'PAIRING' && deviceId !== undefined) {
      actions.push({ type: 'pairing/established', deviceId, at });
    } else {
      actions.push({ type: 'pairing/transition', to: hop, at });
    }
    previous = hop;
  }
  return actions;
}
