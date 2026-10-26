/**
 * Build-time data validation (node only; never imported by the client bundle).
 * Used by tools/validate-data.ts and tests/data/*.test.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import type {
  AbilityData,
  DataRecord,
  DatacardData,
  EffectList,
  EquipmentData,
  Id,
  KillzoneLayoutData,
  LoadoutSlot,
  MissionData,
  MissionMap,
  ObjectiveConstraints,
  Polygon,
  TeamData,
  Vec2,
  WeaponData,
  WeaponRuleData,
  WeaponRuleUse,
} from './types'
import { MANIFEST, SCHEMA_NAMES } from './manifest'
import { TYPE_OF_SCHEMA, buildIndex, checkRefs, recordCodes, type RecordIndex, type RecordType } from './refs'
import { defaultLoadout, enumerateLoadouts, resolveLoadout, validateLoadout } from './loadout'
import { defaultRosterPicks, enumerateRosters, loadoutCapProblems, rosterPickProblems, teamCapProblems, validateOperativePicks, validateRoster } from './roster'
import { dist, distToPolygon, distToPolygonBoundary, pointInPolygon, polygonArea, polygonDistance, polygonSegmentDistance, segDist } from './geometry'

const DATA_ROOT = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(DATA_ROOT, '../../docs/spec/schemas')
const MIRROR_DIR = path.join(DATA_ROOT, 'schema')

/**
 * The six Approved Ops 2025 killzone cards (Killzone: Volkus, Maps 1 to 6) are official: where a piece, a drop zone edge or
 * a marker lands is the card's call, not ours. Our own placement clearances (lane minimum, drop zone edge clearance, marker
 * clearance) are therefore not applied to them, and each card lists only the one mission map it is drawn for. Everything else
 * (board bounds, footprints, objective setup constraints) still applies.
 */
export const isOfficialCard = (l: { id: string }): boolean => l.id.startsWith('kz.volkus-ao25-')

/** Layout rules (inches). */
export const LAYOUT_RULES = {
  board: { minX: -15, maxX: 15, minZ: -11, maxZ: 11 },
  /** Minimum clear lane between two different terrain pieces. */
  minPieceGap: 1.5,
  /** No terrain part within this distance of a drop zone edge (the board boundary is not a drop zone edge). */
  dropZoneEdgeClear: 1,
  /** An objective marker centre must be this far from any terrain footprint. */
  spotClear: 1,
}

export interface HookUse {
  name: string
  usedBy: string[]
}

export interface ValidationResult {
  errors: string[]
  files: number
  records: number
  hooks: HookUse[]
  index: RecordIndex
}

export interface ValidateOptions {
  /**
   * Kept for callers: the code-hook list used to be a generated src/data/code-hooks.json; it is now derived
   * from the data at load time (src/data/index.ts CODE_HOOKS), so every mode is the same and nothing is written.
   */
  hooksFile?: 'write' | 'check' | 'skip'
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))

function listJson(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listJson(full, base))
    else if (entry.name.endsWith('.json')) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

// ------------------------------------------------------------------ weapon rules
type RuleDef = { param: 'none' | 'inches' | 'count' | 'target'; critsVariant?: boolean; distanceVariant?: boolean; moveRestriction?: boolean }

function checkRuleUse(use: WeaponRuleUse, defs: Record<Id, RuleDef>, at: string, errors: string[]): void {
  const def = defs[use.rule]
  if (!def) return // dangling refs are reported elsewhere
  const has = (v: unknown) => v !== undefined
  const bad = (m: string) => errors.push(`${at}: ${use.rule} ${m}`)
  if (def.param === 'none' && (has(use.x) || has(use.inches) || has(use.target))) bad('takes no parameter')
  if (def.param === 'count') {
    if (!has(use.x)) bad('needs x')
    if (has(use.inches) && !def.distanceVariant) bad('does not take a distance')
    if (has(use.target)) bad('takes no target')
  }
  if (def.param === 'inches') {
    if (!has(use.inches)) bad('needs inches')
    if (has(use.x) || has(use.target)) bad('takes only inches')
  }
  if (def.param === 'target') {
    if (!has(use.target)) bad('needs a target (for example 5+)')
    if (has(use.x) || has(use.inches)) bad('takes only a target')
  }
  if (use.crits && !def.critsVariant) bad('has no Crits variant')
  if (use.only && !def.moveRestriction) bad('cannot name an allowed move')
}

