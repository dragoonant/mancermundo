import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { legalActions, step, validate } from '@/engine'
import { blockPlans, retainAttack, newSide, pushRetained, pushRolled, validTargets } from '@/engine/attack-common'
import { actionAvailability } from '@/engine/firefight'
import { ScriptedRng } from '@/engine/rng'
import { feature, flatMap, mapWith, part, rect } from '../fixtures/maps'
import { declareShoot, evs, pick, ranged, rolled, shootWith, stage } from '../fixtures/attack'
import { expectOk } from '../fixtures/helpers'

const rifle = ranged('t.rifle', { atk: 4, hit: 3, dmg: { normal: 3, crit: 4 } })
const rubbleNear = (x = 0, z = 1.4) => mapWith(feature('rubble', part('rubble.a', rect(x - 1, x + 1, z, z + 0.4), 0.5, ['light'])))
const lowWall = (z = 0) => mapWith(feature('wall', part('wall.a', rect(-2, 2, z - 0.25, z + 0.25), 0.5, ['heavy'])))

function targetsOf(s: ReturnType<typeof stage>, weaponId = rifle.id): string[] {
  return validTargets(s.state, s.state.operatives[s.m]!, weaponId).map((t) => t.id)
}

describe('SHOOT target selection and the sequence', () => {
  it('SHOOT-001 an Engage target needs only visibility; a Conceal target must also not be in cover', () => {
    const map = rubbleNear()
    const engage = stage({ map, m: [0, -5], e: [0, 2.5], mine: [rifle], targetOrder: 'engage' })
    expect(targetsOf(engage)).toContain(engage.e)
    const conceal = stage({ map, m: [0, -5], e: [0, 2.5], mine: [rifle], targetOrder: 'conceal' })
    expect(targetsOf(conceal)).not.toContain(conceal.e)
    const open = stage({ map: flatMap(), m: [0, -5], e: [0, 2.5], mine: [rifle], targetOrder: 'conceal' })
    expect(targetsOf(open)).toContain(open.e)
  })

  it('SHOOT-002 a target with a friendly operative in its control range is not selectable', () => {
    const s = stage({ m: [0, -5], f: [1.5, 2.5], e: [0, 2.5], mine: [rifle] })
    expect(targetsOf(s)).not.toContain(s.e)
    const apart = stage({ m: [0, -5], f: [5, 2.5], e: [0, 2.5], mine: [rifle] })
    expect(targetsOf(apart)).toContain(apart.e)
    // the rejection says why when the player tries it anyway
    const st = declareShoot(s.state)
    const withE = step(st, pick(st.pending!, rifle.id)).state
    expect(withE.pending!.kind).toBe('shoot.target')
    expect(withE.pending!.options!.map((o) => o.id)).not.toContain(s.e)
    const bad = step(withE, { ...withE.pending!.options![0]!.action, payload: { targetId: s.e } } as never)
    expect(bad.rejection?.code).toBe('E_INVALID_TARGET')
  })

  it('SHOOT-003 Shoot is rejected while in an enemy control range', () => {
    const s = stage({ m: [0, 0], e: [0, 1.5], mine: [rifle] })
    const op = s.state.operatives[s.m]!
    expect(actionAvailability(s.state, op, 'shoot', s.state.firefight.activation)?.code).toBe('E_ACTION_RESTRICTED')
    const r = step(s.state, act.action(s.state.pending!, 'shoot'))
    expect(r.rejection?.code).toBe('E_ACTION_RESTRICTED')
    expect(s.state.pending!.options!.map((o) => o.id)).not.toContain('shoot')
  })

  it('SHOOT-004 with Hit 3+ the engine classifies 6 as a crit, 3 to 5 as normal, 2 and 1 as fails', () => {
    const w = ranged('t.five', { atk: 5, hit: 3 })
    const s = stage({ m: [0, -5], e: [0, 4], mine: [w] })
    const p = shootWith(s, new ScriptedRng([6, 5, 3, 2, 1, 1, 1, 1]), w.id, s.e)
    expect(evs(p.events, 'AttackDiceRolled')[0]!.kinds).toEqual(['crit', 'normal', 'normal', 'fail', 'fail'])
  })

  it('SHOOT-005 the defender collects 3 dice; results at or above Save succeed, 6 is a crit, 1 fails', () => {
    const s = stage({ m: [0, -5], e: [0, 4], mine: [rifle], targetSave: 4 })
    const p = shootWith(s, new ScriptedRng([6, 6, 6, 6, 6, 4, 1]), rifle.id, s.e)
    const def = evs(p.events, 'DefenceDiceRolled')[0]!
    expect(def.collected).toBe(3)
    expect(def.need).toBe(4)
    expect(def.kinds).toEqual(['crit', 'normal', 'fail'])
  })

  it('SHOOT-006 cover needs terrain within the target control range and the target more than 2" from the shooter', () => {
    const rubble = mapWith(feature('rubble', part('rubble.a', rect(-0.25, 0.25, -2, 2), 0.5, ['light'])))
    const near = stage({ map: rubble, m: [-4, 0], e: [1, 0], mine: [rifle] })
    const p = shootWith(near, new ScriptedRng([6, 6, 6, 6, 1, 1]), rifle.id, near.e)
    expect(evs(p.events, 'TargetSelected')[0]!.inCover).toBe(true)
    expect(evs(p.events, 'CoverSaveRetained')).toHaveLength(1)
    const tight = stage({ map: rubble, m: [-1.5, 0], e: [1.5, 0], mine: [rifle] })
    const q = shootWith(tight, new ScriptedRng([6, 6, 6, 6, 1, 1, 1]), rifle.id, tight.e)
    expect(evs(q.events, 'TargetSelected')[0]!.inCover).toBe(false)
    expect(evs(q.events, 'CoverSaveRetained')).toHaveLength(0)
    const far = stage({ map: rubble, m: [-9, 0], e: [4, 0], mine: [rifle] })
    const f = shootWith(far, new ScriptedRng([6, 6, 6, 6, 1, 1, 1]), rifle.id, far.e)
    expect(evs(f.events, 'TargetSelected')[0]!.inCover).toBe(false)
  })

  it('SHOOT-007 a cover save retains one normal success unrolled, so only 2 defence dice are rolled', () => {
    const s = stage({ map: rubbleNear(), m: [0, -5], e: [0, 2.5], mine: [rifle], targetSave: 5 })
    const rng = new ScriptedRng([3, 3, 3, 3, 6, 1])
    const p = shootWith(s, rng, rifle.id, s.e)
    const def = evs(p.events, 'DefenceDiceRolled')[0]!
    expect(def.dice).toEqual([null, 6, 1])
    expect(rolled(p.events, 'shoot.defence')).toEqual([[6, 1]])
    expect(def.kinds).toEqual(['normal', 'crit', 'fail'])
    // the retained die is one normal success; the rolled crit blocks, so 3 normals and the crit's single block remain
    expect(evs(p.events, 'CoverSaveRetained')[0]).toMatchObject({ normal: 1, crit: 0 })
  })

  it('SHOOT-008 obscured needs intervening Heavy terrain more than 1" from both operatives', () => {
    const far = stage({ map: lowWall(0), m: [0, -5], e: [0, 4], mine: [rifle] })
    const p = shootWith(far, new ScriptedRng([6, 5, 4, 1, 1, 1, 1]), rifle.id, far.e)
    const sel = evs(p.events, 'TargetSelected')[0]!
    expect([sel.inCover, sel.obscured]).toEqual([false, true])
    const nearTarget = stage({ map: lowWall(2.9), m: [0, -5], e: [0, 4], mine: [rifle] })
    const q = shootWith(nearTarget, new ScriptedRng([6, 5, 4, 1, 1, 1, 1]), rifle.id, nearTarget.e)
    const sel2 = evs(q.events, 'TargetSelected')[0]!
    expect([sel2.inCover, sel2.obscured]).toEqual([true, false])
  })

  it('SHOOT-009 obscured turns retained crits into normals and discards one success; crit-triggered rules do not fire', () => {
    const w = ranged('t.crit', { atk: 4, hit: 3, dmg: { normal: 3, crit: 4 } }, [
      { rule: 'devastating', x: 2 },
      { rule: 'punishing' },
      { rule: 'piercing', x: 1, crits: true },
    ])
    const s = stage({ map: lowWall(0), m: [0, -5], e: [0, 4], mine: [w] })
    const p = shootWith(s, new ScriptedRng([6, 6, 3, 2, 1, 1, 1]), w.id, s.e)
    const kept = evs(p.events, 'AttackRetained')[0]!
    expect([kept.crit, kept.normal]).toEqual([0, 2])
    expect(kept.converted).toEqual([])
    expect(evs(p.events, 'DamageInflicted').map((d) => d.source)).toEqual(['normal', 'normal'])
    expect(evs(p.events, 'DefenceDiceRolled')[0]!.collected).toBe(3)
  })

  it('SHOOT-010 one feature giving both cover and obscured makes the defender choose; separate features give both', () => {
    const one = mapWith(
      feature('ruin', part('ruin.heavy', rect(-0.25, 0.25, -2, 2), 0.5, ['heavy']), part('ruin.light', rect(2.6, 3, -2, 2), 0.5, ['light'])),
    )
    const base = stage({ map: one, m: [-6, 0], e: [4, 0], mine: [rifle] })
    let st = declareShoot(base.state)
    st = expectOk(step(st, pick(st.pending!, rifle.id))).state
    st = expectOk(step(st, pick(st.pending!, base.e))).state
    expect(st.pending).toMatchObject({ kind: 'weapon.choice', seat: base.foe })
    expect(st.pending!.options!.map((o) => o.id)).toEqual(['cover', 'obscured'])
    const asCover = expectOk(step(st, pick(st.pending!, 'cover')))
    expect(evs(asCover.events, 'TargetSelected')[0]).toMatchObject({ inCover: true, obscured: false })
    const asObscured = expectOk(step(st, pick(st.pending!, 'obscured')))
    expect(evs(asObscured.events, 'TargetSelected')[0]).toMatchObject({ inCover: false, obscured: true })
    const two = mapWith(
      feature('wall', part('wall.heavy', rect(-0.25, 0.25, -2, 2), 0.5, ['heavy'])),
      feature('rubble', part('rubble.light', rect(2.6, 3, -2, 2), 0.5, ['light'])),
    )
    const sep = stage({ map: two, m: [-6, 0], e: [4, 0], mine: [rifle] })
    let sp = declareShoot(sep.state)
    sp = expectOk(step(sp, pick(sp.pending!, rifle.id))).state
    const next = expectOk(step(sp, pick(sp.pending!, sep.e)))
    expect(next.state.pending!.kind).not.toBe('weapon.choice')
    expect(evs(next.events, 'TargetSelected')[0]).toMatchObject({ inCover: true, obscured: true })
  })

  it('SHOOT-011 a normal blocks a normal, two normals block a crit, a crit blocks a normal or a crit', () => {
    const dmg = { normal: 3, crit: 4 }
    // 1 attack normal vs 1 defence normal
    expect(blockPlans(1, 0, 1, 0, dmg, false)[0]).toMatchObject({ unblockedNormal: 0, unblockedCrit: 0 })
    // a lone defence normal cannot stop a crit
    expect(blockPlans(0, 1, 1, 0, dmg, false)[0]).toMatchObject({ unblockedCrit: 1 })
    // two normals stop a crit
    expect(blockPlans(0, 1, 2, 0, dmg, false)[0]).toMatchObject({ unblockedCrit: 0 })
    // a crit stops a normal or a crit
    expect(blockPlans(1, 0, 0, 1, dmg, false)[0]).toMatchObject({ unblockedNormal: 0 })
    expect(blockPlans(0, 1, 0, 1, dmg, false)[0]).toMatchObject({ unblockedCrit: 0 })
    // a normal never blocks a crit alone, and a crit blocks only one die
    expect(blockPlans(2, 0, 0, 1, dmg, false)[0]).toMatchObject({ unblockedNormal: 1 })
    // the auto plan is the one with least damage: 2 attack normals + 1 crit vs 2 defence normals
    const plans = blockPlans(2, 1, 2, 0, dmg, false)
    expect(plans[0]).toMatchObject({ unblockedNormal: 0, unblockedCrit: 1, damage: 4 })
    expect(plans.some((p) => p.unblockedNormal === 2 && p.unblockedCrit === 0)).toBe(true)
  })

  it('SHOOT-012 each unblocked normal deals Normal Dmg and each unblocked crit Critical Dmg, resolved together', () => {
    const w = ranged('t.dmg', { atk: 4, hit: 3, dmg: { normal: 2, crit: 5 } })
    const s = stage({ m: [0, -5], e: [0, 4], mine: [w], targetSave: 6 })
    const p = shootWith(s, new ScriptedRng([6, 4, 4, 1, 1, 1, 1]), w.id, s.e)
    const dmg = evs(p.events, 'DamageInflicted')
    expect(dmg.map((d) => [d.source, d.amount])).toEqual([
      ['crit', 5],
      ['normal', 2],
      ['normal', 2],
    ])
    expect(p.state.operatives[s.e]!.wounds).toBe(1)
  })

  it('SHOOT-013 incapacitated operatives stay until the whole action, including every Blast sequence, has finished', () => {
    const blast = ranged('t.blast', { atk: 4, hit: 3, dmg: { normal: 6, crit: 7 } }, [{ rule: 'blast', inches: 2 }])
    const s = stage({ m: [0, -5], e: [0, 4], e2: [1.6, 4], mine: [blast], targetWounds: 5, targetSave: 6 })
    const seen: { status: string; wounds: number; index: number }[] = []
    const rng = new ScriptedRng([
      4, 4, 1, 1, 1, 1, 1, // primary: attack, defence all fail
      4, 1, 1, 1, 1, 1, 1, // secondary: attack, defence
    ])
    const p = shootWith(s, rng, blast.id, s.e, {
      'dice.commandReroll': (pd, st) => {
        seen.push({ status: st.operatives[s.e]!.status, wounds: st.operatives[s.e]!.wounds, index: st.attack?.index ?? -1 })
        return act.pass(pd)
      },
    })
    // while the secondary sequence is open the primary is on 0 wounds but still on the killzone
    const during = seen.find((x) => x.index === 1)!
    expect(during).toEqual({ status: 'active', wounds: 0, index: 1 })
    expect(p.state.operatives[s.e]!.status).toBe('removed')
    expect(evs(p.events, 'OperativeIncapacitated').map((x) => x.operativeId)).toContain(s.e)
    expect(evs(p.events, 'OperativeRemoved').map((x) => x.operativeId)).toEqual([s.e])
    expect(rng.remaining).toBe(0)
  })

  it('SHOOT-014 a die retained by Accurate or Punishing cannot be re-retained by Rending; Severe may still change it', () => {
    const mk = (values: number[], accurate: number) => {
      const side = newSide('A', 'x', 'w', 3, null, [])
      pushRolled(side, values)
      pushRetained(side, accurate, 'normal', 'accurate')
      return side
    }
    // Rending needs a natural crit and a normal retained by rolling: the Accurate die is not eligible
    const a = mk([6, 1], 1)
    const outA = retainAttack(a, { rending: true } as never, false)
    expect(outA.converted).toEqual([])
    expect(a.dice.map((d) => d.kind)).toEqual(['crit', 'fail', 'normal'])
    // Punishing's new normal cannot be converted by Rending either
    const b = mk([6, 1, 1], 0)
    retainAttack(b, { rending: true, punishing: true } as never, false)
    expect(b.dice.map((d) => d.kind)).toEqual(['crit', 'normal', 'fail'])
    expect(b.dice[1]!.tag).toBe('punishing')
    // Severe may change an Accurate-retained die (no crit rolled)
    const c = mk([2, 1], 1)
    retainAttack(c, { severe: true } as never, false)
    expect(c.dice.map((d) => d.kind)).toEqual(['fail', 'fail', 'crit'])
  })

  it('SHOOT-015 Piercing 1 against a target in cover leaves 2 dice: 1 cover save plus 1 rolled', () => {
    const w = ranged('t.pierce', { atk: 4, hit: 3 }, [{ rule: 'piercing', x: 1 }])
    const s = stage({ map: rubbleNear(), m: [0, -5], e: [0, 2.5], mine: [w] })
    const p = shootWith(s, new ScriptedRng([3, 3, 3, 3, 1]), w.id, s.e)
    const def = evs(p.events, 'DefenceDiceRolled')[0]!
    expect(def.collected).toBe(2)
    expect(def.dice).toEqual([null, 1])
    expect(rolled(p.events, 'shoot.defence')).toEqual([[1]])
  })
})

