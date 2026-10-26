// Blooded (docs/spec/13-teams.md section 18, rule ids T-BL.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - BLOODED tokens (T-BL.33 to T-BL.35): the unassigned tokens are the pool `bl.blooded`; an assigned token is the
//    operative token `bl.blooded` (cap 1, kept for the battle); the Gaze is the operative token `bl.gaze` (until the end of
//    the turning point). Gains: `turningPoint.start` and `operative.removed` (kill log, every cause). The Blooded gambit
//    is a 0 CP strategy ploy that loops ability.choice. Holder tests go through `holdsToken` / `isHolder` / `underGaze`.
//  - Token effects: modifyAttackDice (Accurate 1) and afterAttackRoll (the Gaze crit converts one Accurate die).
//  - Before-removal rules (Blooded Icon, Explosive Demise, Bitter Demise): one `operative.incapacitated` handler that
//    decides in order and, inside a removal queue (an attack's, or the deferred one outside attacks that
//    `pausableRemoval` asks for), asks with ability.choice and calls continueRemovals.
//  - STIMMS, Regular Dosage, Signal, Sacrilegious Actuation, Enforce: unique actions and a pre-battle offer.
//  - Weapon and stat rules (Stalk, Tough, Shield, Camo Cloak, Chem-enhanced, Brute, Wretched, Group Activation...): small
//    handlers on the shared hook points and the team rule provider.
//  - Ploys and equipment: strategy flags, Glory Kill and Name Whispered tokens, Callous Disregard (target selection and a
//    fail spill), Moment of Repute, Reward Earned, Dark Favour; the 0 CP offers (Avalanche of Muscle, Shielding) and the
//    Chaos Sigil cost are ploy rules.
import { applyAplEffect, continueRemovals, hasRule, redirectAttack, ruleKey, ruleSetFor, targetInfo, type RuleSet } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { inEnemyCr } from '../conditions'
import { commsBonus } from '../core-hooks'
import { addEffect, aplChangeNextActivation, directDamage, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { territoryOf } from '../equipment'
import { extraStrike } from '../fight'
import { cancelAction, finishAction, startDelegatedAction } from '../firefight'
import { distToPolygon } from '../geometry'
import { registerFrameResume, registerHook, type AfterRollData, type BeforeIncapacitatedData, type ChoiceRequest } from '../hooks'
import { bodyOf, visible } from '../los'
import { distanceBetween, enemiesInControlRange, isWithin, whollyWithinRegion } from '../measure'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { gainPool, poolOf, spendPool } from '../pools'
import type { Ctx } from '../registry'
import { preBattleChoiceDone } from '../setup'
import { activeOps, enemiesOf, otherSeat } from '../state'
import { resumeGambit } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { terrainOf } from '../terrain'
import { addToken, hasToken, tokensOn } from '../tokens'
import type { GameState, Operative, Seat, WeaponRuleRef } from '../types'

export const TEAM_ID = 'blooded'

const EPS = 1e-6

const A = (id: string) => `bl.a.${id}`
const P = (id: string) => `bl.p.${id}`
const E = (id: string) => `bl.e.${id}`

/** the pool of unassigned tokens and the operative tokens */
export const POOL = 'bl.blooded'
export const TOKEN = 'bl.blooded'
export const GAZE = 'bl.gaze'
export const WHISPER = 'bl.name-whispered'
export const GLORY_TOKEN = 'bl.glory-kill'
export const SHIELDING = 'bl.shielding'
export const ENRAGED = 'bl.stimm-enraged'
export const FORTIFIED = 'bl.stimm-fortified'

const CARD = {
  chieftain: 'bl.chieftain',
  grenadier: 'bl.brimstone-grenadier',
  butcher: 'bl.butcher',
  commsman: 'bl.commsman',
  corpseman: 'bl.corpseman',
  enforcer: 'bl.enforcer',
  flenser: 'bl.flenser',
  ogryn: 'bl.ogryn',
  sharpshooter: 'bl.sharpshooter',
  thug: 'bl.thug',
  sweeper: 'bl.trench-sweeper',
  trooper: 'bl.trooper',
} as const

const BOMB = 'bl.w.diabolyk-bomb'
const CLEAVER = 'bl.w.power-weapon-cleaver'
const SKINNING = 'bl.w.skinning-blades'
const SHIELD_WEAPON = 'bl.w.bayonet-shield'
const FRAG = 'core.w.frag-grenade'
const KRAK = 'core.w.krak-grenade'
const WICKED_WEAPONS = ['bl.w.bayonet', 'bl.w.bayonet-chieftain', 'bl.w.bayonet-shield', 'bl.w.improvised-blade']

const GAMBIT = P('blooded')
const NAME_WHISPERED = P('name-whispered')
const GLORY = P('glory-kill')
const RECKLESS = P('reckless-aspirant')
const GRIT = P('malevolent-grit')
const BITTER = P('bitter-demise')
const CALLOUS = P('callous-disregard')
const REPUTE = P('moment-of-repute')
const REWARD = P('reward-earned')
const FAVOUR = P('dark-favour')

const SIGIL = E('chaos-sigil')
const TROPHIES = E('sinister-trophies')
const SYMBOLS = E('symbols-of-bloody-worship')
const WICKED = E('wicked-blades')

const LEDGER_ICON = 'bl.icon'
const LEDGER_GAIN_ENEMY = 'bl.gain.enemy'
const LEDGER_GAIN_FRIENDLY = 'bl.gain.friendly'
const LEDGER_DOSAGE = 'bl.dosage'
const FX_DISCIPLINED = 'bl.disciplined'
const FX_OFFERING = 'bl.bloodOffering'
const FX_DEALT = 'bl.dealt'
const FX_CALLOUS = 'bl.callous'
const FX_AVALANCHE = 'bl.avalanche.used'

const STIMMS = ['rejuvenated', 'enraged', 'fortified'] as const
type Stimm = (typeof STIMMS)[number]
const STIMM_NAME: Record<Stimm, string> = { rejuvenated: 'Rejuvenated', enraged: 'Enraged', fortified: 'Fortified' }

const opt = (id: string, labelKey: string, data: Record<string, unknown> = {}) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, data })

// The code hooks the data names. Offers and choices are filled in below; the registry needs the names first.
// (The passive rules have no code names: they are plain handlers on the shared hook points.)

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

/** A Blooded datacard (BLOODED is also a Pathfinders keyword, so the card id is the test). */
export function isBl(op: Operative | undefined): op is Operative {
  return !!op && op.datacardId.startsWith('bl.')
}

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function blOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isBl(o))
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

