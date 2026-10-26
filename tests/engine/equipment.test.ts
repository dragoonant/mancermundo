import { describe, expect, it } from 'vitest'
import { createGame, step, view } from '@/engine'
import { runHook } from '@/engine/hooks'
import { updateControl } from '@/engine/markers'
import { placeItem, placementIssue, noteWeaponUses, restoreTurningPointWeapons, selectionProblem, teamLimits } from '@/engine/equipment'
import { smokeActivation, smokeObscures, smokeReady, smokeTurningPointEnd, whollyInSmoke } from '@/engine/core-hooks'
import { ScriptedRng } from '@/engine/rng'
import type { GameState, TerrainFeatureDef } from '@/engine/types'
import { place } from '../fixtures/helpers'
import { activateOp, edit, hasOption, openReal, opOf, optionIds, passIt, realBundle, realSetupWith, realGame, take, withCtx } from '../fixtures/real'

const item = (equipmentId: string, n = 1, seat: 'A' | 'B' = 'A') => ({ key: `${seat}:${equipmentId}#${n}`, equipmentId, kind: (equipmentId.match(/mines|comms|ammo/) ? 'marker' : 'terrain') as 'marker' | 'terrain' })

function put(s: GameState, seat: 'A' | 'B', equipmentId: string, x: number, z: number, yaw = 0): GameState {
  return withCtx(s, (ctx) => {
    const it = item(equipmentId, 1, seat)
    const issue = placementIssue(ctx.state, seat, it, { x, z }, yaw)
    if (issue) throw new Error(`placement refused: ${issue.reason}`)
    placeItem(ctx, seat, it, { x, z }, yaw)
  }).state
}

describe('EQP selection (SEQ-002)', () => {
  const base = () => realSetupWith()
  it('accepts up to four distinct options per team, universal or the team own', () => {
    const setup = base()
    setup.equipment = { A: ['aod.e.purity-seals', 'core.e.mines', 'core.e.razor-wire', 'core.e.ammo-cache'], B: ['kom.e.choppas', 'core.e.comms-device'] }
    expect(() => createGame(setup, 's', realBundle)).not.toThrow()
  })
  it('rejects a fifth option, a repeat, an unknown id, another team faction option and a disabled option', () => {
    const bad = (a: string[], why: RegExp) => {
      const setup = base()
      setup.equipment = { A: a, B: [] }
      expect(() => createGame(setup, 's', realBundle)).toThrow(why)
    }
    bad(['core.e.mines', 'core.e.razor-wire', 'core.e.ammo-cache', 'core.e.comms-device', 'core.e.ladders'], /more than 4/)
    bad(['core.e.mines', 'core.e.mines'], /repeated/)
    bad(['core.e.nonsense'], /unknown equipment/)
    bad(['kom.e.choppas'], /another team/)
    bad(['core.e.breaching-charge'], /not offered/)
  })
  it('grenade options need their picks: two of smoke / stun, or of frag / krak', () => {
    const setup = base()
    setup.equipment = { A: ['core.e.utility-grenades'], B: [] }
    setup.equipmentChoices = { A: { 'core.e.utility-grenades': ['core.a.smoke-grenade'] }, B: {} }
    expect(() => createGame(setup, 's', realBundle)).toThrow(/pick 2/)
    setup.equipmentChoices = { A: { 'core.e.utility-grenades': ['core.a.smoke-grenade', 'core.w.frag-grenade'] }, B: {} }
    expect(() => createGame(setup, 's', realBundle)).toThrow(/illegal pick/)
    setup.equipmentChoices = { A: { 'core.e.utility-grenades': ['core.a.stun-grenade', 'core.a.stun-grenade'] }, B: {} }
    expect(() => createGame(setup, 's', realBundle)).not.toThrow()
    expect(selectionProblem(setup, 'A', { teamId: 'angels-of-death', limit: 4 })).toBeNull()
  })
})

