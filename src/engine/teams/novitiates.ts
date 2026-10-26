// Novitiates (docs/spec/13-teams.md section 12, rule ids T-NV.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts), its hook handlers (hooks.ts) and its ploy rules (ploy-rules.ts).
//
// Map of the rules to the code below:
//  - Faith points (T-NV.29): the pool kind `nv.faith` (pools.ts), gained in the Ready step (turningPoint.start) and from the
//    kill rules (damage.inflicted, action.ended, Raise Icon, Glorious Martyrdom).
//  - ACTS OF FAITH (T-NV.30 to T-NV.33), Icon of Faith, Auto-chastisers, Sanctified Rounds: 0 CP pseudo ploys
//    (registerPloyRule extraOffers / onUsed) in the roll windows. The per-sequence ledger lives in
//    `state.attack.seq.choices` (`nv.acts.<seat>`, `nv.spent.<seat>`, `nv.mf.<seat>`), so every Blast or Torrent target
//    starts clean. Militant Faith refunds from damage.inflicted, Blessed Rejuvenation heals from action.ended.
//  - Null Rod (T-NV.8 to T-NV.11): providers psychicBlocked / psychicImmune, onDamageInflicted, modifyWeaponRules, modifyDamage.
//  - Weapon rules: Anti-PSYKER (modifyDamage + modifyWeaponRules), Riposte (afterBlock), Zealous Rage, Glorious Hymnal,
//    Ardent Vengeance, Guided by Faith, Sanctified Rounds (modifyWeaponRules).
//  - Unique actions are code hooks; Whip Into Frenzy is a token plus providers; Absolution is a 0 CP offer in the
//    action-ended window that starts a free Fight; Medic! follows the Pathfinders / Hearthkyn pattern.
//  - The ploys: strategy flags read by the handlers, Righteous Advance (free Dashes), and firefight ploys with their own hooks.
import { applyAplEffect, eligibleDice, hasRule, inflict, ruleSetFor, targetInfo, validTargets, weaponDamage } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed, type PloyWindowInfo } from '../code-hooks'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, directDamage, markUsedTp, regainWounds, removeEffects, usedThisTp } from '../effects'
import { canStartFreeAction, cancelAction, finishAction, REACTION_DONE, reactionDone, startFreeAction } from '../firefight'
import { footprintDistToPolygon, footprintOf, pointGapToFootprint } from '../footprint'
import { round3 } from '../geometry'
import { registerFrameResume, registerHook, type DamageInflictedData, type HookContext } from '../hooks'
import { bodyOf, visible } from '../los'
import { contestedBy, controlledBy, newMarkerId, removeMarker } from '../markers'
import { distanceBetween, enemiesInControlRange, gapToMarker, inControlRange } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { gainPool, poolOf, spendPool } from '../pools'
import { isPsychicWeapon } from '../psychic'
import { expectedDamage } from '../query'
import type { Ctx } from '../registry'
import { activeOps, effectiveApl, enemiesOf, friendsOf, hasInjuredPenalty, isInjured, SEATS } from '../state'
import { resumeGambit } from '../strategy'
import { providerAny, providerRerollsBanned, registerTeamRules, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, removeToken } from '../tokens'
import type { Activation, AttackDie, DiceSide, GameState, Marker, Operative, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'novitiates'
/** The pool kind of the Faith points (pools.ts). */
export const FAITH = 'nv.faith'

const NV = 'NOVITIATE'
const EPS = 1e-6

const A = (id: string) => `nv.a.${id}`
const P = (id: string) => `nv.p.${id}`
const E = (id: string) => `nv.e.${id}`

export const ID = {
  guidance: A('guidance'),
  blessing: A('blessing'),
  intervention: A('intervention'),
  inspirational: A('inspirational-example'),
  unflinching: A('unflinching-example'),
  nullRod: A('null-rod'),
  stirring: A('stirring-rhetoric'),
  broadcaster: A('auto-broadcaster'),
  whip: A('whip-into-frenzy'),
  medic: A('medic'),
  tools: A('chirurgeons-tools'),
  militant: A('militant-faith'),
  absolution: A('absolution-through-destruction'),
  hymnal: A('glorious-hymnal'),
  divine: A('divine-acquisition'),
  purge: A('purge-with-flame'),
  icon: A('icon-bearer'),
  raise: A('raise-icon'),
  blaze: A('blaze-token'),
  antiPsyker: A('wr-anti-psyker'),
  riposte: A('wr-riposte'),
  zealous: A('wr-zealous-rage'),
  ardent: P('ardent-vengeance'),
  defenders: P('defenders-of-the-faith'),
  rejuvenation: P('blessed-rejuvenation'),
  advance: P('righteous-advance'),
  martyrdom: P('glorious-martyrdom'),
  inferno: P('blazing-inferno'),
  aura: P('blinding-aura'),
  guided: P('guided-by-faith'),
  iconOfFaith: E('icon-of-faith'),
  sanctified: E('sanctified-rounds'),
  chastisers: E('auto-chastisers'),
  embrocations: E('holy-embrocations'),
} as const

type ActKey = 'guidance' | 'blessing' | 'intervention'
/** Faith points each ACT OF FAITH costs (T-NV.31 to T-NV.33). */
export const ACT_COST: Record<ActKey, number> = { guidance: 1, blessing: 2, intervention: 3 }
const ACT_ID: Record<ActKey, string> = { guidance: ID.guidance, blessing: ID.blessing, intervention: ID.intervention }
const ACT_BY_ID: Record<string, ActKey> = { [ID.guidance]: 'guidance', [ID.blessing]: 'blessing', [ID.intervention]: 'intervention' }

// tokens, markers, ledger keys and effect kinds
export const WHIP = 'nv.whip'
export const BLAZE = 'nv.blaze'
const BROADCASTER = 'nv.auto-broadcaster'
const SPEND = 'nv.spend'
const AURA_FX = 'nv.aura'
const FLAMER_CRIT = 'nv.flamerCrit'
const MEDIC_FLOOR = 'nv.medicFloor'
const MEDIC_DASH = 'nv.medicDash'
const CHASTISED = 'nv.chastised'
const ICON_TP = 'nv.icon.tp'
const CHASTISE_TP = 'nv.chastisers.tp'
const DIVINE_TP = 'nv.divine.tp'
const FLAMER = 'nv.w.ministorum-flamer'
const COMMS = 'core.e.comms-device'
const ROUNDS_WEAPONS = ['autogun', 'autopistol', 'relic bolt pistol', 'relic boltgun']

// Passive rules register their name so the data may reference them; the handlers below mark them fired where they bite.
for (const name of ['nvActsOfFaith', 'nvKillFaith', 'nvNullRod', 'nvAntiPsyker', 'nvRiposte', 'nvZealousRage', 'nvMilitantFaith', 'nvGloriousHymnal', 'nvDivineAcquisition', 'nvPurgeWithFlame', 'nvIconBearer', 'nvAbsolution', 'nvIconOfFaith', 'nvSanctifiedRounds', 'nvAutoChastisers', 'nvHolyEmbrocations']) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export const isNv = (s: GameState, op: Operative | undefined): op is Operative => !!op && hasKeyword(s, op, NV)
const live = (o: Operative | undefined): o is Operative => !!o && o.status === 'active' && o.wounds > 0
const d3 = (ctx: Ctx, purpose: string): number => Math.ceil(ctx.roll(purpose, 1)[0]! / 2)

function opOfHook(c: HookContext): Operative | undefined {
  return c.state && c.operativeId ? c.state.operatives[c.operativeId] : undefined
}

/** Comms Device (M-5.1): +3" to this operative's SUPPORT distances while it controls its team's own device. */
function commsFor(s: GameState, op: Operative): number {
  if (controlledBy(s, op, (m) => m.equipmentId === COMMS && m.owner === op.seat).length === 0) return 0
  markFired('commsDevice')
  return 3
}

function teamIsNv(s: GameState, seat: Seat): boolean {
  return s.players[seat].teamId === TEAM_ID
}

function equipped(s: GameState, seat: Seat, id: string): boolean {
  return s.players[seat].equipment.includes(id)
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(s: GameState, seat: Seat, ployId: string): boolean {
  return s.effects.some((e) => e.source === ployId && e.seat === seat)
}

const gap = (a: Operative, b: Operative): number => distanceBetween(bodyOf(a), bodyOf(b))
const within = (a: Operative, b: Operative, inches: number): boolean => gap(a, b) <= inches + EPS

function effectFor(s: GameState, kind: string, opId: string) {
  return s.effects.find((e) => e.kind === kind && e.operativeId === opId)
}

function choiceOpt(id: string, labelKey: string, data: Record<string, unknown> = {}) {
  return { id, labelKey, type: 'ability.choice' as const, payload: { option: id }, data }
}

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(s: GameState): Activation | null {
  const act = s.firefight.activation
  if (!act) return null
  return act.frame ? ((s.firefight.stack ?? []).at(-1) ?? null) : act
}

/** The operative's own, non-counteract, non-frame activation in progress. */
function ownActivation(s: GameState, op: Operative): Activation | null {
  const act = s.firefight.activation
  return act && !act.frame && !act.counteract && act.operativeId === op.id ? act : null
}

function nvOps(s: GameState, seat: Seat): Operative[] {
  return activeOps(s).filter((o) => o.seat === seat && live(o) && isNv(s, o))
}

function withAbility(s: GameState, seat: Seat, abilityId: string): Operative[] {
  return nvOps(s, seat).filter((o) => hasAbility(s, o, abilityId))
}

function markersOf(s: GameState, seat: Seat, equipmentId: string): Marker[] {
  return s.markers.filter((m) => m.owner === seat && m.equipmentId === equipmentId)
}

/** The dice side an operative rolls in the sequence now open (attack dice or defence dice), or null. */
function sideOf(s: GameState, opId: string): DiceSide | null {
  const seq = s.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId && seq.atk.weaponId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

function weaponNameOf(s: GameState, weaponId: string | null | undefined): string {
  return weaponId ? (s.data.weapons[weaponId]?.name ?? '').toLowerCase() : ''
}

function ruleIndex(rules: WeaponRuleRef[], key: string): number {
  return rules.findIndex((r) => r.rule.toLowerCase().replace(/[^a-z0-9]/g, '') === key.replace(/[^a-z0-9]/g, ''))
}

// ---------------------------------------------------------------------------
// Per-sequence ledger (T-NV.30): kept in the open sequence's choices, so each Blast or Torrent target starts clean
// ---------------------------------------------------------------------------

const ACTS_KEY = (seat: Seat) => `nv.acts.${seat}`
const SPENT_KEY = (seat: Seat) => `nv.spent.${seat}`
const MF_KEY = (seat: Seat) => `nv.mf.${seat}`
const MF_DONE = (seat: Seat) => `nv.mfDone.${seat}`

function actsUsed(s: GameState, seat: Seat): ActKey[] {
  const raw = s.attack?.seq?.choices[ACTS_KEY(seat)]
  return raw ? (raw.split(',').filter(Boolean) as ActKey[]) : []
}

function faithSpentInSequence(s: GameState, seat: Seat): number {
  return Number(s.attack?.seq?.choices[SPENT_KEY(seat)] ?? 0)
}

/** Faith points a seat spent on the operative: a record for Blessed Rejuvenation and the sequence's total (Sanctified Rounds). */
function noteSpend(ctx: Ctx, seat: Seat, op: Operative, n: number): void {
  if (n <= 0) return
  const seq = ctx.state.attack?.seq
  if (seq) seq.choices[SPENT_KEY(seat)] = String(faithSpentInSequence(ctx.state, seat) + n)
  addEffect(ctx, { source: SPEND, seat, kind: SPEND, operativeId: op.id, expires: 'action', data: { n } })
}

// ---------------------------------------------------------------------------
// Faith pool: the Ready step (T-NV.29)
// ---------------------------------------------------------------------------

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    const s = ctx.state
    for (const seat of SEATS) {
      if (!teamIsNv(s, seat)) continue
      const alive = Object.values(s.operatives).filter((o) => o.seat === seat && o.status !== 'removed' && o.wounds > 0 && isNv(s, o)).length
      const gain = Math.ceil(alive / 2)
      if (gain <= 0) continue
      gainPool(ctx, seat, FAITH, gain, 'nv.ready')
      markFired('nvActsOfFaith')
    }
    return null
  },
  'nv.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

/** Active Condemnors (Null Rod) within `inches` of the operative, the Condemnor itself included. */
function condemnorNear(s: GameState, op: Operative, inches = 6): Operative | null {
  for (const o of activeOps(s)) {
    if (!live(o) || !hasAbility(s, o, ID.nullRod)) continue
    if (o.id === op.id || within(o, op, inches)) return o
  }
  return null
}

function broadcasterBans(s: GameState, side: DiceSide, attack: { kind: 'shoot' | 'fight'; operativeId: string }): boolean {
  // attack dice only: the shooter's dice in a Shoot, both fighters' dice in a Fight
  if (attack.kind === 'shoot' && side.operativeId !== attack.operativeId) return false
  const op = s.operatives[side.operativeId]
  if (!op) return false
  for (const m of s.markers) {
    if (m.equipmentId !== BROADCASTER || m.owner === null || m.owner === op.seat) continue
    if (gapToMarker(bodyOf(op), m) <= 3 + EPS) return true
  }
  return false
}

/** The reference points a Righteous Advance Dash must get closer to, fixed when the Dash starts (T-NV.37). */
interface AdvanceRefs {
  enemyId: string | null
  markerId: string | null
  zoneId: string | null
}

function advanceRefs(s: GameState, op: Operative): AdvanceRefs {
  let enemyId: string | null = null
  let best = Infinity
  for (const e of enemiesOf(s, op)) {
    if (e.wounds <= 0) continue
    const d = gap(op, e)
    if (d < best) {
      best = d
      enemyId = e.id
    }
  }
  let markerId: string | null = null
  best = Infinity
  for (const m of s.markers) {
    if (m.kind !== 'objective') continue
    const d = gapToMarker(bodyOf(op), m)
    if (d < best) {
      best = d
      markerId = m.id
    }
  }
  const foe = op.seat === 'A' ? 'B' : 'A'
  const zoneId = s.players[foe].dropZoneId
  return { enemyId, markerId, zoneId }
}

/** Does a Dash ending at `end` get strictly closer to one of the references? */
function advanceCloser(s: GameState, op: Operative, end: Vec3, refs: AdvanceRefs): boolean {
  const ghost = { ...bodyOf(op), pos: { x: end.x, y: end.y, z: end.z } }
  if (refs.enemyId) {
    const e = s.operatives[refs.enemyId]
    if (e && e.status === 'active' && distanceBetween(ghost, bodyOf(e)) < gap(op, e) - EPS) return true
  }
  if (refs.markerId) {
    const m = s.markers.find((k) => k.id === refs.markerId)
    if (m && gapToMarker(ghost, m) < gapToMarker(bodyOf(op), m) - EPS) return true
  }
  if (refs.zoneId) {
    const zone = s.map.dropZones.find((z) => z.id === refs.zoneId)
    if (zone) {
      const before = footprintDistToPolygon(footprintOf(op), zone.polygon)
      const after = footprintDistToPolygon(footprintOf(op, { x: end.x, z: end.z }), zone.polygon)
      if (after < before - EPS) return true
    }
  }
  return false
}

registerTeamRules({
  id: TEAM_ID,

  // WHIP INTO FRENZY: two Fights in the whipped operative's next activation (T-NV.16)
  maxRepeats(state, op, actionId) {
    if (actionId !== 'fight' || !hasToken(state, op.id, WHIP) || !ownActivation(state, op)) return null
    return 2
  },
  // ... the first of them costs no AP
  actionCostDelta(state, op, actionId) {
    if (actionId !== 'fight' || !hasToken(state, op.id, WHIP)) return 0
    const act = ownActivation(state, op)
    if (!act || act.performed.includes('fight')) return 0
    markFired('nvWhipIntoFrenzy')
    return -1
  },
  // WHIP INTO FRENZY: Move +1" (T-NV.16); HOLY EMBROCATIONS: the Move reduction of injury is cancelled (T-NV.45).
  // effectiveMove takes the one 2" for injury and for an enemy's "as if injured" rule together; while such a rule
  // applies the 2" is that rule's and stays (the Hypex pattern, T-HA.18). The 4" floor gives the same Move either
  // way, so +2" equals ignoring the injury's Move change exactly.
  moveDelta(state, op) {
    let d = 0
    if (hasToken(state, op.id, WHIP)) d += 1
    if (isNv(state, op) && equipped(state, op.seat, ID.embrocations) && hasInjuredPenalty(op) && !providerAny(state, op, 'injuredEquivalent')) {
      d += 2
      markFired('nvHolyEmbrocations')
    }
    return d
  },

  // Null Rod (T-NV.9, T-NV.10)
  psychicBlocked(state, op) {
    const c = condemnorNear(state, op)
    if (!c) return false
    markFired('nvNullRod')
    return true
  },
  psychicImmune(state, op) {
    const c = condemnorNear(state, op)
    if (!c) return false
    markFired('nvNullRod')
    return true
  },

  // Icon Bearer (T-NV.27)
  controlApl(state, op, _marker, apl) {
    if (!hasAbility(state, op, ID.icon)) return null
    markFired('nvIconBearer')
    return apl + 1
  },

  // AUTO-BROADCASTER: no attack-dice re-rolls for an enemy within 3" of the marker (T-NV.14)
  rerollsBanned(state, side, attack) {
    if (!broadcasterBans(state, side, attack)) return false
    markFired('nvAutoBroadcaster')
    return true
  },

  // Medic!'s free Dash while the other player is the active one (T-NV.17)
  reactions(state, seat) {
    const out: ReactionOffer[] = []
    for (const e of state.effects) {
      if (e.kind !== MEDIC_DASH || e.seat !== seat || !e.operativeId) continue
      const v = state.operatives[e.operativeId]
      if (!v || v.status !== 'active') continue
      out.push({ hook: 'nvMedic', operativeId: v.id, option: 'dash', labelKey: 'nv.medicDash', data: { medicId: e.data?.medicId } })
    }
    return out
  },

  // RIGHTEOUS ADVANCE: the free Dash must end closer to one of the three references (T-NV.37)
  moveSurcharge(state, op, _kind, points) {
    const act = state.firefight.activation
    const refs = act?.frame?.data?.nvAdvance as AdvanceRefs | undefined
    if (!refs || !act || act.operativeId !== op.id || points.length === 0) return 0
    return advanceCloser(state, op, points[points.length - 1]!, refs) ? 0 : 999
  },
})

// ---------------------------------------------------------------------------
// Weapon rules: Anti-PSYKER, Null Rod melee nerf, Zealous Rage, Glorious Hymnal, Ardent Vengeance, Guided by Faith,
// Sanctified Rounds
// ---------------------------------------------------------------------------

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const def = s.data.weapons[c.weaponId]
    if (!def) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    // Null Rod: a PSYCHIC melee weapon near a Condemnor has no weapon rules at all (T-NV.11), whatever handler runs
    // before or after this one
    if (def.type === 'melee' && isPsychicWeapon(s, def.id) && condemnorNear(s, op)) {
      lockEmpty(rules)
      markFired('nvNullRod')
      return null
    }
    // Anti-PSYKER: Lethal 5+ against a PSYKER (T-NV.12)
    if (target && hasRule(def.rules, 'antipsyker') && hasKeyword(s, target, 'PSYKER')) {
      const at = ruleIndex(rules, 'lethal')
      if (at < 0) rules.push({ rule: 'lethal', target: 5 })
      else if ((rules[at]!.target ?? 6) > 5) rules[at] = { ...rules[at]!, target: 5 }
      markFired('nvAntiPsyker')
    }
    if (!isNv(s, op)) return null
    const a = s.attack
    // Zealous Rage: Ceaseless while the Penitent is the one fighting, never retaliating (T-NV.20)
    if (data.kind === 'fight' && hasRule(def.rules, 'zealousrage') && (!a || a.kind !== 'fight' || a.operativeId === op.id) && ruleIndex(rules, 'ceaseless') < 0) {
      rules.push({ rule: 'ceaseless' })
      markFired('nvZealousRage')
    }
    // Glorious Hymnal: Severe for Novitiates within 3" of an active Preceptor (T-NV.23)
    if (ruleIndex(rules, 'severe') < 0) {
      const preceptor = withAbility(s, op.seat, ID.hymnal).find((p) => p.id === op.id || within(p, op, 3 + commsFor(s, p)))
      if (preceptor) {
        rules.push({ rule: 'severe' })
        markFired('nvGloriousHymnal')
      }
    }
    // Ardent Vengeance: Punishing against an expended enemy (T-NV.34)
    if (target && target.seat !== op.seat && !target.ready && ployActive(s, op.seat, ID.ardent) && ruleIndex(rules, 'punishing') < 0) rules.push({ rule: 'punishing' })
    // Guided by Faith: Seek Light against a target within 6" (T-NV.41)
    if (data.kind === 'shoot' && target && target.seat !== op.seat && guidedActive(s, op) && within(op, target, 6) && ruleIndex(rules, 'seeklight') < 0) rules.push({ rule: 'seek-light' })
    // Sanctified Rounds: Piercing Crits 1 once Faith was spent in this sequence (T-NV.43)
    if (data.kind === 'shoot' && a && a.kind === 'shoot' && a.operativeId === op.id && equipped(s, op.seat, ID.sanctified) && ROUNDS_WEAPONS.includes(def.name.toLowerCase()) && faithSpentInSequence(s, op.seat) > 0) {
      if (!rules.some((r) => r.rule === 'piercing' && r.crits)) rules.push({ rule: 'piercing', x: 1, crits: true })
      markFired('nvSanctifiedRounds')
    }
    return null
  },
  'nv.modifyWeaponRules',
)

