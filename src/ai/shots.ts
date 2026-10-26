// Shot valuation: for a fighter at a spot (the real one or an overlay), which weapon at which target is worth the most, from
// the engine's target list (range band, cover, final need, priority class) and the hit-to-injury chain. Used by the
// activation planner (does this spot give a shot? does this fighter have one now?) and by the shoot.* policies, so the
// plan and the sub-decisions agree.
import { ARC_HALF } from '@/engine/los'
import { hitNeedFor, profileOf, targetInfos, templateSuggestions, pointSuggestions, usableRangedProfiles, defaultTarget, bandFor, canShootDoors, type TargetInfo } from '@/engine/shoot'
import { blastRadius, hasTrait, isTemplate, T } from '@/engine/traits'
import { constants, getFighter, onBoard } from '@/engine/state'
import { twoD6TestChance, hitChanceFor } from '@/engine/dice'
import { shootableDoors } from '@/engine/zm'
import { query } from '@/engine'
import type { Fighter, GameState, RuntimeProfile, Vec2 } from '@/engine'
import { ammoRisk, fighterValue, hitChain, outcomeValue, shotOutcome } from './eval'
import type { AiCtx } from './tiers'

export interface ShotPlan {
  weaponId: string
  profileId: string
  twinWith?: string
  /** the kind of aim the shoot sequence will ask for */
  kind: 'fighter' | 'template' | 'point'
  targetId?: string
  /** template or point aim */
  aim?: Vec2
  cost: 'basic' | 'double'
  value: number
  chance: number
}

const AMMO_LOSS = 0.35

function dist2seg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l2 = dx * dx + dz * dz || 1
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2))
  return Math.hypot(a.x + dx * u - p.x, a.z + dz * u - p.z)
}

/** Expected value lost to stray shots on a miss: a friend engaged with the target or within an inch of the line (R-8.8). */
function strayCost(ctx: AiCtx, state: GameState, f: Fighter, p: RuntimeProfile, t: Fighter, weaponId: string, pHit: number): number {
  const k = constants(state).strayShot
  const a = { x: f.pos.x, z: f.pos.z }
  const b = { x: t.pos.x, z: t.pos.z }
  let cost = 0
  const pMiss = 1 - pHit
  for (const g of onBoard(state)) {
    if (g.seat !== f.seat || g.id === f.id) continue
    const near = t.engagedWith.includes(g.id) || dist2seg({ x: g.pos.x, z: g.pos.z }, a, b) - g.baseRadius <= k.radius
    if (!near) continue
    const c = hitChain(ctx, state, f, weaponId, p, g)
    const harm = c.pWound * c.pUnsaved * (c.q + 0.65 * c.r) * fighterValue(state, g)
    cost += pMiss * (k.hitOnAtMost / 6) * (harm + 0.05 * fighterValue(state, g))
  }
  return cost
}

export interface EvalOpts {
  aimed: boolean
  mode: 'shoot' | 'blindFire'
  actionsLeft: number
  /** collects the value of every target (by fighter id, or `point`) the option was scored on */
  values?: Map<string, number>
}

function directValue(ctx: AiCtx, state: GameState, f: Fighter, weaponId: string, p: RuntimeProfile, infos: TargetInfo[], ti: TargetInfo, twin: boolean): number {
  const t = getFighter(state, ti.targetId)
  const chain = hitChain(ctx, state, f, weaponId, p, t)
  const o = shotOutcome(chain, ti.chance, t)
  let value = outcomeValue(ctx.w, state, t, o)
  // splash of a Blast centred on the target (the marker hits everyone under it)
  if (blastRadius(p) !== null) {
    const bp = query.blastPreview(state, f.id, weaponId, p.id, { x: t.pos.x, z: t.pos.z }, 'shoot')
    for (const id of bp.enemies) {
      if (id === t.id) continue
      const e = getFighter(state, id)
      value += outcomeValue(ctx.w, state, e, shotOutcome(hitChain(ctx, state, f, weaponId, p, e), ti.chance, e))
    }
    for (const id of bp.friends) {
      if (id === f.id) continue
      const g = getFighter(state, id)
      value -= outcomeValue(ctx.w, state, g, shotOutcome(hitChain(ctx, state, f, weaponId, p, g), ti.chance, g)) * 1.3
    }
  } else {
    value -= strayCost(ctx, state, f, p, t, weaponId, ti.chance)
  }
  // a farther target that needs a Cool test falls back to the closest one on a failed test
  if (ti.priority === 'coolTest') {
    const closest = defaultTarget(infos)
    if (closest && closest.targetId !== ti.targetId) {
      const pass = twoD6TestChance(f.stats.Cl, 0)
      const c = getFighter(state, closest.targetId)
      const alt = outcomeValue(ctx.w, state, c, shotOutcome(hitChain(ctx, state, f, weaponId, p, c), closest.chance, c))
      value = pass * value + (1 - pass) * alt
    }
  }
  value -= ctx.w.dmg * AMMO_LOSS * ammoRisk(state, p) * (twin ? 1.4 : 1)
  return value
}

