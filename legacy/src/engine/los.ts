// Visibility, intervening terrain, cover and obscured (R-5.3 to R-5.5, R-8.8, R-11).
// An operative is a cylinder (base radius, height) with a head point at 90% of its height; an oval base
// (footprint.ts) is three such cylinders on its long axis, with the head over the centre.
import { distToPolygonBoundary, pointInPolygon, segmentBBoxOverlaps, segmentPolygonIntervals } from './geometry'
import { discCentres, footprintDistToPolygon, footprintGap2D, footprintRing, ovalAxis, segmentFootprintIntervals } from './footprint'
import { activeOps } from './state'
import { providerViewpointBodies } from './team-rules'
import { sameLevel, standingSolid, terrainOf, type Solid, type TerrainIndex } from './terrain'
import type { GameState, Order, Vec2, Vec3 } from './types'

export interface Body {
  id: string
  pos: Vec3
  baseRadius: number
  height: number
  /** M9 batch B: oval bases only, the centre-to-end-disc vector (footprint.ts) */
  axis?: Vec2
}

export function bodyOf(o: { id: string; pos: Vec3; baseRadius: number; height: number; ovalHalfAxis?: number; facing?: number; axis?: Vec2 }): Body {
  const axis = o.axis ?? ovalAxis(o.ovalHalfAxis, o.facing ?? 0)
  return axis ? { id: o.id, pos: o.pos, baseRadius: o.baseRadius, height: o.height, axis } : { id: o.id, pos: o.pos, baseRadius: o.baseRadius, height: o.height }
}

export interface LosOptions {
  /** control range mode: skip parts flagged crTransparent (doors, low stronghold parts; R-13.2) */
  crMode?: boolean
  /** override state.rules.operativesBlockVisibility */
  operativesBlock?: boolean
}

export function headPoint(b: Body): Vec3 {
  return { x: b.pos.x, y: b.pos.y + b.height * 0.9, z: b.pos.z }
}

/** Five points at mid-height around the base edge plus the top of the head. */
export function targetSamples(viewer: Body, target: Body): Vec3[] {
  const a0 = Math.atan2(viewer.pos.x - target.pos.x, viewer.pos.z - target.pos.z)
  const mid = target.pos.y + target.height * 0.5
  const out: Vec3[] = footprintRing(target, 5, a0).map((p) => ({ x: p.x, y: mid, z: p.z }))
  out.push({ x: target.pos.x, y: target.pos.y + target.height * 0.95, z: target.pos.z })
  return out
}

/** Does the 3D segment a -> b pass through the prism of solid s (interior, not just touching)? */
export function segmentHitsSolid(a: Vec3, b: Vec3, s: Solid): boolean {
  if (!segmentBBoxOverlaps(a, b, s.bbox)) return false
  const ivs = segmentPolygonIntervals(a, b, s.polygon)
  for (const [t0, t1] of ivs) {
    const y0 = a.y + (b.y - a.y) * t0
    const y1 = a.y + (b.y - a.y) * t1
    const lo = Math.min(y0, y1)
    const hi = Math.max(y0, y1)
    if (lo < s.top - 1e-6 && hi > s.bottom + 1e-6) return true
  }
  return false
}

function nearBarred(b: Body, s: Solid): boolean {
  return footprintDistToPolygon(b, s.polygon) <= 1 + 1e-6
}

function blockedByOperative(a: Vec3, b: Vec3, o: Body): boolean {
  for (const iv of segmentFootprintIntervals(a, b, o)) {
    const y0 = a.y + (b.y - a.y) * iv[0]
    const y1 = a.y + (b.y - a.y) * iv[1]
    const lo = Math.min(y0, y1)
    const hi = Math.max(y0, y1)
    if (lo < o.pos.y + o.height && hi > o.pos.y) return true
  }
  return false
}

/**
 * Visible: an unobstructed straight line from the viewer's head to any part of the target (bases excluded).
 * batch C shared: an operative with extra viewpoints (team-rules `viewpoints`: wide view) also sees from those.
 */
export function visible(state: GameState, viewer: Body, target: Body, opts: LosOptions = {}): boolean {
  if (visibleFromHead(state, viewer, target, opts)) return true
  const op = state.operatives[viewer.id]
  if (!op) return false
  for (const eye of providerViewpointBodies(state, op, viewer)) if (visibleFromHead(state, eye, target, opts)) return true
  return false
}

function visibleFromHead(state: GameState, viewer: Body, target: Body, opts: LosOptions): boolean {
  if (viewer.id === target.id) return true
  const idx = terrainOf(state.map)
  const head = headPoint(viewer)
  const opsBlock = opts.operativesBlock ?? state.rules.operativesBlockVisibility
  const blockers = opsBlock ? activeOps(state).filter((o) => o.id !== viewer.id && o.id !== target.id).map(bodyOf) : []
  for (const s of targetSamples(viewer, target)) {
    if (!rayBlocked(idx, head, s, viewer, target, blockers, opts)) return true
  }
  return false
}

