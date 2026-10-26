// SHT: shoot.* - the Shoot sequence (R-5). One firefight action runs as a chain of decisions kept in
// `state.attack`: weapon, target (plus Torrent secondaries), attack roll and re-rolls, cover choice,
// defence roll and re-rolls, blocking, damage. Blast and Torrent secondaries are separate sequences
// inside the same action; incapacitated operatives are removed once the whole action has finished.
import {
  applyAplEffect,
  applyReroll,
  attackOf,
  attackStats,
  blastSecondaries,
  blockPlans,
  choiceOptions,
  countKinds,
  defenceStats,
  inflict,
  kindsOf,
  newSide,
  openWindow,
  runDiceRolled,
  parseReroll,
  pushRetained,
  pushRolled,
  registerResumer,
  beginRemovals,
  registerRemovalsDone,
  rerollOptions,
  retainAttack,
  ruleSetFor,
  seqOf,
  targetInfo,
  torrentCandidates,
  valuesOf,
  validTargets,
  weaponDamage,
  weaponOf,
  parseRules,
  weaponUnusable,
  type TargetInfo,
} from './attack-common'
import { providerAny, providerExtraTargets, providerFixedTargets, providerViewpoints, type FixedTargets } from './team-rules'
import { enemiesInControlRange } from './measure'
import { cancelAction, finishAction } from './firefight'
import { runHook, type ChoiceRequest } from './hooks'
import { distanceBetween } from './measure'
import { bodyOf, visible } from './los'
import { expectedDamage } from './query'
import { reject, type Ctx, type Handled, type ModuleDef, type OptionInput } from './registry'
import { repeatSurcharge } from './abilities'
import { effectiveApl, getOp } from './state'
import type {
  Action,
  Activation,
  AttackSequence,
  AttackState,
  DiceSide,
  GameState,
  Operative,
  PendingDecision,
  Rejection,
  RuntimeWeapon,
  TimingWindowId,
} from './types'

// ---------------------------------------------------------------------------
// Availability (used by firefight.ts when listing actions)
// ---------------------------------------------------------------------------

/** Ranged weapons the operative could use right now (Heavy, Limited, Silent applied), regardless of targets. */
export function usableRangedWeapons(state: GameState, op: Operative, performed: string[]): string[] {
  return op.weapons.filter((w) => {
    const def = state.data.weapons[w]
    return def?.type === 'ranged' && weaponUnusable(state, op, w, performed, 'shoot') === null
  })
}

/** Weapons the operative may pick for a Shoot now: usable and with at least one valid target. */
export function shootableWeapons(state: GameState, op: Operative, performed: string[], ctx?: Ctx): { weaponId: string; targets: TargetInfo[] }[] {
  const out: { weaponId: string; targets: TargetInfo[] }[] = []
  for (const w of usableRangedWeapons(state, op, performed)) {
    const targets = weaponTargets(state, op, w, ctx)
    if (targets.length > 0) out.push({ weaponId: w, targets })
  }
  return out
}

/**
 * M9 batch C: the targets a weapon would shoot: its own fixed targets when a team rule names them (Detonate), else the
 * valid targets. Fixed targets need no visibility; their statuses are forced when the sequence starts.
 */
export function weaponTargets(state: GameState, op: Operative, weaponId: string, ctx?: Ctx, viewpoint?: Operative): TargetInfo[] {
  const fixed = providerFixedTargets(state, op, weaponId)
  if (!fixed) return validTargets(state, op, weaponId, ctx, viewpoint)
  const out: TargetInfo[] = []
  for (const id of fixed.targets) {
    const t = state.operatives[id]
    if (!t || t.status !== 'active' || t.wounds <= 0) continue
    out.push(targetInfo(state, op, t, ruleSetFor(state, op, weaponId, 'shoot', id, ctx)))
  }
  return out
}

/** Rules check for starting a Shoot beyond order and Control Range: some weapon needs a valid target. */
export function shootAvailability(state: GameState, op: Operative, activation: Activation | null): Rejection | null {
  const performed = activation?.performed ?? []
  const usable = usableRangedWeapons(state, op, performed)
  if (usable.length === 0) {
    const anyRanged = op.weapons.some((w) => state.data.weapons[w]?.type === 'ranged')
    return { code: 'E_ACTION_RESTRICTED', reason: anyRanged ? 'no ranged weapon can be used now' : 'the operative has no ranged weapon' }
  }
  for (const w of usable) {
    if (weaponTargets(state, op, w).length > 0) return null
  }
  // a viewpoint a team rule offers (team-rules shootViewpoints: Magnify proxies) counts too, as in raiseWeapon
  for (const w of usable) {
    for (const vpId of providerViewpoints(state, op, w)) {
      const vp = state.operatives[vpId]
      if (vp && vp.status === 'active' && validTargets(state, op, w, undefined, vp).length > 0) return null
    }
  }
  return { code: 'E_INVALID_TARGET', reason: 'no valid target for any usable weapon' }
}

// ---------------------------------------------------------------------------
// Begin
// ---------------------------------------------------------------------------

export interface BeginShootOptions {
  pointBlank?: boolean
}

export function beginShoot(ctx: Ctx, opts: BeginShootOptions = {}): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const op = getOp(s, act.operativeId)
  s.attack = {
    kind: 'shoot',
    stage: 'weapon',
    operativeId: op.id,
    seat: op.seat,
    weaponId: null,
    pointBlank: opts.pointBlank === true,
    targets: [],
    candidates: [],
    index: 0,
    seq: null,
    incapacitated: [],
    stunned: [],
    inherit: null,
    windows: [],
  }
  // a point-blank shooter cannot retaliate until the end of the interrupted activation (R-4.11)
  if (opts.pointBlank) op.flags.cannotRetaliate = true
  raiseWeapon(ctx)
}

