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
import { expireEffects, removeEffects } from './effects'
import { getFrameResume } from './hooks'
import { PICK_UP, PLACE } from './markers'
import { scoreBattleEnd, scoreTurningPointEnd } from './missions'
import { openPloyWindow } from './ploys'
import { handleInterrupt, offerInterrupt } from './guard'
import type { PloyWindowInfo } from './code-hooks'
import type { TimingWindowId } from './types'

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
  return Math.max(0, base + actionCostDelta(state, op, actionId, act))
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
  const cost = actionCost(state, op, actionId, activation)

  const forbidden = actionForbidden(state, op, actionId)
  if (forbidden) return restricted(forbidden)
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
      if (op.order === 'conceal') return restricted('a Conceal operative cannot go on Guard')
      if (inEnemyCr) return restricted('cannot go on Guard while in an enemy control range')
      break
    case 'shoot':
      if (op.order === 'conceal' && !hasSilentRanged(state, op)) {
        return restricted('a Conceal operative cannot Shoot except with a Silent weapon')
      }
      // the Bomb Squig's Explosive rule lets it Shoot in an enemy control range (T-KOM 2.3)
      if (inEnemyCr && !hasExplosive(state, op)) return restricted('cannot Shoot while in an enemy control range')
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
  advance(ctx)
}

/** Opponent-has-ready counteract candidates for `seat`: expended, Engage, not yet counteracted this TP. */
export function counteractCandidates(state: GameState, seat: Seat): Operative[] {
  return seatOps(state, seat).filter((o) => !o.ready && canCounteractWithOrder(state, o) && !o.flags.counteractedThisTP)
}

function advance(ctx: Ctx): void {
  const s = ctx.state
  for (let i = 0; i < 4; i++) {
    const seat = s.firefight.turn
    const mine = readyOps(s, seat)
    const theirs = readyOps(s, otherSeat(seat))
    if (mine.length === 0 && theirs.length === 0) {
      endTurningPoint(ctx)
      return
    }
    if (mine.length > 0) {
      raiseActivate(ctx, seat, mine, [])
      return
    }
    const eligible = counteractCandidates(s, seat)
    if (eligible.length > 0) {
      raiseActivate(ctx, seat, [], eligible)
      return
    }
    s.firefight.turn = otherSeat(seat)
  }
}

