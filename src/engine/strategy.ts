// STR: strategy.* (R-2). Initiative roll-off with the tie rule, CP gain, ready all, gambit alternation.
import { startFirefight } from './firefight'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { otherSeat, SEATS } from './state'
import type { Action, GameState, RuntimeGambit, Seat } from './types'
// M2b-game
import { refreshFlags } from './abilities'
import { smokeReady } from './core-hooks'
import { removeEffects } from './effects'
import { runHook } from './hooks'
import { restoreTurningPointWeapons } from './equipment'
import { onTurningPointStart } from './missions'
import { findGambit, gambitOffers, openOpponentUsedWindow, usePloy } from './ploys'
import { providerInitiativeReroll, providerReadyStepChoices } from './team-rules'

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
    // M9 prep: the per-TP action history starts again
    if (op.actionsThisTp) op.actionsThisTp = []
  }
  // M2b-game: per-TP ledgers, transmitting, Harpoon and "until the start of the next TP" effects reset
  // M9 batch B shared fix: per-TP use counts (Purity Seals, Tilting Shields, Tesla Weave, Magnification Conduits, Phase
  // Shifter, the High-Intensity Markerlight and team-limited weapons) start again too; only `limit:` keys reset before
  for (const seat of SEATS) {
    s.ledger[seat].tp = []
    s.ledger[seat].tpUses = {}
  }
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

function handleRoll(state: GameState, action: Action): Handled {
  if (action.type !== 'strategy.initiative') return reject('E_WRONG_DECISION', 'expected an initiative roll')
  const reroll = (action.payload as { reroll?: unknown }).reroll
  const asking = state.strategy.rolls.A !== undefined && state.strategy.rolls.B !== undefined
  if (asking && typeof reroll !== 'boolean') return reject('E_SCHEMA', 'answer the re-roll offer with reroll true or false')
  return {
    run(ctx) {
      const s = ctx.state
      const seat = action.seat
      if (asking) {
        // M9 batch B: a team rule's initiative re-roll (Writ of Claim), once per seat per TP
        if (reroll === true) {
          for (const p of providerInitiativeReroll(s, seat)) p.onInitiativeReroll?.(ctx, seat)
          const [v] = ctx.roll('strategy.initiative.reroll', 1)
          s.strategy.rolls[seat] = v!
        }
        resolveRolls(ctx)
        return
      }
      const [v] = ctx.roll('strategy.initiative', 1)
      s.strategy.rolls[seat] = v!
      const { A, B } = s.strategy.rolls
      if (A === undefined || B === undefined) {
        raiseInitiativeRoll(ctx, otherSeat(seat))
        return
      }
      resolveRolls(ctx)
    },
  }
}

/** Both dice are rolled: offer any initiative re-roll a team rule allows (M9 batch B), then the result or the tie. */
function resolveRolls(ctx: Ctx): void {
  const s = ctx.state
  const { A, B } = s.strategy.rolls as { A: number; B: number }
  for (const seat of SEATS) {
    if ((s.strategy.rerollAsked ?? []).includes(seat)) continue
    if (providerInitiativeReroll(s, seat).length === 0) continue
    s.strategy.rerollAsked = [...(s.strategy.rerollAsked ?? []), seat]
    ctx.raise({
      kind: 'strategy.initiative',
      seat,
      window: 'turningPoint.start',
      context: { rolls: { A, B }, holder: s.initiative, reroll: true },
      options: [
        { id: 'reroll', labelKey: 'strategy.rerollInitiative', type: 'strategy.initiative', payload: { reroll: true } },
        { id: 'keep', labelKey: 'strategy.keepInitiative', type: 'strategy.initiative', payload: { reroll: false } },
      ],
    })
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
  // M9 prep: Ready-step team rules (Living Metal, Reanimation Protocols, Tesseract Cube) before CP and readying
  runHook('turningPoint.start', { seat: holder, state: s, engine: ctx, data: { turningPoint: s.turningPoint } })
  for (const seat of SEATS) {
    const gain = s.turningPoint === 1 ? 1 : seat === holder ? 1 : 2
    const p = s.players[seat]
    p.cp += gain
    ctx.emit({ type: 'CpChanged', delta: gain, cp: p.cp, reason: 'strategy' }, seat)
  }
  const ids: string[] = []
  // operatives out of the killzone but still activating (HIDING, reserve.ts) are readied too
  for (const op of Object.values(s.operatives)) {
    if (op.status !== 'active' && !(op.status === 'reserve' && op.offboard !== undefined)) continue
    op.ready = true
    ids.push(op.id)
  }
  ctx.emit({ type: 'OperativesReadied', operativeIds: ids }, null)
  smokeReady(ctx)
  // batch C shared: Ready-step choices of team rules (orders, picks), the initiative holder first
  s.strategy.readyChoices = [holder, otherSeat(holder)]
  nextReadyChoice(ctx)
}

/**
 * batch C shared: ask the next seat for its Ready-step choices (team-rules `readyStepChoices`) as one ability.choice
 * (context.readyStep). A chosen offer's code hook `choice` runs and then calls readyChoiceDone; the same seat is asked
 * again until it has no offer or passes. Then the Gambit step starts.
 */
function nextReadyChoice(ctx: Ctx): void {
  const s = ctx.state
  const queue = s.strategy.readyChoices ?? []
  while (queue.length > 0) {
    const seat = queue[0]!
    const offers = providerReadyStepChoices(s, seat)
    if (offers.length > 0) {
      ctx.raise({
        kind: 'ability.choice',
        seat,
        window: 'turningPoint.start',
        context: { hook: 'readyStep', readyStep: true, offers },
        options: offers.map((r, i) => ({
          id: `ready:${i}`,
          labelKey: r.labelKey,
          type: 'ability.choice' as const,
          payload: { option: String(i) },
          data: { hook: r.hook, operativeId: r.operativeId, ...(r.data ?? {}) },
        })),
        canPass: true,
      })
      return
    }
    queue.shift()
  }
  delete s.strategy.readyChoices
  const holder = s.initiative!
  s.strategy.step = 'gambit'
  s.strategy.gambit = { turn: holder, passes: 0, used: { A: [], B: [] } }
  advanceGambit(ctx)
}

/** batch C shared: a Ready-step choice is finished (`passed`: the seat declined, so it is not asked again). */
export function readyChoiceDone(ctx: Ctx, passed = false): void {
  const queue = ctx.state.strategy.readyChoices
  if (passed && queue) queue.shift()
  nextReadyChoice(ctx)
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
    gambitPassedHook(ctx, g.turn, false)
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
        gambitPassedHook(ctx, action.seat, true)
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
      ;(g.order ??= []).push({ seat, gambitId: gambit.id })
      // a gambit may start decisions of its own (SSSSHHHH! free Dashes); they resume the step
      if (s.pending) return
      // M9 batch B: the other seat may answer the gambit (Devious Scheme); the step resumes afterwards
      if (openOpponentUsedWindow(ctx, seat, gambit.id, 'gambit')) return
      advanceGambit(ctx)
    },
  }
}

/** M9 batch B: run the gambit.passed hooks (Cunning). */
function gambitPassedHook(ctx: Ctx, seat: Seat, explicit: boolean): void {
  const g = ctx.state.strategy.gambit
  runHook('gambit.passed', { seat, state: ctx.state, engine: ctx, data: { explicit, usedThisStep: [...(g.order ?? [])], passes: g.passes } })
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