/** `b` is visible to `a` ("visible to and within x of a": Explosive Demise, Bitter Demise, Dark Favour); one direction only. */
function sees(state: GameState, a: Operative, b: Operative): boolean {
  return visible(state, bodyOf(a), bodyOf(b))
}

const d3 = (ctx: Ctx, label: string): number => Math.ceil(ctx.roll(label, 1)[0]! / 2)

/** The operative holds one of its owner's assigned Blooded tokens. */
export function holdsToken(state: GameState, op: Operative | undefined): boolean {
  return !!op && isBl(op) && hasToken(state, op.id, TOKEN, op.seat)
}

/** Token holder for an attack against `targetId`: also the Sharpshooter shooting its A Name Whispered In Blood enemy (T-BL.28). */
export function isHolder(state: GameState, op: Operative | undefined, targetId?: string): boolean {
  if (!op || !isBl(op)) return false
  if (hasToken(state, op.id, TOKEN, op.seat)) return true
  return op.datacardId === CARD.sharpshooter && !!targetId && hasToken(state, targetId, WHISPER, op.seat)
}

/** Wholly within the opponent's territory (T-BL.6). */
export function inEnemyTerritory(state: GameState, op: Operative): boolean {
  const poly = territoryOf(state, otherSeat(op.seat))
  return !!poly && whollyWithinRegion(bodyOf(op), poly)
}

/** Under the Gaze of the Gods: the Gaze token, Lead With Strength, or the Sharpshooter's marked enemy (T-BL.9, T-BL.28, T-BL.34). */
export function underGaze(state: GameState, op: Operative | undefined, targetId?: string): boolean {
  if (!op || !isBl(op)) return false
  if (hasToken(state, op.id, GAZE, op.seat)) return true
  if (op.datacardId === CARD.chieftain && (holdsToken(state, op) || inEnemyTerritory(state, op))) return true
  return op.datacardId === CARD.sharpshooter && !!targetId && hasToken(state, targetId, WHISPER, op.seat)
}

function holders(state: GameState, seat: Seat): Operative[] {
  return blOps(state, seat).filter((o) => holdsToken(state, o))
}

/** Control range between two friendly operatives (visible and within 1"). */
function friendlyCr(state: GameState, a: Operative, b: Operative): boolean {
  return gap(a, b) <= 1 + EPS && (visible(state, bodyOf(a), bodyOf(b), { crMode: true }) || visible(state, bodyOf(b), bodyOf(a), { crMode: true }))
}

/** Is any part of Light or Heavy terrain within `inches` of the operative's base? (Stalk, T-BL.21) */
function nearLightOrHeavy(state: GameState, op: Operative, inches: number): boolean {
  for (const s of terrainOf(state.map).solids) {
    if (!s.light && !s.heavy) continue
    if (Math.max(0, distToPolygon(op.pos, s.polygon) - op.baseRadius) <= inches + EPS) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Token gains (T-BL.33): the Ready step and the first incapacitations of each turning point
// ---------------------------------------------------------------------------

registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    for (const seat of ['A', 'B'] as const) {
      if (ctx.state.players[seat].teamId !== TEAM_ID) continue
      gainPool(ctx, seat, POOL, 1, 'bl.ready')
    }
    return null
  },
  'bl.turningPoint.start',
)

registerHook(
  'operative.removed',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as { cause: string }
    if (!ctx || !s || !victim || d.cause === 'offboard') return null
    for (const seat of ['A', 'B'] as const) {
      if (s.players[seat].teamId !== TEAM_ID) continue
      if (victim.seat !== seat) {
        // the first enemy operative incapacitated each turning point, whatever the cause
        if (usedThisTp(s, seat, LEDGER_GAIN_ENEMY)) continue
        markUsedTp(s, seat, LEDGER_GAIN_ENEMY)
        gainPool(ctx, seat, POOL, 1, 'bl.enemyDown')
        continue
      }
      // the first friendly operative incapacitated within 6" of an enemy operative each turning point
      if (usedThisTp(s, seat, LEDGER_GAIN_FRIENDLY)) continue
      if (!activeOps(s).some((o) => o.seat !== seat && live(o) && within(victim, o, 6))) continue
      markUsedTp(s, seat, LEDGER_GAIN_FRIENDLY)
      gainPool(ctx, seat, POOL, 1, 'bl.friendlyDown')
    }
    return null
  },
  'bl.operative.removed',
)

// ---------------------------------------------------------------------------
// The Blooded gambit (T-BL.34): assign tokens, then maybe pick the Gaze
// ---------------------------------------------------------------------------

function unmarked(state: GameState, seat: Seat): Operative[] {
  return blOps(state, seat).filter((o) => !holdsToken(state, o))
}

function raiseAssign(ctx: Ctx, seat: Seat): boolean {
  const s = ctx.state
  const free = unmarked(s, seat)
  if (poolOf(s, seat, POOL) <= 0 || free.length === 0) return false
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'blGambit', step: 'assign', operativeId: free[0]!.id, seat, tokens: poolOf(s, seat, POOL) },
    options: [...free.map((o) => opt(o.id, 'bl.assign', { name: o.name })), opt('done', 'bl.assign.done')],
  })
  return true
}

function raiseGaze(ctx: Ctx, seat: Seat): boolean {
  const s = ctx.state
  const marked = holders(s, seat)
  if (marked.length < 4) return false
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'blGambit', step: 'gaze', operativeId: marked[0]!.id, seat },
    options: [...marked.map((o) => opt(o.id, 'bl.gaze', { name: o.name })), opt('none', 'bl.gaze.none')],
  })
  return true
}

