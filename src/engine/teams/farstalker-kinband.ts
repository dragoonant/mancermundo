// Farstalker Kinband (docs/spec/13-teams.md section 16, rule ids T-FK.n): the code hooks this team's data names, its team
// rule provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules
// (ploy-rules.ts). Built on the batch A, B and C generic layers; no shared engine file names this team.
//
// Map of the rules to the code below:
//  - Call the Kill, Victory Shriek (T-FK.7, 8): the strategic gambit sets a mark (an effect holding the mark's id plus a
//    public token); the new-mark pick and the Victory Shriek pick are 0 CP offers (ploy rule extraOffers) in the
//    operative.killed window or, as the brief's fallback, at the seat's next activation-start / action-ended window.
//  - FARSTALKER (T-FK.27, 28): a free "Ready step" gambit record (ability.choice loop) and the provider
//    counteractAlternatives (the order change instead of a counteraction).
//  - Beast, Bad-tempered, GATHER (T-FK.14 to 17): providers actionForbidden / weaponForbidden / equipmentEligible,
//    a fightTargets filter fed by a 0 CP offer at the enemy's Fight declaration, the provider `reactions` for the free
//    Charge, and a three-part free-move action.
//  - Weapon rules, Hardy, Cold-blooded, Vicious Duellist, Energise, Long-Sight, Pech'ra, Prey, Rogue, Vengeance, the
//    ammunition: modifyWeaponRules / onDamageInflicted / afterAttackRoll / target.status / beforeShootTargetSelect.
//  - Savage Assault, Quick Draw, Piercing Shot, Toxin Shot, Meat, Trophy, Ready for Anything: 0 CP offers.
import { applyAplEffect, blastSecondaries, parseRules, ruleKey, ruleSetFor, targetInfo, validTargets, weaponDamage } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed, type PloyWindowInfo } from '../code-hooks'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { commsBonus } from '../core-hooks'
import { addEffect, directDamage, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { afterActiveOperativeRemoved, cancelAction, canStartFreeAction, finishAction, reactionDone, startFreeAction } from '../firefight'
import { registerFrameResume, registerHook, type ActionEndedData, type DamageInflictedData } from '../hooks'
import { bodyOf, visible } from '../los'
import { newMarkerId, removeMarker } from '../markers'
import { distanceBetween, gapToMarker, inControlRange, isWithin, markerInControlRange } from '../measure'
import { moveLimit } from '../movement'
import { registerPloyRule, type PloyOffer } from '../ploy-rules'
import { continueWindow } from '../ploys'
import { markerControl } from '../query'
import type { Ctx } from '../registry'
import { usableRangedWeapons } from '../shoot'
import { activeOps, effectiveMove, enemiesOf, isInjured } from '../state'
import { readyChoiceDone } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { distToPolygon } from '../geometry'
import { terrainOf } from '../terrain'
import { addToken, hasToken, moveTokenTo } from '../tokens'
import type { Activation, GameState, Marker, Operative, Seat, WeaponRuleRef } from '../types'
import { markerSpots } from './hierotek-circle'
import { canChargeInto } from './wyrmblade'

export const TEAM_ID = 'farstalker-kinband'

const FK = 'FARSTALKER KINBAND'
const EPS = 1e-6

const A = (id: string) => `fk.a.${id}`
const P = (id: string) => `fk.p.${id}`
const E = (id: string) => `fk.e.${id}`
/** Pseudo ploy ids of the 0 CP offers that are not ploy or equipment records. */
const X = (id: string) => `fk.x.${id}`

const HARDY = A('hardy')
const COLD = A('cold-blooded')
const DUELLIST = A('vicious-duellist')
const ASSAULT = A('savage-assault')
const BEAST = A('beast')
const TEMPER = A('bad-tempered')
const QUICK_DRAW = A('quick-draw')
const STALKER = A('stalker')
const RFA = A('ready-for-anything')
const SHRIEK = A('victory-shriek')
const GATHER = A('gather')

const CALL_PLOY = P('call-the-kill')
const CUT_THROATS = P('cut-throats')
const ROGUE = P('rogue')
const PREY = P('prey')
const BOUND = P('bound')
const AMBUSH = P('savage-ambush')
const SLIP = P('slip-away')
const POACH = P('poach')
const VENGEANCE = P('vengeance-for-the-kinband')

const PIERCING_EQ = E('piercing-shot')
const TOXIN_EQ = E('toxin-shot')
const MEAT_EQ = E('meat')
const TROPHY_EQ = E('trophy')

/** Effect sources and ledger keys. */
const MARK = 'fk.mark'
const ENERGISE = 'fk.energise'
const LONG_SIGHT = 'fk.longSight'
const SA_FOUGHT = 'fk.sa.fought'
const SA_ONLY = 'fk.sa.only'
const FORCE = 'fk.force'
const STEALTH = 'fk.stealth'
const BOUND_USED = 'fk.bound.used'
const AMMO = 'fk.ammo'
const CONCEALED_SHOT = 'fk.concealedShot'
const RFA_TP = 'fk.rfa.tp'
const MEAT_TP = 'fk.meat.tp'
const PIERCING_TP = 'fk.piercing.tp'
const TOXIN_TP = 'fk.toxin.tp'
const TROPHY_BATTLE = 'fk.trophy.battle'
const QD_TP = (opId: string) => `fk.quickDraw:${opId}`
const SHRIEK_USED = (opId: string) => `fk.shriek:${opId}`

/** Token kinds (public, shown in the UI). */
const T_MARK = 'fk.callTheKill'
const T_SHRIEK = 'fk.victoryShriek'
const T_VENGEANCE = 'fk.vengeance'

const PECHRA = 'fk.pechra'
const CONCEALED = 'fk.w.kroot-hunting-rifle-concealed'
const STATIONARY = 'fk.w.kroot-hunting-rifle-stationary'
const BOW_GROUP = 'fk.wg.accelerator-bow'
const RIFLE_GROUP = 'fk.wg.kroot-hunting-rifle'
const FANGS = 'fk.w.ripping-fangs'
const FOCUSED = 'fk.w.dual-kroot-pistols-focused'
const SALVO = 'fk.w.dual-kroot-pistols-salvo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isFk(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, FK)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function fkOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state)
    .filter((o) => o.seat === seat && live(o) && isFk(state, o))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

function isHound(state: GameState, op: Operative): boolean {
  return hasAbility(state, op, BEAST)
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function opEffect(state: GameState, source: string, opId: string) {
  return state.effects.find((e) => e.source === source && e.operativeId === opId)
}

function gap(a: Operative, b: Operative): number {
  return distanceBetween(bodyOf(a), bodyOf(b))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return gap(a, b) <= inches + EPS
}

function d3(ctx: Ctx, purpose: string): number {
  const [r] = ctx.roll(purpose, 1)
  return Math.ceil(r! / 2)
}

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState): Activation | null {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

/** The operative's own, non-counteracting activation is the one running (a free action under it counts). */
function ownActivation(state: GameState, op: Operative): Activation | null {
  const base = baseActivation(state)
  return base && base.operativeId === op.id && !base.counteract ? base : null
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

function ruleIndex(rules: WeaponRuleRef[], key: string): number {
  return rules.findIndex((r) => ruleKey(r.rule) === key)
}

function addRule(rules: WeaponRuleRef[], key: string, extra: Partial<WeaponRuleRef> = {}): boolean {
  if (ruleIndex(rules, key) >= 0) return false
  rules.push({ rule: key, ...extra })
  return true
}

function addLethal(rules: WeaponRuleRef[], target: 5): void {
  const i = ruleIndex(rules, 'lethal')
  if (i < 0) rules.push({ rule: 'lethal', target })
  else if ((rules[i]!.target ?? rules[i]!.x ?? 6) > target) rules[i] = { ...rules[i]!, rule: 'lethal', target }
}

/** Is `op` within `inches` of a Light or Heavy terrain part (the operative's own base counted)? */
function nearLightOrHeavy(state: GameState, op: Operative, inches: number): boolean {
  for (const s of terrainOf(state.map).solids) {
    if (!s.light && !s.heavy) continue
    if (Math.max(0, distToPolygon(op.pos, s.polygon) - op.baseRadius) <= inches + EPS) return true
  }
  return false
}

function weaponName(state: GameState, id: string | null | undefined): string {
  return id ? (state.data.weapons[id]?.name ?? '') : ''
}

/** Is the marker in the operative's control range (a marker lying under the base counts)? */
function markerBeside(state: GameState, op: Operative, marker: Marker): boolean {
  return gapToMarker(bodyOf(op), marker) <= EPS || markerInControlRange(state, bodyOf(op), marker)
}

/** The enemies ordered by how near they are to the seat's Farstalker operatives (the best picks first). */
function enemiesByThreat(state: GameState, seat: Seat): Operative[] {
  const mine = fkOps(state, seat)
  const near = (e: Operative) => (mine.length ? Math.min(...mine.map((m) => gap(m, e))) : 0)
  return activeOps(state)
    .filter((o) => o.seat !== seat && live(o))
    .sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Call the Kill: the mark
// ---------------------------------------------------------------------------

interface MarkData {
  markId: string
  /** falls whose Victory Shriek pick is still unspent, apart from the current mark's own */
  due: number
  /** the current (fallen) mark's Victory Shriek has been spent */
  shriekedCurrent: boolean
}

function markFx(state: GameState, seat: Seat) {
  return state.effects.find((e) => e.source === MARK && e.seat === seat)
}

function markData(state: GameState, seat: Seat): MarkData | null {
  const fx = markFx(state, seat)
  return fx ? (fx.data as unknown as MarkData) : null
}

/** The seat's living mark, if Call the Kill set one this turning point. */
export function markOf(state: GameState, seat: Seat): Operative | undefined {
  const d = markData(state, seat)
  const m = d ? state.operatives[d.markId] : undefined
  return live(m) ? m : undefined
}

function markFallen(state: GameState, seat: Seat): boolean {
  const d = markData(state, seat)
  return !!d && !live(state.operatives[d.markId])
}

function killBrokers(state: GameState, seat: Seat): Operative[] {
  return fkOps(state, seat).filter((o) => hasAbility(state, o, SHRIEK))
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

const BEAST_ACTIONS = ['charge', 'dash', 'fallBack', 'fight', 'guard', 'reposition', `ability:${GATHER}`, 'marker:pickUp', 'marker:place']

registerTeamRules({
  id: TEAM_ID,

  // Stalker (T-FK.22)
  chargeUnderConceal(state, op) {
    return hasAbility(state, op, STALKER)
  },

  // Beast (T-FK.14)
  actionForbidden(state, op, actionId) {
    if (!hasAbility(state, op, BEAST) || BEAST_ACTIONS.includes(actionId)) return null
    return `${op.name} is a Beast and cannot take that action`
  },
  equipmentEligible(state, op) {
    return hasAbility(state, op, BEAST) ? false : null
  },
  weaponForbidden(state, op, weaponId, kind) {
    if (hasAbility(state, op, BEAST) && weaponId !== FANGS) return `${op.name} is a Beast and uses only its own weapon`
    // Concealed Position (T-FK.18): usable only in the first Shoot action of the battle
    if (weaponId === CONCEALED && kind === 'shoot' && op.oncePerBattleUsed.includes(CONCEALED_SHOT)) return 'Concealed Position: the Long-Sight has already shot this battle'
    return null
  },

  // Salvo (T-FK.20): the second target is any other valid target (the core rule already bars targets in a friendly control range)
  extraTargets(state, shooter, weaponId, primaryId) {
    if (weaponId !== SALVO) return null
    const candidates = validTargets(state, shooter, weaponId)
      .map((t) => t.id)
      .filter((id) => id !== primaryId)
    return candidates.length > 0 ? { candidates, max: 1 } : null
  },

  // FARSTALKER (T-FK.28): an order change instead of counteracting
  counteractAlternatives(state, seat) {
    const out: ReactionOffer[] = []
    for (const op of fkOps(state, seat)) {
      if (inEnemyCr(state, op)) continue
      const to = op.order === 'engage' ? 'Conceal' : 'Engage'
      out.push({ hook: 'fkFarstalker', operativeId: op.id, option: op.id, labelKey: `ability.${A('farstalker')}`, data: { name: `FARSTALKER: ${op.name} changes to ${to}`, to } })
    }
    return out
  },

  // FARSTALKER (T-FK.27): the Ready-step order change, once per turning point while an operative can be flipped
  readyStepChoices(state, seat) {
    if (usedThisTp(state, seat, READY_TP)) return []
    const first = fkOps(state, seat).find((o) => !inEnemyCr(state, o))
    if (!first) return []
    return [{ hook: 'fkReadyStep', operativeId: first.id, option: 'start', labelKey: `ability.${A('farstalker')}`, data: { name: 'FARSTALKER: change the orders of up to three operatives' } }]
  },

  // Bad-tempered force (T-FK.15) and Savage Assault's same-enemy Fight (T-FK.13)
  fightTargets(state, attacker, foes) {
    const only = opEffect(state, SA_ONLY, attacker.id)
    if (only && typeof only.data?.targetId === 'string' && foes.includes(only.data.targetId)) {
      return [only.data.targetId]
    }
    const force = opEffect(state, FORCE, attacker.id)
    if (force && typeof force.data?.houndId === 'string' && foes.includes(force.data.houndId)) return [force.data.houndId]
    return null
  },

  // Bad-tempered free Charge (T-FK.16)
  reactions(state, seat, info) {
    if (info.action !== 'charge' || info.activeSeat === seat || info.strategy || info.interrupt || info.activationEnded) return []
    const actor = state.operatives[info.actorId]
    if (!live(actor) || actor.seat === seat) return []
    const out: ReactionOffer[] = []
    // a Hound that already answered this Charge moved after it ended: it is not the friend that triggers another Hound
    // (a Hound can only answer from outside every enemy control range, so it never was that friend)
    const reacted = state.firefight.activation?.reacted?.ids ?? []
    for (const h of fkOps(state, seat)) {
      if (!hasAbility(state, h, TEMPER)) continue
      const friendNear = fkOps(state, seat).some((f) => f.id !== h.id && !reacted.includes(f.id) && within(h, f, 3) && inControlRange(state, bodyOf(f), bodyOf(actor)))
      const o = friendNear ? houndOffer(state, h, actor) : null
      if (o) out.push(o)
    }
    return out
  },

  // ROGUE (T-FK.30): one more cover save, or one as a crit, unless Vantage already improved it
  stealthyCover(state, op) {
    if (!isFk(state, op) || !ployActive(state, op.seat, ROGUE)) return 0
    if (state.attack?.status?.improvedCover) return 0
    return 1
  },

  // SLIP AWAY (T-FK.34)
  actionCostDelta(state, op, actionId) {
    if (actionId !== 'fallBack' || !opEffect(state, SLIP, op.id)) return 0
    return -1
  },

  // POACH (T-FK.35)
  markerActionRelief(state, op, actionId) {
    if (!opEffect(state, POACH, op.id)) return null
    if (actionId === 'marker:pickUp') return { contestSuffices: true }
    if (actionId.startsWith('ability:') && (state.data.abilities[actionId.slice('ability:'.length)]?.keywords ?? []).includes('MISSION')) return { contestSuffices: true }
    return null
  },

  // BOUND (T-FK.32): the first 2" of one climb in each activation
  moveSurcharge(state, op, _kind, _points, breakdown) {
    if (!isFk(state, op) || !ployActive(state, op.seat, BOUND) || breakdown.climb <= 0) return 0
    if (!ownActivation(state, op) || opEffect(state, BOUND_USED, op.id)) return 0
    return -Math.min(2, breakdown.climb)
  },

  // SAVAGE AMBUSH (T-FK.33): the defender resolves first
  fightResolveStart(state, attack) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const def = state.operatives[attack.fight.targetId]
    if (!def || !opEffect(state, AMBUSH, def.id)) return null
    return { first: def.seat }
  },

  // STEALTH ATTACK (T-FK.23): the first strike of the Fight is followed at once by another strike
  afterFightResolution(state, attack, seat, op) {
    if (op !== 'strike' || attack.kind !== 'fight') return null
    const mine = [attack.operativeId, attack.fight?.targetId].map((id) => (id ? state.operatives[id] : undefined)).find((o) => o && o.seat === seat)
    const fx = mine ? opEffect(state, STEALTH, mine.id) : undefined
    if (!mine || !fx || fx.data?.used === true) return null
    fx.data = { ...(fx.data ?? {}), used: true }
    return [{ seat, strikeOnly: true }]
  },
})

// ---------------------------------------------------------------------------
// FARSTALKER (counteract alternative) and the Ready step
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'fkFarstalker',
  choice(ctx, op, _option, context) {
    const to = context.to === 'Conceal' ? 'conceal' : 'engage'
    setOrder(ctx, op, to)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('farstalker'), detail: to }, op.seat)
  },
})

