// The AI decider (docs/spec/40-ai.md): `createAiDecider(tier, { seed })` implements the engine `Decider`. It dispatches on
// `pending.kind` to a policy, checks the answer (a legal option for finite decisions, `validate` for continuous ones) and,
// when a policy returns nothing usable, answers with the engine's `suggest` (then the first legal option, then a pass),
// never at random for the easy and normal tiers. Every such use is counted (`stats.fallbacks`, `stats.unhandled` by kind) so
// the bench can refuse a build that quietly stops handling a decision kind. All randomness comes from
// `SeededRng(seed + decision id)`; the same inputs and seed give the same answer.
import { query, SeededRng, validate, view as viewOf, legalActions, type Action, type Decider, type DecisionKind, type GameState, type PendingDecision, type PlayerView } from '@/engine'
import * as end from './end'
import { internBoard } from './intern'
import * as fight from './fight'
import * as moves from './moves'
import { passAction, randomPolicy, suggestPolicy } from './random'
import * as setup from './setup'
import * as shoot from './shoot'
import * as skills from './skills'
import { aiBudgetMs, clock, newMemory, tunedWeights, TIERS, workPerMs, type AiCtx, type AiMemory, type Tier, type TierParams, type Weights } from './tiers'

type Policy = (ctx: AiCtx) => Action | null

/** One policy per decision kind. A kind missing here is answered by `suggestPolicy` and counted as unhandled. */
export const POLICIES: Record<DecisionKind, Policy> = {
  'setup.role': setup.role,
  'setup.crew': setup.crew,
  'setup.casket': setup.casket,
  'setup.zone': setup.zone,
  'setup.deploy': setup.deploy,
  'action.flee': end.flee,
  'action.activate': moves.activate,
  'action.group': moves.group,
  'action.choose': moves.chooseAction,
  'move.path': moves.movePath,
  'shoot.weapon': shoot.weapon,
  'shoot.target': shoot.target,
  'shoot.aim': shoot.aim,
  'shoot.allocate': shoot.allocate,
  'shoot.firepower': shoot.firepower,
  'fight.weapons': fight.weapons,
  'fight.split': fight.split,
  'fight.after': fight.after,
  'fight.followUp': fight.followUp,
  'end.bottle': end.bottle,
  'end.assist': end.assist,
  'end.recoveryPick': end.recoveryPick,
  'skill.choice': skills.skillChoice,
  'dice.reroll': end.reroll,
  confirm: end.confirm,
}

export interface AiOpts {
  /** the game seed (any string); streams are derived per decision id */
  seed: string
  /** per-decision budget in ms (default `AI_MS` or 150) */
  budgetMs?: number
  /** weights override (default: defaults with `AI_TUNE`) */
  weights?: Partial<Weights>
  /** persistent memory (the intent of the activation, stats) */
  memory?: AiMemory
  /** clock for tests */
  now?: () => number
}

