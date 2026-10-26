// The AI decider (docs/spec/40-ai): `createAiDecider(tier, { seed })` implements the engine `Decider`. It dispatches
// on `pending.kind` to a policy, checks the answer (a legal template for finite decisions, `validate` for continuous
// ones) and falls back to the random policy on null, an invalid answer or a throw, so it never throws and never
// returns an action the engine would reject. All randomness comes from `SeededRng(seed + decision id)`.
import { SeededRng, validate, type Action, type Decider, type DecisionKind, type GameState, type PendingDecision, type PlayerView } from '@/engine'
import { answerDecision } from '@/engine/query'
import * as choices from './choices'
import * as fight from './fight'
import * as moves from './moves'
import * as ploys from './ploys'
import { passAction, randomPolicy } from './random'
import * as setup from './setup'
import * as shoot from './shoot'
import { placeMarker } from './teamActions'
import { aiBudgetMs, clock, newMemory, tunedWeights, TIERS, workPerMs, type AiCtx, type AiMemory, type Tier, type TierParams, type Weights } from './tiers'

type Policy = (ctx: AiCtx) => Action | null

const first: Policy = (ctx) => ctx.legal?.[0] ?? null
const answer: Policy = (ctx) => answerDecision(ctx.view, ctx.pending)

export const POLICIES: Partial<Record<DecisionKind, Policy>> = {
  'setup.initiative': first,
  'strategy.initiative': first,
  'setup.decideInitiative': setup.decideInitiative,
  'strategy.decideInitiative': setup.decideInitiative,
  'setup.objective': setup.objective,
  'setup.dropZone': setup.dropZone,
  'setup.equipMarker': setup.equipMarker,
  'setup.deploy': setup.deploy,
  'strategy.gambit': ploys.gambit,
  'firefight.activate': moves.activate,
  'firefight.order': moves.order,
  'firefight.action': moves.action,
  'move.path': moves.movePath,
  'shoot.weapon': shoot.shootWeapon,
  'shoot.target': shoot.shootTarget,
  'shoot.coverSave': shoot.defenceAnswer,
  'shoot.block': shoot.defenceAnswer,
  'weapon.choice': shoot.weaponChoice,
  'fight.target': fight.fightTarget,
  'fight.weapon': fight.fightWeapon,
  'fight.resolve': fight.fightResolve,
  'dice.reroll': ploys.ruleReroll,
  'dice.commandReroll': ploys.commandReroll,
  'ploy.firefight': ploys.firefightPloy,
  'ability.choice': choices.abilityChoice,
  // Place Marker (team mines); free-point decisions keep the random answer they always had
  'marker.place': (ctx) => placeMarker(ctx) ?? randomPolicy(ctx),
  'guard.interrupt': (ctx) => fight.guardInterrupt(ctx) ?? passAction(ctx.pending),
  confirm: (ctx) => ctx.legal?.[0] ?? (ctx.pending.canPass ? passAction(ctx.pending) : null),
}

export interface AiOpts {
  /** the game seed (any string); streams are derived per decision id */
  seed: string
  /** per-decision budget in ms (default `AI_MS` or 150) */
  budgetMs?: number
  /** weights override (default: defaults with `AI_TUNE`) */
  weights?: Partial<Weights>
  /** persistent memory (the plan of the current activation, stats) */
  memory?: AiMemory
  /** clock for tests */
  now?: () => number
}

export interface AiDecider extends Decider {
  readonly tier: Tier
  readonly memory: AiMemory
  /** Synchronous core (bench, worker, tests). `fallback` is true when the random policy answered instead. */
  decideSync(view: PlayerView, pending: PendingDecision, legal: Action[] | null): { action: Action; fallback: boolean; ms: number }
}

function sameAction(a: Action, b: Action): boolean {
  return a.type === b.type && a.decisionId === b.decisionId && a.seat === b.seat && JSON.stringify(a.payload) === JSON.stringify(b.payload)
}

/** A usable answer: in the legal set for finite decisions, passing `validate` for continuous ones. */
export function answerOk(view: GameState, legal: Action[] | null, a: Action | null): a is Action {
  if (!a) return false
  if (legal && legal.length > 0) return legal.some((l) => sameAction(l, a))
  return validate(view, a) === null
}

export function makeCtx(tier: Tier, view: PlayerView, pending: PendingDecision, legal: Action[] | null, opts: AiOpts, memory: AiMemory): AiCtx {
  const now = opts.now ?? clock
  const params: TierParams = tier === 'random' ? TIERS.normal : TIERS[tier]
  const rng = SeededRng.fromSeed(`${opts.seed}|${pending.id}|${tier}`)
  const budget = opts.budgetMs ?? aiBudgetMs()
  const t0 = now()
  return {
    tier,
    params,
    w: { ...tunedWeights(), ...opts.weights },
    seat: view.viewer,
    view: view as unknown as GameState,
    pending,
    legal,
    seed: opts.seed,
    rand: () => rng.next32() / 0x100000000,
    int: (n: number) => rng.int(Math.max(1, n)),
    memory,
    work: { n: 0, cap: Math.max(8, Math.ceil(budget * workPerMs())), hardAt: t0 + budget * 4, hard: false },
    now,
    cache: new Map(),
  }
}

/** The AI decider for a tier ('random' answers uniformly). The same inputs and seed give the same answer. */
export function createAiDecider(tier: Tier, opts: AiOpts): AiDecider {
  const memory = opts.memory ?? newMemory()
  function decideSync(view: PlayerView, pending: PendingDecision, legal: Action[] | null) {
    const ctx = makeCtx(tier, view, pending, legal, opts, memory)
    const t0 = ctx.now()
    let action: Action | null = null
    let fallback = false
    if (tier !== 'random') {
      try {
        const policy = POLICIES[pending.kind]
        const a = policy ? policy(ctx) : null
        if (answerOk(ctx.view, legal, a)) action = a
      } catch {
        memory.stats.errors++
      }
    }
    if (!action) {
      // unknown kinds and failures answer randomly; only a tier that should have scored this counts as a fallback
      fallback = tier !== 'random' && !!POLICIES[pending.kind]
      try {
        action = randomPolicy(ctx)
      } catch {
        action = passAction(pending)
      }
    }
    const ms = ctx.now() - t0
    const st = memory.stats
    st.decisions++
    st.ms += ms
    st.maxMs = Math.max(st.maxMs, ms)
    if (fallback) st.fallbacks++
    if (ctx.work.hard) st.hardStops++
    const k = (st.byKind[pending.kind] ??= { n: 0, ms: 0, max: 0, fallbacks: 0 })
    k.n++
    k.ms += ms
    k.max = Math.max(k.max, ms)
    if (fallback) k.fallbacks++
    return { action, fallback, ms }
  }
  return {
    tier,
    memory,
    decideSync,
    decide(view, pending, legal) {
      return Promise.resolve(decideSync(view, pending, legal).action)
    },
  }
}
