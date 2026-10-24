import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewerCanvas } from './components/ViewerCanvas';
import { StatusPill } from './components/StatusPill';
import { loadSceneBundle } from './lib/sceneLoader';
import { findRoute, searchPois, worldToCell, type GridCell } from './lib/navigation';
import type { SceneBundle, Vec3 } from './types/scene';
import type { PlayCanvasViewer } from './engine/PlayCanvasViewer';

const DEFAULT_SCENE_URL = import.meta.env.VITE_SCENE_URL || '/scenes/fixture/manifest.json';
const SCENE_OPTIONS = [
  { value: '/scenes/fixture/manifest.json', label: 'Procedural fixture' },
  { value: '/scenes/glb-fixture/manifest.json', label: 'Generated GLB fixture' },
];
const requestedScene = new URLSearchParams(window.location.search).get('scene');
const INITIAL_SCENE_URL = requestedScene === 'glb' ? SCENE_OPTIONS[1].value : requestedScene?.startsWith('/scenes/') ? requestedScene : DEFAULT_SCENE_URL;

function formatPosition(position: Vec3): string {
  return `${position[0].toFixed(1)}, ${position[2].toFixed(1)}`;
}

export default function App() {
  const [bundle, setBundle] = useState<SceneBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [position, setPosition] = useState<Vec3>([0, 0, 0]);
  const [cell, setCell] = useState<GridCell>({ x: 0, z: 0 });
  const [viewerStatus, setViewerStatus] = useState('Loading scene bundle…');
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [isWalkthroughActive, setIsWalkthroughActive] = useState(false);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [sceneUrl, setSceneUrl] = useState(INITIAL_SCENE_URL);
  const viewerRef = useRef<PlayCanvasViewer | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadScene = useCallback(async () => {
    setLoadError(null);
    setViewerStatus('Validating scene manifest…');
    try {
      const nextBundle = await loadSceneBundle(sceneUrl);
      setBundle(nextBundle);
      setIsViewerReady(false);
      setSelectedPoiId(null);
      setCaptureMessage(null);
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
    setCaptureMessage(null);
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

  const handleCapture = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const supported = files.filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (supported.length !== files.length) {
      setCaptureMessage('Some files were skipped. Choose JPG, PNG, HEIC or MP4 media.');
      return;
    }
    const totalMb = supported.reduce((total, file) => total + file.size, 0) / (1024 * 1024);
    setCaptureMessage(`${supported.length} capture file${supported.length === 1 ? '' : 's'} staged · ${totalMb.toFixed(1)} MB. Local processing is ready to run from the CLI.`);
  };

  if (loadError) {
    return (
      <main className="app-shell app-shell--error">
        <div className="error-card">
          <div className="brand-mark">NS</div>
          <p className="eyebrow">Namma Space / scene loader</p>
          <h1>Scene bundle unavailable</h1>
          <p>{loadError}</p>
          <button className="button button--primary" onClick={() => void loadScene()}>Retry scene load</button>
          <p className="helper">Expected fixture: <code>{sceneUrl}</code></p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">NS</div>
          <div><strong>Namma Space</strong><span>Spatial twin laboratory</span></div>
        </div>
        <div className="topbar-meta">
          <span className="system-indicator"><span className="status-dot" />Local runtime</span>
          <span className="topbar-divider" />
          <span className="muted">Round 01 / prototype</span>
        </div>
      </header>

      <section className="workspace-header">
        <div>
          <p className="eyebrow">Active venue / {bundle?.manifest.sceneKind === 'synthetic-demo' ? 'fixture environment' : 'captured environment'}</p>
          <h1>{bundle?.manifest.displayName ?? 'Loading venue…'}</h1>
           <p className="lede">{hasNavigation ? 'A browser-native digital twin with a verified walkable layer.' : 'A browser-native visual twin; navigation data is not available for this scene.'}</p>
        </div>
        <div className="workspace-actions">
          <label className="scene-switcher"><span>Scene</span><select value={sceneUrl} onChange={(event) => setSceneUrl(event.target.value)} aria-label="Choose demonstration scene">{SCENE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <StatusPill state={bundle?.quality.status === 'passed' ? 'validated' : 'needs-review'}>{bundle?.quality.status === 'passed' ? 'Scene validated' : 'Review required'}</StatusPill>
          <button className="button button--quiet" onClick={() => void loadScene()}>Reload bundle</button>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="viewer-card panel">
          <div className="viewer-toolbar">
            <div className="viewer-toolbar-title"><span className="live-marker" /> Live spatial view <span className="toolbar-slash">/</span> {viewerStatus}</div>
           <div className="viewer-toolbar-actions"><span className="coordinate-readout">X {position[0].toFixed(2)} · Z {position[2].toFixed(2)}</span><button className="icon-button" disabled={!isViewerReady} onClick={() => viewerRef.current?.reset()} aria-label="Reset viewpoint">Reset</button></div>
          </div>
          <div className="viewer-stage">
            {bundle && <ViewerCanvas manifest={bundle.manifest} manifestUrl={sceneUrl} navigation={bundle.navigation} pois={bundle.pois} onViewerReady={handleViewerReady} onViewerDestroyed={handleViewerDestroyed} onPosition={handlePosition} onStatus={handleViewerStatus} />}
            <div className="viewer-overlay viewer-overlay--top"><span className="scene-label">{hasGlbVisual ? 'SYNTHETIC DEMO / REAL GLB ASSET' : 'SYNTHETIC DEMO / PROCEDURAL ASSET'}</span><span className="compass">N ↑</span></div>
            <div className="viewer-overlay viewer-overlay--bottom"><span className="control-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move <span className="hint-separator" /> click scene for mouse look</span><button className="walkthrough-button" disabled={!isViewerReady} onClick={() => viewerRef.current?.enterWalkthrough()}>{isWalkthroughActive ? 'Walkthrough active' : 'Enter walkthrough'} <span>↗</span></button></div>
          </div>
        </div>

        <aside className="side-column">
          <section className="panel destination-panel">
            <div className="panel-heading"><div><p className="eyebrow">Spatial index</p><h2>Find a destination</h2></div><span className="panel-index">01</span></div>
             <div className="search-wrap"><input ref={searchInputRef} value={query} onChange={(event) => handleQueryChange(event.target.value)} placeholder="Search rooms, landmarks…" aria-label="Search points of interest" /><kbd>⌘ K</kbd></div>
            <div className="poi-list" role="listbox" aria-label="Points of interest">
              {results.map((poi) => <button key={poi.id} role="option" aria-selected={selectedPoiId === poi.id} className={`poi-row ${selectedPoiId === poi.id ? 'poi-row--selected' : ''}`} onClick={() => selectPoi(poi.id)}><span className="poi-copy"><strong>{poi.label}</strong><small>{poi.category} · {Math.round(poi.confidence * 100)}% confidence</small></span><span className="poi-arrow" aria-hidden="true">→</span></button>)}
              {results.length === 0 && <div className="empty-state">No verified destinations match “{query}”.</div>}
            </div>
             <div className="destination-actions"><button className="button button--primary" disabled={!selectedPoi || !isViewerReady || !hasNavigation} onClick={handleRoute}>Plot walking route <span>→</span></button><button className="button button--secondary" disabled={!selectedPoi || !isViewerReady || !hasNavigation} onClick={handleJump}>Jump to view</button></div>
            {selectedPoi && <div className="selection-card"><span className="selection-kicker">Selected destination</span><strong>{selectedPoi.label}</strong><p>{selectedPoi.description}</p><span className="selection-coordinates">Approach point · {formatPosition(selectedPoi.approachPoint)}</span></div>}
          </section>

          <section className="panel capture-panel">
            <div className="panel-heading"><div><p className="eyebrow">Capture to twin</p><h2>Stage new media</h2></div><span className="panel-index">02</span></div>
            <p className="panel-copy">Bring a slow, overlapping phone walk into the local pipeline. The browser stages media only; reconstruction runs independently through the CLI.</p>
            <label className="upload-zone"><input type="file" multiple accept="image/*,video/mp4,video/quicktime" onChange={handleCapture} /><span className="upload-plus" aria-hidden="true">+</span><strong>Choose video or photo set</strong><small>JPG · PNG · HEIC · MP4</small></label>
            {captureMessage && <div className="capture-message">{captureMessage}</div>}
            <div className="pipeline-status"><span className="pipeline-line pipeline-line--active" /><span className="pipeline-line" /><span className="pipeline-line" /><div className="pipeline-labels"><span>Input</span><span>Process</span><span>Publish</span></div></div>
          </section>
        </aside>
      </section>

       <section className="bottom-grid">
         <div className="panel provenance-panel"><div className="panel-heading"><div><p className="eyebrow">Scene dossier</p><h2>Verified provenance</h2></div><span className="panel-index">03</span></div><div className="provenance-grid"><div><span>Pipeline</span><strong>{bundle?.manifest.provenance.pipeline}</strong></div><div><span>Coordinate frame</span><strong>Y-up · metre</strong></div><div><span>Bounds</span><strong>{(bundle?.manifest.bounds.max[0] ?? 0) - (bundle?.manifest.bounds.min[0] ?? 0)}m × {(bundle?.manifest.bounds.max[2] ?? 0) - (bundle?.manifest.bounds.min[2] ?? 0)}m</strong></div><div><span>Navigation</span><strong className={bundle?.navigation ? 'text-good' : 'text-warn'}>{bundle?.navigation ? `${bundle.navigation.width} × ${bundle.navigation.height} grid` : 'Unavailable'}</strong></div></div></div>
         <div className="panel readiness-panel"><div className="readiness-score"><span className="score-ring">{hasNavigation ? '92' : '61'}</span><div><p className="eyebrow">Operational readiness</p><h2>{hasNavigation ? 'Walkable fixture' : 'Visual exploration only'}</h2><p>{hasNavigation ? 'Visual, geometry and route layers are available locally.' : 'The visual asset is available, but trusted walkability data is still missing.'}</p></div></div><div className="readiness-list"><span>Visual layer <b>Ready</b></span><span>Collision layer <b>{hasNavigation ? 'Ready' : 'Unavailable'}</b></span><span>POI index <b>Ready</b></span></div></div>
      </section>

      <footer className="footer"><span>Namma Space / an IIT Bombay Techfest 2026–27 prototype</span><span>Built for reliable spatial handoff <span className="footer-dot">·</span> no GPU required for fixture mode</span></footer>
    </main>
  );
}
