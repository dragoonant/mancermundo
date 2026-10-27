import { describe, expect, it } from 'vitest'
import { applyDamage, applyInjuries, resolveHit, type HitInput } from '@/engine/hits'
import { woundNeed } from '@/engine/dice'
import { armourSave } from '@/engine/wargear'
import { stat } from '@/engine/query'
import { dice, hitCtx, shootingGame } from '../fixtures/attack'
import { edit, eventsOf, must, take } from '../fixtures/helpers'
import type { GameState } from '@/engine'

const base = (): GameState => shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 0 }, B4: { x: 2, z: 0 } } })

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

describe('INJ: wounds, saves, injuries (R-11)', () => {
  it('INJ-001 wound table: S6 vs T3 2+, S4 vs T3 3+, S3 vs T3 4+, S3 vs T4 5+, S2 vs T4 6+', () => {
    expect([woundNeed(6, 3), woundNeed(4, 3), woundNeed(3, 3), woundNeed(3, 4), woundNeed(2, 4)]).toEqual([2, 3, 4, 5, 6])
    // and the roll uses it: S4 against T3 wounds on a 3
    const { ctx } = hitCtx(base(), [3, 1, 1])
    resolveHit(ctx, hit('B4', { strength: 4, saves: false }))
    expect(eventsOf(ctx.events, 'WoundRolled')[0]).toMatchObject({ need: 3, wounded: true })
  })

  it('INJ-002 AP -1 turns a 4+ save into 5+; a natural 1 save always fails', () => {
    const s = edit(base(), (d) => {
      d.fighters.B4!.wargear = ['atk.g.carapace']
      d.fighters.B3!.wargear = ['atk.g.great']
    })
    expect(armourSave(s, s.fighters.B4!, { ap: 0 }).need).toBe(4)
    expect(armourSave(s, s.fighters.B4!, { ap: -1 }).need).toBe(5)
    // B3 saves on 2+: a natural 1 still fails (wound 6, save 1, then the Injury dice: a Flesh Wound)
    const { ctx } = hitCtx(s, [6, 1, 1])
    resolveHit(ctx, hit('B3'))
    expect(eventsOf(ctx.events, 'SaveRolled')[0]).toMatchObject({ roll: 1, need: 2, saved: false, item: 'atk.g.great' })
    expect(eventsOf(ctx.events, 'DamageInflicted')).toHaveLength(1)
  })

  it('INJ-003 Damage 2 on a 1-W fighter removes the wound and rolls 2 Injury dice', () => {
    const { ctx } = hitCtx(base(), [1, 2])
    const t = ctx.state.fighters.B4!
    applyDamage(ctx, t, 2, who)
    expect(t.wounds).toBe(0)
    expect(eventsOf(ctx.events, 'InjuryRolled')[0]!.faces).toHaveLength(2)
    expect(t.fleshWounds).toBe(2)
  })

  it('INJ-004 a fighter at 0 W (after a Flesh Wound) hit for Damage 1 rolls 1 Injury die', () => {
    const s = edit(base(), (d) => {
      d.fighters.B4!.wounds = 0
      d.fighters.B4!.fleshWounds = 1
    })
    const { ctx } = hitCtx(s, [2])
    applyDamage(ctx, ctx.state.fighters.B4!, 1, who)
    expect(eventsOf(ctx.events, 'InjuryRolled')[0]!.faces).toEqual(['fleshWound'])
    expect(ctx.state.fighters.B4!.fleshWounds).toBe(2)
  })

  it('INJ-005 two Seriously Injured results from one roll: the fighter is Seriously Injured and takes one Flesh Wound', () => {
    const { ctx } = hitCtx(base(), [3, 4])
    const t = ctx.state.fighters.B4!
    applyDamage(ctx, t, 2, who)
    expect(t.posture).toBe('seriouslyInjured')
    expect(t.fleshWounds).toBe(1)
    expect(eventsOf(ctx.events, 'InjuryRolled')[0]).toMatchObject({ faces: ['seriouslyInjured', 'seriouslyInjured'], applied: 'seriouslyInjured' })
    expect(ctx.state.casualties).toContainEqual(expect.objectContaining({ fighterId: 'B4', by: 'A3', kind: 'seriouslyInjured' }))
    // the friend within 3" owes a nerve test (queued; resolved from S3b)
    expect(ctx.state.nerve).toContainEqual({ fighterId: 'B3', reason: 'seriouslyInjured:B4' })
  })

  it('INJ-006 any Out of Action result in a roll removes the fighter; other dice in that roll are ignored', () => {
    const { ctx } = hitCtx(base(), [3, 6, 1])
    const t = ctx.state.fighters.B4!
    applyDamage(ctx, t, 3, who)
    expect(t.location).toBe('outOfAction')
    expect(t.posture).toBe('standing')
    expect(t.fleshWounds).toBe(0)
    expect(eventsOf(ctx.events, 'FleshWound')).toHaveLength(0)
    expect(eventsOf(ctx.events, 'FighterOutOfAction')[0]).toMatchObject({ fighterId: 'B4', by: 'A3' })
  })

  it('INJ-007 a Flesh Wound lowers T by 1; T reaching 0 is Out of Action', () => {
    const { ctx } = hitCtx(base(), [])
    const t = ctx.state.fighters.B4!
    applyInjuries(ctx, t, ['fleshWound'], 'A3', 'test')
    expect(stat(ctx.state, 'B4', 'T')).toBe(2)
    expect(t.location).toBe('board')
    applyInjuries(ctx, t, ['fleshWound', 'fleshWound'], 'A3', 'test')
    expect(t.fleshWounds).toBe(3)
    expect(t.location).toBe('outOfAction')
    expect(t.downedBy).toMatchObject({ cause: 'fleshWounds' })
  })

  it('INJ-008 a Seriously Injured result on an already Seriously Injured fighter gives a Flesh Wound only', () => {
    const s = edit(base(), (d) => {
      d.fighters.B4!.posture = 'seriouslyInjured'
      d.fighters.B4!.wounds = 0
    })
    const { ctx } = hitCtx(s, [4])
    applyDamage(ctx, ctx.state.fighters.B4!, 1, who)
    expect(ctx.state.fighters.B4!.fleshWounds).toBe(1)
    expect(eventsOf(ctx.events, 'StatusChanged')).toHaveLength(0)
    expect(ctx.state.casualties).toHaveLength(0)
  })

  it('INJ-009 a Melta hit at Short range that reduces the target to 0 W is Out of Action with no Injury roll; at Long range it rolls normally', () => {
    const at = (z: number) => {
      const r = must(take(shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z } }, loadouts: { A3: { weapons: ['atk.w.melta'] } }, active: 'A3' }), { action: 'shoot' }))
      return r.state
    }
    // Short: hit 6, wound 5 (S8 vs T3: 2+), no save roll (flak 5+ at AP -4), Damage 3 at 0 W -> Out of Action
    const short = must(take(at(0), { targetId: 'B3' }, dice(6, 5)))
    expect(short.state.fighters.B3!.location).toBe('outOfAction')
    expect(eventsOf(short.events, 'DiceRolled').some((d) => d.die === 'injury')).toBe(false)
    expect(eventsOf(short.events, 'InjuryRolled')[0]!.faces).toEqual(['outOfAction', 'outOfAction', 'outOfAction'])
    // Long (8"): hit 6, wound 5, three Injury dice: Flesh Wound, Flesh Wound, Seriously Injured
    const long = must(take(at(-6 + 8 + 2 * 0.492), { targetId: 'B3' }, dice(6, 5, 1, 1, 3)))
    expect(eventsOf(long.events, 'DiceRolled').find((d) => d.die === 'injury')!.dice).toEqual([1, 1, 3])
    expect(long.state.fighters.B3!).toMatchObject({ posture: 'seriouslyInjured', fleshWounds: 2, location: 'board' })
  })
})

describe('INJ: a positive AP (13-gangs 4.5)', () => {
  it('INJ-010 AP +1 makes the save one easier (the Goliath maul prints S, AP +1, D2)', async () => {
    const s = edit(base(), (d) => {
      d.fighters.B4!.wargear = ['atk.g.carapace']
    })
    expect(armourSave(s, s.fighters.B4!, { ap: 1 }).need).toBe(3)
    const { realBundle } = await import('../fixtures/real')
    const maul = realBundle().weapons['gol.w.maul']!.profiles[0]!
    expect(maul).toMatchObject({ str: { base: 'user', value: 0 }, ap: 1, dmg: { kind: 'fixed', value: 2 } })
  })
})
