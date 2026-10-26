// Kasrkin (docs/spec/13-teams.md section 11, rule ids T-KS.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - SKILL AT ARMS (T-KS.20) and TACTICAL COMMAND (T-KS.7): two kinds of timed effect (team skills, one personal skill)
//    that end at the next Ready step (`turningPointStart`); the skills themselves (Light 'Em Up, Strike Fast, Ice In
//    Your Veins, For Cadia!) are small handlers on the shared hook points.
//  - RAPID FIRE (T-KS.25): providers maxRepeats, weaponForbidden and actionForbidden plus a per-activation `ks.moved`
//    effect, because a free move made inside the activation is not in `Activation.performed`.
//  - Medic! (T-KS.9): the qualifying moment is noted in `beforeIncapacitated`; the removal then waits in the queue
//    (provider pausableRemoval) where the player accepts or declines (attack-common saveFromRemoval / continueRemovals).
//    MEDIKIT is a 0 AP unique action.
//  - Melta Mine and Proximity Mine (T-KS.11, T-KS.12): a team marker created carried at set-up, placed with the shared
//    Place Marker (provider placeMarkerProblem keeps it out of enemy control range) followed by a 0 CP free Dash offer,
//    and set off by the provider checkMines (after every step, forced moves included).
//  - Weapon-rule changes (Light 'Em Up, Foregrip, Long-Range Scope, Clearance Sweep, Elimination Pattern, Camo Cloak)
//    all live in the one `modifyWeaponRules` handler so their order is fixed.
//  - Ploys: strategy flags and markers, Relocate (a choice loop of free Dashes), the firefight ploys with their own
//    windows. Cover Retreat is offered in the firefight.fallBackMoved window, between the move and the end of the action.
import { applyAplEffect, continueRemovals, hasRule, heavyBlocksMove, parseRules, ruleKey, ruleSetFor, saveFromRemoval, targetInfo } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, aplChangeNextActivation, directDamage, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { canStartFreeAction, cancelAction, finishAction, raiseAction, REACTION_DONE, reactionDone, startDelegatedAction, startFreeAction } from '../firefight'
import { registerFrameResume, registerHook, type ActionDeclaredData } from '../hooks'
import { bodyOf, visible } from '../los'
import { dropCarried, newMarkerId, removeMarker, tracksControl } from '../markers'
import { distanceBetween, gapToMarker, markerInControlRange } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { continueWindow } from '../ploys'
import { markerControl } from '../query'
import type { Ctx } from '../registry'
import { placementSpots } from '../reserve'
import { activeOps, effectiveApl, enemiesOf, otherSeat } from '../state'
import { resumeGambit } from '../strategy'
import { providerControlApl, registerTeamRules, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, removeTokensWhere } from '../tokens'
import type { GameEvent } from '../events'
import { axisOf } from '../footprint'
import { placementProblem } from '../terrain'
import type { Activation, AttackDie, GameState, Marker, Operative, Seat, Vec2, WeaponRuleRef } from '../types'

export const TEAM_ID = 'kasrkin'

const KS = 'KASRKIN'
const EPS = 1e-6
const MOVE_ACTIONS = ['reposition', 'dash', 'fallBack', 'charge']

const A = (id: string) => `ks.a.${id}`
const P = (id: string) => `ks.p.${id}`
const E = (id: string) => `ks.e.${id}`

const SMOKE = 'core.a.smoke-grenade'
const STUN = 'core.a.stun-grenade'
const PICK_UP = 'marker:pickUp'
const PLACE = 'marker:place'
const ABILITY = (id: string) => `ability:${id}`

const SKILLS = ['light-em-up', 'strike-fast', 'ice-in-your-veins', 'for-cadia'] as const
export type Skill = (typeof SKILLS)[number]
const SKILL_NAME: Record<Skill, string> = { 'light-em-up': 'Light \'Em Up', 'strike-fast': 'Strike Fast', 'ice-in-your-veins': 'Ice In Your Veins', 'for-cadia': 'For Cadia!' }
const SKILL_CODE: Record<Skill, string> = { 'light-em-up': 'ksLightEmUp', 'strike-fast': 'ksStrikeFast', 'ice-in-your-veins': 'ksIceInYourVeins', 'for-cadia': 'ksForCadia' }

const FX_TEAM_SKILL = 'ks.skill'
const FX_OP_SKILL = 'ks.skillOp'
const FX_MOVED = 'ks.moved'
const FX_MEDIC_ASK = 'ks.medicAsk'
const FX_MEDIC_DASH = 'ks.medicDash'
const FX_MINE_DASH = 'ks.mineDash'
const FX_FROM = 'ks.fbFrom'
const FX_GNG = 'ks.gng'
const FX_ICE = 'ks.ice'
const FX_CADIA_SPENT = 'ks.cadia.spent'

const TC_TOKEN = 'ks.tacticalCommand'
const SCAN_TOKEN = 'ks.auspexScan'
const MINE = 'ks.meltaMine'
const SWEEP = 'ks.p.clearance-sweep'

const SKILL_PLOY = P('skill-at-arms')
const ELIMINATION = P('elimination-pattern')
const ENGAGE_COVER = P('engage-from-cover')
const RELOCATE = P('relocate')
const GNG = P('give-no-ground')
const RELICS = E('relics-of-cadia')
const FOREGRIP = E('foregrip')
const SCOPE = E('long-range-scope')

