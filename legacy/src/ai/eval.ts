// Evaluation primitives (docs/spec/40-ai section 2). Everything is in "wounds-equivalent" units. Exact odds come from
// the engine (`query.expectedDamage`, `fightOutcome`); the planner's broad search uses a cached open-ground figure
// per (attacker card, weapon, defender save) scaled by the engine's own cover/obscured verdict, and only the shots
// it finally commits to are re-rated with the exact numbers.
import { expectedDamage, markerControl } from '@/engine/query'
import { dieOdds } from '@/engine/dice'
import { bodyOf, visible } from '@/engine/los'
import { distanceBetween, enemiesInControlRange } from '@/engine/measure'
import { gradeThresholds } from '@/engine/missions'
import { providerFixedTargets } from '@/engine/team-rules'
import { activeOps, enemiesOf, otherSeat } from '@/engine/state'
import { parseRules, ruleSetFor, targetInfo, weaponUnusable, type RuleSet, type TargetInfo } from '@/engine/attack-common'
import type { GameState, MapDef, Operative, RuntimeWeapon, Vec3 } from '@/engine'
import { pathDistance } from './nav'
import type { AiCtx } from './tiers'

// ---------------------------------------------------------------------------
// Hypothetical states
// ---------------------------------------------------------------------------

/** A shallow copy of the view with one operative moved (and optionally patched). Nothing is cloned deeply. */
export function overlay(view: GameState, id: string, pos: Vec3, patch: Partial<Operative> = {}): GameState {
  const op = view.operatives[id]!
  return { ...view, operatives: { ...view.operatives, [id]: { ...op, ...patch, pos } } }
}

export function withOrder(view: GameState, id: string, order: 'engage' | 'conceal'): GameState {
  const op = view.operatives[id]!
  if (op.order === order) return view
  return { ...view, operatives: { ...view.operatives, [id]: { ...op, order } } }
}

export function posKey(p: { x: number; y?: number; z: number }): string {
  return `${Math.round(p.x * 4)},${Math.round((p.y ?? 0) * 2)},${Math.round(p.z * 4)}`
}

export function memo<T>(ctx: AiCtx, key: string, make: () => T): T {
  const hit = ctx.cache.get(key)
  if (hit !== undefined) return hit as T
  const v = make()
  ctx.cache.set(key, v)
  return v
}

// ---------------------------------------------------------------------------
// Open-ground damage table
// ---------------------------------------------------------------------------

const openMaps = new WeakMap<MapDef, MapDef>()
function openMapOf(map: MapDef): MapDef {
  let m = openMaps.get(map)
  if (!m) {
    m = { ...map, features: [] }
    openMaps.set(map, m)
  }
  return m
}

const openCache = new Map<string, number>()

function analyticMean(w: RuntimeWeapon, save: number): number {
  const hit = dieOdds(w.hit)
  const atkN = w.atk * hit.normal
  const atkC = w.atk * hit.crit
  const def = dieOdds(save)
  const blocks = 3 * (def.normal + def.crit)
  const total = atkN + atkC
  if (total <= 0) return 0
  return (Math.max(0, total - blocks) / total) * (atkN * w.dmg.normal + atkC * w.dmg.crit)
}

/** Expected damage of one Shoot action in open ground (no cover, no obscuring) at 4 inches. Cached across decisions. */
export function openMean(view: GameState, att: Operative, weaponId: string, tgt: Operative): number {
  const key = `${att.datacardId}|${weaponId}|${att.wounds * 2 < att.maxWounds ? 'i' : ''}|${tgt.datacardId}|${tgt.save}|${tgt.wounds * 2 < tgt.maxWounds ? 'i' : ''}`
  const hit = openCache.get(key)
  if (hit !== undefined) return hit
  let v: number
  try {
    const a: Operative = { ...att, pos: { x: 0, y: 0, z: 0 }, order: 'engage' }
    const t: Operative = { ...tgt, pos: { x: 4, y: 0, z: 0 }, order: 'engage' }
    const st: GameState = {
      ...view,
      map: openMapOf(view.map),
      operatives: { [a.id]: a, [t.id]: t },
      markers: [],
      effects: [],
      attack: null,
      window: null,
      firefight: { ...view.firefight, activation: null, stack: [] },
    }
    v = expectedDamage(st, a.id, weaponId, t.id).mean
  } catch {
    v = analyticMean(view.data.weapons[weaponId]!, tgt.save)
  }
  if (openCache.size > 4000) openCache.clear()
  openCache.set(key, v)
  return v
}

