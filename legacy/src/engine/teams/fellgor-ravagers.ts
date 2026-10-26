// Fellgor Ravagers (docs/spec/13-teams.md section 19, rule ids T-FG.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - FRENZY (T-FG.29 to T-FG.32) is the spine. Gain: `beforeIncapacitated` keeps the operative on 1 wound, gives it the
//    `fg.frenzy` token, discards the remaining dice (a fight's dice are marked used; a Shoot's later damage is cut by a
//    per-action effect) and scores it as incapacitated (kills.scoreAsIncapacitated). While frenzied: providers (`orders`,
//    `injuredEquivalent`, `actionForbidden`, `controlApl`, `flags`) and ONE `onDamageInflicted` handler that runs War Gong,
//    then Toxic Blessings, then the Frenzy filter in that fixed order. Death: `activation.end`, `counteraction.end` (when
//    the counteraction performed an action) and the last `turningPoint.end` kill it through a flagged `directDamage`.
//  - Weapon-rule changes (Pelting Firepower, Vicious Blows, Toxic Blessings' Shock, Chaos Sigil) all live in the one
//    `modifyWeaponRules` handler so their order is fixed.
//  - Cleaver Flurry rides the shared move.path decision as a Fall Back path (it may pass through enemy control ranges and
//    may not end in one) with +2 inches from `moveLimitDelta` while its effect is live.
//  - Pox Bomb is a team copy of the core Stun Grenade action that also deals the extra damage.
//  - Strategy ploys that only flag a rule (Violent Temperament, Ambush, Pelting Firepower, Reckless Determination) share the
//    `fgFlagPloy` hook; their free uses are 0 CP pseudo ploys offered by the ploy rule at the window they act in.
import { applyAplEffect, eligibleDice, forcedReroll, hasRule, parseRules, registerFixedDieTag, effectiveRules, ruleKey, weaponDamage } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { allowedOrders } from '../abilities'
import { hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { grenadeSource, visibleEnemiesWithin } from '../core-hooks'
import { addEffect, addTpUse, addUse, aplChangeNextActivation, directDamage, markUsedBattle, markUsedTp, regainWounds, removeEffects, spendCp, usedThisBattle, usedThisTp, usesOf } from '../effects'
import { canStartFreeAction, cancelAction, finishAction, REACTION_DONE, reactionDone, startFreeAction } from '../firefight'
import { fightAvailability } from '../fight'
import { moveConstraints } from '../movement'
import { registerFrameResume, registerHook, type BeforeIncapacitatedData } from '../hooks'
import { scoreAsIncapacitated, killsSince } from '../kills'
import { bodyOf, targetVerdict, visible } from '../los'
import { distanceBetween, enemiesInControlRange, inControlRange } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { offersFor } from '../ploys'
import type { Ctx } from '../registry'
import { activeOps, enemiesOf, hasInjuredPenalty, otherSeat } from '../state'
import { TURNING_POINTS, resumeGambit } from '../strategy'
import { registerTeamRules, type ReactionInfo, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, tokensOn } from '../tokens'
import { psychicAllowed } from '../psychic'
import type { AttackDie, DiceSide, GameState, Operative, Order, Seat, WeaponRuleRef } from '../types'

export const TEAM_ID = 'fellgor-ravagers'

const FG = 'FELLGOR RAVAGER'
const EPS = 1e-6

const A = (id: string) => `fg.a.${id}`
const P = (id: string) => `fg.p.${id}`
const E = (id: string) => `fg.e.${id}`
const ABILITY = (id: string) => `ability:${id}`

const STUN = 'core.a.stun-grenade'

export const FRENZY = 'fg.frenzy'
const FX_CUT = 'fg.frenzyCut'
const FX_KILL = 'fg.frenzyKill'
const FX_SHOT_NORMALS = 'fg.shotNormals'
const FX_FLURRY = 'fg.flurry'
const FX_GONG = 'fg.gongKnell'
const FX_MANTLE = 'fg.mantle'
const FX_WILD = 'fg.wildRage'
const FX_AMBUSH = 'fg.ambush'
const FX_FURY = 'fg.furyArmed'
const FX_TACTUAL = 'fg.tactualUsed'
const FX_TACTUAL_PENDING = 'fg.tactualPending'
const FX_BLOOD = 'fg.bloodsense'
const FX_SIGIL = 'fg.sigil'

const VT = P('violent-temperament')
const AMBUSH = P('ambush')
const PELTING = P('pelting-firepower')
const RECKLESS = P('reckless-determination')
const WILD_RAGE = P('wild-rage')
const RAMPAGE = P('ruthless-rampage')
const FURY = P('animalistic-fury')

// pseudo ploy ids of the 0 CP offers (never ploy records, so a free use never touches the strategy ploy)
const X_VT = 'fg.x.violent-temperament'
const X_SAGACIOUS = 'fg.x.sagacious'
const X_SAVAGE = 'fg.x.savage'
const X_RAMPAGE = 'fg.x.rampageUsed'
const GORE = E('gore-marks')
const SIGIL = E('chaos-sigil')
const BRASS = E('brass-adornments')
const WAR_PAINT = E('war-paint')

const SKULLCLEAVER = 'fg.w.skullcleaver'
const RECKLESS_TAG = 'fg.reckless'
registerFixedDieTag(RECKLESS_TAG)
registerFixedDieTag(FX_AMBUSH)

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game.
for (const name of [
  'fgFrenzy',
  'fgIconBearer',
  'fgWarGong',
  'fgBladeWhirl',
  'fgSagacious',
  'fgChampion',
  'fgHeadtaker',
  'fgWhipControl',
  'fgTactualHunter',
  'fgBerserker',
  'fgSavage',
  'fgToxicBlessings',
  'fgViciousBlows',
  'fgWarriorFrenzy',
  'fgBrassAdornments',
  'fgGoreMarks',
  'fgChaosSigil',
  'fgWarPaint',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function isFg(state: GameState, op: Operative | undefined): op is Operative {
  return !!op && hasKeyword(state, op, FG)
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

/** The operative holds one of its owner's Frenzy tokens (T-FG.5). */
export function isFrenzied(state: GameState, op: Operative | undefined): boolean {
  return !!op && op.status === 'active' && hasToken(state, op.id, FRENZY, op.seat)
}

function fgOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isFg(state, o))
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

function gap(a: Operative, b: Operative): number {
  return distanceBetween(bodyOf(a), bodyOf(b))
}

function within(a: Operative, b: Operative, inches: number): boolean {
  return gap(a, b) <= inches + EPS
}

function sees(state: GameState, a: Operative, b: Operative): boolean {
  return a.id === b.id || visible(state, bodyOf(a), bodyOf(b))
}

function warrior(state: GameState, op: Operative): boolean {
  return state.data.datacards[op.datacardId]?.id === 'fg.warrior'
}

function sideOf(state: GameState, opId: string): DiceSide | null {
  const seq = state.attack?.seq
  if (!seq) return null
  if (seq.atk.operativeId === opId && seq.atk.weaponId) return seq.atk
  if (seq.def && seq.def.operativeId === opId) return seq.def
  return null
}

function liveOn(dice: AttackDie[], kind: AttackDie['kind']): AttackDie[] {
  return dice.filter((d) => d.kind === kind && !d.used)
}

/** The activation the action in progress belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState) {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

const opt = (id: string, labelKey: string, data: Record<string, unknown> = {}) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, data })

function d3(r: number): number {
  return Math.ceil(r / 2)
}

function setOrder(ctx: Ctx, op: Operative, order: Order): void {
  if (op.order === order) return
  if (op.flags.guard) {
    op.flags.guard = false
    ctx.emit({ type: 'GuardCleared', operativeId: op.id, reason: 'order' }, op.seat)
  }
  op.order = order
  ctx.emit({ type: 'OrderSet', operativeId: op.id, order })
}

// ---------------------------------------------------------------------------
// FRENZY: gaining it (T-FG.29, T-FG.32)
// ---------------------------------------------------------------------------

/** An enemy fighter's kill in a fight (Apoplectic Rejuvenation's 6 wounds, Headtaker). */
function fightKill(ctx: Ctx, attacker: Operative, weaponId: string | null): void {
  markUsedBattle(ctx.state, attacker.seat, `fg.fightKill:${attacker.id}`)
  if (weaponId === SKULLCLEAVER) headtaker(ctx, attacker)
}

function headtaker(ctx: Ctx, killer: Operative): void {
  const [r] = ctx.roll('fg.headtaker.d3', 1)
  const n = d3(r!)
  if (!isFrenzied(ctx.state, killer)) regainWounds(ctx, killer.id, n, A('wr-headtaker'))
  addUse(ctx.state, killer.seat, `fg.headtaker:${killer.id}`, n)
  markFired('fgHeadtaker')
  ctx.emit({ type: 'AbilityUsed', operativeId: killer.id, abilityId: A('wr-headtaker'), detail: String(n) }, killer.seat)
}

registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !isFg(s, op) || op.status !== 'active' || isFrenzied(s, op)) return null
    const data = c.data as unknown as BeforeIncapacitatedData
    data.wounds = 1
    const attacker = c.targetId ? s.operatives[c.targetId] : undefined
    addToken(ctx, op.id, { kind: FRENZY, owner: op.seat, cap: 1, data: { strikes: 0 } }, 'fg.frenzy')
    setOrder(ctx, op, 'engage')
    // every remaining attack die of the sequence is discarded (T-FG.29)
    const a = s.attack
    if (a?.kind === 'fight' && a.seq) {
      const fighters = [a.seq.atk.operativeId, a.seq.def?.operativeId]
      if (fighters.includes(op.id)) {
        for (const d of a.seq.atk.dice) d.used = true
        for (const d of a.seq.def?.dice ?? []) d.used = true
      }
    } else if (a?.kind === 'shoot' && a.seq?.targetId === op.id) {
      addEffect(ctx, { source: FX_CUT, seat: op.seat, kind: FX_CUT, operativeId: op.id, expires: 'action', data: { index: a.index } })
      if (a.seq.unblocked) {
        a.seq.unblocked.normal = 0
        a.seq.unblocked.crit = 0
      }
    }
    const foe = attacker && attacker.seat !== op.seat ? attacker : undefined
    // the enemy that struck it in a fight counts an incapacitation for its own rules (Apoplectic Rejuvenation, Headtaker);
    // scoreAsIncapacitated below logs the kill (cause `scored`), which Bloodsense reads
    if (foe && isFg(s, foe) && data.source.startsWith('strike-')) fightKill(ctx, foe, data.weaponId)
    scoreAsIncapacitated(ctx, op.id, foe?.id)
    markFired('fgFrenzy')
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('frenzy'), detail: foe?.id ?? '' }, op.seat)
    return null
  },
  'fg.beforeIncapacitated',
)

