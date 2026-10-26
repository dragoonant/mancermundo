import type { DataBundle, DataRecord, KillzoneLayoutData, MissionData, TeamData } from './types'
import { MANIFEST } from './manifest'
import { TYPE_OF_SCHEMA, buildIndex, checkRefs, recordCodes, type RecordType } from './refs'
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
// M9 prep: scaffolded teams (team.json `playable: false` until complete)
import pfTeam from './teams/pathfinders/team.json'
import pfOperatives from './teams/pathfinders/operatives.json'
import pfWeapons from './teams/pathfinders/weapons.json'
import pfAbilities from './teams/pathfinders/abilities.json'
import pfPloys from './teams/pathfinders/ploys.json'
import pfEquipment from './teams/pathfinders/equipment.json'
import hieTeam from './teams/hierotek-circle/team.json'
import hieOperatives from './teams/hierotek-circle/operatives.json'
import hieWeapons from './teams/hierotek-circle/weapons.json'
import hieAbilities from './teams/hierotek-circle/abilities.json'
import hiePloys from './teams/hierotek-circle/ploys.json'
import hieEquipment from './teams/hierotek-circle/equipment.json'
import pmTeam from './teams/plague-marines/team.json'
import pmOperatives from './teams/plague-marines/operatives.json'
import pmWeapons from './teams/plague-marines/weapons.json'
import pmAbilities from './teams/plague-marines/abilities.json'
import pmPloys from './teams/plague-marines/ploys.json'
import pmEquipment from './teams/plague-marines/equipment.json'
import wyrTeam from './teams/wyrmblade/team.json'
import wyrOperatives from './teams/wyrmblade/operatives.json'
import wyrWeapons from './teams/wyrmblade/weapons.json'
import wyrAbilities from './teams/wyrmblade/abilities.json'
import wyrPloys from './teams/wyrmblade/ploys.json'
import wyrEquipment from './teams/wyrmblade/equipment.json'
// M9 batch B scaffold (team.json `playable: false` until complete)
import lgTeam from './teams/legionaries/team.json'
import lgOperatives from './teams/legionaries/operatives.json'
import lgWeapons from './teams/legionaries/weapons.json'
import lgAbilities from './teams/legionaries/abilities.json'
import lgPloys from './teams/legionaries/ploys.json'
import lgEquipment from './teams/legionaries/equipment.json'
import haTeam from './teams/hand-of-the-archon/team.json'
import haOperatives from './teams/hand-of-the-archon/operatives.json'
import haWeapons from './teams/hand-of-the-archon/weapons.json'
import haAbilities from './teams/hand-of-the-archon/abilities.json'
import haPloys from './teams/hand-of-the-archon/ploys.json'
import haEquipment from './teams/hand-of-the-archon/equipment.json'
import hcTeam from './teams/hunter-clade/team.json'
import hcOperatives from './teams/hunter-clade/operatives.json'
import hcWeapons from './teams/hunter-clade/weapons.json'
import hcAbilities from './teams/hunter-clade/abilities.json'
import hcPloys from './teams/hunter-clade/ploys.json'
import hcEquipment from './teams/hunter-clade/equipment.json'
import hkTeam from './teams/hearthkyn-salvagers/team.json'
import hkOperatives from './teams/hearthkyn-salvagers/operatives.json'
import hkWeapons from './teams/hearthkyn-salvagers/weapons.json'
import hkAbilities from './teams/hearthkyn-salvagers/abilities.json'
import hkPloys from './teams/hearthkyn-salvagers/ploys.json'
import hkEquipment from './teams/hearthkyn-salvagers/equipment.json'
import ksTeam from './teams/kasrkin/team.json'
import ksOperatives from './teams/kasrkin/operatives.json'
import ksWeapons from './teams/kasrkin/weapons.json'
import ksAbilities from './teams/kasrkin/abilities.json'
import ksPloys from './teams/kasrkin/ploys.json'
import ksEquipment from './teams/kasrkin/equipment.json'
import nvTeam from './teams/novitiates/team.json'
import nvOperatives from './teams/novitiates/operatives.json'
import nvWeapons from './teams/novitiates/weapons.json'
import nvAbilities from './teams/novitiates/abilities.json'
import nvPloys from './teams/novitiates/ploys.json'
import nvEquipment from './teams/novitiates/equipment.json'
import phTeam from './teams/phobos-strike-team/team.json'
import phOperatives from './teams/phobos-strike-team/operatives.json'
import phWeapons from './teams/phobos-strike-team/weapons.json'
import phAbilities from './teams/phobos-strike-team/abilities.json'
import phPloys from './teams/phobos-strike-team/ploys.json'
import phEquipment from './teams/phobos-strike-team/equipment.json'
import cvTeam from './teams/corsair-voidscarred/team.json'
import cvOperatives from './teams/corsair-voidscarred/operatives.json'
import cvWeapons from './teams/corsair-voidscarred/weapons.json'
import cvAbilities from './teams/corsair-voidscarred/abilities.json'
import cvPloys from './teams/corsair-voidscarred/ploys.json'
import cvEquipment from './teams/corsair-voidscarred/equipment.json'
import wcTeam from './teams/warpcoven/team.json'
import wcOperatives from './teams/warpcoven/operatives.json'
import wcWeapons from './teams/warpcoven/weapons.json'
import wcAbilities from './teams/warpcoven/abilities.json'
import wcPloys from './teams/warpcoven/ploys.json'
import wcEquipment from './teams/warpcoven/equipment.json'
import fkTeam from './teams/farstalker-kinband/team.json'
import fkOperatives from './teams/farstalker-kinband/operatives.json'
import fkWeapons from './teams/farstalker-kinband/weapons.json'
import fkAbilities from './teams/farstalker-kinband/abilities.json'
import fkPloys from './teams/farstalker-kinband/ploys.json'
import fkEquipment from './teams/farstalker-kinband/equipment.json'
import nbTeam from './teams/imperial-navy-breachers/team.json'
import nbOperatives from './teams/imperial-navy-breachers/operatives.json'
import nbWeapons from './teams/imperial-navy-breachers/weapons.json'
import nbAbilities from './teams/imperial-navy-breachers/abilities.json'
import nbPloys from './teams/imperial-navy-breachers/ploys.json'
import nbEquipment from './teams/imperial-navy-breachers/equipment.json'
import blTeam from './teams/blooded/team.json'
import blOperatives from './teams/blooded/operatives.json'
import blWeapons from './teams/blooded/weapons.json'
import blAbilities from './teams/blooded/abilities.json'
import blPloys from './teams/blooded/ploys.json'
import blEquipment from './teams/blooded/equipment.json'
import fgTeam from './teams/fellgor-ravagers/team.json'
import fgOperatives from './teams/fellgor-ravagers/operatives.json'
import fgWeapons from './teams/fellgor-ravagers/weapons.json'
import fgAbilities from './teams/fellgor-ravagers/abilities.json'
import fgPloys from './teams/fellgor-ravagers/ploys.json'
import fgEquipment from './teams/fellgor-ravagers/equipment.json'
import ccTeam from './teams/chaos-cult/team.json'
import ccOperatives from './teams/chaos-cult/operatives.json'
import ccWeapons from './teams/chaos-cult/weapons.json'
import ccAbilities from './teams/chaos-cult/abilities.json'
import ccPloys from './teams/chaos-cult/ploys.json'
import ccEquipment from './teams/chaos-cult/equipment.json'
import gmTeam from './teams/goremongers/team.json'
import gmOperatives from './teams/goremongers/operatives.json'
import gmWeapons from './teams/goremongers/weapons.json'
import gmAbilities from './teams/goremongers/abilities.json'
import gmPloys from './teams/goremongers/ploys.json'
import gmEquipment from './teams/goremongers/equipment.json'
import ssTeam from './teams/scout-squad/team.json'
import ssOperatives from './teams/scout-squad/operatives.json'
import ssWeapons from './teams/scout-squad/weapons.json'
import ssAbilities from './teams/scout-squad/abilities.json'
import ssPloys from './teams/scout-squad/ploys.json'
import ssEquipment from './teams/scout-squad/equipment.json'
import taTeam from './teams/tempestus-aquilons/team.json'
import taOperatives from './teams/tempestus-aquilons/operatives.json'
import taWeapons from './teams/tempestus-aquilons/weapons.json'
import taAbilities from './teams/tempestus-aquilons/abilities.json'
import taPloys from './teams/tempestus-aquilons/ploys.json'
import taEquipment from './teams/tempestus-aquilons/equipment.json'
import exTeam from './teams/exaction-squad/team.json'
import exOperatives from './teams/exaction-squad/operatives.json'
import exWeapons from './teams/exaction-squad/weapons.json'
import exAbilities from './teams/exaction-squad/abilities.json'
import exPloys from './teams/exaction-squad/ploys.json'
import exEquipment from './teams/exaction-squad/equipment.json'
import f17 from './missions/preliminary-ops-secure.json'
import f18 from './missions/preliminary-ops-loot.json'
import f19 from './missions/preliminary-ops-transmission.json'
import f20 from './killzones/volkus-ao25-1.json'
import f21 from './killzones/volkus-ao25-2.json'
import f22 from './killzones/volkus-ao25-3.json'
import f23 from './killzones/volkus-ao25-4.json'
import f24 from './killzones/volkus-ao25-5.json'
import f25 from './killzones/volkus-ao25-6.json'

