// Grid distance fields: the walking distance from every cell of the board to a goal (or from a fighter to every cell), with
// closed doors as walls. The engine's `nav` answers one pair of points at a time (a visibility graph); the planner asks about
// dozens of end spots per decision, so it reads a field instead: one Dijkstra on a half-inch grid, cached per board, door
// state, base radius and goal. The numbers are approximate (octile steps, half-inch cells), good enough to rank spots; the
// engine's own planner (`planMove`) judges every path that is finally submitted.
import { blockingPolygons, doorSignature, insideOutline } from '@/engine/board'
import { circleOverlapsPolygon, polygonBBox, type BBox } from '@/engine/geometry'
import type { BoardDef, GameState, Polygon, Vec2 } from '@/engine'

const STEP = 0.5
const DIAG = Math.SQRT2 * STEP

interface Grid {
  cols: number
  rows: number
  minX: number
  minZ: number
  /** 1 = a base of the grid's radius fits in the cell */
  free: Uint8Array
  /** 1 = a base cannot end here (it would stand on an obstacle: obstacles are crossed, never stood on) */
  noEnd: Uint8Array
}

export interface Field {
  grid: Grid
  dist: Float64Array
}

const gridCache = new WeakMap<BoardDef, Map<string, Grid>>()
const fieldCache = new WeakMap<BoardDef, Map<string, Field>>()

interface Boxed {
  poly: Polygon
  box: BBox
}

function overlapsAny(list: Boxed[], c: Vec2, r: number): boolean {
  for (const b of list) {
    if (c.x + r < b.box.minX || c.x - r > b.box.maxX || c.z + r < b.box.minZ || c.z - r > b.box.maxZ) continue
    if (circleOverlapsPolygon(c, r, b.poly)) return true
  }
  return false
}

/**
 * Door states for a field. `open` = the route the gang would take if its doors were opened: every door that can be operated
 * (closed and not locked) counts as open; a locked door stays a wall unless `locked` is also set.
 */
function doorsFor(state: GameState, open: boolean, locked: boolean): Record<string, { state: 'closed' | 'open' | 'destroyed'; locked: boolean; wounds: number }> {
  if (!open) return state.board.doors
  return Object.fromEntries(Object.entries(state.board.doors).map(([id, d]) => [id, d.locked && !locked ? d : { ...d, state: 'open' as const }]))
}

function lockSig(state: GameState): string {
  return state.board.def.doors.map((d) => (state.board.doors[d.id]?.locked ? 'L' : '-')).join('')
}

function gridFor(state: GameState, r: number, open: boolean, locked = false): Grid {
  const def = state.board.def
  const doors = doorsFor(state, open, locked)
  const key = `${open ? (locked ? 'all' : 'open:' + doorSignature(def, state.board.doors) + lockSig(state)) : doorSignature(def, state.board.doors)}:${r.toFixed(2)}`
  let byKey = gridCache.get(def)
  if (!byKey) {
    byKey = new Map()
    gridCache.set(def, byKey)
  }
  const hit = byKey.get(key)
  if (hit) return hit
  const blockers: Boxed[] = blockingPolygons(def, doors).map((poly) => ({ poly, box: polygonBBox(poly) }))
  const { minX, maxX, minZ, maxZ } = def.bounds
  const cols = Math.floor((maxX - minX) / STEP) + 1
  const rows = Math.floor((maxZ - minZ) / STEP) + 1
  const obstacles: Boxed[] = def.obstacles.map((o) => ({ poly: o.poly, box: polygonBBox(o.poly) }))
  const free = new Uint8Array(cols * rows)
  const noEnd = new Uint8Array(cols * rows)
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const c = { x: minX + ix * STEP, z: minZ + iz * STEP }
      if (insideOutline(def, c) && !overlapsAny(blockers, c, r)) {
        free[iz * cols + ix] = 1
        if (overlapsAny(obstacles, c, r)) noEnd[iz * cols + ix] = 1
      }
    }
  }
  const grid: Grid = { cols, rows, minX, minZ, free, noEnd }
  if (byKey.size > 24) byKey.clear()
  byKey.set(key, grid)
  return grid
}

function cellOf(g: Grid, p: Vec2): number {
  const ix = Math.round((p.x - g.minX) / STEP)
  const iz = Math.round((p.z - g.minZ) / STEP)
  if (ix < 0 || ix >= g.cols || iz < 0 || iz >= g.rows) return -1
  return iz * g.cols + ix
}

/** The nearest free cell to a point (the point's own cell when it is free), or -1. */
function nearestFree(g: Grid, p: Vec2, reach = 6): number {
  const c = cellOf(g, p)
  if (c >= 0 && g.free[c]) return c
  const ix0 = Math.round((p.x - g.minX) / STEP)
  const iz0 = Math.round((p.z - g.minZ) / STEP)
  for (let k = 1; k <= reach; k++) {
    let best = -1
    let bestD = Infinity
    for (let dz = -k; dz <= k; dz++) {
      for (let dx = -k; dx <= k; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== k) continue
        const ix = ix0 + dx
        const iz = iz0 + dz
        if (ix < 0 || ix >= g.cols || iz < 0 || iz >= g.rows) continue
        const i = iz * g.cols + ix
        if (g.free[i] && dx * dx + dz * dz < bestD) {
          bestD = dx * dx + dz * dz
          best = i
        }
      }
    }
    if (best >= 0) return best
  }
  return -1
}

