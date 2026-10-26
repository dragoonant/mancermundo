// Zone Mortalis board actions (R-15): doors (operate, close on a fighter, terminal, force), ductway crawling and loot caskets.
// The actions are offered through `action.choose` by activation.ts (there are no door decisions, 00 section 3); this file
// holds the geometry that decides who may do what, and the resolution. Hits caused here (a door closing on a fighter, a
// frag trap) go through `ports.ts` and are resolved by the attack code from S3a on. Scenario casket contents (S4) replace
// `casketContents` through code hooks; the core table is read from constants.
import { baseGapToDoor, doorById, insideOutline } from './board'
import { d6TestPasses, twoD6TestPasses } from './dice'
import { circleOverlapsPolygon, pointInPolygon, round3, segmentPolygonIntervals } from './geometry'
import { CONTACT_EPS } from './measure'
import { findClearSpot, spotProblem, standUpContacted } from './movement'
import { resolveBlast, resolveHit } from './ports'
import { stat } from './query'
import type { Ctx } from './registry'
import { casketBlast, onCasketOpened, scenarioCasketOutcome } from './scenarios'
import { constants, onBoard } from './state'
import type { CasketStateName, Fighter, GameState, Vec2 } from './types'

const centreOf = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

export interface DoorChoice {
  doorId: string
  /** what the action does to the door */
  to: 'open' | 'close'
}

/** Doors a fighter may Operate: within 1", not destroyed, and unlocked (a scenario defender holds the codes, R-15.7). */
export function operableDoors(state: GameState, f: Fighter): DoorChoice[] {
  const reach = constants(state).radii.interact
  const holdsCodes = state.players[f.seat].role === 'defender'
  const out: DoorChoice[] = []
  for (const d of state.board.def.doors) {
    const rec = state.board.doors[d.id]
    if (!rec || rec.state === 'destroyed') continue
    if (baseGapToDoor(state.board.def, d.id, centreOf(f), f.baseRadius) > reach + 1e-9) continue
    if (rec.state === 'closed') {
      if (rec.locked && !holdsCodes) continue
      out.push({ doorId: d.id, to: 'open' })
    } else {
      out.push({ doorId: d.id, to: 'close' })
    }
  }
  return out
}

/** Locked closed doors within 1" of the fighter (Force Door). */
export function lockedDoorsNear(state: GameState, f: Fighter): string[] {
  const reach = constants(state).radii.interact
  return state.board.def.doors
    .filter((d) => {
      const rec = state.board.doors[d.id]
      return rec?.state === 'closed' && rec.locked && baseGapToDoor(state.board.def, d.id, centreOf(f), f.baseRadius) <= reach + 1e-9
    })
    .map((d) => d.id)
}

/** Terminals of locked closed doors within 1" of the fighter's base. */
export function terminalsNear(state: GameState, f: Fighter): { terminalId: string; doorId: string }[] {
  const reach = constants(state).radii.interact
  const out: { terminalId: string; doorId: string }[] = []
  for (const d of state.board.def.doors) {
    const rec = state.board.doors[d.id]
    if (!rec || rec.state !== 'closed' || !rec.locked) continue
    for (const t of d.terminals) {
      if (Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) - f.baseRadius <= reach + 1e-9) out.push({ terminalId: t.id, doorId: d.id })
    }
  }
  return out
}

/** Other friendly fighters in base contact with a door (Force Door helpers, R-15.7). */
export function doorHelpers(state: GameState, f: Fighter, doorId: string): Fighter[] {
  return onBoard(state).filter(
    (g) => g.id !== f.id && g.seat === f.seat && baseGapToDoor(state.board.def, doorId, centreOf(g), g.baseRadius) <= CONTACT_EPS,
  )
}

function setDoor(ctx: Ctx, doorId: string, patch: { state?: 'closed' | 'open' | 'destroyed'; locked?: boolean }): void {
  const rec = ctx.state.board.doors[doorId]!
  if (patch.state !== undefined) rec.state = patch.state
  if (patch.locked !== undefined) rec.locked = patch.locked
  ctx.emit({ type: 'DoorChanged', doorId, state: rec.state, locked: rec.locked })
}

/** Operate Door (Simple): open a closed unlocked door or close an open one. Opening a locked door (defender) unlocks it. */
export function operateDoor(ctx: Ctx, f: Fighter, doorId: string): void {
  const rec = ctx.state.board.doors[doorId]!
  if (rec.state === 'closed') setDoor(ctx, doorId, { state: 'open', locked: false })
  else closeDoor(ctx, doorId)
}

