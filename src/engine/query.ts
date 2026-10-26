// query.*: every number the UI shows comes from here - visibility, cover/obscured verdicts, control
// range, marker control by APL, distances, odds. The client never computes a rules number itself.
import { providerControlApl, providerControlTotal } from './team-rules'
import { dieOdds, poolDistribution, type DieOdds, type PoolOutcome } from './dice'
import { bodyOf, enemiesInControlRange, inControlRange, markerInControlRange, distanceBetween } from './measure'
import { targetVerdict, visible, type TargetVerdict } from './los'
import { activeOps, effectiveApl, getOp } from './state'
import type { GameState, Marker, Seat } from './types'

export { targetVerdict, visible }
export type { TargetVerdict }
export { inControlRange, distanceBetween }

export function isVisible(state: GameState, viewerId: string, targetId: string): boolean {
  return visible(state, bodyOf(getOp(state, viewerId)), bodyOf(getOp(state, targetId)))
}

export function verdictFor(state: GameState, attackerId: string, targetId: string): TargetVerdict {
  const t = getOp(state, targetId)
  return targetVerdict(state, bodyOf(getOp(state, attackerId)), { ...bodyOf(t), order: t.order })
}

export function operativeDistance(state: GameState, aId: string, bId: string): number {
  return distanceBetween(bodyOf(getOp(state, aId)), bodyOf(getOp(state, bId)))
}

export function inControlRangeOf(state: GameState, aId: string, bId: string): boolean {
  return inControlRange(state, bodyOf(getOp(state, aId)), bodyOf(getOp(state, bId)))
}

export function enemiesInCr(state: GameState, opId: string): string[] {
  const op = getOp(state, opId)
  return enemiesInControlRange(state, op, op.seat).map((o) => o.id)
}

export interface MarkerControl {
  contesting: Record<Seat, string[]>
  apl: Record<Seat, number>
  controller: Seat | null
}

/**
 * Contest and control (R-8.5, R-8.6): an operative contests a marker in its control range; the side
 * whose contesting operatives have the strictly greater total APL controls it. A carrier alone
 * contests and controls its marker.
 */
export function markerControl(state: GameState, marker: Marker): MarkerControl {
  const contesting: Record<Seat, string[]> = { A: [], B: [] }
  const apl: Record<Seat, number> = { A: 0, B: 0 }
  if (marker.carriedBy) {
    const carrier = state.operatives[marker.carriedBy]
    if (carrier && carrier.status === 'active') {
      contesting[carrier.seat].push(carrier.id)
      apl[carrier.seat] = effectiveApl(carrier)
      return { contesting, apl, controller: carrier.seat }
    }
  }
  for (const op of activeOps(state)) {
    if (markerInControlRange(state, bodyOf(op), marker)) {
      contesting[op.seat].push(op.id)
      // M9 prep: team rules change what an operative counts for here only (Icon Bearer, Drone, Steadfast)
      apl[op.seat] += providerControlApl(state, op, marker, effectiveApl(op))
    }
  }
  // M9 prep: team rules change a side's total (Despair -1, a Reanimation marker counting as APL 1)
  for (const seat of ['A', 'B'] as const) apl[seat] = providerControlTotal(state, seat, marker, apl[seat], contesting[seat])
  const controller: Seat | null = apl.A > apl.B ? 'A' : apl.B > apl.A ? 'B' : null
  return { contesting, apl, controller }
}

/** Exact odds for one die against a Hit or Save target. */
export function hitOdds(target: number, lethal?: number): DieOdds {
  return dieOdds(target, lethal)
}

export function successDistribution(dice: number, target: number, lethal?: number): PoolOutcome[] {
  return poolDistribution(dice, dieOdds(target, lethal))
}


// ---------------------------------------------------------------------------
// M2b-attack: expected damage, kill odds, fight minimax, default answers
// ---------------------------------------------------------------------------
import {
  attackStats,
  autoBlock,
  countKinds,
  defenceStats,
  newSide,
  policyReroll,
  pushRetained,
  retainAttack,
  ruleSetFor,
  targetInfo,
  validTargets,
  weaponOf,
} from './attack-common'
import { classifyDie, faceDistribution } from './dice'
import { withoutFireCounts } from './code-hooks'
import { runHook, type AfterRollData } from './hooks'
import type { Action, AttackDie, DiceSide, Operative, PendingDecision, RerollGrant } from './types'

