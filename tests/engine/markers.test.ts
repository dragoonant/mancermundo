import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { markerById, updateControl } from '@/engine/markers'
import { markerControl } from '@/engine/query'
import { createCtx } from '@/engine/registry'
import { SeededRng } from '@/engine/rng'
import { cloneState, markerDiameterMm, markerRadius } from '@/engine/state'
import { runHook } from '@/engine/hooks'
import type { GameState, Marker } from '@/engine/types'
import { activateOp, edit, hasOption, openReal, opOf, passIt, take } from '../fixtures/real'
import { place } from '../fixtures/helpers'

const openGame = () => openReal()

function centre(s: GameState): Marker {
  return s.markers.find((m) => m.kind === 'objective')!
}

function control(s: GameState, m: Marker) {
  return markerControl(s, m)
}

describe('MARK markers, contest and control', () => {
  it('MARK-001 objective markers are 40mm, every other marker 20mm', () => {
    expect(markerDiameterMm('objective')).toBe(40)
    expect(markerDiameterMm('equipment')).toBe(20)
    expect(markerRadius({ kind: 'objective' })).toBeCloseTo(0.787, 3)
    expect(markerRadius({ kind: 'equipment' })).toBeCloseTo(0.394, 3)
  })

  it('MARK-002 an operative contests a marker only when the marker is in its control range', () => {
    let s = openGame()
    const m = centre(s)
    const near = opOf(s, 'A', 'aod.intercessor-warrior')
    const far = opOf(s, 'B', 'kom.boss-nob')
    s = place(s, near, m.pos.x + 2, m.pos.z)
    s = place(s, far, m.pos.x + 4, m.pos.z)
    const c = control(s, m)
    expect(c.contesting.A).toEqual([near])
    expect(c.contesting.B).toEqual([])
  })

  it('MARK-003 control needs a strictly greater total APL; a tie leaves the marker uncontrolled', () => {
    let s = openGame()
    const m = centre(s)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior') // APL 3
    const boy = opOf(s, 'B', 'kom.boy') // APL 2
    const boss = opOf(s, 'B', 'kom.boss-nob') // APL 3
    s = place(s, marine, m.pos.x - 2, m.pos.z)
    s = place(s, boy, m.pos.x + 2, m.pos.z)
    expect(control(s, m).controller).toBe('A') // 3 against 2
    s = place(s, boss, m.pos.x, m.pos.z + 2)
    expect(control(s, m).apl).toEqual({ A: 3, B: 5 })
    expect(control(s, m).controller).toBe('B')
    s = edit(s, (st) => {
      st.operatives[boy]!.aplMods = -1 // APL 1 + 3 = 4 against 3 still B
    })
    expect(control(s, m).controller).toBe('B')
    s = edit(s, (st) => {
      st.operatives[boss]!.aplMods = -1 // B: 1 + 2 = 3, A: 3 -> tie
    })
    expect(control(s, m).controller).toBeNull()
  })

  it('MARK-004 control cannot change in the middle of an action; ControlChanged fires between actions', () => {
    let s = openGame()
    const m = centre(s)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(s, marine, m.pos.x + 2, m.pos.z)
    // the operative stands in range but a declared action is waiting for a path: nothing is re-evaluated
    const mid = edit(s, (st) => {
      st.firefight.activation = { operativeId: marine, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: { action: 'reposition', cost: 1 } }
    })
    const ctx = createCtx(cloneState(mid), SeededRng.fromSeed('x'), null, 0)
    updateControl(ctx)
    expect(ctx.events.filter((e) => e.type === 'ControlChanged')).toHaveLength(0)
    expect(markerById(ctx.state, m.id)!.controller).toBeNull()
    // between actions the control is evaluated and announced
    const ctx2 = createCtx(cloneState(s), SeededRng.fromSeed('x'), null, 0)
    updateControl(ctx2)
    expect(ctx2.events.filter((e) => e.type === 'ControlChanged')).toEqual([expect.objectContaining({ markerId: m.id, controller: 'A' })])
    expect(markerById(ctx2.state, m.id)!.controller).toBe('A')
  })

  it('MARK-004b a real move that ends next to the marker emits ControlChanged when the action finishes', () => {
    let s = openGame()
    const m = centre(s)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(s, marine, m.pos.x + 5, m.pos.z)
    s = activateOp(s, marine)
    s = take(s, 'reposition').state
    const p = s.pending!
    const res = step(s, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: m.pos.x + 2.2, z: m.pos.z }] } })
    expect(res.rejection).toBeUndefined()
    expect(res.events.some((e) => e.type === 'ControlChanged' && e.markerId === m.id && e.controller === 'A')).toBe(true)
  })

  it('MARK-005 a carrier alone contests and controls its marker', () => {
    let s = openGame()
    const m = centre(s)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const boss = opOf(s, 'B', 'kom.boss-nob')
    s = place(s, boss, m.pos.x + 2, m.pos.z)
    s = edit(s, (st) => {
      const mk = markerById(st, m.id)!
      mk.carriedBy = marine
      st.operatives[marine]!.flags.carrying = m.id
      st.operatives[marine]!.pos = { x: -8, y: 0, z: 0 }
    })
    const c = control(s, markerById(s, m.id)!)
    expect(c.contesting).toEqual({ A: [marine], B: [] })
    expect(c.controller).toBe('A')
  })
})

