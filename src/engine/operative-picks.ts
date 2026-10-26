// Per-operative keyword picks (M9 batch B, generic capability "operativeKeywordChoice"). A team's
// `operativeChoices` (team.json) give every eligible operative one keyword at selection, Legionaries Marks of
// Chaos (KHORNE, NURGLE, SLAANESH, TZEENTCH, UNDIVIDED; a BALEFIRE ACOLYTE is never KHORNE). The pick is stored
// on the roster entry and on the operative (`Operative.picks`), counts as a real keyword for every rule
// (conditions.hasKeyword), is public in view, and changes only through setOperativePick (Infernal Pact), which
// emits OperativePickChanged. Pure helpers take the state; setOperativePick takes the step Ctx.
import type { Ctx } from './registry'
import type { GameState, Operative, RuntimeDatacard, RuntimeTeam } from './types'

export type RuntimeOperativeChoice = NonNullable<RuntimeTeam['operativeChoices']>[number]

/** The team's operative choices that apply to this datacard. */
export function choicesForCard(team: RuntimeTeam | undefined, card: Pick<RuntimeDatacard, 'keywords'>): RuntimeOperativeChoice[] {
  return (team?.operativeChoices ?? []).filter((c) => !c.forKeyword || card.keywords.includes(c.forKeyword))
}

/** batch C shared: how a pick reads in the UI (the choice's `labels`, else the keyword itself). */
export function pickLabel(choice: Pick<RuntimeOperativeChoice, 'labels'>, keyword: string): string {
  return choice.labels?.[keyword] ?? keyword
}

/** Keywords the datacard may take for the choice, in data order. */
export function allowedPicks(choice: RuntimeOperativeChoice, card: Pick<RuntimeDatacard, 'id'>): string[] {
  const barred = new Set((choice.exclude ?? []).filter((e) => e.datacards.includes(card.id)).flatMap((e) => e.keywords))
  return choice.keywords.filter((k) => !barred.has(k))
}

/**
 * Picks for a roster entry: the asked ones, missing ones filled with the first allowed keyword; a reason when illegal.
 * M9 batch C: `taken` (choice id -> picks other entries of the roster already hold) keeps `unique` choices apart, and
 * `distinctFrom` keeps one operative's picks apart; missing picks are filled around both.
 */
export function resolvePicks(
  team: RuntimeTeam | undefined,
  card: Pick<RuntimeDatacard, 'id' | 'keywords'>,
  asked: Record<string, string> = {},
  taken: Record<string, string[]> = {},
): { picks: Record<string, string>; problem: string | null } {
  const picks: Record<string, string> = {}
  const applies = choicesForCard(team, card)
  for (const key of Object.keys(asked)) if (!applies.some((c) => c.id === key)) return { picks, problem: `${card.id} has no operative choice "${key}"` }
  for (const c of applies) {
    const allowed = allowedPicks(c, card)
    const clash = (k: string): boolean => (c.unique === true && (taken[c.id] ?? []).includes(k)) || (c.distinctFrom ?? []).some((o) => picks[o] === k || asked[o] === k)
    const pick = asked[c.id] ?? allowed.find((k) => !clash(k)) ?? allowed[0]
    if (!pick || !allowed.includes(pick)) return { picks, problem: `${card.id} cannot take ${pick ?? 'nothing'} for ${c.label}` }
    if (c.unique === true && (taken[c.id] ?? []).includes(pick)) return { picks, problem: `${card.id}: ${pick} is already taken by another operative for ${c.label}` }
    if ((c.distinctFrom ?? []).some((o) => picks[o] === pick)) return { picks, problem: `${card.id}: ${c.label} must differ from its other picks (${pick})` }
    picks[c.id] = pick
  }
  return { picks, problem: null }
}

/** M9 batch C: record an entry's picks in a roster-wide `taken` map (for `unique` choices). */
export function notePicks(taken: Record<string, string[]>, picks: Record<string, string>): void {
  for (const [k, v] of Object.entries(picks)) (taken[k] ??= []).push(v)
}

/** M9 batch C: the operative's picks that are real keywords (choices with `keyword: false` are tags for team code). */
export function keywordPicks(state: GameState, op: Operative): string[] {
  if (!op.picks) return []
  const team = state.data.teams[state.players[op.seat]?.teamId ?? '']
  const tags = new Set((team?.operativeChoices ?? []).filter((c) => c.keyword === false).map((c) => c.id))
  return Object.entries(op.picks).filter(([k]) => !tags.has(k)).map(([, v]) => v)
}

/** The operative's current pick for a choice, or null. */
export function pickOf(op: Operative, choiceId: string): string | null {
  return op.picks?.[choiceId] ?? null
}

/**
 * Keywords the operative could switch to for a choice (allowed and different from its current pick). M9 batch C: a
 * `unique` choice also skips picks other friendly operatives still in the battle hold (Sorcerous Scrolls), and
 * `distinctFrom` skips the operative's own other picks.
 */
export function pickAlternatives(state: GameState, op: Operative, choiceId: string): string[] {
  const team = state.data.teams[state.players[op.seat].teamId]
  const card = state.data.datacards[op.datacardId]
  const choice = choicesForCard(team, card ?? { keywords: [] }).find((c) => c.id === choiceId)
  if (!choice || !card) return []
  const now = pickOf(op, choiceId)
  const held = new Set<string>()
  if (choice.unique === true) {
    for (const o of Object.values(state.operatives)) if (o.seat === op.seat && o.id !== op.id && o.status !== 'removed' && o.picks?.[choiceId]) held.add(o.picks[choiceId]!)
  }
  for (const other of choice.distinctFrom ?? []) if (op.picks?.[other]) held.add(op.picks[other]!)
  return allowedPicks(choice, card).filter((k) => k !== now && !held.has(k))
}

/** Change an operative's pick (Infernal Pact). Returns false (and changes nothing) when the keyword is not allowed. */
export function setOperativePick(ctx: Ctx, opId: string, choiceId: string, keyword: string, reason: string): boolean {
  const op = ctx.state.operatives[opId]
  if (!op) return false
  const from = pickOf(op, choiceId)
  if (from === keyword) return true
  if (!pickAlternatives(ctx.state, op, choiceId).includes(keyword)) return false
  op.picks = { ...(op.picks ?? {}), [choiceId]: keyword }
  ctx.emit({ type: 'OperativePickChanged', operativeId: op.id, choiceId, from, to: keyword, reason })
  return true
}
