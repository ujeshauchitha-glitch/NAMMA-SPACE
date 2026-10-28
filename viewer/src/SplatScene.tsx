import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import type { SceneConfig } from './config'
import { fetchSplat, SplatLoadError, type LoadProgress } from './loadSplat'

interface Props {
  config: SceneConfig
  onProgress: (state: 'loading' | 'ready' | 'error', message?: string) => void
  onBytes: (p: LoadProgress) => void
}

/** Mounts Spark's renderer and one SplatMesh into the R3F scene. */
export function SplatScene({ config, onProgress, onBytes }: Props) {
  const { gl, scene } = useThree()

  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl })
    scene.add(spark)
    const base = import.meta.env.BASE_URL
    const url = /^(https?:)?\/\//.test(config.splat) ? config.splat : `${base}${config.splat}`
    const abort = new AbortController()
    let mesh: SplatMesh | null = null

    onProgress('loading')
    fetchSplat(url, onBytes, abort.signal)
      .then((fileBytes) => {
        if (abort.signal.aborted) return
        mesh = new SplatMesh({ fileBytes, fileName: url.split(/[?#]/, 1)[0] })
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
