// Synthetic runtime bundle for engine tests: one house `test` with a leader (Group Activation 2), a champion
// (Group Activation 1), two gangers and a juve, a small armoury covering the weapon families the rules code has to
// handle (pistol, Rapid Fire basic gun, blast launcher, flamer template, Parry melee, power weapon) and flak armour.
// Not the real gangs, so rules tests survive data corrections. Numbers are test values, not printed values.
import type { EngineBundle } from '@/engine/bundle'
import type {
  BoardDef,
  GameSetup,
  RosterFighter,
  RuntimeAction,
  RuntimeFighterType,
  RuntimeScenario,
  RuntimeSkill,
  RuntimeTrait,
  RuntimeWargear,
  RuntimeWeapon,
  StatKey,
} from '@/engine/types'

export const TEST_HOUSE = 'test'
export const TEST_SCENARIO = 'test.scenario'
export const TEST_BOARD = 'test.board'

// --- traits (ids match the data catalogue) ---------------------------------------------------------------------------
const traits: RuntimeTrait[] = [
  { id: 'core.t.rapid-fire', name: 'Rapid Fire', param: 'count', implemented: true },
  { id: 'core.t.parry', name: 'Parry', param: 'none', implemented: true },
  { id: 'core.t.blast', name: 'Blast', param: 'inches', implemented: true },
  { id: 'core.t.template', name: 'Template', param: 'none', implemented: true },
  { id: 'core.t.knockback', name: 'Knockback', param: 'none', implemented: true },
]

// --- weapons ---------------------------------------------------------------------------------------------------------
const fixedDmg = (value: number) => ({ kind: 'fixed' as const, value })

const weapons: RuntimeWeapon[] = [
  {
    id: 'test.w.pistol',
    name: 'Test Pistol',
    class: 'pistol',
    cost: 10,
    flavour: 'stub',
    profiles: [{ id: 'std', name: null, range: { short: 6, long: 12 }, acc: { short: 1, long: 0 }, str: { base: 'fixed', value: 3 }, ap: 0, dmg: fixedDmg(1), ammo: 4, traits: [] }],
  },
  {
    id: 'test.w.rifle',
    name: 'Test Rifle',
    class: 'basic',
    cost: 20,
    flavour: 'las',
    profiles: [
      {
        id: 'std',
        name: null,
        range: { short: 12, long: 24 },
        acc: { short: 1, long: 0 },
        str: { base: 'fixed', value: 4 },
        ap: -1,
        dmg: fixedDmg(1),
        ammo: 4,
        traits: [{ trait: 'core.t.rapid-fire', x: 1 }],
      },
    ],
  },
  {
    id: 'test.w.launcher',
    name: 'Test Blast Launcher',
    class: 'special',
    cost: 40,
    flavour: 'grenade',
    profiles: [
      {
        id: 'std',
        name: null,
        range: { short: 8, long: 24 },
        acc: { short: null, long: 0 },
        str: { base: 'fixed', value: 4 },
        ap: -1,
        dmg: fixedDmg(2),
        ammo: 5,
        traits: [{ trait: 'core.t.blast', inches: 3 }],
      },
    ],
  },
  {
    id: 'test.w.flamer',
    name: 'Test Flamer',
    class: 'special',
    cost: 40,
    flavour: 'flamer',
    profiles: [
      {
        id: 'std',
        name: null,
        range: { short: null, long: 'T' },
        acc: { short: null, long: null },
        str: { base: 'fixed', value: 4 },
        ap: 0,
        dmg: fixedDmg(1),
        ammo: 5,
        traits: [{ trait: 'core.t.template' }],
      },
    ],
  },
  {
    id: 'test.w.blade',
    name: 'Test Blade',
    class: 'close',
    cost: 15,
    flavour: 'blade',
    profiles: [{ id: 'std', name: null, range: { short: null, long: 'E' }, acc: { short: null, long: null }, str: { base: 'user', value: 0 }, ap: 0, dmg: fixedDmg(1), ammo: null, traits: [{ trait: 'core.t.parry' }] }],
  },
  {
    id: 'test.w.power-blade',
    name: 'Test Power Blade',
    class: 'close',
    cost: 35,
    flavour: 'blade',
    profiles: [{ id: 'std', name: null, range: { short: null, long: 'E' }, acc: { short: null, long: null }, str: { base: 'user', value: 1 }, ap: -2, dmg: fixedDmg(2), ammo: null, traits: [] }],
  },
]

