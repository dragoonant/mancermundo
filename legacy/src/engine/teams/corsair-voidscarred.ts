// Corsair Voidscarred (docs/spec/13-teams.md section 14, rule ids T-CV.n): the code hooks this team's data names, its team
// rule provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules (ploy-rules.ts).
//
// Map of the rules to the code below:
//  - AELDARI RAIDERS (T-CV.24) and VETERAN RAIDER (T-CV.7): the provider actionCostDelta (own activation only), the
//    action.declared / action.ended hooks keep the Felarch's per-activation ledger. CAPRICIOUS FLIGHT (T-CV.31) is a cost
//    change read by the same provider. LIGHT FINGERS is the provider markerActionRelief.
//  - RIFLES, CAMO CLOAK, PIRATICAL PROFITEERS, OUTCASTS, CONTEMPTUOUS ADVENTURER, MISTFIELD: the modifyWeaponRules hook.
//  - ONE STEP AHEAD (T-CV.8) and ERUDITE HUNTER (T-CV.13): the provider `reactions`, answered by the code hooks' choice;
//    the offers are marked `freeActions`, so they also follow an enemy's free action (in its own activation or a
//    Strategy-phase free action). Erudite Hunter's Reposition is held near the enemy by the provider moveProblem.
//  - BLINK PACK (T-CV.14): providers canFly / flyLimit; SLICING ATTACK (T-CV.15): the afterMove of a Reposition plus a 0 CP
//    pseudo ploy in the firefight.actionEnded window; BLADEMASTER (T-CV.10): a unique action that starts a free Dash.
//  - QUICK ON THE TRIGGER (T-CV.18) and PISTOL BARRAGE (T-CV.19): the providers shootInControlRange and
//    freeShootInControlRange (free and Guard interrupt Shoots in an enemy's control range are ordinary Shoots), and the
//    target hook.
//  - The PSYCHIC actions (T-CV.16, 17, 21, 22): unique actions that ask psychicSelectable for every pick; the shield is
//    a token that goes at the Way Seeker's next activation or its incapacitation.
//  - The ploys and equipment: strategy flags read by the hooks, code-hook ploys, and 0 CP pseudo ploys.
import { actionCostDelta as dataCostDelta } from '../abilities'
import { applyAplEffect, ruleKey, ruleSetFor, targetInfo, validTargets, weaponUnusable } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, directDamage, gainCp, markUsedBattle, markUsedTp, regainWounds, usedThisBattle, usedThisTp } from '../effects'
import { fightAvailability } from '../fight'
import { ACTIONS, afterActiveOperativeRemoved, canStartFreeAction, cancelAction, finishAction, reactionDone, startFreeAction } from '../firefight'
import { registerFrameResume, registerHook, type ActionDeclaredData, type OnDamageInflictedData } from '../hooks'
import { bodyOf, visible } from '../los'
import { segmentBBoxOverlaps, segmentPolygonIntervals } from '../geometry'
import { contestedBy, PICK_UP, PLACE } from '../markers'
import { distanceBetween, enemiesInControlRange, inControlRange } from '../measure'
import { moveLimit } from '../movement'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { psychicAllowed, psychicSelectable } from '../psychic'
import type { Ctx } from '../registry'
import { shootableWeapons } from '../shoot'
import { activeOps, effectiveApl, enemiesOf, SEATS } from '../state'
import { resumeGambit } from '../strategy'
import { registerTeamRules, teamRuleProviders, type ReactionOffer } from '../team-rules'
import { terrainOf, type Solid } from '../terrain'
import { addToken, hasToken, removeToken } from '../tokens'
import type { Activation, GameState, Operative, Seat, Vec3, WeaponRuleRef } from '../types'
import { canChargeInto } from './wyrmblade'

export const TEAM_ID = 'corsair-voidscarred'

const CV = 'CORSAIR VOIDSCARRED'
const EPS = 1e-6

const A = (id: string) => `cv.a.${id}`
const P = (id: string) => `cv.p.${id}`
const E = (id: string) => `cv.e.${id}`
const W = (id: string) => `cv.w.${id}`

export const IDS = {
  veteran: A('veteran-raider'),
  osa: A('one-step-ahead'),
  camo: A('camo-cloak'),
  blademaster: A('blademaster'),
  bladed: A('bladed-stance'),
  faolchu: A('faolchus-bond'),
  erudite: A('erudite-hunter'),
  blink: A('blink-pack'),
  slicing: A('slicing-attack'),
  channel: A('soul-channel'),
  heal: A('soul-heal'),
  qott: A('quick-on-the-trigger'),
  barrage: A('pistol-barrage'),
  prowling: A('prowling-raiders'),
  warpFold: A('warp-fold'),
  shield: A('warding-shield'),
  plunderers: P('plunderers'),
  profiteers: P('piratical-profiteers'),
  mobile: P('mobile-engagement'),
  outcasts: P('outcasts'),
  opportunistic: P('opportunistic-fighters'),
  fingers: P('light-fingers'),
  flight: P('capricious-flight'),
  adventurer: P('contemptuous-adventurer'),
  eruditePloy: P('erudite-hunter'),
  starPloy: P('star-charts'),
  mantles: E('diuturnal-mantles'),
  mistfield: E('mistfield'),
  runes: E('runes-of-guidance'),
  starCharts: E('star-charts'),
}

// ledgers, effects and tokens
const RAIDERS_USED = 'cv.raiders'
const OSA_USED = 'cv.osa'
const ERUDITE_USED = 'cv.erudite.react'
const FAOLCHU_USED = 'cv.faolchu'
const MIST_USED = 'cv.mistfield'
const RUNES_USED = 'cv.runes'
const STAR_DONE = 'cv.starcharts.done'
const MOVED_FX = 'cv.moved'
const PLUNDER_FX = 'cv.plunder'
const WARP_BAN_FX = 'cv.warpfold.ban'
const SLICE_FX = 'cv.slice'
const ADVENTURER_FX = 'cv.adventurer'
export const OSA_TOKEN = 'cv.osa'
export const FAOLCHU_TOKEN = 'cv.faolchu'
export const SHIELD_TOKEN = 'cv.shield'
export const ERUDITE_TOKEN = 'cv.erudite'
export const RUNES_TOKEN = 'cv.runes'

const OSA_FRAME = 'cv.oneStepAhead'
const ERUDITE_FRAME = 'cv.erudite'

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game.
for (const name of [
  'cvRifles',
  'cvAeldariRaiders',
  'veteranRaider',
  'cvCamoCloak',
  'bladedStance',
  'faolchusBond',
  'blinkPack',
  'quickOnTheTrigger',
  'prowlingRaiders',
  'diuturnalMantles',
  'mistfield',
  'runesOfGuidance',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isCv(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, CV)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function cvOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isCv(state, o))
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

function setOrder(ctx: Ctx, op: Operative, order: 'engage' | 'conceal'): void {
  if (op.order === order) return
  if (op.flags.guard) {
    op.flags.guard = false
    ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'order' }, op.seat)
  }
  op.order = order
  ctx.emit({ type: 'OrderSet', operativeId: op.id, order })
}

/** The operative's own ordinary activation (not a counteraction, not a free-action frame), or null. */
function ownActivation(state: GameState, op: Operative): Activation | null {
  const a = state.firefight.activation
  return a && a.operativeId === op.id && !a.counteract && !a.frame ? a : null
}

/** The activation an action of `op` belongs to: the underlying one when the current frame is a free action of the same operative. */
function baseActivation(state: GameState, op: Operative): Activation | null {
  const a = state.firefight.activation
  if (!a) return null
  if (a.frame) {
    const under = (state.firefight.stack ?? []).at(-1) ?? null
    return under && under.operativeId === op.id ? under : a
  }
  return a
}

const hasRef = (rules: WeaponRuleRef[], key: string): boolean => rules.some((r) => ruleKey(r.rule) === key)

