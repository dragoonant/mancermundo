// Per-seat redacted view (frozen after M2). Kill Team hides almost nothing: the RNG state and the action
// log are removed, and the opponent's Mines stay hidden until they trigger (R-1.8, M-5.2).
import type { GameState, PlayerView, Seat } from './types'

export function view(state: GameState, seat: Seat): PlayerView {
  const { rng: _rng, log: _log, ...rest } = state
  const hiddenIds = new Set(state.markers.filter((m) => m.hidden === true && m.owner !== seat).map((m) => m.id))
  if (hiddenIds.size === 0) return { ...rest, viewer: seat }
  const markers = state.markers.filter((m) => !hiddenIds.has(m.id))
  const placed = state.equipment.placed.filter((p) => !(p.markerId !== undefined && hiddenIds.has(p.markerId)))
  return { ...rest, markers, equipment: { ...state.equipment, placed }, viewer: seat }
}
