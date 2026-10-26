// Imperial Navy Breachers (docs/spec/13-teams.md section 17, rule ids T-NB.n): the code hooks this team's data names, its
// team rule provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and ploy rules
// (ploy-rules.ts).
//
// Map of the rules to the code below:
//  - Roster rules (T-NB.1 to 6) are data: team.json slots (repeatable, caps, halfSelections) and selection.requires.
//  - Orders (T-NB.7, 8, 33, 34): the Attack and Defence Order markers are team markers placed by the two strategy
//    ploys; the effects read the markers, so Command Breach's swap is just changing a marker's kind. Free orders are a
//    ployRule costAdjust, the redirect a 0 CP pseudo ploy offered in the Sergeant's activation windows.
//  - Activation chains (T-NB.9, 32, 37): provider chainActivation with a per-TP Breach and Clear pair effect.
//  - Machines (T-NB.11 to 17, 22): providers activationBarred, actionForbidden, moveRestrictions, controlApl and
//    moveLimitDelta, plus attack hooks (no assists, hidden in cover, SPOT, Breachwall).
//  - Void Armour, Brace, Emboldened, Close Assault, Blitz, Slugs, Rebreathers: attack-sequence hooks.
//  - Detonate (T-NB.28): provider fixedTargets / weaponForbidden. Remote Control: startDelegatedAction.
import { applyAplEffect, hasRule, ruleKey, ruleSetFor } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { codeParams, hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, addTpUse, markUsedTp, removeEffects, tpUsesOf, usedThisTp } from '../effects'
import { territoryOf } from '../equipment'
import { cancelAction, finishAction, startDelegatedAction } from '../firefight'
import { circleOverlapsPolygon, dist2, distPointSegment, round3, segmentPolygonIntervals } from '../geometry'
import { registerFrameResume, registerHook } from '../hooks'
import { bodyOf, targetVerdict, visible, type Body } from '../los'
import { controlledBy, newMarkerId } from '../markers'
import { distanceBetween, enemiesInControlRange, gapToMarker } from '../measure'
import { registerPloyRule, type PloyOffer } from '../ploy-rules'
import type { Ctx } from '../registry'
import { activeOps, effectiveApl, enemiesOf, hasInjuredPenalty, SEATS } from '../state'
import { providerActivationBarred, registerTeamRules } from '../team-rules'
import { terrainOf } from '../terrain'
import { addToken, removeTokensWhere, tokensOn } from '../tokens'
import type { AttackDie, GameState, Marker, Operative, RerollGrant, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'imperial-navy-breachers'

const NB = 'IMPERIAL NAVY BREACHER'
const EPS = 1e-6

const A = (id: string): string => `nb.a.${id}`
const P = (id: string): string => `nb.p.${id}`
const E = (id: string): string => `nb.e.${id}`

const ATTACK_ORDER = P('attack-order')
const DEFENCE_ORDER = P('defence-order')
const CLOSE_ASSAULT = P('close-assault')
const BRACE = P('brace-for-counterattack')
const OVERWHELM = P('overwhelm-target')
const BLITZ = P('blitz')
const LOCK = P('lock-it-down')

const REBREATHERS = E('rebreathers')
const SLUGS = E('slugs')
const STIMMS = E('combat-stimms')

const SPOT_ACTION = A('spot')
const SPOT_TOKEN = 'nb.spotted'
const EMBOLDENED_TOKEN = 'nb.emboldened'
const PAIR = 'nb.pair'
const BC_TP = 'nb.breachAndClear'
const REDIRECT_USED = 'nb.redirect.used'
const BOOST_USED = 'nb.boost.used'
const BOOST_FX = 'nb.boost'
const FIRST_SF = 'nb.firstShootFight'
const FIRST_ACT = 'nb.firstActivated'
const LOCK_FX = 'nb.lock'
const DECK_FX = 'nb.deckHand'
const BLITZ_FX = 'nb.blitzFx'
const SLUG_FX = 'nb.slugFx'
const SLUG_KEY = 'nb.slugs'
const TASSAULT_TAG = 'nb.assault'

const DETONATOR = 'nb.w.gheistskull-detonator'
const SHOTGUN_LONG = 'nb.w.navis-shotgun-long'
const SHOTGUNS = ['nb.wg.navis-shotgun', 'nb.wg.navis-heavy-shotgun']
const FRAG = 'core.w.frag-grenade'
const KRAK = 'core.w.krak-grenade'
const STUN = 'core.a.stun-grenade'

const DICE_SOURCES = ['normal', 'crit', 'strike-normal', 'strike-crit']

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game.
for (const name of [
  'nbFreeOrders',
  'nbRedirect',
  'nbGroupActivation',
  'nbEmboldened',
  'nbCatBar',
  'nbMachineActions',
  'nbMachineLimits',
  'nbMachineControl',
  'nbMachineCover',
  'nbBreachwall',
  'nbShield',
  'nbGrenadier',
  'nbDetonate',
  'nbVoidArmour',
  'nbVoidShrapnel',
  'nbBreachAndClear',
  'nbRebreathers',
  'nbSlugs',
  'nbStimms',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isNb(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, NB)
}

function live(o: Operative): boolean {
  return o.status === 'active' && o.wounds > 0
}

function isCat(s: GameState, o: Operative): boolean {
  return hasKeyword(s, o, 'CAT UNIT')
}
const isSkull = (s: GameState, o: Operative): boolean => hasKeyword(s, o, 'GHEISTSKULL')
/** A Machine: C.A.T. Unit or Gheistskull (they share the Machine rules). */
export function isMachine(s: GameState, o: Operative): boolean {
  return hasAbility(s, o, A('machine-actions'))
}

function nbOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isNb(state, o))
}

function byId(a: Operative, b: Operative): number {
  return a.id < b.id ? -1 : 1
}

function gap(a: Operative, b: Operative): number {
  return distanceBetween(bodyOf(a), bodyOf(b))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return gap(a, b) <= inches + EPS
}

/**
 * The C.A.T. Unit's wide view (T-NB.16) draws visibility from any part of the miniature: eye points sampled around the
 * body (`body`: where it stands, or a ghost on a planned path) at head and mid height. Answered through the `viewpoints`
 * provider, so core `visible` and control range use them everywhere.
 */
function wideViewEyes(state: GameState, op: Operative, body: Body): Body[] | null {
  if (!isCat(state, op) || !hasAbility(state, op, A('wide-view'))) return null
  const r = op.baseRadius * 0.95
  const out: Body[] = []
  for (const frac of [0.9, 0.5]) {
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI * i) / 4
      out.push({ ...body, pos: { x: body.pos.x + Math.cos(ang) * r, y: body.pos.y, z: body.pos.z + Math.sin(ang) * r }, height: (body.height * frac) / 0.9 })
    }
  }
  return out
}

