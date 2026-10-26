// Pure parts of the shooting volley (see director.ts): a shot plays its dice first, then the shooter fires one tracer per hit
// the Firepower dice produced (at least one), and each tracer's landing is a miss, a blocked hit (the save held) or damage.
// These helpers read the events of one Shoot step and plan the landings; no store, no three.js.
import type { GameEvent } from '@/engine'

export type Outcome = 'miss' | 'blocked' | 'damage'

export interface Landing {
  targetId: string | null
  outcome: Outcome
}

export interface LandingPlan {
  /** one entry per tracer in firing order */
  shots: Landing[]
  /** damage / injury events that no tracer could be paired with (e.g. blast or template effects) */
  orphanItems: GameEvent[]
}

/** True for the events that make up a Shoot step's resolution (the director holds them until the volley fires). */
export function isVolleyEvent(ev: GameEvent): boolean {
  switch (ev.type) {
    case 'WoundRolled':
    case 'SaveRolled':
    case 'DamageInflicted':
    case 'InjuryRolled':
    case 'FleshWound':
    case 'FighterPinned':
    case 'FighterOutOfAction':
    case 'StatusChanged':
      return true
    default:
      return false
  }
}

/**
 * The landings of a volley from its events: the Firepower hit count (else one shot per HitRolled that hit) gives the tracers;
 * each is paired, in order, with the next unsaved wound / save outcome against the declared target.
 */
export function planLandings(events: readonly GameEvent[]): LandingPlan {
  let tracers = 0
  let targetId: string | null = null
  for (const ev of events) {
    if (ev.type === 'TargetDeclared' && ev.targetId) targetId = ev.targetId
    if (ev.type === 'FirepowerRolled') tracers += ev.hits
    else if (ev.type === 'HitRolled' && ev.hit && !events.some((e) => e.type === 'FirepowerRolled')) tracers += 1
  }
  if (tracers === 0) tracers = events.some((e) => e.type === 'ShootStarted') ? 1 : 0
  const verdicts: Outcome[] = []
  const used = new Set<GameEvent>()
  for (const ev of events) {
    if (ev.type === 'WoundRolled' && !ev.wounded) {
      verdicts.push('blocked')
      used.add(ev)
    } else if (ev.type === 'SaveRolled' && ev.saved) {
      verdicts.push('blocked')
      used.add(ev)
    } else if (ev.type === 'DamageInflicted') {
      verdicts.push('damage')
      used.add(ev)
    }
  }
  const shots: Landing[] = []
  for (let i = 0; i < tracers; i++) shots.push({ targetId, outcome: verdicts[i] ?? 'miss' })
  const orphanItems = verdicts.length > tracers ? events.filter((e) => isVolleyEvent(e) && !used.has(e)) : []
  return { shots, orphanItems }
}
