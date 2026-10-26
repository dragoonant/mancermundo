import { describe, expect, it } from 'vitest'
import {
  defaultLoadout,
  enumerateLoadouts,
  enumerateRosters,
  loadBundle,
  resolveLoadout,
  rosterSize,
  validateLoadout,
  validateRoster,
  validateTeamChoices,
} from '../../src/data'
import type { AbilityData, DatacardData, Id, RosterSelection, TeamData, WeaponData } from '../../src/data'

const bundle = loadBundle()
const all = Object.values(bundle.byId)
const cardsOf = (team: string) => all.filter((r): r is DatacardData => 'stats' in r && (r as DatacardData).team === team)
const cardMap = Object.fromEntries(all.filter((r) => 'stats' in r).map((r) => [(r as DatacardData).id, r as DatacardData]))
const aod = bundle.teams['angels-of-death']
const kom = bundle.teams['kommandos']

function weaponsOnCards(team: string): Set<Id> {
  const ids = new Set<Id>()
  for (const card of cardsOf(team)) {
    for (const l of enumerateLoadouts(card)) for (const w of resolveLoadout(card, l, bundle.weaponGroups)) ids.add(w)
  }
  return ids
}

describe('team data', () => {
  it('Angels of Death has 9 datacards and 26 weapon profiles; Kommandos 11 datacards and 21 (+3 equipment weapons)', () => {
    expect(cardsOf('angels-of-death')).toHaveLength(9)
    expect(cardsOf('kommandos')).toHaveLength(11)
    expect(weaponsOnCards('angels-of-death').size).toBe(26)
    expect(weaponsOnCards('kommandos').size).toBe(21)
    const komWeapons = all.filter((r): r is WeaponData => 'dmg' in r && (r as WeaponData).team === 'kommandos')
    expect(komWeapons).toHaveLength(24)
  })

  it('datacard stats, bases and figures match 13-teams.md', () => {
    const c = (id: string) => cardMap[id]
    expect(c('aod.space-marine-captain').stats).toEqual({ apl: 3, move: 6, save: '3+', wounds: 15 })
    expect(c('aod.space-marine-captain').base).toBe(40)
    expect(c('aod.heavy-intercessor-gunner').stats).toEqual({ apl: 3, move: 5, save: '3+', wounds: 18 })
    expect(c('aod.eliminator-sniper').stats.move).toBe(7)
    expect(c('aod.eliminator-sniper').base).toBe(40)
    expect(c('kom.boss-nob').stats).toEqual({ apl: 3, move: 6, save: '5+', wounds: 14 })
    expect(c('kom.bomb-squig').expendable).toBe(true)
    expect(c('kom.bomb-squig').base).toBe(25)
    expect(c('kom.grot').stats.wounds).toBe(5)
    for (const card of [...cardsOf('angels-of-death'), ...cardsOf('kommandos')]) {
      expect(card.figure.archetype).toMatch(/^(aod|kom)-/)
      expect(card.keywords.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('weapon profiles carry exact stats and rules (spot checks)', () => {
    const w = (id: string) => bundle.byId[id] as WeaponData
    expect(w('aod.w.plasma-pistol-supercharge')).toMatchObject({
      atk: 4,
      hit: '3+',
      dmg: { normal: 4, crit: 5 },
      profileGroup: 'aod.wg.plasma-pistol',
    })
    expect(w('aod.w.plasma-pistol-supercharge').rules.map((r) => r.rule)).toEqual([
      'core.wr.range',
      'core.wr.hot',
      'core.wr.lethal',
      'core.wr.piercing',
    ])
    expect(w('aod.w.stalker-bolt-rifle-heavy').rules[0]).toEqual({ rule: 'core.wr.heavy', only: 'dash' })
    expect(w('aod.w.bolt-sniper-rifle-mortis').rules).toContainEqual({ rule: 'core.wr.devastating', x: 3 })
    expect(w('kom.w.shokka-pistol').dmg).toEqual({ normal: 1, crit: 0 })
    expect(w('kom.w.burna-deluge').rules).toContainEqual({ rule: 'core.wr.torrent', inches: 0 })
    expect(w('kom.w.scoped-big-shoota-concealed').rules).toContainEqual({ rule: 'kom.a.wr-concealed-position' })
    expect(w('kom.w.dynamite').rules).toContainEqual({ rule: 'core.wr.heavy', only: 'reposition' })
  })

  it('loadout options encode every choice in 13-teams.md', () => {
    const count = (id: string) => enumerateLoadouts(cardMap[id]).length
    expect(count('aod.assault-intercessor-sergeant')).toBe(2 * 4 + 1) // pistol x melee, or plasma + chainsword
    expect(count('aod.intercessor-sergeant')).toBe(3 * 5)
    expect(count('aod.intercessor-gunner')).toBe(3)
    expect(count('aod.space-marine-captain')).toBe(1)
    expect(count('kom.boss-nob')).toBe(2)
    const sgt = cardMap['aod.intercessor-sergeant']
    const stalker = resolveLoadout(sgt, { rifle: ['aod.wg.stalker-bolt-rifle'], melee: ['aod.w.fists'] }, bundle.weaponGroups)
    expect(stalker).toEqual(['aod.w.stalker-bolt-rifle-heavy', 'aod.w.stalker-bolt-rifle-mobile', 'aod.w.fists'])
    const ais = cardMap['aod.assault-intercessor-sergeant']
    expect(validateLoadout(ais, { kit: ['plasma-and-chainsword'] })).toEqual([])
    expect(validateLoadout(ais, { kit: ['plasma-and-chainsword'], pistol: ['aod.w.hand-flamer'] }).join()).toMatch(/pistol/)
    expect(validateLoadout(ais, { kit: ['pistol-and-melee'], pistol: ['aod.w.hand-flamer'] }).join()).toMatch(/melee/)
    expect(validateLoadout(sgt, { rifle: ['aod.w.bolt-pistol'], melee: ['aod.w.fists'] }).join()).toMatch(/not an option/)
    expect(validateLoadout(sgt, defaultLoadout(sgt))).toEqual([])
  })

  it('a default legal roster passes for each team', () => {
    const aodRoster: RosterSelection = {
      leader: ['aod.intercessor-sergeant'],
      main: ['aod.intercessor-gunner', 'aod.heavy-intercessor-gunner', 'aod.eliminator-sniper', 'aod.intercessor-warrior', 'aod.intercessor-warrior'],
    }
    expect(validateRoster(aod, aodRoster, cardMap)).toEqual({ ok: true, reasons: [] })
    expect(rosterSize(aodRoster)).toBe(6)
    const komRoster: RosterSelection = {
      leader: ['kom.boss-nob'],
      main: [
        'kom.bomb-squig',
        'kom.grot',
        'kom.boy',
        'kom.breacha-boy',
        'kom.burna-boy',
        'kom.comms-boy',
        'kom.dakka-boy',
        'kom.rokkit-boy',
        'kom.slasha-boy',
        'kom.snipa-boy',
      ],
    }
    expect(validateRoster(kom, komRoster, cardMap)).toEqual({ ok: true, reasons: [] })
    expect(rosterSize(komRoster)).toBe(11)
    // a lone Squig or Grot is a full selection (RULING T-KOM.2)
    const lone: RosterSelection = { leader: ['kom.boss-nob'], main: ['kom.bomb-squig', ...Array<Id>(8).fill('kom.boy')] }
    expect(validateRoster(kom, lone, cardMap).ok).toBe(true)
    expect(rosterSize(lone)).toBe(10)
  })

  it('known-illegal rosters fail with a reason', () => {
    const twoHeavies: RosterSelection = {
      leader: ['aod.space-marine-captain'],
      main: ['aod.heavy-intercessor-gunner', 'aod.heavy-intercessor-gunner', 'aod.eliminator-sniper', 'aod.intercessor-warrior', 'aod.intercessor-gunner'],
    }
    const a = validateRoster(aod, twoHeavies, cardMap)
    expect(a.ok).toBe(false)
    expect(a.reasons.join()).toMatch(/Heavy Intercessor Gunner can be taken only once/)
    const leaderInMain: RosterSelection = { leader: ['aod.intercessor-gunner'], main: Array<Id>(5).fill('aod.intercessor-warrior') }
    expect(validateRoster(aod, leaderInMain, cardMap).reasons.join()).toMatch(/not on this list/)
    const dupBurna: RosterSelection = { leader: ['kom.boss-nob'], main: ['kom.burna-boy', 'kom.burna-boy', ...Array<Id>(7).fill('kom.boy')] }
    expect(validateRoster(kom, dupBurna, cardMap).reasons.join()).toMatch(/Burna Boy can be taken only once/)
    const squigGrotShort: RosterSelection = { leader: ['kom.boss-nob'], main: ['kom.bomb-squig', 'kom.grot', ...Array<Id>(6).fill('kom.boy')] }
    expect(validateRoster(kom, squigGrotShort, cardMap).reasons.join()).toMatch(/7 selections chosen, 9 required/)
    expect(validateRoster(kom, { leader: [], main: [] }, cardMap).ok).toBe(false)
  })

  it('every enumerated roster shape is legal and both teams have many', () => {
    for (const team of [aod, kom] as TeamData[]) {
      let n = 0
      for (const roster of enumerateRosters(team)) {
        if (n++ > 400) break
        expect(validateRoster(team, roster).ok).toBe(true)
      }
      expect(n).toBeGreaterThan(10)
    }
  })

  it('Chapter Tactics: eight selectable abilities, primary and secondary must differ', () => {
    const tactics = all.filter((r): r is AbilityData => 'kind' in r && (r as AbilityData).choiceGroup === 'chapter-tactic')
    expect(tactics).toHaveLength(8)
    const abilities = Object.fromEntries(all.filter((r) => 'kind' in r).map((r) => [(r as AbilityData).id, r as AbilityData]))
    expect(validateTeamChoices(aod, { 'primary-tactic': 'aod.a.ct-hardy', 'secondary-tactic': 'aod.a.ct-mobile' }, abilities)).toEqual([])
    expect(validateTeamChoices(aod, { 'primary-tactic': 'aod.a.ct-hardy', 'secondary-tactic': 'aod.a.ct-hardy' }, abilities).join()).toMatch(/must differ/)
    expect(validateTeamChoices(aod, { 'primary-tactic': 'aod.a.astartes', 'secondary-tactic': 'aod.a.ct-hardy' }, abilities).join()).toMatch(/not a chapter-tactic/)
    expect(validateTeamChoices(kom, {}, abilities)).toEqual([])
  })

  it('every ploy has a type, window and effect; ploy and equipment counts match 13-teams.md', () => {
    const ploys = all.filter((r) => 'cost' in r && 'window' in r) as { id: string; type: string; window: unknown; effect: unknown }[]
    for (const p of ploys) {
      expect(['strategy', 'firefight']).toContain(p.type)
      expect(p.window).toBeTruthy()
      expect(p.effect).toBeTruthy()
    }
    expect(aod.ploys).toHaveLength(8)
    expect(kom.ploys).toHaveLength(8)
    expect(aod.equipment).toHaveLength(4)
    expect(kom.equipment).toHaveLength(4)
    expect(ploys.filter((p) => p.id.startsWith('core.'))).toHaveLength(1)
    const universal = all.filter((r) => 'scope' in r && (r as { scope: string }).scope === 'universal')
    expect(universal).toHaveLength(11)
  })
})
