import type {
  AbilityData,
  Condition,
  DataRecord,
  DatacardData,
  EffectList,
  EquipmentData,
  Id,
  LoadoutSlot,
  MissionData,
  PloyData,
  TeamData,
  WeaponData,
} from './types'
import type { SchemaName } from './manifest'

export type RecordType = 'datacard' | 'weapon' | 'ability' | 'ploy' | 'equipment' | 'team' | 'weaponRule' | 'mission' | 'layout'

export const TYPE_OF_SCHEMA: Record<SchemaName, RecordType> = {
  datacard: 'datacard',
  weapon: 'weapon',
  ability: 'ability',
  ploy: 'ploy',
  equipment: 'equipment',
  team: 'team',
  'weapon-rule': 'weaponRule',
  mission: 'mission',
  'killzone-layout': 'layout',
}

export type RefKind =
  | 'team'
  | 'datacard'
  | 'weapon'
  | 'weaponOrGroup'
  | 'weaponRule'
  | 'ability'
  | 'uniqueAction'
  | 'abilityOrWeapon'
  | 'ploy'
  | 'equipment'

export interface Ref {
  /** Where the reference is written, for error messages. */
  at: string
  id: Id
  kind: RefKind
}

const asList = (e: EffectList | undefined) => (e === undefined ? [] : Array.isArray(e) ? e : [e])

function conditionRefs(c: Condition | undefined, at: string, out: Ref[]): void {
  if (!c) return
  if (c.weaponHasRule) out.push({ at: `${at}.weaponHasRule`, id: c.weaponHasRule, kind: 'weaponRule' })
  if (c.actionPerformed) out.push({ at: `${at}.actionPerformed`, id: c.actionPerformed, kind: 'uniqueAction' })
  if (c.ployUsedThisTurningPoint) out.push({ at: `${at}.ployUsedThisTurningPoint`, id: c.ployUsedThisTurningPoint, kind: 'ploy' })
  if (c.ployNotUsedThisTurningPoint) out.push({ at: `${at}.ployNotUsedThisTurningPoint`, id: c.ployNotUsedThisTurningPoint, kind: 'ploy' })
  c.allOf?.forEach((x, i) => conditionRefs(x, `${at}.allOf[${i}]`, out))
  c.anyOf?.forEach((x, i) => conditionRefs(x, `${at}.anyOf[${i}]`, out))
  conditionRefs(c.not, `${at}.not`, out)
}

function filterRefs(f: { weaponIds?: Id[]; hasRule?: Id } | undefined, at: string, out: Ref[]): void {
  if (!f) return
  f.weaponIds?.forEach((id, i) => out.push({ at: `${at}.filter.weaponIds[${i}]`, id, kind: 'weaponOrGroup' }))
  if (f.hasRule) out.push({ at: `${at}.filter.hasRule`, id: f.hasRule, kind: 'weaponRule' })
}

function effectRefs(e: EffectList | undefined, at: string, out: Ref[]): void {
  asList(e).forEach((x, i) => {
    const p = Array.isArray(e) ? `${at}[${i}]` : at
    if (x.grantWeaponRule) {
      out.push({ at: `${p}.grantWeaponRule.rule`, id: x.grantWeaponRule.rule, kind: 'weaponRule' })
      filterRefs(x.grantWeaponRule.filter, `${p}.grantWeaponRule`, out)
    }
    if (x.removeWeaponRule) {
      out.push({ at: `${p}.removeWeaponRule.rule`, id: x.removeWeaponRule.rule, kind: 'weaponRule' })
      filterRefs(x.removeWeaponRule.filter, `${p}.removeWeaponRule`, out)
    }
    if (x.modifyStat) filterRefs(x.modifyStat.filter, `${p}.modifyStat`, out)
    if (x.ployCost) {
      out.push({ at: `${p}.ployCost.ploy`, id: x.ployCost.ploy, kind: 'ploy' })
      conditionRefs(x.ployCost.when, `${p}.ployCost.when`, out)
    }
    conditionRefs(x.trigger?.when, `${p}.trigger.when`, out)
  })
}

