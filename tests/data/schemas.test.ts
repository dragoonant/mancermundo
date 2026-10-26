import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import fs from 'node:fs'
import path from 'node:path'
import { CODE_HOOKS, MANIFEST, houseIds, loadBundle, rosterFromStarter, starterGangs } from '../../src/data'
import { SCHEMAS, schemaId } from '../../src/data/schema'
import { SCHEMA_NAMES, SCHEMA_OF_DEF } from '../../src/data/manifest'
import { buildIndex, checkRefs, recordCodes } from '../../src/data/refs'
import { validateAll } from '../../src/data/validate'
import { compositionProblems, starterGangCost, starterGangProblems, weaponSlots, type RosterBundle } from '../../src/data/roster'
import type { DataRecord, FighterTypeData, HouseData, RecordType, StarterGangData, WeaponData } from '../../src/data/types'

function ajvWithSchemas() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true })
  addFormats(ajv)
  for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema)
  return ajv
}
const check = (ajv: Ajv2020, def: RecordType, value: unknown): boolean => {
  const validate = ajv.getSchema(`${schemaId(SCHEMA_OF_DEF[def])}#/$defs/${def}`)
  if (!validate) throw new Error(`no schema for ${def}`)
  return validate(value) as boolean
}

// ---- samples taken from the shapes in docs/spec/20-data-schema.md (numbers are placeholders)
const weapon: WeaponData = {
  id: 'core.w.boltgun',
  name: 'Boltgun',
  class: 'basic',
  cost: 55,
  rarity: null,
  profiles: [
    {
      id: 'std',
      name: null,
      range: { short: 12, long: 24 },
      acc: { short: 1, long: 0 },
      str: 4,
      ap: -1,
      dmg: 2,
      ammo: '6+',
      traits: [{ trait: 'core.t.rapid-fire', x: 1 }],
    },
  ],
  flavour: 'bolter',
  source: 'test',
}
const fighterType: FighterTypeData = {
  id: 'tst.boss',
  name: 'Boss',
  house: 'testhouse',
  role: 'leader',
  cost: 100,
  stats: { M: 4, WS: '3+', BS: '4+', S: 4, T: 4, W: 2, I: '4+', A: 2, Ld: '5+', Cl: '5+', Wil: '6+', Int: '6+' },
  base: 32,
  rules: [{ rule: 'core.r.group-activation', x: 2 }, { rule: 'core.r.leading-by-example' }],
  skillAccess: { primary: ['brawn'], secondary: ['combat', 'tst-house-set'] },
  equipmentList: 'tst.el.leader',
  limits: { min: 1, max: 1 },
  figure: { archetype: 'goliath-leader' },
  source: 'test',
}
const house: HouseData = {
  id: 'testhouse',
  name: 'House Test',
  prefix: 'tst',
  houseRules: ['tst.r.one'],
  fighterTypes: ['tst.boss'],
  skillSets: ['tst-house-set'],
  composition: { minFighters: 3, roles: { leader: { min: 1, max: 1 }, champion: { max: 2 } }, ratio: [{ roles: ['ganger'], atLeastHalf: true }] },
  paint: { major: { h: 0.02, s: 0.6, l: 0.4 }, minor: { h: 0.1, s: 0.2, l: 0.6 } },
  source: 'test',
}
const samples: Partial<Record<RecordType, unknown>> = {
  weapon,
  fighterType,
  house,
  wargear: { id: 'core.g.flak-armour', name: 'Flak armour', kind: 'armour', cost: 10, save: '6+', saveMods: [{ vs: 'blast', value: 1 }], text: 'x', source: 'test' },
  skill: {
    id: 'core.s.agility.sprint',
    name: 'Sprint',
    set: 'agility',
    window: 'action.declared',
    when: { action: 'move', repeatInActivation: true },
    effect: { modifyStat: { stat: 'M', mult: 2 } },
    limit: 'oncePerActivation',
    text: 'x',
    source: 'test',
  },
  rule: { id: 'core.r.group-activation', name: 'Group Activation', kind: 'fighterRule', text: 'x', source: 'test' },
  equipmentList: { id: 'tst.el.leader', house: 'testhouse', forTypes: ['tst.boss'], weapons: [{ id: 'core.w.boltgun', cost: 55 }], wargear: [], source: 'test' },
  starterGang: {
    id: 'tst.sg.starter-1',
    house: 'testhouse',
    name: 'Test gang',
    credits: 1000,
    fighters: [{ name: 'Boss', type: 'tst.boss', weapons: ['core.w.boltgun'], wargear: [], skills: [] }],
    text: 'x',
    source: 'test',
  },
  tile: {
    id: 'zm.t.junction-a',
    name: 'Junction A',
    walls: [{ id: 'w1', a: { x: -6, z: 2 }, b: { x: -1, z: 2 }, thickness: 0.5 }],
    doors: [{ id: 'd1', a: { x: -1, z: 2 }, b: { x: 1, z: 2 }, locked: false }],
    terminals: [{ id: 't1', door: 'd1', pos: { x: 1.8, z: 2.9 } }],
    ducts: [{ id: 'u1', a: { x: 3, z: -1.2 }, b: { x: 3, z: 0.8 } }],
    obstacles: [{ id: 'o1', kind: 'barricade', footprint: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 0.5 }] }],
    casketSpots: [{ x: 0, z: -3 }],
    floor: { style: 'grate', props: [{ model: 'pipes', pos: { x: 1, z: 1 }, yaw: 0 }] },
    source: 'own design',
  },
  board: {
    id: 'zm.b.foundry-run',
    name: 'Foundry Run',
    layout: '2x3',
    tiles: [{ tile: 'zm.t.junction-a', at: { x: -6, z: -12 }, rot: 90 }],
    extra: { walls: [], doors: [], terminals: [], ducts: [], obstacles: [], caskets: [{ x: 0, z: 0 }] },
    scenarios: ['scn.tunnel-skirmish', 'scn.smash-and-grab'],
    source: 'own design',
  },
  scenario: {
    id: 'scn.smash-and-grab',
    name: 'Smash & Grab',
    layouts: ['2x3'],
    roles: true,
    crews: { attacker: { method: 'custom', x: 8 }, defender: { method: 'hybrid', x: 3, y: 'D6' } },
    crewCap: null,
    deployment: { kind: 'standard', minFromCentreline: 12, defenderFirst: true },
    caskets: { count: 5, placer: 'defender', region: 'ownHalf', minFromEdge: 4, minApart: 6, openBy: 'attacker', contents: 'scn.smash-and-grab' },
    scoring: [{ on: 'casketOpened', seat: 'attacker', count: true }],
    victory: { code: 'smashAndGrabVictory' },
    special: [],
    text: 'x',
    source: 'test',
  },
}

