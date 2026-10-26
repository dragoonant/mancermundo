// MOV module: owns `move.*`. A voluntary move is a path of waypoints answered to `move.path`; the engine validates it
// exactly (path length along the bends plus obstacle crossings, walls and closed doors, other bases, the 1" rule) and
// never rounds. Take Cover, Crawl and Carry use the same decision with another allowance. Charge, Running for Cover,
// Knockback, Blaze and door pushes are engine-made (S3b); `findClearSpot` and `shortestLegalPath` are the S2 pieces they
// will use. `suggestMovePath` is what `suggest` answers for a move.path decision.
import { completeAction, cancelDeclared } from './activation'
import { runHook } from './hooks'
import { baseGap, CONTACT_EPS, refreshEngagement } from './measure'
import { navFor, pointSegDist, shortestRoute, sweepBlocked, type AvoidDisc } from './nav'
import { insideOutline } from './board'
import { circleOverlapsPolygon, polygonBBox, round3, segmentPolygonIntervals, type BBox } from './geometry'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { constants, getFighter, onBoard, oneInchEnemies } from './state'
import { angleDelta } from './footprint'
import type { MoveKind } from './events'
import type { Action, Fighter, GameState, MoveConstraints, PendingDecision, Rejection, Vec2, Waypoint } from './types'

/** Movement is measured exactly; this absorbs only the 1/1000" rounding of waypoints. */
export const LENGTH_TOLERANCE = 0.005

export type VoluntaryKind = 'move' | 'takeCover' | 'crawl' | 'carry'

const boxes = new WeakMap<object, BBox>()

/** A base at `c` can only overlap a polygon whose (cached) box is within its radius. */
function overlaps(c: Vec2, r: number, poly: Vec2[]): boolean {
  let b = boxes.get(poly)
  if (!b) {
    b = polygonBBox(poly)
    boxes.set(poly, b)
  }
  if (c.x + r < b.minX || c.x - r > b.maxX || c.z + r < b.minZ || c.z - r > b.maxZ) return false
  return circleOverlapsPolygon(c, r, poly)
}

const reasonOf = (code: Rejection['code'], reason: string, details?: Record<string, unknown>): Rejection => (details ? { code, reason, details } : { code, reason })

// ---------------------------------------------------------------------------
// Allowances
// ---------------------------------------------------------------------------

/** Half of M, rounded up to the inch (R-1.8): Take Cover and Crawl. */
export function halfMove(state: GameState, f: Fighter): number {
  return Math.ceil(moveAllowance(state, f) / 2)
}

/** M (inches), with `move.limit` hooks applied. */
export function moveAllowance(state: GameState, f: Fighter): number {
  let m = f.stats.M
  for (const r of runHook('move.limit', { seat: f.seat, state, fighterId: f.id, data: { value: m } })) if (r.delta) m += r.delta
  return m
}

export function maxInchesFor(state: GameState, f: Fighter, kind: VoluntaryKind): number {
  return kind === 'takeCover' || kind === 'crawl' ? halfMove(state, f) : moveAllowance(state, f)
}

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------

/** Why a base centred at `c` cannot stand there (walls, closed doors, obstacles, other bases, off the board), or null. */
export function spotProblem(
  state: GameState,
  mover: Fighter,
  c: Vec2,
  opts: { ignoreDoorId?: string; ignoreIds?: readonly string[]; oneInch?: boolean } = {},
): Rejection | null {
  const def = state.board.def
  const r = mover.baseRadius
  if (!insideOutline(def, c)) return reasonOf('E_OVERLAP', 'the base would be off the board')
  for (const w of def.walls) if (overlaps(c, r, w.poly)) return reasonOf('E_OVERLAP', 'the base would overlap a wall')
  for (const d of def.doors) {
    if (d.id === opts.ignoreDoorId) continue
    const rec = state.board.doors[d.id]
    if ((!rec || rec.state === 'closed') && overlaps(c, r, d.poly)) return reasonOf('E_OVERLAP', 'the base would overlap a closed door')
  }
  for (const o of def.obstacles) if (overlaps(c, r, o.poly)) return reasonOf('E_OVERLAP', 'a base cannot end on an obstacle')
  for (const f of onBoard(state)) {
    if (f.id === mover.id || opts.ignoreIds?.includes(f.id)) continue
    if (Math.hypot(f.pos.x - c.x, f.pos.z - c.z) < f.baseRadius + r - 1e-6) return reasonOf('E_OVERLAP', `the base would overlap ${f.id}`)
  }
  if (opts.oneInch) {
    const limit = constants(state).radii.oneInchRule
    for (const e of oneInchEnemies(state, mover)) {
      if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) - e.baseRadius - r < limit - 1e-6) return reasonOf('E_ONE_INCH', `the base would end within ${limit}" of ${e.id}`)
    }
  }
  return null
}

