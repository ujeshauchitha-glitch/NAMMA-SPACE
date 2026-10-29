import {
  Application,
  Asset,
  Color,
  Entity,
  FILLMODE_NONE,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3 as PcVec3,
} from 'playcanvas';
import type { AssetRef, NavigationGrid, Poi, SceneManifest, Vec3 } from '../types/scene';
import { findRoute, isWalkable, worldToCell, type GridCell } from '../lib/navigation';
import { resolveWalkableStep } from '../lib/movement';
import { assetFailureMessage, resolveSceneUri, verifyAssetIntegrity } from '../lib/sceneLoader';
// T15 additive: pure tween/cancel math for the motion API (no control flow).
import { advanceTween, createTween, easeInOutCubic, easeOutExpo, lerp, lerpAngleDeg, revealCount, resolveTweenDuration } from './tween';
import { resolveMotionPrefersReduced } from '../motion';

type ViewerCallbacks = {
  onStatus: (message: string) => void;
  onPosition: (position: Vec3, cell: GridCell) => void;
  onPointerLock: (locked: boolean) => void;
};

type ViewerOptions = {
  canvas: HTMLCanvasElement;
  manifestUrl: string;
  manifest: SceneManifest;
  navigation: NavigationGrid | null;
  pois: Poi[];
  callbacks: ViewerCallbacks;
};

const PLAYER_HEIGHT = 1.65;
const WALK_SPEED = 1.4; // normal indoor walking pace, m/s
const LOOK_SPEED = 0.12;

