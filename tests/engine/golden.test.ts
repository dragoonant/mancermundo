import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { step } from '@/engine'
import { ScriptedRng } from '@/engine/rng'
import { feature, mapWith, part, rect } from '../fixtures/maps'
import { declareFight, evs, melee, pick, play, ranged, shootWith, stage } from '../fixtures/attack'
import { assistersOf } from '@/engine/fight'
import { apply, expectOk, patchOp } from '../fixtures/helpers'

// GOLD-001..004: the worked examples of docs/spec/14-golden-examples.md with forced dice.

const boltRifle = ranged('gold.bolt-rifle', { atk: 4, hit: 3, dmg: { normal: 3, crit: 4 } }, [{ rule: 'piercing', x: 1, crits: true }])
const rubbleNearTarget = mapWith(feature('rubble', part('rubble.a', rect(-1, 1, 1.4, 1.8), 0.5, ['light'])))
const wallFarFromBoth = mapWith(feature('lowWall', part('lowWall.a', rect(-2, 2, -0.25, 0.25), 0.5, ['heavy'])))

describe('GOLD golden examples (forced dice)', () => {
  it('GOLD-001 (SHOOT-016) shoot against cover with one retained crit: 4 damage under optimal blocking, 6 wounds left', () => {
    const s = stage({ map: rubbleNearTarget, m: [0, -5], e: [0, 2.5], mine: [boltRifle], targetSave: 5 })
    const rng = new ScriptedRng([6, 4, 3, 2, 5])
    const p = shootWith(s, rng, boltRifle.id, s.e)
    expect(rng.remaining).toBe(0)
    const sel = evs(p.events, 'TargetSelected')[0]!
    expect(sel.inCover).toBe(true)
    expect(sel.obscured).toBe(false)
    const atk = evs(p.events, 'AttackDiceRolled')[0]!
    expect(atk.kinds).toEqual(['crit', 'normal', 'normal', 'fail'])
    const kept = evs(p.events, 'AttackRetained')[0]!
    expect([kept.crit, kept.normal]).toEqual([1, 2])
    const def = evs(p.events, 'DefenceDiceRolled')[0]!
    expect(def.collected).toBe(2) // Piercing Crits 1 is active because a crit was retained
    expect(evs(p.events, 'CoverSaveRetained')[0]).toMatchObject({ normal: 1, crit: 0 })
    expect(def.kinds.filter((k) => k !== 'fail').length).toBe(2) // 1 retained + the rolled 5
    const dmg = evs(p.events, 'DamageInflicted')
    expect(dmg.map((d) => d.amount)).toEqual([4])
    expect(p.state.operatives[s.e]!.wounds).toBe(6)
    expect(p.state.operatives[s.e]!.flags.injured).toBe(false)
    expect(p.state.attack ?? null).toBeNull()
  })

  it('GOLD-002 (SHOOT-017) shoot against an obscured target: crits stay normal, one success discarded, 3 damage, 7 wounds left', () => {
    const s = stage({ map: wallFarFromBoth, m: [0, -5], e: [0, 4], mine: [boltRifle], targetSave: 5 })
    const rng = new ScriptedRng([6, 6, 4, 1, 5, 3, 2])
    const p = shootWith(s, rng, boltRifle.id, s.e)
    expect(rng.remaining).toBe(0)
    const sel = evs(p.events, 'TargetSelected')[0]!
    expect([sel.inCover, sel.obscured]).toEqual([false, true])
    const kept = evs(p.events, 'AttackRetained')[0]!
    expect([kept.crit, kept.normal]).toEqual([0, 2])
    const def = evs(p.events, 'DefenceDiceRolled')[0]!
    expect(def.collected).toBe(3) // Piercing Crits 1 did not take effect: no crit was retained
    expect(evs(p.events, 'CoverSaveRetained')).toHaveLength(0)
    expect(evs(p.events, 'DamageInflicted').map((d) => d.amount)).toEqual([3])
    expect(p.state.operatives[s.e]!.wounds).toBe(7)
  })

  it('GOLD-003 (FIGHT-009) fight with an assist: Boy ends on 1 wound and the Warrior on 10', () => {
    const chainsword = melee('gold.chainsword', { atk: 5, hit: 3, dmg: { normal: 4, crit: 5 } })
    const choppa = melee('gold.choppa', { atk: 4, hit: 3, dmg: { normal: 4, crit: 5 } })
    // Warrior A1 and the Boy B1 are in each other's control range; the friend A2 (Grenadier) stands in the Boy's control range and nobody else's
    const s = stage({ m: [0, 0.1], f: [1.6, 1.9], e: [0.1, 1.5], mine: [chainsword], theirs: [choppa], mineWounds: 14, mineMaxWounds: 14 })
    expect(assistersOf(s.state, s.state.operatives[s.m]!, s.state.operatives[s.e]!)).toEqual([s.f])
    const rng = new ScriptedRng([6, 5, 3, 2, 1, 6, 4, 3, 2])
    let st = declareFight(s.state)
    const first = expectOk(step(st, pick(st.pending!, s.e), rng))
    st = first.state
    const p = play(st, rng, {
      // the attacker strikes with its best die; the defender blocks with its best die (crit, then normal)
      'fight.resolve': (pd) => {
        const mine = (pd.context.mine as (string | null)[]).filter(Boolean)
        const die = mine.includes('crit') ? 'crit' : 'normal'
        const want = pd.seat === s.me ? 'strike' : 'block'
        return pd.options!.find((o) => (o.action.payload as { op: string }).op === want && (o.data as { die: string }).die === die)!.action
      },
    })
    const events = [...first.events, ...p.events]
    expect(rng.remaining).toBe(0)
    const rolls = evs(events, 'AttackDiceRolled')
    expect(rolls[0]!.need).toBe(2) // the assist improves Hit 3+ to 2+
    expect(rolls[0]!.kinds).toEqual(['crit', 'normal', 'normal', 'normal', 'fail'])
    expect(rolls[1]!.need).toBe(3)
    expect(rolls[1]!.kinds).toEqual(['crit', 'normal', 'normal', 'fail'])
    const order = events
      .filter((e) => e.type === 'Struck' || e.type === 'Blocked')
      .map((e) => (e.type === 'Struck' ? `${e.operativeId === s.m ? 'A' : 'D'} strike ${e.die}` : `${e.operativeId === s.m ? 'A' : 'D'} block ${e.die}`))
    expect(order).toEqual(['A strike crit', 'D block crit', 'A strike normal', 'D block normal', 'D strike normal'])
    expect(p.state.operatives[s.e]!.wounds).toBe(1)
    expect(p.state.operatives[s.m]!.wounds).toBe(10)
    expect(p.state.operatives[s.e]!.flags.injured).toBe(true)
    expect(p.state.operatives[s.m]!.flags.injured).toBe(false)
  })

  it('GOLD-004 (FIGHT-010) charge then fight: the Sniper is incapacitated by the first resolved die and removed', () => {
    // the Slasha Boy charges under Engage in this fixture (Throat Slittas, T-KOM.19, is team data)
    const twinChoppas = melee('gold.twin-choppas', { atk: 4, hit: 3, dmg: { normal: 4, crit: 5 } }, [{ rule: 'ceaseless' }, { rule: 'lethal', target: 5 }])
    const fists = melee('gold.fists', { atk: 4, hit: 3, dmg: { normal: 3, crit: 4 } })
    const s = stage({ m: [-7.4, 0], e: [0, 0], mine: [twinChoppas], theirs: [fists], targetWounds: 5 })
    let st = patchOp(s.state, s.e, { maxWounds: 12 })
    st = apply(st, (p) => act.action(p, 'charge')).state
    // two straight increments of 4.2" and 1.6" cost 5" + 2" = 7" of the 8" allowed
    const moved = expectOk(step(st, act.path(st.pending!, [{ x: -3.2, z: 0 }, { x: -1.6, z: 0 }])))
    const mv = evs(moved.events, 'OperativeMoved')[0]!
    expect(mv.cost).toBe(7)
    expect(mv.maxInches).toBe(8)
    st = moved.state
    expect(st.pending!.kind).toBe('firefight.action')
    expect(st.firefight.activation!.apSpent).toBe(1)
    const rng = new ScriptedRng([5, 4, 3, 1, 6, 4, 2, 1, 2])
    st = declareFight(st)
    const first = expectOk(step(st, pick(st.pending!, s.e), rng))
    const p = play(first.state, rng, {
      // the attacker holds Ceaseless: re-roll the 1s; everything else passes
      'dice.reroll': (pd) => (pd.seat === s.me ? pick(pd, 'ceaseless:v1') : act.pass(pd)),
      'fight.resolve': (pd) => pd.options!.find((o) => o.id.startsWith('strike') && (o.data as { die: string }).die === 'crit')!.action,
    })
    const events = [...first.events, ...p.events]
    expect(rng.remaining).toBe(0)
    const rolls = evs(events, 'AttackDiceRolled')
    expect(rolls[1]!.need).toBe(4) // the injured Sniper worsens Hit to 4+
    expect(evs(events, 'DiceRerolled')[0]).toMatchObject({ source: 'ceaseless', before: [1], after: [2] })
    const kept = evs(events, 'AttackRetained')
    expect([kept[0]!.crit, kept[0]!.normal]).toEqual([1, 2]) // the 5 meets Lethal 5+
    expect([kept[1]!.crit, kept[1]!.normal]).toEqual([1, 1])
    expect(evs(events, 'Struck')).toHaveLength(1) // the first resolved die ends the sequence
    expect(evs(events, 'Blocked')).toHaveLength(0)
    expect(p.state.operatives[s.e]!.status).toBe('removed')
    expect(p.state.operatives[s.m]!.wounds).toBe(10)
    expect(p.state.operatives[s.m]!.order).toBe('engage')
    expect(p.state.firefight.activation?.apSpent).toBe(2)
  })
})
