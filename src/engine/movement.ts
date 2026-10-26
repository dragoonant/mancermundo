// MOV: move.* (R-4.1 to R-4.4, R-11.6, R-12). Reposition, Dash, Fall Back and Charge are one
// continuous `move.path` decision: waypoints are straight-line increments validated one by one
// (sampled every half inch) against the killzone edge, terrain, bases and control range rules.
import type { MoveSegmentEvent } from './events'
import { cancelAction, finishAction } from './firefight'
import {
  EPS,
  bearing,
  dist2,
  distToPolygon,
  incrementCost,
  lerp2,
  pointInPolygon,
  round3,
  segmentPolygonIntervals,
} from './geometry'
import { bodyOf, enemiesInControlRange, inControlRange, type Body } from './measure'
import { chargeFromControlRange } from './abilities'
import { getCodeHook, markFired } from './code-hooks'
import { reject, type Handled, type ModuleDef } from './registry'
import { effectiveMove, enemiesOf, friendsOf, getOp } from './state'
import {
  discBlockedBy,
  insideKillzone,
  placementProblem,
  sameLevel,
  terrainOf,
  walkableSolidAt,
  type Solid,
  type TerrainIndex,
} from './terrain'
import type { Action, GameState, Marker, MoveConstraints, Operative, Rejection, Vec2, Vec3, Waypoint } from './types'

export type MoveKind = 'reposition' | 'dash' | 'fallBack' | 'charge'

export const SAMPLE_STEP = 0.5
export const MAX_WAYPOINTS = 12
export const DASH_MAX = 3
export const CHARGE_BONUS = 2
export const COUNTERACT_CAP = 2
export const CLIMB_REACH = 3
export const MIN_CLIMB = 2
export const FREE_DROP = 2
export const JUMP_MAX = 4
export const JUMP_MIN_HEIGHT = 2

export interface MoveBreakdown {
  horizontal: number
  accessible: number
  climb: number
  drop: number
}

export interface MovePlan {
  ok: true
  end: Vec3
  facing: number
  segments: MoveSegmentEvent[]
  cost: number
  maxInches: number
  breakdown: MoveBreakdown
}

export type PlanResult = MovePlan | { ok: false; rejection: Rejection }

/** Total movement allowed for a move action, counting all modifiers (R-4.1 to R-4.4, R-3.12). */
export function moveLimit(op: Operative, kind: MoveKind, counteract: boolean): number {
  const move = effectiveMove(op)
  let limit = kind === 'dash' ? Math.min(DASH_MAX, move) : kind === 'charge' ? move + CHARGE_BONUS : move
  if (counteract) limit = Math.min(limit, COUNTERACT_CAP)
  return limit
}

export function moveConstraints(op: Operative, kind: MoveKind, counteract: boolean): MoveConstraints {
  return {
    kind,
    operativeId: op.id,
    origin: { ...op.pos },
    baseRadius: op.baseRadius,
    maxInches: moveLimit(op, kind, counteract),
    allowClimb: kind !== 'dash',
    allowEnterEnemyControlRange: kind === 'fallBack' || kind === 'charge',
    ...(kind === 'charge' ? { mustEndInControlRangeOf: 'enemy' as const } : {}),
    mustEndOutsideControlRange: kind !== 'charge',
    counteract,
  }
}

function fail(code: Rejection['code'], reason: string, details?: Record<string, unknown>): PlanResult {
  return { ok: false, rejection: details ? { code, reason, details } : { code, reason } }
}

function parseWaypoints(raw: unknown): Waypoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_WAYPOINTS) return null
  const out: Waypoint[] = []
  for (const w of raw as unknown[]) {
    if (!w || typeof w !== 'object') return null
    const r = w as Record<string, unknown>
    if (typeof r.x !== 'number' || typeof r.z !== 'number' || !Number.isFinite(r.x) || !Number.isFinite(r.z)) return null
    if (r.y !== undefined && (typeof r.y !== 'number' || !Number.isFinite(r.y))) return null
    if (r.jump !== undefined && typeof r.jump !== 'boolean') return null
    const wp: Waypoint = { x: round3(r.x), z: round3(r.z) }
    if (r.y !== undefined) wp.y = round3(r.y as number)
    if (r.jump === true) wp.jump = true
    out.push(wp)
  }
  return out
}

