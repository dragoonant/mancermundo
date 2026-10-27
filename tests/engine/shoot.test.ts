import { describe, expect, it } from 'vitest'
import { query, step } from '@/engine'
import { stat } from '@/engine/query'
import { hitNeedFor, profileOf } from '@/engine/shoot'
import { attackBundle, dice, shootingGame } from '../fixtures/attack'
import { edit, eventsOf, menuActions, must, take } from '../fixtures/helpers'
import type { GameEvent, GameState } from '@/engine'

const R = 0.492 // 25 mm base radius

/** Choose Shoot and, when asked, the weapon: lands on shoot.target (or shoot.aim for a template). */
function shoot(s: GameState, weaponId?: string, profileId = 'std', action = 'shoot'): GameState {
  let r = must(take(s, { action }))
  if (r.pending!.kind === 'shoot.weapon') r = must(take(r.state, { weaponId: weaponId!, profileId }))
  return r.state
}

const types = (events: GameEvent[]) => events.map((e) => e.type)

describe('SHOOT: the ranged attack sequence (R-8)', () => {
  it('SHOOT-001 an Engaged enemy is an eligible ranged target; a Prone enemy in cover is not', () => {
    const s = shootingGame({
      board: 'test.barricade',
      spots: {
        A3: { x: 0, z: -6, facing: 0 },
        A4: { x: 4 + 2 * R, z: -1 },
        B3: { x: 4, z: -1 },
        B4: { x: 0, z: 0.8, posture: 'pinned' },
      },
      active: 'A3',
    })
    expect(s.fighters.B3!.engagedWith).toEqual(['A4'])
    const ids = query.shootTargets(s, 'A3', 'test.w.rifle', 'std').map((t) => t.targetId)
    expect(ids).toContain('B3')
    expect(query.cover(s, 'A3', 'B4').cover).not.toBe('none')
    expect(ids).not.toContain('B4')
    // the same fighter standing behind the barricade is a target (in cover, at a penalty)
    const standing = edit(s, (d) => (d.fighters.B4!.posture = 'standing'))
    expect(query.shootTargets(standing, 'A3', 'test.w.rifle', 'std').map((t) => t.targetId)).toContain('B4')
  })

  it('SHOOT-002 the closest eligible enemy is the default target; a farther one needs a Cool test unless it is easier to hit', () => {
    const spots = { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: -2 }, B4: { x: 2, z: 4 } }
    const s = shootingGame({ spots, active: 'A3' })
    const t = Object.fromEntries(query.shootTargets(s, 'A3', 'test.w.rifle', 'std').map((x) => [x.targetId, x]))
    expect(t.B3!.priority).toBe('closest')
    expect(t.B4!.priority).toBe('coolTest')
    // the closest one Engaged (-1) makes the farther one easier to hit: no test
    const engaged = shootingGame({ spots: { ...spots, A4: { x: -2 * R, z: -2 } }, active: 'A3' })
    const t2 = Object.fromEntries(query.shootTargets(engaged, 'A3', 'test.w.rifle', 'std').map((x) => [x.targetId, x]))
    expect(t2.B3!.need).toBeGreaterThan(t2.B4!.need)
    expect(t2.B4!.priority).toBe('free')
    // the decision carries the class on each option
    const r = take(engaged, { action: 'shoot' })
    expect(r.pending!.kind).toBe('shoot.target')
    expect(r.pending!.options!.find((o) => o.id === 't:B4')!.data!.priority).toBe('free')
  })

  it('SHOOT-003 a closer Seriously Injured enemy may be ignored without a Cool test', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: -2, posture: 'seriouslyInjured' }, B4: { x: 2, z: 4 } }, active: 'A3' })
    const t = Object.fromEntries(query.shootTargets(s, 'A3', 'test.w.rifle', 'std').map((x) => [x.targetId, x]))
    expect(t.B3!.priority).toBe('closest')
    expect(t.B4!.priority).toBe('free')
  })

  it('SHOOT-004 a failed target-priority Cool test redirects the shot to the closest enemy instead of cancelling it', () => {
    const s = shoot(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: -2 }, B4: { x: 2, z: 4 } }, active: 'A3' }))
    // Cool 7+: 1 + 2 fails; then the hit roll (a 1 misses) and the rifle's Firepower dice
    const r = must(take(s, { targetId: 'B4' }, dice(1, 2, 1, 3)))
    expect(eventsOf(r.events, 'PriorityTest')[0]).toMatchObject({ fighterId: 'A3', roll: 3, need: 7, passed: false, redirectedTo: 'B3' })
    expect(eventsOf(r.events, 'HitRolled')[0]).toMatchObject({ targetId: 'B3', hit: false })
    // the action was still spent
    expect(r.state.action.activation!.performed.map((p) => p.action)).toEqual(['shoot'])
    // a pass shoots the farther target
    // (B3 stands within 1" of the line to B4: one stray-shot roll, 6 = safe)
    const r2 = must(take(s, { targetId: 'B4' }, dice(4, 4, 1, 3, 6)))
    expect(eventsOf(r2.events, 'PriorityTest')[0]).toMatchObject({ passed: true })
    expect(eventsOf(r2.events, 'HitRolled')[0]).toMatchObject({ targetId: 'B4' })
  })

  it('SHOOT-005 a target at exactly Short range uses the Short accuracy; just beyond uses Long; beyond Long auto-misses but still rolls the Firepower die', () => {
    const at = (z: number) => shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z } }, loadouts: { A3: { weapons: ['test.w.pistol'] } }, active: 'A3' })
    const short = query.shootTargets(at(2 * R), 'A3', 'test.w.pistol', 'std')[0]!
    expect(short.distance).toBeCloseTo(6, 6)
    expect(short.band).toBe('short')
    expect(short.modifiers).toContainEqual({ label: 'accuracyShort', value: 1 })
    const long = query.shootTargets(at(2 * R + 0.01), 'A3', 'test.w.pistol', 'std')[0]!
    expect(long.band).toBe('long')
    expect(long.modifiers.find((m) => m.label.startsWith('accuracy'))).toBeUndefined() // Long accuracy 0
    const far = at(7.5)
    expect(query.shootTargets(far, 'A3', 'test.w.pistol', 'std')[0]!).toMatchObject({ band: null, chance: 0 })
    const r = must(take(shoot(far), { targetId: 'B3' }, dice(2)))
    expect(eventsOf(r.events, 'HitRolled')[0]).toMatchObject({ dice: [], hit: false })
    expect(eventsOf(r.events, 'DiceRolled').map((d) => d.die)).toEqual(['firepower'])
  })

  it('SHOOT-006 modifiers stack: full cover -2, target Engaged -1, Long-range Prone -1 and Aim +1 add up', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 10 } }, active: 'A3' })
    const p = profileOf(s, 'test.w.rifle', 'std')!
    const bs = stat(s, 'A3', 'BS')
    // an Engaged target is always Standing and a Prone one in cover cannot be targeted, so the four come in two real pairs
    const engaged = { ...s.fighters.B3!, engagedWith: ['A4'] }
    const a = hitNeedFor(s, s.fighters.A3!, p, { mode: 'shoot', band: 'long', cover: 'full', target: engaged, aimed: true })
    expect(a.modifiers.map((m) => m.value).sort((x, y) => x - y)).toEqual([-2, -1, 1])
    expect(a.need).toBe(bs + 2)
    const prone = { ...s.fighters.B3!, posture: 'pinned' as const }
    const b = hitNeedFor(s, s.fighters.A3!, p, { mode: 'shoot', band: 'long', cover: 'none', target: prone, aimed: true })
    expect(b.modifiers.map((m) => m.value).sort((x, y) => x - y)).toEqual([-1, 1])
    // all four on one roll: -2 -1 -1 +1 = -3
    const all = [...a.modifiers, ...b.modifiers.filter((m) => m.label === 'targetProneAtLong')].reduce((n, m) => n + m.value, 0)
    expect(all).toBe(-3)
    // through the decision: Aim, then Shoot at a Pinned target at Long range in the open
    let r = must(take(edit(s, (d) => (d.fighters.B3!.posture = 'pinned')), { action: 'aim' }))
    r = must(take(r.state, { action: 'shoot' }))
    const opt = r.pending!.options!.find((o) => o.id === 't:B3')!
    expect(opt.data!.need).toBe(bs - 1 + 1)
  })

  it('SHOOT-007 an improbable shot needs a 6 then a second roll against the unmodified BS', () => {
    // a Juve (BS 5+) Blind Firing (-2) at a target in full cover behind a barricade (-2), pistol at Short (+1), needs 8+
    const base = shootingGame({
      board: 'test.barricade',
      spots: { A5: { x: 0, z: -6, posture: 'pinned' }, B3: { x: 0, z: 0.8 } },
      loadouts: { A5: { weapons: ['test.w.pistol'] } },
      active: 'A5',
    })
    const s = shoot(base, undefined, 'std', 'blindFire')
    expect(s.pending!.options!.find((o) => o.id === 't:B3')!.data!.need).toBe(8)
    const hit = must(take(s, { targetId: 'B3' }, dice(6, 5, 3, 1)))
    expect(eventsOf(hit.events, 'HitRolled')[0]).toMatchObject({ dice: [6, 5], hit: true, improbable: true })
    const miss = must(take(s, { targetId: 'B3' }, dice(6, 4, 3)))
    expect(eventsOf(miss.events, 'HitRolled')[0]).toMatchObject({ dice: [6, 4], hit: false })
    const noSix = must(take(s, { targetId: 'B3' }, dice(5, 3)))
    expect(eventsOf(noSix.events, 'HitRolled')[0]).toMatchObject({ dice: [5], hit: false })
  })

  it('SHOOT-008 a Standing Active target hit by a ranged attack is Pinned before the wound roll, even if the wound roll fails', () => {
    const s = shoot(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, active: 'A3' }))
    const r = must(take(s, { targetId: 'B3' }, dice(5, 2, 1)))
    const t = types(r.events)
    expect(t.indexOf('FighterPinned')).toBeGreaterThan(-1)
    expect(t.indexOf('FighterPinned')).toBeLessThan(t.indexOf('WoundRolled'))
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ wounded: false })
    expect(r.state.fighters.B3!.posture).toBe('pinned')
  })

  it('SHOOT-009 a miss rolls stray shots for fighters within 1 inch of the line, closest to the shooter first; 1-3 hits that fighter and stops the check', () => {
    const s = shoot(
      shootingGame({
        spots: { A3: { x: 0, z: -6, facing: 0 }, A2: { x: 0.9, z: -3 }, B3: { x: 0, z: 2 }, A4: { x: 2 * R, z: 2 }, A5: { x: -2 * R, z: 2 } },
        active: 'A3',
      }),
    )
    // miss (1), rifle Firepower (2: one hole), A2 rolls 4 (safe), A4 rolls 3 (hit: wound 1 fails); A5 is never checked
    const r = must(take(s, { targetId: 'B3' }, dice(1, 2, 4, 3, 1)))
    const strays = eventsOf(r.events, 'StrayShot')
    expect(strays.map((x) => [x.candidateId, x.hit])).toEqual([
      ['A2', false],
      ['A4', true],
    ])
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'A4' })
  })

  it('SHOOT-010 an Ammo symbol with a failed Ammo test marks the weapon Out of Ammo after the attack resolves; all its profiles become unusable', () => {
    const s = shoot(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.dual'] } }, active: 'A3' }), 'atk.w.dual', 'a')
    // hit 5, Firepower 1 (Ammo symbol), Ammo test 2 (needs 5+), wound 1 fails
    const r = must(take(s, { targetId: 'B3' }, dice(5, 1, 2, 1)))
    const t = types(r.events)
    expect(eventsOf(r.events, 'AmmoTest')[0]).toMatchObject({ passed: false, need: 5 })
    expect(t.indexOf('WeaponStateChanged')).toBeGreaterThan(t.indexOf('WoundRolled'))
    expect(r.state.fighters.A3!.weapons[0]!.ammo).toBe('out')
    expect(query.shootOptions(r.state, 'A3')).toEqual([])
    expect(menuActions(r.state)).toContain('reload')
    expect(menuActions(r.state)).not.toContain('shoot')
  })

  it('SHOOT-011 Reload of a Plentiful weapon always succeeds; a Scarce weapon cannot be reloaded', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.plentiful', 'atk.w.scarce'] } } })
    const out = edit(s, (d) => d.fighters.A3!.weapons.forEach((w) => (w.ammo = 'out')))
    const a = take(out, { fighterId: 'A3' }).state
    const reloads = a.pending!.options!.filter((o) => (o.action.payload as { action: string }).action === 'reload')
    expect(reloads.map((o) => (o.action.payload as { weaponId: string }).weaponId)).toEqual(['atk.w.plentiful'])
    expect(reloads[0]!.data).toMatchObject({ chance: 1, plentiful: true })
    const r = must(take(a, { action: 'reload', weaponId: 'atk.w.plentiful' }, dice()))
    expect(r.state.fighters.A3!.weapons[0]!.ammo).toBe('ok')
    const refused = step(a, { type: 'action.choose', seat: 'A', decisionId: a.pending!.id, payload: { action: 'reload', weaponId: 'atk.w.scarce' } })
    expect(refused.rejection).toBeDefined()
    expect(refused.state).toBe(a)
  })
})

