// Scout Squad (docs/spec/13-teams.md section 22, rule ids T-SS.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rule
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - FORWARD SCOUTING (T-SS.16 to 25): provider preBattleChoices (offer hook `ssForwardScouting`), the ledger `ss.fs`
//    (picks and per-option counts), follow-up ability.choice decisions for the spots, and setup.preBattleChoiceDone.
//    Redeploy and the two markers are free-point decisions (markers.raisePointChoice, handlers `ss.redeploy` and
//    `ss.marker`) checked by `redeployProblem` / `markerProblem`; the sampled spots are hints and a pass takes the default
//    (Redeploy: stay; a marker: the suggested spot).
//    Reposition is a real free Reposition whose end is limited by the provider moveProblem.
//  - TRIP ALARM (19) and BOOBY TRAP (20): team markers `ss.tripAlarm`, `ss.boobyTrap`; Seek in modifyWeaponRules and
//    beforeShootTargetSelect, the trap through the provider checkMines (put-back at the trigger, gap moveTruncation).
//  - TACTICAL MANOEUVRE (21) and DIVERSION (22): 0 CP gambit ploys gated on the ledger.
//  - ASTARTES (7) and ASTARTES TRAINING (30): providers maxRepeats, counteract, weaponForbidden, actionCostDelta and a
//    per-activation effect `ss.training`.
//  - Weapon-rule changes (Ambush, Trip Alarm, Track Enemy, Auspex Scan, Grapnel Assault, Targeting Oculars, Heavy Weapon
//    Bipod, Sniper Camo Cloak) all live in the one `modifyWeaponRules` handler so their order is fixed.
//  - Tokens: Optics, Auspex Scan, Track Enemy, Designate Target, Covert Position, Raw Physiology.
//  - Ploys: strategy flags, Adaptable Training and Stealth Relocation (D3 then a choice loop), firefight ploys with
//    their own windows; Targeting Oculars and Tactical Vox-link through the ploy rule.
import { applyAplEffect, hasRule, ruleKey, ruleSetFor, targetInfo, type RuleSet } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { hasAbility, hasKeyword } from '../conditions'
import { aplChangeNextActivation, addEffect, addTpUse, addUse, directDamage, gainCp, markUsedTp, removeEffects, tpUsesOf, usedThisTp, usesOf } from '../effects'
import { canStartFreeAction, cancelAction, finishAction, startFreeAction } from '../firefight'
import { axisOf, discCentres, footprintInsidePolygon, footprintOf } from '../footprint'
import { bearing, distToPolygon } from '../geometry'
import { registerFrameResume, registerHook, type HookContext } from '../hooks'
import { baseUnderVantage, bodyOf, targetVerdict, visible } from '../los'
import { newMarkerId, raisePointChoice, removeMarker } from '../markers'
import { registerPointHandler } from '../point-handlers'
import { distanceBetween, enemiesInControlRange, gapToMarker, isWithin, markerInControlRange } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import type { Ctx } from '../registry'
import { placementSpots } from '../reserve'
import { preBattleChoiceDone } from '../setup'
import { activeOps, enemiesOf, markerRadius, otherSeat } from '../state'
import { resumeGambit } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { placementProblem, terrainOf } from '../terrain'
import { addToken, hasToken } from '../tokens'
import type { GameEvent } from '../events'
import type { Activation, AttackDie, GameState, Marker, Operative, Polygon, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'scout-squad'

const SS = 'SCOUT SQUAD'
const EPS = 1e-6
const MOVE_ACTIONS = ['reposition', 'dash', 'fallBack', 'charge']

const A = (id: string) => `ss.a.${id}`
const P = (id: string) => `ss.p.${id}`
const E = (id: string) => `ss.e.${id}`

const SMOKE = 'core.a.smoke-grenade'
const STUN = 'core.a.stun-grenade'

// Forward Scouting (T-SS.16): six picks, each option with its battle maximum
export const FS = 'ss.fs'
export const FS_LIMIT = 6
export const FS_MAX = {
  redeploy: 1,
  reposition: 2,
  tripAlarm: 2,
  boobyTrap: 1,
  tacticalManoeuvre: 1,
  diversion: 1,
  devisePlan: 1,
  designateTarget: 1,
} as const
export type FsOption = keyof typeof FS_MAX
const FS_NAME: Record<FsOption, string> = {
  redeploy: 'Redeploy',
  reposition: 'Reposition',
  tripAlarm: 'Trip Alarm',
  boobyTrap: 'Booby Trap',
  tacticalManoeuvre: 'Tactical Manoeuvre',
  diversion: 'Diversion',
  devisePlan: 'Devise Plan',
  designateTarget: 'Designate Target',
}
export const FS_OPTIONS = Object.keys(FS_MAX) as FsOption[]

export const TRIP_ALARM = 'ss.tripAlarm'
export const BOOBY_TRAP = 'ss.boobyTrap'
const PT_REDEPLOY = 'ss.redeploy'
const PT_MARKER = 'ss.marker'

export const TOK = {
  optics: 'ss.optics',
  scan: 'ss.auspexScan',
  track: 'ss.trackEnemy',
  target: 'ss.target',
  covert: 'ss.covertPosition',
  raw: 'ss.rawPhysiology',
} as const

const FX_TRAIN = 'ss.training'
const FX_AMBUSH = 'ss.ambushReady'
const FX_ASSAULT = 'ss.grapnelAssault'
const FX_OCULARS = 'ss.oculars'
const FX_MOVED = 'ss.moved'
const FX_REPOS = 'ss.fsRepos'

const GUERRILLA = P('guerrilla-engagement')
const AMBUSH = P('ambush')
const TRAINING = P('astartes-training')
const ASPIRANT = P('emboldened-aspirant')
const CAMO_EQUIP = E('camo-cloak')
const OCULARS = E('targeting-oculars')
const VOX = E('tactical-vox-link')
const VOX_TP = 'ss.voxLink'
const OCULARS_TP = 'ss.oculars'
const GAMBIT_TM = 'ss.gm:tactical-manoeuvre'
const GAMBIT_DIV = 'ss.gm:diversion'

const BOLT = ['ss.w.astartes-shotgun', 'ss.w.bolt-pistol', 'ss.w.boltgun']
const HEAVY_GROUPS = ['ss.wg.heavy-bolter', 'ss.wg.missile-launcher', 'ss.wg.sniper-rifle']

// Rules the data names register their code hook so the engine may find them; the handlers below fire them.
for (const name of ['ssCamoCloak', 'ssTargetingOculars', 'ssVoxLink']) registerCodeHook({ name })

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isSs(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, SS)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function ssOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isSs(state, o))
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

const gap = (a: Operative, b: Operative): number => distanceBetween(bodyOf(a), bodyOf(b))
const within = (a: Operative, b: Operative, inches: number): boolean => gap(a, b) <= inches + EPS
const d3 = (ctx: Ctx, purpose: string): number => Math.ceil(ctx.roll(purpose, 1)[0]! / 2)

function opOfHook(c: HookContext): Operative | undefined {
  return c.state && c.operativeId ? c.state.operatives[c.operativeId] : undefined
}

function isBoltWeapon(weaponId: string): boolean {
  return BOLT.includes(weaponId)
}

function isHeavyWeapon(state: GameState, weaponId: string): boolean {
  const g = state.data.weapons[weaponId]?.profileGroup
  return !!g && HEAVY_GROUPS.includes(g)
}

