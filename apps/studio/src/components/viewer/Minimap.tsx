import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavigationGrid, Poi } from '../../types/scene';
import type { FloorPoint } from '../../lib/poiIndex';
import {
  gridImageTransform, gridPixels, headingOnMap, minimapDrawKey, minimapTransform, poiAtMapPoint, toMap, walkableAtMapPoint,
  type MapPose, type MapTransform, type MinimapMode,
} from '../../lib/minimap';
import styles from './Minimap.module.css';

export type MinimapProps = {
  grid: NavigationGrid;
  pois: readonly Poi[];
  selectedId: string | null;
  /** Live pose sampled each frame (null before the viewer is ready). */
  getPose: () => MapPose | null;
  /** The route currently drawn in 3D (smoothed floor points), or null. */
  getRoute: () => readonly FloorPoint[] | null;
  onSelectPoi: (poiId: string) => void;
  onRouteToFloor: (point: FloorPoint) => void;
};

const PHONE_QUERY = '(max-width: 560px)';
const ROUTE = '#7fae16';
const PIN = '#24302a';
const SELECTED = '#a8cc17';
const USER = '#1f6feb';

function isPhone(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}

/**
 * Top-down map in a corner of the stage (a full-width sheet on phones, opened from a button): the nav grid
 * in three tones, POI pins and zone outlines, the visitor and their heading cone, and the active route.
 * Click a POI to select it; click walkable floor to route there. Drawn on a 2D canvas, and only when what
 * it shows changes (minimapDrawKey), not every frame.
 */
export function Minimap({ grid, pois, selectedId, getPose, getRoute, onSelectPoi, onRouteToFloor }: MinimapProps) {
  const [open, setOpen] = useState(() => !isPhone());
  const [mode, setMode] = useState<MinimapMode>('north');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<MapTransform | null>(null);

  // The grid bitmap (one pixel per cell), rebuilt only for a new grid.
  const gridBitmap = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const bitmap = document.createElement('canvas');
    bitmap.width = grid.width;
    bitmap.height = grid.height;
    const context = bitmap.getContext('2d');
    if (!context) return null;
    context.putImageData(new ImageData(gridPixels(grid), grid.width, grid.height), 0, 0);
    return bitmap;
  }, [grid]);

  useEffect(() => {
    const box = boxRef.current;
    if (!open || !box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSize({ w: Math.round(box.clientWidth), h: Math.round(box.clientHeight) }));
    observer.observe(box);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!open || !canvas || !context || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    let lastKey = '';
    let lastRoute: readonly FloorPoint[] | null = null;
    let frame = 0;

    const draw = (pose: MapPose | null, route: readonly FloorPoint[] | null) => {
      const t = minimapTransform(grid, size.w, size.h, mode, pose ?? { x: 0, z: 0, yawDegrees: 0 });
      transformRef.current = t;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (gridBitmap) {
        const [a, b, c, d, e, f] = gridImageTransform(grid, t);
        context.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
        context.imageSmoothingEnabled = false;
        context.drawImage(gridBitmap, 0, 0);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const path = (points: readonly FloorPoint[], close: boolean) => {
        context.beginPath();
        points.forEach(([x, z], i) => {
          const [px, py] = toMap(t, x, z);
          if (i === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        });
        if (close) context.closePath();
      };
      for (const poi of pois) {
        if (!poi.zone) continue;
        path(poi.zone, true);
        context.strokeStyle = poi.id === selectedId ? SELECTED : 'rgba(36, 48, 42, 0.55)';
        context.lineWidth = poi.id === selectedId ? 2 : 1;
        context.stroke();
      }
      if (route && route.length > 1) {
        path(route, false);
        context.strokeStyle = ROUTE;
        context.lineWidth = 3;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.stroke();
      }
      for (const poi of pois) {
        const [px, py] = toMap(t, poi.position[0], poi.position[2]);
        const selected = poi.id === selectedId;
        context.beginPath();
        context.arc(px, py, selected ? 5.5 : 4, 0, Math.PI * 2);
        context.fillStyle = selected ? SELECTED : PIN;
        context.fill();
        context.lineWidth = 1.5;
        context.strokeStyle = '#ffffff';
        context.stroke();
      }
      if (pose) {
        const [ux, uy] = toMap(t, pose.x, pose.z);
        const [hx, hy] = headingOnMap(t, pose.yawDegrees);
        const reach = 26;
        const spread = Math.PI / 6;
        const angle = Math.atan2(hy, hx);
        context.beginPath();
        context.moveTo(ux, uy);
        context.arc(ux, uy, reach, angle - spread, angle + spread);
        context.closePath();
        context.fillStyle = 'rgba(31, 111, 235, 0.25)';
        context.fill();
        context.beginPath();
        context.arc(ux, uy, 5, 0, Math.PI * 2);
        context.fillStyle = USER;
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = '#ffffff';
        context.stroke();
      }
    };

    const tick = () => {
      const pose = getPose();
      const route = getRoute();
      const key = minimapDrawKey({ pose, mode, widthPx: size.w, heightPx: size.h, selectedId, route });
      if (key !== lastKey || route !== lastRoute) {
        lastKey = key;
        lastRoute = route;
        draw(pose, route);
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [open, size, mode, grid, gridBitmap, pois, selectedId, getPose, getRoute]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const t = transformRef.current;
    if (!t) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const poiId = poiAtMapPoint(pois, t, px, py);
    if (poiId) {
      onSelectPoi(poiId);
      if (isPhone()) setOpen(false);
      return;
    }
    const floor = walkableAtMapPoint(grid, t, px, py);
    if (floor) {
      onRouteToFloor(floor);
      if (isPhone()) setOpen(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={styles.openButton} onClick={() => setOpen(true)} aria-expanded={false} data-testid="minimap-open">
        Map
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="Minimap" data-testid="minimap">
      <div className={styles.header}>
        <span className={styles.title}>Map</span>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={mode === 'heading'}
          onClick={() => setMode((current) => (current === 'north' ? 'heading' : 'north'))}
          title={mode === 'north' ? 'North up: switch to heading up' : 'Heading up: switch to north up'}
        >
          {mode === 'north' ? 'N ↑' : 'Heading ↑'}
        </button>
        <button type="button" className={styles.toggle} onClick={() => setOpen(false)} aria-expanded aria-label="Hide map">
          ×
        </button>
      </div>
      <div ref={boxRef} className={styles.canvasBox}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onClick={handleClick}
          role="img"
          aria-label="Top-down map: click a place to select it, or walkable floor to route there"
        />
      </div>
      <p className={styles.legend} aria-hidden="true">
        <span className={styles.swatchWalk} /> walkable <span className={styles.swatchBlock} /> obstacle <span className={styles.swatchUnknown} /> unfilmed
      </p>
    </section>
  );
}
