import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPointerLockController,
  HINT_AUTO_HIDE_MS,
  INITIAL_POINTER_LOCK,
  pointerLockReducer,
  type PointerLockSnapshot,
} from '../src/components/viewer/usePointerLock';

/**
 * T17 · pointer-lock HUD state (§5.19 walkthrough hint).
 *
 * The reducer is pure so its mapping is exhaustively pinned here; the
 * controller is exercised with injected timers so the 4 s auto-hide window is
 * deterministic and never a real wait. The React hook itself needs a DOM and
 * is covered by the e2e walkthrough (tests/e2e/viewer-hud.spec.ts).
 */

const LOCKED_VISIBLE: PointerLockSnapshot = { locked: true, hintVisible: true };
const LOCKED_HIDDEN: PointerLockSnapshot = { locked: true, hintVisible: false };
const UNLOCKED: PointerLockSnapshot = { locked: false, hintVisible: true };

describe('pointerLockReducer', () => {
  it('starts unlocked with the hint showing', () => {
    expect(INITIAL_POINTER_LOCK).toEqual({ locked: false, hintVisible: true });
  });

  it('lock shows the hint from the unlocked state', () => {
    expect(pointerLockReducer(INITIAL_POINTER_LOCK, 'lock')).toEqual(LOCKED_VISIBLE);
  });

  it('lock is a no-op when already locked (same object, no re-arm)', () => {
    const state = pointerLockReducer(LOCKED_HIDDEN, 'lock');
    expect(state).toBe(LOCKED_HIDDEN);
  });

  it('unlock restores the hint and clears the lock', () => {
    expect(pointerLockReducer(LOCKED_HIDDEN, 'unlock')).toEqual(UNLOCKED);
  });

  it('unlock is a no-op when already unlocked (same object)', () => {
    const state = pointerLockReducer(INITIAL_POINTER_LOCK, 'unlock');
    expect(state).toBe(INITIAL_POINTER_LOCK);
  });

  it('hint-elapsed hides the hint while locked', () => {
    expect(pointerLockReducer(LOCKED_VISIBLE, 'hint-elapsed')).toEqual(LOCKED_HIDDEN);
  });

  it('hint-elapsed is a no-op when already hidden (same object)', () => {
    const state = pointerLockReducer(LOCKED_HIDDEN, 'hint-elapsed');
    expect(state).toBe(LOCKED_HIDDEN);
  });

  it('hint-elapsed is a no-op when unlocked', () => {
    const state = pointerLockReducer(INITIAL_POINTER_LOCK, 'hint-elapsed');
    expect(state).toBe(INITIAL_POINTER_LOCK);
  });
});

describe('createPointerLockController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lock arms a 4 s timer and hides the hint exactly at the window edge', () => {
    const controller = createPointerLockController();
    controller.pointerLockChanged(true);
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);

    vi.advanceTimersByTime(HINT_AUTO_HIDE_MS - 1);
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);

    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual(LOCKED_HIDDEN);
    controller.dispose();
  });

  it('unlock cancels the pending hide and restores the hint', () => {
    const controller = createPointerLockController();
    controller.pointerLockChanged(true);
    vi.advanceTimersByTime(2000);
    controller.pointerLockChanged(false);
    expect(controller.getSnapshot()).toEqual(UNLOCKED);

    // Advancing past the original 4 s window must NOT fire the stale timer.
    vi.advanceTimersByTime(HINT_AUTO_HIDE_MS);
    expect(controller.getSnapshot()).toEqual(UNLOCKED);
    controller.dispose();
  });

  it('re-lock restarts a full 4 s window from the unlock point', () => {
    const controller = createPointerLockController();
    controller.pointerLockChanged(true);
    vi.advanceTimersByTime(HINT_AUTO_HIDE_MS);
    expect(controller.getSnapshot()).toEqual(LOCKED_HIDDEN);

    controller.pointerLockChanged(false);
    controller.pointerLockChanged(true);
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);

    vi.advanceTimersByTime(HINT_AUTO_HIDE_MS - 1);
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual(LOCKED_HIDDEN);
    controller.dispose();
  });

  it('re-lock while the hint is still showing does not restart the timer', () => {
    const controller = createPointerLockController();
    controller.pointerLockChanged(true);
    vi.advanceTimersByTime(3000);
    // A repeated "still locked" report is a no-op — the original 4 s stays.
    controller.pointerLockChanged(true);
    vi.advanceTimersByTime(1000);
    expect(controller.getSnapshot()).toEqual(LOCKED_HIDDEN);
    controller.dispose();
  });

  it('a lock that predates mount still arms the 4 s window (hint cannot stick)', () => {
    const controller = createPointerLockController();
    // Mount-time sync: the document is already locked, so the first report
    // arms the window against the controller's initial unlocked state.
    controller.pointerLockChanged(true);
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);

    // StrictMode's effect → cleanup → effect: `dispose()` cancels the timer
    // but keeps the locked snapshot, so the re-sync arrives already locked
    // with no timer pending. That branch must re-arm, not early-return.
    controller.dispose();
    controller.pointerLockChanged(true);
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);

    vi.advanceTimersByTime(HINT_AUTO_HIDE_MS - 1);
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual(LOCKED_HIDDEN);
    controller.dispose();
  });

  it('notify subscribers only on real changes, never on a redundant report', () => {
    const controller = createPointerLockController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.pointerLockChanged(false); // already unlocked — no emit
    expect(listener).not.toHaveBeenCalled();

    controller.pointerLockChanged(true); // unlocked → locked — one emit
    expect(listener).toHaveBeenCalledTimes(1);

    controller.pointerLockChanged(true); // already locked — no emit
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    controller.pointerLockChanged(false);
    expect(listener).toHaveBeenCalledTimes(1); // disposed listener is gone
    controller.dispose();
  });

  it('dispose cancels the timer so a late hide cannot fire', () => {
    const controller = createPointerLockController();
    controller.pointerLockChanged(true);
    controller.dispose();
    vi.advanceTimersByTime(HINT_AUTO_HIDE_MS * 2);
    // After dispose the snapshot is frozen at lock-time visibility.
    expect(controller.getSnapshot()).toEqual(LOCKED_VISIBLE);
  });
});
