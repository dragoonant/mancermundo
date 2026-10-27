// SCN module: owns `confirm` (and the reserved `scenario.*` namespace). The scenario rules of 11-scenarios.md that are not part of
// the core rounds: loot casket placement rules (Smash & Grab, Forgotten Riches), points (Tunnel Skirmish 3/2/1, casket points,
// the last gang standing), the scenario casket contents table (Smash & Grab), Horrors in the Dark (Forgotten Riches), the
// locked Smash & Grab win and its `confirm`, victory and the end of the battle (M-1.9, M-1.10).
//
// Scenario data names three code hooks that live here: `horrorsInTheDark` (scenario.special), `smashAndGrabVictory`
// (scenario.victory) and the casket table `scn.smash-and-grab` (scenario.caskets.contents, registered as `smashAndGrabCaskets`).
// Their effects are called straight from the rules code that owns the moment (activation start, casket opening, battle end);
// `markFired` records that they fired so tests/engine/code-hooks.test.ts can prove each one runs in a real game.
import { baseInRegion, distToOutline, freeSpaceTest, HALF_TILE, initialDoors, reachableFrom, tileIndexAt, tileStrips, type DoorStates } from './board'
import { takeOutOfAction } from './casualties'
import { markFired, registerCodeHook, withoutFireCounts } from './code-hooks'
import { rollExpr } from './dice'
import { round3 } from './geometry'
import { resolveHit } from './hits'
import { withinPath } from './measure'
import { resolveBlast } from './ports'
import { endGame, reject, type Ctx, type ModuleDef } from './registry'
import { resumeAfterConfirm } from './activation'
import { EngineInvariantError, onBoard, otherSeat, SEATS } from './state'
import type { BoardDef, Fighter, GameState, PendingDecision, Polygon, Rejection, Seat, Vec2 } from './types'

/** Radius of a casket disc (1" diameter), as zm.ts. */
const CASKET_R = 0.5

// ---------------------------------------------------------------------------
// Scenario data helpers
// ---------------------------------------------------------------------------

const SMASH_GOAL = 3
/** M-4.5: a fighter this far from every other fighter (by path) is alone in the dark. */
const HORROR_RADIUS = 8

export interface CasketRules {
  count: number
  placer: 'attacker' | 'defender' | 'alternate' | 'board'
  region: 'ownHalf' | 'centreTileFirst' | 'anyTile'
  minFromEdge: number
  minApart: number
  openBy?: string
  contents: unknown
}

/** The loot casket rules of the scenario, or null (Tunnel Skirmish places none). */
export function casketRules(state: GameState): CasketRules | null {
  const c = state.data.scenario.caskets as Partial<CasketRules> | undefined
  if (!c || !c.count) return null
  return { count: c.count, placer: c.placer ?? 'board', region: c.region ?? 'anyTile', minFromEdge: c.minFromEdge ?? 0, minApart: c.minApart ?? 0, openBy: c.openBy, contents: c.contents }
}

function hasSpecial(state: GameState, code: string): boolean {
  return state.data.scenario.special.some((s) => s.code === code)
}

function victoryCode(state: GameState): string | null {
  const v = state.data.scenario.victory
  return 'code' in v ? v.code : null
}

const seatOfRole = (state: GameState, role: 'attacker' | 'defender'): Seat | null => SEATS.find((s) => state.players[s].role === role) ?? null

// ---------------------------------------------------------------------------
// Code hooks (fire counts for the tests; the effects are called from the owning rules code)
// ---------------------------------------------------------------------------

for (const [name, kind] of [
  ['horrorsInTheDark', 'scenario'],
  ['smashAndGrabVictory', 'scenario'],
  ['smashAndGrabCaskets', 'casket'],
] as const) {
  registerCodeHook({ name, kind, params: (p) => (p && Object.keys(p).length > 0 ? `${name} takes no params` : null), install() {} })
}

