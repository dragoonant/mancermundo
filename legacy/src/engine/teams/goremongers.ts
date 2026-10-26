// Goremongers (docs/spec/13-teams.md section 21, rule ids T-GM.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rule
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - GORE TANKS (T-GM.22): token `gm.gore` on each Goremonger (count 0 = empty, 1 = half, 2 = full), set to half in the
//    turning point 1 Ready step; raised by kills (`operative.removed`), lowered by SANGUAVITAE and the three actions.
//  - SANGUAVITAE (T-GM.23 to T-GM.29): 0 CP offers (ploy rule extraOffers, the Auspex pattern) in the activation and
//    action windows. The per-activation ledger is a `gm.sv` effect per use. Surge is offered in the declaration window
//    of a Charge or Reposition (`firefight.actionDeclared`, free frames included).
//  - Weapon rules: Ritual, Drag (shoot.beforeResolve), Wrist Chains twins (ownGrenades records), Gore-fuel and the
//    ploys' rule changes all live in the one `modifyWeaponRules` handler so their order is fixed.
//  - Damage: Brutish, Gory Tenacity and Runes of Khorne are one `onDamageInflicted` handler (in that order).
//  - Ploys: three persistent strategy flags, Hunt for Blood (a free Charge), the four firefight ploys; Gorethirst is the
//    `counteract` provider plus a paid ploy offer at the counteraction's start (counteract ploys are not built).
import { hasRule, ruleKey, ruleSetFor, weaponDamage } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, directDamage, gainCp, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { canStartFreeAction, cancelAction, finishAction, REACTION_DONE, reactionDone, startFreeAction } from '../firefight'
import { registerFrameResume, registerHook, type ActionDeclaredData, type DamageInflictedData, type OperativeRemovedData } from '../hooks'
import { bodyOf, visible } from '../los'
import { distanceBetween, enemiesInControlRange, gapToMarker, inControlRange } from '../measure'
import { applyForcedMove, forcedMoveSpots, planMove } from '../movement'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { markerControl } from '../query'
import type { Ctx } from '../registry'
import { activeOps, enemiesOf } from '../state'
import { readyChoiceDone } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { standingSolid, terrainOf } from '../terrain'
import { addToken, hasToken, removeToken, removeTokensWhere, tokenCount } from '../tokens'
import type { Activation, DiceSide, GameState, Operative, Seat, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'goremongers'

const GM = 'GOREMONGER'
const EPS = 1e-6

const A = (id: string) => `gm.a.${id}`
const P = (id: string) => `gm.p.${id}`
const E = (id: string) => `gm.e.${id}`
const W = (id: string) => `gm.w.${id}`

// ---- tokens and effect kinds ---------------------------------------------------------------------------------------
const GORE = 'gm.gore'
const BLEED = 'gm.bleeding'
const APOTH = 'gm.apotheosis'
const FUEL = 'gm.gore-fuel'
const CLAIM = 'gm.claim-skull'

const FX_SV = 'gm.sv'
const FX_SURGE = 'gm.surge'
const FX_RAGE = 'gm.rage'
const FX_FURY = 'gm.fury'
const FX_MANIA = 'gm.mania'
const FX_FAVOUR = 'gm.favour'
const FX_DROPPED = 'gm.dropped'
const FX_FROM = 'gm.from'
const FX_CHARGED = 'gm.charged'
const FX_LACERATE = 'gm.lacerate'
const FX_GORETHIRST = 'gm.gorethirst'
const FX_TENACITY = 'gm.tenacity'
const FX_RUNES = 'gm.runes'
const FX_SIGIL = 'gm.sigil'
const FX_SEVERE = 'gm.severe'
const FX_BLEED_HIT = 'gm.bleedHit'
const FX_SKULL_KILL = 'gm.skullKill'
const FX_RITUAL = 'gm.ritual'
const FX_DRAG_DONE = 'gm.dragDone'
/** a timed effect no engine expiry touches; the team's own hooks remove it */
const NEVER = 'gm.never'

// ---- ledger keys ---------------------------------------------------------------------------------------------------
const APOTH_BATTLE = 'gm.apotheosis'
const BLOODLUST_TP = 'gm.bloodlust'
const CLAIM_TP = 'gm.claimSkull'
const SIGIL_TP = 'gm.sigil'
const WRIST_TP = 'gm.wristChains'
const CADAVER_TP = 'gm.cadaver'

// ---- ids -----------------------------------------------------------------------------------------------------------
const FLESHSKEWER = [W('fleshskewer-ranged'), W('fleshskewer-stab')]
const DUAL_FOCUSED = W('dual-autopistols-focused')
const DUAL = [DUAL_FOCUSED, W('dual-autopistols-point-blank')]
const RITUAL_BLADE = W('ritual-blade')
const AXES = [W('great-chainaxe'), W('great-chainaxe-thrown')]
/** melee weapon -> its Wrist Chains twin (T-GM.41) */
const THROWN: Record<string, string> = {
  [W('chainblade')]: W('chainblade-thrown'),
  [W('chainglaive')]: W('chainglaive-thrown'),
  [W('great-chainaxe')]: W('great-chainaxe-thrown'),
  [W('pickrippers')]: W('pickrippers-thrown'),
}
const THROWN_IDS = Object.values(THROWN)
const TOTEM = E('gory-totem')
const CADAVER = E('bloody-cadaver')
const SIGIL = E('chaos-sigil')
const WRIST = E('wrist-chains')
const MOVE_ACTIONS = ['reposition', 'dash', 'fallBack', 'charge']
const ENHANCED = P('enhanced-violence')
const AUGMENTED = P('augmented-endurance')
const TENACITY = P('gory-tenacity')

type Sv = 'rejuvenate' | 'mania' | 'fury' | 'rake' | 'surge' | 'rage'
const SV_NAME: Record<Sv, string> = { rejuvenate: 'Rejuvenate', mania: 'Mania', fury: 'Fury', rake: 'Rake', surge: 'Surge', rage: 'Rage' }
const SV_CODE: Record<Sv, string> = { rejuvenate: 'gmRejuvenate', mania: 'gmMania', fury: 'gmFury', rake: 'gmRake', surge: 'gmSurge', rage: 'gmRage' }

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game. Rules with an action, a ploy or a choice register their own definition further down.
for (const name of [
  'gmRitual',
  'gmDrag',
  'gmKhornesFavour',
  'gmImpendingApotheosis',
  'gmInciteTheHunt',
  'gmBrutish',
  'gmClaimSkull',
  'gmStalker',
  'gmRunesOfKhorne',
  'gmGoreTanks',
  'gmSanguavitae',
  'gmRejuvenate',
  'gmMania',
  'gmFury',
  'gmRake',
  'gmSurge',
  'gmRage',
  'gmGoryTotem',
  'gmChaosSigil',
  'gmWristChains',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isGm(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, GM)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function gmOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isGm(state, o))
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

function fx(state: GameState, kind: string, opId: string) {
  return state.effects.find((e) => e.kind === kind && e.operativeId === opId)
}

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState): Activation | null {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

/** The operative's own activation (not a counteraction), a free action frame over it included. */
function ownActivation(state: GameState, op: Operative): Activation | null {
  const base = baseActivation(state)
  return base && base.operativeId === op.id && !base.counteract ? base : null
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

function d3(ctx: Ctx, purpose: string): number {
  const [d] = ctx.roll(purpose, 1)
  return Math.ceil((d ?? 1) / 2)
}

// ---------------------------------------------------------------------------
// Gore tanks (T-GM.22)
// ---------------------------------------------------------------------------

/** 0 = empty, 1 = half, 2 = full. */
export function goreLevel(state: GameState, opId: string): number {
  return Math.min(2, tokenCount(state, opId, GORE))
}

/** Raise a tank one level; false when it is full (or the operative is gone). */
export function increaseGore(ctx: Ctx, opId: string, reason: string): boolean {
  const op = ctx.state.operatives[opId]
  if (!op) return false
  return addToken(ctx, opId, { kind: GORE, owner: op.seat, cap: 2, expires: ['battle'] }, reason) > 0
}

/** Lower a tank one level; false when it is empty. */
export function decreaseGore(ctx: Ctx, opId: string, reason: string): boolean {
  const op = ctx.state.operatives[opId]
  if (!op) return false
  return removeToken(ctx, opId, GORE, reason, op.seat, 1) > 0
}

// The Ready step of turning point 1: every tank starts the battle at half (T-GM.22). The Bloody Cadaver becomes a marker
// only Goremongers can pick up. Claim Skull tokens go with the turning point.
registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    const s = ctx.state
    if (s.turningPoint === 1) {
      for (const o of Object.values(s.operatives).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (o.status !== 'active' || !isGm(s, o) || goreLevel(s, o.id) > 0) continue
        increaseGore(ctx, o.id, 'gm.start')
        markFired('gmGoreTanks')
      }
    }
    for (const m of s.markers) {
      if (m.equipmentId === CADAVER && m.owner && !(m.pickable && m.pickableBy === m.owner)) {
        m.pickable = true
        m.pickableBy = m.owner
      }
    }
    removeTokensWhere(ctx, (t) => t.kind === CLAIM, 'gm.claimSkull.ends')
    return null
  },
  'gm.turningPoint.start',
)

// Gore from kills of any cause (T-GM.22): the killer was within control range of the victim, or saw it within 2".
// Claim Skull (T-GM.18): the CP comes when the great chainaxe's victim is removed.
registerHook(
  'operative.removed',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as unknown as OperativeRemovedData
    if (!ctx || !s || !victim || !d.killerId) return null
    const killer = s.operatives[d.killerId]
    if (!live(killer) || !isGm(s, killer)) return null
    const near = inControlRange(s, bodyOf(killer), bodyOf(victim)) || (gap(killer, victim) <= 2 + EPS && visible(s, bodyOf(killer), bodyOf(victim)))
    if (near && increaseGore(ctx, killer.id, 'gm.kill')) markFired('gmGoreTanks')
    const mark = s.effects.find((e) => e.kind === FX_SKULL_KILL && e.operativeId === victim.id && e.data?.killer === killer.id)
    if (mark) {
      removeEffects(ctx, (e) => e.id === mark.id)
      if (victim.seat !== killer.seat && !usedThisTp(s, killer.seat, CLAIM_TP)) {
        markUsedTp(s, killer.seat, CLAIM_TP)
        gainCp(ctx, killer.seat, 1, A('claim-skull'))
        addToken(ctx, killer.id, { kind: CLAIM, owner: killer.seat, cap: 1, expires: ['battle'] }, 'gm.claimSkull')
        ctx.emit({ type: 'AbilityUsed', operativeId: killer.id, abilityId: A('claim-skull'), detail: victim.id }, killer.seat)
        markFired('gmClaimSkull')
      }
    }
    return null
  },
  'gm.operative.removed',
)