const CONCEALED = 'ks.w.hot-shot-marksman-rifle-concealed'
const LASPISTOL = 'ks.w.hot-shot-laspistol'
const VOLLEY = 'ks.wg.hot-shot-volley-gun'

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game.
for (const name of [
  'ksConcealedPosition',
  'ksVeteranLeadership',
  'ksProximityMine',
  'ksBlastPadding',
  'ksReconnoitre',
  'ksCamoCloak',
  'ksAdaptiveEquipment',
  'ksRapidFire',
  'ksLightEmUp',
  'ksStrikeFast',
  'ksIceInYourVeins',
  'ksForCadia',
  'ksForegrip',
  'ksLongRangeScope',
  'ksRelicsOfCadia',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isKs(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, KS)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function ksOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isKs(state, o))
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

function wname(state: GameState, weaponId: string): string {
  return state.data.weapons[weaponId]?.name ?? ''
}

/** A hot-shot weapon (T-KS.5): a ranged weapon with "hot-shot" in its name. */
export function isHotShot(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  return !!w && w.type === 'ranged' && /hot-shot/i.test(w.name)
}

/** RAPID FIRE weapons (T-KS.25): bolt pistol, hot-shot lasgun and hot-shot laspistol. */
export function isRapid(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  if (!w || w.type !== 'ranged') return false
  const n = w.name.toLowerCase()
  return n === 'bolt pistol' || n === 'hot-shot lasgun' || n === 'hot-shot laspistol'
}

/** The weapon is printed on the operative's own datacard (Foregrip), not granted by equipment. */
function onOwnCard(state: GameState, op: Operative, weaponId: string): boolean {
  const card = state.data.datacards[op.datacardId]
  if (!card) return false
  return card.fixedWeapons.includes(weaponId) || (card.legalLoadouts ?? []).some((l) => l.includes(weaponId)) || card.weaponOptions.some((o) => o.from.includes(weaponId))
}

/** The activation the operative itself is in (a free action frame sits on top of it), or null. */
function ownActivation(state: GameState, op: Operative): Activation | null {
  const cur = state.firefight.activation
  if (!cur) return null
  const base = cur.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : cur
  return base && base.operativeId === op.id && !base.counteract ? base : null
}

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState): Activation | null {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

function liveFails(dice: AttackDie[]): AttackDie[] {
  return dice.filter((d) => d.kind === 'fail' && d.value !== null && !d.used && !d.tag)
}

function sideOf(state: GameState, opId: string) {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
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

// ---------------------------------------------------------------------------
// Skills at Arms: team picks and Tactical Command's personal pick
// ---------------------------------------------------------------------------

export function teamSkills(state: GameState, seat: Seat): Skill[] {
  return state.effects.filter((e) => e.kind === FX_TEAM_SKILL && e.seat === seat).map((e) => e.data?.skill as Skill)
}

export function personalSkill(state: GameState, op: Operative): Skill | null {
  const fx = state.effects.find((e) => e.kind === FX_OP_SKILL && e.operativeId === op.id)
  return (fx?.data?.skill as Skill | undefined) ?? null
}

/** Every Skill at Arms the operative has now (the team's, plus Tactical Command's). */
export function skillsOf(state: GameState, op: Operative): Skill[] {
  const out = teamSkills(state, op.seat)
  const own = personalSkill(state, op)
  if (own && !out.includes(own)) out.push(own)
  return out
}

function hasSkill(state: GameState, op: Operative | undefined, skill: Skill): boolean {
  return isKs(state, op) && skillsOf(state, op).includes(skill)
}

function sergeantIn(state: GameState, seat: Seat): Operative | undefined {
  return ksOps(state, seat).find((o) => hasAbility(state, o, A('veteran-leadership')))
}

// ---------------------------------------------------------------------------
// Auspex Scan, cover
// ---------------------------------------------------------------------------

/** An enemy is being scanned: within 8" of a Recon-Trooper of `seat` whose Auspex Scan token is still on it (T-KS.15). */
export function isScanned(state: GameState, foe: Operative, seat: Seat): boolean {
  return activeOps(state).some((r) => r.seat === seat && live(r) && hasToken(state, r.id, SCAN_TOKEN, seat) && within(r, foe, 8))
}

function targetInCover(s: GameState, shooter: Operative, target: Operative, weaponId: string): boolean {
  const a = s.attack
  if (a && a.kind === 'shoot' && a.operativeId === shooter.id && a.seq && a.seq.targetId === target.id) return a.seq.cover
  const w = s.data.weapons[weaponId]
  return targetInfo(s, shooter, target, parseRules(w?.rules ?? [])).inCover
}

/** Long-Range Scope (T-KS.35): more than 6" away, a crit retained, a hot-shot weapon other than the laspistol. */
function scopeActive(s: GameState, op: Operative, target: Operative, weaponId: string): boolean {
  if (!equipped(s, op.seat, SCOPE) || weaponId === LASPISTOL || !isHotShot(s, weaponId)) return false
  if (gap(op, target) <= 6 + EPS) return false
  const a = s.attack
  const seq = a?.seq
  if (!a || a.kind !== 'shoot' || a.operativeId !== op.id || !seq || seq.targetId !== target.id) return false
  return seq.atk.dice.some((d) => d.kind === 'crit' && !d.used)
}

/**
 * "Cannot retain any cover saves" (T-KS.26): not in cover for the sequence, or the weapon has Saturate (Camo Cloak
 * cancels it). `rules` are the weapon's rules so far in this sequence.
 */
function cannotRetainCover(s: GameState, shooter: Operative, target: Operative, weaponId: string, rules: WeaponRuleRef[]): boolean {
  if (hasRule(rules, 'saturate') && !hasAbility(s, target, A('camo-cloak'))) return true
  return !targetInCover(s, shooter, target, weaponId)
}

// ---------------------------------------------------------------------------
// Medic! and MEDIKIT (T-KS.9, T-KS.10)
// ---------------------------------------------------------------------------

function medicFor(s: GameState, victim: Operative): Operative | null {
  if (!isKs(s, victim) || victim.status !== 'active') return null
  if (inEnemyCr(s, victim)) return null
  const a = s.attack
  for (const m of ksOps(s, victim.seat)) {
    if (!hasAbility(s, m, A('medic')) || m.id === victim.id || usedThisTp(s, m.seat, `ks.medic:${m.id}`)) continue
    if (gap(m, victim) > 3 + EPS) continue
    if (!visible(s, bodyOf(m), bodyOf(victim))) continue
    if (inEnemyCr(s, m)) continue
    // in a Shoot action the medic must not be a primary or secondary target
    if (a?.kind === 'shoot' && a.targets.includes(m.id)) continue
    return m
  }
  return null
}

function medicAsk(s: GameState, victimId: string) {
  return s.effects.find((e) => e.kind === FX_MEDIC_ASK && e.operativeId === victimId)
}

/**
 * Medic! answered while the casualty waits in the removal queue: accepted, it keeps 1 wound (saveFromRemoval) and the
 * rule's costs apply; declined, the removal goes on (a dying Demo-Trooper still drops its Melta Mine).
 */
function medicAnswer(ctx: Ctx, victim: Operative, accept: boolean): void {
  const s = ctx.state
  const ask = medicAsk(s, victim.id)
  const medic = ask ? s.operatives[String(ask.data?.medicId ?? '')] : undefined
  if (ask) removeEffects(ctx, (e) => e.id === ask.id)
  let endNow = false
  if (accept && medic && saveFromRemoval(ctx, victim.id, 1)) {
    markUsedTp(s, medic.seat, `ks.medic.saved:${victim.id}`)
    // the activation the rule was used in: the one under a frame (an enemy Guard interrupt, a free action) counts
    const under = baseActivation(s)
    if (under && !under.counteract && under.operativeId === victim.id) {
      under.endsAfterAction = true
      endNow = true
    }
    // the free Dash after the action: a reaction when the other player is active, a 0 CP offer when the Kasrkin player is
    addEffect(ctx, { source: A('medic'), seat: victim.seat, kind: FX_MEDIC_DASH, operativeId: victim.id, expires: 'activation', data: { medicId: medic.id } })
    // "until the end of their next activations": held over when taken in the operative's own activation
    aplChangeNextActivation(ctx, victim.id, -1, A('medic'))
    aplChangeNextActivation(ctx, medic.id, -1, A('medic'))
    ctx.emit({ type: 'AbilityUsed', operativeId: medic.id, abilityId: A('medic'), detail: victim.id }, medic.seat)
    markFired('ksMedic')
  } else dropDyingMine(ctx, victim)
  continueRemovals(ctx)
  // a removal deferred to the end of a step gives back the casualty's next action decision: its activation ends now
  const act = s.firefight.activation
  if (endNow && act && !act.frame && !act.declared && act.endsAfterAction && act.operativeId === victim.id && s.pending?.kind === 'firefight.action') {
    s.pending = null
    raiseAction(ctx)
  }
}

registerCodeHook({
  name: 'ksMedic',
  /** `save` / `decline` while the casualty waits in the removal queue; `dash`: the free Dash after the action */
  choice(ctx, op, option, _context) {
    if (option === 'save' || option === 'decline') {
      medicAnswer(ctx, op, option === 'save')
      return
    }
    const fx = ctx.state.effects.find((e) => e.kind === FX_MEDIC_DASH && e.operativeId === op.id)
    if (!fx) {
      reactionDone(ctx)
      return
    }
    removeEffects(ctx, (e) => e.id === fx.id)
    const started = startFreeAction(ctx, { operativeId: op.id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: REACTION_DONE })
    if (!started) reactionDone(ctx)
  },
})

// The qualifying moment ("would be incapacitated"), judged where everyone stands then: the first one each turning point
// spends the rule's use whether or not the player takes it. The decision itself waits for the removal queue.
registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !victim) return null
    const medic = medicFor(s, victim)
    if (!medic) return null
    markUsedTp(s, medic.seat, `ks.medic:${medic.id}`)
    removeEffects(ctx, (e) => e.kind === FX_MEDIC_ASK && e.operativeId === victim.id)
    addEffect(ctx, { source: A('medic'), seat: victim.seat, kind: FX_MEDIC_ASK, operativeId: victim.id, expires: 'turningPoint', data: { medicId: medic.id } })
    return null
  },
  'ks.beforeIncapacitated',
)