function solidsContaining(idx: TerrainIndex, p: Vec2): Set<string> {
  const out = new Set<string>()
  for (const s of idx.solids) if (pointInPolygon(p, s.polygon)) out.add(s.partId)
  return out
}

/**
 * Validate a whole path increment by increment and price it. Pure: used by `validate`, `step`
 * and by bots/AI to probe candidate paths.
 */
export function planMove(
  state: GameState,
  op: Operative,
  kind: MoveKind,
  raw: unknown,
  counteract = false,
  /** M2b-game: a smaller limit set by the action (Move With Barricade: Move minus 2") */
  limitOverride?: number,
): PlanResult {
  const wps = parseWaypoints(raw)
  if (!wps) return fail('E_SCHEMA', `a path is 1 to ${MAX_WAYPOINTS} waypoints with numeric x and z`)

  const idx = terrainOf(state.map)
  const r = op.baseRadius
  const h = op.height
  const maxInches = limitOverride === undefined ? moveLimit(op, kind, counteract) : Math.min(limitOverride, moveLimit(op, kind, counteract))
  const enemies = enemiesOf(state, op)
  const friends = friendsOf(state, op)
  const accessibles = idx.solids.filter((s) => s.accessible)
  // M2b-game: Breach markers make thin parts of their feature Accessible near the marker (T-KOM.12); Razor Wire is
  // Obstructing (+1" per crossing, M-5.4); a Ladder shortens one climb of the feature it leans on (M-5.9).
  const breaches = state.markers.filter((m) => m.equipmentId === 'breach' && m.featureId)
  const nearBreach = (p: Vec2): Marker | null => {
    for (const m of breaches) if (dist2(p, m.pos) - r - 20 / 25.4 / 2 <= 1 + EPS) return m
    return null
  }
  const thinParts = (m: Marker): Solid[] => idx.solids.filter((s) => s.featureId === m.featureId && s.thickness !== null && s.thickness <= 1 + EPS)
  const wires = idx.solids.filter((s) => s.tags.includes('obstructing'))
  const ladders = idx.solids.filter((s) => s.equipmentId === 'core.e.ladders')
  let ladderUsed = false
  /** +1" for every Accessible part the centre line passes through (R-11.6) */
  const countAccessible = (a: Vec2, b: Vec2, level: number): number => {
    let n = 0
    for (const s of accessibles) {
      if (level + 0.01 >= s.top) continue
      if (segmentPolygonIntervals(a, b, s.polygon).length > 0) n++
    }
    const m = nearBreach(a) ?? nearBreach(b)
    if (m) {
      for (const s of thinParts(m)) {
        if (level + 0.01 >= s.top || s.accessible) continue
        if (segmentPolygonIntervals(a, b, s.polygon).length > 0) {
          n++
          markFired('breach')
        }
      }
    }
    for (const w of wires) {
      if (level + 0.01 >= w.top) continue
      if (segmentPolygonIntervals(a, b, w.polygon).length > 0) {
        n++
        markFired('razorWire')
      }
    }
    return n
  }
  // Mobile: a Charge may start inside an enemy control range and leave it (T-AOD.16)
  const exemptStart: Set<string> = kind === 'charge' && chargeFromControlRange(state, op) ? new Set(enemiesInControlRange(state, op, op.seat).map((e) => e.id)) : new Set()
  const me = (pos: Vec3): Body => ({ id: op.id, pos, baseRadius: r, height: h })

  const crOf = (pos: Vec3): Set<string> => {
    const out = new Set<string>()
    const b = me(pos)
    for (const e of enemies) if (inControlRange(state, b, bodyOf(e))) out.add(e.id)
    return out
  }
  // An enemy with no friendly operative in its control range is "lone" (R-4.1, R-4.4).
  const lone = new Map<string, boolean>()
  for (const e of enemies) lone.set(e.id, !friends.some((f) => inControlRange(state, bodyOf(f), bodyOf(e))))
  const locked = new Set<string>()

  const crCheck = (pos: Vec3): Rejection | null => {
    if (kind === 'fallBack') return null
    const set = crOf(pos)
    if (kind === 'charge') {
      for (const id of locked) {
        if (!set.has(id)) {
          return { code: 'E_CONTROL_RANGE', reason: 'a Charge that enters a lone enemy control range cannot leave it', details: { enemy: id } }
        }
      }
      for (const id of set) if (lone.get(id) && !exemptStart.has(id)) locked.add(id)
      return null
    }
    for (const id of set) {
      if (lone.get(id)) {
        return { code: 'E_CONTROL_RANGE', reason: 'cannot enter an enemy control range unless a friendly operative is already in it', details: { enemy: id } }
      }
    }
    return null
  }

  /** bounds, enemy bases and terrain for the disc centred on p at the given level */
  const checkSample = (p: Vec2, level: number, skip: Set<string> | undefined): Rejection | null => {
    if (!insideKillzone(idx, p, r)) return { code: 'E_OUT_OF_RANGE', reason: 'the path crosses the killzone edge' }
    for (const e of enemies) {
      if (Math.abs(e.pos.y - level) < 0.5 && dist2(p, e.pos) < r + e.baseRadius - EPS) {
        return { code: 'E_OVERLAP', reason: 'cannot move through an enemy operative', details: { enemy: e.id } }
      }
    }
    // Accessible parts (R-11.6): only the centre of the base needs to pass through, so the walls
    // of the same feature are ignored while the base is at the doorway.
    let doorFeatures: Set<string> | undefined
    for (const s of accessibles) {
      if (level + 0.01 >= s.top) continue
      if (distToPolygon(p, s.polygon) <= r + EPS) (doorFeatures ??= new Set()).add(s.featureId)
    }
    let skipSet = skip
    if (doorFeatures) {
      skipSet = new Set(skip ?? [])
      for (const s of idx.solids) if (doorFeatures.has(s.featureId)) skipSet.add(s.partId)
    }
    // Breach: thin parts of the marked feature are Accessible while the base is within 1" of the marker
    const bm = nearBreach(p)
    if (bm) {
      for (const s of thinParts(bm)) {
        if (level + 0.01 >= s.top || distToPolygon(p, s.polygon) > r + EPS) continue
        skipSet = new Set(skipSet ?? [])
        skipSet.add(s.partId)
      }
    }
    const blocker = discBlockedBy(idx, p, level, r, h, skipSet)
    if (blocker) return { code: 'E_OVERLAP', reason: 'the path is blocked by terrain', details: { part: blocker.partId } }
    return null
  }

  let cur: Vec3 = { ...op.pos }
  let inAir = false
  let climbGroup = 0
  let climbCost = 0
  let dropTotal = 0
  let horizCost = 0
  let accCost = 0
  let facing = op.facing
  const segments: MoveSegmentEvent[] = []
  const closeClimb = () => {
    if (climbGroup > 0) {
      climbCost += Math.max(MIN_CLIMB, Math.ceil(climbGroup - EPS))
      climbGroup = 0
    }
  }

  for (let i = 0; i < wps.length; i++) {
    const w = wps[i]!
    const y0 = cur.y
    const y1 = w.y ?? y0
    const next: Vec3 = { x: w.x, y: y1, z: w.z }
    const len = dist2(cur, next)
    const isJump = w.jump === true
    const isClimb = !isJump && y1 > y0 + 0.001
    const isDrop = !isJump && y1 < y0 - 0.001
    if (len < EPS && !isClimb && !isDrop) return fail('E_SCHEMA', 'a zero-length increment moves nothing')
    const n = Math.max(1, Math.ceil(len / SAMPLE_STEP))
    let kindOfSegment: MoveSegmentEvent['kind'] = 'walk'
    let insignificantClimb = false

    if (isJump) {
      kindOfSegment = 'jump'
      if (inAir) return fail('E_NO_PATH', 'after a jump the operative must drop or climb')
      if (y0 <= JUMP_MIN_HEIGHT + EPS) return fail('E_NO_PATH', 'a jump starts from Vantage terrain more than 2" above the floor')
      const s0 = walkableSolidAt(idx, cur, y0)
      if (!s0 || !s0.floors.some((f) => sameLevel(f, y0))) return fail('E_NO_PATH', 'a jump must start from Vantage terrain')
      if (len > JUMP_MAX + EPS) return fail('E_OUT_OF_RANGE', 'a jump covers at most 4" horizontally')
      if (y1 > y0 + 1 + EPS) return fail('E_NO_PATH', 'a jump cannot land more than 1" higher; climb afterwards')
      const skip = solidsContaining(idx, cur)
      for (let k = 1; k <= n; k++) {
        const p = lerp2(cur, next, k / n)
        const rej = checkSample(p, y0, skip) ?? crCheck({ x: p.x, y: y0, z: p.z })
        if (rej) return { ok: false, rejection: rej }
      }
      if (y1 <= 0.01) {
        if (discBlockedBy(idx, next, 0, r, h)) return fail('E_OVERLAP', 'the jump lands inside terrain')
      } else if (walkableSolidAt(idx, next, y1)) {
        if (discBlockedBy(idx, next, y1, r, h)) return fail('E_OVERLAP', 'the jump lands inside terrain')
      } else {
        inAir = true
      }
      if (!inAir && y1 < y0 - 0.001) dropTotal += y0 - y1
    } else if (isClimb) {
      kindOfSegment = 'climb'
      if (inAir) return fail('E_NO_PATH', 'after a jump the operative must drop or climb')
      if (y1 - y0 > CLIMB_REACH + EPS) return fail('E_NO_PATH', 'a climb reaches at most 3" vertically')
      const s1 = walkableSolidAt(idx, next, y1)
      if (!s1) return fail('E_NO_PATH', 'there is no surface to climb onto at that height')
      insignificantClimb = s1.insignificant
      if (kind === 'dash' && !insignificantClimb) return fail('E_NO_PATH', 'Dash cannot climb')
      const skip = solidsContaining(idx, next)
      let upper = false
      for (let k = 1; k <= n; k++) {
        const p = lerp2(cur, next, k / n)
        if (!upper && pointInPolygon(p, s1.polygon)) upper = true
        const level = upper ? y1 : y0
        if (level > 0.01 && !walkableSolidAt(idx, p, level)) return fail('E_NO_PATH', 'the path leaves the surface it is walking on')
        const rej = checkSample(p, level, upper ? undefined : skip) ?? crCheck({ x: p.x, y: level, z: p.z })
        if (rej) return { ok: false, rejection: rej }
      }
      if (!insignificantClimb) {
        // a Ladder against the climbed feature, in control range throughout, makes one climb per action 1" (M-5.9)
        const ladder = ladderUsed
          ? undefined
          : ladders.find(
              (l) =>
                l.leansOn !== null &&
                idx.byPart.get(l.leansOn)?.featureId === s1.featureId &&
                distToPolygon(cur, l.polygon) - r <= 1 + EPS &&
                distToPolygon(next, l.polygon) - r <= 1 + EPS,
            )
        if (ladder) {
          ladderUsed = true
          closeClimb()
          climbCost += 1
          markFired('ladders')
        } else climbGroup += y1 - y0
      }
    } else if (isDrop) {
      kindOfSegment = 'drop'
      let s0: Solid | null = null
      if (!inAir) {
        if (y0 <= 0.01) return fail('E_NO_PATH', 'there is nothing to drop from')
        s0 = walkableSolidAt(idx, cur, y0)
        if (!s0) return fail('E_NO_PATH', 'there is nothing to drop from')
      }
      let air = inAir
      let lastSupportedT = 0
      let skipAir = solidsContaining(idx, cur)
      for (let k = 1; k <= n; k++) {
        const t = k / n
        const p = lerp2(cur, next, t)
        if (!air && walkableSolidAt(idx, p, y0)) {
          lastSupportedT = t
          skipAir = solidsContaining(idx, p)
          const rej = checkSample(p, y0, undefined) ?? crCheck({ x: p.x, y: y0, z: p.z })
          if (rej) return { ok: false, rejection: rej }
        } else {
          air = true
          const rej = checkSample(p, y1, skipAir) ?? crCheck({ x: p.x, y: y1, z: p.z })
          if (rej) return { ok: false, rejection: rej }
        }
      }
      const airRun = len * (1 - lastSupportedT)
      if (airRun > 2 * r + 0.5 + EPS) return fail('E_NO_PATH', 'a drop cannot cross open space; use a jump')
      if (y1 > 0.01 && !walkableSolidAt(idx, next, y1)) return fail('E_NO_PATH', 'there is no surface to drop onto at that height')
      if (discBlockedBy(idx, next, y1, r, h)) return fail('E_OVERLAP', 'the drop lands inside terrain')
      inAir = false
      // A drop above Insignificant terrain is ignored (R-11.7).
      if (!(s0 && s0.insignificant)) dropTotal += y0 - y1
    } else {
      if (inAir) return fail('E_NO_PATH', 'after a jump the operative must drop or climb')
      for (let k = 1; k <= n; k++) {
        const p = lerp2(cur, next, k / n)
        if (y0 > 0.01 && !walkableSolidAt(idx, p, y0)) return fail('E_NO_PATH', 'the path leaves the surface it is walking on')
        const rej = checkSample(p, y0, undefined) ?? crCheck({ x: p.x, y: y0, z: p.z })
        if (rej) return { ok: false, rejection: rej }
      }
      if (discBlockedBy(idx, next, y0, r, h)) return fail('E_OVERLAP', 'the path ends inside terrain')
    }

    if (!(isClimb && !insignificantClimb)) closeClimb()
    const accessibleHere = countAccessible(cur, next, Math.min(y0, y1))
    const segCost = incrementCost(len) + accessibleHere
    horizCost += incrementCost(len)
    accCost += accessibleHere
    segments.push({ from: { ...cur }, to: next, length: round3(len), cost: segCost, kind: kindOfSegment })
    if (len > EPS) facing = bearing(cur, next)
    cur = next
    if (horizCost + accCost > maxInches + EPS) {
      return fail('E_OUT_OF_RANGE', `the move costs more than ${maxInches}"`, { cost: horizCost + accCost, maxInches })
    }
  }
  closeClimb()
  if (inAir) return fail('E_NO_PATH', 'a move cannot end mid-air after a jump')

  const dropCost = Math.ceil(Math.max(0, dropTotal - FREE_DROP) - EPS)
  const total = horizCost + accCost + climbCost + Math.max(0, dropCost)
  if (total > maxInches + EPS) {
    return fail('E_OUT_OF_RANGE', `the move costs ${total}" but only ${maxInches}" is allowed`, {
      cost: total,
      maxInches,
      horizontal: horizCost,
      accessible: accCost,
      climb: climbCost,
      drop: Math.max(0, dropCost),
    })
  }

  const placement = placementProblem(state, { id: op.id, pos: cur, radius: r, height: h })
  if (placement) return { ok: false, rejection: placement }

  const endCr = crOf(cur)
  if (kind === 'charge') {
    if (endCr.size === 0) return fail('E_CONTROL_RANGE', 'a Charge must end in an enemy control range')
  } else if (endCr.size > 0) {
    return fail('E_CONTROL_RANGE', 'a move cannot finish in an enemy control range', { enemies: [...endCr] })
  }

  return {
    ok: true,
    end: cur,
    facing,
    segments,
    cost: total,
    maxInches,
    breakdown: { horizontal: horizCost, accessible: accCost, climb: climbCost, drop: Math.max(0, dropCost) },
  }
}