/** Cheap multiplier for a verdict (engine-computed cover/obscured) on the open-ground figure. */
export function coverFactor(v: { inCover: boolean; obscured: boolean; improvedCover?: boolean; forcedChoice?: boolean; ifCover?: { inCover: boolean; obscured: boolean }; ifObscured?: { inCover: boolean; obscured: boolean } }): number {
  const f = (cover: boolean, obscured: boolean, improved?: boolean) => (cover ? (improved ? 0.6 : 0.75) : 1) * (obscured ? 0.65 : 1)
  if (v.forcedChoice && v.ifCover && v.ifObscured) return Math.min(f(v.ifCover.inCover, v.ifCover.obscured, v.improvedCover), f(v.ifObscured.inCover, v.ifObscured.obscured, v.improvedCover))
  return f(v.inCover, v.obscured, v.improvedCover)
}

// ---------------------------------------------------------------------------
// Targets and shots
// ---------------------------------------------------------------------------

export interface ShotEst {
  weaponId: string
  targetId: string
  mean: number
  kill: number
  score: number
  /** the weapon names its own targets (Detonate): the figure is already the whole value, never re-rated shot by shot */
  fixed?: true
}

function erf(x: number): number {
  const s = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}

/** P(damage >= wounds) from a mean, with a spread proportional to the mean (a quick normal approximation). */
export function killEstimate(mean: number, wounds: number, avgHit = 3.5): number {
  if (mean <= 0) return 0
  const sd = Math.max(1, Math.sqrt(mean * avgHit * 0.8))
  const z = (wounds - 0.5 - mean) / sd
  return Math.max(0, Math.min(1, 0.5 * (1 - erf(z / Math.SQRT2))))
}

/** Offence rating of an enemy: its best weapon's attack volume, used to rank targets. */
function offenceOf(view: GameState, e: Operative): number {
  let best = 0
  for (const id of e.weapons) {
    const w = view.data.weapons[id]
    if (!w) continue
    best = Math.max(best, w.atk * (w.dmg.normal * 0.5 + w.dmg.crit * 0.17))
  }
  return best
}

/** Multiplier on the value of damaging/killing `target`: dangerous operatives first. */
export function targetMult(ctx: AiCtx, view: GameState, target: Operative): number {
  const avg = memo(ctx, 'avgOffence', () => {
    const es = enemiesOf(view, { seat: ctx.seat })
    return es.length ? es.reduce((s, e) => s + offenceOf(view, e), 0) / es.length : 1
  })
  const rel = avg > 0 ? offenceOf(view, target) / avg : 1
  const card = view.data.datacards[target.datacardId]
  const expend = card?.expendable ? 0.25 : 1
  return Math.max(0.6, Math.min(1.6, rel)) * expend
}

/** VP-equivalent extra when one more incapacitation takes our kill grade up. */
export function killVpBonus(ctx: AiCtx, view: GameState): number {
  const m = view.mission
  if (!m) return 0
  try {
    const kills = m.kills[ctx.seat] ?? 0
    const next = gradeThresholds(view, ctx.seat).find((t) => t > kills)
    const crosses = next !== undefined && kills + 1 >= next
    return ctx.w.vp * (crosses ? 1 : 0.1)
  } catch {
    return 0
  }
}

/** Score of a shot: capped damage plus a kill premium, scaled by how dangerous the target is. */
export function shotScore(ctx: AiCtx, view: GameState, target: Operative, mean: number, kill: number): number {
  const mult = targetMult(ctx, view, target)
  return mult * (ctx.w.dmg * Math.min(mean, target.wounds) + (ctx.w.kill + killVpBonus(ctx, view)) * kill)
}

/** Line of sight between two operatives, memoised per decision on their positions. */
export function sees(ctx: AiCtx, v: GameState, a: Operative, b: Operative): boolean {
  return memo(ctx, `V|${a.id}|${posKey(a.pos)}|${b.id}|${posKey(b.pos)}`, () => visible(v, bodyOf(a), bodyOf(b)))
}