/** The weapon is printed on the operative's own datacard, not granted by equipment (Heavy Weapon Bipod). */
function onOwnCard(state: GameState, op: Operative, weaponId: string): boolean {
  const card = state.data.datacards[op.datacardId]
  if (!card) return false
  const group = state.data.weapons[weaponId]?.profileGroup
  const has = (id: string) => id === weaponId || (!!group && id === group)
  return card.fixedWeapons.some(has) || (card.legalLoadouts ?? []).some((l) => l.some(has)) || card.weaponOptions.some((o) => o.from.some(has))
}

/** The activation the operative itself is in (a free action frame sits on top of it), or null for a counteraction or none. */
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

/**
 * The operative is the target of the current Shoot and its player took the Vantage improved cover save (R-11.5b: two
 * cover saves, or one as a crit). Camo Cloak (Sniper rule and equipment) is not cumulative with it (T-SS.11, T-SS.34);
 * a player who retained a single cover save did not take the improvement, so a cloak still adds its save.
 */
function vantageImprovementTaken(state: GameState, op: Operative): boolean {
  const seq = state.attack?.kind === 'shoot' ? state.attack.seq : null
  return !!seq && seq.targetId === op.id && seq.improvedCover && (seq.coverMode === 'retainTwo' || seq.coverMode === 'retainCrit')
}

function wounds(state: GameState, op: Operative): number {
  return state.data.datacards[op.datacardId]?.wounds ?? op.maxWounds
}

// ---------------------------------------------------------------------------
// Tokens and tracked enemies: Optics, Auspex Scan, Track Enemy (T-SS.12 to 14)
// ---------------------------------------------------------------------------

/** An enemy is scanned: within 8" of a Tracker of `seat` whose Auspex Scan token is on it (live, no sight needed). */
export function isScanned(state: GameState, foe: Operative, seat: Seat): boolean {
  return activeOps(state).some((r) => r.seat === seat && live(r) && hasToken(state, r.id, TOK.scan, seat) && within(r, foe, 8))
}

function opticsOn(state: GameState, op: Operative): boolean {
  return hasToken(state, op.id, TOK.optics, op.seat)
}

function tracked(state: GameState, foe: Operative, seat: Seat): boolean {
  return hasToken(state, foe.id, TOK.track, seat)
}

function tripAlarms(state: GameState, seat: Seat): Marker[] {
  return state.markers.filter((m) => m.equipmentId === TRIP_ALARM && m.owner === seat)
}

/** Seek and Seek Light a Scout shooter gets against `foe` from Trip Alarm, Track Enemy and Auspex Scan. */
function seekAgainst(state: GameState, op: Operative, foe: Operative): { seek: boolean; seekLight: boolean } {
  const seat = op.seat
  const seek = state.turningPoint <= 2 && tripAlarms(state, seat).some((m) => gapToMarker(bodyOf(foe), m) <= 2 + EPS)
  const seekLight = tracked(state, foe, seat) || (hasKeyword(state, op, 'SNIPER') && opticsOn(state, op) && isScanned(state, foe, seat))
  return { seek, seekLight }
}

