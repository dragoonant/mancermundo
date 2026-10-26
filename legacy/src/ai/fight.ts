// Fight decisions (docs/spec/40-ai section 2): target and weapon by the expected exchange, strike/block by the
// engine's minimax (`fightOutcome`, through `answerDecision`), and the value of a melee exchange for the planner.
import { dieOdds } from '@/engine/dice'
import { attackStats, parseRules } from '@/engine/attack-common'
import { answerDecision, fightOutcome, type FightPosition, type FightSideState } from '@/engine/query'
import type { Action, GameState, Operative, PendingDecision } from '@/engine'
import { killEstimate, killVpBonus, targetMult } from './eval'
import type { AiCtx } from './tiers'

export interface FightEst {
  weaponId: string | null
  dealt: number
  taken: number
  kill: number
  /** probability the attacker is incapacitated */
  die: number
  value: number
}

function sideFor(view: GameState, op: Operative, weaponId: string, foeId: string): FightSideState | null {
  const w = view.data.weapons[weaponId]
  if (!w) return null
  let atk = w.atk
  let need = w.hit as number
  let lethal: number | null = null
  try {
    const st = attackStats(view, op.id, weaponId, foeId, { kind: 'fight' })
    atk = st.atk
    need = st.need
    lethal = st.lethal
  } catch {
    // keep the printed profile
  }
  const odds = dieOdds(need, lethal ?? undefined)
  const rules = parseRules(w.rules)
  return {
    normals: Math.round(atk * odds.normal),
    crits: Math.round(atk * odds.crit),
    dmg: w.dmg,
    wounds: op.wounds,
    shock: rules.shock,
    brutal: rules.brutal,
  }
}

function meleeWeapons(view: GameState, op: Operative): string[] {
  return op.weapons.filter((id) => view.data.weapons[id]?.type === 'melee')
}

function bestRetaliation(view: GameState, def: Operative, att: Operative): FightSideState {
  let best: FightSideState | null = null
  let bestV = -1
  for (const id of meleeWeapons(view, def)) {
    const s = sideFor(view, def, id, att.id)
    if (!s) continue
    const v = s.normals * s.dmg.normal + s.crits * s.dmg.crit
    if (v > bestV) {
      bestV = v
      best = s
    }
  }
  return best ?? { normals: 0, crits: 0, dmg: { normal: 0, crit: 0 }, wounds: def.wounds, shock: false, brutal: false }
}

/** Expected melee exchange if `att` fights `def` (`weaponId` forced, else the best weapon). */
export function fightEstimate(ctx: AiCtx, view: GameState, att: Operative, def: Operative, weaponId?: string): FightEst | null {
  const ids = weaponId ? [weaponId] : meleeWeapons(view, att)
  let best: FightEst | null = null
  for (const id of ids) {
    const a = sideFor(view, att, id, def.id)
    if (!a) continue
    const d = bestRetaliation(view, def, att)
    const pos: FightPosition = { a, d, turn: 'a' }
    const out = fightOutcome(pos)
    const dealt = def.wounds - out.dWounds
    const taken = att.wounds - out.aWounds
    const kill = out.dWounds <= 0 ? 0.85 : killEstimate(dealt, def.wounds, (a.dmg.normal * 2 + a.dmg.crit) / 3) * 0.7
    const die = out.aWounds <= 0 ? 0.85 : 0
    const mult = targetMult(ctx, view, def)
    const value = mult * (ctx.w.dmg * Math.min(dealt, def.wounds) + (ctx.w.kill + killVpBonus(ctx, view)) * kill) - ctx.w.dmg * taken * 0.8 - ctx.w.die * die
    if (!best || value > best.value) best = { weaponId: id, dealt, taken, kill, die, value }
  }
  return best
}

/** Best fight the operative has against any enemy in its control range. */
export function bestFight(ctx: AiCtx, view: GameState, att: Operative, inRange: Operative[]): { target: Operative; est: FightEst } | null {
  let best: { target: Operative; est: FightEst } | null = null
  for (const t of inRange) {
    const est = fightEstimate(ctx, view, att, t)
    if (est && (!best || est.value > best.est.value)) best = { target: t, est }
  }
  return best
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function fightTarget(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const att = view.operatives[String(pending.context.operativeId)]
  if (!att || !pending.options) return null
  let best: { a: Action; v: number } | null = null
  for (const o of pending.options) {
    const t = view.operatives[String((o.action.payload as { targetId?: string }).targetId)]
    if (!t) continue
    const est = fightEstimate(ctx, view, att, t)
    const v = est ? est.value : -1e9
    if (!best || v > best.v) best = { a: o.action, v }
  }
  return best?.a ?? null
}

export function fightWeapon(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const me = view.operatives[String(pending.context.operativeId)]
  const att = view.attack
  if (!me || !pending.options) return null
  const foeId = pending.context.retaliating === true ? att?.operativeId : att?.fight?.targetId
  const foe = foeId ? view.operatives[foeId] : undefined
  let best: { a: Action; v: number } | null = null
  for (const o of pending.options) {
    const wid = String((o.action.payload as { weaponId?: string }).weaponId)
    let v: number
    if (foe) {
      const est = fightEstimate(ctx, view, me, foe, wid)
      v = est ? est.value : -1e9
    } else {
      const w = view.data.weapons[wid]
      v = w ? w.atk * (w.dmg.normal * 0.6 + w.dmg.crit * 0.2) : 0
    }
    if (!best || v > best.v) best = { a: o.action, v }
  }
  return best?.a ?? null
}

/** Strike or block with the engine's minimax over the remaining dice. */
export function fightResolve(ctx: AiCtx): Action | null {
  return answerDecision(ctx.view, ctx.pending)
}

/**
 * Guard interrupt (an enemy just acted in sight of an on-Guard operative): take the shot or the fight when it is
 * worth more than nothing. Options are `<id>:shoot` / `<id>:fight`.
 */
export function guardInterrupt(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  if (!pending.options) return null
  const actor = view.operatives[String(pending.context.actorId)]
  let best: { a: Action; v: number } | null = null
  for (const o of pending.options) {
    const p = o.action.payload as { operativeId: string; action: 'shoot' | 'fight' }
    const g = view.operatives[p.operativeId]
    if (!g || !actor) continue
    let v = 0
    if (p.action === 'shoot') {
      let m = 0
      for (const wid of g.weapons) {
        const w = view.data.weapons[wid]
        if (!w || w.type !== 'ranged') continue
        const ed = openEstimate(view, g, wid, actor)
        m = Math.max(m, ed)
      }
      // point-blank shots hit worse and cannot be retaliated against
      v = m * (o.data?.pointBlank === true ? 0.7 : 0.85)
    } else {
      const est = fightEstimate(ctx, view, g, actor)
      v = est ? est.value : 0
    }
    if (!best || v > best.v) best = { a: o.action, v }
  }
  return best && best.v > 0.6 ? best.a : null
}

function openEstimate(view: GameState, att: Operative, wid: string, tgt: Operative): number {
  const w = view.data.weapons[wid]!
  const p = (7 - Math.max(2, Math.min(6, w.hit))) / 6
  const save = (7 - Math.max(2, Math.min(6, tgt.save))) / 6
  const succ = w.atk * p
  const blocks = 3 * save
  const avg = (w.dmg.normal * 0.8 + w.dmg.crit * 0.2)
  void att
  return Math.max(0, succ - blocks * 0.9) * avg
}

export type { PendingDecision }
