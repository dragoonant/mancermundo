// The fight.* decisions (docs/spec/40-ai.md section 2): which weapons to swing, how to split the attack dice between engaged
// enemies, and what to do once everything in reach is down (Coup de Grace first, Consolidate when it improves the footing).
// The odds are `query.fightOutcome`.
import { act, query, type Action, type DecisionOption, type Fighter } from '@/engine'
import { getFighter } from '@/engine/state'
import { fighterValue } from './eval'
import { consolidateSpot } from './moves'
import type { AiCtx } from './tiers'

function downValue(ctx: AiCtx, tPo: number, tSi: number, v: number, wounds: number): number {
  return ctx.w.dmg * v * (tPo + 0.65 * tSi + 0.1 * Math.min(1, wounds))
}

/** `fight.weapons`: the combination with the best expected result against the targets in arc (own blows minus nothing: the
 *  reactions do not depend on what we swing). */
export function weapons(ctx: AiCtx): Action | null {
  const p = ctx.pending
  if (!p.options) return null
  const state = ctx.view
  const fid = String(p.context.fighterId)
  const targets = (p.context.targets as string[] | undefined) ?? []
  const charge = p.context.charge === true
  let best: { o: DecisionOption; v: number } | null = null
  for (const o of p.options) {
    if (o.action.type !== 'fight.weapons') continue
    let v = 0
    if (targets.length > 0) {
      const fo = query.fightOutcome(state, fid, o.action.payload.weaponIds, targets, { charge })
      for (const t of fo.targets) {
        const tf = getFighter(state, t.targetId)
        v += downValue(ctx, t.pOutOfAction, t.pSeriouslyInjured, fighterValue(state, tf), t.expectedWounds / Math.max(1, tf.wounds))
      }
    } else {
      v = (o.data as { dice?: number } | undefined)?.dice ?? 0
    }
    if (!best || v > best.v + 1e-9) best = { o, v }
  }
  return best ? best.o.action : null
}

/** `fight.split`: spread the dice where each one is most likely to take a fighter down (diminishing returns on one target). */
export function split(ctx: AiCtx): Action | null {
  const p = ctx.pending
  if (!p.options) return null
  const state = ctx.view
  const fid = String(p.context.fighterId)
  const targets = (p.context.targets as string[] | undefined) ?? []
  const fo = query.fightOutcome(state, fid, undefined, targets, {})
  const n = Math.max(1, Number(p.context.dice ?? 1))
  const share = Math.max(1, n / Math.max(1, targets.length))
  const info = new Map<string, { v: number; h: number }>()
  for (const t of fo.targets) {
    const tf = getFighter(state, t.targetId)
    const down = Math.min(0.97, t.pOutOfAction + 0.65 * t.pSeriouslyInjured + 0.02)
    info.set(t.targetId, { v: fighterValue(state, tf) * (tf.posture === 'seriouslyInjured' ? 0.6 : 1), h: -Math.log(1 - down) / share })
  }
  let best: { o: DecisionOption; v: number } | null = null
  for (const o of p.options) {
    if (o.action.type !== 'fight.split') continue
    let v = 0
    for (const [id, c] of Object.entries(o.action.payload.split)) {
      const i = info.get(id)
      if (i) v += i.v * (1 - Math.exp(-i.h * c))
    }
    if (!best || v > best.v + 1e-9) best = { o, v }
  }
  return best ? best.o.action : null
}

/** `fight.after`: Coup de Grace on the best Seriously Injured enemy, else Consolidate to better ground, else stay. */
export function after(ctx: AiCtx): Action | null {
  const p = ctx.pending
  if (!p.options) return null
  const state = ctx.view
  let bestCdg: { o: DecisionOption; v: number } | null = null
  let consolidate: DecisionOption | null = null
  let none: DecisionOption | null = null
  for (const o of p.options) {
    if (o.action.type !== 'fight.after') continue
    const pl = o.action.payload
    if (pl.choice === 'coupDeGrace' && pl.targetId) {
      const v = fighterValue(state, getFighter(state, pl.targetId))
      if (!bestCdg || v > bestCdg.v) bestCdg = { o, v }
    } else if (pl.choice === 'consolidate') consolidate = o
    else none = o
  }
  if (bestCdg) return bestCdg.o.action
  if (consolidate) {
    const f: Fighter = getFighter(state, String(p.context.fighterId))
    const s = consolidateSpot(ctx, state, f)
    if (s && s.score > 0.25) {
      const i = ctx.memory.intent
      if (i) i.dest = { path: s.spot.path, facing: s.facing, kind: 'consolidate' }
      return consolidate.action
    }
  }
  return none ? none.action : (p.options[0]?.action ?? act.pass(p))
}

/** `fight.followUp`: stay in base contact with the fighter just knocked back (keeps it Engaged, the stronger choice). */
export function followUp(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const yes = p.options?.find((o) => o.action.type === 'fight.followUp' && o.action.payload.follow)
  return yes ? yes.action : (p.options?.[0]?.action ?? null)
}