describe('SHOOT decisions and options', () => {
  it('SHOOT-018 shoot.weapon lists every ranged profile of the loadout, and passing cancels the action for free', () => {
    const a = ranged('t.a', { name: 'Gun (a)' }, [])
    const b = ranged('t.b', { name: 'Gun (b)', profileGroup: 't.g' }, [{ rule: 'devastating', x: 1 }])
    const s = stage({ m: [0, -5], e: [0, 4], mine: [a, b] })
    const st = declareShoot(s.state)
    expect(st.pending!.kind).toBe('shoot.weapon')
    expect(st.pending!.options!.map((o) => o.id)).toEqual(['t.a', 't.b'])
    expect(legalActions(st)!.some((x) => x.type === 'pass')).toBe(true)
    const cancelled = expectOk(step(st, act.pass(st.pending!)))
    expect(cancelled.state.pending!.kind).toBe('firefight.action')
    expect(cancelled.state.firefight.activation!.apSpent).toBe(0)
    expect(cancelled.state.firefight.activation!.performed).toEqual([])
    expect(evs(cancelled.events, 'ActionCancelled')).toHaveLength(1)
  })

  it('SHOOT-019 every listed shoot decision answer validates, and a made-up one is rejected', () => {
    const s = stage({ map: rubbleNear(), m: [0, -5], e: [0, 2.5], mine: [rifle] })
    let st = declareShoot(s.state)
    for (let i = 0; i < 12 && st.pending && st.pending.kind !== 'firefight.action'; i++) {
      for (const a of legalActions(st)!) expect(validate(st, a)).toBeNull()
      const bogus = { ...st.pending!.options![0]!.action, payload: { weaponId: 'nope', targetId: 'nope', mode: 'nope', unblocked: [9, 9], dice: [9] } }
      expect(step(st, bogus as never).rejection).toBeDefined()
      st = expectOk(step(st, st.pending!.options![0]!.action, new ScriptedRng([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]))).state
    }
  })

  it('SHOOT-020 the whole action costs 1 AP and the shot cannot be repeated in the same activation', () => {
    const s = stage({ m: [0, -5], e: [0, 4], mine: [rifle] })
    const p = shootWith(s, new ScriptedRng([4, 1, 1, 1, 1, 1, 1]), rifle.id, s.e)
    expect(p.state.pending!.kind).toBe('firefight.action')
    expect(p.state.firefight.activation!.apSpent).toBe(1)
    expect(p.state.firefight.activation!.performed).toEqual(['shoot'])
    expect(p.state.pending!.options!.map((o) => o.id)).not.toContain('shoot')
    expect(p.state.attack ?? null).toBeNull()
  })

  it('SHOOT-021 target options carry the engine odds: distance, cover, expected damage and kill probability', () => {
    const s = stage({ map: rubbleNear(), m: [0, -5], e: [0, 2.5], mine: [rifle] })
    let st = declareShoot(s.state)
    st = expectOk(step(st, pick(st.pending!, rifle.id))).state
    const o = st.pending!.options!.find((x) => x.id === s.e)!
    expect(o.data).toMatchObject({ inCover: true, obscured: false })
    expect(o.data!.expectedDamage as number).toBeGreaterThan(0)
    expect(o.data!.killProbability as number).toBeGreaterThanOrEqual(0)
  })

  it('SHOOT-022 a Blast secondary is shot after the primary in the same action and a friend can be hit', () => {
    const blast = ranged('t.blast2', { atk: 3, hit: 3, dmg: { normal: 1, crit: 2 } }, [{ rule: 'blast', inches: 2 }])
    const s = stage({ m: [0, -5], f: [-2.6, 4], e: [0, 4], e2: [1.6, 4], mine: [blast] })
    const dice = new Array(60).fill(3)
    const p = shootWith(s, new ScriptedRng(dice), blast.id, s.e)
    const sel = evs(p.events, 'TargetSelected')
    expect(sel.map((x) => [x.targetId, x.secondary])).toEqual([
      [s.e, false],
      [s.e2, true],
      [s.f, true],
    ])
    expect(evs(p.events, 'ShootEnded')).toHaveLength(1)
  })
})
