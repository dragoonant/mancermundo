// Defaults and lookups for the quick-setup screen and ?test=1: scenario, board and starter gang lists, and lenient resolution of
// ids typed in the address (full id or slug). Pure; reads the data bundle only.
import type { DataBundle, ScenarioData, StarterGangData } from '@/data/types'
import type { Seat } from '@/engine'
import { scenarioPlayable } from './adapter'

export function scenarioList(b: DataBundle): ScenarioData[] {
  return Object.values(b.scenarios).sort((p, q) => (p.id < q.id ? -1 : 1))
}

export function starterList(b: DataBundle): StarterGangData[] {
  return Object.values(b.starterGangs).sort((p, q) => (p.id < q.id ? -1 : 1))
}

/** Boards the scenario can be played on (the board lists the scenario and the layout matches), sorted by name. */
export function boardsForScenario(b: DataBundle, scenarioId: string): { id: string; name: string; layout: string }[] {
  const s = b.scenarios[scenarioId]
  return Object.values(b.boards)
    .filter((x) => x.scenarios.includes(scenarioId) && (!s || s.layouts.includes(x.layout)))
    .map((x) => ({ id: x.id, name: x.name, layout: x.layout }))
    .sort((p, q) => (p.name < q.name ? -1 : 1))
}

function bySlug<T extends { id: string }>(items: readonly T[], wanted: string | null | undefined): T | null {
  if (!wanted) return null
  const w = wanted.toLowerCase()
  return items.find((i) => i.id.toLowerCase() === w) ?? items.find((i) => i.id.toLowerCase().endsWith(`.${w}`)) ?? null
}

/** The scenario asked for (id or slug), else the first one the engine can play. */
export function resolveScenario(b: DataBundle, wanted: string | null | undefined): ScenarioData {
  const list = scenarioList(b)
  return bySlug(list, wanted) ?? list.find((s) => s.id === 'scn.tunnel-skirmish' && scenarioPlayable(s.id)) ?? list.find((s) => scenarioPlayable(s.id)) ?? list[0]!
}

export function resolveBoard(b: DataBundle, scenarioId: string, wanted: string | null | undefined): string {
  const boards = boardsForScenario(b, scenarioId)
  return bySlug(boards, wanted)?.id ?? boards[0]!.id
}

/** A starter gang from an id, a house prefix / id (`gol`, `goliath`), or the nth gang as a fallback. */
export function resolveStarter(b: DataBundle, wanted: string | null | undefined, fallbackIndex: number): StarterGangData {
  const list = starterList(b)
  if (wanted) {
    const w = wanted.toLowerCase()
    const exact = list.find((g) => g.id.toLowerCase() === w)
    if (exact) return exact
    const house = Object.values(b.houses).find((h) => h.id === w || h.prefix === w)
    const ofHouse = house ? list.find((g) => g.house === house.id) : undefined
    if (ofHouse) return ofHouse
  }
  return list[fallbackIndex % list.length]!
}

/** Default pairing: the first Goliath starter gang (seat A) against the first Escher one (seat B). */
export function defaultStarters(b: DataBundle): Record<Seat, string> {
  return { A: resolveStarter(b, 'goliath', 0).id, B: resolveStarter(b, 'escher', 1).id }
}

export function houseName(b: DataBundle, houseId: string): string {
  return b.houses[houseId]?.name ?? houseId
}
