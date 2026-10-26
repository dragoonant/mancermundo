// Hierotek Circle (docs/spec/13-teams.md section 4, rule ids T-HIE.n): the code hooks this team's data names, its
// team rule provider (team-rules.ts registerTeamRules) and its hook handlers (hooks.ts registerHook). The generic
// machinery lives in tokens.ts, reserve.ts, effects.regainWounds and firefight.startDelegatedAction; this file is
// the team's own rules on top of them.
import { applyAplEffect, ruleSetFor } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { hasAbility, hasKeyword, paramsOf } from '../conditions'
import {
  addEffect,
  addTpUse,
  addUse,
  directDamage,
  gainCp,
  markUsedBattle,
  markUsedTp,
  regainWounds,
  removeEffects,
  spendCp,
  tpUsesOf,
  usedThisBattle,
  usedThisTp,
  usesOf,
} from '../effects'
import { cancelAction, finishAction, startDelegatedAction, startFreeAction } from '../firefight'
import { readyChoiceDone, resumeGambit } from '../strategy'
import { dist2, baseGap2D, round3 } from '../geometry'
import { registerFrameResume, registerHook, type BeforeShootTargetSelectData, type OnDamageInflictedData } from '../hooks'
import { bodyOf, targetVerdict, visible } from '../los'
import { controlledBy, newMarkerId, removeMarker } from '../markers'
import { distanceBetween, enemiesInControlRange, gapToMarker, isWithin, markerBody } from '../measure'
import type { Ctx } from '../registry'
import { placementSpots, returnToKillzone } from '../reserve'
import { activeOps, effectiveApl, effectiveMove, enemiesOf, friendsOf, otherSeat } from '../state'
import { addToken, hasToken, moveTokenTo, removeToken, tokensOn } from '../tokens'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { terrainOf } from '../terrain'
import type { GameState, Marker, Operative, Order, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'hierotek-circle'

const KW = 'HIEROTEK CIRCLE'
const SEATS: readonly Seat[] = ['A', 'B']

/** Token kinds (tokens.ts) and the equipmentId of the markers this team places. */
export const T = {
  chronometron: 'hie.chronometron',
  reinforce: 'hie.reinforce',
  augment: 'hie.augment',
  shroud: 'hie.shroud',
  madness: 'hie.madness',
  deathmarked: 'hie.deathmarked',
} as const
export const M = { reanimation: 'hie.reanimation', nanomine: 'hie.nanomine', despair: 'hie.despair' } as const

const P = {
  relentless: 'hie.p.relentless-onslaught',
  undying: 'hie.p.undying-androids',
  methodical: 'hie.p.methodical-elimination',
  cortical: 'hie.p.cortical-control',
  function: 'hie.p.reanimated-function',
  lightning: 'hie.p.living-lightning',
  ambush: 'hie.p.dimensional-ambush',
} as const
const E = {
  conduits: 'hie.e.magnification-conduits',
  shifter: 'hie.e.phase-shifter',
  cube: 'hie.e.tesseract-cube',
  weave: 'hie.e.tesla-weave',
} as const
const A = { vision: 'hie.a.multi-dimensional-vision', accelerate: 'hie.a.accelerate' } as const
const REANIMATED_ONCE = 'hie.reanimationUsed'
const TESLA_CARBINE = 'hie.w.tesla-carbine'
const MARKER_R = 20 / 25.4 / 2

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isHie(state: GameState, op: Operative): boolean {
  return state.data.datacards[op.datacardId]?.teamId === TEAM_ID
}

const has = (state: GameState, op: Operative, kw: string): boolean => hasKeyword(state, op, kw)
const sees = (state: GameState, a: Operative, b: Operative): boolean => visible(state, bodyOf(a), bodyOf(b))
const dist = (a: Operative, b: Operative): number => distanceBetween(bodyOf(a), bodyOf(b))
const inCr = (state: GameState, op: Operative): boolean => enemiesInControlRange(state, op, op.seat).length > 0
const hieOps = (state: GameState, seat: Seat): Operative[] => activeOps(state).filter((o) => o.seat === seat && isHie(state, o))
const markersOf = (state: GameState, seat: Seat, equipmentId: string): Marker[] => state.markers.filter((m) => m.equipmentId === equipmentId && m.owner === seat)
const d3 = (d: number): number => Math.ceil(d / 2)

function weaponHas(state: GameState, weaponId: string, rule: string): boolean {
  return state.data.weapons[weaponId]?.rules.some((r) => r.rule === rule) ?? false
}

/** A friendly player's equipment option is on the team. */
const equipped = (state: GameState, seat: Seat, id: string): boolean => state.players[seat].equipment.includes(id)

function effectOn(state: GameState, source: string, seat: Seat, opId?: string): boolean {
  return state.effects.some((e) => e.source === source && e.seat === seat && (opId === undefined || e.operativeId === opId))
}

/** Comms Device (M-5.1): +3" to this operative's SUPPORT distances while it controls the team's own marker. */
function commsFor(state: GameState, op: Operative): number {
  if (controlledBy(state, op, (m) => m.equipmentId === 'core.e.comms-device' && m.owner === op.seat).length === 0) return 0
  markFired('commsDevice')
  return 3
}

// ---------------------------------------------------------------------------
// Reanimation Protocols (T-HIE.24 to T-HIE.27)
// ---------------------------------------------------------------------------

/** The marker tied to an operative, if it is still waiting. */
function markerFor(state: GameState, opId: string): Marker | undefined {
  return state.markers.find((m) => m.equipmentId === M.reanimation && m.placedBy === opId)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// Before removal (R-5.18): the first time a Hierotek Circle operative is incapacitated it leaves a Reanimation
// marker and loses every token and effect; markers this operative placed end with it.
registerHook(
  'operative.incapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !op) return null
    for (const m of [...s.markers]) {
      if (m.placedBy === op.id && (m.equipmentId === M.nanomine || m.equipmentId === M.despair)) removeMarker(ctx, m.id, 'source incapacitated')
    }
    if (!isHie(s, op) || op.oncePerBattleUsed.includes(REANIMATED_ONCE)) return null
    op.oncePerBattleUsed.push(REANIMATED_ONCE)
    // already expended this turning point: expended, counteracted, or struck down during its own activation (that
    // activation may sit under a frame, such as an enemy Guard interrupt)
    const ownActivation = [s.firefight.activation, ...(s.firefight.stack ?? [])].some((x) => !!x && !x.frame && !x.counteract && x.operativeId === op.id)
    const expended = !op.ready || ownActivation || op.flags.counteractedThisTP
    s.ledger[op.seat].uses[`hie.expended:${op.id}`] = expended ? s.turningPoint : 0
    // the marker lies beside the base, toward the middle of the killzone, inside the control range
    const len = Math.hypot(op.pos.x, op.pos.z)
    const dir = len > 0.01 ? { x: -op.pos.x / len, z: -op.pos.z / len } : { x: 0, z: 1 }
    const reach = op.baseRadius + 0.5
    const pos = { x: round3(clamp(op.pos.x + dir.x * reach, -14.6, 14.6)), z: round3(clamp(op.pos.z + dir.z * reach, -10.6, 10.6)) }
    const marker: Marker = {
      id: newMarkerId(ctx, 'hie-rm'),
      kind: 'equipment',
      pos,
      owner: op.seat,
      carriedBy: null,
      controller: null,
      equipmentId: M.reanimation,
      placedBy: op.id,
    }
    s.markers.push(marker)
    op.returnable = true
    ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos }, op.seat)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'hie.a.reanimation-protocols', detail: marker.id }, op.seat)
    // tokens it held and tokens it placed go when markers.ts processes the removal; timed effects go now
    removeEffects(ctx, (e) => e.operativeId === op.id)
    return null
  },
  'hie.reanimationMark',
)

