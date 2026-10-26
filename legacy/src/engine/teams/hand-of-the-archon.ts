// Hand of the Archon (docs/spec/13-teams.md section 8, rule ids T-HA.n): the code hooks this team's data names, its
// team rule provider (team-rules.ts), its ploy rule (ploy-rules.ts) and its hook handlers (hooks.ts).
//
//  - Pain tokens (tokens.ts kind 'ha.pain', owned by the Hand of the Archon player, no cap) are the spine. Power from
//    Pain fills a per-action ledger from the damage.inflicted hook (ledger.uses `ha.pfp:<performer>`) and pays out in
//    action.ended, or earlier from the operative.incapacitated hook so Vitalised Surge can spend a token earned by the
//    kill it follows. Every gain goes through gainPain, which also runs Sadistic Competition.
//  - Invigorations, Torturous Vision, Flay, Omen, Brutal Display, Toxin Coating and Refined Poison are free (0 CP) offers
//    of the ploy rule below, made in the ploy windows the batch B prep built; the per-activation invigoration limit
//    lives on the activation (`Activation.used`).
//  - Poison (ha.poison, cap 1) and the Combat Drugs (ha.drug, data.drug) are tokens too; the activation.start hook burns
//    the Poison, the moveDelta provider and the onDamageInflicted hook read the drugs.
//  - Omen: the diceRolled hook forces re-rolls of an enemy pick's 6s; the friendly pick is a value-limited re-roll grant.
//  - Everything else is a hook handler or provider named in the map at the foot of the spec section.
import { eligibleDice, forcedReroll, ruleSetFor, targetInfo, coverForSelection } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { canBeTargetedBy, hasAbility, hasKeyword, nearestEnemyDistance } from '../conditions'
import { addEffect, directDamage, gainCp, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { cancelAction, canStartFreeAction, finishAction, skipActivation, startFreeAction } from '../firefight'
import { registerHook, type ActionDeclaredData, type AfterRollData, type DamageInflictedData, type GambitPassedData, type TargetStatusData } from '../hooks'
import { baseUnderVantage, bodyOf, interveningTraits, visible } from '../los'
import { distanceBetween, enemiesInControlRange, inControlRange, markerInControlRange } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import type { Ctx } from '../registry'
import { activeOps, effectiveApl, enemiesOf, hasInjuredPenalty, otherSeat, SEATS } from '../state'
import { readyChoiceDone } from '../strategy'
import { providerAny, providerControlApl, providerControlTotal, registerTeamRules, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, removeToken, tokenCount, tokensOn } from '../tokens'
import type { Activation, DiceSide, GameState, Operative, RerollGrant, Seat } from '../types'

export const TEAM_ID = 'hand-of-the-archon'

/** Pain tokens: per operative, uncapped, owned by the Hand of the Archon player. */
export const PAIN = 'ha.pain'
/** Poison tokens (Torment grenade): at most one per owner on an operative. Not the Plague Marines' 'pm.poison'. */
export const POISON = 'ha.poison'
/** Combat drug token: one per Hand of the Archon operative, `data.drug` says which. */
export const DRUG = 'ha.drug'
/** Omen: on the operative the Skysplinter Assassin named; the token's owner is the Hand of the Archon player. */
export const OMEN = 'ha.omen'
/** MARK: on the enemy, `sourceId` is the Assassin. */
export const MARK = 'ha.mark'
/** Brutal Display: the marked enemy cannot control markers or do Pick Up Marker and mission actions. */
export const BRUTAL = 'ha.brutal-display'

const HA = 'HAND OF THE ARCHON'
const EPS = 1e-6

export type Drug = 'painbringer' | 'adrenalight' | 'hypex'
const DRUGS: readonly Drug[] = ['painbringer', 'adrenalight', 'hypex']
const DRUG_OF_ABILITY: Record<string, Drug> = { 'ha.a.painbringer': 'painbringer', 'ha.a.adrenalight': 'adrenalight', 'ha.a.hypex': 'hypex' }
const DRUG_NAME: Record<Drug, string> = { painbringer: 'Painbringer', adrenalight: 'Adrenalight', hypex: 'Hypex' }

const ID = {
  cunning: 'ha.a.cunning',
  torturous: 'ha.a.torturous-vision',
  sadistic: 'ha.a.sadistic-competition',
  brutalDisplay: 'ha.a.brutal-display',
  duellist: 'ha.a.crimson-duellist',
  insensible: 'ha.a.insensible-to-pain',
  hunter: 'ha.a.merciless-hunter',
  omen: 'ha.a.omen',
  mark: 'ha.a.mark',
  combatDrugs: 'ha.a.combat-drugs',
  administer: 'ha.a.administer-drug',
  tormentGrenade: 'ha.a.torment-grenade',
  sadists: 'ha.p.merciless-sadists',
  fromDarkness: 'ha.p.from-darkness-death',
  denizens: 'ha.p.denizens-of-night',
  cruel: 'ha.p.cruel-deception',
  scheme: 'ha.p.devious-scheme',
  arrogance: 'ha.p.heinous-arrogance',
  prey: 'ha.p.prey-on-the-wounded',
  chainSnare: 'ha.e.chain-snare',
  toxin: 'ha.e.toxin-coating',
  refined: 'ha.e.refined-poison',
  razorflail: 'ha.w.razorflail',
  stinger: 'ha.w.stinger-pistol',
  sculptors: 'ha.w.pain-sculptors',
  razorwing: 'ha.w.razorwing',
  rifle: 'ha.w.splinter-rifle',
} as const

const MARK_ACTION = `ability:${ID.mark}`
const REFINED_WEAPONS = ['ha.w.shardcarbine', 'ha.w.splinter-cannon-focused', 'ha.w.splinter-cannon-sweeping', 'ha.w.splinter-pistol', 'ha.w.splinter-rifle', 'ha.w.stinger-pistol']
const DICE_SOURCES = ['normal', 'crit', 'strike-normal', 'strike-crit', 'devastating']

// Keys of the shared ledgers (ledger.tp is cleared every turning point, ledger.battle never).
const K = {
  sadisticCompetition: 'ha.sc',
  brutalDisplay: 'ha.brutal-display',
  cunningDecided: 'ha.cunning',
  omenPicked: 'ha.omen',
  chainSnare: 'ha.e.chain-snare',
  invigoration: (seat: Seat) => `ha.inv:${seat}`,
  senses: (seat: Seat) => `ha.ss:${seat}`,
  pfp: (opId: string) => `ha.pfp:${opId}`,
  pfpPaid: (opId: string) => `ha.pfpPaid:${opId}`,
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isHa(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, HA)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function haOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state)
    .filter((o) => o.seat === seat && live(o) && isHa(state, o))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : 1
}

function gap(a: Operative, b: Operative): number {
  return distanceBetween(bodyOf(a), bodyOf(b))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return gap(a, b) <= inches + EPS
}

