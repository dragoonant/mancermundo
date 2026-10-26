// Ground navigation on a 0.5" grid: which cells a base of radius r can stand on (the engine's own terrain tests,
// doorways included), shortest-path distance fields, and string-pulled waypoint routes. The engine prices and
// validates every route (`planMove`); this module only proposes them, so terrain walls no longer hide charge
// targets, cover spots and objectives from the planner. Floor level only (Vantage is handled by the planner).
import { distToPolygon, type BBox } from '@/engine/geometry'
import { discBlockedBy, insideKillzone, terrainOf } from '@/engine/terrain'
import type { MapDef, Vec2, Waypoint } from '@/engine'

const CELL = 0.5

export interface Grid {
  nx: number
  nz: number
  x0: number
  z0: number
  r: number
  blocked: Uint8Array
}

const grids = new WeakMap<MapDef, Map<string, Grid>>()

/** Passability of the floor for a base of radius r (doorways open, as in the engine's checkSample). */
export function gridFor(map: MapDef, r: number, h: number): Grid {
  let byKey = grids.get(map)
  if (!byKey) {
    byKey = new Map()
    grids.set(map, byKey)
  }
  const key = `${Math.round(r * 100)}|${Math.round(h * 10)}`
  const hit = byKey.get(key)
  if (hit) return hit
  const idx = terrainOf(map)
  const x0 = -idx.halfX
  const z0 = -idx.halfZ
  const nx = Math.ceil((idx.halfX * 2) / CELL) + 1
  const nz = Math.ceil((idx.halfZ * 2) / CELL) + 1
  const blocked = new Uint8Array(nx * nz)
  const accessibles = idx.solids.filter((s) => s.accessible && s.top > 0.01)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = { x: x0 + i * CELL, z: z0 + j * CELL }
      if (!insideKillzone(idx, c, r)) {
        blocked[j * nx + i] = 1
        continue
      }
      let skip: Set<string> | undefined
      for (const s of accessibles) {
        if (distToPolygon(c, s.polygon) <= r + 1e-6) (skip ??= new Set()).add(s.featureId)
      }
      let skipParts: Set<string> | undefined
      if (skip) {
        skipParts = new Set()
        for (const s of idx.solids) if (skip.has(s.featureId)) skipParts.add(s.partId)
      }
      if (discBlockedBy(idx, c, 0, r, h, skipParts)) blocked[j * nx + i] = 1
    }
  }
  const g: Grid = { nx, nz, x0, z0, r, blocked }
  byKey.set(key, g)
  return g
}

function cellOf(g: Grid, p: Vec2): number {
  const i = Math.max(0, Math.min(g.nx - 1, Math.round((p.x - g.x0) / CELL)))
  const j = Math.max(0, Math.min(g.nz - 1, Math.round((p.z - g.z0) / CELL)))
  return j * g.nx + i
}

function centreOf(g: Grid, c: number): Vec2 {
  return { x: g.x0 + (c % g.nx) * CELL, z: g.z0 + Math.floor(c / g.nx) * CELL }
}

export interface Field {
  grid: Grid
  dist: Float32Array
  parent: Int32Array
  src: number
}

