// SET: setup.* (R-1.2 to R-1.5). Builds the game, rolls off for setup initiative, picks drop zones,
// then deploys operatives alternately in batches of one third (rounded up).
import type { EngineBundle } from './bundle'
import { snapshotData } from './bundle'
import { bearing, circleInsidePolygon, polygonBBox, round3 } from './geometry'
import { beginTurningPoint } from './strategy'
import { SeededRng } from './rng'
import { createCtx, reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { EngineInvariantError, hashState, otherSeat, SEATS } from './state'
import { placementProblem } from './terrain'
// M2b-game
import { allowedOrders, initTeamState } from './abilities'
import { handleEquipMarker, nextPlacer, placeItem, selectionProblem, suggestEquipPlacement, territoryOf, DEFAULT_EQUIPMENT_LIMIT } from './equipment'
import { chooseMission, missionDef, objectiveOptions, objectiveSeat, placeObjective } from './missions'
import { OBJECTIVE_RADIUS } from './missions'
import {
  type Action,
  type GameSetup,
  type GameState,
  type Loadout,
  type Operative,
  type PendingDecision,
  type Seat,
  type StepResult,
  type Vec3,
} from './types'

export const ENGINE_VERSION = '0.1.0'

const MAX_EQUIPMENT = 4

/** A batch is min(ceil(N/3), operatives left to place) where N is the roster size (RULING in R-1.5). */
export function batchSize(rosterSize: number, left: number): number {
  return Math.min(Math.ceil(rosterSize / 3), left)
}

function defaultLoadout(card: { weaponOptions: { pick: number; min?: number; from: string[] }[]; legalLoadouts?: string[][] }): Loadout {
  // M2b-game: cards built by the data adapter list every legal loadout; the first is the default
  if (card.legalLoadouts && card.legalLoadouts.length > 0) return { weaponIds: [...card.legalLoadouts[0]!] }
  const ids: string[] = []
  for (const opt of card.weaponOptions) ids.push(...opt.from.slice(0, opt.min ?? opt.pick))
  return { weaponIds: ids }
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])
}

function validateSetup(setup: GameSetup, bundle: EngineBundle): void {
  const fail = (msg: string): never => {
    throw new EngineInvariantError(`invalid setup: ${msg}`)
  }
  if (!setup.mission && setup.map.dropZones.length < 2) fail('the map needs at least two drop zones')
  if (setup.mission && !bundle.missions) fail('the bundle has no missions')
  for (const seat of SEATS) {
    const teamId = setup.teams[seat]
    if (!bundle.teams[teamId]) fail(`unknown team ${teamId}`)
    const roster = setup.rosters[seat]
    if (roster.length === 0) fail(`seat ${seat} has an empty roster`)
    for (const entry of roster) {
      const card = bundle.datacards[entry.datacardId]
      if (!card) fail(`unknown datacard ${entry.datacardId}`)
      else {
        if (card.teamId !== teamId) fail(`${card.id} does not belong to team ${teamId}`)
        const chosen = entry.loadout?.weaponIds ?? defaultLoadout(card).weaponIds
        if (card.legalLoadouts) {
          // cards from the data adapter list every legal loadout (sets and profile groups included)
          if (!card.legalLoadouts.some((l) => sameSet(l, chosen))) fail(`the loadout for ${card.id} is not one of its legal loadouts`)
        } else {
          for (const opt of card.weaponOptions) {
            const n = chosen.filter((w) => opt.from.includes(w)).length
            if (n > opt.pick || n < (opt.min ?? opt.pick)) fail(`loadout for ${card.id} breaks option ${opt.id}`)
          }
          const allowed = new Set(card.weaponOptions.flatMap((o) => o.from))
          for (const w of chosen) if (!allowed.has(w)) fail(`${w} is not a weapon option of ${card.id}`)
        }
      }
    }
    const problem = selectionProblem(setup, seat, { ...(bundle.equipment ? { equipment: bundle.equipment } : {}), teamId, limit: Math.min(MAX_EQUIPMENT, DEFAULT_EQUIPMENT_LIMIT) })
    if (problem) fail(problem)
  }
}

