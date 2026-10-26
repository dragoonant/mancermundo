// Kill log (batch D prep, generic capability "killLog"): every removal from the killzone of any cause is recorded in
// `state.kills` with the operative whose damage incapacitated it (`Operative.incapacitatedBy`, set in inflict, so
// direct damage and mines name their source too), and the lifecycle hook `operative.removed` runs once for it. The
// `operative.killed` ploy window still covers attack kills only; rules that need a decision after a kill of any cause
// (Reward Earned, Mutation, Marked for Justice) read `killsSince` at the next reaction point. M10 batch D shared: the
// record is written at removal time, so a window raised in the same step already sees it.
// `scoreAsIncapacitated` counts an operative for the kill op while it stays in the killzone (Frenzy); its later
// removal is neither counted nor logged again.
import { runHook } from './hooks'
import { onOperativeRemoved } from './missions'
import type { Ctx } from './registry'
import type { OperativeRemovedData } from './hooks'
import type { GameState, KillRecord, Operative } from './types'

function killerOf(state: GameState, op: Operative): Operative | null {
  const id = op.incapacitatedBy?.id
  const k = id ? state.operatives[id] : undefined
  return k && k.id !== op.id ? k : null
}

function record(ctx: Ctx, op: Operative, cause: KillRecord['cause'], killer: Operative | null): void {
  const s = ctx.state
  const rec: KillRecord = {
    removedId: op.id,
    victimSeat: op.seat,
    killerId: killer?.id ?? null,
    killerSeat: killer?.seat ?? null,
    cause,
    turningPoint: s.turningPoint,
    seq: s.seq,
  }
  ;(s.kills ??= []).push(rec)
  const data: OperativeRemovedData = { killerId: rec.killerId, cause }
  runHook('operative.removed', {
    seat: op.seat,
    state: s,
    engine: ctx,
    operativeId: op.id,
    ...(rec.killerId ? { targetId: rec.killerId } : {}),
    data: data as unknown as Record<string, unknown>,
  })
}

/** The last kill record of an operative, if any. */
export function lastKillOf(state: GameState, opId: string): KillRecord | undefined {
  const list = state.kills ?? []
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.removedId === opId) return list[i]
  return undefined
}

/** Kill records made at or after step `seq` (an action's kills: pass the activation's `declaredSeq`). */
export function killsSince(state: GameState, seq: number): KillRecord[] {
  return (state.kills ?? []).filter((k) => k.seq >= seq)
}

/** M10 batch D shared: removals already logged in the step that owns this state object (removal time, then step end). */
const loggedInStep = new WeakMap<GameState, Set<string>>()

/**
 * Called at removal time by every site that removes an operative (attack-common's removal queue, effects.removeNow,
 * reserve.incapacitateOffboard), so the log and `operative.removed` are written before that step's ploy and reaction
 * windows open (M10 batch D shared); the per-step removal pass (markers.updateControl) calls it again as a safety net
 * and the second call does nothing. The cause is `offboard` without incapacitating damage (a deadline out of the
 * killzone), `direct` for rule damage, `attack` otherwise.
 */
export function noteRemoval(ctx: Ctx, op: Operative): void {
  let logged = loggedInStep.get(ctx.state)
  if (!logged) loggedInStep.set(ctx.state, (logged = new Set()))
  if (logged.has(op.id)) return
  logged.add(op.id)
  const last = lastKillOf(ctx.state, op.id)
  // already scored while still in the killzone (Frenzy): only mark it removed
  if (last && last.cause === 'scored' && !last.removedLater) {
    last.removedLater = true
    return
  }
  const by = op.wounds <= 0 ? op.incapacitatedBy : undefined
  const cause: KillRecord['cause'] = !by ? 'offboard' : by.source === 'direct' ? 'direct' : 'attack'
  record(ctx, op, cause, by ? killerOf(ctx.state, op) : null)
}

/**
 * Count `opId` as incapacitated for the kill op now, while it stays in the killzone (Fellgor Frenzy), and run
 * `operative.removed` for it with cause `scored` (other teams' kill rules see it). Once per operative until it is
 * removed; its later removal is not counted or logged again. `killerId` names the operative that caused it.
 */
export function scoreAsIncapacitated(ctx: Ctx, opId: string, killerId?: string): boolean {
  const s = ctx.state
  const op = s.operatives[opId]
  if (!op || op.status !== 'active') return false
  const last = lastKillOf(s, opId)
  if (last && last.cause === 'scored' && !last.removedLater) return false
  onOperativeRemoved(ctx, op)
  const killer = killerId ? (s.operatives[killerId] ?? null) : killerOf(s, op)
  record(ctx, op, 'scored', killer && killer.id !== op.id ? killer : null)
  return true
}
