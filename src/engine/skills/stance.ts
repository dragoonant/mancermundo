// Immovable Stance (gol): the state it leaves behind is a timed effect (kind `immovableStance`, expiring when the fighter's
// next activation starts, effects.ts). Leaf module so wargear.ts (save floor) and movement.ts (shifts) can ask without a cycle.
import { effectsOf } from '../effects'
import type { Fighter, GameState } from '../types'

export const IMMOVABLE_EFFECT = 'immovableStance'

/** Is the fighter in an Immovable Stance now (+2 to saves, not Pinned, cannot be shifted)? */
export function isImmovable(state: GameState, f: Pick<Fighter, 'id'>): boolean {
  return effectsOf(state, IMMOVABLE_EFFECT, (e) => e.fighterId === f.id).length > 0
}

/** The best save an Immovable Stance allows (2+), or null when the fighter is not in one. */
export function saveFloor(state: GameState, f: Pick<Fighter, 'id'>): number | null {
  return isImmovable(state, f) ? 2 : null
}
