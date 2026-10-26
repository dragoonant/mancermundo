// Values for the utility scoring (docs/spec/40-ai.md section 2): what a fighter is worth, what a shot or a fight is worth, and
// the overlay states the planner uses to ask the engine "what if this fighter stood there". Every probability comes from the
// engine (`query.*` and the engine's own dice and wargear functions); this file only weighs them.
import { query } from '@/engine'
import { expectedDamage, firepowerHitsDistribution, hitChanceFor, parseDiceExpr, parseFirepowerFace, saveChanceFor, woundChanceFor, woundNeed, toxinChance } from '@/engine/dice'
import { armourSave } from '@/engine/wargear'
import { injuryOdds } from '@/engine/dice'
import { blastRadius, firepowerDice, hasTrait, isTemplate, makesWoundRoll, meltaApplies, profileRanges, profileStrength, rapidFire, T } from '@/engine/traits'
import { isBroken } from '@/engine/state'
import type { Fighter, GameState, RuntimeProfile, Vec2 } from '@/engine'
import type { ExpectedOutcome } from '@/engine/query'
import type { AiCtx, Weights } from './tiers'

// ---------------------------------------------------------------------------
// Overlay states: the same state with one fighter somewhere else
// ---------------------------------------------------------------------------

export interface Patch {
  pos?: Vec2
  facing?: number
  posture?: Fighter['posture']
  /** engagement is derived data the overlay cannot refresh: a moved fighter is never Engaged in the overlay */
  free?: boolean
}

/**
 * The state as it would look with fighter `id` changed. The result shares everything but the `fighters` record (fighters are
 * copied one level deep for the patched one only); the engine's nav and board caches are keyed by board and door state, so
 * they stay warm across overlays. Never pass an overlay to `step`.
 */
export function overlay(state: GameState, id: string, patch: Patch): GameState {
  const f = state.fighters[id]!
  const next: Fighter = {
    ...f,
    pos: patch.pos ? { x: patch.pos.x, y: f.pos.y, z: patch.pos.z } : f.pos,
    facing: patch.facing ?? f.facing,
    posture: patch.posture ?? f.posture,
    engagedWith: patch.free ? [] : f.engagedWith,
  }
  return { ...state, fighters: { ...state.fighters, [id]: next } }
}

/** Several fighters at once (the two ends of a charge, a fighter and the one it removes). */
export function overlayMany(state: GameState, patches: Record<string, Patch>): GameState {
  let s = state
  for (const [id, p] of Object.entries(patches)) s = overlay(s, id, p)
  return s
}

/** A copy of the state without a fighter on the board (a target assumed removed). */
export function without(state: GameState, id: string): GameState {
  const f = state.fighters[id]!
  return { ...state, fighters: { ...state.fighters, [id]: { ...f, location: 'outOfAction' as const, engagedWith: [] } } }
}

// ---------------------------------------------------------------------------
// What a fighter is worth
// ---------------------------------------------------------------------------

/** Scenario points a fighter is worth when it goes down (M-2.4): Leader 3, Champion 2, anyone else 1. */
export function pointsOf(f: { role: string }): number {
  return f.role === 'leader' ? 3 : f.role === 'champion' ? 2 : 1
}

/**
 * The worth of a fighter in "ganger units": its scenario points, plus a little for a heavy or special weapon that is still
 * working (a Bruiser with a launcher is worth more than a Juve with a knife). Seriously Injured fighters are mostly out of the
 * fight already; Broken ones come back only after a Rally.
 */
export function fighterValue(state: GameState, f: Fighter): number {
  let v = pointsOf(f)
  for (const w of f.weapons) {
    if (w.ammo === 'out' || w.ammo === 'spent' || w.ammo === 'jammed') continue
    const c = state.data.weapons[w.weaponId]?.class
    if (c === 'heavy') v += 0.45
    else if (c === 'special') v += 0.3
  }
  if (f.posture === 'seriouslyInjured') v *= 0.45
  else if (isBroken(f)) v *= 0.8
  return v
}

// ---------------------------------------------------------------------------
// Hits: what one hit does, and what a shot does
// ---------------------------------------------------------------------------

/** What one successful wound roll does to a target (the chain after the hit roll). */
export interface HitChain {
  pWound: number
  pUnsaved: number
  /** per unsaved wound: Out of Action / Seriously Injured (and not Out of Action) */
  q: number
  r: number
  /** expected Wounds lost per unsaved wound */
  mean: number
  /** chance distribution of hits per successful hit roll (Rapid Fire holes), times the Scattershot multiplier */
  dist: number[]
  mult: number
  gas: boolean
}

function chainKey(attackerId: string, weaponId: string, profileId: string, targetId: string, t: Fighter): string {
  return `chain:${attackerId}:${weaponId}:${profileId}:${targetId}:${t.wounds}:${t.posture}:${t.fleshWounds}:${Math.round(t.pos.x * 3)}:${Math.round(t.pos.z * 3)}`
}

/**
 * The hit-to-injury chain of a profile against a target, composed from the engine's own functions (wound table, armour save,
 * Injury dice odds), the same composition `query.expectedOutcome` makes but without a hit roll, so a threat estimate does not
 * need the target to be inside the attacker's arc. `tests/ai` checks it against `query.expectedOutcome`.
 */
