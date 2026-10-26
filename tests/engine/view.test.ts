import { describe, expect, it } from 'vitest'
import { createGame, view } from '@/engine'
import { makeSetup, testBundle } from '../fixtures/gang'

describe('VIEW per-seat redaction', () => {
  const s = createGame(makeSetup(), 'view-seed', testBundle).state

  it('VIEW-001 removes the RNG state and the action log and names the viewer', () => {
    const v = view(s, 'A')
    expect(v).not.toHaveProperty('rng')
    expect(v).not.toHaveProperty('log')
    expect(v.viewer).toBe('A')
    expect(view(s, 'B').viewer).toBe('B')
  })

  it('VIEW-002 N23 hides nothing else: every other part of the state is passed through by reference', () => {
    const v = view(s, 'B')
    expect(v.fighters).toBe(s.fighters)
    expect(v.board).toBe(s.board)
    expect(v.players).toBe(s.players)
    expect(v.pending).toBe(s.pending)
    expect(v.hash).toBe(s.hash)
    expect(Object.keys(v).sort()).toEqual(
      Object.keys(s)
        .filter((k) => k !== 'rng' && k !== 'log')
        .concat('viewer')
        .sort(),
    )
  })

  it('VIEW-003 building a view does not touch the state', () => {
    const before = JSON.stringify(s)
    view(s, 'A')
    expect(JSON.stringify(s)).toBe(before)
  })
})
