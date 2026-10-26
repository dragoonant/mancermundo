// Plague Marines (docs/spec/13-teams.md section 5, rule ids T-PM.n): the code hooks this team's data names,
// its team rule provider (team-rules.ts) and its hook handlers (hooks.ts). Poison tokens (tokens.ts) are the
// spine: Poison puts them on, the activation hook burns them, Toxic, Grandfather's Blessing, Contagion,
// Nurglings, Virulent Poison, Poisonous Demise and Curse of Rot read them.
import { applyAplEffect, continueRemovals, effectiveRules, hasRule, inflict, validTargets, weaponDamage } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { codeParams, hasAbility, hasKeyword } from '../conditions'
import { addEffect, addUse, directDamage, markUsedTp, regainWounds, spendCp, usedThisTp, usesOf } from '../effects'
import { territoryOf } from '../equipment'
import { cancelAction, finishAction } from '../firefight'
import { dist2, distToPolygon, pointInPolygon } from '../geometry'
import { registerHook } from '../hooks'
import { bodyOf, visible } from '../los'
import { newMarkerId, removeMarker } from '../markers'
import { distanceBetween } from '../measure'
import { registerPloyRule } from '../ploy-rules'
import type { Ctx } from '../registry'
import { activeOps, enemiesOf, markerRadius, otherSeat, SEATS } from '../state'
import { registerTeamRules } from '../team-rules'
import { addToken, hasToken, heldSinceActionStart } from '../tokens'
import type { AttackDie, GameState, Marker, Operative, Seat } from '../types'

export const TEAM_ID = 'plague-marines'

/** The Poison token kind: one per owning player on an operative, kept all battle. */
export const POISON = 'pm.poison'
const PM = 'PLAGUE MARINE'
const EPS = 1e-6

const ID = {
  contagion: 'pm.p.contagion',
  lumbering: 'pm.p.lumbering-death',
  cloud: 'pm.p.cloud-of-flies',
  nurglings: 'pm.p.nurglings',
  virulent: 'pm.p.virulent-poison',
  sickening: 'pm.p.sickening-resilience',
  demise: 'pm.p.poisonous-demise',
  curse: 'pm.p.curse-of-rot',
  bells: 'pm.e.plague-bells',
  vents: 'pm.e.poison-vents',
  flail: 'pm.a.flail',
  iconBearer: 'pm.a.icon-bearer',
  iconOfContagion: 'pm.a.icon-of-contagion',
  blessing: 'pm.a.grandfathers-blessing',
} as const

// Passive rules register their name so the data may reference them; the handlers below mark them fired when
// they actually apply in a game.
for (const name of ['pmAstartes', 'disgustinglyResilient', 'poisonRule', 'toxicRule', 'grandfathersBlessing', 'iconBearer', 'repulsiveFortitude', 'plagueBells', 'poisonVents']) {
  registerCodeHook({ name })
}
// named by the Icon Bearer's data; its cost rule below registers at module load (ploy-rules.ts is a leaf)
registerCodeHook({ name: 'iconOfContagion', setup: () => undefined })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isPm(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, PM)
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function live(o: Operative): boolean {
  return o.status === 'active' && o.wounds > 0
}

function gap(a: Operative, b: Operative): number {
  return distanceBetween(bodyOf(a), bodyOf(b))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return gap(a, b) <= inches + EPS
}

function visibleEither(state: GameState, a: Operative, b: Operative): boolean {
  return visible(state, bodyOf(a), bodyOf(b)) || visible(state, bodyOf(b), bodyOf(a))
}

/** "Bolt weapon" for this team (T-PM.5): a weapon named boltgun or bolt pistol. */
export function isBolt(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  if (!w || w.type !== 'ranged') return false
  const n = w.name.toLowerCase()
  return n === 'boltgun' || n === 'bolt pistol'
}

/** PSYCHIC is a tag on the weapon (T-PM.6). */
export function isPsychic(state: GameState, weaponId: string): boolean {
  return hasRule(state.data.weapons[weaponId]?.rules ?? [], 'psychic')
}

