// Client test fixtures: a real game (Goliath against Escher on the Foundry Run) driven by the client's random bot, with the
// events of every step kept so presentation and prompt tests can replay them as batches; a Map-backed localStorage; and helpers
// to answer a pending decision the way the UI would.
import { createGame, step, type Action, type GameEvent, type GameState, type PendingDecision } from '@/engine'
import { RandomBot } from '@/client/bot/randomBot'
import type { Batch } from '@/client/presentation/director'
import { realBundle, realSetup } from './real'

export interface Played {
  state: GameState
  /** every step: the action, its events and the state after */
  steps: { action: Action; events: GameEvent[]; state: GameState; pending: PendingDecision | null }[]
  created: { events: GameEvent[]; state: GameState; pending: PendingDecision | null }
}

/** A new real game; deployment is by the players (not automatic) unless `autoDeploy`. */
export function newRealGame(seed = 'fixture', autoDeploy = false): { state: GameState; events: GameEvent[]; pending: PendingDecision | null } {
  const setup = realSetup({ scenarioId: 'scn.tunnel-skirmish', options: { autoCrew: true, autoCaskets: true, ...(autoDeploy ? { autoDeploy: true } : {}) } })
  const r = createGame(setup, seed, realBundle())
  return { state: r.state, events: r.events, pending: r.pending }
}

/** Play `until` (default: the end of round 1) with the random bot answering for both seats. */
export function playGame(seed = 'fixture', until: (s: GameState) => boolean = (s) => s.round >= 2, maxSteps = 3000): Played {
  const created = newRealGame(seed)
  const bots = { A: new RandomBot(`${seed}:A`), B: new RandomBot(`${seed}:B`) }
  let state = created.state
  let pending = created.pending
  const steps: Played['steps'] = []
  while (pending && state.phase !== 'ended' && !until(state) && steps.length < maxSteps) {
    const action = bots[pending.seat].decide(state, pending)
    const r = step(state, action)
    if (r.rejection) throw new Error(`bot action rejected: ${r.rejection.code} ${r.rejection.reason}`)
    state = r.state
    pending = r.pending
    steps.push({ action, events: r.events, state, pending })
  }
  return { state, steps, created: { events: created.events, state: created.state, pending: created.pending } }
}

export function batchOf(state: GameState, events: GameEvent[]): Batch {
  return { seq: state.seq, events, state }
}

/** A minimal localStorage for node tests. */
export class MemoryStorage {
  private readonly m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
}

export function installStorage(): MemoryStorage {
  const s = new MemoryStorage()
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = s
  return s
}

/** Wait until `cond` holds (polling the event loop), or throw after `ms`. */
export async function until(cond: () => boolean, ms = 15000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for the condition')
    await new Promise((r) => setTimeout(r, 5))
  }
}
