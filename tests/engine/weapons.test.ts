import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { step } from '@/engine'
import { parseRules, validTargets, weaponUnusable } from '@/engine/attack-common'
import { actionAvailability } from '@/engine/firefight'
import { ScriptedRng } from '@/engine/rng'
import { effectiveApl } from '@/engine/state'
import type { GameState, WeaponRuleRef } from '@/engine/types'
import { apply, expectOk, patchOp } from '../fixtures/helpers'
import { feature, flatMap, mapWith, part, rect } from '../fixtures/maps'
import { declareFight, declareShoot, evs, melee, pick, play, ranged, rolled, shootWith, stage, type Staged } from '../fixtures/attack'
import { getWindowOpener, registerHook, registerWindowOpener, unregisterHook, type AttackHookName, type HookContext } from '@/engine/hooks'

/** A flat arena: shooter at (0,-5), Engage target B1 at (0,4), a save of 6+ so defence results are easy to script. */
function flat(rules: WeaponRuleRef[], patch: Parameters<typeof ranged>[1] = {}, extra: Partial<Parameters<typeof stage>[0]> = {}) {
  const w = ranged('w', { atk: 4, hit: 3, dmg: { normal: 3, crit: 4 }, ...patch }, rules)
  const s = stage({ m: [0, -5], e: [0, 4], mine: [w], targetSave: 6, ...extra })
  return { w, s }
}

const idsOf = (s: Staged, weaponId: string): string[] => validTargets(s.state, s.state.operatives[s.m]!, weaponId).map((t) => t.id)

