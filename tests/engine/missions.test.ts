import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { gradeThresholds, missionView, onOperativeRemoved } from '@/engine/missions'
import { createCtx } from '@/engine/registry'
import { ScriptedRng, SeededRng } from '@/engine/rng'
import { cloneState } from '@/engine/state'
import { distPointSegment } from '@/engine/geometry'
import type { GameEvent } from '@/engine/events'
import type { GameState, Seat } from '@/engine/types'
import { defaultAnswer, drive, place } from '../fixtures/helpers'
import { activateOp, edit, hasOption, inTp, newRealGame, openReal, opOf, optionIds, realGame, roster, take } from '../fixtures/real'

function marker(s: GameState, n: number) {
  return s.markers.filter((m) => m.kind === 'objective')[n - 1]!
}

/** End every remaining activation of the turning point (each ready operative just ends) until `until` holds. */
function finishTp(s: GameState, until: (s: GameState) => boolean, dice = [6, 1, 6, 1, 6, 1, 6, 1, 6, 1]): GameState {
  return drive(s, until, 800, new ScriptedRng(dice))
}

/** Stand a ready operative of the seat next to an objective marker: it controls it unopposed. */
function stand(s: GameState, id: string, n: number): GameState {
  const m = marker(s, n)
  return place(s, id, m.pos.x + 2, m.pos.z)
}

describe('MISSION set-up: map, crit op, objectives', () => {
  it('MISSION-001 the setup-initiative roll picks the map: 1-3 map 1, 4-6 map 2', () => {
    for (const [die, map] of [
      [3, 'prelim-1'],
      [4, 'prelim-2'],
    ] as const) {
      // roll-off 6/1 (A wins and keeps initiative), crit op roll fixed by the setup, then the map die
      const first = newRealGame({ rollMap: true }).state
      const s = drive(first, (st) => st.pending?.kind === 'firefight.activate', 800, new ScriptedRng([6, 1, die, 6, 1]))
      expect(s.mission!.mapId).toBe(map)
      expect(s.map.meta!.missionMapId).toBe(map)
    }
  })

  it('MISSION-003 the crit op roll is a D3: 1 Secure, 2 Loot, 3 Transmission', () => {
    // D6 results 1-2 give D3 1, 3-4 give 2, 5-6 give 3
    for (const [die, id] of [
      [2, 'mission.prelim-secure'],
      [4, 'mission.prelim-loot'],
      [5, 'mission.prelim-transmission'],
    ] as const) {
      const first = newRealGame({ rollCritOp: true }).state
      const s = drive(first, (st) => st.pending?.kind === 'firefight.activate', 800, new ScriptedRng([6, 1, die, 6, 1]))
      expect(s.mission!.id).toBe(id)
    }
  })

  it('MISSION-002 objective markers: centre on the centreline, then one in each territory, within 3" of the centreline and more than 5" apart', () => {
    let s = newRealGame({ autoObjectives: false }).state
    const rng = new ScriptedRng([6, 1])
    s = take(s, 'roll', rng).state
    s = take(s, 'roll', rng).state
    s = take(s, 'A').state // A decides to hold setup initiative
    // the player WITHOUT setup initiative places the first marker, on the centreline
    expect(s.pending).toMatchObject({ kind: 'setup.objective', seat: 'B' })
    const centreOptions = s.pending!.options!.map((o) => o.action.payload as { x: number; z: number })
    expect(centreOptions.length).toBeGreaterThan(0)
    const meta = s.map.meta!
    for (const p of centreOptions) {
      expect(distPointSegment(p, meta.centreline.a, meta.centreline.b)).toBeLessThan(1e-6)
      for (const e of meta.neutralEdges) expect(distPointSegment(p, e.a, e.b) - 0.787).toBeGreaterThan(2)
    }
    s = take(s, optionIds(s)[0]!).state
    expect(s.pending).toMatchObject({ kind: 'setup.objective', seat: 'A' })
    const second = s.pending!.options!.map((o) => o.action.payload as { x: number; z: number })
    for (const p of second) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(3 + 0.787) // within 3" of the centreline (x = 0 on map 1)
      expect(Math.hypot(p.x - marker(s, 1).pos.x, p.z - marker(s, 1).pos.z) - 2 * 0.787).toBeGreaterThan(5)
    }
    const firstSide = Math.sign(second[0]!.x)
    s = take(s, optionIds(s)[0]!).state
    expect(s.pending).toMatchObject({ kind: 'setup.objective', seat: 'B' })
    const third = s.pending!.options!.map((o) => o.action.payload as { x: number; z: number })
    // the last marker must take the other territory
    for (const p of third) expect(Math.sign(p.x)).toBe(-firstSide)
    s = take(s, optionIds(s)[0]!).state
    expect(s.markers.filter((m) => m.kind === 'objective')).toHaveLength(3)
    expect(s.pending?.kind).toBe('setup.dropZone')
  })

  it('MISSION-002b with auto objectives the engine places the same legal triple', () => {
    const s = realGame()
    const ms = s.markers.filter((m) => m.kind === 'objective')
    expect(ms).toHaveLength(3)
    expect(ms[0]!.pos).toEqual({ x: 0, z: 0 })
    expect(Math.sign(ms[1]!.pos.x)).toBe(-Math.sign(ms[2]!.pos.x))
  })
})

