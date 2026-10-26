import { describe, expect, it } from 'vitest'
import { createGame, step } from '@/engine'
import { ScriptedRng } from '@/engine/rng'
import { removeNow } from '@/engine/effects'
import type { GameEvent } from '@/engine/events'
import type { GameState } from '@/engine/types'
import { play } from '../fixtures/attack'
import { feature, part, rect } from '../fixtures/maps'
import { drive, place } from '../fixtures/helpers'
import { activateOp, edit, hasOption, openReal, opOf, optionIds, passIt, realBundle, roster, realSetupWith, take, withCtx, type RealOpts } from '../fixtures/real'

// End-to-end rules through the REAL bundle (bundleFromData + realSetup): the game-layer hooks must fire inside a live
// Shoot or Fight, not just when a test calls the hook directly.

const tactics = (primary: string, secondary = 'mobile') => ({ A: { 'primary-tactic': `aod.a.ct-${primary}`, 'secondary-tactic': `aod.a.ct-${secondary}` }, B: {} })
const NEUTRAL: RealOpts = { teamChoices: tactics('mobile', 'resolute') }
const PLAIN: RealOpts = { teamChoices: tactics('mobile', 'aggressive') }

const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })
const noPloys = { 'ploy.firefight': pass }

const count = (events: GameEvent[], type: string) => events.filter((e) => e.type === type).length
const strikes = (events: GameEvent[]) => events.filter((e) => e.type === 'Struck').map((e) => (e as { amount: number }).amount)

/** A: the marine at the origin; B: the boy at (dx, 0). Both beefed up so that nothing dies. */
function duel(o: RealOpts, dx: number, fighter = 'aod.intercessor-warrior', foe = 'kom.boy') {
  let s = openReal(o)
  const a = opOf(s, 'A', fighter)
  const b = opOf(s, 'B', foe)
  s = edit(place(place(s, a, 0, 0), b, dx, 0), (st) => {
    st.operatives[a]!.wounds = st.operatives[a]!.maxWounds = 60
    st.operatives[b]!.wounds = st.operatives[b]!.maxWounds = 60
  })
  return { s, a, b }
}

describe('TEAM-AOD integration', () => {
  it('TEAM-AOD-005 Dueller: in a live Fight a normal success may block a crit (and not without the tactic)', () => {
    const run = (o: RealOpts) => {
      const { s, a } = duel(o, 1.5)
      let t = activateOp(s, a)
      t = take(t, 'fight').state
      // marine 4,4,1,1 (two normals); boy 6,6,1,1 (two crits)
      return play(t, new ScriptedRng([4, 4, 1, 1, 6, 6, 1, 1, 1, 1, 1, 1]), noPloys, ['fight.resolve', 'firefight.action']).state
    }
    const dueller = run({ teamChoices: tactics('dueller') })
    expect(dueller.pending!.kind).toBe('fight.resolve')
    const block = optionIds(dueller).find((id) => id.startsWith('block:'))!
    expect(block).toBeDefined()
    const blocked = take(dueller, block)
    expect(blocked.events.find((e) => e.type === 'Blocked')).toMatchObject({ die: 'normal', against: 'crit' })
    const plain = run(NEUTRAL)
    expect(plain.pending!.kind).toBe('fight.resolve')
    expect(optionIds(plain).some((id) => id.startsWith('block:'))).toBe(false)
  })
})

/** B's boy shoots A's marine from 5"; `dice` are the attack dice then the defence dice. */
function boyShoots(o: RealOpts, dice: number[], tweak?: (s: GameState, marine: string, boy: string) => GameState, answers: Parameters<typeof play>[2] = noPloys) {
  let s = openReal(o)
  const marine = opOf(s, 'A', 'aod.intercessor-warrior')
  const boy = opOf(s, 'B', 'kom.boy')
  s = place(place(s, marine, 0, 0), boy, 5, 0)
  if (tweak) s = tweak(s, marine, boy)
  s = activateOp(s, opOf(s, 'A', 'aod.eliminator-sniper'))
  s = take(s, 'end').state
  s = activateOp(s, boy)
  s = take(s, 'shoot').state
  const r = play(s, new ScriptedRng(dice), answers)
  return { ...r, marine, boy, wounds: r.state.operatives[marine]!.wounds }
}

const withFeatures = (s: GameState, ...features: GameState['map']['features']): GameState =>
  edit(s, (st) => {
    st.map = { ...st.map, features }
  })

