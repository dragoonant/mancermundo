// query.*: every number or verdict the UI and the AI read (00 section 7.6). S2 holds status, stat, engagement, distances,
// line of sight, vision arc and cover; `actionMenu` is added from activation.ts by index.ts (`query.actionMenu`). S3a adds
// the shooting numbers (targets with priority, hit / wound / save / injury odds, expected outcome, blast and template
// previews); S3b/S4 extend it with the fight, nerve, bottle and scenario numbers.
import { runHook } from './hooks'
import { coverOf, hasLos, inVisionArc, losLines, type CoverResult, type SightLine } from './los'
import { baseGap, pathGap } from './measure'
import { constants, getFighter, isBroken } from './state'
import type { Fighter, GameState, RuntimeProfile, StatKey, Vec2 } from './types'
import {
  attackOptions,
  bandFor,
  clampToRange,
  hitNeedFor,
  pointAimProblem,
  profileOf,
  targetInfos,
  templateProblem,
  templateShape,
  templateVictims,
  type AttackOption,
  type ShotMode,
  type TargetInfo,
} from './shoot'
import {
  expectedDamage,
  firepowerHitsDistribution,
  hitChanceFor,
  injuryOdds as injuryOddsTable,
  parseDiceExpr,
  saveChanceFor,
  toxinChance,
  woundChanceFor,
  woundNeed,
  type InjuryOdds,
} from './dice'
import { armourSave, type SaveInfo } from './wargear'
import { fightersUnderBlast } from './hits'
import { blastRadius, hasTrait, isTemplate, meltaApplies, profileRanges, profileStrength, rapidFire, T as TRAIT } from './traits'

export type DerivedStatus = 'standingActive' | 'standingEngaged' | 'pinned' | 'seriouslyInjured' | 'outOfAction'

/** Target-number characteristics: a lower stored number is better, a "+1" improves it (R-2.6). */
const TARGET_NUMBER: ReadonlySet<StatKey> = new Set(['WS', 'BS', 'I', 'Ld', 'Cl', 'Wil', 'Int'])

export function isTargetNumber(key: StatKey): boolean {
  return TARGET_NUMBER.has(key)
}

/** Status as the rules name it, a pure function of the state (Broken is a condition, see `isBroken`). */
export function status(state: GameState, id: string): DerivedStatus {
  const f = getFighter(state, id)
  if (f.location !== 'board') return 'outOfAction'
  if (f.posture === 'seriouslyInjured') return 'seriouslyInjured'
  if (f.posture === 'pinned') return 'pinned'
  return f.engagedWith.length > 0 ? 'standingEngaged' : 'standingActive'
}

/**
 * Effective characteristic: the printed value, Flesh Wounds on T (it may reach 0 or below, which is Out of Action, R-2.7),
 * Concussion on I (never worse than 6+), then `stat.modify` hooks (delta is added to a plain number and improves a target
 * number, so a hook's `+1` is always good for the fighter).
 */
export function stat(state: GameState, id: string, key: StatKey): number {
  const f = getFighter(state, id)
  let v = f.stats[key]
  if (key === 'T') v -= f.fleshWounds
  if (key === 'I' && f.conditions.concussion) {
    const c = constants(state).concussion
    const worst = Number.parseInt(c.worstInitiative, 10)
    v = Math.max(v, Math.min(worst, v - c.initiativeModifier))
  }
  const results = runHook('stat.modify', { seat: f.seat, state, fighterId: id, data: { key, value: v } })
  for (const r of results) if (r.delta) v += isTargetNumber(key) ? -r.delta : r.delta
  return v
}

/** Ids of the enemies the fighter is Engaged with. */
export function engagedWith(state: GameState, id: string): string[] {
  return getFighter(state, id).engagedWith.slice()
}

/** Straight base-edge distance (ranges). */
export function distance(state: GameState, aId: string, bId: string): number {
  return baseGap(getFighter(state, aId), getFighter(state, bId))
}

