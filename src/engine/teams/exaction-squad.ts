// Exaction Squad (docs/spec/13-teams.md section 24, rule ids T-EX.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - Assault Shield (T-EX.7): the set-up hook of its ability writes the Proctor's Save once.
//  - Nuncio-aquila (T-EX.8, 9): a team marker `ex.nuncio`; providers actionCostDelta and controlTotal; the marker leaves
//    with the Proctor on `operative.removed`.
//  - Medic! and MEDIKIT (T-EX.10, 11): the Kasrkin path under `ex.` names (beforeIncapacitated, a floor on damage, the free
//    Dash as a reaction or a 0 CP offer).
//  - Handler, Attack Pattern, R-VR Command, Beast, Apprehend (T-EX.12 to 16): a 0 CP joint-activation offer, a TP1 gambit
//    with a battle effect on the mastiff, providers for Move and weapon rules, and a live token check for Apprehend.
//  - Engendered Focus and Stubborn Subjugator (T-EX.17, 26): flags plus one Hit/Atk clamp inside the modifyAttackDice
//    handler (after Apprehend's +1 for enemies).
//  - Marked for Justice (T-EX.30): a gambit effect plus a re-pick offered as a reaction in one round after the mark fell
//    (a window stepped at each action end, see armRepick; it does not read the kill log).
//  - Ruthless Efficiency, Close Quarters Vigilance, Guilt Reveals Itself (T-EX.27, 29, 32): one beforeShootTargetSelect
//    handler that adds back the targets core dropped for exactly those reasons.
//  - Ploys and equipment: flag ploys read by the weapon-rule and defence handlers; the firefight ploys with their windows;
//    0 CP offers (Handler, Medic! Dash, Special Issue Shells, the Execution Order strike) through the ploy rule.
import { applyAplEffect, continueRemovals, hasRule, ruleKey, ruleSetFor, saveFromRemoval, targetInfo, torrentCandidates, validTargets } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { allowedOrders } from '../abilities'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, addTpUse, markUsedBattle, markUsedTp, regainWounds, removeEffects, spendCp, tpUsesOf, usedThisBattle, usedThisTp } from '../effects'
import { afterActiveOperativeRemoved, canStartFreeAction, cancelAction, finishAction, joinActivation, REACTION_DONE, reactionDone, startFreeAction } from '../firefight'
import { registerFrameResume, registerHook, type ActionDeclaredData, type BeforeShootTargetSelectData, type ModifyAttackDiceData, type OperativeRemovedData } from '../hooks'
import { bodyOf, visible } from '../los'
import { controlledBy, newMarkerId, removeMarker } from '../markers'
import { distanceBetween, enemiesInControlRange, gapToMarker, inControlRange, isWithin, whollyWithinRegion } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { continueWindow } from '../ploys'
import type { Ctx } from '../registry'
import { usableRangedWeapons } from '../shoot'
import { activeOps, effectiveMove, enemiesOf, hasInjuredPenalty } from '../state'
import { resumeGambit } from '../strategy'
import { providerAny, registerTeamRules, type ReactionInfo, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, moveTokenTo, removeToken, removeTokensWhere } from '../tokens'
import type { Activation, GameState, Marker, Operative, RollTarget, Seat, Vec2, WeaponRuleRef } from '../types'

export const TEAM_ID = 'exaction-squad'

const EX = 'EXACTION SQUAD'
const EPS = 1e-6

const A = (id: string) => `ex.a.${id}`
const P = (id: string) => `ex.p.${id}`
const E = (id: string) => `ex.e.${id}`
const X = (id: string) => `ex.x.${id}`

const PICK_UP = 'marker:pickUp'
const PLACE = 'marker:place'
const ABILITY = (id: string) => `ability:${id}`

const ID = {
  repress: A('wr-repress'),
  concealed: A('wr-concealed-position'),
  shield: A('assault-shield'),
  nuncio: A('nuncio-aquila'),
  deploy: A('deploy-nuncio-aquila'),
  medic: A('medic'),
  medikit: A('medikit'),
  handler: A('handler'),
  pattern: A('attack-pattern'),
  command: A('r-vr-command'),
  beast: A('beast'),
  apprehend: A('apprehend'),
  focus: A('engendered-focus'),
  zealous: A('zealous-dedication'),
  arrest: A('castigators-arrest'),
  acute: A('acute-focus'),
  veriscant: A('veriscant'),
  optics: A('optics'),
  fitf: A('first-in-the-field'),
  spot: A('spot'),
  subjugator: A('stubborn-subjugator'),
  cqv: A('close-quarters-vigilance'),
  signal: A('signal'),
  marked: P('marked-for-justice'),
  patternPloy: P('attack-pattern'),
  fitfPloy: P('first-in-the-field'),
  guilt: P('guilt-reveals-itself'),
  inviolate: P('inviolate-jurisdiction'),
  dispense: P('dispense-justice'),
  decree: P('terminal-decree'),
  longArm: P('long-arm'),
  exact: P('exact-punishment'),
  backup: P('brutal-backup'),
  execution: P('execution-order'),
  visor: E('reinforced-mirror-visor'),
  manacles: E('manacles'),
  strobing: E('strobing-phosphor-lumen'),
  shells: E('special-issue-shells'),
}

// effects (kinds) and tokens
const FX = {
  mark: 'ex.mark',
  pattern: 'ex.pattern',
  only: 'ex.onlyTarget',
  attacked: 'ex.attacked',
  longArm: 'ex.longArm',
  shells: 'ex.shells',
  execution: 'ex.executionOrder',
  medicFloor: 'ex.medicFloor',
  medicDash: 'ex.medicDash',
  acute: 'ex.acuteFocus',
}
const T = {
  mark: 'ex.marked-for-justice',
  medic: 'ex.medic',
  apprehend: 'ex.apprehend',
  veriscant: 'ex.veriscant',
  spot: 'ex.revelatum-spot',
  optics: 'ex.marksman-optics',
  aggressive: 'ex.aggressive',
  swift: 'ex.swift',
  defensive: 'ex.defensive',
}
const NUNCIO = 'ex.nuncio'
const SHELLS_TP = 'ex.shells.tp'
const SHELLS_PER_TP = 2

const BITE = 'ex.w.mechanical-bite'
const CONCEALED = 'ex.w.executioner-shotgun-concealed'
const EXECUTIONER_GROUP = 'ex.wg.executioner-shotgun'
const MAUL_SET = 'ex.w.dominator-maul-assault-shield'

export const PATTERNS = ['aggressive', 'swift', 'defensive'] as const
export type Pattern = (typeof PATTERNS)[number]
const PATTERN_NAME: Record<Pattern, string> = { aggressive: 'Aggressive', swift: 'Swift', defensive: 'Defensive' }

/** Rules the data names that are passive: they register their name so the data may reference them. */
for (const name of [
  'exRepress',
  'exConcealedPosition',
  'exAssaultShield',
  'exNuncioAquila',
  'exBeast',
  'exEngenderedFocus',
  'exZealousDedication',
  'exCastigatorsArrest',
  'exAcuteFocus',
  'exStubbornSubjugator',
  'exCloseQuartersVigilance',
  'exRuthlessEfficiency',
  'exMirrorVisor',
  'exManacles',
  'exStrobing',
  'exSpecialIssueShells',
  'exHandler',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isEx(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, EX)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function exOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isEx(state, o))
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function gap(a: Operative, b: Operative): number {
  return distanceBetween(bodyOf(a), bodyOf(b))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return gap(a, b) <= inches + EPS
}

function opEffect(state: GameState, kind: string, opId: string) {
  return state.effects.find((e) => e.kind === kind && e.operativeId === opId)
}

function isGrenade(weaponId: string): boolean {
  return weaponId === 'core.w.frag-grenade' || weaponId === 'core.w.krak-grenade'
}

/** The activation the operative itself is in (a free action frame sits on top of it), or null. */
function ownActivation(state: GameState, op: Operative): Activation | null {
  const cur = state.firefight.activation
  if (!cur) return null
  const base = cur.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : cur
  if (!base || base.counteract) return null
  if (base.operativeId === op.id) return base
  return base.partner && base.partner.operativeId === op.id ? base.partner : null
}

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState): Activation | null {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

function sees(state: GameState, a: Operative, b: Operative): boolean {
  return visible(state, bodyOf(a), bodyOf(b))
}

function inCr(state: GameState, a: Operative, b: Operative): boolean {
  return inControlRange(state, bodyOf(a), bodyOf(b))
}

const opt = (id: string, labelKey: string, data: Record<string, unknown> = {}) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, data })

function setOrder(ctx: Ctx, op: Operative, order: 'engage' | 'conceal'): void {
  if (op.order === order) return
  if (op.flags.guard) {
    op.flags.guard = false
    ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'order' }, op.seat)
  }
  op.order = order
  ctx.emit({ type: 'OrderSet', operativeId: op.id, order })
}

/** A 0 CP (or priced) offer the ploy rule adds to a window. */
function offer(id: string, name: string, via: string, op: Operative | undefined, param?: string, cost = 0): PloyOffer {
  return { id, ployId: id.split(':')[0]!, name, ...(param ? { param } : {}), ...(op ? { operativeId: op.id } : {}), cost, via, seed: param ? { param } : {} }
}

function addRuleOnce(rules: WeaponRuleRef[], ref: WeaponRuleRef): boolean {
  if (rules.some((r) => ruleKey(r.rule) === ruleKey(ref.rule) && (ref.rule !== 'lethal' || (r.target ?? 6) <= (ref.target ?? 6)))) return false
  rules.push(ref)
  return true
}

