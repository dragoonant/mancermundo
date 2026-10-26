import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import { validateAll } from '../../src/data/validate'
import { boardProblems, outlineRuns, placeBoard, tileProblems } from '../../src/data/zm/checks'
import type { BoardData, ScenarioData, TileData, Vec2 } from '../../src/data/types'
import { blockingPolygons, compileBoard, initialDoors, insideOutline, outlineSegments } from '../../src/engine/board'
import { deploymentProblems } from '../../src/engine/board-checks'
import { pointInPolygon, polygonBBox } from '../../src/engine/geometry'

const bundle = loadBundle()
const tiles = Object.values(bundle.tiles)
const boards = Object.values(bundle.boards)
const v = (x: number, z: number): Vec2 => ({ x, z })

const scenariosOf = (b: BoardData): ScenarioData[] => b.scenarios.map((id) => bundle.scenarios[id]!)
/** The data-side structural checks, then (when the layout is sound) the compiled-board checks for deployment and reach. */
const problems = (b: BoardData, tileSet: Record<string, TileData> = bundle.tiles): string[] => {
  const structural = boardProblems(b, tileSet)
  if (structural.some((m) => /overlap|shares|layout|needs a tile|not a slot/.test(m))) return structural
  return [...structural, ...deploymentProblems(compileBoard(b, tileSet), scenariosOf(b))]
}
/** The shipped tiles with `edit` applied to every one of them. */
const editAll = (edit: (t: TileData) => Partial<TileData>): Record<string, TileData> =>
  Object.fromEntries(tiles.map((t) => [t.id, { ...t, ...edit(t) }]))
/** The shipped tiles with one replaced. */
const swap = (t: TileData, patch: Partial<TileData>): Record<string, TileData> => ({ ...bundle.tiles, [t.id]: { ...t, ...patch } })

