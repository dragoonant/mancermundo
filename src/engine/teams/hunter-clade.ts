// Hunter Clade (docs/spec/13-teams.md section 9, rule ids T-HC.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its ploy rules (ploy-rules.ts) and its hook handlers (hooks.ts
// registerHook). The doctrine system is the spine: the team's Imperative (config.doctrine, set by the free DOCTRINA
// gambit), a per-operative override token (COMMAND OVERRIDE) and an Omnissiah token each give an operative a mode; every
// Optimisation and Deprecation reads that mode. The oval base of the arquebus Gunner needs no code here (footprint.ts,
// datacard `ovalBase`); Targeting Protocol reads `movedThisActivation`, which already counts a turn in place.

import { applyAplEffect, hasRule, parseRules, pushRolled, reclassify, ruleKey } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { allowedOrders } from '../abilities'
import { hasAbility, hasKeyword, inEnemyCr, nearestEnemyDistance } from '../conditions'
import { addEffect, directDamage, markUsedBattle, markUsedTp, regainWounds, usedThisBattle, usedThisTp } from '../effects'
import { cancelAction, finishAction, joinActivation, startFreeAction } from '../firefight'
import { circleOverlapsPolygon } from '../geometry'
import { discCentres, footprintOf } from '../footprint'
import { registerFrameResume, registerHook } from '../hooks'
import { baseUnderVantage, bodyOf, targetVerdict, visible } from '../los'
import { controlledBy } from '../markers'
import { isWithin, markerInControlRange } from '../measure'
import { registerPloyRule, type PloyOffer } from '../ploy-rules'
import type { Ctx } from '../registry'
import { activeOps, enemiesOf, hasInjuredPenalty, otherSeat } from '../state'
import { resumeGambit } from '../strategy'
import { providerAny, registerTeamRules } from '../team-rules'
import { addToken, removeToken, tokensOn } from '../tokens'
import type { AttackState, DiceSide, GameState, Operative, OperativeToken, Order, Seat, WeaponRuleRef } from '../types'
export const TEAM_ID = 'hunter-clade'
const HC = 'HUNTER CLADE'
const EPS = 1e-6

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const A = {
  destruction: 'hc.a.canticle-of-destruction',
  stalker: 'hc.a.wasteland-stalker',
  shroud: 'hc.a.canticle-of-shroudpsalm',
  protocol: 'hc.a.control-protocol',
  elimination: 'hc.a.canticle-of-elimination',
  targeting: 'hc.a.targeting-protocol',
  glow: 'hc.a.canticle-of-the-glow',
  rad: 'hc.a.rad-saturation',
} as const

export const P = {
  doctrina: 'hc.p.doctrina',
  debilitating: 'hc.p.debilitating-irradiation',
  neurostatic: 'hc.p.neurostatic-interference',
  scouting: 'hc.p.scouting-protocol',
  accelerant: 'hc.p.accelerant-agents',
  radBombardment: 'hc.p.rad-bombardment',
  edict: 'hc.p.control-edict',
  scrapcode: 'hc.p.scrapcode-overload',
  override: 'hc.p.command-override',
  omnissiah: 'hc.p.omnissiahs-imperative',
} as const

export const E = {
  rad: 'hc.e.rad-bombardment',
  redundancy: 'hc.e.redundancy-systems',
  refractor: 'hc.e.refractor-field',
  mindLink: 'hc.e.extremis-mind-link',
} as const

/** Token kinds (tokens.ts). */
export const T = { spot: 'hc.spot', doctrine: 'hc.doctrine', omnissiah: 'hc.omnissiah' } as const

/** ActiveEffect kinds. */
const FX = {
  ignore: 'hc.ignore',
  edict: 'hc.edict',
  scrapcode: 'hc.scrapcode',
  destruction: 'hc.cod',
  refractor: 'hc.refractor',
  flag: 'ployFlag',
} as const

const IGNORE_USED = 'hc.primary-ignore'
const MIND_LINK_USED = 'hc.mind-link'
const RAD_USED = 'hc.rad-bombardment'
const PRIMARY_MODE = 'primary-mode'

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they apply.
for (const name of ['hcCanticleDestruction', 'hcWastelandStalker', 'hcShroudpsalm', 'hcControlProtocol', 'hcElimination', 'hcTargeting', 'hcGlow', 'hcRadSaturation', 'hcImperative', 'hcRedundancy', 'hcRefractor', 'hcMindLink']) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isHc(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, HC)
}

function live(o: Operative): boolean {
  return o.status === 'active' && o.wounds > 0
}

function hcOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isHc(state, o))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return isWithin(bodyOf(a), bodyOf(b), inches)
}

function sees(state: GameState, a: Operative, b: Operative): boolean {
  return visible(state, bodyOf(a), bodyOf(b))
}

function byId(a: Operative, b: Operative): number {
  return a.id < b.id ? -1 : 1
}

/**
 * Comms Device (M-5.1): while this operative controls its own team's Comms Device marker, the distances in its SUPPORT
 * rules that name friendly operatives are 3" longer (SIGNAL 6" to 9", SPOT's 3" to 6").
 */
