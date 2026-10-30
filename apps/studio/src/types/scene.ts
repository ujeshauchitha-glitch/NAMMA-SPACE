import { z } from 'zod';

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const Matrix4Schema = z.array(z.array(z.number()).length(4)).length(4);

/* ------------------------------------------------------------------ *
 * D3 · one URI contract for the browser loader and the Python
 * validator (scripts/validate_scene.py). A scene URI is a bundle-
 * relative POSIX path: no scheme (except procedural:// on procedural
 * assets), no leading slash, no backslash, no query/fragment and no
 * '..' segment. Resolution additionally keeps the target inside the
 * declaring manifest's directory on the app origin — see
 * sceneLoader.resolveSceneUri for the resolution-time enforcement.
 * ------------------------------------------------------------------ */
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function isBundleRelativeUri(uri: string): boolean {
  if (uri.length === 0 || uri !== uri.trim()) return false;
  if (SCHEME_PATTERN.test(uri)) return false;
  if (uri.startsWith('/') || uri.includes('\\')) return false;
  if (uri.includes('?') || uri.includes('#')) return false;
  return !uri.split('/').includes('..');
}

export const AssetRefSchema = z.object({
  kind: z.enum(['glb', 'gltf', 'sog', 'ply', 'procedural']),
  uri: z.string().min(1),
  label: z.string().optional(),
  sha256: z.string().optional(),
}).superRefine((asset, context) => {
  if (asset.kind === 'procedural') {
    // Procedural assets are engine-built and never fetched, so they are the
    // only entries allowed a scheme — and it must be procedural://.
    if (!asset.uri.startsWith('procedural://')) {
      context.addIssue({
        code: 'custom',
        path: ['uri'],
        message: `procedural asset URI must use the procedural:// scheme (engine-built assets are never fetched): ${asset.uri}`,
      });
    }
  } else if (!isBundleRelativeUri(asset.uri)) {
    context.addIssue({
      code: 'custom',
      path: ['uri'],
      message: `visual asset URI must be bundle-relative (no scheme, no leading slash, no '..', no query/fragment): ${asset.uri}`,
    });
  }
  if (asset.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(asset.sha256)) {
    context.addIssue({
      code: 'custom',
      path: ['sha256'],
      message: `malformed sha256 digest for ${asset.uri} — expected 64 lowercase hex characters.`,
    });
  }
});

export const QualityReportSchema = z.object({
  status: z.enum(['passed', 'needs-review', 'failed']),
  readiness: z.enum(['blocked', 'partial', 'visual_ready', 'navigation_ready', 'validated']).optional(),
  score: z.number().min(0).max(1).optional(),
  warnings: z.array(z.string()).default([]),
  checks: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['passed', 'warning', 'failed']),
    detail: z.string(),
  })).default([]),
  /** Properties the emitter never measured — omitted or empty means none declared. */
  notMeasured: z.array(z.string()).optional(),
  measured: z.record(z.string(), z.unknown()).optional(),
});

/* ------------------------------------------------------------------ *
 * Unified per-frame Observation (T-B). Additive on staged-bundle entries
 * and on prepare_capture.py frame records. Unknown stays unknown:
 * omitted keys or explicit unknown markers — never a fabricated pose.
 * ------------------------------------------------------------------ */

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const ObservationSchema = z.object({
  projectId: z.string().min(1).optional(),
  spaceId: z.string().min(1).optional(),
  roomId: z.string().min(1).nullable().optional(),
  captureSessionId: z.string().min(1).optional(),
  viewGroupId: z.string().min(1).nullable().optional(),
  modality: z.enum(['photo', 'video-frame', 'live-frame']),
  sourceFilename: z.string().min(1).optional(),
  perFrameTimestampSec: z.number().finite().optional(),
  format: z.enum(['jpeg', 'png', 'webp']).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().positive().optional(),
  orientation: z.union([
    z.literal('unknown'),
    z.number().int().min(1).max(8),
  ]),
  cameraMetadata: z.discriminatedUnion('status', [
    z.object({ status: z.literal('unknown') }).strict(),
    z.object({
      status: z.literal('recorded'),
      make: z.string().optional(),
      model: z.string().optional(),
      iso: z.number().int().positive().optional(),
    }).strict(),
  ]),
  contentHash: Sha256HexSchema,
  qualityResults: z.object({
    status: z.enum(['unknown', 'measured']),
    notMeasured: z.array(z.string()).default([]),
  }),
  stagedAt: z.number().int().nonnegative().optional(),
  provenance: z.object({
    emitter: z.string().min(1),
    stage: z.string().min(1),
  }),
});

