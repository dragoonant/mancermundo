// Every `{ "code": "<name>" }` hook named in the data is registered, and each one fires at least once in a
// real game built from the data adapter (the scenarios below drive the real engine paths; passive rules are
// asked through the hook point the attack code uses).
import { beforeAll, describe, expect, it } from 'vitest'
import { createGame, step } from '@/engine'
import { allowedOrders, chargeFromControlRange, chargeUnderConceal, actionForbidden, maxRepeats, refreshFlags } from '@/engine/abilities'
import { effectiveRules } from '@/engine/attack-common'
import { getCodeHook, hookFireCount, registeredCodeHooks } from '@/engine/code-hooks'
import { commsBonus } from '@/engine/core-hooks'
import { removeNow } from '@/engine/effects'
import { placeItem } from '@/engine/equipment'
import { runHook } from '@/engine/hooks'
import { updateControl } from '@/engine/markers'
import { offersFor, usePloy } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { normalBlocksCrit } from '@/engine/teams/angels-of-death'
import type { GameState } from '@/engine/types'
import { CODE_HOOKS, loadBundle } from '../../src/data'
import { drive, place } from '../fixtures/helpers'
import { play } from '../fixtures/attack'
import { activateOp, edit, hasOption, newRealGame, openReal, opOf, passIt, realBundle, realGame, realSetupWith, roster, take, withCtx } from '../fixtures/real'

const names = CODE_HOOKS.map((h) => h.name)
const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })
const tac = (primary: string, secondary = 'aod.a.ct-hardy') => ({ teamChoices: { A: { 'primary-tactic': primary, 'secondary-tactic': secondary }, B: {} } })
const NEUTRAL = tac('aod.a.ct-mobile', 'aod.a.ct-hardy')

