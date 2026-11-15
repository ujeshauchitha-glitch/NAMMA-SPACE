import {
  Application,
  Asset,
  BLEND_NORMAL,
  CULLFACE_NONE,
  Color,
  Entity,
  FILLMODE_NONE,
  Mesh,
  MeshInstance,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3 as PcVec3,
} from 'playcanvas';
import type { AssetRef, NavigationGrid, Poi, SceneManifest, Vec3 } from '../types/scene';
import { filmedHeading, isWalkable, planRoute, poiInView, worldToCell, type GridCell } from '../lib/navigation';
import { resolveWalkableStep } from '../lib/movement';
import { walkableMesh, walkableRuns } from '../lib/walkableOverlay';
import { PoiSpatialIndex, rayFloorHit, triangulatePolygon, type FloorPoint } from '../lib/poiIndex';
import { FADE_CUT_MS, fadeCutOpacity, flightDurationMs, flightPose, planFlight } from '../lib/routeFlight';
import { faceAngles, formatInstruction, formatWalkTime, nextInstruction, routeProgress } from '../lib/routeGuidance';
import { chevronDistances, pointAtDistance, polylineLength, ribbonMesh, slicePolyline } from '../lib/routeGeometry';
import { isClick, moveGesture, startGesture, type LookGesture } from '../lib/lookGesture';
import { focalLengthPx, hitTestScreen, layoutLabels, pinScreenPx, pinWorldDiameter, type ProjectedLabel, type ScreenTarget } from '../lib/poiOverlay';
import { assetFailureMessage, fetchVerifiedAsset, resolveSceneUri, verifiedSplatContents, verifyAssetIntegrity } from '../lib/sceneLoader';
// T15 additive: pure tween/cancel math for the motion API (no control flow).
import { cropBox, cropModifier } from './splatCrop';
import { idleYawStep, SPLAT_MAX_PITCH_DEG, viewGuideEnabled } from '../lib/viewGuide';
import { advanceTween, createTween, easeInOutCubic, lerp, lerpAngleDeg, resolveTweenDuration } from './tween';
import { resolveMotionPrefersReduced } from '../motion';

/** What the guidance panel shows; null when no route is being followed. */
export type GuidanceUpdate = {
  poiId: string;
  label: string;
  status: 'guiding' | 'following' | 'arrived';
  remaining: number;
  total: number;
  instruction: string;
  walkTime: string;
  /** True for a moment after the route was re-planned because the visitor left it. */
  rerouted: boolean;
};

type ViewerCallbacks = {
  onStatus: (message: string) => void;
  onPosition: (position: Vec3, cell: GridCell) => void;
  onPointerLock: (locked: boolean) => void;
  /** A POI pin or label was clicked (or clicked through the crosshair under pointer lock). */
  onPoiClick?: (poiId: string, viaCrosshair: boolean) => void;
  /** The POI under the cursor (or the crosshair) changed. */
  onPoiHover?: (poiId: string | null) => void;
  /** Edit mode: a click (not a drag) on the scene, with the floor point and any POI pin/zone under it. */
  onEditClick?: (floor: FloorPoint | null, poiId: string | null) => void;
  /** Edit mode: a pin was dragged to a new floor point. */
  onEditMoveEnd?: (poiId: string, floor: FloorPoint) => void;
  /** Guidance along the active route changed (distance, next step, arrival); null when it ends. */
  onGuidance?: (update: GuidanceUpdate | null) => void;
};

type ViewerOptions = {
  canvas: HTMLCanvasElement;
  manifestUrl: string;
  manifest: SceneManifest;
  navigation: NavigationGrid | null;
  pois: Poi[];
  callbacks: ViewerCallbacks;
  /** Element over the canvas that holds the HTML POI labels (positioned by the engine each frame). */
  labelLayer?: HTMLElement | null;
};

const CAMERA_FOV = 68;
const ROUTE_WIDTH_M = 0.22;
const CHEVRON_SPACING_M = 0.9;
const CHEVRON_SPEED_M_S = 0.7;
const PIN_COLOR = new Color(0.96, 0.57, 0.2);
const PIN_SELECTED_COLOR = new Color(1, 0.78, 0.3);

const PLAYER_HEIGHT = 1.65;
const WALK_SPEED = 1.4; // normal indoor walking pace, m/s
const LOOK_SPEED = 0.12;