/** Half of a door rectangle's thickness and its unit normal, from its polygon. */
function doorFrame(poly: Vec2[], seg: { a: Vec2; b: Vec2 }): { mid: Vec2; n: Vec2; half: number } {
  const dx = seg.b.x - seg.a.x
  const dz = seg.b.z - seg.a.z
  const len = Math.hypot(dx, dz) || 1
  const n = { x: -dz / len, z: dx / len }
  const mid = { x: (seg.a.x + seg.b.x) / 2, z: (seg.a.z + seg.b.z) / 2 }
  let half = 0
  for (const p of poly) half = Math.max(half, Math.abs((p.x - mid.x) * n.x + (p.z - mid.z) * n.z))
  return { mid, n, half }
}

/** Close an open door (R-15.6): every fighter whose base is in the doorway is caught and cleared. */
export function closeDoor(ctx: Ctx, doorId: string): void {
  const s = ctx.state
  const door = doorById(s.board.def, doorId)!
  setDoor(ctx, doorId, { state: 'closed' })
  const caught = onBoard(s)
    .filter((g) => circleOverlapsPolygon(centreOf(g), g.baseRadius, door.poly))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  const k = constants(s).closeDoor
  for (const g of caught) {
    const { mid, n, half } = doorFrame(door.poly, door.seg)
    const signed = (c: Vec2) => (c.x - mid.x) * n.x + (c.z - mid.z) * n.z
    const clearTo = (c: Vec2, side: 1 | -1): Vec2 => {
      const want = side * (half + g.baseRadius + 0.02)
      const delta = want - signed(c)
      return { x: round3(c.x + n.x * delta), z: round3(c.z + n.z * delta) }
    }
    const start = centreOf(g)
    const sides = (): (1 | -1)[] => {
      const sg = signed(start)
      if (Math.abs(sg) < 0.01) return ctx.roll('doorSide', 1)[0]! <= 3 ? [1, -1] : [-1, 1]
      return sg > 0 ? [1, -1] : [-1, 1]
    }
    const order = sides()
    const fits = (maxDisp: number, oneInch: boolean): Vec2 | null => {
      for (const side of order) {
        const to = clearTo(start, side)
        if (Math.hypot(to.x - start.x, to.z - start.z) > maxDisp + 1e-9) continue
        if (!spotProblem(s, g, to, { oneInch })) return to
      }
      return findClearSpot(s, g, clearTo(start, order[0]!), 1.5, { oneInch, accept: (c) => Math.hypot(c.x - start.x, c.z - start.z) <= maxDisp + 1e-9 })
    }
    const test = ctx.roll('doorCloseI', 1)[0]!
    const passed = d6TestPasses(test, stat(s, g.id, 'I'))
    let to: Vec2 | null = null
    if (passed) to = fits(k.clearMove, true)
    if (!to) {
      // failed the test, or no room to dodge: a S3 D2 hit, then clear the doorway by the shortest way (R-15.6)
      resolveHit(ctx, { targetId: g.id, strength: k.strength, ap: k.ap, damage: k.damage, source: 'door' })
      if (g.location !== 'board') continue
      // a crowded doorway: the nearest clear spot on either side, searching wider than the usual push (S4 sim finding)
      to = fits(8, true) ?? fits(8, false) ?? findClearSpot(s, g, clearTo(start, order[0]!), 6)
      if (!to) throw new Error(`no clear spot for ${g.id} after door ${doorId} closed`)
    }
    const from = { ...g.pos }
    g.pos = { x: to.x, y: 0, z: to.z }
    ctx.emit({ type: 'FighterMoved', fighterId: g.id, kind: 'doorPush', from, to: { ...g.pos }, path: [{ x: from.x, z: from.z }, { ...to }], length: round3(Math.hypot(to.x - from.x, to.z - from.z)), maxInches: k.clearMove }, g.seat)
    standUpContacted(ctx, g)
  }
}

/** Access Terminal (Basic): Int test at -2; a pass operates the terminal's door for free from any distance (R-15.7). */
export function accessTerminal(ctx: Ctx, f: Fighter, terminalId: string, doorId: string): boolean {
  const t = constants(ctx.state).terminal
  const total = ctx.roll('terminal', 1, '2d6')[0]!
  const passed = twoD6TestPasses(total, stat(ctx.state, f.id, 'Int'), t.modifier)
  ctx.emit({ type: 'TerminalAccessed', fighterId: f.id, terminalId }, f.seat)
  if (passed) setDoor(ctx, doorId, { state: 'open', locked: false })
  return passed
}