// ---------------------------------------------------------------------------
// Costs: AELDARI RAIDERS, VETERAN RAIDER, CAPRICIOUS FLIGHT
// ---------------------------------------------------------------------------

function dataKey(actionId: string): string {
  if (actionId.startsWith('ability:')) return actionId.slice('ability:'.length)
  if (actionId === PICK_UP) return 'pick-up-marker'
  if (actionId === PLACE) return 'place-marker'
  return actionId
}

function flightDelta(state: GameState, op: Operative, actionId: string): number {
  return actionId === 'fallBack' && !!opEffect(state, IDS.flight, op.id) ? -1 : 0
}

/** The cost of an action from every source but Aeldari Raiders and Veteran Raider (this team's other rules included). */
function costWithoutRaiders(state: GameState, op: Operative, actionId: string, act: Activation): number {
  let base = ACTIONS[actionId]?.cost
  let mission = false
  if (base === undefined) {
    const def = actionId.startsWith('ability:') ? state.data.abilities[actionId.slice('ability:'.length)] : undefined
    base = def?.ap ?? 1
    mission = (def?.keywords ?? []).includes('MISSION')
  }
  let d = dataCostDelta(state, op, dataKey(actionId), act, mission) + flightDelta(state, op, actionId)
  // every other provider; this team's own is left out so there is no recursion
  for (const p of teamRuleProviders()) if (p.id !== TEAM_ID) d += p.actionCostDelta?.(state, op, actionId) ?? 0
  return Math.max(0, base + d)
}

/**
 * The AP Aeldari Raiders (a non-Felarch's first Dash) or Veteran Raider (the Felarch's first exactly 1 AP action) takes
 * off the action, 0 or negative. Only in the operative's own activation (never a counteraction or a free-action frame).
 */
function raidersDelta(state: GameState, op: Operative, actionId: string): number {
  const act = ownActivation(state, op)
  if (!act || !isCv(state, op)) return 0
  if (hasAbility(state, op, IDS.veteran)) {
    if ((act.used ?? []).includes(RAIDERS_USED)) return 0
    return costWithoutRaiders(state, op, actionId, act) === 1 ? -1 : 0
  }
  if (actionId !== 'dash' && actionId !== `ability:${IDS.blademaster}`) return 0
  if (act.performed.includes('dash')) return 0
  return -costWithoutRaiders(state, op, actionId, act)
}

// ---------------------------------------------------------------------------
// Blink Pack, Slicing Attack geometry
// ---------------------------------------------------------------------------

const BLINK_KINDS = ['charge', 'fallBack', 'reposition']

/** Sample points of the enemy base the line may touch: its centre, its rim and where the straight old-new line meets it. */
function foePoints(from: { x: number; z: number }, to: { x: number; z: number }, foe: Operative): { x: number; z: number }[] {
  const r = foe.baseRadius
  const pts: { x: number; z: number }[] = [{ x: foe.pos.x, z: foe.pos.z }]
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    pts.push({ x: foe.pos.x + Math.cos(a) * r, z: foe.pos.z + Math.sin(a) * r })
  }
  // the point of the straight line between the old and new position that is nearest the foe's centre
  const dx = to.x - from.x
  const dz = to.z - from.z
  const len2 = dx * dx + dz * dz
  if (len2 > EPS) {
    const t = Math.max(0, Math.min(1, ((foe.pos.x - from.x) * dx + (foe.pos.z - from.z) * dz) / len2))
    const q = { x: from.x + dx * t, z: from.z + dz * t }
    if (Math.hypot(q.x - foe.pos.x, q.z - foe.pos.z) <= r + EPS) pts.push(q)
  }
  return pts
}

/**
 * Terrain-free lower bound of the Slicing Attack line: old base -> a point of the enemy base -> new base, in plan.
 * The real line (slicingReach) can only be longer.
 */
export function slicingRoute(from: { x: number; z: number }, to: { x: number; z: number }, mine: number, foe: Operative): number {
  let best = Infinity
  for (const p of foePoints(from, to, foe)) {
    const d = Math.max(0, Math.hypot(p.x - from.x, p.z - from.z) - mine) + Math.max(0, Math.hypot(p.x - to.x, p.z - to.z) - mine)
    if (d < best) best = d
  }
  return best
}

/** Terrain the imaginary line cannot pass through: every part that would obstruct a move (not Insignificant ground clutter). */
function lineBlockers(state: GameState, centre: { x: number; z: number }, reach: number): Solid[] {
  return terrainOf(state.map).solids.filter(
    (s) =>
      !(s.insignificant && !s.vantage) &&
      centre.x + reach >= s.bbox.minX &&
      centre.x - reach <= s.bbox.maxX &&
      centre.z + reach >= s.bbox.minZ &&
      centre.z - reach <= s.bbox.maxZ,
  )
}

/**
 * Length of the line a -> b, straight in plan, drawn taut over the terrain in its way: it climbs over a part it meets
 * and drops beyond it through the air (the upper convex hull of the parts' tops along the line). A part whose
 * underside is above both ends (a floor overhead) is passed beneath.
 */
export function lineOverTerrain(solids: Solid[], a: Vec3, b: Vec3): number {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const hi = Math.max(a.y, b.y)
  const lo = Math.min(a.y, b.y)
  const pts: [number, number][] = [
    [0, a.y],
    [len, b.y],
  ]
  if (len > EPS) {
    for (const s of solids) {
      if (s.bottom > hi + 0.05 || s.top <= lo + EPS) continue
      if (!segmentBBoxOverlaps(a, b, s.bbox)) continue
      for (const [t0, t1] of segmentPolygonIntervals(a, b, s.polygon)) pts.push([t0 * len, s.top], [t1 * len, s.top])
    }
  }
  if (pts.length === 2) return Math.hypot(len, b.y - a.y)
  // ties at the far end sort high first so the hull drops to the end point; elsewhere low first
  pts.sort((p, q) => p[0] - q[0] || (p[0] >= len - EPS ? q[1] - p[1] : p[1] - q[1]))
  const hull: [number, number][] = []
  for (const p of pts) {
    while (hull.length >= 2) {
      const o = hull[hull.length - 2]!
      const m = hull[hull.length - 1]!
      if ((m[0] - o[0]) * (p[1] - o[1]) - (m[1] - o[1]) * (p[0] - o[0]) >= -EPS) hull.pop()
      else break
    }
    hull.push(p)
  }
  let total = 0
  for (let i = 1; i < hull.length; i++) total += Math.hypot(hull[i]![0] - hull[i - 1]![0], hull[i]![1] - hull[i - 1]![1])
  return total
}

/**
 * SLICING ATTACK (T-CV.15): the shortest imaginary line (it may bend) from the old base to a point of the enemy base
 * and on to the new base, kept out of terrain: around a part through bends at its corners, or over it (lineOverTerrain).
 * Shortest paths run over a graph of the parts' corners (pushed just outside each part).
 */
