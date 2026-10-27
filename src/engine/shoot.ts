// SHT module: owns `shoot.*`. Shoot (Basic), Blind Fire (Double, Pinned, 360 degrees, -2) and Fire Through Ductway (Basic,
// hits on 5+) as one sequence (R-8, R-9, R-15.9): weapon (and twin sidearms, R-8.10) -> target with priority (R-8.3) or a
// floor point (Blast / Smoke) or a Template direction -> range band and modifiers (R-8.4, R-8.5) -> hit roll (improbable
// shots, R-8.6) -> Firepower dice and Ammo tests (R-8.9, Rapid Fire, Unstable, Grenade, Single Shot) -> Rapid Fire
// allocation -> pinning (R-8.7) -> hits (hits.ts) or stray shots on a miss (R-8.8) or Blast scatter (R-9.3, R-9.4) ->
// weapon states (Out of Ammo, jammed, Limited, spent) -> the action is paid. Doors are targets too (R-15.8).
import { payAndContinue, cancelDeclared } from './activation'
import { insideOutline } from './board'
import { firepowerFace, hitChanceFor, scatterFace, twoD6TestPasses, d6TestPasses } from './dice'
import { ARC_HALF, coverOf, hasLos, hiddenFromRanged, inVisionArc, type CoverLevel } from './los'
import { angleDelta } from './footprint'
import { circleOverlapsPolygon, pointInPolygon, round3 } from './geometry'
import { runHook } from './hooks'
import { baseGap, withinPath } from './measure'
import { blockers } from './los'
import {
  avoidArea,
  fightersUnderBlast,
  hitDoor,
  pinTarget,
  reachableFrom,
  resolveBlastMarker,
  resolveHit,
  segmentClear,
  type HitInput,
} from './hits'
import { takeOutOfAction } from './casualties'
import { rescuedCoolTest } from './morale'
import { stat } from './query'
import { reject, type Ctx, type Handled, type ModuleDef, type OptionInput } from './registry'
import { constants, getFighter, onBoard } from './state'
import {
  blastRadius,
  firepowerDice,
  hasTrait,
  isRangedProfile,
  isTemplate,
  makesWoundRoll,
  meltaApplies,
  profileImplemented,
  profileRanges,
  profileStrength,
  rapidFire,
  T,
} from './traits'
import { ammoCacheNear, ductFireChoices, fightersNear, shootableDoors } from './zm'
import type { Action, ActionCostType, Fighter, GameState, PendingDecision, Polygon, Rejection, RuntimeProfile, Vec2 } from './types'
import type { RangeBand } from './events'

export type ShotMode = 'shoot' | 'blindFire' | 'fireDuct'

const centre = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })
const rej = (code: Rejection['code'], reason: string): Rejection => ({ code, reason })

// ---------------------------------------------------------------------------
// Weapons and profiles
// ---------------------------------------------------------------------------

export function profileOf(state: GameState, weaponId: string, profileId: string): RuntimeProfile | undefined {
  return state.data.weapons[weaponId]?.profiles.find((p) => p.id === profileId)
}

/** Ranged profiles a fighter can fire now: the weapon has ammo, the profile is not lost (Limited) and is implemented. */
export function usableRangedProfiles(state: GameState, f: Fighter): { weaponId: string; profile: RuntimeProfile }[] {
  const out: { weaponId: string; profile: RuntimeProfile }[] = []
  for (const fw of f.weapons) {
    if (fw.ammo !== 'ok') continue
    const w = state.data.weapons[fw.weaponId]
    if (!w) continue
    for (const p of w.profiles) {
      if (fw.lostProfiles.includes(p.id) || !isRangedProfile(p) || !profileImplemented(state, p)) continue
      out.push({ weaponId: fw.weaponId, profile: p })
    }
  }
  return out
}

/** Weapon records that share one ammo state: a weapon and its ammunition upgrades (`<weapon id>.<upgrade>`), ruling. */
export function linkedWeaponIds(f: Fighter, weaponId: string): string[] {
  const ids = f.weapons.map((w) => w.weaponId)
  const base = (id: string) => ids.filter((b) => id === b || id.startsWith(`${b}.`)).sort((a, b) => a.length - b.length)[0] ?? id
  const root = base(weaponId)
  return ids.filter((id) => base(id) === root)
}

// ---------------------------------------------------------------------------
// Range, modifiers, targets
// ---------------------------------------------------------------------------

export interface BandInfo {
  band: RangeBand | null
  short: number | null
  long: number | null
}

/** R-8.4: Short within Short range, Long beyond it up to Long, null beyond Long (no Short range: always Long). */
export function bandFor(state: GameState, f: Fighter, p: RuntimeProfile, distance: number): BandInfo {
  const r = profileRanges(p, stat(state, f.id, 'S'))
  if (r.long === null) return { band: null, ...r }
  if (r.short !== null && distance <= r.short + 1e-9) return { band: 'short', ...r }
  if (distance <= r.long + 1e-9) return { band: 'long', ...r }
  return { band: null, ...r }
}

export interface Modifier {
  label: string
  value: number
}

export interface HitNeed {
  /** final target number on the D6 (7+ = improbable shot) */
  need: number
  /** unmodified BS */
  bs: number
  modifiers: Modifier[]
}

export interface NeedInput {
  mode: ShotMode
  band: RangeBand | null
  cover?: CoverLevel
  target?: Fighter | null
  point?: boolean
  aimed?: boolean
  twin?: boolean
}

/** R-8.5 hit modifiers (as roll modifiers: + helps) and the final need. Fire Through Ductway hits on 5+ whatever they are. */
export function hitNeedFor(state: GameState, shooter: Fighter, p: RuntimeProfile, n: NeedInput): HitNeed {
  const bs = stat(state, shooter.id, 'BS')
  if (n.mode === 'fireDuct') {
    const need = Number.parseInt(String(constants(state).hitModifiers.ductway), 10)
    return { need, bs, modifiers: [{ label: 'ductway', value: 0 }] }
  }
  const k = constants(state).hitModifiers
  const mods: Modifier[] = []
  if (n.target && !n.point) {
    if (n.cover === 'partial') mods.push({ label: 'partialCover', value: k.partialCover })
    if (n.cover === 'full') mods.push({ label: 'fullCover', value: k.fullCover })
    if (n.target.posture === 'standing' && n.target.engagedWith.length > 0) mods.push({ label: 'targetEngaged', value: k.targetEngaged })
    if (n.target.posture !== 'standing' && n.band === 'long') mods.push({ label: 'targetProneAtLong', value: k.targetProneAtLong })
  }
  const acc = n.band === 'short' && p.range.short !== null ? p.acc.short : p.acc.long
  if (acc) mods.push({ label: n.band === 'short' ? 'accuracyShort' : 'accuracyLong', value: acc })
  if (n.aimed) mods.push({ label: 'aim', value: k.aim })
  if (n.point && !hasTrait(p, T.smoke)) mods.push({ label: 'blastAtPoint', value: k.blastAtPoint })
  if (n.mode === 'blindFire') mods.push({ label: 'blindFire', value: k.blindFire })
  if (n.twin) mods.push({ label: 'twinSidearms', value: k.twinSidearm })
  for (const r of runHook('shoot.hitMods', { seat: shooter.seat, state, fighterId: shooter.id, ...(n.target ? { targetId: n.target.id } : {}), data: { band: n.band, mode: n.mode } })) {
    if (r.delta) mods.push({ label: r.reason ?? 'rule', value: r.delta })
  }
  const need = bs - mods.reduce((s, m) => s + m.value, 0)
  return { need, bs, modifiers: mods }
}

