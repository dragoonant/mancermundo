import { describe, expect, it } from 'vitest'
import { parseParams } from '@/client/params'
import { dataBundle } from '@/client/game/adapter'
import { defaultBuild, defaultRoster, resolveLayout, resolveMission, resolveTeam, teamAlias } from '@/client/game/defaults'
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
    expect(resolveLayout(b, '02').id).toBe('kz.volkus-02')
    expect(resolveLayout(b, 'nonsense').id).toBe('kz.volkus-01')
  })

  it('default rosters are legal for every team', () => {
    const b = dataBundle()
    for (const team of Object.values(b.teams)) {
      expect(Object.keys(defaultRoster(b, team)).length).toBeGreaterThan(0)
      expect(buildProblems(b, defaultBuild(b, team), 4)).toEqual([])
    }
  })
})
