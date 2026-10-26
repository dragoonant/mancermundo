// Team resource pools (M9 batch C, generic capability "teamPool"). A pool is a whole-number counter a team's rules
// keep for one player apart from CP: Novitiates Faith points (gained in the Ready step and from kills, spent on Acts
// of Faith). Pools live on the player (`PlayerState.pools`, kind -> value), are public in `view` and shown in the HUD,
// and every change emits PoolChanged. Kinds are namespaced by the team prefix (`nv.faith`). Reading is pure; changing
// takes the step Ctx.
import type { Ctx } from './registry'
import type { GameState, Seat } from './types'

/** The seat's current value of a pool (0 when it never had one). */
export function poolOf(state: GameState, seat: Seat, kind: string): number {
  return state.players[seat].pools?.[kind] ?? 0
}

function write(ctx: Ctx, seat: Seat, kind: string, value: number, reason: string): number {
  const p = ctx.state.players[seat]
  const before = p.pools?.[kind] ?? 0
  const after = Math.max(0, Math.floor(value))
  if (after === before && p.pools && kind in p.pools) return 0
  p.pools = { ...(p.pools ?? {}), [kind]: after }
  ctx.emit({ type: 'PoolChanged', kind, delta: after - before, value: after, reason }, seat)
  return after - before
}

/** Add to a pool (up to `cap` when given). Returns the amount actually added. */
export function gainPool(ctx: Ctx, seat: Seat, kind: string, amount: number, reason: string, cap?: number): number {
  if (amount <= 0) return 0
  const now = poolOf(ctx.state, seat, kind)
  const target = cap === undefined ? now + amount : Math.min(cap, now + amount)
  return Math.max(0, write(ctx, seat, kind, target, reason))
}

/** Spend from a pool; false (and nothing changes) when the pool holds less than `amount`. */
export function spendPool(ctx: Ctx, seat: Seat, kind: string, amount: number, reason: string): boolean {
  if (amount < 0) return false
  const now = poolOf(ctx.state, seat, kind)
  if (now < amount) return false
  if (amount > 0) write(ctx, seat, kind, now - amount, reason)
  return true
}

/** Set a pool to a value (a refund that restores what was spent, a reset); emits PoolChanged when it changes. */
export function setPool(ctx: Ctx, seat: Seat, kind: string, value: number, reason: string): void {
  write(ctx, seat, kind, value, reason)
}
