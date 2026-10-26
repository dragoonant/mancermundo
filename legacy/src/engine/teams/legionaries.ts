// Legionaries (docs/spec/13-teams.md section 7, rule ids T-LG.n): the code hooks this team's data names, its team
// rule provider (team-rules.ts), its hook handlers (hooks.ts) and its ploy rules (ploy-rules.ts).
//
// Map of the rules to the code below:
//  - Marks of Chaos (T-LG.5, 20-26): a real keyword per operative (operative-picks.ts, read by hasKeyword). KHORNE and
//    TZEENTCH are declarative (grantWeaponRule in the data); SLAANESH is the provider moveDelta; NURGLE is the
//    onDamageInflicted handler; UNDIVIDED is a modifyWeaponRules clause.
//  - ASTARTES (T-LG.27): provider maxRepeats / counteract and the beforeShootTargetSelect bolt check.
//  - Daemonic Aura (T-LG.9): the action.declared hook cancels and bars a declared Fall Back.
//  - Devastating Onslaught (T-LG.13, 14): modifyAttackDice (no assists) and the provider `reactions` at the end of an
//    enemy activation or counteraction, answered by the free-Charge choice hook.
//  - Unleash Daemon, Infernal Pact, Siphon Life, Horrifying Dismemberment, Tainted Rounds, Chaos Talismans (use):
//    0 CP pseudo ploys (registerPloyRule extraOffers / onUsed) in the activation-start, fight and shoot windows.
//  - The ploys: strategy flags read by the hooks, and firefight ploys with their own code hooks.
//  - Warded Armour and Chaos Talismans are strategic gambits: strategy ploy records at 0 CP whose hooks offer them only
//    while the equipment is taken.
import { applyAplEffect, effectiveRules, hasRule, ruleKey } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { codeParams, hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, directDamage, gainCp, markUsedBattle, markUsedTp, regainWounds, usedThisBattle, usedThisTp } from '../effects'
import { extraStrike } from '../fight'
import { finishAction, reactionDone, startFreeAction } from '../firefight'
import { refreshFlags } from '../abilities'
import { registerFrameResume, registerHook, type ActionDeclaredData, type DamageInflictedData } from '../hooks'
import { bodyOf, visible } from '../los'
import { dropCarried, newMarkerId } from '../markers'
import { distanceBetween, gapToMarker, inControlRange } from '../measure'
import { pickAlternatives, setOperativePick } from '../operative-picks'
import { registerPloyRule, type PloyOffer } from '../ploy-rules'
import { markerControl } from '../query'
import type { Ctx } from '../registry'
import { placementSpots } from '../reserve'
import { activeOps, enemiesOf, hasInjuredPenalty, otherSeat, SEATS } from '../state'
import { providerAny, registerTeamRules, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, removeTokensWhere } from '../tokens'
import type { AttackDie, GameState, Marker, Operative, Seat, WeaponRuleRef } from '../types'
import { canChargeInto } from './wyrmblade'

export const TEAM_ID = 'legionaries'

const LG = 'LEGIONARY'
const EPS = 1e-6
/** The operative choice id of the Marks of Chaos (team.json operativeChoices). */
export const MARK = 'mark'

const A = (id: string) => `lg.a.${id}`
const P = (id: string) => `lg.p.${id}`
const E = (id: string) => `lg.e.${id}`

const EYES = A('in-the-eyes-of-the-gods')
const AURA = A('daemonic-aura')
const GORGE = A('soul-gorge')
const UNLEASH = A('unleash-daemon')
const ONSLAUGHT = A('devastating-onslaught')
const ICON = A('icon-bearer')
const FAVOURED = A('favoured-of-the-dark-gods')
const REFLEXES = A('vicious-reflexes')
const DISMEMBER = A('horrifying-dismemberment')
const GRISLY_ACTION = A('grisly-mark')
const PACT = A('infernal-pact')
const SIPHON = A('wr-siphon-life')

const BFTBG = P('blood-for-the-blood-god')
const IMPLACABLE = P('implacable')
const QUICKSILVER = P('quicksilver-speed')
const FICKLE = P('fickle-fates')
const UNENDING = P('unending-bloodshed')
const MUTABILITY = P('mutability-and-change')
const MALIGNANT = P('malignant-aura')
const SICKENING = P('sickening-captivation')
const WARDED_PLOY = P('warded-armour')
const TALISMANS_PLOY = P('chaos-talismans')

const TAINTED_ROUNDS = E('tainted-rounds')
const WARDED_EQ = E('warded-armour')
const TALISMANS_EQ = E('chaos-talismans')
/** The pseudo ploy id of the Talismans' 0 CP use (the equipment's own id, so the prompt finds its text). */
const TALISMAN_USE = TALISMANS_EQ

const GRISLY = 'lg.grisly'
const UNLEASH_TOKEN = 'lg.unleash'
const WARDED_TOKEN = 'lg.warded'
const UNLEASH_USED = 'lg.unleash.used'
const GRISLY_USED = 'lg.grisly.used'
const PACT_USED = 'lg.pact'
const SIPHON_TP = 'lg.siphon.tp'
const TAINTED_KEY = 'lg.taintedRounds'