function rayBlocked(
  idx: TerrainIndex,
  a: Vec3,
  b: Vec3,
  viewer: Body,
  target: Body,
  blockers: Body[],
  opts: LosOptions,
): boolean {
  for (const s of idx.solids) {
    if (opts.crMode && s.crTransparent) continue
    if (s.barred && (nearBarred(viewer, s) || nearBarred(target, s))) continue
    if (segmentHitsSolid(a, b, s)) return true
  }
  for (const o of blockers) if (blockedByOperative(a, b, o)) return true
  return false
}

// ---------------------------------------------------------------------------
// Targeting lines, cover and obscured
// ---------------------------------------------------------------------------

export interface CoverStatus {
  inCover: boolean
  obscured: boolean
}

export interface TargetVerdict {
  visible: boolean
  /** base-edge distance, 3D */
  distance: number
  /** target is within 2" of the shooter, so it never counts as in cover (R-5.4) */
  within2: boolean
  /** raw statuses before the forced cover/obscured choice */
  inCover: boolean
  obscured: boolean
  /** part ids that are intervening and within the target's control range (cover sources) */
  coverParts: string[]
  /** part ids of intervening Heavy terrain that is not ignored (obscuring sources) */
  obscuringParts: string[]
  /** part ids crossed by every targeting line of the chosen origin */
  whollyInterveningParts: string[]
  /** M9 batch B: every part crossed by any targeting line of the chosen origin (R-8.8 intervening), not only cover parts */
  interveningParts: string[]
  /** one feature would give both cover and obscured: the defender chooses (R-5.5) */
  forcedChoice: boolean
  sharedFeatures: string[]
  /** resulting statuses if the defender chooses cover / obscured */
  ifCover: CoverStatus
  ifObscured: CoverStatus
  vantage: {
    shooterOnVantage: boolean
    lowerBy: number
    /** Accurate x gained against an Engage target (R-11.5a) */
    accurate: 0 | 1 | 2
    /** Conceal targets at least 2" lower cannot use Light terrain as cover (R-11.5b) */
    denyLightCover: boolean
  }
}

export function baseDistance3D(a: Body, b: Body): number {
  const h = footprintGap2D(a, b)
  const dy = Math.abs(a.pos.y - b.pos.y)
  return Math.hypot(h, dy)
}

interface OriginEval {
  intervening: Map<string, number>
  lines: number
}

function evalOrigin(idx: TerrainIndex, att: Body, tgt: Body, origin: Vec2, excluded: Set<string>): OriginEval {
  const flat = sameLevel(att.pos.y, tgt.pos.y)
  const a0 = Math.atan2(origin.x - tgt.pos.x, origin.z - tgt.pos.z)
  const facing: Vec2[] = []
  const centres = discCentres(tgt)
  for (const c of centres) {
    for (const off of [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2]) {
      const p = { x: c.x + Math.sin(a0 + off) * tgt.baseRadius, z: c.z + Math.cos(a0 + off) * tgt.baseRadius }
      // oval bases: keep only outline points (not inside another of the base's discs)
      if (centres.length > 1 && centres.some((o) => o !== c && Math.hypot(p.x - o.x, p.z - o.z) < tgt.baseRadius - 1e-6)) continue
      facing.push(p)
    }
  }
  const intervening = new Map<string, number>()
  const level = att.pos.y
  for (const f of facing) {
    for (const s of idx.solids) {
      if (excluded.has(s.partId) || s.exposed) continue
      let crossed = false
      if (flat) {
        if (s.bottom >= level + att.height) continue
        if (s.top <= level + 0.01 && level > 0.01) continue
        if (!segmentBBoxOverlaps(origin, f, s.bbox)) continue
        crossed = segmentPolygonIntervals(origin, f, s.polygon).length > 0
      } else {
        crossed = segmentHitsSolid({ x: origin.x, y: att.pos.y, z: origin.z }, { x: f.x, y: tgt.pos.y, z: f.z }, s)
      }
      if (crossed) intervening.set(s.partId, (intervening.get(s.partId) ?? 0) + 1)
    }
  }
  return { intervening, lines: facing.length }
}

