// AI Web Worker host (docs/spec/40-ai). The main thread posts the seat's view, the open decision and the legal
// answers; the worker answers with an action, so a slow decision never blocks rendering. Messages:
//   decide { id, view, pending, legal, tier, seed, memoryKey, budgetMs? } -> action { id, action, ms, fallback } | error { id, message }
//   reset  -> forget every decider (a new game)
// `handleRequest` is the pure core (node tests and the client's inline fallback call it directly).
import type { Action, PendingDecision, PlayerView } from '@/engine'
import { createAiDecider, type AiDecider } from './decider'
import type { Tier } from './tiers'

export type WorkerRequest =
  | { type: 'decide'; id: number; view: PlayerView; pending: PendingDecision; legal: Action[] | null; tier: Tier; seed: string; memoryKey: string; budgetMs?: number }
  | { type: 'reset' }

export type WorkerResponse =
  | { type: 'action'; id: number; action: Action; ms: number; fallback: boolean }
  | { type: 'error'; id: number; message: string }

const MAX_DECIDERS = 8
const deciders = new Map<string, AiDecider>()

/** Answer one request. Deciders (and their activation memory) are kept per memoryKey and tier. */
export function handleRequest(req: WorkerRequest): WorkerResponse | null {
  if (req.type === 'reset') {
    deciders.clear()
    return null
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  try {
    const key = `${req.memoryKey}:${req.tier}`
    let d = deciders.get(key)
    if (!d) {
      if (deciders.size >= MAX_DECIDERS) deciders.clear()
      d = createAiDecider(req.tier, { seed: req.seed, ...(req.budgetMs ? { budgetMs: req.budgetMs } : {}) })
      deciders.set(key, d)
    }
    const { action, fallback } = d.decideSync(req.view, req.pending, req.legal)
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    return { type: 'action', id: req.id, action, ms, fallback }
  } catch (e) {
    return { type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) }
  }
}

// Worker wiring: only when this module runs as a dedicated worker (not under node or on the main thread).
type WorkerScope = { onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null; postMessage(m: WorkerResponse): void }
const isWorker = typeof self !== 'undefined' && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined'
if (isWorker) {
  const scope = self as unknown as WorkerScope
  scope.onmessage = (ev) => {
    const res = handleRequest(ev.data)
    if (res) scope.postMessage(res)
  }
}
