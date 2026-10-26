// Dice helpers (S2): D3/D66, the characteristic tests of R-2.3 to R-2.5, dice expressions from data ("D3", "2D6", "D3+1")
// and exact odds. Firepower / Injury / Scatter faces and their odds tables arrive in S3a (the face names already ride on
// `DiceRolled.faces` through `Ctx.roll`).
import type { Ctx } from './registry'
import type { GameState } from './types'
import { EngineInvariantError } from './state'

/** D3 from a D6 result: 1-2 = 1, 3-4 = 2, 5-6 = 3 (R-1.1). */
export function d3FromD6(d6: number): number {
  return Math.ceil(d6 / 2)
}

/** D66: two D6 read as tens then units (R-1.1). */
export function d66(tens: number, units: number): number {
  return tens * 10 + units
}

/** "4+" -> 4. Plain numbers pass through. */
export function parseTarget(t: string | number): number {
  if (typeof t === 'number') return t
  const m = /^(\d+)\+$/.exec(t)
  if (!m) throw new EngineInvariantError(`bad target number ${t}`)
  return Number(m[1])
}

/**
 * WS, BS and I tests (R-2.3): roll a D6, pass when `natural + modifier >= target`. A natural 1 always fails, before or after
 * modifiers. `modifier` is added to the roll (a +1 to a characteristic is +1 to the roll, R-2.6).
 */
export function d6TestPasses(natural: number, target: number, modifier = 0): boolean {
  if (natural <= 1) return false
  return natural + modifier >= target
}

/** Ld, Cl, Wil and Int tests (R-2.4): roll 2D6, pass when `total + modifier >= target`. A total of 2 always fails. */
export function twoD6TestPasses(total: number, target: number, modifier = 0): boolean {
  if (total <= 2) return false
  return total + modifier >= target
}

/** S and T tests (R-2.5): roll a D6, pass when the roll is at most the characteristic. */
export function strengthTestPasses(roll: number, characteristic: number): boolean {
  return roll <= characteristic
}

/** Probability that a D6 test passes (exact, R-2.3). */
export function d6TestChance(target: number, modifier = 0): number {
  let n = 0
  for (let r = 1; r <= 6; r++) if (d6TestPasses(r, target, modifier)) n++
  return n / 6
}

/** Probability that a 2D6 test passes (exact, R-2.4). */
export function twoD6TestChance(target: number, modifier = 0): number {
  let n = 0
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (twoD6TestPasses(a + b, target, modifier)) n++
  return n / 36
}

/** Probability that `D6 + bonus >= target` (force door, casket smash; no natural-1 rule applies to those sums). */
export function d6SumChance(bonus: number, target: number): number {
  let n = 0
  for (let r = 1; r <= 6; r++) if (r + bonus >= target) n++
  return n / 6
}

// ---------------------------------------------------------------------------
// Dice expressions
// ---------------------------------------------------------------------------

export interface DiceExpr {
  /** number of dice */
  count: number
  die: 'd6' | 'd3' | '2d6' | null
  add: number
}

/** Parse "D3", "D6", "2D6", "D3+1" or an integer (data DiceExpr). */
export function parseDiceExpr(expr: number | string): DiceExpr {
  if (typeof expr === 'number') return { count: 0, die: null, add: expr }
  const m = /^(\d*)D(3|6)(?:\+(\d+))?$/i.exec(expr.trim())
  if (!m) {
    if (/^\d+$/.test(expr)) return { count: 0, die: null, add: Number(expr) }
    throw new EngineInvariantError(`bad dice expression ${expr}`)
  }
  const n = m[1] ? Number(m[1]) : 1
  const sides = Number(m[2])
  const add = m[3] ? Number(m[3]) : 0
  if (sides === 6 && n === 2) return { count: 1, die: '2d6', add }
  if (n !== 1) throw new EngineInvariantError(`unsupported dice expression ${expr}`)
  return { count: 1, die: sides === 3 ? 'd3' : 'd6', add }
}

