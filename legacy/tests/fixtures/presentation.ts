// Client presentation coverage (flavour, VFX family, sound, attachment, figure body) is required for the
// playable teams and core records only: a scaffolded team (team.json `playable: false`) is not shown yet.
// Entries a scaffolded team already provides still count as known ids, so they are not reported as stray.
import { dataBundle } from '@/client/game/adapter'

const b = dataBundle()

/** True for a record of a playable team, or with no team (core). */
export function isPresented(r: unknown): boolean {
  const team = (r as { team?: string }).team
  return team === undefined || b.teams[team]?.playable !== false
}

/** Every weapon id in the data, playable or not (for "no stray table entry" checks). */
export const ALL_WEAPON_IDS: ReadonlySet<string> = new Set(
  Object.values(b.byId)
    .filter((r) => 'atk' in r && 'dmg' in r)
    .map((r) => (r as { id: string }).id),
)
