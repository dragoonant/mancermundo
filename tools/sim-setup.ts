// Game set-ups the sim rotates through (shared by tools/sim.ts, the sim tests and the debugging scripts).
import { rosterFromStarter, type EngineBundle, type GameSetup, type Seat } from '@/engine'
import { boardsFor } from '../tests/fixtures/real'

export const SCENARIOS = ['scn.tunnel-skirmish', 'scn.smash-and-grab', 'scn.forgotten-riches']


/** Starter gangs of a house, sorted (the sim rotates through them). */
export function startersOf(bundle: EngineBundle, houseId: string): string[] {
  return Object.values(bundle.starterGangs ?? {})
    .filter((g) => g.houseId === houseId)
    .map((g) => g.id)
    .sort()
}

/** Game g: scenario g mod n, board (g div n) mod boards, Goliath against Escher with the seats swapped every other game. */
export function realSetupFor(bundle: EngineBundle, scenarios: string[], rounds: number | undefined): (game: number) => GameSetup {
  const boards = scenarios.map((id) => {
    const b = boardsFor(bundle, id)
    if (b.length === 0) throw new Error(`no board is legal for ${id}`)
    return b
  })
  const gol = startersOf(bundle, 'goliath')
  const esc = startersOf(bundle, 'escher')
  return (game) => {
    const n = scenarios.length
    const si = game % n
    const round = Math.floor(game / n)
    const swap = round % 2 === 1
    const g = gol[Math.floor(round / 2) % gol.length]!
    const e = esc[Math.floor(round / 4) % esc.length]!
    const gang = (seat: Seat, id: string) => rosterFromStarter(bundle, id, seat.toLowerCase())
    return {
      ruleset: 'n23',
      scenarioId: scenarios[si]!,
      boardId: boards[si]![round % boards[si]!.length]!,
      gangs: swap ? { A: gang('A', e), B: gang('B', g) } : { A: gang('A', g), B: gang('B', e) },
      ...(rounds !== undefined ? { options: { maxRounds: rounds } } : {}),
    }
  }
}

