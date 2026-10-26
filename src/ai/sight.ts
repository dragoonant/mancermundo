// Line-of-sight lookups memoised per decision: the planner asks the same "can this spot see that enemy" question from several
// places (facing, shot search, threat map, candidate ranking), and the engine's 17-ray test is the dearest thing it does.
import { hasLosFrom } from '@/engine/los'
import type { Fighter, GameState, Vec2 } from '@/engine'
import type { AiCtx } from './tiers'

/** Does `from` see `target` (any of the 17 sample rays clear of walls, closed doors and smoke)? Cached per decision. */
export function sees(ctx: AiCtx, state: GameState, from: Vec2, target: Fighter): boolean {
  const key = `los:${Math.round(from.x * 8)},${Math.round(from.z * 8)}>${target.id}:${Math.round(target.pos.x * 8)},${Math.round(target.pos.z * 8)}`
  const hit = ctx.cache.get(key) as boolean | undefined
  if (hit !== undefined) return hit
  const v = hasLosFrom(state, from, target)
  ctx.cache.set(key, v)
  return v
}