registerCodeHook({
  name: 'ksMedikit',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of ksOps(state, op.seat)) {
        if (f.wounds >= f.maxWounds) continue
        if (f.id !== op.id && !markerlessCr(state, op, f)) continue
        if (usedThisTp(state, op.seat, `ks.medic.saved:${f.id}`)) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      const dice = ctx.roll('ks.medikit.2d3', 2)
      const amount = dice.reduce((n, d) => n + Math.ceil(d / 2), 0)
      regainWounds(ctx, target.id, amount, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/** Control range between two friendly operatives (visible and within 1"). */
function markerlessCr(state: GameState, a: Operative, b: Operative): boolean {
  return distanceBetween(bodyOf(a), bodyOf(b)) <= 1 + EPS && (visible(state, bodyOf(a), bodyOf(b), { crMode: true }) || visible(state, bodyOf(b), bodyOf(a), { crMode: true }))
}

// ---------------------------------------------------------------------------
// Tactical Command (T-KS.7)
// ---------------------------------------------------------------------------

function skillChoices(state: GameState, f: Operative): Skill[] {
  const team = teamSkills(state, f.seat)
  const own = personalSkill(state, f)
  return SKILLS.filter((k) => !team.includes(k) && k !== own)
}

function sweepMarker(state: GameState, seat: Seat): Marker | undefined {
  return state.markers.find((m) => m.equipmentId === SWEEP && m.owner === seat)
}

/** Spots offered for a free-placement marker: under each operative and between each Kasrkin and its nearest foe. */
function markerSpots(state: GameState, seat: Seat): Vec2[] {
  const out: Vec2[] = []
  const seen = new Set<string>()
  const add = (x: number, z: number) => {
    const p = { x: Math.round(x * 20) / 20, z: Math.round(z * 20) / 20 }
    if (Math.abs(p.x) > 15 || Math.abs(p.z) > 11) return
    const k = `${p.x},${p.z}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(p)
  }
  const mine = ksOps(state, seat)
  const foes = activeOps(state).filter((o) => o.seat !== seat && live(o))
  for (const m of mine) add(m.pos.x, m.pos.z)
  for (const e of foes) add(e.pos.x, e.pos.z)
  for (const m of mine) {
    let best: Operative | null = null
    for (const e of foes) if (!best || gap(m, e) < gap(m, best)) best = e
    if (best) add((m.pos.x + best.pos.x) / 2, (m.pos.z + best.pos.z) / 2)
  }
  return out.slice(0, 24)
}

function placeSweep(ctx: Ctx, seat: Seat, x: number, z: number): void {
  for (const m of [...ctx.state.markers]) if (m.equipmentId === SWEEP && m.owner === seat) removeMarker(ctx, m.id, 'ks.clearanceSweep')
  const marker: Marker = { id: newMarkerId(ctx, 'ksclear'), kind: 'equipment', pos: { x, z }, owner: seat, carriedBy: null, controller: null, equipmentId: SWEEP }
  ctx.state.markers.push(marker)
  ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: null, pos: marker.pos }, seat)
}

registerCodeHook({
  name: 'ksTacticalCommand',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of ksOps(state, op.seat)) if (skillChoices(state, f).length > 0) out.push({ key: f.id, params: { targetId: f.id } })
      if (sweepMarker(state, op.seat)) out.push({ key: 'sweep', params: { param: 'sweep' } })
      return out
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      if (params.param === 'sweep') {
        const spots = markerSpots(s, op.seat)
        if (!sweepMarker(s, op.seat) || spots.length === 0) {
          cancelAction(ctx)
          return
        }
        ctx.raise({
          kind: 'ability.choice',
          seat: op.seat,
          window: 'firefight.actionDeclared',
          context: { hook: 'ksTacticalCommand', operativeId: op.id, abilityId: def.id, mode: 'sweep' },
          options: spots.map((p) => opt(`${p.x},${p.z}`, 'ks.sweep.place', { x: p.x, z: p.z })),
          canPass: true,
        })
        return
      }
      const target = s.operatives[params.targetId as string]
      if (!live(target) || !isKs(s, target)) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'ksTacticalCommand', operativeId: op.id, abilityId: def.id, mode: 'skill', targetId: target.id },
        options: skillChoices(s, target).map((k) => opt(k, `ks.skill.${k}`, { name: SKILL_NAME[k] })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const s = ctx.state
    if (context.mode === 'sweep') {
      const [x, z] = option.split(',').map(Number) as [number, number]
      if (sweepMarker(s, op.seat)) placeSweep(ctx, op.seat, x, z)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: 'sweep' }, op.seat)
      finishAction(ctx)
      return
    }
    const target = s.operatives[String(context.targetId)]
    if (!live(target) || !(SKILLS as readonly string[]).includes(option)) {
      finishAction(ctx)
      return
    }
    // a second Tactical Command on the same operative replaces the first
    removeEffects(ctx, (e) => e.kind === FX_OP_SKILL && e.operativeId === target.id)
    addEffect(ctx, { source: A('tactical-command'), seat: op.seat, kind: FX_OP_SKILL, operativeId: target.id, expires: 'turningPointStart', data: { skill: option } })
    removeTokensWhere(ctx, (t, holder) => t.kind === TC_TOKEN && holder.id === target.id, 'ks.tacticalCommand.replaced')
    addToken(ctx, target.id, { kind: TC_TOKEN, owner: op.seat, cap: 1, data: { skill: option } }, 'ks.tacticalCommand')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${target.id}:${option}` }, op.seat)
    finishAction(ctx)
  },
})

