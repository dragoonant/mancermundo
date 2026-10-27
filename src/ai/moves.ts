// The activation planner (docs/spec/40-ai.md section 2): who activates, who joins a group, which action comes next, where a
// move goes. Every decision is scored the same way: what the action does now (damage dealt, a door opened, a casket cracked)
// plus how the fighter's position is worth afterwards (exposure to the threat map, cover, nerve support, progress toward its
// goals), minus the same position value before. "End the activation" is worth exactly 0, so an action is taken only when it
// leaves the gang better off than doing nothing (the zero-action audit in tools/ai-bench.ts guards the other direction).
import { act, query, suggest, validate, type Action, type DecisionOption, type Fighter, type GameState, type PendingDecision, type Vec2 } from '@/engine'
import { baseGap } from '@/engine/measure'
import { sees } from './sight'
import { halfMove, moveAllowance, planMove, shortestLegalPath, truncatePath } from '@/engine/movement'
import { ductFireChoices } from '@/engine/zm'
import { constants, enemiesOf, friendsOf, getFighter, isBroken, readyFighters } from '@/engine/state'
import { hitChanceFor } from '@/engine/dice'
import { round3 } from '@/engine/geometry'
import { fighterValue, overlay, outcomeValue, shotOutcome, hitChain } from './eval'
import { approachCost, goalsFor, homePoint, leansMelee, needsHauling, supportAt, type Goal } from './goals'
import { fieldFrom, reachablePoints, sampleField } from './field'
import { consolidateInches, reachChance } from '@/engine/fight'
import { groupSize } from '@/engine/activation'
import { somersaultProblem } from '@/engine/skills/somersault'
import { bestShot, type ShotPlan } from './shots'
import { headbuttScore, hurlScore, overseerScore, stanceScore, unleashScore } from './skills'
import { exposure } from './threat'
import { spend, tracing, type AiCtx, type Intent } from './tiers'

const centre = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })
const bearing = (a: Vec2, b: Vec2): number => Math.atan2(b.x - a.x, b.z - a.z)

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Rounds since anything went down: the stall breaker raises the pressure to close in. */
function quietRounds(ctx: AiCtx): number {
  const s = ctx.view
  const n = s.casualties.length
  const m = ctx.memory
  if (n !== m.casualtiesSeen) {
    m.casualtiesSeen = n
    m.lastCasualtyRound = s.round
  }
  return Math.max(0, s.round - m.lastCasualtyRound)
}

function aggression(ctx: AiCtx): number {
  return 1 + ctx.w.patience * Math.max(0, quietRounds(ctx) - 1) * 8
}

/** How good the fighter's footing is at a spot: exposure, nerve support, progress toward its goals. Higher is better. */
export function positionValue(ctx: AiCtx, state: GameState, f: Fighter, at: Vec2, posture: Fighter['posture'], facing: number, goals: Goal[]): number {
  const aggr = aggression(ctx)
  const exp = exposure(ctx, state, f, at, posture, facing)
  let v = -ctx.w.threat * ctx.params.threatScale * exp.loss * (posture === 'standing' ? 1 / Math.sqrt(aggr) : 1)
  v += ctx.w.cohesion * supportAt(state, f, at)
  if (posture === 'seriouslyInjured') v += recoveryHelp(state, f, at)
  const approach = approachCost(state, f, goals, at)
  v -= ctx.w.approach * aggr * approach * ((ctx.cache.get(`damp:${f.id}`) as number | undefined) ?? 1)
  return v
}

/** A Seriously Injured fighter next to a standing friend can be helped up in the End phase (R-13.6): worth crawling to. */
function recoveryHelp(state: GameState, f: Fighter, at: Vec2): number {
  let best = 0
  for (const g of friendsOf(state, f)) {
    if (g.posture !== 'standing' || isBroken(g)) continue
    const gap = Math.hypot(g.pos.x - at.x, g.pos.z - at.z) - g.baseRadius - f.baseRadius
    best = Math.max(best, gap <= 1 ? 0.5 : gap <= 3 ? 0.15 : 0)
  }
  return best
}

/** Which enemy a fighter at `at` would face: the nearest one it has a line of sight to, else the way to its first goal. */
function faceFrom(ctx: AiCtx, state: GameState, f: Fighter, at: Vec2, goals: Goal[]): number {
  let best: Fighter | null = null
  let bestD = Infinity
  for (const e of enemiesOf(state, f)) {
    if (e.posture === 'seriouslyInjured') continue
    const d = Math.hypot(e.pos.x - at.x, e.pos.z - at.z)
    if (d < bestD && d < 28 && sees(ctx, state, at, e)) {
      best = e
      bestD = d
    }
  }
  if (best) return bearing(at, centre(best))
  const g = goals[0]
  return g ? bearing(at, g.pos) : f.facing
}

/** Up to two enemies in sight from a spot, nearest first (the facings worth trying for a shot). */
function sightedFrom(ctx: AiCtx, state: GameState, f: Fighter, at: Vec2, n = 2): Fighter[] {
  const seen: { e: Fighter; d: number }[] = []
  for (const e of enemiesOf(state, f)) {
    if (e.posture === 'seriouslyInjured' && enemiesOf(state, f).some((o) => o.posture !== 'seriouslyInjured')) continue
    const d = Math.hypot(e.pos.x - at.x, e.pos.z - at.z)
    if (d <= 28 && sees(ctx, state, at, e)) seen.push({ e, d })
  }
  return seen.sort((a, b) => a.d - b.d).slice(0, n).map((s) => s.e)
}

interface ShotAt {
  plan: ShotPlan
  facing: number
}