const MARKS = ['KHORNE', 'NURGLE', 'SLAANESH', 'TZEENTCH', 'UNDIVIDED']

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game.
for (const name of [
  'lgAstartes',
  'disgustingVigour',
  'unnaturalAgility',
  'viciousReavers',
  'inTheEyesOfTheGods',
  'daemonicAura',
  'soulGorge',
  'unleashDaemon',
  'siphonLife',
  'lgIconBearer',
  'favouredOfTheDarkGods',
  'viciousReflexes',
  'horrifyingDismemberment',
  'infernalPact',
  'taintedRounds',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isLg(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, LG)
}

function live(o: Operative): boolean {
  return o.status === 'active' && o.wounds > 0
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function opEffect(state: GameState, source: string, opId: string) {
  return state.effects.find((e) => e.source === source && e.operativeId === opId)
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

function unleashed(state: GameState, op: Operative): boolean {
  return hasToken(state, op.id, UNLEASH_TOKEN)
}

function isRanged(state: GameState, weaponId: string): boolean {
  return state.data.weapons[weaponId]?.type === 'ranged'
}

/** "Bolt weapon" for ASTARTES (T-LG.6): bolt pistol, boltgun or tainted bolt pistol. */
export function isBolt(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  if (!w || w.type !== 'ranged') return false
  const n = w.name.toLowerCase()
  return n === 'bolt pistol' || n === 'boltgun' || n === 'tainted bolt pistol'
}

/** TAINTED ROUNDS names only the bolt pistol and the boltgun (T-LG.6). */
export function isPlainBolt(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  if (!w || w.type !== 'ranged') return false
  const n = w.name.toLowerCase()
  return n === 'bolt pistol' || n === 'boltgun'
}

function sideOf(state: GameState, opId: string) {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

function liveFails(dice: AttackDie[]): AttackDie[] {
  return dice.filter((d) => d.kind === 'fail' && d.value !== null && !d.used && !d.tag)
}

function lgsOf(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isLg(state, o))
}

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState) {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

function mark(op: Operative): string | undefined {
  return op.picks?.[MARK]
}

/** Grisly markers of the other seat that cover `op` (within 3" of the marker). */
function grislyNear(state: GameState, op: Operative): boolean {
  for (const m of state.markers) {
    if (m.equipmentId !== GRISLY || m.owner === null || m.owner === op.seat) continue
    if (gapToMarker(bodyOf(op), m) <= 3 + EPS) return true
  }
  return false
}

function isMissionAction(state: GameState, actionId: string): boolean {
  const id = actionId.startsWith('ability:') ? actionId.slice('ability:'.length) : actionId
  const def = state.data.abilities[id]
  return !!def && (def.keywords ?? []).includes('MISSION')
}

function setOrder(ctx: Ctx, op: Operative, order: 'engage' | 'conceal'): void {
  if (op.order === order) return
  if (op.flags.guard) {
    op.flags.guard = false
    ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'order' }, op.seat)
  }
  op.order = order
  ctx.emit({ type: 'OrderSet', operativeId: op.id, order })
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  // ASTARTES (T-LG.27) and MUTABILITY AND CHANGE (T-LG.33)
  maxRepeats(state, op, actionId, performed) {
    if (!isLg(state, op)) return null
    // Mutability and Change beats ASTARTES: no action more than once this activation
    if (state.effects.some((e) => e.source === MUTABILITY && e.operativeId === op.id)) return 1
    if (actionId !== 'shoot' && actionId !== 'fight') return null
    const count = (a: string) => performed.filter((p) => p === a).length
    if (actionId === 'shoot') {
      if (count('fight') >= 2) return 1
      if (!op.weapons.some((w) => isBolt(state, w))) return 1
      if (count('shoot') >= 1) markFired('lgAstartes')
      return 2
    }
    if (count('shoot') >= 2) return 1
    if (count('fight') >= 1) markFired('lgAstartes')
    return 2
  },
  counteract(state, op) {
    return isLg(state, op) ? 'any' : null
  },

  // SLAANESH: Unnatural Agility (T-LG.24)
  moveDelta(state, op) {
    if (!isLg(state, op) || !hasKeyword(state, op, 'SLAANESH')) return 0
    const p = codeParams(state, op, 'unnaturalAgility')
    if (!p) return 0
    markFired('unnaturalAgility')
    return Number(p.inches ?? 1)
  },

  // IMPLACABLE: NURGLE Legionaries ignore the injured stat changes (T-LG.29)
  flags(state, op) {
    if (isLg(state, op) && hasKeyword(state, op, 'NURGLE') && ployActive(state, op.seat, IMPLACABLE)) return { ignoreInjured: true }
    return null
  },

  // Icon Bearer (T-LG.15)
  controlApl(state, op, _marker, apl) {
    if (!hasAbility(state, op, ICON)) return null
    markFired('lgIconBearer')
    return apl + 1
  },
  // GRISLY MARK: the contesting total is 1 lower when a contesting enemy stands within 3" of the marker (T-LG.19)
  controlTotal(state, seat, _marker, total, contesting) {
    if (contesting.length === 0 || total <= 0) return null
    const owner = otherSeat(seat)
    const marks = state.markers.filter((m) => m.equipmentId === GRISLY && m.owner === owner)
    if (marks.length === 0) return null
    const near = contesting.some((id) => {
      const o = state.operatives[id]
      return !!o && marks.some((m) => gapToMarker(bodyOf(o), m) <= 3 + EPS)
    })
    return near ? total - 1 : null
  },

  // Unleash Daemon: no Pick Up Marker or mission actions (T-LG.11)
  actionForbidden(state, op, actionId) {
    if (!isLg(state, op) || !unleashed(state, op)) return null
    if (actionId === 'marker:pickUp' || (isMissionAction(state, actionId) && !/hatch/i.test(actionId))) return `${op.name} has unleashed its daemon and cannot take that action`
    return null
  },
  // GRISLY MARK: 1 extra AP for Pick Up Marker and mission actions near the marker (T-LG.19)
  actionCostDelta(state, op, actionId) {
    if (actionId !== 'marker:pickUp' && !isMissionAction(state, actionId)) return 0
    return grislyNear(state, op) ? 1 : 0
  },

  // Vicious Reflexes (T-LG.17)
  fightResolveStart(state, attack) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const ret = state.operatives[attack.fight.targetId]
    if (!ret || !live(ret) || !hasAbility(state, ret, REFLEXES)) return null
    markFired('viciousReflexes')
    return { first: ret.seat }
  },

  // Devastating Onslaught: the Butcher's free Charge at the end of an enemy activation or counteraction (T-LG.14)
  reactions(state, seat, info) {
    if (!info.activationEnded || info.activeSeat === seat) return []
    const out: ReactionOffer[] = []
    for (const b of lgsOf(state, seat)) {
      if (!hasAbility(state, b, ONSLAUGHT) || inEnemyCr(state, b)) continue
      for (const e of enemiesOf(state, b)) {
        if (!live(e) || !within(b, e, 2) || !canChargeInto(state, b, e, 2)) continue
        out.push({
          hook: 'devastatingOnslaught',
          operativeId: b.id,
          option: e.id,
          labelKey: `ability.${ONSLAUGHT}`,
          data: { name: `Devastating Onslaught: ${b.name} charges ${e.name}`, targetId: e.id },
        })
      }
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Devastating Onslaught: the reaction's choice, and the passive no-assist rule
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'devastatingOnslaught',
  choice(ctx, op, option) {
    const s = ctx.state
    const foe = s.operatives[option]
    if (!foe || !live(foe) || !live(op)) {
      reactionDone(ctx)
      return
    }
    const previous = op.order
    // RULING: a Conceal Butcher always switches to Engage to take the Charge
    if (op.order === 'conceal') setOrder(ctx, op, 'engage')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ONSLAUGHT, detail: foe.id }, op.seat)
    const started = startFreeAction(ctx, { operativeId: op.id, action: 'charge', maxMove: 2, endWithinCrOf: foe.id, resume: 'lg.onslaught', data: { opId: op.id, previous } })
    if (!started) {
      if (op.order !== previous) setOrder(ctx, op, previous)
      reactionDone(ctx)
    }
  },
})