describe('EQP placement in set-up (R-1.4)', () => {
  it('players place one item at a time, alternating from the setup-initiative player, inside their territory', () => {
    const setup = realSetupWith({ autoEquipment: false, equipmentA: ['core.e.mines', 'core.e.razor-wire'], equipmentB: ['core.e.comms-device', 'core.e.ammo-cache'] })
    let s = createGame(setup, 'place', realBundle).state
    const rng = new ScriptedRng([6, 1])
    s = take(s, 'roll', rng).state
    s = take(s, 'roll', rng).state
    s = take(s, 'A').state
    s = take(s, 'prelim-1.a').state
    s = take(s, 'prelim-1.b').state
    const order: string[] = []
    while (s.pending?.kind === 'setup.equipMarker') {
      const p = s.pending
      order.push(`${p.seat}:${p.context.equipmentId}`)
      const sug = p.context.suggestion as { x: number; z: number; yaw: number }
      s = step(s, { type: 'setup.equipMarker', seat: p.seat, decisionId: p.id, payload: sug }).state
    }
    expect(order).toEqual(['A:core.e.mines', 'B:core.e.comms-device', 'A:core.e.razor-wire', 'B:core.e.ammo-cache'])
    expect(s.pending?.kind).toBe('setup.deploy')
    for (const m of s.markers.filter((k) => k.equipmentId)) expect(m.owner === 'A' ? m.pos.x <= 0 : m.pos.x >= 0).toBe(true)
  })

  it('refuses a spot outside the territory, too close to other markers or access points, or overlapping terrain', () => {
    const s = realGame({ layoutId: 'kz.volkus-01' })
    const mines = item('core.e.mines')
    expect(placementIssue(s, 'A', mines, { x: 5, z: 0 }, 0)?.reason).toMatch(/territory/) // seat A owns x <= 0
    expect(placementIssue(s, 'A', mines, { x: -30, z: 0 }, 0)).not.toBeNull()
    // overlapping a terrain footprint
    const wall = s.map.features[0]!.parts[0]!.footprint
    const inside = { x: (wall[0]!.x + wall[2]!.x) / 2, z: (wall[0]!.z + wall[2]!.z) / 2 }
    expect(placementIssue(s, 'A', mines, inside, 0)).not.toBeNull()
    // an equipment marker 1" from another marker breaks the "more than 2 inches" clearance of Mines
    const t = put(s, 'A', 'core.e.ammo-cache', -8, -9)
    expect(placementIssue(t, 'A', mines, { x: -8, z: -8 }, 0)?.reason).toMatch(/other markers/)
    expect(placementIssue(t, 'A', mines, { x: -3, z: -9 }, 0)).toBeNull()
  })

  it('barricades and wire are terrain parts with the traits the data names; the heavy barricade stays near the drop zone', () => {
    const s = openReal()
    const light = put(s, 'A', 'core.e.light-barricades', -6, 2)
    const lf = light.map.features.find((f) => f.equipmentId === 'core.e.light-barricades')!
    expect(lf.parts[0]!.traits).toEqual(['light'])
    expect(lf.owner).toBe('A')
    expect(put(s, 'A', 'core.e.razor-wire', -6, 0).map.features.find((f) => f.equipmentId === 'core.e.razor-wire')!.parts[0]!.traits).toEqual(expect.arrayContaining(['exposed', 'insignificant']))
    // within 4" of the drop zone (A's strip is x in [-15, -9] on map 1)
    expect(placementIssue(s, 'A', item('core.e.heavy-barricade'), { x: -8, z: 0 }, 0)).toBeNull()
    expect(placementIssue(s, 'A', item('core.e.heavy-barricade'), { x: -2, z: 0 }, 0)?.reason).toMatch(/drop zone/)
    // more than 2" from other equipment terrain
    expect(placementIssue(light, 'A', item('core.e.heavy-barricade', 2), { x: -8, z: 3.2 }, 0)?.reason).toMatch(/equipmentTerrain/)
  })
})