/** The best shot of one weapon option (profile, optional twin sidearm) from the state as it stands, or null. */
export function evalOption(ctx: AiCtx, state: GameState, f: Fighter, weaponId: string, profileId: string, twinWith: string | undefined, o: EvalOpts): ShotPlan | null {
  const p = profileOf(state, weaponId, profileId)
  if (!p) return null
  const unwieldy = hasTrait(p, T.unwieldy) && o.mode !== 'blindFire'
  const cost: 'basic' | 'double' = unwieldy || o.mode === 'blindFire' ? 'double' : 'basic'
  if (cost === 'double' && o.actionsLeft < 2) return null
  let best: ShotPlan | null = null
  const take = (plan: ShotPlan) => {
    if (!best || plan.value > best.value) best = plan
  }
  if (isTemplate(p)) {
    for (const s of templateSuggestions(state, f, o.mode).slice(0, 4)) {
      if (s.enemies.length === 0) continue
      let value = 0
      for (const id of s.enemies) {
        const e = getFighter(state, id)
        value += outcomeValue(ctx.w, state, e, shotOutcome(hitChain(ctx, state, f, weaponId, p, e), 1, e))
      }
      for (const id of s.friends) {
        const g = getFighter(state, id)
        value -= outcomeValue(ctx.w, state, g, shotOutcome(hitChain(ctx, state, f, weaponId, p, g), 1, g)) * 1.3
      }
      take({ weaponId, profileId, kind: 'template', aim: s.aim, cost, value, chance: 1 })
    }
    return best
  }
  const infos = targetInfos(state, f, p, o.mode, { aimed: o.aimed, twin: !!twinWith })
  for (const ti of infos) {
    if (ti.band === null) continue
    const value = directValue(ctx, state, f, weaponId, p, infos, ti, !!twinWith)
    o.values?.set(ti.targetId, value)
    const plan: ShotPlan = { weaponId, profileId, kind: 'fighter', targetId: ti.targetId, cost, value, chance: ti.chance }
    if (twinWith) plan.twinWith = twinWith
    take(plan)
  }
  // a Blast aimed at a floor point (hits targets that cannot be picked directly)
  if ((blastRadius(p) !== null || hasTrait(p, T.smoke)) && !hasTrait(p, T.smoke) && !twinWith) {
    for (const s of pointSuggestions(state, f, p, o.mode).slice(0, 3)) {
      if (s.enemies.length === 0) continue
      const n = hitNeedFor(state, f, p, { mode: o.mode, band: 'long', point: true, aimed: o.aimed })
      const chance = hitChanceFor(n.need, n.bs)
      let value = 0
      for (const id of s.enemies) {
        const e = getFighter(state, id)
        value += outcomeValue(ctx.w, state, e, shotOutcome(hitChain(ctx, state, f, weaponId, p, e), chance, e))
      }
      for (const id of s.friends) {
        const g = getFighter(state, id)
        value -= outcomeValue(ctx.w, state, g, shotOutcome(hitChain(ctx, state, f, weaponId, p, g), chance, g)) * 1.3
      }
      value -= ctx.w.dmg * AMMO_LOSS * ammoRisk(state, p)
      if (o.values && !(o.values.get('point')! >= value)) o.values.set('point', value)
      take({ weaponId, profileId, kind: 'point', aim: s.aim, cost, value, chance })
    }
  }
  return best
}

/** Every option a fighter could shoot with: single profiles of usable weapons and, for Sidearms, twin pairs. */
function optionList(state: GameState, f: Fighter): { weaponId: string; profileId: string; twinWith?: string }[] {
  const usable = usableRangedProfiles(state, f)
  const out: { weaponId: string; profileId: string; twinWith?: string }[] = usable.map((u) => ({ weaponId: u.weaponId, profileId: u.profile.id }))
  const side = usable.filter((u) => hasTrait(u.profile, T.sidearm) && blastRadius(u.profile) === null && !isTemplate(u.profile))
  const ids = [...new Set(side.map((u) => u.weaponId))]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (const u of side.filter((x) => x.weaponId === ids[i])) out.push({ weaponId: ids[i]!, profileId: u.profile.id, twinWith: ids[j]! })
    }
  }
  return out
}

const key = (f: Fighter, o: EvalOpts) =>
  `shot:${f.id}:${Math.round(f.pos.x * 8)}:${Math.round(f.pos.z * 8)}:${Math.round(f.facing * 20)}:${f.posture}:${o.aimed ? 1 : 0}:${o.mode}:${o.actionsLeft}`

/** The best shot from the fighter as it stands in `state` (null: nothing to shoot). Cached per decision. */
export function bestShot(ctx: AiCtx, state: GameState, f: Fighter, o: EvalOpts): ShotPlan | null {
  const k = key(f, o)
  if (ctx.cache.has(k)) return ctx.cache.get(k) as ShotPlan | null
  let best: ShotPlan | null = null
  if (!f.conditions.blind && f.location === 'board') {
    if (o.mode !== 'blindFire' && f.posture !== 'standing') {
      // prone fighters cannot take a Shoot action at all
    } else if (o.mode === 'blindFire' && f.posture === 'standing') {
      // Blind Fire is a Pinned action
    } else {
      for (const opt of optionList(state, f)) {
        const plan = evalOption(ctx, state, f, opt.weaponId, opt.profileId, opt.twinWith, o)
        if (plan && (!best || plan.value > best.value)) best = plan
      }
    }
  }
  ctx.cache.set(k, best)
  return best
}

/** A shot at a closed door (opens the way when the route needs it); worth a little, never more than a real target. */
export function doorShotPossible(state: GameState, f: Fighter): boolean {
  if (f.conditions.blind || f.posture !== 'standing') return false
  return usableRangedProfiles(state, f).some((u) => canShootDoors(u.profile)) && shootableDoors(state, f, false).length > 0
}

export { ARC_HALF, bandFor }