registerCodeHook({
  name: 'blGambit',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const canAssign = poolOf(state, seat, POOL) > 0 && unmarked(state, seat).length > 0
      return canAssign || holders(state, seat).length >= 4 ? [{}] : []
    },
    apply(ctx, seat) {
      if (raiseAssign(ctx, seat)) return
      if (raiseGaze(ctx, seat)) return
      resumeGambit(ctx)
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const s = ctx.state
    if (context.step === 'gaze') {
      const pick = s.operatives[option]
      if (live(pick) && pick.seat === seat && holdsToken(s, pick)) {
        addToken(ctx, pick.id, { kind: GAZE, owner: seat, cap: 1, expires: ['turningPointEnd'] }, 'bl.gaze')
        ctx.emit({ type: 'AbilityUsed', operativeId: pick.id, abilityId: GAMBIT, detail: 'gaze' }, seat)
      }
      resumeGambit(ctx)
      return
    }
    if (option !== 'done') {
      const pick = s.operatives[option]
      if (live(pick) && pick.seat === seat && !holdsToken(s, pick) && spendPool(ctx, seat, POOL, 1, 'bl.assign')) {
        addToken(ctx, pick.id, { kind: TOKEN, owner: seat, cap: 1, expires: ['battle'] }, 'bl.assign')
        ctx.emit({ type: 'AbilityUsed', operativeId: pick.id, abilityId: GAMBIT, detail: 'token' }, seat)
        if (raiseAssign(ctx, seat)) return
      }
    }
    if (raiseGaze(ctx, seat)) return
    resumeGambit(ctx)
  },
})

// A NAME WHISPERED IN BLOOD (T-BL.28): a 0 CP gambit of the first turning point
registerCodeHook({
  name: 'blNameWhispered',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.turningPoint !== 1 || !blOps(state, seat).some((o) => o.datacardId === CARD.sharpshooter)) return []
      return enemiesOf(state, { seat }).filter(live).map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const foe = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!live(foe)) return
      addToken(ctx, foe.id, { kind: WHISPER, owner: seat, cap: 1, expires: ['battle'] }, 'bl.name-whispered')
      const sh = blOps(ctx.state, seat).find((o) => o.datacardId === CARD.sharpshooter)
      ctx.emit({ type: 'AbilityUsed', operativeId: sh?.id ?? null, abilityId: NAME_WHISPERED, detail: foe.id }, seat)
    },
  },
})

// ---------------------------------------------------------------------------
// Token effects (T-BL.35) and the attack-dice rules
// ---------------------------------------------------------------------------

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !isBl(op) || !c.weaponId) return null
    const data = c.data as { targetId: string; hitDelta: number; accurate: number[] }
    const a = s.attack
    const retaliating = a?.kind === 'fight' && a.operativeId !== op.id
    if (isHolder(s, op, data.targetId)) data.accurate.push(1)
    else if (!retaliating && ployActive(s, op.seat, RECKLESS) && inEnemyTerritory(s, op)) data.accurate.push(1)
    // GRENADIER: its frag and krak grenades hit on a 3+ (T-BL.10)
    if (op.datacardId === CARD.grenadier && (c.weaponId === FRAG || c.weaponId === KRAK)) data.hitDelta -= 1
    return null
  },
  'bl.modifyAttackDice',
)

registerHook(
  'afterAttackRoll',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !isBl(op)) return null
    const data = c.data as unknown as AfterRollData
    // the Gaze crit: one normal success kept through Accurate 1 is kept as a crit (never against an obscured target)
    if ((data.kind === 'fight' || data.side === 'attack') && isHolder(s, op, c.targetId) && underGaze(s, op, c.targetId) && !data.obscured) {
      let die = data.dice.find((d) => d.tag === 'accurate' && d.kind === 'normal' && !d.used)
      // the odds query first tries the rule on a probe pool with no tagged dice: show it a conversion so it is kept (a holder's
      // real pool always carries its Accurate die, so this never converts a rolled die)
      if (!die && data.query && !data.dice.some((d) => d.tag === 'accurate')) die = data.dice.find((d) => d.kind === 'normal' && !d.tag && !d.used)
      if (die) {
        die.kind = 'crit'
        markFired('blGaze')
      }
    }
    // CALLOUS DISREGARD (T-BL.40): each fail thrown away hurts a friendly operative next to the target
    const ctx = c.engine
    if (ctx && data.kind === 'shoot' && data.side === 'attack' && !data.query && s.effects.some((e) => e.kind === FX_CALLOUS && e.operativeId === op.id)) spill(ctx, s, op, data)
    return null
  },
  'bl.afterAttackRoll',
)

/** Callous Disregard: friendly operatives within the target's control range (the shooter's side) that can take the damage. */
function spillVictims(s: GameState, target: Operative): Operative[] {
  return enemiesInControlRange(s, target, target.seat).filter(live)
}

function spill(ctx: Ctx, s: GameState, shooter: Operative, data: AfterRollData): void {
  const target = s.operatives[data.targetId]
  if (!target) return
  const victims = spillVictims(s, target)
  if (victims.length === 0) return
  const fails = data.dice.map((d, i) => ({ d, i })).filter(({ d }) => d.kind === 'fail' && d.value !== null && !d.used && !d.tag)
  if (fails.length === 0) return
  const picks: { id: string; amount: number }[] = []
  let waiting = false
  for (const { d, i } of fails) {
    if (victims.length === 1) {
      picks.push({ id: victims[0]!.id, amount: d.value! })
      continue
    }
    const key = `bl.cd.${i}`
    const answer = data.choices[key]
    if (answer === undefined) {
      const req: ChoiceRequest = {
        id: key,
        seat: shooter.seat,
        labelKey: `bl.callous.pick:${d.value}`,
        options: victims.map((v) => ({ id: v.id, labelKey: `bl.callous.victim:${v.name.replace(/[.:]/g, '')}` })),
      }
      data.requests.push(req)
      waiting = true
    } else picks.push({ id: answer, amount: d.value! })
  }
  // every die decided; the choices are kept, so a re-run of the hook applies the damage only once
  if (waiting || data.choices['bl.cd.applied'] === '1') return
  data.choices['bl.cd.applied'] = '1'
  for (const p of picks) {
    if (!live(s.operatives[p.id])) continue
    directDamage(ctx, p.id, p.amount, shooter.id, 'bl.callousDisregard')
  }
  markFired('blCallousDisregard')
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
    if (!weapon) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    // CHEM-ENHANCED: enemy Shock and Stun do not touch the Ogryn (T-BL.24)
    if (target && target.datacardId === CARD.ogryn && target.seat !== op.seat) {
      for (let i = rules.length - 1; i >= 0; i--) {
        const k = ruleKey(rules[i]!.rule)
        if (k === 'shock' || k === 'stun') rules.splice(i, 1)
      }
    }
    if (!isBl(op)) return null
    // STALK: Lethal 5+ while terrain is in the Flenser's control range (T-BL.21)
    if (weapon.id === SKINNING && data.kind === 'fight' && nearLightOrHeavy(s, op, 1) && !rules.some((r) => ruleKey(r.rule) === 'lethal' && (r.target ?? r.x ?? 6) <= 5)) {
      rules.push({ rule: 'lethal', target: 5 })
    }
    // ENRAGED: melee weapons have Relentless (T-BL.16)
    if (weapon.type === 'melee' && hasToken(s, op.id, ENRAGED, op.seat) && !hasRule(rules, 'relentless')) rules.push({ rule: 'relentless' })
    // GLORY KILL: Ceaseless, or Relentless for a token holder, against the marked enemy (T-BL.36)
    if (target && target.seat !== op.seat && hasToken(s, target.id, GLORY_TOKEN, op.seat)) {
      if (isHolder(s, op, target.id)) {
        if (!hasRule(rules, 'relentless')) rules.push({ rule: 'relentless' })
      } else if (!hasRule(rules, 'ceaseless')) rules.push({ rule: 'ceaseless' })
    }
    // RECKLESS ASPIRANT: a holder wholly in enemy territory has Punishing, retaliating included (T-BL.37)
    if (ployActive(s, op.seat, RECKLESS) && isHolder(s, op, data.targetId) && inEnemyTerritory(s, op) && !hasRule(rules, 'punishing')) rules.push({ rule: 'punishing' })
    return null
  },
  'bl.modifyWeaponRules',
)

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const def = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !isBl(def)) return null
    const data = c.data as { rerolls: { id: string; source: string; mode: 'one' | 'result' | 'any'; used: boolean }[] }
    // MALEVOLENT GRIT: a token holder or an operative deep in enemy territory re-rolls one defence die (T-BL.38)
    if (ployActive(s, def.seat, GRIT) && (holdsToken(s, def) || inEnemyTerritory(s, def))) data.rerolls.push({ id: 'bl.grit', source: GRIT, mode: 'one', used: false })
    // SHIELDING: any defence dice may be re-rolled (T-BL.31)
    if (hasToken(s, def.id, SHIELDING, def.seat)) data.rerolls.push({ id: 'bl.shielding', source: A('shielding'), mode: 'any', used: false })
    return null
  },
  'bl.modifyDefenceDice',
)

