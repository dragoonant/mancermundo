import { describe, expect, it } from 'vitest'
import { query, step } from '@/engine'
import { createCtx } from '@/engine/registry'
import { cloneState } from '@/engine/state'
import { takeNerveTest } from '@/engine/morale'
import { coverScore, runForCoverPick } from '@/engine/movement'
import { answer, dice, meleeGame, optionWhere, R, TOUCH } from '../fixtures/melee'
import { eventsOf, menuActions, must } from '../fixtures/helpers'
import type { GameState } from '@/engine'

const N = 0
const S = Math.PI

/** A3 fights B3 and puts it down (hit 6, wound 6, injury 3 = Seriously Injured); B4 / B5 stand at the given base gaps from B3. */
function downB3(spots: Record<string, { x: number; z: number; facing?: number }>, active = 'A3'): GameState {
  return meleeGame({ spots: { A3: { x: 0, z: -TOUCH, facing: N }, B3: { x: 0, z: 0, facing: S }, ...spots }, active })
}

describe('NERVE: nerve tests and Broken (R-12)', () => {
  it('NERVE-001 a friend within 3" of a fighter that becomes Seriously Injured tests nerve; one 3.5" away does not', () => {
    const s = downB3({ B4: { x: 2.5 + 2 * R, z: 0, facing: S }, B5: { x: -(3.5 + 2 * R), z: 0, facing: S } })
    const rng = dice(6, 6, 3, 6, 6) // hit, wound, injury, B4's nerve test
    const r = must(answer(s, optionWhere(s, { action: 'fight' }), rng))
    expect(r.state.fighters.B3!.posture).toBe('seriouslyInjured')
    expect(eventsOf(r.events, 'NerveTest').map((e) => e.fighterId)).toEqual(['B4'])
    expect(r.state.nerve).toEqual([])
    expect(rng.remaining).toBe(0)
  })

  it('NERVE-002 the nerve test gets +1 per other friend within 3" that is not Broken or Seriously Injured', () => {
    const s = meleeGame({
      spots: {
        B4: { x: 0, z: 0, facing: S },
        B5: { x: 2, z: 0, facing: S }, // supports
        B1: { x: -2, z: 0, facing: S }, // Broken: no support
        B2: { x: 0, z: 2, facing: S, posture: 'seriouslyInjured' }, // no support
        B3: { x: 0, z: -8, facing: S }, // too far
      },
      tweak: (d) => {
        d.fighters.B1!.conditions.broken = { since: 1 }
      },
    })
    const odds = query.nerveOdds(s, 'B4')
    expect(odds).toMatchObject({ need: 7, modifier: 1, supporters: ['B5'] })
    expect(odds.chance).toBeCloseTo(26 / 36, 6)
    // a 6 on 2D6 passes only thanks to the supporter
    const ctx = createCtx(cloneState(s), dice(3, 3), null, s.seq)
    expect(takeNerveTest(ctx, { fighterId: 'B4', reason: 'seriouslyInjured:B3' })).toBe(false)
    expect(eventsOf(ctx.events, 'NerveTest')[0]).toMatchObject({ roll: 6, need: 6, passed: true })
    const alone = createCtx(cloneState(s), dice(3, 3), null, s.seq)
    alone.state.fighters.B5!.location = 'reserve'
    expect(takeNerveTest(alone, { fighterId: 'B4', reason: 'seriouslyInjured:B3' })).toBe(true)
    expect(alone.state.fighters.B4!.conditions.broken).toBeDefined()
  })

  it('NERVE-003 a fighter that fails a nerve test loses Ready and at once makes Running for Cover, even if it already activated', () => {
    for (const already of [false, true]) {
      const s = downB3({ B4: { x: 2.5 + 2 * R, z: 0, facing: S } })
      const pre = already
        ? (() => {
            const c = cloneState(s)
            c.fighters.B4!.ready = false
            c.fighters.B4!.activatedThisRound = true
            return c
          })()
        : s
      // hit, wound, injury; B4 nerve 1+1 fails; Running for Cover 2D6 = 3 + 3
      const rng = dice(6, 6, 3, 1, 1, 3, 3)
      const r = must(answer(pre, optionWhere(pre, { action: 'fight' }), rng))
      const b4 = r.state.fighters.B4!
      expect(b4.conditions.broken).toBeDefined()
      expect(b4.ready).toBe(false)
      expect(eventsOf(r.events, 'RunningForCover').map((e) => e.fighterId)).toEqual(['B4'])
      const moved = eventsOf(r.events, 'FighterMoved').find((e) => e.fighterId === 'B4' && e.kind === 'runForCover')!
      expect(moved.maxInches).toBe(6)
      expect(rng.remaining).toBe(0)
      // the sequence carries on to A3's choice after the attack (every engaged enemy is down)
      expect(r.pending!.kind).toBe('fight.after')
    }
  })

  it('NERVE-004 a Broken fighter\'s only available action on activation is Running for Cover', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: 0, facing: S } },
      tweak: (d) => {
        d.fighters.A3!.conditions.broken = { since: 1 }
      },
      active: 'A3',
    })
    expect(menuActions(s)).toEqual(['runForCover'])
    expect(query.actionMenu(s, 'A3').withheld).toContainEqual({ action: 'end', reason: 'mandatory' })
    // Running for Cover is the Double action: 2D6 = 2 + 2, then the activation is over
    const r = must(step(s, optionWhere(s, { action: 'runForCover' }), dice(2, 2)))
    expect(r.state.action.activation).toBeNull()
    expect(eventsOf(r.events, 'FighterMoved').find((e) => e.kind === 'runForCover')).toBeDefined()
  })

  it('NERVE-005 Running for Cover picks an end point more than 3" from enemies before one merely out of sight', () => {
    // a smoke cloud west of the enemy hides spots that are still within 3" of it; clear spots to the south stay in sight
    const s = meleeGame({
      spots: { A3: { x: 0, z: -2.5, facing: N }, B3: { x: 0, z: 0, facing: S } },
      tweak: (d) => {
        d.board.smoke = [{ id: 's1', pos: { x: -3.2, z: 0 }, radius: 2.5, placedRound: 1 }]
        d.fighters.A3!.conditions.broken = { since: 1 }
      },
    })
    const a3 = s.fighters.A3!
    const hiddenNear = coverScore(s, a3, { x: -2, z: -1.2 }, 2.4)
    expect(hiddenNear).toMatchObject({ clear: false, hidden: true })
    const pick = runForCoverPick(s, a3, 3)
    expect(pick.wps.length).toBeGreaterThan(0)
    expect(pick.score.clear).toBe(true)
    expect(pick.score.hidden).toBe(false)
  })

  it('R-10.11 a free Coup de Grace on a fighter Seriously Injured in the same activation owes no extra nerve test; the Coup de Grace action does', () => {
    const s = downB3({ B4: { x: 2.5 + 2 * R, z: 0, facing: S } })
    // hit, wound, injury 3 (Seriously Injured), B4's nerve test passes (6, 6), then the free Coup de Grace
    const r = must(answer(s, optionWhere(s, { action: 'fight' }), dice(6, 6, 3, 6, 6)))
    const done = must(step(r.state, optionWhere(r.state, { choice: 'coupDeGrace', targetId: 'B3' })))
    expect(done.state.fighters.B3!.location).toBe('outOfAction')
    expect(eventsOf([...r.events, ...done.events], 'NerveTest')).toHaveLength(1)
    expect(done.state.nerve).toEqual([])
    // B3 already lying Seriously Injured from an earlier activation: the Coup de Grace action owes B4 its Out of Action test
    const lying = meleeGame({
      spots: { A3: { x: 0, z: -TOUCH - 0.3, facing: N }, B3: { x: 0, z: 0, facing: S, posture: 'seriouslyInjured' }, B4: { x: 2.5 + 2 * R, z: 0, facing: S } },
      active: 'A3',
    })
    const cdg = must(step(lying, optionWhere(lying, { action: 'coupDeGrace', targetId: 'B3' }), dice(6, 6)))
    expect(eventsOf(cdg.events, 'NerveTest').map((e) => e.fighterId)).toEqual(['B4'])
  })
})
