import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewerCanvas } from '../ViewerCanvas';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/TextField';
import { ChevronRight, Jump, Reset as ResetIcon, Route as RouteIcon } from '../icons/icons';
import { loadSceneBundle } from '../../lib/sceneLoader';
import { findRoute, searchPois, worldToCell, type GridCell } from '../../lib/navigation';
import type { SceneBundle, Vec3 } from '../../types/scene';
import type { PlayCanvasViewer } from '../../engine/PlayCanvasViewer';
import { WorkspacePanel } from './WorkspacePanel';
import styles from './SpatialViewerWorkspace.module.css';

/**
 * 02 SPATIAL VIEWER — the existing single-screen viewer, preserved through
 * the shell refactor (T8). Scene load/search/route/jump behavior is a 1:1
 * port of the pre-shell App.tsx monolith; the engine gem
 * (PlayCanvasViewer) is consumed through its public API only.
 * Capture staging migrated to 01 CAPTURE STUDIO at T12 (deviation #3 closed).
 */

const DEFAULT_SCENE_URL = import.meta.env.VITE_SCENE_URL || '/scenes/fixture/manifest.json';
const SCENE_OPTIONS = [
  { value: '/scenes/fixture/manifest.json', label: 'Procedural fixture' },
  { value: '/scenes/glb-fixture/manifest.json', label: 'Generated GLB fixture' },
];

function resolveInitialSceneUrl(): string {
  const requestedScene = new URLSearchParams(window.location.search).get('scene');
  if (requestedScene === 'glb') return SCENE_OPTIONS[1].value;
  if (requestedScene?.startsWith('/scenes/')) return requestedScene;
  return DEFAULT_SCENE_URL;
}