/** What `a` can see (core visibility; the C.A.T. Unit's wide view comes in through `viewpoints`). */
function sees(state: GameState, a: Operative, b: Operative): boolean {
  return visible(state, bodyOf(a), bodyOf(b))
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

function opEffect(state: GameState, source: string, opId: string) {
  return state.effects.find((e) => e.source === source && e.operativeId === opId)
}

/** A strategy ploy of the seat that is in force this turning point (a flag effect). */
export function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function ruleIndex(rules: WeaponRuleRef[], key: string): number {
  return rules.findIndex((r) => ruleKey(r.rule) === key)
}

function liveFails(dice: AttackDie[]): AttackDie[] {
  return dice.filter((d) => d.kind === 'fail' && d.value !== null && !d.used && !d.tag)
}

/** Comms Device (M-5.1): 3" more on the SUPPORT distances of an operative that itself controls the marker. */
function commsReach(state: GameState, op: Operative): number {
  if (controlledBy(state, op, (m) => m.equipmentId === 'core.e.comms-device' && m.owner === op.seat).length === 0) return 0
  markFired('commsDevice')
  return 3
}

/** The seat's Surveyors that were incapacitated (or removed): the C.A.T. Unit stays barred for good (T-NB.11). */
function surveyorDown(state: GameState, seat: Seat): boolean {
  return Object.values(state.operatives).some((o) => o.seat === seat && hasKeyword(state, o, 'SURVEYOR') && (o.status === 'removed' || o.wounds <= 0))
}

/** Why the C.A.T. Unit cannot be activated or act right now, or null. */
function catBarReason(state: GameState, op: Operative): string | null {
  if (!isCat(state, op) || !hasAbility(state, op, A('machine-bar'))) return null
  if (op.status === 'active' && inEnemyCr(state, op)) return `${op.name} is in an enemy control range`
  if (surveyorDown(state, op.seat)) return `${op.name} lost its Surveyor`
  return null
}

/**
 * Accessible crossings along a path (R-11.6, plus the thin parts a Breach marker opens up), as movement.ts counts them,
 * leaving out Obstructing crossings (Razor Wire), which the movement breakdown lumps in with them. DECK HAND refunds
 * only these (T-NB.40).
 */
function accessibleCrossings(state: GameState, op: Operative, path: Vec3[]): number {
  const idx = terrainOf(state.map)
  const open = idx.solids.filter((s) => s.accessible)
  const breaches = state.markers.filter((m) => m.equipmentId === 'breach' && m.featureId)
  const nearBreach = (p: Vec2): Marker | undefined => breaches.find((m) => dist2(p, m.pos) - op.baseRadius - 20 / 25.4 / 2 <= 1 + EPS)
  let n = 0
  for (let i = 1; i < path.length; i++) {
    const a = { x: path[i - 1]!.x, z: path[i - 1]!.z }
    const b = { x: path[i]!.x, z: path[i]!.z }
    const level = Math.min(path[i - 1]!.y, path[i]!.y)
    for (const sol of open) if (level + 0.01 < sol.top && segmentPolygonIntervals(a, b, sol.polygon).length > 0) n++
    const m = nearBreach(a) ?? nearBreach(b)
    if (!m) continue
    for (const sol of idx.solids) {
      if (sol.featureId !== m.featureId || sol.accessible || sol.thickness === null || sol.thickness > 1 + EPS) continue
      if (level + 0.01 < sol.top && segmentPolygonIntervals(a, b, sol.polygon).length > 0) n++
    }
  }
  return n
}

function setUnits(rules: WeaponRuleRef[], next: WeaponRuleRef[]): void {
  rules.splice(0, rules.length, ...next)
}

function d6(ctx: Ctx, purpose: string): number {
  return ctx.roll(purpose, 1)[0]!
}

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState) {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

// ---------------------------------------------------------------------------
// Breach and Clear pairs (T-NB.32, 37) and the markers of the two orders (T-NB.33, 34)
// ---------------------------------------------------------------------------

interface Pair {
  first: string
  partner: string
}

function pairOf(state: GameState, seat: Seat): Pair | null {
  const fx = state.effects.find((e) => e.kind === PAIR && e.seat === seat)
  if (!fx?.operativeId || typeof fx.data?.partnerId !== 'string') return null
  return { first: fx.operativeId, partner: fx.data.partnerId }
}

function inPair(state: GameState, seat: Seat, opId: string): boolean {
  const p = pairOf(state, seat)
  return !!p && (p.first === opId || p.partner === opId)
}

const ORDER_KINDS = [ATTACK_ORDER, DEFENCE_ORDER]

function orderMarkers(state: GameState, seat: Seat, kind?: string): Marker[] {
  return state.markers.filter((m) => m.owner === seat && !!m.equipmentId && ORDER_KINDS.includes(m.equipmentId) && (!kind || m.equipmentId === kind))
}

function nearOrder(state: GameState, op: Operative, kind: string, inches: number): boolean {
  return orderMarkers(state, op.seat, kind).some((m) => gapToMarker(bodyOf(op), m) <= inches + EPS)
}

/** Spots an order marker can go: on the friendly Breachers and midway between close pairs, most covered first. */
export function orderSpots(state: GameState, seat: Seat): { x: number; z: number }[] {
  const ops = nbOps(state, seat).sort(byId)
  const seen = new Set<string>()
  const cands: { x: number; z: number; n: number }[] = []
  const add = (x: number, z: number): void => {
    const key = `${Math.round(x * 20) / 20},${Math.round(z * 20) / 20}`
    if (seen.has(key)) return
    seen.add(key)
    const n = ops.filter((o) => Math.hypot(o.pos.x - x, o.pos.z - z) - o.baseRadius <= 3 + EPS).length
    cands.push({ x: round3(x), z: round3(z), n })
  }
  for (const o of ops) add(o.pos.x, o.pos.z)
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i]!
      const b = ops[j]!
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) <= 6) add((a.pos.x + b.pos.x) / 2, (a.pos.z + b.pos.z) / 2)
    }
  }
  cands.sort((p, q) => q.n - p.n)
  return cands.slice(0, 12).map(({ x, z }) => ({ x, z }))
}

function placeOrder(ctx: Ctx, seat: Seat, kind: string, x: number, z: number): void {
  const marker: Marker = {
    id: newMarkerId(ctx, kind === ATTACK_ORDER ? 'attack-order' : 'defence-order'),
    kind: 'equipment',
    pos: { x, z },
    owner: seat,
    carriedBy: null,
    controller: null,
    equipmentId: kind,
  }
  ctx.state.markers.push(marker)
  ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: null, pos: marker.pos }, seat)
}

function orderPloy(kind: string, hookName: string, other: string): void {
  registerCodeHook({
    name: hookName,
    ploy: {
      // not in the same Strategy phase as the other order; the marker can go anywhere in the killzone
      offers(state, seat): PloyOfferSeed[] {
        if (usedThisTp(state, seat, other)) return []
        return orderSpots(state, seat).map((p) => ({ param: `${p.x},${p.z}` }))
      },
      apply(ctx, seat, _ploy, seed) {
        const [x, z] = (seed.param ?? '0,0').split(',').map(Number) as [number, number]
        placeOrder(ctx, seat, kind, x, z)
      },
    },
  })
}
orderPloy(ATTACK_ORDER, 'nbAttackOrder', DEFENCE_ORDER)
orderPloy(DEFENCE_ORDER, 'nbDefenceOrder', ATTACK_ORDER)

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

