// FF: firefight.* (R-3, R-4). Activation alternation, orders, the AP ledger, action restrictions,
// counteract, expended, and the turning point end. Shoot/Fight/Guard interrupts arrive in M2b.
import { enemiesInControlRange } from './measure'
import { expireAplEffects, heavyBlocksMove, MOVE_ACTIONS, ruleKey } from './attack-common'
import { beginFight, fightAvailability } from './fight'
import { beginShoot, shootAvailability } from './shoot'
import { beginTurningPoint, TURNING_POINTS } from './strategy'
import { moveConstraints, moveLimit, type MoveKind } from './movement'
import { reject, type Ctx, type Handled, type ModuleDef, type OptionInput } from './registry'
import { effectiveApl, getOp, otherSeat, readyOps, seatOps } from './state'
import type {
  Action,
  Activation,
  GameState,
  Operative,
  PendingDecision,
  Rejection,
  Seat,
} from './types'
// M2b-game
import {
  ABILITY_PREFIX,
  actionCostDelta,
  actionForbidden,
  allowedOrders,
  abilityOffers,
  canCounteractWithOrder,
  chargeFromControlRange,
  chargeUnderConceal,
  consumeDiscounts,
  findOffer,
  maxRepeats,
  performOffer,
  type AbilityOffer,
} from './abilities'
import { smokeActivation, smokeTurningPointEnd } from './core-hooks'
import { applyDeferredApl, expireEffects, removeEffects } from './effects'
import { providerActivationBarred, providerAny, providerCanActivate, providerChain, providerCostDelta, providerCounteractAlternatives, providerGate, providerOwnReactions, providerReactions, type ReactionOffer } from './team-rules'
import { getFrameResume, registerFrameResume, runHook, type ActionDeclaredData } from './hooks'
import { tokensOnActivationEnd, tokensOnActivationStart, tokensOnTurningPointEnd } from './tokens'
import { PICK_UP, PLACE } from './markers'
import { scoreBattleEnd, scoreTurningPointEnd } from './missions'
import { openPloyWindow } from './ploys'
import { handleInterrupt, offerInterrupt } from './guard'
import { getCodeHook, type PloyWindowInfo } from './code-hooks'
import type { Order, TimingWindowId } from './types'

export interface ActionDef {
  cost: number
  move?: MoveKind
  /** false until M2b: never offered, reported as E_TODO if chosen */
  implemented: boolean
}

export const ACTIONS: Record<string, ActionDef> = {
  reposition: { cost: 1, move: 'reposition', implemented: true },
  dash: { cost: 1, move: 'dash', implemented: true },
  fallBack: { cost: 2, move: 'fallBack', implemented: true },
  charge: { cost: 1, move: 'charge', implemented: true },
  guard: { cost: 1, implemented: true },
  shoot: { cost: 1, implemented: true },
  fight: { cost: 1, implemented: true },
}

export const ACTION_ORDER = ['reposition', 'dash', 'fallBack', 'charge', 'guard', 'shoot', 'fight']

/** Action cost after modifiers (Mobile makes Fall Back cost 1 less); never below 0 (R-3.6). */
export function actionCost(state: GameState, op: Operative, actionId: string, act: Activation | null = null): number {
  const base = ACTIONS[actionId]?.cost ?? 0
  return Math.max(0, base + actionCostDelta(state, op, actionId, act) + providerCostDelta(state, op, actionId))
}

function hasExplosive(state: GameState, op: Operative): boolean {
  return op.weapons.some((w) => state.data.weapons[w]?.rules.some((r) => r.rule === 'explosive'))
}

function hasSilentRanged(state: GameState, op: Operative): boolean {
  return op.weapons.some((w) => {
    const def = state.data.weapons[w]
    return def?.type === 'ranged' && def.rules.some((r) => ruleKey(r.rule) === 'silent')
  })
}

/**
 * Rules check for starting an action (order, conditions, restrictions, AP). Does not look at
 * whether the action is implemented yet. `activation` may be null for pure rules queries.
 */