registerCodeHook({
  name: 'ssOptics',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      addToken(ctx, op.id, { kind: TOK.optics, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'ss.optics')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'ssAuspexScan',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      addToken(ctx, op.id, { kind: TOK.scan, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'ss.auspexScan')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'ssTrackEnemy',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => live(e) && within(op, e, 8))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const foe = ctx.state.operatives[params.targetId as string]
      if (!live(foe) || foe.seat === op.seat || !within(op, foe, 8)) {
        cancelAction(ctx)
        return
      }
      addToken(ctx, foe.id, { kind: TOK.track, owner: op.seat, cap: 1, sourceId: op.id, expires: ['turningPointEnd'] }, 'ss.trackEnemy')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: foe.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// GUIDANCE AND EXPERIENCE (T-SS.6): a 0 AP unique action, once per activation
registerCodeHook({
  name: 'ssGuidance',
  action: {
    offers(state, op): OfferSeed[] {
      return ssOps(state, op.seat)
        .filter((f) => f.id !== op.id)
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || target.id === op.id || !isSs(ctx.state, target)) {
        cancelAction(ctx)
        return
      }
      aplChangeNextActivation(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Forward Scouting: spots (T-SS.17 to 20)
// ---------------------------------------------------------------------------

function dropZone(state: GameState, seat: Seat): Polygon | null {
  return state.map.dropZones.find((z) => z.id === state.players[seat].dropZoneId)?.polygon ?? null
}

/** Pick `n` points spread apart (farthest-point selection from the first), deterministic. */
function spread(points: Vec2[], n: number): Vec2[] {
  if (points.length <= n) return points
  const out: Vec2[] = [points[0]!]
  const best = points.map((c) => Math.hypot(c.x - out[0]!.x, c.z - out[0]!.z))
  while (out.length < n) {
    let bi = 0
    for (let i = 1; i < points.length; i++) if (best[i]! > best[bi]!) bi = i
    const p = points[bi]!
    out.push(p)
    for (let i = 0; i < points.length; i++) best[i] = Math.min(best[i]!, Math.hypot(points[i]!.x - p.x, points[i]!.z - p.z))
  }
  return out
}

/**
 * Why a Trip Alarm or Booby Trap marker cannot be set up with its centre at `p` (T-SS.19, T-SS.20), or null: wholly in
 * the killzone on its floor, clear of terrain, more than 6" from the opponent's drop zone (measured from the nearest
 * point of the marker). Booby Trap also stays more than 2" from every other marker, access point and Accessible terrain.
 */
export function markerProblem(state: GameState, seat: Seat, kind: 'tripAlarm' | 'boobyTrap', p: Vec2): string | null {
  const hx = state.map.size.x / 2
  const hz = state.map.size.z / 2
  const r = markerRadius({ kind: 'equipment' })
  if (Math.abs(p.x) + r > hx + EPS || Math.abs(p.z) + r > hz + EPS) return 'the marker must be wholly inside the killzone'
  const foe = dropZone(state, otherSeat(seat))
  if (foe && distToPolygon(p, foe) - r <= 6 + EPS) return 'the marker must be more than 6 inches from the opponent drop zone'
  const idx = terrainOf(state.map)
  if (idx.solids.some((sd) => distToPolygon(p, sd.polygon) <= r + EPS)) return 'the marker goes on the killzone floor, clear of terrain'
  if (kind === 'boobyTrap') {
    if (state.markers.some((m) => Math.hypot(m.pos.x - p.x, m.pos.z - p.z) - markerRadius(m) - r <= 2 + EPS)) return 'the Booby Trap must be more than 2 inches from every other marker'
    const accessible = idx.solids.filter((sd) => sd.accessible || sd.partId.includes('door')).map((sd) => sd.polygon)
    if (accessible.some((poly) => distToPolygon(p, poly) - r <= 2 + EPS)) return 'the Booby Trap must be more than 2 inches from access points and Accessible terrain'
  }
  return null
}

/** Sampled legal spots for a team marker on a 2" grid (hints for the free-point decision and the option's gate). */
export function markerSpots(state: GameState, seat: Seat, kind: 'tripAlarm' | 'boobyTrap', max = 16): Vec2[] {
  const hx = state.map.size.x / 2
  const hz = state.map.size.z / 2
  const out: Vec2[] = []
  for (let x = -hx + 1; x <= hx - 1 + 1e-9; x += 2) {
    for (let z = -hz + 1; z <= hz - 1 + 1e-9; z += 2) {
      const p = { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 }
      if (!markerProblem(state, seat, kind, p)) out.push(p)
    }
  }
  return spread(out, max)
}

/** The spot a marker goes to when the player passes the free-point decision: the sampled spot nearest an objective. */
export function defaultMarkerSpot(state: GameState, seat: Seat, kind: 'tripAlarm' | 'boobyTrap'): Vec2 | null {
  const spots = markerSpots(state, seat, kind, 400)
  const objectives = state.markers.filter((m) => m.kind === 'objective')
  const score = (p: Vec2) => (objectives.length === 0 ? Math.hypot(p.x, p.z) : Math.min(...objectives.map((m) => Math.hypot(m.pos.x - p.x, m.pos.z - p.z))))
  let best: Vec2 | null = null
  for (const p of spots) if (!best || score(p) < score(best) - EPS) best = p
  return best
}

/** The Scout operative a Forward Scouting offer is attached to (the leader when it is there). */
function fsOperative(state: GameState, seat: Seat): Operative | undefined {
  const mine = ssOps(state, seat)
  return mine.find((o) => hasKeyword(state, o, 'SERGEANT')) ?? mine[0]
}

function fsLeft(state: GameState, seat: Seat, slug: FsOption): number {
  return FS_MAX[slug] - usesOf(state, seat, `${FS}:${slug}`)
}

/** Operatives wholly within the seat's drop zone that can start a free Reposition. */
function repositionable(state: GameState, seat: Seat): Operative[] {
  const zone = dropZone(state, seat)
  if (!zone) return []
  return ssOps(state, seat).filter((o) => footprintInsidePolygon(footprintOf(o), zone) && canStartFreeAction(state, { operativeId: o.id, action: 'reposition', resume: '' }))
}

/** Sampled spots inside the drop zone an operative could be set up at again (hints for the free-point decision). */
function redeploySpots(state: GameState, op: Operative): Vec3[] {
  const zone = dropZone(state, op.seat)
  if (!zone) return []
  const facing = (p: Vec2) => bearing(p, { x: 0, z: 0 })
  return placementSpots(state, op, { step: 1, max: 10, test: (p) => footprintInsidePolygon(footprintOf(op, p, facing(p)), zone) })
}

/** Why `op` cannot be set up again at `p` (T-SS.17): its base, facing the centre, wholly within the drop zone and placeable. */
export function redeployProblem(state: GameState, op: Operative, p: Vec2): string | null {
  const zone = dropZone(state, op.seat)
  if (!zone) return 'no drop zone'
  const facing = bearing(p, { x: 0, z: 0 })
  const pos: Vec3 = { x: p.x, y: 0, z: p.z }
  if (!footprintInsidePolygon(footprintOf(op, pos, facing), zone)) return 'the operative must be set up wholly within your drop zone'
  const why = placementProblem(state, { id: op.id, pos, radius: op.baseRadius, height: op.height, ...axisOf(op, facing) })
  return why ? why.reason : null
}

function noteFs(ctx: Ctx, seat: Seat, slug: FsOption, op: Operative | undefined): void {
  addUse(ctx.state, seat, FS)
  addUse(ctx.state, seat, `${FS}:${slug}`)
  ctx.emit({ type: 'AbilityUsed', operativeId: op?.id ?? null, abilityId: A('forward-scouting'), detail: slug }, seat)
}

/** The wording of a free-text pre-battle follow-up decision. */
function raiseFs(ctx: Ctx, seat: Seat, op: Operative, step: string, options: ReturnType<typeof opt>[], extra: Record<string, unknown> = {}): void {
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'setup.*',
    context: { hook: 'ssForwardScouting', operativeId: op.id, step, seat, ...extra },
    options,
    canPass: false,
  })
}

function redeployPrompt(ctx: Ctx, seat: Seat, leader: Operative, left: number, done: string[]): void {
  const s = ctx.state
  const able = ssOps(s, seat).filter((o) => !done.includes(o.id))
  if (left <= 0 || able.length === 0) {
    preBattleChoiceDone(ctx)
    return
  }
  raiseFs(
    ctx,
    seat,
    leader,
    'redeploy.op',
    [...able.map((o) => opt(o.id, 'ss.fs.redeployOp', { name: o.name })), opt('done', 'ss.fs.done')],
    { left, done },
  )
}

registerCodeHook({
  name: 'ssForwardScouting',
  choice(ctx, op, option, context) {
    const s = ctx.state
    const seat = op.seat
    const step = String(context.step ?? '')
    // ---- follow-up decisions
    if (step === 'redeploy.op') {
      const left = Number(context.left)
      const done = (context.done as string[]) ?? []
      if (option === 'done') {
        preBattleChoiceDone(ctx)
        return
      }
      const mover = s.operatives[option]
      if (!live(mover) || mover.seat !== seat || done.includes(mover.id)) {
        redeployPrompt(ctx, seat, op, left, done)
        return
      }
      // any legal point of the drop zone (the sampled spots are hints); a pass keeps it where it stands
      raisePointChoice(ctx, {
        handler: PT_REDEPLOY,
        seat,
        window: 'setup.*',
        operativeId: mover.id,
        spots: redeploySpots(s, mover).map((p) => ({ x: p.x, z: p.z })),
        suggestion: { x: mover.pos.x, z: mover.pos.z },
        context: { leaderId: op.id, left, done, moverId: mover.id },
      })
      return
    }
    if (step === 'reposition.op') {
      const mover = s.operatives[option]
      if (!live(mover) || mover.seat !== seat || !startRepositioning(ctx, mover)) refundReposition(ctx, seat)
      return
    }
    if (step === 'designate') {
      const foe = s.operatives[option]
      if (live(foe) && foe.seat !== seat) addToken(ctx, foe.id, { kind: TOK.target, owner: seat, cap: 1, expires: ['battle'] }, 'ss.designateTarget')
      preBattleChoiceDone(ctx)
      return
    }
    // ---- the offered options
    const slug = option as FsOption
    if (!(slug in FS_MAX) || fsLeft(s, seat, slug) <= 0 || usesOf(s, seat, FS) >= FS_LIMIT) {
      preBattleChoiceDone(ctx)
      return
    }
    switch (slug) {
      case 'redeploy': {
        noteFs(ctx, seat, slug, op)
        redeployPrompt(ctx, seat, op, Math.ceil(ssOps(s, seat).length / 3), [])
        return
      }
      case 'reposition': {
        const able = repositionable(s, seat)
        if (able.length === 0) {
          preBattleChoiceDone(ctx)
          return
        }
        noteFs(ctx, seat, slug, op)
        raiseFs(ctx, seat, op, 'reposition.op', able.map((o) => opt(o.id, 'ss.fs.repositionOp', { name: o.name })))
        return
      }
      case 'tripAlarm':
      case 'boobyTrap': {
        const spots = markerSpots(s, seat, slug)
        if (spots.length === 0) {
          preBattleChoiceDone(ctx)
          return
        }
        noteFs(ctx, seat, slug, op)
        // any legal point (the sampled spots are hints); a pass sets it up at the suggested spot
        raisePointChoice(ctx, { handler: PT_MARKER, seat, window: 'setup.*', spots, suggestion: defaultMarkerSpot(s, seat, slug) ?? spots[0]!, context: { kind: slug, leaderId: op.id } })
        return
      }
      case 'designateTarget': {
        const foes = enemiesOf(s, op).filter((e) => live(e))
        if (foes.length === 0) {
          preBattleChoiceDone(ctx)
          return
        }
        noteFs(ctx, seat, slug, op)
        raiseFs(ctx, seat, op, 'designate', foes.map((e) => opt(e.id, 'ss.fs.designate', { name: e.name, wounds: wounds(s, e) })))
        return
      }
      case 'devisePlan':
        noteFs(ctx, seat, slug, op)
        gainCp(ctx, seat, 1, 'ss.devisePlan')
        preBattleChoiceDone(ctx)
        return
      case 'tacticalManoeuvre':
      case 'diversion':
        // unlocks the 0 CP gambit of the same name (the ploys read the ledger)
        noteFs(ctx, seat, slug, op)
        preBattleChoiceDone(ctx)
        return
    }
  },
})

// Free-point decisions of Redeploy and the two markers (markers.registerPointHandler)
registerPointHandler(PT_REDEPLOY, {
  problem(state, _seat, p, context) {
    const mover = state.operatives[String(context.moverId)]
    return live(mover) ? redeployProblem(state, mover, p) : 'that operative is gone'
  },
  done(ctx, seat, p, context) {
    const s = ctx.state
    const mover = s.operatives[String(context.moverId)]
    const leader = s.operatives[String(context.leaderId)]
    const left = Number(context.left)
    const done = [...((context.done as string[]) ?? [])]
    if (live(mover)) {
      // a pass keeps it where it stands (it still counts as set up again, with a Conceal order)
      if (p && !redeployProblem(s, mover, p)) {
        const pos: Vec3 = { x: p.x, y: 0, z: p.z }
        mover.pos = pos
        mover.facing = bearing(pos, { x: 0, z: 0 })
        ctx.emit({ type: 'OperativeDeployed', operativeId: mover.id, pos }, seat)
      }
      setOrder(ctx, mover, 'conceal')
      done.push(mover.id)
    }
    if (leader) redeployPrompt(ctx, seat, leader, left - 1, done)
    else preBattleChoiceDone(ctx)
  },
})

registerPointHandler(PT_MARKER, {
  problem(state, seat, p, context) {
    return markerProblem(state, seat, String(context.kind) as 'tripAlarm' | 'boobyTrap', p)
  },
  done(ctx, seat, p, context) {
    const s = ctx.state
    const kind = String(context.kind) as 'tripAlarm' | 'boobyTrap'
    // a pass sets the marker up at the default spot (the sampled spot nearest an objective)
    const at = p && !markerProblem(s, seat, kind, p) ? p : defaultMarkerSpot(s, seat, kind)
    if (at) {
      const by = String(context.leaderId ?? '')
      const marker: Marker = { id: newMarkerId(ctx, kind === 'tripAlarm' ? 'sstrip' : 'ssboob'), kind: 'equipment', pos: { x: at.x, z: at.z }, owner: seat, carriedBy: null, controller: null, equipmentId: kind === 'tripAlarm' ? TRIP_ALARM : BOOBY_TRAP, ...(by ? { placedBy: by } : {}) }
      s.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: null, pos: { ...marker.pos } }, seat)
    }
    preBattleChoiceDone(ctx)
  },
})

/** A free Reposition that must end wholly within 3" of the drop zone (T-SS.18). */
function startRepositioning(ctx: Ctx, mover: Operative): boolean {
  if (!canStartFreeAction(ctx.state, { operativeId: mover.id, action: 'reposition', resume: '' })) return false
  addEffect(ctx, { source: A('forward-scouting'), seat: mover.seat, kind: FX_REPOS, operativeId: mover.id, expires: FX_REPOS })
  if (startFreeAction(ctx, { operativeId: mover.id, action: 'reposition', resume: 'ss.fsMove', data: { seat: mover.seat } })) return true
  removeEffects(ctx, (e) => e.kind === FX_REPOS && e.operativeId === mover.id)
  return false
}

registerFrameResume('ss.fsMove', (ctx, outcome, data) => {
  removeEffects(ctx, (e) => e.kind === FX_REPOS)
  if (outcome === 'cancelled' && (data.seat === 'A' || data.seat === 'B')) refundReposition(ctx, data.seat)
  else preBattleChoiceDone(ctx)
})

/** Give-backs of a cancelled Reposition pick per battle: a decider that always cancels cannot loop forever. */
const FS_REFUND_CAP = 4
const FS_REFUNDS = `${FS}:refunded`

/**
 * A Forward Scouting Reposition whose free move did not happen (the player cancelled it): no Reposition was resolved,
 * so the pick goes back to both the option's maximum and the six, and the same player picks again (T-SS.18). After
 * FS_REFUND_CAP give-backs in a battle a cancelled pick stays spent.
 */
function refundReposition(ctx: Ctx, seat: Seat): void {
  const s = ctx.state
  if (usesOf(s, seat, FS_REFUNDS) < FS_REFUND_CAP && usesOf(s, seat, `${FS}:reposition`) > 0) {
    addUse(s, seat, FS_REFUNDS)
    addUse(s, seat, FS, -1)
    addUse(s, seat, `${FS}:reposition`, -1)
    // preBattleChoiceDone passes the turn to the other seat of `turn`: point it at the opponent so it comes back here
    const pb = s.setup.preBattle
    if (pb && pb.turn === seat && !pb.done.includes(seat)) pb.turn = otherSeat(seat)
  }
  preBattleChoiceDone(ctx)
}

/** Is the footprint wholly within `inches` of the polygon? (per disc: distance of its centre plus the radius) */
function whollyWithin(op: Operative, pos: Vec3, poly: Polygon, inches: number): boolean {
  return discCentres(footprintOf(op, pos, op.facing)).every((c) => distToPolygon(c, poly) + op.baseRadius <= inches + EPS)
}

// ---------------------------------------------------------------------------
// BOOBY TRAP (T-SS.20): the check after every step, with the put-back at the trigger point
// ---------------------------------------------------------------------------

type MovedEvent = Extract<GameEvent, { type: 'OperativeMoved' }>
interface TrapPoint {
  op: Operative
  pos: Vec3
  ev?: MovedEvent
  seg?: number
}

function trapOnce(ctx: Ctx): boolean {
  const s = ctx.state
  const traps = s.markers.filter((m) => m.equipmentId === BOOBY_TRAP)
  if (traps.length === 0) return false
  const points: TrapPoint[] = []
  for (const ev of ctx.events) {
    if (ev.type !== 'OperativeMoved') continue
    const op = s.operatives[ev.operativeId]
    if (!live(op)) continue
    ev.segments.forEach((seg, i) => points.push({ op, pos: seg.to, ev, seg: i }))
  }
  for (const op of activeOps(s)) points.push({ op, pos: op.pos })
  for (const trap of traps) {
    for (const p of points) {
      const op = p.op
      if (!live(op) || op.seat === trap.owner) continue
      if (!markerInControlRange(s, bodyOf({ ...op, pos: p.pos }), trap)) continue
      removeMarker(ctx, trap.id, 'ss.boobyTrap')
      const dice = ctx.roll('ss.boobyTrap.2d3', 2)
      const damage = dice.reduce((n, x) => n + Math.ceil(x / 2), 0)
      ctx.emit({ type: 'MineTriggered', markerId: trap.id, operativeId: op.id, damage }, trap.owner)
      directDamage(ctx, op.id, damage, trap.id, 'ss.boobyTrap')
      // a survivor's own move stops where it set the trap off (a forced move is no action of its own)
      if (p.ev && p.seg !== undefined && p.ev.action !== 'forced' && live(s.operatives[op.id])) stopMove(ctx, op, p.ev, p.seg)
      return true
    }
  }
  return false
}

/** Cut the operative's latest move back to the end of increment `seg` (or the first later one where its base fits). */
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

// ---------------------------------------------------------------------------
// ASTARTES TRAINING (T-SS.30) helpers
// ---------------------------------------------------------------------------

export type TrainingOption = 'fight' | 'shoot' | 'heavy'

export function trainingOf(state: GameState, op: Operative): TrainingOption | null {
  const fx = state.effects.find((e) => e.kind === FX_TRAIN && e.operativeId === op.id)
  return (fx?.data?.option as TrainingOption | undefined) ?? null
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  maxRepeats(state, op, actionId, performed) {
    if (!isSs(state, op) || (actionId !== 'shoot' && actionId !== 'fight')) return null
    const count = (a: string) => performed.filter((p) => p === a).length
    let best: number | null = null
    // ASTARTES (T-SS.7): two Shoots or two Fights, not both pairs
    if (hasAbility(state, op, A('astartes'))) best = count(actionId === 'shoot' ? 'fight' : 'shoot') >= 2 ? 1 : 2
    // ASTARTES TRAINING (T-SS.30)
    const training = trainingOf(state, op)
    if (training === 'fight' && actionId === 'fight') best = 2
    if ((training === 'shoot' || training === 'heavy') && actionId === 'shoot') best = 2
    return best
  },

  // the Sergeant can counteract whatever its order (T-SS.7)
  counteract(state, op) {
    return isSs(state, op) && hasAbility(state, op, A('astartes')) ? 'any' : null
  },

  weaponForbidden(state, op, weaponId, kind) {
    if (kind !== 'shoot' || !isSs(state, op)) return null
    const training = trainingOf(state, op)
    const act = ownActivation(state, op)
    if (!training || !act || training === 'fight') return null
    if (training === 'heavy') return isHeavyWeapon(state, weaponId) ? null : 'Astartes Training (heavy): both Shoots need a heavy weapon'
    // shoot: when it is the second Shoot, at least one of the two must be a bolt weapon
    if (act.performed.includes('shoot') && !isBoltWeapon(weaponId) && !(act.weaponsUsed ?? []).some(isBoltWeapon)) return 'Astartes Training: at least one of the two Shoots needs a bolt weapon'
    return null
  },

  // the second all-heavy Shoot costs 1 AP more
  actionCostDelta(state, op, actionId) {
    if (actionId !== 'shoot' || !isSs(state, op) || trainingOf(state, op) !== 'heavy') return 0
    const act = ownActivation(state, op)
    return act && act.performed.includes('shoot') ? 1 : 0
  },

  // RAW PHYSIOLOGY (T-SS.31)
  moveDelta(state, op) {
    return isSs(state, op) && hasToken(state, op.id, TOK.raw, op.seat) ? 1 : 0
  },
  flags(state, op) {
    return isSs(state, op) && hasToken(state, op.id, TOK.raw, op.seat) ? { ignoreInjured: true } : null
  },

  // GRAPNEL LAUNCHER (T-SS.9): every climb costs exactly 2"
  moveSurcharge(state, op, _kind, _points, breakdown) {
    if (!isSs(state, op) || !hasAbility(state, op, A('grapnel-launcher'))) return 0
    if (breakdown.climbs && breakdown.climbs.length > 0) return breakdown.climbs.reduce((n, c) => n + (2 - c), 0)
    return breakdown.climb > 2 ? 2 - breakdown.climb : 0
  },

  // CAMO CLOAK, Sniper (T-SS.11) and the equipment (T-SS.34)
  // neither cloak is cumulative with the Vantage improvement: none when the defender took it (two saves or a crit save)
  stealthyCover(state, op) {
    return isSs(state, op) && hasAbility(state, op, A('camo-cloak')) && !vantageImprovementTaken(state, op) ? 1 : 0
  },
  extraCoverSaves(state, op) {
    if (!isSs(state, op) || hasKeyword(state, op, 'SNIPER') || !equipped(state, op.seat, CAMO_EQUIP)) return 0
    if (vantageImprovementTaken(state, op)) return 0
    markFired('ssCamoCloak')
    return 1
  },

  // ADAPTIVE EQUIPMENT (T-SS.15)
  extraActions(state, op) {
    return isSs(state, op) && hasAbility(state, op, A('adaptive-equipment')) ? [SMOKE, STUN] : []
  },
  ownGrenades(state, op) {
    if (!isSs(state, op) || !hasAbility(state, op, A('adaptive-equipment'))) return null
    return { tpActions: { [SMOKE]: 1, [STUN]: 1 } }
  },

  // the combat blade equipment is not for an operative that already has the better datacard blade (T-SS.36)
  equipmentEligible(state, op, equipmentId) {
    if (equipmentId !== E('combat-blade') || !isSs(state, op)) return null
    return op.weapons.includes('ss.w.combat-blade') ? false : null
  },

  // FORWARD SCOUTING (T-SS.16): one offer per option still under its maximum
  preBattleChoices(state, seat) {
    if (state.setup.step !== 'preBattle' || state.players[seat].teamId !== TEAM_ID) return []
    if (usesOf(state, seat, FS) >= FS_LIMIT) return []
    const lead = fsOperative(state, seat)
    if (!lead) return []
    const out: ReactionOffer[] = []
    for (const slug of FS_OPTIONS) {
      const left = fsLeft(state, seat, slug)
      if (left <= 0) continue
      if (slug === 'reposition' && repositionable(state, seat).length === 0) continue
      if ((slug === 'tripAlarm' || slug === 'boobyTrap') && markerSpots(state, seat, slug, 1).length === 0) continue
      if (slug === 'designateTarget' && !enemiesOf(state, lead).some((e) => live(e))) continue
      out.push({ hook: 'ssForwardScouting', operativeId: lead.id, option: slug, labelKey: `ss.fs.${slug}`, data: { slug, left, name: `${FS_NAME[slug]}${FS_MAX[slug] > 1 ? ` (${left} left)` : ''}` } })
    }
    return out
  },

  // the Forward Scouting Reposition ends wholly within 3" of the drop zone (T-SS.18)
  moveProblem(state, op, kind, points) {
    if (kind !== 'reposition' || state.setup.step !== 'preBattle' || !state.effects.some((e) => e.kind === FX_REPOS && e.operativeId === op.id)) return null
    const end = points.at(-1)
    const zone = dropZone(state, op.seat)
    if (!end || !zone) return null
    return whollyWithin(op, end, zone, 3) ? null : 'a Forward Scouting Reposition must end wholly within 3" of your drop zone'
  },

  // BOOBY TRAP (T-SS.20)
  checkMines(ctx) {
    for (let i = 0; i < 4 && trapOnce(ctx); i++);
  },
})

// ---------------------------------------------------------------------------
// Weapon rules
// ---------------------------------------------------------------------------

/** The Heavy Gunner's Bipod applies: no move in its activation, or a counteraction (T-SS.8). */
function bipodActive(s: GameState, op: Operative): boolean {
  const own = ownActivation(s, op)
  if (!own) return true
  return !(own.performed.some((a) => MOVE_ACTIONS.includes(a)) || (op.movedThisActivation ?? 0) > 0 || s.effects.some((e) => e.source === FX_MOVED && e.operativeId === op.id))
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const weapon = s.data.weapons[c.weaponId]
    if (!weapon) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    const has = (key: string) => hasRule(rules, key)
    if (isSs(s, op)) {
      const foe = !!target && target.seat !== op.seat
      // AMBUSH: Balanced, or Ceaseless against an expended target (T-SS.27)
      if (ployActive(s, op.seat, AMBUSH) && s.effects.some((e) => e.kind === FX_AMBUSH && e.operativeId === op.id) && foe && ownActivation(s, op) && !(s.attack?.kind === 'fight' && s.attack.operativeId !== op.id)) {
        if (!target!.ready) {
          if (!has('ceaseless')) rules.push({ rule: 'ceaseless' })
        } else if (!has('balanced')) rules.push({ rule: 'balanced' })
      }
      if (data.kind === 'shoot' && weapon.type === 'ranged' && foe) {
        // TRIP ALARM (Seek), TRACK ENEMY and AUSPEX SCAN (Seek Light)
        const sk = seekAgainst(s, op, target!)
        if (sk.seek && !has('seek')) rules.push({ rule: 'seek' })
        if (sk.seekLight && !has('seeklight')) rules.push({ rule: 'seek-light' })
      }
      // TARGETING OCULARS: Lethal 5+ and Saturate for the action (T-SS.35)
      if (data.kind === 'shoot' && weapon.type === 'ranged' && s.effects.some((e) => e.source === OCULARS && e.operativeId === op.id)) {
        const i = rules.findIndex((r) => ruleKey(r.rule) === 'lethal')
        if (i < 0) rules.push({ rule: 'lethal', target: 5 })
        else if ((rules[i]!.target ?? rules[i]!.x ?? 6) > 5) rules[i] = { ...rules[i]!, rule: 'lethal', target: 5 }
        if (!has('saturate')) rules.push({ rule: 'saturate' })
      }
      // GRAPNEL ASSAULT: Lethal 3+ on melee weapons for the rest of the activation (T-SS.10)
      if (weapon.type === 'melee' && s.effects.some((e) => e.kind === FX_ASSAULT && e.operativeId === op.id)) {
        const i = rules.findIndex((r) => ruleKey(r.rule) === 'lethal')
        if (i < 0) rules.push({ rule: 'lethal', target: 3 })
        else if ((rules[i]!.target ?? rules[i]!.x ?? 6) > 3) rules[i] = { ...rules[i]!, rule: 'lethal', target: 3 }
      }
      // HEAVY WEAPON BIPOD: Ceaseless, or Relentless on top of the Ceaseless Ambush gave (T-SS.8), after Ambush
      if (data.kind === 'shoot' && weapon.type === 'ranged' && hasAbility(s, op, A('heavy-weapon-bipod')) && onOwnCard(s, op, weapon.id) && bipodActive(s, op)) {
        if (has('ceaseless')) {
          if (!has('relentless')) rules.push({ rule: 'relentless' })
        } else rules.push({ rule: 'ceaseless' })
      }
    }
    // CAMO CLOAK: Saturate is ignored against the Sniper (T-SS.11), after every addition above
    if (data.kind === 'shoot' && target && hasAbility(s, target, A('camo-cloak')) && rules.some((r) => ruleKey(r.rule) === 'saturate')) {
      for (let i = rules.length - 1; i >= 0; i--) if (ruleKey(rules[i]!.rule) === 'saturate') rules.splice(i, 1)
    }
    return null
  },
  'ss.modifyWeaponRules',
)

// DESIGNATE TARGET: one attack die re-roll against the marked enemy (T-SS.24)
registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    const foe = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !op || !foe || !isSs(s, op) || foe.seat === op.seat || !hasToken(s, foe.id, TOK.target, op.seat)) return null
    const data = c.data as { rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    data.rerolls.push({ id: 'ss.designate', source: 'ss.designateTarget', mode: 'one', used: false })
    return null
  },
  'ss.modifyAttackDice',
)

