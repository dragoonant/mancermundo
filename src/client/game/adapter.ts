// Glue between the data bundle, the engine bundle and a GameSetup. The data -> engine adapter itself
// (`bundleFromData`), the killzone terrain (`layoutMap`) and loadout resolution live in the engine; this file
// caches them and assembles the setup a team builder produces. Pure functions: safe in node tests.
import { loadBundle, type DataBundle, type DatacardData, type LoadoutChoice, type RosterSelection, type TeamData } from '@/data'
import type { EngineBundle, GameSetup, RosterEntry, Seat } from '@/engine'
import { bundleFromData, layoutMap, resolveLoadoutChoice } from '@/engine/bundle'

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

/** Datacard ids of a roster in slot order (the engine numbers operatives A1.. / B1.. in this order). */
export function flattenRoster(team: TeamData, roster: RosterSelection): string[] {
  return team.selection.slots.flatMap((s) => roster[s.id] ?? [])
}

export interface SeatBuild {
  teamId: string
  roster: RosterSelection
  /** loadout answers per operative, in flattened roster order */
  loadouts: LoadoutChoice[]
  /** equipment option ids, at most the mission's limit */
  equipment: string[]
  /** picks for equipment that has a choice (grenade types): equipment id -> picked ids */
  equipmentChoices?: Record<string, string[]>
  /** team-level picks (Chapter Tactics and the like): team choice id -> ability id */
  choices?: Record<string, string>
}

/** The weapon ids a loadout adds on top of the card's fixed weapons (what the engine calls Loadout). */
export function chosenWeaponIds(card: DatacardData, choice: LoadoutChoice): string[] {
  return resolveLoadoutChoice(engineBundle(), card.id, choice).weaponIds
}

export function rosterEntries(b: DataBundle, build: SeatBuild): RosterEntry[] {
  const team = b.teams[build.teamId]!
  return flattenRoster(team, build.roster).map((id, i) => {
    const choice = build.loadouts[i] ?? {}
    return { datacardId: id, loadout: resolveLoadoutChoice(engineBundle(), id, choice) }
  })
}

export interface SetupOptions {
  layoutId: string
  missionId: string
  /** omit (or 'auto') to let the engine roll the map */
  mapId?: string | null
  /** objective and equipment markers are placed by the engine's suggestion (no placement UI yet) */
  auto?: boolean
}

export function buildGameSetup(b: DataBundle, a: SeatBuild, bb: SeatBuild, opts: SetupOptions): GameSetup {
  const builds: Record<Seat, SeatBuild> = { A: a, B: bb }
  const mission: NonNullable<GameSetup['mission']> = { missionId: opts.missionId }
  if (opts.mapId && opts.mapId !== 'auto') mission.mapId = opts.mapId
  const setup: GameSetup = {
    teams: { A: a.teamId, B: bb.teamId },
    rosters: { A: rosterEntries(b, a), B: rosterEntries(b, bb) },
    equipment: { A: [...builds.A.equipment], B: [...builds.B.equipment] },
    equipmentChoices: { A: { ...(builds.A.equipmentChoices ?? {}) }, B: { ...(builds.B.equipmentChoices ?? {}) } },
    teamChoices: { A: { ...(builds.A.choices ?? {}) }, B: { ...(builds.B.choices ?? {}) } },
    map: layoutMap(engineBundle(), opts.layoutId),
    mission,
  }
  if (opts.auto !== false) {
    setup.autoObjectives = true
    setup.autoEquipment = true
  }
  return setup
}
