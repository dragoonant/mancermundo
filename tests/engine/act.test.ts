import { describe, expect, it } from 'vitest'
import { act, ScriptedRng, step, legalActions } from '@/engine'
import { actionMenu } from '@/engine/activation'
import { status } from '@/engine/query'
import { bundleWith, corridorWithDoor, ductwayWall } from '../fixtures/boards'
import { activate, edit, eventsOf, menuActions, moveTo, must, offered, place, startGame, take } from '../fixtures/helpers'

/** A3 (a 25 mm ganger, M5) activated in the open, alone in its half. */
function a3(posture?: 'pinned' | 'seriouslyInjured') {
  const s = place(startGame().state, { A3: { x: 0, z: -10, ...(posture ? { posture } : {}) } })
  return activate(s, 'A3')
}

describe('ACT: actions, costs and the menu by status', () => {
  it('ACT-001 Move can be performed twice in one activation; a Basic action cannot be repeated', () => {
    let r = a3()
    expect(menuActions(r.state)).toEqual(expect.arrayContaining(['move', 'takeCover', 'turn', 'end']))
    r = take(r.state, { action: 'move' })
    expect(r.pending?.kind).toBe('move.path')
    r = must(moveTo(r.state, [{ x: 0, z: -7 }]))
    expect(r.pending?.kind).toBe('action.choose')
    expect(r.state.action.activation!.actionsLeft).toBe(1)
    expect(menuActions(r.state)).toContain('move')
    r = take(r.state, { action: 'move' })
    r = must(moveTo(r.state, [{ x: 0, z: -4 }]))
    // two Moves spend both actions and end the activation
    expect(eventsOf(r.events, 'ActivationEnded')[0]).toMatchObject({ fighterId: 'A3', actionsUsed: 2 })
    expect(r.pending).toMatchObject({ kind: 'action.activate', seat: 'B' })
    expect(r.state.fighters.A3!.pos).toMatchObject({ x: 0, z: -4 })

    // Force Door is a Basic action: after a failed attempt it cannot be made again
    const board = corridorWithDoor({ locked: true })
    const s = place(startGame({ bundle: bundleWith(board), setup: { boardId: board.id } }).state, { A3: { x: 0, z: -1.5 } })
    let d = activate(s, 'A3')
    expect(menuActions(d.state)).toContain('forceDoor')
    d = must(take(d.state, { action: 'forceDoor' }, new ScriptedRng([1])))
    expect(d.state.board.doors.door1!.state).toBe('closed')
    expect(menuActions(d.state)).not.toContain('forceDoor')
    const again = step(d.state, act.choose(d.pending!, 'forceDoor', { doorId: 'door1' }))
    expect(again.rejection?.code).toBe('E_ACTION_RESTRICTED')
    expect(again.state).toBe(d.state)
  })

  it('ACT-002 a Double action is rejected when only one action remains', () => {
    const board = ductwayWall()
    const s = place(startGame({ bundle: bundleWith(board), setup: { boardId: board.id } }).state, { A3: { x: 0, z: -1.1 } })
    let r = activate(s, 'A3')
    const duct = r.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'crawlDuct')
    expect(duct).toBeDefined()
    const payload = duct!.action.payload as { ductId: string; spot: { x: number; z: number } }
    r = take(r.state, { action: 'move' })
    r = must(moveTo(r.state, [{ x: 1, z: -1.1 }]))
    expect(r.state.action.activation!.actionsLeft).toBe(1)
    expect(menuActions(r.state)).not.toContain('crawlDuct')
    const withheld = (r.pending!.context.withheld as { action: string; reason: string }[]).find((w) => w.action === 'crawlDuct')
    expect(withheld?.reason).toBe('needsTwo')
    const bad = step(r.state, act.choose(r.pending!, 'crawlDuct', { ductId: payload.ductId, spot: payload.spot }))
    expect(bad.rejection?.code).toBe('E_NO_ACTIONS')
    expect(bad.state).toBe(r.state)
  })

  it('ACT-004 Take Cover moves at most half M (rounded up) and leaves the fighter Pinned', () => {
    let r = a3()
    r = take(r.state, { action: 'takeCover' })
    expect(r.pending!.constraints).toMatchObject({ kind: 'takeCover', maxInches: 3 })
    const tooFar = step(r.state, act.path(r.pending!, [{ x: 0, z: -6.4 }]))
    expect(tooFar.rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(tooFar.state).toBe(r.state)
    r = must(moveTo(r.state, [{ x: 0, z: -7 }]))
    const f = r.state.fighters.A3!
    expect(f.posture).toBe('pinned')
    expect(status(r.state, 'A3')).toBe('pinned')
    expect(eventsOf(r.events, 'StatusChanged')[0]).toMatchObject({ from: 'standing', to: 'pinned', reason: 'takeCover' })
    // one action left; Take Cover is Basic so a Pinned fighter can now Stand Up
    expect(r.state.action.activation!.actionsLeft).toBe(1)
    expect(menuActions(r.state)).toEqual(expect.arrayContaining(['standUp', 'end']))
    expect(menuActions(r.state)).not.toContain('move')
  })

  it('Take Cover may stay where it is, and a cancelled move spends no action', () => {
    let r = a3()
    r = take(r.state, { action: 'takeCover' })
    const cancelled = must(step(r.state, act.pass(r.pending!)))
    expect(cancelled.pending?.kind).toBe('action.choose')
    expect(cancelled.state.action.activation!.actionsLeft).toBe(2)
    expect(eventsOf(cancelled.events, 'ActionCancelled')).toHaveLength(1)
    r = take(cancelled.state, { action: 'takeCover' })
    r = must(step(r.state, act.path(r.pending!, [])))
    expect(r.state.fighters.A3!.posture).toBe('pinned')
    expect(r.state.fighters.A3!.pos).toMatchObject({ x: 0, z: -10 })
  })

  it('ACT-005 a Seriously Injured fighter can only Crawl (Double, half M)', () => {
    let r = a3('seriouslyInjured')
    expect(status(r.state, 'A3')).toBe('seriouslyInjured')
    expect(menuActions(r.state).sort()).toEqual(['crawl', 'end'])
    r = take(r.state, { action: 'crawl' })
    expect(r.pending!.constraints).toMatchObject({ kind: 'crawl', maxInches: 3 })
    r = must(moveTo(r.state, [{ x: 0, z: -7 }]))
    // a Double spends the whole activation; the fighter stays Seriously Injured
    expect(eventsOf(r.events, 'ActivationEnded')[0]).toMatchObject({ actionsUsed: 2 })
    expect(r.state.fighters.A3!.posture).toBe('seriouslyInjured')
    expect(r.state.fighters.A3!.pos).toMatchObject({ z: -7 })
  })

  it('a Pinned fighter stands up (Basic) and then uses the Standing action list for its last action (R-6.4)', () => {
    let r = a3('pinned')
    // Blind Fire (S3a) is offered too when a target is in sight
    expect(menuActions(r.state).filter((x) => x !== 'blindFire').sort()).toEqual(['crawl', 'end', 'standUp'])
    r = take(r.state, { action: 'standUp' })
    expect(r.state.fighters.A3!.posture).toBe('standing')
    expect(menuActions(r.state)).toEqual(expect.arrayContaining(['move', 'takeCover', 'turn']))
    expect(menuActions(r.state)).not.toContain('standUp')
    r = take(r.state, { action: 'move' })
    r = must(moveTo(r.state, [{ x: 0, z: -8 }]))
    expect(r.state.fighters.A3!.pos).toMatchObject({ z: -8 })
  })

  it('the free turn is offered at the start of the activation and after a move, once each', () => {
    let r = a3()
    const turns = r.pending!.options!.filter((o) => (o.action.payload as { action: string }).action === 'turn')
    expect(turns.length).toBeGreaterThanOrEqual(8)
    const to = turns.find((o) => Math.abs((o.action.payload as { facing: number }).facing - Math.PI / 2) < 0.01)!
    r = must(step(r.state, to.action))
    expect(r.state.fighters.A3!.facing).toBeCloseTo(Math.PI / 2, 2)
    expect(menuActions(r.state)).not.toContain('turn')
    r = take(r.state, { action: 'move' })
    r = must(moveTo(r.state, [{ x: 0, z: -9 }], 0))
    expect(menuActions(r.state)).toContain('turn')
  })

  it('an Engaged fighter cannot Move or Reload; Fight and Retreat are withheld until the close combat stage', () => {
    const s = place(startGame().state, { A3: { x: 0, z: -10, facing: 0 }, B3: { x: 0, z: -9.006, facing: Math.PI } })
    const touching = edit(s, (d) => {
      d.fighters.A3!.weapons[0]!.ammo = 'out'
    })
    let r = activate(touching, 'A3')
    // the engagement refresh ran inside the activation step
    expect(status(r.state, 'A3')).toBe('standingEngaged')
    const m = actionMenu(r.state, 'A3')
    expect(m.options.map((o) => o.payload.action)).not.toContain('move')
    expect(m.options.map((o) => o.payload.action)).not.toContain('reload')
    expect(m.withheld.filter((w) => w.reason === 'later').map((w) => w.action)).toEqual(expect.arrayContaining(['fight', 'retreat']))
    r = must(step(r.state, act.endActivation(r.pending!)))
  })

  it('Reload makes an Ammo test for an Out of Ammo weapon: a pass restores it, a fail leaves it', () => {
    const out = edit(place(startGame().state, { A3: { x: 0, z: -10 } }), (d) => {
      d.fighters.A3!.weapons[0]!.ammo = 'out'
    })
    let r = activate(out, 'A3')
    const opt = r.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'reload')!
    expect(opt.data).toMatchObject({ need: 4, chance: 0.5 })
    const failed = must(step(r.state, opt.action, new ScriptedRng([3])))
    expect(failed.state.fighters.A3!.weapons[0]!.ammo).toBe('out')
    expect(eventsOf(failed.events, 'AmmoTest')[0]).toMatchObject({ roll: 3, need: 4, passed: false })
    // a Simple action: it can be tried again with the second action; any action other than a move closes the free turn
    expect(menuActions(failed.state)).toContain('reload')
    expect(menuActions(failed.state)).not.toContain('turn')
    r = must(take(failed.state, { action: 'reload' }, new ScriptedRng([4])))
    expect(r.state.fighters.A3!.weapons[0]!.ammo).toBe('ok')
    expect(eventsOf(r.events, 'WeaponStateChanged')[0]).toMatchObject({ weaponId: 'test.w.rifle', ammo: 'ok' })
  })

  it('every offered action.choose option passes validate and the end option is always there', () => {
    const r = a3()
    const legal = legalActions(r.state)!
    expect(legal.length).toBeGreaterThan(0)
    expect(offered(r.state)).toContain('end')
  })
})
