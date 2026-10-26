/** Every data file, the schema it validates against, and whether it holds an array of records. */
export type SchemaName =
  | 'datacard'
  | 'weapon'
  | 'ability'
  | 'ploy'
  | 'equipment'
  | 'team'
  | 'weapon-rule'
  | 'mission'
  | 'killzone-layout'

export interface ManifestEntry {
  /** Path relative to src/data. */
  path: string
  schema: SchemaName
  array: boolean
}

export const TEAM_DIRS = ['angels-of-death', 'kommandos'] as const

const teamFiles = (dir: string): ManifestEntry[] => [
  { path: `teams/${dir}/team.json`, schema: 'team', array: false },
  { path: `teams/${dir}/operatives.json`, schema: 'datacard', array: true },
  { path: `teams/${dir}/weapons.json`, schema: 'weapon', array: true },
  { path: `teams/${dir}/abilities.json`, schema: 'ability', array: true },
  { path: `teams/${dir}/ploys.json`, schema: 'ploy', array: true },
  { path: `teams/${dir}/equipment.json`, schema: 'equipment', array: true },
]

export const MANIFEST: ManifestEntry[] = [
  { path: 'core/weapon-rules.json', schema: 'weapon-rule', array: true },
  { path: 'core/weapons.json', schema: 'weapon', array: true },
  { path: 'core/abilities.json', schema: 'ability', array: true },
  { path: 'core/ploys.json', schema: 'ploy', array: true },
  { path: 'core/universal-equipment.json', schema: 'equipment', array: true },
  ...TEAM_DIRS.flatMap(teamFiles),
  { path: 'missions/preliminary-ops-secure.json', schema: 'mission', array: false },
  { path: 'missions/preliminary-ops-loot.json', schema: 'mission', array: false },
  { path: 'missions/preliminary-ops-transmission.json', schema: 'mission', array: false },
  { path: 'killzones/volkus-01.json', schema: 'killzone-layout', array: false },
  { path: 'killzones/volkus-02.json', schema: 'killzone-layout', array: false },
  { path: 'killzones/volkus-03.json', schema: 'killzone-layout', array: false },
]

export const SCHEMA_NAMES = [
  'common',
  'datacard',
  'weapon',
  'ability',
  'ploy',
  'equipment',
  'team',
  'weapon-rule',
  'mission',
  'killzone-layout',
] as const
