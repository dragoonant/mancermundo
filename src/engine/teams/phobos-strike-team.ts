// Phobos Strike Team (docs/spec/13-teams.md section 13, rule ids T-PH.n): the code hooks this team's data names, its
// team rule provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rule
// (ploy-rules.ts registerPloyRule). Everything is built on the M9 generic layer; no shared engine file names this team.
//
// Map of the rules to the code below:
//  - ASTARTES (T-PH.25, 5): provider maxRepeats / counteract and the beforeShootTargetSelect bolt check.
//  - MULTI-SPECTRUM ARRAY (26) and AUSPEX SCAN (17): target.status, modifyWeaponRules (Seek Light), beforeShootTargetSelect.
//  - TERROR (24) and Vanguard (18): providers actionCostDelta / controlTotal; the action.declared ledger for Vanguard.
//  - Tactical Advantage (7, 8): providers initiativeReroll / onInitiativeReroll, commandRerollCost / onCommandReroll
//    (a 0 CP Command Re-roll on the Sergeant's dice) and the ploy rule costAdjust.
//  - Strategic Oversight (9), Plant Explosives (13), Haywire Mine (20): the turningPoint.start hook; the markers are
//    team markers created already carried (ensureMarkers); provider placeMarkerProblem keeps the Haywire Mine out of
//    enemy control range. Detonate (14): providers fixedTargets / weaponForbidden.
//  - Medic! (11): the qualifying moment is noted in beforeIncapacitated; the removal then waits in the queue (provider
//    pausableRemoval) for the player's save or decline (attack-common saveFromRemoval / continueRemovals).
//  - Proximity Mine (21): the action.ended scan of the step's OperativeMoved segments.
//  - Comms Array (10), Medic!'s free Dash (11), Plant Explosives' free Dash (13), Special Issue Ammunition (38),
//    Purity Seals (35): 0 CP offers in the ploy rule's extraOffers / onUsed.
//  - Omni-Scrambler (23): a strategic gambit ploy record; providers canActivate / counteract / actionForbidden.
//  - Ploys (27 to 34): strategy flags read by the providers and hooks, and firefight ploys with their own code hooks.
import { refreshFlags } from '../abilities'
import { applyAplEffect, continueRemovals, hasRule, ruleKey, ruleSetFor, saveFromRemoval, targetInfo } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { codeParams, hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, directDamage, gainCp, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { cancelAction, finishAction, raiseAction, REACTION_DONE, reactionDone, skipActivation, startFreeAction } from '../firefight'
import { registerFrameResume, registerHook, type ActionDeclaredData, type HookContext } from '../hooks'
import { bodyOf, targetVerdict, visible } from '../los'
import { dropCarried, newMarkerId, removeMarker } from '../markers'
import { distanceBetween, enemiesInControlRange, gapToMarker, inControlRange, isWithin, markerBody, markerInControlRange } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { markerControl } from '../query'
import { continueWindow } from '../ploys'
import type { Ctx } from '../registry'
import { activeOps, enemiesOf, otherSeat, SEATS } from '../state'
import { terrainOf, walkableSolidAt } from '../terrain'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, removeToken, tokensOn } from '../tokens'
import type { Activation, AttackDie, GameState, Marker, Operative, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'phobos-strike-team'

const PH = 'PHOBOS STRIKE TEAM'
const EPS = 1e-6

const A = (id: string) => `ph.a.${id}`
const P = (id: string) => `ph.p.${id}`
const E = (id: string) => `ph.e.${id}`
const W = (id: string) => `ph.w.${id}`

export const ID = {
  tactical: A('tactical-advantage'),
  oversight: A('strategic-oversight'),
  comms: A('comms-array'),
  medic: A('medic'),
  gauntlet: A('helix-gauntlet'),
  plant: A('plant-explosives'),
  voxbreak: A('voxbreak'),
  auspex: A('auspex-scan'),
  vanguard: A('vanguard'),
  track: A('track-target'),
  haywire: A('haywire-mine'),
  proximity: A('proximity-mine'),
  chute: A('grav-chute'),
  guerrillaAction: A('guerrilla-warfare'),
  guerrilla: P('guerrilla-warfare'),
  noFear: P('and-they-shall-know-no-fear'),
  deadly: P('deadly-shots'),
  lethal: P('lethal-assaults'),
  patient: P('patient-ambush'),
  critical: P('critical-shot'),
  transhuman: P('transhuman-physiology'),
  stealth: P('stealth-assault'),
  omni: P('omni-scrambler'),
  purity: E('purity-seals'),
  grenades: E('additional-utility-grenades'),
  ammo: E('special-issue-ammunition'),
  detonator: W('remote-detonator'),
  customCarbine: W('custom-bolt-carbine'),
} as const

/** The four strategy ploys Comms Array can swap (the Omni-Scrambler gambit is not one of them). */
const STRATEGY_PLOYS = [ID.guerrilla, ID.noFear, ID.deadly, ID.lethal]

/** Special Issue Ammunition names three carbines in full (T-PH.38). */
const AMMO_WEAPONS = [W('bolt-carbine'), W('marksman-bolt-carbine'), W('occulus-bolt-carbine')]

export const EXPLOSIVES = 'ph.explosives'
export const HAYWIRE = 'ph.haywire-mine'

const TA_INIT = 'ph.ta.initiative'
const TA_PLOY = 'ph.ta.ploy'
const COMMS_TP = 'ph.comms'
const VANGUARD_TP = 'ph.vanguard'
const PURITY_TP = 'ph.purity'
const AMMO_TP = 'ph.ammo'
const AUSPEX_TOKEN = 'ph.auspex'
const OMNI_TOKEN = 'ph.omni'

const CUSTOM_RULES: Record<string, WeaponRuleRef> = {
  BALANCED: { rule: 'balanced' },
  'LETHAL 5': { rule: 'lethal', target: 5 },
  'PIERCING CRITS 1': { rule: 'piercing', x: 1, crits: true },
  RENDING: { rule: 'rending' },
  SATURATE: { rule: 'saturate' },
}

// Passive rules register their name so the data may reference them; the handlers below mark them fired where they bite.
for (const name of [
  'phAstartes',
  'phMultiSpectrum',
  'phTerror',
  'phTacticalAdvantage',
  'phStrategicOversight',
  'phCommsArray',
  'phPlantExplosives',
  'phDetonate',
  'phCustom',
  'phVoxbreak',
  'phVanguard',
  'phTrackTarget',
  'phHaywireMine',
  'phProximityMine',
  'phGravChute',
  'phPuritySeals',
  'phAdditionalGrenades',
  'phSpecialIssueAmmo',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isPh(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, PH)
}

const live = (o: Operative | undefined): o is Operative => !!o && o.status === 'active' && o.wounds > 0

const gap = (a: Operative, b: Operative): number => distanceBetween(bodyOf(a), bodyOf(b))
const within = (a: Operative, b: Operative, inches: number): boolean => gap(a, b) <= inches + EPS

const d3 = (ctx: Ctx, purpose: string): number => Math.ceil(ctx.roll(purpose, 1)[0]! / 2)

function phOps(s: GameState, seat: Seat): Operative[] {
  return activeOps(s).filter((o) => o.seat === seat && live(o) && isPh(s, o))
}

function equipped(s: GameState, seat: Seat, id: string): boolean {
  return s.players[seat].equipment.includes(id)
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(s: GameState, seat: Seat, ployId: string): boolean {
  return s.effects.some((e) => e.source === ployId && e.seat === seat)
}

function opEffect(s: GameState, source: string, opId: string) {
  return s.effects.find((e) => e.source === source && e.operativeId === opId)
}

function effectFor(s: GameState, kind: string, opId: string) {
  return s.effects.find((e) => e.kind === kind && e.operativeId === opId)
}

function opOfHook(c: HookContext): Operative | undefined {
  return c.state && c.operativeId ? c.state.operatives[c.operativeId] : undefined
}

function weaponOfId(s: GameState, id: string | null | undefined) {
  return id ? s.data.weapons[id] : undefined
}

/** A bolt weapon: any ranged weapon with "bolt" in its name (T-PH.5). */
export function isBolt(s: GameState, weaponId: string | null | undefined): boolean {
  const w = weaponOfId(s, weaponId)
  return !!w && w.type === 'ranged' && /bolt/i.test(w.name)
}

function isMissionAction(s: GameState, actionId: string): boolean {
  if (!actionId.startsWith('ability:')) return false
  const def = s.data.abilities[actionId.slice('ability:'.length)]
  return !!def && (def.keywords ?? []).includes('MISSION')
}

/** Pick Up Marker and mission actions: what Terror and Vanguard touch. */
function isMarkerOrMission(s: GameState, actionId: string): boolean {
  return actionId === 'marker:pickUp' || isMissionAction(s, actionId)
}

/** The activation an action belongs to: a frame's owner activation for a free action. */
function baseActivation(s: GameState): Activation | null {
  const act = s.firefight.activation
  if (!act) return null
  return act.frame ? ((s.firefight.stack ?? []).at(-1) ?? null) : act
}

/** Every action the operative has performed in the activations or frames now open for it. */
function performedOf(s: GameState, op: Operative): string[] {
  const out: string[] = []
  const cur = s.firefight.activation
  if (cur && cur.operativeId === op.id) out.push(...cur.performed)
  for (const a of s.firefight.stack ?? []) if (a && a.operativeId === op.id) out.push(...a.performed)
  return out
}

/** The open activation (or frame) the operative is acting in. */
function actOf(s: GameState, op: Operative): Activation | null {
  const cur = s.firefight.activation
  return cur && cur.operativeId === op.id ? cur : null
}

function setOrder(ctx: Ctx, op: Operative, order: 'engage' | 'conceal', clearGuard = true): void {
  if (op.order === order) return
  if (clearGuard && op.flags.guard) {
    op.flags.guard = false
    ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'order' }, op.seat)
  }
  op.order = order
  ctx.emit({ type: 'OrderSet', operativeId: op.id, order })
}

function sideOf(s: GameState, opId: string) {
  const seq = s.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

function liveFails(dice: AttackDie[]): AttackDie[] {
  return dice.filter((d) => d.kind === 'fail' && d.value !== null && !d.used && !d.tag)
}

/**
 * "Subtract 1 from its APL until the end of its next activation" (Medic!, Proximity Mine). Timed APL effects end with
 * the operative's activation, so an operative hit in the middle of its own activation (not a counteraction) would lose
 * nothing: its penalty is held over and applied when its next activation starts (the activation.start hook below).
 */
function aplUntilNextActivationEnd(ctx: Ctx, opId: string, source: string): void {
  const base = baseActivation(ctx.state)
  const op = ctx.state.operatives[opId]
  if (!op) return
  if (base && base.operativeId === opId && !base.counteract) {
    addEffect(ctx, { source, seat: op.seat, kind: 'ph.aplNext', operativeId: opId, expires: 'ph.aplNext', data: { source } })
  } else applyAplEffect(ctx, opId, -1, source)
}

function leaderOf(s: GameState, seat: Seat): Operative | undefined {
  return phOps(s, seat).find((o) => hasAbility(s, o, ID.tactical))
}

/** The Explosives marker of the seat while it is in the killzone (placed, not carried). */
export function explosivesMarker(s: GameState, seat: Seat): Marker | undefined {
  return s.markers.find((m) => m.equipmentId === EXPLOSIVES && m.owner === seat && !m.carriedBy)
}

function mineMarkers(s: GameState): Marker[] {
  return s.markers.filter((m) => m.equipmentId === HAYWIRE && !m.carriedBy)
}

/**
 * The heights of the separate climbs of a move path (start, then the end of every increment), grouped the way the
 * movement code groups them: consecutive rising increments onto non-Insignificant terrain are one climb; anything else
 * ends it. Climbs onto Insignificant terrain cost nothing and are skipped.
 */
function climbRuns(s: GameState, start: Vec3, points: Vec3[]): number[] {
  const idx = terrainOf(s.map)
  const out: number[] = []
  let run = 0
  let prev = start
  for (const p of points) {
    const rise = p.y - prev.y
    const climb = rise > 0.001 && walkableSolidAt(idx, p, p.y)?.insignificant !== true
    if (climb) run += rise
    else if (run > 0) {
      out.push(run)
      run = 0
    }
    prev = p
  }
  if (run > 0) out.push(run)
  return out
}

function nearestRival(s: GameState, op: Operative, others: Operative[]): number {
  let best = Infinity
  for (const o of others) best = Math.min(best, gap(op, o))
  return best
}

// ---------------------------------------------------------------------------
// Team markers: Explosives and Haywire Mine, created already carried (T-PH.13, T-PH.20)
// ---------------------------------------------------------------------------

/**
 * The Saboteur and the Minelayer start the battle carrying their marker. Created once per seat at the first Ready step
 * (everything is deployed by then). `force` makes a test recreate it after the fixture stripped the markers.
 */
export function ensureMarkers(ctx: Ctx, force = false): void {
  const s = ctx.state
  for (const op of Object.values(s.operatives)) {
    if (op.status !== 'active' || !isPh(s, op)) continue
    for (const [abilityId, equipmentId] of [
      [ID.plant, EXPLOSIVES],
      [ID.haywire, HAYWIRE],
    ] as const) {
      if (!hasAbility(s, op, abilityId)) continue
      const key = `ph.marker:${equipmentId}:${op.id}`
      if (!force && usedThisBattle(s, op.seat, key)) continue
      markUsedBattle(s, op.seat, key)
      // a carry flag pointing at a marker that is gone (a fixture stripped the markers) counts as carrying nothing
      if (op.flags.carrying && s.markers.some((m) => m.id === op.flags.carrying)) continue
      const marker: Marker = {
        id: newMarkerId(ctx, 'ph'),
        kind: 'equipment',
        pos: { x: op.pos.x, z: op.pos.z },
        owner: op.seat,
        carriedBy: op.id,
        controller: op.seat,
        equipmentId,
        pickable: true,
        placedBy: op.id,
      }
      s.markers.push(marker)
      op.flags.carrying = marker.id
      markFired(equipmentId === EXPLOSIVES ? 'phPlantExplosives' : 'phHaywireMine')
    }
  }
}

/** Place Marker cannot put the Haywire Mine here: within an enemy operative's control range (T-PH.20). */
function haywireProblem(s: GameState, op: Operative, marker: Marker, pos: Vec2): string | null {
  const probe: Marker = { ...marker, carriedBy: null, pos: { x: pos.x, z: pos.z } }
  const foe = enemiesOf(s, op).find((e) => live(e) && markerInControlRange(s, bodyOf(e), probe))
  return foe ? `the Haywire Mine cannot be placed within ${foe.name}'s control range` : null
}

/** Legal spots (outside every enemy control range) within the Minelayer's control range, best first. */
function mineSpots(s: GameState, op: Operative, marker: Marker): { x: number; z: number; clear: number }[] {
  const enemies = enemiesOf(s, op).filter((e) => live(e))
  const out: { x: number; z: number; clear: number }[] = []
  const ring = op.baseRadius + 0.9
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const p = { x: Math.round((op.pos.x + Math.sin(a) * ring) * 1000) / 1000, z: Math.round((op.pos.z + Math.cos(a) * ring) * 1000) / 1000 }
    if (Math.abs(p.x) > s.map.size.x / 2 || Math.abs(p.z) > s.map.size.z / 2) continue
    if (haywireProblem(s, op, marker, p)) continue
    let clear = Infinity
    for (const e of enemies) clear = Math.min(clear, gapToMarker(bodyOf(e), { kind: 'equipment', pos: p }))
    out.push({ ...p, clear })
  }
  return out.sort((x, y) => y.clear - x.clear)
}

// ---------------------------------------------------------------------------
// Omni-Scrambler (T-PH.23)
// ---------------------------------------------------------------------------

/** Is this enemy operative barred by an Omni-Scrambler now? (Firefight phase only; never the last one left.) */
function omniBarred(s: GameState, op: Operative): boolean {
  if (s.phase !== 'firefight' || op.status !== 'active') return false
  const fx = s.effects.find((e) => e.kind === 'ph.omni' && e.operativeId === op.id && e.seat !== op.seat)
  if (!fx) return false
  const seen = Number(fx.data?.seen ?? 0)
  const need = Number(fx.data?.need ?? 0)
  if (seen >= need) return false
  // "or it is the last enemy operative still to be activated": another ready operative of the same side exists
  return Object.values(s.operatives).some((o) => o.seat === op.seat && o.id !== op.id && o.status === 'active' && o.ready && o.wounds > 0)
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  // ASTARTES (T-PH.25)
  maxRepeats(state, op, actionId, performed) {
    if (!isPh(state, op) || (actionId !== 'shoot' && actionId !== 'fight')) return null
    const count = (a: string) => performed.filter((p) => p === a).length
    if (actionId === 'shoot') {
      if (count('fight') >= 2) return 1
      if (!op.weapons.some((w) => isBolt(state, w))) return 1
      if (count('shoot') >= 1) markFired('phAstartes')
      return 2
    }
    if (count('shoot') >= 2) return 1
    if (count('fight') >= 1) markFired('phAstartes')
    return 2
  },
  counteract(state, op) {
    // an Omni-Scrambled enemy cannot even counteract
    if (omniBarred(state, op)) return 'never'
    return isPh(state, op) ? 'any' : null
  },

  // AND THEY SHALL KNOW NO FEAR (T-PH.28)
  flags(state, op) {
    if (isPh(state, op) && ployActive(state, op.seat, ID.noFear)) return { ignoreInjured: true }
    return null
  },

  // Track Target (T-PH.19)
  guardUnderConceal(state, op) {
    return isPh(state, op) && hasAbility(state, op, ID.track)
  },
  // ... and the interrupt it then takes is a Shoot like any other: on Guard, outside its own activation or inside the interrupt
  shootUnderConceal(state, op) {
    if (!isPh(state, op) || !hasAbility(state, op, ID.track) || !op.flags.guard) return false
    const act = state.firefight.activation
    return !act || act.operativeId !== op.id || act.frame?.kind === 'interrupt'
  },

  actionForbidden(state, op, actionId) {
    // Omni-Scrambler: nothing at all while the ban holds (T-PH.23)
    if (omniBarred(state, op)) return `${op.name} is jammed by the Omni-Scrambler`
    // team markers: only their carrier may pick them up (T-PH.13, T-PH.20)
    if (actionId === 'marker:pickUp') {
      const near = state.markers.filter((m) => (m.equipmentId === EXPLOSIVES || m.equipmentId === HAYWIRE) && !m.carriedBy && markerControl(state, m).contesting[op.seat].includes(op.id))
      if (near.length > 0 && !near.some((m) => m.owner === op.seat && hasAbility(state, op, m.equipmentId === EXPLOSIVES ? ID.plant : ID.haywire))) {
        return `${op.name} cannot pick up that marker`
      }
    }
    return null
  },

  // Haywire Mine: Place Marker never puts it within an enemy operative's control range (T-PH.20)
  placeMarkerProblem(state, op, marker, pos) {
    return marker.equipmentId === HAYWIRE ? haywireProblem(state, op, marker, pos) : null
  },

  // Medic!: a casualty it may save waits in the removal queue, where the player is asked (T-PH.11)
  pausableRemoval(state, op) {
    return !!effectFor(state, 'ph.medicAsk', op.id)
  },

  // Tactical Advantage: once per battle a Command Re-roll on the Sergeant's own dice costs 0 CP (T-PH.8)
  commandRerollCost(state, side) {
    const op = state.operatives[side.operativeId]
    if (!op || !isPh(state, op) || !hasAbility(state, op, ID.tactical) || usedThisBattle(state, op.seat, TA_PLOY)) return null
    return 0
  },
  onCommandReroll(ctx, side, cost) {
    const op = ctx.state.operatives[side.operativeId]
    if (cost !== 0 || !op || !isPh(ctx.state, op) || !hasAbility(ctx.state, op, ID.tactical) || usedThisBattle(ctx.state, op.seat, TA_PLOY)) return
    markUsedBattle(ctx.state, op.seat, TA_PLOY)
    markFired('phTacticalAdvantage')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.tactical, detail: 'command re-roll' }, op.seat)
  },

  // TERROR and Vanguard (T-PH.24, T-PH.18)
  actionCostDelta(state, op, actionId) {
    if (!isMarkerOrMission(state, actionId)) return 0
    let delta = 0
    // Terror: +1 AP for an enemy of a Phobos side within 3" of one of its Reivers
    const reivers = Object.values(state.operatives).filter((r) => r.seat !== op.seat && live(r) && hasKeyword(state, r, 'REIVER') && isPh(state, r))
    if (reivers.some((r) => within(r, op, 3))) {
      delta += 1
      markFired('phTerror')
    }
    // Vanguard: one discount a turning point for the whole team
    if (isPh(state, op) && hasAbility(state, op, ID.vanguard) && !usedThisTp(state, op.seat, VANGUARD_TP)) delta -= 1
    return delta
  },
  controlTotal(state, seat, _marker, total, contesting) {
    if (contesting.length === 0 || total <= 0) return null
    const reivers = Object.values(state.operatives).filter((r) => r.seat !== seat && live(r) && hasKeyword(state, r, 'REIVER') && isPh(state, r))
    if (reivers.length === 0) return null
    const near = contesting.some((id) => {
      const o = state.operatives[id]
      return !!o && reivers.some((r) => within(r, o, 3))
    })
    if (!near) return null
    markFired('phTerror')
    return total - 1
  },

  // GUERRILLA WARFARE (T-PH.27)
  extraActions(state, op) {
    return isPh(state, op) && live(op) && ployActive(state, op.seat, ID.guerrilla) ? [ID.guerrillaAction] : []
  },

  // Omni-Scrambler: the jammed enemy is not an option while the player has another (T-PH.23)
  canActivate(state, op) {
    return !omniBarred(state, op)
  },

  // Tactical Advantage: re-roll the initiative die once per battle, only when it helps (T-PH.7)
  initiativeReroll(state, seat) {
    if (usedThisBattle(state, seat, TA_INIT) || !leaderOf(state, seat)) return false
    const rolls = state.strategy.rolls
    const mine = rolls[seat]
    const theirs = rolls[otherSeat(seat)]
    if (mine === undefined || theirs === undefined) return false
    // a lost roll-off, or a tie the opponent settles (the player without initiative last turning point decides, R-2.1)
    return mine < theirs || (mine === theirs && otherSeat(state.initiative ?? 'A') !== seat)
  },
  onInitiativeReroll(ctx, seat) {
    markUsedBattle(ctx.state, seat, TA_INIT)
    markFired('phTacticalAdvantage')
  },

  // Voxbreak (T-PH.16)
  rerollsBanned(state, side) {
    const op = state.operatives[side.operativeId]
    if (!op) return false
    for (const v of activeOps(state)) {
      if (v.seat === op.seat || !live(v) || !isPh(state, v) || !hasAbility(state, v, ID.voxbreak)) continue
      if (within(v, op, 6)) {
        markFired('phVoxbreak')
        return true
      }
    }
    return false
  },

  // Grav-chute and Grapnel Launcher (T-PH.22): each climb costs 2", a drop nothing
  moveSurcharge(state, op, _kind, points, breakdown) {
    if (!isPh(state, op) || !hasAbility(state, op, ID.chute)) return 0
    const runs = climbRuns(state, op.pos, points)
    // each climb (a run of consecutive climb increments, R-12.2) was charged max(2", its height rounded up); now 2"
    const perClimb = runs.reduce((n, h) => n + Math.max(0, Math.ceil(h - EPS) - 2), 0)
    // no path to read (a direct cost query): the totals stand for a single climb
    const climbSave = Math.min(breakdown.climb, runs.length > 0 ? perClimb : Math.max(0, breakdown.climb - 2))
    const save = climbSave + breakdown.drop
    if (save <= 0) return 0
    markFired('phGravChute')
    return -save
  },

  // Detonate (T-PH.14)
  weaponForbidden(state, op, weaponId, kind) {
    if (weaponId !== ID.detonator || kind !== 'shoot') return null
    return explosivesMarker(state, op.seat) ? null : 'the Explosives marker is not in the killzone'
  },
  fixedTargets(state, shooter, weaponId) {
    if (weaponId !== ID.detonator) return null
    const m = explosivesMarker(state, shooter.seat)
    if (!m) return { targets: [] }
    const idx = terrainOf(state.map)
    const targets = activeOps(state)
      .filter((o) => live(o) && gapToMarker(bodyOf(o), m) <= 2 + EPS)
      .filter((o) => !targetVerdict(state, markerBody(m), bodyOf(o)).whollyInterveningParts.some((p) => idx.byPart.get(p)?.heavy))
    // RULING: enemies first (nearest the marker first), then friends
    const key = (o: Operative) => (o.seat === shooter.seat ? 1 : 0) * 1000 + gapToMarker(bodyOf(o), m)
    targets.sort((a, b) => key(a) - key(b) || (a.id < b.id ? -1 : 1))
    return { targets: targets.map((o) => o.id), noCover: true, noObscured: true, blast: false }
  },

  // Medic!'s free Dash while the other player is the active one (T-PH.11)
  reactions(state, seat) {
    const out: ReactionOffer[] = []
    for (const e of state.effects) {
      if (e.kind !== 'ph.medicDash' || e.seat !== seat || !e.operativeId) continue
      const v = state.operatives[e.operativeId]
      if (!v || v.status !== 'active') continue
      out.push({ hook: 'phMedic', operativeId: v.id, option: 'dash', labelKey: 'ph.medicDash', data: { medicId: e.data?.medicId } })
    }
    return out
  },

  // Stealth Assault: one more resolution after the first (T-PH.34)
  fightResolveStart(state, attack) {
    if (attack.kind !== 'fight' || !attack.fight) return null
    const op = state.operatives[attack.operativeId]
    if (!op || !isPh(state, op) || !opEffect(state, ID.stealth, op.id)) return null
    markFired('phStealthAssault')
    return { queue: [{ seat: op.seat }] }
  },
})