export interface AiDecider extends Decider {
  readonly tier: Tier
  readonly memory: AiMemory
  /** Synchronous core (bench, worker, tests). `fallback` is true when the suggestion fallback answered instead of a policy. */
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

/**
 * Forgotten Riches and Smash & Grab are won on caskets, and a battle ends the moment one gang is gone: finishing the last
 * enemies while level or behind on loot would throw the scenario away (an equal count in Forgotten Riches is a draw; in Smash &
 * Grab fewer than three caskets cracked is a defender win, whoever is left standing). Damage is worth little then; hauling and
 * cracking keep their full value.
 */
function damped(w: Weights, state: GameState): Weights {
  const id = state.scenario.id
  if ((id !== 'scn.forgotten-riches' && id !== 'scn.smash-and-grab') || state.phase === 'setup') return w
  const me = (state as unknown as PlayerView).viewer
  const enemy = me === 'A' ? 'B' : 'A'
  let standing = 0
  for (const f of Object.values(state.fighters)) if (f.seat === enemy && f.location === 'board' && f.posture !== 'seriouslyInjured') standing++
  const v = query.scenarioView(state)
  if (id === 'scn.forgotten-riches') {
    if (standing > 2) return w
    return v.secured[me] > v.secured[enemy] ? w : { ...w, dmg: w.dmg * 0.25 }
  }
  // the raiders: a gang that breaks (or is wiped out) ends the battle, and the defenders win it with fewer than three caskets cracked, so kills matter less and less the closer the defenders are to breaking; discounted from the first kill, steeply near the end
  if (state.players[me].role !== 'attacker' || v.opened >= (v.goal?.needed ?? 3)) return w
  return { ...w, dmg: w.dmg * (standing <= 3 || state.players[enemy].bottled ? 0.1 : standing <= 6 ? 0.3 : 0.5) }
}

export function makeCtx(tier: Tier, rawView: PlayerView, pending: PendingDecision, legal: Action[] | null, opts: AiOpts, memory: AiMemory): AiCtx {
  const view = internBoard(rawView)
  const now = opts.now ?? clock
  const params: TierParams = tier === 'random' ? TIERS.normal : TIERS[tier]
  const rng = SeededRng.fromSeed(`${opts.seed}|${pending.id}|${tier}`)
  const budget = opts.budgetMs ?? aiBudgetMs()
  const t0 = now()
  return {
    tier,
    params,
    w: damped({ ...tunedWeights(), ...opts.weights }, view as unknown as GameState),
    seat: view.viewer,
    view: view as unknown as GameState,
    pending,
    legal,
    seed: opts.seed,
    rand: () => rng.next32() / 0x100000000,
    int: (n: number) => rng.int(Math.max(1, n)),
    memory,
    work: { n: 0, cap: Math.max(12, Math.ceil(budget * workPerMs())), hardAt: t0 + budget * 4, hard: false },
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
    const st = memory.stats
    if (tier === 'random') {
      try {
        action = randomPolicy(ctx)
      } catch {
        action = passAction(pending)
      }
    } else {
      const policy = (POLICIES as Partial<Record<string, Policy>>)[pending.kind]
      if (!policy) {
        st.unhandled[pending.kind] = (st.unhandled[pending.kind] ?? 0) + 1
      } else {
        try {
          const a = policy(ctx)
          if (answerOk(ctx.view, legal, a)) action = a
          else st.errors += a ? 1 : 0
        } catch (e) {
          st.errors++
          if (typeof process !== 'undefined' && process.env?.AI_DEBUG) console.error('policy threw', pending.kind, e)
        }
      }
      if (!action) {
        fallback = true
        try {
          action = suggestPolicy(ctx)
        } catch {
          action = passAction(pending)
        }
      }
    }
    const ms = ctx.now() - t0
    st.decisions++
    st.ms += ms
    st.maxMs = Math.max(st.maxMs, ms)
    if (st.samples.length < 20000) st.samples.push(ms)
    if (fallback) st.fallbacks++
    if (ctx.work.hard) st.hardStops++
    const k = (st.byKind[pending.kind] ??= { n: 0, ms: 0, max: 0, fallbacks: 0 })
    k.n++
    k.ms += ms
    k.max = Math.max(k.max, ms)
    if (fallback) k.fallbacks++
    return { action: action!, fallback, ms }
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

/**
 * A drop-in bot for the client's bot loop (same shape as the random bot: `decide(state, pending) => Action`, synchronous,
 * reading the full state through the redacted view). One per seat; the memory lives as long as the bot.
 */
export interface AiBot {
  readonly tier: Tier
  readonly memory: AiMemory
  decide(state: GameState, pending: PendingDecision): Action
}

export function createAiBot(tier: Tier, seed: string, opts: Partial<AiOpts> = {}): AiBot {
  const d = createAiDecider(tier, { ...opts, seed })
  return {
    tier,
    memory: d.memory,
    decide(state, pending) {
      return d.decideSync(viewOf(state, pending.seat), pending, legalActions(state, pending)).action
    },
  }
}

export type { DecisionKind }
