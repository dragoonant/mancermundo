// Ploys and re-rolls (docs/spec/40-ai section 2): Command Re-roll when a die is worth the point, strategic gambits
// from a per-ploy table, firefight ploys by per-ploy heuristics. Unknown ploys get a modest default score and are used
// only with spare command points. Never spends the last point on a marginal gain.
import { dieOdds } from '@/engine/dice'
import { answerDecision } from '@/engine/query'
import { enemiesOf, seatOps } from '@/engine/state'
import { distanceBetween } from '@/engine/measure'
import { bodyOf } from '@/engine/los'
import type { Action, DecisionOption, GameState, Operative } from '@/engine'
import type { AiCtx } from './tiers'
import { passAction } from './random'

// ---------------------------------------------------------------------------
// Command Re-roll
// ---------------------------------------------------------------------------

function threshold(cp: number): number {
  return cp >= 3 ? 1.0 : cp === 2 ? 1.6 : 2.4
}

function avgDmg(d: { normal: number; crit: number }): number {
  return d.normal * 0.75 + d.crit * 0.25
}

function countKinds(kinds: unknown): { normal: number; crit: number; fail: number } {
  const out = { normal: 0, crit: 0, fail: 0 }
  if (Array.isArray(kinds)) for (const k of kinds as unknown[]) if (k === 'normal' || k === 'crit' || k === 'fail') out[k as 'normal' | 'crit' | 'fail']++
  return out
}

/** Expected wounds gained by re-rolling one failed die in the open window; null when the window is not understood. */
function rerollGain(ctx: AiCtx, kindsOwn: unknown, side: string): number | null {
  const view = ctx.view
  const a = view.attack
  const seq = a?.seq
  if (!a || !seq) return null
  const own = countKinds(kindsOwn)
  if (own.fail === 0) return 0
  if (a.kind === 'shoot') {
    const target = view.operatives[seq.targetId]
    const atkOp = view.operatives[a.operativeId]
    const w = a.weaponId ? view.data.weapons[a.weaponId] : undefined
    if (!target || !atkOp || !w) return null
    const dmg = avgDmg(w.dmg)
    const defSucc = 3 * (1 - dieOdds(target.save).fail) + (seq.cover ? 0.5 : 0)
    if (side === 'attack') {
      const p = 1 - dieOdds(seq.atk.need, seq.atk.lethal ?? undefined).fail
      const k = own.normal + own.crit
      const leverage = Math.max(0.15, Math.min(1, (k - defSucc + 1.5) / 2))
      let gain = p * dmg * leverage
      // a single die that can finish the target
      if (target.wounds <= (k + 1) * dmg && target.wounds > k * dmg * 0.8) gain += p * 1.5
      return gain
    }
    const attacks = seq.atk.dice.filter((d) => d.kind !== 'fail')
    const q = 1 - dieOdds(target.save).fail
    const leverage = Math.max(0.1, Math.min(1, (attacks.length - (own.normal + own.crit) + 0.5) / 1.5))
    let gain = q * dmg * leverage
    const atkDamage = attacks.reduce((s, d) => s + (d.kind === 'crit' ? w.dmg.crit : w.dmg.normal), 0)
    if (atkDamage >= (view.operatives[seq.targetId]?.wounds ?? 99) && atkDamage - dmg < (view.operatives[seq.targetId]?.wounds ?? 99)) gain += q * 2
    return gain
  }
  // fight: an extra success is an extra strike or block
  const mine = side === 'attacker' ? seq.atk : seq.def
  const op = mine ? view.operatives[mine.operativeId] : undefined
  const w = mine?.weaponId ? view.data.weapons[mine.weaponId] : undefined
  if (!mine || !op || !w) return null
  const p = 1 - dieOdds(mine.need, mine.lethal ?? undefined).fail
  return p * avgDmg(w.dmg) * 0.8
}

/** dice.commandReroll: re-roll one failed die when the expected gain beats the threshold for our spare points. */
export function commandReroll(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const cp = view.players[ctx.seat].cp
  const opts = pending.options ?? []
  const kinds = pending.context.kinds
  const side = String(pending.context.side ?? '')
  const gain = rerollGain(ctx, kinds, side)
  if (gain === null || gain < threshold(cp)) return passAction(pending)
  const failed = opts.find((o) => {
    const idx = (o.action.payload as { dice?: number[] }).dice?.[0]
    return typeof idx === 'number' && Array.isArray(kinds) && kinds[idx] === 'fail'
  })
  return failed ? failed.action : passAction(pending)
}