function abort(ctx: Ctx): void {
  ctx.state.attack = null
  cancelAction(ctx)
}

function weaponSummary(w: RuntimeWeapon): Record<string, unknown> {
  return { name: w.name, atk: w.atk, hit: w.hit, dmg: w.dmg, rules: w.rules }
}

function raiseWeapon(ctx: Ctx): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const act = s.firefight.activation!
  const op = getOp(s, a.operativeId)
  const options: OptionInput[] = []
  // M9 prep: a shooter that fails the core Shoot conditions itself (Conceal without Silent, in an enemy control
  // range) may still shoot through a viewpoint a team rule offers (Magnify); then only those options exist
  for (const { weaponId, targets } of shootableWeapons(s, op, act.performed, ctx)) {
    if (!baseShootConditions(s, op, weaponId)) continue
    // ASTARTES: repeating a bolt sniper rifle / heavy bolter costs 1 more AP, so it is only offered when affordable
    if (!surchargeAffordable(s, op, act, weaponId)) continue
    const w = weaponOf(s, weaponId)
    options.push({
      id: weaponId,
      labelKey: 'shoot.weapon',
      type: 'shoot.weapon',
      payload: { weaponId },
      data: { ...weaponSummary(w), profileGroup: w.profileGroup ?? null, targets: targets.length },
    })
  }
  for (const weaponId of usableRangedWeapons(s, op, act.performed)) {
    if (!surchargeAffordable(s, op, act, weaponId)) continue
    for (const vpId of providerViewpoints(s, op, weaponId)) {
      const vp = s.operatives[vpId]
      if (!vp || vp.status !== 'active') continue
      const targets = validTargets(s, op, weaponId, ctx, vp)
      if (targets.length === 0) continue
      const w = weaponOf(s, weaponId)
      options.push({
        id: `${weaponId}@${vpId}`,
        labelKey: 'shoot.weaponVia',
        type: 'shoot.weapon',
        payload: { weaponId, viewpointId: vpId },
        data: { ...weaponSummary(w), profileGroup: w.profileGroup ?? null, targets: targets.length, viewpointId: vpId },
      })
    }
  }
  if (options.length === 0) {
    abort(ctx)
    return
  }
  a.stage = 'weapon'
  ctx.raise({
    kind: 'shoot.weapon',
    seat: op.seat,
    window: 'firefight.actionDeclared',
    context: { operativeId: op.id },
    options,
    canPass: true,
  })
}

/** The extra AP (ASTARTES) the declared Shoot costs with this weapon; a counteraction or free Shoot pays none. */
function surchargeFor(state: GameState, op: Operative, act: Activation, weaponId: string): number {
  if (act.counteract || act.frame || act.declared?.free) return 0
  return repeatSurcharge(state, op, act, weaponId)
}

function surchargeAffordable(state: GameState, op: Operative, act: Activation, weaponId: string): boolean {
  const extra = surchargeFor(state, op, act, weaponId)
  return extra === 0 || act.apSpent + (act.declared?.cost ?? 1) + extra <= effectiveApl(op)
}

/** Core Shoot conditions on the shooter itself: Conceal needs a Silent weapon, no enemy in control range (R-3.4, R-4.7). */
function baseShootConditions(state: GameState, op: Operative, weaponId: string): boolean {
  const inCr = enemiesInControlRange(state, op, op.seat).length > 0
  const explosive = op.weapons.some((w) => state.data.weapons[w]?.rules.some((r) => r.rule === 'explosive'))
  if (inCr && !explosive && !state.attack?.pointBlank && !providerAny(state, op, 'shootInControlRange')) return false
  if (op.order === 'conceal') return parseRules(state.data.weapons[weaponId]?.rules ?? []).silent
  return true
}

/** The operative whose position decides valid targets, cover and obscured for this Shoot (Magnify), or undefined. */
function viewpointOf(state: GameState, a: AttackState): Operative | undefined {
  return a.viewpointId ? state.operatives[a.viewpointId] : undefined
}

function selectWeapon(ctx: Ctx, weaponId: string, viewpointId?: string): void {
  const a = attackOf(ctx)
  if (viewpointId) a.viewpointId = viewpointId
  else delete a.viewpointId
  const act = ctx.state.firefight.activation!
  const extra = surchargeFor(ctx.state, getOp(ctx.state, a.operativeId), act, weaponId)
  if (extra > 0) act.surcharge = extra
  else delete act.surcharge
  a.weaponId = weaponId
  ctx.emit({ type: 'ShootStarted', operativeId: a.operativeId, weaponId }, a.seat)
  raiseTargets(ctx)
}

function targetData(state: GameState, shooterId: string, weaponId: string, info: TargetInfo): Record<string, unknown> {
  const exp = expectedDamage(state, shooterId, weaponId, info.id)
  return {
    distance: info.distance,
    inCover: info.inCover,
    obscured: info.obscured,
    forcedChoice: info.verdict.forcedChoice,
    improvedCover: info.improvedCover,
    vantageAccurate: info.verdict.vantage.accurate,
    expectedDamage: exp.mean,
    killProbability: exp.killProbability,
  }
}

