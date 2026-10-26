import { describe, expect, it } from 'vitest'
import { createGame } from '@/engine'
import {
  bundleFromData,
  composeMissionMap,
  defaultRosterFor,
  playableTeams,
  enumerateLoadoutChoices,
  layoutMap,
  missionMap,
  realSetup,
  resolveLoadoutChoice,
  ruleName,
  validateLoadoutChoice,
} from '@/engine/bundle'
import { loadBundle, validateRoster } from '../../src/data'
import { TEST_LAYOUT, realBundle, realGame } from '../fixtures/real'

const data = loadBundle()

describe('data adapter: bundleFromData(loadBundle())', () => {
  it('ADAPT-001 maps every record type onto the engine shapes', () => {
    const b = realBundle
    // the v1 teams have 20 datacards; every team in the data maps over, and the playable set is whatever the
    // team.json files say (data-driven, so adding a team never edits this test)
    expect(Object.values(b.datacards).filter((c) => ['angels-of-death', 'kommandos'].includes(c.teamId))).toHaveLength(20)
    const playable = Object.values(data.teams).filter((t) => t.playable !== false).map((t) => t.id).sort()
    expect(playable).toEqual(expect.arrayContaining(['angels-of-death', 'kommandos']))
    expect(playableTeams(b)).toEqual(playable)
    expect(Object.keys(b.teams).sort()).toEqual(Object.keys(data.teams).sort())
    for (const team of playable) {
      const cards = Object.values(data.byId).filter((r) => (r as { team?: string }).team === team && 'stats' in r && 'base' in r)
      expect(cards.length, `${team} datacards in the data`).toBeGreaterThan(0)
      expect(Object.values(b.datacards).filter((c) => c.teamId === team), `${team} datacards mapped`).toHaveLength(cards.length)
    }
    expect(Object.keys(b.missions ?? {}).sort()).toEqual(['mission.prelim-loot', 'mission.prelim-secure', 'mission.prelim-transmission'])
    expect(Object.keys(b.layouts ?? {}).filter((id) => id !== TEST_LAYOUT)).toHaveLength(6) // the six official cards (plus the engine tests' fixture layout)
    // strategy ploys become gambits, firefight ploys stay ploys
    const strategy = Object.values(b.ploys ?? {}).filter((p) => p.type === 'strategy')
    expect(b.gambits.map((g) => g.id).sort()).toEqual(strategy.map((p) => p.id).sort())
    expect(b.ploys!['aod.p.combat-doctrine']).toMatchObject({ type: 'strategy', cost: 1, team: 'angels-of-death' })
    expect(b.ploys!['core.p.command-re-roll']).toMatchObject({ type: 'firefight', limit: 'unlimited' })
    expect(Object.values(b.equipment ?? {}).filter((e) => e.scope === 'universal').length).toBeGreaterThanOrEqual(11)
  })

  it('ADAPT-002 weapons: bare rule names, numeric Hit, Heavy and Lethal parameters', () => {
    const w = realBundle.weapons
    expect(ruleName('core.wr.seek-light')).toBe('seek-light')
    expect(ruleName('kom.a.wr-explosive')).toBe('explosive')
    expect(w['aod.w.bolt-rifle']).toMatchObject({ type: 'ranged', atk: 4, hit: 3, dmg: { normal: 3, crit: 4 } })
    expect(w['aod.w.bolt-rifle']!.rules).toEqual([{ rule: 'piercing', x: 1, crits: true }])
    expect(w['aod.w.stalker-bolt-rifle-heavy']!.rules).toContainEqual({ rule: 'heavy', only: 'dash' })
    expect(w['aod.w.stalker-bolt-rifle-heavy']!.rules).toContainEqual({ rule: 'lethal', target: 5 })
    expect(w['kom.w.explosives']!.rules.map((r) => r.rule)).toEqual(['blast', 'limited', 'explosive'])
    expect(w['kom.w.shokka-pistol']).toMatchObject({ atk: 6, hit: 4, dmg: { normal: 1, crit: 0 } })
    for (const wp of Object.values(w)) {
      expect(wp.hit).toBeGreaterThanOrEqual(2)
      for (const r of wp.rules) expect(r.rule).not.toMatch(/^core\.wr\./)
    }
  })

  it('ADAPT-003 abilities keep their effect, scope, limits and the code names found in them', () => {
    const a = realBundle.abilities
    expect(a['kom.a.get-it-dun']).toMatchObject({ kind: 'uniqueAction', ap: 1, code: 'supportAplBoost', codes: ['supportAplBoost'], keywords: ['SUPPORT'] })
    expect(a['aod.a.ct-mobile']!.codes).toEqual(['ctMobileCharge'])
    expect(a['aod.a.heroic-leader']).toMatchObject({ limit: 'oncePerTurningPoint' })
    expect(a['aod.a.ct-hardy']).toMatchObject({ choiceGroup: 'chapter-tactic', teamId: 'angels-of-death' })
    expect(a['core.a.secure']!.conditions).toMatchObject({ turningPoint: { min: 2 } })
  })

  it('ADAPT-004 datacards: base mm, keywords, expendable flag and every legal loadout', () => {
    const d = realBundle.datacards
    expect(d['aod.space-marine-captain']).toMatchObject({ baseMm: 40, wounds: 15, save: 3, apl: 3, move: 6 })
    expect(d['kom.bomb-squig']).toMatchObject({ expendable: true, baseMm: 25, wounds: 5, save: 5, apl: 2 })
    expect(d['kom.boss-nob']!.keywords).toContain('LEADER')
    // Assault Intercessor Sergeant: 2 pistols x 4 melee weapons, or plasma pistol and chainsword
    expect(d['aod.assault-intercessor-sergeant']!.legalLoadouts).toHaveLength(9)
    expect(d['aod.intercessor-sergeant']!.legalLoadouts).toHaveLength(15)
    expect(d['kom.boss-nob']!.legalLoadouts).toEqual([['kom.w.big-choppa'], ['kom.w.power-klaw']])
    // a stalker bolt rifle brings both profiles
    const stalker = d['aod.intercessor-warrior']!.legalLoadouts!.find((l) => l.includes('aod.w.stalker-bolt-rifle-heavy'))
    expect(stalker).toEqual(expect.arrayContaining(['aod.w.stalker-bolt-rifle-heavy', 'aod.w.stalker-bolt-rifle-mobile']))
  })

  it('ADAPT-005 loadout resolution from a LoadoutChoice, and its refusals', () => {
    const id = 'aod.assault-intercessor-sergeant'
    expect(resolveLoadoutChoice(realBundle, id, { kit: ['pistol-and-melee'], pistol: ['aod.w.hand-flamer'], melee: ['aod.w.power-fist-assault'] }).weaponIds).toEqual([
      'aod.w.hand-flamer',
      'aod.w.power-fist-assault',
    ])
    expect(resolveLoadoutChoice(realBundle, id, { kit: ['plasma-and-chainsword'] }).weaponIds).toEqual([
      'aod.w.plasma-pistol-standard',
      'aod.w.plasma-pistol-supercharge',
      'aod.w.chainsword-assault',
    ])
    const rifle = resolveLoadoutChoice(realBundle, 'aod.intercessor-warrior', { rifle: ['aod.wg.stalker-bolt-rifle'] })
    expect(rifle.weaponIds).toEqual(['aod.w.stalker-bolt-rifle-heavy', 'aod.w.stalker-bolt-rifle-mobile'])
    expect(() => resolveLoadoutChoice(realBundle, id, { kit: ['pistol-and-melee'], pistol: ['aod.w.bolt-pistol'], melee: ['aod.w.fists'] })).toThrow(/illegal loadout/)
    expect(validateLoadoutChoice(realBundle, id, { kit: ['nope'] })).not.toEqual([])
    expect(enumerateLoadoutChoices(realBundle, id)).toHaveLength(9)
  })

  it('ADAPT-006 the default rosters of both teams are legal rosters', () => {
    for (const team of Object.values(data.teams)) {
      const entries = defaultRosterFor(realBundle, team.id)
      const bySlot: Record<string, string[]> = {}
      const slotOf = (id: string) => team.selection.slots.find((s) => s.from.includes(id))!.id
      for (const e of entries) (bySlot[slotOf(e.datacardId)] ??= []).push(e.datacardId)
      expect(validateRoster(team, bySlot).reasons).toEqual([])
    }
  })

  it('ADAPT-007 mission maps compose drop zones, territories and objective spots onto the layout', () => {
    const base = layoutMap(realBundle, 'kz.volkus-ao25-1')
    expect(base.dropZones).toHaveLength(0)
    expect(base.features.length).toBeGreaterThan(5)
    const secure = realBundle.missions!['mission.prelim-secure']!
    const m1 = composeMissionMap(base, missionMap(secure, 'prelim-1'))
    expect(m1.dropZones.map((z) => z.id)).toEqual(['prelim-1.a', 'prelim-1.b'])
    expect(m1.dropZones[0]!.territory).toBeDefined()
    expect(m1.meta!.objectiveSpots!.default.centre).toEqual({ x: 0, z: -5 })
    expect(m1.meta!.centreline.a.x).toBe(0)
    // part ids are unique across the board and the door is transparent to control range
    const parts = m1.features.flatMap((f) => f.parts.map((p) => p.id))
    expect(new Set(parts).size).toBe(parts.length)
    expect(m1.features.flatMap((f) => f.parts).filter((p) => p.crTransparent).length).toBeGreaterThan(0)
  })

  it('ADAPT-008 a game is created with the default rosters of both teams and reaches the first activation', () => {
    const r = createGame(realSetup(realBundle, { missionId: 'mission.prelim-loot', mapId: 'prelim-2' }), 'adapter', realBundle)
    expect(r.state.pending?.kind).toBe('setup.initiative')
    expect(Object.values(r.state.operatives).filter((o) => o.seat === 'A')).toHaveLength(6)
    expect(Object.values(r.state.operatives).filter((o) => o.seat === 'B')).toHaveLength(11)
    const s = realGame({ equipmentA: ['core.e.comms-device', 'core.e.ammo-cache', 'aod.e.purity-seals'], equipmentB: ['core.e.comms-device', 'core.e.razor-wire', 'kom.e.choppas'] })
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(s.mission).toMatchObject({ id: 'mission.prelim-secure', mapId: 'prelim-1' })
    expect(s.markers.filter((m) => m.kind === 'objective')).toHaveLength(3)
    expect(s.markers.filter((m) => m.kind === 'equipment')).toHaveLength(3)
    expect(s.map.features.filter((f) => f.equipmentId === 'core.e.razor-wire')).toHaveLength(1)
    expect(s.config.A.choices).toEqual({ 'primary-tactic': 'aod.a.ct-sharpshooter', 'secondary-tactic': 'aod.a.ct-stealthy' })
    // grenadier carries frag and krak; the Squig is Expendable and Engaged
    const grenadier = Object.values(s.operatives).find((o) => o.datacardId === 'aod.assault-intercessor-grenadier')!
    expect(grenadier.weapons).toEqual(expect.arrayContaining(['core.w.frag-grenade', 'core.w.krak-grenade']))
    const squig = Object.values(s.operatives).find((o) => o.datacardId === 'kom.bomb-squig')!
    expect(squig.order).toBe('engage')
  })
})
