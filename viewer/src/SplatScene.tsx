import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import type { SceneConfig } from './config'
import { loadSplat, SplatLoadError, splatUrl, type LoadProgress } from './loadSplat'

interface Props {
  config: SceneConfig
  onProgress: (state: 'loading' | 'ready' | 'error', message?: string) => void
  onBytes: (p: LoadProgress) => void
}

/** Mounts Spark's renderer and one SplatMesh into the R3F scene. */
export function SplatScene({ config, onProgress, onBytes }: Props) {
  const { gl, scene } = useThree()

  useEffect(() => {
    // Brush (like the reference 3DGS rasteriser) adds a 0.3 px² blur to every projected splat while
    // training and cuts Gaussians at 3 sigma. Spark's defaults (no blur, sqrt(8) sigma) render the same
    // splats thinner, which shows up as speckle and pin-holes; matching the training renderer fixes that.
    const spark = new SparkRenderer({ renderer: gl, preBlurAmount: 0.3, maxStdDev: 3 })
    scene.add(spark)
    const url = splatUrl(config.splat)
    const abort = new AbortController()
    let mesh: SplatMesh | null = null

    onProgress('loading')
    loadSplat(url, (p) => !abort.signal.aborted && onBytes(p))
      .then((fileBytes) => {
        if (abort.signal.aborted) return
        // Copy: Spark may hand the buffer to a worker, and the shared download must stay usable for a
        // remount (React StrictMode, scene change).
        mesh = new SplatMesh({ fileBytes: fileBytes.slice(), fileName: url.split(/[?#]/, 1)[0] })
        mesh.rotation.set(...config.rotation)
        mesh.scale.setScalar(config.scale)
        scene.add(mesh)
        return mesh.initialized.then(() => {
          if (!abort.signal.aborted) onProgress('ready')
        })
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        const message = err instanceof SplatLoadError ? err.message : `Could not decode the splat: ${String(err)}`
        onProgress('error', message)
      })

    return () => {
      abort.abort()
      scene.remove(spark)
      if (mesh) {
        scene.remove(mesh)
        mesh.dispose()
      }
    }
  }, [gl, scene, config, onProgress, onBytes])

  return null
}