describe('TEAM-AOD defence integration', () => {
  it('TEAM-AOD-005 Hardy: defence 5s are crits in a live Shoot, so two blocks beat two crits', () => {
    // slugga 6,6 (two crits) 1,1; defence 5,5,1: only with Hardy do the 5s block crits one for one
    const plain = boyShoots(NEUTRAL, [6, 6, 1, 1, 5, 5, 1])
    expect(plain.wounds).toBe(14 - 4) // two normals block one crit; the other crit lands (4)
    const hardy = boyShoots({ teamChoices: tactics('hardy') }, [6, 6, 1, 1, 5, 5, 1])
    expect(hardy.wounds).toBe(14)
  })

  it('TEAM-AOD-005 Stealthy: a retained cover save brings one extra success in a live Shoot', () => {
    // the marine holds Engage (a Conceal target in cover cannot be shot at all)
    const rubble = (s: GameState, marine: string) =>
      edit(withFeatures(s, feature('rubble', part('rubble.a', rect(1.2, 1.6, -2, 2), 0.5, ['light']))), (st) => {
        st.operatives[marine]!.order = 'engage'
      })
    // slugga 4,4 (two normals) 1,1; cover save retained, defence rolls 1,1: one block, or two with Stealthy
    const plain = boyShoots(NEUTRAL, [4, 4, 1, 1, 1, 1], rubble)
    expect(count(plain.events, 'CoverSaveRetained')).toBe(1)
    expect(plain.wounds).toBe(14 - 3)
    const stealthy = boyShoots({ teamChoices: tactics('stealthy') }, [4, 4, 1, 1, 1, 1], rubble)
    expect(stealthy.wounds).toBe(14)
  })
})

const pickTarget = (id: string) => (p: { options?: { id: string; action: never }[] }) => p.options?.find((o) => o.id === id)?.action ?? null
const pickWeapon = pickTarget

describe('TEAM-AOD attack integration', () => {
  it('TEAM-AOD-002 ASTARTES: two Shoot actions in a live activation; repeating the sniper rifle costs 1 more AP', () => {
    const SNIPER = 'aod.w.bolt-sniper-rifle-executioner'
    const setup = () => {
      let s = openReal(PLAIN)
      const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
      const boss = opOf(s, 'B', 'kom.boss-nob')
      s = edit(place(place(s, sniper, 0, 0), boss, 6, 0), (st) => {
        st.operatives[boss]!.wounds = st.operatives[boss]!.maxWounds = 99
      })
      return { s: activateOp(s, sniper), sniper, boss }
    }
    const spent: number[] = []
    const shootOnce = (t: GameState, boss: string, weapon: string): GameState => {
      const r = play(take(t, 'shoot').state, new ScriptedRng(Array(40).fill(1)), { ...noPloys, 'shoot.weapon': pickWeapon(weapon) as never, 'shoot.target': pickTarget(boss) as never })
      spent.push(...r.events.filter((e) => e.type === 'ApSpent').map((e) => (e as { amount: number }).amount))
      return r.state
    }

    // same rifle twice: 1 + (1 + 1 surcharge) = 3 AP
    const a = setup()
    let t = shootOnce(a.s, a.boss, SNIPER)
    expect(t.firefight.activation!.apSpent).toBe(1)
    expect(hasOption(t, 'shoot')).toBe(true)
    t = shootOnce(t, a.boss, SNIPER)
    expect(spent).toEqual([1, 2]) // the second Shoot paid the surcharge, and the activation is over
    expect(t.firefight.activation).toBeNull()

    // the pistol for the second Shoot has no surcharge: 2 AP
    const b = setup()
    spent.length = 0
    t = shootOnce(b.s, b.boss, SNIPER)
    t = shootOnce(t, b.boss, 'aod.w.bolt-pistol')
    expect(spent).toEqual([1, 1])
    expect(t.firefight.activation!.apSpent).toBe(2)

    // with 2 APL the repeated rifle (2 AP) no longer fits after the first Shoot, but the pistol does
    const c = setup()
    t = shootOnce(c.s, c.boss, SNIPER)
    t = take(
      edit(t, (st) => {
        st.operatives[c.sniper]!.aplMods = -1
      }),
      'shoot',
    ).state
    expect(t.pending!.kind).toBe('shoot.weapon')
    expect(optionIds(t)).not.toContain(SNIPER)
    expect(optionIds(t)).toContain('aod.w.bolt-pistol')
  })
})