// ---------------------------------------------------------------------------
// Casket placement (M-3.4, M-4.3): rules the setup decision enforces
// ---------------------------------------------------------------------------

/** Who places each casket, in order: Forgotten Riches alternates starting with the roll-off winner, Smash & Grab is the defender's. */
export function casketPlacers(state: GameState): Seat[] {
  const rules = casketRules(state)
  if (!rules) return []
  const first = state.setup.rollOff?.winner ?? state.setup.first ?? 'A'
  const seats: Seat[] = []
  for (let i = 0; i < rules.count; i++) {
    if (rules.placer === 'alternate') seats.push(i % 2 === 0 ? first : otherSeat(first))
    else if (rules.placer === 'defender' || rules.placer === 'attacker') seats.push(seatOfRole(state, rules.placer) ?? first)
    else seats.push(state.setup.first ?? first)
  }
  return seats
}

/** The tile (by index) a casket lies in. */
function tileOf(def: BoardDef, pos: Vec2): number {
  return tileIndexAt(def, pos)
}

/** The tile in the middle of a brick board (the one nearest the middle of the bounds). */
export function centreTileIndex(def: BoardDef): number {
  const cx = (def.bounds.minX + def.bounds.maxX) / 2
  const cz = (def.bounds.minZ + def.bounds.maxZ) / 2
  let best = 0
  def.tiles.forEach((t, i) => {
    if (Math.hypot(t.centre.x - cx, t.centre.z - cz) < Math.hypot(def.tiles[best]!.centre.x - cx, def.tiles[best]!.centre.z - cz)) best = i
  })
  return best
}

export interface CasketRegion {
  /** the rectangles a casket disc must lie wholly inside (one of them) */
  rects: Polygon[]
  /** the tile ids they belong to (tile regions), else null */
  tileIds: string[] | null
}

function rectPoly(minX: number, minZ: number, maxX: number, maxZ: number): Polygon {
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]
}

/** Where the next casket may go. Own half: the placing seat's half; centre tile first; then any tile without a casket. */
export function casketRegion(state: GameState, seat: Seat): CasketRegion {
  const rules = casketRules(state)!
  const def = state.board.def
  const placed = Object.values(state.board.caskets)
  if (rules.region === 'ownHalf') {
    const mid = (def.bounds.minZ + def.bounds.maxZ) / 2
    const zone = state.setup.zoneChoices[seat]
    const rect = zone === 'high' ? rectPoly(def.bounds.minX, mid, def.bounds.maxX, def.bounds.maxZ) : rectPoly(def.bounds.minX, def.bounds.minZ, def.bounds.maxX, mid)
    return { rects: [rect], tileIds: null }
  }
  const used = new Set(placed.map((c) => tileOf(def, c.pos)))
  if (rules.region === 'centreTileFirst' && placed.length === 0) {
    const i = centreTileIndex(def)
    return { rects: [def.tiles[i]!.rect], tileIds: [def.tiles[i]!.id] }
  }
  const tiles = def.tiles.filter((_, i) => !used.has(i))
  return { rects: tiles.map((t) => t.rect), tileIds: tiles.map((t) => t.id) }
}

const openDoorsCache = new WeakMap<BoardDef, (p: Vec2) => boolean>()

/** Points a base can walk to from some authored casket spot with every door open: "not in inaccessible spots" (M-4.3). */
function accessible(def: BoardDef): (p: Vec2) => boolean {
  let fn = openDoorsCache.get(def)
  if (!fn) {
    const doors: DoorStates = Object.fromEntries(Object.entries(initialDoors(def)).map(([id, d]) => [id, { ...d, state: 'open' as const }]))
    fn = reachableFrom(def, doors, def.casketSpots)
    openDoorsCache.set(def, fn)
  }
  return fn
}

