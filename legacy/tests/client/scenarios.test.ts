// Scenario fixtures (src/client/dev/scenarios.ts): each builds a legal Firefight state on the real engine and puts the
// shooter, targets and objective where the UI specs expect them.
import { describe, expect, it } from 'vitest'
import { createGame, step, type GameState } from '@/engine'
import { buildScenario, SCENARIO_NAMES } from '@/client/dev/scenarios'
import { buildGameSetup, dataBundle, engineBundle } from '@/client/game/adapter'
import { fullBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { targetCard, unlistedTargets } from '@/client/game/promptLabels'
import { missionView } from '@/engine/missions'

function base(name: string): GameState {
  const b = dataBundle()
  const setup = buildGameSetup(b, fullBuild(b, resolveTeam(b, 'aod')), fullBuild(b, resolveTeam(b, 'kom')), {
    layoutId: resolveLayout(b, '01').id,
    missionId: resolveMission(b, 'secure').id,
    mapId: 'prelim-1',
    auto: true,
  })
  return buildScenario(name, createGame(setup, `scenario-${name}`, engineBundle()).state)
}

function take(s: GameState, id: string): GameState {
  const o = s.pending?.options?.find((x) => x.id === id)
  if (!o) throw new Error(`no option ${id} in ${s.pending?.kind}: ${(s.pending?.options ?? []).map((x) => x.id).join(',')}`)
  const r = step(s, o.action)
  if (r.rejection) throw new Error(`${id}: ${r.rejection.code} ${r.rejection.reason}`)
  return r.state
}

function toShootTarget(s: GameState, opId: string): GameState {
  let st = take(s, opId)
  st = take(st, 'engage')
  st = take(st, 'shoot')
  if (st.pending?.kind === 'shoot.weapon') st = take(st, 'aod.w.auto-bolt-rifle')
  return st
}

describe('scenario fixtures', () => {
  it('lists the four fixtures', () => {
    expect(SCENARIO_NAMES.sort()).toEqual(['fight', 'objective-contest', 'shoot-cover', 'vantage'])
  })

  it('every scenario starts at firefight.activate for seat A with everyone on the map', () => {
    for (const n of SCENARIO_NAMES) {
      const s = base(n)
      expect(s.pending?.kind, n).toBe('firefight.activate')
      expect(s.pending?.seat, n).toBe('A')
      expect(Object.values(s.operatives).every((o) => Math.abs(o.pos.x) <= 15 && Math.abs(o.pos.z) <= 11), n).toBe(true)
    }
  })

  it('shoot-cover offers a covered target and a clear one, and hides the Concealed target in cover', () => {
    const s = base('shoot-cover')
    const shooter = Object.values(s.operatives).find((o) => o.seat === 'A' && o.datacardId === 'aod.intercessor-gunner')!
    const t = toShootTarget(s, shooter.id)
    expect(t.pending?.kind).toBe('shoot.target')
    const cards = t.pending!.options!.map((o) => ({ o, c: targetCard(o, t) }))
    const kinds = cards.map((x) => `${x.c.name}:${x.c.badge.kind}`)
    expect(cards.some((x) => x.c.badge.kind === 'cover')).toBe(true)
    expect(cards.some((x) => x.c.badge.kind === 'valid')).toBe(true)
    expect(cards.every((x) => x.c.expectedDamage !== null && x.c.expectedDamage > 0)).toBe(true)
    const hidden = Object.values(s.operatives).find((o) => o.datacardId === 'kom.breacha-boy')!
    expect(t.pending!.options!.some((o) => o.id.includes(hidden.id))).toBe(false)
    expect(unlistedTargets(t, t.pending!).map((u) => u.id)).toContain(hidden.id)
  })

  it('vantage gives the shooter Accurate 1 against a target on the ground', () => {
    const s = base('vantage')
    const shooter = Object.values(s.operatives).find((o) => o.seat === 'A' && o.datacardId === 'aod.intercessor-gunner')!
    const t = toShootTarget(s, shooter.id)
    expect(t.pending?.kind).toBe('shoot.target')
    const cards = t.pending!.options!.map((o) => ({ o, d: o.data as Record<string, unknown>, c: targetCard(o, t) }))
    expect(cards.some((x) => x.d.vantageAccurate === 1)).toBe(true)
  })

  it('fight has two enemies in control range', () => {
    const s = base('fight')
    const hero = Object.values(s.operatives).find((o) => o.seat === 'A' && o.datacardId === 'aod.assault-intercessor-warrior')!
    let st = take(s, hero.id)
    st = take(st, 'engage')
    st = take(st, 'fight')
    expect(['fight.target', 'fight.weapon']).toContain(st.pending?.kind)
  })

  it('objective-contest has both seats contesting the centre marker', () => {
    const s = base('objective-contest')
    const m = missionView(s)!.markers.find((k) => k.contesting.A.length > 0 && k.contesting.B.length > 0)
    expect(m).toBeTruthy()
    expect(m!.contesting.A).toHaveLength(2)
    expect(m!.contesting.B).toHaveLength(1)
    expect(m!.controller).toBe('A')
  })
})
