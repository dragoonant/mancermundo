// The AI deciders end to end: every decision kind has a policy, whole games of every scenario play through with no rejection
// and no fallback, the same seed gives the same game, an unknown decision kind is counted and never answered at random.
import { describe, expect, it } from 'vitest'
import { createGame, legalActions, step, view, type Action, type DecisionKind, type PendingDecision } from '@/engine'
import { createAiBot, createAiDecider, POLICIES } from '../../src/ai'
import { playMatch } from '../../tools/ai-match'
import { pairingFor } from '../../tools/ai-pairing'
import { realBundle } from '../fixtures/real'

const ALL_KINDS: DecisionKind[] = [
  'setup.role', 'setup.crew', 'setup.casket', 'setup.zone', 'setup.deploy', 'action.flee', 'action.activate', 'action.group', 'action.choose',
  'move.path', 'shoot.weapon', 'shoot.target', 'shoot.aim', 'shoot.allocate', 'fight.weapons', 'fight.split', 'fight.after', 'end.bottle',
  'end.assist', 'end.recoveryPick', 'skill.choice', 'dice.reroll', 'confirm',
]

describe('AI: deciders', () => {
  it('AI-001 every decision kind of the engine contract has a policy', () => {
    expect(Object.keys(POLICIES).sort()).toEqual(ALL_KINDS.slice().sort())
  })

  it('AI-002 normal plays Tunnel Skirmish, Smash & Grab and Forgotten Riches with no rejection, stall or fallback', { timeout: 120_000 }, () => {
    const bundle = realBundle()
    const scenarios = ['scn.tunnel-skirmish', 'scn.smash-and-grab', 'scn.forgotten-riches']
    scenarios.forEach((scenario, i) => {
      const { setup, aiSeat } = pairingFor(bundle, i * 4, [scenario], 3)
      const other = aiSeat === 'A' ? 'B' : 'A'
      const ai = createAiDecider('normal', { seed: `t${i}:${aiSeat}` })
      const opp = createAiDecider('normal', { seed: `t${i}:${other}` })
      const m = playMatch(setup, bundle, `ai-002-${i}`, { [aiSeat]: ai, [other]: opp } as Record<'A' | 'B', typeof ai>)
      expect(m.firstRejection, scenario).toBeNull()
      expect(m.stalled, scenario).toBe(false)
      expect(m.ended, scenario).toBe(true)
      for (const d of [ai, opp]) {
        expect(d.memory.stats.fallbacks, scenario).toBe(0)
        expect(d.memory.stats.errors, scenario).toBe(0)
        expect(d.memory.stats.unhandled, scenario).toEqual({})
      }
    })
  })

  it('AI-003 the same seed plays the same game (hash and action list)', { timeout: 60_000 }, () => {
    const bundle = realBundle()
    const { setup } = pairingFor(bundle, 0, ['scn.tunnel-skirmish'], 2)
    const run = () => {
      let state = createGame(setup, 'det', bundle).state
      const ds = { A: createAiDecider('normal', { seed: 'a' }), B: createAiDecider('easy', { seed: 'b' }) }
      for (let i = 0; i < 4000 && state.pending; i++) {
        const p = state.pending
        const r = step(state, ds[p.seat].decideSync(view(state, p.seat), p, legalActions(state, p)).action)
        expect(r.rejection).toBeUndefined()
        state = r.state
      }
      return state
    }
    const a = run()
    const b = run()
    expect(a.hash).toBe(b.hash)
    expect(a.log.length).toBe(b.log.length)
  })

  it('AI-004 a decision kind no policy knows is counted as unhandled and answered by the engine suggestion or the first legal option, never at random', () => {
    const d = createAiDecider('normal', { seed: 'x' })
    const bundle = realBundle()
    const { setup } = pairingFor(bundle, 0, ['scn.tunnel-skirmish'], 2)
    const state = createGame(setup, 's', bundle).state
    const real = state.pending!
    const first = real.options![0]!.action
    // a decision from the future: the kind is unknown to the policy table, the options are real
    const fake = { ...real, kind: 'future.kind' as DecisionKind }
    const out = d.decideSync(view(state, real.seat), fake, legalActions(state, real))
    expect(out.fallback).toBe(true)
    expect(d.memory.stats.unhandled).toEqual({ 'future.kind': 1 })
    expect(JSON.stringify(out.action.payload)).toBe(JSON.stringify(first.payload))
  })

  it('AI-005 the random tier answers every decision with a legal action', { timeout: 60_000 }, () => {
    const bundle = realBundle()
    const { setup } = pairingFor(bundle, 0, ['scn.smash-and-grab'], 3)
    const ds = { A: createAiDecider('random', { seed: 'r1' }), B: createAiDecider('random', { seed: 'r2' }) }
    const m = playMatch(setup, bundle, 'rand', ds)
    expect(m.firstRejection).toBeNull()
    expect(m.ended).toBe(true)
  })

  it('AI-006 createAiBot is a drop-in for the client bot: decide(state, pending) returns an accepted action', () => {
    const bundle = realBundle()
    const { setup } = pairingFor(bundle, 0, ['scn.tunnel-skirmish'], 2)
    let state = createGame(setup, 'bot', bundle).state
    const bots = { A: createAiBot('normal', 'bot:A'), B: createAiBot('easy', 'bot:B') }
    let n = 0
    while (state.pending && n++ < 300) {
      const p: PendingDecision = state.pending
      const a: Action = bots[p.seat].decide(state, p)
      const r = step(state, a)
      expect(r.rejection).toBeUndefined()
      state = r.state
    }
    expect(n).toBeGreaterThan(100)
  })
})
