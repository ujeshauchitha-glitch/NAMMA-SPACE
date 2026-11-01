// Scene config comes from public/models/scene.json so a new capture needs no code change.
// Production splats live on external storage (scene.json holds an absolute URL); dev-assets/ is dev-only.
export interface SceneConfig {
  title: string
  /** Splat URL: absolute (external storage) or relative to the site root. .sog, .spz or .ply. */
  splat: string
  /** Camera spawn position in world units (metres after scale is applied). */
  spawn: [number, number, number]
  /** Spawn heading in radians around +Y. */
  spawnYaw: number
  /** Eye height above the spawn point, in metres. */
  eyeHeight: number
  /** Euler XYZ rotation applied to the splat (COLMAP output is Y-down, so default flips X). */
  rotation: [number, number, number]
  /** Uniform scale to bring the COLMAP model to metres. */
  scale: number
  /** Optional axis-aligned walk limits [minX, maxX, minZ, maxZ]. */
  bounds?: [number, number, number, number]
  /** Optional filmed path as [x, z] points in capture order. With it, walking is limited to within
   *  walkRadius of the path: splats only look right near the views they were trained from. */
  walkPath?: [number, number][]
  walkRadius?: number
  /** True for test fixtures that are not a reconstruction; the viewer shows a permanent badge. */
  synthetic?: boolean
}

export const DEFAULT_CONFIG: SceneConfig = {
  title: 'Namma Space',
  splat: 'models/scene.sog',
  spawn: [0, 0, 0],
  spawnYaw: 0,
  eyeHeight: 1.6,
  rotation: [Math.PI, 0, 0],
  scale: 1,
}

export async function loadConfig(): Promise<SceneConfig> {
  const params = new URLSearchParams(window.location.search)
  const base = import.meta.env.BASE_URL
  let cfg = DEFAULT_CONFIG
  try {
    // ?scene=<path to a scene.json> selects a config; the default is the real capture.
    const scene = params.get('scene') ?? 'models/scene.json'
    const res = await fetch(/^(https?:)?\/\//.test(scene) ? scene : `${base}${scene}`)
    if (res.ok) cfg = { ...DEFAULT_CONFIG, ...(await res.json()) }
  } catch {
    // fall back to defaults
  }
  const override = params.get('splat')
  if (override) cfg = { ...cfg, splat: override }
  return cfg
}