/** Legal set-up spots within 3" of the marker and outside every enemy control range (T-HIE.26). */
export function reanimationSpots(state: GameState, op: Operative, marker: Marker, max = 12): Vec3[] {
  const reach = 3 + op.baseRadius + MARKER_R
  return placementSpots(state, op, {
    around: marker.pos,
    radius: reach,
    max,
    step: 0.5,
    test: (pos) => enemiesInControlRange(state, { id: op.id, pos, baseRadius: op.baseRadius, height: op.height }, op.seat).length === 0,
  })
}

function nearestEnemyGap(state: GameState, op: Operative, pos: Vec3): number {
  let best = Infinity
  for (const e of enemiesOf(state, op)) best = Math.min(best, Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z))
  return best
}

/** The engine's own pick when no player decision exists (the Ready step): the legal spot farthest from every enemy. */
function bestSpot(state: GameState, op: Operative, marker: Marker): Vec3 | null {
  const spots = reanimationSpots(state, op, marker, 400)
  let best: Vec3 | null = null
  let bd = -Infinity
  for (const p of spots) {
    const d = nearestEnemyGap(state, op, p)
    if (d > bd + 1e-9) {
      bd = d
      best = p
    }
  }
  return best
}

/** Bring the operative tied to a marker back: 1 wound, the chosen order, ready unless it was already expended this turning point. */
export function reanimate(ctx: Ctx, markerId: string, o: { pos?: Vec3; order?: Order } = {}): boolean {
  const s = ctx.state
  const marker = s.markers.find((m) => m.id === markerId && m.equipmentId === M.reanimation)
  const op = marker?.placedBy ? s.operatives[marker.placedBy] : undefined
  if (!marker || !op || op.status === 'active') return false
  const pos = o.pos ?? bestSpot(s, op, marker)
  if (!pos) return false
  // a chosen spot must lie within 3" of the marker and outside every enemy control range
  if (o.pos) {
    const reach = 3 + op.baseRadius + MARKER_R
    if (Math.hypot(pos.x - marker.pos.x, pos.z - marker.pos.z) > reach + 1e-6) return false
    if (enemiesInControlRange(s, { id: op.id, pos, baseRadius: op.baseRadius, height: op.height }, op.seat).length > 0) return false
  }
  const expendedAt = s.ledger[op.seat].uses[`hie.expended:${op.id}`] ?? 0
  const expended = expendedAt === s.turningPoint && s.phase === 'firefight'
  if (!returnToKillzone(ctx, op.id, { pos, order: o.order ?? 'engage', wounds: 1, ready: !expended, kind: 'reanimated' })) return false
  op.returnable = false
  removeMarker(ctx, marker.id, 'reanimated')
  markUsedTp(s, op.seat, `hie.reanimated:${op.id}`)
  ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'hie.a.reanimation-protocols', detail: 'reanimated' }, op.seat)
  return true
}

// ---------------------------------------------------------------------------
// The Ready step (T-HIE.25, T-HIE.29, T-HIE.40): Living Metal, Reanimation Protocols, then the Tesseract Cube
// ---------------------------------------------------------------------------

// Living Metal and the Tesseract Cube need no decision and run in the turningPoint.start hook. The Reanimation roll is
// the owner's: the provider's readyStepChoices offers each marker not yet tried this turning point (the shared Ready-step
// choice), and a 3+ asks for the spot and the order (hieReanimate's choice with context.ready). The Cube is rolled
// before those choices: its "not REANIMATED this TP" test gives the same answer there, because a Ready-step return only
// brings back an operative that was not in the killzone, and the Cube needs its Cryptek in the killzone.
const READY_DONE = 'hie.readyReanimated'
const readyTried = (markerId: string): string => `hie.readyTried:${markerId}`

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    const s = ctx.state
    for (const seat of SEATS) {
      if (s.players[seat].teamId !== TEAM_ID) continue
      livingMetal(ctx, seat)
      tesseractCube(ctx, seat)
    }
    return null
  },
  'hie.readyStep',
)

function livingMetal(ctx: Ctx, seat: Seat): void {
  const hurt = hieOps(ctx.state, seat).filter((o) => o.wounds < o.maxWounds)
  if (hurt.length === 0) return
  const dice = ctx.roll('hie.livingMetal', hurt.length)
  hurt.forEach((o, i) => regainWounds(ctx, o.id, d3(dice[i]!) + 1, 'hie.a.living-metal'))
}

/** How much the owner is likely to want an operative back (the order the Ready-step offers are listed in, best first):
 * the Cryptek, then the Apprentek, then the operative with the most starting wounds. */
function returnPriority(state: GameState, opId: string | undefined): number {
  const op = opId ? state.operatives[opId] : undefined
  if (!op) return 0
  return (has(state, op, 'CRYPTEK') ? 1000 : 0) + (has(state, op, 'APPRENTEK') ? 500 : 0) + op.maxWounds
}

/** The Reanimation markers the owner may still pick in this Ready step (T-HIE.25): none once one operative returned. */
function readyMarkers(state: GameState, seat: Seat): Marker[] {
  if (state.players[seat].teamId !== TEAM_ID || state.phase !== 'strategy' || usedThisTp(state, seat, READY_DONE)) return []
  return markersOf(state, seat, M.reanimation)
    .map((m, i) => ({ m, i, p: returnPriority(state, m.placedBy ?? undefined) }))
    .filter((x) => !!x.m.placedBy && !!state.operatives[x.m.placedBy] && !usedThisTp(state, seat, readyTried(x.m.id)))
    .sort((x, y) => y.p - x.p || x.i - y.i)
    .map((x) => x.m)
}

/** The picked marker's D6 (T-HIE.25): on a 3+ with room to set up, the owner picks the spot and the order (T-HIE.26). */
function readyRoll(ctx: Ctx, tied: Operative, markerId: string): void {
  const s = ctx.state
  const seat = tied.seat
  markUsedTp(s, seat, readyTried(markerId))
  const marker = s.markers.find((m) => m.id === markerId && m.equipmentId === M.reanimation)
  if (!marker) return readyChoiceDone(ctx)
  const [r] = ctx.roll('hie.reanimation', 1)
  // no legal set-up counts as a 1-2: the marker stays and another may be picked
  const spots = r! >= 3 ? reanimationSpots(s, tied, marker, 8) : []
  ctx.emit({ type: 'AbilityUsed', operativeId: tied.id, abilityId: 'hie.a.reanimation-protocols', detail: spots.length > 0 ? 'roll' : 'failed' }, seat)
  if (spots.length === 0) return readyChoiceDone(ctx)
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'turningPoint.start',
    context: { hook: 'hieReanimate', operativeId: tied.id, markerId: marker.id, step: 'spot', ready: true },
    options: spots.map((p) => choiceOpt(`${p.x},${p.y},${p.z}`, 'reanimate.spot', { ...p })),
    canPass: false,
  })
}

function tesseractCube(ctx: Ctx, seat: Seat): void {
  const s = ctx.state
  if (!equipped(s, seat, E.cube) || usedThisBattle(s, seat, 'hie.cubeOff')) return
  const cryptek = hieOps(s, seat).find((o) => has(s, o, 'CRYPTEK'))
  if (!cryptek || inCr(s, cryptek) || s.ledger[seat].tp.includes(`hie.reanimated:${cryptek.id}`)) return
  const [r] = ctx.roll('hie.tesseractCube', 1)
  if (r === 1) {
    markUsedBattle(s, seat, 'hie.cubeOff')
    return
  }
  if (r! < 4) return
  gainCp(ctx, seat, 1, E.cube)
  addUse(s, seat, 'hie.cubeGiven')
  if (usesOf(s, seat, 'hie.cubeGiven') >= 2) markUsedBattle(s, seat, 'hie.cubeOff')
}

// ---------------------------------------------------------------------------
// Tokens that end with an activation, markers that end with theirs
// ---------------------------------------------------------------------------