registerHook(
  'damage.inflicted',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const attacker = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !ctx || !victim || !isFg(s, attacker) || attacker.seat === victim.seat) return null
    const d = c.data as unknown as { source: string; woundsBefore: number; woundsAfter: number; weaponId: string | null }
    // a frenzied Fellgor was counted when it gained the token
    if (d.woundsBefore <= 0 || d.woundsAfter > 0 || isFrenzied(s, victim)) return null
    if (d.source.startsWith('strike-')) fightKill(ctx, attacker, d.weaponId)
    return null
  },
  'fg.damage.inflicted',
)

// ---------------------------------------------------------------------------
// Damage taken: War Gong, Toxic Blessings, then the Frenzy filter (T-FG.9, T-FG.24, T-FG.31)
// ---------------------------------------------------------------------------

/** A Deathknell that is not frenzied and within 3" of `op` (itself included), or null (T-FG.9). */
function gongFor(s: GameState, op: Operative): Operative | null {
  for (const g of fgOps(s, op.seat)) {
    if (!hasAbility(s, g, A('war-gong')) || isFrenzied(s, g)) continue
    if (g.id === op.id || within(g, op, 3)) return g
  }
  return null
}

function frenzyToken(s: GameState, op: Operative) {
  return tokensOn(s, op.id).find((t) => t.kind === FRENZY && t.owner === op.seat)
}

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !isFg(s, op)) return null
    const d = c.data as { source: string; attackerId: string; weaponId: string | null; amount: number }
    const a = s.attack
    let asNormal = false
    // 1. WAR GONG: a die that would deal Critical Dmg deals Normal Dmg instead when that is not more (automatic)
    if ((d.source === 'crit' || d.source === 'strike-crit') && d.amount > 0 && d.weaponId && gongFor(s, op)) {
      const kind = d.source === 'crit' ? 'shoot' : 'fight'
      const normal = weaponDamage(s, d.attackerId, d.weaponId, op.id, kind).normal
      const frenzied = isFrenzied(s, op)
      if (normal < d.amount || (kind === 'shoot' && frenzied && normal <= d.amount)) {
        d.amount = normal
        asNormal = kind === 'shoot'
        markFired('fgWarGong')
      }
    }
    // 2. TOXIC BLESSINGS: Normal Dmg of 3 or more, a D6 of 5+ takes 1 off
    if ((d.source === 'normal' || d.source === 'strike-normal') && d.amount >= 3 && hasAbility(s, op, A('toxic-blessings'))) {
      const [r] = ctx.roll('fg.toxic', 1)
      if (r! >= 5) {
        d.amount -= 1
        markFired('fgToxicBlessings')
      }
    }
    // 3. FRENZY: only the six conditions of T-FG.31 hurt a frenzied operative
    if (!isFrenzied(s, op) || d.amount <= 0) return null
    if (s.effects.some((e) => e.kind === FX_KILL && e.operativeId === op.id)) return null
    const shoot = d.source === 'normal' || d.source === 'crit'
    if (shoot && s.effects.some((e) => e.kind === FX_CUT && e.operativeId === op.id && e.data?.index === a?.index)) {
      d.amount = 0
      return null
    }
    const normalsInSequence = (): number => {
      const index = a?.index ?? 0
      let fx = s.effects.find((e) => e.kind === FX_SHOT_NORMALS && e.operativeId === op.id && e.data?.index === index)
      if (!fx) fx = addEffect(ctx, { source: FX_SHOT_NORMALS, seat: op.seat, kind: FX_SHOT_NORMALS, operativeId: op.id, expires: 'action', data: { index, n: 0 } })
      fx.data = { ...(fx.data ?? {}), n: Number(fx.data?.n ?? 0) + 1 }
      return Number(fx.data.n)
    }
    let lethal = false
    if (d.source === 'strike-crit') lethal = true
    else if (d.source === 'strike-normal') {
      const t = frenzyToken(s, op)
      if (t) {
        t.data = { ...(t.data ?? {}), strikes: Number(t.data?.strikes ?? 0) + 1 }
        lethal = Number(t.data.strikes) >= 2
      }
    } else if (d.source === 'crit') lethal = asNormal ? normalsInSequence() >= 2 : true
    else if (d.source === 'normal') lethal = normalsInSequence() >= 2
    d.amount = lethal ? Math.max(d.amount, op.wounds) : 0
    return null
  },
  'fg.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// FRENZY: dying (T-FG.31 a, f)
