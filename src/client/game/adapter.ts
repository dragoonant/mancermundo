// Glue between the data bundle, the engine bundle and a GameSetup. The data -> engine adapter itself
// (`bundleFromData`), the killzone terrain (`layoutMap`) and loadout resolution live in the engine; this file
// caches them and assembles the setup a team builder produces. Pure functions: safe in node tests.
import { loadBundle, type DataBundle, type DatacardData, type KillzoneLayoutData, type LoadoutChoice, type MissionData, type RosterSelection, type TeamData } from '@/data'
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
  /** M9 batch B: per-operative keyword picks (Marks of Chaos) in flattened roster order: operative choice id -> keyword */
  picks?: Record<string, string>[]
}

/** The weapon ids a loadout adds on top of the card's fixed weapons (what the engine calls Loadout). */
export function chosenWeaponIds(card: DatacardData, choice: LoadoutChoice): string[] {
  return resolveLoadoutChoice(engineBundle(), card.id, choice).weaponIds
}

export function rosterEntries(b: DataBundle, build: SeatBuild): RosterEntry[] {
  const team = b.teams[build.teamId]!
  return flattenRoster(team, build.roster).map((id, i) => {
    const choice = build.loadouts[i] ?? {}
    const entry: RosterEntry = { datacardId: id, loadout: resolveLoadoutChoice(engineBundle(), id, choice) }
    const picks = build.picks?.[i]
    if (picks && Object.keys(picks).length > 0) entry.picks = { ...picks }
    return entry
  })
}

/** The mission map a layout is drawn for (an official card is terrain plus map); null when the mission defines none of the layout's maps. */
export function layoutMapId(layout: KillzoneLayoutData, mission: MissionData): string | null {
  return layout.maps.find((m) => mission.maps.some((x) => x.id === m.id))?.id ?? null
}

export interface SetupOptions {
  layoutId: string
  missionId: string
  /** only honoured when the layout lists it; omit (or 'auto') for the layout's own map */
  mapId?: string | null
  /** objective and equipment markers are placed by the engine's suggestion (no placement UI yet) */
  auto?: boolean
}

export function buildGameSetup(b: DataBundle, a: SeatBuild, bb: SeatBuild, opts: SetupOptions): GameSetup {
  const builds: Record<Seat, SeatBuild> = { A: a, B: bb }
  const mission: NonNullable<GameSetup['mission']> = { missionId: opts.missionId }
  const layout = b.layouts[opts.layoutId]
  const missionData = b.missions[opts.missionId]
  const listed = !!opts.mapId && !!layout?.maps.some((m) => m.id === opts.mapId)
  const mapId = listed ? opts.mapId : layout && missionData ? layoutMapId(layout, missionData) : null
  if (mapId) mission.mapId = mapId
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