describe('MISSION-011 Mines', () => {
  it('a Mines marker is hidden from the opponent and triggers on the first operative control range contact: D3+3 damage', () => {
    let s = openReal()
    s = put(s, 'B', 'core.e.mines', 4, 0)
    const mine = s.markers.find((m) => m.equipmentId === 'core.e.mines')!
    expect(mine.hidden).toBe(true)
    expect(view(s, 'A').markers.some((m) => m.equipmentId === 'core.e.mines')).toBe(false)
    expect(view(s, 'B').markers.some((m) => m.equipmentId === 'core.e.mines')).toBe(true)
    expect(view(s, 'A').equipment.placed.some((p) => p.equipmentId === 'core.e.mines')).toBe(false)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(s, marine, 0.5, 0)
    s = activateOp(s, marine)
    s = take(s, 'reposition').state
    const p = s.pending!
    const dice = new ScriptedRng([4]) // D3 = 2, damage 5
    const r = step(s, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 2.8, z: 0 }] } }, dice)
    expect(r.rejection).toBeUndefined()
    expect(r.state.markers.some((m) => m.equipmentId === 'core.e.mines')).toBe(false)
    expect(r.events.find((e) => e.type === 'MineTriggered')).toMatchObject({ operativeId: marine, damage: 5 })
    expect(r.state.operatives[marine]!.wounds).toBe(14 - 5)
    expect(view(r.state, 'A').equipment.placed.some((p2) => p2.equipmentId === 'core.e.mines')).toBe(true) // revealed
  })

  it('also triggers for the owner own operatives, and when an operative is set up next to it', () => {
    let s = openReal()
    s = put(s, 'A', 'core.e.mines', -4, 0)
    const own = opOf(s, 'A', 'aod.intercessor-warrior')
    const r = withCtx(place(s, own, -2.8, 0), (ctx) => updateControl(ctx), new ScriptedRng([6]))
    expect(r.events.find((e) => e.type === 'MineTriggered')).toMatchObject({ operativeId: own, damage: 6 })
    expect(r.state.operatives[own]!.wounds).toBe(14 - 6)
  })

  it('an operative incapacitated by a mine is removed and the activation of the mover ends', () => {
    let s = openReal()
    s = put(s, 'B', 'core.e.mines', 4, 0)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = edit(place(s, marine, 0.5, 0), (st) => {
      st.operatives[marine]!.wounds = 3
    })
    s = take(take(s, marine).state, 'engage').state
    while (s.pending?.kind === 'ploy.firefight') s = passIt(s).state
    s = take(s, 'reposition').state
    const p = s.pending!
    const r = step(s, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 2.8, z: 0 }] } }, new ScriptedRng([6]))
    expect(r.state.operatives[marine]!.status).toBe('removed')
    expect(r.events.some((e) => e.type === 'OperativeRemoved')).toBe(true)
    expect(r.state.pending).toMatchObject({ kind: 'firefight.activate', seat: 'B' })
    expect(r.state.mission!.kills.B).toBe(1)
  })
})

describe('Ammo Cache (M-5.3)', () => {
  it('Ammo Resupply costs 0 AP, needs the controlling operative and a cache of its own, once per turning point', () => {
    let s = openReal({ equipmentA: ['core.e.ammo-cache'] })
    s = put(s, 'A', 'core.e.ammo-cache', -6, 0)
    const cache = s.markers.find((m) => m.equipmentId === 'core.e.ammo-cache')!
    const gunner = opOf(s, 'A', 'aod.intercessor-gunner')
    const foe = opOf(s, 'B', 'kom.boy')
    s = place(s, gunner, -4, 0)
    // an enemy cache is not usable
    const theirs = edit(s, (st) => {
      st.markers.find((m) => m.id === cache.id)!.owner = 'B'
    })
    expect(hasOption(activateOp(theirs, gunner), `ability:core.a.ammo-resupply:${cache.id}`)).toBe(false)
    let t = activateOp(s, gunner)
    expect(hasOption(t, `ability:core.a.ammo-resupply:${cache.id}`)).toBe(true)
    t = take(t, `ability:core.a.ammo-resupply:${cache.id}`).state
    expect(t.firefight.activation!.apSpent).toBe(0)
    expect(t.markers.find((m) => m.id === cache.id)!.usedTp).toBe(1)
    expect(t.effects.some((e) => e.source === 'core.e.ammo-cache' && e.operativeId === gunner)).toBe(true)
    // once per turning point: not offered again
    expect(optionIds(t).some((o) => o.startsWith('ability:core.a.ammo-resupply'))).toBe(false)
    // not in an enemy control range
    const engaged = activateOp(place(s, foe, -2.4, 0), gunner)
    expect(optionIds(engaged).some((o) => o.startsWith('ability:core.a.ammo-resupply'))).toBe(false)
    // while the effect lasts a datacard weapon gets one re-roll (granted through modifyAttackDice)
    const data = { kind: 'shoot' as const, atk: 4, hitDelta: 0, accurate: [] as number[], lethal: null, rerolls: [] as { id: string }[], assists: [] as string[] }
    runHook('modifyAttackDice', { seat: 'A', state: t, operativeId: gunner, targetId: foe, weaponId: 'aod.w.bolt-rifle', data })
    expect(data.rerolls.map((r) => r.id)).toContain('ammo-cache')
  })
})

