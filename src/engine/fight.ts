// FGT module: owns `fight.*`. Close combat (R-10) and everything that runs inside it: the Fight action, the Charge (R-7.6)
// with its free Fight or free Coup de Grace, Retreat (R-7.9), Running for Cover (R-12.4), reaction attacks (R-10.8), Parry
// (R-10.9), consolidate or Coup de Grace (R-10.10, R-10.11) and the nerve tests owed by the hits on the way (R-12).
//
// One sequence lives on `state.attack` (kind 'fight'): a stack of frames and what to do when it is empty (`resume`: pay the
// action, carry on with the activation, or re-raise the decision an out-of-band nerve drain interrupted). Frames:
//   attack  - one fighter's attacks (the Fight, or a reaction): turn to face, weapons (`fight.weapons`), split between
//             targets (`fight.split`), hit rolls with assists / interference / turn / unseen-charge / Broken / stood-up /
//             Entangle modifiers, Parry re-rolls, then each hit through hits.ts (Power, Shock, Backstab, Knockback with the
//             attacker following up); afterwards the enemies still Standing and Engaged with it get reaction frames and the
//             owed nerve tests are taken (a fighter that breaks pushes its immediate Running for Cover on top).
//   after   - consolidate 2" or a free Coup de Grace when every enemy it was Engaged with is down (`fight.after`), or the free
//             Coup de Grace after a Charge that ended near a Seriously Injured enemy.
//   escape  - Retreat or Running for Cover: the I test when Engaged, the engaged enemies' I tests and reaction attacks, then
//             the move (Retreat: `move.path` kind retreat with the rolled D6; Running for Cover: the engine's path).
// Every die is rolled inside a step; decisions are raised only for real choices and are never empty.
import { continueActivation, endActivation, payAndContinue, resumeFlow } from './activation'
import { addEffect, effectsOf } from './effects'
import { continueEndPhase } from './endphase'
import { d6TestChance, d6TestPasses, firepowerFace, rollExpr } from './dice'
import { runHook } from './hooks'
import { resolveHit, type HitInput } from './hits'
import { takeOutOfAction } from './casualties'
import { hasLos, inVisionArc } from './los'
import { baseGap, CONTACT_EPS, inContact, refreshEngagement, withinPath } from './measure'
import { takeNerveTest } from './morale'
import {
  applyMove,
  chargeCost,
  chargeMove,
  halfMove,
  moveAllowance,
  planMove,
  placeAlong,
  retreatSuggestion,
  runForCoverPick,
  slide,
  LENGTH_TOLERANCE,
} from './movement'
import { stat } from './query'
import { reject, type Ctx, type Handled, type ModuleDef, type OptionInput } from './registry'
import { constants, EngineInvariantError, enemiesOf, friendsOf, getFighter, isBroken } from './state'
import { linkedWeaponIds } from './shoot'
import { hasTrait, isMeleeProfile, meltaApplies, profileImplemented, profileRanges, profileStrength, setCondition, T, versatileReach } from './traits'
import type { Action, Fighter, GameState, PendingDecision, RuntimeProfile, Seat, Vec2 } from './types'

/** R-10.10: the consolidate move. */
export const CONSOLIDATE_INCHES = 2
/** R-14.3 Entangle: a natural 6 to hit puts the target's reaction attacks at -2. */
const ENTANGLE_MODIFIER = -2

const centre = (f: Fighter): Vec2 => ({ x: f.pos.x, z: f.pos.z })

// ---------------------------------------------------------------------------
// Sequence state (state.attack.data)
// ---------------------------------------------------------------------------

interface AttackFrame {
  type: 'attack'
  attackerId: string
  role: 'fight' | 'reaction'
  /** the enemies the dice may go to (a reaction: the one fighter it strikes back at) */
  targets: string[]
  /** the enemies it was Engaged with (or reached) when the attack began (R-10.10) */
  engaged: string[]
  charge: boolean
  /** enemies the charger had no line of sight to at the start of the charge (R-10.6) */
  unseen: string[]
  /** the Versatile weapon of an attack made at reach, outside base contact (R-14.3) */
  reachWeapon: string | null
  turned: boolean
  weaponIds: string[] | null
  split: Record<string, number> | null
  stage: 'start' | 'weapons' | 'split' | 'splitting' | 'roll'
}

interface AfterFrame {
  type: 'after'
  attackerId: string
  mode: 'fight' | 'charge'
  engaged: string[]
  stage: 'start' | 'choose' | 'moving'
}

interface EscapeFrame {
  type: 'escape'
  fighterId: string
  kind: 'retreat' | 'runForCover'
  stage: 'start' | 'move' | 'moving'
  /** it was Engaged when the escape began (the I test applies) */
  engaged: boolean
  passed: boolean
  /** the enemies it was Engaged with (Retreat falls back to moving straight away from the nearest) */
  from: string[]
}

type Frame = AttackFrame | AfterFrame | EscapeFrame

export type Resume =
  | { kind: 'pay'; fighterId: string; action: string; free: string[] }
  | { kind: 'continue' }
  | { kind: 'reraise'; seat: Seat }
  | { kind: 'endActivation' }
  /** nerve tests owed in the End phase (S4): carry on with the End phase afterwards */
  | { kind: 'endPhase' }

interface FightSeq {
  stack: Frame[]
  resume: Resume
  /** fighters whose reaction attacks are at -2 this sequence (Entangle) */
  entangled: string[]
}

function seqOf(state: GameState): FightSeq {
  if (!state.attack || state.attack.kind !== 'fight') throw new EngineInvariantError('no close-combat sequence is in progress')
  return state.attack.data as unknown as FightSeq
}

function newSeq(ctx: Ctx, ownerId: string, resume: Resume): FightSeq {
  const seq: FightSeq = { stack: [], resume, entangled: [] }
  ctx.state.attack = { kind: 'fight', attackerId: ownerId, stage: 'sequence', targets: [], hitQueue: [], reactions: [], data: seq as unknown as Record<string, unknown> }
  return seq
}

const top = (seq: FightSeq): Frame | undefined => seq.stack[seq.stack.length - 1]
const pop = (seq: FightSeq): void => {
  seq.stack.pop()
}

function attackFrame(attackerId: string, role: AttackFrame['role'], targets: string[], extra: Partial<AttackFrame> = {}): AttackFrame {
  return { type: 'attack', attackerId, role, targets, engaged: [], charge: false, unseen: [], reachWeapon: null, turned: false, weaponIds: null, split: null, stage: 'start', ...extra }
}