function toGambit(opts: Parameters<typeof newRealGame>[0] = {}): GameState {
  return drive(newRealGame(opts, 'hooks').state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

/** B on turn, A's far-away sniper already activated. */
function bTurn(s: GameState): GameState {
  const sn = opOf(s, 'A', 'aod.eliminator-sniper')
  return take(activateOp(place(s, sn, -13, 9), sn), 'end').state
}

const scenarios: Record<string, () => void> = {
  adaptiveTactics() {
    take(toGambit(), 'aod.p.adaptive-tactics:aod.a.ct-hardy')
  },
  combatDoctrine() {
    take(toGambit(), 'aod.p.combat-doctrine:tactical')
  },
  ignoreInjuredChanges() {
    take(toGambit(), 'aod.p.and-they-shall-know-no-fear')
  },
  doctrineWarfare() {
    const g = toGambit({ rosterA: roster(['aod.assault-intercessor-sergeant', 'aod.intercessor-warrior']) })
    take(g, 'aod.p.combat-doctrine:assault')
  },
  adjustDoctrine() {
    let s = openReal(NEUTRAL)
    s = edit(s, (st) => {
      st.config.A.doctrine = 'tactical'
      st.ledger.A.tp.push('aod.p.combat-doctrine')
    })
    const m = opOf(s, 'A', 'aod.intercessor-warrior')
    const o = offersFor(s, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: m }).find((x) => x.ployId === 'aod.p.adjust-doctrine')!
    withCtx(s, (ctx) => usePloy(ctx, 'A', o, { window: 'firefight.actionEnded', subjectId: m }))
  },
  heroicLeader() {
    const s = openReal(NEUTRAL)
    const cap = opOf(s, 'A', 'aod.space-marine-captain')
    const info = { window: 'fight.rolled', subjectId: cap, attackerId: cap, targetId: opOf(s, 'B', 'kom.boy'), kind: 'fight' }
    const free = edit(s, (st) => {
      st.firefight.activation = { operativeId: cap, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['charge'], declared: null }
    })
    const o = offersFor(free, 'A', 'fight.rolled', info).find((x) => x.ployId === 'aod.p.shock-assault')!
    expect(o.via).toBe('heroicLeader')
    withCtx(free, (ctx) => usePloy(ctx, 'A', o, info))
  },
  shockAssaultStrike() {
    let s = openReal(NEUTRAL)
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    s = edit(place(place(s, w, 0, 0), boy, 4, 0), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    let t = activateOp(s, w)
    t = take(t, 'charge').state
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 2.2, z: 0 }] } }).state
    t = take(t, 'fight').state
    play(t, new ScriptedRng([6, 4, 2, 1, 1, 1, 1, 1]), {
      'ploy.firefight': (q) => q.options!.find((x) => (x.action.payload as { ployId: string }).ployId === 'aod.p.shock-assault')?.action ?? pass(q),
    })
  },
  kunninButBrutal() {
    let s = openReal(NEUTRAL)
    const boy = opOf(s, 'B', 'kom.boy')
    s = edit(place(s, boy, 3, 0), (st) => {
      st.operatives[boy]!.order = 'conceal'
      st.firefight.activation = { operativeId: boy, seat: 'B', counteract: false, stage: 'action', apSpent: 1, performed: ['charge'], declared: null }
    })
    const info = { window: 'fight.rolled', subjectId: boy, attackerId: boy, targetId: opOf(s, 'A', 'aod.intercessor-warrior'), kind: 'fight' }
    const o = offersFor(s, 'B', 'fight.rolled', info).find((x) => x.ployId === 'kom.p.kunnin-but-brutal')!
    withCtx(s, (ctx) => usePloy(ctx, 'B', o, info))
  },
  shakeItOff() {
    const s = openReal(NEUTRAL)
    const boy = opOf(s, 'B', 'kom.boy')
    const info = { window: 'firefight.activationStart', subjectId: boy }
    const o = offersFor(s, 'B', 'firefight.activationStart', info).find((x) => x.ployId === 'kom.p.shake-it-off')!
    withCtx(s, (ctx) => usePloy(ctx, 'B', o, info))
  },
  astartes() {
    const s = openReal(NEUTRAL)
    expect(maxRepeats(s, s.operatives[opOf(s, 'A', 'aod.intercessor-warrior')]!, 'shoot', ['shoot'])).toBe(2)
  },
  krumpinTime() {
    const s = openReal()
    expect(maxRepeats(s, s.operatives[opOf(s, 'B', 'kom.boss-nob')]!, 'fight', ['fight'])).toBe(2)
  },
  throatSlittas() {
    const s = openReal()
    expect(chargeUnderConceal(s, s.operatives[opOf(s, 'B', 'kom.boy')]!)).toBe(true)
  },
  stoopid() {
    const s = openReal()
    expect(actionForbidden(s, s.operatives[opOf(s, 'B', 'kom.bomb-squig')]!, 'guard')).not.toBeNull()
  },
  sneakyZogger() {
    const s = openReal()
    expect(allowedOrders(s, s.operatives[opOf(s, 'B', 'kom.grot')]!)).toEqual(['conceal'])
  },
  ctMobileCharge() {
    const s = openReal(tac('aod.a.ct-mobile'))
    expect(chargeFromControlRange(s, s.operatives[opOf(s, 'A', 'aod.intercessor-warrior')]!)).toBe(true)
  },
  ctResolute() {
    const s = realGame(tac('aod.a.ct-resolute'))
    refreshFlags(s)
  },
  ctDueller() {
    const s = realGame(tac('aod.a.ct-dueller'))
    expect(normalBlocksCrit(s, opOf(s, 'A', 'aod.intercessor-warrior'), false)).toBe(true)
  },
  ctSiegeNoAssist() {
    const s = realGame(tac('aod.a.ct-siege-specialist'))
    const data = { kind: 'fight' as const, atk: 4, hitDelta: 0, accurate: [], lethal: null, rerolls: [], assists: ['x'] }
    runHook('modifyAttackDice', { seat: 'B', state: s, operativeId: opOf(s, 'B', 'kom.boy'), targetId: opOf(s, 'A', 'aod.intercessor-warrior'), weaponId: 'kom.w.choppa', data })
    expect(data.assists).toEqual([])
  },
  ctHardy() {
    const s = realGame(tac('aod.a.ct-hardy', 'aod.a.ct-mobile'))
    const dice = [{ value: 5, kind: 'normal' as const, rerolled: false }]
    runHook('afterDefenceRoll', { seat: 'A', state: s, operativeId: opOf(s, 'A', 'aod.intercessor-warrior'), data: { kind: 'shoot', side: 'defence', dice, requests: [], choices: {} } })
    expect(dice[0]!.kind).toBe('crit')
  },
  ctStealthy() {
    const s = realGame(tac('aod.a.ct-stealthy', 'aod.a.ct-mobile'))
    const dice = [{ value: null, kind: 'normal' as const, rerolled: false, tag: 'cover' }, { value: 1, kind: 'fail' as const, rerolled: false }]
    runHook('afterDefenceRoll', { seat: 'A', state: s, operativeId: opOf(s, 'A', 'aod.intercessor-warrior'), data: { kind: 'shoot', side: 'defence', dice, requests: [], choices: {} } })
    expect(dice[1]!.kind).toBe('normal')
  },
  camoCloak() {
    const s = realGame()
    effectiveRules(s, s.operatives[opOf(s, 'B', 'kom.burna-boy')]!, s.data.weapons['kom.w.burna-standard']!, 'shoot', opOf(s, 'A', 'aod.eliminator-sniper'))
  },
  grenadier() {
    const s = realGame()
    const data = { kind: 'shoot' as const, atk: 4, hitDelta: 0, accurate: [], lethal: null, rerolls: [], assists: [] }
    runHook('modifyAttackDice', { seat: 'A', state: s, operativeId: opOf(s, 'A', 'aod.assault-intercessor-grenadier'), targetId: opOf(s, 'B', 'kom.boy'), weaponId: 'core.w.frag-grenade', data })
    expect(data.hitDelta).toBe(-1)
  },
  tiltingShields() {
    const s = realGame({ equipmentA: ['aod.e.tilting-shields'] })
    const slasha = opOf(s, 'B', 'kom.slasha-boy')
    withCtx(s, (ctx) => {
      const data = { kind: 'fight', targetId: opOf(s, 'A', 'aod.intercessor-warrior'), rules: realBundle.weapons['kom.w.twin-choppas']!.rules.map((r) => ({ ...r })) }
      runHook('modifyWeaponRules', { seat: 'B', state: ctx.state, engine: ctx, operativeId: slasha, weaponId: 'kom.w.twin-choppas', targetId: data.targetId, data })
    })
  },
  auspex() {
    let s = openReal({ ...NEUTRAL, equipmentA: ['aod.e.auspex'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    s = place(place(s, w, 0, 0), boy, 5, 0)
    let t = take(activateOp(s, w), 'shoot').state
    t = take(t, 'aod.e.auspex').state
    runHook('target.status', { seat: 'A', state: t, operativeId: w, targetId: boy, data: { obscured: true, inCover: false } as never })
  },
  optics() {
    let t = activateOp(openReal(), opOf(openReal(), 'A', 'aod.eliminator-sniper'))
    t = take(t, 'ability:aod.a.optics').state
    const sn = opOf(t, 'A', 'aod.eliminator-sniper')
    runHook('target.status', { seat: 'A', state: t, operativeId: sn, targetId: opOf(t, 'B', 'kom.boy'), data: { obscured: true, inCover: false } as never })
  },
  chapterVeteran() {
    createGame(realSetupWith({ rosterA: roster(['aod.intercessor-sergeant', 'aod.intercessor-warrior']) }), 'v', realBundle)
  },
  choppasEquipment() {
    realGame({ equipmentB: ['kom.e.choppas'] })
  },
  explosiveRule() {
    const s = openReal()
    const squig = opOf(s, 'B', 'kom.bomb-squig')
    runHook('beforeShootTargetSelect', { seat: 'B', state: s, operativeId: squig, weaponId: 'kom.w.explosives', data: { weaponId: 'kom.w.explosives', candidates: [], secondary: false } })
  },
  concealedPosition() {
    const s = openReal()
    const snipa = opOf(s, 'B', 'kom.snipa-boy')
    withCtx(s, (ctx) => runHook('afterShootResolved', { seat: 'B', state: ctx.state, engine: ctx, operativeId: snipa, weaponId: 'kom.w.scoped-big-shoota-concealed', data: { weaponId: null, targets: [], incapacitated: [] } }))
  },
  boom() {
    const s = openReal()
    const squig = opOf(s, 'B', 'kom.bomb-squig')
    withCtx(edit(place(s, squig, 0, 0), (st) => (st.operatives[squig]!.wounds = 0)), (ctx) => removeNow(ctx, squig), new ScriptedRng([4, 4]))
  },
  mines() {
    let s = openReal()
    s = withCtx(s, (ctx) => placeItem(ctx, 'A', { key: 'A:core.e.mines#1', equipmentId: 'core.e.mines', kind: 'marker' }, { x: -4, z: 0 }, 0)).state
    withCtx(place(s, opOf(s, 'A', 'aod.intercessor-warrior'), -2.8, 0), (ctx) => updateControl(ctx), new ScriptedRng([2]))
  },
  commsDevice() {
    let s = openReal({ equipmentB: ['core.e.comms-device'] })
    s = edit(s, (st) => {
      st.markers.push({ id: 'cd', kind: 'equipment', pos: { x: 6, z: 0 }, owner: 'B', carriedBy: null, controller: 'B', equipmentId: 'core.e.comms-device' })
    })
    s = place(s, opOf(s, 'B', 'kom.comms-boy'), 7.6, 0)
    expect(commsBonus(s, 'B')).toBe(3)
  },
  ammoResupply() {
    let s = openReal({ equipmentA: ['core.e.ammo-cache'] })
    s = withCtx(s, (ctx) => placeItem(ctx, 'A', { key: 'A:core.e.ammo-cache#1', equipmentId: 'core.e.ammo-cache', kind: 'marker' }, { x: -6, z: 0 }, 0)).state
    const g = opOf(s, 'A', 'aod.intercessor-gunner')
    const t = take(activateOp(place(s, g, -4, 0), g), `ability:core.a.ammo-resupply:${s.markers.find((m) => m.equipmentId === 'core.e.ammo-cache')!.id}`).state
    const d = { kind: 'shoot' as const, atk: 4, hitDelta: 0, accurate: [], lethal: null, rerolls: [], assists: [] }
    runHook('modifyAttackDice', { seat: 'A', state: t, operativeId: g, targetId: opOf(t, 'B', 'kom.boy'), weaponId: 'aod.w.bolt-rifle', data: d })
  },
  razorWire() {
    let s = openReal({ equipmentA: ['core.e.razor-wire'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    s = withCtx(place(s, w, -8, 0), (ctx) => placeItem(ctx, 'A', { key: 'A:core.e.razor-wire#1', equipmentId: 'core.e.razor-wire', kind: 'terrain' }, { x: -6, z: 0 }, 90)).state
    const t = take(activateOp(s, w), 'reposition').state
    const p = t.pending!
    step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -4, z: 0 }] } })
  },
  ladders() {
    let s = openReal({ equipmentA: ['core.e.ladders'] })
    const tower = { id: 'tower', parts: [{ id: 'tower.0', footprint: [{ x: -4, z: -2 }, { x: -2, z: -2 }, { x: -2, z: 2 }, { x: -4, z: 2 }], height: 3, traits: ['vantage' as const] }] }
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    s = edit(place(s, w, -0.5, 0), (st) => {
      st.map = { ...st.map, features: [tower] }
    })
    s = withCtx(s, (ctx) => placeItem(ctx, 'A', { key: 'A:core.e.ladders#1', equipmentId: 'core.e.ladders', kind: 'terrain' }, { x: -1.76, z: 0 }, 0)).state
    const t = take(activateOp(s, w), 'reposition').state
    const p = t.pending!
    step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -2.8, z: 0, y: 3 }] } })
  },
  portableBarricade() {
    let s = openReal({ equipmentB: ['core.e.portable-barricade'] })
    s = withCtx(s, (ctx) => placeItem(ctx, 'B', { key: 'B:core.e.portable-barricade#1', equipmentId: 'core.e.portable-barricade', kind: 'terrain' }, { x: 3, z: 0 }, 90)).state
    const boy = opOf(s, 'B', 'kom.boy')
    const m = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(place(s, m, -2, 0), boy, 4.4, 0)
    runHook('modifyDefenceDice', { seat: 'B', state: s, operativeId: boy, targetId: m, weaponId: 'aod.w.bolt-rifle', data: { kind: 'shoot', attackerId: m, weaponId: 'aod.w.bolt-rifle', dice: 3, saveDelta: 0, rerolls: [] } })
  },
  moveWithBarricade() {
    let s = openReal({ equipmentA: ['core.e.portable-barricade'] })
    s = withCtx(s, (ctx) => placeItem(ctx, 'A', { key: 'A:core.e.portable-barricade#1', equipmentId: 'core.e.portable-barricade', kind: 'terrain' }, { x: -6, z: 0 }, 90)).state
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const id = s.map.features.find((f) => f.equipmentId === 'core.e.portable-barricade')!.id
    const t = take(activateOp(place(s, w, -6.9, 0), w), `ability:core.a.move-with-barricade:${id}`).state
    const p = t.pending!
    step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -6.9, z: 2 }] } })
  },
  missionSecure() {
    missionAction('mission.prelim-secure', 'core.a.secure')
  },
  missionLoot() {
    missionAction('mission.prelim-loot', 'core.a.loot')
  },
  missionTransmit() {
    missionAction('mission.prelim-transmission', 'core.a.initiate-transmission')
  },
  stunGrenade() {
    const s = openReal({ equipmentA: ['core.e.utility-grenades'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    take(activateOp(place(place(s, w, 0, 0), boy, 4, 0), w), `ability:core.a.stun-grenade:${boy}`, new ScriptedRng([4]))
  },
  smokeGrenade() {
    const s = openReal({ equipmentA: ['core.e.utility-grenades'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    let t = take(activateOp(place(s, w, 0, 0), w), 'ability:core.a.smoke-grenade').state
    t = take(t, t.pending!.options![0]!.id).state
    expect(t.markers.some((m) => m.equipmentId === 'smoke')).toBe(true)
  },
  taktikalWotNotz() {
    const s = openReal()
    const boy = opOf(s, 'B', 'kom.boy')
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    take(activateOp(bTurn(place(place(s, boy, 4, 0), w, 0, 0)), boy), `ability:core.a.stun-grenade:${w}`, new ScriptedRng([4]))
  },
  supportAplBoost() {
    const s = openReal()
    const boss = opOf(s, 'B', 'kom.boss-nob')
    const boy = opOf(s, 'B', 'kom.boy')
    take(activateOp(bTurn(place(place(s, boss, 0, 0), boy, 4, 0)), boss), `ability:kom.a.get-it-dun:${boy}`)
  },
  breach() {
    const s = openReal()
    const wall = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: 0, z: -3 }, { x: 0.5, z: -3 }, { x: 0.5, z: 3 }, { x: 0, z: 3 }], height: 3, thickness: 0.5, traits: ['heavy' as const] }] }
    const b = opOf(s, 'B', 'kom.breacha-boy')
    const t = edit(place(s, b, -1.5, 0), (st) => {
      st.map = { ...st.map, features: [wall] }
    })
    take(activateOp(bTurn(t), b), 'ability:kom.a.breach:wall')
  },
  dakkaDash() {
    const s = openReal()
    const d = opOf(s, 'B', 'kom.dakka-boy')
    const t = take(activateOp(bTurn(place(place(s, d, 0, 0), opOf(s, 'A', 'aod.intercessor-warrior'), 7, 0)), d), 'ability:kom.a.dakka-dash').state
    take(t, 'shoot-first')
  },
  grapplingHook() {
    const s = openReal()
    const g = opOf(s, 'B', 'kom.grot')
    const tower = { id: 'tower', parts: [{ id: 'tower.0', footprint: [{ x: 2, z: -2 }, { x: 5, z: -2 }, { x: 5, z: 2 }, { x: 2, z: 2 }], height: 3, traits: ['vantage' as const] }] }
    const t = edit(place(s, g, -0.5, 0), (st) => {
      st.map = { ...st.map, features: [tower] }
    })
    let u = take(activateOp(bTurn(t), g, 'conceal'), 'ability:kom.a.grappling-hook').state
    u = take(u, u.pending!.options![0]!.id).state
    expect(u.pending!.kind).toBe('firefight.action')
  },
}

