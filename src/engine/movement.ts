// MOV module: owns `move.*`. A voluntary move is a path of waypoints answered to `move.path`; the engine validates it
// exactly (path length along the bends plus obstacle crossings, walls and closed doors, other bases, the 1" rule) and
// never rounds. Take Cover, Crawl and Carry use the same decision with another allowance; Retreat (R-7.9) and Consolidate
// (R-10.10) use it from inside a close-combat sequence (fight.ts resumes after them). Charge (R-7.6), Running for Cover
// (R-12.4), Knockback, Blaze (R-3.13) and door pushes are engine-made paths; involuntary moves end with the pushed-apart
// step (R-7.4). `suggestMovePath` is what `suggest` answers for a move.path decision.
import { completeAction, cancelDeclared } from './activation'
import { resumeAfterMove } from './fight'
import { coverFrom, hasLos } from './los'
import { rollExpr } from './dice'
import { runHook } from './hooks'
import { baseGap, CONTACT_EPS, refreshEngagement } from './measure'
import { navFor, pointSegDist, shortestRoute, sweepBlocked, type AvoidDisc } from './nav'
import { insideOutline } from './board'
import { circleOverlapsPolygon, polygonBBox, round3, segmentPolygonIntervals, type BBox } from './geometry'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { constants, enemiesOf, getFighter, onBoard, oneInchEnemies } from './state'
import { pathGapPoints } from './measure'
import { angleDelta } from './footprint'
import { markFired } from './code-hooks'
import { hasSkill } from './skills/common'
import { isImmovable } from './skills/stance'
import { handleSomersault, suggestSomersault } from './skills/somersault'
import type { MoveKind } from './events'
import type { Action, Fighter, GameState, MoveConstraints, PendingDecision, Rejection, Vec2, Waypoint } from './types'

/** Movement is measured exactly; this absorbs only the 1/1000" rounding of waypoints. */
export const LENGTH_TOLERANCE = 0.005

export type VoluntaryKind = 'move' | 'takeCover' | 'crawl' | 'carry'
/** move.path kinds answered inside a close-combat sequence (fight.ts resumes after them) */
export type SequenceMoveKind = 'retreat' | 'consolidate'

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
  /** the end spot must be more than 1" from every Standing or Pinned enemy (Retreat, R-7.9 ruling) */
  endClear?: boolean
  /** Acrobatic (esc): may pass over enemy bases and cross obstacles at no cost; the 1" rule is checked at the end spot only */
  acrobatic?: boolean
}

export type MovePlan =
  | { ok: true; path: Vec2[]; length: number; cost: number; crossings: number; end: Vec2; facing: number; viaAcrobatic?: boolean }
  | { ok: false; rejection: Rejection }

