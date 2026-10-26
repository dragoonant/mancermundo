// Shortest legal routes and path distances on a Zone Mortalis board (00 section 1, 7.2).
//
// A visibility graph over the corners of every wall and every closed door, each pushed outward so a disc of the mover's
// radius passes it without touching. Edges are straight segments whose swept disc overlaps no blocker. Obstacles are not
// blockers here (they cost movement, they do not stop it; movement.ts prices them); fighters are not blockers either,
// except as optional `avoid` discs (the 1" rule, charge paths) checked lazily per edge.
//
// Graphs are cached per compiled board, door state (which doors are closed) and radius; a door opening or closing
// builds a new graph on the next query. `MEASURE_R` is the radius used for "within X" proximity measuring (R-1.9): a
// point-like disc, so the answer never depends on whether a base would physically fit through a gap.
import type { BoardDef, Polygon, Vec2 } from './types'
import { blockingPolygons, doorSignature, insideOutline, type DoorStates } from './board'
import { polygonBBox, type BBox } from './geometry'

/** Radius of the point-like disc used for proximity measuring. */
export const MEASURE_R = 0.02
const NODE_MARGIN = 0.001
const CLEAR_EPS = 1e-6

interface Boxed {
  poly: Polygon
  box: BBox
}

export interface AvoidDisc {
  c: Vec2
  r: number
}

export interface Nav {
  def: BoardDef
  r: number
  /** walls and closed doors with their boxes */
  blockers: Boxed[]
  /** the visibility graph, built on first use */
  graph(): NavGraph
}

export interface NavGraph {
  nodes: Vec2[]
  /** adjacency: neighbour index and edge length */
  adj: { to: number; len: number }[][]
}

// ---------------------------------------------------------------------------
// Segment geometry
// ---------------------------------------------------------------------------

function cross(ox: number, oz: number, ax: number, az: number, bx: number, bz: number): number {
  return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox)
}

function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = cross(q1.x, q1.z, q2.x, q2.z, p1.x, p1.z)
  const d2 = cross(q1.x, q1.z, q2.x, q2.z, p2.x, p2.z)
  const d3 = cross(p1.x, p1.z, p2.x, p2.z, q1.x, q1.z)
  const d4 = cross(p1.x, p1.z, p2.x, p2.z, q2.x, q2.z)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Distance from a point to a segment. */
export function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.z - a.z)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

/** Smallest distance between two segments (0 when they cross). */
export function segSegDist(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): number {
  if (segmentsIntersect(p1, p2, q1, q2)) return 0
  return Math.min(pointSegDist(p1, q1, q2), pointSegDist(p2, q1, q2), pointSegDist(q1, p1, p2), pointSegDist(q2, p1, p2))
}

/** Even-odd containment without the boundary pass of `pointInPolygon` (the callers test edges separately). */
function insidePoly(p: Vec2, poly: Polygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const u = poly[i]!
    const v = poly[j]!
    if (u.z > p.z !== v.z > p.z && p.x < ((v.x - u.x) * (p.z - u.z)) / (v.z - u.z) + u.x) inside = !inside
  }
  return inside
}

/** Smallest distance between a segment and a polygon region (0 when they touch or the segment starts inside). */
export function segPolyDist(a: Vec2, b: Vec2, poly: Polygon): number {
  if (insidePoly(a, poly)) return 0
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const d = segSegDist(a, b, poly[i]!, poly[(i + 1) % poly.length]!)
    if (d < best) best = d
    if (best === 0) return 0
  }
  return best
}

function boxed(polys: Polygon[]): Boxed[] {
  return polys.map((poly) => ({ poly, box: polygonBBox(poly) }))
}

/** Does a disc of radius `r` swept along a -> b overlap (positive area) any blocker? */
export function sweepBlocked(blockers: readonly Boxed[], a: Vec2, b: Vec2, r: number): boolean {
  const minX = Math.min(a.x, b.x) - r
  const maxX = Math.max(a.x, b.x) + r
  const minZ = Math.min(a.z, b.z) - r
  const maxZ = Math.max(a.z, b.z) + r
  for (const bl of blockers) {
    const bx = bl.box
    if (maxX < bx.minX || minX > bx.maxX || maxZ < bx.minZ || minZ > bx.maxZ) continue
    if (segPolyDist(a, b, bl.poly) < r - CLEAR_EPS) return true
  }
  return false
}

function discHitsBlockers(blockers: readonly Boxed[], c: Vec2, r: number): boolean {
  return sweepBlocked(blockers, c, c, r)
}

