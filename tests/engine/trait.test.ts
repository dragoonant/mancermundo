import { describe, expect, it } from 'vitest'
import { act, query, step } from '@/engine'
import { hasLos } from '@/engine/los'
import { runHook } from '@/engine/hooks'
import { resolveHit, type HitInput } from '@/engine/hits'
import { stat } from '@/engine/query'
import { clearSmoke } from '@/engine/traits'
import { dice, hitCtx, shootingGame } from '../fixtures/attack'
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
    // hit 5; Firepower 4 (2 holes) + 6 (3 holes) = 5 hits, all on the only target; five wound rolls of 1
    const r = must(take(s, { targetId: 'B3' }, dice(5, 4, 6, 1, 1, 1, 1, 1)))
    expect(eventsOf(r.events, 'FirepowerRolled')[0]).toMatchObject({ faces: ['hit2', 'hit3'], hits: 5, ammoSymbols: 0 })
    expect(eventsOf(r.events, 'WoundRolled')).toHaveLength(5)
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
    let r = must(take(s, { targetId: 'B3' }, dice(5, 2, 4)))
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
    const r = must(take(s, { targetId: 'B3' }, dice(5, 1, 1, 1, 1, 1, 1)))
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
