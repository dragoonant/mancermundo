import { defaultLoadout, enumerateLoadouts, resolveLoadout } from './loadout'
import type { AbilityData, DatacardData, Id, Keyword, LoadoutChoice, OperativeChoice, RosterSelection, SelectionSlot, Slug, TeamData } from './types'

export interface RosterCheck {
  ok: boolean
  reasons: string[]
}

/** Selections a slot's entries cost: whole entries count one each (or their weight), halves together cost ceil(n / 2). */
export function slotCost(slot: SelectionSlot, ids: readonly Id[]): number {
  const half = new Set(slot.halfSelections ?? [])
  const halves = ids.filter((id) => half.has(id)).length
  const whole = ids.filter((id) => !half.has(id)).reduce((n, id) => n + (slot.weights?.[id] ?? 1), 0)
  return whole + Math.ceil(halves / 2)
}

/** Caps a slot's entries break (M9 prep: at most two GUNNER operatives, at most two cult agents). */
export function capProblems(slot: SelectionSlot, ids: readonly Id[], name: (id: Id) => string = (id) => id): string[] {
  const out: string[] = []
  for (const c of slot.caps ?? []) {
    const n = ids.filter((id) => c.from.includes(id)).length
    if (n > c.max) out.push(`${slot.label ?? slot.id}: at most ${c.max} of ${c.label ?? c.from.map(name).join(', ')} (taken ${n})`)
  }
  return out
}