registerFrameResume('lg.onslaught', (ctx, outcome, data) => {
  if (outcome === 'cancelled') {
    const op = ctx.state.operatives[String(data.opId)]
    if (op && op.order !== data.previous) setOrder(ctx, op, data.previous as 'engage' | 'conceal')
  }
  reactionDone(ctx)
})

// ---------------------------------------------------------------------------
// Daemonic Aura (action.declared) and Quicksilver Speed's movement record
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    const d = c.data as unknown as ActionDeclaredData
    // Quicksilver Speed: remember where the action began, so action.ended can tell whether the operative moved
    if (isLg(s, op) && ployActive(s, op.seat, QUICKSILVER)) {
      const decl = s.firefight.activation?.declared
      if (decl) decl.params = { ...(decl.params ?? {}), lgFrom: { x: op.pos.x, z: op.pos.z } }
    }
    if (d.action !== 'fallBack' || d.cancel) return null
    const chosen = activeOps(s).filter((o) => o.seat !== op.seat && live(o) && hasAbility(s, o, AURA) && inControlRange(s, bodyOf(o), bodyOf(op)))
    for (const ch of chosen) {
      // RULING: always used when it can be, free Fall Backs included
      const need = Number(codeParams(s, ch, 'daemonicAura')?.rollOn ?? 3)
      const [r] = ctx.roll('lg.aura', 1)
      markFired('daemonicAura')
      ctx.emit({ type: 'AbilityUsed', operativeId: ch.id, abilityId: AURA, detail: op.id }, ch.seat)
      if (r! >= need) {
        d.cancel = true
        d.bar = true
        d.reason = 'Daemonic Aura'
        break
      }
    }
    return null
  },
  'lg.action.declared',
)

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isLg(s, op) || !ployActive(s, op.seat, QUICKSILVER)) return null
    const from = s.firefight.activation?.declared?.params?.lgFrom as { x: number; z: number } | undefined
    if (!from || Math.hypot(op.pos.x - from.x, op.pos.z - from.z) <= EPS) return null
    // RULING: any action that changed the operative's position counts as moving
    if (!opEffect(s, 'lg.qs.moved', op.id)) addEffect(ctx, { source: 'lg.qs.moved', seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'turningPoint' })
    return null
  },
  'lg.action.ended',
)

function movedThisTp(state: GameState, op: Operative): boolean {
  return !!opEffect(state, 'lg.qs.moved', op.id)
}

// ---------------------------------------------------------------------------
// Weapon rules: Vicious Reavers, Unleash claw, Tainted Rounds, Malignant Aura, Fickle Fates, Implacable
// ---------------------------------------------------------------------------