/** Cover, obscured and Vantage verdicts for a shooter/target pair (R-5.4, R-5.5, R-8.8, R-11.5). */
export function targetVerdict(
  state: GameState,
  attacker: Body,
  target: Body & { order?: Order },
): TargetVerdict {
  const idx = terrainOf(state.map)
  const isVisible = visible(state, attacker, target)
  const distance = baseDistance3D(attacker, target)
  const within2 = distance <= 2 + 1e-6
  const standA = standingSolid(idx, attacker.pos)
  const standT = standingSolid(idx, target.pos)
  const excluded = new Set<string>()
  if (standA) excluded.add(standA.partId)
  if (standT) excluded.add(standT.partId)

  const origins: Vec2[] = [
    ...discCentres(attacker),
    ...footprintRing(attacker, 8, 0),
  ]

  let best: {
    coverParts: Solid[]
    obscuringParts: Solid[]
    wholly: string[]
    shared: string[]
    crossed: string[]
    rank: number
  } | null = null

  for (const origin of origins) {
    const ev = evalOrigin(idx, attacker, target, origin, excluded)
    const crossed: Solid[] = []
    for (const id of ev.intervening.keys()) {
      const s = idx.byPart.get(id)
      if (s) crossed.push(s)
    }
    const coverParts = within2
      ? []
      : crossed.filter(
          (s) => !s.crTransparent && footprintDistToPolygon(target, s.polygon) <= 1 + 1e-6,
        )
    const obscuringParts = crossed.filter((s) => {
      if (!s.heavy) return false
      if (footprintDistToPolygon(attacker, s.polygon) <= 1 + 1e-6) return false
      if (footprintDistToPolygon(target, s.polygon) <= 1 + 1e-6) return false
      if (standA?.vantage && s.featureId === standA.featureId) return false
      if (standT?.vantage && s.featureId === standT.featureId) return false
      return true
    })
    const coverFeatures = new Set(coverParts.map((s) => s.featureId))
    const shared = [...new Set(obscuringParts.map((s) => s.featureId))].filter((f) => coverFeatures.has(f))
    const wholly = [...ev.intervening.entries()].filter(([, n]) => n === ev.lines).map(([id]) => id)
    const rank = (obscuringParts.length > 0 ? 2 : 0) + (coverParts.length > 0 ? 1 : 0)
    if (!best || rank < best.rank) best = { coverParts, obscuringParts, wholly, shared, crossed: crossed.map((c) => c.partId), rank }
  }

  const b = best!
  const forcedChoice = b.shared.length > 0
  const sharedSet = new Set(b.shared)
  const ifCover: CoverStatus = {
    inCover: b.coverParts.length > 0,
    obscured: b.obscuringParts.some((s) => !sharedSet.has(s.featureId)),
  }
  const ifObscured: CoverStatus = {
    inCover: b.coverParts.some((s) => !sharedSet.has(s.featureId)),
    obscured: b.obscuringParts.length > 0,
  }

  const onVantage = !!standA && standA.vantage && standA.floors.some((f) => sameLevel(f, attacker.pos.y))
  const lowerBy = attacker.pos.y - target.pos.y
  const accurate: 0 | 1 | 2 = onVantage && target.order !== 'conceal' ? (lowerBy >= 4 - 1e-6 ? 2 : lowerBy >= 2 - 1e-6 ? 1 : 0) : 0

  return {
    visible: isVisible,
    distance,
    within2,
    inCover: b.coverParts.length > 0,
    obscured: b.obscuringParts.length > 0,
    coverParts: b.coverParts.map((s) => s.partId),
    obscuringParts: b.obscuringParts.map((s) => s.partId),
    whollyInterveningParts: b.wholly,
    interveningParts: b.crossed,
    forcedChoice,
    sharedFeatures: b.shared,
    ifCover,
    ifObscured,
    vantage: {
      shooterOnVantage: onVantage,
      lowerBy,
      accurate,
      denyLightCover: onVantage && target.order === 'conceal' && lowerBy >= 2 - 1e-6,
    },
  }
}


// ---------------------------------------------------------------------------
// M9 batch B: terrain questions team rules ask (Denizens of Night, Rad Bombardment)
// ---------------------------------------------------------------------------

/** Kinds of terrain intervening between shooter and target (any part a targeting line crosses, R-8.8). */
export function interveningTraits(state: GameState, shooter: Body, target: Body & { order?: Order }): { light: boolean; heavy: boolean; parts: string[] } {
  const idx = terrainOf(state.map)
  const parts = targetVerdict(state, shooter, target).interveningParts
  let light = false
  let heavy = false
  for (const id of parts) {
    const sd = idx.byPart.get(id)
    if (!sd) continue
    if (sd.heavy) heavy = true
    if (sd.light) light = true
  }
  return { light, heavy, parts }
}

/** Is any part of the operative's base under a Vantage floor higher than it stands (R-11.5 terrain above it)? */
export function baseUnderVantage(state: GameState, b: Body): boolean {
  const idx = terrainOf(state.map)
  for (const sd of idx.solids) {
    if (!sd.vantage || !sd.floors.some((f) => f > b.pos.y + 0.5)) continue
    for (const c of discCentres(b)) {
      if (pointInPolygon(c, sd.polygon) || distToPolygonBoundary(c, sd.polygon) < b.baseRadius - 1e-6) return true
    }
  }
  return false
}