/** Acrobatic applies to a Move or Charge made while Active (Standing and not Engaged). */
export function acrobaticFor(state: GameState, f: Fighter): boolean {
  return f.posture === 'standing' && f.engagedWith.length === 0 && hasSkill(state, f, 'acrobatic')
}

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
  let overEnemy = false
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    if (!insideOutline(def, b)) return fail(reasonOf('E_OVERLAP', 'the path leaves the board'))
    if (sweepBlocked(blockers, a, b, r)) return fail(reasonOf('E_NO_PATH', 'the path crosses a wall or a closed door'))
    for (const e of onBoard(state)) {
      if (e.id === f.id || e.seat === f.seat) continue
      if (pointSegDist({ x: e.pos.x, z: e.pos.z }, a, b) < e.baseRadius + r - 1e-6) {
        if (opts.acrobatic) {
          overEnemy = true
          continue
        }
        return fail(reasonOf('E_NO_PATH', `the path crosses the base of ${e.id}`))
      }
    }
    length += Math.hypot(b.x - a.x, b.z - a.z)
  }
  const crossings = countCrossings(state, path)
  const cost = length + (opts.acrobatic ? 0 : crossings * constants(state).obstacle.height)
  if (cost > opts.maxInches + LENGTH_TOLERANCE) {
    return fail(reasonOf('E_OUT_OF_RANGE', `the path costs ${cost.toFixed(2)}" of ${opts.maxInches}"`, { cost, length, crossings, maxInches: opts.maxInches }))
  }
  const end = path[path.length - 1]!
  const endProblem = spotProblem(state, f, end, opts.endClear || (opts.acrobatic && opts.oneInch === 'enemy') ? { oneInch: true } : {})
  if (endProblem) return fail(endProblem)
  if (opts.oneInch === 'enemy' && !opts.acrobatic) {
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
  return { ok: true, path, length, cost, crossings, end, facing, ...(opts.acrobatic && (overEnemy || crossings > 0) ? { viaAcrobatic: true } : {}) }
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
    const pc = pending.constraints
    return {
      run(ctx) {
        // a consolidate may be declined (no move); every other pass cancels the declared action before anything was rolled
        if (pc?.kind === 'consolidate' && pc.fighterId) resumeAfterMove(ctx, getFighter(ctx.state, pc.fighterId), 'consolidate')
        else cancelDeclared(ctx)
      },
    }
  }
  if (action.type !== 'move.path') return reject('E_WRONG_DECISION', `expected move.path, got ${action.type}`)
  const c = pending.constraints
  if (!c || !c.fighterId) return reject('E_SCHEMA', 'move.path without constraints')
  const f = getFighter(state, c.fighterId)
  if (c.kind === 'somersault') return handleSomersault(state, action.payload, c)
  const kind = c.kind as VoluntaryKind | SequenceMoveKind
  const plan = planMove(state, f, action.payload.waypoints, {
    maxInches: c.maxInches ?? 0,
    oneInch: c.oneInch ?? 'enemy',
    allowEmpty: kind === 'takeCover',
    endClear: kind === 'retreat',
    ...(kind === 'move' && acrobaticFor(state, f) ? { acrobatic: true } : {}),
    ...(action.payload.facing !== undefined ? { facing: action.payload.facing } : {}),
  })
  if (!plan.ok) return { rejection: plan.rejection }
  return {
    run(ctx) {
      const fighter = getFighter(ctx.state, f.id)
      if (plan.viaAcrobatic) markFired('acrobatic')
      if (plan.length > 0) applyMove(ctx, fighter, plan, kind, c.maxInches ?? 0)
      if (kind === 'retreat' || kind === 'consolidate') resumeAfterMove(ctx, fighter, kind)
      else completeAction(ctx, fighter, kind, plan)
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
  // Retreat carries the engine's best end point (it cannot be passed once the dice are rolled); Consolidate defaults to staying
  const ready = pending.context.suggestion as Vec2[] | undefined
  if (ready) return { type: 'move.path', seat: pending.seat, decisionId: pending.id, payload: { waypoints: ready.map((p) => ({ x: p.x, z: p.z })) } }
  if (c.kind === 'consolidate') return { type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} }
  if (c.kind === 'somersault') {
    const at = suggestSomersault(state, f, c.maxInches)
    return at ? { type: 'move.path', seat: pending.seat, decisionId: pending.id, payload: { waypoints: [at] } } : { type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} }
  }
  const enemies = oneInchEnemies(state, f)
  const target = enemies.length
    ? enemies.reduce((best, e) => (Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z) < Math.hypot(best.pos.x - f.pos.x, best.pos.z - f.pos.z) ? e : best))
    : null
  const to = target ? approachPoint(state, f, target) : { x: 0, z: 0 }
  const wps = planToward(state, f, c.kind as VoluntaryKind, c.maxInches ?? 0, to, c.oneInch ?? 'enemy')
  if (!wps) return pending.canPass ? { type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} } : null
  return { type: 'move.path', seat: pending.seat, decisionId: pending.id, payload: { waypoints: wps } }
}

