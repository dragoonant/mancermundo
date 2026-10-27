// ACT module: owns `action.*`. The Action phase (R-5.4 to R-5.6): turn alternation starting with the Priority player, the
// run-out when one side has no Ready fighters left, activation, group activation as a chain (`action.group` nominates, then
// `action.activate` offers only the group), the action menu keyed by the derived status (R-6.3) with Simple / Basic / Double /
// Free accounting (R-6.1), the free turn (R-4.1), and the end of an activation. Shoot, Aim, Blind Fire and Fire Through
// Ductway (S3a) hand over to shoot.ts; Charge, Fight, Retreat and Running for Cover (S3b) to fight.ts; each pays for the
// action when it is resolved. A Broken fighter's only action is Running for Cover (R-12.3); a burning fighter's activation
// is the Blaze sequence (R-3.13); a Blind one makes no attacks (R-3.11). Nerve tests owed by an action are settled before
// the activation carries on (`continueActivation`).
import { fleeFighter, seriouslyInjure } from './casualties'
import { d6SumChance, d6TestChance, d6TestPasses, twoD6TestChance } from './dice'
import { expireEffects } from './effects'
import { runHook } from './hooks'
import { refreshEngagement, withinPath } from './measure'
import {
  halfMove,
  maxInchesFor,
  moveAllowance,
  normaliseAngle,
  raiseMovePath,
  type MovePlan,
  type VoluntaryKind,
} from './movement'
import { stat, status, type DerivedStatus } from './query'
import { reject, type Ctx, type Handled, type ModuleDef, type OptionInput } from './registry'
import { horrorsCheck, lockedConfirmDue, raiseLockedConfirm } from './scenarios'
import { constants, getFighter, isBroken, onBoard, otherSeat, readyFighters, seatFighters } from './state'
import {
  accessTerminal,
  ammoCacheNear,
  bypassCasket,
  casketsNear,
  crawlDuct,
  ductChoices,
  forceDoor,
  doorHelpers,
  lockedDoorsNear,
  mayOpenCaskets,
  operableDoors,
  operateDoor,
  placeCarried,
  smashCasket,
  terminalsNear,
} from './zm'
import { runEndPhase } from './endphase'
import { markFired } from './code-hooks'
import { actionDef, hasSkill, numParam, skillActionDef, skillOf } from './skills/common'
import { handleSkillAction, skillMenu } from './skills/actions'
import { chargeTargets, coupDeGrace, coupDeGraceTargets, reachFights, settleNerve, startCharge, startEscape, startFight } from './fight'
import { resolveHit } from './hits'
import { blazeMove } from './movement'
import { clearCondition } from './traits'
import { attackOptions, linkedWeaponIds, startRangedAttack, type AttackOption } from './shoot'
import { ductFireChoices } from './zm'
import type {
  Action,
  ActionCostType,
  ActionPayloadMap,
  Activation,
  Fighter,
  GameState,
  PendingDecision,
  Rejection,
  RuntimeAction,
  Seat,
} from './types'

type Choose = ActionPayloadMap['action.choose']

/** Action ids this module can resolve. Everything else in core/actions.json is withheld until its stage lands. */
export const IMPLEMENTED_ACTIONS: ReadonlySet<string> = new Set([
  'move',
  'takeCover',
  'reload',
  'operateDoor',
  'accessTerminal',
  'forceDoor',
  'crawlDuct',
  'smashCasket',
  'bypassCasket',
  'carryCasket',
  'standUp',
  'crawl',
  'turn',
  'end',
  'shoot',
  'aim',
  'blindFire',
  'fireDuct',
  'charge',
  'fight',
  'retreat',
  'coupDeGrace',
  'runForCover',
])

const GROUP_RULE = 'core.r.group-activation'

const rejection = (code: Rejection['code'], reason: string, details?: Record<string, unknown>): Rejection => (details ? { code, reason, details } : { code, reason })

// ---------------------------------------------------------------------------
// Costs and accounting (R-6.1)
// ---------------------------------------------------------------------------

function costOf(a: RuntimeAction): number {
  return a.type === 'double' ? 2 : a.type === 'free' ? 0 : 1
}

type EconomyVerdict = 'ok' | 'noActions' | 'needsTwo' | 'repeat' | 'noTurn'

export function economy(act: Activation, a: RuntimeAction): EconomyVerdict {
  switch (a.type) {
    case 'free':
      if (a.id === 'turn') return act.canTurn ? 'ok' : 'noTurn'
      return performedAlready(act, a) ? 'repeat' : 'ok'
    case 'simple':
      return act.actionsLeft >= 1 ? 'ok' : 'noActions'
    case 'basic':
      if (act.actionsLeft < 1) return 'noActions'
      return performedAlready(act, a) ? 'repeat' : 'ok'
    case 'double':
      if (act.actionsLeft < 1) return 'noActions'
      return act.actionsLeft >= 2 ? 'ok' : 'needsTwo'
  }
}

/** A Basic action once per activation; a Free and a Basic of the same name never both (R-6.1). */
function performedAlready(act: Activation, a: RuntimeAction): boolean {
  return act.performed.some((p) => p.action === a.id)
}

// ---------------------------------------------------------------------------
// The action menu (R-6.3)
// ---------------------------------------------------------------------------

export interface MenuOption {
  id: string
  payload: Choose
  data?: Record<string, unknown>
}
export interface Withheld {
  action: string
  reason: string
}
export interface ActionMenu {
  fighterId: string
  status: DerivedStatus | 'broken'
  actionsLeft: number
  canTurn: boolean
  options: MenuOption[]
  withheld: Withheld[]
}

function menuStatus(state: GameState, f: Fighter): DerivedStatus | 'broken' {
  return isBroken(f) ? 'broken' : status(state, f.id)
}

function statusAllows(a: RuntimeAction, st: DerivedStatus | 'broken'): boolean {
  const needsBroken = a.requires?.includes('broken') ?? false
  if (st === 'broken') return needsBroken || (a.statuses.includes('broken') ?? false)
  if (needsBroken) return false
  return a.statuses.includes(st)
}