/** Machine rules: the actions a Machine may take (T-NB.12), by card keyword. */
function machineAllows(state: GameState, op: Operative, actionId: string): boolean {
  const p = codeParams(state, op, 'nbMachineActions')
  const list = ((p?.[isCat(state, op) ? 'CAT UNIT' : 'GHEISTSKULL'] as string[] | undefined) ?? []).slice()
  return list.includes(actionId)
}

/** Breachwall (T-NB.19): does the Endurant stand between the shooter and the target? */
function intervening(shooter: Operative, target: Operative, blocker: Operative): boolean {
  const rim = (c: Vec2, r: number, n: number, from = 0, span = Math.PI * 2): Vec2[] => {
    const out: Vec2[] = []
    for (let i = 0; i < n; i++) {
      const a = from + (span * i) / Math.max(1, n - (span < Math.PI * 2 ? 1 : 0))
      out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r })
    }
    return out
  }
  const sc = { x: shooter.pos.x, z: shooter.pos.z }
  const tc = { x: target.pos.x, z: target.pos.z }
  const bc = { x: blocker.pos.x, z: blocker.pos.z }
  const origins = [sc, ...rim(sc, shooter.baseRadius, 8)]
  // the half of the target's base that faces the shooter
  const facing = Math.atan2(sc.z - tc.z, sc.x - tc.x)
  const aims = [tc, ...rim(tc, target.baseRadius, 9, facing - Math.PI / 2, Math.PI)]
  // the shooter picks its best origin, so the Endurant intervenes only if every origin has a line through its base
  return origins.every((o) => aims.some((a) => distPointSegment(bc, o, a) < blocker.baseRadius - EPS))
}

function touching(a: Operative, b: Operative): boolean {
  return dist2({ x: a.pos.x, z: a.pos.z }, { x: b.pos.x, z: b.pos.z }) - a.baseRadius - b.baseRadius <= 0.01
}

registerTeamRules({
  id: TEAM_ID,

  // Machine: wide view (T-NB.16): extra eye points for core visibility and control range
  viewpoints(state, op, body) {
    return wideViewEyes(state, op, body)
  },

  // GROUP ACTIVATION (T-NB.9) and BREACH AND CLEAR (T-NB.32)
  chainActivation(state, expended, wasChained) {
    if (!isNb(state, expended)) return null
    const pair = pairOf(state, expended.seat)
    if (pair && (pair.first === expended.id || pair.partner === expended.id)) {
      // the first of the pair is expended: the partner comes next if it still can
      if (wasChained || pair.first !== expended.id) return null
      const partner = state.operatives[pair.partner]
      if (!partner || !live(partner) || !partner.ready || providerActivationBarred(state, partner)) return null
      markFired('nbBreachAndClear')
      return [partner.id]
    }
    if (wasChained || !hasAbility(state, expended, A('group-activation'))) return null
    const ids = nbOps(state, expended.seat)
      .filter((o) => o.id !== expended.id && o.ready && hasAbility(state, o, A('group-activation')) && !providerActivationBarred(state, o) && !inPair(state, o.seat, o.id))
      .map((o) => o.id)
    if (ids.length > 0) markFired('nbGroupActivation')
    return ids
  },

  // the C.A.T. Unit's activation bar (T-NB.11)
  activationBarred(state, op) {
    if (!catBarReason(state, op)) return false
    markFired('nbCatBar')
    return true
  },

  // Machine actions (T-NB.12): the whitelist; a barred C.A.T. Unit can do nothing, free actions and counteractions included
  actionForbidden(state, op, actionId) {
    if (!isNb(state, op) || !isMachine(state, op)) return null
    const bar = catBarReason(state, op)
    if (bar) return bar
    if (machineAllows(state, op, actionId)) return null
    markFired('nbMachineActions')
    return `${op.name} is a Machine and cannot take ${actionId}`
  },

  // no climbing or jumping for the C.A.T. Unit (T-NB.13)
  moveRestrictions(state, op) {
    if (!isNb(state, op) || !isCat(state, op) || !hasAbility(state, op, A('machine-limits'))) return null
    markFired('nbMachineLimits')
    return { noClimb: true, noJump: true }
  },

  // Machine control (T-NB.14) and LOCK IT DOWN (T-NB.39): neither is an APL change
  controlApl(state, op, marker, apl) {
    let v = apl
    if (isNb(state, op) && hasAbility(state, op, A('machine-control'))) {
      v -= 1
      markFired('nbMachineControl')
    }
    const lock = state.effects.find((e) => e.kind === LOCK_FX && e.seat === op.seat && e.operativeId === op.id)
    if (lock && lock.data?.markerId === marker.id) {
      v += 1
      markFired('nbLockItDown')
    }
    return v === apl ? null : Math.max(0, v)
  },

  // COMBAT STIMMS (T-NB.43): the Move reduction from being injured is ignored
  moveDelta(state, op) {
    if (!isNb(state, op) || !equipped(state, op.seat, STIMMS) || !hasInjuredPenalty(op)) return 0
    markFired('nbStimms')
    return 2
  },

  // BOOST (T-NB.22): the next Charge may move 4" further instead of 2"
  moveLimitDelta(state, op, kind) {
    if (kind !== 'charge' || !opEffect(state, BOOST_FX, op.id)) return 0
    markFired('nbBoost')
    return 2
  },

  // SHIELD (T-NB.20): each block cancels two unresolved successes
  blockCapacity(state, attack, seat) {
    const seq = attack.seq
    if (attack.kind !== 'fight' || !seq) return null
    const side = seq.atk.seat === seat ? seq.atk : seq.def && seq.def.seat === seat ? seq.def : null
    const weapon = side?.weaponId ? state.data.weapons[side.weaponId] : undefined
    if (!weapon || !hasRule(weapon.rules, 'shield')) return null
    markFired('nbShield')
    return 2
  },

  // DECK HAND (T-NB.40): one Accessible crossing is free in the activation (never an Obstructing one)
  moveSurcharge(state, op, _kind, points, breakdown) {
    if (breakdown.accessible <= 0 || !opEffect(state, DECK_FX, op.id)) return 0
    // the breakdown's Obstructing share (Razor Wire) is not Accessible terrain; a direct cost query has no share
    const plain = breakdown.obstructing !== undefined ? breakdown.accessible - breakdown.obstructing : accessibleCrossings(state, op, [op.pos, ...points])
    const free = Math.min(1, plain)
    if (free <= 0) return 0
    markFired('nbDeckHand')
    return -free
  },

  // GRENADIER (T-NB.23): its own frag, krak and stun grenades
  extraActions(state, op) {
    return hasAbility(state, op, A('grenadier')) ? [STUN] : []
  },
  ownGrenades(state, op) {
    if (!hasAbility(state, op, A('grenadier'))) return null
    markFired('nbGrenadier')
    return { weapons: { [FRAG]: 1, [KRAK]: 1 }, actions: { [STUN]: 1 } }
  },

  // DETONATE (T-NB.28): the friendly Gheistskull is the only target; the weapon cannot be picked without it
  fixedTargets(state, shooter, weaponId) {
    if (weaponId !== DETONATOR || !isNb(state, shooter)) return null
    const skull = nbOps(state, shooter.seat).find((o) => isSkull(state, o))
    markFired('nbDetonate')
    return { targets: skull ? [skull.id] : [], noCover: true, noObscured: true }
  },
  weaponForbidden(state, op, weaponId) {
    if (weaponId !== DETONATOR || !isNb(state, op)) return null
    return nbOps(state, op.seat).some((o) => isSkull(state, o)) ? null : 'the Gheistskull is not in the killzone'
  },
})

