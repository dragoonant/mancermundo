// Guard (R-4.9 to R-4.12): after an enemy operative finishes an action, the guard's owner may interrupt
// with one operative on guard, which then performs a free Shoot or Fight (point-blank when it stands in
// an enemy control range). The interrupt runs as a temporary activation frame (firefight.ts).
import { continueActivation, startFreeAction } from './firefight'
import { fightAvailability } from './fight'
import { registerFrameResume } from './hooks'
import { enemiesInControlRange, inControlRange } from './measure'
import { bodyOf } from './los'
import { reject, type Ctx, type Handled, type OptionInput } from './registry'
import { shootAvailability, usableRangedWeapons } from './shoot'
import { activeOps, getOp, otherSeat } from './state'
import { providerAny } from './team-rules'
import type { Action, GameState, Operative } from './types'

type InterruptAction = 'shoot' | 'fight'

/** What a guarding operative could do as an interrupt right now. */
export function interruptActions(state: GameState, g: Operative): InterruptAction[] {
  const out: InterruptAction[] = []
  if (fightAvailability(state, g, null) === null) out.push('fight')
  const inCr = enemiesInControlRange(state, g, g.seat).length > 0
  if (inCr) {
    // point-blank (R-4.11): needs a ranged weapon; it targets an enemy in its own control range
    if (usableRangedWeapons(state, g, []).length > 0) out.push('shoot')
  } else if (shootAvailability(state, g, null) === null) {
    out.push('shoot')
  }
  return out
}

function clearGuard(ctx: Ctx, g: Operative, reason: string): void {
  if (!g.flags.guard) return
  g.flags.guard = false
  ctx.emit({ type: 'GuardCleared', operativeId: g.id, reason }, g.seat)
}

/**
 * After the active operative finishes an action: raise a `guard.interrupt` decision for the other
 * seat when it has an operative on guard that can act. Guards that the actor ended its action next to
 * lose their guard when no interrupt happens. True when a decision was raised.
 */
export function offerInterrupt(ctx: Ctx): boolean {
  const s = ctx.state
  const act = s.firefight.activation
  if (!act || act.frame) return false
  const actor = s.operatives[act.operativeId]
  if (!actor || actor.status !== 'active') return false
  const guardSeat = otherSeat(act.seat)
  const guards = activeOps(s).filter((o) => o.seat === guardSeat && o.flags.guard && o.wounds > 0)
  if (guards.length === 0) return false
  if (act.used?.includes('interrupt')) return false // once per enemy activation (R-4.10)
  const threatened = guards.filter((g) => inControlRange(s, bodyOf(actor), bodyOf(g)))
  const options: OptionInput[] = []
  for (const g of guards) {
    for (const a of interruptActions(s, g)) {
      options.push({
        id: `${g.id}:${a}`,
        labelKey: `guard.${a}`,
        type: 'guard.interrupt',
        payload: { operativeId: g.id, action: a },
        data: { pointBlank: a === 'shoot' && pointBlankGuard(s, g) },
      })
    }
  }
  if (options.length === 0) {
    for (const g of threatened) clearGuard(ctx, g, 'enemyInControlRange')
    return false
  }
  ctx.raise({
    kind: 'guard.interrupt',
    seat: guardSeat,
    window: 'firefight.actionEnded',
    context: { actorId: actor.id, threatened: threatened.map((g) => g.id) },
    options,
    canPass: true,
  })
  return true
}

export function handleInterrupt(state: GameState, action: Action): Handled {
  const pending = state.pending
  const threatened = ((pending?.context.threatened as string[] | undefined) ?? []).filter((id) => state.operatives[id])
  if (action.type === 'pass') {
    return {
      run(ctx) {
        // the owner declined: guards next to the actor lose their guard (R-4.9)
        for (const id of threatened) clearGuard(ctx, getOp(ctx.state, id), 'enemyInControlRange')
        continueActivation(ctx)
      },
    }
  }
  if (action.type !== 'guard.interrupt') return reject('E_WRONG_DECISION', 'expected an interrupt or a pass')
  const { operativeId, action: what } = action.payload
  return {
    run(ctx) {
      const s = ctx.state
      const act = s.firefight.activation!
      const g = getOp(s, operativeId)
      const pointBlank = what === 'shoot' && pointBlankGuard(s, g)
      act.used = [...(act.used ?? []), 'interrupt']
      ctx.emit({ type: 'GuardInterrupt', operativeId: g.id }, g.seat)
      // the interrupting operative cannot counteract for the rest of the turning point (R-4.10)
      g.flags.counteractedThisTP = true
      if (pointBlank) g.flags.cannotRetaliate = true
      const started = startFreeAction(ctx, {
        operativeId: g.id,
        action: what,
        resume: 'guard.interrupt',
        interrupt: true,
        pointBlank,
        data: { guardId: g.id, threatened },
      })
      if (!started) {
        clearGuard(ctx, g, 'interruptFailed')
        continueActivation(ctx)
      }
    },
  }
}

// The frame finished: the interrupted activation carries on if the enemy operative is still in play.
registerFrameResume('guard.interrupt', (ctx) => {
  continueActivation(ctx)
})

/** batch C shared: a guard's Shoot in an enemy control range is point-blank unless freeShootInControlRange says otherwise. */
function pointBlankGuard(state: GameState, g: Operative): boolean {
  return enemiesInControlRange(state, g, g.seat).length > 0 && !providerAny(state, g, 'freeShootInControlRange')
}
