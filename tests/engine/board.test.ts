import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import type { BoardData, TileData, Vec2 } from '../../src/data/types'
import {
  adjacencyProblems,
  baseGapToDoor,
  blockingPolygons,
  compileBoard,
  damageDoor,
  deploymentRegions,
  distToOutline,
  doorSignature,
  doorsNear,
  doorsOverlapping,
  fitBases,
  freeSpaceTest,
  initialDoors,
  insideOutline,
  isDoorBlocking,
  LAYOUT_TILES,
  outlineSegments,
  placePoint,
  reachableFrom,
  rotatePoint,
  rotateYaw,
  SMALL_BASE_RADIUS,
  standardRegions,
  tileIndexAt,
  tileStrips,
  unplacePoint,
  withDoor,
  type Rot,
} from '../../src/engine/board'
import { pointInPolygon, polygonBBox } from '../../src/engine/geometry'

const bundle = loadBundle()
const ROTS: Rot[] = [0, 90, 180, 270]

/** A tile with nothing in it; tests add what they need. */
function tile(id: string, part: Partial<TileData> = {}): TileData {
  return { id, name: id, walls: [], doors: [], terminals: [], ducts: [], obstacles: [], casketSpots: [], floor: { style: 'plate', props: [] }, source: 'test', ...part }
}
const wall = (id: string, a: Vec2, b: Vec2, thickness = 0.5) => ({ id, a, b, thickness })
const v = (x: number, z: number): Vec2 => ({ x, z })

/** A 2x3 board of the given tile in every slot. */
function boardOf(tileIds: string[] | string, rots: Rot[] | Rot = 0, extra: Partial<BoardData['extra']> = {}): BoardData {
  const slots = LAYOUT_TILES['2x3']
  return {
    id: 'zm.b.test',
    name: 'test',
    layout: '2x3',
    tiles: slots.map((at, i) => ({ tile: Array.isArray(tileIds) ? tileIds[i]! : tileIds, at, rot: Array.isArray(rots) ? rots[i]! : rots })),
    extra: { walls: [], doors: [], terminals: [], ducts: [], obstacles: [], caskets: [], ...extra },
    scenarios: [],
    source: 'test',
  }
}
const byId = (...tiles: TileData[]) => Object.fromEntries(tiles.map((t) => [t.id, t]))