registerHook(
  'modifyDamage',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !isBl(op) || !c.weaponId || !equipped(s, op.seat, WICKED) || !WICKED_WEAPONS.includes(c.weaponId)) return null
    const data = c.data as { dmg: { normal: number; crit: number } }
    data.dmg.normal += 1
    data.dmg.crit += 1
    return null
  },
  'bl.modifyDamage',
)

// ---------------------------------------------------------------------------
// Damage taken: Tough, Fortified; Wretched's last strike
// ---------------------------------------------------------------------------

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !isBl(op)) return null
    const d = c.data as { source: string; amount: number }
    const dieSource = d.source === 'normal' || d.source === 'crit' || d.source === 'strike-normal' || d.source === 'strike-crit'
    // TOUGH: a Normal Dmg of 3 or more deals 1 less (T-BL.29)
    if (op.datacardId === CARD.thug && (d.source === 'normal' || d.source === 'strike-normal') && d.amount >= 3) d.amount -= 1
    // FORTIFIED: a die dealing 3 or more is cut by 1 on a D6 of 5+ (T-BL.16); Devastating and rule damage are never reduced
    if (ctx && dieSource && d.amount >= 3 && hasToken(s, op.id, FORTIFIED, op.seat)) {
      if (ctx.roll('bl.fortified', 1)[0]! >= 5) {
        d.amount -= 1
        markFired('blStimms')
      }
    }
    return null
  },
  'bl.onDamageInflicted',
)

// WRETCHED (b) (T-BL.22): a Flenser that falls in a fight still lands one unresolved success on its enemy
registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const a = s?.attack
    if (!s || !ctx || !op || op.datacardId !== CARD.flenser || !a || a.kind !== 'fight' || !a.seq) return null
    const d = c.data as unknown as BeforeIncapacitatedData
    if (d.wounds > 0) return null
    const side = a.seq.atk.operativeId === op.id ? a.seq.atk : a.seq.def && a.seq.def.operativeId === op.id ? a.seq.def : null
    if (!side || !side.weaponId) return null
    let idx = side.dice.findIndex((x) => x.kind === 'crit' && !x.used)
    if (idx < 0) idx = side.dice.findIndex((x) => x.kind === 'normal' && !x.used)
    if (idx < 0) return null
    // the Flenser is at 0 wounds already; extraStrike works for a fighter in that state
    if (extraStrike(ctx, op.seat, idx)) {
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('wretched') }, op.seat)
      markFired('blWretched')
    }
    return null
  },
  'bl.beforeIncapacitated',
)

// BLOOD OFFERING (T-BL.12): the first critical strike of a sequence earns a token
registerHook(
  'beforeStrike',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !op || op.datacardId !== CARD.butcher || c.weaponId !== CLEAVER) return null
    const data = c.data as { die: string }
    if (data.die !== 'crit' || s.effects.some((e) => e.kind === FX_OFFERING && e.operativeId === op.id)) return null
    addEffect(ctx, { source: A('wr-blood-offering'), seat: op.seat, kind: FX_OFFERING, operativeId: op.id, expires: 'action' })
    gainPool(ctx, op.seat, POOL, 1, 'bl.bloodOffering')
    return null
  },
  'bl.beforeStrike',
)

// UNHOLY SUSTENANCE (T-BL.13): the Butcher that incapacitates its enemy regains up to D3 wounds
registerHook(
  'onFightResolved',
  (c) => {
    const s = c.state
    const ctx = c.engine
    if (!s || !ctx) return null
    const d = c.data as { attackerId: string; defenderId: string; attackerIncapacitated: boolean; defenderIncapacitated: boolean }
    const check = (butcherId: string, foeDown: boolean) => {
      const b = s.operatives[butcherId]
      if (!b || b.datacardId !== CARD.butcher || !foeDown || !live(b)) return
      regainWounds(ctx, b.id, d3(ctx, 'bl.sustenance'), A('unholy-sustenance'))
      markFired('blUnholySustenance')
    }
    check(d.attackerId, d.defenderIncapacitated)
    check(d.defenderId, d.attackerIncapacitated)
    return null
  },
  'bl.onFightResolved',
)