function effectList(e: EffectList | undefined) {
  return e === undefined ? [] : Array.isArray(e) ? e : [e]
}

// ------------------------------------------------------------------ main
export function validateAll(options: ValidateOptions = {}): ValidationResult {
  const errors: string[] = []
  const hooksMode = options.hooksFile ?? 'check'

  // 1. schemas (canonical copy in docs/spec/schemas, mirror in src/data/schema)
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true })
  for (const name of SCHEMA_NAMES) {
    const canonical = path.join(SCHEMA_DIR, `${name}.schema.json`)
    const mirror = path.join(MIRROR_DIR, `${name}.schema.json`)
    if (!fs.existsSync(canonical)) {
      errors.push(`docs/spec/schemas/${name}.schema.json: missing`)
      continue
    }
    const text = fs.readFileSync(canonical, 'utf8')
    if (!fs.existsSync(mirror)) errors.push(`src/data/schema/${name}.schema.json: missing mirror`)
    else if (fs.readFileSync(mirror, 'utf8').replace(/\r\n/g, '\n') !== text.replace(/\r\n/g, '\n')) {
      errors.push(`src/data/schema/${name}.schema.json: differs from docs/spec/schemas (copy it over)`)
    }
    try {
      ajv.addSchema(JSON.parse(text))
    } catch (e) {
      errors.push(`docs/spec/schemas/${name}.schema.json: ${(e as Error).message}`)
    }
  }

  // 2. orphan files
  const known = new Set(MANIFEST.map((m) => m.path))
  for (const rel of listJson(DATA_ROOT)) {
    if (rel.startsWith('schema/') || rel === 'code-hooks.json') continue
    if (!known.has(rel)) errors.push(`src/data/${rel}: not listed in src/data/manifest.ts`)
  }

  // 3. parse and schema-validate every file
  const parsed: { path: string; type: RecordType; records: DataRecord[] }[] = []
  let recordCount = 0
  for (const m of MANIFEST) {
    const file = path.join(DATA_ROOT, m.path)
    if (!fs.existsSync(file)) {
      errors.push(`src/data/${m.path}: missing`)
      continue
    }
    let data: unknown
    try {
      data = readJson(file)
    } catch (e) {
      errors.push(`src/data/${m.path}: invalid JSON (${(e as Error).message})`)
      continue
    }
    const id = `https://mancermundo.dev/schemas/${m.schema}.schema.json`
    let validate
    try {
      validate = m.array ? ajv.compile({ type: 'array', items: { $ref: id } }) : ajv.getSchema(id)
    } catch (e) {
      errors.push(`src/data/${m.path}: schema ${m.schema} does not compile (${(e as Error).message})`)
      continue
    }
    if (!validate) {
      errors.push(`src/data/${m.path}: schema ${m.schema} not loaded`)
      continue
    }
    if (!validate(data)) {
      for (const err of validate.errors ?? []) {
        const extra = err.params && 'additionalProperty' in err.params ? ` "${String(err.params.additionalProperty)}"` : ''
        errors.push(`src/data/${m.path}${err.instancePath}: ${err.message ?? 'invalid'}${extra}`)
      }
      continue
    }
    const records = (m.array ? data : [data]) as DataRecord[]
    recordCount += records.length
    parsed.push({ path: `src/data/${m.path}`, type: TYPE_OF_SCHEMA[m.schema], records })
  }

  const index = buildIndex(parsed)
  errors.push(...index.errors, ...checkRefs(index))

  const ofType = <T>(type: string): T[] => Object.entries(index.byId).filter(([id]) => index.types[id] === type).map(([, r]) => r as T)
  const where = (id: Id) => index.files[id] ?? id

  // 4. weapon rules known and used with the right parameter
  const ruleDefs: Record<Id, RuleDef> = {}
  for (const r of ofType<WeaponRuleData>('weaponRule')) ruleDefs[r.id] = r
  for (const a of ofType<AbilityData>('ability')) if (a.kind === 'weaponRule' && a.weaponRule) ruleDefs[a.id] = a.weaponRule
  const weapons = ofType<WeaponData>('weapon')
  for (const w of weapons) w.rules.forEach((u, i) => checkRuleUse(u, ruleDefs, `${where(w.id)}: ${w.id}.rules[${i}]`, errors))
  for (const rec of Object.values(index.byId)) {
    const e = (rec as { effect?: EffectList }).effect
    effectList(e).forEach((x, i) => {
      if (x.grantWeaponRule) checkRuleUse(x.grantWeaponRule, ruleDefs, `${where((rec as { id: Id }).id)}: ${(rec as { id: Id }).id}.effect[${i}].grantWeaponRule`, errors)
    })
  }
  const groupNames: Record<Id, string> = {}
  for (const w of weapons) {
    if (!w.profileGroup) continue
    groupNames[w.profileGroup] ??= w.name
    if (groupNames[w.profileGroup] !== w.name) errors.push(`${where(w.id)}: ${w.id} is in group ${w.profileGroup} but has a different name`)
  }

  // 5. datacards: loadouts, figures, weapon usage
  const datacards = ofType<DatacardData>('datacard')
  const usedWeapons = new Set<Id>()
  const figures = new Set<string>()
  const slotIds = (slots: LoadoutSlot[] | undefined, seen: Set<string>, id: Id) => {
    for (const s of slots ?? []) {
      if (seen.has(s.id)) errors.push(`${where(id)}: ${id} reuses loadout slot id "${s.id}"`)
      seen.add(s.id)
      for (const set of s.sets ?? []) slotIds(set.options, seen, id)
    }
  }
  for (const d of datacards) {
    const fig = `${d.figure.archetype}/${d.figure.variant ?? ''}`
    if (figures.has(fig)) errors.push(`${where(d.id)}: ${d.id} reuses figure ${fig}`)
    figures.add(fig)
    slotIds(d.weapons.options, new Set(), d.id)
    const loadouts = enumerateLoadouts(d)
    if (loadouts.length === 0) errors.push(`${where(d.id)}: ${d.id} has no legal loadout`)
    const def = defaultLoadout(d)
    for (const reason of validateLoadout(d, def)) errors.push(`${where(d.id)}: ${d.id} default loadout: ${reason}`)
    for (const l of loadouts) {
      for (const reason of validateLoadout(d, l)) errors.push(`${where(d.id)}: ${d.id} loadout ${JSON.stringify(l)}: ${reason}`)
      for (const wid of resolveLoadout(d, l, index.groups)) {
        usedWeapons.add(wid)
        if (index.types[wid] !== 'weapon') errors.push(`${where(d.id)}: ${d.id} loadout resolves to unknown weapon ${wid}`)
      }
    }
  }
  for (const e of ofType<EquipmentData>('equipment')) {
    for (const wid of e.grants?.weapons ?? []) usedWeapons.add(wid)
    for (const wid of e.choice?.from ?? []) usedWeapons.add(wid)
  }
  for (const w of weapons) if (!usedWeapons.has(w.id)) errors.push(`${where(w.id)}: weapon ${w.id} is not used by any datacard or equipment`)

  // 6. teams
  const teams = ofType<TeamData>('team')
  const abilities = ofType<AbilityData>('ability')
  for (const t of teams) {
    const cards = datacards.filter((d) => d.team === t.id)
    const inSlots = new Set(t.selection.slots.flatMap((s) => s.from))
    // batch D prep: a `selectable: false` card is reached only by changing datacard mid-battle, never from a slot
    for (const c of cards) if (!inSlots.has(c.id) && c.selectable !== false) errors.push(`${where(t.id)}: datacard ${c.id} is in no selection slot of ${t.id}`)
    for (const c of cards) if (inSlots.has(c.id) && c.selectable === false) errors.push(`${where(t.id)}: datacard ${c.id} is selectable: false but sits in a selection slot`)
    for (const s of t.selection.slots) {
      for (const id of s.from) if (index.byId[id] && (index.byId[id] as DatacardData).team !== t.id) errors.push(`${where(t.id)}: slot ${s.id} lists ${id} from another team`)
      for (const id of s.repeatable ?? []) if (!s.from.includes(id)) errors.push(`${where(t.id)}: slot ${s.id} repeatable ${id} is not in from`)
      for (const id of s.halfSelections ?? []) if (!s.from.includes(id)) errors.push(`${where(t.id)}: slot ${s.id} halfSelections ${id} is not in from`)
    }
    const byId = Object.fromEntries(cards.map((c) => [c.id, c])) as Record<Id, DatacardData>
    // M9 batch B: team caps (keyword caps over every slot) can rule out enumerated shapes; find the first legal one
    let legal = false
    let tried = 0
    let firstReasons: string[] = []
    for (const shape of enumerateRosters(t)) {
      const check = validateRoster(t, shape, byId)
      if (check.ok) {
        legal = true
        break
      }
      if (tried === 0) firstReasons = check.reasons
      if (++tried > 5000) break
    }
    if (!legal) errors.push(`${where(t.id)}: team ${t.id} has no legal roster${firstReasons.length ? ` (${firstReasons.join('; ')})` : ''}`)
    // M9 batch B: the selection caps and operative choices name real things
    for (const c of t.selection.caps ?? []) for (const id of c.from ?? []) if (!byId[id]) errors.push(`${where(t.id)}: selection cap lists ${id}, not a datacard of ${t.id}`)
    for (const c of t.selection.loadoutCaps ?? []) for (const id of c.weapons) if (!index.byId[id] && !index.groups[id]) errors.push(`${where(t.id)}: loadout cap lists unknown weapon ${id}`)
    for (const oc of t.operativeChoices ?? []) for (const e of oc.exclude ?? []) for (const id of e.datacards) if (!byId[id]) errors.push(`${where(t.id)}: operative choice ${oc.id} excludes unknown datacard ${id}`)
    // batch C shared: display labels name picks the choice offers
    for (const oc of t.operativeChoices ?? []) for (const k of Object.keys(oc.labels ?? {})) if (!oc.keywords.includes(k)) errors.push(`${where(t.id)}: operative choice ${oc.id} labels unknown pick ${k}`)
    // M9 batch B: the default roster honours the team caps, loadout caps and operative choices
    const d = t.defaults
    if (d?.roster) {
      const defCards = d.roster.map((id) => byId[id]).filter((c): c is DatacardData => !!c)
      for (const r of teamCapProblems(t, d.roster, byId)) errors.push(`${where(t.id)}: default roster: ${r}`)
      if (d.loadouts && d.loadouts.length > d.roster.length) errors.push(`${where(t.id)}: defaults.loadouts is longer than defaults.roster`)
      if (d.operativePicks && d.operativePicks.length > d.roster.length) errors.push(`${where(t.id)}: defaults.operativePicks is longer than defaults.roster`)
      const carried = defCards.map((c, i) => {
        const answer = d.loadouts?.[i]
        const choice = answer && Object.keys(answer).length > 0 ? answer : defaultLoadout(c)
        for (const r of validateLoadout(c, choice)) errors.push(`${where(t.id)}: default loadout ${i} (${c.id}): ${r}`)
        return resolveLoadout(c, choice, index.groups)
      })
      for (const r of loadoutCapProblems(t, carried, index.groups)) errors.push(`${where(t.id)}: default loadouts: ${r}`)
      // M9 batch C: roster-aware defaults (unique choices kept apart), then the roster-wide pick check
      const allPicks = defaultRosterPicks(t, defCards, d.operativePicks ?? [])
      defCards.forEach((c, i) => {
        for (const r of validateOperativePicks(t, c, allPicks[i])) errors.push(`${where(t.id)}: default picks: ${r}`)
      })
      for (const r of rosterPickProblems(t, allPicks)) errors.push(`${where(t.id)}: default picks: ${r}`)
    }
    for (const r of t.selection.requires ?? []) {
      for (const id of [r.id, ...r.needs]) if (!byId[id]) errors.push(`${where(t.id)}: roster requirement lists ${id}, not a datacard of ${t.id}`)
    }
    for (const tc of t.teamChoices ?? []) {
      const offered = abilities.filter((a) => a.choiceGroup === tc.group && a.team === t.id)
      if (offered.length < ((tc.distinctFrom?.length ?? 0) > 0 ? 2 : 1)) errors.push(`${where(t.id)}: team choice ${tc.id} has too few ${tc.group} abilities (${offered.length})`)
      for (const other of tc.distinctFrom ?? []) if (!(t.teamChoices ?? []).some((x) => x.id === other)) errors.push(`${where(t.id)}: team choice ${tc.id} distinctFrom unknown ${other}`)
    }
    for (const id of [...t.ploys, ...t.equipment, ...t.factionRules]) {
      const rec = index.byId[id] as { team?: Id } | undefined
      if (rec && rec.team !== t.id) errors.push(`${where(t.id)}: ${id} is listed by ${t.id} but belongs to ${rec.team ?? 'no team'}`)
    }
  }

  // 7. missions
  const missions = ofType<MissionData>('mission')
  const board = LAYOUT_RULES.board
  const inBoard = (p: Vec2, slack = 1e-9) => p.x >= board.minX - slack && p.x <= board.maxX + slack && p.z >= board.minZ - slack && p.z <= board.maxZ + slack
  for (const m of missions) {
    const f = where(m.id)
    for (const [n, row] of Object.entries(m.killOp.gradeTable)) {
      const N = Number(n)
      for (let i = 1; i < row.length; i++) if (row[i] < row[i - 1]) errors.push(`${f}: kill grade row ${n} is not non-decreasing`)
      if (row[row.length - 1] !== N) errors.push(`${f}: kill grade row ${n} must end at ${n} (grade 5 is every operative)`)
    }
    const ids = new Set<string>()
    const rolls = new Set<number>()
    for (const map of m.maps) {
      if (ids.has(map.id)) errors.push(`${f}: duplicate map id ${map.id}`)
      ids.add(map.id)
      for (let r = map.mapRoll.min; r <= map.mapRoll.max; r++) {
        if (rolls.has(r)) errors.push(`${f}: map rolls overlap at ${r}`)
        rolls.add(r)
      }
      const polys: [string, Polygon][] = [
        ['dropZones.A', map.dropZones.A],
        ['dropZones.B', map.dropZones.B],
        ['territories.A', map.territories.A],
        ['territories.B', map.territories.B],
      ]
      for (const [n, poly] of polys) {
        if (polygonArea(poly) <= 0) errors.push(`${f}: ${map.id}.${n} has no area`)
        if (!poly.every((p) => inBoard(p))) errors.push(`${f}: ${map.id}.${n} leaves the board`)
      }
      for (const seat of ['A', 'B'] as const) {
        const dz = map.dropZones[seat]
        const terr = map.territories[seat]
        if (!dz.every((p) => pointInPolygon(p, terr) || distToPolygonBoundary(p, terr) < 1e-9)) errors.push(`${f}: ${map.id} drop zone ${seat} is not inside its territory`)
      }
    }
    for (let r = 1; r <= 6; r++) if (!rolls.has(r)) errors.push(`${f}: no map for D6 roll ${r}`)
    if (new Set(m.scoring.map((s) => s.id)).size !== m.scoring.length) errors.push(`${f}: duplicate scoring rule ids`)
  }
  const missionMaps = new Map<string, MissionMap[]>()
  for (const m of missions) for (const map of m.maps) missionMaps.set(map.id, [...(missionMaps.get(map.id) ?? []), map])

  // 8. killzone layouts
  const layouts = ofType<KillzoneLayoutData>('layout')
  for (const l of layouts) checkLayout(l, missions, missionMaps, where(l.id), errors)

  // 9. code hooks
  const usage = new Map<string, string[]>()
  for (const [id, rec] of Object.entries(index.byId)) {
    for (const name of recordCodes(rec, index.types[id])) usage.set(name, [...(usage.get(name) ?? []), id])
  }
  const hooks: HookUse[] = [...usage.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, usedBy]) => ({ name, usedBy: [...new Set(usedBy)].sort() }))
  void hooksMode

  return { errors, files: MANIFEST.length, records: recordCount, hooks, index }
}