export function slicingReach(state: GameState, from: Vec3, to: Vec3, mine: number, foe: Operative, limit = 7): number {
  const flat = slicingRoute(from, to, mine, foe)
  if (flat > limit + EPS) return flat
  const reach = limit + mine + foe.baseRadius + 0.1
  const solids = lineBlockers(state, from, reach)
  const y = foe.pos.y
  const idx = terrainOf(state.map)
  const corners: Vec3[] = []
  for (const s of solids) {
    const n = s.polygon.length
    const cx = s.polygon.reduce((t, p) => t + p.x, 0) / n
    const cz = s.polygon.reduce((t, p) => t + p.z, 0) / n
    for (const p of s.polygon) {
      const d = Math.hypot(p.x - cx, p.z - cz) || 1
      const c = { x: p.x + ((p.x - cx) / d) * 0.03, y, z: p.z + ((p.z - cz) / d) * 0.03 }
      if (Math.abs(c.x) > idx.halfX || Math.abs(c.z) > idx.halfZ) continue
      if (Math.hypot(c.x - from.x, c.z - from.z) > reach || Math.hypot(c.x - to.x, c.z - to.z) > reach) continue
      corners.push(c)
    }
  }
  const line = (p: Vec3, q: Vec3) => lineOverTerrain(solids, p, q)
  /** the point of a base (centre c) nearest p, at the base's height */
  const rim = (c: Vec3, p: { x: number; z: number }): Vec3 => {
    const d = Math.hypot(p.x - c.x, p.z - c.z)
    return d <= mine ? { x: p.x, y: c.y, z: p.z } : { x: c.x + ((p.x - c.x) / d) * mine, y: c.y, z: c.z + ((p.z - c.z) / d) * mine }
  }
  const n = corners.length
  const pair: number[][] = corners.map(() => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pair[i]![j] = pair[j]![i] = line(corners[i]!, corners[j]!)
  // shortest distance from a base to every corner (Dijkstra over the corner graph)
  const spread = (base: Vec3): number[] => {
    const dist = corners.map((c) => line(rim(base, c), c))
    const done = new Array<boolean>(n).fill(false)
    for (let k = 0; k < n; k++) {
      let u = -1
      for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i]! < dist[u]!)) u = i
      if (u < 0 || dist[u]! > limit) break
      done[u] = true
      for (let v = 0; v < n; v++) if (!done[v] && dist[u]! + pair[u]![v]! < dist[v]!) dist[v] = dist[u]! + pair[u]![v]!
    }
    return dist
  }
  const dS = spread(from)
  const dE = spread(to)
  let best = Infinity
  for (const p of foePoints(from, to, foe)) {
    const f = { x: p.x, y, z: p.z }
    let legS = line(rim(from, f), f)
    let legE = line(f, rim(to, f))
    for (let i = 0; i < n; i++) {
      if (dS[i]! < legS) legS = Math.min(legS, dS[i]! + line(corners[i]!, f))
      if (dE[i]! < legE) legE = Math.min(legE, line(f, corners[i]!) + dE[i]!)
    }
    best = Math.min(best, legS + legE)
  }
  return best
}

// ---------------------------------------------------------------------------
// Quick on the Trigger and Rifles helpers
// ---------------------------------------------------------------------------

function qott(state: GameState, op: Operative): boolean {
  return isCv(state, op) && hasAbility(state, op, IDS.qott)
}

/** Has the operative made a Charge, Fall Back or Reposition in the activation its current action belongs to (Rifles)? */
function movedBeforeShooting(state: GameState, op: Operative): boolean {
  const a = state.firefight.activation
  if (!a) return false
  const lists: string[][] = []
  if (a.operativeId === op.id) lists.push(a.performed)
  if (a.frame) {
    const under = (state.firefight.stack ?? []).at(-1)
    if (under && under.operativeId === op.id) lists.push(under.performed)
  }
  return lists.some((l) => l.some((x) => BLINK_KINDS.includes(x)))
}

// ---------------------------------------------------------------------------
// Runes of Guidance, PSYCHIC picks
// ---------------------------------------------------------------------------

function runesLive(state: GameState, op: Operative): boolean {
  return equipped(state, op.seat, IDS.runes) && !usedThisTp(state, op.seat, RUNES_USED) && (hasKeyword(state, op, 'WAY SEEKER') || hasKeyword(state, op, 'SOUL WEAVER'))
}

/** Friendly Voidscarreds a PSYCHIC action of `op` may pick: visible, within `range` (+3 under Runes of Guidance), selectable. */
function psychicPicks(state: GameState, op: Operative, range: number, runes: boolean, includeSelf: boolean): Operative[] {
  const reach = range + (runes && runesLive(state, op) ? 3 : 0)
  return cvOps(state, op.seat).filter((f) => {
    if (f.id === op.id) return includeSelf && psychicSelectable(state, f)
    if (!psychicSelectable(state, f)) return false
    return within(op, f, reach) && visible(state, bodyOf(op), bodyOf(f))
  })
}

/** The pick was beyond the printed distance: the Runes of Guidance use is spent. */
function spendRunes(ctx: Ctx, op: Operative, picked: Operative[], range: number): void {
  if (!runesLive(ctx.state, op)) return
  if (!picked.some((p) => p.id !== op.id && gap(op, p) > range + EPS)) return
  markUsedTp(ctx.state, op.seat, RUNES_USED)
  for (const o of cvOps(ctx.state, op.seat)) removeToken(ctx, o.id, RUNES_TOKEN, 'used', op.seat)
  markFired('runesOfGuidance')
  ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: IDS.runes }, op.seat)
}

// ---------------------------------------------------------------------------
// One Step Ahead and Erudite Hunter: what a reaction could do
// ---------------------------------------------------------------------------

function osaPossible(state: GameState, f: Operative, enemy: Operative, action: 'shoot' | 'fight'): boolean {
  if (!canStartFreeAction(state, { operativeId: f.id, action, resume: '', interrupt: true })) return false
  if (action === 'fight') return inControlRange(state, bodyOf(f), bodyOf(enemy)) && fightAvailability(state, f, null) === null
  return shootableWeapons(state, f, []).some((w) => w.targets.some((t) => t.id === enemy.id))
}

function chargeReach(state: GameState, op: Operative): number {
  return moveLimit(op, 'charge', false, state)
}

/** The free actions the Kurnite Hunter could take against the marked enemy: Charge (maybe after switching to Engage) and Reposition. */
function eruditeOptions(state: GameState, k: Operative, enemy: Operative): string[] {
  const out: string[] = []
  if (live(enemy) && !inEnemyCr(state, k)) {
    if (k.order === 'engage' && canStartFreeAction(state, { operativeId: k.id, action: 'charge', resume: '', interrupt: true }) && canChargeInto(state, k, enemy, chargeReach(state, k))) out.push('charge')
    if (k.order === 'conceal') {
      k.order = 'engage'
      try {
        if (canStartFreeAction(state, { operativeId: k.id, action: 'charge', resume: '', interrupt: true }) && canChargeInto(state, k, enemy, chargeReach(state, k))) out.push('chargeSwitch')
      } finally {
        k.order = 'conceal'
      }
    }
    if (canStartFreeAction(state, { operativeId: k.id, action: 'reposition', resume: '', interrupt: true })) out.push('reposition')
  }
  return out
}

