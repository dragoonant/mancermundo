// STR: strategy.* (R-2). Initiative roll-off with the tie rule, CP gain, ready all, gambit alternation.
import { startFirefight } from './firefight'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { activeOps, otherSeat, SEATS } from './state'
import type { Action, GameState, RuntimeGambit, Seat } from './types'
// M2b-game
import { refreshFlags } from './abilities'
import { smokeReady } from './core-hooks'
import { removeEffects } from './effects'
import { restoreTurningPointWeapons } from './equipment'
import { onTurningPointStart } from './missions'
import { findGambit, gambitOffers, usePloy } from './ploys'

export const TURNING_POINTS = 4

/** Start a turning point: clear Guard, reset per-TP ledgers, then the Strategy phase begins with the roll-off. */
export function beginTurningPoint(ctx: Ctx): void {
  const s = ctx.state
  s.turningPoint += 1
  ctx.emit({ type: 'TurningPointStarted', number: s.turningPoint }, null)
  // R-2.6: Guard (and transmitting) end at the start of the next TP, before the Strategy phase.
  for (const op of Object.values(s.operatives)) {
    if (op.flags.guard) {
      op.flags.guard = false
      ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'turningPoint' }, op.seat)
    }
    op.flags.counteractedThisTP = false
  }
  // M2b-game: per-TP ledgers, transmitting, Harpoon and "until the start of the next TP" effects reset
  for (const seat of SEATS) s.ledger[seat].tp = []
  removeEffects(ctx, (e) => e.expires === 'turningPointStart')
  restoreTurningPointWeapons(s)
  onTurningPointStart(ctx)
  refreshFlags(s)
  s.phase = 'strategy'
  ctx.emit({ type: 'PhaseStarted', name: 'strategy' }, null)
  s.strategy = { step: 'initiative', rolls: {}, gambit: { turn: s.initiative ?? 'A', passes: 0, used: { A: [], B: [] } } }
  raiseInitiativeRoll(ctx, 'A')
}

function raiseInitiativeRoll(ctx: Ctx, seat: Seat): void {
  ctx.raise({
    kind: 'strategy.initiative',
    seat,
    window: 'turningPoint.start',
    context: { rolls: { ...ctx.state.strategy.rolls }, holder: ctx.state.initiative },
    options: [{ id: 'roll', labelKey: 'strategy.rollInitiative', type: 'strategy.initiative', payload: {} }],
  })
}

function handleRoll(_state: GameState, action: Action): Handled {
  if (action.type !== 'strategy.initiative') return reject('E_WRONG_DECISION', 'expected an initiative roll')
  return {
    run(ctx) {
      const s = ctx.state
      const seat = action.seat
      const [v] = ctx.roll('strategy.initiative', 1)
      s.strategy.rolls[seat] = v!
      const { A, B } = s.strategy.rolls
      if (A === undefined || B === undefined) {
        raiseInitiativeRoll(ctx, otherSeat(seat))
        return
      }
      if (A !== B) {
        decideInitiative(ctx, A > B ? 'A' : 'B')
        return
      }
      // R-2.1: on a tie the player who did not hold initiative decides (TP1: who lacked it in setup).
      const previous = s.initiative ?? 'A'
      const decider = otherSeat(previous)
      s.strategy.step = 'decide'
      ctx.raise({
        kind: 'strategy.decideInitiative',
        seat: decider,
        window: 'turningPoint.start',
        context: { rolls: { A, B }, tie: true },
        options: SEATS.map((x) => ({
          id: x,
          labelKey: x === decider ? 'strategy.initiativeSelf' : 'strategy.initiativeOpponent',
          type: 'strategy.decideInitiative' as const,
          payload: { seat: x },
        })),
      })
    },
  }
}

function handleDecide(_state: GameState, action: Action): Handled {
  if (action.type !== 'strategy.decideInitiative') return reject('E_WRONG_DECISION', 'expected an initiative decision')
  const holder = action.payload.seat
  return { run: (ctx) => decideInitiative(ctx, holder) }
}

function decideInitiative(ctx: Ctx, holder: Seat): void {
  const s = ctx.state
  s.initiative = holder
  ctx.emit({ type: 'InitiativeDecided', holder, setup: false }, holder)
  readyStep(ctx)
}

/** R-2.2: CP gain, then ready all operatives; then the Gambit step. */
function readyStep(ctx: Ctx): void {
  const s = ctx.state
  s.strategy.step = 'ready'
  const holder = s.initiative!
  for (const seat of SEATS) {
    const gain = s.turningPoint === 1 ? 1 : seat === holder ? 1 : 2
    const p = s.players[seat]
    p.cp += gain
    ctx.emit({ type: 'CpChanged', delta: gain, cp: p.cp, reason: 'strategy' }, seat)
  }
  const ids: string[] = []
  for (const op of activeOps(s)) {
    op.ready = true
    ids.push(op.id)
  }
  ctx.emit({ type: 'OperativesReadied', operativeIds: ids }, null)
  smokeReady(ctx)
  s.strategy.step = 'gambit'
  s.strategy.gambit = { turn: holder, passes: 0, used: { A: [], B: [] } }
  advanceGambit(ctx)
}