// ---------------------------------------------------------------------------
// Involuntary moves: Knockback, Blaze and the pushed-apart step (R-14.3, R-3.13, R-7.4, R-7.5)
// ---------------------------------------------------------------------------

export interface PushResult {
  /** inches actually moved */
  moved: number
  /** stopped short of the full distance (wall, closed door, obstacle, another base or the board edge) */
  blocked: boolean
  /** the displacement (a melee attacker following up moves by the same vector) */
  shift: Vec2
}

/**
 * Slide a base straight along the unit vector (ux, uz) for up to `distance` inches; it stops at the last spot where the base
 * overlaps no wall, closed door, obstacle or other base and stays on the board (R-7.5). The 1" rule is not checked.
 */
export function slide(state: GameState, f: Fighter, ux: number, uz: number, distance: number): Vec2 {
  const start = { x: f.pos.x, z: f.pos.z }
  if (!(distance > 0)) return start
  const step = 0.05
  let last = start
  for (let t = Math.min(step, distance); ; t = Math.min(distance, t + step)) {
    const c = { x: round3(start.x + ux * t), z: round3(start.z + uz * t) }
    if (spotProblem(state, f, c)) break
    last = c
    if (t >= distance - 1e-9) break
  }
  return last
}

/** Put a fighter at `to` along a straight line and emit the move. */
export function placeAlong(ctx: Ctx, f: Fighter, kind: MoveKind, to: Vec2, maxInches: number, facing?: number): void {
  const from = { ...f.pos }
  const a = { x: from.x, z: from.z }
  f.pos = { x: to.x, y: 0, z: to.z }
  if (facing !== undefined) f.facing = normaliseAngle(facing)
  const length = round3(Math.hypot(to.x - a.x, to.z - a.z))
  ctx.emit({ type: 'FighterMoved', fighterId: f.id, kind, from, to: { ...f.pos }, path: [a, { x: to.x, z: to.z }], length, maxInches: round3(maxInches) }, f.seat)
}

/**
 * Push a fighter `distance` inches directly away from `from` (R-7.5 "directly away": along the line through both centres;
 * when `from` sits on the base centre the direction is a scatter roll). Involuntary: the 1" rule is ignored. The caller
 * finishes it with `afterInvoluntary` (the pushed-apart step of R-7.4, after a melee attacker's follow-up).
 */
export function knockbackPush(ctx: Ctx, f: Fighter, from: Vec2, distance: number): PushResult {
  const s = ctx.state
  // Immovable Stance: cannot be shifted by Knockback (or Hurl, Drag, Overseer ...): nothing moves and nothing is blocked
  if (isImmovable(s, f)) {
    markFired('immovableStance')
    return { moved: 0, blocked: false, shift: { x: 0, z: 0 } }
  }
  const start = { x: f.pos.x, z: f.pos.z }
  let dx = start.x - from.x
  let dz = start.z - from.z
  let d = Math.hypot(dx, dz)
  if (d < 0.05) {
    const deg = ctx.rollScatter('knockbackDirection')
    const a = (deg * Math.PI) / 180
    dx = Math.sin(a)
    dz = Math.cos(a)
    d = 1
  }
  const last = slide(s, f, dx / d, dz / d, distance)
  const moved = Math.hypot(last.x - start.x, last.z - start.z)
  const blocked = moved < distance - 0.01
  if (moved > 0) placeAlong(ctx, f, 'knockback', last, distance)
  ctx.emit({ type: 'KnockedBack', targetId: f.id }, f.seat)
  return { moved, blocked, shift: { x: last.x - start.x, z: last.z - start.z } }
}

/**
 * R-7.4: once an involuntary move is resolved, a fighter left within 1" of a Standing or Pinned enemy (neither Seriously
 * Injured) is shifted the shortest way until it is 1" away; `except` names enemies it may stay touching (a melee attacker
 * that followed up a Knockback). Returns true when it moved.
 */
