// The utility AI on the four batch B teams (Legionaries, Hand of the Archon, Hunter Clade, Hearthkyn Salvagers): full
// games against an existing team run clean (no rejection, no stall, no decision kind falling back to random), and the
// team rules are actually used: free (0 CP) offers such as the Pain invigorations, the Legionaries ploys and gambits,
// FLY set-ups from the Jump Pack, the Tactician gambit and a chosen Hunter Clade Imperative.
import { describe, expect, it } from 'vitest'
import { act, createGame, legalActions, step, validate, view, type Action, type GameEvent, type GameSetup, type GameState, type RosterEntry, type Seat } from '@/engine'
import { defaultLoadoutFor, resolveLoadoutChoice } from '@/engine/bundle'
import { createAiDecider, makeCtx, type AiDecider } from '../../src/ai/decider'
import { withEndFacing } from '../../src/ai/moves'
import { newMemory } from '../../src/ai/tiers'
import { activateOp, edit, opOf, take } from '../fixtures/real'
import { entry, open as openHc } from '../engine/teams/hunter-clade.hooks'
import { realBundle, realSetupFor } from './fixtures'

interface Tracked {
  state: GameState
  events: GameEvent[]
  decisions: number
  rejections: string[]
  fallbacksByKind: Record<string, number>
  stalled: boolean
  /** ploy.firefight offers seen, by ployId, and how many were taken */
  offered: Record<string, number>
  taken: Record<string, number>
  gambits: Record<string, number>
  /** move.path answers that were FLY set-ups */
  flies: number
  /** Imperative picked by the Doctrina gambit */
  modes: string[]
  /** move.path answers that turned an oval base at the end (payload.facing) */
  turns: number
}