export interface Avoid {
  x: number
  z: number
  r: number
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

const SQRT2 = Math.SQRT2 * CELL

/** Shortest-path distances (inches) from `from` over free cells, up to `maxCost`; enemy bases in `avoid` are walls. */
export function distanceField(grid: Grid, from: Vec2, maxCost = Infinity, avoid: Avoid[] = []): Field {
  const n = grid.nx * grid.nz
  const dist = new Float32Array(n).fill(Infinity)
  const parent = new Int32Array(n).fill(-1)
  const src = cellOf(grid, from)
  const blockedByAvoid = (c: number): boolean => {
    if (avoid.length === 0) return false
    const p = centreOf(grid, c)
    for (const a of avoid) if (Math.hypot(p.x - a.x, p.z - a.z) < a.r + grid.r - 1e-6) return true
    return false
  }
  dist[src] = 0
  const heap = new MinHeap()
  heap.push(0, src)
  while (heap.size > 0) {
    const [d, c] = heap.pop()
    if (d > dist[c]!) continue
    if (d > maxCost) break
    const ci = c % grid.nx
    const cj = Math.floor(c / grid.nx)
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue
        const i = ci + di
        const j = cj + dj
        if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) continue
        const nc = j * grid.nx + i
        if (grid.blocked[nc]) continue
        // a diagonal step may not cut a blocked corner
        if (di !== 0 && dj !== 0 && (grid.blocked[cj * grid.nx + i] || grid.blocked[j * grid.nx + ci])) continue
        if (blockedByAvoid(nc)) continue
        const nd = d + (di !== 0 && dj !== 0 ? SQRT2 : CELL)
        if (nd < dist[nc]!) {
          dist[nc] = nd
          parent[nc] = c
          heap.push(nd, nc)
        }
      }
    }
  }
  return { grid, dist, parent, src }
}

export function distAt(f: Field, p: Vec2): number {
  return f.dist[cellOf(f.grid, p)]!
}

/** Is the straight segment a-b free of blocked cells (sampled every quarter inch)? */
function clear(g: Grid, a: Vec2, b: Vec2, avoid: Avoid[]): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const n = Math.max(1, Math.ceil(len / 0.25))
  for (let k = 0; k <= n; k++) {
    const t = k / n
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
    // a sample is free when the nearest cell and the cells around it along the segment are free
    if (g.blocked[cellOf(g, p)]) return false
    for (const av of avoid) if (Math.hypot(p.x - av.x, p.z - av.z) < av.r + g.r - 1e-6) return false
  }
  return true
}

/**
 * A route from the field's source to `to` (nearest free cell), pulled straight: as few waypoints as the walls allow
 * (the engine rounds each straight increment up to a whole inch, so fewer is cheaper). Null when unreachable.
 */
export function routeTo(f: Field, to: Vec2, avoid: Avoid[] = [], maxWaypoints = 8): Waypoint[] | null {
  const g = f.grid
  let c = cellOf(g, to)
  if (!Number.isFinite(f.dist[c]!)) return null
  const chain: Vec2[] = []
  while (c !== -1 && c !== f.src) {
    chain.push(centreOf(g, c))
    c = f.parent[c]!
  }
  chain.push(centreOf(g, f.src))
  chain.reverse()
  chain[chain.length - 1] = { x: to.x, z: to.z }
  // string pulling
  const pts: Vec2[] = [chain[0]!]
  let i = 0
  while (i < chain.length - 1) {
    let j = chain.length - 1
    while (j > i + 1 && !clear(g, chain[i]!, chain[j]!, avoid)) j--
    pts.push(chain[j]!)
    i = j
  }
  pts.shift()
  if (pts.length === 0 || pts.length > maxWaypoints) return null
  return pts.map((p) => ({ x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 }))
}

// ---------------------------------------------------------------------------
// Path distances to fixed targets (objective markers), cached per map
// ---------------------------------------------------------------------------

const targetFields = new WeakMap<MapDef, Map<string, Field>>()

/** Path distance in inches from `from` to `target` for a base of radius r; Euclidean x1.4 when the grid cannot say. */
export function pathDistance(map: MapDef, r: number, h: number, from: Vec2, target: Vec2): number {
  const g = gridFor(map, r, h)
  let byKey = targetFields.get(map)
  if (!byKey) {
    byKey = new Map()
    targetFields.set(map, byKey)
  }
  const key = `${Math.round(r * 100)}|${Math.round(target.x * 4)},${Math.round(target.z * 4)}`
  let f = byKey.get(key)
  if (!f) {
    // markers sit on free ground; if the exact cell is blocked, start from the nearest free neighbour
    f = distanceField(g, target)
    byKey.set(key, f)
  }
  const d = distAt(f, from)
  return Number.isFinite(d) ? d : Math.hypot(from.x - target.x, from.z - target.z) * 1.4
}

export type { BBox }
