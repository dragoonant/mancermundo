import type {
  ActionData,
  BoardData,
  ConstantsData,
  DataBundle,
  DataRecord,
  DiceData,
  EquipmentListData,
  FighterTypeData,
  HouseData,
  Id,
  RecordType,
  RuleData,
  ScenarioData,
  SkillData,
  StarterGangData,
  TileData,
  TraitData,
  WargearData,
  WeaponData,
} from './types'
import { MANIFEST } from './manifest'
import { buildIndex, checkRefs, recordCodes, type RecordIndex } from './refs'

export const DATA_VERSION = '0.1.0'

export type { DataBundle } from './types'

function parsedFiles(): { path: string; type: RecordType; records: DataRecord[] }[] {
  return MANIFEST.map((m) => ({ path: m.path, type: m.def, records: (m.array ? m.data : [m.data]) as DataRecord[] }))
}

/**
 * Code hooks the data references, derived from the data itself (no generated file, so a stage adding data needs no
 * shared-file edit); the engine registers an implementation for each (src/engine/code-hooks.ts).
 */
export const CODE_HOOKS: readonly { name: string; usedBy: string[] }[] = (() => {
  const usage = new Map<string, Set<string>>()
  for (const f of parsedFiles()) {
    for (const rec of f.records) {
      for (const name of recordCodes(rec, f.type)) usage.set(name, (usage.get(name) ?? new Set()).add((rec as { id: string }).id))
    }
  }
  return [...usage.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, ids]) => ({ name, usedBy: [...ids].sort() }))
})()

/** Group an already built index into the typed maps of a bundle. Throws when the singleton records are missing. */
export function bundleFromIndex(index: RecordIndex): DataBundle {
  const maps = {
    actions: {} as Record<Id, ActionData>,
    traits: {} as Record<Id, TraitData>,
    weapons: {} as Record<Id, WeaponData>,
    wargear: {} as Record<Id, WargearData>,
    skills: {} as Record<Id, SkillData>,
    rules: {} as Record<Id, RuleData>,
    houses: {} as Record<Id, HouseData>,
    fighterTypes: {} as Record<Id, FighterTypeData>,
    equipmentLists: {} as Record<Id, EquipmentListData>,
    starterGangs: {} as Record<Id, StarterGangData>,
    tiles: {} as Record<Id, TileData>,
    boards: {} as Record<Id, BoardData>,
    scenarios: {} as Record<Id, ScenarioData>,
  }
  let dice: DiceData | undefined
  let constants: ConstantsData | undefined
  for (const [id, rec] of Object.entries(index.byId)) {
    switch (index.types[id]) {
      case 'action': maps.actions[id] = rec as ActionData; break
      case 'trait': maps.traits[id] = rec as TraitData; break
      case 'weapon': maps.weapons[id] = rec as WeaponData; break
      case 'wargear': maps.wargear[id] = rec as WargearData; break
      case 'skill': maps.skills[id] = rec as SkillData; break
      case 'rule': maps.rules[id] = rec as RuleData; break
      case 'house': maps.houses[id] = rec as HouseData; break
      case 'fighterType': maps.fighterTypes[id] = rec as FighterTypeData; break
      case 'equipmentList': maps.equipmentLists[id] = rec as EquipmentListData; break
      case 'starterGang': maps.starterGangs[id] = rec as StarterGangData; break
      case 'tile': maps.tiles[id] = rec as TileData; break
      case 'board': maps.boards[id] = rec as BoardData; break
      case 'scenario': maps.scenarios[id] = rec as ScenarioData; break
      case 'dice': dice = rec as DiceData; break
      case 'constants': constants = rec as ConstantsData; break
    }
  }
  if (!dice) throw new Error('data: core/dice.json is missing')
  if (!constants) throw new Error('data: core/constants.json is missing')
  return { byId: index.byId, ...maps, dice, constants, dataVersion: DATA_VERSION }
}

/**
 * Build the in-memory bundle from the statically imported JSON files.
 * Throws on duplicate ids or dangling references; schema validation is tools/validate-data.ts.
 */
export function loadBundle(): DataBundle {
  const index = buildIndex(parsedFiles())
  const errors = [...index.errors, ...checkRefs(index)]
  if (errors.length > 0) throw new Error(`data: ${errors.length} problem(s)\n${errors.join('\n')}`)
  return bundleFromIndex(index)
}

let cached: DataBundle | undefined
const defaultBundle = (): DataBundle => (cached ??= loadBundle())

/** Ids of the houses in the data, sorted. */
export function houseIds(bundle: Pick<DataBundle, 'houses'> = defaultBundle()): string[] {
  return Object.keys(bundle.houses).sort()
}

/** The starter gangs of a house, in id order. */
export function starterGangs(houseId: string, bundle: Pick<DataBundle, 'starterGangs'> = defaultBundle()): StarterGangData[] {
  return Object.values(bundle.starterGangs)
    .filter((s) => s.house === houseId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export { MANIFEST } from './manifest'
export { rosterFromStarter } from './roster'
