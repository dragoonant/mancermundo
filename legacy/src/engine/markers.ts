// MRK: marker.* - Pick Up / Place Marker, contest and control by APL, carrying, and the rules that
// run after every accepted action: control changes, Mines, removals feeding the mission, and the
// activating operative being removed (R-4.5, R-4.6, R-5.18, R-8.5, R-8.6, M-5.2).
import { tokensOnRemoval } from './tokens'
import { placeMarkerFiltered, providerCheckMines, providerIgnoresMine, providerMarkerActionRelief, providerPlaceMarkerProblem } from './team-rules'
import { markerInControlRange, enemiesInControlRange } from './measure'
import { bodyOf } from './los'
import { footprintOf, pointGapToFootprint } from './footprint'
import { directDamage } from './effects'
import { afterActiveOperativeRemoved, cancelAction, finishAction } from './firefight'
import { registerHook } from './hooks'
import { markFired } from './code-hooks'
import { noteWeaponUses } from './equipment'
import { onOperativeRemoved } from './missions'
import { noteRemoval } from './kills'
import { markerControl } from './query'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { activeOps, getOp } from './state'
import { pointHandler } from './point-handlers'
import type { Activation, Marker, Operative, GameState, PendingDecision, Seat, TimingWindowId, Vec2, Vec3 } from './types'

/** Markers whose control matters and is tracked with ControlChanged events. */
export function tracksControl(m: Marker): boolean {
  return m.kind === 'objective' || m.equipmentId === 'core.e.comms-device' || m.equipmentId === 'core.e.ammo-cache'
}

export function newMarkerId(ctx: Ctx, prefix: string): string {
  return `${prefix}${ctx.state.nextEffect++}`
}

export function markerById(state: GameState, id: string): Marker | undefined {
  return state.markers.find((m) => m.id === id)
}

/** Objective markers in creation order. */
export function objectives(state: GameState): Marker[] {
  return state.markers.filter((m) => m.kind === 'objective')
}

export function removeMarker(ctx: Ctx, markerId: string, reason: string): void {
  const s = ctx.state
  const i = s.markers.findIndex((m) => m.id === markerId)
  if (i < 0) return
  s.markers.splice(i, 1)
  ctx.emit({ type: 'MarkerRemoved', markerId, reason }, null)
}

/** Markers the operative contests (in its control range, or the one it carries). */
export function contestedBy(state: GameState, op: Operative): Marker[] {
  return state.markers.filter((m) => markerControl(state, m).contesting[op.seat].includes(op.id))
}

/**
 * M9 batch C: markers an action that needs the operative to control them may use: the ones it controls, or the ones
 * it merely contests when a team rule says contesting suffices for that action (Poach). `actionId` is
 * `marker:pickUp` or `ability:<id>`.
 */
export function actionMarkers(state: GameState, op: Operative, actionId: string, filter?: (m: Marker) => boolean): Marker[] {
  if (!providerMarkerActionRelief(state, op, actionId).contestSuffices) return controlledBy(state, op, filter)
  return state.markers.filter((m) => (!filter || filter(m)) && markerControl(state, m).contesting[op.seat].includes(op.id))
}

/** Markers the operative's team controls and the operative itself contests. */
export function controlledBy(state: GameState, op: Operative, filter?: (m: Marker) => boolean): Marker[] {
  return state.markers.filter((m) => {
    if (filter && !filter(m)) return false
    const c = markerControl(state, m)
    return c.controller === op.seat && c.contesting[op.seat].includes(op.id)
  })
}

// ---------------------------------------------------------------------------
// Pick Up / Place Marker actions
// ---------------------------------------------------------------------------

export interface MarkerOffer {
  id: string
  action: string
  markerId: string
  cost: number
}

export const PICK_UP = 'marker:pickUp'
export const PLACE = 'marker:place'

/** Pick Up and Place Marker as options of a firefight.action decision (R-4.5, R-4.6). */
export function markerOffers(state: GameState, op: Operative, act: Activation | null): MarkerOffer[] {
  const out: MarkerOffer[] = []
  const carrying = op.flags.carrying
  const inCr = enemiesInControlRange(state, op, op.seat).length > 0
  const performed = act?.performed ?? []
  if (carrying) {
    const m = state.markers.find((x) => x.id === carrying)
    // batch C shared: a team spot filter (placeMarkerProblem) may leave nowhere to put it
    const placeable = !m || !placeMarkerFiltered() || placeMarkerSpots(state, op, m).length > 0
    if (!performed.includes(PICK_UP) && !performed.includes(PLACE) && placeable) out.push({ id: `${PLACE}:${carrying}`, action: PLACE, markerId: carrying, cost: 1 })
    return out
  }
  // M9 batch C: team relief (Light Fingers: an enemy in control range does not stop it; Poach: contesting suffices)
  const relief = providerMarkerActionRelief(state, op, PICK_UP)
  if ((inCr && !relief.ignoreEnemyControlRange) || performed.includes(PLACE) || performed.includes(PICK_UP)) return out
  for (const m of state.markers) {
    if (!m.pickable || m.carriedBy) continue
    // batch D prep: a marker only one seat may pick up (Bloody Cadaver)
    if (m.pickableBy && m.pickableBy !== op.seat) continue
    const c = markerControl(state, m)
    if (c.contesting[op.seat].includes(op.id) && (c.controller === op.seat || relief.contestSuffices)) {
      out.push({ id: `${PICK_UP}:${m.id}`, action: PICK_UP, markerId: m.id, cost: 1 })
    }
  }
  return out
}

