// Public engine API (frozen after M2): createGame / step / legalActions / validate / replay / view /
// save / load / undo. The client store and tools/sim-core.ts are the only callers of `step`.
import { step, validate } from './apply'
import type { EngineBundle } from './bundle'
import { createGame, ENGINE_VERSION, suggestPlacement } from './setup'
import { EngineInvariantError } from './state'
import type { Action, GameSetup, GameState, PendingDecision, SaveFile, StepResult } from './types'
import { view } from './view'

export { createGame, ENGINE_VERSION, step, suggestPlacement, validate, view, EngineInvariantError }
export type { EngineBundle }
export * from './types'
export type { GameEvent, GameEventBody } from './events'
export { act, makeAction } from './actions'
export { ReplayDecider } from './decider'
export type { Decider } from './decider'
export { ScriptedRng, SeededRng, sha256Hex, fnv1a } from './rng'
export type { Rng } from './rng'
// M2b-game: the data adapter, real-team setups and the mission view (query.mission)
export {
  bundleFromData,
  defaultEquipmentFor,
  defaultLoadoutFor,
  defaultRosterFor,
  defaultTeamChoicesFor,
  enumerateLoadoutChoices,
  layoutMap,
  realSetup,
  resolveLoadoutChoice,
  validateLoadoutChoice,
} from './bundle'
export { missionView } from './missions'
export type { MissionView } from './missions'

/**
 * Enumerated answers for a finite decision (each passes `validate`); `null` for continuous
 * decisions (move paths, set-up positions), which are answered by constructing an action within
 * `pending.constraints` - such decisions with `canPass` can always be cancelled.
 */
export function legalActions(state: GameState, pending: PendingDecision | null = state.pending): Action[] | null {
  if (!pending) return []
  if (!pending.options) return null
  const out: Action[] = pending.options.map((o) => o.action)
  if (pending.canPass) {
    out.push({ type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} })
  }
  return out
}

export interface ReplayResult extends StepResult {
  /** state hash after createGame and after each replayed action (length = actions replayed + 1) */
  hashes: string[]
  /** index of the first action that was rejected, if any */
  failedAt?: number
}

/** Fold `step` from `createGame`; load, undo, tests and later multiplayer all use this. */
export function replay(setup: GameSetup, seed: string, actions: Action[], bundle: EngineBundle): ReplayResult {
  let result: StepResult = createGame(setup, seed, bundle)
  const hashes = [result.state.hash]
  for (let i = 0; i < actions.length; i++) {
    const next = step(result.state, actions[i]!)
    if (next.rejection) {
      return { ...result, rejection: next.rejection, hashes, failedAt: i }
    }
    result = next
    hashes.push(result.state.hash)
  }
  return { ...result, hashes }
}

export function save(state: GameState): SaveFile {
  return {
    version: 1,
    engineVersion: state.engineVersion,
    setup: state.origin.setup,
    seed: state.seed,
    actions: state.log.slice(),
    finalHash: state.hash,
  }
}

export function load(file: SaveFile, bundle: EngineBundle): StepResult {
  if (file.version !== 1) throw new EngineInvariantError(`unsupported save version ${String(file.version)}`)
  const r = replay(file.setup, file.seed, file.actions, bundle)
  if (r.rejection) {
    throw new EngineInvariantError(`save replay rejected action ${r.failedAt}: ${r.rejection.code} ${r.rejection.reason}`)
  }
  if (r.state.hash !== file.finalHash) {
    throw new EngineInvariantError(`save hash mismatch: ${r.state.hash} != ${file.finalHash}`)
  }
  return r
}

/**
 * Take back the last accepted action by replaying the log without it. Refused (null) when there is
 * nothing to undo or the last action rolled dice (undo vs AI only covers dice-free actions).
 */
export function undo(state: GameState, bundle: EngineBundle): StepResult | null {
  if (state.log.length === 0) return null
  if (state.lastRollSeq === state.seq - 1) return null
  const r = replay(state.origin.setup, state.seed, state.log.slice(0, -1), bundle)
  return r.rejection ? null : r
}