export function createGame(setup: GameSetup, seed: string, bundle: EngineBundle): StepResult {
  validateSetup(setup, bundle)
  const operatives: Record<string, Operative> = {}
  const cardIds: string[] = []
  for (const seat of SEATS) {
    setup.rosters[seat].forEach((entry, i) => {
      const card = bundle.datacards[entry.datacardId]!
      cardIds.push(card.id)
      const id = `${seat}${i + 1}`
      const loadout = entry.loadout ?? defaultLoadout(card)
      const baseRadius = round3(card.baseMm / 25.4 / 2)
      operatives[id] = {
        id,
        seat,
        datacardId: card.id,
        name: entry.name ?? card.name,
        loadout: { weaponIds: [...loadout.weaponIds] },
        weapons: [...card.fixedWeapons, ...loadout.weaponIds],
        status: 'reserve',
        pos: { x: 0, y: 0, z: 0 },
        facing: 0,
        baseRadius,
        height: card.heightInches ?? round3((card.baseMm / 25.4) * 1.15 + 0.1),
        wounds: card.wounds,
        maxWounds: card.wounds,
        order: 'conceal',
        ready: false,
        apl: card.apl,
        aplMods: 0,
        move: card.move,
        save: card.save,
        flags: { guard: false, counteractedThisTP: false, carrying: null, injured: false },
        usedLimited: {},
        oncePerBattleUsed: [],
      }
    })
  }

  const state: GameState = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    seed,
    phase: 'setup',
    turningPoint: 0,
    seq: 0,
    nextDecision: 0,
    pending: null,
    rng: SeededRng.fromSeed(seed).serialize(),
    hash: '',
    log: [],
    lastRollSeq: -1,
    origin: { setup },
    rules: { operativesBlockVisibility: setup.rules?.operativesBlockVisibility ?? true },
    data: snapshotData(bundle, cardIds, [setup.teams.A, setup.teams.B]),
    map: setup.map,
    players: {
      A: { seat: 'A', teamId: setup.teams.A, cp: 2, vp: 0, equipment: [...(setup.equipment?.A ?? [])], dropZoneId: null },
      B: { seat: 'B', teamId: setup.teams.B, cp: 2, vp: 0, equipment: [...(setup.equipment?.B ?? [])], dropZoneId: null },
    },
    operatives,
    markers: [],
    initiative: null,
    setup: {
      step: 'rollOff',
      rolls: {},
      rollWinner: null,
      setupInitiative: null,
      dropZoneTurn: null,
      deploy: { turn: 'A', left: 0 },
    },
    strategy: { step: 'initiative', rolls: {}, gambit: { turn: 'A', passes: 0, used: { A: [], B: [] } } },
    firefight: { turn: 'A', activation: null },
    result: null,
    config: { A: { choices: {}, adaptive: null, doctrine: null }, B: { choices: {}, adaptive: null, doctrine: null } },
    mission: null,
    effects: [],
    ledger: { A: { battle: [], tp: [], uses: {}, tpUses: {} }, B: { battle: [], tp: [], uses: {}, tpUses: {} } },
    equipment: { queue: { A: [], B: [] }, turn: null, placed: [], picks: { A: {}, B: {} } },
    window: null,
    nextEffect: 0,
  }
  state.data.gambits = bundle.gambits.filter((g) => !g.teamId || g.teamId === setup.teams.A || g.teamId === setup.teams.B)

  const rng = SeededRng.restore(state.rng)
  const ctx = createCtx(state, rng, null, -1)
  ctx.emit({ type: 'GameCreated', seed, engineVersion: ENGINE_VERSION }, null)
  ctx.emit({ type: 'PhaseStarted', name: 'setup' }, null)
  // team picks, Chapter Veteran, equipment grants (M2b-game); the mission and objectives follow the roll-off
  initTeamState(ctx, setup)
  raiseRollOff(ctx, 'A')
  state.hash = hashState(state)
  return { state, events: ctx.events, pending: state.pending }
}

function raiseRollOff(ctx: Ctx, seat: Seat): void {
  ctx.raise({
    kind: 'setup.initiative',
    seat,
    window: 'setup.*',
    context: { rolls: { ...ctx.state.setup.rolls } },
    options: [{ id: 'roll', labelKey: 'setup.rollOff', type: 'setup.initiative', payload: {} }],
  })
}