export function commsReach(state: GameState, op: Operative): number {
  if (controlledBy(state, op, (m) => m.equipmentId === 'core.e.comms-device' && m.owner === op.seat).length === 0) return 0
  markFired('commsDevice')
  return 3
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function rangedWeapon(state: GameState, weaponId: string | undefined | null): boolean {
  return !!weaponId && state.data.weapons[weaponId]?.type === 'ranged'
}

function meleeWeapon(state: GameState, weaponId: string | undefined | null): boolean {
  return !!weaponId && state.data.weapons[weaponId]?.type === 'melee'
}

// ---------------------------------------------------------------------------
// Imperatives (T-HC.21 to T-HC.27)
// ---------------------------------------------------------------------------

export type Mode = 'protector' | 'conqueror' | 'bulwark' | 'aggressor' | 'neutral'
export const MODES: readonly Mode[] = ['protector', 'conqueror', 'bulwark', 'aggressor', 'neutral']

function asMode(v: unknown): Mode | null {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v) ? (v as Mode) : null
}

/** The Primary Mode picked with the roster (team choice `primary-mode`). */
export function primaryMode(state: GameState, seat: Seat): Mode | null {
  const id = state.config[seat].choices[PRIMARY_MODE]
  return id ? asMode(id.slice('hc.a.imp-'.length)) : null
}

/** The Imperative the team adopted this turning point with the DOCTRINA gambit (reset when the turning point ends). */
export function teamMode(state: GameState, seat: Seat): Mode | null {
  return asMode(state.config[seat].doctrine)
}

function tokenOf(state: GameState, op: Operative, kind: string): OperativeToken | undefined {
  return tokensOn(state, op.id).find((t) => t.kind === kind && t.owner === op.seat && t.count > 0)
}

/** COMMAND OVERRIDE's Imperative for this operative, if it has one. */
export function overrideMode(state: GameState, op: Operative): Mode | null {
  return asMode(tokenOf(state, op, T.doctrine)?.data?.mode)
}

/** OMNISSIAH'S IMPERATIVE's extra rule for this operative: the Imperative it was used under. */
export function omnissiahMode(state: GameState, op: Operative): Mode | null {
  return asMode(tokenOf(state, op, T.omnissiah)?.data?.mode)
}

/**
 * The operative's current Imperative and whether its Deprecation applies. An override always keeps its Deprecation; the
 * team's Imperative loses it only for the turning point the Primary Mode was adopted with the ignore.
 */
export function modeOf(state: GameState, op: Operative): { mode: Mode; deprecated: boolean } | null {
  if (!isHc(state, op)) return null
  const o = overrideMode(state, op)
  if (o) return { mode: o, deprecated: true }
  const m = teamMode(state, op.seat)
  if (!m) return null
  return { mode: m, deprecated: !state.effects.some((e) => e.kind === FX.ignore && e.seat === op.seat) }
}

function injuredAlready(state: GameState, op: Operative): boolean {
  return hasInjuredPenalty(op) || providerAny(state, op, 'injuredEquivalent')
}

// ---------------------------------------------------------------------------
// Rad-Saturation (T-HC.17) and the Canticles
// ---------------------------------------------------------------------------

/** Friendly Vanguards (of another seat) within 2" of the operative: it is under Rad-Saturation. */
export function radSources(state: GameState, op: Operative): Operative[] {
  return activeOps(state).filter((v) => v.seat !== op.seat && live(v) && isHc(state, v) && hasAbility(state, v, A.rad) && within(v, op, 2))
}

export function radSaturated(state: GameState, op: Operative): boolean {
  return radSources(state, op).length > 0
}

function glowNear(state: GameState, op: Operative): boolean {
  return activeOps(state).some((v) => v.seat !== op.seat && live(v) && isHc(state, v) && hasAbility(state, v, A.glow) && within(v, op, 3))
}

/** A live friendly operative with the ability (the bearer itself counts) within `inches` of `op`. */
function bearerNear(state: GameState, op: Operative, abilityId: string, inches: number): boolean {
  return activeOps(state).some((o) => o.seat === op.seat && live(o) && hasAbility(state, o, abilityId) && (o.id === op.id || within(o, op, inches)))
}

/**
 * Targeting Protocol (T-HC.15): has the operative not moved this activation? A counteraction and a Guard interrupt always
 * qualify; any movement (a turn in place of an oval base included) counts as having moved.
 */
export function stationary(state: GameState, op: Operative): boolean {
  const act = state.firefight.activation
  if (!act || act.operativeId !== op.id) return true
  if (act.counteract || act.frame?.kind === 'interrupt') return true
  const under = act.frame ? (state.firefight.stack ?? []).at(-1) : null
  const own = under && under.operativeId === op.id ? under : act
  const moved = own.performed.some((a) => ['reposition', 'dash', 'fallBack', 'charge'].includes(a))
  return !moved && (op.movedThisActivation ?? 0) <= EPS
}

