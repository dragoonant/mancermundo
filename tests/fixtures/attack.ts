// Fixtures for the Shoot and Fight tests: custom weapon profiles on the synthetic team, a staged
// arena, and a driver that answers decisions with scripted dice and the engine's default answers.
import { act } from '@/engine/actions'
import { step } from '@/engine'
import type { GameEvent } from '@/engine/events'
import { answerDecision } from '@/engine/query'
import type { Rng } from '@/engine/rng'
import { cloneState } from '@/engine/state'
import type {
  Action,
  DecisionKind,
  GameState,
  MapDef,
  Order,
  PendingDecision,
  RuntimeWeapon,
  WeaponRuleRef,
} from '@/engine/types'
import { activate, apply, arena, expectOk, patchOp, type Arena, type P } from './helpers'
import { flatMap } from './maps'

export function ranged(id: string, patch: Partial<RuntimeWeapon> = {}, rules: WeaponRuleRef[] = []): RuntimeWeapon {
  return { id, name: id, type: 'ranged', atk: 4, hit: 3, dmg: { normal: 3, crit: 4 }, rules, ...patch }
}

export function melee(id: string, patch: Partial<RuntimeWeapon> = {}, rules: WeaponRuleRef[] = []): RuntimeWeapon {
  return { id, name: id, type: 'melee', atk: 4, hit: 3, dmg: { normal: 4, crit: 5 }, rules, ...patch }
}

/** Register weapon definitions in the state's data snapshot (the snapshot is shared, so it is copied). */
export function withWeapons(state: GameState, ...defs: RuntimeWeapon[]): GameState {
  const s = cloneState(state)
  const weapons = { ...s.data.weapons }
  for (const d of defs) weapons[d.id] = d
  s.data = { ...s.data, weapons }
  return s
}

/** Replace the weapons an operative carries. */
export function arm(state: GameState, opId: string, weaponIds: string[]): GameState {
  return patchOp(state, opId, { weapons: [...weaponIds] })
}

export interface Staged {
  state: GameState
  m: string
  f: string
  e: string
  e2: string
  me: 'A' | 'B'
  foe: 'A' | 'B'
}

export interface StageSpec {
  map?: MapDef
  m: P
  f?: P
  e?: P
  e2?: P
  /** weapons (ranged and melee) for the active operative */
  mine?: RuntimeWeapon[]
  /** weapons for the first enemy */
  theirs?: RuntimeWeapon[]
  targetOrder?: Order
  mineOrder?: Order
  targetSave?: 2 | 3 | 4 | 5 | 6
  targetWounds?: number
  mineWounds?: number
  mineMaxWounds?: number
}

/**
 * A Firefight-phase state where the active operative has been activated (Engage unless said) and
 * waits at `firefight.action`; custom weapons and stats are applied.
 */
export function stage(spec: StageSpec): Staged {
  const a: Arena = arena(spec.map ?? flatMap(), { m: spec.m, ...(spec.f ? { f: spec.f } : {}), ...(spec.e ? { e: spec.e } : {}), ...(spec.e2 ? { e2: spec.e2 } : {}) })
  let s = a.state
  const all = [...(spec.mine ?? []), ...(spec.theirs ?? [])]
  if (all.length) s = withWeapons(s, ...all)
  if (spec.mine) s = arm(s, a.m, spec.mine.map((w) => w.id))
  if (spec.theirs) s = arm(s, a.e, spec.theirs.map((w) => w.id))
  const patch: Record<string, unknown> = { order: spec.targetOrder ?? 'engage' }
  if (spec.targetSave) patch.save = spec.targetSave
  if (spec.targetWounds !== undefined) patch.wounds = spec.targetWounds
  s = patchOp(s, a.e, patch)
  if (spec.mineWounds !== undefined) s = patchOp(s, a.m, { wounds: spec.mineWounds, ...(spec.mineMaxWounds ? { maxWounds: spec.mineMaxWounds } : {}) })
  s = activate(s, a.m, spec.mineOrder ?? 'engage')
  return { state: s, m: a.m, f: a.f, e: a.e, e2: a.e2, me: a.me, foe: a.foe }
}

type Answerer = (p: PendingDecision, s: GameState) => Action | null

export interface Played {
  state: GameState
  events: GameEvent[]
  /** decision kinds in the order they were raised after the first answer */
  kinds: string[]
}

export const DEFAULT_STOP: DecisionKind[] = ['firefight.action', 'firefight.activate', 'firefight.order']

/**
 * Answer decisions until one of `stop` kinds is pending. `answers` overrides the default answer by
 * decision kind; returning null falls back to the engine default. Pass `rng` for forced dice.
 */
export function play(
  state: GameState,
  rng: Rng | undefined,
  answers: Partial<Record<DecisionKind, Answerer>> = {},
  stop: DecisionKind[] = DEFAULT_STOP,
  max = 80,
): Played {
  let s = state
  const events: GameEvent[] = []
  const kinds: string[] = []
  for (let i = 0; i < max; i++) {
    const p = s.pending
    if (!p || stop.includes(p.kind)) break
    const custom = answers[p.kind]?.(p, s) ?? null
    const a = custom ?? answerDecision(s, p) ?? p.options?.[0]?.action ?? act.pass(p)
    const r = expectOk(step(s, a, rng))
    events.push(...r.events)
    s = r.state
    if (s.pending) kinds.push(s.pending.kind)
  }
  return { state: s, events, kinds }
}

/** Declare the Shoot action; returns the state at `shoot.weapon`. */
export function declareShoot(state: GameState): GameState {
  return apply(state, (p) => act.action(p, 'shoot')).state
}

export function declareFight(state: GameState): GameState {
  return apply(state, (p) => act.action(p, 'fight')).state
}

/** Pick an option by id from the pending decision. */
export function pick(p: PendingDecision, id: string): Action {
  const o = p.options?.find((x) => x.id === id)
  if (!o) throw new Error(`no option ${id} in ${p.kind}: ${p.options?.map((x) => x.id).join(', ')}`)
  return o.action
}

/** Drive a whole Shoot with forced dice from the firefight.action decision to the next one. */
export function shootWith(
  s: Staged,
  rng: Rng,
  weaponId: string,
  targetId: string,
  answers: Partial<Record<DecisionKind, Answerer>> = {},
): Played {
  let state = declareShoot(s.state)
  const events: GameEvent[] = []
  const first = (k: DecisionKind, id: string) => (p: PendingDecision): Action | null => (p.kind === k ? pick(p, id) : null)
  void first
  const r1 = expectOk(step(state, pick(state.pending!, weaponId), rng))
  events.push(...r1.events)
  state = r1.state
  const r2 = expectOk(step(state, pick(state.pending!, targetId), rng))
  events.push(...r2.events)
  state = r2.state
  const rest = play(state, rng, answers)
  return { state: rest.state, events: [...events, ...rest.events], kinds: rest.kinds }
}

export function evs<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)
}

/** Dice rolled by purpose, in order. */
export function rolled(events: GameEvent[], purpose: string): number[][] {
  return evs(events, 'DiceRolled')
    .filter((e) => e.purpose === purpose)
    .map((e) => e.dice)
}
