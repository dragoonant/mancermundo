// End-phase and rule-grant decisions (docs/spec/40-ai.md section 2): the Bottle choice, voluntary flight, recovery assists and
// picks, skill choices, re-rolls and the final confirm. These are small decisions with real consequences, so each one is
// scored from the engine's odds rather than answered by position in the list.
import { act, query, type Action, type DecisionOption } from '@/engine'
import { getFighter, readyFighters } from '@/engine/state'
import { fighterValue } from './eval'
import type { AiCtx } from './tiers'

/** `end.bottle`: take the test. Bottling on purpose is only for a gang that has already lost: nearly everyone down and the
 *  test would very likely fail anyway. */
export function bottle(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  const view = query.scenarioView(state)
  const me = p.seat
  const opp = me === 'A' ? 'B' : 'A'
  const info = query.bottleOdds(state, me)
  const hopeless = view.standing[me] <= 1 && view.standing[opp] >= 3 && info.pBottle >= 0.5 && view.leading !== me
  const want = hopeless ? 'bottle' : 'test'
  const o = (p.options ?? []).find((x) => x.action.type === 'end.bottle' && x.action.payload.choice === want) ?? p.options?.[0]
  return o ? o.action : null
}

/** `action.flee`: a bottled gang's voluntary flight: no fighter runs while there is a fight to win, so decline. */
export function flee(ctx: AiCtx): Action | null {
  const o = (ctx.pending.options ?? []).find((x) => x.action.type === 'action.flee' && x.action.payload.done)
  return o ? o.action : null
}

/** `end.assist`: help the most valuable Seriously Injured fighter back up, with the assister that is needed least. */
export function assist(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  let best: { o: DecisionOption; v: number } | null = null
  let none: DecisionOption | null = null
  for (const o of p.options ?? []) {
    if (o.action.type !== 'end.assist') continue
    const pl = o.action.payload
    if (pl.none || !pl.assisterId || !pl.recoveringId) {
      none = o
      continue
    }
    const rec = getFighter(state, pl.recoveringId)
    const ass = getFighter(state, pl.assisterId)
    // the assister loses nothing in the End phase, but a Ready fighter near the front is not worth less than a quiet one
    const v = fighterValue(state, rec) * 2 - 0.01 * fighterValue(state, ass) + (ass.engagedWith.length === 0 ? 0.01 : 0)
    if (!best || v > best.v) best = { o, v }
  }
  return best ? best.o.action : (none?.action ?? null)
}

/** `end.recoveryPick`: the engine lists the dice from the kindest result to the worst: keep the kindest. */
export function recoveryPick(ctx: AiCtx): Action | null {
  const opts = ctx.pending.options ?? []
  const rank = (o: DecisionOption): number => {
    const face = String((o.data as { face?: string } | undefined)?.face ?? '')
    return face === 'fleshWound' ? 0 : face === 'seriouslyInjured' ? 1 : 2
  }
  const best = opts.slice().sort((a, b) => rank(a) - rank(b))[0]
  return best ? best.action : null
}

/** `skill.choice`: no v1 rule raises one yet. When one does, take the first offered option that is not a decline. */
export function skillChoice(ctx: AiCtx): Action | null {
  const opts = ctx.pending.options ?? []
  const decline = /^(no|none|decline|skip|pass|cancel)/i
  const pick = opts.find((o) => !decline.test(o.id)) ?? opts[0]
  return pick ? pick.action : null
}

/** `dice.reroll`: take a re-roll when one is on offer (nothing in the v1 core opens it); otherwise pass. */
export function reroll(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const opts = p.options ?? []
  if (opts.length > 0) return opts[0]!.action
  return p.canPass ? act.pass(p) : null
}

/** `confirm`: finish a locked win (the AI never drags a decided battle out), otherwise carry on. */
export function confirm(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const opts = p.options ?? []
  const concede = opts.find((o) => o.action.type === 'confirm' && o.action.payload.choice === 'concede')
  const cont = opts.find((o) => o.action.type === 'confirm' && o.action.payload.choice === 'continue')
  const locked = ctx.view.scenario.locked
  return (locked && locked.winner === p.seat ? (concede ?? cont) : (cont ?? concede))?.action ?? opts[0]?.action ?? (p.canPass ? act.pass(p) : null)
}

export { readyFighters }
