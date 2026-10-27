// "Follow the action" for a watched game: where the camera should look while a bot decides, and the flight there. Uses the same camera
// API as the director's deploy and shot cameras (focusView / flyTo), so any camera input from the viewer still wins.
import type { Action, GameState, PendingDecision } from '@/engine'
import { cameraApi } from '../board/cameraApi'
import { speedFactor, type AnimSpeed } from './settings'

/** Distance (inches) from which the acting fighter is framed. */
export const FOLLOW_DISTANCE = 15
/** Flight time (ms at normal speed). */
export const FOLLOW_FLY_MS = 650

export interface Focus {
  x: number
  z: number
}

/** The place a bot's decision is about: the fighter acting (or being activated), the spot it deploys to, else nothing. */
export function focusOf(state: GameState, pending: PendingDecision, action: Action): Focus | null {
  if (action.type === 'setup.deploy') return { x: action.payload.x, z: action.payload.z }
  const payload = action.payload as { fighterId?: unknown }
  const candidates = [pending.context.fighterId, pending.constraints?.fighterId, payload.fighterId, state.action.activation?.fighterId]
  for (const id of candidates) {
    if (typeof id !== 'string') continue
    const f = state.fighters[id]
    if (f && f.location === 'board') return { x: f.pos.x, z: f.pos.z }
  }
  return null
}

/** Fly to a focus (a jump at Instant speed). Resolves false when the viewer took the camera over or there is no camera. */
export async function followTo(focus: Focus, speed: AnimSpeed): Promise<boolean> {
  const cam = cameraApi.current
  if (!cam) return false
  const view = cam.focusView(focus.x, focus.z, FOLLOW_DISTANCE)
  const ms = Math.round(FOLLOW_FLY_MS * Math.min(speedFactor(speed), 1.5))
  if (ms <= 0) {
    cam.lookAt(focus.x, focus.z, FOLLOW_DISTANCE)
    return true
  }
  return cam.flyTo(view, ms)
}
