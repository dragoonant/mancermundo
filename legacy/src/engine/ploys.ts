// PLY: ploy.* - strategy ploys (STRATEGIC GAMBITs) and firefight ploys. The Strategy phase offers
// every usable gambit; firefight ploys open as `ploy.firefight` decisions at their timing window only
// when the seat can actually use one (docs/spec/00-architecture.md section 3). Command Re-roll and the
// re-roll windows belong to the attack modules (`dice.*` is routed to them). CP accounting is shared
// through effects.ts.
// first import on purpose: the leaf module is evaluated before anything that can cycle back into this file
import { ployRules, registerPloyRule, type PloyOffer, type PloyRule } from './ploy-rules'
import { continueRemovals, registerKillWindow, registerRemovalPauseCheck, registerRemovalWindow, resumeAttack } from './attack-common'
import { getCodeHook, type PloyOfferSeed, type PloyWindowInfo } from './code-hooks'
import { effectList } from './conditions'
import { evalCondition, hasKeyword, inScope } from './conditions'
import { addEffect, markUsedTp, spendCp, usedThisTp } from './effects'
import { refreshFlags } from './abilities'
import { canStartFreeAction, firefightResume, startFreeSequence } from './firefight'
import { registerFrameResume, registerWindowOpener } from './hooks'
import { resumeGambit } from './strategy'
import { reject, type Ctx, type Handled, type ModuleDef, type OptionInput } from './registry'
import { activeOps, otherSeat, SEATS } from './state'
import type { Condition, Effect, GameState, Operative, RuntimePloy, Seat, TimingWindowId } from './types'

export const COMMAND_REROLL = 'core.p.command-re-roll'

export function ployDef(state: GameState, id: string): RuntimePloy | undefined {
  return state.data.ploys?.[id]
}

export function windowsOf(p: RuntimePloy): string[] {
  return Array.isArray(p.window) ? p.window : [p.window]
}

function scopeOf(p: RuntimePloy): Effect['scope'] {
  return effectList(p.effect).find((e) => e.scope)?.scope
}

function codeName(p: RuntimePloy): string | undefined {
  return effectList(p.effect).find((e) => e.code)?.code
}

// PloyOffer, PloyRule and the rule registry live in the leaf module ploy-rules.ts (import-cycle safe)
export { registerPloyRule, type PloyOffer, type PloyRule }

/** Declarative cost changes: equipment `ployCost` effects such as Chapter Reliquaries. */
function declarativeCost(state: GameState, seat: Seat, ploy: RuntimePloy, info: PloyWindowInfo): number | null {
  for (const id of state.players[seat].equipment) {
    const e = state.data.equipment?.[id]
    for (const eff of effectList(e?.effect)) {
      const pc = eff.ployCost
      if (!pc || pc.ploy !== ploy.id) continue
      if (evalCondition(pc.when, { state, seat, ...(info.subjectId ? { subjectId: info.subjectId } : {}) })) return pc.cost
    }
  }
  return null
}

function priceOf(state: GameState, seat: Seat, ploy: RuntimePloy, seed: PloyOfferSeed, info: PloyWindowInfo): { cost: number; via?: string } {
  const base = basePriceOf(state, seat, ploy, seed, info)
  // M9 batch B: surcharges after every reduction (Devious Scheme)
  let extra = 0
  for (const r of ployRules()) extra += r.costSurcharge?.(state, seat, ploy, seed, info) ?? 0
  return extra > 0 ? { ...base, cost: base.cost + extra } : base
}

function basePriceOf(state: GameState, seat: Seat, ploy: RuntimePloy, seed: PloyOfferSeed, info: PloyWindowInfo): { cost: number; via?: string } {
  let cost = seed.cost ?? ploy.cost
  const decl = declarativeCost(state, seat, ploy, info)
  if (decl !== null && decl < cost) return { cost: decl, via: 'equipment' }
  for (const r of ployRules()) {
    const adj = r.costAdjust?.(state, seat, ploy, seed, info)
    if (adj && adj.cost < cost) {
      cost = adj.cost
      return { cost, via: adj.via }
    }
  }
  return { cost }
}

