// Wyrmblade (docs/spec/13-teams.md section 6, rule ids T-WYR.n): the code hooks this team's data names, its team
// rule provider (team-rules.ts), its hook handlers (hooks.ts) and its ploy rules (ploys.ts).
//
// Map of the rules to the code below:
//  - HIDING (T-WYR.24-27): provider setAsideAtSetup / setAsideCap, the EMERGE action offered through offboardActions,
//    the end-of-TP2 deadline in the turningPoint.end hook. Nothing about hiding is secret, so view() redacts nothing.
//  - Cult Ambush, The Day Is At Hand, Coiled Serpent (T-WYR.29, 30, 35): the activation.start hook records the order
//    switch and "unseen" state as a per-activation effect; modifyWeaponRules / modifyAttackDice read it.
//  - Group Activation (T-WYR.23): provider chainActivation.
//  - Quicksilver Strike (T-WYR.14): provider reactions + the quicksilverStrike choice hook.
//  - Expert Swordsman and Creeping Shadow follow-ups (T-WYR.12, 20): pseudo ploys in the firefight.actionEnded window
//    (registerPloyRule extraOffers) that start a free action; Shadow Vector (T-WYR.8) is a ploy cost rule.
//  - Before-removal free actions (T-WYR.17, 37): the operative.incapacitated hook raises the Overthrow choice, then
//    the shared operative.incapacitated ploy window offers A Plan Generations in the Making; removals outside an attack
//    wait for that queue (provider pausableRemoval).
//  - Slink Into Darkness (T-WYR.34): the shared firefight.activationEnded ploy window.
import { abilityOffers } from '../abilities'
import { applyAplEffect, redirectAttack, ruleKey, ruleSetFor, continueRemovals } from '../attack-common'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { addEffect, markUsedTp, usedThisTp } from '../effects'
import { cancelAction, canStartFreeAction, finishAction, reactionDone, startDelegatedAction, startFreeAction } from '../firefight'
import { bearing, distToPolygon, polygonBBox, round3, segmentBBoxOverlaps, segmentPolygonIntervals } from '../geometry'
import { registerFrameResume, registerHook, type TargetStatusData } from '../hooks'
import { bodyOf, visible } from '../los'
import { distanceBetween } from '../measure'
import { planMove } from '../movement'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { continueWindow } from '../ploys'
import type { Ctx } from '../registry'
import { incapacitateOffboard, placementSpots, returnToKillzone } from '../reserve'
import { activeOps, effectiveMove, enemiesOf, getOp, readyOps } from '../state'
import { resumeGambit } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { terrainOf } from '../terrain'
import { moveTokenTo, tokenCount } from '../tokens'
import type { ActiveEffect, GameState, Operative, Seat, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'wyrmblade'

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const A = (id: string) => `wyr.a.${id}`
const P = (id: string) => `wyr.p.${id}`
const W = (id: string) => `wyr.w.${id}`

const EMERGE = A('emerge')
const SHADOW_VECTOR = A('shadow-vector')
const QUICKSILVER = A('quicksilver-strike')
const OVERTHROW = A('overthrow-the-oppressors')
const GROUP_ACTIVATION = A('group-activation')
const HEROIC = A('heroic-inspiration')
const BIPOD = A('heavy-weapon-bipod')
const ICON = A('icon-bearer')
const GUNSLINGER = A('expert-gunslinger')
const SWORDSMAN = A('expert-swordsman')
const BLADED = A('bladed-stance')
const CREEPING = A('creeping-shadow')
const SOULSIGHT_SNIPER = A('familiars-soulsight-sniper')
const SOULSIGHT_TALON = A('familiars-soulsight-talon')
const TARGET_VULN = A('target-vulnerability')

const DAY = P('the-day-is-at-hand')
const CROSSFIRE = P('crossfire')
const SHADOWS = P('one-with-the-shadows')
const SLINK = P('slink-into-darkness')
const COILED = P('coiled-serpent')
const PLAN = P('a-plan-generations-in-the-making')

const ACT_FX = 'wyr.activation'
const KILL_FX = 'wyr.kill'
const ASSASSINATE_FX = 'wyr.assassinate'
const SLINK_FX = 'wyr.slink'
const SOULSIGHT_TOKEN = 'wyr.soulsight'
const SNIPER_GROUP = 'wyr.wg.sanctus-sniper-rifle'
const STATIONARY = W('sanctus-sniper-rifle-stationary')
const BIO_DAGGER = W('sanctus-bio-dagger')

const SPOTLIGHTS = 'wyr.e.spotlights'
const TRAPS = 'wyr.e.explosive-traps'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isWyr = (s: GameState, op: Operative): boolean => hasKeyword(s, op, 'WYRMBLADE')
const isNeophyte = (s: GameState, op: Operative): boolean => hasKeyword(s, op, 'NEOPHYTE')
const isCultAgent = (s: GameState, op: Operative): boolean => hasKeyword(s, op, 'CULT AGENT')
const hidingOf = (op: Operative): boolean => op.status === 'reserve' && op.offboard === 'setAside'

function wyrTeam(s: GameState, seat: Seat): boolean {
  return s.players[seat].teamId === TEAM_ID
}

function aliveOps(s: GameState, seat: Seat): Operative[] {
  return activeOps(s).filter((o) => o.seat === seat && o.wounds > 0)
}

/** A team flag a strategy ploy leaves for the turning point. */
function tpFlag(s: GameState, seat: Seat, ployId: string): boolean {
  return s.effects.some((e) => e.source === ployId && e.seat === seat && e.kind === 'ployFlag')
}

function activationFx(s: GameState, opId: string): ActiveEffect | undefined {
  return s.effects.find((e) => e.source === ACT_FX && e.operativeId === opId)
}

function operativeEffect(s: GameState, source: string, opId: string): ActiveEffect | undefined {
  return s.effects.find((e) => e.source === source && e.operativeId === opId)
}

/** Is the weapon one printed on the operative's own datacard (not equipment)? */
function datacardWeapon(s: GameState, op: Operative, weaponId: string): boolean {
  const card = s.data.datacards[op.datacardId]
  return !!card && (card.fixedWeapons.includes(weaponId) || (card.legalLoadouts ?? []).some((l) => l.includes(weaponId)) || card.weaponOptions.some((o) => o.from.includes(weaponId)))
}

const hasRef = (rules: WeaponRuleRef[], key: string): boolean => rules.some((r) => ruleKey(r.rule) === key)

function counteracting(s: GameState, op: Operative): boolean {
  const act = s.firefight.activation
  return !!act && act.counteract && act.operativeId === op.id
}

function setOrder(ctx: Ctx, op: Operative, order: 'engage' | 'conceal'): void {
  if (op.order === order) return
  if (op.flags.guard) {
    op.flags.guard = false
    ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'order' }, op.seat)
  }
  op.order = order
  ctx.emit({ type: 'OrderSet', operativeId: op.id, order })
}

