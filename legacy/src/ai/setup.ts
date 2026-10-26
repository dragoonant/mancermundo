// Set-up decisions (docs/spec/40-ai section 2): objective spots with cover around them, the drop zone nearest the
// objectives, equipment markers in the own territory near the centreline and the objectives, and deployment by
// thirds into cover that the enemy approach lines cannot see, near objectives (always Conceal: the engine sets it).
import { act, suggestPlacement, validate, type Action, type GameState, type Operative, type Vec2 } from '@/engine'
import { bodyOf, targetVerdict, type Body } from '@/engine/los'
import { circleInsidePolygon, distToPolygon, polygonBBox, pointInPolygon, round3 } from '@/engine/geometry'
import { terrainOf } from '@/engine/terrain'
import { otherSeat } from '@/engine/state'
import type { AiCtx } from './tiers'
import { randomPolicy } from './random'

function pick(ctx: AiCtx, id: string): Action | null {
  return ctx.legal?.find((a) => (a.type === 'setup.decideInitiative' || a.type === 'strategy.decideInitiative') && a.payload.seat === id) ?? null
}

/** The seat that decides initiative goes first: holding the initiative is worth more than the alternative. */
export function decideInitiative(ctx: AiCtx): Action | null {
  return pick(ctx, ctx.seat)
}

function coverNear(view: GameState, p: Vec2): number {
  const idx = terrainOf(view.map)
  let n = 0
  for (const s of idx.solids) {
    if (s.ceiling || s.exposed || s.insignificant) continue
    if (p.x < s.bbox.minX - 3 || p.x > s.bbox.maxX + 3 || p.z < s.bbox.minZ - 3 || p.z > s.bbox.maxZ + 3) continue
    if (distToPolygon(p, s.polygon) <= 2.5) n++
  }
  return Math.min(n, 4)
}

/** Side of the board that is ours on the mission map: +1 when larger coordinates are ours. */
function ownSide(view: GameState, seat: 'A' | 'B'): { axis: 'x' | 'z'; sign: 1 | -1 } {
  const axis = view.mission?.mapId?.endsWith('2') ? 'z' : 'x'
  return { axis, sign: seat === 'A' ? -1 : 1 }
}

export function objective(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const side = ownSide(view, ctx.seat)
  let best: { a: Action; s: number } | null = null
  for (const o of pending.options ?? []) {
    const p = o.action.payload as { x: number; z: number }
    // prefer ground with cover around it and on our half, where we get there first
    const own = (side.sign * (side.axis === 'x' ? p.x : p.z)) / 8
    const s = 0.5 * coverNear(view, p) + 0.6 * Math.max(-1, Math.min(1, own)) + ctx.rand() * 0.05
    if (!best || s > best.s) best = { a: o.action, s }
  }
  return best?.a ?? null
}

function zoneCentre(view: GameState, id: string): Vec2 | null {
  const z = view.map.dropZones.find((d) => d.id === id)
  if (!z) return null
  const b = polygonBBox(z.polygon)
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }
}

export function dropZone(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const objs = view.markers.filter((m) => m.kind === 'objective')
  let best: { a: Action; s: number } | null = null
  for (const o of pending.options ?? []) {
    const id = (o.action.payload as { zoneId: string }).zoneId
    const c = zoneCentre(view, id)
    if (!c) continue
    const d = objs.length ? objs.reduce((s, m) => s + Math.hypot(m.pos.x - c.x, m.pos.z - c.z), 0) / objs.length : 0
    const sc = -d + coverNear(view, c) * 0.3 + ctx.rand() * 0.01
    if (!best || sc > best.s) best = { a: o.action, s: sc }
  }
  return best?.a ?? null
}

// ---------------------------------------------------------------------------
// Equipment markers
// ---------------------------------------------------------------------------

function sampleIn(ctx: AiCtx, poly: Vec2[], n: number): Vec2[] {
  const box = polygonBBox(poly)
  const out: Vec2[] = []
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const p = { x: round3(box.minX + ctx.rand() * (box.maxX - box.minX)), z: round3(box.minZ + ctx.rand() * (box.maxZ - box.minZ)) }
    if (pointInPolygon(p, poly)) out.push(p)
  }
  return out
}