function raiseTargets(ctx: Ctx): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const op = getOp(s, a.operativeId)
  const weaponId = a.weaponId!
  // M9 batch C: a weapon that picks its own targets (Detonate) raises no target decision
  const fixed = providerFixedTargets(s, op, weaponId)
  if (fixed) {
    chooseFixed(ctx, fixed)
    return
  }
  const targets = validTargets(s, op, weaponId, ctx, viewpointOf(s, a))
  if (targets.length === 0) {
    abort(ctx)
    return
  }
  a.stage = 'target'
  ctx.raise({
    kind: 'shoot.target',
    seat: op.seat,
    window: 'firefight.actionDeclared',
    context: { operativeId: op.id, weaponId, secondary: false },
    options: targets.map((t) => ({
      id: t.id,
      labelKey: 'shoot.target',
      type: 'shoot.target' as const,
      payload: { targetId: t.id },
      data: targetData(s, op.id, weaponId, t),
    })),
    canPass: true,
  })
}

/** M9 batch C: shoot the targets a team rule fixed for the weapon (primary first, Blast secondaries around it). */
function chooseFixed(ctx: Ctx, fixed: FixedTargets): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const op = getOp(s, a.operativeId)
  const ids = fixed.targets.filter((id) => {
    const t = s.operatives[id]
    return !!t && t.status === 'active' && t.wounds > 0
  })
  if (ids.length === 0) {
    abort(ctx)
    return
  }
  a.targets = ids.slice()
  a.index = 0
  a.inherit = null
  a.candidates = []
  a.fixed = { ...(fixed.noCover ? { noCover: true } : {}), ...(fixed.noObscured ? { noObscured: true } : {}) }
  const rules = ruleSetFor(s, op, a.weaponId!, 'shoot', ids[0], ctx)
  if (fixed.blast !== false && rules.blast !== null) {
    for (const id of blastSecondaries(s, op, getOp(s, ids[0]!), rules.blast)) if (!a.targets.includes(id)) a.targets.push(id)
  }
  startTarget(ctx)
}

function chooseTarget(ctx: Ctx, targetId: string): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const op = getOp(s, a.operativeId)
  const target = getOp(s, targetId)
  const rules = ruleSetFor(s, op, a.weaponId!, 'shoot', targetId, ctx)
  a.targets = [targetId]
  a.index = 0
  a.inherit = null
  if (rules.blast !== null) a.targets.push(...blastSecondaries(s, op, target, rules.blast))
  a.candidates = rules.torrent !== null ? torrentCandidates(s, op, a.weaponId!, targetId, rules.torrent, ctx, viewpointOf(s, a)) : []
  // M9 batch C: extra primary targets a team rule allows (Salvo), chosen like Torrent targets, up to its maximum
  delete a.extraMax
  if (a.candidates.length === 0) {
    const extra = providerExtraTargets(s, op, a.weaponId!, targetId)
    if (extra) {
      a.candidates = extra.candidates.slice()
      a.extraMax = extra.max
    }
  }
  if (a.candidates.length > 0) {
    raiseSecondary(ctx)
    return
  }
  startTarget(ctx)
}

function raiseSecondary(ctx: Ctx): void {
  const s = ctx.state
  const a = attackOf(ctx)
  a.stage = 'secondary'
  const options: OptionInput[] = a.candidates.map((id) => ({
    id: `add:${id}`,
    labelKey: 'shoot.secondary',
    type: 'shoot.target' as const,
    payload: { targetId: id, secondary: true },
    data: { distance: distanceBetween(bodyOf(getOp(s, a.targets[0]!)), bodyOf(getOp(s, id))) },
  }))
  options.push({ id: 'done', labelKey: 'shoot.secondaryDone', type: 'shoot.target', payload: { done: true } })
  ctx.raise({
    kind: 'shoot.target',
    seat: a.seat,
    window: 'firefight.actionDeclared',
    context: { operativeId: a.operativeId, weaponId: a.weaponId, secondary: true, selected: a.targets.slice() },
    options,
  })
}

// ---------------------------------------------------------------------------
// One sequence per target
// ---------------------------------------------------------------------------

type Step = (ctx: Ctx) => void
const STEPS: Record<string, Step> = {}

function proceed(ctx: Ctx, step: string, window?: TimingWindowId): void {
  const a = attackOf(ctx)
  if (window && openWindow(ctx, window, a.seq?.targetId ?? a.targets[a.index] ?? '')) {
    a.resume = step
    return
  }
  STEPS[step]!(ctx)
}

registerRemovalsDone((ctx) => finishAction(ctx))

registerResumer('shoot', (ctx) => {
  const a = ctx.state.attack
  if (!a?.resume) return
  const step = a.resume
  a.resume = undefined
  STEPS[step]!(ctx)
})