// ---------------------------------------------------------------------------
// Medic! (T-PH.11): the Pathfinders / Hearthkyn code path with D3 wounds
// ---------------------------------------------------------------------------

function medicFor(s: GameState, victim: Operative): Operative | null {
  if (!isPh(s, victim) || victim.status !== 'active' || inEnemyCr(s, victim)) return null
  const a = s.attack
  for (const m of phOps(s, victim.seat)) {
    if (m.id === victim.id || !hasAbility(s, m, ID.medic) || usedThisTp(s, m.seat, `ph.medic:${m.id}`)) continue
    if (!within(m, victim, 3) || !visible(s, bodyOf(m), bodyOf(victim))) continue
    if (inEnemyCr(s, m)) continue
    // in a Shoot action the Helix Adept must not be a primary or secondary target
    if (a?.kind === 'shoot' && a.targets.includes(m.id)) continue
    return m
  }
  return null
}

/**
 * Medic! answered while the casualty waits in the removal queue: accepted, it keeps D3 wounds (saveFromRemoval) and
 * the rule's costs apply; declined, the removal goes on (a dying Minelayer still places or loses its mine).
 */
function medicAnswer(ctx: Ctx, victim: Operative, accept: boolean): void {
  const s = ctx.state
  const ask = effectFor(s, 'ph.medicAsk', victim.id)
  const medic = ask ? s.operatives[String(ask.data?.medicId ?? '')] : undefined
  if (ask) removeEffects(ctx, (e) => e.id === ask.id)
  let endNow = false
  if (accept && medic && saveFromRemoval(ctx, victim.id, d3(ctx, 'ph.medic.d3'))) {
    markUsedTp(s, medic.seat, `ph.medic.saved:${victim.id}`)
    // the activation the rule was used in: the one under a frame (an enemy Guard interrupt, a free action) counts
    const under = baseActivation(s)
    if (under && !under.counteract && under.operativeId === victim.id) {
      under.endsAfterAction = true
      endNow = true
    }
    addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: 'ph.medicDash', operativeId: victim.id, expires: 'activation', data: { medicId: medic.id } })
    aplUntilNextActivationEnd(ctx, victim.id, ID.medic)
    aplUntilNextActivationEnd(ctx, medic.id, ID.medic)
    ctx.emit({ type: 'AbilityUsed', operativeId: medic.id, abilityId: ID.medic, detail: victim.id }, medic.seat)
    markFired('phMedic')
  } else dropDying(ctx, victim)
  continueRemovals(ctx)
  // a removal deferred to the end of a step gives back the casualty's next action decision: its activation ends now
  const act = s.firefight.activation
  if (endNow && act && !act.frame && !act.declared && act.endsAfterAction && act.operativeId === victim.id && s.pending?.kind === 'firefight.action') {
    s.pending = null
    raiseAction(ctx)
  }
}