const freeCache = new WeakMap<BoardDef, (c: Vec2) => boolean>()
function freeAt(state: GameState): (c: Vec2) => boolean {
  const def = state.board.def
  let fn = freeCache.get(def)
  if (!fn) {
    fn = freeSpaceTest(def, initialDoors(def), CASKET_R)
    freeCache.set(def, fn)
  }
  return fn
}

const rej = (code: Rejection['code'], reason: string): Rejection => ({ code, reason })

/** Why a casket cannot be put at `pos` by `seat` now, or null. */
export function casketProblem(state: GameState, seat: Seat, pos: Vec2): Rejection | null {
  const rules = casketRules(state)
  if (!rules) return rej('E_NOT_AN_OPTION', 'this scenario has no loot caskets')
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return rej('E_SCHEMA', 'x and z must be finite numbers')
  const def = state.board.def
  const region = casketRegion(state, seat)
  const inside = region.rects.some((r) => {
    const xs = r.map((p) => p.x)
    const zs = r.map((p) => p.z)
    return pos.x - CASKET_R >= Math.min(...xs) - 1e-9 && pos.x + CASKET_R <= Math.max(...xs) + 1e-9 && pos.z - CASKET_R >= Math.min(...zs) - 1e-9 && pos.z + CASKET_R <= Math.max(...zs) + 1e-9
  })
  if (!inside) {
    return rej('E_OUT_OF_RANGE', rules.region === 'ownHalf' ? 'a casket goes in your own half of the board' : region.tileIds && region.tileIds.length === 1 ? 'the first casket goes in the centre tile' : 'each casket goes in a different tile')
  }
  if (distToOutline(def, pos) < rules.minFromEdge - 1e-9) return rej('E_OUT_OF_RANGE', `a casket must be at least ${rules.minFromEdge}" from every board edge`)
  if (!freeAt(state)(pos)) return rej('E_OVERLAP', 'a casket cannot overlap a wall, a door or an obstacle')
  for (const c of Object.values(state.board.caskets)) {
    const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z)
    if (d < 2 * CASKET_R - 1e-9) return rej('E_OVERLAP', 'a casket cannot overlap another casket')
    if (d < rules.minApart - 1e-9) return rej('E_OUT_OF_RANGE', `caskets must be at least ${rules.minApart}" apart`)
  }
  if (!accessible(def)(pos)) return rej('E_NO_PATH', 'that spot cannot be reached')
  return null
}

/** The engine's casket spot: an authored spot that passes, else the legal spot nearest the middle of the region. Null when none. */
export function suggestCasketSpot(state: GameState, seat: Seat): Vec2 | null {
  const def = state.board.def
  const region = casketRegion(state, seat)
  for (const s of def.casketSpots) if (!casketProblem(state, seat, s)) return { x: s.x, z: s.z }
  for (const r of region.rects) {
    const xs = r.map((p) => p.x)
    const zs = r.map((p) => p.z)
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    const mid = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
    const cands: Vec2[] = []
    for (let z = minZ + CASKET_R; z <= maxZ - CASKET_R + 1e-9; z += 0.5) for (let x = minX + CASKET_R; x <= maxX - CASKET_R + 1e-9; x += 0.5) cands.push({ x: round3(x), z: round3(z) })
    cands.sort((a, b) => Math.hypot(a.x - mid.x, a.z - mid.z) - Math.hypot(b.x - mid.x, b.z - mid.z) || a.z - b.z || a.x - b.x)
    for (const c of cands) if (!casketProblem(state, seat, c)) return c
  }
  return null
}

/** Tiles a seat may pick as its deployment tile (Forgotten Riches): no casket in it, an outer edge, not the other seat's pick. */
export function deployTileChoices(state: GameState, taken: readonly string[]): string[] {
  const def = state.board.def
  const dep = state.data.scenario.deployment
  const withCasket = new Set(Object.values(state.board.caskets).map((c) => tileOf(def, c.pos)))
  const out: string[] = []
  def.tiles.forEach((t, i) => {
    if (withCasket.has(i) || taken.includes(t.id)) return
    if (tileStrips(def, i, dep.withinOfEdge ?? 3).length === 0) return
    out.push(t.id)
  })
  return out
}

