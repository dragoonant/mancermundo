// Dice helpers (S2): D3/D66, the characteristic tests of R-2.3 to R-2.5, dice expressions from data ("D3", "2D6", "D3+1")
// and exact odds. Firepower / Injury / Scatter faces and their odds tables arrive in S3a (the face names already ride on
// `DiceRolled.faces` through `Ctx.roll`).
import type { Ctx } from './registry'
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
