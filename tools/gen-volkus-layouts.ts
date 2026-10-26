// npx tsx tools/gen-volkus-layouts.ts
// Writes src/data/killzones/volkus-ao25-1.json .. -6.json: the six tournament layouts of the Approved Ops 2025
// card pack (Killzone: Volkus, Maps 1-6), measured from the card images (24 px per inch, +-0.25 in).
//
// Pieces are one local-coordinate template per kit piece (letters A-N on the cards' key) plus, per map, a placement
// list: kit letter, top-left corner (u, v) of the placed piece's drawn extent in inches from the card's top-left
// corner, and `cw` quarter turns clockwise from the template's drawing. Strongholds carry their debris slabs
// and crates (L, M, N) as children that turn with them.
//
// Maps 1-3 (6 in drop zones on the short edges) use mission map prelim-1: x = u - 15, z = v - 11.
// Maps 4-6 (3 in drop zones on the long edges) use mission map prelim-2, a half turn: x = 15 - u, z = 11 - v.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type P = [number, number]
interface PartSpec {
  id: string
  poly: P[]
  height: number
  thickness?: number
  traits: string[]
  vantageFloors?: number[]
}
interface Tpl {
  model: string
  /** drawn extent of the template, inches (width along the card's u axis, depth along v) */
  w: number
  d: number
  parts: PartSpec[]
  children?: { tpl: string; at: P }[]
}

