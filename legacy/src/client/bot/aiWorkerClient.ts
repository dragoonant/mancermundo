// Client side of the AI worker (docs/spec/40-ai). Posts the bot seat's view, the open decision and the legal answers
// to `src/ai/worker.ts` and resolves with its action; after BOT_TIMEOUT_MS (3 s) or on any worker failure it answers
// with the random policy so a stuck worker can never freeze the game. Where there is no Worker (node tests, very old
// browsers) the same core runs inline. `spawn` and `timeoutMs` are injectable so tests can simulate a dead worker.
import type { Action, PendingDecision, PlayerView } from '@/engine'
import type { WorkerRequest, WorkerResponse } from '@/ai/worker'
// The AI itself (decider, planner, weights) runs in the Worker. The main bundle only imports it on demand, for the
// random fallback and for the inline path where there is no Worker, so the start screen never downloads it.
import type { BotTier } from './botTier'

export { getBotTier, setBotTier, type BotTier } from './botTier'
export const BOT_TIMEOUT_MS = 3000

/** The slice of the Worker API the client uses (a test double implements it). */
export interface WorkerLike {
  postMessage(m: WorkerRequest): void
  terminate(): void
  onmessage: ((ev: { data: WorkerResponse }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface AiClientOpts {
  /** create the worker; return null to run the AI inline */
  spawn?: () => WorkerLike | null
  timeoutMs?: number
  /** per-decision budget handed to the AI (ms) */
  budgetMs?: number
}

export interface AiAnswer {
  action: Action
  /** where the answer came from */
  source: 'worker' | 'inline' | 'fallback'
  ms: number
}

function defaultSpawn(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('../../ai/worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
  } catch {
    return null
  }
}

interface Waiting {
  resolve: (a: AiAnswer) => void
  timer: ReturnType<typeof setTimeout>
  req: Extract<WorkerRequest, { type: 'decide' }>
  t0: number
}

export class AiWorkerClient {
  private worker: WorkerLike | null = null
  /** the inline core has been used (so `reset` has memory to clear) */
  private inlineUsed = false
  private spawned = false
  private nextId = 1
  private readonly waiting = new Map<number, Waiting>()
  private readonly spawn: () => WorkerLike | null
  private readonly timeoutMs: number
  private readonly budgetMs: number | undefined
  /** answers that came from the random fallback (timeouts and errors), for diagnostics */
  fallbacks = 0

  constructor(opts: AiClientOpts = {}) {
    this.spawn = opts.spawn ?? defaultSpawn
    this.timeoutMs = opts.timeoutMs ?? BOT_TIMEOUT_MS
    this.budgetMs = opts.budgetMs
  }

  private ensureWorker(): WorkerLike | null {
    if (this.spawned) return this.worker
    this.spawned = true
    const w = this.spawn()
    this.worker = w
    if (w) {
      w.onmessage = (ev) => this.onMessage(ev.data)
      w.onerror = () => this.failAll()
    }
    return w
  }

  private onMessage(res: WorkerResponse): void {
    const w = this.waiting.get(res.id)
    if (!w) return
    this.waiting.delete(res.id)
    clearTimeout(w.timer)
    if (res.type === 'action') w.resolve({ action: res.action, source: 'worker', ms: res.ms })
    else void this.fallback(w.req, w.t0).then(w.resolve)
  }

  /** The worker died or erred: answer everything waiting with the random policy and start fresh next time. */
  private failAll(): void {
    this.dropWorker()
    for (const [id, w] of [...this.waiting]) {
      this.waiting.delete(id)
      clearTimeout(w.timer)
      void this.fallback(w.req, w.t0).then(w.resolve)
    }
  }

  private dropWorker(): void {
    try {
      this.worker?.terminate()
    } catch {
      // ignore
    }
    this.worker = null
    this.spawned = false
  }

  private async fallback(req: Extract<WorkerRequest, { type: 'decide' }>, t0: number): Promise<AiAnswer> {
    this.fallbacks++
    const { createAiDecider } = await import('@/ai/decider')
    const d = createAiDecider('random', { seed: `${req.seed}|fallback` })
    const action = d.decideSync(req.view, req.pending, req.legal).action
    return { action, source: 'fallback', ms: Date.now() - t0 }
  }

  /** Ask for the bot's action. Always resolves: the worker's answer, or the random policy's after the timeout. */
  decide(view: PlayerView, pending: PendingDecision, legal: Action[] | null, tier: BotTier, seed: string, memoryKey: string): Promise<AiAnswer> {
    const req: Extract<WorkerRequest, { type: 'decide' }> = {
      type: 'decide',
      id: this.nextId++,
      view,
      pending,
      legal,
      tier,
      seed,
      memoryKey,
      ...(this.budgetMs ? { budgetMs: this.budgetMs } : {}),
    }
    const t0 = Date.now()
    const w = this.ensureWorker()
    if (!w) {
      this.inlineUsed = true
      return import('@/ai/worker').then(({ handleRequest }) => {
        const res = handleRequest(req)
        if (res && res.type === 'action') return { action: res.action, source: 'inline' as const, ms: res.ms }
        return this.fallback(req, t0)
      })
    }
    return new Promise<AiAnswer>((resolve) => {
      const timer = setTimeout(() => {
        // a worker that missed the deadline is probably still busy: replace it so the next decision starts clean
        this.waiting.delete(req.id)
        void this.fallback(req, t0).then(resolve)
        this.dropWorker()
      }, this.timeoutMs)
      this.waiting.set(req.id, { resolve, timer, req, t0 })
      try {
        w.postMessage(req)
      } catch {
        this.waiting.delete(req.id)
        clearTimeout(timer)
        void this.fallback(req, t0).then(resolve)
      }
    })
  }

  /** Forget the AI's activation memory (a new game). */
  reset(): void {
    const msg: WorkerRequest = { type: 'reset' }
    if (this.worker) {
      try {
        this.worker.postMessage(msg)
      } catch {
        // ignore
      }
    } else if (this.inlineUsed) void import('@/ai/worker').then(({ handleRequest }) => handleRequest(msg))
  }

  dispose(): void {
    for (const [, w] of this.waiting) clearTimeout(w.timer)
    this.waiting.clear()
    this.dropWorker()
  }
}
