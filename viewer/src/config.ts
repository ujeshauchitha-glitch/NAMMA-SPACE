// Scene config comes from public/models/scene.json so a new capture needs no code change.
export interface SceneConfig {
  title: string
  /** Splat file relative to the site root (.spz, .ply, .splat, .ksplat). */
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
  /** True for test fixtures that are not a reconstruction; the viewer shows a permanent badge. */
  synthetic?: boolean
}

export const DEFAULT_CONFIG: SceneConfig = {
  title: 'Namma Space',
  splat: 'models/scene.spz',
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
    const res = await fetch(`${base}${scene}`)
    if (res.ok) cfg = { ...DEFAULT_CONFIG, ...(await res.json()) }
  } catch {
    // fall back to defaults
  }
  const override = params.get('splat')
  if (override) cfg = { ...cfg, splat: override }
  return cfg
}