registerCodeHook({
  name: 'phMedic',
  /** `save` / `decline` while the casualty waits in the removal queue; `dash`: the free Dash after the action */
  choice(ctx, op, option) {
    if (option === 'save' || option === 'decline') {
      medicAnswer(ctx, op, option === 'save')
      return
    }
    const fx = effectFor(ctx.state, 'ph.medicDash', op.id)
    if (!fx) {
      reactionDone(ctx)
      return
    }
    removeEffects(ctx, (e) => e.id === fx.id)
    if (!startFreeAction(ctx, { operativeId: op.id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: REACTION_DONE })) reactionDone(ctx)
  },
})

// The qualifying moment ("would be incapacitated"), judged where everyone stands then: the first one each turning point
// spends the rule's use whether or not the player takes it. The decision itself waits for the removal queue.
registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = opOfHook(c)
    if (!s || !ctx || !victim) return null
    const medic = medicFor(s, victim)
    if (!medic) return null
    markUsedTp(s, medic.seat, `ph.medic:${medic.id}`)
    removeEffects(ctx, (e) => e.kind === 'ph.medicAsk' && e.operativeId === victim.id)
    addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: 'ph.medicAsk', operativeId: victim.id, expires: 'turningPoint', data: { medicId: medic.id } })
    return null
  },
  'ph.beforeIncapacitated',
)

