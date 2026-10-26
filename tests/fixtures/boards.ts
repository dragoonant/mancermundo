// Hand-built boards for rules tests (24" x 36", the same tile layout as the real 2x3 boards). They are `BoardDef`s, not data
// boards, so a test states its geometry in a few lines: an open box, a wall across the middle with a door, a barricade, a
// ductway through a wall. Walls get their rectangles from the same `segmentRect` the board compiler uses.
import type { EngineBundle } from '@/engine/bundle'
import { outlineSegments, segmentRect, tileSquare } from '@/engine/board'
import type { BoardDef, Polygon, Vec2 } from '@/engine/types'
import { testBundle, TEST_BOARD, TEST_SCENARIO } from './gang'

export interface BoardSpec {
  id?: string
  /** interior walls; thickness defaults to 0.5 */
  walls?: { a: Vec2; b: Vec2; t?: number }[]
  doors?: { id: string; a: Vec2; b: Vec2; locked?: boolean; terminals?: { id: string; pos: Vec2 }[] }[]
  ducts?: { id: string; a: Vec2; b: Vec2 }[]
  /** axis-aligned rectangles [minX, minZ, maxX, maxZ] */
  obstacles?: { id: string; kind: string; rect: [number, number, number, number] }[]
  casketSpots?: Vec2[]
}

const CENTRES: Vec2[] = [-12, 0, 12].flatMap((z) => [-6, 6].map((x) => ({ x, z })))

export function rect(minX: number, minZ: number, maxX: number, maxZ: number): Polygon {
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]
}

/** A 2x3 board with outline walls plus whatever the spec adds. */
export function makeBoard(spec: BoardSpec = {}): BoardDef {
  const walls: BoardDef['walls'] = []
  outlineSegments(CENTRES).forEach((s, k) => walls.push({ id: `o${k}`, seg: s, thickness: 0.5, poly: segmentRect(s.a, s.b, 0.5, 0.25, 0.25) }))
  ;(spec.walls ?? []).forEach((w, k) => walls.push({ id: `w${k}`, seg: { a: w.a, b: w.b }, thickness: w.t ?? 0.5, poly: segmentRect(w.a, w.b, w.t ?? 0.5) }))
  return {
    id: spec.id ?? TEST_BOARD,
    layout: '2x3',
    bounds: { minX: -12, maxX: 12, minZ: -18, maxZ: 18 },
    tiles: CENTRES.map((c, i) => ({ id: `t${i}`, tileId: 'test.tile', centre: c, rot: 0 as const, rect: tileSquare(c), floor: 'plate' })),
    outline: CENTRES.map(tileSquare),
    walls,
    doors: (spec.doors ?? []).map((d) => ({
      id: d.id,
      seg: { a: d.a, b: d.b },
      poly: segmentRect(d.a, d.b, 0.5),
      lockedAtStart: d.locked ?? false,
      terminals: d.terminals ?? [],
    })),
    ducts: spec.ducts ?? [],
    obstacles: (spec.obstacles ?? []).map((o) => ({ id: o.id, kind: o.kind, poly: rect(...o.rect) })),
    casketSpots: spec.casketSpots ?? [],
    props: [],
  }
}

/** Outline walls only. */
export const openBox = (): BoardDef => makeBoard()

/** A wall across the middle (z = 0) with a 2" door at x in [-1, 1]; `locked` adds a terminal on each side. */
export function corridorWithDoor(opts: { locked?: boolean } = {}): BoardDef {
  return makeBoard({
    id: 'test.door',
    walls: [
      { a: { x: -12, z: 0 }, b: { x: -1, z: 0 } },
      { a: { x: 1, z: 0 }, b: { x: 12, z: 0 } },
    ],
    doors: [
      {
        id: 'door1',
        a: { x: -1, z: 0 },
        b: { x: 1, z: 0 },
        locked: opts.locked ?? false,
        terminals: opts.locked
          ? [
              { id: 'term-s', pos: { x: -1.6, z: -0.6 } },
              { id: 'term-n', pos: { x: 1.6, z: 0.6 } },
            ]
          : [],
      },
    ],
  })
}

/** Two barricades, one at the origin (x in [-1.5, 1.5], z in [-0.25, 0.25]) and a crate stack to the side. */
export const barricadePair = (): BoardDef =>
  makeBoard({
    id: 'test.barricade',
    obstacles: [
      { id: 'bar1', kind: 'barricade', rect: [-1.5, -0.25, 1.5, 0.25] },
      { id: 'crate1', kind: 'crates', rect: [5, 5, 6, 6] },
    ],
  })

/** A solid wall across the middle with a 0.6" ductway through it at x = 0. */
export const ductwayWall = (): BoardDef =>
  makeBoard({
    id: 'test.duct',
    walls: [{ a: { x: -12, z: 0 }, b: { x: 12, z: 0 } }],
    ducts: [{ id: 'duct1', a: { x: 0, z: -0.3 }, b: { x: 0, z: 0.3 } }],
  })

/** The test bundle with extra boards registered (the test scenario accepts any 2x3 board). */
export function bundleWith(...boards: BoardDef[]): EngineBundle {
  return { ...testBundle, boards: { ...testBundle.boards, ...Object.fromEntries(boards.map((b) => [b.id, b])) } }
}

export { TEST_SCENARIO }