export * from './types'
export * from './kill-grades'
export * from './loadout'
export * from './roster'
export { MANIFEST } from './manifest'

/** Bumped whenever a data file changes in a way that invalidates saved games or replays. */
export const DATA_VERSION = '0.1.0'


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
  'teams/pathfinders/team.json': pfTeam,
  'teams/pathfinders/operatives.json': pfOperatives,
  'teams/pathfinders/weapons.json': pfWeapons,
  'teams/pathfinders/abilities.json': pfAbilities,
  'teams/pathfinders/ploys.json': pfPloys,
  'teams/pathfinders/equipment.json': pfEquipment,
  'teams/hierotek-circle/team.json': hieTeam,
  'teams/hierotek-circle/operatives.json': hieOperatives,
  'teams/hierotek-circle/weapons.json': hieWeapons,
  'teams/hierotek-circle/abilities.json': hieAbilities,
  'teams/hierotek-circle/ploys.json': hiePloys,
  'teams/hierotek-circle/equipment.json': hieEquipment,
  'teams/plague-marines/team.json': pmTeam,
  'teams/plague-marines/operatives.json': pmOperatives,
  'teams/plague-marines/weapons.json': pmWeapons,
  'teams/plague-marines/abilities.json': pmAbilities,
  'teams/plague-marines/ploys.json': pmPloys,
  'teams/plague-marines/equipment.json': pmEquipment,
  'teams/wyrmblade/team.json': wyrTeam,
  'teams/wyrmblade/operatives.json': wyrOperatives,
  'teams/wyrmblade/weapons.json': wyrWeapons,
  'teams/wyrmblade/abilities.json': wyrAbilities,
  'teams/wyrmblade/ploys.json': wyrPloys,
  'teams/wyrmblade/equipment.json': wyrEquipment,
  'teams/legionaries/team.json': lgTeam,
  'teams/legionaries/operatives.json': lgOperatives,
  'teams/legionaries/weapons.json': lgWeapons,
  'teams/legionaries/abilities.json': lgAbilities,
  'teams/legionaries/ploys.json': lgPloys,
  'teams/legionaries/equipment.json': lgEquipment,
  'teams/hand-of-the-archon/team.json': haTeam,
  'teams/hand-of-the-archon/operatives.json': haOperatives,
  'teams/hand-of-the-archon/weapons.json': haWeapons,
  'teams/hand-of-the-archon/abilities.json': haAbilities,
  'teams/hand-of-the-archon/ploys.json': haPloys,
  'teams/hand-of-the-archon/equipment.json': haEquipment,
  'teams/hunter-clade/team.json': hcTeam,
  'teams/hunter-clade/operatives.json': hcOperatives,
  'teams/hunter-clade/weapons.json': hcWeapons,
  'teams/hunter-clade/abilities.json': hcAbilities,
  'teams/hunter-clade/ploys.json': hcPloys,
  'teams/hunter-clade/equipment.json': hcEquipment,
  'teams/hearthkyn-salvagers/team.json': hkTeam,
  'teams/hearthkyn-salvagers/operatives.json': hkOperatives,
  'teams/hearthkyn-salvagers/weapons.json': hkWeapons,
  'teams/hearthkyn-salvagers/abilities.json': hkAbilities,
  'teams/hearthkyn-salvagers/ploys.json': hkPloys,
  'teams/hearthkyn-salvagers/equipment.json': hkEquipment,
  'teams/kasrkin/team.json': ksTeam,
  'teams/kasrkin/operatives.json': ksOperatives,
  'teams/kasrkin/weapons.json': ksWeapons,
  'teams/kasrkin/abilities.json': ksAbilities,
  'teams/kasrkin/ploys.json': ksPloys,
  'teams/kasrkin/equipment.json': ksEquipment,
  'teams/novitiates/team.json': nvTeam,
  'teams/novitiates/operatives.json': nvOperatives,
  'teams/novitiates/weapons.json': nvWeapons,
  'teams/novitiates/abilities.json': nvAbilities,
  'teams/novitiates/ploys.json': nvPloys,
  'teams/novitiates/equipment.json': nvEquipment,
  'teams/phobos-strike-team/team.json': phTeam,
  'teams/phobos-strike-team/operatives.json': phOperatives,
  'teams/phobos-strike-team/weapons.json': phWeapons,
  'teams/phobos-strike-team/abilities.json': phAbilities,
  'teams/phobos-strike-team/ploys.json': phPloys,
  'teams/phobos-strike-team/equipment.json': phEquipment,
  'teams/corsair-voidscarred/team.json': cvTeam,
  'teams/corsair-voidscarred/operatives.json': cvOperatives,
  'teams/corsair-voidscarred/weapons.json': cvWeapons,
  'teams/corsair-voidscarred/abilities.json': cvAbilities,
  'teams/corsair-voidscarred/ploys.json': cvPloys,
  'teams/corsair-voidscarred/equipment.json': cvEquipment,
  'teams/warpcoven/team.json': wcTeam,
  'teams/warpcoven/operatives.json': wcOperatives,
  'teams/warpcoven/weapons.json': wcWeapons,
  'teams/warpcoven/abilities.json': wcAbilities,
  'teams/warpcoven/ploys.json': wcPloys,
  'teams/warpcoven/equipment.json': wcEquipment,
  'teams/farstalker-kinband/team.json': fkTeam,
  'teams/farstalker-kinband/operatives.json': fkOperatives,
  'teams/farstalker-kinband/weapons.json': fkWeapons,
  'teams/farstalker-kinband/abilities.json': fkAbilities,
  'teams/farstalker-kinband/ploys.json': fkPloys,
  'teams/farstalker-kinband/equipment.json': fkEquipment,
  'teams/imperial-navy-breachers/team.json': nbTeam,
  'teams/imperial-navy-breachers/operatives.json': nbOperatives,
  'teams/imperial-navy-breachers/weapons.json': nbWeapons,
  'teams/imperial-navy-breachers/abilities.json': nbAbilities,
  'teams/imperial-navy-breachers/ploys.json': nbPloys,
  'teams/imperial-navy-breachers/equipment.json': nbEquipment,
  'teams/blooded/team.json': blTeam,
  'teams/blooded/operatives.json': blOperatives,
  'teams/blooded/weapons.json': blWeapons,
  'teams/blooded/abilities.json': blAbilities,
  'teams/blooded/ploys.json': blPloys,
  'teams/blooded/equipment.json': blEquipment,
  'teams/fellgor-ravagers/team.json': fgTeam,
  'teams/fellgor-ravagers/operatives.json': fgOperatives,
  'teams/fellgor-ravagers/weapons.json': fgWeapons,
  'teams/fellgor-ravagers/abilities.json': fgAbilities,
  'teams/fellgor-ravagers/ploys.json': fgPloys,
  'teams/fellgor-ravagers/equipment.json': fgEquipment,
  'teams/chaos-cult/team.json': ccTeam,
  'teams/chaos-cult/operatives.json': ccOperatives,
  'teams/chaos-cult/weapons.json': ccWeapons,
  'teams/chaos-cult/abilities.json': ccAbilities,
  'teams/chaos-cult/ploys.json': ccPloys,
  'teams/chaos-cult/equipment.json': ccEquipment,
  'teams/goremongers/team.json': gmTeam,
  'teams/goremongers/operatives.json': gmOperatives,
  'teams/goremongers/weapons.json': gmWeapons,
  'teams/goremongers/abilities.json': gmAbilities,
  'teams/goremongers/ploys.json': gmPloys,
  'teams/goremongers/equipment.json': gmEquipment,
  'teams/scout-squad/team.json': ssTeam,
  'teams/scout-squad/operatives.json': ssOperatives,
  'teams/scout-squad/weapons.json': ssWeapons,
  'teams/scout-squad/abilities.json': ssAbilities,
  'teams/scout-squad/ploys.json': ssPloys,
  'teams/scout-squad/equipment.json': ssEquipment,
  'teams/tempestus-aquilons/team.json': taTeam,
  'teams/tempestus-aquilons/operatives.json': taOperatives,
  'teams/tempestus-aquilons/weapons.json': taWeapons,
  'teams/tempestus-aquilons/abilities.json': taAbilities,
  'teams/tempestus-aquilons/ploys.json': taPloys,
  'teams/tempestus-aquilons/equipment.json': taEquipment,
  'teams/exaction-squad/team.json': exTeam,
  'teams/exaction-squad/operatives.json': exOperatives,
  'teams/exaction-squad/weapons.json': exWeapons,
  'teams/exaction-squad/abilities.json': exAbilities,
  'teams/exaction-squad/ploys.json': exPloys,
  'teams/exaction-squad/equipment.json': exEquipment,
  'missions/preliminary-ops-secure.json': f17,
  'missions/preliminary-ops-loot.json': f18,
  'missions/preliminary-ops-transmission.json': f19,
  'killzones/volkus-ao25-1.json': f20,
  'killzones/volkus-ao25-2.json': f21,
  'killzones/volkus-ao25-3.json': f22,
  'killzones/volkus-ao25-4.json': f23,
  'killzones/volkus-ao25-5.json': f24,
  'killzones/volkus-ao25-6.json': f25,
}

function parsedFiles(): { path: string; type: RecordType; records: DataRecord[] }[] {
  return MANIFEST.map((m) => {
    const data = FILES[m.path]
    if (data === undefined) throw new Error(`data: manifest file ${m.path} is not imported`)
    return { path: m.path, type: TYPE_OF_SCHEMA[m.schema], records: (m.array ? data : [data]) as DataRecord[] }
  })
}

/**
 * Code hooks the data references, derived from the data itself (no generated file, so a new team's hooks
 * need no shared-file edit); the engine registers an implementation for each (src/engine/code-hooks.ts).
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

/** Ids of the teams that are complete: `playable` is not false (scaffolded teams are left out of pickers and sims). */
export function playableTeamIds(bundle: { teams: Record<string, TeamData> }): string[] {
  return Object.values(bundle.teams)
    .filter((t) => t.playable !== false)
    .map((t) => t.id)
    .sort()
}

/**
 * Build the in-memory bundle from the statically imported JSON files.
 * Throws on duplicate ids or dangling references; schema validation is tools/validate-data.ts.
 */
export function loadBundle(): DataBundle {
  const parsed = parsedFiles()
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