export interface ExpectedDamage {
  /** mean damage to the primary target, Devastating included */
  mean: number
  /** probability the target is incapacitated by one Shoot action against it */
  killProbability: number
  /** exact distribution of total damage */
  distribution: { damage: number; p: number }[]
  inCover: boolean
  obscured: boolean
  improvedCover: boolean
  /** the defender had a cover/obscured choice; the better one for the defender is reported */
  forcedChoice: boolean
}

interface AttackOutcome {
  normal: number
  crit: number
  critRetained: boolean
  p: number
}

/** Re-roll with the default policy (failed dice) and expand over the new faces. */
function expandRerolls(
  dice: AttackDie[],
  grants: RerollGrant[],
  p: number,
  need: number,
  lethal: number | null,
  out: (d: AttackDie[], p: number) => void,
): void {
  const pol = policyReroll(dice, grants)
  if (!pol) {
    out(dice, p)
    return
  }
  const grants2 = grants.map((g) => (g.id === pol.grant ? { ...g, used: true } : g))
  for (const o of faceDistribution(pol.dice.length)) {
    const next = dice.map((d) => ({ ...d }))
    pol.dice.forEach((idx, k) => {
      const d = next[idx]!
      d.value = o.faces[k]!
      d.rerolled = true
      d.kind = classifyDie(d.value, need, lethal ?? undefined)
    })
    expandRerolls(next, grants2, p * o.p, need, lethal, out)
  }
}

const outcomeCache = new Map<string, AttackOutcome[]>()

/** Changes after-roll rules make to a final attack pool (afterAttackRoll hooks run with no engine: Grudge). */
type Convert = (dice: AttackDie[]) => void

/**
 * M9 batch B shared: the team conversions of a rolled attack pool, for the odds. The afterAttackRoll hooks run as in
 * the Shoot (after re-rolls and the Accurate retains, before retention) with `data.query` set and no `engine`: a
 * handler that needs the engine (a choice, an event, a ledger use) does nothing, so only pure dice conversions count.
 * Returns the converter and a fingerprint of what it does to a probe pool (part of the outcome cache key), or null
 * when no rule changes anything for this attacker, weapon and target.
 */
function conversionFor(state: GameState, attackerId: string, weaponId: string, targetId: string, obscured: boolean, stats: ReturnType<typeof attackStats>): { convert: Convert; key: string } | null {
  const attacker = state.operatives[attackerId]
  if (!attacker) return null
  const convert: Convert = (dice) => {
    const data: AfterRollData = { kind: 'shoot', side: 'attack', targetId, dice, requests: [], choices: {}, obscured, query: true }
    withoutFireCounts(() =>
      runHook('afterAttackRoll', { seat: attacker.seat, state, operativeId: attackerId, targetId, weaponId, data: data as unknown as Record<string, unknown> }),
    )
  }
  const n = Math.max(1, stats.atk)
  const probe = (): AttackDie[] => [
    ...Array.from({ length: n }, (): AttackDie => ({ value: 6, kind: 'crit', rerolled: false })),
    ...Array.from({ length: n }, (): AttackDie => ({ value: stats.need, kind: classifyDie(stats.need, stats.need, stats.lethal ?? undefined), rerolled: false })),
    ...Array.from({ length: n }, (): AttackDie => ({ value: 1, kind: 'fail', rerolled: false })),
  ]
  const sig = (dice: AttackDie[]) => dice.map((d) => `${d.value ?? '-'}${d.kind[0]}${d.used ? 'u' : ''}`).join('')
  const before = probe()
  const after = probe()
  convert(after)
  const a = sig(after)
  return a === sig(before) ? null : { convert, key: a }
}

/** The retained (normal, crit) outcomes of an attack pool; without conversions they do not depend on the target, so they are cached. */
function attackOutcomes(stats: ReturnType<typeof attackStats>, obscured: boolean, conv: { convert: Convert; key: string } | null = null): AttackOutcome[] {
  const key = [
    conv?.key ?? '',
    stats.atk,
    stats.accurate,
    stats.need,
    stats.lethal,
    stats.grants.map((g) => `${g.id}${g.mode}${g.used ? 'u' : ''}${g.values ? `v${g.values.join('')}` : ''}`).join(','),
    stats.rules.punishing ? 'P' : '',
    stats.rules.rending ? 'R' : '',
    stats.rules.severe ? 'S' : '',
    obscured ? 'O' : '',
  ].join('|')
  const hit = outcomeCache.get(key)
  if (hit) return hit
  const out = computeOutcomes(stats, obscured, conv?.convert)
  if (outcomeCache.size > 300) outcomeCache.clear()
  outcomeCache.set(key, out)
  return out
}

