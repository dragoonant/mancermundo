import { describe, expect, it } from 'vitest'
import { act, createGame, query, step, suggest, validate, type GameState } from '@/engine'
import { fleeFighter, seriouslyInjure, takeOutOfAction } from '@/engine/casualties'
import { deploymentRects } from '@/engine/setup'
import { checkBattleEnd, securedBySeat } from '@/engine/scenarios'
import { freeSpaceTest, initialDoors, tileStrips } from '@/engine/board'
import { withinPath } from '@/engine/measure'
import { dice } from '../fixtures/attack'
import { edit, eventsOf, must, place, playOut, take } from '../fixtures/helpers'
import { realBundle, realSetup } from '../fixtures/real'
import { battle, draft, fighterWithRole, RICHES, seatWith, setupUntil, SMASH, TUNNEL } from '../fixtures/scenario'

const other = (s: 'A' | 'B') => (s === 'A' ? 'B' : 'A')

/** Everyone but `keep` on the board at a far corner spot, so nothing is within reach of anything (they stay on the board). */
function isolate(s: GameState, keep: Record<string, { x: number; z: number }>): GameState {
  return edit(s, (d) => {
    let k = 0
    for (const f of Object.values(d.fighters)) {
      if (f.location !== 'board') continue
      const at = keep[f.id]
      if (at) f.pos = { x: at.x, y: 0, z: at.z }
    }
    void k
  })
}

describe('SCEN: Tunnel Skirmish scoring and victory (M-2)', () => {
  it('SCEN-002 Tunnel Skirmish scores 3 / 2 / 1 for a Leader / Champion / other fighter Out of Action or fled; Seriously Injured scores nothing', () => {
    const s = battle({ scenarioId: TUNNEL })
    const leader = fighterWithRole(s, 'A', 'leader')
    const champion = fighterWithRole(s, 'A', 'champion')
    const ganger = fighterWithRole(s, 'A', 'ganger')
    const juve = fighterWithRole(s, 'A', 'juve')
    const { ctx } = draft(s)
    const b = () => ctx.state.players.B.points
    seriouslyInjure(ctx, ctx.state.fighters[leader]!, 'B1', 'test')
    expect(b()).toBe(0)
    takeOutOfAction(ctx, ctx.state.fighters[leader]!, 'B1', 'test')
    expect(b()).toBe(3)
    takeOutOfAction(ctx, ctx.state.fighters[champion]!, 'B1', 'test')
    expect(b()).toBe(5)
    takeOutOfAction(ctx, ctx.state.fighters[ganger]!, 'B1', 'test')
    expect(b()).toBe(6)
    // fleeing scores like going Out of Action
    fleeFighter(ctx, ctx.state.fighters[juve]!, false)
    expect(b()).toBe(7)
    expect(ctx.state.players.A.points).toBe(0)
    expect(eventsOf(ctx.events, 'PointsScored').map((e) => [e.seat, e.amount])).toEqual([
      ['B', 3],
      ['B', 2],
      ['B', 1],
      ['B', 1],
    ])
    expect(ctx.state.scenario.points).toEqual({ A: 0, B: 7 })
  })

  it('SCEN-002 the gang with more points wins, level points is a draw; fighters still Seriously Injured when the battle ends do not score', () => {
    const s = battle({ scenarioId: TUNNEL })
    const allDown = (points: [number, number]) =>
      draft(
        edit(s, (d) => {
          for (const f of Object.values(d.fighters)) if (f.seat === 'B' && f.location === 'board') f.posture = 'seriouslyInjured'
          d.players.A.points = points[0]
          d.players.B.points = points[1]
        }),
      )
    // B has only Seriously Injured fighters on the board: the battle is over, and they score nothing for A
    const win = allDown([8, 7])
    expect(checkBattleEnd(win.ctx)).toBe(true)
    expect(win.ctx.state.result).toMatchObject({ winner: 'A', reason: 'scenario', points: { A: 8, B: 7 } })
    const draw = allDown([7, 7])
    expect(checkBattleEnd(draw.ctx)).toBe(true)
    expect(draw.ctx.state.result).toMatchObject({ winner: 'draw' })
    const lose = allDown([3, 9])
    expect(checkBattleEnd(lose.ctx)).toBe(true)
    expect(lose.ctx.state.result).toMatchObject({ winner: 'B' })
    // a gang laid down Seriously Injured scores nothing for the other gang
    const { ctx } = draft(s)
    for (const f of Object.values(ctx.state.fighters)) if (f.seat === 'B' && f.location === 'board') seriouslyInjure(ctx, f, 'A1', 'test')
    expect(ctx.state.players.A.points).toBe(0)
    // both gangs standing: no end
    expect(checkBattleEnd(draft(s).ctx)).toBe(false)
  })
})

