import { describe, expect, it } from 'vitest'
import { act, step } from '@/engine'
import { bundleWith, barricadePair } from '../fixtures/boards'
import { activate, eventsOf, moveTo, must, place, startGame, take } from '../fixtures/helpers'

/** A3 (25 mm, M5) at (0, -10) activated and ready to answer a move.path. */
function mover(extra: Parameters<typeof place>[1] = {}, board?: ReturnType<typeof barricadePair>) {
  const base = board ? startGame({ bundle: bundleWith(board), setup: { boardId: board.id } }).state : startGame().state
  const s = place(base, { A3: { x: 0, z: -10 }, ...extra })
  const r = take(activate(s, 'A3').state, { action: 'move' })
  return r
}

describe('MOVE: movement', () => {
  it('MOVE-001 a path longer than M is rejected; length is measured along the bends', () => {
    const r = mover()
    expect(r.pending!.constraints).toMatchObject({ kind: 'move', maxInches: 5, oneInch: 'enemy' })
    // straight 5.5 inches: too far
    const far = step(r.state, act.path(r.pending!, [{ x: 0, z: -4.5 }]))
    expect(far.rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(far.state).toBe(r.state)
    // the corner path ends 4.24 inches from the start but is 6 inches long
    const bent = step(r.state, act.path(r.pending!, [{ x: 3, z: -10 }, { x: 3, z: -7 }]))
    expect(bent.rejection?.code).toBe('E_OUT_OF_RANGE')
    // exactly 5 inches along a bend is fine
    const ok = must(step(r.state, act.path(r.pending!, [{ x: 3, z: -10 }, { x: 3, z: -8 }])))
    const moved = eventsOf(ok.events, 'FighterMoved')[0]!
    expect(moved).toMatchObject({ kind: 'move', length: 5, maxInches: 5 })
    expect(moved.path).toEqual([{ x: 0, z: -10 }, { x: 3, z: -10 }, { x: 3, z: -8 }])
  })

  it('MOVE-002 a Move ending 0.9 inches from a Standing enemy is rejected; the same move next to a Seriously Injured enemy is allowed', () => {
    const r0 = startGame().state
    const rad = r0.fighters.A3!.baseRadius + r0.fighters.B3!.baseRadius
    const enemyAt = { x: 0, z: -6 }
    const endAt = (gap: number) => ({ x: 0, z: enemyAt.z - rad - gap })
    const r = mover({ B3: enemyAt })
    const tooClose = step(r.state, act.path(r.pending!, [endAt(0.9)]))
    expect(tooClose.rejection?.code).toBe('E_ONE_INCH')
    expect(tooClose.rejection!.details).toMatchObject({ enemyId: 'B3' })
    // exactly 1 inch is allowed
    must(step(r.state, act.path(r.pending!, [endAt(1.0)])))
    // a Pinned enemy still protects its 1 inch
    const pinned = mover({ B3: { ...enemyAt, posture: 'pinned' } })
    expect(step(pinned.state, act.path(pinned.pending!, [endAt(0.9)])).rejection?.code).toBe('E_ONE_INCH')
    // a Seriously Injured enemy does not
    const si = mover({ B3: { ...enemyAt, posture: 'seriouslyInjured' } })
    const ok = must(step(si.state, act.path(si.pending!, [endAt(0.9)])))
    expect(ok.state.fighters.A3!.pos.z).toBeCloseTo(endAt(0.9).z, 3)
    // and the move stays an ordinary Move: the SI fighter never becomes Engaged
    expect(ok.state.fighters.A3!.engagedWith).toEqual([])
  })

  it('a path along which the base passes within 1 inch of an enemy is rejected even if it ends clear', () => {
    const r = mover({ B3: { x: 0.3, z: -8 } })
    const through = step(r.state, act.path(r.pending!, [{ x: 0, z: -6 }]))
    expect(through.rejection?.code).toBe('E_NO_PATH')
    const near = step(r.state, act.path(r.pending!, [{ x: 2.2, z: -8 }, { x: 2.2, z: -6 }]))
    expect(near.rejection?.code).toBe('E_ONE_INCH')
  })

  it('friends can be passed through but not stood on; enemies cannot be passed through', () => {
    const r = mover({ A4: { x: 0, z: -8 } })
    must(step(r.state, act.path(r.pending!, [{ x: 0, z: -6 }])))
    const onTop = step(r.state, act.path(r.pending!, [{ x: 0, z: -8.3 }]))
    expect(onTop.rejection?.code).toBe('E_OVERLAP')
    const e = mover({ B4: { x: 0, z: -8 } })
    expect(step(e.state, act.path(e.pending!, [{ x: 0, z: -6 }])).rejection?.code).toBe('E_NO_PATH')
  })

  it('crossing an obstacle costs 1 inch more and a base may not end on one (R-7.11)', () => {
    const board = barricadePair()
    const r = mover({ A3: { x: 0, z: -2 } }, board)
    // 4 inches of path + 1 for the barricade = 5: allowed
    const ok = must(step(r.state, act.path(r.pending!, [{ x: 0, z: 2 }])))
    expect(ok.state.fighters.A3!.pos.z).toBe(2)
    // 4.5 + 1 = 5.5: too far
    expect(step(r.state, act.path(r.pending!, [{ x: 0, z: 2.5 }])).rejection?.code).toBe('E_OUT_OF_RANGE')
    // ending on the barricade
    expect(step(r.state, act.path(r.pending!, [{ x: 0, z: 0 }])).rejection?.code).toBe('E_OVERLAP')
    // going round it costs nothing extra
    must(step(r.state, act.path(r.pending!, [{ x: 2.3, z: -1 }, { x: 2.3, z: 1 }])))
  })

  it('facing after a move defaults to the direction of travel and can be chosen', () => {
    const r = mover()
    const east = must(step(r.state, act.path(r.pending!, [{ x: 3, z: -10 }])))
    expect(east.state.fighters.A3!.facing).toBeCloseTo(Math.PI / 2, 2)
    const chosen = must(step(r.state, act.path(r.pending!, [{ x: 3, z: -10 }], Math.PI)))
    expect(chosen.state.fighters.A3!.facing).toBeCloseTo(Math.PI, 2)
    const bad = step(r.state, act.path(r.pending!, [{ x: 3, z: -10 }], Number.NaN))
    expect(bad.rejection?.code).toBe('E_SCHEMA')
  })

  it('malformed paths are rejected, never thrown', () => {
    const r = mover()
    expect(step(r.state, act.path(r.pending!, [])).rejection?.code).toBe('E_SCHEMA')
    expect(step(r.state, act.path(r.pending!, [{ x: Number.NaN, z: 1 }])).rejection?.code).toBe('E_SCHEMA')
    expect(step(r.state, act.path(r.pending!, [{ x: 40, z: 0 }])).rejection?.code).toBeDefined()
    expect(moveTo(r.state, [{ x: 0, z: -9 }]).rejection).toBeUndefined()
  })
})