describe('Shooting details beyond the checklist rows', () => {
  it('Aim gives +1 to the next Shoot of the activation and is offered only with two actions left', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, active: 'A3' })
    const before = s.pending!.options!.length
    expect(menuActions(s)).toContain('aim')
    const r = must(take(s, { action: 'aim' }))
    expect(menuActions(r.state)).not.toContain('aim')
    const t = must(take(r.state, { action: 'shoot' }))
    expect(t.pending!.options![0]!.data!.modifiers).toContainEqual({ label: 'aim', value: 1 })
    expect(before).toBeGreaterThan(0)
  })

  it('an Unwieldy weapon makes Shoot a Double action (refused with one action left)', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.heavy'] } }, active: 'A3' })
    const r = must(take(shoot(s), { targetId: 'B3' }, dice(1)))
    expect(r.state.action.activation).toBeNull() // both actions spent: the activation ended
    expect(eventsOf(r.events, 'ActivationEnded')[0]).toMatchObject({ fighterId: 'A3', actionsUsed: 2 })
    const one = edit(s, (d) => (d.action.activation!.actionsLeft = 1))
    expect(query.shootOptions(one, 'A3')).toEqual([])
  })

  it('two Sidearms fire together at one target, -1 to hit each, each with its own hit roll', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.side1', 'atk.w.side2'] } }, active: 'A3' })
    let r = must(take(s, { action: 'shoot' }))
    expect(r.pending!.kind).toBe('shoot.weapon')
    r = must(take(r.state, { weaponId: 'atk.w.side1', twinWith: 'atk.w.side2' }))
    expect(eventsOf(r.events, 'ShootStarted').map((e) => e.weaponId)).toEqual(['atk.w.side1', 'atk.w.side2'])
    expect(r.pending!.options![0]!.data!.modifiers).toContainEqual({ label: 'twinSidearms', value: -1 })
    r = must(take(r.state, { targetId: 'B3' }, dice(1, 1)))
    expect(eventsOf(r.events, 'HitRolled')).toHaveLength(2)
  })

  it('a pass on the target choice gives the action back', () => {
    const s = shoot(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, active: 'A3' }))
    const r = must(step(s, { type: 'pass', seat: 'A', decisionId: s.pending!.id, payload: {} }))
    expect(r.state.attack).toBeNull()
    expect(r.state.action.activation!.actionsLeft).toBe(2)
    expect(r.pending!.kind).toBe('action.choose')
  })

  it('Unstable: an Ammo symbol and a 1-3 take the shooter Out of Action once the attack is resolved', () => {
    const s = shoot(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.unstable'] } }, active: 'A3' }))
    // hit 5, Firepower 1 (symbol), Ammo test 6 (pass), Unstable 2 (blown), wound 1
    const r = must(take(s, { targetId: 'B3' }, dice(5, 1, 6, 2, 1)))
    const t = types(r.events)
    expect(t.indexOf('FighterOutOfAction')).toBeGreaterThan(t.indexOf('WoundRolled'))
    expect(r.state.fighters.A3!.location).toBe('outOfAction')
    expect(r.state.casualties).toContainEqual(expect.objectContaining({ fighterId: 'A3', cause: 'unstable', kind: 'outOfAction' }))
  })

  it('a Grenade has no Short range (Long = S x 3), rolls no Firepower dice and is spent on a failed Ammo test after the throw', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.grenade'] } }, active: 'A3' })
    const t = query.shootTargets(s, 'A3', 'atk.w.grenade', 'std')[0]!
    expect(t.band).toBe('long')
    // hit 6, Ammo test 2 (fail, no Firepower dice), the marker hits B3: wound 1
    const r = must(take(shoot(s), { targetId: 'B3' }, dice(6, 2, 1)))
    expect(eventsOf(r.events, 'DiceRolled').some((d) => d.die === 'firepower')).toBe(false)
    expect(r.state.fighters.A3!.weapons[0]!.ammo).toBe('spent')
  })

  it('Single Shot is spent after one use; Limited loses that profile when its Ammo test fails', () => {
    const one = shoot(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.single'] } }, active: 'A3' }))
    const r = must(take(one, { targetId: 'B3' }, dice(1)))
    expect(r.state.fighters.A3!.weapons[0]!.ammo).toBe('spent')
    const lim = shoot(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.limited'] } }, active: 'A3' }))
    const r2 = must(take(lim, { targetId: 'B3' }, dice(1, 1, 1)))
    expect(r2.state.fighters.A3!.weapons[0]).toMatchObject({ ammo: 'spent', lostProfiles: ['std'] })
  })

  it('query.expectedOutcome and the target option use the same hit chance', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }, active: 'A3' })
    const o = query.expectedOutcome(s, 'A3', 'test.w.rifle', 'std', 'B3')
    const t = query.shootTargets(s, 'A3', 'test.w.rifle', 'std')[0]!
    expect(o.pHit).toBeCloseTo(t.chance, 9)
    expect(o.pPinned).toBeCloseTo(t.chance, 9)
    expect(o.pOutOfAction + o.pSeriouslyInjured).toBeGreaterThan(0)
    expect(o.pOutOfAction + o.pSeriouslyInjured).toBeLessThanOrEqual(o.pHit)
    void attackBundle
  })
})

