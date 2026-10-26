// Shared helpers for the AI tests: sampled real-game states, a driver that plays decisions with AI deciders.
import { createGame, legalActions, step, view, type Action, type GameState, type Seat } from '@/engine'
import { bundleFromData, realSetup, type EngineBundle } from '@/engine/bundle'
import { loadBundle } from '../../src/data'
import { RandomBot } from '../../tools/sim-core'
import type { AiDecider } from '../../src/ai/decider'

let bundle: EngineBundle | null = null
export function realBundle(): EngineBundle {
  return (bundle ??= bundleFromData(loadBundle()))
}

export function realSetupFor(teams: [string, string], layoutIndex = 0) {
  const b = realBundle()
  const layouts = Object.keys(b.layouts ?? {}).sort()
  return realSetup(b, { teams, layoutId: layouts[layoutIndex % layouts.length]! })
}

/** Play a seeded random-vs-random real game and keep every `every`-th state that still has a pending decision. */
export function sampleStates(seed: string, every: number, max: number): GameState[] {
  const setup = realSetupFor(['angels-of-death', 'kommandos'])
  let state = createGame(setup, seed, realBundle()).state
  const bots = { A: new RandomBot(`${seed}:A`), B: new RandomBot(`${seed}:B`) }
  const out: GameState[] = []
  let n = 0
  while (state.pending && out.length < max && n < 4000) {
    if (n % every === 0) out.push(state)
    const r = step(state, bots[state.pending.seat].decide(state, state.pending))
    if (r.rejection) throw new Error(`random bot rejected: ${r.rejection.reason}`)
    state = r.state
    n++
  }
  return out
}

/** Answer decisions with the given deciders until `stop` holds (or the game ends). */
export function drive(state: GameState, deciders: Record<Seat, AiDecider>, stop: (s: GameState) => boolean, max = 600): GameState {
  let s = state
  for (let i = 0; i < max && s.pending; i++) {
    if (stop(s)) return s
    const p = s.pending
    const a: Action = deciders[p.seat].decideSync(view(s, p.seat), p, legalActions(s, p)).action
    const r = step(s, a)
    if (r.rejection) throw new Error(`rejected ${p.kind}: ${r.rejection.code} ${r.rejection.reason}`)
    s = r.state
  }
  return s
}
