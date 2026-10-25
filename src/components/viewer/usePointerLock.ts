import { useEffect, useRef, useState } from 'react';

/**
 * T17 · pointer-lock HUD state (§5.19 walkthrough hint).
 *
 * The hint chip is armed the moment walkthrough is entered and auto-hides
 * after HINT_AUTO_HIDE_MS; leaving walkthrough restores it so the next entry
 * gets a full window again. The reducer is a pure, identity-preserving
 * transition table so the controller only notifies subscribers when the
 * snapshot actually changes (an initial sync must not look like a change).
 */

/** Auto-hide window for the walkthrough hint, per DESIGN_HANDOFF §5.19. */
export const HINT_AUTO_HIDE_MS = 4000;

export type PointerLockSnapshot = {
  readonly locked: boolean;
  readonly hintVisible: boolean;
};

export const INITIAL_POINTER_LOCK: PointerLockSnapshot = Object.freeze({
  locked: false,
  hintVisible: true,
});

export type PointerLockEvent = 'lock' | 'unlock' | 'hint-elapsed';

/**
 * Pure transition table. No-op transitions return the SAME object so callers
 * can use reference equality as "did anything change?".
 */
export function pointerLockReducer(
  state: PointerLockSnapshot,
  event: PointerLockEvent,
): PointerLockSnapshot {
  switch (event) {
    case 'lock':
      // Already locked: keep the current hint state (a re-lock while the
      // hint is still showing must not restart or blank it).
      if (state.locked) return state;
      return { locked: true, hintVisible: true };
    case 'unlock':
      if (!state.locked) return state;
      return { locked: false, hintVisible: true };
    case 'hint-elapsed':
      // Only meaningful while locked and still showing — otherwise identity.
      if (!state.locked || !state.hintVisible) return state;
      return { locked: true, hintVisible: false };
    default:
      return state;
  }
}

type Schedule = (callback: () => void, delay: number) => number;
type Cancel = (handle: number) => void;

const defaultSchedule: Schedule = (callback, delay) =>
  globalThis.setTimeout(callback, delay) as unknown as number;
const defaultCancel: Cancel = (handle) => globalThis.clearTimeout(handle);

/**
 * Framework-free controller: owns the snapshot and the auto-hide timer.
 * Injectable timers keep the unit tests deterministic (no real 4 s waits).
 */
export function createPointerLockController(options?: {
  schedule?: Schedule;
  cancel?: Cancel;
}) {
  const schedule = options?.schedule ?? defaultSchedule;
  const cancel = options?.cancel ?? defaultCancel;

  let snapshot: PointerLockSnapshot = INITIAL_POINTER_LOCK;
  let timer: number | undefined;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const apply = (event: PointerLockEvent) => {
    const next = pointerLockReducer(snapshot, event);
    if (next === snapshot) return;
    snapshot = next;
    emit();
  };

  const clearTimer = () => {
    if (timer === undefined) return;
    cancel(timer);
    timer = undefined;
  };

  return {
    getSnapshot(): PointerLockSnapshot {
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Feed the current document pointer-lock state; only real changes emit. */
    pointerLockChanged(locked: boolean): void {
      if (locked) {
        if (snapshot.locked) {
          // Already locked: the snapshot is unchanged, but a sync that lands
          // here with no timer pending (a lock that predates this mount —
          // StrictMode's effect → cleanup → effect re-runs `dispose()` and
          // re-syncs) must still arm the auto-hide window, or the hint would
          // stay visible forever. A re-lock while the timer is already
          // pending keeps the original window (`timer !== undefined`).
          if (snapshot.hintVisible && timer === undefined) {
            timer = schedule(() => {
              timer = undefined;
              apply('hint-elapsed');
            }, HINT_AUTO_HIDE_MS);
          }
          return;
        }
        clearTimer();
        apply('lock');
        timer = schedule(() => {
          timer = undefined;
          apply('hint-elapsed');
        }, HINT_AUTO_HIDE_MS);
      } else {
        if (!snapshot.locked) return;
        clearTimer();
        apply('unlock');
      }
    },
    dispose(): void {
      clearTimer();
      listeners.clear();
    },
  };
}

export type PointerLockController = ReturnType<typeof createPointerLockController>;

/**
 * React binding. Reads the live `document.pointerLockElement` on mount so a
 * lock that happened before this hook mounted is never missed, then follows
 * `pointerlockchange` for the lifetime of `target`.
 *
 * `onLockChange` fires only on a real locked/unlocked transition (the
 * identity-preserving reducer guarantees the initial sync is silent when the
 * state already matches).
 */
export function usePointerLock(options?: {
  onLockChange?: () => void;
  target?: Document | null;
}): PointerLockSnapshot {
  const onLockChangeRef = useRef(options?.onLockChange);
  useEffect(() => {
    onLockChangeRef.current = options?.onLockChange;
  });

  const controllerRef = useRef<PointerLockController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createPointerLockController();
  }
  const controller = controllerRef.current;

  const [snapshot, setSnapshot] = useState<PointerLockSnapshot>(() => controller.getSnapshot());

  useEffect(() => {
    const target = options?.target ?? document;
    const readLock = () => target.pointerLockElement !== null;
    const handleChange = () => {
      const wasLocked = controller.getSnapshot().locked;
      const locked = readLock();
      controller.pointerLockChanged(locked);
      // Fire only on a real transition (never on the initial sync).
      if (controller.getSnapshot().locked !== wasLocked) onLockChangeRef.current?.();
    };

    const unsubscribe = controller.subscribe(() => setSnapshot(controller.getSnapshot()));
    target.addEventListener('pointerlockchange', handleChange);
    handleChange(); // sync with whatever is already locked

    return () => {
      target.removeEventListener('pointerlockchange', handleChange);
      unsubscribe();
      controller.dispose();
    };
    // `options.target` is read once per mount by design (a changing target
    // would need a full re-sync); the stable controller identity is the dep.
  }, [controller, options?.target]);

  return snapshot;
}
