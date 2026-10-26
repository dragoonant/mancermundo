import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { interruptActions } from '@/engine/guard'
import { ScriptedRng } from '@/engine/rng'
import type { GameEvent } from '@/engine/events'
import type { GameState } from '@/engine/types'
import { play } from '../fixtures/attack'
import { drive, place } from '../fixtures/helpers'
import { activateOp, edit, hasOption, openReal, opOf, optionIds, passIt, roster, take } from '../fixtures/real'

const NEUTRAL = { teamChoices: { A: { 'primary-tactic': 'aod.a.ct-mobile', 'secondary-tactic': 'aod.a.ct-hardy' }, B: {} } } as const
const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })
const noPloys = { 'ploy.firefight': pass }

/** A guards with the Intercessor Warrior (bolt rifle); B's Boy is far away. B is about to activate. */
function guarded(extra: Parameters<typeof openReal>[0] = {}): { s: GameState; marine: string; boy: string } {
  let s = openReal({ ...NEUTRAL, rosterA: [{ datacardId: 'aod.intercessor-warrior', loadout: { weaponIds: ['aod.w.bolt-rifle'] } }, ...roster(['aod.eliminator-sniper'])], ...extra })
  const marine = opOf(s, 'A', 'aod.intercessor-warrior')
  const boy = opOf(s, 'B', 'kom.boy')
  s = place(place(s, marine, 0, 0), boy, 9, 0)
  s = activateOp(s, marine)
  s = take(s, 'guard').state
  expect(s.operatives[marine]!.flags.guard).toBe(true)
  s = take(s, 'end').state
  return { s, marine, boy }
}