export type Observation = z.infer<typeof ObservationSchema>;

export const PoiSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(['room', 'service', 'landmark', 'furniture', 'entrance', 'other']),
  roomId: z.string().optional(),
  position: Vec3Schema,
  approachPoint: Vec3Schema,
  aliases: z.array(z.string()).default([]),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['operator', 'model', 'synthetic']),
});

export const NavigationSchema = z.object({
  version: z.number().int().positive(),
  coordinateSystem: z.literal('x-z-grid'),
  origin: z.object({ x: z.number(), z: z.number() }),
  cellSize: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blocked: z.array(z.number().int().nonnegative()),
  unknown: z.array(z.number().int().nonnegative()).default([]),
  start: z.object({ x: z.number().int().nonnegative(), z: z.number().int().nonnegative() }),
  clearanceMetres: z.number().nonnegative(),
  /** Captured scenes: per cell, a bitmask of the `viewSectors` compass sectors the phone faced from nearby. */
  viewSectors: z.number().int().min(1).max(31).optional(),
  views: z.array(z.number().int().nonnegative()).optional(),
}).superRefine((grid, context) => {
  const maxIndex = grid.width * grid.height - 1;
  const occupied = new Set<number>();
  for (const [label, indices] of [['blocked', grid.blocked], ['unknown', grid.unknown]] as const) {
    for (const index of indices) {
      if (index > maxIndex) {
        context.addIssue({ code: 'custom', path: [label], message: `${label} index ${index} exceeds the ${grid.width}×${grid.height} grid.` });
      }
      if (occupied.has(index)) {
        context.addIssue({ code: 'custom', path: [label], message: `Cell ${index} is listed more than once across blocked/unknown data.` });
      }
      occupied.add(index);
    }
  }
  if (grid.start.x >= grid.width || grid.start.z >= grid.height) {
    context.addIssue({ code: 'custom', path: ['start'], message: 'The navigation start cell is outside the grid bounds.' });
  }
  const startIndex = grid.start.z * grid.width + grid.start.x;
  if (grid.blocked.includes(startIndex) || grid.unknown.includes(startIndex)) {
    context.addIssue({ code: 'custom', path: ['start'], message: 'The navigation start cell must be verified walkable.' });
  }
});

export const SceneManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sceneId: z.string().min(1),
  displayName: z.string().min(1),
  sceneKind: z.enum(['synthetic-demo', 'reconstructed-capture']),
  description: z.string(),
  coordinateSystem: z.literal('right-handed-y-up'),
  units: z.literal('metre'),
  worldFromReconstruction: Matrix4Schema,
  bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
  startPosition: Vec3Schema,
  startYawDegrees: z.number(),
  visualAssets: z.array(AssetRefSchema),
  collisionAsset: AssetRefSchema.nullable(),
  navigationUri: z.string().min(1).nullable(),
  semanticUri: z.string().min(1),
  qualityUri: z.string().min(1),
  sourceFrameManifest: z.string().min(1).nullable().optional(),
  processingReportUri: z.string().min(1).nullable().optional(),
  scaleStatus: z.enum(['known', 'estimated', 'unknown']).default('unknown'),
  provenance: z.object({
    pipeline: z.string(),
    pipelineVersion: z.string(),
    capturedAt: z.string(),
    source: z.string(),
    notes: z.array(z.string()).default([]),
  }),
}).superRefine((manifest, context) => {
  if (manifest.bounds.min.some((value, index) => value >= manifest.bounds.max[index])) {
    context.addIssue({ code: 'custom', path: ['bounds'], message: 'Bounds must have a strictly positive extent on every axis.' });
  }
  if (manifest.sceneKind === 'synthetic-demo' && !manifest.provenance.source.toLowerCase().includes('synthetic')) {
    context.addIssue({ code: 'custom', path: ['provenance', 'source'], message: 'Synthetic scenes must identify their synthetic provenance.' });
  }

  /* D2 · dead-field honesty — the renderer applies neither value below, so
   * only the shapes it actually honours are accepted:
   *  - worldFromReconstruction: identity only (schemaVersion 1 semantics;
   *    non-identity transforms are rejected with an actionable message until
   *    the engine applies them to geometry, POIs, navigation and the start
   *    pose end-to-end),
   *  - collisionAsset: null only (the navigation grid is the collision
   *    model; a declared collision mesh would never be loaded).
   * Shipped bundles in public/scenes/* already use identity/null, so this
   * tightens the contract without breaking them. The Python validator
   * (scripts/validate_scene.py) enforces the same two rules. */
  const matrix = manifest.worldFromReconstruction;
  const isIdentity = matrix.length === 4 && matrix.every((row, rowIndex) =>
    row.length === 4 && row.every((value, columnIndex) => value === (rowIndex === columnIndex ? 1 : 0)));
  if (!isIdentity) {
    context.addIssue({
      code: 'custom',
      path: ['worldFromReconstruction'],
      message: 'worldFromReconstruction must be the identity matrix — the viewer applies no reconstruction→world transform, so non-identity transforms are rejected until the engine applies them end-to-end.',
    });
  }
  if (manifest.collisionAsset !== null) {
    context.addIssue({
      code: 'custom',
      path: ['collisionAsset'],
      message: 'collisionAsset is not supported: the viewer never loads a collision mesh — declare obstacles in navigation.blocked/unknown instead.',
    });
  }

  /* D3 · every document the bundle references must obey the same
   * bundle-relative URI policy at parse time (resolution-time enforcement
   * lives in sceneLoader.resolveSceneUri; the Python validator checks the
   * identical rules). */
  const bundleReferences: Array<[string, string | null | undefined]> = [
    ['semanticUri', manifest.semanticUri],
    ['qualityUri', manifest.qualityUri],
    ['navigationUri', manifest.navigationUri],
    ['sourceFrameManifest', manifest.sourceFrameManifest],
    ['processingReportUri', manifest.processingReportUri],
  ];
  for (const [role, uri] of bundleReferences) {
    if (uri == null) continue;
    if (!isBundleRelativeUri(uri)) {
      context.addIssue({
        code: 'custom',
        path: [role],
        message: `${role} must be a bundle-relative scene URI (no scheme, no leading slash, no '..', no query/fragment): ${uri}`,
      });
    }
  }
});