// ---------------------------------------------------------------------------
// SANGUAVITAE bookkeeping (T-GM.23)
// ---------------------------------------------------------------------------

function svUsed(state: GameState, opId: string): Sv[] {
  return state.effects.filter((e) => e.kind === FX_SV && e.operativeId === opId).map((e) => e.data?.rule as Sv)
}

/** Why `rule` cannot be used by `op` now (the ledger and the tank), or null when it can. */
function svBlock(state: GameState, op: Operative, rule: Sv, counteracting: boolean): string | null {
  if (!live(op) || !isGm(state, op)) return 'not a Goremonger'
  const used = svUsed(state, op.id)
  if (used.includes(rule)) return 'already used this activation'
  if (used.length >= 2) return 'two Sanguavitae rules already used'
  if ((rule === 'mania' && used.includes('fury')) || (rule === 'fury' && used.includes('mania'))) return 'Mania and Fury never share an activation'
  if ((rule === 'mania' || rule === 'fury' || rule === 'rake') && counteracting) return `${SV_NAME[rule]} is for activations only`
  if (goreLevel(state, op.id) <= 0) return 'the gore tank is empty'
  return null
}

function spendSv(ctx: Ctx, op: Operative, rule: Sv, detail?: string): void {
  decreaseGore(ctx, op.id, `gm.${rule}`)
  addEffect(ctx, { source: A(rule), seat: op.seat, kind: FX_SV, operativeId: op.id, expires: 'activation', data: { rule } })
  ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A(rule), ...(detail ? { detail } : {}) }, op.seat)
  markFired('gmSanguavitae')
  markFired(SV_CODE[rule])
}

// Mania (T-GM.25): +1 APL until the start of the operative's next activation. It is added to the operative's modifiers
// directly (core timed APL effects end with the activation) and taken off in the next activation.start.
registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    for (const e of s.effects.filter((x) => x.kind === FX_MANIA && x.operativeId === op.id)) {
      removeEffects(ctx, (x) => x.id === e.id)
      op.aplMods -= 1
      ctx.emit({ type: 'AplModified', operativeId: op.id, delta: -1, reason: `${A('mania')}.expired` })
    }
    return null
  },
  'gm.activation.start',
)

// ---------------------------------------------------------------------------
// Action hooks: drops (declared), charges and drops (ended), Lacerate Flesh (activation and counteraction end)
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isGm(s, op)) return null
    const d = c.data as unknown as ActionDeclaredData
    // ROOFTOP STALKER (T-GM.20): where a move action starts (on Vantage at least 2" up?), to see a drop when it ends
    if (!d.cancel && MOVE_ACTIONS.includes(d.action) && hasAbility(s, op, A('rooftop-stalker'))) {
      removeEffects(ctx, (e) => e.kind === FX_FROM && e.operativeId === op.id)
      addEffect(ctx, { source: A('rooftop-stalker'), seat: op.seat, kind: FX_FROM, operativeId: op.id, expires: 'action', data: { y: op.pos.y, vantage: onVantage(s, op.pos) } })
    }
    return null
  },
  'gm.action.declared',
)

/** Is a base standing at `pos` on Vantage terrain (a Vantage part's floor)? */
function onVantage(state: GameState, pos: Vec3): boolean {
  return standingSolid(terrainOf(state.map), pos)?.vantage === true
}

