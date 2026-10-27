// SKL module: owns the `skill` namespace (`skill.choice`) and, through the override in modules.ts, `dice.reroll`. A rule that needs a
// player's answer raises a `skill.choice` whose `context.skill` names it; the handlers below (and any a rules module registers
// with `registerChoiceHandler`) validate and apply the answer. Option membership is already checked by `step`, so a handler only
// returns the closure that resolves the chosen option.
//
// The close-combat skills and skill actions of S4K-B live in ./skills/: `combat.ts` registers the code hooks (passive effects),
// `actions.ts` the actions skills grant, `hurl.ts`, `somersault.ts` and `stance.ts` what those need.
import { endActivation, payAndContinue, resumeFlow } from './activation'
import { markFired } from './code-hooks'
import { answerChoice, resumeSequence } from './fight'
import { reject, type Handled, type ModuleDef } from './registry'
import { applyHurl } from './skills/hurl'
import { strengthTest } from './skills/common'
import { getFighter } from './state'
import type { Action, GameState, PendingDecision } from './types'
import './skills/combat'

type ChoiceAction = Extract<Action, { type: 'skill.choice' }>
export type ChoiceHandler = (state: GameState, action: ChoiceAction, pending: PendingDecision) => Handled

const choiceHandlers = new Map<string, ChoiceHandler>()
let defaultsInstalled = false

/** Register the handler for `skill.choice` decisions whose `context.skill` is `skill` (re-registering replaces it). */
export function registerChoiceHandler(skill: string, handler: ChoiceHandler): void {
  choiceHandlers.set(skill, handler)
}

/** The built-in handlers, installed on first use (module cycles: nothing imported may be touched while modules load). */
function installDefaults(): void {
  if (defaultsInstalled) return
  defaultsInstalled = true
  const defaults = new Map<string, ChoiceHandler>()
  // the answers of the skills that interrupt the close-combat sequence: Hit and Run, Lightning Reflexes, Hurl instead of the free Fight
  for (const skill of ['hitAndRun', 'lightningReflexes', 'hurlFight']) defaults.set(skill, answerChoice)
  // Naaargah!: attempt a third action (a Toughness test; the fighter ends the activation Pinned either way) or decline
  defaults.set('naaargah', (_state, action) => {
    const attempt = action.payload.option === 'attempt'
    return {
      run(ctx) {
        const s = ctx.state
        const act = s.action.activation!
        const f = getFighter(s, act.fighterId)
        if (!attempt) {
          endActivation(ctx)
          return
        }
        markFired('naaargah')
        ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'naaargah' }, f.seat)
        act.naaargah = 'pinned'
        if (strengthTest(ctx, f, 'T', 'naaargah').passed) {
          act.actionsLeft = 1
          act.allowance = 3
          resumeFlow(ctx, f.seat)
        } else endActivation(ctx)
      },
    }
  })
  // Hurl: the Hurler picked the direction the hurled fighter flies
  defaults.set('hurlDirection', (_state, action, pending) => {
    const option = action.payload.option
    const thrower = pending.context.fighterId as string
    const targetId = pending.context.targetId as string
    const distance = pending.context.distance as number
    const inSeq = pending.context.inSeq === true
    return {
      run(ctx) {
        const f = getFighter(ctx.state, thrower)
        applyHurl(ctx, f, getFighter(ctx.state, targetId), Number(option.slice(4)), distance)
        if (inSeq) resumeSequence(ctx)
        else payAndContinue(ctx, f, 'hurl')
      },
    }
  })
  for (const [name, h] of defaults) if (!choiceHandlers.has(name)) choiceHandlers.set(name, h)
}

function handle(state: GameState, action: Action, pending: PendingDecision): Handled {
  installDefaults()
  if (pending.kind === 'skill.choice') {
    if (action.type !== 'skill.choice') return reject('E_WRONG_DECISION', `expected skill.choice, got ${action.type}`)
    const name = String(pending.context.skill ?? '')
    const handler = choiceHandlers.get(name)
    if (!handler) return reject('E_TODO', `no rule answers the skill choice ${name}`)
    return handler(state, action, pending)
  }
  return reject('E_TODO', `${pending.kind} is not implemented yet (module skills)`)
}

export const skillsModule: ModuleDef = {
  id: 'skills',
  namespaces: ['skill'],
  handle,
}