describe('TEAM-AOD target.status integration', () => {
  it('TEAM-AOD-008 OPTICS: the Eliminator shoots an obscured Kommando as if it were not obscured', () => {
    const shoot = (optics: boolean) => {
      let s = openReal(PLAIN)
      const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
      const boss = opOf(s, 'B', 'kom.boss-nob')
      // a low Heavy wall across the line of sight, away from both bases: the target is visible but obscured
      s = edit(withFeatures(place(place(s, sniper, 0, 0), boss, 8, 0), feature('wall', part('wall.a', rect(3, 3.4, -3, 3), 1, ['heavy']))), (st) => {
        st.operatives[boss]!.order = 'engage'
        st.operatives[boss]!.wounds = st.operatives[boss]!.maxWounds = 99
      })
      s = activateOp(s, sniper)
      if (optics) s = take(s, 'ability:aod.a.optics').state
      s = take(s, 'shoot').state
      // executioner 6,5,4,3 (four successes) against a failed defence
      return play(s, new ScriptedRng([6, 5, 4, 3, 1, 1, 1, 1]), { ...noPloys, 'shoot.weapon': pickWeapon('aod.w.bolt-sniper-rifle-executioner') as never, 'shoot.target': pickTarget(boss) as never }).events
    }
    const plain = shoot(false)
    expect(plain.find((e) => e.type === 'TargetSelected')).toMatchObject({ obscured: true })
    const optics = shoot(true)
    expect(optics.find((e) => e.type === 'TargetSelected')).toMatchObject({ obscured: false })
    // obscured discards one success before the defender rolls
    const retained = (ev: GameEvent[]) => ev.find((e) => e.type === 'AttackRetained') as unknown as { normal: number; crit: number }
    expect(retained(plain).normal + retained(plain).crit).toBe(retained(optics).normal + retained(optics).crit - 1)
  })
})

/** Like openReal, but A answers its first Strategy gambit with `gambit` (an option id). */
function openAfterGambit(o: RealOpts, gambit: string): GameState {
  const first = createGame(realSetupWith(o), 'gambit', realBundle).state
  const rng = new ScriptedRng([6, 1, 6, 1])
  let s = drive(first, (st) => st.pending?.kind === 'strategy.gambit', 800, rng)
  s = take(s, gambit, rng).state
  s = drive(s, (st) => st.pending?.kind === 'firefight.activate', 800, rng)
  return edit(s, (st) => {
    st.map = { ...st.map, features: [] }
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
    st.markers = st.markers.filter((m) => m.kind === 'objective')
    st.equipment.placed = []
  })
}

describe('Auspex integration', () => {
  it('Auspex: enemies within 8" of the Shoot cannot be obscured, so the shot keeps every success', () => {
    const shot = (auspex: boolean) => {
      let s = openReal({ ...PLAIN, equipmentA: ['aod.e.auspex'] })
      const marine = opOf(s, 'A', 'aod.intercessor-warrior')
      const boy = opOf(s, 'B', 'kom.boy')
      s = edit(withFeatures(place(place(s, marine, 0, 0), boy, 5, 0), feature('wall', part('wall.a', rect(2, 2.4, -3, 3), 1, ['heavy']))), (st) => {
        st.operatives[boy]!.order = 'engage'
      })
      s = take(activateOp(s, marine), 'shoot').state
      return play(s, new ScriptedRng(Array(20).fill(5)), {
        ...noRerolls,
        'shoot.target': pickTarget(boy) as never,
        'ploy.firefight': (q) => (auspex ? q.options!.find((o) => o.id === 'aod.e.auspex')?.action ?? pass(q) : pass(q)),
      }).events
    }
    expect(shot(false).find((e) => e.type === 'TargetSelected')).toMatchObject({ obscured: true })
    expect(shot(true).find((e) => e.type === 'TargetSelected')).toMatchObject({ obscured: false })
  })
})