function d3(ctx: Ctx, purpose: string): number {
  const [r] = ctx.roll(purpose, 1)
  return Math.ceil(r! / 2)
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function hotaSeatPresent(state: GameState): boolean {
  return SEATS.some((s) => state.players[s].teamId === TEAM_ID)
}

export function painOf(state: GameState, opId: string): number {
  const op = state.operatives[opId]
  return op ? tokenCount(state, opId, PAIN, op.seat) : 0
}

/** The combat drug the operative has, if any. */
export function drugOf(state: GameState, opId: string): Drug | null {
  const t = tokensOn(state, opId).find((x) => x.kind === DRUG)
  const d = t?.data?.drug
  return typeof d === 'string' && (DRUGS as readonly string[]).includes(d) ? (d as Drug) : null
}

function setDrug(ctx: Ctx, op: Operative, drug: Drug, reason: string): void {
  const t = tokensOn(ctx.state, op.id).find((x) => x.kind === DRUG)
  if (t) {
    t.data = { ...(t.data ?? {}), drug }
    ctx.emit({ type: 'TokenChanged', operativeId: op.id, kind: DRUG, owner: t.owner, count: t.count, delta: 0, reason }, op.seat)
  } else addToken(ctx, op.id, { kind: DRUG, owner: op.seat, data: { drug } }, reason)
}

/**
 * The activation or counteraction in progress, looking under a free-action or interrupt frame (the invigoration limit
 * and the per-activation ledgers belong to it).
 */
function baseActivation(state: GameState): Activation | null {
  const cur = state.firefight.activation
  if (!cur) return null
  if (!cur.frame) return cur
  return (state.firefight.stack ?? []).at(-1) ?? cur
}

/** The operative's own activation (not a counteraction, not a Guard interrupt), looking under a free-action frame. */
function ownActivation(state: GameState, op: Operative): Activation | null {
  const cur = state.firefight.activation
  if (!cur || cur.frame?.kind === 'interrupt') return null
  const base = baseActivation(state)
  return base && base.operativeId === op.id && !base.counteract ? base : null
}

function usedKey(act: Activation | null, key: string): boolean {
  return !!act && (act.used ?? []).includes(key)
}

function markKey(act: Activation, key: string): void {
  act.used = [...(act.used ?? []), key]
}

function tpCount(state: GameState, seat: Seat, key: string): number {
  return state.ledger[seat].tp.filter((k) => k === key || k.startsWith(`${key}#`)).length
}

function addTpCount(state: GameState, seat: Seat, key: string): void {
  state.ledger[seat].tp.push(`${key}#${tpCount(state, seat, key) + 1}`)
}

function sideOfOp(state: GameState, opId: string): DiceSide | null {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId && seq.atk.weaponId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

function isAttackerNow(state: GameState, op: Operative): boolean {
  const a = state.attack
  return !a || a.operativeId === op.id
}

// ---------------------------------------------------------------------------
// Pain tokens (T-HA.25) and Sadistic Competition (T-HA.9)
// ---------------------------------------------------------------------------

/** Every Pain gain goes through here: tokens, then Sadistic Competition (once per TP, one other Agent). */
export function gainPain(ctx: Ctx, opId: string, n: number, reason: string): number {
  const op = ctx.state.operatives[opId]
  if (!op || n <= 0) return 0
  const got = addToken(ctx, opId, { kind: PAIN, owner: op.seat, count: n }, reason)
  if (got > 0) sadisticCompetition(ctx, op)
  return got
}

function sadisticCompetition(ctx: Ctx, gainer: Operative): void {
  const s = ctx.state
  const seat = gainer.seat
  if (usedThisTp(s, seat, K.sadisticCompetition)) return
  const agents = haOps(s, seat)
    .filter((o) => hasKeyword(s, o, 'AGENT') && !hasToken(s, o.id, PAIN, seat))
    .sort((a, b) => gap(gainer, a) - gap(gainer, b) || byId(a, b))
  const agent = agents[0]
  if (!agent) return
  markUsedTp(s, seat, K.sadisticCompetition)
  if (addToken(ctx, agent.id, { kind: PAIN, owner: seat }, 'ha.sadisticCompetition') > 0) {
    ctx.emit({ type: 'AbilityUsed', operativeId: agent.id, abilityId: ID.sadistic, detail: gainer.id }, seat)
    markFired('haSadisticCompetition')
  }
}

function spendPain(ctx: Ctx, opId: string, reason: string): void {
  const op = ctx.state.operatives[opId]
  if (op) removeToken(ctx, opId, PAIN, reason, op.seat, 1)
}

/** The Hand of the Archon operative whose action is in progress (a frame counts), if any. */
function performerOf(state: GameState): Operative | null {
  const act = state.firefight.activation
  const op = act ? state.operatives[act.operativeId] : undefined
  return op && isHa(state, op) ? op : null
}

const entitlement = (v: number): number => ((v & 2) !== 0 ? 2 : (v & 1) !== 0 ? 1 : 0)

/** Pay what the action has earned so far and not yet paid; `final` ends the ledger (the action is over). */
function settlePain(ctx: Ctx, op: Operative, final: boolean): void {
  const uses = ctx.state.ledger[op.seat].uses
  const key = K.pfp(op.id)
  const paidKey = K.pfpPaid(op.id)
  const have = uses[key]
  if (have !== undefined) {
    const give = entitlement(have) - (uses[paidKey] ?? 0)
    // the performer must still be in the killzone after the action (tokens sit on operatives)
    if (give > 0 && live(op)) {
      gainPain(ctx, op.id, give, 'ha.powerFromPain')
      uses[paidKey] = entitlement(have)
      markFired('haPowerFromPain')
    }
  }
  if (final) {
    delete uses[key]
    delete uses[paidKey]
  }
}

function trackPain(ctx: Ctx, victim: Operative, d: DamageInflictedData): void {
  const s = ctx.state
  const performer = performerOf(s)
  if (!performer || victim.seat === performer.seat) return
  const incapacitated = d.woundsBefore > 0 && d.woundsAfter <= 0
  const injured = !incapacitated && d.woundsAfter > 0 && d.woundsBefore * 2 >= victim.maxWounds && d.woundsAfter * 2 < victim.maxWounds
  if (!incapacitated && !injured) return
  const key = K.pfp(performer.id)
  const uses = s.ledger[performer.seat].uses
  uses[key] = (uses[key] ?? 0) | (incapacitated && victim.maxWounds >= 12 ? 3 : 1)
}

// ---------------------------------------------------------------------------
// Stinger (T-HA.13)
// ---------------------------------------------------------------------------

function stingerBurst(ctx: Ctx, fallenId: string, sourceId: string, seen: Set<string>): void {
  const s = ctx.state
  const fallen = s.operatives[fallenId]
  if (!fallen || seen.has(fallenId)) return
  seen.add(fallenId)
  for (const o of activeOps(s).filter((x) => x.id !== fallenId && live(x)).sort(byId)) {
    // "each other operative visible to and within 2 inches of it": seen from the fallen operative
    if (!within(fallen, o, 2) || !visible(s, bodyOf(fallen), bodyOf(o))) continue
    directDamage(ctx, o.id, d3(ctx, 'ha.stinger'), sourceId, 'ha.stinger')
    if (o.wounds <= 0) stingerBurst(ctx, o.id, sourceId, seen)
  }
}

registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const victim = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !victim) return null
    const d = c.data as unknown as DamageInflictedData
    if (!hotaSeatPresent(state)) return null
    if (d.amount > 0) trackPain(ctx, victim, d)
    if (d.weaponId === ID.stinger && d.woundsBefore > 0 && d.woundsAfter <= 0 && DICE_SOURCES.includes(d.source)) {
      const attacker = state.operatives[d.attackerId]
      if (attacker && attacker.seat !== victim.seat) {
        markFired('haStinger')
        stingerBurst(ctx, victim.id, attacker.id, new Set())
      }
    }
    return null
  },
  'ha.damage.inflicted',
)