/** Two tiles touch (share an edge or a corner): the enemy clearance of M-4.4 then applies. */
export function tilesTouch(def: BoardDef, aId: string, bId: string): boolean {
  const a = def.tiles.find((t) => t.id === aId)
  const b = def.tiles.find((t) => t.id === bId)
  if (!a || !b) return false
  return Math.abs(a.centre.x - b.centre.x) <= 2 * HALF_TILE + 1e-6 && Math.abs(a.centre.z - b.centre.z) <= 2 * HALF_TILE + 1e-6
}

// ---------------------------------------------------------------------------
// Points (M-2.4, M-4.7)
// ---------------------------------------------------------------------------

interface ScoreRule {
  on: string
  seat?: string
  points?: number | string | { byRole: Record<string, number> }
  count?: boolean
}

function scoreRules(state: GameState, on: string): ScoreRule[] {
  return (state.data.scenario.scoring as unknown as ScoreRule[]).filter((r) => r.on === on)
}

function ruleSeatMatches(state: GameState, rule: ScoreRule, seat: Seat): boolean {
  if (!rule.seat) return true
  return rule.seat === seat || state.players[seat].role === rule.seat
}

function pointsOf(ctx: Ctx, rule: ScoreRule, role?: string): number {
  const p = rule.points
  if (p === undefined) return 1
  if (typeof p === 'number') return p
  if (typeof p === 'string') return rollExpr(ctx, 'scenarioPoints', p)
  return p.byRole[role ?? ''] ?? p.byRole.ganger ?? 1
}

/** Points never fall: add to a gang's score and report it. */
export function award(ctx: Ctx, seat: Seat, amount: number, reason: string): void {
  if (amount <= 0) return
  const s = ctx.state
  s.players[seat].points += amount
  s.scenario.points[seat] = s.players[seat].points
  ctx.emit({ type: 'PointsScored', seat, amount, reason }, seat)
}

/**
 * A fighter went Out of Action or fled: the other gang scores by the scenario's rule for that trigger (the downed fighter's
 * role sets the amount, M-2.4). A fled fighter counts as Out of Action (R-13.1, M-1.9). A gang that bottled voluntarily and then
 * flees loses outright in the scenarios with caskets (M-1.10).
 */
export function scoreCasualty(ctx: Ctx, f: Fighter, kind: 'outOfAction' | 'fled', _voluntary = false): void {
  const s = ctx.state
  const scorer = otherSeat(f.seat)
  const on = kind === 'fled' ? 'fighterFled' : 'fighterOutOfAction'
  for (const rule of scoreRules(s, on)) {
    if (ruleSeatMatches(s, rule, scorer)) award(ctx, scorer, pointsOf(ctx, rule, f.role), `${kind}:${f.id}`)
  }
  if (kind === 'fled' && casketRules(s) && s.players[f.seat].bottledVoluntarily && s.phase !== 'ended') forfeit(ctx, f.seat)
}

// ---------------------------------------------------------------------------
// Caskets in play (M-3.7, M-4.6)
// ---------------------------------------------------------------------------

export interface CasketOutcome {
  /** reported as `CasketOpened.result` */
  result: string
  /** a Blast centred on the casket with no hit roll */
  blast?: { radius: number; strength: number; ap: number; damage: number }
  /** the casket is removed from the board afterwards */
  remove: boolean
}

/** The scenario's own casket contents for a D6 (after the smash modifier), or null for the core table (R-15.11). */
export function scenarioCasketOutcome(state: GameState, roll: number): CasketOutcome | null {
  const table = casketRules(state)?.contents
  if (table !== 'scn.smash-and-grab') return null
  markFired('smashAndGrabCaskets')
  // M-3.7: 1 booby trapped (a 5" Blast, S4 AP - Damage 1), 2-5 valuables, 6 jackpot; the casket is removed either way
  if (roll <= 1) return { result: 'boobyTrap', blast: { radius: 2.5, strength: 4, ap: 0, damage: 1 }, remove: true }
  return { result: roll >= 6 ? 'jackpot' : 'valuables', remove: true }
}

