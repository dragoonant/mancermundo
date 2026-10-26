// Hearthkyn Salvagers (docs/spec/13-teams.md section 10, rule ids T-HK.n): the code hooks this team's data names, its
// team rule provider (team-rules.ts registerTeamRules) and its hook handlers (hooks.ts registerHook). Everything is built
// on the M9 generic capabilities; no shared engine file names Hearthkyn Salvagers.
//
//  - Grudge: tokens.ts kind 'hk.grudge' (owned by the Hearthkyn player, no cap, kept all battle). The last enemy to hurt
//    each Hearthkyn operative is remembered (damage.inflicted) and gets the token when that operative is incapacitated
//    (operative.incapacitated); the tokens turn normal successes into crits on afterAttackRoll.
//  - Medic!, Brawler's last strike, Weavefield Crest, Secure Salvage: beforeIncapacitated / onDamageInflicted; Medic! is
//    then the owner's choice in the before-removal queue (operative.incapacitated, saveFromRemoval, pausableRemoval).
//  - Knux Smash, Jump Pack, Utility Grenade, markers (Attack, Defence, Pan Spectral Scan), System Jam, Spot: generic
//    forced move, FLY, markers, tokens and provider capabilities.
//  - Beam (team-local weapon rule): afterAttackRoll predicts the retained crits and deals the beam damage there.
import { abilityOffers, maxRepeats } from '../abilities'
import { applyAplEffect, continueRemovals, countKinds, hasRule, heavyBlocksMove, retainAttack, ruleSetFor, saveFromRemoval, targetInfo, type RuleSet } from '../attack-common'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { canBeTargetedBy, hasAbility, hasKeyword, inEnemyCr } from '../conditions'
import { addEffect, aplChangeNextActivation, directDamage, gainCp, markUsedBattle, markUsedTp, regainWounds, removeEffects, usedThisBattle, usedThisTp } from '../effects'
import { extraStrike } from '../fight'
import { canStartFreeAction, cancelAction, finishAction, REACTION_DONE, reactionDone, startDelegatedAction, startFreeAction } from '../firefight'
import { pointGapToFootprint, footprintOf } from '../footprint'
import { round3 } from '../geometry'
import { registerFrameResume, registerHook, type HookContext } from '../hooks'
import { bodyOf, interveningTraits, visible } from '../los'
import { contestedBy, controlledBy, newMarkerId, removeMarker } from '../markers'
import { distanceBetween, enemiesInControlRange, gapToMarker, inControlRange, isWithin } from '../measure'
import { applyForcedMove, forcedMoveSpots } from '../movement'
import { registerPloyRule, type PloyOffer, type PloyRule } from '../ploy-rules'
import { continueWindow } from '../ploys'
import { markerControl } from '../query'
import type { Ctx } from '../registry'
import { activeOps, enemiesOf, hasInjuredPenalty, isInjured, otherSeat, SEATS } from '../state'
import { resumeGambit } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, removeToken, tokenCount, tokensOn } from '../tokens'
import type { Activation, GameState, Marker, Operative, RerollGrant, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'hearthkyn-salvagers'

export const GRUDGE = 'hk.grudge'
export const JAM = 'hk.system-jam'
export const SPOT = 'hk.spot'
const HK = 'HEARTHKYN SALVAGER'
const EPS = 1e-6
/** Medic!: the moment an operative would be incapacitated, the medic that may save it (the owner answers before removal) */
const MEDIC_ASK = 'hk.medicAsk'

const M_UTILITY = 'hk.utility-grenade'
const M_ATTACK = 'hk.attack-marker'
const M_DEFENCE = 'hk.defence-marker'
const M_SCAN = 'hk.pan-spectral-scan'

const ID = {
  eye: 'hk.p.eye-of-the-ancestors',
  tactician: 'hk.p.tactician',
  needKeeps: 'hk.p.need-keeps',
  toil: 'hk.p.toil-earns',
  wrought: 'hk.p.wrought-defence',
  proximate: 'hk.p.proximate-firepower',
  ancestors: 'hk.p.the-ancestors-are-watching',
  worthIt: 'hk.p.worth-it',
  sturdy: 'hk.p.sturdy',
  engage: 'hk.p.engage-to-acquire',
  medic: 'hk.a.medic',
  crestCard: 'hk.a.weavefield-crest',
  brawler: 'hk.a.brawler',
  salvage: 'hk.a.secure-salvage',
  grenadier: 'hk.a.grenadier',
  jump: 'hk.a.jump-pack',
  lugger: 'hk.a.well-supplied',
  tacticianCard: 'hk.a.tactician',
  rigs: 'hk.e.climbing-rigs',
  excavation: 'hk.e.excavation-tools',
  writ: 'hk.e.writ-of-claim',
  beamRule: 'hk.wr.beam',
  forceRule: 'hk.wr.force-impact',
} as const

const FRAG = 'core.w.frag-grenade'
const KRAK = 'core.w.krak-grenade'
const SMOKE = 'core.a.smoke-grenade'
const STUN = 'core.a.stun-grenade'

// Passive rules register their name so the data may name them; the handlers below mark them fired where they bite.
for (const name of ['hkGrudge', 'hkBeam', 'hkForceImpact', 'weavefieldCrest', 'hkBrawler', 'hkGrenadier', 'hkJumpPack', 'hkWellSupplied', 'secureSalvage']) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export const isHk = (s: GameState, op: Operative | undefined): op is Operative => !!op && hasKeyword(s, op, HK)
const live = (o: Operative | undefined): o is Operative => !!o && o.status === 'active' && o.wounds > 0
const d3 = (ctx: Ctx, purpose: string): number => Math.ceil(ctx.roll(purpose, 1)[0]! / 2)

function hkOps(s: GameState, seat: Seat): Operative[] {
  return activeOps(s).filter((o) => o.seat === seat && live(o) && isHk(s, o))
}

function equipped(s: GameState, seat: Seat, id: string): boolean {
  return s.players[seat].equipment.includes(id)
}

function ployEffect(s: GameState, source: string, seat: Seat): boolean {
  return s.effects.some((e) => e.source === source && e.seat === seat)
}

function opOfHook(c: HookContext): Operative | undefined {
  return c.state && c.operativeId ? c.state.operatives[c.operativeId] : undefined
}

function weaponOfId(s: GameState, id: string | undefined) {
  return id ? s.data.weapons[id] : undefined
}

/** The activation under a free-action frame (an enemy Guard interrupt, a free Charge), or the current one. */
function activeActivationOf(s: GameState): Activation | null {
  const cur = s.firefight.activation
  if (!cur) return null
  return cur.frame ? ((s.firefight.stack ?? []).at(-1) ?? null) : cur
}

/** Friendly Hearthkyn operatives incapacitated so far (Eye of the Ancestors). */
export function incapacitatedCount(s: GameState, seat: Seat): number {
  return Object.values(s.operatives).filter((o) => o.seat === seat && o.status === 'removed' && isHk(s, o)).length
}

function choiceOpt(id: string, labelKey: string, data: Record<string, unknown> = {}) {
  return { id, labelKey, type: 'ability.choice' as const, payload: { option: id }, data }
}

// ---------------------------------------------------------------------------
// GRUDGE (T-HK.27, T-HK.28)
// ---------------------------------------------------------------------------

/** Grudge tokens the enemy counts for: its real tokens of the seat plus one for each Toil Earns marker within 3". */
export function grudgeCount(s: GameState, seat: Seat, foe: Operative): number {
  let n = tokenCount(s, foe.id, GRUDGE, seat)
  for (const e of s.effects) {
    if (e.source !== ID.toil || e.seat !== seat) continue
    const m = s.markers.find((k) => k.id === e.data?.markerId)
    if (m && gapToMarker(bodyOf(foe), m) <= 3 + EPS) {
      n += 1
      markFired('toilEarns')
    }
  }
  return n
}

/** Damage that counts as an enemy operative's attack or action (not Poison, mines or the victim's own Hot). */
const ATTACK_SOURCES = ['normal', 'crit', 'devastating', 'strike-normal', 'strike-crit']

registerHook(
  'damage.inflicted',
  (c) => {
    const s = c.state
    const victim = opOfHook(c)
    if (!s || !victim || !isHk(s, victim)) return null
    const data = c.data as { source: string; attackerId: string; amount: number }
    if (data.amount <= 0) return null
    const attacker = s.operatives[data.attackerId]
    const act = s.firefight.activation
    const counts =
      !!attacker &&
      attacker.seat !== victim.seat &&
      (ATTACK_SOURCES.includes(data.source) || (data.source === 'direct' && !!act && act.operativeId === attacker.id))
    // every instance of damage replaces the memory: the last one decides who incapacitates the victim
    let fx = s.effects.find((e) => e.kind === 'hk.lastHit' && e.operativeId === victim.id)
    if (!fx && c.engine) fx = addEffect(c.engine, { source: ID.crestCard, seat: victim.seat, kind: 'hk.lastHit', operativeId: victim.id, expires: 'battle', data: {} })
    if (fx) fx.data = { attackerId: counts ? attacker!.id : null }
    return null
  },
  'hk.damage.inflicted',
)

registerHook(
  'operative.incapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = opOfHook(c)
    if (!s || !ctx || !victim || !isHk(s, victim)) return null
    // Medic! may still keep it in the fight: the medic hook below asks first and settles this afterwards
    if (effectFor(s, MEDIC_ASK, victim.id)) return null
    fallen(ctx, victim)
    return null
  },
  'hk.operative.incapacitated',
)