function startTarget(ctx: Ctx): void {
  const s = ctx.state
  const a = attackOf(ctx)
  while (a.index < a.targets.length) {
    const t = s.operatives[a.targets[a.index]!]
    if (t && t.status === 'active' && t.wounds > 0) break
    a.index++
  }
  if (a.index >= a.targets.length) {
    proceed(ctx, 'finish', 'shoot.resolved')
    return
  }
  const op = getOp(s, a.operativeId)
  const target = getOp(s, a.targets[a.index]!)
  const rules = ruleSetFor(s, op, a.weaponId!, 'shoot', target.id, ctx)
  const info = targetInfo(s, op, target, rules, viewpointOf(s, a))
  // M9 batch C: fixed targets (Detonate) may be barred from cover and obscuring outright
  if (a.fixed) {
    const noCover = a.fixed.noCover === true
    beginRoll(ctx, noCover ? false : info.inCover, a.fixed.noObscured ? false : info.obscured, noCover ? false : info.improvedCover)
    return
  }
  if (a.index > 0 && a.inherit) {
    beginRoll(ctx, a.inherit.cover, a.inherit.obscured, a.inherit.improvedCover)
    return
  }
  if (info.verdict.forcedChoice) {
    a.stage = 'statusChoice'
    ctx.raise({
      kind: 'weapon.choice',
      seat: target.seat,
      window: 'shoot.targetSelected',
      context: { choice: 'coverOrObscured', targetId: target.id, attackerId: op.id },
      options: [
        {
          id: 'cover',
          labelKey: 'choice.cover',
          type: 'weapon.choice',
          payload: { choice: 'coverOrObscured', option: 'cover' },
          data: { ...info.verdict.ifCover },
        },
        {
          id: 'obscured',
          labelKey: 'choice.obscured',
          type: 'weapon.choice',
          payload: { choice: 'coverOrObscured', option: 'obscured' },
          data: { ...info.verdict.ifObscured },
        },
      ],
    })
    return
  }
  beginRoll(ctx, info.inCover, info.obscured, info.improvedCover)
}

/** Statuses are decided: offer the shoot.targetSelected ploy window, then roll. */
function beginRoll(ctx: Ctx, cover: boolean, obscured: boolean, improvedCover: boolean): void {
  attackOf(ctx).status = { cover, obscured, improvedCover }
  proceed(ctx, 'roll', 'shoot.targetSelected')
}

STEPS.roll = (ctx) => {
  const a = attackOf(ctx)
  const st = a.status!
  a.status = undefined
  rollAttack(ctx, st.cover, st.obscured, st.improvedCover)
}

function rollAttack(ctx: Ctx, cover: boolean, obscured: boolean, improvedCover: boolean): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const op = getOp(s, a.operativeId)
  const target = getOp(s, a.targets[a.index]!)
  const weaponId = a.weaponId!
  const rules = ruleSetFor(s, op, weaponId, 'shoot', target.id, ctx)
  const info = targetInfo(s, op, target, rules)
  if (a.index === 0 && rules.blast !== null) a.inherit = { cover, obscured, improvedCover }
  const stats = attackStats(s, op.id, weaponId, target.id, { kind: 'shoot', pointBlank: a.pointBlank, vantageAccurate: info.verdict.vantage.accurate }, ctx)
  ctx.emit(
    {
      type: 'TargetSelected',
      operativeId: op.id,
      targetId: target.id,
      weaponId,
      secondary: a.index > 0,
      distance: info.distance,
      inCover: cover,
      obscured,
      improvedCover,
    },
    op.seat,
  )
  const side = newSide(op.seat, op.id, weaponId, stats.need, stats.lethal, stats.grants)
  const rolled = stats.atk - stats.accurate
  if (rolled > 0) pushRolled(side, ctx.roll('shoot.attack', rolled))
  pushRetained(side, stats.accurate, 'normal', 'accurate')
  const seq: AttackSequence = {
    targetId: target.id,
    secondary: a.index > 0,
    cover,
    obscured,
    improvedCover,
    atk: side,
    def: null,
    critRetained: false,
    collected: 0,
    choices: {},
  }
  a.seq = seq
  ctx.emit(
    {
      type: 'AttackDiceRolled',
      operativeId: op.id,
      targetId: target.id,
      weaponId,
      dice: valuesOf(side.dice),
      kinds: kindsOf(side.dice),
      need: side.need,
      lethal: side.lethal,
    },
    op.seat,
  )
  // M9 batch B: rules acting on the fresh roll (Omen), then the attacker's window before any re-roll (Engage to Acquire)
  runDiceRolled(ctx, 'shoot', 'attack', side, target.id)
  proceed(ctx, 'attackDefenderWindow', 'shoot.beforeAttackRerolls')
}

// batch C shared: the defender on the fresh attack roll, before any attack re-roll (Fate Itself is My Weapon)
STEPS.attackDefenderWindow = (ctx) => proceed(ctx, 'attackRerolls', 'shoot.defenderAttackRolled')

STEPS.attackRerolls = (ctx) => advanceWindow(ctx, 'atk')

// --- re-roll windows --------------------------------------------------------

function windowFor(which: 'atk' | 'def'): TimingWindowId {
  return which === 'atk' ? 'shoot.attackRolled' : 'shoot.defenceRolled'
}

function sideOfStage(a: AttackState, seq: AttackSequence): DiceSide | null {
  return a.stage === 'attackReroll' ? seq.atk : a.stage === 'defenceReroll' ? seq.def : null
}

function advanceWindow(ctx: Ctx, which: 'atk' | 'def'): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  const side = which === 'atk' ? seq.atk : seq.def!
  a.stage = which === 'atk' ? 'attackReroll' : 'defenceReroll'
  for (let guard = 0; guard < 4; guard++) {
    if (side.phase === 'grants') {
      const o = rerollOptions(s, side)
      if (o.grants.length > 0) {
        ctx.raise({
          kind: 'dice.reroll',
          seat: side.seat,
          window: windowFor(which),
          context: { side: which === 'atk' ? 'attack' : 'defence', targetId: seq.targetId, dice: valuesOf(side.dice), kinds: kindsOf(side.dice) },
          options: o.grants,
          canPass: true,
        })
        return
      }
      side.phase = 'command'
    }
    if (side.phase === 'command') {
      const o = rerollOptions(s, side)
      if (o.command.length > 0) {
        ctx.raise({
          kind: 'dice.commandReroll',
          seat: side.seat,
          window: windowFor(which),
          context: { side: which === 'atk' ? 'attack' : 'defence', targetId: seq.targetId, dice: valuesOf(side.dice), kinds: kindsOf(side.dice), cp: s.players[side.seat].cp },
          options: o.command,
          canPass: true,
        })
        return
      }
      side.phase = 'done'
    }
    break
  }
  if (which === 'atk') STEPS.afterAttackWindow!(ctx)
  else STEPS.afterDefenceWindow!(ctx)
}