/** Markers the core "before removal" drop just put down where the casualty stands (it may yet be saved). */
function droppedBy(ctx: Ctx, op: Operative): Marker[] {
  const ids = new Set(ctx.events.filter((e) => e.type === 'MarkerPlaced' && e.operativeId === op.id).map((e) => (e as { markerId: string }).markerId))
  return ctx.state.markers.filter((m) => ids.has(m.id) && !m.carriedBy && Math.hypot(m.pos.x - op.pos.x, m.pos.z - op.pos.z) < EPS)
}

/**
 * A dying carrier places its marker (R-4.6): the Haywire Mine only where it is legal, else it is removed with the
 * Minelayer (T-PH.20); anything else where the carrier stands (the core drop). Runs after the core drop too.
 */
function dropDying(ctx: Ctx, op: Operative): void {
  const s = ctx.state
  const m = s.markers.find((k) => k.equipmentId === HAYWIRE && (k.carriedBy === op.id || (!k.carriedBy && k.placedBy === op.id && Math.hypot(k.pos.x - op.pos.x, k.pos.z - op.pos.z) < EPS && droppedBy(ctx, op).includes(k))))
  if (m) {
    const spot = mineSpots(s, op, m)[0]
    op.flags.carrying = null
    if (spot) {
      m.carriedBy = null
      m.pos = { x: spot.x, z: spot.z }
      ctx.emit({ type: 'MarkerPlaced', markerId: m.id, operativeId: op.id, pos: { ...m.pos } }, op.seat)
    } else removeMarker(ctx, m.id, 'ph.haywireMine')
  }
  dropCarried(ctx, op)
}

