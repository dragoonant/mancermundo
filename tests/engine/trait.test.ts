import { describe, expect, it } from 'vitest'
import { act, query, step } from '@/engine'
import { hasLos } from '@/engine/los'
import { runHook } from '@/engine/hooks'
import { resolveHit, type HitInput } from '@/engine/hits'
import { stat } from '@/engine/query'
import { clearSmoke } from '@/engine/traits'
import { hitCtx, shootingGame } from '../fixtures/attack'
import { answer, dice, meleeGame, optionWhere, R as RADIUS, TOUCH, type MeleeOpts } from '../fixtures/melee'
import { attackDiceFor } from '@/engine/fight'
import { edit, eventsOf, menuActions, must, take } from '../fixtures/helpers'
import type { GameState } from '@/engine'

const R = 0.492

function aimAt(s: GameState, weapon: string, spots: Parameters<typeof shootingGame>[0]['spots'], board?: string): GameState {
  const g = shootingGame({ ...(board ? { board } : {}), spots, loadouts: { A3: { weapons: [weapon] } }, active: 'A3' })
  void s
  return must(take(g, { action: 'shoot' })).state
}

const open = { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 } }

describe('TRAIT: weapon traits used by shooting (R-14.3)', () => {
  it('TRAIT-001 Rapid Fire (2) on a hit rolls up to 2 Firepower dice and scores hits equal to total bullet holes', () => {
    const s = aimAt({} as GameState, 'atk.w.rf2', open)
    // the shooter first picks 1 or 2 Firepower dice, with the engine's odds on each
    const ask = must(take(s, { targetId: 'B3' }))
    expect(ask.pending!.kind).toBe('shoot.firepower')
    expect(ask.pending!.options!.map((o) => (o.action.payload as { dice: number }).dice)).toEqual([1, 2])
    const [one, two] = ask.pending!.options!.map((o) => o.data as { expectedHits: number; outOfAmmo: number; jam: number })
    expect(two!.expectedHits).toBeCloseTo(2 * one!.expectedHits, 6)
    expect(one!.jam).toBe(0)
    expect(two!.jam).toBeGreaterThan(0)
    expect(two!.outOfAmmo).toBeGreaterThan(one!.outOfAmmo)
    // two dice: hit 5; Firepower 4 (2 holes) + 6 (3 holes) = 5 hits, all on the only target; five wound rolls of 1
    const r = must(step(ask.state, act.firepower(ask.pending!, 2), dice(5, 4, 6, 1, 1, 1, 1, 1)))
    expect(eventsOf(r.events, 'FirepowerRolled')[0]).toMatchObject({ faces: ['hit2', 'hit3'], hits: 5, ammoSymbols: 0 })
    expect(eventsOf(r.events, 'WoundRolled')).toHaveLength(5)
    // one die: hit 5; Firepower 6 (3 holes) = 3 hits
    const r1 = must(step(ask.state, act.firepower(ask.pending!, 1), dice(5, 6, 1, 1, 1)))
    expect(eventsOf(r1.events, 'FirepowerRolled')[0]).toMatchObject({ faces: ['hit3'], hits: 3 })
    expect(eventsOf(r1.events, 'WoundRolled')).toHaveLength(3)
    // three dice is not an option, and the choice cannot be passed
    expect(step(ask.state, act.firepower(ask.pending!, 3)).rejection?.code).toBe('E_NOT_AN_OPTION')
    expect(step(ask.state, act.pass(ask.pending!)).rejection?.code).toBe('E_PASS_NOT_ALLOWED')
  })

  it('TRAIT-002 Rapid Fire extra hits may go only to enemies within 3 inches of the original target that are not harder to hit', () => {
    const s = aimAt({} as GameState, 'atk.w.rf2', {
      A3: { x: 0, z: -8, facing: 0 },
      B3: { x: -3, z: -2 },
      B4: { x: -1.6, z: -0.9 },
      B2: { x: -1, z: 0.9 },
      B5: { x: 4, z: -2 },
    }, 'test.barricade')
    const t = Object.fromEntries(query.shootTargets(s, 'A3', 'atk.w.rf2', 'std').map((x) => [x.targetId, x]))
    expect(t.B3!.priority).toBe('closest')
    expect(t.B2!.need).toBeGreaterThan(t.B3!.need) // behind the barricade
    // hit 5; Firepower 2 + 4 = 3 holes: two extra hits to allocate
    let r = must(take(s, { targetId: 'B3' }))
    r = must(step(r.state, act.firepower(r.pending!, 2), dice(5, 2, 4)))
    expect(r.pending!.kind).toBe('shoot.allocate')
    expect(r.pending!.options!.map((o) => o.id).sort()).toEqual(['t:B3', 't:B4'])
    r = must(take(r.state, { targetId: 'B4' }))
    r = must(take(r.state, { targetId: 'B3' }, dice(1, 1, 1)))
    expect(eventsOf(r.events, 'FighterPinned').map((e) => e.fighterId)).toEqual(['B4'])
    expect(eventsOf(r.events, 'WoundRolled').map((e) => e.targetId)).toEqual(['B3', 'B4', 'B3'])
  })

  it('TRAIT-003 Rapid Fire with two failed Ammo tests jams the weapon for the battle (Reload rejected)', () => {
    const s = aimAt({} as GameState, 'atk.w.rf2', open)
    // hit 5; Firepower 1 + 1 (two Ammo symbols, 2 holes); Ammo tests 1, 1; wounds 1, 1
    const ask = must(take(s, { targetId: 'B3' }))
    const r = must(step(ask.state, act.firepower(ask.pending!, 2), dice(5, 1, 1, 1, 1, 1, 1)))
    expect(eventsOf(r.events, 'AmmoTest').map((e) => e.passed)).toEqual([false, false])
    expect(r.state.fighters.A3!.weapons[0]!.ammo).toBe('jammed')
    expect(menuActions(r.state)).not.toContain('reload')
    const refused = step(r.state, act.choose(r.pending!, 'reload', { weaponId: 'atk.w.rf2' }))
    expect(refused.rejection).toBeDefined()
  })

  it('TRAIT-004 Knockback with a hit roll >= target S pushes 1 inch; blocked by a wall adds +1 Damage', () => {
    const s = aimAt({} as GameState, 'atk.w.knock', open)
    // hit 4 (>= S3): pushed 1" straight away; wound 1
    const r = must(take(s, { targetId: 'B3' }, dice(4, 1)))
    const moved = eventsOf(r.events, 'FighterMoved').find((e) => e.kind === 'knockback')!
    expect(moved.length).toBeCloseTo(1, 2)
    expect(r.state.fighters.B3!.pos.z).toBeCloseTo(1, 2)
    // a hit roll below S does not push
    const r2 = must(take(edit(s, (d) => (d.fighters.B3!.stats.S = 5)), { targetId: 'B3' }, dice(4, 1)))
    expect(eventsOf(r2.events, 'KnockedBack')).toHaveLength(0)
    // against a wall: no room, +1 Damage (wound 5, flak save 1 fails, 2 Damage on 1 W: two Injury dice)
    const w = aimAt({} as GameState, 'atk.w.knock', { A3: { x: 4, z: -8, facing: 0 }, B3: { x: 4, z: -0.75 } }, 'test.door')
    const r3 = must(take(w, { targetId: 'B3' }, dice(4, 5, 1, 1, 2)))
    expect(eventsOf(r3.events, 'KnockedBack')).toHaveLength(1)
    expect(eventsOf(r3.events, 'DamageInflicted')[0]).toMatchObject({ amount: 2 })
    expect(eventsOf(r3.events, 'InjuryRolled')[0]!.faces).toHaveLength(2)
  })

  it('TRAIT-005 Gas: no save, no pinning, injury on D6 >= T; Toxin: same test but saves allowed', () => {
    const g = aimAt({} as GameState, 'atk.w.gas', open)
    // hit 5; gas 3 (>= T3): an Injury dice (1: Flesh Wound) with no save roll and no pinning
    const r = must(take(g, { targetId: 'B3' }, dice(5, 3, 1)))
    expect(eventsOf(r.events, 'FighterPinned')).toHaveLength(0)
    expect(eventsOf(r.events, 'SaveRolled')).toHaveLength(0)
    expect(eventsOf(r.events, 'InjuryRolled')[0]!.faces).toEqual(['fleshWound'])
    expect(r.state.fighters.B3!.wounds).toBe(1) // Wounds untouched
    const miss = must(take(g, { targetId: 'B3' }, dice(5, 2)))
    expect(eventsOf(miss.events, 'InjuryRolled')).toHaveLength(0)
    const t = aimAt({} as GameState, 'atk.w.toxin', open)
    // hit 5 (pinned); toxin 3 passes; flak 5+ save 5 holds: no Injury dice
    const r2 = must(take(t, { targetId: 'B3' }, dice(5, 3, 5)))
    expect(eventsOf(r2.events, 'FighterPinned')).toHaveLength(1)
    expect(eventsOf(r2.events, 'SaveRolled')[0]).toMatchObject({ saved: true })
    expect(eventsOf(r2.events, 'InjuryRolled')).toHaveLength(0)
  })

  it('TRAIT-010 Blaze: a hit target not taken Out of Action catches fire on 4+', () => {
    const s = aimAt({} as GameState, 'atk.w.blaze', open)
    const lit = must(take(s, { targetId: 'B3' }, dice(5, 1, 4)))
    expect(eventsOf(lit.events, 'CaughtFire')[0]).toMatchObject({ targetId: 'B3' })
    expect(lit.state.fighters.B3!.conditions.blaze).toBeDefined()
    const not = must(take(s, { targetId: 'B3' }, dice(5, 1, 3)))
    expect(not.state.fighters.B3!.conditions.blaze).toBeUndefined()
    // a target taken Out of Action by the hit does not roll for Blaze
    const { ctx } = hitCtx(s, [6, 6])
    resolveHit(ctx, { ...baseHit('B3'), traits: [{ trait: 'core.t.blaze' }], saves: false })
    expect(ctx.state.fighters.B3!.location).toBe('outOfAction')
    expect(eventsOf(ctx.events, 'DiceRolled').map((d) => d.purpose)).toEqual(['wound', 'injury'])
  })

  it('TRAIT-011 a Smoke cloud blocks line of sight through it and is removed in the End phase on 1-4', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 6 } }, loadouts: { A3: { weapons: ['atk.w.smoke'] } }, active: 'A3' })
    let r = must(take(s, { action: 'shoot' }))
    r = must(take(r.state, { point: true }))
    r = must(step(r.state, act.aim(r.pending!, { x: 0, z: 0 }), dice(5)))
    expect(eventsOf(r.events, 'SmokePlaced')[0]).toMatchObject({ pos: { x: 0, z: 0 }, radius: 2.5 })
    expect(eventsOf(r.events, 'WoundRolled')).toHaveLength(0)
    expect(hasLos(r.state, r.state.fighters.A3!, r.state.fighters.B3!)).toBe(false)
    // End phase clean-up (the phase.end hook): 4 removes it, 5 keeps it
    const stays = hitCtx(r.state, [5])
    runHook('phase.end', { seat: 'A', state: stays.ctx.state, engine: stays.ctx, data: { name: 'end' } })
    expect(stays.ctx.state.board.smoke).toHaveLength(1)
    const goes = hitCtx(r.state, [4])
    clearSmoke(goes.ctx)
    expect(goes.ctx.state.board.smoke).toHaveLength(0)
    expect(eventsOf(goes.ctx.events, 'SmokeCleared')).toHaveLength(1)
  })
})

