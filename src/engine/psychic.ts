// PSYCHIC across teams (M9 batch C, generic capability "psychic"). A PSYCHIC weapon carries a weapon rule whose id
// ends in `.wr-psychic` (every team declares its own tag, all normalised to the key `psychic`); a PSYCHIC unique action
// has the keyword PSYCHIC on its ability record. A rule of one team can switch another team's PSYCHIC rules off (the
// Novitiate Condemnor's Null Rod: within 6" no PSYCHIC actions, PSYCHIC ranged weapons or PSYCHIC additional rules,
// and the Condemnor itself cannot be picked by PSYCHIC actions). The shared files apply the block to unique actions
// (abilities.genericProblem) and to ranged weapons (attack-common.weaponUnusable); a team file asks `psychicAllowed`
// before one of its own PSYCHIC additional rules works and `psychicSelectable` before a PSYCHIC action picks someone.
// Pure helpers of the state.
import { providerPsychicBlocked, providerPsychicImmune } from './team-rules'
import type { GameState, Operative } from './types'

/** Does the weapon carry a PSYCHIC tag (any team's `<prefix>.a.wr-psychic`, or `core.wr.psychic`)? */
export function isPsychicWeapon(state: GameState, weaponId: string): boolean {
  // same normalisation as attack-common.ruleKey (kept local: attack-common imports this module)
  return (state.data.weapons[weaponId]?.rules ?? []).some((r) => {
    const base = r.rule.includes('.') ? r.rule.slice(r.rule.lastIndexOf('.') + 1) : r.rule
    return base.toLowerCase().replace(/[^a-z0-9]/g, '') === 'psychic'
  })
}

/** Is the unique action (ability id, with or without the `ability:` prefix) a PSYCHIC action? */
export function isPsychicAbility(state: GameState, abilityId: string): boolean {
  const id = abilityId.startsWith('ability:') ? abilityId.slice('ability:'.length) : abilityId
  return (state.data.abilities[id]?.keywords ?? []).includes('PSYCHIC')
}

/** May the operative use PSYCHIC actions, PSYCHIC ranged weapons and its PSYCHIC additional rules right now? */
export function psychicAllowed(state: GameState, op: Operative): boolean {
  return !providerPsychicBlocked(state, op)
}

/** May a PSYCHIC action select this operative (or count it as within its distances)? */
export function psychicSelectable(state: GameState, op: Operative): boolean {
  return !providerPsychicImmune(state, op)
}
