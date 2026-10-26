import { describe, expect, it } from 'vitest'
import { act, createGame, EngineInvariantError, legalActions, replay, step, validate } from '@/engine'
import type { GameSetup } from '@/engine'
import { makeSetup, testBundle } from '../fixtures/gang'

describe('engine smoke', () => {
  it('SMOKE-001 createGame is deterministic: the same setup and seed give the same hash, another seed does not', () => {
    const a = createGame(makeSetup(), 'seed-1', testBundle)
    const b = createGame(makeSetup(), 'seed-1', testBundle)
    const c = createGame(makeSetup(), 'seed-2', testBundle)
    expect(a.state.hash).toBe(b.state.hash)
    expect(a.state.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(a.state.hash).not.toBe(c.state.hash)
  })

  it('SMOKE-002 a new game builds both gangs and raises setup.role with two options for the roll-off winner', () => {
    const { state, pending, events } = createGame(makeSetup(), 'seed-1', testBundle)
    expect(Object.keys(state.fighters)).toHaveLength(10)
    expect(state.fighters.A1).toMatchObject({
      seat: 'A',
      role: 'leader',
      location: 'reserve',
      wounds: 2,
      rules: [{ id: 'core.r.group-activation', x: 2 }, { id: 'core.r.leading-by-example' }],
    })
    expect(state.phase).toBe('setup')
    expect(pending).toBe(state.pending)
    expect(pending?.kind).toBe('setup.role')
    expect(pending?.seat).toBe(state.setup.rollOff?.winner)
    expect(pending?.options).toHaveLength(2)
    expect(legalActions(state)).toHaveLength(2)
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['GameCreated', 'DiceRolled', 'DecisionRequested']))
    expect(events.find((e) => e.type === 'DiceRolled')).toMatchObject({ die: 'd6', final: true })
    // every offered option is a well-formed answer to this decision and passes validate
    for (const action of legalActions(state)!) {
      expect(action).toMatchObject({ type: 'setup.role', seat: pending!.seat, decisionId: pending!.id })
      expect(validate(state, action)).toBeNull()
    }
  })

  it('SMOKE-003 a rejected action returns the same state reference and one ActionRejected event', () => {
    const { state, pending } = createGame(makeSetup(), 'seed-1', testBundle)
    const wrongSeat = pending!.seat === 'A' ? 'B' : 'A'
    const wrong = step(state, { ...act.role(pending!, 'first'), seat: wrongSeat })
    expect(wrong.state).toBe(state)
    expect(wrong.rejection?.code).toBe('E_WRONG_SEAT')
    expect(wrong.events).toHaveLength(1)
    expect(wrong.events[0]).toMatchObject({ type: 'ActionRejected', code: 'E_WRONG_SEAT' })
    const stale = step(state, { ...act.role(pending!, 'first'), decisionId: 'd:99' })
    expect(stale.state).toBe(state)
    expect(stale.rejection?.code).toBe('E_WRONG_DECISION')
    const notOffered = step(state, act.role(pending!, 'attacker'))
    expect(notOffered.state).toBe(state)
    expect(notOffered.rejection?.code).toBe('E_NOT_AN_OPTION')
  })

  it('SMOKE-004 answering the role choice moves set-up on to the first crew or half decision', () => {
    const { state, pending } = createGame(makeSetup(), 'seed-1', testBundle)
    const r = step(state, act.role(pending!, 'first'))
    expect(r.rejection).toBeUndefined()
    expect(r.state).not.toBe(state)
    expect(r.pending?.kind).toBe('setup.zone')
    expect(r.state.setup.first).toBe(pending!.seat)
  })

  it('SMOKE-005 resigning ends the battle for the other seat and no further action is accepted', () => {
    const { state, pending } = createGame(makeSetup(), 'seed-1', testBundle)
    const r = step(state, act.resign(pending!, 'B'))
    expect(r.rejection).toBeUndefined()
    expect(r.state.phase).toBe('ended')
    expect(r.pending).toBeNull()
    expect(r.state.result).toMatchObject({ winner: 'A', reason: 'resign' })
    expect(r.events.map((e) => e.type)).toContain('GameEnded')
    expect(r.state.seq).toBe(1)
    expect(r.state.log).toHaveLength(1)
    const again = step(r.state, act.resign(pending!, 'A'))
    expect(again.rejection?.code).toBe('E_GAME_OVER')
    expect(again.state).toBe(r.state)
  })

  it('SMOKE-006 replay reproduces the hash after every action', () => {
    const { state, pending } = createGame(makeSetup(), 'seed-1', testBundle)
    const r = step(state, act.resign(pending!, 'A'))
    const rep = replay(makeSetup(), 'seed-1', r.state.log, testBundle)
    expect(rep.failedAt).toBeUndefined()
    expect(rep.hashes).toEqual([state.hash, r.state.hash])
    expect(rep.state.hash).toBe(r.state.hash)
  })

  it('SMOKE-007 an invalid setup throws EngineInvariantError', () => {
    const bad: GameSetup = makeSetup({ scenarioId: 'nope' })
    expect(() => createGame(bad, 's', testBundle)).toThrow(EngineInvariantError)
    const badFighter = makeSetup()
    badFighter.gangs.A.roster[0] = { ...badFighter.gangs.A.roster[0]!, typeId: 'nope' }
    expect(() => createGame(badFighter, 's', testBundle)).toThrow(/unknown fighter type/)
    const dup = makeSetup()
    dup.gangs.B.roster[0] = { ...dup.gangs.B.roster[0]!, id: 'A1' }
    expect(() => createGame(dup, 's', testBundle)).toThrow(/duplicate fighter id/)
  })
})