export function actionAvailability(
  state: GameState,
  op: Operative,
  actionId: string,
  activation: Activation | null,
): Rejection | null {
  const def = ACTIONS[actionId]
  if (!def) return { code: 'E_NOT_AN_OPTION', reason: `unknown action ${actionId}` }
  const counteract = activation?.counteract ?? false
  const performed = activation?.performed ?? []
  const restricted = (reason: string): Rejection => ({ code: 'E_ACTION_RESTRICTED', reason })
  // M9 prep: an operative out of the killzone (HIDING) takes only the unique actions its team offers
  if (op.status !== 'active') return restricted(`${op.name} is not in the killzone`)
  const cost = actionCost(state, op, actionId, activation)

  const forbidden = actionForbidden(state, op, actionId)
  if (forbidden) return restricted(forbidden)
  // M9 batch B: an action.declared rule cancelled this action and barred it for the rest of the activation
  if (activation?.barred?.includes(actionId)) return restricted(`${actionId} was stopped and cannot be tried again this activation`)
  if (!counteract && performed.filter((p) => p === actionId).length >= maxRepeats(state, op, actionId, performed)) {
    return restricted(`${actionId} cannot be performed twice in one activation`)
  }
  // Wrath of Vengeance: the two counteraction actions must differ (T-AOD ploy table)
  if (counteract && activation?.used?.includes('wrath') && performed.includes(actionId)) {
    return restricted('the two actions of Wrath of Vengeance must differ')
  }
  const inEnemyCr = enemiesInControlRange(state, op, op.seat).length > 0
  switch (actionId) {
    case 'reposition':
      if (inEnemyCr) return restricted('cannot Reposition while in an enemy control range')
      if (performed.includes('fallBack') || performed.includes('charge')) {
        return restricted('Reposition is barred after Fall Back or Charge')
      }
      break
    case 'dash':
      if (inEnemyCr) return restricted('cannot Dash while in an enemy control range')
      if (performed.includes('charge')) return restricted('Dash is barred after Charge')
      break
    case 'fallBack':
      if (!inEnemyCr) return restricted('Fall Back needs an enemy in control range')
      if (performed.includes('reposition') || performed.includes('charge')) {
        return restricted('Fall Back is barred after Reposition or Charge')
      }
      break
    case 'charge':
      if (op.order === 'conceal' && !chargeUnderConceal(state, op)) return restricted('a Conceal operative cannot Charge')
      if (inEnemyCr && !chargeFromControlRange(state, op)) return restricted('cannot Charge while in an enemy control range')
      if (performed.includes('reposition') || performed.includes('dash') || performed.includes('fallBack')) {
        return restricted('Charge is barred after Reposition, Dash or Fall Back')
      }
      break
    case 'guard':
      if (op.order === 'conceal' && !providerAny(state, op, 'guardUnderConceal')) return restricted('a Conceal operative cannot go on Guard')
      if (inEnemyCr) return restricted('cannot go on Guard while in an enemy control range')
      break
    case 'shoot':
      if (op.order === 'conceal' && !hasSilentRanged(state, op) && !providerAny(state, op, 'shootUnderConceal')) {
        return restricted('a Conceal operative cannot Shoot except with a Silent weapon')
      }
      // the Bomb Squig's Explosive rule lets it Shoot in an enemy control range (T-KOM 2.3)
      if (inEnemyCr && !hasExplosive(state, op) && !providerAny(state, op, 'shootInControlRange')) return restricted('cannot Shoot while in an enemy control range')
      break
    case 'fight':
      if (!inEnemyCr) return restricted('Fight needs an enemy in control range')
      break
  }
  if (counteract) {
    if (actionId === 'guard') return restricted('a counteraction cannot be Guard')
    if (cost !== 1) return restricted('a counteraction must cost exactly 1 AP')
  } else if (activation && activation.apSpent + cost > effectiveApl(op)) {
    return { code: 'E_NO_AP', reason: `${actionId} needs ${cost} AP but only ${Math.max(0, effectiveApl(op) - activation.apSpent)} remain` }
  }
  // M2b-attack: Heavy bars moving after the weapon was used (R-10.9)
  if (MOVE_ACTIONS.includes(actionId)) {
    const why = heavyBlocksMove(state, activation?.weaponsUsed, actionId)
    if (why) return restricted(why)
  }
  // the expensive checks last: some weapon needs a valid target / a melee weapon
  if (actionId === 'shoot') return shootAvailability(state, op, activation)
  if (actionId === 'fight') return fightAvailability(state, op, activation)
  return null
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export function startFirefight(ctx: Ctx): void {
  const s = ctx.state
  s.phase = 'firefight'
  ctx.emit({ type: 'PhaseStarted', name: 'firefight' }, null)
  s.firefight = { turn: s.initiative!, activation: null }
  // M9 shared: a ploy window as the phase begins (initiative seat first); strategy or firefight ploys may name it
  if (openFirefightWindow(ctx, 'firefight.start', {}, 'firefightStart')) return
  advance(ctx)
}

/** Opponent-has-ready counteract candidates for `seat`: expended, Engage, not yet counteracted this TP. */
export function counteractCandidates(state: GameState, seat: Seat): Operative[] {
  return seatOps(state, seat).filter((o) => !o.ready && canCounteractWithOrder(state, o) && !o.flags.counteractedThisTP)
}

/**
 * M9 batch C: the seat's ready operatives that may be activated at all (a team rule may bar one: C.A.T. Unit). A barred
 * operative stays ready but does not keep the turning point going and counts as expended for counteracting.
 */
export function activatableOps(state: GameState, seat: Seat): Operative[] {
  return readyOps(state, seat).filter((o) => !providerActivationBarred(state, o))
}

function advance(ctx: Ctx): void {
  const s = ctx.state
  // M9 prep: a chained activation is owed (Group Activation): the same seat activates one of those next
  const chain = s.firefight.chain
  if (chain) {
    let owed = activatableOps(s, chain.seat).filter((o) => chain.ids.includes(o.id))
    // M9 batch B: an owed operative a rule blocks (System Jam) is skipped while an unblocked ready one exists
    const unblocked = owed.filter((o) => providerCanActivate(s, o))
    if (unblocked.length > 0) owed = unblocked
    else if (activatableOps(s, chain.seat).some((o) => providerCanActivate(s, o))) owed = []
    if (owed.length > 0) {
      s.firefight.turn = chain.seat
      raiseActivate(ctx, chain.seat, owed, [])
      return
    }
    s.firefight.chain = null
  }
  for (let i = 0; i < 4; i++) {
    const seat = s.firefight.turn
    const gated = s.firefight.gated ?? []
    const all = activatableOps(s, seat)
    // operatives a rule stopped from activating this time (Vision of Madness), unless nothing else is ready
    let mine = all.filter((o) => !gated.includes(o.id)).length > 0 ? all.filter((o) => !gated.includes(o.id)) : all
    // M9 batch B: operatives a rule blocks while another is ready (System Jam); never all of them
    const free = mine.filter((o) => providerCanActivate(s, o))
    if (free.length > 0) mine = free
    const theirs = activatableOps(s, otherSeat(seat))
    if (mine.length === 0 && theirs.length === 0) {
      endTurningPoint(ctx)
      return
    }
    if (mine.length > 0) {
      // M9 batch B: a ploy window for the seat before it picks (Heinous Arrogance may pass the activation)
      if (s.firefight.beforeActivationFor !== seat && openPloyWindow(ctx, 'firefight.beforeActivation', { window: 'firefight.beforeActivation', seat }, [seat], 'beforeActivation')) {
        s.firefight.beforeActivationFor = seat
        return
      }
      if (s.firefight.skipping === seat) {
        s.firefight.skipping = null
        s.firefight.beforeActivationFor = null
        s.firefight.turn = otherSeat(seat)
        continue
      }
      raiseActivate(ctx, seat, mine, [])
      return
    }
    const eligible = counteractCandidates(s, seat)
    // M9 batch C: things a team may do instead of counteracting (Farstalker: change one operative's order)
    const alternatives = providerCounteractAlternatives(s, seat)
    if (eligible.length > 0 || alternatives.length > 0) {
      raiseActivate(ctx, seat, [], eligible, alternatives)
      return
    }
    s.firefight.turn = otherSeat(seat)
  }
}

function raiseActivate(ctx: Ctx, seat: Seat, ready: Operative[], counter: Operative[], alternatives: ReactionOffer[] = []): void {
  const options: OptionInput[] = [
    ...ready.map((o) => ({
      id: o.id,
      labelKey: 'firefight.activate',
      type: 'firefight.activate' as const,
      payload: { operativeId: o.id },
    })),
    ...counter.map((o) => ({
      id: `counteract:${o.id}`,
      labelKey: 'firefight.counteract',
      type: 'firefight.activate' as const,
      payload: { operativeId: o.id, counteract: true },
    })),
    ...alternatives.map((r, i) => ({
      id: `alt:${i}`,
      labelKey: r.labelKey,
      type: 'firefight.activate' as const,
      payload: { operativeId: r.operativeId, alternative: i },
      data: { hook: r.hook, option: r.option, ...(r.data ?? {}) },
    })),
  ]
  ctx.raise({
    kind: 'firefight.activate',
    seat,
    window: 'firefight.activationEnded',
    context: { ready: ready.map((o) => o.id), counteract: counter.map((o) => o.id), ...(alternatives.length > 0 ? { alternatives: alternatives.length } : {}) },
    options,
    // R-3.2: a player with a ready operative must activate it; otherwise they may skip.
    canPass: ready.length === 0,
  })
}

const PAYLOAD_KEYS = ['markerId', 'targetId', 'param', 'x', 'z'] as const

/** An ability or marker offer as a firefight.action option; its payload carries only the target fields. */
function abilityOption(offer: AbilityOffer): OptionInput {
  const payload: Record<string, unknown> = { action: offer.action }
  for (const k of PAYLOAD_KEYS) if (offer.params[k] !== undefined) payload[k] = offer.params[k]
  return {
    id: offer.id,
    labelKey: offer.labelKey,
    type: 'firefight.action',
    payload,
    data: { cost: offer.cost, abilityId: offer.abilityId, ...(offer.data ?? {}) },
  }
}

export function raiseAction(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const op = getOp(s, act.operativeId)
  const options: OptionInput[] = []
  const delegated = act.frame?.data?.delegated as DelegatedRules | undefined
  // M9 shared: a rule ended this activation early; it ends now that the action is done
  if (act.endsAfterAction && !act.frame && !act.counteract) {
    endActivation(ctx)
    return
  }
  for (const id of ACTION_ORDER) {
    const def = ACTIONS[id]!
    if (!def.implemented) continue
    if (actionAvailability(s, op, id, act)) continue
    if (delegated && !delegatedAllows(delegated, id, actionCost(s, op, id, act), false)) continue
    options.push({
      id,
      labelKey: `action.${id}`,
      type: 'firefight.action',
      payload: { action: id },
      data: { cost: actionCost(s, op, id, act) },
    })
  }
  // unique, mission, equipment and marker actions (M2b-game)
  for (const offer of abilityOffers(s, op, act)) {
    const mission = (s.data.abilities[offer.abilityId]?.keywords ?? []).includes('MISSION')
    if (delegated && !delegatedAllows(delegated, offer.action, offer.cost, mission)) continue
    if (act.barred?.includes(offer.action)) continue
    options.push(abilityOption(offer))
  }
  if (options.length === 0) {
    // Nothing left to do: the activation (or counteraction, or delegated free action) ends by itself.
    if (act.frame) closeFrame(ctx, 'cancelled')
    else if (act.counteract) endCounteract(ctx)
    else endActivation(ctx)
    return
  }
  // M9 batch B: a joint activation lets the player switch to the other operative at any point between actions
  if (act.partner && !act.frame && !act.counteract) {
    options.push({
      id: 'switch',
      labelKey: 'action.switchOperative',
      type: 'firefight.action',
      payload: { action: 'switch' },
      data: { operativeId: act.partner.operativeId },
    })
  }
  options.push({
    id: 'end',
    labelKey: act.counteract ? 'action.declineCounteract' : 'action.end',
    type: 'firefight.action',
    payload: { action: 'end' },
  })
  ctx.raise({
    kind: 'firefight.action',
    seat: act.seat,
    window: 'firefight.actionEnded',
    context: {
      operativeId: op.id,
      counteract: act.counteract,
      apl: effectiveApl(op),
      apSpent: act.apSpent,
      apRemaining: act.counteract ? 1 : Math.max(0, effectiveApl(op) - act.apSpent),
      performed: [...act.performed],
    },
    options,
  })
}

function clearGuard(ctx: Ctx, op: Operative, reason: string): void {
  if (!op.flags.guard) return
  op.flags.guard = false
  ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason }, op.seat)
}

function endActivation(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const op = getOp(s, act.operativeId)
  op.ready = false
  // M9 shared: the owner's end-of-activation ploy window (Slink Into Darkness style), while the operative is still
  // in its activation: "until the end of its activation" effects still apply and the activation.end hooks see
  // what a ploy did. Only offered while the operative is in the killzone; resumes in finishEndActivation.
  if (op.status === 'active' && !s.window && openFirefightWindow(ctx, 'firefight.activationEnded', { subjectId: op.id, counteracting: false }, 'activationEnded')) return
  finishEndActivation(ctx)
}