const SHELLS_NAMES = ['combat shotgun', 'executioner shotgun', 'scoped shotpistol', 'shotpistol']

/** A Shells weapon (T-EX.5): combat shotgun, executioner shotgun, scoped shotpistol or shotpistol, every profile. */
export function isShellsWeapon(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  return !!w && w.type === 'ranged' && SHELLS_NAMES.includes(w.name.toLowerCase().replace(/\s*\(.*\)$/, ''))
}

function hasRangeRule(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  return !!w && w.rules.some((r) => ruleKey(r.rule) === 'range')
}

// ---------------------------------------------------------------------------
// Assault Shield (T-EX.7)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'exAssaultShield',
  /** the 3+ Save is the stat for the whole battle: written once at set-up from the loadout */
  setup(ctx, seat) {
    for (const op of Object.values(ctx.state.operatives)) {
      if (op.seat !== seat || !hasAbility(ctx.state, op, ID.shield) || !op.weapons.includes(MAUL_SET)) continue
      op.save = 3
      markFired('exAssaultShield')
    }
  },
})

// ---------------------------------------------------------------------------
// Nuncio-aquila and DEPLOY NUNCIO-AQUILA (T-EX.8, T-EX.9)
// ---------------------------------------------------------------------------

function nuncioMarker(state: GameState, seat: Seat): Marker | undefined {
  return state.markers.find((m) => m.equipmentId === NUNCIO && m.owner === seat)
}

function proctorOf(state: GameState, seat: Seat): Operative | undefined {
  return exOps(state, seat).find((o) => hasAbility(state, o, ID.nuncio))
}

/** Is `op` within 3 inches of the centre of the Nuncio-aquila `seat` owns (the marker, else the Proctor)? */
function nearNuncio(state: GameState, seat: Seat, op: Operative): boolean {
  const m = nuncioMarker(state, seat)
  if (m) return gapToMarker(bodyOf(op), m) <= 3 + EPS
  const p = proctorOf(state, seat)
  return !!p && p.id !== op.id && within(op, p, 3)
}

function nuncioSeats(state: GameState, victim: Seat): Seat[] {
  return (['A', 'B'] as const).filter((s) => s !== victim && state.players[s].teamId === TEAM_ID)
}

function isMissionAction(state: GameState, actionId: string): boolean {
  const id = actionId.startsWith('ability:') ? actionId.slice('ability:'.length) : actionId
  const def = state.data.abilities[id]
  return !!def && (def.keywords ?? []).includes('MISSION')
}

