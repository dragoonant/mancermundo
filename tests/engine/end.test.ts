import { describe, expect, it } from 'vitest'
import { act, query, step, type GameState } from '@/engine'
import { attackBundle, dice } from '../fixtures/attack'
import { edit, eventsOf, must, place, playOut, startGame, take } from '../fixtures/helpers'

// The End phase (R-13): Bottle tests, Fleeing, Recovery, Rally. The test gangs have five fighters each (the crew), ids A1..A5
// and B1..B5: A1 Leader (Cl 5+, Leading by Example), A2 Champion (Cl 6+), A3 and A4 gangers (Cl 7+), A5 juve (Cl 8+).
// Round 1 is played by ending every activation at once, so the first dice of a script are the End phase's and the last two are
// the next round's Priority roll.

const PRIORITY = [3, 4]

/** A game in round 1's Action phase on the real Injury faces; `tweak` edits the state, `spots` places fighters. */
function game(tweak?: (d: GameState) => void, spots: Parameters<typeof place>[1] = {}): GameState {
  const s = startGame({ bundle: attackBundle }).state
  // everyone far from everyone unless a test says otherwise (more than 3" apart: no support, no assistance, no nerve tests)
  const apart: Parameters<typeof place>[1] = {}
  ;['A', 'B'].forEach((seat, i) => ['1', '2', '3', '4', '5'].forEach((n, k) => (apart[seat + n] = { x: -10 + k * 5, z: i === 0 ? -16 : 16 })))
  return edit(place(s, { ...apart, ...spots }), (d) => {
    tweak?.(d)
  })
}

const down = {
  si(d: GameState, id: string) {
    const f = d.fighters[id]!
    f.posture = 'seriouslyInjured'
    f.ready = false
  },
  ooa(d: GameState, id: string) {
    const f = d.fighters[id]!
    f.location = 'outOfAction'
    f.ready = false
  },
  broken(d: GameState, id: string) {
    const f = d.fighters[id]!
    f.conditions.broken = { since: 1 }
    f.ready = false
  },
}

const bottles = (events: ReturnType<typeof playOut>['events']) => eventsOf(events, 'BottleTest')