// ---------------------------------------------------------------------------
// Graph construction and cache
// ---------------------------------------------------------------------------

function polyArea(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.z - b.x * a.z
  }
  return s / 2
}

/** Outward-pushed convex corners of a polygon: where a disc of radius `r` rounds the corner. */
function cornerNodes(poly: Polygon, r: number): Vec2[] {
  const pts = polyArea(poly) < 0 ? [...poly].reverse() : poly
  const out: Vec2[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]!
    const cur = pts[i]!
    const next = pts[(i + 1) % n]!
    const e1x = cur.x - prev.x
    const e1z = cur.z - prev.z
    const e2x = next.x - cur.x
    const e2z = next.z - cur.z
    const l1 = Math.hypot(e1x, e1z)
    const l2 = Math.hypot(e2x, e2z)
    if (l1 < 1e-9 || l2 < 1e-9) continue
    if (e1x * e2z - e1z * e2x <= 1e-9) continue // reflex or flat: a path never wraps it
    // outward normals of a counter-clockwise polygon (x right, z up): (dz, -dx)
    const n1x = e1z / l1
    const n1z = -e1x / l1
    const n2x = e2z / l2
    const n2z = -e2x / l2
    const k = r / (1 + n1x * n2x + n1z * n2z)
    out.push({ x: cur.x + (n1x + n2x) * k, z: cur.z + (n1z + n2z) * k })
  }
  return out
}

const cache = new WeakMap<BoardDef, Map<string, Nav>>()
const blockerCache = new WeakMap<BoardDef, Map<string, Boxed[]>>()

/** Walls and closed doors with their boxes, cached per board and door state. */
export function blockersFor(def: BoardDef, doors: DoorStates): Boxed[] {
  let byKey = blockerCache.get(def)
  if (!byKey) {
    byKey = new Map()
    blockerCache.set(def, byKey)
  }
  const key = doorSignature(def, doors)
  let list = byKey.get(key)
  if (!list) {
    list = boxed(blockingPolygons(def, doors))
    byKey.set(key, list)
  }
  return list
}

