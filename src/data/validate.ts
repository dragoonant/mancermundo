/**
 * Build-time data validation (node only; never imported by the client bundle).
 * Used by tools/validate-data.ts and tests/data/*.test.ts. Checks of docs/spec/20-data-schema.md section 12:
 * schemas, unique ids, resolving references, traits, code hooks, starter-gang legality, board geometry (S1Z),
 * a prose spot check against the gitignored source extracts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import type {
  BoardData,
  ConstantsData,
  DataBundle,
  DataRecord,
  DiceData,
  FighterTypeData,
  HouseData,
  Id,
  RecordType,
  ScenarioData,
  StarterGangData,
  TileData,
  TraitData,
  TraitUse,
  Vec2,
  WargearData,
  WeaponData,
} from './types'
import { MANIFEST, SCHEMA_NAMES, SCHEMA_OF_DEF } from './manifest'
import { SCHEMAS, schemaId } from './schema'
import { buildIndex, checkRefs, recordCodes, type RecordIndex } from './refs'
import { bundleFromIndex } from './index'
import { starterGangProblems } from './roster'

const DATA_ROOT = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SOURCES = path.resolve(DATA_ROOT, '../../docs/sources')

/** Wargear kinds the v1 data may use (field armour and chems are out of scope, R-16.1, unless 13-gangs.md lists them). */
export const V1_WARGEAR_KINDS: readonly WargearData['kind'][] = ['armour', 'equipment']
/** Wargear ids of an out-of-scope kind that 13-gangs.md nevertheless lists for v1 (filled by the gang stage). */
export const V1_EXTRA_WARGEAR_IDS: readonly Id[] = []

export interface HookUse {
  name: string
  usedBy: string[]
}

export interface FileSummary {
  path: string
  def: RecordType
  records: number
  ids: Id[]
}

export interface ValidationResult {
  errors: string[]
  files: number
  records: number
  hooks: HookUse[]
  index: RecordIndex
  summaries: FileSummary[]
  /** Present when the data could be grouped into a bundle (even if other problems exist). */
  bundle?: DataBundle
}

export interface ValidateOptions {
  /** Code names the engine has registered; when given, any other name the data uses is an error. */
  registeredCodes?: ReadonlySet<string>
  /** Report unregistered code names as pending (not errors); used by stage S1G until S4K registers them. */
  allowPendingCodes?: boolean
  /** Directory of source extracts for the prose spot check; `false` skips it. Default: docs/sources when it exists. */
  sourcesDir?: string | false
}

function listJson(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listJson(full, base))
    else if (entry.name.endsWith('.json')) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

// ------------------------------------------------------------------ trait use
function checkTraitUse(use: TraitUse, traits: Record<Id, TraitData>, at: string, errors: string[]): void {
  const def = traits[use.trait]
  if (!def) return // dangling refs are reported elsewhere
  const bad = (m: string) => errors.push(`${at}: ${use.trait} ${m}`)
  const has = (v: unknown) => v !== undefined
  if (def.param === 'none' && (has(use.x) || has(use.inches) || has(use.target))) bad('takes no parameter')
  if (def.param === 'count') {
    if (!has(use.x)) bad('needs x')
    if (has(use.inches) || has(use.target)) bad('takes only x')
  }
  if (def.param === 'inches') {
    if (!has(use.inches)) bad('needs inches')
    if (has(use.x) || has(use.target)) bad('takes only inches')
  }
  if (def.param === 'target') {
    if (!has(use.target)) bad('needs a target (for example 5+)')
    if (has(use.x) || has(use.inches)) bad('takes only a target')
  }
  if (!def.implemented) errors.push(`${at}: weapon trait ${use.trait} is not implemented for v1 (R-16.2)`)
}

// ------------------------------------------------------------------ prose spot check
const words = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
const SHINGLE = 12

function proseOf(rec: DataRecord): string[] {
  const out: string[] = []
  const r = rec as unknown as Record<string, unknown>
  if (typeof r.text === 'string') out.push(r.text)
  return out
}

function listTextFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'page-images' && entry.name !== 'node_modules') listTextFiles(full, out)
    } else if (/\.(txt|md)$/i.test(entry.name)) out.push(full)
  }
  return out
}

