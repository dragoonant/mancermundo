// Shoot decisions (docs/spec/40-ai section 2): weapon and target by the engine's exact expected damage and kill odds
// (`expectedDamage`), the cover save always retained, blocking by the engine's `auto` option.
import { answerDecision, expectedDamage } from '@/engine/query'
import { validTargets } from '@/engine/attack-common'
import type { Action } from '@/engine'
import { blastDelta, explosionValue, fixedShot, isExplosive, shotScore } from './eval'
import { passAction } from './random'
import type { AiCtx } from './tiers'

interface Scored {
  weaponId: string
  targetId: string
  score: number
}

function chooseTop<T extends { score: number }>(ctx: AiCtx, list: T[]): T | null {
  if (list.length === 0) return null
  const sorted = [...list].sort((a, b) => b.score - a.score)
  const k = Math.min(ctx.params.topK, sorted.length)
  return sorted[k > 1 ? ctx.int(k) : 0]!
}

/** shoot.weapon: the (weapon, target) pair with the best exact score; the pair is remembered for shoot.target. */
export function shootWeapon(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const op = view.operatives[String(pending.context.operativeId)]
  if (!op || !pending.options) return null
  const pairs: Scored[] = []
  for (const o of pending.options) {
    const wid = String((o.action.payload as { weaponId?: string }).weaponId)
    const w = view.data.weapons[wid]
    if (w && isExplosive(w)) {
      const score = explosionValue(ctx, view, op, wid)
      if (score > 0) pairs.push({ weaponId: wid, targetId: op.id, score })
      continue
    }
    // a weapon that names its own targets (Detonate) is scored on all of them together, not as a shot at a valid enemy
    const fixed = fixedShot(ctx, view, op, wid)
    if (fixed) {
      if (fixed.score > 0) pairs.push({ weaponId: wid, targetId: fixed.targetId, score: fixed.score })
      continue
    }
    let targets
    try {
      targets = validTargets(view, op, wid)
    } catch {
      continue
    }
    for (const info of targets) {
      const t = view.operatives[info.id]
      if (!t || t.seat === op.seat) continue
      const ed = expectedDamage(view, op.id, wid, t.id)
      pairs.push({ weaponId: wid, targetId: t.id, score: shotScore(ctx, view, t, ed.mean, ed.killProbability) + blastDelta(ctx, view, op, wid, t) })
    }
  }
  const best = chooseTop(ctx, pairs)
  // nothing worth shooting (a Bomb Squig with no one in its blast): cancel the action rather than waste it
  if (!best) {
    ctx.memory.banned.push('shoot')
    return pending.canPass ? passAction(pending) : (pending.options[0]?.action ?? null)
  }
  ctx.memory.shot = { operativeId: op.id, weaponId: best.weaponId, targetId: best.targetId }
  return pending.options.find((o) => (o.action.payload as { weaponId?: string }).weaponId === best.weaponId)?.action ?? null
}

/** shoot.target: the remembered target, else the best by the odds the engine attached to each option. */
export function shootTarget(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const opts = pending.options ?? []
  if (pending.context.secondary === true) {
    // Blast / Torrent secondaries: add every enemy, never a friend, then stop
    const me = view.operatives[String(pending.context.operativeId)]
    const add = opts.find((o) => {
      if (o.id === 'done') return false
      const t = view.operatives[String((o.action.payload as { targetId?: string }).targetId)]
      return !!t && t.seat !== me?.seat
    })
    return add?.action ?? opts.find((o) => o.id === 'done')?.action ?? null
  }
  const mem = ctx.memory.shot
  const wid = String(pending.context.weaponId)
  if (mem && mem.weaponId === wid && mem.operativeId === pending.context.operativeId) {
    const o = opts.find((x) => (x.action.payload as { targetId?: string }).targetId === mem.targetId)
    if (o) return o.action
  }
  const scored: (Scored & { a: Action })[] = []
  for (const o of opts) {
    const tid = String((o.action.payload as { targetId?: string }).targetId)
    const t = view.operatives[tid]
    if (!t) continue
    scored.push({ weaponId: wid, targetId: tid, a: o.action, score: shotScore(ctx, view, t, Number(o.data?.expectedDamage ?? 0), Number(o.data?.killProbability ?? 0)) })
  }
  return chooseTop(ctx, scored)?.a ?? null
}

/** weapon.choice: for a cover-or-obscured choice take whichever the exact odds say hurts least; otherwise the first. */
export function weaponChoice(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const opts = pending.options ?? []
  if (pending.context.choice === 'coverOrObscured') {
    const a = view.attack
    const attackerId = String(pending.context.attackerId ?? a?.operativeId)
    const wid = a?.weaponId
    const tid = String(pending.context.targetId)
    if (wid) {
      try {
        const ed = expectedDamage(view, attackerId, wid, tid)
        const want = ed.obscured ? 'obscured' : 'cover'
        const hit = opts.find((o) => o.id === want)
        if (hit) return hit.action
      } catch {
        // fall through to the engine default
      }
    }
  }
  return answerDecision(view, pending)
}

/** Cover save (always retained) and block (the engine's auto option). */
export function defenceAnswer(ctx: AiCtx): Action | null {
  return answerDecision(ctx.view, ctx.pending)
}