function isRanged(state: GameState, weaponId: string): boolean {
  return state.data.weapons[weaponId]?.type === 'ranged'
}

function d3(ctx: Ctx, purpose: string): number {
  const [r] = ctx.roll(purpose, 1)
  return Math.ceil(r! / 2)
}

function pmsOf(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isPm(state, o))
}

function firstPm(state: GameState, seat: Seat): Operative | undefined {
  return pmsOf(state, seat)[0]
}

/**
 * Fight-like actions in an activation: real Fights plus FLAILs. finishAction records a FLAIL as
 * `ability:pm.a.flail` followed by a `fight` entry (its treatedAs) unless a `fight` is already listed,
 * so a `fight` right after a FLAIL entry is that FLAIL's shadow, not a second action.
 */
export function fightLike(performed: string[]): number {
  const flail = 'ability:pm.a.flail'
  let n = 0
  for (let i = 0; i < performed.length; i++) {
    if (performed[i] === flail) n++
    else if (performed[i] === 'fight' && performed[i - 1] !== flail) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Team rule provider: ASTARTES, Plague Bells, Icon Bearer, Contagion
// ---------------------------------------------------------------------------

/** Contagion (T-PM.20): the enemy is treated as injured while it sits near a Poison-linked Plague Marine or an Icon Bearer. */
export function contagionApplies(state: GameState, op: Operative): boolean {
  if (!live(op)) return false
  for (const seat of SEATS) {
    if (seat === op.seat || !ployActive(state, seat, ID.contagion)) continue
    for (const pm of pmsOf(state, seat)) {
      if (!within(pm, op, 3)) continue
      const poisoned = hasToken(state, op.id, POISON, seat)
      const icon = hasAbility(state, pm, ID.iconBearer)
      if (!poisoned && !icon) continue
      if (visibleEither(state, pm, op)) return true
    }
  }
  return false
}

registerTeamRules({
  id: TEAM_ID,
  // Poisonous Demise (T-PM.26): a Plague Marine incapacitated outside an attack (Poison, FLAIL, a mine, other rule
  // damage) waits for the before-removal queue whenever the ploy could be used, so its owner is asked there
  pausableRemoval: (state, op) => isPm(state, op) && !!demiseVictims(state, op),
  maxRepeats(state, op, actionId, performed) {
    if (!isPm(state, op)) return null
    const count = (a: string) => performed.filter((p) => p === a).length
    if (actionId === 'shoot') {
      if (count('fight') >= 2) return 1
      const can = op.weapons.some((w) => isRanged(state, w) && (isBolt(state, w) || isPsychic(state, w)))
      if (!can) return 1
      if (count('shoot') >= 1) markFired('pmAstartes')
      return 2
    }
    // FLAIL is treated as a Fight for action restrictions and Astartes (T-PM.10): Fight and FLAIL share the
    // allowance of two (one after two Shoots), so Fight + FLAIL, FLAIL + Fight and FLAIL + FLAIL are all legal
    const flailId = `ability:${ID.flail}`
    if (actionId === 'fight' || actionId === flailId) {
      const cap = count('shoot') >= 2 ? 1 : 2
      const left = Math.max(0, cap - fightLike(performed))
      if (left < cap) markFired('pmAstartes')
      // the check upstream is "entries of this id >= maxRepeats", so answer that count plus what is left
      return count(actionId) + left
    }
    return null
  },
  counteract(state, op) {
    return isPm(state, op) ? 'any' : null
  },
  actionForbidden(state, op, actionId) {
    // unique actions are offered through abilities.ts, which does not consult maxRepeats: bar FLAIL here once
    // the Fight allowance is spent (a counteraction is a single action, so it never applies there)
    if (actionId !== `ability:${ID.flail}` || !isPm(state, op)) return null
    const act = state.firefight.activation
    if (!act || act.operativeId !== op.id || act.counteract) return null
    const cap = act.performed.filter((a) => a === 'shoot').length >= 2 ? 1 : 2
    if (fightLike(act.performed) >= cap) return 'the Fight allowance is already spent (FLAIL counts as a Fight)'
    return null
  },
  flags(state, op) {
    if (isPm(state, op) && equipped(state, op.seat, ID.bells)) {
      markFired('plagueBells')
      return { ignoreInjured: true }
    }
    return null
  },
  injuredEquivalent(state, op) {
    return contagionApplies(state, op)
  },
  controlApl(state, op, _marker, apl) {
    if (!hasAbility(state, op, ID.iconBearer)) return null
    markFired('iconBearer')
    return apl + 1
  },
})

// Icon of Contagion (T-PM.12): CONTAGION costs 0 CP while an Icon Bearer stands in the opponent's territory.
/** "Within" a territory: any part of the base is inside it (not the centre only). */
export function inTerritory(o: Operative, terr: { x: number; z: number }[]): boolean {
  const c = { x: o.pos.x, z: o.pos.z }
  return pointInPolygon(c, terr) || distToPolygon(c, terr) < o.baseRadius - EPS
}

registerPloyRule({
  costAdjust(state, seat, ploy) {
    if (ploy.id !== ID.contagion) return null
    const terr = territoryOf(state, otherSeat(seat))
    if (!terr) return null
    const there = pmsOf(state, seat).some((o) => hasAbility(state, o, ID.iconOfContagion) && inTerritory(o, terr))
    return there ? { cost: 0, via: 'pm.iconOfContagion' } : null
  },
  onUsed(_ctx, _seat, offer) {
    if (offer.via === 'pm.iconOfContagion') markFired('iconOfContagion')
  },
})

// ---------------------------------------------------------------------------
// Weapon rules: Lumbering Death's Ceaseless, Toxic's Dmg
// ---------------------------------------------------------------------------

/** Lumbering Death (T-PM.21): in an activation with at most 3" moved, or when retaliating, not when counteracting. */
export function lumberingApplies(state: GameState, op: Operative, kind: 'shoot' | 'fight'): boolean {
  if (!isPm(state, op) || !ployActive(state, op.seat, ID.lumbering)) return false
  const a = state.attack
  if (kind === 'fight' && a && a.operativeId !== op.id) return true
  const act = state.firefight.activation
  if (!act || act.operativeId !== op.id || act.counteract) return false
  if (act.frame?.kind === 'interrupt') return true
  return (op.movedThisActivation ?? 0) <= 3 + EPS
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!state || !op) return null
    const data = c.data as { kind: 'shoot' | 'fight'; rules: { rule: string }[] }
    if (lumberingApplies(state, op, data.kind) && !data.rules.some((r) => r.rule === 'ceaseless')) {
      data.rules.push({ rule: 'ceaseless' })
      markFired('lumberingDeath')
    }
    return null
  },
  'pm.modifyWeaponRules',
)

