// END module: owns `end.*`. The End phase (R-5.7, R-13) in order: (1) Bottle tests, Priority player first, with the voluntary
// failure; (2) Fleeing the battlefield of a bottled gang, Leaders then Champions then the rest, with Leading by Example;
// (3) Recovery tests of the fighters Seriously Injured, with assistance (`end.assist`) and the owner's pick between two dice
// (`end.recoveryPick`); (4) Rally tests of Broken fighters; then the clean-up (round effects, smoke clouds that roll 1-4 to
// clear and Concussion, both through the phase.end / round.end hooks of traits.ts) and the battle-end check of the scenario.
//
// The phase is a small state machine on `state.end`. Dice that involve no choice are rolled inside the step; a decision is
// raised only for the Bottle choice, assistance and the recovery pick. Nerve tests caused here (a recovery roll that takes a
// fighter Out of Action) are settled by the close-combat machinery with a `endPhase` resume (fight.ts `settleNerve`), so a
// fighter that breaks makes its Running for Cover before the Rally tests.
import { bottleInfo, fleeFighter, takeOutOfAction } from './casualties'
import { twoD6TestPasses, injuryFace } from './dice'
import { expireEffects } from './effects'
import { settleNerve } from './fight'
import { fleshWound } from './hits'
import { runHook } from './hooks'
import { withinPath } from './measure'
import { rallyInfo } from './morale'
import { beginRound } from './priority'
import { stat } from './query'
import { endGame, reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { checkBattleEnd, refreshSecured } from './scenarios'
import { constants, EngineInvariantError, getFighter, isBroken, onBoard, otherSeat } from './state'
import { clearCondition } from './traits'
import type { Action, Fighter, GameState, PendingDecision, Rejection, Seat } from './types'

const GROUP_LEADER_RULE = 'core.r.leading-by-example'

/** The battle ended during this step (a forfeit): stop the End phase. (A function, so the compiler does not narrow `phase`.) */
const over = (s: GameState): boolean => s.phase === 'ended'

export const priorityFirst = (s: GameState): Seat[] => [s.priority ?? 'A', otherSeat(s.priority ?? 'A')]

const rank = (f: Fighter): number => (f.role === 'leader' ? 0 : f.role === 'champion' ? 1 : 2)
const byRankThenId = (a: Fighter, b: Fighter): number => rank(a) - rank(b) || (a.id < b.id ? -1 : 1)

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** Start the End phase: the Bottle tests come first. */
export function runEndPhase(ctx: Ctx): void {
  const s = ctx.state
  s.phase = 'end'
  ctx.emit({ type: 'PhaseStarted', name: 'end' }, null)
  s.end = {
    step: 'bottle',
    bottleQueue: priorityFirst(s).filter((seat) => bottleInfo(s, seat).mustTest),
    fleeQueue: [],
    recoveryQueue: [],
    rallyQueue: [],
    assistsUsed: [],
    assistSeats: [],
    assists: {},
    pick: null,
  }
  advance(ctx)
}

/** Resume after something outside the step machine (nerve tests settled by the close-combat code) finished. */
export function continueEndPhase(ctx: Ctx): void {
  if (ctx.state.phase === 'end') advance(ctx)
}

function advance(ctx: Ctx): void {
  const s = ctx.state
  for (let guard = 0; guard < 50; guard++) {
    if (over(s)) return
    switch (s.end.step) {
      case 'bottle':
        if (s.end.bottleQueue.length > 0) {
          raiseBottle(ctx, s.end.bottleQueue[0]!)
          return
        }
        s.end.step = 'flee'
        break
      case 'flee':
        fleeStep(ctx)
        if (over(s)) return
        beginRecovery(ctx)
        break
      case 'recovery':
        if (recoveryStep(ctx)) return // a decision was raised
        if (s.nerve.length > 0) {
          // nerve tests the recoveries caused; the Rally step follows when they are done
          s.end.step = 'rally'
          settleNerve(ctx, { kind: 'endPhase' })
          return
        }
        s.end.step = 'rally'
        break
      case 'rally':
        rallyStep(ctx)
        s.end.step = 'cleanup'
        break
      case 'cleanup':
        cleanUp(ctx)
        return
      default:
        throw new EngineInvariantError(`End phase in step ${String(s.end.step)}`)
    }
  }
  throw new EngineInvariantError('the End phase did not settle')
}

// ---------------------------------------------------------------------------
// 1. Bottle tests (R-13.1)
// ---------------------------------------------------------------------------

function raiseBottle(ctx: Ctx, seat: Seat): void {
  const s = ctx.state
  const info = bottleInfo(s, seat)
  ctx.raise({
    kind: 'end.bottle',
    seat,
    window: 'end.bottle',
    context: { ...info },
    options: [
      { id: 'test', labelKey: 'end.bottle.test', type: 'end.bottle', payload: { choice: 'test' }, data: { down: info.down, crew: info.crew, need: info.need, chance: info.pBottle } },
      { id: 'bottle', labelKey: 'end.bottle.bottle', type: 'end.bottle', payload: { choice: 'bottle' }, data: { down: info.down, crew: info.crew, voluntary: true } },
    ],
  })
}

function handleBottle(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type !== 'end.bottle') return reject('E_WRONG_DECISION', `expected end.bottle, got ${action.type}`)
  const choice = action.payload.choice
  const seat = pending.seat
  return {
    run(ctx) {
      const s = ctx.state
      const info = bottleInfo(s, seat)
      let bottled: boolean
      let roll = 0
      const voluntary = choice === 'bottle'
      if (voluntary) bottled = true
      else {
        roll = ctx.roll('bottle', 1)[0]!
        bottled = roll + info.down > info.crew
      }
      ctx.emit({ type: 'BottleTest', seat, roll, down: info.down, crew: info.crew, bottled, voluntary }, seat)
      if (bottled) {
        s.players[seat].bottled = true
        s.players[seat].bottledVoluntarily = voluntary
      }
      s.end.bottleQueue.shift()
      advance(ctx)
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Fleeing the battlefield (R-13.2, R-13.3)
// ---------------------------------------------------------------------------

function hasLeadingByExample(f: Fighter): boolean {
  return f.rules.some((r) => r.id === GROUP_LEADER_RULE)
}

/** A Cool test without supporters (R-13.2): 2D6 against Cl with the rule modifiers. */
function plainCoolTest(ctx: Ctx, f: Fighter, purpose: string, reason: string): { roll: number; need: number; passed: boolean } {
  const s = ctx.state
  let modifier = 0
  for (const r of runHook('test.modify', { seat: f.seat, state: s, fighterId: f.id, data: { test: 'cool', reason } })) if (r.delta) modifier += r.delta
  const need = stat(s, f.id, 'Cl')
  const roll = ctx.roll(purpose, 1, '2d6')[0]!
  return { roll, need: need - modifier, passed: twoD6TestPasses(roll, need, modifier) }
}

/**
 * Every fighter of a bottled gang on the battlefield takes a Cool test whatever its status; failures flee and count as Out of
 * Action. The Leader is tested first and, passing, carries every friend within 12" through; a passing Champion carries the
 * friends within 6" that do not have Leading by Example themselves (R-13.3). Distances are by path (R-1.9 ruling).
 */
function fleeStep(ctx: Ctx): void {
  const s = ctx.state
  const k = constants(s).radii
  for (const seat of priorityFirst(s)) {
    if (!s.players[seat].bottled) continue
    const gang = onBoard(s)
      .filter((f) => f.seat === seat)
      .sort(byRankThenId)
    const saved = new Map<string, string>()
    for (const f of gang) {
      if (f.location !== 'board') continue
      const by = saved.get(f.id)
      if (by) {
        ctx.emit({ type: 'FleeTest', fighterId: f.id, roll: 0, need: 0, passed: true, auto: by }, seat)
        continue
      }
      const t = plainCoolTest(ctx, f, 'flee', 'flee')
      ctx.emit({ type: 'FleeTest', fighterId: f.id, roll: t.roll, need: t.need, passed: t.passed }, seat)
      if (!t.passed) {
        fleeFighter(ctx, f, false)
        if (over(s)) return
        continue
      }
      if (!hasLeadingByExample(f)) continue
      const leader = f.role === 'leader'
      const radius = leader ? k.leadingByExampleLeader : k.leadingByExampleChampion
      for (const g of gang) {
        if (g.id === f.id || g.location !== 'board' || saved.has(g.id)) continue
        if (!leader && hasLeadingByExample(g)) continue
        if (withinPath(s, f, g, radius)) saved.set(g.id, f.id)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Recovery tests (R-13.5 to R-13.7)
// ---------------------------------------------------------------------------

/** Friends that could assist `f` now: Standing Active, within 1" by path, not used this End phase (R-13.6). */
export function eligibleAssisters(state: GameState, f: Fighter): Fighter[] {
  const used = new Set([...state.end.assistsUsed, ...Object.values(state.end.assists)])
  const radius = constants(state).radii.assist
  return onBoard(state).filter(
    (g) => g.seat === f.seat && g.id !== f.id && !used.has(g.id) && g.posture === 'standing' && g.engagedWith.length === 0 && withinPath(state, f, g, radius),
  )
}

/** Fighters that are Seriously Injured at this point of the End phase, Priority player's first (R-13.7). */
function recoverers(s: GameState): Fighter[] {
  const out: Fighter[] = []
  for (const seat of priorityFirst(s)) {
    out.push(...onBoard(s).filter((f) => f.seat === seat && f.posture === 'seriouslyInjured').sort((a, b) => (a.id < b.id ? -1 : 1)))
  }
  return out
}

function beginRecovery(ctx: Ctx): void {
  const s = ctx.state
  s.end.step = 'recovery'
  s.end.recoveryQueue = recoverers(s).map((f) => f.id)
  s.end.assistSeats = priorityFirst(s).filter((seat) => s.end.recoveryQueue.some((id) => s.fighters[id]!.seat === seat))
  s.end.assists = {}
  s.end.pick = null
}

/** Assist requests, then the rolls. True when a decision was raised (the caller returns and waits). */
function recoveryStep(ctx: Ctx): boolean {
  const s = ctx.state
  // assistance, seat by seat
  while (s.end.assistSeats.length > 0) {
    const seat = s.end.assistSeats[0]!
    const pairs = s.end.recoveryQueue
      .map((id) => s.fighters[id]!)
      .filter((f) => f.seat === seat && !s.end.assists[f.id])
      .flatMap((f) => eligibleAssisters(s, f).map((a) => ({ recovering: f, assister: a })))
    if (pairs.length === 0) {
      s.end.assistSeats.shift()
      continue
    }
    ctx.raise({
      kind: 'end.assist',
      seat,
      window: 'end.recovery',
      context: { seat, recovering: [...new Set(pairs.map((p) => p.recovering.id))] },
      options: [
        ...pairs.map((p) => ({
          id: `${p.assister.id}>${p.recovering.id}`,
          labelKey: 'end.assist.pair',
          type: 'end.assist' as const,
          payload: { assisterId: p.assister.id, recoveringId: p.recovering.id },
          data: { assisterId: p.assister.id, recoveringId: p.recovering.id },
        })),
        { id: 'none', labelKey: 'end.assist.none', type: 'end.assist' as const, payload: { none: true as const } },
      ],
    })
    return true
  }
  return runRecoveries(ctx)
}

function severity(face: string): number {
  return face === 'fleshWound' ? 0 : face === 'seriouslyInjured' ? 1 : 2
}

/** Roll the queued recoveries; stops at a pick between two dice. True when that decision was raised. */
function runRecoveries(ctx: Ctx): boolean {
  const s = ctx.state
  while (s.end.recoveryQueue.length > 0) {
    if (over(s)) return false
    const id = s.end.recoveryQueue[0]!
    const f = s.fighters[id]!
    if (f.location !== 'board' || f.posture !== 'seriouslyInjured') {
      s.end.recoveryQueue.shift()
      continue
    }
    const assister = s.end.assists[id]
    const dice = ctx.roll('recovery', assister ? 2 : 1, 'injury')
    const faces = dice.map((d) => injuryFace(s, d) as string)
    if (assister && new Set(faces).size > 1) {
      s.end.pick = { fighterId: id, assisterId: assister, faces }
      ctx.raise({
        kind: 'end.recoveryPick',
        seat: f.seat,
        window: 'end.recovery',
        context: { fighterId: id, assisterId: assister, faces },
        options: faces
          .map((face, index) => ({ face, index }))
          .sort((a, b) => severity(a.face) - severity(b.face) || a.index - b.index)
          .map(({ face, index }) => ({ id: `die${index}`, labelKey: 'end.recoveryPick.die', type: 'end.recoveryPick' as const, payload: { index }, data: { face, index } })),
      })
      return true
    }
    applyRecovery(ctx, f, faces[0]!, faces, assister)
    s.end.recoveryQueue.shift()
  }
  return false
}

/**
 * R-13.5: Flesh Wound - a Flesh Wound (not when assisted) and the fighter is Pinned, recovered; Seriously Injured - it stays
 * down and takes a Flesh Wound (not when assisted); Out of Action - it is removed (nerve tests follow for its friends).
 */
function applyRecovery(ctx: Ctx, f: Fighter, face: string, faces: string[], assister?: string): void {
  ctx.emit({ type: 'RecoveryTest', fighterId: f.id, faces, applied: face, ...(assister ? { assistedBy: assister } : {}) }, f.seat)
  if (assister) ctx.state.end.assistsUsed.push(assister)
  if (face === 'outOfAction') {
    takeOutOfAction(ctx, f, null, 'recovery')
    return
  }
  if (!assister) fleshWound(ctx, f, null, 'recovery')
  if (f.location !== 'board') return
  if (face === 'fleshWound') {
    f.posture = 'pinned'
    ctx.emit({ type: 'StatusChanged', fighterId: f.id, from: 'seriouslyInjured', to: 'pinned', reason: 'recovery' }, f.seat)
  }
}

function handleAssist(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type !== 'end.assist') return reject('E_WRONG_DECISION', `expected end.assist, got ${action.type}`)
  const p = action.payload
  const seat = pending.seat
  return {
    run(ctx) {
      const s = ctx.state
      if (p.none || !p.assisterId || !p.recoveringId) s.end.assistSeats = s.end.assistSeats.filter((x) => x !== seat)
      else s.end.assists[p.recoveringId] = p.assisterId
      advance(ctx)
    },
  }
}

function handlePick(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type !== 'end.recoveryPick') return reject('E_WRONG_DECISION', `expected end.recoveryPick, got ${action.type}`)
  const pick = state.end.pick
  if (!pick) return reject('E_WRONG_DECISION', 'no recovery roll is waiting for a pick')
  const index = action.payload.index
  if (!Number.isInteger(index) || index < 0 || index >= pick.faces.length) return reject('E_NOT_AN_OPTION', 'no such die')
  void pending
  return {
    run(ctx) {
      const s = ctx.state
      const f = getFighter(s, pick.fighterId)
      applyRecovery(ctx, f, pick.faces[index]!, pick.faces, pick.assisterId)
      s.end.pick = null
      s.end.recoveryQueue.shift()
      advance(ctx)
    },
  }
}

// ---------------------------------------------------------------------------
// 4. Rally tests (R-13.8)
// ---------------------------------------------------------------------------

/**
 * Each Broken fighter takes a Cool test, +1 per friend within 3" that is not Broken and not Seriously Injured. The tests are
 * resolved together (ruling): everyone's support is counted before any fighter is cleared.
 */
function rallyStep(ctx: Ctx): void {
  const s = ctx.state
  const broken = priorityFirst(s).flatMap((seat) => onBoard(s).filter((f) => f.seat === seat && isBroken(f)).sort((a, b) => (a.id < b.id ? -1 : 1)))
  const infos = broken.map((f) => ({ f, info: rallyInfo(s, f) }))
  const rallied: Fighter[] = []
  for (const { f, info } of infos) {
    const total = ctx.roll('rally', 1, '2d6')[0]!
    const passed = twoD6TestPasses(total, info.need, info.modifier)
    ctx.emit({ type: 'RallyTest', fighterId: f.id, roll: total, need: info.need - info.modifier, passed }, f.seat)
    if (passed) rallied.push(f)
  }
  for (const f of rallied) clearCondition(ctx, f, 'broken', 'rally')
}

// ---------------------------------------------------------------------------
// Clean-up and the hand-over
// ---------------------------------------------------------------------------

function cleanUp(ctx: Ctx): void {
  const s = ctx.state
  s.end.step = 'cleanup'
  expireEffects(ctx, 'round')
  // smoke clouds roll to clear (1-4) and Concussion expires: hook handlers of traits.ts, run after the Rally tests
  runHook('phase.end', { seat: s.priority ?? 'A', state: s, engine: ctx, data: { name: 'end' } })
  ctx.emit({ type: 'PhaseEnded', name: 'end' }, null)
  runHook('round.end', { seat: s.priority ?? 'A', state: s, engine: ctx })
  ctx.emit({ type: 'RoundEnded', round: s.round }, null)
  s.end.step = null
  refreshSecured(s)
  if (checkBattleEnd(ctx)) return
  const max = s.origin.setup.options?.maxRounds
  if (max !== undefined && s.round >= max) {
    endGame(ctx, 'roundLimit')
    return
  }
  beginRound(ctx)
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

const rejection = (code: Rejection['code'], reason: string): Rejection => ({ code, reason })

export const endphaseModule: ModuleDef = {
  id: 'endphase',
  namespaces: ['end'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'end.bottle':
        return handleBottle(state, action, pending)
      case 'end.assist':
        return handleAssist(state, action, pending)
      case 'end.recoveryPick':
        return handlePick(state, action, pending)
      default:
        return reject('E_TODO', `${pending.kind} is not an End phase decision`)
    }
  },
  explain(_state, action) {
    if (action.type === 'end.assist') return rejection('E_INVALID_TARGET', 'that fighter cannot assist that recovery')
    if (action.type === 'end.recoveryPick') return rejection('E_NOT_AN_OPTION', 'pick one of the rolled dice')
    return null
  },
}