// "When this operative next activates": markers it placed go, and a Madness token on it is spent.
registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const op = ctx && c.operativeId ? ctx.state.operatives[c.operativeId] : undefined
    if (!ctx || !op) return null
    for (const m of [...ctx.state.markers]) {
      if (m.placedBy === op.id && (m.equipmentId === M.nanomine || m.equipmentId === M.despair)) removeMarker(ctx, m.id, 'source activated')
    }
    if (tokensOn(ctx.state, op.id).some((t) => t.kind === T.madness)) removeToken(ctx, op.id, T.madness, 'activated')
    return null
  },
  'hie.activationStart',
)

// ---------------------------------------------------------------------------
// After an action ends: Interstitial Command history, Tesla Weave
// ---------------------------------------------------------------------------

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as { action: string; counteract: boolean; free: boolean } | undefined
    if (!ctx || !s || !op || !d) return null
    // a free action handed out by Interstitial Command cannot be repeated this turning point (T-HIE.6)
    if (s.firefight.activation?.frame?.data?.hieIc === true) markUsedTp(s, op.seat, `hie.ic:${op.id}:${d.action}`)
    // Tesla Weave (T-HIE.41): an enemy that ends a Charge in a Hierotek Circle operative's control range
    if (d.action === 'charge' && !isHie(s, op)) {
      const owner = otherSeat(op.seat)
      if (equipped(s, owner, E.weave) && tpUsesOf(s, owner, E.weave) < 1) {
        const near = enemiesInControlRange(s, op, op.seat).filter((e) => isHie(s, e))
        if (near.length > 0) {
          addTpUse(s, owner, E.weave)
          const [r] = ctx.roll('hie.teslaWeave', 1)
          ctx.emit({ type: 'AbilityUsed', operativeId: near[0]!.id, abilityId: E.weave, detail: op.id }, owner)
          directDamage(ctx, op.id, d3(r!) + 1, near[0]!.id, E.weave)
        }
      }
    }
    return null
  },
  'hie.actionEnded',
)

// ---------------------------------------------------------------------------
// After a Shoot: Deathmarked, Magnification Conduits
// ---------------------------------------------------------------------------

registerHook(
  'afterShootResolved',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as { targets: string[]; incapacitated: string[] } | undefined
    if (!ctx || !s || !op || !d || !isHie(s, op)) return null
    if (hasAbility(s, op, 'hie.a.deathmarked')) {
      const primary = d.targets[0] ? s.operatives[d.targets[0]] : undefined
      if (primary && primary.status === 'active' && primary.wounds > 0 && !d.incapacitated.includes(primary.id)) {
        addToken(ctx, primary.id, { kind: T.deathmarked, owner: op.seat, sourceId: op.id }, 'deathmarked')
      }
    }
    // the Conduits are spent when a proxy that is not an Apprentek or Cryptek was used
    const vp = s.attack?.viewpointId ? s.operatives[s.attack.viewpointId] : undefined
    if (vp && !has(s, vp, 'CRYPTEK') && !has(s, vp, 'APPRENTEK')) addTpUse(s, op.seat, E.conduits)
    return null
  },
  'hie.afterShoot',
)

// ---------------------------------------------------------------------------
// Magnify (T-HIE.28, T-HIE.38)
// ---------------------------------------------------------------------------

function magnifyConditionsFromProxy(state: GameState): boolean {
  const p = paramsOfAbility(state, 'hie.a.wr-magnify')
  return p.conditionsFromProxy !== false
}

function paramsOfAbility(state: GameState, id: string): Record<string, unknown> {
  const def = state.data.abilities[id]
  return def ? paramsOf(def, 'magnify') : {}
}

function hasMagnifyWeapon(state: GameState, op: Operative): boolean {
  return op.weapons.some((w) => state.data.weapons[w]?.type === 'ranged' && weaponHas(state, w, 'magnify'))
}

/** Friendly operatives that may stand in for the shooter as the viewpoint (Engage, outside enemy CR, seen by the shooter). */
export function magnifyProxies(state: GameState, shooter: Operative): Operative[] {
  if (!isHie(state, shooter)) return []
  const conduits = equipped(state, shooter.seat, E.conduits) && tpUsesOf(state, shooter.seat, E.conduits) < 1
  const out: Operative[] = []
  for (const f of friendsOf(state, shooter)) {
    if (!isHie(state, f) || f.order !== 'engage' || inCr(state, f) || !sees(state, shooter, f)) continue
    const core = has(state, f, 'CRYPTEK') || has(state, f, 'APPRENTEK')
    if (core || (conduits && !has(state, f, 'PLASMACYTE'))) out.push(f)
  }
  return out
}

// ---------------------------------------------------------------------------
// Attack-sequence hooks
// ---------------------------------------------------------------------------

/** Nightmare Shroud (T-HIE.12): is the operative an enemy within 4" of a holder of the token? */
function shroudAffects(state: GameState, op: Operative): boolean {
  for (const h of Object.values(state.operatives)) {
    if (h.status !== 'active' || h.seat === op.seat || !h.tokens || !h.tokens.some((t) => t.kind === T.shroud)) continue
    if (dist(op, h) <= 4 + 1e-6) return true
  }
  return false
}

/** Scuttler (T-HIE.17): on Conceal and in cover it cannot be picked, whatever else applies (Seek, Vantage), except by a
 * shooter within 2". With Magnify the proxy is the active operative for cover and that 2" (designer's commentary). */
function scuttlerFilter(s: GameState, op: Operative, data: BeforeShootTargetSelectData): void {
  if (data.secondary) return
  const a = s.attack
  const vp = a && a.kind === 'shoot' && a.operativeId === op.id && a.viewpointId ? s.operatives[a.viewpointId] : undefined
  const from = bodyOf(vp ?? op)
  for (let i = data.candidates.length - 1; i >= 0; i--) {
    const t = s.operatives[data.candidates[i]!]
    if (!t || !hasAbility(s, t, 'hie.a.scuttler') || t.order !== 'conceal') continue
    const v = targetVerdict(s, from, { ...bodyOf(t), order: t.order })
    if (v.inCover && !v.within2) data.candidates.splice(i, 1)
  }
}

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as unknown as BeforeShootTargetSelectData
    if (!s || !op) return null
    addHieCandidates(s, op, data)
    // last, so no rule of this team that adds candidates (Deathmarked Seek) can bring a Scuttler back
    scuttlerFilter(s, op, data)
    return null
  },
  'hie.beforeShootTargetSelect',
)