export type Vec3 = z.infer<typeof Vec3Schema>;
export type Poi = z.infer<typeof PoiSchema>;
export type AssetRef = z.infer<typeof AssetRefSchema>;
export type NavigationGrid = z.infer<typeof NavigationSchema>;
export type SceneManifest = z.infer<typeof SceneManifestSchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;

export type SceneBundle = {
  manifest: SceneManifest;
  navigation: NavigationGrid | null;
  pois: Poi[];
  quality: QualityReport;
};

/* ------------------------------------------------------------------ *
 * T13 — prepared capture bundle (ADDITIVE extension of the scene
 * contract). A staged export is *prepared*, never a scene bundle: it
 * carries rooms, view groups and the staged frames with their digests,
 * and makes no claim that any reconstruction ran.
 * ------------------------------------------------------------------ */

export const StagedImageEntrySchema = z.object({
  id: z.string().min(1),
  viewGroupId: z.string().nullable(),
  /** Digest of the actual bytes stored under `file` (verifiable offline). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  source: z.enum(['operator', 'phone']),
  stagedAt: z.number().int().nonnegative(),
  /** Path inside the archive: `images/<sha256>.jpg`. */
  file: z.string().regex(/^images\/[0-9a-f]{64}\.jpg$/),
  /** Additive T-B observation. Legacy bundles omit this and still parse. */
  observation: ObservationSchema.optional(),
});

export const PreparedRoomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dimensionsM: Vec3Schema,
  originM: Vec3Schema,
  createdAt: z.number().int().nonnegative(),
  viewGroupIds: z.array(z.string().min(1)),
});

export const PreparedViewGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  roomId: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  imageIds: z.array(z.string().min(1)),
});

export const PreparedBundleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  /** The only honest kind for a staged export — never a scene claim. */
  bundleKind: z.literal('prepared-capture'),
  displayName: z.string().min(1),
  /** ISO-8601, injected by the caller (deterministic builds inject a fixed one). */
  createdAt: z.string().min(1),
  provenance: z.object({
    source: z.literal('operator'),
    pipeline: z.string().min(1),
    notes: z.array(z.string()).default([]),
  }),
  counts: z.object({
    images: z.number().int().nonnegative(),
    rooms: z.number().int().nonnegative(),
    viewGroups: z.number().int().nonnegative(),
  }),
  rooms: z.array(PreparedRoomSchema),
  viewGroups: z.array(PreparedViewGroupSchema),
  images: z.array(StagedImageEntrySchema),
});

export type StagedImageEntry = z.infer<typeof StagedImageEntrySchema>;
export type PreparedRoom = z.infer<typeof PreparedRoomSchema>;
export type PreparedViewGroup = z.infer<typeof PreparedViewGroupSchema>;
export type PreparedBundleManifest = z.infer<typeof PreparedBundleManifestSchema>;