function finishEndActivation(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const op = getOp(s, act.operativeId)
  // M9 prep: "at the end of its activation" team rules, then holder-activation tokens
  runHook('activation.end', { seat: op.seat, state: s, engine: ctx, operativeId: op.id, data: { counteract: false } })
  tokensOnActivationEnd(ctx, op.id)
  // M2b-attack: timed APL effects (Stun) end with the operative's activation; a point-blank restriction too
  expireAplEffects(ctx, op.id)
  // M9 batch B: one half of a joint activation ended: the other operative carries on (activation-wide expiry waits)
  const partner = act.partner
  if (partner) {
    smokeActivation(ctx)
    ctx.emit({ type: 'OperativeExpended', operativeId: op.id }, op.seat)
    delete partner.partner
    s.firefight.activation = partner
    const p = s.operatives[partner.operativeId]
    if (!p || p.status !== 'active') {
      if (p && p.status !== 'removed') p.ready = false
      endActivation(ctx)
      return
    }
    raiseAction(ctx)
    return
  }
  for (const o of Object.values(s.operatives)) delete o.flags.cannotRetaliate
  expireEffects(ctx, 'activation')
  smokeActivation(ctx)
  ctx.emit({ type: 'OperativeExpended', operativeId: op.id }, op.seat)
  s.firefight.activation = null
  s.firefight.turn = otherSeat(act.seat)
  s.firefight.gated = []
  // M9 prep: Group Activation and the like owe the same seat another activation
  const owed = providerChain(s, op, act.chained === true).filter((id) => id !== op.id && readyOps(s, op.seat).some((o) => o.id === id))
  if (owed.length > 0) {
    s.firefight.chain = { seat: op.seat, ids: owed, from: op.id }
    ctx.emit({ type: 'ActivationChained', fromId: op.id, operativeIds: owed }, op.seat)
  }
  // M9 batch B: the other seat may react now that the activation is over (the Butcher's free Charge)
  if (offerEndReaction(ctx, op, false)) return
  advance(ctx)
}

function endCounteract(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  // M10 batch D shared: "at the end of its counteraction" team rules (Fellgor frenzied counteract, Lacerate)
  const actor = s.operatives[act.operativeId]
  if (actor) runHook('counteraction.end', { seat: actor.seat, state: s, engine: ctx, operativeId: actor.id, data: { performed: act.performed.slice(), removed: actor.status === 'removed' } })
  for (const o of Object.values(s.operatives)) delete o.flags.cannotRetaliate
  expireEffects(ctx, 'activation')
  s.firefight.activation = null
  s.firefight.turn = otherSeat(act.seat)
  const op = s.operatives[act.operativeId]
  if (op && offerEndReaction(ctx, op, true)) return
  advance(ctx)
}

/**
 * M9 batch B: reaction point at the end of an activation or counteraction (team-rules `reactions` with
 * `activationEnded`), offered to the other seat after the end-of-activation window, hooks and expiry, before the
 * next activation is chosen. reactionDone then advances. True when a decision was raised.
 */
function offerEndReaction(ctx: Ctx, actor: Operative, counteract: boolean): boolean {
  const s = ctx.state
  if (s.phase !== 'firefight' || s.firefight.activation || s.firefight.reactionAtEnd) return false
  const seat = otherSeat(actor.seat)
  const offers = providerReactions(s, seat, { actorId: actor.id, action: 'activationEnded', activeSeat: actor.seat, moved: false, activationEnded: true, counteract })
  if (offers.length === 0) return false
  s.firefight.reactionAtEnd = true
  raiseReaction(ctx, seat, actor.id, 'activationEnded', offers, 'firefight.activationEnded')
  return true
}

/**
 * M9 batch B: run the action.declared hooks for the action just declared in the current activation or frame. True
 * when a handler cancelled it (cancelAction has run: no AP spent; with `bar` it cannot be tried again this activation).
 */
function declaredVeto(ctx: Ctx, op: Operative, actionId: string, free: boolean): boolean {
  const s = ctx.state
  const a = s.firefight.activation!
  const activeSeat = (a.frame ? (s.firefight.stack ?? []).at(-1)?.seat : undefined) ?? a.seat
  const data: ActionDeclaredData = { action: actionId, counteract: a.counteract, free, activeSeat, cancel: false, bar: false }
  runHook('action.declared', { seat: op.seat, state: s, engine: ctx, operativeId: op.id, action: actionId, data: data as unknown as Record<string, unknown> })
  if (!data.cancel) return false
  if (data.bar) {
    // bar it on the activation (and on the operative's own activation under a free-action frame)
    a.barred = [...new Set([...(a.barred ?? []), actionId])]
    const under = (s.firefight.stack ?? []).at(-1)
    if (a.frame && under && under.operativeId === op.id) under.barred = [...new Set([...(under.barred ?? []), actionId])]
  }
  cancelAction(ctx)
  return true
}

/** M9 batch B: after the active player's own declaration window, the opponent's (Scrapcode Overload), then the action runs. */
function declaredOpponentWindow(ctx: Ctx): void {
  const s = ctx.state
  const a = s.firefight.activation!
  const decl = a.declared!
  if (openFirefightWindow(ctx, 'firefight.opponentActionDeclared', { actorId: a.operativeId, counteracting: a.counteract, action: decl.action }, 'declared.opponent')) return
  dispatchDeclared(ctx)
}

/** Called by the movement module (or any action module) once the declared action completed. */
export function finishAction(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const op = getOp(s, act.operativeId)
  const decl = act.declared!
  const free = decl.free === true || act.frame !== undefined
  if (!act.counteract && !free) {
    const total = decl.cost + (act.surcharge ?? 0)
    act.apSpent += total
    ctx.emit({ type: 'ApSpent', operativeId: op.id, amount: total, total: act.apSpent }, op.seat)
  }
  delete act.surcharge
  act.performed.push(decl.action)
  // an action "treated as" another counts as it for every restriction (Grappling Hook as Reposition, R-4.13)
  const treated = decl.params?.treatedAs
  if (typeof treated === 'string' && !act.performed.includes(treated)) act.performed.push(treated)
  // M9 prep: per-TP action history (Interstitial Command) and the after-action team hook (Tesla Weave, decay)
  op.actionsThisTp = [...(op.actionsThisTp ?? []), decl.action, ...(typeof treated === 'string' ? [treated] : [])]
  const activeSeat = (act.frame ? (s.firefight.stack ?? []).at(-1)?.seat : undefined) ?? act.seat
  runHook('action.ended', { seat: op.seat, state: s, engine: ctx, operativeId: op.id, data: { action: decl.action, counteract: act.counteract, free, activeSeat } })
  if (decl.action !== 'guard') clearGuard(ctx, op, 'action')
  ctx.emit({ type: 'ActionResolved', operativeId: op.id, action: decl.action }, op.seat)
  act.declared = null
  expireEffects(ctx, 'action')
  if (op.status === 'removed') {
    // the active operative was incapacitated and removed by its own action (Hot, a fight): the activation is over
    if (act.frame) closeFrame(ctx, 'finished')
    else afterActiveOperativeRemoved(ctx)
    return
  }
  if (act.frame) {
    closeFrame(ctx, 'finished')
    return
  }
  afterActionStages(ctx, 'ploys')
}

// ---------------------------------------------------------------------------
// After an action: ploy window, Guard interrupt, then the activation goes on (M2b-game)
// ---------------------------------------------------------------------------

/** Open a firefight ploy window for the seat on turn first, then the opponent. True when a decision was raised. */
export function openFirefightWindow(ctx: Ctx, window: TimingWindowId, info: Omit<PloyWindowInfo, 'window'>, resume: string): boolean {
  const s = ctx.state
  const first = s.firefight.activation?.seat ?? s.initiative ?? 'A'
  return openPloyWindow(ctx, window, { window, ...info }, [first, otherSeat(first)], resume)
}

export function afterActionStages(ctx: Ctx, stage: 'ploys' | 'reactions' | 'guard' | 'continue'): void {
  const s = ctx.state
  const act = s.firefight.activation
  if (!act) return
  if (stage === 'ploys') {
    const op = s.operatives[act.operativeId]
    if (op && op.status === 'active') {
      const last = act.performed[act.performed.length - 1]
      const info = { subjectId: op.id, counteracting: act.counteract, ...(last ? { action: last } : {}) }
      if (openFirefightWindow(ctx, 'firefight.actionEnded', info, 'actionEnded.reactions')) return
    }
    stage = 'reactions'
  }
  if (stage === 'reactions') {
    if (offerReactions(ctx)) return
    stage = 'guard'
  }
  if (stage === 'guard') {
    if (offerInterrupt(ctx)) return
  }
  continueActivation(ctx)
}

