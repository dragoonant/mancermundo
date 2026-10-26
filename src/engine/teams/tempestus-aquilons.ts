// Tempestus Aquilons (docs/spec/13-teams.md section 23, rule ids T-TA.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - DROP INSERTION (T-TA.20 to T-TA.28): providers setAsideBatches / setAsideAtSetup / setAsideCap (whole batches go above
//    at set-up), preBattleChoices (the Drop markers), readyStepChoices and the turningPoint.start hook (losing markers),
//    offboardActions + the LAND unique action (`treatedAs: 'reposition'`, the Wyrmblade EMERGE pattern) with
//    placementSpots({ levels, notUnderVantage }), the `ta.landed` obscured status (target.status + activation.end) and the
//    turningPoint.end deadlines (half above after TP1, all above incapacitated after TP2).
//  - GRAV-CHUTE (T-TA.29): moveSurcharge cancels the drop cost.
//  - Datacard rules: COMMAND, Tempestus Veteran (costAdjust + commandRerollCost), Grenadier (ownGrenades), Salvo
//    (extraTargets), Gunfight (afterAttackRoll fail count, then the operative.incapacitated hook or a reaction, with a free
//    Shoot restricted by weaponForbidden / beforeShootTargetSelect / modifyAttackDice), Sniper's Vantage, Concealed
//    Position, Vicious Knife Fighter (afterFightResolution), Dynamic (ownReactions), Machine and Turret, Rapid Insertion
//    (a choice loop of free Repositions) and Swift Landing.
//  - Ploys and equipment: small handlers on the shared hook points (see each section).
import { abilityOffers } from '../abilities'
import { continueRemovals, hasRule, validTargets } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { hasAbility, hasKeyword } from '../conditions'
import { commsBonus } from '../core-hooks'
import { addEffect, aplChangeNextActivation, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { territoryOf } from '../equipment'
import { cancelAction, canStartFreeAction, finishAction, ownActivationOf, REACTION_DONE, reactionDone, startFreeAction } from '../firefight'
import { bearing, circleInsidePolygon, distToPolygon, polygonBBox, pointInPolygon, round3 } from '../geometry'
import { registerFrameResume, registerHook } from '../hooks'
import { bodyOf, visible } from '../los'
import { newMarkerId, removeMarker, tracksControl } from '../markers'
import { distanceBetween, enemiesInControlRange, gapToMarker, whollyWithinRegion } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { continueWindow, usePloy } from '../ploys'
import type { Ctx } from '../registry'
import { incapacitateOffboard, placementSpots, returnToKillzone } from '../reserve'
import { preBattleChoiceDone } from '../setup'
import { activeOps, effectiveApl, hasInjuredPenalty, markerRadius, otherSeat } from '../state'
import { readyChoiceDone, resumeGambit } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { standingSolid, terrainOf } from '../terrain'
import { addToken, hasToken } from '../tokens'
import type { GameState, Marker, Operative, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'tempestus-aquilons'

const TA = 'TEMPESTUS AQUILON'
const EPS = 1e-6

const A = (id: string) => `ta.a.${id}`
const P = (id: string) => `ta.p.${id}`
const E = (id: string) => `ta.e.${id}`

const ID = {
  land: A('land'),
  command: A('command'),
  veteran: A('tempestus-veteran'),
  grenadier: A('grenadier'),
  gunfight: A('gunfight'),
  vantage: A('snipers-vantage'),
  knife: A('vicious-knife-fighter'),
  dynamic: A('dynamic'),
  machine: A('machine'),
  turret: A('turret'),
  swift: A('swift-landing'),
  rapid: P('rapid-insertion'),
  dropMove: P('drop-insertion'),
  sudden: P('sudden-offensive'),
  maintain: P('maintain-momentum'),
  eye: P('eye-above'),
  secure: P('drop-and-secure'),
  hotDrop: P('hot-drop'),
  adjust: P('adjust-coordinates'),
  exemplars: P('tempestus-exemplars'),
  progena: P('progena'),
  daggers: E('tempestus-daggers'),
  stimms: E('combat-stimms'),
  augury: E('drop-augury'),
  overseer: E('remote-overseer'),
}

const DROP = 'ta.drop'
const DETECTED = 'ta.detected'
const SMOKE = 'core.a.smoke-grenade'
const STUN = 'core.a.stun-grenade'
const FRAG = 'core.w.frag-grenade'
const KRAK = 'core.w.krak-grenade'
const FOCUSED = 'ta.w.hot-shot-laspistols-focused'
const CONCEALED = 'ta.w.hot-shot-long-las-concealed'
const LONG_LAS = 'ta.wg.hot-shot-long-las'
const ABILITY = (id: string) => `ability:${id}`
const PICK_UP = 'marker:pickUp'
const PLACE = 'marker:place'

const FX = {
  landed: 'ta.landed',
  landedAct: 'ta.landedAct',
  droppedAct: 'ta.droppedAct',
  adjusted: 'ta.adjusted',
  gunfight: 'ta.gunfight',
  sudden: 'ta.sudden',
  secure: 'ta.dropAndSecure',
  exemplars: 'ta.exemplars',
  progena: 'ta.progena',
  knife: 'ta.knife',
  eyeUsed: 'ta.eyeUsed',
  flag: 'ployFlag',
}

const LEDGER = {
  veteran: 'ta.veteran',
  augury: 'ta.augury',
  overseer: 'ta.overseer',
  markerLoss: 'ta.markerLoss',
  shot: (id: string) => `ta.shot:${id}`,
}

// Passive rules name their hooks so the data may reference them; the handlers below mark them fired when they apply.
for (const name of ['taCombatStimms', 'taRemoteOverseer']) registerCodeHook({ name })

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isTa(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, TA)
}

function isServo(state: GameState, op: Operative | undefined): boolean {
  return !!op && hasKeyword(state, op, 'SERVO-SENTRY')
}

function taSeat(state: GameState, seat: Seat): boolean {
  return state.players[seat].teamId === TEAM_ID
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

/** An operative set up above (T-TA.5): put to one side at set-up and not landed yet. */
export function isAbove(op: Operative | undefined): op is Operative {
  return !!op && op.status === 'reserve' && op.offboard === 'setAside'
}

function taOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isTa(state, o))
}

export function aboveOps(state: GameState, seat: Seat): Operative[] {
  return Object.values(state.operatives).filter((o) => o.seat === seat && isAbove(o))
}

/** The Tempestor, in the killzone or still above (Tempestus Veteran works for a landing Tempestor too). */
function tempestor(state: GameState, seat: Seat): Operative | undefined {
  return Object.values(state.operatives).find((o) => o.seat === seat && (live(o) || isAbove(o)) && isTa(state, o) && hasAbility(state, o, ID.veteran))
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function opEffect(state: GameState, kind: string, opId: string) {
  return state.effects.find((e) => e.kind === kind && e.operativeId === opId)
}

function gap(a: Operative, b: Operative): number {
  return distanceBetween(bodyOf(a), bodyOf(b))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return gap(a, b) <= inches + EPS
}

const opt = (id: string, labelKey: string, data: Record<string, unknown> = {}) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, data })

/** The activation the operative itself is in (a free action frame sits on top of it), or null. */
function ownActivation(state: GameState, op: Operative) {
  const cur = state.firefight.activation
  if (!cur) return null
  const base = cur.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : cur
  return base && base.operativeId === op.id && !base.counteract ? base : null
}

