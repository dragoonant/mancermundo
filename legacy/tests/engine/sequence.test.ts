import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { createGame, legalActions, step, suggestPlacement } from '@/engine'
import { ScriptedRng } from '@/engine/rng'
import { availableGambits } from '@/engine/strategy'
import { cloneState } from '@/engine/state'
import type { GameEvent } from '@/engine/events'
import type { GameState } from '@/engine/types'
import { defaultAnswer, drive, expectOk, newGame, patchOp, toFirefight } from '../fixtures/helpers'
import { makeSetup, testBundle } from '../fixtures/team'
import { playGame } from '../../tools/sim-core'

const rolls = (...d: number[]) => new ScriptedRng(d)

function pick(state: GameState, id: string, rng?: ScriptedRng): GameState {
  const p = state.pending!
  const o = p.options!.find((x) => x.id === id)
  if (!o) throw new Error(`no option ${id} in ${p.kind}`)
  return expectOk(step(state, o.action, rng)).state
}

describe('SEQ game sequence', () => {
  it('SEQ-001 the roll-off winner decides setup initiative; drop zones alternate and must differ', () => {
    let s = newGame().state
    // A rolls 2, B rolls 5 -> B wins and decides; ties re-roll first
    const dice = rolls(3, 3, 2, 5)
    s = expectOk(step(s, legalActions(s)![0]!, dice)).state
    s = expectOk(step(s, legalActions(s)![0]!, dice)).state
    expect(s.setup.rolls).toEqual({}) // tie: both roll again
    expect(s.pending).toMatchObject({ kind: 'setup.initiative', seat: 'A' })
    s = expectOk(step(s, legalActions(s)![0]!, dice)).state
    s = expectOk(step(s, legalActions(s)![0]!, dice)).state
    expect(s.pending).toMatchObject({ kind: 'setup.decideInitiative', seat: 'B' })
    s = pick(s, 'A') // the winner gives initiative to the opponent
    expect(s.initiative).toBe('A')
    expect(s.pending).toMatchObject({ kind: 'setup.dropZone', seat: 'A' })
    s = pick(s, 'north')
    expect(s.pending).toMatchObject({ kind: 'setup.dropZone', seat: 'B' })
    expect(s.pending!.options!.map((o) => o.id)).toEqual(['south'])
    const dup = step(s, act.dropZone(s.pending!, 'north'))
    expect(dup.rejection?.code).toBe('E_NOT_AN_OPTION')
    s = pick(s, 'south')
    expect(s.players.A.dropZoneId).toBe('north')
    expect(s.players.B.dropZoneId).toBe('south')
    expect(s.pending).toMatchObject({ kind: 'setup.deploy', seat: 'A' })
  })

  it('SEQ-002 selecting operatives gives each player 2 CP; a fifth or repeated equipment option is rejected', () => {
    expect(newGame().state.players.A.cp).toBe(2)
    expect(newGame().state.players.B.cp).toBe(2)
    const five = makeSetup({ equipment: { A: ['e1', 'e2', 'e3', 'e4', 'e5'], B: [] } })
    expect(() => createGame(five, 's', testBundle)).toThrow(/equipment/)
    const dup = makeSetup({ equipment: { A: ['e1', 'e1'], B: [] } })
    expect(() => createGame(dup, 's', testBundle)).toThrow(/repeated/)
    const four = makeSetup({ equipment: { A: ['e1', 'e2', 'e3', 'e4'], B: ['e1'] } })
    expect(createGame(four, 's', testBundle).state.players.A.equipment).toHaveLength(4)
  })

  it('SEQ-003 a 6-operative roster sets up 2/2/2 and a 10-operative roster 4/4/2, alternating from the setup-initiative player', () => {
    for (const [size, expected] of [
      [6, [2, 2, 2, 2, 2, 2]],
      [10, [4, 4, 4, 4, 2, 2]],
    ] as const) {
      let s = newGame(makeSetup({ sizeA: size, sizeB: size }), `batch-${size}`).state
      s = drive(s, (st) => st.pending?.kind === 'setup.deploy', 100, rolls(6, 1))
      const first = s.pending!.seat
      const runs: { seat: string; n: number }[] = []
      while (s.pending?.kind === 'setup.deploy') {
        const seat = s.pending.seat
        if (runs.length && runs[runs.length - 1]!.seat === seat) runs[runs.length - 1]!.n++
        else runs.push({ seat, n: 1 })
        s = expectOk(step(s, defaultAnswer(s))).state
      }
      expect(runs.map((r) => r.n)).toEqual([...expected])
      expect(runs[0]!.seat).toBe(first)
      expect(runs.map((r) => r.seat)).toEqual(runs.map((_, i) => (i % 2 === 0 ? first : first === 'A' ? 'B' : 'A')))
    }
  })

  it('SEQ-004 an operative set up outside the drop zone is rejected; a set-up operative has a Conceal order', () => {
    let s = drive(newGame().state, (st) => st.pending?.kind === 'setup.deploy', 100, rolls(6, 1))
    const p = s.pending!
    const id = p.constraints!.operativeIds![0]!
    const zone = s.map.dropZones.find((z) => z.id === s.players[p.seat].dropZoneId)!
    const outside = step(s, act.deploy(p, id, 0, 0))
    expect(outside.rejection?.code).toBe('E_OUT_OF_RANGE')
    const edge = zone.polygon[0]!.z === -11 ? -8.2 : 8.2 // base would straddle the inner edge of the zone
    expect(step(s, act.deploy(p, id, 0, edge)).rejection?.code).toBe('E_OUT_OF_RANGE')
    const spot = suggestPlacement(s, p)!
    s = expectOk(step(s, act.deploy(p, spot.operativeId, spot.x, spot.z))).state
    expect(s.operatives[id]!.order).toBe('conceal')
    expect(s.operatives[id]!.status).toBe('active')
  })

  it('SEQ-005 a tied Initiative roll is decided by the player who did not previously hold initiative', () => {
    let s = drive(newGame().state, (st) => st.pending?.kind === 'strategy.initiative', 100, rolls(6, 1)) // A holds setup initiative
    expect(s.initiative).toBe('A')
    const dice = rolls(3, 3)
    s = expectOk(step(s, legalActions(s)![0]!, dice)).state
    s = expectOk(step(s, legalActions(s)![0]!, dice)).state
    expect(s.pending).toMatchObject({ kind: 'strategy.decideInitiative', seat: 'B' })
    s = pick(s, 'B')
    expect(s.initiative).toBe('B')
  })

  it('SEQ-006 CP: TP1 both +1; later the player without initiative gains 2 and the other 1; CP carry over', () => {
    const events: GameEvent[] = []
    let s = drive(newGame().state, (st) => st.pending?.kind === 'strategy.initiative', 100, rolls(6, 1), events)
    s = drive(s, (st) => st.turningPoint === 2 && st.pending?.kind === 'strategy.initiative', 400, rolls(6, 1, 6, 1), events)
    const cp = (tp: number, seat: string) =>
      events.filter((e) => e.type === 'CpChanged' && e.turningPoint === tp && e.seat === seat && e.reason === 'strategy')
    expect(cp(1, 'A').map((e) => (e as { delta: number }).delta)).toEqual([1])
    expect(cp(1, 'B').map((e) => (e as { delta: number }).delta)).toEqual([1])
    expect(s.players.A.cp).toBe(3)
    s = drive(s, (st) => st.pending?.kind === 'firefight.activate', 20, rolls(6, 1), events)
    const initiative = s.initiative!
    const other = initiative === 'A' ? 'B' : 'A'
    expect((cp(2, initiative)[0] as { delta: number }).delta).toBe(1)
    expect((cp(2, other)[0] as { delta: number }).delta).toBe(2)
    expect(s.players[other].cp).toBe(3 + 2)
  })

  it('SEQ-007 the Gambit step alternates and ends only after two consecutive passes; a pass does not bar a later gambit', () => {
    let s = drive(newGame().state, (st) => st.pending?.kind === 'strategy.gambit', 100, rolls(6, 1, 6, 1))
    const first = s.pending!.seat
    const second = first === 'A' ? 'B' : 'A'
    expect(s.pending!.canPass).toBe(true)
    s = expectOk(step(s, act.pass(s.pending!))).state // first passes
    expect(s.pending).toMatchObject({ kind: 'strategy.gambit', seat: second })
    s = pick(s, 'test.gambit') // the opponent uses one: passes reset
    expect(s.pending).toMatchObject({ kind: 'strategy.gambit', seat: first }) // the earlier pass did not bar this
    s = expectOk(step(s, act.pass(s.pending!))).state
    // second has used their one gambit, so they pass implicitly: two passes in succession end the step
    expect(s.pending!.kind).toBe('firefight.activate')
    expect(s.strategy.step).toBe('done')
  })

  it('SEQ-008 a gambit cannot be used twice in one TP or with 0 CP', () => {
    let s = drive(newGame().state, (st) => st.pending?.kind === 'strategy.gambit', 100, rolls(6, 1, 6, 1))
    const first = s.pending!.seat
    expect(availableGambits(s, first).map((g) => g.id)).toEqual(['test.gambit'])
    const broke = cloneState(s)
    broke.players[first].cp = 0
    expect(availableGambits(broke, first)).toEqual([])
    expect(step(broke, s.pending!.options![0]!.action).rejection?.code).toBe('E_INSUFFICIENT_CP')
    s = pick(s, 'test.gambit')
    expect(s.strategy.gambit.used[first]).toEqual(['test.gambit'])
    expect(availableGambits(s, first)).toEqual([])
    expect(s.players[first].cp).toBe(2)
  })

  it('SEQ-009 the battle ends after TP4 and a player with no operatives left does not stop the other', () => {
    const report = playGame(makeSetup(), testBundle, 'seq-9')
    expect(report.violations).toEqual([])
    expect(report.ended).toBe(true)
    expect(report.turningPoints).toBe(4)
    // seat A loses every operative before the Firefight: B plays the turning points out alone
    let s = drive(newGame().state, (st) => st.pending?.kind === 'strategy.initiative', 100)
    for (const o of Object.values(s.operatives)) if (o.seat === 'A') s = patchOp(s, o.id, { status: 'removed' })
    s = drive(s, (st) => st.phase === 'ended', 2000)
    expect(s.turningPoint).toBe(4)
    expect(s.result).toMatchObject({ reason: 'turningPoint', placeholder: true })
    expect(s.pending).toBeNull()
    const again = step(s, act.pass({ id: 'd:0', seat: 'A' }))
    expect(again.rejection?.code).toBe('E_GAME_OVER')
  })

  it('SEQ-010 Guard status ends at the start of the next TP, before the Strategy phase', () => {
    const events: GameEvent[] = []
    let s = toFirefight()
    s = patchOp(s, 'A1', { order: 'engage', flags: { ...s.operatives['A1']!.flags, guard: true } })
    s = drive(s, (st) => st.turningPoint === 2 && st.pending?.kind === 'strategy.initiative', 400, undefined, events)
    expect(s.operatives['A1']!.flags.guard).toBe(false)
    const cleared = events.findIndex((e) => e.type === 'GuardCleared' && e.reason === 'turningPoint')
    const strategyStart = events.findIndex((e) => e.type === 'PhaseStarted' && e.name === 'strategy' && e.turningPoint === 2)
    expect(cleared).toBeGreaterThanOrEqual(0)
    expect(cleared).toBeLessThan(strategyStart)
  })
})
