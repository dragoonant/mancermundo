// The real data through the real adapter: Goliath and Escher starter gangs on the shipped boards. Used by the adapter test,
// the sim test and anything that wants numbers from the printed profiles instead of the synthetic fixture.
import { loadBundle } from '@/data'
import { bundleFromData, rosterFromStarter, type EngineBundle } from '@/engine/bundle'
import type { GameSetup, Seat } from '@/engine/types'

let cached: EngineBundle | undefined

/** The engine bundle built once from src/data. */
export function realBundle(): EngineBundle {
  return (cached ??= bundleFromData(loadBundle()))
}

export interface RealSetupOptions {
  scenarioId?: string
  boardId?: string
  /** starter gang ids for seats A and B */
  starters?: [string, string]
  options?: GameSetup['options']
}

/** Boards the data lists for a scenario, sorted. */
export function boardsFor(bundle: EngineBundle, scenarioId: string): string[] {
  const data = loadBundle()
  return Object.values(data.boards)
    .filter((b) => b.scenarios.includes(scenarioId) && bundle.boards[b.id])
    .map((b) => b.id)
    .sort()
}

/** A GameSetup for two starter gangs (default: the first Goliath gang against the first Escher gang) on a legal board. */
export function realSetup(opts: RealSetupOptions = {}): GameSetup {
  const bundle = realBundle()
  const scenarioId = opts.scenarioId ?? 'scn.tunnel-skirmish'
  const starters = opts.starters ?? ['gol.sg.starter-1', 'esc.sg.starter-1']
  const boardId = opts.boardId ?? boardsFor(bundle, scenarioId)[0]!
  const gang = (seat: Seat, id: string) => rosterFromStarter(bundle, id, seat.toLowerCase())
  return {
    ruleset: 'n23',
    scenarioId,
    boardId,
    gangs: { A: gang('A', starters[0]), B: gang('B', starters[1]) },
    ...(opts.options ? { options: opts.options } : {}),
  }
}
