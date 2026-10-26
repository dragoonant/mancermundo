// The grid distance fields the planner ranks spots with, against the engine's own visibility-graph routes.
import { describe, expect, it } from 'vitest'
import { createGame } from '@/engine'
import { navFor, routeLength } from '@/engine/nav'
import { fieldFrom, reachablePoints, sampleField } from '../../src/ai/field'
import { pairingFor } from '../../tools/ai-pairing'
import { edit } from '../fixtures/helpers'
import { realBundle } from '../fixtures/real'

describe('AI: distance fields', () => {
  it('AI-040 a field agrees with the engine route within 12% (plus three quarters of an inch) between open points of a real board', () => {
    const bundle = realBundle()
    const { setup } = pairingFor(bundle, 0, ['scn.tunnel-skirmish'], 2)
    // every door open, so most pairs of points have a route
    const state = edit(createGame(setup, 'f', bundle).state, (d) => {
      for (const door of Object.values(d.board.doors)) door.state = 'open'
    })
    const nav = navFor(state.board.def, state.board.doors, 0.492)
    // points the grid can stand a base on (spread over the board), found through a field of the same board
    const pts = reachablePoints(fieldFrom(state, { x: -9, z: -14 }, 0.492), 400, 14).map((q) => q.p).slice(0, 9)
    let compared = 0
    for (const a of pts) {
      const field = fieldFrom(state, a, 0.492)
      for (const b of pts) {
        if (a === b) continue
        const exact = routeLength(nav, a, b)
        const grid = sampleField(field, b)
        if (!Number.isFinite(exact)) continue
        compared++
        expect(Number.isFinite(grid), `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toBe(true)
        expect(Math.abs(grid - exact)).toBeLessThanOrEqual(exact * 0.12 + 0.75)
      }
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('AI-041 a closed door blocks a field and the all-doors-open field shows the way through it', () => {
    const bundle = realBundle()
    const { setup } = pairingFor(bundle, 0, ['scn.tunnel-skirmish'], 2)
    const state = createGame(setup, 'f2', bundle).state
    const a = { x: -9, z: -14 }
    const b = { x: 9, z: 14 }
    const closed = sampleField(fieldFrom(state, a, 0.492, false), b)
    const open = sampleField(fieldFrom(state, a, 0.492, 'all'), b)
    expect(Number.isFinite(open)).toBe(true)
    expect(open).toBeGreaterThanOrEqual(Math.hypot(18, 28) - 1)
    expect(closed >= open).toBe(true)
  })
})