// GUERRILLA ENGAGEMENT: a Scout in cover that no enemy within 6" can see re-rolls one defence die (T-SS.26)
registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !isSs(s, op) || !ployActive(s, op.seat, GUERRILLA)) return null
    const seq = s.attack?.seq
    if (s.attack?.kind !== 'shoot' || !seq || seq.targetId !== op.id || !seq.cover) return null
    for (const e of enemiesOf(s, op)) {
      if (live(e) && within(e, op, 6) && visible(s, bodyOf(e), bodyOf(op))) return null
    }
    const data = c.data as { rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    data.rerolls.push({ id: 'ss.guerrilla', source: GUERRILLA, mode: 'one', used: false })
    markFired('ssFlagPloy')
    return null
  },
  'ss.modifyDefenceDice',
)

// OPTICS and AUSPEX SCAN: the shooter ignores the obscured status (T-SS.12, T-SS.14)
registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = opOfHook(c)
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    const data = c.data as { obscured: boolean; inCover: boolean }
    if (!s || !shooter || !target || !data.obscured || shooter.seat === target.seat || !isSs(s, shooter)) return null
    if (hasAbility(s, shooter, A('optics')) && opticsOn(s, shooter)) {
      data.obscured = false
      markFired('ssOptics')
    } else if (isScanned(s, target, shooter.seat)) {
      data.obscured = false
      markFired('ssAuspexScan')
    }
    return null
  },
  'ss.target.status',
)