/** Lacerate Flesh's closing step (T-GM.37): lower the tank, or take D3 when it cannot be lowered. */
function settleLacerate(ctx: Ctx, op: Operative): void {
  const e = fx(ctx.state, FX_LACERATE, op.id)
  if (!e) return
  removeEffects(ctx, (x) => x.id === e.id)
  if (op.status !== 'active') return
  if (decreaseGore(ctx, op.id, 'gm.lacerate')) return
  directDamage(ctx, op.id, d3(ctx, 'gm.lacerate.d3'), op.id, 'gm.lacerate')
}

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isGm(s, op)) return null
    const d = c.data as { action: string; counteract: boolean }
    const base = baseActivation(s)
    const own = !!base && base.operativeId === op.id && !base.counteract
    // UNBRIDLED AGGRESSION remembers a Charge for the rest of the activation (free Charges included)
    if (d.action === 'charge' && own && !fx(s, FX_CHARGED, op.id)) {
      addEffect(ctx, { source: A('rake'), seat: op.seat, kind: FX_CHARGED, operativeId: op.id, expires: 'activation' })
    }
    // ROOFTOP STALKER remembers a drop from Vantage 2" up (T-GM.20): the move started on it and ended lower
    const from = fx(s, FX_FROM, op.id)
    if (own && from && MOVE_ACTIONS.includes(d.action) && !fx(s, FX_DROPPED, op.id) && from.data?.vantage === true && Number(from.data.y) >= 2 - EPS && op.pos.y < Number(from.data.y) - 0.5) {
      addEffect(ctx, { source: A('rooftop-stalker'), seat: op.seat, kind: FX_DROPPED, operativeId: op.id, expires: 'activation' })
    }
    return null
  },
  'gm.action.ended',
)

// LACERATE FLESH in a counteraction (T-GM.37): it settles when the counteraction ends
registerHook(
  'counteraction.end',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    if (fx(s, FX_LACERATE, op.id)) settleLacerate(ctx, op)
    return null
  },
  'gm.counteraction.end',
)

registerHook(
  'activation.end',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    if (fx(s, FX_LACERATE, op.id)) settleLacerate(ctx, op)
    return null
  },
  'gm.activation.end',
)

// ---------------------------------------------------------------------------
// Weapon rules: Enhanced Violence, Gore-fuel, Rooftop Stalker, Unbridled Aggression, Chaos Sigil
// ---------------------------------------------------------------------------

function onVantageHigh(state: GameState, op: Operative): boolean {
  return op.pos.y >= 2 - EPS && onVantage(state, op.pos)
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
    const att = s.attack
    if (isGm(s, op)) {
      // ENHANCED VIOLENCE (T-GM.30): Balanced at half, Relentless at full, on melee weapons and the Wrist Chains twins
      if ((weapon.type === 'melee' || THROWN_IDS.includes(weapon.id)) && ployActive(s, op.seat, ENHANCED)) {
        const lv = goreLevel(s, op.id)
        if (lv === 1 && !hasRule(rules, 'balanced')) {
          rules.push({ rule: 'balanced' })
          markFired('gmStrategyFlag')
        } else if (lv === 2 && !hasRule(rules, 'relentless')) {
          rules.push({ rule: 'relentless' })
          markFired('gmStrategyFlag')
        }
      }
      // GORE-FUEL (T-GM.13): both fleshskewer profiles have Severe until one is used
      if (FLESHSKEWER.includes(weapon.id) && hasToken(s, op.id, FUEL) && !hasRule(rules, 'severe')) {
        rules.push({ rule: 'severe' })
        markFired('gmGoreFuel')
      }
      if (data.kind === 'fight' && weapon.type === 'melee' && att?.kind === 'fight' && att.operativeId === op.id) {
        // ROOFTOP STALKER (T-GM.20): fighting (not retaliating) after a Vantage drop, or against an enemy up on Vantage
        if (hasAbility(s, op, A('rooftop-stalker')) && !hasRule(rules, 'relentless') && (fx(s, FX_DROPPED, op.id) || (target && target.seat !== op.seat && onVantageHigh(s, target)))) {
          rules.push({ rule: 'relentless' })
          markFired('gmStalker')
        }
        // UNBRIDLED AGGRESSION (T-GM.34): Severe until the end of the sequence
        if (fx(s, FX_SEVERE, op.id) && !hasRule(rules, 'severe')) {
          rules.push({ rule: 'severe' })
          markFired('gmUnbridledAggression')
        }
      }
    }
    // CHAOS SIGIL (T-GM.40): the attacker's Piercing x is 1 lower against the Goremonger that used it, Piercing 1 is ignored
    if (data.kind === 'shoot' && target && fx(s, FX_SIGIL, target.id)) {
      for (let i = rules.length - 1; i >= 0; i--) {
        const r = rules[i]!
        if (ruleKey(r.rule) !== 'piercing') continue
        const x = (r.x ?? 1) - 1
        if (x <= 0) rules.splice(i, 1)
        else rules[i] = { ...r, x }
        markFired('gmChaosSigil')
      }
    }
    return null
  },
  'gm.modifyWeaponRules',
)

// RAGE (T-GM.29): +1 Atk on the melee weapons for the Fight action it was used on, never when retaliating
registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId || !isGm(s, op) || !fx(s, FX_RAGE, op.id)) return null
    const data = c.data as { kind: 'shoot' | 'fight'; atk: number }
    if (data.kind !== 'fight' || s.data.weapons[c.weaponId]?.type !== 'melee' || s.attack?.operativeId !== op.id) return null
    data.atk += 1
    markFired('gmRage')
    return null
  },
  'gm.modifyAttackDice',
)

// AUGMENTED ENDURANCE (T-GM.31)
registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isGm(s, op) || !ployActive(s, op.seat, AUGMENTED)) return null
    const lv = goreLevel(s, op.id)
    if (lv <= 0) return null
    const data = c.data as { rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    data.rerolls.push({ id: 'gm.endurance', source: AUGMENTED, mode: lv === 2 ? 'any' : 'one', used: false })
    markFired('gmStrategyFlag')
    return null
  },
  'gm.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// Damage: Brutish, Gory Tenacity, Runes of Khorne (in that order), Ritual and Claim Skull bookkeeping
