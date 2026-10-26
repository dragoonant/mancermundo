// Casualties (R-3.5, R-3.6, R-11.8, R-11.10, R-12.1): laying a fighter down Seriously Injured, taking it Out of Action, the
// casualty log (who put whom down, how, which round) and the nerve tests a casualty owes. Nerve tests are queued on
// `state.nerve` (one entry per friendly fighter within 3" of the casualty, by path) and drained after each step by
// `drainNerve`, a no-op until the morale code lands. TODO(S3b): resolve the queue (nerve tests, Broken, Running for Cover).
import { runHook } from './hooks'
import { withinPath } from './measure'
import type { Ctx } from './registry'
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
  runHook('fighter.downed', { seat: f.seat, state: ctx.state, engine: ctx, fighterId: f.id, ...(by ? { targetId: by } : {}), data: { kind: 'outOfAction', cause } })
}

/** apply.afterAction: resolve the nerve tests owed. TODO(S3b): nerve tests, Broken and Running for Cover; until then the queue is dropped. */
export function drainNerve(ctx: Ctx): void {
  if (ctx.state.nerve.length > 0) ctx.state.nerve = []
}

/** The casualty log, optionally for one seat's fighters. */
export function casualtiesOf(state: GameState, seat?: Seat): CasualtyRecord[] {
  if (!seat) return state.casualties.slice()
  return state.casualties.filter((c) => state.fighters[c.fighterId]?.seat === seat)
}
