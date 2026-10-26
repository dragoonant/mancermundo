import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import type { KillzoneLayoutData, TerrainTrait } from '../../src/data'
import { dist, polygonArea } from '../../src/data/geometry'
import { LAYOUT_RULES, validateAll } from '../../src/data/validate'

const bundle = loadBundle()
const layouts = Object.values(bundle.layouts)
const TRAITS: TerrainTrait[] = ['light', 'heavy', 'blocking', 'vantage', 'accessible', 'insignificant', 'exposed', 'ceiling', 'barred', 'wall']

const centroid = (l: KillzoneLayoutData, id: string) => {
  const p = l.pieces.find((x) => x.id === id)!
  const pts = p.parts.flatMap((q) => q.footprint)
  return { x: pts.reduce((s, v) => s + v.x, 0) / pts.length, z: pts.reduce((s, v) => s + v.z, 0) / pts.length }
}

describe('killzone layouts', () => {
  it('three Volkus layouts, 12 to 18 pieces each, using placeholder model slugs and valid traits', () => {
    expect(layouts.map((l) => l.id).sort()).toEqual(['kz.volkus-01', 'kz.volkus-02', 'kz.volkus-03'])
    for (const l of layouts) {
      expect(l.size).toEqual({ x: 30, z: 22 })
      expect(l.pieces.length).toBeGreaterThanOrEqual(12)
      expect(l.pieces.length).toBeLessThanOrEqual(18)
      const models = new Set(l.pieces.map((p) => p.model))
      expect([...models].every((m) => /^t-[a-z-]+$/.test(m))).toBe(true)
      expect(models.has('t-large-ruin')).toBe(true)
      for (const p of l.pieces) for (const q of p.parts) for (const t of q.traits) expect(TRAITS).toContain(t)
    }
    const kinds = new Set(layouts.flatMap((l) => l.pieces.map((p) => p.model)))
    for (const m of ['t-large-ruin', 't-small-ruin', 't-heavy-rubble', 't-light-rubble', 't-barricade', 't-container', 't-pipes']) {
      expect(kinds.has(m)).toBe(true)
    }
  })

  it('each large ruin has a vantage upper floor, a door, a window and a light rampart', () => {
    for (const l of layouts) {
      const ruins = l.pieces.filter((p) => p.model === 't-large-ruin')
      expect(ruins.length).toBeGreaterThanOrEqual(1)
      for (const r of ruins) {
        const upper = r.parts.find((q) => q.id === 'upper-floor')!
        expect(upper.traits).toEqual(expect.arrayContaining(['vantage', 'ceiling']))
        expect(upper.vantageFloors).toEqual([3])
        expect(r.parts.find((q) => q.id === 'door')!.traits).toEqual(expect.arrayContaining(['accessible', 'heavy']))
        expect(r.parts.find((q) => q.id === 'window')!.traits).toEqual(expect.arrayContaining(['barred', 'heavy']))
        expect(r.parts.find((q) => q.id === 'rampart')!.traits).toContain('light')
        expect(r.parts.filter((q) => q.thickness !== undefined).length).toBeGreaterThan(3)
      }
    }
  })

  it('layouts are symmetric under a half turn so neither seat is favoured', () => {
    for (const l of layouts) {
      expect(l.pieces.length % 2).toBe(0)
      for (let i = 0; i < l.pieces.length; i += 2) {
        const a = centroid(l, l.pieces[i].id)
        const b = centroid(l, l.pieces[i + 1].id)
        expect(a.x + b.x).toBeCloseTo(0, 2)
        expect(a.z + b.z).toBeCloseTo(0, 2)
        expect(l.pieces[i + 1].model).toBe(l.pieces[i].model)
      }
    }
  })

  it('all footprints are inside the board, lanes are open and no piece is within 1 in of a drop zone edge on either map', () => {
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

  it('objective spots satisfy the M-1.3 placement constraints for both maps and every crit op', () => {
    const r = 20 / 25.4
    for (const l of layouts) {
      expect(l.maps.map((m) => m.id)).toEqual(['prelim-1', 'prelim-2'])
      for (const lm of l.maps) {
        const spots = lm.objectiveSpots
        const { centre, a, b } = spots.default
        // centre marker on the centreline (x = 0 on map 1, z = 0 on map 2), more than 2 in from neutral edges
        if (lm.id === 'prelim-1') {
          expect(centre.x).toBe(0)
          expect(Math.abs(centre.z) + r + 2).toBeLessThan(11)
          expect(a.x).toBeLessThan(0)
          expect(b.x).toBeGreaterThan(0)
          expect(Math.abs(a.x) - r).toBeLessThanOrEqual(3)
          expect(Math.abs(a.x)).toBeGreaterThanOrEqual(r)
        } else {
          expect(centre.z).toBe(0)
          expect(Math.abs(centre.x) + r + 2).toBeLessThan(15)
          expect(a.z).toBeLessThan(0)
          expect(b.z).toBeGreaterThan(0)
          expect(Math.abs(a.z) - r).toBeLessThanOrEqual(3)
          expect(Math.abs(a.z)).toBeGreaterThanOrEqual(r)
        }
        // more than 5 in apart (edge to edge) from every other marker
        for (const [p, q] of [[centre, a], [centre, b], [a, b]] as const) expect(dist(p, q) - 2 * r).toBeGreaterThan(5)
        expect(spots.territoryA).toContainEqual(a)
        expect(spots.territoryB).toContainEqual(b)
      }
    }
  })
})