// ---------------------------------------------------------------------------
// Charge feasibility (Quicksilver Strike, Assassinate, Divert and Disappear, Expert Swordsman)
// ---------------------------------------------------------------------------

/**
 * Could `op` Charge up to `maxMove` and finish in `target`'s control range? Straight-line probes around the
 * target through the engine's own path check (terrain, bases and control range rules), so an offered Charge
 * is one the move.path decision will accept. Control range is 1".
 */
export function canChargeInto(state: GameState, op: Operative, target: Operative, maxMove: number): boolean {
  if (target.status !== 'active' || target.wounds <= 0 || target.seat === op.seat) return false
  if (distanceBetween(bodyOf(op), bodyOf(target)) > maxMove + 1 + 1e-6) return false
  const base = Math.atan2(op.pos.z - target.pos.z, op.pos.x - target.pos.x)
  for (const off of [0, 0.45, -0.45, 1, -1, 1.7, -1.7, Math.PI]) {
    for (const gap of [0.4, 0.9]) {
      const d = op.baseRadius + target.baseRadius + gap
      const p = { x: round3(target.pos.x + Math.cos(base + off) * d), z: round3(target.pos.z + Math.sin(base + off) * d) }
      if (planMove(state, op, 'charge', [p], false, maxMove, target.id).ok) return true
    }
  }
  return false
}

function canChargeAny(state: GameState, op: Operative, maxMove: number): boolean {
  return enemiesOf(state, op).some((e) => canChargeInto(state, op, e, maxMove))
}

// ---------------------------------------------------------------------------
// The team rule provider
// ---------------------------------------------------------------------------

/** Spots where a hiding operative may emerge: wholly within 6" of the drop zone, more than 6" from every enemy (T-WYR.25). */
function emergeOk(state: GameState, op: Operative, p: { x: number; z: number }): boolean {
  const zone = state.map.dropZones.find((z) => z.id === state.players[op.seat].dropZoneId)
  if (!zone) return false
  if (distToPolygon(p, zone.polygon) + op.baseRadius > 6 + 1e-6) return false
  const body = bodyOf({ ...op, pos: { x: p.x, y: 0, z: p.z } })
  for (const e of enemiesOf(state, op)) if (distanceBetween(body, bodyOf(e)) <= 6 + 1e-6) return false
  return true
}

export function emergeSpots(state: GameState, op: Operative): Vec3[] {
  const zone = state.map.dropZones.find((z) => z.id === state.players[op.seat].dropZoneId)
  if (!zone) return []
  const box = polygonBBox(zone.polygon)
  const around = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 }
  const radius = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 6
  return placementSpots(state, op, { test: (p) => emergeOk(state, op, p), max: 8, around, radius })
}

registerTeamRules({
  id: TEAM_ID,

  // ---- before-removal free actions (T-WYR.17, 37) ----
  // a Neophyte incapacitated outside an attack (a mine, rule damage) waits for the before-removal queue whenever
  // Overthrow the Oppressors or A Plan Generations in the Making could answer it, so its owner is asked there
  pausableRemoval(s, op) {
    if (!isWyr(s, op) || !isNeophyte(s, op)) return false
    const plan = missionFeasible(s, op)
    const ploy = s.data.ploys?.[PLAN]
    if (plan && ploy && !usedThisTp(s, op.seat, PLAN) && s.players[op.seat].cp >= ploy.cost) return true
    return overthrowAvailable(s, op) && (plan || freeShootPossible(s, op))
  },

  // ---- HIDING at set-up (T-WYR.24) ----
  setAsideAtSetup: (s, op) => op.status === 'reserve' && op.offboard === undefined && isWyr(s, op) && isNeophyte(s, op) && !isCultAgent(s, op),
  setAsideCap(s, seat) {
    if (!wyrTeam(s, seat)) return null
    // RULING: one third rounds down on the number of operatives in the roster
    return Math.floor(Object.values(s.operatives).filter((o) => o.seat === seat).length / 3)
  },
  offboardActions: (s, op) => (isWyr(s, op) && hidingOf(op) ? [EMERGE] : []),

  // ---- activation shape ----
  maxRepeats(s, op, action) {
    if (action === 'shoot' && hasAbility(s, op, GUNSLINGER)) return 2
    if (action === 'fight' && hasAbility(s, op, SWORDSMAN)) return 2
    return null
  },
  chargeUnderConceal: (s, op) => hasAbility(s, op, CREEPING),
  chainActivation(s, expended, wasChained) {
    if (wasChained || !hasAbility(s, expended, GROUP_ACTIVATION)) return null
    // an emerging Warrior ignores Group Activation (T-WYR.25): it emerged in this very activation
    if ((expended.actionsThisTp ?? []).includes(`ability:${EMERGE}`)) return null
    return readyOps(s, expended.seat)
      .filter((o) => o.id !== expended.id && hasAbility(s, o, GROUP_ACTIVATION))
      .map((o) => o.id)
  },

  // ---- markers, cover, mines ----
  controlApl: (s, op, _m, apl) => (hasAbility(s, op, ICON) ? apl + 1 : null),
  // not cumulative with the improved cover save from Vantage terrain (T-WYR.28): the core adds no Stealthy-style
  // improvement once the defender took the Vantage one (handlers.vantageImprovementTaken)
  stealthyCover: (s, op) => (isCultAgent(s, op) ? 1 : 0),
  ignoresMine: (s, op, mine) => mine.equipmentId === TRAPS && mine.owner === op.seat && isWyr(s, op),

  // ---- Quicksilver Strike (T-WYR.14) ----
  reactions(s, seat, info) {
    if (info.activeSeat === seat || !info.moved) return []
    const actor = s.operatives[info.actorId]
    if (!actor || actor.status !== 'active' || actor.wounds <= 0 || actor.seat === seat) return []
    const out: ReactionOffer[] = []
    for (const op of aliveOps(s, seat)) {
      if (!hasAbility(s, op, QUICKSILVER) || usedThisTp(s, seat, `${QUICKSILVER}:${op.id}`)) continue
      if (inEnemyCr(s, op) || !canChargeInto(s, op, actor, 3)) continue
      out.push({
        hook: 'quicksilverStrike',
        operativeId: op.id,
        option: op.order === 'conceal' ? 'switch' : 'keep',
        labelKey: `ability.${QUICKSILVER}`,
        data: { name: `Quicksilver Strike: ${op.name} charges ${actor.name}`, actorId: actor.id },
      })
    }
    return out
  },

  // ---- Bladed Stance and Assassinate (T-WYR.13, 22) ----
  fightResolveStart(s, attack) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const queue: { seat: Seat; blockOnly?: boolean }[] = []
    for (const id of [attack.operativeId, attack.fight.targetId]) {
      const op = s.operatives[id]
      if (op && op.status === 'active' && hasAbility(s, op, BLADED)) queue.push({ seat: op.seat, blockOnly: true })
    }
    return queue.length > 0 ? { queue } : null
  },
  afterFightResolution(s, attack, seat, kind) {
    if (attack.kind !== 'fight' || !attack.fight || kind !== 'strike') return null
    const fx = operativeEffect(s, ASSASSINATE_FX, attack.operativeId)
    const talon = s.operatives[attack.operativeId]
    if (!fx || !talon || talon.seat !== seat) return null
    const data = (fx.data ??= {})
    if (data.used === true) {
      // the owed strike is done: blocking is allowed again
      if (data.openBlock === true) {
        data.openBlock = false
        attack.fight.noBlock = (attack.fight.noBlock ?? []).filter((x) => x !== seat)
      }
      return null
    }
    // the first strike of the Fight: strike again at once, before the opponent resolves anything
    data.used = true
    data.openBlock = true
    attack.fight.noBlock = [...(attack.fight.noBlock ?? []), seat]
    markFired('assassinate')
    return [{ seat }]
  },
})

