// The client side of the four M9 teams (Pathfinders, Hierotek Circle, Plague Marines, Wyrmblade): picker, builder legality,
// glossary entries, token wording and glyphs, the event feed lines, and the tray of hidden operatives (open information).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enumerateRosters, validateRoster, type DatacardData, type SelectionSlot } from '@/data'
import type { GameEvent, Operative } from '@/engine'
import { buildGameSetup, dataBundle, engineBundle, flattenRoster } from '@/client/game/adapter'
import { buildProblems, defaultBuild, defaultLoadouts, resolveLayout, resolveMission, teamList } from '@/client/game/defaults'
import { allEntries, linkTerms, lookupTerm } from '@/client/game/glossary'
import { describeEvent } from '@/client/game/labels'
import { TEAM_PRESENTATION } from '@/client/teams'
import { randomLoadout, addProblem } from '@/client/ui/TeamBuilder'
import { glyphPoints, tokenDef } from '@/client/ui/tokenDefs'
import { tokenTip } from '@/client/ui/tokenInfo'
import { trayEntries, viewerSeats } from '@/client/ui/HiddenTray'
import { createGame } from '@/engine'

const NEW = ['pathfinders', 'hierotek-circle', 'plague-marines', 'wyrmblade'] as const

describe('M9 teams: picker and builder', () => {
  it('M9C-001 all four new teams are in the picker and each default build is fieldable', () => {
    const b = dataBundle()
    const ids = teamList(b).map((t) => t.id)
    for (const t of NEW) expect(ids, t).toContain(t)
    const mission = b.missions[resolveMission(b, 'secure').id]!
    for (const t of NEW) {
      const build = defaultBuild(b, b.teams[t]!)
      expect(buildProblems(b, build, mission.equipmentLimit), t).toEqual([])
      const setup = buildGameSetup(b, build, defaultBuild(b, b.teams['angels-of-death']!), { layoutId: resolveLayout(b, '01').id, missionId: mission.id })
      const r = createGame(setup, `pick-${t}`, engineBundle())
      expect(r.pending?.kind, t).toBe('setup.initiative')
      expect(Object.values(r.state.operatives).filter((o) => o.seat === 'A').length, t).toBeGreaterThanOrEqual(6)
    }
  })

  it('M9C-002 every roster the rules allow is fieldable, and every datacard loadout can be randomised legally', () => {
    const b = dataBundle()
    const mission = b.missions[resolveMission(b, 'secure').id]!
    for (const t of NEW) {
      const team = b.teams[t]!
      let n = 0
      for (const roster of enumerateRosters(team)) {
        if (n++ % 37 !== 0) continue
        expect(validateRoster(team, roster, b.byId as Record<string, DatacardData>).reasons, `${t} ${JSON.stringify(roster)}`).toEqual([])
        const build = { ...defaultBuild(b, team), roster, loadouts: defaultLoadouts(b, team, roster) }
        expect(buildProblems(b, build, mission.equipmentLimit), t).toEqual([])
        if (n > 4000) break
      }
      expect(n, t).toBeGreaterThan(0)
      const build = defaultBuild(b, team)
      const ids = flattenRoster(team, build.roster)
      let seed = 1
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
      const randomised = { ...build, loadouts: ids.map((id) => randomLoadout(b.byId[id] as DatacardData, rnd)) }
      expect(buildProblems(b, randomised, mission.equipmentLimit), `${t} randomised`).toEqual([])
    }
  })

  it('M9C-003 the builder applies weights and caps: Wyrmblade cult agents (two each, at most two), Pathfinder MB3 (two), the single Hierotek Cryptek', () => {
    const b = dataBundle()
    const main = (team: string): SelectionSlot => b.teams[team]!.selection.slots.find((s) => s.id === 'main')!
    const wy = main('wyrmblade')
    expect(addProblem(wy, [], 'wyr.kelermorph')).toBeNull()
    expect(addProblem(wy, ['wyr.kelermorph', 'wyr.locus'], 'wyr.sanctus-sniper')).toMatch(/Cult Agents/)
    expect(addProblem(wy, Array(12).fill('wyr.warrior'), 'wyr.locus')).toMatch(/full/)
    expect(addProblem(wy, ['wyr.gunner-flamer', 'wyr.gunner-webber'], 'wyr.gunner-grenade-launcher')).toMatch(/Gunners/)
    const pf = main('pathfinders')
    expect(addProblem(pf, Array(10).fill('pf.shasla'), 'pf.mb3-recon-drone')).toMatch(/full/)
    expect(addProblem(pf, Array(9).fill('pf.shasla'), 'pf.mb3-recon-drone')).toBeNull()
    expect(addProblem(pf, ['pf.weapons-expert', 'pf.weapons-expert'], 'pf.weapons-expert')).toMatch(/Weapons Expert/)
    const leader = b.teams['hierotek-circle']!.selection.slots.find((s) => s.id === 'leader')!
    expect(leader.from.length).toBe(3)
    expect(addProblem(leader, [], 'hie.psychomancer')).toBeNull()
    expect(addProblem(leader, ['hie.psychomancer'], 'hie.technomancer')).toMatch(/full|only one/i)
  })

  it('M9C-004 every new archetype either has a body GLB or is declared a procedural stand-in', () => {
    const standIns = new Set(Object.values(TEAM_PRESENTATION).flatMap((p) => p.standIns ?? []))
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../public/assets/models/manifest.json'), 'utf8')) as { bodies: Record<string, unknown> }
    const b = dataBundle()
    for (const t of NEW) {
      const archetypes = Object.values(b.byId)
        .filter((r): r is DatacardData => (r as DatacardData).team === t && 'figure' in r)
        .map((c) => c.figure.archetype)
      expect(archetypes.length, t).toBeGreaterThan(5)
      for (const a of archetypes) expect(!!manifest.bodies[a] || standIns.has(a), `${t}: ${a}`).toBe(true)
    }
  })
})

