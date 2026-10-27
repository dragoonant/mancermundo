import { afterEach, describe, expect, it } from 'vitest'
import { act, query, ScriptedRng, step } from '@/engine'
import { registerBlastPort, registerHitPort, type BlastSpec, type HitSpec } from '@/engine/ports'
import { installAttackPorts } from '@/engine/hits'
import { dice, shootingGame } from '../fixtures/attack'
import { pathGap, withinPath, computeEngagedWith } from '@/engine/measure'
import { pathDistance } from '@/engine/query'
import { barricadePair, bundleWith, corridorWithDoor, ductwayWall, openBox, makeBoard } from '../fixtures/boards'
import { activate, edit, eventsOf, menuActions, moveTo, must, offered, place, startGame, take } from '../fixtures/helpers'
import type { BoardDef } from '@/engine/types'

const game = (board: BoardDef) => startGame({ bundle: bundleWith(board), setup: { boardId: board.id } }).state

// tests that spy on the ports put the real resolvers (S3a) back afterwards
afterEach(() => installAttackPorts())

describe('ZM: Zone Mortalis walls, doors, terminals, ductways, barricades and caskets', () => {
  it('ZM-002 movement paths and range measurements never pass through walls or board edges', () => {
    const solid = place(game(ductwayWall()), { A3: { x: 0, z: -2 }, B3: { x: 0, z: 2 } })
    let r = take(activate(solid, 'A3').state, { action: 'move' })
    expect(step(r.state, act.path(r.pending!, [{ x: 0, z: 2 }])).rejection?.code).toBe('E_NO_PATH')
    // the wall spans the whole board: no way round, so the path distance is infinite and nothing is "within" any distance
    expect(pathDistance(solid, 'A3', 'B3')).toBe(Infinity)
    expect(withinPath(solid, solid.fighters.A3!, solid.fighters.B3!, 12)).toBe(false)
    // the board edge is a wall too
    const edge = place(game(openBox()), { A3: { x: 11, z: -10 } })
    r = take(activate(edge, 'A3').state, { action: 'move' })
    expect(step(r.state, act.path(r.pending!, [{ x: 13, z: -10 }])).rejection).toBeDefined()
    expect(step(r.state, act.path(r.pending!, [{ x: 11.4, z: -10 }])).rejection?.code).toBe('E_NO_PATH')
    must(step(r.state, act.path(r.pending!, [{ x: 11.25, z: -10 }])))
    // a gap in the wall: the path round it is long
    const gap = place(game(makeBoard({ id: 'test.gap', walls: [{ a: { x: -12, z: 0 }, b: { x: 6, z: 0 } }] })), { A3: { x: 0, z: -2 }, B3: { x: 0, z: 2 } })
    expect(pathGap(gap, gap.fighters.A3!, gap.fighters.B3!)).toBeGreaterThan(8)
  })

  it('ZM-003 all doors start closed; a closed door blocks movement and line of sight and an open one does not', () => {
    const board = corridorWithDoor()
    const s = place(game(board), { A3: { x: 0, z: -1.5 }, B3: { x: 6, z: 3 } })
    expect(Object.values(s.board.doors).every((d) => d.state === 'closed')).toBe(true)
    let r = take(activate(s, 'A3').state, { action: 'move' })
    expect(step(r.state, act.path(r.pending!, [{ x: 0, z: 2 }])).rejection?.code).toBe('E_NO_PATH')
    // Operate Door (Simple) opens it, then the same path is legal
    r = activate(s, 'A3')
    expect(menuActions(r.state)).toContain('operateDoor')
    r = must(take(r.state, { action: 'operateDoor', doorId: 'door1' }))
    expect(r.state.board.doors.door1!.state).toBe('open')
    expect(eventsOf(r.events, 'DoorChanged')[0]).toMatchObject({ doorId: 'door1', state: 'open', locked: false })
    r = take(r.state, { action: 'move' })
    must(step(r.state, act.path(r.pending!, [{ x: 0, z: 2 }])))
  })

  it('Operate Door closes an open door as well, and only within 1 inch', () => {
    const board = corridorWithDoor()
    const open = edit(place(game(board), { A3: { x: 0, z: -1.5 }, A4: { x: 0, z: -6 } }), (d) => {
      d.board.doors.door1!.state = 'open'
    })
    const r = activate(open, 'A3')
    const opt = r.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'operateDoor')!
    expect(opt.data).toMatchObject({ to: 'close' })
    const far = activate(open, 'A4')
    expect(menuActions(far.state)).not.toContain('operateDoor')
    expect(step(far.state, act.choose(far.pending!, 'operateDoor', { doorId: 'door1' })).rejection?.code).toBe('E_OUT_OF_RANGE')
  })

  it('ZM-004 closing a door on a fighter in the doorway: an Initiative pass moves it up to 2 inches clear, a fail hits it (S3 D2) and then moves it clear', () => {
    const hits: HitSpec[] = []
    registerHitPort((_ctx, spec) => hits.push(spec))
    const board = corridorWithDoor()
    const open = edit(place(game(board), { A3: { x: 0, z: -1.5 }, B3: { x: 0, z: 0.1 } }), (d) => {
      d.board.doors.door1!.state = 'open'
    })
    // I 4+: a 5 passes
    const pass = must(take(activate(open, 'A3').state, { action: 'operateDoor' }, new ScriptedRng([5])))
    expect(pass.state.board.doors.door1!.state).toBe('closed')
    const moved = eventsOf(pass.events, 'FighterMoved').find((e) => e.fighterId === 'B3')!
    expect(moved.kind).toBe('doorPush')
    expect(moved.length).toBeLessThanOrEqual(2)
    expect(pass.state.fighters.B3!.pos.z).toBeGreaterThan(0.74)
    expect(hits).toHaveLength(0)
    // a natural 1 fails: the S3 Damage 2 hit goes to the attack code, then the fighter is moved clear
    const fail = must(take(activate(open, 'A3').state, { action: 'operateDoor' }, new ScriptedRng([1])))
    expect(hits).toEqual([{ targetId: 'B3', strength: 3, ap: 0, damage: 2, source: 'door' }])
    expect(fail.state.fighters.B3!.pos.z).toBeGreaterThan(0.74)
    expect(fail.state.fighters.B3!.location).toBe('board')
  })

  it('ZM-004 a fighter exactly in the middle of the doorway is moved to a random side, the free one', () => {
    const board = corridorWithDoor()
    const open = edit(place(game(board), { A3: { x: 0, z: -1.5 }, B3: { x: 0, z: 0 } }), (d) => {
      d.board.doors.door1!.state = 'open'
    })
    // the side die (1-3 = north first; 4-6 = south first, which A3 occupies), then the I test passes (5)
    for (const side of [2, 5]) {
      const r = must(take(activate(open, 'A3').state, { action: 'operateDoor' }, new ScriptedRng([side, 5])))
      expect(r.state.fighters.B3!.pos.z).toBeGreaterThan(0.74)
    }
  })

  it('ZM-005 a locked door rejects Operate Door from a non-defender; Access Terminal passes on an Int test at -2 and opens it from range', () => {
    const board = corridorWithDoor({ locked: true })
    const s = place(game(board), { A3: { x: -1.6, z: -1.6 }, A4: { x: 0, z: -1.5 } })
    expect(s.board.doors.door1!.locked).toBe(true)
    // next to the door but not a defender
    const near = activate(s, 'A4')
    expect(menuActions(near.state)).not.toContain('operateDoor')
    const denied = step(near.state, act.choose(near.pending!, 'operateDoor', { doorId: 'door1' }))
    expect(denied.rejection?.code).toBe('E_ACTION_RESTRICTED')
    expect(denied.state).toBe(near.state)
    // the terminal is 1 inch from A3's base; Int 7+ with -2 needs a total of 9
    const t = activate(s, 'A3')
    const opt = t.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'accessTerminal')!
    expect(opt.data).toMatchObject({ doorId: 'door1' })
    const failed = must(step(t.state, opt.action, new ScriptedRng([4, 4])))
    expect(failed.state.board.doors.door1).toMatchObject({ state: 'closed', locked: true })
    expect(eventsOf(failed.events, 'TerminalAccessed')).toHaveLength(1)
    const passed = must(step(t.state, opt.action, new ScriptedRng([4, 5])))
    expect(passed.state.board.doors.door1).toMatchObject({ state: 'open', locked: false })
    expect(eventsOf(passed.events, 'DoorChanged')[0]).toMatchObject({ doorId: 'door1', state: 'open', locked: false })
    // a 2 always fails, however good the modifier
    const two = must(step(t.state, opt.action, new ScriptedRng([1, 1])))
    expect(two.state.board.doors.door1!.state).toBe('closed')
  })

  it('ZM-005 a scenario defender holds the codes and can operate a locked door', () => {
    const board = corridorWithDoor({ locked: true })
    const s = edit(place(game(board), { A4: { x: 0, z: -1.5 } }), (d) => {
      d.players.A.role = 'defender'
    })
    const r = activate(s, 'A4')
    expect(menuActions(r.state)).toContain('operateDoor')
    const opened = must(take(r.state, { action: 'operateDoor', doorId: 'door1' }))
    expect(opened.state.board.doors.door1).toMatchObject({ state: 'open', locked: false })
  })

  it('ZM-006 Force Door opens on D6 + S >= 9, with +2 for each other friend in base contact with the door', () => {
    const board = corridorWithDoor({ locked: true })
    // S 3: a 6 is the only pass alone
    const alone = place(game(board), { A3: { x: 0, z: -1.5 } })
    const r = activate(alone, 'A3')
    const opt = r.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'forceDoor')!
    expect(opt.data).toMatchObject({ helpers: 0, need: 6 })
    expect((opt.data as { chance: number }).chance).toBeCloseTo(1 / 6)
    expect(must(step(r.state, opt.action, new ScriptedRng([5]))).state.board.doors.door1!.state).toBe('closed')
    const six = must(step(r.state, opt.action, new ScriptedRng([6])))
    expect(six.state.board.doors.door1).toMatchObject({ state: 'open', locked: false })
    // a friend touching the door adds 2: a 4 is enough
    const helped = place(game(board), { A3: { x: -0.6, z: -0.742 }, A4: { x: 0.6, z: -0.742 } })
    const h = activate(helped, 'A3')
    const hopt = h.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'forceDoor')!
    expect(hopt.data).toMatchObject({ helpers: 1, need: 4 })
    expect(must(step(h.state, hopt.action, new ScriptedRng([3]))).state.board.doors.door1!.state).toBe('closed')
    expect(must(step(h.state, hopt.action, new ScriptedRng([4]))).state.board.doors.door1!.state).toBe('open')
    // an enemy touching the door does not help
    const enemy = place(game(board), { A3: { x: -0.6, z: -0.742 }, B4: { x: 0.6, z: -0.742 } })
    const e = activate(enemy, 'A3')
    expect((e.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'forceDoor')!.data as { helpers: number }).helpers).toBe(0)
  })

  it('ZM-008 Crawl Through Ductway places the fighter within 1 inch of the far end, and is refused if every spot is within 1 inch of an enemy', () => {
    const board = ductwayWall()
    const s = place(game(board), { A3: { x: 0, z: -1.2, facing: 0 } })
    let r = activate(s, 'A3')
    const opt = r.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'crawlDuct')!
    const spot = (opt.action.payload as { spot: { x: number; z: number } }).spot
    expect(spot.z).toBeGreaterThan(0.7)
    expect(Math.hypot(spot.x - 0, spot.z - 0.3) - 0.492).toBeLessThanOrEqual(1 + 1e-9)
    r = must(step(r.state, opt.action))
    const f = r.state.fighters.A3!
    expect(f.pos).toMatchObject({ x: spot.x, z: spot.z })
    expect(f.facing).toBeCloseTo(0, 3)
    expect(eventsOf(r.events, 'DuctUsed')[0]).toMatchObject({ ductId: 'duct1', fighterId: 'A3' })
    expect(eventsOf(r.events, 'FighterMoved')[0]).toMatchObject({ kind: 'duct' })
    // a Double: the activation is over
    expect(r.pending).toMatchObject({ kind: 'action.activate', seat: 'B' })
    // an enemy right at the exit leaves no spot 1 inch clear of it
    const blocked = place(game(board), { A3: { x: 0, z: -1.2 }, B3: { x: 0, z: 1.0 } })
    const b = activate(blocked, 'A3')
    expect(menuActions(b.state)).not.toContain('crawlDuct')
    const rejected = step(b.state, act.choose(b.pending!, 'crawlDuct', { ductId: 'duct1', spot: { x: 0, z: 1 } }))
    expect(rejected.rejection).toBeDefined()
    // from the north side the duct works the other way
    const back = place(game(board), { A3: { x: 0, z: 1.2 } })
    const o = activate(back, 'A3').pending!.options!.find((x) => (x.action.payload as { action: string }).action === 'crawlDuct')!
    expect((o.action.payload as { spot: { z: number } }).spot.z).toBeLessThan(-0.7)
  })

  it('ZM-010 two enemies touching opposite sides of a barricade and within 1 inch of each other are Engaged', () => {
    const board = barricadePair()
    const s = place(game(board), { A3: { x: 0, z: -0.742 }, B3: { x: 0, z: 0.742 } })
    expect(computeEngagedWith(s, s.fighters.A3!)).toEqual(['B3'])
    expect(computeEngagedWith(s, s.fighters.B3!)).toEqual(['A3'])
    // the refresh runs after every step and stores the derived list
    const r = activate(s, 'A3')
    expect(r.state.fighters.A3!.engagedWith).toEqual(['B3'])
    expect(r.state.fighters.B3!.engagedWith).toEqual(['A3'])
    expect(eventsOf(r.events, 'EngagementChanged').map((e) => e.fighterId).sort()).toEqual(['A3', 'B3'])
    // not touching the barricade, or more than 1 inch apart: not Engaged
    const away = place(s, { B3: { x: 0, z: 0.742 + 0.3 } })
    expect(computeEngagedWith(away, away.fighters.A3!)).toEqual([])
    const tall = place(s, { B3: { x: 0, z: 0.742 + 0.6 } })
    expect(computeEngagedWith(tall, tall.fighters.A3!)).toEqual([])
    // two friends never engage, and the same positions without the barricade are not contact
    const friends = place(s, { B3: { x: 0, z: 0.742 } })
    expect(computeEngagedWith(friends, friends.fighters.B3!)).toEqual(['A3'])
    const open = place(game(openBox()), { A3: { x: 0, z: -0.742 }, B3: { x: 0, z: 0.742 } })
    expect(computeEngagedWith(open, open.fighters.A3!)).toEqual([])
    // plain base contact engages too; Pinned and Seriously Injured fighters never are
    const touch = place(open, { A3: { x: 0, z: -0.497 }, B3: { x: 0, z: 0.497 } })
    expect(computeEngagedWith(touch, touch.fighters.A3!)).toEqual(['B3'])
    const lying = place(touch, { B3: { x: 0, z: 0.497, posture: 'seriouslyInjured' } })
    expect(computeEngagedWith(lying, lying.fighters.A3!)).toEqual([])
    expect(computeEngagedWith(lying, lying.fighters.B3!)).toEqual([])
  })

  it('ZM-011 Smash Open succeeds on D6 + S >= 6 and applies -1 to the contents roll (minimum 1)', () => {
    const casketed = (extra: Parameters<typeof place>[1] = {}) =>
      edit(place(startGame().state, { A3: { x: 0, z: -10 }, ...extra }), (d) => {
        d.board.caskets.k1 = { pos: { x: 0, z: -8.5 }, state: 'closed', carriedBy: null }
      })
    const s = casketed()
    const r = activate(s, 'A3')
    const smash = r.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'smashCasket')!
    expect((smash.data as { contentsModifier: number }).contentsModifier).toBe(-1)
    // S 3: a roll of 2 is 5 and fails; the contents are not rolled
    const failed = must(step(r.state, smash.action, new ScriptedRng([2])))
    expect(failed.state.board.caskets.k1!.state).toBe('closed')
    expect(eventsOf(failed.events, 'CasketOpened')).toHaveLength(0)
    // 3 + 3 = 6 passes; contents 4 becomes 3 (nothing) instead of an ammo cache
    const opened = must(step(r.state, smash.action, new ScriptedRng([3, 4])))
    expect(eventsOf(opened.events, 'CasketOpened')[0]).toMatchObject({ casketId: 'k1', by: 'A3', roll: 4, result: 'nothing' })
    expect(opened.state.board.caskets.k1).toMatchObject({ state: 'opened', openedBy: 'A' })
    expect(opened.state.scenario.caskets.opened).toBe(1)
    // 5 - 1 = 4 is an ammo cache
    const cache = must(step(r.state, smash.action, new ScriptedRng([6, 5])))
    expect(cache.state.board.caskets.k1!.state).toBe('ammoCache')
    // a contents roll of 1 stays at 1 (booby trapped), never 0: the casket becomes a frag trap marker, and the opener, ending
    // its action within 2", rolls for it at once (4+: it goes off as a 5" Blast, S3 AP - D1 Knockback, through the attack code)
    const blasts: BlastSpec[] = []
    registerBlastPort((_ctx, spec) => blasts.push(spec))
    const trapped = must(step(r.state, smash.action, new ScriptedRng([6, 1, 4])))
    expect(eventsOf(trapped.events, 'CasketOpened')[0]).toMatchObject({ roll: 1, result: 'fragTrap' })
    expect(eventsOf(trapped.events, 'TrapTriggered')[0]).toMatchObject({ casketId: 'k1', fighterId: 'A3', roll: 4, result: 'exploded' })
    expect(blasts).toEqual([expect.objectContaining({ centre: { x: 0, z: -8.5 }, radius: 2.5, strength: 3, ap: 0, damage: 1, knockback: true })])
    expect(trapped.state.board.caskets.k1!.state).toBe('removed')
    // 2-3: the trap stays where it is (still counted as opened)
    const quiet = must(step(r.state, smash.action, new ScriptedRng([6, 1, 3])))
    expect(quiet.state.board.caskets.k1).toMatchObject({ state: 'fragTrap', checked: ['A3'] })
    expect(quiet.state.scenario.caskets.opened).toBe(1)
  })

  it('ZM-013 a frag trap rolls a D6 for a fighter ending an action within 2 inches, once per activation: 1 dud, 2-3 nothing, 4+ it explodes', () => {
    const blasts: BlastSpec[] = []
    registerBlastPort((_ctx, spec) => blasts.push(spec))
    const s = edit(place(startGame().state, { A3: { x: 0, z: -10, facing: 0 } }), (d) => {
      d.board.caskets.t1 = { pos: { x: 0, z: -7.5 }, state: 'fragTrap', carriedBy: null, checked: [] }
    })
    // already within 2" (edge to edge 2.5 - 0.492 - 0.5 = 1.508"): Aim ends an action there
    const r = activate(s, 'A3')
    const dud = must(take(r.state, { action: 'aim' }, new ScriptedRng([1])))
    expect(eventsOf(dud.events, 'TrapTriggered')[0]).toMatchObject({ roll: 1, result: 'dud' })
    expect(dud.state.board.caskets.t1!.state).toBe('removed')
    const quiet = must(take(r.state, { action: 'aim' }, new ScriptedRng([2])))
    expect(quiet.state.board.caskets.t1).toMatchObject({ state: 'fragTrap', checked: ['A3'] })
    // the same fighter does not roll for it again in this activation
    const again = must(take(quiet.state, { action: 'end' }))
    expect(eventsOf(again.events, 'TrapTriggered')).toHaveLength(0)
    const boom = must(take(r.state, { action: 'aim' }, new ScriptedRng([6])))
    expect(eventsOf(boom.events, 'TrapTriggered')[0]).toMatchObject({ result: 'exploded' })
    expect(blasts).toHaveLength(1)
    expect(boom.state.board.caskets.t1!.state).toBe('removed')
    // a fighter more than 2" away does not roll
    const far = edit(s, (d) => (d.board.caskets.t1!.pos = { x: 0, z: -6.9 }))
    const none = must(take(activate(far, 'A3').state, { action: 'aim' }))
    expect(eventsOf(none.events, 'TrapTriggered')).toHaveLength(0)
  })

  it('ZM-014 a move that comes within 2 inches of a frag trap stops there to roll; a blast that pins ends the move, a quiet roll lets it go on', () => {
    const s = edit(place(startGame().state, { A3: { x: 0, z: -12, facing: 0 } }), (d) => {
      d.board.caskets.t1 = { pos: { x: 2.5, z: -6 }, state: 'fragTrap', carriedBy: null, checked: [] }
    })
    const r = take(activate(s, 'A3').state, { action: 'move' })
    // 2-3: nothing happens and the move carries on to its end; no second roll when the action ends
    const on = must(moveTo(r.state, [{ x: 0, z: -7 }], 0, new ScriptedRng([3])))
    expect(eventsOf(on.events, 'TrapTriggered')).toHaveLength(1)
    const legs = eventsOf(on.events, 'FighterMoved')
    expect(legs).toHaveLength(2)
    const reach = 2 + on.state.fighters.A3!.baseRadius + 0.5 - 0.02 // just inside 2", touching the 5" Blast
    expect(Math.hypot(legs[0]!.to.x - 2.5, legs[0]!.to.z + 6)).toBeCloseTo(reach, 2)
    expect(on.state.fighters.A3!.pos).toMatchObject({ x: 0, z: -7 })
    // 4+: the trap explodes where the fighter was; the blast pins it and the move ends there (knockback 1, wound 1)
    const stopped = must(moveTo(r.state, [{ x: 0, z: -7 }], 0, new ScriptedRng([4, 1, 1])))
    expect(eventsOf(stopped.events, 'FighterMoved').filter((e) => e.fighterId === 'A3')).toHaveLength(1)
    const f = stopped.state.fighters.A3!
    expect(Math.hypot(f.pos.x - 2.5, f.pos.z + 6)).toBeCloseTo(reach, 2)
    expect(f.posture).toBe('pinned')
    expect(stopped.state.action.activation!.performed.map((p) => p.action)).toEqual(['move'])
  })

  it('ZM-015 a frag trap can be shot (-1 to hit at Short, -2 at Long); a hit rolls a D6: 1-2 nothing, 3-4 it explodes, 5-6 it is removed', () => {
    const blasts: BlastSpec[] = []
    registerBlastPort((_ctx, spec) => blasts.push(spec))
    const base = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 11, z: -6 } }, loadouts: { A3: { weapons: ['atk.w.plain'] } } })
    const withTrap = (at: { x: number; z: number }) =>
      activate(
        edit(base, (d) => {
          d.board.caskets.t1 = { pos: at, state: 'fragTrap', carriedBy: null, checked: [] }
        }),
        'A3',
      ).state
    const r = must(take(withTrap({ x: 0, z: 0 }), { action: 'shoot' }))
    const opt = r.pending!.options!.find((o) => o.id === 'trap:t1')!
    expect(opt.data).toMatchObject({ band: 'short' })
    expect((opt.data as { modifiers: { label: string; value: number }[] }).modifiers).toContainEqual({ label: 'fragTrap', value: -1 })
    const exploded = must(take(r.state, { trapId: 't1' }, dice(6, 3)))
    expect(eventsOf(exploded.events, 'TrapShot')[0]).toMatchObject({ casketId: 't1', roll: 3, result: 'exploded' })
    expect(blasts).toHaveLength(1)
    const disarmed = must(take(r.state, { trapId: 't1' }, dice(6, 5)))
    expect(eventsOf(disarmed.events, 'TrapShot')[0]).toMatchObject({ result: 'disarmed' })
    expect(disarmed.state.board.caskets.t1!.state).toBe('removed')
    const shrug = must(take(r.state, { trapId: 't1' }, dice(6, 2)))
    expect(shrug.state.board.caskets.t1!.state).toBe('fragTrap')
    // at Long range the modifier is -2
    const rf = must(take(withTrap({ x: 0, z: 10 }), { action: 'shoot' }))
    const longOpt = rf.pending!.options!.find((o) => o.id === 'trap:t1')!
    expect(longOpt.data).toMatchObject({ band: 'long' })
    expect((longOpt.data as { modifiers: { label: string; value: number }[] }).modifiers).toContainEqual({ label: 'fragTrap', value: -2 })
  })

  it('Bypass Lock opens a casket on an Int test with the contents roll unmodified', () => {
    const s = edit(place(startGame().state, { A3: { x: 0, z: -10 } }), (d) => {
      d.board.caskets.k1 = { pos: { x: 0, z: -8.5 }, state: 'closed', carriedBy: null }
    })
    const r = activate(s, 'A3')
    expect(menuActions(r.state)).toEqual(expect.arrayContaining(['smashCasket', 'bypassCasket', 'carryCasket']))
    const hacked = must(take(r.state, { action: 'bypassCasket' }, new ScriptedRng([4, 3, 4])))
    expect(eventsOf(hacked.events, 'CasketOpened')[0]).toMatchObject({ roll: 4, result: 'ammoCache' })
    const missed = must(take(r.state, { action: 'bypassCasket' }, new ScriptedRng([3, 3])))
    expect(missed.state.board.caskets.k1!.state).toBe('closed')
  })

  it('a scenario that lets only the attacker open caskets withholds Smash and Bypass from the defender', () => {
    const base = edit(place(startGame().state, { A3: { x: 0, z: -10 } }), (d) => {
      d.board.caskets.k1 = { pos: { x: 0, z: -8.5 }, state: 'closed', carriedBy: null }
      d.data = { ...d.data, scenario: { ...d.data.scenario, caskets: { openBy: 'attacker' } } }
      d.players.A.role = 'defender'
    })
    const r = activate(base, 'A3')
    expect(menuActions(r.state)).toContain('carryCasket')
    expect(menuActions(r.state)).not.toContain('smashCasket')
    expect(menuActions(r.state)).not.toContain('bypassCasket')
  })

  it('Carry Casket moves the casket with the fighter and puts it down in base contact', () => {
    const s = edit(place(startGame().state, { A3: { x: 0, z: -10, facing: 0 } }), (d) => {
      d.board.caskets.k1 = { pos: { x: 0, z: -8.5 }, state: 'closed', carriedBy: null }
    })
    let r = take(activate(s, 'A3').state, { action: 'carryCasket' })
    expect(r.pending!.constraints).toMatchObject({ kind: 'carry', maxInches: 5 })
    r = must(moveTo(r.state, [{ x: 3, z: -10 }], 0))
    const c = r.state.board.caskets.k1!
    const f = r.state.fighters.A3!
    expect(Math.hypot(c.pos.x - f.pos.x, c.pos.z - f.pos.z)).toBeCloseTo(0.492 + 0.5 + 0.01, 2)
    expect(eventsOf(r.events, 'CasketMoved')[0]).toMatchObject({ casketId: 'k1', carriedBy: 'A3' })
    expect(r.state.action.activation!.performed.map((p) => p.action)).toEqual(['carryCasket'])
  })

  it('a fighter within 1 inch of an ammo cache gets +2 to its Reload Ammo test, and a natural 6 exhausts the cache', () => {
    const s = edit(place(startGame().state, { A3: { x: 0, z: -10 } }), (d) => {
      d.board.caskets.k1 = { pos: { x: 0, z: -8.5 }, state: 'ammoCache', carriedBy: null }
      d.fighters.A3!.weapons[0]!.ammo = 'out'
    })
    const r = activate(s, 'A3')
    const opt = r.pending!.options!.find((o) => (o.action.payload as { action: string }).action === 'reload')!
    expect(opt.data).toMatchObject({ need: 4, bonus: 2 })
    const two = must(step(r.state, opt.action, new ScriptedRng([2])))
    expect(two.state.fighters.A3!.weapons[0]!.ammo).toBe('ok')
    expect(two.state.board.caskets.k1!.state).toBe('ammoCache')
    const six = must(step(r.state, opt.action, new ScriptedRng([6])))
    expect(six.state.board.caskets.k1!.state).toBe('exhausted')
    expect(offered(r.state)).toContain('end')
  })

  it('ZM-007 shooting a closed door auto-hits; at 0 of 4 W (T5) it is removed and its gap is open', () => {
    const s = edit(shootingGame({ board: 'test.door', spots: { A3: { x: 0, z: -4, facing: 0 }, B3: { x: 6, z: 6 } }, active: 'A3' }), (d) => {
      d.board.doors.door1!.wounds = 3 // three of its four Wounds already gone
    })
    let r = must(take(s, { action: 'shoot' }))
    const opt = r.pending!.options!.find((o) => o.id === 'door:door1')!
    expect(opt.data).toMatchObject({ auto: true })
    // no hit roll; the rifle's Firepower dice (2: one hole), then the wound roll against T5 (S4: 5+)
    r = must(take(r.state, { doorId: 'door1' }, dice(2, 5)))
    expect(eventsOf(r.events, 'HitRolled')[0]).toMatchObject({ dice: [], hit: true })
    expect(eventsOf(r.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'door1', need: 5, wounded: true })
    expect(eventsOf(r.events, 'DoorDamaged')[0]).toMatchObject({ doorId: 'door1', wounds: 0 })
    expect(eventsOf(r.events, 'DoorChanged')[0]).toMatchObject({ doorId: 'door1', state: 'destroyed' })
    expect(r.state.board.doors.door1!.state).toBe('destroyed')
    // the gap is open: a door that is gone is no longer offered as a target and lets sight through
    const after = edit(r.state, (d) => (d.fighters.B3!.pos = { x: 0, y: 0, z: 4 }))
    expect(query.losLine(after, 'A3', 'B3').los).toBe(true)
    // a miss on a damaged-but-standing door leaves it closed
    const fresh = must(take(edit(s, (d) => (d.board.doors.door1!.wounds = 0)), { action: 'shoot' }))
    const r2 = must(take(fresh.state, { doorId: 'door1' }, dice(2, 5)))
    expect(r2.state.board.doors.door1).toMatchObject({ state: 'closed', wounds: 1 })
  })

  it('ZM-009 Fire Through Ductway hits on 5+ regardless of BS; a template version hits all within 2 inches of the far end', () => {
    const spots = { A3: { x: 0, z: -1.2, facing: Math.PI }, B3: { x: 0, z: 1.5 }, B4: { x: 1.5, z: 1.5 }, B5: { x: 0, z: 4.5 } }
    const s = shootingGame({ board: 'test.duct', spots, loadouts: { A3: { weapons: ['atk.w.plain'] } }, active: 'A3' })
    expect(menuActions(s)).toContain('fireDuct')
    expect(menuActions(s)).not.toContain('shoot') // no line of sight through the wall
    let r = must(take(s, { action: 'fireDuct', ductId: 'duct1' }))
    expect(r.pending!.kind).toBe('shoot.target')
    expect(offered(r.state).sort()).toEqual(['t:B3'])
    // a 4 misses (BS 4+ would have hit), a 5 hits
    const miss = must(take(r.state, { targetId: 'B3' }, dice(4)))
    expect(eventsOf(miss.events, 'HitRolled')[0]).toMatchObject({ need: 5, hit: false })
    expect(eventsOf(miss.events, 'StrayShot')).toHaveLength(0)
    const hit = must(take(r.state, { targetId: 'B3' }, dice(5, 1)))
    expect(eventsOf(hit.events, 'HitRolled')[0]).toMatchObject({ need: 5, hit: true })
    expect(hit.state.fighters.B3!.posture).toBe('pinned')
    // a template through the duct: no target, no hit roll, everyone within 2" of the far end (Firepower 2, wounds 1, 1)
    const t = shootingGame({ board: 'test.duct', spots: { ...spots, A3: { x: 0, z: -1.2, facing: Math.PI } }, loadouts: { A3: { weapons: ['test.w.flamer'] } }, active: 'A3' })
    r = must(take(t, { action: 'fireDuct', ductId: 'duct1' }, dice(2, 1, 1)))
    expect(eventsOf(r.events, 'HitRolled')).toHaveLength(0)
    expect(eventsOf(r.events, 'WoundRolled').map((e) => e.targetId).sort()).toEqual(['B3', 'B4'])
    expect(r.state.fighters.B5!.posture).toBe('standing')
  })

  it('ZM-016 a Blast fired through a ductway may target a point within 1 inch of the far end, at 5+, and hits everyone under it there', () => {
    const spots = { A3: { x: 0, z: -1.2, facing: Math.PI }, B3: { x: 0, z: 1.5 }, B4: { x: 1.5, z: 1.5 }, B5: { x: 0, z: 4.5 } }
    const s = shootingGame({ board: 'test.duct', spots, loadouts: { A3: { weapons: ['atk.w.blast5'] } }, active: 'A3' })
    let r = must(take(s, { action: 'fireDuct', ductId: 'duct1' }))
    expect(offered(r.state).sort()).toEqual(['point', 't:B3'])
    r = must(take(r.state, { point: true }))
    expect(r.pending!.kind).toBe('shoot.aim')
    expect(r.pending!.context).toMatchObject({ within: { centre: { x: 0, z: 0.3 }, radius: 1 }, long: null })
    // more than 1" from the far end: refused; 0.7" from it: hit on a 5, B3 and B4 under the marker (wounds 1, 1)
    expect(step(r.state, act.aim(r.pending!, { x: 0, z: 2 })).rejection?.code).toBe('E_OUT_OF_RANGE')
    const hit = must(step(r.state, act.aim(r.pending!, { x: 0, z: 1 }), dice(5, 1, 1)))
    expect(eventsOf(hit.events, 'HitRolled')[0]).toMatchObject({ need: 5, hit: true })
    expect(eventsOf(hit.events, 'BlastPlaced')[0]).toMatchObject({ centre: { x: 0, z: 1 } })
    expect(eventsOf(hit.events, 'WoundRolled').map((e) => e.targetId).sort()).toEqual(['B3', 'B4'])
  })
})