function ruleIndex(rules: WeaponRuleRef[], key: string): number {
  return rules.findIndex((r) => ruleKey(r.rule) === key)
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const lg = isLg(s, op)
    if (lg) {
      // UNDIVIDED: Ceaseless against an enemy within 6" (T-LG.26)
      const vr = hasKeyword(s, op, 'UNDIVIDED') ? codeParams(s, op, 'viciousReavers') : null
      if (vr && target && target.seat !== op.seat && within(op, target, Number(vr.inches ?? 6)) && ruleIndex(rules, 'ceaseless') < 0) {
        rules.push({ rule: 'ceaseless' })
        markFired('viciousReavers')
      }
      // Unleash Daemon: the claw gains Ceaseless and Lethal 5+ (T-LG.11)
      if (unleashed(s, op) && s.data.weapons[c.weaponId]?.name === 'Daemonic claw') {
        if (ruleIndex(rules, 'ceaseless') < 0) rules.push({ rule: 'ceaseless' })
        if (ruleIndex(rules, 'lethal') < 0) rules.push({ rule: 'lethal', target: 5 })
        markFired('unleashDaemon')
      }
      // TAINTED ROUNDS: Rending on the weapon selected until the action ends (T-LG.37)
      if (data.kind === 'shoot') {
        const fx = opEffect(s, TAINTED_ROUNDS, op.id)
        if (fx && fx.data?.weaponId === c.weaponId && ruleIndex(rules, 'rending') < 0) rules.push({ rule: 'rending' })
      }
      // MALIGNANT AURA: Piercing 1 against enemies within 3" (T-LG.34)
      if (data.kind === 'shoot' && target && target.seat !== op.seat && opEffect(s, MALIGNANT, op.id) && within(op, target, 3)) {
        if (!rules.some((r) => ruleKey(r.rule) === 'piercing' && !r.crits)) rules.push({ rule: 'piercing', x: 1 })
      }
      // FICKLE FATES: Balanced against a ready enemy, Relentless if the weapon already has Balanced (T-LG.31)
      if (data.kind === 'shoot' && target && target.seat !== op.seat && target.ready && ployActive(s, op.seat, FICKLE)) {
        if (ruleIndex(rules, 'balanced') >= 0) {
          if (ruleIndex(rules, 'relentless') < 0) rules.push({ rule: 'relentless' })
        } else rules.push({ rule: 'balanced' })
      }
    }
    // IMPLACABLE: Piercing 1 becomes Piercing Crits 1 against a friendly Legionary (T-LG.29), after the other changes
    if (data.kind === 'shoot' && target && isLg(s, target) && target.seat !== op.seat && ployActive(s, target.seat, IMPLACABLE)) {
      for (const r of rules) if (ruleKey(r.rule) === 'piercing' && !r.crits && (r.x ?? 1) === 1) r.crits = true
    }
    return null
  },
  'lg.modifyWeaponRules',
)

// ---------------------------------------------------------------------------
// Attack dice: Devastating Onslaught (no assists), Quicksilver Speed
// ---------------------------------------------------------------------------

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const foe = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !op || !foe || foe.seat === op.seat) return null
    const data = c.data as { kind: 'shoot' | 'fight'; hitDelta: number; assists: string[] }
    // the Butcher's enemies cannot assist against it, fighting or retaliating (T-LG.13)
    if (data.kind === 'fight' && hasAbility(s, foe, ONSLAUGHT) && data.assists.length > 0) {
      data.assists = []
      markFired('devastatingOnslaught')
    }
    // QUICKSILVER SPEED (T-LG.30): never on top of the attacker being injured
    if (isLg(s, foe) && ployActive(s, foe.seat, QUICKSILVER) && movedThisTp(s, foe)) {
      const injured = hasInjuredPenalty(op) || providerAny(s, op, 'injuredEquivalent')
      if (!injured && (data.kind === 'fight' || (hasKeyword(s, foe, 'SLAANESH') && gap(op, foe) > 6 + EPS))) data.hitDelta += 1
    }
    return null
  },
  'lg.modifyAttackDice',
)

// ---------------------------------------------------------------------------
// Damage: BLOOD FOR THE BLOOD GOD
// ---------------------------------------------------------------------------

registerHook(
  'modifyDamage',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isLg(s, op) || !ployActive(s, op.seat, BFTBG) || !hasKeyword(s, op, 'KHORNE')) return null
    const data = c.data as { weaponId: string; dmg: { normal: number; crit: number } }
    if (s.data.weapons[data.weaponId]?.type !== 'melee') return null
    // +1 to both Dmg values, 7 at most (never lowers a value already above 7)
    data.dmg.normal = Math.max(data.dmg.normal, Math.min(7, data.dmg.normal + 1))
    data.dmg.crit = Math.max(data.dmg.crit, Math.min(7, data.dmg.crit + 1))
    return null
  },
  'lg.modifyDamage',
)

registerHook(
  'beforeStrike',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const a = s?.attack
    if (!s || !ctx || !op || !a || a.kind !== 'fight' || a.operativeId !== op.id) return null
    // RULING: only the operative performing the Fight (the attacker) gets the strike bonus, not a retaliator
    if (!isLg(s, op) || hasKeyword(s, op, 'KHORNE') || !ployActive(s, op.seat, BFTBG) || opEffect(s, 'lg.bftbg.spent', op.id)) return null
    const data = c.data as { amount: number }
    data.amount = Math.max(data.amount, Math.min(7, data.amount + 1))
    addEffect(ctx, { source: 'lg.bftbg.spent', seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'action' })
    return null
  },
  'lg.beforeStrike',
)