// ---------------------------------------------------------------------------
// Weapon rules: Spot, Attack Order, Blitz, Slugs, Rebreathers
// ---------------------------------------------------------------------------

/** Is `targetId` marked by a SPOT whose C.A.T. Unit still stands and belongs to the shooter's seat? */
export function spotted(state: GameState, shooter: Operative, targetId: string): boolean {
  if (!isNb(state, shooter)) return false
  return tokensOn(state, targetId).some((t) => t.kind === SPOT_TOKEN && t.owner === shooter.seat && t.count > 0)
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const weapon = s.data.weapons[c.weaponId]
    // REBREATHERS: an enemy weapon's Shock does nothing against a friendly Breacher (T-NB.41)
    if (target && isNb(s, target) && target.seat !== op.seat && equipped(s, target.seat, REBREATHERS) && ruleIndex(rules, 'shock') >= 0) {
      setUnits(rules, rules.filter((r) => ruleKey(r.rule) !== 'shock'))
      markFired('nbRebreathers')
    }
    if (!isNb(s, op)) return null
    // ATTACK ORDER: Ceaseless within 3" of the marker, shooting, fighting or retaliating (T-NB.33)
    if (nearOrder(s, op, ATTACK_ORDER, 3) && ruleIndex(rules, 'ceaseless') < 0) {
      rules.push({ rule: 'core.wr.ceaseless' })
      markFired('nbAttackOrder')
    }
    // SPOT: Seek Light on the ranged weapons of a Breacher shooting the spotted enemy (T-NB.18)
    if (data.kind === 'shoot' && weapon?.type === 'ranged' && target && spotted(s, op, target.id) && ruleIndex(rules, 'seeklight') < 0) {
      rules.push({ rule: 'core.wr.seek-light' })
      markFired('nbSpot')
    }
    // BLITZ: Accurate 1, and Severe for the first operative activated (T-NB.38)
    const blitz = opEffect(s, BLITZ_FX, op.id)
    if (blitz) {
      rules.push({ rule: 'core.wr.accurate', x: 1 })
      if (blitz.data?.severe === true && ruleIndex(rules, 'severe') < 0) rules.push({ rule: 'core.wr.severe' })
      markFired('nbBlitz')
    }
    // SLUGS: the long-range shotgun gets Accurate 1 for the action (T-NB.42)
    const slug = opEffect(s, SLUG_FX, op.id)
    if (slug && c.weaponId === SHOTGUN_LONG && slug.data?.weaponId === c.weaponId) {
      rules.push({ rule: 'core.wr.accurate', x: 1 })
      markFired('nbSlugs')
    }
    return null
  },
  'nb.modifyWeaponRules',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op) return null
    const data = c.data as { kind: 'shoot' | 'fight'; hitDelta: number; assists: string[] }
    // Machines cannot assist a friendly fighter (T-NB.13)
    if (data.kind === 'fight' && data.assists.length > 0) {
      const keep = data.assists.filter((id) => {
        const a = s.operatives[id]
        return !(a && isNb(s, a) && isMachine(s, a))
      })
      if (keep.length !== data.assists.length) {
        data.assists = keep
        markFired('nbMachineLimits')
      }
    }
    // SLUGS: Hit 1 better on the long-range shotgun (T-NB.42)
    const slug = opEffect(s, SLUG_FX, op.id)
    if (slug && c.weaponId === SHOTGUN_LONG && slug.data?.weaponId === c.weaponId && data.kind === 'shoot') data.hitDelta -= 1
    return null
  },
  'nb.modifyAttackDice',
)

registerHook(
  'modifyDamage',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !op || !isNb(s, op)) return null
    const data = c.data as { kind: 'shoot' | 'fight'; weaponId: string; dmg: { normal: number; crit: number } }
    const weapon = s.data.weapons[data.weaponId]
    // SLUGS: +1/+1 (T-NB.42)
    const slug = opEffect(s, SLUG_FX, op.id)
    if (slug && data.weaponId === SHOTGUN_LONG && slug.data?.weaponId === data.weaponId) {
      data.dmg.normal += 1
      data.dmg.crit += 1
    }
    // CLOSE ASSAULT: the shotguns get +1/+1 against any operative within 3" (T-NB.35)
    if (ployActive(s, op.seat, CLOSE_ASSAULT) && target && target.id !== op.id && weapon?.profileGroup && SHOTGUNS.includes(weapon.profileGroup) && within(op, target, 3)) {
      data.dmg.normal += 1
      data.dmg.crit += 1
      markFired('nbCloseAssault')
    }
    return null
  },
  'nb.modifyDamage',
)

// CLOSE ASSAULT, second half: two or more fails turn one into a normal success (not while retaliating)
registerHook(
  'afterAttackRoll',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { kind: 'shoot' | 'fight'; side: 'attack' | 'defence'; targetId: string; dice: AttackDie[] }
    if (!s || !op || !isNb(s, op) || data.side !== 'attack' || !ployActive(s, op.seat, CLOSE_ASSAULT)) return null
    const a = s.attack
    if (data.kind === 'fight' && a && a.operativeId !== op.id) return null
    const target = s.operatives[data.targetId]
    // the card says "an operative": a friendly target (the Detonate shot at the Gheistskull) qualifies too
    if (!target || target.id === op.id || !within(op, target, 3)) return null
    const fails = liveFails(data.dice)
    if (fails.length < 2) return null
    const keep = fails[0]!
    keep.value = null
    keep.kind = 'normal'
    keep.tag = TASSAULT_TAG
    fails[1]!.used = true
    markFired('nbCloseAssault')
    return null
  },
  'nb.afterAttackRoll',
)

// ---------------------------------------------------------------------------
// Defence: Void Armour (T-NB.30), Defence Order (T-NB.34)
// ---------------------------------------------------------------------------