/** Force Door (Basic): D6 + S >= 9, +2 for each other friendly fighter in base contact with the door; opens it for good. */
export function forceDoor(ctx: Ctx, f: Fighter, doorId: string): boolean {
  const k = constants(ctx.state).forceDoor
  const roll = ctx.roll('forceDoor', 1)[0]!
  const total = roll + stat(ctx.state, f.id, 'S') + k.helperBonus * doorHelpers(ctx.state, f, doorId).length
  const passed = total >= k.target
  if (passed) setDoor(ctx, doorId, { state: 'open', locked: false })
  return passed
}

// ---------------------------------------------------------------------------
// Ductways (R-15.9)
// ---------------------------------------------------------------------------

export interface DuctChoice {
  ductId: string
  /** the end the fighter stands at and the end it comes out of */
  from: Vec2
  exit: Vec2
  /** where the base is placed: within 1" of the exit, not within 1" of an enemy, overlapping nothing */
  spot: Vec2
}

function crossesSolid(state: GameState, a: Vec2, b: Vec2): boolean {
  const def = state.board.def
  for (const w of def.walls) if (segmentPolygonIntervals(a, b, w.poly).length > 0) return true
  for (const d of def.doors) {
    const rec = state.board.doors[d.id]
    if ((!rec || rec.state === 'closed') && segmentPolygonIntervals(a, b, d.poly).length > 0) return true
  }
  return false
}

/** Ductway crossings available to a fighter (one per duct end it stands within 1" of that has a legal exit spot). */
export function ductChoices(state: GameState, f: Fighter): DuctChoice[] {
  const k = constants(state).duct
  const reach = constants(state).radii.interact
  const out: DuctChoice[] = []
  for (const duct of state.board.def.ducts) {
    for (const [from, exit] of [
      [duct.a, duct.b],
      [duct.b, duct.a],
    ] as const) {
      if (Math.hypot(from.x - f.pos.x, from.z - f.pos.z) - f.baseRadius > reach + 1e-9) continue
      const spot = findClearSpot(state, f, exit, f.baseRadius + k.exitRadius, {
        oneInch: true,
        accept: (c) => Math.hypot(c.x - exit.x, c.z - exit.z) - f.baseRadius <= k.exitRadius + 1e-9 && !crossesSolid(state, exit, c),
      })
      if (spot && insideOutline(state.board.def, spot)) out.push({ ductId: duct.id, from: { ...from }, exit: { ...exit }, spot })
    }
  }
  return out
}

/** Crawl Through Ductway (Double): placed at the chosen exit spot facing out of the duct. */
export function crawlDuct(ctx: Ctx, f: Fighter, choice: DuctChoice): void {
  const from = { ...f.pos }
  f.pos = { x: choice.spot.x, y: 0, z: choice.spot.z }
  f.facing = round3(Math.atan2(choice.exit.x - choice.from.x, choice.exit.z - choice.from.z))
  ctx.emit({ type: 'DuctUsed', fighterId: f.id, ductId: choice.ductId }, f.seat)
  ctx.emit({ type: 'FighterMoved', fighterId: f.id, kind: 'duct', from, to: { ...f.pos }, path: [{ x: from.x, z: from.z }, { ...choice.spot }], length: round3(Math.hypot(choice.spot.x - from.x, choice.spot.z - from.z)), maxInches: constants(ctx.state).duct.maxLength }, f.seat)
  standUpContacted(ctx, f)
}

// ---------------------------------------------------------------------------
// Loot caskets and ammo caches (R-15.11)
// ---------------------------------------------------------------------------

/** Radius of a casket disc (1" diameter). */
export const CASKET_RADIUS = 0.5

export function casketGap(f: Fighter, pos: Vec2): number {
  return Math.max(0, Math.hypot(pos.x - f.pos.x, pos.z - f.pos.z) - f.baseRadius - CASKET_RADIUS)
}

export function casketsNear(state: GameState, f: Fighter, states: readonly CasketStateName[]): string[] {
  const reach = constants(state).radii.interact
  return Object.entries(state.board.caskets)
    .filter(([, c]) => states.includes(c.state) && c.carriedBy === null && casketGap(f, c.pos) <= reach + 1e-9)
    .map(([id]) => id)
    .sort()
}

/** May this fighter's seat open caskets in this scenario (Smash & Grab: attacker only, M-3.6)? */
export function mayOpenCaskets(state: GameState, f: Fighter): boolean {
  const openBy = (state.data.scenario.caskets as { openBy?: string } | undefined)?.openBy
  if (!openBy || openBy === 'either') return true
  return state.players[f.seat].role === openBy
}