describe('END: bottle, flee, recovery and rally (R-13)', () => {
  it('END-001 with a starting crew of 10, 4 down can never bottle (6 + 4 is not more than 10); 5 down bottles on a 6 but not on a 5', () => {
    const four = game((d) => {
      d.players.A.startingCrew = 10
      for (const id of ['A2', 'A3', 'A4', 'A5']) down.ooa(d, id)
    })
    expect(query.bottleOdds(four, 'A')).toMatchObject({ down: 4, crew: 10, need: 7, pBottle: 0, mustTest: true })
    const sixFour = playOut(four, dice(6, ...PRIORITY))
    expect(bottles(sixFour.events)).toEqual([expect.objectContaining({ seat: 'A', roll: 6, down: 4, crew: 10, bottled: false, voluntary: false })])
    expect(sixFour.state.players.A.bottled).toBe(false)

    const five = game((d) => {
      d.players.A.startingCrew = 10
      for (const id of ['A2', 'A3', 'A4', 'A5']) down.ooa(d, id)
      down.si(d, 'A1')
    })
    expect(query.bottleOdds(five, 'A')).toMatchObject({ down: 5, need: 6 })
    expect(query.bottleOdds(five, 'A').pBottle).toBeCloseTo(1 / 6, 10)
    // a 6 bottles the gang (6 + 5 = 11); its Seriously Injured Leader then takes the flee test (6, 6 passes) and the recovery roll (1)
    const six = playOut(five, dice(6, 6, 6, 1, ...PRIORITY))
    expect(bottles(six.events)).toEqual([expect.objectContaining({ roll: 6, down: 5, crew: 10, bottled: true })])
    expect(six.state.players.A).toMatchObject({ bottled: true, bottledVoluntarily: false })
    // a 5 does not (5 + 5 = 10)
    const fiveRoll = playOut(five, dice(5, 1, ...PRIORITY))
    expect(bottles(fiveRoll.events)).toEqual([expect.objectContaining({ roll: 5, bottled: false })])
    expect(fiveRoll.state.players.A.bottled).toBe(false)
  })

  it('END-001 a gang with nobody down does not test; both gangs test with the Priority player first', () => {
    const none = playOut(game(), dice(...PRIORITY))
    expect(bottles(none.events)).toHaveLength(0)
    expect(none.answered).not.toContain('end.bottle')
    const both = playOut(
      game((d) => {
        down.ooa(d, 'A5')
        down.ooa(d, 'B5')
      }),
      dice(1, 2, ...PRIORITY),
    )
    expect(bottles(both.events).map((e) => [e.seat, e.roll, e.down])).toEqual([
      ['A', 1, 1],
      ['B', 2, 1],
    ])
    // Priority B: B tests first
    const b = startGame({ bundle: attackBundle, firstPriority: 'B' }).state
    const swapped = playOut(
      edit(b, (d) => {
        down.ooa(d, 'A5')
        down.ooa(d, 'B5')
      }),
      dice(1, 2, ...PRIORITY),
    )
    expect(bottles(swapped.events).map((e) => e.seat)).toEqual(['B', 'A'])
  })

  it('END-002 a bottled gang never tests again; the player may choose to fail the test (a voluntary bottle rolls nothing)', () => {
    // already bottled: no Bottle decision at all (the flee tests are plain 2D6 rolls, see END-003)
    const already = game((d) => {
      d.players.A.bottled = true
      down.ooa(d, 'A5')
      for (const id of ['A1', 'A2', 'A3', 'A4']) d.fighters[id]!.rules = []
    })
    const keep = playOut(already, dice(6, 6, 6, 6, 6, 6, 6, 6, ...PRIORITY))
    expect(keep.answered).not.toContain('end.bottle')
    expect(bottles(keep.events)).toHaveLength(0)

    // voluntary: the choice is offered and answered with 'bottle'; no die is rolled for it
    const s = game((d) => down.ooa(d, 'A5'), { A1: { x: 0, z: -15 }, A2: { x: 2, z: -15 }, A3: { x: 4, z: -15 }, A4: { x: 6, z: -15 } })
    const run = playOut(s, dice(6, 6, ...PRIORITY), { answer: (p) => (p.kind === 'end.bottle' ? act.bottle(p, 'bottle') : null) })
    expect(bottles(run.events)).toEqual([expect.objectContaining({ seat: 'A', roll: 0, voluntary: true, bottled: true, down: 1, crew: 5 })])
    expect(run.state.players.A).toMatchObject({ bottled: true, bottledVoluntarily: true })
    expect(eventsOf(run.events, 'DiceRolled').map((e) => e.purpose)).toEqual(['flee', 'priority', 'priority'])
    // the test option carries its numbers
    const pending = playOut(s, dice(), { stopAt: (p) => p.kind === 'end.bottle' }).pending!
    expect(pending.options!.map((o) => o.id)).toEqual(['test', 'bottle'])
    expect(pending.options![0]!.data).toMatchObject({ down: 1, crew: 5, need: 5 })
  })

  it('END-003 every fighter of a bottled gang takes a Cool test each End phase, whatever its status; failures are removed and count as Out of Action', () => {
    // no Leading by Example here: plain tests, in order Leader, Champion, then the rest by id
    const s = game(
      (d) => {
        d.players.A.bottled = true
        down.ooa(d, 'A5')
        for (const id of ['A1', 'A2', 'A3', 'A4']) d.fighters[id]!.rules = []
      },
      { A1: { x: -9, z: -15 }, A2: { x: -3, z: -15 }, A3: { x: 3, z: -15 }, A4: { x: 9, z: -15 } },
    )
    // A1 (Cl 5+) rolls 1 + 1 and flees; A2 (6+) rolls 3 + 3 and stays; A3 (7+) rolls 3 + 3 and flees; A4 (7+) rolls 4 + 3 and stays
    const r1 = playOut(s, dice(1, 1, 3, 3, 3, 3, 4, 3, ...PRIORITY))
    expect(eventsOf(r1.events, 'FleeTest').map((e) => [e.fighterId, e.roll, e.passed])).toEqual([
      ['A1', 2, false],
      ['A2', 6, true],
      ['A3', 6, false],
      ['A4', 7, true],
    ])
    expect(eventsOf(r1.events, 'FighterFled').map((e) => [e.fighterId, e.voluntary])).toEqual([
      ['A1', false],
      ['A3', false],
    ])
    expect(['A1', 'A3'].map((id) => r1.state.fighters[id]!.location)).toEqual(['fled', 'fled'])
    expect(r1.state.casualties.filter((c) => c.kind === 'fled').map((c) => c.fighterId)).toEqual(['A1', 'A3'])
    // fled fighters are Out of Action for the Bottle test and the battle
    expect(query.bottleOdds(r1.state, 'A')).toMatchObject({ down: 3, bottled: true })
    // the next End phase tests the fighters left again (a gang that has bottled never stops testing)
    const r2 = playOut(r1.state, dice(6, 6, 6, 6, ...PRIORITY))
    expect(eventsOf(r2.events, 'FleeTest').map((e) => e.fighterId)).toEqual(['A2', 'A4'])
  })

  it('END-004 a Leader passing its flee test carries every friend within 12" through; a Champion carries those within 6" that lack Leading by Example', () => {
    const lbe = (d: GameState, id: string) => d.fighters[id]!.rules.push({ id: 'core.r.leading-by-example' })
    // the Leader passes: A2 (6.4" away) and A3 (about 8") are carried, A4 (13.9") and A5 (21") are not and test for themselves
    const l = game(
      (d) => {
        d.players.A.bottled = true
      },
      { A1: { x: -11, z: -15 }, A2: { x: -4, z: -15 }, A3: { x: -5, z: -12.5 }, A4: { x: 4, z: -15 }, A5: { x: 11, z: -15 } },
    )
    const lead = playOut(l, dice(6, 6, 6, 6, 6, 6, ...PRIORITY))
    const tests = eventsOf(lead.events, 'FleeTest')
    expect(tests.map((e) => [e.fighterId, e.auto ?? null])).toEqual([
      ['A1', null],
      ['A2', 'A1'],
      ['A3', 'A1'],
      ['A4', null],
      ['A5', null],
    ])
    expect(eventsOf(lead.events, 'DiceRolled').filter((e) => e.purpose === 'flee')).toHaveLength(3)

    // the Leader fails and flees; the Champion (given the rule) passes: A3 (2.9") is carried, A4 has the rule itself and tests, A5 is too far
    const champ = game(
      (d) => {
        d.players.A.bottled = true
        lbe(d, 'A2')
        lbe(d, 'A4')
      },
      { A1: { x: -11, z: -15 }, A2: { x: 0, z: -15 }, A3: { x: 4, z: -15 }, A4: { x: -4, z: -15 }, A5: { x: 11, z: -15 } },
    )
    const c = playOut(champ, dice(1, 1, 6, 6, 6, 6, 6, 6, ...PRIORITY))
    expect(eventsOf(c.events, 'FleeTest').map((e) => [e.fighterId, e.auto ?? null, e.passed])).toEqual([
      ['A1', null, false],
      ['A2', null, true],
      ['A3', 'A2', true],
      ['A4', null, true],
      ['A5', null, true],
    ])
  })

  it('END-005 recovery roll Flesh Wound: an unassisted fighter takes a Flesh Wound and is Pinned; an assisted one is Pinned with no Flesh Wound', () => {
    const base = game((d) => down.si(d, 'A3'), { A3: { x: 0, z: -15 }, A4: { x: 1.8, z: -15 }, A1: { x: -9, z: -15 } })
    const T = base.fighters.A3!.stats.T
    // not assisted (A4 is a Standing friend within 1" but the player declines): Bottle roll 1, recovery die 1 = Flesh Wound
    const plain = playOut(base, dice(1, 1, ...PRIORITY))
    expect(eventsOf(plain.events, 'RecoveryTest')).toEqual([expect.objectContaining({ fighterId: 'A3', faces: ['fleshWound'], applied: 'fleshWound' })])
    expect(plain.state.fighters.A3).toMatchObject({ posture: 'pinned', fleshWounds: 1 })
    expect(eventsOf(plain.events, 'FleshWound')[0]).toMatchObject({ fighterId: 'A3', total: 1, toughness: T - 1 })
    // assisted by A4: two dice, both Flesh Wounds (no pick needed); no Flesh Wound taken, still Pinned
    const helped = playOut(base, dice(1, 1, 2, ...PRIORITY), { answer: (p) => (p.kind === 'end.assist' ? p.options![0]!.action : null) })
    expect(eventsOf(helped.events, 'RecoveryTest')).toEqual([expect.objectContaining({ fighterId: 'A3', faces: ['fleshWound', 'fleshWound'], applied: 'fleshWound', assistedBy: 'A4' })])
    expect(helped.state.fighters.A3).toMatchObject({ posture: 'pinned', fleshWounds: 0 })
    expect(eventsOf(helped.events, 'FleshWound')).toHaveLength(0)
    expect(helped.state.fighters.A3!.engagedWith).toEqual([])
  })

  it('END-006 recovery roll Seriously Injured: unassisted adds a Flesh Wound and stays down; assisted adds none', () => {
    const base = game((d) => down.si(d, 'A3'), { A3: { x: 0, z: -15 }, A4: { x: 1.8, z: -15 }, A1: { x: -9, z: -15 } })
    const plain = playOut(base, dice(1, 4, ...PRIORITY))
    expect(plain.state.fighters.A3).toMatchObject({ posture: 'seriouslyInjured', fleshWounds: 1 })
    expect(eventsOf(plain.events, 'RecoveryTest')[0]).toMatchObject({ applied: 'seriouslyInjured' })
    const helped = playOut(base, dice(1, 4, 5, ...PRIORITY), { answer: (p) => (p.kind === 'end.assist' ? p.options![0]!.action : null) })
    expect(helped.state.fighters.A3).toMatchObject({ posture: 'seriouslyInjured', fleshWounds: 0 })
    expect(eventsOf(helped.events, 'RecoveryTest')[0]).toMatchObject({ applied: 'seriouslyInjured', assistedBy: 'A4' })
    // a Flesh Wound that takes T to 0 puts a fighter Out of Action (T 3 here: three unassisted recoveries)
    const worn = edit(place(base, { A4: { x: 6, z: -15 } }), (d) => {
      d.fighters.A3!.fleshWounds = 2
    })
    const gone = playOut(worn, dice(1, 4, ...PRIORITY))
    expect(gone.state.fighters.A3!.location).toBe('outOfAction')
  })

  it('END-007 an assisting Active friend within 1" adds one Injury die and the owner picks the result; one fighter assists only one recovery', () => {
    // A5 stands between two Seriously Injured fighters (A3, A4) within 1" of both, plus A1 a long way off
    const s = game(
      (d) => {
        down.si(d, 'A3')
        down.si(d, 'A4')
      },
      { A3: { x: -1.2, z: -15 }, A5: { x: 0, z: -15 }, A4: { x: 1.2, z: -15 }, A1: { x: -9, z: -15 }, A2: { x: 9, z: -15 } },
    )
    const asked: string[][] = []
    // Bottle roll 1 (2 down: held), the first recovery rolls two dice (fleshWound 1, outOfAction 6), the second one die (4: stays down)
    const run = playOut(s, dice(1, 1, 6, 4, ...PRIORITY), {
      answer: (p) => {
        if (p.kind === 'end.assist') {
          asked.push(p.options!.map((o) => o.id))
          return p.options![0]!.action
        }
        if (p.kind === 'end.recoveryPick') {
          // options are listed kindest first: the Flesh Wound, then the Out of Action die
          expect(p.options!.map((o) => (o.data as { face: string }).face)).toEqual(['fleshWound', 'outOfAction'])
          expect(p.seat).toBe('A')
          return p.options![0]!.action
        }
        return null
      },
    })
    // the assistance was asked once with A5 for either fighter; after A5 took A3 no pairing was left for A4
    expect(asked).toEqual([['A5>A3', 'A5>A4', 'none']])
    expect(eventsOf(run.events, 'RecoveryTest').map((e) => [e.fighterId, e.faces, e.applied, e.assistedBy ?? null])).toEqual([
      ['A3', ['fleshWound', 'outOfAction'], 'fleshWound', 'A5'],
      ['A4', ['seriouslyInjured'], 'seriouslyInjured', null],
    ])
    expect(run.state.fighters.A3).toMatchObject({ posture: 'pinned', fleshWounds: 0 })
    expect(run.state.fighters.A4).toMatchObject({ posture: 'seriouslyInjured', fleshWounds: 1 })
    // the owner may also take the worse die: it is the owner's pick
    // (A3's Out of Action makes its two Seriously Injured neighbours test nerve: 6 + 6 each steadies them)
    const worse = playOut(s, dice(1, 1, 6, 4, 6, 6, 6, 6, ...PRIORITY), {
      answer: (p) => (p.kind === 'end.assist' || p.kind === 'end.recoveryPick' ? p.options![p.kind === 'end.assist' ? 0 : 1]!.action : null),
    })
    expect(worse.state.fighters.A3!.location).toBe('outOfAction')
    // a Pinned friend or one 1.5" away cannot assist
    const far = edit(s, (d) => {
      d.fighters.A5!.posture = 'pinned'
    })
    expect(playOut(far, dice(1, 1, 4, ...PRIORITY)).answered).not.toContain('end.assist')
    const away = place(s, { A5: { x: 0, z: -12 } })
    expect(playOut(away, dice(1, 1, 4, ...PRIORITY)).answered).not.toContain('end.assist')
  })

  it('END-008 a fighter that became Seriously Injured during the round makes a recovery test this End phase; one Out of Action does not', () => {
    const s = game(
      (d) => {
        down.ooa(d, 'A4')
      },
      { A3: { x: 0, z: -15 }, A1: { x: -9, z: -15 } },
    )
    // A3 is laid down by a real hit in A's own Action phase: B's rifle at point blank (hit 6, wound 6, injury 4)
    const dropped = edit(s, (d) => {
      d.fighters.A3!.posture = 'seriouslyInjured'
      d.fighters.A3!.ready = false
      d.casualties.push({ fighterId: 'A3', by: 'B3', cause: 'test', kind: 'seriouslyInjured', round: 1 })
    })
    const run = playOut(dropped, dice(1, 1, ...PRIORITY))
    expect(eventsOf(run.events, 'RecoveryTest').map((e) => e.fighterId)).toEqual(['A3'])
  })

  it('END-009 Rally: a Broken fighter passes a Cool test with +1 per friend within 3" not Broken or Seriously Injured and loses Broken', () => {
    const s = game(
      (d) => {
        down.broken(d, 'A4')
        down.si(d, 'A5') // within 3" but no support
        down.broken(d, 'A2') // within 3" but no support
      },
      { A4: { x: 0, z: -15 }, A3: { x: 2, z: -15 }, A5: { x: 0, z: -13 }, A2: { x: -3, z: -15 }, A1: { x: -10, z: -15 } },
    )
    // A5 is down (1 of 5: Bottle roll 1 holds) and recovers on a 4 (stays down, takes a Flesh Wound). A4 needs 7 less one supporter (A3): 6.
    // dice: bottle 1, recovery 4; rally in order A2 (Cl 6+, nobody steadies it: 2 + 3 = 5 fails), A4 (Cl 7+ less A3's help: 3 + 3 = 6 passes)
    const pass = playOut(s, dice(1, 4, 2, 3, 3, 3, ...PRIORITY))
    const rallies = eventsOf(pass.events, 'RallyTest')
    expect(rallies.map((e) => [e.fighterId, e.need, e.passed])).toEqual([
      ['A2', 6, false],
      ['A4', 6, true],
    ])
    expect(pass.state.fighters.A4!.conditions.broken).toBeUndefined()
    expect(pass.state.fighters.A2!.conditions.broken).toBeDefined()
    expect(query.rallyOdds(s, 'A4')).toMatchObject({ need: 7, modifier: 1 })
    // a 5 total is not enough
    const fail = playOut(s, dice(1, 4, 2, 3, 3, 2, ...PRIORITY))
    expect(eventsOf(fail.events, 'RallyTest').map((e) => e.passed)).toEqual([false, false])
    expect(fail.state.fighters.A4!.conditions.broken).toBeDefined()
  })

  it('END-010 voluntary flight: a bottled gang may leave at the start of the Action phase; an Engaged fighter must pass an Initiative test or is left Seriously Injured', () => {
    const s = game((d) => {
      d.players.A.bottled = true
      down.si(d, 'A5')
    })
    // round 1's End phase: the bottled gang's flee tests (the Leader passes, A2 and A3 follow it; A4 and A5 pass for themselves),
    // then A5's recovery roll (4: stays down); round 2's Action phase opens with the flight decision of the bottled seat
    const r1 = playOut(s, dice(6, 6, 6, 6, 6, 6, 4, ...PRIORITY))
    expect(r1.state.round).toBe(2)
    const ask = r1.pending!
    expect(ask.kind).toBe('action.flee')
    expect(ask.seat).toBe('A')
    expect(ask.options!.map((o) => o.id)).toEqual(['done', 'A1', 'A2', 'A3', 'A4'])
    // A2 leaves: Active fighters go automatically
    const left = must(step(r1.state, act.flee(ask, 'A2')))
    expect(eventsOf(left.events, 'FighterFled')).toEqual([expect.objectContaining({ fighterId: 'A2', voluntary: true })])
    expect(left.state.fighters.A2!.location).toBe('fled')
    expect(left.pending!.kind).toBe('action.flee')
    expect(left.pending!.options!.map((o) => o.id)).not.toContain('A2')
    // done ends the flight; the Action phase begins
    const done = must(step(left.state, act.fleeDone(left.pending!)))
    expect(done.pending!.kind).toBe('action.activate')
    // an Engaged fighter: fail the Initiative test (roll 1) and it is left Seriously Injured instead
    const engaged = edit(place(r1.state, { A3: { x: 0, z: 0 }, B3: { x: 0, z: 0.99 }, A4: { x: -6, z: -10 } }), (d) => {
      d.fighters.A3!.engagedWith = ['B3']
      d.fighters.B3!.engagedWith = ['A3']
    })
    const pend = engaged.pending!
    const fail = must(step(engaged, act.flee(pend, 'A3'), dice(1)))
    expect(eventsOf(fail.events, 'InitiativeTest')[0]).toMatchObject({ fighterId: 'A3', roll: 1, passed: false, reason: 'flee' })
    expect(fail.state.fighters.A3).toMatchObject({ location: 'board', posture: 'seriouslyInjured' })
    const pass = must(step(engaged, act.flee(pend, 'A3'), dice(6)))
    expect(pass.state.fighters.A3!.location).toBe('fled')
    // a Seriously Injured fighter cannot leave: A5 is not among the options above
    expect(r1.state.fighters.A5!.posture).toBe('seriouslyInjured')
  })

  it('END-011 nerve tests caused by a recovery roll are settled in the End phase: a friend that breaks runs for cover before the Rally tests', () => {
    // A3 is Seriously Injured and rolls Out of Action on recovery; A4 stands 1.5" away and fails its nerve test
    const s = game(
      (d) => {
        down.si(d, 'A3')
        for (const id of ['B1', 'B2', 'B3', 'B4', 'B5']) d.fighters[id]!.ready = true
      },
      { A3: { x: 0, z: -15 }, A4: { x: 1.8, z: -15 }, A1: { x: -10, z: -15 }, A2: { x: 10, z: -15 }, B1: { x: 0, z: 14 } },
    )
    // dice: Bottle 1 (1 down holds), recovery 6 (Out of Action), A4's nerve test 1 + 1 (fails), Running for Cover 2D6 3 + 3, Rally 6 + 6, Priority
    const run = playOut(s, dice(1, 6, 1, 1, 3, 3, 6, 6, ...PRIORITY))
    const order = run.events.map((e) => e.type).filter((t) => ['RecoveryTest', 'NerveTest', 'RunningForCover', 'RallyTest', 'FighterOutOfAction'].includes(t))
    expect(order).toEqual(['RecoveryTest', 'FighterOutOfAction', 'NerveTest', 'RunningForCover', 'RallyTest'])
    expect(run.state.fighters.A3!.location).toBe('outOfAction')
    expect(eventsOf(run.events, 'FighterMoved').filter((e) => e.kind === 'runForCover')).toHaveLength(1)
    expect(run.state.fighters.A4!.conditions.broken).toBeUndefined()
    expect(run.state.nerve).toEqual([])
  })
})
