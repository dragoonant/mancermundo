import { describe, expect, it } from 'vitest'
import { act, query, step, suggest } from '@/engine'
import type { GameState } from '@/engine'
import { answer, dice, meleeGame, optionWhere, R, TOUCH } from '../fixtures/melee'
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

describe('MOVE: involuntary moves, Charge and Retreat (S3b)', () => {
  const N = 0
  const S = Math.PI
  const gapOf = (st: GameState, a: string, b: string) => query.distance(st, a, b)

  it('MOVE-003 Knockback into contact with an enemy is resolved, then the pushed fighter is moved back to 1" separation', () => {
    // A3 shoots B3 with a Knockback gun; B3 slides 0.5" into A4 (blocked: +1 Damage) and is then pushed apart to 1"
    const s = meleeGame({
      spots: { A3: { x: 0, z: -8, facing: N }, B3: { x: 0, z: -2, facing: S }, A4: { x: 0, z: -0.5, facing: S } },
      loadouts: { A3: { weapons: ['atk.w.knock'] } },
      active: 'A3',
    })
    let r = must(take(s, { action: 'shoot' }))
    r = must(step(r.state, optionWhere(r.state, { targetId: 'B3' }), dice(6, 1)))
    const moves = eventsOf(r.events, 'FighterMoved').filter((e) => e.fighterId === 'B3')
    expect(moves.map((e) => e.kind)).toEqual(['knockback', 'pushedApart'])
    expect(moves[0]!.length).toBeCloseTo(0.5, 2)
    expect(gapOf(r.state, 'B3', 'A4')).toBeGreaterThanOrEqual(1)
    expect(gapOf(r.state, 'B3', 'A4')).toBeCloseTo(1, 2)
    expect(r.state.fighters.B3!.engagedWith).toEqual([])
  })

  it('MOVE-004 a Charge moves up to M + D3"; with the D3 short of contact the charger stops 1" away', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 2 * R + 6.5, facing: S } }, active: 'A3' })
    const opt = s.pending!.options!.find((o) => o.id === 'charge:B3')!
    expect(opt.data!.pReach).toBeCloseTo(2 / 3, 6)
    const r = must(step(s, opt.action, dice(1))) // D3 = 1: 6" of the 6.5" needed
    const moved = eventsOf(r.events, 'FighterMoved').find((e) => e.kind === 'charge')!
    expect(moved.maxInches).toBe(6)
    const gap = gapOf(r.state, 'A3', 'B3')
    expect(gap).toBeGreaterThanOrEqual(1 - 1e-6)
    expect(gap).toBeCloseTo(1, 1)
    expect(r.state.fighters.A3!.engagedWith).toEqual([])
    expect(eventsOf(r.events, 'FightStarted')).toHaveLength(0)
    expect(r.pending!.kind).toBe('action.activate') // the Charge was the whole activation
  })

  it('MOVE-005 a successful Charge grants a free Fight with +1 attack die', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: S } }, active: 'A3' })
    const r = must(answer(s, optionWhere(s, { action: 'charge', targetId: 'B3' }), dice(1, 1, 1, 1)))
    expect(eventsOf(r.events, 'FightStarted')[0]).toMatchObject({ attackerId: 'A3', charge: true, dice: 2 })
    const performed = eventsOf(r.events, 'ActionResolved').map((e) => e.action)
    expect(performed).toEqual(['charge'])
    expect(eventsOf(r.events, 'ActivationEnded')[0]).toMatchObject({ fighterId: 'A3', actionsUsed: 2 })
  })

  it('MOVE-006 a Charge ending within 1" of a Seriously Injured enemy and not Engaged may take a free Coup de Grace instead', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: S, posture: 'seriouslyInjured' } }, active: 'A3' })
    const r = must(step(s, optionWhere(s, { action: 'charge', targetId: 'B3' }), dice(1)))
    expect(r.state.fighters.A3!.engagedWith).toEqual([])
    expect(r.pending!.kind).toBe('fight.after')
    expect(r.pending!.options!.map((o) => o.id)).toEqual(['cdg:B3', 'none'])
    const done = must(step(r.state, optionWhere(r.state, { choice: 'coupDeGrace', targetId: 'B3' })))
    expect(done.state.fighters.B3!.location).toBe('outOfAction')
    expect(eventsOf(done.events, 'CoupDeGrace')).toEqual([expect.objectContaining({ fighterId: 'A3', targetId: 'B3' })])
    expect(eventsOf(done.events, 'FighterOutOfAction')[0]).toMatchObject({ cause: 'coupDeGrace', by: 'A3' })
  })

  const engaged = () => meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } }, active: 'A3' })

  it('MOVE-007 Retreat: the engaged enemies take their I tests for reaction attacks whether or not the retreater passed', () => {
    const s = engaged()
    // A3 fails its I test (1); B3 passes (4) and strikes (1)
    const failed = must(answer(s, optionWhere(s, { action: 'retreat' }), dice(1, 4, 1)))
    const tests = eventsOf(failed.events, 'InitiativeTest')
    expect(tests.map((e) => [e.fighterId, e.passed, e.reason])).toEqual([
      ['A3', false, 'retreat'],
      ['B3', true, 'reaction:retreat'],
    ])
    expect(eventsOf(failed.events, 'ReactionStarted').map((e) => e.fighterId)).toEqual(['B3'])
    // A3 passes (4), B3 fails (1): no reaction attack, then the D6 retreat move is asked for
    const passed = must(answer(s, optionWhere(s, { action: 'retreat' }), dice(4, 1, 3)))
    expect(eventsOf(passed.events, 'ReactionStarted')).toHaveLength(0)
    expect(passed.pending!.constraints).toMatchObject({ kind: 'retreat', maxInches: 3 })
  })

  it('MOVE-008 a failed Retreat I test leaves the fighter Engaged and ends the action; a pass moves up to D6" ending more than 1" from enemies', () => {
    const s = engaged()
    const failed = must(answer(s, optionWhere(s, { action: 'retreat' }), dice(1, 1)))
    expect(failed.state.fighters.A3!.engagedWith).toEqual(['B3'])
    expect(failed.pending!.kind).toBe('action.choose')
    expect(failed.state.action.activation!.actionsLeft).toBe(1)
    expect(failed.state.action.activation!.performed.map((p) => p.action)).toEqual(['retreat'])
    const passed = must(answer(s, optionWhere(s, { action: 'retreat' }), dice(4, 1, 3)))
    const p = passed.pending!
    expect(p.canPass).toBe(false)
    // ending within 1" of B3 is refused; the engine's suggestion is legal and clear
    expect(step(passed.state, act.path(p, [{ x: 0, z: -10.5 }])).rejection?.code).toBe('E_ONE_INCH')
    expect(step(passed.state, act.path(p, [{ x: 0, z: -14 }])).rejection?.code).toBe('E_OUT_OF_RANGE')
    const sug = suggest(passed.state, p)!
    const moved = must(step(passed.state, sug))
    expect(gapOf(moved.state, 'A3', 'B3')).toBeGreaterThan(1)
    expect(moved.state.fighters.A3!.engagedWith).toEqual([])
    expect(eventsOf(moved.events, 'FighterMoved')[0]).toMatchObject({ kind: 'retreat', maxInches: 3 })
    expect(moved.state.action.activation!.canTurn).toBe(true) // a move: the free turn is open again
    expect(moved.pending!.kind).toBe('action.choose')
  })
})