function hasSweepingProfile(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  if (!w) return false
  const siblings = w.profileGroup ? Object.values(state.data.weapons).filter((x) => x.profileGroup === w.profileGroup) : [w]
  return siblings.some((x) => /\(sweeping\)/i.test(x.name))
}

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const target = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !target || !isNb(s, target)) return null
    const data = c.data as { attackerId: string; weaponId: string; rerolls: RerollGrant[] }
    const attacker = s.operatives[data.attackerId]
    if (!attacker) return null
    // VOID ARMOUR: one re-roll (two for a Grenadier) against Blast or Torrent weapons without a sweeping profile
    const rules = ruleSetFor(s, attacker, data.weaponId, 'shoot', target.id, c.engine)
    if ((rules.blast !== null || rules.torrent !== null) && !hasSweepingProfile(s, data.weaponId)) {
      const n = hasAbility(s, target, A('grenadier')) ? 2 : 1
      for (let i = 0; i < n; i++) data.rerolls.push({ id: `nb-void-armour-${i + 1}`, source: A('void-armour'), mode: 'one', used: false })
      markFired('nbVoidArmour')
    }
    // DEFENCE ORDER: re-roll every die showing one chosen result within 3" of the marker, whoever shoots (T-NB.34)
    if (nearOrder(s, target, DEFENCE_ORDER, 3)) {
      data.rerolls.push({ id: 'nb-defence-order', source: DEFENCE_ORDER, mode: 'result', used: false })
      markFired('nbDefenceOrder')
    }
    return null
  },
  'nb.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// Damage taken: Void Armour shrapnel, Brace for Counterattack, Emboldened
// ---------------------------------------------------------------------------

function bracedNow(state: GameState, op: Operative): boolean {
  const terr = territoryOf(state, op.seat)
  if (terr && circleOverlapsPolygon({ x: op.pos.x, z: op.pos.z }, op.baseRadius, terr)) return true
  return !(op.actionsThisTp ?? []).some((a) => a === 'charge' || a === 'fallBack' || a === 'reposition')
}

registerHook(
  'onDamageInflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isNb(s, op)) return null
    const d = c.data as { source: string; amount: number; splash?: boolean }
    // VOID ARMOUR: x" Devastating does nothing to a friendly Breacher that is not the sequence's target (T-NB.31)
    if (d.splash === true && d.amount > 0) {
      d.amount = 0
      markFired('nbVoidShrapnel')
      return null
    }
    if (d.amount <= 0) return null
    // BRACE FOR COUNTERATTACK: each Normal or Critical die of Dmg 3+ does 1 less (T-NB.36); Devastating is left alone
    if (DICE_SOURCES.includes(d.source) && d.amount >= 3 && ployActive(s, op.seat, BRACE) && bracedNow(s, op)) {
      d.amount -= 1
      markFired('nbBrace')
    }
    // EMBOLDENED: after a Charge this turning point, 3+ damage from a die rolls a D6, 5+ takes 1 off (T-NB.10)
    const p = codeParams(s, op, 'nbEmboldened')
    if (ctx && p && (DICE_SOURCES.includes(d.source) || d.source === 'devastating') && d.amount >= Number(p.threshold ?? 3) && (op.actionsThisTp ?? []).includes('charge')) {
      markFired('nbEmboldened')
      if (d6(ctx, 'nb.emboldened') >= Number(p.rollOn ?? 5)) d.amount -= Number(p.reduceBy ?? 1)
    }
    return null
  },
  'nb.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// Targeting: SPOT's extra candidates, Machine cover (T-NB.15), Breachwall (T-NB.19)
// ---------------------------------------------------------------------------

function inCoverFrom(state: GameState, shooter: Operative, target: Operative): boolean {
  return targetVerdict(state, bodyOf(shooter), { ...bodyOf(target), order: target.order }).inCover
}

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !shooter) return null
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    // DETONATE picks its own targets (fixedTargets): the ordinary list stays empty so no planner reads it as a shot at an enemy
    if (data.weaponId === DETONATOR) {
      data.candidates.length = 0
      return null
    }
    // SPOT: Seek Light makes a Conceal enemy in Light cover a valid target for a Breacher (T-NB.18)
    if (isNb(s, shooter) && s.data.weapons[data.weaponId]?.type === 'ranged') {
      const base = ruleSetFor(s, shooter, data.weaponId, 'shoot', undefined, c.engine)
      for (const e of enemiesOf(s, shooter)) {
        if (e.wounds <= 0 || data.candidates.includes(e.id) || !spotted(s, shooter, e.id)) continue
        const rules = { ...base, seekLight: true }
        if (rules.range !== null && distanceBetween(bodyOf(shooter), bodyOf(e)) > rules.range + EPS) continue
        if (enemiesInControlRange(s, e, e.seat).length > 0) continue
        const v = targetVerdict(s, bodyOf(shooter), { ...bodyOf(e), order: e.order })
        if (!v.visible) continue
        // Seek Light lets a Conceal operative in Light cover be picked (heavy cover still hides it)
        if (e.order === 'conceal' && v.inCover && !v.vantage.denyLightCover) {
          const heavy = v.coverParts.length > 0 && v.coverParts.some((p) => (p as { heavy?: boolean }).heavy === true)
          if (heavy) continue
        }
        data.candidates.push(e.id)
        markFired('nbSpot')
      }
    }
    const keep = data.candidates.filter((id) => {
      const t = s.operatives[id]
      if (!t || t.seat === shooter.seat) return true
      // MACHINE: a Conceal Machine in cover cannot be selected beyond 2" (T-NB.15)
      if (isNb(s, t) && isMachine(s, t) && t.order === 'conceal' && !within(shooter, t, 2) && inCoverFrom(s, shooter, t)) {
        markFired('nbMachineCover')
        return false
      }
      // BREACHWALL: the Engage Endurant shelters the one friendly Breacher touching it (T-NB.19)
      if (isNb(s, t)) {
        for (const e of nbOps(s, t.seat)) {
          if (e.id === t.id || !hasAbility(s, e, A('breachwall')) || e.order !== 'engage' || !touching(e, t)) continue
          const others = activeOps(s).filter((o) => o.seat === e.seat && o.id !== e.id && live(o) && touching(e, o))
          if (others.length !== 1 || others[0]!.id !== t.id) continue
          if (!intervening(shooter, t, e)) continue
          markFired('nbBreachwall')
          return false
        }
      }
      return true
    })
    data.candidates.splice(0, data.candidates.length, ...keep)
    return null
  },
  'nb.beforeShootTargetSelect',
)

registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !shooter || !c.targetId || !spotted(s, shooter, c.targetId)) return null
    ;(c.data as { obscured: boolean }).obscured = false
    markFired('nbSpot')
    return null
  },
  'nb.target.status',
)

// ---------------------------------------------------------------------------
// Activation hooks: first-activation record (Blitz), Rebreathers, Machines
// ---------------------------------------------------------------------------