/** The activation goes on after an action (and any interrupt) has fully finished. */
export function continueActivation(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation
  if (!act) return
  const op = s.operatives[act.operativeId]
  if (!op || op.status === 'removed') {
    afterActiveOperativeRemoved(ctx)
    return
  }
  if (act.counteract) {
    if ((act.bonus ?? 0) > 0) {
      act.bonus = (act.bonus ?? 0) - 1
      raiseAction(ctx)
    } else endCounteract(ctx)
  } else raiseAction(ctx)
}

/** A ploy window opened by firefight.ts has been exhausted: carry on from where it stopped. */
export function firefightResume(ctx: Ctx, token: string): void {
  switch (token) {
    case 'activationStart':
      raiseAction(ctx)
      return
    case 'declared':
      if (ctx.state.firefight.activation?.declared) declaredOpponentWindow(ctx)
      return
    case 'declared.opponent':
      if (ctx.state.firefight.activation?.declared) dispatchDeclared(ctx)
      return
    case 'fallBack.moved':
    case 'charge.moved':
      if (ctx.state.firefight.activation?.declared) finishAction(ctx)
      return
    case 'actionEnded.guard':
      afterActionStages(ctx, 'guard')
      return
    case 'actionEnded.reactions':
      afterActionStages(ctx, 'reactions')
      return
    case 'turningPointEnd':
      finishTurningPoint(ctx)
      return
    case 'firefightStart':
      advance(ctx)
      return
    case 'beforeActivation':
      advance(ctx)
      return
    case 'activationEnded':
      if (ctx.state.firefight.activation) finishEndActivation(ctx)
      return
    default:
      throw new Error(`unknown firefight resume token ${token}`)
  }
}

// ---------------------------------------------------------------------------
// Frames: a free action (Guard interrupt, free Dash, Krump 'Em!) runs as a temporary activation
// ---------------------------------------------------------------------------

export interface FreeActionOpts {
  operativeId: string
  /** M9 prep: 'charge' and 'fallBack' as well (Expert Swordsman, Creeping Shadow, Divert and Disappear) */
  action: 'dash' | 'reposition' | 'shoot' | 'fight' | 'charge' | 'fallBack'
  /** M9 prep: cap on the move's distance (3" free Charges, 2" delegated moves); Charge then gets no +2" beyond it */
  maxMove?: number
  /**
   * M9 prep: the move must end in this operative's control range: an enemy for a Charge (Assassinate,
   * Quicksilver Strike), a friendly for other moves (Medic!'s free Dash into the medic's control range)
   */
  endWithinCrOf?: string
  /** name of the FrameResume registered with hooks.registerFrameResume */
  resume: string
  data?: Record<string, unknown>
  interrupt?: boolean
  pointBlank?: boolean
  /** only weapons whose name contains this (Dakka Dash needs a dakka shoota) */
  weaponNameContains?: string
  /**
   * M10 batch D shared (opt-in, R-3.9): inside the operative's own activation or counteraction the free action keeps
   * the activation's action restrictions (no second Dash, no Dash after Charge, barred actions) and, once finished,
   * counts as performed there. Off by default because most team free actions say "even if" or count it themselves
   * (Vitalised Surge, Dynamic, Absolution Through Destruction, Uncompromising Attack); Goremongers Surge sets it.
   */
  checkPerformed?: boolean
  /** M10 batch D shared: never apply the performed checks, even with `checkPerformed` (a rule that says "even if") */
  ignorePerformed?: boolean
}

/**
 * M10 batch D shared: the operative's own activation (or counteraction) that a free action would run inside, or null
 * when it is not activated (a free action outside its activation, R-3.9). Frames above it do not count.
 */
export function ownActivationOf(state: GameState, op: Operative): Activation | null {
  const chain = [state.firefight.activation, ...[...(state.firefight.stack ?? [])].reverse()]
  for (const a of chain) {
    if (!a || a.frame) continue
    if (a.operativeId === op.id) return a
    if (a.partner?.operativeId === op.id) return a.partner
    return null
  }
  return null
}

/** M10 batch D shared: R-3.7 and the move bars of R-4 for a free action inside the operative's own activation. */
function performedProblem(state: GameState, op: Operative, action: string, own: Activation): string | null {
  const performed = own.performed
  if (!own.counteract && performed.filter((p) => p === action).length >= maxRepeats(state, op, action, performed)) {
    return `${action} cannot be performed twice in one activation`
  }
  const any = (...ids: string[]): boolean => ids.some((id) => performed.includes(id))
  switch (action) {
    case 'reposition':
      return any('fallBack', 'charge') ? 'Reposition is barred after Fall Back or Charge' : null
    case 'dash':
      return any('charge') ? 'Dash is barred after Charge' : null
    case 'fallBack':
      return any('reposition', 'charge') ? 'Fall Back is barred after Reposition or Charge' : null
    case 'charge':
      return any('reposition', 'dash', 'fallBack') ? 'Charge is barred after Reposition, Dash or Fall Back' : null
  }
  return null
}

function freeActionProblem(state: GameState, op: Operative, o: FreeActionOpts): Rejection | null {
  const inCr = enemiesInControlRange(state, op, op.seat).length > 0
  const bad = (reason: string): Rejection => ({ code: 'E_ACTION_RESTRICTED', reason })
  const forbidden = actionForbidden(state, op, o.action)
  if (forbidden) return bad(forbidden)
  // M10 batch D shared: inside its own activation the activation's performed actions still bar it (R-3.9)
  const own = o.checkPerformed && !o.ignorePerformed && !o.interrupt ? ownActivationOf(state, op) : null
  if (own) {
    if (own.barred?.includes(o.action)) return bad(`${o.action} was stopped and cannot be tried again this activation`)
    const why = performedProblem(state, op, o.action, own)
    if (why) return bad(why)
  }
  switch (o.action) {
    case 'dash':
    case 'reposition':
      return inCr ? bad('cannot move while in an enemy control range') : null
    case 'charge':
      if (op.order === 'conceal' && !chargeUnderConceal(state, op)) return bad('a Conceal operative cannot Charge')
      return inCr && !chargeFromControlRange(state, op) ? bad('cannot Charge while in an enemy control range') : null
    case 'fallBack':
      return inCr ? null : bad('Fall Back needs an enemy in control range')
    case 'fight':
      return fightAvailability(state, op, null)
    case 'shoot':
      if (o.pointBlank) return inCr ? null : bad('point-blank needs an enemy in control range')
      // batch C shared: freeShootInControlRange lets a free Shoot in an enemy control range be an ordinary one
      return inCr && !hasExplosive(state, op) && !providerAny(state, op, 'freeShootInControlRange') ? bad('cannot Shoot while in an enemy control range') : shootAvailability(state, op, null)
  }
}

/** Can this free action be started right now? */
export function canStartFreeAction(state: GameState, o: FreeActionOpts): boolean {
  const op = state.operatives[o.operativeId]
  if (!op || op.status !== 'active') return false
  return freeActionProblem(state, op, o) === null
}

/**
 * Start a free action as a temporary frame. The current activation (possibly none) waits on the
 * stack; `frame.resume` runs once the action finishes or is cancelled. False when it cannot start.
 */
export function startFreeAction(ctx: Ctx, o: FreeActionOpts): boolean {
  const s = ctx.state
  const op = s.operatives[o.operativeId]
  if (!op || op.status !== 'active' || freeActionProblem(s, op, o)) return false
  const data: Record<string, unknown> = { ...(o.data ?? {}), kind: o.action }
  if (o.pointBlank) data.pointBlank = true
  if (o.checkPerformed && !o.ignorePerformed) data.checkPerformed = true
  // a ploy window that started this frame (KRUMP 'EM!, SSSSHHHH!) waits aside: the attack inside opens windows of its own
  if (s.window) {
    data.savedWindow = s.window
    s.window = null
  }
  if (o.weaponNameContains) {
    data.savedWeapons = op.weapons.slice()
    data.nameFilter = o.weaponNameContains.toLowerCase()
    op.weapons = op.weapons.filter((w) => (s.data.weapons[w]?.name ?? '').toLowerCase().includes(o.weaponNameContains!.toLowerCase()))
  }
  const frame: Activation = {
    operativeId: op.id,
    seat: op.seat,
    counteract: false,
    stage: 'action',
    apSpent: 0,
    performed: [],
    declared: {
      action: o.action,
      cost: 0,
      free: true,
      ...(o.maxMove !== undefined || o.endWithinCrOf ? { params: { ...(o.maxMove !== undefined ? { maxInches: o.maxMove } : {}), ...(o.endWithinCrOf ? { endWithinCrOf: o.endWithinCrOf } : {}) } } : {}),
    },
    frame: { kind: o.interrupt ? 'interrupt' : 'free', resume: o.resume, data },
    declaredSeq: s.seq,
  }
  ;(s.firefight.stack ??= []).push(s.firefight.activation)
  s.firefight.activation = frame
  ctx.emit({ type: 'ActionDeclared', operativeId: op.id, action: o.action, cost: 0 }, op.seat)
  if (declaredVeto(ctx, op, o.action, true)) return true
  // M10 batch D shared: the actor's firefight.actionDeclared window opens inside free-action frames too (Surge), with
  // `free` set; Guard interrupts excluded
  if (!o.interrupt && DECLARED_WINDOW_ACTIONS.includes(o.action) && openFirefightWindow(ctx, 'firefight.actionDeclared', { subjectId: op.id, counteracting: false, action: o.action, free: true }, 'declared')) return true
  declaredOpponentWindow(ctx)
  return true
}

