import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import { compileBoard, distToOutline, deploymentRegions } from '../../src/engine/board'

const bundle = loadBundle()
const scn = (id: string) => bundle.scenarios[id]!
const tunnel = scn('scn.tunnel-skirmish')
const smash = scn('scn.smash-and-grab')
const riches = scn('scn.forgotten-riches')

describe('scenario data (11-scenarios.md)', () => {
  it('ships Tunnel Skirmish, Smash & Grab and Forgotten Riches', () => {
    expect(Object.keys(bundle.scenarios).sort()).toEqual(['scn.forgotten-riches', 'scn.smash-and-grab', 'scn.tunnel-skirmish'])
    for (const s of Object.values(bundle.scenarios)) {
      expect(s.text.length, s.id).toBeGreaterThan(80)
      expect(s.source, s.id).toMatch(/^Necrodamus N23 p\d+; 11-scenarios\.md M-\d$/)
    }
  })

  it('M-2 Tunnel Skirmish: 2x3, custom 10 each, standard deployment with no sides, 3/2/1 for each enemy down or fled, most points wins', () => {
    expect(tunnel.layouts).toEqual(['2x3'])
    expect(tunnel.roles).toBe(false)
    expect(tunnel.crews).toEqual({ both: { method: 'custom', x: 10 } })
    expect(tunnel.crewCap).toBeNull()
    expect(tunnel.deployment).toEqual({ kind: 'standard', minFromCentreline: 12, defenderFirst: false })
    expect(tunnel.caskets).toBeUndefined()
    expect(tunnel.scoring.map((s) => s.on)).toEqual(['fighterOutOfAction', 'fighterFled'])
    for (const row of tunnel.scoring) expect(row.points).toEqual({ byRole: { leader: 3, champion: 2, ganger: 1, juve: 1, specialist: 1, prospect: 1 } })
    expect(tunnel.victory).toEqual({ by: 'points' })
    expect(tunnel.special).toEqual([])
  })

  it('M-3 Smash & Grab: attacker custom 8, defender hybrid 3+D6, defender places 5 caskets in its half, only the attacker opens them', () => {
    expect(smash.layouts).toEqual(['2x3'])
    expect(smash.roles).toBe(true)
    expect(smash.crews).toEqual({ attacker: { method: 'custom', x: 8 }, defender: { method: 'hybrid', x: 3, y: 'D6' } })
    expect(smash.deployment).toEqual({ kind: 'standard', minFromCentreline: 12, defenderFirst: true })
    expect(smash.caskets).toMatchObject({ count: 5, placer: 'defender', region: 'ownHalf', minFromEdge: 4, minApart: 0, openBy: 'attacker' })
    expect(smash.scoring).toEqual([{ on: 'casketOpened', seat: 'attacker', count: true }])
    // the booby-trap / valuables / jackpot table and the three-opened win are scenario code (S4)
    expect(smash.caskets!.contents).toBe('scn.smash-and-grab')
    expect(smash.victory).toEqual({ code: 'smashAndGrabVictory' })
  })

  it('M-4 Forgotten Riches: brick7, custom crews capped by one 2D6 table, tile deployment, 5 caskets from the centre tile out, Horrors in the Dark', () => {
    expect(riches.layouts).toEqual(['brick7'])
    expect(riches.roles).toBe(false)
    expect(riches.crews).toEqual({ both: { method: 'custom', x: 9 } })
    expect(riches.crewCap).toEqual([
      { min: 2, max: 3, cap: 5 },
      { min: 4, max: 5, cap: 6 },
      { min: 6, max: 8, cap: 7 },
      { min: 9, max: 10, cap: 8 },
      { min: 11, max: 12, cap: 9 },
    ])
    // the scenario's cap table is the one in the shared constants
    expect(riches.crewCap).toEqual(bundle.constants.crewCap)
    expect(riches.deployment).toEqual({ kind: 'tile', withinOfEdge: 3, enemyClearance: 6 })
    expect(riches.caskets).toMatchObject({ count: 5, placer: 'alternate', region: 'centreTileFirst', minFromEdge: 0, minApart: 6, contents: 'core' })
    expect(riches.scoring).toEqual([
      { on: 'fighterOutOfAction', points: 1 },
      { on: 'fighterFled', points: 1 },
      { on: 'casketSecured', points: 2, count: true },
      { on: 'lastGangStanding', points: 'D3' },
    ])
    expect(riches.victory).toEqual({ by: 'caskets' })
    expect(riches.special).toEqual([{ code: 'horrorsInTheDark' }])
  })

  it('every crew size a scenario asks for is within the largest crew a board has room for (10)', () => {
    for (const s of Object.values(bundle.scenarios)) {
      for (const c of Object.values(s.crews)) {
        const most = c.x + (c.y === 'D6' ? 6 : 0)
        expect(most, s.id).toBeLessThanOrEqual(10)
      }
    }
  })

  it('every scenario has at least one board, and every board it names lists it back', () => {
    for (const s of Object.values(bundle.scenarios)) {
      const mine = Object.values(bundle.boards).filter((b) => b.scenarios.includes(s.id))
      expect(mine.length, s.id).toBeGreaterThanOrEqual(s.id === 'scn.forgotten-riches' ? 2 : 3)
      for (const b of mine) expect(s.layouts).toContain(b.layout)
    }
  })

  it('M-3.4 smash & grab: each half has room for five caskets 4" from every edge and 6" apart outside walls and obstacles', () => {
    for (const b of Object.values(bundle.boards).filter((x) => x.scenarios.includes(smash.id))) {
      const def = compileBoard(b, bundle.tiles)
      const mid = (def.bounds.minZ + def.bounds.maxZ) / 2
      for (const half of [-1, 1]) {
        const picks: { x: number; z: number }[] = []
        for (let z = half < 0 ? def.bounds.minZ : mid; z < (half < 0 ? mid : def.bounds.maxZ); z += 1) {
          for (let x = def.bounds.minX; x <= def.bounds.maxX; x += 1) {
            const p = { x, z }
            if (distToOutline(def, p) < 4) continue
            const clear = [...def.walls.map((w) => w.poly), ...def.doors.map((d) => d.poly), ...def.obstacles.map((o) => o.poly)].every((poly) => {
              let d = Infinity
              for (let i = 0; i < poly.length; i++) {
                const a = poly[i]!
                const c = poly[(i + 1) % poly.length]!
                const l2 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2
                const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (c.x - a.x) + (p.z - a.z) * (c.z - a.z)) / l2))
                d = Math.min(d, Math.hypot(p.x - (a.x + t * (c.x - a.x)), p.z - (a.z + t * (c.z - a.z))))
              }
              return d >= 0.75
            })
            if (!clear) continue
            if (picks.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 6)) picks.push(p)
          }
        }
        expect(picks.length, `${b.id} half ${half}`).toBeGreaterThanOrEqual(5)
      }
    }
  })

  it('M-4.3 forgotten riches: every tile of a brick board has a casket spot 6" from every edge, and the spots of different tiles are 6" apart', () => {
    for (const b of Object.values(bundle.boards).filter((x) => x.scenarios.includes(riches.id))) {
      const def = compileBoard(b, bundle.tiles)
      const eligible = def.casketSpots.filter((s) => distToOutline(def, s) >= 6 - 1e-6)
      const perTile = def.tiles.map((t) => eligible.filter((s) => Math.abs(s.x - t.centre.x) <= 6 && Math.abs(s.z - t.centre.z) <= 6))
      perTile.forEach((spots, i) => expect(spots.length, `${b.id} tile ${i}`).toBeGreaterThanOrEqual(1))
      // the centre tile comes first
      const centre = def.tiles.findIndex((t) => t.centre.x === 0 && t.centre.z === 0)
      expect(perTile[centre]!.length).toBeGreaterThanOrEqual(1)
      // the first spot of each tile, all pairwise at least 6" apart
      const firsts = perTile.map((s) => s[0]!)
      for (let i = 0; i < firsts.length; i++) {
        for (let j = i + 1; j < firsts.length; j++) expect(Math.hypot(firsts[i]!.x - firsts[j]!.x, firsts[i]!.z - firsts[j]!.z), `${b.id} ${i}/${j}`).toBeGreaterThanOrEqual(6 - 1e-6)
      }
      // six outer tiles to deploy on, and the centre tile has no deployment band
      const regions = deploymentRegions(def, riches.deployment)
      expect(regions.kind).toBe('tile')
      if (regions.kind === 'tile') {
        expect(Object.keys(regions.tiles)).toHaveLength(6)
        expect(regions.tiles[def.tiles[centre]!.id]).toBeUndefined()
      }
    }
  })
})