// --- hook-requested choices -------------------------------------------------

/** Run an after-roll hook; true when it has nothing outstanding, false when a choice decision was raised. */
function runAfterRoll(ctx: Ctx, which: 'atk' | 'def', resumeStep: string): boolean {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  const side = which === 'atk' ? seq.atk : seq.def!
  const data = {
    kind: 'shoot' as const,
    side: which === 'atk' ? ('attack' as const) : ('defence' as const),
    targetId: seq.targetId,
    dice: side.dice,
    requests: [] as ChoiceRequest[],
    choices: seq.choices,
    obscured: seq.obscured,
  }
  runHook(which === 'atk' ? 'afterAttackRoll' : 'afterDefenceRoll', {
    seat: side.seat,
    state: s,
    engine: ctx,
    // the subject is the operative that rolled the dice; targetId is its opponent in the sequence
    operativeId: which === 'atk' ? a.operativeId : seq.targetId,
    targetId: which === 'atk' ? seq.targetId : a.operativeId,
    ...(a.weaponId ? { weaponId: a.weaponId } : {}),
    data,
  })
  for (const req of data.requests) {
    if (seq.choices[req.id] !== undefined || req.options.length === 0) continue
    a.stage = 'hookChoice'
    a.resume = resumeStep
    ctx.raise({
      kind: 'weapon.choice',
      seat: req.seat,
      window: windowFor(which),
      context: { choice: req.id, targetId: seq.targetId },
      options: choiceOptions(req.id, req.options),
    })
    return false
  }
  return true
}

STEPS.afterAttackWindow = (ctx) => {
  if (!runAfterRoll(ctx, 'atk', 'afterAttackWindow')) return
  proceed(ctx, 'retain', 'shoot.attackRolled')
}

// --- retention, Devastating, defence ---------------------------------------

STEPS.retain = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  const op = getOp(s, a.operativeId)
  const target = getOp(s, seq.targetId)
  const weapon = weaponOf(s, a.weaponId!)
  const rules = ruleSetFor(s, op, weapon.id, 'shoot', target.id, ctx)
  const out = retainAttack(seq.atk, rules, seq.obscured)
  seq.critRetained = out.critRetained
  const c = countKinds(seq.atk.dice)
  ctx.emit(
    { type: 'AttackRetained', operativeId: op.id, targetId: target.id, normal: c.normal, crit: c.crit, obscured: seq.obscured, converted: out.converted },
    op.seat,
  )
  if (out.critRetained && rules.stun && !a.stunned.includes(target.id)) a.stunned.push(target.id)
  if (out.critRetained && rules.devastating && rules.devastating.x > 0) {
    const victims = [target.id]
    if (rules.devastating.inches !== null) {
      const tb = bodyOf(target)
      for (const o of Object.values(s.operatives)) {
        if (o.status !== 'active' || o.id === target.id || o.wounds <= 0) continue
        if (distanceBetween(tb, bodyOf(o)) > rules.devastating.inches + 1e-6) continue
        if (!visibleEither(s, tb, bodyOf(o))) continue
        victims.push(o.id)
      }
    }
    for (const v of victims) {
      for (let i = 0; i < c.crit; i++) {
        inflict(ctx, { targetId: v, attackerId: op.id, weaponId: weapon.id, amount: rules.devastating.x, source: 'devastating', ...(v !== target.id ? { splash: true } : {}) })
      }
    }
  }
  // M9 batch B: the defender's window once the attack dice are final, before defence dice are collected (Refractor Field)
  const t = s.operatives[seq.targetId]
  if (t && t.status === 'active' && t.wounds > 0) proceed(ctx, 'defence', 'shoot.beforeDefenceRoll')
  else STEPS.defence!(ctx)
}

function visibleEither(s: GameState, a: ReturnType<typeof bodyOf>, b: ReturnType<typeof bodyOf>): boolean {
  return visible(s, a, b) || visible(s, b, a)
}

STEPS.defence = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  const op = getOp(s, a.operativeId)
  const target = getOp(s, seq.targetId)
  const rules = ruleSetFor(s, op, a.weaponId!, 'shoot', target.id, ctx)
  const ds = defenceStats(s, target.id, op.id, a.weaponId!, rules, seq.critRetained, ctx)
  seq.collected = ds.collected
  seq.def = newSide(target.seat, target.id, null, ds.need, null, ds.grants)
  if (seq.cover && !rules.saturate && ds.collected >= 1) {
    a.stage = 'cover'
    const options: OptionInput[] = [
      { id: 'retain', labelKey: 'cover.retain', type: 'shoot.coverSave', payload: { mode: 'retain' }, data: { retained: 1, crit: false } },
      { id: 'roll', labelKey: 'cover.roll', type: 'shoot.coverSave', payload: { mode: 'roll' }, data: { retained: 0 } },
    ]
    if (seq.improvedCover) {
      options.push({ id: 'retainCrit', labelKey: 'cover.retainCrit', type: 'shoot.coverSave', payload: { mode: 'retainCrit' }, data: { retained: 1, crit: true } })
      if (ds.collected >= 2) {
        options.push({ id: 'retainTwo', labelKey: 'cover.retainTwo', type: 'shoot.coverSave', payload: { mode: 'retainTwo' }, data: { retained: 2, crit: false } })
      }
    }
    ctx.raise({
      kind: 'shoot.coverSave',
      seat: target.seat,
      window: 'shoot.attackRolled',
      context: { targetId: target.id, collected: ds.collected, improved: seq.improvedCover, need: ds.need },
      options,
    })
    return
  }
  rollDefence(ctx, 'roll')
}

