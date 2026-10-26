// Cinematic shooting camera, pure parts (no three.js, no store): the over-the-shoulder view behind the shooter, the
// close-up on the target, a cheap terrain check so a wall does not sit in front of the lens, and which beat a
// volley earns. The director feeds it positions and the camera API does the flying.
//  - shoulder: behind the shooter (opposite the target), a little to one side, at head height, looking at the
//    target's chest, so the tracers leave the shooter and cross the frame
//  - close-up: only when a die got through (a wound or a fall to watch); a fully blocked or missed volley just
//    holds the shoulder view for a short beat
import type { MapDef } from '@/engine'
import { pointInPolygon } from '@/engine/geometry'
import { terrainOf } from '@/engine/terrain'
import type { CameraView } from '../board/cameraApi'
import type { LandingPlan } from './heldVolley'

/** Base durations (ms at normal speed); the director multiplies by speedFactor. */
export const SHOT_SHOULDER_FLY_MS = 600
export const SHOT_CLOSEUP_FLY_MS = 350
export const SHOT_RETURN_FLY_MS = 600
/** Extra hold on the target after the last landing, so the wound bar, hit flash or fall can be read. */
export const SHOT_CLOSEUP_HOLD_MS = 900
/** Hold on the shoulder view when nothing got through (no close-up). */
export const SHOT_NO_HIT_BEAT_MS = 500

/** How far behind the shooter the lens sits, how far to one side, and how far above the head (inches). Wide enough that
 *  the shooter's shoulder and weapon fill a lower corner and the target reads clearly mid-frame. */
export const SHOULDER_BACK = 5
export const SHOULDER_SIDE = 1.5
export const SHOULDER_ABOVE = 1.5
/** Close-up: the lens is this far (inches, straight line) from the target's chest, looking down at CLOSEUP_PITCH. */
export const CLOSEUP_DISTANCE = 7.5
export const CLOSEUP_PITCH = (37 * Math.PI) / 180
/** The close-up sits this far round from the shooter-target line, so the shooter is never in front of the lens (radians). */
export const CLOSEUP_SWING = 0.6
/** A figure with no known height is taken as this tall (inches). */
export const DEFAULT_HEIGHT = 2
/** The most the lens is lifted to clear terrain (inches). */
export const MAX_RAISE = 5

/** The part of an operative the camera needs: where it stands (y = the surface under it) and how tall it is. */
export interface Body {
  x: number
  y: number
  z: number
  height: number
}

const heightOf = (b: Body): number => (b.height > 0 ? b.height : DEFAULT_HEIGHT)
const chestOf = (b: Body): number => b.y + heightOf(b) * 0.5
const headOf = (b: Body): number => b.y + heightOf(b)

function unit(dx: number, dz: number): [number, number] {
  const l = Math.hypot(dx, dz)
  return l < 1e-6 ? [0, 1] : [dx / l, dz / l]
}

export interface ViewOpts {
  /** which shoulder (+1 right, -1 left, looking along the shot) */
  side?: 1 | -1
  /** extra lens height (inches), to clear terrain */
  raise?: number
}

/** Over-the-shoulder: behind the shooter on the far side from the target, offset to one side, just above the head. */
export function shoulderView(shooter: Body, target: Body, opts: ViewOpts = {}): CameraView {
  const side = opts.side ?? 1
  const [ux, uz] = unit(target.x - shooter.x, target.z - shooter.z)
  const rx = -uz
  const rz = ux
  return {
    position: [shooter.x - ux * SHOULDER_BACK + rx * side * SHOULDER_SIDE, headOf(shooter) + SHOULDER_ABOVE + (opts.raise ?? 0), shooter.z - uz * SHOULDER_BACK + rz * side * SHOULDER_SIDE],
    target: [target.x, chestOf(target), target.z],
  }
}