// ---------------------------------------------------------------------------

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !op || !isGm(s, op)) return null
    const d = c.data as { source: string; attackerId: string; weaponId: string | null; amount: number; splash?: boolean }
    if (d.amount <= 0) return null
    // BRUTISH (T-GM.17): a crit die deals the weapon's Normal Dmg when that is lower
    if ((d.source === 'crit' || d.source === 'strike-crit') && hasAbility(s, op, A('brutish')) && d.weaponId && !d.splash) {
      const normal = weaponDamage(s, d.attackerId, d.weaponId, op.id, d.source === 'crit' ? 'shoot' : 'fight', ctx).normal
      if (normal < d.amount) {
        d.amount = normal
        markFired('gmBrutish')
      }
    }
    // GORY TENACITY (T-GM.32): the first strike against it in a sequence is halved (rounding up, minimum 2, never raised)
    if ((d.source === 'strike-normal' || d.source === 'strike-crit') && ployActive(s, op.seat, TENACITY) && !fx(s, FX_TENACITY, op.id)) {
      addEffect(ctx, { source: TENACITY, seat: op.seat, kind: FX_TENACITY, operativeId: op.id, expires: 'action' })
      d.amount = Math.min(d.amount, Math.max(2, Math.ceil(d.amount / 2)))
      markFired('gmStrategyFlag')
    }
    // RUNES OF KHORNE (T-GM.21): at most 8 wounds per Shoot action
    if (s.attack?.kind === 'shoot' && d.amount > 0) {
      let e = fx(s, FX_RUNES, op.id)
      if (!e) e = addEffect(ctx, { source: A('runes-of-khorne'), seat: op.seat, kind: FX_RUNES, operativeId: op.id, expires: 'action', data: { lost: 0 } })
      const lost = Number(e.data?.lost ?? 0)
      const capped = Math.max(0, Math.min(d.amount, 8 - lost))
      if (capped < d.amount) markFired('gmRunesOfKhorne')
      d.amount = capped
      e.data = { lost: lost + capped }
    }
    return null
  },
  'gm.onDamageInflicted',
)

registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as unknown as DamageInflictedData
    const killer = s ? s.operatives[d.attackerId] : undefined
    if (!ctx || !s || !victim || !killer || !isGm(s, killer) || d.amount <= 0 || victim.id === killer.id) return null
    // RITUAL (T-GM.10): the first damage of the sequence to an operative in its control range
    if (d.weaponId === RITUAL_BLADE && !fx(s, FX_RITUAL, killer.id) && inControlRange(s, bodyOf(killer), bodyOf(victim))) {
      addEffect(ctx, { source: A('wr-ritual'), seat: killer.seat, kind: FX_RITUAL, operativeId: killer.id, expires: 'action' })
      if (increaseGore(ctx, killer.id, 'gm.ritual')) markFired('gmRitual')
    }
    // CLAIM SKULL (T-GM.18): remember a great chainaxe kill until the victim is removed
    if (d.woundsAfter <= 0 && d.weaponId && AXES.includes(d.weaponId) && hasAbility(s, killer, A('claim-skull')) && victim.seat !== killer.seat) {
      addEffect(ctx, { source: A('claim-skull'), seat: killer.seat, kind: FX_SKULL_KILL, operativeId: victim.id, expires: 'turningPoint', data: { killer: killer.id } })
    }
    // BLEEDING (T-GM.16): a surviving enemy wounded by the dual autopistols gets a token when the Shoot action ends
    if (d.woundsAfter > 0 && d.weaponId && DUAL.includes(d.weaponId) && victim.seat !== killer.seat && hasAbility(s, killer, A('incite-the-hunt'))) {
      if (!s.effects.some((e) => e.kind === FX_BLEED_HIT && e.operativeId === victim.id)) {
        addEffect(ctx, { source: A('incite-the-hunt'), seat: killer.seat, kind: FX_BLEED_HIT, operativeId: victim.id, expires: 'action', data: { killer: killer.id } })
      }
    }
    return null
  },
  'gm.damage.inflicted',
)

registerHook(
  'afterShootResolved',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isGm(s, op)) return null
    const weaponId = c.weaponId ?? null
    // BLEEDING: the action is over; an enemy that survived it holds one of the Goremongers' tokens
    for (const e of s.effects.filter((x) => x.kind === FX_BLEED_HIT && x.data?.killer === op.id)) {
      const v = e.operativeId ? s.operatives[e.operativeId] : undefined
      if (v && v.status === 'active' && v.wounds > 0 && addToken(ctx, v.id, { kind: BLEED, owner: op.seat, cap: 1, expires: ['battle'] }, 'gm.bleeding') > 0) markFired('gmInciteTheHunt')
    }
    removeEffects(ctx, (e) => e.kind === FX_BLEED_HIT && e.data?.killer === op.id)
    // GORE-FUEL ends when a fleshskewer profile was used
    if (weaponId && FLESHSKEWER.includes(weaponId)) removeToken(ctx, op.id, FUEL, 'gm.goreFuel.used', op.seat)
    // WRIST CHAINS: the use is spent by the Shoot that picked a thrown twin
    if (weaponId && THROWN_IDS.includes(weaponId)) {
      markUsedTp(s, op.seat, WRIST_TP)
      markFired('gmWristChains')
    }
    return null
  },
  'gm.afterShootResolved',
)

registerHook(
  'onFightResolved',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const a = s?.attack
    if (!ctx || !s || !a || a.kind !== 'fight' || !a.fight) return null
    // GORE-FUEL ends when a fleshskewer profile rolled dice, fighting or retaliating
    const pairs: [string, string | null][] = [
      [a.operativeId, a.fight.weaponA],
      [a.fight.targetId, a.fight.weaponD],
    ]
    for (const [opId, w] of pairs) if (w && FLESHSKEWER.includes(w) && hasToken(s, opId, FUEL)) removeToken(ctx, opId, FUEL, 'gm.goreFuel.used')
    return null
  },
  'gm.onFightResolved',
)

// IMPENDING APOTHEOSIS in a fight (T-GM.8): the first normal strike that would incapacitate the Blood Herald is ignored
registerHook(
  'beforeStrike',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !ctx || !victim || !isGm(s, victim) || !hasAbility(s, victim, A('impending-apotheosis'))) return null
    const data = c.data as { die: string; amount: number; cancel: boolean }
    if (data.die !== 'normal' || usedThisBattle(s, victim.seat, APOTH_BATTLE)) return null
    // Gory Tenacity halves this strike when it is the first against the Herald in the sequence: judge the halved damage
    const tenacity = ployActive(s, victim.seat, TENACITY) && !fx(s, FX_TENACITY, victim.id)
    const dealt = tenacity ? Math.min(data.amount, Math.max(2, Math.ceil(data.amount / 2))) : data.amount
    if (dealt < victim.wounds) return null
    data.cancel = true
    // the ignored strike was still the opponent's first strike of the sequence: Gory Tenacity is spent on it
    if (tenacity) addEffect(ctx, { source: TENACITY, seat: victim.seat, kind: FX_TENACITY, operativeId: victim.id, expires: 'action' })
    markUsedBattle(s, victim.seat, APOTH_BATTLE)
    addToken(ctx, victim.id, { kind: APOTH, owner: victim.seat, cap: 1, expires: ['battle'] }, 'gm.apotheosis')
    ctx.emit({ type: 'AbilityUsed', operativeId: victim.id, abilityId: A('impending-apotheosis'), detail: 'fight' }, victim.seat)
    markFired('gmImpendingApotheosis')
    return null
  },
  'gm.beforeStrike',
)

