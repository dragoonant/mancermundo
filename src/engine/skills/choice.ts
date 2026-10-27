// `skill.choice` (00 section 3): a skill, fighter rule or wargear item asks its owner whether to use it. S4K-A raises the
// start-of-activation choices (Stimm-slug stash, Chem-synth) at the first decision point of the activation, because lifecycle
// hooks must not raise decisions (hooks.ts). A rule registers a `ChoiceDef`; the engine asks each eligible one in turn (once per
// activation), the first option is "use it" (the AI takes the first option that is not a decline), and the answer applies the
// rule and carries the activation on to the action menu.
import { beginActions } from '../activation'
import { reject, type Ctx, type Handled } from '../registry'
import { getFighter } from '../state'
import type { Action, Fighter, GameState, PendingDecision } from '../types'

export interface ChoiceDef {
  /** the code hook name; `context.code` of the decision */
  code: string
  /** is the fighter asked now (it has the item, it is unused, the situation fits)? Must not roll or mutate. */
  eligible(state: GameState, f: Fighter): boolean
  /** engine numbers shown with the "use it" option and in the decision context */
  info?(state: GameState, f: Fighter): Record<string, unknown>
  /** "use it" was chosen: roll and mutate */
  apply(ctx: Ctx, f: Fighter): void
}

const defs = new Map<string, ChoiceDef>()
const order: string[] = []

export function registerChoice(def: ChoiceDef): void {
  if (!defs.has(def.code)) order.push(def.code)
  defs.set(def.code, def)
}

/**
 * Put the next eligible start-of-activation choice to the active fighter's owner. True when a decision was raised (the caller
 * returns and waits for the answer, which resumes the activation through `beginActions`).
 */
export function raiseActivationChoices(ctx: Ctx, f: Fighter): boolean {
  const act = ctx.state.action.activation
  if (!act || f.location !== 'board') return false
  act.asked ??= []
  for (const code of order) {
    const def = defs.get(code)!
    if (act.asked.includes(code) || !def.eligible(ctx.state, f)) continue
    act.asked.push(code)
    const info = def.info?.(ctx.state, f) ?? {}
    ctx.raise({
      kind: 'skill.choice',
      seat: f.seat,
      window: 'activation.start',
      context: { code, fighterId: f.id, ...info },
      options: [
        { id: 'use', labelKey: `skill.${code}.use`, type: 'skill.choice', payload: { option: 'use' }, data: { code, ...info } },
        { id: 'decline', labelKey: `skill.${code}.decline`, type: 'skill.choice', payload: { option: 'decline' }, data: { code } },
      ],
    })
    return true
  }
  return false
}

/** The `skill.choice` module handler (skills.ts routes the kind here). */
export function handleSkillChoice(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type !== 'skill.choice') return reject('E_WRONG_DECISION', `expected skill.choice, got ${action.type}`)
  const def = defs.get(String(pending.context.code))
  const fighterId = String(pending.context.fighterId ?? '')
  if (!def || !state.fighters[fighterId]) return reject('E_WRONG_DECISION', 'no skill choice is waiting for an answer')
  const use = action.payload.option === 'use'
  return {
    run(ctx) {
      const f = getFighter(ctx.state, fighterId)
      if (use) def.apply(ctx, f)
      beginActions(ctx, f)
    },
  }
}
