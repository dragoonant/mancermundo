// The threat map (docs/spec/40-ai.md section 2): how much a fighter would expect to lose, next round, by standing at a spot in
// a posture. For every enemy that could act against it: a shot from where the enemy stands now (line of sight, range band,
// cover, final need, the wound / save / Injury chain), a weaker "it walks into sight first" share when there is no line of
// sight yet, and a charge weighted by the chance that Move + D3 reaches. A Prone fighter in cover is untargetable by ranged
// attacks (R-4.4), so Take Cover shows up as a real drop in exposure. All odds are the engine's.
import { query } from '@/engine'
import { hitChanceFor } from '@/engine/dice'
import { baseGap } from '@/engine/measure'
import { coverFrom, hiddenFromRanged } from '@/engine/los'
import { sees } from './sight'
import { bandFor, hitNeedFor, usableRangedProfiles } from '@/engine/shoot'
import { isTemplate, profileRanges } from '@/engine/traits'
import { reachChance } from '@/engine/fight'
import { constants, enemiesOf, isBroken } from '@/engine/state'
import type { Fighter, GameState, Vec2 } from '@/engine'
import { fighterValue, hitChain, overlay, shotOutcome } from './eval'
import { fieldFrom, sampleField } from './field'
import type { AiCtx } from './tiers'

export interface Exposure {
  /** expected loss in ganger units */
  loss: number
  pOoa: number
  pSi: number
  pPin: number
}

const NO_EXPOSURE: Exposure = { loss: 0, pOoa: 0, pSi: 0, pPin: 0 }

interface RangedGun {
  weaponId: string
  p: ReturnType<typeof usableRangedProfiles>[number]['profile']
  short: number | null
  long: number
}

interface EnemyInfo {
  e: Fighter
  guns: RangedGun[]
  m: number
}

function enemyInfos(ctx: AiCtx, state: GameState, seat: Fighter['seat']): EnemyInfo[] {
  const key = `enemies:${seat}`
  const hit = ctx.cache.get(key) as EnemyInfo[] | undefined
  if (hit) return hit
  const out: EnemyInfo[] = []
  for (const e of enemiesOf(state, { seat })) {
    if (e.posture === 'seriouslyInjured') continue
    const guns: RangedGun[] = []
    for (const u of usableRangedProfiles(state, e)) {
      const r = profileRanges(u.profile, e.stats.S)
      const template = isTemplate(u.profile)
      const long = template ? constants(state).template.length : r.long
      if (long === null) continue
      guns.push({ weaponId: u.weaponId, p: u.profile, short: template ? long : r.short, long })
    }
    out.push({ e, guns, m: e.stats.M })
  }
  ctx.cache.set(key, out)
  return out
}

const centre = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })

/**
 * Expected loss for `f` at `at` in `posture`. `state` is the real state; the fighter is moved in an overlay. A fighter that is
 * Engaged at the spot (a charge target spot) is the caller's business: this measures what the enemy can bring to bear from
 * where it stands now, plus its charge.
 */
export function exposure(ctx: AiCtx, state: GameState, f: Fighter, at: Vec2, posture: Fighter['posture'], facing = f.facing): Exposure {
  if (ctx.params.threatScale <= 0) return NO_EXPOSURE
  const key = `exp:${f.id}:${Math.round(at.x * 6)}:${Math.round(at.z * 6)}:${posture}`
  const hit = ctx.cache.get(key) as Exposure | undefined
  if (hit) return hit
  const ov = overlay(state, f.id, { pos: at, posture, facing, free: true })
  const me = ov.fighters[f.id]!
  const value = fighterValue(state, f)
  let surviveOoa = 1
  let surviveSi = 1
  let survivePin = 1
  for (const info of enemyInfos(ctx, state, f.seat)) {
    const e = info.e
    if (e.id === f.id) continue
    const broken = isBroken(e)
    const prone = e.posture === 'pinned'
    const rw = (e.ready ? 1 : 0.55) * (broken ? 0.15 : 1)
    const gap = baseGap(e, me)
    // ---- ranged: the best gun this enemy has against the spot
    let bestOoa = 0
    let bestSi = 0
    let bestPin = 0
    if (info.guns.length > 0 && !broken) {
      const seen = gap <= 30 && sees(ctx, ov, centre(e), me)
      let cover: 'none' | 'partial' | 'full' = 'partial'
      if (seen) cover = coverFrom(ov, centre(e), me, e).cover
      for (const g of info.guns) {
        if (gap > g.long + info.m * 0.8) continue
        const direct = seen && gap <= g.long
        if (direct && hiddenFromRanged(me, cover)) continue
        const w = direct ? rw * (prone ? 0.85 : 1) : rw * 0.3
        const band = bandFor(ov, e, g.p, Math.min(gap, g.long)).band ?? 'long'
        const tpl = isTemplate(g.p)
        const need = hitNeedFor(ov, e, g.p, { mode: 'shoot', band, cover: direct ? cover : 'partial', target: me })
        const pHit = tpl ? 1 : hitChanceFor(need.need, need.bs)
        const o = shotOutcome(hitChain(ctx, ov, e, g.weaponId, g.p, me), pHit, me)
        const score = o.pOutOfAction + 0.65 * o.pSeriouslyInjured
        if (w * score > bestOoa + 0.65 * bestSi) {
          bestOoa = w * o.pOutOfAction
          bestSi = w * o.pSeriouslyInjured
        }
        bestPin = Math.max(bestPin, w * o.pPinned)
      }
    }
    // ---- charge: an enemy that is Ready (or will be) and close enough to reach
    let meleeOoa = 0
    let meleeSi = 0
    if (!broken && gap <= info.m + 3.2 && e.posture === 'standing' && e.engagedWith.length === 0) {
      // walking distance from the enemy to base contact with the spot (grid field of the enemy, cached across decisions)
      const walk = sampleField(fieldFrom(state, centre(e), e.baseRadius, false), at) - e.baseRadius - me.baseRadius
      const pReach = reachChance(info.m, Math.max(0, walk) * 1.05)
      if (pReach > 0) {
        const fo = query.fightOutcome(ov, e.id, undefined, [me.id], { charge: true }).targets[0]
        if (fo) {
          meleeOoa = rw * pReach * 0.9 * fo.pOutOfAction
          meleeSi = rw * pReach * 0.9 * fo.pSeriouslyInjured
        }
      }
    }
    surviveOoa *= (1 - bestOoa) * (1 - meleeOoa)
    surviveSi *= (1 - bestSi) * (1 - meleeSi)
    survivePin *= 1 - bestPin
  }
  const pOoa = 1 - surviveOoa
  const pSi = Math.max(0, 1 - surviveSi) * (1 - pOoa)
  const pPin = posture === 'standing' ? 1 - survivePin : 0
  const loss = value * (pOoa + 0.65 * pSi) + ctx.w.pin * value * 0.5 * pPin
  const out: Exposure = { loss, pOoa, pSi, pPin }
  ctx.cache.set(key, out)
  return out
}

/** Chance-free melee exposure of a Prone or Standing fighter to enemies already in base contact (they hit it next round). */
export function cheapDanger(state: GameState, f: Fighter): number {
  let n = 0
  for (const e of enemiesOf(state, f)) {
    if (e.posture === 'seriouslyInjured') continue
    if (baseGap(e, f) < 6) n++
  }
  return n
}
