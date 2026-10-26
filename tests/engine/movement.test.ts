import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { step, validate } from '@/engine'
import { actionAvailability } from '@/engine/firefight'
import type { Waypoint } from '@/engine/types'
import { activate, apply, arena, declareMove, expectOk, moved, path } from '../fixtures/helpers'
import { feature, flatMap, mapWith, part, rect } from '../fixtures/maps'

const wp = (x: number, z: number, y?: number): Waypoint => (y === undefined ? { x, z } : { x, z, y })
const code = (r: { rejection?: { code: string } }) => r.rejection?.code

describe('MOVE movement and control range', () => {
  it('MOVE-001 Reposition costs the sum of increments each rounded up and must not exceed Move', () => {
    const a = arena(flatMap(), { m: [0, 0] })
    const s = declareMove(a.state, a.m, 'reposition')
    const r = expectOk(path(s, [wp(0.5, 0), wp(3.25, 0)])) // 0.5" + 2.75" -> 1 + 3
    expect(moved(r).cost).toBe(4)
    expect(moved(r).segments.map((x) => x.cost)).toEqual([1, 3])
    // seven 0.8" increments are 5.6" of travel but cost 7" against Move 6"
    const seven = Array.from({ length: 7 }, (_, i) => wp(0.8 * (i + 1), 0))
    expect(code(path(s, seven))).toBe('E_OUT_OF_RANGE')
    expect(code(path(s, [wp(6, 0)]))).toBeUndefined()
    expect(code(path(s, [wp(6.01, 0)]))).toBe('E_OUT_OF_RANGE')
    // a full-length step that lands a hair past 6" from 1/1000" rounding is still a 6" move
    expect(code(path(s, [wp(4.2431, 4.2429)]))).toBeUndefined()
    expect(moved(expectOk(path(s, [wp(6.004, 0)]))).cost).toBe(6)
  })

  it('MOVE-002 Reposition is rejected while in an enemy control range and after Fall Back or Charge', () => {
    const a = arena(flatMap(), { m: [0, 0], e: [1.5, 0] })
    let s = activate(a.state, a.m)
    expect(code(step(s, act.action(s.pending!, 'reposition')))).toBe('E_ACTION_RESTRICTED')
    // Fall Back out of the control range, then Reposition is barred for the rest of the activation
    s = apply(s, (p) => act.action(p, 'fallBack')).state
    s = expectOk(path(s, [wp(-3, 0)])).state
    expect(s.pending!.kind).toBe('firefight.action')
    expect(code(step(s, act.action(s.pending!, 'reposition')))).toBe('E_ACTION_RESTRICTED')
  })

  it('MOVE-003 Reposition may pass through an enemy control range only if a friendly operative is in it, and may not end there', () => {
    const lone = arena(flatMap(), { m: [-3, 1.3], e: [0, 0] })
    let s = declareMove(lone.state, lone.m, 'reposition')
    expect(code(path(s, [wp(3, 1.3)]))).toBe('E_CONTROL_RANGE')
    const backed = arena(flatMap(), { m: [-3, 1.3], f: [0, -1.3], e: [0, 0] })
    s = declareMove(backed.state, backed.m, 'reposition')
    const ok = expectOk(path(s, [wp(3, 1.3)]))
    expect(moved(ok).cost).toBe(6)
    expect(code(path(s, [wp(0.4, 1.3)]))).toBe('E_CONTROL_RANGE') // ends in the enemy control range
  })

  it('MOVE-004 Dash moves at most 3", cannot climb, may drop, and is rejected after Charge', () => {
    const a = arena(flatMap(), { m: [0, 0] })
    const s = declareMove(a.state, a.m, 'dash')
    expect(code(path(s, [wp(3, 0)]))).toBeUndefined()
    expect(code(path(s, [wp(3.2, 0)]))).toBe('E_OUT_OF_RANGE')
    // climbing: allowed for Reposition, refused for Dash
    const hill = mapWith(feature('hill', part('hill.a', rect(2, 5, -2, 2), 1, ['vantage'])))
    const h = arena(hill, { m: [0, 0] })
    const d = declareMove(h.state, h.m, 'dash')
    expect(code(path(d, [wp(3, 0, 1)]))).toBe('E_NO_PATH')
    const rp = declareMove(h.state, h.m, 'reposition')
    expect(code(path(rp, [wp(3, 0, 1)]))).toBeUndefined()
    // dropping off a 2" platform is free and allowed
    const roof = mapWith(feature('roof', part('roof.a', rect(2, 6, -2, 2), 2, ['vantage'])))
    const r = arena(roof, { m: [4.5, 0, 2] })
    const rd = declareMove(r.state, r.m, 'dash')
    expect(moved(expectOk(path(rd, [wp(7.5, 0, 0)]))).cost).toBe(3)
    // Dash is barred after a Charge
    const c = arena(flatMap(), { m: [0, 0], e: [6, 0] })
    let s2 = declareMove(c.state, c.m, 'charge')
    s2 = expectOk(path(s2, [wp(4.7, 0)])).state
    expect(s2.pending!.options!.some((o) => o.id === 'dash')).toBe(false)
    const op = s2.operatives[c.m]!
    expect(actionAvailability(s2, op, 'dash', s2.firefight.activation)).toMatchObject({ code: 'E_ACTION_RESTRICTED' })
  })

  it('MOVE-005 Fall Back needs an enemy in control range at the start and must end outside every enemy control range', () => {
    const calm = arena(flatMap(), { m: [0, 0], e: [6, 0] })
    const s0 = activate(calm.state, calm.m)
    expect(code(step(s0, act.action(s0.pending!, 'fallBack')))).toBe('E_ACTION_RESTRICTED')
    const a = arena(flatMap(), { m: [0, 0], e: [1.5, 0] })
    const s = declareMove(a.state, a.m, 'fallBack')
    expect(code(path(s, [wp(-0.3, 0)]))).toBe('E_CONTROL_RANGE')
    const ok = expectOk(path(s, [wp(-3, 0)]))
    expect(ok.state.firefight.activation!.apSpent).toBe(2)
  })

  it('MOVE-006 Charge moves up to Move + 2" and must end in an enemy control range; not with Conceal, in a control range, or after Reposition', () => {
    const a = arena(flatMap(), { m: [0, 0], e: [9.3, 0] })
    const s = declareMove(a.state, a.m, 'charge')
    expect(s.pending!.constraints!.maxInches).toBe(8)
    expect(code(path(s, [wp(7, 0)]))).toBe('E_CONTROL_RANGE') // ends outside any control range
    expect(code(path(s, [wp(8, 0)]))).toBeUndefined() // 1.3" from the enemy centre, exactly 8" travelled
    const far = arena(flatMap(), { m: [0, 0], e: [10.5, 0] })
    const fs = declareMove(far.state, far.m, 'charge')
    expect(code(path(fs, [wp(9.2, 0)]))).toBe('E_OUT_OF_RANGE')
    // restrictions
    const conceal = activate(a.state, a.m, 'conceal')
    expect(code(step(conceal, act.action(conceal.pending!, 'charge')))).toBe('E_ACTION_RESTRICTED')
    const inCr = arena(flatMap(), { m: [0, 0], e: [1.5, 0] })
    const ic = activate(inCr.state, inCr.m)
    expect(code(step(ic, act.action(ic.pending!, 'charge')))).toBe('E_ACTION_RESTRICTED')
    let rp = declareMove(a.state, a.m, 'reposition')
    rp = expectOk(path(rp, [wp(1, 0)])).state
    expect(code(step(rp, act.action(rp.pending!, 'charge')))).toBe('E_ACTION_RESTRICTED')
  })

  it('MOVE-007 a Charge that enters the control range of a lone enemy cannot leave it later in the same move', () => {
    const lone = arena(flatMap(), { m: [-3, 1.3], e: [0, 0], e2: [0, 4.9] })
    const s = declareMove(lone.state, lone.m, 'charge')
    expect(code(path(s, [wp(0, 1.3), wp(0, 3.6)]))).toBe('E_CONTROL_RANGE')
    // a friend already in the first enemy's control range means that enemy is not lone
    const backed = arena(flatMap(), { m: [-3, 1.3], f: [0, -1.3], e: [0, 0], e2: [0, 4.9] })
    const b = declareMove(backed.state, backed.m, 'charge')
    const ok = path(b, [wp(0, 1.3), wp(0, 3.6)])
    expect(code(ok)).toBeUndefined()
    expect(moved(ok).cost).toBe(6)
  })
})