function handleMovePath(state: GameState, action: Action): Handled {
  const act = state.firefight.activation
  if (!act || !act.declared) return reject('E_WRONG_DECISION', 'no move is declared')
  const op = getOp(state, act.operativeId)
  // M2b-game: an action "treated as" a move (Move With Barricade) names the move kind and its own limit
  const params = act.declared.params
  const kind = ((params?.moveKind as string | undefined) ?? act.declared.action) as MoveKind
  const limit = params?.maxInches as number | undefined
  if (action.type === 'pass') {
    return { run: (ctx) => cancelAction(ctx) }
  }
  if (action.type !== 'move.path') return reject('E_WRONG_DECISION', 'expected a path')
  const plan = planMove(state, op, kind, action.payload.waypoints, act.counteract, limit)
  if (!plan.ok) return { rejection: plan.rejection }
  return {
    run(ctx) {
      const o = ctx.state.operatives[op.id]!
      const from = { ...o.pos }
      o.pos = plan.end
      o.facing = plan.facing
      ctx.emit({
        type: 'OperativeMoved',
        operativeId: o.id,
        action: kind,
        from,
        to: plan.end,
        segments: plan.segments,
        cost: plan.cost,
        maxInches: plan.maxInches,
      })
      const after = params?.afterMove
      if (typeof after === 'string') getCodeHook(after)?.afterMove?.(ctx, o, from, params ?? {})
      finishAction(ctx)
    },
  }
}

export const movementModule: ModuleDef = {
  id: 'movement',
  namespaces: ['move'],
  handle(state, action) {
    return handleMovePath(state, action)
  },
}