// ---------------------------------------------------------------------------

/** Kill a frenzied operative outright: the damage handler lets it through while the effect stands. */
function killFrenzied(ctx: Ctx, op: Operative): void {
  if (!isFrenzied(ctx.state, op)) return
  addEffect(ctx, { source: FX_KILL, seat: op.seat, kind: FX_KILL, operativeId: op.id, expires: 'activation' })
  directDamage(ctx, op.id, Math.max(1, op.wounds), op.id, 'fg.frenzy')
  removeEffects(ctx, (e) => e.kind === FX_KILL && e.operativeId === op.id)
}

registerHook(
  'activation.end',
  (c) => {
    const ctx = c.engine
    const op = ctx && c.operativeId ? ctx.state.operatives[c.operativeId] : undefined
    if (ctx && op && isFg(ctx.state, op)) killFrenzied(ctx, op)
    return null
  },
  'fg.activation.end',
)

// A frenzied operative dies when its counteraction ends (counteraction.end). A counteraction ended without any action
// was declined (counteracting is the action itself), so the operative lives on.
registerHook(
  'counteraction.end',
  (c) => {
    const ctx = c.engine
    const s = ctx?.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as { performed: string[]; removed: boolean }
    if (!ctx || !s || !op || d.removed || d.performed.length === 0 || !isFg(s, op) || !isFrenzied(s, op)) return null
    killFrenzied(ctx, op)
    return null
  },
  'fg.counteraction.end',
)

registerHook(
  'turningPoint.end',
  (c) => {
    const ctx = c.engine
    if (!ctx || (c.data as { turningPoint: number }).turningPoint < TURNING_POINTS) return null
    for (const o of activeOps(ctx.state)) if (isFg(ctx.state, o) && isFrenzied(ctx.state, o)) killFrenzied(ctx, o)
    return null
  },
  'fg.turningPoint.end',
)

// ---------------------------------------------------------------------------
// Whip Control (T-FG.17)
// ---------------------------------------------------------------------------

/** The Herd-Goad whipping `enemy`: it sees it within 3" and no enemy other than `enemy` is in its control range. */
function whipper(s: GameState, enemy: Operative): Operative | null {
  // asked for every operative of every team: skip the search unless the other seat is Fellgor Ravagers
  if (s.players[otherSeat(enemy.seat)].teamId !== TEAM_ID) return null
  for (const g of fgOps(s, otherSeat(enemy.seat))) {
    if (!hasAbility(s, g, A('whip-control')) || !within(g, enemy, 3) || !sees(s, g, enemy)) continue
    if (enemiesInControlRange(s, g, g.seat).some((e) => e.id !== enemy.id && e.wounds > 0)) continue
    return g
  }
  return null
}

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { kind: 'shoot' | 'fight'; atk: number }
    if (!s || !op || data.kind !== 'fight' || data.atk <= 1 || !whipper(s, op)) return null
    data.atk -= 1
    markFired('fgWhipControl')
    return null
  },
  'fg.modifyAttackDice',
)

// ---------------------------------------------------------------------------
// Gong Knell, Reckless Determination (defence dice)
// ---------------------------------------------------------------------------

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !hasToken(s, op.id, FX_GONG, op.seat)) return null
    ;(c.data as { saveDelta: number }).saveDelta -= 1
    return null
  },
  'fg.modifyDefenceDice',
)

/** "Cannot retain any cover saves" (T-FG.36): not in cover for the sequence, or the weapon has Saturate. */
function cannotRetainCover(s: GameState): boolean {
  const a = s.attack
  const seq = a?.seq
  if (!a || a.kind !== 'shoot' || !seq || !a.weaponId) return false
  const shooter = s.operatives[a.operativeId]
  if (!shooter) return false
  const rules = parseRules(effectiveRules(s, shooter, s.data.weapons[a.weaponId]!, 'shoot', seq.targetId))
  return !seq.cover || rules.saturate
}

registerHook(
  'diceRolled',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as unknown as { kind: 'shoot' | 'fight'; side: 'attack' | 'defence'; diceSide: DiceSide }
    if (!s || !isFg(s, op) || d.kind !== 'shoot' || d.side !== 'defence' || op.ready || !ployActive(s, op.seat, RECKLESS)) return null
    if (!cannotRetainCover(s)) return null
    const die = d.diceSide.dice.find((x) => x.value !== null && !x.rerolled && !x.used)
    if (!die) return null
    die.value = null
    die.kind = 'normal'
    die.tag = RECKLESS_TAG
    return null
  },
  'fg.diceRolled',
)

// ---------------------------------------------------------------------------
// Fight dice: Ambush (afterAttackRoll)
// ---------------------------------------------------------------------------

registerHook(
  'afterAttackRoll',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as unknown as { kind: 'shoot' | 'fight'; side: 'attack' | 'defence'; dice: AttackDie[] }
    if (!s || !op || d.kind !== 'fight' || d.side !== 'attack' || s.attack?.operativeId !== op.id) return null
    if (!s.effects.some((e) => e.kind === FX_AMBUSH && e.operativeId === op.id) || isFrenzied(s, op)) return null
    const die = d.dice.find((x) => x.kind === 'normal' && !x.used)
    if (!die) return null
    die.kind = 'crit'
    die.tag = FX_AMBUSH
    return null
  },
  'fg.afterAttackRoll',
)

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = ctx?.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as { previousOrder?: string; order?: string; joint?: boolean }
    if (!ctx || !s || !isFg(s, op) || d.previousOrder !== 'conceal' || d.order !== 'engage' || isFrenzied(s, op) || !ployActive(s, op.seat, AMBUSH)) return null
    addEffect(ctx, { source: AMBUSH, seat: op.seat, kind: FX_AMBUSH, operativeId: op.id, expires: 'activation' })
    return null
  },
  'fg.activation.start',
)

// ---------------------------------------------------------------------------
// Strikes: Animalistic Fury, Tactual Hunter
// ---------------------------------------------------------------------------

registerHook(
  'beforeStrike',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const a = s?.attack
    if (!s || !ctx || !op || !a || a.kind !== 'fight') return null
    const data = c.data as { die: 'normal' | 'crit'; amount: number }
    if (data.die !== 'crit') return null
    const fury = s.effects.find((e) => e.kind === FX_FURY && e.operativeId === op.id)
    if (fury) {
      data.amount += 1
      removeEffects(ctx, (e) => e.id === fury.id)
    }
    // TACTUAL HUNTER: the Mangler's first critical strike against an enemy that was expended, with the claws
    const foe = c.targetId ? s.operatives[c.targetId] : undefined
    if (a.operativeId === op.id && c.weaponId && foe && !foe.ready && weaponHasRule(s, c.weaponId, 'tactualhunter') && !s.effects.some((e) => e.kind === FX_TACTUAL && e.operativeId === op.id)) {
      addEffect(ctx, { source: FX_TACTUAL, seat: op.seat, kind: FX_TACTUAL, operativeId: op.id, expires: 'action' })
      addEffect(ctx, { source: FX_TACTUAL, seat: op.seat, kind: FX_TACTUAL_PENDING, operativeId: op.id, expires: 'action' })
    }
    return null
  },
  'fg.beforeStrike',
)

