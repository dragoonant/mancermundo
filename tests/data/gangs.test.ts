import { describe, expect, it } from 'vitest'
import { CODE_HOOKS, houseIds, loadBundle, rosterFromStarter, starterGangs } from '../../src/data'
import { compositionProblems, starterFighterCost, starterGangCost, starterGangProblems } from '../../src/data/roster'
import { loadoutSlots, upgradeBase, validateAll } from '../../src/data/validate'
import type { FighterTypeData, WeaponData, WeaponProfile } from '../../src/data/types'

const bundle = loadBundle()
const num = (t: string) => Number.parseInt(t, 10)

/** cost, M, WS, BS, S, T, W, I, A, Ld, Cl, Wil, Int - the rows of docs/spec/13-gangs.md sections 2.1 and 3.1. */
const PROFILES: Record<string, [number, number, number, number, number, number, number, number, number, number, number, number, number]> = {
  'gol.forge-tyrant': [135, 4, 3, 3, 4, 4, 2, 3, 3, 5, 4, 8, 7],
  'gol.stimmer': [125, 4, 2, 4, 4, 4, 2, 3, 3, 8, 4, 7, 8],
  'gol.forge-boss': [100, 4, 3, 4, 4, 4, 2, 4, 2, 6, 5, 8, 8],
  'gol.bruiser': [55, 4, 4, 4, 4, 4, 1, 4, 1, 8, 5, 9, 8],
  'gol.bruiser-specialist': [55, 4, 4, 4, 4, 4, 1, 4, 1, 8, 5, 9, 8],
  'gol.bully': [35, 4, 4, 5, 4, 4, 1, 4, 1, 9, 7, 9, 9],
  'gol.forge-born': [35, 5, 4, 5, 3, 4, 1, 4, 1, 9, 7, 9, 9],
  'esc.queen': [125, 5, 3, 3, 3, 3, 2, 2, 3, 5, 5, 6, 7],
  'esc.death-maiden': [115, 6, 2, 3, 3, 4, 2, 2, 3, 8, 4, 7, 7],
  'esc.matriarch': [100, 5, 3, 3, 3, 3, 2, 2, 2, 6, 6, 6, 6],
  'esc.sister': [50, 5, 4, 4, 3, 3, 1, 3, 1, 7, 7, 7, 7],
  'esc.sister-specialist': [50, 5, 4, 4, 3, 3, 1, 3, 1, 7, 7, 7, 7],
  'esc.little-sister': [20, 5, 4, 5, 3, 3, 1, 3, 1, 8, 8, 8, 8],
  'esc.wyld-runner': [45, 6, 4, 4, 2, 3, 1, 3, 1, 9, 7, 9, 9],
}

const profileOf = (t: FighterTypeData) => {
  const s = t.stats
  return [t.cost, s.M, num(s.WS), num(s.BS), s.S, s.T, s.W, num(s.I), s.A, num(s.Ld), num(s.Cl), num(s.Wil), num(s.Int)]
}

const weapon = (id: string): WeaponData => {
  const w = bundle.weapons[id]
  if (!w) throw new Error(`no weapon ${id}`)
  return w
}
const prof = (id: string, profile = 'std'): WeaponProfile => {
  const p = weapon(id).profiles.find((x) => x.id === profile)
  if (!p) throw new Error(`no profile ${id}/${profile}`)
  return p
}
const traitNames = (p: WeaponProfile) => p.traits.map((t) => t.trait.replace('core.t.', '') + (t.x !== undefined ? `(${t.x})` : t.inches !== undefined ? `(${t.inches})` : ''))