// ---------------------------------------------------------------------------
// Weapons (R-10.3, R-10.4)
// ---------------------------------------------------------------------------

export interface MeleeWeapon {
  weaponId: string
  profile: RuntimeProfile
}

/** Weapons a fighter can use in close combat now: a Melee / Sidearm / engaged-only / Versatile profile, the weapon not Out of Ammo. */
export function meleeWeapons(state: GameState, f: Fighter): MeleeWeapon[] {
  const out: MeleeWeapon[] = []
  for (const fw of f.weapons) {
    if (fw.ammo !== 'ok') continue
    const w = state.data.weapons[fw.weaponId]
    if (!w) continue
    const p = w.profiles.find((q) => !fw.lostProfiles.includes(q.id) && isMeleeProfile(q) && profileImplemented(state, q))
    if (p) out.push({ weaponId: fw.weaponId, profile: p })
  }
  return out
}

export function meleeProfile(state: GameState, f: Fighter, weaponId: string): RuntimeProfile | null {
  return meleeWeapons(state, f).find((m) => m.weaponId === weaponId)?.profile ?? null
}

const isSidearm = (p: RuntimeProfile | null) => !!p && hasTrait(p, T.sidearm) && p.range.long !== 'E' && !hasTrait(p, T.melee)

/** R-10.4: A, Paired doubles the base A on a charge, +1 for two weapons (or Paired), +1 on a charge; `fight.attackDice` hooks. */
export function attackDiceFor(state: GameState, f: Fighter, weaponIds: readonly string[], charge: boolean): number {
  let n = stat(state, f.id, 'A')
  const profiles = weaponIds.map((id) => meleeProfile(state, f, id)).filter((p): p is RuntimeProfile => !!p)
  const paired = profiles.some((p) => hasTrait(p, T.paired))
  if (charge && paired) n *= 2
  if (weaponIds.length >= 2 || paired) n += 1
  if (charge) n += 1
  for (const r of runHook('fight.attackDice', { seat: f.seat, state, fighterId: f.id, data: { weaponIds: weaponIds.slice(), charge } })) if (r.delta) n += r.delta
  return Math.max(0, n)
}

/**
 * R-10.4: dice split as evenly as possible between two weapons, the odd die to the first named; a sidearm takes at most one
 * die, the rest going to the melee weapon or unarmed (weaponId null).
 */
export function weaponDice(state: GameState, f: Fighter, weaponIds: readonly string[], n: number): { weaponId: string | null; dice: number }[] {
  const side = (id: string) => isSidearm(meleeProfile(state, f, id))
  if (n <= 0) return []
  if (weaponIds.length === 0) return [{ weaponId: null, dice: n }]
  if (weaponIds.length === 1) {
    const w = weaponIds[0]!
    if (side(w) && n > 1) return [{ weaponId: w, dice: 1 }, { weaponId: null, dice: n - 1 }]
    return [{ weaponId: w, dice: n }]
  }
  const [w0, w1] = [weaponIds[0]!, weaponIds[1]!]
  let d0 = Math.ceil(n / 2)
  let d1 = Math.floor(n / 2)
  let unarmed = 0
  if (side(w0) && d0 > 1) {
    if (side(w1)) unarmed += d0 - 1
    else d1 += d0 - 1
    d0 = 1
  }
  if (side(w1) && d1 > 1) {
    if (side(w0)) unarmed += d1 - 1
    else d0 += d1 - 1
    d1 = 1
  }
  const out: { weaponId: string | null; dice: number }[] = []
  if (d0 > 0) out.push({ weaponId: w0, dice: d0 })
  if (d1 > 0) out.push({ weaponId: w1, dice: d1 })
  if (unarmed > 0) out.push({ weaponId: null, dice: unarmed })
  return out
}

/** Does `f` reach `t` only with a Versatile weapon (not in base contact or across a barricade)? */
function outOfContact(f: Fighter, t: Fighter): boolean {
  return !f.engagedWith.includes(t.id)
}

/**
 * The weapon combinations of R-10.3 for an attack: two Melee/Sidearm weapons (none Unwieldy; both orders when the odd die
 * matters), one weapon, or unarmed. An attack at Versatile reach may only use Versatile weapons that reach every target;
 * a Disarmed fighter's reaction attacks are unarmed (R-14.3). Ordered best first (pairs, singles, unarmed).
 */
export function weaponCombos(state: GameState, f: Fighter, targets: readonly Fighter[], role: 'fight' | 'reaction', charge: boolean): string[][] {
  const atReach = targets.some((t) => outOfContact(f, t))
  const disarmed = role === 'reaction' && f.conditions.disarmed !== undefined
  if (disarmed) return atReach ? [] : [[]]
  let pool = meleeWeapons(state, f)
  if (atReach) {
    const need = Math.max(0, ...targets.map((t) => baseGap(f, t)))
    pool = pool.filter((m) => (versatileReach(m.profile) ?? -1) >= need - 1e-9)
  }
  const out: string[][] = []
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!
      const b = pool[j]!
      if (hasTrait(a.profile, T.unwieldy) || hasTrait(b.profile, T.unwieldy)) continue
      out.push([a.weaponId, b.weaponId])
      const n = attackDiceFor(state, f, [a.weaponId, b.weaponId], charge)
      if (n % 2 === 1 && !isSidearm(a.profile) && !isSidearm(b.profile) && a.weaponId !== b.weaponId) out.push([b.weaponId, a.weaponId])
    }
  }
  const seen = new Set<string>()
  for (const m of pool) {
    if (seen.has(m.weaponId)) continue
    seen.add(m.weaponId)
    out.push([m.weaponId])
  }
  if (!atReach) out.push([])
  return out
}

// ---------------------------------------------------------------------------
// Hit modifiers (R-10.6, R-10.7)
// ---------------------------------------------------------------------------

export interface MeleeModifier {
  label: string
  value: number
}

export interface MeleeNeed {
  need: number
  ws: number
  modifiers: MeleeModifier[]
  /** Blind: only a natural 6 hits (R-3.11) */
  sixesOnly: boolean
}

export interface NeedFlags {
  role: 'fight' | 'reaction'
  turned: boolean
  charge: boolean
  unseen: boolean
  entangled: boolean
}

