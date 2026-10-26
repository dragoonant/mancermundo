// SET module: owns `setup.*`. `createGame` validates the setup, builds the state, runs the automatic roll-off for the right to
// choose and raises `setup.role`. The sequence that follows (M-1): roles (or first / second), crews by the scenario's method
// (Custom, Random, Hybrid; Forgotten Riches rolls its crew cap first), the half of the board, deployment of the whole crew
// one fighter at a time inside the region, and then the first round. Scenario loot caskets are placed by `setup.casket` (Smash &
// Grab: the defender, in its own half, after the half is chosen; Forgotten Riches: alternately, the first in the centre tile and
// each in a tile of its own, before the tiles are picked), and tile deployment (Forgotten Riches) lets each gang pick a
// casket-free outer tile and set up within 3" of its outer edge, at least 6" from the enemy when the two tiles touch (M-4.4).
import type { EngineBundle } from './bundle'
import { snapshotData } from './bundle'
import { baseInRegion, deploymentRegions, tileStrips, type StandardRegions } from './board'
import { rollExpr, uniformInt } from './dice'
import { round3 } from './geometry'
import { normaliseAngle, spotProblem } from './movement'
import { casketPlacers, casketProblem, casketRegion, casketRules, deployTileChoices, suggestCasketSpot, tilesTouch } from './scenarios'
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
    end: { step: null, bottleQueue: [], fleeQueue: [], recoveryQueue: [], rallyQueue: [], assistsUsed: [], assistSeats: [], assists: {}, pick: null },
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
  // loot caskets: Forgotten Riches places them before the tiles are picked; Smash & Grab in the defender's half once it is chosen
  const rules = casketRules(s)
  if (rules && rules.region !== 'ownHalf') beginCasket(ctx)
  else beginZone(ctx)
}

// ---------------------------------------------------------------------------
// Zones and deployment regions (M-1.6)
// ---------------------------------------------------------------------------

export type ZoneId = 'low' | 'high'

const isTile = (state: GameState): boolean => state.data.scenario.deployment.kind === 'tile'

function rectsOf(state: GameState, zone: ZoneId): Polygon[] {
  const dep = state.data.scenario.deployment
  const reg = deploymentRegions(state.board.def, { kind: 'standard', ...(dep.minFromCentreline !== undefined ? { minFromCentreline: dep.minFromCentreline } : {}) }) as StandardRegions
  return zone === 'low' ? reg.low : reg.high
}

/** The strips of a tile within `withinOfEdge` of its outer board edge (tile deployment). */
function tileRects(state: GameState, tileId: string): Polygon[] {
  const def = state.board.def
  const i = def.tiles.findIndex((t) => t.id === tileId)
  return i < 0 ? [] : tileStrips(def, i, state.data.scenario.deployment.withinOfEdge ?? 3)
}