describe('SCEN: Smash & Grab (M-3)', () => {
  /** A casket 1.2" from a fighter of `seat` (a ganger), and every other fighter left where it was deployed (far away). */
  function withCasketBeside(s: GameState, seat: 'A' | 'B') {
    const caskets = Object.keys(s.board.caskets)
    const id = Object.values(s.fighters).find((f) => f.seat === seat && f.role === 'ganger' && f.location === 'board')!.id
    const c = s.board.caskets[caskets[0]!]!
    const state = place(s, { [id]: { x: c.pos.x + 1.2, z: c.pos.z } })
    return { state, casketId: caskets[0]!, fighterId: id, caskets }
  }
  const activateWith = (state: GameState, fighterId: string) => {
    let r = must(take(state, { fighterId }))
    if (r.pending!.kind === 'action.group') r = must(step(r.state, act.groupDone(r.pending!)))
    return r
  }

  it('SCEN-003 in Smash & Grab the defender cannot open a casket (it may carry one)', () => {
    const s0 = battle({ scenarioId: SMASH, attackerFirst: false })
    const def = seatWith(s0, 'defender')
    expect(s0.pending!.seat).toBe(def)
    const { state, casketId, fighterId } = withCasketBeside(s0, def)
    const r = activateWith(state, fighterId)
    const menu = r.pending!.options!.map((o) => o.id)
    expect(menu).toContain(`carryCasket:${casketId}`)
    expect(menu).not.toContain(`smashCasket:${casketId}`)
    expect(menu).not.toContain(`bypassCasket:${casketId}`)
    // the same casket beside an attacker: both opening actions are there
    const att = other(def)
    const s1 = battle({ scenarioId: SMASH })
    expect(s1.pending!.seat).toBe(att)
    const b = withCasketBeside(s1, att)
    const menuA = activateWith(b.state, b.fighterId).pending!.options!.map((o) => o.id)
    expect(menuA).toEqual(expect.arrayContaining([`smashCasket:${b.casketId}`, `bypassCasket:${b.casketId}`, `carryCasket:${b.casketId}`]))
  })

  it('SCEN-003 the attacker opening a third casket locks an attacker win; the winner is asked whether to play on', () => {
    const s0 = battle({ scenarioId: SMASH })
    const att = seatWith(s0, 'attacker')
    const { state, casketId, fighterId } = withCasketBeside(s0, att)
    const s = edit(state, (d) => {
      d.scenario.caskets.opened = 2
    })
    const r = activateWith(s, fighterId)
    // Smash Open: D6 + S >= 6 (a 6), then the contents roll 4 - 1 = 3: valuables
    const smash = must(step(r.state, r.pending!.options!.find((o) => o.id === `smashCasket:${casketId}`)!.action, dice(6, 4)))
    expect(eventsOf(smash.events, 'CasketOpened')).toEqual([expect.objectContaining({ casketId, by: fighterId, roll: 4, result: 'valuables' })])
    expect(smash.state.scenario.caskets.opened).toBe(3)
    expect(smash.state.board.caskets[casketId]!.state).toBe('removed')
    expect(eventsOf(smash.events, 'ResultLocked')).toEqual([expect.objectContaining({ winner: att, reason: 'caskets' })])
    expect(smash.state.scenario.locked).toMatchObject({ winner: att })
    // each opened casket scores for the attacker whatever it held
    expect(smash.state.players[att].points).toBe(1)
    // the battle does not end on the spot: the activation goes on, and at its end the winner is asked
    expect(smash.state.phase).toBe('action')
    const ended = must(step(smash.state, act.endActivation(smash.pending!)))
    expect(ended.pending).toMatchObject({ kind: 'confirm', seat: att })
    expect(ended.pending!.options!.map((o) => o.id)).toEqual(['continue', 'concede'])
    // play on: the other seat's turn carries on, and the question is not asked again
    const on = must(step(ended.state, act.confirm(ended.pending!, 'continue')))
    expect(on.pending!.kind).toBe('action.activate')
    expect(on.pending!.seat).toBe(other(att))
    expect(on.state.scenario.locked).toMatchObject({ winner: att, asked: true })
    // concede: the locked result ends the battle at once
    const done = must(step(ended.state, act.confirm(ended.pending!, 'concede')))
    expect(done.state.phase).toBe('ended')
    expect(done.state.result).toMatchObject({ winner: att, reason: 'concede' })
    expect(done.pending).toBeNull()
  })

  it('SCEN-003 a locked win holds to the normal end: fewer than three cracked and the defender wins, three or more and the attacker', () => {
    const s = battle({ scenarioId: SMASH })
    const att = seatWith(s, 'attacker')
    const def = other(att)
    const run = (opened: number) => {
      const d = draft(
        edit(s, (x) => {
          x.scenario.caskets.opened = opened
          for (const f of Object.values(x.fighters)) if (f.seat === att && f.location === 'board') f.posture = 'seriouslyInjured'
        }),
      )
      expect(checkBattleEnd(d.ctx)).toBe(true)
      return d.ctx.state.result!
    }
    expect(run(2)).toMatchObject({ winner: def, reason: 'scenario' })
    expect(run(3)).toMatchObject({ winner: att, reason: 'scenario' })
    expect(run(5)).toMatchObject({ winner: att })
  })

  it('SCEN-004 a Smash & Grab casket roll of 1 resolves a 5" S4 blast centred on it and still counts as opened', () => {
    const s0 = battle({ scenarioId: SMASH })
    const att = seatWith(s0, 'attacker')
    const { state, casketId, fighterId } = withCasketBeside(s0, att)
    const r = activateWith(state, fighterId)
    // smash 6 passes; the contents roll 1 (less 1, never below 1) is the booby trap; the opener stands under the marker: wound roll 1 fails
    const open = must(step(r.state, r.pending!.options!.find((o) => o.id === `smashCasket:${casketId}`)!.action, dice(6, 1, 1)))
    expect(eventsOf(open.events, 'CasketOpened')).toEqual([expect.objectContaining({ casketId, roll: 1, result: 'boobyTrap' })])
    expect(eventsOf(open.events, 'BlastPlaced')).toEqual([expect.objectContaining({ radius: 2.5 })])
    const wounds = eventsOf(open.events, 'WoundRolled')
    expect(wounds).toHaveLength(1)
    expect(wounds[0]).toMatchObject({ targetId: fighterId, roll: 1, wounded: false })
    expect(open.state.scenario.caskets.opened).toBe(1)
    expect(open.state.board.caskets[casketId]!.state).toBe('removed')
    expect(open.state.players[att].points).toBe(1)
    // the opener was pinned as by a ranged hit
    expect(eventsOf(open.events, 'FighterPinned').map((e) => e.fighterId)).toContain(fighterId)
  })

  it('SCEN-008 a gang that bottles voluntarily and then flees loses Smash & Grab outright', () => {
    const s = battle({ scenarioId: SMASH })
    const att = seatWith(s, 'attacker')
    const def = other(att)
    const t = edit(s, (d) => {
      d.players[def].bottled = true
      d.players[def].bottledVoluntarily = true
    })
    const { ctx } = draft(t)
    const f = Object.values(ctx.state.fighters).find((x) => x.seat === def && x.location === 'board')!
    fleeFighter(ctx, f, false)
    expect(ctx.state.phase).toBe('ended')
    expect(ctx.state.result).toMatchObject({ winner: att, reason: 'scenario' })
    expect(eventsOf(ctx.events, 'ResultLocked')).toEqual([expect.objectContaining({ winner: att, reason: 'bottledVoluntarily' })])
    // a gang that bottled by the dice just loses fighters
    const rolled = draft(
      edit(s, (d) => {
        d.players[def].bottled = true
      }),
    )
    fleeFighter(rolled.ctx, Object.values(rolled.ctx.state.fighters).find((x) => x.seat === def && x.location === 'board')!, false)
    expect(rolled.ctx.state.phase).not.toBe('ended')
  })

  it('SCEN-008 in Tunnel Skirmish a voluntary bottle and flight changes nothing: the fleeing fighters just score for the other gang', () => {
    const s = battle({ scenarioId: TUNNEL })
    const t = edit(s, (d) => {
      d.players.B.bottled = true
      d.players.B.bottledVoluntarily = true
    })
    const { ctx } = draft(t)
    const leader = fighterWithRole(t, 'B', 'leader')
    fleeFighter(ctx, ctx.state.fighters[leader]!, false)
    expect(ctx.state.phase).not.toBe('ended')
    expect(ctx.state.players.A.points).toBe(3)
  })
})

