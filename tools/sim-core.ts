// Headless simulation core: two random-legal bots play seeded games while the invariants below are checked after every step.
// The game loop here (like the client store) is the only caller of `step`. A game ends by its scenario (the round-end check of
// R-5.8 / M-1.9, a forfeit, a conceded locked win); the optional round cap (`GameSetup.options.maxRounds`, reason 'roundLimit')
// is for the older short-game gates only. Invariants checked after every step include the End phase ones: a bottled gang
// never recovers, points never fall, fled fighters are Out of Action for the Bottle test and the scenario, and every game
// ends within MAX_ROUNDS rounds and MAX_DECISIONS decisions with no STALL_LIMIT-decision stretch of non-progress.
import {
  createGame,
  legalActions,
  replay,
  step,
  suggest,
  validate,
  view,
  SeededRng,
  act,
  type Action,
  type EngineBundle,
  type GameEvent,
  type GameSetup,
  type GameState,
  type PendingDecision,
  type Seat,
} from '@/engine'
import { circleOverlapsPolygon, polygonBBox, round3, segmentPolygonIntervals } from '@/engine/geometry'
import { cloneState } from '@/engine/state'
import { insideOutline } from '@/engine/board'
import { baseGap } from '@/engine/measure'
import { groupSize } from '@/engine/activation'
import { downCount } from '@/engine/casualties'
import { approachPoint, planToward, shortestLegalPath } from '@/engine/movement'
import type { VoluntaryKind } from '@/engine/movement'

export interface Violation {
  rule: string
  message: string
  decision: number
}

/** One finished game, for the report tables. */
export interface GameSummary {
  scenarioId: string
  boardId: string
  /** houses by seat */
  houses: Record<Seat, string>
  winner: Seat | 'draw' | null
  winnerHouse: string | null
  reason: string | null
  rounds: number
  /** the round in which the first gang bottled (null: nobody did) */
  bottleRound: number | null
  voluntaryBottle: boolean
  casualties: number
  points: Record<Seat, number>
  lockedWin: boolean
  decisions: number
}

export interface GameReport {
  game: number
  seed: string
  ended: boolean
  decisions: number
  rounds: number
  rejections: number
  violations: Violation[]
  hashMismatch: boolean
  actions: Action[]
  /** counters for the summary line */
  stats: Record<string, number>
  summary: GameSummary
}

export interface SimReport {
  games: number
  completed: number
  decisions: number
  rejections: number
  violations: number
  failing: GameReport[]
  stats: Record<string, number>
  /** casualty-log entries (Seriously Injured and Out of Action) of each game, in game order */
  casualtiesPerGame: number[]
  summaries: GameSummary[]
  ms: number
}

export const MAX_DECISIONS = 4000
/** Every game must end by its scenario within this many rounds. */
export const MAX_ROUNDS = 20
export const STALL_LIMIT = 200

// ---------------------------------------------------------------------------
// Random-legal bot
// ---------------------------------------------------------------------------

/**
 * How eagerly the sim bots pick each action type (default 1). Pure uniform play hides and crawls (Take Cover and Crawl are
 * two of the ten types on offer), so battles never reach a casualty and never end; these weights make the bots fight, which is
 * what the End phase and scenario code need to see. They are test bots, not a player model (that is src/ai).
 */