/** The activation (or counteraction) an action belongs to: the frame's owner for a free action. */
function baseActivation(state: GameState) {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
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

function sideOf(state: GameState, opId: string) {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

const MARKER_R = markerRadius({ kind: 'equipment' })

// ---------------------------------------------------------------------------
// Drop markers (T-TA.21, T-TA.22, T-TA.27, T-TA.40)
// ---------------------------------------------------------------------------

export function dropMarkers(state: GameState, seat: Seat): Marker[] {
  return state.markers.filter((m) => m.equipmentId === DROP && m.owner === seat)
}

export function dropZoneOf(state: GameState, seat: Seat) {
  return state.map.dropZones.find((z) => z.id === state.players[seat].dropZoneId)
}

function zoneCentre(state: GameState, seat: Seat): Vec2 {
  const zone = dropZoneOf(state, seat)
  if (!zone) return { x: 0, z: 0 }
  const box = polygonBBox(zone.polygon)
  return { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 }
}

/** Batches of this seat put above: the batch sizes are the core thirds (T-TA.20), the first one is never above. */
export function batchesAside(state: GameState, seat: Seat): number {
  const n = Object.values(state.operatives).filter((o) => o.seat === seat).length
  const first = Math.ceil(n / 3)
  const second = Math.min(first, n - first)
  const third = n - first - second
  const above = aboveOps(state, seat).length
  if (above === 0) return 0
  return above > Math.max(second, third) ? 2 : 1
}

function thin<T extends { x: number; z: number }>(points: T[], max: number): T[] {
  if (points.length <= max) return points
  const out: T[] = [points[0]!]
  const best = points.map((p) => Math.hypot(p.x - out[0]!.x, p.z - out[0]!.z))
  while (out.length < max) {
    let bi = 0
    for (let i = 1; i < points.length; i++) if (best[i]! > best[bi]!) bi = i
    const p = points[bi]!
    out.push(p)
    for (let i = 0; i < points.length; i++) best[i] = Math.min(best[i]!, Math.hypot(points[i]!.x - p.x, points[i]!.z - p.z))
  }
  return out
}

/** Spots for a Drop marker disc wholly within the drop zone, on the killzone floor (a base-sized probe keeps clear of bases). */
function placementCandidates(state: GameState, seat: Seat): Vec2[] {
  const zone = dropZoneOf(state, seat)
  const probe = aboveOps(state, seat)[0] ?? taOps(state, seat)[0]
  if (!zone || !probe) return []
  const box = polygonBBox(zone.polygon)
  const radius = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 1
  const c = zoneCentre(state, seat)
  const all = placementSpots(state, probe, { step: 1, max: 140, around: c, radius, test: (p) => circleInsidePolygon({ x: p.x, z: p.z }, MARKER_R, zone.polygon) }).map((p) => ({ x: p.x, z: p.z }))
  // a second marker goes elsewhere in the zone (no rule forbids stacking; it just wastes the second marker)
  const mine = dropMarkers(state, seat)
  const apart = all.filter((p) => mine.every((m) => Math.hypot(p.x - m.pos.x, p.z - m.pos.z) >= 2))
  return apart.length > 0 ? apart : all
}

/** The offered placements: a spread over the zone, the spot nearest the zone's centre first. */
export function dropMarkerSpots(state: GameState, seat: Seat, max = 12): Vec2[] {
  const all = placementCandidates(state, seat)
  if (all.length === 0) return []
  const c = zoneCentre(state, seat)
  const nearest = [...all].sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0]!
  const rest = thin(all.filter((p) => p !== nearest), Math.max(0, max - 1))
  return [nearest, ...rest]
}

function insideTerrain(state: GameState, p: Vec2): boolean {
  return terrainOf(state.map).solids.some((s) => !s.insignificant && pointInPolygon(p, s.polygon))
}

function inKillzone(state: GameState, p: Vec2): boolean {
  return Math.abs(p.x) <= state.map.size.x / 2 - MARKER_R && Math.abs(p.z) <= state.map.size.z / 2 - MARKER_R
}

/** Floor spots within `radius` (horizontal, centre to centre) of a point, outside terrain, spread over the circle. */
function floorSpotsAround(state: GameState, from: Vec2, radius: number, max = 14): Vec2[] {
  const out: Vec2[] = []
  const r = Math.floor(radius)
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx === 0 && dz === 0) continue
      if (Math.hypot(dx, dz) > radius + EPS) continue
      const p = { x: round3(from.x + dx), z: round3(from.z + dz) }
      if (!inKillzone(state, p) || insideTerrain(state, p)) continue
      out.push(p)
    }
  }
  return thin(out, max)
}

/** Distance from a marker's centre to the nearest point of the opponent's drop zone. */
function toOpponentZone(state: GameState, seat: Seat, p: Vec2): number {
  const zone = dropZoneOf(state, otherSeat(seat))
  return zone ? distToPolygon(p, zone.polygon) : 0
}

function placeDropMarker(ctx: Ctx, seat: Seat, p: Vec2): Marker {
  const marker: Marker = { id: newMarkerId(ctx, 'tadrop'), kind: 'equipment', pos: { x: p.x, z: p.z }, owner: seat, carriedBy: null, controller: null, equipmentId: DROP }
  ctx.state.markers.push(marker)
  ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: null, pos: { ...marker.pos } }, seat)
  return marker
}

/** A pass at the pre-battle step still places the markers: at the offered spot nearest the zone's centre (RULING). */
function placeOwedMarkers(ctx: Ctx, seat: Seat): void {
  let owed = batchesAside(ctx.state, seat) - dropMarkers(ctx.state, seat).length
  while (owed-- > 0) {
    const spot = dropMarkerSpots(ctx.state, seat, 1)[0] ?? zoneCentre(ctx.state, seat)
    placeDropMarker(ctx, seat, spot)
  }
}

/** The one-decision move of Drop markers (the gambit's loop and Drop Augury): options for the markers named. */
function moveOptions(state: GameState, seat: Seat, markers: Marker[], augury: boolean) {
  const out: ReturnType<typeof opt>[] = []
  for (const m of markers) {
    const here = toOpponentZone(state, seat, m.pos)
    for (const p of floorSpotsAround(state, m.pos, 4, 14)) {
      if (augury && toOpponentZone(state, seat, p) < here - EPS) continue
      out.push(opt(`${m.id}=${p.x},${p.z}`, 'ta.drop.move', { x: p.x, z: p.z, markerId: m.id, name: `Move the Drop marker to (${p.x}, ${p.z})` }))
    }
    out.push(opt(`${m.id}=stay`, 'ta.drop.stay', { markerId: m.id, x: m.pos.x, z: m.pos.z, name: 'Leave the Drop marker where it is' }))
  }
  return out
}

function moveLegal(state: GameState, seat: Seat, marker: Marker, p: Vec2, augury: boolean): boolean {
  if (Math.hypot(p.x - marker.pos.x, p.z - marker.pos.z) > 4 + EPS) return false
  if (!inKillzone(state, p) || insideTerrain(state, p)) return false
  return !augury || toOpponentZone(state, seat, p) >= toOpponentZone(state, seat, marker.pos) - EPS
}

function anyTa(state: GameState, seat: Seat): Operative | undefined {
  return tempestor(state, seat) ?? taOps(state, seat)[0] ?? aboveOps(state, seat)[0] ?? Object.values(state.operatives).find((o) => o.seat === seat)
}

/** Apply a `<markerId>=x,z` or `<markerId>=stay` answer; true when the marker moved. */
function applyMove(ctx: Ctx, seat: Seat, option: string, augury: boolean): boolean {
  const [id, where] = option.split('=')
  const marker = ctx.state.markers.find((m) => m.id === id && m.equipmentId === DROP && m.owner === seat)
  if (!marker || !where || where === 'stay') return false
  const [x, z] = where.split(',').map(Number) as [number, number]
  const p = { x, z }
  if (!Number.isFinite(x) || !Number.isFinite(z) || !moveLegal(ctx.state, seat, marker, p, augury)) return false
  marker.pos = { x, z }
  ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: null, pos: { x, z } }, seat)
  return true
}

function dropMoveNext(ctx: Ctx, seat: Seat, queue: string[]): void {
  const s = ctx.state
  const head = queue.find((id) => s.markers.some((m) => m.id === id))
  if (!head) {
    resumeGambit(ctx)
    return
  }
  const marker = s.markers.find((m) => m.id === head)!
  const who = anyTa(s, seat)
  if (!who) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'taDropMove', operativeId: who.id, seat, mode: 'gambit', queue },
    options: moveOptions(s, seat, [marker], false),
  })
}

