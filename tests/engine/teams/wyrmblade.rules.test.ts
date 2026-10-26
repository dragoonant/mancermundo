// Wyrmblade rules-verification fixes (M9 review), named by checklist id (docs/spec/12-rules-test-checklist.md).
import { describe, expect, it } from 'vitest'
import { offersFor, usePloy } from '@/engine/ploys'
import { place } from '../../fixtures/helpers'
import { activateOp, edit, opOf, take, withCtx } from '../../fixtures/real'
import { agents, endAct, idsOf, pathTo, toGambit, wyr } from './wyrmblade.hooks'

describe('TEAM-WYR rules verification', () => {
  it('TEAM-WYR-020 Creeping Shadow: the free Dash after a Fight is capped at 2" while counteracting (the counteract move cap)', () => {
    const base = agents()
    const talon = opOf(base, 'A', 'wyr.sanctus-talon')
    const s = activateOp(place(base, talon, 0, 0), talon)
    const info = (counteracting: boolean) => ({ window: 'firefight.actionEnded', subjectId: talon, action: 'fight', counteracting })
    const dash = (counteracting: boolean) => offersFor(s, 'A', 'firefight.actionEnded', info(counteracting)).find((o) => o.id === 'wyr.a.creeping-shadow:dash')
    expect(dash(false)).toBeDefined()
    expect(dash(true)).toBeDefined()
    // in a counteraction the free Dash starts with a 2" cap, in an activation with the normal Dash distance
    const started = (counteracting: boolean) => withCtx(s, (ctx) => usePloy(ctx, 'A', dash(counteracting)!, info(counteracting))).state.pending
    expect(started(true)).toMatchObject({ kind: 'move.path', constraints: { kind: 'dash', maxInches: 2 } })
    expect(started(false)).toMatchObject({ kind: 'move.path', constraints: { kind: 'dash' } })
    expect((started(false)!.constraints as { maxInches?: number }).maxInches ?? 3).toBe(3)
  })

  it('TEAM-WYR-020 Slink Into Darkness is offered in the end-of-activation window, AP spent or not, never mid-activation, in a counteraction or twice per operative', () => {
    const base = wyr()
    const w = idsOf(base, 'A', 'wyr.warrior')[0]!
    const s = place(base, w, -6, 0)
    const slinkIn = (st: ReturnType<typeof wyr>) => st.pending?.kind === 'ploy.firefight' && st.pending.options!.some((o) => o.id === 'wyr.p.slink-into-darkness')
    // ended early with 2 AP unspent: still the end of its activation
    const early = take(activateOp(s, w, 'engage'), 'end').state
    expect(early.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.activationEnded', context: { subjectId: w } })
    expect(slinkIn(early)).toBe(true)
    const used = take(early, 'wyr.p.slink-into-darkness').state
    expect(used.operatives[w]).toMatchObject({ order: 'conceal', ready: false })
    expect(used.pending).toMatchObject({ kind: 'firefight.activate' })
    // not after the first of two actions: the activation goes on
    const mid = take(activateOp(s, w, 'engage'), 'guard').state
    expect(mid.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
    // a Conceal operative is not offered it, and neither is one that already used it this battle
    expect(slinkIn(take(activateOp(s, w, 'conceal'), 'end').state)).toBe(false)
    const again = edit(s, (st) => st.operatives[w]!.oncePerBattleUsed.push('wyr.slink'))
    expect(slinkIn(take(activateOp(again, w, 'engage'), 'end').state)).toBe(false)
    // a counteraction is not an activation
    const counter = edit(activateOp(s, w, 'engage'), (st) => (st.firefight.activation!.counteract = true))
    expect(offersFor(counter, 'A', 'firefight.activationEnded', { window: 'firefight.activationEnded', subjectId: w }).some((o) => o.ployId === 'wyr.p.slink-into-darkness')).toBe(false)
    // passing the window carries on to the next activation
    expect(endAct(activateOp(s, w, 'engage')).pending).toMatchObject({ kind: 'firefight.activate' })
  })

  it('TEAM-WYR-010 Quicksilver Strike interrupts a move made in the Strategy phase (FAQ): an enemy gambit Dash ending near the Locus', () => {
    const g0 = toGambit({ teams: ['wyrmblade', 'wyrmblade'] })
    const mover = idsOf(g0, 'A', 'wyr.warrior')[0]!
    const locus = opOf(g0, 'B', 'wyr.locus')
    let s = edit(place(place(g0, locus, 0, 0), mover, -6.5, 0), (st) => {
      st.operatives[locus]!.order = 'engage'
    })
    s = take(s, 'wyr.p.divert-and-disappear').state
    s = take(s, `${mover}:dash`).state
    s = pathTo(s, -3.76, 0)
    // B reacts inside the Strategy phase, before A's gambit carries on
    expect(s.phase).toBe('strategy')
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'B', window: 'strategy.gambit', context: { reaction: true, actorId: mover } })
    s = take(s, 'react:0').state
    expect(s.pending).toMatchObject({ kind: 'move.path', seat: 'B', constraints: { kind: 'charge', maxInches: 3, mustEndInControlRangeOfId: mover } })
    s = pathTo(s, -2.5, 0)
    expect(s.operatives[locus]!.pos.x).toBeCloseTo(-2.5)
    expect(s.ledger.B.tp).toContain(`wyr.a.quicksilver-strike:${locus}`)
    // and A's Divert and Disappear goes on with its remaining slots
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { slotsLeft: 2 } })
  })
})
