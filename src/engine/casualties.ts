// Casualties (R-3.5, R-3.6, R-11.8, R-11.10, R-12.1): laying a fighter down Seriously Injured, taking it Out of Action, the
// casualty log (who put whom down, how, which round) and the nerve tests a casualty owes. Nerve tests are queued on
// `state.nerve` (one entry per friendly fighter within 3" of the casualty, by path) and drained after each step by
// the morale code (morale.ts; fight.ts `settleNerve` / `drainNerve`): nerve tests, Broken, Running for Cover.
import { runHook } from './hooks'
import { withinPath } from './measure'
import type { Ctx } from './registry'
import { scoreCasualty } from './scenarios'
import { constants, onBoard } from './state'
import type { CasualtyRecord, Fighter, GameState, Seat } from './types'

export function recordCasualty(ctx: Ctx, f: Fighter, by: string | null, cause: string, kind: CasualtyRecord['kind']): void {
  ctx.state.casualties.push({ fighterId: f.id, by, cause, kind, round: ctx.state.round })
}

/** R-12.1: every friendly fighter within 3" (path) of a fighter that becomes Seriously Injured or goes Out of Action owes a nerve test. */
export function queueNerve(ctx: Ctx, downed: Fighter, reason: 'seriouslyInjured' | 'outOfAction'): void {
  const s = ctx.state
  const radius = constants(s).radii.nerve
  for (const g of onBoard(s)) {
    if (g.id === downed.id || g.seat !== downed.seat) continue
    if (!withinPath(s, downed, g, radius)) continue
    if (s.nerve.some((n) => n.fighterId === g.id && n.reason === `${reason}:${downed.id}`)) continue
    // Hot-headed: friends skip the test for this casualty (`nerve.queue`)
    const skip = { skip: false }
    runHook('nerve.queue', { seat: downed.seat, state: s, engine: ctx, fighterId: downed.id, targetId: g.id, data: skip })
    if (skip.skip) continue
    s.nerve.push({ fighterId: g.id, reason: `${reason}:${downed.id}` })
  }
}

/** Lay a fighter down Seriously Injured (R-3.5): Prone face down, never Engaged; a casualty with a nerve test. */
export function seriouslyInjure(ctx: Ctx, f: Fighter, by: string | null, cause: string): void {
  if (f.location !== 'board' || f.posture === 'seriouslyInjured') return
  const from = f.posture
  f.posture = 'seriouslyInjured'
  ctx.emit({ type: 'StatusChanged', fighterId: f.id, from, to: 'seriouslyInjured', reason: cause }, f.seat)
  f.downedBy = { by, cause }
  recordCasualty(ctx, f, by, cause, 'seriouslyInjured')
  queueNerve(ctx, f, 'seriouslyInjured')
  runHook('fighter.downed', { seat: f.seat, state: ctx.state, engine: ctx, fighterId: f.id, ...(by ? { targetId: by } : {}), data: { kind: 'seriouslyInjured', cause } })
}

/** Take a fighter Out of Action (R-3.6): removed for the rest of the battle; a casualty with a nerve test. */
export function takeOutOfAction(ctx: Ctx, f: Fighter, by: string | null, cause: string): void {
  if (f.location !== 'board') return
  // nerve first, while the fighter still has its place on the board
  queueNerve(ctx, f, 'outOfAction')
  f.location = 'outOfAction'
  f.ready = false
  f.engagedWith = []
  f.carrying = null
  f.downedBy = { by, cause }
  ctx.emit({ type: 'FighterOutOfAction', fighterId: f.id, by, cause }, f.seat)
  recordCasualty(ctx, f, by, cause, 'outOfAction')
  scoreCasualty(ctx, f, 'outOfAction')
  runHook('fighter.downed', { seat: f.seat, state: ctx.state, engine: ctx, fighterId: f.id, ...(by ? { targetId: by } : {}), data: { kind: 'outOfAction', cause } })
}

/**
 * A fighter leaves the battlefield (R-13.2, R-13.4): a failed flee test in the End phase or voluntary flight at the start of
 * the Action phase. It counts as Out of Action for the Bottle test, the scenario and the battle end (R-13.1), but it is not a
 * casualty that shakes its friends (ruling): no nerve tests are queued.
 */
export function fleeFighter(ctx: Ctx, f: Fighter, voluntary: boolean): void {
  if (f.location !== 'board') return
  f.location = 'fled'
  f.ready = false
  f.engagedWith = []
  f.carrying = null
  f.downedBy = { by: null, cause: voluntary ? 'fledVoluntary' : 'fled' }
  ctx.emit({ type: 'FighterFled', fighterId: f.id, voluntary }, f.seat)
  recordCasualty(ctx, f, null, f.downedBy.cause, 'fled')
  scoreCasualty(ctx, f, 'fled', voluntary)
  runHook('fighter.downed', { seat: f.seat, state: ctx.state, engine: ctx, fighterId: f.id, data: { kind: 'fled', cause: f.downedBy.cause } })
}

/** The casualty log, optionally for one seat's fighters. */
export function casualtiesOf(state: GameState, seat?: Seat): CasualtyRecord[] {
  if (!seat) return state.casualties.slice()
  return state.casualties.filter((c) => state.fighters[c.fighterId]?.seat === seat)
}

/** Fighters of a seat that count as down for the Bottle test (R-13.1): Seriously Injured, Out of Action or fled (fled count as Out of Action). */
export function downCount(state: GameState, seat: Seat): number {
  let n = 0
  for (const f of Object.values(state.fighters)) {
    if (f.seat !== seat) continue
    if (f.location === 'outOfAction' || f.location === 'fled' || (f.location === 'board' && f.posture === 'seriouslyInjured')) n++
  }
  return n
}

export interface BottleInfo {
  seat: Seat
  /** fighters down now */
  down: number
  /** the gang's starting crew (the number the D6 + down must beat) */
  crew: number
  /** modifier to the D6 (Iron Will: -1) */
  modifier: number
  bottled: boolean
  voluntary: boolean
  /** the gang must test this End phase: not bottled and at least one fighter down */
  mustTest: boolean
  /** the smallest D6 result that bottles the gang (7 = it cannot bottle now) */
  need: number
  /** exact chance the test bottles the gang now */
  pBottle: number
}

/** R-13.1: D6 + fighters down must be greater than the starting crew. */
export function bottleInfo(state: GameState, seat: Seat): BottleInfo {
  const p = state.players[seat]
  const down = downCount(state, seat)
  // Iron Will: a -1 modifier to the Bottle roll (the `bottle.mods` hook)
  let modifier = 0
  for (const r of runHook('bottle.mods', { seat, state, data: { modifier: 0 } })) if (r.delta) modifier += r.delta
  const need = Math.max(1, Math.min(7, p.startingCrew - down - modifier + 1))
  return {
    seat,
    down,
    crew: p.startingCrew,
    modifier,
    bottled: p.bottled,
    voluntary: p.bottledVoluntarily,
    mustTest: !p.bottled && down > 0,
    need,
    pBottle: p.bottled ? 1 : down === 0 ? 0 : (7 - need) / 6,
  }
}