// ---------------------------------------------------------------------------
// Target selection: Seek and Seek Light make more targets valid; COVERT POSITION removes one (T-SS.19, 13, 14, 33)
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    if (!s || !op) return null
    // COVERT POSITION: a Conceal Scout in cover cannot be selected, whatever Seek or Vantage say, beyond 2" (any shooter)
    if (!data.secondary) {
      data.candidates = data.candidates.filter((id) => {
        const t = s.operatives[id]
        if (!t || t.seat === op.seat || !isSs(s, t) || t.order !== 'conceal' || !hasToken(s, t.id, TOK.covert, t.seat)) return true
        if (within(op, t, 2)) return true
        return !targetVerdict(s, bodyOf(op), { ...bodyOf(t), order: t.order }).inCover
      })
    }
    if (!isSs(s, op) || data.secondary || s.attack?.pointBlank || s.data.weapons[data.weaponId]?.type !== 'ranged') return null
    const base = ruleSetFor(s, op, data.weaponId, 'shoot', undefined, c.engine)
    for (const e of enemiesOf(s, op)) {
      if (!live(e) || data.candidates.includes(e.id)) continue
      const sk = seekAgainst(s, op, e)
      if (!sk.seek && !sk.seekLight) continue
      const rules: RuleSet = { ...base, seek: base.seek || sk.seek, seekLight: base.seekLight || sk.seekLight }
      if (rules.range !== null && !isWithin(bodyOf(op), bodyOf(e), rules.range)) continue
      if (enemiesInControlRange(s, e, e.seat).length > 0) continue
      // the Covert Position ban above also applies to what Seek would add
      if (e.order === 'conceal' && hasToken(s, e.id, TOK.covert, e.seat) && !within(op, e, 2) && targetVerdict(s, bodyOf(op), { ...bodyOf(e), order: e.order }).inCover) continue
      const info = targetInfo(s, op, e, rules)
      if (!info.verdict.visible || info.coverBlocks) continue
      data.candidates.push(e.id)
    }
    return null
  },
  'ss.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// Activation and action hooks: Ambush flag, moved flag (Bipod), Grapnel Assault, Trip Alarm removal