/** Actions whose declaration opens the actor's firefight.actionDeclared window (marker and mission actions apart). */
const DECLARED_WINDOW_ACTIONS: string[] = ['shoot', 'fight', 'fallBack', 'charge', 'reposition']

/** Start free actions one after another for the queue; `resume` runs once the queue is exhausted. */
export function startFreeSequence(
  ctx: Ctx,
  o: { kind: FreeActionOpts['action']; resume: string; queue: string[]; weaponNameContains?: string; data?: Record<string, unknown> },
): void {
  const q = [...o.queue]
  while (q.length > 0) {
    const id = q.shift()!
    const opts: FreeActionOpts = { operativeId: id, action: o.kind, resume: o.resume, data: { ...(o.data ?? {}), queue: q.slice() } }
    if (o.weaponNameContains) opts.weaponNameContains = o.weaponNameContains
    if (startFreeAction(ctx, opts)) return
  }
  getFrameResume(o.resume)?.(ctx, 'finished', o.data ?? {})
}

/** The frame's action finished or was cancelled: restore the activation underneath and carry on. */
export function closeFrame(ctx: Ctx, outcome: 'finished' | 'cancelled'): void {
  const s = ctx.state
  const frame = s.firefight.activation!
  const info = frame.frame!
  const op = s.operatives[frame.operativeId]
  const data = info.data ?? {}
  if (op && Array.isArray(data.savedWeapons)) {
    // restore the weapons a Dakka Dash narrowed out; a narrowed-in weapon lost during the action stays lost
    const keep = new Set(op.weapons)
    const filter = String(data.nameFilter ?? '')
    op.weapons = (data.savedWeapons as string[]).filter((w) => keep.has(w) || !(s.data.weapons[w]?.name ?? '').toLowerCase().includes(filter))
  }
  s.firefight.activation = (s.firefight.stack ?? []).pop() ?? null
  // M10 batch D shared: a free action inside the operative's own activation counts as performed there (R-3.9)
  if (op && outcome === 'finished' && data.checkPerformed === true && info.kind !== 'interrupt' && typeof data.kind === 'string') {
    const own = ownActivationOf(s, op)
    if (own) own.performed.push(data.kind)
  }
  // M9 shared: a move made in the Strategy phase (a gambit's free Dash) and a finished Guard interrupt are reaction
  // points too (Quicksilver Strike; Medic! when the save happened inside the interrupt)
  if (op && outcome === 'finished' && frameReaction(ctx, op, String(data.kind ?? ''), info, data)) return
  afterFrame(ctx, info.resume, outcome, data)
}

/** The rest of closing a frame: the next free action of its queue, or the frame's resume. */
function afterFrame(ctx: Ctx, resume: string, outcome: 'finished' | 'cancelled', data: Record<string, unknown>): void {
  const s = ctx.state
  const queue = data.queue
  const hasQueue = Array.isArray(queue) && queue.length > 0
  if (!hasQueue && data.savedWindow) s.window = data.savedWindow as typeof s.window
  if (Array.isArray(queue) && queue.length > 0) {
    const carry = { ...data }
    for (const k of ['savedWeapons', 'nameFilter', 'queue', 'kind', 'pointBlank', 'checkPerformed']) delete carry[k]
    startFreeSequence(ctx, { kind: data.kind as FreeActionOpts['action'], resume, queue: queue as string[], data: carry })
    return
  }
  getFrameResume(resume)?.(ctx, outcome, data)
}

const MOVE_KINDS = ['reposition', 'dash', 'fallBack', 'charge']

/**
 * Reaction points at the end of a frame (team-rules `reactions`): a free move outside any activation in the
 * Strategy phase (info.strategy = true), and a Guard interrupt that finished (info.interrupt = true; the seat
 * whose activation was interrupted may react). The frame's closing waits in `firefight.reactionAfter`;
 * reactionDone finishes it. Not offered for a frame that is itself part of a reaction. True when raised.
 */
function frameReaction(ctx: Ctx, actor: Operative, kind: string, frame: NonNullable<Activation['frame']>, data: Record<string, unknown>): boolean {
  const s = ctx.state
  if (s.firefight.reactionAfter || frame.resume === REACTION_DONE || actor.status !== 'active') return false
  const outside = s.phase === 'strategy' && !s.firefight.activation
  const strategy = outside && MOVE_KINDS.includes(kind)
  const interrupt = frame.kind === 'interrupt' && s.phase === 'firefight'
  // batch C shared: any other free action in the Strategy phase, and a free action an operative took inside its own
  // seat's activation (Savage Brutality's Fight), are reaction points for offers marked `freeActions` only
  const strategyOther = outside && !strategy && kind !== ''
  const under = s.firefight.activation
  const ownFree = !interrupt && s.phase === 'firefight' && !!under && !under.frame && under.seat === actor.seat && kind !== ''
  if (!strategy && !interrupt && !strategyOther && !ownFree) return false
  const seat = otherSeat(actor.seat)
  const flag = strategy || strategyOther ? { strategy: true } : interrupt ? { interrupt: true } : { freeAction: true }
  const info = { actorId: actor.id, action: kind, activeSeat: actor.seat, moved: MOVE_KINDS.includes(kind), ...flag, ...(strategyOther ? { freeAction: true } : {}) }
  const window: TimingWindowId = strategy || strategyOther ? 'strategy.gambit' : 'firefight.actionEnded'
  const filterFree = strategyOther || ownFree
  let offers = providerReactions(s, seat, info)
  if (filterFree) offers = offers.filter((o) => o.freeActions === true)
  // M10 batch D shared: the actor's own seat first (ownReactions marked `freeActions`: Dynamic after an in-activation
  // free Shoot or a Guard interrupt Shoot), then the other seat's reactions as before
  const own = s.phase === 'firefight' && kind !== '' ? providerOwnReactions(s, actor.seat, info).filter((o) => o.freeActions === true) : []
  if (own.length > 0) {
    s.firefight.reactionAfter = { resume: frame.resume, outcome: 'finished', data, ...(offers.length > 0 ? { then: { seat, info, window, filterFree } } : {}) }
    raiseReaction(ctx, actor.seat, actor.id, kind, own, window)
    return true
  }
  if (offers.length === 0) return false
  s.firefight.reactionAfter = { resume: frame.resume, outcome: 'finished', data }
  raiseReaction(ctx, seat, actor.id, kind, offers, window)
  return true
}

/**
 * The activating operative was removed (incapacitated by Hot, a fight or a rule): its activation or
 * counteraction ends at once and any decision raised for it is dropped. M2b-attack.
 */
export function afterActiveOperativeRemoved(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation
  if (!act) return
  s.pending = null
  act.declared = null
  if (act.counteract) endCounteract(ctx)
  else endActivation(ctx)
}

/**
 * M9 batch B: activate `partnerId` together with the operative whose activation is in progress (Extremis Mind-Link,
 * from a ploy at its firefight.activationStart). The partner takes `order`, is activated ("is activated" rules run
 * for it), and keeps its own AP and actions; the player switches between the two. False when it cannot join (not a
 * ready friendly operative in the killzone, or the activation is a counteraction, a free action or already joint).
 */
