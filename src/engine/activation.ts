// ACT module: owns `action.*`. The Action phase (R-5.4 to R-5.6): turn alternation starting with the Priority player, the
// run-out when one side has no Ready fighters left, activation, group activation as a chain (`action.group` nominates, then
// `action.activate` offers only the group), the action menu keyed by the derived status (R-6.3) with Simple / Basic / Double /
// Free accounting (R-6.1), the free turn (R-4.1), and the end of an activation. Actions whose rules arrive later (Charge,
// Shoot, Aim, Fight, Retreat, Coup de Grace, Blind Fire, Fire Through Ductway, Running for Cover) are withheld, not offered.
import { d6SumChance, twoD6TestChance } from './dice'
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
import { constants, getFighter, isBroken, onBoard, otherSeat, readyFighters } from './state'
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
import type {
  Action,
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

const COMPASS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => normaliseAngle((k * Math.PI) / 4))

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

  for (const a of Object.values(state.data.actions)) {
    // ending the activation is always possible (a Broken fighter's only other action, Running for Cover, arrives in S3b)
    if (a.id === 'end') {
      add('end', { action: 'end' })
      continue
    }
    if (!statusAllows(a, st)) continue
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
        for (const facing of COMPASS) {
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
    }
    if (options.length === before) withheld.push({ action: a.id, reason: 'noTarget' })
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

function groupSize(f: Fighter): number {
  return f.rules.find((r) => r.id === GROUP_RULE)?.x ?? 0
}

function raiseGroup(ctx: Ctx, leader: Fighter): void {
  const s = ctx.state
  const g = s.action.group!
  const x = groupSize(leader)
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
  // TODO(S4): voluntary flight of a bottled seat (action.flee) is raised here
  nextTurn(ctx, null)
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

function startActivation(ctx: Ctx, f: Fighter, leaderId?: string): void {
  const s = ctx.state
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
    declared: null,
  }
  ctx.emit({ type: 'FighterActivated', fighterId: f.id, ...(leaderId ? { group: true } : {}) }, f.seat)
  expireEffects(ctx, `startOfActivation:${f.id}`)
  runHook('activation.start', { seat: f.seat, state: s, engine: ctx, fighterId: f.id })
  const x = leaderId ? 0 : groupSize(f)
  if (x > 0 && groupCandidates(s, f, []).length > 0) {
    s.action.group = { leaderId: f.id, seat: f.seat, members: [], done: [] }
    raiseGroup(ctx, f)
    return
  }
  raiseChoose(ctx)
}

export function endActivation(ctx: Ctx): void {
  const s = ctx.state
  const act = s.action.activation!
  const f = getFighter(s, act.fighterId)
  ctx.emit({ type: 'ActivationEnded', fighterId: f.id, actionsUsed: 2 - act.actionsLeft }, f.seat)
  runHook('activation.end', { seat: f.seat, state: s, engine: ctx, fighterId: f.id })
  expireEffects(ctx, 'activation')
  s.action.activation = null
  refreshEngagement(ctx)
  afterActivation(ctx, f)
}

/** Pay for a resolved action, record it, and carry on: the next menu, or the end of the activation when nothing is left. */
function payAndContinue(ctx: Ctx, f: Fighter, key: string, turnAfter = false): void {
  const s = ctx.state
  const act = s.action.activation!
  const a = s.data.actions[key]!
  // R-4.1: a free turn comes before the first action and right after a move; any other action closes it
  act.canTurn = turnAfter
  act.performed.push({ action: key, type: a.type })
  act.actionsLeft -= costOf(a)
  act.declared = null
  ctx.emit({ type: 'ActionResolved', fighterId: f.id, action: key }, f.seat)
  refreshEngagement(ctx)
  if (f.location !== 'board' || act.actionsLeft <= 0) endActivation(ctx)
  else raiseChoose(ctx)
}

function declare(ctx: Ctx, f: Fighter, key: string, params?: Record<string, unknown>): void {
  const act = ctx.state.action.activation!
  const a = ctx.state.data.actions[key]!
  act.declared = { action: key, ...(params ? { params } : {}) }
  ctx.emit({ type: 'ActionDeclared', fighterId: f.id, action: key, actionType: a.type }, f.seat)
}

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
    fw.ammo = 'ok'
    ctx.emit({ type: 'WeaponStateChanged', fighterId: f.id, weaponId, ammo: 'ok' }, f.seat)
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
    default:
      return reject('E_TODO', `${p.action} is not implemented yet`)
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
      const x = groupSize(leader)
      const more = !p.done && g.members.length < x && groupCandidates(s, leader, g.members).length > 0
      if (more) {
        raiseGroup(ctx, leader)
        return
      }
      if (g.members.length > 0) ctx.emit({ type: 'GroupNominated', leaderId: leader.id, fighterIds: g.members.slice() }, leader.seat)
      else s.action.group = null
      raiseChoose(ctx)
    },
  }
}

function explainChoose(state: GameState, p: Choose): Rejection | null {
  const act = state.action.activation
  if (!act) return null
  const f = getFighter(state, act.fighterId)
  const a = state.data.actions[p.action]
  if (!a) return rejection('E_NOT_AN_OPTION', `unknown action ${p.action}`)
  const st = menuStatus(state, f)
  if (!statusAllows(a, st)) return rejection('E_ACTION_RESTRICTED', `${a.name} is not available to a fighter that is ${st}`)
  const verdict = economy(act, a)
  if (verdict === 'noActions' || verdict === 'needsTwo') return rejection('E_NO_ACTIONS', `${a.name} costs more actions than are left (${act.actionsLeft})`)
  if (verdict === 'repeat') return rejection('E_ACTION_RESTRICTED', `${a.name} cannot be repeated in one activation`)
  if (verdict === 'noTurn') return rejection('E_ACTION_RESTRICTED', 'the fighter can no longer turn for free')
  if (!IMPLEMENTED_ACTIONS.has(a.id)) return rejection('E_TODO', `${a.name} is not implemented yet`)
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
      case 'action.choose':
        return handleChoose(state, action)
      default:
        return reject('E_TODO', `${pending.kind} is not implemented yet (voluntary flight arrives in S4)`)
    }
  },
  explain,
}