function slotRefs(slots: LoadoutSlot[] | undefined, at: string, out: Ref[]): void {
  slots?.forEach((s, i) => {
    const p = `${at}[${i}]`
    s.from?.forEach((id, j) => out.push({ at: `${p}.from[${j}]`, id, kind: 'weaponOrGroup' }))
    s.sets?.forEach((set, k) => {
      set.fixed?.forEach((id, j) => out.push({ at: `${p}.sets[${k}].fixed[${j}]`, id, kind: 'weaponOrGroup' }))
      slotRefs(set.options, `${p}.sets[${k}].options`, out)
    })
  })
}

/** Every id a record points at, with the kind of record it must resolve to. */
export function recordRefs(rec: DataRecord, type: RecordType): Ref[] {
  const out: Ref[] = []
  const withTeam = rec as { team?: Id }
  if (type !== 'team' && withTeam.team) out.push({ at: 'team', id: withTeam.team, kind: 'team' })
  switch (type) {
    case 'datacard': {
      const d = rec as DatacardData
      d.weapons.fixed.forEach((id, i) => out.push({ at: `weapons.fixed[${i}]`, id, kind: 'weaponOrGroup' }))
      slotRefs(d.weapons.options, 'weapons.options', out)
      d.abilities.forEach((id, i) => out.push({ at: `abilities[${i}]`, id, kind: 'ability' }))
      d.uniqueActions.forEach((id, i) => out.push({ at: `uniqueActions[${i}]`, id, kind: 'uniqueAction' }))
      d.ovalBase?.weapons?.forEach((id, i) => out.push({ at: `ovalBase.weapons[${i}]`, id, kind: 'weapon' }))
      break
    }
    case 'weapon': {
      const w = rec as WeaponData
      w.rules.forEach((r, i) => out.push({ at: `rules[${i}].rule`, id: r.rule, kind: 'weaponRule' }))
      break
    }
    case 'ability': {
      const a = rec as AbilityData
      conditionRefs(a.conditions, 'conditions', out)
      conditionRefs(a.when, 'when', out)
      effectRefs(a.effect, 'effect', out)
      break
    }
    case 'ploy': {
      const p = rec as PloyData
      conditionRefs(p.when, 'when', out)
      effectRefs(p.effect, 'effect', out)
      break
    }
    case 'equipment': {
      const e = rec as EquipmentData
      e.choice?.from.forEach((id, i) => out.push({ at: `choice.from[${i}]`, id, kind: 'abilityOrWeapon' }))
      e.grants?.weapons?.forEach((id, i) => out.push({ at: `grants.weapons[${i}]`, id, kind: 'weapon' }))
      e.grants?.abilities?.forEach((id, i) => out.push({ at: `grants.abilities[${i}]`, id, kind: 'ability' }))
      e.grants?.actions?.forEach((id, i) => out.push({ at: `grants.actions[${i}]`, id, kind: 'uniqueAction' }))
      e.actions?.forEach((id, i) => out.push({ at: `actions[${i}]`, id, kind: 'uniqueAction' }))
      e.excludes?.forEach((id, i) => out.push({ at: `excludes[${i}]`, id, kind: 'equipment' }))
      conditionRefs(e.when, 'when', out)
      effectRefs(e.effect, 'effect', out)
      break
    }
    case 'team': {
      const t = rec as TeamData
      t.selection.slots.forEach((s, i) => {
        s.from.forEach((id, j) => out.push({ at: `selection.slots[${i}].from[${j}]`, id, kind: 'datacard' }))
        s.repeatable?.forEach((id, j) => out.push({ at: `selection.slots[${i}].repeatable[${j}]`, id, kind: 'datacard' }))
        s.halfSelections?.forEach((id, j) => out.push({ at: `selection.slots[${i}].halfSelections[${j}]`, id, kind: 'datacard' }))
        Object.keys(s.weights ?? {}).forEach((id) => out.push({ at: `selection.slots[${i}].weights.${id}`, id, kind: 'datacard' }))
        s.caps?.forEach((c, k) => c.from.forEach((id, j) => out.push({ at: `selection.slots[${i}].caps[${k}].from[${j}]`, id, kind: 'datacard' })))
      })
      t.factionRules.forEach((id, i) => out.push({ at: `factionRules[${i}]`, id, kind: 'ability' }))
      t.ploys.forEach((id, i) => out.push({ at: `ploys[${i}]`, id, kind: 'ploy' }))
      t.equipment.forEach((id, i) => out.push({ at: `equipment[${i}]`, id, kind: 'equipment' }))
      t.defaults?.roster?.forEach((id, i) => out.push({ at: `defaults.roster[${i}]`, id, kind: 'datacard' }))
      t.defaults?.equipment?.forEach((id, i) => out.push({ at: `defaults.equipment[${i}]`, id, kind: 'equipment' }))
      Object.entries(t.defaults?.teamChoices ?? {}).forEach(([k, id]) => out.push({ at: `defaults.teamChoices.${k}`, id, kind: 'ability' }))
      break
    }
    case 'mission': {
      const m = rec as MissionData
      m.actions.forEach((id, i) => out.push({ at: `actions[${i}]`, id, kind: 'uniqueAction' }))
      break
    }
    default:
      break
  }
  return out
}

