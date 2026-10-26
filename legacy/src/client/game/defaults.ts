// Defaults and resolvers for the menu flow and the ?test=1 shortcut: aliases (aod, kom, secure, 01),
// legal default rosters, first-legal loadouts, equipment candidates.
import {
  capAwareLoadouts,
  defaultLoadout,
  enumerateLoadouts,
  type LoadoutChoice,
  defaultRosterPicks,
  enumerateRosters,
  loadoutCapProblems,
  resolveLoadout,
  rosterPickProblems,
  validateOperativePicks,
  slotCost,
  validateLoadout,
  validateRoster,
  validateTeamChoices,
  type AbilityData,
  type DataBundle,
  type DatacardData,
  type EquipmentData,
  type Id,
  type KillzoneLayoutData,
  type MissionData,
  type RosterSelection,
  type TeamData,
} from '@/data'
import { defaultEquipmentFor } from '@/engine/bundle'
import { equipmentLimitFor, selectionProblem } from '@/engine/equipment'
import { engineBundle, flattenRoster, type SeatBuild } from './adapter'

function isEquipment(r: unknown): r is EquipmentData {
  return !!r && typeof r === 'object' && 'scope' in r && 'count' in r
}

/** Teams offered in the picker: scaffolded teams (`playable: false` in team.json) stay hidden until complete. */
export function teamList(b: DataBundle): TeamData[] {
  return Object.values(b.teams)
    .filter((t) => t.playable !== false)
    .sort((x, y) => x.name.localeCompare(y.name))
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

/** Layout choice that lets the seed pick one of the official cards. */
export const AUTO_LAYOUT = 'auto'

export function resolveLayout(b: DataBundle, key: string | null | undefined) {
  const list = layoutList(b)
  if (key) {
    const k = key.toLowerCase()
    const num = /^(?:volkus-)?0*(\d+)$/.exec(k)?.[1]
    const hit = list.find((l) => l.id === k || l.id === `kz.${k}` || l.id.endsWith(`-${k}`) || (num !== undefined && l.id.endsWith(`-${num}`)))
    if (hit) return hit
  }
  return list[0]!
}

/** 32-bit FNV-1a, so a seed string rolls the same layout in every browser. */
function seedHash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** The seed's roll for the killzone card: a D6 for the map in the Approved Ops method (one layout per card). */
export function rollLayout(b: DataBundle, seed: string): KillzoneLayoutData {
  const list = layoutList(b)
  return list[seedHash(`layout:${seed}`) % list.length]!
}

/** The layout a session or game really uses: 'auto' is rolled from the seed, any other key must be a layout id. */
export function effectiveLayout(b: DataBundle, key: string, seed: string): KillzoneLayoutData {
  if (key === AUTO_LAYOUT) return rollLayout(b, seed)
  return b.layouts[key] ?? resolveLayout(b, key)
}

/**
 * The team's own default roster (team.json `defaults.roster`) laid into its selection slots: each datacard goes into the
 * first slot that offers it and still has room. Null when the data gives none or the result is not a legal roster.
 */
function dataDefaultRoster(b: DataBundle, team: TeamData): RosterSelection | null {
  const ids = team.defaults?.roster
  if (!ids || ids.length === 0) return null
  const roster: RosterSelection = Object.fromEntries(team.selection.slots.map((s) => [s.id, [] as Id[]]))
  for (const id of ids) {
    const slot = team.selection.slots.find((s) => s.from.includes(id) && slotCost(s, [...roster[s.id]!, id]) <= s.count)
    if (!slot) return null
    roster[slot.id]!.push(id)
  }
  if (flattenRoster(team, roster).join() !== ids.join()) return null
  return validateRoster(team, roster, b.byId as Record<string, DatacardData>).ok ? roster : null
}

/** Does the roster list exactly the team's default operatives in the data's order (so per-entry defaults line up)? */
function isDataDefault(team: TeamData, roster: RosterSelection): boolean {
  const ids = team.defaults?.roster
  return !!ids && ids.length > 0 && flattenRoster(team, roster).join() === ids.join()
}

/**
 * A legal roster: the team's data default (team.json `defaults.roster`, the same list the engine's realSetup plays) when
 * it is legal, else the greedy fill, else the first enumerated shape.
 */
export function defaultRoster(b: DataBundle, team: TeamData): RosterSelection {
  return dataDefaultRoster(b, team) ?? fullRoster(b, team)
}

/** The fullest roster by greedy fill (whole selections first, then halves, repeatable entries pad), else the first enumerated shape. Scenario fixtures use it. */
export function fullRoster(b: DataBundle, team: TeamData): RosterSelection {
  return greedyRoster(b, team) ?? firstEnumerated(b, team)
}

function greedyRoster(b: DataBundle, team: TeamData): RosterSelection | null {
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
  return validateRoster(team, roster, b.byId as Record<string, DatacardData>).ok ? roster : null
}

function firstEnumerated(b: DataBundle, team: TeamData): RosterSelection {
  // M9 batch B: team caps may rule out the first shapes; take the first legal one
  let tried = 0
  for (const shape of enumerateRosters(team)) {
    if (validateRoster(team, shape, b.byId as Record<string, DatacardData>).ok) return shape
    if (++tried > 5000) break
  }
  const first = enumerateRosters(team).next()
  return first.done ? {} : first.value
}

export function datacard(b: DataBundle, id: string): DatacardData {
  return b.byId[id] as DatacardData
}

/** First legal loadouts, kept inside the team's loadout caps; the data's own answers (team.json `defaults.loadouts`) win for its default roster (M9 batch B). */
export function defaultLoadouts(b: DataBundle, team: TeamData, roster: RosterSelection) {
  const auto = capAwareLoadouts(team, flattenRoster(team, roster).map((id) => datacard(b, id)), b.weaponGroups)
  if (!isDataDefault(team, roster)) return auto
  const answers = team.defaults?.loadouts ?? []
  return auto.map((l, i) => (answers[i] && Object.keys(answers[i]!).length > 0 ? answers[i]! : l))
}

/**
 * A random legal loadout for every operative of a build's roster that also keeps the team's loadout caps (Kasrkin's
 * Gunner and Sharpshooter limit, the Corsair blaster / wraithcannon exclusion, the Breachers Gunner errata): each operative
 * takes a random option among those that keep every cap given the ones before it, the first legal one when none does.
 */
export function randomBuildLoadouts(b: DataBundle, team: TeamData, build: Pick<SeatBuild, 'roster'>, rnd: () => number = Math.random): LoadoutChoice[] {
  const carried: Id[][] = []
  return flattenRoster(team, build.roster).map((id) => {
    const card = datacard(b, id)
    const all = enumerateLoadouts(card)
    const fits = (o: LoadoutChoice): Id[] | null => {
      const w = resolveLoadout(card, o, b.weaponGroups)
      return loadoutCapProblems(team, [...carried, w], b.weaponGroups).length === 0 ? w : null
    }
    const legal = all.filter((o) => fits(o) !== null)
    const pool = legal.length > 0 ? legal : all
    const pick = pool.length > 0 ? pool[Math.floor(rnd() * pool.length)]! : defaultLoadout(card)
    carried.push(resolveLoadout(card, pick, b.weaponGroups))
    return pick
  })
}

/** M9 batch B: the first allowed keyword of every operative choice, per operative in flattened roster order. */
export function defaultPicks(b: DataBundle, team: TeamData, roster: RosterSelection): Record<string, string>[] {
  const fromData = isDataDefault(team, roster) ? (team.defaults?.operativePicks ?? []) : []
  // M9 batch C: roster-aware, so a `unique` choice (Boons of Tzeentch) defaults to different picks
  return defaultRosterPicks(team, flattenRoster(team, roster).map((id) => datacard(b, id)), fromData)
}

/** M9 batch B: the equipment limit for this build (the mission's limit plus a Lugger-style roster bonus). */
export function equipmentLimitOf(b: DataBundle, build: SeatBuild, missionLimit: number): number {
  const team = b.teams[build.teamId]
  if (!team) return missionLimit
  return equipmentLimitFor(b.byId as Record<string, { extraEquipment?: number }>, flattenRoster(team, build.roster), missionLimit)
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

/** Default equipment: the team's data defaults (team.json `defaults.equipment`), else the engine's tested list (only entries that exist and are enabled). */
export function defaultEquipment(b: DataBundle, team: TeamData): { equipment: string[]; equipmentChoices: Record<string, string[]> } {
  let ids: string[] = team.defaults?.equipment ? [...team.defaults.equipment] : []
  if (ids.length === 0) {
    try {
      ids = defaultEquipmentFor(team.id, engineBundle())
    } catch {
      ids = []
    }
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
  return buildFor(b, team, defaultRoster(b, team))
}

/** The same build on the fullest greedy roster: the fixed fixtures of the dev scenarios and their tests rely on it. */
export function fullBuild(b: DataBundle, team: TeamData): SeatBuild {
  return buildFor(b, team, fullRoster(b, team))
}

function buildFor(b: DataBundle, team: TeamData, roster: RosterSelection): SeatBuild {
  const build: SeatBuild = { teamId: team.id, roster, loadouts: defaultLoadouts(b, team, roster), ...defaultEquipment(b, team), choices: defaultChoices(b, team) }
  if ((team.operativeChoices ?? []).length > 0) build.picks = defaultPicks(b, team, roster)
  return build
}

/** Reasons a build cannot be fielded; empty when it can. */
export function buildProblems(b: DataBundle, build: SeatBuild, equipmentLimit: number): string[] {
  const team = b.teams[build.teamId]
  if (!team) return [`unknown team ${build.teamId}`]
  const out: string[] = [...validateRoster(team, build.roster, b.byId as Record<string, DatacardData>).reasons]
  const carried: string[][] = []
  const cards = flattenRoster(team, build.roster).map((id) => datacard(b, id))
  const picks = (team.operativeChoices ?? []).length > 0 ? defaultRosterPicks(team, cards, build.picks ?? []) : []
  cards.forEach((card, i) => {
    const problems = validateLoadout(card, build.loadouts[i] ?? {})
    for (const r of problems) out.push(`${card.name}: ${r}`)
    carried.push(problems.length === 0 ? resolveLoadout(card, build.loadouts[i] ?? {}, b.weaponGroups) : [])
    // M9 batch B: per-operative keyword picks (Marks of Chaos); a missing pick takes the first allowed keyword
    if ((team.operativeChoices ?? []).length > 0) out.push(...validateOperativePicks(team, card, picks[i]))
  })
  // M9 batch C: a `unique` choice taken twice across the roster
  out.push(...rosterPickProblems(team, picks))
  out.push(...loadoutCapProblems(team, carried, b.weaponGroups, (w) => (b.byId[w] as { name?: string } | undefined)?.name ?? w))
  out.push(...validateTeamChoices(team, build.choices ?? {}, b.byId as Record<string, AbilityData>))
  equipmentLimit = equipmentLimitOf(b, build, equipmentLimit)
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