function readyOptions(state: GameState, seat: Seat, picked: string[]) {
  const choiceOpt = (id: string, labelKey: string, data: Record<string, unknown>) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, data })
  const ops = fkOps(state, seat).filter((o) => !picked.includes(o.id) && !inEnemyCr(state, o))
  return [
    ...ops.map((o) => choiceOpt(o.id, 'fk.ready.flip', { name: `${o.name}: change to ${o.order === 'engage' ? 'Conceal' : 'Engage'}`, x: o.pos.x, z: o.pos.z })),
    choiceOpt('done', 'fk.ready.done', { name: 'Done' }),
  ]
}

/** The Ready-step order change was offered and taken this turning point (T-FK.27). */
const READY_TP = 'fk.readyStep'

/** Ask for the next order flip of the Ready step (or Done). */
function raiseReadyPick(ctx: Ctx, seat: Seat, chooserId: string, picked: string[]): void {
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'turningPoint.start',
    context: { hook: 'fkReadyStep', operativeId: chooserId, picked },
    options: readyOptions(ctx.state, seat, picked),
  })
}

// FARSTALKER (T-FK.27): in the Ready step, through the shared Ready-step choice (readyStepChoices): one offer starts the
// flips; the loop of up to three operatives ends with Done, then strategy.readyChoiceDone (the offer is gone for the TP)
registerCodeHook({
  name: 'fkReadyStep',
  choice(ctx, op, option, context) {
    const s = ctx.state
    const seat = op.seat
    if (context.readyStep === true) {
      markUsedTp(s, seat, READY_TP)
      if (readyOptions(s, seat, []).length <= 1) {
        readyChoiceDone(ctx)
        return
      }
      raiseReadyPick(ctx, seat, op.id, [])
      return
    }
    const picked = [...((context.picked as string[] | undefined) ?? [])]
    if (option !== 'done') {
      const target = s.operatives[option]
      if (live(target) && target.seat === seat && !inEnemyCr(s, target) && !picked.includes(target.id)) {
        setOrder(ctx, target, target.order === 'engage' ? 'conceal' : 'engage')
        picked.push(target.id)
        ctx.emit({ type: 'AbilityUsed', operativeId: target.id, abilityId: A('farstalker'), detail: target.order }, seat)
      }
    }
    if (option === 'done' || picked.length >= 3 || readyOptions(s, seat, picked).length <= 1) {
      readyChoiceDone(ctx)
      return
    }
    raiseReadyPick(ctx, seat, op.id, picked)
  },
})