function computeOutcomes(stats: ReturnType<typeof attackStats>, obscured: boolean, convert?: Convert): AttackOutcome[] {
  const rolled = stats.atk - stats.accurate
  const acc = new Map<string, AttackOutcome>()
  for (const o of faceDistribution(rolled)) {
    const dice: AttackDie[] = o.faces.map((v) => ({
      value: v,
      kind: classifyDie(v, stats.need, stats.lethal ?? undefined),
      rerolled: false,
    }))
    expandRerolls(dice, stats.grants, o.p, stats.need, stats.lethal, (final, p) => {
      const side: DiceSide = newSide('A', 'x', 'w', stats.need, stats.lethal, [])
      side.dice = final.map((d) => ({ ...d }))
      pushRetained(side, stats.accurate, 'normal', 'accurate')
      convert?.(side.dice)
      const r = retainAttack(side, stats.rules, obscured)
      const c = countKinds(side.dice)
      const key = `${c.normal}|${c.crit}|${r.critRetained}`
      const prev = acc.get(key)
      if (prev) prev.p += p
      else acc.set(key, { normal: c.normal, crit: c.crit, critRetained: r.critRetained, p })
    })
  }
  return [...acc.values()]
}

function defaultCoverMode(collected: number, improved: boolean, brutal: boolean): 'retain' | 'retainCrit' | 'retainTwo' {
  if (!improved) return 'retain'
  return collected >= 2 && !brutal ? 'retainTwo' : 'retainCrit'
}

function oneStatus(
  state: GameState,
  attackerId: string,
  weaponId: string,
  targetId: string,
  cover: boolean,
  obscured: boolean,
  improved: boolean,
  vantageAccurate: number,
): Map<number, number> {
  const stats = attackStats(state, attackerId, weaponId, targetId, { kind: 'shoot', vantageAccurate })
  const weapon = weaponOf(state, weaponId)
  const dist = new Map<number, number>()
  const add = (dmg: number, p: number) => dist.set(dmg, (dist.get(dmg) ?? 0) + p)
  const defCache = new Map<string, { normal: number; crit: number; p: number }[]>()
  for (const ao of attackOutcomes(stats, obscured, conversionFor(state, attackerId, weaponId, targetId, obscured, stats))) {
    const ds = defenceStats(state, targetId, attackerId, weaponId, stats.rules, ao.critRetained)
    let retained = 0
    let retainedCrit = false
    if (cover && !stats.rules.saturate && ds.collected >= 1) {
      const mode = defaultCoverMode(ds.collected, improved, stats.rules.brutal)
      retained = mode === 'retainTwo' ? 2 : 1
      retainedCrit = mode === 'retainCrit'
    }
    const m = ds.collected - retained
    const key = `${m}|${ds.need}`
    let rolled = defCache.get(key)
    if (!rolled) {
      rolled = poolDistribution(m, dieOdds(ds.need)).map((o) => ({ normal: o.normals, crit: o.crits, p: o.p }))
      defCache.set(key, rolled)
    }
    const devastating = ao.critRetained && stats.rules.devastating ? stats.rules.devastating.x * ao.crit : 0
    for (const r of rolled) {
      const dn = r.normal + (retainedCrit ? 0 : retained)
      const dc = r.crit + (retainedCrit ? retained : 0)
      const plan = autoBlock(ao.normal, ao.crit, dn, dc, weapon.dmg, stats.rules.brutal)
      add(devastating + plan.damage, ao.p * r.p)
    }
  }
  return dist
}

function summarise(dist: Map<number, number>, wounds: number): { mean: number; kill: number; list: { damage: number; p: number }[] } {
  const list = [...dist.entries()].map(([damage, p]) => ({ damage, p })).sort((a, b) => a.damage - b.damage)
  let mean = 0
  let kill = 0
  for (const e of list) {
    mean += e.damage * e.p
    if (e.damage >= wounds) kill += e.p
  }
  return { mean, kill, list }
}

/**
 * Exact expected damage of one Shoot against `targetId` with `weaponId`, by enumerating every dice
 * outcome: the default re-roll policy (failed dice), the defender retains cover and blocks to minimise
 * damage (`auto`). Command Re-rolls and ploys are not counted. Blast/Torrent secondaries are not included.
 */
