import styles from './Skeleton.module.css';

/**
 * Loading skeleton (§5.12): --surface-skeleton blocks with a 1.2 s sweep.
 * The 200 ms delay avoids a flash on fast loads (animation-delay). Geometry
 * should match the target layout (list rows, 4:3 thumbs, 2-col kv).
 * Under prefers-reduced-motion the sweep becomes a static fill (base.css
 * duration clamp + the module's static fallback).
 */
export type SkeletonProps = {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
};

export function Skeleton({ width = '100%', height = 12, radius, className }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** Convenience: N stacked list rows with jittered widths (DAMP list preview). */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  const widths = ['100%', '86%', '92%', '78%'];
  return (
    <div className={[styles.rows, className].filter(Boolean).join(' ')} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={40} width={widths[index % widths.length]} radius="var(--radius-2)" />
      ))}
    </div>
  );
}