// ---------------------------------------------------------------------------
// Team rule provider: Move, Wasteland Stalker, Neurostatic, Accelerant, Scrapcode, Control Edict, Omnissiah
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  /** Aggressor (+1") and the Bulwark Deprecation (-1"); the floor of 4" is effectiveMove's. */
  moveDelta(state, op) {
    const m = modeOf(state, op)
    if (!m) return 0
    if (m.mode === 'aggressor') {
      markFired('hcImperative')
      return 1
    }
    if (m.mode === 'bulwark' && m.deprecated) {
      markFired('hcImperative')
      return -1
    }
    return 0
  },

  /** Wasteland Stalker: one more cover save. Not on top of Vantage's improved cover save: the core adds no
   * Stealthy-style improvement once the defender took the Vantage one (handlers.vantageImprovementTaken). */
  stealthyCover(state, op) {
    if (!isHc(state, op) || !hasAbility(state, op, A.stalker)) return 0
    markFired('hcWastelandStalker')
    return 1
  },

  /** NEUROSTATIC INTERFERENCE: no attack die of an enemy within 6" of a friendly Infiltrator can be re-rolled. */
  rerollsBanned(state, side: DiceSide, attack: AttackState) {
    if (attack.kind === 'shoot' && side.operativeId !== attack.operativeId) return false
    const op = state.operatives[side.operativeId]
    if (!op) return false
    for (const fx of state.effects) {
      if (fx.source !== P.neurostatic || fx.seat === op.seat) continue
      const near = activeOps(state).some((o) => o.seat === fx.seat && live(o) && isHc(state, o) && hasKeyword(state, o, 'INFILTRATOR') && within(o, op, 6))
      if (near) {
        markFired('hcNeurostatic')
        return true
      }
    }
    return false
  },

  /** ACCELERANT AGENTS: a Ruststalker may Fight twice. */
  maxRepeats(state, op, actionId, performed) {
    if (actionId !== 'fight' || !accelerated(state, op)) return null
    if (performed.filter((a) => a === 'fight').length >= 1) markFired('hcAccelerant')
    return 2
  },

  /** ... and one of the two Fights is free: the second. */
  actionCostDelta(state, op, actionId) {
    if (actionId !== 'fight' || !accelerated(state, op)) return 0
    const act = state.firefight.activation
    if (!act || act.operativeId !== op.id || act.counteract) return 0
    return act.performed.filter((a) => a === 'fight').length >= 1 ? -1 : 0
  },

  /** SCRAPCODE OVERLOAD: the enemy's contesting APL total is 1 lower near the Infiltrator. */
  controlTotal(state, seat, _marker, total, contesting) {
    let v = total
    for (const fx of state.effects) {
      if (fx.kind !== FX.scrapcode || fx.seat === seat || !fx.operativeId) continue
      const inf = state.operatives[fx.operativeId]
      if (!inf || !live(inf)) continue
      const near = contesting.some((id) => {
        const c = state.operatives[id]
        return !!c && within(inf, c, 3)
      })
      if (!near) continue
      markFired('hcScrapcode')
      v = Math.max(0, v - 1)
    }
    return v === total ? null : v
  },

  /** CONTROL EDICT: after the first operative is expended, the partner activates before the opponent does. */
  chainActivation(state, expended, wasChained) {
    if (wasChained) return null
    const fx = state.effects.find((e) => e.kind === FX.edict && e.operativeId === expended.id && e.data?.joint !== true)
    const partner = fx?.data?.partnerId
    if (typeof partner !== 'string') return null
    markFired('hcControlEdict')
    return [partner]
  },

  /** OMNISSIAH'S IMPERATIVE, Conqueror: after its first resolved die, a fighter resolves another at once. */
  afterFightResolution(state, attack, seat) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const op = state.operatives[attack.operativeId]
    if (!op || op.seat !== seat || !isHc(state, op)) return null
    const t = tokenOf(state, op, T.omnissiah)
    if (!t || t.data?.mode !== 'conqueror') return null
    const key = state.firefight.activation?.declaredSeq ?? -1
    if (t.data.usedFor === key) return null
    t.data = { ...t.data, usedFor: key }
    markFired('hcOmnissiah')
    return [{ seat }]
  },

  /** OMNISSIAH'S IMPERATIVE, Aggressor: ignore the first 2" of vertical distance climbing up. */
  moveSurcharge(state, op, _kind, _points, breakdown) {
    if (omnissiahMode(state, op) !== 'aggressor' || breakdown.climb <= 0) return 0
    markFired('hcOmnissiah')
    return -Math.min(2, breakdown.climb)
  },
})

function accelerated(state: GameState, op: Operative): boolean {
  return isHc(state, op) && hasKeyword(state, op, 'RUSTSTALKER') && ployActive(state, op.seat, P.accelerant)
}

// ---------------------------------------------------------------------------
// Weapon rules: Punishing, Lethal 5+, Ceaseless, Severe, Seek Light, Refractor Field
// ---------------------------------------------------------------------------

function lowestLethal(rules: WeaponRuleRef[]): number | null {
  let best: number | null = null
  for (const r of rules) if (ruleKey(r.rule) === 'lethal') best = best === null ? (r.target ?? 6) : Math.min(best, r.target ?? 6)
  return best
}

