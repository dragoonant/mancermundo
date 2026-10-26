// AI tiers, tunable weights, the per-decision work budget and the shared context types (docs/spec/40-ai.md section 1).
// Difficulty is scoring noise plus how much of the board the planner looks at. `AI_MS` (default 150) maps to a deterministic
// work cap (candidate positions the planner may evaluate) with a wall-clock hard stop at 4x the budget; `AI_TUNE` overrides
// weights as JSON (`{"threat":0.7}`) or `threat=0.7,dmg=1.1`.
import type { Action, GameState, PendingDecision, Seat } from '@/engine'

export type Tier = 'random' | 'easy' | 'normal'
export const TIER_IDS: readonly Tier[] = ['random', 'easy', 'normal']

export interface TierParams {
  /** choose uniformly among the best `topK` candidates of the activation planner (1 = always the best) */
  topK: number
  /** candidate end spots tried per move action (polar ring samples; goal-directed spots come on top) */
  spots: number
  /** weight on end-position exposure (0 disables the threat map) */
  threatScale: number
  /** score a second action from the spot a first action reaches (move then shoot, shoot then take cover) */
  lookahead: boolean
  /** use the scenario's objectives (caskets, doors that open the way) */
  objectives: boolean
}

export const TIERS: Record<Exclude<Tier, 'random'>, TierParams> = {
  easy: { topK: 3, spots: 10, threatScale: 0.45, lookahead: false, objectives: false },
  normal: { topK: 1, spots: 22, threatScale: 1, lookahead: true, objectives: true },
}

export interface Weights {
  /** multiplier on the value of damage dealt (kills, Seriously Injured, pins, wounds) */
  dmg: number
  /** multiplier on end-position exposure (expected loss next round) */
  threat: number
  /** value per inch of progress toward the fighter's goal (an ideal firing range, an objective, a door) */
  approach: number
  /** value of every friend that gives nerve support at the end spot (capped at two) */
  cohesion: number
  /** value of the best shot available from the end spot, for the activation after this one */
  potential: number
  /** a plan with actions beats standing still when it loses less than this */
  act: number
  /** value of a pin on a Standing target, as a share of the target's value */
  pin: number
  /** the cost of falling prone (Take Cover): one action to stand up again */
  prone: number
  /** extra approach pressure per quiet round (a stall breaker) */
  patience: number
}

export const DEFAULT_WEIGHTS: Weights = {
  dmg: 1,
  threat: 1,
  approach: 0.09,
  cohesion: 0.07,
  potential: 0.3,
  act: 0.2,
  pin: 0.22,
  prone: 0.18,
  patience: 0.03,
}

function envOf(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env?.[name]
}

function parseTune(text: string | undefined): Partial<Weights> {
  if (!text) return {}
  const out: Record<string, number> = {}
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    for (const [k, v] of Object.entries(j)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    return out as Partial<Weights>
  } catch {
    for (const part of text.split(',')) {
      const [k, v] = part.split('=')
      const n = Number(v)
      if (k && Number.isFinite(n)) out[k.trim()] = n
    }
    return out as Partial<Weights>
  }
}

let weightsCache: Weights | null = null
/** Default weights with `AI_TUNE` applied (read once). */
export function tunedWeights(): Weights {
  if (!weightsCache) {
    const t = parseTune(envOf('AI_TUNE'))
    weightsCache = { ...DEFAULT_WEIGHTS }
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) if (typeof t[k] === 'number') weightsCache[k] = t[k]!
  }
  return weightsCache
}

/** Per-decision budget in milliseconds: `AI_MS` or 150. */
export function aiBudgetMs(): number {
  const n = Number(envOf('AI_MS'))
  return Number.isFinite(n) && n > 0 ? n : 150
}

/** Candidate evaluations per millisecond of budget; `AI_WORK` overrides it. */
export function workPerMs(): number {
  const n = Number(envOf('AI_WORK'))
  return Number.isFinite(n) && n > 0 ? n : 1.5
}