/** Check a roster against a team's selection slots. `datacards` is only used for names in reasons. */
export function validateRoster(
  team: TeamData,
  roster: RosterSelection,
  datacards: Record<Id, Pick<DatacardData, 'name' | 'team'> & Partial<Pick<DatacardData, 'keywords'>>> = {},
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
    reasons.push(...capProblems(slot, ids, name))
    const cost = slotCost(slot, ids)
    if (cost !== slot.count) {
      reasons.push(`${slot.label ?? slot.id}: ${cost} selections chosen, ${slot.count} required`)
    }
  }
  reasons.push(...teamCapProblems(team, team.selection.slots.flatMap((sl) => roster[sl.id] ?? []), datacards))
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
    if (capProblems(slot, acc).length > 0) return
    if (i === entries.length) {
      if (cost === slot.count) yield [...acc]
      return
    }
    const id = entries[i]
    const isHalf = half.has(id)
    const weight = slot.weights?.[id] ?? 1
    const max = repeatable.has(id) ? slot.count : 1
    for (let c = 0; c <= max; c++) {
      const nextWhole = isHalf ? whole : whole + c * weight
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

// ---------------------------------------------------------------------------
// M9 batch B: per-operative keyword picks (Legionaries Marks of Chaos)
// ---------------------------------------------------------------------------

/** The team's operative choices that apply to this datacard (forKeyword filter). */
export function operativeChoicesFor(team: Pick<TeamData, 'operativeChoices'>, card: Pick<DatacardData, 'keywords'>): OperativeChoice[] {
  return (team.operativeChoices ?? []).filter((c) => !c.forKeyword || card.keywords.includes(c.forKeyword))
}

/** Keywords this datacard may take for the choice (exclusions removed), in data order. */
export function allowedOperativePicks(choice: OperativeChoice, card: Pick<DatacardData, 'id'>): Keyword[] {
  const barred = new Set((choice.exclude ?? []).filter((e) => e.datacards.includes(card.id)).flatMap((e) => e.keywords))
  return choice.keywords.filter((k) => !barred.has(k))
}

/**
 * The first allowed keyword of every choice that applies to the datacard. M9 batch C: skipping keywords other roster
 * entries already hold for a `unique` choice (`taken`: choice id -> picks) and the card's own picks a `distinctFrom`
 * names, while another allowed keyword is left.
 */
export function defaultOperativePicks(team: Pick<TeamData, 'operativeChoices'>, card: Pick<DatacardData, 'id' | 'keywords'>, taken: Record<Slug, Keyword[]> = {}): Record<Slug, Keyword> {
  const out: Record<Slug, Keyword> = {}
  for (const c of operativeChoicesFor(team, card)) {
    const allowed = allowedOperativePicks(c, card)
    const free = allowed.find((k) => !(c.unique && (taken[c.id] ?? []).includes(k)) && !(c.distinctFrom ?? []).some((o) => out[o] === k))
    const first = free ?? allowed[0]
    if (first) out[c.id] = first
  }
  return out
}

/** M9 batch C: default picks for a whole roster in order, keeping `unique` choices apart (explicit picks win). */
export function defaultRosterPicks(team: Pick<TeamData, 'operativeChoices'>, cards: readonly Pick<DatacardData, 'id' | 'keywords'>[], explicit: readonly (Record<Slug, Keyword> | undefined)[] = []): Record<Slug, Keyword>[] {
  const taken: Record<Slug, Keyword[]> = {}
  for (const e of explicit) for (const [k, v] of Object.entries(e ?? {})) (taken[k] ??= []).push(v)
  return cards.map((card, i) => {
    const picks = { ...defaultOperativePicks(team, card, taken), ...(explicit[i] ?? {}) }
    if (!explicit[i]) for (const [k, v] of Object.entries(picks)) (taken[k] ??= []).push(v)
    else for (const [k, v] of Object.entries(picks)) if (!(k in (explicit[i] ?? {}))) (taken[k] ??= []).push(v)
    return picks
  })
}

/** M9 batch C: roster-wide pick problems: a `unique` choice taken twice across the roster. */
export function rosterPickProblems(team: Pick<TeamData, 'operativeChoices'>, picks: readonly (Record<Slug, Keyword> | undefined)[]): string[] {
  const out: string[] = []
  for (const c of team.operativeChoices ?? []) {
    if (!c.unique) continue
    const seen = new Map<Keyword, number>()
    for (const p of picks) if (p?.[c.id]) seen.set(p[c.id]!, (seen.get(p[c.id]!) ?? 0) + 1)
    for (const [k, n] of seen) if (n > 1) out.push(`${c.label}: ${k} is taken ${n} times (each at most once)`)
  }
  return out
}

/** Reasons an operative's picks are illegal (missing, unknown choice, not allowed); empty when legal. */
export function validateOperativePicks(team: Pick<TeamData, 'operativeChoices'>, card: Pick<DatacardData, 'id' | 'keywords' | 'name'>, picks: Record<Slug, Keyword> = {}): string[] {
  const reasons: string[] = []
  const applies = operativeChoicesFor(team, card)
  for (const c of applies) {
    const pick = picks[c.id]
    if (!pick) reasons.push(`${card.name}: ${c.label} not chosen`)
    else if (!allowedOperativePicks(c, card).includes(pick)) reasons.push(`${card.name}: ${c.label} cannot be ${pick}`)
    else if ((c.distinctFrom ?? []).some((o) => picks[o] === pick)) reasons.push(`${card.name}: ${c.label} must differ from its other picks (${pick})`)
  }
  for (const key of Object.keys(picks)) if (!applies.some((c) => c.id === key)) reasons.push(`${card.name}: no operative choice "${key}"`)
  return reasons
}

// ---------------------------------------------------------------------------
// M9 batch B: caps across slots (keyword caps) and across loadouts (weapon caps)
// ---------------------------------------------------------------------------

/**
 * Team-level caps counted over every slot (`selection.caps`). A keyword cap needs the datacards' keywords; a datacard
 * missing from `datacards` counts as not having the keyword.
 */
export function teamCapProblems(
  team: Pick<TeamData, 'selection'>,
  ids: readonly Id[],
  datacards: Record<Id, Partial<Pick<DatacardData, 'name' | 'keywords'>>> = {},
): string[] {
  const out: string[] = []
  for (const c of team.selection.caps ?? []) {
    const n = ids.filter((id) => (c.from ?? []).includes(id) || (!!c.keyword && (datacards[id]?.keywords ?? []).includes(c.keyword))).length
    const what = c.label ?? c.keyword ?? (c.from ?? []).map((id) => datacards[id]?.name ?? id).join(', ')
    if (c.max !== undefined && n > c.max) out.push(`at most ${c.max} ${what} (taken ${n})`)
    // M9 batch C: a minimum (at least one SORCERER)
    if (c.min !== undefined && n < c.min) out.push(`at least ${c.min} ${what} (taken ${n})`)
  }
  // M9 batch C: datacards that need another on the roster (Gheistskull needs Void-Jammer)
  for (const r of team.selection.requires ?? []) {
    if (ids.includes(r.id) && !r.needs.some((n) => ids.includes(n))) {
      out.push(r.label ?? `${datacards[r.id]?.name ?? r.id} needs ${r.needs.map((n) => datacards[n]?.name ?? n).join(' or ')} on the roster`)
    }
  }
  return out
}

/** Expand a cap's weapon ids (profile or profileGroup) to profile ids. */
function capWeapons(ids: readonly Id[], groups: Record<Id, Id[]>): Set<Id> {
  return new Set(ids.flatMap((id) => groups[id] ?? [id]))
}

/** Loadout caps (`selection.loadoutCaps`) broken by the roster; `carried` is each operative's weapon profile ids (fixed plus chosen). */
export function loadoutCapProblems(team: Pick<TeamData, 'selection'>, carried: readonly (readonly Id[])[], groups: Record<Id, Id[]> = {}, name: (id: Id) => string = (id) => id): string[] {
  const out: string[] = []
  for (const c of team.selection.loadoutCaps ?? []) {
    if (c.each) {
      for (const w of c.weapons) {
        const set = capWeapons([w], groups)
        const n = carried.filter((ws) => ws.some((x) => set.has(x))).length
        if (n > c.max) out.push(`at most ${c.max} ${c.label ? `${c.label}: ` : ''}${name(w)} (taken ${n})`)
      }
    } else {
      const set = capWeapons(c.weapons, groups)
      const n = carried.filter((ws) => ws.some((x) => set.has(x))).length
      if (n > c.max) out.push(`at most ${c.max} ${c.label ?? c.weapons.map(name).join(' / ')} (taken ${n})`)
    }
  }
  return out
}

/**
 * Loadout answers for a roster that respect the loadout caps: each operative takes its first legal loadout that keeps
 * every cap (falling back to its first loadout when none does). `cards` in roster order.
 */
export function capAwareLoadouts(team: Pick<TeamData, 'selection'>, cards: readonly DatacardData[], groups: Record<Id, Id[]> = {}): LoadoutChoice[] {
  const chosen: LoadoutChoice[] = []
  const carried: Id[][] = []
  for (const card of cards) {
    const options = enumerateLoadouts(card)
    let pick = options[0] ?? defaultLoadout(card)
    if ((team.selection.loadoutCaps ?? []).length > 0) {
      for (const o of options) {
        if (loadoutCapProblems(team, [...carried, resolveLoadout(card, o, groups)], groups).length === 0) {
          pick = o
          break
        }
      }
    }
    chosen.push(pick)
    carried.push(resolveLoadout(card, pick, groups))
  }
  return chosen
}