// ---------------------------------------------------------------------------
// Damage taken: Unleash Daemon and Disgusting Vigour
// ---------------------------------------------------------------------------

const DICE_SOURCES = ['normal', 'crit', 'strike-normal', 'strike-crit']

registerHook(
  'onDamageInflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isLg(s, op)) return null
    const d = c.data as { source: string; amount: number }
    if (!DICE_SOURCES.includes(d.source) || d.amount <= 0) return null
    // Unleash Daemon: a die of Normal or Critical Dmg 4+ does 1 less; Devastating and direct damage are left alone (T-LG.11)
    let reduced = false
    if (unleashed(s, op) && d.amount >= 4) {
      d.amount -= 1
      reduced = true
      markFired('unleashDaemon')
    }
    // Disgusting Vigour: Normal Dmg 3+, a D6 on 5+ takes 1 off; never on top of Unleash Daemon's reduction (T-LG.23)
    const dv = codeParams(s, op, 'disgustingVigour')
    if (dv && !reduced && (d.source === 'normal' || d.source === 'strike-normal') && d.amount >= Number(dv.threshold ?? 3)) {
      markFired('disgustingVigour')
      const [r] = ctx.roll('lg.vigour', 1)
      if (r! >= Number(dv.rollOn ?? 5)) d.amount -= Number(dv.reduceBy ?? 1)
    }
    return null
  },
  'lg.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// Damage dealt: In the Eyes of the Gods, Soul Gorge's crit record, Siphon Life
// ---------------------------------------------------------------------------

registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !victim) return null
    const d = c.data as unknown as DamageInflictedData
    const attacker = s.operatives[d.attackerId]
    if (!attacker || attacker.id === victim.id || attacker.seat === victim.seat || !isLg(s, attacker)) return null
    // In the Eyes of the Gods: the first enemy incapacitated in the Champion's own activation (T-LG.8)
    if (d.woundsBefore > 0 && d.woundsAfter <= 0 && d.source !== 'hot' && hasAbility(s, attacker, EYES) && attacker.status === 'active') {
      const base = baseActivation(s)
      if (base && base.operativeId === attacker.id && !base.counteract && !(base.used ?? []).includes(EYES)) {
        base.used = [...(base.used ?? []), EYES]
        markFired('inTheEyesOfTheGods')
        applyAplEffect(ctx, attacker.id, 1, EYES)
      }
    }
    if (d.amount <= 0 || !DICE_SOURCES.includes(d.source)) return null
    // Soul Gorge: remember a crit strike that did damage (T-LG.10)
    if (d.source === 'strike-crit' && hasAbility(s, attacker, GORGE) && !opEffect(s, GORGE, attacker.id)) {
      addEffect(ctx, { source: GORGE, seat: attacker.seat, kind: 'ployFlag', operativeId: attacker.id, expires: 'action' })
    }
    // Siphon Life: every die that hurt heals the named friend (T-LG.12)
    const fx = opEffect(s, SIPHON, attacker.id)
    if (fx && typeof fx.data?.healId === 'string') {
      const crit = d.source === 'crit' || d.source === 'strike-crit'
      regainWounds(ctx, fx.data.healId, crit ? d3(ctx, 'lg.siphon') : 1, SIPHON)
    }
    return null
  },
  'lg.damage.inflicted',
)

registerHook(
  'onFightResolved',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s) return null
    const d = c.data as { attackerId: string; defenderId: string; attackerIncapacitated: boolean; defenderIncapacitated: boolean }
    const sides: [string, string, boolean, boolean][] = [
      [d.attackerId, d.defenderId, d.attackerIncapacitated, d.defenderIncapacitated],
      [d.defenderId, d.attackerId, d.defenderIncapacitated, d.attackerIncapacitated],
    ]
    for (const [id, foeId, gone, foeGone] of sides) {
      const op = s.operatives[id]
      const foe = s.operatives[foeId]
      if (!op || !foe || gone || !live(op) || !hasAbility(s, op, GORGE) || foe.seat === op.seat) continue
      // RULING: the errata's "or inflicted Critical Dmg" clause applies
      if (!foeGone && !opEffect(s, GORGE, op.id)) continue
      markFired('soulGorge')
      regainWounds(ctx, op.id, d3(ctx, 'lg.gorge') + 1, GORGE)
    }
    return null
  },
  'lg.onFightResolved',
)

// ---------------------------------------------------------------------------
// ASTARTES: the second Shoot needs a bolt weapon in one of the two (T-LG.27)
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    if (!s || !op || data.secondary || !isLg(s, op)) return null
    const act = s.firefight.activation
    if (!act || act.operativeId !== op.id || act.frame || act.counteract) return null
    if (act.performed.filter((a) => a === 'shoot').length < 1) return null
    const prev = [...(act.weaponsUsed ?? [])].filter((w) => isRanged(s, w)).pop()
    if (prev !== undefined && !isBolt(s, prev) && !isBolt(s, data.weaponId)) data.candidates.length = 0
    return null
  },
  'lg.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// FICKLE FATES (defence half): retain a fail as a normal success (T-LG.31)
// ---------------------------------------------------------------------------