describe('SHOOT: reloading and range (R-8.11, R-8.4, R-8.8)', () => {
  it('SHOOT-012 Reload uses the easiest profile still available; a Single Shot profile never reloads, even next to an ammo cache', () => {
    const s = edit(shootingGame({ spots: { A3: { x: 0, z: -6 }, B3: { x: 0, z: 0 } }, loadouts: { A3: { weapons: ['atk.w.dual', 'atk.w.single'] } } }), (d) => {
      const dual = d.data.weapons['atk.w.dual']!
      d.data = { ...d.data, weapons: { ...d.data.weapons, 'atk.w.dual': { ...dual, profiles: [dual.profiles[0]!, { ...dual.profiles[1]!, ammo: 3 }] } } }
      d.fighters.A3!.weapons.forEach((w) => (w.ammo = 'out'))
      d.board.caskets.k1 = { pos: { x: 1.2, z: -6 }, state: 'ammoCache', carriedBy: null }
    })
    const a = take(s, { fighterId: 'A3' }).state
    const reloads = a.pending!.options!.filter((o) => (o.action.payload as { action: string }).action === 'reload')
    expect(reloads.map((o) => (o.action.payload as { weaponId: string }).weaponId)).toEqual(['atk.w.dual'])
    expect(reloads[0]!.data).toMatchObject({ need: 3, bonus: 2 })
    // with profile b lost (Limited), only profile a (5+) is left to reload with
    const lost = take(edit(s, (d) => (d.fighters.A3!.weapons[0]!.lostProfiles = ['b'])), { fighterId: 'A3' }).state
    const opt = lost.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'reload')!
    expect(opt.data).toMatchObject({ need: 5 })
  })

  it('SHOOT-013 a shot beyond Long range misses and, like any miss, risks stray shots on fighters within 1 inch of the line', () => {
    const s = shoot(
      shootingGame({
        spots: { A3: { x: 0, z: -14, facing: 0 }, A2: { x: 0.9, z: -8 }, B3: { x: 0, z: 14 } },
        loadouts: { A3: { weapons: ['atk.w.plain'] } },
        active: 'A3',
      }),
    )
    expect(query.shootTargets(s, 'A3', 'atk.w.plain', 'std').find((t) => t.targetId === 'B3')).toMatchObject({ band: null, chance: 0 })
    // no hit roll; A2 next to the line rolls 2 for its stray shot (hit: wound 1 fails)
    const r = must(take(s, { targetId: 'B3' }, dice(2, 1)))
    expect(eventsOf(r.events, 'HitRolled')[0]).toMatchObject({ dice: [], hit: false })
    expect(eventsOf(r.events, 'StrayShot').map((e) => [e.candidateId, e.hit])).toEqual([['A2', true]])
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'A2' })
  })
})
