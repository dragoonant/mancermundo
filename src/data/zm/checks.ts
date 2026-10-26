/**
 * Zone Mortalis tile and board checks (docs/spec/20-data-schema.md section 9: ZM-001, ZM-012 and the geometry rules around
 * them), run by validate.ts after the schema and reference checks. Data-side and engine-free (src/data never imports the
 * engine, BOUND-003): tiles are placed on the board with the same quarter-turn the engine compiler uses, and every check runs
 * on the placed raw geometry (walls as rectangles along their segments). The checks that need the compiled board (room for a
 * full crew in each deployment region, reachability without a locked door) live in src/engine/board-checks.ts and run from
 * tests/data/boards.test.ts; tests/data/boards.test.ts also proves this placement agrees with `compileBoard`.
 */
import type { BoardData, DoorData, Id, ObstacleData, Polygon, TileData, Vec2, WallData } from '../types'
import type { RecordIndex } from '../refs'
import { pointInPolygon, polygonArea, polygonDistance, polygonSegmentDistance, segDist } from '../geometry'

/** The N23 Zone Mortalis minimums (R-15.12) that ZM-012 enforces on every shipped board. */
export const MIN_DOORS = 3
export const MIN_BARRICADES = 1
export const MIN_DUCTS = 2
export const MIN_CASKET_SPOTS = 2
export const CASKET_EDGE = 6
/** Longest duct (constants.duct.maxLength). */
export const MAX_DUCT = 2
/** A loot casket is a disc 1" across. */
export const CASKET_RADIUS = 0.5
const TILE = 12
const HALF = TILE / 2
const EPS = 1e-6

/** Tile centres of each layout (00 section 7.1). */
export const LAYOUT_SLOTS: Record<BoardData['layout'], readonly Vec2[]> = {
  '2x3': [{ x: -6, z: -12 }, { x: 6, z: -12 }, { x: -6, z: 0 }, { x: 6, z: 0 }, { x: -6, z: 12 }, { x: 6, z: 12 }],
  brick7: [{ x: -6, z: -12 }, { x: 6, z: -12 }, { x: -12, z: 0 }, { x: 0, z: 0 }, { x: 12, z: 0 }, { x: -6, z: 12 }, { x: 6, z: 12 }],
}

const key = (p: Vec2) => `(${p.x}, ${p.z})`
const clean = (n: number) => Math.round(n * 1000) / 1000 + 0

// ------------------------------------------------------------------ placement
type Rot = 0 | 90 | 180 | 270

/** Clockwise quarter turns seen from above (+x right, +z down the page): (x, z) -> (-z, x). */
function place(p: Vec2, centre: Vec2, rot: Rot): Vec2 {
  const q = rot === 90 ? { x: -p.z, z: p.x } : rot === 180 ? { x: -p.x, z: -p.z } : rot === 270 ? { x: p.z, z: -p.x } : p
  return { x: clean(q.x + centre.x), z: clean(q.z + centre.z) }
}

function rect(a: Vec2, b: Vec2, t: number): Polygon {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const dx = (b.x - a.x) / len
  const dz = (b.z - a.z) / len
  const nx = -dz * (t / 2)
  const nz = dx * (t / 2)
  return [
    { x: a.x - nx, z: a.z - nz },
    { x: b.x - nx, z: b.z - nz },
    { x: b.x + nx, z: b.z + nz },
    { x: a.x + nx, z: a.z + nz },
  ]
}

interface PlacedWall { id: string; a: Vec2; b: Vec2; t: number; poly: Polygon }
interface PlacedDoor { id: string; a: Vec2; b: Vec2; locked: boolean; poly: Polygon; terminals: { id: string; pos: Vec2 }[] }
export interface Placed {
  centres: Vec2[]
  walls: PlacedWall[]
  doors: PlacedDoor[]
  ducts: { id: string; a: Vec2; b: Vec2 }[]
  obstacles: { id: string; kind: string; poly: Polygon }[]
  spots: Vec2[]
  outline: { a: Vec2; b: Vec2 }[]
}

