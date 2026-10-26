// Base footprints (M9 batch B, generic capability "ovalBases"). Most bases are discs; an oval base (Hunter
// Clade transuranic arquebus GUNNER, 60x35mm) is modelled as three discs of the short-axis radius on the long
// axis: one at the centre and one at each end, so the ends reach the full long axis and the middle the full
// short axis (within 0.07" of the true ellipse everywhere; RULING logged). The long axis lies along the
// operative's facing. Every helper takes a footprint `{ pos, baseRadius, axis? }` where `axis` is the vector
// from the centre to an end disc's centre; no `axis` means a plain disc, so round bases behave exactly as before.
import { EPS, baseGap2D, dist2, distToPolygon, distToPolygonBoundary, pointInPolygon, ringPoints, segmentCircleInterval } from './geometry'
import type { Polygon, Vec2 } from './types'

export interface Footprint {
  pos: Vec2
  baseRadius: number
  /** oval bases only: centre-to-end-disc vector (length = half the long axis minus the short-axis radius) */
  axis?: Vec2
}

/** The centre-to-end-disc vector of an oval base whose long axis lies along `facing` (radians, +Z = 0). */
export function ovalAxis(halfAxis: number | undefined, facing: number): Vec2 | undefined {
  if (!halfAxis || halfAxis <= 0) return undefined
  return { x: Math.sin(facing) * halfAxis, z: Math.cos(facing) * halfAxis }
}

/** The footprint of an operative-like record (`ovalHalfAxis` and `facing` give the oval its axis). */
export function footprintOf(o: { pos: Vec2; baseRadius: number; ovalHalfAxis?: number; facing?: number }, pos: Vec2 = o.pos, facing: number = o.facing ?? 0): Footprint {
  const axis = ovalAxis(o.ovalHalfAxis, facing)
  return axis ? { pos, baseRadius: o.baseRadius, axis } : { pos, baseRadius: o.baseRadius }
}

/** `{ axis }` for an oval operative at `facing` (default its own), `{}` for a round one: spread into a PlacementSpec. */
export function axisOf(o: { ovalHalfAxis?: number; facing?: number }, facing: number = o.facing ?? 0): { axis?: Vec2 } {
  const axis = ovalAxis(o.ovalHalfAxis, facing)
  return axis ? { axis } : {}
}

/** Centres of the footprint's discs (one for a round base, three for an oval). */
export function discCentres(f: Footprint): Vec2[] {
  const c = { x: f.pos.x, z: f.pos.z }
  if (!f.axis || (Math.abs(f.axis.x) < 1e-9 && Math.abs(f.axis.z) < 1e-9)) return [c]
  return [c, { x: c.x + f.axis.x, z: c.z + f.axis.z }, { x: c.x - f.axis.x, z: c.z - f.axis.z }]
}

/** Is the footprint more than a single disc? */
export function isOval(f: Footprint): boolean {
  return discCentres(f).length > 1
}

/** Half of the base's long axis (the base radius for a round base). */
export function halfLength(f: Footprint): number {
  return f.axis ? Math.hypot(f.axis.x, f.axis.z) + f.baseRadius : f.baseRadius
}

/** Closest-part gap between two footprints (0 when touching or overlapping). */
export function footprintGap2D(a: Footprint, b: Footprint): number {
  let best = Infinity
  for (const p of discCentres(a)) for (const q of discCentres(b)) best = Math.min(best, baseGap2D(p, a.baseRadius, q, b.baseRadius))
  return best
}

/** Do two footprints overlap with positive area (touching is not overlap)? */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  for (const p of discCentres(a)) for (const q of discCentres(b)) if (dist2(p, q) < a.baseRadius + b.baseRadius - EPS) return true
  return false
}

/** Horizontal distance from the footprint's edge to a polygon region (negative or 0 when it reaches inside). */
export function footprintDistToPolygon(f: Footprint, poly: Polygon): number {
  let best = Infinity
  for (const c of discCentres(f)) best = Math.min(best, distToPolygon(c, poly) - f.baseRadius)
  return best
}

/** The whole footprint lies inside the polygon ("wholly within"). */
export function footprintInsidePolygon(f: Footprint, poly: Polygon): boolean {
  return discCentres(f).every((c) => pointInPolygon(c, poly) && distToPolygonBoundary(c, poly) >= f.baseRadius - EPS)
}

/** Points on the footprint's outline, `count` per disc starting at `startAngle`, dropping points inside another disc. */
export function footprintRing(f: Footprint, count: number, startAngle = 0): Vec2[] {
  const centres = discCentres(f)
  if (centres.length === 1) return ringPoints(centres[0]!, f.baseRadius, count, startAngle)
  const out: Vec2[] = []
  centres.forEach((c, i) => {
    for (const p of ringPoints(c, f.baseRadius, count, startAngle)) {
      if (centres.some((o, j) => j !== i && dist2(p, o) < f.baseRadius - 1e-6)) continue
      out.push(p)
    }
  })
  return out
}

/** Every t interval in which the segment a -> b passes over the footprint (one per disc it crosses). */
export function segmentFootprintIntervals(a: Vec2, b: Vec2, f: Footprint): [number, number][] {
  const out: [number, number][] = []
  for (const c of discCentres(f)) {
    const iv = segmentCircleInterval(a, b, c, f.baseRadius)
    if (iv) out.push(iv)
  }
  return out
}

/** Smallest distance from a point to the footprint's edge (0 when inside). */
export function pointGapToFootprint(p: Vec2, f: Footprint): number {
  let best = Infinity
  for (const c of discCentres(f)) best = Math.min(best, Math.max(0, dist2(p, c) - f.baseRadius))
  return best
}

/** Smallest signed rotation from `from` to `to` (radians, in (-pi, pi]). */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d <= -Math.PI) d += 2 * Math.PI
  return d
}

/**
 * Extra distance an oval base spends turning in place from `from` to `to` (Hunter Clade FAQ: no part of the
 * base may move further than the move allows, so the end of the long axis pays the arc it sweeps). A round
 * base turns for free.
 */
export function rotationCost(f: Footprint, from: number, to: number): number {
  if (!isOval(f)) return 0
  return Math.abs(angleDelta(from, to)) * halfLength(f)
}
