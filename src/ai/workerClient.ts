// A `Decider` that asks the AI worker (src/ai/worker.ts) for each answer, so a slow decision never blocks rendering. Without a
// `Worker` (node, tests, a browser that refuses one) or when the worker errors or takes longer than `timeoutMs`, the answer
// is computed in-process by the same code (`handleRequest`), so the game always continues. One worker is shared by every client.
// The client's bot loop is the only user; it imports nothing from here but this class.
import type { Action, Decider, PendingDecision, PlayerView } from '@/engine'
import { handleRequest, type WorkerRequest, type WorkerResponse } from './worker'
import type { Tier } from './tiers'

export interface AiWorkerClientOpts {
  tier: Tier
  /** the game seed plus the seat, e.g. `${seed}:B` (one stream per bot) */
  seed: string
  /** deciders keep their activation memory per key; default: the seed */
  memoryKey?: string
  /** answer in-process after this long (default 3000 ms) */
  timeoutMs?: number
  budgetMs?: number
}

let shared: Worker | null | undefined
let nextId = 1
const waiting = new Map<number, (res: WorkerResponse) => void>()

function worker(): Worker | null {
  if (shared !== undefined) return shared
  if (typeof Worker === 'undefined') {
    shared = null
    return shared
  }
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const done = waiting.get(ev.data.id)
      if (done) {
        waiting.delete(ev.data.id)
        done(ev.data)
      }
    }
    w.onerror = () => {
      // the worker is broken: answer everything in-process from now on
      shared = null
      for (const [id, done] of waiting) {
        waiting.delete(id)
        done({ type: 'error', id, message: 'worker error' })
      }
    }
    shared = w
  } catch {
    shared = null
  }
  return shared
}

export class AiWorkerClient implements Decider {
  private readonly key: string
  constructor(private readonly opts: AiWorkerClientOpts) {
    this.key = opts.memoryKey ?? opts.seed
  }

  private request(view: PlayerView, pending: PendingDecision, legal: Action[] | null, id: number): WorkerRequest {
    return { type: 'decide', id, view, pending, legal, tier: this.opts.tier, seed: this.opts.seed, memoryKey: this.key, ...(this.opts.budgetMs ? { budgetMs: this.opts.budgetMs } : {}) }
  }

  decide(view: PlayerView, pending: PendingDecision, legal: Action[] | null): Promise<Action> {
    const id = nextId++
    const req = this.request(view, pending, legal, id)
    const inline = (): Action => {
      const res = handleRequest(req)
      if (!res || res.type !== 'action') throw new Error(res && res.type === 'error' ? res.message : 'the AI gave no answer')
      return res.action
    }
    const w = worker()
    if (!w) {
      try {
        return Promise.resolve(inline())
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    return new Promise<Action>((resolve, reject) => {
      const fallBack = () => {
        waiting.delete(id)
        try {
          resolve(inline())
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      }
      const timer = setTimeout(fallBack, this.opts.timeoutMs ?? 3000)
      waiting.set(id, (res) => {
        clearTimeout(timer)
        if (res.type === 'action') resolve(res.action)
        else fallBack()
      })
      try {
        w.postMessage(req)
      } catch {
        clearTimeout(timer)
        fallBack()
      }
    })
  }

  /** A new game: the worker forgets every decider (and so every activation memory). */
  static reset(): void {
    shared?.postMessage({ type: 'reset' } satisfies WorkerRequest)
    handleRequest({ type: 'reset' })
  }
}