// The attack has finished and its victims are about to be removed: pay the Pain the action earned, so a Vitalised Surge
// offered after the kill can spend it.
registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const state = c.state
    if (!ctx || !state || !hotaSeatPresent(state)) return null
    const performer = performerOf(state)
    if (performer) settlePain(ctx, performer, false)
    return null
  },
  'ha.operative.incapacitated',
)

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !op || !isHa(state, op)) return null
    settlePain(ctx, op, true)
    return null
  },
  'ha.action.ended',
)

// ---------------------------------------------------------------------------
// Activation: Poison damage, Dark Animus expiry, the order From Darkness, Death judges eligibility on
// ---------------------------------------------------------------------------

/** Dark Animus lasts until the operative's next activation starts: its effect never expires by itself, the activation.start hook ends it. */
const ANIMUS_EXPIRY = 'ha.darkAnimus'

function animusEffect(state: GameState, opId: string) {
  return state.effects.find((e) => e.kind === 'ha.darkAnimus' && e.operativeId === opId)
}

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !op || !live(op)) return null
    const data = c.data as { previousOrder?: string; joint?: boolean }
    // Dark Animus lasts until the start of the operative's next activation, before any action
    const fx = animusEffect(state, op.id)
    if (fx) {
      op.aplMods -= 1
      removeEffects(ctx, (e) => e.id === fx.id)
      ctx.emit({ type: 'AplModified', operativeId: op.id, delta: -1, reason: 'ha.darkAnimus.expired' }, op.seat)
    }
    // From Darkness, Death judges eligibility on the order the operative had before this activation
    const act = state.firefight.activation
    if (act && !data.joint && !act.frame && !act.counteract && data.previousOrder) markKey(act, `ha.prevOrder:${data.previousOrder}`)
    // Poison: D3 damage to the activated holder, first among the "is activated" effects (core update log ordering)
    for (const t of [...tokensOn(state, op.id)]) {
      if (t.kind !== POISON) continue
      const src = (t.sourceId && state.operatives[t.sourceId]?.status === 'active' ? t.sourceId : undefined) ?? haOps(state, t.owner)[0]?.id ?? op.id
      markFired('haPoison')
      directDamage(ctx, op.id, d3(ctx, 'ha.poison.damage'), src, 'ha.poison')
      if (!live(op)) return null
    }
    return null
  },
  'ha.activation.start',
)

// ---------------------------------------------------------------------------
// The Ready step: Adrenalight; stale ledgers
// ---------------------------------------------------------------------------

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx || !hotaSeatPresent(ctx.state)) return null
    const s = ctx.state
    for (const seat of SEATS) {
      for (const k of Object.keys(s.ledger[seat].uses)) if (k.startsWith('ha.pfp')) delete s.ledger[seat].uses[k]
      // Adrenalight (T-HA.17) is the owner's pick: the shared Ready-step choice (provider readyStepChoices)
    }
    return null
  },
  'ha.turningPoint.start',
)

const ADRENALIGHT_TP = 'ha.adrenalight'

/** Adrenalight holders the owner may pick in this Ready step, listed fewest Pain first, the Archsybarite first on a tie. */
function adrenalightHolders(s: GameState, seat: Seat): Operative[] {
  if (s.players[seat].teamId !== TEAM_ID || s.phase !== 'strategy' || usedThisTp(s, seat, ADRENALIGHT_TP)) return []
  const holders = haOps(s, seat).filter((o) => drugOf(s, o.id) === 'adrenalight')
  return holders.sort((a, b) => painOf(s, a.id) - painOf(s, b.id) || Number(hasKeyword(s, b, 'ARCHSYBARITE')) - Number(hasKeyword(s, a, 'ARCHSYBARITE')) || byId(a, b))
}

// ---------------------------------------------------------------------------
// Damage: Insensible to Pain and Refined Poison (modifyDamage), Painbringer
// ---------------------------------------------------------------------------

registerHook(
  'modifyDamage',
  (c) => {
    const state = c.state
    const attacker = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const target = state && c.targetId ? state.operatives[c.targetId] : undefined
    if (!state || !attacker || !target) return null
    const data = c.data as { weaponId: string; dmg: { normal: number; crit: number } }
    // Refined Poison: +1 Normal Dmg for the action (T-HA.43)
    const refined = state.effects.find((e) => e.source === ID.refined && e.operativeId === attacker.id && e.data?.weaponId === data.weaponId)
    if (refined) {
      data.dmg.normal += 1
      markFired('haRefinedPoison')
    }
    // Insensible to Pain: applied last, to the final Dmg values (T-HA.20)
    if (hasAbility(state, target, ID.insensible)) {
      if (data.dmg.normal >= 3) data.dmg.normal -= 1
      if (data.dmg.crit >= 3) data.dmg.crit -= 1
      markFired('haInsensibleToPain')
    }
    return null
  },
  'ha.modifyDamage',
)

registerHook(
  'onDamageInflicted',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !op || drugOf(state, op.id) !== 'painbringer') return null
    const data = c.data as { source: string; amount: number }
    if (!DICE_SOURCES.includes(data.source) || data.amount < 3) return null
    const [r] = ctx.roll('ha.painbringer', 1)
    if (r === 6) {
      data.amount -= 1
      markFired('haPainbringer')
    }
    return null
  },
  'ha.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// Weapon rules: MARK's Seek Light, Merciless Sadists' Balanced, Toxin Coating's Lethal, Rifles' Accurate
// ---------------------------------------------------------------------------

function markedBy(state: GameState, target: Operative, shooterId: string): boolean {
  return tokensOn(state, target.id).some((t) => t.kind === MARK && t.sourceId === shooterId)
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !op || !c.weaponId) return null
    const weapon = state.data.weapons[c.weaponId]
    if (!weapon) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: { rule: string; x?: number; target?: number }[] }
    const target = data.targetId ? state.operatives[data.targetId] : undefined
    // MARK (T-HA.24): Seek Light against the marked enemy
    if (target && data.kind === 'shoot' && weapon.type === 'ranged' && markedBy(state, target, op.id)) {
      if (!data.rules.some((r) => r.rule === 'seek-light')) data.rules.push({ rule: 'seek-light' })
      markFired('haMark')
    }
    if (!isHa(state, op)) return null
    // Merciless Sadists (T-HA.33): Balanced against a wounded enemy; the attacker only (retaliating is not shooting or fighting)
    if (target && target.seat !== op.seat && target.wounds < target.maxWounds && ployActive(state, op.seat, ID.sadists) && isAttackerNow(state, op)) {
      if (!data.rules.some((r) => r.rule === 'balanced')) data.rules.push({ rule: 'balanced' })
      markFired('haMercilessSadists')
    }
    // Toxin Coating (T-HA.42): Lethal 5+ for the sequence
    if (data.kind === 'fight' && state.effects.some((e) => e.source === ID.toxin && e.operativeId === op.id && e.data?.weaponId === c.weaponId)) {
      data.rules.push({ rule: 'lethal', target: 5 })
      markFired('haToxinCoating')
    }
    // Rifles (T-HA.31): Accurate 1 in an activation without Charge, Fall Back or Reposition; never in a counteraction
    if (data.kind === 'shoot' && c.weaponId === ID.rifle && riflesApply(state, op)) {
      data.rules.push({ rule: 'accurate', x: 1 })
      markFired('haRifles')
    }
    return null
  },
  'ha.modifyWeaponRules',
)

