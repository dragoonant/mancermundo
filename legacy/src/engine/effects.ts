// Shared bookkeeping for the rules modules: CP accounting, the once-per-TP / once-per-battle ledger,
// timed effects, and damage that does not come from an attack sequence (mines, Dat All You Got?).
// Damage that does come from an attack goes through attack-common.inflict so hooks see it.
import { applyAplEffect, deferRemoval, inflict, removalCanPause } from './attack-common'
import { runHook } from './hooks'
import { noteRemoval } from './kills'
import type { Ctx } from './registry'
import { getOp } from './state'
import type { ActiveEffect, GameState, Ledger, Seat } from './types'

export function emptyLedger(): Ledger {
  return { battle: [], tp: [], uses: {}, tpUses: {} }
}

// ---------------------------------------------------------------------------
// Command points (shared with Command Re-roll in attack-common)
// ---------------------------------------------------------------------------

export function gainCp(ctx: Ctx, seat: Seat, amount: number, reason: string): void {
  if (amount === 0) return
  const p = ctx.state.players[seat]
  p.cp = Math.max(0, p.cp + amount)
  ctx.emit({ type: 'CpChanged', delta: amount, cp: p.cp, reason }, seat)
}

/** Pay CP; the caller has already checked affordability. */
export function spendCp(ctx: Ctx, seat: Seat, amount: number, reason: string): void {
  if (amount <= 0) return
  gainCp(ctx, seat, -amount, reason)
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export function usedThisTp(state: GameState, seat: Seat, key: string): boolean {
  return state.ledger[seat].tp.includes(key)
}

export function markUsedTp(state: GameState, seat: Seat, key: string): void {
  const l = state.ledger[seat]
  if (!l.tp.includes(key)) l.tp.push(key)
}

export function usedThisBattle(state: GameState, seat: Seat, key: string): boolean {
  return state.ledger[seat].battle.includes(key)
}

export function markUsedBattle(state: GameState, seat: Seat, key: string): void {
  const l = state.ledger[seat]
  if (!l.battle.includes(key)) l.battle.push(key)
}

/** Count of uses recorded under a key (battle-long). */
export function usesOf(state: GameState, seat: Seat, key: string): number {
  return state.ledger[seat].uses[key] ?? 0
}

export function addUse(state: GameState, seat: Seat, key: string, n = 1): void {
  const u = state.ledger[seat].uses
  u[key] = (u[key] ?? 0) + n
}

export function tpUsesOf(state: GameState, seat: Seat, key: string): number {
  return state.ledger[seat].tpUses[key] ?? 0
}

export function addTpUse(state: GameState, seat: Seat, key: string, n = 1): void {
  const u = state.ledger[seat].tpUses
  u[key] = (u[key] ?? 0) + n
}

// ---------------------------------------------------------------------------
// Timed effects
// ---------------------------------------------------------------------------

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

export function expireEffects(ctx: Ctx, expires: string): number {
  return removeEffects(ctx, (e) => e.expires === expires)
}

// ---------------------------------------------------------------------------
// Damage outside an attack sequence
// ---------------------------------------------------------------------------

/**
 * Remove an operative that has just been incapacitated outside an attack (mines, direct damage):
 * "before removal" hooks first (Boom!, carried markers), then removal.
 */
export function removeNow(ctx: Ctx, operativeId: string): void {
  const s = ctx.state
  const op = getOp(s, operativeId)
  if (op.status === 'removed') return
  // M10 batch D shared: a removal that may need a decision waits for the end of the step (attack-common.runDeferredRemovals)
  if (removalCanPause(s, op)) {
    deferRemoval(ctx, operativeId)
    return
  }
  runHook('operative.incapacitated', { seat: op.seat, state: s, engine: ctx, operativeId })
  op.status = 'removed'
  op.ready = false
  op.flags.guard = false
  ctx.emit({ type: 'OperativeRemoved', operativeId }, op.seat)
  // M10 batch D shared: the kill log at removal time
  noteRemoval(ctx, op)
  // damage the "before removal" hooks dealt (Boom!) incapacitates others: remove them too
  if (!s.attack) {
    for (const o of Object.values(s.operatives)) if (o.status === 'active' && o.wounds <= 0) removeNow(ctx, o.id)
  }
}

/**
 * An operative was incapacitated by something other than the attack sequence's own dice (Boom!, a mine):
 * hand it to the removal in progress, or to the attack that will remove it, or remove it now.
 */
export function queueRemoval(ctx: Ctx, operativeId: string): void {
  const s = ctx.state
  const op = s.operatives[operativeId]
  if (!op || op.status === 'removed' || op.wounds > 0) return
  if (s.removal) {
    if (!s.removal.ids.includes(operativeId) && !s.removal.hooked.includes(operativeId)) s.removal.ids.push(operativeId)
  } else if (s.attack) {
    if (!s.attack.incapacitated.includes(operativeId)) s.attack.incapacitated.push(operativeId)
  } else removeNow(ctx, operativeId)
}

/**
 * Direct damage from a rule ("x damage", R-7.5): no save, no blocking. If it incapacitates and no
 * attack sequence is running, the operative is removed at once; inside an attack the sequence removes it.
 */
export function directDamage(ctx: Ctx, targetId: string, amount: number, sourceId: string, source: string): number {
  const dealt = inflict(ctx, { targetId, attackerId: sourceId, weaponId: null, amount, source: 'direct' })
  void source
  queueRemoval(ctx, targetId)
  return dealt
}

/**
 * M9 prep (generic capability "regainWounds"): the operative regains up to `amount` lost wounds, never
 * above its starting Wounds (Living Metal, Canoptek Repair, Medikit, Putrescent Vitality, Grandfather's
 * Blessing). Its injured state is recomputed at once. Only operatives in the killzone heal. Returns the
 * wounds actually regained (0 emits nothing).
 */
export function regainWounds(ctx: Ctx, operativeId: string, amount: number, source: string): number {
  const op = ctx.state.operatives[operativeId]
  if (!op || op.status !== 'active' || op.wounds <= 0) return 0
  const gain = Math.max(0, Math.min(Math.floor(amount), op.maxWounds - op.wounds))
  if (gain === 0) return 0
  op.wounds += gain
  if (op.flags.injured && op.wounds * 2 >= op.maxWounds) op.flags.injured = false
  ctx.emit({ type: 'WoundsRegained', operativeId: op.id, amount: gain, wounds: op.wounds, source }, op.seat)
  return gain
}

// ---------------------------------------------------------------------------
// APL changes "until the end of its next activation" (batch C shared)
// ---------------------------------------------------------------------------

/** Effect kind holding an APL change deferred to the operative's next activation. */
export const APL_NEXT_FX = 'core.aplNext'

/** True when `operativeId` is in its own activation now (not a counteraction); frames over it count. */
export function inOwnActivation(state: GameState, operativeId: string): boolean {
  const ff = state.firefight
  for (const a of [ff.activation, ...[...(ff.stack ?? [])].reverse()]) {
    if (!a || a.frame) continue
    if (a.counteract) return false
    return a.operativeId === operativeId || a.partner?.operativeId === operativeId
  }
  return false
}

/**
 * "Change its APL by `delta` until the end of its next activation" (Medic!, Proximity Mine). Timed APL effects end
 * with the operative's activation, so a change taken in the middle of its own activation would vanish when that
 * activation ends: it is held over and applied when the next activation starts (applyDeferredApl). Otherwise it
 * applies now and ends with the operative's next activation.
 */
export function aplChangeNextActivation(ctx: Ctx, operativeId: string, delta: number, source: string): void {
  const op = ctx.state.operatives[operativeId]
  if (!op) return
  if (inOwnActivation(ctx.state, operativeId)) {
    addEffect(ctx, { source, seat: op.seat, kind: APL_NEXT_FX, operativeId, expires: APL_NEXT_FX, data: { source, delta } })
  } else applyAplEffect(ctx, operativeId, delta, source)
}

/** Called as an operative's activation starts: deferred APL changes take effect for this activation. */
export function applyDeferredApl(ctx: Ctx, operativeId: string): void {
  for (const fx of ctx.state.effects.filter((e) => e.kind === APL_NEXT_FX && e.operativeId === operativeId)) {
    removeEffects(ctx, (e) => e.id === fx.id)
    applyAplEffect(ctx, operativeId, Number(fx.data?.delta ?? -1), String(fx.data?.source ?? fx.source))
  }
}
