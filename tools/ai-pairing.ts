// The pairings of tools/ai-bench.ts, shared with the watcher tools: game g -> scenario, board, houses, seats.
import { rosterFromStarter, type EngineBundle, type GameSetup, type Seat } from '@/engine'
import { boardsFor } from '../tests/fixtures/real'

export const SCENARIOS = ['scn.tunnel-skirmish', 'scn.smash-and-grab', 'scn.forgotten-riches']

export interface Pairing {
  setup: GameSetup
  aiSeat: Seat
  aiHouse: string
  scenario: string
}

/** The tested tier plays house (g mod 4 < 2 ? Goliath : Escher), seat A on even games and B on odd ones; scenarios rotate every four games. */
export function pairingFor(bundle: EngineBundle, g: number, scenarios: string[], rounds: number): Pairing {
  const starters = (house: string): string[] =>
    Object.values(bundle.starterGangs ?? {})
      .filter((s) => s.houseId === house)
      .map((s) => s.id)
      .sort()
  const GOL = starters('goliath')
  const ESC = starters('escher')
  const aiSeat: Seat = g % 2 === 0 ? 'A' : 'B'
  const aiHouse = g % 4 < 2 ? 'goliath' : 'escher'
  const scenarioId = scenarios[Math.floor(g / 4) % scenarios.length]!
  const boards = boardsFor(bundle, scenarioId)
  const lap = Math.floor(g / 4)
  const mineList = aiHouse === 'goliath' ? GOL : ESC
  const theirList = aiHouse === 'goliath' ? ESC : GOL
  const mine = mineList[lap % mineList.length]!
  const theirs = theirList[Math.floor(lap / 2) % theirList.length]!
  const gang = (seat: Seat, id: string) => rosterFromStarter(bundle, id, seat.toLowerCase())
  const other: Seat = aiSeat === 'A' ? 'B' : 'A'
  const setup: GameSetup = {
    ruleset: 'n23',
    scenarioId,
    boardId: boards[g % boards.length]!,
    gangs: { [aiSeat]: gang(aiSeat, mine), [other]: gang(other, theirs) } as GameSetup['gangs'],
    options: { maxRounds: rounds },
  }
  return { setup, aiSeat, aiHouse, scenario: scenarioId }
}
