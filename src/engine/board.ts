// Zone Mortalis board compiler (stage S1Z). Turns a data board (tiles placed by centre and quarter-turn rotation, plus the
// board's own extras) into the `BoardDef` of types.ts: wall rectangles, door rectangles, obstacle polygons, ducts, terminals,
// casket spots and tile rectangles, with the board outline added as walls. Also the pure helpers every later stage uses to
// ask the board a question: door state, blockers, free-space tests, deployment regions, reachability.
//
// Conventions (docs/spec/00-architecture.md 7.1, 20-data-schema.md 9):
//  - 1 unit = 1 inch, board centred on the origin, tile-local coordinates in [-6, 6] (+z = the tile's "north").
//  - A tile rotation is clockwise as seen from above the board, i.e. looking down with +x to the right and +z down the
//    screen: one quarter turn maps (x, z) -> (-z, x). So north (+z) -> west (-x) -> south (-z) -> east (+x) -> north.
//    The same turn maps a facing (bearing from +z towards +x) by subtracting a quarter turn.
//  - Walls on a tile edge shared by two tiles may be written by both tiles: collinear walls of equal thickness that overlap
//    or touch are merged, so a seam is closed wherever either tile has a wall and open only where both are open.
//  - The outline (union of the tile squares) is closed with walls centred on its boundary.
//  - A wall is a rectangle along its segment. Where a wall end meets another wall (a corner, a T, the outline) it is
//    extended by half its thickness so corners are filled; a wall end that meets a door end stays flat so the door gap is
//    exactly the door segment.
//
// The engine imports nothing outside src/engine except the type-only data records.
import type { BoardData, DoorData, ObstacleData, TileData, WallData } from '../data/types'
import type { BoardDef, DoorState, Polygon, Segment2, Vec2 } from './types'
import { EPS, circleOverlapsPolygon, distPointSegment, pointInPolygon, polygonBBox, round3, type BBox } from './geometry'

export type Rot = 0 | 90 | 180 | 270
export type Layout = BoardData['layout']

export const TILE_SIZE = 12
export const HALF_TILE = TILE_SIZE / 2
export const WALL_THICKNESS = 0.5
export const DOOR_THICKNESS = 0.5
/** A 25 mm base, the smallest base in v1 data (mm / 25.4 / 2 rounded to 1/1000). */
export const SMALL_BASE_RADIUS = 0.492