const rect = (x0: number, z0: number, x1: number, z1: number): P[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
const WALL = 0.5
const wall = (id: string, r: P[], h: number, traits = ['heavy']): PartSpec => ({ id, poly: r, height: h, thickness: WALL, traits })
const door = (id: string, r: P[]): PartSpec => ({ id, poly: r, height: 2.5, thickness: WALL, traits: ['accessible', 'heavy'] })
const windowPart = (id: string, r: P[]): PartSpec => ({ id, poly: r, height: 3, thickness: WALL, traits: ['barred', 'heavy'] })
const floor = (id: string, poly: P[], height: number): PartSpec => ({ id, poly, height, traits: ['vantage', 'ceiling'], vantageFloors: [height] })
const block = (id: string, w: number, d: number, height: number, traits: string[]): PartSpec => ({ id, poly: rect(0, 0, w, d), height, traits })

// ------------------------------------------------------------------ templates (drawn as on Map 1, relative to the piece's top-left corner)
const T: Record<string, Tpl> = {
  // Stronghold A, 8 x 6: door in the left wall near the top, upper floor stepping down toward the bottom left.
  A: {
    model: 't-stronghold',
    w: 8,
    d: 6,
    parts: [
      floor('upper-floor', [[0, 0], [5.5, 0], [5.5, 1.4], [5.1, 1.75], [4.4, 1.75], [3.4, 2.75], [3.4, 4.1], [2.5, 4.75], [2.5, 6], [0, 6]], 3),
      wall('wall-top', rect(0, 0, 8, WALL), 3),
      wall('wall-bottom', rect(0, 6 - WALL, 8, 6), 3),
      wall('wall-right', rect(8 - WALL, WALL, 8, 6 - WALL), 3),
      door('door', rect(0, WALL, WALL, 1.75)),
      wall('wall-left', rect(0, 1.75, WALL, 6 - WALL), 3),
    ],
    children: [{ tpl: 'M', at: [6.08, 0.29] }],
  },
  // Stronghold B, 8 x 8: door in the bottom wall, lower floor along the bottom with a gap, highest level in the bottom right.
  B: {
    model: 't-stronghold',
    w: 8,
    d: 8,
    parts: [
      floor('upper-floor', [[0, 4.13], [1.88, 4.13], [3.88, 5.25], [4.75, 5.25], [5.88, 4.13], [8, 4.13], [8, 5.75], [5.75, 5.75], [5.75, 8], [0, 8]], 3),
      floor('top-level', rect(5.75, 5.75, 8, 8), 5.5),
      wall('wall-top', rect(0, 0, 8, WALL), 3),
      wall('wall-left', rect(0, WALL, WALL, 8 - WALL), 3),
      wall('wall-right', rect(8 - WALL, WALL, 8, 8 - WALL), 3),
      wall('wall-bottom-a', rect(0, 8 - WALL, 3.55, 8), 3),
      door('door', rect(3.55, 8 - WALL, 5.55, 8)),
      wall('wall-bottom-b', rect(5.55, 8 - WALL, 8, 8), 3),
    ],
    children: [{ tpl: 'L', at: [0.29, 0.29] }, { tpl: 'N', at: [6.54, 0.29] }],
  },
  // Large ruin C, 4.33 x 6.46: walls along the top (door and window) and the right (rampart), ragged floor on the left.
  C: {
    model: 't-large-ruin',
    w: 4.33,
    d: 6.46,
    parts: [
      floor('upper-floor', [[0.87, 0], [4.33, 0], [4.33, 6], [0.5, 6], [0.87, 4.88], [0.25, 4.75], [0.25, 4.25], [0.87, 3.5], [0.5, 3.25], [1.12, 1.5], [0.75, 1.25]], 3),
      wall('wall-front-a', rect(0, 0, 0.4, WALL), 3),
      windowPart('window', rect(0.4, 0, 1.8, WALL)),
      wall('wall-front-b', rect(1.8, 0, 2.08, WALL), 3),
      door('door', rect(2.08, 0, 3.83, WALL)),
      wall('wall-side', rect(4.33 - WALL, 0, 4.33, 6.46), 3),
      { id: 'rampart', poly: rect(4.33 - WALL, WALL, 4.33, 6), height: 4, thickness: WALL, traits: ['light'] },
    ],
  },
  // Large ruin D, 3.79 x 5.83: walls along the left (door and window) and the top (rampart), ragged floor to the right.
  D: {
    model: 't-large-ruin',
    w: 3.79,
    d: 5.83,
    parts: [
      floor('upper-floor', [[0, 0], [3.42, 0], [3.42, 1.75], [3.04, 2.25], [3.42, 2.62], [3.42, 3.75], [3.04, 3.87], [2.17, 3.37], [2.04, 4], [0.79, 4.37], [1.04, 5.25], [0.42, 5.83], [0, 5.83]], 3),
      wall('wall-top', rect(0, 0, 3.79, WALL), 3),
      wall('wall-front-a', rect(0, WALL, WALL, 0.8), 3),
      door('door', rect(0, 0.8, WALL, 2.75)),
      wall('wall-front-b', rect(0, 2.75, WALL, 3.4), 3),
      windowPart('window', rect(0, 3.4, WALL, 4.8)),
      wall('wall-front-c', rect(0, 4.8, WALL, 5.83), 3),
      { id: 'rampart', poly: rect(WALL, 0, 3.79, WALL), height: 4, thickness: WALL, traits: ['light'] },
    ],
  },
  // Small ruin E, 2.83 x 5.5: an L of wall, corner at the top right, long arm down.
  E: {
    model: 't-small-ruin',
    w: 2.83,
    d: 5.5,
    parts: [wall('wall-short', rect(0, 0, 2.83 - WALL, WALL), 2.5), wall('wall-long', rect(2.83 - WALL, 0, 2.83, 5.5), 2.5)],
  },
  // Small ruin F, 1.46 x 4.63: an L of wall, corner at the bottom right, long arm up.
  F: {
    model: 't-small-ruin',
    w: 1.46,
    d: 4.63,
    parts: [wall('arm-short', rect(0, 4.63 - WALL, 1.46 - WALL, 4.63), 2.5), wall('arm-long', rect(1.46 - WALL, 0, 1.46, 4.63), 2.5)],
  },
  G: { model: 't-heavy-rubble', w: 1, d: 3, parts: [block('rubble-g', 1, 3, 1.5, ['heavy'])] },
  H: { model: 't-heavy-rubble', w: 1, d: 2.75, parts: [block('rubble-h', 1, 2.75, 1.5, ['heavy'])] },
  I: { model: 't-light-rubble', w: 3.5, d: 2, parts: [block('rubble-i', 3.5, 2, 1, ['light'])] },
  J: { model: 't-light-rubble', w: 0.75, d: 2.5, parts: [block('rubble-j', 0.75, 2.5, 1, ['light'])] },
  K: { model: 't-light-rubble', w: 0.75, d: 2, parts: [block('rubble-k', 0.75, 2, 1, ['light'])] },
  // Stronghold debris slabs (heavy, about 1.5 in high) and the barrel crates.
  L: { model: 't-heavy-rubble', w: 1.88, d: 3.42, parts: [block('slab-l', 1.88, 3.42, 1.5, ['heavy'])] },
  M: { model: 't-heavy-rubble', w: 1.63, d: 2.5, parts: [block('slab-m', 1.63, 2.5, 1.5, ['heavy'])] },
  N: { model: 't-container', w: 1.17, d: 2.42, parts: [block('crates', 1.17, 2.42, 1.5, ['heavy'])] },
}

// ------------------------------------------------------------------ placements measured from the cards
interface Place {
  k: string
  at: P
  cw?: number
}
interface MapDef {
  n: number
  name: string
  text: string
  places: Place[]
  /** skull centres on the card: grey = player A territory marker, orange = player B, black = centre */
  skulls: { a: P; b: P; centre: P }
}

const MAPS: MapDef[] = [
  {
    n: 1,
    name: 'Volkus Map 1',
    text: 'A stronghold on each half with a large ruin tucked behind it, small ruins on the edges and a rubble band across the middle.',
    places: [
      { k: 'A', at: [9, 2] }, { k: 'B', at: [3, 11] }, { k: 'C', at: [19.63, 3] }, { k: 'D', at: [14.96, 13.13] },
      { k: 'E', at: [21.13, 12] }, { k: 'F', at: [4.71, 2.33] }, { k: 'G', at: [6, 13] }, { k: 'H', at: [19, 8.25] },
      { k: 'I', at: [13, 10] }, { k: 'J', at: [19, 17.5] }, { k: 'K', at: [13.25, 4] },
    ],
    skulls: { a: [11.77, 11.81], b: [18.19, 18.23], centre: [15, 6] },
  },
  {
    n: 2,
    name: 'Volkus Map 2',
    text: 'Two strongholds face the centreline from opposite corners; the large ruins sit on the outside and the centre is a light rubble pile.',
    places: [
      { k: 'B', at: [6, 2] }, { k: 'A', at: [16, 11] }, { k: 'C', at: [6, 13.5], cw: 2 }, { k: 'D', at: [20.17, 3.13], cw: 2 },
      { k: 'E', at: [10.13, 13.46] }, { k: 'F', at: [18, 3.33], cw: 2 }, { k: 'G', at: [10, 5] }, { k: 'H', at: [23, 19.25] },
      { k: 'I', at: [14.25, 4] }, { k: 'J', at: [14.63, 19.5] }, { k: 'K', at: [16, 0] },
    ],
    skulls: { a: [11.23, 4.77], b: [18.77, 9.23], centre: [15, 18.23] },
  },
  {
    n: 3,
    name: 'Volkus Map 3',
    text: 'Stronghold and large ruin pairs mirror across the centre point, where the centre marker sits in the open.',
    places: [
      { k: 'A', at: [18, 2], cw: 3 }, { k: 'B', at: [6, 12], cw: 2 }, { k: 'C', at: [10.63, 3.5] }, { k: 'D', at: [17, 16.21], cw: 3 },
      { k: 'E', at: [21.13, 12] }, { k: 'F', at: [6, 4.33], cw: 2 }, { k: 'G', at: [9, 6] }, { k: 'H', at: [18, 12] },
      { k: 'I', at: [9, 14.5], cw: 1 }, { k: 'J', at: [12, 0] }, { k: 'K', at: [19, 16.25], cw: 1 },
    ],
    skulls: { a: [11.23, 2.73], b: [19.02, 18.19], centre: [15, 11] },
  },
  {
    n: 4,
    name: 'Volkus Map 4',
    text: 'Long-edge deployment: strongholds hold the two top corners of the card, ruins and rubble fill the gap between the drop zones.',
    places: [
      { k: 'A', at: [3, 3], cw: 3 }, { k: 'B', at: [13, 8], cw: 3 }, { k: 'C', at: [4, 14.63], cw: 1 }, { k: 'D', at: [22.21, 3], cw: 1 },
      { k: 'E', at: [11.46, 3], cw: 3 }, { k: 'F', at: [22.33, 17.5], cw: 1 }, { k: 'G', at: [15, 18], cw: 1 }, { k: 'H', at: [15, 11], cw: 1 },
      { k: 'I', at: [23, 6.5], cw: 1 }, { k: 'J', at: [3, 13.25], cw: 1 }, { k: 'K', at: [25, 12], cw: 1 },
    ],
    skulls: { a: [14.98, 12.77], b: [7.06, 9.1], centre: [24.23, 11] },
  },
  {
    n: 5,
    name: 'Volkus Map 5',
    text: 'A stronghold crowds each end of the long axis, a ruin and a pair of low rubble heaps cover the middle, and the centre marker sits on the line.',
    places: [
      { k: 'B', at: [7, 0] }, { k: 'E', at: [20.46, 3], cw: 3 }, { k: 'D', at: [22.21, 8.21], cw: 3 }, { k: 'C', at: [3, 10] },
      { k: 'A', at: [14, 14], cw: 1 }, { k: 'H', at: [11.25, 11], cw: 1 }, { k: 'I', at: [17, 7.5], cw: 1 }, { k: 'G', at: [6, 18], cw: 1 },
      { k: 'K', at: [3, 3], cw: 1 }, { k: 'F', at: [23, 17.5], cw: 1 }, { k: 'J', at: [2, 13], cw: 1 },
    ],
    skulls: { a: [5.19, 13.98], b: [25.23, 8.27], centre: [15, 11] },
  },
  {
    n: 6,
    name: 'Volkus Map 6',
    text: 'Strongholds hold opposite corners of the centreline, a large ruin backs the centre and rubble screens each flank.',
    places: [
      { k: 'E', at: [5, 3], cw: 3 }, { k: 'D', at: [21.21, 3], cw: 1 }, { k: 'A', at: [2, 9], cw: 2 }, { k: 'B', at: [20, 11], cw: 1 },
      { k: 'F', at: [9.33, 17.5], cw: 1 }, { k: 'C', at: [12.63, 8] }, { k: 'H', at: [14, 3], cw: 1 }, { k: 'G', at: [20, 7], cw: 1 },
      { k: 'I', at: [12, 11], cw: 1 }, { k: 'K', at: [4.5, 12.25], cw: 1 }, { k: 'J', at: [2, 18.25], cw: 1 },
    ],
    skulls: { a: [7.02, 13.81], b: [23.77, 8.23], centre: [15, 11] },
  },
]

// ------------------------------------------------------------------ composition
interface Vec { x: number; z: number }
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0 // + 0 turns -0 into 0
const norm = (a: number) => ((a % 360) + 360) % 360

/** Rotate a rel offset by `cw` quarter turns clockwise on the card (y down): (x, y) -> (-y, x). */
function turn(q: P, cw: number): P {
  let [x, y] = q
  for (let i = 0; i < cw; i++) [x, y] = [-y, x]
  return [x, y]
}

interface OutPart { id: string; footprint: Vec[]; height: number; thickness?: number; traits: string[]; vantageFloors?: number[] }
interface OutPiece { id: string; model: string; pos: Vec; yaw: number; parts: OutPart[] }

function compose(map: MapDef): OutPiece[] {
  const longEdge = map.n >= 4
  const toWorld = (u: number, v: number): Vec => (longEdge ? { x: r3(15 - u), z: r3(11 - v) } : { x: r3(u - 15), z: r3(v - 11) })
  const pieces: OutPiece[] = []
  const emit = (key: string, u0: number, v0: number, cw: number): void => {
    const t = T[key]!
    const odd = cw % 2 === 1
    const wp = odd ? t.d : t.w
    const dp = odd ? t.w : t.d
    const cu = u0 + wp / 2
    const cv = v0 + dp / 2
    const toCard = (q: P): P => {
      const o = turn([q[0] - t.w / 2, q[1] - t.d / 2], cw)
      return [cu + o[0], cv + o[1]]
    }
    // Local frame: long axis along x. A template that is taller than wide on the card is turned a quarter first.
    const yawRef = t.d > t.w ? 270 : 0
    const yawCard = norm(yawRef - 90 * cw)
    const yaw = norm(yawCard + (longEdge ? 180 : 0))
    const id = `p${String(pieces.length + 1).padStart(2, '0')}`
    pieces.push({
      id,
      model: t.model,
      pos: toWorld(cu, cv),
      yaw,
      parts: t.parts.map((p) => {
        const out: OutPart = { id: p.id, footprint: p.poly.map((q) => { const c = toCard(q); return toWorld(c[0], c[1]) }), height: p.height, traits: [...p.traits] }
        if (p.thickness !== undefined) out.thickness = p.thickness
        if (p.vantageFloors) out.vantageFloors = [...p.vantageFloors]
        return out
      }),
    })
    for (const ch of t.children ?? []) {
      const ct = T[ch.tpl]!
      const c = toCard([ch.at[0] + ct.w / 2, ch.at[1] + ct.d / 2])
      const cwp = odd ? ct.d : ct.w
      const cdp = odd ? ct.w : ct.d
      emit(ch.tpl, c[0] - cwp / 2, c[1] - cdp / 2, cw)
    }
  }
  for (const p of map.places) emit(p.k, p.at[0], p.at[1], p.cw ?? 0)
  return pieces
}

function layoutFor(map: MapDef): unknown {
  const longEdge = map.n >= 4
  const w = (p: P): Vec => (longEdge ? { x: r3(15 - p[0]), z: r3(11 - p[1]) } : { x: r3(p[0] - 15), z: r3(p[1] - 11) })
  const a = w(map.skulls.a)
  const b = w(map.skulls.b)
  const centre = w(map.skulls.centre)
  return {
    id: `kz.volkus-ao25-${map.n}`,
    name: map.name,
    size: { x: 30, z: 22 },
    pieces: compose(map),
    maps: [{ id: longEdge ? 'prelim-2' : 'prelim-1', objectiveSpots: { centre: [centre], territoryA: [a], territoryB: [b], default: { centre, a, b } } }],
    text: map.text,
    source: `Approved Ops 2025 card pack, Killzone: Volkus Map ${map.n} (measured from the card)`,
  }
}

function format(o: unknown): string {
  return JSON.stringify(o, null, 2).replace(/\{\s+"x": (-?[\d.]+),\s+"z": (-?[\d.]+)\s+\}/g, '{ "x": $1, "z": $2 }') + '\n'
}

const outDir = resolve(import.meta.dirname, '../src/data/killzones')
for (const m of MAPS) {
  const file = resolve(outDir, `volkus-ao25-${m.n}.json`)
  writeFileSync(file, format(layoutFor(m)))
  console.log('wrote', file)
}
