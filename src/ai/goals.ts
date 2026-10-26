// Where a fighter wants to be (docs/spec/40-ai.md section 2): its goals and the cost of a spot against them.
//   - the nearest enemies, at the fighter's ideal range (a gunner wants a firing lane inside Short range, a brawler wants contact);
//   - a closed door when the only way to the enemy goes through it (the door is the goal until it is open);
//   - the scenario's objectives when `query.scenarioView` or the board shows any (caskets to open or carry).
// Distances are the walking distances of `field.ts`, so a wall between a fighter and its target counts for what it is.
import { query } from '@/engine'
import { baseGap } from '@/engine/measure'
import { usableRangedProfiles } from '@/engine/shoot'
import { profileRanges, hasTrait, T } from '@/engine/traits'
import { enemiesOf, friendsOf, isBroken } from '@/engine/state'
import { circleOverlapsPolygon, polygonBBox } from '@/engine/geometry'
import { baseInRegion, tileStrips } from '@/engine/board'
import type { Fighter, GameState, Vec2 } from '@/engine'
import { fieldFrom, firstDoorOnRoute, sampleField } from './field'
import type { AiCtx } from './tiers'

export interface Goal {
  kind: 'enemy' | 'door' | 'casket'
  pos: Vec2
  /** the base-edge distance at which the goal is met */
  ideal: number
  /** how much the goal counts against the others (the smallest weighted cost wins) */
  weight: number
  /** the radius of the goal's own base (enemies), subtracted from centre distances */
  radius: number
  doorId?: string
  casketId?: string
  enemyId?: string
}

const centre = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })

/** A fighter leans to the gun or to the blade (decides how close it wants to stand). */
export function leansMelee(state: GameState, f: Fighter): boolean {
  let melee = 0
  for (const w of f.weapons) {
    const def = state.data.weapons[w.weaponId]
    if (!def || w.ammo === 'spent') continue
    if (def.class === 'close') {
      const p = def.profiles[0]
      const s = p ? (p.str.base === 'user' ? f.stats.S + p.str.value : p.str.value) : f.stats.S
      melee = Math.max(melee, s + (p?.ap ? -p.ap * 0.6 : 0) + (p && p.dmg.kind === 'fixed' ? p.dmg.value * 0.8 : 0))
    }
  }
  const guns = usableRangedProfiles(state, f).filter((u) => !hasTrait(u.profile, T.sidearm) || state.data.weapons[u.weaponId]?.class !== 'pistol' || true)
  let ranged = 0
  for (const u of guns) {
    const p = u.profile
    const s = p.str.base === 'user' ? f.stats.S + p.str.value : p.str.value
    const cls = state.data.weapons[u.weaponId]?.class
    const bonus = cls === 'heavy' || cls === 'special' ? 1.5 : cls === 'basic' ? 1 : 0
    ranged = Math.max(ranged, s + (p.ap ? -p.ap * 0.6 : 0) + (p.dmg.kind === 'fixed' ? p.dmg.value * 0.8 : 1.2) + bonus)
  }
  if (melee === 0) return false
  if (ranged === 0) return true
  const wsEdge = (7 - f.stats.WS) - (7 - f.stats.BS) // positive: better in melee
  return melee + f.stats.A * 0.5 + wsEdge * 0.4 > ranged + 1.8
}

/** The base-edge distance a fighter likes to shoot from: inside the Short range of its best gun, never farther than 10". */
export function idealRange(state: GameState, f: Fighter): number {
  if (leansMelee(state, f)) return 0.5
  let best = 0
  for (const u of usableRangedProfiles(state, f)) {
    const r = profileRanges(u.profile, f.stats.S)
    const reach = r.short ?? (r.long !== null ? r.long * 0.6 : 8)
    best = Math.max(best, reach)
  }
  return best > 0 ? Math.max(3, Math.min(10, best * 0.8)) : 0.5
}

/** Doors a closed-door route runs through are goals themselves. */
function doorGoal(ctx: AiCtx, state: GameState, f: Fighter, toward: Vec2): Goal | null {
  const closedField = fieldFrom(state, toward, f.baseRadius, false)
  if (Number.isFinite(sampleField(closedField, centre(f)))) return null
  const doorPolys = state.board.def.doors.filter((d) => state.board.doors[d.id]?.state === 'closed').map((d) => ({ id: d.id, poly: d.poly }))
  // doors that can be operated first; locked ones (a terminal, or a Force Door roll) only when nothing else leads there
  let hit: { doorId: string; before: Vec2 } | null = null
  for (const mode of [true, 'all'] as const) {
    const openField = fieldFrom(state, toward, f.baseRadius, mode)
    if (!Number.isFinite(sampleField(openField, centre(f)))) continue
    hit = firstDoorOnRoute(state, openField, centre(f), doorPolys)
    if (hit) break
  }
  if (!hit) return null
  const door = state.board.def.doors.find((d) => d.id === hit.doorId)!
  // stand on our side of the door, in reach of "within 1 inch" (operate / force / terminal)
  const mid = { x: (door.seg.a.x + door.seg.b.x) / 2, z: (door.seg.a.z + door.seg.b.z) / 2 }
  const dx = hit.before.x - mid.x
  const dz = hit.before.z - mid.z
  const d = Math.hypot(dx, dz) || 1
  void ctx
  return { kind: 'door', pos: { x: mid.x + (dx / d) * 0.9, z: mid.z + (dz / d) * 0.9 }, ideal: 0.2, weight: 1, radius: 0, doorId: door.id }
}