/** R-10.6 / R-10.7: the WS need of one fighter's attacks on one target. */
export function meleeNeedFor(state: GameState, a: Fighter, t: Fighter, flags: NeedFlags): MeleeNeed {
  const k = constants(state).hitModifiers
  const ws = stat(state, a.id, 'WS')
  const mods: MeleeModifier[] = []
  // assists: friends Engaged with the target and no other enemy; interference: other enemies Engaged with the attacker and no other friend
  const assists = friendsOf(state, a).filter((g) => g.engagedWith.includes(t.id) && g.engagedWith.length === 1).length
  const interference = enemiesOf(state, a).filter((e) => e.id !== t.id && a.engagedWith.includes(e.id) && e.engagedWith.length === 1).length
  if (assists) mods.push({ label: 'assist', value: assists * k.assist })
  if (interference) mods.push({ label: 'interference', value: interference * k.interference })
  if (flags.turned) mods.push({ label: 'turnedToFace', value: k.turnedToFace })
  if (flags.charge && flags.unseen) mods.push({ label: 'chargeWithoutSight', value: k.chargeWithoutSight })
  if (flags.role === 'reaction' && isBroken(a)) mods.push({ label: 'brokenReaction', value: k.brokenReaction })
  if (effectsOf(state, 'stoodUpByCharge', (e) => e.fighterId === a.id).length > 0) mods.push({ label: 'stoodUpByCharge', value: k.turnedToFace })
  if (flags.role === 'reaction' && flags.entangled) mods.push({ label: 'entangled', value: ENTANGLE_MODIFIER })
  for (const r of runHook('fight.hitMods', { seat: a.seat, state, fighterId: a.id, targetId: t.id, data: { role: flags.role, charge: flags.charge } })) {
    if (r.delta) mods.push({ label: r.reason ?? 'rule', value: r.delta })
  }
  const need = ws - mods.reduce((n, m) => n + m.value, 0)
  return { need, ws, modifiers: mods, sixesOnly: a.conditions.blind !== undefined }
}

function hits(natural: number, n: MeleeNeed): boolean {
  if (n.sixesOnly) return natural === 6
  return d6TestPasses(natural, n.need)
}

/** Probability that one attack die hits. */
export function meleeHitChance(n: MeleeNeed): number {
  return n.sixesOnly ? 1 / 6 : d6TestChance(n.need)
}

// ---------------------------------------------------------------------------
// Starting a sequence (called by activation.ts)
// ---------------------------------------------------------------------------

/** Enemies a Standing Active fighter can attack at a Versatile weapon's reach: Standing, within reach, in arc and sight. */
export function reachTargets(state: GameState, f: Fighter, weaponId: string): Fighter[] {
  const p = meleeProfile(state, f, weaponId)
  const reach = p ? versatileReach(p) : null
  if (reach === null || f.posture !== 'standing') return []
  return enemiesOf(state, f).filter((e) => e.posture === 'standing' && baseGap(f, e) <= reach + 1e-9 && inVisionArc(f, e) && hasLos(state, f, e))
}

/** The Versatile weapons a Standing Active fighter could Fight with now (R-14.3). */
export function reachFights(state: GameState, f: Fighter): { weaponId: string; targets: string[] }[] {
  const out: { weaponId: string; targets: string[] }[] = []
  const seen = new Set<string>()
  for (const m of meleeWeapons(state, f)) {
    if (seen.has(m.weaponId) || versatileReach(m.profile) === null) continue
    seen.add(m.weaponId)
    const ts = reachTargets(state, f, m.weaponId)
    if (ts.length > 0) out.push({ weaponId: m.weaponId, targets: ts.map((t) => t.id) })
  }
  return out
}

/** The Fight action (R-10.1): against the engaged enemies, or with a Versatile weapon at reach. */
export function startFight(ctx: Ctx, f: Fighter, reachWeapon?: string): void {
  const seq = newSeq(ctx, f.id, { kind: 'pay', fighterId: f.id, action: 'fight', free: [] })
  const targets = reachWeapon ? reachTargets(ctx.state, f, reachWeapon).map((t) => t.id) : []
  seq.stack.push(attackFrame(f.id, 'fight', targets, { reachWeapon: reachWeapon ?? null }))
  pump(ctx)
}

/**
 * The Charge (R-7.6): roll the D3, move M + D3 by the engine's route, stand up contacted Pinned enemies (they take -1 this
 * activation, R-10.2), then the free Fight (+1 attack die), or the free Coup de Grace near a Seriously Injured enemy.
 */
export function startCharge(ctx: Ctx, f: Fighter, targetId: string, weaponId?: string): void {
  const s = ctx.state
  const t = getFighter(s, targetId)
  const act = s.action.activation!
  act.charged = true
  const unseen = enemiesOf(s, f)
    .filter((e) => !(hasLos(s, f, e) && inVisionArc(f, e)))
    .map((e) => e.id)
  const d3 = ctx.roll('charge', 1, 'd3')[0]!
  const allowance = moveAllowance(s, f, true) + d3
  const p = weaponId ? meleeProfile(s, f, weaponId) : null
  const reach = p ? versatileReach(p) : null
  const pinnedBefore = enemiesOf(s, f)
    .filter((e) => e.posture === 'pinned')
    .map((e) => e.id)
  const route = chargeMove(s, f, t, allowance, reach)
  if (route.wps.length > 0) {
    const plan = planMove(s, f, route.wps, { maxInches: allowance, oneInch: 'none' })
    if (plan.ok) applyMove(ctx, f, plan, 'charge', allowance)
  }
  refreshEngagement(ctx)
  for (const id of pinnedBefore) {
    const e = s.fighters[id]!
    if (e.posture === 'standing') addEffect(ctx, { source: 'charge', seat: e.seat, kind: 'stoodUpByCharge', fighterId: e.id, expires: 'activation' })
  }
  const seq = newSeq(ctx, f.id, { kind: 'pay', fighterId: f.id, action: 'charge', free: [] })
  const atReach = reach !== null && route.reached && t.posture === 'standing' && !f.engagedWith.includes(t.id) && baseGap(f, t) <= reach + 1e-6
  if (f.engagedWith.length > 0 || atReach) {
    ;(seq.resume as Extract<Resume, { kind: 'pay' }>).free.push('fight')
    seq.stack.push(
      attackFrame(f.id, 'fight', f.engagedWith.length > 0 ? [] : [t.id], { charge: true, unseen, reachWeapon: f.engagedWith.length > 0 ? null : weaponId! }),
    )
  } else {
    seq.stack.push({ type: 'after', attackerId: f.id, mode: 'charge', engaged: [], stage: 'start' })
  }
  pump(ctx)
}

