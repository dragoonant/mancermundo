// Move end points and the activation planner (docs/spec/40-ai section 2). For the operative about to act the planner
// enumerates plans (order x move end point x action list within APL) and scores each as
//   damage dealt (+ kill premium) - exposure at the end position + objective control + positional terms.
// The search is bounded by a deterministic work cap (one unit per candidate position) with a wall-clock hard stop.
// Legality comes from the engine: `planMove` for paths, `actionAvailability` for action rules.
import { act, validate, type Action, type Activation, type GameState, type Operative, type Vec2, type Vec3, type Waypoint } from '@/engine'
import { actionAvailability, actionCost } from '@/engine/firefight'
import { abilityOffers, allowedOrders } from '@/engine/abilities'
import { moveLimit, planFly, planMove, type MoveKind } from '@/engine/movement'
import { providerCanFly } from '@/engine/team-rules'
import { enemiesInControlRange, distanceBetween } from '@/engine/measure'
import { bodyOf } from '@/engine/los'
import { enemiesOf, effectiveApl, seatOps } from '@/engine/state'
import { bearing, round3 } from '@/engine/geometry'
import { distanceField, gridFor, routeTo, type Field } from './nav'
import { terrainOf } from '@/engine/terrain'
import { approachTerm, bestShot, exactShot, memo, missionActionValue, objectiveTargets, objectiveValue, overlay, posKey, shotsFrom, withOrder, type ShotEst } from './eval'
import { bestFight } from './fight'
import { teamActionCandidates } from './teamActions'
import { passAction, randomMove } from './random'
import { threatAt, threatPenalty } from './threat'
import { exhausted, spend, type ActivationPlan, type AiCtx, type PlanStep } from './tiers'

// ---------------------------------------------------------------------------
// End points
// ---------------------------------------------------------------------------

export interface Endpoint {
  /** a FLY set-up (Jump Pack): answered with `act.fly`, one waypoint */
  fly?: boolean
  wps: Waypoint[]
  end: Vec3
  tag: string
  pre: number
}

interface Raw {
  x: number
  z: number
  y?: number
  tag: string
}

/** Valid end points for a move of `kind` from where `op` stands, best-looking first (memoised per decision). */
export function endpointsFor(ctx: AiCtx, view: GameState, op: Operative, kind: MoveKind, counteract: boolean, targets: Operative[] = [], want = ctx.params.endpoints): Endpoint[] {
  const key = `EP|${op.id}|${kind}|${op.order}|${posKey(op.pos)}|${counteract ? 1 : 0}|${targets.map((t) => t.id).join(',')}|${want}`
  return memo(ctx, key, () => buildEndpoints(ctx, view, op, kind, counteract, targets, want))
}

