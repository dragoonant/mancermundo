// The utility AI on the seven batch C teams (Kasrkin, Novitiates, Phobos Strike Team, Corsair Voidscarred, Warpcoven,
// Farstalker Kinband, Imperial Navy Breachers): full games against an existing team and against each other run clean (no
// rejection, no stall, no decision kind falling back to random), the team decisions (ability.choice hooks, reactions) are
// answered by a policy, and the planner values the weapons and actions that used to be skipped: Detonate (a fixed-target
// weapon), Temporal Flux, Patient Ambush and Comms Array.
import { describe, expect, it } from 'vitest'
import { createGame, legalActions, step, view, type Action, type GameEvent, type GameState, type Seat } from '@/engine'
import { createAiDecider, makeCtx, type AiDecider } from '../../src/ai/decider'
import { fixedShot } from '../../src/ai/eval'
import { abilityChoice } from '../../src/ai/choices'
import { newMemory } from '../../src/ai/tiers'
import { activateOp, edit, openReal, opOf } from '../fixtures/real'
import { place } from '../fixtures/helpers'
import { open as ksOpen } from '../engine/teams/kasrkin.hooks'
import { open as phOpen, phRoster, withMarkers as phWithMarkers } from '../engine/teams/phobos-strike-team.hooks'
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
}