/** REBREATHERS: friendly Breachers ignore APL decreases; the correction is emitted (T-NB.41). */
function scrubApl(ctx: Ctx): void {
  const s = ctx.state
  for (const seat of SEATS) {
    if (!equipped(s, seat, REBREATHERS)) continue
    for (const op of nbOps(s, seat)) {
      const neg = (op.aplFx ?? []).filter((f) => f.delta < 0)
      if (neg.length === 0) continue
      for (const f of neg) {
        op.aplMods -= f.delta
        ctx.emit({ type: 'AplModified', operativeId: op.id, delta: -f.delta, reason: `${f.source}.rebreathers` })
      }
      op.aplFx = (op.aplFx ?? []).filter((f) => f.delta >= 0)
      markFired('nbRebreathers')
    }
  }
}

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    scrubApl(ctx)
    if (isNb(s, op) && !s.effects.some((e) => e.kind === FIRST_ACT && e.seat === op.seat)) {
      addEffect(ctx, { source: FIRST_ACT, seat: op.seat, kind: FIRST_ACT, operativeId: op.id, expires: 'turningPoint' })
    }
    return null
  },
  'nb.activation.start',
)

registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isNb(s, op)) return null
    const d = c.data as { action: string; cancel: boolean }
    if ((d.action !== 'shoot' && d.action !== 'fight') || d.cancel) return null
    // the first Shoot or Fight a friendly operative performs this turning point (free ones included) is the one Blitz names
    if (s.effects.some((e) => e.kind === FIRST_SF && e.seat === op.seat)) return null
    addEffect(ctx, { source: FIRST_SF, seat: op.seat, kind: FIRST_SF, operativeId: op.id, expires: 'turningPoint', data: { seq: s.firefight.activation?.declaredSeq ?? -1 } })
    return null
  },
  'nb.action.declared',
)

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    const d = c.data as unknown as { action: string }
    scrubApl(ctx)
    // SPOT ends as soon as the enemy leaves the C.A.T. Unit's sight (T-NB.18)
    removeTokensWhere(
      ctx,
      (t, holder) => {
        if (t.kind !== SPOT_TOKEN) return false
        const src = t.sourceId ? s.operatives[t.sourceId] : undefined
        return !src || !live(src) || !sees(s, src, holder)
      },
      'nb.spotLost',
    )
    if (!isNb(s, op)) return null
    // BOOST is spent by the Charge it boosts
    if (d.action === 'charge') removeEffects(ctx, (e) => e.source === BOOST_FX && e.operativeId === op.id)
    // EMBOLDENED token marks the Axejack once it has Charged
    if (d.action === 'charge' && hasAbility(s, op, A('emboldened'))) addToken(ctx, op.id, { kind: EMBOLDENED_TOKEN, owner: op.seat, cap: 1, expires: ['turningPointEnd'] }, 'nb.emboldened')
    // DECK HAND is spent by the first move that crossed Accessible terrain (an Obstructing crossing does not spend it)
    const fx = opEffect(s, DECK_FX, op.id)
    if (fx) {
      const moved = ctx.events.some(
        (e) => e.type === 'OperativeMoved' && e.operativeId === op.id && e.segments.length > 0 && accessibleCrossings(s, op, [e.segments[0]!.from, ...e.segments.map((sg) => sg.to)]) > 0,
      )
      if (moved) removeEffects(ctx, (e) => e.id === fx.id)
    }
    return null
  },
  'nb.action.ended',
)

// ---------------------------------------------------------------------------
// Turning point start (the Ready step): the order markers go
// ---------------------------------------------------------------------------

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    for (const m of [...ctx.state.markers]) {
      if (m.equipmentId && ORDER_KINDS.includes(m.equipmentId)) {
        ctx.state.markers = ctx.state.markers.filter((x) => x.id !== m.id)
        ctx.emit({ type: 'MarkerRemoved', markerId: m.id, reason: 'nb.orderExpired' }, m.owner)
      }
    }
    return null
  },
  'nb.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Unique actions: SPOT, BOOST, BREACH POINT, WAYFIND, REMOTE CONTROL, INTERFERENCE PULSE
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'nbSpot',
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
      // performing SPOT again moves this C.A.T. Unit's token
      removeTokensWhere(ctx, (tok) => tok.kind === SPOT_TOKEN && tok.sourceId === op.id, 'nb.spotMoved')
      addToken(ctx, t.id, { kind: SPOT_TOKEN, owner: op.seat, cap: 1, sourceId: op.id, expires: ['turningPointEnd', 'sourceIncapacitated'] }, 'nb.spot')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'nbBoost',
  action: {
    offers(state, op): OfferSeed[] {
      if (op.oncePerBattleUsed.includes(BOOST_USED) || opEffect(state, BOOST_FX, op.id)) return []
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      if (op.oncePerBattleUsed.includes(BOOST_USED)) {
        cancelAction(ctx)
        return
      }
      op.oncePerBattleUsed.push(BOOST_USED)
      // the bonus lasts for the rest of the activation and is spent by the next Charge in it (RULING)
      addEffect(ctx, { source: BOOST_FX, seat: op.seat, kind: BOOST_FX, operativeId: op.id, expires: 'activation' })
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

function polygonGap(pos: Vec2, r: number, poly: Vec2[]): number {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.z > pos.z !== b.z > pos.z && pos.x < ((b.x - a.x) * (pos.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  if (inside) return 0
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distPointSegment(pos, poly[i]!, poly[(i + 1) % poly.length]!))
  return Math.max(0, d - r)
}

function nearestPoint(p: Vec2, poly: Vec2[]): Vec2 {
  let best = poly[0]!
  let bd = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2))
    const q = { x: a.x + dx * t, z: a.z + dz * t }
    const dd = dist2(p, q)
    if (dd < bd) {
      bd = dd
      best = q
    }
  }
  return best
}

registerCodeHook({
  name: 'nbBreachPoint',
  action: {
    // one option per terrain feature within the control range (1") of the base
    offers(state, op): OfferSeed[] {
      const idx = terrainOf(state.map)
      const seen = new Set<string>()
      const out: OfferSeed[] = []
      for (const sol of idx.solids) {
        if (seen.has(sol.featureId)) continue
        if (polygonGap(op.pos, op.baseRadius, sol.polygon) > 1 + EPS) continue
        seen.add(sol.featureId)
        out.push({ key: sol.featureId, params: { featureId: sol.featureId } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const idx = terrainOf(s.map)
      let best: { p: Vec2; gap: number } | null = null
      for (const sol of idx.solids) {
        if (sol.featureId !== params.featureId) continue
        const near = nearestPoint(op.pos, sol.polygon)
        const g = dist2(near, op.pos) - op.baseRadius
        if (!best || g < best.gap) best = { p: near, gap: g }
      }
      if (!best) {
        cancelAction(ctx)
        return
      }
      const reach = Math.min(best.gap, 1)
      const d = dist2(op.pos, best.p) || 1
      const pos = {
        x: round3(op.pos.x + ((best.p.x - op.pos.x) / d) * (op.baseRadius + reach)),
        z: round3(op.pos.z + ((best.p.z - op.pos.z) / d) * (op.baseRadius + reach)),
      }
      // RULING: each use places a new Breach marker that stays for the battle (the Kommandos marker mechanics)
      const marker: Marker = {
        id: newMarkerId(ctx, 'breach'),
        kind: 'equipment',
        pos,
        owner: op.seat,
        carriedBy: null,
        controller: null,
        equipmentId: 'breach',
        placedBy: op.id,
        featureId: params.featureId as string,
      }
      s.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos }, op.seat)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: params.featureId as string }, op.seat)
      finishAction(ctx)
    },
  },
})