/** Path proximity base-edge distance (never through walls or closed doors, R-1.9 ruling). */
export function pathDistance(state: GameState, aId: string, bId: string): number {
  return pathGap(state, getFighter(state, aId), getFighter(state, bId))
}

/** Is the target inside the viewer's 90 degree arc (any part of its base)? Prone viewers have none. */
export function inArc(state: GameState, viewerId: string, targetId: string): boolean {
  return inVisionArc(getFighter(state, viewerId), getFighter(state, targetId))
}

export function cover(state: GameState, attackerId: string, targetId: string): CoverResult {
  return coverOf(state, getFighter(state, attackerId), getFighter(state, targetId))
}

export interface LosLine {
  from: string
  to: string
  /** at least one sample line is clear of walls, closed doors and smoke */
  los: boolean
  inArc: boolean
  distance: number
  /** the 17 line-of-sight sample lines with what stopped each */
  lines: SightLine[]
  cover: CoverResult
}

/** Everything the client draws for a sight line between two fighters. */
export function losLine(state: GameState, fromId: string, toId: string): LosLine {
  const a = getFighter(state, fromId)
  const b = getFighter(state, toId)
  return {
    from: fromId,
    to: toId,
    los: hasLos(state, a, b),
    inArc: inVisionArc(a, b),
    distance: baseGap(a, b),
    lines: losLines(state, { x: a.pos.x, z: a.pos.z }, b),
    cover: coverOf(state, a, b),
  }
}

export function broken(state: GameState, id: string): boolean {
  return isBroken(getFighter(state, id))
}

export type { Fighter }

// ---------------------------------------------------------------------------
// Shooting numbers (S3a)
// ---------------------------------------------------------------------------

function needProfile(state: GameState, weaponId: string, profileId: string): RuntimeProfile {
  const p = profileOf(state, weaponId, profileId)
  if (!p) throw new Error(`unknown weapon profile ${weaponId}/${profileId}`)
  return p
}

function aimedNow(state: GameState, shooterId: string): boolean {
  const a = state.action.activation
  return !!a && a.fighterId === shooterId && a.aimed
}

/** What a fighter can shoot with now (weapon, profile, twin pairs) for a mode. */
export function shootOptions(state: GameState, fighterId: string, mode: ShotMode = 'shoot', ductId?: string): AttackOption[] {
  const f = getFighter(state, fighterId)
  const a = state.action.activation
  const left = a && a.fighterId === fighterId ? a.actionsLeft : 2
  return attackOptions(state, f, mode, left, ductId)
}

/** Eligible targets of a weapon profile with priority class, range band, cover, final need and chance (R-8.2 to R-8.6). */
export function shootTargets(
  state: GameState,
  shooterId: string,
  weaponId: string,
  profileId: string,
  mode: ShotMode = 'shoot',
  opts: { aimed?: boolean; twin?: boolean } = {},
): TargetInfo[] {
  const aimed = opts.aimed ?? aimedNow(state, shooterId)
  return targetInfos(state, getFighter(state, shooterId), needProfile(state, weaponId, profileId), mode, { aimed, ...(opts.twin ? { twin: true } : {}) })
}

/** Chance to hit one target (0 when it is not an eligible target). */
export function hitChance(state: GameState, shooterId: string, weaponId: string, profileId: string, targetId: string, mode: ShotMode = 'shoot'): number {
  return shootTargets(state, shooterId, weaponId, profileId, mode).find((t) => t.targetId === targetId)?.chance ?? 0
}

/** Chance one hit of the profile wounds the target (Gas / Toxin: the D6 >= T test; Flash and Smoke never wound). */
export function woundChance(state: GameState, attackerId: string, weaponId: string, profileId: string, targetId: string): number {
  const p = needProfile(state, weaponId, profileId)
  const t = stat(state, targetId, 'T')
  if (hasTrait(p, TRAIT.gas) || hasTrait(p, TRAIT.toxin)) return toxinChance(t)
  if (hasTrait(p, TRAIT.flash) || hasTrait(p, TRAIT.smoke)) return 0
  return woundChanceFor(woundNeed(profileStrength(p, stat(state, attackerId, 'S')), t))
}