// --- wargear ---------------------------------------------------------------------------------------------------------
const wargear: RuntimeWargear[] = [{ id: 'test.g.flak', name: 'Test Flak Armour', kind: 'armour', cost: 10, save: 5 }]

// --- skills, fighter rules ---------------------------------------------------------------------------------------------
const skills: RuntimeSkill[] = [
  { id: 'core.r.group-activation', name: 'Group Activation', kind: 'fighterRule' },
  { id: 'core.r.leading-by-example', name: 'Leading by Example', kind: 'fighterRule' },
  { id: 'test.s.sprint', name: 'Test Sprint', kind: 'skill', set: 'agility' },
]

// --- actions (a small subset of the R-6.3 catalogue) -----------------------------------------------------------------
const act = (id: string, name: string, type: RuntimeAction['type'], statuses: string[]): RuntimeAction => ({ id, name, type, statuses })
const ACTIVE = ['standingActive']
const actions: RuntimeAction[] = [
  act('move', 'Move', 'simple', [...ACTIVE]),
  act('charge', 'Charge', 'double', [...ACTIVE]),
  act('shoot', 'Shoot', 'basic', [...ACTIVE, 'standingEngaged']),
  act('aim', 'Aim', 'basic', [...ACTIVE]),
  act('takeCover', 'Take Cover', 'simple', [...ACTIVE]),
  act('reload', 'Reload', 'basic', [...ACTIVE]),
  act('fight', 'Fight', 'basic', ['standingEngaged']),
  act('standUp', 'Stand Up', 'simple', ['pinned']),
  act('crawl', 'Crawl', 'simple', ['seriouslyInjured']),
  act('turn', 'Turn', 'free', [...ACTIVE]),
  act('end', 'End Activation', 'free', [...ACTIVE, 'standingEngaged', 'pinned', 'seriouslyInjured']),
]

// --- fighter types -----------------------------------------------------------------------------------------------------
type StatInput = Partial<Record<StatKey, number>>
function fighterType(id: string, name: string, role: string, baseMm: number, stats: StatInput, rules: RuntimeFighterType['rules'], limits: RuntimeFighterType['limits']): RuntimeFighterType {
  return {
    id,
    name,
    houseId: TEST_HOUSE,
    role,
    cost: 0,
    stats: { M: 5, WS: 4, BS: 4, S: 3, T: 3, W: 1, I: 4, A: 1, Ld: 7, Cl: 7, Wil: 7, Int: 7, ...stats },
    baseMm,
    rules,
    skillAccess: { primary: ['agility'], secondary: [] },
    limits,
    figureArchetype: 'test',
  }
}
const fighterTypes: RuntimeFighterType[] = [
  fighterType('test.leader', 'Test Leader', 'leader', 32, { WS: 3, BS: 3, W: 2, A: 2, Ld: 5, Cl: 5, Wil: 6, Int: 6 }, [{ id: 'core.r.group-activation', x: 2 }, { id: 'core.r.leading-by-example' }], { min: 1, max: 1 }),
  fighterType('test.champion', 'Test Champion', 'champion', 32, { WS: 3, BS: 4, W: 2, Ld: 6, Cl: 6 }, [{ id: 'core.r.group-activation', x: 1 }], { min: 0, max: 2 }),
  fighterType('test.ganger', 'Test Ganger', 'ganger', 25, {}, [], { min: 0, max: null }),
  fighterType('test.juve', 'Test Juve', 'juve', 25, { WS: 5, BS: 5, I: 5, Ld: 8, Cl: 8 }, [], { min: 0, max: null }),
]

// --- scenario and board ------------------------------------------------------------------------------------------------
const scenario: RuntimeScenario = {
  id: TEST_SCENARIO,
  name: 'Test Skirmish',
  layouts: ['2x3'],
  roles: false,
  crews: { both: { method: 'custom', x: 5 } },
  crewCap: null,
  deployment: { kind: 'standard', minFromCentreline: 12 },
  scoring: [],
  victory: { by: 'points' },
  special: [],
}

