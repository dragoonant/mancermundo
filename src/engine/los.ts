// Line of sight, vision arc and cover on the flat 2D board (R-4; 00 section 7.3). Walls, closed doors and smoke block line of
// sight; fighters and obstacles never do, but they give cover. `query.losLine` returns the sample lines and what stopped
// each, so the client draws exactly what the engine judged.
import { angleDelta } from './footprint'
import { runHook } from './hooks'
import { blockingPolygons } from './board'
import { segmentCircleInterval, segmentPolygonIntervals, distToPolygon, ringPoints } from './geometry'
import { onBoard } from './state'
import type { Fighter, GameState, Polygon, Vec2 } from './types'

export type Blocker = 'wall' | 'door' | 'smoke' | 'obstacle' | 'fighter'

export interface SightLine {
  to: Vec2
  blocked: Blocker | null
  /** the fighter or obstacle id that blocked the line, when it was one */
  by?: string
}

export type CoverLevel = 'none' | 'partial' | 'full'

/** Number of rim samples of a target base used for line of sight (plus the centre). */
export const LOS_RIM_SAMPLES = 16
/** Samples across the target diameter for the cover verdict. */
export const COVER_SAMPLES = 9

const centre = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })

function crossesInterior(a: Vec2, b: Vec2, poly: Polygon): boolean {
  return segmentPolygonIntervals(a, b, poly).length > 0
}

/**
 * Does the viewer see through smoke clouds (Photo-goggles, the `los.smoke` hook)? Cheap when no cloud is on the board.
 */
export function seesThroughSmoke(state: GameState, viewer: Fighter): boolean {
  if (state.board.smoke.length === 0) return false
  const data = { ignore: false }
  runHook('los.smoke', { seat: viewer.seat, state, fighterId: viewer.id, data })
  return data.ignore
}

/** What, if anything, a wall / closed door / smoke does to the segment a -> b. */
function terrainBlock(state: GameState, a: Vec2, b: Vec2, ignoreSmoke = false): Blocker | null {
  const def = state.board.def
  for (const w of def.walls) if (crossesInterior(a, b, w.poly)) return 'wall'
  for (const d of def.doors) {
    const rec = state.board.doors[d.id]
    if ((!rec || rec.state === 'closed') && crossesInterior(a, b, d.poly)) return 'door'
  }
  if (!ignoreSmoke) for (const sm of state.board.smoke) if (segmentCircleInterval(a, b, sm.pos, sm.radius)) return 'smoke'
  return null
}

/** 17 sample points of a base: its centre and 16 on the rim. */
export function targetSamples(target: Fighter): Vec2[] {
  return [centre(target), ...ringPoints(centre(target), target.baseRadius, LOS_RIM_SAMPLES)]
}

/** The line-of-sight sample lines from a point to a target base. */
export function losLines(state: GameState, from: Vec2, target: Fighter, ignoreSmoke = false): SightLine[] {
  return targetSamples(target).map((to) => ({ to, blocked: terrainBlock(state, from, to, ignoreSmoke) }))
}

/** True when at least one sample line is clear of walls, closed doors and smoke. */
export function hasLosFrom(state: GameState, from: Vec2, target: Fighter, ignoreSmoke = false): boolean {
  for (const to of targetSamples(target)) if (!terrainBlock(state, from, to, ignoreSmoke)) return true
  return false
}

export function hasLos(state: GameState, viewer: Fighter, target: Fighter): boolean {
  return hasLosFrom(state, centre(viewer), target, seesThroughSmoke(state, viewer))
}

// ---------------------------------------------------------------------------
// Vision arc (R-4.1)
// ---------------------------------------------------------------------------

/** Half-width of the vision wedge. */
export const ARC_HALF = Math.PI / 4

/**
 * A target is inside the 90 degree arc if any part of its base lies inside the wedge (ruling). Prone fighters have no arc.
 * `all` gives the viewer a 360 degree arc (Blind Fire).
 */
export function inVisionArc(viewer: Fighter, target: Fighter, all = false): boolean {
  if (all) return true
  if (viewer.posture !== 'standing') return false
  const dx = target.pos.x - viewer.pos.x
  const dz = target.pos.z - viewer.pos.z
  const d = Math.hypot(dx, dz)
  if (d <= target.baseRadius) return true // the apex is inside the target's base
  const bearing = Math.atan2(dx, dz)
  const off = Math.abs(angleDelta(viewer.facing, bearing))
  return off <= ARC_HALF + Math.asin(Math.min(1, target.baseRadius / d)) + 1e-9
}