describe('TEAM-AOD doctrine integration', () => {
  it('TEAM-AOD-004 Combat Doctrine (Tactical): a Shoot within 6" gets Balanced, so a re-roll is offered', () => {
    const run = (gambit: string) => {
      let s = openAfterGambit(PLAIN, gambit)
      const w = opOf(s, 'A', 'aod.intercessor-warrior')
      const boy = opOf(s, 'B', 'kom.boy')
      s = edit(place(place(s, w, 0, 0), boy, 4, 0), (st) => {
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 99
      })
      s = take(activateOp(s, w), 'shoot').state
      // bolt rifle: 1,1,1,1 (all fail) so a re-roll is worth it
      return play(s, new ScriptedRng(Array(30).fill(1)), { ...noPloys, 'shoot.target': pickTarget(boy) as never }, ['dice.reroll', 'dice.commandReroll', 'firefight.action'])
    }
    const tactical = run('aod.p.combat-doctrine:tactical')
    expect(tactical.state.pending).toMatchObject({ kind: 'dice.reroll', seat: 'A' })
    // Devastator needs more than 6": the same shot gets no Balanced re-roll
    const devastator = run('aod.p.combat-doctrine:devastator')
    expect(devastator.state.pending!.kind).not.toBe('dice.reroll')
  })
})

describe('TEAM-AOD ploy integration', () => {
  it('Shock Assault: after a Charge the Fight has Shock (a success is discarded) and the first strike deals 1 extra', () => {
    const run = (ploy: boolean) => {
      const { s, a } = duel(NEUTRAL, 4)
      let t = activateOp(s, a)
      t = take(t, 'charge').state
      const p = t.pending!
      t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 2.2, z: 0 }] } }).state
      t = take(t, 'fight').state
      // marine fists 6 (crit) 4 (normal) 2 1; boy choppa 5 (a normal) 1 1 1
      return play(t, new ScriptedRng([6, 4, 2, 1, 5, 1, 1, 1, 1, 1, 1, 1]), {
        'fight.resolve': (q) => q.options![0]!.action, // the crit strikes first
        'ploy.firefight': (q) => {
          const o = ploy ? q.options!.find((x) => (x.action.payload as { ployId: string }).ployId === 'aod.p.shock-assault') : undefined
          return o ? o.action : pass(q)
        },
      }).events
    }
    const plain = run(false)
    const shocked = run(true)
    expect(count(plain, 'ShockDiscard')).toBe(0)
    expect(count(shocked, 'ShockDiscard')).toBe(1)
    expect(strikes(plain)[0]).toBe(4)
    expect(strikes(shocked)[0]).toBe(5)
  })
})

const noRerolls = { 'dice.reroll': pass, 'dice.commandReroll': pass }
const STOPS = ['firefight.action', 'firefight.activate', 'firefight.order', 'strategy.initiative', 'strategy.gambit', 'strategy.decideInitiative'] as never

/** B's turn: A's far-away sniper activates and ends first, so the Kommando acts next. */
function bTurn(s: GameState): GameState {
  const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
  return take(activateOp(edit(s, (st) => (st.operatives[sniper]!.pos = { x: -13, y: 0, z: 9 })), sniper), 'end').state
}