/** A Hearthkyn operative is really incapacitated: its Pan Spectral Scan goes, and the last enemy to hurt it gains a Grudge. */
function fallen(ctx: Ctx, victim: Operative): void {
  const s = ctx.state
  // Pan Spectral Scan goes with the Lokatr that placed it (T-HK.23)
  for (const m of [...s.markers]) if (m.equipmentId === M_SCAN && m.placedBy === victim.id) removeMarker(ctx, m.id, 'hk.panSpectralScan')
  const fx = s.effects.find((e) => e.kind === 'hk.lastHit' && e.operativeId === victim.id)
  const attackerId = fx?.data?.attackerId as string | null | undefined
  if (fx) removeEffects(ctx, (e) => e.id === fx.id)
  const attacker = attackerId ? s.operatives[attackerId] : undefined
  if (live(attacker) && attacker.seat !== victim.seat) {
    addToken(ctx, attacker.id, { kind: GRUDGE, owner: victim.seat, expires: ['battle'] }, 'grudge')
    markFired('hkGrudge')
  }
}

registerHook(
  'afterAttackRoll',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.targetId || !isHk(s, op)) return null
    const foe = s.operatives[c.targetId]
    if (!foe) return null
    const data = c.data as { kind: 'shoot' | 'fight'; dice: { kind: string; tag?: string; used?: boolean }[]; obscured?: boolean }
    // an obscured target shuts every crit-making rule off (R-5.8); read the hook data, so the odds (query.*, no attack
    // in state) agree with the real Shoot
    if (data.kind === 'shoot' && data.obscured) return null
    const n = grudgeCount(s, op.seat, foe)
    if (n <= 0) return null
    let left = n - data.dice.filter((d) => d.tag === 'grudge').length
    for (const d of data.dice) {
      if (left <= 0) break
      if (d.kind === 'normal' && !d.used) {
        d.kind = 'crit'
        d.tag = 'grudge'
        left--
        markFired('hkGrudge')
      }
    }
    return null
  },
  'hk.afterAttackRoll.grudge',
)

// ---------------------------------------------------------------------------
// BEAM (T-HK.15): the EtaCarn plasma beamer's crits burn everything along one line through the target
// ---------------------------------------------------------------------------

/** An operative's base as a radius for beam lines (ovals use their full half length). */
const reach = (o: Operative): number => o.baseRadius + (o.ovalHalfAxis ?? 0)

/**
 * The distinct sets of operatives a single targeting line from the shooter reaches through the target's base: sampled
 * across the target's angular width, operatives behind the target only, never past Heavy terrain.
 */
export function beamSets(s: GameState, shooter: Operative, target: Operative): Operative[][] {
  const sx = shooter.pos.x
  const sz = shooter.pos.z
  const dx = target.pos.x - sx
  const dz = target.pos.z - sz
  const d = Math.hypot(dx, dz)
  const rT = reach(target)
  if (d <= rT + EPS) return []
  const theta0 = Math.atan2(dz, dx)
  const half = Math.asin(Math.min(1, rT / d)) * 0.96
  const others = activeOps(s).filter((o) => live(o) && o.id !== shooter.id && o.id !== target.id)
  const seen = new Map<string, Operative[]>()
  const N = 6
  for (let k = -N; k <= N; k++) {
    const th = theta0 + (half * k) / N
    const ux = Math.cos(th)
    const uz = Math.sin(th)
    const along: Operative[] = []
    for (const o of others) {
      const vx = o.pos.x - sx
      const vz = o.pos.z - sz
      const t = vx * ux + vz * uz
      const p = Math.abs(vx * uz - vz * ux)
      // behind the target (past its centre along this line) and the line touches the operative's base
      if (t <= d * Math.cos(th - theta0) + EPS || p > reach(o) + EPS) continue
      if (interveningTraits(s, bodyOf(shooter), bodyOf(o)).heavy) continue
      along.push(o)
    }
    if (along.length === 0) continue
    along.sort((a, b) => (a.id < b.id ? -1 : 1))
    seen.set(along.map((o) => o.id).join('+'), along)
  }
  return [...seen.values()]
}

/** What a beam set is worth to the shooter: enemy wounds it would take minus friendly wounds, for `crits` crits. */
function beamValue(set: Operative[], shooter: Operative, crits: number): number {
  let v = 0
  for (const o of set) {
    const dmg = Math.min(o.wounds, 2 * crits)
    v += o.seat === shooter.seat ? -dmg : dmg
  }
  return v
}

/** Crits the attack would retain, by running retention on a copy of the dice (Rending, Severe and Grudge included). */
function predictedCrits(s: GameState, ctx: Ctx, shooter: Operative, targetId: string, weaponId: string, dice: { kind: string }[], obscured: boolean): number {
  const seq = s.attack?.seq
  if (!seq) return 0
  const copy = { ...seq.atk, dice: seq.atk.dice.map((d) => ({ ...d })) }
  void dice
  const rules: RuleSet = ruleSetFor(s, shooter, weaponId, 'shoot', targetId, ctx)
  retainAttack(copy, rules, obscured)
  return countKinds(copy.dice).crit
}

registerHook(
  'afterAttackRoll',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const shooter = opOfHook(c)
    if (!s || !ctx || !shooter || !c.weaponId || !c.targetId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; dice: { kind: string }[]; requests: { id: string; seat: Seat; labelKey: string; options: { id: string; labelKey: string }[] }[]; choices: Record<string, string> }
    const weapon = weaponOfId(s, c.weaponId)
    if (data.kind !== 'shoot' || !weapon || !hasRule(weapon.rules, 'beam')) return null
    const target = s.operatives[c.targetId]
    if (!target || data.choices['hk.beam.done']) return null
    const obscured = (c.data as { obscured?: boolean }).obscured ?? s.attack?.seq?.obscured ?? false
    const crits = predictedCrits(s, ctx, shooter, target.id, weapon.id, data.dice, obscured)
    if (crits <= 0) return null
    const sets = beamSets(s, shooter, target)
    if (sets.length === 0) return null
    sets.sort((a, b) => beamValue(b, shooter, crits) - beamValue(a, shooter, crits))
    let chosen = sets[0]!
    if (sets.length > 1) {
      const answer = data.choices['hk.beam']
      if (answer === undefined) {
        data.requests.push({
          id: 'hk.beam',
          seat: shooter.seat,
          labelKey: 'hk.beam.line',
          options: sets.map((set, i) => ({ id: `line${i}`, labelKey: `hk.beam.line:${set.map((o) => o.name.replace(/[.:]/g, '')).join(' and ')}` })),
        })
        return null
      }
      chosen = sets[Number(answer.replace('line', ''))] ?? sets[0]!
    }
    data.choices['hk.beam.done'] = '1'
    for (let i = 0; i < crits; i++) {
      for (const o of chosen) {
        if (!live(s.operatives[o.id])) continue
        directDamage(ctx, o.id, d3(ctx, 'hk.beam.d3'), shooter.id, 'hk.beam')
      }
    }
    ctx.emit({ type: 'AbilityUsed', operativeId: shooter.id, abilityId: ID.beamRule, detail: chosen.map((o) => o.id).join(',') }, shooter.seat)
    markFired('hkBeam')
    return null
  },
  'hk.afterAttackRoll.beam',
)