/** Performed when the action is declared; Place Marker raises a position decision. */
export function performMarkerAction(ctx: Ctx, op: Operative, action: string, markerId: string): void {
  const s = ctx.state
  const m = markerById(s, markerId)
  if (!m) {
    cancelAction(ctx)
    return
  }
  if (action === PICK_UP) {
    m.carriedBy = op.id
    m.pos = { x: op.pos.x, z: op.pos.z }
    op.flags.carrying = m.id
    ctx.emit({ type: 'MarkerPickedUp', markerId: m.id, operativeId: op.id }, op.seat)
    finishAction(ctx)
    return
  }
  // batch C shared: with a team spot filter the decision lists the spots it accepts (bots pick from them)
  const spots = placeMarkerFiltered() ? placeMarkerSpots(s, op, m) : null
  if (spots && spots.length === 0) {
    cancelAction(ctx)
    return
  }
  ctx.raise({
    kind: 'marker.place',
    seat: op.seat,
    window: 'firefight.actionDeclared',
    context: { operativeId: op.id, markerId: m.id, maxDistance: 1, ...(spots ? { spots } : {}) },
    canPass: true,
  })
}

/**
 * batch C shared: sample spots within the operative's control range (1") a Place Marker of `marker` may use: the
 * centre first, then rings; those a team rule refuses (placeMarkerProblem) are left out.
 */
export function placeMarkerSpots(state: GameState, op: Operative, marker: Marker): Vec2[] {
  const fp = footprintOf(op)
  const out: Vec2[] = []
  const cands: Vec2[] = [{ x: op.pos.x, z: op.pos.z }]
  for (const d of [op.baseRadius + 0.5, op.baseRadius + 0.95]) {
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12
      cands.push({ x: Math.round((op.pos.x + Math.cos(a) * d) * 1000) / 1000, z: Math.round((op.pos.z + Math.sin(a) * d) * 1000) / 1000 })
    }
  }
  for (const c of cands) {
    if (pointGapToFootprint(c, fp) > 1 + 1e-6) continue
    if (providerPlaceMarkerProblem(state, op, marker, c)) continue
    out.push(c)
  }
  return out
}

/** Drop a carried marker where its carrier stands (an incapacitated carrier performs Place Marker first, R-4.6). */
export function dropCarried(ctx: Ctx, op: Operative): void {
  const id = op.flags.carrying
  if (!id) return
  const m = markerById(ctx.state, id)
  op.flags.carrying = null
  if (!m) return
  m.carriedBy = null
  m.pos = { x: op.pos.x, z: op.pos.z }
  ctx.emit({ type: 'MarkerPlaced', markerId: m.id, operativeId: op.id, pos: { ...m.pos } }, op.seat)
}

function handlePlace(state: GameState, action: { type: string; payload?: unknown }): Handled {
  const act = state.firefight.activation
  if (!act || !act.declared) return reject('E_WRONG_DECISION', 'no marker action is declared')
  const op = getOp(state, act.operativeId)
  if (action.type === 'pass') return { run: (ctx) => cancelAction(ctx) }
  if (action.type !== 'marker.place') return reject('E_WRONG_DECISION', 'expected a marker position')
  const p = action.payload as { x?: unknown; z?: unknown }
  if (typeof p.x !== 'number' || typeof p.z !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.z)) {
    return reject('E_SCHEMA', 'a marker position needs x and z')
  }
  const gap = pointGapToFootprint({ x: p.x, z: p.z }, footprintOf(op))
  if (gap > 1 + 1e-6) return reject('E_OUT_OF_RANGE', 'a marker is placed within the operative control range (1")')
  const id = op.flags.carrying
  if (!id) return reject('E_ACTION_RESTRICTED', 'the operative carries no marker')
  const carried = markerById(state, id)
  const refused = carried ? providerPlaceMarkerProblem(state, op, carried, { x: p.x, z: p.z }) : null
  if (refused) return reject('E_ACTION_RESTRICTED', refused)
  return {
    run(ctx) {
      const o = ctx.state.operatives[op.id]!
      const m = markerById(ctx.state, id)
      if (m) {
        m.carriedBy = null
        m.pos = { x: Math.round((action.payload as { x: number }).x * 1000) / 1000, z: Math.round((action.payload as { z: number }).z * 1000) / 1000 }
        ctx.emit({ type: 'MarkerPlaced', markerId: m.id, operativeId: o.id, pos: { ...m.pos } }, o.seat)
      }
      o.flags.carrying = null
      finishAction(ctx)
    },
  }
}