/**
 * Null Rod (T-NV.11) made independent of the handler order: the list of rules is emptied and every later attempt
 * to add to it (push, unshift, splice) does nothing, so a team registered after this one cannot give the weapon
 * a rule back. The list is a fresh copy made for this one query (attack-common.effectiveRules).
 */
function lockEmpty(rules: WeaponRuleRef[]): void {
  rules.length = 0
  const keep = { configurable: true, writable: true, enumerable: false }
  Object.defineProperty(rules, 'push', { ...keep, value: () => rules.length })
  Object.defineProperty(rules, 'unshift', { ...keep, value: () => rules.length })
  Object.defineProperty(rules, 'splice', { ...keep, value: () => [] })
}

/**
 * A number field that never reads above `cap`, whatever is written to it later: the Null Rod's 3/4 ceiling holds
 * after every other handler of the same hook, in whatever order they were registered (T-NV.11).
 */
function capField<T extends object>(obj: T, key: keyof T & string, cap: number): void {
  let v = Number((obj as Record<string, unknown>)[key])
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get: () => Math.min(v, cap),
    set: (x: number) => {
      v = x
    },
  })
}

function guidedActive(s: GameState, op: Operative): boolean {
  const fx = effectFor(s, ID.guided, op.id)
  if (!fx) return false
  const seq = fx.data?.declaredSeq
  return seq === undefined || s.firefight.activation?.declaredSeq === seq
}