// ---------------------------------------------------------------------------
// Passive hooks
// ---------------------------------------------------------------------------

// Set when an operative is activated: did its order switch from Conceal to Engage, and could the enemy not see it?
registerHook(
  'activation.start',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !c.engine || !op || !isWyr(s, op)) return null
    const d = c.data as { previousOrder: string; order: string }
    // RULING: an operative that is still hiding was never seen; emerging is not a switch from Conceal
    const hiding = op.status === 'reserve'
    const switched = !hiding && d.previousOrder === 'conceal' && d.order === 'engage'
    const unseen = hiding || !enemiesOf(s, op).some((e) => visible(s, bodyOf(e), bodyOf(op)))
    addEffect(c.engine, { source: ACT_FX, seat: op.seat, kind: ACT_FX, operativeId: op.id, expires: 'activation', data: { switched, unseen, ambush: switched || unseen, coiledUsed: false } })
    return null
  },
  'wyr.activationStart',
)

// HIDING ends with the second turning point (T-WYR.26): still hiding means incapacitated, without before-removal rules.
registerHook(
  'turningPoint.end',
  (c) => {
    const s = c.state
    if (!s || !c.engine || Number(c.data?.turningPoint) !== 2) return null
    for (const op of Object.values(s.operatives)) {
      if (hidingOf(op) && isWyr(s, op)) incapacitateOffboard(c.engine, op.id)
    }
    return null
  },
  'wyr.hidingDeadline',
)

// Heroic Inspiration remembers a kill by the Kelermorph for the rest of the turning point (T-WYR.10).
registerHook(
  'damage.inflicted',
  (c) => {
    const s = c.state
    const d = c.data as { attackerId: string; woundsBefore: number; woundsAfter: number }
    if (!s || !c.engine || !c.operativeId || d.woundsBefore <= 0 || d.woundsAfter > 0) return null
    const victim = s.operatives[c.operativeId]
    const attacker = s.operatives[d.attackerId]
    if (!victim || !attacker || victim.seat === attacker.seat || !hasAbility(s, attacker, HEROIC)) return null
    if (!operativeEffect(s, KILL_FX, attacker.id)) addEffect(c.engine, { source: KILL_FX, seat: attacker.seat, kind: KILL_FX, operativeId: attacker.id, expires: 'turningPoint' })
    return null
  },
  'wyr.kills',
)

// Crossfire remembers who has shot whom this turning point (T-WYR.31).
registerHook(
  'afterShootResolved',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isWyr(s, op) || !tpFlag(s, op.seat, CROSSFIRE)) return null
    for (const t of (c.data as { targets: string[] }).targets) markUsedTp(s, op.seat, `wyr.shot:${t}:${op.id}`)
    return null
  },
  'wyr.shotLedger',
)

/** Has a Wyrmblade operative other than `shooterId` already shot `targetId` this turning point? */
function shotByAnother(s: GameState, seat: Seat, targetId: string, shooterId: string): boolean {
  const prefix = `wyr.shot:${targetId}:`
  return s.ledger[seat].tp.some((k) => k.startsWith(prefix) && k !== `${prefix}${shooterId}`)
}

