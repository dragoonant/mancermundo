// Shared reading of data conditions and scopes (docs/spec/20-data-schema.md section 5), team
// configuration (Chapter Tactics) and a few geometry questions the abilities, ploys and mission code
// all ask: keywords, control range, valid targets, distances to enemies.
import { bodyOf, targetVerdict, visible } from './los'
import { distanceBetween, enemiesInControlRange } from './measure'
import { activeOps, enemiesOf, getOp, otherSeat } from './state'
import type { Activation, Condition, Effect, GameState, Operative, RuntimeAbility, Seat, TargetSpec } from './types'
import { providerAny } from './team-rules'
import { keywordPicks } from './operative-picks'

/** Data action ids use kebab case, the engine camel case. */
export function normAction(id: string): string {
  switch (id) {
    case 'fall-back':
      return 'fallBack'
    default:
      return id
  }
}

export function hasKeyword(state: GameState, op: Operative, kw: string): boolean {
  if (state.data.datacards[op.datacardId]?.keywords.includes(kw)) return true
  // M9 batch B: keywords picked at selection (Marks of Chaos) are real keywords; M9 batch C: tag picks are not
  if (op.picks) for (const k of keywordPicks(state, op)) if (k === kw) return true
  return false
}

export function isExpendable(state: GameState, op: Operative): boolean {
  return state.data.datacards[op.datacardId]?.expendable === true
}

/** Ignored for the kill op (M-2.2): Expendable, or a team rule says so (team-rules.ts killOpIgnored). */
export function killOpIgnored(state: GameState, op: Operative): boolean {
  return isExpendable(state, op) || providerAny(state, op, 'killOpIgnored')
}

export function inScope(state: GameState, scope: TargetSpec | undefined, owner: Seat, op: Operative): boolean {
  if (!scope) return true
  if (scope.side === 'friendly' && op.seat !== owner) return false
  if (scope.side === 'enemy' && op.seat === owner) return false
  if (scope.keyword && !hasKeyword(state, op, scope.keyword)) return false
  for (const k of scope.notKeywords ?? []) if (hasKeyword(state, op, k)) return false
  return true
}

// ---------------------------------------------------------------------------
// Team configuration: Chapter Tactics
// ---------------------------------------------------------------------------

export const PRIMARY_TACTIC = 'primary-tactic'
export const SECONDARY_TACTIC = 'secondary-tactic'

/** The Chapter Tactic ability ids that apply to an operative (team picks, Adaptive Tactics, Chapter Veteran, Camo Cloak). */
export function activeTactics(state: GameState, op: Operative): string[] {
  const cfg = state.config[op.seat]
  const out: string[] = []
  const add = (id: string | undefined | null) => {
    if (id && !out.includes(id)) out.push(id)
  }
  add(cfg.choices[PRIMARY_TACTIC])
  add(cfg.adaptive ?? cfg.choices[SECONDARY_TACTIC])
  for (const t of op.extraTactics ?? []) add(t)
  // Camo Cloak always grants Stealthy (T-AOD.13)
  if (state.data.datacards[op.datacardId]?.abilities.includes('aod.a.camo-cloak')) add('aod.a.ct-stealthy')
  return out
}

export function hasTactic(state: GameState, op: Operative, tacticId: string): boolean {
  return activeTactics(state, op).includes(tacticId)
}

/** Does the operative have this datacard ability? */
export function hasAbility(state: GameState, op: Operative, abilityId: string): boolean {
  const card = state.data.datacards[op.datacardId]
  return !!card && (card.abilities.includes(abilityId) || card.uniqueActions.includes(abilityId))
}

// ---------------------------------------------------------------------------
// Geometry questions
// ---------------------------------------------------------------------------

export function inEnemyCr(state: GameState, op: Operative): boolean {
  return enemiesInControlRange(state, op, op.seat).length > 0
}

/** Smallest base-to-base distance from `op` to any enemy operative; Infinity when there is none. */
export function nearestEnemyDistance(state: GameState, op: Operative): number {
  let best = Infinity
  for (const e of enemiesOf(state, op)) best = Math.min(best, distanceBetween(bodyOf(op), bodyOf(e)))
  return best
}

/**
 * Can `shooter` select `target` (R-5.2)? Used for "not a valid target" questions: no shooter-side
 * operative in the target's control range, visible, and a Conceal target not in cover. Range is ignored.
 */
