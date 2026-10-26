import { describe, expect, it } from 'vitest'
import { view } from '@/engine'
import { placeItem, placementIssue } from '@/engine/equipment'
import { newGame } from '../fixtures/helpers'
import { edit, openReal, realGame, withCtx } from '../fixtures/real'

describe('VIEW per-seat redaction', () => {
  it('removes the RNG state and the action log and names the viewer', () => {
    const s = newGame().state
    const v = view(s, 'A')
    expect(v).not.toHaveProperty('rng')
    expect(v).not.toHaveProperty('log')
    expect(v.viewer).toBe('A')
    expect(v.operatives).toBe(s.operatives) // a game with nothing hidden is passed through
  })

  it("hides the opponent's Mines marker (and its placement record) until it triggers; the owner sees it", () => {
    let s = openReal()
    s = withCtx(s, (ctx) => {
      const item = { key: 'B:core.e.mines#1', equipmentId: 'core.e.mines', kind: 'marker' as const }
      expect(placementIssue(ctx.state, 'B', item, { x: 6, z: 3 }, 0)).toBeNull()
      placeItem(ctx, 'B', item, { x: 6, z: 3 }, 0)
      const comms = { key: 'B:core.e.comms-device#1', equipmentId: 'core.e.comms-device', kind: 'marker' as const }
      placeItem(ctx, 'B', comms, { x: 8, z: -3 }, 0)
    }).state
    const markers = (seat: 'A' | 'B') => view(s, seat).markers.map((m) => m.equipmentId).filter(Boolean)
    expect(markers('B')).toEqual(expect.arrayContaining(['core.e.mines', 'core.e.comms-device']))
    expect(markers('A')).toEqual(['core.e.comms-device']) // other equipment markers are public
    expect(view(s, 'A').equipment.placed.map((p) => p.equipmentId)).toEqual(['core.e.comms-device'])
    expect(view(s, 'B').equipment.placed).toHaveLength(2)
    // after it triggers it is gone from the table and the record shows what it was
    const gone = edit(s, (st) => {
      st.markers = st.markers.filter((m) => m.equipmentId !== 'core.e.mines')
    })
    expect(view(gone, 'A').equipment.placed.map((p) => p.equipmentId)).toContain('core.e.mines')
    // the state itself is untouched by building a view
    expect(s.markers.some((m) => m.equipmentId === 'core.e.mines')).toBe(true)
  })

  it('a real game view still carries the mission state', () => {
    const v = view(realGame(), 'B')
    expect(v.mission?.id).toBe('mission.prelim-secure')
    expect(v.viewer).toBe('B')
  })
})
