// Decider interface (frozen after M2): human UI, AI, random bot and replay all implement it.
import type { Action, PendingDecision, PlayerView } from './types'

export interface Decider {
  decide(view: PlayerView, pending: PendingDecision, legal: Action[] | null): Promise<Action>
  cancel?(): void
}

/** Feeds a recorded action list back, ignoring the view. Used by replay, load and tests. */
export class ReplayDecider implements Decider {
  private i = 0
  constructor(private readonly actions: Action[]) {}

  decide(): Promise<Action> {
    const next = this.actions[this.i++]
    if (!next) return Promise.reject(new Error('ReplayDecider: no more recorded actions'))
    return Promise.resolve(next)
  }

  get position(): number {
    return this.i
  }
}