/** Any 12-word run of a record's prose that also appears in a source extract is an error. */
function checkProse(index: RecordIndex, sourcesDir: string, errors: string[]): void {
  const shingles = new Map<string, Id>()
  const firstWords = new Set<string>()
  for (const [id, rec] of Object.entries(index.byId)) {
    for (const text of proseOf(rec)) {
      const w = words(text)
      for (let i = 0; i + SHINGLE <= w.length; i++) {
        const key = w.slice(i, i + SHINGLE).join(' ')
        if (!shingles.has(key)) shingles.set(key, id)
        firstWords.add(w[i])
      }
    }
  }
  if (shingles.size === 0) return
  const reported = new Set<string>()
  for (const file of listTextFiles(sourcesDir)) {
    const w = words(fs.readFileSync(file, 'utf8'))
    for (let i = 0; i + SHINGLE <= w.length; i++) {
      if (!firstWords.has(w[i])) continue
      const hit = shingles.get(w.slice(i, i + SHINGLE).join(' '))
      if (hit && !reported.has(hit)) {
        reported.add(hit)
        errors.push(`${index.files[hit]}: ${hit}: prose shares a ${SHINGLE}-word run with ${path.relative(sourcesDir, file).split(path.sep).join('/')} (write it in our own words)`)
      }
    }
  }
}

// ------------------------------------------------------------------ geometry sanity (S1Z adds the board checks)
const inTile = (p: Vec2) => Math.abs(p.x) <= 6 && Math.abs(p.z) <= 6

function checkTile(t: TileData, at: string, errors: string[]): void {
  const pts: [string, Vec2][] = []
  t.walls.forEach((w) => pts.push([`walls.${w.id}.a`, w.a], [`walls.${w.id}.b`, w.b]))
  t.doors.forEach((d) => pts.push([`doors.${d.id}.a`, d.a], [`doors.${d.id}.b`, d.b]))
  t.terminals.forEach((m) => pts.push([`terminals.${m.id}.pos`, m.pos]))
  t.ducts.forEach((d) => pts.push([`ducts.${d.id}.a`, d.a], [`ducts.${d.id}.b`, d.b]))
  t.obstacles.forEach((o) => o.footprint.forEach((p, i) => pts.push([`obstacles.${o.id}.footprint[${i}]`, p])))
  t.casketSpots.forEach((p, i) => pts.push([`casketSpots[${i}]`, p]))
  t.floor.props.forEach((p, i) => pts.push([`floor.props[${i}].pos`, p.pos]))
  for (const [name, p] of pts) if (!inTile(p)) errors.push(`${at}: ${t.id}.${name}: (${p.x}, ${p.z}) is outside the tile's [-6, 6] square`)
  const ids = (xs: { id: string }[], what: string) => {
    const seen = new Set<string>()
    for (const x of xs) {
      if (seen.has(x.id)) errors.push(`${at}: ${t.id} repeats ${what} id "${x.id}"`)
      seen.add(x.id)
    }
  }
  ids(t.walls, 'wall')
  ids(t.doors, 'door')
  ids(t.terminals, 'terminal')
  ids(t.ducts, 'duct')
  ids(t.obstacles, 'obstacle')
  for (const m of t.terminals) if (!t.doors.some((d) => d.id === m.door)) errors.push(`${at}: ${t.id}.terminals.${m.id}: door "${m.door}" is not on this tile`)
}

