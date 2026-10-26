import { describe, expect, it } from 'vitest'
import { isWithin, whollyWithinRegion, bodyOf } from '@/engine/measure'
import { isVisible, markerControl, verdictFor } from '@/engine/query'
import { markerDiameterMm, markerRadius, cloneState } from '@/engine/state'
import type { GameState, Marker } from '@/engine/types'
import { arena, patchOp } from '../fixtures/helpers'
import { feature, flatMap, mapWith, part, rect } from '../fixtures/maps'

describe('TERR visibility, cover, obscured and Vantage', () => {
  it('TERR-002 a wall stops visibility but a target around it is visible; other operatives block too', () => {
    const wall = mapWith(feature('wall', part('wall.a', rect(-0.25, 0.25, -2, 2), 3, ['heavy', 'blocking'])))
    const behind = arena(wall, { m: [-4, 0], e: [4, 0] })
    expect(isVisible(behind.state, behind.m, behind.e)).toBe(false)
    const around = arena(wall, { m: [-4, 0], e: [4, 5] })
    expect(isVisible(around.state, around.m, around.e)).toBe(true)
    // an operative standing between the two blocks the line; with the rule off it does not
    const crowd = arena(flatMap(), { m: [-4, 0], f: [0, 0], e: [4, 0] })
    expect(isVisible(crowd.state, crowd.m, crowd.e)).toBe(false)
    const open = cloneState(crowd.state)
    open.rules.operativesBlockVisibility = false
    expect(isVisible(open, crowd.m, crowd.e)).toBe(true)
  })

  it('TERR-003 Barred terrain blocks visibility unless the viewer or target is within 1" of it', () => {
    const window = mapWith(feature('win', part('win.a', rect(-0.25, 0.25, -2, 2), 3, ['barred'])))
    const far = arena(window, { m: [-4, 0], e: [4, 0] })
    expect(isVisible(far.state, far.m, far.e)).toBe(false)
    const near = arena(window, { m: [-4, 0], e: [0.9, 0] }) // target 0.02" from the window plus base gap
    expect(isVisible(near.state, near.m, near.e)).toBe(true)
  })

  it('SHOOT-006 in cover needs intervening terrain within the target control range and the target more than 2" from the shooter', () => {
    const rubble = mapWith(feature('rubble', part('rubble.a', rect(-0.25, 0.25, -2, 2), 0.5, ['light'])))
    const close = arena(rubble, { m: [-4, 0], e: [1, 0] }) // rubble 0.12" from the target
    const v = verdictFor(close.state, close.m, close.e)
    expect(v.visible).toBe(true)
    expect(v.inCover).toBe(true)
    expect(v.obscured).toBe(false) // Light terrain never obscures (TERR-001)
    const distant = arena(rubble, { m: [-8, 0], e: [4, 0] }) // rubble 3" from the target: not in its control range
    expect(verdictFor(distant.state, distant.m, distant.e).inCover).toBe(false)
    // within 2" of the shooter there is never cover, even with terrain between
    const tight = arena(rubble, { m: [-1, 0], e: [1, 0] })
    const t = verdictFor(tight.state, tight.m, tight.e)
    expect(t.within2).toBe(true)
    expect(t.inCover).toBe(false)
    const edge = arena(rubble, { m: [-2.5, 0], e: [1, 0] }) // gap 2.24" > 2"
    expect(verdictFor(edge.state, edge.m, edge.e).inCover).toBe(true)
  })

  it('SHOOT-008 obscured needs intervening Heavy terrain; Heavy parts within 1" of either operative are ignored', () => {
    const lowWall = mapWith(feature('lw', part('lw.a', rect(-0.25, 0.25, -2, 2), 0.5, ['heavy'])))
    const far = arena(lowWall, { m: [-4, 0], e: [4, 0] })
    const f = verdictFor(far.state, far.m, far.e)
    expect(f.visible).toBe(true)
    expect(f.obscured).toBe(true)
    expect(f.inCover).toBe(false) // not within the target's control range
    const nearTarget = arena(lowWall, { m: [-4, 0], e: [0.9, 0] })
    const n = verdictFor(nearTarget.state, nearTarget.m, nearTarget.e)
    expect(n.obscured).toBe(false) // within 1" of the target: ignored
    expect(n.inCover).toBe(true)
    const nearShooter = arena(lowWall, { m: [-0.9, 0], e: [5, 0] })
    expect(verdictFor(nearShooter.state, nearShooter.m, nearShooter.e).obscured).toBe(false)
    const beyond = arena(lowWall, { m: [-2.5, 0], e: [4, 0] }) // 1.6" from the shooter's edge: still obscures
    expect(verdictFor(beyond.state, beyond.m, beyond.e).obscured).toBe(true)
  })

  it('SHOOT-010 one feature giving both cover and obscured forces a choice; separate features give both', () => {
    const one = mapWith(
      feature(
        'ruin',
        part('ruin.heavy', rect(-0.25, 0.25, -2, 2), 0.5, ['heavy']),
        part('ruin.light', rect(2.6, 3, -2, 2), 0.5, ['light']),
      ),
    )
    const a = arena(one, { m: [-6, 0], e: [4, 0] })
    const v = verdictFor(a.state, a.m, a.e)
    expect(v.inCover && v.obscured).toBe(true)
    expect(v.forcedChoice).toBe(true)
    expect(v.sharedFeatures).toEqual(['ruin'])
    expect(v.ifCover).toEqual({ inCover: true, obscured: false })
    expect(v.ifObscured).toEqual({ inCover: false, obscured: true })
    const two = mapWith(
      feature('wall', part('wall.heavy', rect(-0.25, 0.25, -2, 2), 0.5, ['heavy'])),
      feature('rubble', part('rubble.light', rect(2.6, 3, -2, 2), 0.5, ['light'])),
    )
    const b = arena(two, { m: [-6, 0], e: [4, 0] })
    const w = verdictFor(b.state, b.m, b.e)
    expect(w.forcedChoice).toBe(false)
    expect(w.inCover && w.obscured).toBe(true)
  })

  it('TERR-009 Exposed terrain is never intervening for cover or obscured', () => {
    const exposed = mapWith(feature('ex', part('ex.a', rect(-0.25, 0.25, -2, 2), 0.5, ['heavy', 'exposed'])))
    const a = arena(exposed, { m: [-4, 0], e: [0.9, 0] })
    const v = verdictFor(a.state, a.m, a.e)
    expect(v.visible).toBe(true)
    expect(v.inCover).toBe(false)
    expect(v.obscured).toBe(false)
  })

  it('TERR-004 a Vantage shooter gains Accurate 1 against an Engage target 2" lower and Accurate 2 at 4" lower', () => {
    const roof = (h: number) => mapWith(feature('roof', part('roof.a', rect(-8, -4, -2, 2), h, ['vantage'])))
    const engaged = (a: ReturnType<typeof arena>) => ({ ...a, state: patchOp(a.state, a.e, { order: 'engage' }) })
    const two = engaged(arena(roof(2), { m: [-6, 0, 2], e: [4, 0] }))
    const v2 = verdictFor(two.state, two.m, two.e)
    expect(v2.visible).toBe(true)
    expect(v2.vantage).toMatchObject({ shooterOnVantage: true, lowerBy: 2, accurate: 1 })
    const four = engaged(arena(roof(4), { m: [-6, 0, 4], e: [4, 0] }))
    expect(verdictFor(four.state, four.m, four.e).vantage.accurate).toBe(2)
    // Conceal targets do not give the bonus (R-11.5a is against Engage targets); they lose Light cover instead (R-11.5b)
    const hidden = patchOp(two.state, two.e, { order: 'conceal' })
    const hv = verdictFor(hidden, two.m, two.e)
    expect(hv.vantage.accurate).toBe(0)
    expect(hv.vantage.denyLightCover).toBe(true)
    // a shooter on the floor never has it
    const flat = engaged(arena(roof(2), { m: [0, 0], e: [4, 0] }))
    expect(verdictFor(flat.state, flat.m, flat.e).vantage.accurate).toBe(0)
  })

  it('TERR-006 Heavy terrain connected to the Vantage the shooter stands on is ignored for obscured', () => {
    const ruin = (traits: ('vantage' | 'heavy')[]) =>
      mapWith(
        feature(
          'ruin',
          part('ruin.floor', rect(-8, -4, -2, 2), 2, traits.includes('vantage') ? ['vantage'] : ['light']),
          part('ruin.parapet', rect(-3.5, -3, -2, 2), 2.4, ['heavy']),
        ),
      )
    const on = arena(ruin(['vantage']), { m: [-6, 0, 2], e: [5, 0] })
    expect(verdictFor(on.state, on.m, on.e).obscured).toBe(false)
    // the same parapet obscures a shooter on a roof that is not Vantage terrain
    const off = arena(ruin([]), { m: [-6, 0, 2], e: [5, 0] })
    expect(verdictFor(off.state, off.m, off.e).obscured).toBe(true)
  })
})