// ---------------------------------------------------------------------------
// Auspex Scan, Battle Comms
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'ksAuspexScan',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      addToken(ctx, op.id, { kind: SCAN_TOKEN, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'ks.auspexScan')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'ksBattleComms',
  action: {
    offers(state, op): OfferSeed[] {
      return ksOps(state, op.seat)
        .filter((f) => f.id !== op.id && effectiveApl(f) < 3)
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || target.id === op.id || effectiveApl(target) >= 3) {
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
// Melta Mine and Proximity Mine (T-KS.11, T-KS.12)
// ---------------------------------------------------------------------------

function carriedMine(state: GameState, op: Operative): Marker | undefined {
  const id = op.flags.carrying
  return id ? state.markers.find((m) => m.id === id && m.equipmentId === MINE) : undefined
}

registerCodeHook({
  name: 'ksMeltaMine',
  /** the Demo-Trooper starts the battle carrying the marker (no set-up placement) */
  setup(ctx, seat) {
    const s = ctx.state
    const carrier = Object.values(s.operatives).find((o) => o.seat === seat && hasAbility(s, o, A('melta-mine')))
    if (!carrier || s.markers.some((m) => m.equipmentId === MINE && m.owner === seat)) return
    const marker: Marker = { id: newMarkerId(ctx, 'ksmine'), kind: 'equipment', pos: { x: carrier.pos.x, z: carrier.pos.z }, owner: seat, carriedBy: carrier.id, controller: null, equipmentId: MINE, pickable: true, placedBy: carrier.id }
    s.markers.push(marker)
    carrier.flags.carrying = marker.id
    markFired('ksMeltaMine')
    ctx.emit({ type: 'MarkerPickedUp', markerId: marker.id, operativeId: carrier.id }, seat)
  },
})

/** Spots for the dying carrier's forced Place Marker: within its control range, outside every enemy control range. */
function mineSpots(state: GameState, op: Operative, mine: Marker): Vec2[] {
  const ring = op.baseRadius
  return placementSpots(state, op, {
    around: { x: op.pos.x, z: op.pos.z },
    radius: ring + 1,
    step: 0.5,
    max: 12,
    test: (p) => {
      if (Math.hypot(p.x - op.pos.x, p.z - op.pos.z) < ring - EPS) return false
      return minePlaceProblem(state, op, mine, p) === null
    },
  }).map((p) => ({ x: p.x, z: p.z }))
}

/** Place Marker of the Melta Mine cannot put it here (T-KS.11): the reason, or null. */
function minePlaceProblem(state: GameState, op: Operative, mine: Marker, pos: Vec2): string | null {
  const probe: Marker = { ...mine, carriedBy: null, pos: { x: pos.x, z: pos.z } }
  const foe = activeOps(state).find((o) => o.seat !== op.seat && live(o) && markerInControlRange(state, bodyOf(o), probe))
  return foe ? `the Melta Mine cannot be placed within ${foe.name}'s control range` : null
}

/**
 * The free Dash after Place Marker on the Melta Mine (T-KS.11): offered at 0 CP in the actionEnded window, unless two
 * Rapid Fire Shoots are done, a Heavy weapon or a Charge bars moving (the Dash rules, R-4.2). A Place that is itself a
 * free action (Seize the Initiative may not move) opens no window, so no Dash follows it.
 */
function mineDashOk(state: GameState, op: Operative): boolean {
  const act = state.firefight.activation
  if (!act || act.frame || act.operativeId !== op.id || !state.effects.some((e) => e.kind === FX_MINE_DASH && e.operativeId === op.id)) return false
  if (!act.counteract && (act.performed.filter((a) => a === 'shoot').length >= 2 || heavyBlocksMove(state, act.weaponsUsed, 'dash') !== null)) return false
  return canStartFreeAction(state, { operativeId: op.id, action: 'dash', resume: '', checkPerformed: true })
}

/**
 * The incapacitated carrier performs a forced Place Marker first (R-4.6): a spot in its control range outside every
 * enemy control range, else the marker leaves with it. Runs whether or not the core hook already dropped the marker.
 */
function dropDyingMine(ctx: Ctx, op: Operative): void {
  const s = ctx.state
  const mine = s.markers.find((m) => m.equipmentId === MINE && (m.carriedBy === op.id || (m.carriedBy === null && m.placedBy === op.id && Math.hypot(m.pos.x - op.pos.x, m.pos.z - op.pos.z) < EPS)))
  if (!mine) {
    dropCarried(ctx, op)
    return
  }
  const spots = mineSpots(s, op, mine)
  if (spots.length === 0) {
    op.flags.carrying = null
    removeMarker(ctx, mine.id, 'ks.meltaMine.lost')
    return
  }
  const p = spots[0]!
  mine.carriedBy = null
  mine.pos = { x: p.x, z: p.z }
  op.flags.carrying = null
  ctx.emit({ type: 'MarkerPlaced', markerId: mine.id, operativeId: op.id, pos: { ...mine.pos } }, op.seat)
}

type MovedEvent = Extract<GameEvent, { type: 'OperativeMoved' }>
interface MinePoint {
  op: Operative
  pos: Operative['pos']
  /** the move and the increment this point ends, for a point on a path */
  ev?: MovedEvent
  seg?: number
}

/**
 * Proximity Mine: the first operative (the Demo-Trooper aside) to reach, at an increment end, or stand in the control
 * range of a placed mine. `actorId` is the operative whose action just ended: if it set a mine off during its own move
 * and survives, the move stops there (T-KS.12).
 */
function triggerMelta(ctx: Ctx, actorId?: string): void {
  // one mine per call: a stopped move changes the points the next mine sees
  for (let i = 0; i < 4 && meltaOnce(ctx, actorId); i++);
}

function meltaOnce(ctx: Ctx, actorId?: string): boolean {
  const s = ctx.state
  const mines = s.markers.filter((m) => m.equipmentId === MINE && !m.carriedBy)
  if (mines.length === 0) return false
  const points: MinePoint[] = []
  for (const ev of ctx.events) {
    if (ev.type === 'OperativeMoved') {
      const op = s.operatives[ev.operativeId]
      if (!live(op)) continue
      ev.segments.forEach((seg, i) => points.push({ op, pos: seg.to, ev, seg: i }))
    }
  }
  for (const op of activeOps(s)) points.push({ op, pos: op.pos })
  for (const mine of mines) {
    for (const p of points) {
      const op = p.op
      if (!live(op)) continue
      if (hasAbility(s, op, A('proximity-mine'))) continue
      if (!markerInControlRange(s, bodyOf({ ...op, pos: p.pos }), mine)) continue
      removeMarker(ctx, mine.id, 'ks.meltaMine')
      const dice = ctx.roll('ks.mine.2d6', 2)
      const damage = dice[0]! + dice[1]! + 3
      ctx.emit({ type: 'MineTriggered', markerId: mine.id, operativeId: op.id, damage }, mine.owner)
      markFired('ksProximityMine')
      directDamage(ctx, op.id, damage, mine.id, 'ks.meltaMine')
      // a survivor's action ends where it set the mine off, even unfinished (its own move only; a forced move is no action of its own)
      if (p.ev && p.seg !== undefined && op.id === actorId && p.ev.action !== 'forced' && live(s.operatives[op.id])) stopMove(ctx, op, p.ev, p.seg)
      return true
    }
  }
  return false
}

/**
 * Cut the operative's latest move back to the end of increment `seg`. If its base cannot be placed there it goes on
 * along its own path to the first increment end where it can ("move it the minimum amount").
 */
function stopMove(ctx: Ctx, op: Operative, ev: MovedEvent, seg: number): void {
  const s = ctx.state
  const latest = ctx.events.filter((e): e is MovedEvent => e.type === 'OperativeMoved' && e.operativeId === op.id).at(-1)
  if (latest !== ev) return
  const last = ev.segments.length - 1
  let k = seg
  while (k < last && placementProblem(s, { id: op.id, pos: ev.segments[k]!.to, radius: op.baseRadius, height: op.height, ...axisOf(op) })) k++
  if (k >= last) return
  const kept = ev.segments.slice(0, k + 1)
  const cost = kept.reduce((n, sg) => n + sg.cost, 0)
  op.movedThisActivation = Math.max(0, (op.movedThisActivation ?? 0) - (ev.cost - cost))
  op.pos = { ...kept[k]!.to }
  ev.segments = kept
  ev.to = { ...op.pos }
  ev.cost = cost
}

// Before removal: Medic! asks its question (the removal queue waits for it), else a dying Demo-Trooper drops its mine.
registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op) return null
    const ask = medicAsk(s, op.id)
    if (ask) {
      const medic = s.operatives[String(ask.data?.medicId ?? '')]
      if (s.removal && s.removal.ids.includes(op.id) && !s.pending && medic && medic.status === 'active' && medic.wounds > 0) {
        // the core "before removal" drop already put a carried marker down: it stays with the casualty meanwhile
        const placed = new Set(ctx.events.filter((e) => e.type === 'MarkerPlaced' && e.operativeId === op.id).map((e) => (e as { markerId: string }).markerId))
        for (const m of s.markers.filter((k) => placed.has(k.id) && !k.carriedBy && Math.hypot(k.pos.x - op.pos.x, k.pos.z - op.pos.z) < EPS)) {
          m.carriedBy = op.id
          op.flags.carrying = m.id
          ctx.emit({ type: 'MarkerPickedUp', markerId: m.id, operativeId: op.id }, op.seat)
        }
        ctx.raise({
          kind: 'ability.choice',
          seat: op.seat,
          window: 'operative.incapacitated',
          context: { hook: 'ksMedic', operativeId: op.id, step: 'save', medicId: medic.id },
          options: [opt('save', 'ks.medic.save', { medicId: medic.id }), opt('decline', 'ks.medic.decline', { medicId: medic.id })],
        })
        return null
      }
      // the Combat Medic fell too (or nothing can ask now): the rule cannot be used
      removeEffects(ctx, (e) => e.id === ask.id)
    }
    dropDyingMine(ctx, op)
    return null
  },
  'ks.operative.incapacitated',
)

