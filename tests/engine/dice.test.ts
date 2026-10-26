import { describe, expect, it } from 'vitest'
import { classifyDie, dieOdds, poolDistribution, classifyPool } from '@/engine/dice'

describe('dice classification and odds', () => {
  it('SHOOT-004 with Hit 3+ a 6 is a crit, 3 to 5 are normal, 2 and 1 fail', () => {
    expect([1, 2, 3, 4, 5, 6].map((d) => classifyDie(d, 3))).toEqual(['fail', 'fail', 'normal', 'normal', 'normal', 'crit'])
    // 6 always succeeds and 1 always fails whatever the target
    expect(classifyDie(6, 6)).toBe('crit')
    expect(classifyDie(1, 2)).toBe('fail')
  })

  it('SHOOT-005 the defender collects 3 dice; results at or above Save succeed, 6 is a crit, 1 fails', () => {
    const pool = classifyPool([6, 5, 1], 5)
    expect(pool.dice).toHaveLength(3)
    expect(pool.crits).toBe(1)
    expect(pool.normals).toBe(1)
    const odds = dieOdds(5)
    expect(odds.crit + odds.normal + odds.fail).toBeCloseTo(1, 12)
    expect(odds.normal).toBeCloseTo(1 / 6, 12)
    const dist = poolDistribution(3, odds)
    expect(dist.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 12)
  })

  it('WPN-013 Lethal 5+ turns a 5 into a crit when the die already succeeds, never a failed die', () => {
    expect(classifyDie(5, 3, 5)).toBe('crit')
    expect(classifyDie(4, 3, 5)).toBe('normal')
    expect(classifyDie(5, 6, 5)).toBe('fail') // Hit 6+: the 5 failed, Lethal cannot rescue it
    expect(dieOdds(3, 5).crit).toBeCloseTo(2 / 6, 12)
  })
})

// ---------------------------------------------------------------------------
// M2b-attack: exact enumeration and the statistical check of expected damage
// ---------------------------------------------------------------------------
import { faceDistribution } from '@/engine/dice'
import { expectedDamage, killOdds } from '@/engine/query'
import { SeededRng } from '@/engine/rng'
import { step } from '@/engine'
import type { WeaponRuleRef } from '@/engine/types'
import { feature, mapWith, part, rect } from '../fixtures/maps'
import { declareShoot, evs, pick, play, ranged, stage } from '../fixtures/attack'

describe('DICE exact enumeration', () => {
  it('DICE-001 faceDistribution lists every multiset of n dice with probabilities that sum to 1', () => {
    for (const n of [0, 1, 2, 4, 6]) {
      const d = faceDistribution(n)
      expect(d.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 12)
      expect(new Set(d.map((o) => o.faces.join(''))).size).toBe(d.length)
    }
    expect(faceDistribution(2)).toHaveLength(21)
    expect(faceDistribution(3).find((o) => o.faces.join('') === '123')!.p).toBeCloseTo(6 / 216, 12)
  })

  it('DICE-002 expectedDamage is exact on a hand-computed case', () => {
    // Atk 1, Hit 4+, 1 die: P(normal)=2/6, P(crit)=1/6. Save 6+ (a 6 saves): defender rolls 3 dice.
    const w = ranged('w', { atk: 1, hit: 4, dmg: { normal: 3, crit: 5 } })
    const s = stage({ m: [0, -5], e: [0, 4], mine: [w], targetSave: 6 })
    const e = expectedDamage(s.state, s.m, w.id, s.e)
    // defence: each die is a crit with p=1/6 (a 6 always crits); the single attack die is blocked iff at least one crit
    const pNone = Math.pow(5 / 6, 3)
    const expected = (2 / 6) * 3 * pNone + (1 / 6) * 5 * pNone
    expect(e.mean).toBeCloseTo(expected, 10)
    expect(e.distribution.reduce((a, d) => a + d.p, 0)).toBeCloseTo(1, 12)
    expect(killOdds(s.state, s.m, w.id, s.e)).toBe(0)
  })
})

describe('DICE expected damage matches the engine', () => {
  const cases: { name: string; rules: WeaponRuleRef[]; atk: number; save: 2 | 3 | 4 | 5 | 6; map?: 'cover' | 'obscured'; hit: 2 | 3 | 4 }[] = [
    { name: 'cover, Balanced, Piercing Crits, Lethal', atk: 5, hit: 3, save: 4, map: 'cover', rules: [{ rule: 'balanced' }, { rule: 'piercing', x: 1, crits: true }, { rule: 'lethal', target: 5 }] },
    { name: 'obscured, Relentless, Devastating, Rending', atk: 4, hit: 3, save: 3, map: 'obscured', rules: [{ rule: 'relentless' }, { rule: 'devastating', x: 2 }, { rule: 'rending' }] },
    { name: 'open ground, Ceaseless, Punishing, Severe, Brutal', atk: 5, hit: 4, save: 5, rules: [{ rule: 'ceaseless' }, { rule: 'punishing' }, { rule: 'severe' }, { rule: 'brutal' }] },
    { name: 'Accurate and Piercing', atk: 4, hit: 4, save: 3, rules: [{ rule: 'accurate', x: 1 }, { rule: 'piercing', x: 1 }] },
  ]
  for (const [i, c] of cases.entries()) {
    it(`DICE-003.${i + 1} expectedDamage matches a 3000-sample mean within 3%: ${c.name}`, () => {
      const w = ranged('w', { atk: c.atk, hit: c.hit, dmg: { normal: 3, crit: 5 } }, c.rules)
      const map =
        c.map === 'cover'
          ? mapWith(feature('rubble', part('rubble.a', rect(-1, 1, 2.9, 3.3), 0.5, ['light'])))
          : c.map === 'obscured'
            ? mapWith(feature('wall', part('wall.a', rect(-2, 2, -0.25, 0.25), 0.5, ['heavy'])))
            : undefined
      const s = stage({ ...(map ? { map } : {}), m: [0, -5], e: [0, 4], mine: [w], targetSave: c.save, targetWounds: 500, mineWounds: 500, mineMaxWounds: 500 })
      const exact = expectedDamage(s.state, s.m, w.id, s.e)
      let declared = declareShoot(s.state)
      declared = step(declared, pick(declared.pending!, w.id)).state
      const targeted = declared
      const N = 3000
      let total = 0
      let kills = 0
      for (let k = 0; k < N; k++) {
        const rng = SeededRng.fromSeed(`dice-${i}-${k}`)
        const r = step(targeted, pick(targeted.pending!, s.e), rng)
        const rest = play(r.state, rng)
        const lost = 500 - rest.state.operatives[s.e]!.wounds
        total += lost
        if (lost >= 6) kills++
      }
      const mean = total / N
      expect(Math.abs(mean - exact.mean) / exact.mean).toBeLessThan(0.03)
      const six = expectedDamage({ ...s.state, operatives: { ...s.state.operatives, [s.e]: { ...s.state.operatives[s.e]!, wounds: 6 } } }, s.m, w.id, s.e)
      expect(Math.abs(kills / N - six.killProbability)).toBeLessThan(0.03)
      void evs
    })
  }
})