/** The scenario panel numbers (caskets and who secured them), cached per decision. */
function scenario(ctx: AiCtx, state: GameState): ReturnType<typeof query.scenarioView> {
  const hit = ctx.cache.get('scenarioView') as ReturnType<typeof query.scenarioView> | undefined
  if (hit) return hit
  const v = query.scenarioView(state)
  ctx.cache.set('scenarioView', v)
  return v
}

const CASKET_R = 0.5

function strips(state: GameState, seat: Fighter['seat']): Vec2[][] {
  const tileId = state.scenario.deployTiles[seat]
  const def = state.board.def
  const i = tileId ? def.tiles.findIndex((t) => t.id === tileId) : -1
  return i >= 0 ? tileStrips(def, i, state.data.scenario.deployment.withinOfEdge ?? 3) : []
}

/** Loot is secured when a casket disc lies wholly inside the strips of the gang's own deployment tile (M-4.7). */
export function isSecured(state: GameState, seat: Fighter['seat'], pos: Vec2): boolean {
  const s = strips(state, seat)
  return s.length > 0 && baseInRegion(s, pos, CASKET_R)
}

/**
 * Where a gang carries loot to (Forgotten Riches, M-4.7): the point of its own deployment strips nearest to `from` where a
 * casket still fits comfortably; before a tile is chosen, the place the gang started.
 */
export function homePoint(ctx: AiCtx, state: GameState, seat: Fighter['seat'], from?: Vec2): Vec2 | null {
  const s = strips(state, seat)
  if (s.length === 0) return ctx.memory.home?.[seat] ?? null
  const key = `home:${seat}`
  let pts = ctx.cache.get(key) as Vec2[] | undefined
  if (!pts) {
    pts = []
    for (const r of s) {
      const bb = polygonBBox(r)
      for (let z = bb.minZ + 1; z <= bb.maxZ - 1 + 1e-9; z += 1) for (let x = bb.minX + 1; x <= bb.maxX - 1 + 1e-9; x += 1) if (baseInRegion(s, { x, z }, CASKET_R + 0.5)) pts.push({ x, z })
    }
    ctx.cache.set(key, pts)
  }
  if (pts.length === 0) return ctx.memory.home?.[seat] ?? null
  const o = from ?? { x: 0, z: 0 }
  return pts.slice().sort((a, b) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(b.x - o.x, b.z - o.z))[0]!
}

/** Scenario objectives for this fighter: caskets to open (Smash & Grab attackers) or to haul home (Forgotten Riches). */
function objectiveGoals(ctx: AiCtx, state: GameState, f: Fighter): Goal[] {
  if (!ctx.params.objectives) return []
  const out: Goal[] = []
  const sid = state.scenario.id
  const me = state.players[f.seat]
  if (sid !== 'scn.smash-and-grab' && sid !== 'scn.forgotten-riches') return out
  const caskets = scenario(ctx, state).caskets
  if (sid === 'scn.smash-and-grab' && me.role === 'attacker') {
    for (const c of caskets) if (c.state === 'closed') out.push({ kind: 'casket', pos: { x: c.pos.x, z: c.pos.z }, ideal: 0.6, weight: 0.9, radius: 0, casketId: c.id })
  } else if (sid === 'scn.forgotten-riches') {
    // closed or opened loot not yet on our own tile (an ammo cache is not loot); carried caskets go with their carrier
    const claim = lootAssignment(ctx, state, f.seat).get(f.id)
    const c = claim ? caskets.find((x) => x.id === claim) : undefined
    if (c) out.push({ kind: 'casket', pos: { x: c.pos.x, z: c.pos.z }, ideal: 0.6, weight: 0.9, radius: 0, casketId: c.id })
  }
  return out
}

/**
 * Who hauls what in Forgotten Riches: the (up to three) caskets nearest to the gang's own tile that are not secured or
 * carried, each given to the nearest free friend, so the gang secures loot one casket at a time instead of crowding one.
 */
