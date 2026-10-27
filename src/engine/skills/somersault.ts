// Somersault (esc, Basic action): the fighter is placed at any spot within 6" (straight line from where it stands) that it can
// see and that is more than 1" from every enemy. It is a placement, not a move: nothing that triggers on movement fires and an
// Engaged fighter leaves combat without reaction attacks. Answered as a `move.path` of kind `somersault` whose last waypoint
// is the spot; passing cancels the declared action before anything is spent.
import { payAndContinue } from '../activation'
import { markFired } from '../code-hooks'
import { segmentClear } from '../hits'
import { refreshEngagement } from '../measure'
import { round3 } from '../geometry'
import { spotProblem, normaliseAngle } from '../movement'
import { reject, type Ctx, type Handled } from '../registry'
import { constants, enemiesOf, getFighter } from '../state'
import type { ActionPayloadMap, Fighter, GameState, MoveConstraints, Rejection, Vec2 } from '../types'
import { numParam, skillOf } from './common'

export const SOMERSAULT_RANGE = 6

export function somersaultRange(state: GameState, f: Fighter): number {
  const hit = skillOf(state, f, 'somersault')
  return hit ? numParam(hit.params, 'range', SOMERSAULT_RANGE) : SOMERSAULT_RANGE
}

/** Why `to` is not a legal Somersault spot for `f` (null when it is). */
export function somersaultProblem(state: GameState, f: Fighter, to: Vec2, range = somersaultRange(state, f)): Rejection | null {
  const from = { x: f.pos.x, z: f.pos.z }
  const d = Math.hypot(to.x - from.x, to.z - from.z)
  if (d > range + 0.005) return { code: 'E_OUT_OF_RANGE', reason: `that spot is ${d.toFixed(2)}" away, Somersault reaches ${range}"` }
  const bad = spotProblem(state, f, to)
  if (bad) return bad
  const limit = constants(state).radii.oneInchRule
  for (const e of enemiesOf(state, f)) {
    if (e.location !== 'board') continue
    if (Math.hypot(e.pos.x - to.x, e.pos.z - to.z) - e.baseRadius - f.baseRadius <= limit + 1e-6) return { code: 'E_ONE_INCH', reason: `the spot is within ${limit}" of ${e.id}`, details: { enemyId: e.id } }
  }
  if (!segmentClear(state, from, to)) return { code: 'E_NOT_VISIBLE', reason: 'a wall or closed door hides that spot' }
  return null
}

/**
 * `suggest` for a Somersault: the legal spot (three rings of sixteen round the fighter) that ends nearest an enemy, so the
 * jump closes the distance; null when no spot is legal (the action is then given back).
 */
export function suggestSomersault(state: GameState, f: Fighter, range = somersaultRange(state, f)): Vec2 | null {
  const enemies = enemiesOf(state, f).filter((e) => e.location === 'board')
  let best: { at: Vec2; d: number } | null = null
  for (const r of [range, range * 0.7, range * 0.4]) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8
      const at = { x: round3(f.pos.x + Math.sin(a) * r), z: round3(f.pos.z + Math.cos(a) * r) }
      if (somersaultProblem(state, f, at, range)) continue
      const d = enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.pos.x - at.x, e.pos.z - at.z))) : 0
      if (!best || d < best.d - 1e-9) best = { at, d }
    }
  }
  return best ? best.at : null
}

/** The `move.path` decision that places the Somersaulting fighter (it can be passed: the declared action is then cancelled). */
export function raiseSomersault(ctx: Ctx, f: Fighter): void {
  const maxInches = somersaultRange(ctx.state, f)
  ctx.raise({
    kind: 'move.path',
    seat: f.seat,
    window: 'action.declared',
    context: { fighterId: f.id, kind: 'somersault', maxInches, obstacleCost: 0 },
    constraints: { kind: 'somersault', fighterId: f.id, origin: { ...f.pos }, baseRadius: f.baseRadius, maxInches, oneInch: 'enemy' },
    canPass: true,
  })
}

export function handleSomersault(state: GameState, payload: ActionPayloadMap['move.path'], c: MoveConstraints): Handled {
  const f = getFighter(state, c.fighterId!)
  const wps = payload.waypoints
  if (!Array.isArray(wps) || wps.length === 0 || wps.some((w) => !w || !Number.isFinite(w.x) || !Number.isFinite(w.z))) return reject('E_SCHEMA', 'Somersault needs the spot to land on')
  const last = wps[wps.length - 1]!
  const to = { x: round3(last.x), z: round3(last.z) }
  const bad = somersaultProblem(state, f, to, c.maxInches ?? SOMERSAULT_RANGE)
  if (bad) return { rejection: bad }
  const facing = payload.facing !== undefined ? (Number.isFinite(payload.facing) ? normaliseAngle(payload.facing) : null) : null
  if (payload.facing !== undefined && facing === null) return reject('E_SCHEMA', 'facing must be a finite angle')
  return {
    run(ctx) {
      const fighter = getFighter(ctx.state, f.id)
      const from = { ...fighter.pos }
      const length = round3(Math.hypot(to.x - from.x, to.z - from.z))
      fighter.pos = { x: to.x, y: 0, z: to.z }
      fighter.facing = facing ?? normaliseAngle(length > 0 ? Math.atan2(to.x - from.x, to.z - from.z) : fighter.facing)
      ctx.emit({ type: 'FighterMoved', fighterId: fighter.id, kind: 'somersault', from, to: { ...fighter.pos }, path: [{ x: from.x, z: from.z }, { ...to }], length, maxInches: c.maxInches ?? SOMERSAULT_RANGE }, fighter.seat)
      ctx.emit({ type: 'SkillUsed', fighterId: fighter.id, skill: 'somersault' }, fighter.seat)
      markFired('somersault')
      refreshEngagement(ctx)
      payAndContinue(ctx, fighter, 'somersault', false)
    },
  }
}
