// Headless simulation core: two random-legal bots play seeded games while the invariants below are checked after every step.
// The game loop here (like the client store) is the only caller of `step`. Until the End phase lands in S4 a game ends by
// the round cap (`GameSetup.options.maxRounds`, reason 'roundLimit') or by R-5.8 when one gang is gone.
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
} from '@/engine'
import { circleOverlapsPolygon, polygonBBox, round3 } from '@/engine/geometry'
import { insideOutline } from '@/engine/board'
import { baseGap } from '@/engine/measure'
import { approachPoint, planToward } from '@/engine/movement'
import type { VoluntaryKind } from '@/engine/movement'

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
  rounds: number
  rejections: number
  violations: Violation[]
  hashMismatch: boolean
  actions: Action[]
  /** counters for the summary line */
  stats: Record<string, number>
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
  ms: number
}

export const MAX_DECISIONS = 4000
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
    if (legal) return pending.kind === 'action.choose' ? this.choose(legal) : legal[this.int(legal.length)]!
    if (pending.kind === 'setup.deploy') return this.deploy(state, pending)
    if (pending.kind === 'move.path') return this.move(state, pending)
    const s = suggest(state, pending)
    if (s) return s
    if (pending.canPass) return act.pass(pending)
    throw new Error(`bot cannot answer ${pending.kind}`)
  }

  /** Pick an action type uniformly first (so a rare option such as a door is not drowned by 18 turn facings), then an option of it. */
  private choose(legal: Action[]): Action {
    const groups = new Map<string, Action[]>()
    for (const a of legal) {
      const key = a.type === 'action.choose' ? a.payload.action : a.type
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(a)
    }
    const keys = [...groups.keys()]
    // finishing early and turning are less interesting than acting: half weight
    const weights = keys.map((k) => (k === 'end' || k === 'turn' ? 0.5 : 1))
    let roll = this.float() * weights.reduce((x, y) => x + y, 0)
    let pickKey = keys[keys.length - 1]!
    for (let i = 0; i < keys.length; i++) {
      roll -= weights[i]!
      if (roll < 0) {
        pickKey = keys[i]!
        break
      }
    }
    const list = groups.get(pickKey)!
    return list[this.int(list.length)]!
  }

  private deploy(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const ids = c.fighterIds!
    const box = polygonBBox(c.region!)
    for (let i = 0; i < 80; i++) {
      const id = ids[this.int(ids.length)]!
      const a = act.deploy(
        pending,
        id,
        round3(box.minX + this.float() * (box.maxX - box.minX)),
        round3(box.minZ + this.float() * (box.maxZ - box.minZ)),
        round3((this.float() - 0.5) * 2 * Math.PI),
      )
      if (!validate(state, a)) return a
    }
    const s = suggest(state, pending)
    if (!s) throw new Error('no legal deploy spot')
    return s
  }

  private move(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const f = state.fighters[c.fighterId!]!
    const max = c.maxInches ?? 0
    const enemies = Object.values(state.fighters).filter((e) => e.location === 'board' && e.seat !== f.seat)
    const nearest = enemies.length ? enemies.reduce((a, b) => (Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) < Math.hypot(b.pos.x - f.pos.x, b.pos.z - f.pos.z) ? a : b)) : null
    const kind = c.kind as VoluntaryKind
    for (let i = 0; i < 60; i++) {
      const roll = this.float()
      let wps: { x: number; z: number }[] | null = null
      if (roll < 0.35 && nearest) {
        wps = planToward(state, f, kind, max, approachPoint(state, f, nearest))
      } else if (roll < 0.55) {
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
    return act.pass(pending)
  }
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

const VOLUNTARY: ReadonlySet<string> = new Set(['move', 'takeCover', 'crawl', 'carry'])

export function checkInvariants(prev: GameState, next: GameState, _action: Action, events: GameEvent[]): string[] {
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
    if (spent > 2) add('ACT', `${a.fighterId} spent ${spent} actions: ${a.performed.map((p) => p.action).join(',')}`)
    if (spent + a.actionsLeft !== 2) add('ACT', `${a.fighterId} spent ${spent} with ${a.actionsLeft} left`)
    const basics = a.performed.filter((p) => p.type === 'basic').map((p) => p.action)
    if (new Set(basics).size !== basics.length) add('ACT', `${a.fighterId} repeated a Basic action: ${basics.join(',')}`)
    a.performed.forEach((p, i) => {
      if (p.type === 'double' && i > 0 && a.performed.slice(0, i).some((q) => q.type !== 'free')) add('ACT', `${a.fighterId} did a Double after another action`)
    })
  }
  if (next.action.group && next.action.group.members.length > 2) add('GROUP', `a group of ${next.action.group.members.length} members`)

  for (const ev of events) {
    if (ev.type === 'DiceRolled') {
      if (ev.die === 'scatter') {
        for (const d of ev.dice) if (!Number.isInteger(d) || d < 0 || d >= 360) add('dice', `scatter ${d} out of range`)
      } else {
        for (const d of ev.dice) if (!Number.isInteger(d) || d < 1 || d > 6) add('dice', `die ${d} out of range`)
        if (ev.faces) for (const face of ev.faces) if (typeof face !== 'string' || face === '') add('dice', 'a die face has no name')
      }
    }
    if (ev.type === 'FighterMoved' && VOLUNTARY.has(ev.kind)) {
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
  return `${s.phase}|${s.round}|${ready}|${deployed}|${a ? `${a.fighterId}:${a.actionsLeft}:${a.performed.length}` : '-'}|${s.setup.step}|${s.setup.crewDone.length}`
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
  return { game, seed, ended, decisions, rounds: state.round, rejections, violations, hashMismatch, actions: state.log, stats }
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
  for (let g = 0; g < opts.games; g++) {
    const r = playGame(opts.setupFor(g), opts.bundle, `${opts.seed}-${g}`, g)
    casualtiesPerGame.push(r.stats.casualties ?? 0)
    if (r.ended && r.violations.length === 0) completed++
    decisions += r.decisions
    rejections += r.rejections
    violations += r.violations.length
    for (const [k, v] of Object.entries(r.stats)) bump(stats, k, v)
    if (r.violations.length > 0 || !r.ended) failing.push(r)
    opts.onGame?.(r)
  }
  return { games: opts.games, completed, decisions, rejections, violations, failing, stats, casualtiesPerGame, ms: Date.now() - t0 }
}