/** A casket was opened: it counts for the scenario (M-3.7); the third in Smash & Grab locks the attacker's win. */
export function onCasketOpened(ctx: Ctx, f: Fighter): void {
  const s = ctx.state
  for (const rule of scoreRules(s, 'casketOpened')) {
    if (ruleSeatMatches(s, rule, f.seat)) award(ctx, f.seat, pointsOf(ctx, rule, f.role), 'casketOpened')
  }
  if (victoryCode(s) === 'smashAndGrabVictory' && s.scenario.caskets.opened >= SMASH_GOAL && !s.scenario.locked) {
    const winner = seatOfRole(s, 'attacker')
    if (winner) {
      markFired('smashAndGrabVictory')
      s.scenario.locked = { winner, reason: 'caskets' }
      ctx.emit({ type: 'ResultLocked', winner, reason: 'caskets' }, winner)
    }
  }
}

/** A blast from a casket booby trap (scenario table). */
export function casketBlast(ctx: Ctx, at: Vec2, blast: NonNullable<CasketOutcome['blast']>): void {
  ctx.emit({ type: 'BlastPlaced', centre: { ...at }, radius: blast.radius }, null)
  resolveBlast(ctx, { centre: { ...at }, radius: blast.radius, strength: blast.strength, ap: blast.ap, damage: blast.damage, source: 'casket' })
}

/** Loot caskets on a seat's deployment tile within 3" of the board edge (Forgotten Riches, M-4.7). Ammo caches do not count. */
export function securedBySeat(state: GameState): Record<Seat, number> {
  const out: Record<Seat, number> = { A: 0, B: 0 }
  const dep = state.data.scenario.deployment
  if (dep.kind !== 'tile') return out
  const def = state.board.def
  for (const seat of SEATS) {
    const tileId = state.scenario.deployTiles[seat]
    const i = def.tiles.findIndex((t) => t.id === tileId)
    if (i < 0) continue
    const strips = tileStrips(def, i, dep.withinOfEdge ?? 3)
    for (const c of Object.values(state.board.caskets)) {
      if ((c.state === 'closed' || c.state === 'opened') && baseInRegion(strips, c.pos, CASKET_R)) out[seat]++
    }
  }
  return out
}

/** Keep `scenario.caskets.secured` (the scenario panel's count) current: called at the end of each round. */
export function refreshSecured(state: GameState): void {
  const secured = securedBySeat(state)
  state.scenario.caskets.secured = secured.A + secured.B
}

/** Loot caskets still on the board (closed or opened but not an ammo cache). */
function lootOnBoard(state: GameState): number {
  return Object.values(state.board.caskets).filter((c) => c.state === 'closed' || c.state === 'opened').length
}

// ---------------------------------------------------------------------------
// Horrors in the Dark (M-4.5)
// ---------------------------------------------------------------------------

/**
 * A fighter activates: when it is more than 8" from every other fighter (friend or enemy, any status) roll a D6: 1 a S6 AP -1
 * Damage 2 hit, and a fighter it leaves Seriously Injured is dragged off and goes Out of Action; 2-3 no actions; 4-5 one action;
 * 6 normal. Returns the actions the fighter may take now (2 unchanged).
 */
