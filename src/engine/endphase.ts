// END module: the End phase (R-5.7). S2 holds only the round hand-off: effects that last a round expire, the battle-end check
// of R-5.8 and the sim's round cap run, and the next round starts. TODO(S4): Bottle tests, Fleeing (leading by example),
// Recovery (assist, pick), Rally, clean-up (smoke 1-4, Concussion) as `end.*` decisions, and the scenario battle-end hand-off.
import { expireEffects } from './effects'
import { runHook } from './hooks'
import { beginRound } from './priority'
import { endGame, stubModule, type Ctx } from './registry'
import { onBoard } from './state'
import type { Seat } from './types'

export const endphaseModule = stubModule('endphase', ['end'])

/** R-5.8: the battle is over when at most one gang still has fighters on the battlefield that are not Seriously Injured. */
function standingSeats(ctx: Ctx): Seat[] {
  const seats = new Set<Seat>()
  for (const f of onBoard(ctx.state)) if (f.posture !== 'seriouslyInjured') seats.add(f.seat)
  return [...seats]
}

export function runEndPhase(ctx: Ctx): void {
  const s = ctx.state
  s.phase = 'end'
  ctx.emit({ type: 'PhaseStarted', name: 'end' }, null)
  // TODO(S4): bottle, flee, recovery, rally, clean-up
  expireEffects(ctx, 'round')
  runHook('phase.end', { seat: s.priority ?? 'A', state: s, engine: ctx, data: { name: 'end' } })
  ctx.emit({ type: 'PhaseEnded', name: 'end' }, null)
  runHook('round.end', { seat: s.priority ?? 'A', state: s, engine: ctx })
  ctx.emit({ type: 'RoundEnded', round: s.round }, null)
  if (standingSeats(ctx).length <= 1) {
    endGame(ctx, 'scenario')
    return
  }
  const max = s.origin.setup.options?.maxRounds
  if (max !== undefined && s.round >= max) {
    endGame(ctx, 'roundLimit')
    return
  }
  beginRound(ctx)
}