// ---------------------------------------------------------------------------
// Weavefield Crest (T-HK.8), Brawler (T-HK.9), Secure Salvage (T-HK.26): damage reductions
// ---------------------------------------------------------------------------

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op) return null
    const data = c.data as { source: string; amount: number }
    if (data.amount <= 0) return null
    // Medic!: nothing can incapacitate the casualty for the rest of the action (T-HK.11)
    if (s.effects.some((e) => e.kind === 'hk.medicFloor' && e.operativeId === op.id)) data.amount = Math.max(0, Math.min(data.amount, op.wounds - 1))
    // Weavefield Crest: once per battle, a Normal Dmg die is ignored; used on the first one that matters
    if ((data.source === 'normal' || data.source === 'strike-normal') && data.amount > 0 && hasAbility(s, op, ID.crestCard) && !usedThisBattle(s, op.seat, `hk.crest:${op.id}`)) {
      const after = op.wounds - data.amount
      if (after <= 0 || (!op.flags.injured && after * 2 < op.maxWounds)) {
        markUsedBattle(s, op.seat, `hk.crest:${op.id}`)
        data.amount = 0
        markFired('weavefieldCrest')
        c.engine?.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.crestCard }, op.seat)
        return null
      }
    }
    // Brawler: a Normal Dmg of 4 or more does 1 less to the Dozr in a fight
    if (data.source === 'strike-normal' && data.amount >= 4 && hasAbility(s, op, ID.brawler)) {
      data.amount -= 1
      markFired('hkBrawler')
    }
    // Secure Salvage: one success of an attack against a Warrior holding a claim does 1 less
    if (['normal', 'crit', 'strike-normal', 'strike-crit'].includes(data.source) && hasAbility(s, op, ID.salvage)) {
      const seq = s.attack?.seq
      const claims = contestedBy(s, op).some((m) => m.kind === 'objective')
      if (seq && claims && !seq.choices['hk.salvage']) {
        seq.choices['hk.salvage'] = '1'
        data.amount -= 1
        markFired('secureSalvage')
      }
    }
    return null
  },
  'hk.onDamageInflicted',
)

// Brawler (b): a Dozr cut down in a fight first strikes with one unresolved success (T-HK.9)
registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = opOfHook(c)
    if (!s || !ctx || !victim) return null
    if (hasAbility(s, victim, ID.brawler)) brawlerLastStrike(s, ctx, victim)
    medicAsk(s, ctx, victim)
    return null
  },
  'hk.beforeIncapacitated',
)

function brawlerLastStrike(s: GameState, ctx: Ctx, dozr: Operative): void {
  const a = s.attack
  if (!a || a.kind !== 'fight' || !a.seq || !a.fight) return
  if (a.operativeId !== dozr.id && a.fight.targetId !== dozr.id) return
  const foeId = a.operativeId === dozr.id ? a.fight.targetId : a.operativeId
  if (!live(s.operatives[foeId])) return
  const seq = a.seq
  const mine = seq.atk.operativeId === dozr.id ? seq.atk : seq.def && seq.def.operativeId === dozr.id ? seq.def : null
  if (!mine || !mine.weaponId) return
  let die = mine.dice.findIndex((d) => !d.used && d.kind === 'crit')
  if (die < 0) die = mine.dice.findIndex((d) => !d.used && d.kind === 'normal')
  if (die < 0) return
  if (extraStrike(ctx, dozr.seat, die)) {
    markFired('hkBrawler')
    ctx.emit({ type: 'AbilityUsed', operativeId: dozr.id, abilityId: ID.brawler, detail: foeId }, dozr.seat)
  }
}

// ---------------------------------------------------------------------------
// Medic! (T-HK.11) and MEDIKIT (T-HK.12): the Pathfinders code path with Hearthkyn operatives
// ---------------------------------------------------------------------------

function effectFor(s: GameState, kind: string, opId: string) {
  return s.effects.find((e) => e.kind === kind && e.operativeId === opId)
}

function medicFor(s: GameState, victim: Operative): Operative | null {
  if (!isHk(s, victim) || victim.status !== 'active' || inEnemyCr(s, victim)) return null
  const a = s.attack
  for (const m of hkOps(s, victim.seat)) {
    if (m.id === victim.id || !hasAbility(s, m, ID.medic) || usedThisTp(s, m.seat, `hk.medic:${m.id}`)) continue
    if (distanceBetween(bodyOf(m), bodyOf(victim)) > 3 + EPS) continue
    if (!visible(s, bodyOf(m), bodyOf(victim))) continue
    if (inEnemyCr(s, m)) continue
    // in a Shoot action the medic must not be a primary or secondary target
    if (a?.kind === 'shoot' && a.targets.includes(m.id)) continue
    return m
  }
  return null
}

/**
 * The operative "would be incapacitated": the conditions are checked at that moment and the medic is recorded
 * (MEDIC_ASK; the turning point's use is spent, so declining spends it). The owner answers in the before-removal queue
 * (the operative.incapacitated hook below); taking it keeps the operative (attack-common.saveFromRemoval). Removals
 * outside an attack (mines, direct damage) wait for that queue through the provider's pausableRemoval.
 */
function medicAsk(s: GameState, ctx: Ctx, victim: Operative): void {
  const medic = medicFor(s, victim)
  if (!medic) return
  markUsedTp(s, medic.seat, `hk.medic:${medic.id}`)
  const carrying = victim.flags.carrying
  addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: MEDIC_ASK, operativeId: victim.id, expires: 'turningPoint', data: { medicId: medic.id, ...(carrying ? { carrying } : {}) } })
}

// the owner's decision, before removal (R-5.18)
registerHook(
  'operative.incapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = opOfHook(c)
    if (!s || !ctx || !victim) return null
    const ask = effectFor(s, MEDIC_ASK, victim.id)
    if (!ask) return null
    const medic = s.operatives[String(ask.data?.medicId)]
    // only a queue can wait for the answer, and the medic must still be in the killzone
    if (!s.removal || !s.removal.ids.includes(victim.id) || s.pending || !medic || !live(medic)) {
      removeEffects(ctx, (e) => e.id === ask.id)
      fallen(ctx, victim)
      return null
    }
    ctx.raise({
      kind: 'ability.choice',
      seat: victim.seat,
      window: 'operative.incapacitated',
      context: { hook: 'hkMedic', operativeId: victim.id, medicId: medic.id },
      options: [
        { id: 'save', labelKey: 'removal.free', type: 'ability.choice' as const, payload: { option: 'save' }, data: { name: `Medic! (${medic.name}): keep it in the fight on 1 wound`, medicId: medic.id } },
        { id: 'none', labelKey: 'removal.free', type: 'ability.choice' as const, payload: { option: 'none' }, data: { name: 'Let it fall' } },
      ],
    })
    return null
  },
  'hk.medicAsk',
)

function medicAnswer(ctx: Ctx, victim: Operative, use: boolean): void {
  const s = ctx.state
  const ask = effectFor(s, MEDIC_ASK, victim.id)
  const medic = ask ? s.operatives[String(ask.data?.medicId)] : undefined
  if (ask) removeEffects(ctx, (e) => e.id === ask.id)
  if (use && ask && medic && live(medic) && saveFromRemoval(ctx, victim.id, 1)) medicSaved(ctx, victim, medic, ask.data?.carrying as string | undefined)
  else fallen(ctx, victim)
  continueRemovals(ctx)
}