/** Strategic gambits the seat can use now: affordable, not already used this TP (R-2.4). */
export function availableGambits(state: GameState, seat: Seat): RuntimeGambit[] {
  const seen = new Set<string>()
  const out: RuntimeGambit[] = []
  for (const o of gambitOffers(state, seat)) {
    if (seen.has(o.gambitId)) continue
    seen.add(o.gambitId)
    out.push({ id: o.gambitId, name: o.name, cost: o.cost, ...(state.data.ploys?.[o.gambitId]?.team ? { teamId: state.data.ploys[o.gambitId]!.team! } : {}) })
  }
  return out
}

/** Continue the gambit step after a gambit's own decisions (SSSSHHHH! free Dashes) have been resolved. */
export function resumeGambit(ctx: Ctx): void {
  advanceGambit(ctx)
}

function advanceGambit(ctx: Ctx): void {
  const s = ctx.state
  const g = s.strategy.gambit
  // A seat with no usable gambit passes implicitly; the step ends after two passes in succession (R-2.3).
  while (g.passes < 2) {
    const avail = gambitOffers(s, g.turn)
    if (avail.length > 0) {
      ctx.raise({
        kind: 'strategy.gambit',
        seat: g.turn,
        window: 'strategy.gambit',
        context: { passes: g.passes },
        canPass: true,
        options: avail.map((o) => ({
          id: o.id,
          labelKey: 'strategy.gambit',
          type: 'strategy.gambit' as const,
          payload: { gambitId: o.gambitId, ...(o.param ? { param: o.param } : {}) },
          data: { cost: o.cost, name: o.name, ...(o.param ? { param: o.param } : {}), ...(o.via ? { via: o.via } : {}) },
        })),
      })
      return
    }
    ctx.emit({ type: 'GambitPassed' }, g.turn)
    g.passes += 1
    g.turn = otherSeat(g.turn)
  }
  s.strategy.step = 'done'
  ctx.emit({ type: 'PhaseEnded', name: 'strategy' }, null)
  startFirefight(ctx)
}

function handleGambit(state: GameState, action: Action): Handled {
  if (action.type === 'pass') {
    return {
      run(ctx) {
        const g = ctx.state.strategy.gambit
        ctx.emit({ type: 'GambitPassed' }, action.seat)
        g.passes += 1
        g.turn = otherSeat(g.turn)
        advanceGambit(ctx)
      },
    }
  }
  if (action.type !== 'strategy.gambit') return reject('E_WRONG_DECISION', 'expected a gambit choice')
  const seat = action.seat
  const gambit = state.data.gambits.find((g) => g.id === action.payload.gambitId)
  if (!gambit) return reject('E_NOT_AN_OPTION', 'unknown gambit')
  if (state.strategy.gambit.used[seat].includes(gambit.id) || state.ledger[seat].tp.includes(gambit.id)) {
    return reject('E_PLOY_USED', 'a gambit cannot be used twice in one turning point')
  }
  if (gambit.cost > state.players[seat].cp && !findGambit(state, seat, gambit.id, action.payload.param)) {
    return reject('E_INSUFFICIENT_CP', 'not enough CP')
  }
  const offer = findGambit(state, seat, gambit.id, action.payload.param)
  if (!offer) return reject('E_NOT_AN_OPTION', 'that gambit is not usable now')
  return {
    run(ctx) {
      const s = ctx.state
      const g = s.strategy.gambit
      if (!g.used[seat].includes(gambit.id)) g.used[seat].push(gambit.id)
      g.passes = 0
      g.turn = otherSeat(seat)
      usePloy(ctx, seat, offer, { window: 'strategy.gambit' })
      ctx.emit({ type: 'GambitUsed', gambitId: gambit.id })
      // a gambit may start decisions of its own (SSSSHHHH! free Dashes); they resume the step
      if (s.pending) return
      advanceGambit(ctx)
    },
  }
}

export const strategyModule: ModuleDef = {
  id: 'strategy',
  namespaces: ['strategy'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'strategy.initiative':
        return handleRoll(state, action)
      case 'strategy.decideInitiative':
        return handleDecide(state, action)
      case 'strategy.gambit':
        return handleGambit(state, action)
      default:
        return reject('E_TODO', `${pending.kind} is not implemented until M2b`)
    }
  },
}
