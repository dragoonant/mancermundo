// One AI match: two deciders play a seeded game through the engine while we count what the AI bench reports
// (rejections, stalls, decision time, activations with no action). The game loop here is, like the sim, a caller of `step`.
import { createGame, legalActions, step, view, type Action, type EngineBundle, type GameSetup, type GameState, type Seat } from '@/engine'
import type { AiDecider } from '../src/ai/decider'

export interface SeatStats {
  decisions: number
  ms: number
  maxMs: number
  fallbacks: number
  rejections: number
  activations: number
  zeroAction: number
}

export interface MatchResult {
  seed: string
  ended: boolean
  winner: Seat | 'draw' | null
  vp: Record<Seat, number>
  decisions: number
  turningPoints: number
  stalled: boolean
  seats: Record<Seat, SeatStats>
  /** first rejection text, for the report */
  firstRejection: string | null
}

const MAX_DECISIONS = 4500
const STALL_LIMIT = 200

function progressKey(s: GameState): string {
  const a = s.firefight.activation
  let ready = 0
  let placed = 0
  for (const o of Object.values(s.operatives)) {
    if (o.ready) ready++
    if (o.status === 'active') placed++
  }
  return `${s.phase}|${s.turningPoint}|${ready}|${placed}|${a ? `${a.operativeId}:${a.apSpent}:${a.performed.length}` : '-'}|${s.players.A.cp}|${s.players.B.cp}`
}

const blank = (): SeatStats => ({ decisions: 0, ms: 0, maxMs: 0, fallbacks: 0, rejections: 0, activations: 0, zeroAction: 0 })

export function playMatch(setup: GameSetup, bundle: EngineBundle, seed: string, deciders: Record<Seat, AiDecider>): MatchResult {
  let state = createGame(setup, seed, bundle).state
  const seats: Record<Seat, SeatStats> = { A: blank(), B: blank() }
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
      const r = d.decideSync(view(state, seat), pending, legal)
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
    const prev = state
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
      firstRejection ??= `${pending.kind} ${action.type}: ${r.rejection.code} ${r.rejection.reason}`
      // keep the game going with the first legal answer so one bug does not hide the rest
      const alt = legal?.[0]
      if (!alt) break
      const r2 = step(state, alt)
      if (r2.rejection) break
      state = r2.state
    } else {
      for (const ev of r.events) {
        if (ev.type === 'OperativeExpended') {
          const a = prev.firefight.activation
          if (a && !a.counteract) {
            const s = seats[prev.operatives[a.operativeId]!.seat]
            s.activations++
            if (a.performed.length === 0) s.zeroAction++
          }
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
    vp: { A: state.players.A.vp, B: state.players.B.vp },
    decisions,
    turningPoints: state.turningPoint,
    stalled,
    seats,
    firstRejection,
  }
}
