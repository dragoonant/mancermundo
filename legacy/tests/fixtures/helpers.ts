// Test helpers: drive a game through set-up to the Firefight phase, then pin operatives where a test
// needs them. The engine state is plain data, so a test may edit a copy of it directly.
import { act } from '@/engine/actions'
import { cloneState } from '@/engine/state'
import { createGame, legalActions, step, suggestPlacement } from '@/engine'
import type { GameEvent } from '@/engine/events'
import type { Rng } from '@/engine/rng'
import { ScriptedRng } from '@/engine/rng'
import type { Action, GameSetup, GameState, MapDef, Order, PendingDecision, Seat, StepResult, Vec3, Waypoint } from '@/engine/types'
import { makeSetup, testBundle } from './team'

export function expectOk(r: StepResult): StepResult {
  if (r.rejection) throw new Error(`unexpected rejection ${r.rejection.code}: ${r.rejection.reason}`)
  return r
}

/** Apply a sequence of actions built from the current pending decision. */
export function apply(state: GameState, build: (p: PendingDecision) => Action): StepResult {
  if (!state.pending) throw new Error('no pending decision')
  return expectOk(step(state, build(state.pending)))
}

export function newGame(setup: GameSetup = makeSetup(), seed = 'test-seed'): StepResult {
  return createGame(setup, seed, testBundle)
}

export function firstOption(state: GameState): Action {
  const legal = legalActions(state)
  if (!legal || legal.length === 0) throw new Error(`no finite answer for ${state.pending?.kind}`)
  return legal[0]!
}

export interface DriveOptions {
  /** stop as soon as this returns true (checked before every answer) */
  until?: (s: GameState) => boolean
  /** pick the setup initiative holder (defaults to the roll-off winner choosing themselves) */
  maxSteps?: number
}

/** The default answer used by `drive`: scattered grid-scan deploys, self-initiative, pass gambits, end activations. */
export function defaultAnswer(s: GameState): Action {
  const p = s.pending!
  if (p.kind === 'setup.deploy') {
    const placement = suggestPlacement(s, p, undefined, Object.keys(s.operatives).indexOf(p.constraints!.operativeIds![0]!) * 41)
    if (!placement) throw new Error('no deploy spot')
    return act.deploy(p, placement.operativeId, placement.x, placement.z, placement.y)
  }
  if (p.kind === 'strategy.gambit' && p.canPass) return act.pass(p)
  if (p.kind === 'setup.decideInitiative' || p.kind === 'strategy.decideInitiative') {
    return p.options!.find((o) => (o.action.payload as { seat: string }).seat === p.seat)!.action
  }
  if (p.kind === 'firefight.action') return p.options!.find((o) => o.id === 'end')!.action
  if (p.options) return p.options[0]!.action
  if (p.canPass) return act.pass(p)
  throw new Error(`cannot auto-answer ${p.kind}`)
}

/** Answer decisions with simple defaults until `until` holds. */
export function drive(
  state: GameState,
  until: (s: GameState) => boolean,
  maxSteps = 500,
  rng?: Rng,
  events?: GameEvent[],
): GameState {
  let s = state
  for (let i = 0; i < maxSteps; i++) {
    if (until(s) || !s.pending) return s
    const r = expectOk(step(s, defaultAnswer(s), rng))
    events?.push(...r.events)
    s = r.state
  }
  throw new Error('drive: step limit reached')
}

/**
 * Play set-up and the first Strategy phase. With `dice` (default A wins both roll-offs, so A holds
 * initiative) the four roll-off dice are forced.
 */
export function toFirefight(
  setup: GameSetup = makeSetup(),
  seed = 'test-seed',
  dice: number[] | null = [6, 1, 6, 1],
): GameState {
  const s = newGame(setup, seed).state
  return drive(s, (st) => st.pending?.kind === 'firefight.activate', 500, dice ? new ScriptedRng(dice) : undefined)
}

export function place(state: GameState, id: string, x: number, z: number, y = 0): GameState {
  const s = cloneState(state)
  s.operatives[id]!.pos = { x, y, z } as Vec3
  return s
}

export function patchOp(state: GameState, id: string, patch: Record<string, unknown>): GameState {
  const s = cloneState(state)
  Object.assign(s.operatives[id]!, patch)
  return s
}

/** Activate an operative of the seat on turn and choose its order; returns the state at firefight.action. */
export function activate(state: GameState, id: string, order: Order = 'engage'): GameState {
  let s = apply(state, (p) => act.activate(p, id)).state
  s = apply(s, (p) => act.order(p, order)).state
  return s
}

export function ids(state: GameState, seat: 'A' | 'B'): string[] {
  return Object.values(state.operatives)
    .filter((o) => o.seat === seat)
    .map((o) => o.id)
}

export type P = [number, number] | [number, number, number]

export interface Arena {
  state: GameState
  me: Seat
  foe: Seat
  /** active operative, its friend, and two enemies (ids) */
  m: string
  f: string
  e: string
  e2: string
}

const PARK: Record<Seat, [number, number][]> = {
  A: [
    [-13, -10.5],
    [-11, -10.5],
    [-9, -10.5],
  ],
  B: [
    [13, 10.5],
    [11, 10.5],
    [9, 10.5],
  ],
}

/**
 * A Firefight-phase state with A on turn and the named operatives pinned where the test wants them;
 * everyone else is parked in the far corners.
 */
export function arena(map: MapDef, spec: { m: P; f?: P; e?: P; e2?: P }): Arena {
  let s = toFirefight(makeSetup({ map }), 'arena')
  const me: Seat = s.pending!.seat
  const foe: Seat = me === 'A' ? 'B' : 'A'
  const ids = { m: `${me}1`, f: `${me}2`, e: `${foe}1`, e2: `${foe}2` }
  const put = (id: string, p: P) => {
    s = place(s, id, p[0], p[1], p[2] ?? 0)
  }
  Object.values(s.operatives).forEach((o) => {
    const idx = Number(o.id.slice(1)) - 1
    const [x, z] = PARK[o.seat][idx]!
    s = place(s, o.id, x, z, 0)
  })
  put(ids.m, spec.m)
  if (spec.f) put(ids.f, spec.f)
  if (spec.e) put(ids.e, spec.e)
  if (spec.e2) put(ids.e2, spec.e2)
  return { state: s, me, foe, ...ids }
}

/** Activate `id`, choose its order and declare a move action; returns the state at move.path. */
export function declareMove(state: GameState, id: string, kind: string, order: Order = 'engage'): GameState {
  const s = activate(state, id, order)
  return apply(s, (p) => act.action(p, kind)).state
}

export function path(state: GameState, wps: Waypoint[]): StepResult {
  return step(state, act.path(state.pending!, wps))
}

export function moved(r: StepResult): Extract<GameEvent, { type: 'OperativeMoved' }> {
  const ev = r.events.find((e) => e.type === 'OperativeMoved')
  if (!ev || ev.type !== 'OperativeMoved') throw new Error(`no OperativeMoved (${r.rejection?.code}: ${r.rejection?.reason})`)
  return ev
}