describe('WPN dice rules', () => {
  it('WPN-001 Accurate x retains x dice as normal successes without rolling; they cannot be re-rolled', () => {
    const { w, s } = flat([{ rule: 'accurate', x: 1 }, { rule: 'balanced' }])
    const offered: string[][] = []
    const p = shootWith(s, new ScriptedRng([3, 2, 5, 1, 1, 1]), w.id, s.e, {
      'dice.reroll': (pd) => {
        offered.push(pd.options!.map((o) => o.id))
        return act.pass(pd)
      },
    })
    const a = evs(p.events, 'AttackDiceRolled')[0]!
    expect(a.dice).toEqual([3, 2, 5, null])
    expect(a.kinds).toEqual(['normal', 'fail', 'normal', 'normal'])
    expect(rolled(p.events, 'shoot.attack')).toEqual([[3, 2, 5]])
    expect(offered).toEqual([['balanced:0', 'balanced:1', 'balanced:2']]) // never die 3, the retained one
  })

  it('WPN-002 two Accurate sources combine into Accurate 2 (weapon Accurate 1 plus Vantage 2" higher)', () => {
    const roof = mapWith(feature('roof', part('roof.a', rect(-8, -4, -2, 2), 2, ['vantage'])))
    const w = ranged('w', { atk: 4, hit: 3 }, [{ rule: 'accurate', x: 1 }])
    const s = stage({ map: roof, m: [-6, 0, 2], e: [4, 0], mine: [w], targetSave: 6 })
    const p = shootWith(s, new ScriptedRng([5, 5, 1, 1, 1]), w.id, s.e)
    const a = evs(p.events, 'AttackDiceRolled')[0]!
    expect(a.dice).toEqual([5, 5, null, null])
    // with no weapon Accurate the Vantage alone gives Accurate 1
    const plain = ranged('p', { atk: 4, hit: 3 })
    const t = stage({ map: roof, m: [-6, 0, 2], e: [4, 0], mine: [plain], targetSave: 6 })
    const q = shootWith(t, new ScriptedRng([5, 5, 5, 1, 1, 1]), plain.id, t.e)
    expect(evs(q.events, 'AttackDiceRolled')[0]!.dice).toEqual([5, 5, 5, null])
  })

  it('WPN-003 Balanced re-rolls one attack die, once; a die already re-rolled cannot be re-rolled again', () => {
    const { w, s } = flat([{ rule: 'balanced' }])
    const seenCommand: string[][] = []
    let rerollWindows = 0
    const p = shootWith(s, new ScriptedRng([2, 5, 5, 5, 6, 1, 1, 1]), w.id, s.e, {
      'dice.reroll': (pd) => {
        rerollWindows++
        return pick(pd, 'balanced:0')
      },
      'dice.commandReroll': (pd) => {
        seenCommand.push(pd.options!.map((o) => o.id))
        return act.pass(pd)
      },
    })
    expect(evs(p.events, 'DiceRerolled')[0]).toMatchObject({ source: 'balanced', indexes: [0], before: [2], after: [6] })
    expect(evs(p.events, 'AttackRetained')[0]).toMatchObject({ crit: 1, normal: 3 })
    // one dice.reroll only: Balanced is spent; the Command Re-roll never offers die 0 again
    expect(rerollWindows).toBe(1)
    expect(seenCommand[0]).toEqual(['command:1']) // the three 5s are equivalent, die 0 is excluded
  })

  it('WPN-007 Ceaseless re-rolls every die showing the chosen result, only once each', () => {
    const { w, s } = flat([{ rule: 'ceaseless' }])
    const offered: string[][] = []
    const p = shootWith(s, new ScriptedRng([2, 2, 5, 2, 4, 1, 6, 1, 1, 1]), w.id, s.e, {
      'dice.reroll': (pd) => {
        offered.push(pd.options!.map((o) => o.id))
        return pick(pd, 'ceaseless:v2')
      },
    })
    expect(offered).toEqual([['ceaseless:v2', 'ceaseless:v5']]) // one window only: Ceaseless is spent
    expect(rolled(p.events, 'shoot.attack.reroll')).toEqual([[4, 1, 6]])
    expect(evs(p.events, 'DiceRerolled')[0]).toMatchObject({ indexes: [0, 1, 3], before: [2, 2, 2] })
    expect(evs(p.events, 'AttackRetained')[0]).toMatchObject({ crit: 1, normal: 2 })
  })

  it('WPN-019 Relentless can re-roll any dice, one re-roll per die', () => {
    const { w, s } = flat([{ rule: 'relentless' }])
    let windows = 0
    const p = shootWith(s, new ScriptedRng([1, 2, 5, 6, 4, 3, 1, 1, 1]), w.id, s.e, {
      'dice.reroll': (pd) => {
        windows++
        return pick(pd, 'relentless:fails')
      },
    })
    expect(evs(p.events, 'DiceRerolled')[0]).toMatchObject({ source: 'relentless', indexes: [0, 1], before: [1, 2], after: [4, 3] })
    expect(evs(p.events, 'AttackRetained')[0]).toMatchObject({ crit: 1, normal: 3 })
    expect(windows).toBe(1)
  })

  it('WPN-006 Brutal: the defender can block only with crits', () => {
    const { w, s } = flat([{ rule: 'brutal' }], {}, { targetSave: 3 })
    // 3 attack normals; the defender rolls 3 normals but none may block
    const p = shootWith(s, new ScriptedRng([4, 4, 4, 1, 3, 3, 3]), w.id, s.e)
    expect(evs(p.events, 'DiceBlocked')[0]).toMatchObject({ blockedNormal: 0, blockedCrit: 0, unblockedNormal: 3 })
    expect(p.state.operatives[s.e]!.wounds).toBe(1)
    // a defence crit does block one die
    const t = flat([{ rule: 'brutal' }], {}, { targetSave: 3 })
    const q = shootWith(t.s, new ScriptedRng([4, 4, 4, 1, 6, 3, 3]), t.w.id, t.s.e)
    expect(evs(q.events, 'DiceBlocked')[0]).toMatchObject({ blockedNormal: 1, unblockedNormal: 2 })
  })

  it('WPN-008 Devastating 3 deals 3 per retained crit immediately and the crit still resolves later', () => {
    const { w, s } = flat([{ rule: 'devastating', x: 3 }], {}, { targetWounds: 20 })
    const p = shootWith(s, new ScriptedRng([6, 6, 2, 2, 1, 1, 1]), w.id, s.e)
    const dmg = evs(p.events, 'DamageInflicted')
    expect(dmg.map((d) => [d.source, d.amount])).toEqual([
      ['devastating', 3],
      ['devastating', 3],
      ['crit', 4],
      ['crit', 4],
    ])
    // the immediate damage is dealt before the defence dice are rolled
    const idx = (t: string) => p.events.findIndex((e) => e.type === t)
    expect(p.events.findIndex((e) => e.type === 'DamageInflicted')).toBeLessThan(idx('DefenceDiceRolled'))
    expect(p.state.operatives[s.e]!.wounds).toBe(6)
  })

  it('WPN-009 a distance Devastating also damages every operative visible to and within that distance of the target', () => {
    const { w, s } = flat([{ rule: 'devastating', x: 2, inches: 1 }], {}, { e2: [1.5, 4], targetWounds: 20 })
    const p = shootWith(s, new ScriptedRng([6, 2, 2, 2, 1, 1, 1]), w.id, s.e)
    const dev = evs(p.events, 'DamageInflicted').filter((d) => d.source === 'devastating')
    expect(dev.map((d) => d.operativeId).sort()).toEqual([s.e, s.e2].sort())
    expect(dev.every((d) => d.amount === 2)).toBe(true)
    expect(p.state.operatives[s.e2]!.wounds).toBe(8)
    // an operative beyond the distance is not touched
    const far = flat([{ rule: 'devastating', x: 2, inches: 1 }], {}, { e2: [4, 4], targetWounds: 20 })
    const q = shootWith(far.s, new ScriptedRng([6, 2, 2, 2, 1, 1, 1]), far.w.id, far.s.e)
    expect(q.state.operatives[far.s.e2]!.wounds).toBe(10)
  })

  it('WPN-012 Hot rolls one D6 after the whole action; a result below the current Hit deals twice the result to the user', () => {
    const { w, s } = flat([{ rule: 'hot' }])
    const p = shootWith(s, new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 2]), w.id, s.e)
    expect(rolled(p.events, 'shoot.hot')).toEqual([[2]])
    expect(evs(p.events, 'DamageInflicted').find((d) => d.source === 'hot')).toMatchObject({ operativeId: s.m, amount: 4 })
    expect(p.state.operatives[s.m]!.wounds).toBe(6)
    // a result at or above Hit does nothing
    const ok = flat([{ rule: 'hot' }])
    const q = shootWith(ok.s, new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 3]), ok.w.id, ok.s.e)
    expect(q.state.operatives[ok.s.m]!.wounds).toBe(10)
    // Blast: still a single Hot roll
    const blast = flat([{ rule: 'hot' }, { rule: 'blast', inches: 2 }], {}, { e2: [1.6, 4] })
    const b = shootWith(blast.s, new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5]), blast.w.id, blast.s.e)
    expect(evs(b.events, 'ShootEnded')).toHaveLength(1)
    expect(rolled(b.events, 'shoot.hot')).toEqual([[5]])
  })

  it('WPN-012 Hot counts injury in the Hit it compares with, and an incapacitated shooter ends its activation', () => {
    // 4 of 10 wounds is injured: Hit worsens to 4+, so a 3 is below it and deals 6, which incapacitates the shooter
    const { w, s } = flat([{ rule: 'hot' }], {}, { mineWounds: 4, mineMaxWounds: 10 })
    const p = shootWith(s, new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 3]), w.id, s.e)
    expect(p.state.operatives[s.m]!.status).toBe('removed')
    expect(evs(p.events, 'OperativeIncapacitated').map((x) => x.operativeId)).toContain(s.m)
    expect(p.state.firefight.activation).toBeNull() // the activation ended with the operative
    expect(p.state.pending!.kind).toBe('firefight.activate')
  })

  it('WPN-014 Limited 1 removes the weapon after one use; a Blast action counts as one use', () => {
    const { w, s } = flat([{ rule: 'limited', x: 1 }, { rule: 'blast', inches: 2 }], {}, { e2: [1.6, 4] })
    const p = shootWith(s, new ScriptedRng(new Array(40).fill(1)), w.id, s.e)
    const op = p.state.operatives[s.m]!
    expect(op.usedLimited[w.id]).toBe(1)
    expect(evs(p.events, 'ShootEnded')).toHaveLength(1)
    expect(weaponUnusable(p.state, op, w.id, [], 'shoot')?.code).toBe('E_ACTION_RESTRICTED')
    expect(weaponUnusable(s.state, s.state.operatives[s.m]!, w.id, [], 'shoot')).toBeNull()
  })

  it('WPN-015 Piercing 1 reduces defence dice to 2, never below 0', () => {
    const one = flat([{ rule: 'piercing', x: 1 }])
    const p = shootWith(one.s, new ScriptedRng([1, 1, 1, 1, 1, 1]), one.w.id, one.s.e)
    expect(evs(p.events, 'DefenceDiceRolled')[0]!.collected).toBe(2)
    const five = flat([{ rule: 'piercing', x: 5 }])
    const q = shootWith(five.s, new ScriptedRng([4, 1, 1, 1]), five.w.id, five.s.e)
    const d = evs(q.events, 'DefenceDiceRolled')[0]!
    expect(d.collected).toBe(0)
    expect(d.dice).toEqual([])
    expect(rolled(q.events, 'shoot.defence')).toEqual([])
  })

  it('WPN-016 Piercing Crits 1 reduces defence dice only if a crit was retained', () => {
    const none = flat([{ rule: 'piercing', x: 1, crits: true }])
    const p = shootWith(none.s, new ScriptedRng([4, 4, 1, 1, 1, 1, 1]), none.w.id, none.s.e)
    expect(evs(p.events, 'DefenceDiceRolled')[0]!.collected).toBe(3)
    const crit = flat([{ rule: 'piercing', x: 1, crits: true }])
    const q = shootWith(crit.s, new ScriptedRng([6, 4, 1, 1, 1, 1]), crit.w.id, crit.s.e)
    expect(evs(q.events, 'DefenceDiceRolled')[0]!.collected).toBe(2)
  })

  it('WPN-017 Punishing turns one failed die into a normal success only when a crit is retained', () => {
    const a = flat([{ rule: 'punishing' }])
    const p = shootWith(a.s, new ScriptedRng([6, 2, 1, 1, 1, 1, 1]), a.w.id, a.s.e)
    expect(evs(p.events, 'AttackRetained')[0]).toMatchObject({ crit: 1, normal: 1, converted: ['punishing'] })
    const b = flat([{ rule: 'punishing' }])
    const q = shootWith(b.s, new ScriptedRng([3, 2, 1, 1, 1, 1, 1]), b.w.id, b.s.e)
    expect(evs(q.events, 'AttackRetained')[0]).toMatchObject({ crit: 0, normal: 1, converted: [] })
  })

  it('WPN-020 Rending turns one rolled normal success into a crit only when a crit is retained', () => {
    const a = flat([{ rule: 'rending' }])
    const p = shootWith(a.s, new ScriptedRng([6, 4, 2, 1, 1, 1, 1]), a.w.id, a.s.e)
    expect(evs(p.events, 'AttackRetained')[0]).toMatchObject({ crit: 2, normal: 0, converted: ['rending'] })
    const b = flat([{ rule: 'rending' }])
    const q = shootWith(b.s, new ScriptedRng([4, 4, 2, 1, 1, 1, 1]), b.w.id, b.s.e)
    expect(evs(q.events, 'AttackRetained')[0]).toMatchObject({ crit: 0, normal: 2, converted: [] })
  })

  it('WPN-023 Severe converts one normal to a crit only if no crit was retained; Piercing Crits still triggers, Punishing and Rending do not', () => {
    const a = flat([{ rule: 'severe' }, { rule: 'piercing', x: 1, crits: true }, { rule: 'punishing' }, { rule: 'rending' }])
    const p = shootWith(a.s, new ScriptedRng([4, 4, 2, 1, 1, 1]), a.w.id, a.s.e)
    expect(evs(p.events, 'AttackRetained')[0]).toMatchObject({ crit: 1, normal: 1, converted: ['severe'] })
    expect(evs(p.events, 'DefenceDiceRolled')[0]!.collected).toBe(2)
    // with a natural crit Severe does nothing
    const b = flat([{ rule: 'severe' }])
    const q = shootWith(b.s, new ScriptedRng([6, 4, 2, 1, 1, 1, 1]), b.w.id, b.s.e)
    expect(evs(q.events, 'AttackRetained')[0]).toMatchObject({ crit: 1, normal: 1, converted: [] })
  })

  it('WPN-026 Stun reduces the target APL by 1 until the end of its next activation when a crit is retained, within the +/-1 cap', () => {
    const { w, s } = flat([{ rule: 'stun' }])
    const p = shootWith(s, new ScriptedRng([6, 2, 2, 2, 1, 1, 1]), w.id, s.e)
    const target = p.state.operatives[s.e]!
    expect(effectiveApl(target)).toBe(target.apl - 1)
    expect(evs(p.events, 'AplModified')[0]).toMatchObject({ operativeId: s.e, delta: -1 })
    // a second reduction never takes it more than 1 below its printed APL (R-9.6)
    const doubly = patchOp(p.state, s.e, { aplMods: -2 })
    expect(effectiveApl(doubly.operatives[s.e]!)).toBe(target.apl - 1)
    // the effect ends with the target's next activation
    let st = apply(p.state, (pd) => act.action(pd, 'end')).state
    st = apply(st, (pd) => act.activate(pd, s.e)).state
    expect(effectiveApl(st.operatives[s.e]!)).toBe(target.apl - 1) // still reduced during that activation
    st = apply(st, (pd) => act.order(pd, 'engage')).state
    st = apply(st, (pd) => act.action(pd, 'end')).state
    expect(st.operatives[s.e]!.aplMods).toBe(0)
    expect(st.operatives[s.e]!.aplFx).toEqual([])
    // no retained crit, no Stun
    const none = flat([{ rule: 'stun' }])
    const q = shootWith(none.s, new ScriptedRng([4, 2, 2, 2, 1, 1, 1]), none.w.id, none.s.e)
    expect(q.state.operatives[none.s.e]!.aplMods).toBe(0)
  })
})

