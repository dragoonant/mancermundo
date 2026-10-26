// Orbit camera clamped above the mat: right-drag orbit, middle-drag / WASD pan, wheel zoom. Left-drag only moves the
// camera with Alt (orbit) or Shift (pan) held, so a plain left click is always the game's. Touch: ONE finger pans the
// board over the ground plane (not while the measure tool is open: then the finger belongs to the tool); TWO fingers
// pinch to zoom, twist to turn the view around the board, and drag the midpoint up / down to tilt (the midpoint's
// horizontal drag is ignored, twist owns the azimuth). OrbitControls only handles the one-finger pan; the two-finger
// gesture is ours (touchCamera.ts holds the maths). A one-finger tap must still reach the game, so a finger that stays
// inside TAP_SLOP does not pan, and the click that ends a drag or a multi-finger gesture is swallowed in the capture
// phase (createTapGuard) before the board's own click handlers see it. Presets: home overview, top-down and 45-degree turns
// left / right, tweened. Exposes the e2e/dev camera API (`project`, `lookAt`, `get`) through cameraApi.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MathUtils, MOUSE, TOUCH, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useSight } from '../interaction/sightStore'
import { useUi } from '../ui/uiStore'
import { setDirectorBotSeats } from '../presentation/director'
import { useGame } from '../store/game'
import { cameraApi, type CameraView } from './cameraApi'
import { createTapGuard, TILT_DEADZONE, tiltFromDrag, twoFingerOffset } from './touchCamera'

export { TAP_SLOP, createTapGuard } from './touchCamera'

const HOME_POS: [number, number, number] = [0, 25, 21]
const TOP_POS: [number, number, number] = [0, 36, 0.01]
const MARGIN = 4
const PAN_SPEED = 20
const TURN_STEP = Math.PI / 4
/** radians the two fingers must twist before the turn engages, so a pinch or a pan never wobbles the view */
const TWIST_DEADZONE = 0.12
const UP = new Vector3(0, 1, 0)
const PAN_KEYS: Record<string, [number, number]> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }

interface Tween {
  t0: number
  fromP: Vector3
  toP: Vector3
  fromT: Vector3
  toT: Vector3
  /** set for a turn: fromP swings about the target by this many radians instead of lerping to toP */
  turn?: number
  /** duration in ms (default PRESET_MS) */
  ms?: number
  /** resolves a flyTo: true when the tween arrived, false when something else took the camera */
  done?: (arrived: boolean) => void
}

const PRESET_MS = 450
const MIN_DIST = 5
const MAX_DIST = 58
/** Limits while the shot camera is active: a third-person view sits a few inches from its subject, level with a head. */
const CINE_MIN_DIST = 0.6
const MAX_POLAR = Math.PI / 2.05
const CINE_MAX_POLAR = Math.PI * 0.98