/** Retreat (R-7.9) or Running for Cover (R-12.4) as the fighter's declared action. */
export function startEscape(ctx: Ctx, f: Fighter, kind: 'retreat' | 'runForCover'): void {
  const seq = newSeq(ctx, f.id, { kind: 'pay', fighterId: f.id, action: kind, free: [] })
  seq.stack.push(escapeFrame(f, kind))
  pump(ctx)
}

function escapeFrame(f: Fighter, kind: EscapeFrame['kind']): EscapeFrame {
  return { type: 'escape', fighterId: f.id, kind, stage: 'start', engaged: false, passed: false, from: [] }
}

/**
 * Resolve the owed nerve tests (and any Running for Cover they cause) before `resume`. With nothing owed, or while another
 * attack sequence is still open, the resume runs at once.
 */
export function settleNerve(ctx: Ctx, resume: Resume): void {
  const s = ctx.state
  if (s.nerve.length === 0 || s.attack) {
    finish(ctx, resume)
    return
  }
  newSeq(ctx, s.nerve[0]!.fighterId, resume)
  pump(ctx)
}

/** apply.afterAction safety net: nerve tests still owed after a step are resolved and the interrupted decision re-raised. */
export function drainNerve(ctx: Ctx): void {
  const s = ctx.state
  if (s.nerve.length === 0 || s.attack || s.phase !== 'action' || !s.pending) return
  settleNerve(ctx, { kind: 'reraise', seat: s.pending.seat })
}

// ---------------------------------------------------------------------------
// Coup de Grace (R-10.11)
// ---------------------------------------------------------------------------

/** Seriously Injured enemies a fighter could finish: within 1" (path), inside its vision arc and in sight. */
export function coupDeGraceTargets(state: GameState, f: Fighter, contactOnly = false): Fighter[] {
  if (f.posture !== 'standing' || f.engagedWith.length > 0) return []
  const radius = constants(state).radii.interact
  return enemiesOf(state, f).filter((e) => {
    if (e.posture !== 'seriouslyInjured') return false
    if (contactOnly) return baseGap(f, e) <= CONTACT_EPS
    return withinPath(state, f, e, radius) && inVisionArc(f, e) && hasLos(state, f, e)
  })
}

/**
 * The target goes Out of Action. A free Coup de Grace on a fighter Seriously Injured earlier in the same activation owes no
 * extra nerve test (R-10.11): the Out of Action tests it queued are dropped.
 */
export function coupDeGrace(ctx: Ctx, f: Fighter, targetId: string, free: boolean): void {
  const s = ctx.state
  const t = getFighter(s, targetId)
  const act = s.action.activation
  const mark = act?.casualtyMark ?? s.casualties.length
  const downedNow = s.casualties.slice(mark).some((c) => c.fighterId === t.id && c.kind === 'seriouslyInjured')
  ctx.emit({ type: 'CoupDeGrace', fighterId: f.id, targetId: t.id }, f.seat)
  takeOutOfAction(ctx, t, f.id, 'coupDeGrace')
  if (free && downedNow) s.nerve = s.nerve.filter((n) => n.reason !== `outOfAction:${t.id}`)
}

// ---------------------------------------------------------------------------
// The pump
// ---------------------------------------------------------------------------

function pump(ctx: Ctx): void {
  const s = ctx.state
  for (let guard = 0; guard < 1000; guard++) {
    const seq = seqOf(s)
    const fr = top(seq)
    if (fr) {
      const waiting = fr.type === 'attack' ? stepAttack(ctx, seq, fr) : fr.type === 'after' ? stepAfter(ctx, seq, fr) : stepEscape(ctx, seq, fr)
      if (waiting) return
      continue
    }
    if (s.nerve.length > 0) {
      drainInto(ctx, seq)
      continue
    }
    s.attack = null
    finish(ctx, seq.resume)
    return
  }
  throw new EngineInvariantError('a close-combat sequence did not settle')
}

/** Take every owed nerve test now; each fighter that breaks makes its Running for Cover next (pushed on top). */
function drainInto(ctx: Ctx, seq: FightSeq): void {
  const s = ctx.state
  const broke: Fighter[] = []
  while (s.nerve.length > 0) {
    const entry = s.nerve.shift()!
    if (takeNerveTest(ctx, entry)) broke.push(getFighter(s, entry.fighterId))
  }
  for (let i = broke.length - 1; i >= 0; i--) seq.stack.push(escapeFrame(broke[i]!, 'runForCover'))
}

function finish(ctx: Ctx, resume: Resume): void {
  const s = ctx.state
  switch (resume.kind) {
    case 'pay': {
      const act = s.action.activation
      if (!act || act.fighterId !== resume.fighterId) {
        resumeFlow(ctx, s.fighters[resume.fighterId]?.seat ?? 'A')
        return
      }
      const f = getFighter(s, resume.fighterId)
      for (const free of resume.free) act.performed.push({ action: free, type: 'free' })
      // a Retreat is a move: the free turn is open again afterwards (R-4.1)
      payAndContinue(ctx, f, resume.action, resume.action === 'retreat' && f.location === 'board' && f.posture === 'standing' && f.engagedWith.length === 0)
      return
    }
    case 'continue':
      continueActivation(ctx)
      return
    case 'reraise':
      resumeFlow(ctx, resume.seat)
      return
    case 'endActivation':
      endActivation(ctx)
      return
    case 'endPhase':
      continueEndPhase(ctx)
      return
  }
}

// ---------------------------------------------------------------------------
// Attack frames
// ---------------------------------------------------------------------------

function standingOnBoard(f: Fighter | undefined): f is Fighter {
  return !!f && f.location === 'board' && f.posture === 'standing'
}

function turnToFace(ctx: Ctx, a: Fighter, toward: Fighter): void {
  const from = a.facing
  a.facing = Math.atan2(toward.pos.x - a.pos.x, toward.pos.z - a.pos.z)
  ctx.emit({ type: 'FighterTurned', fighterId: a.id, from, to: a.facing, free: false }, a.seat)
}

