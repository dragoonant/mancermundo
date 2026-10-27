// The shoot.* decisions (docs/spec/40-ai.md section 2): weapon, target, aim point and Rapid Fire allocation. All four read the
// same valuation as the activation planner (`shots.ts`), so the shot the planner counted on is the shot that gets taken.
import { act, type Action, type DecisionOption, type Vec2 } from '@/engine'
import { getFighter } from '@/engine/state'
import { twoD6TestChance } from '@/engine/dice'
import { evalOption, type EvalOpts } from './shots'
import { hitChain, outcomeValue, shotOutcome } from './eval'
import { banChosen } from './moves'
import type { AiCtx } from './tiers'

function shooterOf(ctx: AiCtx) {
  const id = String(ctx.pending.context.fighterId)
  return getFighter(ctx.view, id)
}

function evalOpts(ctx: AiCtx, values?: Map<string, number>): EvalOpts {
  const a = ctx.view.action.activation
  const mode = ctx.pending.context.mode === 'blindFire' ? 'blindFire' : 'shoot'
  return { aimed: a?.aimed ?? false, mode, actionsLeft: a?.actionsLeft ?? 2, ...(values ? { values } : {}) }
}

function giveBack(ctx: AiCtx): Action {
  // nothing worth shooting: hand the action back (no dice rolled yet) and never pick Shoot again this activation
  banChosen(ctx)
  return act.pass(ctx.pending)
}

/** `shoot.weapon`: the option whose best target is worth the most. */
export function weapon(ctx: AiCtx): Action | null {
  const p = ctx.pending
  if (!p.options) return null
  const f = shooterOf(ctx)
  let best: { o: DecisionOption; v: number } | null = null
  for (const o of p.options) {
    if (o.action.type !== 'shoot.weapon') continue
    const { weaponId, profileId, twinWith } = o.action.payload
    const plan = evalOption(ctx, ctx.view, f, weaponId, profileId, twinWith, evalOpts(ctx))
    const v = plan ? plan.value : -1
    if (!best || v > best.v) best = { o, v }
  }
  if (!best) return null
  if (best.v <= -0.4 && p.canPass) return giveBack(ctx)
  return best.o.action
}

/** `shoot.target`: the target worth the most, counting a failed priority Cool test as a shot at the closest enemy. */
export function target(ctx: AiCtx): Action | null {
  const p = ctx.pending
  if (!p.options) return null
  const f = shooterOf(ctx)
  const weaponId = String(p.context.weaponId)
  const profileId = String(p.context.profileId)
  const values = new Map<string, number>()
  // twin sidearms are named by the weapon choice; the second weapon is not in this context, so score the pair as stated
  const state = ctx.view
  const shots = (state.attack?.data as { shots?: { weaponId: string }[] } | undefined)?.shots
  const twinWith = p.context.twin === true ? shots?.[1]?.weaponId : undefined
  evalOption(ctx, state, f, weaponId, profileId, twinWith, evalOpts(ctx, values))
  let best: { o: DecisionOption; v: number } | null = null
  for (const o of p.options) {
    if (o.action.type !== 'shoot.target') continue
    const pl = o.action.payload
    let v: number
    if (pl.targetId) v = values.get(pl.targetId) ?? -1
    else if (pl.doorId) v = -0.3
    else if (pl.trapId) v = -0.5 // a frag trap is left alone
    else v = values.get('point') ?? -1
    if (!best || v > best.v) best = { o, v }
  }
  if (!best) return null
  if (best.v <= 0 && p.canPass) return giveBack(ctx)
  return best.o.action
}

/** `shoot.aim`: the engine's aim suggestion that scores best (enemies hit, friends spared). */
export function aim(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  const f = shooterOf(ctx)
  const sugg = (p.context.suggestions as { aim: Vec2; enemies: string[]; friends: string[] }[] | undefined) ?? []
  const weaponId = String(p.context.weaponId)
  const profileId = String(p.context.profileId)
  const prof = state.data.weapons[weaponId]?.profiles.find((q) => q.id === profileId)
  if (!prof) return null
  let best: { aim: Vec2; v: number } | null = null
  for (const s of sugg.slice(0, 6)) {
    let v = 0
    const chance = p.context.kind === 'template' ? 1 : 0.5
    for (const id of s.enemies) {
      const e = getFighter(state, id)
      v += outcomeValue(ctx.w, state, e, shotOutcome(hitChain(ctx, state, f, weaponId, prof, e), chance, e))
    }
    for (const id of s.friends) {
      const g = getFighter(state, id)
      v -= outcomeValue(ctx.w, state, g, shotOutcome(hitChain(ctx, state, f, weaponId, prof, g), chance, g)) * 1.3
    }
    if (!best || v > best.v) best = { aim: s.aim, v }
  }
  if (!best || best.v <= 0) {
    if (p.canPass) return giveBack(ctx)
    return best ? act.aim(p, best.aim) : null
  }
  return act.aim(p, best.aim)
}

/** `shoot.firepower`: roll every Firepower dice the Rapid Fire weapon allows (the most hits). */
export function firepower(ctx: AiCtx): Action | null {
  const p = ctx.pending
  let best: DecisionOption | null = null
  for (const o of p.options ?? []) {
    if (o.action.type !== 'shoot.firepower') continue
    if (!best || o.action.payload.dice > (best.action.payload as { dice: number }).dice) best = o
  }
  return best ? best.action : null
}

/** `shoot.allocate`: each extra Rapid Fire hit goes to the target it hurts most. */
export function allocate(ctx: AiCtx): Action | null {
  const p = ctx.pending
  if (!p.options) return null
  const state = ctx.view
  const f = shooterOf(ctx)
  const data = state.attack?.data as { shots?: { weaponId: string; profileId: string }[] } | undefined
  const shot = data?.shots?.[0]
  const prof = shot ? state.data.weapons[shot.weaponId]?.profiles.find((q) => q.id === shot.profileId) : undefined
  let best: { o: DecisionOption; v: number } | null = null
  for (const o of p.options) {
    if (o.action.type !== 'shoot.allocate') continue
    const t = getFighter(state, o.action.payload.targetId)
    const v = prof && shot ? outcomeValue(ctx.w, state, t, shotOutcome(hitChain(ctx, state, f, shot.weaponId, prof, t), 1, t)) : 0
    if (!best || v > best.v) best = { o, v }
  }
  return best ? best.o.action : null
}

export { twoD6TestChance }