describe('WPN target rules', () => {
  it('WPN-018 Range 8" excludes targets farther than 8" from the active operative', () => {
    const w = ranged('w', {}, [{ rule: 'range', inches: 8 }])
    const near = stage({ m: [0, -5], e: [0, 4], mine: [w] }) // 7.74" between bases
    expect(idsOf(near, w.id)).toContain(near.e)
    const far = stage({ m: [0, -5], e: [0, 5], mine: [w] }) // 8.74"
    expect(idsOf(far, w.id)).not.toContain(far.e)
  })

  it('WPN-021 Saturate removes the cover save but the target is still in cover for selection', () => {
    const rubble = mapWith(feature('rubble', part('rubble.a', rect(-1, 1, 1.4, 1.8), 0.5, ['light'])))
    const sat = ranged('sat', {}, [{ rule: 'saturate' }])
    const s = stage({ map: rubble, m: [0, -5], e: [0, 2.5], mine: [sat], targetSave: 6 })
    const p = shootWith(s, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), sat.id, s.e)
    expect(evs(p.events, 'TargetSelected')[0]!.inCover).toBe(true)
    expect(evs(p.events, 'CoverSaveRetained')).toHaveLength(0)
    expect(rolled(p.events, 'shoot.defence')).toEqual([[1, 1, 1]])
    // a Conceal target in cover is still not selectable with Saturate
    const hidden = stage({ map: rubble, m: [0, -5], e: [0, 2.5], mine: [sat], targetOrder: 'conceal' })
    expect(idsOf(hidden, sat.id)).not.toContain(hidden.e)
  })

  it('WPN-022 Seek lets a Conceal target in cover be selected but keeps its cover save; Seek Light ignores only Light terrain', () => {
    const light = mapWith(feature('rubble', part('rubble.a', rect(-1, 1, 1.4, 1.8), 0.5, ['light'])))
    const heavy = mapWith(feature('wall', part('wall.a', rect(-1, 1, 1.4, 1.8), 0.5, ['heavy'])))
    const seek = ranged('seek', {}, [{ rule: 'seek' }])
    const seekLight = ranged('seekLight', {}, [{ rule: 'seek-light' }])
    const plain = ranged('plain')
    const pick1 = (map: typeof light, w: ReturnType<typeof ranged>) => stage({ map, m: [0, -5], e: [0, 2.5], mine: [w], targetOrder: 'conceal' })
    expect(idsOf(pick1(light, plain), 'plain')).toEqual(expect.not.arrayContaining(['B1']))
    const a = pick1(light, seek)
    expect(idsOf(a, 'seek')).toContain(a.e)
    const b = pick1(light, seekLight)
    expect(idsOf(b, 'seekLight')).toContain(b.e)
    const c = pick1(heavy, seekLight)
    expect(idsOf(c, 'seekLight')).not.toContain(c.e) // Heavy cover is not Light terrain
    const d = pick1(heavy, seek)
    expect(idsOf(d, 'seek')).toContain(d.e)
    // the target keeps its cover save
    const p = shootWith(a, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), 'seek', a.e)
    expect(evs(p.events, 'TargetSelected')[0]!.inCover).toBe(true)
    expect(evs(p.events, 'CoverSaveRetained')).toHaveLength(1)
  })

  it('WPN-025 Silent permits Shoot under Conceal', () => {
    const quiet = ranged('quiet', {}, [{ rule: 'silent' }])
    const loud = ranged('loud')
    const s = stage({ m: [0, -5], e: [0, 4], mine: [quiet, loud], mineOrder: 'conceal' })
    const op = s.state.operatives[s.m]!
    expect(actionAvailability(s.state, op, 'shoot', s.state.firefight.activation)).toBeNull()
    const st = declareShoot(s.state)
    expect(st.pending!.options!.map((o) => o.id)).toEqual(['quiet']) // the loud weapon is not offered
    const only = stage({ m: [0, -5], e: [0, 4], mine: [loud], mineOrder: 'conceal' })
    expect(actionAvailability(only.state, only.state.operatives[only.m]!, 'shoot', only.state.firefight.activation)?.code).toBe('E_ACTION_RESTRICTED')
  })
})