/** Close-up on the target from the shooter's side, swung a little round and well above (about 37 degrees down), looking at its chest. */
export function closeupView(shooter: Body, target: Body, opts: ViewOpts = {}): CameraView {
  const side = opts.side ?? 1
  const [bx, bz] = unit(shooter.x - target.x, shooter.z - target.z)
  const a = CLOSEUP_SWING * side
  const dx = bx * Math.cos(a) - bz * Math.sin(a)
  const dz = bx * Math.sin(a) + bz * Math.cos(a)
  const flat = CLOSEUP_DISTANCE * Math.cos(CLOSEUP_PITCH)
  return {
    position: [target.x + dx * flat, chestOf(target) + CLOSEUP_DISTANCE * Math.sin(CLOSEUP_PITCH) + (opts.raise ?? 0), target.z + dz * flat],
    target: [target.x, chestOf(target) + 0.1, target.z],
  }
}

/** Top of the highest terrain solid the point (x, y, z) is inside, or null when it is in the clear. */
function solidTopAt(map: MapDef | undefined, x: number, y: number, z: number): number | null {
  if (!map || !Array.isArray(map.features)) return null
  let top: number | null = null
  for (const s of terrainOf(map).solids) {
    if (s.insignificant || y < s.bottom || y >= s.top) continue
    const b = s.bbox
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
    if (pointInPolygon({ x, z }, s.polygon) && (top === null || s.top > top)) top = s.top
  }
  return top
}

/** How high the lens must rise to clear the terrain it sits in (or that is halfway to `anchor`); 0 when it is in the clear. */
export function lensBlockedTop(map: MapDef | undefined, view: CameraView, anchor: readonly [number, number, number]): number {
  const [px, py, pz] = view.position
  let top = 0
  for (const t of [0, 0.5]) {
    const hit = solidTopAt(map, px + (anchor[0] - px) * t, py + (anchor[1] - py) * t, pz + (anchor[2] - pz) * t)
    if (hit !== null) top = Math.max(top, hit)
  }
  return top
}

/**
 * Picks the first of: the right shoulder, the left shoulder, the right shoulder raised above whatever the lens is
 * inside (capped at MAX_RAISE). `anchor` is the figure the lens must not be walled off from.
 */
export function clearView(map: MapDef | undefined, make: (o: ViewOpts) => CameraView, anchor: readonly [number, number, number]): CameraView {
  const right = make({ side: 1 })
  if (lensBlockedTop(map, right, anchor) === 0) return right
  const left = make({ side: -1 })
  if (lensBlockedTop(map, left, anchor) === 0) return left
  const top = lensBlockedTop(map, right, anchor)
  return make({ side: 1, raise: Math.min(MAX_RAISE, Math.max(0, top + 0.3 - right.position[1])) })
}

export function shoulderViewClear(map: MapDef | undefined, shooter: Body, target: Body): CameraView {
  return clearView(map, (o) => shoulderView(shooter, target, o), [shooter.x, headOf(shooter), shooter.z])
}

export function closeupViewClear(map: MapDef | undefined, shooter: Body, target: Body): CameraView {
  return clearView(map, (o) => closeupView(shooter, target, o), [target.x, chestOf(target), target.z])
}

/** What a landing earns: a close-up only when a die got through; a save shimmer or a miss does not. */
export function landingBeat(outcome: 'miss' | 'blocked' | 'damage'): 'closeup' | 'none' {
  return outcome === 'damage' ? 'closeup' : 'none'
}

/** Which closing beat a volley earns by its plan: the close-up if any die gets through, else a short hold on the shoulder. */
export function volleyBeat(plan: Pick<LandingPlan, 'shots' | 'orphanItems'>): 'closeup' | 'shoulder-hold' {
  return plan.shots.some((s) => landingBeat(s.outcome) === 'closeup') || plan.orphanItems.length > 0 ? 'closeup' : 'shoulder-hold'
}

/** The cinematic runs at all: switched on, not instant speed (factor 0), and a camera exists. */
export function cinematicOn(enabled: boolean, factor: number, hasCamera: boolean): boolean {
  return enabled && factor > 0 && hasCamera
}

export interface ShotTimes {
  shoulder: number
  closeup: number
  back: number
  hold: number
  beat: number
}

export function shotTimes(factor: number): ShotTimes {
  const s = (ms: number) => Math.round(ms * factor)
  return { shoulder: s(SHOT_SHOULDER_FLY_MS), closeup: s(SHOT_CLOSEUP_FLY_MS), back: s(SHOT_RETURN_FLY_MS), hold: s(SHOT_CLOSEUP_HOLD_MS), beat: s(SHOT_NO_HIT_BEAT_MS) }
}
