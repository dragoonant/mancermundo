// SET module: setup.* (roles, crew, casket placement, zones, deployment). S1 holds the stub module and a minimal
// `createGame`: it validates the setup against the bundle, builds the state, runs the automatic roll-off for the right to
// choose, places nothing and raises `setup.role` with two options. S2 replaces this with the real set-up sequence.
import type { EngineBundle } from './bundle'
import { snapshotData } from './bundle'
import { round3 } from './geometry'
import { SeededRng } from './rng'
import { createCtx, stubModule } from './registry'
import { EngineInvariantError, hashState, SEATS } from './state'
import type { BoardState, Fighter, GameSetup, GameState, PlayerState, Seat, StepResult } from './types'

export const ENGINE_VERSION = '0.1.0'

export const setupModule = stubModule('setup', ['setup'])

function validateSetup(setup: GameSetup, bundle: EngineBundle): void {
  const fail = (msg: string): never => {
    throw new EngineInvariantError(`invalid setup: ${msg}`)
  }
  if (setup.ruleset !== 'n23') fail(`unknown ruleset ${String(setup.ruleset)}`)
  const scenario = bundle.scenarios[setup.scenarioId]
  if (!scenario) fail(`unknown scenario ${setup.scenarioId}`)
  const board = bundle.boards[setup.boardId]
  if (!board) fail(`unknown board ${setup.boardId}`)
  if (scenario && board && !scenario.layouts.includes(board.layout)) {
    fail(`board ${board.id} (${board.layout}) is not legal for scenario ${scenario.id}`)
  }
  const seen = new Set<string>()
  for (const seat of SEATS) {
    const gang = setup.gangs[seat]
    const house = bundle.houses[gang.houseId]
    if (!house) fail(`seat ${seat}: unknown house ${gang.houseId}`)
    if (gang.roster.length === 0) fail(`seat ${seat}: empty roster`)
    for (const f of gang.roster) {
      if (seen.has(f.id)) fail(`duplicate fighter id ${f.id}`)
      seen.add(f.id)
      const type = bundle.fighterTypes[f.typeId]
      if (!type) fail(`fighter ${f.id}: unknown fighter type ${f.typeId}`)
      else if (house && type.houseId !== house.id) fail(`fighter ${f.id}: ${f.typeId} does not belong to ${house.id}`)
      for (const w of f.weapons) if (!bundle.weapons[w]) fail(`fighter ${f.id}: unknown weapon ${w}`)
      for (const w of f.wargear) if (!bundle.wargear[w]) fail(`fighter ${f.id}: unknown wargear ${w}`)
      for (const s of f.skills) if (!bundle.skills[s]) fail(`fighter ${f.id}: unknown skill ${s}`)
    }
  }
  // TODO(S2): starter-gang / roster legality per 13-gangs.md (composition, credits, equipment lists)
}

function buildFighters(setup: GameSetup, bundle: EngineBundle): Record<string, Fighter> {
  const fighters: Record<string, Fighter> = {}
  for (const seat of SEATS) {
    for (const r of setup.gangs[seat].roster) {
      const type = bundle.fighterTypes[r.typeId]!
      fighters[r.id] = {
        id: r.id,
        seat,
        typeId: type.id,
        name: r.name,
        role: type.role,
        location: 'reserve',
        pos: { x: 0, y: 0, z: 0 },
        facing: 0,
        baseRadius: round3(type.baseMm / 25.4 / 2),
        posture: 'standing',
        stats: { ...type.stats },
        wounds: type.stats.W,
        maxWounds: type.stats.W,
        fleshWounds: 0,
        ready: false,
        conditions: {},
        weapons: r.weapons.map((weaponId) => ({ weaponId, ammo: 'ok' as const, lostProfiles: [] })),
        wargear: [...r.wargear],
        skills: [...r.skills],
        rules: type.rules.map((x) => ({ ...x })),
        engagedWith: [],
        carrying: null,
        activatedThisRound: false,
      }
    }
  }
  return fighters
}

export function createGame(setup: GameSetup, seed: string, bundle: EngineBundle): StepResult {
  validateSetup(setup, bundle)
  const scenario = bundle.scenarios[setup.scenarioId]!
  const def = bundle.boards[setup.boardId]!
  const board: BoardState = {
    def,
    doors: Object.fromEntries(def.doors.map((d) => [d.id, { state: 'closed' as const, locked: d.lockedAtStart, wounds: 0 }])),
    caskets: {},
    smoke: [],
  }
  const player = (seat: Seat): PlayerState => ({
    seat,
    houseId: setup.gangs[seat].houseId,
    gangName: setup.gangs[seat].name,
    role: null,
    startingCrew: 0,
    bottled: false,
    bottledVoluntarily: false,
    points: 0,
  })
  const rng = SeededRng.fromSeed(seed)
  const state: GameState = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    seed,
    ruleset: 'n23',
    phase: 'setup',
    round: 0,
    seq: 0,
    nextDecision: 0,
    pending: null,
    rng: rng.serialize(),
    hash: '',
    log: [],
    lastRollSeq: -1,
    origin: { setup },
    data: snapshotData(bundle, setup),
    board,
    players: { A: player('A'), B: player('B') },
    fighters: buildFighters(setup, bundle),
    priority: null,
    setup: {
      step: 'role',
      rollOff: null,
      roleChoice: null,
      crewPicks: { A: [], B: [] },
      casketQueue: [],
      zoneChoices: {},
      deployTurn: null,
      deployLeft: { A: [], B: [] },
    },
    action: { turn: null, activation: null, group: null, flightDone: [] },
    end: { step: null, bottleQueue: [], fleeQueue: [], recoveryQueue: [], rallyQueue: [], assistsUsed: [] },
    attack: null,
    nerve: [],
    effects: [],
    nextEffect: 0,
    casualties: [],
    scenario: {
      id: scenario.id,
      crewCap: null,
      caskets: { opened: 0, secured: 0 },
      points: { A: 0, B: 0 },
      locked: null,
      deployTiles: {},
    },
    result: null,
  }

  const ctx = createCtx(state, rng, null, -1)
  ctx.emit({ type: 'GameCreated', seed, engineVersion: ENGINE_VERSION }, null)
  ctx.emit({ type: 'PhaseStarted', name: 'setup' }, null)

  // the roll-off for the right to choose is automatic (re-rolled on a tie)
  let rolls: Record<Seat, number> = { A: 0, B: 0 }
  for (let guard = 0; guard < 100 && rolls.A === rolls.B; guard++) {
    rolls = { A: ctx.roll('setupRollOff', 1)[0]!, B: ctx.roll('setupRollOff', 1)[0]! }
  }
  if (rolls.A === rolls.B) throw new EngineInvariantError('roll-off never broke the tie')
  const winner: Seat = rolls.A > rolls.B ? 'A' : 'B'
  state.setup.rollOff = { rolls, winner }

  const choices = scenario.roles ? (['attacker', 'defender'] as const) : (['first', 'second'] as const)
  ctx.raise({
    kind: 'setup.role',
    seat: winner,
    window: 'setup.*',
    context: { rolls, roles: scenario.roles },
    options: choices.map((choice) => ({ id: choice, labelKey: `setup.role.${choice}`, type: 'setup.role' as const, payload: { choice } })),
  })

  state.rng = rng.serialize()
  state.hash = hashState(state)
  return { state, events: ctx.events, pending: state.pending }
}
