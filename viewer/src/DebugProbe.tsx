import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

export interface FrameStats {
  fps: number
  frameMs: number
  /** Slowest single frame in the window, which is what a stutter looks like. */
  worstMs: number
  x: number
  y: number
  z: number
}

/** Samples frame timing and camera position, reporting twice a second. Mounted only with ?debug. */
export function DebugProbe({ onStats }: { onStats: (s: FrameStats) => void }) {
  const acc = useRef({ time: 0, frames: 0, worst: 0 })

  useFrame(({ camera }, delta) => {
    const a = acc.current
    a.time += delta
    a.frames += 1
    a.worst = Math.max(a.worst, delta)
    if (a.time >= 0.5) {
      onStats({
        fps: a.frames / a.time,
        frameMs: (a.time / a.frames) * 1000,
        worstMs: a.worst * 1000,
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      })
      acc.current = { time: 0, frames: 0, worst: 0 }
    }
  })

  return null
}