/** The save the target would make against AP `ap` (from an attacker, a Blast or a Template, with a cover bonus). */
export function saveChance(
  state: GameState,
  targetId: string,
  ap: number,
  opts: { fromId?: string; from?: Vec2; vs?: 'blast' | 'template' | null; coverBonus?: number } = {},
): SaveInfo & { chance: number } {
  const t = getFighter(state, targetId)
  const from = opts.fromId ? getFighter(state, opts.fromId) : (opts.from ?? null)
  const info = armourSave(state, t, { ap, from, vs: opts.vs ?? null, coverBonus: opts.coverBonus ?? 0 })
  return { ...info, chance: saveChanceFor(info.need) }
}

/** Odds of `dice` Injury dice rolled together (R-11.8 stacking), for a target (its T and status) and the weapon traits. */
export function injuryOdds(state: GameState, dice: number, traits: readonly string[] = [], targetId?: string): InjuryOdds {
  const t = targetId ? getFighter(state, targetId) : null
  return injuryOddsTable(state, dice, {
    ...(t ? { toughness: stat(state, t.id, 'T'), alreadySeriouslyInjured: t.posture === 'seriouslyInjured' } : {}),
    melta: traits.includes(TRAIT.melta),
  })
}

export interface ExpectedOutcome {
  pHit: number
  pWoundPerHit: number
  pUnsaved: number
  expectedHits: number
  expectedWounds: number
  pSeriouslyInjured: number
  pOutOfAction: number
  pPinned: number
}

/**
 * Expected result of one shot of a profile at a target (00 section 7.6). Exact for one hit; several hits (Rapid Fire,
 * Scattershot) are combined as independent hits, ignoring that earlier hits lower the target's Wounds.
 */
export function expectedOutcome(state: GameState, attackerId: string, weaponId: string, profileId: string, targetId: string, mode: ShotMode = 'shoot'): ExpectedOutcome {
  const p = needProfile(state, weaponId, profileId)
  const a = getFighter(state, attackerId)
  const t = getFighter(state, targetId)
  const template = isTemplate(p)
  const pHit = template ? 1 : hitChance(state, attackerId, weaponId, profileId, targetId, mode)
  const rf = rapidFire(p)
  const dist = rf > 0 ? firepowerHitsDistribution(state, rf) : [0, 1]
  const scatterMult = hasTrait(p, TRAIT.scattershot) ? 3.5 : 1
  const meanHits = dist.reduce((s, q, k) => s + q * k, 0) * scatterMult
  const gas = hasTrait(p, TRAIT.gas)
  const toxic = gas || hasTrait(p, TRAIT.toxin)
  const pW = woundChance(state, attackerId, weaponId, profileId, targetId)
  const vs = template ? 'template' : blastRadius(p) !== null ? 'blast' : null
  const pS = gas ? 0 : saveChance(state, targetId, p.ap, { fromId: attackerId, vs }).chance
  const pU = 1 - pS
  const melta = meltaApplies(p, baseGap(a, t), profileRanges(p, stat(state, attackerId, 'S')).short)
  // Injury dice from one unsaved hit, averaged over the Damage roll
  const dmgOutcomes: { d: number; w: number }[] = []
  if (toxic) dmgOutcomes.push({ d: -1, w: 1 })
  else if (p.dmg.kind === 'none') dmgOutcomes.push({ d: 0, w: 1 })
  else if (p.dmg.kind === 'fixed') dmgOutcomes.push({ d: p.dmg.value, w: 1 })
  else {
    const e = parseDiceExpr(p.dmg.expr)
    const sides = e.die === 'd3' ? [1, 2, 3] : e.die === 'd6' ? [1, 2, 3, 4, 5, 6] : [7]
    for (const v of sides) dmgOutcomes.push({ d: v + e.add, w: 1 / sides.length })
  }
  let q = 0
  let r = 0
  const toughness = stat(state, targetId, 'T')
  for (const { d, w } of dmgOutcomes) {
    const n = d < 0 ? 1 : t.wounds > 0 ? Math.max(0, d - t.wounds + 1) : d
    const o = injuryOddsTable(state, n, { toughness, alreadySeriouslyInjured: t.posture === 'seriouslyInjured', melta: melta && d >= 0 })
    q += w * o.pOutOfAction
    r += w * o.pSeriouslyInjured
  }
  const per = pW * pU
  let pOoa = 0
  let pDown = 0
  dist.forEach((qk, k) => {
    const kk = k * scatterMult
    pOoa += qk * (1 - (1 - per * q) ** kk)
    pDown += qk * (1 - (1 - per * (q + r)) ** kk)
  })
  pOoa *= pHit
  pDown *= pHit
  const mean = toxic ? 0 : Math.min(expectedDamage(p.dmg), Math.max(t.wounds, 0))
  return {
    pHit,
    pWoundPerHit: pW,
    pUnsaved: pU,
    expectedHits: pHit * meanHits,
    expectedWounds: pHit * meanHits * per * mean,
    pSeriouslyInjured: Math.max(0, pDown - pOoa),
    pOutOfAction: pOoa,
    pPinned: t.posture === 'standing' && t.engagedWith.length === 0 && !gas ? pHit : 0,
  }
}