function weaponHasRule(s: GameState, weaponId: string, key: string): boolean {
  return (s.data.weapons[weaponId]?.rules ?? []).some((r) => ruleKey(r.rule) === key)
}

// ---------------------------------------------------------------------------
// Damage dealt: Headtaker's growing Critical Dmg
// ---------------------------------------------------------------------------

registerHook(
  'modifyDamage',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || c.weaponId !== SKULLCLEAVER) return null
    const bonus = usesOf(s, op.seat, `fg.headtaker:${op.id}`)
    if (bonus <= 0) return null
    const dmg = (c.data as { dmg: { normal: number; crit: number } }).dmg
    dmg.crit = Math.max(dmg.crit, Math.min(8, dmg.crit + bonus))
    return null
  },
  'fg.modifyDamage',
)

// ---------------------------------------------------------------------------
// Weapon rules: Pelting Firepower, Vicious Blows, Toxic Blessings' Shock, Chaos Sigil
// ---------------------------------------------------------------------------

/** Fellgor operatives other than `shooter` that have shot `targetId` this turning point (T-FG.35). */
export function shotBy(s: GameState, seat: Seat, targetId: string): string[] {
  const prefix = `fg.shot:${targetId}:`
  return s.ledger[seat].tp.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const rules = data.rules
    const weapon = s.data.weapons[c.weaponId]
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    if (!weapon) return null
    // PELTING FIREPOWER
    if (data.kind === 'shoot' && weapon.type === 'ranged' && isFg(s, op) && target && target.seat !== op.seat && ployActive(s, op.seat, PELTING)) {
      const others = shotBy(s, op.seat, target.id).filter((id) => id !== op.id).length
      const key = others >= 2 ? 'relentless' : others === 1 ? 'ceaseless' : null
      if (key && !hasRule(rules, key)) rules.push({ rule: key })
    }
    // VICIOUS BLOWS: Ceaseless only when the Vandal performs the Fight action
    if (data.kind === 'fight' && weaponHasRule(s, weapon.id, 'viciousblows') && s.attack?.kind === 'fight' && s.attack.operativeId === op.id && !hasRule(rules, 'ceaseless')) {
      rules.push({ rule: 'ceaseless' })
      markFired('fgViciousBlows')
    }
    // TOXIC BLESSINGS: enemy Shock never affects the Toxhorn
    if (data.kind === 'fight' && target && hasAbility(s, target, A('toxic-blessings')) && rules.some((r) => ruleKey(r.rule) === 'shock')) {
      for (let i = rules.length - 1; i >= 0; i--) if (ruleKey(rules[i]!.rule) === 'shock') rules.splice(i, 1)
      markFired('fgToxicBlessings')
    }
    // CHAOS SIGIL: Piercing x - 1 for the sequence the defender chose it in
    if (data.kind === 'shoot' && target && isFg(s, target)) {
      const fx = s.effects.find((e) => e.kind === FX_SIGIL && e.operativeId === target.id && e.data?.index === s.attack?.index)
      if (fx) {
        for (let i = rules.length - 1; i >= 0; i--) {
          const r = rules[i]!
          if (ruleKey(r.rule) !== 'piercing' || r.crits) continue
          const x = (r.x ?? 1) - 1
          if (x <= 0) rules.splice(i, 1)
          else rules[i] = { ...r, x }
        }
        markFired('fgChaosSigil')
      }
    }
    return null
  },
  'fg.modifyWeaponRules',
)

registerHook(
  'afterShootResolved',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !isFg(s, op)) return null
    const targets = (c.data as { targets: string[] }).targets
    for (const t of targets) markUsedTp(s, op.seat, `fg.shot:${t}:${op.id}`)
    return null
  },
  'fg.afterShootResolved',
)

// MANTLE OF DARKNESS: a Conceal Fellgor in cover near the Shaman cannot be picked, except from within 2" (T-FG.23)
registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { candidates: string[]; secondary: boolean }
    if (!s || !shooter || data.secondary) return null
    for (let i = data.candidates.length - 1; i >= 0; i--) {
      const t = s.operatives[data.candidates[i]!]
      if (!t || t.seat === shooter.seat || t.order !== 'conceal' || !isFg(s, t) || !mantleCovers(s, t)) continue
      const v = targetVerdict(s, bodyOf(shooter), { ...bodyOf(t), order: t.order })
      if (v.inCover && !v.within2) {
        data.candidates.splice(i, 1)
        markFired('fgMantleOfDarkness')
      }
    }
    return null
  },
  'fg.beforeShootTargetSelect',
)

