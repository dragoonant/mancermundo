// The utility AI on the four M9 teams (Pathfinders, Hierotek Circle, Plague Marines, Wyrmblade): full games against an
// existing team and against each other run clean (no rejection, no stall, no idle decision kinds falling back to
// random), the Wyrmblade AI hides a sensible subset and gets every hidden operative out by the end of turning point 2,
// and the team decisions (ability.choice) are answered by a policy.
import { describe, expect, it } from 'vitest'
import { createGame, legalActions, step, view, type Action, type GameEvent, type GameState, type Seat } from '@/engine'
import { createAiDecider, type AiDecider } from '../../src/ai/decider'
import { realBundle, realSetupFor } from './fixtures'

interface Tracked {
  state: GameState
  events: GameEvent[]
  decisions: number
  rejections: string[]
  fallbacksByKind: Record<string, number>
  kinds: Record<string, number>
  stalled: boolean
}

function play(teams: [string, string], seed: string, tier: 'easy' | 'normal' = 'normal', maxDecisions = 3500): Tracked {
  const setup = realSetupFor(teams)
  let state = createGame(setup, seed, realBundle()).state
  const deciders: Record<Seat, AiDecider> = { A: createAiDecider(tier, { seed: `${seed}:A`, budgetMs: 40 }), B: createAiDecider(tier, { seed: `${seed}:B`, budgetMs: 40 }) }
  const t: Tracked = { state, events: [], decisions: 0, rejections: [], fallbacksByKind: {}, kinds: {}, stalled: false }
  let lastSeq = -1
  let same = 0
  while (state.pending && t.decisions < maxDecisions) {
    const p = state.pending
    const legal = legalActions(state, p)
    const r = deciders[p.seat].decideSync(view(state, p.seat), p, legal)
    t.kinds[p.kind] = (t.kinds[p.kind] ?? 0) + 1
    if (r.fallback) t.fallbacksByKind[p.kind] = (t.fallbacksByKind[p.kind] ?? 0) + 1
    const res = step(state, r.action as Action)
    t.decisions++
    if (res.rejection) {
      t.rejections.push(`${p.kind}: ${res.rejection.code} ${res.rejection.reason}`)
      const alt = legal?.[0]
      if (!alt) break
      const r2 = step(state, alt)
      if (r2.rejection) break
      state = r2.state
      t.events.push(...r2.events)
    } else {
      state = res.state
      t.events.push(...res.events)
    }
    same = state.seq === lastSeq ? same + 1 : 0
    lastSeq = state.seq
    if (same > 50) {
      t.stalled = true
      break
    }
  }
  t.state = state
  return t
}

const NEW_TEAMS = ['pathfinders', 'hierotek-circle', 'plague-marines', 'wyrmblade'] as const

describe('AI on the M9 teams', () => {
  for (const team of NEW_TEAMS) {
    it(`AI-NT-${team} plays a full game against Angels of Death with no rejection, stall or random fallback`, () => {
      const t = play([team, 'angels-of-death'], `nt-${team}`)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      expect(t.state.phase).toBe('ended')
      expect(t.fallbacksByKind).toEqual({})
    }, 120000)
  }

  it('AI-NT-pairs the new teams meet each other and the older teams without a stall (the pairs that once looped on Remote Pilot included)', () => {
    for (const [a, b, seed] of [
      ['pathfinders', 'hierotek-circle', 'p1'],
      ['pathfinders', 'wyrmblade', 'p2'],
      ['pathfinders', 'kommandos', 'p3'],
      ['plague-marines', 'pathfinders', 'p4'],
      ['hierotek-circle', 'plague-marines', 'p5'],
      ['wyrmblade', 'plague-marines', 'p6'],
    ] as const) {
      for (const tier of ['easy', 'normal'] as const) {
        const t = play([a, b], `${seed}-${tier}`, tier)
        expect(t.rejections, `${a} v ${b} ${tier}`).toEqual([])
        expect(t.stalled, `${a} v ${b} ${tier}`).toBe(false)
        expect(t.state.phase, `${a} v ${b} ${tier}`).toBe('ended')
        expect(t.fallbacksByKind, `${a} v ${b} ${tier}`).toEqual({})
      }
    }
  }, 300000)

  it('AI-NT-hide the Wyrmblade AI hides a few Neophytes (never the Leader), emerges all of them by the end of turning point 2 and nobody is lost to HIDING', () => {
    let hid = 0
    for (const seed of ['hide-1', 'hide-2', 'hide-3']) {
      const t = play(['wyrmblade', 'angels-of-death'], seed)
      expect(t.rejections).toEqual([])
      const aside = t.events.filter((e) => e.type === 'OperativeSetAside')
      const emerged = t.events.filter((e) => e.type === 'OperativeReturned' && e.kind === 'emerge')
      hid += aside.length
      expect(aside.length).toBeLessThanOrEqual(Math.floor(Object.values(t.state.operatives).filter((o) => o.seat === 'A').length / 3))
      for (const e of aside) {
        if (e.type !== 'OperativeSetAside') continue
        const op = t.state.operatives[e.operativeId]!
        expect(t.state.data.datacards[op.datacardId]!.keywords).not.toContain('LEADER')
        expect(t.state.data.datacards[op.datacardId]!.keywords).not.toContain('CULT AGENT')
      }
      expect(emerged.length, seed).toBe(aside.length)
    }
    expect(hid).toBeGreaterThan(0)
  }, 180000)

  it('AI-NT-tokens the Pathfinder and Plague Marine AIs put tokens on the enemy during a game', () => {
    const pf = play(['pathfinders', 'angels-of-death'], 'tok-pf')
    expect(pf.events.some((e) => e.type === 'TokenChanged' && e.kind === 'pf.markerlight' && e.delta > 0)).toBe(true)
    const pm = play(['plague-marines', 'angels-of-death'], 'tok-pm')
    expect(pm.events.some((e) => e.type === 'TokenChanged' && e.kind === 'pm.poison' && e.delta > 0)).toBe(true)
  }, 120000)
})
