// Action union (frozen after M2). The union itself lives in types.ts next to the payload map;
// this file holds constructors so callers never hand-build envelopes.
import type { Action, ActionOf, ActionPayloadMap, ActionType, PendingDecision, Seat, Waypoint } from './types'

export type { Action, ActionOf, ActionPayloadMap, ActionType }

type P = Pick<PendingDecision, 'id' | 'seat'>

export function makeAction<K extends ActionType>(
  type: K,
  pending: P,
  payload: ActionPayloadMap[K],
  seat: Seat = pending.seat,
): ActionOf<K> {
  return { type, seat, decisionId: pending.id, payload }
}

export const act = {
  pass: (p: P) => makeAction('pass', p, {}),
  resign: (p: P, seat: Seat) => makeAction('resign', p, {}, seat),
  rollOff: (p: P) => makeAction('setup.initiative', p, {}),
  rollInitiative: (p: P) => makeAction('strategy.initiative', p, {}),
  dropZone: (p: P, zoneId: string) => makeAction('setup.dropZone', p, { zoneId }),
  deploy: (p: P, operativeId: string, x: number, z: number, y?: number) =>
    makeAction('setup.deploy', p, y === undefined ? { operativeId, x, z } : { operativeId, x, z, y }),
  activate: (p: P, operativeId: string, counteract = false) =>
    makeAction('firefight.activate', p, counteract ? { operativeId, counteract } : { operativeId }),
  order: (p: P, order: 'engage' | 'conceal') => makeAction('firefight.order', p, { order }),
  action: (p: P, action: string) => makeAction('firefight.action', p, { action }),
  path: (p: P, waypoints: Waypoint[]) => makeAction('move.path', p, { waypoints }),
}
