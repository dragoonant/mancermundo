// Set-up decisions (docs/spec/40-ai.md section 2): role, crew, half or tile, casket spots and deployment. Deployment puts
// each fighter where the enemy's zone sees it least (walls and obstacles in the way) while keeping a lane for its gun,
// the gang spread but within nerve support, facing the enemy; specialists first, the Leader last.
import { act, type Action, type DecisionOption, type Fighter, type GameState, type Vec2 } from '@/engine'
import { validate } from '@/engine'
import { coverFrom, hasLosFrom } from '@/engine/los'
import { polygonBBox, round3 } from '@/engine/geometry'
import { getFighter, friendsOf } from '@/engine/state'
import { suggest } from '@/engine'
import { fighterValue, overlay } from './eval'
import { idealRange, leansMelee } from './goals'
import type { AiCtx } from './tiers'

const centre = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })

/** `setup.role`: attacker when offered (the raiding side has the objective and the larger crew), else deploy second. */
export function role(ctx: AiCtx): Action | null {
  const opts = ctx.pending.options ?? []
  const pick = (c: string) => opts.find((o) => o.action.type === 'setup.role' && o.action.payload.choice === c)
  return (pick('attacker') ?? pick('second') ?? pick('defender') ?? pick('first') ?? opts[0])?.action ?? null
}

/** `setup.crew`: the Leader, then Champions, then the best-armed fighters (the engine draws the random part itself). */
export function crew(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  const opts = (p.options ?? []).filter((o) => o.action.type === 'setup.crew' && o.action.payload.fighterId)
  if (opts.length === 0) return (p.options ?? []).find((o) => o.action.type === 'setup.crew')?.action ?? null
  const rank = (o: DecisionOption): number => {
    const f = getFighter(state, (o.action as Extract<Action, { type: 'setup.crew' }>).payload.fighterId!)
    const ranged = f.weapons.some((w) => state.data.weapons[w.weaponId]?.class === 'heavy' || state.data.weapons[w.weaponId]?.class === 'special')
    return fighterValue(state, f) * 2 + (ranged ? 0.4 : 0) + f.stats.W * 0.2 + (state.data.fighterTypes[f.typeId]?.cost ?? 0) / 400
  }
  return opts.slice().sort((a, b) => rank(b) - rank(a))[0]!.action
}

/** `setup.zone`: the half with more cover to deploy behind, or the tile closest to the loot. */
export function zone(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  const opts = (p.options ?? []).filter((o) => o.action.type === 'setup.zone')
  if (opts.length === 0) return null
  const def = state.board.def
  const caskets = Object.values(state.board.caskets)
  const inRects = (rects: Vec2[][], c: Vec2): boolean => rects.some((r) => {
    const b = polygonBBox(r)
    return c.x >= b.minX && c.x <= b.maxX && c.z >= b.minZ && c.z <= b.maxZ
  })
  const zones = (p.context.zones ?? p.context.tiles) as Record<string, Vec2[][]> | undefined
  let best: { o: DecisionOption; s: number } | null = null
  for (const o of opts) {
    const id = (o.action as Extract<Action, { type: 'setup.zone' }>).payload.zoneId
    const rects = zones?.[id] ?? []
    let s = 0
    if (rects.length > 0) {
      const b = rects.map((r) => polygonBBox(r))
      const minX = Math.min(...b.map((x) => x.minX))
      const maxX = Math.max(...b.map((x) => x.maxX))
      const minZ = Math.min(...b.map((x) => x.minZ))
      const maxZ = Math.max(...b.map((x) => x.maxZ))
      const mid = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
      // cover to deploy behind: obstacle and wall pieces whose centre lies near the zone
      for (const poly of [...def.obstacles.map((q) => q.poly), ...def.walls.map((q) => q.poly)]) {
        const bb = polygonBBox(poly)
        const c = { x: (bb.minX + bb.maxX) / 2, z: (bb.minZ + bb.maxZ) / 2 }
        if (inRects(rects, c) || Math.hypot(c.x - mid.x, c.z - mid.z) < 5) s += 0.1
      }
      // loot: the zone nearest the caskets (they decide Forgotten Riches)
      for (const c of caskets) s -= 0.02 * Math.hypot(c.pos.x - mid.x, c.pos.z - mid.z)
    }
    if (!best || s > best.s + 1e-9) best = { o, s }
  }
  return best!.o.action
}

/** `setup.casket`: the engine's spot (a legal one near the middle of the region, authored spots first). */
export function casket(ctx: AiCtx): Action | null {
  const s = suggest(ctx.view, ctx.pending)
  return s && !validate(ctx.view, s) ? s : null
}

/** Order in which a gang deploys: the heavy and special weapons first (they need the good lanes), the Leader last. */
function deployRank(state: GameState, f: Fighter): number {
  const heavy = f.weapons.some((w) => state.data.weapons[w.weaponId]?.class === 'heavy' || state.data.weapons[w.weaponId]?.class === 'special')
  return (heavy ? 3 : 0) + (leansMelee(state, f) ? 0 : 1) + (f.role === 'leader' ? -4 : f.role === 'champion' ? -1 : 0)
}

/** Where the gang started: the centre of its deployed fighters (a place to carry loot back to). */
function rememberHome(ctx: AiCtx, seat: Fighter['seat'], at: Vec2): void {
  const mine = Object.values(ctx.view.fighters).filter((g) => g.seat === seat && g.location === 'board')
  const pts = [...mine.map((g) => ({ x: g.pos.x, z: g.pos.z })), at]
  ctx.memory.home ??= {}
  ctx.memory.home[seat] = { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, z: pts.reduce((a, q) => a + q.z, 0) / pts.length }
}