function formatPosition(position: Vec3): string {
  return `${position[0].toFixed(1)}, ${position[2].toFixed(1)}`;
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
  const [position, setPosition] = useState<Vec3>([0, 0, 0]);
  const [cell, setCell] = useState<GridCell>({ x: 0, z: 0 });
  const [viewerStatus, setViewerStatus] = useState('Loading scene bundle…');
  const [isWalkthroughActive, setIsWalkthroughActive] = useState(false);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [sceneUrl, setSceneUrl] = useState(resolveInitialSceneUrl);
  const viewerRef = useRef<PlayCanvasViewer | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mirror scene state into the shell's polite live region (§8.4: stage changes).
  useEffect(() => {
    onStateChange?.(viewerStatus);
  }, [viewerStatus, onStateChange]);

  const loadScene = useCallback(async () => {
    setLoadError(null);
    setViewerStatus('Validating scene manifest…');
    try {
      const nextBundle = await loadSceneBundle(sceneUrl);
      setBundle(nextBundle);
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

  useEffect(() => {
    const onPointerLock = () => setIsWalkthroughActive(document.pointerLockElement !== null);
    document.addEventListener('pointerlockchange', onPointerLock);
    return () => document.removeEventListener('pointerlockchange', onPointerLock);
  }, []);

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

  const selectedPoi = bundle?.pois.find((poi) => poi.id === selectedPoiId) ?? null;
  const results = useMemo(() => searchPois(bundle?.pois ?? [], query), [bundle?.pois, query]);
  const hasGlbVisual = bundle?.manifest.visualAssets.some((asset) => asset.kind === 'glb' || asset.kind === 'gltf') ?? false;
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
  }, []);
  const handleViewerStatus = useCallback((status: string) => {
    setViewerStatus(status);
  }, []);

  useEffect(() => {
    if (isViewerReady) viewerRef.current?.selectPoi(selectedPoiId);
  }, [isViewerReady, selectedPoiId]);

  const selectPoi = (poiId: string) => {
    setSelectedPoiId(poiId);
    viewerRef.current?.selectPoi(poiId);
  };

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    if (selectedPoiId && !searchPois(bundle?.pois ?? [], nextQuery).some((poi) => poi.id === selectedPoiId)) {
      setSelectedPoiId(null);
      viewerRef.current?.selectPoi(null);
    }
  };

  const handleRoute = () => {
    if (!selectedPoi || !bundle || !bundle.navigation) {
      setViewerStatus('Navigation data is unavailable for this scene');
      return;
    }
    const result = findRoute(bundle.navigation, cell, worldToCell(bundle.navigation, selectedPoi.approachPoint));
    if (!result.ok) {
      setViewerStatus(result.detail);
      return;
    }
    viewerRef.current?.routeTo(selectedPoi.id);
  };

  const handleJump = () => {
    if (!selectedPoi) return;
    viewerRef.current?.jumpTo(selectedPoi.id);
  };

  return (
    <WorkspacePanel id="viewer">
      <div className={styles.viewer}>
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
                <select value={sceneUrl} onChange={(event) => setSceneUrl(event.target.value)} aria-label="Choose demonstration scene">
                  {SCENE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <StatusPill state={bundle?.quality.status === 'passed' ? 'validated' : 'needs-review'}>
                {bundle?.quality.status === 'passed' ? 'Scene validated' : 'Review required'}
              </StatusPill>
              <Button variant="quiet" onClick={() => void loadScene()}>Reload bundle</Button>
            </div>
          </header>

          {loadError ? (
            <div className={styles.errorPanel}>
              <h2 className={styles.errorTitle}>Scene bundle unavailable</h2>
              <p className={styles.errorBody}>{loadError}</p>
              <div>
                <Button variant="primary" onClick={() => void loadScene()}>Retry scene load</Button>
              </div>
              <p className={styles.helper}>{`Expected fixture: ${sceneUrl}`}</p>
            </div>
          ) : (
            <div className={styles.viewport}>
              <div className={styles.toolbar}>
                <div className={styles.toolbarTitle}>
                  <span className={styles.liveMarker} aria-hidden="true" />
                  Live spatial view
                </div>
                <div className={styles.toolbarActions}>
                  <span className={styles.coordinates}>{`X ${position[0].toFixed(2)} · Z ${position[2].toFixed(2)}`}</span>
                  <Button variant="icon" disabled={!isViewerReady} onClick={() => viewerRef.current?.reset()} aria-label="Reset viewpoint">
                    <ResetIcon />
                  </Button>
                </div>
              </div>
              <div className={styles.stage}>
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
                  />
                )}
                <div className={`${styles.overlay} ${styles.overlayTop} hud`}>
                  <span className={styles.hudChip}>
                    {/* Mandatory, non-dismissible synthetic label derived from sceneKind (§5.19). */}
                    {isSimulated && <StatusPill state="simulated">SIMULATED</StatusPill>}
                    <span className={styles.hudMeta}>{hasGlbVisual ? 'GLB · textured mesh fixture' : 'Procedural fixture asset'}</span>
                  </span>
                  <span className={styles.hudChip}>N ↑</span>
                </div>
                <div className={`${styles.overlay} ${styles.overlayBottom} hud`}>
                  <span className={styles.hudChip}>
                    <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
                    <span className={styles.hudMeta}>move · click scene for mouse look · Esc exits walkthrough</span>
                  </span>
                  <Button
                    variant="signal"
                    className={styles.hudButton}
                    disabled={!isViewerReady}
                    onClick={() => viewerRef.current?.enterWalkthrough()}
                    trailingIcon={<Jump />}
                  >
                    {isWalkthroughActive ? 'Walkthrough active' : 'Enter walkthrough'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className={styles.rail}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Spatial index</p>
                <h2 className={styles.panelTitle}>Find a destination</h2>
              </div>
              <span className={styles.panelIndex}>01</span>
            </div>
            <SearchField
              ref={searchInputRef}
              label="Search points of interest"
              placeholder="Search rooms, landmarks…"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
            />
            <div className={styles.poiList} role="listbox" aria-label="Points of interest">
              {results.map((poi) => (
                <button
                  key={poi.id}
                  role="option"
                  aria-selected={selectedPoiId === poi.id}
                  className={`${styles.poiRow} ${selectedPoiId === poi.id ? styles.poiRowSelected : ''}`}
                  onClick={() => selectPoi(poi.id)}
                >
                  <span className={styles.poiCopy}>
                    <strong>{poi.label}</strong>
                    <small>{`${poi.category} · ${Math.round(poi.confidence * 100)}% confidence`}</small>
                  </span>
                  <ChevronRight className={styles.poiArrow} />
                </button>
              ))}
              {results.length === 0 && <p className={styles.poiEmpty}>{`No verified destinations match “${query}”.`}</p>}
            </div>
            <div className={styles.destinationActions}>
              <Button
                variant="primary"
                icon={<RouteIcon />}
                disabled={!selectedPoi || !isViewerReady || !hasNavigation}
                onClick={handleRoute}
              >
                Plot walking route
              </Button>
              <Button variant="secondary" disabled={!selectedPoi || !isViewerReady || !hasNavigation} onClick={handleJump}>
                Jump to view
              </Button>
            </div>
            {selectedPoi && (
              <div className={styles.selectionCard}>
                <span className={styles.selectionKicker}>Selected destination</span>
                <strong className={styles.selectionTitle}>{selectedPoi.label}</strong>
                <p className={styles.selectionBody}>{selectedPoi.description}</p>
                <span className={styles.selectionMeta}>{`Approach point · ${formatPosition(selectedPoi.approachPoint)}`}</span>
              </div>
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
            <div className={styles.provenanceGrid}>
              <div><span>Pipeline</span><strong>{bundle?.manifest.provenance.pipeline}</strong></div>
              <div><span>Coordinate frame</span><strong>Y-up · metre</strong></div>
              <div><span>Bounds</span><strong>{`${(bundle?.manifest.bounds.max[0] ?? 0) - (bundle?.manifest.bounds.min[0] ?? 0)}m × ${(bundle?.manifest.bounds.max[2] ?? 0) - (bundle?.manifest.bounds.min[2] ?? 0)}m`}</strong></div>
              <div><span>Navigation</span><strong>{hasNavigation ? `${bundle?.navigation?.width} × ${bundle?.navigation?.height} grid` : 'Unavailable'}</strong></div>
            </div>
            <div className={styles.readinessList}>
              <span>Visual layer <b>Ready</b></span>
              <span>Collision layer <b>{hasNavigation ? 'Ready' : 'Unavailable'}</b></span>
              <span>POI index <b>Ready</b></span>
            </div>
          </section>
        </aside>
      </div>
    </WorkspacePanel>
  );
}