// ---------------------------------------------------------------------------
// Target selection: Brute and Callous Disregard
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !shooter) return null
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    const callous = isBl(shooter) && s.effects.some((e) => e.kind === FX_CALLOUS && e.operativeId === shooter.id)
    for (const e of enemiesOf(s, shooter)) {
      if (!live(e) || data.candidates.includes(e.id)) continue
      const brute = e.datacardId === CARD.ogryn && e.order === 'conceal'
      if (!brute && !callous) continue
      const base: RuleSet = ruleSetFor(s, shooter, data.weaponId, 'shoot', undefined, c.engine)
      if (base.range !== null && !isWithin(bodyOf(shooter), bodyOf(e), base.range)) continue
      const crowd = enemiesInControlRange(s, e, e.seat)
      if (crowd.length > 0) {
        // only other friendly Blooded operatives in the way, and only while Callous Disregard is in force
        if (!callous || crowd.some((o) => o.id === shooter.id || !isBl(o))) continue
      }
      // BRUTE: Light terrain does not make a visible Conceal Ogryn untargetable (as Seek Light for the selection)
      const rules: RuleSet = brute ? { ...base, seekLight: true } : base
      const info = targetInfo(s, shooter, e, rules)
      if (!info.verdict.visible || info.coverBlocks) continue
      data.candidates.push(e.id)
      markFired(brute ? 'blBrute' : 'blCallousTargets')
    }
    return null
  },
  'bl.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// Activation: Gruelling Disciplinarian (b)
// ---------------------------------------------------------------------------

registerHook(
  'activation.start',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !isBl(op)) return null
    if (enforcerNear(s, op)) addEffect(ctx, { source: A('gruelling-disciplinarian'), seat: op.seat, kind: FX_DISCIPLINED, operativeId: op.id, expires: 'activation' })
    return null
  },
  'bl.activation.start',
)

function enforcerNear(state: GameState, op: Operative): boolean {
  return blOps(state, op.seat).some((e) => e.datacardId === CARD.enforcer && within(op, e, 6))
}

// ---------------------------------------------------------------------------
// Symbols of Bloody Worship (T-BL.46)
// ---------------------------------------------------------------------------

registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as { attackerId: string; amount: number }
    const attacker = s && d.attackerId ? s.operatives[d.attackerId] : undefined
    if (!ctx || !s || !victim || !isBl(attacker) || d.amount <= 0 || victim.seat === attacker.seat || !equipped(s, attacker.seat, SYMBOLS)) return null
    if (!s.effects.some((e) => e.kind === FX_DEALT && e.operativeId === attacker.id)) {
      addEffect(ctx, { source: SYMBOLS, seat: attacker.seat, kind: FX_DEALT, operativeId: attacker.id, expires: 'action' })
    }
    return null
  },
  'bl.damage.inflicted',
)

registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !isBl(op) || !live(op) || !equipped(s, op.seat, SYMBOLS)) return null
    if (s.effects.some((e) => e.kind === FX_DEALT && e.operativeId === op.id)) {
      removeEffects(ctx, (e) => e.kind === FX_DEALT && e.operativeId === op.id)
      regainWounds(ctx, op.id, 1, SYMBOLS)
      markFired('blSymbols')
    }
    return null
  },
  'bl.action.ended',
)

// ---------------------------------------------------------------------------
// Before removal: Blooded Icon, Explosive Demise, Bitter Demise (T-BL.8, T-BL.11, T-BL.39)
// ---------------------------------------------------------------------------

function crowdAround(s: GameState, v: Operative, foesOnly: boolean): Operative[] {
  return activeOps(s).filter((o) => o.id !== v.id && live(o) && (!foesOnly || o.seat !== v.seat) && within(v, o, 2) && sees(s, v, o))
}

/**
 * With no removal queue at all (a removal nested in another rule's resolution) no decision can be raised: Explosive
 * Demise is then used when it favours the owner. Outside attacks the removal normally waits for the deferred queue
 * (pausableRemoval below), where the owner is asked.
 */
function explosiveWorthIt(s: GameState, g: Operative): boolean {
  const crowd = crowdAround(s, g, false)
  const foes = crowd.filter((o) => o.seat !== g.seat).length
  return foes >= 1 && crowd.length - foes <= foes
}

function resolveExplosive(ctx: Ctx, g: Operative): void {
  const s = ctx.state
  const crowd = crowdAround(s, g, false)
  const dice = ctx.roll('bl.explosive.trigger', inEnemyCr(s, g) ? 1 : 2)
  ctx.emit({ type: 'AbilityUsed', operativeId: g.id, abilityId: A('explosive-demise') }, g.seat)
  markFired('blExplosiveDemise')
  if (!dice.some((x) => x >= 4)) return
  const big = (g.usedLimited[BOMB] ?? 0) === 0
  for (const o of crowd) {
    if (!live(s.operatives[o.id])) continue
    const dmg = (big ? ctx.roll('bl.explosive.d6', 1)[0]! : d3(ctx, 'bl.explosive.d3')) + 2
    directDamage(ctx, o.id, dmg, g.id, 'bl.explosiveDemise')
  }
}

/** The enemy a Bitter Demise strike goes to when no player can choose: the one it would incapacitate, else the most wounded. */
function bestBitterTarget(foes: Operative[], dmg: number): Operative {
  return [...foes].sort((a, b) => Number(b.wounds <= dmg) - Number(a.wounds <= dmg) || b.maxWounds - b.wounds - (a.maxWounds - a.wounds) || (a.id < b.id ? -1 : 1))[0]!
}

/** Run the before-removal rules of `v` from `stage` on; true when a decision was raised (the removal waits). */
function demise(ctx: Ctx, vid: string, stage: 'explosive' | 'bitter'): boolean {
  const s = ctx.state
  const v = s.operatives[vid]
  if (!v || v.status !== 'active') return false
  const inQueue = !!s.removal
  if (stage === 'explosive') {
    if (v.datacardId === CARD.grenadier) {
      if (inQueue) {
        ctx.raise({
          kind: 'ability.choice',
          seat: v.seat,
          window: 'operative.incapacitated',
          context: { hook: 'blDemise', stage: 'explosive', operativeId: v.id },
          options: [opt('use', 'bl.explosive.use', { name: 'Explosive Demise' }), opt('decline', 'bl.explosive.decline', { name: 'Let it fall quietly' })],
        })
        return true
      }
      if (explosiveWorthIt(s, v)) resolveExplosive(ctx, v)
    }
    return demise(ctx, vid, 'bitter')
  }
  // BITTER DEMISE: a D3 (a 3, or 2+ for a token holder) against an enemy visible within 2"
  if (!ployActive(s, v.seat, BITTER) || !isBl(v)) return false
  const foes = crowdAround(s, v, true)
  if (foes.length === 0) return false
  const roll = d3(ctx, 'bl.bitter')
  ctx.emit({ type: 'AbilityUsed', operativeId: v.id, abilityId: BITTER, detail: String(roll) }, v.seat)
  if (roll < (holdsToken(s, v) ? 2 : 3)) return false
  if (inQueue && foes.length > 1) {
    ctx.raise({
      kind: 'ability.choice',
      seat: v.seat,
      window: 'operative.incapacitated',
      context: { hook: 'blDemise', stage: 'bitter', operativeId: v.id, damage: roll },
      options: foes.map((f) => opt(f.id, 'bl.bitter.pick', { name: f.name, wounds: f.wounds })),
    })
    return true
  }
  directDamage(ctx, bestBitterTarget(foes, roll).id, roll, v.id, 'bl.bitterDemise')
  markFired('blBitterDemise')
  return false
}