// ------------------------------------------------------------------ layouts
function checkLayout(l: KillzoneLayoutData, missions: MissionData[], missionMaps: Map<string, MissionMap[]>, file: string, errors: string[]): void {
  const board = LAYOUT_RULES.board
  const err = (m: string) => errors.push(`${file}: ${l.id}: ${m}`)
  if (l.size.x !== board.maxX - board.minX || l.size.z !== board.maxZ - board.minZ) err(`size must be ${board.maxX - board.minX} x ${board.maxZ - board.minZ}`)
  const pieceIds = new Set<string>()
  for (const p of l.pieces) {
    if (pieceIds.has(p.id)) err(`duplicate piece id ${p.id}`)
    pieceIds.add(p.id)
    const partIds = new Set<string>()
    for (const q of p.parts) {
      if (partIds.has(q.id)) err(`${p.id}: duplicate part id ${q.id}`)
      partIds.add(q.id)
      if (polygonArea(q.footprint) < 0.05) err(`${p.id}.${q.id}: footprint has no area`)
      for (const v of q.footprint) {
        if (v.x < board.minX || v.x > board.maxX || v.z < board.minZ || v.z > board.maxZ) {
          err(`${p.id}.${q.id}: footprint leaves the board at (${v.x}, ${v.z})`)
          break
        }
      }
      const vantage = q.traits.includes('vantage')
      if (vantage && !q.vantageFloors) err(`${p.id}.${q.id}: Vantage part needs vantageFloors`)
      if (!vantage && q.vantageFloors) err(`${p.id}.${q.id}: vantageFloors on a part that is not Vantage`)
      for (const h of q.vantageFloors ?? []) if (h > q.height) err(`${p.id}.${q.id}: vantage floor ${h} is above the part height`)
    }
  }
  // lanes between pieces (official cards keep the card's own gaps)
  const official = isOfficialCard(l)
  if (official && l.maps.length !== 1) err(`an official card lists exactly one mission map (found ${l.maps.length})`)
  for (let i = 0; i < l.pieces.length && !official; i++) {
    for (let j = i + 1; j < l.pieces.length; j++) {
      let d = Infinity
      for (const a of l.pieces[i].parts) for (const b of l.pieces[j].parts) d = Math.min(d, polygonDistance(a.footprint, b.footprint))
      if (d < LAYOUT_RULES.minPieceGap - 1e-9) err(`${l.pieces[i].id} and ${l.pieces[j].id} are ${d.toFixed(2)} apart (lane minimum ${LAYOUT_RULES.minPieceGap})`)
    }
  }
  // maps
  const layoutMapIds = new Set(l.maps.map((m) => m.id))
  if (!official) for (const id of missionMaps.keys()) if (!layoutMapIds.has(id)) err(`no entry for mission map ${id}`)
  for (const lm of l.maps) {
    const defs = missionMaps.get(lm.id)
    if (!defs) {
      err(`map ${lm.id} is not defined by any mission`)
      continue
    }
    for (const map of defs) {
      // drop zone edge clearance
      for (const seat of ['A', 'B'] as const) {
        const poly = map.dropZones[seat]
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]
          const b = poly[(i + 1) % poly.length]
          const onBoard = (a.x === b.x && Math.abs(a.x) === board.maxX) || (a.z === b.z && Math.abs(a.z) === board.maxZ)
          if (onBoard) continue
          for (const p of official ? [] : l.pieces) {
            for (const q of p.parts) {
              const d = polygonSegmentDistance(q.footprint, a, b)
              if (d <= LAYOUT_RULES.dropZoneEdgeClear) err(`${p.id}.${q.id} is ${d.toFixed(2)} from the ${lm.id} drop zone ${seat} edge (must be more than ${LAYOUT_RULES.dropZoneEdgeClear})`)
            }
          }
        }
      }
      for (const mission of missions.filter((m) => m.maps.includes(map))) checkSpots(l, lm, map, mission, err, official)
    }
  }
}