// ---------------------------------------------------------------------------
// Action hooks: move tracking (Rapid Fire), mines, the Fall Back start position (Cover Retreat)
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isKs(s, op)) return null
    const d = c.data as unknown as ActionDeclaredData
    if (d.cancel) return null
    // the Melta Mine's free Dash is offered only right after the Place Marker
    if (s.effects.some((e) => e.kind === FX_MINE_DASH && e.operativeId === op.id)) removeEffects(ctx, (e) => e.kind === FX_MINE_DASH && e.operativeId === op.id)
    if (d.action !== 'fallBack') return null
    // Cover Retreat is judged from where the Fall Back began
    removeEffects(ctx, (e) => e.kind === FX_FROM && e.operativeId === op.id)
    addEffect(ctx, { source: P('cover-retreat'), seat: op.seat, kind: FX_FROM, operativeId: op.id, expires: 'activation', data: { x: op.pos.x, y: op.pos.y, z: op.pos.z } })
    return null
  },
  'ks.action.declared',
)

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s) return null
    const op = c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as { action: string }
    // RAPID FIRE: a move made in the operative's own activation, free ones included
    if (op && isKs(s, op) && MOVE_ACTIONS.includes(d.action)) {
      const base = baseActivation(s)
      if (base && base.operativeId === op.id && !base.counteract && !s.effects.some((e) => e.source === FX_MOVED && e.operativeId === op.id)) {
        addEffect(ctx, { source: FX_MOVED, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation' })
      }
    }
    // MELTA MINE: Place Marker on it (not inside a free action) earns a free Dash, offered in the actionEnded window
    if (op && d.action === PLACE && !s.firefight.activation?.frame && hasAbility(s, op, A('melta-mine'))) {
      const placed = ctx.events.some((e) => e.type === 'MarkerPlaced' && e.operativeId === op.id && s.markers.some((m) => m.id === e.markerId && m.equipmentId === MINE))
      if (placed) addEffect(ctx, { source: A('melta-mine'), seat: op.seat, kind: FX_MINE_DASH, operativeId: op.id, expires: 'activation' })
    }
    // PROXIMITY MINE during the action that just ended; the provider checkMines covers every other move
    triggerMelta(ctx, op?.id)
    return null
  },
  'ks.action.ended',
)

registerHook(
  'afterShootResolved',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isKs(s, op)) return null
    // Concealed Position: any Shoot in which the operative shot uses up the profile (T-KS.16)
    markUsedBattle(s, op.seat, `ks.shot:${op.id}`)
    return null
  },
  'ks.afterShootResolved',
)

// ---------------------------------------------------------------------------
// Weapon rules: Light 'Em Up, Foregrip, Long-Range Scope, Clearance Sweep, Elimination Pattern, Camo Cloak
// ---------------------------------------------------------------------------

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const weapon = s.data.weapons[c.weaponId]
    if (!weapon) return null
    const foe = !!target && target.seat !== op.seat
    if (data.kind === 'shoot' && weapon.type === 'ranged' && isKs(s, op)) {
      // LIGHT 'EM UP: ranged weapons have Severe (T-KS.21)
      if (hasSkill(s, op, 'light-em-up') && !hasRule(rules, 'severe')) {
        rules.push({ rule: 'severe' })
        markFired('ksLightEmUp')
      }
      if (foe && target) {
        // FOREGRIP: Accurate 1 on the datacard's non-pistol ranged weapons against an enemy within 3" (T-KS.34)
        if (equipped(s, op.seat, FOREGRIP) && within(op, target, 3) && onOwnCard(s, op, weapon.id) && !/pistol/i.test(weapon.name)) {
          rules.push({ rule: 'accurate', x: 1 })
          markFired('ksForegrip')
        }
        // LONG-RANGE SCOPE: Saturate once a crit is retained at range (T-KS.35)
        if (scopeActive(s, op, target, weapon.id) && !hasRule(rules, 'saturate')) {
          rules.push({ rule: 'saturate' })
          markFired('ksLongRangeScope')
        }
        // CLEARANCE SWEEP: Ceaseless when both operatives are within 5" of the marker (T-KS.28)
        const sweep = sweepMarker(s, op.seat)
        if (sweep && gapToMarker(bodyOf(op), sweep) <= 5 + EPS && gapToMarker(bodyOf(target), sweep) <= 5 + EPS && !hasRule(rules, 'ceaseless')) {
          rules.push({ rule: 'ceaseless' })
          markFired('ksClearanceSweep')
        }
        // ELIMINATION PATTERN: Piercing Crits 1 (Piercing 1 for the volley gun) against a target with no cover save (T-KS.26)
        if (ployActive(s, op.seat, ELIMINATION) && isHotShot(s, weapon.id) && (cannotRetainCover(s, op, target, weapon.id, rules) || isScanned(s, target, op.seat))) {
          if (weapon.profileGroup === VOLLEY) rules.push({ rule: 'piercing', x: 1 })
          else rules.push({ rule: 'piercing', x: 1, crits: true })
          markFired('ksFlagPloy')
        }
      }
    }
    // CAMO CLOAK: Saturate is ignored against the Sharpshooter (T-KS.17), after the additions above
    if (data.kind === 'shoot' && target && hasAbility(s, target, A('camo-cloak')) && rules.some((r) => ruleKey(r.rule) === 'saturate')) {
      for (let i = rules.length - 1; i >= 0; i--) if (ruleKey(rules[i]!.rule) === 'saturate') rules.splice(i, 1)
      markFired('ksCamoCloak')
    }
    return null
  },
  'ks.modifyWeaponRules',
)

// ---------------------------------------------------------------------------
// Dice: For Cadia! (Atk), Blast Padding and Engage from Cover (re-roll one defence die)
// ---------------------------------------------------------------------------

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId || !hasSkill(s, op, 'for-cadia')) return null
    if (s.data.weapons[c.weaponId]?.type !== 'melee') return null
    const data = c.data as { atk: number }
    if (data.atk < 4) {
      data.atk += 1
      markFired('ksForCadia')
    }
    return null
  },
  'ks.modifyAttackDice',
)