export function pushApart(ctx: Ctx, f: Fighter, except: readonly string[] = []): boolean {
  const s = ctx.state
  if (f.location !== 'board' || f.posture === 'seriouslyInjured') return false
  const limit = constants(s).radii.oneInchRule
  const tooClose = (c: Vec2) =>
    oneInchEnemies(s, f).filter((e) => !except.includes(e.id) && Math.hypot(e.pos.x - c.x, e.pos.z - c.z) - e.baseRadius - f.baseRadius < limit - 1e-6)
  const here = { x: f.pos.x, z: f.pos.z }
  const close = tooClose(here)
  if (close.length === 0) return false
  const blockers = navFor(s.board.def, s.board.doors, f.baseRadius).blockers
  const reachable = (c: Vec2) => !sweepBlocked(blockers, here, c, f.baseRadius) && tooClose(c).length === 0
  // straight away from the nearest offending enemy by exactly what is missing; otherwise the nearest clear spot
  const e = close.reduce((a, b) => (Math.hypot(a.pos.x - here.x, a.pos.z - here.z) <= Math.hypot(b.pos.x - here.x, b.pos.z - here.z) ? a : b))
  const dx = here.x - e.pos.x
  const dz = here.z - e.pos.z
  const d = Math.hypot(dx, dz)
  let spot: Vec2 | null = null
  if (d > 1e-6) {
    const need = e.baseRadius + f.baseRadius + limit + 0.002
    const c = { x: round3(e.pos.x + (dx / d) * need), z: round3(e.pos.z + (dz / d) * need) }
    if (!spotProblem(s, f, c) && reachable(c)) spot = c
  }
  spot ??= findClearSpot(s, f, here, 6, { accept: reachable })
  if (!spot) return false
  placeAlong(ctx, f, 'pushedApart', spot, Math.hypot(spot.x - here.x, spot.z - here.z))
  return true
}

/** The end of an involuntary move: pushed apart (R-7.4), then any Pinned enemy still touched stands up (R-3.4). */
export function afterInvoluntary(ctx: Ctx, f: Fighter, except: readonly string[] = []): void {
  pushApart(ctx, f, except)
  standUpContacted(ctx, f)
}

/**
 * Blaze (R-3.13 step 2): an Active burning fighter moves 2D6" in a random direction (scatter), stopping where its base would
 * meet a wall, closed door, obstacle or another base (ruling), then the pushed-apart step. Returns the inches moved.
 */
export function blazeMove(ctx: Ctx, f: Fighter): number {
  const s = ctx.state
  const k = constants(s).blaze
  const distance = rollExpr(ctx, 'blazeMove', k.moveDice)
  const deg = ctx.rollScatter('blazeDirection')
  const a = (deg * Math.PI) / 180
  const start = { x: f.pos.x, z: f.pos.z }
  const end = slide(s, f, Math.sin(a), Math.cos(a), distance)
  const moved = Math.hypot(end.x - start.x, end.z - start.z)
  if (moved > 0) placeAlong(ctx, f, 'blaze', end, distance, a)
  afterInvoluntary(ctx, f)
  return moved
}

// ---------------------------------------------------------------------------
// Charge paths (R-7.6)
// ---------------------------------------------------------------------------

/** How far inside contact distance the charge end point sits (well inside the 0.02" contact tolerance). */
const CONTACT_IN = 0.005

function pathLength(start: Vec2, wps: readonly Vec2[]): number {
  let n = 0
  let prev = start
  for (const w of wps) {
    n += Math.hypot(w.x - prev.x, w.z - prev.z)
    prev = w
  }
  return n
}

