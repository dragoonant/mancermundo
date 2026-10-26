// Hearthkyn Salvagers rules-verification fixes (M9 batch B review), named by checklist id (docs/spec/12-rules-test-checklist.md).
import { describe, expect, it } from 'vitest'
import { validTargets } from '@/engine/attack-common'
import { bodyOf, inControlRange } from '@/engine/measure'
import { providerMoveSurcharge } from '@/engine/team-rules'
import type { GameState, Marker } from '@/engine/types'
import { place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, take } from '../../fixtures/real'
import { A, B, dice, go, hkOpen, withTerrain } from './hearthkyn-salvagers.hooks'

/** A Comms Device marker of seat A at (x, z). */
const comms = (s: GameState, x: number, z: number): GameState =>
  edit(s, (st) => {
    const m: Marker = { id: 'cd-a', kind: 'equipment', pos: { x, z }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'core.e.comms-device' }
    st.markers.push(m)
  })

describe('TEAM-HK rules verification', () => {
  it("TEAM-HK-008 Knux Smash may push the enemy to a spot inside a control range (the Dôzr's own included): the push is not the enemy's Reposition", () => {
    const s = hkOpen()
    const d = A(s, 'hk.dozr')
    const boy = B(s, 'kom.boy')
    const near = edit(place(place(s, d, 0, 0), boy, 1.3, 0), (st) => (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    const choose = go(near, d, `ability:hk.a.knux-smash:${boy}`)
    const spots = choose.pending!.options!.filter((o) => o.id !== 'stay')
    const inside = spots.find((o) => {
      const [x, z] = o.id.split(',').map(Number) as [number, number]
      const ghost = { ...bodyOf(near.operatives[boy]!), pos: { x, y: 0, z } }
      return inControlRange(near, ghost, bodyOf(near.operatives[d]!))
    })
    expect(inside).toBeDefined()
    // spots that leave the Dozr free to Charge are listed first
    const first = spots[0]!.id.split(',').map(Number) as [number, number]
    expect(inControlRange(near, { ...bodyOf(near.operatives[boy]!), pos: { x: first[0], y: 0, z: first[1] } }, bodyOf(near.operatives[d]!))).toBe(false)
    const pushed = take(choose, inside!.id, dice(1)).state
    expect(pushed.operatives[boy]!.wounds).toBe(38)
    expect(pushed.operatives[boy]!.pos).not.toEqual(near.operatives[boy]!.pos)
    // still in the Dozr's control range: no free Charge
    expect(pushed.pending?.kind).not.toBe('move.path')
  })

  it('TEAM-HK-019 Spot reaches 6" only while the Lokâtr itself controls a Comms Device, not when another friendly operative does', () => {
    const s = hkOpen()
    const l = A(s, 'hk.lokatr')
    const w = A(s, 'hk.warrior')
    const kin = A(s, 'hk.kinlynk')
    const boy = B(s, 'kom.boy')
    const cover = feature('hk-cover', part('hk-cover.a', rect(4.2, 4.6, -3, 3), 1, ['light']))
    const lay = withTerrain(edit(place(place(place(place(s, w, 0, 0), l, 1, 2), kin, -6, 0), boy, 5.2, 0), (st) => (st.operatives[boy]!.order = 'conceal')), cover)
    const spotted = go(lay, l, `ability:hk.a.spot:${boy}`)
    const apart = place(spotted, l, 4, 3)
    const targets = (st: GameState) => validTargets(st, st.operatives[w]!, 'hk.w.autoch-bolter').map((x) => x.id)
    expect(targets(apart)).not.toContain(boy)
    expect(targets(comms(apart, 4, 3))).toContain(boy)
    expect(targets(comms(apart, -6, 0))).not.toContain(boy)
  })

  it('TEAM-HK-029 Climbing Rigs work only in the operative\'s own activation, never in another operative\'s activation', () => {
    const s = hkOpen({ equipmentA: ['hk.e.climbing-rigs'] })
    const w = A(s, 'hk.warrior')
    const other = A(s, 'hk.kinlynk')
    const climb = (st: GameState) => providerMoveSurcharge(st, st.operatives[w]!, 'reposition', [], { horizontal: 0, accessible: 0, climb: 3, drop: 0 })
    expect(climb(activateOp(s, w))).toBe(-1)
    expect(climb(activateOp(s, other))).toBe(0)
  })
})