/** Friendly Kelermorph that makes `op`'s weapons Severe: visible to and within 3", and it has a kill this turning point. */
function heroicallyInspired(s: GameState, op: Operative): boolean {
  if (!isNeophyte(s, op) || !s.effects.some((e) => e.source === KILL_FX && e.seat === op.seat)) return false
  for (const k of aliveOps(s, op.seat)) {
    if (k.id === op.id || !hasAbility(s, k, HEROIC) || !operativeEffect(s, KILL_FX, k.id)) continue
    if (distanceBetween(bodyOf(k), bodyOf(op)) <= 3 + 1e-6 && visible(s, bodyOf(k), bodyOf(op))) return true
  }
  return false
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const weapon = s && c.weaponId ? s.data.weapons[c.weaponId] : undefined
    if (!s || !op || !weapon) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const foe = data.targetId ? s.operatives[data.targetId] : undefined
    if (isWyr(s, op)) {
      const fx = activationFx(s, op.id)
      // Cult Ambush (T-WYR.29): the activation effect only exists during the operative's own activation
      const ownAttack = !s.attack || s.attack.operativeId === op.id
      if (ownAttack && fx?.data?.ambush === true && !hasRef(data.rules, 'ceaseless')) {
        data.rules.push({ rule: 'ceaseless' })
      }
      // Heavy Weapon Bipod (T-WYR.15): Ceaseless when stationary or counteracting, Relentless when it already had Ceaseless
      if (data.kind === 'shoot' && hasAbility(s, op, BIPOD) && datacardWeapon(s, op, weapon.id) && ((op.movedThisActivation ?? 0) === 0 || counteracting(s, op))) {
        if (hasRef(data.rules, 'ceaseless')) {
          for (let i = data.rules.length - 1; i >= 0; i--) if (ruleKey(data.rules[i]!.rule) === 'ceaseless') data.rules.splice(i, 1)
          if (!hasRef(data.rules, 'relentless')) data.rules.push({ rule: 'relentless' })
        } else if (!hasRef(data.rules, 'relentless')) data.rules.push({ rule: 'ceaseless' })
      }
      // The Day Is At Hand (T-WYR.30): ranged weapons gain Rending after a Conceal to Engage switch
      if (fx?.data?.switched === true && weapon.type === 'ranged' && tpFlag(s, op.seat, DAY) && !hasRef(data.rules, 'rending')) data.rules.push({ rule: 'rending' })
      // Crossfire (T-WYR.31)
      if (data.kind === 'shoot' && weapon.type === 'ranged' && data.targetId && tpFlag(s, op.seat, CROSSFIRE) && shotByAnother(s, op.seat, data.targetId, op.id)) {
        data.rules.push({ rule: 'accurate', x: 1 })
      }
      // TARGET VULNERABILITY (T-WYR.18)
      if (weapon.id === STATIONARY && operativeEffect(s, TARGET_VULN, op.id)) data.rules.push({ rule: 'lethal', target: 5 })
      // Soulsight (T-WYR.19, 21)
      if (foe && tokenCount(s, foe.id, SOULSIGHT_TOKEN, op.seat) > 0) {
        if (data.kind === 'shoot' && weapon.profileGroup === SNIPER_GROUP && hasAbility(s, op, SOULSIGHT_SNIPER) && !hasRef(data.rules, 'saturate')) data.rules.push({ rule: 'saturate' })
        if (data.kind === 'fight' && weapon.id === BIO_DAGGER && hasAbility(s, op, SOULSIGHT_TALON)) {
          if (!hasRef(data.rules, 'brutal')) data.rules.push({ rule: 'brutal' })
          if (!hasRef(data.rules, 'balanced')) data.rules.push({ rule: 'balanced' })
        }
      }
      // Heroic Inspiration (T-WYR.10)
      if (!hasRef(data.rules, 'severe') && heroicallyInspired(s, op)) data.rules.push({ rule: 'severe' })
    }
    // Cult Agent (T-WYR.28): shooters ignore Piercing (and Piercing Crits) and Saturate against a cult agent
    if (data.kind === 'shoot' && foe && isCultAgent(s, foe)) {
      for (let i = data.rules.length - 1; i >= 0; i--) {
        const key = ruleKey(data.rules[i]!.rule)
        if (key === 'piercing' || key === 'piercingcrits' || key === 'saturate') {
          data.rules.splice(i, 1)
        }
      }
    }
    return null
  },
  'wyr.modifyWeaponRules',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const weapon = s && c.weaponId ? s.data.weapons[c.weaponId] : undefined
    if (!s || !op || !weapon || weapon.type !== 'melee' || !isWyr(s, op)) return null
    const data = c.data as { kind: string; atk: number }
    // The Day Is At Hand (T-WYR.30): +1 Atk on melee weapons, never above 5
    if (data.kind === 'fight' && activationFx(s, op.id)?.data?.switched === true && tpFlag(s, op.seat, DAY)) data.atk = Math.max(data.atk, Math.min(5, data.atk + 1))
    return null
  },
  'wyr.modifyAttackDice',
)

/** Intervening Light terrain that is more than 1" from both operatives (One With The Shadows, T-WYR.32). */
function lightObscures(s: GameState, shooter: Operative, target: Operative): boolean {
  const idx = terrainOf(s.map)
  const origin = { x: shooter.pos.x, z: shooter.pos.z }
  const a0 = Math.atan2(origin.x - target.pos.x, origin.z - target.pos.z)
  const ends = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2].map((off) => ({ x: target.pos.x + Math.sin(a0 + off) * target.baseRadius, z: target.pos.z + Math.cos(a0 + off) * target.baseRadius }))
  for (const sol of idx.solids) {
    if (!sol.light || sol.exposed) continue
    if (distToPolygon(shooter.pos, sol.polygon) - shooter.baseRadius <= 1 + 1e-6) continue
    if (distToPolygon(target.pos, sol.polygon) - target.baseRadius <= 1 + 1e-6) continue
    for (const e of ends) if (segmentCrosses(origin, e, sol.polygon)) return true
  }
  return false
}

function segmentCrosses(a: { x: number; z: number }, b: { x: number; z: number }, poly: { x: number; z: number }[]): boolean {
  return segmentPolygonIntervals(a, b, poly).length > 0 && segmentBBoxOverlaps(a, b, polygonBBox(poly))
}

registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !shooter || !target) return null
    const data = c.data as unknown as TargetStatusData
    // One With The Shadows adds obscured to a Conceal Wyrmblade target (T-WYR.32)
    if (!data.obscured && isWyr(s, target) && target.order === 'conceal' && tpFlag(s, target.seat, SHADOWS) && lightObscures(s, shooter, target)) {
      data.obscured = true
      markFired('tpFlagPloy')
    }
    if (!data.obscured || !isWyr(s, shooter)) return null
    // Hypersense profile (T-WYR.11)
    const atk = s.attack
    if (atk && atk.kind === 'shoot' && atk.operativeId === shooter.id && atk.weaponId && s.data.weapons[atk.weaponId]?.rules.some((r) => r.rule === 'hypersense')) {
      data.obscured = false
      return null
    }
    // Soulsight on the target (T-WYR.19)
    if (hasAbility(s, shooter, SOULSIGHT_SNIPER) && tokenCount(s, target.id, SOULSIGHT_TOKEN, shooter.seat) > 0) {
      data.obscured = false
      return null
    }
    // Spotlights (T-WYR.41)
    if (s.players[shooter.seat].equipment.includes(SPOTLIGHTS)) {
      for (const n of aliveOps(s, shooter.seat)) {
        if (!isNeophyte(s, n) || distanceBetween(bodyOf(n), bodyOf(target)) > 6 + 1e-6 || !visible(s, bodyOf(n), bodyOf(target)) || inEnemyCr(s, n)) continue
        data.obscured = false
        return null
      }
    }
    return null
  },
  'wyr.targetStatus',
)

