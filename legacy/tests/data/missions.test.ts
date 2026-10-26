import { describe, expect, it } from 'vitest'
import { killGradeFor, killGradeThresholds, loadBundle } from '../../src/data'
import { polygonArea } from '../../src/data/geometry'

const bundle = loadBundle()
const missions = Object.values(bundle.missions)
const secure = bundle.missions['mission.prelim-secure']

describe('missions', () => {
  it('kill grade lookup: 8 starting operatives gives [2,3,5,6,8]; table rows and clamping follow 11-missions.md', () => {
    expect(killGradeThresholds(secure, 8)).toEqual([2, 3, 5, 6, 8])
    expect(killGradeThresholds(secure, 5)).toEqual([1, 2, 3, 4, 5])
    expect(killGradeThresholds(secure, 6)).toEqual([1, 2, 4, 5, 6])
    expect(killGradeThresholds(secure, 11)).toEqual([2, 4, 7, 9, 11])
    expect(killGradeThresholds(secure, 14)).toEqual([3, 6, 8, 11, 14])
    // below 5 and above 14 clamp to the nearest row (RULING)
    expect(killGradeThresholds(secure, 3)).toEqual([1, 2, 3, 4, 5])
    expect(killGradeThresholds(secure, 20)).toEqual([3, 6, 8, 11, 14])
    const t = killGradeThresholds(secure, 8)
    expect([0, 1, 2, 3, 4, 5, 6, 8].map((n) => killGradeFor(t, n))).toEqual([0, 0, 1, 2, 2, 3, 4, 5])
    expect(Object.keys(secure.killOp.gradeTable)).toHaveLength(10)
  })

  it('three Preliminary Ops missions: four turning points, one crit op each, shared kill op, four equipment options', () => {
    expect(missions.map((m) => m.critOp).sort()).toEqual(['loot', 'secure', 'transmission'])
    expect(missions.map((m) => m.critOpRoll).sort()).toEqual([1, 2, 3])
    for (const m of missions) {
      expect(m.pack).toBe('preliminary-ops')
      expect(m.turningPoints).toBe(4)
      expect(m.equipmentLimit).toBe(4)
      expect(m.scoring.filter((s) => s.op === 'kill')).toHaveLength(2)
      expect(m.actions).toHaveLength(1)
      expect(m.objectiveSetup.markerMm).toBe(40)
      expect(m.objectiveSetup.steps).toHaveLength(3)
      expect(m.objectiveSetup.steps[0].constraints).toEqual({ onCentreline: true, minFromNeutralEdges: 2 })
      expect(m.objectiveSetup.steps[1].constraints).toMatchObject({ withinCentrelineInches: 3, minFromOtherMarkers: 5, whollyWithinTerritory: true })
    }
    const loot = bundle.missions['mission.prelim-loot'].scoring.find((s) => s.metric === 'lootPerformed')!
    expect(loot).toMatchObject({ vp: 1, maxPerTurningPoint: 2, fromTurningPoint: 2 })
  })

  it('maps prelim-1 and prelim-2 have the resolved drop zones, territories and centrelines', () => {
    for (const m of missions) {
      expect(m.maps.map((x) => x.id)).toEqual(['prelim-1', 'prelim-2'])
      const [m1, m2] = m.maps
      // map 1: short-edge strips 6 in deep, centreline x = 0
      expect(polygonArea(m1.dropZones.A)).toBe(6 * 22)
      expect(polygonArea(m1.dropZones.B)).toBe(6 * 22)
      expect(m1.dropZones.A.every((p) => p.x <= -9)).toBe(true)
      expect(m1.dropZones.B.every((p) => p.x >= 9)).toBe(true)
      expect(m1.centreline).toEqual({ a: { x: 0, z: -11 }, b: { x: 0, z: 11 } })
      expect(polygonArea(m1.territories.A)).toBe(15 * 22)
      // map 2: long-edge strips 3 in deep, centreline z = 0
      expect(polygonArea(m2.dropZones.A)).toBe(3 * 30)
      expect(polygonArea(m2.dropZones.B)).toBe(3 * 30)
      expect(m2.dropZones.A.every((p) => p.z <= -8)).toBe(true)
      expect(m2.dropZones.B.every((p) => p.z >= 8)).toBe(true)
      expect(m2.centreline).toEqual({ a: { x: -15, z: 0 }, b: { x: 15, z: 0 } })
      expect(polygonArea(m2.territories.B)).toBe(30 * 11)
      // seat A owns negative x / negative z
      expect(m1.playerEdges.A.a.x).toBe(-15)
      expect(m2.playerEdges.A.a.z).toBe(-11)
      // D6 map roll: 1-3 map 1, 4-6 map 2
      expect(m1.mapRoll).toEqual({ min: 1, max: 3 })
      expect(m2.mapRoll).toEqual({ min: 4, max: 6 })
    }
  })

  it('scoring rules reference the right windows and the universal mission actions exist', () => {
    const transmit = bundle.missions['mission.prelim-transmission']
    expect(transmit.scoring.filter((s) => s.op === 'crit').map((s) => s.cmp)).toEqual(['gte', 'gtEnemy'])
    expect(transmit.scoring.every((s) => s.op !== 'crit' || s.window === 'turningPoint.end')).toBe(true)
    for (const m of missions) for (const a of m.actions) expect(bundle.byId[a]).toBeDefined()
  })
})