describe('TEAM-KOM integration', () => {
  it('TEAM-KOM-002 THROAT SLITTAS: a Conceal Kommando charges into a fight and keeps its order', () => {
    const { s, a, b } = duel(NEUTRAL, 3.5, 'aod.intercessor-warrior', 'kom.boy')
    let t = bTurn(s)
    t = activateOp(t, b, 'conceal')
    expect(hasOption(t, 'charge')).toBe(true)
    t = take(t, 'charge').state
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.9, z: 0 }] } }).state
    expect(t.operatives[b]!.order).toBe('conceal')
    t = take(t, 'fight').state
    const r = play(t, new ScriptedRng(Array(8).fill(1)), { ...noPloys, ...noRerolls })
    expect(count(r.events, 'FightEnded')).toBe(1)
    expect(r.state.operatives[b]!.order).toBe('conceal')
    void a
    // the Angels of Death marine cannot do the same under Conceal
    const marine = activateOp(duel(NEUTRAL, 3.5).s, a, 'conceal')
    expect(hasOption(marine, 'charge')).toBe(false)
  })

  it('Dat All You Got?: the Slasha Boy deals D3 to the enemy after a Fight it survives', () => {
    const { s, a, b } = duel(NEUTRAL, 1.5, 'aod.intercessor-warrior', 'kom.slasha-boy')
    let t = take(activateOp(bTurn(s), b), 'fight').state
    // slasha 1,1,1,1 and marine 1,1,1,1: nobody strikes; the D3 roll is 5 -> 3 damage
    const r = play(t, new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 5]), { ...noPloys, ...noRerolls })
    expect(r.events.some((e) => e.type === 'AbilityUsed' && (e as { abilityId: string }).abilityId === 'kom.a.dat-all-you-got')).toBe(true)
    expect(r.state.operatives[a]!.wounds).toBe(60 - 3)
  })

  it('TEAM-KOM-003b Boom!: the Bomb Squig killed in a Fight explodes on the Marine beside it', () => {
    const { s, a, b } = duel(NEUTRAL, 1.5, 'aod.intercessor-warrior', 'kom.bomb-squig')
    let t = edit(s, (st) => {
      st.operatives[b]!.wounds = 1
    })
    t = take(activateOp(t, a), 'fight').state
    // marine 6,6,1,1; squig bite 1,1,1; boom 4 and 1; Explosives 6,6,5,5,1,1 against defence 1,1,1
    const r = play(t, new ScriptedRng([6, 6, 1, 1, 1, 1, 1, 4, 1, 6, 6, 5, 5, 1, 1, 1, 1, 1]), { ...noPloys, ...noRerolls, 'fight.resolve': (q) => q.options![0]!.action })
    expect(r.events.some((e) => e.type === 'AbilityUsed' && (e as { abilityId: string }).abilityId === 'kom.a.boom')).toBe(true)
    expect(r.state.operatives[b]!.status).toBe('removed')
    expect(r.state.operatives[a]!.wounds).toBe(60 - 18) // two crits (5) and two normals (4)
  })

  it("KRUMP 'EM!: at the end of the Firefight phase a Kommando in an enemy control range takes a free Fight", () => {
    let s = openReal({ ...NEUTRAL, rosterA: roster(['aod.intercessor-warrior']), rosterB: roster(['kom.boss-nob', 'kom.boy']) })
    const boy = opOf(s, 'B', 'kom.boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = edit(place(place(s, marine, 0, 0), boy, 1.5, 0), (st) => {
      for (const o of Object.values(st.operatives)) o.ready = o.id === marine
      st.operatives[marine]!.wounds = st.operatives[marine]!.maxWounds = 60
    })
    // the marine is the last operative to act; when it ends, the phase is over and Krump 'Em is offered to B
    s = take(activateOp(s, marine), 'end').state
    expect(s.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'B' })
    expect(optionIds(s)).toContain(`kom.p.krump-em@${boy}`)
    const cp = s.players.B.cp
    s = take(s, `kom.p.krump-em@${boy}`).state
    expect(s.players.B.cp).toBe(cp - 1)
    expect(s.pending!.kind).toBe('fight.target')
    // boy choppa 6,6,1,1 (two crits of 5) against the marine's fists 1,1,1,1
    const r = play(s, new ScriptedRng([6, 6, 1, 1, 1, 1, 1, 1]), { ...noPloys, ...noRerolls, 'fight.resolve': (q) => q.options![0]!.action }, STOPS)
    expect(strikes(r.events)).toEqual([5, 5])
    expect(r.state.operatives[marine]!.wounds).toBe(60 - 10)
    expect(r.state.operatives[boy]!.ready).toBe(false) // no activation was spent for it
  })

  it('Just a Scratch: the Kommando ignores one normal-damage die of a live Shoot', () => {
    const shot = (scratch: boolean) => {
      let s = openReal(NEUTRAL)
      const marine = opOf(s, 'A', 'aod.intercessor-warrior')
      const boy = opOf(s, 'B', 'kom.boy')
      s = edit(place(place(s, marine, 0, 0), boy, 4, 0), (st) => {
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 99
      })
      s = take(activateOp(s, marine), 'shoot').state
      // bolt rifle 4,4,1,1 (two normals of 3) against a failed defence 1,1,1
      const r = play(s, new ScriptedRng([4, 4, 1, 1, 1, 1, 1, 1, 1, 1]), {
        ...noRerolls,
        'shoot.target': pickTarget(boy) as never,
        'ploy.firefight': (q) => (scratch ? q.options!.find((o) => o.id.includes('just-a-scratch'))?.action ?? pass(q) : pass(q)),
      })
      return r.state.operatives[boy]!.wounds
    }
    expect(shot(false)).toBe(99 - 6)
    expect(shot(true)).toBe(99 - 3)
  })
})
