// The random tier and the last-resort fallback (docs/spec/40-ai.md section 1). Uniform over legal actions (an action type
// first, so a rare door option is not drowned by eighteen turn facings); continuous kinds get a random legal point checked
// with `validate`, falling back to the engine's `suggest`. Uses only the seeded stream of the AiCtx, never Math.random.
import { act, suggest, validate, type Action, type PendingDecision } from '@/engine'
import { polygonBBox, round3 } from '@/engine/geometry'
import { approachPoint, planToward, type VoluntaryKind } from '@/engine/movement'
import { oneInchEnemies, getFighter } from '@/engine/state'
import type { AiCtx } from './tiers'

export function passAction(p: PendingDecision): Action {
  return { type: 'pass', seat: p.seat, decisionId: p.id, payload: {} } as Action
}

function chooseType(ctx: AiCtx, legal: Action[]): Action {
  const groups = new Map<string, Action[]>()
  for (const a of legal) {
    const key = a.type === 'action.choose' ? a.payload.action : a.type
    const l = groups.get(key)
    if (l) l.push(a)
    else groups.set(key, [a])
  }
  const keys = [...groups.keys()]
  const weights = keys.map((k) => (k === 'end' || k === 'turn' ? 0.5 : k === 'charge' || k === 'fight' || k === 'coupDeGrace' ? 2 : 1))
  let roll = ctx.rand() * weights.reduce((x, y) => x + y, 0)
  let pick = keys[keys.length - 1]!
  for (let i = 0; i < keys.length; i++) {
    roll -= weights[i]!
    if (roll < 0) {
      pick = keys[i]!
      break
    }
  }
  const list = groups.get(pick)!
  return list[ctx.int(list.length)]!
}

function randomDeploy(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const c = pending.constraints!
  const ids = c.fighterIds ?? []
  if (ids.length === 0 || !c.region) return null
  const box = polygonBBox(c.region)
  const id = ids[ctx.int(ids.length)]!
  // a cramped strip (tile deployment): pack the way the engine does, or the last fighters find no room
  const cramped = (() => {
    let n = 0
    for (let z = box.minZ + 0.5; z <= box.maxZ - 0.5 && n < ids.length * 12; z += 0.5) {
      for (let x = box.minX + 0.5; x <= box.maxX - 0.5 && n < ids.length * 12; x += 0.5) if (!validate(view, act.deploy(pending, id, x, z, 0))) n++
    }
    return n < ids.length * 12
  })()
  if (cramped) {
    const packed = suggest(view, pending)
    if (packed && !validate(view, packed)) return packed
  }
  for (let i = 0; i < 80; i++) {
    const a = act.deploy(pending, id, round3(box.minX + ctx.rand() * (box.maxX - box.minX)), round3(box.minZ + ctx.rand() * (box.maxZ - box.minZ)), round3((ctx.rand() - 0.5) * 2 * Math.PI))
    if (!validate(view, a)) return a
  }
  // a cramped zone: any legal spot of a half-inch lattice, in random order
  const spots: { x: number; z: number }[] = []
  for (let z = box.minZ + 0.5; z <= box.maxZ - 0.5; z += 0.5) for (let x = box.minX + 0.5; x <= box.maxX - 0.5; x += 0.5) spots.push({ x, z })
  for (let i = spots.length - 1; i > 0; i--) {
    const j = ctx.int(i + 1)
    ;[spots[i], spots[j]] = [spots[j]!, spots[i]!]
  }
  for (const q of spots) {
    const a = act.deploy(pending, id, q.x, q.z, 0)
    if (!validate(view, a)) return a
  }
  return null
}

function randomMove(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const c = pending.constraints!
  if (!c.fighterId) return null
  const f = getFighter(view, c.fighterId)
  const max = c.maxInches ?? 0
  const enemies = oneInchEnemies(view, f)
  const nearest = enemies.length ? enemies.reduce((a, b) => (Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) < Math.hypot(b.pos.x - f.pos.x, b.pos.z - f.pos.z) ? a : b)) : null
  const kind = c.kind as VoluntaryKind
  for (let i = 0; i < 40; i++) {
    const roll = ctx.rand()
    let wps: { x: number; z: number }[] | null = null
    if (roll < 0.5 && nearest) wps = planToward(view, f, kind, max, approachPoint(view, f, nearest))
    else if (roll < 0.65) wps = planToward(view, f, kind, max, { x: round3((ctx.rand() - 0.5) * 22), z: round3((ctx.rand() - 0.5) * 34) })
    else {
      const n = 1 + ctx.int(3)
      let x = f.pos.x
      let z = f.pos.z
      wps = []
      for (let k = 0; k < n; k++) {
        const ang = ctx.rand() * Math.PI * 2
        const len = 0.25 + ctx.rand() * Math.max(0.25, max / n)
        x = round3(x + Math.sin(ang) * len)
        z = round3(z + Math.cos(ang) * len)
        wps.push({ x, z })
      }
    }
    if (!wps || wps.length === 0) continue
    const a = act.path(pending, wps, ctx.rand() < 0.3 ? round3((ctx.rand() - 0.5) * 2 * Math.PI) : undefined)
    if (!validate(view, a)) return a
  }
  if (kind === 'takeCover') {
    const a = act.path(pending, [])
    if (!validate(view, a)) return a
  }
  return null
}

/** Uniform random legal answer; never throws for a decision the engine can raise. */
export function randomPolicy(ctx: AiCtx): Action {
  const { pending, legal, view } = ctx
  if (legal && legal.length > 0) {
    if (pending.kind === 'action.choose') return chooseType(ctx, legal)
    // a random crew still fills its places (picking `done` after one fighter would hand every battle to the other side)
    const picks = pending.kind === 'setup.crew' ? legal.filter((a) => a.type === 'setup.crew' && a.payload.fighterId) : legal
    const pool = picks.length > 0 ? picks : legal
    return pool[ctx.int(pool.length)]!
  }
  let a: Action | null = null
  if (pending.kind === 'setup.deploy') a = randomDeploy(ctx)
  else if (pending.kind === 'move.path') a = randomMove(ctx)
  if (a) return a
  const s = suggest(view, pending)
  if (s && !validate(view, s)) return s
  if (pending.canPass) return passAction(pending)
  if (s) return s
  throw new Error(`random policy cannot answer ${pending.kind}`)
}

/**
 * The scored fallback for a decision no policy answered (an unhandled kind, or an answer the engine would refuse): the
 * engine's own suggestion, then the first legal option, then a pass. Never random; the decider counts every use.
 */
export function suggestPolicy(ctx: AiCtx): Action {
  const { pending, legal, view } = ctx
  const s = suggest(view, pending)
  if (s && !validate(view, s)) return s
  if (legal && legal.length > 0) {
    const ok = legal.find((a) => a.type !== 'pass') ?? legal[0]!
    return ok
  }
  if (pending.canPass) return passAction(pending)
  if (s) return s
  throw new Error(`no answer for ${pending.kind}`)
}
