// The worker host's pure core: a decide request returns the same action as the in-process decider, errors come back as
// messages, deciders (and their memory) are kept per memoryKey and tier, reset forgets them.
import { describe, expect, it } from 'vitest'
import { createGame, legalActions, view } from '@/engine'
import { AiWorkerClient, createAiDecider, handleRequest, type WorkerRequest } from '../../src/ai'
import { pairingFor } from '../../tools/ai-pairing'
import { realBundle } from '../fixtures/real'

function request(id: number): { req: Extract<WorkerRequest, { type: 'decide' }>; state: ReturnType<typeof createGame>['state'] } {
  const bundle = realBundle()
  const { setup } = pairingFor(bundle, 0, ['scn.tunnel-skirmish'], 2)
  const state = createGame(setup, 'w', bundle).state
  const p = state.pending!
  return { state, req: { type: 'decide', id, view: view(state, p.seat), pending: p, legal: legalActions(state, p), tier: 'normal', seed: 'w:A', memoryKey: 'g1' } }
}

describe('AI: worker host', () => {
  it('AI-030 a decide request answers with the action the in-process decider gives', () => {
    const { req, state } = request(7)
    const res = handleRequest(req)
    expect(res && res.type).toBe('action')
    if (!res || res.type !== 'action') return
    expect(res.id).toBe(7)
    const p = state.pending!
    const direct = createAiDecider('normal', { seed: 'w:A' }).decideSync(view(state, p.seat), p, legalActions(state, p))
    expect(res.action).toEqual(direct.action)
    expect(res.fallback).toBe(false)
    expect(res.ms).toBeGreaterThanOrEqual(0)
  })

  it('AI-031 a request the decider cannot handle comes back as an error message, not a throw', () => {
    const { req } = request(8)
    const bad: WorkerRequest = { ...req, view: undefined as unknown as typeof req.view }
    const res = handleRequest(bad)
    expect(res && res.type).toBe('error')
  })

  it('AI-032 reset clears the deciders and answers nothing', () => {
    expect(handleRequest({ type: 'reset' })).toBeNull()
  })

  it('AI-033 the worker client answers in-process when no Worker exists, with the same action the decider gives', async () => {
    const { req, state } = request(9)
    const p = state.pending!
    const client = new AiWorkerClient({ tier: 'normal', seed: 'w:A' })
    const a = await client.decide(req.view, p, req.legal)
    const direct = createAiDecider('normal', { seed: 'w:A' }).decideSync(view(state, p.seat), p, legalActions(state, p))
    expect(a).toEqual(direct.action)
    AiWorkerClient.reset()
  })
})