export function CameraRig({ halfX, halfZ }: { halfX: number; halfZ: number }) {
  const controls = useRef<OrbitControlsImpl | null>(null)
  const tween = useRef<Tween | null>(null)
  const keys = useRef(new Set<string>())
  /** every write to the tween goes through here: a running flyTo is told it was cancelled (the player always wins) */
  const setTween = (next: Tween | null) => {
    const prev = tween.current
    tween.current = next
    if (prev && prev !== next) prev.done?.(false)
  }
  const setTweenRef = useRef(setTween)
  setTweenRef.current = setTween
  /**
   * The shot camera (see cameraApi.cinematic): while on, the minimum distance, the tilt limit and the ground-height
   * clamp of the target are relaxed. Anything that moves the camera for the player calls `takeOver`, which restores
   * the limits and drops the cinematic (the camera stays where it is; the director sees `cinematicActive` go false).
   */
  const cine = useRef(false)
  const setCine = (on: boolean) => {
    cine.current = on
    const c = controls.current
    if (!c) return
    c.minDistance = on ? CINE_MIN_DIST : MIN_DIST
    c.maxPolarAngle = on ? CINE_MAX_POLAR : MAX_POLAR
  }
  const setCineRef = useRef(setCine)
  setCineRef.current = setCine
  const takeOver = () => {
    if (cine.current) setCineRef.current(false)
    setTweenRef.current(null)
  }
  const takeOverRef = useRef(takeOver)
  takeOverRef.current = takeOver
  const { camera, gl } = useThree()
  const invalidate = useThree((s) => s.invalidate)
  const preset = useUi((s) => s.cameraPreset)
  const measureOn = useSight((s) => s.measureOn)

  useEffect(() => {
    const c = controls.current
    if (c) (c.touches as { ONE: number; TWO: number }).ONE = measureOn ? -1 : TOUCH.PAN
  }, [measureOn])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.mouseButtons.MIDDLE = MOUSE.PAN
    c.mouseButtons.RIGHT = MOUSE.ROTATE
    c.mouseButtons.LEFT = undefined
    // one finger pans (unless the measure tool owns it); the two-finger gesture is ours, so OrbitControls ignores it
    ;(c.touches as { ONE: number; TWO: number }).ONE = useSight.getState().measureOn ? -1 : TOUCH.PAN
    ;(c.touches as { ONE: number; TWO: number }).TWO = -1
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !controls.current) return
      controls.current.mouseButtons.LEFT = e.shiftKey ? MOUSE.PAN : e.altKey ? MOUSE.ROTATE : undefined
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    const onStart = () => takeOverRef.current()
    c.addEventListener('start', onStart)

    // Touch gestures, tracked on window in the capture phase so they run before OrbitControls and r3f.
    //  one finger: stays a tap until it leaves TAP_SLOP (its moves are held back from OrbitControls until then, so a
    //    tap never nudges the camera under the pick); past that OrbitControls pans, and the click on release is swallowed.
    //  two fingers: pinch (spread ratio) zooms, twist (finger angle, with a deadzone) turns about the target, and the
    //    midpoint's vertical drag (with a deadzone) tilts. Horizontal midpoint movement is deliberately unused.
    const el = gl.domElement
    const guard = createTapGuard()
    const touches = new Map<number, { x: number; y: number }>()
    let lastAngle = 0
    let lastDist = 0
    let lastMidY = 0
    let pending = 0
    let engaged = false
    let tiltPending = 0
    let tiltEngaged = false
    const resetTwo = () => {
      if (touches.size === 2) {
        const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }]
        lastAngle = Math.atan2(b.y - a.y, b.x - a.x)
        lastDist = Math.hypot(b.x - a.x, b.y - a.y)
        lastMidY = (a.y + b.y) / 2
      }
      pending = 0
      engaged = false
      tiltPending = 0
      tiltEngaged = false
    }
    const onTouchDown = (e: PointerEvent) => {
      const touch = e.pointerType === 'touch'
      guard.down(e.pointerId, e.clientX, e.clientY, touch, e.target === el)
      if (!touch || e.target !== el) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      resetTwo()
    }
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return
      guard.move(e.pointerId, e.clientX, e.clientY)
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 1) {
        if (guard.inDeadzone()) e.stopImmediatePropagation()
        return
      }
      if (touches.size !== 2 || !controls.current) return
      const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }]
      const angle = Math.atan2(b.y - a.y, b.x - a.x)
      let d = angle - lastAngle
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      lastAngle = angle
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const pinch = lastDist > 0 ? dist / lastDist : 1
      lastDist = dist
      const midY = (a.y + b.y) / 2
      const dMid = midY - lastMidY
      lastMidY = midY
      let azimuth = 0
      if (engaged) azimuth = d
      else {
        pending += d
        if (Math.abs(pending) >= TWIST_DEADZONE) {
          engaged = true
          azimuth = pending
        }
      }
      let dPhi = 0
      if (tiltEngaged) dPhi = tiltFromDrag(dMid, el.clientHeight)
      else {
        tiltPending += dMid
        if (Math.abs(tiltPending) >= TILT_DEADZONE) {
          tiltEngaged = true
          dPhi = tiltFromDrag(tiltPending, el.clientHeight)
        }
      }
      if (azimuth === 0 && dPhi === 0 && pinch === 1) return
      const ctl = controls.current
      takeOverRef.current()
      const lim = { minDistance: ctl.minDistance, maxDistance: ctl.maxDistance, minPolar: ctl.minPolarAngle, maxPolar: ctl.maxPolarAngle }
      const off = twoFingerOffset(camera.position.clone().sub(ctl.target), azimuth, pinch, dPhi, lim)
      camera.position.copy(ctl.target).add(off)
      ctl.update()
      invalidate()
    }
    const onTouchUp = (e: PointerEvent) => {
      guard.up(e.pointerId)
      if (!touches.delete(e.pointerId)) return
      resetTwo()
    }
    // the click that ends a drag or a multi-finger gesture on the board must not select, move or measure
    const onClick = (e: MouseEvent) => {
      if (e.target === el && guard.suppressClick()) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    }
    const cap = { capture: true } as const
    window.addEventListener('pointerdown', onTouchDown, cap)
    window.addEventListener('pointermove', onTouchMove, cap)
    window.addEventListener('pointerup', onTouchUp, cap)
    window.addEventListener('pointercancel', onTouchUp, cap)
    window.addEventListener('click', onClick, cap)

    c.target.set(0, 0, 1)
    c.update()
    invalidate()
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true })
      c.removeEventListener('start', onStart)
      window.removeEventListener('pointerdown', onTouchDown, cap)
      window.removeEventListener('pointermove', onTouchMove, cap)
      window.removeEventListener('pointerup', onTouchUp, cap)
      window.removeEventListener('pointercancel', onTouchUp, cap)
      window.removeEventListener('click', onClick, cap)
    }
  }, [invalidate, camera, gl])

  useEffect(() => {
    if (!preset) return
    const c = controls.current
    if (!c) return
    if (cine.current) setCineRef.current(false)
    if (preset.id === 'left' || preset.id === 'right') {
      // turn about the current target, keeping height and distance; 'right' turns the board clockwise on screen
      const turn = preset.id === 'left' ? -TURN_STEP : TURN_STEP
      const toP = camera.position.clone()
      setTweenRef.current({ t0: performance.now(), fromP: camera.position.clone(), toP, fromT: c.target.clone(), toT: c.target.clone(), turn })
      invalidate()
      return
    }
    const pos = preset.id === 'top' ? TOP_POS : HOME_POS
    setTweenRef.current({
      t0: performance.now(),
      fromP: camera.position.clone(),
      toP: new Vector3(...pos),
      fromT: c.target.clone(),
      toT: new Vector3(0, 0, preset.id === 'top' ? 0 : 1),
    })
    invalidate()
  }, [preset, camera, invalidate])

  // the director needs to know which seats are bots (it visits their deployments); the store cannot call it from here
  useEffect(() => {
    const push = () => {
      const seats = useGame.getState().seats
      setDirectorBotSeats((['A', 'B'] as const).filter((x) => seats[x] === 'bot'))
    }
    push()
    return useGame.subscribe(push)
  }, [])

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey) return
      const k = e.key.toLowerCase()
      if (k in PAN_KEYS) {
        keys.current.add(k)
        takeOverRef.current()
        invalidate()
      }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [invalidate])

  useEffect(() => {
    cameraApi.current = {
      project(x, y, z) {
        camera.updateMatrixWorld()
        const v = new Vector3(x, y, z).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
      lookAt(x, z, distance) {
        const c = controls.current
        if (!c) return
        takeOverRef.current()
        const dir = camera.position.clone().sub(c.target)
        dir.y = Math.max(dir.y, 0.1)
        dir.normalize().multiplyScalar(MathUtils.clamp(distance, 4, 60))
        c.target.set(x, 0, z)
        camera.position.copy(c.target).add(dir)
        c.update()
        invalidate()
      },
      get() {
        const c = controls.current
        return { x: c?.target.x ?? 0, z: c?.target.z ?? 0, distance: c ? c.getDistance() : camera.position.length() }
      },
      repaint: () => invalidate(),
      snapshot() {
        const t = controls.current?.target ?? new Vector3(0, 0, 1)
        return { position: [camera.position.x, camera.position.y, camera.position.z], target: [t.x, t.y, t.z] }
      },
      focusView(x, z, distance) {
        const t = controls.current?.target ?? new Vector3(0, 0, 1)
        const dir = camera.position.clone().sub(t)
        dir.y = Math.max(dir.y, 0.1)
        dir.normalize().multiplyScalar(MathUtils.clamp(distance, MIN_DIST, MAX_DIST))
        return { position: [x + dir.x, dir.y, z + dir.z], target: [x, 0, z] }
      },
      cinematic(on) {
        setCineRef.current(on)
      },
      cinematicActive: () => cine.current,
      flyTo(view, ms) {
        const c = controls.current
        if (!c) return Promise.resolve(false)
        return new Promise<boolean>((resolve) => {
          const toP = new Vector3(...view.position)
          const toT = new Vector3(...view.target)
          let settled = false
          let guard: ReturnType<typeof setTimeout> | null = null
          const finish = (arrived: boolean) => {
            if (settled) return
            settled = true
            if (guard !== null) clearTimeout(guard)
            resolve(arrived)
          }
          const tw: Tween = { t0: performance.now(), fromP: camera.position.clone(), toP, fromT: c.target.clone(), toT, ms: Math.max(1, ms), done: finish }
          setTweenRef.current(tw)
          // a hidden tab stops animation frames: land the tween anyway so the presentation never waits on it
          guard = setTimeout(() => {
            if (settled || tween.current !== tw) return
            camera.position.copy(toP)
            c.target.copy(toT)
            c.update()
            tween.current = null
            finish(true)
            invalidate()
          }, Math.max(1, ms) + 800)
          invalidate()
        })
      },
    }
    return () => {
      setCineRef.current(false)
      setTweenRef.current(null)
      cameraApi.current = null
    }
  }, [camera, gl, invalidate])

  const fwd = useRef(new Vector3())
  const right = useRef(new Vector3())
  const step = useRef(new Vector3())
  useFrame((state, dt) => {
    const c = controls.current
    if (!c) return
    const tw = tween.current
    if (tw) {
      const f = Math.min(1, (performance.now() - tw.t0) / (tw.ms ?? PRESET_MS))
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2
      if (tw.turn !== undefined) camera.position.copy(tw.fromP).sub(tw.fromT).applyAxisAngle(UP, tw.turn * e).add(tw.fromT)
      else camera.position.lerpVectors(tw.fromP, tw.toP, e)
      c.target.lerpVectors(tw.fromT, tw.toT, e)
      if (f >= 1) {
        tween.current = null
        tw.done?.(true)
      }
      state.invalidate()
    }
    if (keys.current.size) {
      camera.getWorldDirection(fwd.current)
      fwd.current.y = 0
      fwd.current.normalize()
      right.current.crossVectors(fwd.current, camera.up).normalize()
      const sp = PAN_SPEED * Math.min(dt, 0.05)
      for (const k of keys.current) {
        const [dx, dz] = PAN_KEYS[k]!
        step.current.copy(right.current).multiplyScalar(dx * sp).addScaledVector(fwd.current, -dz * sp)
        camera.position.add(step.current)
        c.target.add(step.current)
      }
      state.invalidate()
    }
    c.target.x = MathUtils.clamp(c.target.x, -halfX - MARGIN, halfX + MARGIN)
    c.target.z = MathUtils.clamp(c.target.z, -halfZ - MARGIN, halfZ + MARGIN)
    if (!cine.current) c.target.y = 0
    c.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      minPolarAngle={MathUtils.degToRad(4)}
      maxPolarAngle={MAX_POLAR}
      screenSpacePanning={false}
    />
  )
}
