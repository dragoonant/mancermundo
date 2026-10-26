import { describe, expect, it } from 'vitest'
import { replay } from '@/engine'
import { checkInvariants, MAX_DECISIONS, MAX_ROUNDS, playGame, runSim, STALL_LIMIT } from '../../tools/sim-core'
import { realSetupFor, SCENARIOS } from '../../tools/sim-setup'
import { barricadePair, bundleWith, corridorWithDoor, ductwayWall, openBox } from '../fixtures/boards'
import { makeSetup } from '../fixtures/gang'
import { boardsFor, realBundle, realSetup } from '../fixtures/real'

const SLOW = 240_000

describe('SIM: seeded random-bot games keep every invariant', () => {
  it('SIM-001 real Goliath and Escher gangs play all three scenarios to their end with no round limit and no violation, rejection or stall', { timeout: SLOW }, () => {
    const bundle = realBundle()
    expect(boardsFor(bundle, 'scn.tunnel-skirmish').length).toBeGreaterThanOrEqual(3)
    const report = runSim({ games: 3, seed: 'sim-test', bundle, setupFor: realSetupFor(bundle, SCENARIOS, undefined) })
    expect(report.failing.map((f) => `${f.seed}: ${f.violations.map((v) => v.message).join('; ')}`)).toEqual([])
    expect(report.completed).toBe(report.games)
    expect(report.rejections).toBe(0)
    expect(report.stats.activations).toBeGreaterThan(100)
    // every game ended by its scenario (or a conceded locked win), inside the round and decision bounds
    for (const s of report.summaries) {
      expect(['scenario', 'concede']).toContain(s.reason)
      expect(s.rounds).toBeLessThanOrEqual(MAX_ROUNDS)
      expect(s.decisions).toBeLessThanOrEqual(MAX_DECISIONS)
      expect(s.winner).not.toBeNull()
    }
    expect(new Set(report.summaries.map((s) => s.scenarioId))).toEqual(new Set(SCENARIOS))
    // the End phase and the scenarios were exercised: Bottle tests were taken and both casket scenarios placed their caskets
    const st = report.stats
    expect((st['bottle:held'] ?? 0) + (st['bottle:rolled'] ?? 0) + (st['bottle:voluntary'] ?? 0)).toBeGreaterThan(0)
    expect(st.casketsPlaced).toBe(10)
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

  it('SIM-003 a game replays to identical hashes; a short game ends with reason roundLimit', () => {
    const bundle = realBundle()
    const setup = realSetup({ options: { maxRounds: 2 } })
    const r = playGame(setup, bundle, 'replay-seed')
    expect(r.violations).toEqual([])
    expect(r.ended).toBe(true)
    expect(r.rounds).toBeLessThanOrEqual(2)
    const rep = replay(setup, 'replay-seed', r.actions, bundle)
    expect(rep.failedAt).toBeUndefined()
    expect(rep.hashes[rep.hashes.length - 1]).toBe(rep.state.hash)
    expect(['roundLimit', 'scenario']).toContain(rep.state.result!.reason)
    // a full game with no cap replays too
    const full = realSetup({ scenarioId: 'scn.smash-and-grab' })
    const g = playGame(full, bundle, 'full-replay')
    expect(g.violations).toEqual([])
    const again = replay(full, 'full-replay', g.actions, bundle)
    expect(again.failedAt).toBeUndefined()
    expect(again.state.result).toEqual(replay(full, 'full-replay', g.actions, bundle).state.result)
  })

  it('SIM-004 the invariant checker flags what it is meant to flag', () => {
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

  it('SIM-005 the End phase invariants: a bottled gang that recovers, points that fall, a battle that outlasts 20 rounds and a fighter back from the dead are reported', () => {
    const bundle = realBundle()
    const r = playGame(realSetup(), bundle, 'end-inv')
    expect(r.violations).toEqual([])
    const prev = replay(realSetup(), 'end-inv', r.actions.slice(0, 60), bundle).state
    const next = (edit: (d: typeof prev) => void) => {
      const d = structuredClone(prev)
      d.seq = prev.seq + 1
      edit(d)
      return checkInvariants(prev, d, prev.log[0]!, [])
    }
    const was = structuredClone(prev)
    was.players.A.bottled = true
    was.players.A.points = 4
    was.fighters[Object.keys(was.fighters)[0]!]!.location = 'fled'
    const bad = structuredClone(was)
    bad.seq = was.seq + 1
    bad.players.A.bottled = false
    bad.players.A.points = 3
    bad.fighters[Object.keys(bad.fighters)[0]!]!.location = 'board'
    const msgs = checkInvariants(was, bad, was.log[0]!, [])
    expect(msgs.some((m) => m.startsWith('END-002'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('SCORE'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('STATUS'))).toBe(true)
    expect(next((d) => (d.round = MAX_ROUNDS + 1)).some((m) => m.startsWith('SIM-003'))).toBe(true)
    // the bounds the gates promise
    expect(MAX_ROUNDS).toBe(20)
    expect(MAX_DECISIONS).toBe(4000)
    expect(STALL_LIMIT).toBe(200)
  })
})