// ---------------------------------------------------------------------------
// The team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  // AELDARI RAIDERS (T-CV.24), VETERAN RAIDER (T-CV.7), CAPRICIOUS FLIGHT (T-CV.31)
  actionCostDelta(state, op, actionId) {
    if (!isCv(state, op)) return 0
    return flightDelta(state, op, actionId) + raidersDelta(state, op, actionId)
  },

  // PLUNDERERS (T-CV.25), WARP FOLD (T-CV.21), PISTOL BARRAGE (T-CV.19)
  actionForbidden(state, op, actionId) {
    if (!isCv(state, op)) return null
    const own = ownActivation(state, op)
    if (own && (actionId === 'dash' || actionId === `ability:${IDS.blademaster}`) && opEffect(state, PLUNDER_FX, op.id)) return `${op.name} gave up its Dash for Plunderers`
    if (own && BLINK_KINDS.includes(actionId) && opEffect(state, WARP_BAN_FX, op.id)) return `${op.name} was folded across the board by Warp Fold and cannot do that this turning point`
    if (hasAbility(state, op, IDS.barrage)) {
      const base = baseActivation(state, op)
      if (actionId === 'shoot' && base?.performed.includes(`ability:${IDS.barrage}`)) return 'cannot Shoot after Pistol Barrage in the same activation'
    }
    return null
  },

  // QUICK ON THE TRIGGER (T-CV.18): every Shoot of the Duellist, free and Guard interrupt ones included
  shootInControlRange: (state, op) => qott(state, op),
  freeShootInControlRange: (state, op) => qott(state, op),

  // BLINK PACK (T-CV.14)
  canFly(state, op, kind) {
    if (!isCv(state, op) || !hasAbility(state, op, IDS.blink) || !BLINK_KINDS.includes(kind)) return false
    markFired('blinkPack')
    return true
  },
  flyLimit(state, op, kind) {
    return isCv(state, op) && hasAbility(state, op, IDS.blink) && BLINK_KINDS.includes(kind) ? 7 : null
  },

  // CAMO CLOAK (T-CV.9): one more cover save, not on top of the improved Vantage cover save
  stealthyCover(state, op) {
    if (!isCv(state, op) || !hasAbility(state, op, IDS.camo)) return 0
    const seq = state.attack?.seq
    if (seq && seq.targetId === op.id && seq.improvedCover) return 0
    markFired('cvCamoCloak')
    return 1
  },

  // LIGHT FINGERS (T-CV.30)
  markerActionRelief(state, op) {
    if (!isCv(state, op) || !opEffect(state, IDS.fingers, op.id)) return null
    return { ignoreEnemyControlRange: true }
  },

  // BLADED STANCE (T-CV.11) and FAOLCHU'S BOND (T-CV.12)
  fightResolveStart(state, attack) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const queue: { seat: Seat; blockOnly?: boolean }[] = []
    for (const id of [attack.operativeId, attack.fight.targetId]) {
      const op = state.operatives[id]
      if (live(op) && isCv(state, op) && hasAbility(state, op, IDS.bladed)) {
        queue.push({ seat: op.seat, blockOnly: true })
        markFired('bladedStance')
      }
    }
    const ret = state.operatives[attack.fight.targetId]
    let first: Seat | undefined
    if (live(ret) && isCv(state, ret) && hasAbility(state, ret, IDS.faolchu) && ret.ready && !usedThisTp(state, ret.seat, FAOLCHU_USED)) {
      first = ret.seat
      markFired('faolchusBond')
    }
    if (queue.length === 0 && !first) return null
    return { ...(first ? { first } : {}), queue }
  },

  // ONE STEP AHEAD (T-CV.8) and ERUDITE HUNTER (T-CV.13)
  reactions(state, seat, info) {
    if (info.activationEnded || info.activeSeat === seat) return []
    const actor = state.operatives[info.actorId]
    if (!live(actor) || actor.seat === seat) return []
    const out: ReactionOffer[] = []
    if (!usedThisBattle(state, seat, OSA_USED)) {
      for (const f of cvOps(state, seat)) {
        if (!hasAbility(state, f, IDS.osa) || !f.ready) continue
        for (const action of ['shoot', 'fight'] as const) {
          if (!osaPossible(state, f, actor, action)) continue
          out.push({
            hook: 'oneStepAhead',
            operativeId: f.id,
            option: action,
            labelKey: `ability.${IDS.osa}`,
            freeActions: true,
            data: { name: `One Step Ahead: ${f.name} ${action === 'shoot' ? 'shoots' : 'fights'} ${actor.name}`, actorId: actor.id },
          })
        }
      }
    }
    if (info.moved && hasToken(state, actor.id, ERUDITE_TOKEN, seat) && !usedThisTp(state, seat, ERUDITE_USED)) {
      for (const k of cvOps(state, seat)) {
        if (!hasAbility(state, k, IDS.erudite)) continue
        for (const option of eruditeOptions(state, k, actor)) {
          const label = option === 'reposition' ? 'repositions towards' : option === 'chargeSwitch' ? 'switches to Engage and charges' : 'charges'
          out.push({
            hook: 'eruditeHunter',
            operativeId: k.id,
            option,
            labelKey: `ability.${IDS.erudite}`,
            freeActions: true,
            data: { name: `Erudite Hunter: ${k.name} ${label} ${actor.name}`, actorId: actor.id },
          })
        }
      }
    }
    return out
  },

  // ONE STEP AHEAD locks the free Fight onto the enemy that acted
  fightTargets(state, attacker, foes) {
    const a = state.firefight.activation
    if (!a || a.frame?.resume !== OSA_FRAME || a.operativeId !== attacker.id) return null
    const id = String(a.frame.data?.enemyId ?? '')
    return foes.includes(id) ? [id] : null
  },

  // ERUDITE HUNTER's free Reposition may not end further away from the marked enemy than it started
  moveProblem(state, op, kind, points) {
    const a = state.firefight.activation
    if (kind !== 'reposition' || !a || a.operativeId !== op.id || a.frame?.resume !== ERUDITE_FRAME || points.length === 0) return null
    const enemy = state.operatives[String(a.frame.data?.enemyId ?? '')]
    if (!enemy) return null
    const end = points[points.length - 1]!
    const before = distanceBetween(bodyOf(op), bodyOf(enemy))
    const after = distanceBetween(bodyOf({ ...op, pos: { x: end.x, y: end.y, z: end.z } }), bodyOf(enemy))
    return after > before + EPS ? `Erudite Hunter: ${op.name} cannot end this Reposition further away from ${enemy.name}` : null
  },
})

// ---------------------------------------------------------------------------
// Action hooks: the per-activation ledger, the "moved" flag, Slicing Attack's snapshot, Contemptuous Adventurer
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isCv(s, op)) return null
    const d = c.data as unknown as ActionDeclaredData
    const act = s.firefight.activation
    const decl = act?.declared
    if (d.cancel || !act || !decl) return null
    const params: Record<string, unknown> = { ...(decl.params ?? {}), cvFrom: { x: op.pos.x, z: op.pos.z } }
    // the free Dash / free 1 AP action was applied to this declaration (the ledger is written when it ends)
    if (!d.free && raidersDelta(s, op, d.action) < 0) params.cvRaiders = true
    // Slicing Attack: remember who the Shade Runner could see when a Reposition began, and ask for the move's end
    if (d.action === 'reposition' && hasAbility(s, op, IDS.slicing)) {
      params.afterMove = 'slicingAttack'
      params.cvVisible = enemiesOf(s, op)
        .filter((e) => live(e) && visible(s, bodyOf(op), bodyOf(e)))
        .map((e) => e.id)
    }
    decl.params = params
    // Contemptuous Adventurer: the first Shoot or Fight of the activation
    const fx = opEffect(s, IDS.adventurer, op.id)
    if (fx && (d.action === 'shoot' || d.action === 'fight') && fx.data?.done !== true) fx.data = { ...(fx.data ?? {}), active: true }
    return null
  },
  'cv.action.declared',
)

registerHook(
  'action.ended',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !op || !isCv(s, op)) return null
    const decl = s.firefight.activation?.declared
    if (!decl) return null
    const p = decl.params ?? {}
    if (p.cvRaiders === true) {
      const own = ownActivation(s, op)
      if (own && !(own.used ?? []).includes(RAIDERS_USED)) own.used = [...(own.used ?? []), RAIDERS_USED]
      markFired(hasAbility(s, op, IDS.veteran) ? 'veteranRaider' : 'cvAeldariRaiders')
    }
    // MOBILE ENGAGEMENT: any action of its own that changed its position this turning point
    const from = p.cvFrom as { x: number; z: number } | undefined
    if (from && Math.hypot(op.pos.x - from.x, op.pos.z - from.z) > EPS && !opEffect(s, MOVED_FX, op.id)) {
      addEffect(ctx, { source: MOVED_FX, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'turningPoint' })
    }
    const fx = opEffect(s, IDS.adventurer, op.id)
    if (fx?.data?.active === true && (decl.action === 'shoot' || decl.action === 'fight')) fx.data = { ...(fx.data ?? {}), active: false, done: true }
    return null
  },
  'cv.action.ended',
)

// ---------------------------------------------------------------------------
// Weapon rules: Rifles, Camo Cloak, Piratical Profiteers, Outcasts, Contemptuous Adventurer, Mistfield
// ---------------------------------------------------------------------------

const RIFLES = [W('shuriken-rifle'), W('ranger-long-rifle-mobile'), W('ranger-long-rifle-stationary')]

