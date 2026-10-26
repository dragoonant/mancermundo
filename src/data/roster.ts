import type { ConstantsData, DataBundle, EquipmentListData, FighterTypeData, HouseData, Id, Role, StarterGangData, WeaponData } from './types'

/** The slice of a bundle the roster helpers read. */
export type RosterBundle = Pick<DataBundle, 'houses' | 'fighterTypes' | 'equipmentLists' | 'weapons' | 'wargear' | 'starterGangs' | 'constants'>

/** Same shape as `RosterFighter` in docs/spec/00-architecture.md section 7 (`GameSetup.gangs[seat].roster`). */
export interface RosterFighter {
  id: string
  typeId: Id
  name: string
  weapons: Id[]
  wargear: Id[]
  skills: Id[]
}

export interface GangSetup {
  houseId: Id
  name: string
  starterId: Id
  roster: RosterFighter[]
}

const UNWIELDY = 'core.t.unwieldy'

/** Weapon slots a weapon takes (Unwieldy takes two, R-14.3). */
export function weaponSlots(weapon: WeaponData, constants: Pick<ConstantsData, 'loadout'>): number {
  const unwieldy = weapon.profiles.some((p) => p.traits.some((t) => t.trait === UNWIELDY))
  return unwieldy ? constants.loadout.unwieldySlots : 1
}

/**
 * Build the engine roster of a starter gang. Fighter ids are `<idPrefix><n>` (n from 1); pass a different prefix per seat
 * (for example `a` and `b`) so a mirror match never repeats an id.
 */
export function rosterFromStarter(bundle: Pick<RosterBundle, 'starterGangs'>, starterId: Id, idPrefix = 'f'): GangSetup {
  const sg = bundle.starterGangs[starterId]
  if (!sg) throw new Error(`data: unknown starter gang "${starterId}"`)
  return {
    houseId: sg.house,
    name: sg.name,
    starterId: sg.id,
    roster: sg.fighters.map((f, i) => ({
      id: `${idPrefix}${i + 1}`,
      typeId: f.type,
      name: f.name,
      weapons: [...f.weapons],
      wargear: [...f.wargear],
      skills: [...f.skills],
    })),
  }
}

/** Cost of one starter fighter: the type's cost plus each weapon and wargear item at its price on the type's equipment list. Unlisted items cost nothing here (they are reported by `starterGangProblems`). */
export function starterFighterCost(
  bundle: Pick<RosterBundle, 'fighterTypes' | 'equipmentLists'>,
  fighter: StarterGangData['fighters'][number],
): number {
  const type = bundle.fighterTypes[fighter.type]
  if (!type) return 0
  const list = bundle.equipmentLists[type.equipmentList]
  const price = (kind: 'weapons' | 'wargear', id: Id) => list?.[kind].find((p) => p.id === id)?.cost ?? 0
  return type.cost + fighter.weapons.reduce((n, id) => n + price('weapons', id), 0) + fighter.wargear.reduce((n, id) => n + price('wargear', id), 0)
}

export function starterGangCost(bundle: Pick<RosterBundle, 'fighterTypes' | 'equipmentLists'>, sg: StarterGangData): number {
  return sg.fighters.reduce((n, f) => n + starterFighterCost(bundle, f), 0)
}

/** Check a list of fighter types against the house composition (roles, size, ratio and per-type limits). */
export function compositionProblems(house: HouseData, types: FighterTypeData[]): string[] {
  const out: string[] = []
  const c = house.composition
  if (types.length < c.minFighters) out.push(`has ${types.length} fighters, needs at least ${c.minFighters}`)
  if (c.maxFighters !== undefined && types.length > c.maxFighters) out.push(`has ${types.length} fighters, at most ${c.maxFighters}`)
  const byRole = new Map<Role, number>()
  for (const t of types) byRole.set(t.role, (byRole.get(t.role) ?? 0) + 1)
  for (const [role, limit] of Object.entries(c.roles) as [Role, { min?: number; max?: number }][]) {
    const n = byRole.get(role) ?? 0
    if (limit.min !== undefined && n < limit.min) out.push(`has ${n} ${role}, needs at least ${limit.min}`)
    if (limit.max !== undefined && n > limit.max) out.push(`has ${n} ${role}, at most ${limit.max}`)
  }
  for (const r of c.ratio ?? []) {
    const n = types.filter((t) => r.roles.includes(t.role)).length
    if (r.atLeastHalf && n * 2 < types.length) out.push(`has ${n} of ${types.length} as ${r.roles.join('/')}, needs at least half`)
  }
  const byType = new Map<Id, number>()
  for (const t of types) byType.set(t.id, (byType.get(t.id) ?? 0) + 1)
  for (const t of types) {
    const n = byType.get(t.id) ?? 0
    if (t.limits?.max !== undefined && n > t.limits.max) out.push(`has ${n} of ${t.id}, at most ${t.limits.max}`)
  }
  for (const [id, n] of byType) {
    const t = types.find((x) => x.id === id)!
    if (t.limits?.min !== undefined && n < t.limits.min) out.push(`has ${n} of ${id}, needs at least ${t.limits.min}`)
  }
  return out
}

/** Why a starter gang is not legal (empty list = legal). Unknown ids are reported by the reference check; they are skipped here. */
export function starterGangProblems(bundle: RosterBundle, sg: StarterGangData): string[] {
  const out: string[] = []
  const house = bundle.houses[sg.house]
  const types: FighterTypeData[] = []
  sg.fighters.forEach((f, i) => {
    const at = `fighters[${i}] (${f.name})`
    const type = bundle.fighterTypes[f.type]
    if (!type) return
    types.push(type)
    if (type.house !== sg.house) out.push(`${at}: ${f.type} belongs to ${type.house}, not ${sg.house}`)
    const list: EquipmentListData | undefined = bundle.equipmentLists[type.equipmentList]
    let slots = 0
    for (const id of f.weapons) {
      const w = bundle.weapons[id]
      if (!w) continue
      if (list && !list.weapons.some((p) => p.id === id)) out.push(`${at}: weapon ${id} is not on ${type.equipmentList}`)
      slots += weaponSlots(w, bundle.constants)
    }
    if (slots > bundle.constants.loadout.maxWeapons) out.push(`${at}: carries ${slots} weapon slots, at most ${bundle.constants.loadout.maxWeapons}`)
    let armour = 0
    for (const id of f.wargear) {
      const g = bundle.wargear[id]
      if (!g) continue
      if (list && !list.wargear.some((p) => p.id === id)) out.push(`${at}: wargear ${id} is not on ${type.equipmentList}`)
      if (g.kind === 'armour') armour++
    }
    if (armour > 1) out.push(`${at}: carries ${armour} armour items, at most 1`)
  })
  const cost = starterGangCost(bundle, sg)
  if (cost > sg.credits) out.push(`costs ${cost}, over its ${sg.credits} credits`)
  if (house) out.push(...compositionProblems(house, types).map((m) => `composition: ${m}`))
  return out
}
