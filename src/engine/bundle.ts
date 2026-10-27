// The data the engine consumes. `EngineBundle` is runtime-shaped (types.ts `Runtime*` records, boards already compiled to
// `BoardDef`): the engine never reads src/data at run time. `bundleFromData` is the adapter that fills it from a loaded,
// validated data bundle (parse "4+", weapon `str`, ranges, traits; compile boards through board.ts); tests can also build
// bundles by hand (tests/fixtures/gang.ts). `snapshotData` copies the records one game uses into `GameState.data`.
import type {
  ActionData,
  DataBundle,
  DiceData,
  FighterTypeData,
  RuleData,
  SkillData,
  TraitUse,
  WeaponData,
  WeaponProfile,
} from '../data/types'
import { compileBoards } from './board'
import { parseTarget } from './dice'
import type {
  BoardDef,
  GameData,
  GameSetup,
  RosterFighter,
  RuntimeAction,
  RuntimeConstants,
  RuntimeDice,
  RuntimeFighterType,
  RuntimeHouse,
  RuntimeProfile,
  RuntimeScenario,
  RuntimeSkill,
  RuntimeStarterGang,
  RuntimeTrait,
  RuntimeWargear,
  RuntimeWeapon,
  Seat,
  StatKey,
  TraitRef,
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
  /** pre-built starter gangs (13-gangs.md), keyed by id; optional so hand-built test bundles need none */
  starterGangs?: Record<string, RuntimeStarterGang>
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

// ---------------------------------------------------------------------------
// bundleFromData: data records -> runtime shapes
// ---------------------------------------------------------------------------

const STAT_KEYS: StatKey[] = ['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'Ld', 'Cl', 'Wil', 'Int']

/** Data statuses are `pronePinned` / `proneSeriouslyInjured`; the engine's derived statuses are `pinned` / `seriouslyInjured`. */
const STATUS_MAP: Record<string, string> = { pronePinned: 'pinned', proneSeriouslyInjured: 'seriouslyInjured' }

/** The runtime action table: ids are the action keys (`move`, `takeCover`, ...). */
export function runtimeActions(list: readonly ActionData[]): Record<string, RuntimeAction> {
  const out: Record<string, RuntimeAction> = {}
  for (const a of list) {
    out[a.key] = {
      id: a.key,
      name: a.name,
      type: a.cost,
      statuses: a.statuses.map((s) => STATUS_MAP[s] ?? s),
      ...(a.requires.length > 0 ? { requires: a.requires.map((r) => String(r)) } : {}),
    }
  }
  return out
}

/** Face-name tables indexed by D6 result - 1 (S3a reads these names; `Ctx.roll` copies them into `DiceRolled.faces`). */
export function runtimeDice(d: DiceData): RuntimeDice {
  return {
    firepower: faceTable(d.firepower.faces, (f) => `hit${f.hits}${f.ammo ? '+ammo' : ''}`),
    injury: faceTable(d.injury.faces, (f) => f.result),
    scatter: faceTable(d.scatter.faces, (f) => f.kind),
  }
}

function faceTable<T extends { face: number }>(faces: T[], name: (f: T) => string): string[] {
  const out: string[] = []
  for (const f of faces) out[f.face - 1] = name(f)
  return out
}

function runtimeStr(str: number | string): RuntimeProfile['str'] {
  if (typeof str === 'number') return { base: 'fixed', value: str }
  const m = /^S([+-]\d+)?$/.exec(str.trim())
  if (!m) throw new Error(`data: bad weapon strength "${str}"`)
  return { base: 'user', value: m[1] ? Number(m[1]) : 0 }
}

function runtimeDmg(dmg: WeaponProfile['dmg']): RuntimeProfile['dmg'] {
  if (dmg === '-') return { kind: 'none' }
  if (typeof dmg === 'number') return { kind: 'fixed', value: dmg }
  if (/^\d+$/.test(dmg)) return { kind: 'fixed', value: Number(dmg) }
  return { kind: 'dice', expr: dmg }
}

function runtimeTrait(t: TraitUse): TraitRef {
  const out: TraitRef = { trait: t.trait }
  if (t.x !== undefined) out.x = t.x
  if (t.inches !== undefined) out.inches = t.inches
  if (t.target !== undefined) out.target = parseTarget(t.target)
  return out
}

const T_RECLAIMED = 'core.t.reclaimed-scavenged'
const T_PLENTIFUL = 'core.t.plentiful'

/**
 * Reclaimed / Scavenged (R-14.2, [ND] weapon traits): a worse copy of the weapon. A profile with Plentiful loses it; any other
 * profile with an Ammo value has it worsened by 1 (4+ becomes 5+, never worse than 6+).
 */
function reclaimed(p: RuntimeProfile): RuntimeProfile {
  if (!p.traits.some((t) => t.trait === T_RECLAIMED)) return p
  if (p.traits.some((t) => t.trait === T_PLENTIFUL)) return { ...p, traits: p.traits.filter((t) => t.trait !== T_PLENTIFUL) }
  return p.ammo === null ? p : { ...p, ammo: Math.min(6, p.ammo + 1) }
}

/** One weapon profile as the engine reads it (exported for the trait tests). */
export function runtimeProfile(p: WeaponProfile): RuntimeProfile {
  return reclaimed({
    id: p.id,
    name: p.name,
    range: { short: p.range.short, long: p.range.long },
    acc: { short: p.acc.short, long: p.acc.long },
    str: runtimeStr(p.str),
    ap: p.ap,
    dmg: runtimeDmg(p.dmg),
    ammo: p.ammo === '-' ? null : parseTarget(p.ammo),
    traits: p.traits.map(runtimeTrait),
  })
}

function runtimeWeapon(w: WeaponData): RuntimeWeapon {
  return {
    id: w.id,
    name: w.name,
    class: w.class,
    cost: w.cost,
    profiles: w.profiles.map(runtimeProfile),
    flavour: w.flavour,
    ...(w.code ? { code: w.code.code } : {}),
  }
}

function runtimeFighterType(t: FighterTypeData): RuntimeFighterType {
  const stats = {} as Record<StatKey, number>
  for (const k of STAT_KEYS) stats[k] = parseTarget(t.stats[k] as string | number)
  return {
    id: t.id,
    name: t.name,
    houseId: t.house,
    role: t.role,
    cost: t.cost,
    stats,
    baseMm: t.base,
    rules: t.rules.map((r) => (r.x === undefined ? { id: r.rule } : { id: r.rule, x: r.x })),
    skillAccess: { primary: [...t.skillAccess.primary], secondary: [...t.skillAccess.secondary] },
    limits: { min: t.limits?.min ?? 0, max: t.limits?.max ?? null },
    figureArchetype: t.figure.archetype,
  }
}

function runtimeSkill(s: SkillData | RuleData, kind: RuntimeSkill['kind']): RuntimeSkill {
  const set = 'set' in s ? s.set : undefined
  return {
    id: s.id,
    name: s.name,
    kind,
    ...(set ? { set } : {}),
    ...(s.window ? { window: s.window as RuntimeSkill['window'] } : {}),
    ...(s.when ? { when: s.when as Record<string, unknown> } : {}),
    ...(s.effect ? { effect: s.effect } : {}),
    ...(s.limit ? { limit: s.limit } : {}),
    ...(s.action
      ? {
          action: {
            id: s.action.id,
            type: s.action.type,
            statuses: s.action.statuses.map((x) => STATUS_MAP[x] ?? x),
            ...(s.action.requires ? { requires: s.action.requires } : {}),
          },
        }
      : {}),
  }
}

/**
 * Turn a loaded data bundle (`loadBundle()` from src/data) into the engine's runtime bundle: targets parsed, weapon strength
 * and ranges normalised, traits and rules mapped, boards compiled. Throws on a board that fails to compile.
 */
export function bundleFromData(data: DataBundle): EngineBundle {
  const byId = <D extends { id: string }, R extends { id: string }>(src: Record<string, D>, map: (d: D) => R): Record<string, R> =>
    Object.fromEntries(Object.values(src).map((d) => [d.id, map(d)]))
  const skills: Record<string, RuntimeSkill> = {
    ...byId(data.skills, (s) => runtimeSkill(s, 'skill')),
    ...byId(data.rules, (r) => runtimeSkill(r, r.kind)),
  }
  return {
    dataVersion: data.dataVersion,
    houses: byId(data.houses, (h) => ({
      id: h.id,
      name: h.name,
      prefix: h.prefix,
      houseRules: [...h.houseRules],
      fighterTypes: [...h.fighterTypes],
      skillSets: [...h.skillSets],
      paint: { major: { ...h.paint.major }, minor: { ...h.paint.minor } },
    })),
    fighterTypes: byId(data.fighterTypes, runtimeFighterType),
    weapons: byId(data.weapons, runtimeWeapon),
    traits: byId(data.traits, (t) => ({ id: t.id, name: t.name, param: t.param, implemented: t.implemented })),
    skills,
    wargear: byId(data.wargear, (w) => ({
      id: w.id,
      name: w.name,
      kind: w.kind,
      cost: w.cost,
      ...(w.save ? { save: parseTarget(w.save) } : {}),
      ...(w.saveMods ? { saveMods: w.saveMods.map((m) => ({ ...m })) } : {}),
      ...(w.effect ? { effect: w.effect } : {}),
      ...(w.code ? { code: w.code.code } : {}),
      ...(w.code?.params ? { codeParams: JSON.parse(JSON.stringify(w.code.params)) as Record<string, unknown> } : {}),
    })),
    actions: runtimeActions(Object.values(data.actions)),
    dice: runtimeDice(data.dice),
    constants: data.constants as unknown as RuntimeConstants,
    scenarios: byId(data.scenarios, (s) => ({
      id: s.id,
      name: s.name,
      layouts: [...s.layouts],
      roles: s.roles,
      crews: JSON.parse(JSON.stringify(s.crews)) as RuntimeScenario['crews'],
      crewCap: s.crewCap ? s.crewCap.map((r) => ({ ...r })) : null,
      deployment: { ...s.deployment },
      ...(s.caskets ? { caskets: { ...s.caskets } as Record<string, unknown> } : {}),
      scoring: s.scoring.map((r) => ({ ...r })) as Record<string, unknown>[],
      victory: s.victory as RuntimeScenario['victory'],
      special: s.special.map((c) => ({ code: c.code })),
    })),
    boards: compileBoards(data.boards, data.tiles),
    starterGangs: byId(data.starterGangs, (g) => ({
      id: g.id,
      houseId: g.house,
      name: g.name,
      credits: g.credits,
      fighters: g.fighters.map((f) => ({ name: f.name, typeId: f.type, weapons: [...f.weapons], wargear: [...f.wargear], skills: [...f.skills] })),
    })),
  }
}

/**
 * The gang entry of a `GameSetup` for a starter gang. Fighter ids are `<idPrefix><n>` (n from 1); use a different prefix per
 * seat so a mirror match never repeats an id.
 */
export function rosterFromStarter(
  bundle: Pick<EngineBundle, 'starterGangs'>,
  starterId: string,
  idPrefix = 'f',
): GameSetup['gangs'][Seat] {
  const sg = bundle.starterGangs?.[starterId]
  if (!sg) throw new Error(`unknown starter gang "${starterId}"`)
  const roster: RosterFighter[] = sg.fighters.map((f, i) => ({
    id: `${idPrefix}${i + 1}`,
    typeId: f.typeId,
    name: f.name,
    weapons: [...f.weapons],
    wargear: [...f.wargear],
    skills: [...f.skills],
  }))
  return { houseId: sg.houseId, name: sg.name, starterId: sg.id, roster }
}