/** Is the operative more than 5" from every other friendly operative (Outcasts, Contemptuous Adventurer)? */
function isolated(state: GameState, op: Operative): boolean {
  return activeOps(state).every((o) => o.id === op.id || o.seat !== op.seat || o.wounds <= 0 || gap(op, o) > 5 + EPS)
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
    const foe = target && target.seat !== op.seat ? target : undefined
    if (isCv(s, op)) {
      // RIFLES (T-CV.23)
      if (data.kind === 'shoot' && RIFLES.includes(c.weaponId) && !movedBeforeShooting(s, op)) {
        rules.push({ rule: 'accurate', x: 1 })
        markFired('cvRifles')
      }
      // PIRATICAL PROFITEERS (T-CV.26): it or its enemy contests an objective marker
      if (foe && ployActive(s, op.seat, IDS.profiteers) && !hasRef(rules, 'balanced')) {
        const contests = (o: Operative) => contestedBy(s, o).some((m) => m.kind === 'objective')
        if (contests(op) || contests(foe)) rules.push({ rule: 'balanced' })
      }
      // OUTCASTS (T-CV.28)
      if (ployActive(s, op.seat, IDS.outcasts) && !hasRef(rules, 'punishing') && isolated(s, op)) rules.push({ rule: 'punishing' })
      // CONTEMPTUOUS ADVENTURER (T-CV.32): the one Shoot or Fight the ploy covers
      const fx = opEffect(s, IDS.adventurer, op.id)
      if (fx?.data?.active === true && !hasRef(rules, 'relentless')) rules.push({ rule: 'relentless' })
    }
    // CAMO CLOAK (T-CV.9): any shooter loses Saturate against the Fate Dealer
    if (data.kind === 'shoot' && target && target.id !== op.id && isCv(s, target) && hasAbility(s, target, IDS.camo)) {
      for (let i = rules.length - 1; i >= 0; i--) if (ruleKey(rules[i]!.rule) === 'saturate') rules.splice(i, 1)
    }
    // MISTFIELD (T-CV.34): Piercing x is 1 lower for the sequence against the protected operative
    if (data.kind === 'shoot' && foe && opEffect(s, IDS.mistfield, foe.id)) {
      for (let i = rules.length - 1; i >= 0; i--) {
        const key = ruleKey(rules[i]!.rule)
        if (key !== 'piercing' && key !== 'piercingcrits') continue
        const x = (rules[i]!.x ?? 1) - 1
        if (x <= 0) rules.splice(i, 1)
        else rules[i] = { ...rules[i]!, x }
      }
    }
    return null
  },
  'cv.modifyWeaponRules',
)

// ---------------------------------------------------------------------------
// Dice: Mobile Engagement, Diuturnal Mantles
// ---------------------------------------------------------------------------

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const shooter = s && c.targetId ? s.operatives[c.targetId] : undefined
    // "whenever an operative is shooting" a friendly Corsair: any shooter, a friendly one's Blast included
    if (!s || !op || !shooter || !c.weaponId || !isCv(s, op) || shooter.id === op.id) return null
    const data = c.data as { rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    // DIUTURNAL MANTLES (T-CV.33): Blast and Torrent weapons
    if (equipped(s, op.seat, IDS.mantles) && !data.rerolls.some((r) => r.id === 'cv-mantles')) {
      const rs = ruleSetFor(s, shooter, c.weaponId, 'shoot', op.id)
      if (rs.blast !== null || rs.torrent !== null) {
        data.rerolls.push({ id: 'cv-mantles', source: IDS.mantles, mode: 'one', used: false })
        markFired('diuturnalMantles')
      }
    }
    // MOBILE ENGAGEMENT (T-CV.27)
    if (ployActive(s, op.seat, IDS.mobile) && opEffect(s, MOVED_FX, op.id) && !data.rerolls.some((r) => r.id === 'cv-mobile')) {
      data.rerolls.push({ id: 'cv-mobile', source: IDS.mobile, mode: 'one', used: false })
    }
    return null
  },
  'cv.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// Target selection: One Step Ahead's lock and Quick on the Trigger
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    if (data.secondary) return null
    const act = s.firefight.activation
    // ONE STEP AHEAD (T-CV.8): the only valid primary target is the enemy that acted
    if (act && act.operativeId === op.id && act.frame?.resume === OSA_FRAME) {
      const id = String(act.frame.data?.enemyId ?? '')
      for (let i = data.candidates.length - 1; i >= 0; i--) if (data.candidates[i] !== id) data.candidates.splice(i, 1)
      return null
    }
    // QUICK ON THE TRIGGER (T-CV.18): in an enemy control range only enemies in the Duellist's own control range, visible
    // (a Conceal enemy not in cover), even when the Duellist's friends stand in their control range
    if (isCv(s, op) && qott(s, op) && inEnemyCr(s, op)) {
      const rules = ruleSetFor(s, op, c.weaponId, 'shoot', undefined)
      data.candidates.splice(
        0,
        data.candidates.length,
        ...enemiesInControlRange(s, op, op.seat)
          .filter((e) => {
            if (e.wounds <= 0) return false
            const info = targetInfo(s, op, e, rules)
            return info.verdict.visible && !info.coverBlocks && (rules.range === null || distanceBetween(bodyOf(op), bodyOf(e)) <= rules.range + EPS)
          })
          .map((e) => e.id),
      )
      if (data.candidates.length > 0) markFired('quickOnTheTrigger')
    }
    return null
  },
  'cv.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// Damage taken: Warding Shield, Diuturnal Mantles (Devastating)
// ---------------------------------------------------------------------------

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !victim) return null
    const d = c.data as unknown as OnDamageInflictedData
    if (d.amount <= 0) return null
    // DIUTURNAL MANTLES (T-CV.33): x" Devastating on an operative that is not the target
    if (d.splash === true && isCv(s, victim) && equipped(s, victim.seat, IDS.mantles)) {
      d.amount = 0
      markFired('diuturnalMantles')
      return null
    }
    // WARDING SHIELD (T-CV.22): the first attack die of Normal Dmg is ignored
    if ((d.source === 'normal' || d.source === 'strike-normal') && hasToken(s, victim.id, SHIELD_TOKEN) && psychicAllowed(s, victim)) {
      d.amount = 0
      if (c.engine) removeToken(c.engine, victim.id, SHIELD_TOKEN, 'used')
      markFired('wardingShield')
    }
    return null
  },
  'cv.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// Faolchú's Bond: the first retaliation of the turning point
// ---------------------------------------------------------------------------

registerHook(
  'onFightResolved',
  (c) => {
    const s = c.state
    const ctx = c.engine
    if (!s || !ctx) return null
    const d = c.data as { attackerId: string; defenderId: string }
    const def = s.operatives[d.defenderId]
    if (!def || !isCv(s, def) || !hasAbility(s, def, IDS.faolchu) || usedThisTp(s, def.seat, FAOLCHU_USED)) return null
    markUsedTp(s, def.seat, FAOLCHU_USED)
    removeToken(ctx, def.id, FAOLCHU_TOKEN, 'used', def.seat)
    return null
  },
  'cv.onFightResolved',
)

// ---------------------------------------------------------------------------
// Turning point start: the tokens that show unspent rules
// ---------------------------------------------------------------------------

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    const s = ctx.state
    for (const seat of SEATS) {
      for (const op of cvOps(s, seat)) {
        if (hasAbility(s, op, IDS.osa) && !usedThisBattle(s, seat, OSA_USED)) addToken(ctx, op.id, { kind: OSA_TOKEN, owner: seat, cap: 1, sourceId: op.id }, 'cv.start')
        if (hasAbility(s, op, IDS.faolchu)) addToken(ctx, op.id, { kind: FAOLCHU_TOKEN, owner: seat, cap: 1, sourceId: op.id, expires: ['turningPointEnd'] }, 'cv.start')
        if (runesLive(s, op)) addToken(ctx, op.id, { kind: RUNES_TOKEN, owner: seat, cap: 1, sourceId: op.id, expires: ['turningPointEnd'] }, 'cv.start')
      }
    }
    return null
  },
  'cv.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Reactions: One Step Ahead and Erudite Hunter
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'oneStepAhead',
  choice(ctx, op, option, context) {
    const s = ctx.state
    const enemy = s.operatives[String(context.actorId)]
    if (!live(enemy) || !live(op) || !op.ready || usedThisBattle(s, op.seat, OSA_USED)) {
      reactionDone(ctx)
      return
    }
    // the roll is part of using the rule: the battle use is spent even when it fails
    markUsedBattle(s, op.seat, OSA_USED)
    removeToken(ctx, op.id, OSA_TOKEN, 'used', op.seat)
    const [r] = ctx.roll('cv.oneStepAhead', 1)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: IDS.osa, detail: `${enemy.id}:${r}` }, op.seat)
    if (r! <= effectiveApl(enemy)) {
      reactionDone(ctx)
      return
    }
    const started = startFreeAction(ctx, { operativeId: op.id, action: option === 'fight' ? 'fight' : 'shoot', interrupt: true, resume: OSA_FRAME, data: { opId: op.id, enemyId: enemy.id } })
    if (!started) reactionDone(ctx)
  },
})

