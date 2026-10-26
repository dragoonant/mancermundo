// The data the engine consumes, plus the adapter from src/data records (`bundleFromData`).
// The adapter maps base mm, weapon rules (core.wr.* -> bare names), abilities, gambits and ploys,
// equipment, missions and killzone layouts onto the engine's runtime shapes; it also resolves a
// datacard's loadout tree (sets, profile groups) into the flat weapon-id lists the state stores.
import type {
  AbilityData,
  DataBundle,
  DatacardData,
  KillzoneLayoutData,
  LoadoutSlot,
  MissionData,
  MissionMap,
  TeamData,
  WeaponData,
  WeaponRuleUse,
} from '../data/types'
import type {
  GameData,
  GameSetup,
  Loadout,
  MapDef,
  Polygon,
  RollTarget,
  RosterEntry,
  RuntimeAbility,
  RuntimeDatacard,
  RuntimeEquipment,
  RuntimeGambit,
  RuntimeMission,
  RuntimePloy,
  RuntimeTeam,
  RuntimeWeapon,
  TerrainFeatureDef,
  TerrainPartDef,
  TerrainTrait,
  WeaponRuleRef,
} from './types'

export interface RuntimeLayout {
  id: string
  name: string
  size: { x: number; z: number }
  features: TerrainFeatureDef[]
  /** candidate objective spots per mission map id */
  spots: Record<string, NonNullable<NonNullable<MapDef['meta']>['objectiveSpots']>>
}

export interface EngineBundle {
  dataVersion: string
  datacards: Record<string, RuntimeDatacard>
  weapons: Record<string, RuntimeWeapon>
  abilities: Record<string, RuntimeAbility>
  teams: Record<string, RuntimeTeam>
  gambits: RuntimeGambit[]
  // M2b-game: absent in the synthetic test bundles
  ploys?: Record<string, RuntimePloy>
  equipment?: Record<string, RuntimeEquipment>
  missions?: Record<string, RuntimeMission>
  layouts?: Record<string, RuntimeLayout>
  /** profile group id -> member profile ids */
  weaponGroups?: Record<string, string[]>
  /** datacard id -> loadout slot tree (data shape), for resolveLoadoutChoice */
  loadoutTrees?: Record<string, LoadoutSlot[]>
  /** datacard id -> data fixed weapon refs, before group expansion */
  teamData?: Record<string, TeamData>
}