/** Roll a dice expression through the context (one `DiceRolled` event per roll). */
export function rollExpr(ctx: Ctx, purpose: string, expr: number | string): number {
  const e = parseDiceExpr(expr)
  if (!e.die) return e.add
  return ctx.roll(purpose, 1, e.die)[0]! + e.add
}

/**
 * A uniform integer in [0, k) drawn from D6 rolls only (so scripted dice and replays stay exact): base-6 digits with
 * rejection of the biased tail. Each digit is a `DiceRolled` event.
 */
export function uniformInt(ctx: Ctx, purpose: string, k: number): number {
  if (k <= 1) return 0
  let digits = 1
  while (6 ** digits < k) digits++
  const span = 6 ** digits
  const limit = span - (span % k)
  for (let guard = 0; guard < 200; guard++) {
    const rolls = ctx.roll(purpose, digits)
    let v = 0
    for (const r of rolls) v = v * 6 + (r - 1)
    if (v < limit) return v % k
  }
  throw new EngineInvariantError(`uniformInt(${k}) never accepted a draw`)
}

// ---------------------------------------------------------------------------
// Special dice (S3a): Firepower, Injury and Scatter faces read from the data face tables (core/dice.json), exact odds
// ---------------------------------------------------------------------------

export interface FirepowerFace {
  /** bullet holes on the face (only Rapid Fire counts them, R-1.2) */
  hits: number
  /** the Ammo symbol */
  ammo: boolean
}

/** Face names `hit1+ammo`, `hit1`, `hit2`, `hit3` (a bare `hit` counts one hole; anything without `hit` counts none). */
export function parseFirepowerFace(name: string): FirepowerFace {
  const m = /^hit(\d*)/.exec(name)
  return { hits: m ? (m[1] ? Number(m[1]) : 1) : 0, ammo: name.includes('ammo') }
}

export function firepowerFace(state: GameState, d6: number): FirepowerFace {
  return parseFirepowerFace(state.data.dice.firepower[d6 - 1] ?? '')
}

export type InjuryResult = 'fleshWound' | 'seriouslyInjured' | 'outOfAction'

export function injuryFace(state: GameState, d6: number): InjuryResult {
  const name = state.data.dice.injury[d6 - 1]
  if (name === 'fleshWound' || name === 'seriouslyInjured' || name === 'outOfAction') return name
  throw new EngineInvariantError(`injury face ${String(name)} for a ${d6}`)
}

export function scatterFace(state: GameState, d6: number): 'arrow' | 'hit' {
  return state.data.dice.scatter[d6 - 1] === 'hit' ? 'hit' : 'arrow'
}

/** Probability of each Injury result on one die, from the face table. */
export function injuryFaceOdds(state: GameState): Record<InjuryResult, number> {
  const out: Record<InjuryResult, number> = { fleshWound: 0, seriouslyInjured: 0, outOfAction: 0 }
  for (let d = 1; d <= 6; d++) out[injuryFace(state, d)] += 1 / 6
  return out
}

/** Distribution of total bullet holes on `n` Firepower dice: `p[k]` = chance of exactly k holes. */
export function firepowerHitsDistribution(state: GameState, n: number): number[] {
  let dist = [1]
  for (let i = 0; i < n; i++) {
    const next: number[] = []
    for (let k = 0; k < dist.length; k++) {
      for (let d = 1; d <= 6; d++) {
        const h = firepowerFace(state, d).hits
        next[k + h] = (next[k + h] ?? 0) + dist[k]! / 6
      }
    }
    dist = Array.from({ length: next.length }, (_, k) => next[k] ?? 0)
  }
  return dist
}

/** R-11.2 wound table (S vs T). 6+ (S at most half of T) is checked before 5+ (S below T). */
export function woundNeed(strength: number, toughness: number): number {
  if (strength >= 2 * toughness) return 2
  if (strength > toughness) return 3
  if (strength === toughness) return 4
  if (strength * 2 <= toughness) return 6
  return 5
}