describe('gang data: houses and fighter types (13-gangs 2.1, 3.1)', () => {
  it('has the two v1 houses with seven fighter types each', () => {
    expect(houseIds(bundle)).toEqual(['escher', 'goliath'])
    expect(bundle.houses.goliath.fighterTypes).toEqual(['gol.forge-tyrant', 'gol.stimmer', 'gol.forge-boss', 'gol.bruiser', 'gol.bruiser-specialist', 'gol.bully', 'gol.forge-born'])
    expect(bundle.houses.escher.fighterTypes).toEqual(['esc.queen', 'esc.death-maiden', 'esc.matriarch', 'esc.sister', 'esc.sister-specialist', 'esc.little-sister', 'esc.wyld-runner'])
    expect(Object.keys(bundle.fighterTypes)).toHaveLength(14)
  })

  it('copies all 14 base profiles (cost, M WS BS S T W I A Ld Cl Wil Int) from the tables', () => {
    for (const [id, expected] of Object.entries(PROFILES)) expect(profileOf(bundle.fighterTypes[id]), id).toEqual(expected)
  })

  it('gives the roles, group activation and special rules of the tables', () => {
    const t = bundle.fighterTypes
    const ruleIds = (id: string) => t[id].rules.map((r) => r.rule.replace(/^(core|gol|esc)\.r\./, '') + (r.x !== undefined ? `(${r.x})` : ''))
    expect(t['gol.forge-tyrant'].role).toBe('leader')
    expect(ruleIds('gol.forge-tyrant')).toEqual(expect.arrayContaining(['gang-hierarchy', 'gang-leader', 'group-activation(2)', 'tools-of-the-trade']))
    expect(ruleIds('gol.stimmer')).toEqual(expect.arrayContaining(['combat-chems-stash', 'gang-hierarchy', 'tools-of-the-trade']))
    expect(ruleIds('gol.stimmer').some((r) => r.startsWith('group-activation'))).toBe(false)
    expect(ruleIds('gol.forge-boss')).toContain('group-activation(1)')
    expect(ruleIds('gol.forge-born')).toEqual(expect.arrayContaining(['fast-learner', 'gang-fighter', 'hot-headed', 'promotion', 'tools-of-the-trade']))
    expect(t['esc.queen'].role).toBe('leader')
    expect(ruleIds('esc.queen')).toContain('group-activation(2)')
    expect(ruleIds('esc.death-maiden')).toEqual(expect.arrayContaining(['poison-blood', 'gang-hierarchy', 'tools-of-the-trade']))
    expect(ruleIds('esc.death-maiden').some((r) => r.startsWith('group-activation'))).toBe(false)
    expect(ruleIds('esc.matriarch')).toContain('group-activation(1)')
    expect(ruleIds('esc.wyld-runner')).toEqual(expect.arrayContaining(['fast-learner', 'gang-fighter', 'hot-headed', 'promotion', 'tools-of-the-trade']))
    expect(t['gol.bruiser-specialist'].role).toBe('specialist')
    expect(t['esc.sister-specialist'].role).toBe('specialist')
  })

  it('gives the Primary and Secondary skill sets of 2.3 and 3.3', () => {
    const t = bundle.fighterTypes
    expect(t['gol.forge-tyrant'].skillAccess).toEqual({ primary: ['brawn', 'ferocity', 'leadership'], secondary: ['combat', 'shooting', 'muscle'] })
    expect(t['gol.stimmer'].skillAccess.primary).toEqual(['ferocity', 'muscle'])
    expect(t['gol.bruiser'].skillAccess).toEqual({ primary: [], secondary: [] })
    expect(t['esc.queen'].skillAccess.primary).toEqual(['agility', 'combat', 'leadership'])
    expect(t['esc.death-maiden'].skillAccess.primary).toEqual(['agility', 'finesse'])
    expect(t['esc.sister'].skillAccess).toEqual({ primary: [], secondary: [] })
  })

  it('limits each starting gang to one Leader and one Specialist and needs half Gang Fighters', () => {
    for (const house of Object.values(bundle.houses)) {
      expect(house.composition.roles.leader).toEqual({ min: 1, max: 1 })
      expect(house.composition.roles.specialist).toEqual({ max: 1 })
      expect(house.composition.ratio).toEqual([{ roles: ['ganger', 'specialist', 'juve', 'prospect'], atLeastHalf: true }])
    }
    const two = ['gol.forge-tyrant', 'gol.forge-tyrant'].map((id) => bundle.fighterTypes[id])
    expect(compositionProblems(bundle.houses.goliath, two).join(' ')).toContain('at most 1')
    const heavy = ['gol.forge-tyrant', 'gol.stimmer', 'gol.forge-boss', 'gol.bruiser'].map((id) => bundle.fighterTypes[id])
    expect(compositionProblems(bundle.houses.goliath, heavy).join(' ')).toContain('at least half')
    const twoSpecialists = ['gol.forge-tyrant', 'gol.bruiser-specialist', 'gol.bruiser-specialist'].map((id) => bundle.fighterTypes[id])
    expect(compositionProblems(bundle.houses.goliath, twoSpecialists).join(' ')).toContain('specialist')
  })
})

