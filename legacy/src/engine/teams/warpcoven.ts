// Warpcoven (docs/spec/13-teams.md section 15, rule ids T-WC.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts), its hook handlers (hooks.ts) and its ploy rules (ploy-rules.ts).
//
// Map of the rules to the code below:
//  - Boons of Tzeentch (T-WC.21-30): operative-picks tags (`op.picks.boon`, `op.picks.bombard`, never keywords). Time-Walk,
//    Master of the Immaterium and the Brayhorn bonus are provider/helper reads; Incorporeal Sight, Twist of Fate, Astral
//    Bombardment and the weapon-rule boons are modifyWeaponRules clauses; Warp Swell is modifyDamage; Echoes and Sorcerous
//    Scrolls are 0 CP pseudo ploys at the activation-start window; Immaterial Flight is the provider canFly.
//  - ASTARTES (T-WC.31): provider maxRepeats / counteract, the shared `astartes` code param for the +1 AP surcharge, and
//    weaponForbidden for the same PSYCHIC ranged weapon twice.
//  - PSYCHIC (T-WC.6-12): five unique actions (psychic.ts psychicSelectable for who they pick, psychicAllowed for every
//    lasting effect); tokens wc.protected / wc.ravaged / wc.alight / wc.mindburn live in tokens.ts.
//  - Fate Itself is My Weapon: a ploy effect that reserves two public dice on an effect record; 0 CP pseudo ploys at
//    shoot.beforeAttackRerolls (the shooter), shoot.defenderAttackRolled (the defender, on the opponent's fresh roll) and
//    fight.beforeRerolls replace an attack die and tag it so no rule reclassifies it.
//  - Savage Brutality: the provider ownReactions after the Champion's first Fight of its own activation; the code hook's
//    choice starts the free Fight (resume REACTION_DONE).
//  - Psychic Cabal: the lender's weapon is pushed onto the borrower for the activation (weaponForbidden bars the lender);
//    a borrowed action is an extraActions answer.
//  - Everything else is a hook handler or provider named in the Engine map of the spec section.
import { applyAplEffect, eligibleDice, forcedReroll, hasRule, kindOf, ruleKey, weaponDamage } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { hasAbility, hasKeyword } from '../conditions'
import { addEffect, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { allowedOrders } from '../abilities'
import { territoryOf } from '../equipment'
import { assistersOf } from '../fight'
import { cancelAction, canStartFreeAction, finishAction, joinActivation, reactionDone, REACTION_DONE, startFreeAction } from '../firefight'
import { registerHook, type ActionEndedData, type AfterRollData, type DamageInflictedData, type DiceRolledData } from '../hooks'
import { bodyOf, visible } from '../los'
import { newMarkerId, PICK_UP, PLACE, removeMarker } from '../markers'
import { distanceBetween } from '../measure'
import { CHARGE_BONUS, COUNTERACT_CAP, DASH_MAX } from '../movement'
import { pickAlternatives, setOperativePick } from '../operative-picks'
import { registerPloyRule, type PloyOffer } from '../ploy-rules'
import { isPsychicWeapon, psychicAllowed, psychicSelectable } from '../psychic'
import type { Ctx } from '../registry'
import { activeOps, effectiveMove, enemiesOf, hasInjuredPenalty, otherSeat } from '../state'
import { providerAny, registerTeamRules, type ReactionOffer } from '../team-rules'
import { placementProblem } from '../terrain'
import { addToken, hasToken, moveTokenTo, removeTokensWhere } from '../tokens'
import type { Activation, DiceSide, GameState, Operative, RerollGrant, Seat, WeaponRuleRef } from '../types'
import { pointInPolygon } from '../geometry'

export const TEAM_ID = 'warpcoven'

const WC = 'WARPCOVEN'
const EPS = 1e-6
/** The operative choice ids of the Boons of Tzeentch and of the Astral Bombardment weapon pick (team.json). */
export const BOON = 'boon'
export const BOMBARD = 'bombard'

const A = (id: string) => `wc.a.${id}`
const P = (id: string) => `wc.p.${id}`
const E = (id: string) => `wc.e.${id}`

// abilities
const AUTOMATA = A('sorcerous-automata')
const ICON = A('icon-bearer')
const SLOW = A('slow-and-purposeful')
const BRUTALITY = A('savage-brutality')
const BANNER = A('herd-banner')
const RELIC = A('relic-hunters')
const FATE_RESERVE = A('fate-reserve')
// boons (ability record ids double as the pseudo ploy ids)
const B_ECHOES = A('boon-echoes-from-the-warp')
const B_ASTRAL = A('boon-astral-bombardment')
// ploys
const WARDING = P('aetherial-warding')
const FATE = P('fate-itself-is-my-weapon')
const BROTHERHOOD = P('brotherhood-of-sorcerers')
const HERD = P('savage-herd')
const DUST = P('all-is-dust')
const CAPRICIOUS = P('capricious-plan')
const CABAL = P('psychic-cabal')
const MUTANT_HERD = P('mutant-herd')
// equipment
const ROUNDS = E('ensorcelled-rounds')
const DAEMONMAW = E('daemonmaw-weapons')
const ROBES = E('arcane-robes')
const SCROLLS = E('sorcerous-scrolls')
// weapons
const MINDBURN_W = 'wc.w.mindburn'
const FIRESTORM_W = 'wc.w.firestorm'
const DOOMBOLT_W = 'wc.w.doombolt'
const FLUXBLAST_W = 'wc.w.fluxblast'
const SHIELD_W = 'wc.w.tzaangor-blade-and-shield'
const FISTS_W = 'wc.w.fists'
// unique actions
const AC_PROTECTED = A('protected-by-fate')
const AC_RAVAGE = A('ravage-destiny')
const AC_RITUAL = A('reconstitution-ritual')
const AC_FLUX = A('temporal-flux')
const AC_ALIGHT = A('alight')
const AC_BRAYHORN = A('brayhorn')

// tokens, markers, effect sources and ledger keys
const T_PROTECTED = 'wc.protected'
const T_RAVAGED = 'wc.ravaged'
const T_ALIGHT = 'wc.alight'
const T_MINDBURN = 'wc.mindburn'
const FLUX_MARKER = 'wc.flux'
const FX_FLUX = 'wc.flux'
const FX_FATE = 'wc.fate'
const FX_FATE_SPENT = 'wc.fate.spent'
const FX_BRAYHORN = 'wc.brayhorn'
const FX_APPENDAGE = 'wc.appendage.spent'
const FX_ASTRAL = 'wc.astral'
const FX_DUST = 'wc.dust'
const FX_CABAL_WEAPON = 'wc.cabal.weapon'
const FX_CABAL_LENT = 'wc.cabal.lent'
const FX_CABAL_ACTION = 'wc.cabal.action'
const L_RITUAL = 'wc.ritual'
const L_ECHOES = 'wc.echoes'
const ECHOES_USED = 'wc.echoes.used'
const L_SCROLLS = 'wc.scrolls'
const L_RELIC = 'wc.relic'
const L_ROBES = 'wc.robes'
const L_BRUTALITY = 'wc.brutality'
const flightKey = (opId: string) => `wc.flight:${opId}`
const usedKey = (opId: string, weaponId: string) => `wc.used:${opId}:${weaponId}`
const FATE_TAG = 'wc.fate'

const DICE_SOURCES = ['normal', 'crit', 'strike-normal', 'strike-crit']

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game.
for (const name of ['boonsOfTzeentch', 'wcSorcerousAutomata', 'wcIconBearer', 'slowAndPurposeful', 'herdBanner', 'wcMindburn', 'wcShield', 'daemonmawWeapons', 'arcaneRobes', 'sorcerousScrolls']) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isWc(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, WC)
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

function sees(state: GameState, a: Operative, b: Operative): boolean {
  return a.id === b.id || visible(state, bodyOf(a), bodyOf(b))
}

export function boonOf(op: Operative): string | undefined {
  return op.picks?.[BOON]
}

const hasBoon = (op: Operative, boon: string): boolean => boonOf(op) === boon

/** The distance of a PSYCHIC action's pick: +3" with Master of the Immaterium (T-WC.30). */
function reach(op: Operative, inches: number): number {
  return hasBoon(op, 'MASTER OF THE IMMATERIUM') ? inches + 3 : inches
}

function wcOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isWc(state, o))
}