export function expectedDamage(state: GameState, attackerId: string, weaponId: string, targetId: string): ExpectedDamage {
  const attacker = getOp(state, attackerId)
  const target = getOp(state, targetId)
  const rules = ruleSetFor(state, attacker, weaponId, 'shoot', targetId)
  const info = targetInfo(state, attacker, target, rules)
  const va = info.verdict.vantage.accurate
  const run = (cover: boolean, obscured: boolean, improved: boolean) =>
    summarise(oneStatus(state, attackerId, weaponId, targetId, cover, obscured, improved, va), target.wounds)
  let best: ReturnType<typeof run>
  let status = { cover: info.inCover, obscured: info.obscured, improved: info.improvedCover }
  if (info.verdict.forcedChoice) {
    const a = run(info.verdict.ifCover.inCover, info.verdict.ifCover.obscured, info.improvedCover)
    const b = run(info.verdict.ifObscured.inCover, true, info.improvedCover && info.verdict.ifObscured.inCover)
    if (a.mean <= b.mean) {
      best = a
      status = { cover: info.verdict.ifCover.inCover, obscured: info.verdict.ifCover.obscured, improved: info.improvedCover }
    } else {
      best = b
      status = { cover: info.verdict.ifObscured.inCover, obscured: true, improved: info.improvedCover && info.verdict.ifObscured.inCover }
    }
  } else {
    best = run(info.inCover, info.obscured, info.improvedCover)
  }
  return {
    mean: best.mean,
    killProbability: best.kill,
    distribution: best.list,
    inCover: status.cover,
    obscured: status.obscured,
    improvedCover: status.improved,
    forcedChoice: info.verdict.forcedChoice,
  }
}

/** Probability that one Shoot action incapacitates the target (Devastating included). */
export function killOdds(state: GameState, attackerId: string, weaponId: string, targetId: string): number {
  return expectedDamage(state, attackerId, weaponId, targetId).killProbability
}

// ---------------------------------------------------------------------------
// Fight minimax (R-6.5): strike or block one unresolved die at a time
// ---------------------------------------------------------------------------

export interface FightSideState {
  normals: number
  crits: number
  dmg: { normal: number; crit: number }
  wounds: number
  /** this fighter's weapon has Shock and has not used it yet */
  shock: boolean
  /** this fighter's weapon is Brutal: the opponent may block only with crits */
  brutal: boolean
}

export interface FightPosition {
  a: FightSideState
  d: FightSideState
  /** whose turn it is to resolve a die */
  turn: 'a' | 'd'
}

export interface FightMove {
  op: 'strike' | 'block'
  die: 'normal' | 'crit'
  against?: 'normal' | 'crit'
  /** value of the position after this move with best play, from the mover's point of view */
  value: number
}

export interface FightOutcome {
  /** final wounds of each fighter with best play by both */
  aWounds: number
  dWounds: number
  /** value from the attacker's point of view: damage dealt minus damage taken, plus/minus 1000 per incapacitation */
  value: number
  best: FightMove | null
  moves: FightMove[]
}

const KILL = 1000

interface Solved {
  v: number
  a: number
  d: number
}

function fightKey(p: FightPosition): string {
  return [p.a.normals, p.a.crits, p.d.normals, p.d.crits, p.a.wounds, p.d.wounds, p.turn, p.a.shock ? 1 : 0, p.d.shock ? 1 : 0].join(',')
}

function clonePos(p: FightPosition): FightPosition {
  return { a: { ...p.a }, d: { ...p.d }, turn: p.turn }
}

function score(p: FightPosition, start: { a: number; d: number }): number {
  let v = start.d - p.d.wounds - (start.a - p.a.wounds)
  if (p.d.wounds <= 0) v += KILL
  if (p.a.wounds <= 0) v -= KILL
  return v
}

interface Enumerated {
  move: Omit<FightMove, 'value'>
  next: FightPosition
}