function raiseDropZone(ctx: Ctx, seat: Seat): void {
  const s = ctx.state
  const taken = new Set(SEATS.map((x) => s.players[x].dropZoneId).filter((z): z is string => z !== null))
  const free = s.map.dropZones.filter((z) => !taken.has(z.id))
  ctx.raise({
    kind: 'setup.dropZone',
    seat,
    window: 'setup.*',
    context: { taken: [...taken] },
    options: free.map((z) => ({
      id: z.id,
      labelKey: 'setup.dropZone',
      type: 'setup.dropZone' as const,
      payload: { zoneId: z.id },
    })),
  })
}

function reserveOf(s: GameState, seat: Seat): Operative[] {
  return Object.values(s.operatives).filter((o) => o.seat === seat && o.status === 'reserve')
}

function raiseDeploy(ctx: Ctx): void {
  const s = ctx.state
  const seat = s.setup.deploy.turn
  const reserve = reserveOf(s, seat)
  const zone = s.map.dropZones.find((z) => z.id === s.players[seat].dropZoneId)!
  ctx.raise({
    kind: 'setup.deploy',
    seat,
    window: 'setup.*',
    context: { left: s.setup.deploy.left, reserveIds: reserve.map((o) => o.id), zoneId: zone.id },
    constraints: { kind: 'deploy', operativeIds: reserve.map((o) => o.id), region: zone.polygon },
  })
}

function rosterSize(s: GameState, seat: Seat): number {
  return Object.values(s.operatives).filter((o) => o.seat === seat).length
}

function startDeploy(ctx: Ctx): void {
  const s = ctx.state
  s.setup.step = 'deploy'
  const first = s.setup.setupInitiative!
  s.setup.deploy = { turn: first, left: batchSize(rosterSize(s, first), reserveOf(s, first).length) }
  raiseDeploy(ctx)
}

function advanceDeploy(ctx: Ctx, justPlaced: Seat): void {
  const s = ctx.state
  const d = s.setup.deploy
  const mine = reserveOf(s, justPlaced).length
  if (d.left > 0 && mine > 0) {
    raiseDeploy(ctx)
    return
  }
  const other = otherSeat(justPlaced)
  const theirs = reserveOf(s, other).length
  if (theirs > 0) {
    s.setup.deploy = { turn: other, left: batchSize(rosterSize(s, other), theirs) }
  } else if (mine > 0) {
    s.setup.deploy = { turn: justPlaced, left: batchSize(rosterSize(s, justPlaced), mine) }
  } else {
    s.setup.step = 'done'
    ctx.emit({ type: 'PhaseEnded', name: 'setup' }, null)
    beginTurningPoint(ctx)
    return
  }
  raiseDeploy(ctx)
}

