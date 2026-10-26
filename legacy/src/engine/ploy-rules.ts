// Registry of team-level ploy adjustments (Heroic Leader, Doctrine Warfare, Icon of Contagion...). A leaf module
// with type-only imports, so a team file can call registerPloyRule at module top level even when it is first
// evaluated through the abilities.ts -> teams import cycle while ploys.ts is still loading. The store sits behind
// a hoisted function, so it is safe before this module's body has run as well.
import type { PloyOfferSeed, PloyWindowInfo } from './code-hooks'
import type { Ctx } from './registry'
import type { GameState, RuntimePloy, Seat } from './types'

export interface PloyOffer {
  /** option id */
  id: string
  ployId: string
  name: string
  param?: string
  operativeId?: string
  cost: number
  /** which allowance paid (heroicLeader, doctrineWarfare:assault, ...) */
  via?: string
  seed: PloyOfferSeed
}

/** Team-level adjustments to ploys (Heroic Leader, Doctrine Warfare) registered by the team modules. */
export interface PloyRule {
  extraOffers?(state: GameState, seat: Seat, window: string, info: PloyWindowInfo): PloyOffer[]
  /** replace the cost of an offer; return null to leave it */
  costAdjust?(state: GameState, seat: Seat, ploy: RuntimePloy, seed: PloyOfferSeed, info: PloyWindowInfo): { cost: number; via: string } | null
  /** an offer that carried `via` was used */
  onUsed?(ctx: Ctx, seat: Seat, offer: PloyOffer, info: PloyWindowInfo): void
  /** M9 batch B: CP added to the ploy's cost after every reduction (Devious Scheme: +1 on the opponent's next use); summed */
  costSurcharge?(state: GameState, seat: Seat, ploy: RuntimePloy, seed: PloyOfferSeed, info: PloyWindowInfo): number
}

/** The registered rules, in registration order (hoisted, never in the temporal dead zone). */
export function ployRules(): PloyRule[] {
  const holder = ployRules as unknown as { list?: PloyRule[] }
  return (holder.list ??= [])
}

export function registerPloyRule(rule: PloyRule): void {
  ployRules().push(rule)
}