/** The engine's target verdict (cover, obscured, Conceal-in-cover) for a pair, memoised per decision. */
export function infoOf(ctx: AiCtx, v: GameState, shooter: Operative, target: Operative, rules: RuleSet): TargetInfo {
  const key = `I|${shooter.id}|${posKey(shooter.pos)}|${target.id}|${posKey(target.pos)}|${target.order}|${rules.seek ? 1 : 0}${rules.seekLight ? 1 : 0}`
  return memo(ctx, key, () => targetInfo(v, shooter, target, rules))
}

/** Rule set of a weapon for its bearer, memoised (it does not depend on where anyone stands). */
export function rulesOf(ctx: AiCtx, v: GameState, op: Operative, weaponId: string): RuleSet {
  return memo(ctx, `R|${op.id}|${weaponId}`, () => ruleSetFor(v, op, weaponId, 'shoot'))
}

/** A drone built to be blown up: the datacard says so, or it has an Expendable ability (a Machine's kill-op exemption). */
function isExpendable(view: GameState, o: Operative): boolean {
  const card = view.data.datacards[o.datacardId]
  return !!card && (card.expendable === true || card.abilities.some((a) => /\.expendable$/.test(a)))
}

/**
 * A weapon that picks its own targets (Detonate: a marker's surroundings, the friendly Gheistskull) is not a shot at a
 * valid enemy: its value is every fixed target (and the Blast around the primary) scored together, friends against it.
 * Null when the weapon targets as usual; a score of -Infinity when a team rule fixes no target (it cannot be selected).
 */
export function fixedShot(ctx: AiCtx, view: GameState, shooter: Operative, weaponId: string): ShotEst | null {
  let fixed
  try {
    fixed = providerFixedTargets(view, shooter, weaponId)
  } catch {
    return null
  }
  if (!fixed) return null
  const primary = fixed.targets[0]
  if (!primary || !view.operatives[primary]) return { weaponId, targetId: shooter.id, mean: 0, kill: 0, score: -Infinity }
  const ids = new Set(fixed.targets)
  const blast = fixed.blast === false ? null : rulesOf(ctx, view, shooter, weaponId).blast
  if (blast) {
    const p = view.operatives[primary]!
    for (const o of activeOps(view)) {
      if (o.id === shooter.id || ids.has(o.id) || distanceBetween(bodyOf(p), bodyOf(o)) > blast + 0.05) continue
      if (sees(ctx, view, p, o)) ids.add(o.id)
    }
  }
  let total = 0
  for (const id of ids) {
    const t = view.operatives[id]
    if (!t || t.status !== 'active' || t.wounds <= 0) continue
    const mean = openMean(view, shooter, weaponId, t) * 0.9
    const sc = shotScore(ctx, view, t, mean, killEstimate(mean, t.wounds, avgDamageOf(view.data.weapons[weaponId]!)))
    if (t.seat !== shooter.seat) total += sc
    // an expendable friend (a drone built to be blown up) costs a third as much
    else total -= sc * (isExpendable(view, t) ? 0.35 : 1) * (t.id === shooter.id ? 1.2 : 1)
  }
  return { weaponId, targetId: primary, mean: total, kill: 0, score: total, fixed: true }
}