/** Medic! taken: 1 wound, the rest of the action safe, a free Dash after it, -1 APL for both (T-HK.11). */
function medicSaved(ctx: Ctx, victim: Operative, medic: Operative, carrying: string | undefined): void {
  const s = ctx.state
  markUsedTp(s, medic.seat, `hk.medic.saved:${victim.id}`)
  if (!victim.flags.injured && isInjured(victim)) {
    victim.flags.injured = true
    ctx.emit({ type: 'OperativeInjured', operativeId: victim.id })
  }
  // it was never incapacitated: a marker it carried (dropped by the shared before-removal step) is still its own
  const m = carrying ? s.markers.find((x) => x.id === carrying) : undefined
  if (m && !m.carriedBy && !victim.flags.carrying) {
    m.carriedBy = victim.id
    m.pos = { x: victim.pos.x, z: victim.pos.z }
    victim.flags.carrying = m.id
    ctx.emit({ type: 'MarkerPickedUp', markerId: m.id, operativeId: victim.id }, victim.seat)
  }
  const deferred = !!s.removal?.deferred
  // an attack's queue is still inside the action: nothing can incapacitate it for the rest of it
  if (!deferred) addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: 'hk.medicFloor', operativeId: victim.id, expires: 'action' })
  // the activation the rule was used in: the one under a frame (an enemy Guard interrupt, a free action) counts
  const under = activeActivationOf(s)
  const own = !!under && !under.counteract && under.operativeId === victim.id
  if (own) {
    // used in its own activation: that activation ends once the action is done (no AP left to spend); a removal
    // outside an attack runs after the step, so the activation's waiting action choice keeps only End
    under.endsAfterAction = true
    const parked = s.removal?.parked
    if (deferred && parked?.kind === 'firefight.action' && s.firefight.activation === under && parked.options?.some((o) => o.id === 'end')) {
      s.removal!.parked = { ...parked, options: parked.options.filter((o) => o.id === 'end') }
    }
  }
  // the free Dash after the action: a reaction when the other player is active, a 0 CP offer in the action-ended
  // window when the Hearthkyn player is (medicRule.extraOffers)
  addEffect(ctx, { source: ID.medic, seat: victim.seat, kind: 'hk.medicDash', operativeId: victim.id, expires: 'activation', data: { medicId: medic.id } })
  // "until the end of its next activation": held over when used in the operative's own activation
  aplChangeNextActivation(ctx, victim.id, -1, ID.medic)
  aplChangeNextActivation(ctx, medic.id, -1, ID.medic)
  ctx.emit({ type: 'AbilityUsed', operativeId: medic.id, abilityId: ID.medic, detail: victim.id }, medic.seat)
  markFired('hkMedic')
}

registerCodeHook({
  name: 'hkMedic',
  /** 'save' / 'none': the owner's answer in the removal queue; 'dash': the free Dash after the action */
  choice(ctx, op, option) {
    if (option === 'save' || option === 'none') {
      medicAnswer(ctx, op, option === 'save')
      return
    }
    const fx = effectFor(ctx.state, 'hk.medicDash', op.id)
    if (!fx) {
      reactionDone(ctx)
      return
    }
    removeEffects(ctx, (e) => e.id === fx.id)
    if (!startFreeAction(ctx, { operativeId: op.id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: REACTION_DONE })) reactionDone(ctx)
  },
})

registerCodeHook({
  name: 'hkMedikit',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of hkOps(state, op.seat)) {
        if (f.wounds >= f.maxWounds) continue
        if (f.id !== op.id && !inControlRange(state, bodyOf(op), bodyOf(f))) continue
        if (usedThisTp(state, op.seat, `hk.medic.saved:${f.id}`)) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      const dice = ctx.roll('hk.medikit.2d3', 2)
      regainWounds(ctx, target.id, dice.reduce((n, d) => n + Math.ceil(d / 2), 0), def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// KNUX SMASH (T-HK.10)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'knuxSmash',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesInControlRange(state, op, op.seat)
        .filter((e) => live(e))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const target = s.operatives[params.targetId as string]
      if (!live(target) || target.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      // objectives and the Dozr's goals decide where an enemy is best pushed; the first spot offered is the best one
      const objectives = s.markers.filter((m) => m.kind === 'objective')
      const score = (p: Vec3): number => (objectives.length ? Math.min(...objectives.map((m) => Math.hypot(m.pos.x - p.x, m.pos.z - p.z))) : 0)
      // any spot the enemy can be placed at within 3" may be picked, a control range included (the push is not that
      // operative's own move, so the Reposition limits do not bind it); spots that free the Dozr for its Charge come first
      const clear = (p: Vec3): boolean => {
        const ghost = { id: target.id, pos: p, baseRadius: target.baseRadius, height: target.height }
        return !enemiesOf(s, target).some((e) => inControlRange(s, ghost, bodyOf(e)))
      }
      const all = forcedMoveSpots(s, target, 3, 24)
      const spots = [...all.filter(clear).sort((a, b) => score(b) - score(a)), ...all.filter((p) => !clear(p)).sort((a, b) => score(b) - score(a))].slice(0, 16)
      const options = [
        ...spots.map((p) => choiceOpt(`${p.x},${p.z}`, 'hk.knux.push', { x: p.x, z: p.z, name: `Push to ${p.x}, ${p.z}` })),
        choiceOpt('stay', 'hk.knux.stay', { name: 'Leave it where it is' }),
      ]
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'knuxSmash', operativeId: op.id, abilityId: def.id, targetId: target.id },
        options,
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const s = ctx.state
    const target = s.operatives[context.targetId as string]
    if (!live(target)) {
      finishAction(ctx)
      return
    }
    if (option !== 'stay') {
      const [x, z] = option.split(',').map(Number) as [number, number]
      applyForcedMove(ctx, target.id, [{ x, z }], 3)
    }
    const roll = d3(ctx, 'hk.knux.d3')
    directDamage(ctx, target.id, roll + 1, op.id, 'hk.knuxSmash')
    if (roll === 3 && live(s.operatives[target.id])) applyAplEffect(ctx, target.id, -1, String(context.abilityId))
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${target.id}:${roll}` }, op.seat)
    // then a free Charge of no more than 3", even after a Charge: only the repeat ban is lifted (R-4.4 still holds)
    const act = activeActivationOf(s)
    const barred = !!act && (['reposition', 'dash', 'fallBack'].some((a) => act.performed.includes(a)) || heavyBlocksMove(s, act.weaponsUsed, 'charge') !== null)
    if (barred || !live(s.operatives[op.id]) || !startFreeAction(ctx, { operativeId: op.id, action: 'charge', maxMove: 3, resume: 'hk.knuxCharge' })) finishAction(ctx)
  },
})

// the free Charge is over (or declined): Knux Smash itself was performed either way
registerFrameResume('hk.knuxCharge', (ctx) => finishAction(ctx))

// ---------------------------------------------------------------------------
// Utility Grenade (T-HK.14), the Tactician markers (T-HK.20, T-HK.21), Pan Spectral Scan (T-HK.23)
// ---------------------------------------------------------------------------

/** Spots within `range` the operative sees, as for the Smoke Grenade (a marker may lie under an operative). */
function visibleSpots(state: GameState, op: Operative, range: number): Vec2[] {
  const out: Vec2[] = []
  const seen = new Set<string>()
  const add = (p: Vec2) => {
    const q = { x: round3(p.x), z: round3(p.z) }
    const k = `${q.x},${q.z}`
    if (seen.has(k) || Math.abs(q.x) > 15 || Math.abs(q.z) > 11) return
    if (pointGapToFootprint(q, footprintOf(op)) > range + EPS) return
    const probe = { id: 'hk-probe', pos: { x: q.x, y: op.pos.y, z: q.z }, baseRadius: 0.05, height: 0.05 }
    if (!visible(state, bodyOf(op), probe, { operativesBlock: false })) return
    seen.add(k)
    out.push(q)
  }
  for (const e of enemiesOf(state, op)) add({ x: e.pos.x, z: e.pos.z })
  for (const d of [2, 4, 6]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      add({ x: op.pos.x + Math.sin(a) * (d + op.baseRadius), z: op.pos.z + Math.cos(a) * (d + op.baseRadius) })
    }
  }
  return out
}

/** Candidate spots for a marker that may go anywhere in the killzone: objectives, operatives and a coarse grid. */
export function anywhereSpots(state: GameState): Vec2[] {
  const out: Vec2[] = []
  const seen = new Set<string>()
  const hx = state.map.size.x / 2 - 0.5
  const hz = state.map.size.z / 2 - 0.5
  const add = (p: Vec2) => {
    const q = { x: round3(p.x), z: round3(p.z) }
    const k = `${q.x},${q.z}`
    if (seen.has(k) || Math.abs(q.x) > hx || Math.abs(q.z) > hz) return
    seen.add(k)
    out.push(q)
  }
  for (const m of state.markers) if (m.kind === 'objective') add(m.pos)
  for (const o of activeOps(state)) add({ x: o.pos.x, z: o.pos.z })
  for (let x = -hx + 2; x <= hx; x += 5) for (let z = -hz + 1.5; z <= hz; z += 5) add({ x, z })
  return out.slice(0, 44)
}

function placeMarker(ctx: Ctx, seat: Seat, equipmentId: string, pos: Vec2, by: Operative | null, extra: Partial<Marker> = {}): Marker {
  const marker: Marker = {
    id: newMarkerId(ctx, equipmentId.replace('hk.', 'hk-').slice(0, 14)),
    kind: 'equipment',
    pos: { x: pos.x, z: pos.z },
    owner: seat,
    carriedBy: null,
    controller: null,
    equipmentId,
    ...(by ? { placedBy: by.id } : {}),
    ...extra,
  }
  ctx.state.markers.push(marker)
  ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: by?.id ?? null, pos: marker.pos }, seat)
  return marker
}

function markersOf(s: GameState, seat: Seat, ...ids: string[]): Marker[] {
  return s.markers.filter((m) => m.owner === seat && !!m.equipmentId && ids.includes(m.equipmentId))
}

registerCodeHook({
  name: 'hkUtilityGrenade',
  action: {
    offers(state, op): OfferSeed[] {
      return visibleSpots(state, op, 6).length > 0 ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const spots = visibleSpots(ctx.state, op, 6)
      if (spots.length === 0) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'hkUtilityGrenade', operativeId: op.id, abilityId: def.id },
        options: spots.map((p) => choiceOpt(`${p.x},${p.z}`, 'marker.utilityGrenade', { x: p.x, z: p.z })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    placeMarker(ctx, op.seat, M_UTILITY, { x, z }, op, { clearsAfter: null })
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${x},${z}` }, op.seat)
    finishAction(ctx)
  },
})