// ---------------------------------------------------------------------------
// Dmg: Anti-PSYKER +1/+1 and the Null Rod 3/4 cap
// ---------------------------------------------------------------------------

registerHook(
  'modifyDamage',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { weaponId: string; dmg: { normal: number; crit: number } }
    const def = s.data.weapons[c.weaponId]
    if (!def) return null
    const target = c.targetId ? s.operatives[c.targetId] : undefined
    if (target && hasRule(def.rules, 'antipsyker') && hasKeyword(s, target, 'PSYKER')) {
      data.dmg.normal += 1
      data.dmg.crit += 1
      markFired('nvAntiPsyker')
    }
    if (def.type === 'melee' && isPsychicWeapon(s, def.id) && condemnorNear(s, op)) {
      // a ceiling on the stat itself, so a bonus another team adds later in the same hook is capped too
      capField(data.dmg, 'normal', 3)
      capField(data.dmg, 'crit', 4)
      markFired('nvNullRod')
    }
    return null
  },
  'nv.modifyDamage',
)

// ---------------------------------------------------------------------------
// Auto-chastisers (T-NV.44): an injury the self-damage caused waits for the end of the action (R-3.16), so a later
// sequence of the same Shoot (Torrent, Blast) still uses the Hit stat the operative had when the action began
// ---------------------------------------------------------------------------

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !s.effects.some((e) => e.kind === CHASTISED && e.operativeId === op.id)) return null
    if (!hasInjuredPenalty(op) || providerAny(s, op, 'injuredEquivalent')) return null
    ;(c.data as { hitDelta: number }).hitDelta -= 1
    markFired('nvAutoChastisers')
    return null
  },
  'nv.modifyAttackDice',
)

