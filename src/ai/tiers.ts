// AI tiers, tunable weights, the per-decision work budget and the shared context types (docs/spec/40-ai section 1).
// Difficulty is scoring noise plus lookahead depth. `AI_MS` (default 150) maps to a deterministic work cap (the
// number of candidate positions the planner may evaluate) with a wall-clock hard stop at 4x the budget; `AI_TUNE`
// overrides weights, as JSON (`{"threat":0.7}`) or `threat=0.7,dmg=1.1`.
import type { Action, GameState, PendingDecision, Seat } from '@/engine'

export type Tier = 'random' | 'easy' | 'normal'
export const TIER_IDS: readonly Tier[] = ['random', 'easy', 'normal']

export interface TierParams {
  /** choose uniformly among the best `topK` candidates (1 = always the best) */
  topK: number
  /** candidate end points tried per move action */
  endpoints: number
  /** plan depth in actions (1 = best single action, 3 = full activation) */
  depth: number
  /** weight on end-position exposure (0 disables the threat map) */
  threatScale: number
  /** how many ready operatives get a full plan when choosing who activates */
  plannedOps: number
  /** exact expectedDamage refinement of the top plans */
  refine: boolean
  /** objective play looks at the turning point and crit op */
  tacAware: boolean
}

export const TIERS: Record<Exclude<Tier, 'random'>, TierParams> = {
  easy: { topK: 3, endpoints: 6, depth: 1, threatScale: 0.25, plannedOps: 3, refine: false, tacAware: false },
  normal: { topK: 1, endpoints: 12, depth: 3, threatScale: 1, plannedOps: 4, refine: true, tacAware: true },
}

export interface Weights {
  /** per wound of expected damage dealt (capped by the target's wounds) */
  dmg: number
  /** per unit of kill probability */
  kill: number
  /** per wound of expected incoming damage at the end position */
  threat: number
  /** extra penalty per unit of probability of being incapacitated */
  die: number
  /** wounds-equivalent of one victory point */
  vp: number
  /** per inch closer to the objective the operative should take */
  approach: number
  /** value of Guard when nothing better exists */
  guard: number
  /** Vantage/cover tie-break bonus */
  position: number
  /** a plan with actions beats standing still when it loses less than this */
  act: number
}

export const DEFAULT_WEIGHTS: Weights = {
  dmg: 1,
  kill: 4,
  threat: 0.5,
  die: 3.5,
  vp: 4,
  approach: 0.12,
  guard: 0.5,
  position: 0.3,
  act: 1.2,
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

/**
 * Candidate-position evaluations per millisecond of budget (calibrated with tools/ai-bench.ts: one evaluation is
 * about 0.3 ms of engine geometry, so the default 150 ms budget is a cap of 150 units, about 45 ms of work, which
 * leaves headroom for slow machines). `AI_WORK` overrides it.
 */
export function workPerMs(): number {
  const n = Number(envOf('AI_WORK'))
  return Number.isFinite(n) && n > 0 ? n : 1
}
export const WORK_PER_MS = 1

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
  fallbacks: number
  errors: number
  hardStops: number
  byKind: Record<string, DecisionStats>
}

export function newStats(): AiStats {
  return { decisions: 0, ms: 0, maxMs: 0, fallbacks: 0, errors: 0, hardStops: 0, byKind: {} }
}

export interface PlanStep {
  /** firefight.action option id the step is taken with (`shoot`, `reposition`, `ability:<id>:<key>`) */
  action: string
  /** movement steps: the validated path */
  wps?: { x: number; z: number; y?: number; jump?: boolean }[]
  /** the move is a FLY set-up (Jump Pack): answered with one waypoint */
  fly?: boolean
  /** charge/fight/shoot: the enemy the step is aimed at */
  targetId?: string
  weaponId?: string
}

export interface ActivationPlan {
  operativeId: string
  turningPoint: number
  counteract: boolean
  /** actions already performed when the plan was made (the steps continue from here) */
  base: number
  order: 'engage' | 'conceal'
  steps: PlanStep[]
  score: number
  gain: number
}

export interface AiMemory {
  plan: ActivationPlan | null
  /** the shot chosen at the shoot.weapon decision (weapon, target) */
  shot: { operativeId: string; weaponId: string; targetId: string } | null
  /** decisions answered in the current activation, to break loops */
  activationDecisions: number
  activationKey: string
  /** firefight.action ids the engine did not accept or that produced no path in this activation */
  banned: string[]
  stats: AiStats
}

export function newMemory(): AiMemory {
  return { plan: null, shot: null, activationDecisions: 0, activationKey: '', banned: [], stats: newStats() }
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
  /** position evaluations cached for the lifetime of this decision */
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