/** Path length along the polyline at which the centre first comes within `r` of `c`, or null. */
export function firstWithin(start: Vec2, wps: readonly Vec2[], c: Vec2, r: number): number | null {
  let acc = 0
  let a = start
  if (Math.hypot(a.x - c.x, a.z - c.z) <= r) return 0
  for (const b of wps) {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len > 1e-12) {
      // |a + t d - c|^2 = r^2, smallest t in [0, 1]
      const fx = a.x - c.x
      const fz = a.z - c.z
      const A = dx * dx + dz * dz
      const B = 2 * (fx * dx + fz * dz)
      const C = fx * fx + fz * fz - r * r
      const disc = B * B - 4 * A * C
      if (disc >= 0) {
        const t = (-B - Math.sqrt(disc)) / (2 * A)
        if (t >= 0 && t <= 1) return acc + t * len
      }
    }
    acc += len
    a = b
  }
  return null
}

/**
 * The shortest legal charge route to base contact with `target` (R-7.6 ruling: the engine makes the path): it may pass within
 * 1" of enemies but not through any enemy base, nor through walls or closed doors; friends are passed through. Contact
 * points round the target are tried from the direct approach outward. Waypoints after the start and the cost (length plus
 * obstacle crossings), or null when the target cannot be reached at all.
 */
export function chargeRoute(state: GameState, f: Fighter, target: Fighter): { wps: Vec2[]; cost: number } | null {
  const D = f.baseRadius + target.baseRadius + CONTACT_IN
  const start = { x: f.pos.x, z: f.pos.z }
  const tc = { x: target.pos.x, z: target.pos.z }
  const base = Math.atan2(start.x - tc.x, start.z - tc.z)
  const nav = navFor(state.board.def, state.board.doors, f.baseRadius)
  // Acrobatic ignores enemies on the way: the route runs straight over them (planMove allows it below)
  const acrobatic = acrobaticFor(state, f)
  const avoid: AvoidDisc[] = acrobatic ? [] : enemiesOf(state, f).map((e) => ({ c: { x: e.pos.x, z: e.pos.z }, r: e.baseRadius + (e.id === target.id ? 0 : CONTACT_IN) }))
  let best: { wps: Vec2[]; cost: number } | null = null
  for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    const ang = base + (k * Math.PI) / 6
    const c = { x: round3(tc.x + Math.sin(ang) * D), z: round3(tc.z + Math.cos(ang) * D) }
    if (best && Math.hypot(c.x - start.x, c.z - start.z) >= best.cost) continue
    if (spotProblem(state, f, c)) continue
    const route = shortestRoute(nav, start, c, avoid)
    if (!route) continue
    const plan = planMove(state, f, route.path.slice(1), { maxInches: Infinity, oneInch: 'none', allowEmpty: true, ...(acrobatic ? { acrobatic } : {}) })
    if (!plan.ok) continue
    if (!best || plan.cost < best.cost) best = { wps: plan.path.slice(1), cost: plan.cost }
  }
  return best
}

/** Charge cost to base contact, or (with a Versatile `reach`) to within that reach of the target; Infinity if unreachable. */
export function chargeCost(state: GameState, f: Fighter, target: Fighter, reach: number | null = null): number {
  if (baseGap(f, target) <= CONTACT_EPS) return 0
  const route = chargeRoute(state, f, target)
  if (!route) return Infinity
  if (reach === null) return route.cost
  const start = { x: f.pos.x, z: f.pos.z }
  const s = firstWithin(start, route.wps, { x: target.pos.x, z: target.pos.z }, f.baseRadius + target.baseRadius + reach - 0.001)
  if (s === null) return route.cost
  return Math.min(route.cost, s + (route.cost - pathLength(start, route.wps)))
}

export interface ChargePlan {
  /** waypoints after the start ([] = the charger stays where it is) */
  wps: Vec2[]
  cost: number
  /** ended in base contact with the target, or within the Versatile reach that was asked for */
  reached: boolean
}

/**
 * The engine's charge move (R-7.6): the shortest route to base contact; with a Versatile `reach` it stops as soon as it is
 * within that reach of the target. If the allowance (M + D3) falls short it goes as far as it can along the route but never
 * ends within 1" of an enemy it is not touching (so it stops 1" short of the target).
 */