export function snapshotData(bundle: EngineBundle, datacardIds: Iterable<string>, teamIds: Iterable<string> = []): GameData {
  const datacards: GameData['datacards'] = {}
  const weapons: GameData['weapons'] = {}
  const abilities: GameData['abilities'] = {}
  const teamSet = new Set(teamIds)
  const addWeapon = (w: string) => {
    const def = bundle.weapons[w]
    if (def) weapons[w] = def
  }
  // batch D prep: datacards an operative can only change into (selectable: false) come with their team
  const ids = [...datacardIds]
  for (const c of Object.values(bundle.datacards)) if (c.selectable === false && teamSet.has(c.teamId)) ids.push(c.id)
  for (const id of ids) {
    const card = bundle.datacards[id]
    if (!card || datacards[id]) continue
    datacards[id] = card
    const wIds = [...card.fixedWeapons, ...card.weaponOptions.flatMap((o) => o.from), ...(card.legalLoadouts?.flat() ?? [])]
    for (const w of wIds) addWeapon(w)
    for (const a of [...card.abilities, ...card.uniqueActions]) {
      const def = bundle.abilities[a]
      if (def) abilities[a] = def
    }
  }
  // Team rules, tactics, mission actions and the weapons that equipment grants.
  for (const def of Object.values(bundle.abilities)) {
    if (!def.teamId || teamSet.has(def.teamId)) abilities[def.id] = def
  }
  for (const eq of Object.values(bundle.equipment ?? {})) {
    for (const w of eq.grants?.weapons ?? []) addWeapon(w)
    for (const w of eq.choice?.from ?? []) addWeapon(w)
  }
  const ploys: Record<string, RuntimePloy> = {}
  for (const p of Object.values(bundle.ploys ?? {})) {
    if (!p.team || teamSet.has(p.team)) ploys[p.id] = p
  }
  const equipment: Record<string, RuntimeEquipment> = {}
  for (const e of Object.values(bundle.equipment ?? {})) {
    if (!e.team || teamSet.has(e.team)) equipment[e.id] = e
  }
  const out: GameData = {
    dataVersion: bundle.dataVersion,
    datacards,
    weapons,
    abilities,
    teams: { ...bundle.teams },
    gambits: [...bundle.gambits],
  }
  if (bundle.ploys) out.ploys = ploys
  if (bundle.equipment) out.equipment = equipment
  if (bundle.missions) out.missions = { ...bundle.missions }
  return out
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

function parseTarget(t: string): RollTarget {
  const n = Number.parseInt(t, 10)
  if (!(n >= 2 && n <= 6)) throw new Error(`bad roll target "${t}"`)
  return n as RollTarget
}

/** `core.wr.range` -> `range`, `kom.a.wr-explosive` -> `explosive`. */
export function ruleName(id: string): string {
  return id.replace(/^core\.wr\./, '').replace(/^.*\.wr-/, '')
}

function adaptRule(r: WeaponRuleUse): WeaponRuleRef {
  const out: WeaponRuleRef = { rule: ruleName(r.rule) }
  if (r.x !== undefined) out.x = r.x
  if (r.inches !== undefined) out.inches = r.inches
  if (r.target !== undefined) out.target = parseTarget(r.target)
  if (r.crits !== undefined) out.crits = r.crits
  if (r.only !== undefined) out.only = r.only
  return out
}

function adaptWeapon(w: WeaponData): RuntimeWeapon {
  const out: RuntimeWeapon = {
    id: w.id,
    name: w.profile ? `${w.name} (${w.profile})` : w.name,
    type: w.type,
    atk: w.atk,
    hit: parseTarget(w.hit),
    dmg: { normal: w.dmg.normal, crit: w.dmg.crit },
    rules: w.rules.map(adaptRule),
  }
  if (w.profileGroup) out.profileGroup = w.profileGroup
  if (w.code) out.code = w.code
  return out
}

/** Every `code` name found in an effect tree. */
export function codesIn(effect: unknown, out: string[] = []): string[] {
  if (Array.isArray(effect)) {
    for (const e of effect) codesIn(e, out)
  } else if (effect && typeof effect === 'object') {
    const rec = effect as Record<string, unknown>
    if (typeof rec.code === 'string') out.push(rec.code)
    for (const v of Object.values(rec)) if (v && typeof v === 'object') codesIn(v, out)
  }
  return out
}

function adaptAbility(a: AbilityData): RuntimeAbility {
  const out: RuntimeAbility = { id: a.id, name: a.name, kind: a.kind, text: a.text }
  if (a.ap !== undefined) out.ap = a.ap
  if (a.keywords) out.keywords = [...a.keywords]
  if (a.effect !== undefined) out.effect = a.effect
  if (a.conditions) out.conditions = a.conditions as Record<string, unknown>
  if (a.team) out.teamId = a.team
  if (a.target) out.target = a.target
  if (a.window) out.window = a.window
  if (a.when) out.when = a.when
  if (a.limit) out.limit = a.limit
  if (a.scope) out.scope = a.scope
  if (a.choiceGroup) out.choiceGroup = a.choiceGroup
  const codes = codesIn(a.effect)
  if (codes.length > 0) {
    out.codes = [...new Set(codes)]
    out.code = codes[0]
  }
  return out
}

function expand(ref: string, groups: Record<string, string[]>): string[] {
  return groups[ref] ? [...groups[ref]!] : [ref]
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const [head, ...rest] = items
  return [...combinations(rest, k - 1).map((c) => [head as T, ...c]), ...combinations(rest, k)]
}

type Choice = Record<string, string[]>

function slotChoices(slot: LoadoutSlot): Choice[] {
  if (slot.sets) {
    const out: Choice[] = []
    for (const set of slot.sets) for (const sub of product(set.options ?? [])) out.push({ [slot.id]: [set.id], ...sub })
    return out
  }
  const pick = slot.pick ?? 1
  const min = slot.min ?? pick
  const out: Choice[] = []
  for (let k = min; k <= pick; k++) for (const c of combinations(slot.from ?? [], k)) out.push({ [slot.id]: c })
  return out
}

function product(slots: LoadoutSlot[]): Choice[] {
  let acc: Choice[] = [{}]
  for (const slot of slots) {
    const next: Choice[] = []
    for (const base of acc) for (const c of slotChoices(slot)) next.push({ ...base, ...c })
    acc = next
  }
  return acc
}

function collect(slots: LoadoutSlot[], choice: Choice, out: string[]): void {
  for (const slot of slots) {
    const answer = choice[slot.id] ?? []
    if (slot.sets) {
      const set = slot.sets.find((s) => s.id === answer[0])
      if (!set) continue
      out.push(...(set.fixed ?? []))
      collect(set.options ?? [], choice, out)
    } else out.push(...answer)
  }
}

function checkChoice(slots: LoadoutSlot[], choice: Choice, errors: string[], seen: Set<string>): void {
  for (const slot of slots) {
    seen.add(slot.id)
    const answer = choice[slot.id] ?? []
    if (slot.sets) {
      const set = answer.length === 1 ? slot.sets.find((s) => s.id === answer[0]) : undefined
      if (!set) errors.push(`${slot.id}: choose exactly one of ${slot.sets.map((s) => s.id).join(', ')}`)
      else checkChoice(set.options ?? [], choice, errors, seen)
      continue
    }
    const pick = slot.pick ?? 1
    const min = slot.min ?? pick
    if (answer.length < min || answer.length > pick) errors.push(`${slot.id}: choose ${min === pick ? pick : `${min} to ${pick}`}, got ${answer.length}`)
    if (new Set(answer).size !== answer.length) errors.push(`${slot.id}: the same weapon is picked twice`)
    for (const a of answer) if (!(slot.from ?? []).includes(a)) errors.push(`${slot.id}: "${a}" is not an option`)
  }
}

function adaptDatacard(c: DatacardData, groups: Record<string, string[]>): RuntimeDatacard {
  const fixed = [...new Set(c.weapons.fixed.flatMap((r) => expand(r, groups)))]
  const legal: string[][] = []
  for (const choice of product(c.weapons.options ?? [])) {
    const refs: string[] = []
    collect(c.weapons.options ?? [], choice, refs)
    const ids = [...new Set(refs.flatMap((r) => expand(r, groups)))].filter((id) => !fixed.includes(id))
    if (!legal.some((l) => l.length === ids.length && l.every((x, i) => x === ids[i]))) legal.push(ids)
  }
  const out: RuntimeDatacard = {
    id: c.id,
    name: c.name,
    teamId: c.team,
    apl: c.stats.apl,
    move: c.stats.move,
    save: parseTarget(c.stats.save),
    wounds: c.stats.wounds,
    baseMm: c.base,
    keywords: [...c.keywords],
    fixedWeapons: fixed,
    weaponOptions: [],
    abilities: [...c.abilities],
    uniqueActions: [...c.uniqueActions],
    legalLoadouts: legal,
    figureArchetype: c.figure.archetype,
  }
  if (c.expendable) out.expendable = true
  if (c.nonOperativeForSelection) out.nonOperativeForSelection = true
  if (c.selectable === false) out.selectable = false
  if (c.extraEquipment) out.extraEquipment = c.extraEquipment
  if (c.ovalBase) out.ovalBase = { long: c.ovalBase.long, short: c.ovalBase.short, ...(c.ovalBase.weapons ? { weapons: [...c.ovalBase.weapons] } : {}) }
  return out
}

function adaptTeam(t: TeamData): RuntimeTeam {
  const out: RuntimeTeam = {
    id: t.id,
    name: t.name,
    factionKeyword: t.factionKeyword,
    operatives: t.selection.slots.reduce((n, s) => n + s.count, 0),
    archetypes: [...t.archetypes],
    factionRules: [...t.factionRules],
    ploys: [...t.ploys],
    equipment: [...t.equipment],
  }
  if (t.playable === false) out.playable = false
  if (t.teamChoices) out.teamChoices = t.teamChoices.map((c) => ({ ...c, ...(c.distinctFrom ? { distinctFrom: [...c.distinctFrom] } : {}) }))
  if (t.operativeChoices) out.operativeChoices = t.operativeChoices.map((c) => ({ ...c, keywords: [...c.keywords], ...(c.exclude ? { exclude: c.exclude.map((e) => ({ datacards: [...e.datacards], keywords: [...e.keywords] })) } : {}), ...(c.distinctFrom ? { distinctFrom: [...c.distinctFrom] } : {}), ...(c.labels ? { labels: { ...c.labels } } : {}) }))
  return out
}

function adaptLayout(l: KillzoneLayoutData): RuntimeLayout {
  const features: TerrainFeatureDef[] = l.pieces.map((p) => ({
    id: p.id,
    name: p.model,
    parts: p.parts.map((pt): TerrainPartDef => {
      const door = pt.traits.includes('accessible') && pt.id.includes('door')
      const part: TerrainPartDef = {
        id: `${p.id}.${pt.id}`,
        footprint: pt.footprint.map((v) => ({ x: v.x, z: v.z })),
        height: pt.height,
        traits: [...pt.traits] as TerrainTrait[],
      }
      if (pt.vantageFloors) part.vantageFloors = [...pt.vantageFloors]
      if (pt.thickness !== undefined) part.thickness = pt.thickness
      // R-13.2: doors are ignored when judging control range visibility.
      if (door) part.crTransparent = true
      return part
    }),
  }))
  const spots: RuntimeLayout['spots'] = {}
  for (const m of l.maps) spots[m.id] = m.objectiveSpots
  return { id: l.id, name: l.name, size: { ...l.size }, features, spots }
}

/** Build the engine bundle from the validated data bundle (`loadBundle()`). */
export function bundleFromData(db: DataBundle): EngineBundle {
  const datacards: Record<string, RuntimeDatacard> = {}
  const weapons: Record<string, RuntimeWeapon> = {}
  const abilities: Record<string, RuntimeAbility> = {}
  const ploys: Record<string, RuntimePloy> = {}
  const equipment: Record<string, RuntimeEquipment> = {}
  const layouts: Record<string, RuntimeLayout> = {}
  const loadoutTrees: Record<string, LoadoutSlot[]> = {}
  const teams: Record<string, RuntimeTeam> = {}
  const gambits: RuntimeGambit[] = []
  for (const rec of Object.values(db.byId)) {
    const r = rec as { id: string }
    if ('stats' in rec && 'figure' in rec) {
      const c = rec as DatacardData
      datacards[c.id] = adaptDatacard(c, db.weaponGroups)
      loadoutTrees[c.id] = c.weapons.options ?? []
    } else if ('atk' in rec && 'hit' in rec) {
      weapons[r.id] = adaptWeapon(rec as WeaponData)
    } else if ('kind' in rec && 'text' in rec && 'name' in rec && !('scope' in rec && 'count' in rec)) {
      abilities[r.id] = adaptAbility(rec as AbilityData)
    } else if ('type' in rec && 'cost' in rec && 'window' in rec) {
      const p = rec as RuntimePloy
      ploys[p.id] = p
      if (p.type === 'strategy') gambits.push({ id: p.id, name: p.name, cost: p.cost, ...(p.team ? { teamId: p.team } : {}) })
    } else if ('scope' in rec && 'count' in rec) {
      equipment[r.id] = rec as RuntimeEquipment
    }
  }
  for (const t of Object.values(db.teams)) {
    teams[t.id] = adaptTeam(t)
    if (t.defaults) TEAM_DEFAULTS[t.id] = t.defaults
  }
  for (const l of Object.values(db.layouts)) layouts[l.id] = adaptLayout(l)
  const missions: Record<string, RuntimeMission> = {}
  for (const m of Object.values(db.missions)) missions[m.id] = m
  return {
    dataVersion: db.dataVersion,
    datacards,
    weapons,
    abilities,
    teams,
    gambits,
    ploys,
    equipment,
    missions,
    layouts,
    weaponGroups: { ...db.weaponGroups },
    loadoutTrees,
    teamData: { ...db.teams },
  }
}

// ---------------------------------------------------------------------------
// Loadouts and default rosters
// ---------------------------------------------------------------------------

/** Reasons a loadout choice (keyed by slot id) is illegal for a datacard; empty when legal. */
export function validateLoadoutChoice(bundle: EngineBundle, datacardId: string, choice: Record<string, string[]>): string[] {
  const tree = bundle.loadoutTrees?.[datacardId]
  if (!tree) return [`${datacardId}: no loadout tree (synthetic datacard)`]
  const errors: string[] = []
  const seen = new Set<string>()
  checkChoice(tree, choice, errors, seen)
  for (const k of Object.keys(choice)) if (!seen.has(k)) errors.push(`${k}: not a slot of ${datacardId} for the chosen sets`)
  return errors
}

/** Resolve a LoadoutChoice into the chosen weapon profile ids (groups expanded, fixed weapons excluded). Throws when illegal. */
export function resolveLoadoutChoice(bundle: EngineBundle, datacardId: string, choice: Record<string, string[]>): Loadout {
  const errors = validateLoadoutChoice(bundle, datacardId, choice)
  if (errors.length > 0) throw new Error(`illegal loadout for ${datacardId}: ${errors.join('; ')}`)
  const card = bundle.datacards[datacardId]!
  const refs: string[] = []
  collect(bundle.loadoutTrees![datacardId]!, choice, refs)
  const groups = bundle.weaponGroups ?? {}
  const ids = [...new Set(refs.flatMap((r) => expand(r, groups)))].filter((id) => !card.fixedWeapons.includes(id))
  return { weaponIds: ids }
}

/** Every LoadoutChoice a datacard allows. */
export function enumerateLoadoutChoices(bundle: EngineBundle, datacardId: string): Record<string, string[]>[] {
  return product(bundle.loadoutTrees?.[datacardId] ?? [])
}

/** The first legal loadout of a datacard. */
export function defaultLoadoutFor(bundle: EngineBundle, datacardId: string): Loadout {
  const card = bundle.datacards[datacardId]!
  return { weaponIds: [...(card.legalLoadouts?.[0] ?? [])] }
}

// Default rosters, team picks and equipment live in each team's data (team.json `defaults`), so a new team
// needs no edit here. bundleFromData records them; the helpers below read the bundle when one is given and
// otherwise the most recently adapted bundle (all bundles come from the same static data).
const TEAM_DEFAULTS: Record<string, NonNullable<TeamData['defaults']>> = {}

function defaultsOf(teamId: string, bundle?: EngineBundle): NonNullable<TeamData['defaults']> | undefined {
  return bundle?.teamData?.[teamId]?.defaults ?? TEAM_DEFAULTS[teamId]
}

/** Teams whose data is complete (`playable` is not false); scaffolded teams are left out of pickers, sims and the bench. */
export function playableTeams(bundle: EngineBundle): string[] {
  return Object.values(bundle.teams)
    .filter((t) => t.playable !== false)
    .map((t) => t.id)
    .sort()
}

const DEFAULT_PICKS: Record<string, string[]> = {
  'core.e.utility-grenades': ['core.a.smoke-grenade', 'core.a.stun-grenade'],
  'core.e.explosive-grenades': ['core.w.frag-grenade', 'core.w.krak-grenade'],
}

/** The default roster of a real team: one legal operative list with each datacard's first legal loadout. */
export function defaultRosterFor(bundle: EngineBundle, teamId: string): RosterEntry[] {
  const ids = defaultsOf(teamId, bundle)?.roster
  if (!ids) throw new Error(`no default roster for team ${teamId}`)
  const d = defaultsOf(teamId, bundle)
  return ids.map((id, i): RosterEntry => {
    // M9 batch B: team.json defaults may give a loadout answer (loadout caps) and operative picks per entry
    const answer = d?.loadouts?.[i]
    const entry: RosterEntry = { datacardId: id, loadout: answer && Object.keys(answer).length > 0 ? resolveLoadoutChoice(bundle, id, answer) : defaultLoadoutFor(bundle, id) }
    const picks = d?.operativePicks?.[i]
    if (picks && Object.keys(picks).length > 0) entry.picks = { ...picks }
    return entry
  })
}

export function defaultTeamChoicesFor(teamId: string, bundle?: EngineBundle): Record<string, string> {
  return { ...(defaultsOf(teamId, bundle)?.teamChoices ?? {}) }
}

export function defaultEquipmentFor(teamId: string, bundle?: EngineBundle): string[] {
  return [...(defaultsOf(teamId, bundle)?.equipment ?? [])]
}

/** The terrain of a layout as a MapDef with no drop zones yet (the mission map supplies them). */
export function layoutMap(bundle: EngineBundle, layoutId: string): MapDef {
  const l = bundle.layouts?.[layoutId]
  if (!l) throw new Error(`unknown layout ${layoutId}`)
  return {
    id: l.id,
    size: { ...l.size },
    dropZones: [],
    features: l.features,
    spotsByMap: l.spots,
  }
}

function poly(p: { x: number; z: number }[]): Polygon {
  return p.map((v) => ({ x: v.x, z: v.z }))
}

/** Compose the playable map: layout terrain plus the mission map's drop zones, territories and centreline. */
export function composeMissionMap(base: MapDef, mm: MissionMap): MapDef {
  const spots = base.spotsByMap?.[mm.id]
  return {
    id: base.id,
    size: base.size,
    features: base.features,
    dropZones: [
      { id: `${mm.id}.a`, polygon: poly(mm.dropZones.A), territory: poly(mm.territories.A) },
      { id: `${mm.id}.b`, polygon: poly(mm.dropZones.B), territory: poly(mm.territories.B) },
    ],
    ...(base.spotsByMap ? { spotsByMap: base.spotsByMap } : {}),
    meta: {
      missionMapId: mm.id,
      centreline: { a: { ...mm.centreline.a }, b: { ...mm.centreline.b } },
      neutralEdges: mm.neutralEdges.map((s) => ({ a: { ...s.a }, b: { ...s.b } })),
      centrePoint: { ...mm.centrePoint },
      territories: [poly(mm.territories.A), poly(mm.territories.B)],
      ...(spots ? { objectiveSpots: spots } : {}),
    },
  }
}

/** A mission map by id, from the mission record. */
export function missionMap(mission: MissionData, mapId: string): MissionMap {
  const m = mission.maps.find((x) => x.id === mapId)
  if (!m) throw new Error(`mission ${mission.id} has no map ${mapId}`)
  return m
}

export interface RealSetupOptions {
  teams?: [string, string]
  layoutId?: string
  /** omit to let the engine roll them in the setup */
  missionId?: string
  mapId?: string
  autoObjectives?: boolean
  autoEquipment?: boolean
  rules?: GameSetup['rules']
}

/** A complete GameSetup for two real teams with default rosters, tactics, equipment and grenade picks. */
export function realSetup(bundle: EngineBundle, opts: RealSetupOptions = {}): GameSetup {
  const [ta, tb] = opts.teams ?? ['angels-of-death', 'kommandos']
  const layoutId = opts.layoutId ?? 'kz.volkus-ao25-1'
  const picks = (teamId: string): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const e of defaultEquipmentFor(teamId, bundle)) if (DEFAULT_PICKS[e]) out[e] = [...DEFAULT_PICKS[e]!]
    return out
  }
  const mission: NonNullable<GameSetup['mission']> = {}
  if (opts.missionId) mission.missionId = opts.missionId
  // An official card is terrain plus map: unless the caller names a map, play the one the layout lists.
  const ownMaps = Object.keys(bundle.layouts?.[layoutId]?.spots ?? {})
  if (opts.mapId) mission.mapId = opts.mapId
  else if (ownMaps.length === 1) mission.mapId = ownMaps[0]!
  const setup: GameSetup = {
    teams: { A: ta, B: tb },
    rosters: { A: defaultRosterFor(bundle, ta), B: defaultRosterFor(bundle, tb) },
    equipment: { A: defaultEquipmentFor(ta, bundle), B: defaultEquipmentFor(tb, bundle) },
    equipmentChoices: { A: picks(ta), B: picks(tb) },
    teamChoices: { A: defaultTeamChoicesFor(ta, bundle), B: defaultTeamChoicesFor(tb, bundle) },
    map: layoutMap(bundle, layoutId),
    mission,
  }
  if (opts.autoObjectives) setup.autoObjectives = true
  if (opts.autoEquipment) setup.autoEquipment = true
  if (opts.rules) setup.rules = opts.rules
  return setup
}
