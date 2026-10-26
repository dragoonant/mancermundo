import { describe, expect, it } from 'vitest'
import { query, step } from '@/engine'
import { answer, dice, meleeGame, optionWhere, TOUCH } from '../fixtures/melee'
import { activate, endRound, eventsOf, moveTo, must, take } from '../fixtures/helpers'

const N = 0
const S = Math.PI

describe('STATUS: statuses and conditions (R-3)', () => {
  it('STATUS-001 two enemy fighters in base contact are both Engaged; an Engaged fighter cannot be Pinned by a ranged hit', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -4, facing: S }, A4: { x: 0, z: -4 + TOUCH, facing: S } },
      loadouts: { A3: { weapons: ['atk.w.plain'] } },
      active: 'A3',
    })
    expect(s.fighters.B3!.engagedWith).toEqual(['A4'])
    expect(s.fighters.A4!.engagedWith).toEqual(['B3'])
    expect(query.status(s, 'B3')).toBe('standingEngaged')
    let r = must(take(s, { action: 'shoot' }))
    r = must(step(r.state, optionWhere(r.state, { targetId: 'B3' }), dice(6, 1))) // hit (needs 5+: target engaged), wound 1
    expect(eventsOf(r.events, 'HitRolled')[0]).toMatchObject({ hit: true, need: 5 })
    expect(eventsOf(r.events, 'FighterPinned')).toHaveLength(0)
    expect(r.state.fighters.B3!.posture).toBe('standing')
  })

  it('STATUS-002 a Pinned fighter contacted by a charging enemy becomes Standing Engaged without spending an action', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: N, posture: 'pinned' } }, active: 'A3' })
    const r = must(answer(s, optionWhere(s, { action: 'charge', targetId: 'B3' }), dice(1, 1, 1, 1)))
    const b3 = r.state.fighters.B3!
    expect(eventsOf(r.events, 'StatusChanged').find((e) => e.fighterId === 'B3')).toMatchObject({ from: 'pinned', to: 'standing', reason: 'contacted' })
    expect(b3.posture).toBe('standing')
    expect(b3.engagedWith).toEqual(['A3'])
    expect(b3.ready).toBe(true)
    expect(query.status(r.state, 'B3')).toBe('standingEngaged')
  })

  it('STATUS-003 an enemy may move into contact with a Seriously Injured fighter without charging; it never becomes Engaged', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -7, facing: S, posture: 'seriouslyInjured' } }, active: 'A3' })
    let r = must(take(s, { action: 'move' }))
    r = must(moveTo(r.state, [{ x: 0, z: -7 - TOUCH }]))
    expect(r.state.fighters.A3!.engagedWith).toEqual([])
    expect(r.state.fighters.B3!.engagedWith).toEqual([])
    expect(query.status(r.state, 'A3')).toBe('standingActive')
  })

  it('STATUS-004 Ready is given to every fighter in the Priority phase, including Seriously Injured and Broken fighters', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: 5, posture: 'seriouslyInjured' }, B4: { x: 4, z: 5, facing: S } },
      tweak: (d) => {
        d.fighters.B4!.conditions.broken = { since: 1 }
        d.fighters.B3!.ready = false
        d.fighters.B4!.ready = false
      },
    })
    // End phase dice: B's Bottle roll (1: no), B3's recovery (3: stays down), B4's Rally (6 + 6: steadies), round 2 Priority (3, 4)
    const r = endRound(s, dice(1, 3, 6, 6, 3, 4))
    expect(r.state.round).toBe(2)
    expect(r.state.fighters.B3!.ready).toBe(true)
    expect(r.state.fighters.B4!.ready).toBe(true)
    expect(eventsOf(r.events, 'FightersReadied')[0]!.fighterIds).toEqual(expect.arrayContaining(['A3', 'B3', 'B4']))
  })

  it('STATUS-005 a Blind fighter that already activated is not readied next round; its reaction attacks hit only on a natural 6', () => {
    const blindDone = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: 5, facing: S } },
      tweak: (d) => {
        d.fighters.B3!.conditions.blind = { since: 1, source: 'flash', data: { skipNextReady: true } }
        d.fighters.B3!.ready = false
      },
    })
    // End phase: B's Bottle roll (1: no), B3's recovery (3: stays down), round 2 Priority (3, 4)
    const next = endRound(blindDone, dice(1, 3, 3, 4))
    expect(next.state.round).toBe(2)
    expect(next.state.fighters.B3!.ready).toBe(false)
    expect(next.state.fighters.A3!.ready).toBe(true)
    // reaction attacks: a 5 misses, only a 6 hits
    const engaged = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } },
      tweak: (d) => {
        d.fighters.B3!.conditions.blind = { since: 1, source: 'flash' }
      },
      active: 'A3',
    })
    const miss = must(answer(engaged, optionWhere(engaged, { action: 'fight' }), dice(1, 5)))
    expect(eventsOf(miss.events, 'FightHitRolled').find((e) => e.targetId === 'A3')).toMatchObject({ dice: [5], need: 6 })
    expect(eventsOf(miss.events, 'WoundRolled')).toHaveLength(0)
    const hit = must(answer(engaged, optionWhere(engaged, { action: 'fight' }), dice(1, 6, 1)))
    expect(eventsOf(hit.events, 'WoundRolled')).toEqual([expect.objectContaining({ targetId: 'A3', roll: 1 })])
    // a Blind fighter is offered no attack of its own
    const own = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } },
      tweak: (d) => {
        d.fighters.A3!.conditions.blind = { since: 1, source: 'flash', data: { skipNextReady: true } }
      },
      active: 'A3',
    })
    expect(own.pending!.options!.map((o) => (o.action.payload as { action: string }).action)).not.toContain('fight')
  })

  it('STATUS-006 a burning Active fighter takes the S3 hit, moves 2D6" randomly, rolls 6+ (+2 if Pinned) to put it out, and takes no other action', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: 10, facing: S } },
      tweak: (d) => {
        d.fighters.A3!.conditions.blaze = { since: 1, source: 'test' }
      },
    })
    // wound roll 1 (no wound); 2D6 = 1 + 2 = 3" toward +z (direction 0); it lies down Pinned; extinguish 4 + 2 = 6
    const rng = dice(1, 1, 2, 0, 4)
    const r = must(activate(s, 'A3', rng))
    expect(rng.remaining).toBe(0)
    const moved = eventsOf(r.events, 'FighterMoved').find((e) => e.kind === 'blaze')!
    expect(moved.length).toBeCloseTo(3, 2)
    const a3 = r.state.fighters.A3!
    expect(a3.pos.z).toBeCloseTo(-7, 2)
    expect(a3.posture).toBe('pinned')
    expect(a3.conditions.blaze).toBeUndefined()
    expect(eventsOf(r.events, 'ActivationEnded')[0]).toMatchObject({ fighterId: 'A3', actionsUsed: 0 })
    expect(r.pending!.kind).toBe('action.activate')
    expect(r.pending!.seat).toBe('B')
    // a 3 + 2 = 5 leaves it burning
    const stillBurning = must(activate(s, 'A3', dice(1, 1, 2, 0, 3)))
    expect(stillBurning.state.fighters.A3!.conditions.blaze).toBeDefined()
  })
})
