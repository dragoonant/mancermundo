import { beforeEach, describe, expect, it } from 'vitest'
import { act, query, step, type GameState } from '@/engine'
import { checkCodeParams, hookFireCount, registeredCodeHooks, resetFireCounts } from '@/engine/code-hooks'
import { fleshWound, resolveBlastMarker, resolveHit, rollInjuries, type HitInput } from '@/engine/hits'
import { moveAllowance } from '@/engine/movement'
import { takeNerveTest } from '@/engine/morale'
import { stat } from '@/engine/query'
import { createCtx } from '@/engine/registry'
import { cloneState } from '@/engine/state'
import { PASSIVE_CODE_HOOKS } from '@/engine/skills/passive'
import { codeUseOf } from '@/engine/skills/util'
import { hitCtx, shootingGame } from '../fixtures/attack'
import { activate, edit, eventsOf, must, moveTo, place, playOut, startGame, take } from '../fixtures/helpers'
import { answer, dice, meleeGame, optionWhere, TOUCH } from '../fixtures/melee'
import { attackBundle } from '../fixtures/attack'
import { realBundle } from '../fixtures/real'
import { skillChoice } from '@/ai/end'

// SKL: the passive skills, wargear and fighter rules of S4K-A (docs/spec/12-rules-test-checklist.md, section SKL). Every hook is
// proved twice: its rule on dice the test scripts, and `hookFireCount(name) > 0` after it played in a game built with the
// fixtures (a fighter given the skill, wargear or rule with `edit`).

const real = realBundle()
const N = 0
const S = Math.PI

interface Gear {
  skills?: string[]
  wargear?: string[]
  rules?: string[]
}

/** Put the real skill, rule and wargear records in the game's data and give a fighter some of them. */
function equip(s: GameState, id: string, gear: Gear): GameState {
  return edit(s, (d) => {
    d.data = { ...d.data, skills: { ...real.skills, ...d.data.skills }, wargear: { ...real.wargear, ...d.data.wargear } }
    const f = d.fighters[id]!
    f.skills.push(...(gear.skills ?? []))
    f.wargear.push(...(gear.wargear ?? []))
    f.rules.push(...(gear.rules ?? []).map((r) => ({ id: r })))
  })
}

const SKILL = {
  dodge: 'core.s.agility.dodge',
  springUp: 'core.s.agility.spring-up',
  ironJaw: 'core.s.brawn.iron-jaw',
  nervesOfSteel: 'core.s.ferocity.nerves-of-steel',
  unstoppable: 'core.s.ferocity.unstoppable',
  inspirational: 'core.s.leadership.inspirational',
  ironWill: 'core.s.leadership.iron-will',
  ironMan: 'gol.s.iron-man',
  walkItOff: 'gol.s.walk-it-off',
  combatFocus: 'esc.s.combat-focus',
}
const GEAR = {
  respirator: 'core.g.respirator',
  filterPlugs: 'core.g.filter-plugs',
  goggles: 'core.g.photo-goggles',
  heavyCarapace: 'gol.g.heavy-carapace',
  bioBooster: 'gol.g.bio-booster',
  stimm: 'gol.g.stimm-slug-stash',
  chemSynth: 'esc.g.chem-synth',
}

function hit(target: string, over: Partial<HitInput> = {}): HitInput {
  return {
    attackerId: 'A3',
    targetId: target,
    weaponId: 'atk.w.plain',
    strength: 3,
    ap: 0,
    damage: { kind: 'fixed', value: 1 },
    traits: [],
    hitRoll: null,
    knockFrom: null,
    melta: false,
    saveVs: null,
    coverBonus: 0,
    from: null,
    saves: true,
    cause: 'atk.w.plain',
    ...over,
  }
}
const who = { attackerId: 'A3', cause: 'test', melta: false, weaponId: null }
const trait = (id: string) => ({ trait: `core.t.${id}` })

/** A3 (plain gun) 6" south of B3, both unarmoured; the other fighters off the board. */
function duel(over: { a?: Gear; b?: Gear; weapons?: string[]; spots?: Record<string, { x: number; z: number; facing?: number; posture?: 'pinned' | 'standing' | 'seriouslyInjured' }> } = {}): GameState {
  let s = meleeGame({
    spots: { A3: { x: 0, z: -6, facing: N }, B3: { x: 0, z: 0, facing: S }, ...over.spots },
    loadouts: { A3: { weapons: over.weapons ?? ['atk.w.plain'] } },
  })
  s = equip(s, 'A3', over.a ?? {})
  s = equip(s, 'B3', over.b ?? {})
  return s
}

/** Activate A3, choose Shoot and the target B3; the dice script covers everything after the target is chosen. */
function shootB3(s: GameState, rng: ReturnType<typeof dice>, pre?: (st: GameState) => GameState): ReturnType<typeof step> {
  let r = must(activate(s, 'A3'))
  let st = pre ? pre(r.state) : r.state
  r = must(take(st, { action: 'shoot' }))
  return must(step(r.state, optionWhere(r.state, { targetId: 'B3' }), rng))
}

beforeEach(() => resetFireCounts())