/** A weapon with a sweeping profile in its group is excluded from Blast Padding (T-KS.13). */
function hasSweepingProfile(s: GameState, weaponId: string): boolean {
  const w = s.data.weapons[weaponId]
  if (!w) return false
  if (/sweeping/i.test(w.name)) return true
  return !!w.profileGroup && Object.values(s.data.weapons).some((o) => o.profileGroup === w.profileGroup && /sweeping/i.test(o.name))
}

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { attackerId: string; rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    const attacker = s.operatives[data.attackerId]
    // any shooter: a friendly Blast that catches the Demo-Trooper as a secondary target counts too
    if (hasAbility(s, op, A('blast-padding')) && attacker && attacker.id !== op.id) {
      const rs = ruleSetFor(s, attacker, c.weaponId, 'shoot', op.id)
      if ((rs.blast !== null || rs.torrent !== null) && !hasSweepingProfile(s, c.weaponId)) {
        data.rerolls.push({ id: 'ks.padding', source: A('blast-padding'), mode: 'one', used: false })
        markFired('ksBlastPadding')
      }
    }
    // ENGAGE FROM COVER (T-KS.27): the target is in cover in this sequence
    const seq = s.attack?.seq
    if (isKs(s, op) && ployActive(s, op.seat, ENGAGE_COVER) && s.attack?.kind === 'shoot' && seq && seq.targetId === op.id && seq.cover) {
      data.rerolls.push({ id: 'ks.efc', source: ENGAGE_COVER, mode: 'one', used: false })
      markFired('ksFlagPloy')
    }
    return null
  },
  'ks.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// Damage taken: Blast Padding (b), Ice In Your Veins
// ---------------------------------------------------------------------------

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !op) return null
    const d = c.data as { source: string; amount: number; splash?: boolean }
    // Blast Padding (b): x" Devastating damage never reaches the Demo-Trooper unless it is the target (T-KS.13)
    if (d.splash && d.amount > 0 && hasAbility(s, op, A('blast-padding'))) {
      d.amount = 0
      markFired('ksBlastPadding')
    }
    // Ice In Your Veins: the first Normal Dmg 3+ die of the sequence deals 1 less (T-KS.23)
    const a = s.attack
    if (a && (d.source === 'normal' || d.source === 'strike-normal') && d.amount >= 3 && hasSkill(s, op, 'ice-in-your-veins')) {
      const key = `${a.kind}:${a.index}`
      if (!s.effects.some((e) => e.kind === FX_ICE && e.operativeId === op.id && e.data?.key === key)) {
        addEffect(ctx, { source: A('ice-in-your-veins'), seat: op.seat, kind: FX_ICE, operativeId: op.id, expires: 'action', data: { key } })
        d.amount -= 1
        markFired('ksIceInYourVeins')
      }
    }
    return null
  },
  'ks.onDamageInflicted',
)

// For Cadia! (b): the attacker's first strike in the fight deals 1 extra damage (T-KS.24)
registerHook(
  'beforeStrike',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const a = s?.attack
    if (!s || !ctx || !op || !a || a.kind !== 'fight' || a.operativeId !== op.id || !hasSkill(s, op, 'for-cadia')) return null
    if (s.effects.some((e) => e.source === FX_CADIA_SPENT && e.operativeId === op.id)) return null
    const data = c.data as { amount: number }
    data.amount += 1
    addEffect(ctx, { source: FX_CADIA_SPENT, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'action' })
    markFired('ksForCadia')
    return null
  },
  'ks.beforeStrike',
)

// AUSPEX SCAN: a Kasrkin shooting a scanned enemy ignores the obscured status (T-KS.15)
registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { obscured: boolean; inCover: boolean }
    if (!s || !shooter || !target || !data.obscured || shooter.seat === target.seat || !isKs(s, shooter)) return null
    if (!isScanned(s, target, shooter.seat)) return null
    data.obscured = false
    markFired('ksAuspexScan')
    return null
  },
  'ks.target.status',
)

// The Ready step: Tactical Command tokens and the Clearance Sweep marker go (the skill effects end themselves)
registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    removeTokensWhere(ctx, (t) => t.kind === TC_TOKEN, 'ks.tacticalCommand.ends')
    for (const m of [...ctx.state.markers]) if (m.equipmentId === SWEEP) removeMarker(ctx, m.id, 'ks.clearanceSweep')
    return null
  },
  'ks.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  maxRepeats(state, op, actionId) {
    if (!isKs(state, op)) return null
    // BATTLE COMMS: twice in one activation (T-KS.19)
    if (actionId === ABILITY(A('battle-comms')) && hasAbility(state, op, A('battle-comms'))) return 2
    if (actionId !== 'shoot') return null
    // RAPID FIRE: no move in the activation and Rapid Fire weapons in every Shoot so far (T-KS.25)
    const base = ownActivation(state, op)
    if (!base) return null
    if (base.performed.some((a) => MOVE_ACTIONS.includes(a)) || state.effects.some((e) => e.source === FX_MOVED && e.operativeId === op.id)) return null
    if ((base.weaponsUsed ?? []).some((w) => !isRapid(state, w))) return null
    if (base.performed.includes('shoot')) markFired('ksRapidFire')
    return 2
  },

  actionForbidden(state, op, actionId) {
    if (!isKs(state, op)) return null
    const base = ownActivation(state, op)
    // RAPID FIRE: after two Shoots no move action and no Guard in that activation
    if (base && base.performed.filter((a) => a === 'shoot').length >= 2 && (MOVE_ACTIONS.includes(actionId) || actionId === 'guard')) {
      return 'after two Rapid Fire Shoots the operative cannot move or Guard'
    }
    return null
  },

  // MELTA MINE: never placed within an enemy operative's control range (T-KS.11)
  placeMarkerProblem(state, op, marker, pos) {
    return marker.equipmentId === MINE ? minePlaceProblem(state, op, marker, pos) : null
  },

  // PROXIMITY MINE after every step, forced moves outside actions included (T-KS.12)
  checkMines(ctx) {
    triggerMelta(ctx)
  },

  // Medic!: a casualty it may save waits in the removal queue, where the player is asked (T-KS.9)
  pausableRemoval(state, op) {
    return !!medicAsk(state, op.id)
  },

  // STRIKE FAST: +1" to Reposition (T-KS.22)
  moveLimitDelta(state, op, kind) {
    if (kind !== 'reposition' || !hasSkill(state, op, 'strike-fast')) return 0
    markFired('ksStrikeFast')
    return 1
  },

  weaponForbidden(state, op, weaponId, kind) {
    if (kind !== 'shoot' || !isKs(state, op)) return null
    // CONCEALED POSITION: only the operative's first Shoot of the battle (T-KS.16)
    if (weaponId === CONCEALED && usedThisBattle(state, op.seat, `ks.shot:${op.id}`)) {
      markFired('ksConcealedPosition')
      return 'Concealed Position: that profile can only be used in the first Shoot of the battle'
    }
    // RAPID FIRE: the second Shoot needs a bolt pistol, hot-shot lasgun or hot-shot laspistol (T-KS.25)
    const act = state.firefight.activation
    if (act && !act.frame && !act.counteract && act.operativeId === op.id && act.performed.includes('shoot') && !isRapid(state, weaponId)) {
      return 'Rapid Fire: the second Shoot needs a bolt pistol, hot-shot lasgun or hot-shot laspistol'
    }
    return null
  },

  // CAMO CLOAK (T-KS.17)
  stealthyCover(state, op) {
    if (!hasAbility(state, op, A('camo-cloak'))) return 0
    markFired('ksCamoCloak')
    return 1
  },

  // ADAPTIVE EQUIPMENT: a Smoke and a Stun Grenade per turning point for any Trooper (T-KS.18)
  extraActions(state, op) {
    return hasAbility(state, op, A('adaptive-equipment')) ? [SMOKE, STUN] : []
  },
  ownGrenades(state, op) {
    if (!hasAbility(state, op, A('adaptive-equipment'))) return null
    markFired('ksAdaptiveEquipment')
    return { tpActions: { [SMOKE]: 1, [STUN]: 1 } }
  },

  // GIVE NO GROUND: exactly 2 against exactly 2 gives the Kasrkin control (T-KS.33)
  controlTotal(state, seat, marker, total) {
    const fx = state.effects.find((e) => e.kind === FX_GNG && e.seat === seat && e.data?.markerId === marker.id)
    if (!fx || total !== 2) return null
    let foe = 0
    for (const o of activeOps(state)) {
      if (o.seat === seat || !markerInControlRange(state, bodyOf(o), marker)) continue
      foe += providerControlApl(state, o, marker, effectiveApl(o))
    }
    if (foe !== 2) return null
    markFired('ksGiveNoGround')
    return 3
  },

  // Medic!'s free Dash while the other player is active
  reactions(state, seat) {
    const out: ReactionOffer[] = []
    for (const e of state.effects) {
      if (e.kind !== FX_MEDIC_DASH || e.seat !== seat || !e.operativeId) continue
      const v = state.operatives[e.operativeId]
      if (!v || v.status !== 'active') continue
      out.push({ hook: 'ksMedic', operativeId: v.id, option: 'dash', labelKey: 'ks.medicDash', data: { medicId: e.data?.medicId } })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys
// ---------------------------------------------------------------------------

function pairs(list: readonly Skill[]): string[] {
  const out: string[] = []
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push(`${list[i]}+${list[j]}`)
  return out
}

registerCodeHook({
  name: 'ksSkillAtArms',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      // VETERAN LEADERSHIP: with the Sergeant in the killzone, two different skills instead of one
      return (sergeantIn(state, seat) ? pairs(SKILLS) : [...SKILLS]).map((param) => ({ param }))
    },
    apply(ctx, seat, ploy, seed) {
      const picks = (seed.param ?? '').split('+').filter((k): k is Skill => (SKILLS as readonly string[]).includes(k))
      for (const k of picks) addEffect(ctx, { source: ploy.id, seat, kind: FX_TEAM_SKILL, expires: 'turningPointStart', data: { skill: k } })
      if (picks.length > 1) markFired('ksVeteranLeadership')
      ctx.emit({ type: 'AbilityUsed', operativeId: sergeantIn(ctx.state, seat)?.id ?? null, abilityId: ploy.id, detail: picks.join('+') }, seat)
    },
  },
})