/** Boundary of the union of the tile squares as straight runs (edges two tiles share cancel). */
export function outlineRuns(centres: readonly Vec2[]): { a: Vec2; b: Vec2 }[] {
  type E = { axis: 'h' | 'v'; c: number; lo: number; hi: number }
  const edges: E[] = []
  for (const c of centres) {
    edges.push({ axis: 'h', c: clean(c.z - HALF), lo: c.x - HALF, hi: c.x + HALF }, { axis: 'h', c: clean(c.z + HALF), lo: c.x - HALF, hi: c.x + HALF })
    edges.push({ axis: 'v', c: clean(c.x - HALF), lo: c.z - HALF, hi: c.z + HALF }, { axis: 'v', c: clean(c.x + HALF), lo: c.z - HALF, hi: c.z + HALF })
  }
  const lines = new Map<string, E[]>()
  for (const e of edges) lines.set(`${e.axis}:${e.c}`, [...(lines.get(`${e.axis}:${e.c}`) ?? []), e])
  const out: { a: Vec2; b: Vec2 }[] = []
  for (const list of lines.values()) {
    const first = list[0]!
    const marks = [...new Set(list.flatMap((e) => [clean(e.lo), clean(e.hi)]))].sort((p, q) => p - q)
    let run: [number, number] | null = null
    const flush = () => {
      if (!run) return
      out.push(first.axis === 'h' ? { a: { x: run[0], z: first.c }, b: { x: run[1], z: first.c } } : { a: { x: first.c, z: run[0] }, b: { x: first.c, z: run[1] } })
      run = null
    }
    for (let i = 0; i + 1 < marks.length; i++) {
      const lo = marks[i]!
      const hi = marks[i + 1]!
      const mid = (lo + hi) / 2
      if (list.filter((e) => e.lo < mid && e.hi > mid).length !== 1) flush()
      else if (run && Math.abs(run[1] - lo) < EPS) run[1] = hi
      else {
        flush()
        run = [lo, hi]
      }
    }
    flush()
  }
  return out
}

/** The board's tiles placed on the board, plus its extras and outline. Unknown tiles are skipped (reported elsewhere). */
export function placeBoard(board: BoardData, tiles: Readonly<Record<Id, TileData>>): Placed {
  const centres = board.tiles.map((t) => t.at)
  const out: Placed = { centres, walls: [], doors: [], ducts: [], obstacles: [], spots: [], outline: outlineRuns(centres) }
  const addWall = (w: WallData, id: string, f: (p: Vec2) => Vec2) => {
    const a = f(w.a)
    const b = f(w.b)
    out.walls.push({ id, a, b, t: w.thickness, poly: rect(a, b, w.thickness) })
  }
  const addDoor = (d: DoorData, id: string, f: (p: Vec2) => Vec2, terminals: { id: string; door: string; pos: Vec2 }[]) => {
    const a = f(d.a)
    const b = f(d.b)
    out.doors.push({ id, a, b, locked: d.locked, poly: rect(a, b, 0.5), terminals: terminals.filter((m) => m.door === d.id).map((m) => ({ id: m.id, pos: f(m.pos) })) })
  }
  const addObstacle = (o: ObstacleData, id: string, f: (p: Vec2) => Vec2) => out.obstacles.push({ id, kind: o.kind, poly: o.footprint.map(f) })
  board.tiles.forEach((p, i) => {
    const t = tiles[p.tile]
    if (!t) return
    const f = (q: Vec2) => place(q, p.at, p.rot)
    t.walls.forEach((w) => addWall(w, `t${i}.${w.id}`, f))
    t.doors.forEach((d) => addDoor(d, `t${i}.${d.id}`, f, t.terminals))
    t.ducts.forEach((u) => out.ducts.push({ id: `t${i}.${u.id}`, a: f(u.a), b: f(u.b) }))
    t.obstacles.forEach((o) => addObstacle(o, `t${i}.${o.id}`, f))
    t.casketSpots.forEach((s) => out.spots.push(f(s)))
  })
  const same = (q: Vec2) => q
  board.extra.walls.forEach((w) => addWall(w, `x.${w.id}`, same))
  board.extra.doors.forEach((d) => addDoor(d, `x.${d.id}`, same, board.extra.terminals))
  board.extra.ducts.forEach((u) => out.ducts.push({ id: `x.${u.id}`, a: u.a, b: u.b }))
  board.extra.obstacles.forEach((o) => addObstacle(o, `x.${o.id}`, same))
  board.extra.caskets.forEach((s) => out.spots.push(s))
  out.outline.forEach((s, k) => out.walls.push({ id: `o${k}`, a: s.a, b: s.b, t: 0.5, poly: rect(s.a, s.b, 0.5) }))
  return out
}