registerFrameResume(OSA_FRAME, (ctx, outcome, data) => {
  const op = ctx.state.operatives[String(data.opId)]
  // the -1 APL lands only when the free action was performed
  if (outcome === 'finished' && live(op)) applyAplEffect(ctx, op.id, -1, IDS.osa)
  reactionDone(ctx)
})

registerCodeHook({
  name: 'eruditeHunter',
  // the strategic gambit: mark an enemy within 9" of the Kurnite Hunter
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const hunters = cvOps(state, seat).filter((o) => hasAbility(state, o, IDS.erudite))
      if (hunters.length === 0) return []
      return enemiesOf(state, { seat })
        .filter((e) => live(e) && hunters.some((h) => within(h, e, 9)))
        .map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const enemy = seed.param ? ctx.state.operatives[seed.param] : undefined
      const hunter = cvOps(ctx.state, seat).find((o) => hasAbility(ctx.state, o, IDS.erudite) && !!enemy && within(o, enemy, 9))
      if (!enemy || !hunter) return
      addToken(ctx, enemy.id, { kind: ERUDITE_TOKEN, owner: seat, cap: 1, sourceId: hunter.id, expires: ['turningPointEnd'] }, 'eruditeHunter')
      ctx.emit({ type: 'AbilityUsed', operativeId: hunter.id, abilityId: IDS.erudite, detail: enemy.id }, seat)
    },
  },
  // the reaction: a free Reposition or Charge after the marked enemy moved
  choice(ctx, op, option, context) {
    const s = ctx.state
    const enemy = s.operatives[String(context.actorId)]
    if (!live(enemy) || !live(op) || usedThisTp(s, op.seat, ERUDITE_USED)) {
      reactionDone(ctx)
      return
    }
    const previous = op.order
    markUsedTp(s, op.seat, ERUDITE_USED)
    if (option === 'chargeSwitch') setOrder(ctx, op, 'engage')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: IDS.erudite, detail: `${enemy.id}:${option}` }, op.seat)
    const charge = option !== 'reposition'
    const started = startFreeAction(ctx, {
      operativeId: op.id,
      action: charge ? 'charge' : 'reposition',
      ...(charge ? { endWithinCrOf: enemy.id } : {}),
      interrupt: true,
      resume: ERUDITE_FRAME,
      data: { opId: op.id, enemyId: enemy.id, previous },
    })
    if (!started) {
      s.ledger[op.seat].tp = s.ledger[op.seat].tp.filter((k) => k !== ERUDITE_USED)
      if (op.order !== previous) setOrder(ctx, op, previous)
      reactionDone(ctx)
    }
  },
})

registerFrameResume(ERUDITE_FRAME, (ctx, outcome, data) => {
  const op = ctx.state.operatives[String(data.opId)]
  if (outcome === 'cancelled' && op) {
    // the move was not made: the use is handed back
    ctx.state.ledger[op.seat].tp = ctx.state.ledger[op.seat].tp.filter((k) => k !== ERUDITE_USED)
    if (op.order !== data.previous) setOrder(ctx, op, data.previous as 'engage' | 'conceal')
  } else if (op) {
    removeToken(ctx, String(data.enemyId), ERUDITE_TOKEN, 'used', op.seat)
  }
  reactionDone(ctx)
})

// ---------------------------------------------------------------------------
// BLADEMASTER (T-CV.10): a Dash after a Charge, with the Charge's unused distance (3" at most)
// ---------------------------------------------------------------------------

function bladeRoom(state: GameState, op: Operative): number {
  const act = ownActivation(state, op)
  if (!act || !act.performed.includes('charge') || act.performed.includes('dash')) return 0
  return Math.min(3, moveLimit(op, 'charge', false, state) - (op.movedThisActivation ?? 0))
}

registerCodeHook({
  name: 'blademaster',
  action: {
    offers(state, op): OfferSeed[] {
      if (inEnemyCr(state, op)) return []
      const room = bladeRoom(state, op)
      if (room < 0.5 - EPS) return []
      return canStartFreeAction(state, { operativeId: op.id, action: 'dash', maxMove: room, resume: '' }) ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const act = ctx.state.firefight.activation
      const room = bladeRoom(ctx.state, op)
      if (!act?.declared || room <= EPS) {
        cancelAction(ctx)
        return
      }
      // it counts as the Dash action for every restriction (a second Dash, Heavy weapons, Aeldari Raiders)
      act.declared = { ...act.declared, params: { ...(act.declared.params ?? {}), treatedAs: 'dash' } }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      if (!startFreeAction(ctx, { operativeId: op.id, action: 'dash', maxMove: room, resume: 'cv.blademaster', data: { opId: op.id } })) cancelAction(ctx)
    },
  },
})

registerFrameResume('cv.blademaster', (ctx, outcome) => {
  if (outcome === 'cancelled') cancelAction(ctx)
  else finishAction(ctx)
})

// ---------------------------------------------------------------------------
// SLICING ATTACK (T-CV.15)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'slicingAttack',
  // runs after a Reposition the snapshot above asked it for: was the move a warp jump?
  afterMove(ctx, op, from, params) {
    const act = ctx.state.firefight.activation
    if (!act || act.frame) return
    const jumped = [...ctx.events].reverse().find((e) => e.type === 'OperativeMoved' && e.operativeId === op.id)
    if (!jumped || jumped.type !== 'OperativeMoved' || !jumped.segments.some((sg) => sg.kind === 'fly')) return
    // the enemies the line can reach (terrain-aware), among those visible when the action began; fixed now, since
    // nothing moves before the cut is offered at the end of this action
    const s = ctx.state
    const seen = (params.cvVisible as string[] | undefined) ?? []
    const targets = seen.filter((id) => {
      const e = s.operatives[id]
      return live(e) && e.seat !== op.seat && slicingReach(s, from, op.pos, op.baseRadius, e) <= 7 + EPS
    })
    addEffect(ctx, {
      source: SLICE_FX,
      seat: op.seat,
      kind: 'ployFlag',
      operativeId: op.id,
      expires: 'activation',
      data: { from: { x: from.x, y: from.y, z: from.z }, targets, n: act.performed.length + 1 },
    })
  },
})