/** RIFLES: the activation the shot belongs to (an interrupt's own frame, a free action's activation underneath). */
export function riflesApply(state: GameState, op: Operative): boolean {
  const cur = state.firefight.activation
  if (!cur) return true
  let act: Activation = cur
  if (cur.frame?.kind === 'free') {
    const under = (state.firefight.stack ?? []).at(-1)
    if (under && under.operativeId === op.id) act = under
  }
  if (act.operativeId !== op.id || act.counteract) return false
  return !act.performed.some((a) => a === 'charge' || a === 'fallBack' || a === 'reposition')
}

// ---------------------------------------------------------------------------
// Dice: Omen, Denizens of Night
// ---------------------------------------------------------------------------

function omenKind(state: GameState, op: Operative): 'enemy' | 'friend' | null {
  const t = tokensOn(state, op.id).find((x) => x.kind === OMEN)
  if (!t) return null
  return t.owner === op.seat ? 'friend' : 'enemy'
}

// An enemy pick re-rolls its 6s at once, before any optional re-roll (T-HA.23)
registerHook(
  'diceRolled',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !op || omenKind(state, op) !== 'enemy') return null
    const data = c.data as { kind: 'shoot' | 'fight'; side: 'attack' | 'defence'; diceSide: DiceSide }
    const side = data.diceSide
    const sixes = eligibleDice(side).filter((i) => side.dice[i]!.value === 6)
    if (sixes.length === 0) return null
    markFired('haOmen')
    forcedReroll(ctx, side, sixes, ID.omen, data.side, data.kind)
    return null
  },
  'ha.diceRolled',
)

// A friendly pick may re-roll its 1s
const OMEN_GRANT_ID = 'ha.omen'
const omenGrant = (): RerollGrant => ({ id: OMEN_GRANT_ID, source: ID.omen, mode: 'any', used: false, values: [1] })

registerHook(
  'modifyAttackDice',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !op || omenKind(state, op) !== 'friend') return null
    const data = c.data as { rerolls: RerollGrant[] }
    if (!data.rerolls.some((r) => r.id === OMEN_GRANT_ID)) data.rerolls.push(omenGrant())
    return null
  },
  'ha.modifyAttackDice',
)

registerHook(
  'modifyDefenceDice',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const shooter = state && c.targetId ? state.operatives[c.targetId] : undefined
    if (!state || !op) return null
    const data = c.data as { rerolls: RerollGrant[] }
    if (omenKind(state, op) === 'friend' && !data.rerolls.some((r) => r.id === OMEN_GRANT_ID)) data.rerolls.push(omenGrant())
    // Denizens of Night (T-HA.35)
    if (shooter && isHa(state, op) && shooter.seat !== op.seat && ployActive(state, op.seat, ID.denizens) && nearestEnemyDistance(state, op) > 2) {
      const traits = interveningTraits(state, bodyOf(shooter), { ...bodyOf(op), order: op.order })
      if ((traits.light || traits.heavy || baseUnderVantage(state, bodyOf(op))) && !data.rerolls.some((r) => r.id === 'ha.denizens')) {
        data.rerolls.push({ id: 'ha.denizens', source: ID.denizens, mode: 'one', used: false })
        markFired('haDenizens')
      }
    }
    return null
  },
  'ha.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// Shoot target selection: Merciless Hunter's weapon pairing, MARK finding targets Light cover hides
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    if (!state || !op || data.secondary || !isHa(state, op)) return null
    // Merciless Hunter: with two Shoots, exactly one uses the razorwing (T-HA.22)
    if (hasAbility(state, op, ID.hunter)) {
      const act = state.firefight.activation
      if (act && act.operativeId === op.id && !act.frame && !act.counteract && act.performed.includes('shoot')) {
        const prev = [...(act.weaponsUsed ?? [])].filter((w) => state.data.weapons[w]?.type === 'ranged').pop()
        const wasWing = prev === ID.razorwing
        const isWing = data.weaponId === ID.razorwing
        if (prev !== undefined && wasWing === isWing) data.candidates.length = 0
      }
    }
    // MARK: Seek Light makes a marked Conceal enemy in Light cover a valid target (T-HA.24)
    if (state.data.weapons[data.weaponId]?.type === 'ranged') {
      for (const e of enemiesOf(state, op)) {
        if (data.candidates.includes(e.id) || e.wounds <= 0 || !markedBy(state, e, op.id)) continue
        const rules = ruleSetFor(state, op, data.weaponId, 'shoot', e.id)
        if (rules.range !== null && !within(op, e, rules.range)) continue
        if (enemiesInControlRange(state, e, e.seat).length > 0) continue
        const info = targetInfo(state, op, e, rules)
        if (!info.verdict.visible || (e.order === 'conceal' && coverForSelection(state, info.verdict, { ...rules, seekLight: true }))) continue
        data.candidates.push(e.id)
        markFired('haMark')
      }
    }
    return null
  },
  'ha.beforeShootTargetSelect',
)

// The marked enemy cannot be obscured against the Assassin
registerHook(
  'target.status',
  (c) => {
    const state = c.state
    const shooter = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const target = state && c.targetId ? state.operatives[c.targetId] : undefined
    if (!state || !shooter || !target || !markedBy(state, target, shooter.id)) return null
    ;(c.data as unknown as TargetStatusData).obscured = false
    markFired('haMark')
    return null
  },
  'ha.target.status',
)

// ---------------------------------------------------------------------------
// From Darkness, Death: a normal success retained as a crit at the first sequence against the picked enemy
// ---------------------------------------------------------------------------

registerHook(
  'afterAttackRoll',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const data = c.data as unknown as AfterRollData
    if (!ctx || !state || !op || data.side !== 'attack' || !c.targetId) return null
    const fx = state.effects.find((e) => e.kind === 'ha.fdd' && e.operativeId === op.id && e.data?.enemyId === c.targetId)
    if (!fx) return null
    const normal = data.dice.find((d) => d.kind === 'normal' && !d.used && d.value !== null && !d.tag)
    if (normal && data.kind === 'shoot') {
      // shooting: the player may decline (a crit is not always better); declining still spends the first time
      const id = `ha.fdd:${fx.id}`
      const answer = data.choices[id]
      if (answer === undefined) {
        data.requests.push({
          id,
          seat: op.seat,
          labelKey: 'ha.fdd.choice',
          options: [
            { id: 'crit', labelKey: 'ha.fdd.retainCrit' },
            { id: 'keep', labelKey: 'ha.fdd.keepNormal' },
          ],
        })
        return null
      }
      if (answer === 'crit') {
        normal.kind = 'crit'
        normal.tag = 'ha.fdd'
        markFired('haFromDarkness')
      }
    } else if (normal) {
      normal.kind = 'crit'
      normal.tag = 'ha.fdd'
      markFired('haFromDarkness')
    }
    removeEffects(ctx, (e) => e.id === fx.id)
    return null
  },
  'ha.afterAttackRoll',
)

// ---------------------------------------------------------------------------
// Fight: Flay marks the sequence the first time pain sculptors strike with a crit
// ---------------------------------------------------------------------------

registerHook(
  'beforeStrike',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const seq = state?.attack?.seq
    if (!state || !op || !seq || c.weaponId !== ID.sculptors) return null
    const data = c.data as { die: string; cancel: boolean }
    const key = `ha.flay:${op.id}`
    if (data.die === 'crit' && !data.cancel && seq.choices[key] === undefined) seq.choices[key] = '1'
    return null
  },
  'ha.beforeStrike',
)