registerCodeHook({
  name: 'blDemise',
  choice(ctx, op, option, context) {
    const s = ctx.state
    if (context.stage === 'explosive') {
      if (option === 'use' && op.status === 'active') resolveExplosive(ctx, op)
      if (!demise(ctx, op.id, 'bitter')) continueRemovals(ctx)
      return
    }
    const foe = s.operatives[option]
    const dmg = Number(context.damage ?? 0)
    if (foe && live(foe) && dmg > 0) {
      directDamage(ctx, foe.id, dmg, op.id, 'bl.bitterDemise')
      markFired('blBitterDemise')
    }
    continueRemovals(ctx)
  },
})

registerHook(
  'operative.incapacitated',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const v = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !v || !isBl(v) || v.status !== 'active') return null
    // damage dealt below removes other operatives at once outside an attack, which can reach this one again: run once
    if (v.oncePerBattleUsed.includes('bl.beforeRemoval')) return null
    v.oncePerBattleUsed.push('bl.beforeRemoval')
    // BLOODED ICON: the token goes back to the pool (once per turning point, Chieftain within 6")
    if (holdsToken(s, v) && !usedThisTp(s, v.seat, LEDGER_ICON)) {
      const chief = blOps(s, v.seat).find((o) => o.datacardId === CARD.chieftain && within(o, v, 6))
      // the Chieftain falling counts too: it is within any distance of itself, even at 0 wounds
      const self = v.datacardId === CARD.chieftain
      if (chief || self) {
        markUsedTp(s, v.seat, LEDGER_ICON)
        gainPool(ctx, v.seat, POOL, 1, 'bl.icon')
        ctx.emit({ type: 'AbilityUsed', operativeId: (chief ?? v).id, abilityId: A('blooded-icon'), detail: v.id }, v.seat)
        markFired('blBloodedIcon')
      }
    }
    demise(ctx, v.id, 'explosive')
    return null
  },
  'bl.operative.incapacitated',
)

// ---------------------------------------------------------------------------
// Unique actions: Signal, Sacrilegious Actuation, STIMMS, Enforce
// ---------------------------------------------------------------------------

function signalTargets(state: GameState, op: Operative): Operative[] {
  const range = 6 + commsBonus(state, op.seat, op)
  return blOps(state, op.seat).filter((f) => f.id !== op.id && f.datacardId !== CARD.ogryn && within(op, f, range) && visible(state, bodyOf(op), bodyOf(f)))
}

registerCodeHook({
  name: 'blSignal',
  action: {
    offers(state, op): OfferSeed[] {
      return signalTargets(state, op).map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!live(t) || t.seat !== op.seat || t.id === op.id || t.datacardId === CARD.ogryn) {
        cancelAction(ctx)
        return
      }
      aplChangeNextActivation(ctx, t.id, 1, 'bl.signal')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: t.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'blActuation',
  action: {
    offers(state, op): OfferSeed[] {
      return holdsToken(state, op) ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      if (!holdsToken(ctx.state, op)) {
        cancelAction(ctx)
        return
      }
      gainPool(ctx, op.seat, POOL, 1, 'bl.actuation')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

function stimmKey(targetId: string, stimm: Stimm): string {
  return `bl.stimm:${targetId}:${stimm}`
}

function giveStimm(ctx: Ctx, seat: Seat, source: string, target: Operative, stimm: Stimm): void {
  markUsedBattle(ctx.state, seat, stimmKey(target.id, stimm))
  if (stimm === 'rejuvenated') {
    const dice = ctx.roll('bl.stimm.2d3', 2)
    regainWounds(ctx, target.id, dice.reduce((n, d) => n + Math.ceil(d / 2), 0), source)
  } else addToken(ctx, target.id, { kind: stimm === 'enraged' ? ENRAGED : FORTIFIED, owner: seat, cap: 1, expires: ['battle'] }, source)
}

registerCodeHook({
  name: 'blStimms',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of blOps(state, op.seat)) {
        if (f.id !== op.id && !friendlyCr(state, op, f)) continue
        for (const k of STIMMS) {
          if (usedThisBattle(state, op.seat, stimmKey(f.id, k))) continue
          out.push({ key: `${f.id}:${k}`, params: { targetId: f.id, param: k }, data: { name: `${STIMM_NAME[k]} on ${f.name}` } })
        }
      }
      return out
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      const k = params.param as Stimm
      if (!live(t) || t.seat !== op.seat || !STIMMS.includes(k) || usedThisBattle(ctx.state, op.seat, stimmKey(t.id, k))) {
        cancelAction(ctx)
        return
      }
      giveStimm(ctx, op.seat, def.id, t, k)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: `${t.id}:${k}` }, op.seat)
      finishAction(ctx)
    },
  },
})

// REGULAR DOSAGE (T-BL.14): a pre-battle gift of Enraged or Fortified
registerCodeHook({
  name: 'blRegularDosage',
  choice(ctx, op, option) {
    const s = ctx.state
    const [id, k] = option.split(':') as [string, Stimm]
    const t = s.operatives[id]
    if (live(t) && t.seat === op.seat && id !== op.id && (k === 'enraged' || k === 'fortified') && !usedThisBattle(s, op.seat, LEDGER_DOSAGE)) {
      markUsedBattle(s, op.seat, LEDGER_DOSAGE)
      giveStimm(ctx, op.seat, A('regular-dosage'), t, k)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('regular-dosage'), detail: `${t.id}:${k}` }, op.seat)
    }
    preBattleChoiceDone(ctx)
  },
})