/** Names of `code` escape hatches a record uses (effects and weapons). `params` are never walked. */
export function recordCodes(rec: DataRecord, type: RecordType): string[] {
  const names: string[] = []
  const fromEffects = (e: EffectList | undefined) => asList(e).forEach((x) => x.code && names.push(x.code))
  if (type === 'weapon') {
    const w = rec as WeaponData
    if (w.code) names.push(w.code)
  } else if (type === 'ability') {
    fromEffects((rec as AbilityData).effect)
  } else if (type === 'ploy') {
    fromEffects((rec as PloyData).effect)
  } else if (type === 'equipment') {
    fromEffects((rec as EquipmentData).effect)
  }
  return names
}

export interface RecordIndex {
  byId: Record<Id, DataRecord>
  types: Record<Id, RecordType>
  /** profileGroup id -> member profile ids. */
  groups: Record<Id, Id[]>
  /** Which file each id came from. */
  files: Record<Id, string>
  errors: string[]
}

/** Index records from parsed files (path, type, records), collecting duplicate-id errors. */
export function buildIndex(files: { path: string; type: RecordType; records: DataRecord[] }[]): RecordIndex {
  const index: RecordIndex = { byId: {}, types: {}, groups: {}, files: {}, errors: [] }
  const claim = (id: Id, path: string, what: string) => {
    if (index.files[id]) index.errors.push(`${path}: duplicate id "${id}" (${what}; first seen in ${index.files[id]})`)
    else index.files[id] = path
  }
  for (const f of files) {
    for (const rec of f.records) {
      const id = (rec as { id: Id }).id
      if (index.byId[id]) {
        claim(id, f.path, 'record')
        continue
      }
      claim(id, f.path, 'record')
      index.byId[id] = rec
      index.types[id] = f.type
    }
  }
  for (const f of files) {
    if (f.type !== 'weapon') continue
    for (const rec of f.records as WeaponData[]) {
      if (!rec.profileGroup) continue
      if (index.byId[rec.profileGroup]) {
        index.errors.push(`${f.path}: profileGroup "${rec.profileGroup}" collides with a record id`)
        continue
      }
      ;(index.groups[rec.profileGroup] ??= []).push(rec.id)
    }
  }
  return index
}

function resolves(index: RecordIndex, id: Id, kind: RefKind): boolean {
  const t = index.types[id]
  const rec = index.byId[id]
  switch (kind) {
    case 'team':
    case 'datacard':
    case 'weapon':
    case 'ploy':
    case 'equipment':
      return t === kind
    case 'weaponRule':
      return t === 'weaponRule' || (t === 'ability' && (rec as AbilityData).kind === 'weaponRule')
    case 'ability':
      return t === 'ability'
    case 'uniqueAction':
      return t === 'ability' && (rec as AbilityData).kind === 'uniqueAction'
    case 'weaponOrGroup':
      return t === 'weapon' || id in index.groups
    case 'abilityOrWeapon':
      return t === 'ability' || t === 'weapon'
    default:
      return false
  }
}

/** Dangling or wrong-kind references across the whole index, as `file: record.at: message` lines. */
export function checkRefs(index: RecordIndex): string[] {
  const errors: string[] = []
  for (const [id, rec] of Object.entries(index.byId)) {
    for (const ref of recordRefs(rec, index.types[id])) {
      if (!resolves(index, ref.id, ref.kind)) {
        const found = index.types[ref.id]
        errors.push(
          `${index.files[id]}: ${id}.${ref.at}: "${ref.id}" ${found ? `is a ${found}, expected ${ref.kind}` : `does not exist (expected ${ref.kind})`}`,
        )
      }
    }
  }
  return errors
}
