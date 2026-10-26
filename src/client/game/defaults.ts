// Defaults and resolvers for the menu flow and the ?test=1 shortcut: aliases (aod, kom, secure, 01),
// legal default rosters, first-legal loadouts, equipment candidates.
import {
  defaultLoadout,
  enumerateRosters,
  slotCost,
  validateLoadout,
  validateRoster,
  validateTeamChoices,
  type AbilityData,
  type DataBundle,
  type DatacardData,
  type EquipmentData,
  type Id,
  type MissionData,
  type RosterSelection,
  type TeamData,
} from '@/data'
import { defaultEquipmentFor } from '@/engine/bundle'
import { selectionProblem } from '@/engine/equipment'
import { engineBundle, flattenRoster, type SeatBuild } from './adapter'

function isEquipment(r: unknown): r is EquipmentData {
  return !!r && typeof r === 'object' && 'scope' in r && 'count' in r
}

export function teamList(b: DataBundle): TeamData[] {
  return Object.values(b.teams).sort((x, y) => x.name.localeCompare(y.name))
}

export function missionList(b: DataBundle): MissionData[] {
  return Object.values(b.missions).sort((x, y) => x.id.localeCompare(y.id))
}

export function layoutList(b: DataBundle) {
  return Object.values(b.layouts).sort((x, y) => x.id.localeCompare(y.id))
}

/** Short alias of a team: the prefix its datacard ids share ("aod", "kom"). */
export function teamAlias(team: TeamData): string {
  const first = team.selection.slots[0]?.from[0] ?? team.id
  return first.split('.')[0] ?? team.id
}

export function resolveTeam(b: DataBundle, key: string | null | undefined, fallbackIndex = 0): TeamData {
  const list = teamList(b)
  if (key) {
    const k = key.toLowerCase()
    const hit = list.find((t) => t.id === k || teamAlias(t) === k || t.name.toLowerCase() === k)
    if (hit) return hit
  }
  return list[fallbackIndex % list.length]!
}

export function resolveMission(b: DataBundle, key: string | null | undefined): MissionData {
  const list = missionList(b)
  if (key) {
    const k = key.toLowerCase()
    const hit = list.find((m) => m.id === k || m.id.endsWith(`-${k}`) || m.critOp === k)
    if (hit) return hit
  }
  return list[0]!
}

export function resolveLayout(b: DataBundle, key: string | null | undefined) {
  const list = layoutList(b)
  if (key) {
    const k = key.toLowerCase()
    const hit = list.find((l) => l.id === k || l.id.endsWith(k) || l.id.endsWith(`volkus-${k.padStart(2, '0')}`))
    if (hit) return hit
  }
  return list[0]!
}

/** A legal roster: greedy fill (whole selections first, then halves, repeatable entries pad), checked, else the first enumerated. */
export function defaultRoster(b: DataBundle, team: TeamData): RosterSelection {
  const roster: RosterSelection = {}
  for (const slot of team.selection.slots) {
    const half = new Set(slot.halfSelections ?? [])
    const rep = new Set(slot.repeatable ?? [])
    const ids: Id[] = []
    const order = [...slot.from.filter((id) => !half.has(id)), ...slot.from.filter((id) => half.has(id))]
    for (const id of order) {
      if (!ids.includes(id) && slotCost(slot, [...ids, id]) <= slot.count) ids.push(id)
    }
    const pad = slot.from.find((id) => rep.has(id))
    while (pad && slotCost(slot, [...ids, pad]) <= slot.count) ids.push(pad)
    roster[slot.id] = ids
  }
  if (validateRoster(team, roster, b.byId as Record<string, DatacardData>).ok) return roster
  const first = enumerateRosters(team).next()
  return first.done ? roster : first.value
}

export function datacard(b: DataBundle, id: string): DatacardData {
  return b.byId[id] as DatacardData
}

export function defaultLoadouts(b: DataBundle, team: TeamData, roster: RosterSelection) {
  return flattenRoster(team, roster).map((id) => defaultLoadout(datacard(b, id)))
}