// Before removal: Medic! asks its question (the removal queue waits; a marker the core dropped goes back to the
// casualty meanwhile), else a dying Minelayer places or loses its mine.
registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = opOfHook(c)
    if (!ctx || !s || !op) return null
    const ask = effectFor(s, 'ph.medicAsk', op.id)
    if (ask) {
      const medic = s.operatives[String(ask.data?.medicId ?? '')]
      if (s.removal && s.removal.ids.includes(op.id) && !s.pending && medic && medic.status === 'active' && medic.wounds > 0) {
        for (const m of droppedBy(ctx, op)) {
          m.carriedBy = op.id
          op.flags.carrying = m.id
          ctx.emit({ type: 'MarkerPickedUp', markerId: m.id, operativeId: op.id }, op.seat)
        }
        ctx.raise({
          kind: 'ability.choice',
          seat: op.seat,
          window: 'operative.incapacitated',
          context: { hook: 'phMedic', operativeId: op.id, step: 'save', medicId: medic.id },
          options: ['save', 'decline'].map((id) => ({ id, labelKey: `ph.medic.${id}`, type: 'ability.choice' as const, payload: { option: id }, data: { medicId: medic.id } })),
        })
        return null
      }
      // the Helix Adept fell too (or nothing can ask now): the rule cannot be used
      removeEffects(ctx, (e) => e.id === ask.id)
    }
    dropDying(ctx, op)
    return null
  },
  'ph.operative.incapacitated',
)

// ---------------------------------------------------------------------------
// Damage: Critical Shot's extra D3
// ---------------------------------------------------------------------------

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = opOfHook(c)
    if (!s || !op) return null
    const d = c.data as { source: string; amount: number; attackerId: string }
    if (d.amount <= 0) return null
    // Critical Shot: the first crit that deals damage deals D3 more (T-PH.32)
    if (ctx && d.source === 'crit' && d.amount > 0) {
      const fx = effectFor(s, 'ph.critShot', d.attackerId)
      if (fx && fx.data?.targetId === op.id) {
        removeEffects(ctx, (e) => e.id === fx.id)
        d.amount += d3(ctx, 'ph.criticalShot.d3')
      }
    }
    return null
  },
  'ph.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// Medic!'s free Dash, Comms Array, Plant Explosives' Dash, Special Issue Ammunition, Purity Seals: the ploy rule
// ---------------------------------------------------------------------------