function addHieCandidates(s: GameState, op: Operative, data: BeforeShootTargetSelectData): void {
  if (data.secondary || !isHie(s, op) || op.status !== 'active') return
  const rules = ruleSetFor(s, op, data.weaponId, 'shoot')
  const weapon = s.data.weapons[data.weaponId]
  if (weapon?.type !== 'ranged') return
  const sb = bodyOf(op)
  const addable = (e: Operative): boolean =>
    e.status === 'active' && e.wounds > 0 && !data.candidates.includes(e.id) && (rules.range === null || isWithin(sb, bodyOf(e), rules.range)) && enemiesInControlRange(s, e, e.seat).length === 0
  // Deathmarked (T-HIE.21): a Deathmark shooting a marked enemy has Seek, applied when validity is checked
  if (has(s, op, 'DEATHMARK')) {
    for (const e of enemiesOf(s, op)) {
      if (!hasToken(s, e.id, T.deathmarked, op.seat) || !addable(e)) continue
      if (targetVerdict(s, sb, { ...bodyOf(e), order: e.order }).visible) data.candidates.push(e.id)
    }
  }
  // Magnify (T-HIE.28): targets only a proxy can pick come from the proxy viewpoints themselves (shoot.ts
  // shootAvailability and raiseWeapon ask providerViewpoints), so nothing is added to the shooter's own list here
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    if (!s || !op || !c.weaponId) return null
    const weapon = s.data.weapons[c.weaponId]
    if (!weapon) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const hasRule = (name: string): boolean => data.rules.some((r) => r.rule === name)
    const hie = isHie(s, op)
    const atk = s.attack
    // Dimensional Ambush: the order changes to Engage when the interrupt starts (T-HIE.37)
    const frame = s.firefight.activation
    if (c.engine && frame?.frame?.kind === 'interrupt' && frame.operativeId === op.id && op.order === 'conceal' && effectOn(s, P.ambush, op.seat, op.id)) {
      op.order = 'engage'
      c.engine.emit({ type: 'OrderSet', operativeId: op.id, order: 'engage' }, op.seat)
    }
    if (data.kind === 'shoot' && hie) {
      // Magnify through a proxy gives Ceaseless for the action
      if (hasRule('magnify') && atk?.kind === 'shoot' && atk.operativeId === op.id && atk.weaponId === c.weaponId && atk.viewpointId && !hasRule('ceaseless')) {
        data.rules.push({ rule: 'ceaseless' })
        markFired('magnify')
      }
      if (target && weapon.type === 'ranged') {
        // Deathmarked: Seek against a marked enemy
        if (has(s, op, 'DEATHMARK') && hasToken(s, target.id, T.deathmarked, op.seat) && !hasRule('seek')) data.rules.push({ rule: 'seek' })
        // Relentless Onslaught: Balanced within 8" of the real shooter
        if (effectOn(s, P.relentless, op.seat) && dist(op, target) <= 8 + 1e-6 && !hasRule('balanced')) data.rules.push({ rule: 'balanced' })
      }
    }
    // Living Lightning: the carbine trades its 2" Devastating for Blast 2"
    if (c.weaponId === TESLA_CARBINE && data.kind === 'shoot' && effectOn(s, P.lightning, op.seat, op.id)) {
      for (const r of data.rules) if (r.rule === 'devastating' && r.inches !== undefined) delete r.inches
      if (!hasRule('blast')) data.rules.push({ rule: 'blast', inches: 2 })
    }
    // Methodical Elimination: Accurate 1, or 2 when stationary-ish or retaliating
    if (data.kind === 'fight' && hie && weapon.type === 'melee' && effectOn(s, P.methodical, op.seat)) {
      const retaliating = atk?.kind === 'fight' && atk.operativeId !== op.id
      const steady = (op.movedThisActivation ?? 0) <= effectiveMove(op, s) + 1e-6
      data.rules.push({ rule: 'accurate', x: retaliating || steady ? 2 : 1 })
    }
    // Augment Weapon: two extra rules on the chosen weapon (T-HIE.15)
    const aug = tokensOn(s, op.id).find((t) => t.kind === T.augment)
    if (aug && ((aug.data?.weaponIds as string[] | undefined) ?? []).includes(c.weaponId)) {
      for (const name of (aug.data?.rules as string[] | undefined) ?? []) {
        if (hasRule(name)) continue
        data.rules.push(name === 'lethal' ? { rule: 'lethal', target: 5 } : { rule: name })
      }
    }
    // Nightmare Shroud: nothing below 6 becomes a critical success for an enemy within 4" (T-HIE.12)
    if (shroudAffects(s, op)) {
      for (let i = data.rules.length - 1; i >= 0; i--) if (['lethal', 'rending', 'severe'].includes(data.rules[i]!.rule)) data.rules.splice(i, 1)
    }
    return null
  },
  'hie.modifyWeaponRules',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { atk: number; lethal: number | null }
    if (!s || !op) return null
    // Chronometron: 1 less Atk against the picked operative, whoever attacks (floor 1, RULING)
    const foe = c.targetId ? s.operatives[c.targetId] : undefined
    if (foe && data.atk > 1 && hasToken(s, foe.id, T.chronometron)) {
      data.atk -= 1
      markFired('hieSupport')
    }
    if (shroudAffects(s, op)) {
      data.lethal = null
      markFired('hieShroud')
    }
    return null
  },
  'hie.modifyAttackDice',
)

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const attacker = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { dice: number }
    if (!s || !op || !attacker || !c.weaponId || !has(s, op, 'CRYPTEK') || !equipped(s, op.seat, E.shifter)) return null
    // Phase Shifter (T-HIE.39): once per turning point the attacker's Piercing (and Piercing Crits) is 1 worse
    const rules = ruleSetFor(s, attacker, c.weaponId, 'shoot', op.id)
    const crit = s.attack?.seq?.critRetained === true
    const piercing = rules.piercing > 0 ? 1 : 0
    const piercingCrits = crit && rules.piercingCrits > 0 ? 1 : 0
    if (piercing + piercingCrits === 0) return null
    const live = effectOn(s, E.shifter, op.seat, op.id)
    if (!live) {
      if (tpUsesOf(s, op.seat, E.shifter) >= 1) return null
      if (c.engine) {
        addTpUse(s, op.seat, E.shifter)
        addEffect(c.engine, { source: E.shifter, seat: op.seat, kind: 'equipment', operativeId: op.id, expires: 'action' })
        c.engine.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: E.shifter }, op.seat)
      }
    }
    data.dice += piercing + piercingCrits
    return null
  },
  'hie.modifyDefenceDice',
)

registerHook(
  'afterDefenceRoll',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { kind: 'shoot' | 'fight'; dice: { value: number | null; kind: 'fail' | 'normal' | 'crit'; rerolled: boolean; tag?: string; used?: boolean }[] }
    if (!s || !op || data.kind !== 'shoot' || !isHie(s, op) || !effectOn(s, P.undying, op.seat)) return null
    // Undying Androids (T-HIE.31): when no cover save could have been retained, keep one die without rolling it
    const a = s.attack
    const seq = a?.seq
    const attacker = a ? s.operatives[a.operativeId] : undefined
    if (!a || !seq || !attacker || !a.weaponId) return null
    const rules = ruleSetFor(s, attacker, a.weaponId, 'shoot', op.id)
    if (seq.cover && !rules.saturate && seq.collected >= 1) return null
    // one die is kept as a normal success instead of being rolled: the dice are independent, so turning the last
    // die rolled into an unrolled normal success (whatever it showed) is the same as rolling one die fewer
    const rolled = data.dice.filter((d) => d.value !== null && !d.used && d.tag !== 'undying')
    if (data.dice.some((d) => d.tag === 'undying')) return null
    const f = rolled[rolled.length - 1]
    if (!f) return null
    f.value = null
    f.kind = 'normal'
    f.rerolled = false
    f.tag = 'undying'
    markFired('hieUndying')
    c.engine?.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: P.undying }, op.seat)
    return null
  },
  'hie.afterDefenceRoll',
)

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as unknown as OnDamageInflictedData
    if (!s || !op || data.amount < 3 || !['normal', 'crit', 'strike-normal', 'strike-crit'].includes(data.source)) return null
    // Reinforce Metal: an attack die of 3+ damage deals 1 less; Devastating is not an attack die (R-5.15)
    if (hasToken(s, op.id, T.reinforce)) {
      data.amount -= 1
      markFired('hieSupport')
    }
    return null
  },
  'hie.onDamageInflicted',
)

// MULTI-DIMENSIONAL VISION: enemies the Deathmark shoots cannot be obscured
registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { obscured: boolean }
    if (!s || !shooter || !data.obscured) return null
    if (effectOn(s, A.vision, shooter.seat, shooter.id)) {
      data.obscured = false
      markFired('hieVision')
    }
    return null
  },
  'hie.targetStatus',
)

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

/** The Cryptek of the roster (alive or not): its unique actions are the Apprentek's (T-HIE.20). */
function rosterCryptek(state: GameState, seat: Seat): Operative | undefined {
  return Object.values(state.operatives).find((o) => o.seat === seat && has(state, o, 'CRYPTEK'))
}

function cryptekActionIds(state: GameState, seat: Seat): string[] {
  const c = rosterCryptek(state, seat)
  return c ? [...(state.data.datacards[c.datacardId]?.uniqueActions ?? [])] : []
}

