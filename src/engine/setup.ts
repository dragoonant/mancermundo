// SET module: owns `setup.*`. `createGame` validates the setup, builds the state, runs the automatic roll-off for the right to
// choose and raises `setup.role`. The sequence that follows (M-1): roles (or first / second), crews by the scenario's method
// (Custom, Random, Hybrid; Forgotten Riches rolls its crew cap first), the half of the board, deployment of the whole crew
// one fighter at a time inside the region, and then the first round. Loot casket placement and tile deployment (Forgotten
// Riches) arrive in S4: a scenario with tile deployment is refused at set-up, and scenario caskets are simply not placed yet.
import type { EngineBundle } from './bundle'
import { snapshotData } from './bundle'
import { baseInRegion, deploymentRegions, type StandardRegions } from './board'
import { rollExpr, uniformInt } from './dice'
import { round3 } from './geometry'
import { normaliseAngle, spotProblem } from './movement'
import { beginRound } from './priority'
import { SeededRng } from './rng'
import { createCtx, reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { EngineInvariantError, getFighter, hashState, otherSeat, SEATS } from './state'
import type {
  Action,
  BoardState,
  Fighter,
  GameSetup,
  GameState,
  PendingDecision,
  PlayerState,
  Polygon,
  Rejection,
  Seat,
  StepResult,
  Vec2,
} from './types'

export const ENGINE_VERSION = '0.1.0'

const rej = (code: Rejection['code'], reason: string): Rejection => ({ code, reason })

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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
  if (scenario?.deployment.kind === 'tile') fail(`scenario ${scenario.id}: tile deployment arrives in S4`)
  const slots = bundle.constants.loadout as { maxWeapons: number; unwieldySlots: number } | undefined
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
      let used = 0
      for (const w of f.weapons) {
        const weapon = bundle.weapons[w]
        if (!weapon) fail(`fighter ${f.id}: unknown weapon ${w}`)
        else {
          const big = weapon.profiles.some((p) => p.traits.some((t) => t.trait === 'core.t.unwieldy' || t.trait === 'core.t.paired'))
          used += big ? (slots?.unwieldySlots ?? 2) : 1
        }
      }
      if (slots && used > slots.maxWeapons) fail(`fighter ${f.id}: carries ${used} weapon slots, at most ${slots.maxWeapons}`)
      let armour = 0
      for (const w of f.wargear) {
        const g = bundle.wargear[w]
        if (!g) fail(`fighter ${f.id}: unknown wargear ${w}`)
        else if (g.kind === 'armour') armour++
      }
      if (armour > 1) fail(`fighter ${f.id}: carries ${armour} armour items, at most 1`)
      for (const s of f.skills) if (!bundle.skills[s]) fail(`fighter ${f.id}: unknown skill ${s}`)
    }
  }
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

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

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
      first: null,
      crewOrder: [],
      crewPlan: null,
      crewDone: [],
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

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function applyRole(ctx: Ctx, choice: 'attacker' | 'defender' | 'first' | 'second'): void {
  const s = ctx.state
  const scenario = s.data.scenario
  const winner = s.setup.rollOff!.winner
  s.setup.roleChoice = choice
  ctx.emit({ type: 'RoleChosen', seat: winner, choice }, winner)
  if (scenario.roles) {
    const mine = choice === 'attacker' ? 'attacker' : 'defender'
    s.players[winner].role = mine
    s.players[otherSeat(winner)].role = mine === 'attacker' ? 'defender' : 'attacker'
    const defender: Seat = mine === 'defender' ? winner : otherSeat(winner)
    s.setup.first = scenario.deployment.defenderFirst === false ? otherSeat(defender) : defender
    s.setup.crewOrder = [defender, otherSeat(defender)]
  } else {
    s.setup.first = choice === 'first' ? winner : otherSeat(winner)
    s.setup.crewOrder = [s.setup.first, otherSeat(s.setup.first)]
  }
  beginCrew(ctx)
}

// ---------------------------------------------------------------------------
// Crews (M-1.2)
// ---------------------------------------------------------------------------

function rosterIds(state: GameState, seat: Seat): string[] {
  return Object.values(state.fighters)
    .filter((f) => f.seat === seat)
    .map((f) => f.id)
}