const sorcerersOf = (state: GameState, seat: Seat): Operative[] => wcOps(state, seat).filter((o) => hasKeyword(state, o, 'SORCERER'))

const isAstartes = (state: GameState, op: Operative): boolean => isWc(state, op) && hasKeyword(state, op, 'HERETIC ASTARTES')

const isTzaangor = (state: GameState, op: Operative | undefined): op is Operative => !!op && isWc(state, op) && hasKeyword(state, op, 'TZAANGOR')

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState): Activation | null {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

function isMissionAction(state: GameState, actionId: string): boolean {
  const id = actionId.startsWith('ability:') ? actionId.slice('ability:'.length) : actionId
  const def = state.data.abilities[id]
  return !!def && (def.keywords ?? []).includes('MISSION')
}

const isMarkerAction = (state: GameState, actionId: string): boolean => actionId === PICK_UP || actionId === PLACE || isMissionAction(state, actionId)

function setOrder(ctx: Ctx, op: Operative, order: 'engage' | 'conceal'): void {
  if (op.order === order) return
  if (op.flags.guard) {
    op.flags.guard = false
    ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'order' }, op.seat)
  }
  op.order = order
  ctx.emit({ type: 'OrderSet', operativeId: op.id, order })
}

const flipped = (order: 'engage' | 'conceal'): 'engage' | 'conceal' => (order === 'engage' ? 'conceal' : 'engage')

function sideOf(state: GameState, opId: string): DiceSide | null {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

/** PSYCHIC ranged weapons the operative carries. */
const psychicRanged = (state: GameState, op: Operative): string[] => op.weapons.filter((w) => state.data.weapons[w]?.type === 'ranged' && isPsychicWeapon(state, w))

/** The weapon an Astral Bombardment Sorcerer chose (T-WC.29), or null. */
function bombardWeapon(state: GameState, op: Operative): string | null {
  if (!hasBoon(op, 'ASTRAL BOMBARDMENT')) return null
  if (hasKeyword(state, op, 'DESTINY')) return DOOMBOLT_W
  if (hasKeyword(state, op, 'TEMPYRION')) return FLUXBLAST_W
  return op.picks?.[BOMBARD] === 'MINDBURN' ? MINDBURN_W : FIRESTORM_W
}

const keyOf = (r: WeaponRuleRef): string => ruleKey(r.rule)

function has(rules: WeaponRuleRef[], key: string): boolean {
  return hasRule(rules, key)
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  // SAVAGE BRUTALITY (T-WC.16): offered to the Champion's own seat right after its first Fight of its own activation
  ownReactions(state, seat, info): ReactionOffer[] {
    if (info.action !== 'fight' || info.activeSeat !== seat || info.freeAction || info.interrupt || info.activationEnded || info.counteract || info.strategy) return []
    const op = state.operatives[info.actorId]
    return op && op.seat === seat && brutalityOpen(state, op) ? [{ hook: 'savageBrutality', operativeId: op.id, option: 'fight', labelKey: `ability.${BRUTALITY}`, data: { name: `Savage Brutality: ${op.name} fights again` } }] : []
  },

  // ASTARTES (T-WC.31): no bolt-weapon condition; two Shoots or two Fights
  maxRepeats(state, op, actionId, performed) {
    if (!isAstartes(state, op) || (actionId !== 'shoot' && actionId !== 'fight')) return null
    const count = (a: string) => performed.filter((p) => p === a).length
    const other = actionId === 'shoot' ? 'fight' : 'shoot'
    if (count(other) >= 2) return 1
    return 2
  },
  counteract(state, op) {
    return isAstartes(state, op) ? 'any' : null
  },

  // Time-Walk (T-WC.23) and Brayhorn (T-WC.17)
  moveDelta(state, op) {
    if (!isWc(state, op)) return 0
    let d = 0
    if (hasBoon(op, 'TIME-WALK')) {
      d += 1
      markFired('boonsOfTzeentch')
    }
    if (isTzaangor(state, op) && state.effects.some((e) => e.source === FX_BRAYHORN && e.seat === op.seat)) {
      d += 1
      markFired('brayhorn')
    }
    return d
  },

  // Echoes from the Warp (T-WC.24): the 2" counteraction cap covers both actions together
  moveLimitDelta(state, op, kind) {
    const act = state.firefight.activation
    if (!isWc(state, op) || !act || !act.counteract || act.operativeId !== op.id || !(act.used ?? []).includes(ECHOES_USED)) return 0
    const moved = op.movedThisActivation ?? 0
    if (moved <= 0) return 0
    const move = effectiveMove(op, state)
    const base = kind === 'dash' ? Math.min(DASH_MAX, move) : kind === 'charge' ? move + CHARGE_BONUS : move
    return Math.min(0, Math.max(0, COUNTERACT_CAP - moved) - base)
  },

  // Icon Bearer (T-WC.14) counts 1 higher, Ravage Destiny (T-WC.8) 1 lower, only when marker control is worked out
  controlApl(state, op, _marker, apl) {
    let v = apl
    if (isWc(state, op) && hasAbility(state, op, ICON)) {
      v += 1
      markFired('wcIconBearer')
    }
    if (hasToken(state, op.id, T_RAVAGED) && psychicAllowed(state, op)) {
      v = Math.max(0, v - 1)
      markFired('ravageDestiny')
    }
    return v === apl ? null : v
  },

  // Relic Hunters (T-WC.19) and Mutant Appendage (T-WC.26): 1 less AP for Pick Up Marker, Place Marker or a mission action
  actionCostDelta(state, op, actionId) {
    if (!isWc(state, op) || !isMarkerAction(state, actionId)) return 0
    const act = baseActivation(state)
    let d = 0
    // never in a counteraction: the action is free there, and a 0 AP action could not be the counteraction (R-3.12)
    if (relicApplies(state, op) && !(act && act.counteract && act.operativeId === op.id)) d -= 1
    // once per activation and never in a counteraction (not an activation)
    if (hasBoon(op, 'MUTANT APPENDAGE') && act && !act.counteract && act.operativeId === op.id && !opEffect(state, FX_APPENDAGE, op.id)) d -= 1
    return d
  },
  markerActionRelief(state, op, actionId) {
    if (!isWc(state, op) || !hasBoon(op, 'MUTANT APPENDAGE')) return null
    if (actionId !== PICK_UP && !isMissionAction(state, actionId)) return null
    markFired('boonsOfTzeentch')
    return { ignoreEnemyControlRange: true }
  },

  // Immaterial Flight (T-WC.27): Charge or Reposition in its own activation, once per turning point
  canFly(state, op, kind) {
    if (!isWc(state, op) || !hasBoon(op, 'IMMATERIAL FLIGHT') || (kind !== 'charge' && kind !== 'reposition')) return false
    const act = baseActivation(state)
    if (!act || act.operativeId !== op.id || act.counteract) return false
    return !usedThisTp(state, op.seat, flightKey(op.id))
  },

  // Shield (T-WC.20): each block of a fighter with the blade & shield cancels two successes
  blockCapacity(state, attack, seat) {
    const seq = attack.seq
    if (!seq) return null
    const side = seq.atk.seat === seat && seq.atk.weaponId ? seq.atk : seq.def
    if (!side || side.seat !== seat || side.weaponId !== SHIELD_W) return null
    markFired('wcShield')
    return 2
  },

  // a borrowed PSYCHIC action (Psychic Cabal)
  extraActions(state, op) {
    return state.effects.filter((e) => e.source === FX_CABAL_ACTION && e.operativeId === op.id).map((e) => String(e.data?.actionId))
  },

  weaponForbidden(state, op, weaponId, kind) {
    if (kind !== 'shoot' || !isWc(state, op)) return null
    // the lender cannot use the weapon it lent for the rest of the turning point (T-WC.38)
    const lent = state.effects.find((e) => e.source === FX_CABAL_LENT && e.operativeId === op.id && e.data?.weaponId === weaponId)
    if (lent) {
      markFired('psychicCabal')
      return 'that PSYCHIC weapon was lent to another Sorcerer this turning point'
    }
    // the same PSYCHIC ranged weapon cannot be picked twice in one activation (T-WC.31)
    if (isAstartes(state, op) && isPsychicWeapon(state, weaponId) && state.data.weapons[weaponId]?.type === 'ranged') {
      const act = baseActivation(state)
      if (act && act.operativeId === op.id && (act.weaponsUsed ?? []).includes(weaponId)) return 'the same PSYCHIC ranged weapon cannot be selected twice in one activation'
    }
    return null
  },
})