export interface Work {
  /** evaluations spent */
  n: number
  /** deterministic cap */
  cap: number
  /** wall-clock hard stop (performance.now units) */
  hardAt: number
  /** the hard stop fired (counts as a fallback in the bench) */
  hard: boolean
}

export interface DecisionStats {
  n: number
  ms: number
  max: number
  fallbacks: number
}

export interface AiStats {
  decisions: number
  ms: number
  maxMs: number
  /** a decision the policy could not score (an unhandled kind, an invalid answer, a throw) and the scored fallback answered */
  fallbacks: number
  /** decision kinds no policy knows, by kind (must stay empty) */
  unhandled: Record<string, number>
  /** policy failures: it threw or returned an answer the engine would refuse */
  errors: number
  hardStops: number
  byKind: Record<string, DecisionStats>
  /** the last decision times in ms (for p50 / p95) */
  samples: number[]
}

export function newStats(): AiStats {
  return { decisions: 0, ms: 0, maxMs: 0, fallbacks: 0, unhandled: {}, errors: 0, hardStops: 0, byKind: {}, samples: [] }
}

/** The shot or move the planner settled on for the activation in progress (kept so the sub-decisions agree with it). */
export interface Intent {
  fighterId: string
  /** `action.choose` option ids that did not lead anywhere in this activation (a move with no legal path, a shot given back) */
  banned: string[]
  /** the destination chosen by the last `move`/`takeCover`/`crawl` choice, answered at the following `move.path` */
  dest: { path: { x: number; z: number }[]; facing: number | null; kind: string } | null
  /** the option id picked at the last action.choose (banned again if its sub-decision found nothing to do) */
  chosen: string | null
  /** where the fighter stood when the activation began */
  startPos: { x: number; z: number } | null
}

export interface AiMemory {
  /** the intent of the activation in progress (destination chosen at action.choose, answered at move.path) */
  intent: Intent | null
  intentKey: string
  /** action.choose decisions answered in this activation (a watchdog against loops of cancelled actions) */
  chooseCount: number
  /** where each gang started (a place to carry loot back to) */
  home?: Partial<Record<Seat, { x: number; z: number }>>
  /** the round of the last casualty seen and of the last decision (the stall breaker) */
  lastCasualtyRound: number
  casualtiesSeen: number
  /** where each of our fighters stood at the end of its last activations (so a move never just undoes the last one) */
  trail: Record<string, { x: number; z: number }[]>
  stats: AiStats
}

export function newMemory(): AiMemory {
  return { intent: null, intentKey: '', chooseCount: 0, lastCasualtyRound: 1, casualtiesSeen: 0, trail: {}, stats: newStats() }
}

/** What every policy sees. `view` is the redacted PlayerView read through the engine's GameState helpers. */
export interface AiCtx {
  tier: Tier
  params: TierParams
  w: Weights
  seat: Seat
  view: GameState
  pending: PendingDecision
  legal: Action[] | null
  seed: string
  /** uniform float in [0, 1) from the seeded stream of this decision */
  rand(): number
  /** uniform integer in [0, n) */
  int(n: number): number
  memory: AiMemory
  work: Work
  now(): number
  /** values cached for the lifetime of this decision */
  cache: Map<string, unknown>
}

export function clock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** Spend `units` of the work cap; false once the cap or the wall-clock hard stop is reached. */
export function spend(ctx: AiCtx, units = 1): boolean {
  if (ctx.work.n >= ctx.work.cap) return false
  if (ctx.now() > ctx.work.hardAt) {
    ctx.work.hard = true
    return false
  }
  ctx.work.n += units
  return true
}

/** The work cap is reached (or time is up) without spending anything. */
export function exhausted(ctx: AiCtx): boolean {
  if (ctx.work.n >= ctx.work.cap) return true
  if (ctx.now() > ctx.work.hardAt) {
    ctx.work.hard = true
    return true
  }
  return false
}

/** `AI_TRACE=1` prints the scored candidates of every action.choose decision (node only). */
export function tracing(): boolean {
  return !!envOf('AI_TRACE')
}
