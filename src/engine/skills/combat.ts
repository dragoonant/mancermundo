// S4K-B: the code hooks of the close combat skills and the skill actions (docs/spec/13-gangs.md section 7). A data record names one
// with `{ "code": "<name>" }`; the tests prove each fires in a real game (`hookFireCount(name) > 0`).
//
// Where the rule lives:
//  - through engine hooks registered here: counterAttack (fight.attackDice), combatVirtuoso (weapon.traits), immovableStance
//    (save.mods, pin.allowed), regroup (activation.end);
//  - in the rule code, which asks `skillOf` / `hasSkill` and calls `markFired`: crushingBlow, combatDisarm, parrySkill, stepAside,
//    combatMaster, fistsOfSteel, impetuous, fearsome, acrobatic, hitAndRun, lightningReflexes (fight.ts / movement.ts),
//    bulgingBiceps (fight.ts weapon pairing), naaargah, overseer, commandingPresence (activation.ts), and the actions headbutt,
//    hurl, immovableStance, unleashTheBeast, somersault (skills/actions.ts).
// The installs are idempotent (fixed hook ids) and run once when this module loads, so every game has them.
import { installCodeHooks, markFired, registerCodeHook, type CodeHookDef } from '../code-hooks'
import { registerHook } from '../hooks'
import { refreshEngagement, withinPath } from '../measure'
import { stat } from '../query'
import { constants, friendsOf, getFighter, isBroken } from '../state'
import { clearCondition, T } from '../traits'
import type { Fighter, GameState, TraitRef } from '../types'
import { mentalTest, numParam, skillOf } from './common'
import { isImmovable } from './stance'

/** A validator for code hook params: every listed key, when present, is a finite number (no other keys are checked). */
function numericParams(name: string, keys: readonly string[]): (p: Record<string, unknown> | undefined) => string | null {
  return (p) => {
    if (!p) return null
    for (const k of keys) if (k in p && (typeof p[k] !== 'number' || !Number.isFinite(p[k] as number))) return `${name}: ${k} must be a number`
    return null
  }
}

const fighterOf = (state: GameState | undefined, id: string | undefined): Fighter | null => (state && id ? (state.fighters[id] ?? null) : null)

interface Def {
  name: string
  params?: string[]
  install?: () => void
}