/** The best shot from a spot with the fighter free to face any of the nearest enemies it sees there. */
function shotFrom(ctx: AiCtx, state: GameState, f: Fighter, at: Vec2, posture: Fighter['posture'], left: number, aimed: boolean, fixedFacing: number | null): ShotAt | null {
  const facings: number[] = fixedFacing !== null ? [fixedFacing] : sightedFrom(ctx, state, f, at).map((e) => bearing(at, centre(e)))
  let best: ShotAt | null = null
  for (const facing of facings) {
    const ov = overlay(state, f.id, { pos: at, facing, posture, free: true })
    const plan = bestShot(ctx, ov, ov.fighters[f.id]!, { aimed, mode: 'shoot', actionsLeft: left })
    if (plan && (!best || plan.value > best.plan.value)) best = { plan, facing }
  }
  return best
}

// ---------------------------------------------------------------------------
// Spots to move to
// ---------------------------------------------------------------------------

export interface Spot {
  pos: Vec2
  path: Vec2[]
  length: number
}

type MoveKind = 'move' | 'takeCover' | 'crawl'

function pathTo(state: GameState, f: Fighter, to: Vec2, kind: MoveKind, maxInches: number, straightOnly = false): Spot | null {
  const opts = { maxInches, oneInch: 'enemy' as const, allowEmpty: kind === 'takeCover' }
  const straight = planMove(state, f, [to], opts)
  if (straight.ok) return { pos: straight.end, path: straight.path.slice(1), length: straight.length }
  if (straightOnly) return null
  const route = shortestLegalPath(state, f, to, true, maxInches + 2)
  if (!route || route.length === 0) {
      return null
  }
  // the whole route first (it ends exactly on the spot); cut to the allowance only when it is longer
  const whole = planMove(state, f, route, opts)
  if (whole.ok) return { pos: whole.end, path: whole.path.slice(1), length: whole.length }
  const cut = truncatePath(centre(f), route, maxInches)
  if (cut.length === 0) return null
  const plan = planMove(state, f, cut, opts)
  return plan.ok ? { pos: plan.end, path: plan.path.slice(1), length: plan.length } : null
}

/**
 * Candidate end spots for a move of `maxInches`: the lattice points the fighter can walk to (a half-inch lattice for the
 * progress ranking, an inch lattice for the safety ranking), the best few of each kept, each turned into a path the engine's
 * own planner accepts. Spots on obstacles, on other bases or within an inch of an enemy never reach the planner.
 */