// ------------------------------------------------------------------ checks
function signedArea(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.z - b.x * a.z
  }
  return s / 2
}

const distToPoly = (p: Vec2, poly: Polygon): number => {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i]!, poly[(i + 1) % poly.length]!))
  return d
}

/** Tile-shape problems that do not depend on where the tile is placed (messages carry the tile id). */
export function tileProblems(t: TileData): string[] {
  const out: string[] = []
  for (const o of t.obstacles) {
    if (polygonArea(o.footprint) < EPS) out.push(`${t.id}.obstacles.${o.id}: footprint has no area`)
    else if (signedArea(o.footprint) < 0) out.push(`${t.id}.obstacles.${o.id}: footprint must be counter-clockwise`)
    const xs = o.footprint.map((p) => p.x)
    const zs = o.footprint.map((p) => p.z)
    const across = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
    if (across > 2 + EPS) out.push(`${t.id}.obstacles.${o.id}: ${across.toFixed(2)}" across, obstacles are at most 2" (R-7.11)`)
  }
  for (const w of t.walls) if (Math.hypot(w.a.x - w.b.x, w.a.z - w.b.z) < EPS) out.push(`${t.id}.walls.${w.id}: zero length`)
  for (const d of t.doors) {
    const len = Math.hypot(d.a.x - d.b.x, d.a.z - d.b.z)
    if (len < 1.5 || len > 6) out.push(`${t.id}.doors.${d.id}: ${len.toFixed(2)}" wide, a door is 1.5" to 6" (a base must fit through)`)
  }
  return out
}

/**
 * Every structural problem of one board: ZM-001 (layout and adjacency), the placed geometry (doors in wall gaps, terminals,
 * ducts, obstacles and casket spots clear of things, everything inside the outline) and ZM-012 (the N23 minimums).
 * Messages come without the file prefix.
 */
