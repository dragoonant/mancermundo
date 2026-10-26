// Test helpers: get a game to the Action phase quickly, put fighters exactly where a rule test needs them, and answer
// decisions by naming the option instead of building envelopes.
import { act, createGame, legalActions, step } from '@/engine'
import type { EngineBundle } from '@/engine/bundle'
import { cloneState } from '@/engine/state'
import type { Rng } from '@/engine/rng'
import type { Action, DecisionOption, GameEvent, GameSetup, GameState, PendingDecision, Posture, Seat, StepResult } from '@/engine'
import { makeSetup, testBundle } from './gang'

export interface StartOptions {
  setup?: Partial<GameSetup>
  seed?: string
  bundle?: EngineBundle
  /** skip the round-1 priority roll (default 'A'; null rolls for it) */
  firstPriority?: Seat | null
  /** extra setup options (maxRounds ...) */
  options?: NonNullable<GameSetup['options']>
  /** dice for the step that finishes set-up (the round-1 priority roll when `firstPriority` is false) */
  rng?: Rng
}

/**
 * A game at its first `action.activate`: crews, halves and deployment are answered by the engine (autoCrew / autoDeploy), the
 * role choice is answered 'first' / 'attacker', and the Priority player is `firstPriority` (default A).
 */
export function startGame(opts: StartOptions = {}): StepResult {
  const bundle = opts.bundle ?? testBundle
  const priority = opts.firstPriority === undefined ? 'A' : opts.firstPriority
  const setup = makeSetup({
    ...opts.setup,
    options: { autoCrew: true, autoDeploy: true, ...(priority ? { firstPriority: priority } : {}), ...opts.options },
  })
  const created = createGame(setup, opts.seed ?? 'test-seed', bundle)
  const pending = created.pending!
  const choice = pending.options![0]!.action
  return step(created.state, choice, opts.rng)
}

export interface Spot {
  x: number
  z: number
  facing?: number
  posture?: Posture
}

/** A copy of the state with fighters moved to exact spots (and optionally turned or laid down). Leaves `pending` alone. */
export function place(state: GameState, spots: Record<string, Spot>): GameState {
  const s = cloneState(state)
  for (const [id, sp] of Object.entries(spots)) {
    const f = s.fighters[id]
    if (!f) throw new Error(`place: no fighter ${id}`)
    f.location = 'board'
    f.pos = { x: sp.x, y: 0, z: sp.z }
    f.facing = sp.facing ?? f.facing
    if (sp.posture) f.posture = sp.posture
  }
  return s
}

/** A copy of the state after an arbitrary edit of the draft (door states, conditions, weapons ...). */
export function edit(state: GameState, fn: (draft: GameState) => void): GameState {
  const s = cloneState(state)
  fn(s)
  return s
}

/** Move every fighter that is not named off to a far corner spot so nothing interferes (still on the board). */
export function parkOthers(state: GameState, keep: string[]): GameState {
  const s = cloneState(state)
  let k = 0
  for (const f of Object.values(s.fighters)) {
    if (keep.includes(f.id)) continue
    f.location = 'board'
    f.pos = { x: -10.5 + (k % 8) * 3, y: 0, z: 16 - Math.floor(k / 8) * 3 }
    k++
  }
  return s
}

export function optionOf(pending: PendingDecision, match: (o: DecisionOption) => boolean): DecisionOption {
  const o = pending.options?.find(match)
  if (!o) {
    const have = pending.options?.map((x) => x.id).join(', ') ?? '(continuous)'
    throw new Error(`no such option in ${pending.kind}; have: ${have}`)
  }
  return o
}

/** Take the option of the pending decision whose payload fields match `where`. */
export function take(state: GameState, where: Record<string, unknown>, rng?: Rng): StepResult {
  const pending = state.pending!
  const o = optionOf(pending, (opt) => Object.entries(where).every(([k, v]) => (opt.action.payload as Record<string, unknown>)[k] === v))
  return step(state, o.action, rng)
}

/** The ids offered by the pending decision. */
export function offered(state: GameState): string[] {
  return (state.pending?.options ?? []).map((o) => o.id)
}

/** The `action` ids of the pending `action.choose` options. */
export function menuActions(state: GameState): string[] {
  return [...new Set((state.pending?.options ?? []).map((o) => (o.action.payload as { action: string }).action))]
}

/** Activate a fighter and (when the fighter leads a group) decline to nominate; lands on the fighter's first action.choose. */
export function activate(state: GameState, fighterId: string, rng?: Rng): StepResult {
  let r = take(state, { fighterId }, rng)
  if (r.pending?.kind === 'action.group') r = step(r.state, act.groupDone(r.pending), rng)
  return r
}

