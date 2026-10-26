import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { legalActions, step, validate } from '@/engine'
import { actionAvailability, counteractCandidates } from '@/engine/firefight'
import { effectiveApl, effectiveMove } from '@/engine/state'
import type { GameState } from '@/engine/types'
import { activate, apply, arena, declareMove, expectOk, newGame, patchOp, path, toFirefight } from '../fixtures/helpers'
import { feature, flatMap, mapWith, part, rect } from '../fixtures/maps'
import { makeSetup } from '../fixtures/team'

function endActivation(s: GameState): GameState {
  return apply(s, (p) => act.action(p, 'end')).state
}

/** A has 2 operatives and holds initiative, B has 3: after A1, B1, A2, B2 only B3 is ready and A is asked. */
function counteractSituation(orderA1: 'engage' | 'conceal', orderA2: 'engage' | 'conceal'): GameState {
  let s = toFirefight(makeSetup({ sizeA: 2, sizeB: 3 }), 'counter')
  s = endActivation(activate(s, 'A1', orderA1))
  s = endActivation(activate(s, 'B1', 'engage'))
  s = endActivation(activate(s, 'A2', orderA2))
  s = endActivation(activate(s, 'B2', 'engage'))
  return s
}

describe('ORD orders, activation and counteract', () => {
  it('ORD-001 activations alternate from the initiative player and an operative cannot activate twice', () => {
    let s = toFirefight()
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    s = endActivation(activate(s, 'A1'))
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'B' })
    s = endActivation(activate(s, 'B1'))
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(s.pending!.options!.some((o) => (o.action.payload as { operativeId: string }).operativeId === 'A1')).toBe(false)
    expect(step(s, act.activate(s.pending!, 'A1')).rejection?.code).toBe('E_NOT_AN_OPTION')
  })

  it('ORD-002 a Conceal operative cannot Shoot (without a Silent weapon) or Charge, but can Fight and Reposition', () => {
    const a = arena(flatMap(), { m: [0, 0], e: [1.5, 0] })
    const m = a.state.operatives[a.m]!
    const concealed = { ...m, order: 'conceal' as const }
    const st = { ...a.state, operatives: { ...a.state.operatives, [a.m]: concealed } }
    expect(actionAvailability(st, concealed, 'shoot', null)?.code).toBe('E_ACTION_RESTRICTED') // also in enemy CR
    expect(actionAvailability(st, concealed, 'fight', null)).toBeNull()
    // out of enemy CR: Charge is barred by the order, Reposition is fine
    const free = arena(flatMap(), { m: [0, 0], e: [6, 0] })
    const fm = { ...free.state.operatives[free.m]!, order: 'conceal' as const }
    expect(actionAvailability(free.state, fm, 'charge', null)?.code).toBe('E_ACTION_RESTRICTED')
    expect(actionAvailability(free.state, fm, 'reposition', null)).toBeNull()
    const engaged = { ...fm, order: 'engage' as const }
    expect(actionAvailability(free.state, engaged, 'charge', null)).toBeNull()
  })

  it('ORD-003 a Conceal operative cannot counteract; an Engage operative can', () => {
    const s = counteractSituation('engage', 'conceal')
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(counteractCandidates(s, 'A').map((o) => o.id)).toEqual(['A1'])
    const ids = s.pending!.options!.map((o) => o.id)
    expect(ids).toEqual(['counteract:A1'])
    expect(step(s, act.activate(s.pending!, 'A2', true)).rejection?.code).toBe('E_NOT_AN_OPTION')
  })

  it('ORD-004 AP spent never exceeds current APL and an APL cut caps the remaining AP', () => {
    const a = arena(flatMap(), { m: [0, 0] })
    let s = patchOp(a.state, a.m, { aplMods: -1 }) // APL 3 -> 2
    expect(effectiveApl(s.operatives[a.m]!)).toBe(2)
    s = activate(s, a.m)
    s = apply(s, (p) => act.action(p, 'reposition')).state
    s = expectOk(path(s, [{ x: 1, z: 0 }])).state
    s = apply(s, (p) => act.action(p, 'dash')).state
    s = expectOk(path(s, [{ x: 2, z: 0 }])).state
    // two AP spent with APL 2: the activation ends by itself
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'B' })
    // an APL cut in the middle of an activation limits the remaining AP
    const t = activate(arena(flatMap(), { m: [0, 0] }).state, a.m)
    const act2 = { ...t.firefight.activation!, apSpent: 2 }
    const op = patchOp(t, a.m, { aplMods: -1 }).operatives[a.m]!
    expect(actionAvailability(t, op, 'guard', act2)?.code).toBe('E_NO_AP')
    expect(effectiveApl(op)).toBe(2)
  })

  it('ORD-005 a second Reposition or a second Dash in the same activation is rejected', () => {
    const a = arena(flatMap(), { m: [0, 0] })
    let s = declareMove(a.state, a.m, 'reposition')
    s = expectOk(path(s, [{ x: 1, z: 0 }])).state
    expect(s.pending!.options!.some((o) => o.id === 'reposition')).toBe(false)
    expect(step(s, act.action(s.pending!, 'reposition')).rejection?.code).toBe('E_ACTION_RESTRICTED')
    s = apply(s, (p) => act.action(p, 'dash')).state
    s = expectOk(path(s, [{ x: 2, z: 0 }])).state
    expect(step(s, act.action(s.pending!, 'dash')).rejection?.code).toBe('E_ACTION_RESTRICTED')
  })

  it('ORD-006 an action that cannot be completed is cancelled: nothing changes and no AP is spent', () => {
    const a = arena(flatMap(), { m: [0, 0] })
    const s = declareMove(a.state, a.m, 'dash')
    expect(s.pending!.kind).toBe('move.path')
    const r = expectOk(step(s, act.pass(s.pending!)))
    expect(r.events.map((e) => e.type)).toContain('ActionCancelled')
    expect(r.state.firefight.activation).toMatchObject({ apSpent: 0, performed: [], declared: null })
    expect(r.state.operatives[a.m]!.pos).toEqual(s.operatives[a.m]!.pos)
    expect(r.pending!.options!.some((o) => o.id === 'dash')).toBe(true)
  })

  it('ORD-008 counteract is offered only when every friendly operative is expended and the opponent still has a ready one', () => {
    let s = toFirefight(makeSetup({ sizeA: 2, sizeB: 3 }), 'counter')
    s = endActivation(activate(s, 'A1', 'engage'))
    s = endActivation(activate(s, 'B1', 'engage'))
    expect(s.pending!.options!.every((o) => !o.id.startsWith('counteract'))).toBe(true) // A2 is still ready
    s = endActivation(activate(s, 'A2', 'engage'))
    s = endActivation(activate(s, 'B2', 'engage'))
    expect(s.pending!.options!.map((o) => o.id)).toEqual(['counteract:A1', 'counteract:A2'])
    // once the opponent has no ready operative left there is nothing to counteract
    const done = endActivation(activate(expectOk(step(s, act.pass(s.pending!))).state, 'B3', 'engage'))
    expect(done.turningPoint).toBe(2)
  })

  it('ORD-009 a counteraction is a 1 AP action, never Guard, once per operative per TP, for free', () => {
    let s = structuredClone(counteractSituation('engage', 'engage'))
    s.operatives['A1']!.pos = { x: 0, y: 0, z: 0 }
    s = apply(s, (p) => act.activate(p, 'A1', true)).state
    expect(s.firefight.activation).toMatchObject({ counteract: true, operativeId: 'A1' })
    const ids = s.pending!.options!.map((o) => o.id)
    expect(ids).toContain('reposition')
    expect(ids).toContain('dash')
    expect(ids).not.toContain('guard')
    expect(ids).not.toContain('fallBack') // 2 AP
    s = apply(s, (p) => act.action(p, 'reposition')).state
    s = expectOk(path(s, [{ x: s.operatives['A1']!.pos.x + 1, z: s.operatives['A1']!.pos.z, y: 0 }])).state
    expect(s.operatives['A1']!.flags.counteractedThisTP).toBe(true)
    expect(s.firefight.activation).toBeNull()
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'B' }) // activation returns to the opponent
    expect(counteractCandidates(s, 'A').map((o) => o.id)).toEqual(['A2'])
  })

  it('ORD-010 a counteraction cannot move more than 2", counting Accessible terrain', () => {
    const gate = feature(
      'gate',
      part('gate.l', rect(-2, -0.5, -5.25, -4.75), 3, ['heavy']),
      part('gate.r', rect(0.5, 2, -5.25, -4.75), 3, ['heavy']),
      part('gate.door', rect(-0.5, 0.5, -5.25, -4.75), 3, ['heavy', 'accessible']),
    )
    const base = counteractSituation('engage', 'engage')
    const put = (x: number, z: number): GameState => {
      const s = structuredClone(base)
      s.operatives['A1']!.pos = { x, y: 0, z }
      return s
    }
    let s = apply(put(0, 0), (p) => act.activate(p, 'A1', true)).state
    s = apply(s, (p) => act.action(p, 'reposition')).state
    expect(s.pending!.constraints!.maxInches).toBe(2)
    expect(validate(s, act.path(s.pending!, [{ x: 2, z: 0 }]))).toBeNull()
    expect(validate(s, act.path(s.pending!, [{ x: 2.1, z: 0 }]))?.code).toBe('E_OUT_OF_RANGE')
    // with the gate on the map, 2" through the door costs 3 and is refused
    const gated = structuredClone(base)
    gated.map = mapWith(gate)
    gated.operatives['A1']!.pos = { x: 0, y: 0, z: -4 }
    let g = apply(gated, (p) => act.activate(p, 'A1', true)).state
    g = apply(g, (p) => act.action(p, 'reposition')).state
    expect(validate(g, act.path(g.pending!, [{ x: 0, z: -6 }]))?.code).toBe('E_OUT_OF_RANGE')
    expect(validate(g, act.path(g.pending!, [{ x: 0, z: -4.1 }]))).toBeNull()
  })

  it('ORD-011 a player with no ready operative may skip; activation returns to the opponent and the phase ends when neither has one', () => {
    let s = counteractSituation('engage', 'engage')
    expect(s.pending!.canPass).toBe(true)
    s = expectOk(step(s, act.pass(s.pending!))).state
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'B' })
    expect(legalActions(s)!.map((a) => (a.payload as { operativeId?: string }).operativeId)).toEqual(['B3'])
    s = endActivation(activate(s, 'B3'))
    expect(s.turningPoint).toBe(2)
    expect(s.phase).toBe('strategy')
  })

  it('ORD-013 APL modifiers net out within one of printed APL and Move never drops below 4"', () => {
    const s = newGame().state
    const op = s.operatives['A1']!
    expect(effectiveApl({ ...op, aplMods: 5 })).toBe(op.apl + 1)
    expect(effectiveApl({ ...op, aplMods: -5 })).toBe(op.apl - 1)
    expect(effectiveApl({ ...op, aplMods: 1 - 1 + 1 - 1 })).toBe(op.apl)
    expect(effectiveMove({ ...op, wounds: 4 })).toBe(4) // injured: 6 - 2
    expect(effectiveMove({ ...op, move: 5, wounds: 4 })).toBe(4) // floor of 4
    expect(effectiveMove({ ...op, wounds: 5 })).toBe(6) // 5 of 10 is not injured
  })
})
