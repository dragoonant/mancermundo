import { afterEach, describe, expect, it } from 'vitest'
import { query, ScriptedRng, step, act, type StepResult } from '@/engine'
import { clearHooks, registerHook } from '@/engine/hooks'
import { standUpContacted } from '@/engine/movement'
import { createCtx } from '@/engine/registry'
import { activate, edit, eventsOf, must, place, startGame, take } from '../fixtures/helpers'

afterEach(() => clearHooks())

describe('query: derived status, effective characteristics and the engine-owned numbers', () => {
  it('status is a pure function of posture, location and the derived engagement list', () => {
    const base = place(startGame().state, { A3: { x: 0, z: -10 }, B3: { x: 0, z: -9.006 } })
    expect(query.status(base, 'A3')).toBe('standingActive')
    const engaged = edit(base, (d) => {
      d.fighters.A3!.engagedWith = ['B3']
    })
    expect(query.status(engaged, 'A3')).toBe('standingEngaged')
    expect(query.status(edit(base, (d) => (d.fighters.A3!.posture = 'pinned')), 'A3')).toBe('pinned')
    expect(query.status(edit(base, (d) => (d.fighters.A3!.posture = 'seriouslyInjured')), 'A3')).toBe('seriouslyInjured')
    expect(query.status(edit(base, (d) => (d.fighters.A3!.location = 'outOfAction')), 'A3')).toBe('outOfAction')
    expect(query.engagedWith(engaged, 'A3')).toEqual(['B3'])
  })

  it('Concussion makes Initiative two worse but never worse than 6+; stat.modify deltas improve target numbers and add to plain ones', () => {
    const s = startGame().state
    expect(query.stat(s, 'A3', 'I')).toBe(4)
    const stunned = edit(s, (d) => {
      d.fighters.A3!.conditions.concussion = { since: 1 }
    })
    expect(query.stat(stunned, 'A3', 'I')).toBe(6)
    const dazed = edit(stunned, (d) => {
      d.fighters.A3!.stats.I = 5
    })
    expect(query.stat(dazed, 'A3', 'I')).toBe(6)
    registerHook('stat.modify', (ctx) => ((ctx.fighterId === 'A3' && ctx.data?.key === 'BS') || ctx.data?.key === 'S' ? { delta: 1 } : null), 'test.plus-one')
    expect(query.stat(s, 'A3', 'BS')).toBe(3) // BS 4+ improved to 3+
    expect(query.stat(s, 'A3', 'S')).toBe(4) // S 3 plus 1
    expect(query.stat(s, 'B3', 'BS')).toBe(4)
  })

  it('move.limit hooks change the allowance the move decision offers', () => {
    registerHook('move.limit', (ctx) => (ctx.fighterId === 'A3' ? { delta: -1 } : null), 'test.slow')
    const s = place(startGame().state, { A3: { x: 0, z: -10 } })
    const r = take(activate(s, 'A3').state, { action: 'move' })
    expect(r.pending!.constraints).toMatchObject({ maxInches: 4 })
  })

  it('distance is the straight base-edge distance and pathDistance the wall-respecting one', () => {
    const s = place(startGame().state, { A3: { x: 0, z: -10 }, B3: { x: 3, z: -6 } })
    expect(query.distance(s, 'A3', 'B3')).toBeCloseTo(5 - 2 * 0.492, 3)
    expect(query.pathDistance(s, 'A3', 'B3')).toBeCloseTo(5 - 2 * 0.492, 3)
  })

  it('query.actionMenu is the same list the decision offers, with a reason for every action it withholds', () => {
    const r = activate(place(startGame().state, { A3: { x: 0, z: -10 } }), 'A3')
    const menu = query.actionMenu(r.state, 'A3')
    expect(menu.options.map((o) => o.payload)).toEqual(r.pending!.options!.map((o) => o.action.payload))
    expect(menu).toMatchObject({ status: 'standingActive', actionsLeft: 2, canTurn: true })
    const reasons = new Map(menu.withheld.map((w) => [w.action, w.reason]))
    expect(reasons.get('charge')).toBe('later') // close combat arrives in S3b; Shoot is offered since S3a
    expect(menu.options.some((o) => o.payload.action === 'shoot')).toBe(true)
    expect(reasons.get('operateDoor')).toBe('noTarget')
    expect(reasons.has('standUp')).toBe(false) // not a Standing action at all
  })

  it('a Pinned enemy that a mover is put in base contact with stands up facing it and both become Engaged (R-3.4)', () => {
    const s = place(startGame().state, { A3: { x: 0, z: -10 }, B3: { x: 0, z: -9.006, posture: 'pinned', facing: 0 } })
    const ctx = createCtx(structuredClone(s), new ScriptedRng([]), null, 0)
    standUpContacted(ctx, ctx.state.fighters.A3!)
    const b = ctx.state.fighters.B3!
    expect(b.posture).toBe('standing')
    expect(b.facing).toBeCloseTo(Math.PI, 2) // turned to face A3, who is at lower z
    expect(b.engagedWith).toEqual(['A3'])
    expect(ctx.state.fighters.A3!.engagedWith).toEqual(['B3'])
    expect(eventsOf(ctx.events, 'StatusChanged')[0]).toMatchObject({ fighterId: 'B3', from: 'pinned', to: 'standing', reason: 'contacted' })
  })

  it('a Blind fighter flagged to skip Ready is not readied next round and the flag is spent', () => {
    let s = startGame().state
    s = edit(s, (d) => {
      d.fighters.B4!.conditions.blind = { since: 1, data: { skipNextReady: true } }
    })
    let guard = 0
    let cur: StepResult = { state: s, events: [], pending: s.pending }
    while (cur.state.round === 1 && guard++ < 60) {
      const p = cur.state.pending!
      cur = must(step(cur.state, p.kind === 'action.group' ? act.groupDone(p) : p.kind === 'action.choose' ? act.endActivation(p) : p.options![0]!.action))
    }
    expect(cur.state.round).toBe(2)
    expect(cur.state.fighters.B4!.ready).toBe(false)
    expect(cur.state.fighters.B4!.conditions.blind!.data).toEqual({})
    expect(cur.state.fighters.B3!.ready).toBe(true)
  })
})
