import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import type { SceneConfig } from './config'

interface Props {
  config: SceneConfig
  onProgress: (state: 'loading' | 'ready' | 'error', message?: string) => void
}

/** Mounts Spark's renderer and one SplatMesh into the R3F scene. */
export function SplatScene({ config, onProgress }: Props) {
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
    onProgress('loading')
    mesh.initialized
      .then(() => !cancelled && onProgress('ready'))
      .catch((err: unknown) => !cancelled && onProgress('error', String(err)))

    return () => {
      cancelled = true
      scene.remove(mesh)
      scene.remove(spark)
      mesh.dispose()
    }
  }, [gl, scene, config, onProgress])

  return null
}