// ---------------------------------------------------------------------------

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = opOfHook(c)
    if (!ctx || !s || !op || !isSs(s, op) || !ployActive(s, op.seat, AMBUSH)) return null
    const d = c.data as { previousOrder?: string; order?: string } | undefined
    const flipped = d?.previousOrder === 'conceal' && d.order === 'engage'
    const unseen = !enemiesOf(s, op).some((e) => live(e) && visible(s, bodyOf(e), bodyOf(op)))
    if ((flipped || unseen) && !s.effects.some((e) => e.kind === FX_AMBUSH && e.operativeId === op.id)) {
      addEffect(ctx, { source: AMBUSH, seat: op.seat, kind: FX_AMBUSH, operativeId: op.id, expires: 'activation' })
    }
    return null
  },
  'ss.activation.start',
)

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = opOfHook(c)
    const d = c.data as { action: string; counteract: boolean }
    if (!ctx || !s || !op || !isSs(s, op)) return null
    const base = baseActivation(s)
    const ownTurn = !!base && base.operativeId === op.id && !base.counteract
    // Heavy Weapon Bipod: a move made in the operative's own activation, free ones included (T-SS.8)
    if (ownTurn && MOVE_ACTIONS.includes(d.action) && !s.effects.some((e) => e.source === FX_MOVED && e.operativeId === op.id)) {
      addEffect(ctx, { source: FX_MOVED, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation' })
    }
    // GRAPNEL ASSAULT: a Charge that climbed, dropped, jumped or went under Vantage (T-SS.10)
    if (ownTurn && !d.counteract && d.action === 'charge' && hasAbility(s, op, A('grapnel-assault')) && !s.effects.some((e) => e.kind === FX_ASSAULT && e.operativeId === op.id)) {
      let hit = false
      let start: Vec3 | null = null
      for (const ev of ctx.events) {
        if (ev.type !== 'OperativeMoved' || ev.operativeId !== op.id) continue
        start ??= ev.from
        for (const sg of ev.segments) {
          if (sg.kind === 'climb' || sg.kind === 'drop' || sg.kind === 'jump') hit = true
          if (baseUnderVantage(s, bodyOf({ ...op, pos: sg.to }))) hit = true
        }
      }
      if (start && baseUnderVantage(s, bodyOf({ ...op, pos: start }))) hit = true
      if (hit) addEffect(ctx, { source: A('grapnel-assault'), seat: op.seat, kind: FX_ASSAULT, operativeId: op.id, expires: 'activation' })
    }
    return null
  },
  'ss.action.ended',
)