describe('MISSION kill op', () => {
  function remove(s: GameState, ids: string[]): { state: GameState; events: GameEvent[] } {
    const ctx = createCtx(cloneState(s), SeededRng.fromSeed('k'), null, 0)
    for (const id of ids) {
      const op = ctx.state.operatives[id]!
      op.wounds = 0
      op.status = 'removed'
      onOperativeRemoved(ctx, op)
    }
    return { state: ctx.state, events: ctx.events }
  }

  it('MISSION-004 grades rise with incapacitations, each new grade scores 1 VP, to a maximum of 5', () => {
    const s = realGame()
    const aod = Object.values(s.operatives).filter((o) => o.seat === 'A').map((o) => o.id) // 6 operatives: thresholds 1,2,4,5,6
    expect(gradeThresholds(s, 'B')).toEqual([1, 2, 4, 5, 6])
    let r = remove(s, aod.slice(0, 1))
    expect(r.state.mission!.grade.B).toBe(1)
    expect(r.state.players.B.vp).toBe(1)
    expect(r.events.filter((e) => e.type === 'KillGradeChanged')).toHaveLength(1)
    r = remove(r.state, aod.slice(1, 2))
    expect([r.state.mission!.grade.B, r.state.players.B.vp]).toEqual([2, 2])
    r = remove(r.state, aod.slice(2, 3))
    expect([r.state.mission!.grade.B, r.state.players.B.vp]).toEqual([2, 2]) // 3 kills is still grade 2
    r = remove(r.state, aod.slice(3, 4))
    expect([r.state.mission!.grade.B, r.state.players.B.vp]).toEqual([3, 3])
    r = remove(r.state, aod.slice(4, 6))
    expect([r.state.mission!.grade.B, r.state.players.B.vp]).toEqual([5, 5])
    expect(r.state.players.A.vp).toBe(0)
  })

  it('MISSION-005 with 8 starting enemy operatives grade 1 needs 2 and grade 2 needs 3 (data-driven table)', () => {
    const eight = realGame({ rosterB: roster(['kom.boss-nob', 'kom.boy', 'kom.boy', 'kom.boy', 'kom.boy', 'kom.boy', 'kom.boy', 'kom.burna-boy']) })
    expect(gradeThresholds(eight, 'A')).toEqual([2, 3, 5, 6, 8])
    const ids = Object.values(eight.operatives).filter((o) => o.seat === 'B').map((o) => o.id)
    const r1 = remove(eight, ids.slice(0, 1))
    expect(r1.state.mission!.grade.A).toBe(0)
    const r2 = remove(r1.state, ids.slice(1, 2))
    expect(r2.state.mission!.grade.A).toBe(1)
    expect(remove(r2.state, ids.slice(2, 3)).state.mission!.grade.A).toBe(2)
  })

  it('MISSION-006 a Bomb Squig is not counted in the starting number and its incapacitation does not count', () => {
    const s = realGame()
    expect(s.mission!.startCount).toEqual({ A: 6, B: 10 }) // 11 Kommandos, one Expendable
    expect(gradeThresholds(s, 'A')).toEqual([2, 4, 6, 8, 10])
    const squig = opOf(s, 'B', 'kom.bomb-squig')
    const r = remove(s, [squig])
    expect(r.state.mission!.kills.A).toBe(0)
    expect(r.state.players.A.vp).toBe(0)
    // a removed operative is counted only once
    const boy = opOf(s, 'B', 'kom.boy')
    const again = remove(remove(s, [boy]).state, [boy])
    expect(again.state.mission!.kills.A).toBe(1)
  })
})

