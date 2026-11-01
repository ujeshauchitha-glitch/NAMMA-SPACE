import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { AdaptiveResolution } from './AdaptiveResolution'
import { DEFAULT_CONFIG, loadConfig, type SceneConfig } from './config'
import { FirstPersonControls } from './FirstPersonControls'
import { SplatScene } from './SplatScene'
import { loadSplat, splatUrl, type LoadProgress } from './loadSplat'

type Status = 'loading' | 'ready' | 'error'

export default function App() {
  const [config, setConfig] = useState<SceneConfig | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [started, setStarted] = useState(false)
  const [bytes, setBytes] = useState<LoadProgress>({ loaded: 0, total: null })

  useEffect(() => {
    loadConfig().then(setConfig)
  }, [])

  useEffect(() => {
    if (!config) return
    document.title = config.title
    // Start downloading now; SplatScene mounts only once the canvas is laid out.
    loadSplat(splatUrl(config.splat), setBytes).catch(() => {}) // errors are reported by SplatScene
  }, [config])

  const onProgress = useCallback((s: Status, message?: string) => {
    setStatus(s)
    if (message) setError(message)
  }, [])

  const onBytes = useCallback((p: LoadProgress) => setBytes(p), [])

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
          dpr={1}
          onClick={() => started && !locked && document.querySelector('canvas')?.requestPointerLock?.()}
        >
          <AdaptiveResolution />
          <SplatScene config={config} onProgress={onProgress} onBytes={onBytes} />
          <FirstPersonControls
            spawn={spawn}
            yaw={config.spawnYaw}
            eyeHeight={config.eyeHeight}
            bounds={config.bounds}
            walkPath={config.walkPath}
            walkRadius={config.walkRadius}
            enabled={status === 'ready'}
            onLock={setLocked}
          />
        </Canvas>
      )}

      {config?.synthetic && <div className="progress error">SYNTHETIC TEST FIXTURE — not a reconstruction</div>}
      {status === 'loading' && config && <LoadingCard progress={bytes} />}

      {status === 'error' && (
        <div className="overlay">
          <div className="card">
            <h1>Couldn't load the space</h1>
            <p className="error">{error}</p>
            <p>Check that the splat URL in <kbd>scene.json</kbd> is uploaded and public, or pass <kbd>?splat=URL</kbd>.</p>
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
              <kbd>Q</kbd>/<kbd>E</kbd> down/up · <kbd>R</kbd> back to start · <kbd>Esc</kbd> release mouse
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

const MB = 1e6

function LoadingCard({ progress }: { progress: LoadProgress }) {
  const { loaded, total } = progress
  const fraction = total ? Math.min(loaded / total, 1) : null
  // Download done but Spark still decoding: say so, or a full bar looks frozen.
  const decoding = total !== null && loaded >= total
  return (
    <div className="overlay">
      <div className="card loading">
        <h1>Loading space…</h1>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}>
          <div className={fraction === null ? 'fill indeterminate' : 'fill'}
            style={fraction === null ? undefined : { width: `${fraction * 100}%` }} />
        </div>
        <p>
          {decoding
            ? 'Preparing the splat…'
            : total
              ? `${(loaded / MB).toFixed(1)} / ${(total / MB).toFixed(1)} MB`
              : `${(loaded / MB).toFixed(1)} MB`}
        </p>
      </div>
    </div>
  )
}