// the Ready step of turning point 3: Trip Alarms go (T-SS.19)
registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    if (ctx.state.turningPoint >= 3) for (const m of [...ctx.state.markers]) if (m.equipmentId === TRIP_ALARM) removeMarker(ctx, m.id, 'ss.tripAlarm')
    return null
  },
  'ss.turningPoint.start',
)

// ---------------------------------------------------------------------------
// Strategy ploys
// ---------------------------------------------------------------------------

// GUERRILLA ENGAGEMENT and AMBUSH are turning point flags the handlers above read
registerCodeHook({
  name: 'ssFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

// TACTICAL MANOEUVRE (T-SS.21) and DIVERSION (T-SS.22): 0 CP gambits unlocked by Forward Scouting
function edgeGap(s: GameState, op: Operative): number {
  const hx = s.map.size.x / 2
  const hz = s.map.size.z / 2
  return Math.min(hx - Math.abs(op.pos.x), hz - Math.abs(op.pos.z)) - op.baseRadius
}

registerCodeHook({
  name: 'ssGambit',
  ploy: {
    offers(state, seat, ploy): PloyOfferSeed[] {
      if (ploy.id === P('tactical-manoeuvre')) {
        if (usesOf(state, seat, `${FS}:tacticalManoeuvre`) < 1 || usesOf(state, seat, GAMBIT_TM) >= 2) return []
        return activeOps(state).filter((o) => o.seat === seat && live(o)).map((o) => ({ param: o.id }))
      }
      if (usesOf(state, seat, `${FS}:diversion`) < 1 || usesOf(state, seat, GAMBIT_DIV) >= 1) return []
      return activeOps(state)
        .filter((o) => o.seat !== seat && live(o) && edgeGap(state, o) <= 6 + EPS)
        .map((o) => ({ param: o.id }))
    },
    apply(ctx, seat, ploy, seed) {
      const target = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!live(target)) return
      const tm = ploy.id === P('tactical-manoeuvre')
      addUse(ctx.state, seat, tm ? GAMBIT_TM : GAMBIT_DIV)
      applyAplEffect(ctx, target.id, tm ? 1 : -1, ploy.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: target.id, abilityId: ploy.id }, seat)
    },
  },
})

function clearOfEnemies(state: GameState, op: Operative, inches: number): boolean {
  return enemiesOf(state, op).every((e) => !live(e) || gap(op, e) > inches)
}

// ADAPTABLE TRAINING (T-SS.28): a D3, then up to that many order changes
registerCodeHook({
  name: 'ssAdaptableTraining',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return ssOps(state, seat).some((o) => clearOfEnemies(state, o, 4)) ? [{}] : []
    },
    apply(ctx, seat, ploy) {
      const n = d3(ctx, 'ss.adaptableTraining.d3')
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id, detail: String(n) }, seat)
      adaptableNext(ctx, seat, n, [])
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const left = Number(context.left)
    const done = [...((context.done as string[]) ?? [])]
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const op = ctx.state.operatives[option]
    if (live(op) && op.seat === seat && clearOfEnemies(ctx.state, op, 4)) {
      setOrder(ctx, op, op.order === 'engage' ? 'conceal' : 'engage')
      done.push(op.id)
    }
    adaptableNext(ctx, seat, left - 1, done)
  },
})

function adaptableNext(ctx: Ctx, seat: Seat, left: number, done: string[]): void {
  const s = ctx.state
  const able = ssOps(s, seat).filter((o) => !done.includes(o.id) && clearOfEnemies(s, o, 4))
  if (left <= 0 || able.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'ssAdaptableTraining', operativeId: able[0]!.id, seat, left, done },
    options: [...able.map((o) => opt(o.id, 'ss.adaptable.flip', { name: o.name, order: o.order })), opt('done', 'ss.adaptable.done')],
  })
}