function beginCrew(ctx: Ctx): void {
  const s = ctx.state
  const sc = s.data.scenario
  s.setup.step = 'crew'
  let cap: number | null = null
  if (sc.crewCap) {
    const roll = ctx.roll('crewCap', 1, '2d6')[0]!
    cap = sc.crewCap.find((r) => roll >= r.min && roll <= r.max)?.cap ?? sc.crewCap[sc.crewCap.length - 1]!.cap
    s.scenario.crewCap = cap
    ctx.emit({ type: 'CrewCapRolled', roll, cap }, null)
  }
  const plan = {} as Record<Seat, NonNullable<typeof s.setup.crewPlan>[Seat]>
  for (const seat of SEATS) {
    const role = s.players[seat].role
    const m = (role && sc.crews[role]) || sc.crews.both
    const n = rosterIds(s, seat).length
    const base = m ?? { method: 'custom' as const, x: n }
    plan[seat] = cap !== null && base.method === 'custom' ? { ...base, x: cap } : base
  }
  s.setup.crewPlan = plan
  advanceCrew(ctx)
}

function customTarget(state: GameState, seat: Seat): number {
  const plan = state.setup.crewPlan![seat]
  return Math.min(plan.x, rosterIds(state, seat).length)
}

/** Finish a seat's crew: the random part of Random and Hybrid is drawn here, then the seat is done. */
function finishSeatCrew(ctx: Ctx, seat: Seat): void {
  const s = ctx.state
  const plan = s.setup.crewPlan![seat]
  const picks = s.setup.crewPicks[seat]
  const all = rosterIds(s, seat)
  const draw = (count: number): string[] => {
    const pool = all.filter((id) => !picks.includes(id))
    const out: string[] = []
    for (let i = 0; i < count && pool.length > 0; i++) out.push(pool.splice(uniformInt(ctx, 'crewDraw', pool.length), 1)[0]!)
    return out
  }
  if (plan.method === 'random') {
    const drawn = draw(plan.x)
    picks.push(...drawn)
    ctx.emit({ type: 'CrewChosen', fighterIds: drawn.slice(), random: true }, seat)
  } else {
    if (picks.length > 0) ctx.emit({ type: 'CrewChosen', fighterIds: picks.slice(), random: false }, seat)
    if (plan.method === 'hybrid') {
      const y = plan.y === undefined ? 0 : rollExpr(ctx, 'crewHybrid', plan.y)
      const drawn = draw(y)
      picks.push(...drawn)
      if (drawn.length > 0) ctx.emit({ type: 'CrewChosen', fighterIds: drawn.slice(), random: true }, seat)
    }
  }
  s.setup.crewDone.push(seat)
  s.players[seat].startingCrew = picks.length
}

function advanceCrew(ctx: Ctx): void {
  const s = ctx.state
  const auto = s.origin.setup.options?.autoCrew === true
  for (const seat of s.setup.crewOrder) {
    if (s.setup.crewDone.includes(seat)) continue
    const plan = s.setup.crewPlan![seat]
    const picks = s.setup.crewPicks[seat]
    const roster = rosterIds(s, seat)
    if (plan.method === 'random') {
      finishSeatCrew(ctx, seat)
      continue
    }
    const x = customTarget(s, seat)
    // everyone fits, or the engine makes the custom picks: roster order
    if (auto || roster.length <= x) {
      for (const id of roster) {
        if (picks.length >= x) break
        if (!picks.includes(id)) picks.push(id)
      }
    }
    if (picks.length >= x) {
      finishSeatCrew(ctx, seat)
      continue
    }
    ctx.raise({
      kind: 'setup.crew',
      seat,
      window: 'setup.*',
      context: { method: plan.method, x, picked: picks.slice(), roster, y: plan.y ?? null },
      options: [
        ...roster.filter((id) => !picks.includes(id)).map((fighterId) => ({ id: fighterId, labelKey: 'setup.crew.pick', type: 'setup.crew' as const, payload: { fighterId } })),
        ...(picks.length >= 1 ? [{ id: 'done', labelKey: 'setup.crew.done', type: 'setup.crew' as const, payload: { done: true as const } }] : []),
      ],
    })
    return
  }
  // TODO(S4): setup.casket (scenario caskets are placed here)
  beginZone(ctx)
}

// ---------------------------------------------------------------------------
// Zones and deployment regions (M-1.6)
// ---------------------------------------------------------------------------

export type ZoneId = 'low' | 'high'

function rectsOf(state: GameState, zone: ZoneId): Polygon[] {
  const dep = state.data.scenario.deployment
  const reg = deploymentRegions(state.board.def, { kind: 'standard', ...(dep.minFromCentreline !== undefined ? { minFromCentreline: dep.minFromCentreline } : {}) }) as StandardRegions
  return zone === 'low' ? reg.low : reg.high
}