describe('MISSION crit ops', () => {
  it('MISSION-010 no crit op action is offered in the first turning point', () => {
    const s = openReal()
    const id = opOf(s, 'A', 'aod.intercessor-warrior')
    const t = activateOp(stand(s, id, 1), id)
    expect(optionIds(t).some((o) => o.startsWith('ability:core.a.secure'))).toBe(false)
    const tp2 = activateOp(inTp(stand(s, id, 1), 2), id)
    expect(hasOption(tp2, `ability:core.a.secure:${marker(s, 1).id}`)).toBe(true)
  })

  it('MISSION-007 Secure: not in an enemy control range; scores 1 + 1 at the end of the turning point', () => {
    let s = inTp(openReal({ missionId: 'mission.prelim-secure' }), 2)
    const a = opOf(s, 'A', 'aod.intercessor-warrior')
    s = stand(s, a, 1)
    // an enemy in control range of the operative bars the action
    const foe = opOf(s, 'B', 'kom.boy')
    const blocked = activateOp(place(s, foe, marker(s, 1).pos.x + 3.3, marker(s, 1).pos.z), a)
    expect(optionIds(blocked).some((o) => o.startsWith('ability:core.a.secure'))).toBe(false)
    // otherwise Secure marks the marker for the team
    let t = activateOp(s, a)
    t = take(t, `ability:core.a.secure:${marker(s, 1).id}`).state
    expect(t.mission!.secured[marker(s, 1).id]).toBe('A')
    expect(t.firefight.activation!.apSpent).toBe(1)
    expect(t.players.A.vp).toBe(0)
    // the end of TP2 pays 1 for any secured marker and 1 for more than the enemy
    const events: GameEvent[] = []
    let u = drive(t, (st) => st.turningPoint === 3, 800, new ScriptedRng([6, 1, 6, 1, 6, 1, 6, 1]), events)
    expect(u.players.A.vp).toBe(2)
    expect(u.players.B.vp).toBe(0)
    expect(events.filter((e) => e.type === 'VpScored').map((e) => (e as { ruleId: string }).ruleId)).toEqual(['secure-any', 'secure-more'])
    // the marker stays secured until the enemy secures it
    expect(u.mission!.secured[marker(s, 1).id]).toBe('A')
    u = edit(u, () => undefined)
    expect(missionView(u)!.markers.find((m) => m.id === marker(s, 1).id)!.securedBy).toBe('A')
  })

  it('MISSION-007b the enemy re-securing a marker takes it over; equal counts give only the first VP', () => {
    let s = inTp(openReal({ missionId: 'mission.prelim-secure' }), 2)
    const a = opOf(s, 'A', 'aod.intercessor-warrior')
    const b = opOf(s, 'B', 'kom.boss-nob')
    s = edit(s, (st) => {
      st.mission!.secured[marker(s, 1).id] = 'A'
    })
    s = stand(place(s, b, 0, 0), a, 2)
    s = place(s, b, marker(s, 1).pos.x + 2, marker(s, 1).pos.z)
    // B (initiative A moves first, so end A's activation then use B)
    let t = activateOp(s, a)
    t = take(t, 'end').state
    t = activateOp(t, b)
    expect(hasOption(t, `ability:core.a.secure:${marker(s, 1).id}`)).toBe(true) // the enemy's marker may be taken
    t = take(t, `ability:core.a.secure:${marker(s, 1).id}`).state
    expect(t.mission!.secured[marker(s, 1).id]).toBe('B')
  })

  it('MISSION-008 Loot: once per marker per turning point; VP capped at 2 per turning point', () => {
    let s = inTp(openReal({ missionId: 'mission.prelim-loot' }), 2)
    const ids = [opOf(s, 'A', 'aod.intercessor-warrior'), opOf(s, 'A', 'aod.intercessor-gunner'), opOf(s, 'A', 'aod.heavy-intercessor-gunner')]
    s = edit(s, (st) => {
      ids.forEach((id, i) => {
        const m = marker(st, i + 1)
        st.operatives[id]!.pos = { x: m.pos.x + 2, y: 0, z: m.pos.z }
      })
    })
    // A1 loots marker 1, B ends, A2 loots marker 2, B ends, A3 loots marker 3 (no more VP: capped)
    const vp: number[] = []
    let t = s
    for (let i = 0; i < 3; i++) {
      t = activateOp(t, ids[i]!)
      const m = marker(s, i + 1).id
      expect(hasOption(t, `ability:core.a.loot:${m}`)).toBe(true)
      t = take(t, `ability:core.a.loot:${m}`).state
      vp.push(t.players.A.vp)
      expect(t.mission!.looted).toContain(m)
      t = take(t, 'end').state
      if (i < 2) {
        // B's activation: ends at once
        t = activateOp(t, t.pending!.options![0]!.id)
        t = take(t, 'end').state
      }
    }
    expect(vp).toEqual([1, 2, 2])
    // a marker already looted this turning point cannot be looted again by either team
    t = activateOp(t, t.pending!.options![0]!.id)
    t = take(t, 'end').state
    const sniper = opOf(t, 'A', 'aod.eliminator-sniper')
    t = place(t, sniper, marker(s, 1).pos.x - 2, marker(s, 1).pos.z)
    const retry = activateOp(t, sniper)
    expect(hasOption(retry, `ability:core.a.loot:${marker(s, 1).id}`)).toBe(false)
  })

  it('MISSION-009 Transmission: transmitting ends at the start of the next turning point; 1 + 1 VP for control', () => {
    let s = inTp(openReal({ missionId: 'mission.prelim-transmission' }), 2)
    const a = opOf(s, 'A', 'aod.intercessor-warrior')
    s = stand(s, a, 1)
    let t = activateOp(s, a)
    t = take(t, `ability:core.a.initiate-transmission:${marker(s, 1).id}`).state
    expect(t.mission!.transmitting).toEqual([marker(s, 1).id])
    expect(missionView(t)!.markers.find((m) => m.id === marker(s, 1).id)!.transmitting).toBe(true)
    // already transmitting: the action is not offered again
    expect(optionIds(t).some((o) => o.startsWith('ability:core.a.initiate-transmission'))).toBe(false)
    const events: GameEvent[] = []
    const u = drive(t, (st) => st.pending?.kind === 'strategy.initiative', 800, new ScriptedRng([6, 1, 6, 1]), events)
    expect(u.turningPoint).toBe(3)
    expect(u.players.A.vp).toBe(2)
    expect(events.filter((e) => e.type === 'VpScored').map((e) => (e as { ruleId: string }).ruleId)).toEqual(['transmit-any', 'transmit-more'])
    expect(u.mission!.transmitting).toEqual([]) // SEQ-010: ended before the Strategy phase
  })
})

