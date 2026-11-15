/**
 * Drag-to-look without pointer lock: a press on the canvas becomes a look drag once it has moved more
 * than a few pixels; a press released before that is a click (it still selects POIs). Pure, so the
 * click/drag split is unit tested; the viewer feeds it pointer events (mouse, pen or one finger).
 */

/** Movement (CSS px) below which a press is still a click. Touch gets more room for finger jitter. */
export const DRAG_THRESHOLD_PX = { mouse: 4, touch: 10 } as const;

export type LookGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
  threshold: number;
};

export function startGesture(pointerId: number, x: number, y: number, pointerType: string): LookGesture {
  const threshold = pointerType === 'touch' ? DRAG_THRESHOLD_PX.touch : DRAG_THRESHOLD_PX.mouse;
  return { pointerId, startX: x, startY: y, lastX: x, lastY: y, dragging: false, threshold };
}

/** Advance a gesture; returns the look delta to apply this move (zero until it becomes a drag). */
export function moveGesture(gesture: LookGesture, x: number, y: number): { gesture: LookGesture; dx: number; dy: number } {
  const dragging = gesture.dragging || Math.hypot(x - gesture.startX, y - gesture.startY) > gesture.threshold;
  // The first drag frame applies everything since the press, so crossing the threshold does not jump.
  const fromX = gesture.dragging ? gesture.lastX : gesture.startX;
  const fromY = gesture.dragging ? gesture.lastY : gesture.startY;
  const next = { ...gesture, lastX: x, lastY: y, dragging };
  return dragging ? { gesture: next, dx: x - fromX, dy: y - fromY } : { gesture: next, dx: 0, dy: 0 };
}

/** Whether releasing this gesture should count as a click. */
export function isClick(gesture: LookGesture | null): boolean {
  return gesture !== null && !gesture.dragging;
}
