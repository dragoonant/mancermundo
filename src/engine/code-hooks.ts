// Registry of `{ "code": "<name>" }` escape hatches (docs/spec/20-data-schema.md section 5). Every name
// in src/data/code-hooks.json must be registered here, and tests/engine/code-hooks.test.ts proves each
// one fires in a game. A code hook is a small definition object; the engine looks it up by name when it
// meets the name inside an ability, ploy or equipment effect.
import type { Ctx } from './registry'
import type { Activation, GameState, Operative, RuntimeAbility, RuntimePloy, Seat } from './types'

/** One way to take a unique, mission or equipment action (one option of a firefight.action decision). */
export interface OfferSeed {
  /** suffix that makes the option id unique, for example a marker or target id */
  key: string
  /** payload fields carried to `perform` (markerId, targetId, param, x, z) */
  params: Record<string, unknown>
  /** overrides the data AP cost */
  cost?: number
  data?: Record<string, unknown>
}

export interface PloyOfferSeed {
  /** variant parameter, for example the doctrine picked */
  param?: string
  /** operative the ploy names (who is shot, who fights, who counteracts) */
  operativeId?: string
  /** replaces the CP cost (Doctrine Warfare makes Combat Doctrine free) */
  cost?: number
  /** why the cost changed, kept in the ledger so the right limited use is consumed */
  costSource?: string
  data?: Record<string, unknown>
}

/** What a ploy window knows when it asks whether a ploy is usable. */
export interface PloyWindowInfo {
  window: string
  /** the operative the ploy names for this seat (shot, fighting, activating, counteracting) */
  subjectId?: string
  actorId?: string
  targetId?: string
  attackerId?: string
  kind?: string
  weaponId?: string
  attackFails?: number
  defenceFails?: number
  critRetained?: boolean
  counteracting?: boolean
  action?: string
  [k: string]: unknown
}

export interface CodeHookDef {
  name: string
  /** the hook adds a unique / mission / equipment action */
  action?: {
    offers(state: GameState, op: Operative, def: RuntimeAbility, act: Activation | null): OfferSeed[]
    /** runs when the action is declared; it must end by calling finishAction/cancelAction (possibly after follow-up decisions) */
    perform(ctx: Ctx, op: Operative, def: RuntimeAbility, params: Record<string, unknown>): void
  }
  /** the hook is the effect of a strategy or firefight ploy */
  ploy?: {
    offers(state: GameState, seat: Seat, ploy: RuntimePloy, info: PloyWindowInfo): PloyOfferSeed[]
    apply(ctx: Ctx, seat: Seat, ploy: RuntimePloy, seed: PloyOfferSeed, info: PloyWindowInfo): void
  }
  /** answers an ability.choice decision whose context names this hook (context.hook) */
  choice?(ctx: Ctx, op: Operative, option: string, context: Record<string, unknown>): void
  /** runs after a move this hook's action declared has been applied (Move With Barricade) */
  afterMove?(ctx: Ctx, op: Operative, from: { x: number; y: number; z: number }, params: Record<string, unknown>): void
  /** called once when the game is created, for every seat whose team uses the hook */
  setup?(ctx: Ctx, seat: Seat, source: string): void
}

const registry = new Map<string, CodeHookDef>()
const fired = new Map<string, number>()

/** Wrap every function member so `hookFireCount(name)` can prove the hook ran. */
export function registerCodeHook(def: CodeHookDef): void {
  const wrapped: CodeHookDef = { name: def.name }
  const count = () => fired.set(def.name, (fired.get(def.name) ?? 0) + 1)
  if (def.action) {
    const a = def.action
    wrapped.action = {
      offers: (...args) => a.offers(...args),
      perform: (...args) => {
        count()
        return a.perform(...args)
      },
    }
  }
  if (def.ploy) {
    const p = def.ploy
    wrapped.ploy = {
      offers: (...args) => p.offers(...args),
      apply: (...args) => {
        count()
        return p.apply(...args)
      },
    }
  }
  if (def.choice) {
    const f = def.choice
    wrapped.choice = (...args) => {
      count()
      return f(...args)
    }
  }
  if (def.afterMove) {
    const f = def.afterMove
    wrapped.afterMove = (...args) => {
      count()
      return f(...args)
    }
  }
  if (def.setup) {
    const f = def.setup
    wrapped.setup = (...args) => {
      count()
      return f(...args)
    }
  }
  registry.set(def.name, wrapped)
}

export function getCodeHook(name: string): CodeHookDef | undefined {
  return registry.get(name)
}

export function registeredCodeHooks(): string[] {
  return [...registry.keys()].sort()
}

/** Passive hooks (attack-sequence handlers, stat rules) call this when their rule actually applies. */
export function markFired(name: string): void {
  fired.set(name, (fired.get(name) ?? 0) + 1)
}

export function hookFireCount(name: string): number {
  return fired.get(name) ?? 0
}

export function resetFireCounts(): void {
  fired.clear()
}