registerHook(
  'modifyDamage',
  (c) => {
    const state = c.state
    if (!state || !c.operativeId || !c.targetId) return null
    const data = c.data as { weaponId: string; dmg: { normal: number; crit: number } }
    const w = state.data.weapons[data.weaponId]
    const op = state.operatives[c.operativeId]
    if (!w || !op || !hasRule(w.rules, 'toxic')) return null
    // checked per target against the tokens held when the action began (T-PM.8, FAQ)
    if (!heldSinceActionStart(state, c.targetId, POISON, op.seat)) return null
    data.dmg.normal += 1
    data.dmg.crit += 1
    markFired('toxicRule')
    return null
  },
  'pm.modifyDamage',
)

// ---------------------------------------------------------------------------
// Damage: Disgustingly Resilient, Poison tokens, Grandfather's Blessing
// ---------------------------------------------------------------------------

const DICE_SOURCES = ['normal', 'crit', 'strike-normal', 'strike-crit', 'devastating']

registerHook(
  'onDamageInflicted',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !op || !isPm(state, op)) return null
    const data = c.data as { source: string; amount: number }
    if (!DICE_SOURCES.includes(data.source) || data.amount < 3 || !codeParams(state, op, 'disgustinglyResilient')) return null
    markFired('disgustinglyResilient')
    if (state.effects.some((e) => e.source === ID.sickening && e.operativeId === op.id)) {
      // SICKENING RESILIENCE: no roll, always 1 less, never below 2
      data.amount = Math.max(2, data.amount - 1)
      return null
    }
    const [r] = ctx.roll('pm.resilient', 1)
    if (r! >= 4) data.amount -= 1
    return null
  },
  'pm.onDamageInflicted',
)