describe('Razor Wire and Ladders', () => {
  it('Razor Wire is Obstructing: crossing it within 1" costs an additional 1" (M-5.4)', () => {
    let s = openReal()
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(s, marine, -8, 0)
    const cost = (state: GameState): number => {
      let t = activateOp(state, marine)
      t = take(t, 'reposition').state
      const p = t.pending!
      const r = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -4, z: 0 }] } })
      expect(r.rejection).toBeUndefined()
      return (r.events.find((e) => e.type === 'OperativeMoved') as { cost: number }).cost
    }
    expect(cost(s)).toBe(4)
    const wired = put(s, 'A', 'core.e.razor-wire', -6, 0, 90)
    expect(cost(wired)).toBe(5)
    // 6" of move is no longer enough to cross the wire
    let t = activateOp(wired, marine)
    t = take(t, 'reposition').state
    const p = t.pending!
    expect(step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -2, z: 0 }] } }).rejection?.code).toBe('E_OUT_OF_RANGE')
  })

  it('a Ladder makes one climb of the feature it leans on 1" instead of the climbed height (M-5.9)', () => {
    let s = openReal()
    const tower: TerrainFeatureDef = {
      id: 'tower',
      parts: [{ id: 'tower.0', footprint: [{ x: -4, z: -2 }, { x: -2, z: -2 }, { x: -2, z: 2 }, { x: -4, z: 2 }], height: 3, traits: ['vantage'] }],
    }
    s = edit(s, (st) => {
      st.map = { ...st.map, features: [tower] }
    })
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(s, marine, -0.5, 0)
    const climb = (state: GameState): number => {
      let t = activateOp(state, marine)
      t = take(t, 'reposition').state
      const p = t.pending!
      const r = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -2.8, z: 0, y: 3 }] } })
      expect(r.rejection).toBeUndefined()
      return (r.events.find((e) => e.type === 'OperativeMoved') as { cost: number }).cost
    }
    expect(climb(s)).toBe(3 + 3) // 2.3" across (3) and a 3" climb
    const laddered = put(s, 'A', 'core.e.ladders', -1.76, 0, 0)
    const lf = laddered.map.features.find((f) => f.equipmentId === 'core.e.ladders')!
    expect(lf.leansOn).toBe('tower.0')
    expect(climb(laddered)).toBe(3 + 1)
    // a ladder needs terrain at least 2" tall to lean on
    expect(placementIssue(s, 'A', item('core.e.ladders'), { x: -10, z: 5 }, 0)?.reason).toMatch(/upright against terrain/)
  })
})