function ployUsable(state: GameState, seat: Seat, ploy: RuntimePloy, window: string, info: PloyWindowInfo): boolean {
  if (ploy.id === COMMAND_REROLL) return false
  if (ploy.team && ploy.team !== state.players[seat].teamId) return false
  if (!windowsOf(ploy).includes(window)) return false
  if (ploy.limit !== 'unlimited' && usedThisTp(state, seat, ploy.id)) return false
  if (window === 'firefight.actionDeclared' && beforeIsAfter(state, ploy, info)) return false
  return true
}

/**
 * M10 batch D shared: a "before or after an action" ploy (both firefight.actionDeclared and firefight.actionEnded,
 * Adjust Doctrine) is offered at a declaration only before the activation's first action: once an action is done,
 * "before the next action" is the same moment as the firefight.actionEnded offer it already had. Never in a
 * free-action frame (its activation's own windows cover it).
 */
function beforeIsAfter(state: GameState, ploy: RuntimePloy, info: PloyWindowInfo): boolean {
  if (!windowsOf(ploy).includes('firefight.actionEnded')) return false
  if (info.free === true) return true
  return (state.firefight.activation?.performed.length ?? 0) > 0
}

/** Operatives of the seat that the ploy's scope covers. */
function scopedOps(state: GameState, seat: Seat, ploy: RuntimePloy): Operative[] {
  const scope = scopeOf(ploy)
  return activeOps(state).filter((o) => o.seat === seat && (!scope || inScope(state, scope, seat, o)))
}

function whenCx(state: GameState, seat: Seat, info: PloyWindowInfo, subjectId?: string) {
  return {
    state,
    seat,
    ...(subjectId ? { subjectId } : {}),
    ...(info.actorId ? { actorId: info.actorId } : {}),
    ...(info.targetId ? { targetId: info.targetId } : {}),
    ...(info.weaponId ? { weaponId: info.weaponId } : {}),
    ...(info.action ? { action: info.action } : {}),
    ...(info.counteracting !== undefined ? { counteracting: info.counteracting } : {}),
    ...(info.attackFails !== undefined ? { attackFails: info.attackFails } : {}),
    ...(info.defenceFails !== undefined ? { defenceFails: info.defenceFails } : {}),
    ...(info.critRetained !== undefined ? { critRetained: info.critRetained } : {}),
  }
}

/** Is there anything for the ploy to act on right now? (Transhuman Physiology needs a normal success to upgrade.) */
function ployHasTarget(state: GameState, ploy: RuntimePloy, subject: Operative): boolean {
  for (const e of effectList(ploy.effect)) {
    const r = e.retainSuccess
    if (!r || r.withoutRolling) continue
    const side = sideOf(state, subject.id)
    if (!side) return false
    const from = r.from ?? 'fail'
    if (from === 'normal' && !side.dice.some((d) => d.kind === 'normal' && !d.used)) return false
    if (from === 'fail' && side.dice.filter((d) => d.kind === 'fail' && !d.used).length < 1 + (r.discardFails ?? 0)) return false
  }
  return true
}

function sideOf(state: GameState, opId: string) {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.def && seq.def.operativeId === opId) return seq.def
  if (seq.atk.operativeId === opId) return seq.atk
  return null
}

/** Apply a retainSuccess ploy effect to the subject's dice in the sequence now open (Transhuman Physiology). */
function applyRetain(state: GameState, opId: string, r: NonNullable<Effect['retainSuccess']>): void {
  const side = sideOf(state, opId)
  if (!side) return
  const from = r.from ?? 'fail'
  const usable = side.dice.filter((d) => !d.used)
  for (let n = 0; n < r.count; n++) {
    if (from === 'normal') {
      const d = usable.find((x) => x.kind === 'normal' && x.value !== null) ?? usable.find((x) => x.kind === 'normal')
      if (!d) return
      d.kind = r.kind
      d.tag = d.tag ?? 'ploy'
    } else {
      const fails = usable.filter((x) => x.kind === 'fail' && x.value !== null)
      const d = fails[0]
      if (!d) return
      d.value = null
      d.kind = r.kind
      d.tag = 'ploy'
      for (let k = 0; k < (r.discardFails ?? 0); k++) {
        const f = fails[k + 1]
        if (f) f.used = true
      }
    }
  }
}