export function joinActivation(ctx: Ctx, partnerId: string, order: Order): boolean {
  const s = ctx.state
  const act = s.firefight.activation
  const p = s.operatives[partnerId]
  if (!act || act.frame || act.counteract || act.partner || !p || p.id === act.operativeId) return false
  if (p.seat !== act.seat || !p.ready || p.status !== 'active') return false
  if (!allowedOrders(s, p).includes(order)) return false
  p.movedThisActivation = 0
  ctx.emit({ type: 'OperativeActivated', operativeId: p.id })
  tokensOnActivationStart(ctx, p.id)
  removeEffects(ctx, (e) => e.expires === `startOfActivation:${p.id}`)
  applyDeferredApl(ctx, p.id)
  const previousOrder = p.order
  if (p.order !== order) clearGuard(ctx, p, 'order')
  p.order = order
  ctx.emit({ type: 'OrderSet', operativeId: p.id, order })
  p.ready = false
  act.partner = { operativeId: p.id, seat: p.seat, counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
  runHook('activation.start', { seat: p.seat, state: s, engine: ctx, operativeId: p.id, data: { previousOrder, order, joint: true } })
  if (p.status !== 'active') delete act.partner
  return true
}

/** M9 batch B: a ploy used in firefight.beforeActivation makes `seat` pass this activation (Heinous Arrogance). */
export function skipActivation(ctx: Ctx, seat: Seat): void {
  ctx.state.firefight.skipping = seat
}

/** A declared action that cannot be completed is cancelled: nothing changes, no AP is spent (R-3.8). */
export function cancelAction(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const decl = act.declared!
  ctx.emit({ type: 'ActionCancelled', operativeId: act.operativeId, action: decl.action }, act.seat)
  act.declared = null
  delete act.surcharge
  // a delegated free action goes back to its choice (R-3.8: as if never declared); other frames end
  if (act.frame && act.frame.data?.kind !== 'delegated') {
    closeFrame(ctx, 'cancelled')
    return
  }
  raiseAction(ctx)
}

export function endTurningPoint(ctx: Ctx): void {
  const s = ctx.state
  if (s.firefight.beforeActivationFor) s.firefight.beforeActivationFor = null
  ctx.emit({ type: 'PhaseEnded', name: 'firefight' }, null)
  // KRUMP 'EM! and other end-of-phase ploys
  void s
  if (openFirefightWindow(ctx, 'turningPoint.end', {}, 'turningPointEnd')) return
  finishTurningPoint(ctx)
}

/** Score the crit op, expire turning-point effects, then start the next turning point or end the battle. */
function finishTurningPoint(ctx: Ctx): void {
  const s = ctx.state
  // M9 prep: end-of-TP team rules (HIDING deadline) run before the crit op is scored
  runHook('turningPoint.end', { seat: s.initiative ?? 'A', state: s, engine: ctx, data: { turningPoint: s.turningPoint } })
  scoreTurningPointEnd(ctx)
  tokensOnTurningPointEnd(ctx)
  expireEffects(ctx, 'turningPoint')
  smokeTurningPointEnd(ctx)
  for (const seat of ['A', 'B'] as const) {
    s.config[seat].doctrine = null
    s.config[seat].adaptive = null
  }
  ctx.emit({ type: 'TurningPointEnded', number: s.turningPoint }, null)
  if (s.turningPoint >= TURNING_POINTS) {
    endGame(ctx, 'turningPoint')
    return
  }
  beginTurningPoint(ctx)
}

/** Ends the battle: the kill op comparison, then the result by VP (equal VP is a draw, M-1.1). */
export function endGame(ctx: Ctx, reason: 'turningPoint' | 'resign', resigned?: Seat): void {
  const s = ctx.state
  if (reason === 'turningPoint') scoreBattleEnd(ctx)
  const vp = { A: s.players.A.vp, B: s.players.B.vp }
  let winner: Seat | 'draw' = vp.A === vp.B ? 'draw' : vp.A > vp.B ? 'A' : 'B'
  if (reason === 'resign' && resigned) winner = otherSeat(resigned)
  s.result = { winner, vp, reason, placeholder: s.mission === null }
  s.phase = 'ended'
  s.pending = null
  s.firefight.activation = null
  ctx.emit({ type: 'GameEnded', result: s.result }, null)
}

// ---------------------------------------------------------------------------
// M9 prep: delegated free actions, reactions, control between steps
// ---------------------------------------------------------------------------

/** What a delegated free action may be (Interstitial Command, Remote Pilot, A Worthy Cause); stored in frame data. */
export interface DelegatedRules {
  /** only actions whose cost after modifiers is exactly 1 AP (as for counteract, R-3.12) */
  oneApOnly?: boolean
  /** cap on any move during it (2") */
  maxMove?: number
  /** only these actions: universal ids, `ability:<id>`, `marker:pickUp`, or 'mission' for MISSION actions */
  allow?: string[]
  /** never these actions */
  deny?: string[]
  /** also bar actions the operative already performed this turning point (Interstitial Command) */
  notDoneThisTp?: boolean
  /** free text the team hook may read (Remote Pilot lifts the Drone whitelist through its own provider) */
  tag?: string
}

function delegatedAllows(r: DelegatedRules, actionId: string, cost: number, mission: boolean): boolean {
  if (r.oneApOnly && cost !== 1) return false
  if (r.deny?.includes(actionId)) return false
  if (r.allow && !r.allow.includes(actionId) && !(mission && r.allow.includes('mission'))) return false
  return true
}

/**
 * Let `operativeId` perform one free action of its player's choice right now, outside its own activation
 * (Interstitial Command, Remote Pilot, A Worthy Cause, Plan Generations). It runs as a frame: the
 * operative gets a firefight.action decision filtered by `rules`, no AP is spent, and `resume` runs once
 * the action finishes or the player picks 'end'. False when it has nothing it could do (nothing starts).
 */
export function startDelegatedAction(ctx: Ctx, o: { operativeId: string; resume: string; rules: DelegatedRules; data?: Record<string, unknown> }): boolean {
  const s = ctx.state
  const op = s.operatives[o.operativeId]
  if (!op || op.status !== 'active') return false
  const data: Record<string, unknown> = { ...(o.data ?? {}), kind: 'delegated', delegated: { ...o.rules } }
  if (s.window) {
    data.savedWindow = s.window
    s.window = null
  }
  const frame: Activation = {
    operativeId: op.id,
    seat: op.seat,
    counteract: false,
    stage: 'action',
    apSpent: 0,
    performed: o.rules.notDoneThisTp ? [...(op.actionsThisTp ?? [])] : [],
    declared: null,
    frame: { kind: 'free', resume: o.resume, data },
  }
  ;(s.firefight.stack ??= []).push(s.firefight.activation)
  s.firefight.activation = frame
  raiseAction(ctx)
  return true
}

/**
 * After an action, the non-active player may react with a team rule (Quicksilver Strike): one
 * ability.choice listing every offer plus pass. The choosing hook starts its free action with
 * `resume: REACTION_DONE` (or calls reactionDone itself). True when a decision was raised.
 */
function offerReactions(ctx: Ctx): boolean {
  const s = ctx.state
  const act = s.firefight.activation
  if (!act || act.frame) return false
  if (act.reactedAt === act.performed.length) return false
  act.reactedAt = act.performed.length
  act.reacted = { seat: act.seat, ids: [] }
  return nextReactions(ctx, act)
}

/**
 * batch C shared: the reaction round after an action. The active seat's ownReactions come first, then the other
 * seat's reactions. After a reaction is over the same seat is asked again for offers marked `repeat` from operatives
 * that have not reacted yet; a pass ends that seat's turn to react. True when a decision was raised.
 */
function nextReactions(ctx: Ctx, act: Activation): boolean {
  const s = ctx.state
  const r = act.reacted
  const actor = s.operatives[act.operativeId]
  const last = act.performed[act.performed.length - 1]
  if (!r || !actor || !last) return false
  const moved = ['reposition', 'dash', 'fallBack', 'charge'].includes(last) || (actor.actionsThisTp ?? []).slice(-1)[0] === 'reposition'
  const info = { actorId: actor.id, action: last, activeSeat: act.seat, moved }
  if (!r.closed) {
    const all = r.seat === act.seat ? providerOwnReactions(s, r.seat, info) : providerReactions(s, r.seat, info)
    const offers = r.ids.length === 0 ? all : all.filter((o) => o.repeat === true && !r.ids.includes(o.operativeId))
    if (offers.length > 0) {
      raiseReaction(ctx, r.seat, actor.id, last, offers, 'firefight.actionEnded')
      return true
    }
  }
  if (r.seat !== act.seat) return false
  // the active seat is done reacting: the other seat's turn
  act.reacted = { seat: otherSeat(act.seat), ids: [] }
  return nextReactions(ctx, act)
}

/** The activation whose after-action reaction round is open (never a frame), or null. */
function reactingActivation(state: GameState): Activation | null {
  const act = state.firefight.activation
  if (!act || act.frame || !act.reacted || act.reactedAt !== act.performed.length) return null
  return act
}

/** batch C shared: a reaction was chosen (`operativeId` reacts) or passed (null) in the after-action round. */
export function noteReaction(state: GameState, operativeId: string | null): void {
  const act = reactingActivation(state)
  if (!act) return
  if (operativeId === null) act.reacted!.closed = true
  else if (!act.reacted!.ids.includes(operativeId)) act.reacted!.ids.push(operativeId)
}

function raiseReaction(ctx: Ctx, seat: Seat, actorId: string, last: string, offers: ReactionOffer[], window: TimingWindowId): void {
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window,
    context: { hook: 'reaction', reaction: true, actorId, action: last, offers },
    options: offers.map((r, i) => ({
      id: `react:${i}`,
      labelKey: r.labelKey,
      type: 'ability.choice' as const,
      payload: { option: String(i) },
      data: { hook: r.hook, operativeId: r.operativeId, ...(r.data ?? {}) },
    })),
    canPass: true,
  })
}

