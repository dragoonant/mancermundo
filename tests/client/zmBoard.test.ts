// S2L: the lab's board drawing is derived from the compiled BoardDef. These tests cover the pure parts (no canvas, no WebGL):
// the merged bulkhead geometry (one mesh per wall material, faces wound outward, nothing outside the outline), door frames,
// deployment zones and the placement of two starter gangs, and the lenient body-manifest parser.
import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import { compileBoard, freeSpaceTest, initialDoors } from '../../src/engine/board'
import { pointInPolygon } from '../../src/engine/geometry'
import { WALL_HEIGHT, buildWallGeometry, doorFrame, doorLook, flatPolygonGeometry } from '../../src/client/board/zmGeometry'
import { baseRadiusOf, holds, placeGang, zonesFor } from '../../src/client/lab/placement'
import { bodyFor, parseBodies, slugOf } from '../../src/client/figures/bodyManifest'

const bundle = loadBundle()
const defs = Object.values(bundle.boards).map((b) => compileBoard(b, bundle.tiles))

describe('ZmBoard geometry', () => {
  it('there are boards to draw', () => {
    expect(defs.length).toBeGreaterThanOrEqual(5)
  })

  for (const def of defs) {
    describe(def.id, () => {
      const { sides, caps } = buildWallGeometry(def)

      it('draws every wall rectangle in exactly two merged meshes (sides and top caps), four faces and two triangles per wall', () => {
        expect(def.walls.every((w) => w.poly.length === 4)).toBe(true)
        expect(sides.getAttribute('position').count).toBe(def.walls.length * 4 * 6)
        expect(caps.getAttribute('position').count).toBe(def.walls.length * 2 * 3)
        expect(sides.getAttribute('uv').count).toBe(sides.getAttribute('position').count)
      })

      it('puts nothing outside the board outline and keeps the walls at wall height', () => {
        const m = 0.01
        for (const g of [sides, caps]) {
          g.computeBoundingBox()
          const b = g.boundingBox!
          expect(b.min.x).toBeGreaterThanOrEqual(def.bounds.minX - m - 0.25)
          expect(b.max.x).toBeLessThanOrEqual(def.bounds.maxX + m + 0.25)
          expect(b.min.z).toBeGreaterThanOrEqual(def.bounds.minZ - m - 0.25)
          expect(b.max.z).toBeLessThanOrEqual(def.bounds.maxZ + m + 0.25)
          expect(b.min.y).toBeCloseTo(g === sides ? 0 : WALL_HEIGHT, 5)
          expect(b.max.y).toBeCloseTo(WALL_HEIGHT, 5)
        }
      })

      it('winds every face outward: the triangle normal agrees with the vertex normal, which points away from the wall', () => {
        const pos = sides.getAttribute('position')
        const nor = sides.getAttribute('normal')
        let bad = 0
        for (let t = 0; t < pos.count; t += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => ({ x: pos.getX(t + k), y: pos.getY(t + k), z: pos.getZ(t + k) })) as [{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }]
          const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
          const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
          const gn = { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x }
          const vn = { x: nor.getX(t), y: nor.getY(t), z: nor.getZ(t) }
          if (gn.x * vn.x + gn.y * vn.y + gn.z * vn.z <= 0) bad++
          // the face belongs to wall t / 24 (four faces of six vertices): its normal points away from that wall's centre
          const own = def.walls[Math.floor(t / 24)]!.poly
          const cx = own.reduce((n, q) => n + q.x, 0) / own.length
          const cz = own.reduce((n, q) => n + q.z, 0) / own.length
          const mx = (a.x + b.x + c.x) / 3
          const mz = (a.z + b.z + c.z) / 3
          if (vn.x * (mx - cx) + vn.z * (mz - cz) <= 0) bad++
        }
        expect(bad).toBe(0)
        const cp = caps.getAttribute('position')
        for (let t = 0; t < cp.count; t += 3) {
          const ux = cp.getX(t + 1) - cp.getX(t)
          const uz = cp.getZ(t + 1) - cp.getZ(t)
          const vx = cp.getX(t + 2) - cp.getX(t)
          const vz = cp.getZ(t + 2) - cp.getZ(t)
          // y component of (u x v) for flat triangles: uz*vx - ux*vz; up-facing means positive
          expect(uz * vx - ux * vz).toBeGreaterThan(0)
        }
      })

      it('has one door frame per door, centred in the outline, as long as its segment', () => {
        const frames = def.doors.map(doorFrame)
        expect(frames).toHaveLength(def.doors.length)
        frames.forEach((f, i) => {
          const d = def.doors[i]!
          expect(f.length).toBeCloseTo(Math.hypot(d.seg.b.x - d.seg.a.x, d.seg.b.z - d.seg.a.z), 5)
          expect(f.thickness).toBeGreaterThan(0.2)
          expect(def.outline.some((sq) => pointInPolygon(f.centre, sq))).toBe(true)
        })
      })

      it('deploys two starter gangs inside their zones, on free floor, without base overlaps', () => {
        const doors = initialDoors(def)
        const scenarioId = bundle.boards[def.id]!.scenarios.find((s) => bundle.scenarios[s])!
        const zones = zonesFor(def, bundle.scenarios[scenarioId]!.deployment)
        expect(zones.A.length).toBeGreaterThan(0)
        expect(zones.B.length).toBeGreaterThan(0)
        const gol = Object.values(bundle.starterGangs).find((g) => g.house === 'goliath')!
        const esc = Object.values(bundle.starterGangs).find((g) => g.house === 'escher')!
        const placed = [...placeGang(bundle, def, doors, gol, 'A', zones.A, { x: 0, z: 0 }), ...placeGang(bundle, def, doors, esc, 'B', zones.B, { x: 0, z: 0 })]
        expect(placed.length).toBeGreaterThanOrEqual(6)
        for (const f of placed) {
          const zone = f.seat === 'A' ? zones.A : zones.B
          expect(zone.some((poly) => pointInPolygon(f.pos, poly))).toBe(true)
          expect(freeSpaceTest(def, doors, f.baseRadius)(f.pos)).toBe(true)
        }
        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            const a = placed[i]!
            const b = placed[j]!
            expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(a.baseRadius + b.baseRadius)
          }
        }
      })
    })
  }

  it('flat polygon overlays are up-facing whichever way the polygon is wound', () => {
    const sq = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }]
    for (const poly of [sq, [...sq].reverse()]) {
      const p = flatPolygonGeometry(poly, 0.03).getAttribute('position')
      expect(p.count).toBe(6)
      for (let t = 0; t < p.count; t += 3) {
        const ux = p.getX(t + 1) - p.getX(t)
        const uz = p.getZ(t + 1) - p.getZ(t)
        const vx = p.getX(t + 2) - p.getX(t)
        const vz = p.getZ(t + 2) - p.getZ(t)
        expect(uz * vx - ux * vz).toBeGreaterThan(0)
      }
    }
  })

  it('doors are coloured by state: locked only matters while closed', () => {
    expect(doorLook({ state: 'closed', locked: false })).toBe('closed')
    expect(doorLook({ state: 'closed', locked: true })).toBe('locked')
    expect(doorLook({ state: 'open', locked: true })).toBe('open')
    expect(doorLook({ state: 'destroyed', locked: false })).toBe('destroyed')
  })
})

