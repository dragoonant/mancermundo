// query.*: every number or verdict the UI and the AI read (00 section 7.6). S2 holds status, stat, engagement, distances,
// line of sight, vision arc and cover; `actionMenu` is added from activation.ts by index.ts (`query.actionMenu`). S3a/S3b/S4
// extend this file with the shooting, fight, nerve, bottle and scenario numbers.
import { runHook } from './hooks'
import { coverOf, hasLos, inVisionArc, losLines, type CoverResult, type SightLine } from './los'
import { baseGap, pathGap } from './measure'
import { constants, getFighter, isBroken } from './state'
import type { Fighter, GameState, StatKey } from './types'

export type DerivedStatus = 'standingActive' | 'standingEngaged' | 'pinned' | 'seriouslyInjured' | 'outOfAction'

/** Target-number characteristics: a lower stored number is better, a "+1" improves it (R-2.6). */
const TARGET_NUMBER: ReadonlySet<StatKey> = new Set(['WS', 'BS', 'I', 'Ld', 'Cl', 'Wil', 'Int'])

export function isTargetNumber(key: StatKey): boolean {
  return TARGET_NUMBER.has(key)
}

/** Status as the rules name it, a pure function of the state (Broken is a condition, see `isBroken`). */
export function status(state: GameState, id: string): DerivedStatus {
  const f = getFighter(state, id)
  if (f.location !== 'board') return 'outOfAction'
  if (f.posture === 'seriouslyInjured') return 'seriouslyInjured'
  if (f.posture === 'pinned') return 'pinned'
  return f.engagedWith.length > 0 ? 'standingEngaged' : 'standingActive'
}

/**
 * Effective characteristic: the printed value, Flesh Wounds on T (it may reach 0 or below, which is Out of Action, R-2.7),
 * Concussion on I (never worse than 6+), then `stat.modify` hooks (delta is added to a plain number and improves a target
 * number, so a hook's `+1` is always good for the fighter).
 */
export function stat(state: GameState, id: string, key: StatKey): number {
  const f = getFighter(state, id)
  let v = f.stats[key]
  if (key === 'T') v -= f.fleshWounds
  if (key === 'I' && f.conditions.concussion) {
    const c = constants(state).concussion
    const worst = Number.parseInt(c.worstInitiative, 10)
    v = Math.max(v, Math.min(worst, v - c.initiativeModifier))
  }
  const results = runHook('stat.modify', { seat: f.seat, state, fighterId: id, data: { key, value: v } })
  for (const r of results) if (r.delta) v += isTargetNumber(key) ? -r.delta : r.delta
  return v
}

/** Ids of the enemies the fighter is Engaged with. */
export function engagedWith(state: GameState, id: string): string[] {
  return getFighter(state, id).engagedWith.slice()
}

/** Straight base-edge distance (ranges). */
export function distance(state: GameState, aId: string, bId: string): number {
  return baseGap(getFighter(state, aId), getFighter(state, bId))
}

/** Path proximity base-edge distance (never through walls or closed doors, R-1.9 ruling). */
export function pathDistance(state: GameState, aId: string, bId: string): number {
  return pathGap(state, getFighter(state, aId), getFighter(state, bId))
}

/** Is the target inside the viewer's 90 degree arc (any part of its base)? Prone viewers have none. */
export function inArc(state: GameState, viewerId: string, targetId: string): boolean {
  return inVisionArc(getFighter(state, viewerId), getFighter(state, targetId))
}

export function cover(state: GameState, attackerId: string, targetId: string): CoverResult {
  return coverOf(state, getFighter(state, attackerId), getFighter(state, targetId))
}

export interface LosLine {
  from: string
  to: string
  /** at least one sample line is clear of walls, closed doors and smoke */
  los: boolean
  inArc: boolean
  distance: number
  /** the 17 line-of-sight sample lines with what stopped each */
  lines: SightLine[]
  cover: CoverResult
}

/** Everything the client draws for a sight line between two fighters. */
export function losLine(state: GameState, fromId: string, toId: string): LosLine {
  const a = getFighter(state, fromId)
  const b = getFighter(state, toId)
  return {
    from: fromId,
    to: toId,
    los: hasLos(state, a, b),
    inArc: inVisionArc(a, b),
    distance: baseGap(a, b),
    lines: losLines(state, { x: a.pos.x, z: a.pos.z }, b),
    cover: coverOf(state, a, b),
  }
}

export function broken(state: GameState, id: string): boolean {
  return isBroken(getFighter(state, id))
}

export type { Fighter }
