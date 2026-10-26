import { describe, expect, it } from 'vitest'
import type { Seat } from '@/engine'
import { createAiDecider } from '../../src/ai/decider'
import type { Tier } from '../../src/ai/tiers'
import { playMatch } from '../../tools/ai-match'
import { realBundle, realSetupFor } from './fixtures'

/** Win rate of `tier` against `vs` over `games` mirror games (both seats, both teams); draws and faults are left out. */
function winRate(tier: Tier, vs: Tier, games: number, seed: string): { rate: number; decisive: number; clean: boolean } {
  let wins = 0
  let decisive = 0
  let clean = true
  for (let g = 0; g < games; g++) {
    const aiSeat: Seat = g % 2 === 0 ? 'A' : 'B'
    const other: Seat = aiSeat === 'A' ? 'B' : 'A'
    const ti = Math.floor(g / 2) % 2
    const teams: [string, string] = aiSeat === 'A' ? [ti ? 'kommandos' : 'angels-of-death', ti ? 'angels-of-death' : 'kommandos'] : [ti ? 'angels-of-death' : 'kommandos', ti ? 'kommandos' : 'angels-of-death']
    const gameSeed = `${seed}-${g}`
    const ai = createAiDecider(tier, { seed: `${gameSeed}:${aiSeat}` })
    const m = playMatch(realSetupFor(teams), realBundle(), gameSeed, {
      [aiSeat]: ai,
      [other]: createAiDecider(vs, { seed: `${gameSeed}:${other}` }),
    } as Record<Seat, ReturnType<typeof createAiDecider>>)
    if (m.firstRejection || m.stalled) clean = false
    if (m.winner === 'A' || m.winner === 'B') {
      decisive++
      if (m.winner === aiSeat) wins++
    }
  }
  return { rate: decisive ? wins / decisive : 0, decisive, clean }
}

describe('AI tiers', () => {
  it('AI-011 over 20 games each: normal >= easy >= random (10-point slack)', () => {
    const n = winRate('normal', 'random', 20, 'tier-a')
    const e = winRate('easy', 'random', 20, 'tier-a')
    expect(n.clean && e.clean).toBe(true)
    expect(n.decisive).toBeGreaterThanOrEqual(15)
    expect(e.decisive).toBeGreaterThanOrEqual(15)
    // random against random would be 50%; easy must beat that, normal must not trail easy
    expect(e.rate).toBeGreaterThanOrEqual(0.5 + 0.1)
    expect(n.rate + 0.1).toBeGreaterThanOrEqual(e.rate)
    expect(n.rate).toBeGreaterThanOrEqual(0.9)
  }, 300000)
})