export interface BlastPreview {
  /** the centre after the R-9.2 range pull-back */
  centre: Vec2
  radius: number
  problem: string | null
  need: number
  chance: number
  enemies: string[]
  friends: string[]
}

/** Where a Blast aimed at a floor point lands if it hits, who is under it and the hit chance (R-9.1, R-9.2). */
export function blastPreview(state: GameState, shooterId: string, weaponId: string, profileId: string, aim: Vec2, mode: ShotMode = 'shoot'): BlastPreview {
  const f = getFighter(state, shooterId)
  const p = needProfile(state, weaponId, profileId)
  const radius = blastRadius(p) ?? constants(state).smoke.radius
  const long = profileRanges(p, stat(state, f.id, 'S')).long
  const problem = pointAimProblem(state, f, mode, aim)
  const at = clampToRange(f, aim, long)
  const distance = Math.max(0, Math.hypot(at.x - f.pos.x, at.z - f.pos.z) - f.baseRadius)
  const band = bandFor(state, f, p, distance).band ?? 'long'
  const n = hitNeedFor(state, f, p, { mode, band, point: true, aimed: aimedNow(state, shooterId) })
  const under = fightersUnderBlast(state, at, radius)
  return {
    centre: at,
    radius,
    problem: problem ? problem.reason : null,
    need: n.need,
    chance: problem ? 0 : hitChanceFor(n.need, n.bs),
    enemies: under.filter((g) => g.seat !== f.seat).map((g) => g.id),
    friends: under.filter((g) => g.seat === f.seat).map((g) => g.id),
  }
}

export interface TemplatePreview {
  polygon: Vec2[]
  problem: string | null
  enemies: string[]
  friends: string[]
}

/** The template for a direction (toward `aim`), whether it fits the vision arc and who it would hit (R-9.6). */
export function templatePreview(state: GameState, shooterId: string, weaponId: string, profileId: string, aim: Vec2, mode: ShotMode = 'shoot'): TemplatePreview {
  const f = getFighter(state, shooterId)
  needProfile(state, weaponId, profileId)
  const problem = templateProblem(state, f, mode, aim)
  const shape = templateShape(state, f, Math.atan2(aim.x - f.pos.x, aim.z - f.pos.z))
  const v = problem ? [] : templateVictims(state, f, shape)
  return { polygon: shape.polygon, problem: problem ? problem.reason : null, enemies: v.filter((g) => g.seat !== f.seat).map((g) => g.id), friends: v.filter((g) => g.seat === f.seat).map((g) => g.id) }
}
