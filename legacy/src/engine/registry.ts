// Module plumbing: one ModuleDef per namespace owner, the per-step context, decision raising.
import type { GameEvent, GameEventBody } from './events'
import type { Rng } from './rng'
import type {
  Action,
  ActionType,
  DecisionKind,
  DecisionOption,
  GameState,
  MoveConstraints,
  PendingDecision,
  Rejection,
  RejectionCode,
  Seat,
  TimingWindowId,
} from './types'
import { EngineInvariantError } from './state'

export interface OptionInput {
  id: string
  labelKey: string
  type: ActionType
  payload: unknown
  data?: Record<string, unknown>
}

export interface RaiseInput {
  kind: DecisionKind
  seat: Seat
  window: TimingWindowId
  context?: Record<string, unknown>
  options?: OptionInput[]
  constraints?: MoveConstraints
  canPass?: boolean
}

/** Mutable per-step context handed to a module's `run`. `state` is a private draft copy. */
export interface Ctx {
  state: GameState
  rng: Rng
  /** the accepted action, or null while building the initial state */
  action: Action | null
  events: GameEvent[]
  /** true once any die was rolled in this step */
  rolled: boolean
  emit(body: GameEventBody, seat?: Seat | null): void
  roll(purpose: string, n: number): number[]
  raise(input: RaiseInput): void
}

export type Handled = { rejection: Rejection } | { run: (ctx: Ctx) => void }

export interface ModuleDef {
  id: string
  /** decision-kind namespaces this module owns, e.g. ['setup'] */
  namespaces: string[]
  /**
   * Validate `action` (already checked for envelope, seat, pass and, for finite decisions, option
   * membership) against `state` and return either a rejection or the closure that applies it.
   * Heavy work happens once here; `run` only mutates the draft.
   */
  handle(state: GameState, action: Action, pending: PendingDecision): Handled
  /**
   * Optional: when an action is not one of the offered options, say why (for example
   * E_ACTION_RESTRICTED instead of the generic E_NOT_AN_OPTION).
   */
  explain?(state: GameState, action: Action, pending: PendingDecision): Rejection | null
}

export function reject(code: RejectionCode, reason: string, details?: Record<string, unknown>): { rejection: Rejection } {
  return { rejection: details ? { code, reason, details } : { code, reason } }
}

export function createCtx(state: GameState, rng: Rng, action: Action | null, seq: number): Ctx {
  const ctx: Ctx = {
    state,
    rng,
    action,
    events: [],
    rolled: false,
    emit(body, seat) {
      const ev = {
        ...body,
        seq,
        turningPoint: ctx.state.turningPoint,
        phase: ctx.state.phase,
        seat: seat === undefined ? (action ? action.seat : null) : seat,
      } as GameEvent
      ctx.events.push(ev)
    },
    roll(purpose, n) {
      const dice: number[] = []
      for (let i = 0; i < n; i++) dice.push(rng.d6())
      ctx.rolled = true
      ctx.emit({ type: 'DiceRolled', purpose, dice, final: true })
      return dice
    },
    raise(input) {
      const s = ctx.state
      const id = `d:${s.nextDecision++}`
      const options: DecisionOption[] | undefined = input.options?.map((o) => ({
        id: o.id,
        labelKey: o.labelKey,
        action: { type: o.type, seat: input.seat, decisionId: id, payload: o.payload } as Action,
        ...(o.data ? { data: o.data } : {}),
      }))
      const pending: PendingDecision = {
        id,
        seat: input.seat,
        kind: input.kind,
        window: input.window,
        context: input.context ?? {},
        canPass: input.canPass ?? false,
      }
      if (options) pending.options = options
      if (input.constraints) pending.constraints = input.constraints
      s.pending = pending
      ctx.emit({ type: 'DecisionRequested', decisionId: id, kind: input.kind, window: input.window }, input.seat)
    },
  }
  return ctx
}

/** A module that owns namespaces whose rules arrive in M2b: every action is rejected with E_TODO. */
export function stubModule(id: string, namespaces: string[]): ModuleDef {
  return {
    id,
    namespaces,
    handle(_state, action) {
      return reject('E_TODO', `${action.type} is not implemented until M2b (${id})`)
    },
  }
}

export function requireModule(map: Map<string, ModuleDef>, kind: string): ModuleDef {
  const ns = kind.split('.')[0]!
  const mod = map.get(ns)
  if (!mod) throw new EngineInvariantError(`no module owns decision kind ${kind}`)
  return mod
}