function numeric(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function handleDeploy(state: GameState, action: Action): Handled {
  if (action.type !== 'setup.deploy') return reject('E_WRONG_DECISION', 'expected a deploy action')
  const p = action.payload
  if (!p || typeof p.operativeId !== 'string' || !numeric(p.x) || !numeric(p.z) || (p.y !== undefined && !numeric(p.y))) {
    return reject('E_SCHEMA', 'deploy needs operativeId, x and z')
  }
  const op = state.operatives[p.operativeId]
  if (!op || op.seat !== action.seat) return reject('E_NOT_AN_OPTION', `${p.operativeId} is not one of your operatives`)
  if (op.status !== 'reserve') return reject('E_NOT_AN_OPTION', `${op.id} is already set up`)
  const pos: Vec3 = { x: round3(p.x), y: round3(p.y ?? 0), z: round3(p.z) }
  const zone = state.map.dropZones.find((z) => z.id === state.players[op.seat].dropZoneId)!
  if (!circleInsidePolygon(pos, op.baseRadius, zone.polygon)) {
    return reject('E_OUT_OF_RANGE', 'an operative must be set up wholly within its drop zone')
  }
  const problem = placementProblem(state, { id: op.id, pos, radius: op.baseRadius, height: op.height })
  if (problem) return { rejection: problem }
  return {
    run(ctx) {
      const o = ctx.state.operatives[op.id]!
      o.status = 'active'
      o.pos = pos
      // set up with Conceal (R-1.5); the Bomb Squig cannot take Conceal (Stoopid) and is set up Engaged
      o.order = allowedOrders(ctx.state, o).includes('conceal') ? 'conceal' : 'engage'
      o.ready = false
      o.facing = bearing(pos, { x: 0, z: 0 })
      ctx.emit({ type: 'OperativeDeployed', operativeId: o.id, pos })
      ctx.state.setup.deploy.left -= 1
      advanceDeploy(ctx, o.seat)
    },
  }
}

function handleRollOff(state: GameState, action: Action): Handled {
  if (action.type !== 'setup.initiative') return reject('E_WRONG_DECISION', 'expected a roll-off action')
  return {
    run(ctx) {
      const s = ctx.state
      const seat = action.seat
      const [v] = ctx.roll('setup.rollOff', 1)
      s.setup.rolls[seat] = v!
      const { A, B } = s.setup.rolls
      if (A === undefined || B === undefined) {
        raiseRollOff(ctx, otherSeat(seat))
        return
      }
      if (A === B) {
        s.setup.rolls = {}
        raiseRollOff(ctx, 'A')
        return
      }
      const winner: Seat = A > B ? 'A' : 'B'
      s.setup.rollWinner = winner
      s.setup.step = 'decideInitiative'
      ctx.raise({
        kind: 'setup.decideInitiative',
        seat: winner,
        window: 'setup.*',
        context: { rolls: { A, B } },
        options: SEATS.map((x) => ({
          id: x,
          labelKey: x === winner ? 'setup.initiativeSelf' : 'setup.initiativeOpponent',
          type: 'setup.decideInitiative' as const,
          payload: { seat: x },
        })),
      })
    },
  }
}

function handleDecideInitiative(state: GameState, action: Action): Handled {
  if (action.type !== 'setup.decideInitiative') return reject('E_WRONG_DECISION', 'expected a setup initiative decision')
  const holder = action.payload.seat
  return {
    run(ctx) {
      const s = ctx.state
      s.setup.setupInitiative = holder
      s.initiative = holder
      ctx.emit({ type: 'InitiativeDecided', holder, setup: true })
      // Preliminary Ops: roll the map and the crit op, then place the objective markers (R-1.2, M-1.3, M-1.4)
      chooseMission(ctx)
      if (s.mission) {
        s.setup.step = 'objectives'
        continueObjectives(ctx)
        return
      }
      startDropZones(ctx)
    },
  }
}

function startDropZones(ctx: Ctx): void {
  const s = ctx.state
  const holder = s.setup.setupInitiative!
  s.setup.step = 'dropZones'
  s.setup.dropZoneTurn = holder
  raiseDropZone(ctx, holder)
}

/** Place objective markers one step at a time; the mission map's candidate spots are the options. */
function continueObjectives(ctx: Ctx): void {
  const s = ctx.state
  const def = missionDef(s)
  while (def && s.mission && s.mission.objectiveStep < def.objectiveSetup.steps.length) {
    const seat = objectiveSeat(s)!
    const options = objectiveOptions(s)
    if (s.origin.setup.autoObjectives) {
      const spot = options[0]!
      placeObjective(ctx, spot, seat)
      continue
    }
    ctx.raise({
      kind: 'setup.objective',
      seat,
      window: 'setup.*',
      context: { step: s.mission.objectiveStep, of: def.objectiveSetup.steps.length, radius: OBJECTIVE_RADIUS },
      options: options.map((p) => ({
        id: `${p.x},${p.z}`,
        labelKey: 'setup.objective',
        type: 'setup.objective' as const,
        payload: { x: p.x, z: p.z },
      })),
    })
    return
  }
  startDropZones(ctx)
}

function handleObjective(_state: GameState, action: Action): Handled {
  if (action.type !== 'setup.objective') return reject('E_WRONG_DECISION', 'expected an objective placement')
  const { x, z } = action.payload
  return {
    run(ctx) {
      placeObjective(ctx, { x, z }, action.seat)
      continueObjectives(ctx)
    },
  }
}

// ---------------------------------------------------------------------------
// Equipment placement (R-1.4): players alternate placing one item at a time
// ---------------------------------------------------------------------------

function startEquipment(ctx: Ctx): void {
  const s = ctx.state
  s.setup.step = 'equipment'
  s.equipment.turn = s.setup.setupInitiative
  continueEquipment(ctx)
}

function continueEquipment(ctx: Ctx): void {
  const s = ctx.state
  for (let guard = 0; guard < 64; guard++) {
    const seat = nextPlacer(s)
    if (!seat) {
      startDeploy(ctx)
      return
    }
    const item = s.equipment.queue[seat][0]!
    const spot = suggestEquipPlacement(s, seat, item)
    if (!spot) {
      // no legal place exists: the item is not set up
      s.equipment.queue[seat] = s.equipment.queue[seat].filter((i) => i.key !== item.key)
      ctx.emit({ type: 'EquipmentSkipped', equipmentId: item.equipmentId, key: item.key }, seat)
      continue
    }
    if (s.origin.setup.autoEquipment) {
      placeItem(ctx, seat, item, { x: spot.x, z: spot.z }, spot.yaw)
      s.equipment.turn = otherSeat(seat)
      continue
    }
    const e = s.data.equipment?.[item.equipmentId]
    ctx.raise({
      kind: 'setup.equipMarker',
      seat,
      window: 'setup.*',
      context: {
        key: item.key,
        equipmentId: item.equipmentId,
        name: e?.name ?? item.equipmentId,
        placing: item.kind,
        territory: territoryOf(s, seat),
        suggestion: spot,
      },
    })
    return
  }
  startDeploy(ctx)
}

function handleEquip(state: GameState, action: Action): Handled {
  if (action.type !== 'setup.equipMarker') return reject('E_WRONG_DECISION', 'expected an equipment placement')
  const h = handleEquipMarker(state, action.seat, action.payload)
  if ('rejection' in h) return h
  return {
    run(ctx) {
      h.run(ctx)
      ctx.state.equipment.turn = otherSeat(action.seat)
      continueEquipment(ctx)
    },
  }
}

function handleDropZone(state: GameState, action: Action): Handled {
  if (action.type !== 'setup.dropZone') return reject('E_WRONG_DECISION', 'expected a drop zone choice')
  const zoneId = action.payload.zoneId
  return {
    run(ctx) {
      const s = ctx.state
      const seat = action.seat
      s.players[seat].dropZoneId = zoneId
      ctx.emit({ type: 'DropZoneChosen', zoneId })
      const other = otherSeat(seat)
      if (s.players[other].dropZoneId === null) {
        s.setup.dropZoneTurn = other
        raiseDropZone(ctx, other)
      } else {
        s.setup.dropZoneTurn = null
        startEquipment(ctx)
      }
    },
  }
}

export const setupModule: ModuleDef = {
  id: 'setup',
  namespaces: ['setup'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'setup.initiative':
        return handleRollOff(state, action)
      case 'setup.decideInitiative':
        return handleDecideInitiative(state, action)
      case 'setup.dropZone':
        return handleDropZone(state, action)
      case 'setup.deploy':
        return handleDeploy(state, action)
      case 'setup.objective':
        return handleObjective(state, action)
      case 'setup.equipMarker':
        return handleEquip(state, action)
      default:
        return reject('E_TODO', `${pending.kind} is not implemented until M2b`)
    }
  },
}