function offer(id: string, ployId: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id, ployId, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

registerFrameResume('ph.plantDash', (ctx, outcome, data) => {
  // R-3.9: the free Dash counts as Dash having been performed in the activation it was taken in
  const op = ctx.state.operatives[String(data.opId)]
  const act = op ? actOf(ctx.state, op) : null
  if (outcome === 'finished' && act && !act.frame && !act.performed.includes('dash')) act.performed.push('dash')
  // the ploy window that offered the Dash goes on
  if (ctx.state.window) continueWindow(ctx)
})

const PH_RULE: PloyRule = {
  extraOffers(state, seat, window, info): PloyOffer[] {
    const out: PloyOffer[] = []
    const act = state.firefight.activation
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    // ---- Medic!'s free Dash while the Phobos player is the active one
    if (window === 'firefight.actionEnded' && act && act.seat === seat) {
      for (const e of state.effects) {
        if (e.kind !== 'ph.medicDash' || e.seat !== seat || !e.operativeId || state.operatives[e.operativeId]?.status !== 'active') continue
        out.push({ id: `ph.medicDash@${e.operativeId}`, ployId: 'ph.medicDash', name: 'Medic! free Dash', cost: 0, via: 'ph.medicDash', seed: { param: e.operativeId }, operativeId: e.operativeId })
      }
    }
    if (!subject || subject.seat !== seat || !live(subject) || !isPh(state, subject)) return out
    // ---- Plant Explosives: a free Dash after Place Marker (T-PH.13)
    if (window === 'firefight.actionEnded' && info.action === 'marker:place' && hasAbility(state, subject, ID.plant) && act && act.operativeId === subject.id && !act.frame) {
      const placed = state.markers.find((m) => m.equipmentId === EXPLOSIVES && m.owner === seat && !m.carriedBy)
      if (placed && !act.performed.includes('dash') && !act.performed.includes('charge') && !inEnemyCr(state, subject)) {
        out.push(offer('ph.plantDash', 'ph.plantDash', 'Plant Explosives: free Dash', 'ph.plantDash', subject))
      }
    }
    // ---- Comms Array: swap a used strategy ploy for an unused one (T-PH.10)
    if ((window === 'firefight.activationStart' || window === 'firefight.actionEnded') && !usedThisTp(state, seat, COMMS_TP)) {
      const commsman = phOps(state, seat).find((o) => hasAbility(state, o, ID.comms))
      if (commsman) {
        const used = STRATEGY_PLOYS.filter((p) => usedThisTp(state, seat, p) && ployActive(state, seat, p))
        const fresh = STRATEGY_PLOYS.filter((p) => !usedThisTp(state, seat, p))
        for (const u of used) {
          for (const n of fresh) {
            const o = offer(`ph.comms:${n}:${u}`, n, `Comms Array: ${state.data.ploys?.[u]?.name ?? u} for ${state.data.ploys?.[n]?.name ?? n}`, 'ph.comms', subject, u)
            out.push(o)
          }
        }
      }
    }
    const a = state.attack
    const side = sideOf(state, subject.id)
    // ---- Special Issue Ammunition: a carbine picked for a Shoot, once per turning point (T-PH.38)
    if (window === 'shoot.targetSelected' && equipped(state, seat, ID.ammo) && !usedThisTp(state, seat, AMMO_TP)) {
      if (a && a.kind === 'shoot' && a.operativeId === subject.id && a.weaponId && AMMO_WEAPONS.includes(a.weaponId) && !opEffect(state, ID.ammo, subject.id)) {
        out.push(offer(ID.ammo, ID.ammo, 'Special Issue Ammunition', 'ph.ammo', subject))
      }
    }
    // ---- Purity Seals: two fails on the attack roll (T-PH.35)
    if ((window === 'shoot.attackRolled' || window === 'fight.rolled') && equipped(state, seat, ID.purity) && !usedThisTp(state, seat, PURITY_TP)) {
      if (side && side.weaponId && liveFails(side.dice).length >= 2) out.push(offer(ID.purity, ID.purity, 'Purity Seals', 'ph.purity', subject))
    }
    return out
  },

  // Tactical Advantage: a firefight ploy free for the Sergeant (T-PH.8)
  costAdjust(state, seat, ploy, _seed, info) {
    if (ploy.type !== 'firefight' || usedThisBattle(state, seat, TA_PLOY)) return null
    const leader = leaderOf(state, seat)
    if (!leader) return null
    if (ploy.id === ID.patient) return leader.ready && !inEnemyCr(state, leader) ? { cost: 0, via: 'ph.ta' } : null
    return info.subjectId === leader.id ? { cost: 0, via: 'ph.ta' } : null
  },

  onUsed(ctx, seat, o, info) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    if (o.via === 'ph.ta') {
      markUsedBattle(s, seat, TA_PLOY)
      markFired('phTacticalAdvantage')
      return
    }
    switch (o.via) {
      case 'ph.medicDash': {
        const id = o.operativeId
        const fx = id ? effectFor(s, 'ph.medicDash', id) : undefined
        if (!id || !fx) return
        removeEffects(ctx, (e) => e.id === fx.id)
        startFreeAction(ctx, { operativeId: id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: 'ploy.freeAction' })
        return
      }
      case 'ph.plantDash': {
        if (!op) return
        const act = s.firefight.activation
        startFreeAction(ctx, { operativeId: op.id, action: 'dash', ...(act?.counteract ? { maxMove: 2 } : {}), resume: 'ph.plantDash', data: { opId: op.id } })
        return
      }
      case 'ph.comms': {
        // swap: the old ploy's effect ends, the new one (applied by usePloy right after) takes its place
        if (o.param) removeEffects(ctx, (e) => e.source === o.param && e.seat === seat)
        markUsedTp(s, seat, COMMS_TP)
        markFired('phCommsArray')
        ctx.emit({ type: 'AbilityUsed', operativeId: op?.id ?? null, abilityId: ID.comms, detail: `${o.param ?? ''}>${o.ployId}` }, seat)
        refreshFlags(s)
        return
      }
      case 'ph.ammo': {
        if (!op) return
        markUsedTp(s, seat, AMMO_TP)
        addEffect(ctx, { source: ID.ammo, seat, kind: 'equipment', operativeId: op.id, expires: 'turningPoint', data: { weaponId: s.attack?.weaponId ?? null } })
        markFired('phSpecialIssueAmmo')
        return
      }
      case 'ph.purity': {
        if (!op) return
        markUsedTp(s, seat, PURITY_TP)
        const side = sideOf(s, op.id)
        if (!side) return
        const fails = liveFails(side.dice)
        const keep = fails[0]
        const drop = fails[1]
        if (keep && drop) {
          keep.value = null
          keep.kind = 'normal'
          keep.tag = 'ph.purity'
          drop.used = true
        }
        markFired('phPuritySeals')
        return
      }
      default:
        void info
    }
  },
}
registerPloyRule(PH_RULE)

// ---------------------------------------------------------------------------
// Lifecycle: Strategic Oversight, team markers, Additional Utility Grenades, Auspex and Omni-Scrambler upkeep
// ---------------------------------------------------------------------------

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    const s = ctx.state
    ensureMarkers(ctx)
    for (const seat of SEATS) {
      // Additional Utility Grenades: its four picks are the team's utility grenade picks (T-PH.36)
      if (equipped(s, seat, ID.grenades)) {
        const picks = s.equipment.picks[seat]?.[ID.grenades]
        if (picks && picks.length > 0) {
          s.equipment.picks[seat] = { ...s.equipment.picks[seat], 'core.e.utility-grenades': [...picks] }
          markFired('phAdditionalGrenades')
        }
      }
      // Strategic Oversight (T-PH.9)
      for (const op of phOps(s, seat)) {
        if (!hasAbility(s, op, ID.oversight) || inEnemyCr(s, op)) continue
        const need = Number(codeParams(s, op, 'phStrategicOversight')?.rollOn ?? 4)
        const [r] = ctx.roll('ph.oversight', 1)
        markFired('phStrategicOversight')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.oversight, detail: String(r) }, seat)
        if (r! >= need) gainCp(ctx, seat, 1, ID.oversight)
      }
    }
    return null
  },
  'ph.turningPoint.start',
)

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = opOfHook(c)
    if (!ctx || !s || !op) return null
    // Omni-Scrambler: every activation the opponent starts counts toward the ban (T-PH.23)
    for (const fx of s.effects) {
      if (fx.kind === 'ph.omni' && fx.seat !== op.seat && s.phase === 'firefight') fx.data = { ...(fx.data ?? {}), seen: Number(fx.data?.seen ?? 0) + 1 }
    }
    // Proximity Mine, Medic!: an APL penalty taken in the middle of its own activation starts with this one (T-PH.11, 21)
    for (const fx of s.effects.filter((e) => e.kind === 'ph.aplNext' && e.operativeId === op.id)) {
      removeEffects(ctx, (e) => e.id === fx.id)
      applyAplEffect(ctx, op.id, -1, String(fx.data?.source ?? fx.source))
    }
    // Stealth Assault: remember an operative that went from Conceal to Engage as it was activated (T-PH.34)
    const d = c.data as { previousOrder?: string; order?: string } | undefined
    if (isPh(s, op) && d?.previousOrder === 'conceal' && d.order === 'engage' && !effectFor(s, 'ph.stealthOrder', op.id)) {
      addEffect(ctx, { source: 'ph.stealthOrder', seat: op.seat, kind: 'ph.stealthOrder', operativeId: op.id, expires: 'activation' })
    }
    return null
  },
  'ph.activation.start',
)

