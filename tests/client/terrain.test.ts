// Terrain GLBs: every model slug used by a killzone layout has a manifest entry and a file on disk, the rules
// footprint of a slug is identical in every piece and layout (the GLB is fitted once per slug), and the fit and
// see-through helpers behave.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAYOUT_FILES, fitScale, partStyle, pieceFootprint, pieceMeta, pieceOccludes, segmentHitsBox, toLocal, usesGlb, type TerrainEntry } from '@/client/board/terrainGlb'
import type { MapDef } from '@/engine'
import { terrainOf } from '@/engine/terrain'

const modelsDir = resolve(__dirname, '../../public/assets/models')
const manifest = JSON.parse(readFileSync(resolve(modelsDir, 'manifest.json'), 'utf8')) as { terrain?: Record<string, TerrainEntry> }
const terrain = manifest.terrain ?? {}
const pieces = LAYOUT_FILES.flatMap((l) => l.pieces.map((p) => ({ layout: l.id, piece: p })))
// buildings are drawn from their rules parts; only single-part pieces use a GLB
const glbPieces = pieces.filter((p) => usesGlb(p.piece.parts))
const slugs = [...new Set(glbPieces.map((p) => p.piece.model))]

describe('terrain GLBs', () => {
  it('layouts use terrain slugs', () => {
    expect(LAYOUT_FILES).toHaveLength(6)
    expect(slugs.length).toBeGreaterThanOrEqual(3)
  })

  it('every layout model slug has a manifest entry and a GLB under 1.2 MB', () => {
    for (const slug of slugs) {
      const e = terrain[slug]
      expect(e, `manifest.terrain.${slug}`).toBeDefined()
      const file = resolve(modelsDir, e!.file)
      expect(existsSync(file), e!.file).toBe(true)
      expect(statSync(file).size).toBeLessThan(1.2 * 1024 * 1024)
      expect(e!.origin).toBe('centre-ground')
    }
  })

  it('each GLB-drawn kit piece has the same footprint in every layout, centred on pos, and its GLB fits it with a sane stretch', () => {
    // the official cards use one slug for different kit pieces (stronghold A and B, large ruins C and D, ...), so the
    // footprint is per piece kind: same slug and same part list means the same piece
    const byKind = new Map<string, ReturnType<typeof pieceFootprint>>()
    for (const { layout, piece } of pieces) {
      if (!usesGlb(piece.parts)) continue
      const fp = pieceFootprint(piece)
      expect(Math.abs(fp.cx), `${layout}/${piece.id} centre x`).toBeLessThan(0.01)
      expect(Math.abs(fp.cz), `${layout}/${piece.id} centre z`).toBeLessThan(0.01)
      expect(fp.w, `${layout}/${piece.id} long axis on x`).toBeGreaterThanOrEqual(fp.d - 0.01)
      const kind = `${piece.model}:${piece.parts.map((q) => q.id).join(',')}`
      const ref = byKind.get(kind)
      if (!ref) byKind.set(kind, fp)
      else expect({ w: fp.w, d: fp.d, h: fp.h }, `${layout}/${piece.id} ${kind}`).toEqual({ w: ref.w, d: ref.d, h: ref.h })
    }
    for (const [kind, fp] of byKind) {
      const e = terrain[kind.split(':')[0]!]!
      // fitScale stretches the finalised GLB onto the rules footprint (the GLBs are regenerated per footprint later)
      for (const k of fitScale(e, fp)) {
        expect(k, kind).toBeGreaterThan(0.2)
        expect(k, kind).toBeLessThan(5)
      }
    }
  })

  it('pieceMeta finds the placement of an engine feature id', () => {
    // Map 1, large ruin C: drawn with its door wall on the card's top edge
    const m = pieceMeta('kz.volkus-ao25-1', 'p06')
    expect(m).toMatchObject({ model: 't-large-ruin', yaw: 270 })
    expect(m!.pos.x).toBeCloseTo(6.795, 2)
    expect(m!.pos.z).toBeCloseTo(-4.77, 2)
    expect(pieceMeta('kz.volkus-ao25-1', 'nope')).toBeNull()
    expect(pieceMeta('kz.volkus-01', 'p01')).toBeNull()
  })

  it('toLocal inverts rotation.y = yaw', () => {
    // three.js: local +x rotated by yaw 90 points to world -z
    const l = toLocal({ x: 0, z: -1 }, { x: 0, z: 0 }, 90)
    expect(l.x).toBeCloseTo(1)
    expect(l.z).toBeCloseTo(0)
  })
})

