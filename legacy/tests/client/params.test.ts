import { describe, expect, it } from 'vitest'
import { parseParams } from '@/client/params'
import { buildGameSetup, dataBundle, layoutMapId } from '@/client/game/adapter'
import { AUTO_LAYOUT, defaultBuild, defaultRoster, effectiveLayout, resolveLayout, rollLayout, resolveMission, resolveTeam, teamAlias } from '@/client/game/defaults'
import { buildProblems } from '@/client/game/defaults'

describe('url params', () => {
  it('parses the test hooks of docs/spec/50-client.md section 4', () => {
    const p = parseParams('?test=1&seats=human,bot&seed=abc&mission=secure&layout=02&teams=aod,kom&speed=instant')
    expect(p.test).toBe(true)
    expect(p.seats).toEqual(['human', 'bot'])
    expect(p.seed).toBe('abc')
    expect(p.teams).toEqual(['aod', 'kom'])
    expect(p.speed).toBe('instant')
  })

  it('has safe defaults and ignores junk', () => {
    const p = parseParams('?seats=robot&speed=warp&teams=aod')
    expect(p.test).toBe(false)
    expect(p.seats).toEqual(['human', 'bot'])
    expect(p.speed).toBeNull()
    expect(p.teams).toBeNull()
  })

  it('resolves aliases to ids', () => {
    const b = dataBundle()
    expect(resolveTeam(b, 'aod').id).toBe('angels-of-death')
    expect(resolveTeam(b, 'kom').id).toBe('kommandos')
    expect(teamAlias(b.teams['kommandos']!)).toBe('kom')
    expect(resolveMission(b, 'secure').id).toBe('mission.prelim-secure')
    expect(resolveLayout(b, '2').id).toBe('kz.volkus-ao25-2')
    expect(resolveLayout(b, '02').id).toBe('kz.volkus-ao25-2')
    expect(resolveLayout(b, 'volkus-ao25-6').id).toBe('kz.volkus-ao25-6')
    expect(resolveLayout(b, 'nonsense').id).toBe('kz.volkus-ao25-1')
  })

  it('default rosters are legal for every team', () => {
    const b = dataBundle()
    for (const team of Object.values(b.teams)) {
      expect(Object.keys(defaultRoster(b, team)).length).toBeGreaterThan(0)
      expect(buildProblems(b, defaultBuild(b, team), 4)).toEqual([])
    }
  })
})

describe('layout roll', () => {
  const b = dataBundle()
  it("'auto' rolls one of the six cards from the seed, the same card for the same seed, and a card names its own map", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 120; i++) {
      const l = rollLayout(b, `seed-${i}`)
      expect(effectiveLayout(b, AUTO_LAYOUT, `seed-${i}`).id).toBe(l.id)
      expect(rollLayout(b, `seed-${i}`).id).toBe(l.id)
      seen.add(l.id)
    }
    expect(seen.size).toBe(6)
    expect(effectiveLayout(b, 'kz.volkus-ao25-3', 'any').id).toBe('kz.volkus-ao25-3')
    const mission = resolveMission(b, 'secure')
    expect(layoutMapId(resolveLayout(b, '3'), mission)).toBe('prelim-1')
    expect(layoutMapId(resolveLayout(b, '4'), mission)).toBe('prelim-2')
    // a map the layout does not list is never played
    const setup = buildGameSetup(b, defaultBuild(b, resolveTeam(b, 'aod')), defaultBuild(b, resolveTeam(b, 'kom')), { layoutId: 'kz.volkus-ao25-5', missionId: mission.id, mapId: 'prelim-1' })
    expect(setup.mission?.mapId).toBe('prelim-2')
  })
})