describe('M9 teams: glossary', () => {
  it('M9C-005 every keyword of the four teams has its own entry, not the generic fallback', () => {
    const b = dataBundle()
    const generic = /^Identifies the .* operative type\. It is used by roster selection limits/
    for (const t of NEW) {
      const team = b.teams[t]!
      const keywords = new Set<string>()
      for (const slot of team.selection.slots) for (const id of slot.from) for (const k of (b.byId[id] as DatacardData).keywords) keywords.add(k)
      expect(keywords.size).toBeGreaterThan(8)
      for (const k of keywords) {
        const e = lookupTerm(k, 'keyword')
        expect(e, `${t}: ${k}`).not.toBeNull()
        expect(e!.body, `${t}: ${k}`).not.toMatch(generic)
      }
    }
  })

  it('M9C-006 token and rule terms resolve and link inside prose', () => {
    for (const term of ['Markerlight token', 'Poison token', 'Deathmarked token', 'Madness token', 'Soulsight token', 'HIDING', 'Reanimation marker']) {
      expect(lookupTerm(term), term).not.toBeNull()
    }
    expect(lookupTerm('Poison tokens')!.term).toBe('Poison token')
    const linked = linkTerms('It gains a Poison token and is hiding.').filter((s) => typeof s !== 'string').map((s) => (s as { text: string }).text)
    expect(linked).toContain('Poison token')
    // shared role keywords read for every team that uses them
    expect(lookupTerm('LEADER')!.body).toMatch(/Not every team has one/)
    expect(allEntries().filter((e) => e.term === 'HIDING').length).toBe(1)
  })
})