/** Melee-minded operatives get Enraged first, the toughest get Fortified: the order matters for the automatic player. */
function dosageOffers(state: GameState, seat: Seat): ReactionOffer[] {
  const medic = blOps(state, seat).find((o) => o.datacardId === CARD.corpseman)
  if (!medic || usedThisBattle(state, seat, LEDGER_DOSAGE)) return []
  const melee = (o: Operative): number => Math.max(0, ...o.weapons.map((w) => (state.data.weapons[w]?.type === 'melee' ? state.data.weapons[w]!.atk * state.data.weapons[w]!.dmg.normal : 0)))
  const others = blOps(state, seat)
    .filter((o) => o.id !== medic.id)
    .sort((a, b) => melee(b) - melee(a) || (a.id < b.id ? -1 : 1))
  const out: ReactionOffer[] = []
  for (const k of ['enraged', 'fortified'] as const) {
    for (const o of others) out.push({ hook: 'blRegularDosage', operativeId: medic.id, option: `${o.id}:${k}`, labelKey: `bl.dosage.${k}`, data: { name: `${STIMM_NAME[k]} on ${o.name}`, targetId: o.id } })
  }
  return out
}

// ENFORCE (T-BL.20)
function enforceTargets(state: GameState, op: Operative): Operative[] {
  return blOps(state, op.seat).filter((f) => f.id !== op.id && within(op, f, 3) && visible(state, bodyOf(op), bodyOf(f)))
}

registerCodeHook({
  name: 'blEnforce',
  action: {
    offers(state, op): OfferSeed[] {
      return enforceTargets(state, op).map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, _def, params) {
      const t = ctx.state.operatives[params.targetId as string]
      if (!live(t) || t.seat !== op.seat || t.id === op.id) {
        cancelAction(ctx)
        return
      }
      const deny = t.datacardId === CARD.commsman ? { deny: [`ability:${A('sacrilegious-actuation')}`, `ability:${A('signal')}`] } : {}
      const started = startDelegatedAction(ctx, { operativeId: t.id, resume: 'bl.enforce', rules: { oneApOnly: true, maxMove: 2, ...deny }, data: { performerId: op.id } })
      if (!started) cancelAction(ctx)
    },
  },
})

// the picked operative's free action is over (or declined): the Enforcer's action is spent
registerFrameResume('bl.enforce', (ctx, _outcome, data) => {
  const act = ctx.state.firefight.activation
  if (!act?.declared) return
  const performer = ctx.state.operatives[String(data.performerId)]
  if (performer) ctx.emit({ type: 'AbilityUsed', operativeId: performer.id, abilityId: A('enforce') }, performer.seat)
  finishAction(ctx)
})

// ---------------------------------------------------------------------------
// Strategy ploys: flags and Glory Kill
// ---------------------------------------------------------------------------

// RECKLESS ASPIRANT, MALEVOLENT GRIT and BITTER DEMISE are turning point flags the handlers above read
registerCodeHook({
  name: 'blFlagPloy',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

registerCodeHook({
  name: 'blGloryKill',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const mine = blOps(state, seat)
      return enemiesOf(state, { seat })
        .filter((e) => live(e) && mine.some((m) => visible(state, bodyOf(m), bodyOf(e))))
        .map((e) => ({ param: e.id }))
    },
    apply(ctx, seat, ploy, seed) {
      const foe = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!live(foe)) return
      addToken(ctx, foe.id, { kind: GLORY_TOKEN, owner: seat, cap: 1, expires: ['turningPointEnd'] }, 'bl.glory-kill')
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id, detail: foe.id }, seat)
    },
  },
})

// ---------------------------------------------------------------------------
// Firefight ploys: Callous Disregard, Moment of Repute, Reward Earned, Dark Favour
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'blCallousDisregard',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      // a counteracting operative performs a Shoot action too, so the ploy is offered there as well
      if (!op || op.seat !== seat || info.action !== 'shoot' || !isBl(op) || !live(op)) return []
      if (!op.weapons.some((w) => state.data.weapons[w]?.type === 'ranged')) return []
      return [{ operativeId: op.id }]
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (id) addEffect(ctx, { source: ploy.id, seat, kind: FX_CALLOUS, operativeId: id, expires: 'action' })
    },
  },
})

registerCodeHook({
  name: 'blMomentOfRepute',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.counteracting || !isBl(op) || !live(op) || op.flags.ignoreApl || !underGaze(state, op)) return []
      return [{ operativeId: op.id }]
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (!id) return
      applyAplEffect(ctx, id, 1, ploy.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: id, abilityId: ploy.id }, seat)
    },
  },
})

/**
 * Enemy kills of the seat's token holders: the holder within 2" of where the victim stood. Every kill is offered once,
 * in its own `operative.killed` window right after the removal: an attack kill through the attack's removal queue, a
 * rule kill (cause `direct`: Avalanche of Muscle, a mine) through the deferred removal queue, in either seat's
 * activation. Declined there, it is not offered again.
 */
function rewardable(state: GameState, seat: Seat, info: { window: string; subjectId?: string; removedId?: unknown }): boolean {
  if (info.window !== 'operative.killed') return false
  const killer = info.subjectId ? state.operatives[info.subjectId] : undefined
  const removed = typeof info.removedId === 'string' ? state.operatives[info.removedId] : undefined
  return !!killer && !!removed && live(killer) && killer.seat === seat && removed.seat !== seat && holdsToken(state, killer) && within(killer, removed, 2)
}

registerCodeHook({
  name: 'blRewardEarned',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      return rewardable(state, seat, info) ? [{}] : []
    },
    apply(ctx, seat, ploy) {
      gainPool(ctx, seat, POOL, 1, 'bl.rewardEarned')
      ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: ploy.id }, seat)
    },
  },
})