describe('SCEN: Forgotten Riches (M-4)', () => {
  it('SCEN-005 Forgotten Riches crew cap follows the 2D6 table: 2-3 five, 4-5 six, 6-8 seven, 9-10 eight, 11-12 nine (one roll for both gangs)', () => {
    const bundle = realBundle()
    const boardId = 'zm.b.hive-heart'
    const roll = (a: number, b: number) => {
      const created = createGame(realSetup({ scenarioId: RICHES, boardId, options: { autoCrew: true, autoCaskets: true, autoDeploy: true, firstPriority: 'A' } }), 'cap', bundle)
      const r = must(step(created.state, created.pending!.options![0]!.action, dice(a, b)))
      return { r, cap: eventsOf(r.events, 'CrewCapRolled')[0]!, crews: r.state.setup.crewPicks }
    }
    expect(roll(1, 1).cap).toMatchObject({ roll: 2, cap: 5 })
    expect(roll(1, 2).cap).toMatchObject({ roll: 3, cap: 5 })
    expect(roll(2, 2).cap).toMatchObject({ roll: 4, cap: 6 })
    expect(roll(3, 2).cap).toMatchObject({ roll: 5, cap: 6 })
    expect(roll(3, 3).cap).toMatchObject({ roll: 6, cap: 7 })
    expect(roll(4, 4).cap).toMatchObject({ roll: 8, cap: 7 })
    expect(roll(4, 5).cap).toMatchObject({ roll: 9, cap: 8 })
    expect(roll(5, 5).cap).toMatchObject({ roll: 10, cap: 8 })
    expect(roll(5, 6).cap).toMatchObject({ roll: 11, cap: 9 })
    expect(roll(6, 6).cap).toMatchObject({ roll: 12, cap: 9 })
    // one roll: both gangs field at most the cap, and the dice rolled once
    const seven = roll(3, 3)
    expect(seven.crews.A.length).toBeLessThanOrEqual(7)
    expect(seven.crews.B.length).toBeLessThanOrEqual(7)
    expect(eventsOf(seven.r.events, 'CrewCapRolled')).toHaveLength(1)
    expect(seven.r.state.scenario.crewCap).toBe(7)
  })

  it('SCEN-009 Forgotten Riches starts: five caskets are placed one per tile (the first in the centre), each gang picks a casket-free outer tile, and fighters set up within 3" of its outer edge', () => {
    const bundle = realBundle()
    for (const boardId of ['zm.b.hive-heart', 'zm.b.sump-warren']) {
      const created = createGame(realSetup({ scenarioId: RICHES, boardId }), 'tiles', bundle)
      expect(created.state.phase).toBe('setup')
      const s = battle({ scenarioId: RICHES, boardId })
      const def = s.board.def
      const caskets = Object.values(s.board.caskets)
      expect(caskets).toHaveLength(5)
      const tiles = caskets.map((c) => def.tiles.findIndex((t) => Math.abs(c.pos.x - t.centre.x) <= 6 && Math.abs(c.pos.z - t.centre.z) <= 6))
      expect(new Set(tiles).size).toBe(5)
      expect(def.tiles[tiles[0]!]!.centre).toEqual({ x: 0, z: 0 })
      for (const c of caskets) {
        expect(c.state).toBe('closed')
        for (const o of caskets) if (o !== c) expect(Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z)).toBeGreaterThanOrEqual(6 - 1e-9)
      }
      // the deployment tiles hold no casket, are different, and every fighter is inside their strips
      const picks = s.scenario.deployTiles
      expect(picks.A).toBeDefined()
      expect(picks.B).toBeDefined()
      expect(picks.A).not.toBe(picks.B)
      for (const seat of ['A', 'B'] as const) {
        const i = def.tiles.findIndex((t) => t.id === picks[seat])
        expect(tiles).not.toContain(i)
        const strips = tileStrips(def, i, 3)
        expect(deploymentRects(s, seat)).toEqual(strips)
        for (const f of Object.values(s.fighters)) {
          if (f.seat !== seat || f.location !== 'board') continue
          const inside = strips.some((r) => f.pos.x - f.baseRadius >= r[0]!.x - 1e-6 && f.pos.x + f.baseRadius <= r[1]!.x + 1e-6 && f.pos.z - f.baseRadius >= r[0]!.z - 1e-6 && f.pos.z + f.baseRadius <= r[2]!.z + 1e-6)
          expect(inside, `${f.id} on ${boardId}`).toBe(true)
        }
      }
    }
  })

  it('SCEN-009 by hand: setup.casket enforces the centre tile first, a different tile each, 6" apart (no edge distance); setup.zone offers only casket-free tiles', () => {
    const bundle = realBundle()
    const boardId = 'zm.b.hive-heart'
    const created = createGame(realSetup({ scenarioId: RICHES, boardId, options: { autoCrew: true } }), 'manual', bundle)
    let s = setupUntil(created.state, (x) => x.pending!.kind === 'setup.casket')
    const first = s.pending!
    expect(first.constraints).toMatchObject({ kind: 'casket' })
    expect(first.context).toMatchObject({ index: 1, of: 5, minFromEdge: 0, minApart: 6 })
    expect(first.context.suggestion).toBeDefined()
    // not in the centre tile: refused; centre of the board: fine
    const off = step(s, act.casket(first, 6, 12))
    expect(off.rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(off.state).toBe(s)
    const ok = must(step(s, act.casket(first, 0, 0)))
    expect(ok.state.board.caskets.c1!.pos).toEqual({ x: 0, z: 0 })
    s = ok.state
    // the other seat places the second casket (alternating), in a tile of its own
    expect(s.pending!.seat).not.toBe(first.seat)
    expect(step(s, act.casket(s.pending!, 1, 1)).rejection?.code).toBe('E_OUT_OF_RANGE')
    // Forgotten Riches sets no distance from the board edge: only the outer wall itself keeps a casket off the very edge
    const edgeSpot = step(s, act.casket(s.pending!, -11.5, -17.5))
    expect(edgeSpot.rejection?.reason ?? '').not.toMatch(/from every board edge/)
    // play the rest with the engine's spots, then the tile choice
    s = setupUntil(s, (x) => x.pending!.kind === 'setup.zone')
    expect(Object.keys(s.board.caskets)).toHaveLength(5)
    const zone = s.pending!
    expect(zone.seat).toBe(s.setup.first)
    const withCasket = new Set(Object.values(s.board.caskets).map((c) => s.board.def.tiles.findIndex((t) => Math.abs(c.pos.x - t.centre.x) <= 6 && Math.abs(c.pos.z - t.centre.z) <= 6)))
    for (const o of zone.options!) {
      const i = s.board.def.tiles.findIndex((t) => t.id === (o.action.payload as { zoneId: string }).zoneId)
      expect(withCasket.has(i)).toBe(false)
    }
    // a tile with a casket is not an option
    const bad = step(s, act.zone(zone, s.board.def.tiles[3]!.id))
    expect(bad.rejection?.code).toBe('E_NOT_AN_OPTION')
  })

  it('SCEN-010 when the two deployment tiles touch no fighter may be set up within 6" of an enemy', () => {
    const bundle = realBundle()
    const created = createGame(realSetup({ scenarioId: RICHES, boardId: 'zm.b.sump-warren', options: { autoCrew: true, autoCaskets: true } }), 'touch', bundle)
    let s = setupUntil(created.state, (x) => x.pending!.kind === 'setup.zone')
    const def = s.board.def
    const touching = (x: string, y: string) => {
      const ta = def.tiles.find((t) => t.id === x)!
      const tb = def.tiles.find((t) => t.id === y)!
      return Math.abs(ta.centre.x - tb.centre.x) <= 12 && Math.abs(ta.centre.z - tb.centre.z) <= 12
    }
    const ids = s.pending!.options!.map((o) => (o.action.payload as { zoneId: string }).zoneId)
    expect(ids).toHaveLength(2)
    expect(touching(ids[0]!, ids[1]!)).toBe(true) // the sump warren's two free tiles touch
    s = must(step(s, act.zone(s.pending!, ids[0]!))).state
    // the first gang deploys by suggestion, then the second gang's strip is probed next to one of the first gang's fighters
    s = setupUntil(s, (x) => x.pending!.kind === 'setup.deploy' && x.pending!.seat !== x.setup.first)
    const seat = s.pending!.seat
    const rect = deploymentRects(s, seat)[0]!
    const id = s.pending!.constraints!.fighterIds![0]!
    const f = s.fighters[id]!
    // a legal spot inside the strip (walls and obstacles are left alone), found with the enemies out of the way
    const cleared = edit(s, (d) => {
      for (const e of Object.values(d.fighters)) if (e.seat !== seat && e.location === 'board') e.pos = { x: 0, y: 0, z: 0 }
    })
    let spot: { x: number; z: number } | null = null
    for (let x = rect[0]!.x + f.baseRadius; x <= rect[1]!.x - f.baseRadius && !spot; x += 0.5) {
      for (let z = rect[0]!.z + f.baseRadius; z <= rect[2]!.z - f.baseRadius && !spot; z += 0.5) {
        if (!validate(cleared, act.deploy(cleared.pending!, id, x, z, 0))) spot = { x, z }
      }
    }
    expect(spot).not.toBeNull()
    const enemyId = Object.values(s.fighters).find((x) => x.seat !== seat && x.location === 'board')!.id
    // one enemy at the probed gap; the rest of that gang is taken off the board so only the one gap is measured
    const at = (gap: number) =>
      edit(s, (d) => {
        for (const e of Object.values(d.fighters)) if (e.seat !== seat && e.id !== enemyId && e.location === 'board') e.location = 'reserve'
        d.fighters[enemyId]!.pos = { x: spot!.x + gap + f.baseRadius + d.fighters[enemyId]!.baseRadius, y: 0, z: spot!.z }
      })
    const near = at(5.9)
    const refused = step(near, act.deploy(near.pending!, id, spot!.x, spot!.z, 0))
    expect(refused.rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(refused.rejection?.reason).toMatch(/touch/)
    // 6" of clear space between the bases is fine
    const ok = at(6.05)
    expect(step(ok, act.deploy(ok.pending!, id, spot!.x, spot!.z, 0)).rejection).toBeUndefined()
    // the engine's own deploy spot keeps the 6" too
    const sug = suggest(near, near.pending)!
    expect(validate(near, sug)).toBeNull()
    const p = (sug as { payload: { x: number; z: number } }).payload
    const enemy = near.fighters[enemyId]!
    expect(Math.hypot(enemy.pos.x - p.x, enemy.pos.z - p.z) - enemy.baseRadius - f.baseRadius).toBeGreaterThanOrEqual(6 - 1e-6)
  })

  /** A free spot more than 8" (by path) from every fighter, and one within 3" of it (both free), for the lone fighter `lone`. */
  function loneAndNear(s: GameState, lone: string) {
    const def = s.board.def
    const free = freeSpaceTest(def, initialDoors(def), 0.7)
    const others = Object.values(s.fighters).filter((f) => f.location === 'board' && f.id !== lone)
    const r = s.fighters[lone]!.baseRadius
    const disc = (x: number, z: number) => ({ pos: { x, z }, baseRadius: r })
    for (let x = def.bounds.minX + 1; x <= def.bounds.maxX - 1; x += 1.5) {
      for (let z = def.bounds.minZ + 1; z <= def.bounds.maxZ - 1; z += 1.5) {
        if (!free({ x, z }) || others.some((o) => withinPath(s, disc(x, z), o, 8))) continue
        const near = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => ({ x: x + dx!, z: z + dz! })).find((p) => free(p) && withinPath(s, disc(x, z), { pos: p, baseRadius: r }, 3))
        if (near) return { spot: { x, z }, near }
      }
    }
    throw new Error('no lone spot on the board')
  }

  it('SCEN-006 Horrors in the Dark triggers only for a fighter activating more than 8" from every other fighter; a 1 that leaves it Seriously Injured removes it', () => {
    const s0 = battle({ scenarioId: RICHES })
    const seat = s0.pending!.seat
    const lone = Object.values(s0.fighters).find((f) => f.seat === seat && f.role === 'ganger' && f.location === 'board')!.id
    const { spot, near } = loneAndNear(s0, lone)
    // the lone fighter far from everyone, unarmoured with 2 Wounds
    const state = edit(s0, (d) => {
      const l = d.fighters[lone]!
      l.pos = { x: spot.x, y: 0, z: spot.z }
      l.wargear = []
      l.wounds = 2
      l.maxWounds = 2
    })
    // 1: S6 AP-1 Damage 2 hit (wound roll 6, no save), 0 Wounds, Injury die 3 = Seriously Injured: dragged off, Out of Action
    const hit = must(take(state, { fighterId: lone }, dice(1, 6, 3)))
    expect(eventsOf(hit.events, 'HorrorsInTheDark')).toEqual([expect.objectContaining({ fighterId: lone, roll: 1, result: 'dragged' })])
    expect(hit.state.fighters[lone]!.location).toBe('outOfAction')
    expect(eventsOf(hit.events, 'ActivationEnded').map((e) => e.fighterId)).toContain(lone)
    expect(hit.pending!.kind).toBe('action.activate')
    // 2-3: no actions this activation; 4-5: one action; 6: normal
    const none = must(take(state, { fighterId: lone }, dice(2)))
    expect(eventsOf(none.events, 'HorrorsInTheDark')[0]).toMatchObject({ roll: 2, result: 'noActions' })
    expect(eventsOf(none.events, 'ActivationEnded')[0]).toMatchObject({ fighterId: lone, actionsUsed: 0 })
    const one = must(take(state, { fighterId: lone }, dice(5)))
    expect(one.pending!.kind).toBe('action.choose')
    expect(one.state.action.activation).toMatchObject({ actionsLeft: 1, allowance: 1 })
    const normal = must(take(state, { fighterId: lone }, dice(6)))
    expect(normal.state.action.activation).toMatchObject({ actionsLeft: 2 })
    // a fighter within 8" of any other fighter (here a Seriously Injured enemy) does not roll
    const close = edit(state, (d) => {
      const e = Object.values(d.fighters).find((f) => f.seat !== seat && f.location === 'board')!
      e.pos = { x: near.x, y: 0, z: near.z }
      e.posture = 'seriouslyInjured'
    })
    const quiet = must(take(close, { fighterId: lone }, dice()))
    expect(eventsOf(quiet.events, 'HorrorsInTheDark')).toHaveLength(0)
    expect(quiet.pending!.kind).toBe('action.choose')
    // not in Tunnel Skirmish
    const t = battle({ scenarioId: TUNNEL })
    const tl = Object.values(t.fighters).find((f) => f.seat === t.pending!.seat && f.location === 'board')!.id
    const far = loneAndNear(t, tl)
    const away = edit(t, (d) => {
      d.fighters[tl]!.pos = { x: far.spot.x, y: 0, z: far.spot.z }
    })
    expect(eventsOf(must(take(away, { fighterId: tl }, dice())).events, 'HorrorsInTheDark')).toHaveLength(0)
  })

  /** Riches state with the five caskets put at chosen spots for the tally. */
  function tally() {
    const s = battle({ scenarioId: RICHES })
    const def = s.board.def
    const strip = (seat: 'A' | 'B') => deploymentRects(s, seat)[0]!
    const inside = (r: ReturnType<typeof strip>, dx: number, dz: number) => ({ x: (r[0]!.x + r[1]!.x) / 2 + dx, z: (r[0]!.z + r[2]!.z) / 2 + dz })
    return { s, def, strip, inside }
  }

  it('SCEN-007 Forgotten Riches counts a casket only if it ends on the owner\'s deployment tile within 3" of the board edge (loot only, not an ammo cache)', () => {
    const { s, strip, inside } = tally()
    const a = strip('A')
    const b = strip('B')
    const t = edit(s, (d) => {
      const ids = Object.keys(d.board.caskets)
      d.board.caskets[ids[0]!]!.pos = inside(a, 0, 0) // A's strip: secured
      d.board.caskets[ids[1]!]!.pos = inside(a, 0.5, 0)
      d.board.caskets[ids[1]!]!.state = 'ammoCache' // an ammo cache is no loot
      d.board.caskets[ids[2]!]!.pos = inside(b, 0, 0) // B's strip: secured for B
      d.board.caskets[ids[3]!]!.pos = { x: 0, z: 0 } // the middle of the board: nobody's
      d.board.caskets[ids[4]!]!.pos = inside(b, 0, 0.6)
      d.board.caskets[ids[4]!]!.state = 'opened' // opened but not a cache: still loot
    })
    expect(securedBySeat(t)).toEqual({ A: 1, B: 2 })
    expect(query.scenarioView(t).secured).toEqual({ A: 1, B: 2 })
    expect(query.scenarioView(t).leading).toBe('B')
    // 3.5" from the edge of the tile is outside the strip: not secured
    const deep = edit(t, (d) => {
      const ids = Object.keys(d.board.caskets)
      const r = deploymentRects(d, 'A')[0]!
      d.board.caskets[ids[0]!]!.pos = { x: (r[0]!.x + r[1]!.x) / 2, z: r[0]!.z < 0 ? r[0]!.z + 4.2 : r[2]!.z - 4.2 }
    })
    expect(securedBySeat(deep).A).toBe(0)
  })

  it('SCEN-007 at the end of the battle the gang with the most secured caskets wins, 2 points each, D3 for the last gang standing; level caskets is a draw', () => {
    const { s, strip, inside } = tally()
    const a = strip('A')
    const b = strip('B')
    const place5 = (aCaskets: number, bCaskets: number) =>
      edit(s, (d) => {
        const ids = Object.keys(d.board.caskets)
        ids.forEach((id, k) => {
          const c = d.board.caskets[id]!
          if (k < aCaskets) c.pos = inside(a, (k % 3) - 1, 0)
          else if (k < aCaskets + bCaskets) c.pos = inside(b, (k % 3) - 1, 0)
          else c.pos = { x: 0, z: 0 }
        })
        // B is gone: A is the last gang standing
        for (const f of Object.values(d.fighters)) if (f.seat === 'B' && f.location === 'board') f.location = 'outOfAction'
      })
    const end = (aC: number, bC: number, d3: number) => {
      const dr = draft(place5(aC, bC), [d3 === 1 ? 1 : d3 === 2 ? 3 : 5])
      expect(checkBattleEnd(dr.ctx)).toBe(true)
      return dr.ctx.state
    }
    const won = end(2, 1, 3)
    expect(won.result).toMatchObject({ winner: 'A', reason: 'scenario', caskets: { A: 2, B: 1 } })
    // A: 2 caskets x 2 points + D3 (a die of 5 is 3) for being the last gang standing
    expect(won.players.A.points).toBe(2 * 2 + 3)
    expect(won.players.B.points).toBe(1 * 2)
    // points do not decide it: B holds more caskets than A and wins although A is the only gang left
    const lost = end(1, 2, 1)
    expect(lost.result).toMatchObject({ winner: 'B', caskets: { A: 1, B: 2 } })
    expect(lost.players.A.points).toBeGreaterThan(0)
    // equal caskets: a draw
    expect(end(1, 1, 1).result).toMatchObject({ winner: 'draw' })
    expect(end(0, 0, 2).result).toMatchObject({ winner: 'draw' })
  })

  it('SCEN-008 a gang that bottles voluntarily and then flees loses Forgotten Riches outright; the other gang claims the caskets on the board', () => {
    const s = battle({ scenarioId: RICHES })
    const t = edit(s, (d) => {
      d.players.A.bottled = true
      d.players.A.bottledVoluntarily = true
    })
    const { ctx } = draft(t)
    fleeFighter(ctx, Object.values(ctx.state.fighters).find((f) => f.seat === 'A' && f.location === 'board')!, true)
    expect(ctx.state.phase).toBe('ended')
    expect(ctx.state.result).toMatchObject({ winner: 'B', reason: 'scenario', caskets: { A: 0, B: 5 } })
  })
})

