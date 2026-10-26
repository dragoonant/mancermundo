import type { DataBundle, DataRecord, KillzoneLayoutData, MissionData, TeamData } from './types'
import { MANIFEST } from './manifest'
import { TYPE_OF_SCHEMA, buildIndex, checkRefs, type RecordType } from './refs'
import codeHooksJson from './code-hooks.json'
import f0 from './core/weapon-rules.json'
import f1 from './core/weapons.json'
import f2 from './core/abilities.json'
import f3 from './core/ploys.json'
import f4 from './core/universal-equipment.json'
import f5 from './teams/angels-of-death/team.json'
import f6 from './teams/angels-of-death/operatives.json'
import f7 from './teams/angels-of-death/weapons.json'
import f8 from './teams/angels-of-death/abilities.json'
import f9 from './teams/angels-of-death/ploys.json'
import f10 from './teams/angels-of-death/equipment.json'
import f11 from './teams/kommandos/team.json'
import f12 from './teams/kommandos/operatives.json'
import f13 from './teams/kommandos/weapons.json'
import f14 from './teams/kommandos/abilities.json'
import f15 from './teams/kommandos/ploys.json'
import f16 from './teams/kommandos/equipment.json'
import f17 from './missions/preliminary-ops-secure.json'
import f18 from './missions/preliminary-ops-loot.json'
import f19 from './missions/preliminary-ops-transmission.json'
import f20 from './killzones/volkus-01.json'
import f21 from './killzones/volkus-02.json'
import f22 from './killzones/volkus-03.json'

export * from './types'
export * from './kill-grades'
export * from './loadout'
export * from './roster'
export { MANIFEST } from './manifest'

/** Bumped whenever a data file changes in a way that invalidates saved games or replays. */
export const DATA_VERSION = '0.1.0'

/** Code hooks the data references; the engine registers an implementation for each (src/engine/code-hooks.ts). */
export const CODE_HOOKS: readonly { name: string; usedBy: string[] }[] = codeHooksJson.hooks

const FILES: Record<string, unknown> = {
  'core/weapon-rules.json': f0,
  'core/weapons.json': f1,
  'core/abilities.json': f2,
  'core/ploys.json': f3,
  'core/universal-equipment.json': f4,
  'teams/angels-of-death/team.json': f5,
  'teams/angels-of-death/operatives.json': f6,
  'teams/angels-of-death/weapons.json': f7,
  'teams/angels-of-death/abilities.json': f8,
  'teams/angels-of-death/ploys.json': f9,
  'teams/angels-of-death/equipment.json': f10,
  'teams/kommandos/team.json': f11,
  'teams/kommandos/operatives.json': f12,
  'teams/kommandos/weapons.json': f13,
  'teams/kommandos/abilities.json': f14,
  'teams/kommandos/ploys.json': f15,
  'teams/kommandos/equipment.json': f16,
  'missions/preliminary-ops-secure.json': f17,
  'missions/preliminary-ops-loot.json': f18,
  'missions/preliminary-ops-transmission.json': f19,
  'killzones/volkus-01.json': f20,
  'killzones/volkus-02.json': f21,
  'killzones/volkus-03.json': f22,
}

/**
 * Build the in-memory bundle from the statically imported JSON files.
 * Throws on duplicate ids or dangling references; schema validation is tools/validate-data.ts.
 */
export function loadBundle(): DataBundle {
  const parsed: { path: string; type: RecordType; records: DataRecord[] }[] = MANIFEST.map((m) => {
    const data = FILES[m.path]
    if (data === undefined) throw new Error(`data: manifest file ${m.path} is not imported`)
    return { path: m.path, type: TYPE_OF_SCHEMA[m.schema], records: (m.array ? data : [data]) as DataRecord[] }
  })
  const index = buildIndex(parsed)
  const errors = [...index.errors, ...checkRefs(index)]
  if (errors.length > 0) throw new Error(`data: ${errors.length} problem(s)\n${errors.join('\n')}`)
  const teams: Record<string, TeamData> = {}
  const missions: Record<string, MissionData> = {}
  const layouts: Record<string, KillzoneLayoutData> = {}
  for (const [id, rec] of Object.entries(index.byId)) {
    const t = index.types[id]
    if (t === 'team') teams[id] = rec as TeamData
    else if (t === 'mission') missions[id] = rec as MissionData
    else if (t === 'layout') layouts[id] = rec as KillzoneLayoutData
  }
  return { byId: index.byId, teams, missions, layouts, weaponGroups: index.groups, dataVersion: DATA_VERSION }
}
