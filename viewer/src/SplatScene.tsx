import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import type { SceneConfig } from './config'

export interface LoadInfo {
  splats: number
  loadMs: number
}

interface Props {
  config: SceneConfig
  onProgress: (state: 'loading' | 'ready' | 'error', message?: string) => void
  onLoaded?: (info: LoadInfo) => void
}

/** Mounts Spark's renderer and one SplatMesh into the R3F scene. */
export function SplatScene({ config, onProgress, onLoaded }: Props) {
  const { gl, scene } = useThree()

  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl })
    scene.add(spark)
    const base = import.meta.env.BASE_URL
    const url = /^(https?:)?\/\//.test(config.splat) ? config.splat : `${base}${config.splat}`
    const mesh = new SplatMesh({ url })
    mesh.rotation.set(...config.rotation)
    mesh.scale.setScalar(config.scale)
    scene.add(mesh)

    let cancelled = false
    const t0 = performance.now()
    onProgress('loading')
    mesh.initialized
      .then(() => {
        if (cancelled) return
        onLoaded?.({
          splats: mesh.packedSplats?.numSplats ?? mesh.extSplats?.numSplats ?? 0,
          loadMs: performance.now() - t0,
        })
        onProgress('ready')
      })
      .catch((err: unknown) => !cancelled && onProgress('error', String(err)))

    return () => {
      cancelled = true
      scene.remove(mesh)
      scene.remove(spark)
      mesh.dispose()
    }
  }, [gl, scene, config, onProgress, onLoaded])

  return null
}