/** Replace the contents of the live rules array the engine reads back from the hook data. */
function setRules(rules: WeaponRuleRef[], next: WeaponRuleRef[]): void {
  rules.splice(0, rules.length, ...next)
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !op) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const weaponId = c.weaponId
    const add = (rule: WeaponRuleRef): void => {
      if (!hasRule(rules, ruleKey(rule.rule))) rules.push(rule)
    }
    const ranged = rangedWeapon(state, weaponId)
    // REFRACTOR FIELD: the attack against the bearer has its Piercing x lowered by 1 for the sequence
    if (data.targetId && state.effects.some((e) => e.kind === FX.refractor && e.operativeId === data.targetId)) {
      setRules(
        rules,
        rules.flatMap((r): WeaponRuleRef[] => {
          if (ruleKey(r.rule) !== 'piercing') return [r]
          markFired('hcRefractor')
          const x = (r.x ?? 1) - 1
          return x > 0 ? [{ ...r, x }] : []
        }),
      )
    }
    if (!isHc(state, op)) return null
    // Canticle of Elimination: Punishing on a Ranger's ranged weapons near the Ranger Alpha
    if (ranged && hasKeyword(state, op, 'RANGER') && bearerNear(state, op, A.elimination, 3)) {
      add({ rule: 'core.wr.punishing' })
      markFired('hcElimination')
    }
    // Targeting Protocol: Lethal 5+ on the datacard's ranged weapons while stationary (or counteracting)
    if (ranged && data.kind === 'shoot' && hasAbility(state, op, A.targeting) && weaponId && op.weapons.includes(weaponId) && stationary(state, op)) {
      const have = lowestLethal(rules)
      if (have === null || have > 5) {
        setRules(rules, [...rules.filter((r) => ruleKey(r.rule) !== 'lethal'), { rule: 'core.wr.lethal', target: 5 }])
        markFired('hcTargeting')
      }
    }
    // Imperative Optimisations
    const m = modeOf(state, op)
    if (m?.mode === 'protector' && ranged) {
      add({ rule: 'core.wr.ceaseless' })
      markFired('hcImperative')
    }
    if (m?.mode === 'conqueror' && meleeWeapon(state, weaponId)) {
      add({ rule: 'core.wr.ceaseless' })
      markFired('hcImperative')
    }
    // OMNISSIAH'S IMPERATIVE, Protector: Severe on ranged weapons
    if (ranged && omnissiahMode(state, op) === 'protector') {
      add({ rule: 'core.wr.severe' })
      markFired('hcOmnissiah')
    }
    // SPOT: Seek Light for a friendly shooter near the Surveyor that marked the target
    if (ranged && data.targetId && spotted(state, op, data.targetId)) {
      add({ rule: 'core.wr.seek-light' })
      markFired('hcSpot')
    }
    return null
  },
  'hc.modifyWeaponRules',
)

/** Is `targetId` marked by a SPOT whose Surveyor is alive and within 3" of the shooter? */
export function spotted(state: GameState, shooter: Operative, targetId: string): boolean {
  if (!isHc(state, shooter)) return false
  const t = tokenOf2(state, targetId, T.spot, shooter.seat)
  if (!t?.sourceId) return false
  const src = state.operatives[t.sourceId]
  if (!src || !live(src) || src.seat !== shooter.seat) return false
  return src.id === shooter.id || within(src, shooter, 3 + commsReach(state, src))
}

function tokenOf2(state: GameState, opId: string, kind: string, owner: Seat): OperativeToken | undefined {
  return tokensOn(state, opId).find((t) => t.kind === kind && t.owner === owner && t.count > 0)
}

// ---------------------------------------------------------------------------
// Attack pool: Rad-Saturation, Canticle of the Glow, Hit Deprecations
// ---------------------------------------------------------------------------

registerHook(
  'modifyAttackDice',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !op) return null
    const data = c.data as { weaponId: string; atk: number; hitDelta: number }
    const w = state.data.weapons[data.weaponId]
    if (!w) return null
    const injured = injuredAlready(state, op)
    if (radSaturated(state, op)) {
      if (!injured) data.hitDelta += 1
      markFired('hcRadSaturation')
      if (glowNear(state, op)) {
        data.atk -= 1
        markFired('hcGlow')
      }
    }
    const m = modeOf(state, op)
    if (m && m.deprecated && !injured) {
      if ((m.mode === 'protector' && w.type === 'melee') || (m.mode === 'conqueror' && w.type === 'ranged')) {
        data.hitDelta += 1
        markFired('hcImperative')
      }
    }
    return null
  },
  'hc.modifyAttackDice',
)

// ---------------------------------------------------------------------------
// Defence pool: Aggressor Deprecation, Omnissiah Bulwark
// ---------------------------------------------------------------------------

registerHook(
  'modifyDefenceDice',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !op || !isHc(state, op)) return null
    const data = c.data as { dice: number; saveDelta: number }
    const m = modeOf(state, op)
    if (m?.mode === 'aggressor' && m.deprecated) {
      data.saveDelta += 1
      markFired('hcImperative')
    }
    if (omnissiahMode(state, op) === 'bulwark') {
      data.saveDelta -= 1
      data.dice += 1
      markFired('hcOmnissiah')
    }
    return null
  },
  'hc.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// Damage: DEBILITATING IRRADIATION, then the Bulwark Optimisation (T-HC.25 reads Dmg after stat changes)
// ---------------------------------------------------------------------------