describe('M9 teams: tokens, feed and hidden operatives', () => {
  it('M9C-007 every token kind the engine places has a name, a glyph and a tooltip from the glossary', () => {
    const kinds = ['pf.markerlight', 'pf.photon', 'pf.pulse', 'pm.poison', 'hie.deathmarked', 'hie.madness', 'hie.chronometron', 'hie.reinforce', 'hie.augment', 'hie.shroud', 'wyr.soulsight']
    const seen = new Set<string>()
    for (const k of kinds) {
      const d = tokenDef(k)
      expect(d.label, k).not.toMatch(/\./)
      expect(seen.has(d.label), `${k} label is unique`).toBe(false)
      seen.add(d.label)
      expect(lookupTerm(d.term), `${k} -> ${d.term}`).not.toBeNull()
      const tip = tokenTip({ kind: k, owner: 'A', count: 2, expires: ['battle'] })
      expect(tip.title).toContain('x2')
      expect(tip.body).toMatch(/lasts the rest of the battle/)
    }
    // an unknown kind still reads sensibly
    expect(tokenDef('zz.shiny-thing').label).toBe('Shiny thing')
    expect(glyphPoints(4, 12).split(' ')).toHaveLength(4)
  })

  it('M9C-008 the feed reads token, set-aside, emerge and reanimation events', () => {
    const base = { seq: 1, turningPoint: 1, phase: 'firefight' as const, seat: 'A' as const }
    const ev = (e: object) => ({ ...base, ...e }) as unknown as GameEvent
    expect(describeEvent(ev({ type: 'TokenChanged', operativeId: 'B1', kind: 'pf.markerlight', owner: 'A', count: 2, delta: 1, reason: 'markerlight' }), null)).toMatch(/gains a Markerlight token.*now 2/)
    expect(describeEvent(ev({ type: 'TokenChanged', operativeId: 'B1', kind: 'pm.poison', owner: 'A', count: 0, delta: -1, reason: 'x' }), null)).toMatch(/loses a Poison token/)
    expect(describeEvent(ev({ type: 'TokenChanged', operativeId: 'B1', kind: 'pm.poison', owner: 'A', count: 1, delta: 0, reason: 'x' }), null)).toBeNull()
    expect(describeEvent(ev({ type: 'OperativeSetAside', operativeId: 'A3', kind: 'setAside' }), null)).toMatch(/set aside/)
    expect(describeEvent(ev({ type: 'OperativeReturned', operativeId: 'A3', pos: { x: 0, y: 0, z: 0 }, wounds: 7, ready: true, kind: 'emerge' }), null)).toMatch(/emerges from hiding/)
    expect(describeEvent(ev({ type: 'OperativeReturned', operativeId: 'A3', pos: { x: 0, y: 0, z: 0 }, wounds: 1, ready: true, kind: 'reanimated' }), null)).toMatch(/reanimated/)
    expect(describeEvent(ev({ type: 'WoundsRegained', operativeId: 'A3', amount: 3, wounds: 9, source: 'x' }), null)).toMatch(/regains 3 wounds/)
    expect(describeEvent(ev({ type: 'ActivationGated', operativeId: 'B2', by: 'hie.madness' }), null)).toMatch(/cannot activate/)
  })

  it('M9C-009 HIDING is open information: the tray lists every hidden operative, the viewer\'s own first, the opponent\'s marked as theirs', () => {
    expect(viewerSeats({ A: 'human', B: 'bot' }, 'B')).toEqual(['A'])
    expect(viewerSeats({ A: 'bot', B: 'human' }, 'A')).toEqual(['B'])
    expect(viewerSeats({ A: 'human', B: 'human' }, 'B')).toEqual(['B'])
    expect(viewerSeats({ A: 'bot', B: 'bot' }, null)).toEqual(['A', 'B'])
    const op = (id: string, seat: 'A' | 'B', hidden: boolean) => ({ id, seat, name: id, status: hidden ? 'reserve' : 'active', ...(hidden ? { offboard: 'setAside' } : {}) }) as unknown as Operative
    const ops = Object.fromEntries([op('A2', 'A', true), op('B1', 'B', true), op('B3', 'B', false), op('A1', 'A', true)].map((o) => [o.id, o]))
    expect(trayEntries(ops, ['B']).map((e) => [e.op.id, e.theirs])).toEqual([
      ['B1', false],
      ['A1', true],
      ['A2', true],
    ])
    expect(trayEntries(ops, ['A', 'B']).every((e) => !e.theirs)).toBe(true)
    // and the feed reads the opponent's set-aside like any other event
    expect(describeEvent({ seq: 1, turningPoint: 1, phase: 'setup', seat: 'B', type: 'OperativeSetAside', operativeId: 'B1', kind: 'setAside' } as unknown as GameEvent, null)).toMatch(/set aside/)
  })
})