const ACTION_WEIGHTS: Record<string, number> = {
  end: 0.2,
  turn: 0.3,
  takeCover: 0.15,
  crawl: 0.15,
  standUp: 1.5,
  reload: 1.5,
  shoot: 3,
  aim: 0.3,
  blindFire: 0.5,
  charge: 3,
  fight: 3,
  coupDeGrace: 3,
  retreat: 0.5,
  runForCover: 1,
  move: 3,
  // doors stand between the gangs: opening them is how the battle starts
  operateDoor: 5,
  accessTerminal: 6,
  forceDoor: 6,
}

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
    if (legal) {
      if (pending.kind === 'action.choose') return this.choose(state, legal)
      // crews: pick fighters up to the cap instead of stopping at once, so games are played with real crews
      if (pending.kind === 'setup.crew') {
        const picks = legal.filter((a) => a.type === 'setup.crew' && a.payload.fighterId)
        if (picks.length > 0) return picks[this.int(picks.length)]!
      }
      // shots go at fighters far more often than at doors or empty floor
      if (pending.kind === 'shoot.target' && this.float() < 0.85) {
        const fighters = legal.filter((a) => a.type === 'shoot.target' && a.payload.targetId)
        if (fighters.length > 0) return fighters[this.int(fighters.length)]!
      }
      // the Bottle test is usually taken; bottling out by choice is the rare branch the sim must still reach
      if (pending.kind === 'end.bottle' && this.float() < 0.85) return legal.find((a) => a.type === 'end.bottle' && a.payload.choice === 'test') ?? legal[0]!
      // a locked Smash & Grab win: half of the time play on
      if (pending.kind === 'confirm') return legal.find((a) => a.type === 'confirm' && a.payload.choice === (this.float() < 0.5 ? 'continue' : 'concede')) ?? legal[0]!
      return legal[this.int(legal.length)]!
    }
    if (pending.kind === 'setup.deploy') return this.deploy(state, pending)
    if (pending.kind === 'move.path') return this.move(state, pending)
    const s = suggest(state, pending)
    if (s) return s
    if (pending.canPass) return act.pass(pending)
    throw new Error(`bot cannot answer ${pending.kind}`)
  }

  /** Pick an action type uniformly first (so a rare option such as a door is not drowned by 18 turn facings), then an option of it. */
  private choose(state: GameState, legal: Action[]): Action {
    const groups = new Map<string, Action[]>()
    for (const a of legal) {
      const key = a.type === 'action.choose' ? a.payload.action : a.type
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(a)
    }
    // a bot that wants a door wants it open: with only 'close' options on offer it nearly always looks elsewhere
    const doorOpts = groups.get('operateDoor')
    if (doorOpts && !doorOpts.some((a) => a.type === 'action.choose' && a.payload.doorId && (state.board.doors[a.payload.doorId]?.state ?? 'closed') === 'closed') && this.float() < 0.9) groups.delete('operateDoor')
    const keys = [...groups.keys()]
    // finishing early and turning are less interesting than acting: half weight; close combat a little more (so the sim exercises it)
    const weights = keys.map((k) => ACTION_WEIGHTS[k] ?? 1)
    let roll = this.float() * weights.reduce((x, y) => x + y, 0)
    let pickKey = keys[keys.length - 1]!
    for (let i = 0; i < keys.length; i++) {
      roll -= weights[i]!
      if (roll < 0) {
        pickKey = keys[i]!
        break
      }
    }
    let list = groups.get(pickKey)!
    // a bot that wants a door mostly wants it open
    if (pickKey === 'operateDoor' && this.float() < 0.85) {
      const opens = list.filter((a) => a.type === 'action.choose' && !a.payload.facing && a.payload.doorId && ((state.board.doors[a.payload.doorId]?.state ?? 'closed') === 'closed'))
      if (opens.length > 0) list = opens
    }
    return list[this.int(list.length)]!
  }

  private deploy(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const ids = c.fighterIds!
    const box = polygonBBox(c.region!)
    const placed = Object.values(state.fighters).filter((f) => f.location === 'board')
    // part of the time the engine's own spot, so a tile strip crowded with walls and obstacles is never packed full by chance
    // (a tile strip, Forgotten Riches, is always the engine's: random packing can leave the last fighters no room)
    if (state.data.scenario.deployment.kind === 'tile' || this.float() < 0.4) {
      const sug = suggest(state, pending)
      if (sug) return sug
    }
    for (let i = 0; i < 80; i++) {
      const id = ids[this.int(ids.length)]!
      const me = state.fighters[id]!
      const a = act.deploy(
        pending,
        id,
        round3(box.minX + this.float() * (box.maxX - box.minX)),
        round3(box.minZ + this.float() * (box.maxZ - box.minZ)),
        round3((this.float() - 0.5) * 2 * Math.PI),
      )
      const p = a.payload
      if (placed.some((g) => Math.hypot(g.pos.x - p.x, g.pos.z - p.z) < g.baseRadius + me.baseRadius + 0.3)) continue
      if (!validate(state, a)) return a
    }
    const s = suggest(state, pending)
    if (!s) throw new Error('no legal deploy spot')
    return s
  }

  /**
   * Where to stand to deal with the first closed door on the way to `target`: the route is planned as if every door were open
   * and cut just before the first closed door it crosses. Null when no route exists or the fighter is already there.
   */
  private doorSpot(state: GameState, f: GameState['fighters'][string], target: { x: number; z: number }): { x: number; z: number } | null {
    const open = cloneState(state)
    for (const rec of Object.values(open.board.doors)) if (rec.state === 'closed') rec.state = 'open'
    const route = shortestLegalPath(open, open.fighters[f.id]!, target, false)
    if (!route) return null
    let prev = { x: f.pos.x, z: f.pos.z }
    for (const wp of route) {
      const len = Math.hypot(wp.x - prev.x, wp.z - prev.z)
      for (const d of state.board.def.doors) {
        if (state.board.doors[d.id]?.state !== 'closed') continue
        const iv = segmentPolygonIntervals(prev, wp, d.poly)
        if (iv.length === 0 || len < 1e-6) continue
        // a locked door is opened from a terminal on this side (Access Terminal), so walk to the nearest one
        if (state.board.doors[d.id]?.locked && d.terminals.length > 0) {
          const term = d.terminals.reduce((a, b) => (Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) <= Math.hypot(b.pos.x - f.pos.x, b.pos.z - f.pos.z) ? a : b))
          return Math.hypot(term.pos.x - f.pos.x, term.pos.z - f.pos.z) < 0.3 ? null : { x: round3(term.pos.x), z: round3(term.pos.z) }
        }
        const t = Math.max(0, iv[0]![0] - 0.8 / len)
        const at = { x: round3(prev.x + (wp.x - prev.x) * t), z: round3(prev.z + (wp.z - prev.z) * t) }
        return Math.hypot(at.x - f.pos.x, at.z - f.pos.z) < 0.3 ? null : at
      }
      prev = wp
    }
    return null
  }

  private move(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const f = state.fighters[c.fighterId!]!
    const max = c.maxInches ?? 0
    const enemies = Object.values(state.fighters).filter((e) => e.location === 'board' && e.seat !== f.seat)
    const byDistance = enemies.slice().sort((a, b) => Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) - Math.hypot(b.pos.x - f.pos.x, b.pos.z - f.pos.z))
    const nearest = byDistance[0] ?? null
    const kind = c.kind as VoluntaryKind
    // the way to the enemy: the closest enemy there is a legal route to, else the first closed door on the way to one (planned once per move)
    let toward: { x: number; z: number }[] | null | undefined
    const towardEnemy = (): { x: number; z: number }[] | null => {
      if (toward !== undefined) return toward
      toward = null
      for (const e of byDistance.slice(0, 6)) {
        const w = planToward(state, f, kind, max, approachPoint(state, f, e))
        if (w && w.length > 0) return (toward = w)
      }
      if (kind === 'move') {
        for (const e of byDistance.slice(0, 2)) {
          const door = this.doorSpot(state, f, approachPoint(state, f, e))
          const w = door ? planToward(state, f, kind, max, door) : null
          if (w && w.length > 0) return (toward = w)
        }
      }
      return toward
    }
    for (let i = 0; i < 60; i++) {
      const roll = this.float()
      let wps: { x: number; z: number }[] | null = null
      // half of the moves step toward the nearest enemy, so fighters meet and the close-combat code runs
      if (roll < 0.9 && nearest) {
        wps = towardEnemy()
      } else if (roll < 0.95) {
        // toward a random board point by the engine's own route
        const to = { x: round3((this.float() - 0.5) * 22), z: round3((this.float() - 0.5) * 34) }
        wps = planToward(state, f, kind, max, to)
      } else {
        const n = 1 + this.int(3)
        let x = f.pos.x
        let z = f.pos.z
        wps = []
        for (let k = 0; k < n; k++) {
          const ang = this.float() * Math.PI * 2
          const len = 0.25 + this.float() * Math.max(0.25, max / n)
          x = round3(x + Math.sin(ang) * len)
          z = round3(z + Math.cos(ang) * len)
          wps.push({ x, z })
        }
      }
      if (!wps || wps.length === 0) continue
      const facing = this.float() < 0.3 ? round3((this.float() - 0.5) * 2 * Math.PI) : undefined
      const a = act.path(pending, wps, facing)
      if (!validate(state, a)) return a
    }
    if (kind === 'takeCover') {
      const a = act.path(pending, [])
      if (!validate(state, a)) return a
    }
    // a Retreat cannot be passed once its dice are rolled: take the engine's suggestion
    if (!pending.canPass) {
      const s = suggest(state, pending)
      if (s) return s
    }
    return act.pass(pending)
  }
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

