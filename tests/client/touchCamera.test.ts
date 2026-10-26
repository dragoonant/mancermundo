// Touch camera (one finger pans, two fingers pinch / twist / tilt) and the drawer helper behind the HUD panels.
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createTapGuard, TAP_SLOP, tiltFromDrag, twoFingerOffset } from '@/client/board/touchCamera'
import { useCollapse } from '@/client/ui/collapse'
import { OVERLAY_H, touchToolbar } from '@/client/ui/hudLayout'

const lim = { minDistance: 5, maxDistance: 58, minPolar: 0.07, maxPolar: Math.PI / 2.05 }

describe('touch camera', () => {
  it('a tap stays a tap: no pan, no suppressed click inside the slop', () => {
    const g = createTapGuard()
    g.down(1, 100, 100, true, true)
    g.move(1, 100 + TAP_SLOP - 1, 100)
    expect(g.inDeadzone()).toBe(true)
    g.up(1)
    expect(g.suppressClick()).toBe(false)
  })

  it('a drag past the slop pans and swallows the click that ends it; the next tap is clean', () => {
    const g = createTapGuard()
    g.down(1, 100, 100, true, true)
    g.move(1, 100, 100 + TAP_SLOP + 2)
    expect(g.inDeadzone()).toBe(false)
    g.up(1)
    expect(g.suppressClick()).toBe(true)
    g.down(2, 50, 50, true, true)
    g.up(2)
    expect(g.suppressClick()).toBe(false)
  })

  it('two-finger gestures, mouse pointers and taps on UI never reach the click filter', () => {
    const g = createTapGuard()
    g.down(1, 10, 10, true, true)
    g.down(2, 60, 10, true, true)
    g.up(2)
    g.up(1)
    expect(g.suppressClick()).toBe(true)
    g.down(3, 10, 10, false, true) // mouse
    g.move(3, 300, 300)
    g.up(3)
    expect(g.suppressClick()).toBe(false)
    g.down(4, 10, 10, true, false) // finger on a panel
    g.move(4, 300, 300)
    expect(g.suppressClick()).toBe(false)
  })

  it('pinch zooms by the spread ratio, twist turns about the vertical axis, tilt moves the polar angle, all clamped', () => {
    const off = new Vector3(0, 20, 20)
    const zoomed = twoFingerOffset(off, 0, 2, 0, lim)
    expect(zoomed.length()).toBeCloseTo(off.length() / 2, 5)
    expect(twoFingerOffset(off, 0, 1000, 0, lim).length()).toBeCloseTo(lim.minDistance, 5)
    const turned = twoFingerOffset(off, Math.PI / 2, 1, 0, lim)
    expect(turned.y).toBeCloseTo(off.y, 5)
    expect(Math.hypot(turned.x, turned.z)).toBeCloseTo(Math.hypot(off.x, off.z), 5)
    expect(Math.abs(turned.x)).toBeGreaterThan(19)
    const flatter = twoFingerOffset(off, 0, 1, 5, lim)
    expect(Math.atan2(Math.hypot(flatter.x, flatter.z), flatter.y)).toBeCloseTo(lim.maxPolar, 5)
    expect(tiltFromDrag(50, 500)).toBeLessThan(0) // dragging down raises the camera
  })

  it('HUD drawers: the sightlines and measure panels fold and unfold by id; the touch toolbar leaves the overlay corner', () => {
    const s = useCollapse.getState()
    for (const id of ['sightlines', 'measure']) {
      s.setCollapsed(id, false)
      s.toggle(id)
      expect(useCollapse.getState().collapsed[id]).toBe(true)
      s.toggle(id)
      expect(useCollapse.getState().collapsed[id]).toBe(false)
    }
    for (const compact of [true, false]) {
      const tb = touchToolbar(compact)
      expect(tb.below).toBeGreaterThan(tb.top + tb.height)
    }
    expect(OVERLAY_H).toBeGreaterThanOrEqual(120)
  })
})
