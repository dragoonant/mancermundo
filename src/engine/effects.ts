// Shared bookkeeping for the rules modules: CP accounting, the once-per-TP / once-per-battle ledger,
// timed effects, and damage that does not come from an attack sequence (mines, Dat All You Got?).
// Damage that does come from an attack goes through attack-common.inflict so hooks see it.
import { inflict } from './attack-common'
import { runHook } from './hooks'
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
  runHook('operative.incapacitated', { seat: op.seat, state: s, engine: ctx, operativeId })
  op.status = 'removed'
  op.ready = false
  op.flags.guard = false
  ctx.emit({ type: 'OperativeRemoved', operativeId }, op.seat)
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