function lootAssignment(ctx: AiCtx, state: GameState, seat: Fighter['seat']): Map<string, string> {
  const key = `loot:${seat}`
  const hit = ctx.cache.get(key) as Map<string, string> | undefined
  if (hit) return hit
  const out = new Map<string, string>()
  const home = homePoint(ctx, state, seat) ?? { x: 0, z: 0 }
  const loot = scenario(ctx, state)
    .caskets.filter((c) => (c.state === 'closed' || c.state === 'opened') && !isSecured(state, seat, c.pos) && !state.board.caskets[c.id]?.carriedBy)
    .sort((a, b) => Math.hypot(a.pos.x - home.x, a.pos.z - home.z) - Math.hypot(b.pos.x - home.x, b.pos.z - home.z) || (a.id < b.id ? -1 : 1))
    .slice(0, 3)
  const free = Object.values(state.fighters).filter((g) => g.seat === seat && g.location === 'board' && g.posture !== 'seriouslyInjured' && !isBroken(g))
  for (const c of loot) {
    let best: Fighter | null = null
    let bestD = Infinity
    for (const g of free) {
      if (out.has(g.id)) continue
      const d = Math.hypot(g.pos.x - c.pos.x, g.pos.z - c.pos.z)
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && best && g.id < best.id)) {
        best = g
        bestD = d
      }
    }
    if (best) out.set(best.id, c.id)
  }
  ctx.cache.set(key, out)
  return out
}

/** Is this casket loot that still has to be hauled home by `seat` (Forgotten Riches)? */
export function needsHauling(ctx: AiCtx, state: GameState, seat: Fighter['seat'], casketId: string): boolean {
  if (state.scenario.id !== 'scn.forgotten-riches') return false
  const c = scenario(ctx, state).caskets.find((x) => x.id === casketId)
  return !!c && (c.state === 'closed' || c.state === 'opened') && !isSecured(state, seat, c.pos)
}

/** The goals of a fighter, nearest first. Cached per decision. */
export function goalsFor(ctx: AiCtx, state: GameState, f: Fighter): Goal[] {
  const key = `goals:${f.id}`
  const hit = ctx.cache.get(key) as Goal[] | undefined
  if (hit) return hit
  const ideal = idealRange(state, f)
  const goals: Goal[] = []
  // the two enemies nearest by walking distance
  const myField = fieldFrom(state, centre(f), f.baseRadius, false)
  const ranked = enemiesOf(state, f)
    .filter((e) => e.posture !== 'seriouslyInjured' || enemiesOf(state, f).every((o) => o.posture === 'seriouslyInjured'))
    .map((e) => ({ e, d: sampleField(myField, centre(e)) }))
    .sort((a, b) => a.d - b.d || (a.e.id < b.e.id ? -1 : 1))
  let reachableSeen = 0
  for (const { e, d } of ranked) {
    if (Number.isFinite(d)) {
      goals.push({ kind: 'enemy', pos: centre(e), ideal, weight: 1, radius: e.baseRadius, enemyId: e.id })
      if (++reachableSeen >= 2) break
    }
  }
  if (reachableSeen === 0 && ranked.length > 0) {
    // every enemy is behind a closed door: the door on the way to the nearest one is the goal
    const nearest = ranked.map((r) => ({ e: r.e, d: baseGap(f, r.e) })).sort((a, b) => a.d - b.d)[0]!.e
    const dg = doorGoal(ctx, state, f, centre(nearest))
    if (dg) goals.push(dg)
    else goals.push({ kind: 'enemy', pos: centre(nearest), ideal, weight: 1, radius: nearest.baseRadius, enemyId: nearest.id })
  }
  for (const g of objectiveGoals(ctx, state, f)) goals.push(g)
  ctx.cache.set(key, goals)
  return goals
}

/** Distance of a spot from a goal, in the same sense as `ideal` (base-edge). Infinity if unreachable. */
export function goalGap(state: GameState, f: Fighter, goal: Goal, at: Vec2): number {
  const field = fieldFrom(state, goal.pos, f.baseRadius, false)
  const d = sampleField(field, at)
  return d - f.baseRadius - goal.radius
}

/** The approach cost of a spot: the shortfall to the nearest goal, in inches of walking. 0 when a goal is met. */
export function approachCost(state: GameState, f: Fighter, goals: Goal[], at: Vec2): number {
  let best = Infinity
  for (const g of goals) {
    const gap = goalGap(state, f, g, at)
    if (!Number.isFinite(gap)) continue
    const c = Math.max(0, gap - g.ideal) / g.weight
    if (c < best) best = c
  }
  return Number.isFinite(best) ? best : 60
}

/** Friends that would give nerve support at a spot (within the support radius, not Broken, not Seriously Injured). */
export function supportAt(state: GameState, f: Fighter, at: Vec2): number {
  let n = 0
  for (const g of friendsOf(state, f)) {
    if (isBroken(g) || g.posture === 'seriouslyInjured') continue
    if (Math.hypot(g.pos.x - at.x, g.pos.z - at.z) - g.baseRadius - f.baseRadius <= 3) n++
  }
  return Math.min(2, n)
}

export { circleOverlapsPolygon, profileRanges }
