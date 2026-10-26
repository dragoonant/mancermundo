// query.*: every number or verdict the UI and the AI read (00 section 7.6). S2 holds status, stat, engagement, distances,
// line of sight, vision arc and cover; `actionMenu` is added from activation.ts by index.ts (`query.actionMenu`). S3a adds
// the shooting numbers (targets with priority, hit / wound / save / injury odds, expected outcome, blast and template
// previews); S3b adds the close-combat and nerve numbers (charge targets with pReach, fight outcome, nerve and rally odds);
// S4 the bottle and scenario numbers.
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
import { attackDiceFor, chargeTargets as chargeTargetsFor, meleeHitChance, meleeNeedFor, meleeProfile, weaponCombos, weaponDice, type ChargeTarget, type MeleeNeed } from './fight'
import { nerveInfo, rallyInfo, type CoolTestInfo } from './morale'

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

// ---------------------------------------------------------------------------
// Close combat and nerve (S3b)
// ---------------------------------------------------------------------------

/** Enemies the fighter can charge, with the inches each needs and the chance that M + D3 covers it (R-7.6). */
export function chargeTargets(state: GameState, fighterId: string): ChargeTarget[] {
  return chargeTargetsFor(state, getFighter(state, fighterId))
}

/** The nerve test a fighter would take now (R-12.2): need, supporters, exact chance. */
export function nerveOdds(state: GameState, fighterId: string): CoolTestInfo {
  return nerveInfo(state, getFighter(state, fighterId))
}

/** The Rally test a Broken fighter would take now (R-13.8). */
export function rallyOdds(state: GameState, fighterId: string): CoolTestInfo {
  return rallyInfo(state, getFighter(state, fighterId))
}

interface PerHit {
  pWound: number
  pUnsaved: number
  /** per unsaved hit: Out of Action, Seriously Injured (and not Out of Action) */
  pOoa: number
  pSi: number
  meanDamage: number
}

function perHitOdds(state: GameState, a: Fighter, t: Fighter, p: RuntimeProfile | null): PerHit {
  const S = stat(state, a.id, 'S')
  const backstab = !!p && hasTrait(p, TRAIT.backstab) && !inVisionArc(t, a)
  const strength = (p ? profileStrength(p, S) : S) + (backstab ? 1 : 0)
  const toughness = stat(state, t.id, 'T')
  const pWound = woundChanceFor(woundNeed(strength, toughness))
  const pUnsaved = 1 - saveChanceFor(armourSave(state, t, { ap: p?.ap ?? 0, from: a }).need)
  const dmg = p?.dmg ?? { kind: 'fixed' as const, value: 1 }
  const outcomes: { d: number; w: number }[] = []
  if (dmg.kind === 'none') outcomes.push({ d: 0, w: 1 })
  else if (dmg.kind === 'fixed') outcomes.push({ d: dmg.value, w: 1 })
  else {
    const e = parseDiceExpr(dmg.expr)
    const sides = e.die === 'd3' ? [1, 2, 3] : e.die === 'd6' ? [1, 2, 3, 4, 5, 6] : [7]
    for (const v of sides) outcomes.push({ d: v + e.add, w: 1 / sides.length })
  }
  const sever = !!p && hasTrait(p, TRAIT.sever)
  let pOoa = 0
  let pDown = 0
  for (const { d, w } of outcomes) {
    const n = t.wounds > 0 ? Math.max(0, d - t.wounds + 1) : d
    const o = injuryOddsTable(state, n, { toughness, alreadySeriouslyInjured: t.posture === 'seriouslyInjured', melta: sever && n > 0 })
    pOoa += w * o.pOutOfAction
    pDown += w * (o.pOutOfAction + o.pSeriouslyInjured)
  }
  return { pWound, pUnsaved, pOoa, pSi: Math.max(0, pDown - pOoa), meanDamage: Math.min(expectedDamage(dmg), Math.max(t.wounds, 0)) }
}

export interface FightTargetOdds {
  targetId: string
  dice: number
  need: number
  pHitPerDie: number
  expectedHits: number
  expectedWounds: number
  pSeriouslyInjured: number
  pOutOfAction: number
}