// ---------------------------------------------------------------------------
// Chain Snare (T-HA.40) and Cunning (T-HA.7)
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const enemy = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const data = c.data as unknown as ActionDeclaredData
    if (!ctx || !state || !enemy || data.action !== 'fallBack' || !live(enemy)) return null
    const seat = otherSeat(enemy.seat)
    if (!equipped(state, seat, ID.chainSnare) || usedThisTp(state, seat, K.chainSnare)) return null
    // a friendly Hand of the Archon operative with the enemy in its control range and no other enemy there
    const snarers = haOps(state, seat).filter((f) => {
      if (!inControlRange(state, bodyOf(f), bodyOf(enemy))) return false
      const foes = enemiesInControlRange(state, f, f.seat)
      return foes.length === 1 && foes[0]!.id === enemy.id
    })
    if (snarers.length === 0) return null
    // 2D6 when the enemy's Wounds stat is not higher than the snaring operative's (the best operative is used)
    const snarer = snarers.find((f) => enemy.maxWounds <= f.maxWounds) ?? snarers[0]!
    const dice = ctx.roll('ha.chainSnare', enemy.maxWounds > snarer.maxWounds ? 1 : 2)
    ctx.emit({ type: 'AbilityUsed', operativeId: snarer.id, abilityId: ID.chainSnare, detail: enemy.id }, seat)
    if (dice.some((d) => d >= 4)) {
      markUsedTp(state, seat, K.chainSnare)
      data.cancel = true
      data.bar = true
      data.reason = 'Chain Snare'
      markFired('haChainSnare')
    }
    return null
  },
  'ha.action.declared',
)

function isMissionGambit(state: GameState, gambitId: string): boolean {
  const ploy = state.data.ploys?.[gambitId]
  if (ploy) return !ploy.team
  return !state.data.gambits.find((g) => g.id === gambitId)?.teamId
}

registerHook(
  'gambit.passed',
  (c) => {
    const ctx = c.engine
    const state = c.state
    if (!ctx || !state) return null
    const seat = c.seat
    if (state.players[seat].teamId !== TEAM_ID) return null
    const d = c.data as unknown as GambitPassedData
    if (usedThisTp(state, seat, K.cunningDecided)) return null
    // the pass is the seat's first decision unless a team strategy ploy was used first (mission gambits are ignored)
    const spoiled = d.usedThisStep.some((u) => u.seat === seat && !isMissionGambit(state, u.gambitId))
    markUsedTp(state, seat, K.cunningDecided)
    if (spoiled) return null
    if (!haOps(state, seat).some((o) => hasAbility(state, o, ID.cunning))) return null
    gainCp(ctx, seat, 1, 'ha.cunning')
    markFired('haCunning')
    return null
  },
  'ha.gambit.passed',
)

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

/** Re-entry guard: Brutal Display's controlTotal works out the enemy side's total through the same providers. */
let brutalGuard = false

const MISSION_FORBIDDEN = 'Brutal Display: it cannot pick up markers or perform mission actions until the next turning point'

registerTeamRules({
  id: TEAM_ID,
  // Adrenalight (T-HA.17): "you may pick" one holder in the Ready step to gain a Pain token (passing picks none)
  readyStepChoices(state, seat): ReactionOffer[] {
    return adrenalightHolders(state, seat).map((o) => ({ hook: 'haCombatDrugs', operativeId: o.id, option: 'adrenalight', labelKey: 'ha.adrenalight', data: { name: `Adrenalight: ${o.name} gains a Pain token` } }))
  },
  maxRepeats(state, op, actionId, performed) {
    if (!isHa(state, op)) return null
    // Crimson Duellist (T-HA.11): two Fight actions
    if (actionId === 'fight' && hasAbility(state, op, ID.duellist)) return 2
    // Merciless Hunter (T-HA.22): two Shoot actions unless MARK was performed
    if (actionId === 'shoot' && hasAbility(state, op, ID.hunter)) return performed.includes(MARK_ACTION) ? null : 2
    return null
  },
  actionForbidden(state, op, actionId) {
    // Brutal Display (T-HA.10): no Pick Up Marker and no mission action
    if (hasToken(state, op.id, BRUTAL)) {
      if (actionId === 'marker:pickUp') return MISSION_FORBIDDEN
      if (actionId.startsWith('ability:') && (state.data.abilities[actionId.slice(8)]?.keywords ?? []).includes('MISSION')) return MISSION_FORBIDDEN
    }
    // Merciless Hunter: MARK is out once two Shoots were made
    if (actionId === MARK_ACTION && hasAbility(state, op, ID.hunter)) {
      const act = state.firefight.activation
      if (act && act.operativeId === op.id && !act.counteract && act.performed.filter((a) => a === 'shoot').length >= 2) {
        return 'Merciless Hunter: two Shoots were made, so no MARK this activation'
      }
    }
    return null
  },
  actionCostDelta(state, op, actionId) {
    // Cruel Deception (T-HA.36): Fall Back costs 1 less for the rest of the activation
    if (actionId === 'fallBack' && state.effects.some((e) => e.source === ID.cruel && e.operativeId === op.id)) {
      markFired('haCruelDeception')
      return -1
    }
    return 0
  },
  moveDelta(state, op) {
    // Hypex (T-HA.18): the Move loss from real injury is ignored; injury-equivalent penalties are not cancelled
    if (!isHa(state, op) || drugOf(state, op.id) !== 'hypex' || !hasInjuredPenalty(op) || providerAny(state, op, 'injuredEquivalent')) return 0
    markFired('haHypex')
    return 2
  },
  controlTotal(state, seat, marker, total, contesting) {
    // Brutal Display (T-HA.10): a cowed operative still contests (its APL counts, so it can deny the enemy and help
    // friends), but it cannot be the one that controls: when every operative of its side on the marker is cowed, the
    // side's total is held to the enemy's, so the best it can reach is a tie (nobody controls)
    if (brutalGuard || contesting.length === 0 || !contesting.every((id) => hasToken(state, id, BRUTAL))) return null
    const enemy = otherSeat(seat)
    brutalGuard = true
    try {
      const foes = activeOps(state).filter((o) => o.seat === enemy && markerInControlRange(state, bodyOf(o), marker))
      let theirs = 0
      for (const o of foes) theirs += providerControlApl(state, o, marker, effectiveApl(o))
      theirs = providerControlTotal(state, enemy, marker, theirs, foes.map((o) => o.id))
      if (total <= theirs) return null
      markFired('haBrutalDisplay')
      return theirs
    } finally {
      brutalGuard = false
    }
  },
  blockCapacity(state, attack, seat) {
    // Tangle (T-HA.12): each block of the razorflail's wielder cancels two successes
    const seq = attack.seq
    if (!seq) return null
    const side = seq.atk.seat === seat && seq.atk.weaponId ? seq.atk : seq.def
    return side && side.seat === seat && side.weaponId === ID.razorflail ? 2 : null
  },
})

// ---------------------------------------------------------------------------
// Unique actions
// ---------------------------------------------------------------------------

/** Poison test (T-HA.14): D6, +1 if the operative's Save is 4+ or worse; on a 3 or more D3 damage and a Poison token. */
function poisonTest(ctx: Ctx, victim: Operative, owner: Operative): void {
  if (!live(victim)) return
  const [roll] = ctx.roll('ha.poison.test', 1)
  const total = roll! + (victim.save >= 4 ? 1 : 0)
  if (total < 3) return
  addToken(ctx, victim.id, { kind: POISON, owner: owner.seat, cap: 1, sourceId: owner.id }, 'ha.tormentGrenade')
  directDamage(ctx, victim.id, d3(ctx, 'ha.poison.damage'), owner.id, 'ha.tormentGrenade')
}