export function candidateSpots(ctx: AiCtx, state: GameState, f: Fighter, kind: MoveKind, maxInches: number, goals: Goal[], count: number): Spot[] {
  const key = `spots:${f.id}:${kind}:${count}`
  const hit = ctx.cache.get(key) as Spot[] | undefined
  if (hit) return hit
  const out: Spot[] = []
  const seen = new Set<string>()
  const add = (s: Spot | null) => {
    if (!s) return
    const k = `${Math.round(s.pos.x * 2)},${Math.round(s.pos.z * 2)}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(s)
  }
  if (kind === 'takeCover') add({ pos: centre(f), path: [], length: 0 })
  const field = fieldFrom(state, centre(f), f.baseRadius, false)
  const reach = maxInches + 0.5
  const enemies = enemiesOf(state, f).filter((e) => e.posture !== 'seriouslyInjured')
  const others = Object.values(state.fighters).filter((g) => g.id !== f.id && g.location === 'board')
  const clear = (q: { p: Vec2; d: number }): boolean =>
    q.d >= 0.45 &&
    others.every((g) => Math.hypot(g.pos.x - q.p.x, g.pos.z - q.p.z) >= g.baseRadius + f.baseRadius + 0.02) &&
    enemies.every((e) => Math.hypot(e.pos.x - q.p.x, e.pos.z - q.p.z) - e.baseRadius - f.baseRadius > 1.02)
  const fine = reachablePoints(field, reach, 1).filter(clear)
  const near3 = enemies
    .slice()
    .sort((a, b) => baseGap(a, f) - baseGap(b, f))
    .slice(0, 3)
  const byApproach = fine
    .map((q) => ({ ...q, app: approachCost(state, f, goals, q.p) }))
    .sort((a, b) => a.app - b.app || a.d - b.d)
  const coarse = fine
    .filter((q) => Math.abs(Math.round(q.p.x) - q.p.x) < 1e-6 && Math.abs(Math.round(q.p.z) - q.p.z) < 1e-6)
    .map((q) => {
      let seenBy = 0
      for (const e of near3) if (sees(ctx, state, q.p, e)) seenBy++
      return { ...q, app: approachCost(state, f, goals, q.p), seenBy }
    })
  const bySafety = coarse.slice().sort((a, b) => a.seenBy - b.seenBy || a.app - b.app)
  const picks: { p: Vec2 }[] = []
  const taken: Vec2[] = []
  const take = (list: { p: Vec2 }[], n: number, spacing: number) => {
    let c = 0
    for (const q of list) {
      if (c >= n) break
      if (taken.some((t) => Math.hypot(t.x - q.p.x, t.z - q.p.z) < spacing)) continue
      taken.push(q.p)
      picks.push(q)
      c++
    }
  }
  take(byApproach, Math.ceil(count * 0.55), 0.9)
  take(bySafety, count, 0.9)
  // straight lines first (cheap); the engine's route finder only for the few picks a wall hides
  const hidden: { p: Vec2 }[] = []
  for (const q of picks.slice(0, count)) {
    if (!spend(ctx, 0.1)) break
    const s = pathTo(state, f, q.p, kind, maxInches, true)
    if (s) add(s)
    else hidden.push(q)
  }
  for (const q of hidden.slice(0, 5)) {
    if (!spend(ctx, 1.5)) break
    add(pathTo(state, f, q.p, kind, maxInches))
  }
  if (tracing()) console.log(`   [cand] ${f.id} ${kind} fine=${fine.length} coarse=${coarse.length} picks=${picks.length} out=${out.length}`)
  ctx.cache.set(key, out)
  return out
}

interface SpotScore {
  spot: Spot
  score: number
  /** the position value change alone (no shot from the spot counted) */
  pos: number
  facing: number
  shot: ShotPlan | null
}

/**
 * Score every candidate spot of a move. `left` is the actions the fighter has before this one. The score is relative to staying
 * put: position value at the spot minus position value now, plus the shot the spot opens when an action is left to take it.
 */
export function scoreSpots(ctx: AiCtx, state: GameState, f: Fighter, kind: MoveKind, maxInches: number, goals: Goal[], left: number): SpotScore[] {
  const posture: Fighter['posture'] = kind === 'takeCover' ? 'pinned' : f.posture
  const base = positionValue(ctx, state, f, centre(f), f.posture, f.facing, goals)
  const spots = candidateSpots(ctx, state, f, kind, maxInches, goals, ctx.params.spots)
  const out: SpotScore[] = []
  for (const spot of spots) {
    if (!spend(ctx, 1)) break
    const stay = spot.path.length === 0
    const facing = kind === 'move' ? faceFrom(ctx, state, f, spot.pos, goals) : f.facing
    let score = positionValue(ctx, state, f, spot.pos, posture, facing, goals) - base
    const posScore = score
    let shot: ShotPlan | null = null
    let face = facing
    if (kind === 'move') {
      const after = left - 1
      const sh = shotFrom(ctx, state, f, spot.pos, 'standing', Math.max(1, after), false, null)
      if (sh) {
        face = sh.facing
        shot = sh.plan
        if (after >= 1 && ctx.params.lookahead && sh.plan.cost === 'basic') score += 0.85 * sh.plan.value // the second action is less sure than a shot taken now
        else score += ctx.w.potential * Math.max(0, sh.plan.value)
      }
    } else if (kind === 'takeCover') {
      score -= ctx.w.prone
      if (stay) score -= 0.05
    }
    // a move that only undoes the last one (or the first move of this activation) is dithering
    const trail = ctx.memory.trail[f.id]
    let undo = 0
    if (kind === 'move' && trail && trail.some((t) => Math.hypot(t.x - spot.pos.x, t.z - spot.pos.z) < 1.1)) undo = 0.2
    const start = ctx.memory.intent?.startPos
    if (kind === 'move' && left < 2 && start && Math.hypot(start.x - spot.pos.x, start.z - spot.pos.z) < 1.4) undo = 0.6
    score -= undo
    out.push({ spot, score, pos: posScore - undo, facing: face, shot })
  }
  return out
}

interface SomersaultSpot {
  pos: Vec2
  score: number
  facing: number
}

/**
 * Somersault places a fighter at a spot in sight within `max` that is more than 1" from every enemy: it needs no route, so even a
 * fighter hemmed in by a fight has spots. Three rings of sixteen spots round the fighter, kept when the engine accepts them,
 * scored like a Move's spots (position value gained, plus the shot the spot opens).
 */
function somersaultSpots(ctx: AiCtx, state: GameState, f: Fighter, max: number, goals: Goal[], left: number): SomersaultSpot[] {
  const key = `somer:${f.id}:${max}:${left}`
  const hit = ctx.cache.get(key) as SomersaultSpot[] | undefined
  if (hit) return hit
  const base = positionValue(ctx, state, f, centre(f), f.posture, f.facing, goals)
  const out: SomersaultSpot[] = []
  for (const r of [max * 0.4, max * 0.7, max]) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8
      const pos = { x: round3(f.pos.x + Math.sin(a) * r), z: round3(f.pos.z + Math.cos(a) * r) }
      if (somersaultProblem(state, f, pos, max)) continue
      if (!spend(ctx, 1)) break
      const facing = faceFrom(ctx, state, f, pos, goals)
      let score = positionValue(ctx, state, f, pos, 'standing', facing, goals) - base
      const sh = shotFrom(ctx, state, f, pos, 'standing', Math.max(1, left - 1), false, null)
      let face = facing
      if (sh) {
        face = sh.facing
        if (left - 1 >= 1 && ctx.params.lookahead && sh.plan.cost === 'basic') score += 0.85 * sh.plan.value
        else score += ctx.w.potential * Math.max(0, sh.plan.value)
      }
      out.push({ pos, score, facing: face })
    }
  }
  out.sort((a, b) => b.score - a.score)
  ctx.cache.set(key, out)
  return out
}

// ---------------------------------------------------------------------------
// Action scores
// ---------------------------------------------------------------------------

interface Scored {
  id: string
  option: DecisionOption
  score: number
  note?: string
  dest?: Intent['dest']
}

function groupBy(options: DecisionOption[]): Map<string, DecisionOption[]> {
  const m = new Map<string, DecisionOption[]>()
  for (const o of options) {
    if (o.action.type !== 'action.choose') continue
    const k = o.action.payload.action
    const l = m.get(k)
    if (l) l.push(o)
    else m.set(k, [o])
  }
  return m
}

/** The value of what a Fight (or the free Fight of a Charge) does and risks, from the engine's fight odds. */
function meleeValue(ctx: AiCtx, state: GameState, f: Fighter, targetIds: string[], charge: boolean): { dealt: number; taken: number } {
  const fo = query.fightOutcome(state, f.id, undefined, targetIds, { charge })
  let dealt = 0
  let downed = 0
  for (const t of fo.targets) {
    const tf = getFighter(state, t.targetId)
    dealt += ctx.w.dmg * fighterValue(state, tf) * (t.pOutOfAction + 0.65 * t.pSeriouslyInjured + 0.1 * Math.min(1, t.expectedWounds / Math.max(1, tf.wounds)))
    downed += (t.pOutOfAction + t.pSeriouslyInjured) / Math.max(1, fo.targets.length)
  }
  // every enemy still standing strikes back (reaction attacks), or fights on in its own activation
  let taken = 0
  const v = fighterValue(state, f)
  const enemyIds = charge ? targetIds : f.engagedWith
  for (const id of enemyIds) {
    const e = getFighter(state, id)
    if (e.posture === 'seriouslyInjured' || isBroken(e)) continue
    const rr = query.fightOutcome(state, e.id, undefined, [f.id], {}).targets[0]
    if (rr) taken += v * (rr.pOutOfAction + 0.65 * rr.pSeriouslyInjured) * (1 - Math.min(1, downed))
  }
  return { dealt, taken }
}

function chargeScore(ctx: AiCtx, state: GameState, f: Fighter, o: DecisionOption): number {
  const p = o.action.type === 'action.choose' ? o.action.payload : null
  if (!p?.targetId) return -1
  const t = getFighter(state, p.targetId)
  const pReach = Number((o.data as { pReach?: number } | undefined)?.pReach ?? 0)
  const { dealt } = meleeValue(ctx, state, f, [t.id], true)
  // standing next to the target afterwards: its friends and its own blows are in the exposure of the contact spot
  const dx = f.pos.x - t.pos.x
  const dz = f.pos.z - t.pos.z
  const d = Math.hypot(dx, dz) || 1
  const gap = f.baseRadius + t.baseRadius + 0.03
  const contact = { x: t.pos.x + (dx / d) * gap, z: t.pos.z + (dz / d) * gap }
  const here = exposure(ctx, state, f, centre(f), f.posture).loss
  const there = exposure(ctx, state, f, contact, 'standing').loss
  const risk = ctx.w.threat * ctx.params.threatScale * Math.max(0, there - here)
  return pReach * (dealt - risk) - (1 - pReach) * 0.15
}

/** The follow-up value of taking cover after the action (a shot) that cost the first of two actions. */
function coverGain(ctx: AiCtx, state: GameState, f: Fighter, goals: Goal[]): number {
  if (f.posture !== 'standing' || f.engagedWith.length > 0) return 0
  const half = halfMove(state, f)
  const base = exposure(ctx, state, f, centre(f), 'standing').loss
  if (base < 0.05) return 0
  let best = 0
  for (const s of candidateSpots(ctx, state, f, 'takeCover', half, goals, Math.max(4, Math.floor(ctx.params.spots / 3)))) {
    if (!spend(ctx, 1)) break
    const e = exposure(ctx, state, f, s.pos, 'pinned').loss
    best = Math.max(best, ctx.w.threat * ctx.params.threatScale * (base - e) - ctx.w.prone)
  }
  return best
}

/**
 * A gunner with a shot on offer should shoot, not march: the pull toward the goal is damped while the fighter has a shot now
 * (brawlers keep the full pull; their blows come from charging). Set once per decision.
 */
function setDamp(ctx: AiCtx, state: GameState, f: Fighter, left: number): void {
  let damp = 1
  if (f.posture === 'standing' && f.engagedWith.length === 0 && !leansMelee(state, f)) {
    const sh = bestShot(ctx, state, f, { aimed: false, mode: 'shoot', actionsLeft: Math.max(1, left) })
    if (sh && sh.value > 0.05) damp = 0.25
  }
  ctx.cache.set(`damp:${f.id}`, damp)
}

interface FighterSnapshot {
  f: Fighter
  goals: Goal[]
  left: number
}

function snapshot(ctx: AiCtx, state: GameState, f: Fighter, left: number): FighterSnapshot {
  setDamp(ctx, state, f, left)
  return { f, goals: goalsFor(ctx, state, f), left }
}

/** Every scored first action of the activation in progress. */
function scoreChoices(ctx: AiCtx, state: GameState, snap: FighterSnapshot, options: DecisionOption[], banned: string[]): Scored[] {
  const { f, goals, left } = snap
  const groups = groupBy(options)
  const out: Scored[] = []
  const push = (option: DecisionOption, score: number, note?: string, dest?: Intent['dest']) => {
    if (banned.includes(option.id)) return
    out.push({ id: option.id, option, score, ...(note ? { note } : {}), ...(dest ? { dest } : {}) })
  }
  const first = (k: string): DecisionOption | undefined => groups.get(k)?.[0]
  const end = first('end')
  if (end) push(end, 0, 'end')

  // ---- shoot / aim
  const shootOpt = first('shoot')
  const aimOpt = first('aim')
  let shootScore = -Infinity
  if (shootOpt) {
    const sh = bestShot(ctx, state, f, { aimed: state.action.activation?.aimed ?? false, mode: 'shoot', actionsLeft: left })
    if (tracing() && sh) console.log(`   [shot] ${f.id} ${sh.weaponId}/${sh.profileId} ${sh.kind} ${sh.targetId ?? ''} chance=${sh.chance.toFixed(2)} value=${sh.value.toFixed(2)}`)
    if (sh) {
      shootScore = sh.value
      // a spare action after the shot: take cover when that pays
      if (left >= 2 && sh.cost === 'basic' && ctx.params.lookahead) {
        // a spare action after the shot: take cover, or slip away to safer ground, when that pays
        const away = Math.max(0, ...scoreSpots(ctx, state, f, 'move', moveAllowance(state, f), goals, 1).map((x) => x.pos)) * 0.8
        shootScore += 0.03 + Math.max(0, coverGain(ctx, state, f, goals) * 0.8, away)
      }
      push(shootOpt, shootScore, 'shoot')
    }
  }
  if (aimOpt && left >= 2) {
    const sh = bestShot(ctx, state, f, { aimed: true, mode: 'shoot', actionsLeft: 1 })
    if (sh && sh.cost === 'basic') push(aimOpt, sh.value - 0.03, 'aim')
  }
  // ---- blind fire from the floor
  const blind = first('blindFire')
  if (blind) {
    const sh = bestShot(ctx, state, f, { aimed: false, mode: 'blindFire', actionsLeft: left })
    if (sh) push(blind, sh.value * 0.95, 'blindFire')
  }
  // ---- fight, retreat, coup de grace (melee statuses)
  const fightOpts = groups.get('fight')
  if (fightOpts) {
    for (const o of fightOpts) {
      const engaged = f.engagedWith.length > 0
      const targets = engaged ? f.engagedWith : []
      if (engaged) {
        const m = meleeValue(ctx, state, f, targets, false)
        // an Engaged fighter can do nothing else useful (no Move, no Shoot): fighting wins ties
        push(o, m.dealt - ctx.w.threat * m.taken * 0.5 + 0.1, 'fight')
      } else {
        // a Versatile weapon reaches an enemy that is not in base contact
        push(o, 0.3, 'fight')
      }
    }
  }
  const retreat = first('retreat')
  if (retreat && f.engagedWith.length > 0) {
    const m = meleeValue(ctx, state, f, f.engagedWith, false)
    const pPass = Number((retreat.data as { chance?: number } | undefined)?.chance ?? 0.5)
    const stayLoss = ctx.w.threat * m.taken * 2
    const goLoss = ctx.w.threat * m.taken * (0.55 + 0.35 * pPass) * 0.9
    // stand and fight unless it is clearly lost: retreat saves the next round of blows only when the fight is going badly
    push(retreat, stayLoss - goLoss - 0.45 - ctx.w.dmg * m.dealt * 0.4 - (1 - pPass) * 0.2, 'retreat')
  }
  for (const o of groups.get('coupDeGrace') ?? []) {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    if (!p?.targetId) continue
    const t = getFighter(state, p.targetId)
    push(o, 0.85 * fighterValue(state, t) * 2.1 + 0.3, 'coupDeGrace')
  }
  for (const o of groups.get('charge') ?? []) push(o, chargeScore(ctx, state, f, o), 'charge')
  const run = first('runForCover')
  if (run) push(run, 5, 'runForCover')

  // ---- skill actions: Headbutt (free), Hurl, Overseer, Immovable Stance, Unleash the Beast, Somersault (S4K-B)
  const targetOf = (o: DecisionOption): Fighter | null => {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    return p?.targetId ? getFighter(state, p.targetId) : null
  }
  for (const o of groups.get('headbutt') ?? []) {
    const t = targetOf(o)
    if (t) push(o, headbuttScore(ctx, state, f, t), 'headbutt')
  }
  for (const o of groups.get('hurl') ?? []) {
    const t = targetOf(o)
    if (t) push(o, hurlScore(ctx, state, f, t), 'hurl')
  }
  for (const o of groups.get('overseer') ?? []) {
    const t = targetOf(o)
    if (!t) continue
    const chance = Number((o.data as { chance?: number } | undefined)?.chance ?? 0.5)
    push(o, overseerScore(ctx, chance, activationValue(ctx, state, t), activationValue(ctx, state, f)), 'overseer')
  }
  const stance = first('immovableStance')
  if (stance) push(stance, stanceScore(ctx, state, f), 'stance')
  const unleash = first('unleashTheBeast')
  if (unleash) push(unleash, unleashScore(ctx, state, f), 'unleash')
  const somersault = first('somersault')
  if (somersault) {
    // a placement within reach that the engine accepts: the best spot a Move could reach, ranked the same way; out of a fight it needs no Initiative test and draws no reaction attacks
    const max = Number((somersault.data as { maxInches?: number } | undefined)?.maxInches ?? 6)
    const top = somersaultSpots(ctx, state, f, max, goals, left)[0]
    if (top) push(somersault, f.engagedWith.length > 0 ? top.score + 0.1 : top.score * 0.95 - 0.03, 'somersault', { path: [top.pos], facing: top.facing, kind: 'somersault' })
  }

  // ---- stand up
  const stand = first('standUp')
  if (stand && !state.action.activation?.performed.some((x) => x.action === 'takeCover')) {
    const here = centre(f)
    const facing = faceFrom(ctx, state, f, here, goals)
    const sh = left >= 2 ? shotFrom(ctx, state, f, here, 'standing', 1, false, null) : null
    const up = positionValue(ctx, state, f, here, 'standing', facing, goals)
    const down = positionValue(ctx, state, f, here, f.posture, f.facing, goals)
    let s = up - down + 0.35 + (sh && sh.plan.cost === 'basic' ? sh.plan.value : 0)
    if (left >= 2) s += 0.1 * ctx.w.potential
    push(stand, s, 'standUp')
  }

  // ---- moves
  const move = first('move')
  if (move) {
    const max = Number((move.data as { maxInches?: number } | undefined)?.maxInches ?? moveAllowance(state, f))
    const scored = scoreSpots(ctx, state, f, 'move', max, goals, left)
    scored.sort((a, b) => b.score - a.score)
    const top = scored[0]
    if (tracing()) console.log(`   [spots] ${scored.slice(0, 4).map((x) => `${x.spot.pos.x.toFixed(1)},${x.spot.pos.z.toFixed(1)}=${x.score.toFixed(2)}${x.shot ? `{${x.shot.weaponId.split('.').pop()} ${x.shot.targetId ?? x.shot.kind} ${x.shot.value.toFixed(2)} face=${x.facing.toFixed(2)}}` : ''}`).join(' ')} of ${scored.length}`)
    if (top) push(move, top.score, 'move', { path: top.spot.path, facing: top.facing, kind: 'move' })
    ctx.cache.set('moveScored', scored)
  }
  const cover = first('takeCover')
  if (cover) {
    const max = Number((cover.data as { maxInches?: number } | undefined)?.maxInches ?? halfMove(state, f))
    const scored = scoreSpots(ctx, state, f, 'takeCover', max, goals, left)
    scored.sort((a, b) => b.score - a.score)
    const top = scored[0]
    if (top) push(cover, top.score, 'takeCover', { path: top.spot.path, facing: f.facing, kind: 'takeCover' })
  }
  const crawl = first('crawl')
  if (crawl) {
    const max = Number((crawl.data as { maxInches?: number } | undefined)?.maxInches ?? halfMove(state, f))
    const scored = scoreSpots(ctx, state, f, 'crawl', max, goals, left)
    scored.sort((a, b) => b.score - a.score)
    const top = scored[0]
    if (top && top.spot.path.length > 0) push(crawl, top.score, 'crawl', { path: top.spot.path, facing: f.facing, kind: 'crawl' })
  }

  // ---- reload
  for (const o of groups.get('reload') ?? []) {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    const chance = Number((o.data as { chance?: number } | undefined)?.chance ?? 0.5)
    // worth a good shot next time; a fighter with nothing else to shoot with values it more
    const working = f.weapons.some((w) => w.ammo === 'ok' && state.data.weapons[w.weaponId]?.profiles.some((q) => q.range.long !== 'E'))
    push(o, chance * (working ? 0.28 : 0.6) - 0.02, `reload ${p?.weaponId ?? ''}`)
  }

  // ---- doors, terminals
  const doorGoalIds = new Set(goals.filter((g) => g.kind === 'door').map((g) => g.doorId))
  for (const o of groups.get('operateDoor') ?? []) {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    const to = (o.data as { to?: string } | undefined)?.to
    const wanted = !!p?.doorId && doorGoalIds.has(p.doorId) && to !== 'closed'
    push(o, wanted ? 0.8 : -0.25, 'door')
  }
  for (const o of groups.get('forceDoor') ?? []) {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    const chance = Number((o.data as { chance?: number } | undefined)?.chance ?? 0.3)
    push(o, p?.doorId && doorGoalIds.has(p.doorId) ? 0.75 * chance : -0.25, 'force')
  }
  for (const o of groups.get('accessTerminal') ?? []) {
    const d = o.data as { chance?: number; doorId?: string } | undefined
    push(o, d?.doorId && doorGoalIds.has(d.doorId) ? 0.8 * Number(d.chance ?? 0.3) : -0.25, 'terminal')
  }

  // ---- ductways
  for (const o of groups.get('fireDuct') ?? []) {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    const duct = ductFireChoices(state, f).find((d) => d.ductId === p?.ductId)
    if (!duct) continue
    let best = 0
    for (const id of duct.targets) {
      const t = getFighter(state, id)
      const uses = f.weapons.map((w) => ({ w, def: state.data.weapons[w.weaponId] })).filter((x) => x.def && x.w.ammo === 'ok')
      for (const u of uses) {
        const prof = u.def!.profiles.find((q) => q.range.long !== 'E')
        if (!prof) continue
        const need = Number(constants(state).hitModifiers.ductway) || 5
        const v = outcomeValue(ctx.w, state, t, shotOutcome(hitChain(ctx, state, f, u.w.weaponId, prof, t), hitChanceFor(need, f.stats.BS), t))
        best = Math.max(best, v)
      }
    }
    push(o, best * 0.9, 'fireDuct')
  }

  // ---- caskets (scenario objectives)
  const sid = state.scenario.id
  const attacker = state.players[f.seat].role === 'attacker'
  for (const k of ['smashCasket', 'bypassCasket'] as const) {
    for (const o of groups.get(k) ?? []) {
      const chance = Number((o.data as { chance?: number } | undefined)?.chance ?? 0.4)
      // Smash & Grab's attackers win by cracking caskets; in Forgotten Riches a closed casket counts as loot as it is, so opening one is a gamble
      const worth = sid === 'scn.smash-and-grab' ? (attacker ? 3 : 0) : 0
      // elsewhere it is a gamble (an ammo cache is no loot, a frag trap hurts) that must not pass for a filler action
      push(o, worth > 0 ? worth * chance - 0.02 : -0.6, k)
    }
  }
  for (const o of groups.get('carryCasket') ?? []) {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    push(o, p?.casketId && needsHauling(ctx, state, f.seat, p.casketId) && homePoint(ctx, state, f.seat, centre(f)) ? 0.9 : 0, 'carryCasket')
  }
  // doing something beats doing nothing by `act` (more as the stalemate drags on), whatever the something is
  const bonus = ctx.w.act * aggression(ctx)
  for (const sc of out) if (sc.note !== 'end' && sc.note !== 'takeCover') sc.score += bonus
  return out
}

/** The best 2" Consolidate for a fighter that has just won a fight (null: no legal spot). */
export function consolidateSpot(ctx: AiCtx, state: GameState, f: Fighter): SpotScore | null {
  const goals = goalsFor(ctx, state, f)
  const scored = scoreSpots(ctx, state, f, 'move', consolidateInches(state, f), goals, 1).sort((a, b) => b.score - a.score)
  return scored.find((s) => s.spot.path.length > 0) ?? null
}

// ---------------------------------------------------------------------------
// Turn first: a free change of facing that opens a shot
// ---------------------------------------------------------------------------

function turnChoice(ctx: AiCtx, state: GameState, f: Fighter, options: DecisionOption[], current: number): DecisionOption | null {
  const turns = options.filter((o) => o.action.type === 'action.choose' && o.action.payload.action === 'turn')
  if (turns.length === 0) return null
  let best: { o: DecisionOption; v: number } | null = null
  const left = state.action.activation?.actionsLeft ?? 2
  for (const o of turns) {
    const p = o.action.type === 'action.choose' ? o.action.payload : null
    if (!p || p.facing === undefined || !p.targetId) continue
    if (!spend(ctx, 0.5)) break
    const t = getFighter(state, p.targetId)
    if (t.posture === 'seriouslyInjured' && enemiesOf(state, f).some((e) => e.posture !== 'seriouslyInjured')) continue
    const ov = overlay(state, f.id, { facing: p.facing })
    const sh = bestShot(ctx, ov, ov.fighters[f.id]!, { aimed: false, mode: 'shoot', actionsLeft: left })
    if (sh && sh.value > current + 0.12 && (!best || sh.value > best.v)) best = { o, v: sh.value }
  }
  return best ? best.o : null
}

// ---------------------------------------------------------------------------
// Public policies
// ---------------------------------------------------------------------------

/** Pick among scored candidates: the best, or (easy tier) a random one of the top K that is not clearly worse. */
function pickBest(ctx: AiCtx, scored: Scored[]): Scored | null {
  if (scored.length === 0) return null
  const sorted = scored.slice().sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
  const k = Math.min(ctx.params.topK, sorted.length)
  if (k <= 1) return sorted[0]!
  const best = sorted[0]!.score
  // noise picks among real actions: ending the activation is not a "slightly worse" plan, it is a different thing
  const pool = sorted.slice(0, k + 1).filter((s) => s.score >= best - 0.6 && (s.note !== 'end' || sorted[0]!.note === 'end')).slice(0, k)
  return pool[ctx.int(pool.length)]!
}

function activationKey(state: GameState): string {
  const a = state.action.activation
  return a ? `${state.round}:${a.fighterId}` : ''
}

function intentFor(ctx: AiCtx, state: GameState, fighterId: string): Intent {
  const key = `${state.round}:${fighterId}`
  const m = ctx.memory
  if (!m.intent || m.intentKey !== key) {
    m.intent = { fighterId, banned: [], dest: null, chosen: null, startPos: null }
    m.intentKey = key
    m.chooseCount = 0
  }
  return m.intent
}

/** The option chosen at the last action.choose led nowhere (no path, no target): never pick it again this activation. */
export function banChosen(ctx: AiCtx): void {
  const i = ctx.memory.intent
  if (i && i.chosen && !i.banned.includes(i.chosen)) i.banned.push(i.chosen)
}

/** `action.choose`: the next action of the fighter on turn. */
export function chooseAction(ctx: AiCtx): Action | null {
  const state = ctx.view
  const p = ctx.pending
  if (!p.options) return null
  const a = state.action.activation
  if (!a) return null
  const f = getFighter(state, a.fighterId)
  const intent = intentFor(ctx, state, f.id)
  ctx.memory.chooseCount = (ctx.memory.chooseCount ?? 0) + 1
  const endOpt = p.options.find((o) => o.action.type === 'action.choose' && o.action.payload.action === 'end')
  // a watchdog: a long loop of cancelled actions ends the activation
  if ((ctx.memory.chooseCount ?? 0) > 12 && endOpt) return endOpt.action
  intent.dest = null
  intent.chosen = null
  if (a.performed.length === 0 || !intent.startPos) intent.startPos = centre(f)
  const trail = (ctx.memory.trail[f.id] ??= [])
  const here = centre(f)
  if (trail.length === 0 || Math.hypot(trail[trail.length - 1]!.x - here.x, trail[trail.length - 1]!.z - here.z) > 0.3) {
    trail.push(here)
    if (trail.length > 4) trail.shift()
  }
  const snap = snapshot(ctx, state, f, a.actionsLeft)
  const scored = scoreChoices(ctx, state, snap, p.options, intent.banned)
  const turnless = scored.filter((s) => s.note !== 'turn')
  // a free turn that opens a better shot comes before anything else
  if (a.canTurn && f.posture === 'standing') {
    const shootNow = turnless.find((s) => s.note === 'shoot')?.score ?? 0
    const t = turnChoice(ctx, state, f, p.options, Math.max(0, shootNow))
    if (t) return t.action
  }
  const best = pickBest(ctx, turnless)
  if (tracing()) console.log(`[ai] r${state.round} ${f.id}@${f.pos.x.toFixed(1)},${f.pos.z.toFixed(1)} ${f.posture} left=${a.actionsLeft} damp=${ctx.cache.get(`damp:${f.id}`)} goals=${snap.goals.map((g) => `${g.kind}:${g.pos.x.toFixed(0)},${g.pos.z.toFixed(0)}`).join('|')} ${turnless.map((x) => `${x.note ?? x.id}=${x.score.toFixed(2)}`).join(' ')} -> ${best?.note ?? best?.id}`)
  if (!best) return null
  intent.chosen = best.id
  if (best.dest) intent.dest = best.dest
  return best.option.action
}

/** `move.path`: walk the destination the choice settled on, or plan one now. */
export function movePath(ctx: AiCtx): Action | null {
  const state = ctx.view
  const p = ctx.pending
  const c = p.constraints
  if (!c?.fighterId) return null
  const f = getFighter(state, c.fighterId)
  const kind = c.kind
  const intent = ctx.memory.intent
  const max = c.maxInches ?? 0
  // a Retreat cannot be passed once its dice are rolled: take the engine's best end point (it scores the same four criteria)
  if (kind === 'retreat') return suggest(state, p)
  if (kind === 'somersault') {
    // the spot the choice settled on, else the best legal spot of a Move's ranking, else give the action back
    if (intent && intent.fighterId === f.id && intent.dest && intent.dest.kind === 'somersault' && intent.dest.path.length > 0) {
      const a = act.path(p, intent.dest.path.map((q) => ({ x: round3(q.x), z: round3(q.z) })), intent.dest.facing ?? undefined)
      if (!validate(state, a)) return a
    }
    const scored = somersaultSpots(ctx, state, f, max, goalsFor(ctx, state, f), (state.action.activation?.actionsLeft ?? 1))
    for (const s of scored) {
      const a = act.path(p, [{ x: round3(s.pos.x), z: round3(s.pos.z) }], round3(s.facing))
      if (!validate(state, a)) return a
    }
    banChosen(ctx)
    return p.canPass ? act.pass(p) : suggest(state, p)
  }
  if (kind === 'consolidate') {
    if (intent && intent.fighterId === f.id && intent.dest && intent.dest.kind === 'consolidate' && intent.dest.path.length > 0) {
      const a = act.path(p, intent.dest.path.map((q) => ({ x: round3(q.x), z: round3(q.z) })), undefined)
      if (!validate(state, a)) return a
    }
    return p.canPass ? act.pass(p) : suggest(state, p)
  }
  if (kind === 'carry') {
    // haul the casket toward home: the reachable spot nearest to it by walking distance
    const home = homePoint(ctx, state, f.seat, centre(f))
    if (home) {
      const goal: Goal = { kind: 'casket', pos: home, ideal: 0.5, weight: 1, radius: 0 }
      const here = approachCost(state, f, [goal], centre(f))
      const spots = candidateSpots(ctx, state, f, 'move', max, [goal], 13)
        .map((sp) => ({ sp, c: approachCost(state, f, [goal], sp.pos) }))
        .filter((x) => x.sp.path.length > 0 && x.c < here - 0.2)
        .sort((x, y) => x.c - y.c)
      for (const { sp } of spots) {
        const a = act.path(p, sp.path.map((q) => ({ x: round3(q.x), z: round3(q.z) })))
        if (!validate(state, a)) return a
      }
    }
    banChosen(ctx)
    return p.canPass ? act.pass(p) : suggest(state, p)
  }
  const mk = kind as MoveKind
  // the destination chosen at the action.choose decision
  if (intent && intent.fighterId === f.id && intent.dest && intent.dest.kind === kind) {
    const d = intent.dest
    const facing = kind === 'move' ? round3(d.facing ?? f.facing) : undefined
    const a = act.path(p, d.path.map((q) => ({ x: round3(q.x), z: round3(q.z) })), facing)
    const rej = validate(state, a)
    if (!rej && (d.path.length > 0 || kind === 'takeCover')) return a
    if (tracing()) console.log(`[ai] move.path dest rejected: ${rej ? rej.code + ' ' + rej.reason : 'empty'} ${JSON.stringify(d.path)}`)
  }
  // otherwise plan it here: the best spot of the kind
  const goals = goalsFor(ctx, state, f)
  const left = state.action.activation?.actionsLeft ?? 1
  const scored = scoreSpots(ctx, state, f, mk, max, goals, left).sort((x, y) => y.score - x.score)
  for (const s of scored) {
    const facing = kind === 'move' ? round3(s.facing) : undefined
    const a = act.path(p, s.spot.path.map((q) => ({ x: round3(q.x), z: round3(q.z) })), facing)
    if (!validate(state, a)) return a
  }
  // nothing legal: hand the action back and never pick this one again this activation
  if (p.canPass) banChosen(ctx)
  const s = suggest(state, p)
  if (s && s.type !== 'pass' && !validate(state, s)) return s
  return p.canPass ? act.pass(p) : s
}

// ---------------------------------------------------------------------------
// Who activates, who joins
// ---------------------------------------------------------------------------

/** A cheap estimate of what activating a fighter now is worth: its best shot or charge, and the danger it stands in. */
export function activationValue(ctx: AiCtx, state: GameState, f: Fighter): number {
  const key = `av:${f.id}`
  const hit = ctx.cache.get(key) as number | undefined
  if (hit !== undefined) return hit
  let v = 0.04
  if (isBroken(f)) {
    ctx.cache.set(key, 1.5)
    return 1.5
  }
  if (f.posture === 'standing' && f.engagedWith.length === 0) {
    const sh = shotFrom(ctx, state, f, centre(f), 'standing', 2, false, null)
    if (sh) v = Math.max(v, sh.plan.value + 0.1)
    // a charge on offer
    // (walking distance from the fighter's field, not the engine's per-target charge routes: this runs for every Ready fighter)
    let bestCharge = 0
    const m = f.stats.M
    const field = fieldFrom(state, centre(f), f.baseRadius, false)
    for (const tf of enemiesOf(state, f)) {
      if (tf.posture === 'seriouslyInjured' || baseGap(f, tf) > m + 3.2) continue
      const pReach = reachChance(m, Math.max(0, sampleField(field, centre(tf)) - f.baseRadius - tf.baseRadius) * 1.05)
      if (pReach < 0.3) continue
      const fo = query.fightOutcome(state, f.id, undefined, [tf.id], { charge: true }).targets[0]
      if (fo) bestCharge = Math.max(bestCharge, pReach * fighterValue(state, tf) * (fo.pOutOfAction + 0.65 * fo.pSeriouslyInjured))
    }
    v = Math.max(v, bestCharge)
    const danger = exposure(ctx, state, f, centre(f), 'standing').loss
    v += 0.5 * ctx.w.threat * danger
    // a fighter far from any action still has ground to cover
    v += 0.05
  } else if (f.engagedWith.length > 0) {
    const m = meleeValue(ctx, state, f, f.engagedWith, false)
    v = Math.max(v, m.dealt - ctx.w.threat * m.taken * 0.5 + 0.2)
  } else if (f.posture === 'pinned') {
    const danger = exposure(ctx, state, f, centre(f), 'pinned').loss
    v = 0.12 + 0.3 * danger
    const blind = bestShot(ctx, state, f, { aimed: false, mode: 'blindFire', actionsLeft: 2 })
    if (blind) v = Math.max(v, blind.value * 0.9)
  } else {
    v = 0.03
  }
  ctx.cache.set(key, v)
  return v
}

/** `action.activate`: the Ready fighter whose activation is worth the most now. */
export function activate(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  if (!p.options) return null
  const scored: Scored[] = []
  for (const o of p.options) {
    if (o.action.type !== 'action.activate') continue
    const f = getFighter(state, o.action.payload.fighterId)
    let v = activationValue(ctx, state, f)
    // a leader's group activation moves several fighters before the opponent can answer
    const x = groupSize(state, f)
    if (x > 0 && !p.context.group) {
      const mates = readyFighters(state, f.seat)
        .filter((g) => g.id !== f.id && Math.hypot(g.pos.x - f.pos.x, g.pos.z - f.pos.z) <= 6)
        .map((g) => activationValue(ctx, state, g))
        .sort((a, b) => b - a)
        .slice(0, x)
      v += 0.2 * mates.reduce((s, m) => s + m, 0)
    }
    scored.push({ id: f.id, option: o, score: v })
  }
  const best = pickBest(ctx, scored)
  return best ? best.option.action : null
}

/** `action.group`: nominate a Ready friend that has something worth doing now, else stop. */
export function group(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const state = ctx.view
  if (!p.options) return null
  let best: { o: DecisionOption; v: number } | null = null
  let done: DecisionOption | null = null
  for (const o of p.options) {
    if (o.action.type !== 'action.group') continue
    if (o.action.payload.done) {
      done = o
      continue
    }
    const f = getFighter(state, o.action.payload.fighterId!)
    const v = activationValue(ctx, state, f)
    if (!best || v > best.v) best = { o, v }
  }
  if (best && best.v >= 0.22) return best.o.action
  return done ? done.action : (best?.o.action ?? null)
}

export { friendsOf, readyFighters }