/** Grandfather's Blessing (T-PM.7): the Champion mends as poisoned enemies near it lose wounds. */
function blessing(ctx: Ctx, victim: Operative, lost: number): void {
  const s = ctx.state
  for (const champ of activeOps(s)) {
    if (champ.seat === victim.seat || !live(champ) || !hasAbility(s, champ, ID.blessing)) continue
    if (!hasToken(s, victim.id, POISON, champ.seat) || !within(champ, victim, 7)) continue
    const key = `pm.blessing:${champ.id}`
    const tp = s.ledger[champ.seat].tp
    const used = tp.filter((k) => k.startsWith(key)).length
    const room = 3 - used
    if (room <= 0) continue
    const gained = regainWounds(ctx, champ.id, Math.min(lost, room), ID.blessing)
    if (gained <= 0) continue
    for (let i = 0; i < gained; i++) tp.push(`${key}:${used + i}`)
    markFired('grandfathersBlessing')
  }
}

registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const victim = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !victim) return null
    const d = c.data as { source: string; attackerId: string; weaponId: string | null; amount: number }
    if (d.amount <= 0) return null
    // the token must already be there when the wounds are lost, so the Blessing is worked out first
    blessing(ctx, victim, d.amount)
    if (!DICE_SOURCES.includes(d.source) || !d.weaponId) return null
    const attacker = state.operatives[d.attackerId]
    if (!attacker || !isPm(state, attacker)) return null
    if (attacker.seat === victim.seat && isPm(state, victim)) return null
    const weapon = state.data.weapons[d.weaponId]
    if (!weapon) return null
    const kind = d.source.startsWith('strike') ? 'fight' : 'shoot'
    if (!hasRule(effectiveRules(state, attacker, weapon, kind, victim.id, ctx), 'poison')) return null
    if (addToken(ctx, victim.id, { kind: POISON, owner: attacker.seat, cap: 1 }, 'pm.poison') > 0) markFired('poisonRule')
    return null
  },
  'pm.damage.inflicted',
)

// ---------------------------------------------------------------------------
// Activation: Poison damage and Poison Vents
// ---------------------------------------------------------------------------

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !op || !live(op)) return null
    // damage first: "is activated" effects that inflict damage resolve before the others (core update log)
    for (const owner of SEATS) {
      if (owner === op.seat || !hasToken(state, op.id, POISON, owner)) continue
      let amount = 1
      if (equipped(state, owner, ID.vents) && pmsOf(state, owner).some((pm) => within(pm, op, 3))) {
        amount = d3(ctx, 'pm.vents.damage')
        markFired('poisonVents')
      }
      markFired('poisonRule')
      directDamage(ctx, op.id, amount, (firstPm(state, owner) ?? op).id, 'pm.poison')
      if (!live(op)) return null
    }
    for (const owner of SEATS) {
      if (owner === op.seat || hasToken(state, op.id, POISON, owner) || !equipped(state, owner, ID.vents)) continue
      if (!pmsOf(state, owner).some((pm) => within(pm, op, 3))) continue
      if (d3(ctx, 'pm.vents.token') === 3 && addToken(ctx, op.id, { kind: POISON, owner }, 'pm.poisonVents') > 0) markFired('poisonVents')
    }
    return null
  },
  'pm.activation.start',
)

// ---------------------------------------------------------------------------
// Dice: Repulsive Fortitude, Curse of Rot
// ---------------------------------------------------------------------------

/** Curse of Rot (T-PM.27): every 3 becomes a fail that cannot be re-rolled; returns how many. */
function markCurse(dice: AttackDie[]): number {
  let n = 0
  for (const d of dice) {
    if (d.value !== 3 || d.tag === 'pm.curse') continue
    d.kind = 'fail'
    d.rerolled = true
    d.tag = 'pm.curse'
    n++
  }
  return n
}

