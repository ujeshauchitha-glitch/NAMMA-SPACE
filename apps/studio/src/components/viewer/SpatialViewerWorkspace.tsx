import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewerCanvas } from '../ViewerCanvas';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { Maximize, Minimize } from '../icons/icons';
import { loadSceneBundle } from '../../lib/sceneLoader';
import { findRoute, measureRouteMetres, searchPois, walkingDistance, worldToCell, type GridCell } from '../../lib/navigation';
import type { Poi, SceneBundle, Vec3 } from '../../types/scene';
import type { PlayCanvasViewer } from '../../engine/PlayCanvasViewer';
import { useWorkspaceStore } from '../../state/workspaceContext';
import { WorkspacePanel } from '../workspace/WorkspacePanel';
import { SceneSkeleton } from './SceneSkeleton';
import { SceneErrorPanel } from './SceneErrorPanel';
import { PoiSearch } from './PoiSearch';
import { DestinationDetail } from './DestinationDetail';
import { PoiCard } from './PoiCard';
import { PoiEditorPanel, type EditorTool } from './PoiEditorPanel';
import { approachIsWalkable, clearDraft, createPoi, exportPois, importPois, loadDraft, movePoi, saveDraft, type EditorContext } from '../../lib/poiEditor';
import type { FloorPoint } from '../../lib/poiIndex';
import { SceneDossier } from './SceneDossier';
import { Hud } from './Hud';
import { usePointerLock } from './usePointerLock';
import type { RouteState } from './RouteStatus';
import styles from './SpatialViewerWorkspace.module.css';

/**
 * 02 SPATIAL VIEWER (T14 — moved from src/components/workspace/) — the
 * production scene stage: lazy ViewerCanvas mount, §5.12 skeleton with real
 * status lines, honest failure panel with retry, camera-pose persistence and
 * restore through the T9 store, and a durable ?scene= URL contract.
 * The engine gem (PlayCanvasViewer) is consumed through its public API only —
 * its pose hooks are additive (D-013). Search/route UI is refined at T16,
 * HUD at T17.
 */

// Opens on our own classroom capture; tests pin the procedural fixture with VITE_SCENE_URL (playwright.config.ts).
// Scene bundles live under the deploy base (Vite's BASE_URL: '/' on Vercel, '/NAMMA-SPACE/' on GitHub Pages).
const scene = (name: string): string => `${import.meta.env.BASE_URL}scenes/${name}/manifest.json`;
const DEFAULT_SCENE_URL = import.meta.env.VITE_SCENE_URL || scene('classroom');
const SCENE_OPTIONS = [
  // Gaussian splats trained by pipeline/ (COLMAP + Brush): our classroom filmed on a phone, and Meta's Eyeful
  // Tower 'apartment', an external benchmark dataset (MIT licence, credited in its manifest).
  { value: scene('classroom'), label: 'Classroom: our phone capture (Gaussian splat)' },
  { value: scene('real-room'), label: 'Workshop room: our 70-photo capture (sparse model)' },
  { value: scene('apartment'), label: 'Apartment: external benchmark dataset (Meta Eyeful Tower, MIT)' },
  { value: scene('splat-fixture'), label: 'Synthetic Splat fixture (SOG)' },
  { value: scene('fixture'), label: 'Procedural fixture' },
  { value: scene('glb-fixture'), label: 'Generated GLB fixture' },
];

function resolveInitialSceneUrl(): string {
  const requestedScene = new URLSearchParams(window.location.search).get('scene');
  if (requestedScene === 'real' || requestedScene === 'room') return scene('real-room');
  if (requestedScene === 'glb') return scene('glb-fixture');
  if (requestedScene === 'splat') return scene('splat-fixture');
  if (requestedScene === 'fixture') return scene('fixture');
  if (requestedScene === 'classroom') return scene('classroom');
  if (requestedScene === 'apartment') return scene('apartment');
  if (requestedScene?.startsWith('/scenes/')) return `${import.meta.env.BASE_URL}${requestedScene.slice(1)}`;
  return DEFAULT_SCENE_URL;
}

