// The random tier and the fallback for every decision no policy scores: uniform over legal actions; move paths and
// deploy spots are random legal points. Never throws for a decision the engine can raise (unknown continuous kinds
// answer with the engine's suggestion or pass). Uses only the seeded stream of the AiCtx, never Math.random.
import { act, suggestPlacement, validate, type Action, type GameState, type PendingDecision, type Waypoint } from '@/engine'
import { polygonBBox, round3 } from '@/engine/geometry'
import { terrainOf } from '@/engine/terrain'
import type { AiCtx } from './tiers'

export function passAction(p: PendingDecision): Action {
  return { type: 'pass', seat: p.seat, decisionId: p.id, payload: {} } as Action
}

/** Uniform random legal answer. */
export function randomPolicy(ctx: AiCtx): Action {
  const { pending, legal, view } = ctx
  if (legal && legal.length > 0) return legal[ctx.int(legal.length)]!
  switch (pending.kind) {
    case 'setup.deploy':
      return randomDeploy(ctx)
    case 'move.path':
      return randomMove(ctx)
    case 'setup.equipMarker': {
      const s = pending.context.suggestion as { x: number; z: number; yaw?: number } | undefined
      if (s) return { type: 'setup.equipMarker', seat: pending.seat, decisionId: pending.id, payload: { x: s.x, z: s.z, yaw: s.yaw ?? 0 } } as Action
      break
    }
    case 'marker.place': {
      const op = view.operatives[String(pending.context.operativeId)]
      if (op && !pending.canPass) return { type: 'marker.place', seat: pending.seat, decisionId: pending.id, payload: { x: op.pos.x, z: op.pos.z } } as Action
      break
    }
    default:
      break
  }
  if (pending.canPass) return passAction(pending)
  throw new Error(`random policy cannot answer ${pending.kind}`)
}

function randomDeploy(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const c = pending.constraints!
  const ids = c.operativeIds!
  const box = polygonBBox(c.region!)
  for (let i = 0; i < 80; i++) {
    const id = ids[ctx.int(ids.length)]!
    const a = act.deploy(pending, id, round3(box.minX + ctx.rand() * (box.maxX - box.minX)), round3(box.minZ + ctx.rand() * (box.maxZ - box.minZ)))
    if (!validate(view, a)) return a
  }
  const spot = suggestPlacement(view, pending, undefined, ctx.int(1000))
  if (!spot) throw new Error('no legal deploy spot')
  return act.deploy(pending, spot.operativeId, spot.x, spot.z, spot.y)
}

/** A random legal move path (the sim bot's generator, reading the redacted view). */
export function randomMove(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const c = pending.constraints!
  const op = view.operatives[c.operativeId!]!
  const enemies = Object.values(view.operatives).filter((o) => o.status === 'active' && o.seat !== op.seat)
  const vantage = terrainOf(view.map).solids.filter((s) => s.floors.length > 0)
  const max = c.maxInches ?? 6
  const toward = (tx: number, tz: number, len: number): { x: number; z: number } => {
    const dx = tx - op.pos.x
    const dz = tz - op.pos.z
    const d = Math.hypot(dx, dz) || 1
    const l = Math.min(len, d)
    return { x: round3(op.pos.x + (dx / d) * l), z: round3(op.pos.z + (dz / d) * l) }
  }
  const nearest = enemies.length
    ? enemies.reduce((a, b) => (Math.hypot(a.pos.x - op.pos.x, a.pos.z - op.pos.z) < Math.hypot(b.pos.x - op.pos.x, b.pos.z - op.pos.z) ? a : b))
    : null
  for (let i = 0; i < 80; i++) {
    let wps: Waypoint[]
    const roll = ctx.rand()
    if (c.kind === 'charge' && enemies.length > 0) {
      const e = ctx.rand() < 0.6 && nearest ? nearest : enemies[ctx.int(enemies.length)]!
      const dx = e.pos.x - op.pos.x
      const dz = e.pos.z - op.pos.z
      const d = Math.hypot(dx, dz) || 1
      const stop = e.baseRadius + op.baseRadius + 0.05 + ctx.rand() * 0.6
      wps = [{ x: round3(e.pos.x - (dx / d) * stop), z: round3(e.pos.z - (dz / d) * stop), y: e.pos.y }]
    } else if (c.kind === 'fallBack' && nearest) {
      const away = toward(2 * op.pos.x - nearest.pos.x, 2 * op.pos.z - nearest.pos.z, 1 + ctx.rand() * Math.max(1, max - 1))
      wps = [{ x: away.x, z: away.z, y: op.pos.y }]
    } else if (op.pos.y > 2 && roll < 0.35) {
      const ang = ctx.rand() * Math.PI * 2
      const len = 1 + ctx.rand() * 3
      const x = round3(op.pos.x + Math.sin(ang) * len)
      const z = round3(op.pos.z + Math.cos(ang) * len)
      wps = ctx.rand() < 0.5 ? [{ x, z, y: ctx.rand() < 0.5 ? 0 : op.pos.y, jump: true }] : [{ x, z, y: 0 }]
    } else if (roll < 0.3 && vantage.length > 0) {
      const s = vantage[ctx.int(vantage.length)]!
      const tx = round3(s.bbox.minX + ctx.rand() * (s.bbox.maxX - s.bbox.minX))
      const tz = round3(s.bbox.minZ + ctx.rand() * (s.bbox.maxZ - s.bbox.minZ))
      if (Math.hypot(tx - op.pos.x, tz - op.pos.z) <= max) wps = [{ x: tx, z: tz, y: s.floors[0] }]
      else {
        const w = toward(tx, tz, max)
        wps = [{ x: w.x, z: w.z, y: op.pos.y }]
      }
    } else if (roll < 0.7 && nearest) {
      const w = toward(nearest.pos.x, nearest.pos.z, 0.5 + ctx.rand() * max)
      wps = [{ x: w.x, z: w.z, y: op.pos.y }]
    } else {
      const n = 1 + ctx.int(2)
      wps = []
      let x = op.pos.x
      let z = op.pos.z
      for (let k = 0; k < n; k++) {
        const ang = ctx.rand() * Math.PI * 2
        const len = 0.5 + ctx.rand() * Math.max(0.5, max / n - 0.5)
        x = round3(x + Math.sin(ang) * len)
        z = round3(z + Math.cos(ang) * len)
        wps.push({ x, z, y: op.pos.y })
      }
    }
    const a = act.path(pending, wps)
    if (!validate(view, a)) return a
  }
  return passAction(pending)
}

/** Does the view hold a decision we know how to answer randomly? (used by tests) */
export function randomAnswerable(_view: GameState, pending: PendingDecision): boolean {
  return !!pending.options || ['setup.deploy', 'move.path', 'setup.equipMarker', 'marker.place'].includes(pending.kind) || pending.canPass
}
