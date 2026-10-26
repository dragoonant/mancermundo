// MOV: move.* (R-4.1 to R-4.4, R-11.6, R-12). Reposition, Dash, Fall Back and Charge are one
// continuous `move.path` decision: waypoints are straight-line increments validated one by one
// (sampled every half inch) against the killzone edge, terrain, bases and control range rules.
import type { MoveSegmentEvent } from './events'
import { cancelAction, finishAction, openFirefightWindow } from './firefight'
import {
  EPS,
  bearing,
  dist2,
  incrementCost,
  lerp2,
  pointInPolygon,
  round3,
  segmentPolygonIntervals,
} from './geometry'
import { bodyOf, enemiesInControlRange, inControlRange, type Body } from './measure'
import { angleDelta, axisOf, discCentres, footprintDistToPolygon, footprintOf, footprintsOverlap, ovalAxis, rotationCost, type Footprint } from './footprint'
import { chargeFromControlRange } from './abilities'
import { providerMoveProblem, providerCanFly, providerFlyLimit, providerMoveLimitDelta, providerMoveRestrictions, providerMoveSurcharge } from './team-rules'
import { getCodeHook, markFired } from './code-hooks'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { effectiveMove, enemiesOf, friendsOf, getOp } from './state'
import {
  discBlockedBy,
  insideKillzone,
  obstructs,
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
  /** M9 batch B: inches an oval base spent turning in place at the end of the move */
  rotation?: number
  /** batch C shared: the Obstructing crossings (Razor Wire) among `accessible`, which still counts them for older readers */
  obstructing?: number
  /** batch C shared: the cost charged for each climb in order (a run of climb increments, R-12.2; a Ladder climb is 1) */
  climbs?: number[]
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
export function moveLimit(op: Operative, kind: MoveKind, counteract: boolean, state?: GameState): number {
  const move = effectiveMove(op, state)
  let limit = kind === 'dash' ? Math.min(DASH_MAX, move) : kind === 'charge' ? move + CHARGE_BONUS : move
  // M9 batch C: a change to one move kind only (Strike Fast: Reposition +1"; Boost: Charge +2" more)
  if (state) limit = Math.max(0, limit + providerMoveLimitDelta(state, op, kind))
  if (counteract) limit = Math.min(limit, COUNTERACT_CAP)
  return limit
}

export function moveConstraints(op: Operative, kind: MoveKind, counteract: boolean, state?: GameState): MoveConstraints {
  return {
    kind,
    operativeId: op.id,
    origin: { ...op.pos },
    baseRadius: op.baseRadius,
    maxInches: moveLimit(op, kind, counteract, state),
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
  /** M9 prep: a Charge that must end in this enemy's control range (Assassinate, Quicksilver Strike) */
  endWithinCrOf?: string,
  /** M9 batch B: an oval base turns in place to this facing at the end (radians); round bases ignore it */
  endFacing?: number,
  /**
   * M9 batch B: a forced move of `op` by another rule (Knux Smash): `limitOverride` is the distance, and the moved
   * operative's own control-range limits (R-4.1) do not apply; it must still end where it can be placed
   */
  forced = false,
): PlanResult {
  const wps = parseWaypoints(raw)
  if (!wps) return fail('E_SCHEMA', `a path is 1 to ${MAX_WAYPOINTS} waypoints with numeric x and z`)

  const idx = terrainOf(state.map)
  const r = op.baseRadius
  const h = op.height
  // M9 batch B: an oval base keeps its orientation while it translates (footprint.ts); `axis` changes only when
  // it turns at the end of the move
  const oval = !!op.ovalHalfAxis
  let axis: Vec2 | undefined = footprintOf(op).axis
  const fpAt = (p: Vec2): Footprint => (axis ? { pos: p, baseRadius: r, axis } : { pos: p, baseRadius: r })
  const discsAt = (p: Vec2): Vec2[] => discCentres(fpAt(p))
  const blockedAt = (p: Vec2, y: number): boolean => discsAt(p).some((c) => discBlockedBy(idx, c, y, r, h) !== null)
  const maxInches = forced && limitOverride !== undefined ? limitOverride : limitOverride === undefined ? moveLimit(op, kind, counteract, state) : Math.min(limitOverride, moveLimit(op, kind, counteract, state))
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
  let obsCost = 0
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
        obsCost++
        markFired('razorWire')
      }
    }
    return n
  }
  // Mobile: a Charge may start inside an enemy control range and leave it (T-AOD.16)
  const exemptStart: Set<string> = kind === 'charge' && chargeFromControlRange(state, op) ? new Set(enemiesInControlRange(state, op, op.seat).map((e) => e.id)) : new Set()
  const me = (pos: Vec3): Body => (axis ? { id: op.id, pos, baseRadius: r, height: h, axis } : { id: op.id, pos, baseRadius: r, height: h })

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
    if (kind === 'fallBack' || forced) return null
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
  const checkSample = (p: Vec2, level: number, skip: Set<string> | undefined, prev?: Vec2): Rejection | null => {
    const discs = discsAt(p)
    if (!discs.every((c) => insideKillzone(idx, c, r))) return { code: 'E_OUT_OF_RANGE', reason: 'the path crosses the killzone edge' }
    for (const e of enemies) {
      if (Math.abs(e.pos.y - level) < 0.5 && (oval || e.ovalHalfAxis ? footprintsOverlap(fpAt(p), footprintOf(e)) : dist2(p, e.pos) < r + e.baseRadius - EPS)) {
        return { code: 'E_OVERLAP', reason: 'cannot move through an enemy operative', details: { enemy: e.id } }
      }
    }
    // Accessible parts (R-11.6): only the centre of the base needs to pass through, so the walls
    // of the same feature are ignored while the base is at the doorway.
    let doorFeatures: Set<string> | undefined
    for (const s of accessibles) {
      if (level + 0.01 >= s.top) continue
      if (footprintDistToPolygon(fpAt(p), s.polygon) <= EPS) (doorFeatures ??= new Set()).add(s.featureId)
    }
    let skipSet = skip
    if (doorFeatures) {
      skipSet = new Set(skip ?? [])
      for (const s of idx.solids) {
        if (!doorFeatures.has(s.featureId)) continue
        // the base may overlap the walls beside the doorway, but its centre must go through the doorway itself
        if (!s.accessible && obstructs(s, level, r, h) && !skip?.has(s.partId)) {
          const crossed = pointInPolygon(p, s.polygon) || (prev !== undefined && segmentPolygonIntervals(prev, p, s.polygon).some(([t0, t1]) => t1 - t0 > EPS))
          if (crossed) return { code: 'E_OVERLAP', reason: 'the centre of the base must pass through the doorway, not the wall beside it', details: { part: s.partId } }
        }
        skipSet.add(s.partId)
      }
    }
    // Breach: thin parts of the marked feature are Accessible while the base is within 1" of the marker
    const bm = nearBreach(p)
    if (bm) {
      for (const s of thinParts(bm)) {
        if (level + 0.01 >= s.top || footprintDistToPolygon(fpAt(p), s.polygon) > EPS) continue
        skipSet = new Set(skipSet ?? [])
        skipSet.add(s.partId)
      }
    }
    let blocker: Solid | null = null
    for (const c of discs) if ((blocker = discBlockedBy(idx, c, level, r, h, skipSet))) break
    if (blocker) return { code: 'E_OVERLAP', reason: 'the path is blocked by terrain', details: { part: blocker.partId } }
    return null
  }

  let cur: Vec3 = { ...op.pos }
  let inAir = false
  let climbGroup = 0
  let climbCost = 0
  const climbs: number[] = []
  let dropTotal = 0
  let horizCost = 0
  let accCost = 0
  let facing = op.facing
  const segments: MoveSegmentEvent[] = []
  const closeClimb = () => {
    if (climbGroup > 0) {
      const c = Math.max(MIN_CLIMB, Math.ceil(climbGroup - EPS))
      climbCost += c
      climbs.push(c)
      climbGroup = 0
    }
  }

  const restrictions = providerMoveRestrictions(state, op)
  for (let i = 0; i < wps.length; i++) {
    const w = wps[i]!
    const y0 = cur.y
    const y1 = w.y ?? y0
    const next: Vec3 = { x: w.x, y: y1, z: w.z }
    const len = dist2(cur, next)
    const isJump = w.jump === true
    const isClimb = !isJump && y1 > y0 + 0.001
    const isDrop = !isJump && y1 < y0 - 0.001
    // M9 batch C: movement a team rule rules out (C.A.T. Unit: no climbing, no jumping)
    if (isJump && restrictions.noJump) return fail('E_NO_PATH', `${op.name} cannot jump`)
    if (isClimb && restrictions.noClimb && walkableSolidAt(idx, next, y1)?.insignificant !== true) return fail('E_NO_PATH', `${op.name} cannot climb`)
    // M9 batch B: an oval base may turn on the spot (one waypoint at its own position plus a facing)
    const turnOnly = oval && endFacing !== undefined && wps.length === 1
    if (len < EPS && !isClimb && !isDrop && !turnOnly) return fail('E_SCHEMA', 'a zero-length increment moves nothing')
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
        const rej = checkSample(p, y0, skip, lerp2(cur, next, (k - 1) / n)) ?? crCheck({ x: p.x, y: y0, z: p.z })
        if (rej) return { ok: false, rejection: rej }
      }
      if (y1 <= 0.01) {
        if (blockedAt(next, 0)) return fail('E_OVERLAP', 'the jump lands inside terrain')
      } else if (walkableSolidAt(idx, next, y1)) {
        if (blockedAt(next, y1)) return fail('E_OVERLAP', 'the jump lands inside terrain')
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
        const rej = checkSample(p, level, upper ? undefined : skip, lerp2(cur, next, (k - 1) / n)) ?? crCheck({ x: p.x, y: level, z: p.z })
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
                footprintDistToPolygon(fpAt(cur), l.polygon) <= 1 + EPS &&
                footprintDistToPolygon(fpAt(next), l.polygon) <= 1 + EPS,
            )
        if (ladder) {
          ladderUsed = true
          closeClimb()
          climbCost += 1
          climbs.push(1)
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
          const rej = checkSample(p, y0, undefined, lerp2(cur, next, (k - 1) / n)) ?? crCheck({ x: p.x, y: y0, z: p.z })
          if (rej) return { ok: false, rejection: rej }
        } else {
          air = true
          const rej = checkSample(p, y1, skipAir, lerp2(cur, next, (k - 1) / n)) ?? crCheck({ x: p.x, y: y1, z: p.z })
          if (rej) return { ok: false, rejection: rej }
        }
      }
      const airRun = len * (1 - lastSupportedT)
      if (airRun > 2 * r + 0.5 + EPS) return fail('E_NO_PATH', 'a drop cannot cross open space; use a jump')
      if (y1 > 0.01 && !walkableSolidAt(idx, next, y1)) return fail('E_NO_PATH', 'there is no surface to drop onto at that height')
      if (blockedAt(next, y1)) return fail('E_OVERLAP', 'the drop lands inside terrain')
      inAir = false
      // A drop above Insignificant terrain is ignored (R-11.7).
      if (!(s0 && s0.insignificant)) dropTotal += y0 - y1
    } else {
      if (inAir) return fail('E_NO_PATH', 'after a jump the operative must drop or climb')
      for (let k = 1; k <= n; k++) {
        const p = lerp2(cur, next, k / n)
        if (y0 > 0.01 && !walkableSolidAt(idx, p, y0)) return fail('E_NO_PATH', 'the path leaves the surface it is walking on')
        const rej = checkSample(p, y0, undefined, lerp2(cur, next, (k - 1) / n)) ?? crCheck({ x: p.x, y: y0, z: p.z })
        if (rej) return { ok: false, rejection: rej }
      }
      if (blockedAt(next, y0)) return fail('E_OVERLAP', 'the path ends inside terrain')
    }

    if (!(isClimb && !insignificantClimb)) closeClimb()
    const accessibleHere = countAccessible(cur, next, Math.min(y0, y1))
    const segCost = incrementCost(len) + accessibleHere
    horizCost += incrementCost(len)
    accCost += accessibleHere
    segments.push({ from: { ...cur }, to: next, length: round3(len), cost: segCost, kind: kindOfSegment })
    if (len > EPS && !oval) facing = bearing(cur, next)
    cur = next
    if (horizCost + accCost > maxInches + EPS) {
      return fail('E_OUT_OF_RANGE', `the move costs more than ${maxInches}"`, { cost: horizCost + accCost, maxInches })
    }
  }
  closeClimb()
  if (inAir) return fail('E_NO_PATH', 'a move cannot end mid-air after a jump')

  // M9 batch B: an oval base may turn in place at the end; its long-axis end pays the arc (Hunter Clade FAQ)
  let rotation = 0
  if (oval && endFacing !== undefined && Math.abs(angleDelta(facing, endFacing)) > 1e-6) {
    const from = facing
    // the turn is an increment of its own, rounded up like any other (R-4.1)
    rotation = incrementCost(rotationCost(fpAt(cur), from, endFacing))
    const turn = angleDelta(from, endFacing)
    const steps = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 12)))
    for (let k = 1; k <= steps; k++) {
      const f = from + (turn * k) / steps
      const spec = { id: op.id, pos: cur, radius: r, height: h, ...axisOf(op, f) }
      const problem = placementProblem(state, spec)
      if (problem) return fail(problem.code, `the base cannot turn there: ${problem.reason}`, problem.details)
      if (kind !== 'fallBack' && kind !== 'charge') {
        axis = spec.axis
        const turning = crCheck(cur)
        if (turning) return { ok: false, rejection: turning }
      }
    }
    axis = ovalAxis(op.ovalHalfAxis, endFacing)
    facing = round3(endFacing)
  }

  const dropCost = Math.ceil(Math.max(0, dropTotal - FREE_DROP) - EPS)
  // M9 prep: team rules may add to (or cancel extras of) a move's cost (Grav-inhibitor)
  const surcharge = providerMoveSurcharge(state, op, kind, segments.map((sg) => sg.to), { horizontal: horizCost, accessible: accCost, climb: climbCost, drop: Math.max(0, dropCost), obstructing: obsCost, climbs: [...climbs] })
  const total = horizCost + accCost + climbCost + Math.max(0, dropCost) + surcharge + rotation
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

  const placement = placementProblem(state, axis ? { id: op.id, pos: cur, radius: r, height: h, axis } : { id: op.id, pos: cur, radius: r, height: h })
  if (placement) return { ok: false, rejection: placement }
  // batch C shared: a team rule may refuse where (or how) the move ends, with its own reason (Recon Sweep's edge zone)
  const veto = forced ? null : providerMoveProblem(state, op, kind, segments.map((sg) => sg.to))
  if (veto) return fail('E_ACTION_RESTRICTED', veto)

  const endCr = forced ? new Set<string>() : crOf(cur)
  if (kind === 'charge') {
    if (endCr.size === 0) return fail('E_CONTROL_RANGE', 'a Charge must end in an enemy control range')
    if (endWithinCrOf && !endCr.has(endWithinCrOf)) return fail('E_CONTROL_RANGE', 'this Charge must end in the chosen enemy control range', { enemy: endWithinCrOf })
  } else if (endCr.size > 0) {
    return fail('E_CONTROL_RANGE', 'a move cannot finish in an enemy control range', { enemies: [...endCr] })
  } else if (endWithinCrOf) {
    // M9 prep: a move that must end in a friendly operative's control range (Medic!'s free Dash)
    const other = state.operatives[endWithinCrOf]
    if (!other || !inControlRange(state, me(cur), bodyOf(other))) return fail('E_CONTROL_RANGE', 'this move must end in the named operative control range', { operative: endWithinCrOf })
  }

  return {
    ok: true,
    end: cur,
    facing,
    segments,
    cost: total,
    maxInches,
    breakdown: { horizontal: horizCost, accessible: accCost, climb: climbCost, drop: Math.max(0, dropCost), obstructing: obsCost, climbs: [...climbs], ...(rotation > 0 ? { rotation: round3(rotation) } : {}) },
  }
}