registerHook(
  'afterDefenceRoll',
  (c) => {
    const s = c.state
    const defender = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { kind: 'shoot' | 'fight'; dice: AttackDie[] }
    if (!s || !defender || data.kind !== 'shoot' || !isLg(s, defender) || !hasKeyword(s, defender, 'TZEENTCH')) return null
    if (!defender.ready || !ployActive(s, defender.seat, FICKLE)) return null
    if (!data.dice.some((x) => x.kind === 'crit' && !x.used)) return null
    const f = liveFails(data.dice)[0]
    if (!f) return null
    f.value = null
    f.kind = 'normal'
    f.tag = 'lg.fickle'
    return null
  },
  'lg.afterDefenceRoll',
)

// ---------------------------------------------------------------------------
// Turning point start (the Ready step): Warded Armour ends, Favoured of the Dark Gods
// ---------------------------------------------------------------------------

/** Objective markers a tainted ledger key names (kept per seat in the battle ledger). */
const taintedKey = (markerId: string) => `lg.tainted:${markerId}`
export function isTainted(state: GameState, markerId: string): boolean {
  return SEATS.some((seat) => usedThisBattle(state, seat, taintedKey(markerId)))
}

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    const s = ctx.state
    // Warded Armour lasts until the Ready step of the next Strategy phase
    for (const op of Object.values(s.operatives)) {
      const t = op.tokens?.find((x) => x.kind === WARDED_TOKEN)
      if (t) op.save = (t.data?.from as typeof op.save | undefined) ?? op.save
    }
    removeTokensWhere(ctx, (t) => t.kind === WARDED_TOKEN, 'lg.wardedEnds')
    // Favoured of the Dark Gods: taint the objective nearest the Icon Bearer and gain 1 CP (T-LG.16)
    for (const seat of SEATS) {
      for (const op of lgsOf(s, seat)) {
        if (!hasAbility(s, op, FAVOURED)) continue
        const options = s.markers
          .filter((m) => m.kind === 'objective' && !isTainted(s, m.id))
          .filter((m) => {
            const mc = markerControl(s, m)
            return mc.controller === seat && mc.contesting[seat].includes(op.id)
          })
          .sort((x, y) => Math.hypot(x.pos.x - op.pos.x, x.pos.z - op.pos.z) - Math.hypot(y.pos.x - op.pos.x, y.pos.z - op.pos.z))
        const m = options[0]
        if (!m) continue
        markUsedBattle(s, seat, taintedKey(m.id))
        markFired('favouredOfTheDarkGods')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: FAVOURED, detail: m.id }, seat)
        gainCp(ctx, seat, 1, FAVOURED)
      }
    }
    return null
  },
  'lg.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Unique action: GRISLY MARK (T-LG.19)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'grislyMark',
  action: {
    offers(state, op): OfferSeed[] {
      if (op.oncePerBattleUsed.includes(GRISLY_USED)) return []
      // spots within the control range (1") of the base, spread around it; the marker is a 20mm disc
      const ring = op.baseRadius + 0.4
      const spots = placementSpots(state, op, {
        around: { x: op.pos.x, z: op.pos.z },
        radius: ring + 0.6,
        step: 0.5,
        max: 8,
        test: (p) => Math.hypot(p.x - op.pos.x, p.z - op.pos.z) >= ring - EPS,
      })
      return spots.map((p) => ({ key: `${p.x},${p.z}`, params: { param: `${p.x},${p.z}` } }))
    },
    perform(ctx, op, def, params) {
      const [x, z] = String(params.param ?? '').split(',').map(Number)
      if (op.oncePerBattleUsed.includes(GRISLY_USED) || x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) {
        void def
        finishAction(ctx)
        return
      }
      op.oncePerBattleUsed.push(GRISLY_USED)
      const marker: Marker = {
        id: newMarkerId(ctx, 'grisly'),
        kind: 'equipment',
        pos: { x, z },
        owner: op.seat,
        carriedBy: null,
        controller: null,
        equipmentId: GRISLY,
        placedBy: op.id,
      }
      ctx.state.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: marker.pos }, op.seat)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: GRISLY_ACTION }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys that are turning point flags the hooks above read
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'lgFlagPloy',
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
// WARDED ARMOUR and CHAOS TALISMANS: strategic gambits while the equipment is taken (T-LG.36, T-LG.38)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'wardedArmour',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (!equipped(state, seat, WARDED_EQ)) return []
      return lgsOf(state, seat)
        .filter((o) => !hasToken(state, o.id, WARDED_TOKEN))
        .map((o) => ({ param: o.id, operativeId: o.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const op = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!op) return
      const from = op.save
      // a set, not an improvement: the Save is 2+ whatever it was
      op.save = 2
      addToken(ctx, op.id, { kind: WARDED_TOKEN, owner: seat, cap: 1, data: { from } }, 'lg.warded')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: WARDED_EQ }, seat)
    },
  },
})