function grenadeTargets(state: GameState, op: Operative): Operative[] {
  return enemiesOf(state, op)
    .filter((e) => live(e) && within(op, e, 6) && visible(state, bodyOf(op), bodyOf(e)))
    .sort(byId)
}

registerCodeHook({
  name: 'haTormentGrenade',
  action: {
    offers(state, op): OfferSeed[] {
      return grenadeTargets(state, op).map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const target = s.operatives[params.targetId as string]
      if (!target || !live(target) || target.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      // the target, then every other operative within 1" of it (either side), in id order
      const around = activeOps(s)
        .filter((o) => o.id !== target.id && live(o) && within(o, target, 1))
        .sort(byId)
      for (const v of [target, ...around]) poisonTest(ctx, v, op)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/** Friendly Hand of the Archon operatives ADMINISTER DRUG can pick: seen within 3", the Elixicant itself included. */
export function drugTargets(state: GameState, op: Operative): Operative[] {
  return haOps(state, op.seat).filter((f) => f.id === op.id || (within(op, f, 3) && visible(state, bodyOf(op), bodyOf(f))))
}

registerCodeHook({
  name: 'haAdministerDrug',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const t of drugTargets(state, op)) {
        if (t.wounds < t.maxWounds) out.push({ key: `${t.id}:heal`, params: { targetId: t.id, param: 'heal' } })
        const has = drugOf(state, t.id)
        for (const d of DRUGS) if (d !== has) out.push({ key: `${t.id}:${d}`, params: { targetId: t.id, param: d } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const t = s.operatives[params.targetId as string]
      const choice = String(params.param)
      if (!t || !live(t) || t.seat !== op.seat) {
        cancelAction(ctx)
        return
      }
      if (choice === 'heal') {
        const dice = ctx.roll('ha.administerDrug', 2)
        regainWounds(ctx, t.id, dice.reduce((n, d) => n + Math.ceil(d / 2), 0), def.id)
      } else if ((DRUGS as readonly string[]).includes(choice)) {
        setDrug(ctx, t, choice as Drug, 'ha.administerDrug')
      } else {
        cancelAction(ctx)
        return
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: `${t.id}:${choice}` }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'haMarkAction',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => live(e) && !markedBy(state, e, op.id) && visible(state, bodyOf(op), bodyOf(e)))
        .sort(byId)
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!t || !live(t) || t.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      addToken(ctx, t.id, { kind: MARK, owner: op.seat, sourceId: op.id, expires: ['turningPointEnd'], cap: 1 }, 'ha.mark')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// Combat Drugs (T-HA.15): named by the Elixicant's card, so it only runs when an Elixicant is in the roster
registerCodeHook({
  name: 'haCombatDrugs',
  // the Ready-step Adrenalight pick (provider readyStepChoices)
  choice(ctx, op, option, context) {
    if (context.readyStep === true && option === 'adrenalight' && !usedThisTp(ctx.state, op.seat, ADRENALIGHT_TP)) {
      markUsedTp(ctx.state, op.seat, ADRENALIGHT_TP)
      markFired('haAdrenalight')
      gainPain(ctx, op.id, 1, 'ha.adrenalight')
    }
    readyChoiceDone(ctx)
  },
  setup(ctx, seat) {
    const s = ctx.state
    const drug = DRUG_OF_ABILITY[s.config[seat].choices['combat-drug'] ?? '']
    if (!drug) return
    for (const op of Object.values(s.operatives)) {
      if (op.seat !== seat || !isHa(s, op)) continue
      // set-up runs before deployment (operatives are in reserve), so the tokens are written directly
      ;(op.tokens ??= []).push({ kind: DRUG, owner: seat, count: 1, since: 0, data: { drug } })
    }
  },
})

// ---------------------------------------------------------------------------
// Ploys
// ---------------------------------------------------------------------------

function flagPloy(name: string): void {
  registerCodeHook({
    name,
    ploy: {
      offers(): PloyOfferSeed[] {
        return [{}]
      },
      apply(ctx, seat, ploy) {
        addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
      },
    },
  })
}
flagPloy('haMercilessSadists')
flagPloy('haFromDarkness')
flagPloy('haDenizens')

registerCodeHook({
  name: 'haCruelDeception',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isHa(state, op) || info.counteracting) return []
      if (state.effects.some((e) => e.source === ID.cruel && e.operativeId === op.id)) return []
      return [{}]
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'activation' })
    },
  },
})

registerCodeHook({
  name: 'haDeviousScheme',
  ploy: {
    // offered to the seat that did not use the ploy; param carries the ploy to tax
    offers(state, seat, ploy, info): PloyOfferSeed[] {
      const usedBy = info.usedBy as Seat | undefined
      const ployId = info.ployId as string | undefined
      if (!usedBy || !ployId || usedBy === seat) return []
      if (state.data.ploys?.[ployId]?.type !== 'firefight') return []
      // a ploy that cost the opponent nothing (made free by a rule) cannot be taxed
      if ((state.ledger[usedBy].uses[`ha.paid:${ployId}`] ?? 0) <= 0) return []
      if (state.effects.some((e) => e.source === ploy.id && e.seat === seat)) return []
      return [{ param: ployId }]
    },
    apply(ctx, seat, ploy, seed) {
      if (!seed.param) return
      addEffect(ctx, { source: ploy.id, seat, kind: 'ha.deviousScheme', expires: 'ha.scheme', data: { ployId: seed.param, victim: otherSeat(seat) } })
    },
  },
})

registerCodeHook({
  name: 'haHeinousArrogance',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat) {
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ID.arrogance }, seat)
      skipActivation(ctx, seat)
    },
  },
})

registerCodeHook({
  name: 'haPreyOnTheWounded',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const foe = info.targetId && info.attackerId === info.subjectId ? state.operatives[info.targetId] : undefined
      if (!live(op) || op.seat !== seat || !isHa(state, op) || !foe || foe.seat === seat || foe.wounds >= foe.maxWounds) return []
      const side = sideOfOp(state, op.id)
      if (!side || side.noRerolls || eligibleDice(side).length === 0) return []
      return [{}]
    },
    apply(ctx, _seat, ploy, _seed, info) {
      const side = info.subjectId ? sideOfOp(ctx.state, info.subjectId) : null
      if (side) side.grants.push({ id: 'ha.prey', source: ploy.id, mode: 'any', used: false })
    },
  },
})

// Devious Scheme's surcharge: the opponent's next use of the taxed ploy costs 1 more (after every reduction)
function schemeFor(state: GameState, seat: Seat, ployId: string) {
  return state.effects.find((e) => e.kind === 'ha.deviousScheme' && e.data?.victim === seat && e.data?.ployId === ployId)
}

// ---------------------------------------------------------------------------
// Free offers (0 CP): invigorations, Torturous Vision, Flay, Omen, Brutal Display, Toxin Coating, Refined Poison,
// the From Darkness, Death pick
// ---------------------------------------------------------------------------

type Info = { subjectId?: string; attackerId?: string; targetId?: string; counteracting?: boolean; [k: string]: unknown }