export function equipMarker(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const terr = pending.context.territory as Vec2[] | null
  const sug = pending.context.suggestion as { x: number; z: number; yaw: number } | undefined
  const eq = String(pending.context.equipmentId ?? '')
  const side = ownSide(view, ctx.seat)
  const objs = view.markers.filter((m) => m.kind === 'objective')
  const cands: Vec2[] = terr ? sampleIn(ctx, terr, 40) : []
  // spots beside our objectives (marker items) and a ring of points near the centreline
  for (const m of objs) for (let k = 0; k < 6; k++) cands.push({ x: round3(m.pos.x + Math.cos(k * 1.047) * 3.2), z: round3(m.pos.z + Math.sin(k * 1.047) * 3.2) })
  if (sug) cands.push({ x: sug.x, z: sug.z })
  const score = (p: Vec2): number => {
    const axisCoord = side.axis === 'x' ? p.x : p.z
    const toLine = Math.abs(axisCoord)
    const dObj = objs.length ? Math.min(...objs.map((m) => Math.hypot(m.pos.x - p.x, m.pos.z - p.z))) : 6
    const mines = eq.includes('mines')
    const comms = eq.includes('comms') || eq.includes('ammo')
    return -0.25 * toLine - (mines || comms ? 0.5 : 0.25) * Math.min(dObj, 8) + 0.15 * coverNear(view, p)
  }
  cands.sort((a, b) => score(b) - score(a))
  const yaw = sug?.yaw ?? 0
  for (const p of cands.slice(0, 24)) {
    const a = { type: 'setup.equipMarker', seat: pending.seat, decisionId: pending.id, payload: { x: p.x, z: p.z, yaw } } as Action
    if (!validate(view, a)) return a
  }
  return randomPolicy(ctx)
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** How strongly an operative is a gun (ranged output) versus a blade. */
function rangedRating(view: GameState, op: Operative): number {
  let best = 0
  for (const id of op.weapons) {
    const w = view.data.weapons[id]
    if (w?.type === 'ranged') best = Math.max(best, w.atk * (w.dmg.normal * 0.5 + w.dmg.crit * 0.17))
  }
  return best
}

function approachPoints(view: GameState, seat: 'A' | 'B'): Vec2[] {
  const out: Vec2[] = []
  for (const m of view.markers) if (m.kind === 'objective') out.push({ x: m.pos.x, z: m.pos.z })
  const enemy = view.map.dropZones.find((z) => z.id === view.players[otherSeat(seat)].dropZoneId)
  if (enemy) {
    const b = polygonBBox(enemy.polygon)
    out.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }, { x: b.minX + (b.maxX - b.minX) * 0.2, z: (b.minZ + b.maxZ) / 2 }, { x: b.minX + (b.maxX - b.minX) * 0.8, z: (b.minZ + b.maxZ) / 2 })
  }
  return out
}

function hiddenness(view: GameState, op: Operative, pos: Vec2, from: Vec2[]): number {
  let total = 0
  const target: Body & { order: 'conceal' } = { ...bodyOf(op), pos: { x: pos.x, y: 0, z: pos.z }, order: 'conceal' }
  for (const f of from) {
    const shooter: Body = { id: '~scout', pos: { x: f.x, y: 0, z: f.z }, baseRadius: 0.63, height: 1.7 }
    const v = targetVerdict(view, shooter, target)
    total += (v.visible ? 0 : 1.2) + (v.inCover ? 0.6 : 0) + (v.obscured ? 0.6 : 0)
  }
  return from.length ? total / from.length : 0
}

/**
 * Start some operatives out of the killzone when the engine offers it (Wyrmblade HIDING): the ambush pieces, i.e. the
 * ones with the weakest guns, never the Leader or the Icon Bearer, and about half of what the rule allows so the
 * team still has a front line. Hidden operatives emerge near the drop zone later (moves.ts).
 */
export function hideChoice(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const allowed = Array.isArray(pending.context.setAsideIds) ? (pending.context.setAsideIds as string[]) : []
  if (allowed.length === 0) return null
  if (isTempestus(view, ctx.seat)) return tempestusSetAside(ctx, allowed)
  const mine = Object.values(view.operatives).filter((o) => o.seat === ctx.seat)
  const hidden = mine.filter((o) => o.offboard !== undefined).length
  const cap = Math.floor(mine.length / 3)
  const want = Math.max(1, Math.ceil(cap / 2))
  if (hidden >= want) return null
  const keys = (id: string): string[] => view.data.datacards[view.operatives[id]?.datacardId ?? '']?.keywords ?? []
  const pool = allowed.filter((id) => !keys(id).includes('LEADER') && !keys(id).includes('ICON BEARER'))
  if (pool.length === 0) return null
  pool.sort((a, b) => rangedRating(view, view.operatives[a]!) - rangedRating(view, view.operatives[b]!) || (a < b ? -1 : 1))
  const a = act.setAside(pending, pool[0]!)
  return validate(view, a) ? null : a
}