registerCodeHook({
  name: 'chaosTalismans',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (!equipped(state, seat, TALISMANS_EQ)) return []
      const present = new Set(lgsOf(state, seat).map((o) => mark(o)))
      return MARKS.filter((m) => present.has(m)).map((m) => ({ param: m }))
    },
    apply(ctx, seat, ploy, seed) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint', data: { mark: seed.param } })
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

// UNENDING BLOODSHED (T-LG.32): a KHORNE Legionary incapacitated in a fight strikes once more before it is removed
registerCodeHook({
  name: 'unendingBloodshed',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const a = state.attack
      if (!op || op.seat !== seat || !isLg(state, op) || !hasKeyword(state, op, 'KHORNE') || !a || a.kind !== 'fight') return []
      if (op.status !== 'active' || op.wounds > 0) return []
      const foeId = a.operativeId === op.id ? a.fight?.targetId : a.operativeId
      const foe = foeId ? state.operatives[foeId] : undefined
      const side = sideOf(state, op.id)
      if (!foe || !live(foe) || !side?.weaponId) return []
      const kinds = new Set(side.dice.filter((x) => !x.used && x.kind !== 'fail').map((x) => x.kind))
      return (['crit', 'normal'] as const).filter((k) => kinds.has(k)).map((k) => ({ param: k }))
    },
    apply(ctx, seat, _ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      const side = op ? sideOf(ctx.state, op.id) : null
      if (!op || !side) return
      const i = side.dice.findIndex((x) => !x.used && x.kind === seed.param)
      if (i >= 0) extraStrike(ctx, seat, i)
    },
  },
})

// MUTABILITY AND CHANGE (T-LG.33)
registerCodeHook({
  name: 'mutabilityAndChange',
  ploy: {
    offers(state, seat, ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.counteracting || !isLg(state, op) || !hasKeyword(state, op, 'TZEENTCH')) return []
      if (state.effects.some((e) => e.source === ploy.id && e.operativeId === op.id)) return []
      return [{}]
    },
    apply(ctx, seat, ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation' })
      applyAplEffect(ctx, op.id, 1, ploy.id)
      // a Warrior's mark cannot be changed by Infernal Pact this turning point
      if (hasKeyword(ctx.state, op, 'WARRIOR')) addEffect(ctx, { source: 'lg.noPact', seat, kind: 'ployFlag', operativeId: op.id, expires: 'turningPoint' })
    },
  },
})

// MALIGNANT AURA (T-LG.34)
registerCodeHook({
  name: 'malignantAura',
  ploy: {
    offers(state, seat, ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.attackerId !== op.id || info.kind !== 'shoot' || !isLg(state, op) || !hasKeyword(state, op, 'NURGLE')) return []
      if (opEffect(state, ploy.id, op.id)) return []
      return enemiesOf(state, op).some((e) => live(e) && within(op, e, 3)) ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'action' })
    },
  },
})

// SICKENING CAPTIVATION (T-LG.35)
registerCodeHook({
  name: 'sickeningCaptivation',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const act = state.firefight.activation
      if (!op || op.seat !== seat || info.counteracting || !isLg(state, op) || !hasKeyword(state, op, 'SLAANESH')) return []
      if (!act || act.operativeId !== op.id || act.counteract || act.frame) return []
      return enemiesOf(state, op)
        .filter((e) => live(e) && within(op, e, 4) && visible(state, bodyOf(op), bodyOf(e)))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => ({ param: e.id }))
    },
    apply(ctx, _seat, ploy, seed) {
      if (seed.param) applyAplEffect(ctx, seed.param, -1, ploy.id)
    },
  },
})

// ---------------------------------------------------------------------------
// 0 CP offers: Unleash Daemon, Infernal Pact, Siphon Life, Horrifying Dismemberment, Tainted Rounds, Chaos Talismans
// ---------------------------------------------------------------------------