/** Utility Grenade markers within 3" of the operative: each costs it 1 more AP for Pick Up Marker and mission actions. */
function utilityTax(s: GameState, op: Operative): number {
  let n = 0
  for (const m of s.markers) if (m.equipmentId === M_UTILITY && gapToMarker(bodyOf(op), m) <= 3 + EPS) n++
  return n
}

/** Place the Attack or Defence marker (replacing the one in play): the two markers are never in the killzone together. */
function placeTacticianMarker(ctx: Ctx, seat: Seat, kind: string, pos: Vec2, by: Operative): void {
  for (const m of markersOf(ctx.state, seat, M_ATTACK, M_DEFENCE)) removeMarker(ctx, m.id, 'hk.tactician')
  placeMarker(ctx, seat, kind === 'attack' ? M_ATTACK : M_DEFENCE, pos, by)
}

function markerSpotOptions(state: GameState, kind: string) {
  return anywhereSpots(state).map((p) => choiceOpt(`${p.x},${p.z}`, `marker.${kind}`, { x: p.x, z: p.z }))
}

registerCodeHook({
  name: 'hkTactician',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const k = hkOps(state, seat).find((o) => hasAbility(state, o, ID.tacticianCard))
      return k ? [{ param: 'attack' }, { param: 'defence' }] : []
    },
    apply(ctx, seat, _ploy, seed) {
      const s = ctx.state
      const k = hkOps(s, seat).find((o) => hasAbility(s, o, ID.tacticianCard))
      if (!k) {
        resumeGambit(ctx)
        return
      }
      const kind = seed.param === 'defence' ? 'defence' : 'attack'
      ctx.raise({
        kind: 'ability.choice',
        seat,
        window: 'strategy.gambit',
        context: { hook: 'hkTactician', operativeId: k.id, abilityId: ID.tacticianCard, marker: kind, gambit: true },
        options: markerSpotOptions(s, kind),
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    placeTacticianMarker(ctx, op.seat, String(context.marker), { x, z }, op)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${context.marker}@${x},${z}` }, op.seat)
    resumeGambit(ctx)
  },
})

registerCodeHook({
  name: 'acceleratedAppraisal',
  action: {
    offers: (): OfferSeed[] => [
      { key: 'attack', params: { param: 'attack' } },
      { key: 'defence', params: { param: 'defence' } },
    ],
    perform(ctx, op, def, params) {
      const kind = params.param === 'defence' ? 'defence' : 'attack'
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'acceleratedAppraisal', operativeId: op.id, abilityId: def.id, marker: kind },
        options: markerSpotOptions(ctx.state, kind),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    placeTacticianMarker(ctx, op.seat, String(context.marker), { x, z }, op)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${context.marker}@${x},${z}` }, op.seat)
    finishAction(ctx)
  },
})

registerCodeHook({
  name: 'panSpectralScan',
  action: {
    offers: (): OfferSeed[] => [{ key: '', params: {} }],
    perform(ctx, op, def) {
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'panSpectralScan', operativeId: op.id, abilityId: def.id },
        options: markerSpotOptions(ctx.state, 'scan'),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    // performing the action again moves the marker
    for (const m of markersOf(ctx.state, op.seat, M_SCAN)) removeMarker(ctx, m.id, 'hk.panSpectralScan')
    placeMarker(ctx, op.seat, M_SCAN, { x, z }, op)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: String(context.abilityId), detail: `${x},${z}` }, op.seat)
    finishAction(ctx)
  },
})

// ---------------------------------------------------------------------------
// SIGNAL, SYSTEM JAM, SPOT (T-HK.18, T-HK.19, T-HK.22)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'hkSignal',
  action: {
    offers(state, op): OfferSeed[] {
      return hkOps(state, op.seat)
        .filter((f) => f.id !== op.id)
        .map((f) => ({ key: f.id, params: { targetId: f.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      applyAplEffect(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'hkSystemJam',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => live(e) && !hasToken(state, e.id, JAM, op.seat) && canBeTargetedBy(state, op, e))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      addToken(ctx, target.id, { kind: JAM, owner: op.seat, cap: 1, sourceId: op.id, expires: ['battle'] }, 'systemJam')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'hkSpot',
  action: {
    offers(state, op): OfferSeed[] {
      return enemiesOf(state, op)
        .filter((e) => live(e) && visible(state, bodyOf(op), bodyOf(e)))
        .map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!live(target)) {
        cancelAction(ctx)
        return
      }
      addToken(ctx, target.id, { kind: SPOT, owner: op.seat, cap: 1, sourceId: op.id, expires: ['turningPointEnd', 'sourceIncapacitated'] }, 'spot')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

/**
 * Comms Device (M-5.1): while this operative controls its own team's Comms Device marker, the distances in its SUPPORT
 * rules that name friendly operatives are 3" longer.
 */
function commsReach(s: GameState, op: Operative): number {
  if (controlledBy(s, op, (m) => m.equipmentId === 'core.e.comms-device' && m.owner === op.seat).length === 0) return 0
  markFired('commsDevice')
  return 3
}

/** Is `target` spotted for `shooter`: carries the seat's Spot token placed by a Lokatr within 3" of the shooter (6" while that Lokatr controls a Comms Device). */
function spotted(s: GameState, shooter: Operative, target: Operative): boolean {
  const tk = tokensOn(s, target.id).find((t) => t.kind === SPOT && t.owner === shooter.seat && t.count > 0)
  const lok = tk?.sourceId ? s.operatives[tk.sourceId] : undefined
  if (!tk || !live(lok) || lok.seat !== shooter.seat) return false
  const range = 3 + commsReach(s, lok)
  return shooter.id === lok.id || distanceBetween(bodyOf(shooter), bodyOf(lok)) <= range + EPS
}

// ---------------------------------------------------------------------------
// Strategy ploys: EYE OF THE ANCESTORS, NEED KEEPS, TOIL EARNS, WROUGHT DEFENCE, PROXIMATE FIREPOWER
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'eyeOfTheAncestors',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const mine = hkOps(state, seat)
      if (!mine.some((o) => hasKeyword(state, o, 'THEYN'))) return []
      const near = (e: Operative) => Math.min(...mine.map((m) => distanceBetween(bodyOf(m), bodyOf(e))))
      const enemies = activeOps(state)
        .filter((o) => o.seat !== seat && live(o))
        .sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1))
      const out: PloyOfferSeed[] = []
      // two different enemies once three or more of the Kin have fallen
      if (incapacitatedCount(state, seat) >= 3) for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) out.push({ param: `${enemies[i]!.id}+${enemies[j]!.id}` })
      for (const e of enemies) out.push({ param: e.id })
      return out
    },
    apply(ctx, seat, _ploy, seed) {
      for (const id of (seed.param ?? '').split('+')) {
        if (!live(ctx.state.operatives[id])) continue
        addToken(ctx, id, { kind: GRUDGE, owner: seat, expires: ['battle'] }, 'eyeOfTheAncestors')
        markFired('hkGrudge')
      }
    },
  },
})

