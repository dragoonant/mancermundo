// Attack and defence dice: classification (6 always a crit, 1 always a fail) and exact odds (R-5.6, R-5.11, R-9).
import type { Rng } from './rng'
import type { RollTarget } from './types'

export type DieClass = 'fail' | 'normal' | 'crit'

/** Clamp a Hit or Save target to the 2+ to 6+ rules range (R-9.7). */
export function clampTarget(n: number): RollTarget {
  return Math.max(2, Math.min(6, Math.round(n))) as RollTarget
}

/**
 * Classify one attack or defence die. 6 is always a success and a crit, 1 always fails, otherwise
 * a result at or above the target is a normal success. `lethal` turns an existing success showing
 * at least that value into a crit; it cannot rescue a failed die (R-10.10).
 */
export function classifyDie(value: number, target: number, lethal?: number): DieClass {
  if (value >= 6) return 'crit'
  if (value <= 1) return 'fail'
  if (value < clampTarget(target)) return 'fail'
  if (lethal !== undefined && value >= lethal) return 'crit'
  return 'normal'
}

export const classifyAttackDie = classifyDie
export const classifyDefenceDie = classifyDie

export function rollDice(rng: Rng, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(rng.d6())
  return out
}

export interface PoolResult {
  dice: number[]
  classes: DieClass[]
  normals: number
  crits: number
}

export function rollPool(rng: Rng, n: number, target: number, lethal?: number): PoolResult {
  return classifyPool(rollDice(rng, n), target, lethal)
}

export function classifyPool(dice: number[], target: number, lethal?: number): PoolResult {
  const classes = dice.map((d) => classifyDie(d, target, lethal))
  return {
    dice,
    classes,
    normals: classes.filter((c) => c === 'normal').length,
    crits: classes.filter((c) => c === 'crit').length,
  }
}

// ---------------------------------------------------------------------------
// Exact odds
// ---------------------------------------------------------------------------

export interface DieOdds {
  fail: number
  normal: number
  crit: number
}

/** Exact per-die probabilities for a Hit/Save target (and optional Lethal x+). */
export function dieOdds(target: number, lethal?: number): DieOdds {
  let fail = 0
  let normal = 0
  let crit = 0
  for (let v = 1; v <= 6; v++) {
    const c = classifyDie(v, target, lethal)
    if (c === 'fail') fail++
    else if (c === 'normal') normal++
    else crit++
  }
  return { fail: fail / 6, normal: normal / 6, crit: crit / 6 }
}

export interface PoolOutcome {
  normals: number
  crits: number
  p: number
}

/** Exact distribution of (normal, crit) successes for n dice. */
export function poolDistribution(n: number, odds: DieOdds): PoolOutcome[] {
  const out: PoolOutcome[] = []
  const fact: number[] = [1]
  for (let i = 1; i <= n; i++) fact[i] = fact[i - 1]! * i
  for (let c = 0; c <= n; c++) {
    for (let s = 0; s + c <= n; s++) {
      const f = n - c - s
      const coef = fact[n]! / (fact[c]! * fact[s]! * fact[f]!)
      const p = coef * Math.pow(odds.crit, c) * Math.pow(odds.normal, s) * Math.pow(odds.fail, f)
      if (p > 0) out.push({ normals: s, crits: c, p })
    }
  }
  return out
}

/** Probability that at least `k` of n dice are successes (normal or crit). */
export function atLeastSuccesses(n: number, odds: DieOdds, k: number): number {
  return poolDistribution(n, odds)
    .filter((o) => o.normals + o.crits >= k)
    .reduce((acc, o) => acc + o.p, 0)
}

export function expectedSuccesses(n: number, odds: DieOdds): { normals: number; crits: number } {
  return { normals: n * odds.normal, crits: n * odds.crit }
}

/** D3 from a D6: 1-2 gives 1, 3-4 gives 2, 5-6 gives 3 (R-9.1). */
export function d3FromD6(v: number): number {
  return Math.ceil(v / 2)
}

// ---------------------------------------------------------------------------
// M2b-attack: exact enumeration over the faces of n dice (used by query.* for expected damage).
// ---------------------------------------------------------------------------

export interface FaceOutcome {
  /** the face of every die, ascending */
  faces: number[]
  p: number
}

const faceCache = new Map<number, FaceOutcome[]>()

/** Every distinct multiset of n D6 results with its exact probability (multinomial). */
export function faceDistribution(n: number): FaceOutcome[] {
  const hit = faceCache.get(n)
  if (hit) return hit
  const out: FaceOutcome[] = []
  if (n === 0) {
    out.push({ faces: [], p: 1 })
  } else {
    const fact: number[] = [1]
    for (let i = 1; i <= n; i++) fact[i] = fact[i - 1]! * i
    const total = Math.pow(6, n)
    const counts = [0, 0, 0, 0, 0, 0]
    const rec = (face: number, left: number): void => {
      if (face === 5) {
        counts[5] = left
        let coef = fact[n]!
        const faces: number[] = []
        for (let f = 0; f < 6; f++) {
          coef /= fact[counts[f]!]!
          for (let k = 0; k < counts[f]!; k++) faces.push(f + 1)
        }
        out.push({ faces, p: coef / total })
        return
      }
      for (let c = 0; c <= left; c++) {
        counts[face] = c
        rec(face + 1, left - c)
      }
    }
    rec(0, n)
  }
  faceCache.set(n, out)
  return out
}
