import { describe, expect, it } from 'vitest'
import { act, step, ScriptedRng, type GameState } from '@/engine'
import { attackBundle, dice } from '../fixtures/attack'
import { edit, endRound, eventsOf, must, offered, place, playOut, startGame, take } from '../fixtures/helpers'

describe('ROUND: rounds, the Priority phase, alternation and group activation', () => {
  it('ROUND-001 round 1 priority ties re-roll; a later tie hands priority to the player who did not hold it last round', () => {
    // round 1: 3-3 tie re-rolls, then A 2 / B 5 -> B holds priority
    const rng = new ScriptedRng([3, 3, 2, 5, 4, 4])
    const r1 = startGame({ firstPriority: null, rng })
    const decided = eventsOf(r1.events, 'PriorityDecided')[0]!
    expect(decided).toMatchObject({ holder: 'B', tieRule: false, rolls: { A: 2, B: 5 } })
    expect(eventsOf(r1.events, 'DiceRolled').filter((e) => e.purpose === 'priority')).toHaveLength(4)
    expect(r1.state.priority).toBe('B')
    expect(r1.pending).toMatchObject({ kind: 'action.activate', seat: 'B' })
    // round 2: a 4-4 tie passes priority from B to A
    const r2 = endRound(r1.state, rng)
    expect(r2.state.round).toBe(2)
    expect(eventsOf(r2.events, 'PriorityDecided')[0]).toMatchObject({ holder: 'A', tieRule: true })
    expect(r2.pending?.seat).toBe('A')
  })

  it('ROUND-001 firstPriority skips the round-1 roll; every fighter on the board becomes Ready whatever its status', () => {
    const r = startGame({ firstPriority: 'B' })
    expect(r.state.priority).toBe('B')
    expect(eventsOf(r.events, 'DiceRolled').filter((e) => e.purpose === 'priority')).toHaveLength(0)
    expect(Object.values(r.state.fighters).every((f) => f.ready)).toBe(true)
    const ready = eventsOf(r.events, 'FightersReadied')[0]!
    expect(ready.fighterIds).toHaveLength(10)
  })

  it('ROUND-002 activations alternate starting with the priority player; a fighter without Ready cannot be activated', () => {
    let r = startGame({ firstPriority: 'A' })
    const seats: string[] = []
    for (let i = 0; i < 4; i++) {
      seats.push(r.pending!.seat)
      const id = (r.pending!.options![0]!.action.payload as { fighterId: string }).fighterId
      r = take(r.state, { fighterId: id })
      if (r.pending?.kind === 'action.group') r = must(step(r.state, act.groupDone(r.pending)))
      r = must(step(r.state, act.endActivation(r.pending!)))
    }
    expect(seats).toEqual(['A', 'B', 'A', 'B'])
    // A1 was among the first activations of A (options start with the roster order): it is no longer offered
    const first = r.state.fighters.A1!
    expect(first.ready).toBe(false)
    expect(offered(r.state)).not.toContain('A1')
    const bad = step(r.state, act.activate(r.pending!, 'A1'))
    expect(bad.rejection?.code).toBe('E_ACTION_RESTRICTED')
    expect(bad.state).toBe(r.state)
  })

  it('ROUND-003 a Leader may group-activate at most 2 Ready friends within 3 inches, a Champion at most 1; a fighter 3.1 inches away is rejected', () => {
    const base = startGame().state
    // leader A1 in the middle of the row; A3 2.9 inches away (edge to edge), A4 3.1 inches, A5 1 inch, champion A2 far
    const edge = (gap: number, r: number) => gap + r + base.fighters.A1!.baseRadius
    const s = place(base, {
      A1: { x: 0, z: -10 },
      A3: { x: edge(2.9, base.fighters.A3!.baseRadius), z: -10 },
      A4: { x: -edge(3.1, base.fighters.A4!.baseRadius), z: -10 },
      A5: { x: 0, z: -10 + edge(1, base.fighters.A5!.baseRadius) },
      A2: { x: 9, z: -10 },
    })
    let r = take(s, { fighterId: 'A1' })
    expect(r.pending?.kind).toBe('action.group')
    expect(offered(r.state).sort()).toEqual(['A3', 'A5', 'done'])
    expect(r.pending!.context).toMatchObject({ max: 2, left: 2 })
    // the far fighter is rejected with a range code
    const far = step(r.state, act.group(r.pending!, 'A4'))
    expect(far.rejection?.code).toBe('E_OUT_OF_RANGE')
    r = must(step(r.state, act.group(r.pending!, 'A3')))
    expect(r.pending?.kind).toBe('action.group')
    expect(r.pending!.context).toMatchObject({ left: 1 })
    r = must(step(r.state, act.group(r.pending!, 'A5')))
    // two nominated: the cap is reached, the leader acts
    expect(r.pending?.kind).toBe('action.choose')
    expect(eventsOf(r.events, 'GroupNominated')[0]).toMatchObject({ leaderId: 'A1', fighterIds: ['A3', 'A5'] })

    // a Champion (X = 1) may nominate one
    const c = place(base, { A2: { x: 0, z: -10 }, A3: { x: 1.5, z: -10 }, A4: { x: -1.5, z: -10 } })
    let rc = take(c, { fighterId: 'A2' })
    expect(rc.pending!.context).toMatchObject({ max: 1 })
    rc = must(step(rc.state, act.group(rc.pending!, 'A3')))
    expect(rc.pending?.kind).toBe('action.choose')
    expect(eventsOf(rc.events, 'GroupNominated')[0]!.fighterIds).toEqual(['A3'])
  })

  it('ROUND-003 a fighter with no Group Activation rule never raises a group decision', () => {
    const s = place(startGame().state, { A3: { x: 0, z: -10 }, A4: { x: 1.5, z: -10 } })
    const r = take(s, { fighterId: 'A3' })
    expect(r.pending?.kind).toBe('action.choose')
  })

  it('ROUND-004 all group members are nominated before any acts; each finishes its whole activation before the next starts', () => {
    const base = startGame().state
    const s = place(base, { A1: { x: 0, z: -10 }, A3: { x: 1.8, z: -10 }, A5: { x: -1.8, z: -10 } })
    let r = take(s, { fighterId: 'A1' })
    r = must(step(r.state, act.group(r.pending!, 'A3')))
    r = must(step(r.state, act.group(r.pending!, 'A5')))
    // nominated members are still Ready and nobody but the leader has activated
    expect(r.state.fighters.A3!.ready && r.state.fighters.A5!.ready).toBe(true)
    expect(r.state.action.activation?.fighterId).toBe('A1')
    // the leader's whole activation first
    r = must(step(r.state, act.endActivation(r.pending!)))
    expect(r.pending).toMatchObject({ kind: 'action.activate', seat: 'A' })
    expect(offered(r.state).sort()).toEqual(['A3', 'A5'])
    // the owner chooses the order; a member cannot lead its own group
    r = take(r.state, { fighterId: 'A5' })
    expect(r.pending?.kind).toBe('action.choose')
    expect(r.state.action.activation).toMatchObject({ fighterId: 'A5', groupLeaderId: 'A1' })
    r = must(step(r.state, act.endActivation(r.pending!)))
    expect(offered(r.state)).toEqual(['A3'])
    r = take(r.state, { fighterId: 'A3' })
    r = must(step(r.state, act.endActivation(r.pending!)))
    // the group is spent: the opponent's turn
    expect(r.state.action.group).toBeNull()
    expect(r.pending).toMatchObject({ kind: 'action.activate', seat: 'B' })
  })

  it('ROUND-004 a group member that is itself a Champion does not get to nominate when activated as a member', () => {
    const s = place(startGame().state, { A1: { x: 0, z: -10 }, A2: { x: 1.8, z: -10 }, A3: { x: 0, z: -8 } })
    let r = take(s, { fighterId: 'A1' })
    r = must(step(r.state, act.group(r.pending!, 'A2')))
    r = must(step(r.state, act.groupDone(r.pending!)))
    r = must(step(r.state, act.endActivation(r.pending!)))
    r = take(r.state, { fighterId: 'A2' })
    expect(r.pending?.kind).toBe('action.choose')
  })

  it('ROUND-005 when one side has no Ready fighters the other activates all its remaining Ready fighters in a row', () => {
    let s = startGame({ firstPriority: 'A' }).state
    s = edit(s, (d) => {
      for (const f of Object.values(d.fighters)) if (f.seat === 'B') f.ready = false
    })
    let r = take(s, { fighterId: 'A1' })
    r = must(step(r.state, act.groupDone(r.pending!)))
    r = must(step(r.state, act.endActivation(r.pending!)))
    // B has nobody Ready: A keeps the turn
    const seen = ['A1']
    while (r.pending?.kind === 'action.activate') {
      expect(r.pending.seat).toBe('A')
      const id = (r.pending.options![0]!.action.payload as { fighterId: string }).fighterId
      seen.push(id)
      r = take(r.state, { fighterId: id })
      if (r.pending?.kind === 'action.group') r = must(step(r.state, act.groupDone(r.pending)))
      r = must(step(r.state, act.endActivation(r.pending!)))
      if (r.state.round !== 1) break
    }
    expect(seen).toHaveLength(5)
    expect(r.state.round).toBe(2)
  })

  it('the Action phase ends when no Ready fighter remains and the End phase hands over to the next round', () => {
    const r = startGame().state
    const end = endRound(r)
    expect(end.state.round).toBe(2)
    expect(eventsOf(end.events, 'ActivationEnded').length).toBeGreaterThan(0)
    expect(eventsOf(end.events, 'PhaseEnded').map((e) => e.name)).toEqual(['action', 'end', 'priority'])
    expect(eventsOf(end.events, 'RoundEnded')[0]!.round).toBe(1)
  })
})