/** The frame's targets once it starts: the engaged (or reached) enemies, turning to face when none is in the arc (R-10.2 ruling). */
function startAttack(ctx: Ctx, fr: AttackFrame): Fighter[] {
  const s = ctx.state
  refreshEngagement(ctx)
  const a = s.fighters[fr.attackerId]
  if (!standingOnBoard(a)) return []
  let candidates: Fighter[]
  if (fr.role === 'reaction') {
    const t = s.fighters[fr.targets[0]!]
    if (!standingOnBoard(t) || a.conditions.blaze) return []
    if (fr.reachWeapon) {
      const p = meleeProfile(s, a, fr.reachWeapon)
      const reach = p ? versatileReach(p) : null
      if (reach === null || baseGap(a, t) > reach + 1e-6) return []
    } else if (!a.engagedWith.includes(t.id)) return []
    candidates = [t]
  } else if (fr.reachWeapon) {
    candidates = fr.targets.map((id) => s.fighters[id]).filter(standingOnBoard)
  } else {
    candidates = a.engagedWith.map((id) => s.fighters[id]).filter(standingOnBoard)
  }
  if (candidates.length === 0) return []
  fr.engaged = candidates.map((c) => c.id)
  const act = s.action.activation
  if (fr.role === 'fight' && act?.fighterId === a.id && act.turnedToFace) fr.turned = true
  let inArc = candidates.filter((t) => inVisionArc(a, t))
  if (inArc.length === 0) {
    const nearest = candidates.reduce((x, y) => (baseGap(a, x) <= baseGap(a, y) ? x : y))
    turnToFace(ctx, a, nearest)
    fr.turned = true
    inArc = candidates.filter((t) => inVisionArc(a, t))
  }
  return inArc
}

function stepAttack(ctx: Ctx, seq: FightSeq, fr: AttackFrame): boolean {
  const s = ctx.state
  if (fr.stage === 'start') {
    const targets = startAttack(ctx, fr)
    if (targets.length === 0) {
      pop(seq)
      return false
    }
    fr.targets = targets.map((t) => t.id)
    const a = getFighter(s, fr.attackerId)
    if (fr.role === 'reaction') ctx.emit({ type: 'ReactionStarted', fighterId: a.id }, a.seat)
    const combos = weaponCombos(s, a, targets, fr.role, fr.charge)
    if (combos.length === 0) {
      pop(seq)
      return false
    }
    if (combos.length === 1) {
      fr.weaponIds = combos[0]!
      fr.stage = 'split'
    } else {
      fr.stage = 'weapons'
      raiseWeapons(ctx, fr, a, combos)
      return true
    }
  }
  if (fr.stage === 'split') {
    const a = getFighter(s, fr.attackerId)
    const n = attackDiceFor(s, a, fr.weaponIds!, fr.charge)
    if (fr.targets.length > 1 && n > 0) {
      fr.stage = 'splitting'
      raiseSplit(ctx, fr, a, n)
      return true
    }
    fr.split = { [fr.targets[0]!]: n }
    fr.stage = 'roll'
  }
  if (fr.stage === 'roll') {
    rollAttack(ctx, seq, fr)
    return false
  }
  throw new EngineInvariantError(`attack frame stuck at ${fr.stage}`)
}

function raiseWeapons(ctx: Ctx, fr: AttackFrame, a: Fighter, combos: string[][]): void {
  const s = ctx.state
  const options: OptionInput[] = combos.map((c) => {
    const n = attackDiceFor(s, a, c, fr.charge)
    return {
      id: c.length ? c.join('+') : 'unarmed',
      labelKey: c.length ? 'fight.weapons' : 'fight.weapons.unarmed',
      type: 'fight.weapons' as const,
      payload: { weaponIds: c },
      data: { dice: n, perWeapon: weaponDice(s, a, c, n) },
    }
  })
  ctx.raise({ kind: 'fight.weapons', seat: a.seat, window: 'fight.weaponsChosen', context: { fighterId: a.id, role: fr.role, targets: fr.targets.slice(), charge: fr.charge }, options })
}

/** All ways to put `n` dice on `k` targets (each may get none), the first target fullest first. */
function compositions(n: number, k: number): number[][] {
  if (k === 1) return [[n]]
  const out: number[][] = []
  for (let first = n; first >= 0; first--) for (const rest of compositions(n - first, k - 1)) out.push([first, ...rest])
  return out
}

function raiseSplit(ctx: Ctx, fr: AttackFrame, a: Fighter, n: number): void {
  const s = ctx.state
  const ts = fr.targets.map((id) => getFighter(s, id))
  const needs = Object.fromEntries(ts.map((t) => [t.id, meleeNeedFor(s, a, t, needFlags(s, seqOf(s), fr, t)).need]))
  const options: OptionInput[] = compositions(n, ts.length).map((c) => {
    const split = Object.fromEntries(ts.map((t, i) => [t.id, c[i]!]))
    return { id: ts.map((t, i) => `${t.id}:${c[i]}`).join(','), labelKey: 'fight.split', type: 'fight.split' as const, payload: { split }, data: { needs } }
  })
  ctx.raise({ kind: 'fight.split', seat: a.seat, window: 'fight.weaponsChosen', context: { fighterId: a.id, dice: n, targets: fr.targets.slice() }, options })
}

function needFlags(state: GameState, seq: FightSeq, fr: AttackFrame, t: Fighter): NeedFlags {
  return { role: fr.role, turned: fr.turned, charge: fr.charge, unseen: fr.unseen.includes(t.id), entangled: seq.entangled.includes(fr.attackerId) }
}

interface RolledDie {
  weaponId: string | null
  profile: RuntimeProfile | null
  targetId: string
  natural: number
  ok: boolean
  rerolled: boolean
}

const UNARMED_DMG = { kind: 'fixed' as const, value: 1 }