describe('WPN Blast and Torrent', () => {
  it('WPN-004 Blast shoots the primary then every visible operative within x of it, friendly included, regardless of Conceal', () => {
    const blast = ranged('blast', { atk: 3, dmg: { normal: 1, crit: 2 } }, [{ rule: 'blast', inches: 2 }])
    const s = stage({ m: [0, -5], f: [-2.6, 4], e: [0, 4], e2: [1.6, 4], mine: [blast] })
    expect(s.state.operatives[s.e2]!.order).toBe('conceal') // the secondary is Concealed and still hit
    const p = shootWith(s, new ScriptedRng(new Array(60).fill(3)), blast.id, s.e)
    const sel = evs(p.events, 'TargetSelected')
    expect(sel.map((x) => x.targetId)).toEqual([s.e, s.e2, s.f]) // ordered by distance from the primary
    expect(sel.map((x) => x.secondary)).toEqual([false, true, true])
    // not visible or beyond x: not a secondary
    const apart = stage({ m: [0, -5], e: [0, 4], e2: [5, 4], mine: [blast] })
    const q = shootWith(apart, new ScriptedRng(new Array(60).fill(3)), blast.id, apart.e)
    expect(evs(q.events, 'TargetSelected').map((x) => x.targetId)).toEqual([apart.e])
  })

  it('WPN-005 Blast secondaries are in cover and obscured exactly as the primary was', () => {
    const blast = ranged('blast', { atk: 3, dmg: { normal: 1, crit: 2 } }, [{ rule: 'blast', inches: 2 }])
    const rubble = mapWith(feature('rubble', part('rubble.a', rect(-1, 1, 2.9, 3.3), 0.5, ['light'])))
    const s = stage({ map: rubble, m: [0, -5], e: [0, 4], e2: [1.6, 4], mine: [blast] })
    const p = shootWith(s, new ScriptedRng(new Array(60).fill(3)), blast.id, s.e)
    const [primary, secondary] = evs(p.events, 'TargetSelected')
    expect(primary).toMatchObject({ inCover: true, obscured: false })
    expect(secondary).toMatchObject({ inCover: true, obscured: false })
    // the secondary stands outside the rubble yet gets a cover save of its own
    expect(evs(p.events, 'CoverSaveRetained')).toHaveLength(2)
  })

  it('WPN-027 Torrent picks extra valid targets within x with no friendly in their control range, each with its own cover', () => {
    const torrent = ranged('torrent', { atk: 2, dmg: { normal: 1, crit: 2 } }, [{ rule: 'torrent', inches: 2 }])
    // B2 (1.6" from B1) and B3 (3.4" from B1, parked elsewhere)
    const s = stage({ m: [0, -5], f: [-5, 4], e: [0, 4], e2: [1.6, 4], mine: [torrent] })
    const placed = patchOp(s.state, 'B3', { pos: { x: -1.6, y: 0, z: 4 }, order: 'engage' })
    const base = { ...s, state: placed }
    let st = declareShoot(base.state)
    st = expectOk(step(st, pick(st.pending!, torrent.id))).state
    st = expectOk(step(st, pick(st.pending!, base.e))).state
    expect(st.pending!.kind).toBe('shoot.target')
    expect(st.pending!.context.secondary).toBe(true)
    expect(st.pending!.options!.map((o) => o.id).sort()).toEqual(['add:B2', 'add:B3', 'done'])
    const rng = new ScriptedRng(new Array(60).fill(3))
    st = expectOk(step(st, pick(st.pending!, 'add:B2'), rng)).state
    expect(st.pending!.options!.map((o) => o.id)).toEqual(['add:B3', 'done'])
    const r = expectOk(step(st, pick(st.pending!, 'done'), rng))
    const done = play(r.state, rng)
    expect(evs([...r.events, ...done.events], 'TargetSelected').map((x) => x.targetId)).toEqual([base.e, 'B2'])
    // a candidate with a friendly operative in its control range is not offered
    const guarded = stage({ m: [0, -5], f: [3.2, 4], e: [0, 4], e2: [1.6, 4], mine: [torrent] })
    let g = declareShoot(guarded.state)
    g = expectOk(step(g, pick(g.pending!, torrent.id))).state
    g = expectOk(step(g, pick(g.pending!, guarded.e))).state
    // B2 has the friendly A2 within 1" and B1 itself is fine: no candidate, so the sequence starts
    expect(g.pending!.kind).not.toBe('shoot.target')
  })

  it('WPN-028 Torrent 0" has no secondaries but still counts as Torrent for other rules', () => {
    const torrent0 = ranged('torrent0', {}, [{ rule: 'torrent', inches: 0 }])
    expect(parseRules(torrent0.rules).torrent).toBe(0)
    const s = stage({ m: [0, -5], e: [0, 4], e2: [1.6, 4], mine: [torrent0] })
    let st = declareShoot(s.state)
    st = expectOk(step(st, pick(st.pending!, torrent0.id))).state
    const next = expectOk(step(st, pick(st.pending!, s.e), new ScriptedRng(new Array(20).fill(3))))
    expect(next.state.pending!.context.secondary).toBeUndefined()
    expect(next.state.pending!.kind).not.toBe('shoot.target')
  })
})

