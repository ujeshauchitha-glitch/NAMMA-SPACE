import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

const STEP = 0.25
const SLOW = 1 / 40 // seconds per frame: drop resolution below ~40 fps
const FAST = 1 / 57 // raise it again above ~57 fps

/**
 * Renders at the display's full pixel ratio (capped at 2) when the GPU keeps up, and steps down
 * towards 1 when it does not. Splats are fill-rate bound, so this is the main quality/fps lever.
 */
export function AdaptiveResolution() {
  const setDpr = useThree((s) => s.setDpr)
  const dpr = useThree((s) => s.viewport.dpr)
  const acc = useRef({ time: 0, frames: 0 })
  const max = Math.min(window.devicePixelRatio || 1, 2)

  useFrame((_, dt) => {
    const a = acc.current
    a.time += Math.min(dt, 0.25)
    a.frames += 1
    if (a.time < 1) return
    const frame = a.time / a.frames
    a.time = 0
    a.frames = 0
    if (frame > SLOW && dpr > 1) setDpr(Math.max(1, dpr - STEP))
    else if (frame < FAST && dpr < max) setDpr(Math.min(max, dpr + STEP))
  })

  return null
}
