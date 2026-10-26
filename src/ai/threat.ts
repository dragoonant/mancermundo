// Threat map (docs/spec/40-ai section 2): for a candidate position, the expected damage the enemy operatives could
// inflict on us on their next activation, given visibility, cover, the order and whether they are ready. A Conceal
// operative in cover that the engine says cannot be targeted is untargetable (the enemy would have to move to change
// the cover verdict, which is discounted). Engine verdicts (`targetInfo`) decide visibility and cover; the damage
// figure comes from the cached open-ground table in eval.ts.
import { parseRules } from '@/engine/attack-common'
import { bodyOf } from '@/engine/los'
import { distanceBetween } from '@/engine/measure'
import { enemiesOf, effectiveMove } from '@/engine/state'
import type { GameState, Operative } from '@/engine'
import { coverFactor, infoOf, memo, openMean, posKey, rulesOf, sees } from './eval'
import type { AiCtx } from './tiers'

export interface Threat {
  /** expected wounds of damage the enemy could do next */
  expected: number
  /** probability the operative is incapacitated */
  killRisk: number
  /** enemies that can see it right now */
  seenBy: number
}

interface EnemyProfile {
  id: string
  ranged: { weaponId: string; range: number | null }[]
  meleeIds: string[]
}

function profileOf(ctx: AiCtx, view: GameState, e: Operative): EnemyProfile {
  return memo(ctx, `prof|${e.id}`, () => {
    const ranged: EnemyProfile['ranged'] = []
    const meleeIds: string[] = []
    for (const id of e.weapons) {
      const w = view.data.weapons[id]
      if (!w) continue
      if (w.type === 'ranged') ranged.push({ weaponId: id, range: parseRules(w.rules).range })
      else meleeIds.push(id)
    }
    return { id: e.id, ranged, meleeIds }
  })
}

/** Rough melee damage of `att` against `tgt` when it reaches it: hit successes on both sides trade. */
function meleeMean(view: GameState, att: Operative, tgt: Operative): number {
  let best = 0
  for (const id of att.weapons) {
    const w = view.data.weapons[id]
    if (!w || w.type !== 'melee') continue
    // successes ~ atk * P(hit); about 60% of a charger's successes land after the defender blocks with its own dice
    const p = (7 - Math.max(2, Math.min(6, w.hit))) / 6
    const dmg = w.atk * p * (w.dmg.normal * 0.8 + w.dmg.crit * 0.2)
    best = Math.max(best, dmg * 0.6)
  }
  void tgt
  return best
}

/**
 * Expected incoming damage at `me` (an operative of ours placed in `view` at the candidate position with the
 * candidate order). Memoised per position and order within a decision.
 */
export function threatAt(ctx: AiCtx, view: GameState, me: Operative): Threat {
  const key = `T|${me.id}|${me.order}|${posKey(me.pos)}`
  return memo(ctx, key, () => computeThreat(ctx, view, me))
}

function computeThreat(ctx: AiCtx, view: GameState, me: Operative): Threat {
  let expected = 0
  let seenBy = 0
  const meBody = { ...bodyOf(me), order: me.order }
  for (const e of enemiesOf(view, me)) {
    const prof = profileOf(ctx, view, e)
    // ready enemies act this turning point; expended ones only matter from the next one
    const rw = e.ready ? 1 : e.flags.guard ? 0.7 : 0.3
    const gap = distanceBetween(bodyOf(e), bodyOf(me))
    const engaged = gap <= 1.05
    const move = e.ready && !engaged ? effectiveMove(e, view) : 0
    let best = 0
    for (const rg of prof.ranged) {
      if (rg.range !== null && gap > rg.range + move) continue
      const base = openMean(view, e, rg.weaponId, me)
      if (base <= 0.05) continue
      let direct = 0
      if ((rg.range === null || gap <= rg.range) && !engaged && sees(ctx, view, e, me)) {
        const rules = rulesOf(ctx, view, e, rg.weaponId)
        const info = infoOf(ctx, view, e, me, rules)
        if (info.verdict.visible) {
          seenBy++
          // a Conceal operative in cover cannot be targeted from here (it could be from elsewhere, so not zero)
          direct = info.coverBlocks ? base * 0.12 : base * coverFactor({ ...info.verdict, improvedCover: info.improvedCover })
        }
      }
      let approach = 0
      if (move > 0 && direct < base * 0.5) {
        // the enemy may reposition for a line of sight; Conceal in cover is harder to find
        approach = base * (me.order === 'conceal' ? 0.18 : 0.4)
      }
      best = Math.max(best, direct, approach)
    }
    if (e.ready) {
      const reach = (e.move ?? 6) + 2 + 1
      if (gap <= reach) best = Math.max(best, meleeMean(view, e, me) * (engaged ? 1 : 0.7))
    }
    expected += rw * best
  }
  const killRisk = Math.max(0, Math.min(1, 1 / (1 + Math.exp(-6 * (expected / Math.max(1, me.wounds) - 0.95)))))
  return { expected, killRisk, seenBy }
}

/** Threat folded into a score: capped incoming damage plus a premium for the chance to lose the operative. */
export function threatPenalty(ctx: AiCtx, t: Threat, me: Operative): number {
  const s = ctx.params.threatScale
  if (s <= 0) return 0
  return s * (ctx.w.threat * Math.min(t.expected, me.wounds * 1.2) + ctx.w.die * t.killRisk)
}
