import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import { CODE_HOOKS, MANIFEST, loadBundle, playableTeamIds } from '../../src/data'
import { SCHEMAS } from '../../src/data/schema'
import { buildIndex, checkRefs } from '../../src/data/refs'
import { validateAll } from '../../src/data/validate'
import type { DataRecord, WeaponData } from '../../src/data/types'

function ajvWithSchemas() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true })
  for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema)
  return ajv
}
const weaponSchema = 'https://mancermundo.dev/schemas/weapon.schema.json'
const goodWeapon: WeaponData = {
  id: 'test.w.gun',
  name: 'Gun',
  type: 'ranged',
  atk: 4,
  hit: '3+',
  dmg: { normal: 3, crit: 4 },
  rules: [{ rule: 'core.wr.range', inches: 8 }],
  source: 'test',
}

describe('data schemas', () => {
  it('every data file validates; ids are unique, refs resolve, weapon rules are known, hooks file is current', () => {
    const result = validateAll({ hooksFile: 'check' })
    expect(result.errors).toEqual([])
    expect(result.files).toBe(MANIFEST.length)
    expect(result.files).toBe(26 + 6 * 22)
    expect(result.records).toBeGreaterThan(150)
  })

  it('every schema carries the mancermundo $id and the mirror lists all ten', () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual([
      'ability',
      'common',
      'datacard',
      'equipment',
      'killzone-layout',
      'mission',
      'ploy',
      'team',
      'weapon',
      'weapon-rule',
    ])
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      expect((schema as { $id: string }).$id).toBe(`https://mancermundo.dev/schemas/${name}.schema.json`)
    }
  })

  it('schemas reject malformed records (unknown key, bad hit, bad id, bad effect key, bad window)', () => {
    const ajv = ajvWithSchemas()
    const validate = ajv.getSchema(weaponSchema)!
    expect(validate(goodWeapon)).toBe(true)
    expect(validate({ ...goodWeapon, bogus: 1 })).toBe(false)
    expect(validate({ ...goodWeapon, hit: '7+' })).toBe(false)
    expect(validate({ ...goodWeapon, id: 'Not An Id' })).toBe(false)
    expect(validate({ ...goodWeapon, rules: [{ rule: 'core.wr.range', inches: 7.3 }] })).toBe(false)
    const ploy = ajv.getSchema('https://mancermundo.dev/schemas/ploy.schema.json')!
    const goodPloy = { id: 'test.p.x', name: 'X', type: 'firefight', cost: 1, window: 'shoot.defenceRolled', effect: { cp: 1 }, text: 't', source: 's' }
    expect(ploy(goodPloy)).toBe(true)
    expect(ploy({ ...goodPloy, effect: { teleport: true } })).toBe(false)
    expect(ploy({ ...goodPloy, window: 'whenever' })).toBe(false)
  })

  it('loadBundle indexes every record and exposes profile groups', () => {
    const bundle = loadBundle()
    expect(bundle.dataVersion).toMatch(/^\d+\.\d+\.\d+$/)
    const teamDirs = MANIFEST.filter((f) => /^teams\/[^/]+\/team\.json$/.test(f.path)).map((f) => f.path.split('/')[1]!).sort()
    expect(Object.keys(bundle.teams).sort()).toEqual(teamDirs)
    expect(playableTeamIds(bundle)).toEqual(Object.values(bundle.teams).filter((t) => t.playable !== false).map((t) => t.id).sort())
    expect(playableTeamIds(bundle)).toEqual(expect.arrayContaining(['angels-of-death', 'kommandos']))
    expect(Object.keys(bundle.missions)).toHaveLength(3)
    expect(Object.keys(bundle.layouts)).toHaveLength(6)
    expect(bundle.byId['core.wr.piercing']).toBeDefined()
    expect(bundle.weaponGroups['aod.wg.stalker-bolt-rifle']).toEqual(['aod.w.stalker-bolt-rifle-heavy', 'aod.w.stalker-bolt-rifle-mobile'])
  })

  it('duplicate ids and dangling references are reported', () => {
    const w2: WeaponData = { ...goodWeapon, rules: [{ rule: 'core.wr.nonexistent' }] }
    const index = buildIndex([{ path: 'a.json', type: 'weapon', records: [goodWeapon as DataRecord, w2 as DataRecord] }])
    expect(index.errors.join('\n')).toMatch(/duplicate id "test\.w\.gun"/)
    const dangling = buildIndex([{ path: 'b.json', type: 'weapon', records: [w2 as DataRecord] }])
    expect(checkRefs(dangling).join('\n')).toMatch(/core\.wr\.nonexistent.*does not exist/)
  })

  it('code hook list is non-empty, unique and camelCase', () => {
    const names = CODE_HOOKS.map((h) => h.name)
    expect(names.length).toBeGreaterThan(20)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z][A-Za-z0-9]*$/)
  })
})