/**
 * M9 batch B, FLY (Hearthkyn Jump Pack): instead of a path the operative is set up again wholly within its move of
 * where it started, measured horizontally (Dash 3", no Charge +2", 2" while counteracting); terrain between, climbs
 * and drops cost nothing. It must be placeable there, outside every enemy control range unless the move is a Charge,
 * which must end in one (and in `endWithinCrOf`'s when named). An oval base may take any facing.
 */
export function planFly(
  state: GameState,
  op: Operative,
  kind: MoveKind,
  raw: unknown,
  counteract = false,
  limitOverride?: number,
  endWithinCrOf?: string,
  endFacing?: number,
): PlanResult {
  const wps = parseWaypoints(raw)
  if (!wps || wps.length !== 1) return fail('E_SCHEMA', 'a FLY move names exactly one set-up point')
  if (!providerCanFly(state, op, kind)) return fail('E_ACTION_RESTRICTED', `${op.name} cannot FLY`)
  const w = wps[0]!
  // M9 batch C: a team rule may set its own FLY distance (Blink Pack 7"); a counteraction still caps it at 2"
  const flyOwn = providerFlyLimit(state, op, kind)
  const base = flyOwn === null ? moveLimit(op, kind === 'charge' ? 'reposition' : kind, counteract, state) : counteract ? Math.min(flyOwn, COUNTERACT_CAP) : flyOwn
  const maxInches = limitOverride === undefined ? base : Math.min(limitOverride, base)
  const end: Vec3 = { x: w.x, y: w.y ?? 0, z: w.z }
  const d = dist2(op.pos, end)
  if (d > maxInches + EPS) return fail('E_OUT_OF_RANGE', `a FLY set-up must be within ${maxInches}" horizontally`, { distance: round3(d), maxInches })
  const facing = op.ovalHalfAxis && endFacing !== undefined ? round3(endFacing) : op.ovalHalfAxis ? op.facing : d > EPS ? bearing(op.pos, end) : op.facing
  const spec = { id: op.id, pos: end, radius: op.baseRadius, height: op.height, ...axisOf(op, facing) }
  const placement = placementProblem(state, spec)
  if (placement) return { ok: false, rejection: placement }
  const veto = providerMoveProblem(state, op, kind, [end])
  if (veto) return fail('E_ACTION_RESTRICTED', veto)
  const me: Body = { id: op.id, pos: end, baseRadius: op.baseRadius, height: op.height, ...(spec.axis ? { axis: spec.axis } : {}) }
  const endCr = new Set(enemiesOf(state, op).filter((e) => inControlRange(state, me, bodyOf(e))).map((e) => e.id))
  if (kind === 'charge') {
    if (endCr.size === 0) return fail('E_CONTROL_RANGE', 'a Charge must end in an enemy control range')
    if (endWithinCrOf && !endCr.has(endWithinCrOf)) return fail('E_CONTROL_RANGE', 'this Charge must end in the chosen enemy control range', { enemy: endWithinCrOf })
  } else if (endCr.size > 0) return fail('E_CONTROL_RANGE', 'a move cannot finish in an enemy control range', { enemies: [...endCr] })
  const cost = round3(d)
  return {
    ok: true,
    end,
    facing,
    segments: [{ from: { ...op.pos }, to: end, length: cost, cost, kind: 'fly' }],
    cost,
    maxInches,
    breakdown: { horizontal: cost, accessible: 0, climb: 0, drop: 0 },
  }
}