describe('Grenades (M-5.5, M-5.6)', () => {
  it('MISSION-012 Stun Grenade: a D6 3+ for the target and everyone within 1" costs 1 APL until the end of the next activation; limited to the picks', () => {
    let s = openReal({ equipmentA: ['core.e.utility-grenades'], equipmentChoices: { A: { 'core.e.utility-grenades': ['core.a.stun-grenade', 'core.a.smoke-grenade'] }, B: {} } })
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    const next = opOf(s, 'B', 'kom.burna-boy')
    const far = opOf(s, 'B', 'kom.dakka-boy')
    s = place(place(place(place(s, marine, 0, 0), boy, 4, 0), next, 5.2, 0), far, 5.4, 6)
    let t = activateOp(s, marine)
    expect(hasOption(t, `ability:core.a.stun-grenade:${boy}`)).toBe(true)
    expect(hasOption(t, `ability:core.a.stun-grenade:${far}`)).toBe(false) // beyond 6"
    // boy rolls 3 (stunned), the burna boy 2 (not)
    t = take(t, `ability:core.a.stun-grenade:${boy}`, new ScriptedRng([3, 2])).state
    expect(t.operatives[boy]!.aplMods).toBe(-1)
    expect(t.operatives[next]!.aplMods).toBe(0)
    expect(t.firefight.activation!.apSpent).toBe(1)
    // the single stun pick is spent
    expect(optionIds(t).some((o) => o.startsWith('ability:core.a.stun-grenade'))).toBe(false)
    expect(t.ledger.A.uses['core.a.stun-grenade']).toBe(1)
  })

  it('Smoke Grenade: a smoke marker within 6" obscures what is wholly in it to operatives more than 2" away, and clears after D3 activations', () => {
    let s = openReal({ equipmentA: ['core.e.utility-grenades'], equipmentChoices: { A: { 'core.e.utility-grenades': ['core.a.smoke-grenade', 'core.a.smoke-grenade'] }, B: {} } })
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    s = place(place(s, marine, 0, 0), boy, 4, 0)
    let t = activateOp(s, marine)
    t = take(t, 'ability:core.a.smoke-grenade').state
    expect(t.pending).toMatchObject({ kind: 'ability.choice', canPass: true })
    const spot = t.pending!.options!.find((o) => o.id === '4,0') ?? t.pending!.options![0]!
    const exact = t.pending!.options!.find((o) => o.id.startsWith('4,'))
    t = take(t, (exact ?? spot).id).state
    const smoke = t.markers.find((m) => m.equipmentId === 'smoke')!
    expect(smoke.owner).toBe('A')
    expect(t.ledger.A.uses['core.a.smoke-grenade']).toBe(1)
    // a base wholly within 1" of the marker is in smoke
    expect(whollyInSmoke(t, smoke.pos, 0.3)).toBe(true)
    expect(whollyInSmoke(t, { x: smoke.pos.x + 0.9, z: smoke.pos.z }, 0.3)).toBe(false)
    const inSmoke = edit(t, (st) => {
      st.operatives[boy]!.pos = { x: smoke.pos.x, y: 0, z: smoke.pos.z }
    })
    expect(smokeObscures(inSmoke, inSmoke.operatives[marine]!, inSmoke.operatives[boy]!)).toBe(true)
    // within 2" nothing is obscured
    const close = edit(inSmoke, (st) => {
      st.operatives[marine]!.pos = { x: smoke.pos.x - 1.5, y: 0, z: smoke.pos.z }
    })
    expect(smokeObscures(close, close.operatives[marine]!, close.operatives[boy]!)).toBe(false)
    // the next Ready step rolls D3 (die 5 -> 3), the cloud clears after that many activations
    let r = withCtx(t, (ctx) => smokeReady(ctx), new ScriptedRng([5]))
    expect(r.state.markers.find((m) => m.equipmentId === 'smoke')!.clearsAfter).toBe(3)
    for (let i = 0; i < 2; i++) r = withCtx(r.state, (ctx) => smokeActivation(ctx))
    expect(r.state.markers.some((m) => m.equipmentId === 'smoke')).toBe(true)
    r = withCtx(r.state, (ctx) => smokeActivation(ctx))
    expect(r.state.markers.some((m) => m.equipmentId === 'smoke')).toBe(false)
    // or at the end of the turning point it is cleared in
    const ended = withCtx(withCtx(t, (ctx) => smokeReady(ctx), new ScriptedRng([1])).state, (ctx) => smokeTurningPointEnd(ctx))
    expect(ended.state.markers.some((m) => m.equipmentId === 'smoke')).toBe(false)
  })

  it('MISSION-013 frag and krak grenades use the printed profiles and are limited by the number picked', () => {
    const w = realBundle.weapons
    expect(w['core.w.frag-grenade']).toMatchObject({ atk: 4, hit: 4, dmg: { normal: 2, crit: 4 } })
    expect(w['core.w.frag-grenade']!.rules.map((r) => r.rule)).toEqual(['range', 'blast', 'saturate'])
    expect(w['core.w.krak-grenade']).toMatchObject({ atk: 4, hit: 4, dmg: { normal: 4, crit: 5 } })
    expect(w['core.w.krak-grenade']!.rules).toContainEqual({ rule: 'piercing', x: 1 })
    const s = realGame({ equipmentB: ['core.e.explosive-grenades'], equipmentChoices: { A: {}, B: { 'core.e.explosive-grenades': ['core.w.frag-grenade', 'core.w.frag-grenade'] } } })
    const boy = opOf(s, 'B', 'kom.boy')
    const squig = opOf(s, 'B', 'kom.bomb-squig')
    expect(s.operatives[boy]!.weapons).toContain('core.w.frag-grenade')
    expect(s.operatives[squig]!.weapons).not.toContain('core.w.frag-grenade') // Stoopid: only its own card
    expect(teamLimits(s, 'B')).toEqual([
      { weaponId: 'core.w.frag-grenade', total: 2, per: 'battle' },
      { weaponId: 'core.w.krak-grenade', total: 0, per: 'battle' },
    ])
    // two Shoot actions with frag grenades spend both picks; the weapon then leaves every operative of the team
    const shot = (st: GameState, id: string) =>
      withCtx(st, (ctx) => {
        ctx.events.push({ type: 'ShootStarted', operativeId: id, weaponId: 'core.w.frag-grenade', seq: 0, turningPoint: 1, phase: 'firefight', seat: 'B' })
        noteWeaponUses(ctx)
      }).state
    const one = shot(s, boy)
    expect(one.operatives[boy]!.weapons).toContain('core.w.frag-grenade')
    const two = shot(one, opOf(s, 'B', 'kom.burna-boy'))
    expect(two.operatives[boy]!.weapons).not.toContain('core.w.frag-grenade')
    expect(two.ledger.B.uses['limit:core.w.frag-grenade']).toBe(2)
  })
})