const square = (cx: number, cz: number, half: number) => [
  { x: cx - half, z: cz - half },
  { x: cx + half, z: cz - half },
  { x: cx + half, z: cz + half },
  { x: cx - half, z: cz + half },
]

/** An empty 2 x 3 board of 12" tiles (24" x 36"), no walls or doors; real boards come from S1Z / tests/fixtures/boards.ts. */
export function emptyBoard(id = TEST_BOARD): BoardDef {
  const centres = [-12, 0, 12].flatMap((z) => [-6, 6].map((x) => ({ x, z })))
  return {
    id,
    layout: '2x3',
    bounds: { minX: -12, maxX: 12, minZ: -18, maxZ: 18 },
    tiles: centres.map((c, i) => ({ id: `t${i}`, tileId: 'test.tile', centre: c, rot: 0 as const, rect: square(c.x, c.z, 6), floor: 'plate' })),
    outline: centres.map((c) => square(c.x, c.z, 6)),
    walls: [],
    doors: [],
    ducts: [],
    obstacles: [],
    casketSpots: [],
    props: [],
  }
}

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((r) => [r.id, r]))

export const testBundle: EngineBundle = {
  dataVersion: 'test-1',
  houses: {
    [TEST_HOUSE]: {
      id: TEST_HOUSE,
      name: 'Test House',
      prefix: 'test',
      houseRules: [],
      fighterTypes: fighterTypes.map((t) => t.id),
      skillSets: ['agility'],
    },
  },
  fighterTypes: byId(fighterTypes),
  weapons: byId(weapons),
  traits: byId(traits),
  skills: byId(skills),
  wargear: byId(wargear),
  actions: byId(actions),
  // synthetic six-face tables (index = D6 result - 1)
  dice: {
    firepower: ['hit', 'hit', 'hit', 'ammo', 'ammo', 'miss'],
    injury: ['fleshWound', 'fleshWound', 'seriouslyInjured', 'seriouslyInjured', 'outOfAction', 'outOfAction'],
    scatter: ['hit', 'hit', 'arrow', 'arrow', 'arrow', 'arrow'],
  },
  constants: { nerveRadius: 3, groupRadius: 3, leadingByExampleRadius: 12, assistRadius: 1, rallyRadius: 3 },
  scenarios: { [TEST_SCENARIO]: scenario },
  boards: { [TEST_BOARD]: emptyBoard() },
}

/** The same five-fighter roster for either seat: ids `<seat>1` .. `<seat>5`. */
export function roster(prefix: string): RosterFighter[] {
  return [
    { id: `${prefix}1`, typeId: 'test.leader', name: `${prefix} Leader`, weapons: ['test.w.pistol', 'test.w.power-blade'], wargear: ['test.g.flak'], skills: [] },
    { id: `${prefix}2`, typeId: 'test.champion', name: `${prefix} Champion`, weapons: ['test.w.rifle', 'test.w.blade'], wargear: ['test.g.flak'], skills: ['test.s.sprint'] },
    { id: `${prefix}3`, typeId: 'test.ganger', name: `${prefix} Ganger 1`, weapons: ['test.w.rifle'], wargear: ['test.g.flak'], skills: [] },
    { id: `${prefix}4`, typeId: 'test.ganger', name: `${prefix} Ganger 2`, weapons: ['test.w.flamer', 'test.w.pistol'], wargear: [], skills: [] },
    { id: `${prefix}5`, typeId: 'test.juve', name: `${prefix} Juve`, weapons: ['test.w.pistol', 'test.w.launcher'], wargear: [], skills: [] },
  ]
}

export function makeSetup(overrides: Partial<GameSetup> = {}): GameSetup {
  return {
    ruleset: 'n23',
    scenarioId: TEST_SCENARIO,
    boardId: TEST_BOARD,
    gangs: {
      A: { houseId: TEST_HOUSE, name: 'Test Gang A', roster: roster('A') },
      B: { houseId: TEST_HOUSE, name: 'Test Gang B', roster: roster('B') },
    },
    ...overrides,
  }
}