// computed on first use: module cycles (movement <-> activation) must not run imported code at load time
let compassCache: number[] | null = null
const compass = (): number[] => (compassCache ??= [0, 1, 2, 3, 4, 5, 6, 7].map((k) => normaliseAngle((k * Math.PI) / 4)))

function ammoNeed(state: GameState, weaponId: string): number | null {
  const w = state.data.weapons[weaponId]
  if (!w) return null
  for (const p of w.profiles) if (p.ammo !== null) return p.ammo
  return null
}

function weaponHasTrait(state: GameState, weaponId: string, trait: string): boolean {
  return state.data.weapons[weaponId]?.profiles.some((p) => p.traits.some((t) => t.trait === trait)) ?? false
}

const T_PLENTIFUL = 'core.t.plentiful'
const T_SCARCE = 'core.t.scarce'
const T_SINGLE = 'core.t.single-shot'

/** Weapons a fighter could Reload now (Out of Ammo, not Scarce or Single Shot unless an ammo cache is near, R-8.11). */
function reloadable(state: GameState, f: Fighter): { weaponId: string; need: number; auto: boolean; bonus: number; cache: string | null }[] {
  const cache = ammoCacheNear(state, f)
  const bonus = cache ? constants(state).casket.ammoCache.ammoBonus : 0
  const out: { weaponId: string; need: number; auto: boolean; bonus: number; cache: string | null }[] = []
  for (const w of f.weapons) {
    if (w.ammo !== 'out') continue
    const need = ammoNeed(state, w.weaponId)
    if (need === null) continue
    if (!cache && (weaponHasTrait(state, w.weaponId, T_SCARCE) || weaponHasTrait(state, w.weaponId, T_SINGLE))) continue
    out.push({ weaponId: w.weaponId, need, auto: weaponHasTrait(state, w.weaponId, T_PLENTIFUL), bonus, cache })
  }
  return out
}

