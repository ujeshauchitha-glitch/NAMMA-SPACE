import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, isClick, moveGesture, startGesture } from '../src/lib/lookGesture';

describe('drag-to-look gesture', () => {
  it('a press that barely moves is a click and does not look', () => {
    let g = startGesture(1, 100, 100, 'mouse');
    const step = moveGesture(g, 102, 101);
    g = step.gesture;
    expect([step.dx, step.dy]).toEqual([0, 0]);
    expect(isClick(g)).toBe(true);
  });

  it('becomes a drag past the threshold and applies the whole movement without a jump', () => {
    let g = startGesture(1, 100, 100, 'mouse');
    g = moveGesture(g, 103, 100).gesture;
    const first = moveGesture(g, 110, 96);
    expect(first.gesture.dragging).toBe(true);
    expect([first.dx, first.dy]).toEqual([10, -4]);
    const second = moveGesture(first.gesture, 115, 96);
    expect([second.dx, second.dy]).toEqual([5, 0]);
    expect(isClick(second.gesture)).toBe(false);
  });

  it('gives a finger more room before a tap turns into a drag', () => {
    const g = startGesture(7, 0, 0, 'touch');
    expect(g.threshold).toBe(DRAG_THRESHOLD_PX.touch);
    expect(isClick(moveGesture(g, 8, 0).gesture)).toBe(true);
    expect(isClick(moveGesture(g, 12, 0).gesture)).toBe(false);
  });

  it('no gesture is not a click', () => {
    expect(isClick(null)).toBe(false);
  });
});
