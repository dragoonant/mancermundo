// Weapon rules as hooks into shoot/fight (Accurate ... Torrent) live in attack-common.ts (parsing,
// retention, blocking) and shoot.ts / fight.ts (the sequences). This module owns the two decision
// families that cut across both sequences: `weapon.choice` and the re-roll windows `dice.reroll` /
// `dice.commandReroll` (modules.ts routes the `dice.*` re-roll kinds here).
import { fightChoice, fightReroll } from './fight'
import { reject, type ModuleDef } from './registry'
import { shootChoice, shootReroll } from './shoot'

export {
  accurateTotal,
  blockPlans,
  effectiveRules,
  hasRule,
  parseRules,
  ruleKey,
  ruleSetFor,
  weaponUnusable,
  type RuleSet,
} from './attack-common'

export const weaponsModule: ModuleDef = {
  id: 'weapons',
  namespaces: ['weapon'],
  handle(state, action, pending) {
    const a = state.attack
    if (!a) return reject('E_WRONG_DECISION', `${pending.kind} arrived with no Shoot or Fight in progress`)
    if (pending.kind === 'weapon.choice') {
      if (action.type !== 'weapon.choice') return reject('E_WRONG_DECISION', 'expected a choice')
      const choice = String(action.payload.choice)
      const option = String(action.payload.option)
      return { run: (ctx) => (a.kind === 'shoot' ? shootChoice(ctx, choice, option) : fightChoice(ctx, choice, option)) }
    }
    if (pending.kind === 'dice.reroll' || pending.kind === 'dice.commandReroll') {
      return a.kind === 'shoot' ? shootReroll(state, action, pending) : fightReroll(state, action, pending)
    }
    return reject('E_WRONG_DECISION', `${pending.kind} is not handled by the weapons module`)
  },
}