/** The action menu of a fighter: option payloads for every offered action plus the reasons for absent ones. */
export function actionMenu(state: GameState, fighterId: string): ActionMenu {
  const f = getFighter(state, fighterId)
  const act = state.action.activation
  const st = menuStatus(state, f)
  const options: MenuOption[] = []
  const withheld: Withheld[] = []
  const base = { fighterId, status: st, actionsLeft: act?.actionsLeft ?? 0, canTurn: act?.canTurn ?? false }
  if (!act || act.fighterId !== fighterId) return { ...base, options, withheld }
  const add = (key: string, payload: Choose, data?: Record<string, unknown>, suffix = '') =>
    options.push({ id: suffix ? `${key}:${suffix}` : key, payload, ...(data ? { data } : {}) })
  // a Blind fighter makes no attacks until its next activation (R-3.11)
  const blind = f.conditions.blind !== undefined
  let shootOpts: AttackOption[] | null = null
  const shootable = () => (shootOpts ??= blind ? [] : attackOptions(state, f, 'shoot', act.actionsLeft))

  let reach: ReturnType<typeof reachFights> | null = null
  const reachable = () => (reach ??= blind || st !== 'standingActive' ? [] : reachFights(state, f))
  for (const a of Object.values(state.data.actions)) {
    // ending the activation is always possible, except that a Broken fighter must Run for Cover when it can (below)
    if (a.id === 'end') {
      add('end', { action: 'end' })
      continue
    }
    // a Standing Active fighter with a Versatile weapon may Fight an enemy within its reach (R-14.3)
    const versatileFight = a.id === 'fight' && st === 'standingActive' && reachable().length > 0
    if (!statusAllows(a, st) && !versatileFight) continue
    if (!IMPLEMENTED_ACTIONS.has(a.id)) {
      withheld.push({ action: a.id, reason: 'later' })
      continue
    }
    const verdict = economy(act, a)
    if (verdict !== 'ok') {
      withheld.push({ action: a.id, reason: verdict })
      continue
    }
    const before = options.length
    switch (a.id) {
      case 'move':
        add('move', { action: 'move' }, { maxInches: maxInchesFor(state, f, 'move') })
        break
      case 'takeCover':
        add('takeCover', { action: 'takeCover' }, { maxInches: maxInchesFor(state, f, 'takeCover') })
        break
      case 'crawl':
        add('crawl', { action: 'crawl' }, { maxInches: halfMove(state, f) })
        break
      case 'standUp':
        add('standUp', { action: 'standUp' })
        break
      case 'turn': {
        for (const facing of compass()) {
          if (Math.abs(normaliseAngle(facing - f.facing)) < 0.01) continue
          add('turn', { action: 'turn', facing }, undefined, String(facing))
        }
        for (const e of onBoard(state).filter((g) => g.seat !== f.seat)) {
          const facing = normaliseAngle(Math.atan2(e.pos.x - f.pos.x, e.pos.z - f.pos.z))
          if (Math.abs(normaliseAngle(facing - f.facing)) < 0.01) continue
          add('turn', { action: 'turn', facing, targetId: e.id }, undefined, `face:${e.id}`)
        }
        break
      }
      case 'reload':
        for (const r of reloadable(state, f)) {
          const chance = r.auto ? 1 : d6SumChance(r.bonus, r.need)
          add('reload', { action: 'reload', weaponId: r.weaponId }, { need: r.need, bonus: r.bonus, chance, plentiful: r.auto }, r.weaponId)
        }
        break
      case 'operateDoor':
        for (const d of operableDoors(state, f)) add('operateDoor', { action: 'operateDoor', doorId: d.doorId }, { to: d.to }, d.doorId)
        break
      case 'accessTerminal':
        for (const t of terminalsNear(state, f)) {
          const t2 = constants(state).terminal
          add('accessTerminal', { action: 'accessTerminal', terminalId: t.terminalId }, { doorId: t.doorId, chance: twoD6TestChance(stat(state, f.id, 'Int'), t2.modifier) }, t.terminalId)
        }
        break
      case 'forceDoor':
        for (const doorId of lockedDoorsNear(state, f)) {
          const k = constants(state).forceDoor
          const helpers = doorHelpers(state, f, doorId).length
          const bonus = stat(state, f.id, 'S') + k.helperBonus * helpers
          add('forceDoor', { action: 'forceDoor', doorId }, { helpers, chance: d6SumChance(bonus, k.target), need: k.target - bonus }, doorId)
        }
        break
      case 'crawlDuct':
        for (const d of ductChoices(state, f)) add('crawlDuct', { action: 'crawlDuct', ductId: d.ductId, spot: d.spot }, { from: d.from, exit: d.exit }, `${d.ductId}:${d.spot.x},${d.spot.z}`)
        break
      case 'smashCasket':
      case 'bypassCasket':
        if (mayOpenCaskets(state, f)) {
          for (const id of casketsNear(state, f, ['closed'])) {
            const k = constants(state).casket.smash
            const data =
              a.id === 'smashCasket'
                ? { chance: d6SumChance(stat(state, f.id, 'S'), k.target), contentsModifier: k.contentsModifier }
                : { chance: twoD6TestChance(stat(state, f.id, 'Int')) }
            add(a.id, { action: a.id, casketId: id }, data, id)
          }
        }
        break
      case 'carryCasket':
        for (const id of casketsNear(state, f, ['closed', 'opened', 'ammoCache'])) add('carryCasket', { action: 'carryCasket', casketId: id }, { maxInches: moveAllowance(state, f) }, id)
        break
      case 'shoot': {
        const opts = shootable()
        if (opts.length > 0) add('shoot', { action: 'shoot' }, { weapons: opts.length, targets: Math.max(...opts.map((o) => o.targets)) })
        break
      }
      case 'aim': {
        // Aim helps a later Shoot this activation: it needs a second action and a weapon a Basic Shoot can use
        if (act.actionsLeft < 2) {
          withheld.push({ action: a.id, reason: 'needsTwo' })
          continue
        }
        if (act.aimed || act.performed.some((p) => p.action === 'shoot')) break
        if (shootable().some((o) => o.cost === 'basic' && !o.template)) add('aim', { action: 'aim' }, { modifier: constants(state).hitModifiers.aim })
        break
      }
      case 'blindFire': {
        const opts = blind ? [] : attackOptions(state, f, 'blindFire', act.actionsLeft)
        if (opts.length > 0) add('blindFire', { action: 'blindFire' }, { weapons: opts.length, modifier: constants(state).hitModifiers.blindFire })
        break
      }
      case 'fireDuct':
        if (blind) break
        for (const d of ductFireChoices(state, f)) {
          const opts = attackOptions(state, f, 'fireDuct', act.actionsLeft, d.ductId)
          if (opts.length > 0) add('fireDuct', { action: 'fireDuct', ductId: d.ductId }, { targets: d.targets, need: constants(state).hitModifiers.ductway }, d.ductId)
        }
        break
      case 'charge':
        if (blind) break
        for (const c of chargeTargets(state, f)) {
          const data = { pReach: c.pReach, cost: c.cost, visible: c.visible, distance: c.distance, ...(c.weaponId ? { weaponId: c.weaponId } : {}) }
          add('charge', { action: 'charge', targetId: c.targetId, ...(c.weaponId ? { weaponId: c.weaponId } : {}) }, data, c.weaponId ? `${c.targetId}:${c.weaponId}` : c.targetId)
        }
        break
      case 'fight':
        if (blind) break
        if (st === 'standingEngaged') add('fight', { action: 'fight' }, { targets: f.engagedWith.length })
        else for (const r of reachable()) add('fight', { action: 'fight', weaponId: r.weaponId }, { targets: r.targets.length, reach: true }, r.weaponId)
        break
      case 'retreat': {
        const need = stat(state, f.id, 'I')
        add('retreat', { action: 'retreat' }, { need, chance: d6TestChance(need), engagedWith: f.engagedWith.length })
        break
      }
      case 'coupDeGrace':
        for (const t of coupDeGraceTargets(state, f)) add('coupDeGrace', { action: 'coupDeGrace', targetId: t.id }, undefined, t.id)
        break
      case 'runForCover':
        add('runForCover', { action: 'runForCover' }, { engaged: f.engagedWith.length > 0 })
        break
    }
    if (options.length === before) withheld.push({ action: a.id, reason: 'noTarget' })
  }
  // actions granted by skills (Headbutt, Hurl, Overseer, Immovable Stance, Unleash the Beast, Somersault)
  const granted = skillMenu(state, f, act, st, blind)
  options.push(...granted.options)
  withheld.push(...granted.withheld)
  // R-12.3: Running for Cover is mandatory for a Broken fighter; it may only end the activation when it cannot run
  if (st === 'broken' && options.some((o) => o.payload.action === 'runForCover')) {
    const at = options.findIndex((o) => o.payload.action === 'end')
    if (at >= 0) options.splice(at, 1)
    withheld.push({ action: 'end', reason: 'mandatory' })
  }
  return { ...base, options, withheld }
}

// ---------------------------------------------------------------------------
// Raising the decisions
// ---------------------------------------------------------------------------

function raiseChoose(ctx: Ctx): void {
  refreshEngagement(ctx)
  const s = ctx.state
  const act = s.action.activation!
  const f = getFighter(s, act.fighterId)
  const menu = actionMenu(s, f.id)
  const options: OptionInput[] = menu.options.map((o) => ({
    id: o.id,
    labelKey: `action.choose.${o.payload.action}`,
    type: 'action.choose',
    payload: o.payload,
    ...(o.data ? { data: o.data } : {}),
  }))
  ctx.raise({
    kind: 'action.choose',
    seat: f.seat,
    window: 'action.declared',
    context: { fighterId: f.id, status: menu.status, actionsLeft: act.actionsLeft, canTurn: act.canTurn, performed: act.performed.map((p) => p.action), withheld: menu.withheld },
    options,
  })
}

function raiseActivate(ctx: Ctx, seat: Seat, only?: string[]): void {
  const s = ctx.state
  const ids = only ?? readyFighters(s, seat).map((f) => f.id)
  ctx.raise({
    kind: 'action.activate',
    seat,
    window: 'action.phaseStart',
    context: { turn: seat, round: s.round, group: s.action.group ? { leaderId: s.action.group.leaderId, remaining: ids } : null },
    options: ids.map((fighterId) => ({ id: fighterId, labelKey: 'action.activate', type: 'action.activate' as const, payload: { fighterId } })),
  })
}

