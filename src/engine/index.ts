// Public engine API (frozen after M2): createGame / step / legalActions / validate / replay / view / suggest /
// save / load / undo. The client store and tools/sim-core.ts are the only callers of `step`.
import { step, validate } from './apply'
import { bundleFromData, rosterFromStarter, type EngineBundle } from './bundle'
import { actionMenu } from './activation'
import * as queryCore from './query'
import { suggestMovePath } from './movement'
import { createGame, ENGINE_VERSION, suggestDeploy } from './setup'
import { EngineInvariantError } from './state'
import type { Action, GameSetup, GameState, PendingDecision, SaveFile, StepResult } from './types'
import { view } from './view'

export { createGame, ENGINE_VERSION, step, validate, view, EngineInvariantError, bundleFromData, rosterFromStarter }

/** query.*: every number or verdict the UI and the AI read (00 section 7.6). */
export const query = { ...queryCore, actionMenu }
export type { EngineBundle }
export * from './types'
export type { GameEvent, GameEventBody } from './events'
export { act, makeAction } from './actions'
export { ReplayDecider } from './decider'
export type { Decider } from './decider'
export { ScriptedRng, SeededRng, sha256Hex, fnv1a } from './rng'
export type { Rng } from './rng'

/**
 * Enumerated answers for a finite decision (each passes `validate`); `null` for continuous
 * decisions (move paths, set-up positions, aim points), which are answered by constructing an action within
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


/**
 * Engine default for a decision: the first offered option of a finite decision; for the continuous kinds, the engine's best
 * deploy spot and a short legal path toward the nearest enemy (or a cancel when none exists). Casket and aim spots arrive
 * with S3a / S4 and return null until then. Used by auto options, the random bot and the AI fallback.
 */
export function suggest(state: GameState, pending: PendingDecision | null = state.pending): Action | null {
  if (!pending) return null
  const first = pending.options?.[0]
  if (first) return first.action
  switch (pending.kind) {
    case 'setup.deploy':
      return suggestDeploy(state, pending)
    case 'move.path':
      return suggestMovePath(state, pending)
    default:
      return null
  }
}
