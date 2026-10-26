// Leaf module (type-only imports) for free-point decision handlers, so team files can register at module top level
// without hitting the markers.ts import cycle (same fix as ploy-rules.ts).
import type { GameState, Seat, Vec2 } from './types'
import type { Ctx } from './registry'

/** What a free-point decision checks and does; registered by name (registerPointHandler). */
export interface PointHandler {
  /** why `p` is not a legal answer, or null */
  problem(state: GameState, seat: Seat, p: Vec2, context: Record<string, unknown>): string | null
  /** the answer: a legal point, or null for a pass (the rule's own default or skip); must raise the next decision */
  done(ctx: Ctx, seat: Seat, p: Vec2 | null, context: Record<string, unknown>): void
}

const pointHandlers = new Map<string, PointHandler>()

export function registerPointHandler(name: string, h: PointHandler): void {
  pointHandlers.set(name, h)
}

export function pointHandler(name: string): PointHandler | undefined {
  return pointHandlers.get(name)
}