/** dice.reroll from weapon rules and equipment (free): the engine's policy re-rolls failed dice. */
export function ruleReroll(ctx: AiCtx): Action | null {
  return answerDecision(ctx.view, ctx.pending)
}

// ---------------------------------------------------------------------------
// Strategic gambits
// ---------------------------------------------------------------------------

const GAMBIT_SCORE: Record<string, number> = {
  'aod.p.combat-doctrine': 2.6,
  'aod.p.indomitus': 1.4,
  'aod.p.and-they-shall-know-no-fear': 0.9,
  'aod.p.adaptive-tactics': 0.2,
  'kom.p.dakka-dakka-dakka': 2.6,
  'kom.p.waaagh': 2.0,
  'kom.p.skulk-about': 1.7,
  'kom.p.ssssshhhh': 1.0,
}

function nearestEnemyDistances(view: GameState, seat: string): number[] {
  const mine = seatOps(view, seat as 'A' | 'B')
  const theirs = enemiesOf(view, { seat: seat as 'A' | 'B' })
  return mine.map((m) => Math.min(99, ...theirs.map((e) => distanceBetween(bodyOf(m), bodyOf(e)))))
}

function doctrineScore(view: GameState, seat: string, param: string): number {
  const d = nearestEnemyDistances(view, seat)
  const avg = d.length ? d.reduce((s, x) => s + x, 0) / d.length : 12
  const engaged = d.filter((x) => x <= 1.5).length
  if (param === 'devastator') return 2.4 + (avg > 8 ? 0.7 : 0)
  if (param === 'tactical') return 2.2 + (avg <= 7 && avg > 2.5 ? 0.6 : 0)
  if (param === 'assault') return 1.6 + engaged * 0.8 + (avg <= 3 ? 0.8 : 0)
  return 1
}

/** strategy.gambit: the best gambit when it is worth the point, else pass. One reserve point stays for re-rolls after the first. */
export function gambit(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const cp = view.players[ctx.seat].cp
  const used = view.strategy.gambit.used[ctx.seat].length
  let best: { o: DecisionOption; s: number } | null = null
  for (const o of pending.options ?? []) {
    const p = o.action.payload as { gambitId: string; param?: string }
    const cost = Number(o.data?.cost ?? 1)
    if (cost > cp) continue
    if (used > 0 && cp - cost < 1) continue
    let s = GAMBIT_SCORE[p.gambitId] ?? 0.8
    if (p.gambitId === 'aod.p.combat-doctrine' && p.param) s = doctrineScore(view, ctx.seat, p.param)
    if (!ctx.params.tacAware) s *= 0.7
    if (!best || s > best.s) best = { o, s }
  }
  // the first gambit of the turning point is almost always worth it; the next ones need clear value
  if (best && best.s >= (used === 0 ? 0.8 : 1.6)) return best.o.action
  return passAction(pending)
}

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

const PLOY_SCORE: Record<string, number> = {
  'aod.p.wrath-of-vengeance': 3,
  'aod.p.transhuman-physiology': 2,
  'kom.p.just-a-scratch': 2,
  'aod.p.shock-assault': 2.2,
  'kom.p.kunnin-but-brutal': 2.2,
  'kom.p.krump-em': 2.4,
  'aod.p.adjust-doctrine': 0,
  'kom.p.shake-it-off': 0.4,
}

/** ploy.firefight: use the best offered ploy when the window's swing is positive, else pass. */
export function firefightPloy(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const cp = view.players[ctx.seat].cp
  const info = (view.window?.info ?? {}) as { attackFails?: number; defenceFails?: number; critRetained?: boolean }
  let best: { o: DecisionOption; s: number } | null = null
  for (const o of pending.options ?? []) {
    const p = o.action.payload as { ployId: string }
    const cost = Number(o.data?.cost ?? 1)
    if (cost > cp) continue
    let s = PLOY_SCORE[p.ployId] ?? 0.9
    // defensive dice ploys matter when the attack is heavy; offensive ones when the swing is open
    if (pending.window === 'shoot.defenceRolled' && (info.attackFails ?? 0) > 3) s *= 0.7
    if (!ctx.params.tacAware) s *= 0.6
    if (!best || s > best.s) best = { o, s }
  }
  const need = threshold(cp) - 0.3
  if (best && best.s >= need) return best.o.action
  return passAction(pending)
}

export type { Operative }