/** M9 batch B: points a forced move of `subject` (Knux Smash) can reach within `maxInches`, sampled on rings; deterministic. */
export function forcedMoveSpots(state: GameState, subject: Operative, maxInches: number, max = 12): Vec3[] {
  const out: Vec3[] = []
  for (const r of [maxInches, (maxInches * 2) / 3, maxInches / 3]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const p = { x: round3(subject.pos.x + Math.sin(a) * r), y: subject.pos.y, z: round3(subject.pos.z + Math.cos(a) * r) }
      if (planMove(state, subject, 'reposition', [p], false, maxInches, undefined, undefined, true).ok) out.push(p)
      if (out.length >= max) return out
    }
  }
  return out
}

/**
 * M9 batch B: move `subjectId` along `waypoints` up to `maxInches` for another rule (Knux Smash). Emits OperativeMoved
 * (action 'forced'), so mines and markers react after the step; not the moved operative's action, so nothing of its
 * own (AP, movedThisActivation) changes. False (nothing moves) when the path is illegal.
 */
export function applyForcedMove(ctx: Ctx, subjectId: string, waypoints: Waypoint[], maxInches: number): boolean {
  const s = ctx.state
  const op = s.operatives[subjectId]
  if (!op || op.status !== 'active') return false
  const plan = planMove(s, op, 'reposition', waypoints, false, maxInches, undefined, undefined, true)
  if (!plan.ok) return false
  const from = { ...op.pos }
  op.pos = plan.end
  op.facing = plan.facing
  ctx.emit({ type: 'OperativeMoved', operativeId: op.id, action: 'forced', from, to: plan.end, segments: plan.segments, cost: plan.cost, maxInches: plan.maxInches })
  return true
}