/** `setup.deploy`: one fighter at the best spot of the zone. */
export function deploy(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  const c = p.constraints
  if (!c?.fighterIds || c.fighterIds.length === 0) return null
  const rects = (p.context.regions as Vec2[][] | undefined) ?? (c.region ? [c.region] : [])
  const fighters = c.fighterIds.map((id) => getFighter(state, id)).sort((a, b) => deployRank(state, b) - deployRank(state, a) || (a.id < b.id ? -1 : 1))
  const f = fighters[0]!
  const defaultFacing = Number(p.context.facing ?? 0)
  const def = state.board.def
  const bb = def.bounds
  // where the enemy will stand: the mirror of our zone through the middle of the board (or the enemy fighters already placed)
  const myBoxes = rects.map((r) => polygonBBox(r))
  const myMid = { x: (Math.min(...myBoxes.map((b) => b.minX)) + Math.max(...myBoxes.map((b) => b.maxX))) / 2, z: (Math.min(...myBoxes.map((b) => b.minZ)) + Math.max(...myBoxes.map((b) => b.maxZ))) / 2 }
  const mid = { x: (bb.minX + bb.maxX) / 2, z: (bb.minZ + bb.maxZ) / 2 }
  const placedEnemies = Object.values(state.fighters).filter((e) => e.seat !== f.seat && e.location === 'board')
  const samples: Vec2[] =
    placedEnemies.length > 0
      ? placedEnemies.map((e) => centre(e))
      : [-8, -4, 0, 4, 8].map((dx) => ({ x: Math.max(bb.minX + 2, Math.min(bb.maxX - 2, 2 * mid.x - myMid.x + dx)), z: 2 * mid.z - myMid.z }))
  const enemyMid = { x: samples.reduce((s, q) => s + q.x, 0) / samples.length, z: samples.reduce((s, q) => s + q.z, 0) / samples.length }
  const ideal = idealRange(state, f)
  const melee = leansMelee(state, f)
  const friends = friendsOf(state, f).filter((g) => g.seat === f.seat && g.location === 'board')
  // lattice of candidate spots inside the zone rectangles: an inch and a half apart, finer when walls and bases leave no room
  const lattice = (step: number): Vec2[] => {
    const out: Vec2[] = []
    for (const r of rects) {
      const b = polygonBBox(r)
      for (let z = b.minZ + f.baseRadius + 0.05; z <= b.maxZ - f.baseRadius; z += step) {
        for (let x = b.minX + f.baseRadius + 0.05; x <= b.maxX - f.baseRadius; x += step) out.push({ x: round3(x), z: round3(z) })
      }
    }
    return out
  }
  const legalSpots = (step: number): Vec2[] => lattice(step).filter((at) => !validate(state, act.deploy(p, f.id, at.x, at.z, 0)))
  let spots = legalSpots(1.5)
  if (spots.length < 3) spots = legalSpots(0.5)
  // a cramped zone (a narrow strip, a tile edge with enemy clearance): pack the way the engine does, or the last fighters have no room
  if (legalSpots(0.5).length < c.fighterIds.length * 10) {
    const packed = suggest(state, p)
    if (packed && !validate(state, packed)) {
      rememberHome(ctx, f.seat, centre(f))
      return packed
    }
  }
  let best: { at: Vec2; s: number } | null = null
  for (const at of spots) {
    const ov = overlay(state, f.id, { pos: at })
    const me = ov.fighters[f.id]!
    let exposed = 0
    let lane = 0
    for (const s of samples) {
      if (!hasLosFrom(ov, s, me)) continue
      const d = Math.hypot(s.x - at.x, s.z - at.z)
      if (d > 26) continue
      const cv = coverFrom(ov, s, me).cover
      exposed += cv === 'none' ? 1 : cv === 'partial' ? 0.5 : 0.2
      if (d <= Math.max(8, ideal * 2.4)) lane += 1
    }
    exposed /= samples.length
    lane /= samples.length
    let s = -1.1 * exposed * (melee ? 1 : 0.7) + (melee ? 0.1 : 0.55) * lane
    // spacing: not on top of a friend (blasts), but within a few inches of support
    let nearest = Infinity
    for (const g of friends) nearest = Math.min(nearest, Math.hypot(g.pos.x - at.x, g.pos.z - at.z))
    if (nearest < 2.2) s -= 0.35
    else if (nearest <= 6) s += 0.15
    // brawlers close up; the Leader hangs back a little
    const toEnemy = Math.hypot(enemyMid.x - at.x, enemyMid.z - at.z)
    s -= (melee ? 0.03 : 0.012) * toEnemy
    if (f.role === 'leader') s += 0.02 * toEnemy
    if (!best || s > best.s + 1e-9) best = { at, s }
  }
  if (!best) return suggest(state, p)
  rememberHome(ctx, f.seat, best.at)
  const facing = round3(Math.atan2(enemyMid.x - best.at.x, enemyMid.z - best.at.z))
  const a = act.deploy(p, f.id, best.at.x, best.at.z, Number.isFinite(facing) ? facing : defaultFacing)
  return validate(state, a) ? act.deploy(p, f.id, best.at.x, best.at.z, defaultFacing) : a
}