/** Friendly Breachers WAYFIND can name: visible to and within 6" of the Surveyor or of a friendly C.A.T. Unit (T-NB.26). */
export function wayfindTargets(state: GameState, op: Operative): Operative[] {
  const cats = nbOps(state, op.seat).filter((o) => isCat(state, o))
  return nbOps(state, op.seat)
    .filter((f) => f.id !== op.id && !isMachine(state, f))
    .filter((f) => {
      if (within(op, f, 6 + commsReach(state, op)) && sees(state, op, f)) return true
      return cats.some((cat) => within(cat, f, 6 + commsReach(state, cat)) && sees(state, cat, f))
    })
    .sort(byId)
}

registerCodeHook({
  name: 'nbWayfind',
  action: {
    offers(state, op): OfferSeed[] {
      return wayfindTargets(state, op).map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!t || !live(t) || t.seat !== op.seat || t.id === op.id) {
        cancelAction(ctx)
        return
      }
      applyAplEffect(ctx, t.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'nbRemoteControl',
  action: {
    offers(state, op): OfferSeed[] {
      return nbOps(state, op.seat)
        .filter((o) => isCat(state, o) && !providerActivationBarred(state, o) && !catBarReason(state, o))
        .map((o) => ({ key: o.id, params: { targetId: o.id } }))
    },
    perform(ctx, op, def, params) {
      const cat = ctx.state.operatives[params.targetId as string]
      if (!cat || !live(cat) || cat.seat !== op.seat || !isCat(ctx.state, cat)) {
        cancelAction(ctx)
        return
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: cat.id }, op.seat)
      const started = startDelegatedAction(ctx, {
        operativeId: cat.id,
        resume: 'nb.remoteControl',
        rules: { maxMove: 3, tag: 'nbRemoteControl' },
        data: { controllerId: op.id, abilityId: def.id },
      })
      if (!started) cancelAction(ctx)
    },
  },
})

registerFrameResume('nb.remoteControl', (ctx, outcome) => {
  if (outcome === 'finished') finishAction(ctx)
  else cancelAction(ctx)
})

/** Enemies INTERFERENCE PULSE can name: visible to and within 8" of a friendly Gheistskull (T-NB.29). */
export function pulseTargets(state: GameState, op: Operative): { enemy: Operative; skull: Operative }[] {
  const skulls = nbOps(state, op.seat).filter((o) => isSkull(state, o))
  const out: { enemy: Operative; skull: Operative }[] = []
  for (const e of enemiesOf(state, op).filter(live).sort(byId)) {
    const skull = skulls.find((k) => within(k, e, 8) && sees(state, k, e))
    if (skull) out.push({ enemy: e, skull })
  }
  return out
}

/**
 * Would the enemy be a valid target for the Gheistskull: visible to it and, on a Conceal order, not in cover from it
 * (core Select Valid Target). The separate "no friendly operative in its control range" condition of the Shoot action
 * is not part of being a valid target.
 */
function validForSkull(state: GameState, skull: Operative, enemy: Operative): boolean {
  const v = targetVerdict(state, bodyOf(skull), { ...bodyOf(enemy), order: enemy.order })
  return v.visible && !(enemy.order === 'conceal' && v.inCover)
}

registerCodeHook({
  name: 'nbInterferencePulse',
  action: {
    offers(state, op): OfferSeed[] {
      return pulseTargets(state, op).map(({ enemy }) => ({ key: enemy.id, params: { targetId: enemy.id } }))
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const enemy = s.operatives[params.targetId as string]
      const hit = enemy ? pulseTargets(s, op).find((p) => p.enemy.id === enemy.id) : undefined
      if (!enemy || !hit) {
        cancelAction(ctx)
        return
      }
      const p = codeParams(s, op, 'nbInterferencePulse') ?? {}
      const bonus = validForSkull(s, hit.skull, enemy) ? 1 : 0
      const roll = d6(ctx, 'nb.pulse') + bonus
      if (roll >= Number(p.rollOn ?? 3)) applyAplEffect(ctx, enemy.id, -1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: `${enemy.id}:${roll}` }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys that are turning point flags: CLOSE ASSAULT, BRACE FOR COUNTERATTACK
// ---------------------------------------------------------------------------

function flagPloy(name: string): void {
  registerCodeHook({
    name,
    ploy: {
      offers(): PloyOfferSeed[] {
        return [{}]
      },
      apply(ctx, seat, ploy) {
        addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
      },
    },
  })
}
flagPloy('nbCloseAssault')
flagPloy('nbBrace')

// ---------------------------------------------------------------------------
// Firefight ploys: OVERWHELM TARGET, BLITZ, LOCK IT DOWN, DECK HAND
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'nbOverwhelm',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
      const pair = pairOf(state, seat)
      if (!subject || subject.seat !== seat || info.counteracting || !pair || !inPair(state, seat, subject.id)) return []
      return [pair.first, pair.partner]
        .map((id) => state.operatives[id])
        .filter((o): o is Operative => !!o && live(o) && (o.id === subject.id || o.ready))
        .map((o) => ({ param: o.id, operativeId: o.id }))
    },
    apply(ctx, _seat, ploy, seed) {
      if (seed.param) applyAplEffect(ctx, seed.param, 1, ploy.id)
    },
  },
})

registerCodeHook({
  name: 'nbBlitz',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const foe = info.targetId ? state.operatives[info.targetId] : undefined
      if (!op || op.seat !== seat || !foe || foe.seat === seat || !isNb(state, op) || (info.kind !== 'shoot' && info.kind !== 'fight')) return []
      if (opEffect(state, BLITZ_FX, op.id) || !within(op, foe, 6)) return []
      // only the first Shoot or Fight a friendly operative performs this turning point, and only this very action
      const first = state.effects.find((e) => e.kind === FIRST_SF && e.seat === seat)
      if (!first || first.operativeId !== op.id || first.data?.seq !== (state.firefight.activation?.declaredSeq ?? -2)) return []
      const firstAct = state.effects.find((e) => e.kind === FIRST_ACT && e.seat === seat)
      return [{ data: { severe: firstAct?.operativeId === op.id && !info.counteracting } }]
    },
    apply(ctx, seat, _ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      addEffect(ctx, { source: BLITZ_FX, seat, kind: 'ployFlag', operativeId: op.id, expires: 'action', data: { severe: seed.data?.severe === true } })
    },
  },
})

