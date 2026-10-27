// Morale (R-12, R-13.8): nerve tests, Broken, the Rally helper. A fighter that becomes Seriously Injured or goes Out of Action
// queues a nerve test for every friend within 3" (casualties.ts, `state.nerve`); the queue is resolved after the hit that
// caused it (fight.ts runs it inside a close-combat sequence, `activation.continueActivation` after any other action, and
// `drainNerve` after every step as a safety net). A failed test makes the fighter Broken: it loses Ready and at once makes
// a Running for Cover action (an escape frame of the close-combat sequence, fight.ts), even if it already activated. The
// four-criteria end-point scoring of Running for Cover lives with the other engine-made paths in movement.ts.
import { twoD6TestChance, twoD6TestPasses } from './dice'
import { runHook } from './hooks'
import { withinPath } from './measure'
import { stat } from './query'
import type { Ctx } from './registry'
import { constants, friendsOf, isBroken } from './state'
import { setCondition } from './traits'
import type { Fighter, GameState, NerveCheck } from './types'

export interface CoolTestInfo {
  /** the Cool target number (2D6 >= need) */
  need: number
  /** +1 per supporting friend, plus rule modifiers */
  modifier: number
  supporters: string[]
  /** exact chance to pass */
  chance: number
}

/** Friends within `radius` (path, R-1.9 ruling) that are neither Broken nor Seriously Injured (R-12.2, R-13.8). */
export function supporters(state: GameState, f: Fighter, radius: number): Fighter[] {
  return friendsOf(state, f).filter((g) => !isBroken(g) && g.posture !== 'seriouslyInjured' && withinPath(state, f, g, radius))
}

function coolTest(state: GameState, f: Fighter, radius: number, reason: 'nerve' | 'rally'): CoolTestInfo {
  const sup = supporters(state, f, radius)
  let modifier = sup.length
  if (reason === 'nerve') {
    for (const r of runHook('nerve.mods', { seat: f.seat, state, fighterId: f.id, data: { test: 'nerve' } })) if (r.delta) modifier += r.delta
  }
  for (const r of runHook('test.modify', { seat: f.seat, state, fighterId: f.id, data: { test: 'cool', reason } })) if (r.delta) modifier += r.delta
  const need = stat(state, f.id, 'Cl')
  const p = twoD6TestChance(need, modifier)
  // Inspirational (`test.failed`, preview): the chance a failed test is rescued
  const preview = { test: 'cool', reason, rescued: false, preview: true, chance: 0 }
  runHook('test.failed', { seat: f.seat, state, fighterId: f.id, data: preview })
  return { need, modifier, supporters: sup.map((g) => g.id), chance: p + (1 - p) * preview.chance }
}

/** A failed Cool test of `f` may be rescued (Inspirational, the `test.failed` hook); true when the original test counts as passed. */
export function rescuedCoolTest(ctx: Ctx, f: Fighter, reason: string): boolean {
  const data = { test: 'cool', reason, rescued: false }
  runHook('test.failed', { seat: f.seat, state: ctx.state, engine: ctx, fighterId: f.id, data })
  return data.rescued
}

/** R-12.2: Cool test, +1 per other friend within 3" that is not Broken and not Seriously Injured. */
export function nerveInfo(state: GameState, f: Fighter): CoolTestInfo {
  return coolTest(state, f, constants(state).radii.nerveSupport, 'nerve')
}

/** R-13.8 (helper for the End phase, S4): the Rally test of a Broken fighter. */
export function rallyInfo(state: GameState, f: Fighter): CoolTestInfo {
  return coolTest(state, f, constants(state).radii.rallySupport, 'rally')
}

/** Make a fighter Broken (R-12.3): the condition, and it loses Ready at once. */
export function breakFighter(ctx: Ctx, f: Fighter, reason: string): void {
  setCondition(ctx, f, 'broken', reason)
  f.ready = false
}

/**
 * Resolve one owed nerve test (R-12.1, R-12.2). A fighter no longer on the battlefield or already Broken does not test
 * (ruling). Returns true when it failed and became Broken; the caller then runs its immediate Running for Cover.
 */
export function takeNerveTest(ctx: Ctx, entry: NerveCheck): boolean {
  const f = ctx.state.fighters[entry.fighterId]
  if (!f || f.location !== 'board' || isBroken(f)) return false
  const info = nerveInfo(ctx.state, f)
  const total = ctx.roll('nerve', 1, '2d6')[0]!
  const modifier = info.modifier + (entry.modifier ?? 0)
  let passed = twoD6TestPasses(total, info.need, modifier)
  if (!passed && rescuedCoolTest(ctx, f, 'nerve')) passed = true
  // `need` is the 2D6 total that passes once the supporters are counted
  ctx.emit({ type: 'NerveTest', fighterId: f.id, roll: total, need: info.need - modifier, passed }, f.seat)
  if (passed) return false
  breakFighter(ctx, f, 'nerve')
  return true
}
