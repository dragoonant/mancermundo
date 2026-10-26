// PRI module: the Priority phase (R-5.2, R-5.3). No v1 decision lives here (the namespace is reserved), so the module
// rejects every action; `beginRound` is the round's entry point, called by set-up once everyone is deployed and by the End
// phase after each round.
import { beginActionPhase } from './activation'
import { runHook } from './hooks'
import { reject, type Ctx, type ModuleDef } from './registry'
import { otherSeat } from './state'
import type { Seat } from './types'

export const priorityModule: ModuleDef = {
  id: 'priority',
  namespaces: ['priority'],
  handle(_state, action) {
    return reject('E_TODO', `${action.type} is not a priority decision (there are none in v1)`)
  },
}

/** Roll-off for Priority: highest wins; a round-1 tie re-rolls, a later tie hands Priority to the player who lacked it (R-5.2). */
function rollForPriority(ctx: Ctx): { holder: Seat; rolls: Record<Seat, number>; tieRule: boolean } {
  const s = ctx.state
  const first = s.origin.setup.options?.firstPriority
  if (s.round === 1 && first) return { holder: first, rolls: { A: 0, B: 0 }, tieRule: false }
  for (let guard = 0; guard < 100; guard++) {
    const a = ctx.roll('priority', 1)[0]!
    const b = ctx.roll('priority', 1)[0]!
    if (a !== b) return { holder: a > b ? 'A' : 'B', rolls: { A: a, B: b }, tieRule: false }
    if (s.round > 1 && s.priority) return { holder: otherSeat(s.priority), rolls: { A: a, B: b }, tieRule: true }
  }
  throw new Error('priority roll-off never broke the tie')
}

/**
 * Start a round: Priority roll-off, every fighter on the battlefield becomes Ready whatever its status or conditions (a
 * Flash-blinded fighter that had already activated is the one exception, R-3.11), then the Action phase begins.
 */
export function beginRound(ctx: Ctx): void {
  const s = ctx.state
  s.round += 1
  s.phase = 'priority'
  ctx.emit({ type: 'RoundStarted', round: s.round }, null)
  ctx.emit({ type: 'PhaseStarted', name: 'priority' }, null)
  runHook('round.start', { seat: s.priority ?? 'A', state: s, engine: ctx })
  const { holder, rolls, tieRule } = rollForPriority(ctx)
  s.priority = holder
  ctx.emit({ type: 'PriorityDecided', holder, rolls, tieRule }, holder)
  const readied: string[] = []
  for (const f of Object.values(s.fighters)) {
    f.activatedThisRound = false
    if (f.location !== 'board') {
      f.ready = false
      continue
    }
    const blind = f.conditions.blind
    if (blind?.data?.skipNextReady) {
      // R-3.11: a Blind fighter that had already activated does not become Ready this round; the marker is spent
      delete blind.data.skipNextReady
      f.ready = false
      continue
    }
    f.ready = true
    readied.push(f.id)
  }
  ctx.emit({ type: 'FightersReadied', fighterIds: readied }, null)
  ctx.emit({ type: 'PhaseEnded', name: 'priority' }, null)
  beginActionPhase(ctx)
}