function curseDamage(ctx: Ctx, pmId: string, foeId: string, n: number): void {
  for (let i = 0; i < n; i++) inflict(ctx, { targetId: foeId, attackerId: pmId, weaponId: null, amount: 1, source: 'direct' })
}

registerHook(
  'afterDefenceRoll',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const data = c.data as { kind: 'shoot' | 'fight'; dice: AttackDie[] }
    const defender = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !defender || data.kind !== 'shoot') return null
    if (codeParams(state, defender, 'repulsiveFortitude')) {
      for (const die of data.dice) {
        if (die.value === null || die.value < 5 || die.kind === 'crit' || die.tag) continue
        die.kind = 'crit'
        die.tag = 'pm.repulsive'
        markFired('repulsiveFortitude')
      }
    }
    return null
  },
  'pm.afterDefenceRoll',
)

// ---------------------------------------------------------------------------
// ASTARTES: the second Shoot's weapon (T-PM.16)
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const state = c.state
    const op = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    if (!state || !op || data.secondary || !isPm(state, op)) return null
    const act = state.firefight.activation
    if (!act || act.operativeId !== op.id || act.frame || act.counteract) return null
    if (act.performed.filter((a) => a === 'shoot').length < 1) return null
    const prev = [...(act.weaponsUsed ?? [])].filter((w) => isRanged(state, w)).pop()
    const good = (w: string) => isBolt(state, w) || isPsychic(state, w)
    const w = data.weaponId
    const repeatsPsychic = isPsychic(state, w) && (act.weaponsUsed ?? []).includes(w)
    const needsGood = prev !== undefined && !good(prev) && !good(w)
    if (repeatsPsychic || needsGood) data.candidates.length = 0
    return null
  },
  'pm.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// BLIGHT GRENADES (T-PM.30): the team may throw it twice a battle. The equipment's `limits` (2 per battle,
// team scope) are counted by the shared team-limit bookkeeping (equipment.ts noteWeaponUses, ledger key
// `limit:pm.w.blight-grenade`), which strips the grenade from the team once both uses are spent.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cloud of Flies: the marker obscures the Plague Marines it covers (T-PM.22)
// ---------------------------------------------------------------------------

const CLOUD_MARKER = 'pm.p.cloud-of-flies'

function cloudCovers(m: Marker, pm: Operative): boolean {
  return dist2({ x: pm.pos.x, z: pm.pos.z }, m.pos) + pm.baseRadius <= 1 + markerRadius(m) + EPS
}

registerHook(
  'target.status',
  (c) => {
    const state = c.state
    const shooter = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    const target = state && c.targetId ? state.operatives[c.targetId] : undefined
    if (!state || !shooter || !target || !isPm(state, target) || shooter.seat === target.seat) return null
    const marker = state.markers.find((m) => m.equipmentId === CLOUD_MARKER && m.owner === target.seat && cloudCovers(m, target))
    if (!marker || !(gap(shooter, target) > 3 + EPS)) return null
    ;(c.data as { obscured: boolean }).obscured = true
    markFired('cloudOfFlies')
    return null
  },
  'pm.target.status',
)

// The marker is removed in the Ready step of the next Strategy phase.
registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    for (const m of [...ctx.state.markers]) if (m.equipmentId === CLOUD_MARKER) removeMarker(ctx, m.id, 'pm.cloudOfFlies')
    return null
  },
  'pm.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Poisonous Demise (T-PM.26): offered when a Plague Marine is incapacitated, before it is removed
// ---------------------------------------------------------------------------

/** Enemies Poisonous Demise would reach, or null when the ploy cannot be used for this operative now. */
function demiseVictims(state: GameState, pm: Operative): Operative[] | null {
  const ploy = state.data.ploys?.[ID.demise]
  if (!ploy || state.players[pm.seat].teamId !== TEAM_ID || usedThisTp(state, pm.seat, ploy.id) || state.players[pm.seat].cp < ploy.cost) return null
  const victims = enemiesOf(state, pm).filter((e) => live(e) && within(pm, e, 3) && visible(state, bodyOf(pm), bodyOf(e)))
  return victims.length > 0 ? victims : null
}