describe('gang data: weapon profiles (13-gangs 4)', () => {
  it('Boltgun: 12/24, +1, S4, AP -1, D2, 6+, Rapid Fire (1)', () => {
    const p = prof('core.w.boltgun')
    expect([p.range.short, p.range.long, p.acc.short, p.acc.long, p.str, p.ap, p.dmg, p.ammo]).toEqual([12, 24, 1, null, 4, -1, 2, '6+'])
    expect(traitNames(p)).toEqual(['rapid-fire(1)'])
  })
  it('Plasma pistol: low power S5 AP-1 D2, maximal power S7 AP-2 D3 Unstable', () => {
    const lo = prof('esc.w.plasma-pistol', 'low')
    const hi = prof('esc.w.plasma-pistol', 'max')
    expect([lo.range.short, lo.range.long, lo.acc.short, lo.str, lo.ap, lo.dmg, lo.ammo]).toEqual([6, 12, 2, 5, -1, 2, '5+'])
    expect([hi.acc.short, hi.str, hi.ap, hi.dmg, hi.ammo]).toEqual([1, 7, -2, 3, '5+'])
    expect(traitNames(hi)).toEqual(['scarce', 'sidearm', 'unstable'])
  })
  it('Meltagun: 6/12, +1, S8, AP -4, D3, 4+, Melta, Scarce', () => {
    const p = prof('core.w.meltagun')
    expect([p.range.short, p.range.long, p.acc.short, p.str, p.ap, p.dmg, p.ammo]).toEqual([6, 12, 1, 8, -4, 3, '4+'])
    expect(traitNames(p)).toEqual(['melta', 'scarce'])
  })
  it('Heavy stubber: 20/40, -1 at long range, S4, AP -1, D1, 4+, Rapid Fire (2), Unwieldy', () => {
    const p = prof('core.w.heavy-stubber')
    expect([p.range.short, p.range.long, p.acc.short, p.acc.long, p.str, p.ap, p.dmg, p.ammo]).toEqual([20, 40, null, -1, 4, -1, 1, '4+'])
    expect(traitNames(p)).toEqual(['rapid-fire(2)', 'unwieldy'])
  })
  it('Grenade launcher: frag S3 Blast (3) Knockback, krak S6 AP-2 D2, smoke Blast (5) at 4+', () => {
    const frag = prof('core.w.grenade-launcher', 'frag')
    const krak = prof('core.w.grenade-launcher', 'krak')
    const smoke = prof('core.w.grenade-launcher.smoke', 'smoke')
    expect([frag.range.short, frag.range.long, frag.acc.short, frag.str, frag.ap, frag.dmg, frag.ammo]).toEqual([6, 24, -1, 3, 0, 1, '6+'])
    expect(traitNames(frag)).toEqual(['blast(3)', 'knockback'])
    expect([krak.str, krak.ap, krak.dmg, krak.ammo]).toEqual([6, -2, 2, '6+'])
    expect([smoke.str, smoke.dmg, smoke.ammo]).toEqual([0, '-', '4+'])
    expect(traitNames(smoke)).toEqual(['blast(5)', 'smoke'])
  })
  it('Missile launcher, multi-melta and heavy bolter match the heavy table', () => {
    const frag = prof('gol.w.missile-launcher', 'frag')
    const krak = prof('gol.w.missile-launcher', 'krak')
    expect([frag.range.short, frag.range.long, frag.str, frag.ap, frag.dmg]).toEqual([24, 48, 4, -1, 1])
    expect([krak.str, krak.ap, krak.dmg]).toEqual([6, -2, 3])
    const mm = prof('gol.w.multi-melta')
    expect([mm.range.short, mm.range.long, mm.str, mm.ap, mm.dmg, mm.ammo]).toEqual([12, 24, 8, -4, 3, '4+'])
    const hb = prof('gol.w.heavy-bolter')
    expect([hb.range.short, hb.range.long, hb.str, hb.ap, hb.dmg, hb.ammo]).toEqual([18, 36, 5, -2, 2, '6+'])
  })
  it('Lasgun and hotshot variants; laspistol', () => {
    const l = prof('esc.w.lasgun')
    expect([l.range.short, l.range.long, l.acc.short, l.str, l.ap, l.dmg, l.ammo]).toEqual([18, 24, 1, 3, 0, 1, '2+'])
    expect(traitNames(l)).toEqual(['plentiful'])
    const h = prof('esc.w.lasgun-hotshot')
    expect([h.str, h.ap, h.ammo, h.traits.length]).toEqual([4, -1, '4+', 0])
    const lp = prof('esc.w.laspistol')
    expect([lp.range.short, lp.range.long, lp.acc.short, lp.str, lp.ammo]).toEqual([8, 12, 1, 3, '2+'])
  })
  it('Stub gun and dumdum rounds', () => {
    const s = prof('core.w.stub-gun')
    expect([s.range.short, s.range.long, s.acc.short, s.str, s.dmg, s.ammo]).toEqual([6, 12, 2, 3, 1, '4+'])
    const d = prof('core.w.stub-gun.dumdum', 'dumdum')
    expect([d.range.short, d.range.long, d.acc.short, d.str, d.ammo]).toEqual([5, 10, 1, 4, '4+'])
    expect(traitNames(d)).toEqual(['limited', 'sidearm'])
  })
  it('Needle rifle and needle pistol carry no Strength or Damage (printed "-")', () => {
    const r = prof('esc.w.needle-rifle')
    expect([r.range.short, r.range.long, r.acc.short, r.str, r.ap, r.dmg, r.ammo]).toEqual([9, 18, 2, 0, -2, '-', '6+'])
    expect(traitNames(r)).toEqual(['scarce', 'silent', 'toxin'])
  })
  it('Close combat weapons: strength is the wielder\'s S, hit modifier in acc.short, reach in long', () => {
    const chainaxe = prof('core.w.chainaxe')
    expect([chainaxe.range.long, chainaxe.acc.short, chainaxe.str, chainaxe.ap, chainaxe.dmg]).toEqual(['E', 1, 'S+1', -1, 1])
    expect(traitNames(chainaxe)).toEqual(['disarm', 'melee', 'parry', 'rending'])
    const renderizer = prof('gol.w.renderizer-serrated-axe')
    expect([renderizer.str, renderizer.ap, renderizer.dmg]).toEqual(['S+2', -1, 2])
    expect(traitNames(renderizer)).toEqual(['melee', 'pulverise', 'unwieldy'])
    const whip = prof('esc.w.shock-whip')
    expect([whip.range.long, whip.acc.short, whip.str, whip.dmg]).toEqual([3, -1, 'S+1', 1])
    const twoHandedAxe = prof('gol.w.two-handed-axe')
    expect([twoHandedAxe.acc.short, twoHandedAxe.str, twoHandedAxe.dmg]).toEqual([-1, 'S+2', 2])
    const rockSaw = prof('gol.w.heavy-rock-saw')
    expect([rockSaw.acc.short, rockSaw.str, rockSaw.ap, rockSaw.dmg]).toEqual([1, 'S+3', -3, 2])
  })
  it('Grenades throw to a multiple of Strength', () => {
    expect(prof('core.w.frag-grenades').range.long).toEqual({ strMultiplier: 3 })
    expect(prof('gol.w.blasting-charges').range.long).toEqual({ strMultiplier: 2 })
    const krak = prof('core.w.krak-grenades')
    expect([krak.acc.long, krak.str, krak.ap, krak.dmg, krak.ammo]).toEqual([-1, 6, -2, 2, '4+'])
  })
  it('keeps the printed costs of the weapons the starter gangs use', () => {
    const costs: [string, number][] = [
      ['core.w.boltgun', 55], ['core.w.stub-gun', 5], ['gol.w.stub-cannon', 20], ['gol.w.combat-shotgun', 60], ['core.w.grenade-launcher', 55],
      ['core.w.chainaxe', 25], ['gol.w.axe', 10], ['gol.w.brute-cleaver', 20], ['gol.w.paired-pulverisers', 50], ['gol.w.renderizer-serrated-axe', 40],
      ['esc.w.plasma-pistol', 50], ['esc.w.power-sword', 45], ['esc.w.lasgun', 5], ['esc.w.shock-whip', 25], ['esc.w.needle-pistol', 25],
      ['esc.w.stiletto-sword', 30], ['esc.w.needle-rifle', 35], ['esc.w.wyld-bow', 10], ['core.w.chainsword', 25],
    ]
    for (const [id, cost] of costs) expect(weapon(id).cost, id).toBe(cost)
  })
  it('gives every weapon a flavour and every upgrade record a base weapon', () => {
    for (const w of Object.values(bundle.weapons)) {
      expect(w.flavour, w.id).toBeTruthy()
      if (w.id.split('.').length > 3) expect(upgradeBase(w.id, bundle.weapons), w.id).toBeTruthy()
    }
  })
})