export type PriorityClass = 'closest' | 'free' | 'coolTest'

export interface TargetInfo {
  targetId: string
  distance: number
  band: RangeBand | null
  cover: CoverLevel
  need: number
  chance: number
  modifiers: Modifier[]
  priority: PriorityClass
  seriouslyInjured: boolean
}

export interface TargetOpts {
  aimed?: boolean
  twin?: boolean
  /** shared per-call cache of line of sight / cover verdicts */
  cache?: Map<string, { ok: boolean; cover: CoverLevel }>
}

function sight(state: GameState, shooter: Fighter, e: Fighter, mode: ShotMode, cache?: TargetOpts['cache']): { ok: boolean; cover: CoverLevel } {
  const key = `${mode}:${e.id}`
  const hit = cache?.get(key)
  if (hit) return hit
  let v: { ok: boolean; cover: CoverLevel }
  if (!inVisionArc(shooter, e, mode === 'blindFire') || !hasLos(state, shooter, e)) v = { ok: false, cover: 'full' }
  else {
    const cover = coverOf(state, shooter, e).cover
    v = { ok: !hiddenFromRanged(e, cover), cover }
  }
  cache?.set(key, v)
  return v
}

/**
 * Eligible enemy targets of a profile (R-8.2) with the engine numbers and the target-priority class (R-8.3): the closest
 * is free; a farther one is free when every closer one is Seriously Injured or when it is strictly easier to hit than the
 * closest non-Seriously-Injured one; otherwise it needs a Cool test.
 */
export function targetInfos(state: GameState, shooter: Fighter, p: RuntimeProfile, mode: ShotMode, opts: TargetOpts = {}): TargetInfo[] {
  const blast = blastRadius(p) !== null
  const list: TargetInfo[] = []
  for (const e of onBoard(state)) {
    if (e.seat === shooter.seat) continue
    const v = sight(state, shooter, e, mode, opts.cache)
    if (!v.ok) continue
    const distance = round3(baseGap(shooter, e))
    const b = bandFor(state, shooter, p, distance)
    // a Blast beyond Long range is pulled back into range and still goes ahead (R-9.2)
    const band = b.band ?? (blast && b.long !== null ? 'long' : null)
    const n = hitNeedFor(state, shooter, p, { mode, band, cover: v.cover, target: e, aimed: !!opts.aimed, twin: !!opts.twin })
    const chance = band === null ? 0 : hitChanceFor(n.need, n.bs)
    list.push({ targetId: e.id, distance, band, cover: v.cover, need: n.need, chance, modifiers: n.modifiers, priority: 'closest', seriouslyInjured: e.posture === 'seriouslyInjured' })
  }
  list.sort((a, b) => a.distance - b.distance || (a.targetId < b.targetId ? -1 : 1))
  const effNeed = (t: TargetInfo) => (t.band === null ? Infinity : t.need)
  const first = list[0]
  const ref = list.find((t) => !t.seriouslyInjured)
  for (const t of list) {
    if (!first || t.distance <= first.distance + 1e-6) t.priority = 'closest'
    else if (list.every((o) => o.distance >= t.distance - 1e-6 || o.seriouslyInjured)) t.priority = 'free'
    else if (ref && effNeed(t) < effNeed(ref)) t.priority = 'free'
    else t.priority = 'coolTest'
  }
  return list
}

/** The default target a failed priority Cool test redirects to: the closest eligible enemy that is not Seriously Injured. */
export function defaultTarget(infos: readonly TargetInfo[]): TargetInfo | undefined {
  return infos.find((t) => !t.seriouslyInjured) ?? infos[0]
}

/** Profiles that may shoot a door: a wound roll against T5 (not Blast, Template, Smoke, Gas, Toxin or Flash). */
export function canShootDoors(p: RuntimeProfile): boolean {
  return blastRadius(p) === null && !isTemplate(p) && makesWoundRoll(p) && !(p.str.base === 'fixed' && p.str.value <= 0)
}

// ---------------------------------------------------------------------------
// Blast points and scatter (R-9.1 to R-9.4)
// ---------------------------------------------------------------------------

/** Why a floor point cannot be the centre of a Blast (off the board, inside a wall, out of sight or out of the arc). */
export function pointAimProblem(state: GameState, f: Fighter, mode: ShotMode, aim: Vec2): Rejection | null {
  if (!Number.isFinite(aim.x) || !Number.isFinite(aim.z)) return rej('E_SCHEMA', 'the aim point must be finite')
  if (!insideOutline(state.board.def, aim)) return rej('E_OUT_OF_RANGE', 'the point is off the battlefield')
  if (blockers(state).some((poly) => pointInPolygon(aim, poly))) return rej('E_NOT_VISIBLE', 'the point is inside a wall or a closed door')
  const c = centre(f)
  if (!segmentClear(state, c, aim, true)) return rej('E_NOT_VISIBLE', 'no line of sight to that point')
  if (mode !== 'blindFire') {
    const d = Math.hypot(aim.x - c.x, aim.z - c.z)
    if (f.posture !== 'standing') return rej('E_NOT_VISIBLE', 'a Prone fighter has no vision arc')
    if (d > f.baseRadius && Math.abs(angleDelta(f.facing, Math.atan2(aim.x - c.x, aim.z - c.z))) > ARC_HALF + 1e-9) return rej('E_NOT_VISIBLE', 'the point is outside the vision arc')
  }
  return null
}

/** R-9.2: a centre beyond Long range moves straight back toward the shooter until it is in range. */
export function clampToRange(f: Fighter, aim: Vec2, long: number | null): Vec2 {
  if (long === null) return { ...aim }
  const c = centre(f)
  const d = Math.hypot(aim.x - c.x, aim.z - c.z)
  if (d - f.baseRadius <= long + 1e-9 || d === 0) return { ...aim }
  const k = (long + f.baseRadius) / d
  return { x: round3(c.x + (aim.x - c.x) * k), z: round3(c.z + (aim.z - c.z) * k) }
}

export interface AimSuggestion {
  aim: Vec2
  /** fighters the marker or template would hit (enemies and friends) */
  enemies: string[]
  friends: string[]
}

/** Engine aims for a Blast at a floor point: each enemy centre the shooter can see (the hidden ones included). */
export function pointSuggestions(state: GameState, f: Fighter, p: RuntimeProfile, mode: ShotMode): AimSuggestion[] {
  const r = blastRadius(p) ?? constants(state).smoke.radius
  const long = profileRanges(p, stat(state, f.id, 'S')).long
  const out: AimSuggestion[] = []
  for (const e of onBoard(state)) {
    if (e.seat === f.seat) continue
    const aim = centre(e)
    if (pointAimProblem(state, f, mode, aim)) continue
    const under = fightersUnderBlast(state, clampToRange(f, aim, long), r)
    out.push({ aim, enemies: under.filter((g) => g.seat !== f.seat).map((g) => g.id), friends: under.filter((g) => g.seat === f.seat).map((g) => g.id) })
  }
  return out.sort((a, b) => b.enemies.length - a.enemies.length || a.friends.length - b.friends.length)
}