export function canBeTargetedBy(state: GameState, shooter: Operative, target: Operative): boolean {
  if (enemiesInControlRange(state, target, target.seat).length > 0) return false
  const v = targetVerdict(state, bodyOf(shooter), { ...bodyOf(target), order: target.order })
  if (!v.visible) return false
  if (target.order === 'conceal' && v.inCover) return false
  return true
}

export function isValidTargetOfAny(state: GameState, target: Operative): boolean {
  return enemiesOf(state, target).some((s) => canBeTargetedBy(state, s, target))
}

export function visibleTo(state: GameState, viewer: Operative, other: Operative): boolean {
  return visible(state, bodyOf(viewer), bodyOf(other))
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export interface CondCtx {
  state: GameState
  /** the seat that owns the rule */
  seat: Seat
  /** the operative the rule names (the one shot, the one fighting, the one activating) */
  subjectId?: string
  /** the operative performing the action in question; defaults to the subject */
  actorId?: string
  targetId?: string
  weaponId?: string
  activation?: Activation | null
  counteracting?: boolean
  /** the action being declared or resolved */
  action?: string
  attackFails?: number
  defenceFails?: number
  critRetained?: boolean
  survived?: boolean
}

function opOf(state: GameState, id: string | undefined): Operative | null {
  return id ? (state.operatives[id] ?? null) : null
}

function performedIn(cx: CondCtx): string[] {
  const act = cx.activation === undefined ? cx.state.firefight.activation : cx.activation
  // activation conditions only describe the operative whose activation it is
  const who = cx.actorId ?? cx.subjectId
  if (act && who && act.operativeId !== who) return []
  const list = [...(act?.performed ?? [])]
  if (act?.declared && !list.includes(act.declared.action)) list.push(act.declared.action)
  return list
}

/** Evaluate a data Condition; unknown or absent keys are true. */
export function evalCondition(c: Condition | undefined, cx: CondCtx): boolean {
  if (!c) return true
  const s = cx.state
  const subject = opOf(s, cx.subjectId)
  const actor = opOf(s, cx.actorId) ?? subject
  const target = opOf(s, cx.targetId)
  const weapon = cx.weaponId ? s.data.weapons[cx.weaponId] : undefined
  const act = cx.activation === undefined ? s.firefight.activation : cx.activation
  if (c.notInEnemyControlRange && actor && inEnemyCr(s, actor)) return false
  if (c.inEnemyControlRange && actor && !inEnemyCr(s, actor)) return false
  const counteracting = cx.counteracting ?? act?.counteract ?? false
  if (c.counteracting && !counteracting) return false
  if (c.notCounteracting && counteracting) return false
  if (c.order && actor && actor.order !== c.order) return false
  if (c.action && cx.action && normAction(c.action) !== normAction(cx.action)) return false
  if (c.activationIncludes) {
    const p = performedIn(cx)
    if (!c.activationIncludes.every((a) => p.includes(normAction(a)))) return false
  }
  if (c.activationExcludes) {
    const p = performedIn(cx)
    if (c.activationExcludes.some((a) => p.includes(normAction(a)))) return false
  }
  if (c.actionPerformed && !performedIn(cx).includes(c.actionPerformed)) return false
  if (c.weaponType && weapon && weapon.type !== c.weaponType) return false
  if (c.weaponNameContains && weapon && !weapon.name.toLowerCase().includes(c.weaponNameContains.toLowerCase())) return false
  if (c.weaponHasRule && weapon) {
    const key = c.weaponHasRule.replace(/^.*\.wr\./, '').replace(/^.*\.wr-/, '')
    if (!weapon.rules.some((r) => r.rule === key)) return false
  }
  if (c.targetKeyword && target && !hasKeyword(s, target, c.targetKeyword)) return false
  if (c.targetNotKeyword && target && hasKeyword(s, target, c.targetNotKeyword)) return false
  if (c.targetOrder && target && target.order !== c.targetOrder) return false
  if (c.targetDistanceMoreThan !== undefined && actor && target && !(distanceBetween(bodyOf(actor), bodyOf(target)) > c.targetDistanceMoreThan)) return false
  if (c.targetDistanceWithin !== undefined && actor && target && !(distanceBetween(bodyOf(actor), bodyOf(target)) <= c.targetDistanceWithin)) return false
  if (c.attackFailsAtLeast !== undefined && (cx.attackFails ?? 0) < c.attackFailsAtLeast) return false
  if (c.defenceFailsAtLeast !== undefined && (cx.defenceFails ?? 0) < c.defenceFailsAtLeast) return false
  if (c.critRetained !== undefined && (cx.critRetained ?? false) !== c.critRetained) return false
  if (c.turningPoint) {
    if (c.turningPoint.min !== undefined && s.turningPoint < c.turningPoint.min) return false
    if (c.turningPoint.max !== undefined && s.turningPoint > c.turningPoint.max) return false
  }
  if (c.firstShootOfBattle && actor && actor.oncePerBattleUsed.includes('shot')) return false
  if (c.survived !== undefined && (cx.survived ?? true) !== c.survived) return false
  if (c.inKillzone && subject && subject.status !== 'active') return false
  if (c.subjectKeyword && subject && !hasKeyword(s, subject, c.subjectKeyword)) return false
  if (c.subjectNotKeyword && subject && hasKeyword(s, subject, c.subjectNotKeyword)) return false
  if (c.subjectOrder && subject && subject.order !== c.subjectOrder) return false
  if (c.subjectNotValidTarget && subject && isValidTargetOfAny(s, subject)) return false
  if (c.subjectMoreThanFromEveryEnemy !== undefined && subject && !(nearestEnemyDistance(s, subject) > c.subjectMoreThanFromEveryEnemy)) return false
  if (c.ployUsedThisTurningPoint && !s.ledger[cx.seat].tp.includes(c.ployUsedThisTurningPoint)) return false
  if (c.ployNotUsedThisTurningPoint && s.ledger[cx.seat].tp.includes(c.ployNotUsedThisTurningPoint)) return false
  if (c.allOf && !c.allOf.every((x) => evalCondition(x, cx))) return false
  if (c.anyOf && !c.anyOf.some((x) => evalCondition(x, cx))) return false
  if (c.not && evalCondition(c.not, cx)) return false
  return true
}

/** The captain-style helper: is some friendly operative with this keyword in the killzone (optionally out of enemy CR)? */
export function friendlyWithKeyword(state: GameState, seat: Seat, keyword: string, notInEnemyCr = false): Operative | null {
  for (const o of activeOps(state)) {
    if (o.seat !== seat || !hasKeyword(state, o, keyword)) continue
    if (notInEnemyCr && inEnemyCr(state, o)) continue
    return o
  }
  return null
}

export { getOp, otherSeat }

// ---------------------------------------------------------------------------
// Reading abilities
// ---------------------------------------------------------------------------

export function effectList(e: unknown): Effect[] {
  if (!e) return []
  return (Array.isArray(e) ? e : [e]) as Effect[]
}

export function abilityDef(state: GameState, id: string): RuntimeAbility | undefined {
  return state.data.abilities[id]
}

/** The first code name in an ability's effect. */
export function codeOf(def: RuntimeAbility): string | undefined {
  for (const e of effectList(def.effect)) if (e.code) return e.code
  return undefined
}

export function paramsOf(def: RuntimeAbility, code: string): Record<string, unknown> {
  for (const e of effectList(def.effect)) if (e.code === code) return e.params ?? {}
  return {}
}

/** Datacard abilities and unique actions, the team's faction rules that cover the operative, and active tactics. */
export function rulesOf(state: GameState, op: Operative): RuntimeAbility[] {
  const out: RuntimeAbility[] = []
  const card = state.data.datacards[op.datacardId]
  const add = (id: string) => {
    const d = state.data.abilities[id]
    if (d && !out.includes(d)) out.push(d)
  }
  for (const id of card?.abilities ?? []) add(id)
  for (const id of card?.uniqueActions ?? []) add(id)
  const team = state.data.teams[state.players[op.seat].teamId]
  for (const id of team?.factionRules ?? []) {
    const d = state.data.abilities[id]
    if (d && inScope(state, d.scope, op.seat, op)) add(id)
  }
  for (const id of activeTactics(state, op)) add(id)
  return out
}

/** Params of the first ability of the operative that carries this code hook, or null. */
export function codeParams(state: GameState, op: Operative, code: string): Record<string, unknown> | null {
  for (const d of rulesOf(state, op)) {
    for (const e of effectList(d.effect)) if (e.code === code) return e.params ?? {}
  }
  return null
}