// ---------------------------------------------------------------------------
// Code hooks: unique actions
// ---------------------------------------------------------------------------

// EMERGE (T-WYR.25): a hiding operative sets up as a Reposition.
registerCodeHook({
  name: 'emerge',
  action: {
    offers(state, op): OfferSeed[] {
      if (!hidingOf(op)) return []
      return emergeSpots(state, op).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const spots = emergeSpots(ctx.state, op)
      const act = ctx.state.firefight.activation
      if (!act || !act.declared || spots.length === 0) {
        cancelAction(ctx)
        return
      }
      // counts as the Reposition action for every restriction (Charge, Fall Back and Heavy weapons)
      act.declared = { ...act.declared, params: { ...(act.declared.params ?? {}), treatedAs: 'reposition' } }
      const options = spots.flatMap((p) =>
        (['engage', 'conceal'] as const).map((order) => ({
          id: `${order}@${p.x},${p.z}`,
          labelKey: 'emerge.at',
          type: 'ability.choice' as const,
          payload: { option: `${order}@${p.x},${p.z}` },
          data: { x: p.x, y: p.y, z: p.z, order, name: `Emerge at (${p.x}, ${p.z}) with ${order === 'engage' ? 'Engage' : 'Conceal'}` },
        })),
      )
      ctx.raise({ kind: 'ability.choice', seat: op.seat, window: 'firefight.actionDeclared', context: { hook: 'emerge', operativeId: op.id, abilityId: def.id }, options, canPass: true })
    },
  },
  choice(ctx, op, option) {
    const m = /^(engage|conceal)@(-?[\d.]+),(-?[\d.]+)$/.exec(option)
    if (!m) {
      cancelAction(ctx)
      return
    }
    const pos = { x: Number(m[2]), y: 0, z: Number(m[3]) }
    if (!hidingOf(op) || !emergeOk(ctx.state, op, pos) || !returnToKillzone(ctx, op.id, { pos, order: m[1] as 'engage' | 'conceal', kind: 'emerge' })) {
      cancelAction(ctx)
      return
    }
    op.facing = bearing(pos, { x: 0, z: 0 })
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: EMERGE }, op.seat)
    finishAction(ctx)
  },
})