describe('TERR movement over terrain', () => {
  it('TERR-007 moving through Accessible terrain costs +1" and only the centre of the base needs to pass', () => {
    const gate = feature(
      'gate',
      part('gate.l', rect(-2, -0.5, -5.25, -4.75), 3, ['heavy']),
      part('gate.r', rect(0.5, 2, -5.25, -4.75), 3, ['heavy']),
      part('gate.door', rect(-0.5, 0.5, -5.25, -4.75), 3, ['heavy', 'accessible']),
    )
    const a = arena(mapWith(gate), { m: [0, -3.5] })
    const s = declareMove(a.state, a.m, 'reposition')
    // a 32mm base is wider than the 1" door, yet the centre line passes
    const through = path(s, [wp(0, -6.5)])
    expect(moved(through).cost).toBe(4) // 3" + 1" Accessible
    expect(code(path(s, [wp(1.2, -3.5), wp(1.2, -6.5)]))).toBe('E_OVERLAP') // through the wall instead
    // the base touches the doorway but its centre crosses the wall beside it
    expect(code(path(s, [wp(0.75, -3.5), wp(0.75, -6.5)]))).toBe('E_OVERLAP')
  })

  it('TERR-008 Insignificant terrain does not count as a climb or a drop', () => {
    const step1 = mapWith(feature('rail', part('rail.a', rect(2, 5, -2, 2), 1, ['vantage', 'insignificant', 'exposed'])))
    const a = arena(step1, { m: [0, 0] })
    const s = declareMove(a.state, a.m, 'reposition')
    expect(moved(expectOk(path(s, [wp(3, 0, 1)]))).cost).toBe(3) // no climb surcharge
  })

  it('TERR-011 each climb costs at least 2", climbing reaches at most 3" and a move cannot end on non-Vantage terrain', () => {
    const map = mapWith(
      feature('low', part('low.a', rect(2, 5, -2, 2), 1, ['vantage'])),
      feature('mid', part('mid.a', rect(-5, -2, -2, 2), 3, ['vantage'])),
      feature('tall', part('tall.a', rect(-5, -2, 4, 8), 5, ['vantage'])),
      feature('crate', part('crate.a', rect(8, 9, -2, 2), 1, ['light'])),
    )
    const a = arena(map, { m: [0, 0] })
    const s = declareMove(a.state, a.m, 'reposition')
    expect(moved(path(s, [wp(3, 0, 1)])).cost).toBe(5) // 3" across + a 1" climb counted as 2"
    expect(moved(path(s, [wp(-3, 0, 3)])).cost).toBe(6) // 3" across + 3" climb
    const tall = arena(map, { m: [-3, 2.5] })
    expect(code(path(declareMove(tall.state, tall.m, 'reposition'), [wp(-3, 6, 5)]))).toBe('E_NO_PATH') // 5" is beyond the 3" reach
    // light crate: cannot finish a move on it (only Vantage can be set up on or finished on)
    const c = arena(map, { m: [7, 0] })
    const cs = declareMove(c.state, c.m, 'reposition')
    expect(code(path(cs, [wp(8.5, 0, 1)]))).toBe('E_NO_PATH')
    // but it can be climbed over: up, across and down to the floor (2" + 2" across, 2" climb)
    expect(moved(path(cs, [wp(8.5, 0, 1), wp(10, 0, 0)])).cost).toBe(6)
  })

  it('TERR-012 only the first 2" of drop per action is free in total, not per drop', () => {
    const map = mapWith(
      feature('stairs', part('stairs.a', rect(2, 4, -2, 2), 3, ['vantage']), part('stairs.b', rect(4, 6, -2, 2), 1.5, ['vantage'])),
      feature('wall', part('wall.a', rect(-6, -3, -2, 2), 3, ['vantage'])),
    )
    const a = arena(map, { m: [3, 0, 3] })
    const s = declareMove(a.state, a.m, 'reposition')
    // 3" -> 1.5" -> 0: horizontal 2 + 2, drops total 3", only 1" beyond the free 2"
    expect(moved(path(s, [wp(5, 0, 1.5), wp(7, 0, 0)])).cost).toBe(5)
    // a single 3" drop: 3" across... one drop of 3" costs 1"
    const b = arena(map, { m: [-4.5, 0, 3] })
    const t = declareMove(b.state, b.m, 'reposition')
    expect(moved(path(t, [wp(-2, 0, 0)])).cost).toBe(4) // 3" across (2.5 up) + 1" of drop
  })

  it('TERR-013 a jump from Vantage over 2" high covers up to 4" horizontally in one increment', () => {
    const map = mapWith(
      feature('a', part('a.a', rect(-13, -10.5, -2, 2), 3, ['vantage'])),
      feature('b', part('b.b', rect(-8, -5.5, -2, 2), 3, ['vantage'])),
      feature('c', part('c.c', rect(0, 3, -2, 2), 2, ['vantage'])),
    )
    const a = arena(map, { m: [-11.2, 0, 3] })
    const s = declareMove(a.state, a.m, 'reposition')
    const ok = path(s, [{ x: -7.3, z: 0, y: 3, jump: true }])
    expect(code(ok)).toBeUndefined()
    expect(moved(ok).cost).toBe(4)
    expect(moved(ok).segments[0]!.kind).toBe('jump')
    expect(code(path(s, [{ x: -6.5, z: 0, y: 3, jump: true }]))).toBe('E_OUT_OF_RANGE') // 4.7"
    // without the jump flag the gap cannot be crossed
    expect(code(path(s, [wp(-7.3, 0, 3)]))).toBe('E_NO_PATH')
    // a 2" platform is too low to jump from
    const low = arena(map, { m: [0.7, 0, 2] })
    const ls = declareMove(low.state, low.m, 'reposition')
    expect(code(path(ls, [{ x: 4, z: 0, y: 0, jump: true }]))).toBe('E_NO_PATH')
  })
})

describe('move.path validation never throws', () => {
  it('rejects malformed paths with E_SCHEMA', () => {
    const a = arena(flatMap(), { m: [0, 0] })
    const s = declareMove(a.state, a.m, 'reposition')
    for (const bad of [[], [{ x: 'a', z: 1 }], [{ x: NaN, z: 1 }], 'nope', null, [{ x: 0, z: 0 }]]) {
      const r = step(s, act.path(s.pending!, bad as never))
      expect(r.rejection).toBeDefined()
      expect(r.state).toBe(s)
    }
    expect(validate(s, act.path(s.pending!, [wp(1, 0)]))).toBeNull()
  })
})