function handleMovePath(state: GameState, action: Action): Handled {
  const act = state.firefight.activation
  if (!act || !act.declared) return reject('E_WRONG_DECISION', 'no move is declared')
  const op = getOp(state, act.operativeId)
  // M2b-game: an action "treated as" a move (Move With Barricade) names the move kind and its own limit
  const params = act.declared.params
  const kind = ((params?.moveKind as string | undefined) ?? act.declared.action) as MoveKind
  const limit = params?.maxInches as number | undefined
  const endWithin = params?.endWithinCrOf as string | undefined
  if (action.type === 'pass') {
    return { run: (ctx) => cancelAction(ctx) }
  }
  if (action.type !== 'move.path') return reject('E_WRONG_DECISION', 'expected a path')
  const endFacing = (action.payload as { facing?: unknown }).facing
  if (endFacing !== undefined && (typeof endFacing !== 'number' || !Number.isFinite(endFacing))) return reject('E_SCHEMA', 'facing is a number (radians)')
  const fly = (action.payload as { fly?: unknown }).fly === true
  const plan = fly
    ? planFly(state, op, kind, action.payload.waypoints, act.counteract, limit, endWithin, endFacing)
    : planMove(state, op, kind, action.payload.waypoints, act.counteract, limit, endWithin, endFacing)
  if (!plan.ok) return { rejection: plan.rejection }
  return {
    run(ctx) {
      const o = ctx.state.operatives[op.id]!
      const from = { ...o.pos }
      o.pos = plan.end
      o.facing = plan.facing
      // M9 prep: distance spent in this activation (Lumbering Death, Methodical Elimination, Bipod)
      o.movedThisActivation = (o.movedThisActivation ?? 0) + plan.cost
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
      // batch C shared: the mover's ploy window between a Fall Back's move and the end of the action (Cover Retreat)
      const a = ctx.state.firefight.activation!
      if (a.declared?.action === 'fallBack' && o.status === 'active') {
        if (openFirefightWindow(ctx, 'firefight.fallBackMoved', { subjectId: o.id, counteracting: a.counteract, action: 'fallBack' }, 'fallBack.moved')) return
      }
      // batch D prep: the same window between a Charge's move and the end of the action (Rake)
      if (a.declared?.action === 'charge' && o.status === 'active') {
        if (openFirefightWindow(ctx, 'firefight.chargeMoved', { subjectId: o.id, counteracting: a.counteract, action: 'charge' }, 'charge.moved')) return
      }
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