// ---------------------------------------------------------------------------
// Actions declared and ended: Vanguard, Track Target, Detonate, Proximity Mine
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = opOfHook(c)
    if (!s || !ctx || !op || !isPh(s, op)) return null
    const d = c.data as unknown as ActionDeclaredData
    if (d.cancel) return null
    // Vanguard: the team's one discount a turning point is used by the first eligible action (T-PH.18)
    if (hasAbility(s, op, ID.vanguard) && isMarkerOrMission(s, d.action) && !usedThisTp(s, op.seat, VANGUARD_TP)) {
      markUsedTp(s, op.seat, VANGUARD_TP)
      markFired('phVanguard')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.vanguard, detail: d.action }, op.seat)
    }
    // Track Target: the Guard interrupt of a Conceal Marksman puts it on Engage (T-PH.19)
    const act = s.firefight.activation
    if (hasAbility(s, op, ID.track) && act?.frame?.kind === 'interrupt' && act.operativeId === op.id && (d.action === 'shoot' || d.action === 'fight') && op.order === 'conceal') {
      setOrder(ctx, op, 'engage', false)
      markFired('phTrackTarget')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.track }, op.seat)
    }
    return null
  },
  'ph.action.declared',
)

/** Positions a step moved an operative through (the end of every increment), then where it stands. */
function pathPoints(ctx: Ctx, op: Operative): Vec3[] {
  const pts: Vec3[] = []
  for (const ev of ctx.events) {
    if (ev.type !== 'OperativeMoved' || ev.operativeId !== op.id) continue
    for (const seg of ev.segments) pts.push({ ...seg.to })
  }
  pts.push({ ...op.pos })
  return pts
}

function triggerMine(ctx: Ctx, mine: Marker, victim: Operative, at: Vec3): void {
  const s = ctx.state
  removeMarker(ctx, mine.id, 'ph.proximityMine')
  markFired('phProximityMine')
  const dice = ctx.roll('ph.mine.2d3', 2)
  const damage = dice.reduce((n, x) => n + Math.ceil(x / 2), 0) + 3
  ctx.emit({ type: 'MineTriggered', markerId: mine.id, operativeId: victim.id, damage }, mine.owner)
  // "until the end of its next activation": a victim in the middle of its own activation loses the APL from the next one
  aplUntilNextActivationEnd(ctx, victim.id, ID.proximity)
  directDamage(ctx, victim.id, damage, mine.id, 'ph.proximityMine')
  // a survivor that moved on is put back at the trigger point and its action ends there
  if (victim.status === 'active' && victim.wounds > 0 && Math.hypot(victim.pos.x - at.x, victim.pos.z - at.z) > EPS) {
    const from = { ...victim.pos }
    victim.pos = { ...at }
    ctx.emit({ type: 'OperativeMoved', operativeId: victim.id, action: 'forced', from, to: { ...at }, segments: [{ from, to: { ...at }, length: Math.hypot(from.x - at.x, from.z - at.z), cost: 0, kind: 'fly' }], cost: 0, maxInches: 0 })
  }
}

function scanMines(ctx: Ctx): void {
  const s = ctx.state
  for (const mine of mineMarkers(s)) {
    let hit: { op: Operative; at: Vec3 } | null = null
    for (const op of activeOps(s).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!live(op) || op.id === mine.placedBy) continue
      for (const pt of pathPoints(ctx, op)) {
        if (markerInControlRange(s, bodyOf({ ...op, pos: pt }), mine)) {
          hit = { op, at: pt }
          break
        }
      }
      if (hit) break
    }
    if (hit) triggerMine(ctx, mine, hit.op, hit.at)
  }
}

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = opOfHook(c)
    if (!ctx || !s || !op) return null
    const d = c.data as unknown as { action: string }
    // Detonate: the Explosives marker leaves the killzone when the action ends (T-PH.14)
    if (d.action === 'shoot' && isPh(s, op)) {
      const act = s.firefight.activation
      if (act && act.operativeId === op.id && act.weaponsUsed?.at(-1) === ID.detonator) {
        const m = explosivesMarker(s, op.seat)
        if (m) {
          removeMarker(ctx, m.id, 'ph.detonate')
          markFired('phDetonate')
        }
      }
    }
    // Proximity Mine: any operative but the Minelayer that comes within a placed mine's control range (T-PH.21)
    if (mineMarkers(s).length > 0) scanMines(ctx)
    return null
  },
  'ph.action.ended',
)

// ---------------------------------------------------------------------------
// Weapon rules: Custom, Special Issue Ammunition, Deadly Shots, Lethal Assaults, Auspex Scan's Seek Light
// ---------------------------------------------------------------------------

/** The Voxbreaker's Auspex Scan in force for the seat, if the Voxbreaker is alive and within 8" of the target. */
function auspexFor(s: GameState, seat: Seat, target: Operative): Operative | null {
  for (const v of phOps(s, seat)) {
    if (!hasAbility(s, v, ID.auspex) || !hasToken(s, v.id, AUSPEX_TOKEN, seat)) continue
    if (within(v, target, 8)) return v
  }
  return null
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId || !isPh(s, op)) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const has = (key: string, pred?: (r: WeaponRuleRef) => boolean) => rules.some((r) => ruleKey(r.rule) === key && (!pred || pred(r)))
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    // Custom: the Veteran's two picked rules (T-PH.15)
    if (c.weaponId === ID.customCarbine && op.picks) {
      for (const key of ['custom-1', 'custom-2']) {
        const ref = CUSTOM_RULES[op.picks[key] ?? '']
        if (!ref) continue
        const k = ruleKey(ref.rule)
        if (!has(k, (r) => (k === 'piercing' ? !!r.crits === !!ref.crits : true))) rules.push({ ...ref })
        markFired('phCustom')
      }
    }
    if (data.kind === 'shoot') {
      // Special Issue Ammunition: Piercing 1 on that weapon until the turning point ends (T-PH.38)
      const ammo = opEffect(s, ID.ammo, op.id)
      if (ammo && ammo.data?.weaponId === c.weaponId && !has('piercing', (r) => !r.crits)) {
        rules.push({ rule: 'piercing', x: 1 })
        markFired('phSpecialIssueAmmo')
      }
      // Auspex Scan: an Incursor's weapons have Seek Light against enemies within 8" of the Voxbreaker (T-PH.17)
      if (target && target.seat !== op.seat && hasKeyword(s, op, 'INCURSOR') && auspexFor(s, op.seat, target) && !has('seeklight')) {
        rules.push({ rule: 'seek-light' })
        markFired('phAuspexScan')
      }
      // Deadly Shots: Balanced, checked per target (T-PH.29)
      if (ployActive(s, op.seat, ID.deadly) && !has('balanced') && weaponOfId(s, c.weaponId)?.type === 'ranged') {
        const act = actOf(s, op)
        const performed = performedOf(s, op)
        const fresh = !!act && !performed.some((a) => a === 'charge' || a === 'fallBack' || a === 'reposition')
        let open = false
        if (!fresh && target && target.seat !== op.seat) {
          const v = targetVerdict(s, bodyOf(op), { ...bodyOf(target), order: target.order })
          open = !v.inCover && v.distance > 6 + EPS
        }
        if (fresh || open) {
          rules.push({ rule: 'balanced' })
          markFired('phFlagPloy')
        }
      }
    }
    // Lethal Assaults: the attacker's own Fight, never a retaliation (T-PH.30)
    if (data.kind === 'fight' && ployActive(s, op.seat, ID.lethal) && weaponOfId(s, c.weaponId)?.type === 'melee') {
      const a = s.attack
      if (!a || (a.kind === 'fight' && a.operativeId === op.id)) {
        if (!has('balanced')) rules.push({ rule: 'balanced' })
        if (performedOf(s, op).includes('charge') && !has('lethal')) rules.push({ rule: 'lethal', target: 5 })
        markFired('phFlagPloy')
      }
    }
    return null
  },
  'ph.modifyWeaponRules',
)