describe('gang data: armour and wargear (13-gangs 6)', () => {
  it('has the printed saves', () => {
    const g = bundle.wargear
    expect(g['core.g.flak-armour'].save).toBe('6+')
    expect(g['core.g.flak-armour'].saveMods).toEqual(expect.arrayContaining([{ vs: 'template', value: 1 }, { vs: 'blast', value: 1 }]))
    expect(g['core.g.mesh-armour'].save).toBe('5+')
    expect(g['core.g.light-carapace'].save).toBe('4+')
    expect(g['gol.g.heavy-carapace'].save).toBe('4+')
    expect(g['gol.g.furnace-plates'].save).toBe('6+')
    expect(g['gol.g.furnace-plates'].saveMods).toEqual([{ vs: 'front', value: 1 }])
  })
  it('treats the armoured undersuit as combined armour, so it stacks with one standard armour', () => {
    expect(bundle.wargear['core.g.armoured-undersuit'].kind).toBe('equipment')
    expect(bundle.wargear['core.g.armoured-undersuit'].effect).toEqual({ modifySave: { value: 1 } })
  })
})

describe('gang data: starter gangs (13-gangs 8)', () => {
  const COSTS: Record<string, { total: number; fighters: number[]; slots: number[]; skills: string[][] }> = {
    'gol.sg.starter-1': {
      total: 1000,
      fighters: [170, 185, 175, 135, 125, 90, 65, 55],
      slots: [2, 3, 2, 2, 2, 2, 2, 2],
      skills: [['nerves-of-steel'], ['nerves-of-steel'], ['true-grit'], [], [], [], [], []],
    },
    'gol.sg.starter-2': {
      total: 995,
      fighters: [210, 185, 120, 120, 65, 65, 65, 55, 55, 55],
      slots: [3, 2, 2, 1, 2, 2, 2, 2, 2, 2],
      skills: [['nerves-of-steel'], ['unstoppable'], [], [], [], [], [], [], [], []],
    },
    'esc.sg.starter-1': {
      total: 995,
      fighters: [235, 145, 185, 120, 65, 65, 65, 65, 50],
      slots: [2, 2, 2, 2, 1, 1, 1, 1, 2],
      skills: [['spring-up'], ['dodge'], ['spring-up'], [], [], [], [], [], []],
    },
    'esc.sg.starter-2': {
      total: 995,
      fighters: [170, 200, 100, 65, 65, 65, 140, 90, 50, 50],
      slots: [2, 2, 2, 1, 1, 1, 2, 2, 2, 2],
      skills: [['spring-up'], ['dodge'], [], [], [], [], [], [], [], []],
    },
  }

  it('has two starter gangs per house, four in all', () => {
    expect(starterGangs('goliath', bundle).map((s) => s.id)).toEqual(['gol.sg.starter-1', 'gol.sg.starter-2'])
    expect(starterGangs('escher', bundle).map((s) => s.id)).toEqual(['esc.sg.starter-1', 'esc.sg.starter-2'])
    expect(starterGangs('goliath', bundle).map((s) => s.name)).toEqual(['Furnace Crew', 'Cheap Muscle'])
    expect(starterGangs('escher', bundle).map((s) => s.name)).toEqual(['Lasgun Line', 'Wyld Skirmishers'])
    expect(starterGangs('goliath', bundle).map((s) => s.fighters.length)).toEqual([8, 10])
    expect(starterGangs('escher', bundle).map((s) => s.fighters.length)).toEqual([9, 10])
  })

  for (const [id, expected] of Object.entries(COSTS)) {
    const sg = bundle.starterGangs[id]
    describe(id, () => {
      it('costs the printed total, at most 1000 credits', () => {
        expect(starterGangCost(bundle, sg)).toBe(expected.total)
        expect(starterGangCost(bundle, sg)).toBeLessThanOrEqual(1000)
        expect(sg.credits).toBe(1000)
      })
      it('costs the printed price per fighter', () => {
        expect(sg.fighters.map((f) => starterFighterCost(bundle, f))).toEqual(expected.fighters)
      })
      it('is legal: composition, equipment from each type\'s list, at most one armour, at most 3 weapon slots', () => {
        expect(starterGangProblems(bundle, sg)).toEqual([])
        for (const f of sg.fighters) {
          expect(loadoutSlots(bundle.weapons, f.weapons), f.name).toBeLessThanOrEqual(3)
        }
        expect(sg.fighters.map((f) => loadoutSlots(bundle.weapons, f.weapons))).toEqual(expected.slots)
      })
      it('gives the printed free skills, from Primary sets', () => {
        expect(sg.fighters.map((f) => f.skills.map((s) => s.split('.').pop()))).toEqual(expected.skills)
        sg.fighters.forEach((f) => {
          for (const s of f.skills) expect(bundle.fighterTypes[f.type].skillAccess.primary).toContain(bundle.skills[s].set)
        })
      })
      it('builds a roster whose ids are unique', () => {
        const roster = rosterFromStarter(bundle, id, 'a').roster
        expect(new Set(roster.map((r) => r.id)).size).toBe(roster.length)
      })
    })
  }

  it('uses only exotic-beast wargear the Wyld Runner list offers (the Phelynx, kept for cost fidelity)', () => {
    const sg = bundle.starterGangs['esc.sg.starter-2']
    expect(sg.fighters.filter((f) => f.wargear.includes('esc.g.phelynx'))).toHaveLength(1)
  })
})

describe('gang data: validation and code hooks', () => {
  it('passes the full data validation with no problems', () => {
    expect(validateAll({ sourcesDir: false, allowPendingCodes: true }).errors).toEqual([])
  })
  it('names its code hooks in camelCase; they stay pending until the engine registers them (S4K)', () => {
    expect(CODE_HOOKS.length).toBeGreaterThan(30)
    for (const h of CODE_HOOKS) expect(h.name, h.name).toMatch(/^[a-z][a-zA-Z0-9]*$/)
  })
})