describe('WPN Heavy', () => {
  it('WPN-010 Heavy bars use after moving and moving after use, in activations and counteractions', () => {
    const heavy = ranged('heavy', {}, [{ rule: 'heavy' }])
    const light = ranged('light')
    const s = stage({ m: [0, -5], e: [0, 4], mine: [heavy, light] })
    // after a Reposition only the light weapon is offered
    const moved: GameState = { ...s.state, firefight: { ...s.state.firefight, activation: { ...s.state.firefight.activation!, performed: ['reposition'] } } }
    const op = moved.operatives[s.m]!
    expect(weaponUnusable(moved, op, 'heavy', ['reposition'], 'shoot')?.code).toBe('E_ACTION_RESTRICTED')
    expect(weaponUnusable(moved, op, 'light', ['reposition'], 'shoot')).toBeNull()
    // after shooting with the heavy weapon no move is allowed
    const p = shootWith(s, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), heavy.id, s.e)
    const ids = p.state.pending!.options!.map((o) => o.id)
    expect(ids).not.toContain('reposition')
    expect(ids).not.toContain('dash')
    expect(ids).not.toContain('charge')
    expect(step(p.state, act.action(p.state.pending!, 'reposition')).rejection?.code).toBe('E_ACTION_RESTRICTED')
    // shooting with the other weapon leaves movement alone
    const q = shootWith(s, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), light.id, s.e)
    expect(q.state.pending!.options!.map((o) => o.id)).toContain('reposition')
  })

  it('WPN-011 Heavy (Dash only) allows Dash but no other move', () => {
    const heavy = ranged('heavyDash', {}, [{ rule: 'heavy', only: 'dash' }])
    const s = stage({ m: [0, -5], e: [0, 4], mine: [heavy] })
    const op = s.state.operatives[s.m]!
    expect(weaponUnusable(s.state, op, 'heavyDash', ['dash'], 'shoot')).toBeNull()
    expect(weaponUnusable(s.state, op, 'heavyDash', ['reposition'], 'shoot')?.code).toBe('E_ACTION_RESTRICTED')
    expect(weaponUnusable(s.state, op, 'heavyDash', ['dash', 'reposition'], 'shoot')?.code).toBe('E_ACTION_RESTRICTED')
    const p = shootWith(s, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), heavy.id, s.e)
    const ids = p.state.pending!.options!.map((o) => o.id)
    expect(ids).toContain('dash')
    expect(ids).not.toContain('reposition')
  })
})