function mantleCovers(s: GameState, t: Operative): boolean {
  for (const sh of fgOps(s, t.seat)) {
    if (!hasToken(s, sh.id, FX_MANTLE, sh.seat) || !psychicAllowed(s, sh)) continue
    if (within(sh, t, 3) && sees(s, sh, t)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

/** Cleaver Flurry is the action being declared (a cancelled one leaves its effect behind until the next action ends). */
function flurryOn(s: GameState, op: Operative): boolean {
  const decl = s.firefight.activation?.declared
  return decl?.action === ABILITY(A('cleaver-flurry')) && s.firefight.activation?.operativeId === op.id && s.effects.some((e) => e.kind === FX_FLURRY && e.operativeId === op.id)
}

function isMissionAction(s: GameState, abilityId: string): boolean {
  return (s.data.abilities[abilityId]?.keywords ?? []).includes('MISSION')
}

function injuredEq(s: GameState, op: Operative): boolean {
  return isFg(s, op) && isFrenzied(s, op) && !warrior(s, op)
}

registerTeamRules({
  id: TEAM_ID,

  ownReactions(state, seat, info) {
    return rampageInterruptOffers(state, seat, info)
  },

  maxRepeats(state, op, actionId, performed) {
    // CHAMPION: two Fights in one activation
    if (actionId === 'fight' && isFg(state, op) && hasAbility(state, op, A('champion'))) {
      if (performed.includes('fight')) markFired('fgChampion')
      return 2
    }
    return null
  },

  // FRENZY (b): Engage only
  orders(state, op) {
    return isFrenzied(state, op) ? ['engage'] : null
  },

  actionForbidden(state, op, actionId) {
    if (isFg(state, op)) {
      // BERSERKER: the Mangler never Shoots
      if (actionId === 'shoot' && hasAbility(state, op, A('berserker'))) {
        markFired('fgBerserker')
        return 'Berserker: the Mangler can never Shoot'
      }
      // POX BOMB: the Toxhorn throws its Stun Grenade through its own action
      if (actionId === ABILITY(STUN) && hasAbility(state, op, A('pox-bomb'))) return 'the Toxhorn throws its Stun Grenade with Pox Bomb'
      // FRENZY (d)
      if (isFrenzied(state, op)) {
        if (actionId === 'marker:pickUp') return 'a frenzied operative cannot pick up markers'
        if (actionId.startsWith('ability:')) {
          const id = actionId.slice('ability:'.length)
          if (id !== A('sweeping-blow') && !/hatch/i.test(state.data.abilities[id]?.name ?? '')) return 'a frenzied operative cannot perform unique or mission actions'
        }
      }
    }
    return null
  },

  // BERSERKER: Pick Up Marker and mission actions cost 1 more AP
  actionCostDelta(state, op, actionId) {
    // WHIP CONTROL: an enemy the Herd-Goad whips pays 1 more AP to Fall Back
    if (actionId === 'fallBack' && whipper(state, op)) return 1
    if (!isFg(state, op) || !hasAbility(state, op, A('berserker'))) return 0
    if (actionId === 'marker:pickUp') return 1
    if (actionId.startsWith('ability:')) {
      const id = actionId.slice('ability:'.length)
      return isMissionAction(state, id) && !/hatch/i.test(state.data.abilities[id]?.name ?? '') ? 1 : 0
    }
    return 0
  },

  flags(state, op) {
    if (!isFg(state, op)) return null
    const out: { ignoreInjured?: boolean; ignoreAplDecreases?: boolean } = {}
    if (hasAbility(state, op, A('toxic-blessings'))) out.ignoreAplDecreases = true
    if (warrior(state, op) && isFrenzied(state, op)) {
      out.ignoreInjured = true
      markFired('fgWarriorFrenzy')
    }
    return out
  },

  // FRENZY (c): injured, the Warrior excepted (it ignores injury through `flags`)
  injuredEquivalent(state, op) {
    return injuredEq(state, op)
  },

  moveDelta(state, op) {
    if (!isFg(state, op)) return 0
    let delta = 0
    if (state.effects.some((e) => e.kind === FX_WILD && e.operativeId === op.id)) delta += 1
    // WAR PAINT: the Move lost to injury, real or from Frenzy, comes back
    if (equipped(state, op.seat, WAR_PAINT) && (hasInjuredPenalty(op) || injuredEq(state, op))) {
      delta += 2
      markFired('fgWarPaint')
    }
    return delta
  },

  // CLEAVER FLURRY: 2" more for the Fall Back path while the action is live
  moveLimitDelta(state, op, kind) {
    return kind === 'fallBack' && flurryOn(state, op) ? 2 : 0
  },

  // Icon Bearer (+1, markers) and Frenzy (control counts as APL 1)
  controlApl(state, op, _marker, apl) {
    if (!isFg(state, op)) return null
    if (hasAbility(state, op, A('icon-bearer'))) {
      markFired('fgIconBearer')
      return apl + 1
    }
    return isFrenzied(state, op) ? 1 : null
  },

  weaponForbidden(state, op, _weaponId, kind) {
    if (kind === 'shoot' && isFg(state, op) && hasAbility(state, op, A('berserker'))) return 'Berserker: the Mangler can never Shoot'
    return null
  },

  // POX BOMB: one Stun Grenade of its own, apart from the team's picks
  ownGrenades(state, op) {
    if (!isFg(state, op) || !hasAbility(state, op, A('pox-bomb'))) return null
    return { actions: { [STUN]: 1 } }
  },

  // BLADE WHIRL: a retaliating Fluxbray owes a block before the attacker's first strike
  fightResolveStart(state, attack) {
    const seq = attack.seq
    if (!seq) return null
    const sides = [seq.atk, seq.def].filter((x): x is DiceSide => !!x && !!x.weaponId)
    for (const mine of sides) {
      const op = state.operatives[mine.operativeId]
      if (!isFg(state, op) || !hasAbility(state, op, A('blade-whirl')) || isFrenzied(state, op)) continue
      // it already resolves first when it is the attacker (the active operative resolves first by default)
      if (attack.operativeId === op.id) continue
      const theirs = sides.find((x) => x !== mine)
      if (!theirs) continue
      const foe = state.operatives[theirs.operativeId]
      const brutal = !!foe && !!theirs.weaponId && parseRules(effectiveRules(state, foe, state.data.weapons[theirs.weaponId]!, 'fight', op.id)).brutal
      const open = (side: DiceSide) => side.dice.filter((d) => !d.used && d.kind !== 'fail')
      const canBlock = open(theirs).length > 0 && open(mine).some((m) => m.kind === 'crit' || (!brutal && open(theirs).some((x) => x.kind === 'normal')))
      if (!canBlock) continue
      markFired('fgBladeWhirl')
      return { queue: [{ seat: mine.seat, blockOnly: true }] }
    }
    return null
  },

  // TACTUAL HUNTER: another strike at once after the Mangler's first critical strike
  afterFightResolution(state, attack, seat, op) {
    if (op !== 'strike') return null
    const fx = state.effects.find((e) => e.kind === FX_TACTUAL_PENDING && state.operatives[e.operativeId ?? '']?.seat === seat)
    if (!fx) return null
    state.effects = state.effects.filter((e) => e.id !== fx.id)
    const sd = attack.seq?.atk.seat === seat ? attack.seq.atk : attack.seq?.def
    if (!sd || !sd.dice.some((d) => !d.used && d.kind !== 'fail')) return null
    markFired('fgTactualHunter')
    return [{ seat, strikeOnly: true }]
  },

  // BLOODSENSE: the picked operative activates next
  chainActivation(state, expended, wasChained) {
    if (wasChained) return null
    const fx = state.effects.find((e) => e.kind === FX_BLOOD && e.operativeId === expended.id)
    return fx ? [String(fx.data?.pick)] : null
  },
})

// ---------------------------------------------------------------------------
// Unique actions
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'fgGongKnell',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      addToken(ctx, op.id, { kind: FX_GONG, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'fg.gongKnell')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'fgSweepingBlow',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      const s = ctx.state
      // enemies first, nearest first, then friends nearest first (T-FG.27)
      const near = activeOps(s)
        .filter((o) => o.id !== op.id && live(o) && within(op, o, 2) && sees(s, op, o))
        .sort((a, b) => Number(a.seat === op.seat) - Number(b.seat === op.seat) || gap(op, a) - gap(op, b) || (a.id < b.id ? -1 : 1))
      for (const v of near) {
        if (!live(s.operatives[v.id])) continue
        const [r] = ctx.roll('fg.sweepingBlow.d3', 1)
        directDamage(ctx, v.id, d3(r!) + 1, op.id, 'fg.sweepingBlow')
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: String(near.length) }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'fgInciteFury',
  action: {
    offers(state, op): OfferSeed[] {
      return fgOps(state, op.seat)
        .filter((f) => f.id !== op.id && !hasKeyword(state, f, 'SHAMAN') && !hasKeyword(state, f, 'IRONHORN') && within(op, f, 3) && sees(state, op, f))
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      aplChangeNextActivation(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/** 2D3 wounds (sum of two D3 rolled as D6 halves), or 6 once the operative has made a fight kill (T-FG.22). */
registerCodeHook({
  name: 'fgApoplecticRejuvenation',
  action: {
    offers(state, op): OfferSeed[] {
      return fgOps(state, op.seat)
        .filter((f) => !isFrenzied(state, f) && f.wounds < f.maxWounds && within(op, f, 6) && sees(state, op, f))
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target) || isFrenzied(ctx.state, target)) {
        cancelAction(ctx)
        return
      }
      const amount = usedThisBattle(ctx.state, target.seat, `fg.fightKill:${target.id}`) ? 6 : ctx.roll('fg.apoplectic.2d3', 2).reduce((n, r) => n + d3(r), 0)
      regainWounds(ctx, target.id, amount, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'fgMantleOfDarkness',
  action: {
    offers(state, op): OfferSeed[] {
      return psychicAllowed(state, op) ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      addToken(ctx, op.id, { kind: FX_MANTLE, owner: op.seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'fg.mantle')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// CLEAVER FLURRY: a Fall Back path with +2 inches; afterwards each enemy whose control range the path entered takes D3+1
registerCodeHook({
  name: 'fgCleaverFlurry',
  action: {
    offers(_state, _op, _def, act): OfferSeed[] {
      // its free Reposition still counts as a Reposition (R-3.9): not after a Reposition, Fall Back or Charge this activation
      const done = act && !act.counteract ? act.performed : []
      if (done.includes('reposition') || done.includes('fallBack') || done.includes('charge')) return []
      return [{ key: '', params: {} }]
    },
    perform(ctx, op) {
      const s = ctx.state
      const act = s.firefight.activation!
      addEffect(ctx, { source: A('cleaver-flurry'), seat: op.seat, kind: FX_FLURRY, operativeId: op.id, expires: 'action' })
      act.declared = { ...act.declared!, params: { moveKind: 'fallBack', afterMove: 'fgCleaverFlurry', treatedAs: 'reposition' } }
      const c = moveConstraints(op, 'fallBack', act.counteract, s)
      ctx.raise({
        kind: 'move.path',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { operativeId: op.id, action: 'cleaverFlurry', maxInches: c.maxInches },
        constraints: c,
        canPass: true,
      })
    },
  },
  afterMove(ctx, op, from) {
    const s = ctx.state
    const ev = ctx.events.filter((e) => e.type === 'OperativeMoved' && e.operativeId === op.id).at(-1)
    if (!ev || ev.type !== 'OperativeMoved') return
    const foes = enemiesOf(s, op).filter((e) => e.status === 'active' && e.wounds > 0)
    const order: string[] = []
    const probe = (x: number, y: number, z: number): void => {
      const b = { id: op.id, pos: { x, y, z }, baseRadius: op.baseRadius, height: op.height }
      for (const e of foes) if (!order.includes(e.id) && inControlRange(s, b, bodyOf(e))) order.push(e.id)
    }
    probe(from.x, from.y, from.z)
    for (const seg of ev.segments) {
      const len = Math.hypot(seg.to.x - seg.from.x, seg.to.z - seg.from.z)
      const n = Math.max(1, Math.ceil(len / 0.5))
      for (let i = 1; i <= n; i++) {
        const t = i / n
        probe(seg.from.x + (seg.to.x - seg.from.x) * t, seg.from.y + (seg.to.y - seg.from.y) * t, seg.from.z + (seg.to.z - seg.from.z) * t)
      }
    }
    for (const id of order) {
      if (!live(s.operatives[id])) continue
      const [r] = ctx.roll('fg.cleaverFlurry.d3', 1)
      directDamage(ctx, id, d3(r!) + 1, op.id, 'fg.cleaverFlurry')
    }
  },
})

// UNCOMPROMISING ATTACK: a free Fight and a free Shoot (autopistol only), in the order picked
/** UA's free Fight or Shoot cannot be taken when the activation already performed that action (R-3.9). */
function ucDone(act: { counteract: boolean; performed: string[] } | null, what: 'fight' | 'shoot'): boolean {
  return !!act && !act.counteract && act.performed.includes(what)
}

function uncompromisingNext(ctx: Ctx, opId: string, order: ('fight' | 'shoot')[], i: number): void {
  const s = ctx.state
  const op = s.operatives[opId]
  if (!live(op) || i >= order.length) {
    finishAction(ctx)
    return
  }
  const what = order[i]!
  const data = { opId, order, i }
  if (ucDone(s.firefight.activation, what)) {
    uncompromisingNext(ctx, opId, order, i + 1)
    return
  }
  const started =
    what === 'fight'
      ? startFreeAction(ctx, { operativeId: opId, action: 'fight', resume: 'fg.uncompromising', data })
      : startFreeAction(ctx, { operativeId: opId, action: 'shoot', weaponNameContains: 'autopistol', resume: 'fg.uncompromising', data, ...(inEnemyCr(s, op) ? { pointBlank: true } : {}) })
  if (!started) uncompromisingNext(ctx, opId, order, i + 1)
}

registerFrameResume('fg.uncompromising', (ctx, outcome, data) => {
  // the free action counts as performed in the activation (no second Fight or Shoot; Ruthless Rampage reads the order)
  const act = ctx.state.firefight.activation
  const what = (data.order as string[])[Number(data.i)]
  if (act && outcome === 'finished' && what) act.performed.push(what)
  uncompromisingNext(ctx, String(data.opId), data.order as ('fight' | 'shoot')[], Number(data.i) + 1)
})

registerCodeHook({
  name: 'fgUncompromisingAttack',
  action: {
    offers(state, op, _def, act): OfferSeed[] {
      const fight = !ucDone(act, 'fight') && fightAvailability(state, op, null) === null
      const shoot = !ucDone(act, 'shoot') && canStartFreeAction(state, { operativeId: op.id, action: 'shoot', resume: '', weaponNameContains: 'autopistol', ...(inEnemyCr(state, op) ? { pointBlank: true } : {}) })
      if (!fight && !shoot) return []
      return [
        { key: 'fight', params: { param: 'fight' } },
        { key: 'shoot', params: { param: 'shoot' } },
      ]
    },
    perform(ctx, op, def, params) {
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: String(params.param) }, op.seat)
      uncompromisingNext(ctx, op.id, params.param === 'shoot' ? ['shoot', 'fight'] : ['fight', 'shoot'], 0)
    },
  },
})

// POX BOMB: the core Stun Grenade with the extra damage on a test of 3 or more
registerCodeHook({
  name: 'fgPoxBomb',
  action: {
    offers(state, op): OfferSeed[] {
      const source = grenadeSource(state, op, STUN)
      if (!source) return []
      return visibleEnemiesWithin(state, op, 6).map((e) => ({ key: e.id, params: { targetId: e.id, source }, data: { source } }))
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const target = s.operatives[params.targetId as string]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      const source = params.source as string
      if (source === 'own') addUse(s, op.seat, `own:${op.id}:${STUN}`)
      else if (source === 'ownTp') addTpUse(s, op.seat, `ownTp:${STUN}`)
      else if (source === 'taktical') markUsedTp(s, op.seat, `taktical:${STUN}`)
      else addUse(s, op.seat, STUN)
      const tb = bodyOf(target)
      const victims = activeOps(s).filter((o) => o.id === target.id || distanceBetween(tb, bodyOf(o)) <= 1 + EPS)
      for (const v of victims) {
        const [r] = ctx.roll('stun.test', 1)
        if (r! < 3) continue
        applyAplEffect(ctx, v.id, -1, 'stun-grenade')
        if (v.seat !== op.seat && live(s.operatives[v.id])) directDamage(ctx, v.id, Math.ceil(r! / 2), op.id, 'fg.poxBomb')
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Strategy ploys: Call the Attack and the four flag ploys
// ---------------------------------------------------------------------------

function ironhorn(state: GameState, seat: Seat): Operative | undefined {
  return fgOps(state, seat).find((o) => hasAbility(state, o, A('call-the-attack')) && !isFrenzied(state, o))
}

registerCodeHook({
  name: 'fgCallTheAttack',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const iron = ironhorn(state, seat)
      if (!iron) return []
      return fgOps(state, seat)
        .filter((f) => within(iron, f, 6) && sees(state, iron, f))
        .map((f) => ({ param: f.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const s = ctx.state
      const pick = seed.param ? s.operatives[seed.param] : undefined
      if (!live(pick)) {
        resumeGambit(ctx)
        return
      }
      // the group is fixed now: the pick, then every other friendly Fellgor within 2" of it that it can see (T-FG.7)
      const group = [pick.id, ...fgOps(s, seat).filter((o) => o.id !== pick.id && within(o, pick, 2) && sees(s, pick, o)).map((o) => o.id)]
      callNext(ctx, seat, group)
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const remaining = (context.remaining as string[]).slice()
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const rest = remaining.filter((id) => id !== option)
    const started = startFreeAction(ctx, { operativeId: option, action: 'dash', resume: 'fg.callAttack', data: { seat, remaining: rest } })
    if (!started) callNext(ctx, seat, rest)
  },
})

function callNext(ctx: Ctx, seat: Seat, remaining: string[]): void {
  const s = ctx.state
  const able = remaining.filter((id) => live(s.operatives[id]) && canStartFreeAction(s, { operativeId: id, action: 'dash', resume: '' }))
  if (able.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'fgCallTheAttack', operativeId: able[0], seat, remaining: able },
    options: [...able.map((id) => opt(id, 'fg.callAttack.dash', { name: `Dash: ${s.operatives[id]!.name}` })), opt('done', 'fg.callAttack.done', { name: 'No more Dashes' })],
  })
}

registerFrameResume('fg.callAttack', (ctx, _outcome, data) => {
  callNext(ctx, data.seat as Seat, (data.remaining as string[]) ?? [])
})

// Violent Temperament, Ambush, Pelting Firepower and Reckless Determination are turning point flags the handlers read
registerCodeHook({
  name: 'fgFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

/**
 * The action that just ended was a Fight (T-FG.36): the Fight action itself, or UNCOMPROMISING ATTACK whose free Fight
 * came last (its free actions are listed in the activation before it).
 */
function fightJustEnded(state: GameState, op: Operative, action: string | undefined): boolean {
  if (action === 'fight') return true
  const act = state.firefight.activation
  if (action !== ABILITY(A('uncompromising-attack')) || !act || act.operativeId !== op.id) return false
  return act.performed.at(-2) === 'fight'
}

registerCodeHook({
  name: 'fgRuthlessRampage',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isFg(state, op) || !fightJustEnded(state, op, info.action) || inEnemyCr(state, op)) return []
      return canStartFreeAction(state, { operativeId: op.id, action: 'charge', maxMove: 3, resume: '' }) ? [{ operativeId: op.id }] : []
    },
    apply(ctx, _seat, _ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      // SAVAGE: the ploy cannot come between the Mangler's two Fights, so using it here gives up that free Fight
      const act = ctx.state.firefight.activation
      if (act && act.operativeId === id) act.used = [...(act.used ?? []), X_RAMPAGE]
      if (id) startFreeAction(ctx, { operativeId: id, action: 'charge', maxMove: 3, resume: 'ploy.freeAction' })
    },
  },
  // the same ploy taken at a Guard interrupt Fight's reaction point (rampageInterruptOffers): paid here
  choice(ctx, op, option) {
    const s = ctx.state
    const cost = Number(option.split(':')[1] ?? 1)
    const opts = { operativeId: op.id, action: 'charge' as const, maxMove: 3, interrupt: true, resume: REACTION_DONE }
    if (!live(op) || s.players[op.seat].cp < cost || usedThisTp(s, op.seat, RAMPAGE) || !canStartFreeAction(s, opts)) {
      reactionDone(ctx)
      return
    }
    spendCp(ctx, op.seat, cost, RAMPAGE)
    markUsedTp(s, op.seat, RAMPAGE)
    ctx.emit({ type: 'PloyUsed', ployId: RAMPAGE }, op.seat)
    markFired('fgRuthlessRampage')
    if (!startFreeAction(ctx, opts)) reactionDone(ctx)
  },
})

/**
 * RUTHLESS RAMPAGE after a Guard interrupt Fight (Gallowdark): the interrupt frame opens no ploy window, so the ploy is
 * offered at the frame's reaction point (ownReactions marked freeActions) at its printed cost, paid when taken. Free
 * Fights inside the operative's own activation (Savage, Uncompromising Attack) return to a `firefight.actionEnded`
 * window that offers it already.
 */
function rampageInterruptOffers(state: GameState, seat: Seat, info: ReactionInfo): ReactionOffer[] {
  if (!info.interrupt || info.action !== 'fight') return []
  const op = state.operatives[info.actorId]
  if (!live(op) || op.seat !== seat || !isFg(state, op)) return []
  const winInfo = { window: 'firefight.actionEnded', subjectId: op.id, action: 'fight' }
  const o = offersFor(state, seat, 'firefight.actionEnded', winInfo).find((x) => x.ployId === RAMPAGE)
  if (!o) return []
  return [{ hook: 'fgRuthlessRampage', operativeId: op.id, option: `rampage:${o.cost}`, labelKey: 'fg.rampage', freeActions: true, data: { name: `RUTHLESS RAMPAGE (${o.cost} CP): a free Charge of up to 3"` } }]
}

registerCodeHook({
  name: 'fgWildRage',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      return live(op) && op.seat === seat && isFg(state, op) && !info.counteracting ? [{ operativeId: op.id }] : []
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (id) addEffect(ctx, { source: ploy.id, seat, kind: FX_WILD, operativeId: id, expires: 'activation' })
    },
  },
})

registerCodeHook({
  name: 'fgAnimalisticFury',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isFg(state, op) || state.effects.some((e) => e.kind === FX_FURY && e.operativeId === op.id)) return []
      const side = sideOf(state, op.id)
      return side && liveOn(side.dice, 'crit').length > 0 ? [{ operativeId: op.id }] : []
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (id) addEffect(ctx, { source: ploy.id, seat, kind: FX_FURY, operativeId: id, expires: 'action' })
    },
  },
})

/** The victims `op` incapacitated in the action just finished that stood in its control range (T-FG.40). */
function bloodsenseVictims(state: GameState, op: Operative): Operative[] {
  const act = baseActivation(state)
  if (!act || act.counteract || act.operativeId !== op.id) return []
  const out: Operative[] = []
  const seen = new Set<string>()
  const add = (id: string): void => {
    const v = state.operatives[id]
    if (v && !seen.has(id) && inControlRange(state, bodyOf(op), bodyOf(v))) {
      seen.add(id)
      out.push(v)
    }
  }
  // the kill log is written at removal time (and a Frenzy gain is logged as `scored` when it happens), before the
  // window after the action opens
  for (const k of killsSince(state, act.declaredSeq ?? -1)) if (k.killerId === op.id && k.cause !== 'offboard' && k.victimSeat !== op.seat) add(k.removedId)
  return out
}

registerCodeHook({
  name: 'fgBloodsense',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isFg(state, op) || info.counteracting) return []
      const picks = new Set<string>()
      for (const v of bloodsenseVictims(state, op)) {
        for (const f of fgOps(state, seat)) {
          if (f.id !== op.id && f.ready && distanceBetween(bodyOf(f), bodyOf(v)) <= 3 + EPS && visible(state, bodyOf(f), bodyOf(v))) picks.add(f.id)
        }
      }
      return [...picks].sort().map((id) => ({ param: id, operativeId: op.id }))
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (id && seed.param) addEffect(ctx, { source: ploy.id, seat, kind: FX_BLOOD, operativeId: id, expires: 'turningPoint', data: { pick: seed.param } })
    },
  },
})

// ---------------------------------------------------------------------------
// Ploy rule: the free offers (Violent Temperament, Gore Marks, Chaos Sigil, Sagacious, Savage) and Brass Adornments
// ---------------------------------------------------------------------------

function free(id: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id: param ? `${id}:${param}` : id, ployId: id, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

function flipped(order: Order): Order {
  return order === 'engage' ? 'conceal' : 'engage'
}

const fgPloyRule: PloyRule = {
  extraOffers(state, seat, window, info) {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!live(subject) || subject.seat !== seat || !isFg(state, subject)) return out
    if (window === 'fight.beforeRerolls') {
      const side = sideOf(state, subject.id)
      if (!side || side.noRerolls || eligibleDice(side).length === 0) return out
      // VIOLENT TEMPERAMENT: re-roll every die not already re-rolled or replaced
      if (ployActive(state, seat, VT)) out.push(free(X_VT, 'Violent Temperament: re-roll all attack dice', 'fg.vt', subject))
      // GORE MARKS: 1 damage to the fighter, then re-roll one of its dice
      if (equipped(state, seat, GORE) && !usedThisTp(state, seat, GORE)) {
        const seen = new Set<number>()
        for (const i of eligibleDice(side)) {
          const v = side.dice[i]!.value!
          if (seen.has(v)) continue
          seen.add(v)
          out.push(free(GORE, `Gore Marks: take 1 damage and re-roll the ${v}`, 'fg.gore', subject, String(i)))
        }
      }
    }
    // CHAOS SIGIL: the defender lowers Piercing x by 1 for this sequence
    if (window === 'shoot.beforeDefenceRoll' && equipped(state, seat, SIGIL) && !usedThisTp(state, seat, SIGIL) && info.attackerId && info.weaponId) {
      const shooter = state.operatives[info.attackerId]
      const w = state.data.weapons[info.weaponId]
      if (shooter && w && parseRules(effectiveRules(state, shooter, w, 'shoot', subject.id)).piercing >= 1 && !state.effects.some((e) => e.kind === FX_SIGIL && e.operativeId === subject.id && e.data?.index === state.attack?.index)) {
        out.push(free(SIGIL, 'Chaos Sigil: lower Piercing by 1', 'fg.sigil', subject))
      }
    }
    // SAGACIOUS: change the Gnarlscar's order as its activation ends
    // (once: the change is the rule's only use, so the window does not offer it again after it)
    const ending = state.firefight.activation
    if (window === 'firefight.activationEnded' && !info.counteracting && hasAbility(state, subject, A('sagacious')) && !isFrenzied(state, subject) && !(ending?.used ?? []).includes(X_SAGACIOUS)) {
      const to = flipped(subject.order)
      if (allowedOrders(state, subject).includes(to)) out.push(free(X_SAGACIOUS, `Sagacious: change to ${to}`, 'fg.sagacious', subject))
    }
    // SAVAGE: a free Fight after the Mangler's first Fight of its activation
    if (window === 'firefight.actionEnded' && info.action === 'fight' && !info.counteracting && hasAbility(state, subject, A('savage'))) {
      const act = state.firefight.activation
      if (act && !act.frame && !act.counteract && act.operativeId === subject.id && act.performed.filter((p) => p === 'fight').length === 1 && !(act.used ?? []).includes(X_SAVAGE) && !(act.used ?? []).includes(X_RAMPAGE)) {
        if (canStartFreeAction(state, { operativeId: subject.id, action: 'fight', resume: '' })) out.push(free(X_SAVAGE, 'Savage: a free Fight', 'fg.savage', subject))
      }
    }
    return out
  },
  // BRASS ADORNMENTS: the first Animalistic Fury and the first Wild Rage of the battle cost 0 CP
  costAdjust(state, seat, ploy) {
    if ((ploy.id !== FURY && ploy.id !== WILD_RAGE) || !equipped(state, seat, BRASS) || usedThisBattle(state, seat, `fg.brass:${ploy.id}`)) return null
    return { cost: 0, via: 'fg.brass' }
  },
  onUsed(ctx, seat, offer) {
    const s = ctx.state
    const op = offer.operativeId ? s.operatives[offer.operativeId] : undefined
    switch (offer.via) {
      case 'fg.brass':
        markUsedBattle(s, seat, `fg.brass:${offer.ployId}`)
        markFired('fgBrassAdornments')
        return
      case 'fg.vt': {
        const side = op ? sideOf(s, op.id) : null
        if (!op || !side) return
        const label = s.attack?.seq?.atk === side ? 'attack' : 'defence'
        forcedReroll(ctx, side, eligibleDice(side), VT, label, 'fight')
        return
      }
      case 'fg.gore': {
        const side = op ? sideOf(s, op.id) : null
        if (!op || !side) return
        markUsedTp(s, seat, GORE)
        markFired('fgGoreMarks')
        const index = Number(offer.param)
        directDamage(ctx, op.id, 1, op.id, 'fg.goreMarks')
        // a Frenzy gained from the damage discarded every die: nothing is left to re-roll
        const label = s.attack?.seq?.atk === side ? 'attack' : 'defence'
        const done = forcedReroll(ctx, side, [index], GORE, label, 'fight')
        if (done.length > 0 && side.dice[index]!.kind === 'fail' && live(s.operatives[op.id])) directDamage(ctx, op.id, 1, op.id, 'fg.goreMarks')
        return
      }
      case 'fg.sigil': {
        if (!op) return
        markUsedTp(s, seat, SIGIL)
        addEffect(ctx, { source: SIGIL, seat, kind: FX_SIGIL, operativeId: op.id, expires: 'action', data: { index: s.attack?.index ?? 0 } })
        return
      }
      case 'fg.sagacious': {
        if (!op) return
        const act = s.firefight.activation
        if (act) act.used = [...(act.used ?? []), X_SAGACIOUS]
        markFired('fgSagacious')
        setOrder(ctx, op, flipped(op.order))
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('sagacious') }, seat)
        return
      }
      case 'fg.savage': {
        const act = s.firefight.activation
        if (!op || !act) return
        act.used = [...(act.used ?? []), X_SAVAGE]
        markFired('fgSavage')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('savage') }, seat)
        startFreeAction(ctx, { operativeId: op.id, action: 'fight', resume: 'ploy.freeAction' })
        return
      }
      default:
        return
    }
  },
}

registerPloyRule(fgPloyRule)
