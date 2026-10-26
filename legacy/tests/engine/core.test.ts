import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { ENGINE_VERSION, load, replay, save, step, undo, validate, legalActions, EngineInvariantError } from '@/engine'
import { SeededRng, sha256Hex } from '@/engine/rng'
import { createGame } from '@/engine'
import { cloneState } from '@/engine/state'
import type { GameState } from '@/engine/types'
import { drive, newGame } from '../fixtures/helpers'
import { makeSetup, testBundle } from '../fixtures/team'

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

describe('CORE determinism and plumbing', () => {
  it('CORE-001 the same seed gives the same dice and a restored stream continues identically', () => {
    const a = SeededRng.fromSeed('seed-1')
    const b = SeededRng.fromSeed('seed-1')
    const first = Array.from({ length: 30 }, () => a.d6())
    expect(Array.from({ length: 30 }, () => b.d6())).toEqual(first)
    const saved = a.serialize()
    const next = Array.from({ length: 10 }, () => a.d6())
    const c = SeededRng.restore(saved)
    expect(Array.from({ length: 10 }, () => c.d6())).toEqual(next)
    expect(SeededRng.fromSeed('seed-2').d6()).toBeGreaterThanOrEqual(1)
    // uniformity: every face within 1.5 percentage points over 12000 rolls
    const r = SeededRng.fromSeed('uniform')
    const counts = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 12000; i++) counts[r.d6() - 1]!++
    for (const n of counts) expect(Math.abs(n / 12000 - 1 / 6)).toBeLessThan(0.015)
  })

  it('CORE-002 the pure sha256 matches node:crypto', () => {
    for (const text of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(200), 'café ✓ seed']) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'))
    }
  })

  it('CORE-003 step is pure: the input state is not mutated and the result is repeatable', () => {
    const s0 = newGame().state
    const frozen = deepFreeze(JSON.parse(JSON.stringify(s0)) as GameState)
    const action = legalActions(frozen)![0]!
    const r1 = step(frozen, action)
    const r2 = step(frozen, action)
    expect(r1.rejection).toBeUndefined()
    expect(r1.state.hash).toBe(r2.state.hash)
    expect(r1.state.hash).not.toBe(frozen.hash)
    expect(r1.state.log).toHaveLength(1)
    expect(frozen.log).toHaveLength(0)
  })

  it('CORE-004 a rejection returns the same state reference and leaves the pending decision unchanged', () => {
    const s = newGame().state
    const wrongSeat = step(s, { ...act.rollOff({ id: s.pending!.id, seat: 'B' }) })
    expect(wrongSeat.rejection?.code).toBe('E_WRONG_SEAT')
    expect(wrongSeat.state).toBe(s)
    expect(wrongSeat.pending).toBe(s.pending)
    expect(wrongSeat.events.map((e) => e.type)).toEqual(['ActionRejected'])
    expect(step(s, { ...act.rollOff(s.pending!), decisionId: 'd:99' }).rejection?.code).toBe('E_WRONG_DECISION')
    expect(step(s, act.pass(s.pending!)).rejection?.code).toBe('E_PASS_NOT_ALLOWED')
    expect(validate(s, act.rollOff(s.pending!))).toBeNull()
    expect(() => step(s, null as never)).not.toThrow()
  })

  it('CORE-005 replay reproduces the hash at every seq; save, load and undo round-trip', () => {
    const setup = makeSetup()
    const s = drive(newGame(setup, 'core-5').state, (st) => st.log.length >= 40)
    const rep = replay(setup, 'core-5', s.log, testBundle)
    expect(rep.rejection).toBeUndefined()
    expect(rep.hashes).toHaveLength(s.log.length + 1)
    expect(rep.state.hash).toBe(s.hash)
    const file = JSON.parse(JSON.stringify(save(s)))
    expect(load(file, testBundle).state.hash).toBe(s.hash)
    expect(file.engineVersion).toBe(ENGINE_VERSION)
    expect(() => load({ ...file, finalHash: 'deadbeef' }, testBundle)).toThrow(EngineInvariantError)
    // the first action is the setup roll-off, which rolled dice, so undo of a 1-action game is refused
    const one = step(newGame(setup, 'core-5').state, legalActions(newGame(setup, 'core-5').state)![0]!).state
    expect(undo(one, testBundle)).toBeNull()
    // the 4th action is a drop zone choice (no dice): undo returns the state before it
    let t = newGame(setup, 'core-5').state
    t = drive(t, (st) => st.pending?.kind === 'setup.dropZone')
    const before = t
    const after = step(t, legalActions(t)![0]!).state
    expect(undo(after, testBundle)!.state.hash).toBe(before.hash)
  })

  it('CORE-006 an invalid setup throws EngineInvariantError instead of building a game', () => {
    const bad = makeSetup()
    bad.rosters.A = [{ datacardId: 'nope' }]
    expect(() => createGame(bad, 's', testBundle)).toThrow(EngineInvariantError)
    const s = newGame().state
    expect(cloneState(s).map).toBe(s.map)
    expect(cloneState(s)).not.toBe(s)
  })
})
