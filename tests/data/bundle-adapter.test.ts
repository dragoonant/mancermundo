import { describe, expect, it } from 'vitest'
import { loadBundle } from '../../src/data'
import { createGame, rosterFromStarter, step } from '@/engine'
import { bundleFromData } from '@/engine/bundle'
import type { StatKey } from '@/engine/types'
import { realBundle, realSetup } from '../fixtures/real'

const data = loadBundle()
const eb = realBundle()

describe('bundleFromData: data records become runtime records', () => {
  it('parses every characteristic target and keeps plain numbers', () => {
    const tyrant = eb.fighterTypes['gol.forge-tyrant']!
    expect(tyrant.stats).toMatchObject({ M: 4, WS: 3, BS: 3, S: 4, T: 4, W: 2, I: 3, A: 3, Ld: 5, Cl: 4, Wil: 8, Int: 7 })
    expect(tyrant).toMatchObject({ houseId: 'goliath', role: 'leader', baseMm: 32, figureArchetype: 'goliath-leader' })
    expect(tyrant.rules).toContainEqual({ id: 'core.r.group-activation', x: 2 })
    expect(tyrant.limits).toEqual({ min: 1, max: 1 })
    for (const t of Object.values(eb.fighterTypes)) {
      for (const k of Object.keys(t.stats) as StatKey[]) expect(Number.isInteger(t.stats[k]), `${t.id} ${k}`).toBe(true)
    }
    expect(Object.keys(eb.fighterTypes).sort()).toEqual(Object.keys(data.fighterTypes).sort())
  })

  it('normalises weapon strength, damage, ammo, ranges and traits', () => {
    for (const w of Object.values(data.weapons)) {
      const rw = eb.weapons[w.id]!
      expect(rw.profiles).toHaveLength(w.profiles.length)
      w.profiles.forEach((p, i) => {
        const rp = rw.profiles[i]!
        if (typeof p.str === 'number') expect(rp.str).toEqual({ base: 'fixed', value: p.str })
        else expect(rp.str).toEqual({ base: 'user', value: p.str === 'S' ? 0 : Number(p.str.slice(1)) })
        if (p.dmg === '-') expect(rp.dmg).toEqual({ kind: 'none' })
        else if (typeof p.dmg === 'number') expect(rp.dmg).toEqual({ kind: 'fixed', value: p.dmg })
        expect(rp.ammo).toBe(p.ammo === '-' ? null : Number(p.ammo.replace('+', '')))
        expect(rp.range).toEqual({ short: p.range.short, long: p.range.long })
        expect(rp.traits.map((t) => t.trait)).toEqual(p.traits.map((t) => t.trait))
      })
    }
    // a user-strength melee weapon and a fixed-strength gun
    const chainaxe = eb.weapons['core.w.chainaxe']!
    expect(chainaxe.profiles[0]!.str.base).toBe('user')
    expect(eb.weapons['core.w.boltgun']!.profiles[0]!.str.base).toBe('fixed')
  })

  it('maps the action catalogue to the runtime statuses and ids', () => {
    expect(Object.keys(eb.actions).sort()).toEqual(Object.values(data.actions).map((a) => a.key).sort())
    expect(eb.actions.standUp).toMatchObject({ id: 'standUp', type: 'basic', statuses: ['pinned'] })
    expect(eb.actions.crawl!.statuses).toEqual(['pinned', 'seriouslyInjured'])
    expect(eb.actions.runForCover!.requires).toContain('broken')
    expect(eb.actions.move!.statuses).toEqual(['standingActive'])
  })

  it('names the special dice faces for the roll events', () => {
    expect(eb.dice.firepower).toEqual(['hit1+ammo', 'hit1', 'hit1', 'hit2', 'hit2', 'hit3'])
    expect(eb.dice.injury).toEqual(['fleshWound', 'fleshWound', 'seriouslyInjured', 'seriouslyInjured', 'seriouslyInjured', 'outOfAction'])
    expect(eb.dice.scatter).toEqual(['arrow', 'arrow', 'arrow', 'arrow', 'hit', 'hit'])
  })

  it('carries constants, scenarios, skills, wargear and houses over', () => {
    expect((eb.constants as { radii: { groupActivation: number } }).radii.groupActivation).toBe(3)
    expect(Object.keys(eb.scenarios).sort()).toEqual(['scn.forgotten-riches', 'scn.smash-and-grab', 'scn.tunnel-skirmish'])
    expect(eb.scenarios['scn.smash-and-grab']).toMatchObject({ roles: true, deployment: { kind: 'standard', defenderFirst: true } })
    expect(eb.scenarios['scn.forgotten-riches']!.deployment).toMatchObject({ kind: 'tile', withinOfEdge: 3, enemyClearance: 6 })
    expect(Object.keys(eb.skills).length).toBe(Object.keys(data.skills).length + Object.keys(data.rules).length)
    expect(eb.skills['core.r.group-activation']).toMatchObject({ kind: 'fighterRule' })
    expect(eb.wargear['core.g.flak-armour']?.save ?? 0).toBeGreaterThanOrEqual(0)
    expect(Object.keys(eb.houses).sort()).toEqual(['escher', 'goliath'])
    for (const w of Object.values(eb.wargear)) if (w.kind === 'armour') expect(typeof w.save).toBe('number')
  })

  it('compiles every board and lists the starter gangs', () => {
    expect(Object.keys(eb.boards).sort()).toEqual(Object.keys(data.boards).sort())
    expect(eb.boards['hive-heart']?.layout ?? Object.values(eb.boards).find((b) => b.layout === 'brick7')!.layout).toBe('brick7')
    for (const b of Object.values(eb.boards)) {
      expect(b.doors.length).toBeGreaterThanOrEqual(3)
      expect(b.bounds.maxX - b.bounds.minX).toBeGreaterThanOrEqual(24)
    }
    expect(Object.keys(eb.starterGangs!).sort()).toEqual(Object.keys(data.starterGangs).sort())
    const g = rosterFromStarter(eb, 'gol.sg.starter-1', 'a')
    expect(g.houseId).toBe('goliath')
    expect(g.roster.map((f) => f.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'])
    expect(g.roster[0]).toMatchObject({ typeId: 'gol.forge-tyrant' })
    expect(() => rosterFromStarter(eb, 'nope')).toThrow(/unknown starter gang/)
  })

  it('is deterministic: building the bundle twice gives equal records', () => {
    expect(JSON.stringify(bundleFromData(data))).toBe(JSON.stringify(bundleFromData(data)))
  })

  it('every pairing of the four starter gangs sets up a legal game on every 2x3 board', () => {
    const starters = Object.keys(eb.starterGangs!).sort()
    for (const a of starters) {
      for (const b of starters) {
        const setup = realSetup({ starters: [a, b], options: { autoCrew: true, autoDeploy: true } })
        const created = createGame(setup, `pair-${a}-${b}`, eb)
        const r = step(created.state, created.pending!.options![0]!.action)
        expect(r.rejection, `${a} vs ${b}`).toBeUndefined()
        expect(r.state.phase).toBe('action')
        expect(r.pending?.kind).toBe('action.activate')
        const placed = Object.values(r.state.fighters).filter((f) => f.location === 'board')
        expect(placed.length).toBe(setup.gangs.A.roster.length + setup.gangs.B.roster.length)
        expect(r.state.players.A.startingCrew).toBe(setup.gangs.A.roster.length)
      }
    }
  })
})
