// Operatives out of the killzone (M9 engine prep, generic capabilities "hidingReserve" and "reanimation").
//
// - Set aside at set-up (Wyrmblade HIDING): a provider's setAsideAtSetup / setAsideCap lets the owner
//   answer setup.deploy with `{ operativeId, setAside: true }`. The operative keeps status 'reserve' with
//   `offboard` set: it is readied, activates and expends like any other (so it blocks counteracting), but
//   it is not in the killzone for anything else (activeOps, targets, visibility, control, mines). While
//   activated it may take only the unique actions providers list in offboardActions (the emerge action),
//   and ending the activation keeps it out. Nothing about it is hidden: view() shows it to both seats.
// - Returning to the killzone: returnToKillzone sets an offboard or removed operative up again. A removed
//   operative that comes back (Reanimation Protocols) stops counting as incapacitated for the kill op, so
//   the opponent's kill grade and its VP can fall (missions.onOperativeReturned).
// - incapacitateOffboard removes an operative that never came back (end of TP2 for HIDING); it counts for
//   the kill op like any incapacitation, without "before removal" rules (it is not in the killzone).
// - placementSpots samples legal set-up points for a rule's region, for ability.choice options.
import { onOperativeReturned } from './missions'
import { noteRemoval } from './kills'
import type { Ctx } from './registry'
import { getOp } from './state'
import { axisOf } from './footprint'
import { placementProblem, terrainOf } from './terrain'
import { pointInPolygon } from './geometry'
import { baseUnderVantage, bodyOf } from './los'
import type { GameState, Operative, Order, Vec3 } from './types'

export function isOffboard(op: Operative): boolean {
  return op.status === 'reserve' && op.offboard !== undefined
}

/** Take an operative out of the killzone without incapacitating it (HIDING at set-up). */
export function setAside(ctx: Ctx, opId: string, kind: string): void {
  const op = getOp(ctx.state, opId)
  op.status = 'reserve'
  op.offboard = kind
  op.flags.guard = false
  ctx.emit({ type: 'OperativeSetAside', operativeId: op.id, kind }, op.seat)
}

export interface ReturnOpts {
  pos: Vec3
  order: Order
  /** wounds it returns with; default: unchanged (an offboard operative) */
  wounds?: number
  /** default: unchanged readiness */
  ready?: boolean
  /** short reason for the event feed ('emerge', 'reanimated') */
  kind: string
}

/**
 * Set an offboard or removed operative up in the killzone. The caller checks the rule's own placement
 * conditions; this checks only that the spot is physically placeable and returns false if it is not.
 */
export function returnToKillzone(ctx: Ctx, opId: string, o: ReturnOpts): boolean {
  const s = ctx.state
  const op = getOp(s, opId)
  if (op.status === 'active') return false
  if (placementProblem(s, { id: op.id, pos: o.pos, radius: op.baseRadius, height: op.height, ...axisOf(op) })) return false
  const wasRemoved = op.status === 'removed'
  op.status = 'active'
  delete op.offboard
  op.pos = { ...o.pos }
  op.order = o.order
  if (o.wounds !== undefined) op.wounds = Math.max(1, Math.min(op.maxWounds, o.wounds))
  if (o.ready !== undefined) op.ready = o.ready
  op.flags.guard = false
  op.flags.carrying = null
  op.flags.injured = op.wounds * 2 < op.maxWounds
  if (wasRemoved) {
    // a returning operative comes back clean: timed APL changes and tokens went with its removal
    op.aplMods = 0
    op.aplFx = []
  }
  ctx.emit({ type: 'OperativeReturned', operativeId: op.id, pos: { ...op.pos }, wounds: op.wounds, ready: op.ready, kind: o.kind }, op.seat)
  if (wasRemoved) onOperativeReturned(ctx, op)
  return true
}

/** An operative still out of the killzone is incapacitated (HIDING at the end of TP2): no before-removal rules. */
export function incapacitateOffboard(ctx: Ctx, opId: string): void {
  const op = getOp(ctx.state, opId)
  if (op.status !== 'reserve') return
  op.wounds = 0
  op.ready = false
  delete op.offboard
  op.status = 'removed'
  ctx.emit({ type: 'OperativeIncapacitated', operativeId: op.id })
  // markers.ts counts the kill when it sees OperativeRemoved after the step's action
  ctx.emit({ type: 'OperativeRemoved', operativeId: op.id }, op.seat)
  noteRemoval(ctx, op)
}

export interface SpotOpts {
  /** extra test a spot must pass (region, distance to enemies...) */
  test?: (pos: Vec3) => boolean
  /** sample spacing in inches (default 1) */
  step?: number
  /** at most this many spots, spread apart (default 16) */
  max?: number
  /** only sample within this distance of `around` (horizontal) */
  around?: { x: number; z: number }
  radius?: number
  /** batch D prep: also sample the floors of terrain (Vantage tops) at each point, not only the killzone floor */
  levels?: boolean
  /** batch D prep: skip spots whose base would be under a Vantage floor (los.baseUnderVantage) */
  notUnderVantage?: boolean
}

/** batch D prep: the heights an operative could stand at over `p`: the killzone floor and every terrain floor above it. */
function levelsAt(state: GameState, p: { x: number; z: number }): number[] {
  const out = [0]
  for (const sol of terrainOf(state.map).solids) {
    if (!pointInPolygon(p, sol.polygon)) continue
    for (const f of sol.floors) if (f > 0 && !out.some((y) => Math.abs(y - f) < 1e-3)) out.push(f)
  }
  return out.sort((a, b) => a - b)
}

/**
 * Ground-level points where the operative could be set up (placementProblem clear) that pass `test`,
 * spread out by farthest-point selection; deterministic. Used to offer set-up positions as options.
 */
export function placementSpots(state: GameState, op: Operative, o: SpotOpts = {}): Vec3[] {
  const step = o.step ?? 1
  const hx = state.map.size.x / 2
  const hz = state.map.size.z / 2
  const cands: Vec3[] = []
  for (let x = -hx + op.baseRadius; x <= hx - op.baseRadius + 1e-9; x += step) {
    for (let z = -hz + op.baseRadius; z <= hz - op.baseRadius + 1e-9; z += step) {
      const flat = { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 }
      if (o.around && Math.hypot(flat.x - o.around.x, flat.z - o.around.z) > (o.radius ?? Infinity) + 1e-9) continue
      for (const y of o.levels ? levelsAt(state, flat) : [0]) {
        const pos = { x: flat.x, y, z: flat.z }
        if (o.test && !o.test(pos)) continue
        if (placementProblem(state, { id: op.id, pos, radius: op.baseRadius, height: op.height, ...axisOf(op) })) continue
        if (o.notUnderVantage && baseUnderVantage(state, bodyOf({ ...op, pos }))) continue
        cands.push(pos)
      }
    }
  }
  const max = o.max ?? 16
  if (cands.length <= max) return cands
  const out: Vec3[] = [cands[0]!]
  const best = cands.map((c) => Math.hypot(c.x - out[0]!.x, c.z - out[0]!.z))
  while (out.length < max) {
    let bi = 0
    for (let i = 1; i < cands.length; i++) if (best[i]! > best[bi]!) bi = i
    const p = cands[bi]!
    out.push(p)
    for (let i = 0; i < cands.length; i++) best[i] = Math.min(best[i]!, Math.hypot(cands[i]!.x - p.x, cands[i]!.z - p.z))
  }
  return out
}