describe('structure drawn from parts', () => {
  // the layout files as engine maps, to get real Solids
  const solidsOf = (layoutId: string, pieceId: string) => {
    const l = LAYOUT_FILES.find((x) => x.id === layoutId)!
    const map = { id: l.id, size: { x: 30, z: 22 }, dropZones: [], features: l.pieces.map((q) => ({ id: q.id, parts: q.parts })) } as unknown as MapDef
    return terrainOf(map).solids.filter((x) => x.featureId === pieceId)
  }
  const styles = (solids: ReturnType<typeof solidsOf>) => Object.fromEntries(solids.map((x) => [x.partId, partStyle(x)]))

  it('buildings are drawn from parts, single-part pieces keep the GLB', () => {
    const buildings = pieces.filter((p) => ['t-stronghold', 't-large-ruin', 't-small-ruin'].includes(p.piece.model))
    expect(buildings.length).toBeGreaterThan(0)
    for (const { layout, piece } of buildings) expect(usesGlb(piece.parts), `${layout}/${piece.id} ${piece.model}`).toBe(false)
    const singles = pieces.filter((p) => p.piece.parts.length === 1)
    expect(singles.length).toBeGreaterThan(0)
    for (const { layout, piece } of singles) expect(usesGlb(piece.parts), `${layout}/${piece.id} ${piece.model}`).toBe(true)
    expect(usesGlb([])).toBe(false)
  })

  it('partStyle: door, window, floors, walls, rampart and rubble', () => {
    const find = (model: string, partId: string) => {
      const hit = pieces.find((p) => p.piece.model === model && p.piece.parts.some((q) => q.id === partId))!
      return solidsOf(hit.layout, hit.piece.id)
    }
    const stronghold = styles(find('t-stronghold', 'top-level'))
    expect(stronghold).toMatchObject({ door: 'door', 'upper-floor': 'floor', 'top-level': 'floor', 'wall-top': 'wall' })
    const ruin = styles(find('t-large-ruin', 'window'))
    expect(ruin).toMatchObject({ window: 'window', door: 'door', 'upper-floor': 'floor', 'wall-front-a': 'wall', rampart: 'rampart' })
    expect(styles(find('t-heavy-rubble', 'slab-m'))).toEqual({ 'slab-m': 'block' })
    expect(styles(find('t-light-rubble', 'rubble-i'))).toEqual({ 'rubble-i': 'block' })
  })
})

describe('see-through heuristic', () => {
  const wall = { minX: -1, maxX: 1, minZ: -0.25, maxZ: 0.25, bottom: 0, top: 3 }
  it('segmentHitsBox: through, over and beside', () => {
    expect(segmentHitsBox([0, 1, 5], [0, 1, -5], wall)).toBe(true)
    expect(segmentHitsBox([0, 5, 5], [0, 4, -5], wall)).toBe(false)
    expect(segmentHitsBox([3, 1, 5], [3, 1, -5], wall)).toBe(false)
  })
  it('a camera behind a wall is blocked from a figure in front of it; one on top of the part is not', () => {
    const cam = { x: 0, y: 8, z: 8 } as never
    expect(pieceOccludes(cam, { x: 0, y: 0.7, z: -1.5, feetY: 0 }, [wall])).toBe(true)
    expect(pieceOccludes(cam, { x: 0, y: 5.7, z: 0, feetY: 3 }, [wall])).toBe(false)
    expect(pieceOccludes(cam, { x: 0, y: 0.7, z: 3, feetY: 0 }, [wall])).toBe(false)
  })
})
