import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadBundle } from '../../src/data'
import type { ActionData, Status } from '../../src/data/types'

const bundle = loadBundle()
const actions = Object.values(bundle.actions)
const byKey = (key: string): ActionData => {
  const a = actions.find((x) => x.key === key)
  if (!a) throw new Error(`no action ${key}`)
  return a
}
const available = (status: Status, broken = false) =>
  actions.filter((a) => a.statuses.includes(status) && (broken ? !a.requires.includes('notBroken') : !a.requires.includes('broken'))).map((a) => a.key)

describe('core data: actions (R-6.3)', () => {
  it('lists the action ids of docs/spec/00-architecture.md section 5, once each', () => {
    expect(actions.map((a) => a.key).sort()).toEqual(
      [
        'move', 'charge', 'shoot', 'aim', 'takeCover', 'reload', 'coupDeGrace', 'operateDoor', 'accessTerminal', 'forceDoor', 'crawlDuct', 'fireDuct',
        'smashCasket', 'bypassCasket', 'carryCasket', 'fight', 'retreat', 'standUp', 'crawl', 'blindFire', 'runForCover', 'turn', 'end',
      ].sort(),
    )
    for (const a of actions) expect(a.id).toBe(`core.a.${a.key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`)
  })

  it('has the cost type of every R-6.3 row', () => {
    const cost = (k: string) => byKey(k).cost
    for (const k of ['move', 'reload', 'coupDeGrace', 'operateDoor', 'carryCasket']) expect(cost(k), k).toBe('simple')
    for (const k of ['shoot', 'aim', 'takeCover', 'accessTerminal', 'forceDoor', 'fireDuct', 'smashCasket', 'bypassCasket', 'fight', 'retreat', 'standUp']) expect(cost(k), k).toBe('basic')
    for (const k of ['charge', 'crawlDuct', 'crawl', 'blindFire', 'runForCover']) expect(cost(k), k).toBe('double')
    expect(cost('turn')).toBe('free')
  })

  it('offers the right menu per status', () => {
    expect(available('standingActive').sort()).toEqual(
      ['move', 'charge', 'shoot', 'aim', 'takeCover', 'reload', 'coupDeGrace', 'operateDoor', 'accessTerminal', 'forceDoor', 'crawlDuct', 'fireDuct', 'smashCasket', 'bypassCasket', 'carryCasket', 'turn', 'end'].sort(),
    )
    // Engaged fighters cannot Move, Shoot or Reload (R-6.5)
    expect(available('standingEngaged').sort()).toEqual(['fight', 'retreat', 'turn', 'end'].sort())
    expect(available('pronePinned').sort()).toEqual(['standUp', 'crawl', 'blindFire', 'reload', 'end'].sort())
    expect(available('proneSeriouslyInjured').sort()).toEqual(['crawl', 'end'].sort())
  })

  it('lets a Broken fighter do only Running for Cover (R-12.4)', () => {
    const rfc = byKey('runForCover')
    expect(rfc.requires).toEqual(['broken'])
    expect(rfc.statuses.sort()).toEqual(['pronePinned', 'proneSeriouslyInjured', 'standingActive', 'standingEngaged'])
    for (const a of actions) if (a.key !== 'runForCover' && a.key !== 'end') expect(a.requires, a.key).toContain('notBroken')
  })

  it('has statuses only from the four derived ones', () => {
    for (const a of actions) for (const s of a.statuses) expect(['standingActive', 'standingEngaged', 'pronePinned', 'proneSeriouslyInjured']).toContain(s)
  })
})

describe('core data: special dice (R-1.1 to R-1.4)', () => {
  const d = bundle.dice
  it('maps D3 faces', () => expect(d.d3.faces).toEqual([1, 1, 2, 2, 3, 3]))
  it('maps Firepower faces: 1 = hit + Ammo, 2-3 = 1 hit, 4-5 = 2 hits, 6 = 3 hits', () => {
    expect(d.firepower.faces.map((f) => [f.face, f.hits, f.ammo])).toEqual([[1, 1, true], [2, 1, false], [3, 1, false], [4, 2, false], [5, 2, false], [6, 3, false]])
    expect(d.firepower.faces.reduce((n, f) => n + f.hits, 0) / 6).toBeCloseTo(10 / 6)
  })
  it('maps Injury faces with odds 1/3 Flesh Wound, 1/2 Seriously Injured, 1/6 Out of Action', () => {
    const count = (r: string) => d.injury.faces.filter((f) => f.result === r).length
    expect([count('fleshWound'), count('seriouslyInjured'), count('outOfAction')]).toEqual([2, 3, 1])
    expect(d.injury.faces.find((f) => f.face === 6)!.result).toBe('outOfAction')
  })
  it('maps Scatter faces: 1-4 arrow, 5-6 Hit', () => {
    expect(d.scatter.faces.map((f) => f.kind)).toEqual(['arrow', 'arrow', 'arrow', 'arrow', 'hit', 'hit'])
    expect(d.scatter.distance).toBe('D6')
  })
})