// ---------------------------------------------------------------------------
// Obscured: Multi-Spectrum Array and Auspex Scan (target.status), Seek Light's extra targets
// ---------------------------------------------------------------------------

registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = opOfHook(c)
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !shooter || !target || !isPh(s, shooter) || target.seat === shooter.seat) return null
    const data = c.data as { obscured: boolean }
    if (!data.obscured) return null
    if (hasKeyword(s, shooter, 'INCURSOR')) {
      data.obscured = false
      markFired('phMultiSpectrum')
    } else if (auspexFor(s, shooter.seat, target)) {
      data.obscured = false
      markFired('phAuspexScan')
    }
    return null
  },
  'ph.target.status',
)

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !isPh(s, op)) return null
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    // ASTARTES: the second Shoot needs a bolt weapon in one of the two (T-PH.25)
    if (!data.secondary) {
      const act = s.firefight.activation
      if (act && act.operativeId === op.id && !act.frame && !act.counteract && act.performed.filter((a) => a === 'shoot').length >= 1) {
        const prev = [...(act.weaponsUsed ?? [])].filter((w) => weaponOfId(s, w)?.type === 'ranged').pop()
        if (prev !== undefined && !isBolt(s, prev) && !isBolt(s, data.weaponId)) data.candidates.length = 0
      }
    }
    if (data.secondary || s.attack?.pointBlank || weaponOfId(s, data.weaponId)?.type !== 'ranged') return null
    // Auspex Scan's Seek Light makes a Conceal enemy in Light cover a valid target for an Incursor (T-PH.17)
    if (!hasKeyword(s, op, 'INCURSOR')) return null
    const base = ruleSetFor(s, op, data.weaponId, 'shoot', undefined, c.engine)
    for (const e of enemiesOf(s, op)) {
      if (!live(e) || data.candidates.includes(e.id) || !auspexFor(s, op.seat, e)) continue
      const rules = { ...base, seekLight: true }
      if (rules.range !== null && !isWithin(bodyOf(op), bodyOf(e), rules.range)) continue
      if (enemiesInControlRange(s, e, e.seat).length > 0) continue
      const info = targetInfo(s, op, e, rules)
      if (!info.verdict.visible || info.coverBlocks) continue
      data.candidates.push(e.id)
      markFired('phAuspexScan')
    }
    return null
  },
  'ph.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// Unique actions: Helix Gauntlet, Auspex Scan, Guerrilla Warfare
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'phHelixGauntlet',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of phOps(state, op.seat)) {
        if (f.wounds >= f.maxWounds) continue
        if (f.id !== op.id && !inControlRange(state, bodyOf(op), bodyOf(f))) continue
        if (usedThisTp(state, op.seat, `ph.medic.saved:${f.id}`)) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      regainWounds(ctx, target.id, d3(ctx, 'ph.gauntlet.d3') + 3, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'phAuspexScan',
  action: {
    offers(): OfferSeed[] {
      return [{ key: 'scan', params: {} }]
    },
    perform(ctx, op, def) {
      removeToken(ctx, op.id, AUSPEX_TOKEN, 'rescan', op.seat)
      addToken(ctx, op.id, { kind: AUSPEX_TOKEN, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'ph.auspex')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'phGuerrillaWarfare',
  action: {
    offers(_state, op): OfferSeed[] {
      const to = op.order === 'engage' ? 'conceal' : 'engage'
      return [{ key: to, params: { param: to } }]
    },
    perform(ctx, op, def, params) {
      const to = params.param === 'conceal' ? 'conceal' : 'engage'
      setOrder(ctx, op, to)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: to }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys: flags the providers and hooks read (T-PH.27 to T-PH.30)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'phFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

// OMNI-SCRAMBLER (T-PH.23): a gambit that picks an enemy an Infiltrator sees, or one within 6" of the Voxbreaker
registerCodeHook({
  name: 'phOmniScrambler',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const infiltrators = phOps(state, seat).filter((o) => hasKeyword(state, o, 'INFILTRATOR'))
      if (infiltrators.length === 0) return []
      const voxbreakers = infiltrators.filter((o) => hasKeyword(state, o, 'VOXBREAKER'))
      return Object.values(state.operatives)
        .filter((e) => e.seat !== seat && live(e))
        .filter((e) => infiltrators.some((i) => visible(state, bodyOf(i), bodyOf(e))) || voxbreakers.some((v) => within(v, e, 6)))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, ploy, seed) {
      const s = ctx.state
      const target = seed.param ? s.operatives[seed.param] : undefined
      if (!target || !live(target)) return
      const need = phOps(s, seat).filter((o) => hasKeyword(s, o, 'INFILTRATOR')).length
      addEffect(ctx, { source: ploy.id, seat, kind: 'ph.omni', operativeId: target.id, expires: 'turningPoint', data: { targetId: target.id, need, seen: 0 } })
      addToken(ctx, target.id, { kind: OMNI_TOKEN, owner: seat, cap: 1, expires: ['turningPointEnd'] }, 'ph.omni')
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ID.omni, detail: target.id }, seat)
    },
  },
})

// PATIENT AMBUSH (T-PH.31)
registerCodeHook({
  name: 'phPatientAmbush',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return phOps(state, seat).some((o) => o.ready) ? [{}] : []
    },
    apply(ctx, seat) {
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ID.patient }, seat)
      skipActivation(ctx, seat)
    },
  },
})

// CRITICAL SHOT (T-PH.32): after the defence dice, while the shooter still holds a crit and a bolt weapon
registerCodeHook({
  name: 'phCriticalShot',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const a = state.attack
      if (!op || op.seat !== seat || !isPh(state, op) || !a || a.kind !== 'shoot' || a.operativeId !== op.id || !isBolt(state, a.weaponId)) return []
      const side = sideOf(state, op.id)
      if (!side || !side.dice.some((d) => d.kind === 'crit' && !d.used)) return []
      if (effectFor(state, 'ph.critShot', op.id)) return []
      return [{}]
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const s = ctx.state
      const op = info.subjectId ? s.operatives[info.subjectId] : undefined
      if (!op) return
      addEffect(ctx, { source: ID.critical, seat, kind: 'ph.critShot', operativeId: op.id, expires: 'action', data: { targetId: s.attack?.seq?.targetId ?? null } })
    },
  },
})

// STEALTH ASSAULT (T-PH.34): Conceal at activation, switched to Engage, Charge then Fight as the first two actions
registerCodeHook({
  name: 'phStealthAssault',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const a = state.attack
      const act = state.firefight.activation
      if (!op || op.seat !== seat || !isPh(state, op) || !a || a.kind !== 'fight' || a.operativeId !== op.id) return []
      if (!act || act.operativeId !== op.id || act.frame || act.counteract) return []
      if (act.performed.length !== 1 || act.performed[0] !== 'charge' || !effectFor(state, 'ph.stealthOrder', op.id)) return []
      if (opEffect(state, ID.stealth, op.id)) return []
      return [{}]
    },
    apply(ctx, seat, _ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ID.stealth, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'action' })
    },
  },
})