function offer(id: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id, ployId: id.split(':')[0]!, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

const LG_RULE = {
  extraOffers(state: GameState, seat: Seat, window: string, info: { subjectId?: string; counteracting?: boolean; weaponId?: string; attackFails?: number }): PloyOffer[] {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!subject || subject.seat !== seat || !isLg(state, subject) || !live(subject)) return out
    const a = state.attack
    // ---- at the start of a (non-counteract) activation
    if (window === 'firefight.activationStart' && !info.counteracting) {
      // Unleash Daemon: once per battle (T-LG.11)
      if (hasAbility(state, subject, UNLEASH) && !subject.oncePerBattleUsed.includes(UNLEASH_USED) && !unleashed(state, subject)) {
        out.push(offer(UNLEASH, 'Unleash Daemon', 'lg.unleash', subject))
      }
      // Infernal Pact: once per battle for the team, a different mark (T-LG.20)
      if (hasAbility(state, subject, PACT) && !usedThisBattle(state, seat, PACT_USED) && !opEffect(state, 'lg.noPact', subject.id)) {
        for (const m of pickAlternatives(state, subject, MARK)) out.push(offer(`${PACT}:${m}`, `Infernal Pact: ${m}`, 'lg.pact', subject, m))
      }
    }
    // ---- Siphon Life, at the start of the Resolve Attack Dice step (T-LG.12): for a Shoot once the defence dice are
    //      final (the attacker's shoot.attackerDefenceRolled window), for a Fight once both rolls are final
    if ((window === 'shoot.attackerDefenceRolled' || window === 'fight.rolled') && a && !usedThisTp(state, seat, SIPHON_TP) && !opEffect(state, SIPHON, subject.id)) {
      const weaponId = a.kind === 'shoot' ? (a.operativeId === subject.id ? a.weaponId : null) : (sideOf(state, subject.id)?.weaponId ?? null)
      const w = weaponId ? state.data.weapons[weaponId] : undefined
      // the rules the weapon has right now (a Null Rod strips a PSYCHIC melee weapon's rules), not the printed ones
      const foeId = a.kind === 'shoot' ? a.seq?.targetId : a.operativeId === subject.id ? a.fight?.targetId : a.operativeId
      if (w && hasRule(effectiveRules(state, subject, w, a.kind, foeId), 'siphonlife')) {
        for (const f of lgsOf(state, seat).sort((x, y) => (x.id < y.id ? -1 : 1))) {
          if (f.id !== subject.id && !(within(subject, f, 6) && visible(state, bodyOf(subject), bodyOf(f)))) continue
          out.push(offer(`${SIPHON}:${f.id}`, `Siphon Life: heal ${f.name}`, 'lg.siphon', subject, f.id))
        }
      }
    }
    // ---- Chaos Talismans, once per activation (T-LG.38)
    if (window === 'shoot.attackRolled' || window === 'fight.rolled') {
      const fx = state.effects.find((e) => e.source === TALISMANS_PLOY && e.seat === seat)
      const side = sideOf(state, subject.id)
      if (fx && side && side.weaponId && mark(subject) === fx.data?.mark && !opEffect(state, 'lg.talisman.used', subject.id) && liveFails(side.dice).length >= 2) {
        out.push(offer(TALISMAN_USE, 'Chaos Talismans: D3 damage to turn two fails into a success', 'lg.talisman', subject))
      }
    }
    // ---- Tainted Rounds: a bolt pistol or boltgun picked for a Shoot, once per turning point (T-LG.37)
    if (window === 'shoot.targetSelected' && equipped(state, seat, TAINTED_ROUNDS) && !usedThisTp(state, seat, TAINTED_KEY)) {
      if (a && a.kind === 'shoot' && a.operativeId === subject.id && a.weaponId && isPlainBolt(state, a.weaponId) && !opEffect(state, TAINTED_ROUNDS, subject.id)) {
        out.push(offer(TAINTED_ROUNDS, 'Tainted Rounds', 'lg.tainted', subject))
      }
    }
    // ---- Horrifying Dismemberment: after the Shrivetalon's fight ends with the enemy fighter down (T-LG.18)
    if (window === 'fight.resolved' && a && a.kind === 'fight' && a.fight && hasAbility(state, subject, DISMEMBER) && !(state.window?.used ?? []).includes(DISMEMBER)) {
      const foeId = a.operativeId === subject.id ? a.fight.targetId : a.operativeId
      const foe = state.operatives[foeId]
      if (foe && foe.seat !== seat && foe.status === 'active' && foe.wounds <= 0) {
        const near = (x: Operative, e: Operative) => within(x, e, 3) && visible(state, bodyOf(x), bodyOf(e))
        for (const e of enemiesOf(state, subject).sort((x, y) => (x.id < y.id ? -1 : 1))) {
          if (e.id === foe.id || !live(e)) continue
          if (near(subject, e) || near(foe, e)) out.push(offer(`${DISMEMBER}:${e.id}`, `Horrifying Dismemberment: ${e.name} loses 1 APL`, 'lg.dismember', subject, e.id))
        }
      }
    }
    return out
  },
  onUsed(ctx: Ctx, seat: Seat, o: PloyOffer, info: { subjectId?: string; attackFails?: number }) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    if (!op) return
    switch (o.via) {
      case 'lg.unleash': {
        op.oncePerBattleUsed.push(UNLEASH_USED)
        addToken(ctx, op.id, { kind: UNLEASH_TOKEN, owner: seat, cap: 1 }, 'lg.unleash')
        // RULING: a carried marker is placed at once at the Anointed's own position
        dropCarried(ctx, op)
        markFired('unleashDaemon')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: UNLEASH }, seat)
        break
      }
      case 'lg.pact': {
        markUsedBattle(s, seat, PACT_USED)
        if (o.param) setOperativePick(ctx, op.id, MARK, o.param, PACT)
        refreshFlags(s)
        markFired('infernalPact')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: PACT, detail: o.param ?? '' }, seat)
        break
      }
      case 'lg.siphon': {
        markUsedTp(s, seat, SIPHON_TP)
        addEffect(ctx, { source: SIPHON, seat, kind: 'ployFlag', operativeId: op.id, expires: 'action', data: { healId: o.param } })
        markFired('siphonLife')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: SIPHON, detail: o.param ?? '' }, seat)
        break
      }
      case 'lg.tainted': {
        markUsedTp(s, seat, TAINTED_KEY)
        addEffect(ctx, { source: TAINTED_ROUNDS, seat, kind: 'equipment', operativeId: op.id, expires: 'action', data: { weaponId: s.attack?.weaponId ?? null } })
        markFired('taintedRounds')
        break
      }
      case 'lg.dismember': {
        if (o.param) applyAplEffect(ctx, o.param, -1, DISMEMBER)
        markFired('horrifyingDismemberment')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: DISMEMBER, detail: o.param ?? '' }, seat)
        break
      }
      case 'lg.talisman': {
        const side = sideOf(s, op.id)
        addEffect(ctx, { source: 'lg.talisman.used', seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation' })
        if (!side) break
        const fails = liveFails(side.dice)
        // D3 damage to itself (it may fall; a Shoot carries on, a Fight ends), then two fails become one success
        directDamage(ctx, op.id, d3(ctx, 'lg.talisman'), op.id, 'lg.talisman')
        const keep = fails[0]
        const drop = fails[1]
        if (keep && drop) {
          keep.value = null
          keep.kind = 'normal'
          keep.tag = 'lg.talisman'
          drop.used = true
        }
        break
      }
      default:
        break
    }
    void info
  },
}

registerPloyRule(LG_RULE)