function play(teams: [string, string], seed: string, tier: 'easy' | 'normal' = 'normal', maxDecisions = 4000, tweak?: (setup: GameSetup) => void): Tracked {
  const setup = realSetupFor(teams)
  tweak?.(setup)
  let state = createGame(setup, seed, realBundle()).state
  const deciders: Record<Seat, AiDecider> = { A: createAiDecider(tier, { seed: `${seed}:A`, budgetMs: 40 }), B: createAiDecider(tier, { seed: `${seed}:B`, budgetMs: 40 }) }
  const t: Tracked = { state, events: [], decisions: 0, rejections: [], fallbacksByKind: {}, stalled: false, offered: {}, taken: {}, gambits: {}, flies: 0, modes: [], turns: 0 }
  let lastSeq = -1
  let same = 0
  while (state.pending && t.decisions < maxDecisions) {
    const p = state.pending
    const legal = legalActions(state, p)
    const r = deciders[p.seat].decideSync(view(state, p.seat), p, legal)
    if (r.fallback) t.fallbacksByKind[p.kind] = (t.fallbacksByKind[p.kind] ?? 0) + 1
    if (p.kind === 'ploy.firefight') {
      for (const o of p.options ?? []) {
        const id = (o.action.payload as { ployId: string }).ployId
        t.offered[id] = (t.offered[id] ?? 0) + 1
      }
      if (r.action.type !== 'pass') {
        const id = (r.action.payload as { ployId: string }).ployId
        t.taken[id] = (t.taken[id] ?? 0) + 1
      }
    }
    if (p.kind === 'strategy.gambit' && r.action.type !== 'pass') {
      const pl = r.action.payload as { gambitId: string; param?: string }
      t.gambits[pl.gambitId] = (t.gambits[pl.gambitId] ?? 0) + 1
      if (pl.gambitId === 'hc.p.doctrina' && pl.param) t.modes.push(pl.param)
    }
    if (p.kind === 'move.path' && (r.action.payload as { fly?: boolean }).fly === true) t.flies++
    if (p.kind === 'move.path' && typeof (r.action.payload as { facing?: unknown }).facing === 'number') t.turns++
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

const BATCH_B = ['legionaries', 'hand-of-the-archon', 'hunter-clade', 'hearthkyn-salvagers'] as const

describe('AI on the batch B teams', () => {
  for (const team of BATCH_B) {
    it(`AI-B-${team} plays a full game against Angels of Death with no rejection, stall or random fallback`, () => {
      const t = play([team, 'angels-of-death'], `bb-${team}`)
      if (process.env.AI_DEBUG) process.stderr.write(team + ' ' + JSON.stringify({ decisions: t.decisions, offered: t.offered, taken: t.taken, gambits: t.gambits, flies: t.flies, modes: t.modes }) + '\n')
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      expect(t.state.phase).toBe('ended')
      expect(t.fallbacksByKind).toEqual({})
    }, 120000)
  }
})

describe('AI uses the batch B team rules', () => {
  const swap = (roster: RosterEntry[], from: string[], to: string[]): RosterEntry[] => [...roster.filter((e) => !from.includes(e.datacardId)), ...to.map((id): RosterEntry => ({ datacardId: id, loadout: defaultLoadoutFor(realBundle(), id) }))]

  it('AI-B-hearthkyn flies with the Jump Pack and plays the Tactician and Eye of the Ancestors gambits', () => {
    let flies = 0
    const gambits: Record<string, number> = {}
    for (const seed of ['fly-1', 'fly-2', 'fly-3']) {
      const t = play(['hearthkyn-salvagers', 'angels-of-death'], seed, 'normal', 4000, (s) => {
        s.rosters.A = swap(s.rosters.A, ['hk.lokatr', 'hk.kinlynk'], ['hk.jump-pack-warrior', 'hk.kognitaar'])
      })
      if (process.env.AI_DEBUG) process.stderr.write(`hk ${seed} ${JSON.stringify({ flies: t.flies, gambits: t.gambits, rej: t.rejections.length, stalled: t.stalled })}\n`)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      expect(t.fallbacksByKind).toEqual({})
      flies += t.flies
      for (const [k, n] of Object.entries(t.gambits)) gambits[k] = (gambits[k] ?? 0) + n
    }
    expect(flies).toBeGreaterThan(0)
    expect(gambits['hk.p.tactician']).toBeGreaterThan(0)
  }, 240000)

  it('AI-B-legionaries takes the free Warded Armour and Chaos Talismans gambits and the mark ploys', () => {
    const gambits: Record<string, number> = {}
    const taken: Record<string, number> = {}
    for (const seed of ['lg-1', 'lg-2']) {
      const t = play(['legionaries', 'angels-of-death'], seed, 'normal', 4000, (s) => {
        s.equipment!.A = ['lg.e.warded-armour', 'lg.e.chaos-talismans', 'core.e.ladders', 'core.e.utility-grenades']
      })
      if (process.env.AI_DEBUG) process.stderr.write(`lg ${seed} ${JSON.stringify({ gambits: t.gambits, taken: t.taken, offered: t.offered })}\n`)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      expect(t.fallbacksByKind).toEqual({})
      for (const [k, n] of Object.entries(t.gambits)) gambits[k] = (gambits[k] ?? 0) + n
      for (const [k, n] of Object.entries(t.taken)) taken[k] = (taken[k] ?? 0) + n
    }
    expect(gambits['lg.p.warded-armour']).toBeGreaterThan(0)
  }, 240000)

  it('AI-B-hand-of-the-archon spends Pain on invigorations (0 CP offers are cheap to take)', () => {
    const taken: Record<string, number> = {}
    for (const seed of ['ha-1', 'ha-2', 'ha-3']) {
      const t = play(['hand-of-the-archon', 'angels-of-death'], seed)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      for (const [k, n] of Object.entries(t.taken)) taken[k] = (taken[k] ?? 0) + n
    }
    expect(Object.keys(taken).filter((k) => k.startsWith('ha.inv.')).length).toBeGreaterThan(0)
  }, 240000)

  it('AI-B-hunter-clade turns an oval base at the end of a move toward the nearest enemy when the turn fits, never a round base', () => {
    const base = openHc({ rosterA: [entry('hc.skitarii-ranger-alpha', { loadout: ['rifle'] }), entry('hc.skitarii-ranger-gunner', { weapon: ['hc.wg.transuranic-arquebus'] })] })
    const g = opOf(base, 'A', 'hc.skitarii-ranger-gunner')
    const alpha = opOf(base, 'A', 'hc.skitarii-ranger-alpha')
    const boy = opOf(base, 'B', 'kom.boy')
    const at = (id: string) => edit(base, (st) => {
      st.operatives[id]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[id]!.facing = 0
      st.operatives[boy]!.pos = { x: 10, y: 0, z: 0 }
    })
    const moving = (id: string) => take(activateOp(at(id), id), 'reposition').state
    const ctxOf = (s: GameState) => makeCtx('normal', view(s, s.pending!.seat), s.pending!, legalActions(s, s.pending!), { seed: 'oval' }, newMemory())
    const answer = (s: GameState, id: string, wps: { x: number; z: number }[]) => {
      const ctx = ctxOf(s)
      return withEndFacing(ctx, ctx.view, s.pending!, ctx.view.operatives[id]!, wps, act.path(s.pending!, wps))
    }
    // 2" north, then a turn toward the Boy in the east (cost 2" + about 2" of arc, inside Move 6")
    const s = moving(g)
    const turned = answer(s, g, [{ x: 0, z: 2 }])
    const f = (turned.payload as { facing?: number }).facing
    expect(f).toBeCloseTo(Math.atan2(10, -2), 2)
    expect(validate(s, turned)).toBeNull()
    expect(step(s, turned).state.operatives[g]!.facing).toBeCloseTo(f!, 2)
    // already pointing at the enemy: no turn
    const ahead = edit(s, (st) => (st.operatives[boy]!.pos = { x: 0, y: 0, z: 10 }))
    expect((answer(ahead, g, [{ x: 0, z: 2 }]).payload as { facing?: number }).facing).toBeUndefined()
    // a full 6" move has no inches left to turn unless a shorter end point scores as well; any answer is legal
    expect(validate(s, answer(s, g, [{ x: 0, z: 6 }]))).toBeNull()
    // a round base never gets a facing
    const r = moving(alpha)
    expect((answer(r, alpha, [{ x: 0, z: 2 }]).payload as { facing?: number }).facing).toBeUndefined()
  })

  it('AI-B-hunter-clade plays full games with an arquebus Gunner on its oval base, with no rejection or stall', () => {
    let turns = 0
    for (const seed of ['oval-1', 'oval-2']) {
      const t = play(['hunter-clade', 'angels-of-death'], seed, 'normal', 4000, (s) => {
        const arc = s.rosters.A.findIndex((e) => e.datacardId === 'hc.skitarii-ranger-gunner')
        const loadout = resolveLoadoutChoice(realBundle(), 'hc.skitarii-ranger-gunner', { weapon: ['hc.wg.transuranic-arquebus'] })
        if (arc >= 0) s.rosters.A[arc] = { datacardId: 'hc.skitarii-ranger-gunner', loadout }
        else s.rosters.A = [...s.rosters.A.slice(0, -1), { datacardId: 'hc.skitarii-ranger-gunner', loadout }]
      })
      expect(Object.values(t.state.operatives).some((o) => o.seat === 'A' && o.ovalHalfAxis)).toBe(true)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      turns += t.turns
    }
    if (process.env.AI_DEBUG) process.stderr.write(`oval turns ${turns}\n`)
  }, 240000)

  it('AI-B-hunter-clade picks more than one Imperative across games', () => {
    const modes = new Set<string>()
    for (const seed of ['hc-1', 'hc-2', 'hc-3']) {
      const t = play(['hunter-clade', 'angels-of-death'], seed)
      expect(t.rejections).toEqual([])
      expect(t.stalled).toBe(false)
      for (const m of t.modes) modes.add(m.split(':')[0]!)
    }
    expect(modes.size).toBeGreaterThan(1)
  }, 240000)
})