/** Ready friends of the leader within the group radius (path), not yet nominated (R-5.5). */
function groupCandidates(state: GameState, leader: Fighter, nominated: readonly string[]): Fighter[] {
  const radius = constants(state).radii.groupActivation
  return readyFighters(state, leader.seat).filter((f) => f.id !== leader.id && !nominated.includes(f.id) && withinPath(state, leader, f, radius))
}

/** Group Activation (X), plus the Commanding Presence skill's +1. */
export function groupSize(state: GameState, f: Fighter): number {
  const base = f.rules.find((r) => r.id === GROUP_RULE)?.x ?? 0
  const cp = skillOf(state, f, 'commandingPresence')
  return base + (cp ? numParam(cp.params, 'groupActivation', 1) : 0)
}

function raiseGroup(ctx: Ctx, leader: Fighter): void {
  const s = ctx.state
  const g = s.action.group!
  const x = groupSize(s, leader)
  const cands = groupCandidates(s, leader, g.members)
  ctx.raise({
    kind: 'action.group',
    seat: leader.seat,
    window: 'activation.groupNominated',
    context: { leaderId: leader.id, max: x, nominated: g.members.slice(), left: x - g.members.length },
    options: [
      ...cands.map((c) => ({ id: c.id, labelKey: 'action.group.nominate', type: 'action.group' as const, payload: { fighterId: c.id } })),
      { id: 'done', labelKey: 'action.group.done', type: 'action.group' as const, payload: { done: true as const } },
    ],
  })
}

// ---------------------------------------------------------------------------
// Phase and turn flow
// ---------------------------------------------------------------------------

/** Enter the Action phase (called by the Priority phase once everyone is Ready). */
export function beginActionPhase(ctx: Ctx): void {
  const s = ctx.state
  s.phase = 'action'
  s.action = { turn: s.priority, activation: null, group: null, flightDone: [] }
  ctx.emit({ type: 'PhaseStarted', name: 'action' }, null)
  // R-13.4: a bottled gang may leave the battlefield before the first activation
  if (raiseFlee(ctx)) return
  nextTurn(ctx, null)
}

// ---------------------------------------------------------------------------
// Voluntary flight (R-13.4)
// ---------------------------------------------------------------------------

/** Fighters that may leave: on the battlefield and not Seriously Injured. */
function flightCandidates(state: GameState, seat: Seat): Fighter[] {
  return seatFighters(state, seat).filter((f) => f.posture !== 'seriouslyInjured')
}

/**
 * Ask the next bottled seat (Priority player first) which fighters leave, one at a time; `{ done }` ends a seat's flight. Seats
 * that are not bottled or have nobody eligible are marked done without a decision. True when a decision was raised.
 */
function raiseFlee(ctx: Ctx): boolean {
  const s = ctx.state
  const order: Seat[] = [s.priority ?? 'A', otherSeat(s.priority ?? 'A')]
  for (const seat of order) {
    if (s.action.flightDone.includes(seat)) continue
    const cands = s.players[seat].bottled ? flightCandidates(s, seat) : []
    if (cands.length === 0) {
      s.action.flightDone.push(seat)
      continue
    }
    ctx.raise({
      kind: 'action.flee',
      seat,
      window: 'action.phaseStart',
      context: { round: s.round, eligible: cands.map((f) => f.id) },
      options: [
        { id: 'done', labelKey: 'action.flee.done', type: 'action.flee', payload: { done: true } },
        ...cands.map((f) => {
          const engaged = f.engagedWith.length > 0
          const need = stat(s, f.id, 'I')
          return { id: f.id, labelKey: 'action.flee.leave', type: 'action.flee' as const, payload: { fighterId: f.id }, data: { engaged, ...(engaged ? { need, chance: d6TestChance(need) } : {}) } }
        }),
      ],
    })
    return true
  }
  return false
}

function handleFlee(state: GameState, action: Action): Handled {
  if (action.type !== 'action.flee') return reject('E_WRONG_DECISION', `expected action.flee, got ${action.type}`)
  const p = action.payload
  return {
    run(ctx) {
      const s = ctx.state
      const seat = action.seat
      if (p.done || !p.fighterId) {
        s.action.flightDone.push(seat)
      } else {
        const f = getFighter(s, p.fighterId)
        if (f.engagedWith.length > 0) {
          // R-13.4: an Engaged fighter must pass an Initiative test or is left Seriously Injured instead
          const need = stat(s, f.id, 'I')
          const roll = ctx.roll('fleeInitiative', 1)[0]!
          const passed = d6TestPasses(roll, need)
          ctx.emit({ type: 'InitiativeTest', fighterId: f.id, roll, need, passed, reason: 'flee' }, f.seat)
          if (passed) fleeFighter(ctx, f, true)
          else seriouslyInjure(ctx, f, null, 'flee')
        } else fleeFighter(ctx, f, true)
      }
      if (s.phase === 'ended') return
      refreshEngagement(ctx)
      if (s.nerve.length > 0) {
        settleNerve(ctx, { kind: 'reraise', seat: s.priority ?? 'A' })
        return
      }
      if (!raiseFlee(ctx)) nextTurn(ctx, null)
    },
  }
}


function seatToAct(state: GameState, justActed: Seat | null): Seat | null {
  const first = justActed ? otherSeat(justActed) : (state.priority ?? 'A')
  if (readyFighters(state, first).length > 0) return first
  const second = otherSeat(first)
  if (readyFighters(state, second).length > 0) return second
  return null
}

function nextTurn(ctx: Ctx, justActed: Seat | null): void {
  const s = ctx.state
  // a locked Smash & Grab win is put to its winner before the next activation (M-3.9 ruling)
  if (lockedConfirmDue(s)) {
    raiseLockedConfirm(ctx, justActed)
    return
  }
  const seat = seatToAct(s, justActed)
  if (!seat) {
    endActionPhase(ctx)
    return
  }
  s.action.turn = seat
  raiseActivate(ctx, seat)
}

function endActionPhase(ctx: Ctx): void {
  const s = ctx.state
  runHook('phase.end', { seat: s.priority ?? 'A', state: s, engine: ctx, data: { name: 'action' } })
  ctx.emit({ type: 'PhaseEnded', name: 'action' }, null)
  s.action.turn = null
  runEndPhase(ctx)
}