/** Relic Hunters (T-WC.19): the first qualifying action of the kill team's battle, by a Tzaangor Warrior in the opponent's territory. */
function relicApplies(state: GameState, op: Operative): boolean {
  if (!hasAbility(state, op, RELIC) || usedThisBattle(state, op.seat, L_RELIC)) return false
  const terr = territoryOf(state, otherSeat(op.seat))
  return !!terr && pointInPolygon({ x: op.pos.x, z: op.pos.z }, terr)
}

// ---------------------------------------------------------------------------
// Shield: Save 4+ at set-up (T-WC.20); Relic Hunters shares the Tzaangor Warrior's hook name
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'relicHunters',
  setup(ctx, seat) {
    for (const op of Object.values(ctx.state.operatives)) {
      if (op.seat !== seat || !op.weapons.includes(SHIELD_W)) continue
      // a set, not an improvement: the Save is 4+ whatever the card printed
      op.save = 4
      markFired('wcShield')
    }
  },
})

// ---------------------------------------------------------------------------
// Activation start and end: Sorcerous Automata, Temporal Flux's return, Psychic Cabal's clean-up
// ---------------------------------------------------------------------------

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    // Temporal Flux: activated within a Null Rod's range, the return will not happen (T-WC.10)
    const flux = s.effects.find((e) => e.source === FX_FLUX && e.operativeId === op.id)
    if (flux && !psychicAllowed(s, op)) flux.data = { ...(flux.data ?? {}), blocked: true }
    if (!hasAbility(s, op, AUTOMATA)) return null
    // RULING: measured once, when the activation starts
    const near = sorcerersOf(s, op.seat).some((so) => so.id !== op.id && within(op, so, 9))
    if (near) return null
    markFired('wcSorcerousAutomata')
    applyAplEffect(ctx, op.id, -1, AUTOMATA)
    return null
  },
  'wc.activation.start',
)

/** The setup spot nearest the Temporal Flux marker that the operative can be placed on, or null. */
function nearestSpot(state: GameState, op: Operative, at: { x: number; z: number }): { x: number; y: number; z: number } | null {
  const r0 = op.baseRadius + 0.45
  for (let r = r0; r <= r0 + 5; r += 0.25) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const pos = { x: Math.round((at.x + Math.sin(a) * r) * 1000) / 1000, y: 0, z: Math.round((at.z + Math.cos(a) * r) * 1000) / 1000 }
      if (!placementProblem(state, { id: op.id, pos, radius: op.baseRadius, height: op.height })) return pos
    }
  }
  return null
}

const MARKER_RADIUS = 0.4

registerHook(
  'activation.end',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    // Psychic Cabal: the borrowed weapon goes back (T-WC.38)
    for (const fx of s.effects.filter((e) => e.source === FX_CABAL_WEAPON && e.operativeId === op.id)) {
      if (fx.data?.pushed === true) op.weapons = op.weapons.filter((w) => w !== fx.data?.weaponId)
    }
    // Temporal Flux: the target's own activation ended (T-WC.10); a counteraction never reaches this hook. Already
    // resolved when Capricious Plan was told to run it first.
    resolveFlux(ctx, op)
    return null
  },
  'wc.activation.end',
)

/** The Temporal Flux effect that targets this operative, or undefined. */
const fluxOn = (state: GameState, op: Operative) => state.effects.find((e) => e.source === FX_FLUX && e.operativeId === op.id)

/** A Temporal Flux that triggers at the end of the operative's current activation (not the one it was placed in). */
const fluxDue = (state: GameState, op: Operative): boolean => {
  const fx = fluxOn(state, op)
  return !!fx && fx.data?.skipCurrent !== true
}

/** Where Temporal Flux would set the operative up right now: a spot, or null when it stays put (T-WC.10). */
function fluxSpot(state: GameState, op: Operative): { x: number; y: number; z: number } | null {
  const fx = fluxOn(state, op)
  const marker = fx ? state.markers.find((m) => m.id === fx.data?.markerId) : undefined
  if (!fx || !marker) return null
  const ok =
    op.status === 'active' &&
    op.wounds > 0 &&
    Math.hypot(op.pos.x - marker.pos.x, op.pos.z - marker.pos.z) + op.baseRadius <= 6 + MARKER_RADIUS + EPS &&
    psychicAllowed(state, op) &&
    fx.data?.blocked !== true
  // RULING: no set-up when the operative is in a Null Rod's range; the marker is then just removed
  return ok ? nearestSpot(state, op, marker.pos) : null
}

/** Temporal Flux at the end of the target's activation: set it up beside the marker if it qualifies, then the marker goes. */
function resolveFlux(ctx: Ctx, op: Operative): void {
  const s = ctx.state
  const fx = fluxOn(s, op)
  if (!fx) return
  // the activation it was placed in has ended: from now on the next one counts
  if (fx.data?.skipCurrent === true) {
    fx.data = { ...fx.data, skipCurrent: false }
    return
  }
  const marker = s.markers.find((m) => m.id === fx.data?.markerId)
  const spot = fluxSpot(s, op)
  removeEffects(ctx, (e) => e.id === fx.id)
  if (!marker) return
  if (spot) {
    const from = { ...op.pos }
    op.pos = spot
    ctx.emit({ type: 'OperativeMoved', operativeId: op.id, action: 'forced', from, to: spot, segments: [{ from, to: spot, length: Math.hypot(spot.x - from.x, spot.z - from.z), cost: 0, kind: 'fly' }], cost: 0, maxInches: 0 })
    markFired('temporalFlux')
  }
  removeMarker(ctx, marker.id, 'temporal flux')
}

