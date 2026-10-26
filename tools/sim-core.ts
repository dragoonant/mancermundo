// Headless simulation core: two random-legal bots play seeded games while the invariants of
// docs/spec/60-testing.md section 3 are checked after every step. The game loop here (like the
// client store) is the only caller of `step`.
import { act } from '@/engine/actions'
import { effectiveApl } from '@/engine/state'
import { chargeUnderConceal, maxRepeats } from '@/engine/abilities'
import { enemiesInControlRange } from '@/engine/measure'
import { providerAny } from '@/engine/team-rules'
import { placementProblem, terrainOf } from '@/engine/terrain'
import {
  createGame,
  legalActions,
  replay,
  step,
  suggestPlacement,
  validate,
  view,
  SeededRng,
  type Action,
  type EngineBundle,
  type GameEvent,
  type GameSetup,
  type GameState,
  type PendingDecision,
  type Waypoint,
} from '@/engine'
import { polygonBBox, round3 } from '@/engine/geometry'
import { playableTeams, realSetup } from '@/engine/bundle'
import { flatMap, terrainMap } from '../tests/fixtures/maps'
import { makeSetup } from '../tests/fixtures/team'
import { createAiDecider } from '../src/ai/decider'
import type { Tier } from '../src/ai/tiers'

export interface Violation {
  rule: string
  message: string
  decision: number
}

export interface GameReport {
  game: number
  seed: string
  ended: boolean
  decisions: number
  turningPoints: number
  rejections: number
  violations: Violation[]
  hashMismatch: boolean
  actions: Action[]
}

export interface SimReport {
  games: number
  completed: number
  decisions: number
  rejections: number
  violations: number
  failing: GameReport[]
  ms: number
}

export const MAX_DECISIONS = 3000
export const STALL_LIMIT = 200

// ---------------------------------------------------------------------------
// Random-legal bot
// ---------------------------------------------------------------------------

export class RandomBot {
  private readonly rng: SeededRng
  constructor(seed: string) {
    this.rng = SeededRng.fromSeed(`bot:${seed}`)
  }

  float(): number {
    return this.rng.next32() / 0x100000000
  }

  int(n: number): number {
    return this.rng.int(n)
  }

  decide(state: GameState, pending: PendingDecision): Action {
    const legal = legalActions(state, pending)
    if (legal) return legal[this.int(legal.length)]!
    if (pending.kind === 'setup.deploy') return this.deploy(state, pending)
    if (pending.kind === 'move.path') return this.move(state, pending)
    if (pending.kind === 'setup.equipMarker') return this.equip(pending)
    if (pending.kind === 'marker.place') return this.place(state, pending)
    if (pending.canPass) return act.pass(pending)
    throw new Error(`bot cannot answer ${pending.kind}`)
  }

  /** M2b-game: equipment placement answers with the engine's own suggestion (a legal spot at the time the decision was raised). */
  private equip(pending: PendingDecision): Action {
    const s = pending.context.suggestion as { x: number; z: number; yaw: number }
    return { type: 'setup.equipMarker', seat: pending.seat, decisionId: pending.id, payload: { x: s.x, z: s.z, yaw: s.yaw } }
  }

  /** M2b-game: Place Marker puts the carried marker where the carrier stands, or cancels. */
  private place(state: GameState, pending: PendingDecision): Action {
    const op = state.operatives[String(pending.context.operativeId)]
    if (!op || this.float() < 0.3) return act.pass(pending)
    // batch C shared: a team spot filter lists the spots it accepts
    const spots = pending.context.spots as { x: number; z: number }[] | undefined
    const at = spots && spots.length > 0 ? spots[Math.floor(this.float() * spots.length)]! : { x: op.pos.x, z: op.pos.z }
    return { type: 'marker.place', seat: pending.seat, decisionId: pending.id, payload: at }
  }

  private deploy(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const ids = c.operativeIds!
    const box = polygonBBox(c.region!)
    for (let i = 0; i < 80; i++) {
      const id = ids[this.int(ids.length)]!
      const a = act.deploy(
        pending,
        id,
        round3(box.minX + this.float() * (box.maxX - box.minX)),
        round3(box.minZ + this.float() * (box.maxZ - box.minZ)),
      )
      if (!validate(state, a)) return a
    }
    const spot = suggestPlacement(state, pending, undefined, this.int(1000))
    if (!spot) throw new Error('no legal deploy spot')
    return act.deploy(pending, spot.operativeId, spot.x, spot.z, spot.y)
  }

