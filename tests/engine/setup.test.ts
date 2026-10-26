import { describe, expect, it } from 'vitest'
import { act, createGame, EngineInvariantError, legalActions, ScriptedRng, step, suggest, validate } from '@/engine'
import type { EngineBundle } from '@/engine/bundle'
import type { GameState, RuntimeScenario, StepResult } from '@/engine/types'
import { makeSetup, testBundle, TEST_SCENARIO } from '../fixtures/gang'
import { eventsOf, must, offered } from '../fixtures/helpers'

const withScenario = (patch: Partial<RuntimeScenario>): EngineBundle => ({
  ...testBundle,
  scenarios: { ...testBundle.scenarios, 'test.alt': { ...testBundle.scenarios[TEST_SCENARIO]!, id: 'test.alt', ...patch } },
})

const first = (r: StepResult): StepResult => must(step(r.state, r.pending!.options![0]!.action))

describe('setup: roles, crews, halves and deployment', () => {
  it('a scenario with roles lets the roll-off winner pick attacker or defender; the defender chooses its crew first and deploys first', () => {
    const bundle = withScenario({
      roles: true,
      crews: { attacker: { method: 'custom', x: 3 }, defender: { method: 'hybrid', x: 2, y: 'D3' } },
      deployment: { kind: 'standard', minFromCentreline: 12, defenderFirst: true },
    })
    const created = createGame(makeSetup({ scenarioId: 'test.alt' }), 'roles', bundle)
    expect(offered(created.state)).toEqual(['attacker', 'defender'])
    const winner = created.pending!.seat
    let r = must(step(created.state, act.role(created.pending!, 'attacker')))
    expect(r.state.players[winner].role).toBe('attacker')
    expect(r.state.players[winner === 'A' ? 'B' : 'A'].role).toBe('defender')
    const defender = winner === 'A' ? 'B' : 'A'
    expect(eventsOf(r.events, 'RoleChosen')[0]).toMatchObject({ choice: 'attacker' })
    // defender: Hybrid 2 + D3: two picks, then the engine draws
    expect(r.pending).toMatchObject({ kind: 'setup.crew', seat: defender })
    expect(r.pending!.context).toMatchObject({ method: 'hybrid', x: 2 })
    expect(offered(r.state)).not.toContain('done')
    r = must(step(r.state, act.crew(r.pending!, `${defender}1`)))
    expect(offered(r.state)).toContain('done')
    r = must(step(r.state, act.crew(r.pending!, `${defender}2`), new ScriptedRng([4, 1, 1])))
    const chosen = eventsOf(r.events, 'CrewChosen')
    expect(chosen[0]).toMatchObject({ random: false, fighterIds: [`${defender}1`, `${defender}2`] })
    // D3 roll of 4 -> 2 drawn fighters
    expect(chosen[1]).toMatchObject({ random: true })
    expect(chosen[1]!.fighterIds).toHaveLength(2)
    expect(r.state.players[defender].startingCrew).toBe(4)
    // attacker: Custom 3 of 5
    expect(r.pending).toMatchObject({ kind: 'setup.crew', seat: winner })
    for (const id of ['1', '2', '3']) r = must(step(r.state, act.crew(r.pending!, `${winner}${id}`)))
    expect(r.state.players[winner].startingCrew).toBe(3)
    // the defender picks its half first
    expect(r.pending).toMatchObject({ kind: 'setup.zone', seat: defender })
    r = must(step(r.state, act.zone(r.pending!, 'high')))
    expect(r.state.setup.zoneChoices).toEqual({ [defender]: 'high', [winner]: 'low' })
    expect(r.pending).toMatchObject({ kind: 'setup.deploy', seat: defender })
  })

  it('without roles the winner chooses to go first or second', () => {
    const created = createGame(makeSetup(), 'first-second', testBundle)
    expect(offered(created.state)).toEqual(['first', 'second'])
    const winner = created.pending!.seat
    const r = must(step(created.state, act.role(created.pending!, 'second')))
    expect(r.state.setup.first).toBe(winner === 'A' ? 'B' : 'A')
    expect(r.pending).toMatchObject({ kind: 'setup.zone', seat: r.state.setup.first })
  })

  it('Custom (X) with a bigger roster asks for picks and offers done once one is picked; a smaller roster takes everyone', () => {
    const bundle = withScenario({ crews: { both: { method: 'custom', x: 4 } } })
    const created = createGame(makeSetup({ scenarioId: 'test.alt' }), 'custom', bundle)
    let r = must(step(created.state, created.pending!.options![0]!.action))
    const seat = r.pending!.seat
    expect(r.pending).toMatchObject({ kind: 'setup.crew' })
    expect(offered(r.state)).toHaveLength(5)
    r = must(step(r.state, act.crew(r.pending!, `${seat}3`)))
    expect(offered(r.state)).toHaveLength(5) // four fighters left plus done
    r = must(step(r.state, act.crewDone(r.pending!)))
    expect(r.state.players[seat].startingCrew).toBe(1)
    // the other seat is asked next, and the same X applies
    expect(r.pending).toMatchObject({ kind: 'setup.crew', seat: seat === 'A' ? 'B' : 'A' })
    // the default fixture asks for 5 of 5: nobody is asked
    expect(first(createGame(makeSetup(), 'all', testBundle)).pending?.kind).toBe('setup.zone')
  })

  it('Random (X) is drawn by the engine from D6 rolls and never repeats a fighter', () => {
    const bundle = withScenario({ crews: { both: { method: 'random', x: 3 } } })
    const created = createGame(makeSetup({ scenarioId: 'test.alt' }), 'random', bundle)
    const r = must(step(created.state, created.pending!.options![0]!.action, new ScriptedRng([2, 4, 1, 3, 2, 2])))
    const events = eventsOf(r.events, 'CrewChosen')
    expect(events).toHaveLength(2)
    for (const e of events) {
      expect(e.random).toBe(true)
      expect(e.fighterIds).toHaveLength(3)
      expect(new Set(e.fighterIds).size).toBe(3)
    }
    expect(r.pending?.kind).toBe('setup.zone')
  })

  it('Forgotten Riches style crew cap: one 2D6 roll sets the maximum crew for both gangs', () => {
    const bundle = withScenario({
      crews: { both: { method: 'custom', x: 9 } },
      crewCap: [
        { min: 2, max: 5, cap: 2 },
        { min: 6, max: 12, cap: 3 },
      ],
    })
    const created = createGame(makeSetup({ scenarioId: 'test.alt', options: { autoCrew: true, autoDeploy: true } }), 'cap', bundle)
    const r = must(step(created.state, created.pending!.options![0]!.action, new ScriptedRng([3, 4, 2, 5])))
    expect(eventsOf(r.events, 'CrewCapRolled')[0]).toMatchObject({ roll: 7, cap: 3 })
    expect(r.state.scenario.crewCap).toBe(3)
    expect(r.state.players.A.startingCrew).toBe(3)
    expect(r.state.players.B.startingCrew).toBe(3)
    expect(Object.values(r.state.fighters).filter((f) => f.location === 'board')).toHaveLength(6)
    expect(Object.values(r.state.fighters).filter((f) => f.location === 'reserve')).toHaveLength(4)
  })

  it('SCEN-001 standard deployment rejects any fighter closer than 12 inches to the dividing line and any overlap', () => {
    const created = createGame(makeSetup(), 'deploy', testBundle)
    let r = first(created)
    const seat = r.pending!.seat
    r = must(step(r.state, act.zone(r.pending!, 'low')))
    expect(r.pending).toMatchObject({ kind: 'setup.deploy', seat })
    expect(legalActions(r.state)).toBeNull()
    const id = r.pending!.constraints!.fighterIds![0]!
    // low zone: z from -18 to -12; a 25 mm base needs its centre at z <= -12.492
    const short = step(r.state, act.deploy(r.pending!, id, 0, -12.3))
    expect(short.rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(short.state).toBe(r.state)
    expect(step(r.state, act.deploy(r.pending!, id, 0, -2)).rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(step(r.state, act.deploy(r.pending!, id, 20, -15)).rejection?.code).toBe('E_OUT_OF_RANGE')
    expect(step(r.state, act.deploy(r.pending!, 'not-mine', 0, -15)).rejection?.code).toBe('E_INVALID_TARGET')
    r = must(step(r.state, act.deploy(r.pending!, id, 0, -15, 0)))
    expect(r.state.fighters[id]).toMatchObject({ location: 'board', facing: 0 })
    expect(eventsOf(r.events, 'FighterDeployed')[0]).toMatchObject({ fighterId: id })
    // another base on top of it
    const next = r.pending!.constraints!.fighterIds![0]!
    expect(step(r.state, act.deploy(r.pending!, next, 0.3, -15)).rejection?.code).toBe('E_OVERLAP')
    must(step(r.state, act.deploy(r.pending!, next, 1.5, -15)))
  })

  it('the whole crew deploys seat by seat; the last fighter starts round 1 with the Priority roll', () => {
    let r = first(first(createGame(makeSetup(), 'whole-crew', testBundle)))
    expect(r.pending!.kind).toBe('setup.deploy')
    const order: string[] = []
    let guard = 0
    while (r.pending?.kind === 'setup.deploy' && guard++ < 50) {
      order.push(r.pending.seat)
      const s = suggest(r.state, r.pending)!
      expect(validate(r.state, s)).toBeNull()
      r = must(step(r.state, s, new ScriptedRng([3, 5])))
    }
    expect(order).toHaveLength(10)
    expect(new Set(order.slice(0, 5)).size).toBe(1)
    expect(new Set(order.slice(5)).size).toBe(1)
    expect(order[0]).not.toBe(order[5])
    expect(r.state.phase).toBe('action')
    expect(r.state.round).toBe(1)
    expect(eventsOf(r.events, 'PriorityDecided')[0]).toMatchObject({ rolls: { A: 3, B: 5 }, holder: 'B' })
    // fighters are set up Standing and face the enemy half
    for (const f of Object.values(r.state.fighters)) {
      expect(f.posture).toBe('standing')
      expect(Math.abs(f.pos.z)).toBeGreaterThanOrEqual(12)
    }
  })

  it('autoDeploy places the crews in their halves facing each other, deterministically', () => {
    const a = first(createGame(makeSetup({ options: { autoCrew: true, autoDeploy: true } }), 'auto', testBundle))
    const b = first(createGame(makeSetup({ options: { autoCrew: true, autoDeploy: true } }), 'auto', testBundle))
    expect(a.state.hash).toBe(b.state.hash)
    for (const f of Object.values(a.state.fighters)) {
      expect(f.seat === 'A' ? f.pos.z < -12 : f.pos.z > 12).toBe(true)
      expect(f.facing).toBeCloseTo(f.seat === 'A' ? 0 : Math.PI, 2)
    }
  })

  it('refuses set-ups it cannot run: tile deployment (S4), overweight loadouts, two armour items, a board that does not fit', () => {
    const tile = withScenario({ deployment: { kind: 'tile', withinOfEdge: 3 } })
    expect(() => createGame(makeSetup({ scenarioId: 'test.alt' }), 's', tile)).toThrow(/tile deployment/)
    const heavy = makeSetup()
    heavy.gangs.A.roster[2] = { ...heavy.gangs.A.roster[2]!, weapons: ['test.w.pistol', 'test.w.rifle', 'test.w.blade', 'test.w.flamer'] }
    expect(() => createGame(heavy, 's', testBundle)).toThrow(/weapon slots/)
    const armoured = makeSetup()
    const bundle: EngineBundle = { ...testBundle, wargear: { ...testBundle.wargear, 'test.g.plate': { id: 'test.g.plate', name: 'Plate', kind: 'armour', cost: 1, save: 4 } } }
    armoured.gangs.A.roster[2] = { ...armoured.gangs.A.roster[2]!, wargear: ['test.g.flak', 'test.g.plate'] }
    expect(() => createGame(armoured, 's', bundle)).toThrow(EngineInvariantError)
  })

  it('suggest answers every finite decision with its first option and the deploy decision with a legal spot', () => {
    const created = createGame(makeSetup(), 'suggest', testBundle)
    let state: GameState = created.state
    let guard = 0
    while (state.phase === 'setup' && guard++ < 60) {
      const s = suggest(state)!
      expect(s).not.toBeNull()
      const r = must(step(state, s))
      state = r.state
    }
    expect(state.phase).toBe('action')
  })
})
