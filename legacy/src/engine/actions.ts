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
  /** M9 prep: answer setup.deploy by setting the operative aside (HIDING) instead of placing it */
  setAside: (p: P, operativeId: string) => makeAction('setup.deploy', p, { operativeId, x: 0, z: 0, setAside: true }),
  /** M9 batch B: deploy an oval-based operative with its long axis along `facing` (radians) */
  deployFacing: (p: P, operativeId: string, x: number, z: number, facing: number) => makeAction('setup.deploy', p, { operativeId, x, z, facing }),
  /** M9 batch B: FLY (Jump Pack): set the operative up at the point instead of moving along a path */
  fly: (p: P, to: Waypoint) => makeAction('move.path', p, { waypoints: [to], fly: true }),
  /** M9 batch B: a move whose oval base turns to `facing` at the end */
  pathFacing: (p: P, waypoints: Waypoint[], facing: number) => makeAction('move.path', p, { waypoints, facing }),
}
