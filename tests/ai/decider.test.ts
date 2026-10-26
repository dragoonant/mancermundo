import { describe, expect, it } from 'vitest'
import { createGame, legalActions, step, validate, view, type Action, type Seat } from '@/engine'
import { answerOk, createAiDecider } from '../../src/ai/decider'
import { TIER_IDS, type Tier } from '../../src/ai/tiers'
import { handleRequest } from '../../src/ai/worker'
import { playMatch } from '../../tools/ai-match'
import { realBundle, realSetupFor, sampleStates } from './fixtures'

const states = sampleStates('ai-sample', 5, 100)

describe('AI deciders', () => {
  it('AI-001 every tier answers 100 sampled real-game states with a validate-clean action', () => {
    expect(states.length).toBeGreaterThanOrEqual(90)
    const kinds = new Set(states.map((s) => s.pending!.kind))
    expect(kinds.size).toBeGreaterThan(8)
    for (const tier of TIER_IDS) {
      const d = createAiDecider(tier, { seed: `t-${tier}` })
      for (const s of states) {
        const p = s.pending!
        const legal = legalActions(s, p)
        const r = d.decideSync(view(s, p.seat), p, legal)
        expect(answerOk(s, legal, r.action), `${tier} ${p.kind}`).toBe(true)
        expect(validate(s, r.action), `${tier} ${p.kind}`).toBeNull()
        // a policy that exists never needs the random fallback on a legal state
        if (tier !== 'random') expect(r.fallback, `${tier} ${p.kind} fell back`).toBe(false)
      }
    }
  })

  it('AI-002 the same seed gives the same answers and the same game; another seed plays differently', () => {
    const run = (tier: Tier, seed: string) => {
      const setup = realSetupFor(['angels-of-death', 'kommandos'])
      const deciders = { A: createAiDecider(tier, { seed: `${seed}:A` }), B: createAiDecider(tier, { seed: `${seed}:B` }) }
      return playMatch(setup, realBundle(), seed, deciders)
    }
    const a = run('easy', 'det-1')
    const b = run('easy', 'det-1')
    expect(b.vp).toEqual(a.vp)
    expect(b.decisions).toBe(a.decisions)
    const c = run('easy', 'det-2')
    expect(c.decisions === a.decisions && c.vp.A === a.vp.A && c.vp.B === a.vp.B).toBe(false)
    // per-decision determinism for normal
    const s = states[40]!
    const p = s.pending!
    const x = createAiDecider('normal', { seed: 'same' }).decideSync(view(s, p.seat), p, legalActions(s, p)).action
    const y = createAiDecider('normal', { seed: 'same' }).decideSync(view(s, p.seat), p, legalActions(s, p)).action
    expect(JSON.stringify(y)).toBe(JSON.stringify(x))
  })

  it('AI-003 the work cap makes answers independent of the clock; a blown hard stop still answers legally', () => {
    const acts = states.filter((s) => s.pending!.kind === 'firefight.activate').slice(0, 6)
    expect(acts.length).toBeGreaterThan(2)
    for (const s of acts) {
      const p = s.pending!
      const legal = legalActions(s, p)
      let t = 0
      const slow = createAiDecider('normal', { seed: 'cap', now: () => (t += 0.0001) })
      const fast = createAiDecider('normal', { seed: 'cap', now: () => 0 })
      const a = slow.decideSync(view(s, p.seat), p, legal).action
      const b = fast.decideSync(view(s, p.seat), p, legal).action
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      // the clock leaps past every deadline: the planner stops at once and the answer is still legal
      let jump = 0
      const late = createAiDecider('normal', { seed: 'cap', now: () => (jump += 1e6) })
      const c = late.decideSync(view(s, p.seat), p, legal)
      expect(answerOk(s, legal, c.action)).toBe(true)
    }
  })

  it('AI-004 the worker core answers a decide request, and a reset forgets the deciders', () => {
    const s = states[30]!
    const p = s.pending!
    const res = handleRequest({ type: 'decide', id: 7, view: view(s, p.seat), pending: p, legal: legalActions(s, p), tier: 'normal', seed: 'w', memoryKey: 'k' })
    expect(res?.type).toBe('action')
    if (res?.type === 'action') {
      expect(res.id).toBe(7)
      expect(validate(s, res.action as Action)).toBeNull()
    }
    expect(handleRequest({ type: 'reset' })).toBeNull()
  })

  it('AI-005 a normal-tier game on the real teams runs clean: no rejection, no fallback, almost no idle activation', () => {
    const seat: Seat = 'A'
    const setup = realSetupFor(['angels-of-death', 'kommandos'])
    const normal = createAiDecider('normal', { seed: 'clean:A' })
    const m = playMatch(setup, realBundle(), 'clean', { A: normal, B: createAiDecider('random', { seed: 'clean:B' }) })
    void createGame
    void step
    expect(m.firstRejection).toBeNull()
    expect(m.stalled).toBe(false)
    expect(m.ended).toBe(true)
    expect(m.seats[seat].rejections).toBe(0)
    expect(m.seats[seat].fallbacks).toBe(0)
    expect(m.seats[seat].zeroAction / Math.max(1, m.seats[seat].activations)).toBeLessThan(0.1)
    expect(m.vp.A).toBeGreaterThan(m.vp.B)
  })
})
