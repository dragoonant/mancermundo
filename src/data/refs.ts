import type {
  BoardData,
  Condition,
  DataRecord,
  EffectList,
  EquipmentListData,
  FighterTypeData,
  HouseData,
  Id,
  RecordType,
  RuleData,
  ScenarioData,
  SkillData,
  StarterGangData,
  WargearData,
  WeaponData,
} from './types'

export type { RecordType } from './types'

/** Skill sets every house may name even before a skill of the set exists in the data (docs/spec/20-data-schema.md section 1). */
export const CORE_SKILL_SETS = ['agility', 'brawn', 'combat', 'cunning', 'ferocity', 'leadership', 'shooting', 'savant'] as const

export type RefKind =
  | 'trait'
  | 'weapon'
  | 'wargear'
  | 'skill'
  | 'houseRule'
  | 'fighterRule'
  | 'house'
  | 'fighterType'
  | 'equipmentList'
  | 'tile'
  | 'board'
  | 'scenario'
  | 'skillSet'

export interface Ref {
  /** Where the reference is written, for error messages. */
  at: string
  id: Id
  kind: RefKind
}

const asList = (e: EffectList | undefined) => (e === undefined ? [] : Array.isArray(e) ? e : [e])

function conditionRefs(c: Condition | undefined, at: string, out: Ref[]): void {
  if (c?.weaponTrait) out.push({ at: `${at}.weaponTrait`, id: c.weaponTrait, kind: 'trait' })
}

function effectRefs(e: EffectList | undefined, at: string, out: Ref[]): void {
  asList(e).forEach((x, i) => {
    const p = Array.isArray(e) ? `${at}[${i}]` : at
    if (x.grantTrait) {
      out.push({ at: `${p}.grantTrait.trait`, id: x.grantTrait.trait, kind: 'trait' })
      x.grantTrait.weapons?.ids?.forEach((id, j) => out.push({ at: `${p}.grantTrait.weapons.ids[${j}]`, id, kind: 'weapon' }))
      x.grantTrait.weapons?.traits?.forEach((id, j) => out.push({ at: `${p}.grantTrait.weapons.traits[${j}]`, id, kind: 'trait' }))
    }
  })
}

/** Every id a record points at, with the kind it must resolve to. */
export function recordRefs(rec: DataRecord, type: RecordType): Ref[] {
  const out: Ref[] = []
  switch (type) {
    case 'weapon': {
      const w = rec as WeaponData
      w.profiles.forEach((p, i) => p.traits.forEach((t, j) => out.push({ at: `profiles[${i}].traits[${j}].trait`, id: t.trait, kind: 'trait' })))
      break
    }
    case 'wargear': {
      effectRefs((rec as WargearData).effect, 'effect', out)
      break
    }
    case 'skill': {
      const s = rec as SkillData
      conditionRefs(s.when, 'when', out)
      effectRefs(s.effect, 'effect', out)
      break
    }
    case 'rule': {
      const r = rec as RuleData
      conditionRefs(r.when, 'when', out)
      effectRefs(r.effect, 'effect', out)
      break
    }
    case 'house': {
      const h = rec as HouseData
      h.houseRules.forEach((id, i) => out.push({ at: `houseRules[${i}]`, id, kind: 'houseRule' }))
      h.fighterTypes.forEach((id, i) => out.push({ at: `fighterTypes[${i}]`, id, kind: 'fighterType' }))
      h.skillSets.forEach((id, i) => out.push({ at: `skillSets[${i}]`, id, kind: 'skillSet' }))
      break
    }
    case 'fighterType': {
      const f = rec as FighterTypeData
      out.push({ at: 'house', id: f.house, kind: 'house' })
      f.rules.forEach((r, i) => out.push({ at: `rules[${i}].rule`, id: r.rule, kind: 'fighterRule' }))
      out.push({ at: 'equipmentList', id: f.equipmentList, kind: 'equipmentList' })
      for (const group of ['primary', 'secondary'] as const) f.skillAccess[group].forEach((id, i) => out.push({ at: `skillAccess.${group}[${i}]`, id, kind: 'skillSet' }))
      break
    }
    case 'equipmentList': {
      const e = rec as EquipmentListData
      out.push({ at: 'house', id: e.house, kind: 'house' })
      e.forTypes.forEach((id, i) => out.push({ at: `forTypes[${i}]`, id, kind: 'fighterType' }))
      e.weapons.forEach((w, i) => out.push({ at: `weapons[${i}].id`, id: w.id, kind: 'weapon' }))
      e.wargear.forEach((w, i) => out.push({ at: `wargear[${i}].id`, id: w.id, kind: 'wargear' }))
      break
    }
    case 'starterGang': {
      const s = rec as StarterGangData
      out.push({ at: 'house', id: s.house, kind: 'house' })
      s.fighters.forEach((f, i) => {
        out.push({ at: `fighters[${i}].type`, id: f.type, kind: 'fighterType' })
        f.weapons.forEach((id, j) => out.push({ at: `fighters[${i}].weapons[${j}]`, id, kind: 'weapon' }))
        f.wargear.forEach((id, j) => out.push({ at: `fighters[${i}].wargear[${j}]`, id, kind: 'wargear' }))
        f.skills.forEach((id, j) => out.push({ at: `fighters[${i}].skills[${j}]`, id, kind: 'skill' }))
      })
      break
    }
    case 'board': {
      const b = rec as BoardData
      b.tiles.forEach((t, i) => out.push({ at: `tiles[${i}].tile`, id: t.tile, kind: 'tile' }))
      b.scenarios.forEach((id, i) => out.push({ at: `scenarios[${i}]`, id, kind: 'scenario' }))
      break
    }
    default:
      break
  }
  return out
}