// TARGET VULNERABILITY (T-WYR.18)
registerCodeHook({
  name: 'targetVulnerability',
  action: {
    offers: (_s, op): OfferSeed[] => (op.weapons.includes(STATIONARY) ? [{ key: '', params: {} }] : []),
    perform(ctx, op, def) {
      addEffect(ctx, { source: TARGET_VULN, seat: op.seat, kind: 'ability', operativeId: op.id, expires: 'activation' })
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// FAMILIAR'S SOULSIGHT (T-WYR.19, 21): one token per team, shared by the Sniper and the Talon.
registerCodeHook({
  name: 'soulsight',
  action: {
    offers: (state, op): OfferSeed[] =>
      enemiesOf(state, op)
        .filter((e) => e.wounds > 0 && visible(state, bodyOf(op), bodyOf(e)))
        .map((e) => ({ key: e.id, params: { targetId: e.id } })),
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!target || target.status !== 'active' || target.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      moveTokenTo(ctx, SOULSIGHT_TOKEN, op.seat, target.id, { sourceId: op.id }, 'soulsight')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ASSASSINATE (T-WYR.22): a free Charge of up to Move ending in the target's control range, then a free Fight against it.
function assassinateTargets(state: GameState, op: Operative): Operative[] {
  const move = effectiveMove(op, state)
  return enemiesOf(state, op).filter((e) => e.wounds > 0 && !visible(state, bodyOf(e), bodyOf(op)) && canChargeInto(state, op, e, move))
}

registerCodeHook({
  name: 'assassinate',
  action: {
    offers: (state, op): OfferSeed[] => assassinateTargets(state, op).map((e) => ({ key: e.id, params: { targetId: e.id } })),
    perform(ctx, op, _def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      const started = startFreeAction(ctx, { operativeId: op.id, action: 'charge', maxMove: effectiveMove(op, ctx.state), endWithinCrOf: target.id, resume: 'wyr.assassinate', data: { stage: 'charge', targetId: target.id } })
      if (!started) cancelAction(ctx)
    },
  },
})

registerFrameResume('wyr.assassinate', (ctx, outcome, data) => {
  const act = ctx.state.firefight.activation
  if (!act) return
  if (data.stage === 'charge') {
    if (outcome === 'cancelled') {
      cancelAction(ctx)
      return
    }
    const opId = act.operativeId
    addEffect(ctx, { source: ASSASSINATE_FX, seat: act.seat, kind: 'ability', operativeId: opId, expires: 'activation', data: { targetId: data.targetId, used: false } })
    const targetId = String(data.targetId)
    if (!startFreeAction(ctx, { operativeId: opId, action: 'fight', resume: 'wyr.assassinate', data: { stage: 'fight', targetId } })) {
      finishAction(ctx)
      return
    }
    // the Fight is against the enemy the Charge ended beside
    const p = ctx.state.pending
    if (p && p.kind === 'fight.target' && p.options) {
      const keep = p.options.filter((o) => (o.action.payload as { targetId?: string }).targetId === targetId)
      if (keep.length > 0) p.options = keep
    }
    return
  }
  // the Fight is over (or declined): the Assassinate action is done
  finishAction(ctx)
})

// ---------------------------------------------------------------------------
// Code hooks: the reaction (Quicksilver Strike)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'quicksilverStrike',
  choice(ctx, op, option, context) {
    const s = ctx.state
    const actor = s.operatives[String(context.actorId)]
    const key = `${QUICKSILVER}:${op.id}`
    if (!actor || actor.status !== 'active' || usedThisTp(s, op.seat, key) || op.status !== 'active') {
      reactionDone(ctx)
      return
    }
    const previous = op.order
    markUsedTp(s, op.seat, key)
    if (option === 'switch') setOrder(ctx, op, 'engage')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: QUICKSILVER, detail: actor.id }, op.seat)
    const started = startFreeAction(ctx, { operativeId: op.id, action: 'charge', maxMove: 3, endWithinCrOf: actor.id, resume: 'wyr.quicksilver', data: { key, previous, opId: op.id } })
    if (!started) {
      // not possible after all: the interruption is cancelled and the rule is not used up
      s.ledger[op.seat].tp = s.ledger[op.seat].tp.filter((k) => k !== key)
      if (previous !== op.order) setOrder(ctx, op, previous)
      reactionDone(ctx)
    }
  },
})

registerFrameResume('wyr.quicksilver', (ctx, outcome, data) => {
  if (outcome === 'cancelled') {
    // the Charge was not made: the use is handed back
    const frameOp = ctx.state.operatives[String(data.opId)]
    if (frameOp) {
      ctx.state.ledger[frameOp.seat].tp = ctx.state.ledger[frameOp.seat].tp.filter((k) => k !== data.key)
      if (frameOp.order !== data.previous) setOrder(ctx, frameOp, data.previous as 'engage' | 'conceal')
    }
  }
  reactionDone(ctx)
})

// ---------------------------------------------------------------------------
// Code hooks: ploys
// ---------------------------------------------------------------------------

// THE DAY IS AT HAND, CROSSFIRE and ONE WITH THE SHADOWS: a flag for the turning point that the hooks above read.
registerCodeHook({
  name: 'tpFlagPloy',
  ploy: {
    offers: (): PloyOfferSeed[] => [{}],
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

// SLINK INTO DARKNESS (T-WYR.34): the shared end-of-activation ploy window (firefight.activationEnded), opened for
// the operative's own activation only (a counteraction is not an activation) and only while it is in the killzone.
registerCodeHook({
  name: 'slinkIntoDarkness',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const act = state.firefight.activation
      if (!op || op.seat !== seat || op.status !== 'active' || !isWyr(state, op) || op.order !== 'engage') return []
      if (op.oncePerBattleUsed.includes(SLINK_FX)) return []
      if (!act || act.operativeId !== op.id || act.counteract || act.frame) return []
      return [{}]
    },
    apply(ctx, _seat, _ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      op.oncePerBattleUsed.push(SLINK_FX)
      if (op.order === 'engage') setOrder(ctx, op, 'conceal')
    },
  },
})

// COILED SERPENT (T-WYR.35)
function firstAttackOfActivation(s: GameState, opId: string): boolean {
  const lists = [s.firefight.activation, ...(s.firefight.stack ?? [])].filter((a) => a && a.operativeId === opId).map((a) => a!.performed)
  return !lists.some((p) => p.includes('shoot') || p.includes('fight'))
}

registerCodeHook({
  name: 'coiledSerpent',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || !isWyr(state, op) || info.attackerId !== op.id) return []
      const fx = activationFx(state, op.id)
      if (fx?.data?.switched !== true || fx.data.coiledUsed === true || !firstAttackOfActivation(state, op.id)) return []
      const seq = state.attack?.seq
      if (!seq || !seq.atk.dice.some((d) => d.kind === 'normal' && !d.used)) return []
      return [{}]
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const seq = ctx.state.attack?.seq
      const fx = info.subjectId ? activationFx(ctx.state, info.subjectId) : undefined
      if (!seq || !fx) return
      const die = seq.atk.dice.find((d) => d.kind === 'normal' && !d.used && d.value !== null) ?? seq.atk.dice.find((d) => d.kind === 'normal' && !d.used)
      if (!die) return
      die.kind = 'crit'
      die.tag = die.tag ?? 'coiledSerpent'
      fx.data = { ...(fx.data ?? {}), coiledUsed: true }
      ctx.emit({ type: 'AbilityUsed', operativeId: info.subjectId ?? null, abilityId: COILED }, seat)
    },
  },
})

// UNQUESTIONING LOYALTY (T-WYR.36)
function loyalSubstitutes(state: GameState, target: Operative): Operative[] {
  return aliveOps(state, target.seat).filter(
    (o) => o.id !== target.id && isNeophyte(state, o) && !hasKeyword(state, o, 'LEADER') && distanceBetween(bodyOf(target), bodyOf(o)) <= 3 + 1e-6 && visible(state, bodyOf(target), bodyOf(o)),
  )
}

registerCodeHook({
  name: 'unquestioningLoyalty',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const target = info.targetId ? state.operatives[info.targetId] : undefined
      if (!target || target.seat !== seat || info.subjectId !== target.id || !isWyr(state, target)) return []
      if (!isCultAgent(state, target) && !hasKeyword(state, target, 'LEADER')) return []
      const a = state.attack
      if (!a || (a.kind === 'shoot' && !a.weaponId)) return []
      if (a.kind === 'shoot') {
        const attacker = state.operatives[a.operativeId]
        if (!attacker) return []
        const rules = ruleSetFor(state, attacker, a.weaponId!, 'shoot', target.id)
        if (rules.blast !== null || rules.torrent !== null) return []
      }
      return loyalSubstitutes(state, target).map((o) => ({ param: o.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      if (seed.param && redirectAttack(ctx, seed.param)) ctx.emit({ type: 'AbilityUsed', operativeId: seed.param, abilityId: P('unquestioning-loyalty') }, seat)
    },
  },
})

// DIVERT AND DISAPPEAR (T-WYR.33)
interface DivertOption {
  opId: string
  kind: 'dash' | 'charge' | 'fallBack'
  cost: number
}

function divertOptions(s: GameState, seat: Seat, slotsLeft: number, used: string[]): DivertOption[] {
  const out: DivertOption[] = []
  for (const op of aliveOps(s, seat)) {
    if (!isWyr(s, op) || used.includes(op.id)) continue
    const agent = isCultAgent(s, op)
    const cost = agent ? 2 : 1
    if (cost > slotsLeft) continue
    if (canStartFreeAction(s, { operativeId: op.id, action: 'dash', resume: '' })) out.push({ opId: op.id, kind: 'dash', cost })
    if (canStartFreeAction(s, { operativeId: op.id, action: 'charge', maxMove: 3, resume: '' }) && canChargeAny(s, op, 3)) out.push({ opId: op.id, kind: 'charge', cost })
    if (agent && canStartFreeAction(s, { operativeId: op.id, action: 'fallBack', maxMove: 3, resume: '' })) out.push({ opId: op.id, kind: 'fallBack', cost })
  }
  return out
}

function promptDivert(ctx: Ctx, seat: Seat, slotsLeft: number, used: string[]): void {
  const opts = divertOptions(ctx.state, seat, slotsLeft, used)
  if (slotsLeft <= 0 || opts.length === 0) {
    resumeGambit(ctx)
    return
  }
  const label = (o: DivertOption) => `${getOp(ctx.state, o.opId).name}: ${o.kind === 'dash' ? 'free Dash' : o.kind === 'charge' ? 'free Charge (3")' : 'free Fall Back (3", -1 APL)'}`
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'divertAndDisappear', operativeId: opts[0]!.opId, seat, slotsLeft, used },
    options: [
      ...opts.map((o) => ({ id: `${o.opId}:${o.kind}`, labelKey: 'divert.move', type: 'ability.choice' as const, payload: { option: `${o.opId}:${o.kind}` }, data: { name: label(o), cost: o.cost } })),
      { id: 'done', labelKey: 'divert.done', type: 'ability.choice' as const, payload: { option: 'done' }, data: { name: 'Done' } },
    ],
  })
}