// the marker goes with its target (an incapacitated operative has no next activation)
registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s || !c.operativeId) return null
    const fx = s.effects.find((e) => e.source === FX_FLUX && e.operativeId === c.operativeId)
    if (!fx) return null
    const markerId = String(fx.data?.markerId)
    removeEffects(ctx, (e) => e.id === fx.id)
    removeMarker(ctx, markerId, 'temporal flux target incapacitated')
    return null
  },
  'wc.operative.incapacitated',
)

// ---------------------------------------------------------------------------
// Spending ledgers after an action: Relic Hunters, Mutant Appendage, Immaterial Flight
// ---------------------------------------------------------------------------

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isWc(s, op)) return null
    const d = c.data as unknown as ActionEndedData
    const act = baseActivation(s)
    if (isMarkerAction(s, d.action)) {
      // Relic Hunters was spent the moment it applied (the cost was lower); a counteraction never uses it
      if (relicApplies(s, op) && !d.counteract) {
        markUsedBattle(s, op.seat, L_RELIC)
        markFired('relicHunters')
      }
      if (hasBoon(op, 'MUTANT APPENDAGE') && !d.counteract && act && act.operativeId === op.id && !opEffect(s, FX_APPENDAGE, op.id)) {
        addEffect(ctx, { source: FX_APPENDAGE, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation' })
        markFired('boonsOfTzeentch')
      }
    }
    if ((d.action === 'charge' || d.action === 'reposition') && hasBoon(op, 'IMMATERIAL FLIGHT')) {
      const flew = ctx.events.some((e) => e.type === 'OperativeMoved' && e.operativeId === op.id && e.segments.some((sg) => sg.kind === 'fly'))
      if (flew) {
        markUsedTp(s, op.seat, flightKey(op.id))
        markFired('boonsOfTzeentch')
      }
    }
    return null
  },
  'wc.action.ended',
)

// the used-weapon ledger Psychic Cabal reads (T-WC.38)
registerHook(
  'afterShootResolved',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const weaponId = (c.data as { weaponId?: string | null } | undefined)?.weaponId
    if (!s || !op || !weaponId || !isWc(s, op)) return null
    markUsedTp(s, op.seat, usedKey(op.id, weaponId))
    return null
  },
  'wc.afterShootResolved',
)

// ---------------------------------------------------------------------------
// Tokens that act on dice: Protected by Fate (defence), Ravage Destiny (forced re-roll), Mindburn (Hit)
// ---------------------------------------------------------------------------

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !hasToken(s, op.id, T_PROTECTED) || !psychicAllowed(s, op)) return null
    const data = c.data as { rerolls: RerollGrant[] }
    if (!data.rerolls.some((r) => r.id === T_PROTECTED)) data.rerolls.push({ id: T_PROTECTED, source: AC_PROTECTED, mode: 'any', used: false })
    markFired('protectedByFate')
    return null
  },
  'wc.modifyDefenceDice',
)

registerHook(
  'diceRolled',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !hasToken(s, op.id, T_RAVAGED) || !psychicAllowed(s, op)) return null
    const data = c.data as unknown as DiceRolledData
    // shooting, fighting or retaliating: the holder's attack dice (a Shoot's defence dice are not)
    if (data.kind === 'shoot' && data.side !== 'attack') return null
    const side = data.diceSide as DiceSide
    const sixes = eligibleDice(side).filter((i) => side.dice[i]!.value === 6)
    if (sixes.length === 0) return null
    markFired('ravageDestiny')
    forcedReroll(ctx, side, sixes, AC_RAVAGE, data.side, data.kind)
    return null
  },
  'wc.diceRolled',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; atk: number; hitDelta: number }
    // Mindburn: a friendly operative using the weapon again takes every Mindburn token of its seat off (T-WC.11)
    if (c.engine && data.kind === 'shoot' && c.weaponId === MINDBURN_W && isWc(s, op)) {
      removeTokensWhere(c.engine, (t) => t.kind === T_MINDBURN && t.owner === op.seat, 'wc.mindburn.reused')
    }
    // the holder's weapons are 1 worse; never on top of the injured penalty
    if (hasToken(s, op.id, T_MINDBURN) && psychicAllowed(s, op)) {
      const injured = hasInjuredPenalty(op) || providerAny(s, op, 'injuredEquivalent')
      if (!injured) {
        data.hitDelta += 1
        markFired('wcMindburn')
      }
    }
    // Daemonmaw Weapons: Rubric Marine melee weapons get +1 Atk (T-WC.41)
    if (data.kind === 'fight' && isWc(s, op) && hasKeyword(s, op, 'RUBRIC MARINE') && equipped(s, op.seat, DAEMONMAW) && s.data.weapons[c.weaponId]?.type === 'melee') {
      data.atk += 1
      markFired('daemonmawWeapons')
    }
    return null
  },
  'wc.modifyAttackDice',
)

// Warp Swell (T-WC.25)
registerHook(
  'modifyDamage',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isWc(s, op) || !hasBoon(op, 'WARP SWELL')) return null
    const data = c.data as { weaponId: string; dmg: { normal: number; crit: number } }
    if (s.data.weapons[data.weaponId]?.type !== 'melee') return null
    data.dmg.normal += 1
    markFired('boonsOfTzeentch')
    return null
  },
  'wc.modifyDamage',
)

// Incorporeal Sight: enemies cannot be obscured while it shoots (T-WC.22)
registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !shooter || !isWc(s, shooter) || !hasBoon(shooter, 'INCORPOREAL SIGHT')) return null
    const data = c.data as { obscured: boolean }
    if (data.obscured) {
      data.obscured = false
      markFired('boonsOfTzeentch')
    }
    return null
  },
  'wc.target.status',
)

