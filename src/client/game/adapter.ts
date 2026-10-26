// Glue between the data bundle, the engine bundle and a GameSetup. The data -> engine adapter itself (`bundleFromData`,
// `rosterFromStarter`) lives in the engine; this file caches the bundles and assembles the setup the quick-setup screen
// (and later the gang picker) produces. Pure functions: safe in node tests.
import { loadBundle, type DataBundle } from '@/data'
import { bundleFromData, createGame, rosterFromStarter, type EngineBundle, type GameSetup, type Seat } from '@/engine'

let cached: DataBundle | null = null
export function dataBundle(): DataBundle {
  cached ??= loadBundle()
  return cached
}

let cachedEngine: EngineBundle | null = null
export function engineBundle(): EngineBundle {
  cachedEngine ??= bundleFromData(dataBundle())
  return cachedEngine
}

/** What a seat brings: a starter gang (13-gangs.md); custom rosters arrive with the gang picker (S5c). */
export interface SeatBuild {
  starterId: string
}

export interface SetupOptions {
  scenarioId: string
  boardId: string
  /** the engine answers those set-up decisions (default: crew and caskets, never deployment) */
  options?: GameSetup['options']
}

/** Default engine options for a played game: crews and casket spots are the engine's, deployment is done by the players. */
export const PLAY_OPTIONS: NonNullable<GameSetup['options']> = { autoCrew: true, autoCaskets: true }

export function buildGameSetup(builds: Record<Seat, SeatBuild>, opts: SetupOptions): GameSetup {
  const engine = engineBundle()
  const gang = (seat: Seat) => rosterFromStarter(engine, builds[seat].starterId, seat.toLowerCase())
  return {
    ruleset: 'n23',
    scenarioId: opts.scenarioId,
    boardId: opts.boardId,
    gangs: { A: gang('A'), B: gang('B') },
    options: { ...PLAY_OPTIONS, ...(opts.options ?? {}) },
  }
}

const playableCache = new Map<string, boolean>()

/**
 * Whether the engine accepts the scenario yet (a scenario stubbed until a later stage makes `createGame` throw): tried once with
 * the first starter gangs on the scenario's first board and remembered. The quick-setup list greys the others out.
 */
export function scenarioPlayable(scenarioId: string): boolean {
  const hit = playableCache.get(scenarioId)
  if (hit !== undefined) return hit
  let ok = false
  try {
    const b = dataBundle()
    const board = Object.values(b.boards).find((x) => x.scenarios.includes(scenarioId))
    const starters = Object.values(b.starterGangs)
    if (board && starters.length > 0) {
      const builds = { A: { starterId: starters[0]!.id }, B: { starterId: (starters[1] ?? starters[0]!).id } }
      createGame(buildGameSetup(builds, { scenarioId, boardId: board.id }), 'probe', engineBundle())
      ok = true
    }
  } catch {
    ok = false
  }
  playableCache.set(scenarioId, ok)
  return ok
}