function despairNear(state: GameState, op: Operative): boolean {
  return state.markers.some((m) => m.equipmentId === M.despair && m.owner !== op.seat && gapToMarker(bodyOf(op), m) <= 2 + 1e-6)
}

registerTeamRules({
  id: TEAM_ID,

  // Reanimation Protocols (T-HIE.25): the owner picks the marker to roll for, one at a time, until one returns
  readyStepChoices(state, seat): ReactionOffer[] {
    return readyMarkers(state, seat).map((m) => {
      const tied = state.operatives[m.placedBy!]!
      return { hook: 'hieReanimate', operativeId: tied.id, option: m.id, labelKey: 'hie.reanimationRoll', data: { markerId: m.id, name: `Reanimation Protocols: roll for ${tied.name}` } }
    })
  },

  actionForbidden(state, op, actionId) {
    // Scuttler: only its own unique action (mission actions and markers are not unique actions)
    if (actionId.startsWith('ability:') && hasAbility(state, op, 'hie.a.scuttler')) {
      const id = actionId.slice('ability:'.length)
      const def = state.data.abilities[id]
      const own = state.data.datacards[op.datacardId]?.uniqueActions.includes(id) ?? false
      if (!own && !(def?.keywords ?? []).includes('MISSION')) {
        return `${op.name} can perform no unique action but its own`
      }
    }
    // Interstitial Command: an action done through it cannot be done again this turning point
    if (usedThisTp(state, op.seat, `hie.ic:${op.id}:${actionId}`)) return `${op.name} already did that through Interstitial Command this turning point`
    // Apprentek Assistance: one Cryptek unique action per turning point
    if (actionId.startsWith('ability:') && hasAbility(state, op, 'hie.a.apprentek-assistance') && cryptekActionIds(state, op.seat).includes(actionId.slice(8))) {
      const mine = new Set(cryptekActionIds(state, op.seat).map((id) => `ability:${id}`))
      if ((op.actionsThisTp ?? []).some((a) => mine.has(a))) return 'the Apprentek performs one Cryptek action per turning point'
    }
    return null
  },

  actionCostDelta(state, op, actionId) {
    let d = 0
    if (actionId === 'fallBack' && hasAbility(state, op, 'hie.a.scuttler')) d -= 1
    // Despair: Pick Up Marker and mission actions cost an enemy 1 more AP within 2" of the marker
    if (despairNear(state, op)) {
      if (actionId === 'marker:pickUp') d += 1
      else if (actionId.startsWith('ability:') && (state.data.abilities[actionId.slice(8)]?.keywords ?? []).includes('MISSION')) d += 1
    }
    return d
  },

  extraActions(state, op) {
    return hasAbility(state, op, 'hie.a.apprentek-assistance') ? cryptekActionIds(state, op.seat) : []
  },

  equipmentEligible(state, op) {
    return hasAbility(state, op, 'hie.a.scuttler') ? false : null
  },

  moveDelta(state, op) {
    let d = 0
    for (const m of state.markers) if (m.equipmentId === M.nanomine && m.owner !== op.seat && gapToMarker(bodyOf(op), m) <= 4 + 1e-6) d -= 2
    return d
  },

  shootViewpoints(state, shooter, weaponId) {
    if (!weaponHas(state, weaponId, 'magnify')) return []
    return magnifyProxies(state, shooter).map((p) => p.id)
  },

  shootUnderConceal(state, op) {
    if (op.flags.guard && effectOn(state, P.ambush, op.seat, op.id)) return true
    return op.order === 'conceal' && isHie(state, op) && magnifyConditionsFromProxy(state) && hasMagnifyWeapon(state, op) && magnifyProxies(state, op).length > 0
  },

  shootInControlRange(state, op) {
    if (!(isHie(state, op) && magnifyConditionsFromProxy(state) && hasMagnifyWeapon(state, op) && inCr(state, op) && magnifyProxies(state, op).length > 0)) return false
    // the proxy supplies the Shoot conditions only for a shot taken through it: once the Shoot is under way,
    // a weapon picked without a viewpoint (the plain weapon list) gets no exemption from the control-range ban
    const a = state.attack
    if (a && a.kind === 'shoot' && a.operativeId === op.id && !a.viewpointId) return false
    return true
  },

  guardUnderConceal(state, op) {
    return effectOn(state, P.ambush, op.seat, op.id)
  },

  controlApl(state, op) {
    return hasAbility(state, op, 'hie.a.steadfast') ? 3 : null
  },

  controlTotal(state, seat, marker, total, contesting) {
    let v = total
    // Despair: -1 to the enemy's total when a contesting operative stands within 2" of the Despair marker
    for (const d of state.markers) {
      if (d.equipmentId !== M.despair || d.owner === seat) continue
      if (contesting.some((id) => state.operatives[id] && gapToMarker(bodyOf(state.operatives[id]!), d) <= 2 + 1e-6)) {
        v -= 1
        break
      }
    }
    // Reanimated Function: a Reanimation marker counts as a friendly operative with APL 1 for markers within 1"
    if (marker.equipmentId !== M.reanimation) {
      for (const e of state.effects) {
        if (e.source !== P.function || e.seat !== seat) continue
        const rm = state.markers.find((m) => m.id === e.data?.markerId)
        if (rm && baseGap2D(rm.pos, MARKER_R, marker.pos, markerBody(marker).baseRadius) <= 1 + 1e-6) {
          v += 1
          markFired('hieReanimatedFunction')
        }
      }
    }
    return Math.max(0, v)
  },

  gateActivation(ctx, op) {
    const tok = tokensOn(ctx.state, op.id).find((t) => t.kind === T.madness && t.owner !== op.seat)
    if (!tok) return false
    const [r] = ctx.roll('hie.madness', 1)
    if (r! >= effectiveApl(op)) {
      markFired('hieMadness')
      return true
    }
    removeToken(ctx, op.id, T.madness, 'activated')
    return false
  },

  rerollsBanned(state, side, attack) {
    const subject = state.operatives[side.operativeId]
    if (!subject) return false
    // in a Shoot only the shooter's dice are attack dice; in a fight both fighters' dice are
    if (attack.kind === 'shoot' && side.operativeId !== attack.operativeId) return false
    if (!shroudAffects(state, subject)) return false
    markFired('hieShroud')
    return true
  },
})

// ---------------------------------------------------------------------------
// Picking friendly operatives for SUPPORT actions (distance, visibility, Comms Device, Cortical Control)
// ---------------------------------------------------------------------------

interface Pick {
  id: string
  /** the pick needs Cortical Control: only visibility holds, the distance does not */
  cortical: boolean
}

function corticalReady(state: GameState, op: Operative): boolean {
  const ploy = state.data.ploys?.[P.cortical]
  if (!ploy || !(has(state, op, 'CRYPTEK') || has(state, op, 'APPRENTEK'))) return false
  return !usedThisTp(state, op.seat, ploy.id) && state.players[op.seat].cp >= ploy.cost
}

function payCortical(ctx: Ctx, op: Operative): void {
  const ploy = ctx.state.data.ploys?.[P.cortical]
  if (!ploy) return
  spendCp(ctx, op.seat, ploy.cost, ploy.id)
  markUsedTp(ctx.state, op.seat, ploy.id)
  ctx.emit({ type: 'PloyUsed', ployId: ploy.id }, op.seat)
  markFired('hieCortical')
}