describe('lab figures', () => {
  it('derives base radius and hold classes from data', () => {
    expect(baseRadiusOf({ base: 32 })).toBeCloseTo(0.63, 2)
    const gol = Object.values(bundle.starterGangs).find((g) => g.house === 'goliath')!
    const leader = gol.fighters[0]!
    const h = holds(bundle, leader.weapons)
    expect(h.melee).not.toBeNull()
  })

  it('reads the model manifest leniently and picks a body by archetype', () => {
    expect(parseBodies(undefined)).toEqual({})
    expect(parseBodies('<html>')).toEqual({})
    expect(parseBodies({ bodies: { x: { nofile: 1 } } })).toEqual({})
    const m = parseBodies({ bodies: { 'goliath-ganger': { file: 'goliath-ganger.glb', facing: '-Z' } } })
    expect(bodyFor(m, 'goliath-ganger', 'A3')).toEqual({ slug: 'bodies/goliath-ganger', flip: true })
    expect(bodyFor(m, 'escher-ganger', 'B1')).toBeNull()
    expect(slugOf('bodies/x.glb')).toBe('bodies/x')
    const arr = parseBodies({ bodies: [{ file: 'a/b.glb', archetype: 'escher-leader' }] })
    expect(bodyFor(arr, 'escher-leader', 'B1')?.slug).toBe('a/b')
  })
})