function rollAttack(ctx: Ctx, seq: FightSeq, fr: AttackFrame): void {
  const s = ctx.state
  const a = getFighter(s, fr.attackerId)
  const weaponIds = fr.weaponIds ?? []
  const n = attackDiceFor(s, a, weaponIds, fr.charge)
  const perWeapon = weaponDice(s, a, weaponIds, n)
  if (fr.role === 'fight') {
    ctx.emit({ type: 'FightStarted', attackerId: a.id, targets: fr.targets.slice(), weapons: weaponIds.slice(), dice: n, charge: fr.charge }, a.seat)
    ctx.emit({ type: 'AttackDiceSplit', attackerId: a.id, split: { ...fr.split! } }, a.seat)
  }
  // the weapon dice, in order, go to the targets in order of the split
  const tokens: (string | null)[] = []
  for (const w of perWeapon) for (let i = 0; i < w.dice; i++) tokens.push(w.weaponId)
  const groups: { weaponId: string | null; targetId: string; dice: number }[] = []
  let at = 0
  for (const targetId of fr.targets) {
    const k = fr.split?.[targetId] ?? 0
    for (let i = 0; i < k && at < tokens.length; i++, at++) {
      const w = tokens[at]!
      const g = groups.find((x) => x.weaponId === w && x.targetId === targetId)
      if (g) g.dice++
      else groups.push({ weaponId: w, targetId, dice: 1 })
    }
  }
  // (5) hit rolls, one roll per weapon and target; sidearms roll a Firepower dice each (R-10.4)
  const rolled: RolledDie[] = []
  const ammoFails: string[] = []
  for (const g of groups) {
    const t = getFighter(s, g.targetId)
    const p = g.weaponId ? meleeProfile(s, a, g.weaponId) : null
    const need = meleeNeedFor(s, a, t, needFlags(s, seq, fr, t))
    const dice = ctx.roll('hit', g.dice)
    ctx.emit({ type: 'FightHitRolled', weaponId: g.weaponId ?? 'unarmed', targetId: t.id, dice: dice.slice(), need: need.sixesOnly ? 6 : need.need, modifiers: need.modifiers }, a.seat)
    for (const d of dice) rolled.push({ weaponId: g.weaponId, profile: p, targetId: t.id, natural: d, ok: hits(d, need), rerolled: false })
    if (p && isSidearm(p) && p.ammo !== null) {
      for (let i = 0; i < g.dice; i++) {
        const face = firepowerFace(s, ctx.roll('firepower', 1, 'firepower')[0]!)
        if (!face.ammo) continue
        const roll = ctx.roll('ammo', 1)[0]!
        const passed = roll >= p.ammo
        ctx.emit({ type: 'AmmoTest', fighterId: a.id, weaponId: g.weaponId!, roll, need: p.ammo, passed, result: passed ? 'passed' : 'failed' }, a.seat)
        if (!passed) ammoFails.push(g.weaponId!)
      }
    }
  }
  // Parry (R-10.9): each defender forces one successful hit to be re-rolled (two with two Parry weapons)
  for (const targetId of fr.targets) parry(ctx, seq, fr, a, getFighter(s, targetId), rolled)
  // (6) resolve the hits
  for (const r of rolled) {
    if (!r.ok) continue
    const t = s.fighters[r.targetId]!
    if (t.location !== 'board') continue
    resolveHit(ctx, meleeHit(s, a, t, r))
  }
  // natural-6 effects on the targets still in the fight
  for (const r of rolled) {
    if (!r.ok || r.natural !== 6 || !r.profile) continue
    const t = s.fighters[r.targetId]!
    if (t.location !== 'board') continue
    if (hasTrait(r.profile, T.disarm)) setCondition(ctx, t, 'disarmed', r.weaponId!)
    if (hasTrait(r.profile, T.entangle) && !seq.entangled.includes(t.id)) seq.entangled.push(t.id)
  }
  for (const id of new Set(ammoFails)) {
    for (const wid of linkedWeaponIds(a, id)) {
      const fw = a.weapons.find((w) => w.weaponId === wid)
      if (!fw || fw.ammo !== 'ok') continue
      fw.ammo = 'out'
      ctx.emit({ type: 'WeaponStateChanged', fighterId: a.id, weaponId: wid, ammo: 'out' }, a.seat)
    }
  }
  refreshEngagement(ctx)
  pop(seq)
  if (fr.role === 'fight') {
    seq.stack.push({ type: 'after', attackerId: a.id, mode: 'fight', engaged: fr.engaged.slice(), stage: 'start' })
    pushReactions(s, seq, fr, a)
  }
  drainInto(ctx, seq)
}

/** R-10.8: every enemy still Standing and Engaged with the attacker strikes back (a Versatile target only with Versatile reach). */
function pushReactions(state: GameState, seq: FightSeq, fr: AttackFrame, a: Fighter): void {
  if (!standingOnBoard(a)) return
  const frames: AttackFrame[] = []
  for (const e of enemiesOf(state, a).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!standingOnBoard(e) || e.conditions.blaze) continue
    if (a.engagedWith.includes(e.id)) {
      frames.push(attackFrame(e.id, 'reaction', [a.id]))
      continue
    }
    if (!fr.reachWeapon || !fr.engaged.includes(e.id)) continue
    const gap = baseGap(e, a)
    const w = meleeWeapons(state, e).find((m) => (versatileReach(m.profile) ?? -1) >= gap - 1e-9)
    if (w) frames.push(attackFrame(e.id, 'reaction', [a.id], { reachWeapon: w.weaponId }))
  }
  for (let i = frames.length - 1; i >= 0; i--) seq.stack.push(frames[i]!)
}

function parry(ctx: Ctx, seq: FightSeq, fr: AttackFrame, a: Fighter, t: Fighter, rolled: RolledDie[]): void {
  const s = ctx.state
  const parryWeapons = t.weapons
    .map((fw) => s.data.weapons[fw.weaponId])
    .filter((w): w is NonNullable<typeof w> => !!w && w.profiles.some((p) => hasTrait(p, T.parry)))
  let uses = Math.min(2, parryWeapons.length)
  if (uses === 0) return
  const powerParry = parryWeapons.some((w) => w.profiles.some((p) => hasTrait(p, T.parry) && hasTrait(p, T.power)))
  while (uses > 0) {
    const eligible = rolled.filter(
      (r) => r.ok && !r.rerolled && r.targetId === t.id && !(r.profile && hasTrait(r.profile, T.entangle)) && (!(r.profile && hasTrait(r.profile, T.power)) || powerParry),
    )
    if (eligible.length === 0) return
    // the defender takes away the most dangerous hit: a Power hit first, then the highest Damage
    const pick = eligible.reduce((x, y) => (danger(y) > danger(x) ? y : x))
    const roll = ctx.roll('parry', 1)[0]!
    pick.natural = roll
    pick.rerolled = true
    pick.ok = hits(roll, meleeNeedFor(s, a, t, needFlags(s, seq, fr, t)))
    ctx.emit({ type: 'Parried', by: t.id, rerolled: [roll] }, t.seat)
    uses--
  }
}

function danger(r: RolledDie): number {
  if (!r.profile) return 0
  const dmg = r.profile.dmg.kind === 'fixed' ? r.profile.dmg.value : r.profile.dmg.kind === 'dice' ? 2 : 0
  return (hasTrait(r.profile, T.power) ? 10 : 0) + dmg
}