/** The core contents table result for a D6 (clamped to 1..6). A scenario table (scenarios.ts `scenarioCasketOutcome`) replaces it. */
export function casketContents(state: GameState, roll: number): string {
  const r = Math.max(1, Math.min(6, roll))
  const row = constants(state).casket.contents.find((c) => r >= c.min && r <= c.max)
  return row ? row.result : 'nothing'
}

function openCasket(ctx: Ctx, f: Fighter, casketId: string, contentsModifier: number): void {
  const s = ctx.state
  const c = s.board.caskets[casketId]!
  const roll = ctx.roll('casketContents', 1)[0]!
  const effective = Math.max(1, roll + contentsModifier)
  const result = casketContents(s, effective)
  c.openedBy = f.seat
  s.scenario.caskets.opened += 1
  // a scenario's own table replaces the core one (Smash & Grab, M-3.7): the casket is removed once opened
  const own = scenarioCasketOutcome(s, effective)
  if (own) {
    c.state = own.remove ? 'removed' : 'opened'
    ctx.emit({ type: 'CasketOpened', casketId, by: f.id, roll, result: own.result }, f.seat)
    if (own.blast) casketBlast(ctx, c.pos, own.blast)
    onCasketOpened(ctx, f)
    return
  }
  c.state = result === 'ammoCache' ? 'ammoCache' : 'opened'
  ctx.emit({ type: 'CasketOpened', casketId, by: f.id, roll, result }, f.seat)
  if (result === 'fragTrap') {
    // R-15.11 ruling: an immediate frag-grenade explosion centred on the casket, no hit roll
    ctx.emit({ type: 'BlastPlaced', centre: { ...c.pos }, radius: 1.5 }, null)
    resolveBlast(ctx, { centre: { ...c.pos }, radius: 1.5, strength: 3, ap: 0, damage: 1, source: 'casket', knockback: true })
  }
  onCasketOpened(ctx, f)
}

/** Smash Open (Basic): D6 + S >= 6, then -1 on the contents roll (minimum 1). */
export function smashCasket(ctx: Ctx, f: Fighter, casketId: string): boolean {
  const k = constants(ctx.state).casket.smash
  const roll = ctx.roll('casketSmash', 1)[0]!
  const passed = roll + stat(ctx.state, f.id, 'S') >= k.target
  if (passed) openCasket(ctx, f, casketId, k.contentsModifier)
  return passed
}

/** Bypass Lock (Basic): an Int test opens it with the normal contents roll. */
export function bypassCasket(ctx: Ctx, f: Fighter, casketId: string): boolean {
  const total = ctx.roll('casketBypass', 1, '2d6')[0]!
  const passed = twoD6TestPasses(total, stat(ctx.state, f.id, 'Int'))
  if (passed) openCasket(ctx, f, casketId, 0)
  return passed
}

/** Where a carried casket is put down: in base contact with the fighter, ahead first, overlapping no base, wall or obstacle. */
export function placeCarried(ctx: Ctx, f: Fighter, casketId: string): void {
  const s = ctx.state
  const c = s.board.caskets[casketId]!
  const dist = f.baseRadius + CASKET_RADIUS + 0.01
  const def = s.board.def
  for (let k = 0; k < 16; k++) {
    const off = Math.ceil(k / 2) * ((2 * Math.PI) / 16) * (k % 2 === 1 ? 1 : -1)
    const a = f.facing + off
    const p = { x: round3(f.pos.x + Math.sin(a) * dist), z: round3(f.pos.z + Math.cos(a) * dist) }
    if (!insideOutline(def, p)) continue
    if (def.walls.some((w) => circleOverlapsPolygon(p, CASKET_RADIUS, w.poly))) continue
    if (def.doors.some((d) => s.board.doors[d.id]?.state === 'closed' && circleOverlapsPolygon(p, CASKET_RADIUS, d.poly))) continue
    if (def.obstacles.some((o) => circleOverlapsPolygon(p, CASKET_RADIUS, o.poly) || pointInPolygon(p, o.poly))) continue
    if (onBoard(s).some((g) => g.id !== f.id && Math.hypot(g.pos.x - p.x, g.pos.z - p.z) < g.baseRadius + CASKET_RADIUS - 1e-6)) continue
    c.pos = p
    ctx.emit({ type: 'CasketMoved', casketId, to: { ...p }, carriedBy: f.id }, f.seat)
    return
  }
}

/** Fighters within a cache's radius get +2 to Ammo tests and ignore Scarce (R-15.11). */
export function ammoCacheNear(state: GameState, f: Fighter): string | null {
  const k = constants(state).casket.ammoCache
  for (const [id, c] of Object.entries(state.board.caskets).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (c.state !== 'ammoCache') continue
    if (casketGap(f, c.pos) <= k.radius + 1e-9) return id
  }
  return null
}