describe('zone mortalis data: tiles', () => {
  it('ships six own-design tiles, each drawn inside its 12 x 12 square', () => {
    expect(tiles.map((t) => t.id).sort()).toEqual(['zm.t.bulkhead', 'zm.t.chamber', 'zm.t.crossroads', 'zm.t.duct-room', 'zm.t.junction', 'zm.t.loading-bay'])
    for (const t of tiles) {
      expect(t.source).toBe('own design')
      expect(t.walls.length, t.id).toBeGreaterThan(0)
      expect(t.casketSpots.length, t.id).toBeGreaterThan(0)
      expect(tileProblems(t), t.id).toEqual([])
    }
  })

  it('has the features the plan names: a locked bulkhead with a terminal each side, ductways, barricades, a floor style each way', () => {
    const bulkhead = bundle.tiles['zm.t.bulkhead']!
    const locked = bulkhead.doors.filter((d) => d.locked)
    expect(locked).toHaveLength(1)
    expect(bulkhead.terminals.filter((m) => m.door === locked[0]!.id)).toHaveLength(2)
    expect(bundle.tiles['zm.t.duct-room']!.ducts.length).toBeGreaterThanOrEqual(3)
    expect(bundle.tiles['zm.t.chamber']!.obstacles.filter((o) => o.kind === 'barricade').length).toBeGreaterThanOrEqual(4)
    expect(bundle.tiles['zm.t.loading-bay']!.obstacles.some((o) => o.kind === 'crates')).toBe(true)
    expect(new Set(tiles.map((t) => t.floor.style))).toEqual(new Set(['grate', 'plate', 'hazard']))
  })

  it('every tile is used by at least one board', () => {
    const used = new Set(boards.flatMap((b) => b.tiles.map((p) => p.tile)))
    for (const t of tiles) expect(used.has(t.id), t.id).toBe(true)
  })

  it('tileProblems flags a clockwise or oversized obstacle and a door too narrow to enter', () => {
    const bad: TileData = {
      ...tiles[0]!,
      obstacles: [
        { id: 'cw', kind: 'barricade', footprint: [v(0, 0), v(0, 1), v(1, 1), v(1, 0)] },
        { id: 'big', kind: 'crates', footprint: [v(0, 0), v(3, 0), v(3, 1), v(0, 1)] },
      ],
      doors: [{ id: 'slit', a: v(0, 0), b: v(1, 0), locked: false }],
    }
    const msgs = tileProblems(bad).join('\n')
    expect(msgs).toMatch(/obstacles\.cw: footprint must be counter-clockwise/)
    expect(msgs).toMatch(/obstacles\.big: 3\.00" across/)
    expect(msgs).toMatch(/doors\.slit: 1\.00" wide/)
  })
})

describe('zone mortalis data: boards', () => {
  it('ships Foundry Run, Bulkhead Gauntlet and Cistern Crossing on 2x3 and Hive Heart and Sump Warren on brick7', () => {
    expect(boards.map((b) => `${b.id}:${b.layout}`).sort()).toEqual([
      'zm.b.bulkhead-gauntlet:2x3',
      'zm.b.cistern-crossing:2x3',
      'zm.b.foundry-run:2x3',
      'zm.b.hive-heart:brick7',
      'zm.b.sump-warren:brick7',
    ])
    for (const b of boards) {
      expect(b.source).toBe('own design')
      expect(b.scenarios.length, b.id).toBeGreaterThan(0)
      for (const s of scenariosOf(b)) expect(s.layouts, `${b.id} ${s.id}`).toContain(b.layout)
    }
    expect(boards.filter((b) => b.layout === '2x3').every((b) => b.scenarios.includes('scn.tunnel-skirmish') && b.scenarios.includes('scn.smash-and-grab'))).toBe(true)
    expect(boards.filter((b) => b.layout === 'brick7').every((b) => b.scenarios.join() === 'scn.forgotten-riches')).toBe(true)
  })

  it('ZM-012 every board passes every geometry check of the validator (no problems at all)', () => {
    for (const b of boards) expect(problems(b), b.id).toEqual([])
  })

  it('ZM-012 validateAll reports no board problem for the shipped data', () => {
    const r = validateAll({ sourcesDir: false, allowPendingCodes: true })
    expect(r.errors.filter((e) => /zm\/|zm\.b\.|zm\.t\./.test(e))).toEqual([])
    expect(r.summaries.filter((s) => s.def === 'board')).toHaveLength(5)
    expect(r.summaries.filter((s) => s.def === 'tile')).toHaveLength(6)
  })

  it('the validator places tiles exactly as the compiler does (doors, terminals, ducts, obstacles, casket spots, outline, wall coverage)', () => {
    for (const b of boards) {
      const def = compileBoard(b, bundle.tiles)
      const placed = placeBoard(b, bundle.tiles)
      expect(placed.doors.map((d) => ({ id: d.id, a: d.a, b: d.b, locked: d.locked, terminals: d.terminals }))).toEqual(
        def.doors.map((d) => ({ id: d.id, a: d.seg.a, b: d.seg.b, locked: d.lockedAtStart, terminals: d.terminals })),
      )
      expect(placed.ducts).toEqual(def.ducts)
      expect(placed.obstacles.map((o) => ({ id: o.id, kind: o.kind, poly: o.poly }))).toEqual(def.obstacles)
      expect(placed.spots).toEqual(def.casketSpots)
      const norm = (rs: { a: Vec2; b: Vec2 }[]) => rs.map((r) => `${r.a.x},${r.a.z}>${r.b.x},${r.b.z}`).sort()
      expect(norm(placed.outline)).toEqual(norm(outlineSegments(def.tiles.map((t) => t.centre))))
      expect(norm(outlineRuns(def.tiles.map((t) => t.centre)))).toEqual(norm(placed.outline))
      // every wall the validator sees lies inside the walls the compiler built (it merges duplicates and fills corners)
      for (const w of placed.walls) {
        for (const p of [w.a, { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 }, w.b]) {
          expect(def.walls.some((c) => pointInPolygon(p, c.poly)), `${b.id} wall ${w.id} at (${p.x}, ${p.z})`).toBe(true)
        }
      }
    }
  })

  it('no two boards use the same arrangement of tiles', () => {
    const sig = (b: BoardData) => b.tiles.map((t) => `${t.tile}@${t.at.x},${t.at.z}/${t.rot}`).sort().join('|')
    expect(new Set(boards.map(sig)).size).toBe(boards.length)
  })

  it('boards are fair: every board is its own half-turn image (walls, doors and their locks, obstacles, ductways)', () => {
    for (const b of boards) {
      const def = compileBoard(b, bundle.tiles)
      const kindAt = (p: Vec2): string => {
        for (const d of def.doors) if (pointInPolygon(p, d.poly)) return d.lockedAtStart ? 'L' : 'D'
        for (const w of def.walls) if (pointInPolygon(p, w.poly)) return '#'
        for (const o of def.obstacles) if (pointInPolygon(p, o.poly)) return o.kind
        return '.'
      }
      for (let z = def.bounds.minZ + 0.125; z < def.bounds.maxZ; z += 0.25) {
        for (let x = def.bounds.minX + 0.125; x < def.bounds.maxX; x += 0.25) {
          if (kindAt(v(x, z)) !== kindAt(v(-x, -z))) throw new Error(`${b.id}: (${x}, ${z}) is ${kindAt(v(x, z))} but (${-x}, ${-z}) is ${kindAt(v(-x, -z))}`)
        }
      }
      const key = (a: Vec2, c: Vec2) => [a, c].map((p) => `${p.x},${p.z}`).sort().join('>')
      const ducts = new Set(def.ducts.map((u) => key(u.a, u.b)))
      for (const u of def.ducts) expect(ducts.has(key({ x: -u.a.x, z: -u.a.z }, { x: -u.b.x, z: -u.b.z })), `${b.id} duct ${u.id}`).toBe(true)
    }
  })

  it('has no straight line of sight longer than 30" with every door closed, and few longer than 20"', () => {
    for (const b of boards) {
      const def = compileBoard(b, bundle.tiles)
      const polys = blockingPolygons(def, initialDoors(def)).map((p) => ({ p, box: polygonBBox(p) }))
      const step = 0.25
      const { minX, maxX, minZ, maxZ } = def.bounds
      const cols = Math.round((maxX - minX) / step) + 1
      const rows = Math.round((maxZ - minZ) / step) + 1
      const blocked = new Uint8Array(cols * rows)
      for (let iz = 0; iz < rows; iz++) {
        for (let ix = 0; ix < cols; ix++) {
          const p = { x: minX + ix * step, z: minZ + iz * step }
          blocked[iz * cols + ix] = !insideOutline(def, p) || polys.some(({ p: q, box }) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ && pointInPolygon(p, q)) ? 1 : 0
        }
      }
      let longest = 0
      let over20 = 0
      let total = 0
      for (let iz = 2; iz < rows; iz += 8) {
        for (let ix = 2; ix < cols; ix += 8) {
          if (blocked[iz * cols + ix]) continue
          for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2
            let t = 0
            for (;;) {
              t += 1
              const jx = Math.round(ix + Math.cos(a) * t)
              const jz = Math.round(iz + Math.sin(a) * t)
              if (jx < 0 || jx >= cols || jz < 0 || jz >= rows || blocked[jz * cols + jx]) break
            }
            const len = t * step
            longest = Math.max(longest, len)
            total++
            if (len > 20) over20++
          }
        }
      }
      expect(longest, `${b.id} longest line`).toBeLessThanOrEqual(30)
      expect(over20 / total, `${b.id} share of lines over 20"`).toBeLessThan(0.02)
    }
  })
})

describe('zone mortalis data: the validator catches broken boards', () => {
  const foundry = bundle.boards['zm.b.foundry-run']!
  const gauntlet = bundle.boards['zm.b.bulkhead-gauntlet']!

  it('ZM-012 refuses a board with fewer than 3 doors, 2 ductways, 1 barricade or 2 far casket spots', () => {
    expect(problems(foundry, editAll(() => ({ doors: [], terminals: [] }))).join('\n')).toMatch(/ZM-012: 0 doors, at least 3/)
    expect(problems(foundry, editAll(() => ({ ducts: [] }))).join('\n')).toMatch(/ZM-012: 0 ductways, at least 2/)
    expect(problems(foundry, editAll((t) => ({ obstacles: t.obstacles.filter((o) => o.kind !== 'barricade') }))).join('\n')).toMatch(/ZM-012: 0 barricades/)
    expect(problems(foundry, editAll(() => ({ casketSpots: [] }))).join('\n')).toMatch(/ZM-012: 0 casket spots at least 6" from every board edge, need 2/)
  })

  it('ZM-012 counts only casket spots 6" or more from every board edge', () => {
    // two spots on the board, both within 1" of its edge: neither counts
    const near: BoardData = { ...foundry, extra: { ...foundry.extra, caskets: [v(-11, -17), v(11, 17)] } }
    expect(problems(near, editAll(() => ({ casketSpots: [] }))).join('\n')).toMatch(/ZM-012: 0 casket spots at least 6" from every board edge, need 2/)
    // add one that is 6" in and the count is 1, still short
    const one: BoardData = { ...near, extra: { ...near.extra, caskets: [...near.extra.caskets, v(0, 0)] } }
    expect(problems(one, editAll(() => ({ casketSpots: [] }))).join('\n')).toMatch(/ZM-012: 1 casket spots at least 6" from every board edge, need 2/)
  })

  it('ZM-001 refuses a board whose tiles are not the layout, or touch too little', () => {
    const stray: BoardData = { ...foundry, tiles: foundry.tiles.map((p, i) => (i === 5 ? { ...p, at: v(18, 24) } : p)) }
    expect(problems(stray).join('\n')).toMatch(/shares 0"/)
    expect(problems({ ...foundry, layout: 'brick7' }).join('\n')).toMatch(/layout brick7 has 7 tiles/)
  })

  it('refuses a door that is not in a wall gap, a locked door without a terminal on each side, and a terminal too far away', () => {
    const chamber = bundle.tiles['zm.t.chamber']!
    const floating = swap(chamber, { doors: [{ id: 'dx', a: v(1.5, 5), b: v(3.5, 5), locked: false }] })
    expect(problems(foundry, floating).join('\n')).toMatch(/door t\d\.dx: end a .* touches no wall/)

    const b = bundle.tiles['zm.t.bulkhead']!
    expect(problems(gauntlet, swap(b, { terminals: b.terminals.slice(0, 1) })).join('\n')).toMatch(/a locked door needs exactly one terminal on each side \(found 1 and 0\)/)
    expect(problems(gauntlet, swap(b, { terminals: [{ ...b.terminals[0]!, pos: v(3.5, 3) }, b.terminals[1]!] })).join('\n')).toMatch(/terminal t1 is 3\.00" from the door, more than 1"/)
    expect(problems(gauntlet, swap(b, { doors: b.doors.map((d) => ({ ...d, locked: false })) })).join('\n')).toMatch(/terminals belong to locked doors/)
  })

  it('refuses a duct that is too long or crosses no wall, and anything off the board', () => {
    const j = bundle.tiles['zm.t.junction']!
    const run = (ducts: TileData['ducts']) => problems(foundry, swap(j, { ducts })).join('\n')
    expect(run([{ id: 'u1', a: v(-2.6, 0), b: v(0.6, 0) }])).toMatch(/duct t\d\.u1: 3\.20" long, at most 2"/)
    expect(run([{ id: 'u1', a: v(3, 3), b: v(3.5, 3) }])).toMatch(/crosses 0 walls/)
    const off = swap(j, { obstacles: [{ id: 'b9', kind: 'barricade', footprint: [v(5.5, 0), v(7.5, 0), v(7.5, 1), v(5.5, 1)] }] })
    expect(problems(foundry, off).join('\n')).toMatch(/is outside the board|touches a wall/)
  })

  it('refuses obstacles on walls and casket spots too close to anything', () => {
    const c = bundle.tiles['zm.t.chamber']!
    const onWall = swap(c, { obstacles: [{ id: 'b9', kind: 'barricade', footprint: [v(-4.5, 2.5), v(-2.5, 2.5), v(-2.5, 3.5), v(-4.5, 3.5)] }] })
    expect(problems(foundry, onWall).join('\n')).toMatch(/obstacle t\d\.b9 touches a wall or door/)
    const tight = swap(c, { casketSpots: [...c.casketSpots, v(-3, 3)] })
    expect(problems(foundry, tight).join('\n')).toMatch(/casket spot \(.*\) is less than 0\.5" from a wall, door or obstacle/)
  })

  it('refuses a deployment strip too cramped for a full crew', () => {
    const walled: BoardData = {
      ...foundry,
      extra: { ...foundry.extra, walls: [-17, -16, -15, -14, -13].map((z, i) => ({ id: `fill${i}`, a: v(-11.5, z), b: v(11.5, z), thickness: 0.9 })) },
    }
    expect(problems(walled).join('\n')).toMatch(/deployment scn\.tunnel-skirmish low half: room for \d bases of 25 mm, a full crew is 10/)
  })

  it('refuses a casket spot or region that can only be reached through a locked door', () => {
    // a cell round the board centre closed off by a locked door with a terminal on each side
    const sealed: BoardData = {
      ...foundry,
      extra: {
        ...foundry.extra,
        walls: [
          { id: 'c1', a: v(-3, -3), b: v(3, -3), thickness: 0.5 },
          { id: 'c2', a: v(-3, 3), b: v(3, 3), thickness: 0.5 },
          { id: 'c3', a: v(-3, -3), b: v(-3, 3), thickness: 0.5 },
          { id: 'c4', a: v(3, -3), b: v(3, -1), thickness: 0.5 },
          { id: 'c5', a: v(3, 1), b: v(3, 3), thickness: 0.5 },
        ],
        doors: [{ id: 'lock', a: v(3, -1), b: v(3, 1), locked: true }],
        terminals: [{ id: 'k1', door: 'lock', pos: v(3.8, 0) }, { id: 'k2', door: 'lock', pos: v(2.2, 0) }],
        caskets: [v(0, 0)],
      },
    }
    const msgs = problems(sealed).join('\n')
    expect(msgs).toMatch(/casket spot \(0, 0\): cannot be reached without opening a locked door/)
  })
})