/** Rounding-stable identity for a pose so identical measurements never re-save. */
function poseKey(position: Vec3, yawDegrees: number, pitchDegrees: number): string {
  return `${position[0].toFixed(3)},${position[1].toFixed(3)},${position[2].toFixed(3)}|${yawDegrees.toFixed(2)}|${pitchDegrees.toFixed(2)}`;
}

export type SpatialViewerWorkspaceProps = {
  /** Scene/processing state line mirrored into the shell live pill (§6.1). */
  onStateChange?: (label: string) => void;
};

export function SpatialViewerWorkspace({ onStateChange }: SpatialViewerWorkspaceProps) {
  const [bundle, setBundle] = useState<SceneBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  // POI card opened from the 3D view (pin, label or zone click), and the POI under the cursor/crosshair.
  const [cardPoiId, setCardPoiId] = useState<string | null>(null);
  const [hoveredPoiId, setHoveredPoiId] = useState<string | null>(null);
  // In-app POI editor (toggle, or ?edit=1). A draft lives in localStorage per scene and, while it
  // exists, replaces the scene's shipped POIs everywhere in this browser.
  const [editMode, setEditMode] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('edit') === '1');
  const [draftPois, setDraftPois] = useState<Poi[] | null>(null);
  const [editTool, setEditTool] = useState<EditorTool>('select');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zoneDraft, setZoneDraft] = useState<FloorPoint[]>([]);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [position, setPosition] = useState<Vec3>([0, 0, 0]);
  const [cell, setCell] = useState<GridCell>({ x: 0, z: 0 });
  const [viewerStatus, setViewerStatus] = useState('Loading scene bundle…');
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [sceneUrl, setSceneUrl] = useState(resolveInitialSceneUrl);
  // T16 · last plot outcome for the route strip (§5.16) — idle until plotted.
  const [routeState, setRouteState] = useState<RouteState>({ status: 'idle' });
  const [isFullscreen, setIsFullscreen] = useState(() => {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fullscreen') === 'true';
  });
  const viewerRef = useRef<PlayCanvasViewer | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (viewerContainerRef.current?.requestFullscreen) {
          await viewerContainerRef.current.requestFullscreen();
          setIsFullscreen(true);
        } else {
          setIsFullscreen((prev) => !prev);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        if (document.pointerLockElement !== null) return;
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen]);

  // T14 · pose persistence (T9 store, keyed by scene URL).
  const { state, dispatch, hydrated } = useWorkspaceStore();
  const poseKeyRef = useRef<string | null>(null);
  const poseTimerRef = useRef<number | undefined>(undefined);
  const poseRestoredRef = useRef<string | null>(null);
  // Stable-identity bridges: handlePosition keeps `[]` deps so the engine
  // mount effect never churns (a re-mount would drop the in-flight pose) —
  // these refs always point at the latest pose machinery.
  const persistRef = useRef<() => void>(() => undefined);
  const scheduleRef = useRef<() => void>(() => undefined);

  // Mirror scene state into the shell's polite live region (§8.4: stage changes).
  useEffect(() => {
    onStateChange?.(viewerStatus);
  }, [viewerStatus, onStateChange]);

  const loadScene = useCallback(async () => {
    setLoadError(null);
    setBundle(null); // scene transition: unmount the old canvas (single context), show the skeleton
    poseKeyRef.current = null;
    setViewerStatus('Validating scene manifest…');
    try {
      const nextBundle = await loadSceneBundle(sceneUrl);
      setBundle(nextBundle);
      setDraftPois(loadDraft(typeof window === 'undefined' ? undefined : window.localStorage, nextBundle.manifest.sceneId));
      setEditingId(null);
      setZoneDraft([]);
      setIsViewerReady(false);
      setSelectedPoiId(null);
      setPosition(nextBundle.manifest.startPosition);
      setCell(nextBundle.navigation ? worldToCell(nextBundle.navigation, nextBundle.manifest.startPosition) : { x: 0, z: 0 });
      setViewerStatus('Scene validated · ready to explore');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The scene bundle could not be loaded.');
      setViewerStatus('Scene unavailable');
    }
  }, [sceneUrl]);

  useEffect(() => {
    void loadScene();
  }, [loadScene]);

  // T14 · scene durability: the chosen scene lives in the URL (?scene=), so a
  // reload restores it; unrelated params (e.g. ?workspace=) are preserved.
  const handleSceneChange = (value: string) => {
    setSceneUrl(value);
    const params = new URLSearchParams(window.location.search);
    params.set('scene', value);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  };

  /* ---------------- T14 · camera pose persist + restore ---------------- */

  const persistPose = useCallback(() => {
    if (!hydrated) return; // never write before the durable snapshot has landed
    const viewer = viewerRef.current;
    if (!viewer) return;
    const pose = viewer.getPose();
    const key = poseKey(pose.position, pose.yawDegrees, pose.pitchDegrees);
    if (poseKeyRef.current === key) return;
    poseKeyRef.current = key;
    const yawRadians = (pose.yawDegrees * Math.PI) / 180;
    dispatch({
      type: 'camera/upsertPose',
      id: sceneUrl,
      label: `Viewpoint · ${sceneUrl}`,
      position: { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
      // Honest derived look-target: one metre ahead on the horizontal plane.
      target: {
        x: pose.position[0] + Math.sin(yawRadians),
        y: pose.position[1],
        z: pose.position[2] + Math.cos(yawRadians),
      },
      yawDegrees: pose.yawDegrees,
      pitchDegrees: pose.pitchDegrees,
    });
  }, [dispatch, hydrated, sceneUrl]);

  // Coalesce movement bursts (walk, route tween) into one durable save.
  const schedulePosePersist = useCallback(() => {
    window.clearTimeout(poseTimerRef.current);
    poseTimerRef.current = window.setTimeout(() => {
      poseTimerRef.current = undefined;
      persistPose();
    }, 400);
  }, [persistPose]);

  // Keep the stable-identity callbacks wired to the latest pose machinery
  // (the engine mount effect depends on their identities — never churn them).
  useEffect(() => {
    persistRef.current = persistPose;
    scheduleRef.current = schedulePosePersist;
  });

  useEffect(() => () => window.clearTimeout(poseTimerRef.current), []);

  // Restore the saved viewpoint exactly once per scene per mount, and only
  // after hydration + viewer readiness (never against an empty store).
  useEffect(() => {
    if (!hydrated || !isViewerReady) return;
    if (poseRestoredRef.current === sceneUrl) return;
    poseRestoredRef.current = sceneUrl;
    const saved = state.cameraPoses.find((pose) => pose.id === sceneUrl);
    if (!saved) return;
    const position: Vec3 = [saved.position.x, saved.position.y, saved.position.z];
    const yawDegrees = saved.yawDegrees ?? 0;
    const pitchDegrees = saved.pitchDegrees ?? 0;
    // Seed the dedupe key so the restore itself never re-dispatches a save.
    poseKeyRef.current = poseKey(position, yawDegrees, pitchDegrees);
    viewerRef.current?.setPose({ position, yawDegrees, pitchDegrees });
  }, [hydrated, isViewerReady, sceneUrl, state.cameraPoses]);

  // T17 · hint visibility rides the shared pointer-lock state; pose persist
  // still fires on every real lock/exit transition (look-around changes yaw).
  const { locked: isWalkthroughActive, hintVisible } = usePointerLock({
    onLockChange: () => persistRef.current(),
  });

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  // T16 · Esc deselects the destination and clears the 3D selection (§5.15).
  // Skipped while pointer-locked so the engine owns walkthrough exit.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.pointerLockElement !== null) return;
      if (!selectedPoiId) return;
      setCardPoiId(null);
      setSelectedPoiId(null);
      viewerRef.current?.selectPoi(null);
      viewerRef.current?.clearRoute();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPoiId]);

  // T16 · a new destination (or scene) invalidates the previous plot (§5.16)
  // and its 3D tape — the strip reset must clear the scene too (review F1).
  // Optional chaining: on scene change the viewer may already be destroyed
  // (viewerRef nulled by handleViewerDestroyed before this effect runs).
  useEffect(() => {
    setRouteState({ status: 'idle' });
    viewerRef.current?.clearRoute();
  }, [selectedPoiId, sceneUrl]);

  // A different selection (e.g. from search) closes a card opened for another POI.
  useEffect(() => {
    setCardPoiId((current) => (current && current !== selectedPoiId ? null : current));
  }, [selectedPoiId]);

  const scenePois = useMemo(() => draftPois ?? bundle?.pois ?? [], [draftPois, bundle?.pois]);
  const selectedPoi = scenePois.find((poi) => poi.id === selectedPoiId) ?? null;
  const cardPoi = scenePois.find((poi) => poi.id === cardPoiId) ?? null;
  // Recomputed when the visitor moves to another grid cell, not on every sub-cell step.
  const cardWalkMetres = useMemo(
    () => (cardPoi && bundle?.navigation ? walkingDistance(bundle.navigation, position, cardPoi) : undefined),
    [cardPoi, bundle?.navigation, cell.x, cell.z],
  );
  const results = useMemo(() => searchPois(scenePois, query), [scenePois, query]);
  const hasGlbVisual = bundle?.manifest.visualAssets.some((asset) => asset.kind === 'glb' || asset.kind === 'gltf') ?? false;
  const hasSplatVisual = bundle?.manifest.visualAssets.some((asset) => asset.kind === 'ply' || asset.kind === 'sog') ?? false;
  const sceneOrigin = bundle?.manifest.sceneKind === 'reconstructed-capture' ? 'reconstructed capture' : 'synthetic';
  // What the visual layer actually is, so a real capture is never labelled a fixture.
  const sceneMeta = hasSplatVisual ? `Gaussian splat · ${sceneOrigin}`
    : hasGlbVisual ? (sceneOrigin === 'synthetic' ? 'GLB · textured mesh fixture' : `GLB · ${sceneOrigin}`)
    : 'Procedural fixture asset';
  const hasNavigation = bundle?.navigation != null;
  const isSimulated = bundle?.manifest.sceneKind === 'synthetic-demo';

  const handleViewerReady = useCallback((viewer: PlayCanvasViewer) => {
    viewerRef.current = viewer;
    setIsViewerReady(true);
  }, []);
  const handleViewerDestroyed = useCallback(() => {
    viewerRef.current = null;
    setIsViewerReady(false);
  }, []);
  const handlePosition = useCallback((nextPosition: Vec3, nextCell: GridCell) => {
    setPosition(nextPosition);
    setCell(nextCell);
    scheduleRef.current();
  }, []);
  const handleViewerStatus = useCallback((status: string) => {
    setViewerStatus(status);
  }, []);
  // Stable identities: the engine mount effect depends on these callbacks.
  const handlePoiClick = useCallback((poiId: string, viaCrosshair: boolean) => {
    setSelectedPoiId(poiId);
    setCardPoiId(poiId);
    viewerRef.current?.selectPoi(poiId);
    viewerRef.current?.pulseSelection(poiId);
    // The card needs the mouse: a crosshair click releases pointer lock.
    if (viaCrosshair) document.exitPointerLock();
  }, []);
  const handlePoiHover = useCallback((poiId: string | null) => setHoveredPoiId(poiId), []);

  /* ---------------- POI editor ---------------- */

  const editorContext: EditorContext | null = bundle
    ? { grid: bundle.navigation, floorY: bundle.manifest.bounds.min[1], eyeY: bundle.manifest.startPosition[1] }
    : null;
  /** Apply an edit to the draft (starting one from the shipped POIs on the first edit). */
  const editPois = (change: (pois: Poi[]) => Poi[]) => setDraftPois((current) => change(current ?? bundle?.pois ?? []));

  // Keep the engine's POIs in step with the draft without reloading the scene.
  useEffect(() => {
    if (isViewerReady) viewerRef.current?.setPois(scenePois);
  }, [isViewerReady, scenePois]);
  useEffect(() => {
    if (isViewerReady) viewerRef.current?.setEditMode(editMode);
  }, [isViewerReady, editMode]);
  useEffect(() => {
    if (isViewerReady) viewerRef.current?.setDraftZone(editMode && editTool === 'zone' ? zoneDraft : []);
  }, [isViewerReady, editMode, editTool, zoneDraft]);
  // Autosave the draft per scene.
  useEffect(() => {
    if (draftPois && bundle) saveDraft(window.localStorage, bundle.manifest.sceneId, draftPois);
  }, [draftPois, bundle]);

  const handleEditClick = (floor: FloorPoint | null, poiId: string | null) => {
    if (!editorContext) return;
    setEditMessage(null);
    if (editTool === 'place') {
      if (!floor) return setEditMessage('Click on the floor to place a POI.');
      const created = createPoi(editorContext, floor, scenePois);
      editPois((pois) => [...pois, created]);
      setEditingId(created.id);
      setEditTool('select');
      return;
    }
    if (editTool === 'zone') {
      if (floor) setZoneDraft((points) => [...points, floor]);
      return;
    }
    if (poiId) setEditingId(poiId);
  };
  const handleEditMoveEnd = (poiId: string, floor: FloorPoint) => {
    if (!editorContext) return;
    editPois((pois) => pois.map((poi) => (poi.id === poiId ? movePoi(editorContext, poi, floor) : poi)));
    setEditingId(poiId);
  };
  // Stable identities for the engine (its mount effect depends on them); the latest handlers live in a ref.
  const editHandlersRef = useRef({ click: handleEditClick, moveEnd: handleEditMoveEnd });
  useEffect(() => {
    editHandlersRef.current = { click: handleEditClick, moveEnd: handleEditMoveEnd };
  });
  const onEditClick = useCallback((floor: FloorPoint | null, poiId: string | null) => editHandlersRef.current.click(floor, poiId), []);
  const onEditMoveEnd = useCallback((poiId: string, floor: FloorPoint) => editHandlersRef.current.moveEnd(poiId, floor), []);

  const handleExport = () => {
    try {
      const blob = new Blob([exportPois(scenePois)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pois.json';
      link.click();
      URL.revokeObjectURL(url);
      setEditMessage(`Exported ${scenePois.length} POIs. Put the file at semantic/pois.json in the scene bundle.`);
    } catch (error) {
      setEditMessage(`Cannot export yet: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  };
  const handleImport = (file: File) => {
    void file.text().then((text) => {
      try {
        const imported = importPois(text);
        setDraftPois(imported);
        setEditingId(null);
        setEditMessage(`Imported ${imported.length} POIs from ${file.name}.`);
      } catch (error) {
        setEditMessage(error instanceof Error ? error.message : String(error));
      }
    });
  };
  const handleDiscard = () => {
    if (bundle) clearDraft(window.localStorage, bundle.manifest.sceneId);
    setDraftPois(null);
    setEditingId(null);
    setZoneDraft([]);
    setEditMessage('Draft discarded; showing the shipped POIs.');
  };
  const editingPoi = scenePois.find((poi) => poi.id === editingId) ?? null;
  // T17 · compass needle samples the live pose; [] keeps a stable identity.
  const getYaw = useCallback(() => viewerRef.current?.getPose().yawDegrees ?? null, []);

  useEffect(() => {
    if (isViewerReady) viewerRef.current?.selectPoi(selectedPoiId);
  }, [isViewerReady, selectedPoiId]);

  const selectPoi = (poiId: string) => {
    setSelectedPoiId(poiId);
    viewerRef.current?.selectPoi(poiId);
    viewerRef.current?.pulseSelection(poiId);
  };

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    if (selectedPoiId && !searchPois(scenePois, nextQuery).some((poi) => poi.id === selectedPoiId)) {
      setSelectedPoiId(null);
      viewerRef.current?.selectPoi(null);
    }
  };

  const handleRoute = () => {
    if (!selectedPoi || !bundle || !bundle.navigation) {
      // Defensive: the card already disables the action without navigation.
      setRouteState({ status: 'error', detail: 'Navigation data is unavailable for this scene.', reason: 'missing-nav' });
      return;
    }
    const goal = worldToCell(bundle.navigation, selectedPoi.approachPoint);
    const result = findRoute(bundle.navigation, cell, goal);
    if (!result.ok) {
      // Honest failure: the strip carries the A* detail verbatim; the engine's
      // status line is left alone so the shell pill never shows route errors.
      // The engine clears any earlier tape even when a plot fails, so mirror
      // that here (review F1) — no stale tape behind an error strip.
      setRouteState({ status: 'error', detail: result.detail, reason: result.reason });
      viewerRef.current?.clearRoute();
      return;
    }
    // Claim success only once the engine has actually drawn the tape
    // (review F4: never optimistic). The engine re-runs the same A* from its
    // own live pose, so a false here means the plot did not happen.
    if (viewerRef.current?.routeTo(selectedPoi.id)) {
      viewerRef.current?.revealRouteTape();
      setRouteState({
        status: 'ok',
        // Raw metres; RouteStatus rounds once at display time (review F5).
        metres: measureRouteMetres(result.world),
        cells: result.cells.length,
      });
      return;
    }
    // routeTo refused: it recomputed from its live pose, so report that
    // actual outcome instead of the optimistic one.
    const pose = viewerRef.current?.getPose();
    const live = findRoute(
      bundle.navigation,
      pose ? worldToCell(bundle.navigation, pose.position) : cell,
      goal,
    );
    if (live.ok) {
      // Unreachable: routeTo just ran this identical query and returned
      // false. Nothing was drawn, so report no plot rather than a fake one.
      setRouteState({ status: 'idle' });
    } else {
      setRouteState({ status: 'error', detail: live.detail, reason: live.reason });
    }
  };

  const handleClearRoute = () => {
    setRouteState({ status: 'idle' });
    viewerRef.current?.clearRoute();
  };

  const handleJump = () => {
    if (!selectedPoi) return;
    viewerRef.current?.jumpToSmooth(selectedPoi.id);
  };

  return (
    <WorkspacePanel id="viewer">
      <div
        ref={viewerContainerRef}
        className={`${styles.viewer} ${isFullscreen ? styles.fullscreenMode : ''}`}
      >
        <div className={styles.stageColumn}>
          <header className={styles.stageHeader}>
            <div>
              <p className={styles.eyebrow}>{`Active venue / ${bundle?.manifest.sceneKind === 'synthetic-demo' ? 'fixture environment' : 'captured environment'}`}</p>
              <h1 className={styles.title}>{bundle?.manifest.displayName ?? 'Loading venue…'}</h1>
              <p className={styles.lede}>{hasNavigation ? 'A browser-native digital twin with a verified walkable layer.' : 'A browser-native visual twin; navigation data is not available for this scene.'}</p>
            </div>
            <div className={styles.headerActions}>
              <label className={styles.sceneSwitcher}>
                <span>Scene</span>
                <select value={sceneUrl} onChange={(event) => handleSceneChange(event.target.value)} aria-label="Choose demonstration scene">
                  {SCENE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <StatusPill state={bundle?.quality.status === 'passed' ? 'validated' : 'needs-review'}>
                {bundle?.quality.status === 'passed' ? 'Scene validated' : 'Review required'}
              </StatusPill>
              <Button variant={editMode ? 'primary' : 'quiet'} aria-pressed={editMode} onClick={() => setEditMode((on) => !on)}>
                {editMode ? 'Done editing' : 'Edit POIs'}
              </Button>
              <Button variant="quiet" onClick={() => void loadScene()}>Reload bundle</Button>
            </div>
          </header>

          {loadError ? (
            <SceneErrorPanel message={loadError} sceneUrl={sceneUrl} onRetry={() => void loadScene()} />
          ) : (
            <div className={styles.viewport}>
              <div className={styles.toolbar}>
                <div className={styles.toolbarTitle}>
                  <span className={styles.liveMarker} aria-hidden="true" />
                  Live spatial view {isFullscreen && '· Full Screen (Press F or Esc to exit)'}
                </div>
                <div className={styles.toolbarActions}>
                  <Button
                    variant="quiet"
                    onClick={() => void toggleFullscreen()}
                    trailingIcon={isFullscreen ? <Minimize /> : <Maximize />}
                  >
                    {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                  </Button>
                </div>
              </div>
              <div
                className={styles.stage}
                role="application"
                aria-label={`${bundle?.manifest.displayName ?? 'Spatial scene'} interactive 3D view`}
              >
                {bundle && (
                  <ViewerCanvas
                    manifest={bundle.manifest}
                    manifestUrl={sceneUrl}
                    navigation={bundle.navigation}
                    pois={bundle.pois}
                    onViewerReady={handleViewerReady}
                    onViewerDestroyed={handleViewerDestroyed}
                    onPosition={handlePosition}
                    onStatus={handleViewerStatus}
                    labelLayerRef={labelLayerRef}
                    onPoiClick={handlePoiClick}
                    onPoiHover={handlePoiHover}
                    onEditClick={onEditClick}
                    onEditMoveEnd={onEditMoveEnd}
                  />
                )}
                <div ref={labelLayerRef} className={styles.labelLayer} aria-hidden="true" />
                {isWalkthroughActive && (
                  <div className={`${styles.crosshair} ${hoveredPoiId ? styles.crosshairActive : ''}`} aria-hidden="true" />
                )}
                {cardPoi && (
                  <PoiCard
                    poi={cardPoi}
                    walkMetres={cardWalkMetres}
                    disabled={!isViewerReady}
                    onRoute={handleRoute}
                    onGoTo={handleJump}
                    onClose={() => setCardPoiId(null)}
                  />
                )}
                {!isViewerReady && (
                  <SceneSkeleton statusLine={bundle ? '' : viewerStatus} />
                )}
                {bundle && (
                  <Hud
                    sceneLabel={bundle.manifest.displayName}
                    sceneMeta={sceneMeta}
                    isSimulated={isSimulated}
                    position={position}
                    selectedPoiName={selectedPoi?.label ?? null}
                    isWalkthroughActive={isWalkthroughActive}
                    hintVisible={hintVisible}
                    isViewerReady={isViewerReady}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                    onEnterWalkthrough={() => viewerRef.current?.enterWalkthrough()}
                    onReset={() => viewerRef.current?.reset()}
                    getYaw={getYaw}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <aside className={styles.rail}>
          {editMode && (
            <section className={styles.panel}>
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.eyebrow}>POI editor</p>
                  <h2 className={styles.panelTitle}>Edit points of interest</h2>
                </div>
              </div>
              <PoiEditorPanel
                pois={scenePois}
                selectedId={editingId}
                tool={editTool}
                zonePointCount={zoneDraft.length}
                approachWalkable={editingPoi ? approachIsWalkable(bundle?.navigation ?? null, editingPoi) : true}
                hasDraft={draftPois !== null}
                message={editMessage}
                onTool={(tool) => {
                  setEditTool(tool);
                  setZoneDraft([]);
                }}
                onSelect={setEditingId}
                onChange={(changed) => editPois((pois) => pois.map((poi) => (poi.id === changed.id ? changed : poi)))}
                onDelete={(poiId) => {
                  editPois((pois) => pois.filter((poi) => poi.id !== poiId));
                  setEditingId(null);
                }}
                onFinishZone={() => {
                  if (!editingId || zoneDraft.length < 3) return;
                  const zone = zoneDraft;
                  editPois((pois) => pois.map((poi) => (poi.id === editingId ? { ...poi, zone } : poi)));
                  setZoneDraft([]);
                  setEditTool('select');
                }}
                onCancelZone={() => setZoneDraft([])}
                onRemoveZone={(poiId) => editPois((pois) => pois.map((poi) => (poi.id === poiId ? { ...poi, zone: undefined } : poi)))}
                onExport={handleExport}
                onImport={handleImport}
                onDiscard={handleDiscard}
              />
            </section>
          )}
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Spatial index</p>
                <h2 className={styles.panelTitle}>Find a destination</h2>
              </div>
              <span className={styles.panelIndex}>01</span>
            </div>
            <PoiSearch
              results={results}
              query={query}
              selectedPoiId={selectedPoiId}
              onQueryChange={handleQueryChange}
              onSelect={selectPoi}
              inputRef={searchInputRef}
            />
            {selectedPoi && (
              <DestinationDetail
                poi={selectedPoi}
                routeState={routeState}
                hasNavigation={hasNavigation}
                disabled={!isViewerReady}
                onRoute={handleRoute}
                onJump={handleJump}
                onClearRoute={handleClearRoute}
              />
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Scene dossier</p>
                <h2 className={styles.panelTitle}>Verified provenance</h2>
              </div>
              <span className={styles.panelIndex}>02</span>
            </div>
            <SceneDossier bundle={bundle} />
          </section>
        </aside>
      </div>
    </WorkspacePanel>
  );
}