function friendPicks(
  state: GameState,
  op: Operative,
  o: { range: number; support: boolean; selfOk: boolean; ok: (f: Operative) => boolean; relay: boolean; cortical: boolean },
): Pick[] {
  const reach = o.range + (o.support ? commsFor(state, op) : 0)
  const cortical = o.cortical && corticalReady(state, op)
  const despoteks = o.relay ? friendsOf(state, op).filter((d) => has(state, d, 'DESPOTEK') && isHie(state, d) && sees(state, op, d)) : []
  const out: Pick[] = []
  const pool = [...(o.selfOk ? [op] : []), ...friendsOf(state, op)]
  for (const f of pool) {
    if (!isHie(state, f) || !o.ok(f)) continue
    if (f.id === op.id) {
      out.push({ id: f.id, cortical: false })
      continue
    }
    const direct = sees(state, op, f)
    const viaRelay = despoteks.filter((d) => d.id !== f.id && visible(state, bodyOf(d), bodyOf(f)))
    if ((direct && dist(op, f) <= reach + 1e-6) || viaRelay.some((d) => dist(d, f) <= reach + 1e-6)) out.push({ id: f.id, cortical: false })
    else if (cortical && (direct || viaRelay.length > 0)) out.push({ id: f.id, cortical: true })
  }
  return out
}

const seedFor = (p: Pick, extra: Record<string, unknown> = {}): OfferSeed => ({
  key: p.cortical ? `${p.id}:cc` : p.id,
  params: { targetId: p.id, ...(p.cortical ? { param: 'cc' } : {}), ...extra },
  ...(p.cortical ? { data: { cortical: true, cp: 1 } } : {}),
})

const choiceOpt = (id: string, labelKey: string, data?: Record<string, unknown>) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, ...(data ? { data } : {}) })

function activeTarget(ctx: Ctx, id: unknown): Operative | null {
  const t = typeof id === 'string' ? ctx.state.operatives[id] : undefined
  return t && t.status === 'active' ? t : null
}

const expiry = ['sourceNextActivation', 'sourceIncapacitated'] as const

// ---------------------------------------------------------------------------
// INTERSTITIAL COMMAND (T-HIE.6, T-HIE.7)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'hieInterstitial',
  action: {
    offers(state, op, def): OfferSeed[] {
      const p = paramsOf(def, 'hieInterstitial')
      const relay = p.relay === true
      return friendPicks(state, op, {
        range: 6,
        support: true,
        selfOk: false,
        relay,
        cortical: relay,
        ok: (f) => !has(state, f, 'CRYPTEK') && !has(state, f, 'APPRENTEK'),
      }).map((p2) => seedFor(p2))
    },
    perform(ctx, op, def, params) {
      const target = activeTarget(ctx, params.targetId)
      if (!target) {
        cancelAction(ctx)
        return
      }
      if (params.param === 'cc') payCortical(ctx, op)
      const deny = paramsOf(def, 'hieInterstitial').denyAccelerate === true ? { deny: [`ability:${A.accelerate}`] } : {}
      const started = startDelegatedAction(ctx, {
        operativeId: target.id,
        resume: 'hie.ic',
        rules: { oneApOnly: true, maxMove: 2, notDoneThisTp: true, ...deny },
        data: { hieIc: true, performerId: op.id },
      })
      if (!started) cancelAction(ctx)
    },
  },
})

// The picked operative's free action is over (or declined): the commander's action is spent.
registerFrameResume('hie.ic', (ctx, _outcome, data) => {
  const act = ctx.state.firefight.activation
  if (!act?.declared) return
  const performer = ctx.state.operatives[String(data.performerId)]
  if (performer) ctx.emit({ type: 'AbilityUsed', operativeId: performer.id, abilityId: 'hie.a.interstitial-command' }, performer.seat)
  finishAction(ctx)
})

// ---------------------------------------------------------------------------
// TIMESPLINTER (T-HIE.8)
// ---------------------------------------------------------------------------

/** Spots where an expended operative can be set up again: horizontally within 5" of the actor and visible to it. */
export function timesplinterSpots(state: GameState, actor: Operative, target: Operative, range = 5): Vec3[] {
  return placementSpots(state, target, {
    around: actor.pos,
    radius: range + actor.baseRadius + target.baseRadius,
    max: 12,
    test: (pos) => baseGap2D(actor.pos, actor.baseRadius, pos, target.baseRadius) <= range + 1e-6 && visible(state, bodyOf(actor), { ...bodyOf(target), pos }),
  })
}

registerCodeHook({
  name: 'hieTimesplinter',
  action: {
    offers(state, op, def): OfferSeed[] {
      if (usedThisTp(state, op.seat, 'hie.timesplinter')) return []
      const range = (paramsOf(def, 'hieTimesplinter').range as number | undefined) ?? 5
      return friendPicks(state, op, { range, support: false, selfOk: false, relay: false, cortical: false, ok: (f) => !f.ready })
        .filter((p) => timesplinterSpots(state, op, state.operatives[p.id]!, range).length > 0)
        .map((p) => seedFor(p))
    },
    perform(ctx, op, def, params) {
      const target = activeTarget(ctx, params.targetId)
      const range = (paramsOf(def, 'hieTimesplinter').range as number | undefined) ?? 5
      const spots = target ? timesplinterSpots(ctx.state, op, target, range) : []
      if (!target || spots.length === 0) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'hieTimesplinter', operativeId: op.id, abilityId: def.id, targetId: target.id },
        options: spots.map((p) => choiceOpt(`${p.x},${p.y},${p.z}`, 'timesplinter.land', { ...p })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const target = activeTarget(ctx, context.targetId)
    if (!target) {
      cancelAction(ctx)
      return
    }
    const [x, y, z] = option.split(',').map(Number) as [number, number, number]
    const from = { ...target.pos }
    target.pos = { x, y, z }
    target.facing = Math.atan2(x - from.x, z - from.z)
    markUsedTp(ctx.state, op.seat, 'hie.timesplinter')
    ctx.emit({
      type: 'OperativeMoved',
      operativeId: target.id,
      action: 'timesplinter',
      from,
      to: target.pos,
      segments: [{ from, to: target.pos, length: round3(Math.hypot(x - from.x, z - from.z)), cost: 0, kind: 'jump' }],
      cost: 0,
      maxInches: 0,
    })
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: target.id }, op.seat)
    finishAction(ctx)
  },
})

// ---------------------------------------------------------------------------
// COUNTERTEMPORAL NANOMINE and HARBINGER OF DESPAIR (T-HIE.9, T-HIE.11): one marker each, with an aura
// ---------------------------------------------------------------------------

/** Points a marker may be placed at: seen by the operative (or on a visible Vantage part) and within the range. */
export function markerSpots(state: GameState, op: Operative, range: number | null): Vec2[] {
  const out: Vec2[] = []
  const seen = new Set<string>()
  const probe = (p: Vec2, y: number) => ({ id: 'hie-probe', pos: { x: p.x, y, z: p.z }, baseRadius: 0.05, height: 0.05 })
  const add = (p: Vec2, y = op.pos.y) => {
    const q = { x: round3(p.x), z: round3(p.z) }
    const k = `${q.x},${q.z}`
    if (seen.has(k) || Math.abs(q.x) > 14.8 || Math.abs(q.z) > 10.8) return
    if (range !== null && Math.max(0, dist2(q, op.pos) - op.baseRadius) > range + 1e-6) return
    if (!visible(state, bodyOf(op), probe(q, y), { operativesBlock: false })) return
    seen.add(k)
    out.push(q)
  }
  for (const e of enemiesOf(state, op)) add(e.pos, e.pos.y)
  for (const m of state.markers) if (m.kind === 'objective') add(m.pos, 0)
  const rings = range === null ? [3, 6, 9, 12] : [2, 4, 6, 8].filter((d) => d <= range)
  for (const d of rings) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      add({ x: op.pos.x + Math.sin(a) * (d + op.baseRadius), z: op.pos.z + Math.cos(a) * (d + op.baseRadius) })
    }
  }
  // Vantage terrain of a visible feature: the middle of each Vantage part, at the height of its top
  for (const s of terrainOf(state.map).solids) {
    if (!s.vantage) continue
    add({ x: (s.bbox.minX + s.bbox.maxX) / 2, z: (s.bbox.minZ + s.bbox.maxZ) / 2 }, s.top - 0.05)
  }
  return out.slice(0, 28)
}