export function hitChain(ctx: AiCtx | null, state: GameState, attacker: Fighter, weaponId: string, p: RuntimeProfile, target: Fighter): HitChain {
  const key = chainKey(attacker.id, weaponId, p.id, target.id, target)
  const hit = ctx?.cache.get(key) as HitChain | undefined
  if (hit) return hit
  const template = isTemplate(p)
  const vs = template ? 'template' : blastRadius(p) !== null ? 'blast' : null
  const gas = hasTrait(p, T.gas)
  const toxic = gas || hasTrait(p, T.toxin)
  const rf = rapidFire(p)
  const dist = rf > 0 ? firepowerHitsDistribution(state, rf) : [0, 1]
  const mult = hasTrait(p, T.scattershot) ? 3.5 : 1
  const toughness = query.stat(state, target.id, 'T')
  let pWound: number
  if (toxic) pWound = toxinChance(toughness)
  else if (!makesWoundRoll(p)) pWound = 0
  else pWound = woundChanceFor(woundNeed(profileStrength(p, query.stat(state, attacker.id, 'S')), toughness))
  const pSave = gas ? 0 : saveChanceFor(armourSave(state, target, { ap: p.ap, from: attacker, vs }).need)
  const melta = meltaApplies(p, Math.max(0, Math.hypot(attacker.pos.x - target.pos.x, attacker.pos.z - target.pos.z) - attacker.baseRadius - target.baseRadius), profileRanges(p, attacker.stats.S).short)
  const outcomes: { d: number; w: number }[] = []
  if (toxic) outcomes.push({ d: -1, w: 1 })
  else if (p.dmg.kind === 'none') outcomes.push({ d: 0, w: 1 })
  else if (p.dmg.kind === 'fixed') outcomes.push({ d: p.dmg.value, w: 1 })
  else {
    const e = parseDiceExpr(p.dmg.expr)
    const sides = e.die === 'd3' ? [1, 2, 3] : e.die === 'd6' ? [1, 2, 3, 4, 5, 6] : [7]
    for (const v of sides) outcomes.push({ d: v + e.add, w: 1 / sides.length })
  }
  let q = 0
  let r = 0
  for (const { d, w } of outcomes) {
    const n = d < 0 ? 1 : target.wounds > 0 ? Math.max(0, d - target.wounds + 1) : d
    const o = injuryOdds(state, n, { toughness, alreadySeriouslyInjured: target.posture === 'seriouslyInjured', melta: melta && d >= 0 })
    q += w * o.pOutOfAction
    r += w * o.pSeriouslyInjured
  }
  const mean = toxic ? 0 : Math.min(expectedDamage(p.dmg), Math.max(target.wounds, 0))
  const chain: HitChain = { pWound, pUnsaved: 1 - pSave, q, r, mean, dist, mult, gas }
  ctx?.cache.set(key, chain)
  return chain
}

/** The outcome of one shot given the chance to hit (pHit = 1 for a Template). Mirrors `ExpectedOutcome`. */
export function shotOutcome(chain: HitChain, pHit: number, target: Fighter): ExpectedOutcome {
  const per = chain.pWound * chain.pUnsaved
  let pOoa = 0
  let pDown = 0
  let meanHits = 0
  chain.dist.forEach((qk, k) => {
    const kk = k * chain.mult
    meanHits += qk * kk
    pOoa += qk * (1 - (1 - per * chain.q) ** kk)
    pDown += qk * (1 - (1 - per * (chain.q + chain.r)) ** kk)
  })
  return {
    pHit,
    pWoundPerHit: chain.pWound,
    pUnsaved: chain.pUnsaved,
    expectedHits: pHit * meanHits,
    expectedWounds: pHit * meanHits * per * chain.mean,
    pSeriouslyInjured: pHit * Math.max(0, pDown - pOoa),
    pOutOfAction: pHit * pOoa,
    pPinned: target.posture === 'standing' && target.engagedWith.length === 0 && !chain.gas ? pHit : 0,
  }
}

/** Worth of a single outcome on a target: kills, Seriously Injured, pins and wounds worn off. */
export function outcomeValue(w: Weights, state: GameState, t: Fighter, o: ExpectedOutcome): number {
  const v = fighterValue(state, t)
  const remaining = Math.max(1, t.wounds)
  return w.dmg * v * (o.pOutOfAction + 0.65 * o.pSeriouslyInjured + 0.1 * Math.min(1, o.expectedWounds / remaining)) + w.pin * v * o.pPinned * 0.5
}

/**
 * Chance a shot costs the weapon its ammo: an Ammo symbol on a Firepower die, then a failed test (R-8.9). Out of Ammo weapons
 * stay in the fighter's hands but a reload costs an action, so it is priced rather than forbidden.
 */
export function ammoRisk(state: GameState, p: RuntimeProfile): number {
  if (p.ammo === null) return 0
  const n = firepowerDice(p)
  const failTest = (p.ammo - 1) / 6
  if (hasTrait(p, T.grenade)) return failTest
  if (n === 0) return 0
  const faces = state.data.dice.firepower
  const symbolP = faces.filter((f) => parseFirepowerFace(f).ammo).length / Math.max(1, faces.length)
  return 1 - (1 - symbolP * failTest) ** n
}

/** Hit chance of a shot given a target-info entry, with the Cool test of a priority redirect priced in by the caller. */
export function chanceOf(need: number, bs: number): number {
  return hitChanceFor(need, bs)
}