// ---------------------------------------------------------------------------
// Damage taken: Null Rod immunity and cap, Defenders of the Faith, Medic!'s floor
// ---------------------------------------------------------------------------

const DICE_SOURCES = ['normal', 'crit', 'strike-normal', 'strike-crit']

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op) return null
    const d = c.data as { source: string; attackerId: string; weaponId: string | null; amount: number }
    if (d.amount <= 0) return null
    const w = d.weaponId ? s.data.weapons[d.weaponId] : undefined
    if (w && isPsychicWeapon(s, w.id)) {
      // Null Rod: a PSYCHIC ranged weapon cannot inflict damage on the Condemnor, of any kind (T-NV.8)
      if (w.type === 'ranged' && hasAbility(s, op, ID.nullRod)) {
        d.amount = 0
        markFired('nvNullRod')
        return null
      }
      // ... and a PSYCHIC melee weapon near a Condemnor never exceeds 3/4, whatever other rules added before or after
      // this handler (T-NV.11): older team code adds Dmg at this point rather than in modifyDamage
      const attacker = s.operatives[d.attackerId]
      if (w.type === 'melee' && attacker && condemnorNear(s, attacker) && (d.source === 'strike-normal' || d.source === 'strike-crit')) {
        capField(d, 'amount', d.source === 'strike-normal' ? 3 : 4)
        markFired('nvNullRod')
      }
    }
    // Defenders of the Faith: one normal success of a sequence is halved, 2 at least (T-NV.35)
    if ((d.source === 'normal' || d.source === 'strike-normal') && d.amount >= 3 && isNv(s, op) && ployActive(s, op.seat, ID.defenders)) {
      const seq = s.attack?.seq
      const attacker = s.operatives[d.attackerId]
      if (seq && attacker && attacker.seat !== op.seat && !seq.choices['nv.dotf'] && contestedBy(s, op).some((m) => m.kind === 'objective')) {
        seq.choices['nv.dotf'] = '1'
        d.amount = Math.max(2, Math.ceil(d.amount / 2))
      }
    }
    // Medic!: nothing can incapacitate the casualty for the rest of the action (T-NV.17)
    if (s.effects.some((e) => e.kind === MEDIC_FLOOR && e.operativeId === op.id)) d.amount = Math.max(0, Math.min(d.amount, op.wounds - 1))
    return null
  },
  'nv.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// Damage dealt: the Faith kill rules, Militant Faith's refund, the flamer crit record for Blazing Inferno
// ---------------------------------------------------------------------------

/** Glorious Martyrdom damage is being dealt: Inspirational Example ignores it (T-NV.7). */
let martyrdomDepth = 0

registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = opOfHook(c)
    if (!ctx || !s || !victim) return null
    const d = c.data as unknown as DamageInflictedData
    const attacker = s.operatives[d.attackerId]
    if (!attacker || attacker.id === victim.id || attacker.seat === victim.seat) return null
    const killed = d.woundsBefore > 0 && d.woundsAfter <= 0
    if (killed && teamIsNv(s, attacker.seat) && isNv(s, attacker)) {
      const faith = victim.maxWounds >= 12 ? 2 : 1
      // Inspirational Example (Superior): any incapacitation, never through Glorious Martyrdom
      if (hasAbility(s, attacker, ID.inspirational) && martyrdomDepth === 0) {
        gainPool(ctx, attacker.seat, FAITH, faith, 'nv.inspirationalExample')
        markFired('nvKillFaith')
      }
      // Unflinching Example (Preceptor): a ready enemy within its control range, Martyrdom damage included
      if (hasAbility(s, attacker, ID.unflinching) && victim.ready && inControlRange(s, bodyOf(attacker), bodyOf(victim))) {
        gainPool(ctx, attacker.seat, FAITH, faith, 'nv.unflinchingExample')
        markFired('nvKillFaith')
      }
    }
    // Militant Faith: an enemy incapacitated in a sequence where the Militant's act was paid for (T-NV.19)
    const seq = s.attack?.seq
    if (killed && seq) {
      for (const seat of SEATS) {
        const cost = Number(seq.choices[MF_KEY(seat)] ?? 0)
        if (cost > 0 && victim.seat !== seat && !seq.choices[MF_DONE(seat)]) {
          seq.choices[MF_DONE(seat)] = '1'
          gainPool(ctx, seat, FAITH, cost, 'nv.militantFaith')
          markFired('nvMilitantFaith')
        }
      }
    }
    // Blazing Inferno: remember the targets a flamer crit hurt (T-NV.39)
    if (d.amount > 0 && d.source === 'crit' && d.weaponId === FLAMER && isNv(s, attacker) && !s.effects.some((e) => e.kind === FLAMER_CRIT && e.operativeId === victim.id)) {
      addEffect(ctx, { source: ID.inferno, seat: attacker.seat, kind: FLAMER_CRIT, operativeId: victim.id, expires: 'action', data: { shooterId: attacker.id } })
    }
    return null
  },
  'nv.damage.inflicted',
)

// ---------------------------------------------------------------------------
// Action end: Divine Acquisition (T-NV.25), Blessed Rejuvenation (T-NV.36)
// ---------------------------------------------------------------------------

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = opOfHook(c)
    if (!ctx || !s || !op) return null
    const data = c.data as { action: string }
    // Divine Acquisition: a mission action by the Pronatus gives Faith equal to the turning point, once per turning point
    if (isNv(s, op) && hasAbility(s, op, ID.divine) && data.action.startsWith('ability:') && !usedThisTp(s, op.seat, DIVINE_TP)) {
      const def = s.data.abilities[data.action.slice('ability:'.length)]
      if ((def?.keywords ?? []).includes('MISSION')) {
        markUsedTp(s, op.seat, DIVINE_TP)
        gainPool(ctx, op.seat, FAITH, s.turningPoint, 'nv.divineAcquisition')
        markFired('nvDivineAcquisition')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.divine }, op.seat)
      }
    }
    // Blessed Rejuvenation: one D3 per Faith spending event on an operative that is still standing
    const spends = s.effects.filter((e) => e.kind === SPEND)
    for (const fx of spends) {
      if (!ployActive(s, fx.seat, ID.rejuvenation) || !fx.operativeId) continue
      const target = s.operatives[fx.operativeId]
      if (!live(target)) continue
      regainWounds(ctx, target.id, d3(ctx, 'nv.rejuvenation'), ID.rejuvenation)
    }
    return null
  },
  'nv.action.ended',
)

// ---------------------------------------------------------------------------
// Riposte (T-NV.15)
// ---------------------------------------------------------------------------

