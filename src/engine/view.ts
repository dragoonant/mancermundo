// Per-seat redacted view (frozen after M2). N23 skirmish has no hidden information: the RNG state and the action log are
// removed and the viewer is named. Deciders only ever see a PlayerView.
import type { GameState, PlayerView, Seat } from './types'

export function view(state: GameState, seat: Seat): PlayerView {
  const { rng: _rng, log: _log, ...rest } = state
  return { ...rest, viewer: seat }
}