  private move(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const op = state.operatives[c.operativeId!]!
    const enemies = Object.values(state.operatives).filter((o) => o.status === 'active' && o.seat !== op.seat)
    const idx = terrainOf(state.map)
    const vantage = idx.solids.filter((s) => s.floors.length > 0)
    const max = c.maxInches ?? 6
    const toward = (tx: number, tz: number, len: number): { x: number; z: number } => {
      const dx = tx - op.pos.x
      const dz = tz - op.pos.z
      const d = Math.hypot(dx, dz) || 1
      const l = Math.min(len, d)
      return { x: round3(op.pos.x + (dx / d) * l), z: round3(op.pos.z + (dz / d) * l) }
    }
    for (let i = 0; i < 80; i++) {
      let wps: Waypoint[]
      const roll = this.float()
      const nearest = enemies.length
        ? enemies.reduce((a, b) => (Math.hypot(a.pos.x - op.pos.x, a.pos.z - op.pos.z) < Math.hypot(b.pos.x - op.pos.x, b.pos.z - op.pos.z) ? a : b))
        : null
      if (c.kind === 'charge' && enemies.length > 0) {
        const e = this.float() < 0.6 && nearest ? nearest : enemies[this.int(enemies.length)]!
        const dx = e.pos.x - op.pos.x
        const dz = e.pos.z - op.pos.z
        const d = Math.hypot(dx, dz) || 1
        const stop = e.baseRadius + op.baseRadius + 0.05 + this.float() * 0.6
        wps = [{ x: round3(e.pos.x - (dx / d) * stop), z: round3(e.pos.z - (dz / d) * stop), y: e.pos.y }]
      } else if (c.kind === 'fallBack' && nearest) {
        const away = toward(2 * op.pos.x - nearest.pos.x, 2 * op.pos.z - nearest.pos.z, 1 + this.float() * Math.max(1, max - 1))
        wps = [{ x: away.x, z: away.z, y: op.pos.y }]
      } else if (op.pos.y > 2 && roll < 0.35) {
        // on Vantage: jump (to the floor or another roof) or just step off
        const ang = this.float() * Math.PI * 2
        const len = 1 + this.float() * 3
        const x = round3(op.pos.x + Math.sin(ang) * len)
        const z = round3(op.pos.z + Math.cos(ang) * len)
        wps = this.float() < 0.5 ? [{ x, z, y: this.float() < 0.5 ? 0 : op.pos.y, jump: true }] : [{ x, z, y: 0 }]
      } else if (roll < 0.3 && vantage.length > 0) {
        const s = vantage[this.int(vantage.length)]!
        const tx = round3(s.bbox.minX + this.float() * (s.bbox.maxX - s.bbox.minX))
        const tz = round3(s.bbox.minZ + this.float() * (s.bbox.maxZ - s.bbox.minZ))
        const d = Math.hypot(tx - op.pos.x, tz - op.pos.z)
        if (d <= max) wps = [{ x: tx, z: tz, y: s.floors[0] }]
        else {
          const w = toward(tx, tz, max)
          wps = [{ x: w.x, z: w.z, y: op.pos.y }]
        }
      } else if (roll < 0.55 && nearest) {
        const w = toward(nearest.pos.x, nearest.pos.z, 0.5 + this.float() * max)
        wps = [{ x: w.x, z: w.z, y: op.pos.y }]
      } else {
        const n = 1 + this.int(2)
        wps = []
        let x = op.pos.x
        let z = op.pos.z
        for (let k = 0; k < n; k++) {
          const ang = this.float() * Math.PI * 2
          const len = 0.5 + this.float() * Math.max(0.5, max / n - 0.5)
          x = round3(x + Math.sin(ang) * len)
          z = round3(z + Math.cos(ang) * len)
          wps.push({ x, z, y: op.pos.y })
        }
      }
      const a = act.path(pending, wps)
      if (!validate(state, a)) return a
    }
    return act.pass(pending)
  }
}

// ---------------------------------------------------------------------------
// Invariants (60-testing section 3)
// ---------------------------------------------------------------------------

function finiteState(s: GameState): string | null {
  for (const o of Object.values(s.operatives)) {
    for (const v of [o.pos.x, o.pos.y, o.pos.z, o.wounds, o.facing, o.baseRadius]) {
      if (!Number.isFinite(v)) return `operative ${o.id} has a non-finite number`
    }
  }
  for (const seat of ['A', 'B'] as const) {
    if (!Number.isFinite(s.players[seat].cp) || !Number.isFinite(s.players[seat].vp)) return `player ${seat} has a non-finite number`
  }
  return null
}