// ---------------------------------------------------------------------------
// Tempestus Aquilons (Drop Insertion): the first batch stays on the table, every later batch goes above as a whole
// ---------------------------------------------------------------------------

const TA_TEAM = 'tempestus-aquilons'
/** Who stays on the table for the first batch, best first: the slow Servo-Sentry and the Heavy sniper need no landing, the rest drop. */
const TA_STAY = ['ta.marksman', 'ta.servo-sentry', 'ta.tempestor', 'ta.gunner', 'ta.gunfighter', 'ta.grenadier', 'ta.precursor', 'ta.trooper']

const isTempestus = (view: GameState, seat: 'A' | 'B'): boolean => view.players[seat].teamId === TA_TEAM
const taStayRank = (view: GameState, id: string): number => {
  const i = TA_STAY.indexOf(view.operatives[id]?.datacardId ?? '')
  return i < 0 ? TA_STAY.length : i
}

/** Set aside the operative that would rather drop in (the worst stay rank); the engine keeps the rest of the batch aside. */
function tempestusSetAside(ctx: AiCtx, allowed: string[]): Action | null {
  const { pending, view } = ctx
  const pool = [...allowed].sort((a, b) => taStayRank(view, b) - taStayRank(view, a) || (a < b ? -1 : 1))
  const a = act.setAside(pending, pool[0]!)
  return validate(view, a) ? null : a
}

export function deploy(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const aside = hideChoice(ctx)
  if (aside) return aside
  const c = pending.constraints
  // batch D prep (setAsideBatches): a batch being set aside as a whole offers only set-aside answers
  const asideOnly = Array.isArray(pending.context.setAsideIds) ? (pending.context.setAsideIds as string[]) : []
  if (pending.context.wholeBatchAside === true && asideOnly.length > 0) return isTempestus(view, ctx.seat) ? tempestusSetAside(ctx, asideOnly) : act.setAside(pending, asideOnly[0]!)
  if (!c?.region || !c.operativeIds?.length) return null
  // guns first into the best cover; blades later nearer the front
  const ids = [...c.operativeIds].sort((a, b) => (isTempestus(view, ctx.seat) ? taStayRank(view, a) - taStayRank(view, b) : 0) || rangedRating(view, view.operatives[b]!) - rangedRating(view, view.operatives[a]!))
  const op = view.operatives[ids[0]!]!
  const from = approachPoints(view, ctx.seat)
  const objs = view.markers.filter((m) => m.kind === 'objective')
  const region = c.region
  const cands = sampleIn(ctx, region, 40)
  // points of the region nearest each objective
  const box = polygonBBox(region)
  for (const m of objs) {
    const x = Math.max(box.minX + op.baseRadius, Math.min(box.maxX - op.baseRadius, m.pos.x))
    const z = Math.max(box.minZ + op.baseRadius, Math.min(box.maxZ - op.baseRadius, m.pos.z))
    cands.push({ x: round3(x), z: round3(z) })
  }
  const melee = rangedRating(view, op) < 4
  const scored = cands
    .filter((p) => circleInsidePolygon(p, op.baseRadius, region))
    .map((p) => {
      const dObj = objs.length ? Math.min(...objs.map((m) => Math.hypot(m.pos.x - p.x, m.pos.z - p.z))) : 0
      return { p, s: hiddenness(view, op, p, from) - (melee ? 0.04 : 0.1) * dObj + ctx.rand() * 0.05 }
    })
    .sort((a, b) => b.s - a.s)
  for (const { p } of scored) {
    const a = act.deploy(pending, op.id, p.x, p.z)
    if (!validate(view, a)) return a
  }
  const spot = suggestPlacement(view, pending, op.id, ctx.int(400))
  return spot ? act.deploy(pending, spot.operativeId, spot.x, spot.z, spot.y) : null
}