/** One strategy ploy that names an objective marker (Need Keeps, Toil Earns). */
function markerPloy(name: string, id: string) {
  registerCodeHook({
    name,
    ploy: {
      offers: (state): PloyOfferSeed[] => state.markers.filter((m) => m.kind === 'objective').map((m) => ({ param: m.id })),
      apply(ctx, seat, _ploy, seed) {
        if (seed.param) addEffect(ctx, { source: id, seat, kind: 'hk.markerPloy', expires: 'turningPoint', data: { markerId: seed.param } })
      },
    },
  })
}
markerPloy('needKeeps', ID.needKeeps)
markerPloy('toilEarns', ID.toil)

function flagPloy(name: string) {
  registerCodeHook({
    name,
    ploy: {
      offers: (): PloyOfferSeed[] => [{}],
      apply(ctx, seat, ploy) {
        addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
      },
    },
  })
}
flagPloy('wroughtDefence')
flagPloy('proximateFirepower')

/** The Need Keeps marker the operative stands within 3" of, if the seat has the ploy in play. */
function needKeepsNear(s: GameState, op: Operative): boolean {
  for (const e of s.effects) {
    if (e.source !== ID.needKeeps || e.seat !== op.seat) continue
    const m = s.markers.find((k) => k.id === e.data?.markerId)
    if (m && gapToMarker(bodyOf(op), m) <= 3 + EPS) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Firefight ploys: ANCESTORS ARE WATCHING, WORTH IT, STURDY, ENGAGE TO ACQUIRE
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'ancestorsAreWatching',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || info.counteracting || !isHk(state, op)) return []
      const out: PloyOfferSeed[] = []
      const act = state.firefight.activation
      for (const action of ['shoot', 'fight'] as const) {
        // the free action still counts as that action (R-3.9): an operative that already took it the most it may cannot take it again
        if (act && act.operativeId === op.id && act.performed.filter((p) => p === action).length >= maxRepeats(state, op, action, act.performed)) continue
        if (canStartFreeAction(state, { operativeId: op.id, action, resume: '' })) out.push({ param: action, operativeId: op.id })
      }
      return out
    },
    apply(ctx, seat, ploy, seed, info) {
      const id = seed.operativeId ?? info.subjectId
      if (!id) return
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: id, expires: 'activation' })
      startFreeAction(ctx, { operativeId: id, action: seed.param === 'fight' ? 'fight' : 'shoot', resume: 'ploy.freeAction' })
    },
  },
})

/** A free mission action the incapacitated operative could take. */
function missionFeasible(s: GameState, op: Operative): boolean {
  return abilityOffers(s, op, null).some((o) => (s.data.abilities[o.abilityId]?.keywords ?? []).includes('MISSION'))
}

registerCodeHook({
  name: 'hkWorthIt',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const victim = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!victim || victim.seat !== seat || victim.status !== 'active' || !state.removal || !isHk(state, victim)) return []
      return missionFeasible(state, victim) ? [{}] : []
    },
    apply(ctx, _seat, _ploy, _seed, info) {
      const s = ctx.state
      const victim = info.subjectId ? s.operatives[info.subjectId] : undefined
      if (!victim || !s.removal) return
      // the window waits aside while the free action runs (startDelegatedAction keeps it), and so does the removal
      const saved = JSON.parse(JSON.stringify(s.removal)) as NonNullable<GameState['removal']>
      startDelegatedAction(ctx, { operativeId: victim.id, resume: 'hk.worthIt', rules: { allow: ['mission'] }, data: { removal: saved } })
    },
  },
})

// the free mission action is over: put the removal back and let the ploy window carry on (it then closes into continueRemovals)
registerFrameResume('hk.worthIt', (ctx, _outcome, data) => {
  if (data.removal) ctx.state.removal = data.removal as NonNullable<GameState['removal']>
  if (ctx.state.window) continueWindow(ctx)
  else continueRemovals(ctx)
})

registerCodeHook({
  name: 'hkSturdy',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const target = info.targetId ? state.operatives[info.targetId] : undefined
      const seq = state.attack?.seq
      if (!target || target.seat !== seat || info.subjectId !== target.id || !isHk(state, target) || !seq) return []
      return seq.atk.dice.some((d) => d.kind === 'crit' && !d.used) ? [{}] : []
    },
    apply(ctx) {
      const seq = ctx.state.attack?.seq
      if (!seq) return
      // Devastating and Piercing Crits were resolved before this point and stay resolved (seq.critRetained is left alone)
      for (const d of seq.atk.dice) {
        if (d.kind === 'crit' && !d.used) {
          d.kind = 'normal'
          d.tag = 'sturdy'
        }
      }
    },
  },
})

/** Does the enemy control an objective marker (it contests it and its player controls it)? */
function controlsObjective(s: GameState, foe: Operative): boolean {
  return contestedBy(s, foe).some((m) => m.kind === 'objective' && markerControl(s, m).controller === foe.seat)
}

registerCodeHook({
  name: 'engageToAcquire',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const foe = info.targetId ? state.operatives[info.targetId] : undefined
      // shooting or fighting, never retaliating: only the operative that started the sequence
      if (!op || !foe || op.seat !== seat || info.attackerId !== op.id || !isHk(state, op) || foe.seat === seat) return []
      if (!state.attack?.seq || !controlsObjective(state, foe)) return []
      return state.attack.seq.atk.dice.some((d) => d.value !== null && !d.rerolled && !d.used) ? [{}] : []
    },
    apply(ctx, _seat, ploy) {
      const seq = ctx.state.attack?.seq
      if (!seq) return
      const grant: RerollGrant = { id: 'hk-engage-to-acquire', source: ploy.id, mode: 'any', used: false }
      seq.atk.grants.push(grant)
    },
  },
})

// ---------------------------------------------------------------------------
// Equipment: CLIMBING RIGS, EXCAVATION TOOLS, WRIT OF CLAIM (T-HK.38 to T-HK.40)
// ---------------------------------------------------------------------------

registerCodeHook({ name: 'hkClimbingRigs', setup: () => undefined })
registerCodeHook({ name: 'hkExcavationTools', setup: () => undefined })
registerCodeHook({ name: 'hkWritOfClaim', setup: () => undefined })