// ---------------------------------------------------------------------------
// Weapon rules: boons, Slow and Purposeful, Alight, ploys, equipment
// ---------------------------------------------------------------------------

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const w = s.data.weapons[c.weaponId]
    if (!w) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const wc = isWc(s, op)
    const psychicOk = psychicAllowed(s, op)
    const attack = s.attack
    if (wc) {
      const ranged = w.type === 'ranged'
      const psychicW = isPsychicWeapon(s, c.weaponId)
      // Incorporeal Sight (T-WC.22)
      if (ranged && data.kind === 'shoot' && hasBoon(op, 'INCORPOREAL SIGHT') && !has(rules, 'saturate')) {
        rules.push({ rule: 'saturate' })
        markFired('boonsOfTzeentch')
      }
      // Twist of Fate (T-WC.28)
      if (ranged && psychicW && psychicOk && hasBoon(op, 'TWIST OF FATE') && !rules.some((r) => keyOf(r) === 'piercing' && r.crits)) {
        rules.push({ rule: 'piercing', x: 1, crits: true })
        markFired('boonsOfTzeentch')
      }
      // Astral Bombardment (T-WC.29)
      if (ranged && psychicW && psychicOk && data.kind === 'shoot' && bombardWeapon(s, op) === c.weaponId) {
        if (c.weaponId === DOOMBOLT_W) {
          const i = rules.findIndex((r) => keyOf(r) === 'devastating')
          if (i >= 0) rules[i] = { ...rules[i]!, inches: 2 }
          else rules.push({ rule: 'devastating', x: 2, inches: 2 })
          markFired('boonsOfTzeentch')
        } else if (c.weaponId === FLUXBLAST_W) {
          rules.push({ rule: 'devastating', x: 1 })
          markFired('boonsOfTzeentch')
        } else if (opEffect(s, FX_ASTRAL, op.id)) {
          // the per-Shoot choice: Devastating 1 instead of Seek Light
          for (let i = rules.length - 1; i >= 0; i--) if (keyOf(rules[i]!) === 'seeklight') rules.splice(i, 1)
          rules.push({ rule: 'devastating', x: 1 })
          markFired('boonsOfTzeentch')
        }
      }
      // Slow and Purposeful (T-WC.15): Ceaseless unless it Charged or Repositioned this activation, always when counteracting
      if (ranged && data.kind === 'shoot' && hasAbility(s, op, SLOW) && !has(rules, 'ceaseless')) {
        const act = baseActivation(s)
        const counter = !!act && act.counteract
        const moved = !!act && act.operativeId === op.id && (act.performed.includes('charge') || act.performed.includes('reposition'))
        if (counter || !moved) {
          rules.push({ rule: 'ceaseless' })
          markFired('slowAndPurposeful')
        }
      }
      // Brotherhood of Sorcerers (T-WC.34)
      if (psychicW && psychicOk && hasKeyword(s, op, 'SORCERER') && ployActive(s, op.seat, BROTHERHOOD)) {
        const near = sorcerersOf(s, op.seat).some((o) => o.id !== op.id && within(op, o, 9))
        if (near) {
          if (!has(rules, 'ceaseless')) rules.push({ rule: 'ceaseless' })
        } else if (!has(rules, 'balanced')) rules.push({ rule: 'balanced' })
        markFired('wcFlagPloy')
      }
      // Savage Herd (T-WC.35)
      if (w.type === 'melee' && hasKeyword(s, op, 'TZAANGOR') && ployActive(s, op.seat, HERD)) {
        rules.push({ rule: 'accurate', x: 1 })
        let severe = false
        if (target && data.kind === 'fight') {
          const assisted = assistersOf(s, op, target).length > 0
          const fighting = !attack || attack.kind !== 'fight' || attack.operativeId === op.id
          // "visible to ... a Sorcerer": the Sorcerer's line to the Tzaangor, not the other way round
          const sorcerer = fighting && sorcerersOf(s, op.seat).some((so) => within(op, so, 6) && sees(s, so, op))
          severe = assisted || sorcerer
        }
        if (severe && !has(rules, 'severe')) rules.push({ rule: 'severe' })
        markFired('wcFlagPloy')
      }
      // Alight (T-WC.12): friendly operatives against an Alight token holder
      if (target && target.seat !== op.seat && hasToken(s, target.id, T_ALIGHT, op.seat) && psychicOk && psychicAllowed(s, target) && !has(rules, 'ceaseless')) {
        rules.push({ rule: 'ceaseless' })
        markFired('alight')
      }
      // Daemonmaw Weapons: Accurate 1 while retaliating (T-WC.41)
      if (w.type === 'melee' && hasKeyword(s, op, 'RUBRIC MARINE') && equipped(s, op.seat, DAEMONMAW) && data.kind === 'fight' && attack && attack.kind === 'fight' && attack.operativeId !== op.id) {
        rules.push({ rule: 'accurate', x: 1 })
        markFired('daemonmawWeapons')
      }
    }
    // Aetherial Warding (T-WC.32): Piercing 1 becomes Piercing Crits 1 against a friendly Warpcoven operative
    if (data.kind === 'shoot' && target && target.seat !== op.seat && isWc(s, target) && ployActive(s, target.seat, WARDING)) {
      for (const r of rules) if (keyOf(r) === 'piercing' && !r.crits && (r.x ?? 1) === 1) {
        r.crits = true
        markFired('wcFlagPloy')
      }
    }
    return null
  },
  'wc.modifyWeaponRules',
)

// the dice a rule set aside stay as they were set (Fate Itself): other rules cannot reclassify them (T-WC.33)
registerHook(
  'afterAttackRoll',
  (c) => {
    const data = c.data as unknown as AfterRollData | undefined
    if (!data || data.query) return null
    if (!data.dice.some((d) => d.tag === FATE_TAG)) return null
    // a Severe conversion looks for the first normal: keep the reserved die behind the rolled ones
    const keep = data.dice.filter((d) => d.tag !== FATE_TAG)
    const fate = data.dice.filter((d) => d.tag === FATE_TAG)
    data.dice.splice(0, data.dice.length, ...keep, ...fate)
    return null
  },
  'wc.afterAttackRoll',
)

// ---------------------------------------------------------------------------
// Damage: Herd Banner, All Is Dust, Arcane Robes (taken); Mindburn (dealt)
// ---------------------------------------------------------------------------

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isWc(s, op)) return null
    const d = c.data as { source: string; amount: number; attackerId: string; weaponId: string | null }
    if (!DICE_SOURCES.includes(d.source) || d.amount <= 0) return null
    const normal = d.source === 'normal' || d.source === 'strike-normal'
    const crit = d.source === 'crit' || d.source === 'strike-crit'
    // Herd Banner: Normal Dmg 3 or more is 1 lower for a Tzaangor near the Icon Bearer (T-WC.18)
    if (normal && d.amount >= 3 && isTzaangor(s, op)) {
      const banner = wcOps(s, op.seat).find((b) => hasAbility(s, b, BANNER) && (b.id === op.id || (within(b, op, 3) && sees(s, b, op))))
      if (banner) {
        d.amount -= 1
        markFired('herdBanner')
      }
    }
    // All Is Dust: the first normal success that damages the armed Rubric Marine does 1 (T-WC.36)
    if (normal && d.amount > 1) {
      const fx = opEffect(s, DUST, op.id)
      if (fx && fx.data?.spent !== true) {
        fx.data = { ...(fx.data ?? {}), spent: true }
        d.amount = 1
        markFired('allIsDust')
      }
    }
    // Arcane Robes: once per turning point the first Critical Dmg higher than Normal is Normal (T-WC.42)
    if (crit && hasKeyword(s, op, 'SORCERER') && equipped(s, op.seat, ROBES) && !usedThisTp(s, op.seat, L_ROBES) && d.weaponId) {
      const dmg = weaponDamage(s, d.attackerId, d.weaponId, op.id, d.source === 'crit' ? (s.attack?.kind ?? 'shoot') : 'fight')
      if (dmg.crit > dmg.normal && d.amount > dmg.normal) {
        markUsedTp(s, op.seat, L_ROBES)
        d.amount = dmg.normal
        markFired('arcaneRobes')
      }
    }
    return null
  },
  'wc.onDamageInflicted',
)

// Mindburn (T-WC.11): a damaging crit from the weapon in the Resolve step marks the target
registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !victim) return null
    const d = c.data as unknown as DamageInflictedData
    if (d.source !== 'crit' || d.amount <= 0 || d.woundsAfter <= 0 || !d.weaponId) return null
    const w = s.data.weapons[d.weaponId]
    const attacker = s.operatives[d.attackerId]
    if (!w || !attacker || attacker.seat === victim.seat || !hasRule(w.rules, 'mindburn')) return null
    addToken(ctx, victim.id, { kind: T_MINDBURN, owner: attacker.seat, cap: 1, sourceId: attacker.id, expires: ['holderActivationEnd'] }, 'wc.mindburn')
    markFired('wcMindburn')
    return null
  },
  'wc.damage.inflicted',
)

