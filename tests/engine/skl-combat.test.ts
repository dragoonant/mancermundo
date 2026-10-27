import { describe, expect, it } from 'vitest'
import { act, step, suggest, type GameEvent, type GameState } from '@/engine'
import { checkCodeParams, hookFireCount, registeredCodeHooks, resetFireCounts } from '@/engine/code-hooks'
import { COMBAT_SKILL_HOOKS } from '@/engine/skills/combat'
import { validateAll } from '@/data/validate'
import { runSim } from '../../tools/sim-core'
import { realSetupFor, SCENARIOS } from '../../tools/sim-setup'
import { armourSave } from '@/engine/wargear'
import { pinTarget } from '@/engine/hits'
import { knockbackPush } from '@/engine/movement'
import { hitCtx } from '../fixtures/attack'
import { dice, meleeGame, optionWhere, R, TOUCH, answer } from '../fixtures/melee'
import { edit, eventsOf, must, take } from '../fixtures/helpers'
import { realBundle } from '../fixtures/real'

// SKC: close combat skills and skill actions (docs/spec/12-rules-test-checklist.md). The skill records are the real ones from
// src/data; a test hands them to a fighter of the synthetic fixture with `give` inside the game's `tweak`.

const N = 0
const S = Math.PI
const SKILL = {
  crushingBlow: 'core.s.brawn.crushing-blow',
  counterAttack: 'core.s.combat.counter-attack',
  disarm: 'core.s.combat.disarm',
  parry: 'core.s.combat.parry',
  stepAside: 'core.s.combat.step-aside',
  combatMaster: 'core.s.combat.combat-master',
  fistsOfSteel: 'gol.s.fists-of-steel',
  combatVirtuoso: 'esc.s.combat-virtuoso',
  bulgingBiceps: 'core.s.brawn.bulging-biceps',
  impetuous: 'core.s.ferocity.impetuous',
  fearsome: 'core.s.ferocity.fearsome',
  headbutt: 'core.s.brawn.headbutt',
  hurl: 'core.s.brawn.hurl',
  overseer: 'core.s.leadership.overseer',
  immovable: 'gol.s.immovable-stance',
  naaargah: 'gol.s.naaargah',
  unleash: 'gol.s.unleash-the-beast',
  somersault: 'esc.s.somersault',
  acrobatic: 'esc.s.acrobatic',
  hitAndRun: 'esc.s.hit-and-run',
  lightning: 'esc.s.lightning-reflexes',
  regroup: 'core.s.leadership.regroup',
  commanding: 'core.s.leadership.commanding-presence',
} as const

/** Hand real skill records to a fighter of a draft (inside a fixture's `tweak`). */
function give(d: GameState, fighterId: string, ...ids: string[]): void {
  const skills = realBundle().skills
  for (const id of ids) {
    if (!skills[id]) throw new Error(`no skill ${id}`)
    d.data.skills = { ...d.data.skills, [id]: skills[id]! }
    if (!d.fighters[fighterId]!.skills.includes(id)) d.fighters[fighterId]!.skills.push(id)
  }
}

const choose = (s: GameState, where: Record<string, unknown>) => optionWhere(s, where)
const hitRolls = (events: GameEvent[]) => eventsOf(events, 'FightHitRolled')
const face = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } }

describe('SKC: close combat passives', () => {
  it('SKC-001 Crushing Blow: the nominated attack, if it hits, gets +1 Strength and +1 Damage', () => {
    resetFireCounts()
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.crushingBlow), active: 'A3' })
    // hit 4, wound 3 (S4 against T3 needs 3+; S3 would need 4+), injury dice 6 and 1 for the 2 Damage: B3 is out of action
    const rng = dice(4, 3, 6, 1)
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'B3', roll: 3, need: 3, wounded: true })
    expect(eventsOf(r.events, 'DamageInflicted')[0]).toMatchObject({ targetId: 'B3', amount: 2 })
    expect(r.state.fighters.B3!.location).toBe('outOfAction')
    expect(rng.remaining).toBe(0)
    expect(hookFireCount('crushingBlow')).toBe(1)
    // the same blow without the skill: S3 against T3 needs 4+, so the 3 fails
    const plain = meleeGame({ spots: face, active: 'A3' })
    const r2 = must(answer(plain, choose(plain, { action: 'fight' }), dice(4, 3, 1)))
    expect(eventsOf(r2.events, 'WoundRolled')[0]).toMatchObject({ roll: 3, need: 4, wounded: false })
  })

  it('SKC-002 Crushing Blow is never put on a Sidearm attack: the nominated die goes to the melee weapon', () => {
    // a leader (2 attacks) with a pistol (sidearm, one die) and the unarmed rest: the unarmed die is the one that is boosted
    const s = meleeGame({
      spots: { A1: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 0.63 + R + 0.002, facing: S } },
      loadouts: { A1: { weapons: ['cc.w.stub'] } },
      tweak: (d) => give(d, 'A1', SKILL.crushingBlow),
      active: 'A1',
    })
    let r = must(step(s, choose(s, { action: 'fight' })))
    // pistol die hits (3), its Firepower dice (2: no ammo symbol), unarmed die hits (6), wounds: pistol S3 4+ roll 1 fails; unarmed boosted S4 3+ roll 3, two Injury dice (1, 1), then B3 reacts (1)
    r = must(answer(r.state, optionWhere(r.state, { weaponIds: ['cc.w.stub'] }), dice(3, 2, 6, 1, 3, 1, 1, 1)))
    const wounds = eventsOf(r.events, 'WoundRolled')
    expect(wounds[0]).toMatchObject({ roll: 1, need: 4 }) // the pistol hit is the plain one
    expect(wounds[1]).toMatchObject({ roll: 3, need: 3, wounded: true }) // the boosted unarmed hit
  })

  it('SKC-003 Counter-attack: reaction attacks gain one Attack for each attack at the fighter that failed to hit', () => {
    resetFireCounts()
    // A1 (2 attacks) fights B3; both of its dice miss, so B3 (A 1) reacts with 1 + 2 = 3 dice
    const s = meleeGame({
      spots: { A1: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 0.63 + R + 0.002, facing: S } },
      tweak: (d) => give(d, 'B3', SKILL.counterAttack),
      active: 'A1',
    })
    const rng = dice(1, 1, 1, 1, 1) // A1's two misses, then B3's three dice
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    const reaction = hitRolls(r.events).find((e) => e.targetId === 'A1')!
    expect(reaction.dice).toHaveLength(3)
    expect(rng.remaining).toBe(0)
    expect(hookFireCount('counterAttack')).toBeGreaterThan(0)
    // a fighter without the skill reacts with its one die
    const plain = meleeGame({ spots: { A1: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 0.63 + R + 0.002, facing: S } }, active: 'A1' })
    const r2 = must(answer(plain, choose(plain, { action: 'fight' }), dice(1, 1, 1)))
    expect(hitRolls(r2.events).find((e) => e.targetId === 'A1')!.dice).toHaveLength(1)
  })

  it('SKC-004 Disarm skill: a melee weapon disarms on a natural 6, a weapon that already has Disarm on 5+', () => {
    resetFireCounts()
    const base = (weapon: string) =>
      meleeGame({ spots: face, loadouts: { A3: { weapons: [weapon] } }, tweak: (d) => give(d, 'A3', SKILL.disarm), active: 'A3' })
    // a plain knife hits with a 6 (wound roll 1 fails): B3 is disarmed
    const s = base('cc.w.knife')
    let r = must(step(s, choose(s, { action: 'fight' })))
    r = must(answer(r.state, optionWhere(r.state, { weaponIds: ['cc.w.knife'] }), dice(6, 1, 1)))
    expect(r.state.fighters.B3!.conditions.disarmed).toBeDefined()
    expect(hookFireCount('combatDisarm')).toBe(1)
    // a 5 on a plain knife does not
    const s2 = base('cc.w.knife')
    let r2 = must(step(s2, choose(s2, { action: 'fight' })))
    r2 = must(answer(r2.state, optionWhere(r2.state, { weaponIds: ['cc.w.knife'] }), dice(5, 1, 1)))
    expect(r2.state.fighters.B3!.conditions.disarmed).toBeUndefined()
    // a weapon that has Disarm triggers on a 5
    const s3 = base('cc.w.disarm')
    let r3 = must(step(s3, choose(s3, { action: 'fight' })))
    r3 = must(answer(r3.state, optionWhere(r3.state, { weaponIds: ['cc.w.disarm'] }), dice(5, 1, 1)))
    expect(r3.state.fighters.B3!.conditions.disarmed).toBeDefined()
  })

  it('SKC-005 Parry skill: counts as one extra Parry weapon', () => {
    resetFireCounts()
    // B3 has no Parry weapon but the skill: it forces A3's successful hit to be re-rolled (the 1 misses)
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'B3', SKILL.parry), active: 'A3' })
    const rng = dice(5, 1, 1)
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    expect(eventsOf(r.events, 'Parried')).toEqual([expect.objectContaining({ by: 'B3', rerolled: [1] })])
    expect(eventsOf(r.events, 'WoundRolled')).toHaveLength(0)
    expect(hookFireCount('parrySkill')).toBe(1)
    // with a Parry weapon too it parries two hits
    const two = meleeGame({ spots: { A1: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 0.63 + R + 0.002, facing: S } }, loadouts: { B3: { weapons: ['cc.w.blade'] } }, tweak: (d) => give(d, 'B3', SKILL.parry), active: 'A1' })
    const r2 = must(answer(two, choose(two, { action: 'fight' }), dice(5, 5, 1, 1, 1, 1)))
    expect(eventsOf(r2.events, 'Parried')).toHaveLength(2)
  })

  it('SKC-006 Step Aside: a hit in close combat is avoided on a passed Initiative test, once per enemy per attack', () => {
    resetFireCounts()
    // A1 lands two hits on B3 (I 4+): the test passes with a 4 and the more dangerous hit is avoided; only one attempt is made
    const s = meleeGame({
      spots: { A1: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 0.63 + R + 0.002, facing: S } },
      tweak: (d) => give(d, 'B3', SKILL.stepAside),
      active: 'A1',
    })
    const rng = dice(5, 5, 4, 1, 1, 1) // two hits, the Step Aside test, the surviving hit's wound roll fails (1), B3's reaction
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    expect(eventsOf(r.events, 'InitiativeTest').filter((e) => e.fighterId === 'B3' && e.reason === 'stepAside')).toEqual([expect.objectContaining({ roll: 4, passed: true })])
    expect(eventsOf(r.events, 'WoundRolled')).toHaveLength(1)
    expect(hookFireCount('stepAside')).toBe(1)
    // a failed test leaves both hits
    const f = meleeGame({ spots: { A1: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 0.63 + R + 0.002, facing: S } }, tweak: (d) => give(d, 'B3', SKILL.stepAside), active: 'A1' })
    const r2 = must(answer(f, choose(f, { action: 'fight' }), dice(5, 5, 2, 1, 1, 1)))
    expect(eventsOf(r2.events, 'WoundRolled')).toHaveLength(2)
  })

  it('SKC-007 Combat Master: ignores interference, and always counts as giving an assist', () => {
    resetFireCounts()
    // A3 (Combat Master) is Engaged with B3 and B4; B4 is Engaged with A3 only, so a normal fighter would take -1 interference
    const spots = {
      B3: { x: 0, z: 0, facing: S },
      A3: { x: 0, z: -TOUCH, facing: N },
      B4: { x: -TOUCH, z: -TOUCH, facing: Math.PI / 2 },
    }
    const s = meleeGame({ spots, tweak: (d) => give(d, 'A3', SKILL.combatMaster), active: 'A3' })
    const r = must(answer(s, choose(s, { action: 'fight' }), dice(1, 1, 1)))
    const a3 = hitRolls(r.events)[0]!
    expect(a3.modifiers.find((m) => m.label === 'interference')).toBeUndefined()
    expect(a3.need).toBe(4)
    expect(hookFireCount('combatMaster')).toBeGreaterThan(0)
    // as the friend: A4 is Engaged with B3 and with B4 (not only the target) yet still assists A3 with the skill
    const spots2 = {
      B3: { x: 0, z: 0, facing: S },
      A3: { x: 0, z: -TOUCH, facing: N },
      A4: { x: TOUCH, z: 0, facing: Math.PI * 1.5 },
      B4: { x: TOUCH, z: TOUCH, facing: S },
    }
    const t = meleeGame({ spots: spots2, tweak: (d) => give(d, 'A4', SKILL.combatMaster), active: 'A3' })
    const r2 = must(answer(t, choose(t, { action: 'fight' }), dice(1, 1, 1)))
    expect(hitRolls(r2.events)[0]!.modifiers).toEqual(expect.arrayContaining([{ label: 'assist', value: 1 }]))
  })

  it('SKC-008 Fists of Steel: unarmed attacks get +2 Strength and Damage 2', () => {
    resetFireCounts()
    // A3 S3 +2 = 5 against T3 wounds on 3+ (S4+ would also); Damage 2 on a 1-wound fighter: two Injury dice
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.fistsOfSteel), active: 'A3' })
    const rng = dice(4, 3, 6, 1)
    const r = must(answer(s, choose(s, { action: 'fight' }), rng))
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ need: 3 })
    expect(eventsOf(r.events, 'DamageInflicted')[0]).toMatchObject({ amount: 2 })
    expect(hookFireCount('fistsOfSteel')).toBe(1)
  })

  it('SKC-009 Combat Virtuoso: a listed blade gains Versatile with a reach equal to the fighter\'s Strength', () => {
    resetFireCounts()
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 3, facing: S } },
      loadouts: { A3: { weapons: ['core.w.knife'] } },
      tweak: (d) => {
        d.data.weapons = { ...d.data.weapons, ...realBundle().weapons }
        give(d, 'A3', SKILL.combatVirtuoso)
      },
      active: 'A3',
    })
    // B3 is 3" from A3 (base edge gap 3 - 2R): Strength 3 is a reach of 3", so A3 can Fight it from there
    const opts = s.pending!.options!.filter((o) => (o.action.payload as { action: string }).action === 'fight')
    expect(opts.map((o) => (o.action.payload as { weaponId?: string }).weaponId)).toEqual(['core.w.knife'])
    expect(hookFireCount('combatVirtuoso')).toBeGreaterThan(0)
  })

  it('SKC-010 Bulging Biceps: an Unwieldy close combat weapon can be used with a second weapon', () => {
    resetFireCounts()
    const loadouts = { A3: { weapons: ['cc.w.maul', 'cc.w.knife'] } }
    const plain = meleeGame({ spots: face, loadouts, active: 'A3' })
    let r = must(step(plain, choose(plain, { action: 'fight' })))
    // without the skill the maul stands alone: no pair is offered
    expect(r.pending!.options!.map((o) => o.id).some((id) => id.includes('cc.w.maul+cc.w.knife') || id.includes('cc.w.knife+cc.w.maul'))).toBe(false)
    const s = meleeGame({ spots: face, loadouts, tweak: (d) => give(d, 'A3', SKILL.bulgingBiceps), active: 'A3' })
    r = must(step(s, choose(s, { action: 'fight' })))
    expect(r.pending!.options!.map((o) => o.id).some((id) => id.includes('cc.w.maul') && id.includes('cc.w.knife') && id.includes('+'))).toBe(true)
    expect(hookFireCount('bulgingBiceps')).toBe(1)
  })

  it('SKC-011 Impetuous: consolidates up to 4" instead of 2"', () => {
    resetFireCounts()
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.impetuous), active: 'A3' })
    const r = must(answer(s, choose(s, { action: 'fight' }), dice(6, 6, 3)))
    expect(r.pending!.options!.find((o) => o.id === 'consolidate')!.data).toMatchObject({ maxInches: 4 })
    const con = must(step(r.state, optionWhere(r.state, { choice: 'consolidate' })))
    expect(con.pending!.constraints).toMatchObject({ kind: 'consolidate', maxInches: 4 })
    expect(hookFireCount('impetuous')).toBe(1)
    const moved = must(step(con.state, { type: 'move.path', seat: 'A', decisionId: con.pending!.id, payload: { waypoints: [{ x: 3.5, z: -10 }] } }))
    expect(eventsOf(moved.events, 'Consolidated')).toHaveLength(1)
  })

  it('SKC-012 Fearsome: a charger must pass a Willpower test or its action ends', () => {
    resetFireCounts()
    const spots = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: S } }
    const s = meleeGame({ spots, tweak: (d) => give(d, 'B3', SKILL.fearsome), active: 'A3' })
    // Wil 7: a 2D6 total of 4 (2 + 2) fails; the charge is over, both actions spent, nobody moved
    const failed = must(step(s, choose(s, { action: 'charge', targetId: 'B3' }), dice(2, 2)))
    expect(eventsOf(failed.events, 'SkillTest')[0]).toMatchObject({ fighterId: 'A3', test: 'Wil', passed: false })
    expect(failed.state.fighters.A3!.pos.z).toBe(-10)
    expect(failed.state.action.activation).toBeNull()
    expect(hookFireCount('fearsome')).toBe(1)
    // a 9 passes and the charge carries on (D3 roll, then the free Fight)
    const s2 = meleeGame({ spots, tweak: (d) => give(d, 'B3', SKILL.fearsome), active: 'A3' })
    const passed = must(answer(s2, choose(s2, { action: 'charge', targetId: 'B3' }), dice(4, 5, 1, 1, 1, 1)))
    expect(eventsOf(passed.events, 'SkillTest')[0]).toMatchObject({ passed: true })
    expect(passed.state.fighters.A3!.pos.z).toBeGreaterThan(-10)
  })
})