/** Both choice hooks (the gambit and Drop Augury) share this answer. */
function dropMoveChoice(ctx: Ctx, op: Operative, option: string, context: Record<string, unknown>): void {
  const seat = op.seat
  if (context.mode === 'augury') {
    if (applyMove(ctx, seat, option, true)) markFired('taDropAugury')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.augury, detail: option }, seat)
    if (ctx.state.window) continueWindow(ctx)
    return
  }
  const queue = ((context.queue as string[] | undefined) ?? []).slice()
  const done = option.split('=')[0]
  applyMove(ctx, seat, option, false)
  dropMoveNext(ctx, seat, queue.filter((id) => id !== done))
}

registerCodeHook({
  name: 'taDropMove',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.turningPoint > 2 || dropMarkers(state, seat).length === 0) return []
      return [{}]
    },
    apply(ctx, seat) {
      const ids = dropMarkers(ctx.state, seat).map((m) => m.id)
      dropMoveNext(ctx, seat, ids)
    },
  },
  choice: dropMoveChoice,
})

// Drop Augury (T-TA.40) shares the answer: its offer is a ploy rule below, the choice hook the same code
registerCodeHook({ name: 'taDropAugury', choice: dropMoveChoice })

// The pre-battle placement (T-TA.21) and the Ready-step loss (T-TA.27)
registerCodeHook({
  name: 'taDropMarkers',
  choice(ctx, op, option) {
    const seat = op.seat
    const [kind, rest] = option.split(':') as [string, string]
    if (kind === 'place') {
      const [x, z] = rest.split(',').map(Number) as [number, number]
      if (Number.isFinite(x) && Number.isFinite(z) && batchesAside(ctx.state, seat) > dropMarkers(ctx.state, seat).length) placeDropMarker(ctx, seat, { x, z })
      preBattleChoiceDone(ctx)
      return
    }
    if (kind === 'remove') {
      const m = dropMarkers(ctx.state, seat).find((k) => k.id === rest)
      if (m) removeMarker(ctx, m.id, 'ta.dropLost')
      markUsedTp(ctx.state, seat, LEDGER.markerLoss)
      readyChoiceDone(ctx)
    }
  },
})

// ---------------------------------------------------------------------------
// LAND (T-TA.23, T-TA.24, T-TA.19, T-TA.35)
// ---------------------------------------------------------------------------

const ADJUST_REACH = 5

/** How far from a Drop marker the operative may land (T-TA.24): 3", a TROOPER 4" (Swift Landing). */
export function landReach(state: GameState, op: Operative): number {
  return hasAbility(state, op, ID.swift) ? 4 : 3
}

function landOk(state: GameState, op: Operative, pos: Vec3, reach: number): boolean {
  const ghost = bodyOf({ ...op, pos })
  const zone = dropZoneOf(state, op.seat)
  const inZone = !!zone && whollyWithinRegion(ghost, zone.polygon)
  const nearMarker = dropMarkers(state, op.seat).some((m) => gapToMarker(ghost, m) <= reach + EPS)
  if (!inZone && !nearMarker) return false
  // only a PRECURSOR may land in an enemy control range
  if (!hasKeyword(state, op, 'PRECURSOR') && enemiesInControlRange(state, ghost, op.seat).length > 0) return false
  return true
}