// ELIMINATION PATTERN and ENGAGE FROM COVER are turning point flags the weapon-rule and defence-dice handlers read
registerCodeHook({
  name: 'ksFlagPloy',
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
  name: 'ksClearanceSweep',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return markerSpots(state, seat).map((p) => ({ param: `${p.x},${p.z}` }))
    },
    apply(ctx, seat, _ploy, seed) {
      const [x, z] = (seed.param ?? '0,0').split(',').map(Number) as [number, number]
      placeSweep(ctx, seat, x, z)
    },
  },
})

/** RELOCATE: the pick must be more than 3" from every enemy (T-KS.29). */
function clearOfEnemies(state: GameState, op: Operative): boolean {
  return enemiesOf(state, op).every((e) => !live(e) || gap(op, e) > 3)
}

registerCodeHook({
  name: 'ksRelocate',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.turningPoint <= 1) return []
      return ksOps(state, seat)
        .filter((o) => clearOfEnemies(state, o))
        .map((o) => ({ param: o.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const s = ctx.state
      const pick = seed.param ? s.operatives[seed.param] : undefined
      if (!live(pick)) {
        resumeGambit(ctx)
        return
      }
      // the group is fixed now: the pick, then every other friendly Kasrkin within 3" of it that is also clear of the enemy
      const group = [pick.id, ...ksOps(s, seat).filter((o) => o.id !== pick.id && within(o, pick, 3) && clearOfEnemies(s, o)).map((o) => o.id)]
      relocateNext(ctx, seat, group)
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const remaining = (context.remaining as string[]).slice()
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const rest = remaining.filter((id) => id !== option)
    const started = startFreeAction(ctx, { operativeId: option, action: 'dash', resume: 'ks.relocate', data: { seat, remaining: rest } })
    if (!started) relocateNext(ctx, seat, rest)
  },
})

function relocateNext(ctx: Ctx, seat: Seat, remaining: string[]): void {
  const s = ctx.state
  const able = remaining.filter((id) => live(s.operatives[id]) && canStartFreeAction(s, { operativeId: id, action: 'dash', resume: '' }))
  if (able.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'ksRelocate', operativeId: able[0], seat, remaining: able },
    options: [...able.map((id) => opt(id, 'ks.relocate.dash', { name: s.operatives[id]!.name })), opt('done', 'ks.relocate.done')],
  })
}

registerFrameResume('ks.relocate', (ctx, _outcome, data) => {
  relocateNext(ctx, data.seat as Seat, (data.remaining as string[]) ?? [])
})

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

// SEIZE THE INITIATIVE (T-KS.30): only the player without initiative, as the Firefight phase begins
registerCodeHook({
  name: 'ksSeizeInitiative',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.initiative === null || seat === state.initiative) return []
      return ksOps(state, seat).map((o) => ({ param: o.id }))
    },
    apply(ctx, _seat, _ploy, seed) {
      const id = seed.param ?? seed.operativeId
      // nothing started: the ploy window simply carries on (ploys.ts handlePloy)
      if (id) startDelegatedAction(ctx, { operativeId: id, resume: 'ks.seize', rules: { oneApOnly: true, deny: ['reposition', 'dash', 'fallBack', 'charge'], tag: 'ksSeize' } })
    },
  },
})

registerFrameResume('ks.seize', (ctx) => {
  if (ctx.state.window) continueWindow(ctx)
})

/** Friends that can take Cover Retreat's free Shoot after `r` fell back from `from` (T-KS.31). */
function retreatShooters(s: GameState, r: Operative, from: { x: number; y: number; z: number }): Operative[] {
  const ghost = bodyOf({ ...r, pos: { x: from.x, y: from.y, z: from.z } })
  const out: Operative[] = []
  for (const f of ksOps(s, r.seat)) {
    if (f.id === r.id || !f.ready || inEnemyCr(s, f)) continue
    if (distanceBetween(bodyOf(f), ghost) > 6 + EPS || !visible(s, bodyOf(f), ghost)) continue
    // a Conceal operative may change to Engage to take the Shoot
    const probe = f.order === 'conceal' ? { ...s, operatives: { ...s.operatives, [f.id]: { ...f, order: 'engage' as const } } } : s
    if (!canStartFreeAction(probe, { operativeId: f.id, action: 'shoot', resume: '' })) continue
    out.push(f)
  }
  return out
}

registerCodeHook({
  name: 'ksCoverRetreat',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const r = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(r) || r.seat !== seat || !isKs(state, r) || info.action !== 'fallBack') return []
      const fx = state.effects.find((e) => e.kind === FX_FROM && e.operativeId === r.id)
      if (!fx) return []
      const from = { x: Number(fx.data?.x), y: Number(fx.data?.y), z: Number(fx.data?.z) }
      return retreatShooters(state, r, from).map((f) => ({ param: f.id, operativeId: r.id }))
    },
    apply(ctx, _seat, _ploy, seed) {
      const f = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!live(f)) return
      const previous = f.order
      if (f.order === 'conceal') setOrder(ctx, f, 'engage')
      ctx.emit({ type: 'AbilityUsed', operativeId: f.id, abilityId: P('cover-retreat'), detail: seed.operativeId ?? '' }, f.seat)
      const started = startFreeAction(ctx, { operativeId: f.id, action: 'shoot', resume: 'ploy.freeAction' })
      if (!started && f.order !== previous) setOrder(ctx, f, previous)
    },
  },
})

