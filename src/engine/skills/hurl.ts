// Hurl (brawn) and Unleash the Beast (gol): the skills that throw other fighters about. Both are involuntary moves of the
// target (the 1" rule is off until the effects are resolved, then the pushed-apart step of R-7.4 runs).
//
// Hurl: the target is an enemy in base contact with the fighter or a Seriously Injured enemy within 1". It passes an Initiative
// test or is hurled D3" in a direction the Hurler picks (a `skill.choice` of up to eight directions, each listing what it would
// touch). It stops against any fighter or terrain; it and every fighter it stopped against take a Strength 3 hit and are Pinned.
import { d6TestChance } from '../dice'
import { markFired } from '../code-hooks'
import { resolveHit, type HitInput } from '../hits'
import { baseGap, CONTACT_EPS, refreshEngagement, withinPath } from '../measure'
import { placeAlong, pushApart, slide } from '../movement'
import { stat } from '../query'
import type { Ctx } from '../registry'
import { constants, enemiesOf, getFighter, onBoard } from '../state'
import type { Fighter, GameState, Vec2 } from '../types'
import { initiativeRoll, numParam, skillOf } from './common'
import { isImmovable } from './stance'

export interface HurlTarget {
  targetId: string
  /** the chance the target FAILS its Initiative test (and is hurled) */
  chance: number
  need: number
}

/** Enemies a Hurler may target: in base contact (Engaged) or Seriously Injured within 1"; not one in an Immovable Stance. */
export function hurlTargets(state: GameState, f: Fighter): HurlTarget[] {
  if (f.location !== 'board' || f.posture !== 'standing' || !skillOf(state, f, 'hurl')) return []
  const out: HurlTarget[] = []
  const reach = constants(state).radii.interact
  for (const e of enemiesOf(state, f)) {
    if (e.location !== 'board' || isImmovable(state, e)) continue
    const adjacent = f.engagedWith.includes(e.id) && baseGap(f, e) <= CONTACT_EPS
    const downed = e.posture === 'seriouslyInjured' && baseGap(f, e) <= reach && withinPath(state, f, e, reach)
    if (!adjacent && !downed) continue
    const need = stat(state, e.id, 'I')
    out.push({ targetId: e.id, chance: 1 - d6TestChance(need), need })
  }
  return out.sort((x, y) => (x.targetId < y.targetId ? -1 : 1))
}

const angleOf = (k: number): number => (k * Math.PI) / 4
const unit = (k: number): Vec2 => ({ x: Math.sin(angleOf(k)), z: Math.cos(angleOf(k)) })

/** A Pinned fighter that cannot be shaken off: hurled and shoved fighters go prone at once (not subject to Nerves of Steel). */
function forcePin(ctx: Ctx, t: Fighter): void {
  if (t.location !== 'board' || t.posture !== 'standing' || isImmovable(ctx.state, t)) return
  t.posture = 'pinned'
  ctx.emit({ type: 'StatusChanged', fighterId: t.id, from: 'standing', to: 'pinned', reason: 'hurled' }, t.seat)
  ctx.emit({ type: 'FighterPinned', fighterId: t.id }, t.seat)
}

function fighterHit(attackerId: string | null, targetId: string, strength: number, cause: string): HitInput {
  return {
    attackerId,
    targetId,
    weaponId: null,
    strength,
    ap: 0,
    damage: { kind: 'fixed', value: 1 },
    traits: [],
    hitRoll: null,
    knockFrom: null,
    melta: false,
    saveVs: null,
    coverBonus: 0,
    from: null,
    saves: true,
    cause,
  }
}