/** Placeable landing spots for an operative above (floor and Vantage floors, never under Vantage), spread out. */
export function landingSpots(state: GameState, op: Operative, reach = landReach(state, op), perSource = 8): Vec3[] {
  const out: Vec3[] = []
  const seen = new Set<string>()
  const add = (list: Vec3[]) => {
    for (const p of list) {
      const k = `${p.x},${p.y},${p.z}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
  }
  const test = (p: Vec3) => landOk(state, op, p, reach)
  for (const m of dropMarkers(state, op.seat)) {
    add(placementSpots(state, op, { around: m.pos, radius: reach + op.baseRadius + MARKER_R + 0.01, levels: true, notUnderVantage: true, step: 1, max: perSource, test }))
  }
  const zone = dropZoneOf(state, op.seat)
  if (zone) {
    const box = polygonBBox(zone.polygon)
    const c = zoneCentre(state, op.seat)
    add(placementSpots(state, op, { around: c, radius: Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 1, levels: true, notUnderVantage: true, step: 1.5, max: perSource, test }))
  }
  return out
}

/** The Adjust Coordinates price for this landing operative, or null when the ploy cannot be paid or was used (T-TA.35). */
function adjustPrice(state: GameState, op: Operative): { cost: number; via?: string } | null {
  const ploy = state.data.ploys?.[ID.adjust]
  if (!ploy || !equippedTeamPloy(state, op.seat) || usedThisTp(state, op.seat, ID.adjust)) return null
  const vet = tempestor(state, op.seat)
  const cost = vet && vet.id === op.id && !usedThisBattle(state, op.seat, LEDGER.veteran) ? { cost: 0, via: 'ta.veteran' } : { cost: ploy.cost }
  return cost.cost <= state.players[op.seat].cp ? cost : null
}

function equippedTeamPloy(state: GameState, seat: Seat): boolean {
  return taSeat(state, seat)
}

const SPOT_ID = /^(engage|conceal)@(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)(!adj)?$/

registerCodeHook({
  name: 'taLand',
  action: {
    offers(state, op): OfferSeed[] {
      if (!isAbove(op) || !isTa(state, op)) return []
      return landingSpots(state, op, landReach(state, op), 1).length > 0 || adjustSpots(state, op).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const s = ctx.state
      const act = s.firefight.activation
      const normal = landingSpots(s, op, landReach(s, op), 8)
      const extra = adjustSpots(s, op)
      if (!act || !act.declared || (normal.length === 0 && extra.length === 0)) {
        cancelAction(ctx)
        return
      }
      // counts as the Reposition action for every restriction (Charge, Fall Back, Heavy weapons)
      act.declared = { ...act.declared, params: { ...(act.declared.params ?? {}), treatedAs: 'reposition' } }
      const price = adjustPrice(s, op)
      const mk = (p: Vec3, adj: boolean) =>
        (['engage', 'conceal'] as const).map((order) =>
          opt(`${order}@${p.x},${p.y},${p.z}${adj ? '!adj' : ''}`, 'ta.land.at', {
            x: p.x,
            y: p.y,
            z: p.z,
            order,
            adjust: adj,
            ...(adj && price ? { cost: price.cost } : {}),
            name: `Land at (${p.x}, ${p.z})${p.y > 0 ? ` on a ${p.y}" floor` : ''} with ${order === 'engage' ? 'Engage' : 'Conceal'}${adj ? ` (Adjust Coordinates, ${price?.cost ?? 1} CP)` : ''}`,
          }),
        )
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'taLand', operativeId: op.id, abilityId: def.id },
        options: [...normal.flatMap((p) => mk(p, false)), ...extra.flatMap((p) => mk(p, true))],
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const s = ctx.state
    const m = SPOT_ID.exec(option)
    if (!m || !isAbove(op)) {
      cancelAction(ctx)
      return
    }
    const order = m[1] as 'engage' | 'conceal'
    const pos = { x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) }
    const adj = m[5] === '!adj'
    const price = adj ? adjustPrice(s, op) : null
    if (!landOk(s, op, pos, adj ? ADJUST_REACH : landReach(s, op)) || (adj && !price)) {
      cancelAction(ctx)
      return
    }
    if (!returnToKillzone(ctx, op.id, { pos, order, kind: 'land' })) {
      cancelAction(ctx)
      return
    }
    op.facing = bearing(pos, { x: 0, z: 0 })
    if (adj && price) {
      const offer: PloyOffer = { id: ID.adjust, ployId: ID.adjust, name: 'ADJUST COORDINATES', cost: price.cost, ...(price.via ? { via: price.via } : {}), operativeId: op.id, seed: {} }
      usePloy(ctx, op.seat, offer, { window: 'firefight.actionDeclared', subjectId: op.id })
    }
    addEffect(ctx, { source: ID.land, seat: op.seat, kind: FX.landed, operativeId: op.id, expires: 'turningPoint', data: { own: false } })
    addEffect(ctx, { source: ID.land, seat: op.seat, kind: FX.landedAct, operativeId: op.id, expires: 'activation' })
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId ?? ID.land), detail: `${pos.x},${pos.y},${pos.z}` }, op.seat)
    finishAction(ctx)
  },
})

/** Spots only the 5" reach of Adjust Coordinates allows (T-TA.35), when the ploy is on offer. */
function adjustSpots(state: GameState, op: Operative): Vec3[] {
  if (!adjustPrice(state, op)) return []
  const normal = new Set(landingSpots(state, op, landReach(state, op), 16).map((p) => `${p.x},${p.y},${p.z}`))
  return landingSpots(state, op, ADJUST_REACH, 16)
    .filter((p) => !normal.has(`${p.x},${p.y},${p.z}`))
    .slice(0, 8)
}

registerCodeHook({
  name: 'taAdjustCoordinates',
  ploy: {
    // never offered in a window of its own: the landing choice pays it (T-TA.35)
    offers(): PloyOfferSeed[] {
      return []
    },
    apply(ctx, seat, ploy, _seed, info) {
      const id = info.subjectId
      if (!id) return
      addEffect(ctx, { source: ploy.id, seat, kind: FX.adjusted, operativeId: id, expires: 'turningPoint' })
    },
  },
})

// ---------------------------------------------------------------------------
// COMMAND (T-TA.8)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'taCommand',
  action: {
    offers(state, op): OfferSeed[] {
      const range = 6 + commsBonus(state, op.seat, op)
      const out: OfferSeed[] = []
      for (const f of taOps(state, op.seat)) {
        if (f.id === op.id || isServo(state, f) || !within(op, f, range) || !visible(state, bodyOf(op), bodyOf(f))) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[String(params.targetId)]
      if (!live(target) || target.seat !== op.seat || target.id === op.id || isServo(ctx.state, target)) {
        cancelAction(ctx)
        return
      }
      aplChangeNextActivation(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Gunfight (T-TA.11)
// ---------------------------------------------------------------------------

/** The Gunfight frame the operative is shooting in, or null. */
function gunfightFrame(state: GameState, op: Operative): Record<string, unknown> | null {
  const act = state.firefight.activation
  return act?.frame?.data?.taGunfight === true && act.operativeId === op.id ? act.frame.data! : null
}

/** Could the Gunfighter take its free Shoot at that enemy now (a Conceal order may switch to Engage first)? */
function gunfightPossible(state: GameState, g: Operative, enemyId: string): boolean {
  const enemy = state.operatives[enemyId]
  if (!enemy || enemy.status !== 'active' || enemy.wounds <= 0 || !g.weapons.includes(FOCUSED)) return false
  const order = g.order
  g.order = 'engage'
  try {
    if (!canStartFreeAction(state, { operativeId: g.id, action: 'shoot', resume: '' })) return false
    return validTargets(state, g, FOCUSED).some((t) => t.id === enemyId)
  } finally {
    g.order = order
  }
}

function startGunfight(ctx: Ctx, g: Operative, fx: { id: string; data?: Record<string, unknown> }, resume: string, extra: Record<string, unknown> = {}): boolean {
  const enemyId = String(fx.data?.enemyId)
  const fails = Number(fx.data?.fails ?? 0)
  removeEffects(ctx, (e) => e.id === fx.id)
  const previous = g.order
  setOrder(ctx, g, 'engage')
  ctx.emit({ type: 'AbilityUsed', operativeId: g.id, abilityId: ID.gunfight, detail: enemyId }, g.seat)
  const started = startFreeAction(ctx, { operativeId: g.id, action: 'shoot', resume, data: { taGunfight: true, enemyId, fails, ...extra } })
  if (!started && g.order !== previous) setOrder(ctx, g, previous)
  return started
}

registerCodeHook({
  name: 'taGunfight',
  choice(ctx, op, option, context) {
    const s = ctx.state
    const fx = s.effects.find((e) => e.kind === FX.gunfight && e.operativeId === op.id)
    // after the enemy's Shoot action: a reaction (REACTION_DONE carries on)
    if (context.reaction === true) {
      if (!fx || !live(op) || !startGunfight(ctx, op, fx, REACTION_DONE)) reactionDone(ctx)
      return
    }
    // before the Gunfighter's own removal: the removal queue waits for the free Shoot
    if (option === 'none' || !fx || !s.removal) {
      continueRemovals(ctx)
      return
    }
    const saved = JSON.parse(JSON.stringify(s.removal)) as NonNullable<GameState['removal']>
    if (!startGunfight(ctx, op, fx, 'ta.gunfight', { removal: saved })) continueRemovals(ctx)
  },
})

registerFrameResume('ta.gunfight', (ctx, _outcome, data) => {
  if (data.removal) ctx.state.removal = data.removal as NonNullable<GameState['removal']>
  continueRemovals(ctx)
})

// the fails the enemy's dice end as, counted per sequence aimed at the Gunfighter
registerHook(
  'afterAttackRoll',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { kind: string; dice: { kind: string }[] }
    if (!s || !ctx || !shooter || !target || data.kind !== 'shoot' || shooter.seat === target.seat) return null
    if (!isTa(s, target) || !hasAbility(s, target, ID.gunfight) || !live(target) || !within(shooter, target, 8)) return null
    const fails = data.dice.filter((d) => d.kind === 'fail').length
    // one count per sequence: the after-roll hooks run again when another rule's choice resumes the step
    const key = `${s.firefight.activation?.declaredSeq ?? -1}:${s.attack?.index ?? 0}`
    const fx = s.effects.find((e) => e.kind === FX.gunfight && e.operativeId === target.id && e.data?.enemyId === shooter.id)
    const counted = (fx?.data?.seqs as string[] | undefined) ?? []
    if (fx && counted.includes(key)) return null
    if (fx) fx.data = { ...fx.data, fails: Number(fx.data?.fails ?? 0) + fails, seqs: [...counted, key] }
    // the effect outlives the action (reactions come after it) and ends when the enemy declares its next action
    else addEffect(ctx, { source: ID.gunfight, seat: target.seat, kind: FX.gunfight, operativeId: target.id, expires: 'activation', data: { enemyId: shooter.id, fails, seqs: [key] } })
    return null
  },
  'ta.afterAttackRoll',
)

// the fails counted for one Shoot action are no longer owed once the enemy declares its next action
registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    if (!ctx || !c.operativeId) return null
    removeEffects(ctx, (e) => e.kind === FX.gunfight && e.data?.enemyId === c.operativeId)
    return null
  },
  'ta.action.declared',
)

// the Gunfighter is among those the Shoot incapacitated: it fires before it is removed
registerHook(
  'operative.incapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !victim || !s.removal || victim.status !== 'active' || !isTa(s, victim) || !hasAbility(s, victim, ID.gunfight)) return null
    const fx = s.effects.find((e) => e.kind === FX.gunfight && e.operativeId === victim.id)
    if (!fx || !gunfightPossible(s, victim, String(fx.data?.enemyId))) return null
    ctx.raise({
      kind: 'ability.choice',
      seat: victim.seat,
      window: 'operative.incapacitated',
      context: { hook: 'taGunfight', operativeId: victim.id },
      options: [
        opt('shoot', 'ta.gunfight.shoot', { name: `Gunfight: ${victim.name} shoots back before it falls (${Math.min(4, Number(fx.data?.fails ?? 0) + 1)} dice)` }),
        opt('none', 'ta.gunfight.none', { name: 'Let it fall' }),
      ],
    })
    return null
  },
  'ta.gunfight.removal',
)

// the free Shoot: the enemy only (beforeShootTargetSelect), the focused profile only (weaponForbidden), fails + 1 dice
registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const frame = s && op ? gunfightFrame(s, op) : null
    if (!frame) return null
    const data = c.data as { candidates: string[] }
    data.candidates = data.candidates.filter((id) => id === frame.enemyId)
    return null
  },
  'ta.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// Dynamic (T-TA.15)
// ---------------------------------------------------------------------------

/**
 * Dynamic's Dash keeps every restriction of a free action in the activation except the Charge bar (R-3.9: a Dash
 * already made this activation still bars it), so the shared performed check is skipped and the rest done here.
 */
function dynamicDashOpen(state: GameState, op: Operative): boolean {
  const own = ownActivationOf(state, op)
  if (own && !own.counteract && (own.performed.includes('dash') || own.barred?.includes('dash'))) return false
  return canStartFreeAction(state, { operativeId: op.id, action: 'dash', resume: '', ignorePerformed: true })
}

registerCodeHook({
  name: 'taDynamic',
  choice(ctx, op) {
    if (!live(op)) {
      reactionDone(ctx)
      return
    }
    const act = baseActivation(ctx.state)
    const started = dynamicDashOpen(ctx.state, op) && startFreeAction(ctx, { operativeId: op.id, action: 'dash', resume: REACTION_DONE, ignorePerformed: true, ...(act?.counteract ? { maxMove: 2 } : {}) })
    if (started) markFired('taDynamic')
    else reactionDone(ctx)
  },
})

// ---------------------------------------------------------------------------
// Rapid Insertion (T-TA.18)
// ---------------------------------------------------------------------------

function rapidTroopers(state: GameState, seat: Seat): Operative[] {
  const zone = dropZoneOf(state, seat)
  if (!zone) return []
  return taOps(state, seat).filter((o) => hasKeyword(state, o, 'TROOPER') && whollyWithinRegion(bodyOf(o), zone.polygon))
}

function rapidNext(ctx: Ctx, seat: Seat, remaining: string[]): void {
  const s = ctx.state
  const able = remaining.filter((id) => live(s.operatives[id]) && canStartFreeAction(s, { operativeId: id, action: 'reposition', resume: '' }))
  if (able.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'taRapidInsertion', operativeId: able[0], seat, remaining: able },
    options: [...able.map((id) => opt(id, 'ta.rapid.move', { name: `${s.operatives[id]!.name} repositions` })), opt('done', 'ta.rapid.done', { name: 'Done' })],
  })
}

registerCodeHook({
  name: 'taRapidInsertion',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return state.turningPoint === 1 && rapidTroopers(state, seat).length > 0 ? [{}] : []
    },
    apply(ctx, seat) {
      // the group is fixed now (R-2.4 reading in the RULING)
      rapidNext(ctx, seat, rapidTroopers(ctx.state, seat).map((o) => o.id))
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const remaining = (context.remaining as string[]).slice()
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const rest = remaining.filter((id) => id !== option)
    const started = startFreeAction(ctx, { operativeId: option, action: 'reposition', resume: 'ta.rapid', data: { taRapid: true, seat, remaining: rest } })
    if (!started) rapidNext(ctx, seat, rest)
  },
})

registerFrameResume('ta.rapid', (ctx, _outcome, data) => {
  rapidNext(ctx, data.seat as Seat, (data.remaining as string[]) ?? [])
})

// ---------------------------------------------------------------------------
// Strategy ploys: Sudden Offensive, Maintain Momentum, Eye Above, Drop and Secure
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'taSuddenOffensive',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      const s = ctx.state
      // every Aquilon that is not incapacitated counts, those above included
      const alive = Object.values(s.operatives).filter((o) => o.seat === seat && isTa(s, o) && (o.status === 'active' || isAbove(o))).length
      addEffect(ctx, { source: ploy.id, seat, kind: FX.sudden, expires: 'turningPoint', data: { x: Math.ceil(alive / 2), ids: [] as string[] } })
    },
  },
})

registerHook(
  'activation.start',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isTa(s, op)) return null
    const fx = s.effects.find((e) => e.kind === FX.sudden && e.seat === op.seat)
    const ids = fx?.data?.ids as string[] | undefined
    if (fx && ids && ids.length < Number(fx.data?.x) && !ids.includes(op.id)) ids.push(op.id)
    return null
  },
  'ta.activation.start',
)

registerCodeHook({
  name: 'taMaintainMomentum',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: FX.flag, expires: 'turningPoint' })
    },
  },
})

registerCodeHook({
  name: 'taEyeAbove',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return activeOps(state)
        .filter((o) => o.seat !== seat && live(o))
        .map((o) => ({ param: o.id }))
    },
    apply(ctx, seat, ploy, seed) {
      const s = ctx.state
      const pick = seed.param ? s.operatives[seed.param] : undefined
      if (!live(pick)) return
      // the tokens are given once, now: the pick and every enemy within 3" of it (RULING)
      const group = activeOps(s).filter((o) => o.seat !== seat && live(o) && (o.id === pick.id || within(o, pick, 3)))
      addEffect(ctx, { source: ploy.id, seat, kind: FX.flag, expires: 'turningPoint' })
      for (const o of group) addToken(ctx, o.id, { kind: DETECTED, owner: seat, cap: 1, expires: ['turningPointEnd'] }, ploy.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id, detail: pick.id }, seat)
    },
  },
})

/** Objective and mission markers control is worked out for (T-TA.33). */
function secureMarkers(state: GameState): Marker[] {
  return state.markers.filter((m) => tracksControl(m))
}

registerCodeHook({
  name: 'taDropAndSecure',
  ploy: {
    offers(state): PloyOfferSeed[] {
      return secureMarkers(state).map((m) => ({ param: m.id }))
    },
    apply(ctx, seat, ploy, seed) {
      if (!seed.param) return
      // until the Ready step of the next turning point
      addEffect(ctx, { source: ploy.id, seat, kind: FX.secure, expires: 'turningPointStart', data: { markerId: seed.param } })
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id, detail: seed.param }, seat)
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys: Hot Drop, Tempestus Exemplars, Progena
// ---------------------------------------------------------------------------

/** Hot Drop: wholly within the opponent's territory, or landed / dropped from Vantage in this activation (T-TA.34). */
function hotDropEligible(state: GameState, op: Operative): boolean {
  const territory = territoryOf(state, otherSeat(op.seat))
  if (territory && whollyWithinRegion(bodyOf(op), territory)) return true
  return !!opEffect(state, FX.landedAct, op.id) || !!opEffect(state, FX.droppedAct, op.id)
}

registerCodeHook({
  name: 'taHotDrop',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isTa(state, op)) return []
      const foeId = info.attackerId === op.id ? info.targetId : info.attackerId
      const foe = foeId ? state.operatives[foeId] : undefined
      if (!foe || foe.seat === seat || !within(op, foe, 6) || !hotDropEligible(state, op)) return []
      const side = sideOf(state, op.id)
      if (!side || side.noRerolls || !side.dice.some((d) => d.value !== null && !d.rerolled && !d.used)) return []
      return [{}]
    },
    apply(ctx, _seat, ploy, _seed, info) {
      const side = info.subjectId ? sideOf(ctx.state, info.subjectId) : null
      if (side) side.grants.push({ id: 'ta.hotdrop', source: ploy.id, mode: 'any', used: false })
    },
  },
})

registerCodeHook({
  name: 'taExemplars',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isTa(state, op) || isServo(state, op) || info.counteracting) return []
      // the operative's APL as it stands (R-9.6), so a Tempestor at 3 or an operative raised to 3 does not qualify
      if (effectiveApl(op) > 2) return []
      // only worth offering while it has a marker or mission action it could take (AP aside)
      return abilityOffers(state, op, null).some((o) => o.action === PICK_UP || o.action === PLACE || (state.data.abilities[o.abilityId]?.keywords ?? []).includes('MISSION')) ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: FX.exemplars, operativeId: info.subjectId, expires: 'activation' })
    },
  },
})

registerCodeHook({
  name: 'taProgena',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      // an operative above may be picked as well (RULING): it heals nothing there, so only while it has an APL change to ignore
      if (!op || op.seat !== seat || !isTa(state, op) || isServo(state, op) || info.counteracting) return []
      const here = (op.status === 'active' && op.wounds > 0) || (op.status === 'reserve' && op.offboard === 'setAside' && op.aplMods !== 0)
      return here ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op || !(op.status === 'active' || op.offboard === 'setAside')) return
      if (op.status === 'active' && op.wounds > 0) {
        const dice = ctx.roll('ta.progena.2d3', 2)
        regainWounds(ctx, op.id, dice.reduce((n, d) => n + Math.ceil(d / 2), 0), ploy.id)
      }
      addEffect(ctx, { source: ploy.id, seat, kind: FX.progena, operativeId: op.id, expires: 'activation' })
    },
  },
})

// ---------------------------------------------------------------------------
// Hooks: movement tracking, landed status, deadlines, markers at the Ready step
// ---------------------------------------------------------------------------

/**
 * A drop from Vantage terrain at least 2" above the killzone floor somewhere in this move (T-TA.34): a drop segment that
 * starts on such a Vantage floor, or one that follows a jump that left one; a climb onto the Vantage floor earlier in the
 * same move counts too.
 */
function droppedFromVantage(state: GameState, segments: { kind: string; from: Vec3; to: Vec3 }[]): boolean {
  const terrain = terrainOf(state.map)
  const onVantage = (p: Vec3) => p.y >= 2 - EPS && !!standingSolid(terrain, p)?.vantage
  for (let i = 0; i < segments.length; i++) {
    const sg = segments[i]!
    if (sg.kind !== 'drop' && sg.kind !== 'jump') continue
    const prev = segments[i - 1]
    const start = sg.kind === 'drop' && prev?.kind === 'jump' ? prev.from : sg.from
    const end = sg.kind === 'jump' ? (segments[i + 1]?.kind === 'drop' ? segments[i + 1]!.to : sg.to) : sg.to
    if (onVantage(start) && end.y < start.y - EPS) return true
  }
  return false
}

// Hot Drop: a drop from Vantage terrain at least 2" up, in the operative's own activation or counteraction
registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isTa(s, op)) return null
    const base = baseActivation(s)
    if (!base || base.operativeId !== op.id) return null
    for (const ev of ctx.events) {
      if (ev.type !== 'OperativeMoved' || ev.operativeId !== op.id) continue
      // the move began on a Vantage floor 2" or more up and went down by a drop, or a drop inside it left one
      const fromVantage = ev.from.y >= 2 - EPS && !!standingSolid(terrainOf(s.map), ev.from)?.vantage
      const began = fromVantage && ev.segments.some((sg) => sg.kind === 'drop' || sg.kind === 'jump') && ev.to.y < ev.from.y - EPS
      if (!began && !droppedFromVantage(s, ev.segments)) continue
      if (!opEffect(s, FX.droppedAct, op.id)) addEffect(ctx, { source: ID.hotDrop, seat: op.seat, kind: FX.droppedAct, operativeId: op.id, expires: 'activation' })
    }
    return null
  },
  'ta.action.ended',
)

// Landed and obscured: until the end of the next activation (T-TA.25)
registerHook(
  'activation.end',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s || (c.data as { counteract?: boolean } | undefined)?.counteract) return null
    for (const fx of s.effects.filter((e) => e.kind === FX.landed)) {
      if (fx.operativeId === c.operativeId) fx.data = { ...fx.data, own: true }
      else if (fx.data?.own === true) removeEffects(ctx, (e) => e.id === fx.id)
    }
    return null
  },
  'ta.activation.end',
)

registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { obscured: boolean; inCover: boolean }
    if (!s || !shooter || !target || shooter.seat === target.seat || data.obscured) return null
    if (!opEffect(s, FX.landed, target.id)) return null
    data.obscured = true
    return null
  },
  'ta.target.status',
)

function idNumber(id: string): number {
  return Number(id.replace(/\D/g, '')) || 0
}

registerHook(
  'turningPoint.end',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s) return null
    const tp = Number(c.data?.turningPoint)
    for (const seat of ['A', 'B'] as const) {
      if (!taSeat(s, seat)) continue
      const above = aboveOps(s, seat).filter((o) => isTa(s, o))
      // T-TA.26: fewer than half of the team may still be above after turning point 1 (latest roster entries go first)
      if (tp === 1) {
        const roster = Object.values(s.operatives).filter((o) => o.seat === seat).length
        const owed = [...above].sort((a, b) => idNumber(b.id) - idNumber(a.id))
        let left = above.length
        for (const o of owed) {
          if (left * 2 < roster) break
          incapacitateOffboard(ctx, o.id)
          left--
        }
      }
      // T-TA.27: everyone still above at the end of turning point 2 is incapacitated
      if (tp === 2) for (const o of above) incapacitateOffboard(ctx, o.id)
    }
    return null
  },
  'ta.turningPoint.end',
)

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s) return null
    const tp = Number(c.data?.turningPoint)
    for (const seat of ['A', 'B'] as const) {
      if (!taSeat(s, seat)) continue
      // markers still owed after a pass at the pre-battle step are placed at the default spot
      if (tp === 1) placeOwedMarkers(ctx, seat)
      // T-TA.27: one Drop marker is lost in the Ready step of turning points 2 and 3 (the player picks when two remain)
      if (tp >= 2 && tp <= 3 && !usedThisTp(s, seat, LEDGER.markerLoss)) {
        const mine = dropMarkers(s, seat)
        if (mine.length === 1) {
          removeMarker(ctx, mine[0]!.id, 'ta.dropLost')
          markUsedTp(s, seat, LEDGER.markerLoss)
        }
      }
    }
    return null
  },
  'ta.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Attack handlers: weapon rules, attack dice, defence dice, blocks, the Concealed Position ledger
// ---------------------------------------------------------------------------

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId || !isTa(s, op)) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const weapon = s.data.weapons[c.weaponId]
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    if (!weapon) return null
    const foe = !!target && target.seat !== op.seat
    // SNIPER'S VANTAGE: standing on a Vantage floor at least 2" above an Engage target (T-TA.12)
    if (data.kind === 'shoot' && foe && target && weapon.profileGroup === LONG_LAS && hasAbility(s, op, ID.vantage) && target.order === 'engage') {
      const stand = standingSolid(terrainOf(s.map), op.pos)
      if (stand?.vantage && op.pos.y - target.pos.y >= 2 - EPS && !hasRule(rules, 'severe')) {
        rules.push({ rule: 'severe' })
        markFired('taSnipersVantage')
      }
    }
    // SUDDEN OFFENSIVE: Balanced in the activation of the first x Aquilons activated (T-TA.30)
    const sudden = s.effects.find((e) => e.kind === FX.sudden && e.seat === op.seat)
    if (sudden && (sudden.data?.ids as string[]).includes(op.id) && ownActivation(s, op) && !hasRule(rules, 'balanced')) rules.push({ rule: 'balanced' })
    // MAINTAIN MOMENTUM: Severe against a ready enemy, shooting or fighting in its own Fight action (T-TA.31)
    if (foe && target && target.ready && ployActive(s, op.seat, ID.maintain) && !hasRule(rules, 'severe')) {
      const a = s.attack
      const attacking = data.kind === 'shoot' || (a?.kind === 'fight' ? a.operativeId === op.id : ownActivation(s, op) !== null)
      if (attacking) rules.push({ rule: 'severe' })
    }
    return null
  },
  'ta.modifyWeaponRules',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; atk: number; hitDelta: number; assists: string[] }
    // MACHINE: the Servo-Sentry never assists a fight (T-TA.16)
    if (data.kind === 'fight' && data.assists.some((id) => isServo(s, s.operatives[id]))) data.assists = data.assists.filter((id) => !isServo(s, s.operatives[id]))
    if (!isTa(s, op)) return null
    const weapon = s.data.weapons[c.weaponId]
    if (!weapon) return null
    // GRENADIER: its frag and krak grenades hit one better, whatever else changes the Hit (T-TA.9)
    if (hasAbility(s, op, ID.grenadier) && (c.weaponId === FRAG || c.weaponId === KRAK)) data.hitDelta -= 1
    // GUNFIGHT: fails + 1 dice, at most 4 (T-TA.11)
    const frame = data.kind === 'shoot' ? gunfightFrame(s, op) : null
    if (frame && c.weaponId === FOCUSED) data.atk = Math.min(4, Number(frame.fails ?? 0) + 1)
    // DROP AND SECURE: Atk +1 on melee weapons within 3" of the marker, to a maximum of 4 (T-TA.33)
    if (weapon.type === 'melee' && data.atk < 4) {
      const fx = s.effects.find((e) => e.kind === FX.secure && e.seat === op.seat)
      const marker = fx ? s.markers.find((m) => m.id === fx.data?.markerId) : undefined
      if (marker && gapToMarker(bodyOf(op), marker) <= 3 + EPS) data.atk += 1
    }
    return null
  },
  'ta.modifyAttackDice',
)

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { attackerId: string; rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    // EYE ABOVE: a Detected enemy shooting an Aquilon lets it re-roll one defence die (T-TA.32)
    if (!s || !op || !isTa(s, op) || !ployActive(s, op.seat, ID.eye) || !hasToken(s, data.attackerId, DETECTED, op.seat)) return null
    data.rerolls.push({ id: 'ta.eye', source: ID.eye, mode: 'one', used: false })
    return null
  },
  'ta.modifyDefenceDice',
)

registerHook(
  'afterBlock',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const foe = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { against: unknown[] }
    // EYE ABOVE: the double block is used up (one per sequence)
    if (!ctx || !s || !op || !foe || !eyeBlock(s, op, foe) || data.against.length < 2) return null
    addEffect(ctx, { source: ID.eye, seat: op.seat, kind: FX.eyeUsed, operativeId: op.id, expires: 'action' })
    markFired('taEyeAbove')
    return null
  },
  'ta.afterBlock',
)

/** Does an Aquilon's block against a Detected enemy still cancel two successes (T-TA.32)? */
function eyeBlock(state: GameState, op: Operative, foe: Operative): boolean {
  return isTa(state, op) && ployActive(state, op.seat, ID.eye) && hasToken(state, foe.id, DETECTED, op.seat) && !opEffect(state, FX.eyeUsed, op.id)
}

registerHook(
  'afterShootResolved',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isTa(s, op)) return null
    // Concealed Position: any Shoot in which the operative shot uses up the profile (T-TA.13)
    markUsedBattle(s, op.seat, LEDGER.shot(op.id))
    return null
  },
  'ta.afterShootResolved',
)

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

const SERVO_ACTIONS = ['dash', 'fallBack', 'reposition', 'shoot', ABILITY(ID.land)]

registerTeamRules({
  id: TEAM_ID,

  // ---- DROP INSERTION at set-up (T-TA.20) ----
  setAsideBatches: (s, seat) => (taSeat(s, seat) ? { skipFirst: true } : null),
  setAsideAtSetup: (s, op) => op.status === 'reserve' && op.offboard === undefined && isTa(s, op),
  setAsideCap(s, seat) {
    if (!taSeat(s, seat)) return null
    // every batch but the first may go above (4 + 3 of 11); the batch rule keeps it whole
    const n = Object.values(s.operatives).filter((o) => o.seat === seat).length
    return n - Math.ceil(n / 3)
  },
  offboardActions: (s, op) => (isTa(s, op) && isAbove(op) ? [ID.land] : []),

  preBattleChoices(state, seat): ReactionOffer[] {
    if (!taSeat(state, seat) || state.setup.step !== 'preBattle') return []
    if (batchesAside(state, seat) - dropMarkers(state, seat).length <= 0) return []
    const who = anyTa(state, seat)
    if (!who) return []
    return dropMarkerSpots(state, seat).map((p) => ({ hook: 'taDropMarkers', operativeId: who.id, option: `place:${p.x},${p.z}`, labelKey: 'ta.drop.place', data: { x: p.x, z: p.z, name: `Place a Drop marker at (${p.x}, ${p.z})` } }))
  },

  readyStepChoices(state, seat): ReactionOffer[] {
    if (!taSeat(state, seat) || state.turningPoint < 2 || state.turningPoint > 3 || usedThisTp(state, seat, LEDGER.markerLoss)) return []
    const mine = dropMarkers(state, seat)
    const who = anyTa(state, seat)
    if (mine.length < 2 || !who) return []
    return mine.map((m) => ({ hook: 'taDropMarkers', operativeId: who.id, option: `remove:${m.id}`, labelKey: 'ta.drop.remove', data: { x: m.pos.x, z: m.pos.z, markerId: m.id, name: `Lose the Drop marker at (${m.pos.x}, ${m.pos.z})` } }))
  },

  // ---- GRAV-CHUTE (T-TA.29): drops cost nothing ----
  moveSurcharge(state, op, _kind, _points, breakdown) {
    if (!isTa(state, op) || breakdown.drop <= 0) return 0
    markFired('taGravChute')
    return -breakdown.drop
  },

  // ---- Machine and Turret (T-TA.16, T-TA.17) ----
  actionForbidden(state, op, actionId) {
    if (!isTa(state, op)) return null
    if (isServo(state, op) && !SERVO_ACTIONS.includes(actionId)) return `${op.name} is a Machine and cannot take that action`
    // Adjust Coordinates: no Dash, Shoot or Fight for the rest of the turning point (T-TA.35)
    if (opEffect(state, FX.adjusted, op.id) && ['dash', 'shoot', 'fight'].includes(actionId)) return 'Adjust Coordinates: no Dash, Shoot or Fight for the rest of the turning point'
    return null
  },
  maxRepeats(state, op, actionId) {
    return actionId === 'shoot' && isTa(state, op) && hasAbility(state, op, ID.turret) ? 2 : null
  },
  equipmentEligible(state, op) {
    return isServo(state, op) ? false : null
  },

  // ---- Grenadier (T-TA.9): 99 stands for unlimited ----
  extraActions(state, op) {
    return isTa(state, op) && hasAbility(state, op, ID.grenadier) ? [SMOKE, STUN] : []
  },
  ownGrenades(state, op) {
    if (!isTa(state, op) || !hasAbility(state, op, ID.grenadier)) return null
    return { weapons: { [FRAG]: 99, [KRAK]: 99 }, actions: { [SMOKE]: 99, [STUN]: 99 } }
  },

  // ---- Salvo (T-TA.10): the second target is any other valid target ----
  extraTargets(state, shooter, weaponId, primaryId) {
    if (weaponId !== 'ta.w.hot-shot-laspistols-salvo') return null
    const candidates = validTargets(state, shooter, weaponId)
      .map((t) => t.id)
      .filter((id) => id !== primaryId)
    return candidates.length > 0 ? { candidates, max: 1 } : null
  },

  // ---- Concealed Position (T-TA.13) and the Gunfight Shoot (T-TA.11) ----
  weaponForbidden(state, op, weaponId, kind) {
    if (kind !== 'shoot' || !isTa(state, op)) return null
    if (weaponId === CONCEALED && usedThisBattle(state, op.seat, LEDGER.shot(op.id))) return 'Concealed Position: that profile can only be used in the first Shoot of the battle'
    if (gunfightFrame(state, op) && weaponId !== FOCUSED) return 'Gunfight: only the focused profile may be used'
    return null
  },

  // ---- Tempestus Veteran (T-TA.7): a free Command Re-roll for the Tempestor's dice ----
  commandRerollCost(state, side) {
    const op = state.operatives[side.operativeId]
    if (!op || !isTa(state, op) || !hasAbility(state, op, ID.veteran) || usedThisBattle(state, op.seat, LEDGER.veteran)) return null
    return 0
  },
  onCommandReroll(ctx, side, cost) {
    const op = ctx.state.operatives[side.operativeId]
    if (cost !== 0 || !op || !isTa(ctx.state, op) || !hasAbility(ctx.state, op, ID.veteran) || usedThisBattle(ctx.state, op.seat, LEDGER.veteran)) return
    markUsedBattle(ctx.state, op.seat, LEDGER.veteran)
  },

  // ---- Vicious Knife Fighter (T-TA.14): the Precursor's second resolution comes at once ----
  afterFightResolution(state, attack, seat) {
    if (attack.kind !== 'fight') return null
    const op = state.operatives[attack.operativeId]
    if (!op || op.seat !== seat || !isTa(state, op) || !hasAbility(state, op, ID.knife)) return null
    const key = String(state.firefight.activation?.declaredSeq ?? -1)
    if (state.effects.some((e) => e.kind === FX.knife && e.operativeId === op.id && e.data?.key === key)) return null
    state.effects.push({ id: `e${state.nextEffect++}`, source: ID.knife, seat, kind: FX.knife, operativeId: op.id, expires: 'action', data: { key } })
    return [{ seat }]
  },

  // ---- Eye Above (T-TA.32): one block cancels two successes, once per sequence ----
  blockCapacity(state, attack, seat) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const ids = [attack.operativeId, attack.fight.targetId]
    const mine = ids.map((id) => state.operatives[id]).find((o) => o && o.seat === seat)
    const foe = ids.map((id) => state.operatives[id]).find((o) => o && o.seat !== seat)
    return mine && foe && eyeBlock(state, mine, foe) ? 2 : null
  },

  // ---- Drop and Secure (T-TA.33): the contesting total counts 1 higher ----
  controlTotal(state, seat, marker, total, contesting) {
    const fx = state.effects.find((e) => e.kind === FX.secure && e.seat === seat && e.data?.markerId === marker.id)
    if (!fx || total <= 0 || !contesting.some((id) => isTa(state, state.operatives[id]))) return null
    markFired('taDropAndSecure')
    return total + 1
  },

  // ---- Combat Stimms (T-TA.39): the injured Move loss does not apply ----
  moveDelta(state, op) {
    if (!isTa(state, op) || !equipped(state, op.seat, ID.stimms) || !hasInjuredPenalty(op)) return 0
    markFired('taCombatStimms')
    return 2
  },

  // ---- Tempestus Exemplars (T-TA.36): marker and mission actions cost 1 AP less ----
  actionCostDelta(state, op, actionId) {
    if (!isTa(state, op) || !opEffect(state, FX.exemplars, op.id)) return 0
    const mission = actionId.startsWith('ability:') && (state.data.abilities[actionId.slice('ability:'.length)]?.keywords ?? []).includes('MISSION')
    return actionId === PICK_UP || actionId === PLACE || mission ? -1 : 0
  },

  // ---- Progena (T-TA.37): APL changes may be ignored; the player only ever drops the decreases (RULING) ----
  flags(state, op) {
    return opEffect(state, FX.progena, op.id) ? { ignoreAplDecreases: true } : null
  },

  // ---- Remote Overseer (T-TA.41): re-roll the own initiative die, once per battle ----
  initiativeReroll(state, seat) {
    if (!equipped(state, seat, ID.overseer) || usedThisBattle(state, seat, LEDGER.overseer)) return false
    const mine = state.strategy.rolls[seat]
    const theirs = state.strategy.rolls[otherSeat(seat)]
    return mine !== undefined && theirs !== undefined && mine <= theirs
  },
  onInitiativeReroll(ctx, seat) {
    if (!equipped(ctx.state, seat, ID.overseer)) return
    markUsedBattle(ctx.state, seat, LEDGER.overseer)
    markFired('taRemoteOverseer')
  },

  // ---- Rapid Insertion (T-TA.18): the free Reposition must end within 3" of the drop zone ----
  moveProblem(state, op, kind, points) {
    const act = state.firefight.activation
    if (kind !== 'reposition' || act?.frame?.data?.taRapid !== true || act.operativeId !== op.id) return null
    const end = points.at(-1)
    const zone = dropZoneOf(state, op.seat)
    if (!end || !zone) return null
    return distToPolygon({ x: end.x, z: end.z }, zone.polygon) + op.baseRadius > 3 + EPS ? 'Rapid Insertion: the Reposition must end wholly within 3" of your drop zone' : null
  },

  // ---- Gunfight after the enemy's Shoot action (T-TA.11) ----
  reactions(state, seat, info): ReactionOffer[] {
    if (info.action !== 'shoot' || info.activeSeat === seat) return []
    const out: ReactionOffer[] = []
    for (const fx of state.effects) {
      if (fx.kind !== FX.gunfight || fx.seat !== seat || !fx.operativeId || fx.data?.enemyId !== info.actorId) continue
      const g = state.operatives[fx.operativeId]
      if (!live(g) || !gunfightPossible(state, g, info.actorId)) continue
      out.push({ hook: 'taGunfight', operativeId: g.id, option: 'shoot', labelKey: 'ta.gunfight.shoot', data: { name: `Gunfight: ${g.name} shoots back (${Math.min(4, Number(fx.data?.fails ?? 0) + 1)} dice)`, enemyId: info.actorId } })
    }
    return out
  },

  // ---- Dynamic after the Precursor's own Shoot or Fight (T-TA.15) ----
  ownReactions(state, seat, info): ReactionOffer[] {
    if (info.action !== 'shoot' && info.action !== 'fight') return []
    const op = state.operatives[info.actorId]
    if (!live(op) || op.seat !== seat || !isTa(state, op) || !hasAbility(state, op, ID.dynamic)) return []
    if (!dynamicDashOpen(state, op)) return []
    return [{ hook: 'taDynamic', operativeId: op.id, option: 'dash', labelKey: 'ta.dynamic.dash', freeActions: true, data: { name: `Dynamic: ${op.name} takes a free Dash` } }]
  },
})

// ---------------------------------------------------------------------------
// Ploy rule: Tempestus Veteran's free ploy, Drop Augury
// ---------------------------------------------------------------------------

const taPloyRule: PloyRule = {
  // TEMPESTUS VETERAN: a firefight ploy naming the Tempestor costs 0 CP, once per battle (T-TA.7)
  costAdjust(state, seat, ploy, _seed, info) {
    if (ploy.type !== 'firefight' || !taSeat(state, seat) || usedThisBattle(state, seat, LEDGER.veteran)) return null
    const t = tempestor(state, seat)
    return t && info.subjectId === t.id ? { cost: 0, via: 'ta.veteran' } : null
  },
  extraOffers(state, seat, window, info) {
    // DROP AUGURY: when an operative above is activated, before it lands or stays (T-TA.40)
    if (window !== 'firefight.activationStart' || !taSeat(state, seat) || !equipped(state, seat, ID.augury) || usedThisBattle(state, seat, LEDGER.augury)) return []
    const op = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!op || op.seat !== seat || !isAbove(op) || dropMarkers(state, seat).length === 0) return []
    return [{ id: ID.augury, ployId: ID.augury, name: 'DROP AUGURY: move a Drop marker', operativeId: op.id, cost: 0, via: 'ta.augury', seed: {} }]
  },
  onUsed(ctx, seat, offer) {
    if (offer.via === 'ta.veteran') {
      markUsedBattle(ctx.state, seat, LEDGER.veteran)
      return
    }
    if (offer.via !== 'ta.augury') return
    const s = ctx.state
    markUsedBattle(s, seat, LEDGER.augury)
    const op = offer.operativeId ? s.operatives[offer.operativeId] : undefined
    if (!op) return
    ctx.raise({
      kind: 'ability.choice',
      seat,
      window: 'firefight.activationStart',
      context: { hook: 'taDropAugury', operativeId: op.id, mode: 'augury' },
      options: moveOptions(s, seat, dropMarkers(s, seat), true),
    })
  },
}

registerPloyRule(taPloyRule)

/** Ids the AI and the tests use. */
export const TA_IDS = ID
export const TA_FX = FX