describe('MOVE Guard and interrupts', () => {
  it('MOVE-010 Guard is rejected with Conceal or in an enemy control range, and ends on an action, a move, an order change or an unused interrupt chance', () => {
    const s = openReal(NEUTRAL)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const conceal = activateOp(s, marine, 'conceal')
    expect(hasOption(conceal, 'guard')).toBe(false)
    const boy = opOf(s, 'B', 'kom.boy')
    const engaged = activateOp(place(place(s, marine, 0, 0), boy, 1.6, 0), marine)
    expect(hasOption(engaged, 'guard')).toBe(false)
    // it ends at the start of the next turning point, before the Strategy phase (SEQ-010)
    const { s: g, marine: m } = guarded()
    expect(g.operatives[m]!.flags.guard).toBe(true)
    const events: GameEvent[] = []
    const next = drive(g, (st) => st.turningPoint === 2 && st.pending?.kind === 'strategy.initiative', 800, new ScriptedRng([6, 1, 6, 1, 6, 1]), events)
    expect(next.operatives[m]!.flags.guard).toBe(false)
    expect(events.some((e) => e.type === 'GuardCleared' && e.operativeId === m)).toBe(true)
  })

  it('MOVE-011 after an enemy action the guard owner may interrupt with a free Shoot at any target, once per enemy activation', () => {
    const { s, marine, boy } = guarded()
    let t = activateOp(s, boy)
    t = take(t, 'reposition').state
    const p = t.pending!
    const moved = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 6, z: 0 }] } })
    expect(moved.rejection).toBeUndefined()
    t = moved.state
    while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
    expect(t.pending).toMatchObject({ kind: 'guard.interrupt', seat: 'A', canPass: true })
    expect(optionIds(t)).toEqual([`${marine}:shoot`])
    const ap = t.operatives[marine]!.ready
    t = take(t, `${marine}:shoot`).state
    expect(t.firefight.activation!.frame).toMatchObject({ kind: 'interrupt' })
    expect(t.firefight.activation!.operativeId).toBe(marine)
    expect(t.pending!.kind).toBe('shoot.weapon')
    const events: GameEvent[] = []
    const r = play(t, undefined, { ...noPloys, 'shoot.target': (q) => q.options!.find((o) => o.id === boy)?.action ?? null })
    events.push(...r.events)
    t = r.state
    // the interrupted activation continues: it is the Boy's again, with 1 AP spent and the interrupt used
    expect(t.pending!.kind).toBe('firefight.action')
    expect(t.firefight.activation!.operativeId).toBe(boy)
    expect(t.firefight.activation!.apSpent).toBe(1)
    expect(t.firefight.activation!.used).toContain('interrupt')
    expect(t.firefight.stack ?? []).toEqual([])
    // the interrupting operative acted for free (its own readiness is untouched), lost its guard and cannot counteract this turning point
    expect(t.operatives[marine]!.ready).toBe(ap)
    expect(t.operatives[marine]!.flags.guard).toBe(false)
    expect(t.operatives[marine]!.flags.counteractedThisTP).toBe(true)
    expect(events.some((e) => e.type === 'ShootStarted')).toBe(true)
    // a second action by the Boy gets no second interrupt
    if (t.operatives[boy]!.status === 'active') {
      t = take(t, 'dash').state
      const q = t.pending!
      const second = step(t, { type: 'move.path', seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x: 7, z: 0 }] } })
      expect(second.state.pending!.kind).not.toBe('guard.interrupt')
    }
  })

  it('declining the interrupt makes a guard next to the acting enemy lose its guard (R-4.9)', () => {
    const { s, marine, boy } = guarded()
    // the Boy charges the guard: it ends in its control range, the owner declines
    let t = activateOp(s, boy)
    t = take(t, 'charge').state
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.9, z: 0 }] } }).state
    while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
    expect(t.pending!.kind).toBe('guard.interrupt')
    expect(optionIds(t).sort()).toEqual([`${marine}:fight`, `${marine}:shoot`])
    const r = passIt(t)
    expect(r.events.some((e) => e.type === 'GuardCleared' && e.operativeId === marine)).toBe(true)
    expect(r.state.operatives[marine]!.flags.guard).toBe(false)
    expect(r.state.pending!.kind).toBe('firefight.action')
  })

  it('MOVE-012 a point-blank shot targets an enemy in the guard control range with Hit worsened by 1; the guard cannot retaliate afterwards', () => {
    const { s, marine, boy } = guarded()
    let t = activateOp(s, boy)
    t = take(t, 'charge').state
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.9, z: 0 }] } }).state
    while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
    expect(interruptActions(t, t.operatives[marine]!)).toEqual(expect.arrayContaining(['fight', 'shoot']))
    t = take(t, `${marine}:shoot`).state
    expect(t.operatives[marine]!.flags.cannotRetaliate).toBe(true)
    expect(t.attack).toMatchObject({ kind: 'shoot', pointBlank: true })
    // only the Boy beside the guard is a target, though it would not be a valid target otherwise
    const tp = play(t, new ScriptedRng([6, 3, 3, 2, 1, 1, 1]), noPloys, ['shoot.target', 'firefight.action'])
    expect(tp.state.pending!.kind).toBe('shoot.target')
    expect(tp.state.pending!.options!.map((o) => o.id)).toEqual([boy])
    const r = play(tp.state, new ScriptedRng([6, 3, 3, 2, 1, 1, 1]), noPloys)
    const rolled = r.events.find((e) => e.type === 'AttackDiceRolled') as { need: number }
    expect(rolled.need).toBe(4) // bolt rifle Hit 3+ worsened to 4+
    // the restriction lasts until the end of the interrupted activation
    expect(r.state.operatives[marine]!.flags.cannotRetaliate).toBe(true)
    const ended = take(r.state, 'end').state
    expect(ended.operatives[marine]!.flags.cannotRetaliate).toBeUndefined()
  })

  it('MOVE-013 Heavy weapons do not stop Guard and can be used at an interrupt', () => {
    let s = openReal({ ...NEUTRAL, rosterA: [{ datacardId: 'aod.intercessor-warrior', loadout: { weaponIds: ['aod.w.stalker-bolt-rifle-heavy', 'aod.w.stalker-bolt-rifle-mobile'] } }, ...roster(['aod.eliminator-sniper'])] })
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    s = place(place(s, marine, 0, 0), boy, 9, 0)
    s = activateOp(s, marine)
    // move first with a Heavy (Dash only) weapon, then go on guard: allowed
    s = take(s, 'reposition').state
    const p = s.pending!
    s = step(s, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -1, z: 0 }] } }).state
    while (s.pending?.kind === 'ploy.firefight') s = passIt(s).state
    expect(hasOption(s, 'guard')).toBe(true)
    s = take(s, 'guard').state
    s = take(s, 'end').state
    let t = activateOp(s, boy)
    t = take(t, 'reposition').state
    const q = t.pending!
    t = step(t, { type: 'move.path', seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x: 6, z: 0 }] } }).state
    while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
    expect(t.pending!.kind).toBe('guard.interrupt')
    t = take(t, `${marine}:shoot`).state
    expect(t.pending!.options!.map((o) => o.id)).toContain('aod.w.stalker-bolt-rifle-heavy')
  })

})