// NEUTRALISE TARGET (T-KS.32): re-roll any attack dice against a target with no cover save, or a scanned one
registerCodeHook({
  name: 'ksNeutraliseTarget',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const foe = info.targetId ? state.operatives[info.targetId] : undefined
      const a = state.attack
      if (!op || !foe || op.seat !== seat || info.attackerId !== op.id || !isKs(state, op) || foe.seat === seat || !a?.seq || !a.weaponId) return []
      if (!a.seq.atk.dice.some((d) => d.value !== null && !d.rerolled && !d.used)) return []
      const cover = cannotRetainCover(state, op, foe, a.weaponId, scopeLike(state, op, foe, a.weaponId, state.data.weapons[a.weaponId]?.rules ?? []))
      return cover || isScanned(state, foe, seat) ? [{}] : []
    },
    apply(ctx, _seat, ploy) {
      const seq = ctx.state.attack?.seq
      if (!seq) return
      seq.atk.grants.push({ id: 'ks-neutralise', source: ploy.id, mode: 'any', used: false })
      markFired('ksNeutraliseTarget')
    },
  },
})

/** The weapon's rules with Long-Range Scope's Saturate when it would apply to a crit already showing. */
function scopeLike(s: GameState, op: Operative, foe: Operative, weaponId: string, raw: WeaponRuleRef[]): WeaponRuleRef[] {
  const rules = raw.map((r) => ({ ...r }))
  if (scopeActive(s, op, foe, weaponId) && !hasRule(rules, 'saturate')) rules.push({ rule: 'saturate' })
  return rules
}

/**
 * Markers worth GIVE NO GROUND (T-KS.33): objective markers and your own mission markers where the enemy contests with
 * exactly 2 APL and the Kasrkin contest with 2 (at the end of the Firefight phase, when nothing can change) or still
 * can (1 or 2, during an activation).
 */
function gngMarkers(state: GameState, seat: Seat, window: string): Marker[] {
  return state.markers.filter((m) => {
    if (!(m.kind === 'objective' || (m.owner === seat && tracksControl(m)))) return false
    const c = markerControl(state, m)
    const mine = c.apl[seat]
    return c.apl[otherSeat(seat)] === 2 && (window === 'turningPoint.end' ? mine === 2 : mine >= 1 && mine <= 2)
  })
}

registerCodeHook({
  name: 'ksGiveNoGround',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      // during a friendly Kasrkin's own activation (a counteraction is not an activation)
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || !isKs(state, op) || info.counteracting) return []
      return gngMarkers(state, seat, info.window).map((m) => ({ param: m.id }))
    },
    apply(ctx, seat, ploy, seed, info) {
      if (!seed.param) return
      // until the activation ends, or (end of the Firefight phase) until the next turning point starts
      const expires = info.window === 'turningPoint.end' ? 'turningPointStart' : 'activation'
      addEffect(ctx, { source: ploy.id, seat, kind: FX_GNG, expires, data: { markerId: seed.param } })
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id, detail: seed.param }, seat)
    },
  },
})

// ---------------------------------------------------------------------------
// Ploy rules: Reconnoitre Killzone, the free offers (Medic! Dash, Melta Mine Dash, Relics of Cadia), end-of-phase Give
// No Ground
// ---------------------------------------------------------------------------

function free(id: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id, ployId: id.split(':')[0]!, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

const ksPloyRule: PloyRule = {
  extraOffers(state, seat, window, info) {
    const out: PloyOffer[] = []
    // Medic!'s free Dash once the action is over, while the Kasrkin player is the active one
    if (window === 'firefight.actionEnded') {
      const act = state.firefight.activation
      if (act && act.seat === seat) {
        for (const e of state.effects) {
          if (e.kind !== FX_MEDIC_DASH || e.seat !== seat || !e.operativeId || state.operatives[e.operativeId]?.status !== 'active') continue
          out.push({ id: `ks.medicDash@${e.operativeId}`, ployId: 'ks.medicDash', name: 'Medic! free Dash', cost: 0, via: 'ks.medicDash', seed: { param: e.operativeId }, operativeId: e.operativeId })
        }
      }
      // MELTA MINE: a free Dash right after Place Marker on it (T-KS.11)
      const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (subject && subject.seat === seat && info.action === PLACE && live(subject) && mineDashOk(state, subject)) {
        out.push(free(`ks.mineDash:${subject.id}`, 'Melta Mine: free Dash', 'ks.mineDash', subject))
      }
    }
    // RELICS OF CADIA: once per turning point, two or more fails on a Kasrkin's roll (T-KS.36)
    if ((window === 'shoot.attackRolled' || window === 'fight.rolled') && equipped(state, seat, RELICS) && !usedThisTp(state, seat, RELICS)) {
      const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
      const side = subject ? sideOf(state, subject.id) : null
      if (subject && subject.seat === seat && live(subject) && isKs(state, subject) && side && side.weaponId && liveFails(side.dice).length >= 2) {
        out.push(free(RELICS, 'Relics of Cadia: turn two fails into a success', 'ks.relics', subject))
      }
    }
    // GIVE NO GROUND at the end of the Firefight phase, before the turning point is scored
    if (window === 'turningPoint.end' && !usedThisTp(state, seat, GNG) && state.players[seat].cp >= 1) {
      for (const m of gngMarkers(state, seat, window)) out.push({ id: `${GNG}:${m.id}`, ployId: GNG, name: 'GIVE NO GROUND', param: m.id, cost: 1, seed: { param: m.id } })
    }
    return out
  },
  costAdjust(state, _seat, ploy, seed) {
    if (ploy.id !== RELOCATE) return null
    const first = seed.param ? state.operatives[seed.param] : undefined
    return first && state.data.datacards[first.datacardId]?.id === 'ks.recon-trooper' ? { cost: 0, via: 'ks.recon' } : null
  },
  onUsed(ctx, seat, offer) {
    const s = ctx.state
    if (offer.via === 'ks.recon') {
      markFired('ksReconnoitre')
      return
    }
    if (offer.via === 'ks.medicDash') {
      const id = offer.operativeId
      const fx = id ? s.effects.find((e) => e.kind === FX_MEDIC_DASH && e.operativeId === id) : undefined
      if (!id || !fx) return
      removeEffects(ctx, (e) => e.id === fx.id)
      startFreeAction(ctx, { operativeId: id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: 'ploy.freeAction' })
      return
    }
    if (offer.via === 'ks.mineDash') {
      const op = offer.operativeId ? s.operatives[offer.operativeId] : undefined
      if (!op) return
      removeEffects(ctx, (e) => e.kind === FX_MINE_DASH && e.operativeId === op.id)
      const counter = s.firefight.activation?.counteract === true
      startFreeAction(ctx, { operativeId: op.id, action: 'dash', checkPerformed: true, ...(counter ? { maxMove: 2 } : {}), resume: 'ploy.freeAction' })
      return
    }
    if (offer.via === 'ks.relics') {
      const op = offer.operativeId ? s.operatives[offer.operativeId] : undefined
      const side = op ? sideOf(s, op.id) : null
      markUsedTp(s, seat, RELICS)
      markFired('ksRelicsOfCadia')
      if (!op || !side) return
      const fails = liveFails(side.dice)
      const keep = fails[0]
      const drop = fails[1]
      if (keep && drop) {
        keep.value = null
        keep.kind = 'normal'
        keep.tag = 'ks.relics'
        drop.used = true
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: RELICS }, seat)
    }
  },
}

registerPloyRule(ksPloyRule)