const DEFS: Def[] = [
  { name: 'crushingBlow', params: ['strength', 'damage', 'attacks'] },
  {
    name: 'counterAttack',
    params: ['perFailedHit'],
    install() {
      // +1 Attack for each of the opponent's attacks at this fighter that failed to hit, on reaction attacks only
      registerHook(
        'fight.attackDice',
        (h) => {
          const f = fighterOf(h.state, h.fighterId)
          const d = h.data as { role?: string; failed?: number } | undefined
          if (!f || !h.state || d?.role !== 'reaction' || !d.failed) return null
          const hit = skillOf(h.state, f, 'counterAttack')
          if (!hit) return null
          markFired('counterAttack')
          return { delta: d.failed * numParam(hit.params, 'perFailedHit', 1), reason: 'Counter-attack' }
        },
        'skl.counterAttack',
      )
    },
  },
  { name: 'combatDisarm', params: ['grantOn', 'existingOn'] },
  { name: 'parrySkill', params: ['extraParry'] },
  { name: 'stepAside' },
  { name: 'combatMaster' },
  { name: 'fistsOfSteel', params: ['unarmedStrength', 'unarmedDamage'] },
  {
    name: 'combatVirtuoso',
    install() {
      // the listed blades gain Versatile with a reach equal to the wielder's Strength
      registerHook(
        'weapon.traits',
        (h) => {
          const d = h.data as { melee?: boolean; traits?: TraitRef[]; rangeLong?: number } | undefined
          const f = fighterOf(h.state, h.fighterId)
          if (!d?.melee || !d.traits || !f || !h.state || !h.weaponId) return null
          const hit = skillOf(h.state, f, 'combatVirtuoso')
          const list = hit?.params.weapons
          if (!hit || !Array.isArray(list) || !list.includes(h.weaponId)) return null
          if (d.traits.some((t) => t.trait === T.versatile)) return null
          d.traits.push({ trait: T.versatile })
          d.rangeLong = stat(h.state, f.id, 'S')
          markFired('combatVirtuoso')
          return null
        },
        'skl.combatVirtuoso',
      )
    },
  },
  { name: 'bulgingBiceps', params: ['unwieldyMeleeHands'] },
  { name: 'impetuous', params: ['consolidateInches'] },
  { name: 'fearsome' },
  { name: 'headbutt', params: ['strengthBonus', 'damage', 'fumbleDamage'] },
  { name: 'hurl', params: ['strength'] },
  { name: 'overseer', params: ['radius', 'targetActions'] },
  {
    name: 'immovableStance',
    params: ['saveBonus'],
    install() {
      // +2 to saves (the 2+ floor is in wargear.armourSave) and cannot be Pinned; cannot be shifted (movement.knockbackPush, hurl.ts)
      registerHook(
        'save.mods',
        (h) => {
          const f = fighterOf(h.state, h.fighterId)
          if (!f || !h.state || !isImmovable(h.state, f)) return null
          markFired('immovableStance')
          return { delta: numParam(skillOf(h.state, f, 'immovableStance')?.params ?? {}, 'saveBonus', 2), reason: 'Immovable Stance' }
        },
        'skl.immovableStance.save',
      )
      registerHook(
        'pin.allowed',
        (h) => {
          const f = fighterOf(h.state, h.fighterId)
          if (!f || !h.state || !isImmovable(h.state, f)) return null
          markFired('immovableStance')
          return { allow: false, reason: 'Immovable Stance' }
        },
        'skl.immovableStance.pin',
      )
    },
  },
  { name: 'naaargah', params: ['extraActions'] },
  { name: 'unleashTheBeast' },
  { name: 'somersault', params: ['range', 'minEnemyDistance'] },
  { name: 'acrobatic', params: ['crossHeight'] },
  { name: 'hitAndRun' },
  { name: 'lightningReflexes' },
  {
    name: 'regroup',
    params: ['radius'],
    install() {
      // a fighter still Active when its activation ends may pass a Leadership test to rally every Broken friend within the radius
      // (a test that can only help, so it is taken automatically)
      registerHook(
        'activation.end',
        (h) => {
          const ctx = h.engine
          if (!ctx || !h.fighterId) return null
          const f = getFighter(ctx.state, h.fighterId)
          const hit = skillOf(ctx.state, f, 'regroup')
          if (!hit) return null
          refreshEngagement(ctx)
          if (f.location !== 'board' || f.posture !== 'standing' || f.engagedWith.length > 0 || isBroken(f)) return null
          const radius = numParam(hit.params, 'radius', constants(ctx.state).radii.groupActivation)
          const broken = friendsOf(ctx.state, f).filter((g) => g.location === 'board' && isBroken(g) && withinPath(ctx.state, f, g, radius))
          if (broken.length === 0) return null
          const res = mentalTest(ctx, f, 'Ld', 'regroup')
          if (!res.passed) return null
          markFired('regroup')
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'regroup', detail: `${broken.length}` }, f.seat)
          for (const g of broken) clearCondition(ctx, g, 'broken', 'regroup')
          return null
        },
        'skl.regroup',
      )
    },
  },
  { name: 'commandingPresence', params: ['groupActivation'] },
]

for (const d of DEFS) {
  const def: CodeHookDef = {
    name: d.name,
    kind: 'skill',
    params: numericParams(d.name, d.params ?? []),
    install: d.install ?? (() => {}),
  }
  registerCodeHook(def)
}

/** The names of the code hooks this module registers. */
export const COMBAT_SKILL_HOOKS: readonly string[] = DEFS.map((d) => d.name)

installCodeHooks(COMBAT_SKILL_HOOKS)