registerCodeHook({
  name: 'divertAndDisappear',
  ploy: {
    offers: (state, seat): PloyOfferSeed[] => (divertOptions(state, seat, 3, []).length > 0 ? [{}] : []),
    apply(ctx, seat) {
      promptDivert(ctx, seat, 3, [])
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const slotsLeft = Number(context.slotsLeft)
    const used = (context.used as string[]) ?? []
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const [opId, kind] = option.split(':') as [string, DivertOption['kind']]
    const op = ctx.state.operatives[opId!]
    const cost = op && isCultAgent(ctx.state, op) ? 2 : 1
    const started = !!op && startFreeAction(ctx, { operativeId: op.id, action: kind, ...(kind === 'dash' ? {} : { maxMove: 3 }), resume: 'wyr.divert', data: { seat, slotsLeft: slotsLeft - cost, used: [...used, opId], kind, opId } })
    if (!started) promptDivert(ctx, seat, slotsLeft, [...used, opId!])
  },
})

registerFrameResume('wyr.divert', (ctx, outcome, data) => {
  const op = ctx.state.operatives[String(data.opId)]
  // a Cult Agent that fell back has -1 APL until the end of its next activation
  if (outcome === 'finished' && data.kind === 'fallBack' && op && op.status === 'active') applyAplEffect(ctx, op.id, -1, P('divert-and-disappear'))
  promptDivert(ctx, data.seat as Seat, Number(data.slotsLeft), (data.used as string[]) ?? [])
})

// ---------------------------------------------------------------------------
// Before-removal free actions: Overthrow the Oppressors and A Plan Generations in the Making (T-WYR.17, 37)
// ---------------------------------------------------------------------------

registerCodeHook({ name: 'overthrowOppressors' })

/** A free mission action the incapacitated operative could take. */
function missionFeasible(s: GameState, op: Operative): boolean {
  return abilityOffers(s, op, null).some((o) => (s.data.abilities[o.abilityId]?.keywords ?? []).includes('MISSION'))
}

/** Could the operative take a free Shoot, switching its order to Engage first? */
function freeShootPossible(s: GameState, op: Operative): boolean {
  const order = op.order
  op.order = 'engage'
  try {
    return canStartFreeAction(s, { operativeId: op.id, action: 'shoot', resume: '' })
  } finally {
    op.order = order
  }
}

function overthrowAvailable(s: GameState, victim: Operative): boolean {
  if (!victim.ready || usedThisTp(s, victim.seat, OVERTHROW)) return false
  return aliveOps(s, victim.seat).some((o) => o.id !== victim.id && hasAbility(s, o, OVERTHROW) && distanceBetween(bodyOf(o), bodyOf(victim)) <= 6 + 1e-6 && visible(s, bodyOf(o), bodyOf(victim)))
}

registerHook(
  'operative.incapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    // only inside a removal queue, which can wait for the answer (mines and direct damage wait for one: pausableRemoval)
    if (!s || !ctx || !victim || !s.removal || victim.status !== 'active' || !isWyr(s, victim) || !isNeophyte(s, victim)) return null
    const seat = victim.seat
    // Overthrow the Oppressors is a rule, asked here; A Plan Generations in the Making at its printed cost is a ploy,
    // offered by the operative.incapacitated ploy window that follows (planGenerations ploy below)
    const planOk = missionFeasible(s, victim)
    const ployFree = !usedThisTp(s, seat, PLAN)
    const over = overthrowAvailable(s, victim)
    const options: { id: string; name: string }[] = []
    if (over && planOk && ployFree) options.push({ id: 'overthrow-plan', name: 'Overthrow the Oppressors: A Plan Generations in the Making for 0 CP (a free mission action)' })
    if (over && freeShootPossible(s, victim)) options.push({ id: 'overthrow-shoot', name: 'Overthrow the Oppressors: a free Shoot' })
    if (options.length === 0) return null
    options.push({ id: 'none', name: 'Let it fall' })
    ctx.raise({
      kind: 'ability.choice',
      seat,
      window: 'operative.incapacitated',
      context: { hook: 'planGenerations', operativeId: victim.id },
      options: options.map((o) => ({ id: o.id, labelKey: 'removal.free', type: 'ability.choice' as const, payload: { option: o.id }, data: { name: o.name } })),
    })
    return null
  },
  'wyr.beforeRemoval',
)

registerCodeHook({
  name: 'planGenerations',
  // the ploy at its printed cost, in the shared operative.incapacitated window of an attack's removal queue
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const victim = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!victim || victim.seat !== seat || victim.status !== 'active' || !state.removal || !isWyr(state, victim) || !isNeophyte(state, victim)) return []
      return missionFeasible(state, victim) ? [{}] : []
    },
    apply(ctx, _seat, _ploy, _seed, info) {
      const s = ctx.state
      const victim = info.subjectId ? s.operatives[info.subjectId] : undefined
      if (!victim || !s.removal) return
      // the window waits aside while the free action runs (startDelegatedAction keeps it), and so does the removal
      const saved = JSON.parse(JSON.stringify(s.removal)) as NonNullable<GameState['removal']>
      startDelegatedAction(ctx, { operativeId: victim.id, resume: 'wyr.planWindow', rules: { allow: ['mission'] }, data: { removal: saved } })
    },
  },
  // the Overthrow the Oppressors choice raised by the before-removal hook
  choice(ctx, op, option) {
    const s = ctx.state
    const seat = op.seat
    if (option === 'none' || !s.removal) {
      continueRemovals(ctx)
      return
    }
    // a free action of its own may start a removal of its own: keep this one and put it back afterwards
    const saved = JSON.parse(JSON.stringify(s.removal)) as NonNullable<GameState['removal']>
    if (option === 'overthrow-plan') {
      markUsedTp(s, seat, OVERTHROW)
      markFired('overthrowOppressors')
      markUsedTp(s, seat, PLAN)
      ctx.emit({ type: 'PloyUsed', ployId: PLAN }, seat)
      if (!startDelegatedAction(ctx, { operativeId: op.id, resume: 'wyr.beforeRemoval', rules: { allow: ['mission'] }, data: { removal: saved } })) continueRemovals(ctx)
      return
    }
    markUsedTp(s, seat, OVERTHROW)
    markFired('overthrowOppressors')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: OVERTHROW }, seat)
    setOrder(ctx, op, 'engage')
    if (!startFreeAction(ctx, { operativeId: op.id, action: 'shoot', resume: 'wyr.beforeRemoval', data: { removal: saved } })) continueRemovals(ctx)
  },
})