export function horrorsCheck(ctx: Ctx, f: Fighter, actionsLeft: number): number {
  const s = ctx.state
  if (!hasSpecial(s, 'horrorsInTheDark')) return actionsLeft
  const alone = !onBoard(s).some((g) => g.id !== f.id && withinPath(s, f, g, HORROR_RADIUS))
  if (!alone) return actionsLeft
  markFired('horrorsInTheDark')
  const roll = ctx.roll('horrors', 1)[0]!
  let result: string
  let left = actionsLeft
  if (roll === 1) {
    result = 'hit'
    resolveHit(ctx, {
      attackerId: null,
      targetId: f.id,
      weaponId: null,
      strength: 6,
      ap: -1,
      damage: { kind: 'fixed', value: 2 },
      traits: [],
      hitRoll: null,
      knockFrom: null,
      melta: false,
      saveVs: null,
      coverBonus: 0,
      from: null,
      saves: true,
      cause: 'horrors',
    })
    if (f.location === 'board' && f.posture === 'seriouslyInjured') {
      takeOutOfAction(ctx, f, null, 'horrors')
      result = 'dragged'
    }
  } else if (roll <= 3) {
    result = 'noActions'
    left = 0
  } else if (roll <= 5) {
    result = 'oneAction'
    left = Math.min(left, 1)
  } else result = 'normal'
  ctx.emit({ type: 'HorrorsInTheDark', fighterId: f.id, roll, result }, f.seat)
  return left
}

// ---------------------------------------------------------------------------
// Victory and the end of the battle (M-1.9, M-1.10, M-2.6, M-3.9, M-4.9)
// ---------------------------------------------------------------------------

/** R-5.8: gangs that still have a fighter on the battlefield that is not Seriously Injured. */
export function standingSeats(state: GameState): Seat[] {
  const seats = new Set<Seat>()
  for (const f of onBoard(state)) if (f.posture !== 'seriouslyInjured') seats.add(f.seat)
  return SEATS.filter((s) => seats.has(s))
}

function compare(a: number, b: number): Seat | 'draw' {
  return a === b ? 'draw' : a > b ? 'A' : 'B'
}

/** The winner by the scenario's victory rule, given the caskets secured (Forgotten Riches) at this moment. */
function victoryWinner(state: GameState, secured: Record<Seat, number>): Seat | 'draw' {
  const code = victoryCode(state)
  if (code === 'smashAndGrabVictory') {
    const attacker = seatOfRole(state, 'attacker')
    const defender = seatOfRole(state, 'defender')
    if (!attacker || !defender) throw new EngineInvariantError('Smash & Grab needs an attacker and a defender')
    markFired('smashAndGrabVictory')
    return state.scenario.caskets.opened >= SMASH_GOAL ? attacker : defender
  }
  if (code) throw new EngineInvariantError(`unknown victory code ${code}`)
  const v = state.data.scenario.victory
  if ('by' in v && v.by === 'caskets') return compare(secured.A, secured.B)
  return compare(state.players.A.points, state.players.B.points)
}

/** Who would win if the battle ended now (the score panel's "leading"); no dice, no side effects. */
export function projectedWinner(state: GameState): Seat | 'draw' {
  // before the roles are chosen (set-up) there is no attacker to lead: a draw
  if (state.phase === 'setup' && state.data.scenario.roles && !seatOfRole(state, 'attacker')) return 'draw'
  return withoutFireCounts(() => victoryWinner(state, securedBySeat(state)))
}

/** Settle the end-of-battle points (caskets secured, last gang standing) and end the game with the scenario's winner. */
function finalise(ctx: Ctx, reason: 'scenario' | 'concede', forced?: Seat): void {
  const s = ctx.state
  const secured = securedBySeat(s)
  s.scenario.caskets.secured = secured.A + secured.B
  if (!forced) {
    for (const seat of SEATS) {
      for (const rule of scoreRules(s, 'casketSecured')) {
        if (ruleSeatMatches(s, rule, seat)) award(ctx, seat, pointsOf(ctx, rule) * (rule.count ? secured[seat] : 1), 'casketSecured')
      }
    }
    const standing = standingSeats(s)
    if (standing.length === 1) {
      for (const rule of scoreRules(s, 'lastGangStanding')) {
        if (ruleSeatMatches(s, rule, standing[0]!)) award(ctx, standing[0]!, pointsOf(ctx, rule), 'lastGangStanding')
      }
    }
  }
  const winner = forced ?? victoryWinner(s, secured)
  const opened = s.scenario.caskets.opened
  const caskets: Record<Seat, number> | undefined = !casketRules(s) ? undefined : victoryCode(s) === 'smashAndGrabVictory' ? { A: s.players.A.role === 'attacker' ? opened : 0, B: s.players.B.role === 'attacker' ? opened : 0 } : secured
  endGame(ctx, reason, undefined, { winner, ...(caskets ? { caskets } : {}) })
}

