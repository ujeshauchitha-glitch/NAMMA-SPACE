import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface Props {
  spawn: THREE.Vector3
  yaw: number
  eyeHeight: number
  bounds?: [number, number, number, number]
  enabled: boolean
  onLock: (locked: boolean) => void
}

const WALK = 1.6 // m/s
const SPRINT = 3.4
const LOOK = 0.0022
const SMOOTHING = 12 // 1/s: how fast walking speed follows the keys

/** Pointer-lock mouse look + WASD on the floor plane. Collision lands in Round 2. */
export function FirstPersonControls({ spawn, yaw, eyeHeight, bounds, enabled, onLock }: Props) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const look = useRef({ yaw, pitch: 0 })
  const lift = useRef(0)
  const velocity = useRef(new THREE.Vector2())
  const touch = useRef<{ id: number; x: number; y: number } | null>(null)

  useEffect(() => {
    camera.position.set(spawn.x, spawn.y + eyeHeight, spawn.z)
    look.current = { yaw, pitch: 0 }
    camera.rotation.order = 'YXZ'
  }, [camera, spawn, yaw, eyeHeight])

  useEffect(() => {
    const el = gl.domElement
    const down = (e: KeyboardEvent) => keys.current.add(e.code)
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    const blur = () => keys.current.clear()
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return
      look.current.yaw -= e.movementX * LOOK
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - e.movementY * LOOK, -1.45, 1.45)
    }
    const lockChange = () => onLock(document.pointerLockElement === el)

    // Touch fallback: drag to look; two fingers walk forward.
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) keys.current.add('KeyW')
      const t = e.touches[0]
      touch.current = { id: t.identifier, x: t.clientX, y: t.clientY }
    }
    const tm = (e: TouchEvent) => {
      const t = Array.from(e.touches).find((x) => x.identifier === touch.current?.id)
      if (!t || !touch.current) return
      look.current.yaw -= (t.clientX - touch.current.x) * LOOK * 1.6
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - (t.clientY - touch.current.y) * LOOK * 1.6, -1.45, 1.45)
      touch.current = { id: t.identifier, x: t.clientX, y: t.clientY }
    }
    const te = (e: TouchEvent) => {
      if (e.touches.length < 2) keys.current.delete('KeyW')
      if (e.touches.length === 0) touch.current = null
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('mousemove', move)
    document.addEventListener('pointerlockchange', lockChange)
    el.addEventListener('touchstart', ts, { passive: true })
    el.addEventListener('touchmove', tm, { passive: true })
    el.addEventListener('touchend', te, { passive: true })
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('pointerlockchange', lockChange)
      el.removeEventListener('touchstart', ts)
      el.removeEventListener('touchmove', tm)
      el.removeEventListener('touchend', te)
    }
  }, [gl, onLock])

  useFrame((_, dt) => {
    camera.rotation.set(look.current.pitch, look.current.yaw, 0)
    if (!enabled) return
    const k = keys.current
    const step = Math.min(dt, 0.1)
    if (k.has('KeyR')) {
      camera.position.set(spawn.x, spawn.y + eyeHeight, spawn.z)
      look.current = { yaw, pitch: 0 }
      velocity.current.set(0, 0)
      lift.current = 0
      k.delete('KeyR')
      return
    }
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? SPRINT : WALK
    const fwd = Number(k.has('KeyW') || k.has('ArrowUp')) - Number(k.has('KeyS') || k.has('ArrowDown'))
    const side = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'))
    const target = new THREE.Vector2()
    if (fwd || side) {
      const sin = Math.sin(look.current.yaw)
      const cos = Math.cos(look.current.yaw)
      // Movement stays on the floor plane regardless of pitch.
      target.set(-sin * fwd + cos * side, -cos * fwd - sin * side).normalize().multiplyScalar(speed)
    }
    // Ease towards the target velocity: no jolt on key press, a short glide on release. Sudden jumps
    // make splat sorting pop, so smooth motion also looks cleaner.
    velocity.current.lerp(target, 1 - Math.exp(-SMOOTHING * step))
    camera.position.x += velocity.current.x * step
    camera.position.z += velocity.current.y * step
    lift.current = THREE.MathUtils.clamp(
      lift.current + (Number(k.has('KeyE')) - Number(k.has('KeyQ'))) * speed * step,
      -0.8,
      1.2,
    )
    camera.position.y = spawn.y + eyeHeight + lift.current
    if (bounds) {
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, bounds[0], bounds[1])
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, bounds[2], bounds[3])
    }
  })

  return null
}
