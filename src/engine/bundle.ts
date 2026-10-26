// The data the engine consumes. `EngineBundle` is runtime-shaped (types.ts `Runtime*` records, boards already compiled to
// `BoardDef`): the engine never reads src/data. The adapter that fills it from validated JSON (`bundleFromData`: parse
// "4+", weapon `str`, ranges, traits; compile boards through board.ts) arrives in S2; until then tests build bundles by
// hand (tests/fixtures/gang.ts). `snapshotData` copies the records one game uses into `GameState.data`.
import type {
  BoardDef,
  GameData,
  GameSetup,
  RuntimeAction,
  RuntimeConstants,
  RuntimeDice,
  RuntimeFighterType,
  RuntimeHouse,
  RuntimeScenario,
  RuntimeSkill,
  RuntimeTrait,
  RuntimeWargear,
  RuntimeWeapon,
} from './types'

export interface EngineBundle {
  dataVersion: string
  houses: Record<string, RuntimeHouse>
  fighterTypes: Record<string, RuntimeFighterType>
  weapons: Record<string, RuntimeWeapon>
  traits: Record<string, RuntimeTrait>
  /** skills, fighter rules and house rules */
  skills: Record<string, RuntimeSkill>
  wargear: Record<string, RuntimeWargear>
  actions: Record<string, RuntimeAction>
  dice: RuntimeDice
  constants: RuntimeConstants
  scenarios: Record<string, RuntimeScenario>
  /** compiled boards (board.ts), keyed by board id */
  boards: Record<string, BoardDef>
}

function pick<T>(from: Record<string, T>, ids: Iterable<string>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const id of ids) {
    const rec = from[id]
    if (rec) out[id] = rec
  }
  return out
}

/**
 * The snapshot a game carries: the two houses and their fighter types, the weapons / wargear / skills / rules the rosters
 * (and the fighter types' own rules) reference, and the shared tables. Records are shared by reference with the bundle.
 */
export function snapshotData(bundle: EngineBundle, setup: GameSetup): GameData {
  const houseIds = new Set([setup.gangs.A.houseId, setup.gangs.B.houseId])
  const weaponIds = new Set<string>()
  const wargearIds = new Set<string>()
  const skillIds = new Set<string>()
  const typeIds = new Set<string>()
  for (const h of houseIds) {
    const house = bundle.houses[h]
    if (!house) continue
    for (const id of house.houseRules) skillIds.add(id)
    for (const id of house.fighterTypes) typeIds.add(id)
  }
  for (const seat of ['A', 'B'] as const) {
    for (const f of setup.gangs[seat].roster) {
      typeIds.add(f.typeId)
      f.weapons.forEach((w) => weaponIds.add(w))
      f.wargear.forEach((w) => wargearIds.add(w))
      f.skills.forEach((s) => skillIds.add(s))
    }
  }
  for (const id of typeIds) {
    for (const r of bundle.fighterTypes[id]?.rules ?? []) skillIds.add(r.id)
  }
  return {
    dataVersion: bundle.dataVersion,
    houses: pick(bundle.houses, houseIds),
    fighterTypes: pick(bundle.fighterTypes, typeIds),
    weapons: pick(bundle.weapons, weaponIds),
    traits: bundle.traits,
    skills: pick(bundle.skills, skillIds),
    wargear: pick(bundle.wargear, wargearIds),
    actions: bundle.actions,
    dice: bundle.dice,
    constants: bundle.constants,
    scenario: bundle.scenarios[setup.scenarioId]!,
  }
}
