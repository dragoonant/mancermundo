import type { Polygon, Vec2 } from './types'

/** Plain 2D helpers on the XZ plane (inches). Used by the data validator and by layout tests. */

export function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l2 = dx * dx + dz * dz
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/** Distance from a point to the polygon boundary (always >= 0, ignores whether it is inside). */
export function distToPolygonBoundary(p: Vec2, poly: Polygon): number {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]))
  return d
}

/** Distance from a point to a filled polygon (0 when inside). */
export function distToPolygon(p: Vec2, poly: Polygon): number {
  return pointInPolygon(p, poly) ? 0 : distToPolygonBoundary(p, poly)
}

function cross(p: Vec2, q: Vec2, r: Vec2): number {
  return (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
}

export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Minimum distance between two filled polygons (0 when they overlap). */
export function polygonDistance(p: Polygon, q: Polygon): number {
  if (p.some((v) => pointInPolygon(v, q)) || q.some((v) => pointInPolygon(v, p))) return 0
  let d = Infinity
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    for (let j = 0; j < q.length; j++) {
      if (segmentsCross(a, b, q[j], q[(j + 1) % q.length])) return 0
    }
    for (const v of q) d = Math.min(d, segDist(v, a, b))
  }
  for (let j = 0; j < q.length; j++) {
    for (const v of p) d = Math.min(d, segDist(v, q[j], q[(j + 1) % q.length]))
  }
  return d
}

/** Minimum distance between a filled polygon and a segment (0 when they touch or overlap). */
export function polygonSegmentDistance(poly: Polygon, a: Vec2, b: Vec2): number {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return 0
  let d = Infinity
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i]
    const e = poly[(i + 1) % poly.length]
    if (segmentsCross(a, b, c, e)) return 0
    d = Math.min(d, segDist(c, a, b), segDist(a, c, e), segDist(b, c, e))
  }
  return d
}

export function polygonArea(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.z - b.x * a.z
  }
  return Math.abs(s) / 2
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
