// SKL module: owns the `skill` namespace (and, through the override in modules.ts, `dice.reroll`).
// S4K-A: `skill.choice` is answered here (src/engine/skills/choice.ts raises the start-of-activation choices of the passive
// skills and wargear); the passive code hooks themselves are registered by src/engine/skills/passive.ts, imported below so
// they are installed in every game. `dice.reroll` still rejects with E_TODO until S4K-B lands it.
import './skills/passive'
import { handleSkillChoice } from './skills/choice'
import { reject, type ModuleDef } from './registry'

export const skillsModule: ModuleDef = {
  id: 'skills',
  namespaces: ['skill'],
  handle(state, action, pending) {
    if (action.type === 'skill.choice') return handleSkillChoice(state, action, pending)
    return reject('E_TODO', `${action.type} is not implemented yet (module skills)`)
  },
}