describe('core data: constants', () => {
  const c = bundle.constants
  it('holds the radii of nerve, group, leading by example, assist and rally', () => {
    expect(c.radii).toMatchObject({ nerve: 3, nerveSupport: 3, groupActivation: 3, leadingByExampleLeader: 12, leadingByExampleChampion: 6, assist: 1, rally: 3, rallySupport: 3, interact: 1, oneInchRule: 1 })
  })
  it('holds retreat, run for cover, stray shot and the door numbers', () => {
    expect(c.retreat).toEqual({ moveDice: 'D6', brokenMoveDice: '2D6' })
    expect(c.runForCover.moveDice).toBe('2D6')
    expect(c.strayShot).toEqual({ radius: 1, hitOnAtMost: 3 })
    expect(c.closeDoor).toMatchObject({ test: 'I', clearMove: 2, strength: 3, damage: 2 })
    expect(c.door).toEqual({ toughness: 5, wounds: 4 })
    expect(c.forceDoor).toMatchObject({ target: 9, helperBonus: 2 })
  })
  it('holds smoke, casket and ammo cache numbers', () => {
    expect(c.smoke).toEqual({ radius: 2.5, clearDie: 'D6', clearOnAtMost: 4 })
    expect(c.casket.smash).toMatchObject({ target: 6, contentsModifier: -1 })
    expect(c.casket.contents).toEqual([{ min: 1, max: 1, result: 'fragTrap' }, { min: 2, max: 3, result: 'nothing' }, { min: 4, max: 6, result: 'ammoCache' }])
    expect(c.casket.ammoCache).toMatchObject({ ammoBonus: 2, exhaustedOn: 6 })
  })
  it('maps every 2D6 total to a crew cap (M-4.2)', () => {
    const cap = (total: number) => c.crewCap.filter((r) => total >= r.min && total <= r.max).map((r) => r.cap)
    for (let t = 2; t <= 12; t++) expect(cap(t), `2D6 = ${t}`).toHaveLength(1)
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((t) => cap(t)[0])).toEqual([5, 5, 6, 6, 7, 7, 7, 8, 8, 9, 9])
  })
  it('holds the weapon slot limit and the R-2.7 hard limits', () => {
    expect(c.loadout).toEqual({ maxWeapons: 3, unwieldySlots: 2 })
    expect(c.statLimits.M).toEqual({ min: 1, max: 8 })
    expect(c.statLimits.WS).toEqual({ min: 2, max: 6 })
    expect(c.statLimits.Ld).toEqual({ min: 3, max: 10 })
  })
})

describe('core data: traits (R-14.2, R-14.3)', () => {
  const traits = Object.values(bundle.traits)
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const R142 = [
    'Backstab', 'Blast', 'Blaze', 'Burrowing', 'Chem Delivery', 'Combi', 'Concussion', 'Cursed', 'Defoliate', 'Demolition', 'Digi', 'Disarm', 'Drag', 'Entangle', 'Esoteric', 'Fear',
    'Fixed', 'Flare', 'Flash', 'Gas', 'Graviton Pulse', 'Grenade', 'Gunk', 'Haemophagic', 'Hexagrammatic', 'Impale', 'Knockback', 'Lance', 'Limited', 'Melee', 'Melta', 'Paired',
    'Parry', 'Phase', 'Plentiful', 'Power', 'Power Pack', 'Pulverise', 'Rad-phage', 'Rapid Fire', 'Reckless', 'Rending', 'Scarce', 'Scattershot', 'Seismic', 'Sever', 'Shield',
    'Shield Breaker', 'Shock', 'Shred', 'Sidearm', 'Silent', 'Single Shot', 'Smoke', 'Template', 'Toxin', 'Unstable', 'Unwieldy', 'Versatile', 'Vortex', 'Web',
  ]
  const R143 = [
    'Backstab', 'Blast', 'Blaze', 'Concussion', 'Disarm', 'Entangle', 'Flash', 'Gas', 'Grenade', 'Knockback', 'Limited', 'Melee', 'Melta', 'Paired', 'Parry', 'Plentiful', 'Power',
    'Pulverise', 'Rapid Fire', 'Rending', 'Scarce', 'Scattershot', 'Sever', 'Shock', 'Shred', 'Sidearm', 'Silent', 'Single Shot', 'Smoke', 'Template', 'Toxin', 'Unstable', 'Unwieldy', 'Versatile',
  ]
  it('has every R-14.2 trait name plus the four weapon variants', () => {
    const ids = new Set(traits.map((t) => t.id))
    for (const n of R142) expect(ids.has(`core.t.${slug(n)}`), n).toBe(true)
    for (const n of ['Master-crafted', 'Twin-linked', 'Ironhead', 'Reclaimed/Scavenged']) expect(ids.has(`core.t.${slug(n)}`), n).toBe(true)
    expect(traits).toHaveLength(R142.length + 4)
  })
  it('marks exactly the R-14.3 list implemented', () => {
    expect(traits.filter((t) => t.implemented).map((t) => t.name).sort()).toEqual([...R143].sort())
  })
  it('gives Rapid Fire a count and Blast an inches parameter, every other trait none', () => {
    for (const t of traits) expect(t.param, t.id).toBe(t.id === 'core.t.rapid-fire' ? 'count' : t.id === 'core.t.blast' ? 'inches' : 'none')
  })
})

describe('core data: files', () => {
  it('has the four rules files filled and the four gang-content placeholders as arrays', () => {
    for (const f of ['weapons', 'wargear', 'skills', 'fighter-rules']) {
      const text = fs.readFileSync(path.resolve(__dirname, `../../src/data/core/${f}.json`), 'utf8')
      expect(Array.isArray(JSON.parse(text)), f).toBe(true)
    }
  })
  it('writes every JSON file under src/data without a UTF-8 BOM', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []))
    for (const file of walk(path.resolve(__dirname, '../../src/data'))) {
      const head = fs.readFileSync(file).subarray(0, 3)
      expect(head.equals(Buffer.from([0xef, 0xbb, 0xbf])), file).toBe(false)
    }
  })
  it('keeps every record source non-empty and uses the mancermundo schema ids', () => {
    for (const rec of Object.values(bundle.byId)) expect((rec as { source: string }).source.length).toBeGreaterThan(0)
  })
})