// ------------------------------------------------------------------ main
export function validateAll(options: ValidateOptions = {}): ValidationResult {
  const errors: string[] = []

  // 1. schemas
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true })
  addFormats(ajv)
  for (const name of SCHEMA_NAMES) {
    const schema = SCHEMAS[name] as { $id?: string } | undefined
    if (!schema) {
      errors.push(`src/data/schema/${name}.schema.json: missing`)
      continue
    }
    if (schema.$id !== schemaId(name)) errors.push(`src/data/schema/${name}.schema.json: $id is "${schema.$id}", expected "${schemaId(name)}"`)
    try {
      ajv.addSchema(schema)
    } catch (e) {
      errors.push(`src/data/schema/${name}.schema.json: ${(e as Error).message}`)
    }
  }
  for (const rel of listJson(path.join(DATA_ROOT, 'schema'))) {
    if (!SCHEMA_NAMES.some((n) => rel === `${n}.schema.json`)) errors.push(`src/data/schema/${rel}: not one of the six schema files`)
  }

  // 2. orphan files
  const known = new Set(MANIFEST.map((m) => m.path))
  for (const rel of listJson(DATA_ROOT)) {
    if (rel.startsWith('schema/')) continue
    if (!known.has(rel)) errors.push(`src/data/${rel}: not listed by any area index (core, gangs, zm, scenarios)`)
  }
  const seenPaths = new Set<string>()
  for (const m of MANIFEST) {
    if (seenPaths.has(m.path)) errors.push(`src/data/${m.path}: listed twice`)
    seenPaths.add(m.path)
    if (SCHEMA_OF_DEF[m.def] !== m.schema) errors.push(`src/data/${m.path}: def "${m.def}" lives in the ${SCHEMA_OF_DEF[m.def]} schema, not ${m.schema}`)
  }

  // 3. parse (from disk, so a BOM is caught) and schema-validate every file
  const parsed: { path: string; type: RecordType; records: DataRecord[] }[] = []
  const summaries: FileSummary[] = []
  const compiled = new Map<string, ReturnType<typeof ajv.compile>>()
  let recordCount = 0
  for (const m of MANIFEST) {
    const file = path.join(DATA_ROOT, m.path)
    if (!fs.existsSync(file)) {
      errors.push(`src/data/${m.path}: missing`)
      continue
    }
    const buf = fs.readFileSync(file)
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      errors.push(`src/data/${m.path}: starts with a UTF-8 BOM (write JSON without one)`)
      continue
    }
    let data: unknown
    try {
      data = JSON.parse(buf.toString('utf8'))
    } catch (e) {
      errors.push(`src/data/${m.path}: invalid JSON (${(e as Error).message})`)
      continue
    }
    if (m.array !== Array.isArray(data)) {
      errors.push(`src/data/${m.path}: expected ${m.array ? 'an array of records' : 'a single record'}`)
      continue
    }
    const ref = `${schemaId(m.schema)}#/$defs/${m.def}`
    const key = `${m.array ? '[]' : ''}${ref}`
    let validate = compiled.get(key)
    try {
      if (!validate) {
        validate = m.array ? ajv.compile({ type: 'array', items: { $ref: ref } }) : ajv.compile({ $ref: ref })
        compiled.set(key, validate)
      }
    } catch (e) {
      errors.push(`src/data/${m.path}: schema ${m.schema}#/$defs/${m.def} does not compile (${(e as Error).message})`)
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
    parsed.push({ path: `src/data/${m.path}`, type: m.def, records })
    summaries.push({ path: m.path, def: m.def, records: records.length, ids: records.map((r) => (r as { id: Id }).id) })
  }

  const index = buildIndex(parsed)
  errors.push(...index.errors, ...checkRefs(index))

  const ofType = <T>(type: RecordType): T[] => Object.entries(index.byId).filter(([id]) => index.types[id] === type).map(([, r]) => r as T)
  const where = (id: Id) => index.files[id] ?? id

  // 4. singletons and tables
  const dice = ofType<DiceData>('dice')
  const constants = ofType<ConstantsData>('constants')
  if (dice.length !== 1) errors.push(`core/dice.json: expected exactly one dice record, found ${dice.length}`)
  if (constants.length !== 1) errors.push(`core/constants.json: expected exactly one constants record, found ${constants.length}`)
  for (const d of dice) {
    for (const table of ['firepower', 'injury', 'scatter'] as const) {
      const faces = d[table].faces.map((f) => f.face).sort()
      if (faces.join() !== '1,2,3,4,5,6') errors.push(`${where(d.id)}: ${table} faces must be 1 to 6 once each`)
    }
    if (d.d3.faces.some((f) => f < 1 || f > 3)) errors.push(`${where(d.id)}: d3 faces must be 1 to 3`)
  }
  for (const c of constants) {
    const covered = (rows: { min: number; max: number }[], lo: number, hi: number, what: string) => {
      const hits = new Array(hi - lo + 1).fill(0)
      for (const r of rows) {
        if (r.max < r.min) errors.push(`${where(c.id)}: ${what} row ${r.min}-${r.max} runs backwards`)
        for (let v = r.min; v <= r.max; v++) if (v >= lo && v <= hi) hits[v - lo]++
      }
      hits.forEach((n, i) => {
        if (n !== 1) errors.push(`${where(c.id)}: ${what} covers ${lo + i} ${n} times (needs exactly once)`)
      })
    }
    covered(c.crewCap, 2, 12, 'crewCap')
    covered(c.casket.contents, 1, 6, 'casket.contents')
  }

  // 5. actions
  const keys = new Set<string>()
  for (const a of ofType<{ id: Id; key: string }>('action')) {
    if (keys.has(a.key)) errors.push(`${where(a.id)}: ${a.id} repeats action key "${a.key}"`)
    keys.add(a.key)
  }

  // 6. weapons and traits
  const traits = Object.fromEntries(ofType<TraitData>('trait').map((t) => [t.id, t])) as Record<Id, TraitData>
  for (const w of ofType<WeaponData>('weapon')) {
    const profileIds = new Set<string>()
    w.profiles.forEach((p, i) => {
      if (profileIds.has(p.id)) errors.push(`${where(w.id)}: ${w.id} repeats profile id "${p.id}"`)
      profileIds.add(p.id)
      p.traits.forEach((t, j) => checkTraitUse(t, traits, `${where(w.id)}: ${w.id}.profiles[${i}].traits[${j}]`, errors))
      if ((p.range.long === 'E' || p.range.long === 'T') && p.range.short !== null) errors.push(`${where(w.id)}: ${w.id}.profiles[${i}]: a ${p.range.long} range has no Short range`)
    })
    if (w.profiles.length > 1 && w.profiles.some((p) => p.name === null)) errors.push(`${where(w.id)}: ${w.id} has several profiles, each needs a name`)
  }
  for (const g of ofType<WargearData>('wargear')) {
    if (!V1_WARGEAR_KINDS.includes(g.kind) && !V1_EXTRA_WARGEAR_IDS.includes(g.id)) errors.push(`${where(g.id)}: ${g.id} is ${g.kind}, out of scope for v1 (R-16.1)`)
    if (g.kind === 'armour' && g.save === undefined) errors.push(`${where(g.id)}: armour ${g.id} needs a save`)
  }

  // 7. houses, fighter types, equipment lists
  const types = ofType<FighterTypeData>('fighterType')
  const limits = constants[0]?.statLimits
  for (const h of ofType<HouseData>('house')) {
    const own = types.filter((t) => t.house === h.id).map((t) => t.id)
    for (const id of own) if (!h.fighterTypes.includes(id)) errors.push(`${where(h.id)}: fighter type ${id} names house ${h.id} but is not in its fighterTypes`)
    for (const id of h.fighterTypes) {
      const t = index.byId[id] as FighterTypeData | undefined
      if (t && t.house !== h.id) errors.push(`${where(h.id)}: ${id} is listed by ${h.id} but belongs to ${t.house}`)
    }
  }
  for (const t of types) {
    const list = index.byId[t.equipmentList] as { forTypes?: Id[] } | undefined
    if (list?.forTypes && !list.forTypes.includes(t.id)) errors.push(`${where(t.id)}: ${t.id} uses ${t.equipmentList}, whose forTypes does not list it`)
    if (limits) {
      for (const [stat, value] of Object.entries(t.stats)) {
        const n = typeof value === 'number' ? value : Number.parseInt(value, 10)
        const lim = limits[stat as keyof typeof limits]
        if (lim && (n < lim.min || n > lim.max)) errors.push(`${where(t.id)}: ${t.id}.stats.${stat} = ${value} is outside the hard limits ${lim.min}-${lim.max} (R-2.7)`)
      }
    }
  }

  // 8. tiles, boards, scenarios
  for (const t of ofType<TileData>('tile')) checkTile(t, where(t.id), errors)
  const boards = ofType<BoardData>('board')
  for (const s of ofType<ScenarioData>('scenario')) {
    if (!boards.some((b) => s.layouts.includes(b.layout))) errors.push(`${where(s.id)}: ${s.id} has no board of layout ${s.layouts.join(' or ')}`)
  }
  for (const b of boards) {
    for (const sid of b.scenarios) {
      const s = index.byId[sid] as ScenarioData | undefined
      if (s && !s.layouts.includes(b.layout)) errors.push(`${where(b.id)}: ${b.id} (${b.layout}) lists ${sid}, which does not play on that layout`)
    }
  }

  // 9. code hooks
  const usage = new Map<string, Set<string>>()
  for (const [id, rec] of Object.entries(index.byId)) {
    for (const name of recordCodes(rec, index.types[id])) usage.set(name, (usage.get(name) ?? new Set()).add(id))
  }
  const hooks: HookUse[] = [...usage.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, ids]) => ({ name, usedBy: [...ids].sort() }))
  if (options.registeredCodes && !options.allowPendingCodes) {
    for (const h of hooks) if (!options.registeredCodes.has(h.name)) errors.push(`code hook "${h.name}" (used by ${h.usedBy.join(', ')}) has no registration`)
  }

  // 10. bundle-level checks (starter gangs)
  let bundle: DataBundle | undefined
  try {
    bundle = bundleFromIndex(index)
  } catch (e) {
    errors.push((e as Error).message)
  }
  if (bundle) {
    for (const sg of ofType<StarterGangData>('starterGang')) {
      for (const msg of starterGangProblems(bundle, sg)) errors.push(`${where(sg.id)}: ${sg.id}: ${msg}`)
    }
  }

  // 11. prose spot check against the source extracts
  const sourcesDir = options.sourcesDir === undefined ? DEFAULT_SOURCES : options.sourcesDir
  if (sourcesDir && fs.existsSync(sourcesDir)) checkProse(index, sourcesDir, errors)

  return { errors, files: MANIFEST.length, records: recordCount, hooks, index, summaries, bundle }
}