// ---------------------------------------------------------------------------
// Call the Kill (the gambit)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'fkCallTheKill',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (killBrokers(state, seat).length === 0) return []
      return enemiesByThreat(state, seat).map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const id = seed.param
      if (!id || !live(ctx.state.operatives[id])) return
      const old = markFx(ctx.state, seat)
      if (old) removeEffects(ctx, (e) => e.id === old.id)
      addEffect(ctx, { source: MARK, seat, kind: 'ployFlag', expires: 'turningPoint', data: { markId: id, due: 0, shriekedCurrent: false } })
      moveTokenTo(ctx, T_MARK, seat, id, { expires: ['turningPointEnd'] }, 'fk.callTheKill')
      const kb = killBrokers(ctx.state, seat)[0]
      if (kb) ctx.emit({ type: 'AbilityUsed', operativeId: kb.id, abilityId: A('call-the-kill'), detail: id }, seat)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys that are turning point flags the hooks read
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'fkFlagPloy',
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
// Firefight ploys: SAVAGE AMBUSH, SLIP AWAY, POACH, VENGEANCE FOR THE KINBAND
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'fkSavageAmbush',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const def = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(def) || def.seat !== seat || !isFk(state, def) || !def.ready) return []
      // the defender, not the fighter: the window names the target of the Fight
      if (info.targetId !== def.id || info.kind !== 'fight') return []
      return nearLightOrHeavy(state, def, 1) ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      const id = info.subjectId
      if (id) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: id, expires: 'action' })
    },
  },
})

registerCodeHook({
  name: 'fkSlipAway',
  ploy: {
    offers(state, seat, ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isFk(state, op) || info.counteracting || !ownActivation(state, op)) return []
      if (opEffect(state, ploy.id, op.id) || !inEnemyCr(state, op)) return []
      return [{}]
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'activation' })
    },
  },
})