/** What happens after an activation has ended: the rest of the group, or the next seat's turn. */
function afterActivation(ctx: Ctx, f: Fighter): void {
  const s = ctx.state
  const g = s.action.group
  if (g) {
    if (!g.done.includes(f.id)) g.done.push(f.id)
    const remaining = g.members.filter((id) => !g.done.includes(id) && s.fighters[id]!.ready && s.fighters[id]!.location === 'board')
    if (remaining.length > 0) {
      raiseActivate(ctx, g.seat, remaining)
      return
    }
    s.action.group = null
  }
  nextTurn(ctx, f.seat)
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function startActivation(ctx: Ctx, f: Fighter, leaderId?: string, order?: { overseerId: string }): void {
  const s = ctx.state
  // an Overseer's order activates the fighter whether or not it is Ready, and leaves its Ready status as it was (restored at the end)
  const orderedFrom = order ? { ready: f.ready, activated: f.activatedThisRound } : undefined
  f.ready = false
  f.activatedThisRound = true
  s.action.turn = f.seat
  s.action.activation = {
    fighterId: f.id,
    seat: f.seat,
    actionsLeft: 2,
    performed: [],
    canTurn: f.posture === 'standing',
    aimed: false,
    charged: false,
    turnedToFace: false,
    ...(leaderId ? { groupLeaderId: leaderId } : {}),
    ...(order ? { orderedBy: order.overseerId, orderedFrom: orderedFrom! } : {}),
    declared: null,
    casualtyMark: s.casualties.length,
  }
  ctx.emit({ type: 'FighterActivated', fighterId: f.id, ...(leaderId ? { group: true } : {}), ...(order ? { orderedBy: order.overseerId } : {}) }, f.seat)
  expireEffects(ctx, `startOfActivation:${f.id}`)
  runHook('activation.start', { seat: f.seat, state: s, engine: ctx, fighterId: f.id })
  // M-4.5 (Forgotten Riches): a fighter alone in the dark may lose actions or its life
  const allowed = horrorsCheck(ctx, f, s.action.activation!.actionsLeft)
  if (allowed !== s.action.activation!.actionsLeft) {
    s.action.activation!.actionsLeft = allowed
    s.action.activation!.allowance = allowed
  }
  if (f.location !== 'board') {
    endActivation(ctx)
    return
  }
  const x = leaderId || order ? 0 : groupSize(s, f)
  if (x > 0 && groupCandidates(s, f, []).length > 0) {
    if (hasSkill(s, f, 'commandingPresence')) markFired('commandingPresence')
    s.action.group = { leaderId: f.id, seat: f.seat, members: [], done: [] }
    raiseGroup(ctx, f)
    return
  }
  beginActions(ctx, f)
}

/** After activation (and any group nomination): a burning fighter's activation is the Blaze sequence, otherwise the menu. */
function beginActions(ctx: Ctx, f: Fighter): void {
  // no actions left to take (Horrors in the Dark): the activation is over
  if (ctx.state.action.activation!.actionsLeft <= 0) {
    endActivation(ctx)
    return
  }
  if (f.conditions.blaze) blazeActivation(ctx, f)
  else raiseChoose(ctx)
}

/**
 * R-3.13: a burning fighter takes no normal actions. (1) It suffers a S3 AP -1 Damage 1 hit; (2) Engaged or Seriously Injured
 * it does not move, Pinned it becomes Active, and an Active one moves 2D6" in a random direction and then (ruling) always
 * chooses to become Pinned; (3) D6 + 2 if Pinned + 1 per friendly Active fighter within 1": on 6+ the flames go out; (4) the
 * activation ends.
 */
function blazeActivation(ctx: Ctx, f: Fighter): void {
  const s = ctx.state
  const k = constants(s).blaze
  resolveHit(ctx, {
    attackerId: null,
    targetId: f.id,
    weaponId: null,
    strength: k.strength,
    ap: k.ap,
    damage: { kind: 'fixed', value: k.damage },
    traits: [],
    hitRoll: null,
    knockFrom: null,
    melta: false,
    saveVs: null,
    coverBonus: 0,
    from: null,
    saves: true,
    cause: 'blaze',
  })
  refreshEngagement(ctx)
  if (f.location === 'board') {
    if (f.engagedWith.length === 0 && f.posture !== 'seriouslyInjured') {
      if (f.posture === 'pinned') {
        f.posture = 'standing'
        ctx.emit({ type: 'StatusChanged', fighterId: f.id, from: 'pinned', to: 'standing', reason: 'blaze' }, f.seat)
      }
      blazeMove(ctx, f)
      refreshEngagement(ctx)
      if (f.posture === 'standing' && f.engagedWith.length === 0) {
        f.posture = 'pinned'
        ctx.emit({ type: 'StatusChanged', fighterId: f.id, from: 'standing', to: 'pinned', reason: 'blaze' }, f.seat)
      }
    }
    const friends = onBoard(s).filter((g) => g.seat === f.seat && g.id !== f.id && status(s, g.id) === 'standingActive' && withinPath(s, f, g, k.friendRadius))
    const bonus = (f.posture === 'pinned' ? k.pinnedBonus : 0) + friends.length * k.friendBonus
    const roll = ctx.roll('extinguish', 1)[0]!
    if (roll + bonus >= k.extinguishTarget) clearCondition(ctx, f, 'blaze', 'extinguished')
  }
  settleNerve(ctx, { kind: 'endActivation' })
}

/** The locked result was answered with 'continue': play carries on with the turn that was interrupted. */
export function resumeAfterConfirm(ctx: Ctx, justActed: Seat | null): void {
  nextTurn(ctx, justActed)
}

export function endActivation(ctx: Ctx): void {
  const s = ctx.state
  const act = s.action.activation!
  const f = getFighter(s, act.fighterId)
  ctx.emit({ type: 'ActivationEnded', fighterId: f.id, actionsUsed: (act.allowance ?? 2) - act.actionsLeft }, f.seat)
  runHook('activation.end', { seat: f.seat, state: s, engine: ctx, fighterId: f.id })
  // Naaargah!: whether or not the third action was won, the fighter ends the activation Pinned (no skill can stop it)
  if (act.naaargah === 'pinned' && f.location === 'board' && f.posture === 'standing') {
    f.posture = 'pinned'
    ctx.emit({ type: 'StatusChanged', fighterId: f.id, from: 'standing', to: 'pinned', reason: 'naaargah' }, f.seat)
    ctx.emit({ type: 'FighterPinned', fighterId: f.id }, f.seat)
  }
  expireEffects(ctx, 'activation')
  // an ordered fighter's Ready status is as it was before the order (a Broken fighter stays unready)
  if (act.orderedFrom && f.location === 'board' && !isBroken(f)) {
    f.ready = act.orderedFrom.ready
    f.activatedThisRound = act.orderedFrom.activated
  }
  s.action.activation = null
  refreshEngagement(ctx)
  // an Overseer's order passed its Leadership test: the ordered fighter activates at once, then the turn carries on as the Overseer's would
  const order = s.action.order
  if (order && !act.orderedBy) {
    s.action.order = null
    const target = s.fighters[order.targetId]
    if (target && target.location === 'board' && f.location === 'board') {
      startActivation(ctx, target, undefined, { overseerId: order.overseerId })
      return
    }
  }
  afterActivation(ctx, act.orderedBy ? (s.fighters[act.orderedBy] ?? f) : f)
}

/**
 * Naaargah!: after its two actions the fighter may try for a third by passing a Toughness test (`skill.choice`); it ends the
 * activation Pinned either way. True when the decision was raised.
 */
function offerNaaargah(ctx: Ctx, f: Fighter): boolean {
  const s = ctx.state
  const act = s.action.activation!
  if (act.naaargah || act.allowance !== undefined || f.location !== 'board' || f.posture === 'seriouslyInjured' || isBroken(f) || f.conditions.blaze) return false
  if (!hasSkill(s, f, 'naaargah')) return false
  act.naaargah = 'declined'
  const need = stat(s, f.id, 'T')
  ctx.raise({
    kind: 'skill.choice',
    seat: f.seat,
    window: 'action.resolved',
    context: { skill: 'naaargah', fighterId: f.id },
    options: [
      { id: 'attempt', labelKey: 'skill.naaargah.attempt', type: 'skill.choice', payload: { option: 'attempt' }, data: { need, chance: Math.min(6, Math.max(0, need)) / 6 } },
      { id: 'decline', labelKey: 'skill.decline', type: 'skill.choice', payload: { option: 'decline' } },
    ],
  })
  return true
}

/**
 * Pay for a resolved action, record it, and carry on: the next menu, or the end of the activation when nothing is left.
 * `type` overrides the catalogue cost (an Unwieldy weapon makes Shoot a Double action, R-14.3).
 */
export function payAndContinue(ctx: Ctx, f: Fighter, key: string, turnAfter = false, type?: ActionCostType): void {
  const s = ctx.state
  const act = s.action.activation!
  const a = type ? { ...actionDef(s, key)!, type } : actionDef(s, key)!
  // R-4.1: a free turn comes before the first action and right after a move; any other action closes it
  act.canTurn = turnAfter
  act.performed.push({ action: key, type: a.type })
  act.actionsLeft -= costOf(a)
  act.declared = null
  ctx.emit({ type: 'ActionResolved', fighterId: f.id, action: key }, f.seat)
  refreshEngagement(ctx)
  continueActivation(ctx)
}

/** After an action: settle the nerve tests it caused (R-12.1), then the next menu or the end of the activation. */
export function continueActivation(ctx: Ctx): void {
  const s = ctx.state
  if (s.nerve.length > 0 && !s.attack) {
    settleNerve(ctx, { kind: 'continue' })
    return
  }
  const act = s.action.activation
  if (!act) {
    resumeFlow(ctx, s.action.turn ?? s.priority ?? 'A')
    return
  }
  const f = getFighter(s, act.fighterId)
  refreshEngagement(ctx)
  if (f.location === 'board' && act.actionsLeft <= 0 && offerNaaargah(ctx, f)) return
  if (f.location !== 'board' || act.actionsLeft <= 0) endActivation(ctx)
  else raiseChoose(ctx)
}

/**
 * Re-raise whatever decision comes next after an out-of-band interruption (nerve tests settled outside an action): the active
 * fighter's menu, the rest of a group, or the next activation starting with `seat`.
 */
export function resumeFlow(ctx: Ctx, seat: Seat): void {
  const s = ctx.state
  if (s.phase !== 'action') return
  const act = s.action.activation
  if (act) {
    const f = getFighter(s, act.fighterId)
    if (f.location === 'board' && act.actionsLeft <= 0 && offerNaaargah(ctx, f)) return
    if (f.location !== 'board' || act.actionsLeft <= 0) endActivation(ctx)
    else raiseChoose(ctx)
    return
  }
  // voluntary flight (R-13.4) interrupted by nerve tests carries on before the first activation
  if (!s.action.group && s.action.flightDone.length < 2 && raiseFlee(ctx)) return
  const g = s.action.group
  if (g) {
    const remaining = g.members.filter((id) => !g.done.includes(id) && s.fighters[id]!.ready && s.fighters[id]!.location === 'board')
    if (remaining.length > 0) {
      raiseActivate(ctx, g.seat, remaining)
      return
    }
    s.action.group = null
  }
  const first = readyFighters(s, seat).length > 0 ? seat : otherSeat(seat)
  if (readyFighters(s, first).length === 0) {
    endActionPhase(ctx)
    return
  }
  s.action.turn = first
  raiseActivate(ctx, first)
}

function declare(ctx: Ctx, f: Fighter, key: string, params?: Record<string, unknown>): void {
  const act = ctx.state.action.activation!
  const a = actionDef(ctx.state, key)!
  act.declared = { action: key, ...(params ? { params } : {}) }
  ctx.emit({ type: 'ActionDeclared', fighterId: f.id, action: key, actionType: a.type }, f.seat)
}

/** For skill actions (skills/actions.ts): the same declaration the core actions make. */
export const declareAction = declare

/** A `move.path` was answered: apply the posture change of the kind, then pay and continue. */
export function completeAction(ctx: Ctx, f: Fighter, kind: VoluntaryKind, _plan: Extract<MovePlan, { ok: true }>): void {
  const s = ctx.state
  const act = s.action.activation!
  const declared = act.declared
  switch (kind) {
    case 'move':
      payAndContinue(ctx, f, 'move', f.posture === 'standing')
      return
    case 'takeCover':
      f.posture = 'pinned'
      ctx.emit({ type: 'StatusChanged', fighterId: f.id, from: 'standing', to: 'pinned', reason: 'takeCover' }, f.seat)
      payAndContinue(ctx, f, 'takeCover')
      return
    case 'crawl':
      payAndContinue(ctx, f, 'crawl')
      return
    case 'carry': {
      const casketId = declared?.params?.casketId as string | undefined
      if (casketId) placeCarried(ctx, f, casketId)
      payAndContinue(ctx, f, 'carryCasket', f.posture === 'standing')
      return
    }
  }
}

/** The player cancelled a declared action before anything was rolled: no action is spent. */
export function cancelDeclared(ctx: Ctx): void {
  const act = ctx.state.action.activation!
  const f = getFighter(ctx.state, act.fighterId)
  if (act.declared) ctx.emit({ type: 'ActionCancelled', fighterId: f.id, action: act.declared.action }, f.seat)
  act.declared = null
  raiseChoose(ctx)
}

// ---------------------------------------------------------------------------
// Resolving the chosen action
// ---------------------------------------------------------------------------

function resolveReload(ctx: Ctx, f: Fighter, weaponId: string): void {
  const s = ctx.state
  const fw = f.weapons.find((w) => w.weaponId === weaponId)!
  const info = reloadable(s, f).find((r) => r.weaponId === weaponId)!
  let passed: boolean
  let roll = 0
  let result = 'plentiful'
  if (info.auto) {
    passed = true
  } else {
    roll = ctx.roll('reload', 1)[0]!
    passed = roll + info.bonus >= info.need
    result = passed ? 'reloaded' : 'failed'
    if (info.cache && roll === constants(s).casket.ammoCache.exhaustedOn) {
      s.board.caskets[info.cache]!.state = 'exhausted'
      result += ',cacheExhausted'
    }
  }
  ctx.emit({ type: 'AmmoTest', fighterId: f.id, weaponId, roll, need: info.need, passed, result }, f.seat)
  if (passed) {
    // the weapon and its ammunition upgrades share one ammo state (ruling); jammed and spent ones stay as they are
    for (const id of linkedWeaponIds(f, weaponId)) {
      const w = f.weapons.find((x) => x.weaponId === id)!
      if (w !== fw && w.ammo !== 'out') continue
      w.ammo = 'ok'
      ctx.emit({ type: 'WeaponStateChanged', fighterId: f.id, weaponId: id, ammo: 'ok' }, f.seat)
    }
  }
}

function handleChoose(state: GameState, action: Action): Handled {
  if (action.type !== 'action.choose') return reject('E_WRONG_DECISION', `expected action.choose, got ${action.type}`)
  const p = action.payload
  const act = state.action.activation!
  const fid = act.fighterId
  switch (p.action) {
    case 'end':
      return { run: (ctx) => endActivation(ctx) }
    case 'turn':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          const a = ctx.state.action.activation!
          const from = f.facing
          f.facing = normaliseAngle(p.facing ?? f.facing)
          a.canTurn = false
          if (f.engagedWith.length > 0) a.turnedToFace = true
          ctx.emit({ type: 'FighterTurned', fighterId: f.id, from, to: f.facing, free: true }, f.seat)
          raiseChoose(ctx)
        },
      }
    case 'move':
    case 'takeCover':
    case 'crawl':
    case 'carryCasket':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          const kind = (p.action === 'carryCasket' ? 'carry' : p.action) as VoluntaryKind
          declare(ctx, f, p.action, { kind, ...(p.casketId ? { casketId: p.casketId } : {}) })
          raiseMovePath(ctx, f, kind, p.casketId ? { casketId: p.casketId } : {})
        },
      }
    case 'standUp':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'standUp')
          f.posture = 'standing'
          ctx.emit({ type: 'StatusChanged', fighterId: f.id, from: 'pinned', to: 'standing', reason: 'standUp' }, f.seat)
          payAndContinue(ctx, f, 'standUp', true)
        },
      }
    case 'reload':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'reload', { weaponId: p.weaponId })
          resolveReload(ctx, f, p.weaponId!)
          payAndContinue(ctx, f, 'reload')
        },
      }
    case 'operateDoor':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'operateDoor', { doorId: p.doorId })
          operateDoor(ctx, f, p.doorId!)
          payAndContinue(ctx, f, 'operateDoor')
        },
      }
    case 'accessTerminal':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          const door = ctx.state.board.def.doors.find((d) => d.terminals.some((t) => t.id === p.terminalId))!
          declare(ctx, f, 'accessTerminal', { terminalId: p.terminalId })
          accessTerminal(ctx, f, p.terminalId!, door.id)
          payAndContinue(ctx, f, 'accessTerminal')
        },
      }
    case 'forceDoor':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'forceDoor', { doorId: p.doorId })
          forceDoor(ctx, f, p.doorId!)
          payAndContinue(ctx, f, 'forceDoor')
        },
      }
    case 'crawlDuct':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'crawlDuct', { ductId: p.ductId })
          const choice = ductChoices(ctx.state, f).find((d) => d.ductId === p.ductId && d.spot.x === p.spot!.x && d.spot.z === p.spot!.z)!
          crawlDuct(ctx, f, choice)
          payAndContinue(ctx, f, 'crawlDuct', true)
        },
      }
    case 'smashCasket':
    case 'bypassCasket':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, p.action, { casketId: p.casketId })
          if (p.action === 'smashCasket') smashCasket(ctx, f, p.casketId!)
          else bypassCasket(ctx, f, p.casketId!)
          payAndContinue(ctx, f, p.action)
        },
      }
    case 'shoot':
    case 'blindFire':
    case 'fireDuct':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, p.action, p.ductId ? { ductId: p.ductId } : undefined)
          startRangedAttack(ctx, f, p.action as 'shoot' | 'blindFire' | 'fireDuct', p.ductId)
        },
      }
    case 'aim':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'aim')
          ctx.state.action.activation!.aimed = true
          payAndContinue(ctx, f, 'aim')
        },
      }
    case 'charge':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'charge', { targetId: p.targetId, ...(p.weaponId ? { weaponId: p.weaponId } : {}) })
          startCharge(ctx, f, p.targetId!, p.weaponId)
        },
      }
    case 'fight':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'fight', p.weaponId ? { weaponId: p.weaponId } : undefined)
          startFight(ctx, f, p.weaponId)
        },
      }
    case 'retreat':
    case 'runForCover':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, p.action)
          startEscape(ctx, f, p.action as 'retreat' | 'runForCover')
        },
      }
    case 'coupDeGrace':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fid)
          declare(ctx, f, 'coupDeGrace', { targetId: p.targetId })
          coupDeGrace(ctx, f, p.targetId!, false)
          payAndContinue(ctx, f, 'coupDeGrace')
        },
      }
    default:
      return handleSkillAction(state, fid, p) ?? reject('E_TODO', `${p.action} is not implemented yet`)
  }
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function handleActivate(state: GameState, action: Action): Handled {
  if (action.type !== 'action.activate') return reject('E_WRONG_DECISION', `expected action.activate, got ${action.type}`)
  const id = action.payload.fighterId
  return {
    run(ctx) {
      const f = getFighter(ctx.state, id)
      const g = ctx.state.action.group
      startActivation(ctx, f, g && g.members.includes(id) ? g.leaderId : undefined)
    },
  }
}

