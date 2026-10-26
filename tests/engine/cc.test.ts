import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import type { GameEvent } from '@/engine'
import { dice, meleeGame, optionWhere, R, TOUCH, answer } from '../fixtures/melee'
import { eventsOf, must } from '../fixtures/helpers'

const N = 0
const S = Math.PI

/** Choose an action.choose option by its payload fields. */
const choose = (s: Parameters<typeof optionWhere>[0], where: Record<string, unknown>) => optionWhere(s, where)

const hitRolls = (events: GameEvent[]) => eventsOf(events, 'FightHitRolled')
const mods = (e: { modifiers: { label: string; value: number }[] }) => Object.fromEntries(e.modifiers.map((m) => [m.label, m.value]))

describe('CC: close combat (R-10)', () => {
  it('CC-001 turning to face before attacking applies -1 to all of that fighter\'s hit rolls', () => {
    // A3 faces away from B3 (south) and must turn to attack it
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: S }, B3: { x: 0, z: -10 + TOUCH, facing: S } }, active: 'A3' })
    const rng = dice(4, 1) // A3 hits on 5+ after turning: 4 misses; B3 reacts with a 1
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    const [a3, b3] = hitRolls(r.events)
    expect(eventsOf(r.events, 'FighterTurned').find((e) => e.fighterId === 'A3' && !e.free)).toBeDefined()
    expect(a3).toMatchObject({ targetId: 'B3', dice: [4], need: 5 })
    expect(mods(a3!)).toMatchObject({ turnedToFace: -1 })
    expect(b3).toMatchObject({ targetId: 'A3', need: 4 })
    expect(rng.remaining).toBe(0)
    // facing the enemy already: no penalty
    const facing = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } }, active: 'A3' })
    const r2 = must(answer(facing, choose(facing, { action: 'fight' }), dice(3, 1)))
    expect(hitRolls(r2.events)[0]).toMatchObject({ need: 4, modifiers: [] })
  })

  it('CC-002 a Pinned fighter stood up by a charge takes -1 on its reaction attacks', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: S, posture: 'pinned' } }, active: 'A3' })
    const rng = dice(1, 1, 1, 1) // D3, A3's two charge dice, B3's reaction die
    const r = must(answer(s, choose(s, { action: 'charge', targetId: 'B3' }), rng))
    const b3 = hitRolls(r.events).find((e) => e.targetId === 'A3')!
    expect(mods(b3)).toMatchObject({ stoodUpByCharge: -1 })
    expect(b3.need).toBe(5)
    expect(rng.remaining).toBe(0)
  })

  it('CC-003 a sidearm in melee takes only one die, uses WS, ignores accuracy and rolls a Firepower dice', () => {
    // the leader (A 2, WS 3+) with a pistol (+1 short accuracy, Ammo 4+): one die with the pistol, the other unarmed
    const s = meleeGame({
      spots: { A1: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 0.63 + R + 0.002, facing: S } },
      loadouts: { A1: { weapons: ['cc.w.stub'] } },
      active: 'A1',
    })
    let r = must(step(s, choose(s, { action: 'fight' })))
    expect(r.pending!.kind).toBe('fight.weapons')
    const rng = dice(1, 2, 1, 1) // pistol hit, its Firepower dice (no Ammo symbol), unarmed hit, B3's reaction
    r = must(answer(r.state, optionWhere(r.state, { weaponIds: ['cc.w.stub'] }), rng))
    const [pistol, fist] = hitRolls(r.events)
    expect(pistol).toMatchObject({ weaponId: 'cc.w.stub', dice: [1], need: 3, modifiers: [] })
    expect(fist).toMatchObject({ weaponId: 'unarmed', dice: [1], need: 3 })
    expect(r.events.filter((e) => e.type === 'DiceRolled' && e.purpose === 'firepower')).toHaveLength(1)
    expect(rng.remaining).toBe(0)
  })

  it('CC-004 charging a target not visible at the start of the charge applies -1 to hit', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: S }, B3: { x: 0, z: -6, facing: S } }, active: 'A3' })
    const opt = s.pending!.options!.find((o) => o.id === 'charge:B3')!
    expect(opt.data).toMatchObject({ visible: false, pReach: 1 })
    const rng = dice(6, 1, 1, 1)
    const r = must(answer(s, opt.action, rng))
    const a3 = hitRolls(r.events).find((e) => e.targetId === 'B3')!
    expect(a3.dice).toHaveLength(2)
    expect(mods(a3)).toMatchObject({ chargeWithoutSight: -1 })
    expect(mods(a3).turnedToFace).toBeUndefined()
  })

  it('CC-005 each friend engaged only with the target gives +1; each extra enemy engaged only with the attacker gives -1', () => {
    const s = meleeGame({
      spots: {
        B3: { x: 0, z: 0, facing: S },
        A3: { x: 0, z: -TOUCH, facing: N },
        A4: { x: 0, z: TOUCH, facing: S },
        B4: { x: -TOUCH, z: -TOUCH, facing: Math.PI / 2 },
      },
      active: 'A3',
    })
    expect(s.fighters.A3!.engagedWith).toEqual(['B3', 'B4'])
    const r = must(answer(s, choose(s, { action: 'fight' }), dice(1, 1, 1)))
    const a3 = hitRolls(r.events)[0]!
    expect(a3.targetId).toBe('B3') // B4 is outside A3's arc
    expect(mods(a3)).toMatchObject({ assist: 1, interference: -1 })
    expect(a3.need).toBe(4)
  })

  it('CC-006 engaged enemies still Standing react after the attacker\'s hits; Seriously Injured ones do not', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S }, B4: { x: -TOUCH, z: -10, facing: Math.PI / 2 } },
      active: 'A3',
    })
    // A3 has B3 in arc: hit 6, wound 6, injury 3 (Seriously Injured); B4 then tests nerve (6,6) and reacts (1)
    const rng = dice(6, 6, 3, 6, 6, 1)
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    expect(r.state.fighters.B3!.posture).toBe('seriouslyInjured')
    expect(eventsOf(r.events, 'ReactionStarted').map((e) => e.fighterId)).toEqual(['B4'])
    expect(rng.remaining).toBe(0)
  })

  it('CC-007 a Broken fighter\'s reaction attacks are at -2', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } },
      tweak: (d) => {
        d.fighters.B3!.conditions.broken = { since: 1 }
      },
      active: 'A3',
    })
    const r = must(answer(s, choose(s, { action: 'fight' }), dice(1, 1)))
    const b3 = hitRolls(r.events).find((e) => e.targetId === 'A3')!
    expect(mods(b3)).toMatchObject({ brokenReaction: -2 })
    expect(b3.need).toBe(6)
  })

  it('CC-008 Parry forces one successful hit to be re-rolled; a Power weapon is not parried by a non-Power Parry weapon', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } },
      loadouts: { B3: { weapons: ['cc.w.blade'] } },
      active: 'A3',
    })
    // A3 unarmed hits with a 5, B3 parries: the re-roll is a 1; B3 then reacts with its blade (first option) and misses
    const rng = dice(5, 1, 1)
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    expect(eventsOf(r.events, 'Parried')).toEqual([expect.objectContaining({ by: 'B3', rerolled: [1] })])
    expect(eventsOf(r.events, 'WoundRolled')).toHaveLength(0)
    expect(rng.remaining).toBe(0)
    // a Power weapon against the same non-Power Parry weapon: no re-roll, the hit stands (wound roll 1 fails)
    const p = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } },
      loadouts: { A3: { weapons: ['cc.w.power'] }, B3: { weapons: ['cc.w.blade'] } },
      active: 'A3',
    })
    let r2 = must(step(p, choose(p, { action: 'fight' })))
    r2 = must(answer(r2.state, optionWhere(r2.state, { weaponIds: ['cc.w.power'] }), dice(5, 1, 1)))
    expect(eventsOf(r2.events, 'Parried')).toHaveLength(0)
    expect(eventsOf(r2.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'B3', roll: 1 })
    // a Power Parry weapon does parry it
    const pp = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } },
      loadouts: { A3: { weapons: ['cc.w.power'] }, B3: { weapons: ['cc.w.power-parry'] } },
      active: 'A3',
    })
    let r3 = must(step(pp, choose(pp, { action: 'fight' })))
    r3 = must(answer(r3.state, optionWhere(r3.state, { weaponIds: ['cc.w.power'] }), dice(5, 1, 1)))
    expect(eventsOf(r3.events, 'Parried')).toHaveLength(1)
  })

  it('CC-009 with every engaged enemy down the attacker may consolidate up to 2" or take a free Coup de Grace, not both', () => {
    const s = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } }, active: 'A3' })
    const r = must(answer(s, choose(s, { action: 'fight' }), dice(6, 6, 3)))
    expect(r.pending!.kind).toBe('fight.after')
    expect(r.pending!.options!.map((o) => o.id)).toEqual(['cdg:B3', 'consolidate', 'none'])
    // Coup de Grace: the sequence ends (no consolidate move follows) and the Fight is paid
    const cdg = must(step(r.state, optionWhere(r.state, { choice: 'coupDeGrace', targetId: 'B3' })))
    expect(cdg.state.fighters.B3!.location).toBe('outOfAction')
    expect(cdg.pending!.kind).toBe('action.choose')
    expect(cdg.state.action.activation!.performed.map((p) => `${p.action}:${p.type}`)).toEqual(['coupDeGrace:free', 'fight:basic'])
    // consolidate: a 2" move.path, then back to the menu with B3 left Seriously Injured
    const con = must(step(r.state, optionWhere(r.state, { choice: 'consolidate' })))
    expect(con.pending!.constraints).toMatchObject({ kind: 'consolidate', maxInches: 2 })
    expect(step(con.state, { type: 'move.path', seat: 'A', decisionId: con.pending!.id, payload: { waypoints: [{ x: 0, z: -12.5 }] } }).rejection?.code).toBe('E_OUT_OF_RANGE')
    const moved = must(step(con.state, { type: 'move.path', seat: 'A', decisionId: con.pending!.id, payload: { waypoints: [{ x: 1.5, z: -10 }] } }))
    expect(eventsOf(moved.events, 'Consolidated')).toHaveLength(1)
    expect(moved.state.fighters.B3!.posture).toBe('seriouslyInjured')
    expect(moved.pending!.kind).toBe('action.choose')
  })
})