/** M-1.10: a gang that bottled voluntarily and then flees loses outright; the other gang claims every casket left on the board. */
function forfeit(ctx: Ctx, loser: Seat): void {
  const s = ctx.state
  const winner = otherSeat(loser)
  s.scenario.locked = { winner, reason: 'bottledVoluntarily', asked: true }
  ctx.emit({ type: 'ResultLocked', winner, reason: 'bottledVoluntarily' }, winner)
  const claimed = victoryCode(s) === 'smashAndGrabVictory' ? s.scenario.caskets.opened : lootOnBoard(s)
  s.scenario.caskets.secured = victoryCode(s) === 'smashAndGrabVictory' ? 0 : claimed
  endGame(ctx, 'scenario', undefined, { winner, caskets: { A: winner === 'A' ? claimed : 0, B: winner === 'B' ? claimed : 0 } })
}

/**
 * The end of a round (R-5.8, M-1.9): the battle is over when at most one gang still has fighters on the battlefield that are not
 * Seriously Injured. Settles the scenario points and the victory; true when the game ended.
 */
export function checkBattleEnd(ctx: Ctx): boolean {
  const s = ctx.state
  if (s.phase === 'ended') return true
  if (standingSeats(s).length > 1) return false
  finalise(ctx, 'scenario')
  return true
}

// ---------------------------------------------------------------------------
// The locked Smash & Grab win (M-3.9 ruling): the winner decides whether to play on
// ---------------------------------------------------------------------------

/** True while a locked result has not been put to the winner yet. */
export function lockedConfirmDue(state: GameState): boolean {
  const l = state.scenario.locked
  return !!l && !l.asked && state.phase !== 'ended'
}

/** Raise the `confirm` for the locked result; `justActed` is the seat whose turn just ended (the flow resumes after it). */
export function raiseLockedConfirm(ctx: Ctx, justActed: Seat | null): void {
  const s = ctx.state
  const l = s.scenario.locked!
  ctx.raise({
    kind: 'confirm',
    seat: l.winner,
    window: 'battle.end',
    context: { winner: l.winner, reason: l.reason, points: { ...s.scenario.points }, opened: s.scenario.caskets.opened, justActed },
    options: [
      { id: 'continue', labelKey: 'confirm.continue', type: 'confirm', payload: { choice: 'continue' } },
      { id: 'concede', labelKey: 'confirm.concede', type: 'confirm', payload: { choice: 'concede' } },
    ],
  })
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export const scenariosModule: ModuleDef = {
  id: 'scenarios',
  namespaces: ['scenario', 'confirm'],
  handle(state, action, pending: PendingDecision) {
    if (pending.kind !== 'confirm' || action.type !== 'confirm') return reject('E_TODO', `${action.type} is not a scenario decision`)
    const choice = action.payload.choice ?? 'continue'
    const just = (pending.context.justActed as Seat | null) ?? null
    return {
      run(ctx) {
        const l = ctx.state.scenario.locked
        if (!l) throw new EngineInvariantError('confirm without a locked result')
        l.asked = true
        if (choice === 'concede') {
          finalise(ctx, 'concede', l.winner)
          return
        }
        resumeAfterConfirm(ctx, just)
      },
    }
  },
}

