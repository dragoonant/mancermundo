import { describe, expect, it } from 'vitest'
import { replay } from '@/engine'
import { checkInvariants, playGame, runSim } from '../../tools/sim-core'
import { barricadePair, bundleWith, corridorWithDoor, ductwayWall, openBox } from '../fixtures/boards'
import { makeSetup } from '../fixtures/gang'
import { boardsFor, realBundle, realSetup } from '../fixtures/real'

describe('SIM: seeded random-bot games keep every invariant', () => {
  it('SIM-001 real Goliath and Escher gangs play four rounds on every Tunnel Skirmish board without a violation, rejection or stall', () => {
    const bundle = realBundle()
    const boards = boardsFor(bundle, 'scn.tunnel-skirmish')
    expect(boards.length).toBeGreaterThanOrEqual(3)
    const report = runSim({
      games: boards.length * 2,
      seed: 'sim-test',
      bundle,
      setupFor: (g) => realSetup({ boardId: boards[g % boards.length]!, options: { maxRounds: 4 } }),
    })
    expect(report.failing.map((f) => `${f.seed}: ${f.violations.map((v) => v.message).join('; ')}`)).toEqual([])
    expect(report.completed).toBe(report.games)
    expect(report.rejections).toBe(0)
    expect(report.stats.activations).toBeGreaterThan(100)
  })

  it('SIM-002 fixture gangs on the door, barricade and ductway boards, ending by the round cap', () => {
    const boards = [openBox(), corridorWithDoor(), barricadePair(), ductwayWall()]
    const bundle = bundleWith(...boards)
    const report = runSim({
      games: 8,
      seed: 'fx',
      bundle,
      setupFor: (g) => makeSetup({ boardId: boards[g % boards.length]!.id, options: { maxRounds: 3 } }),
    })
    expect(report.failing).toEqual([])
    expect(report.completed).toBe(8)
  })

  it('SIM-003 a game replays to identical hashes and ends with reason roundLimit', () => {
    const bundle = realBundle()
    const setup = realSetup({ options: { maxRounds: 2 } })
    const r = playGame(setup, bundle, 'replay-seed')
    expect(r.violations).toEqual([])
    expect(r.ended).toBe(true)
    expect(r.rounds).toBe(2)
    const rep = replay(setup, 'replay-seed', r.actions, bundle)
    expect(rep.failedAt).toBeUndefined()
    expect(rep.state.result).toMatchObject({ reason: 'roundLimit' })
    expect(rep.hashes[rep.hashes.length - 1]).toBe(rep.state.hash)
  })

  it('the invariant checker flags what it is meant to flag', () => {
    const bundle = realBundle()
    const r = playGame(realSetup({ options: { maxRounds: 1 } }), bundle, 'inv')
    expect(r.violations).toEqual([])
    // overlapping bases and a Pinned Engaged fighter are reported
    const base = replay(realSetup({ options: { maxRounds: 1 } }), 'inv', r.actions.slice(0, 40), bundle).state
    const bad = structuredClone(base)
    const ids = Object.keys(bad.fighters)
    const placed = ids.filter((id) => bad.fighters[id]!.location === 'board')
    if (placed.length >= 2) {
      bad.fighters[placed[1]!]!.pos = { ...bad.fighters[placed[0]!]!.pos }
      bad.fighters[placed[0]!]!.engagedWith = [placed[1]!]
      bad.fighters[placed[0]!]!.posture = 'pinned'
      const msgs = checkInvariants(base, { ...bad, seq: base.seq + 1 }, base.log[0]!, [])
      expect(msgs.some((m) => m.startsWith('SIM-007'))).toBe(true)
      expect(msgs.some((m) => m.startsWith('STATUS'))).toBe(true)
    }
  })
})
