import { describe, expect, it } from 'vitest'
import { legalActions, validate, view } from '@/engine'
import { AiWorkerClient, type WorkerLike } from '../../src/client/bot/aiWorkerClient'
import { handleRequest, type WorkerRequest, type WorkerResponse } from '../../src/ai/worker'
import { sampleStates } from './fixtures'

const states = sampleStates('ai-worker', 12, 30)
const pick = () => {
  const s = states.find((x) => x.pending!.kind === 'firefight.activate') ?? states[10]!
  return { s, p: s.pending!, v: view(s, s.pending!.seat), legal: legalActions(s, s.pending!) }
}

class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerResponse }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  terminated = false
  posted: WorkerRequest[] = []
  constructor(private readonly mode: 'silent' | 'echo' | 'crash') {}
  postMessage(m: WorkerRequest): void {
    this.posted.push(m)
    if (this.mode === 'echo') {
      // the worker core answers on a later tick, as a real worker would
      setTimeout(() => {
        const res = handleRequest(m)
        if (res) this.onmessage?.({ data: res })
      }, 0)
    } else if (this.mode === 'crash') {
      setTimeout(() => this.onerror?.({}), 0)
    }
  }
  terminate(): void {
    this.terminated = true
  }
}

describe('AI worker client', () => {
  it('AI-009 times out to a legal random answer and replaces the stuck worker', async () => {
    const { s, p, v, legal } = pick()
    const workers: FakeWorker[] = []
    const client = new AiWorkerClient({ timeoutMs: 40, spawn: () => { const w = new FakeWorker('silent'); workers.push(w); return w } })
    const t0 = Date.now()
    const a = await client.decide(v, p, legal, 'normal', 'seed', 'k')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35)
    expect(a.source).toBe('fallback')
    expect(validate(s, a.action)).toBeNull()
    expect(client.fallbacks).toBe(1)
    expect(workers[0]!.terminated).toBe(true)
    // the next decision starts a fresh worker
    const b = await client.decide(v, p, legal, 'normal', 'seed', 'k')
    expect(workers.length).toBe(2)
    expect(b.source).toBe('fallback')
    client.dispose()
  })

  it('AI-010 uses the worker answer when it replies, falls back when it crashes, runs inline without a worker', async () => {
    const { s, p, v, legal } = pick()
    const ok = new AiWorkerClient({ timeoutMs: 2000, spawn: () => new FakeWorker('echo') })
    const a = await ok.decide(v, p, legal, 'normal', 'seed', 'k')
    expect(a.source).toBe('worker')
    expect(validate(s, a.action)).toBeNull()
    ok.dispose()

    const bad = new AiWorkerClient({ timeoutMs: 2000, spawn: () => new FakeWorker('crash') })
    const b = await bad.decide(v, p, legal, 'normal', 'seed', 'k')
    expect(b.source).toBe('fallback')
    expect(validate(s, b.action)).toBeNull()
    bad.dispose()

    const inline = new AiWorkerClient({ spawn: () => null })
    const c = await inline.decide(v, p, legal, 'easy', 'seed', 'k')
    expect(c.source).toBe('inline')
    expect(validate(s, c.action)).toBeNull()
  })
})