registerCodeHook({
  name: 'hieMarker',
  action: {
    offers(state, op, def): OfferSeed[] {
      const range = (paramsOf(def, 'hieMarker').range as number | null | undefined) ?? null
      return markerSpots(state, op, range).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const p = paramsOf(def, 'hieMarker')
      const spots = markerSpots(ctx.state, op, (p.range as number | null | undefined) ?? null)
      if (spots.length === 0) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'hieMarker', operativeId: op.id, abilityId: def.id, marker: p.marker },
        options: spots.map((q) => choiceOpt(`${q.x},${q.z}`, `marker.${String(p.marker)}`, { ...q })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    const equipmentId = context.marker === 'despair' ? M.despair : M.nanomine
    // one marker of each kind per player: placing again (by any friendly operative) moves it
    for (const m of markersOf(ctx.state, op.seat, equipmentId)) removeMarker(ctx, m.id, 'replaced')
    const marker: Marker = { id: newMarkerId(ctx, equipmentId === M.despair ? 'hie-dp' : 'hie-nm'), kind: 'equipment', pos: { x, z }, owner: op.seat, carriedBy: null, controller: null, equipmentId, placedBy: op.id }
    ctx.state.markers.push(marker)
    ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: { x, z } }, op.seat)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId) }, op.seat)
    finishAction(ctx)
  },
})

// ---------------------------------------------------------------------------
// Self and enemy tokens: NIGHTMARE SHROUD, VISION OF MADNESS (T-HIE.12, T-HIE.13)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'hieShroud',
  action: {
    offers: (): OfferSeed[] => [{ key: '', params: {} }],
    perform(ctx, op, def) {
      moveTokenTo(ctx, T.shroud, op.seat, op.id, { sourceId: op.id, expires: [...expiry] }, 'nightmareShroud')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'hieMadness',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => e.wounds > 0 && sees(state, op, e))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const target = activeTarget(ctx, params.targetId)
      if (!target || target.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      moveTokenTo(ctx, T.madness, op.seat, target.id, { sourceId: op.id, expires: [...expiry] }, 'visionOfMadness')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'hieVision',
  action: {
    offers: (): OfferSeed[] => [{ key: '', params: {} }],
    perform(ctx, op, def) {
      addEffect(ctx, { source: A.vision, seat: op.seat, kind: 'ability', operativeId: op.id, expires: `startOfActivation:${op.id}` })
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// SUPPORT actions that pick a friendly operative: CHRONOMETRON, REINFORCE METAL, CANOPTEK REPAIR, AUGMENT WEAPON,
// and ACCELERATE (T-HIE.10, 14, 15, 16, 18)
// ---------------------------------------------------------------------------

const AUGMENT_RULES = ['lethal', 'rending', 'saturate', 'severe'] as const
/** Staff of light and arcane conduit take the rules on one profile only (T-HIE.15). */
const SINGLE_PROFILE_GROUPS = new Set(['hie.wg.staff-of-light', 'hie.wg.arcane-conduit'])

/** The weapons printed on the datacard of an operative (equipment weapons are not on it). */
function cardWeapons(state: GameState, op: Operative): string[] {
  const card = state.data.datacards[op.datacardId]
  return op.weapons.filter((w) => card?.fixedWeapons.includes(w) || op.loadout.weaponIds.includes(w))
}

/** What Augment Weapon can pick on an operative: one option per weapon (a profile group counts once, except staff and conduit). */
export function augmentChoices(state: GameState, op: Operative): { id: string; weaponIds: string[] }[] {
  const out: { id: string; weaponIds: string[] }[] = []
  const seen = new Set<string>()
  for (const w of cardWeapons(state, op)) {
    const group = state.data.weapons[w]?.profileGroup
    if (group && !SINGLE_PROFILE_GROUPS.has(group)) {
      if (seen.has(group)) continue
      seen.add(group)
      out.push({ id: group, weaponIds: cardWeapons(state, op).filter((x) => state.data.weapons[x]?.profileGroup === group) })
    } else out.push({ id: w, weaponIds: [w] })
  }
  return out
}

registerCodeHook({
  name: 'hieSupport',
  action: {
    offers(state, op, def): OfferSeed[] {
      const p = paramsOf(def, 'hieSupport')
      const kind = String(p.kind)
      if (kind === 'repair' && usedThisTp(state, op.seat, 'hie.canoptek')) return []
      const anyKw = (p.anyKeyword as string[] | undefined) ?? null
      return friendPicks(state, op, {
        range: (p.range as number | undefined) ?? 6,
        support: p.support !== false,
        selfOk: p.selfOk === true,
        relay: false,
        cortical: p.support !== false,
        ok: (f) => (anyKw === null || anyKw.some((k) => has(state, f, k))) && (kind !== 'repair' || f.wounds < f.maxWounds) && (kind !== 'augment' || augmentChoices(state, f).length > 0),
      }).map((p2) => seedFor(p2))
    },
    perform(ctx, op, def, params) {
      const target = activeTarget(ctx, params.targetId)
      if (!target) {
        cancelAction(ctx)
        return
      }
      if (params.param === 'cc') payCortical(ctx, op)
      const kind = String(paramsOf(def, 'hieSupport').kind)
      const done = (detail?: string) => {
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: detail ?? target.id }, op.seat)
        finishAction(ctx)
      }
      switch (kind) {
        case 'chronometron':
          moveTokenTo(ctx, T.chronometron, op.seat, target.id, { sourceId: op.id, expires: [...expiry] }, 'chronometron')
          return done()
        case 'reinforce':
          moveTokenTo(ctx, T.reinforce, op.seat, target.id, { sourceId: op.id, expires: [...expiry] }, 'reinforceMetal')
          return done()
        case 'repair': {
          const dice = ctx.roll('hie.canoptekRepair', 2)
          markUsedTp(ctx.state, op.seat, 'hie.canoptek')
          regainWounds(ctx, target.id, d3(dice[0]!) + d3(dice[1]!), def.id)
          return done()
        }
        case 'accelerate':
          applyAplEffect(ctx, target.id, 1, def.id)
          return done()
        case 'augment': {
          const choices = augmentChoices(ctx.state, target)
          ctx.raise({
            kind: 'ability.choice',
            seat: op.seat,
            window: 'firefight.actionDeclared',
            context: { hook: 'hieSupport', operativeId: op.id, abilityId: def.id, step: 'weapon', targetId: target.id },
            options: choices.map((c) => choiceOpt(c.id, c.id, { weaponIds: c.weaponIds })),
            canPass: true,
          })
          return
        }
        default:
          cancelAction(ctx)
      }
    },
  },
  choice(ctx, op, option, context) {
    const target = activeTarget(ctx, context.targetId)
    if (!target) {
      cancelAction(ctx)
      return
    }
    if (context.step === 'weapon') {
      const picked = augmentChoices(ctx.state, target).find((c) => c.id === option)
      if (!picked) {
        cancelAction(ctx)
        return
      }
      const pairs: string[] = []
      for (let i = 0; i < AUGMENT_RULES.length; i++) for (let j = i + 1; j < AUGMENT_RULES.length; j++) pairs.push(`${AUGMENT_RULES[i]}+${AUGMENT_RULES[j]}`)
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { ...context, step: 'rules', weaponIds: picked.weaponIds },
        options: pairs.map((p) => choiceOpt(p, p)),
        canPass: true,
      })
      return
    }
    // the second step: two distinct rules; a later Augment Weapon by any friendly operative replaces this token
    const rules = option.split('+').filter((r) => (AUGMENT_RULES as readonly string[]).includes(r))
    moveTokenTo(ctx, T.augment, op.seat, target.id, { sourceId: op.id, expires: [...expiry], data: { weaponIds: context.weaponIds, rules } }, 'augmentWeapon')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: option }, op.seat)
    finishAction(ctx)
  },
})