registerFrameResume('wyr.beforeRemoval', (ctx, _outcome, data) => {
  if (data.removal) ctx.state.removal = data.removal as NonNullable<GameState['removal']>
  continueRemovals(ctx)
})

// the ploy's free mission action is over: put the removal back and let the ploy window carry on (it then closes
// into continueRemovals)
registerFrameResume('wyr.planWindow', (ctx, _outcome, data) => {
  if (data.removal) ctx.state.removal = data.removal as NonNullable<GameState['removal']>
  if (ctx.state.window) continueWindow(ctx)
  else continueRemovals(ctx)
})

// ---------------------------------------------------------------------------
// Ploy rules: Shadow Vector, Expert Swordsman and Creeping Shadow follow-ups
// ---------------------------------------------------------------------------

// named by the Leader's data (every Wyrmblade roster has one); the ploy rule itself registers at module load below
registerCodeHook({ name: 'shadowVector', setup: () => undefined })

const PLOY_RULE: PloyRule = {
  extraOffers(state, seat, window, info): PloyOffer[] {
    if (window !== 'firefight.actionEnded' || !info.subjectId) return []
    const op = state.operatives[info.subjectId]
    if (!op || op.seat !== seat || op.status !== 'active' || op.wounds <= 0) return []
    const used = state.window?.used ?? []
    const last = info.action
    const out: PloyOffer[] = []
    const cap = info.counteracting ? 2 : 3
    // Expert Swordsman (T-WYR.12): a free Charge of up to 3" when a Fight leaves no enemy in control range
    if (last === 'fight' && hasAbility(state, op, SWORDSMAN) && !used.includes(SWORDSMAN) && !inEnemyCr(state, op) && canStartFreeAction(state, { operativeId: op.id, action: 'charge', maxMove: cap, resume: '' }) && canChargeAny(state, op, cap)) {
      out.push({ id: SWORDSMAN, ployId: SWORDSMAN, name: `Expert Swordsman: free Charge (${cap}")`, cost: 0, via: 'wyr.swordsman', seed: {}, operativeId: op.id })
    }
    // Creeping Shadow (T-WYR.20): a free Dash or Fall Back of up to 3" after any Fight, Assassinate's included
    if ((last === 'fight' || last === `ability:${A('assassinate')}`) && hasAbility(state, op, CREEPING) && !used.includes(CREEPING)) {
      // a counteracting operative never moves more than 2", a free Dash included
      const dashCap = info.counteracting ? { maxMove: 2 } : {}
      if (canStartFreeAction(state, { operativeId: op.id, action: 'dash', ...dashCap, resume: '' })) {
        out.push({ id: `${CREEPING}:dash`, ployId: CREEPING, name: `Creeping Shadow: free Dash${info.counteracting ? ' (2")' : ''}`, param: 'dash', cost: 0, via: 'wyr.creeping', seed: { param: 'dash' }, operativeId: op.id })
      }
      if (canStartFreeAction(state, { operativeId: op.id, action: 'fallBack', maxMove: cap, resume: '' })) {
        out.push({ id: `${CREEPING}:fallBack`, ployId: CREEPING, name: `Creeping Shadow: free Fall Back (${cap}")`, param: 'fallBack', cost: 0, via: 'wyr.creeping', seed: { param: 'fallBack' }, operativeId: op.id })
      }
    }
    return out
  },
  // Shadow Vector (T-WYR.8): Slink Into Darkness or Coiled Serpent for 0 CP, once per turning point, for a Neophyte the Leader sees
  costAdjust(state, seat, ploy, _seed, info) {
    if ((ploy.id !== SLINK && ploy.id !== COILED) || !info.subjectId || usedThisTp(state, seat, SHADOW_VECTOR)) return null
    const subject = state.operatives[info.subjectId]
    if (!subject || !isNeophyte(state, subject)) return null
    // RULING: the Leader cannot qualify itself ("visible to" presupposes another operative)
    const leader = aliveOps(state, seat).find((o) => o.id !== subject.id && hasAbility(state, o, SHADOW_VECTOR) && visible(state, bodyOf(o), bodyOf(subject)))
    return leader ? { cost: 0, via: 'shadowVector' } : null
  },
  onUsed(ctx, seat, offer, info) {
    if (offer.via === 'shadowVector') {
      markUsedTp(ctx.state, seat, SHADOW_VECTOR)
      const leader = aliveOps(ctx.state, seat).find((o) => hasAbility(ctx.state, o, SHADOW_VECTOR))
      ctx.emit({ type: 'AbilityUsed', operativeId: leader?.id ?? null, abilityId: SHADOW_VECTOR, detail: info.subjectId ?? '' }, seat)
      return
    }
    const op = offer.operativeId ? ctx.state.operatives[offer.operativeId] : undefined
    if (!op) return
    if (offer.via === 'wyr.swordsman') {
      const cap = info.counteracting ? 2 : 3
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: SWORDSMAN }, seat)
      startFreeAction(ctx, { operativeId: op.id, action: 'charge', maxMove: cap, resume: 'ploy.freeAction' })
    } else if (offer.via === 'wyr.creeping') {
      const cap = info.counteracting ? 2 : 3
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: CREEPING }, seat)
      const fall = offer.param === 'fallBack'
      const capped = fall || info.counteracting
      startFreeAction(ctx, { operativeId: op.id, action: fall ? 'fallBack' : 'dash', ...(capped ? { maxMove: cap } : {}), resume: 'ploy.freeAction' })
    }
  },
}

registerPloyRule(PLOY_RULE)