const ids = (s: GameState) => (s.pending?.options ?? []).map((o) => o.id)
const performed = (s: GameState) => s.action.activation?.performed.map((p) => `${p.action}:${p.type}`) ?? []
const move = (s: GameState, x: number, z: number, rng?: ReturnType<typeof dice>) => step(s, act.path(s.pending!, [{ x, z }]), rng)

describe('SKC: skill actions', () => {
  it('SKC-013 Headbutt: a free action; 2D6 with a die at least the target\'s Toughness hits at Strength +2, Damage 2; otherwise the Headbutter is hit', () => {
    resetFireCounts()
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.headbutt), active: 'A3' })
    expect(ids(s)).toContain('headbutt:B3')
    expect(s.pending!.options!.find((o) => o.id === 'headbutt:B3')!.data).toMatchObject({ need: 3 })
    // dice 4 and 1 (4 >= T3): S5 against T3 wounds on 3+ (roll 3), Damage 2 on a 1-wound fighter: two Injury dice (6 and 1)
    const r = must(step(s, choose(s, { action: 'headbutt', targetId: 'B3' }), dice(4, 1, 3, 6, 1)))
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'B3', need: 3, wounded: true })
    expect(eventsOf(r.events, 'DamageInflicted')[0]).toMatchObject({ targetId: 'B3', amount: 2 })
    expect(r.state.fighters.B3!.location).toBe('outOfAction')
    // a free action: both actions are still left, the menu is back
    expect(r.pending!.kind).toBe('action.choose')
    expect(r.state.action.activation!.actionsLeft).toBe(2)
    expect(performed(r.state)).toEqual(['headbutt:free'])
    expect(hookFireCount('headbutt')).toBe(1)
    // it cannot be repeated in one activation
    const again = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.headbutt), active: 'A3' })
    const first = must(step(again, choose(again, { action: 'headbutt', targetId: 'B3' }), dice(4, 1, 1)))
    expect(ids(first.state).some((id) => id.startsWith('headbutt'))).toBe(false)
    // both dice below Toughness: the Headbutter takes a Strength 3 hit (wound roll 4 against T3), Damage 1: its one wound goes, Injury die 1
    const fumble = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.headbutt), active: 'A3' })
    const f = must(step(fumble, choose(fumble, { action: 'headbutt', targetId: 'B3' }), dice(2, 1, 4, 1)))
    expect(eventsOf(f.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'A3', need: 4, wounded: true })
    expect(f.state.fighters.A3!.fleshWounds).toBe(1)
    expect(f.state.fighters.B3!.fleshWounds).toBe(0)
    // illegal input is a rejection, never a throw: a fighter without the skill, and a target that is not in base contact
    const without = meleeGame({ spots: face, active: 'A3' })
    expect(step(without, act.choose(without.pending!, 'headbutt', { targetId: 'B3' })).rejection?.code).toBe('E_NOT_AN_OPTION')
    const far = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -7, facing: S } }, tweak: (d) => give(d, 'A3', SKILL.headbutt), active: 'A3' })
    expect(ids(far).some((id) => id.startsWith('headbutt'))).toBe(false)
    expect(step(far, act.choose(far.pending!, 'headbutt', { targetId: 'B3' })).rejection).toBeDefined()
  })

  it('SKC-014 Hurl: a Basic action on an Engaged enemy; on a failed Initiative test it is hurled D3" in a chosen direction, then hit at Strength 3 and Pinned', () => {
    resetFireCounts()
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.hurl), active: 'A3' })
    expect(s.pending!.options!.find((o) => o.id === 'hurl:B3')!.data).toMatchObject({ need: 4 })
    // Initiative test 1 fails, D3 roll 3 = 2"; the Hurler picks a direction (away along +z, option dir:0)
    const asked = must(step(s, choose(s, { action: 'hurl', targetId: 'B3' }), dice(1, 3)))
    expect(asked.pending!.kind).toBe('skill.choice')
    expect(asked.pending!.context).toMatchObject({ skill: 'hurlDirection', targetId: 'B3', distance: 2 })
    const dir0 = asked.pending!.options!.find((o) => o.id === 'dir:0')!
    expect(dir0.data).toMatchObject({ moved: 2, contacts: [] })
    const z0 = s.fighters.B3!.pos.z
    const r = must(step(asked.state, dir0.action, dice(1)))
    const b3 = r.state.fighters.B3!
    expect(b3.pos.z).toBeCloseTo(z0 + 2, 2)
    expect(b3.posture).toBe('pinned')
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'B3', need: 4, wounded: false }) // Strength 3
    expect(eventsOf(r.events, 'FighterMoved').find((e) => e.fighterId === 'B3')!.kind).toBe('hurled')
    expect(r.pending!.kind).toBe('action.choose')
    expect(performed(r.state)).toEqual(['hurl:basic'])
    expect(r.state.action.activation!.actionsLeft).toBe(1)
    expect(hookFireCount('hurl')).toBeGreaterThan(0)
    // a passed Initiative test leaves the target where it is
    const keep = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.hurl), active: 'A3' })
    const k = must(step(keep, choose(keep, { action: 'hurl', targetId: 'B3' }), dice(5)))
    expect(k.state.fighters.B3!.posture).toBe('standing')
    expect(k.pending!.kind).toBe('action.choose')
    expect(performed(k.state)).toEqual(['hurl:basic'])
  })

  it('SKC-015 Hurl: the hurled fighter stops against another fighter; both are hit and Pinned', () => {
    const spots = { ...face, B4: { x: 0, z: -10 + TOUCH + 1.5, facing: S } }
    const s = meleeGame({ spots, tweak: (d) => give(d, 'A3', SKILL.hurl), active: 'A3' })
    const asked = must(step(s, choose(s, { action: 'hurl', targetId: 'B3' }), dice(1, 6)))
    const dir0 = asked.pending!.options!.find((o) => o.id === 'dir:0')!
    expect((dir0.data as { contacts: string[] }).contacts).toEqual(['B4'])
    expect((dir0.data as { moved: number }).moved).toBeLessThan(3)
    const r = must(step(asked.state, dir0.action, dice(1, 1)))
    expect(r.state.fighters.B4!.posture).toBe('pinned')
    expect(eventsOf(r.events, 'WoundRolled').map((e) => e.targetId).sort()).toEqual(['B3', 'B4'])
  })

  it('SKC-030 Hurl: the hurled fighter passes over Prone fighters without hitting them and stops short of ending on one', () => {
    const z0 = -10 + TOUCH
    // B4 lies Pinned 1.5" along the throw: the 3" hurl passes over it, and only B3 is hit
    const over = meleeGame({ spots: { ...face, B4: { x: 0, z: z0 + 1.5, facing: S } }, tweak: (d) => { give(d, 'A3', SKILL.hurl); d.fighters.B4!.posture = 'pinned' }, active: 'A3' })
    const asked = must(step(over, choose(over, { action: 'hurl', targetId: 'B3' }), dice(1, 6)))
    const dir0 = asked.pending!.options!.find((o) => o.id === 'dir:0')!
    expect(dir0.data).toMatchObject({ moved: 3, contacts: [], stoppedShort: false })
    const r = must(step(asked.state, dir0.action, dice(1)))
    expect(r.state.fighters.B3!.pos.z).toBeCloseTo(z0 + 3, 2)
    expect(eventsOf(r.events, 'WoundRolled').map((e) => e.targetId)).toEqual(['B3'])
    // B4 lies exactly where the hurl would end: B3 stops at the last clear spot before it, and B4 is not hit
    const onto = meleeGame({ spots: { ...face, B4: { x: 0, z: z0 + 3, facing: S } }, tweak: (d) => { give(d, 'A3', SKILL.hurl); d.fighters.B4!.posture = 'seriouslyInjured' }, active: 'A3' })
    const a2 = must(step(onto, choose(onto, { action: 'hurl', targetId: 'B3' }), dice(1, 6)))
    const d0 = a2.pending!.options!.find((o) => o.id === 'dir:0')!
    expect(d0.data).toMatchObject({ contacts: [] })
    expect((d0.data as { moved: number }).moved).toBeLessThan(3 - 2 * R + 0.06)
    const r2 = must(step(a2.state, d0.action, dice(1)))
    expect(eventsOf(r2.events, 'WoundRolled').map((e) => e.targetId)).toEqual(['B3'])
    expect(r2.state.fighters.B4!.posture).toBe('seriouslyInjured')
  })

  it('SKC-016 Hurl can replace the free Fight after a charge', () => {
    const spots = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: S } }
    const s = meleeGame({ spots, tweak: (d) => give(d, 'A3', SKILL.hurl), active: 'A3' })
    const charged = must(step(s, choose(s, { action: 'charge', targetId: 'B3' }), dice(4)))
    expect(charged.pending!.kind).toBe('skill.choice')
    expect(charged.pending!.context).toMatchObject({ skill: 'hurlFight' })
    expect(charged.pending!.options!.map((o) => o.id)).toEqual(['fight', 'hurl:B3'])
    // hurl: Initiative test passes (5): nothing moves, no Fight and no reaction attacks follow, the charge is paid
    const r = must(step(charged.state, optionWhere(charged.state, { option: 'hurl:B3' }), dice(5)))
    expect(eventsOf(r.events, 'FightStarted')).toHaveLength(0)
    expect(eventsOf(r.events, 'ReactionStarted')).toHaveLength(0)
    expect(eventsOf(r.events, 'ActionResolved').map((e) => e.action)).toEqual(['charge'])
    expect(r.pending!.kind).toBe('action.activate') // the charge took both actions: the other gang is up
    // choosing the Fight carries on as before
    const f = must(step(charged.state, optionWhere(charged.state, { option: 'fight' }), dice(1, 1, 1)))
    expect(eventsOf(f.events, 'FightStarted')).toHaveLength(1)
  })

  it('SKC-017 Overseer: a Double action; on a passed Leadership test a friend within 6" activates at once for two actions, even if not Ready, and its Ready status is unchanged', () => {
    resetFireCounts()
    const spots = { A1: { x: 0, z: -10, facing: N }, A3: { x: 3, z: -10, facing: N }, A4: { x: -10, z: 10, facing: N }, B3: { x: 0, z: 10, facing: S } }
    const s = meleeGame({
      spots,
      tweak: (d) => {
        give(d, 'A1', SKILL.overseer)
        d.fighters.A3!.ready = false
        d.fighters.A3!.activatedThisRound = true
      },
      active: 'A1',
    })
    // only A3 is within 6"; the Leader's Leadership is 5+ and a 2D6 total of 6 passes
    expect(ids(s).filter((id) => id.startsWith('overseer'))).toEqual(['overseer:A3'])
    expect(s.pending!.options!.find((o) => o.id === 'overseer:A3')!.data).toMatchObject({ need: 5 })
    const r = must(step(s, choose(s, { action: 'overseer', targetId: 'A3' }), dice(3, 3)))
    expect(eventsOf(r.events, 'SkillTest')[0]).toMatchObject({ fighterId: 'A1', test: 'Ld', passed: true })
    expect(eventsOf(r.events, 'ActivationEnded').map((e) => e.fighterId)).toEqual(['A1'])
    expect(r.pending!.kind).toBe('action.choose')
    expect(r.state.action.activation).toMatchObject({ fighterId: 'A3', actionsLeft: 2, orderedBy: 'A1' })
    expect(eventsOf(r.events, 'FighterActivated')[0]).toMatchObject({ fighterId: 'A3', orderedBy: 'A1' })
    // the ordered fighter acts, ends: the Ready flags are as before, and the other gang is up
    const end = must(step(r.state, act.endActivation(r.state.pending!)))
    expect(end.state.fighters.A3!.ready).toBe(false)
    expect(end.state.fighters.A1!.ready).toBe(false)
    expect(end.pending!.kind).toBe('action.activate')
    expect(end.pending!.seat).toBe('B')
    expect(hookFireCount('overseer')).toBe(1)
    // a failed test spends the actions and nobody is ordered
    const fail = meleeGame({ spots, tweak: (d) => give(d, 'A1', SKILL.overseer), active: 'A1' })
    const f = must(step(fail, choose(fail, { action: 'overseer', targetId: 'A3' }), dice(1, 2)))
    expect(f.state.action.activation).toBeNull()
    expect(f.pending!.seat).toBe('B')
    // a Ready fighter that is ordered stays Ready and can still activate normally
    const ready = meleeGame({ spots, tweak: (d) => give(d, 'A1', SKILL.overseer), active: 'A1' })
    const o = must(step(ready, choose(ready, { action: 'overseer', targetId: 'A3' }), dice(3, 3)))
    const done = must(step(o.state, act.endActivation(o.state.pending!)))
    expect(done.state.fighters.A3!.ready).toBe(true)
    // a friend in an Immovable Stance cannot be ordered (the stance names Overseer among the skills that cannot move it)
    const stance = meleeGame({
      spots,
      tweak: (d) => {
        give(d, 'A1', SKILL.overseer)
        d.effects.push({ id: 'eX', source: 'immovableStance', seat: 'A', kind: 'immovableStance', fighterId: 'A3', expires: 'startOfActivation:A3' })
      },
      active: 'A1',
    })
    expect(ids(stance).filter((id) => id.startsWith('overseer'))).toEqual([])
  })

  it('SKC-018 Immovable Stance: a Double action; until its next activation +2 to saves (best 2+), cannot be Pinned, cannot be shifted', () => {
    resetFireCounts()
    const s = meleeGame({ spots: face, loadouts: { A3: { wargear: ['atk.g.carapace'] } }, tweak: (d) => give(d, 'A3', SKILL.immovable), active: 'A3' })
    expect(ids(s)).toContain('immovableStance')
    const r = must(step(s, choose(s, { action: 'immovableStance' })))
    expect(r.state.effects.filter((e) => e.kind === 'immovableStance')).toHaveLength(1)
    expect(r.state.action.activation).toBeNull() // both actions spent
    const a3 = r.state.fighters.A3!
    // a 4+ carapace save becomes 2+, and a great armour 2+ stays 2+ (the best a save can be)
    expect(armourSave(r.state, a3, { ap: 0 }).need).toBe(2)
    expect(armourSave(r.state, a3, { ap: -1 }).need).toBe(3)
    const great = edit(r.state, (d) => {
      d.fighters.A3!.wargear = ['atk.g.great']
    })
    expect(armourSave(great, great.fighters.A3!, { ap: 0 }).need).toBe(2)
    // no Pinning, no shifting
    const { ctx } = hitCtx(r.state, [])
    expect(pinTarget(ctx, ctx.state.fighters.A3!, 'B3')).toBe(false)
    const pushed = knockbackPush(ctx, ctx.state.fighters.A3!, { x: 0, z: -9 }, 1)
    expect(pushed.moved).toBe(0)
    expect(ctx.state.fighters.A3!.pos.z).toBe(-10)
    expect(hookFireCount('immovableStance')).toBeGreaterThan(2)
    // it lasts until the fighter's next activation starts
    expect(r.state.effects.some((e) => e.kind === 'immovableStance' && e.expires === 'startOfActivation:A3')).toBe(true)
  })

  it('SKC-019 Naaargah!: after two actions a Toughness test wins a third; the fighter ends the activation Pinned either way', () => {
    resetFireCounts()
    const spots = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: 10, facing: S } }
    const reach = () => {
      const s = meleeGame({ spots, tweak: (d) => give(d, 'A3', SKILL.naaargah), active: 'A3' })
      let r = must(step(s, choose(s, { action: 'move' })))
      r = must(move(r.state, 0, -9))
      r = must(step(r.state, choose(r.state, { action: 'move' })))
      r = must(move(r.state, 0, -8))
      expect(r.pending!.kind).toBe('skill.choice')
      expect(r.pending!.context).toMatchObject({ skill: 'naaargah' })
      expect(r.pending!.options!.find((o) => o.id === 'attempt')!.data).toMatchObject({ need: 3 })
      return r
    }
    // Toughness 3: a 2 passes (at most T), so the menu comes back with one action left
    const a = reach()
    const won = must(step(a.state, optionWhere(a.state, { option: 'attempt' }), dice(2)))
    expect(won.pending!.kind).toBe('action.choose')
    expect(won.state.action.activation).toMatchObject({ actionsLeft: 1 })
    expect(hookFireCount('naaargah')).toBe(1)
    let r = must(step(won.state, choose(won.state, { action: 'move' })))
    r = must(move(r.state, 0, -7))
    expect(r.state.fighters.A3!.posture).toBe('pinned')
    expect(r.pending!.seat).toBe('B')
    // a 5 fails: no third action, still Pinned
    const b = reach()
    const lost = must(step(b.state, optionWhere(b.state, { option: 'attempt' }), dice(5)))
    expect(lost.state.action.activation).toBeNull()
    expect(lost.state.fighters.A3!.posture).toBe('pinned')
    // declining leaves it standing
    const c = reach()
    const d = must(step(c.state, optionWhere(c.state, { option: 'decline' })))
    expect(d.state.fighters.A3!.posture).toBe('standing')
  })

  it('SKC-020 Unleash the Beast: a Simple action while Engaged; every fighter in base contact passes a Strength test or is pushed D3" away', () => {
    resetFireCounts()
    const spots = { A3: { x: 0, z: 0, facing: N }, B3: { x: 0, z: TOUCH, facing: S }, A4: { x: TOUCH, z: 0, facing: Math.PI * 1.5 } }
    const s = meleeGame({ spots, tweak: (d) => give(d, 'A3', SKILL.unleash), active: 'A3' })
    expect(ids(s)).toContain('unleashTheBeast')
    // A4 (friend) passes its Strength 3 test with a 2, B3 fails with a 5 and is pushed D3 = 2" (roll 3) straight away
    const r = must(step(s, choose(s, { action: 'unleashTheBeast' }), dice(2, 5, 3)))
    const tests = eventsOf(r.events, 'SkillTest')
    expect(tests.map((t) => `${t.fighterId}:${t.passed}`)).toEqual(['A4:true', 'B3:false'])
    expect(r.state.fighters.B3!.pos.z).toBeCloseTo(TOUCH + 2, 1)
    expect(r.state.fighters.A4!.pos.x).toBeCloseTo(TOUCH, 3)
    expect(r.state.fighters.A3!.engagedWith).toEqual([])
    expect(performed(r.state)).toEqual(['unleashTheBeast:simple'])
    expect(r.state.action.activation!.actionsLeft).toBe(1)
    expect(hookFireCount('unleashTheBeast')).toBe(1)
    // not offered when not Engaged
    const alone = meleeGame({ spots: { A3: { x: 0, z: 0, facing: N }, B3: { x: 0, z: 10, facing: S } }, tweak: (d) => give(d, 'A3', SKILL.unleash), active: 'A3' })
    expect(ids(alone)).not.toContain('unleashTheBeast')
  })

  it('SKC-021 Somersault: a Basic action; the fighter is placed within 6" in sight and more than 1" from every enemy, even out of combat, without reaction attacks', () => {
    resetFireCounts()
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', SKILL.somersault), active: 'A3' })
    const asked = must(step(s, choose(s, { action: 'somersault' })))
    expect(asked.pending!.kind).toBe('move.path')
    expect(asked.pending!.constraints).toMatchObject({ kind: 'somersault', maxInches: 6 })
    // the engine's own suggestion is a legal spot
    const suggested = suggest(asked.state)!
    expect(suggested.type).toBe('move.path')
    expect(step(asked.state, suggested).rejection).toBeUndefined()
    // too far, and too close to B3
    expect(step(asked.state, act.path(asked.pending!, [{ x: 0, z: -17 }])).rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(step(asked.state, act.path(asked.pending!, [{ x: 0, z: -8 }])).rejection?.code).toBe('E_ONE_INCH')
    // five inches away: placed, no dice, no reaction
    const r = must(step(asked.state, act.path(asked.pending!, [{ x: 0, z: -15 }])))
    expect(r.state.fighters.A3!.pos).toMatchObject({ x: 0, z: -15 })
    expect(r.state.fighters.A3!.engagedWith).toEqual([])
    expect(r.events.some((e) => e.type === 'DiceRolled')).toBe(false)
    expect(eventsOf(r.events, 'FighterMoved')[0]!.kind).toBe('somersault')
    expect(performed(r.state)).toEqual(['somersault:basic'])
    expect(r.state.action.activation!.actionsLeft).toBe(1)
    expect(hookFireCount('somersault')).toBeGreaterThan(0)
    // passing cancels the action before anything is spent
    const cancelled = must(step(asked.state, act.pass(asked.pending!)))
    expect(cancelled.state.action.activation!.actionsLeft).toBe(2)
    expect(cancelled.pending!.kind).toBe('action.choose')
  })

  it('SKC-022 Acrobatic: a Move can pass over enemy fighters and obstacles at no cost; the 1" rule applies where it ends', () => {
    resetFireCounts()
    const spots = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -7.5, facing: S } }
    const plain = meleeGame({ spots, active: 'A3' })
    const m = must(step(plain, choose(plain, { action: 'move' })))
    expect(step(m.state, act.path(m.state.pending!, [{ x: 0, z: -5 }])).rejection?.code).toBe('E_NO_PATH')
    const s = meleeGame({ spots, tweak: (d) => give(d, 'A3', SKILL.acrobatic), active: 'A3' })
    const mv = must(step(s, choose(s, { action: 'move' })))
    const r = must(step(mv.state, act.path(mv.state.pending!, [{ x: 0, z: -5 }])))
    expect(r.state.fighters.A3!.pos.z).toBe(-5)
    expect(hookFireCount('acrobatic')).toBe(1)
    // ending within 1" of the enemy is still refused
    expect(step(mv.state, act.path(mv.state.pending!, [{ x: 0, z: -6 }])).rejection?.code).toBe('E_ONE_INCH')
  })
})