/** Every usable (ploy, variant) the seat can pick at this timing. */
/** M9 batch B: firefight windows that name no subject operative (scope and `when` are checked over the seat's operatives). */
const SUBJECTLESS = ['firefight.opponentActionDeclared', 'firefight.beforeActivation', 'ploy.opponentUsed']

export function offersFor(state: GameState, seat: Seat, window: string, info: PloyWindowInfo): PloyOffer[] {
  const out: PloyOffer[] = []
  const want = window === 'strategy.gambit' ? 'strategy' : 'firefight'
  // M9 shared: the Firefight phase start is a phase-level timing: strategy and firefight ploys may both name it, and
  // they are offered like gambits (no window subject; scope and `when` checked over the seat's operatives)
  // M9 batch B: windows with no subject operative are offered the same way (firefight ploys only)
  const subjectless = SUBJECTLESS.includes(window)
  const phaseLevel = window === 'firefight.start' || subjectless
  for (const ploy of Object.values(state.data.ploys ?? {})) {
    if ((phaseLevel ? (subjectless ? ploy.type !== 'firefight' : ploy.type !== 'strategy' && ploy.type !== 'firefight') : ploy.type !== want) || !ployUsable(state, seat, ploy, window, info)) continue
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    const when = ploy.when as Condition | undefined
    // free-action ploys (KRUMP 'EM!) name any one operative of their scope; every other firefight ploy names the window subject
    const freeAction = effectList(ploy.effect).find((e) => e.extraAction && e.extraAction.action !== 'any')?.extraAction
    let subjects: (Operative | undefined)[]
    if (want === 'firefight' && !phaseLevel) {
      if (subject) subjects = [subject]
      else if (freeAction) {
        subjects = scopedOps(state, seat, ploy).filter((o) => canStartFreeAction(state, { operativeId: o.id, action: freeAction.action as 'fight' | 'shoot' | 'dash', resume: '' }))
      } else continue
      subjects = subjects.filter((o): o is Operative => !!o && o.seat === seat)
      const scope = scopeOf(ploy)
      subjects = subjects.filter((o) => (!scope || inScope(state, scope, seat, o!)) && evalCondition(when, whenCx(state, seat, info, o!.id)) && ployHasTarget(state, ploy, o!))
      if (subjects.length === 0) continue
    } else {
      // strategy ploys need an operative their scope covers; subject conditions need one that satisfies them
      if (scopeOf(ploy) && scopedOps(state, seat, ploy).length === 0) continue
      if (when) {
        if (!evalCondition(when, whenCx(state, seat, info))) continue
        const cands = scopedOps(state, seat, ploy)
        if (!cands.some((c) => evalCondition(when, whenCx(state, seat, info, c.id)))) continue
      }
      subjects = [undefined]
    }
    const code = codeName(ploy)
    const hook = code ? getCodeHook(code) : undefined
    // the incapacitation window is newer than the teams' own before-removal choices: a code ploy is offered there
    // only when its hook says how (ploy.offers / apply), so a team that asks from its own hook is not asked twice
    if (window === 'operative.incapacitated' && code && !hook?.ploy) continue
    for (const sub of subjects) {
      const winfo = sub && !info.subjectId ? { ...info, subjectId: sub.id } : info
      const seeds: PloyOfferSeed[] = hook?.ploy ? hook.ploy.offers(state, seat, ploy, winfo) : [{}]
      for (const raw of seeds) {
        const seed: PloyOfferSeed = sub && !info.subjectId && !raw.operativeId ? { ...raw, operativeId: sub.id } : raw
        const { cost, via } = priceOf(state, seat, ploy, seed, winfo)
        if (cost > state.players[seat].cp) continue
        const operativeId = seed.operativeId ?? (want === 'firefight' ? sub?.id : undefined)
        out.push({
          id: `${ploy.id}${seed.param ? `:${seed.param}` : ''}${!info.subjectId && seed.operativeId ? `@${seed.operativeId}` : ''}`,
          ployId: ploy.id,
          name: ploy.name,
          ...(seed.param ? { param: seed.param } : {}),
          ...(operativeId ? { operativeId } : {}),
          cost,
          ...(via ? { via } : {}),
          seed,
        })
      }
    }
  }
  for (const r of ployRules()) {
    for (const o of r.extraOffers?.(state, seat, window, info) ?? []) {
      if (o.cost <= state.players[seat].cp && !out.some((x) => x.id === o.id)) out.push(o)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Using a ploy
// ---------------------------------------------------------------------------

function expiryFor(eff: Effect, ploy: RuntimePloy): string {
  switch (eff.duration) {
    case 'turningPoint':
      return 'turningPoint'
    case 'action':
      return 'action'
    case 'activation':
      return 'activation'
    default:
      return ploy.type === 'strategy' ? 'turningPoint' : 'action'
  }
}

export function usePloy(ctx: Ctx, seat: Seat, offer: PloyOffer, info: PloyWindowInfo): void {
  const s = ctx.state
  const ploy = ployDef(s, offer.ployId)
  if (ploy) {
    spendCp(ctx, seat, offer.cost, offer.ployId)
    if (ploy.limit !== 'unlimited') markUsedTp(s, seat, ploy.id)
    ctx.emit({ type: 'PloyUsed', ployId: ploy.id }, seat)
    for (const r of ployRules()) r.onUsed?.(ctx, seat, offer, info)
    for (const eff of effectList(ploy.effect)) applyEffect(ctx, seat, ploy, eff, offer, info)
  } else {
    // a plain gambit with no ploy record (synthetic fixtures) or an equipment option: only the CP is spent
    spendCp(ctx, seat, offer.cost, offer.ployId)
    for (const r of ployRules()) r.onUsed?.(ctx, seat, offer, info)
  }
  refreshFlags(ctx.state)
}

function applyEffect(ctx: Ctx, seat: Seat, ploy: RuntimePloy, eff: Effect, offer: PloyOffer, info: PloyWindowInfo): void {
  if (eff.code) {
    const hook = getCodeHook(eff.code)
    hook?.ploy?.apply(ctx, seat, ploy, offer.seed, info)
    return
  }
  if (eff.move) {
    // SSSSHHHH!: eligible Kommandos take a free Dash, one after another
    const queue = scopedOps(ctx.state, seat, ploy)
      .filter((o) => evalCondition(ploy.when as Condition | undefined, whenCx(ctx.state, seat, info, o.id)))
      .map((o) => o.id)
    startFreeSequence(ctx, { kind: 'dash', resume: 'ploy.freeMoves', queue })
    return
  }
  if (eff.extraAction) {
    // KRUMP 'EM! and Wrath of Vengeance are handled by their own hooks/rules when they carry extra data; a plain
    // free action granted to the named operative runs as a free sequence.
    const who = offer.operativeId ?? info.subjectId
    if (who && eff.extraAction.action !== 'any') startFreeSequence(ctx, { kind: eff.extraAction.action as 'fight' | 'shoot' | 'dash', resume: 'ploy.freeAction', queue: [who] })
    else if (who && info.counteracting) {
      const act = ctx.state.firefight.activation
      if (act) {
        act.bonus = (act.bonus ?? 0) + eff.extraAction.count
        act.used = [...(act.used ?? []), 'wrath']
      }
    }
    return
  }
  if (eff.retainSuccess && !eff.trigger) {
    // used in a window: acts on the dice now on the table
    const who = offer.operativeId ?? info.subjectId
    if (who) applyRetain(ctx.state, who, eff.retainSuccess)
    return
  }
  // declarative modifiers last for a window (turning point, action, activation)
  addEffect(ctx, {
    source: ploy.id,
    seat,
    kind: 'ploy',
    ...(offer.operativeId ? { operativeId: offer.operativeId } : {}),
    expires: expiryFor(eff, ploy),
    data: { effect: eff },
  })
}

// ---------------------------------------------------------------------------
// Strategy phase: the gambit step
// ---------------------------------------------------------------------------

export interface GambitOffer extends PloyOffer {
  /** gambit id as carried in the strategy.gambit payload */
  gambitId: string
}

/** Every STRATEGIC GAMBIT the seat can use now. */
export function gambitOffers(state: GameState, seat: Seat): GambitOffer[] {
  const info: PloyWindowInfo = { window: 'strategy.gambit' }
  const out: GambitOffer[] = offersFor(state, seat, 'strategy.gambit', info).map((o) => ({ ...o, gambitId: o.ployId }))
  // gambits without a ploy record (synthetic fixtures)
  for (const g of state.data.gambits) {
    if (state.data.ploys?.[g.id]) continue
    if (g.teamId && g.teamId !== state.players[seat].teamId) continue
    if (usedThisTp(state, seat, g.id) || state.strategy.gambit.used[seat].includes(g.id)) continue
    if (g.cost > state.players[seat].cp) continue
    out.push({ id: g.id, ployId: g.id, gambitId: g.id, name: g.name, cost: g.cost, seed: {} })
  }
  return out
}

export function findGambit(state: GameState, seat: Seat, gambitId: string, param?: string): GambitOffer | undefined {
  return gambitOffers(state, seat).find((o) => o.gambitId === gambitId && (o.param ?? undefined) === (param ?? undefined))
}

// ---------------------------------------------------------------------------
// Firefight windows
// ---------------------------------------------------------------------------

const ATTACKER_ONLY: string[] = ['shoot.attackRolled', 'shoot.beforeDefenceRerolls', 'shoot.beforeAttackRerolls', 'shoot.attackerDefenceRolled']
const DEFENDER_ONLY: string[] = ['shoot.defenceRolled', 'shoot.beforeDefenceRoll', 'shoot.defenderBeforeRerolls', 'shoot.defenderAttackRolled']

function infoForSeat(state: GameState, window: string, base: PloyWindowInfo, seat: Seat): PloyWindowInfo | null {
  // M9 batch B: an action was declared; only the declaring operative's opponent is asked (actorId = that enemy)
  if (window === 'firefight.opponentActionDeclared') {
    const actor = base.actorId ? state.operatives[base.actorId] : undefined
    if (!actor || actor.seat === seat) return null
    return { ...base }
  }
  if (base.attackerId && base.targetId) {
    const a = state.operatives[base.attackerId]
    const t = state.operatives[base.targetId]
    if (!a || !t) return null
    let subject: Operative | undefined
    if (a.seat === seat && !DEFENDER_ONLY.includes(window)) subject = a
    else if (t.seat === seat && !ATTACKER_ONLY.includes(window)) subject = t
    if (!subject) return null
    return { ...base, subjectId: subject.id, actorId: subject.id }
  }
  // firefight windows: only the owner of the named operative is offered anything
  if (!base.subjectId) return { ...base }
  const subject = state.operatives[base.subjectId]
  if (!subject || subject.seat !== seat) return null
  return { ...base, subjectId: subject.id, actorId: subject.id }
}

/**
 * Open a ploy timing. The seats are asked in order; each is offered only when something is usable.
 * Returns true when a `ploy.firefight` decision was raised (the caller must stop and wait for the
 * resume); false when nothing was offered and the caller continues at once.
 */
export function openPloyWindow(ctx: Ctx, window: TimingWindowId, info: PloyWindowInfo, seats: Seat[], resume: string): boolean {
  ctx.state.window = { id: window, seats: [...seats], info: info as Record<string, unknown>, resume, used: [] }
  return advanceWindow(ctx)
}

/**
 * M9 batch B: `usedBy` has just used `ployId` (a firefight ploy in a window, or a gambit): the other seat gets the
 * `ploy.opponentUsed` window (Devious Scheme) before play goes on. An open window waits on `windowStack` and is
 * resumed afterwards. Never nested twice; true when a decision was raised.
 */
export function openOpponentUsedWindow(ctx: Ctx, usedBy: Seat, ployId: string, resume: string): boolean {
  const s = ctx.state
  if (s.window?.id === 'ploy.opponentUsed' || (s.windowStack ?? []).some((w) => w.id === 'ploy.opponentUsed')) return false
  const info: PloyWindowInfo = { window: 'ploy.opponentUsed', ployId, usedBy }
  const other = otherSeat(usedBy)
  if (offersFor(s, other, 'ploy.opponentUsed', info).length === 0) return false
  const parent = s.window
  if (parent) (s.windowStack ??= []).push(parent)
  return openPloyWindow(ctx, 'ploy.opponentUsed', info, [other], parent ? NESTED_RESUME : resume)
}

const NESTED_RESUME = 'nested'

function advanceWindow(ctx: Ctx): boolean {
  const s = ctx.state
  const w = s.window
  if (!w) return false
  while (w.seats.length > 0) {
    const seat = w.seats[0]!
    const info = infoForSeat(s, w.id, w.info as PloyWindowInfo, seat)
    const offers = info ? offersFor(s, seat, w.id, info) : []
    if (offers.length > 0) {
      const options: OptionInput[] = offers.map((o) => ({
        id: o.id,
        labelKey: `ploy.${o.ployId}`,
        type: 'ploy.firefight',
        payload: { ployId: o.ployId, ...(o.param ? { param: o.param } : {}), ...(o.operativeId ? { operativeId: o.operativeId } : {}) },
        data: { cost: o.cost, name: o.name, ...(o.via ? { via: o.via } : {}), ...(o.param ? { param: o.param } : {}) },
      }))
      ctx.raise({
        kind: 'ploy.firefight',
        seat,
        window: w.id,
        context: { window: w.id, subjectId: info!.subjectId ?? null, cp: s.players[seat].cp },
        options,
        canPass: true,
      })
      return true
    }
    w.seats.shift()
  }
  s.window = null
  void w
  return false
}

/** The window is exhausted: hand control back to whoever opened it. */
function closeWindow(ctx: Ctx, resume: string): void {
  if (resume === NESTED_RESUME) {
    // M9 batch B: back to the window the nested ploy.opponentUsed window interrupted
    const s = ctx.state
    const parent = (s.windowStack ?? []).pop() ?? null
    if (s.windowStack && s.windowStack.length === 0) delete s.windowStack
    s.window = parent
    if (parent && !advanceWindow(ctx)) closeWindow(ctx, parent.resume)
    return
  }
  if (resume === 'gambit') resumeGambit(ctx)
  else if (resume === 'attack') resumeAttack(ctx)
  else if (resume === REMOVAL_RESUME) continueRemovals(ctx)
  else firefightResume(ctx, resume)
}

// M9 shared: an operative incapacitated by an attack offers its owner the `operative.incapacitated` window before
// it is removed (the removal queue waits; R-5.18). Mines and direct damage remove at once (effects.removeNow) and
// open none. Not while another ploy timing is open (a ploy's own damage).
const REMOVAL_RESUME = 'removal'
registerRemovalWindow((ctx, op) => {
  if (ctx.state.window) return false
  return openPloyWindow(ctx, 'operative.incapacitated', { window: 'operative.incapacitated', subjectId: op.id }, [op.seat], REMOVAL_RESUME)
})

// M9 batch B: once an attack's victim is removed, the seat whose operative incapacitated it gets `operative.killed`
// (Vitalised Surge, Brutal Display): the shooter, or the other fighter. Not for self-inflicted removals (Hot).
registerKillWindow((ctx, op) => {
  const s = ctx.state
  if (s.window) return false
  const killerId = s.removal?.killers?.[op.id]
  const killer = killerId ? s.operatives[killerId] : undefined
  if (!killer || killer.seat === op.seat || killer.status !== 'active') return false
  const info: PloyWindowInfo = { window: 'operative.killed', subjectId: killer.id, removedId: op.id, removedPos: { ...op.pos }, cause: killCause(op) }
  return openPloyWindow(ctx, 'operative.killed', info, [killer.seat], REMOVAL_RESUME)
})

/** M10 batch D shared: `attack` for an attack's dice, `direct` for rule damage (mines, Explosive Demise). */
function killCause(op: Operative): 'attack' | 'direct' {
  return op.incapacitatedBy?.source === 'direct' ? 'direct' : 'attack'
}

// M10 batch D shared: a removal outside an attack (effects.removeNow) waits for the end-of-step removal queue when a
// ploy window there would offer something: the owner's operative.incapacitated, or (a rule kill, any activation) the
// killer's operative.killed (Reward Earned).
registerRemovalPauseCheck((state, op) => {
  if (offersFor(state, op.seat, 'operative.incapacitated', { window: 'operative.incapacitated', subjectId: op.id }).length > 0) return true
  const by = op.incapacitatedBy
  const killer = by ? state.operatives[by.id] : undefined
  if (!killer || killer.seat === op.seat || killer.status !== 'active') return false
  const info: PloyWindowInfo = { window: 'operative.killed', subjectId: killer.id, removedId: op.id, removedPos: { ...op.pos }, cause: killCause(op) }
  return offersFor(state, killer.seat, 'operative.killed', info).length > 0
})

// The attack sequences open windows through this registered opener (hooks.ts).
registerWindowOpener((ctx, window, a) => {
  const s = ctx.state
  const atk = s.operatives[a.attackerId]
  const att = s.attack
  if (!atk) return false
  const seq = att?.seq
  const count = (dice: { kind: string; used?: boolean }[] | undefined, kind: string) => (dice ?? []).filter((d) => d.kind === kind && !d.used).length
  const info: PloyWindowInfo = {
    window,
    attackerId: a.attackerId,
    targetId: a.targetId,
    kind: a.kind,
    action: a.kind,
    ...(att?.weaponId ? { weaponId: att.weaponId } : {}),
    attackFails: count(seq?.atk.dice, 'fail'),
    defenceFails: count(seq?.def?.dice, 'fail'),
    critRetained: seq?.critRetained ?? false,
  }
  return openPloyWindow(ctx, window, info, [atk.seat, otherSeat(atk.seat)], 'attack')
})

// ---------------------------------------------------------------------------
// ploy.firefight answers
// ---------------------------------------------------------------------------

function handlePloy(state: GameState, action: { type: string; seat: Seat; payload?: unknown }): Handled {
  const w = state.window
  if (!w) return reject('E_WRONG_DECISION', 'no ploy window is open')
  if (action.type === 'pass') {
    return {
      run(ctx) {
        const win = ctx.state.window!
        win.seats.shift()
        if (!advanceWindow(ctx)) closeWindow(ctx, win.resume)
      },
    }
  }
  if (action.type !== 'ploy.firefight') return reject('E_WRONG_DECISION', 'expected a ploy or a pass')
  const p = action.payload as { ployId: string; param?: string; operativeId?: string }
  const seat = w.seats[0]!
  const info = infoForSeat(state, w.id, w.info as PloyWindowInfo, seat)
  const offer = info ? offersFor(state, seat, w.id, info).find((o) => o.ployId === p.ployId && (o.param ?? undefined) === (p.param ?? undefined) && (p.operativeId === undefined || o.operativeId === p.operativeId)) : undefined
  if (!offer) {
    const def = ployDef(state, p.ployId)
    if (def && usedThisTp(state, seat, def.id)) return reject('E_PLOY_USED', `${def.name} was already used this turning point`)
    if (def && def.cost > state.players[seat].cp) return reject('E_INSUFFICIENT_CP', 'not enough CP')
    return reject('E_NOT_AN_OPTION', 'that ploy is not usable now')
  }
  return {
    run(ctx) {
      const win = ctx.state.window!
      win.used.push(offer.ployId)
      usePloy(ctx, seat, offer, info!)
      // a ploy may have started a free action or a decision of its own; otherwise keep offering
      if (ctx.state.pending) return
      // M9 batch B: the other seat may answer the ploy (Devious Scheme); this window resumes afterwards
      if (openOpponentUsedWindow(ctx, seat, offer.ployId, win.resume)) return
      if (!advanceWindow(ctx)) closeWindow(ctx, win.resume)
    },
  }
}

/** Continue the window after a free sequence started by a ploy has ended. */
export function continueWindow(ctx: Ctx): void {
  const win = ctx.state.window
  if (!win) return
  if (!advanceWindow(ctx)) closeWindow(ctx, win.resume)
}

// Free actions a ploy starts (SSSSHHHH! Dashes, KRUMP 'EM! Fight) hand control back when the queue is done.
const afterFree = (ctx: Ctx): void => {
  if (ctx.state.window) continueWindow(ctx)
  else if (ctx.state.phase === 'strategy') resumeGambit(ctx)
}
registerFrameResume('ploy.freeMoves', afterFree)
registerFrameResume('ploy.freeAction', afterFree)

export const ploysModule: ModuleDef = {
  id: 'ploys',
  namespaces: ['ploy', 'dice'],
  handle(state, action, pending) {
    // dice.* re-roll kinds are routed to the attack modules by modules.ts
    if (pending.kind.startsWith('dice.')) return reject('E_WRONG_DECISION', `${pending.kind} belongs to the attack modules`)
    return handlePloy(state, action)
  },
}

export { hasKeyword, SEATS }