/** Move a missed Blast's centre D6" in the scatter direction, stopping at walls and closed doors (R-9.3, R-9.4). */
function scatter(ctx: Ctx, f: Fighter, from: Vec2): Vec2 | null {
  const s = ctx.state
  const faceRoll = ctx.roll('scatterFace', 1)[0]!
  const face = scatterFace(s, faceRoll)
  const direction = ctx.rollScatter('scatterDirection')
  const distance = ctx.roll('scatterDistance', 1)[0]!
  if (face === 'hit' && distance === 1) {
    const m = ctx.roll('misfire', 1)[0]!
    const to = m === 1 ? centre(f) : null
    ctx.emit({ type: 'BlastScattered', from: { ...from }, to: to ?? { ...from }, distance: 0, direction, misfire: true }, f.seat)
    return to
  }
  const a = (direction * Math.PI) / 180
  const ux = Math.sin(a)
  const uz = Math.cos(a)
  const solid = blockers(s)
  let last = { ...from }
  let removed = false
  for (let t = 0.05; t <= distance + 1e-9; t += 0.05) {
    const c = { x: round3(from.x + ux * Math.min(t, distance)), z: round3(from.z + uz * Math.min(t, distance)) }
    if (solid.some((poly) => pointInPolygon(c, poly))) break
    if (!insideOutline(s.board.def, c)) {
      removed = true
      break
    }
    last = c
  }
  ctx.emit({ type: 'BlastScattered', from: { ...from }, to: { ...last }, distance, direction }, f.seat)
  return removed ? null : last
}

// ---------------------------------------------------------------------------
// Templates (R-9.6)
// ---------------------------------------------------------------------------

export interface TemplateShape {
  origin: Vec2
  direction: number
  polygon: Polygon
}

/** The flame template: narrow end touching the front of the base, 8" long, 0.5" to 2.4" wide, rounded wide end (ruling). */
export function templateShape(state: GameState, f: Fighter, direction: number): TemplateShape {
  const k = constants(state).template
  const ux = Math.sin(direction)
  const uz = Math.cos(direction)
  const px = uz
  const pz = -ux
  const o = { x: f.pos.x + ux * f.baseRadius, z: f.pos.z + uz * f.baseRadius }
  const hn = k.narrowWidth / 2
  const hw = k.wideWidth / 2
  const l1 = k.length - hw
  const cap = { x: o.x + ux * l1, z: o.z + uz * l1 }
  const poly: Polygon = [{ x: o.x + px * hn, z: o.z + pz * hn }]
  for (let i = 0; i <= 8; i++) {
    const th = (i / 8) * Math.PI
    poly.push({ x: cap.x + (px * Math.cos(th) + ux * Math.sin(th)) * hw, z: cap.z + (pz * Math.cos(th) + uz * Math.sin(th)) * hw })
  }
  poly.push({ x: o.x - px * hn, z: o.z - pz * hn })
  return { origin: o, direction, polygon: poly.map((q) => ({ x: round3(q.x), z: round3(q.z) })) }
}

/** The whole template must lie inside the vision arc (Blind Fire: any direction). */
export function templateInArc(f: Fighter, shape: TemplateShape, mode: ShotMode): boolean {
  if (mode === 'blindFire') return true
  if (f.posture !== 'standing') return false
  return shape.polygon.every((q) => Math.abs(angleDelta(f.facing, Math.atan2(q.x - f.pos.x, q.z - f.pos.z))) <= ARC_HALF + 1e-9)
}

/** Fighters under the template with no wall or closed door between them and the shooter; nearest first. */
export function templateVictims(state: GameState, f: Fighter, shape: TemplateShape): Fighter[] {
  return onBoard(state)
    .filter((g) => g.id !== f.id && circleOverlapsPolygon(centre(g), g.baseRadius, shape.polygon) && reachableFrom(state, centre(f), g))
    .sort((a, b) => baseGap(f, a) - baseGap(f, b) || (a.id < b.id ? -1 : 1))
}

function directionOf(f: Fighter, aim: Vec2): number {
  return Math.atan2(aim.x - f.pos.x, aim.z - f.pos.z)
}

export function templateProblem(state: GameState, f: Fighter, mode: ShotMode, aim: Vec2): Rejection | null {
  if (!Number.isFinite(aim.x) || !Number.isFinite(aim.z)) return rej('E_SCHEMA', 'the aim point must be finite')
  if (Math.hypot(aim.x - f.pos.x, aim.z - f.pos.z) < 0.01) return rej('E_SCHEMA', 'the aim point gives no direction')
  if (!templateInArc(f, templateShape(state, f, directionOf(f, aim)), mode)) return rej('E_NOT_VISIBLE', 'the template must lie inside the vision arc')
  return null
}

/** Engine template aims: toward each enemy in reach (turned into the arc as far as it allows) and straight ahead. */
export function templateSuggestions(state: GameState, f: Fighter, mode: ShotMode): AimSuggestion[] {
  const reach = constants(state).template.length + f.baseRadius + 1
  const dirs: number[] = mode === 'blindFire' ? [] : [f.facing]
  let allowed = Math.PI
  if (mode !== 'blindFire') {
    const s0 = templateShape(state, f, f.facing)
    const worst = Math.max(...s0.polygon.map((q) => Math.abs(angleDelta(f.facing, Math.atan2(q.x - f.pos.x, q.z - f.pos.z)))))
    allowed = Math.max(0, ARC_HALF - worst)
  }
  for (const e of onBoard(state)) {
    if (e.seat === f.seat || Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z) - e.baseRadius > reach) continue
    let d = Math.atan2(e.pos.x - f.pos.x, e.pos.z - f.pos.z)
    if (mode !== 'blindFire') {
      const off = angleDelta(f.facing, d)
      d = f.facing + Math.max(-allowed, Math.min(allowed, off))
    }
    dirs.push(d)
  }
  const seen = new Set<string>()
  const out: AimSuggestion[] = []
  for (const d of dirs) {
    const key = round3(d).toFixed(3)
    if (seen.has(key)) continue
    seen.add(key)
    const shape = templateShape(state, f, d)
    if (!templateInArc(f, shape, mode)) continue
    const v = templateVictims(state, f, shape)
    out.push({ aim: { x: round3(f.pos.x + Math.sin(d) * 5), z: round3(f.pos.z + Math.cos(d) * 5) }, enemies: v.filter((g) => g.seat !== f.seat).map((g) => g.id), friends: v.filter((g) => g.seat === f.seat).map((g) => g.id) })
  }
  return out.filter((s) => s.aim && templateProblem(state, f, mode, s.aim) === null).sort((a, b) => b.enemies.length - a.enemies.length || a.friends.length - b.friends.length)
}

// ---------------------------------------------------------------------------
// What a fighter can shoot with now
// ---------------------------------------------------------------------------

export interface AttackOption {
  weaponId: string
  profileId: string
  twinWith?: string
  /** an Unwieldy weapon makes the Shoot a Double action */
  cost: ActionCostType
  targets: number
  doors: number
  point: boolean
  template: boolean
}

function twinProfile(state: GameState, f: Fighter, weaponId: string): RuntimeProfile | undefined {
  return usableRangedProfiles(state, f).find((u) => u.weaponId === weaponId && hasTrait(u.profile, T.sidearm) && blastRadius(u.profile) === null && !isTemplate(u.profile))?.profile
}