registerCodeHook({
  name: 'fkPoach',
  ploy: {
    offers(state, seat, ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isFk(state, op) || info.counteracting || !ownActivation(state, op)) return []
      if (opEffect(state, ploy.id, op.id)) return []
      // only worth offering beside a marker the operative contests without controlling
      const pending = state.markers.some((m) => {
        if (m.kind !== 'objective') return false
        const c = markerControl(state, m)
        return c.contesting[seat].includes(op.id) && c.controller !== seat
      })
      return pending ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'activation' })
    },
  },
})

registerCodeHook({
  name: 'fkVengeance',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const victim = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!victim || victim.seat !== seat || !isFk(state, victim)) return []
      const killerId = state.removal?.killers?.[victim.id]
      const killer = killerId ? state.operatives[killerId] : undefined
      if (!live(killer) || killer.seat === seat) return []
      // "cannot be used again until that enemy has been incapacitated": an enemy still carries the seat's token
      const held = activeOps(state).some((o) => o.seat !== seat && live(o) && hasToken(state, o.id, T_VENGEANCE, seat))
      return held ? [] : [{ param: killer.id }]
    },
    apply(ctx, seat, _ploy, seed) {
      if (seed.param && live(ctx.state.operatives[seed.param])) addToken(ctx, seed.param, { kind: T_VENGEANCE, owner: seat, cap: 1, expires: ['battle'] }, 'fk.vengeance')
    },
  },
})