function handleGroup(state: GameState, action: Action): Handled {
  if (action.type !== 'action.group') return reject('E_WRONG_DECISION', `expected action.group, got ${action.type}`)
  const p = action.payload
  return {
    run(ctx) {
      const s = ctx.state
      const g = s.action.group!
      const leader = getFighter(s, g.leaderId)
      if (p.fighterId) g.members.push(p.fighterId)
      const x = groupSize(s, leader)
      const more = !p.done && g.members.length < x && groupCandidates(s, leader, g.members).length > 0
      if (more) {
        raiseGroup(ctx, leader)
        return
      }
      if (g.members.length > 0) ctx.emit({ type: 'GroupNominated', leaderId: leader.id, fighterIds: g.members.slice() }, leader.seat)
      else s.action.group = null
      beginActions(ctx, leader)
    },
  }
}

function explainChoose(state: GameState, p: Choose): Rejection | null {
  const act = state.action.activation
  if (!act) return null
  const f = getFighter(state, act.fighterId)
  const a = state.data.actions[p.action] ?? (f.skills.some((id) => state.data.skills[id]?.action?.id === p.action) ? skillActionDef(state, p.action) : undefined)
  if (!a) return rejection('E_NOT_AN_OPTION', `unknown action ${p.action}`)
  const st = menuStatus(state, f)
  if (!statusAllows(a, st)) return rejection('E_ACTION_RESTRICTED', `${a.name} is not available to a fighter that is ${st}`)
  const verdict = economy(act, a)
  if (verdict === 'noActions' || verdict === 'needsTwo') return rejection('E_NO_ACTIONS', `${a.name} costs more actions than are left (${act.actionsLeft})`)
  if (verdict === 'repeat') return rejection('E_ACTION_RESTRICTED', `${a.name} cannot be repeated in one activation`)
  if (verdict === 'noTurn') return rejection('E_ACTION_RESTRICTED', 'the fighter can no longer turn for free')
  if (state.data.actions[a.id] && !IMPLEMENTED_ACTIONS.has(a.id)) return rejection('E_TODO', `${a.name} is not implemented yet`)
  if (p.action === 'operateDoor' && p.doorId) {
    const rec = state.board.doors[p.doorId]
    if (rec?.state === 'closed' && rec.locked) return rejection('E_ACTION_RESTRICTED', 'that door is locked: use a terminal or force it open')
    if (!rec || rec.state === 'destroyed') return rejection('E_INVALID_TARGET', 'there is no door to operate')
  }
  const menu = actionMenu(state, f.id)
  const sameAction = menu.options.some((o) => o.payload.action === p.action)
  return rejection(sameAction ? 'E_INVALID_TARGET' : 'E_OUT_OF_RANGE', sameAction ? `${a.name} cannot be done that way` : `${a.name} has nothing in reach`)
}