/** Spots the Nuncio-aquila may be placed on: within 6 inches horizontally of the Proctor, or of the marker's place. */
function nuncioSpots(state: GameState, proctor: Operative): Vec2[] {
  const out: Vec2[] = []
  const seen = new Set<string>()
  const marker = nuncioMarker(state, proctor.seat)
  const origin = marker ? { x: marker.pos.x, z: marker.pos.z, r: 0 } : { x: proctor.pos.x, z: proctor.pos.z, r: proctor.baseRadius }
  const add = (x: number, z: number) => {
    const p = { x: Math.round(x * 20) / 20, z: Math.round(z * 20) / 20 }
    if (Math.abs(p.x) > 14.8 || Math.abs(p.z) > 10.8) return
    if (Math.max(0, Math.hypot(p.x - origin.x, p.z - origin.z) - origin.r) > 6 + EPS) return
    const k = `${p.x},${p.z}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(p)
  }
  add(origin.x, origin.z)
  for (const e of enemiesOf(state, proctor)) if (live(e)) add(e.pos.x, e.pos.z)
  for (const m of state.markers) if (m.kind === 'objective') add(m.pos.x, m.pos.z)
  for (const d of [1.5, 3, 4.5, 6]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      add(origin.x + Math.sin(a) * (d + origin.r), origin.z + Math.cos(a) * (d + origin.r))
    }
  }
  return out.slice(0, 28)
}

registerCodeHook({
  name: 'exDeployNuncio',
  action: {
    offers(state, op): OfferSeed[] {
      return hasAbility(state, op, ID.deploy) && nuncioSpots(state, op).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const spots = nuncioSpots(ctx.state, op)
      if (spots.length === 0) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'exDeployNuncio', operativeId: op.id, abilityId: def.id },
        options: spots.map((p) => opt(`${p.x},${p.z}`, 'ex.nuncio.place', { x: p.x, z: p.z })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const s = ctx.state
    const [x, z] = option.split(',').map(Number) as [number, number]
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      cancelAction(ctx)
      return
    }
    const existing = nuncioMarker(s, op.seat)
    if (existing) {
      existing.pos = { x, z }
      ctx.emit({ type: 'MarkerPlaced', markerId: existing.id, operativeId: op.id, pos: { x, z } }, op.seat)
    } else {
      const marker: Marker = { id: newMarkerId(ctx, 'exnun'), kind: 'equipment', pos: { x, z }, owner: op.seat, carriedBy: null, controller: null, equipmentId: NUNCIO, placedBy: op.id }
      s.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: { x, z } }, op.seat)
    }
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId) }, op.seat)
    finishAction(ctx)
  },
})

// the marker leaves with the Proctor
registerHook(
  'operative.removed',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    void (c.data as unknown as OperativeRemovedData)
    if (hasAbility(s, op, ID.nuncio)) {
      for (const m of [...s.markers]) if (m.equipmentId === NUNCIO && m.owner === op.seat) removeMarker(ctx, m.id, 'ex.nuncio.proctorRemoved')
    }
    // Execution Order: the lock lifts when the named enemy is incapacitated
    removeEffects(ctx, (e) => e.kind === FX.execution && e.operativeId === op.id)
    return null
  },
  'ex.operative.removed',
)

// ---------------------------------------------------------------------------
// Medic! and MEDIKIT (T-EX.10, T-EX.11)
// ---------------------------------------------------------------------------

function baseOf(s: GameState): Activation | null {
  return baseActivation(s)
}

function medicFor(s: GameState, victim: Operative): Operative | null {
  if (!isEx(s, victim) || victim.status !== 'active') return null
  if (inEnemyCr(s, victim)) return null
  const a = s.attack
  for (const m of exOps(s, victim.seat)) {
    if (!hasAbility(s, m, ID.medic) || m.id === victim.id || usedThisTp(s, m.seat, `ex.medic:${m.id}`)) continue
    if (gap(m, victim) > 3 + EPS) continue
    if (!sees(s, m, victim)) continue
    if (inEnemyCr(s, m)) continue
    // in a Shoot action the Chirurgant must not be a primary or secondary target
    if (a?.kind === 'shoot' && a.targets.includes(m.id)) continue
    return m
  }
  return null
}

registerCodeHook({
  name: 'exMedic',
  /** the save asked in the deferred removal queue, or the free Dash after the action into the Chirurgant's control range */
  choice(ctx, op, option, context) {
    if (context.stage === 'save') {
      const s = ctx.state
      const medic = s.operatives[String(context.medicId)]
      if (option === 'use' && medic && op.status === 'active' && saveFromRemoval(ctx, op.id, 1)) applyMedic(ctx, medic, op)
      // declined: the first time this turning point has passed, so the chance is gone
      else if (medic) markUsedTp(s, medic.seat, `ex.medic:${medic.id}`)
      continueRemovals(ctx)
      return
    }
    const fx = ctx.state.effects.find((e) => e.kind === FX.medicDash && e.operativeId === op.id)
    if (!fx) {
      reactionDone(ctx)
      return
    }
    removeEffects(ctx, (e) => e.id === fx.id)
    const started = startFreeAction(ctx, { operativeId: op.id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: REACTION_DONE })
    if (!started) reactionDone(ctx)
  },
})

/** Medic!'s effect on the saved `victim` (T-EX.10): the floor for the rest of the action, the Dash after it, APL -1 for both. */
function applyMedic(ctx: Ctx, medic: Operative, victim: Operative): void {
  const s = ctx.state
  markUsedTp(s, medic.seat, `ex.medic:${medic.id}`)
  markUsedTp(s, medic.seat, `ex.medic.saved:${victim.id}`)
  addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: FX.medicFloor, operativeId: victim.id, expires: 'action' })
  // the activation the rule was used in: the one under a frame (an enemy Guard interrupt, a free action) counts
  const under = baseOf(s)
  const own = !!under && !under.counteract && under.operativeId === victim.id
  if (own) under.endsAfterAction = true
  addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: FX.medicDash, operativeId: victim.id, expires: 'activation', data: { medicId: medic.id } })
  addToken(ctx, victim.id, { kind: T.medic, owner: victim.seat, cap: 1, expires: ['turningPointEnd'] }, 'ex.medic')
  applyAplEffect(ctx, victim.id, -1, ID.medic)
  applyAplEffect(ctx, medic.id, -1, ID.medic)
  ctx.emit({ type: 'AbilityUsed', operativeId: medic.id, abilityId: ID.medic, detail: victim.id }, medic.seat)
  markFired('exMedic')
}

// Inside an attack the damage pipeline cannot pause: Medic! is used automatically when the damage would incapacitate.
// Outside attacks (rule damage, mines) the removal waits for the deferred queue (pausableRemoval) and the owner is asked.
registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !victim || (!s.attack && !s.removal)) return null
    const medic = medicFor(s, victim)
    if (!medic) return null
    const data = c.data as { wounds: number }
    data.wounds = 1
    applyMedic(ctx, medic, victim)
    return null
  },
  'ex.beforeIncapacitated',
)

// Outside attacks: the falling friend waits in the deferred removal queue, where its owner may use Medic! or decline it
registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !victim || !s.removal?.deferred || s.pending || victim.wounds > 0) return null
    const medic = medicFor(s, victim)
    if (!medic) return null
    ctx.raise({
      kind: 'ability.choice',
      seat: victim.seat,
      window: 'operative.incapacitated',
      context: { hook: 'exMedic', stage: 'save', operativeId: victim.id, medicId: medic.id },
      options: [opt('use', X('medicUse'), { name: `Medic!: ${medic.name} keeps ${victim.name} in the fight on 1 wound` }), opt('decline', X('medicDecline'), { name: `Let ${victim.name} fall` })],
    })
    return null
  },
  'ex.operative.incapacitated',
)

/** Friendly Exaction operatives in `op`'s control range, itself included (MEDIKIT). */
function crFriends(state: GameState, op: Operative, f: Operative): boolean {
  return f.id === op.id || (distanceBetween(bodyOf(op), bodyOf(f)) <= 1 + EPS && (visible(state, bodyOf(op), bodyOf(f), { crMode: true }) || visible(state, bodyOf(f), bodyOf(op), { crMode: true })))
}

registerCodeHook({
  name: 'exMedikit',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of exOps(state, op.seat)) {
        if (f.wounds >= f.maxWounds || !crFriends(state, op, f)) continue
        if (usedThisTp(state, op.seat, `ex.medic.saved:${f.id}`)) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || !isEx(ctx.state, target)) {
        cancelAction(ctx)
        return
      }
      const dice = ctx.roll('ex.medikit.2d3', 2)
      const amount = dice.reduce((n, d) => n + Math.ceil(d / 2), 0)
      regainWounds(ctx, target.id, amount, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Handler (T-EX.12): offered by the ploy rule at the Leashmaster's activation start (see exPloyRule)
// ---------------------------------------------------------------------------

function mastiffsOf(state: GameState, seat: Seat): Operative[] {
  return exOps(state, seat).filter((o) => hasAbility(state, o, ID.beast))
}

// ---------------------------------------------------------------------------
// Attack Pattern and R-VR COMMAND (T-EX.13, T-EX.14)
// ---------------------------------------------------------------------------

export function patternsOf(state: GameState, op: Operative): Pattern[] {
  const fx = opEffect(state, FX.pattern, op.id)
  return Array.isArray(fx?.data?.patterns) ? (fx!.data!.patterns as Pattern[]) : []
}

function hasPattern(state: GameState, op: Operative, p: Pattern): boolean {
  return hasAbility(state, op, ID.beast) && patternsOf(state, op).includes(p)
}

function setPatternTokens(ctx: Ctx, op: Operative, patterns: Pattern[]): void {
  for (const p of PATTERNS) removeToken(ctx, op.id, T[p], 'ex.pattern.changed', op.seat)
  for (const p of patterns) addToken(ctx, op.id, { kind: T[p], owner: op.seat, cap: 1, expires: ['battle'] }, 'ex.pattern')
}

/** Defensive improves the mastiff's Save by 1: written into the stat while the pattern is held. */
function setDefensive(op: Operative, on: boolean): void {
  const next = Math.max(2, Math.min(6, op.save + (on ? -1 : 1))) as RollTarget
  op.save = next
}

function applyPatterns(ctx: Ctx, op: Operative, patterns: Pattern[]): void {
  const before = patternsOf(ctx.state, op)
  const had = before.includes('defensive')
  const has = patterns.includes('defensive')
  removeEffects(ctx, (e) => e.kind === FX.pattern && e.operativeId === op.id)
  addEffect(ctx, { source: ID.pattern, seat: op.seat, kind: FX.pattern, operativeId: op.id, expires: 'battle', data: { patterns: [...patterns] } })
  if (has && !had) setDefensive(op, true)
  if (!has && had) setDefensive(op, false)
  setPatternTokens(ctx, op, patterns)
}

registerCodeHook({
  name: 'exAttackPattern',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.turningPoint !== 1) return []
      const leash = exOps(state, seat).find((o) => hasAbility(state, o, ID.pattern))
      if (!leash) return []
      if (!mastiffsOf(state, seat).some((m) => patternsOf(state, m).length === 0)) return []
      const pairs: string[] = []
      for (let i = 0; i < PATTERNS.length; i++) for (let j = i + 1; j < PATTERNS.length; j++) pairs.push(`${PATTERNS[i]}+${PATTERNS[j]}`)
      return pairs.map((param) => ({ param }))
    },
    apply(ctx, seat, _ploy, seed) {
      const picks = (seed.param ?? '').split('+').filter((k): k is Pattern => (PATTERNS as readonly string[]).includes(k))
      const dog = mastiffsOf(ctx.state, seat).find((m) => patternsOf(ctx.state, m).length === 0)
      if (!dog || picks.length !== 2 || picks[0] === picks[1]) return
      applyPatterns(ctx, dog, picks)
      const leash = exOps(ctx.state, seat).find((o) => hasAbility(ctx.state, o, ID.pattern))
      ctx.emit({ type: 'AbilityUsed', operativeId: leash?.id ?? null, abilityId: ID.pattern, detail: picks.join('+') }, seat)
      markFired('exAttackPattern')
    },
  },
})

registerCodeHook({
  name: 'exCommand',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const m of mastiffsOf(state, op.seat)) {
        const held = patternsOf(state, m)
        if (held.length !== 2) continue
        const missing = PATTERNS.find((p) => !held.includes(p))!
        for (const h of held) out.push({ key: `${m.id}:${h}`, params: { targetId: m.id, param: `${h}>${missing}` } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const dog = ctx.state.operatives[params.targetId as string]
      const [from, to] = String(params.param ?? '').split('>') as [Pattern, Pattern]
      if (!live(dog)) {
        cancelAction(ctx)
        return
      }
      const held = patternsOf(ctx.state, dog)
      if (held.length !== 2 || !held.includes(from) || held.includes(to)) {
        cancelAction(ctx)
        return
      }
      applyPatterns(ctx, dog, held.map((p) => (p === from ? to : p)))
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: `${dog.id}:${from}>${to}` }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Beast and APPREHEND (T-EX.15, T-EX.16)
// ---------------------------------------------------------------------------

const BEAST_ACTIONS = ['charge', 'dash', 'fallBack', 'fight', 'guard', 'reposition', ABILITY(ID.apprehend), PICK_UP, PLACE]

/** The enemy is apprehended: it holds the token and still stands in the control range of the mastiff that placed it. */
export function apprehended(state: GameState, enemy: Operative): boolean {
  if (!live(enemy)) return false
  const t = (enemy.tokens ?? []).find((k) => k.kind === T.apprehend && k.count > 0)
  const by = t ? state.operatives[String(t.data?.by ?? t.sourceId ?? '')] : undefined
  return !!t && live(by) && by.seat !== enemy.seat && inCr(state, by, enemy)
}

registerCodeHook({
  name: 'exApprehend',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesInControlRange(state, op, op.seat)
        .filter((e) => live(e))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || target.seat === op.seat || !inCr(ctx.state, op, target)) {
        cancelAction(ctx)
        return
      }
      // using it again releases the first enemy
      removeTokensWhere(ctx, (t) => t.kind === T.apprehend && t.data?.by === op.id, 'ex.apprehend.replaced')
      addToken(ctx, target.id, { kind: T.apprehend, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceIncapacitated'], data: { by: op.id } }, 'ex.apprehend')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// VERISCANT, OPTICS, SPOT, SIGNAL (T-EX.21, 23, 25, 28)
// ---------------------------------------------------------------------------

function veriscanted(state: GameState, foe: Operative, seat: Seat): boolean {
  return hasToken(state, foe.id, T.veriscant, seat)
}

registerCodeHook({
  name: 'exVeriscant',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => live(e) && sees(state, op, e))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || target.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      removeTokensWhere(ctx, (t) => t.kind === T.veriscant && t.sourceId === op.id, 'ex.veriscant.replaced')
      addToken(ctx, target.id, { kind: T.veriscant, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'ex.veriscant')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'exOptics',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      removeToken(ctx, op.id, T.optics, 'ex.optics.replaced', op.seat)
      addToken(ctx, op.id, { kind: T.optics, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'ex.marksman-optics')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'exSpot',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => live(e) && within(op, e, 8) && sees(state, op, e))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || target.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      addToken(ctx, target.id, { kind: T.spot, owner: op.seat, cap: 1, sourceId: op.id, expires: ['turningPointEnd'] }, 'ex.revelatum-spot')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'exSignal',
  action: {
    offers(state, op): OfferSeed[] {
      return exOps(state, op.seat)
        .filter((f) => f.id !== op.id && sees(state, op, f))
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || target.id === op.id || !isEx(ctx.state, target)) {
        cancelAction(ctx)
        return
      }
      applyAplEffect(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// First in the Field (T-EX.24) and MARKED FOR JUSTICE (T-EX.30): the two Exaction gambits
// ---------------------------------------------------------------------------

function dropZoneOf(state: GameState, seat: Seat) {
  return state.map.dropZones.find((z) => z.id === state.players[seat].dropZoneId)?.polygon ?? null
}

registerCodeHook({
  name: 'exFirstInTheField',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.turningPoint !== 1) return []
      const zone = dropZoneOf(state, seat)
      if (!zone) return []
      return exOps(state, seat)
        .filter((o) => hasAbility(state, o, ID.fitf) && whollyWithinRegion(bodyOf(o), zone))
        .map((o) => ({ param: o.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const op = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!live(op)) return
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.fitf }, seat)
      markFired('exFirstInTheField')
      // the free Reposition: the Gambit step resumes once it is over (nothing starts when it cannot)
      startFreeAction(ctx, { operativeId: op.id, action: 'reposition', resume: 'ex.fitf' })
    },
  },
})

registerFrameResume('ex.fitf', (ctx) => resumeGambit(ctx))

function markFx(state: GameState, seat: Seat) {
  return state.effects.find((e) => e.kind === FX.mark && e.seat === seat)
}

/** The seat's living mark for this turning point. */
export function markOf(state: GameState, seat: Seat): Operative | undefined {
  const id = markFx(state, seat)?.data?.markId
  const m = typeof id === 'string' ? state.operatives[id] : undefined
  return live(m) ? m : undefined
}

function enemiesByThreat(state: GameState, seat: Seat): Operative[] {
  const mine = exOps(state, seat)
  const near = (e: Operative) => (mine.length ? Math.min(...mine.map((m) => gap(m, e))) : 0)
  return activeOps(state)
    .filter((o) => o.seat !== seat && live(o))
    .sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1))
}

registerCodeHook({
  name: 'exMarkedForJustice',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (exOps(state, seat).length === 0) return []
      return enemiesByThreat(state, seat).map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, ploy, seed) {
      const id = seed.param
      if (!id || !live(ctx.state.operatives[id])) return
      removeEffects(ctx, (e) => e.kind === FX.mark && e.seat === seat)
      addEffect(ctx, { source: ploy.id, seat, kind: FX.mark, expires: 'turningPoint', data: { markId: id } })
      moveTokenTo(ctx, T.mark, seat, id, { expires: ['turningPointEnd'] }, 'ex.marked-for-justice')
      const lead = exOps(ctx.state, seat)[0]
      ctx.emit({ type: 'AbilityUsed', operativeId: lead?.id ?? null, abilityId: ploy.id, detail: id }, seat)
    },
  },
  /** the new mark, picked as a reaction after the action in which the mark fell */
  choice(ctx, op, option, _context) {
    const s = ctx.state
    const fx = markFx(s, op.seat)
    const target = s.operatives[option]
    if (fx && live(target) && target.seat !== op.seat) {
      fx.data = { ...(fx.data ?? {}), markId: target.id }
      moveTokenTo(ctx, T.mark, op.seat, target.id, { expires: ['turningPointEnd'] }, 'ex.markedForJustice.repick')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.marked, detail: target.id }, op.seat)
    }
    reactionDone(ctx)
  },
})

/**
 * The re-pick window (T-EX.30), kept on the mark effect and stepped at every action end (`action.ended`, which runs before
 * that action's ploy window and reaction round): a fallen mark is noted ('pending') at the first action end after it fell,
 * whatever removed it and whether or not the kill log is written yet; the next action end that is followed by a reaction
 * round (not a free action's frame, its actor still in the killzone) opens it for that round only ('open'); the action
 * end after that closes it, so a declined pick is never offered again. A new mark that falls later starts over.
 */
function armRepick(state: GameState): void {
  const act = state.firefight.activation
  const actor = act ? state.operatives[act.operativeId] : undefined
  const roundFollows = !!act && !act.frame && actor?.status === 'active'
  for (const fx of state.effects) {
    if (fx.kind !== FX.mark) continue
    const markId = String(fx.data?.markId ?? '')
    const mark = state.operatives[markId]
    if (!mark || live(mark)) continue
    let stage = fx.data?.repickFor === markId ? String(fx.data?.repick ?? '') : ''
    if (!stage) stage = 'pending'
    else if (stage === 'open' && roundFollows) stage = 'closed'
    if (stage === 'pending' && roundFollows) stage = 'open'
    fx.data = { ...(fx.data ?? {}), repickFor: markId, repick: stage }
  }
}

/**
 * The re-pick offers (T-EX.30): the mark fell and the window above is open for this reaction round, so the Exaction seat
 * may name a new one. One offer per live enemy; carried by an Exaction operative that has not yet reacted this round.
 */
function repickOffers(state: GameState, seat: Seat): ReactionOffer[] {
  const fx = markFx(state, seat)
  if (!fx) return []
  const markId = String(fx.data?.markId ?? '')
  const mark = state.operatives[markId]
  if (!mark || live(mark) || fx.data?.repickFor !== markId || fx.data?.repick !== 'open') return []
  const act = state.firefight.activation
  if (!act) return []
  const reacted = act.reacted?.ids ?? []
  const carrier = exOps(state, seat).find((o) => !reacted.includes(o.id)) ?? exOps(state, seat)[0]
  if (!carrier) return []
  return enemiesByThreat(state, seat).map((e) => ({
    hook: 'exMarkedForJustice',
    operativeId: carrier.id,
    option: e.id,
    labelKey: X('repick'),
    repeat: true,
    data: { name: `Marked for Justice: ${e.name} is the new mark`, targetId: e.id },
  }))
}

// ---------------------------------------------------------------------------
// Strategy ploys that are turning point flags the handlers read
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'exFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys: LONG ARM (T-EX.36), BRUTAL BACKUP (T-EX.38), EXACT PUNISHMENT (T-EX.37), EXECUTION ORDER (T-EX.39)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'exLongArm',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isEx(state, op) || info.action !== 'shoot') return []
      if (opEffect(state, FX.longArm, op.id)) return []
      const ok = op.weapons.some((w) => state.data.weapons[w]?.type === 'ranged' && hasRangeRule(state, w) && !isGrenade(w))
      return ok ? [{ operativeId: op.id }] : []
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (!id) return
      addEffect(ctx, { source: ploy.id, seat, kind: FX.longArm, operativeId: id, expires: 'action' })
      markFired('exLongArm')
    },
  },
})

/** The joint partner (or the activation's owner) has already Fought in this activation. */
function fightDone(act: Activation | null, opId: string): boolean {
  if (!act) return false
  if (act.operativeId === opId) return act.performed.includes('fight')
  return act.partner?.operativeId === opId && act.partner.performed.includes('fight')
}

/**
 * BRUTAL BACKUP (T-EX.38) pairs: for the friendly operative in the activation, each enemy in its control range with another
 * friendly operative (ready or not) that has that enemy in its control range and may still Fight.
 */
function backupPairs(state: GameState, seat: Seat, info: { subjectId?: string; counteracting?: boolean }): { enemy: Operative; fighter: Operative }[] {
  const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
  const act = state.firefight.activation
  if (!live(subject) || subject.seat !== seat || !isEx(state, subject) || info.counteracting || !act || act.frame || act.counteract) return []
  if (act.operativeId !== subject.id && act.partner?.operativeId !== subject.id) return []
  const out: { enemy: Operative; fighter: Operative }[] = []
  for (const e of enemiesInControlRange(state, subject, subject.seat)) {
    if (!live(e)) continue
    for (const f of exOps(state, seat)) {
      if (f.id === subject.id || !inCr(state, f, e) || fightDone(act, f.id)) continue
      if (!canStartFreeAction(state, { operativeId: f.id, action: 'fight', resume: '' })) continue
      out.push({ enemy: e, fighter: f })
    }
  }
  return out
}

registerCodeHook({
  name: 'exBrutalBackup',
  ploy: {
    // the offers are named pairs, added by the ploy rule (exPloyRule.extraOffers)
    offers(): PloyOfferSeed[] {
      return []
    },
    apply(ctx, seat, ploy, seed) {
      const [eid, fid] = (seed.param ?? '').split('+')
      const e = eid ? ctx.state.operatives[eid] : undefined
      const f = fid ? ctx.state.operatives[fid] : undefined
      if (!live(e) || !live(f)) return
      addEffect(ctx, { source: ploy.id, seat, kind: FX.only, operativeId: f.id, expires: 'action', data: { targetId: e.id } })
      markFired('exBrutalBackup')
      if (!startFreeAction(ctx, { operativeId: f.id, action: 'fight', resume: 'ex.free', data: { fighter: f.id } })) removeEffects(ctx, (x) => x.kind === FX.only && x.operativeId === f.id)
    },
  },
})

// a free action a ploy started is over: a joint partner that fought has used its Fight, then the window goes on
registerFrameResume('ex.free', (ctx, outcome, data) => {
  const s = ctx.state
  const act = s.firefight.activation
  const id = String(data.fighter ?? '')
  if (outcome === 'finished' && act && id) {
    if (act.operativeId === id && !act.performed.includes('fight')) act.performed.push('fight')
    else if (act.partner?.operativeId === id && !act.partner.performed.includes('fight')) act.partner.performed.push('fight')
  }
  if (s.window) continueWindow(ctx)
})

registerCodeHook({
  name: 'exExactPunishment',
  // the ploy is a reaction after an enemy's attack (see `reactions`); the window offers nothing of its own
  ploy: {
    offers(): PloyOfferSeed[] {
      return []
    },
    apply() {},
  },
  choice(ctx, op, option, context) {
    const s = ctx.state
    const [kind, enemyId] = option.split(':') as ['shoot' | 'fight', string]
    const seat = op.seat
    const enemy = s.operatives[enemyId ?? '']
    if (!live(op) || !live(enemy) || s.players[seat].cp < 1 || usedThisTp(s, seat, ID.exact)) {
      reactionDone(ctx)
      return
    }
    spendCp(ctx, seat, 1, ID.exact)
    markUsedTp(s, seat, ID.exact)
    ctx.emit({ type: 'PloyUsed', ployId: ID.exact }, seat)
    addEffect(ctx, { source: ID.exact, seat, kind: FX.only, operativeId: op.id, expires: 'action', data: { targetId: enemy.id } })
    markFired('exExactPunishment')
    // a Conceal operative takes the Shoot on Engage (as the other free interrupts of the teams do)
    const previous = op.order
    if (kind === 'shoot' && op.order === 'conceal') setOrder(ctx, op, 'engage')
    const started = startFreeAction(ctx, { operativeId: op.id, action: kind, interrupt: true, resume: 'ex.exact', data: { opId: op.id, previous, via: String(context.hook ?? '') } })
    if (!started) {
      removeEffects(ctx, (x) => x.kind === FX.only && x.operativeId === op.id)
      if (op.order !== previous) setOrder(ctx, op, previous)
      reactionDone(ctx)
    }
  },
})

/** Can `f` take a free Shoot at `e` right now (some usable ranged weapon sees it)? */
function canShootFree(state: GameState, f: Operative, e: Operative): boolean {
  const probe = f.order === 'conceal' ? { ...state, operatives: { ...state.operatives, [f.id]: { ...f, order: 'engage' as const } } } : state
  if (!canStartFreeAction(probe, { operativeId: f.id, action: 'shoot', resume: '' })) return false
  const actor = probe.operatives[f.id]!
  for (const w of usableRangedWeapons(probe, actor, [])) {
    if (validTargets(probe, actor, w).some((t) => t.id === e.id)) return true
  }
  return false
}

function lockOf(state: GameState, seat: Seat) {
  return state.effects.find((e) => e.kind === FX.execution && e.seat === seat)
}

function isMissionNotHatch(state: GameState, action: string | undefined): boolean {
  return !!action && isMissionAction(state, action) && !/hatch/i.test(action)
}

registerFrameResume('ex.exact', (ctx, outcome, data) => {
  const f = ctx.state.operatives[String(data.opId ?? '')]
  if (outcome === 'cancelled' && f && f.status === 'active' && f.order !== data.previous) setOrder(ctx, f, data.previous as 'engage' | 'conceal')
  reactionDone(ctx)
})

registerCodeHook({
  name: 'exExecutionOrder',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      if (lockOf(state, seat) || exOps(state, seat).length === 0) return []
      if (info.window === 'firefight.opponentActionDeclared') {
        const actor = info.actorId ? state.operatives[info.actorId] : undefined
        if (!live(actor) || actor.seat === seat || !isMissionNotHatch(state, info.action)) return []
        return [{ param: actor.id }]
      }
      return []
    },
    apply(ctx, seat, ploy, seed) {
      const e = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!live(e)) return
      removeEffects(ctx, (x) => x.kind === FX.execution && x.seat === seat)
      addEffect(ctx, { source: ploy.id, seat, kind: FX.execution, operativeId: e.id, expires: 'battle', data: { armedSeq: ctx.state.seq, live: false } })
      markFired('exExecutionOrder')
    },
  },
})

// the named enemy starts an activation: the strike is on offer from its first action; once it ends the lock lifts
registerHook(
  'activation.start',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op) return null
    const fx = opEffect(s, FX.execution, op.id)
    if (fx) fx.data = { ...(fx.data ?? {}), live: true }
    return null
  },
  'ex.activation.start',
)

registerHook(
  'activation.end',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || (c.data as { counteract?: boolean } | undefined)?.counteract) return null
    const fx = opEffect(s, FX.execution, op.id)
    if (fx?.data?.live === true) removeEffects(ctx, (e) => e.id === fx.id)
    return null
  },
  'ex.activation.end',
)

registerFrameResume('ex.exec', (ctx, outcome, data) => {
  const s = ctx.state
  const f = s.operatives[String(data.opId ?? '')]
  if (f && f.status === 'active') {
    f.ready = false
    ctx.emit({ type: 'OperativeExpended', operativeId: f.id }, f.seat)
  }
  if (outcome === 'cancelled' && f && f.status === 'active' && f.order !== data.previous) setOrder(ctx, f, data.previous as 'engage' | 'conceal')
  const act = s.firefight.activation
  const actor = act ? s.operatives[act.operativeId] : undefined
  if (!act || !actor || actor.status !== 'active' || actor.wounds <= 0) {
    // the named enemy fell to the strike: its activation ends with the action unperformed
    s.window = null
    afterActiveOperativeRemoved(ctx)
    return
  }
  continueWindow(ctx)
})

// ---------------------------------------------------------------------------
// Weapon rules: Marked for Justice, Veriscant, Spot, Optics, Terminal Decree, Dispense Justice, Long Arm, Special Issue
// Shells, Aggressive, and the Mirror-visor's Shock strip. One handler so the order is fixed.
// ---------------------------------------------------------------------------

/** DISPENSE JUSTICE: has not moved more than its Move in the activation, or fights outside one (counteraction, retaliation). */
function dispenseQualifies(s: GameState, op: Operative): boolean {
  const own = ownActivation(s, op)
  return !own || (op.movedThisActivation ?? 0) <= effectiveMove(op, s) + EPS
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const weapon = s.data.weapons[c.weaponId]
    if (!weapon) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const foe = target && target.seat !== op.seat ? target : undefined
    const shoot = data.kind === 'shoot'
    if (isEx(s, op)) {
      // MARKED FOR JUSTICE: Punishing against the mark (T-EX.30)
      const mark = markOf(s, op.seat)
      if (foe && mark && mark.id === foe.id && addRuleOnce(rules, { rule: 'punishing' })) markFired('exMarkedForJustice')
      // VERISCANT: Lethal 5+ and Severe against the marked enemy (T-EX.21)
      if (foe && veriscanted(s, foe, op.seat)) {
        const a = addRuleOnce(rules, { rule: 'lethal', target: 5 })
        const b = addRuleOnce(rules, { rule: 'severe' })
        if (a || b) markFired('exVeriscant')
      }
      if (shoot && weapon.type === 'ranged') {
        // SPOT: Seek Light against the spotted enemy (T-EX.25)
        if (foe && hasToken(s, foe.id, T.spot, op.seat) && addRuleOnce(rules, { rule: 'seek-light' })) markFired('exSpot')
        // OPTICS: Lethal 5+ on the concealed and stationary profiles (T-EX.23)
        if (weapon.profileGroup === EXECUTIONER_GROUP && weapon.id !== 'ex.w.executioner-shotgun-mobile' && hasToken(s, op.id, T.optics, op.seat) && addRuleOnce(rules, { rule: 'lethal', target: 5 })) markFired('exOptics')
        // TERMINAL DECREE: Balanced within 6", or always for a Gunner (T-EX.35)
        if (ployActive(s, op.seat, ID.decree) && (hasKeyword(s, op, 'GUNNER') || (foe && within(op, foe, 6))) && addRuleOnce(rules, { rule: 'balanced' })) markFired('exFlagPloy')
        // LONG ARM: Range x is 3" longer for the action (T-EX.36)
        if (opEffect(s, FX.longArm, op.id) && !isGrenade(weapon.id)) {
          let longer = false
          for (const r of rules) {
            if (ruleKey(r.rule) !== 'range') continue
            r.inches = (r.inches ?? r.x ?? 0) + 3
            longer = true
          }
          if (longer) markFired('exLongArm')
        }
        // SPECIAL ISSUE SHELLS: Saturate, or Piercing 1 against a Save of 3+ or better (T-EX.43)
        const shells = opEffect(s, FX.shells, op.id)
        if (shells && isShellsWeapon(s, weapon.id)) {
          if (shells.data?.kind === 'saturate' && addRuleOnce(rules, { rule: 'saturate' })) markFired('exSpecialIssueShells')
          if (shells.data?.kind === 'piercing' && foe && foe.save <= 3 && addRuleOnce(rules, { rule: 'piercing', x: 1 })) markFired('exSpecialIssueShells')
          // Torrent 1": the weapon has the rule for the action (rules that read Torrent see it), except at the one read
          // that lists the primary's secondaries (no target picked yet): there the shared Torrent step has no cap, so the
          // secondaries come from `extraTargets` below, capped at one
          const pickingPrimary = !!s.attack && s.attack.kind === 'shoot' && s.attack.operativeId === op.id && s.attack.targets.length === 0
          if (shells.data?.kind === 'torrent' && !pickingPrimary && addRuleOnce(rules, { rule: 'torrent', inches: 1 })) markFired('exSpecialIssueShells')
        }
      }
      if (!shoot && weapon.type === 'melee') {
        // DISPENSE JUSTICE: Ceaseless (T-EX.34)
        if (ployActive(s, op.seat, ID.dispense) && dispenseQualifies(s, op) && addRuleOnce(rules, { rule: 'ceaseless' })) markFired('exFlagPloy')
        // Aggressive: the mastiff's melee weapons have Relentless (T-EX.13)
        if (hasPattern(s, op, 'aggressive') && addRuleOnce(rules, { rule: 'relentless' })) markFired('exAttackPattern')
      }
    }
    // REINFORCED MIRROR-VISOR: an enemy weapon's Shock does nothing against a friendly Exaction operative (T-EX.40)
    if (target && target.seat !== op.seat && isEx(s, target) && equipped(s, target.seat, ID.visor)) {
      let stripped = false
      for (let i = rules.length - 1; i >= 0; i--) {
        if (ruleKey(rules[i]!.rule) === 'shock') {
          rules.splice(i, 1)
          stripped = true
        }
      }
      if (stripped) markFired('exMirrorVisor')
    }
    return null
  },
  'ex.modifyWeaponRules',
)

// ---------------------------------------------------------------------------
// Dice: Apprehend (Hit worse for the apprehended), Engendered Focus and Stubborn Subjugator (the stat clamp), Inviolate
// Jurisdiction (re-roll a defence die)
// ---------------------------------------------------------------------------

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as unknown as ModifyAttackDiceData
    // APPREHEND: Hit worsened by 1, never on top of the injured penalty (T-EX.16)
    if (apprehended(s, op) && !hasInjuredPenalty(op) && !providerAny(s, op, 'injuredEquivalent')) {
      data.hitDelta += 1
      markFired('exApprehend')
    }
    if (!isEx(s, op)) return null
    // ENGENDERED FOCUS: no worsening of Hit, no fall in Atk (T-EX.17); after Apprehend's change, which only touches enemies
    if (hasAbility(s, op, ID.focus)) {
      const printed = s.data.weapons[c.weaponId]?.atk ?? data.atk
      if (data.hitDelta > 0 || data.atk < printed) markFired('exEngenderedFocus')
      data.hitDelta = Math.min(0, data.hitDelta)
      data.atk = Math.max(data.atk, printed)
    }
    // STUBBORN SUBJUGATOR: no worsening of the Hit of its melee weapons (T-EX.26)
    if (data.kind === 'fight' && hasAbility(s, op, ID.subjugator) && data.hitDelta > 0) {
      data.hitDelta = 0
      markFired('exStubbornSubjugator')
    }
    return null
  },
  'ex.modifyAttackDice',
)

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isEx(s, op) || !ployActive(s, op.seat, ID.inviolate)) return null
    const data = c.data as { attackerId: string; rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    if (data.attackerId === op.id || data.rerolls.some((r) => r.id === 'ex.inviolate')) return null
    const nearObjective = s.markers.some((m) => m.kind === 'objective' && gapToMarker(bodyOf(op), m) <= 2 + EPS)
    const nearEnemy = enemiesOf(s, op).some((e) => live(e) && within(op, e, 2))
    if (nearObjective || nearEnemy) {
      data.rerolls.push({ id: 'ex.inviolate', source: ID.inviolate, mode: 'one', used: false })
      markFired('exFlagPloy')
    }
    return null
  },
  'ex.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// Damage taken: Medic!'s floor, Zealous Dedication
// ---------------------------------------------------------------------------

const DIE_SOURCES = ['normal', 'crit', 'strike-normal', 'strike-crit']

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op) return null
    const d = c.data as { source: string; amount: number }
    // Medic!: cannot be incapacitated for the remainder of the action (T-EX.10)
    if (d.amount > 0 && s.effects.some((e) => e.kind === FX.medicFloor && e.operativeId === op.id)) d.amount = Math.max(0, Math.min(d.amount, op.wounds - 1))
    // ZEALOUS DEDICATION: an attack die of 3 or more damage inflicts 1 less on a D6 of 5+ (T-EX.18)
    if (c.engine && DIE_SOURCES.includes(d.source) && d.amount >= 3 && isEx(s, op) && hasAbility(s, op, ID.zealous)) {
      const [r] = c.engine.roll('ex.zealous', 1)
      if (r !== undefined && r >= 5) {
        d.amount -= 1
        markFired('exZealousDedication')
      }
    }
    return null
  },
  'ex.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// After the attack: Concealed Position's ledger, and the record EXACT PUNISHMENT reads
// ---------------------------------------------------------------------------

function recordAttacked(ctx: Ctx, enemy: Operative, victims: string[]): void {
  const s = ctx.state
  const list = victims.filter((id) => {
    const v = s.operatives[id]
    return live(v) && isEx(s, v) && v.seat !== enemy.seat
  })
  if (list.length === 0) return
  const seat = s.operatives[list[0]!]!.seat
  addEffect(ctx, { source: ID.exact, seat, kind: FX.attacked, operativeId: enemy.id, expires: 'activation', data: { victims: list } })
}

registerHook(
  'afterShootResolved',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op) return null
    // Concealed Position: any Shoot in which the operative shot uses up the profile (T-EX.22)
    if (isEx(s, op)) markUsedBattle(s, op.seat, `ex.shot:${op.id}`)
    const d = c.data as unknown as { targets: string[]; incapacitated: string[] }
    if (ctx && !isEx(s, op) && Array.isArray(d.targets)) recordAttacked(ctx, op, d.targets.filter((t) => !d.incapacitated.includes(t)))
    return null
  },
  'ex.afterShootResolved',
)

registerHook(
  'onFightResolved',
  (c) => {
    const s = c.state
    const ctx = c.engine
    if (!s || !ctx) return null
    const d = c.data as { attackerId: string; defenderId: string; defenderIncapacitated: boolean }
    const att = s.operatives[d.attackerId]
    if (att && !d.defenderIncapacitated) recordAttacked(ctx, att, [d.defenderId])
    return null
  },
  'ex.onFightResolved',
)

// ---------------------------------------------------------------------------
// Target selection: Ruthless Efficiency, Close Quarters Vigilance, Guilt Reveals Itself, and the one-enemy limit of free
// attacks (Exact Punishment, Execution Order)
// ---------------------------------------------------------------------------

/** CLOSE QUARTERS VIGILANCE (T-EX.27): not after a Charge in this activation; always in a counteraction. */
function cqvOk(state: GameState, op: Operative): boolean {
  if (!hasAbility(state, op, ID.cqv)) return false
  const act = baseActivation(state)
  if (!act) return true
  if (act.operativeId === op.id) return act.counteract || !act.performed.includes('charge')
  if (act.partner?.operativeId === op.id) return !act.partner.performed.includes('charge')
  return true
}

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as unknown as BeforeShootTargetSelectData
    if (isEx(s, op) && !s.attack?.pointBlank) {
      const ruthless = !isGrenade(c.weaponId)
      const cqv = cqvOk(s, op)
      const guilt = ployActive(s, op.seat, ID.guilt)
      if (ruthless || cqv || guilt) {
        const rules = ruleSetFor(s, op, c.weaponId, 'shoot', undefined, c.engine)
        for (const e of enemiesOf(s, op)) {
          if (!live(e) || data.candidates.includes(e.id)) continue
          if (rules.range !== null && !isWithin(bodyOf(op), bodyOf(e), rules.range)) continue
          // core drops a target with a shooter-side operative in its control range: only the exceptions below get it back
          const holders = enemiesInControlRange(s, e, e.seat)
          let fixedByRule: 'ruthless' | 'cqv' | null = null
          let blocked = false
          for (const f of holders) {
            if (f.id === op.id) {
              if (cqv) fixedByRule = 'cqv'
              else blocked = true
            } else if (ruthless && isEx(s, f)) fixedByRule ??= 'ruthless'
            else blocked = true
          }
          if (blocked) continue
          const info = targetInfo(s, op, e, rules)
          if (!info.verdict.visible) continue
          let viaGuilt = false
          if (info.coverBlocks) {
            if (!guilt || info.distance > 4 + EPS) continue
            viaGuilt = true
          }
          if (!fixedByRule && !viaGuilt) continue
          data.candidates.push(e.id)
          if (viaGuilt) markFired('exFlagPloy')
          if (fixedByRule === 'cqv') markFired('exCloseQuartersVigilance')
          if (fixedByRule === 'ruthless') markFired('exRuthlessEfficiency')
        }
      }
    }
    // a free attack answering one enemy may choose only that enemy as its primary target. EXACT PUNISHMENT bars every other
    // selected target, so no Torrent secondary either (Blast secondaries are not selected and still count, T-EX.37);
    // EXECUTION ORDER only asks that enemy be shot first, so secondaries chosen after it stay open (T-EX.39)
    const only = opEffect(s, FX.only, op.id)
    if (only && (only.source === ID.exact || !(s.attack && s.attack.targets.length > 0))) {
      const id = String(only.data?.targetId ?? '')
      for (let i = data.candidates.length - 1; i >= 0; i--) if (data.candidates[i] !== id) data.candidates.splice(i, 1)
    }
    return null
  },
  'ex.beforeShootTargetSelect',
)

// OPTICS and SPOT: no obscuring against the Marksman's executioner shotgun and against a spotted enemy (T-EX.23, T-EX.25)
registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { obscured: boolean; inCover: boolean }
    if (!s || !shooter || !target || !data.obscured || shooter.seat === target.seat || !isEx(s, shooter)) return null
    if (hasToken(s, target.id, T.spot, shooter.seat)) {
      data.obscured = false
      markFired('exSpot')
      return null
    }
    const wid = c.weaponId ?? (s.attack?.operativeId === shooter.id ? (s.attack.weaponId ?? undefined) : undefined)
    if (wid && s.data.weapons[wid]?.profileGroup === EXECUTIONER_GROUP && hasToken(s, shooter.id, T.optics, shooter.seat)) {
      data.obscured = false
      markFired('exOptics')
    }
    return null
  },
  'ex.target.status',
)

// ---------------------------------------------------------------------------
// Action hooks: Manacles (an enemy's Fall Back), Acute Focus (the discount is spent)
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const enemy = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !live(enemy)) return null
    const d = c.data as unknown as ActionDeclaredData
    // EXACT PUNISHMENT answers the enemy's attack immediately: its record lapses once that enemy starts another action
    removeEffects(ctx, (e) => e.kind === FX.attacked && e.operativeId === enemy.id)
    if (d.action !== 'fallBack' || d.cancel) return null
    // MANACLES (T-EX.41): the enemy is alone in a friendly Exaction operative's control range
    const holders = activeOps(s).filter((o) => o.seat !== enemy.seat && live(o) && isEx(s, o) && equipped(s, o.seat, ID.manacles) && !usedThisTp(s, o.seat, ID.manacles))
    const alone = holders.filter((o) => {
      const near = enemiesInControlRange(s, o, o.seat).filter(live)
      return near.length === 1 && near[0]!.id === enemy.id
    })
    if (alone.length === 0) return null
    // a holder that rolls two dice (the enemy has no more Wounds than it) goes first
    const pick = alone.find((o) => enemy.maxWounds <= o.maxWounds) ?? alone[0]!
    const dice = ctx.roll('ex.manacles', enemy.maxWounds > pick.maxWounds ? 1 : 2)
    if (dice.some((r) => r >= 4)) {
      markUsedTp(s, pick.seat, ID.manacles)
      d.cancel = true
      d.bar = true
      d.reason = 'Manacles: the enemy cannot Fall Back'
      ctx.emit({ type: 'AbilityUsed', operativeId: pick.id, abilityId: ID.manacles, detail: enemy.id }, pick.seat)
      markFired('exManacles')
    }
    return null
  },
  'ex.action.declared',
)

const ACUTE_ACTIONS = [PICK_UP, PLACE, ABILITY(ID.veriscant)]

function acuteFocusApplies(state: GameState, op: Operative, actionId: string): boolean {
  if (!hasAbility(state, op, ID.acute)) return false
  if (!ACUTE_ACTIONS.includes(actionId) && !isMissionAction(state, actionId)) return false
  return !!ownActivation(state, op) && !opEffect(state, FX.acute, op.id)
}

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    // APPREHEND ends for good once the enemy has left the mastiff's control range (T-EX.16)
    for (const holder of activeOps(s)) {
      if (holder.tokens?.some((k) => k.kind === T.apprehend) && !apprehended(s, holder)) removeToken(ctx, holder.id, T.apprehend, 'ex.apprehend.ended')
    }
    armRepick(s)
    const d = c.data as { action: string }
    if (acuteFocusApplies(s, op, d.action)) {
      addEffect(ctx, { source: ID.acute, seat: op.seat, kind: FX.acute, operativeId: op.id, expires: 'activation' })
      markFired('exAcuteFocus')
    }
    return null
  },
  'ex.action.ended',
)

// ---------------------------------------------------------------------------
// Reactions: Medic!'s free Dash while the enemy is active, the new mark, EXACT PUNISHMENT
// ---------------------------------------------------------------------------

function medicDashOffers(state: GameState, seat: Seat): ReactionOffer[] {
  const out: ReactionOffer[] = []
  for (const e of state.effects) {
    if (e.kind !== FX.medicDash || e.seat !== seat || !e.operativeId) continue
    const v = state.operatives[e.operativeId]
    if (!v || v.status !== 'active') continue
    out.push({ hook: 'exMedic', operativeId: v.id, option: 'dash', labelKey: X('medicDash'), data: { name: 'Medic! free Dash', medicId: e.data?.medicId } })
  }
  return out
}

/** EXACT PUNISHMENT (T-EX.37): a survivor within 6" of the enemy that just shot or fought it takes a free Shoot or Fight at it. */
function exactOffers(state: GameState, seat: Seat, info: ReactionInfo): ReactionOffer[] {
  if (info.activeSeat === seat || info.interrupt || info.activationEnded || (info.action !== 'shoot' && info.action !== 'fight')) return []
  if (state.players[seat].cp < 1 || usedThisTp(state, seat, ID.exact) || state.players[seat].teamId !== TEAM_ID) return []
  const actor = state.operatives[info.actorId]
  if (!live(actor) || actor.seat === seat) return []
  const out: ReactionOffer[] = []
  const done = new Set<string>()
  for (const fx of state.effects) {
    if (fx.kind !== FX.attacked || fx.seat !== seat || fx.operativeId !== actor.id) continue
    for (const id of (fx.data?.victims as string[] | undefined) ?? []) {
      const v = state.operatives[id]
      if (done.has(id) || !live(v) || !isEx(state, v) || !within(v, actor, 6)) continue
      done.add(id)
      if (canShootFree(state, v, actor)) {
        out.push({ hook: 'exExactPunishment', operativeId: v.id, option: `shoot:${actor.id}`, labelKey: X('exactShoot'), data: { name: `EXACT PUNISHMENT (1 CP): ${v.name} shoots ${actor.name}`, targetId: actor.id } })
      }
      if (inCr(state, v, actor) && canStartFreeAction(state, { operativeId: v.id, action: 'fight', resume: '' })) {
        out.push({ hook: 'exExactPunishment', operativeId: v.id, option: `fight:${actor.id}`, labelKey: X('exactFight'), data: { name: `EXACT PUNISHMENT (1 CP): ${v.name} fights ${actor.name}`, targetId: actor.id } })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  // MEDIC! (T-EX.10): outside an attack a falling friend the Chirurgant could save waits for the deferred removal queue,
  // where its owner chooses
  pausableRemoval(state, op) {
    return !state.attack && !!medicFor(state, op)
  },

  actionForbidden(state, op, actionId) {
    // BEAST: only the listed actions (T-EX.15)
    if (hasAbility(state, op, ID.beast) && !BEAST_ACTIONS.includes(actionId)) {
      markFired('exBeast')
      return `${op.name} is a Beast and cannot take that action`
    }
    if (actionId === 'fallBack') {
      // APPREHEND (T-EX.16)
      if (apprehended(state, op)) {
        markFired('exApprehend')
        return `${op.name} is apprehended and cannot Fall Back`
      }
      // CASTIGATOR'S ARREST: the only enemy in a Castigator's control range cannot Fall Back (T-EX.19)
      for (const cas of activeOps(state)) {
        if (cas.seat === op.seat || !live(cas) || !hasAbility(state, cas, ID.arrest)) continue
        const near = enemiesInControlRange(state, cas, cas.seat).filter(live)
        if (near.length === 1 && near[0]!.id === op.id) {
          markFired('exCastigatorsArrest')
          return `${op.name} is held by a Castigator and cannot Fall Back`
        }
      }
    }
    return null
  },

  weaponForbidden(state, op, weaponId, kind) {
    if (hasAbility(state, op, ID.beast) && weaponId !== BITE) {
      markFired('exBeast')
      return `${op.name} is a Beast and uses only its own weapon`
    }
    // CONCEALED POSITION: only the operative's first Shoot of the battle (T-EX.22)
    if (kind === 'shoot' && weaponId === CONCEALED && isEx(state, op) && usedThisBattle(state, op.seat, `ex.shot:${op.id}`)) {
      markFired('exConcealedPosition')
      return 'Concealed Position: that profile can only be used in the first Shoot of the battle'
    }
    return null
  },

  equipmentEligible(state, op) {
    return hasAbility(state, op, ID.beast) ? false : null
  },

  // SWIFT: +2" Move (T-EX.13)
  moveDelta(state, op) {
    if (!hasPattern(state, op, 'swift')) return 0
    markFired('exAttackPattern')
    return 2
  },

  // ENGENDERED FOCUS: injury and APL decreases (T-EX.17); REINFORCED MIRROR-VISOR: APL decreases (T-EX.40)
  flags(state, op) {
    if (!isEx(state, op)) return null
    const out: { ignoreInjured?: boolean; ignoreAplDecreases?: boolean } = {}
    if (hasAbility(state, op, ID.focus)) {
      out.ignoreInjured = true
      out.ignoreAplDecreases = true
      markFired('exEngenderedFocus')
    }
    if (equipped(state, op.seat, ID.visor)) {
      out.ignoreAplDecreases = true
      markFired('exMirrorVisor')
    }
    return out.ignoreInjured || out.ignoreAplDecreases ? out : null
  },

  // NUNCIO-AQUILA (a): one extra AP for enemies near it; ACUTE FOCUS: the Malocator's first marker or mission action costs 1 less
  actionCostDelta(state, op, actionId) {
    let delta = 0
    if (actionId === PICK_UP || isMissionAction(state, actionId)) {
      for (const seat of nuncioSeats(state, op.seat)) {
        if (nearNuncio(state, seat, op)) {
          delta += 1
          markFired('exNuncioAquila')
          break
        }
      }
    }
    if (acuteFocusApplies(state, op, actionId)) {
      delta -= 1
      markFired('exAcuteFocus')
    }
    return delta
  },

  // NUNCIO-AQUILA (b): the APL total enemies contest a marker with is 1 lower with one of them near the centre
  controlTotal(state, seat, _marker, total, contesting) {
    if (total <= 0) return null
    for (const owner of nuncioSeats(state, seat)) {
      for (const id of contesting) {
        const o = state.operatives[id]
        if (o && nearNuncio(state, owner, o)) {
          markFired('exNuncioAquila')
          return Math.max(0, total - 1)
        }
      }
    }
    return null
  },

  // CLOSE QUARTERS VIGILANCE
  shootInControlRange(state, op) {
    return cqvOk(state, op)
  },
  // a Guard interrupt is not covered: a guarding Vigilant still interrupts with the core point-blank shot (T-EX.27)
  freeShootInControlRange(state, op) {
    return cqvOk(state, op) && !op.flags.guard
  },

  // a free attack answering one enemy fights only that enemy
  fightTargets(state, attacker, foes) {
    const only = opEffect(state, FX.only, attacker.id)
    const id = String(only?.data?.targetId ?? '')
    return only && foes.includes(id) ? [id] : null
  },

  // REPRESS (a): each block cancels two unresolved successes
  blockCapacity(state, attack, seat) {
    const seq = attack.seq
    if (attack.kind !== 'fight' || !seq) return null
    const side = seq.atk.seat === seat ? seq.atk : seq.def && seq.def.seat === seat ? seq.def : null
    const weapon = side?.weaponId ? state.data.weapons[side.weaponId] : undefined
    if (!weapon || !hasRule(weapon.rules, 'repress')) return null
    markFired('exRepress')
    return 2
  },

  // REPRESS (b): a retaliating fighter resolves first
  fightResolveStart(state, attack) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const weaponId = attack.fight.weaponD
    const ret = state.operatives[attack.fight.targetId]
    const weapon = weaponId ? state.data.weapons[weaponId] : undefined
    if (!ret || !weapon || !hasRule(weapon.rules, 'repress')) return null
    markFired('exRepress')
    return { first: ret.seat }
  },

  // STROBING PHOSPHOR-LUMEN: attack dice showing 1 cannot be re-rolled when an enemy attacks a friend within 2"
  rerollBannedValues(state, info) {
    if (info.defence) return null
    const roller = state.operatives[info.rollerId]
    const opp = state.operatives[info.opponentId]
    if (!roller || !opp || roller.seat === opp.seat || !isEx(state, opp) || !equipped(state, opp.seat, ID.strobing)) return null
    if (!within(roller, opp, 2)) return null
    markFired('exStrobing')
    return [1]
  },

  // SPECIAL ISSUE SHELLS (Torrent 1"): one extra target within 1" of the primary, chosen like a Torrent secondary
  extraTargets(state, shooter, weaponId, primaryId) {
    const fx = opEffect(state, FX.shells, shooter.id)
    if (!fx || fx.data?.kind !== 'torrent' || !isShellsWeapon(state, weaponId)) return null
    const candidates = torrentCandidates(state, shooter, weaponId, primaryId, 1)
    if (candidates.length === 0) return null
    markFired('exSpecialIssueShells')
    return { candidates, max: 1 }
  },

  // Medic!'s free Dash while the other player is active, the new mark, EXACT PUNISHMENT
  reactions(state, seat, info) {
    if (state.players[seat].teamId !== TEAM_ID) return []
    return [...medicDashOffers(state, seat), ...exactOffers(state, seat, info), ...repickOffers(state, seat)]
  },
  ownReactions(state, seat) {
    if (state.players[seat].teamId !== TEAM_ID) return []
    return repickOffers(state, seat)
  },
})

// ---------------------------------------------------------------------------
// Ploy rule: the 0 CP offers (Handler, Medic!'s Dash, Special Issue Shells, the Execution Order strike) and the paid
// Execution Order at the end of the Firefight phase
// ---------------------------------------------------------------------------

const exPloyRule: PloyRule = {
  extraOffers(state, seat, window, info) {
    const out: PloyOffer[] = []
    if (state.players[seat].teamId !== TEAM_ID) return out
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    const mine = live(subject) && subject.seat === seat && isEx(state, subject) ? subject : undefined

    // HANDLER (T-EX.12): as the Leashmaster is activated, a ready mastiff joins it
    if (window === 'firefight.activationStart' && mine && !info.counteracting && hasAbility(state, mine, ID.handler)) {
      const act = state.firefight.activation
      if (act && !act.frame && !act.counteract && !act.partner && act.operativeId === mine.id) {
        for (const m of mastiffsOf(state, seat)) {
          if (!m.ready || m.id === mine.id) continue
          for (const order of allowedOrders(state, m)) {
            out.push(offer(`${X('handler')}:${m.id}:${order}`, `Handler: ${m.name} joins the activation (${order})`, 'ex.handler', m, `${m.id}:${order}`))
          }
        }
      }
    }

    // Medic!'s free Dash once the action is over, while the Exaction player is the active one
    if (window === 'firefight.actionEnded') {
      const act = state.firefight.activation
      if (act && act.seat === seat) {
        for (const e of state.effects) {
          if (e.kind !== FX.medicDash || e.seat !== seat || !e.operativeId || state.operatives[e.operativeId]?.status !== 'active') continue
          out.push({ id: `${X('medicDash')}@${e.operativeId}`, ployId: X('medicDash'), name: 'Medic! free Dash', cost: 0, via: 'ex.medicDash', seed: { param: e.operativeId }, operativeId: e.operativeId })
        }
      }
    }

    // SPECIAL ISSUE SHELLS (T-EX.43): Saturate or Piercing 1 with the weapon and target known, Torrent 1" at the declaration
    if (equipped(state, seat, ID.shells) && tpUsesOf(state, seat, SHELLS_TP) < SHELLS_PER_TP && mine && !opEffect(state, FX.shells, mine.id)) {
      if (window === 'shoot.targetSelected' && state.attack?.kind === 'shoot' && state.attack.operativeId === mine.id && state.attack.weaponId && isShellsWeapon(state, state.attack.weaponId)) {
        const target = info.targetId ? state.operatives[info.targetId] : undefined
        out.push(offer(X('shells-saturate'), 'Special Issue Shells: Saturate', 'ex.shells.saturate', mine))
        if (target && target.seat !== seat && target.save <= 3) out.push(offer(X('shells-piercing'), 'Special Issue Shells: Piercing 1', 'ex.shells.piercing', mine))
      }
      if (window === 'firefight.actionDeclared' && info.action === 'shoot' && mine.weapons.some((w) => isShellsWeapon(state, w))) {
        out.push(offer(X('shells-torrent'), 'Special Issue Shells: Torrent 1" (one secondary)', 'ex.shells.torrent', mine))
      }
    }

    // EXECUTION ORDER (T-EX.39): at the end of the Firefight phase, naming an enemy that controls an objective marker
    if (window === 'turningPoint.end' && !lockOf(state, seat) && !usedThisTp(state, seat, ID.execution) && state.players[seat].cp >= 1 && exOps(state, seat).length > 0) {
      for (const e of activeOps(state)) {
        if (e.seat === seat || !live(e) || controlledBy(state, e, (m) => m.kind === 'objective').length === 0) continue
        out.push(offer(`${ID.execution}:${e.id}`, `EXECUTION ORDER: ${e.name} controls an objective`, 'ex.execution', undefined, e.id, 1))
      }
    }

    // BRUTAL BACKUP (T-EX.38): before or after an action of a friendly operative in its own activation
    if ((window === 'firefight.activationStart' || window === 'firefight.actionEnded') && !usedThisTp(state, seat, ID.backup) && state.players[seat].cp >= 1) {
      for (const { enemy, fighter } of backupPairs(state, seat, info)) {
        out.push(offer(`${ID.backup}:${enemy.id}+${fighter.id}`, `BRUTAL BACKUP: ${fighter.name} fights ${enemy.name}`, 'ex.backup', fighter, `${enemy.id}+${fighter.id}`, 1))
      }
    }

    // the Execution Order strike: the named enemy's first action in its next activation (a ready friend shoots or fights it first)
    if (window === 'firefight.opponentActionDeclared') {
      const actor = info.actorId ? state.operatives[info.actorId] : undefined
      const act = state.firefight.activation
      const fx = actor ? opEffect(state, FX.execution, actor.id) : undefined
      if (actor && live(actor) && fx && fx.seat === seat && fx.data?.live === true && !info.counteracting && act && !act.frame && !act.counteract && act.performed.length === 0) {
        for (const f of exOps(state, seat)) {
          if (!f.ready || f.id === actor.id) continue
          if (canShootFree(state, f, actor)) out.push(offer(`${X('exec-shoot')}:${f.id}`, `Execution Order: ${f.name} shoots ${actor.name} first`, 'ex.exec.shoot', f, actor.id))
          if (inCr(state, f, actor) && canStartFreeAction(state, { operativeId: f.id, action: 'fight', resume: '' })) {
            out.push(offer(`${X('exec-fight')}:${f.id}`, `Execution Order: ${f.name} fights ${actor.name} first`, 'ex.exec.fight', f, actor.id))
          }
        }
      }
    }
    return out
  },

  onUsed(ctx, seat, o, _info) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    switch (o.via) {
      case 'ex.handler': {
        const [mid, order] = (o.param ?? '').split(':')
        if (!mid) break
        if (joinActivation(ctx, mid, (order as 'engage' | 'conceal' | undefined) ?? 'engage')) {
          markFired('exHandler')
          ctx.emit({ type: 'AbilityUsed', operativeId: s.firefight.activation?.operativeId ?? null, abilityId: ID.handler, detail: mid }, seat)
        }
        break
      }
      case 'ex.medicDash': {
        const id = o.operativeId
        const fx = id ? s.effects.find((e) => e.kind === FX.medicDash && e.operativeId === id) : undefined
        if (!id || !fx) break
        removeEffects(ctx, (e) => e.id === fx.id)
        startFreeAction(ctx, { operativeId: id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: 'ploy.freeAction' })
        break
      }
      case 'ex.shells.saturate':
      case 'ex.shells.piercing':
      case 'ex.shells.torrent': {
        if (!op) break
        addTpUse(s, seat, SHELLS_TP)
        const kind = o.via.slice('ex.shells.'.length)
        addEffect(ctx, { source: ID.shells, seat, kind: FX.shells, operativeId: op.id, expires: 'action', data: { kind } })
        markFired('exSpecialIssueShells')
        break
      }
      case 'ex.exec.shoot':
      case 'ex.exec.fight': {
        const enemyId = o.param
        if (!op || !enemyId) break
        const kind = o.via === 'ex.exec.shoot' ? 'shoot' : 'fight'
        const previous = op.order
        if (kind === 'shoot' && op.order === 'conceal') setOrder(ctx, op, 'engage')
        addEffect(ctx, { source: ID.execution, seat, kind: FX.only, operativeId: op.id, expires: 'action', data: { targetId: enemyId } })
        markFired('exExecutionOrder')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.execution, detail: enemyId }, seat)
        const started = startFreeAction(ctx, { operativeId: op.id, action: kind, interrupt: true, resume: 'ex.exec', data: { opId: op.id, previous } })
        if (!started) {
          removeEffects(ctx, (x) => x.kind === FX.only && x.operativeId === op.id)
          if (op.order !== previous) setOrder(ctx, op, previous)
        }
        break
      }
      default:
        break
    }
  },
}

registerPloyRule(exPloyRule)