const VOLUNTARY: ReadonlySet<string> = new Set(['move', 'takeCover', 'crawl', 'carry', 'retreat', 'consolidate', 'runForCover'])

export function checkInvariants(prev: GameState, next: GameState, action: Action, events: GameEvent[]): string[] {
  const out: string[] = []
  const add = (rule: string, msg: string) => out.push(`${rule}: ${msg}`)

  for (const f of Object.values(next.fighters)) {
    for (const v of [f.pos.x, f.pos.y, f.pos.z, f.facing, f.baseRadius, f.wounds, f.fleshWounds]) {
      if (!Number.isFinite(v)) {
        add('finite', `fighter ${f.id} has a non-finite number`)
        break
      }
    }
    if (f.wounds < 0 || f.wounds > f.maxWounds) add('wounds', `${f.id} has ${f.wounds}/${f.maxWounds} wounds`)
    if (f.fleshWounds < 0 || f.fleshWounds > f.stats.T) add('flesh', `${f.id} has ${f.fleshWounds} Flesh Wounds with T ${f.stats.T}`)
    if (f.location !== 'board') {
      if (f.engagedWith.length > 0) add('STATUS', `${f.id} is ${f.location} and still Engaged`)
      continue
    }
    const c = { x: f.pos.x, z: f.pos.z }
    if (!insideOutline(next.board.def, c)) add('SIM-007', `${f.id} is off the board at ${c.x},${c.z}`)
    for (const w of next.board.def.walls) if (circleOverlapsPolygon(c, f.baseRadius, w.poly)) add('SIM-007', `${f.id} overlaps wall ${w.id}`)
    for (const d of next.board.def.doors) {
      if (next.board.doors[d.id]?.state === 'closed' && circleOverlapsPolygon(c, f.baseRadius, d.poly)) add('SIM-007', `${f.id} overlaps closed door ${d.id}`)
    }
    for (const o of next.board.def.obstacles) if (circleOverlapsPolygon(c, f.baseRadius, o.poly)) add('SIM-007', `${f.id} stands on obstacle ${o.id}`)
    for (const g of Object.values(next.fighters)) {
      if (g.id <= f.id || g.location !== 'board') continue
      if (Math.hypot(g.pos.x - f.pos.x, g.pos.z - f.pos.z) < f.baseRadius + g.baseRadius - 1e-6) add('SIM-007', `${f.id} overlaps ${g.id}`)
    }
    // engagement rules
    if (f.engagedWith.length > 0) {
      if (f.posture !== 'standing') add('STATUS', `${f.id} is ${f.posture} and Engaged`)
      for (const id of f.engagedWith) {
        const e = next.fighters[id]
        if (!e || e.posture !== 'standing' || e.location !== 'board') add('STATUS', `${f.id} is Engaged with ${id} which is not Standing on the board`)
        else if (e.seat === f.seat) add('STATUS', `${f.id} is Engaged with a friend ${id}`)
      }
    }
  }

  const a = next.action.activation
  if (a) {
    if (a.actionsLeft < 0 || a.actionsLeft > 2) add('ACT', `${a.fighterId} has ${a.actionsLeft} actions left`)
    const spent = a.performed.reduce((n, p) => n + (p.type === 'double' ? 2 : p.type === 'free' ? 0 : 1), 0)
    if (spent > Math.max(2, a.allowance ?? 2)) add('ACT', `${a.fighterId} spent ${spent} actions: ${a.performed.map((p) => p.action).join(',')}`)
    if (spent + a.actionsLeft !== (a.allowance ?? 2)) add('ACT', `${a.fighterId} spent ${spent} with ${a.actionsLeft} left of ${a.allowance ?? 2}`)
    const basics = a.performed.filter((p) => p.type === 'basic').map((p) => p.action)
    if (new Set(basics).size !== basics.length) add('ACT', `${a.fighterId} repeated a Basic action: ${basics.join(',')}`)
    a.performed.forEach((p, i) => {
      if (p.type === 'double' && i > 0 && a.performed.slice(0, i).some((q) => q.type !== 'free')) add('ACT', `${a.fighterId} did a Double after another action`)
    })
  }
  if (next.action.group && next.action.group.members.length > groupSize(next, next.fighters[next.action.group.leaderId]!)) add('GROUP', `a group of ${next.action.group.members.length} members`)

  for (const ev of events) {
    if (ev.type === 'DiceRolled') {
      if (ev.die === 'scatter') {
        for (const d of ev.dice) if (!Number.isInteger(d) || d < 0 || d >= 360) add('dice', `scatter ${d} out of range`)
      } else {
        for (const d of ev.dice) if (!Number.isInteger(d) || d < 1 || d > 6) add('dice', `die ${d} out of range`)
        if (ev.faces) for (const face of ev.faces) if (typeof face !== 'string' || face === '') add('dice', 'a die face has no name')
      }
    }
    // a Retreat with no end point clear of every enemy slides straight away from the nearest engaging enemy (R-7.9 ruling): the engine's own move, not an answered path
    const slid = ev.type === 'FighterMoved' && ev.kind === 'retreat' && action.type !== 'move.path'
    if (ev.type === 'FighterMoved' && VOLUNTARY.has(ev.kind) && !slid) {
      const f = next.fighters[ev.fighterId]!
      for (const e of Object.values(next.fighters)) {
        if (e.location !== 'board' || e.seat === f.seat || e.posture === 'seriouslyInjured') continue
        const gap = baseGap(f, e)
        const startGap = Math.hypot(e.pos.x - ev.from.x, e.pos.z - ev.from.z) - e.baseRadius - f.baseRadius
        if (gap < 1 - 1e-6 && gap < startGap - 1e-6) add('MOVE', `${f.id} ended a ${ev.kind} ${gap.toFixed(2)}" from ${e.id}`)
      }
      if (ev.length > ev.maxInches + 0.005) add('MOVE', `${f.id} moved ${ev.length} of ${ev.maxInches}`)
    }
  }

  // --- End phase and scenario invariants (S4) ---
  for (const seat of ['A', 'B'] as const) {
    const was = prev.players[seat]
    const now = next.players[seat]
    if (was.bottled && !now.bottled) add('END-002', `gang ${seat} was bottled and is not any more`)
    if (was.bottledVoluntarily && !now.bottledVoluntarily) add('END-002', `gang ${seat} lost its voluntary bottle`)
    if (now.bottledVoluntarily && !now.bottled) add('END-002', `gang ${seat} bottled voluntarily without bottling`)
    if (now.points < was.points) add('SCORE', `gang ${seat} points fell from ${was.points} to ${now.points}`)
    if (next.scenario.points[seat] !== now.points) add('SCORE', `scenario points of ${seat} (${next.scenario.points[seat]}) differ from the player's (${now.points})`)
  }
  for (const f of Object.values(next.fighters)) {
    const was = prev.fighters[f.id]
    if (was && (was.location === 'fled' || was.location === 'outOfAction') && f.location !== was.location) add('STATUS', `${f.id} left ${was.location} for ${f.location}`)
    if (f.location === 'fled' && (f.ready || f.carrying || f.engagedWith.length > 0)) add('END-003', `fled fighter ${f.id} still has Ready, a casket or an engagement`)
  }
  for (const ev of events) {
    if (ev.type === 'BottleTest') {
      const down = downCount(prev, ev.seat)
      if (ev.down !== down) add('END-001', `Bottle test of ${ev.seat} counted ${ev.down} down, the state had ${down} (fled count as Out of Action)`)
      if (ev.crew !== prev.players[ev.seat].startingCrew) add('END-001', `Bottle test of ${ev.seat} used crew ${ev.crew}, not ${prev.players[ev.seat].startingCrew}`)
      if (ev.bottled !== (ev.voluntary || ev.roll + ev.down > ev.crew)) add('END-001', `Bottle test of ${ev.seat}: ${ev.roll} + ${ev.down} vs ${ev.crew} gave bottled=${ev.bottled}`)
      if (prev.players[ev.seat].bottled) add('END-002', `gang ${ev.seat} tested again after bottling`)
    }
    if (ev.type === 'FighterFled') {
      const f = next.fighters[ev.fighterId]!
      if (f.location !== 'fled') add('END-003', `${f.id} fled but is ${f.location}`)
      if (!next.casualties.some((c) => c.fighterId === f.id && c.kind === 'fled')) add('END-003', `${f.id} fled with no casualty record`)
      const scores = prev.data.scenario.scoring.some((r) => (r as { on?: string }).on === 'fighterFled')
      if (scores && !events.some((e) => e.type === 'PointsScored' && e.reason === `fled:${f.id}`)) add('SCORE', `${f.id} fled and the other gang scored nothing`)
    }
    if (ev.type === 'FighterOutOfAction') {
      const scores = prev.data.scenario.scoring.some((r) => (r as { on?: string }).on === 'fighterOutOfAction')
      if (scores && !events.some((e) => e.type === 'PointsScored' && e.reason === `outOfAction:${ev.fighterId}`)) add('SCORE', `${ev.fighterId} went Out of Action and the other gang scored nothing`)
    }
  }
  if (next.phase !== 'ended' && next.round > MAX_ROUNDS) add('SIM-003', `round ${next.round}: the battle has not ended by round ${MAX_ROUNDS}`)
  if (next.phase === 'ended' && next.result && prev.phase !== 'ended') {
    const r = next.result
    if (r.reason === 'roundLimit' && next.origin.setup.options?.maxRounds === undefined) add('SIM-003', 'the battle ended at a round limit nobody set')
    if (r.reason === 'resign') add('SIM-003', 'a bot resigned')
    if (r.points.A !== next.players.A.points || r.points.B !== next.players.B.points) add('SCORE', 'the result points differ from the gangs')
    const v = next.data.scenario.victory
    if (r.reason === 'scenario' && 'by' in v && v.by === 'points') {
      const want = r.points.A === r.points.B ? 'draw' : r.points.A > r.points.B ? 'A' : 'B'
      if (r.winner !== want) add('SCORE', `winner ${r.winner} against points ${r.points.A}-${r.points.B}`)
    }
  }

  if (next.seq !== prev.seq + 1) add('seq', `seq jumped from ${prev.seq} to ${next.seq}`)
  if (next.phase === 'ended') {
    if (next.pending) add('pending', 'a pending decision remains after the battle ended')
    if (!next.result) add('pending', 'the battle ended with no result')
  } else if (!next.pending) {
    add('pending', 'no pending decision before the battle ended')
  } else {
    const p = next.pending
    const legal = legalActions(next, p)
    if (legal === null) {
      if (!p.canPass) {
        const s = suggest(next, p)
        if (!s) add('SIM-001', `${p.kind} is continuous with no way to pass and no suggestion`)
        else {
          const rej = validate(next, s)
          if (rej) add('SIM-001', `the suggestion for ${p.kind} fails validate: ${rej.code} ${rej.reason}`)
        }
      }
    } else {
      if (legal.length === 0) add('SIM-001', `${p.kind} has no legal action`)
      for (const l of legal) {
        const rej = validate(next, l)
        if (rej) add('SIM-001', `a listed action fails validate: ${l.type} ${rej.code} ${rej.reason}`)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function progressKey(s: GameState): string {
  const a = s.action.activation
  const ready = Object.values(s.fighters).filter((f) => f.ready).length
  const deployed = Object.values(s.fighters).filter((f) => f.location === 'board').length
  const e = s.end
  const endKey = `${e.step}:${e.bottleQueue.length}:${e.recoveryQueue.length}:${e.assistSeats.length}:${Object.keys(e.assists).length}:${e.assistsUsed.length}`
  const setupKey = `${s.setup.step}|${s.setup.crewDone.length}|${s.setup.crewPicks.A.length + s.setup.crewPicks.B.length}|${Object.keys(s.board.caskets).length}|${Object.keys(s.setup.zoneChoices).length}`
  const gone = Object.values(s.fighters).filter((f) => f.location === 'fled' || f.location === 'outOfAction').length
  return `${s.phase}|${s.round}|${ready}|${deployed}|${gone}|${a ? `${a.fighterId}:${a.actionsLeft}:${a.performed.length}` : '-'}|${setupKey}|${endKey}|${s.action.flightDone.length}|${s.scenario.locked?.asked ? 1 : 0}`
}

const bump = (stats: Record<string, number>, key: string, n = 1) => {
  stats[key] = (stats[key] ?? 0) + n
}

export function playGame(setup: GameSetup, bundle: EngineBundle, seed: string, game = 0): GameReport {
  const violations: Violation[] = []
  const stats: Record<string, number> = {}
  const bots = { A: new RandomBot(`${seed}:A`), B: new RandomBot(`${seed}:B`) }
  const result = createGame(setup, seed, bundle)
  let state = result.state
  const hashes: string[] = [state.hash]
  let decisions = 0
  let rejections = 0
  let stall = 0
  let lastKey = progressKey(state)
  let hashMismatch = false
  let bottleRound: number | null = null
  let voluntaryBottle = false
  const violate = (rule: string, message: string) => violations.push({ rule, message, decision: decisions })

  while (state.pending && decisions < MAX_DECISIONS) {
    const pending = state.pending
    void view(state, pending.seat) // deciders only ever see the redacted view; the bot reads engine state through helpers
    let action: Action
    try {
      action = bots[pending.seat].decide(state, pending)
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
      violate('SIM-002', `step threw: ${(e as Error).stack ?? (e as Error).message}`)
      break
    }
    if (r.rejection) {
      rejections++
      violate('bot-rejection', `${action.type}: ${r.rejection.code} ${r.rejection.reason}`)
      break
    }
    state = r.state
    hashes.push(state.hash)
    for (const ev of r.events) {
      if (ev.type === 'FighterMoved') bump(stats, `moved:${ev.kind}`)
      else if (ev.type === 'DoorChanged') bump(stats, `door:${ev.state}`)
      else if (ev.type === 'GroupNominated') bump(stats, 'groups')
      else if (ev.type === 'ActivationEnded') bump(stats, 'activations')
      else if (ev.type === 'DuctUsed') bump(stats, 'ducts')
      else if (ev.type === 'EngagementChanged' && ev.engagedWith.length > 0) bump(stats, 'engaged')
      else if (ev.type === 'ShootStarted') bump(stats, 'shots')
      else if (ev.type === 'HitRolled' && ev.hit) bump(stats, 'hits')
      else if (ev.type === 'FighterPinned') bump(stats, 'pinned')
      else if (ev.type === 'BlastPlaced') bump(stats, 'blasts')
      else if (ev.type === 'TemplatePlaced') bump(stats, 'templates')
      else if (ev.type === 'StrayShot' && ev.hit) bump(stats, 'strayHits')
      else if (ev.type === 'FleshWound') bump(stats, 'fleshWounds')
      else if (ev.type === 'StatusChanged' && ev.to === 'seriouslyInjured') bump(stats, 'seriouslyInjured')
      else if (ev.type === 'FighterOutOfAction') bump(stats, 'outOfAction')
      else if (ev.type === 'WeaponStateChanged' && ev.ammo !== 'ok') bump(stats, `ammo:${ev.ammo}`)
      else if (ev.type === 'ActionDeclared' && ev.action === 'charge') bump(stats, 'charges')
      else if (ev.type === 'FightStarted') bump(stats, ev.charge ? 'fights:charge' : 'fights')
      else if (ev.type === 'ReactionStarted') bump(stats, 'reactions')
      else if (ev.type === 'NerveTest') bump(stats, ev.passed ? 'nerve:passed' : 'nerve:failed')
      else if (ev.type === 'ConditionChanged' && ev.condition === 'broken' && ev.on) bump(stats, 'broken')
      else if (ev.type === 'ConditionChanged' && ev.condition === 'blaze' && ev.on) bump(stats, 'blaze')
      else if (ev.type === 'RunningForCover') bump(stats, 'runForCover')
      else if (ev.type === 'CoupDeGrace') bump(stats, 'coupDeGrace')
      else if (ev.type === 'Consolidated') bump(stats, 'consolidated')
      else if (ev.type === 'Parried') bump(stats, 'parried')
      else if (ev.type === 'BottleTest') {
        bump(stats, ev.bottled ? (ev.voluntary ? 'bottle:voluntary' : 'bottle:rolled') : 'bottle:held')
        if (ev.bottled && bottleRound === null) {
          bottleRound = state.round
          voluntaryBottle = ev.voluntary
        }
      } else if (ev.type === 'FleeTest') bump(stats, ev.auto ? 'flee:led' : ev.passed ? 'flee:passed' : 'flee:failed')
      else if (ev.type === 'FighterFled') bump(stats, ev.voluntary ? 'fled:voluntary' : 'fled')
      else if (ev.type === 'RecoveryTest') bump(stats, `recovery:${ev.applied}${ev.assistedBy ? ':assisted' : ''}`)
      else if (ev.type === 'RallyTest') bump(stats, ev.passed ? 'rally:passed' : 'rally:failed')
      else if (ev.type === 'HorrorsInTheDark') bump(stats, `horrors:${ev.result}`)
      else if (ev.type === 'CasketOpened') bump(stats, `casket:${ev.result}`)
      else if (ev.type === 'CasketPlaced') bump(stats, 'casketsPlaced')
      else if (ev.type === 'ResultLocked') bump(stats, `locked:${ev.reason}`)
      else if (ev.type === 'SmokeCleared') bump(stats, 'smokeCleared')
    }
    for (const m of checkInvariants(prev, state, action, r.events)) violate('invariant', m)
    const key = progressKey(state)
    stall = key === lastKey ? stall + 1 : 0
    lastKey = key
    if (stall >= STALL_LIMIT) {
      violate('stall', `${STALL_LIMIT} decisions without progress at ${key}`)
      break
    }
    if (violations.length > 5) break
  }
  const ended = state.phase === 'ended'
  if (!ended && violations.length === 0) violate('SIM-003', `game did not end within ${MAX_DECISIONS} decisions`)

  // SIM-006: the same seed and the same action list reproduce every hash
  if (violations.length === 0) {
    const rep = replay(setup, seed, state.log, bundle)
    if (rep.rejection || rep.hashes.length !== hashes.length || rep.hashes.some((h, i) => h !== hashes[i])) {
      hashMismatch = true
      violate('SIM-006', 'replay did not reproduce the recorded hashes')
    }
  }
  stats.casualties = state.casualties.length
  const winner = state.result?.winner ?? null
  const summary: GameSummary = {
    scenarioId: setup.scenarioId,
    boardId: setup.boardId,
    houses: { A: setup.gangs.A.houseId, B: setup.gangs.B.houseId },
    winner,
    winnerHouse: winner === null || winner === 'draw' ? null : setup.gangs[winner].houseId,
    reason: state.result?.reason ?? null,
    rounds: state.round,
    bottleRound,
    voluntaryBottle,
    casualties: state.casualties.length,
    points: { A: state.players.A.points, B: state.players.B.points },
    lockedWin: state.scenario.locked !== null,
    decisions,
  }
  return { game, seed, ended, decisions, rounds: state.round, rejections, violations, hashMismatch, actions: state.log, stats, summary }
}

/** Play one game with the random bots and keep every event (board-svg --sim draws from this). Stops at the first rejection. */
export function simulate(setup: GameSetup, bundle: EngineBundle, seed: string): { state: GameState; events: GameEvent[] } {
  const bots = { A: new RandomBot(`${seed}:A`), B: new RandomBot(`${seed}:B`) }
  const first = createGame(setup, seed, bundle)
  let state = first.state
  const events: GameEvent[] = [...first.events]
  for (let i = 0; i < MAX_DECISIONS && state.pending; i++) {
    const r = step(state, bots[state.pending.seat].decide(state, state.pending))
    if (r.rejection) break
    state = r.state
    events.push(...r.events)
  }
  return { state, events }
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
  const stats: Record<string, number> = {}
  let completed = 0
  let decisions = 0
  let rejections = 0
  let violations = 0
  const casualtiesPerGame: number[] = []
  const summaries: GameSummary[] = []
  for (let g = 0; g < opts.games; g++) {
    const r = playGame(opts.setupFor(g), opts.bundle, `${opts.seed}-${g}`, g)
    casualtiesPerGame.push(r.stats.casualties ?? 0)
    summaries.push(r.summary)
    if (r.ended && r.violations.length === 0) completed++
    decisions += r.decisions
    rejections += r.rejections
    violations += r.violations.length
    for (const [k, v] of Object.entries(r.stats)) bump(stats, k, v)
    if (r.violations.length > 0 || !r.ended) failing.push(r)
    opts.onGame?.(r)
  }
  return { games: opts.games, completed, decisions, rejections, violations, failing, stats, casualtiesPerGame, summaries, ms: Date.now() - t0 }
}
