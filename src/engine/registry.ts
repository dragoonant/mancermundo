// Module plumbing: one ModuleDef per namespace owner, the per-step context, decision raising.
import type { DiceKind, GameEvent, GameEventBody } from './events'
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
  /**
   * Roll `n` dice of `die` (default 'd6'). Every roll emits one `DiceRolled`. 'd6', 'firepower' and 'injury' return the
   * raw D6 results (face names go into the event from core/dice.json); 'd3' returns D3 results; '2d6' returns n sums
   * (the event lists the 2n raw dice). 'scatter' is not rolled here: use `rollScatter`.
   */
  roll(purpose: string, n: number, die?: DiceKind): number[]
  /** One scatter direction in whole degrees [0, 360): a single `rng.int(360)` draw, emitted as a 'scatter' die. */
  rollScatter(purpose: string): number
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
        round: ctx.state.round,
        phase: ctx.state.phase,
        seat: seat === undefined ? (action ? action.seat : null) : seat,
      } as GameEvent
      ctx.events.push(ev)
    },
    roll(purpose, n, die = 'd6') {
      const raw: number[] = []
      let results: number[]
      if (die === 'scatter') throw new EngineInvariantError('use ctx.rollScatter for scatter dice')
      if (die === '2d6') {
        for (let i = 0; i < n * 2; i++) raw.push(rng.d6())
        results = Array.from({ length: n }, (_, i) => raw[2 * i]! + raw[2 * i + 1]!)
      } else {
        for (let i = 0; i < n; i++) raw.push(die === 'd3' ? Math.ceil(rng.d6() / 2) : rng.d6())
        results = raw
      }
      ctx.rolled = true
      const table = die === 'firepower' || die === 'injury' ? ctx.state.data.dice[die] : undefined
      const faces = table ? raw.map((d) => table[d - 1] ?? String(d)) : undefined
      ctx.emit({ type: 'DiceRolled', purpose, die, dice: raw, ...(faces ? { faces } : {}), final: true })
      return results
    },
    rollScatter(purpose) {
      const src = rng as Rng & { int?: (n: number) => number }
      if (typeof src.int !== 'function') throw new EngineInvariantError('this Rng cannot draw a scatter direction (rng.int)')
      const degrees = src.int(360)
      ctx.rolled = true
      ctx.emit({ type: 'DiceRolled', purpose, die: 'scatter', dice: [degrees], final: true })
      return degrees
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

/** A module that owns namespaces whose rules arrive in a later stage: every action is rejected with E_TODO. */
export function stubModule(id: string, namespaces: string[]): ModuleDef {
  return {
    id,
    namespaces,
    handle(_state, action) {
      return reject('E_TODO', `${action.type} is not implemented yet (module ${id})`)
    },
  }
}

export function requireModule(map: Map<string, ModuleDef>, kind: string): ModuleDef {
  const ns = kind.split('.')[0]!
  const mod = map.get(ns)
  if (!mod) throw new EngineInvariantError(`no module owns decision kind ${kind}`)
  return mod
}

/**
 * End the battle at once (resign, concede, round limit, scenario victory): sets the result, emits GameEnded and closes the
 * phase. `loser` is the seat that resigned or conceded; without it the points decide.
 */
export function endGame(ctx: Ctx, reason: 'resign' | 'concede' | 'roundLimit' | 'scenario', loser?: Seat): void {
  const s = ctx.state
  const points = { A: s.players.A.points, B: s.players.B.points }
  const winner = loser ? (loser === 'A' ? 'B' : 'A') : points.A === points.B ? 'draw' : points.A > points.B ? 'A' : 'B'
  s.result = { winner, points, reason }
  s.phase = 'ended'
  s.pending = null
  ctx.emit({ type: 'GameEnded', result: s.result }, null)
}