describe('TERR terrain in the shoot sequence', () => {
  it('TERR-001 Heavy terrain can obscure while Light only gives cover', () => {
    const w = ranged('w', {}, [])
    const heavy = stage({ map: mapWith(feature('h', part('h.a', rect(-2, 2, -0.25, 0.25), 0.5, ['heavy']))), m: [0, -5], e: [0, 4], mine: [w] })
    const light = stage({ map: mapWith(feature('l', part('l.a', rect(-2, 2, -0.25, 0.25), 0.5, ['light']))), m: [0, -5], e: [0, 4], mine: [w] })
    expect(evs(shootWith(heavy, new ScriptedRng(new Array(20).fill(1)), w.id, heavy.e).events, 'TargetSelected')[0]!.obscured).toBe(true)
    const l = evs(shootWith(light, new ScriptedRng(new Array(20).fill(1)), w.id, light.e).events, 'TargetSelected')[0]!
    expect([l.obscured, l.inCover]).toEqual([false, false]) // Light far from both: neither
  })

  it('TERR-002 Blocking terrain stops visibility and counts as intervening for cover and obscured', () => {
    const w = ranged('w')
    const wall = mapWith(feature('wall', part('wall.a', rect(-0.25, 0.25, -2, 2), 3, ['heavy', 'blocking'])))
    const behind = stage({ map: wall, m: [-4, 0], e: [4, 0], mine: [w] })
    expect(idsOf(behind, w.id)).not.toContain(behind.e)
    const around = stage({ map: wall, m: [-4, 0], e: [4, 5], mine: [w] })
    expect(idsOf(around, w.id)).toContain(around.e)
  })

  it('TERR-003 Barred terrain blocks visibility unless the viewer or target is within 1" of it', () => {
    const w = ranged('w')
    const window = mapWith(feature('win', part('win.a', rect(-0.25, 0.25, -2, 2), 3, ['barred'])))
    const far = stage({ map: window, m: [-4, 0], e: [4, 0], mine: [w] })
    expect(idsOf(far, w.id)).not.toContain(far.e)
    const near = stage({ map: window, m: [-4, 0], e: [0.9, 0], mine: [w] })
    expect(idsOf(near, w.id)).toContain(near.e)
  })

  it('TERR-004 a Vantage shooter gains Accurate 1 against an Engage target 2" lower and Accurate 2 at 4" lower', () => {
    const w = ranged('w', { atk: 4 })
    const roof = (h: number) => mapWith(feature('roof', part('roof.a', rect(-8, -4, -2, 2), h, ['vantage'])))
    const two = stage({ map: roof(2), m: [-6, 0, 2], e: [4, 0], mine: [w], targetSave: 6 })
    expect(evs(shootWith(two, new ScriptedRng([5, 5, 5, 1, 1, 1]), w.id, two.e).events, 'AttackDiceRolled')[0]!.dice).toEqual([5, 5, 5, null])
    const four = stage({ map: roof(4), m: [-6, 0, 4], e: [4, 0], mine: [w], targetSave: 6 })
    expect(evs(shootWith(four, new ScriptedRng([5, 5, 1, 1, 1]), w.id, four.e).events, 'AttackDiceRolled')[0]!.dice).toEqual([5, 5, null, null])
  })

  it('TERR-005 a Conceal target 2" lower cannot use Light cover against a Vantage shooter, keeps its cover save, and may retain it as a crit or add one more', () => {
    const w = ranged('w', { atk: 4, hit: 3 })
    const map = mapWith(
      feature('roof', part('roof.a', rect(-8, -4, -2, 2), 2, ['vantage'])),
      feature('rubble', part('rubble.a', rect(-2.6, -2.2, -2, 2), 0.5, ['light'])),
    )
    const s = stage({ map, m: [-6, 0, 2], e: [-1, 0], mine: [w], targetOrder: 'conceal', targetSave: 5 })
    expect(idsOf(s, w.id)).toContain(s.e) // selectable although the rubble is in cover range
    // the same target is not selectable from the floor
    const floor = stage({ map, m: [-6, 0], e: [-1, 0], mine: [w], targetOrder: 'conceal' })
    expect(idsOf(floor, w.id)).not.toContain(floor.e)
    let st = declareShoot(s.state)
    st = expectOk(step(st, pick(st.pending!, w.id))).state
    const rng = new ScriptedRng([4, 4, 4, 4, 1, 1, 1, 1])
    st = expectOk(step(st, pick(st.pending!, s.e), rng)).state
    const asked = play(st, rng, {}, ['shoot.coverSave'])
    const cover = asked.state.pending!
    expect(cover.kind).toBe('shoot.coverSave')
    expect(cover.options!.map((o) => o.id)).toEqual(['retain', 'roll', 'retainCrit', 'retainTwo'])
    const two = expectOk(step(asked.state, pick(cover, 'retainTwo'), rng))
    expect(evs(two.events, 'CoverSaveRetained')[0]).toMatchObject({ normal: 2, crit: 0 })
    expect(evs(two.events, 'DefenceDiceRolled')[0]!.dice).toEqual([null, null, 1])
    const crit = expectOk(step(asked.state, pick(cover, 'retainCrit'), new ScriptedRng([1, 1])))
    expect(evs(crit.events, 'CoverSaveRetained')[0]).toMatchObject({ normal: 0, crit: 1 })
    expect(evs(crit.events, 'DefenceDiceRolled')[0]!.kinds[0]).toBe('crit')
    // Seek Light uses only Seek Light and denies the improved Vantage cover save
    const sl = ranged('sl', { atk: 4 }, [{ rule: 'seek-light' }])
    const t = stage({ map, m: [-6, 0, 2], e: [-1, 0], mine: [sl], targetOrder: 'conceal', targetSave: 5 })
    let u = declareShoot(t.state)
    u = expectOk(step(u, pick(u.pending!, sl.id))).state
    const r2 = new ScriptedRng([4, 4, 4, 4])
    u = expectOk(step(u, pick(u.pending!, t.e), r2)).state
    const asked2 = play(u, r2, {}, ['shoot.coverSave'])
    expect(asked2.state.pending!.options!.map((o) => o.id)).toEqual(['retain', 'roll'])
  })

  it('TERR-006 Heavy terrain connected to the Vantage the shooter stands on is ignored for obscured', () => {
    const w = ranged('w')
    const connected = mapWith(
      feature('tower', part('tower.roof', rect(-8, -4, -2, 2), 2, ['vantage']), part('tower.wall', rect(-0.25, 0.25, -2, 2), 1.2, ['heavy'])),
    )
    const a = stage({ map: connected, m: [-6, 0, 2], e: [4, 0], mine: [w] })
    expect(evs(shootWith(a, new ScriptedRng(new Array(20).fill(1)), w.id, a.e).events, 'TargetSelected')[0]!.obscured).toBe(false)
    const separate = mapWith(
      feature('tower', part('tower.roof', rect(-8, -4, -2, 2), 2, ['vantage'])),
      feature('wall', part('wall.a', rect(-0.25, 0.25, -2, 2), 1.2, ['heavy'])),
    )
    const b = stage({ map: separate, m: [-6, 0, 2], e: [4, 0], mine: [w] })
    expect(evs(shootWith(b, new ScriptedRng(new Array(20).fill(1)), w.id, b.e).events, 'TargetSelected')[0]!.obscured).toBe(true)
  })

  it('TERR-009 Exposed terrain is never intervening for cover or obscured', () => {
    const w = ranged('w')
    const exposed = mapWith(feature('ex', part('ex.a', rect(-2, 2, -0.25, 0.25), 0.5, ['heavy', 'exposed'])))
    const s = stage({ map: exposed, m: [0, -5], e: [0, 4], mine: [w] })
    const t = evs(shootWith(s, new ScriptedRng(new Array(20).fill(1)), w.id, s.e).events, 'TargetSelected')[0]!
    expect([t.inCover, t.obscured]).toEqual([false, false])
    void flatMap
  })
})