/** One successful close-combat hit as hits.ts input: Backstab +1 S from outside the target's arc; Power and Shock on a natural 6. */
function meleeHit(state: GameState, a: Fighter, t: Fighter, r: RolledDie): HitInput {
  const S = stat(state, a.id, 'S')
  const p = r.profile
  const backstab = !!p && hasTrait(p, T.backstab) && !inVisionArc(t, a)
  const power6 = !!p && hasTrait(p, T.power) && r.natural === 6
  const shock6 = !!p && hasTrait(p, T.shock) && r.natural === 6
  return {
    attackerId: a.id,
    targetId: t.id,
    weaponId: r.weaponId,
    strength: (p ? profileStrength(p, S) : S) + (backstab ? 1 : 0),
    ap: p?.ap ?? 0,
    damage: p?.dmg ?? UNARMED_DMG,
    traits: p?.traits ?? [],
    hitRoll: r.natural,
    knockFrom: centre(a),
    melta: !!p && meltaApplies(p, baseGap(a, t), profileRanges(p, S).short),
    saveVs: null,
    coverBonus: 0,
    from: centre(a),
    saves: !power6,
    cause: r.weaponId ?? 'unarmed',
    ...(shock6 ? { autoWound: true } : {}),
    ...(power6 ? { extraDamage: 1 } : {}),
    followUp: a.id,
    closeCombat: true,
  }
}

// ---------------------------------------------------------------------------
// After the attack: consolidate or Coup de Grace (R-10.10), the free Coup de Grace after a Charge (R-7.6)
// ---------------------------------------------------------------------------

function stepAfter(ctx: Ctx, seq: FightSeq, fr: AfterFrame): boolean {
  const s = ctx.state
  if (fr.stage !== 'start') throw new EngineInvariantError(`after frame stuck at ${fr.stage}`)
  refreshEngagement(ctx)
  const a = s.fighters[fr.attackerId]
  if (!standingOnBoard(a) || a.engagedWith.length > 0) {
    pop(seq)
    return false
  }
  let cdg: Fighter[]
  if (fr.mode === 'fight') {
    const allDown = fr.engaged.every((id) => {
      const e = s.fighters[id]
      return !e || e.location !== 'board' || e.posture === 'seriouslyInjured'
    })
    if (!allDown) {
      pop(seq)
      return false
    }
    cdg = coupDeGraceTargets(s, a, true)
  } else {
    cdg = coupDeGraceTargets(s, a)
    if (cdg.length === 0) {
      pop(seq)
      return false
    }
  }
  const options: OptionInput[] = cdg.map((t) => ({ id: `cdg:${t.id}`, labelKey: 'fight.after.coupDeGrace', type: 'fight.after' as const, payload: { choice: 'coupDeGrace' as const, targetId: t.id } }))
  if (fr.mode === 'fight') options.push({ id: 'consolidate', labelKey: 'fight.after.consolidate', type: 'fight.after', payload: { choice: 'consolidate' }, data: { maxInches: CONSOLIDATE_INCHES } })
  options.push({ id: 'none', labelKey: 'fight.after.none', type: 'fight.after', payload: { choice: 'none' } })
  fr.stage = 'choose'
  ctx.raise({ kind: 'fight.after', seat: a.seat, window: 'fight.resolved', context: { fighterId: a.id, mode: fr.mode }, options })
  return true
}

// ---------------------------------------------------------------------------
// Escapes: Retreat (R-7.9) and Running for Cover (R-12.4)
// ---------------------------------------------------------------------------

function initiativeTest(ctx: Ctx, f: Fighter, reason: string): boolean {
  const need = stat(ctx.state, f.id, 'I')
  const roll = ctx.roll('initiative', 1)[0]!
  const passed = d6TestPasses(roll, need)
  ctx.emit({ type: 'InitiativeTest', fighterId: f.id, roll, need, passed, reason }, f.seat)
  return passed
}

function stepEscape(ctx: Ctx, seq: FightSeq, fr: EscapeFrame): boolean {
  const s = ctx.state
  const f = s.fighters[fr.fighterId]
  if (!f || f.location !== 'board') {
    pop(seq)
    return false
  }
  if (fr.stage === 'start') {
    refreshEngagement(ctx)
    if (fr.kind === 'runForCover') ctx.emit({ type: 'RunningForCover', fighterId: f.id }, f.seat)
    fr.engaged = f.posture === 'standing' && f.engagedWith.length > 0
    fr.stage = 'move'
    if (!fr.engaged) {
      fr.passed = true
      return false
    }
    fr.from = f.engagedWith.slice()
    fr.passed = initiativeTest(ctx, f, fr.kind)
    // whether or not it passed, each engaged enemy may pass an I test to make reaction attacks against it
    const frames: AttackFrame[] = []
    for (const id of f.engagedWith) {
      const e = s.fighters[id]
      if (!standingOnBoard(e) || e.conditions.blaze) continue
      if (initiativeTest(ctx, e, `reaction:${fr.kind}`)) frames.push(attackFrame(e.id, 'reaction', [f.id]))
    }
    for (let i = frames.length - 1; i >= 0; i--) seq.stack.push(frames[i]!)
    return false
  }
  if (fr.stage === 'move') {
    if (!fr.passed || (fr.engaged && f.posture !== 'standing')) {
      pop(seq)
      return false
    }
    const k = constants(s)
    if (fr.kind === 'runForCover') {
      const prone = f.posture !== 'standing'
      const allowance = prone ? halfMove(s, f) : rollExpr(ctx, 'runForCover', k.runForCover.moveDice)
      const pick = runForCoverPick(s, f, allowance)
      if (pick.wps.length > 0) {
        const plan = planMove(s, f, pick.wps, { maxInches: allowance, oneInch: 'enemy' })
        if (plan.ok) applyMove(ctx, f, plan, 'runForCover', allowance)
      }
      refreshEngagement(ctx)
      pop(seq)
      return false
    }
    const distance = rollExpr(ctx, 'retreat', isBroken(f) ? k.retreat.brokenMoveDice : k.retreat.moveDice)
    const sug = retreatSuggestion(s, f, distance)
    if (!sug) {
      // R-7.9 ruling: no end point clear of every enemy: as far as possible straight away from the nearest engaging enemy
      const near = fr.from.map((id) => s.fighters[id]).filter((e): e is Fighter => !!e && e.location === 'board')
      const e = near.length ? near.reduce((x, y) => (baseGap(f, x) <= baseGap(f, y) ? x : y)) : null
      if (e) {
        const dx = f.pos.x - e.pos.x
        const dz = f.pos.z - e.pos.z
        const d = Math.hypot(dx, dz) || 1
        const to = slide(s, f, dx / d, dz / d, distance)
        if (Math.hypot(to.x - f.pos.x, to.z - f.pos.z) > 0) placeAlong(ctx, f, 'retreat', to, distance, Math.atan2(dx, dz))
      }
      refreshEngagement(ctx)
      pop(seq)
      return false
    }
    fr.stage = 'moving'
    ctx.raise({
      kind: 'move.path',
      seat: f.seat,
      window: 'action.declared',
      context: { fighterId: f.id, kind: 'retreat', maxInches: distance, obstacleCost: k.obstacle.height, suggestion: sug.wps.map((p) => ({ ...p })) },
      constraints: { kind: 'retreat', fighterId: f.id, origin: { ...f.pos }, baseRadius: f.baseRadius, maxInches: distance, oneInch: 'enemy' },
      canPass: false,
    })
    return true
  }
  throw new EngineInvariantError(`escape frame stuck at ${fr.stage}`)
}