/** The deployment rectangles of a seat (after its half or tile is chosen). */
export function deploymentRects(state: GameState, seat: Seat): Polygon[] {
  const zone = state.setup.zoneChoices[seat]
  if (!zone) return []
  return isTile(state) ? tileRects(state, zone) : rectsOf(state, zone as ZoneId)
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

function assignZone(ctx: Ctx, seat: Seat, zone: string): void {
  ctx.state.setup.zoneChoices[seat] = zone
  if (isTile(ctx.state)) ctx.state.scenario.deployTiles[seat] = zone
  ctx.emit({ type: 'ZoneChosen', zoneId: zone }, seat)
}

/** Both halves or tiles are chosen: Smash & Grab now places its caskets in the defender's half, otherwise deployment begins. */
function afterZone(ctx: Ctx): void {
  const rules = casketRules(ctx.state)
  if (rules && rules.region === 'ownHalf') beginCasket(ctx)
  else beginDeploy(ctx)
}

function beginZone(ctx: Ctx): void {
  const s = ctx.state
  s.setup.step = 'zone'
  const first = s.setup.first!
  if (isTile(s)) {
    const choices = deployTileChoices(s, [])
    if (s.origin.setup.options?.autoDeploy) {
      assignZone(ctx, first, choices[0]!)
      assignZone(ctx, otherSeat(first), deployTileChoices(s, [choices[0]!])[0]!)
      afterZone(ctx)
      return
    }
    raiseTileZone(ctx, first, choices)
    return
  }
  if (s.origin.setup.options?.autoDeploy) {
    assignZone(ctx, 'A', 'low')
    assignZone(ctx, 'B', 'high')
    afterZone(ctx)
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

/** Forgotten Riches: pick a casket-free tile with an outer edge as the deployment tile (M-4.4). */
function raiseTileZone(ctx: Ctx, seat: Seat, choices: string[]): void {
  const s = ctx.state
  ctx.raise({
    kind: 'setup.zone',
    seat,
    window: 'setup.*',
    context: { tiles: Object.fromEntries(choices.map((id) => [id, tileRects(s, id)])), withinOfEdge: s.data.scenario.deployment.withinOfEdge ?? 3 },
    options: choices.map((zoneId) => ({ id: zoneId, labelKey: 'setup.zone.tile', type: 'setup.zone' as const, payload: { zoneId } })),
  })
}

/** A seat picked its tile: the other seat takes the remaining one (asked when there is a choice). */
function pickedTile(ctx: Ctx, seat: Seat, tileId: string): void {
  const s = ctx.state
  assignZone(ctx, seat, tileId)
  const other = otherSeat(seat)
  if (s.setup.zoneChoices[other]) {
    afterZone(ctx)
    return
  }
  const left = deployTileChoices(s, [tileId])
  if (left.length === 0) throw new EngineInvariantError('no deployment tile is left for the second gang')
  if (left.length === 1) {
    assignZone(ctx, other, left[0]!)
    afterZone(ctx)
    return
  }
  raiseTileZone(ctx, other, left)
}

// ---------------------------------------------------------------------------
// Loot caskets (M-3.4, M-4.3)
// ---------------------------------------------------------------------------

function placeCasket(ctx: Ctx, seat: Seat, at: Vec2): void {
  const s = ctx.state
  const id = `c${Object.keys(s.board.caskets).length + 1}`
  s.board.caskets[id] = { pos: { x: at.x, z: at.z }, state: 'closed', carriedBy: null }
  ctx.emit({ type: 'CasketPlaced', casketId: id, pos: { x: at.x, z: at.z } }, seat)
}

/** Place the scenario's caskets one at a time: by the engine (`autoCaskets`) or one `setup.casket` decision each. */
function beginCasket(ctx: Ctx): void {
  const s = ctx.state
  s.setup.step = 'casket'
  if (s.setup.casketQueue.length === 0 && Object.keys(s.board.caskets).length === 0) s.setup.casketQueue = casketPlacers(s)
  const auto = s.origin.setup.options?.autoCaskets === true
  while (s.setup.casketQueue.length > 0) {
    const seat = s.setup.casketQueue[0]!
    const suggestion = suggestCasketSpot(s, seat)
    if (auto) {
      if (!suggestion) throw new EngineInvariantError(`no legal spot for casket ${Object.keys(s.board.caskets).length + 1}`)
      placeCasket(ctx, seat, suggestion)
      s.setup.casketQueue.shift()
      continue
    }
    raiseCasket(ctx, seat, suggestion)
    return
  }
  const rules = casketRules(s)
  if (rules && rules.region === 'ownHalf') beginDeploy(ctx)
  else beginZone(ctx)
}

function raiseCasket(ctx: Ctx, seat: Seat, suggestion: Vec2 | null): void {
  const s = ctx.state
  const rules = casketRules(s)!
  const region = casketRegion(s, seat)
  const b = s.board.def.bounds
  ctx.raise({
    kind: 'setup.casket',
    seat,
    window: 'setup.*',
    context: {
      index: Object.keys(s.board.caskets).length + 1,
      of: rules.count,
      minFromEdge: rules.minFromEdge,
      minApart: rules.minApart,
      radius: 0.5,
      regions: region.rects,
      ...(region.tileIds ? { tiles: region.tileIds } : {}),
      placed: Object.entries(s.board.caskets).map(([id, c]) => ({ id, pos: c.pos })),
      ...(suggestion ? { suggestion } : {}),
    },
    constraints: {
      kind: 'casket',
      region: [
        { x: b.minX, z: b.minZ },
        { x: b.maxX, z: b.minZ },
        { x: b.maxX, z: b.maxZ },
        { x: b.minX, z: b.maxZ },
      ],
      oneInch: 'none',
    },
  })
}

function handleCasket(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type !== 'setup.casket') return reject('E_WRONG_DECISION', `expected setup.casket, got ${action.type}`)
  const at = { x: round3(action.payload.x), z: round3(action.payload.z) }
  const problem = casketProblem(state, pending.seat, at)
  if (problem) return { rejection: problem }
  const seat = pending.seat
  return {
    run(ctx) {
      placeCasket(ctx, seat, at)
      ctx.state.setup.casketQueue.shift()
      beginCasket(ctx)
    },
  }
}

/** `suggest` for `setup.casket`: the engine's spot for the placing seat. */
export function suggestCasket(state: GameState, pending: PendingDecision): Action | null {
  const spot = suggestCasketSpot(state, pending.seat)
  return spot ? { type: 'setup.casket', seat: pending.seat, decisionId: pending.id, payload: { x: spot.x, z: spot.z } } : null
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** Spacing the engine keeps between bases it places itself. */
const AUTO_GAP = 0.1
/** Grid the engine searches deploy spots on (finer than the gap it keeps, so a crowded strip still packs). */
const DEPLOY_STEP = 0.25

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
  for (let z = minZ; z <= maxZ + 1e-9; z += DEPLOY_STEP) for (let x = minX; x <= maxX + 1e-9; x += DEPLOY_STEP) cands.push({ x: round3(x), z: round3(z) })
  cands.sort((a, b) => Math.hypot(a.x - mid.x, a.z - mid.z) - Math.hypot(b.x - mid.x, b.z - mid.z) || a.z - b.z || a.x - b.x)
  const placed = Object.values(state.fighters).filter((g) => g.location === 'board' && g.id !== f.id)
  for (const c of cands) {
    if (!baseInRegion(rects, c, f.baseRadius)) continue
    if (spotProblem(state, f, c)) continue
    if (placed.some((g) => Math.hypot(g.pos.x - c.x, g.pos.z - c.z) < g.baseRadius + f.baseRadius + AUTO_GAP)) continue
    if (clearanceProblem(state, f, c)) continue
    return c
  }
  return null
}

/**
 * Tile deployment (M-4.4): when the two deployment tiles touch, no fighter may be set up within the scenario's enemy clearance
 * (6") of an enemy already on the board.
 */
function clearanceProblem(state: GameState, f: Fighter, at: Vec2): Rejection | null {
  const dep = state.data.scenario.deployment
  const clear = dep.enemyClearance
  if (dep.kind !== 'tile' || !clear) return null
  const mine = state.setup.zoneChoices[f.seat]
  const theirs = state.setup.zoneChoices[otherSeat(f.seat)]
  if (!mine || !theirs || !tilesTouch(state.board.def, mine, theirs)) return null
  for (const g of Object.values(state.fighters)) {
    if (g.seat === f.seat || g.location !== 'board') continue
    if (Math.hypot(g.pos.x - at.x, g.pos.z - at.z) - g.baseRadius - f.baseRadius < clear - 1e-9) return rej('E_OUT_OF_RANGE', `the deployment tiles touch: stay at least ${clear}" from enemy fighters`)
  }
  return null
}

function facingFor(state: GameState, seat: Seat): number {
  if (isTile(state)) {
    // toward the middle of the board from the middle of the deployment tile
    const t = state.board.def.tiles.find((x) => x.id === state.setup.zoneChoices[seat])
    return t ? round3(Math.atan2(-t.centre.x, -t.centre.z)) : 0
  }
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
  const problem = spotProblem(state, f, at) ?? clearanceProblem(state, f, at)
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
        const zone = action.payload.zoneId as string
        const seat = pending.seat
        if (isTile(state)) return { run: (ctx) => pickedTile(ctx, seat, zone) }
        return {
          run(ctx) {
            assignZone(ctx, seat, zone)
            assignZone(ctx, otherSeat(seat), zone === 'low' ? 'high' : 'low')
            afterZone(ctx)
          },
        }
      }
      case 'setup.casket':
        return handleCasket(state, action, pending)
      case 'setup.deploy':
        return handleDeploy(state, action, pending)
      default:
        return reject('E_TODO', `${pending.kind} is not a set-up decision`)
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