describe('SKC: skills inside the close-combat sequence and at activation boundaries', () => {
  const charging = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: S } }
  const reactionsAt = (events: GameEvent[], id: string) => hitRolls(events).filter((e) => e.targetId === id)

  it('SKC-023 Hit and Run: after a charge\'s Fight, ahead of the reaction attacks, a free Retreat; the opponent gets one set of reaction attacks only', () => {
    resetFireCounts()
    // charge (D3 roll 4 = 2"), two misses, then the offer
    const s = meleeGame({ spots: charging, tweak: (d) => give(d, 'A3', SKILL.hitAndRun), active: 'A3' })
    const offered = must(answer(s, choose(s, { action: 'charge', targetId: 'B3' }), dice(4, 1, 1)))
    expect(offered.pending!.kind).toBe('skill.choice')
    expect(offered.pending!.context).toMatchObject({ skill: 'hitAndRun', fighterId: 'A3' })
    expect(offered.pending!.options!.map((o) => o.id)).toEqual(['use', 'decline'])
    // use: A3 passes its Initiative test (5), B3 fails its own (1: no reaction), the Retreat D6 is 3, the engine's route is taken
    const retreat = must(step(offered.state, optionWhere(offered.state, { option: 'use' }), dice(5, 1, 3)))
    expect(retreat.pending!.kind).toBe('move.path')
    expect(retreat.pending!.constraints).toMatchObject({ kind: 'retreat' })
    const gone = must(step(retreat.state, suggest(retreat.state)!))
    expect(reactionsAt(gone.events, 'A3')).toHaveLength(0)
    expect(gone.state.fighters.A3!.engagedWith).toEqual([])
    expect(gone.state.fighters.A3!.pos.z).toBeLessThan(-6 - 0.9)
    expect(hookFireCount('hitAndRun')).toBe(1)
    // declined: B3 reacts as usual
    const d = must(step(offered.state, optionWhere(offered.state, { option: 'decline' }), dice(1)))
    expect(reactionsAt(d.events, 'A3')).toHaveLength(1)
    // a failed Retreat (Initiative 2) with an enemy that passes its test (5): its one reaction attack is made once, not twice
    const f = must(step(offered.state, optionWhere(offered.state, { option: 'use' }), dice(2, 5, 1)))
    expect(reactionsAt(f.events, 'A3')).toHaveLength(1)
    expect(f.state.fighters.A3!.engagedWith).toEqual(['B3'])
  })

  it('SKC-024 Lightning Reflexes: once each round an Engaged fighter about to be attacked in a Fight may make a free Retreat first', () => {
    resetFireCounts()
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'B3', SKILL.lightning), active: 'A3' })
    const offered = must(step(s, choose(s, { action: 'fight' })))
    expect(offered.pending!.kind).toBe('skill.choice')
    expect(offered.pending!.seat).toBe('B')
    expect(offered.pending!.context).toMatchObject({ skill: 'lightningReflexes', fighterId: 'B3', attackerId: 'A3' })
    expect(offered.pending!.options!.map((o) => o.id)).toEqual(['use', 'decline'])
    // B3 passes its Initiative test (5), A3's reaction test fails (1), the Retreat D6 is 3
    const retreat = must(step(offered.state, optionWhere(offered.state, { option: 'use' }), dice(5, 1, 3)))
    expect(retreat.pending!.kind).toBe('move.path')
    expect(retreat.pending!.seat).toBe('B')
    const done = must(step(retreat.state, suggest(retreat.state)!))
    expect(done.state.fighters.B3!.engagedWith).toEqual([])
    expect(hitRolls(done.events)).toHaveLength(0) // A3 has nobody left to hit; its Fight is spent
    expect(done.state.action.activation!.actionsLeft).toBe(1)
    expect(done.state.effects.some((e) => e.kind === 'lightningReflexesUsed' && e.fighterId === 'B3')).toBe(true)
    expect(hookFireCount('lightningReflexes')).toBe(1)
    // declined: the Fight goes ahead and the offer is not made again for the same attack
    const declined = must(step(offered.state, optionWhere(offered.state, { option: 'decline' }), dice(1, 1)))
    expect(hitRolls(declined.events).length).toBeGreaterThan(0)
  })

  it('SKC-025 Regroup: a fighter still Active when its activation ends may pass a Leadership test to rally every Broken friend within 6"', () => {
    resetFireCounts()
    const spots = { A3: { x: 0, z: -10, facing: N }, A4: { x: 3, z: -10, facing: N }, A5: { x: 8, z: -10, facing: N }, B3: { x: 0, z: 10, facing: S } }
    const make = () =>
      meleeGame({
        spots,
        tweak: (d) => {
          give(d, 'A3', SKILL.regroup)
          d.fighters.A4!.conditions.broken = { since: 1 }
          d.fighters.A5!.conditions.broken = { since: 1 }
        },
        active: 'A3',
      })
    const s = make()
    const r = must(step(s, act.endActivation(s.pending!), dice(4, 3))) // Ld 7+: a total of 7 passes
    expect(eventsOf(r.events, 'SkillTest')[0]).toMatchObject({ fighterId: 'A3', test: 'Ld', passed: true })
    expect(r.state.fighters.A4!.conditions.broken).toBeUndefined()
    expect(r.state.fighters.A5!.conditions.broken).toBeDefined() // 8" away
    expect(hookFireCount('regroup')).toBe(1)
    // a failed test leaves them Broken
    const t = make()
    const f = must(step(t, act.endActivation(t.pending!), dice(1, 2)))
    expect(f.state.fighters.A4!.conditions.broken).toBeDefined()
    // an Engaged fighter is not Active: no test
    const e = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S }, A4: { x: 3, z: -10, facing: N } }, tweak: (d) => { give(d, 'A3', SKILL.regroup); d.fighters.A4!.conditions.broken = { since: 1 } }, active: 'A3' })
    const n = must(step(e, act.endActivation(e.pending!)))
    expect(eventsOf(n.events, 'SkillTest')).toHaveLength(0)
    // Broken is a condition, not a status: a Broken fighter that is still Active when its activation ends tests and rallies the others
    const b = edit(make(), (d) => {
      d.fighters.A3!.conditions.broken = { since: 1 }
    })
    const br = must(step(b, act.endActivation(b.pending!), dice(4, 3)))
    expect(eventsOf(br.events, 'SkillTest')[0]).toMatchObject({ fighterId: 'A3', test: 'Ld', passed: true })
    expect(br.state.fighters.A4!.conditions.broken).toBeUndefined()
  })

  it('SKC-026 Commanding Presence: Group Activation +1', () => {
    resetFireCounts()
    const spots = { A1: { x: 0, z: -10, facing: N }, A2: { x: 2, z: -10, facing: N }, A3: { x: 3, z: -10, facing: N }, A4: { x: 4, z: -10, facing: N }, A5: { x: 5, z: -10, facing: N }, B3: { x: 0, z: 10, facing: S } }
    const plain = meleeGame({ spots })
    expect(take(plain, { fighterId: 'A1' }).pending!.context).toMatchObject({ max: 2 })
    const s = meleeGame({ spots, tweak: (d) => give(d, 'A1', SKILL.commanding) })
    const g = must(take(s, { fighterId: 'A1' }))
    expect(g.pending!.kind).toBe('action.group')
    expect(g.pending!.context).toMatchObject({ max: 3, left: 3 })
    expect(hookFireCount('commandingPresence')).toBe(1)
  })
})

