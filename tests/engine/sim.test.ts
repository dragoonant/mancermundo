import { describe, expect, it } from 'vitest'
import { flatMap, terrainMap } from '../fixtures/maps'
import { makeSetup, testBundle } from '../fixtures/team'
import { checkInvariants, playGame, runSim, setupFor } from '../../tools/sim-core'
import { edit, openReal, opOf } from '../fixtures/real'
import type { Action, GameEvent } from '@/engine'

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

  it('SIM-008 VP may fall only by the kill op VP a returning operative takes back; ORD-002 checks the weapon fired under Conceal', () => {
    const s = openReal()
    const ev = (e: Record<string, unknown>) => ({ seq: s.seq + 1, turningPoint: 1, phase: 'firefight', ...e }) as unknown as GameEvent
    const act = { type: 'pass', seat: 'A', decisionId: 'd:0', payload: {} } as unknown as Action
    const prev = edit(s, (x) => {
      x.players.A.vp = 3
    })
    const next = edit(prev, (x) => {
      x.players.A.vp = 2
      x.seq = prev.seq + 1
    })
    const vp = (events: GameEvent[]) => checkInvariants(prev, next, act, events).filter((v) => v.startsWith('vp'))
    expect(vp([])).toHaveLength(1)
    expect(vp([ev({ type: 'OperativeReturned', operativeId: 'B1', seat: 'B' }), ev({ type: 'VpScored', amount: -1, vp: 2, ruleId: 'k', seat: 'A' })])).toEqual([])
    expect(vp([ev({ type: 'VpScored', amount: -1, vp: 2, ruleId: 'k', seat: 'A' })])).toHaveLength(1) // no return
    // ORD-002: a Conceal shooter firing a non-Silent weapon is flagged on the ShootStarted step only
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const hidden = edit(next, (x) => {
      x.operatives[w]!.order = 'conceal'
    })
    const weapon = hidden.operatives[w]!.weapons.find((id) => hidden.data.weapons[id]?.type === 'ranged' && !hidden.data.weapons[id]!.rules.some((r) => /silent$/.test(r.rule)))!
    const ord = (events: GameEvent[]) => checkInvariants(prev, hidden, act, events).filter((v) => v.startsWith('ORD-002'))
    expect(ord([ev({ type: 'ShootStarted', operativeId: w, weaponId: weapon, seat: 'A' })])).toHaveLength(1)
    expect(ord([])).toEqual([])
  })

  it('SIM-009 MOVE: a forced move (pushes, Timesplinter) may end in an enemy control range; an own move may not', () => {
    const s = openReal()
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    const next = edit(s, (x) => {
      x.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      x.operatives[boy]!.pos = { x: 1.6, y: 0, z: 0 }
      x.seq = s.seq + 1
    })
    const act = { type: 'pass', seat: 'B', decisionId: 'd:0', payload: {} } as unknown as Action
    const moved = (action: string) =>
      ({ type: 'OperativeMoved', seq: next.seq, turningPoint: 1, phase: 'firefight', seat: 'B', operativeId: boy, action, from: { x: 4, y: 0, z: 0 }, to: { x: 1.6, y: 0, z: 0 }, segments: [], cost: 0, maxInches: 3 }) as unknown as GameEvent
    const move = (action: string) => checkInvariants(s, next, act, [moved(action)]).filter((v) => v.startsWith('MOVE:'))
    expect(move('reposition')).toHaveLength(1)
    expect(move('forced')).toEqual([])
    expect(move('timesplinter')).toEqual([])
  })
})
