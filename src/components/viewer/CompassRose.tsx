import { useEffect, useRef } from 'react';
import { roseRotation } from './hudMath';
import styles from './CompassRose.module.css';

/**
 * T17 · compass rose (§5.19 top-right readout).
 *
 * A 32px SVG rose whose needle tracks the live camera yaw. The rotation is
 * written straight to the needle group's inline `transform` inside a rAF loop
 * so the per-frame pose never re-renders React — the workspace only re-renders
 * when its own position state changes.
 *
 * The rose is decorative: the adjacent `N ↑` glyph and the tabular coordinate
 * readout carry the accessible meaning, so the SVG is `aria-hidden`.
 * Rotation is data, not decoration — it is intentionally not suppressed under
 * `prefers-reduced-motion`.
 */
export type CompassRoseProps = {
  /** Live yaw source; `null`/`undefined` freezes the needle at north. */
  getYaw?: () => number | null;
  className?: string;
};

export function CompassRose({ getYaw, className }: CompassRoseProps) {
  const needleRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!getYaw) return;
    let frame = 0;
    let lastApplied: number | null = null;
    const tick = () => {
      const yaw = getYaw();
      if (yaw != null && Number.isFinite(yaw)) {
        const rotation = roseRotation(yaw);
        if (rotation !== lastApplied && needleRef.current) {
          lastApplied = rotation;
          needleRef.current.style.transform = `rotate(${rotation}deg)`;
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [getYaw]);

  return (
    <svg
      className={[styles.rose, className].filter(Boolean).join(' ')}
      viewBox="0 0 32 32"
      width="32"
      height="32"
      aria-hidden="true"
      focusable="false"
    >
      <circle className={styles.ring} cx="16" cy="16" r="14.5" />
      {/* Cardinal ticks: N/E/S/W at the four cardinals. */}
      <line className={styles.tick} x1="16" y1="2.5" x2="16" y2="5.5" />
      <line className={styles.tick} x1="29.5" y1="16" x2="26.5" y2="16" />
      <line className={styles.tick} x1="16" y1="29.5" x2="16" y2="26.5" />
      <line className={styles.tick} x1="2.5" y1="16" x2="5.5" y2="16" />
      <g ref={needleRef} className={styles.needle}>
        <path className={styles.north} d="M16 4 L19.5 16 L12.5 16 Z" />
        <path className={styles.south} d="M16 28 L19.5 16 L12.5 16 Z" />
      </g>
      <circle className={styles.hub} cx="16" cy="16" r="1.75" />
    </svg>
  );
}