function buildEndpoints(ctx: AiCtx, view: GameState, op: Operative, kind: MoveKind, counteract: boolean, targets: Operative[], want: number): Endpoint[] {
  const max = moveLimit(op, kind, counteract, view)
  if (max <= 0) return []
  const r = op.baseRadius
  const here = op.pos
  const idx = terrainOf(view.map)
  const raws: Raw[] = []
  const push = (x: number, z: number, tag: string, y?: number) => {
    const d = Math.hypot(x - here.x, z - here.z)
    if (d < 0.3 || d > max + 0.01) return
    raws.push(y === undefined ? { x, z, tag } : { x, z, tag, y })
  }
  const toward = (tx: number, tz: number, len: number, tag: string) => {
    const dx = tx - here.x
    const dz = tz - here.z
    const d = Math.hypot(dx, dz) || 1
    const l = Math.min(len, d)
    push(here.x + (dx / d) * l, here.z + (dz / d) * l, tag)
  }
  if (kind === 'charge') {
    for (const e of targets) {
      const ring = r + e.baseRadius + 0.12
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        push(e.pos.x + Math.sin(a) * ring, e.pos.z + Math.cos(a) * ring, 'charge', e.pos.y)
      }
      toward(e.pos.x, e.pos.z, Math.max(0.5, Math.hypot(e.pos.x - here.x, e.pos.z - here.z) - ring), 'charge')
    }
  } else {
    const rings = kind === 'dash' ? [max, max * 0.5] : [max, max * 0.65, max * 0.33]
    const n = kind === 'dash' ? 12 : 16
    for (const [ri, rad] of rings.entries()) {
      for (let k = 0; k < n; k++) {
        const a = ((k + ri * 0.5) / n) * Math.PI * 2
        push(here.x + Math.sin(a) * rad, here.z + Math.cos(a) * rad, 'ring')
      }
    }
    for (const t of objectiveTargets(ctx, view)) {
      const d = Math.hypot(t.x - here.x, t.z - here.z)
      if (d <= max + 3) {
        const ring = r + 0.79 + 0.45
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2
          push(t.x + Math.sin(a) * ring, t.z + Math.cos(a) * ring, 'obj')
        }
      }
      toward(t.x, t.z, max, 'obj')
    }
    const foes = enemiesOf(view, op)
      .map((e) => ({ e, d: Math.hypot(e.pos.x - here.x, e.pos.z - here.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
    for (const f of foes) {
      toward(f.e.pos.x, f.e.pos.z, max, 'foe')
      if (kind === 'fallBack') toward(2 * here.x - f.e.pos.x, 2 * here.z - f.e.pos.z, max, 'away')
    }
    // cover: just outside the corners of nearby terrain
    let covers = 0
    for (const s of idx.solids) {
      if (s.ceiling || s.exposed || s.insignificant || covers > 28) continue
      if (here.x < s.bbox.minX - max - 1.5 || here.x > s.bbox.maxX + max + 1.5 || here.z < s.bbox.minZ - max - 1.5 || here.z > s.bbox.maxZ + max + 1.5) continue
      const poly = s.polygon
      let cx = 0
      let cz = 0
      for (const p of poly) {
        cx += p.x
        cz += p.z
      }
      cx /= poly.length
      cz /= poly.length
      for (const p of poly.slice(0, 10)) {
        const dx = p.x - cx
        const dz = p.z - cz
        const d = Math.hypot(dx, dz) || 1
        push(p.x + (dx / d) * (r + 0.25), p.z + (dz / d) * (r + 0.25), 'cover')
        covers++
      }
      if (kind !== 'dash' && s.floors.length > 0 && Math.hypot(cx - here.x, cz - here.z) <= max) push(cx, cz, 'vantage', s.floors[0])
    }
  }
  // dedupe on a 0.4" grid, then validate with the engine's own path pricing
  const seen = new Set<string>()
  const out: Endpoint[] = []
  let attempts = 0
  const preFor = (end: Vec3): number => {
    const ghost = { ...op, pos: end }
    let p = approachTerm(ctx, view, ghost)
    if (kind === 'charge' && targets.length) p -= 0.05 * Math.min(...targets.map((t) => Math.hypot(t.pos.x - end.x, t.pos.z - end.z)))
    return p
  }
  const keyOf = (e: Vec3) => `${Math.round(e.x / 0.3)},${Math.round(e.z / 0.3)},${Math.round(e.y)}`
  const taken = new Set<string>()
  const accept = (wps: Waypoint[], tag: string): boolean => {
    const plan = planMove(view, op, kind, wps, counteract)
    if (!plan.ok) return false
    const k = keyOf(plan.end)
    if (taken.has(k)) return true
    taken.add(k)
    out.push({ wps, end: plan.end, tag, pre: preFor(plan.end) })
    return true
  }
  // FLY (Jump Pack): set up again within the move, terrain between ignored; tried when the walk is blocked
  const flies = providerCanFly(view, op, kind)
  const acceptFly = (wp: Waypoint, tag: string): boolean => {
    if (!flies) return false
    const plan = planFly(view, op, kind, [wp], counteract)
    if (!plan.ok) return false
    const k = keyOf(plan.end)
    if (taken.has(k)) return true
    taken.add(k)
    out.push({ fly: true, wps: [wp], end: plan.end, tag: `${tag}-fly`, pre: preFor(plan.end) })
    return true
  }
  // routed attempts need a distance field; build it once, only for ground moves
  const avoid = enemiesOf(view, op).map((e) => ({ x: e.pos.x, z: e.pos.z, r: e.baseRadius }))
  let field: Field | null = null
  const routeFor = (to: Vec2): Waypoint[] | null => {
    if (here.y > 0.01) return null
    field ??= distanceField(gridFor(view.map, r, op.height), here, max + 0.5, avoid)
    return routeTo(field, to, avoid)
  }
  let routed = 0
  for (const rw of raws) {
    const gk = `${Math.round(rw.x / 0.4)},${Math.round(rw.z / 0.4)},${rw.y ?? ''}`
    if (seen.has(gk)) continue
    seen.add(gk)
    if (attempts >= 90) break
    const ys = rw.y !== undefined ? [rw.y] : here.y > 0.01 ? [here.y, 0] : [undefined]
    for (const y of ys) {
      attempts++
      const wp: Waypoint = { x: round3(rw.x), z: round3(rw.z), ...(y !== undefined ? { y } : {}) }
      if (accept([wp], rw.tag)) continue
      if (acceptFly(wp, rw.tag)) continue
      // blocked straight line: try a route around the walls
      if (routed < 28 && y === undefined && kind !== 'dash') {
        const route = routeFor(wp)
        if (route) {
          routed++
          accept(route, rw.tag)
        }
      }
    }
  }
  out.sort((a, b) => b.pre - a.pre)
  if (out.length <= want) return out
  // keep the best-looking ones, but always reserve room for cover / vantage spots and spread the rest
  const picked: Endpoint[] = out.slice(0, Math.max(1, want - 3))
  const rest = out.slice(want - 3)
  for (const e of rest) if ((e.tag === 'cover' || e.tag === 'vantage') && picked.length < want) picked.push(e)
  for (let i = 0; picked.length < want && i < rest.length; i += Math.max(1, Math.floor(rest.length / 4))) if (!picked.includes(rest[i]!)) picked.push(rest[i]!)
  return picked.slice(0, want)
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

interface Node {
  v: GameState
  op: Operative
  performed: string[]
  weaponsUsed: string[]
  ap: number
  steps: PlanStep[]
  /** value accumulated by the steps (damage, mission actions), end-state terms excluded */
  acc: number
  value: number
  /** the shot behind a trailing shoot step (for the exact re-rating) */
  shot?: ShotEst
}

function hypAct(ctx: AiCtx, n: Node, counteract: boolean): Activation {
  return { operativeId: n.op.id, seat: ctx.seat, counteract, stage: 'action', apSpent: n.ap, performed: n.performed, declared: null, weaponsUsed: n.weaponsUsed }
}

/** Value of the position itself: exposure, objective control, approach and perch bonuses. */
export function endScore(ctx: AiCtx, v: GameState, op: Operative): number {
  const key = `E|${op.id}|${op.order}|${posKey(op.pos)}`
  return memo(ctx, key, () => {
    const t = threatAt(ctx, v, op)
    let s = -threatPenalty(ctx, t, op) + objectiveValue(ctx, v) + approachTerm(ctx, v, op)
    if (op.pos.y > 1.5) s += ctx.w.position
    return s
  })
}

function shotsAt(ctx: AiCtx, n: Node): ShotEst[] {
  const key = `S|${n.op.id}|${n.op.order}|${posKey(n.op.pos)}|${n.performed.join(',')}`
  return memo(ctx, key, () => shotsFrom(ctx, n.v, n.op, n.performed))
}

function engagedWith(ctx: AiCtx, n: Node): Operative[] {
  const key = `CR|${n.op.id}|${posKey(n.op.pos)}`
  return memo(ctx, key, () => enemiesInControlRange(n.v, n.op, n.op.seat))
}

function node(ctx: AiCtx, base: Omit<Node, 'value'>): Node {
  return { ...base, value: base.acc + endScore(ctx, base.v, base.op) }
}

function moved(ctx: AiCtx, from: Node, kind: MoveKind, e: Endpoint, cost: number, targetId?: string): Node {
  const v = overlay(from.v, from.op.id, e.end)
  const op = v.operatives[from.op.id]!
  return node(ctx, {
    v,
    op,
    performed: [...from.performed, kind],
    weaponsUsed: from.weaponsUsed,
    ap: from.ap + cost,
    steps: [...from.steps, { action: kind, wps: e.wps, ...(e.fly ? { fly: true } : {}), ...(targetId ? { targetId } : {}) }],
    acc: from.acc,
  })
}

/** The node plus its best attack (shoot or fight) when one is worth taking and AP allows; null when there is none. */
function withAttack(ctx: AiCtx, n: Node, apl: number, counteract: boolean): Node | null {
  if (n.ap + 1 > apl) return null
  let best: Node | null = null
  const engaged = engagedWith(ctx, n)
  const hyp = hypAct(ctx, n, counteract)
  if (engaged.length > 0) {
    if (!n.performed.includes('fight') && hasMelee(n)) {
      const f = bestFight(ctx, n.v, n.op, engaged)
      if (f && f.est.value > 0.05) {
        best = node(ctx, { ...n, performed: [...n.performed, 'fight'], ap: n.ap + 1, steps: [...n.steps, { action: 'fight', targetId: f.target.id, ...(f.est.weaponId ? { weaponId: f.est.weaponId } : {}) }], acc: n.acc + f.est.value })
      }
    }
  }
  if (!n.performed.includes('shoot') && (engaged.length === 0 || hasExplosive(n))) {
    const s = bestShot(shotsAt(ctx, n))
    if (s && s.score > 0.05 && n.ap + 1 <= apl) {
      const c = node(ctx, {
        ...n,
        performed: [...n.performed, 'shoot'],
        weaponsUsed: [...n.weaponsUsed, s.weaponId],
        ap: n.ap + 1,
        steps: [...n.steps, { action: 'shoot', targetId: s.targetId, weaponId: s.weaponId }],
        acc: n.acc + s.score,
      })
      c.shot = s
      if (!best || c.value > best.value) best = c
    }
  }
  return best
}

function hasExplosive(n: Node): boolean {
  return n.op.weapons.some((w) => n.v.data.weapons[w]?.rules.some((r) => r.rule.toLowerCase().includes('explosive')))
}

function hasMelee(n: Node): boolean {
  return n.op.weapons.some((w) => n.v.data.weapons[w]?.type === 'melee')
}

const MOVE_KINDS: MoveKind[] = ['reposition', 'dash', 'fallBack']

/** Expand a node with every move the rules allow and the budget pays for. */
function expandMoves(ctx: AiCtx, n: Node, apl: number, counteract: boolean, depth: number, out: Node[]): void {
  const hyp = hypAct(ctx, n, counteract)
  const engaged = engagedWith(ctx, n)
  // charge: aim at the enemies that could be reached; the fight follows when the AP allows
  const cost = actionCost(n.v, n.op, 'charge', hyp)
  if (engaged.length === 0 && n.ap + cost <= apl && !actionAvailability(n.v, n.op, 'charge', hyp)) {
    const reach = moveLimit(n.op, 'charge', counteract, n.v) + 1.5
    const foes = enemiesOf(n.v, n.op)
      .filter((e) => distanceBetween(bodyOf(n.op), bodyOf(e)) <= reach)
      .sort((a, b) => distanceBetween(bodyOf(n.op), bodyOf(a)) - distanceBetween(bodyOf(n.op), bodyOf(b)))
      .slice(0, 3)
    for (const f of foes) {
      for (const e of endpointsFor(ctx, n.v, n.op, 'charge', counteract, [f], 3)) {
        if (!spend(ctx)) return
        const m = moved(ctx, n, 'charge', e, cost, f.id)
        if (n.ap + cost + 1 <= apl && ctx.params.depth >= 2) {
          const a = withAttack(ctx, m, apl, counteract)
          if (a) out.push(a)
        }
        // a lone charge still scores for the position it takes
        out.push(m)
      }
    }
  }
  for (const kind of MOVE_KINDS) {
    const cost = actionCost(n.v, n.op, kind, hyp)
    if (n.ap + cost > apl) continue
    if (actionAvailability(n.v, n.op, kind, hyp)) continue
    const want = depth === 0 ? (kind === 'reposition' ? ctx.params.endpoints : Math.max(3, Math.floor(ctx.params.endpoints / 2))) : Math.max(2, Math.floor(ctx.params.endpoints / 3))
    for (const e of endpointsFor(ctx, n.v, n.op, kind, counteract, [], want)) {
      if (!spend(ctx)) return
      const m = moved(ctx, n, kind, e, cost)
      out.push(m)
      if (ctx.params.depth >= 2) {
        const a = withAttack(ctx, m, apl, counteract)
        if (a) out.push(a)
      }
    }
  }
}

function missionNearby(ctx: AiCtx, n: Node): boolean {
  const near = objectiveTargets(ctx, n.v).some((t) => Math.hypot(t.x - n.op.pos.x, t.z - n.op.pos.z) <= 3.6)
  const hasAmmo = n.v.markers.some((m) => m.equipmentId === 'core.e.ammo-cache' && m.owner === ctx.seat && Math.hypot(m.pos.x - n.op.pos.x, m.pos.z - n.op.pos.z) <= 3.6)
  return near || hasAmmo
}

/** Mission and equipment actions available at a node near an objective, plus the team's own unique actions. */
function expandAbilities(ctx: AiCtx, n: Node, apl: number, counteract: boolean, out: Node[]): void {
  const mission = (ctx.params.tacAware || ctx.view.turningPoint >= 2) && missionNearby(ctx, n)
  let offers
  try {
    offers = abilityOffers(n.v, n.op, hypAct(ctx, n, counteract))
  } catch {
    return
  }
  // team unique actions (Markerlight, Signal, Medikit, Reanimate, Flail...): the few worth an AP, then the attack they enable
  for (const c of teamActionCandidates(ctx, n.v, n.op, offers, n.performed)) {
    const o = c.offer
    if (n.ap + o.cost > apl) continue
    const performed = [...n.performed, o.action]
    const m = node(ctx, { ...n, performed, ap: n.ap + o.cost, steps: [...n.steps, { action: o.id }], acc: n.acc + c.value })
    out.push(m)
    if (ctx.params.depth >= 2) {
      const a = withAttack(ctx, m, apl, counteract)
      if (a) out.push(a)
    }
  }
  if (!mission) return
  for (const o of offers) {
    if (n.ap + o.cost > apl) continue
    const id = o.abilityId
    let val = 0
    if (/secure|loot|transmi/i.test(id)) val = missionActionValue(ctx, n.v, id, o.params.markerId as string | undefined)
    else if (/ammo/i.test(id)) val = 0.5
    if (val <= 0) continue
    const performed = [...n.performed, o.action]
    const m = node(ctx, { ...n, performed, ap: n.ap + o.cost, steps: [...n.steps, { action: o.id }], acc: n.acc + val })
    out.push(m)
    if (ctx.params.depth >= 2) {
      const a = withAttack(ctx, m, apl, counteract)
      if (a) out.push(a)
    }
  }
}

export interface PlanOpts {
  counteract?: boolean
  performed?: string[]
  apSpent?: number
  banned?: string[]
  weaponsUsed?: string[]
}

/** Best plan for `opId` under `order` with the work currently allowed. `value` includes the end-state terms. */
export function planOperative(ctx: AiCtx, opId: string, order: 'engage' | 'conceal', o: PlanOpts = {}): ActivationPlan & { value: number; nodes: number } {
  const counteract = o.counteract === true
  const v0 = withOrder(ctx.view, opId, order)
  const op0 = v0.operatives[opId]!
  const apl = counteract ? 1 : effectiveApl(op0)
  const banned = new Set(o.banned ?? [])
  const performed = o.performed ?? []
  const root: Node = node(ctx, { v: v0, op: op0, performed, weaponsUsed: o.weaponsUsed ?? [], ap: o.apSpent ?? 0, steps: [], acc: 0 })
  const all: Node[] = [root]
  const frontier: Node[] = [root]

  // attack in place, then move on
  if (apl - root.ap >= 1 && !exhausted(ctx)) {
    const a = withAttack(ctx, root, apl, counteract)
    if (a) {
      all.push(a)
      frontier.push(a)
    }
    // guard: a modest value for an operative that has nothing better and may go on Guard
    if (!root.performed.includes('guard') && !actionAvailability(root.v, root.op, 'guard', hypAct(ctx, root, counteract))) {
      const hasRanged = root.op.weapons.some((w) => root.v.data.weapons[w]?.type === 'ranged')
      if (hasRanged) all.push(node(ctx, { ...root, performed: [...performed, 'guard'], ap: root.ap + 1, steps: [{ action: 'guard' }], acc: ctx.w.guard }))
    }
    expandAbilities(ctx, root, apl, counteract, all)
  }
  const depthMax = Math.max(1, ctx.params.depth)
  let layer = frontier
  for (let d = 0; d < depthMax && layer.length > 0 && !exhausted(ctx); d++) {
    const next: Node[] = []
    for (const n of layer) {
      if (n.ap >= apl) continue
      expandMoves(ctx, n, apl, counteract, d, next)
      if (exhausted(ctx)) break
    }
    for (const n of next) all.push(n)
    // next layer: the best few, any that still have AP left
    layer = next
      .filter((n) => n.ap < apl)
      .sort((a, b) => b.value - a.value)
      .slice(0, d === 0 ? 4 : 2)
    for (const n of layer) {
      if (exhausted(ctx)) break
      expandAbilities(ctx, n, apl, counteract, all)
      if (!n.performed.includes('shoot') && !n.performed.includes('fight') && ctx.params.depth >= 3) {
        const a = withAttack(ctx, n, apl, counteract)
        if (a) all.push(a)
      }
    }
  }

  const candidates = all.filter((n) => !n.steps.some((s) => banned.has(s.action)))
  candidates.sort((a, b) => b.value + (b.steps.length > 0 ? 0.05 : 0) - (a.value + (a.steps.length > 0 ? 0.05 : 0)))
  let pool = candidates.slice(0, Math.max(1, ctx.params.refine ? 4 : 1))
  const start: Start = { ap: o.apSpent ?? 0, performed, weaponsUsed: o.weaponsUsed ?? [] }
  if (ctx.params.refine) pool = refine(ctx, pool, counteract, start)
  // an operative with AP to spare prefers a plan with actions over standing still when the cost is small
  if (pool[0] && pool[0].steps.length === 0 && root.ap < apl) {
    const act1 = candidates.find((n) => n.steps.length > 0 && verify(ctx, n, counteract, start))
    if (act1 && act1.value >= pool[0].value - ctx.w.act) pool = [act1, ...pool.filter((n) => n !== act1)]
  }
  const k = Math.min(ctx.params.topK, pool.length)
  const best = pool[k > 1 ? ctx.int(k) : 0] ?? root
  return {
    operativeId: opId,
    turningPoint: ctx.view.turningPoint,
    counteract,
    base: performed.length,
    order,
    steps: best.steps,
    score: best.value,
    gain: best.value - root.value,
    value: best.value,
    nodes: all.length,
  }
}

/** Re-rate the shots of the leading plans with the engine's exact odds and drop plans whose steps turn out illegal. */
function refine(ctx: AiCtx, pool: Node[], counteract: boolean, start: Start): Node[] {
  const out: Node[] = []
  for (const n of pool) {
    let value = n.value
    if (n.shot && n.steps.some((s) => s.action === 'shoot')) {
      try {
        const sh = n.shot
        // the exact score of the best of the three cheapest-rated alternatives at this node's position
        const ests = shotsAt(ctx, { ...n, performed: n.performed.filter((p, i) => !(p === 'shoot' && i === n.performed.lastIndexOf('shoot'))) })
        const top = [...ests].sort((a, b) => b.score - a.score).slice(0, 3)
        let bestExact: ShotEst | null = null
        for (const e of top) {
          const ex = e.fixed ? e : exactShot(ctx, n.v, n.op.id, e.weaponId, e.targetId)
          if (!bestExact || ex.score > bestExact.score) bestExact = ex
        }
        if (bestExact) {
          value += bestExact.score - sh.score
          const step = n.steps.find((s) => s.action === 'shoot')
          if (step) {
            step.weaponId = bestExact.weaponId
            step.targetId = bestExact.targetId
          }
        }
      } catch {
        // keep the cheap rating
      }
    }
    // verify the step list against the engine's action rules
    if (verify(ctx, n, counteract, start)) out.push({ ...n, value })
  }
  out.sort((a, b) => b.value - a.value)
  return out.length > 0 ? out : pool.slice(0, 1)
}

interface Start {
  ap: number
  performed: string[]
  weaponsUsed: string[]
}

/** Replay the plan's steps against the engine's action rules and path pricing; a plan that breaks one is dropped. */
function verify(ctx: AiCtx, n: Node, counteract: boolean, start: Start): boolean {
  try {
    const opId = n.op.id
    let cur = withOrder(ctx.view, opId, n.op.order)
    let op = cur.operatives[opId]!
    let performed = start.performed
    let ap = start.ap
    for (const s of n.steps) {
      const hyp: Activation = { operativeId: opId, seat: ctx.seat, counteract, stage: 'action', apSpent: ap, performed, declared: null, weaponsUsed: start.weaponsUsed }
      if (s.action.startsWith('ability:')) {
        ap += 1
        performed = [...performed, s.action.split(':').slice(0, 2).join(':')]
        continue
      }
      // a marker action option (`marker:place:<markerId>`) is performed as `marker:place`; the offer already checked it
      if (s.action.startsWith('marker:')) {
        ap += 1
        performed = [...performed, markerActionOf(s.action)]
        continue
      }
      if (actionAvailability(cur, op, s.action, hyp)) return false
      ap += actionCost(cur, op, s.action, hyp)
      performed = [...performed, s.action]
      if (s.wps) {
        const plan = s.fly ? planFly(cur, op, s.action as MoveKind, s.wps, counteract) : planMove(cur, op, s.action as MoveKind, s.wps, counteract)
        if (!plan.ok) return false
        cur = overlay(cur, opId, plan.end)
        op = cur.operatives[opId]!
      }
    }
    return true
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function stepIndex(plan: ActivationPlan, performed: string[]): number {
  return performed.length - plan.base
}

/** The action a marker option id names: `marker:place:<markerId>` is performed as `marker:place`. */
function markerActionOf(optionId: string): string {
  return optionId.split(':').slice(0, 2).join(':')
}

/** Does the activation so far follow the plan? (the actions performed match the plan's first steps) */
function onPlan(plan: ActivationPlan, performed: string[]): boolean {
  const idx = stepIndex(plan, performed)
  if (idx < 0 || idx > plan.steps.length) return false
  for (let i = 0; i < idx; i++) {
    const want = plan.steps[i]!.action
    const got = performed[plan.base + i]
    if (want.startsWith('ability:')) {
      if (!got || !got.startsWith('ability:')) return false
    } else if (want.startsWith('marker:')) {
      if (got !== markerActionOf(want)) return false
    } else if (got !== want) return false
  }
  return true
}

function activationKeyOf(ctx: AiCtx, opId: string): string {
  const a = ctx.view.firefight.activation
  return `${ctx.view.turningPoint}:${opId}:${a?.counteract ? 'c' : 'a'}`
}

function resetActivation(ctx: AiCtx, opId: string): void {
  const key = activationKeyOf(ctx, opId)
  if (ctx.memory.activationKey !== key) {
    ctx.memory.activationKey = key
    ctx.memory.banned = []
    ctx.memory.activationDecisions = 0
  }
}

/** Plan an operative under its allowed orders. Engage first; Conceal is only tried when Engage found nothing to attack. */
function bestOrderPlan(ctx: AiCtx, opId: string, share: number, o: PlanOpts = {}): ActivationPlan & { value: number } {
  const orders: ('engage' | 'conceal')[] = o.counteract ? [ctx.view.operatives[opId]!.order] : allowedOrders(ctx.view, ctx.view.operatives[opId]!)
  const cap0 = ctx.work.cap
  const start = ctx.work.n
  let best: (ActivationPlan & { value: number }) | null = null
  for (const [i, order] of orders.entries()) {
    ctx.work.cap = Math.min(cap0, start + (i === 0 && orders.length > 1 ? Math.ceil(share * 0.6) : share))
    const p = planOperative(ctx, opId, order, o)
    if (!best || p.value > best.value) best = p
    if (best.steps.some((s) => s.action === 'shoot' || s.action === 'fight' || s.action === 'charge')) break
  }
  ctx.work.cap = cap0
  return best!
}

/** firefight.activate: the ready operative whose best plan gains the most; a counteraction only when it is worth it. */
export function activate(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  let ready = [...((pending.context.ready as string[]) ?? [])]
  const counter = (pending.context.counteract as string[]) ?? []
  const opt = (id: string): Action | null => pending.options?.find((o) => o.id === id)?.action ?? null
  if (ready.length > 0) {
    // operatives out of the killzone (Wyrmblade HIDING) cannot be planned from a position: they emerge before the
    // end of turning point 2 (or they are lost), and otherwise wait until nothing else is ready
    const hidden = ready.filter((id) => view.operatives[id]?.status === 'reserve')
    // Tempestus Aquilons above land at once: an operative that lands gets to act this turning point, and the rules end the
    // wait (fewer than half above after turning point 1, none after turning point 2)
    const dropping = hidden.filter((id) => view.data.datacards[view.operatives[id]!.datacardId]?.keywords.includes('TEMPESTUS AQUILON'))
    if (dropping.length > 0) {
      const pick = dropping[0]!
      resetActivation(ctx, pick)
      ctx.memory.plan = null
      return opt(pick)
    }
    if (hidden.length > 0) {
      const onBoard = ready.filter((id) => !hidden.includes(id))
      if (onBoard.length === 0 || view.turningPoint >= 2) {
        const pick = hidden[0]!
        resetActivation(ctx, pick)
        ctx.memory.plan = null
        return opt(pick)
      }
      ready = onBoard
    }
    let ids = ready
    if (ready.length === 1) {
      const a = opt(ready[0]!)
      return a
    }
    // rank cheaply, then plan the leaders
    const quick = ready.map((id) => {
      const op = view.operatives[id]!
      const n: Node = { v: view, op, performed: [], weaponsUsed: [], ap: 0, steps: [], acc: 0, value: 0 }
      const engaged = enemiesInControlRange(view, op, op.seat).length > 0
      let s = 0
      if (spend(ctx)) {
        const best = engaged ? null : bestShot(shotsFrom(ctx, view, op, []))
        s = best ? best.score : 0
        if (engaged) {
          const f = bestFight(ctx, view, op, enemiesInControlRange(view, op, op.seat))
          s += f ? Math.max(0, f.est.value) + 1 : 1
        }
      }
      void n
      return { id, s: s + ctx.rand() * 0.01 }
    })
    quick.sort((a, b) => b.s - a.s)
    ids = quick.slice(0, ctx.params.plannedOps).map((q) => q.id)
    const plans: (ActivationPlan & { value: number })[] = []
    const budget = Math.max(6, Math.floor((ctx.work.cap - ctx.work.n) / ids.length))
    for (const id of ids) {
      if (plans.length > 0 && exhausted(ctx)) break
      plans.push(bestOrderPlan(ctx, id, budget))
    }
    plans.sort((a, b) => b.gain - a.gain)
    const k = Math.min(ctx.params.topK, plans.length)
    const pick = plans[k > 1 ? ctx.int(k) : 0]!
    ctx.memory.plan = pick
    resetActivation(ctx, pick.operativeId)
    return opt(pick.operativeId)
  }
  // only counteractions are on offer (and passing is allowed)
  let best: { id: string; plan: ActivationPlan & { value: number } } | null = null
  const budget = Math.max(6, Math.floor((ctx.work.cap - ctx.work.n) / Math.max(1, counter.length)))
  for (const id of counter) {
    if (best && exhausted(ctx)) break
    const plan = bestOrderPlan(ctx, id, budget, { counteract: true })
    if (!best || plan.gain > best.plan.gain) best = { id, plan }
  }
  if (best && best.plan.gain >= 0.7 && best.plan.steps.length > 0) {
    ctx.memory.plan = best.plan
    resetActivation(ctx, best.id)
    return opt(`counteract:${best.id}`)
  }
  return pending.canPass ? passAction(pending) : opt(`counteract:${counter[0]}`)
}

/** firefight.order: the order the plan was made for; plan both when no plan exists. */
export function order(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const opId = String(pending.context.operativeId)
  const opts = pending.options ?? []
  // a hiding operative has no position to plan from: Engage, so that emerging and attacking both stay open
  if (view.operatives[opId]?.status === 'reserve') {
    resetActivation(ctx, opId)
    return opts.find((o) => o.id === 'engage')?.action ?? opts[0]?.action ?? null
  }
  const plan = ctx.memory.plan
  let want: 'engage' | 'conceal' | null = null
  if (plan && plan.operativeId === opId && plan.turningPoint === view.turningPoint) want = plan.order
  if (!want) {
    const p = bestOrderPlan(ctx, opId, Math.max(10, ctx.work.cap - ctx.work.n))
    ctx.memory.plan = p
    want = p.order
  }
  resetActivation(ctx, opId)
  return opts.find((o) => o.id === want)?.action ?? opts[0]?.action ?? null
}

/** firefight.action: the next step of the plan, re-planning when the activation left it. */
export function action(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const opId = String(pending.context.operativeId)
  const a = view.firefight.activation
  const opts = pending.options ?? []
  const endOpt = opts.find((o) => o.id === 'end')?.action ?? null
  if (!a || a.operativeId !== opId) return null
  // a free-action frame (Remote Pilot, Interstitial Command) is part of its controller's activation: keep the controller's memory
  if (!a.frame) resetActivation(ctx, opId)
  const mem = ctx.memory
  // out of the killzone (HIDING): the only thing to do is the emerge action the engine offers
  if (view.operatives[opId]?.status === 'reserve') {
    const emerge = opts.find((o) => /^ability:/.test(o.id) && /emerge|\.land/i.test(o.id))
    return emerge?.action ?? endOpt
  }
  mem.activationDecisions++
  if (mem.activationDecisions > 24) return endOpt
  if (a.frame) {
    // a free action granted by a ploy or a rule (Remote Pilot, Support): take the best attack in it, else move on
    const self = view.operatives[opId]
    if (self && self.status === 'active') {
      const shoot = opts.find((o) => o.id === 'shoot')
      if (shoot && !a.performed.includes('shoot')) {
        const s = bestShot(shotsFrom(ctx, view, self, a.performed))
        if (s && s.score > 0.05) return shoot.action
      }
      const fightOpt = opts.find((o) => o.id === 'fight')
      if (fightOpt && !a.performed.includes('fight') && enemiesInControlRange(view, self, self.seat).length > 0) return fightOpt.action
    }
    return endOpt ?? opts[0]?.action ?? null
  }
  const performed = a.performed
  let plan = mem.plan
  const optionFor = (p: ActivationPlan): { step: PlanStep; option: Action } | null => {
    const step = p.steps[stepIndex(p, performed)]
    if (!step) return null
    if (mem.banned.includes(step.action)) return null
    const o = opts.find((x) => x.id === step.action)
    return o ? { step, option: o.action } : null
  }
  if (plan && plan.operativeId === opId && plan.turningPoint === view.turningPoint && onPlan(plan, performed)) {
    if (stepIndex(plan, performed) >= plan.steps.length) return endOpt
    const next = optionFor(plan)
    if (next) {
      // a unique action is taken at most once per activation, whether or not the engine counts it as performed
      if (next.step.action.startsWith('ability:')) mem.banned.push(next.step.action)
      return next.option
    }
  }
  // re-plan from here
  const op = view.operatives[opId]!
  const p = planOperative(ctx, opId, op.order, { counteract: a.counteract, performed, apSpent: a.apSpent, banned: mem.banned, weaponsUsed: a.weaponsUsed ?? [] })
  mem.plan = plan = p
  if (p.steps.length === 0) return endOpt
  const next = optionFor(p)
  if (next) {
    if (next.step.action.startsWith('ability:')) mem.banned.push(next.step.action)
    return next.option
  }
  return endOpt
}

/**
 * M9 batch B: an oval base (Hunter Clade arquebus Gunner) keeps its orientation while it moves and may turn at the end,
 * paying the arc from the move. Prefer the front (+Z, the long axis) toward the nearest enemy, else along the last leg of
 * the move. When the turn does not fit, the last leg may give up a whole inch or two for it, but only if the shorter end
 * point scores no worse; otherwise (or when the base already points within 15 degrees) the path is kept unturned.
 */
export function withEndFacing(ctx: AiCtx, view: GameState, pending: AiCtx['pending'], op: Operative, wps: Waypoint[], plain: Action): Action {
  if (!op.ovalHalfAxis || wps.length === 0) return plain
  const end = wps[wps.length - 1]!
  const from: Waypoint = wps.length > 1 ? wps[wps.length - 2]! : { x: op.pos.x, z: op.pos.z, y: op.pos.y }
  const near = enemiesOf(view, op)
    .filter((e) => e.pos)
    .sort((x, y) => Math.hypot(x.pos.x - end.x, x.pos.z - end.z) - Math.hypot(y.pos.x - end.x, y.pos.z - end.z))[0]
  const leg = Math.hypot(end.x - from.x, end.z - from.z)
  const wants: number[] = []
  if (near) wants.push(bearing(end, near.pos))
  if (leg > 0.25) wants.push(bearing(from, end))
  const flat = (end.y ?? op.pos.y) === (from.y ?? op.pos.y) && !end.jump
  const scoreAt = (w: Waypoint) => {
    const v2 = overlay(view, op.id, { x: w.x, y: w.y ?? op.pos.y, z: w.z })
    return endScore(ctx, v2, v2.operatives[op.id]!)
  }
  for (const f of wants) {
    const d = Math.abs(Math.atan2(Math.sin(f - op.facing), Math.cos(f - op.facing)))
    if (d < Math.PI / 12) return plain
    const facing = round3(f)
    const turned = act.pathFacing(pending, wps, facing)
    if (!validate(view, turned)) return turned
    if (!flat) continue
    const base = scoreAt(end)
    for (const cut of [1, 2]) {
      if (leg - cut < 0.5) break
      const t = (leg - cut) / leg
      const short: Waypoint = { ...end, x: round3(from.x + (end.x - from.x) * t), z: round3(from.z + (end.z - from.z) * t) }
      const path = [...wps.slice(0, -1), short]
      const trimmed = act.pathFacing(pending, path, facing)
      if (!validate(view, trimmed) && scoreAt(short) >= base - 1e-9) return trimmed
    }
  }
  return plain
}

/** move.path: the planned end point when still valid, else the best fresh end point, else any legal move. */
export function movePath(ctx: AiCtx): Action | null {
  const { pending, view } = ctx
  const c = pending.constraints
  if (!c?.operativeId) return null
  const op = view.operatives[c.operativeId]!
  const a = view.firefight.activation
  const kind = (c.kind === 'deploy' ? 'reposition' : c.kind) as MoveKind
  const mem = ctx.memory
  const plan = mem.plan
  if (plan && plan.operativeId === op.id && a && onPlan(plan, a.performed)) {
    const step = plan.steps[stepIndex(plan, a.performed)]
    if (step?.wps && step.action === kind) {
      const act1 = step.fly ? act.fly(pending, step.wps[0]!) : act.path(pending, step.wps)
      if (!validate(view, act1)) return step.fly ? act1 : withEndFacing(ctx, view, pending, op, step.wps, act1)
    }
  }
  // fresh: rate every end point with the full evaluation
  const counteract = a?.counteract === true
  let targets: Operative[] = []
  if (kind === 'charge') {
    const reach = moveLimit(op, 'charge', counteract, view) + 1.5
    targets = enemiesOf(view, op).filter((e) => distanceBetween(bodyOf(op), bodyOf(e)) <= reach)
    const hint = plan?.steps.find((s) => s.action === 'charge')?.targetId
    if (hint) targets = targets.sort((x, y) => (x.id === hint ? -1 : y.id === hint ? 1 : 0))
    targets = targets.slice(0, 4)
  }
  const eps = endpointsFor(ctx, view, op, kind, counteract, targets, Math.max(8, ctx.params.endpoints))
  let best: { e: Endpoint; v: number } | null = null
  for (const e of eps) {
    const v2 = overlay(view, op.id, e.end)
    const ghost = v2.operatives[op.id]!
    let val = endScore(ctx, v2, ghost)
    if (kind === 'charge') {
      const near = enemiesInControlRange(v2, ghost, ghost.seat)
      const f = near.length ? bestFight(ctx, v2, ghost, near) : null
      val += f ? f.est.value : -5
    } else {
      const s = bestShot(shotsFrom(ctx, v2, ghost, a?.performed ?? []))
      if (s) val += s.score
    }
    if (!best || val > best.v) best = { e, v: val }
    if (!spend(ctx)) break
  }
  if (best) {
    const act1 = best.e.fly ? act.fly(pending, best.e.wps[0]!) : act.path(pending, best.e.wps)
    if (!validate(view, act1)) return best.e.fly ? act1 : withEndFacing(ctx, view, pending, op, best.e.wps, act1)
  }
  const r = randomMove(ctx)
  if (r.type === 'pass' && a) mem.banned.push(a.declared?.action ?? kind)
  return r
}

export { seatOps }