function withMarker(s: GameState, kind: Marker['kind'] = 'objective', carriedBy: string | null = null): GameState {
  const t = cloneState(s)
  t.markers = [{ id: 'mk', kind, pos: { x: 0, z: 0 }, owner: null, carriedBy, controller: null }]
  return t
}

describe('MARK markers, distances and control', () => {
  it('MARK-001 objective markers are 40mm across and other markers 20mm', () => {
    expect(markerDiameterMm('objective')).toBe(40)
    expect(markerDiameterMm('equipment')).toBe(20)
    expect(markerRadius({ kind: 'objective' })).toBeCloseTo(40 / 25.4 / 2, 6)
  })

  it('MARK-002 an operative contests a marker only if it is visible and within 1"', () => {
    const near = arena(flatMap(), { m: [1.5, 0] })
    expect(markerControl(withMarker(near.state), withMarker(near.state).markers[0]!).contesting.A).toEqual([near.m])
    const far = arena(flatMap(), { m: [2.5, 0] }) // base-edge gap 1.08"
    expect(markerControl(withMarker(far.state), withMarker(far.state).markers[0]!).contesting.A).toEqual([])
    const wall = mapWith(feature('w', part('w.a', rect(0.9, 1.1, -3, 3), 3, ['heavy'])))
    const hidden = arena(wall, { m: [1.5, 0] }) // within 1" but the wall blocks the view
    expect(markerControl(withMarker(hidden.state), withMarker(hidden.state).markers[0]!).contesting.A).toEqual([])
  })

  it('MARK-003 a side controls a marker only if its contesting APL is strictly greater; ties leave no controller', () => {
    const spec = { m: [1.5, 0], f: [-1.5, 0], e: [0, 1.5], e2: [0, -1.5] } as const
    const a = arena(flatMap(), { m: [...spec.m], f: [...spec.f], e: [...spec.e], e2: [...spec.e2] })
    const full = withMarker(a.state)
    const ctl = (s: GameState) => markerControl(s, s.markers[0]!)
    expect(ctl(full).apl).toEqual({ A: 6, B: 6 })
    expect(ctl(full).controller).toBeNull() // tie
    const lessB = withMarker(patchOp(a.state, a.e2, { pos: { x: 12, y: 0, z: 5 } }))
    expect(ctl(lessB).controller).toBe(a.me)
    const lessA = withMarker(patchOp(patchOp(a.state, a.f, { pos: { x: -12, y: 0, z: 5 } }), a.m, { pos: { x: 1.5, y: 0, z: 0 } }))
    expect(ctl(lessA).apl).toEqual({ A: 3, B: 6 })
    expect(ctl(lessA).controller).toBe(a.foe)
  })

  it('MARK-005 a carrier alone contests and controls its marker', () => {
    const a = arena(flatMap(), { m: [8, 8], e: [0, 1.5], e2: [0, -1.5] })
    const s = withMarker(a.state, 'equipment', a.m)
    const c = markerControl(s, s.markers[0]!)
    expect(c.controller).toBe(a.me)
    expect(c.contesting).toEqual({ A: [a.m], B: [] })
  })

  it('MARK-006 within uses any part of the base, wholly within the whole base; measured from base edges', () => {
    const a = arena(flatMap(), { m: [0, 0], e: [5, 0] })
    const m = bodyOf(a.state.operatives[a.m]!)
    const e = bodyOf(a.state.operatives[a.e]!)
    // centres are 5" apart, bases are 0.63" in radius: the gap is 3.74"
    expect(isWithin(m, e, 3.75)).toBe(true)
    expect(isWithin(m, e, 3.7)).toBe(false)
    const zone = mapWith().dropZones[0]!.polygon // z from -11 to -8
    const inside = bodyOf({ ...a.state.operatives[a.m]!, pos: { x: 0, y: 0, z: -9 } })
    const straddling = bodyOf({ ...a.state.operatives[a.m]!, pos: { x: 0, y: 0, z: -8.3 } })
    expect(whollyWithinRegion(inside, zone)).toBe(true)
    expect(whollyWithinRegion(straddling, zone)).toBe(false)
  })
})