function enumerateMoves(p: FightPosition): Enumerated[] {
  const me = p.turn === 'a' ? p.a : p.d
  const foe = p.turn === 'a' ? p.d : p.a
  const myDice = me.normals + me.crits
  const foeDice = foe.normals + foe.crits
  const out: Enumerated[] = []
  const flip = (n: FightPosition): FightPosition => {
    n.turn = p.turn === 'a' ? 'd' : 'a'
    return n
  }
  // one side out of dice: the other side strikes with everything left, crits first (R-6.6)
  if (myDice === 0 || foeDice === 0) {
    const n = clonePos(p)
    const strikerIsMover = myDice > 0
    const who = strikerIsMover ? (p.turn === 'a' ? n.a : n.d) : p.turn === 'a' ? n.d : n.a
    const other = who === n.a ? n.d : n.a
    const dice: ('crit' | 'normal')[] = [...Array<'crit'>(who.crits).fill('crit'), ...Array<'normal'>(who.normals).fill('normal')]
    for (const k of dice) {
      if (other.wounds <= 0) break
      other.wounds = Math.max(0, other.wounds - (k === 'crit' ? who.dmg.crit : who.dmg.normal))
    }
    who.normals = 0
    who.crits = 0
    const src = strikerIsMover ? me : foe
    out.push({ move: { op: 'strike', die: src.crits > 0 ? 'crit' : 'normal' }, next: flip(n) })
    return out
  }
  for (const die of ['crit', 'normal'] as const) {
    if ((die === 'crit' ? me.crits : me.normals) === 0) continue
    {
      const n = clonePos(p)
      const m = p.turn === 'a' ? n.a : n.d
      const f = p.turn === 'a' ? n.d : n.a
      if (die === 'crit') m.crits--
      else m.normals--
      f.wounds = Math.max(0, f.wounds - (die === 'crit' ? m.dmg.crit : m.dmg.normal))
      if (die === 'crit' && m.shock) {
        m.shock = false
        if (f.normals > 0) f.normals--
        else if (f.crits > 0) f.crits--
      }
      out.push({ move: { op: 'strike', die }, next: flip(n) })
    }
    for (const against of ['crit', 'normal'] as const) {
      if ((against === 'crit' ? foe.crits : foe.normals) === 0) continue
      if (die === 'normal' && against === 'crit') continue
      if (foe.brutal && die !== 'crit') continue
      const n = clonePos(p)
      const m = p.turn === 'a' ? n.a : n.d
      const f = p.turn === 'a' ? n.d : n.a
      if (die === 'crit') m.crits--
      else m.normals--
      if (against === 'crit') f.crits--
      else f.normals--
      out.push({ move: { op: 'block', die, against }, next: flip(n) })
    }
  }
  return out
}

function solve(p: FightPosition, start: { a: number; d: number }, memo: Map<string, Solved>): Solved {
  const key = fightKey(p)
  const hit = memo.get(key)
  if (hit) return hit
  let out: Solved
  if (p.a.wounds <= 0 || p.d.wounds <= 0 || (p.a.normals + p.a.crits === 0 && p.d.normals + p.d.crits === 0)) {
    out = { v: score(p, start), a: p.a.wounds, d: p.d.wounds }
  } else {
    let best: Solved | null = null
    for (const m of enumerateMoves(p)) {
      const r = solve(m.next, start, memo)
      if (!best || (p.turn === 'a' ? r.v > best.v : r.v < best.v)) best = r
    }
    out = best!
  }
  memo.set(key, out)
  return out
}

/** Best play for both fighters from a position: final wounds, the value, and every first move rated. */
export function fightOutcome(position: FightPosition): FightOutcome {
  const start = { a: position.a.wounds, d: position.d.wounds }
  const memo = new Map<string, Solved>()
  const root = solve(position, start, memo)
  const moves: FightMove[] = []
  if (position.a.wounds > 0 && position.d.wounds > 0) {
    for (const m of enumerateMoves(position)) {
      const r = solve(m.next, start, memo)
      moves.push({ ...m.move, value: position.turn === 'a' ? r.v : -r.v })
    }
  }
  moves.sort((x, y) => y.value - x.value)
  return { aWounds: root.a, dWounds: root.d, value: root.v, best: moves[0] ?? null, moves }
}

// ---------------------------------------------------------------------------
// Default answers (the AI baseline, tests and the headless sims)
// ---------------------------------------------------------------------------

function sideOfSeat(state: GameState, seat: Seat): DiceSide | null {
  const a = state.attack
  const seq = a?.seq
  if (!a || !seq) return null
  if (a.kind === 'shoot') return a.stage === 'attackReroll' ? seq.atk : seq.def
  if (seq.atk.seat === seat && seq.atk.weaponId) return seq.atk
  return seq.def
}