registerCodeHook({
  name: 'blDarkFavour',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const target = info.targetId ? state.operatives[info.targetId] : undefined
      const a = state.attack
      if (!target || !a || target.seat !== seat || info.subjectId !== target.id || !live(target) || !holdsToken(state, target)) return []
      if (a.kind === 'shoot') {
        const attacker = state.operatives[a.operativeId]
        if (!attacker || !a.weaponId || a.index >= a.targets.length) return []
        const rules = ruleSetFor(state, attacker, a.weaponId, 'shoot', target.id)
        if (rules.blast !== null || rules.torrent !== null) return []
      } else if (!a.fight) return []
      return blOps(state, seat)
        .filter((o) => o.id !== target.id && within(target, o, 3) && sees(state, target, o))
        .map((o) => ({ param: o.id }))
    },
    apply(ctx, seat, ploy, seed) {
      const a = ctx.state.attack
      if (!seed.param || !a) return
      // the substitute is in cover or obscured only if the original target was
      const status = a.kind === 'shoot' && a.status ? { cover: a.status.cover, obscured: a.status.obscured, improvedCover: a.status.improvedCover } : undefined
      if (redirectAttack(ctx, seed.param, status)) ctx.emit({ type: 'AbilityUsed', operativeId: seed.param, abilityId: ploy.id }, seat)
    },
  },
})

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  // CHEM-ENHANCED (a) and GRUELLING DISCIPLINARIAN (T-BL.24, T-BL.19), live (flags refresh after every step)
  flags(state, op) {
    if (!isBl(op)) return null
    if (op.datacardId === CARD.ogryn) return { ignoreApl: true }
    if (state.effects.some((e) => e.kind === FX_DISCIPLINED && e.operativeId === op.id) || (op.status === 'active' && enforcerNear(state, op))) return { ignoreInjured: true }
    return null
  },

  // SHIELDING (T-BL.31)
  moveDelta(state, op) {
    return isBl(op) && hasToken(state, op.id, SHIELDING, op.seat) ? -2 : 0
  },

  // WRETCHED (a) (T-BL.22)
  chargeUnderConceal(_state, op) {
    return op.datacardId === CARD.flenser
  },

  // GROUP ACTIVATION (T-BL.32)
  chainActivation(state, expended, wasChained) {
    if (wasChained || expended.datacardId !== CARD.trooper) return null
    return activeOps(state)
      .filter((o) => o.seat === expended.seat && o.id !== expended.id && o.ready && live(o) && o.datacardId === CARD.trooper)
      .map((o) => o.id)
  },

  // GRENADIER (T-BL.10)
  ownGrenades(_state, op) {
    return op.datacardId === CARD.grenadier ? { weapons: { [FRAG]: 1, [KRAK]: 1 } } : null
  },

  // SHIELD (T-BL.30): each block of the Trench Sweeper's bayonet & shield cancels two successes
  blockCapacity(_state, attack, seat) {
    const seq = attack.seq
    if (!seq) return null
    const side = seq.atk.seat === seat && seq.atk.weaponId ? seq.atk : seq.def
    return side && side.seat === seat && side.weaponId === SHIELD_WEAPON ? 2 : null
  },

  // CAMO CLOAK (T-BL.27): one more cover save, never with Vantage's improved cover
  extraCoverSaves(state, op) {
    if (op.datacardId !== CARD.sharpshooter || state.attack?.status?.improvedCover || state.attack?.seq?.improvedCover) return 0
    return 1
  },

  // SINISTER TROPHIES (T-BL.45)
  rerollBannedValues(state, info) {
    if (info.defence) return null
    const holder = state.operatives[info.opponentId]
    const roller = state.operatives[info.rollerId]
    if (!holder || !roller || !isBl(holder) || roller.seat === holder.seat) return null
    if (!equipped(state, holder.seat, TROPHIES) || !holdsToken(state, holder) || !within(holder, roller, 2)) return null
    return [1]
  },

  // REGULAR DOSAGE (T-BL.14)
  preBattleChoices(state, seat) {
    return dosageOffers(state, seat)
  },
  // M10 batch D shared: outside an attack, a falling Grenadier (Explosive Demise) or a Bitter Demise operative waits for
  // the end-of-step removal queue, where its owner is asked like inside an attack
  pausableRemoval(state, op) {
    if (!isBl(op) || op.oncePerBattleUsed.includes('bl.beforeRemoval')) return false
    return op.datacardId === CARD.grenadier || ployActive(state, op.seat, BITTER)
  },
})

// ---------------------------------------------------------------------------
// Ploy rules: Avalanche of Muscle, Shielding, the Chaos Sigil
// ---------------------------------------------------------------------------

function free(id: string, ployId: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id, ployId, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

const blPloyRule: PloyRule = {
  extraOffers(state, seat, window, info) {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    // AVALANCHE OF MUSCLE (T-BL.23): between a Charge's move and the end of the action
    if (window === 'firefight.chargeMoved' && subject && subject.seat === seat && live(subject) && subject.datacardId === CARD.ogryn && !state.effects.some((e) => e.source === FX_AVALANCHE && e.operativeId === subject.id)) {
      for (const f of enemiesInControlRange(state, subject, seat).filter(live)) out.push(free(`bl.avalanche@${f.id}`, A('avalanche-of-muscle'), 'Avalanche of Muscle', 'bl.avalanche', subject, f.id))
    }
    // SHIELDING (T-BL.31): at the start of the Trench Sweeper's own activation
    if (window === 'firefight.activationStart' && subject && subject.seat === seat && !info.counteracting && live(subject) && subject.datacardId === CARD.sweeper && !hasToken(state, subject.id, SHIELDING, seat)) {
      out.push(free(`bl.shielding@${subject.id}`, A('shielding'), 'Shielding', 'bl.shielding', subject))
    }
    return out
  },
  costAdjust(state, seat, ploy) {
    return ploy.id === REWARD && equipped(state, seat, SIGIL) ? { cost: 0, via: 'bl.sigil' } : null
  },
  onUsed(ctx, seat, offer) {
    const s = ctx.state
    const op = offer.operativeId ? s.operatives[offer.operativeId] : undefined
    if (offer.via === 'bl.sigil') {
      markFired('blRewardEarned')
      return
    }
    if (!op || !live(op)) return
    if (offer.via === 'bl.avalanche') {
      const foe = offer.param ? s.operatives[offer.param] : undefined
      addEffect(ctx, { source: FX_AVALANCHE, seat, kind: 'ployFlag', operativeId: op.id, expires: 'action' })
      if (live(foe)) {
        directDamage(ctx, foe.id, d3(ctx, 'bl.avalanche'), op.id, 'bl.avalanche')
        ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('avalanche-of-muscle'), detail: foe.id }, seat)
        markFired('blAvalanche')
      }
      return
    }
    if (offer.via === 'bl.shielding') {
      addToken(ctx, op.id, { kind: SHIELDING, owner: seat, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'bl.shielding')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: A('shielding') }, seat)
      markFired('blShielding')
    }
  },
}

registerPloyRule(blPloyRule)

// kept for the tests and the AI: the live tokens an operative holds
export function tokenKinds(state: GameState, opId: string): string[] {
  return tokensOn(state, opId).map((t) => t.kind)
}

// the helpers below are exported for the tests
export { enforcerNear, nearLightOrHeavy }