/** Name of the frame resume a reaction's free action uses; it carries on with the Guard interrupt stage. */
export const REACTION_DONE = 'reaction.done'

/** The reaction is over (performed, impossible or declined): Guard interrupts, then the activation goes on. */
export function reactionDone(ctx: Ctx): void {
  const s = ctx.state
  const after = s.firefight.reactionAfter
  if (after) {
    // M10 batch D shared: the actor's own frame reaction is over: the other seat's reactions to that frame now
    const then = after.then
    if (then) {
      const info = then.info as unknown as Parameters<typeof providerReactions>[2]
      let offers = providerReactions(s, then.seat, info)
      if (then.filterFree) offers = offers.filter((o) => o.freeActions === true)
      const actorId = String(then.info.actorId ?? '')
      if (offers.length > 0 && s.operatives[actorId]) {
        s.firefight.reactionAfter = { resume: after.resume, outcome: after.outcome, data: after.data }
        raiseReaction(ctx, then.seat, actorId, String(then.info.action ?? ''), offers, then.window)
        return
      }
    }
    // a reaction at the end of a frame (Strategy-phase move, Guard interrupt): finish closing that frame
    s.firefight.reactionAfter = null
    afterFrame(ctx, after.resume, after.outcome, after.data)
    return
  }
  // M9 batch B: a reaction at the end of an activation or counteraction: the next activation is chosen
  if (s.firefight.reactionAtEnd && !s.firefight.activation) {
    s.firefight.reactionAtEnd = false
    advance(ctx)
    return
  }
  // batch C shared: more reactions to the same action (a second Hound), then the other seat's
  const act = reactingActivation(s)
  if (act && nextReactions(ctx, act)) return
  if (s.firefight.activation) afterActionStages(ctx, 'guard')
}

registerFrameResume(REACTION_DONE, (ctx) => reactionDone(ctx))

/**
 * M9 batch C: a counteract alternative (counteractAlternatives) is finished; the turn passes to the other seat as after
 * a counteraction. A hook that raised a follow-up decision calls this once that is answered.
 */