function slicingTargets(state: GameState, op: Operative): Operative[] {
  const fx = opEffect(state, SLICE_FX, op.id)
  const act = state.firefight.activation
  if (!fx || !act || act.operativeId !== op.id || act.frame || act.performed.length !== fx.data?.n) return []
  const ids = (fx.data.targets as string[]) ?? []
  return ids
    .map((id) => state.operatives[id])
    .filter(live)
    .filter((e) => e.seat !== op.seat)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

// ---------------------------------------------------------------------------
// PSYCHIC unique actions: Soul Channel, Soul Heal, Warding Shield, Warp Fold
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'soulChannel',
  action: {
    offers: (state, op): OfferSeed[] => psychicPicks(state, op, 6, true, false).map((f) => ({ key: f.id, params: { targetId: f.id } })),
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!live(target) || !psychicPicks(ctx.state, op, 6, true, false).some((f) => f.id === target.id)) {
        cancelAction(ctx)
        return
      }
      spendRunes(ctx, op, [target], 6)
      applyAplEffect(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'soulHeal',
  action: {
    offers: (state, op): OfferSeed[] => psychicPicks(state, op, 6, true, true).map((f) => ({ key: f.id, params: { targetId: f.id } })),
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!live(target) || !psychicPicks(ctx.state, op, 6, true, true).some((f) => f.id === target.id)) {
        cancelAction(ctx)
        return
      }
      spendRunes(ctx, op, [target], 6)
      const amount = ctx.roll('cv.soulHeal', 2).reduce((n, r) => n + Math.ceil(r / 2), 0)
      regainWounds(ctx, target.id, amount, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'wardingShield',
  action: {
    offers: (state, op): OfferSeed[] => psychicPicks(state, op, 6, true, true).map((f) => ({ key: f.id, params: { targetId: f.id } })),
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!live(target) || !psychicPicks(ctx.state, op, 6, true, true).some((f) => f.id === target.id)) {
        cancelAction(ctx)
        return
      }
      spendRunes(ctx, op, [target], 6)
      // one shield per Way Seeker: a new cast ends the old one
      for (const o of Object.values(ctx.state.operatives)) {
        const t = o.tokens?.find((x) => x.kind === SHIELD_TOKEN && x.sourceId === op.id)
        if (t) removeToken(ctx, o.id, SHIELD_TOKEN, 'recast')
      }
      addToken(ctx, target.id, { kind: SHIELD_TOKEN, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'wardingShield')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

function foldPairs(state: GameState, op: Operative): [Operative, Operative][] {
  const picks = psychicPicks(state, op, 5, false, true).sort((a, b) => (a.id < b.id ? -1 : 1))
  const act = state.firefight.activation
  const out: [Operative, Operative][] = []
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const a = picks[i]!
      const b = picks[j]!
      // a counteracting Way Seeker must be set up wholly within 2" of where it was (R-3.12): for two equal bases that is
      // the centre-to-centre distance, measured in three dimensions (a swap onto a Vantage floor counts the height)
      const crossesCap = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) + Math.abs(a.baseRadius - b.baseRadius) > 2 + EPS
      if (act?.counteract && (a.id === op.id || b.id === op.id) && crossesCap) continue
      out.push([a, b])
    }
  }
  return out
}

const MOVE_ACTIONS_THIS_TP = BLINK_KINDS

registerCodeHook({
  name: 'warpFold',
  action: {
    offers: (state, op): OfferSeed[] => foldPairs(state, op).map(([a, b]) => ({ key: `${a.id}+${b.id}`, params: { param: `${a.id}+${b.id}` } })),
    perform(ctx, op, def, params) {
      const [x, y] = String(params.param ?? '').split('+')
      const pair = foldPairs(ctx.state, op).find(([a, b]) => a.id === x && b.id === y)
      if (!pair) {
        cancelAction(ctx)
        return
      }
      const [a, b] = pair
      const pa = { ...a.pos }
      const pb = { ...b.pos }
      const swap = (o: Operative, from: Vec3, to: Vec3) => {
        o.pos = { ...to }
        if (o.flags.guard) {
          o.flags.guard = false
          ctx.emit({ type: 'GuardCleared', operativeId: o.id, reason: 'setUp' }, o.seat)
        }
        const length = Math.hypot(to.x - from.x, to.z - from.z)
        ctx.emit({
          type: 'OperativeMoved',
          operativeId: o.id,
          action: 'forced',
          from,
          to,
          segments: [{ from, to, length, cost: length, kind: 'fly' }],
          cost: length,
          maxInches: length,
        })
      }
      swap(a, pa, pb)
      swap(b, pb, pa)
      // one already moved by Charge, Fall Back or Reposition this turning point: the ready other cannot, in its activation
      const did = (o: Operative) => (o.actionsThisTp ?? []).some((x2) => MOVE_ACTIONS_THIS_TP.includes(x2))
      for (const [mover, other] of [[a, b], [b, a]] as const) {
        if (did(mover) && other.ready && !opEffect(ctx.state, WARP_BAN_FX, other.id)) {
          addEffect(ctx, { source: WARP_BAN_FX, seat: other.seat, kind: 'ployFlag', operativeId: other.id, expires: 'turningPoint' })
        }
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: `${a.id}+${b.id}` }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// PISTOL BARRAGE (T-CV.19): two free Shoots, one pistol each
// ---------------------------------------------------------------------------

const BARRAGE_PISTOLS: Record<string, { id: string; name: string }> = {
  fusion: { id: W('fusion-pistol'), name: 'fusion pistol' },
  shuriken: { id: W('shuriken-pistol'), name: 'shuriken pistol' },
}

function barrageHasTarget(state: GameState, op: Operative, which: string): boolean {
  const p = BARRAGE_PISTOLS[which]!
  return op.weapons.includes(p.id) && weaponUnusable(state, op, p.id, [], 'shoot') === null && validTargets(state, op, p.id).length > 0
}

function barrageStep(ctx: Ctx, opId: string, order: string[], i: number): void {
  const op = ctx.state.operatives[opId]
  if (!live(op) || i >= order.length) {
    finishAction(ctx)
    return
  }
  const pistol = BARRAGE_PISTOLS[order[i]!]!
  // in an enemy's control range the free Shoot is an ordinary Quick on the Trigger Shoot (freeShootInControlRange)
  const started = startFreeAction(ctx, {
    operativeId: opId,
    action: 'shoot',
    weaponNameContains: pistol.name,
    resume: 'cv.pistolBarrage',
    data: { opId, order, i },
  })
  if (!started) barrageStep(ctx, opId, order, i + 1)
}

registerFrameResume('cv.pistolBarrage', (ctx, _outcome, data) => {
  barrageStep(ctx, String(data.opId), data.order as string[], Number(data.i) + 1)
})

registerCodeHook({
  name: 'pistolBarrage',
  action: {
    offers(state, op): OfferSeed[] {
      return (['fusion', 'shuriken'] as const).filter((w) => barrageHasTarget(state, op, w)).map((w) => ({ key: w, params: { param: w } }))
    },
    perform(ctx, op, def, params) {
      const first = params.param === 'shuriken' ? 'shuriken' : 'fusion'
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: first }, op.seat)
      barrageStep(ctx, op.id, [first, first === 'fusion' ? 'shuriken' : 'fusion'], 0)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys: flags, PLUNDERERS, the gambits of the Kurnite Hunter (above) and STAR CHARTS
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'cvFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

function plunderCandidates(state: GameState, seat: Seat, used: string[]): Operative[] {
  return cvOps(state, seat).filter((o) => !used.includes(o.id) && !opEffect(state, PLUNDER_FX, o.id) && canStartFreeAction(state, { operativeId: o.id, action: 'dash', resume: '' }))
}

function promptPlunder(ctx: Ctx, seat: Seat, slotsLeft: number, used: string[]): void {
  const picks = plunderCandidates(ctx.state, seat, used)
  if (slotsLeft <= 0 || picks.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'cvPlunderers', operativeId: picks[0]!.id, seat, slotsLeft, used },
    options: [
      ...picks.map((o) => ({ id: o.id, labelKey: 'plunder.dash', type: 'ability.choice' as const, payload: { option: o.id }, data: { name: `${o.name}: free Dash` } })),
      { id: 'done', labelKey: 'plunder.done', type: 'ability.choice' as const, payload: { option: 'done' }, data: { name: 'Done' } },
    ],
  })
}

registerCodeHook({
  name: 'cvPlunderers',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return state.turningPoint >= 2 && plunderCandidates(state, seat, []).length > 0 ? [{}] : []
    },
    apply(ctx, seat) {
      const slots = d3(ctx, 'cv.plunderers')
      promptPlunder(ctx, seat, slots, [])
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
    const op = ctx.state.operatives[option]
    const started = !!op && startFreeAction(ctx, { operativeId: op.id, action: 'dash', resume: 'cv.plunder', data: { seat, slotsLeft: slotsLeft - 1, used: [...used, option], opId: op.id } })
    if (!started) promptPlunder(ctx, seat, slotsLeft, [...used, option])
  },
})

registerFrameResume('cv.plunder', (ctx, outcome, data) => {
  const op = ctx.state.operatives[String(data.opId)]
  // each that took the Dash gives up its own Dash this turning point
  if (outcome === 'finished' && op && !opEffect(ctx.state, PLUNDER_FX, op.id)) {
    addEffect(ctx, { source: PLUNDER_FX, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'turningPoint' })
  }
  promptPlunder(ctx, data.seat as Seat, Number(data.slotsLeft), (data.used as string[]) ?? [])
})

registerCodeHook({
  name: 'starCharts',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return equipped(state, seat, IDS.starCharts) && !usedThisBattle(state, seat, STAR_DONE) && state.turningPoint <= 2 ? [{}] : []
    },
    apply(ctx, seat) {
      const roll = d3(ctx, 'cv.starCharts')
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: IDS.starCharts, detail: String(roll) }, seat)
      if (roll > ctx.state.turningPoint) {
        markUsedBattle(ctx.state, seat, STAR_DONE)
        gainCp(ctx, seat, 1, IDS.starCharts)
      }
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

// OPPORTUNISTIC FIGHTERS (T-CV.29)
function opportunists(state: GameState, seat: Seat, actor: Operative): Operative[] {
  return cvOps(state, seat).filter((o) => inControlRange(state, bodyOf(o), bodyOf(actor)))
}

registerCodeHook({
  name: 'cvOpportunisticFighters',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const actor = info.actorId ? state.operatives[info.actorId] : undefined
      if (!live(actor) || actor.seat === seat || info.action !== 'fallBack') return []
      return opportunists(state, seat, actor).length > 0 ? [{}] : []
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const s = ctx.state
      const actor = info.actorId ? s.operatives[info.actorId] : undefined
      if (!actor) return
      for (const o of opportunists(s, seat, actor)) {
        if (!live(actor)) break
        const amount = ctx.roll('cv.opportunisticFighters', 2).reduce((n, r) => n + Math.ceil(r / 2), 0)
        directDamage(ctx, actor.id, amount, o.id, IDS.opportunistic)
        ctx.emit({ type: 'AbilityUsed', operativeId: o.id, abilityId: IDS.opportunistic, detail: `${actor.id}:${amount}` }, seat)
      }
      // an enemy brought down by the ploy never moves: its action ends
      if (actor.status === 'removed' && s.firefight.activation?.operativeId === actor.id) {
        s.window = null
        afterActiveOperativeRemoved(ctx)
      }
    },
  },
})

/** The operative a firefight ploy of the seat names, when it is a friendly Voidscarred in its own activation. */
function activationSubject(state: GameState, seat: Seat, info: { subjectId?: string; counteracting?: boolean }): Operative | undefined {
  const op = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!live(op) || op.seat !== seat || !isCv(state, op) || info.counteracting) return undefined
  const act = state.firefight.activation
  return act && act.operativeId === op.id && !act.counteract && !act.frame ? op : undefined
}

function activationFlagPloy(name: string, id: string): void {
  registerCodeHook({
    name,
    ploy: {
      offers(state, seat, _ploy, info): PloyOfferSeed[] {
        const op = activationSubject(state, seat, info)
        return op && !opEffect(state, id, op.id) ? [{}] : []
      },
      apply(ctx, seat, _ploy, seed, info) {
        const id2 = seed.operativeId ?? info.subjectId
        if (id2) addEffect(ctx, { source: id, seat, kind: 'ployFlag', operativeId: id2, expires: 'activation' })
      },
    },
  })
}
activationFlagPloy('cvLightFingers', IDS.fingers)
activationFlagPloy('cvCapriciousFlight', IDS.flight)

// CONTEMPTUOUS ADVENTURER (T-CV.32)
registerCodeHook({
  name: 'cvContemptuousAdventurer',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = activationSubject(state, seat, info)
      if (!op || opEffect(state, IDS.adventurer, op.id)) return []
      // the first activation of the seat this turning point
      if (activeOps(state).some((o) => o.seat === seat && o.id !== op.id && o.wounds > 0 && !o.ready)) return []
      return isolated(state, op) ? [{}] : []
    },
    apply(ctx, seat, _ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (id) addEffect(ctx, { source: IDS.adventurer, seat, kind: 'ployFlag', operativeId: id, expires: 'activation', data: { active: false, done: false } })
    },
  },
})