export class PlayCanvasViewer {
  private readonly app: Application;
  private readonly camera: Entity;
  private readonly yawPivot: Entity;
  private readonly pitchPivot: Entity;
  private readonly canvas: HTMLCanvasElement;
  private readonly manifest: SceneManifest;
  private readonly manifestUrl: string;
  private readonly navigation: NavigationGrid | null;
  private readonly maxPixelRatio: number;
  /** Captures are filmed with the phone roughly level, so steep views (ceiling, floor) are mostly unfilmed. */
  private readonly maxPitch: number;
  private frameTime = 1 / 60;
  private framesSinceResize = 0;
  private readonly pois: Poi[];
  private readonly callbacks: ViewerCallbacks;
  private readonly pressedKeys = new Set<string>();
  private readonly routeEntity: Entity;
  private readonly poiEntities = new Map<string, Entity>();
  private readonly sceneMaterials: StandardMaterial[] = [];
  private readonly loadedAssets: Asset[] = [];
  private routeMaterial: StandardMaterial | null = null;
  /** D3: one status line per held keypress when movement is unverifiable. */
  private movementNoticePending = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (document.pointerLockElement !== this.canvas && document.activeElement !== this.canvas) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      this.pressedKeys.add(event.code);
      event.preventDefault();
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent) => this.pressedKeys.delete(event.code);
  private readonly onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yawPivot.rotateLocal(0, -event.movementX * LOOK_SPEED, 0);
    this.pitchPivot.rotateLocal(-event.movementY * LOOK_SPEED, 0, 0);
    const pitch = this.pitchPivot.getLocalEulerAngles().x;
    this.pitchPivot.setLocalEulerAngles(Math.max(-this.maxPitch, Math.min(this.maxPitch, pitch)), 0, 0);
  };
  private readonly onPointerLockChange = () => this.callbacks.onPointerLock(document.pointerLockElement === this.canvas);

  public constructor(options: ViewerOptions) {
    this.canvas = options.canvas;
    this.manifestUrl = options.manifestUrl;
    this.manifest = options.manifest;
    this.navigation = options.navigation;
    this.pois = options.pois;
    this.callbacks = options.callbacks;

    // Splats rendered into a multisampled target are several times more expensive (PlayCanvas warns
    // about this), so MSAA is only used for mesh scenes.
    const hasSplat = this.manifest.visualAssets.some((asset) => asset.kind === 'ply' || asset.kind === 'sog');
    this.maxPitch = hasSplat ? 35 : 82;
    this.app = new Application(this.canvas, {
      graphicsDeviceOptions: { antialias: !hasSplat, alpha: false },
    });
    this.app.setCanvasFillMode(FILLMODE_NONE);
    this.app.setCanvasResolution(RESOLUTION_AUTO);
    // PlayCanvas renders at 1 pixel per CSS pixel by default, which on a 150-200% display upscales
    // the image and blurs every splat. Start at the display's real resolution; update() steps it down
    // only if the frame rate cannot keep up.
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.app.graphicsDevice.maxPixelRatio = this.maxPixelRatio;

    this.yawPivot = new Entity('player-yaw');
    this.pitchPivot = new Entity('player-pitch');
    this.camera = new Entity('player-camera');
    this.camera.addComponent('camera', {
      clearColor: new Color(0.055, 0.07, 0.065),
      fov: 68,
      // Splats within a hand's reach of the eye are almost always reconstruction noise that would
      // fill the screen as a smear; real surfaces are kept further away by the navigation clearance.
      nearClip: hasSplat ? 0.2 : 0.1,
      farClip: 100,
    });
    this.pitchPivot.addChild(this.camera);
    this.yawPivot.addChild(this.pitchPivot);
    this.app.root.addChild(this.yawPivot);
    this.camera.setLocalPosition(0, PLAYER_HEIGHT, 0);

    this.routeEntity = new Entity('route');
    this.app.root.addChild(this.routeEntity);
    if (this.manifest.visualAssets.some((asset) => asset.kind === 'procedural')) {
      this.buildFixtureScene();
    } else {
      this.buildLighting();
    }
    this.buildPoiMarkers();
    this.loadVisualAssets();

    this.app.on('update', (dt: number) => this.update(dt));
    this.app.start();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.resize();
    this.reset();
    // Dev builds only: lets a person (or a test) place the camera from the console, e.g. to compare
    // two splats from the same pose: __nammaViewer.setPose({ position, yawDegrees, pitchDegrees }).
    if (import.meta.env.DEV) (window as unknown as { __nammaViewer?: PlayCanvasViewer }).__nammaViewer = this;
    this.callbacks.onStatus('Ready to explore');
  }

  public enterWalkthrough(): void {
    // Full screen is the workspace's own toggle (F / HUD button), so it keeps the HUD around the canvas.
    this.canvas.requestPointerLock();
    this.callbacks.onStatus('Walkthrough active · WASD to move · Esc to release');
  }

  public reset(): void {
    const [x, y, z] = this.manifest.startPosition;
    this.yawPivot.setPosition(x, y - PLAYER_HEIGHT, z);
    this.yawPivot.setEulerAngles(0, this.manifest.startYawDegrees, 0);
    this.pitchPivot.setLocalEulerAngles(0, 0, 0);
    this.emitPosition();
  }

  public selectPoi(poiId: string | null): void {
    this.poiEntities.forEach((marker, id) => {
      const material = marker.render?.meshInstances[0]?.material as StandardMaterial | undefined;
      if (!material) return;
      const selected = id === poiId;
      material.diffuse = selected ? new Color(1, 0.78, 0.3) : new Color(0.96, 0.57, 0.2);
      material.emissive = selected ? new Color(0.5, 0.18, 0.01) : new Color(0.12, 0.03, 0.005);
      material.update();
      marker.setLocalScale(selected ? 0.25 : 0.18, selected ? 0.48 : 0.32, selected ? 0.25 : 0.18);
    });
  }

  public jumpTo(poiId: string): void {
    const poi = this.pois.find((candidate) => candidate.id === poiId);
    if (!poi) return;
    if (!this.navigation) {
      this.callbacks.onStatus('Navigation data is unavailable for this scene');
      return;
    }
    const [x, y, z] = poi.approachPoint;
    if (!isWalkable(this.navigation, worldToCell(this.navigation, poi.approachPoint))) {
      this.callbacks.onStatus('This destination has no verified walkable approach point');
      return;
    }
    this.yawPivot.setPosition(x, y - PLAYER_HEIGHT, z);
    this.lookAt(poi.position);
    this.emitPosition();
    this.callbacks.onStatus(`Focused on ${poi.label}`);
  }

  public routeTo(poiId: string): boolean {
    const poi = this.pois.find((candidate) => candidate.id === poiId);
    if (!poi) return false;
    if (!this.navigation) {
      this.callbacks.onStatus('Navigation data is unavailable for this scene');
      return false;
    }
    const start = worldToCell(this.navigation, this.currentPosition());
    const goal = worldToCell(this.navigation, poi.approachPoint);
    const result = findRoute(this.navigation, start, goal);
    this.clearRoute();
    if (!result.ok) {
      this.callbacks.onStatus(result.detail);
      return false;
    }
    this.routeMaterial?.destroy();
    const material = new StandardMaterial();
    material.diffuse = new Color(0.95, 0.55, 0.18);
    material.emissive = new Color(0.3, 0.08, 0.01);
    material.update();
    this.routeMaterial = material;
    result.world.forEach((point, index) => {
      if (index === 0) return;
      const previous = result.world[index - 1];
      const segment = new Entity(`route-${index}`);
      segment.addComponent('render', { type: 'box', material });
      const dx = point[0] - previous[0];
      const dz = point[2] - previous[2];
      const length = Math.hypot(dx, dz);
      segment.setPosition((point[0] + previous[0]) / 2, 0.09, (point[2] + previous[2]) / 2);
      segment.setEulerAngles(0, Math.atan2(-dz, dx) * 180 / Math.PI, 0);
      segment.setLocalScale(Math.max(length, 0.12), 0.035, 0.12);
      this.routeEntity.addChild(segment);
    });
    this.callbacks.onStatus(`Route ready · ${result.cells.length} verified cells to ${poi.label}`);
    return true;
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.exitPointerLock();
    this.loadedAssets.forEach((asset) => {
      asset.unload();
      this.app.assets.remove(asset);
    });
    this.routeMaterial?.destroy();
    this.app.destroy();
  }

  private readonly resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    // clientWidth/clientHeight are the layout box (no transform, no scrollbar);
    // a bitmap that fed back into this measurement used to double on every
    // ResizeObserver tick (release-gate fix). The unchanged guard breaks any
    // residual feedback loop and skips pointless GPU surface reallocations.
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(parent.clientWidth * ratio));
    const height = Math.max(1, Math.floor(parent.clientHeight * ratio));
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.app.resizeCanvas(width, height);
  };

  private update(dt: number): void {
    this.adaptResolution(dt);
    const inputX = (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight') ? 1 : 0) - (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft') ? 1 : 0);
    const inputZ = (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown') ? 1 : 0) - (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp') ? 1 : 0);
    if (!inputX && !inputZ) {
      this.movementNoticePending = false;
      return;
    }
    // D3 · no navigation grid means nothing is verified — refuse free-roam
    // with an honest status line instead of walking on faith.
    if (!this.navigation) {
      if (!this.movementNoticePending) {
        this.callbacks.onStatus('Navigation data is unavailable — walkthrough movement is disabled for this scene');
        this.movementNoticePending = true;
      }
      return;
    }

    const length = Math.hypot(inputX, inputZ) || 1;
    const forward = this.yawPivot.forward;
    const right = this.yawPivot.right;
    const distance = WALK_SPEED * dt / length;
    const dx = (right.x * inputX - forward.x * inputZ) * distance;
    const dz = (right.z * inputX - forward.z * inputZ) * distance;
    const current = this.currentPosition();
    // Move in steps of at most half a cell so a slow frame cannot carry the visitor through a thin
    // wall, and slide along blocked cells (try the full step, then each axis alone) instead of sticking.
    // Blocked and unknown cells are both refused (resolveWalkableStep).
    const grid = this.navigation;
    const free = (x: number, z: number) => resolveWalkableStep(grid, [x, current[1], z]) !== null;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (grid.cellSize / 2)));
    let [x, , z] = current;
    for (let step = 0; step < steps; step += 1) {
      const sx = dx / steps;
      const sz = dz / steps;
      if (free(x + sx, z + sz)) { x += sx; z += sz; }
      else if (free(x + sx, z)) x += sx;
      else if (free(x, z + sz)) z += sz;
      else break;
    }
    if (x !== current[0] || z !== current[2]) {
      this.yawPivot.setPosition(x, current[1] - PLAYER_HEIGHT, z);
      this.emitPosition();
    }
  }

  /** Lower the render resolution when frames are slow (< 30 fps) and raise it back when fast (> 50 fps). */
  private adaptResolution(dt: number): void {
    this.frameTime = this.frameTime * 0.9 + dt * 0.1;
    this.framesSinceResize += 1;
    if (this.framesSinceResize < 30) return;
    const device = this.app.graphicsDevice;
    let ratio = device.maxPixelRatio;
    if (this.frameTime > 1 / 30 && ratio > 1) ratio = Math.max(1, ratio - 0.25);
    else if (this.frameTime < 1 / 50 && ratio < this.maxPixelRatio) ratio = Math.min(this.maxPixelRatio, ratio + 0.25);
    else return;
    device.maxPixelRatio = ratio;
    this.framesSinceResize = 0;
    this.resize();
  }

  private currentPosition(): Vec3 {
    const position = this.yawPivot.getPosition();
    return [position.x, position.y + PLAYER_HEIGHT, position.z];
  }

  private emitPosition(): void {
    this.callbacks.onPosition(this.currentPosition(), this.navigation ? worldToCell(this.navigation, this.currentPosition()) : { x: 0, z: 0 });
  }

  private lookAt(target: Vec3): void {
    const position = this.currentPosition();
    const direction = new PcVec3(target[0] - position[0], target[1] - position[1], target[2] - position[2]);
    this.yawPivot.setEulerAngles(0, Math.atan2(direction.x, -direction.z) * 180 / Math.PI, 0);
    const horizontal = Math.hypot(direction.x, direction.z);
    this.pitchPivot.setLocalEulerAngles(-Math.atan2(direction.y, horizontal) * 180 / Math.PI, 0, 0);
  }

  /**
   * Remove the drawn route tape. Public (additive exposure only) so the
   * workspace can clear a stale tape on Clear route, Esc deselect, a new
   * destination, or a failed plot — the same triggers that reset the status
   * strip (review F1). No control flow of any existing method changed.
   */
  clearRoute(): void {
    this.routeEntity.children.slice().forEach((child) => child.destroy());
  }

  private buildFixtureScene(): void {
    const floor = this.createPrimitive('floor', 'box', [0, -0.08, 0], [12, 0.16, 9], new Color(0.19, 0.2, 0.18));
    this.app.root.addChild(floor);
    const wallMaterial = new Color(0.33, 0.3, 0.25);
    this.addBox('back-wall', [0, 1.5, -4.35], [12, 3, 0.22], wallMaterial);
    this.addBox('left-wall', [-5.9, 1.5, 0], [0.22, 3, 8.7], wallMaterial);
    this.addBox('right-wall', [5.9, 1.5, 0], [0.22, 3, 8.7], wallMaterial);
    this.addBox('front-wall-left', [-4.6, 1.5, 4.35], [2.6, 3, 0.22], wallMaterial);
    this.addBox('front-wall-right', [4.6, 1.5, 4.35], [2.6, 3, 0.22], wallMaterial);
    this.addBox('desk', [-1.8, 0.55, -1.1], [2.2, 1.1, 0.8], new Color(0.48, 0.24, 0.11));
    this.addBox('display-table', [2.4, 0.45, 1.4], [1.8, 0.9, 1.2], new Color(0.24, 0.34, 0.36));
    this.addBox('information-kiosk', [0, 0.75, 2.65], [0.8, 1.5, 0.8], new Color(0.64, 0.43, 0.16));
    this.addBox('central-obstacle', [0.6, 0.6, -0.4], [1.5, 1.2, 1.2], new Color(0.26, 0.28, 0.26));

    this.buildLighting();
  }

  private buildLighting(): void {
    const light = new Entity('key-light');
    light.addComponent('light', { type: 'directional', color: new Color(1, 0.82, 0.61), intensity: 1.8, castShadows: true });
    light.setEulerAngles(55, 25, 0);
    this.app.root.addChild(light);
    const fill = new Entity('fill-light');
    fill.addComponent('light', { type: 'omni', color: new Color(0.32, 0.48, 0.55), intensity: 4, range: 16 });
    fill.setPosition(0, 3, 1);
    this.app.root.addChild(fill);
  }

  private loadVisualAssets(): void {
    this.loadSplatAssets();
    const assets = this.manifest.visualAssets.filter((asset) => asset.kind === 'glb' || asset.kind === 'gltf');
    if (assets.length === 0) return;

    // D3 · declared sha256 digests are verified before the renderer touches
    // the bytes; failures surface as distinct, actionable status lines.
    assets.forEach((assetRef) => {
      void verifyAssetIntegrity(this.manifestUrl, assetRef)
        .then(() => this.attachVisualAsset(assetRef))
        .catch((error: unknown) => {
          this.callbacks.onStatus(assetFailureMessage(assetRef, error));
        });
    });
  }

  private loadSplatAssets(): void {
    const refs = this.manifest.visualAssets.filter((asset) => asset.kind === 'ply' || asset.kind === 'sog');
    if (refs.length === 0) return;

    refs.forEach((assetRef) => {
      void verifyAssetIntegrity(this.manifestUrl, assetRef)
        .then(() => {
          const label = assetRef.label ?? assetRef.uri;
          const url = resolveSceneUri(this.manifestUrl, assetRef.uri);
          const asset = new Asset(label, 'gsplat', { url });
          asset.once('load', () => {
            const entity = new Entity(label);
            entity.addComponent('gsplat', { asset });
            this.app.root.addChild(entity);
            this.callbacks.onStatus(`Loaded splat ${label}`);
          });
          asset.once('error', (error: unknown) => {
            this.callbacks.onStatus(`Splat unavailable: ${String(error)}`);
          });
          this.app.assets.add(asset);
          this.loadedAssets.push(asset);
          this.app.assets.load(asset);
        })
        .catch((error: unknown) => {
          this.callbacks.onStatus(assetFailureMessage(assetRef, error));
        });
    });
  }

  private attachVisualAsset(assetRef: AssetRef): void {
    const url = resolveSceneUri(this.manifestUrl, assetRef.uri);
    const asset = new Asset(assetRef.label ?? assetRef.uri, 'container', { url });
    asset.once('load', () => {
      if (!asset.resource) return;
      const entity = asset.resource.instantiateRenderEntity();
      entity.name = assetRef.label ?? 'visual-asset';
      this.app.root.addChild(entity);
      this.callbacks.onStatus(`Loaded ${assetRef.label ?? 'visual asset'}`);
    });
    asset.once('error', (error: unknown) => {
      this.callbacks.onStatus(`Visual asset unavailable: ${String(error)}`);
    });
    this.app.assets.add(asset);
    this.loadedAssets.push(asset);
    this.app.assets.load(asset);
  }

  private buildPoiMarkers(): void {
    this.pois.forEach((poi) => {
      const marker = this.createPrimitive(`poi-${poi.id}`, 'cylinder', [poi.position[0], poi.position[1], poi.position[2]], [0.18, 0.32, 0.18], new Color(0.96, 0.57, 0.2));
      this.app.root.addChild(marker);
      this.poiEntities.set(poi.id, marker);
    });
  }

  private addBox(name: string, position: [number, number, number], scale: [number, number, number], color: Color): void {
    this.app.root.addChild(this.createPrimitive(name, 'box', position, scale, color));
  }

  private createPrimitive(name: string, type: 'box' | 'cylinder', position: [number, number, number], scale: [number, number, number], color: Color): Entity {
    const entity = new Entity(name);
    const material = new StandardMaterial();
    material.diffuse = color;
    material.metalness = 0.08;
    material.gloss = 0.35;
    material.update();
    this.sceneMaterials.push(material);
    entity.addComponent('render', { type, material });
    entity.setPosition(...position);
    entity.setLocalScale(...scale);
    return entity;
  }

  /* ===== T14 · CAMERA POSE API — purely additive (D-013 preservation) =====
   * Reads and restores the walkthrough pose so the workspace can persist a
   * viewpoint across reloads through the T9 store. Yaw/pitch are PlayCanvas
   * euler degrees (yaw: pivot world euler, pitch: local, clamped ±82° by
   * onMouseMove). No existing method, listener, or control flow is touched;
   * setPose mirrors reset()/jumpTo() bookkeeping via the existing emitPosition.
   * ======================================================================== */

  /** Read-only snapshot of the current camera pose (metres / degrees). */
  public getPose(): { position: Vec3; yawDegrees: number; pitchDegrees: number } {
    return {
      position: this.currentPosition(),
      yawDegrees: this.yawPivot.getEulerAngles().y,
      pitchDegrees: this.pitchPivot.getLocalEulerAngles().x,
    };
  }

  /** Restore a previously captured pose and re-emit its position. */
  public setPose(pose: { position: Vec3; yawDegrees: number; pitchDegrees: number }): void {
    const [x, y, z] = pose.position;
    // A saved pose from an older build of the scene can sit outside today's walkable area, where the
    // visitor would be stuck in a smear; start from the scene's start point instead.
    if (this.navigation && !isWalkable(this.navigation, worldToCell(this.navigation, pose.position))) {
      this.reset();
      return;
    }
    this.yawPivot.setPosition(x, y - PLAYER_HEIGHT, z);
    this.yawPivot.setEulerAngles(0, pose.yawDegrees, 0);
    this.pitchPivot.setLocalEulerAngles(pose.pitchDegrees, 0, 0);
    this.emitPosition();
  }

  /* ===== end T14 additive block ========================================= */

  /* ===== T15 · MOTION API — purely additive (D-013 preservation) ========
   * Eased jump (700 ms expo settle, pitch levels, cancellable), progressive
   * route-tape reveal (600 ms in-out), and a single marker pulse. All motion
   * rides on ADDITIVE update listeners; every callback carries a
   * disposed-equivalent guard (unmounted canvas / tape rebuilt mid-draw).
   * Existing methods, listeners, and control flow are untouched.
   * ======================================================================= */

  /** Stops for every live motion — emptied as each motion settles. */
  private readonly motionStops = new Set<() => void>();
  /** Active camera tween and tape reveal (killed before a new one starts). */
  private cameraMotionStop: (() => void) | null = null;
  private tapeRevealStop: (() => void) | null = null;
  /** In-flight marker pulses keyed by POI id (restore-before-restart). */
  private readonly pulseStops = new Map<string, { stop: () => void; restore: () => void }>();

  /** Kill every active additive motion — safe at any time, never throws. */
  public cancelMotion(): void {
    [...this.motionStops].forEach((stop) => stop());
  }

  /**
   * Reduced-motion preference (§7.4): motion resolves to instant cuts.
   * The environment lookup stays here (browser-only guards); the decision
   * delegates to the T23 registry (src/motion) — single source of truth.
   */
  private prefersReducedMotion(): boolean {
    return resolveMotionPrefersReduced(
      typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }

  /**
   * Run a frame-driven motion until its tick reports completion. The tick
   * receives milliseconds; stop() detaches the update listener, any kill
   * switches, and the registry entry. Disposed guard: a detached canvas
   * stops the motion on its next frame — destroy() needs no changes.
   */
  private startMotion(
    tick: (deltaMs: number) => boolean,
    armKill?: (kill: () => void) => () => void,
  ): () => void {
    let stopped = false;
    let disarm: (() => void) | undefined = undefined; // set after stop (cycle: stop → disarm → stop)
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      this.app.off('update', onUpdate);
      this.motionStops.delete(stop);
      disarm?.();
    };
    const onUpdate = (dt: number): void => {
      if (stopped) return;
      if (!this.canvas.isConnected) {
        stop();
        return;
      }
      if (tick(dt * 1000)) stop();
    };
    this.motionStops.add(stop);
    disarm = armKill?.(stop);
    this.app.on('update', onUpdate);
    return stop;
  }

  /** Camera kill-switch: pointer-lock entry or WASD/arrow keydown ends the tween. */
  private armCameraKill(kill: () => void): () => void {
    const onKey = (event: KeyboardEvent): void => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        kill();
      }
    };
    const onLock = (): void => {
      if (document.pointerLockElement === this.canvas) kill();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }

  /**
   * Eased jump (700 ms expo settle) to a POI approach point with the pitch
   * leveling to the POI look-at. Cancellable at any moment — the camera
   * stays wherever the operator's input left it (honest partial state, no
   * fake completion status). Reduced motion → the existing instant jumpTo.
   * Invalid/unwalkable targets delegate to jumpTo for its verbatim status.
   */
  public jumpToSmooth(poiId: string): boolean {
    const poi = this.pois.find((candidate) => candidate.id === poiId);
    if (!poi) return false;
    if (!this.navigation || !isWalkable(this.navigation, worldToCell(this.navigation, poi.approachPoint))) {
      this.jumpTo(poiId);
      return false;
    }
    if (this.prefersReducedMotion()) {
      this.jumpTo(poiId);
      return true;
    }

    this.cameraMotionStop?.();
    const from = this.getPose();
    const [tx, ty, tz] = poi.approachPoint;
    const direction = new PcVec3(poi.position[0] - tx, poi.position[1] - ty, poi.position[2] - tz);
    const targetYaw = (Math.atan2(direction.x, -direction.z) * 180) / Math.PI;
    const horizontal = Math.hypot(direction.x, direction.z);
    const targetPitch = (-Math.atan2(direction.y, horizontal) * 180) / Math.PI;

    let tween = createTween(resolveTweenDuration(700, false));
    this.cameraMotionStop = this.startMotion((deltaMs) => {
      const stepped = advanceTween(tween, deltaMs);
      tween = stepped.tween;
      const eased = easeOutExpo(stepped.progress);
      this.yawPivot.setPosition(
        lerp(from.position[0], tx, eased),
        lerp(from.position[1], ty, eased) - PLAYER_HEIGHT,
        lerp(from.position[2], tz, eased),
      );
      this.yawPivot.setEulerAngles(0, lerpAngleDeg(from.yawDegrees, targetYaw, eased), 0);
      this.pitchPivot.setLocalEulerAngles(lerpAngleDeg(from.pitchDegrees, targetPitch, eased), 0, 0);
      this.emitPosition();
      if (stepped.done) {
        this.callbacks.onStatus(`Focused on ${poi.label}`);
        return true;
      }
      return false;
    }, (kill) => this.armCameraKill(kill));
    return true;
  }

  /**
   * Progressive route-tape reveal (600 ms in-out) over the tape routeTo just
   * built: the lime core is held depth-off (always-on-top layer, §6.4) and
   * segments draw in by index — the draw-progress of this box tape. If the
   * tape is cleared/rebuilt mid-reveal the old reveal cancels itself.
   */
  public revealRouteTape(durationMs = 600): void {
    this.tapeRevealStop?.();
    const segments = this.routeEntity.children.slice() as Entity[]; // tape children are entities at runtime
    if (segments.length === 0) return;

    const material = this.routeMaterial;
    if (material) {
      material.diffuse = new Color(0.7, 0.93, 0.22); // §6.4 lime core
      material.emissive = new Color(0.16, 0.26, 0.02);
      material.depthTest = false; // always-on-top tape layer
      material.update();
    }

    if (resolveTweenDuration(durationMs, this.prefersReducedMotion()) === 0) return; // instant cut: tape already fully built

    segments.forEach((segment) => {
      if (segment.render) segment.render.enabled = false;
    });
    let tween = createTween(durationMs);
    this.tapeRevealStop = this.startMotion((deltaMs) => {
      const stepped = advanceTween(tween, deltaMs);
      tween = stepped.tween;
      if (!segments.every((segment) => this.routeEntity.children.includes(segment))) return true; // tape rebuilt mid-draw
      const visible = revealCount(easeInOutCubic(stepped.progress), segments.length);
      segments.forEach((segment, index) => {
        if (segment.render) segment.render.enabled = index < visible;
      });
      if (stepped.done) {
        segments.forEach((segment) => {
          if (segment.render) segment.render.enabled = true;
        });
        this.tapeRevealStop = null;
        return true;
      }
      return false;
    });
  }

  /**
   * Single selection pulse on a POI marker — one out-and-back swell, then an
   * exact restore of the captured base scale. Re-pulsing the same marker
   * restores the in-flight pulse first (never a runaway scale).
   */
  public pulseSelection(poiId: string): void {
    if (this.prefersReducedMotion()) return;
    const marker = this.poiEntities.get(poiId);
    if (!marker) return;
    this.pulseStops.get(poiId)?.restore();
    this.pulseStops.get(poiId)?.stop();

    const scale = marker.getLocalScale();
    const base: [number, number, number] = [scale.x, scale.y, scale.z];
    const restore = (): void => marker.setLocalScale(base[0], base[1], base[2]);
    let tween = createTween(360);
    const stopMotion = this.startMotion((deltaMs) => {
      const stepped = advanceTween(tween, deltaMs);
      tween = stepped.tween;
      const swell = 1 + 0.55 * Math.sin(Math.PI * stepped.progress);
      marker.setLocalScale(base[0] * swell, base[1] * swell, base[2] * swell);
      if (stepped.done) {
        restore();
        return true;
      }
      return false;
    });
    this.pulseStops.set(poiId, {
      stop: () => stopMotion(),
      restore,
    });
  }

  /* ===== end T15 additive block ========================================= */
}