describe('Faction equipment grants (13-teams.md)', () => {
  it('Choppas arm Kommandos that lack a choppa (not Squig, Grot or an operative with a better one)', () => {
    const s = realGame({ equipmentB: ['kom.e.choppas'] })
    const has = (d: string) => s.operatives[opOf(s, 'B', d)]!.weapons.includes('kom.w.choppas-equipment')
    expect(has('kom.burna-boy')).toBe(true)
    expect(has('kom.boss-nob')).toBe(false) // big choppa / power klaw
    expect(has('kom.boy')).toBe(false) // has a choppa already
    expect(has('kom.slasha-boy')).toBe(false) // twin choppas
    expect(has('kom.bomb-squig')).toBe(false)
    expect(has('kom.grot')).toBe(false)
    expect(realBundle.weapons['kom.w.choppas-equipment']).toMatchObject({ atk: 3, hit: 3, dmg: { normal: 4, crit: 5 } })
  })

  it('Dynamite is once per battle and Harpoon once per turning point, team-wide', () => {
    const s = realGame({ equipmentB: ['kom.e.dynamite', 'kom.e.harpoon'] })
    const boy = opOf(s, 'B', 'kom.boy')
    expect(s.operatives[boy]!.weapons).toEqual(expect.arrayContaining(['kom.w.dynamite', 'kom.w.harpoon']))
    const use = (st: GameState, weaponId: string) =>
      withCtx(st, (ctx) => {
        ctx.events.push({ type: 'ShootStarted', operativeId: boy, weaponId, seq: 0, turningPoint: 1, phase: 'firefight', seat: 'B' })
        noteWeaponUses(ctx)
      }).state
    const d = use(s, 'kom.w.dynamite')
    expect(Object.values(d.operatives).filter((o) => o.seat === 'B').some((o) => o.weapons.includes('kom.w.dynamite'))).toBe(false)
    const h = use(s, 'kom.w.harpoon')
    expect(h.operatives[boy]!.weapons).not.toContain('kom.w.harpoon')
    // the Harpoon comes back at the next turning point; Dynamite never does
    const next = withCtx(use(use(s, 'kom.w.dynamite'), 'kom.w.harpoon'), () => undefined).state
    restoreTurningPointWeapons(next)
    expect(next.operatives[boy]!.weapons).toContain('kom.w.harpoon')
    expect(next.operatives[boy]!.weapons).not.toContain('kom.w.dynamite')
  })

  it('Collapsible Stocks remove Range from the Shokka pistol and the Slugga', () => {
    const s = realGame({ equipmentB: ['kom.e.collapsible-stocks'] })
    const boy = opOf(s, 'B', 'kom.boy')
    const data = { kind: 'shoot', rules: realBundle.weapons['kom.w.slugga']!.rules.map((r) => ({ ...r })) }
    runHook('modifyWeaponRules', { seat: 'B', state: s, operativeId: boy, weaponId: 'kom.w.slugga', data })
    expect(data.rules.some((r) => r.rule === 'range')).toBe(false)
    const plain = realGame()
    const d2 = { kind: 'shoot', rules: realBundle.weapons['kom.w.slugga']!.rules.map((r) => ({ ...r })) }
    runHook('modifyWeaponRules', { seat: 'B', state: plain, operativeId: boy, weaponId: 'kom.w.slugga', data: d2 })
    expect(d2.rules.some((r) => r.rule === 'range')).toBe(true)
  })
})

