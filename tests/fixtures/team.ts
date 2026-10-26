// Synthetic data for engine tests: a 3-operative "test team" with a pistol, a rifle and a melee
// weapon. Not the real teams, so rules tests survive data corrections.
import type { EngineBundle } from '@/engine/bundle'
import type { GameSetup, MapDef, RuntimeDatacard, RuntimeWeapon } from '@/engine/types'
import { flatMap } from './maps'

export const TEST_TEAM_ID = 'test.team'

const pistol: RuntimeWeapon = {
  id: 'test.w.pistol',
  name: 'Test Pistol',
  type: 'ranged',
  atk: 4,
  hit: 3,
  dmg: { normal: 3, crit: 4 },
  rules: [{ rule: 'range', inches: 8 }],
}
const rifle: RuntimeWeapon = {
  id: 'test.w.rifle',
  name: 'Test Rifle',
  type: 'ranged',
  atk: 4,
  hit: 3,
  dmg: { normal: 3, crit: 4 },
  rules: [],
}
const blade: RuntimeWeapon = {
  id: 'test.w.blade',
  name: 'Test Blade',
  type: 'melee',
  atk: 4,
  hit: 3,
  dmg: { normal: 4, crit: 5 },
  rules: [],
}

function card(id: string, name: string, baseMm: number, ranged: string[]): RuntimeDatacard {
  return {
    id,
    name,
    teamId: TEST_TEAM_ID,
    apl: 3,
    move: 6,
    save: 3,
    wounds: 10,
    baseMm,
    keywords: ['TEST'],
    fixedWeapons: ['test.w.blade'],
    weaponOptions: [{ id: 'ranged', pick: 1, from: ranged }],
    abilities: [],
    uniqueActions: [],
  }
}

export const testBundle: EngineBundle = {
  dataVersion: 'test-1',
  datacards: {
    'test.sergeant': card('test.sergeant', 'Test Sergeant', 32, ['test.w.pistol']),
    'test.trooper': card('test.trooper', 'Test Trooper', 32, ['test.w.rifle', 'test.w.pistol']),
    'test.scout': card('test.scout', 'Test Scout', 25, ['test.w.rifle']),
  },
  weapons: { 'test.w.pistol': pistol, 'test.w.rifle': rifle, 'test.w.blade': blade },
  abilities: {},
  teams: { [TEST_TEAM_ID]: { id: TEST_TEAM_ID, name: 'Test Team', factionKeyword: 'TEST', operatives: 3 } },
  gambits: [{ id: 'test.gambit', name: 'Test Gambit', cost: 1 }],
}

/** Roster of n operatives: sergeant, trooper, scout, then troopers. */
export function roster(n: number): { datacardId: string }[] {
  const ids = ['test.sergeant', 'test.trooper', 'test.scout']
  return Array.from({ length: n }, (_, i) => ({ datacardId: ids[i] ?? 'test.trooper' }))
}

export function makeSetup(opts: { map?: MapDef; sizeA?: number; sizeB?: number; equipment?: GameSetup['equipment'] } = {}): GameSetup {
  const setup: GameSetup = {
    teams: { A: TEST_TEAM_ID, B: TEST_TEAM_ID },
    rosters: { A: roster(opts.sizeA ?? 3), B: roster(opts.sizeB ?? 3) },
    map: opts.map ?? flatMap(),
  }
  if (opts.equipment) setup.equipment = opts.equipment
  return setup
}