describe('SKL: skills, wargear and fighter rules (passive)', () => {
  // -------------------------------------------------------------------------------------------------------------------
  // Dodge
  // -------------------------------------------------------------------------------------------------------------------
  it('SKL-001 Dodge: a failed armour save (or none) is followed by an extra unmodifiable 6+ save against a ranged hit; a 6 ignores the hit', () => {
    const s = duel({ b: { skills: [SKILL.dodge] } })
    // hit 6, wound 6 (S3 v T3 needs 4+), no armour: the Dodge roll 6 saves
    const r = shootB3(s, dice(6, 6, 6))
    expect(eventsOf(r.events, 'SaveRolled')).toEqual([expect.objectContaining({ targetId: 'B3', roll: 6, need: 6, saved: true, item: 'dodge' })])
    expect(eventsOf(r.events, 'DamageInflicted')).toHaveLength(0)
    expect(r.state.fighters.B3!.wounds).toBe(1)
    expect(hookFireCount('dodge')).toBe(1)
    // armour first: carapace 4+ fails on a 1, then Dodge 6 saves
    const armoured = duel({ b: { skills: [SKILL.dodge], wargear: ['atk.g.carapace'] } })
    const r2 = shootB3(armoured, dice(6, 6, 1, 6))
    expect(eventsOf(r2.events, 'SaveRolled').map((e) => [e.item, e.saved])).toEqual([['atk.g.carapace', false], ['dodge', true]])
    // a saved armour roll never reaches Dodge
    const r3 = shootB3(armoured, dice(6, 6, 5))
    expect(eventsOf(r3.events, 'SaveRolled').map((e) => e.item)).toEqual(['atk.g.carapace'])
  })

  it('SKL-002 Dodge: 1-5 fails and the hit goes on; AP does not touch it; it also stops a hit that allows no armour save (Power); environmental hits never allow it', () => {
    const s = duel({ b: { skills: [SKILL.dodge] } })
    const r = shootB3(s, dice(6, 6, 5, 1))
    expect(eventsOf(r.events, 'SaveRolled')[0]).toMatchObject({ roll: 5, need: 6, saved: false })
    expect(eventsOf(r.events, 'DamageInflicted')).toHaveLength(1)
    // AP -3 changes nothing: still 6+
    const ap = hitCtx(s, [6, 6])
    resolveHit(ap.ctx, hit('B3', { ap: -3 }))
    expect(eventsOf(ap.ctx.events, 'SaveRolled')[0]).toMatchObject({ need: 6, saved: true })
    // no armour save allowed (Power on a natural 6): the invulnerable save still is
    const power = hitCtx(s, [6, 6])
    resolveHit(power.ctx, hit('B3', { saves: false, closeCombat: true }))
    expect(eventsOf(power.ctx.events, 'SaveRolled')).toEqual([expect.objectContaining({ item: 'dodge', saved: true })])
    expect(eventsOf(power.ctx.events, 'DamageInflicted')).toHaveLength(0)
    // a hit with no attacker (a door, a casket trap, flames) cannot be dodged
    const env = hitCtx(s, [6, 6, 1])
    resolveHit(env.ctx, hit('B3', { attackerId: null }))
    expect(eventsOf(env.ctx.events, 'SaveRolled')).toHaveLength(0)
    expect(eventsOf(env.ctx.events, 'DamageInflicted')).toHaveLength(1)
  })

  it('SKL-003 Dodge: query.saveChance and expectedOutcome count the extra 6+ save', () => {
    const plain = duel()
    const dodger = duel({ b: { skills: [SKILL.dodge] } })
    expect(query.saveChance(plain, 'B3', 0, { fromId: 'A3' }).chance).toBe(0)
    expect(query.saveChance(dodger, 'B3', 0, { fromId: 'A3' }).chance).toBeCloseTo(1 / 6, 6)
    // with a 4+ armour save: 1 - (1/2)(5/6) = 7/12
    const both = duel({ b: { skills: [SKILL.dodge], wargear: ['atk.g.carapace'] } })
    expect(query.saveChance(both, 'B3', 0, { fromId: 'A3' }).chance).toBeCloseTo(1 - 0.5 * (5 / 6), 6)
    const o0 = query.expectedOutcome(plain, 'A3', 'atk.w.plain', 'std', 'B3')
    const o1 = query.expectedOutcome(dodger, 'A3', 'atk.w.plain', 'std', 'B3')
    expect(o0.pUnsaved).toBe(1)
    expect(o1.pUnsaved).toBeCloseTo(5 / 6, 6)
  })

  it('SKL-004 Dodge against a Blast or Template: a successful save lets the fighter step up to 2" clear before it is decided whether it is hit', () => {
    const s = duel({ b: { skills: [SKILL.dodge] }, spots: { B4: { x: 4, z: 4 } } })
    const run = (rolls: number[]) => {
      const { ctx } = hitCtx(s, rolls)
      const done = resolveBlastMarker(ctx, { centre: { x: 0, z: 0 }, radius: 1.2, pins: false, by: 'A3', make: (t) => hit(t.id, { saveVs: 'blast' }) })
      return { ctx, done }
    }
    const saved = run([6])
    expect(saved.done).toEqual([])
    const b3 = saved.ctx.state.fighters.B3!
    expect(Math.hypot(b3.pos.x, b3.pos.z)).toBeGreaterThanOrEqual(1.2 + b3.baseRadius - 1e-6)
    expect(Math.hypot(b3.pos.x, b3.pos.z)).toBeLessThanOrEqual(2 + 1e-6)
    expect(eventsOf(saved.ctx.events, 'FighterMoved')[0]).toMatchObject({ fighterId: 'B3', kind: 'move' })
    expect(eventsOf(saved.ctx.events, 'WoundRolled')).toHaveLength(0)
    expect(hookFireCount('dodge')).toBe(1)
    // a failed save: the blast hits as usual (wound 1 fails)
    const failed = run([5, 1])
    expect(failed.done).toEqual(['B3'])
    expect(failed.ctx.state.fighters.B3!.pos).toMatchObject({ x: 0, z: 0 })
    expect(eventsOf(failed.ctx.events, 'WoundRolled')).toHaveLength(1)
  })

  // -------------------------------------------------------------------------------------------------------------------
  // Spring Up, Iron Jaw, Nerves of Steel
  // -------------------------------------------------------------------------------------------------------------------
  it('SKL-005 Spring Up: activated while Pinned, an Initiative test stands the fighter up for free; a failure leaves it Pinned', () => {
    const base = equip(meleeGame({ spots: { A3: { x: 0, z: -6, facing: N, posture: 'pinned' }, B3: { x: 0, z: 6, facing: S } } }), 'A3', { skills: [SKILL.springUp] })
    // A3 is I 4+: a 4 stands it up and it still has both actions
    const up = must(activate(base, 'A3', dice(4)))
    expect(eventsOf(up.events, 'InitiativeTest')).toEqual([expect.objectContaining({ fighterId: 'A3', roll: 4, need: 4, passed: true, reason: 'springUp' })])
    expect(up.state.fighters.A3!.posture).toBe('standing')
    expect(up.state.action.activation!.actionsLeft).toBe(2)
    expect(query.status(up.state, 'A3')).toBe('standingActive')
    expect(hookFireCount('springUp')).toBe(1)
    // a 3 fails: still Pinned, and the Stand Up action is still on the menu
    const down = must(activate(base, 'A3', dice(3)))
    expect(down.state.fighters.A3!.posture).toBe('pinned')
    expect(down.pending!.options!.some((o) => (o.action.payload as { action?: string }).action === 'standUp')).toBe(true)
    // a fighter without the skill rolls nothing
    const plain = meleeGame({ spots: { A3: { x: 0, z: -6, facing: N, posture: 'pinned' }, B3: { x: 0, z: 6, facing: S } } })
    expect(eventsOf(must(activate(plain, 'A3', dice())).events, 'InitiativeTest')).toHaveLength(0)
  })

  it('SKL-006 Iron Jaw: +2 Toughness against close combat attacks with AP "-" only; it shows in the stat, the odds and the wound roll', () => {
    const s = equip(meleeGame({ spots: { A3: { x: 0, z: -TOUCH, facing: N }, B3: { x: 0, z: 0, facing: S } } }), 'B3', { skills: [SKILL.ironJaw] })
    expect(stat(s, 'B3', 'T')).toBe(3)
    expect(stat(s, 'B3', 'T', { attackerId: 'A3', melee: true, ap: 0 })).toBe(5)
    expect(stat(s, 'B3', 'T', { attackerId: 'A3', melee: true, ap: -1 })).toBe(3)
    expect(stat(s, 'B3', 'T', { attackerId: 'A3', melee: false, ap: 0 })).toBe(3)
    // the fight odds: S3 against T5 wounds on 5+ (1/3), not 4+ (1/2)
    const plain = meleeGame({ spots: { A3: { x: 0, z: -TOUCH, facing: N }, B3: { x: 0, z: 0, facing: S } } })
    const a = activate(s, 'A3').state
    const withJaw = query.fightOutcome(a, 'A3').targets[0]!
    const without = query.fightOutcome(activate(plain, 'A3').state, 'A3').targets[0]!
    expect(withJaw.expectedWounds / without.expectedWounds).toBeCloseTo((2 / 6) / (3 / 6), 6)
    // in the fight: the wound roll needs 5+ (a 4 fails), and the hook fired
    resetFireCounts()
    const r = must(answer(a, optionWhere(a, { action: 'fight' }), dice(6, 4, 1)))
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'B3', need: 5, roll: 4, wounded: false })
    expect(hookFireCount('ironJaw')).toBeGreaterThan(0)
    // a weapon with AP -1 ignores it
    const power = meleeGame({ spots: { A3: { x: 0, z: -TOUCH, facing: N }, B3: { x: 0, z: 0, facing: S } }, loadouts: { A3: { weapons: ['cc.w.power'] } } })
    const p2 = equip(power, 'B3', { skills: [SKILL.ironJaw] })
    const ap = activate(p2, 'A3').state
    const r2 = must(answer(ap, optionWhere(ap, { action: 'fight' }), dice(6, 3, 1, 1, 1, 1, 1, 1)))
    expect(eventsOf(r2.events, 'WoundRolled')[0]).toMatchObject({ need: 3, wounded: true }) // S4 v T3
  })

  it('SKL-007 Nerves of Steel: hit by a ranged attack, a Cool test avoids being Pinned; one test per attack; the odds show it', () => {
    const s = duel({ b: { skills: [SKILL.nervesOfSteel] } })
    // hit 6, Cool 6 + 6 = 12 (Cl 7+) passes: not Pinned; wound 1 fails
    const ok = shootB3(s, dice(6, 6, 6, 1))
    expect(eventsOf(ok.events, 'SkillUsed')[0]).toMatchObject({ fighterId: 'B3', code: 'nervesOfSteel', passed: true })
    expect(ok.state.fighters.B3!.posture).toBe('standing')
    expect(eventsOf(ok.events, 'FighterPinned')).toHaveLength(0)
    expect(hookFireCount('nervesOfSteel')).toBe(1)
    // Cool 2 + 3 = 5 fails: Pinned
    const bad = shootB3(s, dice(6, 2, 3, 1))
    expect(bad.state.fighters.B3!.posture).toBe('pinned')
    expect(eventsOf(bad.events, 'SkillUsed')[0]).toMatchObject({ passed: false })
    // the odds: Cl 7+ passes 21/36 of the time
    const plain = duel()
    const pin = (st: GameState) => query.expectedOutcome(st, 'A3', 'atk.w.plain', 'std', 'B3').pPinned
    expect(pin(s)).toBeCloseTo(pin(plain) * (1 - 21 / 36), 6)
    // Engaged fighters are never Pinned and take no test
    expect(pin(plain)).toBeGreaterThan(0)
    // the Nerves of Steel test is a Cool test, so an Inspirational friend within 6" may rescue it (Leadership 6 + 6)
    const inspired = equip(duel({ b: { skills: [SKILL.nervesOfSteel] }, spots: { B4: { x: 3, z: 1, facing: S } } }), 'B4', { skills: [SKILL.inspirational] })
    const rescued = shootB3(inspired, dice(6, 2, 3, 6, 6, 1))
    expect(eventsOf(rescued.events, 'SkillUsed').map((e) => [e.code, e.passed])).toEqual([['nervesOfSteel', false], ['inspirational', true]])
    expect(rescued.state.fighters.B3!.posture).toBe('standing')
    expect(pin(inspired)).toBeLessThan(pin(s))
  })

  // -------------------------------------------------------------------------------------------------------------------
  // End phase and morale skills: Unstoppable, Inspirational, Iron Will
  // -------------------------------------------------------------------------------------------------------------------
  it('SKL-008 Unstoppable: before a Recovery test a D6 of 4+ removes a Flesh Wound, or with none adds a die the owner chooses between', () => {
    const PRIORITY = [3, 4]
    const base = (tweak: (d: GameState) => void): GameState =>
      equip(
        edit(endGame(), (d) => {
          d.fighters.A3!.posture = 'seriouslyInjured'
          d.fighters.A3!.ready = false
          tweak(d)
        }),
        'A3',
        { skills: [SKILL.unstoppable] },
      )
    // Flesh Wounds 2: the Bottle roll 1 holds, Unstoppable rolls 5 (one Flesh Wound goes), the recovery die 4 (stays down, +1 Flesh Wound)
    const wounded = playOut(base((d) => (d.fighters.A3!.fleshWounds = 2)), dice(1, 5, 4, ...PRIORITY))
    expect(eventsOf(wounded.events, 'SkillUsed')).toEqual([expect.objectContaining({ fighterId: 'A3', code: 'unstoppable', detail: 'fleshWoundRemoved', roll: 5 })])
    expect(wounded.state.fighters.A3).toMatchObject({ posture: 'seriouslyInjured', fleshWounds: 2 })
    expect(eventsOf(wounded.events, 'FleshWound')[0]).toMatchObject({ total: 2 })
    expect(hookFireCount('unstoppable')).toBe(1)
    // no Flesh Wound: an extra die; the faces 1 (Flesh Wound) and 6 (Out of Action) go to the pick, which takes the least severe
    resetFireCounts()
    const extra = playOut(base(() => {}), dice(1, 4, 1, 6, ...PRIORITY))
    expect(eventsOf(extra.events, 'SkillUsed')[0]).toMatchObject({ detail: 'extraRecoveryDie' })
    expect(eventsOf(extra.events, 'RecoveryTest')[0]).toMatchObject({ fighterId: 'A3', faces: ['fleshWound', 'outOfAction'], applied: 'fleshWound' })
    expect(extra.state.fighters.A3!.location).toBe('board')
    expect(hookFireCount('unstoppable')).toBe(1)
    // 1-3: nothing happens, one die
    resetFireCounts()
    const none = playOut(base(() => {}), dice(1, 3, 4, ...PRIORITY))
    expect(eventsOf(none.events, 'RecoveryTest')[0]!.faces).toHaveLength(1)
    expect(hookFireCount('unstoppable')).toBe(0)
  })

  it('SKL-009 Inspirational: a friend within 6" that fails a Cool test is rescued when this fighter passes a Leadership test; farther away it does not help', () => {
    const spots = (leaderX: number) => ({ B4: { x: 0, z: 0, facing: S }, B1: { x: leaderX, z: 0, facing: S } })
    const mk = (leaderX: number) => equip(meleeGame({ spots: spots(leaderX) }), 'B1', { skills: [SKILL.inspirational] })
    const test = (s: GameState, rolls: number[]) => {
      const ctx = createCtx(cloneState(s), dice(...rolls), null, s.seq)
      const broke = takeNerveTest(ctx, { fighterId: 'B4', reason: 'seriouslyInjured:B3' })
      return { ctx, broke }
    }
    // B4 is Cl 7+: 1 + 1 fails; B1 (Ld 5+) rolls 3 + 3 and the original test counts as passed
    const near = mk(4.5)
    const saved = test(near, [1, 1, 3, 3])
    expect(saved.broke).toBe(false)
    expect(eventsOf(saved.ctx.events, 'SkillUsed')).toEqual([expect.objectContaining({ fighterId: 'B1', code: 'inspirational', detail: 'rescued:B4', roll: 6, need: 5, passed: true })])
    expect(eventsOf(saved.ctx.events, 'NerveTest')[0]).toMatchObject({ fighterId: 'B4', passed: true })
    expect(saved.ctx.state.fighters.B4!.conditions.broken).toBeUndefined()
    expect(hookFireCount('inspirational')).toBe(1)
    // the Leadership test fails: B4 breaks
    expect(test(near, [1, 1, 1, 2]).broke).toBe(true)
    // 8" away: no rescue is attempted
    const far = test(mk(8), [1, 1])
    expect(far.broke).toBe(true)
    expect(eventsOf(far.ctx.events, 'SkillUsed')).toHaveLength(0)
    // a passed test needs no rescue
    expect(eventsOf(test(near, [6, 6]).ctx.events, 'SkillUsed')).toHaveLength(0)
    // the skill names no status that stops it: a Seriously Injured Inspirational fighter still rescues
    const down = equip(meleeGame({ spots: { B4: { x: 0, z: 0, facing: S }, B1: { x: 4, z: 0, facing: S, posture: 'seriouslyInjured' } } }), 'B1', { skills: [SKILL.inspirational] })
    expect(test(down, [1, 1, 3, 3]).broke).toBe(false)
    // the nerve odds count the rescue: 21/36 + (15/36)(30/36)
    expect(query.nerveOdds(near, 'B4').chance).toBeCloseTo(21 / 36 + (15 / 36) * (30 / 36), 6)
    expect(query.nerveOdds(mk(8), 'B4').chance).toBeCloseTo(21 / 36, 6)
  })

  it('SKL-010 Inspirational in a game: a nerve test caused by a fight is rescued by an Inspirational friend nearby', () => {
    const s = equip(
      meleeGame({
        spots: {
          A3: { x: 0, z: -TOUCH, facing: N },
          B3: { x: 0, z: 0, facing: S },
          B4: { x: 2.5 + 2 * 0.492, z: 0, facing: S },
          B1: { x: 2.5 + 2 * 0.492 + 4, z: 0, facing: S },
        },
        active: 'A3',
      }),
      'B1',
      { skills: [SKILL.inspirational] },
    )
    // hit 6, wound 6, injury 3 (Seriously Injured), B4's nerve test 1 + 1 fails, B1's Leadership 6 + 6
    const rng = dice(6, 6, 3, 1, 1, 6, 6)
    const r = must(answer(s, optionWhere(s, { action: 'fight' }), rng))
    expect(r.state.fighters.B3!.posture).toBe('seriouslyInjured')
    expect(eventsOf(r.events, 'NerveTest').map((e) => [e.fighterId, e.passed])).toEqual([['B4', true]])
    expect(r.state.fighters.B4!.conditions.broken).toBeUndefined()
    expect(hookFireCount('inspirational')).toBe(1)
  })

  it('SKL-011 Iron Will: -1 to the gang\'s Bottle roll while a fighter with it is on the battlefield and not Seriously Injured', () => {
    const PRIORITY = [3, 4]
    const down = (d: GameState) => {
      for (const id of ['A2', 'A3']) {
        d.fighters[id]!.location = 'outOfAction'
        d.fighters[id]!.ready = false
      }
    }
    const plain = edit(endGame(), down)
    const will = equip(plain, 'A1', { skills: [SKILL.ironWill] })
    expect(query.bottleOdds(plain, 'A')).toMatchObject({ down: 2, crew: 5, need: 4, modifier: 0 })
    expect(query.bottleOdds(will, 'A')).toMatchObject({ need: 5, modifier: -1, pBottle: 2 / 6 })
    // a 4 bottles the gang (4 + 2 > 5) without Iron Will and holds it with
    expect(playOut(plain, dice(4, 6, 6, 6, 6, 6, 6, ...PRIORITY)).state.players.A.bottled).toBe(true)
    resetFireCounts()
    const held = playOut(will, dice(4, ...PRIORITY))
    expect(held.state.players.A.bottled).toBe(false)
    expect(eventsOf(held.events, 'BottleTest')[0]).toMatchObject({ seat: 'A', roll: 4, bottled: false, modifier: -1 })
    expect(hookFireCount('ironWill')).toBeGreaterThan(0)
    // the carrier laid down: no effect
    const laid = edit(will, (d) => {
      d.fighters.A1!.posture = 'seriouslyInjured'
    })
    expect(query.bottleOdds(laid, 'A')).toMatchObject({ down: 3, modifier: 0 })
    // two carriers do not stack (ruling)
    const two = equip(will, 'A4', { skills: [SKILL.ironWill] })
    expect(query.bottleOdds(two, 'A').modifier).toBe(-1)
  })

  // -------------------------------------------------------------------------------------------------------------------
  // Iron Man, Combat Focus, Walk It Off
  // -------------------------------------------------------------------------------------------------------------------
  it('SKL-012 Iron Man: Flesh Wounds do not lower Toughness, yet Flesh Wounds equal to Toughness still take the fighter Out of Action', () => {
    const mk = (gear: Gear) => equip(meleeGame({ spots: { A3: { x: 0, z: -TOUCH, facing: N }, B3: { x: 0, z: 0, facing: S } }, tweak: (d) => (d.fighters.B3!.fleshWounds = 2) }), 'B3', gear)
    const man = mk({ skills: [SKILL.ironMan] })
    const plain = mk({})
    expect(stat(plain, 'B3', 'T')).toBe(1)
    expect(stat(man, 'B3', 'T')).toBe(3)
    // the wound roll: S3 against T3 needs 4+, against T1 2+ (hit 6, wound 5, injury 1 = a third Flesh Wound)
    for (const [s, need] of [[plain, 2], [man, 4]] as const) {
      resetFireCounts()
      const a = activate(s, 'A3').state
      const r = must(answer(a, optionWhere(a, { action: 'fight' }), dice(6, 5, 1, 1, 1)))
      expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ need })
      expect(r.state.fighters.B3!.location).toBe('outOfAction') // three Flesh Wounds on T 3
    }
    expect(hookFireCount('ironMan')).toBeGreaterThan(0)
    // with two Flesh Wounds already, the third (Flesh Wounds equal to T 3) takes the Iron Man Out of Action
    const { ctx } = hitCtx(man, [])
    fleshWound(ctx, ctx.state.fighters.B3!, null, 'test')
    expect(ctx.state.fighters.B3!.location).toBe('outOfAction')
    // the injury odds count Flesh Wounds against the printed Toughness
    expect(query.injuryOdds(man, 1, [], 'B3').pOutOfAction).toBeCloseTo(1 / 6 + 2 / 6, 6) // a Flesh Wound is the third
    expect(query.injuryOdds(plain, 1, [], 'B3').pOutOfAction).toBeCloseTo(1 / 6 + 2 / 6, 6)
    const one = edit(man, (d) => (d.fighters.B3!.fleshWounds = 1))
    expect(query.injuryOdds(one, 1, [], 'B3').pOutOfAction).toBeCloseTo(1 / 6, 6)
  })

  it('SKL-013 Combat Focus: +1 Willpower and Cool for each enemy Out of Action or Seriously Injured; a total of 2 still fails', () => {
    const base = meleeGame({ spots: { A1: { x: 0, z: 0, facing: N }, B1: { x: 0, z: 12, facing: S }, B2: { x: 4, z: 12, facing: S }, B3: { x: 8, z: 12, facing: S }, B4: { x: -4, z: 12, facing: S } } })
    const s = equip(base, 'A1', { skills: [SKILL.combatFocus] })
    expect(stat(s, 'A1', 'Cl')).toBe(5)
    expect(stat(s, 'A1', 'Wil')).toBe(6)
    const hurt = edit(s, (d) => {
      d.fighters.B1!.posture = 'seriouslyInjured'
      d.fighters.B2!.location = 'outOfAction'
      d.fighters.B3!.location = 'fled'
    })
    expect(stat(hurt, 'A1', 'Cl')).toBe(3) // B3 fled: not counted (ruling)
    expect(stat(hurt, 'A1', 'Wil')).toBe(4)
    expect(stat(hurt, 'A1', 'S')).toBe(hurt.fighters.A1!.stats.S)
    // a fighter without the skill is unchanged
    expect(stat(edit(base, (d) => (d.fighters.B1!.posture = 'seriouslyInjured')), 'A1', 'Cl')).toBe(5)
    // five enemies down take Cl 5 to 0, yet a 2 on 2D6 fails and a 3 passes
    const all = edit(s, (d) => {
      for (const id of ['B1', 'B2', 'B3', 'B4', 'B5']) d.fighters[id]!.location = 'outOfAction'
    })
    expect(stat(all, 'A1', 'Cl')).toBe(0)
    resetFireCounts()
    const lost = createCtx(cloneState(all), dice(1, 1), null, all.seq)
    expect(takeNerveTest(lost, { fighterId: 'A1', reason: 'x' })).toBe(true)
    const kept = createCtx(cloneState(all), dice(1, 2), null, all.seq)
    expect(takeNerveTest(kept, { fighterId: 'A1', reason: 'x' })).toBe(false)
    expect(hookFireCount('combatFocus')).toBeGreaterThan(0)
  })

  it('SKL-014 Walk It Off: two Move (Simple) actions, then a Toughness test at the end of the activation restores a Flesh Wound, or else a lost Wound', () => {
    const base = (tweak: (d: GameState) => void) => equip(meleeGame({ spots: { A3: { x: 0, z: -12, facing: N }, B3: { x: 0, z: 12, facing: S } }, tweak }), 'A3', { skills: [SKILL.walkItOff] })
    const twoMoves = (s: GameState, rolls: number[]) => {
      let r = must(activate(s, 'A3'))
      r = must(take(r.state, { action: 'move' }))
      r = must(moveTo(r.state, [{ x: 0, z: -9 }]))
      r = must(take(r.state, { action: 'move' }))
      return must(moveTo(r.state, [{ x: 0, z: -6 }], undefined, dice(...rolls)))
    }
    // a Flesh Wound lowers T to 2: a 2 passes; the Flesh Wound goes first
    const wounded = twoMoves(base((d) => (d.fighters.A3!.fleshWounds = 1)), [2])
    expect(wounded.state.fighters.A3!.fleshWounds).toBe(0)
    expect(eventsOf(wounded.events, 'SkillUsed')[0]).toMatchObject({ code: 'walkItOff', detail: 'fleshWoundRemoved', roll: 2, need: 2, passed: true })
    expect(hookFireCount('walkItOff')).toBe(1)
    // no Flesh Wound: a lost Wound comes back
    const hurt = twoMoves(base((d) => ((d.fighters.A3!.maxWounds = 2), (d.fighters.A3!.wounds = 1))), [3])
    expect(hurt.state.fighters.A3!.wounds).toBe(2)
    // a 4 fails (roll over T)
    const failed = twoMoves(base((d) => (d.fighters.A3!.fleshWounds = 1)), [4])
    expect(failed.state.fighters.A3!.fleshWounds).toBe(1)
    expect(eventsOf(failed.events, 'SkillUsed')[0]).toMatchObject({ passed: false })
    // one Move only: no test (the script is empty, so a roll would throw)
    const s = base((d) => (d.fighters.A3!.fleshWounds = 1))
    let one = must(activate(s, 'A3'))
    one = must(take(one.state, { action: 'move' }))
    one = must(moveTo(one.state, [{ x: 0, z: -9 }]))
    one = must(step(one.state, act.endActivation(one.pending!), dice()))
    expect(one.state.fighters.A3!.fleshWounds).toBe(1)
  })

  // -------------------------------------------------------------------------------------------------------------------
  // Wargear: Respirator and Filter plugs, Photo-goggles, Heavy carapace, Bio-booster
  // -------------------------------------------------------------------------------------------------------------------
  it('SKL-015 Respirator +2 and Filter plugs +1 Toughness against Gas weapons only; they show in the stat and the odds and change the Gas roll', () => {
    const vsGas = { attackerId: 'A3', gas: true } as const
    const plain = duel({ weapons: ['atk.w.gas'] })
    const mask = duel({ weapons: ['atk.w.gas'], b: { wargear: [GEAR.respirator] } })
    const plugs = duel({ weapons: ['atk.w.gas'], b: { wargear: [GEAR.filterPlugs] } })
    const both = duel({ weapons: ['atk.w.gas'], b: { wargear: [GEAR.respirator, GEAR.filterPlugs] } })
    expect([plain, mask, plugs, both].map((s) => stat(s, 'B3', 'T', vsGas))).toEqual([3, 5, 4, 6])
    expect(stat(mask, 'B3', 'T')).toBe(3)
    expect(stat(mask, 'B3', 'T', { attackerId: 'A3', toxin: true })).toBe(3)
    expect(query.woundChance(plain, 'A3', 'atk.w.gas', 'std', 'B3')).toBeCloseTo(4 / 6, 6) // T3: 3+
    expect(query.woundChance(mask, 'A3', 'atk.w.gas', 'std', 'B3')).toBeCloseTo(2 / 6, 6) // T5: 5+
    // a 4 on the Gas roll hurts a plain fighter and bounces off the respirator
    const hurt = shootB3(plain, dice(6, 4, 1))
    expect(eventsOf(hurt.events, 'WoundRolled')[0]).toMatchObject({ roll: 4, need: 3, wounded: true })
    expect(eventsOf(hurt.events, 'InjuryRolled')).toHaveLength(1)
    resetFireCounts()
    const safe = shootB3(mask, dice(6, 4))
    expect(eventsOf(safe.events, 'WoundRolled')[0]).toMatchObject({ roll: 4, need: 5, wounded: false })
    expect(eventsOf(safe.events, 'InjuryRolled')).toHaveLength(0)
    expect(hookFireCount('gasToughnessBonus')).toBeGreaterThan(0)
  })

  it('SKL-016 Photo-goggles: the wearer sees and shoots through smoke clouds; +1 on the Initiative test against Flash', () => {
    const smoky = (s: GameState) => edit(s, (d) => void d.board.smoke.push({ id: 'smoke:t', pos: { x: 0, z: -3 }, radius: 1.5, placedRound: 1 }))
    const plain = smoky(duel())
    const goggled = smoky(duel({ a: { wargear: [GEAR.goggles] } }))
    expect(query.losLine(plain, 'A3', 'B3').los).toBe(false)
    expect(query.shootTargets(activate(plain, 'A3').state, 'A3', 'atk.w.plain', 'std').map((t) => t.targetId)).not.toContain('B3')
    expect(query.losLine(goggled, 'A3', 'B3').los).toBe(true)
    expect(query.shootTargets(activate(goggled, 'A3').state, 'A3', 'atk.w.plain', 'std').map((t) => t.targetId)).toContain('B3')
    expect(hookFireCount('photoGoggles')).toBeGreaterThan(0)
    // Flash: B3 is I 4+; a 3 blinds it, but the goggles add +1
    resetFireCounts()
    const flash = (gear: Gear) => shootB3(duel({ weapons: ['atk.w.flash'], b: gear }), dice(6, 3))
    expect(flash({}).state.fighters.B3!.conditions.blind).toBeDefined()
    const protectedEyes = flash({ wargear: [GEAR.goggles] })
    expect(protectedEyes.state.fighters.B3!.conditions.blind).toBeUndefined()
    expect(hookFireCount('photoGoggles')).toBeGreaterThan(0)
  })

  it('SKL-017 Heavy carapace: -1 Initiative and 1" less when charging (the 4+ / 3+ front save is data); it shows in the stat and the charge odds', () => {
    const spots = { A3: { x: 0, z: -6, facing: N }, B3: { x: 0, z: 1.984, facing: S } } // 7" apart
    const plain = meleeGame({ spots })
    const heavy = equip(plain, 'A3', { wargear: [GEAR.heavyCarapace] })
    expect(stat(plain, 'A3', 'I')).toBe(4)
    expect(stat(heavy, 'A3', 'I')).toBe(5)
    const f = (s: GameState) => s.fighters.A3!
    expect(moveAllowance(plain, f(plain), true)).toBe(5)
    expect(moveAllowance(heavy, f(heavy), true)).toBe(4)
    expect(moveAllowance(heavy, f(heavy))).toBe(5) // a plain Move is not slowed
    const reach = (s: GameState) => query.chargeTargets(activate(s, 'A3').state, 'A3').find((t) => t.targetId === 'B3')!.pReach
    expect(reach(plain)).toBeCloseTo(4 / 6, 6) // M5 + D3 >= 7 on a 2+
    expect(reach(heavy)).toBeCloseTo(2 / 6, 6) // 4 + D3 on a 3
    // the save values come from the data: 4+, 3+ from the front
    expect(heavy.fighters.A3!.wargear).toContain(GEAR.heavyCarapace)
    // in a charge: D3 roll 1 moves M - 1 + 1
    resetFireCounts()
    const close = equip(meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -6, facing: S } } }), 'A3', { wargear: [GEAR.heavyCarapace] })
    const a = activate(close, 'A3').state
    const r = must(answer(a, optionWhere(a, { action: 'charge', targetId: 'B3' }), dice(1, 1, 1, 1, 1, 1)))
    expect(eventsOf(r.events, 'FighterMoved')[0]).toMatchObject({ kind: 'charge', maxInches: 5 }) // (5 - 1) + D3 of 1
    expect(hookFireCount('heavyCarapace')).toBeGreaterThan(0)
  })

  it('SKL-018 Bio-booster: the first time in a battle the wearer rolls Injury dice it rolls one fewer (a single die: two, the worse dropped); not again', () => {
    const s = duel({ b: { wargear: [GEAR.bioBooster] } })
    // 2 dice become 1 (the Flesh Wound); the second Injury roll is a full 2 dice
    const { ctx } = hitCtx(s, [1, 1, 1])
    const t = ctx.state.fighters.B3!
    rollInjuries(ctx, t, 2, who)
    expect(eventsOf(ctx.events, 'InjuryRolled')[0]!.faces).toEqual(['fleshWound'])
    expect(t.used).toContain('bioBooster')
    rollInjuries(ctx, t, 2, who)
    expect(eventsOf(ctx.events, 'InjuryRolled')[1]!.faces).toEqual(['fleshWound', 'fleshWound'])
    expect(t.fleshWounds).toBe(3)
    // one die becomes two and the worse (Out of Action) is dropped
    const single = hitCtx(s, [6, 1])
    rollInjuries(single.ctx, single.ctx.state.fighters.B3!, 1, who)
    expect(eventsOf(single.ctx.events, 'InjuryRolled')[0]).toMatchObject({ faces: ['outOfAction', 'fleshWound'], applied: 'fleshWound' })
    expect(single.ctx.state.fighters.B3!.location).toBe('board')
    // the odds: two dice, the worse dropped, then a normal die once it is used up
    const o = query.injuryOdds(s, 1, [], 'B3')
    expect(o.pOutOfAction).toBeCloseTo(1 / 36, 6)
    expect(o.pSeriouslyInjured).toBeCloseTo(15 / 36, 6)
    expect(query.injuryOdds(edit(s, (d) => (d.fighters.B3!.used = ['bioBooster'])), 1, [], 'B3').pOutOfAction).toBeCloseTo(1 / 6, 6)
    // in a game: hit 6, wound 6, Damage 1 on 1 W = one Injury die, so two are rolled (Out of Action 6, Flesh Wound 1) and the worse dropped
    resetFireCounts()
    const r = shootB3(s, dice(6, 6, 6, 1))
    expect(eventsOf(r.events, 'InjuryRolled')[0]).toMatchObject({ faces: ['outOfAction', 'fleshWound'] })
    expect(r.state.fighters.B3).toMatchObject({ location: 'board', fleshWounds: 1 })
    expect(hookFireCount('bioBooster')).toBe(1)
  })

  // -------------------------------------------------------------------------------------------------------------------
  // Choices at the start of an activation: Stimm-slug stash, Chem-synth
  // -------------------------------------------------------------------------------------------------------------------
  it('SKL-019 Stimm-slug stash: once per battle, at the start of the wearer\'s activation (skill.choice, "use" first): +2 M, S and T and a Flesh Wound shed', () => {
    const s = equip(meleeGame({ spots: { A3: { x: 0, z: -6, facing: N }, B3: { x: 0, z: 6, facing: S } }, tweak: (d) => (d.fighters.A3!.fleshWounds = 1) }), 'A3', { wargear: [GEAR.stimm] })
    const asked = must(activate(s, 'A3'))
    expect(asked.pending!.kind).toBe('skill.choice')
    expect(asked.pending!.context).toMatchObject({ code: 'stimmSlugStash', fighterId: 'A3' })
    expect(asked.pending!.options!.map((o) => o.id)).toEqual(['use', 'decline'])
    expect(asked.pending!.seat).toBe('A')
    // the AI takes the first option that is not a decline
    expect(skillChoice({ pending: asked.pending! } as never)?.payload).toEqual({ option: 'use' })
    // nothing changes until it is used
    expect(stat(asked.state, 'A3', 'S')).toBe(3)
    const used = must(take(asked.state, { option: 'use' }))
    expect(used.pending!.kind).toBe('action.choose')
    const f = used.state.fighters.A3!
    expect([stat(used.state, 'A3', 'M'), stat(used.state, 'A3', 'S'), stat(used.state, 'A3', 'T')]).toEqual([7, 5, 5])
    expect(f).toMatchObject({ fleshWounds: 0, used: ['stimmSlugStash'] })
    expect(f.conditions.stimm).toBeDefined()
    expect(moveAllowance(used.state, f)).toBe(7)
    expect(hookFireCount('stimmSlugStash')).toBe(1)
    // declining keeps it for a later activation
    const declined = must(take(asked.state, { option: 'decline' }))
    expect(declined.state.fighters.A3!.conditions.stimm).toBeUndefined()
    expect(declined.state.fighters.A3!.used).toBeUndefined()
    // a fighter that has used it is never asked again
    const spent = edit(s, (d) => (d.fighters.A3!.used = ['stimmSlugStash']))
    expect(must(activate(spent, 'A3')).pending!.kind).toBe('action.choose')
  })

  it('SKL-020 Stimm-slug stash: at the start of the End phase a 1 on a D6 forces an Injury roll; the boost ends with the round', () => {
    const PRIORITY = [3, 4]
    const base = (flesh = 0) => {
      const s = equip(meleeGame({ spots: { A3: { x: 0, z: -6, facing: N }, B3: { x: 0, z: 6, facing: S } }, tweak: (d) => (d.fighters.A3!.fleshWounds = flesh) }), 'A3', { wargear: [GEAR.stimm] })
      return must(take(must(activate(s, 'A3')).state, { option: 'use' })).state
    }
    // stimm roll 1, Injury die 1 (a Flesh Wound); the condition goes at the round's end
    const bad = playOut(base(), dice(1, 1, ...PRIORITY))
    expect(eventsOf(bad.events, 'SkillUsed').find((e) => e.detail === 'injuryRoll')).toMatchObject({ fighterId: 'A3', roll: 1, passed: false })
    expect(bad.state.fighters.A3).toMatchObject({ fleshWounds: 1, location: 'board' })
    expect(bad.state.fighters.A3!.conditions.stimm).toBeUndefined()
    expect(stat(bad.state, 'A3', 'S')).toBe(3)
    // a 2+ is safe
    const safe = playOut(base(), dice(2, ...PRIORITY))
    expect(eventsOf(safe.events, 'SkillUsed').find((e) => e.detail === 'safe')).toBeDefined()
    expect(safe.state.fighters.A3!.fleshWounds).toBe(0)
    // Flesh Wounds taken while boosted (T 5) that reach the normal Toughness (3) put the fighter down when the boost ends
    const raw = base()
    const loaded = edit(raw, (d) => (d.fighters.A3!.fleshWounds = 3))
    const gone = playOut(loaded, dice(2, ...PRIORITY))
    expect(gone.state.fighters.A3!.location).toBe('outOfAction')
    expect(gone.state.casualties.find((c) => c.fighterId === 'A3')).toMatchObject({ cause: 'stimm', kind: 'outOfAction' })
  })

  it('SKL-021 Chem-synth: if Standing at the start of an activation, an Intelligence test lowers targets\' Toughness by 1 against Gas and Toxin that activation', () => {
    const mk = (over: Parameters<typeof duel>[0] = {}) => duel({ weapons: ['atk.w.gas'], a: { wargear: [GEAR.chemSynth] }, ...over })
    const s = mk()
    const asked = must(activate(s, 'A3'))
    expect(asked.pending!.kind).toBe('skill.choice')
    expect(asked.pending!.context).toMatchObject({ code: 'chemSynth', fighterId: 'A3', need: 7 })
    expect(asked.pending!.options![0]!.id).toBe('use')
    // Int 7+: 4 + 4 passes; the target's T 3 is 2 against Gas, which shows in the odds
    const used = must(take(asked.state, { option: 'use' }, dice(4, 4)))
    expect(eventsOf(used.events, 'SkillUsed')[0]).toMatchObject({ code: 'chemSynth', roll: 8, need: 7, passed: true })
    expect(used.state.fighters.A3!.conditions.chemSynth).toBeDefined()
    expect(query.woundChance(used.state, 'A3', 'atk.w.gas', 'std', 'B3')).toBeCloseTo(5 / 6, 6)
    expect(query.woundChance(asked.state, 'A3', 'atk.w.gas', 'std', 'B3')).toBeCloseTo(4 / 6, 6)
    // the Gas roll: a 2 now wounds (T 2); the condition ends with the activation
    resetFireCounts()
    const shot = must(take(used.state, { action: 'shoot' }))
    const hit = must(step(shot.state, optionWhere(shot.state, { targetId: 'B3' }), dice(6, 2, 1)))
    expect(eventsOf(hit.events, 'WoundRolled')[0]).toMatchObject({ roll: 2, need: 2, wounded: true })
    expect(hookFireCount('chemSynth')).toBeGreaterThan(0)
    const done = must(step(hit.state, act.endActivation(hit.pending!), dice()))
    expect(done.state.fighters.A3!.conditions.chemSynth).toBeUndefined()
    // a failed test (1 + 2) leaves no effect; declining rolls nothing
    const failed = must(take(asked.state, { option: 'use' }, dice(1, 2)))
    expect(failed.state.fighters.A3!.conditions.chemSynth).toBeUndefined()
    expect(eventsOf(failed.events, 'SkillUsed')[0]).toMatchObject({ passed: false })
    const declined = must(take(asked.state, { option: 'decline' }, dice()))
    expect(declined.state.fighters.A3!.conditions.chemSynth).toBeUndefined()
    // not offered without a Gas or Toxin weapon, or when Pinned
    expect(must(activate(mk({ weapons: ['atk.w.plain'] }), 'A3')).pending!.kind).toBe('action.choose')
    expect(must(activate(mk({ spots: { A3: { x: 0, z: -6, posture: 'pinned' } } }), 'A3')).pending!.kind).toBe('action.choose')
  })

  // -------------------------------------------------------------------------------------------------------------------
  // Fighter and house rules: Hot-headed, Combat Chems Stash, Poison Blood
  // -------------------------------------------------------------------------------------------------------------------
  it('SKL-022 Hot-headed: friends owe no nerve test when this fighter goes down; fighters of its own type still do', () => {
    const spots = {
      A3: { x: 0, z: -TOUCH, facing: N },
      B3: { x: 0, z: 0, facing: S },
      B4: { x: 2, z: 0, facing: S }, // same type (ganger)
      B5: { x: -2, z: 0, facing: S }, // a juve
      B2: { x: 0, z: 2, facing: S }, // a champion
    }
    const fight = (gear: Gear) => {
      const s = equip(meleeGame({ spots, active: 'A3' }), 'B3', gear)
      return must(answer(s, optionWhere(s, { action: 'fight' }), dice(6, 6, 3, 6, 6, 6, 6, 6, 6)))
    }
    const plain = fight({})
    expect(eventsOf(plain.events, 'NerveTest').map((e) => e.fighterId).sort()).toEqual(['B2', 'B4', 'B5'])
    resetFireCounts()
    const hot = fight({ rules: ['core.r.hot-headed'] })
    expect(hot.state.fighters.B3!.posture).toBe('seriouslyInjured')
    expect(eventsOf(hot.events, 'NerveTest').map((e) => e.fighterId)).toEqual(['B4'])
    expect(hookFireCount('hotHeaded')).toBe(2)
  })

  it('SKL-023 Combat Chems Stash: on activation the owner may roll a D6 that sets Attacks to 1 (1), adds 1 (2), 2 (3-4) or 3 (5-6) for the round; it raises the characteristic', () => {
    const PRIORITY = [3, 4]
    const base = equip(meleeGame({ spots: { A1: { x: 0, z: -6, facing: N }, B3: { x: 0, z: 6, facing: S } } }), 'A1', { rules: ['gol.r.combat-chems-stash'] })
    expect(stat(base, 'A1', 'A')).toBe(2)
    const expected: [number, number, string][] = [[1, 1, 'set:1'], [2, 3, 'add:1'], [3, 4, 'add:2'], [4, 4, 'add:2'], [5, 5, 'add:3'], [6, 5, 'add:3']]
    for (const [roll, attacks, detail] of expected) {
      resetFireCounts()
      const asked = must(activate(base, 'A1', dice()))
      expect(asked.pending!.kind).toBe('skill.choice')
      expect(asked.pending!.context).toMatchObject({ code: 'combatChemsStash', fighterId: 'A1', attacks: 2 })
      const r = must(take(asked.state, { option: 'use' }, dice(roll)))
      expect(r.pending!.kind).toBe('action.choose')
      expect(stat(r.state, 'A1', 'A'), `roll ${roll}`).toBe(attacks)
      expect(eventsOf(r.events, 'SkillUsed')[0]).toMatchObject({ code: 'combatChemsStash', detail, roll })
      expect(r.state.fighters.A1!.conditions.combatChems).toBeDefined()
      expect(hookFireCount('combatChemsStash')).toBe(1)
    }
    // the result lasts to the end of the round
    const five = must(take(must(activate(base, 'A1', dice())).state, { option: 'use' }, dice(5))).state
    const over = playOut(five, dice(...PRIORITY))
    expect(over.state.round).toBe(2)
    expect(over.state.fighters.A1!.conditions.combatChems).toBeUndefined()
    expect(stat(over.state, 'A1', 'A')).toBe(2)
    // the roll is optional ("can roll"): declining rolls nothing and keeps the printed Attacks
    const declined = must(take(must(activate(base, 'A1', dice())).state, { option: 'decline' }, dice()))
    expect(eventsOf(declined.events, 'DiceRolled')).toHaveLength(0)
    expect(declined.state.fighters.A1!.conditions.combatChems).toBeUndefined()
    expect(stat(declined.state, 'A1', 'A')).toBe(2)
  })

  it('SKL-024 Poison Blood: a natural 1 on the Toughness roll of a Toxin weapon is re-rolled; no other roll is, and a fighter without the rule never re-rolls', () => {
    const toxin = (rule: boolean) => {
      const s = duel({ weapons: ['atk.w.toxin'], a: rule ? { rules: ['esc.r.poison-blood'] } : {} })
      const { ctx } = hitCtx(s, [1, 4, 1])
      resolveHit(ctx, hit('B3', { strength: 0, damage: { kind: 'none' }, traits: [trait('toxin')], weaponId: 'atk.w.toxin' }))
      return ctx
    }
    const ctx = toxin(true)
    expect(ctx.events.filter((e) => e.type === 'DiceRolled').map((e) => (e as { purpose: string }).purpose)).toEqual(['toxin', 'toxinReroll', 'injury'])
    expect(eventsOf(ctx.events, 'WoundRolled')[0]).toMatchObject({ roll: 4, wounded: true })
    expect(hookFireCount('poisonBlood')).toBe(1)
    // without the rule the 1 stands
    const plain = hitCtx(duel({ weapons: ['atk.w.toxin'] }), [1])
    resolveHit(plain.ctx, hit('B3', { strength: 0, damage: { kind: 'none' }, traits: [trait('toxin')], weaponId: 'atk.w.toxin' }))
    expect(eventsOf(plain.ctx.events, 'WoundRolled')[0]).toMatchObject({ roll: 1, wounded: false })
    // a failed 2 is not re-rolled
    const two = hitCtx(duel({ weapons: ['atk.w.toxin'], a: { rules: ['esc.r.poison-blood'] } }), [2])
    resolveHit(two.ctx, hit('B3', { strength: 0, damage: { kind: 'none' }, traits: [trait('toxin')], weaponId: 'atk.w.toxin' }))
    expect(eventsOf(two.ctx.events, 'WoundRolled')[0]).toMatchObject({ roll: 2, wounded: false })
    // the odds: T3 passes on 3+ (4/6); the re-roll adds a sixth of that
    expect(query.woundChance(duel({ weapons: ['atk.w.toxin'] }), 'A3', 'atk.w.toxin', 'std', 'B3')).toBeCloseTo(4 / 6, 6)
    expect(query.woundChance(duel({ weapons: ['atk.w.toxin'], a: { rules: ['esc.r.poison-blood'] } }), 'A3', 'atk.w.toxin', 'std', 'B3')).toBeCloseTo(4 / 6 + 4 / 36, 6)
    // in a game: hit 6, Toxin roll 1 re-rolled to 4, then the Injury die
    resetFireCounts()
    const r = shootB3(duel({ weapons: ['atk.w.toxin'], a: { rules: ['esc.r.poison-blood'] } }), dice(6, 1, 4, 1))
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ roll: 4, wounded: true })
    expect(hookFireCount('poisonBlood')).toBe(1)
  })

  it('SKL-025 every passive code hook is registered, validates the params the data gives it, and rejects params that miss what it needs', () => {
    const names = new Set(registeredCodeHooks())
    for (const n of PASSIVE_CODE_HOOKS) expect(names.has(n), n).toBe(true)
    const seen = new Set<string>()
    for (const rec of [...Object.values(real.skills), ...Object.values(real.wargear)]) {
      const use = codeUseOf(rec, rec.id)
      if (!use || !(PASSIVE_CODE_HOOKS as readonly string[]).includes(use.name)) continue
      seen.add(use.name)
      expect(checkCodeParams(use.name, use.params), `${rec.id} ${use.name}`).toBeNull()
    }
    // every hook is used by a data record
    expect([...seen].sort()).toEqual([...PASSIVE_CODE_HOOKS].sort())
    expect(checkCodeParams('gasToughnessBonus', {})).toMatch(/value/)
    expect(checkCodeParams('stimmSlugStash', {})).toMatch(/modifiers/)
    expect(checkCodeParams('combatChemsStash', {})).toMatch(/table/)
  })
})

/** The End-phase test game (end.test.ts): five fighters a side, far apart, round 1's Action phase. */
function endGame(): GameState {
  const s = startGame({ bundle: attackBundle }).state
  const apart: Record<string, { x: number; z: number }> = {}
  ;['A', 'B'].forEach((seat, i) => ['1', '2', '3', '4', '5'].forEach((n, k) => (apart[seat + n] = { x: -10 + k * 5, z: i === 0 ? -16 : 16 })))
  return place(s, apart)
}