function raiseActivate(ctx: Ctx, seat: Seat, ready: Operative[], counter: Operative[]): void {
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
  ]
  ctx.raise({
    kind: 'firefight.activate',
    seat,
    window: 'firefight.activationEnded',
    context: { ready: ready.map((o) => o.id), counteract: counter.map((o) => o.id) },
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
  for (const id of ACTION_ORDER) {
    const def = ACTIONS[id]!
    if (!def.implemented) continue
    if (actionAvailability(s, op, id, act)) continue
    options.push({
      id,
      labelKey: `action.${id}`,
      type: 'firefight.action',
      payload: { action: id },
      data: { cost: actionCost(s, op, id, act) },
    })
  }
  // unique, mission, equipment and marker actions (M2b-game)
  for (const offer of abilityOffers(s, op, act)) options.push(abilityOption(offer))
  if (options.length === 0) {
    // Nothing left to do: the activation (or counteraction) ends by itself.
    if (act.counteract) endCounteract(ctx)
    else endActivation(ctx)
    return
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
  // M2b-attack: timed APL effects (Stun) end with the operative's activation; a point-blank restriction too
  expireAplEffects(ctx, op.id)
  for (const o of Object.values(s.operatives)) delete o.flags.cannotRetaliate
  expireEffects(ctx, 'activation')
  smokeActivation(ctx)
  ctx.emit({ type: 'OperativeExpended', operativeId: op.id }, op.seat)
  s.firefight.activation = null
  s.firefight.turn = otherSeat(act.seat)
  advance(ctx)
}

function endCounteract(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  for (const o of Object.values(s.operatives)) delete o.flags.cannotRetaliate
  expireEffects(ctx, 'activation')
  s.firefight.activation = null
  s.firefight.turn = otherSeat(act.seat)
  advance(ctx)
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

export function afterActionStages(ctx: Ctx, stage: 'ploys' | 'guard' | 'continue'): void {
  const s = ctx.state
  const act = s.firefight.activation
  if (!act) return
  if (stage === 'ploys') {
    const op = s.operatives[act.operativeId]
    if (op && op.status === 'active') {
      const last = act.performed[act.performed.length - 1]
      const info = { subjectId: op.id, counteracting: act.counteract, ...(last ? { action: last } : {}) }
      if (openFirefightWindow(ctx, 'firefight.actionEnded', info, 'actionEnded.guard')) return
    }
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
      dispatchDeclared(ctx)
      return
    case 'actionEnded.guard':
      afterActionStages(ctx, 'guard')
      return
    case 'turningPointEnd':
      finishTurningPoint(ctx)
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
  action: 'dash' | 'reposition' | 'shoot' | 'fight'
  /** name of the FrameResume registered with hooks.registerFrameResume */
  resume: string
  data?: Record<string, unknown>
  interrupt?: boolean
  pointBlank?: boolean
  /** only weapons whose name contains this (Dakka Dash needs a dakka shoota) */
  weaponNameContains?: string
}

function freeActionProblem(state: GameState, op: Operative, o: FreeActionOpts): Rejection | null {
  const inCr = enemiesInControlRange(state, op, op.seat).length > 0
  const bad = (reason: string): Rejection => ({ code: 'E_ACTION_RESTRICTED', reason })
  switch (o.action) {
    case 'dash':
    case 'reposition':
      return inCr ? bad('cannot move while in an enemy control range') : null
    case 'fight':
      return fightAvailability(state, op, null)
    case 'shoot':
      if (o.pointBlank) return inCr ? null : bad('point-blank needs an enemy in control range')
      return inCr && !hasExplosive(state, op) ? bad('cannot Shoot while in an enemy control range') : shootAvailability(state, op, null)
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
    declared: { action: o.action, cost: 0, free: true },
    frame: { kind: o.interrupt ? 'interrupt' : 'free', resume: o.resume, data },
  }
  ;(s.firefight.stack ??= []).push(s.firefight.activation)
  s.firefight.activation = frame
  ctx.emit({ type: 'ActionDeclared', operativeId: op.id, action: o.action, cost: 0 }, op.seat)
  dispatchDeclared(ctx)
  return true
}

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
  const queue = data.queue
  const hasQueue = Array.isArray(queue) && queue.length > 0
  if (!hasQueue && data.savedWindow) s.window = data.savedWindow as typeof s.window
  if (Array.isArray(queue) && queue.length > 0) {
    const carry = { ...data }
    for (const k of ['savedWeapons', 'nameFilter', 'queue', 'kind', 'pointBlank']) delete carry[k]
    startFreeSequence(ctx, { kind: data.kind as FreeActionOpts['action'], resume: info.resume, queue: queue as string[], data: carry })
    return
  }
  getFrameResume(info.resume)?.(ctx, outcome, data)
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

/** A declared action that cannot be completed is cancelled: nothing changes, no AP is spent (R-3.8). */
export function cancelAction(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const decl = act.declared!
  ctx.emit({ type: 'ActionCancelled', operativeId: act.operativeId, action: decl.action }, act.seat)
  act.declared = null
  delete act.surcharge
  if (act.frame) {
    closeFrame(ctx, 'cancelled')
    return
  }
  raiseAction(ctx)
}

export function endTurningPoint(ctx: Ctx): void {
  const s = ctx.state
  ctx.emit({ type: 'PhaseEnded', name: 'firefight' }, null)
  // KRUMP 'EM! and other end-of-phase ploys
  void s
  if (openFirefightWindow(ctx, 'turningPoint.end', {}, 'turningPointEnd')) return
  finishTurningPoint(ctx)
}

/** Score the crit op, expire turning-point effects, then start the next turning point or end the battle. */
function finishTurningPoint(ctx: Ctx): void {
  const s = ctx.state
  scoreTurningPointEnd(ctx)
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
  const op = state.operatives[operativeId]
  if (!op || op.seat !== action.seat || op.status !== 'active') {
    return reject('E_NOT_AN_OPTION', `${operativeId} cannot activate`)
  }
  if (counteract === true) {
    if (op.ready) return reject('E_ACTION_RESTRICTED', 'only an expended operative can counteract')
    if (!canCounteractWithOrder(state, op)) return reject('E_ACTION_RESTRICTED', 'only an Engage operative can counteract')
    if (op.flags.counteractedThisTP) return reject('E_ACTION_RESTRICTED', 'an operative counteracts once per turning point')
    if (readyOps(state, action.seat).length > 0) {
      return reject('E_ACTION_RESTRICTED', 'counteract needs every friendly operative expended')
    }
    return {
      run(ctx) {
        const s = ctx.state
        const o = getOp(s, operativeId)
        o.flags.counteractedThisTP = true
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
  return {
    run(ctx) {
      const s = ctx.state
      const o = getOp(s, operativeId)
      s.firefight.activation = {
        operativeId: o.id,
        seat: o.seat,
        counteract: false,
        stage: 'order',
        apSpent: 0,
        performed: [],
        declared: null,
      }
      ctx.emit({ type: 'OperativeActivated', operativeId: o.id })
      // effects that last "until the start of its next activation" (OPTICS) end now
      removeEffects(ctx, (e) => e.expires === `startOfActivation:${o.id}`)
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
      if (o.order !== order) clearGuard(ctx, o, 'order')
      o.order = order
      act.stage = 'action'
      ctx.emit({ type: 'OrderSet', operativeId: o.id, order })
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
    ctx.raise({
      kind: 'move.path',
      seat: o.seat,
      window: 'firefight.actionDeclared',
      context: { operativeId: o.id, action: id, maxInches: moveLimit(o, kind, a.counteract) },
      constraints: moveConstraints(o, kind, a.counteract),
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
    return { run: (ctx) => (act.counteract ? endCounteract(ctx) : endActivation(ctx)) }
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
        const mission = (s.data.abilities[offer.abilityId]?.keywords ?? []).includes('MISSION')
        consumeDiscounts(s, o, a, id === PICK_UP ? 'pick-up-marker' : id === PLACE ? 'place-marker' : offer.abilityId, mission)
        dispatchDeclared(ctx)
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
      consumeDiscounts(s, o, a, id, false)
      // firefight.actionDeclared ploy window for attacks (Adjust Doctrine)
      if ((id === 'shoot' || id === 'fight') && openFirefightWindow(ctx, 'firefight.actionDeclared', { subjectId: o.id, counteracting: a.counteract, action: id }, 'declared')) return
      dispatchDeclared(ctx)
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