describe('data schemas', () => {
  it('every data file validates; ids are unique, refs resolve, traits are known, no BOM, no orphan files', () => {
    const result = validateAll({ sourcesDir: false })
    expect(result.errors).toEqual([])
    expect(result.files).toBe(MANIFEST.length)
    expect(result.records).toBeGreaterThan(80)
  })

  it('prose spot check against docs/sources finds nothing when the extracts are present', () => {
    expect(validateAll().errors).toEqual([])
  })

  it('there are exactly six schema files, each with the mancermundo $id', () => {
    expect([...SCHEMA_NAMES].sort()).toEqual(['common', 'core', 'gang', 'item', 'scenario', 'zm'])
    expect(Object.keys(SCHEMAS).sort()).toEqual(['common', 'core', 'gang', 'item', 'scenario', 'zm'])
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      expect((schema as { $id: string }).$id).toBe(`https://mancermundo.dev/schemas/${name}.schema.json`)
      expect(JSON.stringify(schema)).not.toContain('kill-team')
    }
    const files = fs.readdirSync(path.resolve(__dirname, '../../src/data/schema')).filter((f) => f.endsWith('.json'))
    expect(files.sort()).toEqual(['common', 'core', 'gang', 'item', 'scenario', 'zm'].map((n) => `${n}.schema.json`))
  })

  it('every record kind has a schema def and the spec samples validate', () => {
    const ajv = ajvWithSchemas()
    for (const def of Object.keys(SCHEMA_OF_DEF) as RecordType[]) {
      expect(ajv.getSchema(`${schemaId(SCHEMA_OF_DEF[def])}#/$defs/${def}`), def).toBeTruthy()
    }
    for (const [def, value] of Object.entries(samples)) expect(check(ajv, def as RecordType, value), def).toBe(true)
  })

  it('the manifest files validate against the def they name (and only well-formed ones)', () => {
    for (const m of MANIFEST) expect(SCHEMA_OF_DEF[m.def]).toBe(m.schema)
  })

  it('schemas reject malformed records (unknown key, bad target, bad id, bad range, bad effect key, bad window)', () => {
    const ajv = ajvWithSchemas()
    expect(check(ajv, 'weapon', { ...weapon, bogus: 1 })).toBe(false)
    expect(check(ajv, 'weapon', { ...weapon, id: 'Not An Id' })).toBe(false)
    expect(check(ajv, 'weapon', { ...weapon, source: '' })).toBe(false)
    const { flavour: _flavour, ...noFlavour } = weapon
    expect(check(ajv, 'weapon', noFlavour)).toBe(false)
    expect(check(ajv, 'weapon', { ...weapon, profiles: [{ ...weapon.profiles[0], ammo: '7' }] })).toBe(false)
    expect(check(ajv, 'weapon', { ...weapon, profiles: [{ ...weapon.profiles[0], range: { short: 12.1, long: 24 } }] })).toBe(false)
    expect(check(ajv, 'weapon', { ...weapon, profiles: [{ ...weapon.profiles[0], range: { short: null, long: 'E' } }] })).toBe(true)
    expect(check(ajv, 'weapon', { ...weapon, profiles: [{ ...weapon.profiles[0], range: { short: null, long: { strMultiplier: 3 } } }] })).toBe(true)
    expect(check(ajv, 'weapon', { ...weapon, profiles: [{ ...weapon.profiles[0], str: 'S+1', dmg: '-' }] })).toBe(true)
    expect(check(ajv, 'weapon', { ...weapon, profiles: [{ ...weapon.profiles[0], str: 'T+1' }] })).toBe(false)
    expect(check(ajv, 'fighterType', { ...fighterType, stats: { ...fighterType.stats, WS: 3 } })).toBe(false)
    expect(check(ajv, 'fighterType', { ...fighterType, stats: { ...fighterType.stats, BS: '13+' } })).toBe(false)
    const { Int: _int, ...shortStats } = fighterType.stats
    expect(check(ajv, 'fighterType', { ...fighterType, stats: shortStats })).toBe(false)
    expect(check(ajv, 'fighterType', { ...fighterType, role: 'sergeant' })).toBe(false)
    const skill = samples.skill as Record<string, unknown>
    expect(check(ajv, 'skill', { ...skill, effect: { bogusEffect: { value: 1 } } })).toBe(false)
    expect(check(ajv, 'skill', { ...skill, effect: { code: { code: 'myHook', params: { a: 1 } } } })).toBe(true)
    expect(check(ajv, 'skill', { ...skill, window: 'firefight.start' })).toBe(false)
    expect(check(ajv, 'skill', { ...skill, window: 'setup.deploy' })).toBe(true)
    expect(check(ajv, 'skill', { ...skill, when: { status: 'flying' } })).toBe(false)
    expect(check(ajv, 'skill', { ...skill, limit: 'oncePerTurn' })).toBe(false)
    const sg = samples.starterGang as StarterGangData
    expect(check(ajv, 'starterGang', { ...sg, credits: 1001 })).toBe(false)
    const sc = samples.scenario as Record<string, unknown>
    expect(check(ajv, 'scenario', { ...sc, victory: { by: 'vibes' } })).toBe(false)
    expect(check(ajv, 'scenario', { ...sc, layouts: ['3x3'] })).toBe(false)
    const board = samples.board as Record<string, unknown>
    expect(check(ajv, 'board', { ...board, tiles: [{ tile: 'zm.t.junction-a', at: { x: 0, z: 0 }, rot: 45 }] })).toBe(false)
    const tile = samples.tile as Record<string, unknown>
    expect(check(ajv, 'tile', { ...tile, floor: { style: 'mud', props: [] } })).toBe(false)
  })

  it('refs: duplicate ids and dangling or wrong-kind references are reported', () => {
    const fighter = { ...fighterType }
    const files = [
      { path: 'a.json', type: 'weapon' as RecordType, records: [weapon as DataRecord] },
      { path: 'b.json', type: 'weapon' as RecordType, records: [{ ...weapon, name: 'Again' } as DataRecord] },
      { path: 'c.json', type: 'fighterType' as RecordType, records: [fighter as DataRecord] },
    ]
    const index = buildIndex(files)
    expect(index.errors).toEqual(['b.json: duplicate id "core.w.boltgun" (first seen in a.json)'])
    const errors = checkRefs(index)
    expect(errors.some((e) => e.includes('core.t.rapid-fire') && e.includes('does not exist'))).toBe(true)
    expect(errors.some((e) => e.includes('"testhouse"'))).toBe(true)
    expect(errors.some((e) => e.includes('tst.el.leader'))).toBe(true)
    expect(errors.some((e) => e.includes('core.r.group-activation'))).toBe(true)
    // core skill sets need no skill record; a house set does
    expect(errors.some((e) => e.includes('skillAccess.primary[0]'))).toBe(false)
    expect(errors.some((e) => e.includes('tst-house-set'))).toBe(true)
  })

  it('code names are collected from effects, weapons, wargear and scenarios', () => {
    expect(recordCodes({ ...weapon, code: { code: 'weaponHook' } } as DataRecord, 'weapon')).toEqual(['weaponHook'])
    expect(recordCodes(samples.skill as DataRecord, 'skill')).toEqual([])
    expect(recordCodes({ ...(samples.skill as object), effect: [{ code: { code: 'a' } }, { modifyHit: { kind: 'shoot', value: 1 } }] } as DataRecord, 'skill')).toEqual(['a'])
    expect(recordCodes(samples.scenario as DataRecord, 'scenario')).toEqual(['smashAndGrabVictory'])
  })

  it('loadBundle returns the typed maps; no code hooks are used yet', () => {
    const bundle = loadBundle()
    expect(bundle.dataVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(bundle.dice.id).toBe('core.dice')
    expect(bundle.constants.id).toBe('core.constants')
    expect(Object.keys(bundle.actions)).toHaveLength(23)
    expect(Object.keys(bundle.byId).length).toBeGreaterThanOrEqual(90)
    expect(Array.isArray(CODE_HOOKS)).toBe(true)
    expect(Array.isArray(houseIds(bundle))).toBe(true)
    expect(Array.isArray(starterGangs('goliath', bundle))).toBe(true)
  })
})

