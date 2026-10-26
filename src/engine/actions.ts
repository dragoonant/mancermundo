// Action union (frozen after M2). The union itself lives in types.ts next to the payload map;
// this file holds constructors so callers never hand-build envelopes (client, AI and tests use act.*).
import type { Action, ActionOf, ActionPayloadMap, ActionType, PendingDecision, Seat, Vec2, Waypoint } from './types'

export type { Action, ActionOf, ActionPayloadMap, ActionType }

type P = Pick<PendingDecision, 'id' | 'seat'>
type Choose = ActionPayloadMap['action.choose']

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
  // setup
  role: (p: P, choice: ActionPayloadMap['setup.role']['choice']) => makeAction('setup.role', p, { choice }),
  crew: (p: P, fighterId: string) => makeAction('setup.crew', p, { fighterId }),
  crewDone: (p: P) => makeAction('setup.crew', p, { done: true }),
  casket: (p: P, x: number, z: number) => makeAction('setup.casket', p, { x, z }),
  zone: (p: P, zoneId: string) => makeAction('setup.zone', p, { zoneId }),
  deploy: (p: P, fighterId: string, x: number, z: number, facing = 0) => makeAction('setup.deploy', p, { fighterId, x, z, facing }),
  // action phase
  flee: (p: P, fighterId: string) => makeAction('action.flee', p, { fighterId }),
  fleeDone: (p: P) => makeAction('action.flee', p, { done: true }),
  activate: (p: P, fighterId: string) => makeAction('action.activate', p, { fighterId }),
  group: (p: P, fighterId: string) => makeAction('action.group', p, { fighterId }),
  groupDone: (p: P) => makeAction('action.group', p, { done: true }),
  choose: (p: P, action: string, params: Omit<Choose, 'action'> = {}) => makeAction('action.choose', p, { action, ...params }),
  endActivation: (p: P) => makeAction('action.choose', p, { action: 'end' }),
  path: (p: P, waypoints: Waypoint[], facing?: number) => makeAction('move.path', p, facing === undefined ? { waypoints } : { waypoints, facing }),
  // shooting
  weapon: (p: P, weaponId: string, profileId: string, twinWith?: string) =>
    makeAction('shoot.weapon', p, twinWith === undefined ? { weaponId, profileId } : { weaponId, profileId, twinWith }),
  target: (p: P, targetId: string) => makeAction('shoot.target', p, { targetId }),
  targetDoor: (p: P, doorId: string) => makeAction('shoot.target', p, { doorId }),
  targetPoint: (p: P) => makeAction('shoot.target', p, { point: true }),
  aim: (p: P, at: Vec2) => makeAction('shoot.aim', p, { x: at.x, z: at.z }),
  allocate: (p: P, targetId: string) => makeAction('shoot.allocate', p, { targetId }),
  // fighting
  fightWeapons: (p: P, weaponIds: string[]) => makeAction('fight.weapons', p, { weaponIds }),
  split: (p: P, split: Record<string, number>) => makeAction('fight.split', p, { split }),
  after: (p: P, choice: ActionPayloadMap['fight.after']['choice'], targetId?: string) =>
    makeAction('fight.after', p, targetId === undefined ? { choice } : { choice, targetId }),
  // end phase
  bottle: (p: P, choice: 'test' | 'bottle') => makeAction('end.bottle', p, { choice }),
  assist: (p: P, assisterId: string, recoveringId: string) => makeAction('end.assist', p, { assisterId, recoveringId }),
  assistNone: (p: P) => makeAction('end.assist', p, { none: true }),
  recoveryPick: (p: P, index: number) => makeAction('end.recoveryPick', p, { index }),
  // skills and dice
  skillChoice: (p: P, option: string) => makeAction('skill.choice', p, { option }),
  reroll: (p: P, grantId: string, dieIndexes: number[]) => makeAction('dice.reroll', p, { grantId, dieIndexes }),
  confirm: (p: P, choice?: 'continue' | 'concede') => makeAction('confirm', p, choice === undefined ? {} : { choice }),
}