function explain(state: GameState, action: Action, pending: PendingDecision): Rejection | null {
  switch (action.type) {
    case 'action.choose':
      return explainChoose(state, action.payload)
    case 'action.activate': {
      const f = state.fighters[action.payload.fighterId]
      if (!f) return rejection('E_INVALID_TARGET', `unknown fighter ${action.payload.fighterId}`)
      if (f.seat !== pending.seat) return rejection('E_INVALID_TARGET', `${f.id} is not on seat ${pending.seat}`)
      if (!f.ready) return rejection('E_ACTION_RESTRICTED', `${f.id} is not Ready`)
      if (state.action.group) return rejection('E_ACTION_RESTRICTED', `${f.id} is not part of the group in progress`)
      return null
    }
    case 'action.group': {
      const id = action.payload.fighterId
      const g = state.action.group
      if (!id || !g) return null
      const f = state.fighters[id]
      const leader = state.fighters[g.leaderId]!
      if (!f || f.seat !== leader.seat) return rejection('E_INVALID_TARGET', `${id} is not a friendly fighter`)
      if (!f.ready || f.location !== 'board') return rejection('E_INVALID_TARGET', `${id} is not Ready`)
      if (g.members.includes(id)) return rejection('E_INVALID_TARGET', `${id} is already nominated`)
      if (!withinPath(state, leader, f, constants(state).radii.groupActivation)) return rejection('E_OUT_OF_RANGE', `${id} is more than ${constants(state).radii.groupActivation}" from the leader`)
      return null
    }
    default:
      return null
  }
}

export const activationModule: ModuleDef = {
  id: 'activation',
  namespaces: ['action'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'action.activate':
        return handleActivate(state, action)
      case 'action.group':
        return handleGroup(state, action)
      case 'action.flee':
        return handleFlee(state, action)
      case 'action.choose':
        return handleChoose(state, action)
      default:
        return reject('E_TODO', `${pending.kind} is not implemented yet `)
    }
  },
  explain,
}