function optionBy(pending: PendingDecision, id: string): Action | null {
  return pending.options?.find((o) => o.id === id)?.action ?? null
}

/**
 * The engine's default answer to an attack-related decision: re-roll failed dice, never spend CP on a
 * Command Re-roll, retain cover, block to minimise damage, play the fight by minimax, shoot the target
 * with the highest expected damage. Returns null for decisions it does not own.
 */
export function answerDecision(state: GameState, pending: PendingDecision): Action | null {
  const opts = pending.options ?? []
  const pass = { type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} } as Action
  switch (pending.kind) {
    case 'dice.reroll': {
      const side = sideOfSeat(state, pending.seat)
      const pol = side ? policyReroll(side.dice, side.grants) : null
      if (pol) {
        const hit = opts.find((o) => {
          const pl = o.action.payload as { grant?: string; dice?: number[] }
          return pl.grant === pol.grant && JSON.stringify(pl.dice) === JSON.stringify(pol.dice)
        })
        if (hit) return hit.action
      }
      return pass
    }
    case 'dice.commandReroll':
      return pass
    case 'shoot.coverSave': {
      const improved = pending.context.improved === true
      const collected = Number(pending.context.collected)
      return optionBy(pending, defaultCoverMode(collected, improved, false)) ?? opts[0]?.action ?? null
    }
    case 'shoot.block':
      return optionBy(pending, 'auto') ?? opts[0]?.action ?? null
    case 'weapon.choice':
      return optionBy(pending, 'obscured') ?? opts[0]?.action ?? null
    case 'shoot.weapon': {
      const op = state.operatives[String(pending.context.operativeId)] as Operative | undefined
      let best: { id: string; mean: number } | null = null
      for (const o of opts) {
        const w = String((o.action.payload as { weaponId: string }).weaponId)
        const targets = op ? validTargets(state, op, w).map((t) => t.id) : []
        const mean = Math.max(0, ...targets.map((t) => expectedDamage(state, op!.id, w, t).mean))
        if (!best || mean > best.mean) best = { id: o.id, mean }
      }
      return best ? optionBy(pending, best.id) : (opts[0]?.action ?? null)
    }
    case 'shoot.target': {
      if (pending.context.secondary === true) {
        const me = state.operatives[String(pending.context.operativeId)]
        const add = opts.find((o) => o.id !== 'done' && state.operatives[String((o.action.payload as { targetId: string }).targetId)]?.seat !== me?.seat)
        return add?.action ?? optionBy(pending, 'done') ?? opts[0]?.action ?? null
      }
      let best = opts[0]
      let bestScore = -1
      for (const o of opts) {
        const sc = Number(o.data?.expectedDamage ?? 0) + Number(o.data?.killProbability ?? 0) * 3
        if (sc > bestScore) {
          best = o
          bestScore = sc
        }
      }
      return best?.action ?? null
    }
    case 'fight.target':
    case 'fight.weapon':
      return opts[0]?.action ?? null
    case 'fight.resolve': {
      const a = state.attack
      const seq = a?.seq
      const f = a?.fight
      if (!seq || !f) return opts[0]?.action ?? null
      const mine = seq.atk.seat === pending.seat && seq.atk.weaponId ? seq.atk : seq.def!
      const sideState = (side: DiceSide): FightSideState => {
        const c = countKinds(side.dice)
        const w = weaponOf(state, side.weaponId!)
        const has = (key: string) => w.rules.some((r) => r.rule.toLowerCase().replace(/[^a-z]/g, '').endsWith(key))
        return {
          normals: c.normal,
          crits: c.crit,
          dmg: w.dmg,
          wounds: state.operatives[side.operativeId]!.wounds,
          shock: has('shock') && !f.shockUsed[side.seat],
          brutal: has('brutal'),
        }
      }
      const pos: FightPosition = { a: sideState(seq.atk), d: seq.def ? sideState(seq.def) : sideState(seq.atk), turn: mine === seq.atk ? 'a' : 'd' }
      const b = fightOutcome(pos).best
      if (b) {
        const match = opts.find((o) => {
          const dd = o.data as { die?: string; against?: string } | undefined
          const pl = o.action.payload as { op?: string }
          return pl.op === b.op && dd?.die === b.die && (b.op === 'strike' || dd?.against === b.against)
        })
        if (match) return match.action
      }
      return opts[0]?.action ?? null
    }
    default:
      return null
  }
}