/** Every weapon / profile (and twin pair) that has something to shoot at, for the mode and the actions left. */
export function attackOptions(state: GameState, f: Fighter, mode: ShotMode, actionsLeft: number, ductId?: string): AttackOption[] {
  const out: AttackOption[] = []
  const cache: TargetOpts['cache'] = new Map()
  const duct = mode === 'fireDuct' ? ductFireChoices(state, f).find((d) => d.ductId === ductId) : undefined
  if (mode === 'fireDuct' && !duct) return out
  const usable = usableRangedProfiles(state, f)
  for (const { weaponId, profile: p } of usable) {
    const unwieldy = hasTrait(p, T.unwieldy) && mode !== 'blindFire'
    const cost: ActionCostType = unwieldy ? 'double' : mode === 'blindFire' ? 'double' : 'basic'
    if (cost === 'double' && actionsLeft < 2) continue
    const base = { weaponId, profileId: p.id, cost, targets: 0, doors: 0, point: false, template: false }
    if (duct) {
      out.push({ ...base, targets: duct.targets.length, template: isTemplate(p) })
      continue
    }
    if (isTemplate(p)) {
      if (templateSuggestions(state, f, mode).some((s) => s.enemies.length > 0)) out.push({ ...base, template: true })
      continue
    }
    const targets = targetInfos(state, f, p, mode, { cache }).length
    const doors = canShootDoors(p) ? shootableDoors(state, f, mode === 'blindFire').length : 0
    const point = (blastRadius(p) !== null || hasTrait(p, T.smoke)) && pointSuggestions(state, f, p, mode).length > 0
    if (targets + doors > 0 || point) out.push({ ...base, targets, doors, point })
  }
  // twin sidearms (R-8.10): two different Sidearm weapons at one target, -1 to hit each
  if (!duct) {
    const sidearms = [...new Set(usable.filter((u) => hasTrait(u.profile, T.sidearm) && blastRadius(u.profile) === null && !isTemplate(u.profile)).map((u) => u.weaponId))]
    for (let i = 0; i < sidearms.length; i++) {
      for (let j = i + 1; j < sidearms.length; j++) {
        const a = sidearms[i]!
        const b = sidearms[j]!
        const second = twinProfile(state, f, b)
        if (!second) continue
        for (const u of usable.filter((x) => x.weaponId === a && hasTrait(x.profile, T.sidearm) && blastRadius(x.profile) === null && !isTemplate(x.profile))) {
          const targets = targetInfos(state, f, u.profile, mode, { cache, twin: true }).length
          if (targets > 0) out.push({ weaponId: a, profileId: u.profile.id, twinWith: b, cost: mode === 'blindFire' ? 'double' : 'basic', targets, doors: 0, point: false, template: false })
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The sequence state (state.attack.data)
// ---------------------------------------------------------------------------

interface ShotSpec {
  weaponId: string
  profileId: string
  twin: boolean
}

type TargetSpec =
  | { kind: 'fighter'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'point'; x: number; z: number }
  | { kind: 'template'; x: number; z: number }
  | { kind: 'ductTemplate' }

interface AllocState {
  hits: number
  extra: string[]
  candidates: string[]
  hitRoll: number
  firstTarget: string
  /** Blast + Rapid Fire: the first marker's centre (each extra hit is another marker centred on its target) */
  blast: Vec2 | null
}

interface AmmoNote {
  weaponId: string
  profileId: string
  fails: number
  spend: boolean
}

interface ShootData {
  mode: ShotMode
  actionKey: string
  cost: ActionCostType
  ductId: string | null
  far: Vec2 | null
  aimed: boolean
  shots: ShotSpec[]
  shotIndex: number
  target: TargetSpec | null
  aimKind: 'point' | 'template' | null
  alloc: AllocState | null
  ammo: AmmoNote[]
  unstable: boolean
}

function data(state: GameState): ShootData {
  return state.attack!.data as unknown as ShootData
}

function shooterOf(state: GameState): Fighter {
  return getFighter(state, state.attack!.attackerId)
}

function shotProfile(state: GameState, shot: ShotSpec): RuntimeProfile {
  return profileOf(state, shot.weaponId, shot.profileId)!
}

// ---------------------------------------------------------------------------
// Starting and cancelling
// ---------------------------------------------------------------------------

const ACTION_KEY: Record<ShotMode, string> = { shoot: 'shoot', blindFire: 'blindFire', fireDuct: 'fireDuct' }

/** Called by activation.ts once Shoot, Blind Fire or Fire Through Ductway is declared. */
export function startRangedAttack(ctx: Ctx, f: Fighter, mode: ShotMode, ductId?: string): void {
  const s = ctx.state
  const act = s.action.activation!
  const duct = mode === 'fireDuct' ? ductFireChoices(s, f).find((d) => d.ductId === ductId) : undefined
  const d: ShootData = {
    mode,
    actionKey: ACTION_KEY[mode],
    cost: s.data.actions[ACTION_KEY[mode]]!.type,
    ductId: ductId ?? null,
    far: duct ? { ...duct.far } : null,
    aimed: act.aimed,
    shots: [],
    shotIndex: 0,
    target: null,
    aimKind: null,
    alloc: null,
    ammo: [],
    unstable: false,
  }
  s.attack = { kind: 'shoot', attackerId: f.id, stage: 'weapon', targets: [], hitQueue: [], reactions: [], data: d as unknown as Record<string, unknown> }
  const options = attackOptions(s, f, mode, act.actionsLeft, ductId)
  if (options.length === 0) {
    cancelAttack(ctx)
    return
  }
  if (options.length === 1) {
    pickWeapon(ctx, options[0]!)
    return
  }
  ctx.raise({
    kind: 'shoot.weapon',
    seat: f.seat,
    window: 'action.declared',
    context: { fighterId: f.id, mode },
    options: options.map((o) => ({
      id: `${o.weaponId}:${o.profileId}${o.twinWith ? `+${o.twinWith}` : ''}`,
      labelKey: o.twinWith ? 'shoot.weapon.twin' : 'shoot.weapon',
      type: 'shoot.weapon' as const,
      payload: { weaponId: o.weaponId, profileId: o.profileId, ...(o.twinWith ? { twinWith: o.twinWith } : {}) },
      data: { cost: o.cost, targets: o.targets, doors: o.doors, point: o.point, template: o.template },
    })),
    canPass: true,
  })
}

/** Nothing rolled yet: drop the attack and give the action back. */
function cancelAttack(ctx: Ctx): void {
  ctx.state.attack = null
  cancelDeclared(ctx)
}

function pickWeapon(ctx: Ctx, o: { weaponId: string; profileId: string; twinWith?: string }): void {
  const s = ctx.state
  const d = data(s)
  const f = shooterOf(s)
  const p = profileOf(s, o.weaponId, o.profileId)!
  d.shots = [{ weaponId: o.weaponId, profileId: o.profileId, twin: !!o.twinWith }]
  if (o.twinWith) {
    const second = twinProfile(s, f, o.twinWith)!
    d.shots.push({ weaponId: o.twinWith, profileId: second.id, twin: true })
  }
  if (hasTrait(p, T.unwieldy) && d.mode !== 'blindFire') d.cost = 'double'
  for (const shot of d.shots) ctx.emit({ type: 'ShootStarted', fighterId: f.id, weaponId: shot.weaponId, profileId: shot.profileId, mode: d.mode }, f.seat)
  raiseTarget(ctx)
}

// ---------------------------------------------------------------------------
// Target and aim decisions
// ---------------------------------------------------------------------------

function raiseTarget(ctx: Ctx): void {
  const s = ctx.state
  const d = data(s)
  const f = shooterOf(s)
  const shot = d.shots[0]!
  const p = shotProfile(s, shot)
  s.attack!.stage = 'target'
  if (d.mode === 'fireDuct') {
    if (isTemplate(p)) {
      d.target = { kind: 'ductTemplate' }
      runShots(ctx)
      return
    }
    const duct = ductFireChoices(s, f).find((x) => x.ductId === d.ductId)!
    const need = hitNeedFor(s, f, p, { mode: 'fireDuct', band: 'short' })
    ctx.raise({
      kind: 'shoot.target',
      seat: f.seat,
      window: 'action.declared',
      context: { fighterId: f.id, weaponId: shot.weaponId, profileId: shot.profileId, mode: d.mode, ductId: d.ductId },
      options: duct.targets.map((id) => ({ id: `t:${id}`, labelKey: 'shoot.target.fighter', type: 'shoot.target' as const, payload: { targetId: id }, data: { need: need.need, chance: hitChanceFor(need.need, need.bs), priority: 'free', modifiers: need.modifiers } })),
      canPass: true,
    })
    return
  }
  if (isTemplate(p)) {
    d.aimKind = 'template'
    s.attack!.stage = 'aim'
    ctx.raise({
      kind: 'shoot.aim',
      seat: f.seat,
      window: 'shoot.targetDeclared',
      context: { fighterId: f.id, weaponId: shot.weaponId, profileId: shot.profileId, kind: 'template', mode: d.mode, suggestions: templateSuggestions(s, f, d.mode) },
      canPass: true,
    })
    return
  }
  const infos = targetInfos(s, f, p, d.mode, { aimed: d.aimed, twin: shot.twin })
  const closest = defaultTarget(infos)
  const options: OptionInput[] = infos.map((t) => ({
    id: `t:${t.targetId}`,
    labelKey: 'shoot.target.fighter',
    type: 'shoot.target',
    payload: { targetId: t.targetId },
    data: { distance: t.distance, band: t.band, cover: t.cover, need: t.need, chance: t.chance, priority: t.priority, modifiers: t.modifiers, coolTest: t.priority === 'coolTest' ? { need: stat(s, f.id, 'Cl') } : null },
  }))
  if (canShootDoors(p) && !shot.twin) {
    for (const door of shootableDoors(s, f, d.mode === 'blindFire')) {
      const b = bandFor(s, f, p, door.distance)
      options.push({ id: `door:${door.doorId}`, labelKey: 'shoot.target.door', type: 'shoot.target', payload: { doorId: door.doorId }, data: { distance: door.distance, band: b.band, auto: b.band !== null } })
    }
  }
  if ((blastRadius(p) !== null || hasTrait(p, T.smoke)) && pointSuggestions(s, f, p, d.mode).length > 0) {
    const n = hitNeedFor(s, f, p, { mode: d.mode, band: 'long', point: true, aimed: d.aimed })
    options.push({ id: 'point', labelKey: 'shoot.target.point', type: 'shoot.target', payload: { point: true }, data: { needAtLong: n.need, radius: blastRadius(p) ?? constants(s).smoke.radius } })
  }
  ctx.raise({
    kind: 'shoot.target',
    seat: f.seat,
    window: 'action.declared',
    context: { fighterId: f.id, weaponId: shot.weaponId, profileId: shot.profileId, mode: d.mode, closest: closest?.targetId ?? null, twin: d.shots.length > 1 },
    options,
    canPass: true,
  })
}

function raisePointAim(ctx: Ctx): void {
  const s = ctx.state
  const d = data(s)
  const f = shooterOf(s)
  const shot = d.shots[0]!
  const p = shotProfile(s, shot)
  d.aimKind = 'point'
  s.attack!.stage = 'aim'
  ctx.raise({
    kind: 'shoot.aim',
    seat: f.seat,
    window: 'shoot.targetDeclared',
    context: {
      fighterId: f.id,
      weaponId: shot.weaponId,
      profileId: shot.profileId,
      kind: 'blast',
      mode: d.mode,
      radius: blastRadius(p) ?? constants(s).smoke.radius,
      long: profileRanges(p, stat(s, f.id, 'S')).long,
      suggestions: pointSuggestions(s, f, p, d.mode),
    },
    canPass: true,
  })
}

/** `suggest` for shoot.aim: the engine's best aim. */
export function suggestAim(state: GameState, pending: PendingDecision): Action | null {
  const sug = (pending.context.suggestions as AimSuggestion[] | undefined)?.[0]
  if (!sug) return pending.canPass ? { type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} } : null
  return { type: 'shoot.aim', seat: pending.seat, decisionId: pending.id, payload: { x: sug.aim.x, z: sug.aim.z } }
}

// ---------------------------------------------------------------------------
// Resolving the shots
// ---------------------------------------------------------------------------

/** Resolve the remaining shots (one, or two for twin sidearms); stops when a Rapid Fire allocation is asked for. */
function runShots(ctx: Ctx): void {
  const s = ctx.state
  const d = data(s)
  s.attack!.stage = 'resolve'
  while (d.shotIndex < d.shots.length) {
    if (resolveShot(ctx, d.shots[d.shotIndex]!)) return
    d.shotIndex++
    d.alloc = null
  }
  finishAttack(ctx)
}

function rollToHit(ctx: Ctx, need: number, bs: number): { hit: boolean; natural: number; dice: number[]; improbable: boolean } {
  const r1 = ctx.roll('hit', 1)[0]!
  if (need > 6) {
    if (r1 !== 6) return { hit: false, natural: r1, dice: [r1], improbable: true }
    const r2 = ctx.roll('improbable', 1)[0]!
    return { hit: d6TestPasses(r2, bs), natural: r2, dice: [r1, r2], improbable: true }
  }
  return { hit: d6TestPasses(r1, need), natural: r1, dice: [r1], improbable: false }
}

/** Firepower dice and the Ammo tests they force (R-8.9), Unstable, Grenade and Single Shot bookkeeping; returns bullet holes. */
function rollFirepower(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile): number {
  const s = ctx.state
  const d = data(s)
  const note: AmmoNote = { weaponId: shot.weaponId, profileId: shot.profileId, fails: 0, spend: false }
  d.ammo.push(note)
  const n = firepowerDice(p)
  let holes = 0
  let symbols = 0
  if (n > 0) {
    const raw = ctx.roll('firepower', n, 'firepower')
    const faces = raw.map((r) => firepowerFace(s, r))
    holes = faces.reduce((a, x) => a + x.hits, 0)
    symbols = faces.filter((x) => x.ammo).length
    ctx.emit({ type: 'FirepowerRolled', fighterId: f.id, faces: raw.map((r) => s.data.dice.firepower[r - 1] ?? String(r)), hits: holes, ammoSymbols: symbols }, f.seat)
  }
  const grenade = hasTrait(p, T.grenade)
  const tests = grenade && p.ammo !== null ? 1 : symbols
  for (let i = 0; i < tests && p.ammo !== null; i++) {
    const cache = ammoCacheNear(s, f)
    const bonus = cache ? constants(s).casket.ammoCache.ammoBonus : 0
    const roll = ctx.roll('ammo', 1)[0]!
    const passed = roll + bonus >= p.ammo
    let result = passed ? 'passed' : 'failed'
    if (cache && roll === constants(s).casket.ammoCache.exhaustedOn) {
      s.board.caskets[cache]!.state = 'exhausted'
      result += ',cacheExhausted'
    }
    ctx.emit({ type: 'AmmoTest', fighterId: f.id, weaponId: shot.weaponId, roll, need: p.ammo, passed, result }, f.seat)
    if (!passed) note.fails++
  }
  if (grenade && note.fails > 0) note.spend = true
  if (hasTrait(p, T.singleShot)) note.spend = true
  // Unstable: an Ammo symbol (always, for a grenade) means a D6; on 1-3 the shooter goes Out of Action after the attack
  if (hasTrait(p, T.unstable) && (symbols > 0 || grenade)) {
    const roll = ctx.roll('unstable', 1)[0]!
    const blown = roll <= 3
    ctx.emit({ type: 'AmmoTest', fighterId: f.id, weaponId: shot.weaponId, roll, need: 4, passed: !blown, result: blown ? 'unstable:outOfAction' : 'unstable:held' }, f.seat)
    if (blown) d.unstable = true
  }
  return holes
}

function hitInputFor(state: GameState, f: Fighter, shot: ShotSpec, p: RuntimeProfile, t: Fighter, hitRoll: number | null): HitInput {
  const S = stat(state, f.id, 'S')
  const r = profileRanges(p, S)
  return {
    attackerId: f.id,
    targetId: t.id,
    weaponId: shot.weaponId,
    strength: profileStrength(p, S),
    ap: p.ap,
    damage: p.dmg,
    traits: p.traits,
    hitRoll,
    knockFrom: centre(f),
    melta: meltaApplies(p, baseGap(f, t), r.short),
    saveVs: null,
    coverBonus: 0,
    from: centre(f),
    saves: true,
    cause: shot.weaponId,
  }
}

/** Resolve one shot; true when it is waiting on a `shoot.allocate` decision. */
function resolveShot(ctx: Ctx, shot: ShotSpec): boolean {
  const s = ctx.state
  const d = data(s)
  const f = shooterOf(s)
  const p = shotProfile(s, shot)
  const target = d.target!
  switch (target.kind) {
    case 'door':
      doorShot(ctx, f, shot, p, target.id)
      return false
    case 'template':
      templateShot(ctx, f, shot, p, { x: target.x, z: target.z })
      return false
    case 'ductTemplate':
      ductTemplateShot(ctx, f, shot, p)
      return false
    case 'point':
      return blastShot(ctx, f, shot, p, null, { x: target.x, z: target.z })
    case 'fighter':
      if (blastRadius(p) !== null || hasTrait(p, T.smoke)) return blastShot(ctx, f, shot, p, target.id, null)
      return directShot(ctx, f, shot, p, target.id)
  }
}

function declared(ctx: Ctx, f: Fighter, body: { targetId?: string; doorId?: string; point?: Vec2; distance: number; band: RangeBand | null; cover: CoverLevel; need: number | null; modifiers: Modifier[] }): void {
  ctx.emit({ type: 'TargetDeclared', fighterId: f.id, ...body }, f.seat)
}

function directShot(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, targetId: string): boolean {
  const s = ctx.state
  const d = data(s)
  const t = s.fighters[targetId]!
  if (t.location !== 'board') return false // the twin shot's target is already gone
  const distance = round3(baseGap(f, t))
  const b = d.mode === 'fireDuct' ? { band: 'short' as RangeBand } : bandFor(s, f, p, distance)
  const cover = d.mode === 'fireDuct' ? 'none' : coverOf(s, f, t).cover
  const n = hitNeedFor(s, f, p, { mode: d.mode, band: b.band, cover, target: t, aimed: d.aimed, twin: shot.twin })
  declared(ctx, f, { targetId, distance, band: b.band, cover, need: n.need, modifiers: n.modifiers })
  if (b.band === null) {
    // beyond Long range: an automatic miss, the Firepower dice is still rolled (R-8.4, R-8.9); no stray shots (ruling)
    ctx.emit({ type: 'HitRolled', fighterId: f.id, targetId, dice: [], need: n.need, hit: false }, f.seat)
    rollFirepower(ctx, f, shot, p)
    return false
  }
  const roll = rollToHit(ctx, n.need, n.bs)
  ctx.emit({ type: 'HitRolled', fighterId: f.id, targetId, dice: roll.dice, need: n.need, hit: roll.hit, ...(roll.improbable ? { improbable: true } : {}) }, f.seat)
  const holes = rollFirepower(ctx, f, shot, p)
  const rf = rapidFire(p) > 0
  if (!roll.hit) {
    if (d.mode !== 'fireDuct') strayShots(ctx, f, shot, p, t, rf ? holes : 1)
    return false
  }
  const hits = rf ? holes : 1
  if (hits <= 0) return false
  const candidates = hits > 1 ? allocCandidates(s, f, p, t, n.need, d, shot) : []
  // R-8.7 pinning comes with the hit, before any wound roll (Gas never pins)
  if (!hasTrait(p, T.gas)) pinTarget(ctx, t, f.id)
  if (candidates.length > 0) {
    d.alloc = { hits, extra: [], candidates, hitRoll: roll.natural, firstTarget: t.id, blast: null }
    raiseAllocate(ctx)
    return true
  }
  resolveDirectHits(ctx, f, shot, p, Array.from({ length: hits }, () => t.id), roll.natural)
  return false
}

/** Hits of one shot on fighters (allocated in order): every target pinned first (R-8.7), then each hit resolved. */
function resolveDirectHits(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, targets: string[], hitRoll: number): void {
  const s = ctx.state
  if (!hasTrait(p, T.gas)) for (const id of new Set(targets)) pinTarget(ctx, s.fighters[id]!, f.id)
  for (const id of targets) {
    const t = s.fighters[id]!
    if (t.location !== 'board') continue
    resolveHit(ctx, hitInputFor(s, f, shot, p, t, hitRoll))
  }
}

/** Rapid Fire extra hits (R-14.3): other enemies within 3" of the first target, in range and sight, not harder to hit. */
function allocCandidates(state: GameState, f: Fighter, p: RuntimeProfile, first: Fighter, need: number, d: ShootData, shot: ShotSpec): string[] {
  const radius = constants(state).radii.rapidFireExtraHit
  if (d.mode === 'fireDuct') {
    const far = d.far!
    return fightersNear(state, far, constants(state).radii.interact)
      .filter((g) => g.seat !== f.seat && g.id !== first.id && withinPath(state, first, g, radius))
      .map((g) => g.id)
  }
  return targetInfos(state, f, p, d.mode, { aimed: d.aimed, twin: shot.twin })
    .filter((t) => t.targetId !== first.id && t.band !== null && t.need <= need && withinPath(state, first, state.fighters[t.targetId]!, radius))
    .map((t) => t.targetId)
}

function raiseAllocate(ctx: Ctx): void {
  const s = ctx.state
  const d = data(s)
  const a = d.alloc!
  const f = shooterOf(s)
  ctx.raise({
    kind: 'shoot.allocate',
    seat: f.seat,
    window: 'shoot.firepowerRolled',
    context: { fighterId: f.id, hits: a.hits, hit: a.extra.length + 2, firstTarget: a.firstTarget, allocated: a.extra.slice() },
    options: [a.firstTarget, ...a.candidates].map((id) => ({ id: `t:${id}`, labelKey: 'shoot.allocate', type: 'shoot.allocate' as const, payload: { targetId: id } })),
  })
}

/** R-8.8 stray shots: fighters Engaged with the target or within 1" of the line of fire, closest to the shooter first. */
function strayShots(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, t: Fighter, checks: number): void {
  const s = ctx.state
  const k = constants(s).strayShot
  const a = centre(f)
  const b = centre(t)
  const seg = (q: Vec2) => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz || 1
    const u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / len2))
    return Math.hypot(a.x + dx * u - q.x, a.z + dz * u - q.z)
  }
  const atRisk = onBoard(s)
    .filter((g) => g.id !== f.id && g.id !== t.id && (t.engagedWith.includes(g.id) || seg(centre(g)) - g.baseRadius <= k.radius + 1e-9))
    .sort((x, y) => baseGap(f, x) - baseGap(f, y) || (x.id < y.id ? -1 : 1))
    .map((g) => g.id)
  if (atRisk.length === 0) return
  for (let i = 0; i < checks; i++) {
    for (const id of atRisk) {
      const g = s.fighters[id]!
      if (g.location !== 'board') continue
      const roll = ctx.roll('stray', 1)[0]!
      const hit = roll <= k.hitOnAtMost
      ctx.emit({ type: 'StrayShot', fighterId: f.id, candidateId: id, roll, hit }, f.seat)
      if (!hit) continue
      if (!hasTrait(p, T.gas)) pinTarget(ctx, g, f.id)
      resolveHit(ctx, hitInputFor(s, f, shot, p, g, null))
      break
    }
  }
}

function placeSmoke(ctx: Ctx, at: Vec2): void {
  const s = ctx.state
  const id = `smoke:${s.seq}:${s.board.smoke.length}`
  const radius = constants(s).smoke.radius
  s.board.smoke.push({ id, pos: { ...at }, radius, placedRound: s.round })
  ctx.emit({ type: 'SmokePlaced', smokeId: id, pos: { ...at }, radius }, null)
}

function blastShot(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, targetId: string | null, point: Vec2 | null): boolean {
  const s = ctx.state
  const d = data(s)
  const t = targetId ? s.fighters[targetId]! : null
  if (t && t.location !== 'board') return false
  const smoke = hasTrait(p, T.smoke)
  const radius = blastRadius(p) ?? constants(s).smoke.radius
  const long = profileRanges(p, stat(s, f.id, 'S')).long
  const chosen = t ? centre(t) : point!
  const at = d.mode === 'fireDuct' ? chosen : clampToRange(f, chosen, long)
  const distance = round3(t ? baseGap(f, t) : Math.max(0, Math.hypot(at.x - f.pos.x, at.z - f.pos.z) - f.baseRadius))
  const b = d.mode === 'fireDuct' ? ({ band: 'short' } as const) : bandFor(s, f, p, distance)
  const band = b.band ?? 'long'
  const cover = t && d.mode !== 'fireDuct' ? coverOf(s, f, t).cover : 'none'
  const n = hitNeedFor(s, f, p, { mode: d.mode, band, cover, target: t, point: !t, aimed: d.aimed, twin: shot.twin })
  declared(ctx, f, { ...(t ? { targetId: t.id } : { point: { ...at } }), distance, band, cover, need: n.need, modifiers: n.modifiers })
  const roll = rollToHit(ctx, n.need, n.bs)
  ctx.emit({ type: 'HitRolled', fighterId: f.id, targetId: t?.id ?? null, dice: roll.dice, need: n.need, hit: roll.hit, ...(roll.improbable ? { improbable: true } : {}) }, f.seat)
  const holes = rollFirepower(ctx, f, shot, p)
  let finalCentre: Vec2 | null = at
  if (!roll.hit) finalCentre = scatter(ctx, f, at)
  if (!finalCentre) return false // a dud, or the marker left the battlefield
  ctx.emit({ type: 'BlastPlaced', centre: { ...finalCentre }, radius }, f.seat)
  if (smoke) {
    placeSmoke(ctx, finalCentre)
    return false
  }
  // Blast + Rapid Fire: each extra hit is another marker on an enemy within 3" of the first (FAQ; ruling)
  const hits = roll.hit && rapidFire(p) > 0 ? holes : 1
  if (roll.hit && hits > 1 && t) {
    const candidates = allocCandidates(s, f, p, t, n.need, d, shot)
    if (candidates.length === 0) {
      resolveMarkers(ctx, f, shot, p, Array.from({ length: hits }, () => finalCentre!), roll.natural)
      return false
    }
    d.alloc = { hits, extra: [], candidates, hitRoll: roll.natural, firstTarget: t.id, blast: finalCentre }
    raiseAllocate(ctx)
    return true
  }
  resolveMarkers(ctx, f, shot, p, [finalCentre], roll.hit ? roll.natural : null)
  return false
}

function resolveMarkers(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, centres: Vec2[], hitRoll: number | null): void {
  const s = ctx.state
  const radius = blastRadius(p)!
  for (const c of centres) {
    resolveBlastMarker(ctx, {
      centre: c,
      radius,
      pins: true,
      by: f.id,
      make: (g) => hitInputFor(s, f, shot, p, g, hitRoll),
    })
  }
}

function templateShot(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, aim: Vec2): void {
  const s = ctx.state
  const shape = templateShape(s, f, directionOf(f, aim))
  ctx.emit({ type: 'TemplatePlaced', polygon: shape.polygon.map((q) => ({ ...q })) }, f.seat)
  declared(ctx, f, { point: { ...aim }, distance: 0, band: null, cover: 'none', need: null, modifiers: [] })
  rollFirepower(ctx, f, shot, p)
  // Dodge (`blast.victims`): a fighter whose save succeeds may step clear before it is decided whether it is hit
  const victims = avoidArea(ctx, templateVictims(s, f, shape), { kind: 'template', by: f.id, hitAt: (g, pos) => circleOverlapsPolygon(pos, g.baseRadius, shape.polygon) })
  resolveAutoHits(ctx, f, shot, p, victims, true)
}

function ductTemplateShot(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile): void {
  const s = ctx.state
  const d = data(s)
  const far = d.far!
  const r = constants(s).duct.templateRadius
  const ring: Polygon = Array.from({ length: 16 }, (_, i) => ({ x: round3(far.x + Math.sin((i / 16) * 2 * Math.PI) * r), z: round3(far.z + Math.cos((i / 16) * 2 * Math.PI) * r) }))
  ctx.emit({ type: 'TemplatePlaced', polygon: ring }, f.seat)
  declared(ctx, f, { point: { ...far }, distance: 0, band: null, cover: 'none', need: null, modifiers: [] })
  rollFirepower(ctx, f, shot, p)
  resolveAutoHits(ctx, f, shot, p, fightersNear(s, far, r).filter((g) => g.id !== f.id), false)
}

/** Template hits: every fighter under it, Pinned first (not by Gas), cover from the shooter as a save bonus (R-9.7). */
function resolveAutoHits(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, victims: Fighter[], coverBonus: boolean): void {
  const s = ctx.state
  if (!hasTrait(p, T.gas)) for (const g of victims) pinTarget(ctx, g, f.id)
  const k = constants(s).coverSave
  for (const g of victims) {
    if (g.location !== 'board') continue
    const cover = coverBonus ? coverOf(s, f, g).cover : 'none'
    const bonus = cover === 'full' ? k.full : cover === 'partial' ? k.partial : 0
    resolveHit(ctx, { ...hitInputFor(s, f, shot, p, g, null), saveVs: 'template', coverBonus: bonus })
  }
}

function doorShot(ctx: Ctx, f: Fighter, shot: ShotSpec, p: RuntimeProfile, doorId: string): void {
  const s = ctx.state
  const door = shootableDoors(s, f, data(s).mode === 'blindFire').find((x) => x.doorId === doorId)
  const distance = door?.distance ?? 0
  const b = bandFor(s, f, p, distance)
  declared(ctx, f, { doorId, distance, band: b.band, cover: 'none', need: null, modifiers: [] })
  // R-15.8: a closed door is hit automatically (beyond Long range it is still missed, R-8.4)
  ctx.emit({ type: 'HitRolled', fighterId: f.id, targetId: null, dice: [], need: 0, hit: b.band !== null }, f.seat)
  const holes = rollFirepower(ctx, f, shot, p)
  if (b.band === null) return
  const hits = rapidFire(p) > 0 ? holes : 1
  const S = profileStrength(p, stat(s, f.id, 'S'))
  for (let i = 0; i < hits; i++) hitDoor(ctx, doorId, S, p.dmg, p.traits)
}

/** Weapon states after the attack (R-8.9, R-14.3), Unstable, then pay for the action. */
function finishAttack(ctx: Ctx): void {
  const s = ctx.state
  const d = data(s)
  const f = shooterOf(s)
  const set = (weaponId: string, ammo: 'out' | 'jammed' | 'spent') => {
    const fw = f.weapons.find((w) => w.weaponId === weaponId)
    if (!fw || fw.ammo === ammo || fw.ammo === 'jammed' || fw.ammo === 'spent') return
    fw.ammo = ammo
    ctx.emit({ type: 'WeaponStateChanged', fighterId: f.id, weaponId, ammo }, f.seat)
  }
  for (const note of d.ammo) {
    const p = profileOf(s, note.weaponId, note.profileId)!
    const fw = f.weapons.find((w) => w.weaponId === note.weaponId)!
    if (note.spend) {
      set(note.weaponId, 'spent')
      continue
    }
    if (note.fails >= 2 && rapidFire(p) > 0) {
      for (const id of linkedWeaponIds(f, note.weaponId)) set(id, 'jammed')
      continue
    }
    if (note.fails >= 1) {
      if (hasTrait(p, T.limited) && !fw.lostProfiles.includes(p.id)) fw.lostProfiles.push(p.id)
      for (const id of linkedWeaponIds(f, note.weaponId)) set(id, 'out')
      const w = s.data.weapons[note.weaponId]!
      if (w.profiles.every((q) => fw.lostProfiles.includes(q.id))) set(note.weaponId, 'spent')
    }
  }
  if (d.unstable) takeOutOfAction(ctx, f, null, 'unstable')
  ctx.emit({ type: 'ShootEnded', fighterId: f.id }, f.seat)
  const act = s.action.activation!
  act.aimed = false
  const key = d.actionKey
  const cost = d.cost
  s.attack = null
  payAndContinue(ctx, f, key, false, cost)
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function handle(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (!state.attack || state.attack.kind !== 'shoot') return reject('E_WRONG_DECISION', 'no shooting attack is in progress')
  if (action.type === 'pass') {
    if (pending.kind === 'shoot.allocate') return reject('E_PASS_NOT_ALLOWED', 'every hit must be allocated')
    return { run: (ctx) => cancelAttack(ctx) }
  }
  switch (action.type) {
    case 'shoot.weapon': {
      const p = action.payload
      return { run: (ctx) => pickWeapon(ctx, p) }
    }
    case 'shoot.target': {
      const p = action.payload
      const opt = pending.options?.find((o) => o.action.type === 'shoot.target' && (o.action.payload as typeof p).targetId === p.targetId && (o.action.payload as typeof p).doorId === p.doorId && !!(o.action.payload as typeof p).point === !!p.point)
      const priority = opt?.data?.priority as PriorityClass | undefined
      const closest = pending.context.closest as string | null | undefined
      return {
        run(ctx) {
          const s = ctx.state
          const d = data(s)
          const f = shooterOf(s)
          if (p.point) {
            raisePointAim(ctx)
            return
          }
          if (p.doorId) {
            d.target = { kind: 'door', id: p.doorId }
            runShots(ctx)
            return
          }
          let id = p.targetId!
          if (priority === 'coolTest' && closest) {
            // R-8.3: a farther target that is not easier to hit needs a Cool test; a fail shoots the closest instead
            let mod = 0
            for (const r of runHook('test.modify', { seat: f.seat, state: s, engine: ctx, fighterId: f.id, data: { test: 'cool', reason: 'targetPriority' } })) if (r.delta) mod += r.delta
            const total = ctx.roll('priorityCool', 1, '2d6')[0]!
            const need = stat(s, f.id, 'Cl')
            let passed = twoD6TestPasses(total, need, mod)
            if (!passed && rescuedCoolTest(ctx, f, 'targetPriority')) passed = true
            ctx.emit({ type: 'PriorityTest', fighterId: f.id, roll: total, need, passed, ...(passed ? {} : { redirectedTo: closest }) }, f.seat)
            if (!passed) id = closest
          }
          d.target = { kind: 'fighter', id }
          runShots(ctx)
        },
      }
    }
    case 'shoot.aim': {
      const p = action.payload
      const f = getFighter(state, state.attack.attackerId)
      const d = state.attack.data as unknown as ShootData
      const aim = { x: p.x, z: p.z }
      const problem = d.aimKind === 'template' ? templateProblem(state, f, d.mode, aim) : pointAimProblem(state, f, d.mode, aim)
      if (problem) return { rejection: problem }
      return {
        run(ctx) {
          const dd = data(ctx.state)
          dd.target = dd.aimKind === 'template' ? { kind: 'template', x: round3(aim.x), z: round3(aim.z) } : { kind: 'point', x: round3(aim.x), z: round3(aim.z) }
          runShots(ctx)
        },
      }
    }
    case 'shoot.allocate': {
      const id = action.payload.targetId
      return {
        run(ctx) {
          const s = ctx.state
          const d = data(s)
          const a = d.alloc!
          a.extra.push(id)
          if (a.extra.length < a.hits - 1) {
            raiseAllocate(ctx)
            return
          }
          const f = shooterOf(s)
          const shot = d.shots[d.shotIndex]!
          const p = shotProfile(s, shot)
          if (a.blast) {
            resolveMarkers(ctx, f, shot, p, [a.blast, ...a.extra.map((x) => centre(s.fighters[x]!))], a.hitRoll)
          } else {
            resolveDirectHits(ctx, f, shot, p, [a.firstTarget, ...a.extra], a.hitRoll)
          }
          d.shotIndex++
          d.alloc = null
          runShots(ctx)
        },
      }
    }
    default:
      return reject('E_WRONG_DECISION', `expected ${pending.kind}, got ${action.type}`)
  }
}

export const shootModule: ModuleDef = {
  id: 'shoot',
  namespaces: ['shoot'],
  handle,
}