/** movement.ts: a Retreat or Consolidate path was answered (or the consolidate declined); carry on with the sequence. */
export function resumeAfterMove(ctx: Ctx, f: Fighter, kind: 'retreat' | 'consolidate'): void {
  const seq = seqOf(ctx.state)
  const fr = top(seq)
  if (!fr || fr.stage !== 'moving') throw new EngineInvariantError(`no ${kind} move is pending`)
  if (kind === 'consolidate') ctx.emit({ type: 'Consolidated', fighterId: f.id }, f.seat)
  refreshEngagement(ctx)
  pop(seq)
  pump(ctx)
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function handle(state: GameState, action: Action, pending: PendingDecision): Handled {
  if (!state.attack || state.attack.kind !== 'fight') return reject('E_WRONG_DECISION', 'no close-combat sequence is in progress')
  if (action.type === 'pass') return reject('E_PASS_NOT_ALLOWED', 'close-combat choices cannot be passed')
  switch (action.type) {
    case 'fight.weapons': {
      const ids = action.payload.weaponIds
      return {
        run(ctx) {
          const seq = seqOf(ctx.state)
          const fr = top(seq) as AttackFrame
          fr.weaponIds = ids.slice()
          fr.stage = 'split'
          pump(ctx)
        },
      }
    }
    case 'fight.split': {
      const split = action.payload.split
      return {
        run(ctx) {
          const seq = seqOf(ctx.state)
          const fr = top(seq) as AttackFrame
          fr.split = { ...split }
          fr.stage = 'roll'
          pump(ctx)
        },
      }
    }
    case 'fight.after': {
      const p = action.payload
      return {
        run(ctx) {
          const s = ctx.state
          const seq = seqOf(s)
          const fr = top(seq) as AfterFrame
          const a = getFighter(s, fr.attackerId)
          if (p.choice === 'coupDeGrace' && p.targetId) {
            coupDeGrace(ctx, a, p.targetId, true)
            if (seq.resume.kind === 'pay' && seq.resume.fighterId === a.id) seq.resume.free.push('coupDeGrace')
          } else if (p.choice === 'consolidate') {
            fr.stage = 'moving'
            ctx.raise({
              kind: 'move.path',
              seat: a.seat,
              window: 'fight.resolved',
              context: { fighterId: a.id, kind: 'consolidate', maxInches: CONSOLIDATE_INCHES, obstacleCost: constants(s).obstacle.height },
              constraints: { kind: 'consolidate', fighterId: a.id, origin: { ...a.pos }, baseRadius: a.baseRadius, maxInches: CONSOLIDATE_INCHES, oneInch: 'enemy' },
              canPass: true,
            })
            return
          }
          pop(seq)
          pump(ctx)
        },
      }
    }
    default:
      return reject('E_WRONG_DECISION', `expected ${pending.kind}, got ${action.type}`)
  }
}

export const fightModule: ModuleDef = {
  id: 'fight',
  namespaces: ['fight'],
  handle,
}

// ---------------------------------------------------------------------------
// Charge targets (query.chargeTargets)
// ---------------------------------------------------------------------------

export interface ChargeTarget {
  targetId: string
  /** set for a charge that stops at this Versatile weapon's reach */
  weaponId?: string
  /** inches the charge needs (path plus obstacle crossings) */
  cost: number
  /** chance that M + D3 covers it */
  pReach: number
  /** in line of sight and the vision arc now (otherwise -1 to hit in the free Fight, R-10.6) */
  visible: boolean
  distance: number
}

/** Probability that M + D3 >= cost. */
export function reachChance(m: number, cost: number): number {
  if (!Number.isFinite(cost)) return 0
  let n = 0
  for (let d = 1; d <= 3; d++) if (m + d >= cost - LENGTH_TOLERANCE) n++
  return n / 3
}

/**
 * Enemies a Standing Active fighter can charge with some chance of reaching (R-7.6): base contact by the engine's route, and
 * for each Versatile weapon a stop at its reach (Standing targets). Line of sight is not needed (the free Fight is then at -1).
 */
export function chargeTargets(state: GameState, f: Fighter): ChargeTarget[] {
  if (f.location !== 'board' || f.posture !== 'standing' || f.engagedWith.length > 0) return []
  const m = moveAllowance(state, f, true)
  const reachWeapons = meleeWeapons(state, f).filter((w) => versatileReach(w.profile) !== null)
  const out: ChargeTarget[] = []
  for (const e of enemiesOf(state, f)) {
    const distance = baseGap(f, e)
    if (distance > m + 3 + 0.05) continue
    const visible = hasLos(state, f, e) && inVisionArc(f, e)
    const cost = chargeCost(state, f, e)
    const p = reachChance(m, cost)
    if (p > 0) out.push({ targetId: e.id, cost, pReach: p, visible, distance })
    if (e.posture !== 'standing') continue
    const seen = new Set<string>()
    for (const w of reachWeapons) {
      if (seen.has(w.weaponId)) continue
      seen.add(w.weaponId)
      const reach = versatileReach(w.profile)!
      if (distance <= reach) continue // already within reach: a Fight, not a Charge
      const c = chargeCost(state, f, e, reach)
      const pr = reachChance(m, c)
      if (pr > 0) out.push({ targetId: e.id, weaponId: w.weaponId, cost: c, pReach: pr, visible, distance })
    }
  }
  return out
}