function baseHit(target: string): HitInput {
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
  }
}

describe('Other shooting traits (R-14.3)', () => {
  it('Flash: no wound roll; a failed Initiative test Blinds the target, which loses Ready and makes no attacks until it activates', () => {
    const s = aimAt({} as GameState, 'atk.w.flash', open)
    const r = must(take(s, { targetId: 'B3' }, dice(5, 1)))
    expect(eventsOf(r.events, 'WoundRolled')).toHaveLength(0)
    expect(r.state.fighters.B3!.conditions.blind).toBeDefined()
    expect(r.state.fighters.B3!.ready).toBe(false)
  })

  it('Concussion: -2 Initiative (no worse than 6+) until the end of the round', () => {
    const s = aimAt({} as GameState, 'atk.w.concussion', open)
    const r = must(take(s, { targetId: 'B3' }, dice(5, 1)))
    expect(stat(r.state, 'B3', 'I')).toBe(6)
    const { ctx } = hitCtx(r.state, [])
    runHook('round.end', { seat: 'A', state: ctx.state, engine: ctx })
    expect(ctx.state.fighters.B3!.conditions.concussion).toBeUndefined()
  })

  it('Scattershot makes D6 wound rolls; Shred doubles AP and Rending adds 1 Damage on a natural 6 to wound', () => {
    const sc = hitCtx(shootingGame({ spots: open }), [3, 1, 1, 1])
    resolveHit(sc.ctx, { ...baseHit('B3'), traits: [{ trait: 'core.t.scattershot' }] })
    expect(eventsOf(sc.ctx.events, 'WoundRolled')).toHaveLength(3)
    const base = edit(shootingGame({ spots: open }), (d) => (d.fighters.B3!.wargear = ['atk.g.carapace']))
    const sh = hitCtx(base, [6, 6, 1])
    resolveHit(sh.ctx, { ...baseHit('B3'), ap: -1, traits: [{ trait: 'core.t.shred' }] })
    expect(eventsOf(sh.ctx.events, 'SaveRolled')[0]).toMatchObject({ need: 6, roll: 6, saved: true }) // 4+ at AP -2
    const re = hitCtx(edit(base, (d) => (d.fighters.B3!.wargear = [])), [6, 1, 1])
    resolveHit(re.ctx, { ...baseHit('B3'), traits: [{ trait: 'core.t.rending' }] })
    expect(eventsOf(re.ctx.events, 'DamageInflicted')[0]).toMatchObject({ amount: 2 })
  })

  it('wargear: front-arc plates, flak against blasts and templates, an undersuit on no armour (7+ improved)', () => {
    const s = edit(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0, facing: Math.PI } } }), (d) => {
      d.fighters.B3!.wargear = ['atk.g.plates']
    })
    expect(query.saveChance(s, 'B3', 0, { fromId: 'A3' }).need).toBe(5) // A3 is in front of B3
    const back = edit(s, (d) => (d.fighters.B3!.facing = 0))
    expect(query.saveChance(back, 'B3', 0, { fromId: 'A3' }).need).toBe(6)
    const flak = edit(s, (d) => (d.fighters.B3!.wargear = ['atk.g.flak']))
    expect(query.saveChance(flak, 'B3', 0, { vs: 'template' }).need).toBe(5)
    expect(query.saveChance(flak, 'B3', 0).need).toBe(6)
    const suit = edit(s, (d) => (d.fighters.B3!.wargear = ['atk.g.undersuit']))
    expect(query.saveChance(suit, 'B3', 0).need).toBe(6)
    const both = edit(s, (d) => (d.fighters.B3!.wargear = ['atk.g.carapace', 'atk.g.undersuit']))
    expect(query.saveChance(both, 'B3', -1).need).toBe(4)
  })

  it('a door closing on a fighter now resolves its S3 Damage 2 hit through the real resolver (S2 port)', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: 0 } } })
    const { ctx } = hitCtx(s, [6, 1, 1, 1])
    resolveHit(ctx, { ...baseHit('A3'), attackerId: null, damage: { kind: 'fixed', value: 2 }, cause: 'door' })
    expect(eventsOf(ctx.events, 'DamageInflicted')[0]).toMatchObject({ amount: 2 })
    void R
  })
})