/** Enemies in the ploy's reach (visible, within 3"), whatever the CP. */
function demiseReach(state: GameState, pm: Operative): Operative[] {
  return enemiesOf(state, pm).filter((e) => live(e) && within(pm, e, 3) && visible(state, bodyOf(pm), bodyOf(e)))
}

/** The ploy's effect: poison every enemy in reach, or hurt one that already carries your Poison token. */
function demiseEffect(ctx: Ctx, pm: Operative): void {
  for (const e of demiseReach(ctx.state, pm)) {
    if (hasToken(ctx.state, e.id, POISON, pm.seat)) directDamage(ctx, e.id, 1, pm.id, 'pm.poisonousDemise')
    else addToken(ctx, e.id, { kind: POISON, owner: pm.seat }, 'pm.poisonousDemise')
  }
}

/** Played outside a ploy window, and paid here: a removal queue that waits while another ploy timing is open. */
function playDemise(ctx: Ctx, pm: Operative): void {
  const state = ctx.state
  const ploy = state.data.ploys?.[ID.demise]
  if (!ploy || !demiseVictims(state, pm)) return
  spendCp(ctx, pm.seat, ploy.cost, ploy.id)
  markUsedTp(state, pm.seat, ploy.id)
  ctx.emit({ type: 'PloyUsed', ployId: ploy.id }, pm.seat)
  markFired('poisonousDemise')
  demiseEffect(ctx, pm)
}

registerCodeHook({
  name: 'poisonousDemise',
  ploy: {
    // the shared operative.incapacitated ploy window of an attack's removal queue (passing keeps the CP)
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const pm = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!isPm(state, pm) || pm.seat !== seat || pm.status !== 'active' || demiseReach(state, pm).length === 0) return []
      return [{}]
    },
    apply(ctx, _seat, _ploy, _seed, info) {
      const pm = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (pm) demiseEffect(ctx, pm)
    },
  },
  // the owner's answer when the removal queue waits but the ploy window cannot open (another ploy timing is open)
  choice(ctx, op, option) {
    if (option === 'use' && op.status === 'active') playDemise(ctx, op)
    continueRemovals(ctx)
  },
})

registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const state = c.state
    const pm = state && c.operativeId ? state.operatives[c.operativeId] : undefined
    if (!ctx || !state || !pm || !isPm(state, pm) || !demiseVictims(state, pm)) return null
    // an attack's removal queue: the operative.incapacitated ploy window offers it next, before removal (R-5.18)
    if (state.removal && !state.window) return null
    if (state.removal && !state.pending) {
      // an attack's removal queue can wait for the owner's decision (R-5.18: the owner orders its own rules)
      ctx.raise({
        kind: 'ability.choice',
        seat: pm.seat,
        window: 'operative.incapacitated',
        context: { hook: 'poisonousDemise', operativeId: pm.id },
        options: [
          { id: 'use', labelKey: 'removal.free', type: 'ability.choice' as const, payload: { option: 'use' }, data: { name: 'Poisonous Demise (1 CP): poison or hurt every enemy it sees within 3"' } },
          { id: 'none', labelKey: 'removal.free', type: 'ability.choice' as const, payload: { option: 'none' }, data: { name: 'Keep the CP' } },
        ],
      })
      return null
    }
    // a queue whose decision slot is already taken (rare): the ploy is played for its owner. Outside a queue nothing
    // reaches here with the ploy usable: such removals wait for a queue (pausableRemoval)
    if (state.removal) playDemise(ctx, pm)
    return null
  },
  'pm.operative.incapacitated',
)

// ---------------------------------------------------------------------------
// Unique actions
// ---------------------------------------------------------------------------