// ---------------------------------------------------------------------------
// Unique actions: Transfusion Ritual, Gore-fuel
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'gmTransfusionRitual',
  action: {
    offers(state, op): OfferSeed[] {
      if (goreLevel(state, op.id) <= 0) return []
      return gmOps(state, op.seat)
        .filter((f) => f.id !== op.id && goreLevel(state, f.id) < 2 && within(op, f, 8))
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || target.id === op.id || goreLevel(ctx.state, op.id) <= 0 || goreLevel(ctx.state, target.id) >= 2) {
        cancelAction(ctx)
        return
      }
      decreaseGore(ctx, op.id, 'gm.transfusion')
      increaseGore(ctx, target.id, 'gm.transfusion')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      markFired('gmTransfusionRitual')
      finishAction(ctx)
    },
  },
})
registerCodeHook({
  name: 'gmGoreFuel',
  action: {
    offers(state, op): OfferSeed[] {
      return goreLevel(state, op.id) > 0 && !hasToken(state, op.id, FUEL) ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      if (goreLevel(ctx.state, op.id) <= 0 || hasToken(ctx.state, op.id, FUEL)) {
        cancelAction(ctx)
        return
      }
      decreaseGore(ctx, op.id, 'gm.goreFuel')
      addToken(ctx, op.id, { kind: FUEL, owner: op.seat, cap: 1, expires: ['battle'] }, 'gm.goreFuel')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Dash and Spray (T-GM.14): a free Dash and a free Shoot in either order
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'gmDashAndSpray',
  action: {
    offers(state, op, _def, act): OfferSeed[] {
      if (op.order === 'conceal' || inEnemyCr(state, op)) return []
      // a Dash or Shoot already performed in this activation bars the action (R-3.9), and so does a Charge: the free
      // Dash must meet the Dash conditions, and Dash is barred after Charge in the same activation
      if (act && (act.performed.includes('dash') || act.performed.includes('shoot') || act.performed.includes('charge'))) return []
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'gmDashAndSpray', operativeId: op.id, abilityId: def.id },
        options: [opt('dash', 'gm.dashFirst', { name: 'Dash first, then Shoot' }), opt('shoot', 'gm.shootFirst', { name: 'Shoot first, then Dash' })],
        canPass: true,
      })
    },
  },
  choice(ctx, op, option) {
    markFired('gmDashAndSpray')
    sprayPart(ctx, op.id, option === 'shoot' ? ['shoot', 'dash'] : ['dash', 'shoot'], 0)
  },
})

function sprayPart(ctx: Ctx, opId: string, order: string[], i: number): void {
  const part = order[i]
  if (!part) {
    sprayDone(ctx, opId)
    return
  }
  // the card grants no "even if": the free Dash and Shoot keep R-3.7 and the move bars of the activation
  const started = startFreeAction(ctx, { operativeId: opId, action: part as 'dash' | 'shoot', resume: 'gm.spray', checkPerformed: true, data: { gmSpray: part === 'shoot', opId, order, i } })
  if (!started) sprayPart(ctx, opId, order, i + 1)
}

registerFrameResume('gm.spray', (ctx, _outcome, data) => {
  sprayPart(ctx, String(data.opId), (data.order as string[]) ?? [], Number(data.i) + 1)
})

/** Both parts are over (or passed): the free Dash and Shoot count as performed (R-3.9). */
function sprayDone(ctx: Ctx, opId: string): void {
  const act = ctx.state.firefight.activation
  if (act && act.operativeId === opId && !act.frame) for (const a of ['dash', 'shoot']) if (!act.performed.includes(a)) act.performed.push(a)
  if (ctx.state.firefight.activation?.declared) finishAction(ctx)
}

// ---------------------------------------------------------------------------
// Obsessive Bloodlust (T-GM.9): a free 2" Charge after a Fight, once per turning point for the team
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'gmObsessiveBloodlust',
  choice(ctx, op) {
    const opts = { operativeId: op.id, action: 'charge' as const, maxMove: 2, resume: REACTION_DONE }
    if (!live(op) || !canStartFreeAction(ctx.state, opts)) {
      reactionDone(ctx)
      return
    }
    markUsedTp(ctx.state, op.seat, BLOODLUST_TP)
    markFired('gmObsessiveBloodlust')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('obsessive-bloodlust') }, op.seat)
    if (!startFreeAction(ctx, opts)) reactionDone(ctx)
  },
})

// ---------------------------------------------------------------------------
// Drag (T-GM.12): pull the target up to 2" per unblocked success towards the Impaler, drops free
// ---------------------------------------------------------------------------

let dragging = false

/** Where a pull of `inches` leaves `target`: the legal spot closest to the Impaler, or null when it cannot move. */
function dragSpot(state: GameState, impaler: Operative, target: Operative, inches: number): { to: { x: number; z: number; y: number }; cost: number } | null {
  const minCentre = impaler.baseRadius + target.baseRadius
  const dx = impaler.pos.x - target.pos.x
  const dz = impaler.pos.z - target.pos.z
  const dist = Math.hypot(dx, dz)
  let best: { to: { x: number; z: number; y: number }; cost: number; d: number } | null = null
  const was = dragging
  dragging = true
  try {
    const cands: Vec3[] = []
    if (dist > EPS) {
      const along = Math.max(0, dist - minCentre)
      for (let t = Math.min(inches, along); t >= 0.5 - EPS; t -= 0.5) {
        cands.push({ x: target.pos.x + (dx / dist) * t, y: target.pos.y, z: target.pos.z + (dz / dist) * t })
      }
    }
    for (const p of forcedMoveSpots(state, target, inches, 16)) cands.push(p)
    const heights = [...new Set([target.pos.y, 0, impaler.pos.y])]
    for (const p of cands) {
      for (const y of heights) {
        const plan = planMove(state, target, 'reposition', [{ x: p.x, z: p.z, y }], false, inches, undefined, undefined, true)
        if (!plan.ok) continue
        const d = Math.hypot(impaler.pos.x - plan.end.x, impaler.pos.z - plan.end.z)
        if (d < minCentre - EPS) continue
        if (!best || d < best.d - EPS || (Math.abs(d - best.d) <= EPS && plan.cost < best.cost)) best = { to: { x: plan.end.x, z: plan.end.z, y: plan.end.y }, cost: plan.cost, d }
      }
    }
  } finally {
    dragging = was
  }
  if (!best) return null
  const here = Math.hypot(impaler.pos.x - target.pos.x, impaler.pos.z - target.pos.z)
  if (best.d >= here - EPS) return null
  return { to: best.to, cost: best.cost }
}

/**
 * GORETHIRST (T-GM.35): a Conceal Goremonger's counteraction is the ploy's use. Until the ploy is paid nothing else of
 * that counteraction may happen (no action, no SANGUAVITAE, no Bleeding, no Lacerate Flesh): passing it leaves the
 * counteraction empty, the same as not counteracting.
 */
function gorethirstOwed(state: GameState, op: Operative): boolean {
  const act = state.firefight.activation
  return !!act && act.counteract && !act.frame && act.operativeId === op.id && op.order === 'conceal' && !fx(state, FX_GORETHIRST, op.id)
}

