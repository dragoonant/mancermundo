// Deployment camera: which Setup-phase deploy events make the camera visit a figure, and where it returns to. Pure
// (no three.js, no store): the director feeds it events and the camera API does the flying.
//  - the player's own deploy: remember the view they had (the place to come back to)
//  - a bot seat's deploy while a human plays against it: fly to the new figure, hold, fly back
//  - hot-seat (no bot seat), bot-vs-bot (no perspective), instant speed, or any non-setup deploy: nothing
import type { GameEvent, GameState, Seat } from '@/engine'
import type { CameraView } from '../board/cameraApi'

/** Base durations (ms at normal speed); the director multiplies by speedFactor. */
export const DEPLOY_FLY_MS = 550
export const DEPLOY_HOLD_MS = 900
/** Camera distance (inches) when looking at a freshly deployed figure. */
export const DEPLOY_FOCUS_DISTANCE = 13
/** A view moved by more than this (inches, on any coordinate) between two snapshots was moved by the player. */
export const VIEW_EPSILON = 0.05

export interface DeployCameraCtx {
  /** the seat the player watches from (null: nobody plays, e.g. bot vs bot) */
  perspective: Seat | null
  botSeats: readonly Seat[]
  /** speedFactor of the animation setting; 0 = instant */
  factor: number
}

export type DeployBeat = { kind: 'record' } | { kind: 'visit'; x: number; z: number }

/** The deploy beats of one batch, by event index. Empty unless the batch is a Setup-phase step with something to show. */
export function deployBeats(events: readonly GameEvent[], phase: GameState['phase'], ctx: DeployCameraCtx): { index: number; beat: DeployBeat }[] {
  const out: { index: number; beat: DeployBeat }[] = []
  if (phase !== 'setup' || ctx.factor <= 0 || ctx.perspective === null || ctx.botSeats.length === 0 || ctx.botSeats.includes(ctx.perspective)) return out
  events.forEach((ev, index) => {
    if (ev.type !== 'OperativeDeployed' || ev.seat === null) return
    if (ev.seat === ctx.perspective) out.push({ index, beat: { kind: 'record' } })
    else if (ctx.botSeats.includes(ev.seat)) out.push({ index, beat: { kind: 'visit', x: ev.pos.x, z: ev.pos.z } })
  })
  return out
}

export function deployTimes(factor: number): { fly: number; hold: number } {
  return { fly: Math.round(DEPLOY_FLY_MS * factor), hold: Math.round(DEPLOY_HOLD_MS * factor) }
}

/** Where to look to frame a seat's chosen drop zone (centre of its bounding box, distance that fits it), or null if none is chosen yet. */
export function zoneFocus(state: GameState, seat: Seat | null): { x: number; z: number; distance: number } | null {
  if (!seat) return null
  const id = state.players?.[seat]?.dropZoneId
  const zone = id ? state.map?.dropZones?.find((z) => z.id === id) : null
  if (!zone || zone.polygon.length === 0) return null
  const xs = zone.polygon.map((p) => p.x)
  const zs = zone.polygon.map((p) => p.z)
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const size = Math.max(x1 - x0, z1 - z0)
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, distance: Math.min(34, Math.max(16, size * 1.1 + 6)) }
}

/** The view to return to: the player's last deploy view, else their drop zone, else wherever the camera was before the visit. */
export function returnView<V>(lastPlayerView: V | null, zoneView: V | null, before: V): V {
  return lastPlayerView ?? zoneView ?? before
}

/** True when two poses differ enough that the player must have moved the camera between them. */
export function viewsDiffer(a: CameraView, b: CameraView): boolean {
  const d = (p: readonly number[], q: readonly number[]) => p.some((v, i) => Math.abs(v - q[i]!) > VIEW_EPSILON)
  return d(a.position, b.position) || d(a.target, b.target)
}