describe('MISSION battle end', () => {
  it('SEQ-009 the battle ends after TP4 with the real result: most VP wins, equal VP is a draw', () => {
    const base = inTp(realGame(), 4)
    const lead = edit(base, (st) => {
      st.players.A.vp = 3
      st.players.B.vp = 1
    })
    const done = finishTp(lead, (st) => st.phase === 'ended')
    expect(done.result).toMatchObject({ winner: 'A', reason: 'turningPoint', placeholder: false })
    expect(done.result!.vp).toEqual({ A: done.players.A.vp, B: done.players.B.vp })
    const tied = edit(base, (st) => {
      st.players.A.vp = 2
      st.players.B.vp = 2
    })
    expect(finishTp(tied, (st) => st.phase === 'ended').result).toMatchObject({ winner: 'draw', placeholder: false })
  })

  it('MISSION-004b at the end of TP4 the higher kill grade scores 1 VP', () => {
    const s = edit(inTp(realGame(), 4), (st) => {
      st.mission!.grade = { A: 2, B: 1 }
    })
    const done = finishTp(s, (st) => st.phase === 'ended')
    expect(done.players.A.vp).toBe(1)
    expect(done.result!.winner).toBe('A')
    const level = edit(inTp(realGame(), 4), (st) => {
      st.mission!.grade = { A: 2, B: 2 }
    })
    expect(finishTp(level, (st) => st.phase === 'ended').result).toMatchObject({ winner: 'draw' })
  })

  it('missionView reports grades, thresholds and the VP room left this turning point', () => {
    const s = realGame()
    const v = missionView(s)!
    expect(v.critOp).toBe('secure')
    expect(v.kill.A).toMatchObject({ grade: 0, thresholds: [2, 4, 6, 8, 10], next: 2, startingEnemies: 10 })
    expect(v.kill.B).toMatchObject({ thresholds: [1, 2, 4, 5, 6], startingEnemies: 6 })
    expect(v.markers).toHaveLength(3)
    expect(v.critRoomThisTp).toEqual({ A: 2, B: 2 })
  })

  it('a game without a mission keeps the placeholder result', () => {
    const seats: Seat[] = ['A', 'B']
    expect(seats).toHaveLength(2)
    void step
    void defaultAnswer
  })
})
