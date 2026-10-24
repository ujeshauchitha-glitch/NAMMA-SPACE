import { z } from 'zod';

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const Matrix4Schema = z.array(z.array(z.number()).length(4)).length(4);

export const AssetRefSchema = z.object({
  kind: z.enum(['glb', 'gltf', 'sog', 'procedural']),
  uri: z.string().min(1),
  label: z.string().optional(),
  sha256: z.string().optional(),
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
});

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
});

export type Vec3 = z.infer<typeof Vec3Schema>;
export type Poi = z.infer<typeof PoiSchema>;
export type NavigationGrid = z.infer<typeof NavigationSchema>;
export type SceneManifest = z.infer<typeof SceneManifestSchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;

export type SceneBundle = {
  manifest: SceneManifest;
  navigation: NavigationGrid | null;
  pois: Poi[];
  quality: QualityReport;
};