registerHook(
  'modifyDamage',
  (c) => {
    const state = c.state
    const attacker = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const target = state && c.targetId ? state.operatives[c.targetId] : undefined
    if (!state || !attacker || !target || !isHc(state, target) || attacker.seat === target.seat) return null
    const data = c.data as { dmg: { normal: number; crit: number } }
    if (hasKeyword(state, target, 'VANGUARD') && ployActive(state, target.seat, P.debilitating) && data.dmg.normal > 3 && radSaturated(state, attacker)) {
      data.dmg.normal = Math.max(3, data.dmg.normal - 1)
      markFired('hcDebilitating')
    }
    if (modeOf(state, target)?.mode === 'bulwark' && data.dmg.normal >= 3) {
      data.dmg.normal -= 1
      markFired('hcImperative')
    }
    return null
  },
  'hc.modifyDamage',
)

// ---------------------------------------------------------------------------
// Canticle of Destruction (T-HC.10): the first crit strike of a Ruststalker's fight deals 1 more
// ---------------------------------------------------------------------------

registerHook(
  'beforeStrike',
  (c) => {
    const state = c.state
    const ctx = c.engine
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const attack = state?.attack
    if (!state || !ctx || !op || !attack || attack.kind !== 'fight' || attack.operativeId !== op.id) return null
    const data = c.data as { die: string; amount: number }
    if (data.die !== 'crit' || !isHc(state, op) || !hasKeyword(state, op, 'RUSTSTALKER')) return null
    if (state.effects.some((e) => e.kind === FX.destruction && e.operativeId === op.id)) return null
    if (!bearerNear(state, op, A.destruction, 3)) return null
    addEffect(ctx, { source: A.destruction, seat: op.seat, kind: FX.destruction, operativeId: op.id, expires: 'action' })
    data.amount += 1
    markFired('hcCanticleDestruction')
    return null
  },
  'hc.beforeStrike',
)

// ---------------------------------------------------------------------------
// Canticle of Shroudpsalm (T-HC.12) and SPOT's "cannot be obscured"
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const state = c.state
    const shooter = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !shooter) return null
    const data = c.data as { candidates: string[] }
    const keep = data.candidates.filter((id) => {
      const t = state.operatives[id]
      if (!t || t.seat === shooter.seat || !isHc(state, t) || !hasKeyword(state, t, 'INFILTRATOR') || t.order !== 'conceal') return true
      if (!bearerNear(state, t, A.shroud, 3) || within(shooter, t, 2)) return true
      // "in cover" before Seek and Vantage get to deny it: the terrain verdict from the shooter's side
      if (!inCoverFrom(state, shooter, t)) return true
      markFired('hcShroudpsalm')
      return false
    })
    data.candidates.splice(0, data.candidates.length, ...keep)
    return null
  },
  'hc.beforeShootTargetSelect',
)


function inCoverFrom(state: GameState, shooter: Operative, target: Operative): boolean {
  return targetVerdict(state, bodyOf(shooter), { ...bodyOf(target), order: target.order }).inCover
}

registerHook(
  'target.status',
  (c) => {
    const state = c.state
    const shooter = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !shooter || !c.targetId || !spotted(state, shooter, c.targetId)) return null
    ;(c.data as { obscured: boolean }).obscured = false
    markFired('hcSpot')
    return null
  },
  'hc.target.status',
)

// ---------------------------------------------------------------------------
// Unique actions: SIGNAL (T-HC.18) and SPOT (T-HC.19)
// ---------------------------------------------------------------------------

/** Other friendly Hunter Clade operatives visible to and within 6" of the Diktat (9" while it controls a Comms Device). */
export function signalTargets(state: GameState, op: Operative): Operative[] {
  return hcOps(state, op.seat)
    .filter((f) => f.id !== op.id && within(op, f, 6 + commsReach(state, op)) && sees(state, op, f))
    .sort(byId)
}

registerCodeHook({
  name: 'hcSignal',
  action: {
    offers(state, op): OfferSeed[] {
      return signalTargets(state, op).map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!t || !live(t) || t.seat !== op.seat || t.id === op.id) {
        cancelAction(ctx)
        return
      }
      applyAplEffect(ctx, t.id, 1, 'hc.signal')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'hcSpot',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => live(e) && sees(state, op, e))
        .sort(byId)
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!t || !live(t) || t.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      addToken(ctx, t.id, { kind: T.spot, owner: op.seat, cap: 1, sourceId: op.id, expires: ['turningPointEnd', 'sourceIncapacitated'] }, 'hc.spot')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategic gambits: DOCTRINA (T-HC.22), the flag ploys, SCOUTING PROTOCOL, RAD BOMBARDMENT
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'hcDoctrina',
  ploy: {
    // the Primary Mode first (the plain pick, then with its Deprecation ignored while that is still unused), then the rest
    offers(state, seat): PloyOfferSeed[] {
      const prim = primaryMode(state, seat)
      const out: PloyOfferSeed[] = []
      if (prim) {
        out.push({ param: prim })
        if (prim !== 'neutral' && !usedThisBattle(state, seat, IGNORE_USED)) out.push({ param: `${prim}:ignore` })
      }
      for (const m of MODES) if (m !== prim) out.push({ param: m })
      return out
    },
    apply(ctx, seat, ploy, seed) {
      const [mode, flag] = (seed.param ?? '').split(':')
      const m = asMode(mode)
      if (!m) return
      ctx.state.config[seat].doctrine = m
      if (flag === 'ignore') {
        markUsedBattle(ctx.state, seat, IGNORE_USED)
        addEffect(ctx, { source: ploy.id, seat, kind: FX.ignore, expires: 'turningPoint', data: { mode: m } })
      }
    },
  },
})