function unblockedOf(state: GameState): { normal: number; crit: number } | null {
  return state.attack?.seq?.unblocked ?? null
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  // FURY (T-GM.26): two Fight actions in the activation
  maxRepeats(state, op, actionId) {
    if (actionId !== 'fight' || !isGm(state, op) || !fx(state, FX_FURY, op.id)) return null
    markFired('gmFury')
    return 2
  },

  // ... and the second one is free
  actionCostDelta(state, op, actionId) {
    if (actionId !== 'fight' || !isGm(state, op) || !fx(state, FX_FURY, op.id)) return 0
    const base = baseActivation(state)
    return base && base.operativeId === op.id && base.performed.filter((a) => a === 'fight').length >= 1 ? -1 : 0
  },

  // GORETHIRST (T-GM.35): a Conceal Goremonger may counteract when its seat can pay
  counteract(state, op) {
    if (!isGm(state, op) || op.order !== 'conceal') return null
    if (state.players[op.seat].cp < 1 || usedThisTp(state, op.seat, P('gorethirst'))) return null
    return 'any'
  },

  actionForbidden(state, op, actionId) {
    if (!isGm(state, op)) return null
    if (gorethirstOwed(state, op)) return 'Gorethirst must be paid for first (1 CP) to counteract with a Conceal order'
    const act = state.firefight.activation
    if (act && act.counteract && act.operativeId === op.id && !act.frame && fx(state, FX_GORETHIRST, op.id)) {
      if (actionId !== 'charge' && actionId !== 'shoot' && actionId !== 'fight') return 'Gorethirst allows only Charge, Shoot or Fight'
    }
    return null
  },

  // SURGE (T-GM.28): +1" to the Charge or Reposition it was spent on
  moveLimitDelta(state, op, kind) {
    if ((kind !== 'charge' && kind !== 'reposition') || !fx(state, FX_SURGE, op.id)) return 0
    markFired('gmSurge')
    return 1
  },

  weaponForbidden(state, op, weaponId, kind) {
    if (kind !== 'shoot' || !isGm(state, op)) return null
    // WRIST CHAINS: the thrown twins once per turning point
    if (THROWN_IDS.includes(weaponId) && usedThisTp(state, op.seat, WRIST_TP)) return 'Wrist Chains were already used this turning point'
    // DASH AND SPRAY: only the focused profile in its free Shoot
    const frame = state.firefight.activation?.frame
    if (frame?.data?.gmSpray === true && frame.data.opId === op.id && weaponId !== DUAL_FOCUSED) return 'Dash and Spray allows only the dual autopistols (focused)'
    return null
  },

  // CLIMBING PICKS (T-GM.19): every climb costs 2"; DRAG: drops cost nothing
  moveSurcharge(state, op, _kind, _points, breakdown) {
    if (dragging) return breakdown.drop > 0 ? -breakdown.drop : 0
    if (!isGm(state, op) || !hasAbility(state, op, A('climbing-picks'))) return 0
    const climbs = breakdown.climbs ?? []
    const save = climbs.reduce((n, c) => n + Math.max(0, c - 2), 0)
    if (save <= 0) return 0
    markFired('gmStalker')
    return -save
  },

  // WRIST CHAINS (T-GM.41): the thrown twins of the melee weapons on the datacard (fallback for extraShootWeapons)
  ownGrenades(state, op) {
    if (!isGm(state, op) || !equipped(state, op.seat, WRIST)) return null
    const card = state.data.datacards[op.datacardId]
    if (!card) return null
    const weapons: Record<string, number> = {}
    for (const [melee, twin] of Object.entries(THROWN)) if (card.fixedWeapons.includes(melee) && state.data.weapons[twin]) weapons[twin] = 99
    return Object.keys(weapons).length > 0 ? { weapons } : null
  },
  // the equipment lists the twins only so the data validates; ownGrenades hands them out
  equipmentEligible(_state, _op, equipmentId) {
    return equipmentId === WRIST ? false : null
  },

  // GORY TOTEM (T-GM.38): an enemy within 3" of the marker cannot re-roll its attack dice
  rerollsBanned(state, side: DiceSide, attack) {
    const op = state.operatives[side.operativeId]
    if (!op || !(attack.kind === 'fight' || side.operativeId === attack.operativeId)) return false
    for (const m of state.markers) {
      if (m.equipmentId !== TOTEM || m.owner === null || m.owner === op.seat || m.carriedBy) continue
      if (gapToMarker(bodyOf(op), m) <= 3 + EPS) {
        markFired('gmGoryTotem')
        return true
      }
    }
    return false
  },

  // BLOODY CADAVER (T-GM.39): in the Ready step one controlling Goremonger outside enemy control range may gain a level
  readyStepChoices(state, seat): ReactionOffer[] {
    if (usedThisTp(state, seat, CADAVER_TP)) return []
    const out: ReactionOffer[] = []
    for (const m of state.markers) {
      if (m.equipmentId !== CADAVER || m.owner !== seat) continue
      const control = markerControl(state, m)
      for (const id of control.contesting[seat]) {
        const o = state.operatives[id]
        if (!live(o) || !isGm(state, o) || goreLevel(state, o.id) >= 2 || inEnemyCr(state, o)) continue
        // the carrier controls it alone; uncarried it is the core control of the marker
        if (!m.carriedBy && control.controller !== seat) continue
        out.push({ hook: 'gmBloodyCadaver', operativeId: o.id, option: m.id, labelKey: 'gm.cadaverTop' })
      }
    }
    return out
  },

  // OBSESSIVE BLOODLUST (T-GM.9)
  ownReactions(state, seat, info): ReactionOffer[] {
    if (info.action !== 'fight') return []
    const op = state.operatives[info.actorId]
    if (!op || op.seat !== seat || !live(op) || !hasAbility(state, op, A('obsessive-bloodlust'))) return []
    if (usedThisTp(state, seat, BLOODLUST_TP) || inEnemyCr(state, op)) return []
    // the Charge is 2" at most and must end in an enemy control range
    if (!enemiesOf(state, op).some((e) => live(e) && gap(op, e) <= 3 + EPS)) return []
    if (!canStartFreeAction(state, { operativeId: op.id, action: 'charge', maxMove: 2, resume: REACTION_DONE })) return []
    return [{ hook: 'gmObsessiveBloodlust', operativeId: op.id, option: 'charge', labelKey: 'gm.bloodlust' }]
  },
})