// ---------------------------------------------------------------------------
// Doors as targets (R-15.8) and Fire Through Ductway (R-15.9), S3a
// ---------------------------------------------------------------------------

export interface DoorTarget {
  doorId: string
  /** shooter base edge to the nearest visible point of the door face */
  distance: number
}

function clearOfOthers(state: GameState, a: Vec2, b: Vec2, exceptDoor: string): boolean {
  const def = state.board.def
  for (const w of def.walls) if (segmentPolygonIntervals(a, b, w.poly).length > 0) return false
  for (const d of def.doors) {
    if (d.id === exceptDoor) continue
    const rec = state.board.doors[d.id]
    if ((!rec || rec.state === 'closed') && segmentPolygonIntervals(a, b, d.poly).length > 0) return false
  }
  for (const sm of state.board.smoke) {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((sm.pos.x - a.x) * dx + (sm.pos.z - a.z) * dz) / len2))
    if (Math.hypot(a.x + dx * t - sm.pos.x, a.z + dz * t - sm.pos.z) < sm.radius) return false
  }
  return true
}

/**
 * Closed doors a fighter can shoot (R-15.8): some point of the door face on the shooter's side is inside its vision arc
 * (any direction with `allArc`, Blind Fire) and in line of sight (no wall, other closed door or smoke on the way).
 */
export function shootableDoors(state: GameState, f: Fighter, allArc: boolean): DoorTarget[] {
  const out: DoorTarget[] = []
  const c = centreOf(f)
  for (const d of state.board.def.doors) {
    const rec = state.board.doors[d.id]
    if (!rec || rec.state !== 'closed') continue
    const { mid, n, half } = doorFrame(d.poly, d.seg)
    const side = (c.x - mid.x) * n.x + (c.z - mid.z) * n.z >= 0 ? 1 : -1
    let best = Infinity
    for (let k = 0; k <= 4; k++) {
      const t = k / 4
      const p = { x: d.seg.a.x + (d.seg.b.x - d.seg.a.x) * t + n.x * side * (half + 0.02), z: d.seg.a.z + (d.seg.b.z - d.seg.a.z) * t + n.z * side * (half + 0.02) }
      if (!allArc) {
        if (f.posture !== 'standing') continue
        const bearing = Math.atan2(p.x - c.x, p.z - c.z)
        const off = Math.abs(Math.atan2(Math.sin(bearing - f.facing), Math.cos(bearing - f.facing)))
        if (off > Math.PI / 4 + 1e-9) continue
      }
      if (!clearOfOthers(state, c, p, d.id)) continue
      best = Math.min(best, Math.max(0, Math.hypot(p.x - c.x, p.z - c.z) - f.baseRadius))
    }
    if (Number.isFinite(best)) out.push({ doorId: d.id, distance: round3(best) })
  }
  return out
}

export interface DuctFire {
  ductId: string
  /** the end the shooter stands at */
  from: Vec2
  /** the far end */
  far: Vec2
  /** enemies within 1" of the far end */
  targets: string[]
}

/** Fighters (any side) whose base is within `within` inches of a point. */
export function fightersNear(state: GameState, p: Vec2, within: number): Fighter[] {
  return onBoard(state)
    .filter((g) => Math.hypot(g.pos.x - p.x, g.pos.z - p.z) - g.baseRadius <= within + 1e-9)
    .sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z) || (a.id < b.id ? -1 : 1))
}

/** Ductways a fighter can fire through: it stands within 1" of one end and an enemy is within 1" of the other (R-15.9). */
export function ductFireChoices(state: GameState, f: Fighter): DuctFire[] {
  const reach = constants(state).radii.interact
  const out: DuctFire[] = []
  for (const duct of state.board.def.ducts) {
    const da = Math.hypot(duct.a.x - f.pos.x, duct.a.z - f.pos.z)
    const db = Math.hypot(duct.b.x - f.pos.x, duct.b.z - f.pos.z)
    const [from, far] = da <= db ? [duct.a, duct.b] : [duct.b, duct.a]
    if (Math.hypot(from.x - f.pos.x, from.z - f.pos.z) - f.baseRadius > reach + 1e-9) continue
    const targets = fightersNear(state, far, reach)
      .filter((g) => g.seat !== f.seat)
      .map((g) => g.id)
    if (targets.length > 0) out.push({ ductId: duct.id, from: { ...from }, far: { ...far }, targets })
  }
  return out
}