function flagPloy(name: string): void {
  registerCodeHook({
    name,
    ploy: {
      offers(): PloyOfferSeed[] {
        return [{}]
      },
      apply(ctx, seat, ploy) {
        addEffect(ctx, { source: ploy.id, seat, kind: FX.flag, expires: 'turningPoint' })
      },
    },
  })
}
flagPloy('hcDebilitating')
flagPloy('hcNeurostatic')
flagPloy('hcAccelerant')

const choiceOpt = (id: string, labelKey: string, data?: Record<string, unknown>) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, ...(data ? { data } : {}) })

/** Rangers SCOUTING PROTOCOL sends dashing: Conceal and more than 6" from every enemy. */
export function scoutingQueue(state: GameState, seat: Seat): string[] {
  return hcOps(state, seat)
    .filter((o) => hasKeyword(state, o, 'RANGER') && o.order === 'conceal' && !inEnemyCr(state, o) && nearestEnemyDistance(state, o) > 6 + EPS)
    .map((o) => o.id)
    .sort()
}

registerCodeHook({
  name: 'hcScouting',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return scoutingQueue(state, seat).length > 0 ? [{}] : []
    },
    apply(ctx, seat) {
      // the eligible Rangers are fixed when the ploy is used; the player then picks who dashes next (or stops)
      scoutingNext(ctx, seat, scoutingQueue(ctx.state, seat))
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const remaining = ((context.remaining as string[] | undefined) ?? []).filter((id) => id !== option)
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    if (!startFreeAction(ctx, { operativeId: option, action: 'dash', resume: 'hc.scouting', data: { seat, remaining } })) scoutingNext(ctx, seat, remaining)
  },
})

function scoutingNext(ctx: Ctx, seat: Seat, remaining: string[]): void {
  const s = ctx.state
  const live2 = remaining.filter((id) => {
    const o = s.operatives[id]
    return !!o && o.status === 'active' && !inEnemyCr(s, o)
  })
  if (live2.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'hcScouting', operativeId: live2[0], seat, remaining: live2 },
    options: [...live2.map((id) => choiceOpt(id, 'hc.scouting.dash', { name: s.operatives[id]!.name })), choiceOpt('done', 'hc.scouting.done')],
  })
}

registerFrameResume('hc.scouting', (ctx, _outcome, data) => scoutingNext(ctx, data.seat as Seat, (data.remaining as string[] | undefined) ?? []))

// RAD BOMBARDMENT (T-HC.36): the equipment unlocks this strategic gambit once per battle, from the second turning point.

/** Enemy operatives a RAD BOMBARDMENT at `target` (`marker:<id>` or `zone`) reaches, in id order. */
export function bombardmentVictims(state: GameState, seat: Seat, target: string): Operative[] {
  const foes = activeOps(state).filter((o) => o.seat !== seat && live(o))
  if (target === 'zone') {
    const zone = state.map.dropZones.find((z) => z.id === state.players[otherSeat(seat)].dropZoneId)
    if (!zone) return []
    return foes.filter((o) => discCentres(footprintOf(o)).some((p) => circleOverlapsPolygon(p, o.baseRadius, zone.polygon))).sort(byId)
  }
  const marker = state.markers.find((m) => m.id === target.slice('marker:'.length))
  if (!marker) return []
  return foes.filter((o) => markerInControlRange(state, bodyOf(o), marker)).sort(byId)
}

registerCodeHook({
  name: 'hcRadBombardment',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (!state.players[seat].equipment.includes(E.rad) || usedThisBattle(state, seat, RAD_USED) || state.turningPoint < 2) return []
      const targets = [...state.markers.filter((m) => m.kind === 'objective').map((m) => `marker:${m.id}`), 'zone']
      return targets.filter((t) => bombardmentVictims(state, seat, t).length > 0).map((param) => ({ param }))
    },
    apply(ctx, seat, _ploy, seed) {
      markUsedBattle(ctx.state, seat, RAD_USED)
      for (const v of bombardmentVictims(ctx.state, seat, seed.param ?? '')) {
        if (!live(v)) continue
        const [roll] = ctx.roll('hc.rad.bombardment', 1)
        const result = roll! - (baseUnderVantage(ctx.state, bodyOf(v)) ? 1 : 0)
        if (result < 4) continue
        applyAplEffect(ctx, v.id, -1, 'hc.rad-bombardment')
        if (result >= 6) {
          const [d] = ctx.roll('hc.rad.bombardment.damage', 1)
          directDamage(ctx, v.id, Math.ceil(d! / 2), v.id, 'hc.radBombardment')
        }
      }
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys: COMMAND OVERRIDE (T-HC.34), CONTROL EDICT (T-HC.32), SCRAPCODE OVERLOAD (T-HC.33),
// OMNISSIAH'S IMPERATIVE (T-HC.35)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'hcCommandOverride',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!isHc(state, op) || op.seat !== seat || info.counteracting) return []
      const cur = modeOf(state, op)?.mode
      return MODES.filter((m) => m !== cur).map((m) => ({ param: m, operativeId: op.id }))
    },
    apply(ctx, seat, _ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      const mode = asMode(seed.param)
      if (!id || !mode) return
      removeToken(ctx, id, T.doctrine, 'hc.override', seat)
      addToken(ctx, id, { kind: T.doctrine, owner: seat, cap: 1, expires: ['turningPointEnd'], data: { mode } }, 'hc.override')
    },
  },
})