// STEALTH RELOCATION (T-SS.29): a D3, then up to that many free Dashes by the group fixed at use
registerCodeHook({
  name: 'ssStealthRelocation',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.turningPoint <= 1) return []
      return stealthGroup(state, seat).length > 0 ? [{}] : []
    },
    apply(ctx, seat, ploy) {
      const n = d3(ctx, 'ss.stealthRelocation.d3')
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id, detail: String(n) }, seat)
      stealthNext(ctx, seat, n, stealthGroup(ctx.state, seat).map((o) => o.id))
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const left = Number(context.left)
    const remaining = ((context.remaining as string[]) ?? []).slice()
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const rest = remaining.filter((id) => id !== option)
    const started = startFreeAction(ctx, { operativeId: option, action: 'dash', resume: 'ss.stealth', data: { seat, left: left - 1, remaining: rest } })
    if (!started) stealthNext(ctx, seat, left, rest)
  },
})

function stealthGroup(state: GameState, seat: Seat): Operative[] {
  return ssOps(state, seat).filter((o) => o.order === 'conceal' && clearOfEnemies(state, o, 4))
}

function stealthNext(ctx: Ctx, seat: Seat, left: number, remaining: string[]): void {
  const s = ctx.state
  const able = remaining.filter((id) => live(s.operatives[id]) && canStartFreeAction(s, { operativeId: id, action: 'dash', resume: '' }))
  if (left <= 0 || able.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'ssStealthRelocation', operativeId: able[0]!, seat, left, remaining: able },
    options: [...able.map((id) => opt(id, 'ss.stealth.dash', { name: s.operatives[id]!.name })), opt('done', 'ss.stealth.done')],
  })
}

registerFrameResume('ss.stealth', (ctx, _outcome, data) => {
  stealthNext(ctx, data.seat as Seat, Number(data.left), (data.remaining as string[]) ?? [])
})

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

/** The Scout whose activation the ploy window names (not a counteraction). */
function actingScout(state: GameState, seat: Seat, info: { subjectId?: string; counteracting?: boolean }): Operative | null {
  const op = info.subjectId ? state.operatives[info.subjectId] : undefined
  if (!live(op) || op.seat !== seat || !isSs(state, op) || info.counteracting) return null
  return op
}

// ASTARTES TRAINING (T-SS.30)
registerCodeHook({
  name: 'ssAstartesTraining',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = actingScout(state, seat, info)
      const act = op ? ownActivation(state, op) : null
      if (!op || !act || trainingOf(state, op)) return []
      const seeds: PloyOfferSeed[] = [{ param: 'fight' }, { param: 'shoot' }]
      // all-heavy: a heavy weapon on the datacard, and nothing but heavy weapons shot with so far
      const shotLight = (act.weaponsUsed ?? []).some((w) => state.data.weapons[w]?.type === 'ranged' && !isHeavyWeapon(state, w))
      if (!shotLight && op.weapons.some((w) => state.data.weapons[w]?.type === 'ranged' && isHeavyWeapon(state, w))) seeds.push({ param: 'heavy' })
      return seeds
    },
    apply(ctx, seat, ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op || !seed.param) return
      addEffect(ctx, { source: ploy.id, seat, kind: FX_TRAIN, operativeId: op.id, expires: 'activation', data: { option: seed.param } })
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ploy.id, detail: seed.param }, seat)
    },
  },
})

function stateToken(ctx: Ctx, op: Operative, kind: string): void {
  addToken(ctx, op.id, { kind, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation'] }, kind)
}

// RAW PHYSIOLOGY (T-SS.31)
registerCodeHook({
  name: 'ssRawPhysiology',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = actingScout(state, seat, info)
      return op && !hasToken(state, op.id, TOK.raw, seat) ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      stateToken(ctx, op, TOK.raw)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ploy.id }, seat)
    },
  },
})

// COVERT POSITION (T-SS.33)
registerCodeHook({
  name: 'ssCovertPosition',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = actingScout(state, seat, info)
      return op && !hasToken(state, op.id, TOK.covert, seat) ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      if (!op) return
      stateToken(ctx, op, TOK.covert)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ploy.id }, seat)
    },
  },
})

// EMBOLDENED ASPIRANT (T-SS.32)
function aspirantReady(state: GameState, seat: Seat, subject: Operative, info: { attackerId?: string; targetId?: string; kind?: string }): boolean {
  if (info.attackerId !== subject.id) return false
  const side = sideOf(state, subject.id)
  if (!side || !side.dice.some((d: AttackDie) => d.kind === 'normal' && !d.used)) return false
  const a = state.attack
  const foeId = info.kind === 'shoot' ? (a?.targets[0] ?? info.targetId) : info.targetId
  const foe = foeId ? state.operatives[foeId] : undefined
  const first = !Object.values(state.operatives).some((o) => o.seat === seat && o.id !== subject.id && (o.actionsThisTp ?? []).some((x) => x === 'shoot' || x === 'fight'))
  const higher = !!foe && wounds(state, foe) > wounds(state, subject)
  return first || higher
}

registerCodeHook({
  name: 'ssEmboldenedAspirant',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isSs(state, op)) return []
      return aspirantReady(state, seat, op, info) ? [{}] : []
    },
    apply(ctx, seat, ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      const side = op ? sideOf(ctx.state, op.id) : null
      const die = side?.dice.find((d: AttackDie) => d.kind === 'normal' && !d.used)
      if (!op || !die) return
      die.kind = 'crit'
      die.tag = die.tag ?? 'ss.aspirant'
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ploy.id }, seat)
    },
  },
})

// ---------------------------------------------------------------------------
// Ploy rule: Targeting Oculars (0 CP offer) and Tactical Vox-link (cost)
// ---------------------------------------------------------------------------

function voxApplies(state: GameState, seat: Seat): boolean {
  return equipped(state, seat, VOX) && !usedThisTp(state, seat, VOX_TP) && ssOps(state, seat).some((o) => hasKeyword(state, o, 'SERGEANT'))
}

const ssPloyRule: PloyRule = {
  extraOffers(state, seat, window, info): PloyOffer[] {
    const out: PloyOffer[] = []
    // TARGETING OCULARS: twice a turning point, once the Scout's primary target is chosen (T-SS.35)
    if (window === 'shoot.targetSelected' && equipped(state, seat, OCULARS) && tpUsesOf(state, seat, OCULARS_TP) < 2) {
      const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
      const a = state.attack
      if (live(subject) && subject.seat === seat && isSs(state, subject) && a && a.kind === 'shoot' && a.operativeId === subject.id && !state.effects.some((e) => e.source === OCULARS && e.operativeId === subject.id)) {
        out.push({ id: OCULARS, ployId: OCULARS, name: 'Targeting Oculars', operativeId: subject.id, cost: 0, via: 'ss.oculars', seed: {} })
      }
    }
    return out
  },
  costAdjust(state, seat, ploy) {
    if ((ploy.id !== TRAINING && ploy.id !== ASPIRANT) || !voxApplies(state, seat)) return null
    return { cost: 0, via: 'ss.vox' }
  },
  onUsed(ctx, seat, offer) {
    const s = ctx.state
    if (offer.via === 'ss.vox') {
      markUsedTp(s, seat, VOX_TP)
      markFired('ssVoxLink')
      return
    }
    if (offer.via === 'ss.oculars') {
      const op = offer.operativeId ? s.operatives[offer.operativeId] : undefined
      if (!op) return
      addTpUse(s, seat, OCULARS_TP)
      addEffect(ctx, { source: OCULARS, seat, kind: 'equipment', operativeId: op.id, expires: 'action' })
      markFired('ssTargetingOculars')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: OCULARS }, seat)
    }
  },
}
registerPloyRule(ssPloyRule)