describe('ROUND: the End phase order and the end of the battle', () => {
  const PRIORITY = [3, 4]
  const everyoneApart = (s: GameState) => {
    const spots: Parameters<typeof place>[1] = {}
    ;['A', 'B'].forEach((seat, i) => ['1', '2', '3', '4', '5'].forEach((n, k) => (spots[seat + n] = { x: -10 + k * 5, z: i === 0 ? -16 : 16 })))
    return place(s, spots)
  }

  it('ROUND-006 the End phase runs Bottle, Flee, Recovery, Rally in that order, then the clean-up', () => {
    // A: A4 and A5 Out of Action, A3 Seriously Injured (3 down of 5: a Bottle roll of 3 makes 6 and bottles the gang), A2 Broken.
    // Fighters of A close together so the Leader's example carries A2 and A3; a Smoke cloud waits for the clean-up.
    const base = startGame({ bundle: attackBundle }).state
    const s = edit(everyoneApart(base), (d) => {
      for (const id of ['A4', 'A5']) {
        d.fighters[id]!.location = 'outOfAction'
        d.fighters[id]!.ready = false
      }
      d.fighters.A3!.posture = 'seriouslyInjured'
      d.fighters.A3!.ready = false
      d.fighters.A2!.conditions.broken = { since: 1 }
      d.fighters.A2!.ready = false
      d.fighters.A1!.pos = { x: 0, y: 0, z: -15 }
      d.fighters.A2!.pos = { x: 3, y: 0, z: -15 }
      d.fighters.A3!.pos = { x: -3, y: 0, z: -15 }
      d.board.smoke.push({ id: 'smoke1', pos: { x: 0, z: 0 }, radius: 2.5, placedRound: 1 })
    })
    // Bottle 3 (bottled), Leader flee 6 + 6 (passes, carries A2 and A3), recovery of A3: 1 (Flesh Wound), Rally of A2: 6 + 6, smoke 2 (cleared), Priority
    const run = playOut(s, dice(3, 6, 6, 1, 6, 6, 2, ...PRIORITY))
    const order = run.events
      .filter((e) => ['BottleTest', 'FleeTest', 'RecoveryTest', 'RallyTest', 'SmokeCleared', 'PhaseEnded', 'RoundEnded'].includes(e.type) && (e.type !== 'PhaseEnded' || e.name === 'end'))
      .map((e) => e.type)
    expect(order).toEqual(['BottleTest', 'FleeTest', 'FleeTest', 'FleeTest', 'RecoveryTest', 'RallyTest', 'SmokeCleared', 'PhaseEnded', 'RoundEnded'])
    expect(run.state.fighters.A3).toMatchObject({ posture: 'pinned', fleshWounds: 1 })
    expect(run.state.fighters.A2!.conditions.broken).toBeUndefined()
    expect(run.state.board.smoke).toHaveLength(0)
    expect(run.state.round).toBe(2)
  })

  it('ROUND-007 the battle ends at the end of a round when only one gang has non-Seriously-Injured fighters on the board', () => {
    const base = startGame({ bundle: attackBundle }).state
    // B keeps one Seriously Injured fighter on the board and the rest are gone: B counts as nobody standing
    const over = edit(everyoneApart(base), (d) => {
      for (const id of ['B2', 'B3', 'B4', 'B5']) {
        d.fighters[id]!.location = 'outOfAction'
        d.fighters[id]!.ready = false
      }
      d.fighters.B1!.posture = 'seriouslyInjured'
      d.fighters.B1!.ready = false
      d.players.A.points = 3
    })
    // B's Bottle roll 1 (5 down of 5: 6 > 5 bottles it anyway), its flee test for B1 (6 + 6), B1's recovery die 4 (stays down)
    const run = playOut(over, dice(1, 6, 6, 4))
    expect(run.state.phase).toBe('ended')
    expect(run.state.result).toMatchObject({ winner: 'A', reason: 'scenario', points: { A: 3, B: 0 } })
    expect(eventsOf(run.events, 'GameEnded')).toHaveLength(1)
    expect(eventsOf(run.events, 'RoundEnded')).toHaveLength(1)
    expect(run.state.pending).toBeNull()

    // both gangs still have a Standing fighter: the round counter moves on
    const both = playOut(everyoneApart(base), dice(...PRIORITY))
    expect(both.state.phase).toBe('action')
    expect(both.state.round).toBe(2)
    // a gang whose recovering fighter gets up (Pinned is not Seriously Injured) is still in the battle
    const rising = edit(over, (d) => {
      d.players.A.points = 0
    })
    const up = playOut(rising, dice(1, 6, 6, 1, ...PRIORITY))
    // B1 fled (6 + 6 passed): it is still there; the Flesh Wound result stands it up as a Pinned fighter, so B is not out of the battle
    expect(up.state.fighters.B1).toMatchObject({ location: 'board', posture: 'pinned' })
    expect(up.state.phase).toBe('action')
    expect(up.state.round).toBe(2)
  })
})