/** Objective markers on which a Hearthkyn operative of the seat is contesting (Writ of Claim). */
export function contestedObjectives(s: GameState, seat: Seat): number {
  let n = 0
  for (const m of s.markers) {
    if (m.kind !== 'objective') continue
    if (markerControl(s, m).contesting[seat].some((id) => isHk(s, s.operatives[id]))) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Passive rules that live in hooks
// ---------------------------------------------------------------------------

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId || !isHk(s, op)) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const weapon = weaponOfId(s, c.weaponId)
    if (!weapon) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    // --- Force Impact: Brutal while fighting with it in an activation in which the bearer has Charged (T-HK.17)
    if (data.kind === 'fight' && hasRule(weapon.rules, 'forceimpact') && !hasRule(data.rules, 'brutal')) {
      const act = activeActivationOf(s)
      if (act && act.operativeId === op.id && !act.counteract && s.effects.some((e) => e.kind === 'hk.charged' && e.operativeId === op.id)) {
        data.rules.push({ rule: 'brutal' })
        markFired('hkForceImpact')
      }
    }
    if (!target || target.seat === op.seat) return null
    // --- Attack marker: Balanced against an enemy within 3" of it; Need Keeps: Balanced on Atk 4 melee weapons (T-HK.20, T-HK.29)
    let balanced = false
    if (markersOf(s, op.seat, M_ATTACK).some((m) => gapToMarker(bodyOf(target), m) <= 3 + EPS)) balanced = true
    if (weapon.type === 'melee' && weapon.atk >= 4 && needKeepsNear(s, op)) balanced = true
    if (balanced && !hasRule(data.rules, 'balanced')) data.rules.push({ rule: 'balanced' })
    if (data.kind !== 'shoot' || weapon.type !== 'ranged') return null
    // --- Spot: Seek Light on ranged weapons used from near the Lokatr against the spotted enemy (T-HK.22)
    if (spotted(s, op, target) && !hasRule(data.rules, 'seeklight')) data.rules.push({ rule: 'seek-light' })
    // --- Pan Spectral Scan: Accurate 1 and Saturate against enemies within 3" of the marker (T-HK.23)
    if (markersOf(s, op.seat, M_SCAN).some((m) => gapToMarker(bodyOf(target), m) <= 3 + EPS)) {
      data.rules.push({ rule: 'accurate', x: 1 })
      if (!hasRule(data.rules, 'saturate')) data.rules.push({ rule: 'saturate' })
    }
    return null
  },
  'hk.modifyWeaponRules',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; atk: number; hitDelta: number; assists: string[] }
    const weapon = weaponOfId(s, c.weaponId)
    if (!weapon) return null
    const foe = c.targetId ? s.operatives[c.targetId] : undefined
    // --- Brawler: enemies cannot assist against the Dozr (T-HK.9)
    if (data.kind === 'fight' && foe && hasAbility(s, foe, ID.brawler) && data.assists.length > 0) {
      data.assists = []
      markFired('hkBrawler')
    }
    if (!isHk(s, op)) return null
    // --- The Ancestors Are Watching: the injured worsening of weapon Hit is ignored for the activation (T-HK.33)
    if (hasInjuredPenalty(op) && s.effects.some((e) => e.source === ID.ancestors && e.operativeId === op.id)) data.hitDelta -= 1
    // --- Need Keeps: +1 Atk on melee weapons within 3" of the marker, to a maximum of 4 (T-HK.29)
    if (weapon.type === 'melee' && weapon.atk < 4 && data.atk < 4 && needKeepsNear(s, op)) data.atk += 1
    // --- Proximate Firepower: ranged Hit improved by 1 against an enemy within 6", never better than 3+ (T-HK.32)
    if (data.kind === 'shoot' && weapon.type === 'ranged' && foe && ployEffect(s, ID.proximate, op.seat) && distanceBetween(bodyOf(op), bodyOf(foe)) <= 6 + EPS) {
      if (weapon.hit + data.hitDelta > 3) {
        data.hitDelta = Math.max(data.hitDelta - 1, 3 - weapon.hit)
        markFired('proximateFirepower')
      }
    }
    return null
  },
  'hk.modifyAttackDice',
)

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const target = opOfHook(c)
    if (!s || !target || !isHk(s, target)) return null
    // --- Defence marker: re-roll one defence die when shot within 3" of it (T-HK.20)
    if (markersOf(s, target.seat, M_DEFENCE).some((m) => gapToMarker(bodyOf(target), m) <= 3 + EPS)) {
      const data = c.data as { rerolls: RerollGrant[] }
      if (!data.rerolls.some((r) => r.id === 'hk-defence-marker')) data.rerolls.push({ id: 'hk-defence-marker', source: ID.tacticianCard, mode: 'one', used: false })
    }
    return null
  },
  'hk.modifyDefenceDice',
)

registerHook(
  'afterDefenceRoll',
  (c) => {
    const s = c.state
    const target = opOfHook(c)
    if (!s || !target || !isHk(s, target) || !ployEffect(s, ID.wrought, target.seat)) return null
    const data = c.data as { kind: 'shoot' | 'fight'; dice: { value: number | null; kind: string; tag?: string; used?: boolean }[] }
    if (data.kind !== 'shoot' || data.dice.some((d) => d.tag === 'wrought')) return null
    // only dice that were rolled count toward "one or less successes"; a cover save kept without rolling does not
    const successes = data.dice.filter((d) => d.value !== null && d.kind !== 'fail').length
    if (successes > 1) return null
    const fail = data.dice.find((d) => d.value !== null && d.kind === 'fail' && !d.used)
    if (!fail) return null
    fail.kind = 'normal'
    fail.tag = 'wrought'
    markFired('wroughtDefence')
    return null
  },
  'hk.afterDefenceRoll',
)

registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = opOfHook(c)
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !shooter || !target || !isHk(s, shooter)) return null
    const data = c.data as { obscured: boolean }
    // Spot: the spotted enemy cannot be obscured against the Hearthkyn operative near the Lokatr (T-HK.22)
    if (data.obscured && spotted(s, shooter, target)) {
      data.obscured = false
      markFired('hkSpot')
    }
    return null
  },
  'hk.target.status',
)

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const shooter = opOfHook(c)
    if (!s || !shooter || !isHk(s, shooter) || s.attack?.pointBlank) return null
    const data = c.data as { weaponId: string; candidates: string[] }
    if (weaponOfId(s, data.weaponId)?.type !== 'ranged') return null
    // Spot's Seek Light makes a Conceal enemy in Light cover a valid target for a shooter near the Lokatr
    const base = ruleSetFor(s, shooter, data.weaponId, 'shoot', undefined, c.engine)
    for (const e of enemiesOf(s, shooter)) {
      if (!live(e) || data.candidates.includes(e.id) || !spotted(s, shooter, e)) continue
      const rules = { ...base, seekLight: true }
      if (rules.range !== null && !isWithin(bodyOf(shooter), bodyOf(e), rules.range)) continue
      if (enemiesInControlRange(s, e, e.seat).length > 0) continue
      const info = targetInfo(s, shooter, e, rules)
      if (!info.verdict.visible || info.coverBlocks) continue
      data.candidates.push(e.id)
      markFired('hkSpot')
    }
    return null
  },
  'hk.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// Lifecycle: tokens, markers and the Lugger's CP
// ---------------------------------------------------------------------------

registerHook(
  'activation.start',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = opOfHook(c)
    if (!s || !ctx || !op) return null
    // System Jam: the token goes as soon as the jammed operative is activated (T-HK.19)
    for (const t of [...tokensOn(s, op.id)]) if (t.kind === JAM) removeToken(ctx, op.id, JAM, 'activated', t.owner)
    // Pan Spectral Scan goes when its Lokatr next activates (T-HK.23)
    for (const m of [...s.markers]) if (m.equipmentId === M_SCAN && m.placedBy === op.id) removeMarker(ctx, m.id, 'hk.panSpectralScan')
    return null
  },
  'hk.activation.start',
)

registerHook(
  'action.ended',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = opOfHook(c)
    if (!s || !ctx || !op || !isHk(s, op)) return null
    const data = c.data as { action: string; counteract: boolean }
    // Force Impact remembers the Charge for the rest of the activation (free Charges included)
    if (data.action === 'charge') addEffect(ctx, { source: ID.jump, seat: op.seat, kind: 'hk.charged', operativeId: op.id, expires: 'activation' })
    // Climbing Rigs: the benefit is spent by the first move that climbs or drops more than the rig covers (T-HK.38)
    const moved = ctx.events.find((e) => e.type === 'OperativeMoved' && e.operativeId === op.id && e.action !== 'forced')
    const own = activeActivationOf(s)
    const rigsApply = !!own && own.operativeId === op.id && !own.counteract
    if (moved && moved.type === 'OperativeMoved' && rigsApply && equipped(s, op.seat, ID.rigs) && !effectFor(s, 'hk.rigs', op.id)) {
      let climb = 0
      let drop = 0
      for (const sg of moved.segments) {
        if (sg.kind === 'climb') climb += Math.max(0, sg.to.y - sg.from.y)
        else if (sg.kind === 'drop') drop += Math.max(0, sg.from.y - sg.to.y)
      }
      if (climb > 2 + EPS || drop > 2 + EPS) addEffect(ctx, { source: ID.rigs, seat: op.seat, kind: 'hk.rigs', operativeId: op.id, expires: 'activation' })
    }
    return null
  },
  'hk.action.ended',
)

