import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { DEFAULT_CONFIG, loadConfig, type SceneConfig } from './config'
import { FirstPersonControls } from './FirstPersonControls'
import { SplatScene } from './SplatScene'

type Status = 'loading' | 'ready' | 'error'

export default function App() {
  const [config, setConfig] = useState<SceneConfig | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    loadConfig().then(setConfig)
  }, [])

  useEffect(() => {
    if (config) document.title = config.title
  }, [config])

  const onProgress = useCallback((s: Status, message?: string) => {
    setStatus(s)
    if (message) setError(message)
  }, [])

  const spawn = useMemo(() => new THREE.Vector3(...(config?.spawn ?? DEFAULT_CONFIG.spawn)), [config])

  const enter = () => {
    const canvas = document.querySelector('canvas')
    // Touch devices have no pointer lock; they use drag-to-look instead.
    canvas?.requestPointerLock?.()
    setStarted(true)
  }

  return (
    <>
      {config && (
        <Canvas
          camera={{ fov: 70, near: 0.05, far: 200 }}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          dpr={[1, 1.5]}
          onClick={() => started && !locked && document.querySelector('canvas')?.requestPointerLock?.()}
        >
          <SplatScene config={config} onProgress={onProgress} />
          <FirstPersonControls
            spawn={spawn}
            yaw={config.spawnYaw}
            eyeHeight={config.eyeHeight}
            bounds={config.bounds}
            enabled={status === 'ready'}
            onLock={setLocked}
          />
        </Canvas>
      )}

      {config?.synthetic && <div className="progress error">SYNTHETIC TEST FIXTURE — not a reconstruction</div>}
      {status === 'loading' && config && !config.synthetic && <div className="progress">Loading space…</div>}

      {status === 'error' && (
        <div className="overlay">
          <div className="card">
            <h1>Couldn't load the space</h1>
            <p className="error">{error}</p>
            <p>No real capture is installed yet. Run the pipeline (see README) or pass <kbd>?splat=URL</kbd>.</p>
          </div>
        </div>
      )}

      {status === 'ready' && !started && (
        <div className="overlay">
          <div className="card">
            <h1>{config?.title}</h1>
            <p>Walk through the reconstructed space in first person.</p>
            <p>
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> move · mouse look · <kbd>Shift</kbd> sprint ·{' '}
              <kbd>Q</kbd>/<kbd>E</kbd> down/up · <kbd>Esc</kbd> release mouse
            </p>
            <p>On touch: drag to look, two fingers to walk.</p>
            <button onClick={enter}>Enter space</button>
          </div>
        </div>
      )}

      {started && (
        <>
          <div className="crosshair" />
          {!locked && (
            <div className="hud">Click the view to resume mouse look</div>
          )}
        </>
      )}
    </>
  )
}
