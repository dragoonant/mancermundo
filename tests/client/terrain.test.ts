// Terrain GLBs: every model slug used by a killzone layout has a manifest entry and a file on disk, the rules
// footprint of a slug is identical in every piece and layout (the GLB is fitted once per slug), and the fit and
// see-through helpers behave.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAYOUT_FILES, fitScale, pieceFootprint, pieceMeta, pieceOccludes, segmentHitsBox, toLocal, type TerrainEntry } from '@/client/board/terrainGlb'

const modelsDir = resolve(__dirname, '../../public/assets/models')
const manifest = JSON.parse(readFileSync(resolve(modelsDir, 'manifest.json'), 'utf8')) as { terrain?: Record<string, TerrainEntry> }
const terrain = manifest.terrain ?? {}
const pieces = LAYOUT_FILES.flatMap((l) => l.pieces.map((p) => ({ layout: l.id, piece: p })))
const slugs = [...new Set(pieces.map((p) => p.piece.model))]

describe('terrain GLBs', () => {
  it('layouts use terrain slugs', () => {
    expect(LAYOUT_FILES).toHaveLength(3)
    expect(slugs.length).toBeGreaterThanOrEqual(6)
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

  it('the footprint of a slug is the same in every piece and layout, centred on pos, and matches the manifest', () => {
    const bySlug = new Map<string, ReturnType<typeof pieceFootprint>>()
    for (const { layout, piece } of pieces) {
      const fp = pieceFootprint(piece)
      expect(Math.abs(fp.cx), `${layout}/${piece.id} centre x`).toBeLessThan(0.01)
      expect(Math.abs(fp.cz), `${layout}/${piece.id} centre z`).toBeLessThan(0.01)
      const ref = bySlug.get(piece.model)
      if (!ref) bySlug.set(piece.model, fp)
      else expect({ w: fp.w, d: fp.d, h: fp.h }, `${layout}/${piece.id} ${piece.model}`).toEqual({ w: ref.w, d: ref.d, h: ref.h })
    }
    for (const [slug, fp] of bySlug) {
      const e = terrain[slug]!
      expect(e.footprint.w).toBeCloseTo(fp.w, 2)
      expect(e.footprint.d).toBeCloseTo(fp.d, 2)
      expect(e.heightIn).toBeCloseTo(fp.h, 2)
      const s = fitScale(e, fp)
      for (const k of s) expect(k).toBeCloseTo(1, 2)
    }
  })

  it('pieceMeta finds the placement of an engine feature id', () => {
    const m = pieceMeta('kz.volkus-01', 'p01')
    expect(m).toEqual({ model: 't-large-ruin', pos: { x: -4.75, z: -4.75 }, yaw: 180 })
    expect(pieceMeta('kz.volkus-01', 'nope')).toBeNull()
  })

  it('toLocal inverts rotation.y = yaw', () => {
    // three.js: local +x rotated by yaw 90 points to world -z
    const l = toLocal({ x: 0, z: -1 }, { x: 0, z: 0 }, 90)
    expect(l.x).toBeCloseTo(1)
    expect(l.z).toBeCloseTo(0)
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