/** Every (ranged weapon, valid target) the shooter has from where it stands in `view`, cheaply rated. */
export function shotsFrom(ctx: AiCtx, view: GameState, shooter: Operative, performed: string[]): ShotEst[] {
  const out: ShotEst[] = []
  const weapons: { id: string; w: RuntimeWeapon; rules: RuleSet }[] = []
  for (const wid of shooter.weapons) {
    const w = view.data.weapons[wid]
    if (!w || w.type !== 'ranged') continue
    if (weaponUnusable(view, shooter, wid, performed, 'shoot')) continue
    if (isExplosive(w)) {
      const score = explosionValue(ctx, view, shooter, wid)
      if (score > 0) out.push({ weaponId: wid, targetId: shooter.id, mean: score, kill: 0, score })
      continue
    }
    const fixed = fixedShot(ctx, view, shooter, wid)
    if (fixed) {
      if (fixed.score > 0) out.push(fixed)
      continue
    }
    weapons.push({ id: wid, w, rules: rulesOf(ctx, view, shooter, wid) })
  }
  if (weapons.length === 0) return out
  for (const t of enemiesOf(view, shooter)) {
    if (t.wounds <= 0) continue
    const gap = distanceBetween(bodyOf(shooter), bodyOf(t))
    const inRange = weapons.filter((x) => x.rules.range === null || gap <= x.rules.range + 1e-6)
    if (inRange.length === 0) continue
    if (!sees(ctx, view, shooter, t)) continue
    if (enemiesInControlRange(view, t, t.seat).length > 0) continue
    for (const x of inRange) {
      const info = infoOf(ctx, view, shooter, t, x.rules)
      if (!info.verdict.visible || info.coverBlocks) continue
      const mean = openMean(view, shooter, x.id, t) * coverFactor({ ...info.verdict, improvedCover: info.improvedCover })
      const kill = killEstimate(mean, t.wounds, avgDamageOf(x.w))
      out.push({ weaponId: x.id, targetId: t.id, mean, kill, score: shotScore(ctx, view, t, mean, kill) + (x.rules.blast ? blastDelta(ctx, view, shooter, x.id, t) : 0) })
    }
  }
  return out
}

/** Blast hits every operative the primary sees within the radius, friend or foe: the net value of the secondaries. */
export function blastDelta(ctx: AiCtx, view: GameState, shooter: Operative, weaponId: string, target: Operative): number {
  const blast = rulesOf(ctx, view, shooter, weaponId).blast
  if (!blast) return 0
  let d = 0
  for (const o of activeOps(view)) {
    if (o.id === target.id || o.id === shooter.id) continue
    if (distanceBetween(bodyOf(target), bodyOf(o)) > blast + 0.05) continue
    if (!sees(ctx, view, target, o)) continue
    const mean = openMean(view, shooter, weaponId, o) * 0.8
    const sc = shotScore(ctx, view, o, mean, killEstimate(mean, o.wounds))
    d += o.seat === shooter.seat ? -sc : sc
  }
  return d
}

export function isExplosive(w: RuntimeWeapon): boolean {
  return w.rules.some((r) => r.rule.toLowerCase().includes('explosive'))
}

/** A self-detonating weapon (the Bomb Squig): enemies within the blast of the bearer gain, friends lose. */
export function explosionValue(ctx: AiCtx, view: GameState, op: Operative, weaponId: string): number {
  const w = view.data.weapons[weaponId]
  if (!w) return 0
  const blast = parseRules(w.rules).blast ?? 1
  let total = 0
  for (const t of Object.values(view.operatives)) {
    if (t.id === op.id || t.status !== 'active') continue
    if (distanceBetween(bodyOf(op), bodyOf(t)) > blast + 0.05) continue
    const mean = openMean(view, op, weaponId, t)
    const sc = shotScore(ctx, view, t, mean, killEstimate(mean, t.wounds, avgDamageOf(w)))
    total += t.seat === op.seat ? -sc : sc
  }
  return total
}

function avgDamageOf(w: RuntimeWeapon): number {
  return (w.dmg.normal * 2 + w.dmg.crit) / 3
}

export function bestShot(ests: ShotEst[]): ShotEst | null {
  let best: ShotEst | null = null
  for (const e of ests) if (!best || e.score > best.score) best = e
  return best
}

/** Exact re-rating of a shot with the engine's own odds. */
export function exactShot(ctx: AiCtx, view: GameState, shooterId: string, weaponId: string, targetId: string): ShotEst {
  const t = view.operatives[targetId]!
  const ed = expectedDamage(view, shooterId, weaponId, targetId)
  return { weaponId, targetId, mean: ed.mean, kill: ed.killProbability, score: shotScore(ctx, view, t, ed.mean, ed.killProbability) }
}

/** The ranged weapon range in inches (null = unlimited). */
export function weaponRange(view: GameState, weaponId: string): number | null {
  const w = view.data.weapons[weaponId]
  return w ? parseRules(w.rules).range : null
}


// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