export interface FightOutcome {
  weaponIds: string[]
  dice: number
  targets: FightTargetOdds[]
  /** the expected reaction attacks against the attacker afterwards (R-10.8), if every target stays Standing */
  reactions: { fighterId: string; dice: number; need: number; expectedHits: number; expectedWounds: number }[]
}

function diceOdds(state: GameState, a: Fighter, t: Fighter, groups: { weaponId: string | null; dice: number }[], need: MeleeNeed): Omit<FightTargetOdds, 'targetId' | 'need'> {
  const pHit = meleeHitChance(need)
  let dice = 0
  let eh = 0
  let ew = 0
  let keepUp = 1
  let keepOn = 1
  for (const g of groups) {
    const o = perHitOdds(state, a, t, g.weaponId ? meleeProfile(state, a, g.weaponId) : null)
    const per = pHit * o.pWound * o.pUnsaved
    dice += g.dice
    eh += g.dice * pHit
    ew += g.dice * per * o.meanDamage
    keepOn *= (1 - per * o.pOoa) ** g.dice
    keepUp *= (1 - per * (o.pOoa + o.pSi)) ** g.dice
  }
  return { dice, pHitPerDie: pHit, expectedHits: eh, expectedWounds: ew, pOutOfAction: 1 - keepOn, pSeriouslyInjured: Math.max(0, keepOn - keepUp) }
}

/**
 * Expected result of a Fight (00 section 7.6): the attacker's dice with `weaponIds` (default: the first offered combination)
 * split evenly over `targetIds` (default: the engaged enemies in its arc), with exact per-die hit odds, and the reaction
 * attacks of the engaged enemies against it. Independent dice, ignoring that earlier hits lower the target's Wounds.
 */
export function fightOutcome(state: GameState, attackerId: string, weaponIds?: string[], targetIds?: string[], opts: { charge?: boolean } = {}): FightOutcome {
  const a = getFighter(state, attackerId)
  const charge = opts.charge ?? false
  const engaged = a.engagedWith.map((id) => getFighter(state, id))
  const ts = (targetIds ?? engaged.filter((t) => inVisionArc(a, t) || engaged.every((e) => !inVisionArc(a, e))).map((t) => t.id)).map((id) => getFighter(state, id))
  const combo = weaponIds ?? weaponCombos(state, a, ts, 'fight', charge)[0] ?? []
  const n = attackDiceFor(state, a, combo, charge)
  const perWeapon = weaponDice(state, a, combo, n)
  const tokens: (string | null)[] = []
  for (const w of perWeapon) for (let i = 0; i < w.dice; i++) tokens.push(w.weaponId)
  const turned = ts.length > 0 && ts.every((t) => !inVisionArc(a, t))
  const out: FightTargetOdds[] = []
  ts.forEach((t, i) => {
    const share = Math.floor(n / ts.length) + (i < n % ts.length ? 1 : 0)
    const start = ts.slice(0, i).reduce((acc, _x, j) => acc + Math.floor(n / ts.length) + (j < n % ts.length ? 1 : 0), 0)
    const groups: { weaponId: string | null; dice: number }[] = []
    for (const w of tokens.slice(start, start + share)) {
      const g = groups.find((x) => x.weaponId === w)
      if (g) g.dice++
      else groups.push({ weaponId: w, dice: 1 })
    }
    const need = meleeNeedFor(state, a, t, { role: 'fight', turned, charge, unseen: false, entangled: false })
    out.push({ targetId: t.id, need: need.sixesOnly ? 6 : need.need, ...diceOdds(state, a, t, groups, need) })
  })
  const reactions: FightOutcome['reactions'] = []
  for (const e of engaged) {
    if (e.conditions.blaze) continue
    const c = weaponCombos(state, e, [a], 'reaction', false)[0]
    if (!c) continue
    const k = attackDiceFor(state, e, c, false)
    const need = meleeNeedFor(state, e, a, { role: 'reaction', turned: !inVisionArc(e, a), charge: false, unseen: false, entangled: false })
    const o = diceOdds(state, e, a, weaponDice(state, e, c, k), need)
    reactions.push({ fighterId: e.id, dice: k, need: need.sixesOnly ? 6 : need.need, expectedHits: o.expectedHits, expectedWounds: o.expectedWounds })
  }
  return { weaponIds: combo, dice: n, targets: out, reactions }
}