/** Answer a move.path with waypoints. */
export function moveTo(state: GameState, waypoints: { x: number; z: number }[], facing?: number, rng?: Rng): StepResult {
  return step(state, act.path(state.pending!, waypoints, facing), rng)
}

export function eventsOf<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)
}

export function must(r: StepResult): StepResult {
  if (r.rejection) throw new Error(`unexpected rejection ${r.rejection.code}: ${r.rejection.reason}`)
  return r
}

/** Every legal answer of the pending decision passes `validate`-style stepping (used by option sanity tests). */
export function legal(state: GameState): Action[] {
  return legalActions(state) ?? []
}

/**
 * Play the rest of the current round by ending every activation at once (declining group nominations), passing the same
 * dice source to every step. End phase decisions get the plain answer: take the Bottle test, no flight, no assistance, the first
 * recovery die, play on after a locked win. Stops when the round counter changes or the game ends; returns the last result.
 */
export function endRound(state: GameState, rng?: Rng): StepResult {
  const round = state.round
  let r: StepResult = { state, events: [], pending: state.pending }
  let guard = 0
  while (r.state.phase !== 'ended' && r.state.round === round && guard++ < 500) {
    const p = r.state.pending!
    let next: StepResult
    if (p.kind === 'action.activate') next = step(r.state, p.options![0]!.action, rng)
    else if (p.kind === 'action.group') next = step(r.state, act.groupDone(p), rng)
    else if (p.kind === 'action.choose') next = step(r.state, act.endActivation(p), rng)
    else if (p.kind === 'action.flee') next = step(r.state, act.fleeDone(p), rng)
    else if (p.kind === 'end.bottle') next = step(r.state, act.bottle(p, 'test'), rng)
    else if (p.kind === 'end.assist') next = step(r.state, act.assistNone(p), rng)
    else if (p.kind === 'end.recoveryPick') next = step(r.state, p.options![0]!.action, rng)
    else if (p.kind === 'confirm') next = step(r.state, act.confirm(p, 'continue'), rng)
    else throw new Error(`endRound: cannot answer ${p.kind}`)
    if (next.rejection) throw new Error(`endRound: ${next.rejection.code} ${next.rejection.reason}`)
    r = next
  }
  return r
}

export interface PlayOut {
  state: GameState
  /** the events of every step played */
  events: GameEvent[]
  pending: PendingDecision | null
  /** decisions answered by the helper, in order (kind only) */
  answered: string[]
}

export interface PlayOutOptions {
  /** answer a decision yourself (return the action) or let the default take it (return null) */
  answer?: (p: PendingDecision, s: GameState) => Action | null
  /** stop before answering this decision */
  stopAt?: (p: PendingDecision, s: GameState) => boolean
}

/**
 * Play on from an Action phase: every activation is ended at once (group nominations declined), then the End phase: the Bottle
 * test is taken, no flight, no assistance, the first (kindest) recovery die, play on after a locked win. Stops when the round
 * counter changes, the game ends or `stopAt` matches; collects every event so a test can read the order of the End phase.
 */
export function playOut(state: GameState, rng?: Rng, opts: PlayOutOptions = {}): PlayOut {
  const round = state.round
  const events: GameEvent[] = []
  const answered: string[] = []
  let cur = state
  for (let guard = 0; guard < 800; guard++) {
    if (cur.phase === 'ended' || cur.round !== round || !cur.pending) break
    const p = cur.pending
    if (opts.stopAt?.(p, cur)) break
    let action = opts.answer?.(p, cur) ?? null
    if (!action) {
      switch (p.kind) {
        case 'action.activate':
        case 'end.recoveryPick':
          action = p.options![0]!.action
          break
        case 'action.group':
          action = act.groupDone(p)
          break
        case 'action.choose':
          action = act.endActivation(p)
          break
        case 'action.flee':
          action = act.fleeDone(p)
          break
        case 'end.bottle':
          action = act.bottle(p, 'test')
          break
        case 'end.assist':
          action = act.assistNone(p)
          break
        case 'confirm':
          action = act.confirm(p, 'continue')
          break
        default:
          throw new Error(`playOut: cannot answer ${p.kind}`)
      }
    }
    const r = step(cur, action, rng)
    if (r.rejection) throw new Error(`playOut: ${r.rejection.code} ${r.rejection.reason} (${p.kind})`)
    answered.push(p.kind)
    events.push(...r.events)
    cur = r.state
  }
  return { state: cur, events, pending: cur.pending, answered }
}