/** Names of `code` escape hatches a record uses (effects, weapon/wargear code, scenario victory/special/caskets). `params` are never walked. */
export function recordCodes(rec: DataRecord, type: RecordType): string[] {
  const names: string[] = []
  const fromEffects = (e: EffectList | undefined) => asList(e).forEach((x) => x.code && names.push(x.code.code))
  switch (type) {
    case 'weapon':
      if ((rec as WeaponData).code) names.push((rec as WeaponData).code!.code)
      break
    case 'wargear': {
      const w = rec as WargearData
      fromEffects(w.effect)
      if (w.code) names.push(w.code.code)
      break
    }
    case 'skill':
      fromEffects((rec as SkillData).effect)
      break
    case 'rule':
      fromEffects((rec as RuleData).effect)
      break
    case 'scenario': {
      const s = rec as ScenarioData
      if ('code' in s.victory) names.push(s.victory.code)
      s.special.forEach((c) => names.push(c.code))
      if (s.caskets && typeof s.caskets.contents === 'object') names.push(s.caskets.contents.code)
      break
    }
    default:
      break
  }
  return names
}

export interface RecordIndex {
  byId: Record<Id, DataRecord>
  types: Record<Id, RecordType>
  /** Which file each id came from. */
  files: Record<Id, string>
  errors: string[]
}

/** Index records from parsed files (path, type, records), collecting duplicate-id errors. */
export function buildIndex(files: { path: string; type: RecordType; records: DataRecord[] }[]): RecordIndex {
  const index: RecordIndex = { byId: {}, types: {}, files: {}, errors: [] }
  for (const f of files) {
    for (const rec of f.records) {
      const id = (rec as { id: Id }).id
      if (index.byId[id]) {
        index.errors.push(`${f.path}: duplicate id "${id}" (first seen in ${index.files[id]})`)
        continue
      }
      index.byId[id] = rec
      index.types[id] = f.type
      index.files[id] = f.path
    }
  }
  return index
}

/** Skill sets the data can name: the core sets plus every `set` a skill record declares. */
export function knownSkillSets(index: RecordIndex): Set<string> {
  const sets = new Set<string>(CORE_SKILL_SETS)
  for (const [id, rec] of Object.entries(index.byId)) if (index.types[id] === 'skill') sets.add((rec as SkillData).set)
  return sets
}

function resolves(index: RecordIndex, sets: Set<string>, id: Id, kind: RefKind): boolean {
  if (kind === 'skillSet') return sets.has(id)
  const t = index.types[id]
  const rec = index.byId[id]
  switch (kind) {
    case 'houseRule':
      return t === 'rule' && (rec as RuleData).kind === 'houseRule'
    case 'fighterRule':
      return t === 'rule' && (rec as RuleData).kind === 'fighterRule'
    default:
      return t === kind
  }
}

/** Dangling or wrong-kind references across the whole index, as `file: record.at: message` lines. */
export function checkRefs(index: RecordIndex): string[] {
  const errors: string[] = []
  const sets = knownSkillSets(index)
  for (const [id, rec] of Object.entries(index.byId)) {
    for (const ref of recordRefs(rec, index.types[id])) {
      if (!resolves(index, sets, ref.id, ref.kind)) {
        const found = index.types[ref.id]
        errors.push(
          `${index.files[id]}: ${id}.${ref.at}: "${ref.id}" ${found ? `is a ${found}, expected ${ref.kind}` : `does not exist (expected ${ref.kind})`}`,
        )
      }
    }
  }
  return errors
}