/** Equipment a team may pick: its own faction equipment plus the universal list. */
export function equipmentFor(b: DataBundle, team: TeamData): EquipmentData[] {
  const own = new Set(team.equipment)
  return Object.values(b.byId)
    .filter(isEquipment)
    .filter((e) => e.scope === 'universal' || own.has(e.id))
    .sort((x, y) => (x.scope === y.scope ? x.name.localeCompare(y.name) : x.scope === 'universal' ? 1 : -1))
}

/** Abilities a team choice may take (those carrying the choice's group). */
export function choiceOptions(b: DataBundle, group: string): AbilityData[] {
  return Object.values(b.byId).filter((r): r is AbilityData => (r as AbilityData).choiceGroup === group)
}

export function defaultChoices(b: DataBundle, team: TeamData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tc of team.teamChoices ?? []) {
    const taken = new Set((tc.distinctFrom ?? []).map((k) => out[k]))
    const pick = choiceOptions(b, tc.group).find((a) => !taken.has(a.id))
    if (pick) out[tc.id] = pick.id
  }
  return out
}

/** First `pick` entries of an equipment choice (grenade types), distinct unless the choice may repeat. */
export function defaultEquipmentPicks(e: EquipmentData): string[] {
  const c = e.choice
  if (!c) return []
  const out: string[] = []
  for (let i = 0; out.length < c.pick && i < c.pick * Math.max(1, c.from.length); i++) {
    const id = c.from[c.repeatable ? 0 : i % c.from.length]
    if (id && (c.repeatable || !out.includes(id))) out.push(id)
  }
  return out
}

/** Default equipment: the engine's tested default list for the team (only entries that exist and are enabled). */
export function defaultEquipment(b: DataBundle, team: TeamData): { equipment: string[]; equipmentChoices: Record<string, string[]> } {
  let ids: string[] = []
  try {
    ids = defaultEquipmentFor(team.id)
  } catch {
    ids = []
  }
  const equipment: string[] = []
  const equipmentChoices: Record<string, string[]> = {}
  for (const id of ids) {
    const e = b.byId[id] as EquipmentData | undefined
    if (!e || !isEquipment(e) || e.enabled === false) continue
    equipment.push(id)
    if (e.choice) equipmentChoices[id] = defaultEquipmentPicks(e)
  }
  return { equipment, equipmentChoices }
}

export function defaultBuild(b: DataBundle, team: TeamData): SeatBuild {
  const roster = defaultRoster(b, team)
  return { teamId: team.id, roster, loadouts: defaultLoadouts(b, team, roster), ...defaultEquipment(b, team), choices: defaultChoices(b, team) }
}

/** Reasons a build cannot be fielded; empty when it can. */
export function buildProblems(b: DataBundle, build: SeatBuild, equipmentLimit: number): string[] {
  const team = b.teams[build.teamId]
  if (!team) return [`unknown team ${build.teamId}`]
  const out: string[] = [...validateRoster(team, build.roster, b.byId as Record<string, DatacardData>).reasons]
  flattenRoster(team, build.roster).forEach((id, i) => {
    const card = datacard(b, id)
    for (const r of validateLoadout(card, build.loadouts[i] ?? {})) out.push(`${card.name}: ${r}`)
  })
  out.push(...validateTeamChoices(team, build.choices ?? {}, b.byId as Record<string, AbilityData>))
  if (build.equipment.length > equipmentLimit) out.push(`at most ${equipmentLimit} equipment options`)
  const eq = engineBundle().equipment
  if (eq) {
    const problem = selectionProblem(
      { teams: { A: build.teamId, B: build.teamId }, rosters: { A: [], B: [] }, map: { id: '', size: { x: 30, z: 22 }, dropZones: [], features: [] }, equipment: { A: build.equipment, B: build.equipment }, equipmentChoices: { A: build.equipmentChoices ?? {}, B: build.equipmentChoices ?? {} } },
      'A',
      { equipment: eq, teamId: build.teamId, limit: equipmentLimit },
    )
    if (problem) out.push(problem)
  }
  return out
}