/** OperativeMoved actions another rule places the operative by (movement.applyForcedMove, Timesplinter): exempt from MOVE. */
export const FORCED_MOVES: ReadonlySet<string> = new Set(['forced', 'timesplinter'])

export function checkInvariants(prev: GameState, next: GameState, action: Action, events: GameEvent[]): string[] {
  const out: string[] = []
  const add = (rule: string, msg: string) => out.push(`${rule}: ${msg}`)

  const nf = finiteState(next)
  if (nf) add('finite', nf)

  for (const o of Object.values(next.operatives)) {
    if (o.wounds < 0 || o.wounds > o.maxWounds) add('wounds', `${o.id} has ${o.wounds}/${o.maxWounds}`)
    // an incapacitated operative stays until the whole Shoot/Fight action has finished (R-5.14), i.e. while `attack` is open
    if (o.status === 'active' && o.wounds <= 0 && !next.attack && !next.removal) add('SIM-004', `${o.id} is on the board with ${o.wounds} wounds`)
    if (o.status === 'active') {
      const problem = placementProblem(next, { id: o.id, pos: o.pos, radius: o.baseRadius, height: o.height })
      if (problem) add('SIM-007', `${o.id} at ${o.pos.x},${o.pos.y},${o.pos.z}: ${problem.reason}`)
    }
  }

  const act_ = next.firefight.activation
  if (act_) {
    const op = next.operatives[act_.operativeId]!
    // AP must be within the APL when it is spent: an APL that drops later in the activation (Medic!'s -1 on the saved
    // operative) does not make earlier spending illegal, so only a step that spends AP is checked, against the
    // higher of the APL before and after the step
    const before = prev.operatives[op.id]
    const cap = act_.counteract ? 0 : Math.max(effectiveApl(op), before ? effectiveApl(before) : 0)
    const spent = events.some((e) => e.type === 'ApSpent' && e.operativeId === op.id)
    if (!act_.counteract && spent && act_.apSpent > cap) add('SIM-005', `${op.id} spent ${act_.apSpent} AP with APL ${cap}`)
    // an action repeats only where a team rule allows it (ASTARTES, Krumpin' Time) or after a free action
    if (!act_.counteract && !act_.frame) {
      for (const a of new Set(act_.performed)) {
        const n = act_.performed.filter((p) => p === a).length
        if (n > maxRepeats(next, op, a, act_.performed) && !act_.performed.some((p) => p.startsWith('ability:'))) add('ORD-005', `${op.id} repeated an action: ${act_.performed.join(',')}`)
      }
    }
    if (op.order === 'conceal' && !act_.counteract) {
      if (act_.performed.includes('charge') && !chargeUnderConceal(next, op)) add('ORD-002', `${op.id} charged under Conceal`)
    }
  }

  for (const ev of events) {
    // ORD-002: a Conceal operative shoots only with a Silent weapon, or through a viewpoint / team rule that lets it
    // (Magnify). Checked once, on the step the weapon is picked, against the weapon actually used: the old check
    // (any Silent weapon carried, on every later step of the activation) both missed a non-Silent profile fired next
    // to a Silent one and flagged Magnify shots after the proxy had moved on.
    if (ev.type === 'ShootStarted') {
      const op = next.operatives[ev.operativeId]
      const silent = !!next.data.weapons[ev.weaponId]?.rules.some((r) => /silent$/i.test(r.rule))
      const viewpoint = (action.type === 'shoot.weapon' && action.payload.viewpointId) || next.attack?.viewpointId
      const counteract = next.firefight.activation?.counteract && next.firefight.activation.operativeId === op?.id
      if (op && op.order === 'conceal' && !silent && !counteract && !viewpoint && !providerAny(next, op, 'shootUnderConceal')) {
        add('ORD-002', `${op.id} shot ${ev.weaponId} under Conceal`)
      }
    }
    if (ev.type === 'DiceRolled') {
      for (const d of ev.dice) if (!Number.isInteger(d) || d < 1 || d > 6) add('dice', `die ${d} out of range`)
    }
    if (ev.type === 'OperativeMoved') {
      const op = next.operatives[ev.operativeId]!
      const inCr = enemiesInControlRange(next, op, op.seat).length > 0
      if (ev.action === 'charge' && !inCr) add('MOVE-006', `${op.id} charged but is not in an enemy control range`)
      // a forced move (Knux Smash pushes, Timesplinter's swap) is placed by another operative's rule: the mover's own
      // control range restrictions do not apply to it, so it may end in an enemy control range
      if (ev.action !== 'charge' && !FORCED_MOVES.has(ev.action) && inCr) add('MOVE', `${op.id} finished a ${ev.action} in an enemy control range`)
    }
  }

  for (const seat of ['A', 'B'] as const) {
    if (next.players[seat].cp < 0) add('SIM-005', `${seat} has ${next.players[seat].cp} CP`)
    // VP only falls when an incapacitated operative returns (Reanimation Protocols, reserve returns): the kill
    // grade drops and missions.onOperativeReturned takes the kill op VP back with a negative VpScored. Any other
    // loss, or a loss bigger than those events, is a bug.
    const returned = events.some((e) => e.type === 'OperativeReturned')
    const takenBack = returned
      ? events.reduce((n, e) => (e.type === 'VpScored' && e.seat === seat && e.amount < 0 ? n - e.amount : n), 0)
      : 0
    if (next.players[seat].vp < prev.players[seat].vp - takenBack) add('vp', `${seat} lost VP (${prev.players[seat].vp} -> ${next.players[seat].vp}${returned ? `, ${takenBack} taken back by a return` : ''})`)
    if (next.players[seat].vp > 99) add('vp', `${seat} has implausible VP`)
  }
  if (next.seq !== prev.seq + 1) add('seq', `seq jumped from ${prev.seq} to ${next.seq}`)
  if (next.turningPoint > 4) add('SIM-003', `turning point ${next.turningPoint}`)

  if (next.phase === 'ended') {
    if (next.pending) add('pending', 'a pending decision remains after the battle ended')
  } else if (!next.pending) {
    add('pending', 'no pending decision before the battle ended')
  } else {
    const legal = legalActions(next, next.pending)
    if (legal === null) {
      if (!next.pending.canPass) {
        if (next.pending.kind === 'setup.deploy') {
          if (!suggestPlacement(next, next.pending)) add('SIM-001', 'no legal deploy spot exists')
        } else if (next.pending.kind === 'setup.equipMarker') {
          if (!next.pending.context.suggestion) add('SIM-001', 'no suggested equipment spot')
        } else add('SIM-001', `${next.pending.kind} is continuous with no way to pass`)
      }
    } else {
      if (legal.length === 0) add('SIM-001', `${next.pending.kind} has no legal action`)
      for (const a of legal) {
        const rej = validate(next, a)
        if (rej) add('SIM-001', `a listed action fails validate: ${a.type} ${rej.code} ${rej.reason}`)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function progressKey(s: GameState): string {
  const a = s.firefight.activation
  const ready = Object.values(s.operatives).filter((o) => o.ready).length
  const placed = Object.values(s.operatives).filter((o) => o.status === 'active').length
  return `${s.phase}|${s.turningPoint}|${ready}|${placed}|${a ? `${a.operativeId}:${a.apSpent}:${a.performed.length}` : '-'}|${s.players.A.cp}|${s.players.B.cp}`
}

export function playGame(setup: GameSetup, bundle: EngineBundle, seed: string, game = 0): GameReport {
  const violations: Violation[] = []
  const bots = { A: new RandomBot(`${seed}:A`), B: new RandomBot(`${seed}:B`) }
  // `--decider easy|normal` (sim.ts passes argv through): both seats play with the AI instead of the random bot
  const tierArg = process.argv.includes('--decider') ? (process.argv[process.argv.indexOf('--decider') + 1] as Tier) : null
  const ai = tierArg ? { A: createAiDecider(tierArg, { seed: `${seed}:A` }), B: createAiDecider(tierArg, { seed: `${seed}:B` }) } : null
  let result = createGame(setup, seed, bundle)
  let state = result.state
  const hashes: string[] = [state.hash]
  let decisions = 0
  let rejections = 0
  let stall = 0
  let lastKey = progressKey(state)
  let hashMismatch = false

  const violate = (rule: string, message: string) => violations.push({ rule, message, decision: decisions })

  while (state.pending && decisions < MAX_DECISIONS) {
    const pending = state.pending
    const pv = view(state, pending.seat)
    void pv // deciders only ever see the redacted view; the bot reads engine state through helpers above
    let action: Action
    try {
      action = ai ? ai[pending.seat].decideSync(pv, pending, legalActions(state, pending)).action : bots[pending.seat].decide(state, pending)
    } catch (e) {
      violate('bot', (e as Error).message)
      break
    }
    decisions++
    const prev = state
    let r
    try {
      r = step(state, action)
    } catch (e) {
      violate('SIM-002', `step threw: ${(e as Error).message}`)
      break
    }
    if (r.rejection) {
      rejections++
      violate('bot-rejection', `${action.type}: ${r.rejection.code} ${r.rejection.reason}`)
      break
    }
    state = r.state
    hashes.push(state.hash)
    for (const m of checkInvariants(prev, state, action, r.events)) violate('invariant', m)
    const key = progressKey(state)
    if (key === lastKey) stall++
    else stall = 0
    lastKey = key
    if (stall >= STALL_LIMIT) {
      violate('stall', `${STALL_LIMIT} decisions without progress at ${key}`)
      break
    }
    if (violations.length > 5) break
  }
  const ended = state.phase === 'ended'
  if (!ended && violations.length === 0) violate('SIM-003', `game did not end within ${MAX_DECISIONS} decisions`)

  // SIM-006: the same seed and the same action list reproduce every hash.
  if (violations.length === 0) {
    const rep = replay(setup, seed, state.log, bundle)
    if (rep.rejection || rep.hashes.length !== hashes.length || rep.hashes.some((h, i) => h !== hashes[i])) {
      hashMismatch = true
      violate('SIM-006', 'replay did not reproduce the recorded hashes')
    }
  }
  return {
    game,
    seed,
    ended,
    decisions,
    turningPoints: state.turningPoint,
    rejections,
    violations,
    hashMismatch,
    actions: state.log,
  }
}

export interface SimOptions {
  games: number
  seed: string
  setupFor: (game: number) => GameSetup
  bundle: EngineBundle
  onGame?: (r: GameReport) => void
}

export function runSim(opts: SimOptions): SimReport {
  const t0 = Date.now()
  const failing: GameReport[] = []
  let completed = 0
  let decisions = 0
  let rejections = 0
  let violations = 0
  for (let g = 0; g < opts.games; g++) {
    const r = playGame(opts.setupFor(g), opts.bundle, `${opts.seed}-${g}`, g)
    if (r.ended && r.violations.length === 0) completed++
    decisions += r.decisions
    rejections += r.rejections
    violations += r.violations.length
    if (r.violations.length > 0 || !r.ended) failing.push(r)
    opts.onGame?.(r)
  }
  return { games: opts.games, completed, decisions, rejections, violations, failing, ms: Date.now() - t0 }
}

/** Roster sizes cycle so batch set-up is exercised; odd games use the terrain layout. */
export function setupFor(game: number): GameSetup {
  const sizes = [3, 3, 6, 4]
  const size = sizes[game % sizes.length]!
  return makeSetup({ map: game % 2 === 0 ? flatMap() : terrainMap(), sizeA: size, sizeB: size })
}

/**
 * M2b-game: every pairing of the playable teams (team.json `playable` not false) with their default rosters,
 * built through the data adapter. With only Angels of Death and Kommandos playable this is exactly the
 * original AoD-vs-Kommandos rotation. Seats swap every game, the pairing changes every two games, and the
 * killzone layouts rotate; each official card plays its own map, the engine rolls the crit op, and the bots place the objective
 * markers and the equipment themselves.
 */
export function realSetupFor(bundle: EngineBundle): (game: number) => GameSetup {
  const layouts = Object.keys(bundle.layouts ?? {}).sort()
  const teams = playableTeams(bundle)
  const n = teams.length
  // M10 batch D shared: game g fills seat slots 2g and 2g + 1 of a sequence that lists every playable team once per
  // cycle of n slots (cycle c orders them j * m_c + c mod n, m_c a multiplier coprime with n), so over G games every
  // team plays at least floor(2G / n) times (40 games, 24 teams: 3 each) and the opponents change with m_c; the lower
  // team index takes seat A in even games, seat B in odd ones (two teams: the original AoD-vs-Kommandos rotation).
  const mults: number[] = []
  for (let m = 1; m <= n - 2; m++) if (gcd(m, n) === 1) mults.push(m)
  if (mults.length === 0) mults.push(1)
  const slotTeam = (k: number): number => {
    const c = Math.floor(k / n)
    return ((k % n) * mults[c % mults.length]! + c) % n
  }
  return (game) => {
    const swap = game % 2 === 1
    const i = slotTeam(2 * game)
    const j = n > 1 ? slotTeam(2 * game + 1) : i
    const a = teams[Math.min(i, j)]!
    const b = teams[Math.max(i, j)]!
    return realSetup(bundle, {
      teams: swap ? [b, a] : [a, b],
      layoutId: layouts[game % layouts.length]!,
    })
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
