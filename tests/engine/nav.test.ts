import { describe, expect, it } from 'vitest'
import { fitBases, initialDoors, standardRegions, withDoor } from '@/engine/board'
import { navFor, routeLength, shortestRoute, straightClear, sweepBlocked, MEASURE_R } from '@/engine/nav'
import { corridorWithDoor, makeBoard, openBox } from '../fixtures/boards'
import { realBundle } from '../fixtures/real'

const R = 0.492

describe('nav: shortest legal routes', () => {
  it('goes straight across an open floor', () => {
    const def = openBox()
    const nav = navFor(def, initialDoors(def), R)
    const route = shortestRoute(nav, { x: -5, z: -10 }, { x: 6, z: 12 })!
    expect(route.path).toHaveLength(2)
    expect(route.length).toBeCloseTo(Math.hypot(11, 22), 6)
  })

  it('goes round a wall by its corner and every leg passes the sweep test', () => {
    const def = makeBoard({ id: 'wall', walls: [{ a: { x: -12, z: 0 }, b: { x: 4, z: 0 } }] })
    const nav = navFor(def, initialDoors(def), R)
    const a = { x: 0, z: -3 }
    const b = { x: 0, z: 3 }
    const route = shortestRoute(nav, a, b)!
    expect(route.path.length).toBeGreaterThan(2)
    expect(route.length).toBeGreaterThan(6)
    for (let i = 0; i + 1 < route.path.length; i++) expect(sweepBlocked(nav.blockers, route.path[i]!, route.path[i + 1]!, R)).toBe(false)
    expect(straightClear(nav, a, b)).toBe(false)
    // a point-like disc takes a slightly shorter way round the same corner
    const point = navFor(def, initialDoors(def), MEASURE_R)
    expect(routeLength(point, a, b)).toBeLessThan(route.length + 1e-9)
    // symmetric
    expect(routeLength(nav, b, a)).toBeCloseTo(route.length, 6)
  })

  it('a closed door is a wall and an open one is a gap; the graph is cached per door state', () => {
    const def = corridorWithDoor()
    const closed = initialDoors(def)
    const open = withDoor(closed, 'door1', { state: 'open' })
    const a = { x: 0, z: -3 }
    const b = { x: 0, z: 3 }
    expect(routeLength(navFor(def, closed, R), a, b)).toBe(Infinity)
    expect(routeLength(navFor(def, open, R), a, b)).toBeCloseTo(6, 6)
    expect(navFor(def, closed, R)).toBe(navFor(def, { ...closed }, R))
    expect(navFor(def, open, R)).not.toBe(navFor(def, closed, R))
  })

  it('a doorway narrower than the base is not a way through', () => {
    const def = makeBoard({
      id: 'narrow',
      walls: [
        { a: { x: -12, z: 0 }, b: { x: -0.4, z: 0 } },
        { a: { x: 0.4, z: 0 }, b: { x: 12, z: 0 } },
      ],
    })
    expect(routeLength(navFor(def, initialDoors(def), R), { x: 0, z: -3 }, { x: 0, z: 3 })).toBe(Infinity)
    expect(routeLength(navFor(def, initialDoors(def), 0.2), { x: 0, z: -3 }, { x: 0, z: 3 })).toBeCloseTo(6, 6)
  })

  it('avoid discs push the route round an enemy and are optional', () => {
    const def = openBox()
    const nav = navFor(def, initialDoors(def), R)
    const a = { x: -4, z: 0 }
    const b = { x: 4, z: 0 }
    const direct = shortestRoute(nav, a, b)!
    expect(direct.length).toBeCloseTo(8, 6)
    const around = shortestRoute(nav, a, b, [{ c: { x: 0, z: 0 }, r: 1.5 }])!
    expect(around.length).toBeGreaterThan(8)
    expect(around.path.length).toBeGreaterThan(2)
    // an unreachable end inside the disc is not found
    expect(shortestRoute(nav, a, { x: 0, z: 0 }, [{ c: { x: 0, z: 0 }, r: 1.5 }])).toBeNull()
  })

  it('every shipped board can be crossed between its deployment halves without opening a locked door', () => {
    const bundle = realBundle()
    for (const def of Object.values(bundle.boards)) {
      const doors = initialDoors(def)
      let open = doors
      for (const d of def.doors) if (!d.lockedAtStart) open = withDoor(open, d.id, { state: 'open' })
      const nav = navFor(def, open, R)
      const reg = standardRegions(def, 12)
      const from = fitBases(def, doors, reg.low, R, 1)[0]!
      const to = fitBases(def, doors, reg.high, R, 1)[0]!
      const len = routeLength(nav, from, to)
      expect(Number.isFinite(len), def.id).toBe(true)
      // closed doors really are walls: with every door shut the same trip is at least as long
      expect(routeLength(navFor(def, doors, R), from, to)).toBeGreaterThanOrEqual(len - 1e-9)
    }
  })
})
