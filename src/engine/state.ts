// State helpers: operatives, seats, markers, immutable updates, canonical hashing.
import { fnv1a } from './rng'
import { providerAny, providerMoveDelta } from './team-rules'
import type { GameState, Marker, Operative, Seat, Vec3 } from './types'

export class EngineInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineInvariantError'
  }
}

export const SEATS: readonly Seat[] = ['A', 'B']

export function otherSeat(seat: Seat): Seat {
  return seat === 'A' ? 'B' : 'A'
}

export function getOp(state: GameState, id: string): Operative {
  const op = state.operatives[id]
  if (!op) throw new EngineInvariantError(`unknown operative ${id}`)
  return op
}

export function allOps(state: GameState): Operative[] {
  return Object.values(state.operatives)
}

/** Operatives on the killzone (set up and not removed). */
export function activeOps(state: GameState): Operative[] {
  return allOps(state).filter((o) => o.status === 'active')
}

export function seatOps(state: GameState, seat: Seat): Operative[] {
  return allOps(state).filter((o) => o.seat === seat && o.status === 'active')
}

/** Ready operatives of a seat: in the killzone, or out of it but still activating (HIDING, reserve.ts). */
export function readyOps(state: GameState, seat: Seat): Operative[] {
  return allOps(state).filter((o) => o.seat === seat && o.ready && (o.status === 'active' || (o.status === 'reserve' && o.offboard !== undefined)))
}

export function enemiesOf(state: GameState, op: { seat: Seat }): Operative[] {
  return activeOps(state).filter((o) => o.seat !== op.seat)
}

export function friendsOf(state: GameState, op: { seat: Seat; id: string }): Operative[] {
  return activeOps(state).filter((o) => o.seat === op.seat && o.id !== op.id)
}

export function isInjured(op: Operative): boolean {
  return op.wounds * 2 < op.maxWounds
}

/** Current APL: printed APL plus net modifiers clamped to +/-1 (R-9.6). */
export function effectiveApl(op: Operative): number {
  // M2b-game: Resolute and Shake It Off make an operative ignore every APL change.
  if (op.flags.ignoreApl) return Math.max(0, op.apl)
  // batch D prep: only the increases count while APL decreases are ignored
  const mods = op.flags.ignoreAplDecreases ? increasesOf(op) : op.aplMods
  const value = op.apl + Math.max(-1, Math.min(1, mods))
  // batch C shared (aplCeiling): an increase "to a maximum of N" cannot bring the APL above N, though other changes may
  const capped = op.aplFx?.filter((f) => f.ceiling !== undefined && f.delta > 0)
  if (!capped || capped.length === 0) return Math.max(0, value)
  const rest = mods - capped.reduce((n, f) => n + f.delta, 0)
  const without = op.apl + Math.max(-1, Math.min(1, rest))
  const ceiling = Math.min(...capped.map((f) => f.ceiling!))
  return Math.max(0, Math.min(value, Math.max(ceiling, without)))
}

/** batch D prep: the APL increases on an operative (its recorded changes above 0; all of aplMods when none are recorded). */
function increasesOf(op: Operative): number {
  if (!op.aplFx || op.aplFx.length === 0) return Math.max(0, op.aplMods)
  return op.aplFx.reduce((n, f) => n + Math.max(0, f.delta), 0)
}

/** batch C shared: the APL an increase "to a maximum of `ceiling`" would leave the operative at now (aplCeiling odds). */
export function aplWithCeiling(op: Operative, delta: number, ceiling: number): number {
  const probe = { ...op, aplMods: op.aplMods + delta, aplFx: [...(op.aplFx ?? []), { delta, source: 'probe', ceiling }] }
  return effectiveApl(probe)
}

/** Injured stat penalties apply (injured and not ignoring them, e.g. And They Shall Know No Fear). */
export function hasInjuredPenalty(op: Operative): boolean {
  return isInjured(op) && !op.flags.ignoreInjured
}

/**
 * Current Move: injured operatives lose 2" with a 4" floor (R-7.3, R-9.6). With `state`, team rule
 * providers also apply (team-rules.ts moveDelta and injuredEquivalent: Mont'ka, Nanomine, Contagion).
 */
export function effectiveMove(op: Operative, state?: GameState): number {
  const injured = hasInjuredPenalty(op) || (state !== undefined && providerAny(state, op, 'injuredEquivalent'))
  const move = op.move + (state ? providerMoveDelta(state, op) : 0) - (injured ? 2 : 0)
  return move < op.move ? Math.max(4, move) : move
}

export function markerRadius(marker: Pick<Marker, 'kind'>): number {
  return (markerDiameterMm(marker.kind) / 25.4) / 2
}

/** Objective markers are 40mm, every other marker 20mm (R-8.4). */
export function markerDiameterMm(kind: Marker['kind']): number {
  return kind === 'objective' ? 40 : 20
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

// ---------------------------------------------------------------------------
// Cloning and hashing
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(deepClone) as unknown as T
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = deepClone((value as Record<string, unknown>)[k])
  }
  return out as T
}

/** Structural copy of a state. `map`, `data` and `origin` are immutable and shared by reference. */
export function cloneState(state: GameState): GameState {
  const src = state as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) {
    if (k === 'map' || k === 'data' || k === 'origin') out[k] = src[k]
    else if (k === 'log') out[k] = state.log.slice()
    else out[k] = deepClone(src[k])
  }
  return out as unknown as GameState
}

/** Canonical JSON: sorted keys, undefined skipped. */
export function canon(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map((v) => (v === undefined ? 'null' : canon(v))).join(',') + ']'
      const rec = value as Record<string, unknown>
      const keys = Object.keys(rec).sort()
      const parts: string[] = []
      for (const k of keys) {
        const v = rec[k]
        if (v === undefined) continue
        parts.push(JSON.stringify(k) + ':' + canon(v))
      }
      return '{' + parts.join(',') + '}'
    }
    default:
      return 'null'
  }
}

const HASH_EXCLUDED = new Set(['map', 'data', 'origin', 'log', 'hash'])

/** fnv1a of the canonical state minus the log, the static map/data and the hash itself. */
export function hashState(state: GameState): string {
  const src = state as unknown as Record<string, unknown>
  const keys = Object.keys(src)
    .filter((k) => !HASH_EXCLUDED.has(k))
    .sort()
  const parts: string[] = []
  for (const k of keys) {
    const v = src[k]
    if (v === undefined) continue
    parts.push(JSON.stringify(k) + ':' + canon(v))
  }
  return fnv1a('{' + parts.join(',') + '}')
}