// ---------------------------------------------------------------------------
// Unique actions (PSYCHIC): Protected by Fate, Ravage Destiny, Reconstitution Ritual, Temporal Flux, Alight; Brayhorn
// ---------------------------------------------------------------------------

function friendlyTargets(state: GameState, op: Operative, inches: number, wounded = false): Operative[] {
  return wcOps(state, op.seat)
    .filter((t) => (t.id === op.id || psychicSelectable(state, t)) && (inches === Infinity || t.id === op.id || within(op, t, inches)) && sees(state, op, t) && (!wounded || t.wounds < t.maxWounds))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

function enemyTargets(state: GameState, op: Operative, inches: number): Operative[] {
  return enemiesOf(state, op)
    .filter((e) => live(e) && psychicSelectable(state, e) && (inches === Infinity || within(op, e, inches)) && visible(state, bodyOf(op), bodyOf(e)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

function targetOf(ctx: Ctx, params: Record<string, unknown>): Operative | undefined {
  const t = ctx.state.operatives[String(params.targetId)]
  return t && live(t) ? t : undefined
}

function used(ctx: Ctx, op: Operative, abilityId: string, detail?: string): void {
  ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId, ...(detail ? { detail } : {}) }, op.seat)
}

registerCodeHook({
  name: 'protectedByFate',
  action: {
    offers: (state, op): OfferSeed[] => friendlyTargets(state, op, Infinity).map((t) => ({ key: t.id, params: { targetId: t.id } })),
    perform(ctx, op, def, params) {
      const t = targetOf(ctx, params)
      if (!t || t.seat !== op.seat) {
        cancelAction(ctx)
        return
      }
      // one live token per seat: a new use anywhere removes the old one
      moveTokenTo(ctx, T_PROTECTED, op.seat, t.id, { cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'wc.protected')
      used(ctx, op, def.id, t.id)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'ravageDestiny',
  action: {
    offers: (state, op): OfferSeed[] => enemyTargets(state, op, reach(op, 9)).map((e) => ({ key: e.id, params: { targetId: e.id } })),
    perform(ctx, op, def, params) {
      const t = targetOf(ctx, params)
      if (!t || t.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      moveTokenTo(ctx, T_RAVAGED, op.seat, t.id, { cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'wc.ravaged')
      used(ctx, op, def.id, t.id)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'alight',
  action: {
    offers: (state, op): OfferSeed[] => enemyTargets(state, op, Infinity).map((e) => ({ key: e.id, params: { targetId: e.id } })),
    perform(ctx, op, def, params) {
      const t = targetOf(ctx, params)
      if (!t || t.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      moveTokenTo(ctx, T_ALIGHT, op.seat, t.id, { cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'wc.alight')
      used(ctx, op, def.id, t.id)
      finishAction(ctx)
    },
  },
})

function d3(ctx: Ctx, purpose: string): number {
  const [r] = ctx.roll(purpose, 1)
  return Math.ceil(r! / 2)
}

registerCodeHook({
  name: 'reconstitutionRitual',
  action: {
    offers(state, op): OfferSeed[] {
      if (usedThisTp(state, op.seat, L_RITUAL)) return []
      return friendlyTargets(state, op, reach(op, 6), true).map((t) => ({ key: t.id, params: { targetId: t.id } }))
    },
    perform(ctx, op, def, params) {
      const t = targetOf(ctx, params)
      if (!t || t.seat !== op.seat || usedThisTp(ctx.state, op.seat, L_RITUAL)) {
        cancelAction(ctx)
        return
      }
      markUsedTp(ctx.state, op.seat, L_RITUAL)
      // 2D3
      const heal = d3(ctx, 'wc.ritual') + d3(ctx, 'wc.ritual')
      regainWounds(ctx, t.id, heal, AC_RITUAL)
      used(ctx, op, def.id, t.id)
      finishAction(ctx)
    },
  },
})

/** Spots for the Temporal Flux marker in the control range of the target (it must not overlap bases or terrain). */
function fluxSpots(state: GameState, target: Operative): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (const r of [target.baseRadius + MARKER_RADIUS + 0.1, target.baseRadius + MARKER_RADIUS + 0.5]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const pos = { x: Math.round((target.pos.x + Math.sin(a) * r) * 1000) / 1000, y: 0, z: Math.round((target.pos.z + Math.cos(a) * r) * 1000) / 1000 }
      if (!placementProblem(state, { id: '', pos, radius: MARKER_RADIUS, height: 0.1 })) out.push({ x: pos.x, z: pos.z })
    }
  }
  return out
}

const fluxMarkerDown = (state: GameState, seat: Seat): boolean => state.markers.some((m) => m.equipmentId === FLUX_MARKER && m.owner === seat)

registerCodeHook({
  name: 'temporalFlux',
  action: {
    offers(state, op): OfferSeed[] {
      if (fluxMarkerDown(state, op.seat)) return []
      const out: OfferSeed[] = []
      for (const t of friendlyTargets(state, op, reach(op, 6))) {
        for (const p of fluxSpots(state, t)) out.push({ key: `${t.id}@${p.x},${p.z}`, params: { targetId: t.id, param: `${p.x},${p.z}` } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const t = targetOf(ctx, params)
      const [x, z] = String(params.param ?? '').split(',').map(Number)
      if (!t || t.seat !== op.seat || x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z) || fluxMarkerDown(ctx.state, op.seat)) {
        cancelAction(ctx)
        return
      }
      const marker = { id: newMarkerId(ctx, 'flux'), kind: 'equipment' as const, pos: { x, z }, owner: op.seat, carriedBy: null, controller: null, equipmentId: FLUX_MARKER, placedBy: op.id }
      ctx.state.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: marker.pos }, op.seat)
      // lives until the target's next activation ends (or it is incapacitated); no expiry name touches it. A target
      // that is in its own activation right now (the Tempyrion picking itself) waits for its following one (T-WC.10).
      const act = baseActivation(ctx.state)
      const current = !!act && !act.counteract && (act.operativeId === t.id || act.partner?.operativeId === t.id)
      addEffect(ctx, { source: FX_FLUX, seat: op.seat, kind: 'ployFlag', operativeId: t.id, expires: 'wc.flux', data: { markerId: marker.id, ...(current ? { skipCurrent: true } : {}) } })
      used(ctx, op, def.id, t.id)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'brayhorn',
  action: {
    offers: (): OfferSeed[] => [{ key: '', params: {} }],
    perform(ctx, op, def) {
      addEffect(ctx, { source: FX_BRAYHORN, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'turningPointStart' })
      used(ctx, op, def.id)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'wcFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

/** The reserved dice of the seat's Fate Itself is My Weapon this turning point, or null. */
function fateFx(state: GameState, seat: Seat) {
  const fx = state.effects.find((e) => e.source === FX_FATE && e.seat === seat)
  const dice = fx?.data?.dice
  return fx && Array.isArray(dice) && dice.length > 0 ? { fx, dice: dice as number[] } : null
}

registerCodeHook({
  name: 'fateItselfIsMyWeapon',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      const dice = ctx.roll('wc.fate', 2)
      addEffect(ctx, { source: FX_FATE, seat, kind: 'ployFlag', expires: 'turningPoint', data: { dice, sum: dice[0]! + dice[1]!, spent: [] } })
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id, detail: dice.join(',') }, seat)
    },
  },
})

// ALL IS DUST (T-WC.36): committed once the dice are final, applies to the first normal success that damages the Rubric
registerCodeHook({
  name: 'allIsDust',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const a = state.attack
      const seq = a?.seq
      if (!op || op.seat !== seat || !live(op) || !isWc(state, op) || !hasKeyword(state, op, 'RUBRIC MARINE') || !a || !seq) return []
      if (opEffect(state, DUST, op.id)) return []
      const foeSide = seq.atk.operativeId === op.id ? seq.def : seq.atk
      if (!foeSide || !foeSide.weaponId) return []
      const normals = foeSide.dice.filter((d) => d.kind === 'normal' && !d.used).length
      const dmg = weaponDamage(state, foeSide.operativeId, foeSide.weaponId, op.id, a.kind)
      return normals > 0 && dmg.normal > 1 ? [{ operativeId: op.id }] : []
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (id) addEffect(ctx, { source: DUST, seat, kind: 'ployFlag', operativeId: id, expires: 'action' })
      void ploy
    },
  },
})

// CAPRICIOUS PLAN (T-WC.37): at the end of a Sorcerer's activation, a free Dash and/or an order change. When the
// Sorcerer is the target of a pending Temporal Flux, both trigger at the end of its activation and its player orders
// them (precedence: the active player decides): `flux-dash` / `flux-both` resolve the Flux set-up first, then Dash from
// there; the plain options Dash first and leave the Flux to its activation.end hook.
registerCodeHook({
  name: 'capriciousPlan',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.counteracting || !live(op) || !hasKeyword(state, op, 'SORCERER')) return []
      const out: PloyOfferSeed[] = []
      const dash = canStartFreeAction(state, { operativeId: op.id, action: 'dash', resume: '' })
      if (dash) out.push({ param: 'dash' })
      out.push({ param: 'order' })
      if (dash) out.push({ param: 'both' })
      if (fluxDue(state, op)) {
        // the Dash after the Flux starts where the Flux puts the Sorcerer (checked on a copy)
        const spot = fluxSpot(state, op)
        const there: GameState = spot ? { ...state, operatives: { ...state.operatives, [op.id]: { ...op, pos: spot } } } : state
        if (canStartFreeAction(there, { operativeId: op.id, action: 'dash', resume: '' })) out.push({ param: 'flux-dash' }, { param: 'flux-both' })
      }
      return out
    },
    apply(ctx, _seat, _ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      let mode = seed.param ?? 'dash'
      if (mode.startsWith('flux-')) {
        resolveFlux(ctx, op)
        mode = mode.slice('flux-'.length)
      }
      if (mode === 'order' || mode === 'both') {
        const next = flipped(op.order)
        if (allowedOrders(ctx.state, op).includes(next)) setOrder(ctx, op, next)
      }
      if (mode === 'dash' || mode === 'both') startFreeAction(ctx, { operativeId: op.id, action: 'dash', resume: 'ploy.freeAction' })
    },
  },
})

// PSYCHIC CABAL (T-WC.38): lend a PSYCHIC action or ranged weapon of a Sorcerer within 9" for the activation
registerCodeHook({
  name: 'psychicCabal',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.counteracting || !live(op) || !hasKeyword(state, op, 'SORCERER')) return []
      const out: PloyOfferSeed[] = []
      for (const l of sorcerersOf(state, seat)) {
        if (l.id === op.id || !within(op, l, 9) || !sees(state, op, l) || !psychicSelectable(state, l)) continue
        for (const id of state.data.datacards[l.datacardId]?.uniqueActions ?? []) {
          if ((state.data.abilities[id]?.keywords ?? []).includes('PSYCHIC') && !(state.data.datacards[op.datacardId]?.uniqueActions ?? []).includes(id)) out.push({ param: `${l.id}:a:${id}` })
        }
        for (const w of psychicRanged(state, l)) {
          if (!usedThisTp(state, seat, usedKey(l.id, w)) && !op.weapons.includes(w)) out.push({ param: `${l.id}:w:${w}` })
        }
      }
      return out
    },
    apply(ctx, seat, _ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      const [lenderId, kind, id] = (seed.param ?? '').split(':')
      if (!op || !lenderId || !id) return
      if (kind === 'a') {
        addEffect(ctx, { source: FX_CABAL_ACTION, seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation', data: { actionId: id, lenderId } })
      } else {
        const pushed = !op.weapons.includes(id)
        if (pushed) op.weapons = [...op.weapons, id]
        addEffect(ctx, { source: FX_CABAL_WEAPON, seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation', data: { weaponId: id, lenderId, pushed } })
        addEffect(ctx, { source: FX_CABAL_LENT, seat, kind: 'ployFlag', operativeId: lenderId, expires: 'turningPoint', data: { weaponId: id, borrowerId: op.id } })
      }
      used(ctx, op, A('psychic-cabal'), seed.param)
    },
  },
})

// MUTANT HERD (T-WC.39): two Tzaangors activate together
registerCodeHook({
  name: 'mutantHerd',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const act = state.firefight.activation
      if (!isTzaangor(state, op) || op.seat !== seat || info.counteracting || !live(op) || !act || act.operativeId !== op.id || act.frame || act.partner) return []
      const out: PloyOfferSeed[] = []
      for (const p of wcOps(state, seat)) {
        if (p.id === op.id || !p.ready || !isTzaangor(state, p) || !within(op, p, 2) || !sees(state, op, p)) continue
        for (const order of allowedOrders(state, p)) out.push({ param: `${p.id}:${order}` })
      }
      return out
    },
    apply(ctx, _seat, _ploy, seed) {
      const [partnerId, order] = (seed.param ?? '').split(':')
      if (partnerId) joinActivation(ctx, partnerId, (order as 'engage' | 'conceal' | undefined) ?? 'engage')
    },
  },
})

// ---------------------------------------------------------------------------
// SAVAGE BRUTALITY (T-WC.16): a reaction of the Champion's own seat, right after its first Fight of its own activation
// ---------------------------------------------------------------------------

/** Can the Champion take Savage Brutality's free Fight now (its own activation, after exactly one Fight, not yet used)? */
function brutalityOpen(state: GameState, op: Operative): boolean {
  if (!live(op) || !isWc(state, op) || !hasAbility(state, op, BRUTALITY)) return false
  const act = state.firefight.activation
  if (!act || act.frame || act.counteract || act.operativeId !== op.id) return false
  if (act.performed.filter((p) => p === 'fight').length !== 1 || (act.used ?? []).includes(L_BRUTALITY)) return false
  // the free Fight keeps every other Fight condition (an enemy in control range); it takes precedence over action limits
  return canStartFreeAction(state, { operativeId: op.id, action: 'fight', resume: REACTION_DONE })
}

registerCodeHook({
  name: 'savageBrutality',
  choice(ctx, op) {
    const act = ctx.state.firefight.activation
    if (!act || !brutalityOpen(ctx.state, op)) {
      reactionDone(ctx)
      return
    }
    act.used = [...(act.used ?? []), L_BRUTALITY]
    markFired('savageBrutality')
    used(ctx, op, BRUTALITY)
    if (!startFreeAction(ctx, { operativeId: op.id, action: 'fight', resume: REACTION_DONE })) reactionDone(ctx)
  },
})

// ---------------------------------------------------------------------------
// 0 CP pseudo ploys: Echoes from the Warp, Sorcerous Scrolls, Astral Bombardment's Shoot choice, the reserved dice of
// Fate Itself is My Weapon
// ---------------------------------------------------------------------------

function offer(id: string, name: string, via: string, op: Operative | undefined, param?: string): PloyOffer {
  return { id, ployId: id.split(':')[0]!, name, ...(param ? { param } : {}), ...(op ? { operativeId: op.id } : {}), cost: 0, via, seed: param ? { param } : {} }
}

/** Distinct (reserved slot, side, die value) triples Fate Itself can replace right now. */
function fateChoices(state: GameState, seat: Seat): { slot: number; side: 'a' | 'd'; value: number }[] {
  const f = fateFx(state, seat)
  const seq = state.attack?.seq
  if (!f || !seq) return []
  const out: { slot: number; side: 'a' | 'd'; value: number }[] = []
  const seen = new Set<number>()
  f.dice.forEach((v, slot) => {
    if (seen.has(v)) return
    seen.add(v)
    for (const [side, dice] of [['a', seq.atk.dice], ['d', seq.def?.dice ?? []]] as const) {
      const values = new Set<number>()
      for (const d of dice) {
        if (d.value === null || d.used || d.tag === FATE_TAG || d.value === v || values.has(d.value)) continue
        values.add(d.value)
        out.push({ slot, side, value: d.value })
      }
    }
  })
  return out
}

const sequenceKey = (state: GameState): string => {
  const a = state.attack
  return a ? `${a.operativeId}|${a.index}|${a.seq?.targetId ?? ''}|${state.firefight.activation?.declaredSeq ?? 0}` : ''
}

registerPloyRule({
  extraOffers(state, seat, window, info): PloyOffer[] {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    const a = state.attack
    // ---- Fate Itself is My Weapon: the reserved dice replace an attack die before re-rolls (T-WC.33): the shooter's own
    // dice in its window, the opponent's Shoot dice in the defender's window on the fresh roll, both sides' in a fight
    if ((window === 'shoot.beforeAttackRerolls' || window === 'shoot.defenderAttackRolled' || window === 'fight.beforeRerolls') && a?.seq) {
      const f = fateFx(state, seat)
      if (f && !((f.fx.data?.spent as string[] | undefined) ?? []).includes(sequenceKey(state))) {
        for (const c of fateChoices(state, seat)) {
          const v = f.dice[c.slot]!
          const who = c.side === 'a' ? 'the attacker' : 'the retaliator'
          out.push(offer(`${FATE_RESERVE}:${c.slot}:${c.side}:${c.value}`, `Fate: ${v} replaces a ${c.value} rolled by ${who}`, 'wc.fate', subject, `${c.slot}:${c.side}:${c.value}`))
        }
      }
    }
    if (!subject || subject.seat !== seat || !live(subject) || !isWc(state, subject)) return out
    // ---- Echoes from the Warp and Sorcerous Scrolls at the start of an activation or counteraction
    if (window === 'firefight.activationStart') {
      const act = state.firefight.activation
      if (hasKeyword(state, subject, 'SORCERER') && equipped(state, seat, SCROLLS) && !usedThisBattle(state, seat, L_SCROLLS)) {
        for (const b of pickAlternatives(state, subject, BOON)) out.push(offer(`${SCROLLS}:${b}`, `Sorcerous Scrolls: ${b}`, 'wc.scrolls', subject, b))
      }
      if (info.counteracting && hasBoon(subject, 'ECHOES FROM THE WARP') && !usedThisBattle(state, seat, L_ECHOES) && act && act.counteract && act.operativeId === subject.id) {
        out.push(offer(`${B_ECHOES}:keep`, 'Echoes from the Warp: one more free action', 'wc.echoes', subject, 'keep'))
        if (allowedOrders(state, subject).includes(flipped(subject.order))) out.push(offer(`${B_ECHOES}:flip`, `Echoes from the Warp: switch to ${flipped(subject.order)} and one more free action`, 'wc.echoes', subject, 'flip'))
      }
    }
    // ---- Astral Bombardment: the Warpfire's per-Shoot choice, made when the Shoot is declared (T-WC.29)
    if (window === 'firefight.actionDeclared' && info.action === 'shoot' && subject.id === info.subjectId) {
      const w = bombardWeapon(state, subject)
      if ((w === FIRESTORM_W || w === MINDBURN_W) && !opEffect(state, FX_ASTRAL, subject.id)) {
        out.push(offer(`${B_ASTRAL}:devastating`, 'Astral Bombardment: Devastating 1 this Shoot instead of Seek Light', 'wc.astral', subject, 'devastating'))
      }
    }
    return out
  },
  onUsed(ctx, seat, o, info) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    switch (o.via) {
      case 'wc.fate': {
        const f = fateFx(s, seat)
        const seq = s.attack?.seq
        const [slotS, side, valueS] = (o.param ?? '').split(':')
        if (!f || !seq) break
        const slot = Number(slotS)
        const value = Number(valueS)
        const v = f.dice[slot]
        const dside = side === 'a' ? seq.atk : seq.def
        const i = dside ? dside.dice.findIndex((d) => d.value === value && !d.used && d.tag !== FATE_TAG) : -1
        if (v === undefined || !dside || i < 0) break
        const before = dside.dice[i]!.value
        const die = dside.dice[i]!
        die.value = v
        die.kind = kindOf(v, dside.need, dside.lethal)
        // it can be neither changed nor re-rolled nor retained as a success it does not show
        die.rerolled = true
        die.tag = FATE_TAG
        ctx.emit({ type: 'DiceRerolled', side: side === 'a' ? 'attack' : 'defence', operativeId: dside.operativeId, source: FATE, indexes: [i], before: [before], after: [v] }, seat)
        const sum = Number(f.fx.data?.sum ?? 0)
        f.dice.splice(slot, 1)
        // the pair under 9: the other die goes after the first use
        if (sum < 9) f.dice.length = 0
        f.fx.data = { ...(f.fx.data ?? {}), dice: f.dice, spent: [...(((f.fx.data?.spent as string[] | undefined) ?? [])), sequenceKey(s)] }
        markFired('fateItselfIsMyWeapon')
        break
      }
      case 'wc.echoes': {
        const act = s.firefight.activation
        if (!op || !act) break
        markUsedBattle(s, seat, L_ECHOES)
        if (o.param === 'flip') setOrder(ctx, op, flipped(op.order))
        act.bonus = (act.bonus ?? 0) + 1
        act.used = [...(act.used ?? []), 'wrath', ECHOES_USED]
        markFired('boonsOfTzeentch')
        used(ctx, op, B_ECHOES, o.param)
        break
      }
      case 'wc.scrolls': {
        if (!op || !o.param) break
        markUsedBattle(s, seat, L_SCROLLS)
        setOperativePick(ctx, op.id, BOON, o.param, SCROLLS)
        markFired('sorcerousScrolls')
        used(ctx, op, SCROLLS, o.param)
        break
      }
      case 'wc.astral': {
        if (!op) break
        addEffect(ctx, { source: FX_ASTRAL, seat, kind: 'ployFlag', operativeId: op.id, expires: 'action' })
        markFired('boonsOfTzeentch')
        used(ctx, op, B_ASTRAL, 'devastating')
        break
      }
      default:
        break
    }
    void info
  },
})