/** The deployment rectangles of a seat (after its half is chosen). */
export function deploymentRects(state: GameState, seat: Seat): Polygon[] {
  const zone = state.setup.zoneChoices[seat] as ZoneId | undefined
  return zone ? rectsOf(state, zone) : []
}

function regionPolygon(rects: Polygon[]): Polygon {
  const xs = rects.flatMap((r) => r.map((p) => p.x))
  const zs = rects.flatMap((r) => r.map((p) => p.z))
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]
}

function assignZone(ctx: Ctx, seat: Seat, zone: ZoneId): void {
  ctx.state.setup.zoneChoices[seat] = zone
  ctx.emit({ type: 'ZoneChosen', zoneId: zone }, seat)
}

function beginZone(ctx: Ctx): void {
  const s = ctx.state
  s.setup.step = 'zone'
  const first = s.setup.first!
  if (s.origin.setup.options?.autoDeploy) {
    assignZone(ctx, 'A', 'low')
    assignZone(ctx, 'B', 'high')
    beginDeploy(ctx)
    return
  }
  ctx.raise({
    kind: 'setup.zone',
    seat: first,
    window: 'setup.*',
    context: { zones: { low: rectsOf(s, 'low'), high: rectsOf(s, 'high') } },
    options: (['low', 'high'] as const).map((zoneId) => ({ id: zoneId, labelKey: `setup.zone.${zoneId}`, type: 'setup.zone' as const, payload: { zoneId } })),
  })
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** Spacing the engine keeps between bases it places itself. */
const AUTO_GAP = 0.1

/**
 * The engine's deploy spot for a fighter: the legal spot nearest the middle of its region on a half-inch grid, with a small
 * gap to the bases already placed. `null` when the region is full.
 */
export function findDeploySpot(state: GameState, f: Fighter, rects: Polygon[]): Vec2 | null {
  if (rects.length === 0) return null
  const poly = regionPolygon(rects)
  const minX = poly[0]!.x
  const maxX = poly[1]!.x
  const minZ = poly[0]!.z
  const maxZ = poly[2]!.z
  const mid = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
  const cands: Vec2[] = []
  for (let z = minZ; z <= maxZ + 1e-9; z += 0.5) for (let x = minX; x <= maxX + 1e-9; x += 0.5) cands.push({ x: round3(x), z: round3(z) })
  cands.sort((a, b) => Math.hypot(a.x - mid.x, a.z - mid.z) - Math.hypot(b.x - mid.x, b.z - mid.z) || a.z - b.z || a.x - b.x)
  const placed = Object.values(state.fighters).filter((g) => g.location === 'board' && g.id !== f.id)
  for (const c of cands) {
    if (!baseInRegion(rects, c, f.baseRadius)) continue
    if (spotProblem(state, f, c)) continue
    if (placed.some((g) => Math.hypot(g.pos.x - c.x, g.pos.z - c.z) < g.baseRadius + f.baseRadius + AUTO_GAP)) continue
    return c
  }
  return null
}

function facingFor(state: GameState, seat: Seat): number {
  return state.setup.zoneChoices[seat] === 'low' ? 0 : Math.PI
}

function placeFighter(ctx: Ctx, f: Fighter, at: Vec2, facing: number): void {
  f.location = 'board'
  f.pos = { x: at.x, y: 0, z: at.z }
  f.facing = round3(facing)
  f.posture = 'standing'
  ctx.state.setup.deployLeft[f.seat] = ctx.state.setup.deployLeft[f.seat].filter((id) => id !== f.id)
  ctx.emit({ type: 'FighterDeployed', fighterId: f.id, pos: { ...f.pos }, facing: f.facing }, f.seat)
}

function beginDeploy(ctx: Ctx): void {
  const s = ctx.state
  s.setup.step = 'deploy'
  for (const seat of SEATS) s.setup.deployLeft[seat] = s.setup.crewPicks[seat].slice()
  s.setup.deployTurn = s.setup.first
  if (s.origin.setup.options?.autoDeploy) {
    for (const seat of [s.setup.first!, otherSeat(s.setup.first!)]) {
      for (const id of s.setup.deployLeft[seat].slice()) {
        const f = getFighter(s, id)
        const spot = findDeploySpot(s, f, deploymentRects(s, seat))
        if (!spot) throw new EngineInvariantError(`no room to deploy ${id}`)
        placeFighter(ctx, f, spot, facingFor(s, seat))
      }
    }
    finishSetup(ctx)
    return
  }
  raiseDeploy(ctx)
}

function raiseDeploy(ctx: Ctx): void {
  const s = ctx.state
  const seat = s.setup.deployTurn!
  const rects = deploymentRects(s, seat)
  const left = s.setup.deployLeft[seat]
  ctx.raise({
    kind: 'setup.deploy',
    seat,
    window: 'setup.*',
    context: { regions: rects, radii: Object.fromEntries(left.map((id) => [id, s.fighters[id]!.baseRadius])), facing: facingFor(s, seat) },
    constraints: { kind: 'deploy', fighterIds: left.slice(), region: regionPolygon(rects), oneInch: 'none' },
  })
}

function finishSetup(ctx: Ctx): void {
  const s = ctx.state
  s.setup.step = 'done'
  s.setup.deployTurn = null
  ctx.emit({ type: 'PhaseEnded', name: 'setup' }, null)
  beginRound(ctx)
}

function handleDeploy(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type !== 'setup.deploy') return reject('E_WRONG_DECISION', `expected setup.deploy, got ${action.type}`)
  const p = action.payload
  const seat = pending.seat
  if (!state.setup.deployLeft[seat].includes(p.fighterId)) return reject('E_INVALID_TARGET', `${String(p.fighterId)} is not waiting to deploy`)
  if (![p.x, p.z, p.facing].every((n) => typeof n === 'number' && Number.isFinite(n))) return reject('E_SCHEMA', 'x, z and facing must be finite numbers')
  const f = getFighter(state, p.fighterId)
  const at = { x: round3(p.x), z: round3(p.z) }
  if (!baseInRegion(deploymentRects(state, seat), at, f.baseRadius)) return reject('E_OUT_OF_RANGE', 'the base must lie wholly inside the deployment zone')
  const problem = spotProblem(state, f, at)
  if (problem) return { rejection: problem }
  return {
    run(ctx) {
      const fighter = getFighter(ctx.state, f.id)
      placeFighter(ctx, fighter, at, normaliseAngle(p.facing))
      const s = ctx.state
      if (s.setup.deployLeft[seat].length === 0) {
        const other = otherSeat(seat)
        if (s.setup.deployLeft[other].length === 0) {
          finishSetup(ctx)
          return
        }
        s.setup.deployTurn = other
      }
      raiseDeploy(ctx)
    },
  }
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export const setupModule: ModuleDef = {
  id: 'setup',
  namespaces: ['setup'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'setup.role': {
        if (action.type !== 'setup.role') return reject('E_WRONG_DECISION', `expected setup.role, got ${action.type}`)
        const choice = action.payload.choice
        return { run: (ctx) => applyRole(ctx, choice) }
      }
      case 'setup.crew': {
        if (action.type !== 'setup.crew') return reject('E_WRONG_DECISION', `expected setup.crew, got ${action.type}`)
        const p = action.payload
        const seat = pending.seat
        return {
          run(ctx) {
            const s = ctx.state
            if (p.fighterId) s.setup.crewPicks[seat].push(p.fighterId)
            if (p.done || s.setup.crewPicks[seat].length >= customTarget(s, seat)) finishSeatCrew(ctx, seat)
            advanceCrew(ctx)
          },
        }
      }
      case 'setup.zone': {
        if (action.type !== 'setup.zone') return reject('E_WRONG_DECISION', `expected setup.zone, got ${action.type}`)
        const zone = action.payload.zoneId as ZoneId
        const seat = pending.seat
        return {
          run(ctx) {
            assignZone(ctx, seat, zone)
            assignZone(ctx, otherSeat(seat), zone === 'low' ? 'high' : 'low')
            beginDeploy(ctx)
          },
        }
      }
      case 'setup.deploy':
        return handleDeploy(state, action, pending)
      default:
        return reject('E_TODO', `${pending.kind} arrives in S4`)
    }
  },
  explain(_state, action) {
    if (action.type === 'setup.crew') return rej('E_INVALID_TARGET', 'that fighter cannot be picked now')
    return null
  },
}

/** `suggest` for the continuous set-up decisions: a deploy spot for the first fighter still waiting. */
export function suggestDeploy(state: GameState, pending: PendingDecision): Action | null {
  const id = state.setup.deployLeft[pending.seat][0]
  if (!id) return null
  const f = getFighter(state, id)
  const spot = findDeploySpot(state, f, deploymentRects(state, pending.seat))
  if (!spot) return null
  return { type: 'setup.deploy', seat: pending.seat, decisionId: pending.id, payload: { fighterId: id, x: spot.x, z: spot.z, facing: facingFor(state, pending.seat) } }
}

