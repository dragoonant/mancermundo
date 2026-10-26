// Mission numbers for the UI. The engine owns them (`missionView`, query.mission); this only reads them.
import type { GameState, Seat } from '@/engine'
import { missionView, type MissionView } from '@/engine/missions'

export interface KillStatus {
  /** enemy operatives this seat's side has incapacitated */
  kills: number
  /** grade reached, 0 to 5 */
  grade: number
  /** incapacitations needed for grades 1 to 5 (empty before the mission is chosen) */
  thresholds: number[]
  next: number | null
}

export function mission(state: GameState): MissionView | null {
  try {
    return missionView(state)
  } catch {
    return null
  }
}

export function killStatus(state: GameState, seat: Seat): KillStatus {
  const k = mission(state)?.kill[seat]
  return k ? { kills: k.kills, grade: k.grade, thresholds: k.thresholds, next: k.next } : { kills: 0, grade: 0, thresholds: [], next: null }
}
