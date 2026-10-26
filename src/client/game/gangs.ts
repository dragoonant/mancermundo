// The starter gangs as the gang picker shows them: each fighter with its type, role, cost, characteristics, weapons (full profiles),
// wargear and skills, and the gang's cost. Read from the engine's runtime bundle, so the names and numbers are the ones the battle
// will use. Pure: no store, no DOM.
import type { RuntimeFighterType, RuntimeStarterGang, RuntimeWeapon, StatKey } from '@/engine'
import { engineBundle } from './adapter'
import { humanize } from './labels'

export interface RosterEntry {
  name: string
  typeId: string
  typeName: string
  role: string
  cost: number
  stats: Record<StatKey, number>
  weapons: RuntimeWeapon[]
  wargear: { id: string; name: string; save: number | null }[]
  skills: string[]
  rules: { name: string; x?: number }[]
}

export interface GangSummary {
  id: string
  name: string
  houseId: string
  credits: number
  /** fighter costs added up (the printed price list: type, weapons, wargear) */
  cost: number
  fighters: RosterEntry[]
}

export function gangSummary(starterId: string): GangSummary | null {
  const b = engineBundle()
  const g: RuntimeStarterGang | undefined = b.starterGangs?.[starterId]
  if (!g) return null
  const fighters: RosterEntry[] = g.fighters.map((f) => {
    const t: RuntimeFighterType | undefined = b.fighterTypes[f.typeId]
    const weapons = f.weapons.map((id) => b.weapons[id]).filter((w): w is RuntimeWeapon => !!w)
    const gear = f.wargear.map((id) => b.wargear[id]).filter((w) => !!w)
    const cost = (t?.cost ?? 0) + weapons.reduce((a, w) => a + w.cost, 0) + gear.reduce((a, w) => a + (w?.cost ?? 0), 0)
    return {
      name: f.name,
      typeId: f.typeId,
      typeName: t?.name ?? humanize(f.typeId),
      role: t?.role ?? 'ganger',
      cost,
      stats: t?.stats ?? ({} as Record<StatKey, number>),
      weapons,
      wargear: gear.map((w) => ({ id: w!.id, name: w!.name, save: w!.save ?? null })),
      skills: f.skills.map((id) => b.skills[id]?.name ?? humanize(id)),
      rules: (t?.rules ?? []).map((r) => ({ name: (b.skills[r.id]?.name ?? humanize(r.id)).replace(/ \(X\)$/, ''), ...(r.x !== undefined ? { x: r.x } : {}) })),
    }
  })
  return { id: g.id, name: g.name, houseId: g.houseId, credits: g.credits, cost: fighters.reduce((a, f) => a + f.cost, 0), fighters }
}

const ROLE_ORDER = ['leader', 'champion', 'specialist', 'ganger', 'juve', 'prospect']

/** Roles in the order a gang is read: leader first, prospects last. */
export function roleRank(role: string): number {
  const i = ROLE_ORDER.indexOf(role)
  return i < 0 ? ROLE_ORDER.length : i
}

export const ROLE_WORD: Record<string, string> = { leader: 'Leader', champion: 'Champion', specialist: 'Specialist', ganger: 'Ganger', juve: 'Juve', prospect: 'Prospect' }