describe('board compiler: layout (ZM-001)', () => {
  it('ZM-001 rejects a tile that shares less than half an edge with every other tile', () => {
    const six = LAYOUT_TILES['2x3'].map((p) => ({ ...p }))
    expect(adjacencyProblems(six)).toEqual([])
    expect(adjacencyProblems(LAYOUT_TILES.brick7)).toEqual([])

    // touching at a corner only
    expect(adjacencyProblems([v(0, 0), v(12, 12)]).join(' ')).toMatch(/tile 0 .* shares 0"/)
    // 5" of shared edge is not half
    const five = adjacencyProblems([v(0, 0), v(12, 7)])
    expect(five).toHaveLength(2)
    expect(five[0]).toMatch(/shares 5"/)
    // exactly half (the brick offset) is allowed
    expect(adjacencyProblems([v(0, 0), v(6, 12)])).toEqual([])
    // overlapping squares
    expect(adjacencyProblems([v(0, 0), v(6, 6)]).join(' ')).toMatch(/overlap/)
  })

  it('ZM-001 compileBoard throws for a stray tile, a wrong slot, or the wrong tile count', () => {
    const t = tile('zm.t.empty')
    const ok = boardOf('zm.t.empty')
    expect(() => compileBoard(ok, byId(t))).not.toThrow()
    const stray: BoardData = { ...ok, tiles: ok.tiles.map((p, i) => (i === 5 ? { ...p, at: v(18, 24) } : p)) }
    expect(() => compileBoard(stray, byId(t))).toThrow(/shares 0"/)
    expect(() => compileBoard({ ...ok, tiles: ok.tiles.slice(0, 5) }, byId(t))).toThrow(/needs a tile at/)
    expect(() => compileBoard({ ...ok, layout: 'brick7' }, byId(t))).toThrow(/layout brick7/)
    expect(() => compileBoard(boardOf('zm.t.nope'), byId(t))).toThrow(/unknown tile/)
  })
})

describe('board compiler: geometry', () => {
  it('BOARD-001 rotation is a clockwise quarter turn about the tile centre and round-trips', () => {
    expect(rotatePoint(v(1, 2), 0)).toEqual(v(1, 2))
    expect(rotatePoint(v(1, 2), 90)).toEqual(v(-2, 1)) // +z (north) goes to -x (west)
    expect(rotatePoint(v(0, 6), 90)).toEqual(v(-6, 0))
    expect(rotatePoint(v(1, 2), 180)).toEqual(v(-1, -2))
    expect(rotatePoint(v(1, 2), 270)).toEqual(v(2, -1))
    for (const rot of ROTS) {
      for (const p of [v(0, 0), v(-6, 6), v(3.25, -1.5), v(5, 5)]) {
        const centre = v(-12, 6)
        const there = placePoint(p, centre, rot)
        expect(unplacePoint(there, centre, rot)).toEqual(p)
        // four quarter turns come home
        let q = p
        for (let k = 0; k < 4; k++) q = rotatePoint(q, 90)
        expect(q).toEqual(p)
      }
    }
    // never -0
    expect(Object.is(rotatePoint(v(0, 0), 90).x, 0)).toBe(true)
    expect(Object.is(rotatePoint(v(0, 0), 180).z, 0)).toBe(true)
  })

  it('BOARD-001 a facing follows the same turn', () => {
    expect(rotateYaw(0, 90)).toBeCloseTo(-Math.PI / 2, 2) // +z front -> -x
    expect(Math.abs(rotateYaw(0, 180))).toBeCloseTo(Math.PI, 2)
    expect(rotateYaw(Math.PI / 2, 90)).toBeCloseTo(0, 2) // +x front -> +z
    for (const yaw of [0.3, 1.2, -2]) expect(Math.cos(rotateYaw(rotateYaw(yaw, 90), 270) - yaw)).toBeCloseTo(1, 3)
  })

  it('BOARD-001 every shipped tile survives compilation at every rotation with its local geometry intact', () => {
    for (const t of Object.values(bundle.tiles)) {
      for (const rot of ROTS) {
        const def = compileBoard(boardOf(t.id, rot), bundle.tiles)
        const at = def.tiles[0]!.centre
        expect(def.tiles[0]).toMatchObject({ tileId: t.id, rot, floor: t.floor.style })
        const local = (p: Vec2) => unplacePoint(p, at, rot)
        for (const d of t.doors) {
          const got = def.doors.find((x) => x.id === `t0.${d.id}`)!
          expect([local(got.seg.a), local(got.seg.b)]).toEqual([d.a, d.b])
          expect(got.lockedAtStart).toBe(d.locked)
          expect(got.terminals.map((m) => ({ id: m.id, pos: local(m.pos) }))).toEqual(t.terminals.filter((m) => m.door === d.id).map((m) => ({ id: m.id, pos: m.pos })))
        }
        for (const u of t.ducts) {
          const got = def.ducts.find((x) => x.id === `t0.${u.id}`)!
          expect([local(got.a), local(got.b)]).toEqual([u.a, u.b])
        }
        for (const o of t.obstacles) {
          const got = def.obstacles.find((x) => x.id === `t0.${o.id}`)!
          expect(got.kind).toBe(o.kind)
          expect(got.poly.map(local)).toEqual(o.footprint)
        }
        expect(def.casketSpots.slice(0, t.casketSpots.length).map(local)).toEqual(t.casketSpots)
        expect(def.props.slice(0, t.floor.props.length).map((p) => local(p.pos))).toEqual(t.floor.props.map((p) => p.pos))
      }
    }
  })

  it('BOARD-002 an empty 2x3 board is 24 x 36 inside a closed outline of four walls', () => {
    const def = compileBoard(boardOf('zm.t.empty'), byId(tile('zm.t.empty')))
    expect(def.layout).toBe('2x3')
    expect(def.bounds).toEqual({ minX: -12, maxX: 12, minZ: -18, maxZ: 18 })
    expect(def.tiles).toHaveLength(6)
    expect(def.outline).toHaveLength(6)
    expect(def.walls).toHaveLength(4)
    expect(outlineSegments(LAYOUT_TILES['2x3'])).toHaveLength(4)
    // walls are 0.5" thick, centred on the boundary, corners filled by the extension
    const boxes = def.walls.map((w) => polygonBBox(w.poly))
    expect(Math.min(...boxes.map((b) => b.minX))).toBeCloseTo(-12.25, 6)
    expect(Math.max(...boxes.map((b) => b.maxZ))).toBeCloseTo(18.25, 6)
    expect(pointInPolygon(v(-12, -18), def.walls.find((w) => w.id === 'o0')!.poly) || def.walls.some((w) => pointInPolygon(v(-12, -18), w.poly))).toBe(true)
    // inside / outside
    expect(insideOutline(def, v(0, 0))).toBe(true)
    expect(insideOutline(def, v(12, 18))).toBe(true)
    expect(insideOutline(def, v(12.5, 0))).toBe(false)
    expect(tileIndexAt(def, v(-3, -17))).toBe(0)
    expect(tileIndexAt(def, v(3, 17))).toBe(5)
    expect(distToOutline(def, v(0, 0))).toBe(12)
    expect(distToOutline(def, v(-6, -12))).toBe(6)
  })

  it('BOARD-002 the brick7 outline is the twelve sides of a plus, 36 x 36 overall', () => {
    const slots = LAYOUT_TILES.brick7
    expect(outlineSegments(slots)).toHaveLength(12)
    const brick: BoardData = { ...boardOf('zm.t.empty'), layout: 'brick7', tiles: slots.map((at) => ({ tile: 'zm.t.empty', at, rot: 0 })) }
    const def = compileBoard(brick, byId(tile('zm.t.empty')))
    expect(def.bounds).toEqual({ minX: -18, maxX: 18, minZ: -18, maxZ: 18 })
    expect(def.walls).toHaveLength(12)
    expect(insideOutline(def, v(-17, 0))).toBe(true)
    expect(insideOutline(def, v(-17, 10))).toBe(false) // the notch beside the top pair
    expect(distToOutline(def, v(-11, 5))).toBeCloseTo(Math.SQRT2, 6) // to the notch corner at (-12, 6)
  })

  it('BOARD-003 wall ends extend into what they join but stay flat at a door gap', () => {
    // an L of two walls and a wall with a door in it
    const t = tile('zm.t.walls', {
      walls: [wall('a', v(-3, 0), v(0, 0)), wall('b', v(0, 0), v(0, 3)), wall('c', v(2, -4), v(2, -2)), wall('d', v(2, -2 + 1.5), v(2, 2))],
      doors: [{ id: 'd1', a: v(2, -2), b: v(2, -0.5), locked: false }],
    })
    // door 1.5" wide between wall c (ends at -2) and a wall d that starts at -0.5 (written as -2 + 1.5)
    const def = compileBoard(boardOf('zm.t.walls'), byId(t))
    const at = def.tiles[0]!.centre // (-6, -12)
    const get = (id: string) => def.walls.find((w) => w.id === `t0.${id}`)!
    const box = (id: string) => polygonBBox(get(id).poly)
    // the L corner is filled: wall a ends 0.25" past the joint, wall b starts 0.25" before it
    expect(box('a').maxX).toBeCloseTo(at.x + 0.25, 6)
    expect(box('a').minX).toBeCloseTo(at.x - 3, 6) // free end stays put
    expect(box('b').minZ).toBeCloseTo(at.z - 0.25, 6)
    // the walls beside the door gap end flat on the door ends
    expect(box('c').maxZ).toBeCloseTo(at.z - 2, 6)
    expect(box('d').minZ).toBeCloseTo(at.z - 0.5, 6)
    const door = def.doors[0]!
    expect(polygonBBox(door.poly)).toMatchObject({ minZ: at.z - 2, maxZ: at.z - 0.5 })
    expect(polygonBBox(door.poly).minX).toBeCloseTo(at.x + 2 - 0.25, 6)
  })

  it('BOARD-003 walls written on both sides of a shared tile edge merge into one; a gap in both stays open', () => {
    // west tile writes the seam wall with a 4" mouth, east tile writes the whole seam wall
    const west = tile('zm.t.west', { walls: [wall('s1', v(6, -6), v(6, -2)), wall('s2', v(6, 2), v(6, 6))] })
    const east = tile('zm.t.east', { walls: [wall('s', v(-6, -6), v(-6, 6))] })
    const mouthy = tile('zm.t.mouthy', { walls: [wall('s1', v(-6, -6), v(-6, -2)), wall('s2', v(-6, 2), v(-6, 6))] })
    const ids = ['zm.t.west', 'zm.t.east', 'zm.t.west', 'zm.t.east', 'zm.t.west', 'zm.t.east']
    const sealed = compileBoard(boardOf(ids), byId(west, east))
    const seamWalls = (def: ReturnType<typeof compileBoard>) => def.walls.filter((w) => Math.abs(w.seg.a.x) < 1e-9 && Math.abs(w.seg.b.x) < 1e-9)
    // one 36" wall along x = 0 (the three seam runs touch end to end and merge)
    expect(seamWalls(sealed)).toHaveLength(1)
    expect(seamWalls(sealed)[0]!.seg).toEqual({ a: v(0, -18), b: v(0, 18) })
    const open = compileBoard(boardOf(['zm.t.west', 'zm.t.mouthy', 'zm.t.west', 'zm.t.mouthy', 'zm.t.west', 'zm.t.mouthy']), byId(west, mouthy))
    // three mouths: three pieces between them plus the two ends = the seam has 4 runs; a base fits through each mouth
    expect(seamWalls(open).length).toBe(4)
    const free = freeSpaceTest(open, initialDoors(open), SMALL_BASE_RADIUS)
    for (const z of [-12, 0, 12]) expect(free(v(0, z))).toBe(true)
    expect(free(v(0, -8))).toBe(false)
    // the walls survive even though two tiles wrote them: no duplicate overlapping walls
    const sealedBoxes = seamWalls(sealed).map((w) => w.poly)
    expect(sealedBoxes).toHaveLength(1)
  })

  it('BOARD-004 obstacles are counter-clockwise polygons carrying their kind; props rotate with the tile', () => {
    const t = tile('zm.t.obs', {
      obstacles: [{ id: 'b1', kind: 'barricade', footprint: [v(-1, -0.5), v(-1, 0.5), v(1, 0.5), v(1, -0.5)] }], // clockwise on purpose
      floor: { style: 'grate', props: [{ model: 'pipes', pos: v(2, 1), yaw: 0 }] },
    })
    const def = compileBoard(boardOf('zm.t.obs', 90), byId(t))
    const o = def.obstacles[0]!
    expect(o.kind).toBe('barricade')
    let area = 0
    for (let i = 0; i < o.poly.length; i++) {
      const a = o.poly[i]!
      const b = o.poly[(i + 1) % o.poly.length]!
      area += a.x * b.z - b.x * a.z
    }
    expect(area / 2).toBeCloseTo(2, 6)
    expect(def.props[0]).toMatchObject({ model: 'pipes', pos: placePoint(v(2, 1), v(-6, -12), 90) })
    expect(def.props[0]!.yaw).toBeCloseTo(-Math.PI / 2, 2)
  })
})

describe('board compiler: shipped boards (ZM-012)', () => {
  const boards = Object.values(bundle.boards)

  it('ships three 2x3 boards and two brick7 boards', () => {
    expect(boards.filter((b) => b.layout === '2x3')).toHaveLength(3)
    expect(boards.filter((b) => b.layout === 'brick7')).toHaveLength(2)
  })

  for (const b of boards) {
    it(`ZM-012 ${b.id} has at least 3 doors, 2 ductways, D6-worth of barricades and 2 casket spots 6"+ from every board edge`, () => {
      const def = compileBoard(b, bundle.tiles)
      expect(def.doors.length).toBeGreaterThanOrEqual(3)
      expect(def.ducts.length).toBeGreaterThanOrEqual(2)
      expect(def.obstacles.filter((o) => o.kind === 'barricade').length).toBeGreaterThanOrEqual(3)
      const far = def.casketSpots.filter((s) => distToOutline(def, s) >= 6 - 1e-6)
      expect(far.length).toBeGreaterThanOrEqual(2)
      // every duct goes through exactly one wall and is short
      for (const u of def.ducts) expect(Math.hypot(u.a.x - u.b.x, u.a.z - u.b.z)).toBeLessThanOrEqual(2)
      // doors start closed and the ones with terminals are the locked ones
      const doors = initialDoors(def)
      for (const d of def.doors) {
        expect(doors[d.id]).toEqual({ state: 'closed', locked: d.lockedAtStart, wounds: 0 })
        expect(d.terminals.length).toBe(d.lockedAtStart ? 2 : 0)
      }
    })
  }

  it('ZM-012 every compiled board is closed: nothing but a base on the floor lies outside the outline', () => {
    for (const b of boards) {
      const def = compileBoard(b, bundle.tiles)
      const free = freeSpaceTest(def, initialDoors(def), SMALL_BASE_RADIUS)
      // sample a ring just outside the outline: never free
      for (let x = def.bounds.minX - 1; x <= def.bounds.maxX + 1; x += 1) {
        expect(free(v(x, def.bounds.minZ - 0.6))).toBe(false)
        expect(free(v(x, def.bounds.maxZ + 0.6))).toBe(false)
      }
    }
  })
})

describe('board compiler: door state', () => {
  const door = (extra: Partial<TileData> = {}) =>
    tile('zm.t.gate', {
      walls: [wall('w1', v(-6, 0), v(-2, 0)), wall('w2', v(2, 0), v(6, 0))],
      doors: [{ id: 'g', a: v(-2, 0), b: v(2, 0), locked: true }],
      terminals: [{ id: 't1', door: 'g', pos: v(0, 0.8) }, { id: 't2', door: 'g', pos: v(0, -0.8) }],
      ...extra,
    })

  it('BOARD-005 every door starts closed and blocks like a wall; open and destroyed doors are gaps', () => {
    // a gate in the middle of every tile: the whole board is cut in two along z = tile centre by the door and walls
    const def = compileBoard(boardOf('zm.t.gate'), byId(door()))
    expect(def.doors).toHaveLength(6)
    const doors = initialDoors(def)
    expect(Object.values(doors).every((d) => d.state === 'closed' && d.locked && d.wounds === 0)).toBe(true)
    expect(blockingPolygons(def, doors)).toHaveLength(def.walls.length + 6)
    const opened = withDoor(doors, 't0.g', { state: 'open' })
    expect(blockingPolygons(def, opened)).toHaveLength(def.walls.length + 5)
    expect(isDoorBlocking(opened['t0.g']!)).toBe(false)
    expect(doors['t0.g']!.state).toBe('closed') // withDoor is pure
    expect(doorSignature(def, doors)).toBe('111111')
    expect(doorSignature(def, opened)).toBe('011111')
    expect(() => withDoor(doors, 'nope', { state: 'open' })).toThrow(/unknown door/)
  })

  it('BOARD-005 a door has 4 wounds in the constants; damage destroys it for good', () => {
    const def = compileBoard(boardOf('zm.t.gate'), byId(door()))
    let doors = initialDoors(def)
    const max = bundle.constants.door.wounds
    expect(max).toBe(4)
    let r = damageDoor(doors, 't0.g', 3, max)
    expect(r.destroyed).toBe(false)
    expect(r.doors['t0.g']).toMatchObject({ wounds: 3, state: 'closed' })
    r = damageDoor(r.doors, 't0.g', 3, max)
    expect(r.destroyed).toBe(true)
    expect(r.doors['t0.g']).toMatchObject({ wounds: 4, state: 'destroyed' })
    expect(isDoorBlocking(r.doors['t0.g']!)).toBe(false)
    doors = r.doors
    expect(blockingPolygons(def, doors)).toHaveLength(def.walls.length + 5)
  })

  it('BOARD-005 doorway and distance queries: a base overlapping the door rectangle is in the doorway', () => {
    const def = compileBoard(boardOf('zm.t.gate'), byId(door()))
    const d = def.doors[0]!
    const centre = { x: (d.seg.a.x + d.seg.b.x) / 2, z: (d.seg.a.z + d.seg.b.z) / 2 }
    expect(doorsOverlapping(def, centre, 0.5)).toEqual(['t0.g'])
    expect(doorsOverlapping(def, { x: centre.x, z: centre.z + 1 }, 0.5)).toEqual([])
    expect(baseGapToDoor(def, 't0.g', { x: centre.x, z: centre.z + 1.25 }, 0.5)).toBeCloseTo(0.5, 6)
    expect(doorsNear(def, { x: centre.x, z: centre.z + 1.25 }, 0.5, 1)).toEqual(['t0.g'])
    expect(doorsNear(def, { x: centre.x, z: centre.z + 3 }, 0.5, 1)).toEqual([])
    expect(baseGapToDoor(def, 't0.g', centre, 0.5)).toBe(0)
  })

  it('BOARD-006 reachability: a closed door cuts the board, an open one joins it', () => {
    // a full-width wall across every tile with a door in it; the first and last rows are therefore three separate rooms,
    // each joined to the next only through its door
    const t = tile('zm.t.divide', { walls: [wall('w1', v(-6, 0), v(-2, 0)), wall('w2', v(2, 0), v(6, 0))], doors: [{ id: 'g', a: v(-2, 0), b: v(2, 0), locked: false }] })
    const def = compileBoard(boardOf('zm.t.divide'), byId(t))
    const above = { x: -6, z: -17 } // south of every wall in the first row
    const below = { x: -6, z: -9 }
    const closed = initialDoors(def)
    const reachClosed = reachableFrom(def, closed, [above])
    expect(reachClosed(above)).toBe(true)
    expect(reachClosed(below)).toBe(false)
    const open = withDoor(closed, 't0.g', { state: 'open' })
    expect(reachableFrom(def, open, [above])(below)).toBe(true)
    // a base can take the 4" gap but not the 0.5" wall
    expect(freeSpaceTest(def, closed, SMALL_BASE_RADIUS)(v(-6, -12))).toBe(false) // on the closed door
    expect(freeSpaceTest(def, open, SMALL_BASE_RADIUS)(v(-6, -12))).toBe(true)
  })
})

describe('board compiler: deployment regions', () => {
  const empty = compileBoard(boardOf('zm.t.empty'), byId(tile('zm.t.empty')))
  const brickDef = compileBoard(
    { ...boardOf('zm.t.empty'), layout: 'brick7', tiles: LAYOUT_TILES.brick7.map((at) => ({ tile: 'zm.t.empty', at, rot: 0 as Rot })) },
    byId(tile('zm.t.empty')),
  )

  it('BOARD-007 standard deployment is the strip at least 12" from the dividing line: 24 x 6 at each short edge', () => {
    const r = standardRegions(empty, 12)
    const box = (ps: Vec2[][]) => {
      const bs = ps.map(polygonBBox)
      return { minX: Math.min(...bs.map((b) => b.minX)), maxX: Math.max(...bs.map((b) => b.maxX)), minZ: Math.min(...bs.map((b) => b.minZ)), maxZ: Math.max(...bs.map((b) => b.maxZ)) }
    }
    expect(box(r.low)).toEqual({ minX: -12, maxX: 12, minZ: -18, maxZ: -12 })
    expect(box(r.high)).toEqual({ minX: -12, maxX: 12, minZ: 12, maxZ: 18 })
    const viaDispatch = deploymentRegions(empty, { kind: 'standard', minFromCentreline: 12 })
    expect(viaDispatch).toEqual(r)
    // 20" from the line leaves nothing on a board 18" either side
    expect(standardRegions(empty, 20)).toMatchObject({ low: [], high: [] })
  })

  it('BOARD-007 tile deployment is the 3" band along the outer edges of a tile; inner tiles have none', () => {
    const centre = brickDef.tiles.findIndex((t) => t.centre.x === 0 && t.centre.z === 0)
    expect(tileStrips(brickDef, centre, 3)).toEqual([])
    const regions = deploymentRegions(brickDef, { kind: 'tile', withinOfEdge: 3 })
    expect(regions.kind).toBe('tile')
    if (regions.kind !== 'tile') return
    expect(Object.keys(regions.tiles)).toHaveLength(6)
    expect(regions.tiles[brickDef.tiles[centre]!.id]).toBeUndefined()
    const topLeft = brickDef.tiles.findIndex((t) => t.centre.x === -6 && t.centre.z === 12)
    const left = brickDef.tiles.findIndex((t) => t.centre.x === -12 && t.centre.z === 0)
    // a corner tile touches the outline on two sides, the end tile on three
    expect(tileStrips(brickDef, topLeft, 3)).toHaveLength(2)
    expect(tileStrips(brickDef, left, 3)).toHaveLength(3)
    // the bands are 3" deep and sit on the outline
    const strips = tileStrips(brickDef, topLeft, 3).map(polygonBBox)
    expect(strips).toContainEqual({ minX: -12, maxX: 0, minZ: 15, maxZ: 18 })
    expect(strips).toContainEqual({ minX: -12, maxX: -9, minZ: 6, maxZ: 18 })
    // the end tile's top band covers only the part of its edge no other tile covers
    const leftStrips = tileStrips(brickDef, left, 3).map(polygonBBox)
    expect(leftStrips).toContainEqual({ minX: -18, maxX: -12, minZ: 3, maxZ: 6 })
  })

  it('BOARD-007 a full crew of ten 25 mm bases fits a standard strip; a 2" box takes at most two', () => {
    const r = standardRegions(empty, 12)
    const fit = fitBases(empty, initialDoors(empty), r.low, SMALL_BASE_RADIUS, 10)
    expect(fit).toHaveLength(10)
    for (const p of fit) expect(p.z).toBeLessThan(-12)
    for (let i = 0; i < fit.length; i++) for (let j = i + 1; j < fit.length; j++) expect(Math.hypot(fit[i]!.x - fit[j]!.x, fit[i]!.z - fit[j]!.z)).toBeGreaterThanOrEqual(2 * SMALL_BASE_RADIUS)
    const box = [[v(0, -17), v(2, -17), v(2, -15), v(0, -15)]]
    expect(fitBases(empty, initialDoors(empty), box, SMALL_BASE_RADIUS, 10).length).toBeLessThanOrEqual(2)
  })
})

describe('board compiler: shipped scenario regions', () => {
  it('BOARD-008 each shipped board fits a full crew in every region of the scenarios it lists', () => {
    for (const b of Object.values(bundle.boards)) {
      const def = compileBoard(b, bundle.tiles)
      for (const sid of b.scenarios) {
        const s = bundle.scenarios[sid]!
        const regions = deploymentRegions(def, s.deployment)
        const groups = regions.kind === 'standard' ? [regions.low, regions.high] : Object.values(regions.tiles)
        expect(groups.length, `${b.id} ${sid}`).toBeGreaterThanOrEqual(2)
        for (const g of groups) expect(fitBases(def, initialDoors(def), g, SMALL_BASE_RADIUS, 10), `${b.id} ${sid}`).toHaveLength(10)
      }
    }
  })
})