describe('Portable Barricade (M-5.10)', () => {
  it('MOVE WITH BARRICADE moves the operative Move minus 2" and sets the barricade up again beside it', () => {
    let s = openReal({ equipmentA: ['core.e.portable-barricade'] })
    s = put(s, 'A', 'core.e.portable-barricade', -6, 0, 90)
    const feature = s.map.features.find((f) => f.equipmentId === 'core.e.portable-barricade')!
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(s, marine, -6.9, 0)
    let t = activateOp(s, marine)
    const id = `ability:core.a.move-with-barricade:${feature.id}`
    expect(hasOption(t, id)).toBe(true)
    t = take(t, id).state
    expect(t.pending).toMatchObject({ kind: 'move.path' })
    expect(t.pending!.constraints!.maxInches).toBe(4) // Move 6 minus 2
    const p = t.pending!
    // 5" is more than Move minus 2"
    expect(step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -6.9, z: 5 }] } }).rejection?.code).toBe('E_OUT_OF_RANGE')
    const r = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -6.9, z: 3.5 }] } })
    expect(r.rejection).toBeUndefined()
    const moved = r.state.map.features.find((f) => f.equipmentId === 'core.e.portable-barricade')!
    const dz = moved.parts[0]!.footprint[0]!.z - feature.parts[0]!.footprint[0]!.z
    expect(dz).toBeCloseTo(3.5, 3)
    // the action is treated as a Reposition for every restriction
    expect(r.state.firefight.activation!.performed).toEqual(expect.arrayContaining(['ability:core.a.move-with-barricade', 'reposition']))
    expect(optionIds(r.state)).not.toContain('reposition')
  })

  it('Protective: while in cover from it the Save is improved by 1', () => {
    let s = openReal({ equipmentB: ['core.e.portable-barricade'] })
    s = put(s, 'B', 'core.e.portable-barricade', 3, 0, 90)
    const boy = opOf(s, 'B', 'kom.boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(place(s, marine, -2, 0), boy, 4.4, 0)
    const data = { kind: 'shoot' as const, attackerId: marine, weaponId: 'aod.w.bolt-rifle', dice: 3, saveDelta: 0, rerolls: [] }
    runHook('modifyDefenceDice', { seat: 'B', state: s, operativeId: boy, targetId: marine, weaponId: 'aod.w.bolt-rifle', data })
    expect(data.saveDelta).toBe(-1)
  })
})