const free = (id: string, name: string, op: Operative | undefined, via: string, param?: string): PloyOffer => ({
  id,
  ployId: id.split(':')[0]!,
  name,
  ...(param ? { param } : {}),
  ...(op ? { operativeId: op.id } : {}),
  cost: 0,
  via,
  seed: param ? { param } : {},
})

function invigorationFree(state: GameState, seat: Seat): boolean {
  const base = baseActivation(state)
  return !!base && !usedKey(base, K.invigoration(seat))
}

function activationOffers(state: GameState, seat: Seat, info: Info, window: string): PloyOffer[] {
  const op = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!live(op) || op.seat !== seat || !isHa(state, op)) return []
  const out: PloyOffer[] = []
  const base = baseActivation(state)
  if (!base) return out
  if (painOf(state, op.id) > 0 && invigorationFree(state, seat)) {
    // Dark Animus: during the operative's own activation, before or after an action
    if (!info.counteracting && base.operativeId === op.id && !base.counteract && !animusEffect(state, op.id) && !op.flags.ignoreApl && op.aplMods < 1) {
      out.push(free('ha.inv.animus', `Dark Animus: ${op.name} (spend 1 Pain, +1 APL)`, op, 'ha.inv.animus'))
    }
    if (op.wounds < op.maxWounds) out.push(free('ha.inv.rejuvenation', `Accelerated Rejuvenation: ${op.name} (spend 1 Pain, regain D3+1 wounds)`, op, 'ha.inv.rejuvenation'))
  }
  // From Darkness, Death: pick an enemy the operative could not be targeted by, as it is activated (only then: not
  // after one of its actions)
  if (window === 'firefight.activationStart' && info.counteracting !== true && ployActive(state, seat, ID.fromDarkness) && ownActivation(state, op) && !usedKey(base, 'ha.fdd:picked')) {
    const prev = (base.used ?? []).find((k) => k.startsWith('ha.prevOrder:'))?.slice('ha.prevOrder:'.length)
    const was = prev === 'engage' || prev === 'conceal' ? prev : op.order
    for (const e of enemiesOf(state, op).filter((x) => live(x)).sort(byId)) {
      if (!canBeTargetedBy(state, e, { ...op, order: was })) {
        out.push(free(`ha.fdd:${e.id}`, `From Darkness, Death: ${e.name}`, op, 'ha.fdd', e.id))
      }
    }
  }
  return out
}

function killedOffers(state: GameState, seat: Seat, info: Info): PloyOffer[] {
  const killer = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!live(killer) || killer.seat !== seat || !isHa(state, killer)) return []
  const out: PloyOffer[] = []
  const base = baseActivation(state)
  // Vitalised Surge: a free Dash (2" at most while counteracting) after the kill
  if (base && painOf(state, killer.id) > 0 && invigorationFree(state, seat)) {
    const counteracting = base.operativeId === killer.id && base.counteract
    if (canStartFreeAction(state, { operativeId: killer.id, action: 'dash', ...(counteracting ? { maxMove: 2 } : {}), resume: '' })) {
      out.push(free('ha.inv.surge', `Vitalised Surge: ${killer.name} (spend 1 Pain, free Dash${counteracting ? ' of 2"' : ''})`, killer, 'ha.inv.surge'))
    }
  }
  // Brutal Display: another enemy near the Duellist or the fallen enemy is cowed until the next turning point
  const removed = typeof info.removedId === 'string' ? state.operatives[info.removedId] : undefined
  if (removed && hasAbility(state, killer, ID.brutalDisplay) && !usedThisTp(state, seat, K.brutalDisplay) && inControlRange(state, bodyOf(killer), bodyOf(removed))) {
    for (const e of enemiesOf(state, killer).filter((x) => live(x) && x.id !== removed.id).sort(byId)) {
      const nearDuellist = within(killer, e, 6) && visible(state, bodyOf(killer), bodyOf(e))
      const nearFallen = within(removed, e, 6) && visible(state, bodyOf(removed), bodyOf(e))
      if (nearDuellist || nearFallen) out.push(free(`ha.bd:${e.id}`, `Brutal Display: ${e.name} cannot hold markers`, killer, 'ha.bd', e.id))
    }
  }
  return out
}

function shootOffers(state: GameState, seat: Seat, info: Info): PloyOffer[] {
  const a = state.attack
  const op = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!a || a.kind !== 'shoot' || !live(op) || op.seat !== seat || !isHa(state, op) || info.attackerId !== op.id || a.index !== 0) return []
  const out: PloyOffer[] = []
  const own = ownActivation(state, op)
  if (own && hasAbility(state, op, ID.torturous) && painOf(state, op.id) === 0 && !usedKey(own, 'ha.tv')) {
    out.push(free('ha.tv', `Torturous Vision: ${op.name} gains a Pain token`, op, 'ha.tv'))
  }
  if (a.weaponId && REFINED_WEAPONS.includes(a.weaponId) && equipped(state, seat, ID.refined) && tpCount(state, seat, ID.refined) < 2 && !state.effects.some((e) => e.source === ID.refined && e.operativeId === op.id)) {
    out.push(free(ID.refined, `Refined Poison: ${state.data.weapons[a.weaponId]?.name ?? 'weapon'} +1 Normal Dmg (${2 - tpCount(state, seat, ID.refined)} left this turning point)`, op, 'ha.refined'))
  }
  return out
}

function fightWeaponOffers(state: GameState, seat: Seat, info: Info): PloyOffer[] {
  const a = state.attack
  const op = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!a || a.kind !== 'fight' || !a.fight || !live(op) || op.seat !== seat || !isHa(state, op)) return []
  const out: PloyOffer[] = []
  const attacking = a.operativeId === op.id
  const own = ownActivation(state, op)
  if (attacking && own && hasAbility(state, op, ID.torturous) && painOf(state, op.id) === 0 && !usedKey(own, 'ha.tv')) {
    out.push(free('ha.tv', `Torturous Vision: ${op.name} gains a Pain token`, op, 'ha.tv'))
  }
  const weaponId = attacking ? a.fight.weaponA : a.fight.weaponD
  const foeId = attacking ? a.fight.targetId : a.operativeId
  if (weaponId && equipped(state, seat, ID.toxin) && tpCount(state, seat, ID.toxin) < 2 && !state.effects.some((e) => e.source === ID.toxin && e.operativeId === op.id)) {
    const lethal = ruleSetFor(state, op, weaponId, 'fight', foeId).lethal
    if (state.data.weapons[weaponId]?.type === 'melee' && (lethal === null || lethal > 5)) {
      out.push(free(ID.toxin, `Toxin Coating: ${state.data.weapons[weaponId]!.name} gains Lethal 5+ (${2 - tpCount(state, seat, ID.toxin)} left this turning point)`, op, 'ha.toxin'))
    }
  }
  return out
}

function flayOffers(state: GameState, seat: Seat, info: Info): PloyOffer[] {
  const seq = state.attack?.seq
  const flayer = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!seq || !flayer || flayer.seat !== seat || seq.choices[`ha.flay:${flayer.id}`] === undefined) return []
  return haOps(state, seat)
    .filter((f) => f.id === flayer.id || within(flayer, f, 6))
    .map((f) => free(`ha.flay:${f.id}`, `Flay: ${f.name} gains a Pain token`, flayer, 'ha.flay', f.id))
}