// ---------------------------------------------------------------------------
// M10 batch D shared: free-point decisions (any legal point, not sampled options): pre-battle Redeploy, Trip Alarm
// ---------------------------------------------------------------------------

// Handlers live in the leaf module point-handlers.ts so team files can register at import time without a TDZ cycle.
export { registerPointHandler, type PointHandler } from './point-handlers'

/**
 * Raise a free-point decision: kind `marker.place` (the client's free placement), payload `{ x, z }`, answered
 * anywhere `handler.problem` accepts. `spots` (sampled legal points) and `suggestion` are hints for bots and the UI;
 * `operativeId` names the operative it is about (Redeploy). A pass calls `done(ctx, seat, null)`.
 */
export function raisePointChoice(
  ctx: Ctx,
  o: { handler: string; seat: Seat; window?: TimingWindowId; context?: Record<string, unknown>; spots?: Vec2[]; suggestion?: Vec2; operativeId?: string; canPass?: boolean },
): void {
  ctx.raise({
    kind: 'marker.place',
    seat: o.seat,
    window: o.window ?? 'setup.*',
    context: {
      ...(o.context ?? {}),
      pointHook: o.handler,
      ...(o.operativeId ? { operativeId: o.operativeId } : {}),
      ...(o.spots ? { spots: o.spots } : {}),
      ...(o.suggestion ? { suggestion: o.suggestion } : {}),
    },
    canPass: o.canPass ?? true,
  })
}

function handlePoint(state: GameState, action: { type: string; seat: Seat; payload?: unknown }, pending: PendingDecision): Handled {
  const name = String(pending.context.pointHook)
  const h = pointHandler(name)
  if (!h) return reject('E_TODO', `no point handler ${name}`)
  const context = pending.context
  if (action.type === 'pass') return { run: (ctx) => h.done(ctx, pending.seat, null, context) }
  if (action.type !== 'marker.place') return reject('E_WRONG_DECISION', 'expected a position')
  const p = action.payload as { x?: unknown; z?: unknown }
  if (typeof p.x !== 'number' || typeof p.z !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return reject('E_SCHEMA', 'a position needs x and z')
  const pt = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 }
  const why = h.problem(state, pending.seat, pt, context)
  if (why) return reject('E_OUT_OF_RANGE', why)
  return { run: (ctx) => h.done(ctx, pending.seat, pt, context) }
}

export const markersModule: ModuleDef = {
  id: 'markers',
  namespaces: ['marker'],
  handle(state, action, pending) {
    if (pending.kind === 'marker.place' && typeof pending.context.pointHook === 'string') return handlePoint(state, action, pending)
    if (pending.kind === 'marker.place') return handlePlace(state, action)
    return reject('E_TODO', `${pending.kind} is not a decision of this version (use firefight.action ${PICK_UP})`)
  },
}

// ---------------------------------------------------------------------------
// After every accepted action
// ---------------------------------------------------------------------------

const MINE = 'core.e.mines'

/** M9 prep: an equipment marker is a mine when its equipment's effect is the `mines` code (Explosive Traps too). */
export function isMine(state: GameState, m: Marker): boolean {
  if (!m.equipmentId) return false
  if (m.equipmentId === MINE) return true
  const e = state.data.equipment?.[m.equipmentId]?.effect as { code?: string } | { code?: string }[] | undefined
  return (Array.isArray(e) ? e : e ? [e] : []).some((x) => x.code === 'mines')
}

function triggerMines(ctx: Ctx): void {
  const s = ctx.state
  if (!s.markers.some((m) => isMine(s, m))) return
  // RULING (needs-rules-check): checked after set-up and after every completed move increment, not along continuous paths.
  const points: { op: Operative; pos: Operative['pos'] }[] = []
  for (const ev of ctx.events) {
    if (ev.type === 'OperativeMoved') {
      const op = s.operatives[ev.operativeId]
      if (!op || op.status !== 'active') continue
      for (const seg of ev.segments) points.push({ op, pos: seg.to })
    }
  }
  for (const op of activeOps(s)) points.push({ op, pos: op.pos })
  for (const mine of [...s.markers.filter((m) => isMine(s, m))]) {
    for (const { op, pos } of points) {
      if (op.status !== 'active') continue
      if (providerIgnoresMine(s, op, mine)) continue
      const body = bodyOf({ ...op, pos })
      if (!markerInControlRange(s, body, mine)) continue
      markFired('mines')
      removeMarker(ctx, mine.id, 'mines')
      const [d] = ctx.roll('mines.d3', 1)
      const damage = Math.ceil(d! / 2) + 3
      ctx.emit({ type: 'MineTriggered', markerId: mine.id, operativeId: op.id, damage }, mine.owner)
      directDamage(ctx, op.id, damage, mine.id, 'mines')
      break
    }
  }
}

