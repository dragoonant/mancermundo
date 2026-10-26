import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import type { KillzoneLayoutData, TerrainTrait } from '../../src/data'
import { dist, polygonArea } from '../../src/data/geometry'
import { LAYOUT_RULES, isOfficialCard, validateAll } from '../../src/data/validate'

const bundle = loadBundle()
const layouts = Object.values(bundle.layouts).sort((a, b) => a.id.localeCompare(b.id))
const TRAITS: TerrainTrait[] = ['light', 'heavy', 'blocking', 'vantage', 'accessible', 'insignificant', 'exposed', 'ceiling', 'barred', 'wall']
const count = (l: KillzoneLayoutData, model: string) => l.pieces.filter((p) => p.model === model).length

describe('killzone layouts: the six Approved Ops 2025 Volkus cards', () => {
  it('six official layouts, one per card, each drawn for exactly one mission map', () => {
    expect(layouts.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `kz.volkus-ao25-${n}`))
    layouts.forEach((l, i) => {
      expect(isOfficialCard(l)).toBe(true)
      expect(l.size).toEqual({ x: 30, z: 22 })
      expect(l.maps.map((m) => m.id)).toEqual([i < 3 ? 'prelim-1' : 'prelim-2'])
      expect(l.source).toMatch(/Approved Ops 2025/)
    })
  })

  it('every card carries the kit: 2 strongholds, 2 large ruins, 2 small ruins, 2 heavy rubble, 3 light rubble, 3 debris slabs and crates', () => {
    for (const l of layouts) {
      expect(count(l, 't-stronghold')).toBe(2)
      expect(count(l, 't-large-ruin')).toBe(2)
      expect(count(l, 't-small-ruin')).toBe(2)
      expect(count(l, 't-heavy-rubble')).toBe(4) // 2 heavy rubble + the 2 debris slabs
      expect(count(l, 't-light-rubble')).toBe(3)
      expect(count(l, 't-container')).toBe(1)
      for (const p of l.pieces) {
        expect(p.model).toMatch(/^t-[a-z-]+$/)
        for (const q of p.parts) for (const t of q.traits) expect(TRAITS).toContain(t)
      }
    }
  })

  it('strongholds have Vantage upper levels (B also its 5.5 in top level) and a door; large ruins add a window and a light rampart', () => {
    for (const l of layouts) {
      const strongholds = l.pieces.filter((p) => p.model === 't-stronghold')
      expect(strongholds.filter((p) => p.parts.some((q) => q.id === 'top-level'))).toHaveLength(1)
      for (const s of strongholds) {
        const upper = s.parts.find((q) => q.id === 'upper-floor')!
        expect(upper.traits).toEqual(expect.arrayContaining(['vantage', 'ceiling']))
        expect(upper.vantageFloors).toEqual([3])
        expect(s.parts.find((q) => q.id === 'door')!.traits).toEqual(expect.arrayContaining(['accessible', 'heavy']))
        const top = s.parts.find((q) => q.id === 'top-level')
        if (top) expect(top.vantageFloors).toEqual([5.5])
      }
      for (const r of l.pieces.filter((p) => p.model === 't-large-ruin')) {
        const upper = r.parts.find((q) => q.id === 'upper-floor')!
        expect(upper.traits).toEqual(expect.arrayContaining(['vantage', 'ceiling']))
        expect(upper.vantageFloors).toEqual([3])
        expect(r.parts.find((q) => q.id === 'door')!.traits).toEqual(expect.arrayContaining(['accessible', 'heavy']))
        expect(r.parts.find((q) => q.id === 'window')!.traits).toEqual(expect.arrayContaining(['barred', 'heavy']))
        expect(r.parts.find((q) => q.id === 'rampart')!.traits).toContain('light')
      }
    }
  })

  it('all footprints are inside the board and the data validator (with the official-card relaxations) passes', () => {
    const result = validateAll({ hooksFile: 'skip' })
    expect(result.errors.filter((e) => /kz\./.test(e))).toEqual([])
    const b = LAYOUT_RULES.board
    for (const l of layouts) {
      for (const p of l.pieces) {
        for (const q of p.parts) {
          expect(polygonArea(q.footprint)).toBeGreaterThan(0.05)
          for (const v of q.footprint) {
            expect(v.x).toBeGreaterThanOrEqual(b.minX)
            expect(v.x).toBeLessThanOrEqual(b.maxX)
            expect(v.z).toBeGreaterThanOrEqual(b.minZ)
            expect(v.z).toBeLessThanOrEqual(b.maxZ)
          }
        }
      }
    }
  })

  it("each card's skulls land in the right territories: A's grey one on A's side, B's orange one on B's, the black one on the centreline", () => {
    const r = 20 / 25.4
    for (const l of layouts) {
      const lm = l.maps[0]!
      const { centre, a, b } = lm.objectiveSpots.default
      expect(lm.objectiveSpots.centre).toEqual([centre])
      expect(lm.objectiveSpots.territoryA).toEqual([a])
      expect(lm.objectiveSpots.territoryB).toEqual([b])
      if (lm.id === 'prelim-1') {
        expect(centre.x).toBe(0)
        expect(a.x).toBeLessThan(-r)
        expect(b.x).toBeGreaterThan(r)
      } else {
        expect(centre.z).toBe(0)
        expect(a.z).toBeLessThan(-r)
        expect(b.z).toBeGreaterThan(r)
      }
      // more than 5 in apart (edge to edge) from every other marker
      for (const [p, q] of [[centre, a], [centre, b], [a, b]] as const) expect(dist(p, q) - 2 * r).toBeGreaterThan(5)
    }
  })
})