/** Chance a wound roll succeeds: natural 6 always wounds, natural 1 always fails (R-1.5). `modifier` is added to the roll. */
export function woundChanceFor(need: number, modifier = 0): number {
  let n = 0
  for (let r = 1; r <= 6; r++) if (r === 6 || (r !== 1 && r + modifier >= need)) n++
  return n / 6
}

/** Hit chance for a final target number (R-8.5, R-8.6): 7+ is an improbable shot (a 6, then the unmodified BS). */
export function hitChanceFor(need: number, unmodifiedBs: number): number {
  if (need > 6) return (1 / 6) * d6TestChance(unmodifiedBs)
  return d6TestChance(need)
}

/** Chance a save succeeds for a final need (null = no save; 7+ = no roll, R-11.4; a natural 1 always fails). */
export function saveChanceFor(need: number | null): number {
  if (need === null || need > 6) return 0
  return d6TestChance(need)
}

/** Toxin / Gas (R-14.3): D6 >= T, a natural 6 always succeeds, a natural 1 always fails. */
export function toxinPasses(roll: number, toughness: number): boolean {
  if (roll === 6) return true
  if (roll === 1) return false
  return roll >= toughness
}

export function toxinChance(toughness: number): number {
  let n = 0
  for (let r = 1; r <= 6; r++) if (toxinPasses(r, toughness)) n++
  return n / 6
}

export interface InjuryOdds {
  pOutOfAction: number
  pSeriouslyInjured: number
  /** only Flesh Wounds (the fighter stays as it is, one T lower per wound) */
  pFleshWoundsOnly: number
}

/**
 * Exact odds of rolling `dice` Injury dice together and applying them (R-11.8 stacking): any Out of Action wins; the first
 * Seriously Injured (unless already Seriously Injured) lays the fighter down and every further one is a Flesh Wound; Flesh
 * Wounds that take T to 0 are Out of Action. `melta` turns every die into Out of Action (R-11.11).
 */
export function injuryOdds(state: GameState, dice: number, opts: { toughness?: number; alreadySeriouslyInjured?: boolean; melta?: boolean } = {}): InjuryOdds {
  if (dice <= 0) return { pOutOfAction: 0, pSeriouslyInjured: 0, pFleshWoundsOnly: 0 }
  if (opts.melta) return { pOutOfAction: 1, pSeriouslyInjured: 0, pFleshWoundsOnly: 0 }
  const f = injuryFaceOdds(state)
  const t = opts.toughness ?? 99
  const out: InjuryOdds = { pOutOfAction: 0, pSeriouslyInjured: 0, pFleshWoundsOnly: 0 }
  const n = Math.min(dice, 8)
  // enumerate counts (fw, si, ooa) with multinomial weights
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1))
  for (let o = 0; o <= n; o++) {
    for (let si = 0; si + o <= n; si++) {
      const fw = n - o - si
      const w = (fact(n) / (fact(o) * fact(si) * fact(fw))) * f.outOfAction ** o * f.seriouslyInjured ** si * f.fleshWound ** fw
      if (w === 0) continue
      if (o > 0) {
        out.pOutOfAction += w
        continue
      }
      const becomesSi = si > 0 && !opts.alreadySeriouslyInjured
      const wounds = fw + (becomesSi ? si - 1 : si)
      if (t - wounds <= 0) out.pOutOfAction += w
      else if (becomesSi) out.pSeriouslyInjured += w
      else out.pFleshWoundsOnly += w
    }
  }
  return out
}

/** Expected value of a damage profile (fixed, dice expression, or none). */
export function expectedDamage(dmg: { kind: 'fixed'; value: number } | { kind: 'dice'; expr: string } | { kind: 'none' }): number {
  if (dmg.kind === 'none') return 0
  if (dmg.kind === 'fixed') return dmg.value
  const e = parseDiceExpr(dmg.expr)
  const mean = e.die === 'd3' ? 2 : e.die === 'd6' ? 3.5 : e.die === '2d6' ? 7 : 0
  return e.count * mean + e.add
}