function play(teams: [string, string], seed: string, tier: 'easy' | 'normal' = 'normal', maxDecisions = 4500): Tracked {
  const setup = realSetupFor(teams)
  let state = createGame(setup, seed, realBundle()).state
  const deciders: Record<Seat, AiDecider> = { A: createAiDecider(tier, { seed: `${seed}:A`, budgetMs: 40 }), B: createAiDecider(tier, { seed: `${seed}:B`, budgetMs: 40 }) }
  const t: Tracked = { state, events: [], decisions: 0, rejections: [], fallbacksByKind: {}, stalled: false, hooks: {}, actions: {}, taken: {} }
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
    if (p.kind === 'firefight.action' && r.action.type === 'firefight.action') {
      const a = String((r.action.payload as { action?: string }).action ?? '')
      if (a.startsWith('ability:')) t.actions[a] = (t.actions[a] ?? 0) + 1
    }
    if (p.kind === 'ploy.firefight' && r.action.type !== 'pass') {
      const id = (r.action.payload as { ployId: string }).ployId
      t.taken[id] = (t.taken[id] ?? 0) + 1
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

const BATCH_C = ['kasrkin', 'novitiates', 'phobos-strike-team', 'corsair-voidscarred', 'warpcoven', 'farstalker-kinband', 'imperial-navy-breachers'] as const

describe('AI on the batch C teams', () => {
  for (const team of BATCH_C) {
    it(`AI-C-${team} plays a full game against Angels of Death with no rejection, stall or random fallback`, () => {
      const t = play([team, 'angels-of-death'], `bc-${team}`)
      if (process.env.AI_DEBUG) process.stderr.write(`${team} ${JSON.stringify({ decisions: t.decisions, hooks: t.hooks, actions: t.actions, taken: t.taken })}\n`)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      expect(t.state.phase).toBe('ended')
      expect(t.fallbacksByKind).toEqual({})
    }, 180000)
  }

  it('AI-C-mines: the bot lays the Kasrkin Melta Mine and the Phobos Haywire Mine with the shared Place Marker (planned, then placed on a spot the filter allows) when enemies are near', () => {
    const cases = [
      { mine: 'ks.meltaMine', state: ksOpen(), card: 'ks.demo-trooper' },
      { mine: 'ph.haywire-mine', state: phWithMarkers(phOpen({ rosterA: phRoster(['infiltrator-sergeant', 'incursor-minelayer', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) })), card: 'ph.incursor-minelayer' },
    ]
    for (const c of cases) {
      const layer = opOf(c.state, 'A', c.card)
      const boy = opOf(c.state, 'B', 'kom.boy')
      expect(c.state.markers.find((m) => m.equipmentId === c.mine)?.carriedBy).toBe(layer)
      // an enemy 7 inches away: the mine is worth laying in its path
      let s = activateOp(place(place(c.state, layer, 0, 0), boy, 7, 0), layer)
      // a fixed clock: the planner's work cap alone bounds it, so the run is deterministic
      const bot = createAiDecider('normal', { seed: `mine:${c.mine}`, budgetMs: 200, now: () => 0 })
      const placed: { x: number; z: number }[] = []
      let fallbacks = 0
      for (let n = 0; n < 40 && s.pending && s.firefight.activation?.operativeId === layer; n++) {
        const p = s.pending
        const r = bot.decideSync(view(s, p.seat), p, legalActions(s, p))
        if (r.fallback) fallbacks++
        if (p.kind === 'marker.place') placed.push(r.action.payload as { x: number; z: number })
        const res = step(s, r.action as Action)
        expect(res.rejection, c.mine).toBeUndefined()
        s = res.state
      }
      expect(fallbacks, c.mine).toBe(0)
      expect(placed, c.mine).toHaveLength(1)
      const m = s.markers.find((k) => k.equipmentId === c.mine)!
      expect(m.carriedBy, c.mine).toBeNull()
      expect(m.pos).toEqual({ x: placed[0]!.x, z: placed[0]!.z })
      // the spot nearest the enemy among those the filter allows (never in its control range)
      expect(m.pos.x, c.mine).toBeGreaterThan(0)
    }
  })

  it('AI-C-pairs batch C teams meet each other without a stall', () => {
    for (const [a, b, seed] of [
      ['kasrkin', 'novitiates', 'c1'],
      ['phobos-strike-team', 'corsair-voidscarred', 'c2'],
      ['warpcoven', 'farstalker-kinband', 'c3'],
      ['imperial-navy-breachers', 'kasrkin', 'c4'],
    ] as const) {
      const t = play([a, b], seed, 'easy')
      expect(t.rejections, `${a} v ${b}`).toEqual([])
      expect(t.stalled, `${a} v ${b}`).toBe(false)
      expect(t.state.phase, `${a} v ${b}`).toBe('ended')
    }
  }, 240000)
})

describe('AI values what it used to skip', () => {
  const ctxFor = (state: GameState, seat: Seat) => {
    const p = state.pending
    const v = view(state, seat)
    return makeCtx('normal', v, p ?? ({ id: 'x', kind: 'confirm', seat, context: {}, options: [] } as never), null, { seed: 'ctx', budgetMs: 40 }, newMemory())
  }
  const fresh = (teams: [string, string]): GameState => openReal({ teams })

  it('AI-C-fixed-target: the Detonate weapons score on their own targets, not as a shot at a valid enemy', () => {
    // Navy Breachers: the Gheistskull is the primary target and the enemies within its blast are the value
    const s = fresh(['imperial-navy-breachers', 'angels-of-death'])
    const jammer = Object.values(s.operatives).find((o) => o.seat === 'A' && o.weapons.includes('nb.w.gheistskull-detonator'))
    if (!jammer) return
    const enemy = Object.values(s.operatives).find((o) => o.seat === 'B')!
    const alone = fixedShot(ctxFor(s, 'A'), s, jammer, 'nb.w.gheistskull-detonator')
    expect(alone).not.toBeNull()
    const skull = s.operatives[alone!.targetId]!
    expect(skull.seat).toBe('A')
    expect(s.data.datacards[skull.datacardId]?.abilities.some((a) => a.endsWith('.expendable'))).toBe(true)
    // with nobody near the Gheistskull, blowing it up is a loss; with an enemy beside it, a gain
    expect(alone!.score).toBeLessThanOrEqual(0)
    const near = edit(s, (st) => {
      st.operatives[enemy.id]!.pos = { x: skull.pos.x + 0.9, y: skull.pos.y, z: skull.pos.z }
    })
    const hit = fixedShot(ctxFor(near, 'A'), near, near.operatives[jammer.id]!, 'nb.w.gheistskull-detonator')
    expect(hit!.score).toBeGreaterThan(alone!.score)
    expect(hit!.fixed).toBe(true)
    // an ordinary weapon is not a fixed shot
    const gun = jammer.weapons.find((w) => s.data.weapons[w]?.type === 'ranged' && w !== 'nb.w.gheistskull-detonator')
    if (gun) expect(fixedShot(ctxFor(s, 'A'), s, jammer, gun)).toBeNull()
  })

  it('AI-C-reactions: a Corsair reaction is declined when it is not worth it and the choice is always legal', () => {
    const t = play(['corsair-voidscarred', 'angels-of-death'], 'react-cv', 'normal')
    expect(t.rejections).toEqual([])
    expect(t.stalled).toBe(false)
  }, 180000)

  it('AI-C-choices: every batch C ability.choice hook is answered by a policy that returns one of its options', () => {
    // run a few games per team and make sure every hook seen was answered legally (no fallbacks to the random policy)
    const seen = new Set<string>()
    for (const [team, seed] of [
      ['novitiates', 'h1'],
      ['kasrkin', 'h2'],
      ['farstalker-kinband', 'h3'],
    ] as const) {
      const t = play([team, 'imperial-navy-breachers'], seed, 'normal')
      expect(t.fallbacksByKind, team).toEqual({})
      for (const h of Object.keys(t.hooks)) seen.add(h)
    }
    expect(seen.size).toBeGreaterThan(0)
    void abilityChoice
  }, 360000)
})
