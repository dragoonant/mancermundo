// MRK: marker.* - Pick Up / Place Marker, contest and control by APL, carrying, and the rules that
// run after every accepted action: control changes, Mines, removals feeding the mission, and the
// activating operative being removed (R-4.5, R-4.6, R-5.18, R-8.5, R-8.6, M-5.2).
import { markerInControlRange, enemiesInControlRange } from './measure'
import { bodyOf } from './los'
import { directDamage } from './effects'
import { afterActiveOperativeRemoved, cancelAction, finishAction } from './firefight'
import { registerHook } from './hooks'
import { markFired } from './code-hooks'
import { noteWeaponUses } from './equipment'
import { onOperativeRemoved } from './missions'
import { markerControl } from './query'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { activeOps, getOp } from './state'
import type { Activation, Marker, Operative, GameState } from './types'

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
    if (!performed.includes(PICK_UP) && !performed.includes(PLACE)) out.push({ id: `${PLACE}:${carrying}`, action: PLACE, markerId: carrying, cost: 1 })
    return out
  }
  if (inCr || performed.includes(PLACE) || performed.includes(PICK_UP)) return out
  for (const m of state.markers) {
    if (!m.pickable || m.carriedBy) continue
    const c = markerControl(state, m)
    if (c.controller === op.seat && c.contesting[op.seat].includes(op.id)) {
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
  ctx.raise({
    kind: 'marker.place',
    seat: op.seat,
    window: 'firefight.actionDeclared',
    context: { operativeId: op.id, markerId: m.id, maxDistance: 1 },
    canPass: true,
  })
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
  const gap = Math.hypot(p.x - op.pos.x, p.z - op.pos.z) - op.baseRadius
  if (gap > 1 + 1e-6) return reject('E_OUT_OF_RANGE', 'a marker is placed within the operative control range (1")')
  const id = op.flags.carrying
  if (!id) return reject('E_ACTION_RESTRICTED', 'the operative carries no marker')
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

export const markersModule: ModuleDef = {
  id: 'markers',
  namespaces: ['marker'],
  handle(state, action, pending) {
    if (pending.kind === 'marker.place') return handlePlace(state, action)
    return reject('E_TODO', `${pending.kind} is not a decision of this version (use firefight.action ${PICK_UP})`)
  },
}

// ---------------------------------------------------------------------------
// After every accepted action
// ---------------------------------------------------------------------------

const MINE = 'core.e.mines'

function triggerMines(ctx: Ctx): void {
  const s = ctx.state
  if (!s.markers.some((m) => m.equipmentId === MINE)) return
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
  for (const mine of [...s.markers.filter((m) => m.equipmentId === MINE)]) {
    for (const { op, pos } of points) {
      if (op.status !== 'active') continue
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
  }
}

/**
 * Control cannot change in the middle of an action (R-8.6), so everything here runs only between
 * actions, i.e. while no action is declared and waiting for a path.
 */
export function updateControl(ctx: Ctx): void {
  const s = ctx.state
  const seen = new Set<string>()
  processRemovals(ctx, seen)
  if (s.firefight.activation?.declared) return
  syncCarried(s)
  noteWeaponUses(ctx)
  const before = ctx.events.length
  triggerMines(ctx)
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