// ---------------------------------------------------------------------------
// Hook points defined for the abilities, ploys and equipment modules
// ---------------------------------------------------------------------------
function withHook<T>(name: AttackHookName, id: string, fn: (c: HookContext) => null, body: () => T): T {
  registerHook(name, fn, id)
  try {
    return body()
  } finally {
    unregisterHook(name, id)
  }
}

describe('HOOK attack-sequence hook points fire in a real sequence', () => {
  it('HOOK-001 beforeShootTargetSelect can remove a candidate', () => {
    const { w, s } = flat([])
    expect(idsOf(s, w.id)).toContain(s.e)
    withHook(
      'beforeShootTargetSelect',
      'test.remove',
      (c) => {
        const d = c.data as { candidates: string[] }
        d.candidates = d.candidates.filter((id) => id !== 'B1')
        return null
      },
      () => expect(idsOf(s, w.id)).not.toContain(s.e),
    )
  })

  it('HOOK-002 modifyAttackDice changes Atk, Hit, Lethal and adds re-roll grants; modifyDefenceDice changes the pool and Save', () => {
    const { w, s } = flat([], { atk: 3 }, { targetSave: 4 })
    const p = withHook(
      'modifyAttackDice',
      'test.atk',
      (c) => {
        const d = c.data as { atk: number; hitDelta: number; lethal: number | null; rerolls: { id: string; source: string; mode: 'one'; used: boolean }[] }
        d.atk += 1
        d.hitDelta -= 1
        d.lethal = 5
        d.rerolls.push({ id: 'ammo', source: 'test', mode: 'one', used: false })
        return null
      },
      () =>
        withHook(
          'modifyDefenceDice',
          'test.def',
          (c) => {
            const d = c.data as { dice: number; saveDelta: number }
            d.dice += 1
            d.saveDelta -= 1
            return null
          },
          () => {
            const offered: string[][] = []
            const r = shootWith(s, new ScriptedRng([2, 5, 6, 1, 1, 1, 1, 1]), w.id, s.e, {
              'dice.reroll': (pd) => {
                offered.push(pd.options!.map((o) => o.id))
                return act.pass(pd)
              },
            })
            return { r, offered }
          },
        ),
    )
    const a = evs(p.r.events, 'AttackDiceRolled')[0]!
    expect(a.dice).toHaveLength(4)
    expect(a.need).toBe(2)
    expect(a.lethal).toBe(5)
    expect(p.offered[0]!.every((id) => id.startsWith('ammo:'))).toBe(true)
    const d = evs(p.r.events, 'DefenceDiceRolled')[0]!
    expect(d.collected).toBe(4)
    expect(d.need).toBe(3)
  })

  it('HOOK-003 afterAttackRoll can ask a player a question through weapon.choice and use the answer', () => {
    const { w, s } = flat([])
    const asked: string[] = []
    const p = withHook(
      'afterAttackRoll',
      'test.ask',
      (c) => {
        const d = c.data as { dice: { kind: string; tag?: string }[]; requests: unknown[]; choices: Record<string, string> }
        const choice = d.choices['promote']
        if (choice === undefined) {
          d.requests.push({ id: 'promote', seat: 'A', labelKey: 'test.promote', options: [{ id: 'yes', labelKey: 'y' }, { id: 'no', labelKey: 'n' }] })
        } else if (choice === 'yes') {
          const f = d.dice.find((x) => x.kind === 'fail')
          if (f) {
            f.kind = 'normal'
            f.tag = 'hook' // a tagged die keeps the class a hook gave it
          }
        }
        return null
      },
      () =>
        shootWith(s, new ScriptedRng([1, 1, 1, 1, 1, 1, 1]), w.id, s.e, {
          'weapon.choice': (pd) => {
            asked.push(`${pd.seat}:${String(pd.context.choice)}`)
            return pick(pd, 'yes')
          },
        }),
    )
    expect(asked).toEqual(['A:promote'])
    expect(evs(p.events, 'ChoiceMade')[0]).toMatchObject({ choice: 'promote', option: 'yes' })
    expect(evs(p.events, 'AttackRetained')[0]).toMatchObject({ normal: 1, crit: 0 })
  })

  it('HOOK-004 afterDefenceRoll sees the rolled defence dice', () => {
    const { w, s } = flat([], {}, { targetSave: 3 })
    let seen = 0
    withHook(
      'afterDefenceRoll',
      'test.def-after',
      (c) => {
        const d = c.data as { dice: unknown[]; side: string }
        seen = d.dice.length
        expect(d.side).toBe('defence')
        return null
      },
      () => shootWith(s, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), w.id, s.e),
    )
    expect(seen).toBe(3)
  })

  it('HOOK-005 modifyWeaponRules changes the rules of the weapon immediately (R-10.25)', () => {
    const { w, s } = flat([], {}, { targetWounds: 20 })
    const p = withHook(
      'modifyWeaponRules',
      'test.rules',
      (c) => {
        const d = c.data as { rules: { rule: string; x?: number }[]; kind: string }
        if (d.kind === 'shoot') d.rules.push({ rule: 'devastating', x: 2 })
        return null
      },
      () => shootWith(s, new ScriptedRng([6, 1, 1, 1, 1, 1, 1]), w.id, s.e),
    )
    expect(evs(p.events, 'DamageInflicted').some((d) => d.source === 'devastating' && d.amount === 2)).toBe(true)
  })

  it('HOOK-006 onDamageInflicted can reduce or ignore damage, and afterShootResolved runs once with the targets', () => {
    const { w, s } = flat([], {}, { targetSave: 6 })
    let after: { targets: string[]; incapacitated: string[] } | null = null
    let ignored = 0
    const p = withHook(
      'onDamageInflicted',
      'test.halo',
      (c) => {
        const d = c.data as { source: string; amount: number }
        if (d.source === 'normal' && ignored === 0) {
          ignored++
          d.amount = 0
        }
        return null
      },
      () =>
        withHook(
          'afterShootResolved',
          'test.after',
          (c) => {
            after = c.data as never
            return null
          },
          () => shootWith(s, new ScriptedRng([4, 4, 1, 1, 1, 1, 1]), w.id, s.e),
        ),
    )
    expect(evs(p.events, 'DamageInflicted').map((d) => d.amount)).toEqual([3]) // one of two normals was ignored
    expect(after).toMatchObject({ targets: [s.e], incapacitated: [] })
  })

  it('HOOK-007 beforeStrike can change or cancel a strike and onFightResolved reports the outcome', () => {
    const a = melee('a', { atk: 2, hit: 3 })
    const b = melee('b', { atk: 1, hit: 3 })
    const s = stage({ m: [0, 0.1], e: [0.1, 1.5], mine: [a], theirs: [b] })
    let resolved: { defenderIncapacitated: boolean } | null = null
    const run = () => {
      const st = declareFight(s.state)
      const rng = new ScriptedRng([4, 4, 4])
      const first = step(st, pick(st.pending!, s.e), rng)
      return play(first.state, rng, { 'fight.resolve': (pd) => pd.options!.find((o) => o.id.startsWith('strike'))!.action })
    }
    const out = withHook(
      'beforeStrike',
      'test.strike',
      (c) => {
        const d = c.data as { amount: number; cancel: boolean }
        if (c.operativeId === s.m) d.amount = 1 // the attacker's strikes are weakened to 1
        else d.cancel = true // the defender's strike is cancelled
        return null
      },
      () =>
        withHook(
          'onFightResolved',
          'test.resolved',
          (c) => {
            resolved = c.data as never
            return null
          },
          run,
        ),
    )
    expect(out.state.operatives[s.e]!.wounds).toBe(8)
    expect(out.state.operatives[s.m]!.wounds).toBe(10)
    expect(resolved).toMatchObject({ defenderIncapacitated: false })
  })
})