// ---------------------------------------------------------------------------
// Cover (R-4.3, R-4.4)
// ---------------------------------------------------------------------------

export interface CoverResult {
  cover: CoverLevel
  clear: number
  total: number
  lines: SightLine[]
}

/** Obstacles within 1" of the attacker's base are ignored for cover (R-4.3). */
const OBSTACLE_IGNORE = 1

/**
 * Cover verdict from a point (the attacker's centre, a blast centre or a template origin) to a target: 9 sample points along
 * the target's diameter perpendicular to the line of fire. A line is blocked by a wall, a closed door, smoke, an obstacle
 * not within 1" of the attacker, or another Standing fighter's base (the target, and friends of the attacker in base
 * contact with it, are ignored; Prone bases never block). `ignoreIds` are fighters that never block either (S3a: a fighter
 * whose base holds a Blast centre does not shield the others from it).
 */
export function coverFrom(state: GameState, from: Vec2, target: Fighter, attacker?: Fighter, ignoreIds: readonly string[] = []): CoverResult {
  const t = centre(target)
  const dx = t.x - from.x
  const dz = t.z - from.z
  const d = Math.hypot(dx, dz) || 1
  // perpendicular unit vector
  const px = -dz / d
  const pz = dx / d
  const r = target.baseRadius
  const others = onBoard(state).filter((f) => f.id !== target.id && f.id !== attacker?.id && f.posture === 'standing' && !ignoreIds.includes(f.id))
  const ignoredFriends = new Set<string>()
  if (attacker) {
    for (const f of others) {
      if (f.seat !== attacker.seat) continue
      const gap = Math.hypot(f.pos.x - attacker.pos.x, f.pos.z - attacker.pos.z) - f.baseRadius - attacker.baseRadius
      if (gap <= 0.02) ignoredFriends.add(f.id)
    }
  }
  const obstacles = state.board.def.obstacles.filter((o) => {
    if (!attacker) return true
    return distToPolygon(centre(attacker), o.poly) - attacker.baseRadius > OBSTACLE_IGNORE
  })
  const lines: SightLine[] = []
  let clear = 0
  const ignoreSmoke = !!attacker && seesThroughSmoke(state, attacker)
  for (let k = 0; k < COVER_SAMPLES; k++) {
    const off = ((k / (COVER_SAMPLES - 1)) * 2 - 1) * r
    const to = { x: t.x + px * off, z: t.z + pz * off }
    let blocked: SightLine = { to, blocked: terrainBlock(state, from, to, ignoreSmoke) }
    if (!blocked.blocked) {
      const ob = obstacles.find((o) => crossesInterior(from, to, o.poly))
      if (ob) blocked = { to, blocked: 'obstacle', by: ob.id }
      else {
        const f = others.find((o) => !ignoredFriends.has(o.id) && segmentCircleInterval(from, to, centre(o), o.baseRadius) !== null && chordLength(from, to, centre(o), o.baseRadius) > 1e-6)
        if (f) blocked = { to, blocked: 'fighter', by: f.id }
      }
    }
    if (!blocked.blocked) clear++
    lines.push(blocked)
  }
  const cover: CoverLevel = clear === COVER_SAMPLES ? 'none' : clear * 2 >= COVER_SAMPLES ? 'partial' : 'full'
  return { cover, clear, total: COVER_SAMPLES, lines }
}

function chordLength(a: Vec2, b: Vec2, c: Vec2, r: number): number {
  const iv = segmentCircleInterval(a, b, c, r)
  return iv ? (iv[1] - iv[0]) * Math.hypot(b.x - a.x, b.z - a.z) : 0
}

export function coverOf(state: GameState, attacker: Fighter, target: Fighter): CoverResult {
  return coverFrom(state, centre(attacker), target, attacker)
}

/** A Prone fighter in partial or full cover cannot be targeted by ranged attacks (R-4.4). */
export function hiddenFromRanged(target: Fighter, cover: CoverLevel): boolean {
  return target.posture !== 'standing' && cover !== 'none'
}

/** Walls and closed doors only (used by callers that need the blocking set itself). */
export function blockers(state: GameState): Polygon[] {
  return blockingPolygons(state.board.def, state.board.doors)
}