describe('TRAIT: close-combat traits (R-14.3, S3b)', () => {
  const N = 0
  const S = Math.PI
  const pair = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + TOUCH, facing: S } }

  /** A3 armed with `weapon` fights B3: answer the weapon choice with that weapon and script every die. */
  function fightWith(weapon: string, rolls: number[], opts: Partial<MeleeOpts> = {}) {
    const s = meleeGame({ spots: pair, ...opts, loadouts: { A3: { weapons: [weapon] }, ...(opts.loadouts ?? {}) }, active: 'A3' })
    const rng = dice(...rolls)
    let r = must(step(s, optionWhere(s, { action: 'fight' }), rng))
    if (r.pending!.kind === 'fight.weapons') r = must(answer(r.state, optionWhere(r.state, { weaponIds: [weapon] }), rng))
    expect(rng.remaining).toBe(0)
    return r
  }

  it('TRAIT-006 Power: a natural 6 to hit ignores the armour save and adds +1 Damage', () => {
    const tough = (d: GameState) => {
      d.fighters.B3!.wounds = 3
      d.fighters.B3!.maxWounds = 3
    }
    const armour = { B3: { wargear: ['atk.g.carapace'] } }
    // hit 6, wound 3 (S4 vs T3 needs 3+), no save, 2 Damage; B3 reacts unarmed (1)
    const six = fightWith('cc.w.power', [6, 3, 1], { loadouts: armour, tweak: tough })
    expect(eventsOf(six.events, 'SaveRolled')).toHaveLength(0)
    expect(eventsOf(six.events, 'DamageInflicted')[0]).toMatchObject({ targetId: 'B3', amount: 2, wounds: 1 })
    // a 5 to hit: the carapace save (4+, AP -1: 5+) is rolled and passes on a 5
    const five = fightWith('cc.w.power', [5, 3, 5, 1], { loadouts: armour, tweak: tough })
    expect(eventsOf(five.events, 'SaveRolled')[0]).toMatchObject({ need: 5, saved: true })
    expect(eventsOf(five.events, 'DamageInflicted')).toHaveLength(0)
  })

  it('TRAIT-007 Shock: a natural 6 to hit wounds without a wound roll', () => {
    // hit 6 (automatic wound), Injury dice 1 (Flesh Wound), B3 reacts (1)
    const r = fightWith('cc.w.shock', [6, 1, 1])
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'B3', wounded: true, auto: true })
    expect(r.events.filter((e) => e.type === 'DiceRolled' && e.purpose === 'wound')).toHaveLength(0)
    expect(r.state.fighters.B3!.fleshWounds).toBe(1)
  })

  it('TRAIT-008 Unwieldy: Shoot with it costs both actions; in melee no second weapon is allowed', () => {
    const shooter = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: 0, facing: S } }, loadouts: { A3: { weapons: ['atk.w.heavy'] } }, active: 'A3' })
    expect(query.shootOptions(shooter, 'A3')[0]).toMatchObject({ weaponId: 'atk.w.heavy', cost: 'double' })
    const s = meleeGame({ spots: pair, loadouts: { A3: { weapons: ['cc.w.maul', 'cc.w.knife'] } }, active: 'A3' })
    const r = must(step(s, optionWhere(s, { action: 'fight' })))
    const combos = r.pending!.options!.map((o) => (o.action.payload as { weaponIds: string[] }).weaponIds)
    expect(combos).toEqual([['cc.w.maul'], ['cc.w.knife'], []])
    // two ordinary weapons do pair (+1 attack die for dual wielding)
    const two = meleeGame({ spots: pair, loadouts: { A3: { weapons: ['cc.w.knife', 'cc.w.blade'] } }, active: 'A3' })
    const r2 = must(step(two, optionWhere(two, { action: 'fight' })))
    expect(r2.pending!.options![0]!.action.payload).toEqual({ weaponIds: ['cc.w.knife', 'cc.w.blade'] })
    expect(r2.pending!.options![0]!.data).toMatchObject({ dice: 2 })
  })

  it('TRAIT-009 Versatile: a charger may stop at Versatile reach and fight; the target cannot react unless it also has Versatile reach', () => {
    const spots = { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 2 * RADIUS + 6, facing: S } }
    const s = meleeGame({ spots, loadouts: { A3: { weapons: ['cc.w.whip'] } }, active: 'A3' })
    const opt = s.pending!.options!.find((o) => o.id === 'charge:B3:cc.w.whip')!
    expect(opt.data).toMatchObject({ pReach: 1 })
    expect(opt.data!.cost as number).toBeCloseTo(3, 2)
    const r = must(answer(s, opt.action, dice(1, 1, 1))) // D3, two charge dice with the whip
    expect(query.distance(r.state, 'A3', 'B3')).toBeCloseTo(3, 2)
    expect(eventsOf(r.events, 'FightStarted')[0]).toMatchObject({ weapons: ['cc.w.whip'], dice: 2, charge: true })
    expect(eventsOf(r.events, 'ReactionStarted')).toHaveLength(0)
    expect(r.state.fighters.A3!.engagedWith).toEqual([])
    // a target with a whip of its own strikes back at reach
    const both = meleeGame({ spots, loadouts: { A3: { weapons: ['cc.w.whip'] }, B3: { weapons: ['cc.w.whip'] } }, active: 'A3' })
    const r2 = must(answer(both, optionWhere(both, { action: 'charge', targetId: 'B3', weaponId: 'cc.w.whip' }), dice(1, 1, 1, 1)))
    expect(eventsOf(r2.events, 'ReactionStarted').map((e) => e.fighterId)).toEqual(['B3'])
    // a Standing Active fighter can Fight an enemy within its whip's reach without charging
    const near = meleeGame({ spots: { A3: { x: 0, z: -10, facing: N }, B3: { x: 0, z: -10 + 2 * RADIUS + 2, facing: S } }, loadouts: { A3: { weapons: ['cc.w.whip'] } }, active: 'A3' })
    expect(near.pending!.options!.some((o) => o.id === 'fight:cc.w.whip')).toBe(true)
  })

  it('Paired, Backstab, Sever, Pulverise, Disarm and Entangle', () => {
    const s = meleeGame({ spots: pair, loadouts: { A3: { weapons: ['cc.w.paired'] } } })
    const a3 = s.fighters.A3!
    // Paired: dual weapons (+1), and the base A doubles on a charge (+1 charge): 1 -> 2, charging 1 x 2 + 1 + 1 = 4
    expect(attackDiceFor(s, a3, ['cc.w.paired'], false)).toBe(2)
    expect(attackDiceFor(s, a3, ['cc.w.paired'], true)).toBe(4)
    // Backstab: +1 S from outside the target's arc (S4 vs T3 wounds on 3+)
    const behind = fightWith('cc.w.backstab', [6, 1, 1], { spots: { ...pair, B3: { ...pair.B3, facing: N } } })
    expect(eventsOf(behind.events, 'WoundRolled')[0]).toMatchObject({ need: 3 })
    const front = fightWith('cc.w.backstab', [6, 1, 1])
    expect(eventsOf(front.events, 'WoundRolled')[0]).toMatchObject({ need: 4 })
    // Sever: every Injury dice is Out of Action (none rolled)
    const sever = fightWith('cc.w.sever', [6, 6])
    expect(sever.state.fighters.B3!.location).toBe('outOfAction')
    expect(sever.events.filter((e) => e.type === 'DiceRolled' && e.purpose === 'injury')).toHaveLength(0)
    // Pulverise: a Flesh Wound becomes Seriously Injured on D6 >= T
    const pulv = fightWith('cc.w.pulverise', [6, 6, 1, 3])
    expect(pulv.state.fighters.B3!.posture).toBe('seriouslyInjured')
    expect(pulv.state.fighters.B3!.fleshWounds).toBe(0)
    // Disarm: a natural 6 leaves the target only unarmed reaction attacks (its knife is not offered)
    const disarm = fightWith('cc.w.disarm', [6, 1, 1], { loadouts: { B3: { weapons: ['cc.w.knife'] } } })
    expect(disarm.state.fighters.B3!.conditions.disarmed).toBeDefined()
    expect(eventsOf(disarm.events, 'FightHitRolled').find((e) => e.targetId === 'A3')).toMatchObject({ weaponId: 'unarmed' })
    // Entangle: a natural 6 puts the target's reaction attacks at -2
    const ent = fightWith('cc.w.entangle', [6, 1, 1])
    const back = eventsOf(ent.events, 'FightHitRolled').find((e) => e.targetId === 'A3')!
    expect(back.modifiers).toContainEqual({ label: 'entangled', value: -2 })
    expect(back.need).toBe(6)
  })
})