describe('HOOK Explosive (a bespoke rule left to a hook)', () => {
  it('HOOK-008 a hook can make the shooter its own primary target; Blast then reaches everyone visible within x, friend or foe', () => {
    const boom = ranged('boom', { atk: 2, hit: 3, dmg: { normal: 4, crit: 5 } }, [{ rule: 'blast', inches: 2 }, { rule: 'explosive' }])
    const s = stage({ m: [0, 0], e: [0, 3], mine: [boom], targetSave: 3 })
    const selfShot = (c: HookContext) => {
      const d = c.data as { candidates: string[]; secondary: boolean }
      if (!d.secondary) d.candidates.splice(0, d.candidates.length, c.operativeId!)
      return null
    }
    registerHook('beforeShootTargetSelect', selfShot, 'test.explosive')
    try {
      let st = declareShoot(s.state)
      st = expectOk(step(st, pick(st.pending!, boom.id))).state
      expect(st.pending!.options!.map((o) => o.id)).toEqual([s.m]) // no target is chosen: the shooter is the only option
      const rng = new ScriptedRng([4, 4, 1, 1, 1, 4, 4, 1, 1, 1])
      const first = expectOk(step(st, pick(st.pending!, s.m), rng))
      const rest = play(first.state, rng)
      const events = [...first.events, ...rest.events]
      const sel = evs(events, 'TargetSelected')
      expect(sel.map((x) => [x.targetId, x.secondary, x.inCover, x.obscured])).toEqual([
        [s.m, false, false, false],
        [s.e, true, false, false],
      ])
      expect(rest.state.operatives[s.m]!.wounds).toBe(2) // 10 - 2 x 4
      expect(rest.state.operatives[s.e]!.wounds).toBe(2)
      expect(rng.remaining).toBe(0)
    } finally {
      unregisterHook('beforeShootTargetSelect', 'test.explosive')
    }
  })
})

describe('WIN ploy windows in the attack sequences', () => {
  it('WIN-001 the shoot and fight sequences offer each ploy window once, in order, and carry on when nothing is raised', () => {
    const previous = getWindowOpener()
    const seen: string[] = []
    registerWindowOpener((_ctx, window, info) => {
      seen.push(`${info.kind}:${window}`)
      return false
    })
    try {
      const { w, s } = flat([])
      shootWith(s, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), w.id, s.e)
      expect(seen).toEqual(['shoot:shoot.targetSelected', 'shoot:shoot.attackRolled', 'shoot:shoot.defenceRolled', 'shoot:shoot.resolved'])
      seen.length = 0
      const a = melee('a', { atk: 1 })
      const b = melee('b', { atk: 1 })
      const f = stage({ m: [0, 0.1], e: [0.1, 1.5], mine: [a], theirs: [b] })
      const st = declareFight(f.state)
      const rng = new ScriptedRng([4, 4])
      const first = step(st, pick(st.pending!, f.e), rng)
      play(first.state, rng, { 'fight.resolve': (pd) => pd.options!.find((o) => o.id.startsWith('strike'))!.action })
      expect(seen).toEqual(['fight:fight.weaponsSelected', 'fight:fight.rolled', 'fight:fight.resolved'])
    } finally {
      registerWindowOpener(previous)
    }
  })
})