/** Guidance target id used for a floor point picked on the minimap. */
export const MAP_POINT_ID = 'map-point';

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
  private readonly viewGuide: boolean;
  /** Called on every look input (drag or locked mouse): explicit camera motions stop when the visitor looks. */
  private readonly lookListeners = new Set<() => void>();
  private frameTime = 1 / 60;
  private framesSinceResize = 0;
  private lastLookAt = 0;
  private pois: Poi[];
  private readonly labelLayer: HTMLElement | null;
  /** One HTML label per POI, with its measured size (labels are positioned every frame). */
  private readonly labelEls = new Map<string, { el: HTMLDivElement; width: number; height: number }>();
  private selectedPoiId: string | null = null;
  /** Pin and label screen targets from the last rendered frame, for click and hover hit tests. */
  private hitTargets: ScreenTarget[] = [];
  /** Spatial index over POIs and their zones (rebuilt with the POI set). */
  private poiIndex = new PoiSpatialIndex<Poi>([]);
  /** Translucent floor overlay per zoned POI. */
  private readonly zoneEntities = new Map<string, { entity: Entity; material: StandardMaterial }>();
  /** Floor height for zones and floor picking: the scene's lowest bound. */
  private readonly floorY: number;
  private hoveredPoiId: string | null = null;
  /** Cursor position over the canvas (CSS px) while the pointer is not locked. */
  private pointerPx: [number, number] | null = null;
  /** Edit mode: clicks place/select instead of opening cards; pins can be dragged. */
  private editMode = false;
  private editDown: { px: number; py: number; poiId: string | null; moved: boolean; floor: FloorPoint | null } | null = null;
  /** Zone outline being drawn in the editor (open polyline). */
  private draftZone: FloorPoint[] = [];
  /** Right-button drag looks around without pointer lock. */
  /** Drag-to-look in progress (left/right mouse drag or one finger), and whether the last press was a drag. */
  private lookGesture: LookGesture | null = null;
  private suppressClick = false;
  /** Per-POI pin size multiplier driven by the selection pulse. */
  private readonly pinPulse = new Map<string, number>();
  private readonly callbacks: ViewerCallbacks;
  private readonly pressedKeys = new Set<string>();
  private readonly routeEntity: Entity;
  private readonly poiEntities = new Map<string, Entity>();
  private readonly sceneMaterials: StandardMaterial[] = [];
  private readonly loadedAssets: Asset[] = [];
  private routeMaterial: StandardMaterial | null = null;
  /** The drawn route: smoothed floor polyline to a POI; preview routes are fainter and have no chevrons. */
  private mapPoint: Poi | null = null;
  private walkableOverlay: { entity: Entity; material: StandardMaterial } | null = null;
  private activeRoute: { poiId: string; path: FloorPoint[]; length: number; preview: boolean } | null = null;
  private routeRibbon: { entity: Entity; mesh: Mesh | null } | null = null;
  /** How much of the route is drawn (grows during the reveal). */
  private routeDrawLength = Infinity;
  private chevronMesh: Mesh | null = null;
  private chevronMaterial: StandardMaterial | null = null;
  private chevrons: Entity[] = [];
  private beaconRing: Entity | null = null;
  /** Turn-by-turn guidance along the active route. */
  private guidance: { poiId: string; following: boolean; arrived: boolean; offSince: number | null; reroutedAt: number; lastKey: string } | null = null;
  private followStop: (() => void) | null = null;
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
    this.look(event.movementX, event.movementY);
  };

  private look(movementX: number, movementY: number): void {
    this.lastLookAt = performance.now();
    [...this.lookListeners].forEach((listener) => listener());
    this.yawPivot.rotateLocal(0, -movementX * LOOK_SPEED, 0);
    this.pitchPivot.rotateLocal(-movementY * LOOK_SPEED, 0, 0);
    const pitch = this.pitchPivot.getLocalEulerAngles().x;
    this.pitchPivot.setLocalEulerAngles(Math.max(-this.maxPitch, Math.min(this.maxPitch, pitch)), 0, 0);
  }
  private readonly onPointerLockChange = () => this.callbacks.onPointerLock(document.pointerLockElement === this.canvas);
  private readonly onCanvasPointerMove = (event: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointerPx = [event.clientX - rect.left, event.clientY - rect.top];
    const down = this.editDown;
    if (down && down.poiId && (down.moved || Math.hypot(this.pointerPx[0] - down.px, this.pointerPx[1] - down.py) > 3)) {
      down.moved = true;
      // Keep the pin under the cursor: intersect with the horizontal plane at the pin's own height.
      const height = this.pois.find((poi) => poi.id === down.poiId)?.position[1] ?? this.floorY;
      const floor = this.floorPointAt(this.pointerPx[0], this.pointerPx[1], height);
      if (floor) {
        down.floor = floor;
        this.previewMove(down.poiId, floor);
      }
    }
  };
  private readonly onCanvasMouseDown = (event: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) return;
    if (event.button !== 0 || !this.editMode) return;
    const rect = this.canvas.getBoundingClientRect();
    const [px, py] = [event.clientX - rect.left, event.clientY - rect.top];
    this.editDown = { px, py, poiId: hitTestScreen(this.hitTargets, px, py), moved: false, floor: null };
  };
  private readonly onWindowMouseUp = (event: MouseEvent) => {
    const down = this.editDown;
    if (event.button !== 0 || !down) return;
    this.editDown = null;
    if (down.poiId && down.moved && down.floor) {
      this.callbacks.onEditMoveEnd?.(down.poiId, down.floor);
      return;
    }
    this.callbacks.onEditClick?.(this.floorPointAt(down.px, down.py), this.poiAtScreen(down.px, down.py));
  };
  /**
   * Drag to look without pointer lock: left drag (outside edit mode), right drag, or one finger. A press
   * that does not move past the threshold stays a click/tap and selects POIs as before.
   */
  private readonly onCanvasPointerDown = (event: PointerEvent) => {
    if (document.pointerLockElement === this.canvas || this.lookGesture) return;
    const leftLook = event.button === 0 && (!this.editMode || event.pointerType === 'touch');
    if (!leftLook && event.button !== 2) return;
    this.canvas.focus({ preventScroll: true }); // WASD works straight away, no lock needed
    this.lookGesture = startGesture(event.pointerId, event.clientX, event.clientY, event.button === 2 ? 'mouse' : event.pointerType);
    if (event.button === 2) this.lookGesture.dragging = true;
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events have no capture */ }
  };
  private readonly onCanvasPointerDrag = (event: PointerEvent) => {
    const gesture = this.lookGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || document.pointerLockElement === this.canvas) return;
    const step = moveGesture(gesture, event.clientX, event.clientY);
    this.lookGesture = step.gesture;
    if (step.dx !== 0 || step.dy !== 0) {
      this.look(step.dx, step.dy);
      this.canvas.style.cursor = 'grabbing';
    }
  };
  private readonly onCanvasPointerEnd = (event: PointerEvent) => {
    const gesture = this.lookGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.lookGesture = null;
    this.suppressClick = !isClick(gesture); // the click that follows a drag is not a selection
    if (this.canvas.style.cursor === 'grabbing') this.canvas.style.cursor = '';
    try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };
  private readonly onContextMenu = (event: MouseEvent) => event.preventDefault();
  private readonly onCanvasPointerLeave = () => {
    this.pointerPx = null;
  };
  /** Click: under pointer lock the crosshair (screen centre) picks, otherwise the cursor does. */
  private readonly onCanvasClick = (event: MouseEvent) => {
    if (this.editMode) return; // edit-mode clicks are handled on mouseup (click vs drag)
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const locked = document.pointerLockElement === this.canvas;
    const rect = this.canvas.getBoundingClientRect();
    const [px, py] = locked ? [rect.width / 2, rect.height / 2] : [event.clientX - rect.left, event.clientY - rect.top];
    const poiId = this.poiAtScreen(px, py);
    if (poiId) {
      this.callbacks.onPoiClick?.(poiId, locked);
      return;
    }
    // Empty scene: just take keyboard focus (WASD). Pointer lock is the optional immersive mode.
    if (!locked) this.canvas.focus({ preventScroll: true });
  };

  public constructor(options: ViewerOptions) {
    this.canvas = options.canvas;
    this.manifestUrl = options.manifestUrl;
    this.manifest = options.manifest;
    this.navigation = options.navigation;
    this.pois = options.pois;
    this.callbacks = options.callbacks;
    this.labelLayer = options.labelLayer ?? null;
    this.floorY = this.manifest.bounds.min[1];

    // Splats rendered into a multisampled target are several times more expensive (PlayCanvas warns
    // about this), so MSAA is only used for mesh scenes.
    const hasSplat = this.manifest.visualAssets.some((asset) => asset.kind === 'ply' || asset.kind === 'sog');
    this.maxPitch = hasSplat ? SPLAT_MAX_PITCH_DEG : 82;
    // The idle drift toward filmed directions is off unless ?guide=1 (see lib/viewGuide.ts).
    this.viewGuide = typeof window !== 'undefined' && viewGuideEnabled(window.location.search);
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
      fov: CAMERA_FOV,
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
    // After every update and motion tween: size pins and place labels for the frame about to render.
    this.app.on('prerender', () => {
      this.updatePoiOverlay();
      this.updateRouteOverlay();
    });
    this.app.start();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('mousemove', this.onCanvasPointerMove);
    this.canvas.addEventListener('mouseleave', this.onCanvasPointerLeave);
    this.canvas.addEventListener('click', this.onCanvasClick);
    this.canvas.addEventListener('mousedown', this.onCanvasMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.addEventListener('pointermove', this.onCanvasPointerDrag);
    this.canvas.addEventListener('pointerup', this.onCanvasPointerEnd);
    this.canvas.addEventListener('pointercancel', this.onCanvasPointerEnd);
    // One-finger drags look around instead of scrolling or zooming the page.
    this.canvas.style.touchAction = 'none';
    window.addEventListener('mouseup', this.onWindowMouseUp);
    this.resize();
    this.reset();
    // Dev builds only: lets a person (or a test) place the camera from the console, e.g. to compare
    // two splats from the same pose: __nammaViewer.setPose({ position, yawDegrees, pitchDegrees }).
    if (import.meta.env.DEV) (window as unknown as { __nammaViewer?: PlayCanvasViewer }).__nammaViewer = this;
    this.callbacks.onStatus('Ready to explore');
  }

  /** Immersive mode toggle: leave pointer lock if it is on, otherwise enter it. */
  public toggleImmersive(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
      return;
    }
    this.enterWalkthrough();
  }

  public enterWalkthrough(): void {
    // Full screen is the workspace's own toggle (F / HUD button), so it keeps the HUD around the canvas.
    // Some embedded browsers refuse pointer lock; WASD still works while the canvas has focus.
    this.canvas.focus();
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => undefined);
    this.callbacks.onStatus('Immersive mode · move the mouse to look · WASD to move · Esc to leave');
  }

  public reset(): void {
    const [x, y, z] = this.manifest.startPosition;
    this.yawPivot.setPosition(x, y - PLAYER_HEIGHT, z);
    this.yawPivot.setEulerAngles(0, this.manifest.startYawDegrees, 0);
    this.pitchPivot.setLocalEulerAngles(0, 0, 0);
    this.emitPosition();
  }

  public selectPoi(poiId: string | null): void {
    this.selectedPoiId = poiId;
    this.poiEntities.forEach((marker, id) => {
      const material = marker.render?.meshInstances[0]?.material as StandardMaterial | undefined;
      if (!material) return;
      const selected = id === poiId;
      material.diffuse = selected ? PIN_SELECTED_COLOR : PIN_COLOR;
      material.emissive = selected ? new Color(0.5, 0.18, 0.01) : new Color(0.25, 0.08, 0.01);
      material.update();
    });
    this.labelEls.forEach(({ el }, id) => el.classList.toggle('is-selected', id === poiId));
    this.applyHoverStyle();
  }

  /** POI under a screen point: a pin or label first, otherwise the smallest zone under that floor point. */
  private poiAtScreen(px: number, py: number): string | null {
    const pinned = hitTestScreen(this.hitTargets, px, py);
    if (pinned) return pinned;
    const floor = this.floorPointAt(px, py);
    return floor ? this.poiIndex.zonesAt(floor[0], floor[1])[0]?.id ?? null : null;
  }

  /** Point [x, z] seen at a canvas pixel on the horizontal plane y = planeY (the floor by default). */
  public floorPointAt(px: number, py: number, planeY = this.floorY): FloorPoint | null {
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) return null;
    const eye = this.camera.getPosition();
    const far = cameraComponent.screenToWorld(px, py, cameraComponent.farClip);
    return rayFloorHit([eye.x, eye.y, eye.z], [far.x - eye.x, far.y - eye.y, far.z - eye.z], planeY);
  }

  private setHovered(poiId: string | null): void {
    if (poiId === this.hoveredPoiId) return;
    this.hoveredPoiId = poiId;
    this.applyHoverStyle();
    this.canvas.style.cursor = poiId && document.pointerLockElement !== this.canvas ? 'pointer' : '';
    this.callbacks.onPoiHover?.(poiId);
  }

  private applyHoverStyle(): void {
    this.labelEls.forEach(({ el }, id) => el.classList.toggle('is-hovered', id === this.hoveredPoiId));
    this.zoneEntities.forEach(({ material }, id) => {
      material.opacity = id === this.hoveredPoiId || id === this.selectedPoiId ? 0.3 : 0.16;
      material.update();
    });
    this.poiEntities.forEach((marker, id) => {
      const material = marker.render?.meshInstances[0]?.material as StandardMaterial | undefined;
      if (!material || id === this.selectedPoiId) return;
      material.emissive = id === this.hoveredPoiId ? new Color(0.55, 0.3, 0.05) : new Color(0.25, 0.08, 0.01);
      material.update();
    });
  }

  /** Edit mode: clicks report floor points (placing, zone vertices) and pins can be dragged. */
  public setEditMode(on: boolean): void {
    this.editMode = on;
    this.editDown = null;
    if (on && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.canvas.classList.toggle('is-editing', on);
  }

  /** Zone polygon being drawn in the editor; [] hides it. */
  public setDraftZone(points: FloorPoint[]): void {
    this.draftZone = points;
  }

  /** Move a pin while it is dragged; the editor commits the move (and re-snaps the approach) on release. */
  private previewMove(poiId: string, [x, z]: FloorPoint): void {
    this.pois = this.pois.map((poi) => (poi.id === poiId ? { ...poi, position: [x, poi.position[1], z] } : poi));
    this.poiEntities.get(poiId)?.setPosition(x, this.pois.find((poi) => poi.id === poiId)!.position[1], z);
  }

  /** Replace the POI set (e.g. after editing) without reloading the scene. */
  public setPois(pois: Poi[]): void {
    this.poiEntities.forEach((marker) => marker.destroy());
    this.poiEntities.clear();
    this.zoneEntities.forEach(({ entity, material }) => {
      entity.destroy();
      material.destroy();
    });
    this.zoneEntities.clear();
    this.labelEls.forEach(({ el }) => el.remove());
    this.labelEls.clear();
    this.pois = pois;
    this.hitTargets = [];
    this.hoveredPoiId = null;
    this.buildPoiMarkers();
    if (this.selectedPoiId && !pois.some((poi) => poi.id === this.selectedPoiId)) this.selectedPoiId = null;
    this.selectPoi(this.selectedPoiId);
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

  /**
   * Plan a route from the current position to a POI and draw it: one continuous ribbon on the floor,
   * chevrons scrolling toward the destination, and a beacon there. A preview is drawn fainter and
   * without chevrons (a destination picked from search, before guidance starts).
   */
  public routeTo(poiId: string, options: { preview?: boolean } = {}): boolean {
    const poi = this.findTarget(poiId);
    if (!poi) return false;
    if (!this.navigation) {
      this.callbacks.onStatus('Navigation data is unavailable for this scene');
      return false;
    }
    const result = planRoute(this.navigation, this.currentPosition(), poi.approachPoint);
    this.clearRoute();
    if (!result.ok) {
      // A preview (a search pick) fails quietly: the card already says there is no route from here.
      if (!options.preview) this.callbacks.onStatus(result.detail);
      return false;
    }
    const path = result.path.map((point): FloorPoint => [point[0], point[2]]);
    this.activeRoute = { poiId, path, length: polylineLength(path), preview: options.preview === true };
    this.routeDrawLength = Infinity;
    this.buildRouteVisuals();
    this.callbacks.onStatus(`Route ready · ${this.activeRoute.length.toFixed(1)} m to ${poi.label}`);
    return true;
  }

  /** A POI by id, or the floor point last picked on the minimap (MAP_POINT_ID). */
  private findTarget(poiId: string): Poi | undefined {
    if (poiId === MAP_POINT_ID) return this.mapPoint ?? undefined;
    return this.pois.find((candidate) => candidate.id === poiId);
  }

  /**
   * Route to (and guide towards) a walkable floor point, e.g. one clicked on the minimap. The point stands
   * in for a POI labelled "Map point" so the route, beacon and guidance work unchanged.
   */
  public routeToFloor([x, z]: FloorPoint): boolean {
    const eyeY = this.currentPosition()[1];
    this.mapPoint = {
      id: MAP_POINT_ID, label: 'Map point', category: 'other', position: [x, eyeY, z], approachPoint: [x, eyeY, z],
      aliases: [], confidence: 1, source: 'operator',
    };
    this.stopGuidance();
    if (!this.routeTo(MAP_POINT_ID)) return false;
    this.revealRouteTape();
    return this.startGuidance(MAP_POINT_ID);
  }

  /** The drawn route as floor points (smoothed), or null. */
  public getRoutePath(): FloorPoint[] | null {
    return this.activeRoute?.path ?? null;
  }

  private buildRouteVisuals(): void {
    const route = this.activeRoute;
    if (!route) return;
    const colour = route.preview ? new Color(0.45, 0.6, 0.12) : new Color(0.7, 0.93, 0.22);
    if (!this.routeMaterial) this.routeMaterial = new StandardMaterial();
    const material = this.routeMaterial;
    material.useLighting = false;
    material.diffuse = new Color(0, 0, 0);
    material.emissive = colour;
    // Opaque, so it is drawn before the (transparent) splats and writes depth: furniture standing in front
    // of the route still hides it, while the floor splats just under it and the haze around it do not.
    material.cull = CULLFACE_NONE;
    material.update();
    const ribbon = new Entity('route-ribbon');
    this.routeEntity.addChild(ribbon);
    this.routeRibbon = { entity: ribbon, mesh: null };
    this.updateRibbonMesh();
    if (!route.preview) this.buildChevrons(route.length);
    this.buildBeacon(route.path[route.path.length - 1], colour);
  }

  private updateRibbonMesh(): void {
    const route = this.activeRoute;
    const ribbon = this.routeRibbon;
    if (!route || !ribbon || !this.routeMaterial) return;
    const drawn = slicePolyline(route.path, this.routeDrawLength);
    const { positions, indices } = ribbonMesh(drawn, ROUTE_WIDTH_M, this.floorY + 0.04);
    if (ribbon.mesh) {
      // Meshes are reference-counted: removing the render component frees the old mesh.
      ribbon.entity.removeComponent('render');
      ribbon.mesh = null;
    }
    if (indices.length === 0) return;
    const mesh = new Mesh(this.app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setIndices(indices);
    mesh.update();
    ribbon.mesh = mesh;
    ribbon.entity.addComponent('render', { meshInstances: [new MeshInstance(mesh, this.routeMaterial)] });
  }

  private buildChevrons(length: number): void {
    if (!this.chevronMesh) {
      // A flat arrowhead pointing along +z, 24 cm long.
      const mesh = new Mesh(this.app.graphicsDevice);
      mesh.setPositions([0, 0, 0.14, -0.09, 0, -0.1, 0, 0, -0.02, 0.09, 0, -0.1]);
      mesh.setIndices([0, 1, 2, 0, 2, 3]);
      mesh.update();
      this.chevronMesh = mesh;
      const material = new StandardMaterial();
      material.useLighting = false;
      material.diffuse = new Color(0, 0, 0);
      material.emissive = new Color(1, 1, 1);
      material.cull = CULLFACE_NONE;
      material.update();
      this.chevronMaterial = material;
    }
    const count = Math.max(0, Math.ceil(length / CHEVRON_SPACING_M) + 1);
    for (let i = 0; i < count; i += 1) {
      const chevron = new Entity(`route-chevron-${i}`);
      chevron.addComponent('render', { meshInstances: [new MeshInstance(this.chevronMesh, this.chevronMaterial!)] });
      this.routeEntity.addChild(chevron);
      this.chevrons.push(chevron);
    }
  }

  private buildBeacon([x, z]: FloorPoint, colour: Color): void {
    const pole = this.createPrimitive('route-beacon-pole', 'cylinder', [x, this.floorY + 0.9, z], [0.05, 1.8, 0.05], colour);
    const ring = this.createPrimitive('route-beacon-ring', 'cylinder', [x, this.floorY + 0.05, z], [0.6, 0.01, 0.6], colour);
    [pole, ring].forEach((entity) => {
      const material = entity.render?.meshInstances[0]?.material as StandardMaterial | undefined;
      if (material) {
        material.useLighting = false;
        material.emissive = colour;
        material.update();
      }
      this.routeEntity.addChild(entity);
    });
    this.beaconRing = ring;
  }

  /** Start turn-by-turn guidance to a POI (plans and draws the route if it is not already drawn). */
  public startGuidance(poiId: string): boolean {
    if (!this.activeRoute || this.activeRoute.poiId !== poiId || this.activeRoute.preview) {
      if (!this.routeTo(poiId)) return false;
      this.revealRouteTape();
    }
    this.guidance = { poiId, following: false, arrived: false, offSince: null, reroutedAt: 0, lastKey: '' };
    this.updateGuidance();
    return true;
  }

  public stopGuidance(): void {
    this.followStop?.();
    this.followStop = null;
    if (!this.guidance) return;
    this.guidance = null;
    this.callbacks.onGuidance?.(null);
  }

  /**
   * Walk the camera along the route at walking speed, looking a little ahead, until arrival. Any
   * movement key (or entering pointer lock) hands control back to the visitor.
   */
  public followRoute(): boolean {
    const route = this.activeRoute;
    const guidance = this.guidance;
    if (!route || !guidance || guidance.arrived) return false;
    this.followStop?.();
    const eyeY = this.currentPosition()[1];
    let along = routeProgress(route.path, this.currentPosition()[0], this.currentPosition()[2]).along;
    guidance.following = true;
    const stop = this.startMotion((deltaMs) => {
      if (this.activeRoute !== route) return true;
      along = Math.min(route.length, along + (WALK_SPEED * deltaMs) / 1000);
      const at = pointAtDistance(route.path, along);
      const ahead = pointAtDistance(route.path, along + 1.5);
      this.yawPivot.setPosition(at.x, eyeY - PLAYER_HEIGHT, at.z);
      if (Math.hypot(ahead.x - at.x, ahead.z - at.z) > 0.05) {
        const { yawDegrees } = faceAngles([at.x, eyeY, at.z], [ahead.x, eyeY, ahead.z]);
        const current = this.yawPivot.getEulerAngles().y;
        this.yawPivot.setEulerAngles(0, lerpAngleDeg(current, yawDegrees, Math.min(1, deltaMs / 250)), 0);
      }
      this.pitchPivot.setLocalEulerAngles(lerp(this.pitchPivot.getLocalEulerAngles().x, 0, Math.min(1, deltaMs / 400)), 0, 0);
      this.lastLookAt = performance.now(); // the walk sets the view; no filmed-direction nudging meanwhile
      this.emitPosition();
      if (along < route.length) return false;
      ended();
      return true;
    }, (kill) => this.armCameraKill(() => {
      kill();
      ended();
    }));
    // However following ends (arrival, a movement key, Stop following, a cleared route), say so once.
    let done = false;
    const ended = () => {
      if (done) return;
      done = true;
      if (this.followStop === stopFollowing) this.followStop = null;
      if (this.guidance) {
        this.guidance.following = false;
        this.guidance.lastKey = '';
      }
      this.updateGuidance();
    };
    const stopFollowing = () => {
      stop();
      ended();
    };
    this.followStop = stopFollowing;
    this.updateGuidance();
    return true;
  }

  /** Stop auto-walking; guidance continues from where the camera is. */
  public stopFollowing(): void {
    this.followStop?.();
  }

  /** Per frame: progress along the route, re-route when the visitor leaves it, and arrival. */
  private updateGuidance(): void {
    const guidance = this.guidance;
    const route = this.activeRoute;
    if (!guidance || !route || guidance.arrived) return;
    const poi = this.findTarget(guidance.poiId);
    if (!poi) {
      this.stopGuidance();
      return;
    }
    const [x, , z] = this.currentPosition();
    const progress = routeProgress(route.path, x, z);
    const now = performance.now();
    if (progress.arrived) {
      guidance.arrived = true;
      this.followStop?.();
      this.chevrons.forEach((chevron) => chevron.destroy());
      this.chevrons = [];
      this.chevronMesh = null; // freed with the last chevron
      this.callbacks.onStatus(`Arrived at ${poi.label}`);
      this.emitGuidance(guidance, poi.label, 'arrived', 0, route.length, 'You have arrived');
      return;
    }
    if (progress.offRoute && !guidance.following) {
      guidance.offSince ??= now;
      if (now - guidance.offSince > 500) {
        // More than 1 m off the route for half a second: plan again from here.
        guidance.offSince = null;
        if (this.routeTo(guidance.poiId)) {
          guidance.reroutedAt = now;
          this.callbacks.onStatus(`Re-routed to ${poi.label}`);
        }
        return;
      }
    } else {
      guidance.offSince = null;
    }
    this.emitGuidance(
      guidance,
      poi.label,
      guidance.following ? 'following' : 'guiding',
      progress.remaining,
      route.length,
      formatInstruction(nextInstruction(route.path, progress.along)),
    );
  }

  private emitGuidance(guidance: NonNullable<PlayCanvasViewer['guidance']>, label: string, status: GuidanceUpdate['status'], remaining: number, total: number, instruction: string): void {
    const rerouted = performance.now() - guidance.reroutedAt < 2500;
    const key = `${status}|${instruction}|${remaining.toFixed(1)}|${rerouted}`;
    if (key === guidance.lastKey) return;
    guidance.lastKey = key;
    this.callbacks.onGuidance?.({ poiId: guidance.poiId, label, status, remaining, total, instruction, walkTime: formatWalkTime(remaining), rerouted });
  }

  /** Per frame: scroll the chevrons toward the destination and pulse the beacon ring. */
  private updateRouteOverlay(): void {
    this.updateGuidance();
    const route = this.activeRoute;
    if (!route) return;
    const seconds = performance.now() / 1000;
    const drawnLength = Math.min(route.length, this.routeDrawLength);
    const slots = chevronDistances(drawnLength, CHEVRON_SPACING_M, this.prefersReducedMotion() ? 0 : seconds * CHEVRON_SPEED_M_S);
    this.chevrons.forEach((chevron, i) => {
      const distance = slots[i];
      if (distance === undefined) {
        chevron.enabled = false;
        return;
      }
      const at = pointAtDistance(route.path, distance);
      chevron.enabled = true;
      chevron.setPosition(at.x, this.floorY + 0.06, at.z);
      chevron.setEulerAngles(0, (at.heading * 180) / Math.PI, 0);
    });
    if (this.beaconRing) {
      const pulse = this.prefersReducedMotion() ? 1 : 0.8 + 0.25 * Math.sin(seconds * 3);
      this.beaconRing.setLocalScale(0.6 * pulse, 0.01, 0.6 * pulse);
    }
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    this.labelEls.forEach(({ el }) => el.remove());
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('mousemove', this.onCanvasPointerMove);
    this.canvas.removeEventListener('mouseleave', this.onCanvasPointerLeave);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('mousedown', this.onCanvasMouseDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.removeEventListener('pointermove', this.onCanvasPointerDrag);
    this.canvas.removeEventListener('pointerup', this.onCanvasPointerEnd);
    this.canvas.removeEventListener('pointercancel', this.onCanvasPointerEnd);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    document.exitPointerLock();
    this.loadedAssets.forEach((asset) => {
      asset.unload();
      this.app.assets.remove(asset);
    });
    this.routeMaterial?.destroy();
    this.walkableOverlay?.material.destroy();
    this.app.destroy();
  }

  private readonly resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    // resizeCanvas takes CSS pixels and applies device.maxPixelRatio itself (RESOLUTION_AUTO). Passing
    // device pixels squared the ratio on scaled displays and, fed back through the layout, made the
    // canvas grow on every ResizeObserver tick. clientWidth/Height are the layout box (no transform).
    this.app.resizeCanvas(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight));
  };

  private update(dt: number): void {
    this.adaptResolution(dt);
    this.guideView(dt);
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

  /** Optional idle drift toward a filmed direction (?guide=1 only; see lib/viewGuide.ts). */
  private guideView(dt: number): void {
    if (!this.viewGuide || !this.navigation) return;
    const forward = this.yawPivot.forward;
    const heading = Math.atan2(forward.x, forward.z);
    const step = idleYawStep({
      enabled: true,
      msSinceLook: performance.now() - this.lastLookAt,
      heading,
      filmedHeading: filmedHeading(this.navigation, worldToCell(this.navigation, this.currentPosition()), heading),
      dt,
    });
    // Yaw and heading grow together (forward = (-sin yaw, -cos yaw)), so turn yaw by the heading gap.
    if (step !== 0) this.yawPivot.rotateLocal(0, step, 0);
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
    if (Math.hypot(target[0] - position[0], target[2] - position[2]) < 0.05) return; // standing on it: keep the view
    const { yawDegrees, pitchDegrees } = faceAngles(position, target);
    this.yawPivot.setEulerAngles(0, yawDegrees, 0);
    this.pitchPivot.setLocalEulerAngles(pitchDegrees, 0, 0);
  }

  /**
   * Remove the drawn route tape. Public (additive exposure only) so the
   * workspace can clear a stale tape on Clear route, Esc deselect, a new
   * destination, or a failed plot — the same triggers that reset the status
   * strip (review F1). No control flow of any existing method changed.
   */
  clearRoute(): void {
    this.tapeRevealStop?.();
    this.followStop?.();
    this.followStop = null;
    // Destroying the entities frees their (reference-counted) meshes, including the shared chevron mesh.
    this.routeRibbon = null;
    this.routeEntity.children.slice().forEach((child) => child.destroy());
    this.chevrons = [];
    this.chevronMesh = null;
    this.beaconRing = null;
    this.activeRoute = null;
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
    // Ambient studio light ensures all surfaces, shadows, and architectural details remain clearly visible
    this.app.scene.ambientLight = new Color(0.42, 0.44, 0.46);

    // Key directional light from above
    const key = new Entity('key-light');
    key.addComponent('light', { type: 'directional', color: new Color(1, 0.92, 0.82), intensity: 1.5, castShadows: false });
    key.setEulerAngles(45, 30, 0);
    this.app.root.addChild(key);

    // Front fill light illuminating objects facing the viewer
    const front = new Entity('front-light');
    front.addComponent('light', { type: 'directional', color: new Color(0.85, 0.90, 0.98), intensity: 1.2, castShadows: false });
    front.setEulerAngles(35, 180, 0);
    this.app.root.addChild(front);

    // Omni light for room ambient volume
    const fill = new Entity('fill-light');
    fill.addComponent('light', { type: 'omni', color: new Color(0.45, 0.50, 0.58), intensity: 3.5, range: 24 });
    fill.setPosition(0, 2.8, 0);
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
      void fetchVerifiedAsset(this.manifestUrl, assetRef)
        .then((verified) => {
          const label = assetRef.label ?? assetRef.uri;
          const url = resolveSceneUri(this.manifestUrl, assetRef.uri);
          // The splat that was just downloaded to check its sha256 is handed over as `contents` (SOG and
          // compressed PLY alike), so PlayCanvas parses those bytes instead of downloading it again.
          const contents = verifiedSplatContents(verified);
          // PlayCanvas 2.23 types `contents` as ArrayBuffer, but its PLY parser awaits it as a Response and
          // streams `.body` (an ArrayBuffer there fails with "Error loading resource"); its SOG loader takes both.
          const file = contents ? { url, contents: contents as unknown as ArrayBuffer } : { url };
          const asset = new Asset(label, 'gsplat', file);
          asset.once('load', () => {
            const entity = new Entity(label);
            entity.addComponent('gsplat', { asset });
            this.app.root.addChild(entity);
            this.cropSplat(entity);
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

  /** Hide splats outside the manifest bounds (+0.3 m): the haze of floaters around a capture. */
  private cropSplat(entity: Entity): void {
    entity.gsplat?.setWorkBufferModifier(cropModifier(cropBox(this.manifest.bounds)));
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

  /** A small sphere per POI (sized each frame in updatePoiOverlay) and, with a label layer, an HTML label. */
  private buildPoiMarkers(): void {
    this.poiIndex = new PoiSpatialIndex<Poi>(this.pois);
    this.pois.forEach((poi) => {
      if (poi.zone) this.buildZone(poi.id, poi.zone);
      const marker = this.createPrimitive(`poi-${poi.id}`, 'sphere', [poi.position[0], poi.position[1], poi.position[2]], [0.1, 0.1, 0.1], PIN_COLOR);
      const material = marker.render?.meshInstances[0]?.material as StandardMaterial | undefined;
      if (material) {
        material.emissive = new Color(0.25, 0.08, 0.01);
        material.update();
      }
      this.app.root.addChild(marker);
      this.poiEntities.set(poi.id, marker);
      if (this.labelLayer) {
        const el = document.createElement('div');
        el.className = 'poi-label';
        el.dataset.poiId = poi.id;
        el.textContent = poi.label;
        this.labelLayer.appendChild(el);
        this.labelEls.set(poi.id, { el, width: 0, height: 0 });
      }
    });
  }

  /**
   * Translucent, unlit floor overlay for a POI zone, 2 cm above the floor so it never z-fights.
   * Splats write no depth, so a zone is an overlay: objects standing on it do not hide it. The outline
   * (drawn every frame in updatePoiOverlay) keeps its boundary readable at low opacity.
   */
  private buildZone(poiId: string, zone: FloorPoint[]): void {
    const indices = triangulatePolygon(zone);
    if (indices.length === 0) return;
    const mesh = new Mesh(this.app.graphicsDevice);
    mesh.setPositions(zone.flatMap(([x, z]) => [x, this.floorY + 0.02, z]));
    mesh.setIndices(indices);
    mesh.update();
    const material = new StandardMaterial();
    material.useLighting = false;
    material.diffuse = new Color(0, 0, 0);
    material.emissive = new Color(0.66, 0.8, 0.09);
    material.opacity = 0.16;
    material.blendType = BLEND_NORMAL;
    material.depthWrite = false;
    material.cull = CULLFACE_NONE;
    material.update();
    const entity = new Entity(`zone-${poiId}`);
    entity.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)] });
    this.app.root.addChild(entity);
    this.zoneEntities.set(poiId, { entity, material });
  }

  /**
   * "Show walkable area": a translucent floor overlay of the walkable cells (one quad per row run), so the
   * space routes keep to is visible in the scene. Built on first use; hidden, not destroyed, when off.
   */
  public setWalkableOverlay(on: boolean): boolean {
    if (!this.navigation) return false;
    if (!this.walkableOverlay && on) {
      const { positions, indices } = walkableMesh(this.navigation, walkableRuns(this.navigation), this.floorY + 0.015);
      if (indices.length === 0) return false;
      const mesh = new Mesh(this.app.graphicsDevice);
      mesh.setPositions(positions);
      mesh.setIndices(indices);
      mesh.update();
      const material = new StandardMaterial();
      material.useLighting = false;
      material.diffuse = new Color(0, 0, 0);
      material.emissive = new Color(0.25, 0.75, 0.95);
      material.opacity = 0.28;
      material.blendType = BLEND_NORMAL;
      material.depthWrite = false;
      material.cull = CULLFACE_NONE;
      material.update();
      const entity = new Entity('walkable-overlay');
      entity.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)] });
      this.app.root.addChild(entity);
      this.walkableOverlay = { entity, material };
    }
    if (this.walkableOverlay) this.walkableOverlay.entity.enabled = on;
    return true;
  }

  /** Edit mode only: approach points (stem from pin to floor, line to the approach cell) and the draft zone. */
  private drawEditorOverlay(): void {
    if (!this.editMode) return;
    const y = this.floorY + 0.03;
    const approach = new Color(0.2, 0.55, 1);
    this.pois.forEach((poi) => {
      const [px, py, pz] = poi.position;
      const [ax, , az] = poi.approachPoint;
      this.app.drawLines([
        new PcVec3(px, py, pz), new PcVec3(px, y, pz),
        new PcVec3(px, y, pz), new PcVec3(ax, y, az),
        new PcVec3(ax - 0.12, y, az), new PcVec3(ax + 0.12, y, az),
        new PcVec3(ax, y, az - 0.12), new PcVec3(ax, y, az + 0.12),
      ], approach, false);
    });
    const draft = this.draftZone;
    if (draft.length > 0) {
      const color = new Color(1, 0.85, 0.2);
      const points: PcVec3[] = [];
      draft.forEach(([x, z], i) => {
        points.push(new PcVec3(x - 0.08, y, z), new PcVec3(x + 0.08, y, z), new PcVec3(x, y, z - 0.08), new PcVec3(x, y, z + 0.08));
        const next = draft[i + 1] ?? (draft.length >= 3 ? draft[0] : null);
        if (next) points.push(new PcVec3(x, y, z), new PcVec3(next[0], y, next[1]));
      });
      this.app.drawLines(points, color, false);
    }
  }

  private drawZoneOutlines(): void {
    this.drawEditorOverlay();
    const y = this.floorY + 0.03;
    this.pois.forEach((poi) => {
      if (!poi.zone || !this.zoneEntities.has(poi.id)) return;
      const strong = poi.id === this.hoveredPoiId || poi.id === this.selectedPoiId;
      const color = strong ? new Color(0.8, 0.95, 0.2) : new Color(0.66, 0.8, 0.09);
      const points = poi.zone.flatMap(([x, z], i) => {
        const [nx, nz] = poi.zone![(i + 1) % poi.zone!.length];
        return [new PcVec3(x, y, z), new PcVec3(nx, y, nz)];
      });
      this.app.drawLines(points, color, false);
    });
  }

  /**
   * Per frame: keep every pin between PIN_MIN_PX and PIN_MAX_PX on screen, and place the HTML labels
   * (fade with distance, hidden behind the camera, nearest wins when labels overlap).
   */
  private updatePoiOverlay(): void {
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) return;
    this.drawZoneOutlines();
    if (this.poiEntities.size === 0) {
      this.hitTargets = [];
      return;
    }
    const { width, height } = this.app.graphicsDevice.clientRect;
    if (width === 0 || height === 0) return;
    const focal = focalLengthPx(height, CAMERA_FOV);
    const eye = this.camera.getPosition();
    const forward = this.camera.forward;
    const projected: ProjectedLabel[] = [];
    const targets: ScreenTarget[] = [];
    const screen = new PcVec3();
    this.pois.forEach((poi) => {
      const marker = this.poiEntities.get(poi.id);
      if (!marker) return;
      const [x, y, z] = poi.position;
      const dx = x - eye.x;
      const dy = y - eye.y;
      const dz = z - eye.z;
      const distance = Math.hypot(dx, dy, dz);
      const selected = poi.id === this.selectedPoiId;
      const diameter = pinWorldDiameter(distance, focal) * (selected ? 1.3 : 1) * (this.pinPulse.get(poi.id) ?? 1);
      marker.setLocalScale(diameter, diameter, diameter);
      const behind = dx * forward.x + dy * forward.y + dz * forward.z <= 0;
      cameraComponent.worldToScreen(new PcVec3(x, y, z), screen);
      const pinPx = pinScreenPx(distance, focal) * (selected ? 1.3 : 1);
      if (!behind) targets.push({ id: poi.id, x: screen.x, y: screen.y, radius: pinPx / 2, distance });
      const label = this.labelEls.get(poi.id);
      if (!label) return;
      if (label.width === 0) {
        // Measure once, shown but invisible (a display:none element has no size).
        label.el.style.visibility = 'hidden';
        label.el.style.display = 'block';
        label.width = label.el.offsetWidth;
        label.height = label.el.offsetHeight;
        label.el.style.visibility = '';
      }
      projected.push({
        id: poi.id,
        x: screen.x,
        y: screen.y - pinPx / 2 - 4,
        distance,
        behind,
        width: label.width,
        height: label.height,
        pinned: selected,
      });
    });
    layoutLabels(projected, { width, height }).forEach((placed) => {
      const label = this.labelEls.get(placed.id);
      if (!label) return;
      label.el.style.display = placed.visible ? 'block' : 'none';
      if (!placed.visible) return;
      label.el.style.opacity = placed.opacity.toFixed(2);
      label.el.style.transform = `translate(${(placed.x - label.width / 2).toFixed(1)}px, ${(placed.y - label.height).toFixed(1)}px)`;
      const target = targets.find((candidate) => candidate.id === placed.id);
      if (target) target.label = [placed.x - label.width / 2, placed.y - label.height, placed.x + label.width / 2, placed.y];
    });
    this.hitTargets = targets;
    // Hover follows the crosshair under pointer lock and the cursor otherwise.
    const locked = document.pointerLockElement === this.canvas;
    const probe: [number, number] | null = locked ? [width / 2, height / 2] : this.pointerPx;
    this.setHovered(probe ? this.poiAtScreen(probe[0], probe[1]) : null);
  }

  private addBox(name: string, position: [number, number, number], scale: [number, number, number], color: Color): void {
    this.app.root.addChild(this.createPrimitive(name, 'box', position, scale, color));
  }

  private createPrimitive(name: string, type: 'box' | 'cylinder' | 'sphere', position: [number, number, number], scale: [number, number, number], color: Color): Entity {
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

  /** Camera kill-switch: pointer-lock entry, WASD/arrow keydown or looking around (drag) ends the tween. */
  private armCameraKill(kill: () => void): () => void {
    this.lookListeners.add(kill);
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
      this.lookListeners.delete(kill);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }

  /**
   * Go to a POI's view. With a walking route from here, the camera flies ALONG the route (eased,
   * at most 3 s) and ends at the approach point facing the POI, so it never passes through walls.
   * Without one (no walkable floor nearby, or none connects) it fades out, cuts, and fades back in.
   * Cancellable at any moment by a movement key or pointer lock; reduced motion cuts instantly.
   * Unknown/unwalkable destinations delegate to jumpTo for its status.
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
    this.followStop?.();
    const from = this.getPose();
    const result = planRoute(this.navigation, from.position, poi.approachPoint);
    if (!result.ok || result.path.length < 2) {
      this.lastFlight = { kind: 'fade', durationMs: FADE_CUT_MS, length: 0 };
      this.fadeCutTo(poi);
      return true;
    }
    // Fly from where the camera is, along the route, to the exact approach point.
    const path: FloorPoint[] = [[from.position[0], from.position[2]], ...result.path.map((p): FloorPoint => [p[0], p[2]]), [poi.approachPoint[0], poi.approachPoint[2]]];
    const plan = planFlight(path, from.position[1], poi.approachPoint[1], from.yawDegrees, from.pitchDegrees, poi.position);
    const durationMs = flightDurationMs(plan.length);
    this.lastFlight = { kind: 'route', durationMs, length: plan.length };
    let elapsed = 0;
    this.cameraMotionStop = this.startMotion((deltaMs) => {
      elapsed = Math.min(durationMs, elapsed + deltaMs);
      const pose = flightPose(plan, elapsed / durationMs);
      this.yawPivot.setPosition(pose.x, pose.y - PLAYER_HEIGHT, pose.z);
      this.yawPivot.setEulerAngles(0, pose.yawDegrees, 0);
      this.pitchPivot.setLocalEulerAngles(pose.pitchDegrees, 0, 0);
      this.lastLookAt = performance.now();
      this.emitPosition();
      if (elapsed < durationMs) return false;
      this.callbacks.onStatus(`Focused on ${poi.label}`);
      return true;
    }, (kill) => this.armCameraKill(kill));
    return true;
  }

  /**
   * Turn (not move) the camera to face a POI when it is in view from here (unobstructed on the grid and
   * within 20 m). Eased over 450 ms; a movement key or pointer lock cancels; reduced motion snaps.
   * Returns whether it turned.
   */
  public faceIfInView(poiId: string): boolean {
    const poi = this.pois.find((candidate) => candidate.id === poiId);
    if (!poi || !this.navigation) return false;
    const eye = this.currentPosition();
    if (Math.hypot(poi.position[0] - eye[0], poi.position[2] - eye[2]) < 0.05) return false;
    if (!poiInView(this.navigation, eye, poi)) return false;
    const target = faceAngles(eye, poi.position);
    const from = this.getPose();
    this.cameraMotionStop?.();
    this.lastLookAt = performance.now();
    if (this.prefersReducedMotion()) {
      this.lookAt(poi.position);
      return true;
    }
    let elapsed = 0;
    this.cameraMotionStop = this.startMotion((deltaMs) => {
      elapsed = Math.min(450, elapsed + deltaMs);
      const t = easeInOutCubic(elapsed / 450);
      this.yawPivot.setEulerAngles(0, lerpAngleDeg(from.yawDegrees, target.yawDegrees, t), 0);
      this.pitchPivot.setLocalEulerAngles(lerpAngleDeg(from.pitchDegrees, target.pitchDegrees, t), 0, 0);
      this.lastLookAt = performance.now();
      return elapsed >= 450;
    }, (kill) => this.armCameraKill(kill));
    return true;
  }

  /** How the last Go to view travelled (for tests and the dev hook). */
  public lastFlight: { kind: 'route' | 'fade'; durationMs: number; length: number } | null = null;

  /** Fade the canvas out, cut to the POI's approach point facing it, fade back in. */
  private fadeCutTo(poi: Poi): void {
    let elapsed = 0;
    let cut = false;
    const restore = () => { this.canvas.style.opacity = ''; };
    this.cameraMotionStop = this.startMotion((deltaMs) => {
      elapsed += deltaMs;
      if (!cut && elapsed >= FADE_CUT_MS / 2) {
        cut = true;
        const [x, y, z] = poi.approachPoint;
        this.yawPivot.setPosition(x, y - PLAYER_HEIGHT, z);
        this.lookAt(poi.position);
        this.lastLookAt = performance.now();
        this.emitPosition();
      }
      this.canvas.style.opacity = String(fadeCutOpacity(elapsed));
      if (elapsed < FADE_CUT_MS) return false;
      restore();
      this.callbacks.onStatus(`Focused on ${poi.label}`);
      return true;
    }, (kill) => this.armCameraKill(() => {
      kill();
      restore();
    }));
  }

  /**
   * Progressive route reveal (600 ms in-out): the ribbon grows from the visitor to the destination.
   * Reduced motion draws it at once. A route cleared or replaced mid-reveal cancels the reveal.
   */
  public revealRouteTape(durationMs = 600): void {
    this.tapeRevealStop?.();
    const route = this.activeRoute;
    if (!route) return;
    if (resolveTweenDuration(durationMs, this.prefersReducedMotion()) === 0) return;
    let tween = createTween(durationMs);
    this.tapeRevealStop = this.startMotion((deltaMs) => {
      if (this.activeRoute !== route) return true;
      const stepped = advanceTween(tween, deltaMs);
      tween = stepped.tween;
      this.routeDrawLength = stepped.done ? Infinity : route.length * easeInOutCubic(stepped.progress);
      this.updateRibbonMesh();
      if (stepped.done) {
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

    // Pin size is recomputed every frame, so the pulse scales a multiplier that updatePoiOverlay applies.
    const restore = (): void => {
      this.pinPulse.delete(poiId);
    };
    let tween = createTween(360);
    const stopMotion = this.startMotion((deltaMs) => {
      const stepped = advanceTween(tween, deltaMs);
      tween = stepped.tween;
      const swell = 1 + 0.55 * Math.sin(Math.PI * stepped.progress);
      this.pinPulse.set(poiId, swell);
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