// Each team owns its firing scenarios in tests/engine/teams/<team>.hooks.ts (export `scenarios`), so adding a
// team's hooks never edits this shared file. A name defined twice is a mistake and fails the coverage check.
const TEAM_SCENARIOS = import.meta.glob<{ scenarios: Record<string, () => void> }>('./teams/*.hooks.ts', { eager: true })
const duplicateScenarios: string[] = []
for (const [file, mod] of Object.entries(TEAM_SCENARIOS)) {
  for (const [name, run] of Object.entries(mod.scenarios)) {
    if (name in scenarios) duplicateScenarios.push(`${file}: ${name}`)
    scenarios[name] = run
  }
}

/** A lone operative on an objective in turning point 2 performs the mission action. */
function missionAction(missionId: string, abilityId: string): void {
  let s = edit(openReal({ missionId }), (st) => {
    st.turningPoint = 2
  })
  const w = opOf(s, 'A', 'aod.intercessor-warrior')
  const m = s.markers.find((k) => k.kind === 'objective')!
  s = place(s, w, m.pos.x + 2, m.pos.z)
  const t = activateOp(s, w)
  const id = t.pending!.options!.find((o) => o.id.startsWith(`ability:${abilityId}`))!.id
  take(t, id)
}

describe('code hooks', () => {
  it('every hook named in the data is registered, and every registered hook is named in the data', () => {
    expect(registeredCodeHooks()).toEqual([...names].sort())
    for (const n of names) expect(getCodeHook(n), n).toBeDefined()
    // the registry matches what the records actually carry
    const used = new Set<string>()
    for (const a of Object.values(realBundle.abilities)) for (const c of a.codes ?? []) used.add(c)
    for (const p of Object.values(realBundle.ploys ?? {})) JSON.stringify(p.effect).match(/"code":"([A-Za-z]+)"/g)?.forEach((m) => used.add(m.slice(8, -1)))
    for (const e of Object.values(realBundle.equipment ?? {})) JSON.stringify(e.effect ?? {}).match(/"code":"([A-Za-z]+)"/g)?.forEach((m) => used.add(m.slice(8, -1)))
    for (const n of used) expect(names, n).toContain(n)
    void loadBundle
  })

  describe('each hook fires in a real game', () => {
    beforeAll(() => {
      const failures: string[] = []
      for (const [name, run] of Object.entries(scenarios)) {
        try {
          run()
        } catch (e) {
          failures.push(`${name}: ${(e as Error).message}`)
        }
      }
      expect(failures).toEqual([])
      // every team's scenarios run here: give a loaded machine (full suite in parallel) room
    }, 120_000)
    it.each(names)('%s', (name) => {
      expect(hookFireCount(name), `${name} never fired`).toBeGreaterThan(0)
    })
    it('the scenarios cover every hook', () => {
      expect(duplicateScenarios).toEqual([])
      expect(Object.keys(scenarios).sort()).toEqual([...names].sort())
      void hasOption
      void passIt
    })
  })
})