describe('starter gang helpers', () => {
  const trait = (id: string) => ({ trait: id })
  const mkWeapon = (id: string, traits: string[] = []): WeaponData => ({
    ...weapon,
    id,
    profiles: [{ ...weapon.profiles[0], traits: traits.map(trait) }],
  })
  const bundle = {
    houses: { testhouse: house },
    fighterTypes: {
      'tst.boss': fighterType,
      'tst.ganger': { ...fighterType, id: 'tst.ganger', role: 'ganger', cost: 50, limits: undefined, equipmentList: 'tst.el.leader' } as FighterTypeData,
    },
    equipmentLists: {
      'tst.el.leader': { id: 'tst.el.leader', house: 'testhouse', forTypes: ['tst.boss', 'tst.ganger'], weapons: [{ id: 'w.a', cost: 10 }, { id: 'w.big', cost: 30 }], wargear: [{ id: 'g.flak', cost: 5 }, { id: 'g.mesh', cost: 15 }], source: 't' },
    },
    weapons: { 'w.a': mkWeapon('w.a'), 'w.b': mkWeapon('w.b'), 'w.big': mkWeapon('w.big', ['core.t.unwieldy']) },
    wargear: {
      'g.flak': { id: 'g.flak', name: 'Flak', kind: 'armour', cost: 5, save: '6+', text: 'x', source: 't' },
      'g.mesh': { id: 'g.mesh', name: 'Mesh', kind: 'armour', cost: 15, save: '5+', text: 'x', source: 't' },
    },
    starterGangs: {},
    constants: loadBundle().constants,
  } as unknown as RosterBundle
  const gang = (fighters: StarterGangData['fighters'], credits = 1000): StarterGangData => ({
    id: 'tst.sg.x',
    house: 'testhouse',
    name: 'X',
    credits,
    fighters,
    text: 'x',
    source: 't',
  })
  const boss = { name: 'Boss', type: 'tst.boss', weapons: ['w.a'], wargear: ['g.flak'], skills: [] }
  const ganger = { name: 'G', type: 'tst.ganger', weapons: ['w.a'], wargear: [], skills: [] }

  it('Unwieldy weapons take two slots', () => {
    const c = loadBundle().constants
    expect(weaponSlots(bundle.weapons['w.a'], c)).toBe(1)
    expect(weaponSlots(bundle.weapons['w.big'], c)).toBe(2)
  })

  it('costs a gang from the type cost plus list prices', () => {
    expect(starterGangCost(bundle, gang([boss, ganger, ganger]))).toBe(100 + 10 + 5 + 2 * (50 + 10))
  })

  it('accepts a legal gang and flags over-cost, off-list items, too many slots and two armour items', () => {
    expect(starterGangProblems(bundle, gang([boss, ganger, ganger]))).toEqual([])
    expect(starterGangProblems(bundle, gang([boss, ganger, ganger], 100)).some((m) => m.includes('over its 100 credits'))).toBe(true)
    expect(starterGangProblems(bundle, gang([{ ...boss, weapons: ['w.b'] }, ganger, ganger])).some((m) => m.includes('w.b is not on'))).toBe(true)
    expect(starterGangProblems(bundle, gang([{ ...boss, weapons: ['w.a', 'w.a', 'w.big'] }, ganger, ganger])).some((m) => m.includes('4 weapon slots'))).toBe(true)
    expect(starterGangProblems(bundle, gang([{ ...boss, wargear: ['g.flak', 'g.mesh'] }, ganger, ganger])).some((m) => m.includes('2 armour items'))).toBe(true)
  })

  it('checks the house composition', () => {
    const t = bundle.fighterTypes
    expect(compositionProblems(house, [t['tst.boss'], t['tst.ganger'], t['tst.ganger']])).toEqual([])
    expect(compositionProblems(house, [t['tst.boss'], t['tst.ganger']]).some((m) => m.includes('at least 3'))).toBe(true)
    expect(compositionProblems(house, [t['tst.ganger'], t['tst.ganger'], t['tst.ganger']]).some((m) => m.includes('0 leader'))).toBe(true)
    expect(compositionProblems(house, [t['tst.boss'], t['tst.boss'], t['tst.ganger']]).some((m) => m.includes('at most 1'))).toBe(true)
    const champ = { ...t['tst.boss'], id: 'tst.champ', role: 'champion', limits: undefined } as FighterTypeData
    expect(compositionProblems(house, [t['tst.boss'], champ, champ, t['tst.ganger']]).some((m) => m.includes('needs at least half'))).toBe(true)
  })

  it('builds the engine roster from a starter gang', () => {
    const sg = gang([boss, ganger])
    const setup = rosterFromStarter({ starterGangs: { [sg.id]: sg } }, sg.id, 'a')
    expect(setup).toMatchObject({ houseId: 'testhouse', name: 'X', starterId: 'tst.sg.x' })
    expect(setup.roster.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(setup.roster[0]).toEqual({ id: 'a1', typeId: 'tst.boss', name: 'Boss', weapons: ['w.a'], wargear: ['g.flak'], skills: [] })
    expect(() => rosterFromStarter({ starterGangs: {} }, 'nope')).toThrow(/unknown starter gang/)
  })
})