registerCodeHook({
  name: 'gmBloodyCadaver',
  choice(ctx, op) {
    if (live(op) && goreLevel(ctx.state, op.id) < 2) {
      increaseGore(ctx, op.id, 'gm.cadaver')
      markUsedTp(ctx.state, op.seat, CADAVER_TP)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: E('bloody-cadaver') }, op.seat)
      markFired('gmBloodyCadaver')
    }
    readyChoiceDone(ctx)
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys
// ---------------------------------------------------------------------------

// ENHANCED VIOLENCE, AUGMENTED ENDURANCE and GORY TENACITY are turning point flags the handlers above read
registerCodeHook({
  name: 'gmStrategyFlag',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

registerCodeHook({
  name: 'gmHuntForBlood',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return gmOps(state, seat)
        .filter((o) => o.order === 'conceal' || canStartFreeAction(state, { operativeId: o.id, action: 'charge', maxMove: 3, resume: 'ploy.freeAction' }))
        .map((o) => ({ param: o.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const op = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!live(op) || op.seat !== seat) return
      if (op.order === 'conceal') setOrder(ctx, op, 'engage')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: P('hunt-for-blood') }, seat)
      // the Charge is optional: nothing starts when no enemy can be reached
      startFreeAction(ctx, { operativeId: op.id, action: 'charge', maxMove: 3, resume: 'ploy.freeAction' })
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

// UNBRIDLED AGGRESSION (T-GM.34)
registerCodeHook({
  name: 'gmUnbridledAggression',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const a = state.attack
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!a || a.kind !== 'fight' || !op || op.seat !== seat || a.operativeId !== op.id || !isGm(state, op) || !live(op)) return []
      if (!ownActivation(state, op) || !fx(state, FX_CHARGED, op.id) || fx(state, FX_SEVERE, op.id)) return []
      return [{}]
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      addEffect(ctx, { source: P('unbridled-aggression'), seat, kind: FX_SEVERE, operativeId: op.id, expires: 'action' })
    },
  },
})

// GORETHIRST (T-GM.35): the counteraction's start; the order becomes Engage and only Charge, Shoot or Fight remain
registerCodeHook({
  name: 'gmGorethirst',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || !info.counteracting || !live(op) || !isGm(state, op) || op.order !== 'conceal') return []
      return [{}]
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      setOrder(ctx, op, 'engage')
      addEffect(ctx, { source: P('gorethirst'), seat, kind: FX_GORETHIRST, operativeId: op.id, expires: 'activation' })
    },
  },
})

// DESTRUCTIVE DEMISE (T-GM.36)
registerCodeHook({
  name: 'gmDestructiveDemise',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || op.status !== 'active' || op.wounds > 0 || !isGm(state, op)) return []
      return enemiesInControlRange(state, op, seat)
        .filter((e) => e.wounds > 0)
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      const foe = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!op || !foe || foe.status !== 'active') return
      const amount = d3(ctx, 'gm.demise.d3') + goreLevel(ctx.state, op.id)
      directDamage(ctx, foe.id, amount, op.id, ploy.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ploy.id, detail: foe.id }, seat)
    },
  },
})

// LACERATE FLESH (T-GM.37)
registerCodeHook({
  name: 'gmLacerateFlesh',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || !live(op) || !isGm(state, op) || goreLevel(state, op.id) > 0 || fx(state, FX_LACERATE, op.id) || gorethirstOwed(state, op)) return []
      return [{}]
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      increaseGore(ctx, op.id, 'gm.lacerate')
      addEffect(ctx, { source: P('lacerate-flesh'), seat, kind: FX_LACERATE, operativeId: op.id, expires: 'activation' })
    },
  },
})

// ---------------------------------------------------------------------------
// Equipment markers and the free (0 CP) offers
// ---------------------------------------------------------------------------