/** How much holding a marker is worth right now, in wounds-equivalent per marker. */
export function controlValue(ctx: AiCtx, view: GameState): number {
  const tp = view.turningPoint
  const tp_ = ctx.params.tacAware ? (tp <= 1 ? 0.45 : tp >= 4 ? 1.2 : 0.9) : 0.6
  const crit = view.mission?.critOp
  const op = crit === 'loot' ? 0.95 : 1
  return ctx.w.vp * tp_ * op
}

/** Total value, for our seat, of who controls the objective markers in `view`. */
export function objectiveValue(ctx: AiCtx, view: GameState): number {
  const c = controlValue(ctx, view)
  let val = 0
  for (const m of view.markers) {
    if (m.kind !== 'objective') continue
    const k = markerControl(view, m)
    if (k.controller === ctx.seat) val += c
    else if (k.controller === otherSeat(ctx.seat)) val -= 0.6 * c
    else if (k.apl[ctx.seat] > 0 && k.apl[ctx.seat] === k.apl[otherSeat(ctx.seat)]) val += 0.12 * c
  }
  return val
}

/** The objective markers and whether we already hold each one firmly (so others need not crowd it). */
export function objectiveTargets(ctx: AiCtx, view: GameState): { id: string; x: number; z: number; firm: boolean }[] {
  return memo(ctx, 'objTargets', () => {
    const out: { id: string; x: number; z: number; firm: boolean }[] = []
    for (const m of view.markers) {
      if (m.kind !== 'objective') continue
      const k = markerControl(view, m)
      const firm = k.controller === ctx.seat && k.apl[ctx.seat] - k.apl[otherSeat(ctx.seat)] >= 2
      out.push({ id: m.id, x: m.pos.x, z: m.pos.z, firm })
    }
    return out
  })
}

/** Negative path distance to the objective this operative should be heading for (zero once in control range). */
export function approachTerm(ctx: AiCtx, view: GameState, op: Operative): number {
  const targets = objectiveTargets(ctx, view)
  if (targets.length === 0) return 0
  let best = Infinity
  const reach = op.baseRadius + 0.79 + 0.9
  for (const t of targets) {
    const d = op.pos.y > 0.01 ? Math.hypot(t.x - op.pos.x, t.z - op.pos.z) : pathDistance(view.map, op.baseRadius, op.height, op.pos, t)
    best = Math.min(best, Math.max(0, d - reach) * (t.firm ? 2.5 : 1))
  }
  const tp = ctx.view.turningPoint
  const scale = ctx.params.tacAware ? (tp <= 1 ? 0.6 : 1) : 0.5
  return -ctx.w.approach * scale * Math.min(best, 40)
}

/** Mission action (Secure, Loot, Transmission) VP-equivalent for performing it once from a controlled marker. */
export function missionActionValue(ctx: AiCtx, view: GameState, abilityId: string, markerId?: string): number {
  const m = view.mission
  if (!m) return 0
  const tp = view.turningPoint
  if (tp < 2 && ctx.params.tacAware) return 0
  const vp = ctx.w.vp
  const id = abilityId.toLowerCase()
  if (id.includes('secure')) {
    const mine = Object.values(m.secured).filter((x) => x === ctx.seat).length
    const theirs = Object.values(m.secured).filter((x) => x !== ctx.seat).length
    // the scoring turning points still to come (end of TP2, TP3, TP4) for a marker secured now
    const turns = Math.max(1, Math.min(3, 5 - tp))
    const first = mine === 0 ? 1 : 0
    const lead = mine + 1 > theirs && mine <= theirs ? 1 : 0
    const stolen = markerId && m.secured[markerId] === otherSeat(ctx.seat) ? 0.5 : 0
    return vp * (first + lead + stolen) * Math.min(1.5, 0.6 + 0.3 * turns)
  }
  if (id.includes('loot')) {
    const room = Math.max(0, 2 - (m.scoredTp['crit-per-tp']?.[ctx.seat] ?? 0))
    return room > 0 && !(markerId && m.looted.includes(markerId)) ? vp * 1.0 : 0
  }
  if (id.includes('transmi')) {
    const mine = m.transmitting.length
    return vp * (mine === 0 ? 1.6 : 0.9) * (tp >= 4 ? 1.2 : 1)
  }
  return 0
}