export function chargeMove(state: GameState, f: Fighter, target: Fighter, allowance: number, reach: number | null = null): ChargePlan {
  const none: ChargePlan = { wps: [], cost: 0, reached: false }
  const route = chargeRoute(state, f, target)
  if (!route) return none
  const start = { x: f.pos.x, z: f.pos.z }
  const tc = { x: target.pos.x, z: target.pos.z }
  if (reach !== null) {
    const at = firstWithin(start, route.wps, tc, f.baseRadius + target.baseRadius + reach - 0.001)
    if (at !== null) {
      const wps = at > 0 ? truncatePath(start, route.wps, at) : []
      const end = wps.length ? wps[wps.length - 1]! : start
      const plan = wps.length ? planMove(state, f, wps, { maxInches: allowance, oneInch: 'none', ...(acrobaticFor(state, f) ? { acrobatic: true } : {}) }) : null
      if ((!plan || plan.ok) && !spotProblem(state, f, end, { oneInch: true })) return { wps, cost: plan && plan.ok ? plan.cost : 0, reached: true }
    }
  }
  if (route.cost <= allowance + LENGTH_TOLERANCE) return { wps: route.wps, cost: route.cost, reached: true }
  const total = pathLength(start, route.wps)
  for (let s = Math.min(allowance, total); s > 0.005; s -= 0.01) {
    const wps = truncatePath(start, route.wps, s)
    if (wps.length === 0) break
    if (spotProblem(state, f, wps[wps.length - 1]!, { oneInch: true })) continue
    const plan = planMove(state, f, wps, { maxInches: allowance, oneInch: 'none', ...(acrobaticFor(state, f) ? { acrobatic: true } : {}) })
    if (plan.ok) return { wps, cost: plan.cost, reached: false }
  }
  return none
}

// ---------------------------------------------------------------------------
// Escapes: Retreat (R-7.9) and Running for Cover (R-12.4)
// ---------------------------------------------------------------------------

export interface EscapeOption {
  wps: Vec2[]
  end: Vec2
  length: number
}

/**
 * Candidate end points for an escape move with legal paths: two rings round the fighter and the nearby wall corners (the
 * spots out of sight). The 1" rule holds except toward the enemies it starts within 1" of (it is leaving them); with
 * `endClear` the end must be more than 1" from every enemy. Staying put is not included.
 */