function offer(ployId: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id: `${ployId}${param ? `:${param}` : ''}`, ployId, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

/** Enemies holding one of `seat`'s Bleeding tokens within 8" of `op`. */
function bleeders(state: GameState, op: Operative): Operative[] {
  return enemiesOf(state, op).filter((e) => live(e) && hasToken(state, e.id, BLEED, op.seat) && within(op, e, 8))
}

const gmRule: PloyRule = {
  extraOffers(state, seat, window, info) {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!subject || subject.seat !== seat || !live(subject) || !isGm(state, subject)) return out
    if (gorethirstOwed(state, subject)) return out
    const counteracting = info.counteracting === true
    const a = state.attack

    // ---- between actions: Rejuvenate, Mania, Fury, Khorne's Favour, Bleeding
    if (window === 'firefight.activationStart' || window === 'firefight.actionEnded') {
      if (subject.wounds < subject.maxWounds && !svBlock(state, subject, 'rejuvenate', counteracting)) out.push(offer('gm.x.rejuvenate', 'Rejuvenate: regain D3+1 wounds', 'gm.rejuvenate', subject))
      if (!counteracting && ownActivation(state, subject)) {
        if (!svBlock(state, subject, 'mania', false)) out.push(offer('gm.x.mania', 'Mania: +1 APL until its next activation', 'gm.mania', subject))
        if (!svBlock(state, subject, 'fury', false)) out.push(offer('gm.x.fury', 'Fury: Fight twice, the second Fight free', 'gm.fury', subject))
        if (hasAbility(state, subject, A('khornes-favour')) && goreLevel(state, subject.id) === 0 && !fx(state, FX_FAVOUR, subject.id)) {
          out.push(offer('gm.x.favour', "Khorne's Favour: raise the gore tank", 'gm.favour', subject))
        }
      }
      if (goreLevel(state, subject.id) < 2) for (const e of bleeders(state, subject)) out.push(offer('gm.x.bleeding', `Bleeding: spend the token on ${e.name} to raise the gore tank`, 'gm.bleeding', subject, e.id))
    }

    // ---- SURGE, when a Charge or Reposition is declared (free ones included) in the operative's activation or
    // counteraction; never on a free Charge outside them (Hunt for Blood in the Strategy phase)
    if (window === 'firefight.actionDeclared' && (info.action === 'charge' || info.action === 'reposition') && baseActivation(state)?.operativeId === subject.id && !svBlock(state, subject, 'surge', counteracting)) {
      out.push(offer('gm.x.surge', `Surge: +1" Move for this ${info.action === 'charge' ? 'Charge' : 'Reposition'}`, 'gm.surge', subject, String(info.action)))
    }

    // ---- RAGE, when a Fight is declared
    if (window === 'firefight.actionDeclared' && info.action === 'fight' && !svBlock(state, subject, 'rage', counteracting)) {
      out.push(offer('gm.x.rage', 'Rage: +1 Atk on melee weapons for this Fight', 'gm.rage', subject))
    }

    // ---- RAKE, between a Charge's move and the end of the action
    if (window === 'firefight.chargeMoved') {
      const base = baseActivation(state)
      if (base && base.operativeId === subject.id && !base.counteract && !svBlock(state, subject, 'rake', false)) {
        for (const e of enemiesInControlRange(state, subject, seat).filter((x) => x.wounds > 0).sort((x, y) => (x.id < y.id ? -1 : 1))) {
          out.push(offer('gm.x.rake', `Rake: D3 damage to ${e.name}`, 'gm.rake', subject, e.id))
        }
      }
    }

    // ---- before damage in a Shoot: Drag (the Impaler) and Impending Apotheosis (the Blood Herald)
    if (window === 'shoot.beforeResolve' && a && a.kind === 'shoot' && a.seq?.unblocked) {
      const u = a.seq.unblocked
      if (a.operativeId === subject.id && a.weaponId === W('fleshskewer-ranged')) {
        const target = state.operatives[a.seq.targetId]
        if (target && target.seat !== seat && live(target)) {
          if (!fx(state, FX_DRAG_DONE, subject.id)) {
            const x = 2 * (u.normal + u.crit)
            out.push(offer('gm.x.drag', 'Do not drag; go on to discards', 'gm.drag', subject, '0'))
            for (let n = 1; n <= Math.min(x, Math.ceil(gap(subject, target) + 1)); n++) out.push(offer('gm.x.drag', `Drag ${target.name} up to ${n}" towards the Impaler`, 'gm.drag', subject, String(n)))
          } else {
            if (u.normal > 0) out.push(offer('gm.x.discard', 'Discard one unblocked normal success', 'gm.discard', subject, 'normal'))
            if (u.crit > 0) out.push(offer('gm.x.discard', 'Discard one unblocked critical success', 'gm.discard', subject, 'crit'))
          }
        }
      }
      if (a.seq.targetId === subject.id && hasAbility(state, subject, A('impending-apotheosis')) && !usedThisBattle(state, seat, APOTH_BATTLE) && u.normal > 0) {
        out.push(offer('gm.x.apotheosis', 'Impending Apotheosis: ignore one unblocked normal success', 'gm.apotheosis', subject))
      }
    }

    // ---- CHAOS SIGIL, at the start of the Roll Defence Dice step
    if (window === 'shoot.beforeDefenceRoll' && a && a.kind === 'shoot' && a.seq?.targetId === subject.id && equipped(state, seat, SIGIL) && !usedThisTp(state, seat, SIGIL_TP)) {
      const attacker = state.operatives[a.operativeId]
      if (attacker && a.weaponId) {
        const rs = ruleSetFor(state, attacker, a.weaponId, 'shoot', subject.id)
        if (rs.piercing > 0 || rs.piercingCrits > 0) out.push(offer('gm.x.sigil', 'Chaos Sigil: Piercing is 1 lower this sequence', 'gm.sigil', subject))
      }
    }

    // ---- INCITE THE HUNT, when the Inciter takes an enemy down from more than 2" away
    if (window === 'operative.killed' && hasAbility(state, subject, A('incite-the-hunt')) && !(state.window?.used ?? []).includes('gm.x.incite')) {
      const victim = typeof info.removedId === 'string' ? state.operatives[info.removedId] : undefined
      if (victim && victim.seat !== seat && gap(subject, victim) > 2 + EPS) {
        for (const f of gmOps(state, seat).sort((x, y) => (x.id < y.id ? -1 : 1))) {
          if (goreLevel(state, f.id) >= 2 || distanceBetween(bodyOf(f), bodyOf(victim)) > 8 + EPS) continue
          out.push(offer('gm.x.incite', `Incite the Hunt: raise ${f.name}'s gore tank`, 'gm.incite', subject, f.id))
        }
      }
    }
    return out
  },

  onUsed(ctx, seat, o) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    if (!op || !o.via?.startsWith('gm.')) return
    switch (o.via) {
      case 'gm.rejuvenate': {
        spendSv(ctx, op, 'rejuvenate')
        regainWounds(ctx, op.id, d3(ctx, 'gm.rejuvenate.d3') + 1, A('rejuvenate'))
        return
      }
      case 'gm.mania': {
        spendSv(ctx, op, 'mania')
        op.aplMods += 1
        ctx.emit({ type: 'AplModified', operativeId: op.id, delta: 1, reason: A('mania') })
        addEffect(ctx, { source: A('mania'), seat, kind: FX_MANIA, operativeId: op.id, expires: NEVER })
        return
      }
      case 'gm.fury': {
        spendSv(ctx, op, 'fury')
        addEffect(ctx, { source: A('fury'), seat, kind: FX_FURY, operativeId: op.id, expires: 'activation' })
        return
      }
      case 'gm.surge': {
        spendSv(ctx, op, 'surge', o.param)
        addEffect(ctx, { source: A('surge'), seat, kind: FX_SURGE, operativeId: op.id, expires: 'action' })
        return
      }
      case 'gm.rage': {
        spendSv(ctx, op, 'rage')
        addEffect(ctx, { source: A('rage'), seat, kind: FX_RAGE, operativeId: op.id, expires: 'action' })
        return
      }
      case 'gm.rake': {
        const foe = o.param ? s.operatives[o.param] : undefined
        if (!foe || foe.status !== 'active') return
        spendSv(ctx, op, 'rake', foe.id)
        directDamage(ctx, foe.id, d3(ctx, 'gm.rake.d3'), op.id, A('rake'))
        return
      }
      case 'gm.favour': {
        addEffect(ctx, { source: A('khornes-favour'), seat, kind: FX_FAVOUR, operativeId: op.id, expires: 'activation' })
        increaseGore(ctx, op.id, 'gm.favour')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('khornes-favour') }, seat)
        markFired('gmKhornesFavour')
        return
      }
      case 'gm.bleeding': {
        const foe = o.param ? s.operatives[o.param] : undefined
        if (!foe) return
        removeToken(ctx, foe.id, BLEED, 'gm.bleeding.used', seat)
        increaseGore(ctx, op.id, 'gm.bleeding')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('incite-the-hunt'), detail: foe.id }, seat)
        markFired('gmInciteTheHunt')
        return
      }
      case 'gm.apotheosis': {
        const u = unblockedOf(s)
        if (!u || u.normal <= 0) return
        u.normal -= 1
        markUsedBattle(s, seat, APOTH_BATTLE)
        addToken(ctx, op.id, { kind: APOTH, owner: seat, cap: 1, expires: ['battle'] }, 'gm.apotheosis')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('impending-apotheosis'), detail: 'shoot' }, seat)
        markFired('gmImpendingApotheosis')
        return
      }
      case 'gm.drag': {
        addEffect(ctx, { source: A('wr-drag'), seat, kind: FX_DRAG_DONE, operativeId: op.id, expires: 'action' })
        const n = Number(o.param ?? 0)
        const a = s.attack
        const target = a?.seq ? s.operatives[a.seq.targetId] : undefined
        if (n > 0 && target && live(target)) {
          const spot = dragSpot(s, op, target, n)
          if (spot) {
            const was = dragging
            dragging = true
            try {
              applyForcedMove(ctx, target.id, [{ x: spot.to.x, z: spot.to.z, y: spot.to.y }], n)
            } finally {
              dragging = was
            }
          }
        }
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('wr-drag'), detail: String(n) }, seat)
        markFired('gmDrag')
        return
      }
      case 'gm.discard': {
        const u = unblockedOf(s)
        if (!u) return
        if (o.param === 'crit' && u.crit > 0) u.crit -= 1
        else if (o.param === 'normal' && u.normal > 0) u.normal -= 1
        return
      }
      case 'gm.incite': {
        const f = o.param ? s.operatives[o.param] : undefined
        if (!f) return
        increaseGore(ctx, f.id, 'gm.incite')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('incite-the-hunt'), detail: f.id }, seat)
        markFired('gmInciteTheHunt')
        return
      }
      case 'gm.sigil': {
        markUsedTp(s, seat, SIGIL_TP)
        addEffect(ctx, { source: SIGIL, seat, kind: FX_SIGIL, operativeId: op.id, expires: 'action' })
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: SIGIL }, seat)
        return
      }
      default:
        return
    }
  },
}

registerPloyRule(gmRule)