/** Increment end points of every move in this step, then every active operative where it stands (as triggerMines). */
function movedPoints(ctx: Ctx): { operativeId: string; pos: Vec3 }[] {
  const s = ctx.state
  const out: { operativeId: string; pos: Vec3 }[] = []
  for (const ev of ctx.events) {
    if (ev.type !== 'OperativeMoved') continue
    const op = s.operatives[ev.operativeId]
    if (!op || op.status !== 'active') continue
    for (const seg of ev.segments) out.push({ operativeId: op.id, pos: seg.to })
  }
  for (const op of activeOps(s)) out.push({ operativeId: op.id, pos: op.pos })
  return out
}

/** Carried markers move with the carrier. */
function syncCarried(state: GameState): void {
  for (const m of state.markers) {
    if (!m.carriedBy) continue
    const c = state.operatives[m.carriedBy]
    if (c && c.status === 'active') m.pos = { x: c.pos.x, z: c.pos.z }
  }
}

/** Removals during this step: drop markers, count kills, end an activation whose operative is gone. */
function processRemovals(ctx: Ctx, seen: Set<string>): void {
  for (const ev of ctx.events) {
    if (ev.type !== 'OperativeRemoved' || seen.has(ev.operativeId)) continue
    seen.add(ev.operativeId)
    const op = ctx.state.operatives[ev.operativeId]
    if (!op) continue
    dropCarried(ctx, op)
    onOperativeRemoved(ctx, op)
    // batch D prep: the kill log and the operative.removed hook, any cause
    noteRemoval(ctx, op)
    // M9 prep: tokens it held, and tokens it placed that end with it, go
    tokensOnRemoval(ctx, op.id)
  }
}

/** M10 batch D shared: removals already processed in this step (updateControl and settleRemovals share it). */
const seenInStep = new WeakMap<Ctx, Set<string>>()
function seenOf(ctx: Ctx): Set<string> {
  let seen = seenInStep.get(ctx)
  if (!seen) seenInStep.set(ctx, (seen = new Set()))
  return seen
}

/**
 * M10 batch D shared: after the deferred removal pass at the end of a step (attack-common.runDeferredRemovals), the
 * removals it made: drop markers, count kills, end an activation whose operative is gone.
 */
export function settleRemovals(ctx: Ctx): void {
  const s = ctx.state
  processRemovals(ctx, seenOf(ctx))
  if (s.removal) return
  const act = s.firefight.activation
  if (act && s.operatives[act.operativeId]?.status === 'removed' && !act.frame && !act.declared) afterActiveOperativeRemoved(ctx)
}

/**
 * Control cannot change in the middle of an action (R-8.6), so everything here runs only between
 * actions, i.e. while no action is declared and waiting for a path.
 */
export function updateControl(ctx: Ctx): void {
  const s = ctx.state
  const seen = seenOf(ctx)
  processRemovals(ctx, seen)
  // limited-weapon uses are counted in the step the weapon is picked, which is inside the declared Shoot
  noteWeaponUses(ctx)
  if (s.firefight.activation?.declared) return
  syncCarried(s)
  const before = ctx.events.length
  triggerMines(ctx)
  // batch C shared: team mines see the same moves (forced moves outside actions included)
  providerCheckMines(ctx, movedPoints(ctx))
  if (ctx.events.length > before) processRemovals(ctx, seen)
  const act = s.firefight.activation
  if (act && s.operatives[act.operativeId]?.status === 'removed' && !act.frame) afterActiveOperativeRemoved(ctx)
  for (const m of s.markers) {
    if (!tracksControl(m)) continue
    const { controller } = markerControl(s, m)
    if (controller !== m.controller) {
      m.controller = controller
      ctx.emit({ type: 'ControlChanged', markerId: m.id, controller }, null)
    }
  }
}

// "before removal" free action (R-5.18): a carrier places its marker first.
registerHook(
  'operative.incapacitated',
  (c) => {
    if (c.state && c.engine && c.operativeId) {
      const op = c.state.operatives[c.operativeId]
      if (op) dropCarried(c.engine, op)
    }
    return null
  },
  'game.dropCarried',
)