function buildGraph(def: BoardDef, blockers: Boxed[], r: number): NavGraph {
  const polys = blockers.map((b) => b.poly)
  const reach = r + NODE_MARGIN
  const seen = new Set<string>()
  const nodes: Vec2[] = []
  for (const poly of polys) {
    for (const p of cornerNodes(poly, reach)) {
      const q = { x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 }
      const key = `${q.x},${q.z}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!insideOutline(def, q)) continue
      if (discHitsBlockers(blockers, q, r)) continue
      nodes.push(q)
    }
  }
  const adj: { to: number; len: number }[][] = nodes.map(() => [])
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (sweepBlocked(blockers, nodes[i]!, nodes[j]!, r)) continue
      const len = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.z - nodes[j]!.z)
      adj[i]!.push({ to: j, len })
      adj[j]!.push({ to: i, len })
    }
  }
  return { nodes, adj }
}

/** The navigation graph of a board for bases of radius `r` under a door state (cached). */
export function navFor(def: BoardDef, doors: DoorStates, r: number): Nav {
  let byKey = cache.get(def)
  if (!byKey) {
    byKey = new Map()
    cache.set(def, byKey)
  }
  const key = `${doorSignature(def, doors)}|${Math.round(r * 1000)}`
  let nav = byKey.get(key)
  if (!nav) {
    const blockers = blockersFor(def, doors)
    let graph: NavGraph | null = null
    nav = {
      def,
      r,
      blockers,
      graph() {
        return (graph ??= buildGraph(def, blockers, r))
      },
    }
    byKey.set(key, nav)
  }
  return nav
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function avoidBlocked(avoid: readonly AvoidDisc[] | undefined, navR: number, a: Vec2, b: Vec2): boolean {
  if (!avoid) return false
  for (const d of avoid) if (pointSegDist(d.c, a, b) < d.r + navR - CLEAR_EPS) return true
  return false
}

/** Can a disc of the graph's radius go straight from a to b? */
export function straightClear(nav: Nav, a: Vec2, b: Vec2, avoid?: readonly AvoidDisc[]): boolean {
  return !sweepBlocked(nav.blockers, a, b, nav.r) && !avoidBlocked(avoid, nav.r, a, b)
}

class MinHeap {
  private keys: number[] = []
  private vals: number[] = []
  get size(): number {
    return this.keys.length
  }
  push(k: number, v: number): void {
    this.keys.push(k)
    this.vals.push(v)
    let i = this.keys.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p]! <= this.keys[i]!) break
      this.swap(i, p)
      i = p
    }
  }
  pop(): [number, number] {
    const k = this.keys[0]!
    const v = this.vals[0]!
    const lk = this.keys.pop()!
    const lv = this.vals.pop()!
    if (this.keys.length > 0) {
      this.keys[0] = lk
      this.vals[0] = lv
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.keys.length && this.keys[l]! < this.keys[m]!) m = l
        if (r < this.keys.length && this.keys[r]! < this.keys[m]!) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return [k, v]
  }
  private swap(a: number, b: number): void {
    const tk = this.keys[a]!
    this.keys[a] = this.keys[b]!
    this.keys[b] = tk
    const tv = this.vals[a]!
    this.vals[a] = this.vals[b]!
    this.vals[b] = tv
  }
}

/** Points per avoid disc (a regular polygon around it, circumscribed so its chords stay clear). */
const RING = 12

/**
 * Shortest path from a to b: the polyline including both ends and its length, or null when no legal route exists. The
 * path touches only graph corners (and, with `avoid` discs, points on a polygon round each disc), so every segment passes
 * the sweep test of `straightClear`.
 */
export function shortestRoute(nav: Nav, a: Vec2, b: Vec2, avoid?: readonly AvoidDisc[]): { path: Vec2[]; length: number } | null {
  if (straightClear(nav, a, b, avoid)) return { path: [a, b], length: Math.hypot(b.x - a.x, b.z - a.z) }
  const g = nav.graph()
  const nStatic = g.nodes.length
  const extra: Vec2[] = []
  if (avoid) {
    for (const d of avoid) {
      const rr = (d.r + nav.r + 0.01) / Math.cos(Math.PI / RING)
      for (let k = 0; k < RING; k++) {
        const ang = (k / RING) * 2 * Math.PI
        const p = { x: Math.round((d.c.x + Math.sin(ang) * rr) * 1000) / 1000, z: Math.round((d.c.z + Math.cos(ang) * rr) * 1000) / 1000 }
        if (!insideOutline(nav.def, p) || sweepBlocked(nav.blockers, p, p, nav.r)) continue
        if (avoid.some((o) => Math.hypot(p.x - o.c.x, p.z - o.c.z) < o.r + nav.r - CLEAR_EPS)) continue
        extra.push(p)
      }
    }
  }
  const N = nStatic + extra.length
  const S = N
  const T = N + 1
  const dist = new Float64Array(N + 2).fill(Infinity)
  const prev = new Int32Array(N + 2).fill(-1)
  const heap = new MinHeap()
  const point = (i: number): Vec2 => (i === S ? a : i === T ? b : i < nStatic ? g.nodes[i]! : extra[i - nStatic]!)
  const toEnd = new Float64Array(N).fill(-1)
  dist[S] = 0
  heap.push(0, S)
  while (heap.size > 0) {
    const [d, u] = heap.pop()
    if (d > dist[u]!) continue
    if (u === T) break
    const pu = point(u)
    const relax = (v: number, len: number) => {
      const nd = d + len
      if (nd < dist[v]!) {
        dist[v] = nd
        prev[v] = u
        heap.push(nd, v)
      }
    }
    const tryEdge = (v: number) => {
      const pv = point(v)
      if (straightClear(nav, pu, pv, avoid)) relax(v, Math.hypot(pv.x - pu.x, pv.z - pu.z))
    }
    if (u === S) {
      for (let v = 0; v < N; v++) tryEdge(v)
    } else {
      if (u < nStatic) {
        for (const e of g.adj[u]!) {
          if (avoid && avoidBlocked(avoid, nav.r, pu, g.nodes[e.to]!)) continue
          relax(e.to, e.len)
        }
        for (let v = nStatic; v < N; v++) tryEdge(v)
      } else {
        for (let v = 0; v < N; v++) if (v !== u) tryEdge(v)
      }
      // the end point
      if (toEnd[u] === -1) toEnd[u] = straightClear(nav, pu, b, avoid) ? Math.hypot(b.x - pu.x, b.z - pu.z) : -2
      if (toEnd[u]! >= 0) relax(T, toEnd[u]!)
    }
  }
  if (!Number.isFinite(dist[T]!)) return null
  const path: Vec2[] = []
  for (let i = T; i !== -1; i = prev[i]!) path.push(point(i))
  path.reverse()
  return { path, length: dist[T]! }
}

/** Length of the shortest route (centre to centre), Infinity when unreachable. */
export function routeLength(nav: Nav, a: Vec2, b: Vec2, avoid?: readonly AvoidDisc[]): number {
  return shortestRoute(nav, a, b, avoid)?.length ?? Infinity
}