const isSicarian = (state: GameState, o: Operative): boolean => hasKeyword(state, o, 'SICARIAN')

/** Operatives CONTROL EDICT can pair with `subject` (the one being activated), in id order. */
export function edictPartners(state: GameState, subject: Operative): Operative[] {
  const ok = (a: Operative, b: Operative): boolean => !(isSicarian(state, a) && isSicarian(state, b))
  const hc = hcOps(state, subject.seat).filter((o) => o.id !== subject.id && o.ready)
  if (hasKeyword(state, subject, 'LEADER')) return hc.filter((p) => ok(subject, p) && within(subject, p, 3) && sees(state, subject, p)).sort(byId)
  return hc.filter((l) => hasKeyword(state, l, 'LEADER') && ok(subject, l) && within(l, subject, 3) && sees(state, l, subject)).sort(byId)
}

registerCodeHook({
  name: 'hcControlEdict',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!isHc(state, op) || op.seat !== seat || info.counteracting || !state.firefight.activation || state.firefight.activation.operativeId !== op.id) return []
      const out: PloyOfferSeed[] = []
      const link = state.players[seat].equipment.includes(E.mindLink) && !usedThisBattle(state, seat, MIND_LINK_USED)
      for (const p of edictPartners(state, op)) {
        out.push({ param: p.id })
        if (link) for (const order of allowedOrders(state, p)) out.push({ param: `${p.id}:joint:${order}` })
      }
      return out
    },
    apply(ctx, seat, ploy, seed, info) {
      const [partnerId, joint, order] = (seed.param ?? '').split(':')
      const subject = info.subjectId
      if (!partnerId || !subject) return
      const joined = joint === 'joint' && joinActivation(ctx, partnerId, (order as Order | undefined) ?? 'engage')
      addEffect(ctx, { source: ploy.id, seat, kind: FX.edict, operativeId: subject, expires: 'turningPoint', data: { partnerId, joint: joined } })
    },
  },
})

/** Actions SCRAPCODE OVERLOAD answers: Pick Up Marker and mission actions, never Operate Hatch. */
function scrapcodeAction(state: GameState, action: string | undefined): boolean {
  if (!action) return false
  if (action === 'marker:pickUp') return true
  if (!action.startsWith('ability:')) return false
  const def = state.data.abilities[action.slice('ability:'.length)]
  return !!def && (def.keywords ?? []).includes('MISSION') && !/hatch/i.test(def.id)
}

registerCodeHook({
  name: 'hcScrapcode',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      // when a friendly Infiltrator is activated ...
      if (info.window === 'firefight.activationStart') {
        const op = info.subjectId ? state.operatives[info.subjectId] : undefined
        return isHc(state, op) && op.seat === seat && !info.counteracting && hasKeyword(state, op, 'INFILTRATOR') ? [{ operativeId: op.id }] : []
      }
      // ... or when that Infiltrator is about to pick up a marker or perform a mission action (its own declaration,
      // a counteraction included; the shared firefight.actionDeclared window opens for both)
      if (info.window === 'firefight.actionDeclared') {
        const op = info.subjectId ? state.operatives[info.subjectId] : undefined
        return isHc(state, op) && op.seat === seat && hasKeyword(state, op, 'INFILTRATOR') && scrapcodeAction(state, info.action) ? [{ operativeId: op.id }] : []
      }
      // ... or when an enemy within 3" of it is about to pick up a marker or perform a mission action
      const actor = info.actorId ? state.operatives[info.actorId] : undefined
      if (!actor || actor.seat === seat || !scrapcodeAction(state, info.action)) return []
      return hcOps(state, seat)
        .filter((o) => hasKeyword(state, o, 'INFILTRATOR') && within(o, actor, 3))
        .map((o) => ({ operativeId: o.id }))
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (!id) return
      addEffect(ctx, { source: ploy.id, seat, kind: FX.scrapcode, operativeId: id, expires: `startOfActivation:${id}` })
    },
  },
})

/**
 * The defender's windows of a Shoot: the end of the Roll Attack Dice step, and (the card's note allows use after defence
 * dice are rolled or re-rolled) the defender's windows on its fresh and final defence roll.
 */
const OMNISSIAH_DEFENDER = ['shoot.beforeDefenceRoll', 'shoot.defenderBeforeRerolls', 'shoot.defenceRolled']

