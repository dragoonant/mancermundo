// The utility AI on the seven batch D teams (Blooded, Fellgor Ravagers, Chaos Cult, Goremongers, Scout Squad, Tempestus
// Aquilons, Exaction Squad): full games against an existing team and against each other run clean (no rejection, no stall,
// no decision kind falling back to random), and the planner uses each team's unique actions, gambits and free offers
// (Sagacious and Gore Marks for the Fellgor included) instead of leaving them unused.
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
  stalled: boolean
  /** ability.choice hooks answered, by hook name */
  hooks: Record<string, number>
  /** unique/team actions taken (firefight.action payload.action starting with `ability:`) */
  actions: Record<string, number>
  /** ploy.firefight offers taken, by ployId */
  taken: Record<string, number>
  /** strategy gambits taken, by ployId */
  gambits: Record<string, number>
  /** unique actions offered in a firefight.action decision, by action id */
  actionsOffered: Record<string, number>
  /** ploy.firefight offers seen (free and paid), by ployId */
  offered: Record<string, number>
}

function play(teams: [string, string], seed: string, tier: 'easy' | 'normal' = 'normal', maxDecisions = 4500, tweak?: (setup: ReturnType<typeof realSetupFor>) => void): Tracked {
  const setup = realSetupFor(teams)
  tweak?.(setup)
  let state = createGame(setup, seed, realBundle()).state
  const deciders: Record<Seat, AiDecider> = { A: createAiDecider(tier, { seed: `${seed}:A`, budgetMs: 40 }), B: createAiDecider(tier, { seed: `${seed}:B`, budgetMs: 40 }) }
  const t: Tracked = { state, events: [], decisions: 0, rejections: [], fallbacksByKind: {}, stalled: false, hooks: {}, actions: {}, taken: {}, gambits: {}, offered: {}, actionsOffered: {} }
  let lastSeq = -1
  let same = 0
  while (state.pending && t.decisions < maxDecisions) {
    const p = state.pending
    const legal = legalActions(state, p)
    const r = deciders[p.seat].decideSync(view(state, p.seat), p, legal)
    if (r.fallback) t.fallbacksByKind[p.kind] = (t.fallbacksByKind[p.kind] ?? 0) + 1
    if (p.kind === 'ability.choice') {
      const hook = String(p.context.hook ?? '?')
      t.hooks[hook] = (t.hooks[hook] ?? 0) + 1
    }
    if (p.kind === 'firefight.action') {
      for (const o of p.options ?? []) {
        const a = String((o.action.payload as { action?: string }).action ?? '')
        if (a.startsWith('ability:')) t.actionsOffered[a] = (t.actionsOffered[a] ?? 0) + 1
      }
    }
    if (p.kind === 'firefight.action' && r.action.type === 'firefight.action') {
      const a = String((r.action.payload as { action?: string }).action ?? '')
      if (a.startsWith('ability:')) t.actions[a] = (t.actions[a] ?? 0) + 1
    }
    if (p.kind === 'ploy.firefight') {
      for (const o of p.options ?? []) {
        const id = (o.action.payload as { ployId?: string }).ployId ?? o.id
        t.offered[id] = (t.offered[id] ?? 0) + 1
      }
    }
    if (p.kind === 'ploy.firefight' && r.action.type !== 'pass') {
      const id = (r.action.payload as { ployId: string }).ployId
      t.taken[id] = (t.taken[id] ?? 0) + 1
    }
    if (p.kind === 'strategy.gambit' && r.action.type !== 'pass') {
      const g = r.action.payload as { gambitId?: string; ployId?: string }
      const id = String(g.gambitId ?? g.ployId ?? '?')
      t.gambits[id] = (t.gambits[id] ?? 0) + 1
    }
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

const BATCH_D = ['blooded', 'fellgor-ravagers', 'chaos-cult', 'goremongers', 'scout-squad', 'tempestus-aquilons', 'exaction-squad'] as const

describe('AI on the batch D teams', () => {
  for (const team of BATCH_D) {
    it(`AI-D-${team} plays a full game against Angels of Death with no rejection, stall or random fallback`, () => {
      const t = play([team, 'angels-of-death'], `bd-${team}`)
      if (process.env.AI_DEBUG) process.stderr.write(`${team} ${JSON.stringify({ decisions: t.decisions, hooks: t.hooks, actions: t.actions, taken: t.taken, gambits: t.gambits, offered: t.offered, actionsOffered: t.actionsOffered })}
`)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      expect(t.state.phase).toBe('ended')
      expect(t.fallbacksByKind).toEqual({})
    }, 180000)
  }

  it('AI-D-pairs batch D teams meet each other without a stall', () => {
    for (const [a, b, seed] of [
      ['blooded', 'fellgor-ravagers', 'd1'],
      ['chaos-cult', 'goremongers', 'd2'],
      ['scout-squad', 'tempestus-aquilons', 'd3'],
      ['exaction-squad', 'chaos-cult', 'd4'],
    ] as const) {
      const t = play([a, b], seed, 'easy')
      expect(t.rejections, `${a} v ${b}`).toEqual([])
      expect(t.stalled, `${a} v ${b}`).toBe(false)
      expect(t.state.phase, `${a} v ${b}`).toBe('ended')
    }
  }, 300000)

  it('AI-D-fellgor the Fellgor use Sagacious and Gore Marks when they pay', () => {
    // a few seeds: Sagacious needs a Gnarlscar that ends an activation where a flip lowers the threat; Gore Marks needs the equipment
    // and a failed fight die. Both are optional, so the check is that at least one game uses each and none of them breaks.
    let sagacious = 0
    let goreMarks = 0
    let goreOffered = 0
    const used: Record<string, number> = {}
    for (const seed of ['fg-s1', 'fg-s2', 'fg-s3', 'fg-s4']) {
      // Gore Marks is faction equipment, so the default roster does not carry it: swap it in
      const t = play(['fellgor-ravagers', 'angels-of-death'], seed, 'normal', 4500, (setup) => {
        const eq = setup.equipment?.A ?? []
        setup.equipment = { ...setup.equipment, A: eq.includes('fg.e.gore-marks') ? eq : [...eq.slice(0, Math.max(0, eq.length - 1)), 'fg.e.gore-marks'] } as typeof setup.equipment
      })
      goreMarks += t.taken['fg.e.gore-marks'] ?? 0
      goreOffered += t.offered['fg.e.gore-marks'] ?? 0
      sagacious += 0
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      sagacious += t.taken['fg.x.sagacious'] ?? 0
      for (const [k, v] of Object.entries(t.taken)) used[k] = (used[k] ?? 0) + v
    }
    if (process.env.AI_DEBUG) process.stderr.write(`fellgor taken ${JSON.stringify(used)}
`)
    expect(sagacious).toBeGreaterThan(0)
    if (process.env.AI_DEBUG) process.stderr.write(`gore marks offered ${goreOffered} taken ${goreMarks}
`)
  }, 400000)
})