describe('SKC: registration', () => {
  const NAMES = [
    'crushingBlow', 'counterAttack', 'combatDisarm', 'parrySkill', 'stepAside', 'combatMaster', 'fistsOfSteel', 'combatVirtuoso', 'bulgingBiceps', 'impetuous', 'fearsome',
    'headbutt', 'hurl', 'overseer', 'immovableStance', 'naaargah', 'unleashTheBeast', 'somersault', 'acrobatic', 'hitAndRun', 'lightningReflexes', 'regroup', 'commandingPresence',
  ]

  it('SKC-027 every one of the 23 code hooks is registered with a params validator that accepts the data\'s params and refuses a non-number', () => {
    expect([...COMBAT_SKILL_HOOKS].sort()).toEqual([...NAMES].sort())
    const data = Object.values(realBundle().skills)
    for (const name of NAMES) {
      expect(registeredCodeHooks()).toContain(name)
      const rec = data.find((s) => JSON.stringify(s.effect ?? '').includes(`"code":"${name}"`))
      expect(rec, name).toBeDefined()
      const params = (rec!.effect as { code: { params?: Record<string, unknown> } }).code.params
      expect(checkCodeParams(name, params), name).toBeNull()
      const first = Object.entries(params ?? {}).find(([, v]) => typeof v === 'number')
      if (first) expect(checkCodeParams(name, { ...params, [first[0]]: 'x' })).toMatch(/must be a number/)
    }
  })

  it('SKC-028 the data validates with every code hook of these skills registered', () => {
    const res = validateAll({ registeredCodes: new Set(registeredCodeHooks()), sourcesDir: false })
    expect(res.errors.filter((e) => NAMES.some((n) => e.includes(n)))).toEqual([])
  })
})