describe('SCEN: set-up by hand (M-3.4)', () => {
  it('SCEN-011 Smash & Grab: the defender places 5 caskets in its own half, 4" from every edge, not overlapping, clear of walls, before anyone deploys', () => {
    const bundle = realBundle()
    const created = createGame(realSetup({ scenarioId: SMASH, options: { autoCrew: true } }), 'sg', bundle)
    let s = setupUntil(created.state, (x) => x.pending!.kind === 'setup.casket')
    const def = s.players[s.pending!.seat].role
    expect(def).toBe('defender')
    const pending = s.pending!
    const half = s.setup.zoneChoices[pending.seat]
    expect(half).toBeDefined()
    const sign = half === 'low' ? -1 : 1
    expect(pending.context).toMatchObject({ index: 1, of: 5, minFromEdge: 4, minApart: 0 })
    // the enemy's half, too close to the edge, or off the half line: refused
    expect(step(s, act.casket(pending, 0, -sign * 8)).rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(step(s, act.casket(pending, 11, sign * 8)).rejection?.reason).toMatch(/edge/)
    const spot = pending.context.suggestion as { x: number; z: number }
    s = must(step(s, act.casket(pending, spot.x, spot.z))).state
    // no spacing rule (only the defender's zone and 4" from the edge): a casket may sit next to another, never on top of it
    expect(step(s, act.casket(s.pending!, spot.x + 0.5, spot.z)).rejection?.code).toBe('E_OVERLAP')
    const near = [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].map(([dx, dz]) => step(s, act.casket(s.pending!, spot.x + dx!, spot.z + dz!)).rejection)
    expect(near.some((r) => r === undefined)).toBe(true)
    // all five are the defender's, and deployment begins afterwards
    s = setupUntil(s, (x) => x.pending!.kind === 'setup.deploy')
    expect(Object.keys(s.board.caskets)).toHaveLength(5)
    for (const c of Object.values(s.board.caskets)) {
      expect(Math.sign(c.pos.z)).toBe(sign)
      expect(c.state).toBe('closed')
    }
    expect(s.pending!.seat).toBe(s.setup.first)
  })
})
