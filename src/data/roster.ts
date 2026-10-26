import type { AbilityData, DatacardData, Id, RosterSelection, SelectionSlot, Slug, TeamData } from './types'

export interface RosterCheck {
  ok: boolean
  reasons: string[]
}

/** Selections a slot's entries cost: whole entries count one each, halves together cost ceil(n / 2). */
export function slotCost(slot: SelectionSlot, ids: readonly Id[]): number {
  const half = new Set(slot.halfSelections ?? [])
  const halves = ids.filter((id) => half.has(id)).length
  return ids.length - halves + Math.ceil(halves / 2)
}

/** Check a roster against a team's selection slots. `datacards` is only used for names in reasons. */
export function validateRoster(
  team: TeamData,
  roster: RosterSelection,
  datacards: Record<Id, Pick<DatacardData, 'name' | 'team'>> = {},
): RosterCheck {
  const reasons: string[] = []
  const name = (id: Id) => datacards[id]?.name ?? id
  const known = new Set(team.selection.slots.map((s) => s.id))
  for (const key of Object.keys(roster)) if (!known.has(key)) reasons.push(`unknown slot "${key}"`)
  for (const slot of team.selection.slots) {
    const ids = roster[slot.id] ?? []
    const repeatable = new Set(slot.repeatable ?? [])
    const counts = new Map<Id, number>()
    for (const id of ids) {
      if (!slot.from.includes(id)) reasons.push(`${slot.label ?? slot.id}: ${name(id)} is not on this list`)
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const [id, n] of counts) {
      if (n > 1 && !repeatable.has(id)) reasons.push(`${slot.label ?? slot.id}: ${name(id)} can be taken only once (taken ${n} times)`)
    }
    const cost = slotCost(slot, ids)
    if (cost !== slot.count) {
      reasons.push(`${slot.label ?? slot.id}: ${cost} selections chosen, ${slot.count} required`)
    }
  }
  return { ok: reasons.length === 0, reasons }
}

/** Number of operatives a roster fields. */
export function rosterSize(roster: RosterSelection): number {
  return Object.values(roster).reduce((n, ids) => n + ids.length, 0)
}

function* slotRosters(slot: SelectionSlot): Generator<Id[]> {
  const half = new Set(slot.halfSelections ?? [])
  const repeatable = new Set(slot.repeatable ?? [])
  const entries = slot.from
  function* go(i: number, whole: number, halves: number, acc: Id[]): Generator<Id[]> {
    const cost = whole + Math.ceil(halves / 2)
    if (cost > slot.count) return
    if (i === entries.length) {
      if (cost === slot.count) yield [...acc]
      return
    }
    const id = entries[i]
    const isHalf = half.has(id)
    const max = repeatable.has(id) ? slot.count : 1
    for (let c = 0; c <= max; c++) {
      const nextWhole = isHalf ? whole : whole + c
      const nextHalves = isHalf ? halves + c : halves
      if (nextWhole + Math.ceil(nextHalves / 2) > slot.count) break
      yield* go(i + 1, nextWhole, nextHalves, [...acc, ...Array<Id>(c).fill(id)])
    }
  }
  yield* go(0, 0, 0, [])
}

/** Lazily enumerate every legal roster shape (which datacards, not loadouts or tactics). */
export function* enumerateRosters(team: TeamData): Generator<RosterSelection> {
  const slots = team.selection.slots
  function* go(i: number, acc: RosterSelection): Generator<RosterSelection> {
    if (i === slots.length) {
      yield { ...acc }
      return
    }
    for (const ids of slotRosters(slots[i])) yield* go(i + 1, { ...acc, [slots[i].id]: ids })
  }
  yield* go(0, {})
}

/** Reasons the team-level picks (Chapter Tactics and the like) are illegal; empty when legal. */
export function validateTeamChoices(
  team: TeamData,
  choices: Record<Slug, Id>,
  abilities: Record<Id, Pick<AbilityData, 'choiceGroup'>>,
): string[] {
  const reasons: string[] = []
  for (const tc of team.teamChoices ?? []) {
    const pick = choices[tc.id]
    if (!pick) {
      reasons.push(`${tc.label}: not chosen`)
      continue
    }
    if (abilities[pick]?.choiceGroup !== tc.group) reasons.push(`${tc.label}: "${pick}" is not a ${tc.group}`)
    for (const other of tc.distinctFrom ?? []) {
      if (choices[other] === pick) reasons.push(`${tc.label}: must differ from the ${other} pick`)
    }
  }
  for (const key of Object.keys(choices)) {
    if (!(team.teamChoices ?? []).some((t) => t.id === key)) reasons.push(`unknown team choice "${key}"`)
  }
  return reasons
}
