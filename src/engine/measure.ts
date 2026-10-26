// Measuring (00 section 7.2): base-edge straight distance for ranges, path proximity for "within X" (R-1.9), base contact
// and engagement. Engagement is derived from geometry after every step and cached on the fighter (`engagedWith`).
import { navFor, MEASURE_R, routeLength } from './nav'
import { footprintGap2D } from './footprint'
import { circleOverlapsPolygon, segmentPolygonIntervals } from './geometry'
import type { Ctx } from './registry'
import { onBoard } from './state'
import type { Fighter, GameState, Vec2 } from './types'

/** Base contact: gap between the two base edges at most this many inches (00 section 7.2). */
export const CONTACT_EPS = 0.02

export interface Disc {
  pos: { x: number; z: number }
  baseRadius: number
}

/** Straight base-edge distance (range measuring). A Prone fighter is measured as if standing where it lies (R-1.9). */
export function baseGap(a: Disc, b: Disc): number {
  return footprintGap2D({ pos: { x: a.pos.x, z: a.pos.z }, baseRadius: a.baseRadius }, { pos: { x: b.pos.x, z: b.pos.z }, baseRadius: b.baseRadius })
}

export function inContact(a: Disc, b: Disc): boolean {
  return baseGap(a, b) <= CONTACT_EPS
}

/** Shortest wall-respecting centre path between two points as the base-edge distance (centre path minus both radii). */
export function pathGapPoints(state: GameState, a: Vec2, ra: number, b: Vec2, rb: number): number {
  const straight = Math.hypot(a.x - b.x, a.z - b.z) - ra - rb
  const nav = navFor(state.board.def, state.board.doors, MEASURE_R)
  const len = routeLength(nav, a, b)
  if (!Number.isFinite(len)) return Infinity
  return Math.max(0, Math.max(len - ra - rb, straight))
}

/** Path proximity between two fighters (R-1.9 ruling): never measured through a wall or a closed door. */
export function pathGap(state: GameState, a: Disc, b: Disc): number {
  const straight = baseGap(a, b)
  if (straight === 0) return 0
  return pathGapPoints(state, { x: a.pos.x, z: a.pos.z }, a.baseRadius, { x: b.pos.x, z: b.pos.z }, b.baseRadius)
}

/** "within X" by path (nerve, group, assist, rally, leading by example, Horrors). The straight gap is a cheap lower bound. */
export function withinPath(state: GameState, a: Disc, b: Disc, x: number): boolean {
  if (baseGap(a, b) > x + 1e-9) return false
  return pathGap(state, a, b) <= x + 1e-9
}

// ---------------------------------------------------------------------------
// Engagement (R-3.3, R-15.10)
// ---------------------------------------------------------------------------

function standing(f: Fighter): boolean {
  return f.location === 'board' && f.posture === 'standing'
}

/** Is the straight line between two bases blocked by a barricade both are touching (R-15.10)? */
function acrossBarricade(state: GameState, a: Fighter, b: Fighter): boolean {
  const pa = { x: a.pos.x, z: a.pos.z }
  const pb = { x: b.pos.x, z: b.pos.z }
  if (baseGap(a, b) > 1 + 1e-9) return false
  for (const o of state.board.def.obstacles) {
    if (o.kind !== 'barricade') continue
    const touches = (f: Fighter, p: Vec2) => circleOverlapsPolygon(p, f.baseRadius + CONTACT_EPS, o.poly)
    if (!touches(a, pa) || !touches(b, pb)) continue
    // opposite sides: the line between the centres passes through the barricade
    if (segmentPolygonIntervals(pa, pb, o.poly).length > 0) return true
  }
  return false
}

/** Ids of the enemies a fighter is Engaged with (derived; sorted). Seriously Injured and Pinned fighters are never Engaged. */
export function computeEngagedWith(state: GameState, f: Fighter, pool: Fighter[] = onBoard(state)): string[] {
  if (!standing(f)) return []
  const out: string[] = []
  for (const e of pool) {
    if (e.seat === f.seat || e.id === f.id || !standing(e)) continue
    if (inContact(f, e) || acrossBarricade(state, f, e)) out.push(e.id)
  }
  return out.sort()
}

/**
 * Recompute every fighter's `engagedWith` and emit `EngagementChanged` for each list that changed (apply.afterAction runs
 * this after every accepted action; rules that need a fresh status mid-step call it too).
 */
export function refreshEngagement(ctx: Ctx): void {
  const s = ctx.state
  const pool = onBoard(s)
  for (const f of Object.values(s.fighters)) {
    const next = f.location === 'board' ? computeEngagedWith(s, f, pool) : []
    if (next.length === f.engagedWith.length && next.every((id, i) => id === f.engagedWith[i])) continue
    f.engagedWith = next
    ctx.emit({ type: 'EngagementChanged', fighterId: f.id, engagedWith: next.slice() }, f.seat)
  }
}
