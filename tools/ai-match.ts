// One AI match: two deciders play a seeded game through the engine while we count what the AI bench reports (rejections,
// stalls, decision time, activations that did nothing, decisions answered by the fallback). The game loop here is, like the
// sim, a caller of `step`.
import { createGame, legalActions, query, step, view, type Action, type EngineBundle, type GameSetup, type GameState, type Seat } from '@/engine'
import type { AiDecider } from '../src/ai/decider'

export interface SeatStats {
  decisions: number
  ms: number
  maxMs: number
  fallbacks: number
  rejections: number
  activations: number
  /** activations that ended with no action while at least one action was on offer */
  zeroAction: number
  /** casket and loot actions taken, and the kinds of action taken (for the behaviour audit) */
  actions: Record<string, number>
  /** the zero-action activations by the fighter's status when it ended (a standing fighter with nothing worth doing is a hold) */
  zeroBy: Record<string, number>
}

export interface MatchResult {
  seed: string
  ended: boolean
  winner: Seat | 'draw' | null
  reason: string | null
  /** scenario points at the end */
  points: Record<Seat, number>
  /** who would win by the scenario's own rules if the battle ended now (what a round cap is judged by) */
  leading: Seat | 'draw' | null
  /** attacker / defender per seat (Smash & Grab) */
  roles: Record<Seat, string | null>
  /** loot caskets secured per gang and caskets cracked open at the end (the casket scenarios) */
  loot: { secured: Record<Seat, number>; opened: number }
  /** casualty-weighted margin (Leader 3, Champion 2, other 1 per fighter Out of Action or fled) for a battle cut short by the round cap */
  casualtyPoints: Record<Seat, number>
  decisions: number
  rounds: number
  stalled: boolean
  seats: Record<Seat, SeatStats>
  /** first rejection text, for the report */
  firstRejection: string | null
  /** count of decisions by kind */
  kinds: Record<string, number>
}

const MAX_DECISIONS = 6000
const STALL_LIMIT = 250

function progressKey(s: GameState): string {
  const a = s.action.activation
  const ready = Object.values(s.fighters).filter((f) => f.ready).length
  const deployed = Object.values(s.fighters).filter((f) => f.location === 'board').length
  return `${s.phase}|${s.round}|${ready}|${deployed}|${a ? `${a.fighterId}:${a.actionsLeft}:${a.performed.length}` : '-'}|${s.setup.step}|${s.setup.crewDone.length}|${s.end.step}|${s.casualties.length}`
}

const blank = (): SeatStats => ({ decisions: 0, ms: 0, maxMs: 0, fallbacks: 0, rejections: 0, activations: 0, zeroAction: 0, actions: {}, zeroBy: {} })

export function casualtyPoints(s: GameState): Record<Seat, number> {
  const out: Record<Seat, number> = { A: 0, B: 0 }
  for (const c of s.casualties) {
    if (c.kind === 'seriouslyInjured') continue
    const f = s.fighters[c.fighterId]
    if (!f) continue
    out[f.seat === 'A' ? 'B' : 'A'] += f.role === 'leader' ? 3 : f.role === 'champion' ? 2 : 1
  }
  return out
}

export function playMatch(setup: GameSetup, bundle: EngineBundle, seed: string, deciders: Record<Seat, AiDecider>): MatchResult {
  let state = createGame(setup, seed, bundle).state
  const seats: Record<Seat, SeatStats> = { A: blank(), B: blank() }
  const kinds: Record<string, number> = {}
  let decisions = 0
  let stall = 0
  let stalled = false
  let lastKey = progressKey(state)
  let firstRejection: string | null = null
  while (state.pending && decisions < MAX_DECISIONS) {
    const pending = state.pending
    const seat = pending.seat
    const legal = legalActions(state, pending)
    const d = deciders[seat]
    const stats = seats[seat]
    let action: Action
    try {
      // AI_CLONE=1 hands the decider a structured clone, as a Web Worker gets it (cold engine caches without interning)
      const clone = (process.env.AI_CLONE ? structuredClone : (x: unknown) => x) as <T>(x: T) => T
      const r = d.decideSync(clone(view(state, seat)), clone(pending), clone(legal))
      action = r.action
      stats.decisions++
      stats.ms += r.ms
      stats.maxMs = Math.max(stats.maxMs, r.ms)
      if (r.fallback) stats.fallbacks++
    } catch (e) {
      firstRejection ??= `decider threw: ${(e as Error).message}`
      stats.rejections++
      break
    }
    decisions++
    kinds[pending.kind] = (kinds[pending.kind] ?? 0) + 1
    // an activation ended with nothing done although something could have been
    if (pending.kind === 'action.choose' && action.type === 'action.choose') {
      const a = state.action.activation
      const key = action.payload.action
      stats.actions[key] = (stats.actions[key] ?? 0) + 1
      if (key === 'end' && a && a.performed.length === 0 && (pending.options ?? []).some((o) => o.action.type === 'action.choose' && !['end', 'turn'].includes(o.action.payload.action))) {
        stats.zeroAction++
        const st = String(pending.context.status ?? '?')
        stats.zeroBy[st] = (stats.zeroBy[st] ?? 0) + 1
      }
    }
    let r
    try {
      r = step(state, action)
    } catch (e) {
      firstRejection ??= `engine threw on ${pending.kind} ${JSON.stringify(action.payload).slice(0, 120)}: ${(e as Error).message}`
      stats.rejections++
      break
    }
    if (r.rejection) {
      stats.rejections++
      firstRejection ??= `${pending.kind} ${action.type}: ${r.rejection.code} ${r.rejection.reason} ${JSON.stringify(action.payload).slice(0, 160)}`
      // keep the game going with the first legal answer so one bug does not hide the rest
      const alt = legal?.[0]
      if (!alt) break
      const r2 = step(state, alt)
      if (r2.rejection) break
      state = r2.state
    } else {
      for (const ev of r.events) {
        if (ev.type === 'ActivationEnded') {
          const f = r.state.fighters[ev.fighterId] ?? state.fighters[ev.fighterId]
          if (f) seats[f.seat].activations++
        }
      }
      state = r.state
    }
    const key = progressKey(state)
    stall = key === lastKey ? stall + 1 : 0
    lastKey = key
    if (stall >= STALL_LIMIT) {
      stalled = true
      break
    }
  }
  const res = state.result
  return {
    seed,
    ended: state.phase === 'ended',
    winner: res ? res.winner : null,
    reason: res ? res.reason : null,
    points: res ? res.points : { A: state.players.A.points, B: state.players.B.points },
    leading: res ? query.scenarioView(state).leading : null,
    roles: { A: state.players.A.role, B: state.players.B.role },
    loot: { secured: query.scenarioView(state).secured, opened: query.scenarioView(state).opened },
    casualtyPoints: casualtyPoints(state),
    decisions,
    rounds: state.round,
    stalled,
    seats,
    firstRejection,
    kinds,
  }
}
