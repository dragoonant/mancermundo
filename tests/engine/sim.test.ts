import { describe, expect, it } from 'vitest'
import { flatMap, terrainMap } from '../fixtures/maps'
import { makeSetup, testBundle } from '../fixtures/team'
import { playGame, runSim, setupFor } from '../../tools/sim-core'

describe('SIM invariants', () => {
  it('SIM-003 twenty seeded games end within four turning points with no violations, no rejections and matching replay hashes', () => {
    const report = runSim({ games: 20, seed: 'sim-test', setupFor, bundle: testBundle })
    expect(report.failing.map((g) => g.violations)).toEqual([])
    expect(report.completed).toBe(20)
    expect(report.rejections).toBe(0)
  }, 120000)

  it('SIM-001 fuzz: the legal set is never empty and every listed action validates, on large rosters and terrain', () => {
    for (let i = 0; i < 4; i++) {
      const setup = makeSetup({ map: i % 2 ? terrainMap() : flatMap(), sizeA: 10, sizeB: 6 })
      const g = playGame(setup, testBundle, `fuzz-${i}`)
      expect(g.violations).toEqual([])
      expect(g.ended).toBe(true)
      expect(g.turningPoints).toBe(4)
    }
  }, 120000)

  it('SIM-006 the same seed gives the same actions and the same final state', () => {
    const a = playGame(makeSetup({ map: terrainMap() }), testBundle, 'repeat')
    const b = playGame(makeSetup({ map: terrainMap() }), testBundle, 'repeat')
    expect(JSON.stringify(a.actions)).toBe(JSON.stringify(b.actions))
    const c = playGame(makeSetup({ map: terrainMap() }), testBundle, 'other')
    expect(JSON.stringify(c.actions)).not.toBe(JSON.stringify(a.actions))
  })
})
