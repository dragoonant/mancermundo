// Checks that need the compiled board (stage S1Z): room for a full crew in every deployment region of every scenario a
// board lists, and reachability of every region and casket spot without opening a locked door. The structural board checks
// (ZM-001, ZM-012, door gaps, terminals, ducts) are data-side in src/data/zm/checks.ts; tests/data/boards.test.ts runs both.
import type { ScenarioData } from '../data/types'
import type { BoardDef, Vec2 } from './types'
import { deploymentRegions, fitBases, initialDoors, reachableFrom, SMALL_BASE_RADIUS, withDoor, type DoorStates } from './board'

/** A full crew for the fit check: ten 25 mm bases (the largest crew any v1 scenario fields). */
export const FULL_CREW = 10

/** Every board has room for a crew in each region, and nothing is cut off by locked doors. Messages carry no file prefix. */
export function deploymentProblems(def: BoardDef, scenarios: readonly Pick<ScenarioData, 'id' | 'deployment'>[]): string[] {
  const out: string[] = []
  const closed = initialDoors(def)
  let open: DoorStates = closed
  for (const d of def.doors) if (!d.lockedAtStart) open = withDoor(open, d.id, { state: 'open' })

  const groups: { label: string; polys: Vec2[][]; fit: Vec2[] }[] = []
  for (const s of scenarios) {
    const reg = deploymentRegions(def, s.deployment)
    const add = (label: string, polys: Vec2[][]) => groups.push({ label, polys, fit: fitBases(def, closed, polys, SMALL_BASE_RADIUS, FULL_CREW) })
    if (reg.kind === 'standard') {
      add(`${s.id} low half`, reg.low)
      add(`${s.id} high half`, reg.high)
    } else {
      const ids = Object.keys(reg.tiles)
      if (ids.length < 2) out.push(`${s.id}: tile deployment needs at least two outer tiles, ${def.id} has ${ids.length}`)
      for (const id of ids) add(`${s.id} tile ${id}`, reg.tiles[id]!)
    }
  }
  for (const g of groups) if (g.fit.length < FULL_CREW) out.push(`deployment ${g.label}: room for ${g.fit.length} bases of 25 mm, a full crew is ${FULL_CREW}`)

  const first = groups.find((g) => g.fit.length > 0)
  if (first) {
    const reach = reachableFrom(def, open, first.fit.slice(0, 1))
    for (const g of groups) {
      if (g.fit.length > 0 && !g.fit.some(reach)) out.push(`deployment ${g.label}: cannot be reached from the other regions without opening a locked door`)
    }
    for (const s of def.casketSpots) if (!reach(s)) out.push(`casket spot (${s.x}, ${s.z}): cannot be reached without opening a locked door`)
  }
  return out
}
