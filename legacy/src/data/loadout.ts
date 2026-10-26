import type { DatacardData, Id, LoadoutChoice, LoadoutSlot } from './types'

/** profileGroup id -> member profile ids, as held by DataBundle.weaponGroups. */
export type WeaponGroups = Record<Id, Id[]>

/** A weapon reference in a datacard is either a profile id or a profileGroup id. */
export function expandWeaponRef(ref: Id, groups: WeaponGroups): Id[] {
  return groups[ref] ? [...groups[ref]] : [ref]
}

function check(slots: LoadoutSlot[], choice: LoadoutChoice, errors: string[], seen: Set<string>): void {
  for (const slot of slots) {
    seen.add(slot.id)
    const answer = choice[slot.id] ?? []
    if (slot.sets) {
      if (answer.length !== 1) {
        errors.push(`${slot.id}: choose exactly one of ${slot.sets.map((s) => s.id).join(', ')}`)
        continue
      }
      const set = slot.sets.find((s) => s.id === answer[0])
      if (!set) {
        errors.push(`${slot.id}: unknown set "${answer[0]}"`)
        continue
      }
      check(set.options ?? [], choice, errors, seen)
      continue
    }
    const pick = slot.pick ?? 1
    const min = slot.min ?? pick
    if (answer.length < min || answer.length > pick) {
      errors.push(`${slot.id}: choose ${min === pick ? pick : `${min} to ${pick}`}, got ${answer.length}`)
    }
    if (new Set(answer).size !== answer.length) errors.push(`${slot.id}: the same weapon is picked twice`)
    for (const a of answer) {
      if (!(slot.from ?? []).includes(a)) errors.push(`${slot.id}: "${a}" is not an option`)
    }
  }
}

/** Reasons a loadout choice is illegal for a datacard; empty when legal. */
export function validateLoadout(card: DatacardData, choice: LoadoutChoice): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  check(card.weapons.options ?? [], choice, errors, seen)
  for (const key of Object.keys(choice)) {
    if (!seen.has(key)) errors.push(`${key}: not a slot of ${card.name} for the chosen sets`)
  }
  return errors
}

function collect(slots: LoadoutSlot[], choice: LoadoutChoice, out: Id[]): void {
  for (const slot of slots) {
    const answer = choice[slot.id] ?? []
    if (slot.sets) {
      const set = slot.sets.find((s) => s.id === answer[0])
      if (!set) continue
      out.push(...(set.fixed ?? []))
      collect(set.options ?? [], choice, out)
    } else {
      out.push(...answer)
    }
  }
}

/** The weapon profile ids an operative carries for a (valid) loadout: fixed plus chosen, groups expanded, de-duplicated. */
export function resolveLoadout(card: DatacardData, choice: LoadoutChoice, groups: WeaponGroups): Id[] {
  const refs: Id[] = [...card.weapons.fixed]
  collect(card.weapons.options ?? [], choice, refs)
  const ids: Id[] = []
  for (const r of refs) for (const id of expandWeaponRef(r, groups)) if (!ids.includes(id)) ids.push(id)
  return ids
}

function firstChoice(slots: LoadoutSlot[], choice: LoadoutChoice): void {
  for (const slot of slots) {
    if (slot.sets) {
      choice[slot.id] = [slot.sets[0].id]
      firstChoice(slot.sets[0].options ?? [], choice)
    } else {
      choice[slot.id] = (slot.from ?? []).slice(0, slot.pick ?? 1)
    }
  }
}

/** The first legal loadout (first set, first options). */
export function defaultLoadout(card: DatacardData): LoadoutChoice {
  const choice: LoadoutChoice = {}
  firstChoice(card.weapons.options ?? [], choice)
  return choice
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const [head, ...rest] = items
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)]
}

function slotChoices(slot: LoadoutSlot): LoadoutChoice[] {
  if (slot.sets) {
    const out: LoadoutChoice[] = []
    for (const set of slot.sets) {
      for (const sub of product(set.options ?? [])) out.push({ [slot.id]: [set.id], ...sub })
    }
    return out
  }
  const pick = slot.pick ?? 1
  const min = slot.min ?? pick
  const out: LoadoutChoice[] = []
  for (let k = min; k <= pick; k++) for (const c of combinations(slot.from ?? [], k)) out.push({ [slot.id]: c })
  return out
}

function product(slots: LoadoutSlot[]): LoadoutChoice[] {
  let acc: LoadoutChoice[] = [{}]
  for (const slot of slots) {
    const next: LoadoutChoice[] = []
    for (const base of acc) for (const c of slotChoices(slot)) next.push({ ...base, ...c })
    acc = next
  }
  return acc
}

/** Every legal loadout for a datacard (small: at most a few dozen for v1 teams). */
export function enumerateLoadouts(card: DatacardData): LoadoutChoice[] {
  return product(card.weapons.options ?? [])
}