function flailTargets(state: GameState, op: Operative): Operative[] {
  return Object.values(state.operatives)
    .filter((o) => o.id !== op.id && live(o) && within(op, o, 2) && visible(state, bodyOf(op), bodyOf(o)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

registerCodeHook({
  name: 'flail',
  action: {
    offers(state, op): OfferSeed[] {
      return flailTargets(state, op).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const s = ctx.state
      const act = s.firefight.activation!
      act.declared = { ...act.declared!, params: { ...(act.declared!.params ?? {}), treatedAs: 'fight' } }
      for (const t of flailTargets(s, op)) {
        const roll = d3(ctx, 'pm.flail')
        directDamage(ctx, t.id, roll + 2, op.id, 'pm.flail')
        if (t.seat !== op.seat && roll === 3) addToken(ctx, t.id, { kind: POISON, owner: op.seat, cap: 1 }, 'pm.flail')
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/** Enemies POISONOUS MIASMA can pick: visible within 7", or any valid target of the Plaguecaster (T-PM.13). */
export function miasmaTargets(state: GameState, op: Operative): Operative[] {
  const wind = 'pm.w.plague-wind'
  const valid = new Set(op.weapons.includes(wind) && state.data.weapons[wind] ? validTargets(state, op, wind).map((t) => t.id) : [])
  return enemiesOf(state, op)
    .filter((e) => live(e) && ((within(op, e, 7) && visible(state, bodyOf(op), bodyOf(e))) || valid.has(e.id)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

registerCodeHook({
  name: 'poisonousMiasma',
  action: {
    offers(state, op): OfferSeed[] {
      return miasmaTargets(state, op).map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!t || !live(t) || t.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      if (hasToken(ctx.state, t.id, POISON, op.seat)) directDamage(ctx, t.id, 3, op.id, 'pm.miasma')
      else addToken(ctx, t.id, { kind: POISON, owner: op.seat, cap: 1 }, 'pm.miasma')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

const vitalityKey = (opId: string): string => `pm.vitality:${opId}`

registerCodeHook({
  name: 'putrescentVitality',
  action: {
    offers(state, op): OfferSeed[] {
      if (usedThisTp(state, op.seat, vitalityKey(op.id))) return []
      return Object.values(state.operatives)
        .filter((f) => f.seat === op.seat && live(f) && f.wounds < f.maxWounds && within(op, f, 3) && visible(state, bodyOf(op), bodyOf(f)))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!t || !live(t) || t.seat !== op.seat) {
        cancelAction(ctx)
        return
      }
      markUsedTp(ctx.state, op.seat, vitalityKey(op.id))
      const dice = ctx.roll('pm.vitality', 2)
      const total = dice[0]! + dice[1]!
      regainWounds(ctx, t.id, total === 7 ? 7 : Math.max(dice[0]!, dice[1]!), def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys
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
flagPloy('contagion')
flagPloy('lumberingDeath')

registerCodeHook({
  name: 'cloudOfFlies',
  ploy: {
    // candidate spots: under each Plague Marine, and between any two whose bases one marker can cover together
    // (the marker covers a base wholly within 1", so one marker reaches at most two touching Plague Marines)
    offers(state, seat): PloyOfferSeed[] {
      const seen = new Set<string>()
      const out: PloyOfferSeed[] = []
      const add = (x: number, z: number) => {
        const key = `${Math.round(x * 20) / 20},${Math.round(z * 20) / 20}`
        if (seen.has(key)) return
        seen.add(key)
        out.push({ param: key })
      }
      const pms = pmsOf(state, seat)
      for (const pm of pms) add(pm.pos.x, pm.pos.z)
      for (let i = 0; i < pms.length; i++) {
        for (let j = i + 1; j < pms.length; j++) {
          const a = pms[i]!
          const b = pms[j]!
          const mid = { kind: 'equipment' as const, pos: { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 } } as Marker
          if (cloudCovers(mid, a) && cloudCovers(mid, b)) add(mid.pos.x, mid.pos.z)
        }
      }
      return out
    },
    apply(ctx, seat, ploy, seed) {
      const [x, z] = (seed.param ?? '0,0').split(',').map(Number) as [number, number]
      const marker: Marker = {
        id: newMarkerId(ctx, 'flies'),
        kind: 'equipment',
        pos: { x, z },
        owner: seat,
        carriedBy: null,
        controller: null,
        equipmentId: CLOUD_MARKER,
      }
      ctx.state.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: null, pos: marker.pos }, seat)
      void ploy
    },
  },
})

/** Enemies NURGLINGS can pick (T-PM.23). */
export function nurglingTargets(state: GameState, seat: Seat): Operative[] {
  const mine = pmsOf(state, seat)
  return activeOps(state)
    .filter((e) => e.seat !== seat && live(e))
    .filter((e) => mine.some((pm) => within(pm, e, 3) || (hasToken(state, e.id, POISON, seat) && within(pm, e, 7))))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

registerCodeHook({
  name: 'nurglings',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return nurglingTargets(state, seat).map((e) => ({ param: e.id }))
    },
    apply(ctx, _seat, ploy, seed) {
      if (seed.param) applyAplEffect(ctx, seed.param, -1, ploy.id)
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'virulentPoison',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const pm = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!isPm(state, pm) || pm.seat !== seat) return []
      return enemiesOf(state, pm)
        .filter((e) => live(e) && !hasToken(state, e.id, POISON, seat) && (within(pm, e, 3) || (within(pm, e, 7) && visible(state, bodyOf(pm), bodyOf(e)))))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      if (seed.param) addToken(ctx, seed.param, { kind: POISON, owner: seat, cap: 1 }, 'pm.virulentPoison')
    },
  },
})

function sideOf(state: GameState, opId: string) {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

registerCodeHook({
  name: 'sickeningResilience',
  ploy: {
    offers(state, seat, ploy, info): PloyOfferSeed[] {
      const pm = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!isPm(state, pm) || pm.seat !== seat || state.effects.some((e) => e.source === ploy.id && e.operativeId === pm.id)) return []
      let attackerId: string | undefined
      let weaponId: string | null | undefined
      const kind = info.window === 'fight.rolled' ? 'fight' : 'shoot'
      if (kind === 'shoot') {
        if (info.targetId !== pm.id) return []
        attackerId = info.attackerId
        weaponId = info.weaponId
      } else {
        attackerId = info.attackerId === pm.id ? info.targetId : info.attackerId
        weaponId = attackerId ? sideOf(state, attackerId)?.weaponId : undefined
      }
      const foeSide = attackerId ? sideOf(state, attackerId) : null
      if (!attackerId || !weaponId || !foeSide || !state.data.weapons[weaponId]) return []
      if (!foeSide.dice.some((d) => !d.used && d.kind !== 'fail')) return []
      const dmg = weaponDamage(state, attackerId, weaponId, pm.id, kind)
      return Math.max(dmg.normal, dmg.crit) >= 3 ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'activation' })
    },
  },
})

registerCodeHook({
  name: 'curseOfRot',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const pm = info.subjectId ? state.operatives[info.subjectId] : undefined
      // not while retaliating: only the operative that started the Shoot or Fight may use it
      if (!isPm(state, pm) || pm.seat !== seat || info.attackerId !== pm.id || !info.targetId) return []
      const foe = state.operatives[info.targetId]
      if (!foe || foe.seat === seat || !live(foe)) return []
      const near = within(pm, foe, 3) || (hasToken(state, foe.id, POISON, seat) && within(pm, foe, 7))
      if (!near) return []
      // offered on the enemy's fresh roll, before any re-roll (shoot.beforeDefenceRerolls, fight.beforeRerolls), when a 3 shows
      const side = sideOf(state, foe.id)
      if (!side || !side.dice.some((d) => d.value === 3 && !d.used && d.tag !== 'pm.curse')) return []
      return [{}]
    },
    apply(ctx, _seat, _ploy, _seed, info) {
      const pmId = info.subjectId
      const foeId = info.targetId
      if (!pmId || !foeId) return
      const side = sideOf(ctx.state, foeId)
      if (side) curseDamage(ctx, pmId, foeId, markCurse(side.dice))
    },
  },
})