function rollDefence(ctx: Ctx, mode: string): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  const side = seq.def!
  seq.coverMode = mode
  const retainedCount = mode === 'roll' ? 0 : mode === 'retainTwo' ? Math.min(2, seq.collected) : Math.min(1, seq.collected)
  if (retainedCount > 0) {
    const crit = mode === 'retainCrit'
    pushRetained(side, retainedCount, crit ? 'crit' : 'normal', 'cover')
    ctx.emit({ type: 'CoverSaveRetained', targetId: seq.targetId, normal: crit ? 0 : retainedCount, crit: crit ? retainedCount : 0 }, side.seat)
  }
  const n = seq.collected - retainedCount
  if (n > 0) pushRolled(side, ctx.roll('shoot.defence', n))
  ctx.emit(
    {
      type: 'DefenceDiceRolled',
      targetId: seq.targetId,
      collected: seq.collected,
      dice: valuesOf(side.dice),
      kinds: kindsOf(side.dice),
      need: side.need,
    },
    side.seat,
  )
  void s
  // M9 batch B: rules acting on the fresh defence roll (Omen)
  runDiceRolled(ctx, 'shoot', 'defence', side, a.operativeId)
  // M9 shared: the attacker's window on the fresh defence roll, before any re-roll (Curse of Rot)
  proceed(ctx, 'defenceOwnWindow', 'shoot.beforeDefenceRerolls')
}

// M9 batch B: the defender's own window on its fresh defence roll, before any re-roll (Stimulated Senses)
STEPS.defenceOwnWindow = (ctx) => proceed(ctx, 'defenceRerolls', 'shoot.defenderBeforeRerolls')

STEPS.defenceRerolls = (ctx) => advanceWindow(ctx, 'def')

STEPS.afterDefenceWindow = (ctx) => {
  if (!runAfterRoll(ctx, 'def', 'afterDefenceWindow')) return
  proceed(ctx, 'attackerDefenceWindow', 'shoot.defenceRolled')
}

// M9 batch B shared: the attacker's window once the defence dice are final, before blocking (Siphon Life)
STEPS.attackerDefenceWindow = (ctx) => proceed(ctx, 'block', 'shoot.attackerDefenceRolled')

// --- blocking and damage ----------------------------------------------------

STEPS.block = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  const op = getOp(s, a.operativeId)
  const rules = ruleSetFor(s, op, a.weaponId!, 'shoot', seq.targetId, ctx)
  const weapon = weaponOf(s, a.weaponId!)
  const at = countKinds(seq.atk.dice)
  const df = seq.def ? countKinds(seq.def.dice) : { normal: 0, crit: 0, fail: 0 }
  const dmg = weaponDamage(s, a.operativeId, weapon.id, seq.targetId, 'shoot', ctx)
  const plans = blockPlans(at.normal, at.crit, df.normal, df.crit, dmg, rules.brutal)
  if (plans.length <= 1) {
    applyBlock(ctx, plans[0]!)
    return
  }
  a.stage = 'block'
  const [auto, ...rest] = plans as [typeof plans[0], ...typeof plans]
  const planData = (p: typeof auto) => ({
    unblockedNormal: p.unblockedNormal,
    unblockedCrit: p.unblockedCrit,
    blockedNormal: p.blockedNormal,
    blockedCrit: p.blockedCrit,
    damage: p.damage,
  })
  const options: OptionInput[] = [
    { id: 'auto', labelKey: 'block.auto', type: 'shoot.block', payload: { mode: 'auto' }, data: planData(auto) },
    ...rest
      .filter((p) => !(p.unblockedNormal === auto.unblockedNormal && p.unblockedCrit === auto.unblockedCrit))
      .map((p) => ({
        id: `leave:${p.unblockedNormal}n${p.unblockedCrit}c`,
        labelKey: 'block.leave',
        type: 'shoot.block' as const,
        payload: { unblocked: [p.unblockedNormal, p.unblockedCrit] },
        data: planData(p),
      })),
  ]
  ctx.raise({
    kind: 'shoot.block',
    seat: seq.def?.seat ?? getOp(s, seq.targetId).seat,
    window: 'shoot.defenceRolled',
    context: {
      targetId: seq.targetId,
      attack: { normal: at.normal, crit: at.crit },
      defence: { normal: df.normal, crit: df.crit },
      dmg,
      brutal: rules.brutal,
    },
    options,
  })
}

function applyBlock(ctx: Ctx, plan: { unblockedNormal: number; unblockedCrit: number; blockedNormal: number; blockedCrit: number }): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  ctx.emit(
    {
      type: 'DiceBlocked',
      targetId: seq.targetId,
      blockedNormal: plan.blockedNormal,
      blockedCrit: plan.blockedCrit,
      unblockedNormal: plan.unblockedNormal,
      unblockedCrit: plan.unblockedCrit,
    },
    seq.def?.seat ?? null,
  )
  // batch D prep: a window after blocks and before any damage (Drag); ploys there may lower seq.unblocked
  seq.unblocked = { normal: plan.unblockedNormal, crit: plan.unblockedCrit }
  proceed(ctx, 'resolve', 'shoot.beforeResolve')
}