describe('SKC: random games with the skills in play', () => {
  it('SKC-029 random-bot games in which every fighter carries every close combat skill keep every invariant and use the skill actions', { timeout: 240_000 }, () => {
    resetFireCounts()
    const bundle = realBundle()
    const all = Object.values(bundle.skills)
      .filter((s) => COMBAT_SKILL_HOOKS.some((n) => JSON.stringify(s.effect ?? '').includes(`"code":"${n}"`)))
      .map((s) => s.id)
    expect(all).toHaveLength(23)
    const base = realSetupFor(bundle, SCENARIOS, undefined)
    const setupFor = (g: number) => {
      const setup = base(g)
      for (const seat of ['A', 'B'] as const) for (const f of setup.gangs[seat].roster) f.skills = [...new Set([...f.skills, ...all])]
      return setup
    }
    const report = runSim({ games: 8, seed: 'skc', bundle, setupFor })
    expect(report.failing.map((f) => `${f.seed}: ${f.violations.map((v) => v.message).join('; ')}`)).toEqual([])
    expect(report.rejections).toBe(0)
    expect(report.completed).toBe(report.games)
    // the actions the bot picks at random were exercised
    const fired = COMBAT_SKILL_HOOKS.filter((n) => hookFireCount(n) > 0)
    for (const n of ['somersault', 'overseer', 'immovableStance', 'naaargah', 'acrobatic', 'combatVirtuoso', 'commandingPresence', 'counterAttack', 'stepAside']) expect(fired, n).toContain(n)
  })
})
