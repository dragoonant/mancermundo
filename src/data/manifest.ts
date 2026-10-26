import type { DataFile, RecordType, SchemaName } from './types'
import { CORE_FILES } from './core'
import { GANG_FILES } from './gangs'
import { ZM_FILES } from './zm'
import { SCENARIO_FILES } from './scenarios'

/** Every data file with the schema def it validates against, assembled from the four area indexes. */
export const MANIFEST: DataFile[] = [...CORE_FILES, ...GANG_FILES, ...ZM_FILES, ...SCENARIO_FILES]

export const SCHEMA_NAMES = ['common', 'core', 'item', 'gang', 'zm', 'scenario'] as const

/** The schema file each record kind lives in. */
export const SCHEMA_OF_DEF: Record<RecordType, SchemaName> = {
  action: 'core',
  dice: 'core',
  constants: 'core',
  trait: 'core',
  weapon: 'item',
  wargear: 'item',
  house: 'gang',
  fighterType: 'gang',
  equipmentList: 'gang',
  starterGang: 'gang',
  skill: 'gang',
  rule: 'gang',
  tile: 'zm',
  board: 'zm',
  scenario: 'scenario',
}
