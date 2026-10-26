// Batch C shared integration (docs/spec/12-rules-test-checklist.md GEN-086 onwards, SIM-010): the windows, providers
// and helpers the batch C teams asked for. Throwaway providers, hooks and ploys are removed after each test.
import { afterEach, describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { isFixedDie, parseRules, registerFixedDieTag, retainAttack, validTargets } from '@/engine/attack-common'
import { registerCodeHook } from '@/engine/code-hooks'
import { commsBonus } from '@/engine/core-hooks'
import { placeItem } from '@/engine/equipment'
import { canStartFreeAction, raiseAction, reactionDone, startFreeAction } from '@/engine/firefight'
import { registerFrameResume, registerHook, unregisterHook, type AttackHookName, type HookName } from '@/engine/hooks'
import { bodyOf, visible } from '@/engine/los'
import { markerOffers, updateControl } from '@/engine/markers'
import { applyForcedMove, planMove } from '@/engine/movement'
import { pickLabel } from '@/engine/operative-picks'
import { ScriptedRng } from '@/engine/rng'
import { aplWithCeiling, effectiveApl } from '@/engine/state'
import { beginTurningPoint, readyChoiceDone } from '@/engine/strategy'
import { registerTeamRules, unregisterTeamRules, type MoveSurchargeBreakdown, type TeamRuleProvider } from '@/engine/team-rules'
import type { DiceSide, GameState, Operative } from '@/engine/types'
import { loadBundle } from '../../src/data'
import { bundleFromData, playableTeams } from '@/engine/bundle'
import { realSetupFor } from '../../tools/sim-core'
import { evs } from '../fixtures/attack'
import { defaultAnswer, expectOk, place } from '../fixtures/helpers'
import { feature, part, rect } from '../fixtures/maps'
import { activateOp, edit, openReal, opOf, passIt, take, withCtx } from '../fixtures/real'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function provide(p: Omit<TeamRuleProvider, 'id'>): void {
  registerTeamRules({ id: 'test.provider-d', ...p })
  cleanups.push(() => unregisterTeamRules('test.provider-d'))
}
function hook(name: HookName | AttackHookName, fn: Parameters<typeof registerHook>[1]): void {
  registerHook(name, fn, `test-d.${name}`)
  cleanups.push(() => unregisterHook(name, `test-d.${name}`))
}
/** Open map, A to activate: A's Intercessor Warrior and Captain, B's Boy and Grot. */
function open(): { s: GameState; w: string; cap: string; boy: string; grot: string } {
  const s = openReal()
  return { s, w: opOf(s, 'A', 'aod.intercessor-warrior'), cap: opOf(s, 'A', 'aod.space-marine-captain'), boy: opOf(s, 'B', 'kom.boy'), grot: opOf(s, 'B', 'kom.grot') }
}
function withPloy(s: GameState, ploy: Record<string, unknown>): GameState {
  return edit(s, (x) => {
    x.data.ploys = { ...(x.data.ploys ?? {}), [ploy.id as string]: ploy as never }
  })
}
const ploy = (id: string, team: string, window: string | string[]) => ({ id, name: id, team, type: 'firefight', cost: 0, window, effect: { cp: 1 }, text: 't', source: 's' })

/** Drive a Shoot of `w` at `boy` with dice all `die`, answering defaults, until `stop` holds; ploy windows seen. */
function shootUntil(s0: GameState, w: string, boy: string, stop: (s: GameState) => boolean, die = 4) {
  let st = take(activateOp(s0, w), 'shoot').state
  const rng = new ScriptedRng(Array(80).fill(die))
  const seen: string[] = []
  for (let i = 0; i < 40 && st.pending && st.pending.kind !== 'firefight.action' && !stop(st); i++) {
    const p = st.pending
    if (p.kind === 'ploy.firefight') seen.push(`${p.seat}:${p.window}:${p.options!.map((o) => o.id).join(',')}`)
    let a = defaultAnswer(st)
    if (p.kind === 'shoot.target') a = p.options!.find((o) => o.id === boy)?.action ?? a
    st = expectOk(step(st, a, rng)).state
  }
  return { st, seen }
}

function facing(s: GameState, w: string, boy: string): GameState {
  return edit(s, (x) => {
    x.operatives[w]!.pos = { x: 0, y: 0, z: -4 }
    x.operatives[boy]!.pos = { x: 0, y: 0, z: 4 }
  })
}

describe('GEN batch C shared integration', () => {
  it('GEN-087 the defender gets shoot.defenderAttackRolled on the fresh attack roll, after the attacker and before re-rolls', () => {
    const { s, w, boy } = open()
    let st = withPloy(withPloy(s, ploy('test.p.mine', 'angels-of-death', 'shoot.defenderAttackRolled')), ploy('test.p.fate', 'kommandos', 'shoot.defenderAttackRolled'))
    st = withPloy(st, ploy('test.p.engage', 'angels-of-death', 'shoot.beforeAttackRerolls'))
    const { seen } = shootUntil(facing(st, w, boy), w, boy, () => false)
    const windows = seen.map((x) => x.split(':').slice(0, 2).join(':'))
    expect(seen.filter((x) => x.includes('defenderAttackRolled'))).toEqual(['B:shoot.defenderAttackRolled:test.p.fate'])
    expect(windows.indexOf('A:shoot.beforeAttackRerolls')).toBeLessThan(windows.indexOf('B:shoot.defenderAttackRolled'))
  })

  it('GEN-088 a commandRerollCost provider makes the Command Re-roll free: offered at 0 CP, no CP spent, onCommandReroll told', () => {
    const { s, w, boy } = open()
    const told: number[] = []
    provide({ commandRerollCost: (_st, side) => (side.seat === 'A' ? 0 : null), onCommandReroll: (_ctx, _side, cost) => void told.push(cost) })
    const broke = edit(facing(s, w, boy), (x) => void (x.players.A.cp = 0))
    const { st } = shootUntil(broke, w, boy, (t) => t.pending?.kind === 'dice.commandReroll' && t.pending.seat === 'A', 1)
    expect(st.pending).toMatchObject({ kind: 'dice.commandReroll', seat: 'A' })
    expect(st.pending!.options![0]!.data).toMatchObject({ cost: 0 })
    const r = expectOk(step(st, st.pending!.options![0]!.action, new ScriptedRng(Array(60).fill(6))))
    expect(r.state.players.A.cp).toBe(0)
    expect(evs(r.events, 'CpChanged')).toEqual([])
    expect(told).toEqual([0])
    // without the provider a seat with no CP is not offered it
    unregisterTeamRules('test.provider-d')
    const none = shootUntil(broke, w, boy, (t) => t.pending?.kind === 'dice.commandReroll' && t.pending.seat === 'A', 1).st
    expect(none.pending?.kind === 'dice.commandReroll' && none.pending.seat === 'A').toBe(false)
  })

  it('GEN-089 after an action the active seat reacts first (ownReactions), then the other seat; `repeat` offers come again for operatives that have not reacted; a pass ends the seat', () => {
    const { s, w, boy, grot } = open()
    const log: string[] = []
    registerCodeHook({ name: 'test-d.react', choice: (ctx, op) => (log.push(op.id), reactionDone(ctx)) })
    provide({
      ownReactions: (_st, seat, info) => (seat === 'A' && info.action === 'guard' ? [{ hook: 'test-d.react', operativeId: w, option: 'x', labelKey: 'own' }] : []),
      reactions: (_st, seat, info) =>
        seat === 'B' && info.action === 'guard'
          ? [boy, grot].map((id) => ({ hook: 'test-d.react', operativeId: id, option: 'x', labelKey: 'hound', repeat: true }))
          : [],
    })
    const t = take(activateOp(s, w), 'guard').state
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    const b1 = take(t, 'react:0').state
    expect(b1.pending).toMatchObject({ kind: 'ability.choice', seat: 'B' })
    expect(b1.pending!.options!.map((o) => o.data?.operativeId)).toEqual([boy, grot])
    const b2 = take(b1, 'react:0').state
    // the second Hound answers the same action
    expect(b2.pending!.options!.map((o) => o.data?.operativeId)).toEqual([grot])
    const done = take(b2, 'react:0').state
    expect(log).toEqual([w, boy, grot])
    expect(done.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
    // a pass ends that seat's turn to react
    expect(passIt(b1).state.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
  })

  it('GEN-090 Fall Back opens firefight.actionDeclared, and firefight.fallBackMoved between its move and the end of the action', () => {
    const { s, w, boy } = open()
    const st = place(place(withPloy(s, ploy('test.p.retreat', 'angels-of-death', ['firefight.actionDeclared', 'firefight.fallBackMoved'])), w, 0, 0), boy, 1.9, 0)
    const decl = take(activateOp(st, w), 'fallBack').state
    expect(decl.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.actionDeclared' })
    let u = passIt(decl).state
    while (u.pending?.kind === 'ploy.firefight') u = passIt(u).state
    expect(u.pending?.kind).toBe('move.path')
    const moved = expectOk(step(u, act.path(u.pending!, [{ x: -4, z: 0 }])))
    expect(moved.state.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.fallBackMoved' })
    expect(evs(moved.events, 'ActionResolved')).toEqual([])
    const end = passIt(moved.state)
    expect(evs(end.events, 'ActionResolved').map((e) => e.action)).toEqual(['fallBack'])
  })

  it('GEN-091 placeMarkerProblem filters Place Marker spots (listed on the decision) and refuses others; checkMines sees moves outside actions', () => {
    const { s, w, boy } = open()
    const carried = edit(place(s, w, 0, 0), (x) => {
      x.markers.push({ id: 'p1', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'A', carriedBy: w, controller: null, pickable: true, equipmentId: 'test.pickable' })
      x.operatives[w]!.flags.carrying = 'p1'
    })
    provide({ placeMarkerProblem: (_st, _op, _m, pos) => (pos.x < -0.01 ? 'not behind the operative' : null) })
    const t = take(activateOp(carried, w), 'marker:place:p1').state
    const spots = t.pending!.context.spots as { x: number; z: number }[]
    expect(t.pending!.kind).toBe('marker.place')
    expect(spots.length).toBeGreaterThan(0)
    expect(spots.every((p) => p.x >= -0.01)).toBe(true)
    const p = t.pending!
    const bad = step(t, { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: { x: -0.9, z: 0 } })
    expect(bad.rejection).toMatchObject({ code: 'E_ACTION_RESTRICTED', reason: 'not behind the operative' })
    const ok = expectOk(step(t, { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: spots[0]! }))
    expect(evs(ok.events, 'MarkerPlaced').map((e) => e.markerId)).toEqual(['p1'])
    // nowhere legal: Place Marker is not offered
    unregisterTeamRules('test.provider-d')
    provide({ placeMarkerProblem: () => 'never' })
    expect(markerOffers(carried, carried.operatives[w]!, null).map((o) => o.action)).not.toContain('marker:place')
    unregisterTeamRules('test.provider-d')
    // team mines: a forced move outside any action reaches checkMines with its increment points
    const seen: string[] = []
    provide({ checkMines: (_ctx, moved) => void seen.push(...moved.filter((m) => m.operativeId === boy).map((m) => `${m.pos.x},${m.pos.z}`)) })
    withCtx(place(s, boy, 4, 4), (ctx) => {
      applyForcedMove(ctx, boy, [{ x: 6, z: 4 }], 3)
      updateControl(ctx)
    })
    expect(seen).toEqual(['6,4', '6,4'])
  })

  it('GEN-092 moveSurcharge sees each climb and the Obstructing share; moveProblem refuses a move with its own reason', () => {
    let s = openReal({ equipmentA: ['core.e.razor-wire'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const got: MoveSurchargeBreakdown[] = []
    provide({ moveSurcharge: (_st, _op, _k, _pts, b) => (got.push(b), 0) })
    const tower = feature('tw', part('tw.0', rect(1, 4, -2, 2), 2, ['vantage']))
    const high = edit(place(s, w, 0, 0), (x) => void (x.map = { ...x.map, features: [tower] }))
    const climb = planMove(high, high.operatives[w]!, 'reposition', [{ x: 2.5, z: 0, y: 2 }])
    expect(climb.ok).toBe(true)
    expect(got.at(-1)).toMatchObject({ climb: 2, climbs: [2], obstructing: 0 })
    s = withCtx(place(s, w, -8, 0), (ctx) => placeItem(ctx, 'A', { key: 'A:core.e.razor-wire#1', equipmentId: 'core.e.razor-wire', kind: 'terrain' }, { x: -6, z: 0 }, 90)).state
    const wire = planMove(s, s.operatives[w]!, 'reposition', [{ x: -4, z: 0 }])
    expect(wire.ok).toBe(true)
    expect(got.at(-1)!.obstructing).toBe(1)
    expect(got.at(-1)!.accessible).toBeGreaterThanOrEqual(1)
    provide({ moveProblem: (_st, _op, _k, pts) => ((pts.at(-1)?.x ?? 0) > -5 ? 'must stay near the edge' : null) })
    const vetoed = planMove(s, s.operatives[w]!, 'reposition', [{ x: -4, z: 0 }])
    expect(!vetoed.ok && vetoed.rejection).toMatchObject({ code: 'E_ACTION_RESTRICTED', reason: 'must stay near the edge' })
  })

  it('GEN-093 a viewpoints provider gives an operative extra eyes for core visibility (and so control range)', () => {
    const { s, w, boy } = open()
    const wall = feature('wl', part('wl.0', rect(-0.2, 0.2, -3, 3), 5, ['heavy']))
    const st = edit(place(place(s, w, -3, 0), boy, 3, 0), (x) => void (x.map = { ...x.map, features: [wall] }))
    const see = () => visible(st, bodyOf(st.operatives[w]!), bodyOf(st.operatives[boy]!))
    expect(see()).toBe(false)
    provide({ viewpoints: (_st, op, body) => (op.id === w ? [{ ...body, pos: { ...body.pos, z: body.pos.z + 8 } }] : null) })
    expect(see()).toBe(true)
    // the boy has no extra eyes
    expect(visible(st, bodyOf(st.operatives[boy]!), bodyOf(st.operatives[w]!))).toBe(false)
  })

  it('GEN-094 target.status names the weapon; readyStepChoices asks each seat in the Ready step before the Gambit step', () => {
    const { s, w, boy } = open()
    const weapons: (string | undefined)[] = []
    hook('target.status', (c) => (weapons.push(c.weaponId), null))
    validTargets(facing(s, w, boy), s.operatives[w]!, 'aod.w.bolt-rifle')
    expect(weapons).toContain('aod.w.bolt-rifle')
    // Ready step
    const picked: string[] = []
    registerCodeHook({ name: 'test-d.ready', choice: (ctx, op) => (picked.push(op.id), readyChoiceDone(ctx)) })
    provide({ readyStepChoices: (_st, seat) => (seat === 'A' && picked.length === 0 ? [{ hook: 'test-d.ready', operativeId: w, option: 'x', labelKey: 'order' }] : []) })
    let st = withCtx(s, (ctx) => beginTurningPoint(ctx)).state
    for (let i = 0; i < 10 && st.pending && st.pending.kind !== 'ability.choice' && st.pending.kind !== 'strategy.gambit'; i++) st = expectOk(step(st, defaultAnswer(st), new ScriptedRng([4, 3, 4, 3]))).state
    expect(st.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { readyStep: true } })
    expect(Object.values(st.operatives).filter((o) => o.status === 'active').every((o) => o.ready)).toBe(true)
    const after = take(st, 'ready:0').state
    expect(picked).toEqual([w])
    expect(after.strategy.step).toBe('gambit')
  })

  it('GEN-095 aplCeiling, Severe skipping fixed dice, and pick display labels', () => {
    const { s, w } = open()
    const op = (apl: number, fx: { delta: number; ceiling?: number }[]): Operative => ({ ...s.operatives[w]!, apl, aplMods: fx.reduce((n, f) => n + f.delta, 0), aplFx: fx.map((f) => ({ ...f, source: 't' })) })
    expect(effectiveApl(op(2, [{ delta: 1, ceiling: 3 }]))).toBe(3)
    expect(effectiveApl(op(3, [{ delta: 1, ceiling: 3 }]))).toBe(3)
    expect(effectiveApl(op(3, [{ delta: -1 }, { delta: 1, ceiling: 3 }]))).toBe(3)
    // another, uncapped change still counts
    expect(effectiveApl(op(3, [{ delta: 1 }, { delta: 1, ceiling: 3 }]))).toBe(4)
    expect(aplWithCeiling(op(3, []), 1, 3)).toBe(3)
    // Severe never converts a die a rule fixed
    registerFixedDieTag('test.fixed')
    const side = { seat: 'A', operativeId: w, weaponId: null, need: 3, lethal: null, grants: [], commandUsed: false, phase: 'done', dice: [
      { value: 4, kind: 'normal', rerolled: false, tag: 'test.fixed' },
      { value: 3, kind: 'normal', rerolled: false },
    ] } as DiceSide
    retainAttack(side, parseRules([{ rule: 'core.wr.severe' }]), false)
    expect(side.dice.map((d) => d.kind)).toEqual(['normal', 'crit'])
    expect(isFixedDie(side.dice[0]!)).toBe(true)
    // labels
    expect(pickLabel({ labels: { 'ACCURATE PIERCING': 'Accurate 1 + Piercing 1' } }, 'ACCURATE PIERCING')).toBe('Accurate 1 + Piercing 1')
    expect(pickLabel({}, 'KHORNE')).toBe('KHORNE')
  })

  it('GEN-097 the Comms Device bonus goes to the operative controlling the marker, not to every friend', () => {
    const { s, w, cap } = open()
    const st = edit(place(place(s, w, 0, 0), cap, 8, 0), (x) => {
      x.markers.push({ id: 'cd', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'A', carriedBy: null, controller: null, pickable: false, equipmentId: 'core.e.comms-device' })
    })
    expect(commsBonus(st, 'A', st.operatives[w]!)).toBe(3)
    expect(commsBonus(st, 'A', st.operatives[cap]!)).toBe(0)
    expect(commsBonus(st, 'A')).toBe(3)
  })

  it('GEN-098 reactions after a free action in the actor\'s own activation reach only offers marked freeActions; freeShootInControlRange lets a free Shoot run in an enemy control range', () => {
    const { s, w, boy, grot } = open()
    registerFrameResume('test-d.free', (ctx) => raiseAction(ctx))
    registerCodeHook({ name: 'test-d.after', choice: (ctx) => reactionDone(ctx) })
    const infos: boolean[] = []
    provide({
      reactions: (_st, seat, info) => {
        if (seat !== 'B' || info.actorId !== w) return []
        infos.push(info.freeAction === true)
        return [
          { hook: 'test-d.after', operativeId: boy, option: 'x', labelKey: 'plain' },
          { hook: 'test-d.after', operativeId: grot, option: 'x', labelKey: 'free', freeActions: true },
        ]
      },
    })
    const at = activateOp(place(s, w, 0, 0), w)
    const framed = withCtx(at, (ctx) => void startFreeAction(ctx, { operativeId: w, action: 'dash', resume: 'test-d.free' })).state
    expect(framed.pending?.kind).toBe('move.path')
    const r = expectOk(step(framed, act.path(framed.pending!, [{ x: 2, z: 0 }])))
    expect(r.state.pending).toMatchObject({ kind: 'ability.choice', seat: 'B' })
    expect(r.state.pending!.options!.map((o) => o.data?.operativeId)).toEqual([grot])
    expect(infos).toContain(true)
    expect(take(r.state, 'react:0').state.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
    // free Shoot in an enemy control range
    unregisterTeamRules('test.provider-d')
    const engaged = edit(place(place(place(s, w, 0, 0), boy, 1.9, 0), grot, 0, 6), (x) => void (x.operatives[w]!.order = 'engage'))
    const free = { operativeId: w, action: 'shoot' as const, resume: 'test-d.free' }
    expect(canStartFreeAction(engaged, free)).toBe(false)
    provide({ shootInControlRange: (_st, o) => o.id === w, freeShootInControlRange: (_st, o) => o.id === w })
    expect(canStartFreeAction(engaged, free)).toBe(true)
  })

  it('SIM-010 --teams real rotates every playable team into at least floor(2 * games / teams) of 40 games, never against itself', () => {
    const bundle = bundleFromData(loadBundle())
    const setupFor = realSetupFor(bundle)
    const count = new Map<string, number>()
    for (let g = 0; g < 40; g++) {
      const setup = setupFor(g)
      for (const seat of ['A', 'B'] as const) {
        const team = setup.teams[seat]
        count.set(team, (count.get(team) ?? 0) + 1)
      }
      if (playableTeams(bundle).length > 1) expect(setup.teams.A).not.toBe(setup.teams.B)
    }
    const n = playableTeams(bundle).length
    // M10 batch D shared: scaled with the team count (24 teams: 3 each), the best any 40-game rotation can do
    expect(Math.min(...playableTeams(bundle).map((t) => count.get(t) ?? 0))).toBeGreaterThanOrEqual(Math.min(4, Math.floor((2 * 40) / n)))
  })
})