registerHook(
  'afterBlock',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = opOfHook(c)
    const foe = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!ctx || !s || !op || !foe || !c.weaponId) return null
    const data = c.data as { die: string }
    const def = s.data.weapons[c.weaponId]
    if (data.die !== 'crit' || !def || !hasRule(def.rules, 'riposte') || foe.seat === op.seat) return null
    // the weapon's Critical Dmg after every modifier, dealt as a crit strike so the foe's per-die reductions apply
    const dmg = weaponDamage(s, op.id, c.weaponId, foe.id, 'fight', ctx)
    inflict(ctx, { targetId: foe.id, attackerId: op.id, weaponId: c.weaponId, amount: dmg.crit, source: 'strike-crit' })
    markFired('nvRiposte')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.riposte, detail: foe.id }, op.seat)
    return null
  },
  'nv.afterBlock',
)

// ---------------------------------------------------------------------------
// Lifecycle: Blaze tokens burn at activation start, the Auto-broadcaster goes with its Dialogus
// ---------------------------------------------------------------------------

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const op = opOfHook(c)
    if (!ctx || !op || !live(op)) return null
    if (hasToken(ctx.state, op.id, BLAZE)) {
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.inferno, detail: 'blaze' }, op.seat)
      directDamage(ctx, op.id, d3(ctx, 'nv.blaze'), op.id, 'nv.blaze')
    }
    return null
  },
  'nv.activation.start',
)

registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = opOfHook(c)
    if (!ctx || !s || !victim) return null
    for (const m of [...s.markers]) if (m.equipmentId === BROADCASTER && m.placedBy === victim.id) removeMarker(ctx, m.id, 'nv.autoBroadcaster')
    return null
  },
  'nv.operative.incapacitated',
)

// ---------------------------------------------------------------------------
// Shoot target selection: Blinding Aura bars, Guided by Faith's Seek Light adds
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const shooter = opOfHook(c)
    if (!s || !shooter) return null
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    // Blinding Aura: the barred Novitiate cannot be chosen (primary selection only) while it is more than 2" away
    if (!data.secondary) {
      for (const fx of s.effects) {
        if (fx.kind !== AURA_FX || fx.data?.enemyId !== shooter.id || !fx.operativeId) continue
        const friend = s.operatives[fx.operativeId]
        if (!live(friend) || !(gap(shooter, friend) > 2 + EPS) || !data.candidates.includes(friend.id)) continue
        data.candidates = data.candidates.filter((id) => id !== friend.id)
      }
    }
    // Guided by Faith: Seek Light makes a Conceal enemy in Light cover within 6" a valid target
    if (isNv(s, shooter) && guidedActive(s, shooter) && !s.attack?.pointBlank && s.data.weapons[data.weaponId]?.type === 'ranged') {
      const base = ruleSetFor(s, shooter, data.weaponId, 'shoot', undefined, c.engine)
      for (const e of enemiesOf(s, shooter)) {
        if (!live(e) || data.candidates.includes(e.id) || !within(shooter, e, 6)) continue
        const rules = { ...base, seekLight: true }
        if (rules.range !== null && !(gap(shooter, e) <= rules.range + EPS)) continue
        if (enemiesInControlRange(s, e, e.seat).length > 0) continue
        const info = targetInfo(s, shooter, e, rules)
        if (!info.verdict.visible || info.coverBlocks) continue
        data.candidates.push(e.id)
        markFired('nvGuidedByFaith')
      }
    }
    return null
  },
  'nv.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// Unique actions
// ---------------------------------------------------------------------------