/** Tile centres of each layout (00 7.1): the six slots of 2x3 and the seven of the Forgotten Riches brick. */
export const LAYOUT_TILES: Record<Layout, readonly Vec2[]> = {
  '2x3': [
    { x: -6, z: -12 }, { x: 6, z: -12 },
    { x: -6, z: 0 }, { x: 6, z: 0 },
    { x: -6, z: 12 }, { x: 6, z: 12 },
  ],
  brick7: [
    { x: -6, z: -12 }, { x: 6, z: -12 },
    { x: -12, z: 0 }, { x: 0, z: 0 }, { x: 12, z: 0 },
    { x: -6, z: 12 }, { x: 6, z: 12 },
  ],
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

const clean = (n: number): number => round3(n) + 0 // + 0 turns -0 into 0
const pt = (x: number, z: number): Vec2 => ({ x: clean(x), z: clean(z) })

function turn(p: Vec2, rot: Rot): Vec2 {
  switch (rot) {
    case 90: return { x: -p.z, z: p.x }
    case 180: return { x: -p.x, z: -p.z }
    case 270: return { x: p.z, z: -p.x }
    default: return { x: p.x, z: p.z }
  }
}

/** Rotate a tile-local point about the tile centre by a clockwise quarter-turn multiple (exact for integer coordinates). */
export function rotatePoint(p: Vec2, rot: Rot): Vec2 {
  const q = turn(p, rot)
  return pt(q.x, q.z)
}

/** Tile-local point -> board point. */
export function placePoint(p: Vec2, centre: Vec2, rot: Rot): Vec2 {
  const q = turn(p, rot)
  return pt(q.x + centre.x, q.z + centre.z)
}

/** Board point -> tile-local point (inverse of `placePoint`). */
export function unplacePoint(p: Vec2, centre: Vec2, rot: Rot): Vec2 {
  const inverse: Record<Rot, Rot> = { 0: 0, 90: 270, 180: 180, 270: 90 }
  const q = turn({ x: p.x - centre.x, z: p.z - centre.z }, inverse[rot])
  return pt(q.x, q.z)
}

/** A tile-local yaw (radians, bearing from +z towards +x) after the tile is rotated. */
export function rotateYaw(yaw: number, rot: Rot): number {
  const v = turn({ x: Math.sin(yaw), z: Math.cos(yaw) }, rot)
  return clean(Math.atan2(v.x, v.z))
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

/** Rectangle (counter-clockwise in x/z) along a segment, `t` thick, optionally extended past either end. */
export function segmentRect(a: Vec2, b: Vec2, t: number, extendA = 0, extendB = 0): Polygon {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  if (len < EPS) throw new Error(`board: zero-length segment at (${a.x}, ${a.z})`)
  const dx = (b.x - a.x) / len
  const dz = (b.z - a.z) / len
  const nx = -dz * (t / 2)
  const nz = dx * (t / 2)
  const a2 = { x: a.x - dx * extendA, z: a.z - dz * extendA }
  const b2 = { x: b.x + dx * extendB, z: b.z + dz * extendB }
  return [
    pt(a2.x - nx, a2.z - nz),
    pt(b2.x - nx, b2.z - nz),
    pt(b2.x + nx, b2.z + nz),
    pt(a2.x + nx, a2.z + nz),
  ]
}

function signedArea(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.z - b.x * a.z
  }
  return s / 2
}

function ccw(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly
}

/** The 12" square of a tile placed at `centre`, counter-clockwise. */
export function tileSquare(centre: Vec2): Polygon {
  return [
    pt(centre.x - HALF_TILE, centre.z - HALF_TILE),
    pt(centre.x + HALF_TILE, centre.z - HALF_TILE),
    pt(centre.x + HALF_TILE, centre.z + HALF_TILE),
    pt(centre.x - HALF_TILE, centre.z + HALF_TILE),
  ]
}

function rectPoly(minX: number, minZ: number, maxX: number, maxZ: number): Polygon {
  return [pt(minX, minZ), pt(maxX, minZ), pt(maxX, maxZ), pt(minX, maxZ)]
}

// ---------------------------------------------------------------------------
// Layout checks (ZM-001)
// ---------------------------------------------------------------------------

/** Length of the edge two flush tile squares share (0 when they only touch at a corner or not at all). */
export function sharedEdge(a: Vec2, b: Vec2): number {
  const dx = Math.abs(a.x - b.x)
  const dz = Math.abs(a.z - b.z)
  if (Math.abs(dx - TILE_SIZE) < EPS && dz < TILE_SIZE - EPS) return TILE_SIZE - dz
  if (Math.abs(dz - TILE_SIZE) < EPS && dx < TILE_SIZE - EPS) return TILE_SIZE - dx
  return 0
}

/** ZM-001: tiles that overlap, repeat a position, or share less than half an edge with every other tile. */
export function adjacencyProblems(centres: readonly Vec2[]): string[] {
  const problems: string[] = []
  centres.forEach((c, i) => {
    for (let j = i + 1; j < centres.length; j++) {
      const o = centres[j]!
      if (Math.abs(c.x - o.x) < TILE_SIZE - EPS && Math.abs(c.z - o.z) < TILE_SIZE - EPS) {
        problems.push(`tiles ${i} and ${j} overlap (centres (${c.x}, ${c.z}) and (${o.x}, ${o.z}))`)
      }
    }
    if (centres.length > 1) {
      const best = Math.max(...centres.map((o, j) => (j === i ? 0 : sharedEdge(c, o))))
      if (best < HALF_TILE - EPS) problems.push(`tile ${i} at (${c.x}, ${c.z}) shares ${best}" of an edge with its best neighbour, less than half of ${HALF_TILE * 2}" (R-15.1)`)
    }
  })
  return problems
}

/** Structural problems of a data board that stop it compiling: bad adjacency or tiles that are not the layout's slots. */
export function boardProblems(board: Pick<BoardData, 'id' | 'layout' | 'tiles'>): string[] {
  const centres = board.tiles.map((t) => t.at)
  const problems = adjacencyProblems(centres)
  const slots = LAYOUT_TILES[board.layout]
  if (board.tiles.length !== slots.length) problems.push(`layout ${board.layout} has ${slots.length} tiles, the board places ${board.tiles.length}`)
  for (const s of slots) {
    if (!centres.some((c) => Math.abs(c.x - s.x) < EPS && Math.abs(c.z - s.z) < EPS)) problems.push(`layout ${board.layout} needs a tile at (${s.x}, ${s.z})`)
  }
  for (const c of centres) {
    if (!slots.some((s) => Math.abs(c.x - s.x) < EPS && Math.abs(c.z - s.z) < EPS)) problems.push(`tile at (${c.x}, ${c.z}) is not a slot of layout ${board.layout}`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

interface Edge {
  axis: 'h' | 'v'
  /** z for a horizontal edge, x for a vertical one */
  c: number
  lo: number
  hi: number
}

/** Boundary of the union of the tile squares as straight runs (edges two tiles share cancel out). */
export function outlineSegments(centres: readonly Vec2[]): Segment2[] {
  const edges: Edge[] = []
  for (const c of centres) {
    edges.push({ axis: 'h', c: clean(c.z - HALF_TILE), lo: c.x - HALF_TILE, hi: c.x + HALF_TILE })
    edges.push({ axis: 'h', c: clean(c.z + HALF_TILE), lo: c.x - HALF_TILE, hi: c.x + HALF_TILE })
    edges.push({ axis: 'v', c: clean(c.x - HALF_TILE), lo: c.z - HALF_TILE, hi: c.z + HALF_TILE })
    edges.push({ axis: 'v', c: clean(c.x + HALF_TILE), lo: c.z - HALF_TILE, hi: c.z + HALF_TILE })
  }
  const lines = new Map<string, Edge[]>()
  for (const e of edges) {
    const key = `${e.axis}:${e.c}`
    const list = lines.get(key)
    if (list) list.push(e)
    else lines.set(key, [e])
  }
  const out: Segment2[] = []
  const keys = [...lines.keys()].sort((p, q) => {
    const [pa, pc] = p.split(':')
    const [qa, qc] = q.split(':')
    return pa === qa ? Number(pc) - Number(qc) : pa! < qa! ? -1 : 1
  })
  for (const key of keys) {
    const list = lines.get(key)!
    const marks = [...new Set(list.flatMap((e) => [clean(e.lo), clean(e.hi)]))].sort((p, q) => p - q)
    let run: [number, number] | null = null
    const flush = () => {
      if (!run) return
      const first = list[0]!
      out.push(first.axis === 'h' ? { a: pt(run[0], first.c), b: pt(run[1], first.c) } : { a: pt(first.c, run[0]), b: pt(first.c, run[1]) })
      run = null
    }
    for (let i = 0; i + 1 < marks.length; i++) {
      const lo = marks[i]!
      const hi = marks[i + 1]!
      const mid = (lo + hi) / 2
      const cover = list.filter((e) => e.lo < mid && e.hi > mid).length
      if (cover === 1) {
        if (run && Math.abs(run[1] - lo) < EPS) run[1] = hi
        else {
          flush()
          run = [lo, hi]
        }
      } else flush()
    }
    flush()
  }
  return out
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

interface RawWall {
  id: string
  a: Vec2
  b: Vec2
  t: number
}

/** Merge collinear axis-aligned walls of equal thickness that overlap or touch (seam duplicates, split runs). */
function mergeWalls(walls: RawWall[]): RawWall[] {
  type Slot = { order: number; wall: RawWall; lo: number; hi: number }
  const groups = new Map<string, Slot[]>()
  const result: { order: number; wall: RawWall }[] = []
  walls.forEach((w, order) => {
    const horizontal = Math.abs(w.a.z - w.b.z) < EPS
    const vertical = Math.abs(w.a.x - w.b.x) < EPS
    if (!horizontal && !vertical) {
      result.push({ order, wall: w })
      return
    }
    const key = horizontal ? `h:${clean(w.a.z)}:${w.t}` : `v:${clean(w.a.x)}:${w.t}`
    const lo = horizontal ? Math.min(w.a.x, w.b.x) : Math.min(w.a.z, w.b.z)
    const hi = horizontal ? Math.max(w.a.x, w.b.x) : Math.max(w.a.z, w.b.z)
    const list = groups.get(key)
    if (list) list.push({ order, wall: w, lo, hi })
    else groups.set(key, [{ order, wall: w, lo, hi }])
  })
  for (const [key, list] of groups) {
    const horizontal = key.startsWith('h:')
    const c = Number(key.split(':')[1])
    list.sort((p, q) => p.lo - q.lo)
    let cur: { order: number; id: string; lo: number; hi: number; t: number } | null = null
    const push = () => {
      if (!cur) return
      const a = horizontal ? pt(cur.lo, c) : pt(c, cur.lo)
      const b = horizontal ? pt(cur.hi, c) : pt(c, cur.hi)
      result.push({ order: cur.order, wall: { id: cur.id, a, b, t: cur.t } })
    }
    for (const s of list) {
      if (cur && s.lo <= cur.hi + EPS) {
        cur.hi = Math.max(cur.hi, s.hi)
        if (s.order < cur.order) {
          cur.order = s.order
          cur.id = s.wall.id
        }
      } else {
        push()
        cur = { order: s.order, id: s.wall.id, lo: s.lo, hi: s.hi, t: s.wall.t }
      }
    }
    push()
  }
  return result.sort((p, q) => p.order - q.order).map((r) => r.wall)
}

/** Wall rectangles with their ends extended into whatever they join (corners, Ts, the outline). */
function buildWalls(walls: RawWall[], doorEnds: Vec2[]): BoardDef['walls'] {
  const near = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < 0.02 && Math.abs(p.z - q.z) < 0.02
  return walls.map((w) => {
    const extend = (e: Vec2): number => {
      if (doorEnds.some((d) => near(d, e))) return 0
      return walls.some((o) => o !== w && distPointSegment(e, o.a, o.b) <= o.t / 2 + 0.02) ? w.t / 2 : 0
    }
    const ea = extend(w.a)
    const eb = extend(w.b)
    return { id: w.id, seg: { a: w.a, b: w.b }, thickness: w.t, poly: segmentRect(w.a, w.b, w.t, ea, eb) }
  })
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

function placeWall(w: WallData, id: string, centre: Vec2, rot: Rot): RawWall {
  return { id, a: placePoint(w.a, centre, rot), b: placePoint(w.b, centre, rot), t: w.thickness }
}

function placeDoor(d: DoorData, id: string, centre: Vec2, rot: Rot, terminals: { id: string; door: string; pos: Vec2 }[]): BoardDef['doors'][number] {
  const a = placePoint(d.a, centre, rot)
  const b = placePoint(d.b, centre, rot)
  return {
    id,
    seg: { a, b },
    poly: segmentRect(a, b, DOOR_THICKNESS),
    lockedAtStart: d.locked,
    terminals: terminals.filter((m) => m.door === d.id).map((m) => ({ id: m.id, pos: placePoint(m.pos, centre, rot) })),
  }
}

function placeObstacle(o: ObstacleData, id: string, centre: Vec2, rot: Rot): BoardDef['obstacles'][number] {
  return { id, kind: o.kind, poly: ccw(o.footprint.map((p) => placePoint(p, centre, rot))) }
}

/**
 * Compile a data board. Ids on the result are prefixed by origin: `t<i>.<id>` for the i-th tile placement, `x.<id>` for the
 * board's extras, `o<n>` for outline walls. Throws when the board cannot compile (unknown tile, ZM-001/layout problems).
 */
export function compileBoard(board: BoardData, tiles: Readonly<Record<string, TileData>>): BoardDef {
  const problems = boardProblems(board)
  if (problems.length > 0) throw new Error(`board ${board.id}: ${problems.join('; ')}`)

  const raw: RawWall[] = []
  const doors: BoardDef['doors'] = []
  const ducts: BoardDef['ducts'] = []
  const obstacles: BoardDef['obstacles'] = []
  const casketSpots: Vec2[] = []
  const props: BoardDef['props'] = []
  const defTiles: BoardDef['tiles'] = []

  board.tiles.forEach((p, i) => {
    const tile = tiles[p.tile]
    if (!tile) throw new Error(`board ${board.id}: unknown tile ${p.tile}`)
    const prefix = `t${i}`
    defTiles.push({ id: prefix, tileId: tile.id, centre: { ...p.at }, rot: p.rot, rect: tileSquare(p.at), floor: tile.floor.style })
    for (const w of tile.walls) raw.push(placeWall(w, `${prefix}.${w.id}`, p.at, p.rot))
    for (const d of tile.doors) doors.push(placeDoor(d, `${prefix}.${d.id}`, p.at, p.rot, tile.terminals))
    for (const u of tile.ducts) ducts.push({ id: `${prefix}.${u.id}`, a: placePoint(u.a, p.at, p.rot), b: placePoint(u.b, p.at, p.rot) })
    for (const o of tile.obstacles) obstacles.push(placeObstacle(o, `${prefix}.${o.id}`, p.at, p.rot))
    for (const s of tile.casketSpots) casketSpots.push(placePoint(s, p.at, p.rot))
    for (const pr of tile.floor.props) props.push({ model: pr.model, pos: placePoint(pr.pos, p.at, p.rot), yaw: rotateYaw(pr.yaw, p.rot) })
  })

  const origin = { x: 0, z: 0 }
  const ex = board.extra
  for (const w of ex.walls) raw.push(placeWall(w, `x.${w.id}`, origin, 0))
  for (const d of ex.doors) doors.push(placeDoor(d, `x.${d.id}`, origin, 0, ex.terminals))
  for (const u of ex.ducts) ducts.push({ id: `x.${u.id}`, a: { ...u.a }, b: { ...u.b } })
  for (const o of ex.obstacles) obstacles.push(placeObstacle(o, `x.${o.id}`, origin, 0))
  for (const s of ex.caskets) casketSpots.push({ x: s.x, z: s.z })

  const centres = board.tiles.map((t) => t.at)
  outlineSegments(centres).forEach((s, k) => raw.push({ id: `o${k}`, a: s.a, b: s.b, t: WALL_THICKNESS }))

  const doorEnds = doors.flatMap((d) => [d.seg.a, d.seg.b])
  const walls = buildWalls(mergeWalls(raw), doorEnds)

  const xs = centres.flatMap((c) => [c.x - HALF_TILE, c.x + HALF_TILE])
  const zs = centres.flatMap((c) => [c.z - HALF_TILE, c.z + HALF_TILE])
  return {
    id: board.id,
    layout: board.layout,
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
    tiles: defTiles,
    outline: centres.map(tileSquare),
    walls,
    doors,
    ducts,
    obstacles,
    casketSpots,
    props,
  }
}

/** Compile every board of a data set (boards by id, tiles by id). */
export function compileBoards(boards: Readonly<Record<string, BoardData>>, tiles: Readonly<Record<string, TileData>>): Record<string, BoardDef> {
  const out: Record<string, BoardDef> = {}
  for (const [id, b] of Object.entries(boards)) out[id] = compileBoard(b, tiles)
  return out
}

// ---------------------------------------------------------------------------
// Door state (00 7.1: closed = a wall; open or destroyed = a gap; all doors start closed)
// ---------------------------------------------------------------------------

export interface DoorRecord {
  state: DoorState
  locked: boolean
  /** damage taken so far (a door has constants.door.wounds, T5, no save) */
  wounds: number
}
export type DoorStates = Record<string, DoorRecord>

/** Every door closed, locked as authored, undamaged (R-15.5). */
export function initialDoors(def: BoardDef): DoorStates {
  return Object.fromEntries(def.doors.map((d) => [d.id, { state: 'closed' as DoorState, locked: d.lockedAtStart, wounds: 0 }]))
}

/** A closed door blocks movement, line of sight and measuring like a wall. */
export function isDoorBlocking(d: DoorRecord): boolean {
  return d.state === 'closed'
}

/** Cache key for anything derived from the set of blocking doors (nav graphs, reach grids). */
export function doorSignature(def: BoardDef, doors: DoorStates): string {
  return def.doors.map((d) => (doors[d.id] && isDoorBlocking(doors[d.id]!) ? '1' : '0')).join('')
}

/** A copy with one door changed; unknown ids are rejected. */
export function withDoor(doors: DoorStates, id: string, patch: Partial<DoorRecord>): DoorStates {
  const cur = doors[id]
  if (!cur) throw new Error(`board: unknown door ${id}`)
  return { ...doors, [id]: { ...cur, ...patch } }
}

/** Apply damage to a door; at `maxWounds` it is destroyed (permanently open, R-15.8). */
export function damageDoor(doors: DoorStates, id: string, damage: number, maxWounds: number): { doors: DoorStates; destroyed: boolean } {
  const cur = doors[id]
  if (!cur) throw new Error(`board: unknown door ${id}`)
  const wounds = Math.min(maxWounds, cur.wounds + damage)
  const destroyed = wounds >= maxWounds
  return { doors: { ...doors, [id]: { ...cur, wounds, state: destroyed ? 'destroyed' : cur.state } }, destroyed }
}

/** Polygons that stop movement, line of sight and path measuring: every wall and every closed door. */
export function blockingPolygons(def: BoardDef, doors: DoorStates): Polygon[] {
  const out: Polygon[] = def.walls.map((w) => w.poly)
  for (const d of def.doors) {
    const rec = doors[d.id]
    if (!rec || isDoorBlocking(rec)) out.push(d.poly)
  }
  return out
}

export function doorById(def: BoardDef, id: string): BoardDef['doors'][number] | undefined {
  return def.doors.find((d) => d.id === id)
}

/** Doors whose rectangle a base overlaps ("in the doorway", R-15.6). */
export function doorsOverlapping(def: BoardDef, c: Vec2, r: number): string[] {
  return def.doors.filter((d) => circleOverlapsPolygon(c, r, d.poly)).map((d) => d.id)
}

/** Gap from the edge of a base to a door rectangle (0 when touching or overlapping). */
export function baseGapToDoor(def: BoardDef, doorId: string, c: Vec2, r: number): number {
  const d = doorById(def, doorId)
  if (!d) throw new Error(`board: unknown door ${doorId}`)
  if (pointInPolygon(c, d.poly)) return 0
  let best = Infinity
  for (let i = 0; i < d.poly.length; i++) best = Math.min(best, distPointSegment(c, d.poly[i]!, d.poly[(i + 1) % d.poly.length]!))
  return Math.max(0, best - r)
}

/** Door ids whose rectangle is within `within` of the edge of a base (Operate Door: 1"). */
export function doorsNear(def: BoardDef, c: Vec2, r: number, within: number): string[] {
  return def.doors.filter((d) => baseGapToDoor(def, d.id, c, r) <= within + EPS).map((d) => d.id)
}

// ---------------------------------------------------------------------------
// Space queries
// ---------------------------------------------------------------------------

/** Index of the tile square a point lies in (the lowest index on a seam), or -1 outside the board. */
export function tileIndexAt(def: BoardDef, p: Vec2): number {
  return def.tiles.findIndex((t) => Math.abs(p.x - t.centre.x) <= HALF_TILE + EPS && Math.abs(p.z - t.centre.z) <= HALF_TILE + EPS)
}

/** The centre of a base lies on the playable area (the union of the tile squares). */
export function insideOutline(def: BoardDef, p: Vec2): boolean {
  return tileIndexAt(def, p) >= 0
}

const outlineCache = new WeakMap<BoardDef, Segment2[]>()

/** The outline as straight runs (cached per compiled board). */
export function outlineOf(def: BoardDef): Segment2[] {
  let segs = outlineCache.get(def)
  if (!segs) {
    segs = outlineSegments(def.tiles.map((t) => t.centre))
    outlineCache.set(def, segs)
  }
  return segs
}

/** Distance from a point to the nearest board edge (the outline), the measure of "at least 6" from any board edge" (R-15.12). */
export function distToOutline(def: BoardDef, p: Vec2): number {
  return Math.min(...outlineOf(def).map((s) => distPointSegment(p, s.a, s.b)))
}

interface Boxed {
  poly: Polygon
  box: BBox
}

const boxed = (polys: Polygon[]): Boxed[] => polys.map((poly) => ({ poly, box: polygonBBox(poly) }))

function overlapsAny(list: Boxed[], c: Vec2, r: number): boolean {
  for (const b of list) {
    if (c.x + r < b.box.minX || c.x - r > b.box.maxX || c.z + r < b.box.minZ || c.z - r > b.box.maxZ) continue
    if (circleOverlapsPolygon(c, r, b.poly)) return true
  }
  return false
}

/**
 * A free-space test for bases of radius `r`: on the playable area, clear of walls, closed doors and obstacles (a base may not
 * end on an obstacle, R-7.11). Build once per door state, call many times.
 */
export function freeSpaceTest(def: BoardDef, doors: DoorStates, r: number): (c: Vec2) => boolean {
  const blockers = boxed([...blockingPolygons(def, doors), ...def.obstacles.map((o) => o.poly)])
  return (c) => insideOutline(def, c) && !overlapsAny(blockers, c, r)
}

/**
 * Cells (8-connected) a base of radius `r` can walk to from the start points, treating obstacles as crossable (they cost movement, they do
 * not block) and closed doors as walls. Returns a predicate on points (nearest grid cell).
 */
export function reachableFrom(def: BoardDef, doors: DoorStates, starts: readonly Vec2[], r = SMALL_BASE_RADIUS, step = 0.25): (p: Vec2) => boolean {
  const blockers = boxed(blockingPolygons(def, doors))
  const { minX, maxX, minZ, maxZ } = def.bounds
  const cols = Math.floor((maxX - minX) / step) + 1
  const rows = Math.floor((maxZ - minZ) / step) + 1
  const free = new Uint8Array(cols * rows)
  const at = (ix: number, iz: number): Vec2 => ({ x: minX + ix * step, z: minZ + iz * step })
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const c = at(ix, iz)
      if (insideOutline(def, c) && !overlapsAny(blockers, c, r)) free[iz * cols + ix] = 1
    }
  }
  const cell = (p: Vec2): [number, number] => [Math.round((p.x - minX) / step), Math.round((p.z - minZ) / step)]
  const seen = new Uint8Array(cols * rows)
  const queue: number[] = []
  for (const s of starts) {
    const [ix, iz] = cell(s)
    if (ix >= 0 && ix < cols && iz >= 0 && iz < rows && free[iz * cols + ix] && !seen[iz * cols + ix]) {
      seen[iz * cols + ix] = 1
      queue.push(iz * cols + ix)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!
    const ix = cur % cols
    const iz = (cur - ix) / cols
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = ix + dx
      const nz = iz + dz
      if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue
      const n = nz * cols + nx
      if (free[n] && !seen[n]) {
        seen[n] = 1
        queue.push(n)
      }
    }
  }
  return (p) => {
    const [ix, iz] = cell(p)
    return ix >= 0 && ix < cols && iz >= 0 && iz < rows && seen[iz * cols + ix] === 1
  }
}

// ---------------------------------------------------------------------------
// Deployment regions (00 7.1; 11 M-1.6, M-4.4)
// ---------------------------------------------------------------------------

export interface StandardRegions {
  kind: 'standard'
  /** the half on the low-z side (seat A's short edge by default) and the high-z half; each is a list of rectangles */
  low: Polygon[]
  high: Polygon[]
}
export interface TileRegions {
  kind: 'tile'
  /** per tile id (`t<i>`): the strips within `withinOfEdge` of that tile's outer board edge; absent for tiles with none */
  tiles: Record<string, Polygon[]>
}
export type DeploymentRegions = StandardRegions | TileRegions

function clipRect(rect: Polygon, minZ: number, maxZ: number): Polygon | null {
  const b = polygonBBox(rect)
  const lo = Math.max(b.minZ, minZ)
  const hi = Math.min(b.maxZ, maxZ)
  return hi - lo > EPS ? rectPoly(b.minX, lo, b.maxX, hi) : null
}

/**
 * Standard deployment: the part of each half of the board at least `minFromCentreline` from the dividing line across the
 * long (z) axis. On 24 x 36 with 12" that is z in [-18, -12] and [12, 18] (M-1.6).
 */
export function standardRegions(def: BoardDef, minFromCentreline: number): StandardRegions {
  const mid = (def.bounds.minZ + def.bounds.maxZ) / 2
  const low: Polygon[] = []
  const high: Polygon[] = []
  for (const t of def.tiles) {
    const a = clipRect(t.rect, -Infinity, mid - minFromCentreline)
    const b = clipRect(t.rect, mid + minFromCentreline, Infinity)
    if (a) low.push(a)
    if (b) high.push(b)
  }
  return { kind: 'standard', low, high }
}

/** Edges of tile `i` that lie on the board outline (the parts no flush neighbour covers), with the inward direction. */
function outerEdges(def: BoardDef, i: number): { axis: 'h' | 'v'; c: number; lo: number; hi: number; inward: 1 | -1 }[] {
  const me = def.tiles[i]!.centre
  const others = def.tiles.filter((_, j) => j !== i).map((t) => t.centre)
  const out: { axis: 'h' | 'v'; c: number; lo: number; hi: number; inward: 1 | -1 }[] = []
  // dir: which neighbour slot the side faces (-1 low coordinate, +1 high coordinate)
  const sides: { axis: 'h' | 'v'; dir: -1 | 1 }[] = [
    { axis: 'h', dir: -1 }, { axis: 'h', dir: 1 }, { axis: 'v', dir: -1 }, { axis: 'v', dir: 1 },
  ]
  for (const { axis, dir } of sides) {
    const across = axis === 'h' ? me.z : me.x // coordinate that changes between neighbours
    const along = axis === 'h' ? me.x : me.z
    const c = across + dir * HALF_TILE
    const covered: [number, number][] = []
    for (const o of others) {
      const oAcross = axis === 'h' ? o.z : o.x
      const oAlong = axis === 'h' ? o.x : o.z
      if (Math.abs(oAcross - (across + dir * TILE_SIZE)) < EPS && Math.abs(oAlong - along) < TILE_SIZE - EPS) covered.push([oAlong - HALF_TILE, oAlong + HALF_TILE])
    }
    const lo0 = along - HALF_TILE
    const hi0 = along + HALF_TILE
    const marks = [...new Set([lo0, hi0, ...covered.flat().filter((v) => v > lo0 + EPS && v < hi0 - EPS)])].sort((p, q) => p - q)
    for (let k = 0; k + 1 < marks.length; k++) {
      const lo = marks[k]!
      const hi = marks[k + 1]!
      const mid = (lo + hi) / 2
      if (!covered.some(([cl, ch]) => cl < mid && ch > mid)) out.push({ axis, c, lo, hi, inward: dir === -1 ? 1 : -1 })
    }
  }
  return out
}

/** Tile deployment: the strips of tile `tileIndex` within `withinOfEdge` of its outer board edge(s); empty for an inner tile. */
export function tileStrips(def: BoardDef, tileIndex: number, withinOfEdge: number): Polygon[] {
  const out: Polygon[] = []
  for (const e of outerEdges(def, tileIndex)) {
    const d = e.c + e.inward * withinOfEdge
    const [c0, c1] = e.inward === 1 ? [e.c, d] : [d, e.c]
    out.push(e.axis === 'h' ? rectPoly(e.lo, c0, e.hi, c1) : rectPoly(c0, e.lo, c1, e.hi))
  }
  return out
}

export function deploymentRegions(def: BoardDef, deployment: { kind: 'standard' | 'tile'; minFromCentreline?: number; withinOfEdge?: number }): DeploymentRegions {
  if (deployment.kind === 'standard') return standardRegions(def, deployment.minFromCentreline ?? 12)
  const tiles: Record<string, Polygon[]> = {}
  def.tiles.forEach((t, i) => {
    const strips = tileStrips(def, i, deployment.withinOfEdge ?? 3)
    if (strips.length > 0) tiles[t.id] = strips
  })
  return { kind: 'tile', tiles }
}

/** The whole base (centre and eight rim points) lies inside the union of the region rectangles. */
export function baseInRegion(region: readonly Polygon[], c: Vec2, r: number): boolean {
  const pts: Vec2[] = [c]
  for (let k = 0; k < 8; k++) pts.push({ x: c.x + r * Math.cos((k * Math.PI) / 4), z: c.z + r * Math.sin((k * Math.PI) / 4) })
  return pts.every((p) => region.some((poly) => pointInPolygon(p, poly)))
}

/**
 * Greedy count of bases of radius `r` that fit a region at once (on a 1/4" grid, bases 1/10" apart, never on a wall, a closed
 * door or an obstacle). Stops at `need`. Returns the positions it found.
 */
export function fitBases(def: BoardDef, doors: DoorStates, region: readonly Polygon[], r: number, need: number): Vec2[] {
  const free = freeSpaceTest(def, doors, r)
  const found: Vec2[] = []
  const step = 0.25
  const boxes = region.map(polygonBBox)
  const minX = Math.min(...boxes.map((b) => b.minX))
  const maxX = Math.max(...boxes.map((b) => b.maxX))
  const minZ = Math.min(...boxes.map((b) => b.minZ))
  const maxZ = Math.max(...boxes.map((b) => b.maxZ))
  for (let z = minZ; z <= maxZ + EPS && found.length < need; z += step) {
    for (let x = minX; x <= maxX + EPS && found.length < need; x += step) {
      const c = { x, z }
      if (!baseInRegion(region, c, r) || !free(c)) continue
      if (found.some((f) => Math.hypot(f.x - c.x, f.z - c.z) < 2 * r + 0.1)) continue
      found.push(c)
    }
  }
  return found
}