export function escapeOptions(state: GameState, f: Fighter, maxInches: number, endClear: boolean): EscapeOption[] {
  const out: EscapeOption[] = []
  if (!(maxInches > 0)) return out
  const def = state.board.def
  const start = { x: f.pos.x, z: f.pos.z }
  const limit = constants(state).radii.oneInchRule
  const nav = navFor(def, state.board.doors, f.baseRadius)
  const avoid: AvoidDisc[] = oneInchEnemies(state, f)
    .filter((e) => Math.hypot(e.pos.x - start.x, e.pos.z - start.z) - e.baseRadius - f.baseRadius >= limit - 1e-6)
    .map((e) => ({ c: { x: e.pos.x, z: e.pos.z }, r: e.baseRadius + limit + 0.01 }))
  const cands: Vec2[] = []
  for (const frac of [1, 0.5]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 2 * Math.PI
      cands.push({ x: round3(start.x + Math.sin(a) * maxInches * frac * 0.98), z: round3(start.z + Math.cos(a) * maxInches * frac * 0.98) })
    }
  }
  const corners = nav
    .graph()
    .nodes.map((n) => ({ n, d: Math.hypot(n.x - start.x, n.z - start.z) }))
    .filter(({ d }) => d > 0.25 && d <= maxInches)
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map(({ n }) => ({ x: round3(n.x), z: round3(n.z) }))
  cands.push(...corners)
  const seen = new Set<string>()
  for (const c of cands) {
    const key = `${c.x},${c.z}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!insideOutline(def, c) || spotProblem(state, f, c, { oneInch: endClear })) continue
    let plan = planMove(state, f, [c], { maxInches, oneInch: 'enemy', endClear })
    if (!plan.ok) {
      const route = shortestRoute(nav, start, c, avoid)
      if (!route || route.length > maxInches + LENGTH_TOLERANCE) continue
      plan = planMove(state, f, route.path.slice(1), { maxInches, oneInch: 'enemy', endClear })
      if (!plan.ok) continue
    }
    out.push({ wps: plan.path.slice(1), end: plan.end, length: plan.cost })
  }
  return out
}

const minEnemyGap = (state: GameState, f: Fighter, c: Vec2): number => {
  let m = Infinity
  for (const e of enemiesOf(state, f)) m = Math.min(m, Math.hypot(e.pos.x - c.x, e.pos.z - c.z) - e.baseRadius - f.baseRadius)
  return m
}

/** The Retreat end point the engine suggests: the candidate farthest from every enemy (shortest path on ties), or null. */
export function retreatSuggestion(state: GameState, f: Fighter, maxInches: number): EscapeOption | null {
  let best: { o: EscapeOption; gap: number } | null = null
  for (const o of escapeOptions(state, f, maxInches, true)) {
    const gap = minEnemyGap(state, f, o.end)
    if (!best || gap > best.gap + 1e-9 || (Math.abs(gap - best.gap) <= 1e-9 && o.length < best.o.length)) best = { o, gap }
  }
  return best?.o ?? null
}

export interface CoverScore {
  /** (1) more than 3" (path) from every enemy */
  clear: boolean
  /** (2) out of line of sight of every enemy */
  hidden: boolean
  /** (3) in partial or full cover from every enemy that can see it */
  covered: boolean
  /** (4) the smallest straight base gap to an enemy */
  gap: number
  length: number
}

/** Score one Running for Cover end point by the four criteria of R-12.4. */
export function coverScore(state: GameState, f: Fighter, c: Vec2, length: number): CoverScore {
  const radius = constants(state).runForCover.clearOfEnemies
  const fake: Fighter = { ...f, pos: { x: c.x, y: 0, z: c.z } }
  let clear = true
  let hidden = true
  let covered = true
  let gap = Infinity
  for (const e of enemiesOf(state, f)) {
    const ec = { x: e.pos.x, z: e.pos.z }
    const straight = Math.hypot(ec.x - c.x, ec.z - c.z) - e.baseRadius - f.baseRadius
    gap = Math.min(gap, straight)
    if (clear && straight <= radius + 1e-9 && pathGapPoints(state, ec, e.baseRadius, c, f.baseRadius) <= radius + 1e-9) clear = false
    if (hasLos(state, e, fake)) {
      hidden = false
      if (covered && coverFrom(state, ec, fake, e).cover === 'none') covered = false
    }
  }
  return { clear, hidden, covered, gap, length }
}

function better(a: CoverScore, b: CoverScore): boolean {
  if (a.clear !== b.clear) return a.clear
  if (a.hidden !== b.hidden) return a.hidden
  if (a.covered !== b.covered) return a.covered
  if (Math.abs(a.gap - b.gap) > 1e-6) return a.gap > b.gap
  return a.length < b.length - 1e-9
}

/**
 * Running for Cover (R-12.4 ruling): the engine scores staying put and every candidate end point within `maxInches` by
 * the four criteria in order (more than 3" from every enemy; out of every enemy's sight; in cover; as far from enemies as
 * possible) and breaks ties by the shorter path. Returns the waypoints ([] = stay) and the score.
 */
export function runForCoverPick(state: GameState, f: Fighter, maxInches: number): { wps: Vec2[]; score: CoverScore } {
  const here = { x: f.pos.x, z: f.pos.z }
  let best = { wps: [] as Vec2[], score: coverScore(state, f, here, 0) }
  for (const o of escapeOptions(state, f, maxInches, false)) {
    const score = coverScore(state, f, o.end, o.length)
    if (better(score, best.score)) best = { wps: o.wps, score }
  }
  return best
}