// ---------------------------------------------------------------------------
// REANIMATE (T-HIE.19)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'hieReanimate',
  action: {
    offers(state, op, def): OfferSeed[] {
      const range = (paramsOf(def, 'hieReanimate').range as number | undefined) ?? 6
      const out: OfferSeed[] = []
      for (const m of markersOf(state, op.seat, M.reanimation)) {
        if (gapToMarker(bodyOf(op), m) > range + 1e-6 || !visible(state, bodyOf(op), markerBody(m))) continue
        const tied = m.placedBy ? state.operatives[m.placedBy] : undefined
        if (!tied) continue
        // 1 AP rolls for it; 2 AP is automatic and is only offered when the operative could be set up (RULING)
        out.push({ key: `${m.id}:1`, params: { markerId: m.id, param: '1' }, cost: 1 })
        if (reanimationSpots(state, tied, m, 1).length > 0) out.push({ key: `${m.id}:2`, params: { markerId: m.id, param: '2' }, cost: 2 })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const marker = s.markers.find((m) => m.id === params.markerId)
      const tied = marker?.placedBy ? s.operatives[marker.placedBy] : undefined
      if (!marker || !tied) {
        cancelAction(ctx)
        return
      }
      const fail = (detail: string) => {
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail }, op.seat)
        finishAction(ctx)
      }
      if (params.param === '1') {
        const [r] = ctx.roll('hie.reanimate', 1)
        if (r! < 3) return fail('failed')
      }
      const spots = reanimationSpots(s, tied, marker, 8)
      if (spots.length === 0) return fail('no room')
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'hieReanimate', operativeId: op.id, abilityId: def.id, markerId: marker.id, step: 'spot' },
        options: spots.map((p) => choiceOpt(`${p.x},${p.y},${p.z}`, 'reanimate.spot', { ...p })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    // the Ready-step Reanimation roll (provider readyStepChoices): `op` is the operative tied to the picked marker
    if (context.readyStep === true) {
      readyRoll(ctx, op, option)
      return
    }
    if (context.step === 'spot') {
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: context.ready === true ? 'turningPoint.start' : 'firefight.actionDeclared',
        context: { ...context, step: 'order', pos: option },
        options: [choiceOpt('engage', 'engage'), choiceOpt('conceal', 'conceal')],
        canPass: false,
      })
      return
    }
    const [x, y, z] = String(context.pos).split(',').map(Number) as [number, number, number]
    const back = reanimate(ctx, String(context.markerId), { pos: { x, y, z }, order: option === 'conceal' ? 'conceal' : 'engage' })
    if (context.ready === true) {
      // at most one Ready-step return each turning point; the Ready step's choices carry on
      if (back) markUsedTp(ctx.state, op.seat, READY_DONE)
      readyChoiceDone(ctx)
      return
    }
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: String(context.markerId) }, op.seat)
    finishAction(ctx)
  },
})

// ---------------------------------------------------------------------------
// Magnify (the team-local weapon rule; the proxy machinery is the provider and hooks above)
// ---------------------------------------------------------------------------

registerCodeHook({ name: 'magnify' })

// ---------------------------------------------------------------------------
// Ploys
// ---------------------------------------------------------------------------

const flagPloy = (name: string, expires: 'turningPoint' | 'activation' | 'action') =>
  registerCodeHook({
    name,
    ploy: {
      offers(state, seat, ploy, info): PloyOfferSeed[] {
        void state
        void seat
        void ploy
        void info
        return [{}]
      },
      apply(ctx, seat, ploy, _seed, info) {
        addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', ...(expires === 'turningPoint' ? {} : info.subjectId ? { operativeId: info.subjectId } : {}), expires })
      },
    },
  })

flagPloy('hieRelentless', 'turningPoint')
flagPloy('hieUndying', 'turningPoint')
flagPloy('hieMethodical', 'turningPoint')

// Living Lightning and Dimensional Ambush name their subject operative
registerCodeHook({
  name: 'hieLivingLightning',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      return op && op.seat === seat && isHie(state, op) && has(state, op, 'IMMORTAL') && op.weapons.includes(TESLA_CARBINE) ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'action' })
      markFired('hieLivingLightning')
    },
  },
})

registerCodeHook({
  name: 'hieAmbush',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      return op && op.seat === seat && isHie(state, op) && has(state, op, 'DEATHMARK') && op.order === 'conceal' && !info.counteracting ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      // lasts the turning point: the interrupt it enables happens in the enemy's activation (RULING)
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'turningPoint' })
    },
  },
})

// CORTICAL CONTROL is paid for inside the SUPPORT action offers (payCortical); the window never offers it
registerCodeHook({
  name: 'hieCortical',
  ploy: { offers: (): PloyOfferSeed[] => [], apply: () => undefined },
})

registerCodeHook({
  name: 'hieReanimatedFunction',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const out: PloyOfferSeed[] = []
      for (const m of markersOf(state, seat, M.reanimation)) {
        const near = state.markers.some((o) => o.id !== m.id && o.kind === 'objective' && baseGap2D(m.pos, MARKER_R, o.pos, markerBody(o).baseRadius) <= 1 + 1e-6)
        if (near) out.push({ param: m.id })
      }
      return out
    },
    apply(ctx, seat, ploy, seed) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPointStart', data: { markerId: seed.param } })
    },
  },
})

/** Operatives COMMAND UNDERLINGS sends dashing for each option (T-HIE.33). */
export function underlingsQueue(state: GameState, seat: Seat, option: 'cryptek' | 'apprentek'): string[] {
  const out = new Set<string>()
  const sources = hieOps(state, seat).filter((o) => has(state, o, option === 'cryptek' ? 'CRYPTEK' : 'APPRENTEK'))
  for (const src of sources) {
    const reach = (option === 'cryptek' ? 6 : 3) + commsFor(state, src)
    for (const f of friendsOf(state, src)) {
      if (!isHie(state, f) || (option === 'apprentek' && has(state, f, 'CRYPTEK'))) continue
      if (sees(state, src, f) && dist(src, f) <= reach + 1e-6) out.add(f.id)
    }
  }
  return [...out].sort()
}

registerCodeHook({
  name: 'hieUnderlings',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return (['cryptek', 'apprentek'] as const).filter((o) => underlingsQueue(state, seat, o).length > 0).map((o) => ({ param: o }))
    },
    apply(ctx, seat, _ploy, seed) {
      // the eligible operatives are fixed when the ploy is used; the player then picks who dashes next (or stops)
      underlingsNext(ctx, seat, underlingsQueue(ctx.state, seat, seed.param === 'apprentek' ? 'apprentek' : 'cryptek'))
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const remaining = ((context.remaining as string[] | undefined) ?? []).filter((id) => id !== option)
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    if (!startFreeAction(ctx, { operativeId: option, action: 'dash', resume: 'hie.underlings', data: { seat, remaining } })) underlingsNext(ctx, seat, remaining)
  },
})

/** Offer the next free Dash of COMMAND UNDERLINGS: any eligible operative not yet done, in the order the player picks. */
function underlingsNext(ctx: Ctx, seat: Seat, remaining: string[]): void {
  const s = ctx.state
  const live = remaining.filter((id) => {
    const o = s.operatives[id]
    return !!o && o.status === 'active' && !inCr(s, o)
  })
  if (live.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'hieUnderlings', operativeId: live[0], seat, remaining: live },
    options: [
      ...live.map((id) => choiceOpt(id, 'hie.underlings.dash', { name: s.operatives[id]!.name })),
      choiceOpt('done', 'hie.underlings.done'),
    ],
  })
}

registerFrameResume('hie.underlings', (ctx, _outcome, data) => underlingsNext(ctx, data.seat as Seat, (data.remaining as string[] | undefined) ?? []))