/**
 * Deterministic grid scan for a legal set-up spot (used by bots, the invariant checker and tests so
 * a continuous deploy decision is never without a legal answer). `skip` rotates the starting spot.
 */
export function suggestPlacement(
  state: GameState,
  pending: PendingDecision,
  operativeId?: string,
  skip = 0,
): { operativeId: string; x: number; z: number; y: number } | null {
  const c = pending.constraints
  if (!c || c.kind !== 'deploy' || !c.region) return null
  const id = operativeId ?? c.operativeIds?.[0]
  const op = id ? state.operatives[id] : undefined
  if (!op) return null
  const box = polygonBBox(c.region)
  const step = 0.5
  const cols = Math.floor((box.maxX - box.minX) / step)
  const rows = Math.floor((box.maxZ - box.minZ) / step)
  const total = (cols + 1) * (rows + 1)
  for (let n = 0; n < total; n++) {
    const k = (n + skip) % total
    const x = round3(box.minX + (k % (cols + 1)) * step)
    const z = round3(box.minZ + Math.floor(k / (cols + 1)) * step)
    const pos = { x, y: 0, z }
    if (!circleInsidePolygon(pos, op.baseRadius, c.region)) continue
    if (placementProblem(state, { id: op.id, pos, radius: op.baseRadius, height: op.height })) continue
    return { operativeId: op.id, x, z, y: 0 }
  }
  return null
}