STEPS.resolve = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const seq = seqOf(ctx)
  const weapon = weaponOf(s, a.weaponId!)
  const dmg = weaponDamage(s, a.operativeId, weapon.id, seq.targetId, 'shoot', ctx)
  const left = seq.unblocked ?? { normal: 0, crit: 0 }
  for (let i = 0; i < left.crit; i++) {
    inflict(ctx, { targetId: seq.targetId, attackerId: a.operativeId, weaponId: weapon.id, amount: dmg.crit, source: 'crit' })
  }
  for (let i = 0; i < left.normal; i++) {
    inflict(ctx, { targetId: seq.targetId, attackerId: a.operativeId, weaponId: weapon.id, amount: dmg.normal, source: 'normal' })
  }
  a.seq = null
  a.index++
  startTarget(ctx)
}

// --- the end of the action --------------------------------------------------

STEPS.finish = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const op = getOp(s, a.operativeId)
  const act = s.firefight.activation!
  const weaponId = a.weaponId!
  const rules = ruleSetFor(s, op, weaponId, 'shoot', a.targets[0], ctx)
  // Hot and Limited resolve after the whole action (R-5.17)
  if (rules.hot) {
    const [r] = ctx.roll('shoot.hot', 1)
    const stats = attackStats(s, op.id, weaponId, a.targets[0]!, { kind: 'shoot', pointBlank: a.pointBlank }, ctx)
    if (r! < stats.need) {
      inflict(ctx, { targetId: op.id, attackerId: op.id, weaponId, amount: 2 * r!, source: 'hot' })
    }
  }
  if (rules.limited !== null) {
    const uses = (op.usedLimited[weaponId] ?? 0) + 1
    op.usedLimited[weaponId] = uses
    ctx.emit({ type: 'WeaponLimited', operativeId: op.id, weaponId, uses }, op.seat)
  }
  for (const id of a.stunned) {
    const t = s.operatives[id]
    if (t && t.status === 'active' && t.wounds > 0) applyAplEffect(ctx, id, -1, 'stun')
  }
  act.weaponsUsed = [...(act.weaponsUsed ?? []), weaponId]
  runHook('afterShootResolved', {
    seat: op.seat,
    state: s,
    engine: ctx,
    operativeId: op.id,
    weaponId,
    data: { weaponId, targets: a.targets.slice(), incapacitated: a.incapacitated.slice() },
  })
  ctx.emit({ type: 'ShootEnded', operativeId: op.id, weaponId }, op.seat)
  const gone = a.incapacitated.slice()
  s.attack = null
  // M9 batch B: who incapacitated whom, for the killer's operative.killed window
  const killers = Object.fromEntries(gone.filter((id) => id !== op.id).map((id) => [id, op.id]))
  if (!beginRemovals(ctx, gone, killers)) return
  finishAction(ctx)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleWeapon(_state: GameState, action: Action): Handled {
  if (action.type === 'pass') return { run: (ctx) => abort(ctx) }
  if (action.type !== 'shoot.weapon') return reject('E_WRONG_DECISION', 'expected a weapon')
  const weaponId = String(action.payload.weaponId)
  const vp = (action.payload as { viewpointId?: unknown }).viewpointId
  return { run: (ctx) => selectWeapon(ctx, weaponId, typeof vp === 'string' ? vp : undefined) }
}

function handleTarget(_state: GameState, action: Action): Handled {
  if (action.type === 'pass') return { run: (ctx) => abort(ctx) }
  if (action.type !== 'shoot.target') return reject('E_WRONG_DECISION', 'expected a target')
  const p = action.payload
  if (p.done === true) return { run: (ctx) => startTarget(ctx) }
  const targetId = String(p.targetId)
  if (p.secondary === true) {
    return {
      run(ctx) {
        const a = attackOf(ctx)
        a.targets.push(targetId)
        a.candidates = a.candidates.filter((c) => c !== targetId)
        // M9 batch C: Salvo-style extra targets stop at their maximum
        const full = a.extraMax !== undefined && a.targets.length - 1 >= a.extraMax
        if (a.candidates.length > 0 && !full) raiseSecondary(ctx)
        else startTarget(ctx)
      },
    }
  }
  return { run: (ctx) => chooseTarget(ctx, targetId) }
}

function handleCover(_state: GameState, action: Action): Handled {
  if (action.type !== 'shoot.coverSave') return reject('E_WRONG_DECISION', 'expected a cover save choice')
  const mode = String(action.payload.mode)
  return { run: (ctx) => rollDefence(ctx, mode) }
}

function handleBlock(state: GameState, action: Action): Handled {
  if (action.type !== 'shoot.block') return reject('E_WRONG_DECISION', 'expected a block')
  const p = action.payload
  return {
    run(ctx) {
      const a = attackOf(ctx)
      const seq = seqOf(ctx)
      const op = getOp(ctx.state, a.operativeId)
      const rules = ruleSetFor(ctx.state, op, a.weaponId!, 'shoot', seq.targetId, ctx)
      const weapon = weaponOf(ctx.state, a.weaponId!)
      const at = countKinds(seq.atk.dice)
      const df = seq.def ? countKinds(seq.def.dice) : { normal: 0, crit: 0, fail: 0 }
      const plans = blockPlans(at.normal, at.crit, df.normal, df.crit, weaponDamage(ctx.state, a.operativeId, weapon.id, seq.targetId, 'shoot', ctx), rules.brutal)
      let plan = plans[0]!
      if (p.mode !== 'auto' && Array.isArray(p.unblocked)) {
        const [rn, rc] = p.unblocked as number[]
        plan = plans.find((x) => x.unblockedNormal === rn && x.unblockedCrit === rc) ?? plan
      }
      void state
      applyBlock(ctx, plan)
    },
  }
}