// ---------------------------------------------------------------------------
// Ploy rules: Prowling Raiders, and the 0 CP offers (Slicing Attack, Mistfield)
// ---------------------------------------------------------------------------

function offer(id: string, name: string, via: string, op: Operative | undefined, param?: string): PloyOffer {
  return { id, ployId: id.split(':')[0]!, name, ...(param ? { param } : {}), ...(op ? { operativeId: op.id } : {}), cost: 0, via, seed: param ? { param } : {} }
}

const PLOY_RULE: PloyRule = {
  // PROWLING RAIDERS (T-CV.20)
  costAdjust(state, _seat, ploy, _seed, info) {
    if (ploy.id !== IDS.fingers && ploy.id !== IDS.flight) return null
    const op = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!op || !isCv(state, op) || !hasKeyword(state, op, 'WARRIOR')) return null
    markFired('prowlingRaiders')
    return { cost: 0, via: 'prowlingRaiders' }
  },

  extraOffers(state, seat, window, info): PloyOffer[] {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    // SLICING ATTACK (T-CV.15): right after the Reposition with a warp jump
    if (window === 'firefight.actionEnded' && live(subject) && subject.seat === seat && isCv(state, subject) && hasAbility(state, subject, IDS.slicing) && info.action === 'reposition') {
      for (const e of slicingTargets(state, subject)) out.push(offer(`${IDS.slicing}:${e.id}`, `Slicing Attack: ${e.name} takes D3+2 damage`, 'cv.slice', subject, e.id))
    }
    // MISTFIELD (T-CV.34): as the defence roll begins against a shot from more than 3" away
    if (window === 'shoot.beforeDefenceRoll' && live(subject) && subject.seat === seat && isCv(state, subject) && equipped(state, seat, IDS.mistfield) && !usedThisTp(state, seat, MIST_USED)) {
      const shooter = info.attackerId ? state.operatives[info.attackerId] : undefined
      const weaponId = info.weaponId
      if (live(shooter) && shooter.seat !== seat && weaponId && gap(shooter, subject) > 3 + EPS) {
        const rs = ruleSetFor(state, shooter, weaponId, 'shoot', subject.id)
        if (rs.piercing > 0 || rs.piercingCrits > 0) out.push(offer(IDS.mistfield, 'Mistfield: Piercing is 1 lower', 'cv.mist', subject))
      }
    }
    return out
  },

  onUsed(ctx, seat, o, info) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    if (!op) return
    if (o.via === 'cv.slice') {
      const target = o.param ? s.operatives[o.param] : undefined
      const fx = opEffect(s, SLICE_FX, op.id)
      if (fx) s.effects = s.effects.filter((e) => e !== fx)
      if (!live(target)) return
      const amount = d3(ctx, 'cv.slicingAttack') + 2
      markFired('slicingAttack')
      directDamage(ctx, target.id, amount, op.id, IDS.slicing)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: IDS.slicing, detail: `${target.id}:${amount}` }, seat)
    } else if (o.via === 'cv.mist') {
      markUsedTp(s, seat, MIST_USED)
      addEffect(ctx, { source: IDS.mistfield, seat, kind: 'equipment', operativeId: op.id, expires: 'action' })
      markFired('mistfield')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: IDS.mistfield }, seat)
    }
    void info
  },
}

registerPloyRule(PLOY_RULE)