export function boardProblems(board: BoardData, tiles: Readonly<Record<Id, TileData>>): string[] {
  const out: string[] = []

  // ---- ZM-001: layout and adjacency
  const slots = LAYOUT_SLOTS[board.layout]
  const centres = board.tiles.map((t) => t.at)
  centres.forEach((c, i) => {
    for (let j = i + 1; j < centres.length; j++) {
      const o = centres[j]!
      if (Math.abs(c.x - o.x) < TILE - EPS && Math.abs(c.z - o.z) < TILE - EPS) out.push(`tiles ${i} and ${j} overlap (centres ${key(c)} and ${key(o)})`)
    }
    const shared = (o: Vec2) => {
      const dx = Math.abs(c.x - o.x)
      const dz = Math.abs(c.z - o.z)
      if (Math.abs(dx - TILE) < EPS && dz < TILE - EPS) return TILE - dz
      if (Math.abs(dz - TILE) < EPS && dx < TILE - EPS) return TILE - dx
      return 0
    }
    const best = Math.max(0, ...centres.map((o, j) => (j === i ? 0 : shared(o))))
    if (centres.length > 1 && best < HALF - EPS) out.push(`tile ${i} at ${key(c)} shares ${best}" of an edge with its best neighbour, less than half of ${TILE}" (R-15.1)`)
  })
  if (board.tiles.length !== slots.length) out.push(`layout ${board.layout} has ${slots.length} tiles, the board places ${board.tiles.length}`)
  for (const s of slots) if (!centres.some((c) => Math.abs(c.x - s.x) < EPS && Math.abs(c.z - s.z) < EPS)) out.push(`layout ${board.layout} needs a tile at ${key(s)}`)
  for (const c of centres) if (!slots.some((s) => Math.abs(c.x - s.x) < EPS && Math.abs(c.z - s.z) < EPS)) out.push(`tile at ${key(c)} is not a slot of layout ${board.layout}`)
  if (out.length > 0 || board.tiles.some((p) => !tiles[p.tile])) return out

  // ---- placed geometry
  const g = placeBoard(board, tiles)
  const wallPolys = g.walls.map((w) => w.poly)
  const doorPolys = g.doors.map((d) => d.poly)
  const obstaclePolys = g.obstacles.map((o) => o.poly)
  const insideOutline = (p: Vec2) => g.centres.some((c) => Math.abs(p.x - c.x) <= HALF + EPS && Math.abs(p.z - c.z) <= HALF + EPS)
  const inside = (what: string, p: Vec2) => {
    if (!insideOutline(p)) out.push(`${what} at ${key(p)} is outside the board`)
  }
  g.doors.forEach((d) => [d.a, d.b].forEach((e) => inside(`door ${d.id} end`, e)))
  g.ducts.forEach((u) => [u.a, u.b].forEach((e) => inside(`duct ${u.id} end`, e)))
  g.obstacles.forEach((o) => o.poly.forEach((p) => inside(`obstacle ${o.id}`, p)))
  g.spots.forEach((s) => inside('casket spot', s))
  g.doors.forEach((d) => d.terminals.forEach((m) => inside(`terminal ${m.id}`, m.pos)))

  // doors sit in wall gaps: both ends touch a wall, and the middle is not inside one
  for (const d of g.doors) {
    for (const [name, e] of [['a', d.a], ['b', d.b]] as const) {
      if (!g.walls.some((w) => segDist(e, w.a, w.b) <= w.t / 2 + 0.05)) out.push(`door ${d.id}: end ${name} ${key(e)} touches no wall (a door fills a gap in a wall)`)
    }
    const mid = { x: (d.a.x + d.b.x) / 2, z: (d.a.z + d.b.z) / 2 }
    if (wallPolys.some((p) => pointInPolygon(mid, p))) out.push(`door ${d.id}: its middle ${key(mid)} lies inside a wall, not in a gap`)
  }

  // terminals: within 1" of their door, exactly one per side of a locked door, none on an unlocked one
  for (const d of g.doors) {
    const sides = { left: 0, right: 0 }
    for (const m of d.terminals) {
      const gap = segDist(m.pos, d.a, d.b)
      if (gap > 1 + EPS) out.push(`door ${d.id}: terminal ${m.id} is ${gap.toFixed(2)}" from the door, more than 1"`)
      if (wallPolys.some((p) => pointInPolygon(m.pos, p)) || obstaclePolys.some((p) => pointInPolygon(m.pos, p))) out.push(`terminal ${m.id} at ${key(m.pos)} is inside a wall or obstacle`)
      const cross = (d.b.x - d.a.x) * (m.pos.z - d.a.z) - (d.b.z - d.a.z) * (m.pos.x - d.a.x)
      if (cross > 0) sides.left++
      else sides.right++
    }
    if (d.locked && (sides.left !== 1 || sides.right !== 1)) out.push(`door ${d.id}: a locked door needs exactly one terminal on each side (found ${sides.left} and ${sides.right})`)
    if (!d.locked && d.terminals.length > 0) out.push(`door ${d.id}: terminals belong to locked doors`)
  }

  // ducts: free floor at both ends, at most 2" long, through exactly one wall
  for (const u of g.ducts) {
    const len = Math.hypot(u.a.x - u.b.x, u.a.z - u.b.z)
    if (len > MAX_DUCT + EPS) out.push(`duct ${u.id}: ${len.toFixed(2)}" long, at most ${MAX_DUCT}" (R-15.9)`)
    for (const e of [u.a, u.b]) {
      if ([...wallPolys, ...doorPolys, ...obstaclePolys].some((p) => pointInPolygon(e, p))) out.push(`duct ${u.id}: end ${key(e)} is inside a wall, door or obstacle`)
    }
    // walls written twice along a shared tile edge count once: group the crossed walls by their line
    const crossed = new Set(g.walls.filter((w) => polygonSegmentDistance(w.poly, u.a, u.b) === 0).map((w) => (Math.abs(w.a.z - w.b.z) < EPS ? `h${w.a.z}` : Math.abs(w.a.x - w.b.x) < EPS ? `v${w.a.x}` : w.id)))
    if (crossed.size !== 1) out.push(`duct ${u.id}: crosses ${crossed.size} walls, a duct goes through exactly one`)
  }

  // obstacles clear of walls, doors and each other
  g.obstacles.forEach((o, i) => {
    for (const p of [...wallPolys, ...doorPolys]) {
      if (polygonDistance(o.poly, p) < 0.05) {
        out.push(`obstacle ${o.id} touches a wall or door`)
        break
      }
    }
    for (let j = i + 1; j < g.obstacles.length; j++) if (polygonDistance(o.poly, g.obstacles[j]!.poly) < EPS) out.push(`obstacles ${o.id} and ${g.obstacles[j]!.id} overlap`)
  })

  // casket spots clear of everything (a disc 1" across)
  for (const s of g.spots) {
    if ([...wallPolys, ...doorPolys, ...obstaclePolys].some((p) => pointInPolygon(s, p) || distToPoly(s, p) < CASKET_RADIUS - EPS)) {
      out.push(`casket spot ${key(s)} is less than ${CASKET_RADIUS}" from a wall, door or obstacle`)
    }
  }

  // ---- ZM-012: the N23 minimums
  if (g.doors.length < MIN_DOORS) out.push(`ZM-012: ${g.doors.length} doors, at least ${MIN_DOORS} (R-15.12)`)
  const barricades = g.obstacles.filter((o) => o.kind === 'barricade').length
  if (barricades < MIN_BARRICADES) out.push(`ZM-012: ${barricades} barricades, at least ${MIN_BARRICADES} authored`)
  if (g.ducts.length < MIN_DUCTS) out.push(`ZM-012: ${g.ducts.length} ductways, at least ${MIN_DUCTS}`)
  const far = g.spots.filter((s) => Math.min(...g.outline.map((r) => segDist(s, r.a, r.b))) >= CASKET_EDGE - EPS)
  if (far.length < MIN_CASKET_SPOTS) out.push(`ZM-012: ${far.length} casket spots at least ${CASKET_EDGE}" from every board edge, need ${MIN_CASKET_SPOTS}`)
  return out
}

/** Check every tile and board in an index (schema and references already passed). Messages are `file: message`. */
export function checkZm(index: RecordIndex, errors: string[]): void {
  const tiles: Record<Id, TileData> = {}
  const boards: BoardData[] = []
  for (const [id, rec] of Object.entries(index.byId)) {
    if (index.types[id] === 'tile') tiles[id] = rec as TileData
    else if (index.types[id] === 'board') boards.push(rec as BoardData)
  }
  for (const t of Object.values(tiles)) for (const m of tileProblems(t)) errors.push(`${index.files[t.id]}: ${m}`)
  for (const b of boards) for (const m of boardProblems(b, tiles)) errors.push(`${index.files[b.id]}: ${b.id}: ${m}`)
}