// ---------------------------------------------------------------------------
// Unique actions: ENERGISE, LONG-SIGHT, FROM THE EYE ABOVE, MARKED FOR THE HUNT
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'fkEnergise',
  action: {
    offers(state, op): OfferSeed[] {
      return opEffect(state, ENERGISE, op.id) ? [] : [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      addEffect(ctx, { source: ENERGISE, seat: op.seat, kind: 'ability', operativeId: op.id, expires: 'turningPoint' })
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'fkLongSight',
  action: {
    offers: (): OfferSeed[] => [{ key: '', params: {} }],
    perform(ctx, op, def) {
      removeEffects(ctx, (e) => e.source === LONG_SIGHT && e.operativeId === op.id)
      addEffect(ctx, { source: LONG_SIGHT, seat: op.seat, kind: 'ability', operativeId: op.id, expires: `startOfActivation:${op.id}` })
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'fkEyeAbove',
  action: {
    offers(state, op): OfferSeed[] {
      const range = 6 + commsBonus(state, op.seat, op)
      const out: OfferSeed[] = []
      for (const f of fkOps(state, op.seat)) {
        if (f.id === op.id || !within(op, f, range) || !visible(state, bodyOf(op), bodyOf(f))) continue
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
      applyAplEffect(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'fkMarkedForTheHunt',
  action: {
    offers(state, op): OfferSeed[] {
      return markerSpots(state, op, null).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const spots = markerSpots(ctx.state, op, null)
      if (spots.length === 0) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'fkMarkedForTheHunt', operativeId: op.id, abilityId: def.id },
        options: spots.map((p) => ({ id: `${p.x},${p.z}`, labelKey: 'fk.pechra.place', type: 'ability.choice' as const, payload: { option: `${p.x},${p.z}` }, data: { x: p.x, z: p.z } })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    // one marker at a time: placing it again moves it
    for (const m of [...ctx.state.markers]) if (m.equipmentId === PECHRA && m.owner === op.seat) removeMarker(ctx, m.id, 'fk.pechra.moved')
    const marker: Marker = { id: newMarkerId(ctx, 'pechra'), kind: 'equipment', pos: { x, z }, owner: op.seat, carriedBy: null, controller: null, equipmentId: PECHRA, placedBy: op.id }
    ctx.state.markers.push(marker)
    ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: { x, z } }, op.seat)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${x},${z}` }, op.seat)
    finishAction(ctx)
  },
})

// ---------------------------------------------------------------------------
// GATHER (T-FK.17): a free Dash or Reposition in two parts with a Place Marker between them
// ---------------------------------------------------------------------------

function pushPerformed(ctx: Ctx, action: string): void {
  const act = ctx.state.firefight.activation
  if (act && !act.performed.includes(action)) act.performed.push(action)
}

function gatherSecondMove(ctx: Ctx, op: Operative, kind: 'dash' | 'reposition', remaining: number): void {
  if (remaining <= EPS || !startFreeAction(ctx, { operativeId: op.id, action: kind, maxMove: remaining, resume: 'fk.gather2' })) finishAction(ctx)
}

registerCodeHook({
  name: 'fkGather',
  action: {
    offers(state, op): OfferSeed[] {
      return (['dash', 'reposition'] as const).filter((k) => canStartFreeAction(state, { operativeId: op.id, action: k, resume: '' })).map((k) => ({ key: k, params: { param: k } }))
    },
    perform(ctx, op, _def, params) {
      const kind = params.param === 'dash' ? 'dash' : 'reposition'
      const act = ctx.state.firefight.activation
      const limit = moveLimit(op, kind, act?.counteract === true, ctx.state)
      const started = startFreeAction(ctx, { operativeId: op.id, action: kind, maxMove: limit, resume: 'fk.gather1', data: { opId: op.id, kind, limit, before: op.movedThisActivation ?? 0 } })
      if (!started) cancelAction(ctx)
    },
  },
  choice(ctx, op, option, context) {
    const kind = context.kind === 'dash' ? 'dash' : 'reposition'
    if (option === 'place' && op.flags.carrying) {
      const m = ctx.state.markers.find((k) => k.id === op.flags.carrying)
      if (m) {
        m.carriedBy = null
        m.pos = { x: op.pos.x, z: op.pos.z }
        ctx.emit({ type: 'MarkerPlaced', markerId: m.id, operativeId: op.id, pos: { ...m.pos } }, op.seat)
      }
      op.flags.carrying = null
    }
    gatherSecondMove(ctx, op, kind, Number(context.remaining))
  },
})

registerFrameResume('fk.gather1', (ctx, outcome, data) => {
  const op = ctx.state.operatives[String(data.opId)]
  if (outcome === 'cancelled' || !op || op.status !== 'active') {
    cancelAction(ctx)
    return
  }
  const kind = data.kind === 'dash' ? 'dash' : 'reposition'
  // the whole GATHER counts as one Dash or Reposition for the action restrictions
  pushPerformed(ctx, kind)
  const spent = (op.movedThisActivation ?? 0) - Number(data.before)
  const remaining = Math.max(0, Number(data.limit) - spent)
  if (remaining > EPS && op.flags.carrying) {
    ctx.raise({
      kind: 'ability.choice',
      seat: op.seat,
      window: 'firefight.actionDeclared',
      context: { hook: 'fkGather', operativeId: op.id, kind, remaining },
      options: [
        { id: 'place', labelKey: 'fk.gather.place', type: 'ability.choice' as const, payload: { option: 'place' }, data: { name: 'Place the carried marker here' } },
        { id: 'skip', labelKey: 'fk.gather.skip', type: 'ability.choice' as const, payload: { option: 'skip' }, data: { name: 'Keep carrying it' } },
      ],
    })
    return
  }
  gatherSecondMove(ctx, op, kind, remaining)
})
registerFrameResume('fk.gather2', (ctx) => finishAction(ctx))

// ---------------------------------------------------------------------------
// STEALTH ATTACK (T-FK.23): a free Charge no further than Move, then a free Fight with a bonus strike
// ---------------------------------------------------------------------------

function stealthTargets(state: GameState, op: Operative): Operative[] {
  const move = effectiveMove(op, state)
  return enemiesOf(state, op).filter((e) => live(e) && canChargeInto(state, op, e, move))
}

registerCodeHook({
  name: 'fkStealthAttack',
  action: {
    offers(state, op): OfferSeed[] {
      if (!nearLightOrHeavy(state, op, 1)) return []
      // a free action must meet its conditions (R-3.9): no Charge after Reposition, Dash or Fall Back, and no second Fight
      const done = ownActivation(state, op)?.performed ?? []
      if (['reposition', 'dash', 'fallBack', 'charge', 'fight'].some((a) => done.includes(a))) return []
      return stealthTargets(state, op).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op) {
      const started = startFreeAction(ctx, { operativeId: op.id, action: 'charge', maxMove: effectiveMove(op, ctx.state), resume: 'fk.stealth1', data: { opId: op.id } })
      if (!started) cancelAction(ctx)
    },
  },
})

registerFrameResume('fk.stealth1', (ctx, outcome, data) => {
  const op = ctx.state.operatives[String(data.opId)]
  if (outcome === 'cancelled' || !live(op)) {
    cancelAction(ctx)
    return
  }
  pushPerformed(ctx, 'charge')
  addEffect(ctx, { source: STEALTH, seat: op.seat, kind: 'ability', operativeId: op.id, expires: 'action', data: { used: false } })
  if (!startFreeAction(ctx, { operativeId: op.id, action: 'fight', resume: 'fk.stealth2', data: { opId: op.id } })) finishAction(ctx)
})
registerFrameResume('fk.stealth2', (ctx, outcome, data) => {
  removeEffects(ctx, (e) => e.source === STEALTH && e.operativeId === String(data.opId))
  if (outcome === 'finished') pushPerformed(ctx, 'fight')
  finishAction(ctx)
})

// ---------------------------------------------------------------------------
// Bad-tempered free Charge (reaction) and Quick Draw's interrupt
// ---------------------------------------------------------------------------

/**
 * The Hound's free Charge offer against `actor`, if the Hound is free of enemy control ranges and can reach it. Marked
 * `repeat`: once one Hound's free Charge is over, every other Hound the Charge triggered is offered again (T-FK.16).
 */
function houndOffer(state: GameState, h: Operative, actor: Operative): ReactionOffer | null {
  if (!live(h) || !live(actor) || inEnemyCr(state, h) || !canChargeInto(state, h, actor, effectiveMove(h, state) + 2)) return null
  return {
    hook: 'fkBadTempered',
    operativeId: h.id,
    option: actor.id,
    labelKey: `ability.${TEMPER}`,
    data: { name: `Bad-tempered: ${h.name} charges ${actor.name}`, targetId: actor.id },
    repeat: true,
  }
}

registerCodeHook({
  name: 'fkBadTempered',
  choice(ctx, op, option) {
    const foe = ctx.state.operatives[option]
    if (!live(foe) || !live(op)) {
      reactionDone(ctx)
      return
    }
    const previous = op.order
    // RULING: a Conceal Hound switches to Engage to take the Charge
    if (op.order === 'conceal') setOrder(ctx, op, 'engage')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: TEMPER, detail: foe.id }, op.seat)
    const started = startFreeAction(ctx, { operativeId: op.id, action: 'charge', endWithinCrOf: foe.id, resume: 'fk.badTempered', data: { opId: op.id, previous } })
    if (!started) {
      if (op.order !== previous) setOrder(ctx, op, previous)
      reactionDone(ctx)
    }
  },
})

registerFrameResume('fk.badTempered', (ctx, outcome, data) => {
  if (outcome === 'cancelled') {
    const op = ctx.state.operatives[String(data.opId)]
    if (op && op.order !== data.previous) setOrder(ctx, op, data.previous as 'engage' | 'conceal')
  }
  // the shared reaction round offers the other Hounds again (ReactionOffer.repeat)
  reactionDone(ctx)
})

registerFrameResume('fk.quickDraw', (ctx, outcome, data) => {
  const s = ctx.state
  const pist = s.operatives[String(data.opId)]
  if (outcome === 'cancelled' && live(pist) && pist.order !== data.previous) setOrder(ctx, pist, data.previous as 'engage' | 'conceal')
  const act = s.firefight.activation
  const actor = act ? s.operatives[act.operativeId] : undefined
  if (!act || !actor || actor.status !== 'active' || actor.wounds <= 0) {
    // the shooter went down to the interrupt: its Shoot ends with no attack (AP stays spent)
    s.window = null
    afterActiveOperativeRemoved(ctx)
    return
  }
  continueWindow(ctx)
})

// ---------------------------------------------------------------------------
// Passive hooks
// ---------------------------------------------------------------------------

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const w = s.data.weapons[c.weaponId]
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const foe = target && target.seat !== op.seat ? target : undefined
    if (isFk(s, op) && w) {
      // Call the Kill (the mark) and Victory Shriek: Balanced (T-FK.7, 8)
      if (foe && markOf(s, op.seat)?.id === foe.id && addRule(rules, 'balanced')) markFired('fkCallTheKill')
      if (hasToken(s, op.id, T_SHRIEK, op.seat)) addRule(rules, 'balanced')
      // Cold-blooded (T-FK.11)
      if (foe && hasAbility(s, op, COLD) && foe.wounds < foe.maxWounds) {
        addLethal(rules, 5)
        if (isInjured(foe)) addRule(rules, 'rending')
      }
      // Vengeance for the Kinband (T-FK.36): Relentless against the enemy that took a kinsman
      if (foe && hasToken(s, foe.id, T_VENGEANCE, op.seat)) addRule(rules, 'relentless')
      if (data.kind === 'shoot') {
        // Energise (T-FK.9) and LONG-SIGHT (T-FK.19)
        if (w.profileGroup === BOW_GROUP && opEffect(s, ENERGISE, op.id)) addLethal(rules, 5)
        if ((c.weaponId === CONCEALED || c.weaponId === STATIONARY) && opEffect(s, LONG_SIGHT, op.id)) addLethal(rules, 5)
        // MARKED FOR THE HUNT (T-FK.24): Seek Light against an enemy with the Pech'ra marker in its control range
        if (foe && w.type === 'ranged') {
          const marker = s.markers.find((m) => m.equipmentId === PECHRA && m.owner === op.seat)
          if (marker && markerBeside(s, foe, marker) && addRule(rules, 'seek-light')) markFired('fkMarkedForTheHunt')
        }
        // Piercing Shot and Toxin Shot (T-FK.37, 38): on the weapon picked for this action
        const ammo = opEffect(s, AMMO, op.id)
        if (ammo && ammo.data?.weaponId === c.weaponId) {
          if (ammo.data.kind === 'piercing') {
            if (!rules.some((r) => ruleKey(r.rule) === 'piercing' && !r.crits)) rules.push({ rule: 'piercing', x: 1 })
          } else {
            addLethal(rules, 5)
            addRule(rules, 'stun')
          }
        }
        // PREY (T-FK.31), after the other changes: Balanced + Severe, or Ceaseless + Severe if Balanced is already there
        if (w.type === 'ranged' && ployActive(s, op.seat, PREY)) {
          const act = s.firefight.activation
          const moved = !!act && act.operativeId === op.id && act.performed.some((a) => a === 'charge' || a === 'fallBack' || a === 'reposition')
          if (!moved) {
            if (ruleIndex(rules, 'balanced') >= 0) addRule(rules, 'ceaseless')
            else addRule(rules, 'balanced')
            addRule(rules, 'severe')
          }
        }
      }
    }
    // ROGUE (T-FK.30): a friendly Farstalker operative shot at loses the shooter's Saturate
    if (data.kind === 'shoot' && target && isFk(s, target) && target.seat !== op.seat && ployActive(s, target.seat, ROGUE)) {
      for (let i = rules.length - 1; i >= 0; i--) if (ruleKey(rules[i]!.rule) === 'saturate') rules.splice(i, 1)
    }
    return null
  },
  'fk.modifyWeaponRules',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isFk(s, op) || !ployActive(s, op.seat, CUT_THROATS)) return null
    const data = c.data as { kind: 'shoot' | 'fight'; weaponId: string; atk: number }
    if (data.kind !== 'fight' || s.data.weapons[data.weaponId]?.type !== 'melee') return null
    // +1 Atk, 5 at most (never lowers an Atk already above 5)
    data.atk = Math.max(data.atk, Math.min(5, data.atk + 1))
    return null
  },
  'fk.modifyAttackDice',
)

// Hardy (T-FK.10): a crit deals the Normal Dmg when that is lower
registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId || !c.targetId || !hasAbility(s, op, HARDY)) return null
    const d = c.data as { source: string; amount: number }
    if ((d.source !== 'crit' && d.source !== 'strike-crit') || d.amount <= 0) return null
    const w = s.data.weapons[c.weaponId]
    if (!w) return null
    const normal = weaponDamage(s, c.targetId, c.weaponId, op.id, w.type === 'melee' ? 'fight' : 'shoot', c.engine).normal
    if (normal < d.amount) {
      d.amount = normal
    }
    return null
  },
  'fk.onDamageInflicted',
)

// Vicious Duellist (T-FK.12): 1 damage per fail the enemy fighter discards, once both pools are final
registerHook(
  'afterAttackRoll',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const enemy = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const duelist = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { kind: 'shoot' | 'fight'; dice: { kind: string; used?: boolean; tag?: string }[] }
    if (!s || !ctx || !enemy || !duelist || data.kind !== 'fight' || !c.weaponId) return null
    if (enemy.seat === duelist.seat || !live(duelist) || !hasAbility(s, duelist, DUELLIST)) return null
    let fails = data.dice.filter((d) => d.kind === 'fail' && !d.used).length
    // Punishing turns one fail into a normal success when any crit is kept
    if (fails > 0 && data.dice.some((d) => d.kind === 'crit' && !d.used) && ruleSetFor(s, enemy, c.weaponId, 'fight', duelist.id, ctx).punishing) fails -= 1
    if (fails <= 0) return null
    directDamage(ctx, enemy.id, fails, duelist.id, 'fk.viciousDuellist')
    return null
  },
  'fk.afterAttackRoll',
)

// Savage Assault bookkeeping (T-FK.13): the first Fight of the Cut-Skin's own activation, with both fighters standing
registerHook(
  'onFightResolved',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s) return null
    const d = c.data as { attackerId: string; defenderId: string; attackerIncapacitated: boolean; defenderIncapacitated: boolean }
    const op = s.operatives[d.attackerId]
    if (!live(op) || d.attackerIncapacitated || !hasAbility(s, op, ASSAULT)) return null
    const own = ownActivation(s, op)
    if (!own || opEffect(s, SA_FOUGHT, op.id)) return null
    const free = !!s.firefight.activation?.frame
    // the first Fight is recorded even when the enemy fell: a later Fight that activation is not "the first time"
    addEffect(ctx, { source: SA_FOUGHT, seat: op.seat, kind: 'ability', operativeId: op.id, expires: 'activation', data: { enemyId: d.defenderId, offer: !free && !d.defenderIncapacitated } })
    return null
  },
  'fk.onFightResolved',
)

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    const d = c.data as unknown as ActionEndedData
    const act = s.firefight.activation
    if (d.action === 'shoot') {
      // Concealed Position (T-FK.18): the first Shoot action of any kind uses up the profile
      if (hasKeyword(s, op, 'LONG-SIGHT') && !op.oncePerBattleUsed.includes(CONCEALED_SHOT)) op.oncePerBattleUsed.push(CONCEALED_SHOT)
      // Energise (T-FK.9): spent once a Shoot with the bow is finished
      const last = (act?.weaponsUsed ?? []).at(-1)
      if (last && s.data.weapons[last]?.profileGroup === BOW_GROUP && opEffect(s, ENERGISE, op.id)) removeEffects(ctx, (e) => e.source === ENERGISE && e.operativeId === op.id)
    }
    // Bound (T-FK.32): the first move with a climb uses the activation's saving
    if (isFk(s, op) && ployActive(s, op.seat, BOUND) && ownActivation(s, op) && !opEffect(s, BOUND_USED, op.id)) {
      const moved = ctx.events.find((e) => e.type === 'OperativeMoved' && e.operativeId === op.id && e.segments.some((sg) => sg.kind === 'climb' && sg.to.y > sg.from.y))
      if (moved) {
        addEffect(ctx, { source: BOUND_USED, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation' })
      }
    }
    return null
  },
  'fk.action.ended',
)

// The Pech'ra marker goes when the Tracker next activates (T-FK.24)
registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    for (const m of [...s.markers]) if (m.equipmentId === PECHRA && m.placedBy === op.id) removeMarker(ctx, m.id, 'fk.pechra.expired')
    return null
  },
  'fk.activation.start',
)

// ... or when the Tracker leaves the killzone
registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s || !c.operativeId) return null
    for (const m of [...s.markers]) if (m.equipmentId === PECHRA && m.placedBy === c.operativeId) removeMarker(ctx, m.id, 'fk.pechra.removed')
    return null
  },
  'fk.operative.incapacitated',
)

// LONG-SIGHT (T-FK.19): enemies cannot be obscured for a hunting-rifle shot
registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !opEffect(s, LONG_SIGHT, op.id)) return null
    // the weapon the status is worked out for (also the odds before a weapon is picked), else the attack's own
    const a = s.attack
    const weaponId = c.weaponId ?? (a && a.operativeId === op.id ? a.weaponId : null)
    if (!weaponId || s.data.weapons[weaponId]?.profileGroup !== RIFLE_GROUP) return null
    const data = c.data as { obscured: boolean }
    if (data.obscured) markFired('fkLongSight')
    data.obscured = false
    return null
  },
  'fk.target.status',
)

// Quick Draw (target restriction) and MARKED FOR THE HUNT (Seek Light makes a Conceal enemy in Light cover valid)
registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    if (!s || !op || !isFk(s, op)) return null
    const act = s.firefight.activation
    // the interrupt may shoot only the enemy it answers
    if (act?.frame?.resume === 'fk.quickDraw' && act.operativeId === op.id) {
      const only = String(act.frame.data?.enemyId ?? '')
      for (let i = data.candidates.length - 1; i >= 0; i--) if (data.candidates[i] !== only) data.candidates.splice(i, 1)
      return null
    }
    if (data.secondary || s.attack?.pointBlank) return null
    const marker = s.markers.find((m) => m.equipmentId === PECHRA && m.owner === op.seat)
    if (!marker || s.data.weapons[data.weaponId]?.type !== 'ranged') return null
    const base = ruleSetFor(s, op, data.weaponId, 'shoot', undefined, c.engine)
    for (const e of enemiesOf(s, op)) {
      if (!live(e) || data.candidates.includes(e.id) || !markerBeside(s, e, marker)) continue
      const rules = { ...base, seekLight: true }
      if (rules.range !== null && !isWithin(bodyOf(op), bodyOf(e), rules.range)) continue
      if (activeOps(s).some((o) => o.seat === op.seat && inControlRange(s, bodyOf(e), bodyOf(o)))) continue
      const info = targetInfo(s, op, e, rules)
      if (!info.verdict.visible || info.coverBlocks) continue
      data.candidates.push(e.id)
      markFired('fkMarkedForTheHunt')
    }
    return null
  },
  'fk.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// 0 CP offers: the new mark, Victory Shriek, Savage Assault, Bad-tempered, Quick Draw, ammunition, Meat, Trophy
// ---------------------------------------------------------------------------

function offer(id: string, name: string, via: string, op: Operative | undefined, param?: string): PloyOffer {
  return { id, ployId: id.split(':')[0]!, name, ...(param ? { param } : {}), ...(op ? { operativeId: op.id } : {}), cost: 0, via, seed: param ? { param } : {} }
}

const KILL_WINDOWS = ['operative.killed', 'firefight.activationStart', 'firefight.actionEnded']

/** Is the weapon one the ammunition rules name: a Kroot rifle, the Kroot scattergun or the focused dual pistols? */
function ammoWeapon(state: GameState, weaponId: string | null | undefined): boolean {
  const n = weaponName(state, weaponId)
  return n === 'Kroot rifle' || n === 'Kroot scattergun' || weaponId === FOCUSED
}

function withOrder(state: GameState, op: Operative, order: 'engage' | 'conceal'): GameState {
  return { ...state, operatives: { ...state.operatives, [op.id]: { ...op, order } } }
}

/** Could the shooter's ranged weapon pick the Pistolier as its target (or as a Blast secondary)? */
function pistolierTargetable(state: GameState, actor: Operative, pist: Operative): boolean {
  const performed = baseActivation(state)?.performed ?? []
  for (const w of usableRangedWeapons(state, actor, performed)) {
    const valid = validTargets(state, actor, w)
    if (valid.some((t) => t.id === pist.id)) return true
    const blast = parseRules(state.data.weapons[w]?.rules ?? []).blast
    if (blast !== null) for (const t of valid) if (blastSecondaries(state, actor, state.operatives[t.id]!, blast).includes(pist.id)) return true
  }
  return false
}

const FK_RULE = {
  extraOffers(state: GameState, seat: Seat, window: string, info: PloyWindowInfo): PloyOffer[] {
    const out: PloyOffer[] = []
    if (state.players[seat].teamId !== TEAM_ID) return out
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    const mine = subject && subject.seat === seat && live(subject) && isFk(state, subject) ? subject : undefined
    const base = baseActivation(state)

    // ---- the new mark and Victory Shriek (T-FK.7, 8)
    if (KILL_WINDOWS.includes(window) && mine) {
      const md = markData(state, seat)
      if (md) {
        const fallen = !live(state.operatives[md.markId])
        if (fallen) {
          for (const e of enemiesByThreat(state, seat)) out.push(offer(`${X('repick')}:${e.id}`, `Call the Kill: ${e.name} is the new mark`, 'fk.repick', mine, e.id))
        }
        const owed = md.due > 0 || (fallen && !md.shriekedCurrent)
        const kb = killBrokers(state, seat)[0]
        if (owed && kb) {
          for (const f of fkOps(state, seat)) {
            if (usedThisBattle(state, seat, SHRIEK_USED(f.id)) || !within(kb, f, 6)) continue
            out.push(offer(`${X('shriek')}:${f.id}`, `Victory Shriek: ${f.name} gains Balanced for the battle`, 'fk.shriek', mine, f.id))
          }
        }
      }
    }

    // ---- Savage Assault: a free Fight against the same enemy (T-FK.13)
    if (window === 'firefight.actionEnded' && mine && !info.counteracting && hasAbility(state, mine, ASSAULT)) {
      const fx = opEffect(state, SA_FOUGHT, mine.id)
      const foe = fx ? state.operatives[String(fx.data?.enemyId)] : undefined
      if (fx && fx.data?.offer === true && live(foe) && inControlRange(state, bodyOf(mine), bodyOf(foe)) && canStartFreeAction(state, { operativeId: mine.id, action: 'fight', resume: '' })) {
        out.push(offer(X('assault'), `Savage Assault: ${mine.name} fights ${foe.name} again`, 'fk.assault', mine, foe.id))
      }
    }

    // ---- Bad-tempered: force an enemy's Fight onto a Hound (T-FK.15)
    if (window === 'firefight.opponentActionDeclared' && info.action === 'fight' && info.actorId) {
      const actor = state.operatives[info.actorId]
      if (live(actor) && actor.seat !== seat) {
        const near = activeOps(state).filter((o) => o.seat === seat && live(o) && inControlRange(state, bodyOf(actor), bodyOf(o)))
        for (const h of near) {
          if (!hasAbility(state, h, TEMPER) || near.length < 2) continue
          out.push(offer(`${X('force')}:${h.id}`, `Bad-tempered: ${actor.name} must fight ${h.name}`, 'fk.force', h, h.id))
        }
      }
    }

    // ---- Quick Draw: an interrupt when an enemy declares Shoot (T-FK.21)
    if (window === 'firefight.opponentActionDeclared' && info.action === 'shoot' && info.actorId) {
      const actor = state.operatives[info.actorId]
      if (live(actor) && actor.seat !== seat) {
        for (const p of fkOps(state, seat)) {
          if (!hasAbility(state, p, QUICK_DRAW) || !p.ready || usedThisTp(state, seat, QD_TP(p.id)) || inEnemyCr(state, p)) continue
          if (!p.weapons.includes(FOCUSED)) continue
          const ready = withOrder(state, p, 'engage')
          const asEngage = ready.operatives[p.id]!
          if (!canStartFreeAction(ready, { operativeId: p.id, action: 'shoot', weaponNameContains: 'focused', resume: '' })) continue
          if (!pistolierTargetable(state, actor, p)) continue
          if (!validTargets(ready, asEngage, FOCUSED).some((t) => t.id === actor.id)) continue
          out.push(offer(`${X('quick-draw')}:${p.id}`, `Quick Draw: ${p.name} shoots ${actor.name} first`, 'fk.quickdraw', p, actor.id))
        }
      }
    }

    // ---- Piercing Shot and Toxin Shot on the weapon just picked (T-FK.37, 38), with Ready for Anything (T-FK.26)
    if (window === 'shoot.targetSelected' && mine && state.attack?.kind === 'shoot' && state.attack.operativeId === mine.id && ammoWeapon(state, state.attack.weaponId) && !opEffect(state, AMMO, mine.id)) {
      const ownAct = ownActivation(state, mine)
      for (const [kind, eq, tp] of [['piercing', PIERCING_EQ, PIERCING_TP], ['toxin', TOXIN_EQ, TOXIN_TP]] as const) {
        const label = kind === 'piercing' ? 'Piercing Shot' : 'Toxin Shot'
        if (equipped(state, seat, eq) && !usedThisTp(state, seat, tp)) out.push(offer(eq, label, `fk.${kind}`, mine))
        if (ownAct && hasAbility(state, mine, RFA) && !usedThisTp(state, seat, RFA_TP)) out.push(offer(X(`rfa-${kind}-shot`), `Ready for Anything: ${label}`, `fk.rfa.${kind}`, mine))
      }
    }

    // ---- Meat at the start of an activation (T-FK.39), Trophy before or after an action (T-FK.40)
    if ((window === 'firefight.activationStart' || window === 'firefight.actionEnded') && mine && !info.counteracting && ownActivation(state, mine) && !inEnemyCr(state, mine) && !isHound(state, mine)) {
      if (window === 'firefight.activationStart' && mine.wounds < mine.maxWounds) {
        if (equipped(state, seat, MEAT_EQ) && !usedThisTp(state, seat, MEAT_TP)) out.push(offer(MEAT_EQ, 'Meat: regain D3+1 wounds', 'fk.meat', mine))
        if (hasAbility(state, mine, RFA) && !usedThisTp(state, seat, RFA_TP)) out.push(offer(X('rfa-meat'), 'Ready for Anything: Meat', 'fk.rfa.meat', mine))
      }
      if (equipped(state, seat, TROPHY_EQ) && !usedThisBattle(state, seat, TROPHY_BATTLE)) out.push(offer(TROPHY_EQ, 'Trophy: +1 APL for this activation', 'fk.trophy', mine))
    }
    void base
    return out
  },

  onUsed(ctx: Ctx, seat: Seat, o: PloyOffer, info: PloyWindowInfo) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    switch (o.via) {
      case 'fk.repick': {
        const md = markFx(s, seat)
        if (!md || !o.param) break
        const data = md.data as unknown as MarkData
        // a fall not yet shrieked stays owed after the new pick
        if (!live(s.operatives[data.markId]) && !data.shriekedCurrent) data.due += 1
        data.markId = o.param
        data.shriekedCurrent = false
        moveTokenTo(ctx, T_MARK, seat, o.param, { expires: ['turningPointEnd'] }, 'fk.repick')
        if (op) ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('call-the-kill'), detail: o.param }, seat)
        break
      }
      case 'fk.shriek': {
        const md = markFx(s, seat)
        if (!md || !o.param) break
        const data = md.data as unknown as MarkData
        if (!live(s.operatives[data.markId]) && !data.shriekedCurrent) data.shriekedCurrent = true
        else data.due = Math.max(0, data.due - 1)
        markUsedBattle(s, seat, SHRIEK_USED(o.param))
        addToken(ctx, o.param, { kind: T_SHRIEK, owner: seat, cap: 1, expires: ['battle'] }, 'fk.victoryShriek')
        const kb = killBrokers(s, seat)[0]
        if (kb) ctx.emit({ type: 'AbilityUsed', operativeId: kb.id, abilityId: SHRIEK, detail: o.param }, seat)
        break
      }
      case 'fk.assault': {
        const fx = op ? opEffect(s, SA_FOUGHT, op.id) : undefined
        if (!op || !fx) break
        const enemyId = String(fx.data?.enemyId)
        fx.data = { ...(fx.data ?? {}), offer: false }
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ASSAULT, detail: enemyId }, seat)
        addEffect(ctx, { source: SA_ONLY, seat, kind: 'ability', operativeId: op.id, expires: 'action', data: { targetId: enemyId } })
        if (!startFreeAction(ctx, { operativeId: op.id, action: 'fight', resume: 'ploy.freeAction' })) removeEffects(ctx, (e) => e.source === SA_ONLY && e.operativeId === op.id)
        break
      }
      case 'fk.force': {
        const actorId = String(info.actorId ?? '')
        if (!o.param || !actorId) break
        addEffect(ctx, { source: FORCE, seat, kind: 'ability', operativeId: actorId, expires: 'action', data: { houndId: o.param } })
        ctx.emit({ type: 'AbilityUsed', operativeId: o.param, abilityId: TEMPER, detail: actorId }, seat)
        break
      }
      case 'fk.quickdraw': {
        if (!op || !o.param) break
        markUsedTp(s, seat, QD_TP(op.id))
        const previous = op.order
        if (op.order === 'conceal') setOrder(ctx, op, 'engage')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: QUICK_DRAW, detail: o.param }, seat)
        const started = startFreeAction(ctx, { operativeId: op.id, action: 'shoot', weaponNameContains: 'focused', interrupt: true, resume: 'fk.quickDraw', data: { opId: op.id, enemyId: o.param, previous } })
        if (!started && op.order !== previous) setOrder(ctx, op, previous)
        break
      }
      case 'fk.piercing':
      case 'fk.toxin':
      case 'fk.rfa.piercing':
      case 'fk.rfa.toxin': {
        if (!op) break
        const kind = o.via.endsWith('piercing') ? 'piercing' : 'toxin'
        if (o.via.startsWith('fk.rfa')) markUsedTp(s, seat, RFA_TP)
        else markUsedTp(s, seat, kind === 'piercing' ? PIERCING_TP : TOXIN_TP)
        addEffect(ctx, { source: AMMO, seat, kind: 'equipment', operativeId: op.id, expires: 'action', data: { kind, weaponId: s.attack?.weaponId ?? null } })
        break
      }
      case 'fk.meat':
      case 'fk.rfa.meat': {
        if (!op) break
        if (o.via === 'fk.rfa.meat') markUsedTp(s, seat, RFA_TP)
        else markUsedTp(s, seat, MEAT_TP)
        regainWounds(ctx, op.id, d3(ctx, 'fk.meat') + 1, MEAT_EQ)
        break
      }
      case 'fk.trophy': {
        if (!op) break
        markUsedBattle(s, seat, TROPHY_BATTLE)
        applyAplEffect(ctx, op.id, 1, TROPHY_EQ)
        break
      }
      default:
        break
    }
  },
}

registerPloyRule(FK_RULE)