registerHook(
  'turningPoint.start',
  (c) => {
    const s = c.state
    const ctx = c.engine
    if (!s || !ctx) return null
    // Tactician markers leave in the Ready step (T-HK.20)
    for (const m of [...s.markers]) if (m.equipmentId === M_ATTACK || m.equipmentId === M_DEFENCE) removeMarker(ctx, m.id, 'hk.tactician')
    // Utility Grenade markers placed last turning point start their countdown: D3 completed activations (T-HK.14)
    for (const m of s.markers) {
      if (m.equipmentId === M_UTILITY && (m.clearsAfter === null || m.clearsAfter === undefined)) m.clearsAfter = d3(ctx, 'hk.utility.clear')
    }
    // Well Supplied: 1 extra CP in the Ready step of the first Strategy phase (T-HK.24)
    if (s.turningPoint === 1) {
      for (const seat of SEATS) {
        if (s.players[seat].teamId !== TEAM_ID) continue
        if (!Object.values(s.operatives).some((o) => o.seat === seat && hasAbility(s, o, ID.lugger))) continue
        gainCp(ctx, seat, 1, 'hk.wellSupplied')
        markFired('hkWellSupplied')
      }
    }
    return null
  },
  'hk.turningPoint.start',
)

registerHook(
  'activation.end',
  (c) => {
    const s = c.state
    const ctx = c.engine
    if (!s || !ctx || (c.data as { counteract?: boolean } | undefined)?.counteract) return null
    // a completed activation (counteractions excluded) counts toward every counting Utility Grenade marker
    for (const m of [...s.markers]) {
      if (m.equipmentId !== M_UTILITY || m.clearsAfter === null || m.clearsAfter === undefined) continue
      m.clearsAfter -= 1
      if (m.clearsAfter <= 0) removeMarker(ctx, m.id, 'hk.utilityGrenade')
    }
    return null
  },
  'hk.activation.end',
)

registerHook(
  'turningPoint.end',
  (c) => {
    const s = c.state
    const ctx = c.engine
    if (!s || !ctx) return null
    for (const m of [...s.markers]) if (m.equipmentId === M_UTILITY && m.clearsAfter !== null && m.clearsAfter !== undefined) removeMarker(ctx, m.id, 'hk.utilityGrenade')
    return null
  },
  'hk.turningPoint.end',
)

// ---------------------------------------------------------------------------
// The ploy rule: Medic!'s free Dash while the Hearthkyn player is the active one
// ---------------------------------------------------------------------------

const medicRule: PloyRule = {
  extraOffers(state, seat, window): PloyOffer[] {
    if (window !== 'firefight.actionEnded') return []
    const act = state.firefight.activation
    if (!act || act.seat !== seat) return []
    return state.effects
      .filter((e) => e.kind === 'hk.medicDash' && e.seat === seat && !!e.operativeId && state.operatives[e.operativeId]?.status === 'active')
      .map((e) => ({ id: `hk.medicDash@${e.operativeId}`, ployId: 'hk.medicDash', name: 'Medic! free Dash', cost: 0, via: 'hk.medicDash', seed: { param: e.operativeId! }, operativeId: e.operativeId! }))
  },
  onUsed(ctx, _seat, offer) {
    if (offer.via !== 'hk.medicDash') return
    const id = offer.operativeId
    const fx = id ? effectFor(ctx.state, 'hk.medicDash', id) : undefined
    if (!id || !fx) return
    removeEffects(ctx, (e) => e.id === fx.id)
    startFreeAction(ctx, { operativeId: id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: 'ploy.freeAction' })
  },
}
registerPloyRule(medicRule)

// ---------------------------------------------------------------------------
// The team rule provider
// ---------------------------------------------------------------------------

registerTeamRules({
  id: TEAM_ID,

  /** Utility Grenade: +1 AP per marker within 3" for Pick Up Marker and mission actions, for either player (T-HK.14); Excavation Tools: Pick Up Marker -1 (T-HK.39) */
  actionCostDelta(state, op, actionId) {
    let delta = 0
    const mission = actionId.startsWith('ability:') && (state.data.abilities[actionId.slice(8)]?.keywords ?? []).includes('MISSION')
    if (actionId === 'marker:pickUp' || mission) {
      const n = utilityTax(state, op)
      if (n > 0) {
        delta += n
        markFired('hkUtilityGrenade')
      }
    }
    if (actionId === 'marker:pickUp' && isHk(state, op) && equipped(state, op.seat, ID.excavation)) {
      delta -= 1
      markFired('hkExcavationTools')
    }
    return delta
  },

  /** the Grenadier may also throw smoke and stun grenades (their allowance is in ownGrenades) */
  extraActions(state, op) {
    return hasAbility(state, op, ID.grenadier) ? [SMOKE, STUN] : []
  },

  ownGrenades(state, op) {
    if (!hasAbility(state, op, ID.grenadier)) return null
    markFired('hkGrenadier')
    return { weapons: { [FRAG]: 1, [KRAK]: 1 }, actions: { [SMOKE]: 1, [STUN]: 1 } }
  },

  canFly(state, op) {
    if (!hasAbility(state, op, ID.jump)) return false
    markFired('hkJumpPack')
    return true
  },

  /** System Jam: a jammed enemy cannot be activated while the player has a ready operative without a token (T-HK.19) */
  canActivate(state, op) {
    return !tokensOn(state, op.id).some((t) => t.kind === JAM && t.owner !== op.seat && t.count > 0)
  },

  /** Writ of Claim: offered only when it could help, i.e. the seat did not win the roll-off outright (T-HK.40) */
  initiativeReroll(state, seat) {
    if (!equipped(state, seat, ID.writ) || usedThisBattle(state, seat, ID.writ)) return false
    const rolls = state.strategy.rolls
    const mine = rolls[seat]
    const theirs = rolls[otherSeat(seat)]
    if (mine === undefined || theirs === undefined || mine > theirs) return false
    return contestedObjectives(state, seat) >= 2
  },
  onInitiativeReroll(ctx, seat) {
    markUsedBattle(ctx.state, seat, ID.writ)
    markFired('hkWritOfClaim')
  },

  /** Medic!: a removal outside an attack waits for the before-removal queue, where the owner may take it */
  pausableRemoval: (state, op) => !!effectFor(state, MEDIC_ASK, op.id),

  /** Medic!'s free Dash while the other player is the active one (T-HK.11) */
  reactions(state, seat) {
    const out: ReactionOffer[] = []
    for (const e of state.effects) {
      if (e.kind !== 'hk.medicDash' || e.seat !== seat || !e.operativeId) continue
      const v = state.operatives[e.operativeId]
      if (!v || v.status !== 'active') continue
      out.push({ hook: 'hkMedic', operativeId: v.id, option: 'dash', labelKey: 'hk.medicDash', data: { medicId: e.data?.medicId } })
    }
    return out
  },

  /** Need Keeps: the contesting total counts 1 higher at the chosen marker if a Hearthkyn operative contests it (T-HK.29) */
  controlTotal(state, seat, marker, total, contesting) {
    const picked = state.effects.some((e) => e.source === ID.needKeeps && e.seat === seat && e.data?.markerId === marker.id)
    if (!picked || !contesting.some((id) => isHk(state, state.operatives[id]))) return null
    markFired('needKeeps')
    return total + 1
  },

  /** Climbing Rigs: the first climb or drop of the activation costs less (T-HK.38) */
  moveSurcharge(state, op, _kind, _points, breakdown) {
    if (!isHk(state, op) || !equipped(state, op.seat, ID.rigs) || effectFor(state, 'hk.rigs', op.id)) return 0
    // "during each friendly operative's activation": its own activation (a free move under a frame included), never a
    // counteraction or a move made in another operative's activation
    const own = activeActivationOf(state)
    if (!own || own.operativeId !== op.id || own.counteract) return 0
    const climbSave = breakdown.climb > 2 ? breakdown.climb - 2 : 0
    const save = Math.max(climbSave, breakdown.drop)
    if (save <= 0) return 0
    markFired('hkClimbingRigs')
    return -save
  },
})

/** Actions an AI or test may want to check by name. */
export const HK_ABILITIES = ID