class Heap {
  private keys: number[] = []
  private vals: number[] = []
  get size(): number {
    return this.keys.length
  }
  push(key: number, val: number): void {
    const k = this.keys
    const v = this.vals
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p]! <= key) break
      k[i] = k[p]!
      v[i] = v[p]!
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): { key: number; val: number } {
    const k = this.keys
    const v = this.vals
    const top = { key: k[0]!, val: v[0]! }
    const lk = k.pop()!
    const lv = v.pop()!
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1]! < k[c]!) c++
        if (k[c]! >= lk) break
        k[i] = k[c]!
        v[i] = v[c]!
        i = c
      }
      k[i] = lk
      v[i] = lv
    }
    return top
  }
}

function dijkstra(g: Grid, source: number): Float64Array {
  const dist = new Float64Array(g.cols * g.rows).fill(Infinity)
  if (source < 0) return dist
  const heap = new Heap()
  dist[source] = 0
  heap.push(0, source)
  while (heap.size > 0) {
    const { key, val } = heap.pop()
    if (key > dist[val]!) continue
    const ix = val % g.cols
    const iz = (val - ix) / g.cols
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const nx = ix + dx
        const nz = iz + dz
        if (nx < 0 || nx >= g.cols || nz < 0 || nz >= g.rows) continue
        const n = nz * g.cols + nx
        if (!g.free[n]) continue
        // a diagonal step may not squeeze between two blocked cells
        if (dx !== 0 && dz !== 0 && (!g.free[iz * g.cols + nx] || !g.free[nz * g.cols + ix])) continue
        const nd = key + (dx !== 0 && dz !== 0 ? DIAG : STEP)
        if (nd < dist[n]!) {
          dist[n] = nd
          heap.push(nd, n)
        }
      }
    }
  }
  return dist
}

/**
 * Walking distances from `from` to every cell for a base of radius `r`. With `open` every door counts as open (the route the
 * gang would take if the doors were opened). Cached per board, door state, radius and start cell.
 */
export function fieldFrom(state: GameState, from: Vec2, r: number, open: boolean | 'all' = false): Field {
  const def = state.board.def
  const g = gridFor(state, Math.round(r * 100) / 100, open !== false, open === 'all')
  const src = nearestFree(g, from)
  const key = `${open === 'all' ? 'all' : open ? 'open:' + doorSignature(def, state.board.doors) + lockSig(state) : doorSignature(def, state.board.doors)}:${r.toFixed(2)}:${src}`
  let byKey = fieldCache.get(def)
  if (!byKey) {
    byKey = new Map()
    fieldCache.set(def, byKey)
  }
  const hit = byKey.get(key)
  if (hit) return hit
  const f: Field = { grid: g, dist: dijkstra(g, src) }
  if (byKey.size > 96) byKey.clear()
  byKey.set(key, f)
  return f
}

/** Walking distance from the field's start to a point (centre to centre), Infinity when it cannot be reached. */
export function sampleField(f: Field, p: Vec2): number {
  const g = f.grid
  const c = cellOf(g, p)
  if (c >= 0 && g.free[c]) return f.dist[c]!
  // a point in a base-width gap (a door frame) reads the best neighbouring cell
  const n = nearestFree(g, p, 2)
  return n >= 0 ? f.dist[n]! + 0.5 : Infinity
}

/**
 * Walk downhill from `from` in a field built at the goal and return the first point where the route enters a polygon of
 * `doorPolys` (the doors that are closed right now), plus the point just before it. Used to find which door the gang must open.
 */
export function firstDoorOnRoute(state: GameState, field: Field, from: Vec2, doorPolys: { id: string; poly: Polygon }[]): { doorId: string; before: Vec2 } | null {
  const g = field.grid
  let cur = nearestFree(g, from)
  if (cur < 0) return null
  let prev: Vec2 = from
  for (let guard = 0; guard < 600; guard++) {
    const ix = cur % g.cols
    const iz = (cur - ix) / g.cols
    const here = { x: g.minX + ix * STEP, z: g.minZ + iz * STEP }
    for (const d of doorPolys) if (circleOverlapsPolygon(here, 0.45, d.poly)) return { doorId: d.id, before: prev }
    let best = cur
    let bestD = field.dist[cur]!
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const nx = ix + dx
        const nz = iz + dz
        if (nx < 0 || nx >= g.cols || nz < 0 || nz >= g.rows) continue
        const n = nz * g.cols + nx
        const d = field.dist[n]!
        if (d < bestD) {
          bestD = d
          best = n
        }
      }
    }
    if (best === cur) return null
    prev = here
    cur = best
    if (bestD <= 0.001) return null
  }
  return null
}

/** Points of the grid (spacing `every` cells) within `maxDist` of the field's start: the places a fighter could walk to. */
export function reachablePoints(f: Field, maxDist: number, every = 3): { p: Vec2; d: number }[] {
  const g = f.grid
  const out: { p: Vec2; d: number }[] = []
  for (let iz = 0; iz < g.rows; iz += every) {
    for (let ix = 0; ix < g.cols; ix += every) {
      const i = iz * g.cols + ix
      if (!g.free[i] || g.noEnd[i]) continue
      const d = f.dist[i]!
      if (d <= maxDist) out.push({ p: { x: g.minX + ix * STEP, z: g.minZ + iz * STEP }, d })
    }
  }
  return out
}