describe('TRAIT: variants and close-combat choices (R-14.2, R-14.3)', () => {
  it('TRAIT-012 Reclaimed/Scavenged: a Plentiful profile loses Plentiful; any other has its Ammo worsened by 1 (at worst 6+)', async () => {
    const { runtimeProfile: runtimeProfileForTest } = await import('@/engine/bundle')
    const base = { id: 'std', name: null, range: { short: 8, long: 24 }, acc: { short: null, long: null }, str: 3, ap: 0, dmg: 1 } as const
    const rec = { trait: 'core.t.reclaimed-scavenged' }
    expect(runtimeProfileForTest({ ...base, ammo: '4+', traits: [rec] }).ammo).toBe(5)
    expect(runtimeProfileForTest({ ...base, ammo: '6+', traits: [rec] }).ammo).toBe(6)
    const plentiful = runtimeProfileForTest({ ...base, ammo: '4+', traits: [{ trait: 'core.t.plentiful' }, rec] })
    expect(plentiful.ammo).toBe(4)
    expect(plentiful.traits.map((t) => t.trait)).toEqual(['core.t.reclaimed-scavenged'])
    expect(runtimeProfileForTest({ ...base, ammo: '4+', traits: [] }).ammo).toBe(4)
  })

  it('TRAIT-013 Knockback in melee: the attacker chooses whether to follow up into base contact; staying put leaves the pair apart', () => {
    const pair = { A3: { x: 0, z: -TOUCH, facing: 0 }, B3: { x: 0, z: 0, facing: Math.PI } }
    const s = meleeGame({ spots: pair, loadouts: { A3: { weapons: ['cc.w.knock'] } }, active: 'A3' })
    // hit 6 (>= S3): B3 is pushed 1" straight back; wound roll 1 fails; then the choice
    const asked = must(answer(s, optionWhere(s, { action: 'fight' }), dice(6, 1)))
    expect(asked.pending!.kind).toBe('fight.followUp')
    expect(asked.pending!.options!.map((o) => o.id)).toEqual(['follow', 'stay'])
    expect(asked.state.fighters.B3!.pos.z).toBeCloseTo(1, 2)
    // follow: A3 moves the same 1" and stays Engaged (B3 then makes its reaction attack: a 1 misses)
    const followed = must(step(asked.state, act.followUp(asked.pending!, true), dice(1)))
    expect(followed.state.fighters.A3!.pos.z).toBeCloseTo(-TOUCH + 1, 2)
    expect(eventsOf(followed.events, 'FollowedUp')[0]).toMatchObject({ fighterId: 'A3', targetId: 'B3', follow: true })
    expect(eventsOf(followed.events, 'ReactionStarted').map((e) => e.fighterId)).toEqual(['B3'])
    // stay: A3 does not move, the two are no longer Engaged and B3 makes no reaction attack
    const stayed = must(step(asked.state, act.followUp(asked.pending!, false)))
    expect(stayed.state.fighters.A3!.pos.z).toBeCloseTo(-TOUCH, 3)
    expect(stayed.state.fighters.A3!.engagedWith).toEqual([])
    expect(eventsOf(stayed.events, 'ReactionStarted')).toHaveLength(0)
    // a hit roll below the target's Strength pushes nobody and asks nothing
    const none = must(answer(s, optionWhere(s, { action: 'fight' }), dice(2, 1)))
    expect(none.pending!.kind).not.toBe('fight.followUp')
  })

  it('TRAIT-014 Versatile while in base contact: enemies within the weapon\'s reach join the targets, but only Versatile dice can reach them', () => {
    const spots = { A3: { x: 0, z: -TOUCH, facing: 0 }, B3: { x: 0, z: 0, facing: Math.PI }, B4: { x: 1.5, z: 1.5, facing: Math.PI } }
    const s = meleeGame({ spots, loadouts: { A3: { weapons: ['cc.w.whip', 'cc.w.knife'] } }, active: 'A3' })
    const r = must(step(s, optionWhere(s, { action: 'fight' })))
    expect(r.pending!.kind).toBe('fight.weapons')
    // the whip alone can split its dice between B3 (base contact) and B4 (at reach)
    const whip = must(step(r.state, optionWhere(r.state, { weaponIds: ['cc.w.whip'] })))
    expect(whip.pending!.kind).toBe('fight.split')
    expect(Object.keys((whip.pending!.options![0]!.action.payload as { split: Record<string, number> }).split).sort()).toEqual(['B3', 'B4'])
    // with the knife in hand as well, B4 drops out: every die goes to B3
    const both = must(step(r.state, optionWhere(r.state, { weaponIds: ['cc.w.whip', 'cc.w.knife'] }), dice(1, 1, 1, 1, 1, 1)))
    expect(Object.keys(eventsOf(both.events, 'AttackDiceSplit').find((e) => e.attackerId === 'A3')!.split)).toEqual(['B3'])
  })
})