registerCodeHook({
  name: 'nbLockItDown',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.counteracting || !isNb(state, op)) return []
      return state.markers.filter((m) => m.kind === 'objective').map((m) => ({ param: m.id }))
    },
    apply(ctx, seat, _ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op || !seed.param) return
      // using the ploy again, on anyone, ends the old bonus
      removeEffects(ctx, (e) => e.kind === LOCK_FX && e.seat === seat)
      addEffect(ctx, { source: LOCK, seat, kind: LOCK_FX, operativeId: op.id, expires: 'battle', data: { markerId: seed.param } })
    },
  },
})

registerCodeHook({
  name: 'nbDeckHand',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const act = state.firefight.activation
      if (!op || op.seat !== seat || !isNb(state, op) || info.counteracting || !act || act.operativeId !== op.id || act.counteract || act.frame) return []
      if (opEffect(state, DECK_FX, op.id)) return []
      // RULING (errata): the operative's current APL must be 1 or 2
      const max = Number((codeParams(state, op, 'nbDeckHand') ?? {}).maxApl ?? 2)
      if (effectiveApl(op) > max || effectiveApl(op) < 1) return []
      // only offered with an Accessible terrain feature (or a Breach marker) the operative could still reach in this
      // activation: the farthest it can travel is a Dash (3") plus a Charge (Move + 2"), Boost adding 2" more
      const reach = op.move + 2 + 3 + 2
      const near = terrainOf(state.map).solids.some((sol) => sol.accessible && polygonGap(op.pos, op.baseRadius, sol.polygon) <= reach + EPS)
      // a Breach marker works for an operative within 1" of it
      const breach = state.markers.some((m) => m.equipmentId === 'breach' && Math.hypot(m.pos.x - op.pos.x, m.pos.z - op.pos.z) - op.baseRadius - 1 <= reach + EPS)
      return near || breach ? [{}] : []
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (op) addEffect(ctx, { source: DECK_FX, seat, kind: DECK_FX, operativeId: op.id, expires: 'activation' })
    },
  },
})

// ---------------------------------------------------------------------------
// Ploy rules: free orders (T-NB.7), the redirect (T-NB.8), Breach and Clear (T-NB.32), Slugs (T-NB.42)
// ---------------------------------------------------------------------------

function offer(ployId: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id: param ? `${ployId}:${param}` : ployId, ployId, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

const NB_RULE = {
  /** COMMAND BREACH: Attack Order and Defence Order cost 0 CP while a Sergeant is in the killzone. */
  costAdjust(state: GameState, seat: Seat, ploy: { id: string }): { cost: number; via: string } | null {
    if (ploy.id !== ATTACK_ORDER && ploy.id !== DEFENCE_ORDER) return null
    if (!nbOps(state, seat).some((o) => hasAbility(state, o, A('command-breach-orders')))) return null
    return { cost: 0, via: 'nb.commandBreach' }
  },

  extraOffers(state: GameState, seat: Seat, window: string, info: { subjectId?: string; counteracting?: boolean; weaponId?: string }): PloyOffer[] {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!subject || subject.seat !== seat || !isNb(state, subject) || !live(subject)) return out
    const act = state.firefight.activation
    // ---- COMMAND BREACH redirect: once in the Sergeant's activation, before or after one of its actions
    if ((window === 'firefight.activationStart' || window === 'firefight.actionEnded') && !info.counteracting && hasAbility(state, subject, A('command-breach-redirect'))) {
      const marker = orderMarkers(state, seat)[0]
      if (marker && !opEffect(state, REDIRECT_USED, subject.id) && act && !act.counteract) {
        const other = marker.equipmentId === ATTACK_ORDER ? 'Defence Order' : 'Attack Order'
        out.push(offer('nb.redirect', `Command Breach: turn it into ${other}`, 'nb.swap', subject, 'swap'))
        for (const p of orderSpots(state, seat)) {
          if (Math.hypot(p.x - marker.pos.x, p.z - marker.pos.z) < 0.05) continue
          out.push(offer('nb.redirect', 'Command Breach: move the order marker', 'nb.move', subject, `move:${p.x},${p.z}`))
        }
      }
    }
    // ---- BREACH AND CLEAR: pick a partner as a ready Breacher is activated, once per turning point
    if (window === 'firefight.activationStart' && !info.counteracting && act && act.operativeId === subject.id && !act.counteract && !act.chained && !act.frame) {
      if (!usedThisTp(state, seat, BC_TP) && !pairOf(state, seat)) {
        for (const p of nbOps(state, seat).sort(byId)) {
          if (p.id === subject.id || !p.ready || providerActivationBarred(state, p)) continue
          if (!within(subject, p, 3) || !sees(state, subject, p)) continue
          out.push(offer('nb.bc', `Breach and Clear: pair with ${p.name}`, 'nb.pair', subject, p.id))
        }
      }
    }
    // ---- SLUGS: a Navis shotgun (long range) picked for a Shoot, three uses a turning point for the team
    if (window === 'shoot.targetSelected' && equipped(state, seat, SLUGS) && info.weaponId === SHOTGUN_LONG && tpUsesOf(state, seat, SLUG_KEY) < 3) {
      const a = state.attack
      if (a && a.kind === 'shoot' && a.operativeId === subject.id && !opEffect(state, SLUG_FX, subject.id)) {
        out.push(offer(SLUGS, 'Slugs', 'nb.slugs', subject))
      }
    }
    return out
  },

  onUsed(ctx: Ctx, seat: Seat, o: PloyOffer): void {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    if (o.via === 'nb.commandBreach') {
      markFired('nbFreeOrders')
      return
    }
    if (!op) return
    switch (o.via) {
      case 'nb.swap':
      case 'nb.move': {
        const marker = orderMarkers(s, seat)[0]
        if (!marker) break
        addEffect(ctx, { source: REDIRECT_USED, seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation' })
        if (o.via === 'nb.swap') {
          marker.equipmentId = marker.equipmentId === ATTACK_ORDER ? DEFENCE_ORDER : ATTACK_ORDER
          ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: marker.pos }, seat)
        } else {
          const [x, z] = String(o.param ?? '').replace('move:', '').split(',').map(Number)
          if (Number.isFinite(x) && Number.isFinite(z)) marker.pos = { x: x!, z: z! }
          ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: marker.pos }, seat)
        }
        markFired('nbRedirect')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('command-breach-redirect'), detail: o.via }, seat)
        break
      }
      case 'nb.pair': {
        markUsedTp(s, seat, BC_TP)
        addEffect(ctx, { source: A('breach-and-clear'), seat, kind: PAIR, operativeId: op.id, expires: 'turningPoint', data: { partnerId: o.param } })
        markFired('nbBreachAndClear')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('breach-and-clear'), detail: o.param ?? '' }, seat)
        break
      }
      case 'nb.slugs': {
        addTpUse(s, seat, SLUG_KEY)
        addEffect(ctx, { source: SLUG_FX, seat, kind: 'equipment', operativeId: op.id, expires: 'action', data: { weaponId: s.attack?.weaponId ?? null } })
        markFired('nbSlugs')
        break
      }
      default:
        break
    }
  },
}

registerPloyRule(NB_RULE)