function checkSpots(l: KillzoneLayoutData, lm: KillzoneLayoutData['maps'][number], map: MissionMap, mission: MissionData, err: (m: string) => void, official = false): void {
  const steps = mission.objectiveSetup.steps
  const r = mission.objectiveSetup.markerMm / 2 / 25.4
  const centreRules: ObjectiveConstraints = steps[0]?.constraints ?? {}
  const sideRules: ObjectiveConstraints = steps[1]?.constraints ?? {}
  const tag = `${lm.id}/${mission.id}`
  const clear = (p: Vec2, label: string) => {
    if (official) return // the card's skull is where the card puts it, even next to a wall
    for (const piece of l.pieces) for (const part of piece.parts) {
      if (distToPolygon(p, part.footprint) < LAYOUT_RULES.spotClear) err(`${tag} ${label} (${p.x}, ${p.z}) is within ${LAYOUT_RULES.spotClear} of ${piece.id}.${part.id}`)
    }
  }
  const neutral = (p: Vec2) => Math.min(...map.neutralEdges.map((e) => segDist(p, e.a, e.b)))
  const toLine = (p: Vec2) => segDist(p, map.centreline.a, map.centreline.b)
  const spots = lm.objectiveSpots
  spots.centre.forEach((p, i) => {
    const label = `centre[${i}]`
    if (centreRules.onCentreline && toLine(p) > 1e-6) err(`${tag} ${label} is not on the centreline`)
    if (centreRules.minFromNeutralEdges !== undefined && neutral(p) - r <= centreRules.minFromNeutralEdges) err(`${tag} ${label} is too close to a neutral edge`)
    clear(p, label)
  })
  for (const seat of ['A', 'B'] as const) {
    const list = seat === 'A' ? spots.territoryA : spots.territoryB
    const terr = map.territories[seat]
    list.forEach((p, i) => {
      const label = `territory${seat}[${i}]`
      if (sideRules.whollyWithinTerritory && !(pointInPolygon(p, terr) && distToPolygonBoundary(p, terr) >= r - 1e-9)) err(`${tag} ${label} (${p.x}, ${p.z}) is not wholly within territory ${seat}`)
      // official cards: a skull may sit a hair outside the setup limits (Map 3: 1.94 in from a neutral edge, 3.23 in from the centreline); the engine falls back to the layout's default spots then
      if (!official && sideRules.withinCentrelineInches !== undefined && toLine(p) - r > sideRules.withinCentrelineInches + 1e-9) err(`${tag} ${label} is more than ${sideRules.withinCentrelineInches} from the centreline`)
      if (!official && sideRules.minFromNeutralEdges !== undefined && neutral(p) - r <= sideRules.minFromNeutralEdges) err(`${tag} ${label} is too close to a neutral edge`)
      clear(p, label)
    })
  }
  const d = spots.default
  const has = (list: Vec2[], p: Vec2) => list.some((q) => q.x === p.x && q.z === p.z)
  if (!has(spots.centre, d.centre)) err(`${tag} default centre is not in the centre candidates`)
  if (!has(spots.territoryA, d.a)) err(`${tag} default a is not in territoryA`)
  if (!has(spots.territoryB, d.b)) err(`${tag} default b is not in territoryB`)
  const min = sideRules.minFromOtherMarkers ?? 0
  const pairs: [string, Vec2, Vec2][] = [['centre-a', d.centre, d.a], ['centre-b', d.centre, d.b], ['a-b', d.a, d.b]]
  for (const [n, p, q] of pairs) if (dist(p, q) - 2 * r <= min) err(`${tag} default markers ${n} are not more than ${min} apart`)
}