function sensesOffers(state: GameState, seat: Seat, info: Info): PloyOffer[] {
  const op = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!live(op) || op.seat !== seat || !isHa(state, op) || painOf(state, op.id) === 0) return []
  const base = baseActivation(state)
  if (!base || usedKey(base, K.senses(seat))) return []
  const side = sideOfOp(state, op.id)
  if (!side || side.noRerolls) return []
  if (!eligibleDice(side).some((i) => side.dice[i]!.kind !== 'crit')) return []
  return [free('ha.inv.senses', `Stimulated Senses: ${op.name} (spend 1 Pain, re-roll one result)`, op, 'ha.inv.senses')]
}

function omenOffers(state: GameState, seat: Seat): PloyOffer[] {
  if (state.turningPoint !== 1 || usedThisBattle(state, seat, K.omenPicked)) return []
  const hunter = haOps(state, seat).find((o) => hasAbility(state, o, ID.omen))
  if (!hunter) return []
  return activeOps(state)
    .filter((o) => o.id !== hunter.id && live(o) && (o.seat !== seat || isHa(state, o)))
    .sort(byId)
    .map((t) => free(`ha.omen:${t.id}`, `Omen: ${t.name} (${t.seat === seat ? 'friend, you may re-roll its 1s' : 'enemy, it must re-roll its 6s'})`, hunter, 'ha.omen', t.id))
}

const HA_RULE: PloyRule = {
  extraOffers(state, seat, window, info) {
    if (state.players[seat].teamId !== TEAM_ID) return []
    const i = info as Info
    switch (window) {
      case 'firefight.start':
        return omenOffers(state, seat)
      case 'firefight.activationStart':
      case 'firefight.actionEnded':
        return activationOffers(state, seat, i, window)
      case 'operative.killed':
        return killedOffers(state, seat, i)
      case 'shoot.targetSelected':
        return shootOffers(state, seat, i)
      case 'fight.weaponsSelected':
        return fightWeaponOffers(state, seat, i)
      case 'fight.resolved':
        return flayOffers(state, seat, i)
      case 'shoot.beforeAttackRerolls':
      case 'shoot.defenderBeforeRerolls':
      case 'fight.beforeRerolls':
        return sensesOffers(state, seat, i)
      default:
        return []
    }
  },
  costSurcharge(state, seat, ploy) {
    return schemeFor(state, seat, ploy.id) ? 1 : 0
  },
  onUsed(ctx, seat, offer) {
    const s = ctx.state
    // what the opponent actually paid, for Devious Scheme (a ploy made free by a rule cannot be taxed)
    if (hotaSeatPresent(s)) s.ledger[seat].uses[`ha.paid:${offer.ployId}`] = offer.cost
    // the taxed ploy was used: Devious Scheme's effect ends
    const scheme = schemeFor(s, seat, offer.ployId)
    if (scheme) {
      removeEffects(ctx, (e) => e.id === scheme.id)
      markFired('haDeviousScheme')
    }
    const op = offer.operativeId ? s.operatives[offer.operativeId] : undefined
    const base = baseActivation(s)
    switch (offer.via) {
      case 'ha.inv.animus':
        if (!op || !base) return
        spendPain(ctx, op.id, 'ha.darkAnimus')
        markKey(base, K.invigoration(seat))
        op.aplMods += 1
        addEffect(ctx, { source: 'ha.inv.animus', seat, kind: 'ha.darkAnimus', operativeId: op.id, expires: ANIMUS_EXPIRY })
        ctx.emit({ type: 'AplModified', operativeId: op.id, delta: 1, reason: 'ha.darkAnimus' }, seat)
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'ha.inv.animus' }, seat)
        markFired('haDarkAnimus')
        return
      case 'ha.inv.rejuvenation': {
        if (!op || !base) return
        spendPain(ctx, op.id, 'ha.accelerated')
        markKey(base, K.invigoration(seat))
        regainWounds(ctx, op.id, d3(ctx, 'ha.rejuvenation') + 1, 'ha.inv.rejuvenation')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'ha.inv.rejuvenation' }, seat)
        markFired('haRejuvenation')
        return
      }
      case 'ha.inv.surge':
        if (!op || !base) return
        spendPain(ctx, op.id, 'ha.vitalisedSurge')
        markKey(base, K.invigoration(seat))
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'ha.inv.surge' }, seat)
        markFired('haVitalisedSurge')
        startFreeAction(ctx, { operativeId: op.id, action: 'dash', ...(base.operativeId === op.id && base.counteract ? { maxMove: 2 } : {}), resume: 'ploy.freeAction' })
        return
      case 'ha.inv.senses': {
        if (!op || !base) return
        const side = sideOfOp(s, op.id)
        if (!side) return
        spendPain(ctx, op.id, 'ha.stimulatedSenses')
        markKey(base, K.senses(seat))
        side.grants.push({ id: 'ha.ss', source: 'ha.inv.senses', mode: 'result', used: false })
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'ha.inv.senses' }, seat)
        markFired('haStimulatedSenses')
        return
      }
      case 'ha.tv': {
        const own = op ? ownActivation(s, op) : null
        if (!op || !own) return
        markKey(own, 'ha.tv')
        gainPain(ctx, op.id, 1, 'ha.torturousVision')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.torturous }, seat)
        markFired('haTorturousVision')
        return
      }
      case 'ha.flay': {
        const seq = s.attack?.seq
        if (!seq || !op || !offer.param) return
        delete seq.choices[`ha.flay:${op.id}`]
        gainPain(ctx, offer.param, 1, 'ha.flay')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'ha.a.wr-flay', detail: offer.param }, seat)
        markFired('haFlay')
        return
      }
      case 'ha.omen': {
        if (!op || !offer.param) return
        markUsedBattle(s, seat, K.omenPicked)
        addToken(ctx, offer.param, { kind: OMEN, owner: seat, sourceId: op.id }, 'ha.omen')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.omen, detail: offer.param }, seat)
        return
      }
      case 'ha.bd': {
        if (!op || !offer.param) return
        markUsedTp(s, seat, K.brutalDisplay)
        addToken(ctx, offer.param, { kind: BRUTAL, owner: seat, sourceId: op.id, expires: ['turningPointEnd'], cap: 1 }, 'ha.brutalDisplay')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.brutalDisplay, detail: offer.param }, seat)
        markFired('haBrutalDisplay')
        return
      }
      case 'ha.toxin': {
        const a = s.attack
        if (!op || !a?.fight) return
        const weaponId = a.operativeId === op.id ? a.fight.weaponA : a.fight.weaponD
        addTpCount(s, seat, ID.toxin)
        addEffect(ctx, { source: ID.toxin, seat, kind: 'equipment', operativeId: op.id, expires: 'action', data: { weaponId } })
        return
      }
      case 'ha.refined': {
        const a = s.attack
        if (!op || !a?.weaponId) return
        addTpCount(s, seat, ID.refined)
        addEffect(ctx, { source: ID.refined, seat, kind: 'equipment', operativeId: op.id, expires: 'action', data: { weaponId: a.weaponId } })
        return
      }
      case 'ha.fdd': {
        if (!op || !offer.param || !base) return
        markKey(base, 'ha.fdd:picked')
        addEffect(ctx, { source: ID.fromDarkness, seat, kind: 'ha.fdd', operativeId: op.id, expires: 'activation', data: { enemyId: offer.param } })
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.fromDarkness, detail: offer.param }, seat)
        return
      }
      default:
        return
    }
  },
}

registerPloyRule(HA_RULE)

export { HA_RULE as hotaPloyRule }