export function counteractAlternativeDone(ctx: Ctx, seat: Seat): void {
  ctx.state.firefight.turn = otherSeat(seat)
  advance(ctx)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleActivate(state: GameState, action: Action): Handled {
  if (action.type === 'pass') {
    return {
      run(ctx) {
        ctx.emit({ type: 'CounteractSkipped' }, action.seat)
        ctx.state.firefight.turn = otherSeat(action.seat)
        advance(ctx)
      },
    }
  }
  if (action.type !== 'firefight.activate') return reject('E_WRONG_DECISION', 'expected an activation')
  const { operativeId, counteract } = action.payload
  // M9 batch C: a team's alternative to counteracting (counteractAlternatives); the turn then passes as after one
  const alt = (action.payload as { alternative?: unknown }).alternative
  if (alt !== undefined) {
    const offers = activatableOps(state, action.seat).length === 0 ? providerCounteractAlternatives(state, action.seat) : []
    const offer = typeof alt === 'number' ? offers[alt] : undefined
    const hook = offer ? getCodeHook(offer.hook) : undefined
    if (!offer || !hook?.choice) return reject('E_NOT_AN_OPTION', 'no such alternative to counteracting')
    return {
      run(ctx) {
        const s = ctx.state
        if (s.firefight.beforeActivationFor) s.firefight.beforeActivationFor = null
        hook.choice!(ctx, getOp(s, offer.operativeId), offer.option, { alternative: true, ...(offer.data ?? {}) })
        if (s.pending) return
        counteractAlternativeDone(ctx, action.seat)
      },
    }
  }
  const op = state.operatives[operativeId]
  const offboard = op?.status === 'reserve' && op.offboard !== undefined && counteract !== true
  if (!op || op.seat !== action.seat || (op.status !== 'active' && !offboard)) {
    return reject('E_NOT_AN_OPTION', `${operativeId} cannot activate`)
  }
  const chain = state.firefight.chain
  if (chain && chain.seat === action.seat && counteract !== true && !chain.ids.includes(operativeId) && readyOps(state, chain.seat).some((o) => chain.ids.includes(o.id))) {
    return reject('E_ACTION_RESTRICTED', 'a chained activation is owed: activate one of the operatives the rule names')
  }
  if (counteract === true) {
    if (op.ready) return reject('E_ACTION_RESTRICTED', 'only an expended operative can counteract')
    if (!canCounteractWithOrder(state, op)) return reject('E_ACTION_RESTRICTED', 'only an Engage operative can counteract')
    if (op.flags.counteractedThisTP) return reject('E_ACTION_RESTRICTED', 'an operative counteracts once per turning point')
    if (activatableOps(state, action.seat).length > 0) {
      return reject('E_ACTION_RESTRICTED', 'counteract needs every friendly operative expended')
    }
    return {
      run(ctx) {
        const s = ctx.state
        const o = getOp(s, operativeId)
        o.flags.counteractedThisTP = true
        o.movedThisActivation = 0
        if (s.firefight.beforeActivationFor) s.firefight.beforeActivationFor = null
        clearGuard(ctx, o, 'counteract')
        ctx.emit({ type: 'Counteracted', operativeId: o.id })
        s.firefight.activation = {
          operativeId: o.id,
          seat: o.seat,
          counteract: true,
          stage: 'action',
          apSpent: 0,
          performed: [],
          declared: null,
        }
        // Wrath of Vengeance and other counteraction ploys open here (M2b-game)
        if (openFirefightWindow(ctx, 'firefight.activationStart', { subjectId: o.id, counteracting: true }, 'activationStart')) return
        raiseAction(ctx)
      },
    }
  }
  if (!op.ready) return reject('E_ACTION_RESTRICTED', 'that operative is expended')
  if (providerActivationBarred(state, op)) return reject('E_ACTION_RESTRICTED', 'a rule stops that operative being activated now')
  return {
    run(ctx) {
      const s = ctx.state
      const o = getOp(s, operativeId)
      const chained = s.firefight.chain?.seat === o.seat && s.firefight.chain.ids.includes(o.id)
      // M9 prep: a rule may stop this operative activating this time (Vision of Madness); never the last choice
      const others = readyOps(s, o.seat).filter((x) => x.id !== o.id && !(s.firefight.gated ?? []).includes(x.id))
      if (!chained && others.length > 0) {
        const by = providerGate(ctx, o)
        if (by) {
          s.firefight.gated = [...(s.firefight.gated ?? []), o.id]
          ctx.emit({ type: 'ActivationGated', operativeId: o.id, by }, o.seat)
          advance(ctx)
          return
        }
      }
      s.firefight.chain = null
      s.firefight.gated = []
      if (s.firefight.beforeActivationFor) s.firefight.beforeActivationFor = null
      s.firefight.activation = {
        operativeId: o.id,
        seat: o.seat,
        counteract: false,
        stage: 'order',
        apSpent: 0,
        performed: [],
        declared: null,
        ...(chained ? { chained: true } : {}),
      }
      o.movedThisActivation = 0
      ctx.emit({ type: 'OperativeActivated', operativeId: o.id })
      tokensOnActivationStart(ctx, o.id)
      // effects that last "until the start of its next activation" (OPTICS) end now
      removeEffects(ctx, (e) => e.expires === `startOfActivation:${o.id}`)
      // batch C shared: APL changes held over from the operative's previous activation (Medic!)
      applyDeferredApl(ctx, o.id)
      ctx.raise({
        kind: 'firefight.order',
        seat: o.seat,
        window: 'firefight.activationStart',
        context: { operativeId: o.id, current: o.order },
        options: allowedOrders(s, o).map((order) => ({
          id: order,
          labelKey: `order.${order}`,
          type: 'firefight.order' as const,
          payload: { order },
        })),
      })
    },
  }
}

function handleOrder(state: GameState, action: Action): Handled {
  if (action.type !== 'firefight.order') return reject('E_WRONG_DECISION', 'expected an order')
  const order = action.payload.order
  const act0 = state.firefight.activation
  if (act0 && !allowedOrders(state, getOp(state, act0.operativeId)).includes(order)) {
    return reject('E_ACTION_RESTRICTED', `that operative cannot take a ${order} order`)
  }
  return {
    run(ctx) {
      const s = ctx.state
      const act = s.firefight.activation!
      const o = getOp(s, act.operativeId)
      const previousOrder = o.order
      if (o.order !== order) clearGuard(ctx, o, 'order')
      o.order = order
      act.stage = 'action'
      ctx.emit({ type: 'OrderSet', operativeId: o.id, order })
      // M9 prep: "when this operative is activated" team rules (Poison, Cult Ambush); damage may end the activation
      if (!act.frame && !act.counteract) {
        runHook('activation.start', { seat: o.seat, state: s, engine: ctx, operativeId: o.id, data: { previousOrder, order } })
        if (o.status !== 'active' && o.offboard === undefined) {
          afterActiveOperativeRemoved(ctx)
          return
        }
      }
      // firefight.activationStart ploy window (Shake It Off, Heroic Leader's Combat Doctrine)
      if (openFirefightWindow(ctx, 'firefight.activationStart', { subjectId: o.id, counteracting: false }, 'activationStart')) return
      raiseAction(ctx)
    },
  }
}

/** Run the action just declared in the current (possibly temporary) activation. */
function dispatchDeclared(ctx: Ctx): void {
  const s = ctx.state
  const a = s.firefight.activation!
  const o = getOp(s, a.operativeId)
  const decl = a.declared!
  const id = decl.action
  if (id === 'shoot') {
    beginShoot(ctx, a.frame?.data?.pointBlank === true ? { pointBlank: true } : {})
    return
  }
  if (id === 'fight') {
    beginFight(ctx)
    return
  }
  const def = ACTIONS[id]
  if (def?.move) {
    const kind = def.move
    // M9 prep: free and delegated moves may be capped (3" free Charge, 2" Interstitial Command) or tied to one enemy
    const capFrame = (a.frame?.data?.delegated as DelegatedRules | undefined)?.maxMove
    const capDecl = decl.params?.maxInches as number | undefined
    const caps = [capFrame, capDecl].filter((x): x is number => typeof x === 'number')
    if (caps.length > 0 && capDecl !== Math.min(...caps)) decl.params = { ...(decl.params ?? {}), maxInches: Math.min(...caps) }
    const constraints = moveConstraints(o, kind, a.counteract, s)
    const limit = decl.params?.maxInches as number | undefined
    if (limit !== undefined) constraints.maxInches = Math.min(constraints.maxInches ?? limit, limit)
    const endWithin = decl.params?.endWithinCrOf as string | undefined
    if (endWithin) constraints.mustEndInControlRangeOfId = endWithin
    ctx.raise({
      kind: 'move.path',
      seat: o.seat,
      window: 'firefight.actionDeclared',
      context: { operativeId: o.id, action: id, maxInches: constraints.maxInches ?? moveLimit(o, kind, a.counteract, s) },
      constraints,
      canPass: true,
    })
    return
  }
  if (id === 'guard') {
    o.flags.guard = true
    ctx.emit({ type: 'GuardSet', operativeId: o.id }, o.seat)
    finishAction(ctx)
    return
  }
  if (id.startsWith(ABILITY_PREFIX) || id === PICK_UP || id === PLACE) {
    const p = (decl.params ?? {}) as Record<string, unknown>
    const offer: AbilityOffer = {
      id,
      action: id,
      abilityId: (p.abilityId as string | undefined) ?? id,
      cost: decl.cost,
      params: (p.offer as Record<string, unknown> | undefined) ?? {},
      labelKey: id,
    }
    performOffer(ctx, o, offer)
    return
  }
  finishAction(ctx)
}

function handleAction(state: GameState, action: Action): Handled {
  if (action.type !== 'firefight.action') return reject('E_WRONG_DECISION', 'expected an action choice')
  const act = state.firefight.activation
  if (!act) return reject('E_WRONG_DECISION', 'no operative is active')
  const id = action.payload.action
  if (id === 'end') {
    return { run: (ctx) => (act.frame ? closeFrame(ctx, 'cancelled') : act.counteract ? endCounteract(ctx) : endActivation(ctx)) }
  }
  if (id === 'switch') {
    if (!act.partner || act.frame || act.counteract) return reject('E_NOT_AN_OPTION', 'no other operative is activated with this one')
    return {
      run(ctx) {
        const a = ctx.state.firefight.activation!
        const p = a.partner!
        delete a.partner
        p.partner = a
        ctx.state.firefight.activation = p
        raiseAction(ctx)
      },
    }
  }
  const op = getOp(state, act.operativeId)
  if (id.startsWith(ABILITY_PREFIX) || id === PICK_UP || id === PLACE) {
    // unique, mission, equipment and marker actions
    const found = findOffer(state, op, act, action.payload)
    if ('code' in found) return { rejection: found }
    const offer = found
    return {
      run(ctx) {
        const s = ctx.state
        const a = s.firefight.activation!
        const o = getOp(s, a.operativeId)
        ctx.emit({ type: 'ActionDeclared', operativeId: o.id, action: id, cost: offer.cost }, o.seat)
        a.declared = { action: id, cost: offer.cost, params: { abilityId: offer.abilityId, offer: offer.params } }
        a.declaredSeq = s.seq
        const mission = (s.data.abilities[offer.abilityId]?.keywords ?? []).includes('MISSION')
        consumeDiscounts(s, o, a, id === PICK_UP ? 'pick-up-marker' : id === PLACE ? 'place-marker' : offer.abilityId, mission)
        if (declaredVeto(ctx, o, id, a.frame !== undefined)) return
        // M9 batch B shared: the active player's firefight.actionDeclared window also opens for Pick Up Marker and
        // mission actions (Scrapcode Overload, a counteracting Infiltrator included); resumes at the opponent's window
        if ((id === PICK_UP || mission) && openFirefightWindow(ctx, 'firefight.actionDeclared', { subjectId: o.id, counteracting: a.counteract, action: id }, 'declared')) return
        declaredOpponentWindow(ctx)
      },
    }
  }
  const unavailable = actionAvailability(state, op, id, act)
  if (unavailable) return { rejection: unavailable }
  const def = ACTIONS[id]!
  if (!def.implemented) return reject('E_TODO', `${id} is not implemented until M2b`)
  const cost = actionCost(state, op, id, act)
  return {
    run(ctx) {
      const s = ctx.state
      const a = s.firefight.activation!
      const o = getOp(s, a.operativeId)
      ctx.emit({ type: 'ActionDeclared', operativeId: o.id, action: id, cost }, o.seat)
      a.declared = { action: id, cost }
      a.declaredSeq = s.seq
      consumeDiscounts(s, o, a, id, false)
      if (declaredVeto(ctx, o, id, a.frame !== undefined)) return
      // firefight.actionDeclared ploy window for attacks (Adjust Doctrine), batch C shared Fall Back (Cover Retreat) and
      // M10 batch D shared Charge and Reposition
      if (DECLARED_WINDOW_ACTIONS.includes(id) && openFirefightWindow(ctx, 'firefight.actionDeclared', { subjectId: o.id, counteracting: a.counteract, action: id }, 'declared')) return
      declaredOpponentWindow(ctx)
    },
  }
}

export const firefightModule: ModuleDef = {
  id: 'firefight',
  namespaces: ['firefight', 'confirm', 'guard'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'firefight.activate':
        return handleActivate(state, action)
      case 'firefight.order':
        return handleOrder(state, action)
      case 'firefight.action':
        return handleAction(state, action)
      case 'guard.interrupt':
        return handleInterrupt(state, action)
      default:
        return reject('E_TODO', `${pending.kind} is not implemented until M2b`)
    }
  },
  explain(state, action, pending: PendingDecision) {
    if (pending.kind !== 'firefight.action' || action.type !== 'firefight.action') return null
    const act = state.firefight.activation
    if (!act) return null
    const id = action.payload.action
    const op = getOp(state, act.operativeId)
    if (id.startsWith(ABILITY_PREFIX) || id === PICK_UP || id === PLACE) {
      const found = findOffer(state, op, act, action.payload)
      return 'code' in found ? found : null
    }
    const unavailable = actionAvailability(state, op, id, act)
    if (unavailable) return unavailable
    if (ACTIONS[id] && !ACTIONS[id]!.implemented) {
      return { code: 'E_TODO', reason: `${id} is not implemented until M2b` }
    }
    return null
  },
}
