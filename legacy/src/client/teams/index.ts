// Every team's client presentation, merged into the shared weapon tables (M9 prep). Angels of Death and
// Kommandos keep their entries in the shared tables; teams added later list theirs in teams/<team>.ts.
import type { GameState, Operative } from '@/engine'
import type { CardChip, SetAsideWording, TeamPresentation } from './types'
import { PRESENTATION as pathfinders } from './pathfinders'
import { PRESENTATION as hierotekCircle } from './hierotek-circle'
import { PRESENTATION as plagueMarines } from './plague-marines'
import { PRESENTATION as wyrmblade } from './wyrmblade'
import { PRESENTATION as legionaries } from './legionaries'
import { PRESENTATION as handOfTheArchon } from './hand-of-the-archon'
import { PRESENTATION as hunterClade } from './hunter-clade'
import { PRESENTATION as hearthkynSalvagers } from './hearthkyn-salvagers'
import { PRESENTATION as kasrkin } from './kasrkin'
import { PRESENTATION as novitiates } from './novitiates'
import { PRESENTATION as phobosStrikeTeam } from './phobos-strike-team'
import { PRESENTATION as corsairVoidscarred } from './corsair-voidscarred'
import { PRESENTATION as warpcoven } from './warpcoven'
import { PRESENTATION as farstalkerKinband } from './farstalker-kinband'
import { PRESENTATION as imperialNavyBreachers } from './imperial-navy-breachers'
import { PRESENTATION as blooded } from './blooded'
import { PRESENTATION as fellgorRavagers } from './fellgor-ravagers'
import { PRESENTATION as chaosCult } from './chaos-cult'
import { PRESENTATION as goremongers } from './goremongers'
import { PRESENTATION as scoutSquad } from './scout-squad'
import { PRESENTATION as tempestusAquilons } from './tempestus-aquilons'
import { PRESENTATION as exactionSquad } from './exaction-squad'

export const TEAM_PRESENTATION: Record<string, TeamPresentation> = {
  pathfinders,
  'hierotek-circle': hierotekCircle,
  'plague-marines': plagueMarines,
  wyrmblade,
  legionaries,
  'hand-of-the-archon': handOfTheArchon,
  'hunter-clade': hunterClade,
  'hearthkyn-salvagers': hearthkynSalvagers,
  kasrkin,
  novitiates,
  'phobos-strike-team': phobosStrikeTeam,
  'corsair-voidscarred': corsairVoidscarred,
  warpcoven,
  'farstalker-kinband': farstalkerKinband,
  'imperial-navy-breachers': imperialNavyBreachers,
  blooded,
  'fellgor-ravagers': fellgorRavagers,
  'chaos-cult': chaosCult,
  goremongers,
  'scout-squad': scoutSquad,
  'tempestus-aquilons': tempestusAquilons,
  'exaction-squad': exactionSquad,
}

type TableKey = 'flavour' | 'vfx' | 'sound' | 'attachments'

/** Every team's entries for one shared table. */
export function teamTable<K extends TableKey>(key: K): NonNullable<TeamPresentation[K]> {
  const out: Record<string, unknown> = {}
  for (const p of Object.values(TEAM_PRESENTATION)) Object.assign(out, p[key] ?? {})
  return out as NonNullable<TeamPresentation[K]>
}

/** Archetypes drawn as procedural stand-ins on purpose (no body GLB yet). */
export const STAND_INS: ReadonlySet<string> = new Set(Object.values(TEAM_PRESENTATION).flatMap((p) => p.standIns ?? []))

/**
 * M9 batch C: the body archetype for a datacard carrying `weaponIds`: the first `loadoutBodies` entry whose weapons it
 * all carries (profile ids or the weapon's profile group), else `fallback` (the datacard's figure.archetype).
 */
export function archetypeFor(datacardId: string, fallback: string, weaponIds: readonly string[], groups: Record<string, readonly string[]> = {}): string {
  for (const p of Object.values(TEAM_PRESENTATION)) {
    const list = p.loadoutBodies?.[datacardId]
    if (!list) continue
    for (const e of list) {
      if (e.weapons.every((w) => weaponIds.includes(w) || (groups[w] ?? []).some((x) => weaponIds.includes(x)))) return e.archetype
    }
  }
  return fallback
}

/** M10 batch C: the wording of a ploy option's param when a team names it (Capricious Plan's `flux-dash`), else null. */
export function ployParamLabel(ployId: string, param: string): string | null {
  for (const p of Object.values(TEAM_PRESENTATION)) {
    const l = p.ployParams?.[`${ployId}:${param}`]
    if (l) return l
  }
  return null
}

/** M9 batch C: the display name of a team resource pool (engine pools.ts), from the team files or the kind itself. */
export function poolLabel(kind: string): string {
  for (const p of Object.values(TEAM_PRESENTATION)) {
    const l = p.pools?.[kind]
    if (l) return l
  }
  const base = kind.includes('.') ? kind.slice(kind.lastIndexOf('.') + 1) : kind
  return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const HIDING_WORDING: SetAsideWording = {
  term: 'HIDING',
  trayNote: '(off the board)',
  state: 'hiding',
  action: 'Emerge',
  verb: 'Hide',
  intro: 'Instead of placing an operative you may start it in HIDING: out of the killzone, ready to Emerge near your drop zone later (it is incapacitated if it is still hiding when turning point 2 ends).',
  none: 'No more operatives can start hiding (a third of the team at most, Neophytes only).',
  mine: (ready) => `Out of the killzone. It still activates when it is ready${ready ? '' : ' (expended this turning point)'}; its only action is Emerge, which sets it up near your drop zone. If it is still hiding when turning point 2 ends, it is incapacitated.`,
  theirs: (ready) => `Out of the killzone, and nothing about it is secret. It still activates when it is ready${ready ? '' : ' (expended this turning point)'}; it can Emerge near its own drop zone, more than 6" from your operatives. If it is still hiding when turning point 2 ends, it is incapacitated.`,
  returned: 'emerges from hiding',
}

/** M10 batch D: the set-aside wording of a team (its presentation file), the hiding wording when it gives none. */
export function setAsideWording(teamId: string | null | undefined): SetAsideWording {
  return (teamId ? TEAM_PRESENTATION[teamId]?.setAside : undefined) ?? HIDING_WORDING
}

/** M10 batch D: the card chips a team shows for one operative (Chaos Cult form and gifts), none for most teams. */
export function cardChipsFor(state: GameState, op: Operative): CardChip[] {
  return TEAM_PRESENTATION[state.players[op.seat]?.teamId]?.cardChips?.(state, op) ?? []
}
