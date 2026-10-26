// Hunter Clade rules-verification fixes (M9 batch B review), named by checklist id (docs/spec/12-rules-test-checklist.md).
import { describe, expect, it } from 'vitest'
import { effectiveRules } from '@/engine/attack-common'
import { ScriptedRng } from '@/engine/rng'
import { P, T, signalTargets } from '@/engine/teams/hunter-clade'
import type { GameState, Marker } from '@/engine/types'
import { pick as pickOpt, play, rolled } from '../../fixtures/attack'
import { place } from '../../fixtures/helpers'
import { activateOp, edit, take } from '../../fixtures/real'
import { A, B, FULL, open, pass } from './hunter-clade.hooks'

/** A Comms Device marker of seat A at (x, z). */
const comms = (s: GameState, x: number, z: number): GameState =>
  edit(s, (st) => {
    const m: Marker = { id: 'cd-a', kind: 'equipment', pos: { x, z }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'core.e.comms-device' }
    st.markers.push(m)
  })

describe('TEAM-HC rules verification', () => {
  it("TEAM-HC-026 OMNISSIAH'S IMPERATIVE as a shot defender may also be used after its defence dice are rolled: under Bulwark the Save improves at once and one more defence die is rolled", () => {
    const base = open({ rosterA: FULL })
    const warrior = A(base, 'skitarii-ranger-warrior')
    const ender = A(base, 'skitarii-vanguard-warrior')
    const boy = B(base, 'boy')
    const s = edit(place(place(base, warrior, 0, 0), boy, 6, 0), (st) => {
      st.players.A.cp = 3
      st.config.A.doctrine = 'bulwark'
    })
    const turn = take(activateOp(s, ender), 'end').state
    const aim = take(take(activateOp(turn, boy), 'shoot').state, 'kom.w.slugga').state
    // one crit and three misses; three defence dice of 3 fail against 4+; the Omnissiah die is another 3
    const dice = () => new ScriptedRng([6, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1])
    const shot = (useAt: string | null) =>
      play(aim, dice(), {
        'shoot.target': (q) => pickOpt(q, warrior),
        'ploy.firefight': (q) => (q.seat === 'A' && q.window === useAt && q.options?.find((o) => o.id === P.omnissiah)?.action) || pass(q),
      })
    const late = shot('shoot.defenceRolled')
    expect(rolled(late.events, 'hc.omnissiah.defence')).toHaveLength(1)
    expect(late.state.operatives[warrior]!.tokens?.some((t) => t.kind === T.omnissiah && t.data?.mode === 'bulwark')).toBe(true)
    // four 3s against a 3+ Save are four normal saves: two of them block the crit
    expect(late.state.operatives[warrior]!.wounds).toBe(late.state.operatives[warrior]!.maxWounds)
    const none = shot(null)
    expect(none.state.operatives[warrior]!.wounds).toBeLessThan(none.state.operatives[warrior]!.maxWounds)
    // the defender's fresh-roll window offers it too
    const fresh = shot('shoot.defenderBeforeRerolls')
    expect(rolled(fresh.events, 'hc.omnissiah.defence')).toHaveLength(1)
  })

  it('TEAM-HC-016 TEAM-HC-017 a Comms Device the Diktat or Surveyor controls adds 3" to SIGNAL (9") and to the SPOT shooter distance (6"); one another friend controls does not', () => {
    const base = open({ rosterA: FULL })
    const diktat = A(base, 'skitarii-ranger-diktat')
    const friend = A(base, 'skitarii-ranger-warrior')
    const other = A(base, 'skitarii-vanguard-warrior')
    const s = place(place(place(base, diktat, 0, 0), friend, 8, 0), other, 0, 6)
    expect(signalTargets(s, s.operatives[diktat]!).map((o) => o.id)).not.toContain(friend)
    const held = comms(s, 0, 0)
    expect(signalTargets(held, held.operatives[diktat]!).map((o) => o.id)).toContain(friend)
    const elsewhere = comms(s, 0, 6)
    expect(signalTargets(elsewhere, elsewhere.operatives[diktat]!).map((o) => o.id)).not.toContain(friend)

    const surveyor = A(base, 'skitarii-ranger-surveyor')
    const shooter = A(base, 'skitarii-ranger-warrior')
    const boy = B(base, 'boy')
    const lay = place(place(place(place(base, surveyor, 0, 0), shooter, 0, 5), other, 0, -6), boy, 10, 0)
    const spotted = take(activateOp(lay, surveyor), `ability:hc.a.spot:${boy}`).state
    const seek = (st: GameState) => effectiveRules(st, st.operatives[shooter]!, st.data.weapons['hc.w.galvanic-rifle']!, 'shoot', boy).map((r) => r.rule)
    expect(seek(spotted)).not.toContain('core.wr.seek-light')
    expect(seek(comms(spotted, 0, 0))).toContain('core.wr.seek-light')
    expect(seek(comms(spotted, 0, -6))).not.toContain('core.wr.seek-light')
  })
})