/** STIRRING RHETORIC (T-NV.13): +1 APL to a friendly Novitiate near the Dialogus or its Auto-broadcaster marker. */
registerCodeHook({
  name: 'nvStirringRhetoric',
  action: {
    offers(state, op): OfferSeed[] {
      const reach = 6 + commsFor(state, op)
      const marker = markersOf(state, op.seat, BROADCASTER)[0]
      const out: OfferSeed[] = []
      for (const f of friendsOf(state, op)) {
        if (!live(f) || !isNv(state, f) || effectiveApl(f) >= 3) continue
        const near = (within(op, f, reach) && visible(state, bodyOf(op), bodyOf(f))) || (!!marker && gapToMarker(bodyOf(f), marker) <= reach + EPS)
        if (near) out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!live(target) || target.seat !== op.seat) {
        cancelAction(ctx)
        return
      }
      applyAplEffect(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/** Spots for the Auto-broadcaster marker: within 8" of the Dialogus, or of the marker's current spot (T-NV.14). */
function broadcastSpots(s: GameState, op: Operative): Vec2[] {
  const marker = markersOf(s, op.seat, BROADCASTER)[0]
  const out: Vec2[] = []
  const seen = new Set<string>()
  const hx = s.map.size.x / 2 - 0.5
  const hz = s.map.size.z / 2 - 0.5
  const ok = (p: Vec2): boolean => (marker ? Math.hypot(p.x - marker.pos.x, p.z - marker.pos.z) <= 8 + EPS : pointGapToFootprint(p, footprintOf(op)) <= 8 + EPS)
  const add = (p: Vec2): void => {
    const q = { x: round3(p.x), z: round3(p.z) }
    const k = `${q.x},${q.z}`
    if (seen.has(k) || Math.abs(q.x) > hx || Math.abs(q.z) > hz || !ok(q)) return
    if (marker && Math.hypot(q.x - marker.pos.x, q.z - marker.pos.z) < 0.05) return
    seen.add(k)
    out.push(q)
  }
  for (const m of s.markers) if (m.kind === 'objective') add(m.pos)
  for (const o of activeOps(s)) add({ x: o.pos.x, z: o.pos.z })
  const origin = marker ? marker.pos : { x: op.pos.x, z: op.pos.z }
  add(origin)
  for (const d of [2, 4, 6, 8]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      add({ x: origin.x + Math.sin(a) * (d + (marker ? 0 : op.baseRadius)), z: origin.z + Math.cos(a) * (d + (marker ? 0 : op.baseRadius)) })
    }
  }
  return out.slice(0, 44)
}

/** AUTO-BROADCASTER (T-NV.14): 0 AP, place or move the marker. */
registerCodeHook({
  name: 'nvAutoBroadcaster',
  action: {
    offers(state, op): OfferSeed[] {
      return broadcastSpots(state, op).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const spots = broadcastSpots(ctx.state, op)
      if (spots.length === 0) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'nvAutoBroadcaster', operativeId: op.id, abilityId: def.id },
        options: spots.map((p) => choiceOpt(`${p.x},${p.z}`, 'marker.autoBroadcaster', { x: p.x, z: p.z })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    for (const m of markersOf(ctx.state, op.seat, BROADCASTER)) removeMarker(ctx, m.id, 'nv.autoBroadcaster.moved')
    const marker: Marker = { id: newMarkerId(ctx, 'nv-ab'), kind: 'equipment', pos: { x, z }, owner: op.seat, carriedBy: null, controller: null, equipmentId: BROADCASTER, placedBy: op.id }
    ctx.state.markers.push(marker)
    ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: marker.pos }, op.seat)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${x},${z}` }, op.seat)
    finishAction(ctx)
  },
})

/** WHIP INTO FRENZY (T-NV.16): a Whip token, +1 APL, and (through the providers) +1" Move and two Fights. */
registerCodeHook({
  name: 'nvWhipIntoFrenzy',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of friendsOf(state, op)) {
        if (!live(f) || !isNv(state, f) || hasKeyword(state, f, 'SUPERIOR') || hasToken(state, f.id, WHIP)) continue
        if (!within(op, f, 3) || !visible(state, bodyOf(op), bodyOf(f))) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!live(target) || target.seat !== op.seat) {
        cancelAction(ctx)
        return
      }
      addToken(ctx, target.id, { kind: WHIP, owner: op.seat, cap: 1, sourceId: op.id, expires: ['holderActivationEnd'] }, 'nv.whip')
      applyAplEffect(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/** CHIRURGEON'S TOOLS (T-NV.18): 2D3 wounds back for a Novitiate in the Hospitaller's control range. */
registerCodeHook({
  name: 'nvChirurgeonsTools',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of nvOps(state, op.seat)) {
        if (f.wounds >= f.maxWounds || usedThisTp(state, op.seat, `nv.medic.saved:${f.id}`)) continue
        if (f.id !== op.id && !inControlRange(state, bodyOf(op), bodyOf(f))) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      const dice = ctx.roll('nv.chirurgeon.2d3', 2)
      regainWounds(ctx, target.id, dice.reduce((n, r) => n + Math.ceil(r / 2), 0), def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/** RAISE ICON (T-NV.28): Faith, more while the Reliquarius controls an objective marker. */
registerCodeHook({
  name: 'nvRaiseIcon',
  action: {
    offers(state, op): OfferSeed[] {
      return usedThisTp(state, op.seat, `nv.raise:${op.id}`) ? [] : [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      const s = ctx.state
      markUsedTp(s, op.seat, `nv.raise:${op.id}`)
      const controls = controlledBy(s, op, (m) => m.kind === 'objective').length > 0
      gainPool(ctx, op.seat, FAITH, 1 + (controls ? s.turningPoint : 0), 'nv.raiseIcon')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Medic! (T-NV.17), the Pathfinders / Hearthkyn implementation with Novitiate operatives
// ---------------------------------------------------------------------------

function medicFor(s: GameState, victim: Operative): Operative | null {
  if (!isNv(s, victim) || victim.status !== 'active' || inEnemyCr(s, victim)) return null
  const a = s.attack
  for (const m of withAbility(s, victim.seat, ID.medic)) {
    if (m.id === victim.id || usedThisTp(s, m.seat, `nv.medic:${m.id}`)) continue
    if (!within(m, victim, 3) || !visible(s, bodyOf(m), bodyOf(victim))) continue
    if (inEnemyCr(s, m)) continue
    // in a Shoot action the medic must not be a primary or secondary target
    if (a?.kind === 'shoot' && a.targets.includes(m.id)) continue
    return m
  }
  return null
}

registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = opOfHook(c)
    if (!s || !ctx || !victim) return null
    const medic = medicFor(s, victim)
    if (!medic) return null
    const data = c.data as { wounds: number }
    data.wounds = 1
    markUsedTp(s, medic.seat, `nv.medic:${medic.id}`)
    markUsedTp(s, medic.seat, `nv.medic.saved:${victim.id}`)
    addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: MEDIC_FLOOR, operativeId: victim.id, expires: 'action' })
    // the activation the rule was used in: the one under a frame (an enemy Guard interrupt, a free action) counts
    const under = baseActivation(s)
    if (under && !under.counteract && under.operativeId === victim.id) under.endsAfterAction = true
    // the free Dash after the action: a reaction when the other player is active, a 0 CP offer in the action-ended window otherwise
    addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: MEDIC_DASH, operativeId: victim.id, expires: 'activation', data: { medicId: medic.id } })
    applyAplEffect(ctx, victim.id, -1, ID.medic)
    applyAplEffect(ctx, medic.id, -1, ID.medic)
    ctx.emit({ type: 'AbilityUsed', operativeId: medic.id, abilityId: ID.medic, detail: victim.id }, medic.seat)
    markFired('nvMedic')
    return null
  },
  'nv.beforeIncapacitated',
)

registerCodeHook({
  name: 'nvMedic',
  /** the free Dash after the action: the saved operative moves into the Hospitaller's control range */
  choice(ctx, op) {
    const fx = effectFor(ctx.state, MEDIC_DASH, op.id)
    if (!fx) {
      reactionDone(ctx)
      return
    }
    removeEffects(ctx, (e) => e.id === fx.id)
    if (!startFreeAction(ctx, { operativeId: op.id, action: 'dash', endWithinCrOf: String(fx.data?.medicId), resume: REACTION_DONE })) reactionDone(ctx)
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys that are turning point flags the handlers above read
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'nvFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

// ---------------------------------------------------------------------------
// RIGHTEOUS ADVANCE (T-NV.37): free Dashes one at a time, each ending closer to an enemy, an objective or the enemy drop zone
// ---------------------------------------------------------------------------

function advanceNext(ctx: Ctx, seat: Seat, remaining: string[], left: number): void {
  const s = ctx.state
  const live2 = remaining.filter((id) => {
    const o = s.operatives[id]
    return !!o && live(o) && enemiesInControlRange(s, o, o.seat).length === 0
  })
  if (left <= 0 || live2.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'nvRighteousAdvance', operativeId: live2[0], seat, remaining: live2, left },
    options: [...live2.map((id) => choiceOpt(id, 'nv.advance.dash', { name: s.operatives[id]!.name })), choiceOpt('done', 'nv.advance.done')],
  })
}

registerCodeHook({
  name: 'nvRighteousAdvance',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const ok = nvOps(state, seat).some((o) => enemiesInControlRange(state, o, o.seat).length === 0)
      return ok ? [{}] : []
    },
    apply(ctx, seat) {
      const mine = nvOps(ctx.state, seat)
      advanceNext(ctx, seat, mine.map((o) => o.id), Math.max(1, Math.floor(mine.length / 3)))
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const left = Number(context.left)
    const remaining = (context.remaining as string[]).slice()
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const mover = ctx.state.operatives[option]
    const rest = remaining.filter((id) => id !== option)
    const started = mover ? startFreeAction(ctx, { operativeId: option, action: 'dash', resume: 'nv.advance', data: { seat, remaining: rest, left, nvAdvance: advanceRefs(ctx.state, mover) } }) : false
    if (!started) advanceNext(ctx, seat, rest, left)
  },
})

registerFrameResume('nv.advance', (ctx, outcome, data) => {
  const left = Number(data.left) - (outcome === 'finished' ? 1 : 0)
  advanceNext(ctx, data.seat as Seat, (data.remaining as string[]) ?? [], left)
})

// ---------------------------------------------------------------------------
// GLORIOUS MARTYRDOM (T-NV.38)
// ---------------------------------------------------------------------------

function martyrVictims(s: GameState, dying: Operative): Operative[] {
  return enemiesOf(s, dying).filter((e) => live(e) && within(dying, e, 2) && visible(s, bodyOf(dying), bodyOf(e)))
}

registerCodeHook({
  name: 'nvGloriousMartyrdom',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || !isNv(state, op) || op.status !== 'active' || op.wounds > 0) return []
      return martyrVictims(state, op).length > 0 ? [{ operativeId: op.id }] : []
    },
    apply(ctx, seat, _ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      const dying = id ? ctx.state.operatives[id] : undefined
      if (!dying) return
      for (const e of martyrVictims(ctx.state, dying)) {
        gainPool(ctx, seat, FAITH, 1, 'nv.gloriousMartyrdom')
        martyrdomDepth++
        try {
          directDamage(ctx, e.id, d3(ctx, 'nv.martyrdom'), dying.id, 'nv.martyrdom')
        } finally {
          martyrdomDepth--
        }
      }
    },
  },
})

// ---------------------------------------------------------------------------
// BLAZING INFERNO (T-NV.39) with Purge with Flame (T-NV.26); the Blaze token burns at activation start (see above)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'nvBlazingInferno',
  ploy: {
    // offered through the ploy rule below (the shoot.resolved window names no operative)
    offers: (): PloyOfferSeed[] => [],
    apply(ctx, seat, _ploy, seed) {
      const target = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!target || target.status !== 'active') return
      addToken(ctx, target.id, { kind: BLAZE, owner: seat, cap: 1 }, 'nv.blaze')
    },
  },
})

// ---------------------------------------------------------------------------
// BLINDING AURA (T-NV.40) with the team-local re-target
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'nvBlindingAura',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const a = state.attack
      const target = info.targetId ? state.operatives[info.targetId] : undefined
      const shooter = a ? state.operatives[a.operativeId] : undefined
      // only a target the enemy selected: not one a team rule fixed for the weapon (Detonate)
      if (!a || a.kind !== 'shoot' || a.index !== 0 || a.fixed || !target || !shooter || target.seat !== seat || shooter.seat === seat) return []
      if (!isNv(state, target) || !live(target) || a.targets[0] !== target.id) return []
      // the Aura only matters while the Novitiate is more than 2" away
      if (!(gap(shooter, target) > 2 + EPS)) return []
      if (state.effects.some((e) => e.kind === AURA_FX && e.operativeId === target.id && e.data?.enemyId === shooter.id)) return []
      return [{ operativeId: target.id }]
    },
    apply(ctx, seat, ploy, seed) {
      const s = ctx.state
      const a = s.attack
      const friend = seed.operativeId ? s.operatives[seed.operativeId] : undefined
      const shooter = a ? s.operatives[a.operativeId] : undefined
      if (!a || a.kind !== 'shoot' || !friend || !shooter || !a.weaponId) return
      // until the enemy's activation or counteraction ends
      addEffect(ctx, { source: ploy.id, seat, kind: AURA_FX, operativeId: friend.id, expires: 'activation', data: { enemyId: shooter.id } })
      markFired('nvBlindingAura')
      // the selection starts again: the same weapon's valid targets, the barred Novitiate already filtered out by
      // beforeShootTargetSelect while it is more than 2" away (and from the same viewpoint, Magnify)
      const viewpoint = a.viewpointId ? s.operatives[a.viewpointId] : undefined
      const targets = validTargets(s, shooter, a.weaponId, ctx, viewpoint)
      if (targets.length === 0) {
        // no other valid target: the Shoot ends as performed (AP spent, no dice rolled)
        a.index = a.targets.length
        delete a.status
        a.resume = 'finish'
        return
      }
      // the shooter re-selects through the Shoot's own target decision, so Blast secondaries, Torrent picks and the
      // defender's cover-or-obscured choice all run again for the new primary. The old target's window is dropped
      // (its sequence never starts); the new target gets its own shoot.targetSelected window. No pass: the action
      // cannot be cancelled once the Aura is used.
      s.window = null
      delete a.status
      a.resume = undefined
      a.stage = 'target'
      a.targets = []
      a.candidates = []
      a.index = 0
      a.inherit = null
      ctx.raise({
        kind: 'shoot.target',
        seat: shooter.seat,
        window: 'firefight.actionDeclared',
        context: { operativeId: shooter.id, weaponId: a.weaponId, secondary: false, barredId: friend.id },
        options: targets.map((t) => {
          const exp = expectedDamage(s, shooter.id, a.weaponId!, t.id)
          return {
            id: t.id,
            labelKey: 'shoot.target',
            type: 'shoot.target' as const,
            payload: { targetId: t.id },
            data: { distance: t.distance, inCover: t.inCover, obscured: t.obscured, forcedChoice: t.verdict.forcedChoice, improvedCover: t.improvedCover, vantageAccurate: t.verdict.vantage.accurate, expectedDamage: exp.mean, killProbability: exp.killProbability },
          }
        }),
      })
    },
  },
})

// ---------------------------------------------------------------------------
// GUIDED BY FAITH (T-NV.41)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'nvGuidedByFaith',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.action !== 'shoot' || !isNv(state, op) || !live(op)) return []
      if (!op.weapons.some((w) => state.data.weapons[w]?.type === 'ranged') || effectFor(state, ID.guided, op.id)) return []
      return [{ operativeId: op.id }]
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (id) addEffect(ctx, { source: ploy.id, seat, kind: ID.guided, operativeId: id, expires: 'action', data: { declaredSeq: ctx.state.firefight.activation?.declaredSeq } })
    },
  },
})

// ---------------------------------------------------------------------------
// 0 CP offers: ACTS OF FAITH, Icon of Faith, Auto-chastisers, Sanctified Rounds, Absolution, Blazing Inferno, the Blaze
// token's removal and Medic!'s free Dash
// ---------------------------------------------------------------------------

function offer(id: string, ployId: string, name: string, via: string, op: Operative | null, param?: string, cost = 0): PloyOffer {
  return { id, ployId, name, ...(param ? { param } : {}), ...(op ? { operativeId: op.id } : {}), cost, via, seed: param ? { param } : {} }
}

/** The windows each act is offered in and whose dice they change. */
const ACT_WINDOWS: Record<string, { acts: ActKey[]; role: 'atk' | 'def' | 'own' }> = {
  'shoot.beforeAttackRerolls': { acts: ['guidance'], role: 'atk' },
  'shoot.defenderBeforeRerolls': { acts: ['guidance'], role: 'def' },
  'fight.beforeRerolls': { acts: ['guidance'], role: 'own' },
  'shoot.attackRolled': { acts: ['blessing', 'intervention'], role: 'atk' },
  'shoot.defenceRolled': { acts: ['blessing', 'intervention'], role: 'def' },
  'fight.rolled': { acts: ['blessing', 'intervention'], role: 'own' },
}

const liveFails = (dice: AttackDie[]): AttackDie[] => dice.filter((d) => d.kind === 'fail' && d.value !== null && !d.used)
const blessable = (dice: AttackDie[]): AttackDie[] => dice.filter((d) => d.kind === 'normal' && !d.used && d.tag !== 'cover')

/** Can this act do anything for the side right now? Shared by the offers and the checks in the tests. */
export function actUseful(s: GameState, act: ActKey, side: DiceSide, attackDice: boolean): boolean {
  if (act === 'guidance') {
    const banned = side.noRerolls === true || (s.attack ? providerRerollsBanned(s, side, s.attack) : false)
    return !banned && eligibleDice(side).length > 0
  }
  if (act === 'blessing') return blessable(side.dice).length > 0 && !(attackDice && s.attack?.kind === 'shoot' && s.attack.seq?.obscured)
  return liveFails(side.dice).length > 0
}

function faithOffers(s: GameState, seat: Seat, window: string, info: PloyWindowInfo): PloyOffer[] {
  const out: PloyOffer[] = []
  const spec = ACT_WINDOWS[window]
  const subject = info.subjectId ? s.operatives[info.subjectId] : undefined
  const a = s.attack
  if (!spec || !subject || subject.seat !== seat || !live(subject) || !isNv(s, subject) || !a?.seq) return out
  const role = spec.role
  if (role === 'atk' && !(a.kind === 'shoot' && a.operativeId === subject.id)) return out
  if (role === 'def' && !(a.kind === 'shoot' && a.seq.def?.operativeId === subject.id)) return out
  if (role === 'own' && a.kind !== 'fight') return out
  const side = sideOf(s, subject.id)
  if (!side) return out
  const attackDice = role !== 'def'
  const used = actsUsed(s, seat)
  const iconReady = equipped(s, seat, ID.iconOfFaith) && !usedThisTp(s, seat, ICON_TP)
  const faith = poolOf(s, seat, FAITH)
  // one act per sequence; the Icon of Faith allows a second, different one
  if (used.length < 1 + (iconReady ? 1 : 0)) {
    const chasteners = attackDice && equipped(s, seat, ID.chastisers) && !usedThisTp(s, seat, CHASTISE_TP)
    for (const act of spec.acts) {
      if (used.includes(act) || !actUseful(s, act, side, attackDice)) continue
      const cost = ACT_COST[act]
      const name = act.charAt(0).toUpperCase() + act.slice(1)
      if (faith >= cost) out.push(offer(ACT_ID[act], ACT_ID[act], `${name} (${cost} Faith)`, 'nv.act', subject))
      // Auto-chastisers: the act for free, paid for in damage to the operative (never enough to incapacitate it)
      if (chasteners && subject.wounds > cost) out.push(offer(`${ACT_ID[act]}:free`, ACT_ID[act], `${name} via Auto-chastisers (${cost} damage to ${subject.name})`, 'nv.act', subject, 'free'))
    }
  }
  // Sanctified Rounds: one Faith point on its own, for the Piercing Crits 1 of the weapon (T-NV.43)
  if (window === 'shoot.attackRolled' && role === 'atk' && equipped(s, seat, ID.sanctified) && faith >= 1 && faithSpentInSequence(s, seat) === 0 && ROUNDS_WEAPONS.includes(weaponNameOf(s, a.weaponId))) {
    out.push(offer(ID.sanctified, ID.sanctified, 'Sanctified Rounds (1 Faith)', 'nv.rounds', subject))
  }
  return out
}

/** Apply an ACT OF FAITH to the subject's dice (T-NV.31 to T-NV.33). */
function applyAct(ctx: Ctx, seat: Seat, op: Operative, act: ActKey, free: boolean): void {
  const s = ctx.state
  const seq = s.attack?.seq
  const side = sideOf(s, op.id)
  if (!seq || !side) return
  const cost = ACT_COST[act]
  if (free) {
    markUsedTp(s, seat, CHASTISE_TP)
    const wasInjured = isInjured(op)
    directDamage(ctx, op.id, cost, op.id, 'nv.autoChastisers')
    // an injury this damage causes changes the operative's stats only once the action is over (R-3.16)
    if (!wasInjured && isInjured(op)) addEffect(ctx, { source: ID.chastisers, seat, kind: CHASTISED, operativeId: op.id, expires: 'action' })
    markFired('nvAutoChastisers')
  } else if (!spendPool(ctx, seat, FAITH, cost, `nv.${act}`)) return
  // the Icon of Faith's once-per-turning-point use is spent by the second act of a sequence
  if (actsUsed(s, seat).length >= 1) {
    markUsedTp(s, seat, ICON_TP)
    markFired('nvIconOfFaith')
  }
  seq.choices[ACTS_KEY(seat)] = [...actsUsed(s, seat), act].join(',')
  if (!free) noteSpend(ctx, seat, op, cost)
  switch (act) {
    case 'guidance':
      side.grants.push({ id: 'nv.guidance', source: ID.guidance, mode: 'one', used: false })
      break
    case 'blessing': {
      const d = blessable(side.dice)[0]
      if (d) {
        d.kind = 'crit'
        d.tag = 'nv.blessing'
      }
      break
    }
    case 'intervention': {
      const d = liveFails(side.dice)[0]
      if (d) {
        d.value = null
        d.kind = 'normal'
        d.tag = 'nv.intervention'
      }
      break
    }
  }
  // Militant Faith: remember what the act cost while the Militant is the one shooting, fighting or retaliating
  if (!free && hasAbility(s, op, ID.militant) && (s.attack!.kind === 'fight' || s.attack!.operativeId === op.id)) {
    seq.choices[MF_KEY(seat)] = String(Math.max(Number(seq.choices[MF_KEY(seat)] ?? 0), cost))
  }
  markFired('nvActsOfFaith')
  ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ACT_ID[act], detail: free ? 'auto-chastisers' : `${cost}` }, seat)
}

const NV_RULE: PloyRule = {
  extraOffers(state, seat, window, info) {
    const out: PloyOffer[] = []
    out.push(...faithOffers(state, seat, window, info))
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    const act = state.firefight.activation

    // ---- Absolution Through Destruction: a free Fight right after the Penitent's Fight (T-NV.21)
    if (window === 'firefight.actionEnded' && subject && subject.seat === seat && live(subject) && hasAbility(state, subject, ID.absolution) && act && !act.frame && act.operativeId === subject.id) {
      const key = `nv.abs:${act.performed.length}`
      if (act.performed[act.performed.length - 1] === 'fight' && !(act.used ?? []).includes(key) && canStartFreeAction(state, { operativeId: subject.id, action: 'fight', resume: 'ploy.freeAction' })) {
        out.push(offer(ID.absolution, ID.absolution, 'Absolution Through Destruction: free Fight', 'nv.absolution', subject))
      }
    }

    // ---- Medic!'s free Dash while the Novitiate player is the active one (T-NV.17)
    if (window === 'firefight.actionEnded' && act && act.seat === seat) {
      for (const e of state.effects) {
        if (e.kind !== MEDIC_DASH || e.seat !== seat || !e.operativeId || state.operatives[e.operativeId]?.status !== 'active') continue
        out.push(offer(`${MEDIC_DASH}@${e.operativeId}`, ID.medic, 'Medic! free Dash', 'nv.medicDash', state.operatives[e.operativeId]!, e.operativeId))
      }
    }

    // ---- the Blaze token: its holder may give up 1 APL for the activation to remove it (T-NV.39)
    if (window === 'firefight.activationStart' && !info.counteracting && subject && subject.seat === seat && live(subject) && hasToken(state, subject.id, BLAZE)) {
      out.push(offer(`${ID.blaze}:remove`, ID.blaze, 'Remove the Blaze token (-1 APL this activation)', 'nv.blazeRemove', subject))
    }

    // ---- Blazing Inferno: after a Shoot where a flamer crit hurt someone (T-NV.39, Purge with Flame T-NV.26)
    if (window === 'shoot.resolved' && info.attackerId) {
      const shooter = state.operatives[info.attackerId]
      const ploy = state.data.ploys?.[ID.inferno]
      if (shooter && shooter.seat === seat && ploy && isNv(state, shooter) && !usedThisTp(state, seat, ploy.id)) {
        const free = hasAbility(state, shooter, ID.purge) && !usedThisTp(state, seat, `nv.purge:${shooter.id}`)
        for (const fx of state.effects) {
          if (fx.kind !== FLAMER_CRIT || fx.data?.shooterId !== shooter.id || !fx.operativeId) continue
          const t = state.operatives[fx.operativeId]
          if (!live(t) || hasToken(state, t.id, BLAZE, seat)) continue
          out.push(offer(`${ID.inferno}:${t.id}`, ID.inferno, `BLAZING INFERNO: ${t.name}`, 'nv.inferno', shooter, t.id, free ? 0 : ploy.cost))
        }
      }
    }
    return out
  },

  onUsed(ctx, seat, o) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    switch (o.via) {
      case 'nv.act': {
        const act = ACT_BY_ID[o.ployId]
        if (op && act) applyAct(ctx, seat, op, act, o.param === 'free')
        break
      }
      case 'nv.rounds': {
        if (op && spendPool(ctx, seat, FAITH, 1, 'nv.sanctifiedRounds')) {
          noteSpend(ctx, seat, op, 1)
          markFired('nvSanctifiedRounds')
          ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.sanctified }, seat)
        }
        break
      }
      case 'nv.absolution': {
        const act = s.firefight.activation
        if (!op || !act) break
        act.used = [...(act.used ?? []), `nv.abs:${act.performed.length}`]
        markFired('nvAbsolution')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.absolution }, seat)
        startFreeAction(ctx, { operativeId: op.id, action: 'fight', resume: 'ploy.freeAction' })
        break
      }
      case 'nv.medicDash': {
        const fx = op ? effectFor(s, MEDIC_DASH, op.id) : undefined
        if (!op || !fx) break
        removeEffects(ctx, (e) => e.id === fx.id)
        startFreeAction(ctx, { operativeId: op.id, action: 'dash', endWithinCrOf: String(fx.data?.medicId), resume: 'ploy.freeAction' })
        break
      }
      case 'nv.blazeRemove': {
        if (!op) break
        removeToken(ctx, op.id, BLAZE, 'nv.blaze.removed')
        applyAplEffect(ctx, op.id, -1, ID.blaze)
        break
      }
      case 'nv.inferno': {
        // Purge with Flame: the free use is spent when it made the ploy cost 0
        if (op && o.cost === 0 && hasAbility(s, op, ID.purge)) {
          markUsedTp(s, seat, `nv.purge:${op.id}`)
          markFired('nvPurgeWithFlame')
        }
        break
      }
      default:
        break
    }
  },
}
registerPloyRule(NV_RULE)