/** OMNISSIAH'S IMPERATIVE can be used in the operative's own activation, or as the defender once the attack dice are final. */
function omnissiahUsable(state: GameState, op: Operative, window: string, info: { targetId?: string }): boolean {
  if (!isHc(state, op) || tokenOf(state, op, T.omnissiah)) return false
  const m = modeOf(state, op)
  if (!m || m.mode === 'neutral') return false
  if (OMNISSIAH_DEFENDER.includes(window)) return info.targetId === op.id
  const act = state.firefight.activation
  return !!act && act.operativeId === op.id && !act.counteract
}

registerCodeHook({
  name: 'hcOmnissiah',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      return op && op.seat === seat && omnissiahUsable(state, op, info.window, info) ? [{ operativeId: op.id }] : []
    },
    apply(ctx, seat, _ploy, seed, info) {
      const op = ctx.state.operatives[seed.operativeId ?? info.subjectId ?? '']
      if (!op) return
      const mode = modeOf(ctx.state, op)?.mode
      if (!mode || mode === 'neutral') return
      addToken(ctx, op.id, { kind: T.omnissiah, owner: seat, cap: 1, expires: ['turningPointEnd'], data: { mode } }, 'hc.omnissiah')
      if (mode === 'bulwark') bulwarkNow(ctx, op)
    },
  },
})

/** Bulwark mid-Shoot: the Save changes at once and one more defence die is rolled (T-HC.35). */
function bulwarkNow(ctx: Ctx, op: Operative): void {
  const def = ctx.state.attack?.seq?.def
  if (!def || def.operativeId !== op.id) return
  def.need = Math.max(2, def.need - 1)
  reclassify(def)
  pushRolled(def, ctx.roll('hc.omnissiah.defence', 1))
}

// ---------------------------------------------------------------------------
// Ploy rules: Control Protocol, Extremis Mind-Link, REDUNDANCY SYSTEMS, REFRACTOR FIELD
// ---------------------------------------------------------------------------

/** Control Protocol: a live friendly leader sees the operative (a leader always sees itself). */
export function leaderSees(state: GameState, seat: Seat, subject: Operative): boolean {
  return hcOps(state, seat).some((l) => hasAbility(state, l, A.protocol) && (l.id === subject.id || sees(state, l, subject)))
}

registerPloyRule({
  extraOffers(state, seat, window, info): PloyOffer[] {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    const owns = (id: string): boolean => state.players[seat].equipment.includes(id)
    // REDUNDANCY SYSTEMS: as a friendly operative is activated outside an enemy control range, once per TP
    if (window === 'firefight.activationStart' && !info.counteracting && isHc(state, subject) && subject.seat === seat && owns(E.redundancy)) {
      if (!usedThisTp(state, seat, E.redundancy) && subject.wounds < subject.maxWounds && !inEnemyCr(state, subject)) {
        out.push({ id: E.redundancy, ployId: E.redundancy, name: 'Redundancy Systems', cost: 0, via: 'hc.redundancy', seed: {}, operativeId: subject.id })
      }
    }
    // REFRACTOR FIELD: before defence dice are rolled for a friendly operative being shot with a Piercing weapon
    if (window === 'shoot.beforeDefenceRoll' && isHc(state, subject) && subject.seat === seat && info.targetId === subject.id && owns(E.refractor) && !usedThisTp(state, seat, E.refractor)) {
      if (info.weaponId && piercingOf(state, info.weaponId) > 0) {
        out.push({ id: E.refractor, ployId: E.refractor, name: 'Refractor Field', cost: 0, via: 'hc.refractor', seed: {}, operativeId: subject.id })
      }
    }
    return out
  },
  costAdjust(state, seat, ploy, seed, info) {
    if (ploy.id === P.override) {
      const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (subject && leaderSees(state, seat, subject)) return { cost: 0, via: 'hc.controlProtocol' }
    }
    if (ploy.id === P.edict && seed.param?.includes(':joint')) return { cost: 0, via: 'hc.mindLink' }
    return null
  },
  onUsed(ctx, seat, offer, info) {
    switch (offer.via) {
      case 'hc.controlProtocol':
        markFired('hcControlProtocol')
        break
      case 'hc.mindLink':
        markUsedBattle(ctx.state, seat, MIND_LINK_USED)
        markFired('hcMindLink')
        break
      case 'hc.redundancy': {
        markUsedTp(ctx.state, seat, E.redundancy)
        const id = offer.operativeId ?? info.subjectId
        if (id) {
          const [r] = ctx.roll('hc.redundancy', 1)
          regainWounds(ctx, id, Math.ceil(r! / 2) + 2, E.redundancy)
        }
        markFired('hcRedundancy')
        break
      }
      case 'hc.refractor': {
        markUsedTp(ctx.state, seat, E.refractor)
        const id = offer.operativeId ?? info.subjectId
        if (id) addEffect(ctx, { source: E.refractor, seat, kind: FX.refractor, operativeId: id, expires: 'action' })
        markFired('hcRefractor')
        break
      }
    }
  },
})

/** The Piercing x (plain plus Crits variant) the attacker's weapon carries against the target now. */
function piercingOf(state: GameState, weaponId: string): number {
  const w = state.data.weapons[weaponId]
  if (!w) return 0
  const set = parseRules(w.rules)
  return set.piercing + set.piercingCrits
}

