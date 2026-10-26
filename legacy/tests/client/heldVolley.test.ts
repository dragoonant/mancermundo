// The held shooting volley: dice first, then the tracers; which landing plays what and when the volley fires.
import { describe, expect, it } from 'vitest'
import { finalKinds, heldItemOf, holdVerdict, planLandings, rerollKinds, type DieKind, type HeldItem } from '@/client/presentation/heldVolley'
import { impactTimes } from '@/client/vfx/api'

const dmg = (id = 'B1'): HeldItem => ({ kind: 'damage', operativeId: id })

describe('held volley: landings', () => {
  it('a blocked success shimmers on its tracer, an unblocked one carries the damage, a miss does nothing', () => {
    const kinds: DieKind[] = ['crit', 'normal', 'fail', 'normal']
    // one crit and one normal get through, one normal is saved
    const block = { blockedNormal: 1, blockedCrit: 0, unblockedNormal: 1, unblockedCrit: 1 }
    const plan = planLandings(kinds, block, [dmg(), dmg()])
    expect(plan.shots.map((s) => s.outcome).filter((o) => o === 'miss')).toHaveLength(1)
    expect(plan.shots[2]!.outcome).toBe('miss')
    expect(plan.shots.filter((s) => s.outcome === 'blocked')).toHaveLength(1)
    const damaging = plan.shots.filter((s) => s.outcome === 'damage')
    expect(damaging).toHaveLength(2)
    // damage events go to the unblocked shots in tracer order, so wounds only ever count down
    expect(damaging.map((s) => s.items)).toEqual([[0], [1]])
    expect(plan.orphanItems).toEqual([])
    expect(plan.orphanBlocked).toBe(0)
  })

  it('an incapacitation lands with the killing shot; extra events and surplus saves play after the last landing', () => {
    const kinds: DieKind[] = ['normal', 'normal']
    const block = { blockedNormal: 0, blockedCrit: 0, unblockedNormal: 2, unblockedCrit: 0 }
    const items: HeldItem[] = [dmg(), dmg(), { kind: 'down', operativeId: 'B1' }, dmg()]
    const plan = planLandings(kinds, block, items)
    expect(plan.shots[0]!.items).toEqual([0])
    expect(plan.shots[1]!.items).toEqual([1, 2])
    expect(plan.orphanItems).toEqual([3])
    // everything blocked: every success shimmers and nothing is left to play; no block counts means all land
    const pair: DieKind[] = ['normal', 'crit']
    const all = planLandings(pair, { blockedNormal: 1, blockedCrit: 1, unblockedNormal: 0, unblockedCrit: 0 }, [])
    expect(all.shots.map((s) => s.outcome)).toEqual(['blocked', 'blocked'])
    // the block reports more saves than there are tracers: the surplus shimmers after the last landing
    expect(planLandings(['normal'], { blockedNormal: 2, blockedCrit: 0, unblockedNormal: 0, unblockedCrit: 0 }, []).orphanBlocked).toBe(1)
    expect(planLandings(pair, null, [dmg(), dmg()]).shots.map((s) => s.outcome)).toEqual(['damage', 'damage'])
  })

  it('tracers follow the final dice: re-rolls change a die, retention turns surplus successes into misses', () => {
    // need 4+: a 5 is a normal, a 2 a fail, a 6 a crit
    expect(rerollKinds(['fail', 'normal', 'fail'], [0, 2], [6, 5], 4, null)).toEqual(['crit', 'normal', 'normal'])
    expect(finalKinds(['crit', 'normal', 'normal', 'fail'], { normal: 1, crit: 1 })).toEqual(['crit', 'normal', 'fail', 'fail'])
    expect(finalKinds(['crit', 'fail'], null)).toEqual(['crit', 'fail'])
    // and each lands at its own time, from the first impact to the last
    expect(impactTimes(3, 0.2, 0.6)).toEqual([0.2, 0.4, 0.6])
    expect(impactTimes(1, 0.2, 0.6)).toEqual([0.2])
    expect(impactTimes(0, 0.2, 0.6)).toEqual([])
  })
})

describe('held volley: when it fires', () => {
  const open = { targetId: 'B1', windowOpen: true, outcomeKnown: true }

  it('holds the target damage and fall once its defence is reached, not before', () => {
    expect(holdVerdict(open, { type: 'DamageInflicted', operativeId: 'B1' })).toBe('hold')
    expect(holdVerdict(open, { type: 'OperativeIncapacitated', operativeId: 'B1' })).toBe('hold')
    expect(holdVerdict({ ...open, windowOpen: false, outcomeKnown: false }, { type: 'DamageInflicted', operativeId: 'B1' })).toBe('play')
    expect(holdVerdict(open, { type: 'DiceBlocked' })).toBe('play')
  })

  it('fires first for the next target, the end of the shot, and any other event once the outcome is known', () => {
    expect(holdVerdict(open, { type: 'TargetSelected' })).toBe('fire-first')
    expect(holdVerdict(open, { type: 'ShootEnded' })).toBe('fire-first')
    expect(holdVerdict(open, { type: 'DamageInflicted', operativeId: 'A1' })).toBe('fire-first') // Hot damage on the shooter
    expect(holdVerdict(open, { type: 'MineTriggered', operativeId: 'B2' })).toBe('fire-first')
    expect(holdVerdict(open, { type: 'PloyUsed' })).toBe('fire-first')
    // mid-dice ploys and windows do not fire it
    const early = { targetId: 'B1', windowOpen: true, outcomeKnown: false }
    expect(holdVerdict(early, { type: 'PloyUsed' })).toBe('play')
    expect(holdVerdict(early, { type: 'DiceRerolled' })).toBe('play')
    expect(holdVerdict(early, { type: 'DiceRolled', purpose: 'shoot.defence' })).toBe('play')
    expect(holdVerdict(open, { type: 'DiceRolled', purpose: 'shoot.hot' })).toBe('fire-first')
    // only damage, injury and fall events are held items
    expect(heldItemOf({ type: 'DamageInflicted', operativeId: 'B1' })).toEqual({ kind: 'damage', operativeId: 'B1' })
    expect(heldItemOf({ type: 'OperativeInjured', operativeId: 'B1' })).toEqual({ kind: 'injured', operativeId: 'B1' })
    expect(heldItemOf({ type: 'OperativeIncapacitated', operativeId: 'B1' })).toEqual({ kind: 'down', operativeId: 'B1' })
    expect(heldItemOf({ type: 'ShootEnded' })).toBeNull()
  })
})