describe('MOVE-009 Pick Up Marker and Place Marker', () => {
  /** An open map with a pickable marker (no v1 mission names one) beside the Intercessor Warrior. */
  function withPickable(): { s: GameState; id: string; marker: string } {
    let s = openGame()
    const id = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(s, id, -3, 0)
    s = edit(s, (st) => {
      st.markers.push({ id: 'p1', kind: 'equipment', pos: { x: -1.5, z: 0 }, owner: null, carriedBy: null, controller: null, pickable: true, equipmentId: 'test.pickable' })
    })
    return { s, id, marker: 'p1' }
  }

  it('offers Pick Up for a pickable marker the operative controls and carries it afterwards', () => {
    const { s, id, marker } = withPickable()
    let t = activateOp(s, id)
    expect(hasOption(t, `marker:pickUp:${marker}`)).toBe(true)
    t = take(t, `marker:pickUp:${marker}`).state
    expect(t.operatives[id]!.flags.carrying).toBe(marker)
    expect(markerById(t, marker)!.carriedBy).toBe(id)
    expect(t.firefight.activation!.apSpent).toBe(1)
    // while carrying: no second Pick Up, Place Marker is offered, and not in the same activation as Pick Up
    expect(hasOption(t, `marker:pickUp:${marker}`)).toBe(false)
    expect(t.pending!.options!.some((o) => o.id.startsWith('marker:place'))).toBe(false)
  })

  it('Place Marker puts it within the control range and costs 1 AP; a farther spot is rejected', () => {
    const { s, id, marker } = withPickable()
    // the operative already carries it from an earlier activation
    let t = edit(s, (st) => {
      const mk = markerById(st, marker)!
      mk.carriedBy = id
      st.operatives[id]!.flags.carrying = marker
    })
    t = activateOp(t, id)
    expect(hasOption(t, `marker:place:${marker}`)).toBe(true)
    t = take(t, `marker:place:${marker}`).state
    expect(t.pending).toMatchObject({ kind: 'marker.place', canPass: true })
    const p = t.pending!
    expect(step(t, { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: { x: -3 + 4, z: 0 } }).rejection?.code).toBe('E_OUT_OF_RANGE')
    const ok = step(t, { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: { x: -2.2, z: 0 } })
    expect(ok.rejection).toBeUndefined()
    const placed = markerById(ok.state, marker)!
    expect(placed.carriedBy).toBeNull()
    expect(placed.pos).toEqual({ x: -2.2, z: 0 })
    expect(ok.state.operatives[id]!.flags.carrying).toBeNull()
    expect(ok.state.firefight.activation!.apSpent).toBe(1)
    expect(ok.events.some((e) => e.type === 'MarkerPlaced')).toBe(true)
    // passing the position decision cancels the action: no AP spent
    const cancelled = passIt(t)
    expect(cancelled.state.firefight.activation!.apSpent).toBe(0)
    expect(markerById(cancelled.state, marker)!.carriedBy).toBe(id)
  })

  it('Pick Up is not offered in an enemy control range', () => {
    const { s, id } = withPickable()
    const boy = opOf(s, 'B', 'kom.boy')
    const t = activateOp(place(s, boy, -4.4, 0), id)
    expect(t.pending!.options!.some((o) => o.id.startsWith('marker:pickUp'))).toBe(false)
  })

  it('an incapacitated carrier places the marker first, where it stands', () => {
    const { s, id, marker } = withPickable()
    const t = edit(s, (st) => {
      const mk = markerById(st, marker)!
      mk.carriedBy = id
      mk.pos = { x: 5, z: 5 }
      st.operatives[id]!.flags.carrying = marker
    })
    const ctx = createCtx(cloneState(t), SeededRng.fromSeed('x'), null, 0)
    runHook('operative.incapacitated', { seat: 'A', state: ctx.state, engine: ctx, operativeId: id })
    const mk = markerById(ctx.state, marker)!
    expect(mk.carriedBy).toBeNull()
    expect(mk.pos).toEqual({ x: ctx.state.operatives[id]!.pos.x, z: ctx.state.operatives[id]!.pos.z })
    expect(ctx.events.some((e) => e.type === 'MarkerPlaced')).toBe(true)
  })
})