/**
 * The nearest legal spot to `near` for a base of the mover's size, searching rings out to `maxRadius` (engine-made
 * placements: door pushes, ductway exits). Candidates are tried in a fixed angular order so the answer is deterministic.
 */
export function findClearSpot(
  state: GameState,
  mover: Fighter,
  near: Vec2,
  maxRadius: number,
  opts: { ignoreDoorId?: string; oneInch?: boolean; accept?: (c: Vec2) => boolean } = {},
): Vec2 | null {
  const test = (c: Vec2) => !spotProblem(state, mover, c, opts) && (opts.accept?.(c) ?? true)
  const n0 = { x: round3(near.x), z: round3(near.z) }
  if (test(n0)) return n0
  for (let radius = 0.25; radius <= maxRadius + 1e-9; radius += 0.25) {
    const steps = Math.max(8, Math.ceil((2 * Math.PI * radius) / 0.25))
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * 2 * Math.PI
      const c = { x: round3(near.x + Math.sin(a) * radius), z: round3(near.z + Math.cos(a) * radius) }
      if (test(c)) return c
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Planning a voluntary move
// ---------------------------------------------------------------------------

export interface PlanOptions {
  maxInches: number
  oneInch: 'enemy' | 'none'
  /** Take Cover may stay where it is */
  allowEmpty?: boolean
  facing?: number
}

export type MovePlan =
  | { ok: true; path: Vec2[]; length: number; cost: number; crossings: number; end: Vec2; facing: number }
  | { ok: false; rejection: Rejection }

const fail = (rejection: Rejection): MovePlan => ({ ok: false, rejection })

/** Obstacles crossed by the centre line (a contiguous run inside one obstacle counts once). */
function countCrossings(state: GameState, path: Vec2[]): number {
  let n = 0
  for (const o of state.board.def.obstacles) {
    let inside = false
    for (let i = 0; i + 1 < path.length; i++) {
      const ivs = segmentPolygonIntervals(path[i]!, path[i + 1]!, o.poly)
      for (const [t0, t1] of ivs) {
        const continues = inside && t0 < 1e-9
        if (!continues) n++
        inside = t1 > 1 - 1e-9
      }
      if (ivs.length === 0) inside = false
    }
  }
  return n
}

export function planMove(state: GameState, f: Fighter, waypoints: readonly Waypoint[], opts: PlanOptions): MovePlan {
  if (!Array.isArray(waypoints) || waypoints.some((w) => !w || !Number.isFinite(w.x) || !Number.isFinite(w.z))) {
    return fail(reasonOf('E_SCHEMA', 'waypoints must be finite x/z pairs'))
  }
  if (waypoints.length === 0 && !opts.allowEmpty) return fail(reasonOf('E_SCHEMA', 'a move needs at least one waypoint'))
  const start = { x: f.pos.x, z: f.pos.z }
  const path: Vec2[] = [start]
  for (const w of waypoints) {
    const p = { x: round3(w.x), z: round3(w.z) }
    const last = path[path.length - 1]!
    if (Math.hypot(p.x - last.x, p.z - last.z) < 1e-9) continue
    path.push(p)
  }
  const def = state.board.def
  const r = f.baseRadius
  const blockers = navFor(def, state.board.doors, r).blockers
  let length = 0
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    if (!insideOutline(def, b)) return fail(reasonOf('E_OVERLAP', 'the path leaves the board'))
    if (sweepBlocked(blockers, a, b, r)) return fail(reasonOf('E_NO_PATH', 'the path crosses a wall or a closed door'))
    for (const e of onBoard(state)) {
      if (e.id === f.id || e.seat === f.seat) continue
      if (pointSegDist({ x: e.pos.x, z: e.pos.z }, a, b) < e.baseRadius + r - 1e-6) return fail(reasonOf('E_NO_PATH', `the path crosses the base of ${e.id}`))
    }
    length += Math.hypot(b.x - a.x, b.z - a.z)
  }
  const crossings = countCrossings(state, path)
  const cost = length + crossings * constants(state).obstacle.height
  if (cost > opts.maxInches + LENGTH_TOLERANCE) {
    return fail(reasonOf('E_OUT_OF_RANGE', `the path costs ${cost.toFixed(2)}" of ${opts.maxInches}"`, { cost, length, crossings, maxInches: opts.maxInches }))
  }
  const end = path[path.length - 1]!
  const endProblem = spotProblem(state, f, end)
  if (endProblem) return fail(endProblem)
  if (opts.oneInch === 'enemy') {
    const limit = constants(state).radii.oneInchRule
    for (const e of oneInchEnemies(state, f)) {
      const startGap = Math.hypot(e.pos.x - start.x, e.pos.z - start.z) - e.baseRadius - r
      let min = Infinity
      for (let i = 0; i + 1 < path.length; i++) min = Math.min(min, pointSegDist({ x: e.pos.x, z: e.pos.z }, path[i]!, path[i + 1]!))
      if (path.length === 1) min = Math.hypot(e.pos.x - start.x, e.pos.z - start.z)
      const gap = min - e.baseRadius - r
      if (gap < limit - 1e-6 && gap < startGap - 1e-6) return fail(reasonOf('E_ONE_INCH', `the path comes within ${limit}" of ${e.id}`, { enemyId: e.id, gap }))
    }
  }
  let facing = f.facing
  if (opts.facing !== undefined) {
    if (!Number.isFinite(opts.facing)) return fail(reasonOf('E_SCHEMA', 'facing must be a finite angle'))
    facing = normaliseAngle(opts.facing)
  } else if (path.length >= 2) {
    const a = path[path.length - 2]!
    facing = Math.atan2(end.x - a.x, end.z - a.z)
  }
  return { ok: true, path, length, cost, crossings, end, facing }
}

export function normaliseAngle(a: number): number {
  return round3(angleDelta(0, a))
}

// ---------------------------------------------------------------------------
// Applying a move
// ---------------------------------------------------------------------------

/** Move a fighter along an already validated path: position, facing, `FighterMoved`, contacted Pinned enemies stand up. */
export function applyMove(ctx: Ctx, f: Fighter, plan: Extract<MovePlan, { ok: true }>, kind: MoveKind, maxInches: number): void {
  const from = { ...f.pos }
  f.pos = { x: plan.end.x, y: 0, z: plan.end.z }
  f.facing = plan.facing
  ctx.emit({ type: 'FighterMoved', fighterId: f.id, kind, from, to: { ...f.pos }, path: plan.path.map((p) => ({ ...p })), length: round3(plan.length), maxInches }, f.seat)
  standUpContacted(ctx, f)
}

/**
 * R-3.4: a Pinned enemy that a fighter moves into base contact with stands up at once for free, facing the mover; the
 * engagement refresh then makes both Engaged. (The facing penalty of R-10.2 is applied by the fight code, S3b.)
 */
export function standUpContacted(ctx: Ctx, mover: Fighter): void {
  for (const e of onBoard(ctx.state)) {
    if (e.seat === mover.seat || e.posture !== 'pinned') continue
    if (baseGap(mover, e) > CONTACT_EPS) continue
    e.posture = 'standing'
    e.facing = Math.atan2(mover.pos.x - e.pos.x, mover.pos.z - e.pos.z)
    ctx.emit({ type: 'StatusChanged', fighterId: e.id, from: 'pinned', to: 'standing', reason: 'contacted' }, e.seat)
  }
  refreshEngagement(ctx)
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export function raiseMovePath(ctx: Ctx, f: Fighter, kind: VoluntaryKind, extra: Record<string, unknown> = {}): void {
  const maxInches = maxInchesFor(ctx.state, f, kind)
  const constraints: MoveConstraints = {
    kind,
    fighterId: f.id,
    origin: { ...f.pos },
    baseRadius: f.baseRadius,
    maxInches,
    oneInch: 'enemy',
  }
  ctx.raise({
    kind: 'move.path',
    seat: f.seat,
    window: 'action.declared',
    context: { fighterId: f.id, kind, maxInches, obstacleCost: constants(ctx.state).obstacle.height, ...extra },
    constraints,
    canPass: true,
  })
}

function handleMovePath(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type === 'pass') {
    return {
      run(ctx) {
        cancelDeclared(ctx)
      },
    }
  }
  if (action.type !== 'move.path') return reject('E_WRONG_DECISION', `expected move.path, got ${action.type}`)
  const c = pending.constraints
  if (!c || !c.fighterId) return reject('E_SCHEMA', 'move.path without constraints')
  const f = getFighter(state, c.fighterId)
  const kind = c.kind as VoluntaryKind
  const plan = planMove(state, f, action.payload.waypoints, {
    maxInches: c.maxInches ?? 0,
    oneInch: c.oneInch ?? 'enemy',
    allowEmpty: kind === 'takeCover',
    ...(action.payload.facing !== undefined ? { facing: action.payload.facing } : {}),
  })
  if (!plan.ok) return { rejection: plan.rejection }
  return {
    run(ctx) {
      const fighter = getFighter(ctx.state, f.id)
      if (plan.length > 0) applyMove(ctx, fighter, plan, kind, c.maxInches ?? 0)
      completeAction(ctx, fighter, kind, plan)
    },
  }
}

export const movementModule: ModuleDef = {
  id: 'movement',
  namespaces: ['move'],
  handle: handleMovePath,
}

// ---------------------------------------------------------------------------
// Engine-made paths and suggestions
// ---------------------------------------------------------------------------

/**
 * Discs of the enemies a voluntary move must stay 1" from (for `avoid` routing); `within` keeps only those whose disc comes
 * within that many inches of the fighter (the rest cannot matter for the first leg of a route).
 */
export function enemyAvoidDiscs(state: GameState, f: Fighter, within = Infinity): AvoidDisc[] {
  const limit = constants(state).radii.oneInchRule
  return oneInchEnemies(state, f)
    .map((e) => ({ c: { x: e.pos.x, z: e.pos.z }, r: e.baseRadius + limit + 0.01 }))
    .filter((d) => Math.hypot(d.c.x - f.pos.x, d.c.z - f.pos.z) - d.r <= within)
}

/** A point just outside the 1" ring of an enemy on the line from the fighter: where a voluntary approach stops. */
export function approachPoint(state: GameState, f: Fighter, target: Fighter): Vec2 {
  const stop = target.baseRadius + constants(state).radii.oneInchRule + f.baseRadius + 0.06
  const dx = f.pos.x - target.pos.x
  const dz = f.pos.z - target.pos.z
  const d = Math.hypot(dx, dz) || 1
  return { x: round3(target.pos.x + (dx / d) * stop), z: round3(target.pos.z + (dz / d) * stop) }
}

/** Shortest legal centre path from the fighter to `to` (waypoints after the start), or null. */
export function shortestLegalPath(state: GameState, f: Fighter, to: Vec2, avoidEnemies = true, within = Infinity): Vec2[] | null {
  const nav = navFor(state.board.def, state.board.doors, f.baseRadius)
  const route = shortestRoute(nav, { x: f.pos.x, z: f.pos.z }, to, avoidEnemies ? enemyAvoidDiscs(state, f, within) : undefined)
  return route ? route.path.slice(1) : null
}

/** The polyline cut to `maxLength`, the last point interpolated. */
export function truncatePath(start: Vec2, wps: readonly Vec2[], maxLength: number): Vec2[] {
  const out: Vec2[] = []
  let left = maxLength
  let prev = start
  for (const w of wps) {
    const seg = Math.hypot(w.x - prev.x, w.z - prev.z)
    if (seg <= left + 1e-9) {
      out.push({ x: round3(w.x), z: round3(w.z) })
      left -= seg
      prev = w
    } else {
      const t = left / seg
      out.push({ x: round3(prev.x + (w.x - prev.x) * t), z: round3(prev.z + (w.z - prev.z) * t) })
      return out
    }
  }
  return out
}

/** A short route toward `target` that passes the move checks, or null. Used by `suggest` and the sim bot. */
export function planToward(state: GameState, f: Fighter, kind: VoluntaryKind, maxInches: number, target: Vec2, oneInch: 'enemy' | 'none' = 'enemy'): Vec2[] | null {
  const route = shortestLegalPath(state, f, target, oneInch === 'enemy', maxInches + 2)
  if (!route || route.length === 0) return null
  const start = { x: f.pos.x, z: f.pos.z }
  for (let limit = maxInches; limit >= 0.25 - 1e-9; limit -= 0.25) {
    const wps = truncatePath(start, route, limit)
    if (wps.length === 0) continue
    const plan = planMove(state, f, wps, { maxInches, oneInch })
    if (plan.ok) return wps
  }
  return null
}

/** `suggest` for a move.path: toward the nearest enemy (or the board centre), cancelling when nothing legal exists. */
export function suggestMovePath(state: GameState, pending: PendingDecision): Action | null {
  const c = pending.constraints
  if (!c?.fighterId) return null
  const f = getFighter(state, c.fighterId)
  const enemies = oneInchEnemies(state, f)
  const target = enemies.length
    ? enemies.reduce((best, e) => (Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z) < Math.hypot(best.pos.x - f.pos.x, best.pos.z - f.pos.z) ? e : best))
    : null
  const to = target ? approachPoint(state, f, target) : { x: 0, z: 0 }
  const wps = planToward(state, f, c.kind as VoluntaryKind, c.maxInches ?? 0, to, c.oneInch ?? 'enemy')
  if (!wps) return pending.canPass ? { type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} } : null
  return { type: 'move.path', seat: pending.seat, decisionId: pending.id, payload: { waypoints: wps } }
}
