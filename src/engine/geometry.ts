// Pure 2D geometry: round bases, straight-line increments, segment/polygon clipping.
// Units are inches; precision is 1/1000 inch.
import type { Polygon, Vec2 } from './types'

export const EPS = 1e-6

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** Movement cost of one straight-line increment: its length rounded UP to the next whole inch (R-4.1). */
export function incrementCost(length: number): number {
  return length <= EPS ? 0 : Math.ceil(length - EPS)
}

/** Bearing of the vector a -> b with +Z as 0 and +X as pi/2. */
export function bearing(a: Vec2, b: Vec2): number {
  return Math.atan2(b.x - a.x, b.z - a.z)
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-12) return dist2(p, a)
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

export function distToPolygonBoundary(p: Vec2, poly: Polygon): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const d = distPointSegment(p, poly[i]!, poly[(i + 1) % poly.length]!)
    if (d < best) best = d
  }
  return best
}

/** Even-odd containment; points on the boundary count as inside. */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  if (distToPolygonBoundary(p, poly) < 1e-9) return true
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/** Horizontal distance from a point to a polygon region (0 when inside). */
export function distToPolygon(p: Vec2, poly: Polygon): number {
  return pointInPolygon(p, poly) ? 0 : distToPolygonBoundary(p, poly)
}

/** The whole disc lies inside the polygon ("wholly within"). */
export function circleInsidePolygon(c: Vec2, r: number, poly: Polygon): boolean {
  return pointInPolygon(c, poly) && distToPolygonBoundary(c, poly) >= r - EPS
}

/** The disc overlaps the polygon region with positive area ("within" any part; touching is not overlap). */
export function circleOverlapsPolygon(c: Vec2, r: number, poly: Polygon): boolean {
  return pointInPolygon(c, poly) || distToPolygonBoundary(c, poly) < r - EPS
}

export function circlesOverlap(a: Vec2, ra: number, b: Vec2, rb: number): boolean {
  return dist2(a, b) < ra + rb - EPS
}

/** Gap between two discs (closest-part-of-base measurement), 0 when touching or overlapping. */
export function baseGap2D(a: Vec2, ra: number, b: Vec2, rb: number): number {
  return Math.max(0, dist2(a, b) - ra - rb)
}

/** "within d": any part of one is at most d from the other. */
export function withinDistance(gap: number, d: number): boolean {
  return gap <= d + EPS
}

export interface BBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export function polygonBBox(poly: Polygon): BBox {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { minX, maxX, minZ, maxZ }
}

export function segmentBBoxOverlaps(a: Vec2, b: Vec2, box: BBox, pad = 0): boolean {
  return (
    Math.max(a.x, b.x) >= box.minX - pad &&
    Math.min(a.x, b.x) <= box.maxX + pad &&
    Math.max(a.z, b.z) >= box.minZ - pad &&
    Math.min(a.z, b.z) <= box.maxZ + pad
  )
}

/** Parameter intervals [t0, t1] of the segment a -> b that lie inside the polygon. */
export function segmentPolygonIntervals(a: Vec2, b: Vec2, poly: Polygon): [number, number][] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const ts: number[] = [0, 1]
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    const ex = q.x - p.x
    const ez = q.z - p.z
    const denom = dx * ez - dz * ex
    if (Math.abs(denom) < 1e-12) continue
    const t = ((p.x - a.x) * ez - (p.z - a.z) * ex) / denom
    const u = ((p.x - a.x) * dz - (p.z - a.z) * dx) / denom
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t)
  }
  ts.sort((x, y) => x - y)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!
    const t1 = ts[i + 1]!
    if (t1 - t0 < 1e-9) continue
    const mid = lerp2(a, b, (t0 + t1) / 2)
    if (pointInPolygon(mid, poly)) {
      const last = out[out.length - 1]
      if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1
      else out.push([t0, t1])
    }
  }
  return out
}

/** Does the segment a -> b pass through the vertical cylinder (centre c, radius r)? Returns the t interval. */
export function segmentCircleInterval(a: Vec2, b: Vec2, c: Vec2, r: number): [number, number] | null {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const fx = a.x - c.x
  const fz = a.z - c.z
  const A = dx * dx + dz * dz
  if (A < 1e-12) return Math.hypot(fx, fz) <= r ? [0, 1] : null
  const B = 2 * (fx * dx + fz * dz)
  const C = fx * fx + fz * fz - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0) return null
  const s = Math.sqrt(disc)
  const t0 = (-B - s) / (2 * A)
  const t1 = (-B + s) / (2 * A)
  if (t1 < 0 || t0 > 1) return null
  return [Math.max(0, t0), Math.min(1, t1)]
}

/** Points evenly spread around a circle starting at `startAngle` (radians, +Z = 0). */
export function ringPoints(c: Vec2, r: number, count: number, startAngle = 0): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const a = startAngle + (i * 2 * Math.PI) / count
    out.push({ x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r })
  }
  return out
}

export function mmToInches(mm: number): number {
  return mm / 25.4
}