/** Fighters (other than `t` and `thrower`) whose base `t` touches at `at`: what a hurled fighter stopped against. */
function touchedAt(state: GameState, t: Fighter, thrower: Fighter, at: Vec2): Fighter[] {
  return onBoard(state)
    .filter((e) => e.id !== t.id && e.id !== thrower.id && Math.hypot(e.pos.x - at.x, e.pos.z - at.z) - e.baseRadius - t.baseRadius < 0.1)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

export interface HurlDirection {
  k: number
  to: Vec2
  moved: number
  stoppedShort: boolean
  contacts: string[]
}

/** What a hurl of `distance` inches would do in each of the eight directions (the ones that move the fighter at all). */
export function hurlDirections(state: GameState, thrower: Fighter, t: Fighter, distance: number): HurlDirection[] {
  const out: HurlDirection[] = []
  for (let k = 0; k < 8; k++) {
    const u = unit(k)
    const to = slide(state, t, u.x, u.z, distance)
    const moved = Math.hypot(to.x - t.pos.x, to.z - t.pos.z)
    if (moved < 0.01) continue
    const stoppedShort = moved < distance - 0.01
    out.push({ k, to, moved, stoppedShort, contacts: stoppedShort ? touchedAt(state, t, thrower, to).map((e) => e.id) : [] })
  }
  return out
}

/**
 * Start a Hurl on `targetId`: the Initiative test, the D3, and either the direction decision (`'asked'`) or the finished throw
 * (`'done'`; the caller pays for the action). `inSeq` says the throw replaces a charge's free Fight inside a close-combat sequence.
 */
export function resolveHurl(ctx: Ctx, thrower: Fighter, targetId: string, inSeq: boolean): 'done' | 'asked' {
  const s = ctx.state
  const t = getFighter(s, targetId)
  markFired('hurl')
  ctx.emit({ type: 'SkillUsed', fighterId: thrower.id, skill: 'hurl', targetId: t.id }, thrower.seat)
  if (initiativeRoll(ctx, t, 'hurl').passed) return 'done'
  const distance = ctx.roll('hurlDistance', 1, 'd3')[0]!
  const dirs = hurlDirections(s, thrower, t, distance)
  if (dirs.length === 0) {
    applyHurl(ctx, thrower, t, null, distance)
    return 'done'
  }
  if (dirs.length === 1) {
    applyHurl(ctx, thrower, t, dirs[0]!.k, distance)
    return 'done'
  }
  ctx.raise({
    kind: 'skill.choice',
    seat: thrower.seat,
    window: 'action.declared',
    context: { skill: 'hurlDirection', fighterId: thrower.id, targetId: t.id, distance, inSeq },
    options: dirs.map((d) => ({
      id: `dir:${d.k}`,
      labelKey: 'skill.hurl.direction',
      type: 'skill.choice' as const,
      payload: { option: `dir:${d.k}` },
      data: { angle: angleOf(d.k), moved: Math.round(d.moved * 100) / 100, contacts: d.contacts, stoppedShort: d.stoppedShort, to: { ...d.to } },
    })),
  })
  return 'asked'
}

/** The hurled fighter moves along direction `k` (null: it cannot move), then it and whoever it stopped against are hit and Pinned. */
export function applyHurl(ctx: Ctx, thrower: Fighter, t: Fighter, k: number | null, distance: number): void {
  const s = ctx.state
  let contacted: Fighter[] = []
  if (k !== null) {
    const u = unit(k)
    const to = slide(s, t, u.x, u.z, distance)
    const moved = Math.hypot(to.x - t.pos.x, to.z - t.pos.z)
    const stoppedShort = moved < distance - 0.01
    if (moved > 0) placeAlong(ctx, t, 'hurled', to, distance)
    if (stoppedShort) contacted = touchedAt(s, t, thrower, to)
  }
  refreshEngagement(ctx)
  for (const x of [t, ...contacted]) forcePin(ctx, x)
  for (const x of [t, ...contacted]) {
    if (x.location !== 'board') continue
    resolveHit(ctx, fighterHit(thrower.id, x.id, numParam(skillOf(s, thrower, 'hurl')?.params ?? {}, 'strength', 3), 'hurl'))
  }
  refreshEngagement(ctx)
  // R-7.4: the involuntary mover ends 1" from an enemy it is still next to (unless it is down)
  if (t.location === 'board') pushApart(ctx, t)
  refreshEngagement(ctx)
}

// ---------------------------------------------------------------------------
// Unleash the Beast: pushes every fighter in base contact away
// ---------------------------------------------------------------------------

/** Push a fighter `distance` inches straight away from `from`; an Immovable Stance holds it still. Returns the inches moved. */
export function pushAway(ctx: Ctx, f: Fighter, from: Vec2, distance: number): number {
  if (isImmovable(ctx.state, f)) {
    markFired('immovableStance')
    return 0
  }
  let dx = f.pos.x - from.x
  let dz = f.pos.z - from.z
  const d = Math.hypot(dx, dz) || 1
  dx /= d
  dz /= d
  const to = slide(ctx.state, f, dx, dz, distance)
  const moved = Math.hypot(to.x - f.pos.x, to.z - f.pos.z)
  if (moved > 0) placeAlong(ctx, f, 'pushed', to, distance)
  return moved
}

/** Fighters in base contact with `f`, friend or foe, on the board (Unleash the Beast's targets). */
export function inBaseContact(state: GameState, f: Fighter): Fighter[] {
  return onBoard(state)
    .filter((e) => e.id !== f.id && baseGap(f, e) <= CONTACT_EPS)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function unleashAvailable(state: GameState, f: Fighter): boolean {
  return f.location === 'board' && f.posture === 'standing' && f.engagedWith.length > 0 && skillOf(state, f, 'unleashTheBeast') !== null
}