/** weapon.choice answers while a shoot sequence is open: the cover/obscured conflict or a hook request. */
export function shootChoice(ctx: Ctx, choice: string, option: string): void {
  const a = attackOf(ctx)
  const s = ctx.state
  ctx.emit({ type: 'ChoiceMade', seat: a.seq ? getOp(s, a.seq.targetId).seat : a.seat, choice, option })
  if (choice === 'coverOrObscured') {
    const op = getOp(s, a.operativeId)
    const target = getOp(s, a.targets[a.index]!)
    const rules = ruleSetFor(s, op, a.weaponId!, 'shoot', target.id, ctx)
    const info = targetInfo(s, op, target, rules)
    const st = option === 'cover' ? info.verdict.ifCover : info.verdict.ifObscured
    beginRoll(ctx, st.inCover, st.obscured, info.improvedCover && st.inCover)
    return
  }
  const seq = seqOf(ctx)
  seq.choices[choice] = option
  const step = a.resume
  a.resume = undefined
  if (step) STEPS[step]!(ctx)
}

/** dice.reroll / dice.commandReroll while a shoot sequence is open. */
export function shootReroll(state: GameState, action: Action, pending: PendingDecision): Handled {
  const a = state.attack
  if (!a?.seq) return reject('E_WRONG_DECISION', 'no sequence is waiting for a re-roll')
  const side = sideOfStage(a, a.seq)
  if (!side) return reject('E_WRONG_DECISION', 'no dice are waiting for a re-roll')
  const which: 'atk' | 'def' = a.stage === 'attackReroll' ? 'atk' : 'def'
  if (action.type === 'pass') {
    return {
      run(ctx) {
        const sd = which === 'atk' ? seqOf(ctx).atk : seqOf(ctx).def!
        sd.phase = pending.kind === 'dice.reroll' ? 'command' : 'done'
        advanceWindow(ctx, which)
      },
    }
  }
  if (action.type !== 'dice.reroll' && action.type !== 'dice.commandReroll') return reject('E_WRONG_DECISION', 'expected a re-roll')
  const parsed = parseReroll(state, side, action.payload)
  if ('rejection' in parsed) return parsed
  return {
    run(ctx) {
      const sd = which === 'atk' ? seqOf(ctx).atk : seqOf(ctx).def!
      applyReroll(ctx, sd, parsed, which === 'atk' ? 'attack' : 'defence', 'shoot')
      if (parsed.command) sd.phase = 'done'
      advanceWindow(ctx, which)
    },
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const shootModule: ModuleDef = {
  id: 'shoot',
  namespaces: ['shoot'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'shoot.weapon':
        return handleWeapon(state, action)
      case 'shoot.target':
        return handleTarget(state, action)
      case 'shoot.coverSave':
        return handleCover(state, action)
      case 'shoot.block':
        return handleBlock(state, action)
      default:
        return reject('E_WRONG_DECISION', `${pending.kind} does not belong to the Shoot sequence`)
    }
  },
  explain(state, action, pending): Rejection | null {
    if (pending.kind === 'shoot.weapon' && action.type === 'shoot.weapon') {
      const a = state.attack
      const op = a ? state.operatives[a.operativeId] : undefined
      const id = String(action.payload.weaponId)
      if (!op || !op.weapons.includes(id)) return { code: 'E_NOT_AN_OPTION', reason: `${id} is not one of this operative's weapons` }
      const w = state.data.weapons[id]
      if (w?.type !== 'ranged') return { code: 'E_NOT_AN_OPTION', reason: `${id} is not a ranged weapon` }
      const act = state.firefight.activation
      return weaponUnusable(state, op, id, act?.performed ?? [], 'shoot') ?? { code: 'E_INVALID_TARGET', reason: `${w.name} has no valid target` }
    }
    if (pending.kind === 'shoot.target' && action.type === 'shoot.target') {
      return explainTarget(state, String(action.payload.targetId))
    }
    return null
  },
}

function explainTarget(state: GameState, targetId: string): Rejection | null {
  const a = state.attack
  if (!a) return null
  const op = state.operatives[a.operativeId]
  const t = state.operatives[targetId]
  if (!op || !t || t.status !== 'active') return { code: 'E_INVALID_TARGET', reason: `${targetId} is not on the killzone` }
  if (t.seat === op.seat) return { code: 'E_INVALID_TARGET', reason: 'cannot target a friendly operative' }
  if (a.stage === 'secondary') return { code: 'E_INVALID_TARGET', reason: `${targetId} is not an available secondary target` }
  const w = a.weaponId ? ruleSetFor(state, op, a.weaponId, 'shoot', targetId) : null
  if (w?.range !== null && w && !(distanceBetween(bodyOf(op), bodyOf(t)) <= w.range + 1e-6)) {
    return { code: 'E_OUT_OF_RANGE', reason: `${targetId} is beyond the weapon's Range` }
  }
  const info = w ? targetInfo(state, op, t, w) : null
  if (info && !info.verdict.visible) return { code: 'E_NOT_VISIBLE', reason: `${targetId} is not visible` }
  return { code: 'E_INVALID_TARGET', reason: `${targetId} is not a valid target` }
}
