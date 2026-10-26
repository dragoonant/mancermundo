// Timed effects (00 section 7.5 `GameState.effects`): added by skills, wargear, traits and scenario rules, removed when
// their expiry key comes up. Expiry keys: `activation` (end of the current activation), `round` (end of the round),
// `battle`, and `startOfActivation:<fighterId>` (the fighter's next activation starts).
import type { Ctx } from './registry'
import type { ActiveEffect, GameState, Seat } from './types'

export function addEffect(ctx: Ctx, e: Omit<ActiveEffect, 'id'>): ActiveEffect {
  const s = ctx.state
  const eff: ActiveEffect = { ...e, id: `e${s.nextEffect++}` }
  s.effects.push(eff)
  ctx.emit({ type: 'EffectStarted', effectId: eff.id, source: eff.source, kind: eff.kind }, eff.seat)
  return eff
}

export function effectsOf(state: GameState, kind: string, filter?: (e: ActiveEffect) => boolean): ActiveEffect[] {
  return state.effects.filter((e) => e.kind === kind && (!filter || filter(e)))
}

export function hasEffect(state: GameState, source: string, seat?: Seat): boolean {
  return state.effects.some((e) => e.source === source && (seat === undefined || e.seat === seat))
}

/** Remove effects matching a predicate; returns how many were removed. */
export function removeEffects(ctx: Ctx, pred: (e: ActiveEffect) => boolean): number {
  const keep: ActiveEffect[] = []
  let n = 0
  for (const e of ctx.state.effects) {
    if (pred(e)) {
      n++
      ctx.emit({ type: 'EffectEnded', effectId: e.id, source: e.source }, e.seat)
    } else keep.push(e)
  }
  ctx.state.effects = keep
  return n
}

/** Remove every effect whose `expires` key equals `expires`; returns how many were removed. */
export function expireEffects(ctx: Ctx, expires: string): number {
  return removeEffects(ctx, (e) => e.expires === expires)
}
