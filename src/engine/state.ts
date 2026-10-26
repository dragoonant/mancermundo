// State helpers: fighters, seats, immutable updates, canonical hashing.
import { fnv1a } from './rng'
import type { ConstantsData } from '../data/types'
import type { Fighter, GameState, Seat, Vec3 } from './types'

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

export function getFighter(state: GameState, id: string): Fighter {
  const f = state.fighters[id]
  if (!f) throw new EngineInvariantError(`unknown fighter ${id}`)
  return f
}

export function allFighters(state: GameState): Fighter[] {
  return Object.values(state.fighters)
}

/** Fighters on the board (set up and neither Out of Action nor fled). */
export function onBoard(state: GameState): Fighter[] {
  return allFighters(state).filter((f) => f.location === 'board')
}

export function seatFighters(state: GameState, seat: Seat): Fighter[] {
  return allFighters(state).filter((f) => f.seat === seat && f.location === 'board')
}

/** Ready fighters of a seat on the board (the ones that may be activated). */
export function readyFighters(state: GameState, seat: Seat): Fighter[] {
  return allFighters(state).filter((f) => f.seat === seat && f.location === 'board' && f.ready)
}

export function enemiesOf(state: GameState, fighter: { seat: Seat }): Fighter[] {
  return onBoard(state).filter((f) => f.seat !== fighter.seat)
}

export function friendsOf(state: GameState, fighter: { seat: Seat; id: string }): Fighter[] {
  return onBoard(state).filter((f) => f.seat === fighter.seat && f.id !== fighter.id)
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

/** Structural copy of a state. `data` and `origin` are immutable and shared by reference, as is `board.def`. */
export function cloneState(state: GameState): GameState {
  const src = state as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) {
    if (k === 'data' || k === 'origin') out[k] = src[k]
    else if (k === 'log') out[k] = state.log.slice()
    else if (k === 'board') {
      const { def, ...dynamic } = state.board
      out[k] = { def, ...(deepClone(dynamic) as object) }
    } else out[k] = deepClone(src[k])
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

const HASH_EXCLUDED = new Set(['data', 'origin', 'log', 'hash'])

/** fnv1a of the canonical state minus the log, the static data/origin, the compiled board definition and the hash itself. */
export function hashState(state: GameState): string {
  const src = state as unknown as Record<string, unknown>
  const keys = Object.keys(src)
    .filter((k) => !HASH_EXCLUDED.has(k))
    .sort()
  const parts: string[] = []
  for (const k of keys) {
    let v = src[k]
    if (v === undefined) continue
    if (k === 'board') {
      const { def: _def, ...dynamic } = state.board
      v = dynamic
    }
    parts.push(JSON.stringify(k) + ':' + canon(v))
  }
  return fnv1a('{' + parts.join(',') + '}')
}

// ---------------------------------------------------------------------------
// Fighter geometry and condition helpers (S2)
// ---------------------------------------------------------------------------

export function isBroken(f: Fighter): boolean {
  return f.conditions.broken !== undefined
}

export function hasCondition(f: Fighter, name: string): boolean {
  return f.conditions[name] !== undefined
}

/** The footprint of a fighter's base on the floor plane. */
export function centreOf(f: { pos: Vec3 }): { x: number; z: number } {
  return { x: f.pos.x, z: f.pos.z }
}

/** The fighter currently activated, or null. */
export function activeFighter(state: GameState): Fighter | null {
  const a = state.action.activation
  return a ? (state.fighters[a.fighterId] ?? null) : null
}

/** Enemies on the board of a fighter that are Standing or Pinned (the ones the 1" rule protects, R-7.3). */
export function oneInchEnemies(state: GameState, f: { seat: Seat }): Fighter[] {
  return onBoard(state).filter((e) => e.seat !== f.seat && e.posture !== 'seriouslyInjured')
}

/** The rule constants of the snapshot (core/constants.json shape). */
export function constants(state: GameState): ConstantsData {
  return state.data.constants as unknown as ConstantsData
}
