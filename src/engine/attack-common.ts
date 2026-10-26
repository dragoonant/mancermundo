// Shared machinery for the Shoot and Fight sequences (M2b-attack): weapon rule parsing, attack and
// defence pools, re-roll windows, retention conversions, blocking plans, damage and removal, target
// validity. Pure helpers come first (they are reused by query.* for exact odds); the Ctx-based helpers
// that mutate the draft state follow.
import { classifyDie, clampTarget } from './dice'
import { distanceBetween, enemiesInControlRange, isWithin } from './measure'
import { bodyOf, targetVerdict, visible, type TargetVerdict } from './los'
import { getWindowOpener, runHook } from './hooks'
import type { OptionInput, Ctx } from './registry'
import { enemiesOf, getOp, hasInjuredPenalty, isInjured, otherSeat } from './state'
import { terrainOf } from './terrain'
import { providerAny, providerPausableRemoval, providerCommandRerollCost, providerOnCommandReroll, providerRerollBannedValues, providerRerollsBanned, providerWeaponForbidden } from './team-rules'
import { isPsychicWeapon, psychicAllowed } from './psychic'
import { noteRemoval } from './kills'
import type {
  Action,
  AttackDie,
  AttackSequence,
  AttackState,
  DiceSide,
  DieKind,
  GameState,
  Operative,
  PendingDecision,
  Rejection,
  RerollGrant,
  RollTarget,
  RuntimeWeapon,
  Seat,
  TimingWindowId,
  WeaponRuleRef,
} from './types'

// ---------------------------------------------------------------------------
// Weapon rules
// ---------------------------------------------------------------------------

/** Normalise a rule id: `core.wr.seek-light`, `seekLight` and `seek light` all become `seeklight`. */
export function ruleKey(name: string): string {
  const base = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return base.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface RuleSet {
  /** every Accurate x in play; two or more instances combine into Accurate 2 (R-10.1) */
  accurate: number[]
  balanced: boolean
  brutal: boolean
  ceaseless: boolean
  hot: boolean
  relentless: boolean
  rending: boolean
  saturate: boolean
  seek: boolean
  seekLight: boolean
  severe: boolean
  shock: boolean
  silent: boolean
  stun: boolean
  punishing: boolean
  blast: number | null
  torrent: number | null
  range: number | null
  limited: number | null
  devastating: { x: number; inches: number | null } | null
  lethal: number | null
  piercing: number
  piercingCrits: number
  heavy: { only: 'dash' | 'reposition' | null } | null
  /** batch C shared: the weapon the rules belong to (ruleSetFor), so target.status hooks know it */
  weaponId?: string
}

export function parseRules(rules: WeaponRuleRef[]): RuleSet {
  const r: RuleSet = {
    accurate: [],
    balanced: false,
    brutal: false,
    ceaseless: false,
    hot: false,
    relentless: false,
    rending: false,
    saturate: false,
    seek: false,
    seekLight: false,
    severe: false,
    shock: false,
    silent: false,
    stun: false,
    punishing: false,
    blast: null,
    torrent: null,
    range: null,
    limited: null,
    devastating: null,
    lethal: null,
    piercing: 0,
    piercingCrits: 0,
    heavy: null,
  }
  const max = (a: number | null, b: number): number => (a === null ? b : Math.max(a, b))
  for (const ref of rules) {
    const key = ruleKey(ref.rule)
    const x = ref.x ?? 0
    switch (key) {
      case 'accurate':
        r.accurate.push(x || 1)
        break
      case 'balanced':
        r.balanced = true
        break
      case 'brutal':
        r.brutal = true
        break
      case 'ceaseless':
        r.ceaseless = true
        break
      case 'hot':
        r.hot = true
        break
      case 'relentless':
        r.relentless = true
        break
      case 'rending':
        r.rending = true
        break
      case 'saturate':
        r.saturate = true
        break
      case 'seek':
        r.seek = true
        break
      case 'seeklight':
        r.seekLight = true
        break
      case 'severe':
        r.severe = true
        break
      case 'shock':
        r.shock = true
        break
      case 'silent':
        r.silent = true
        break
      case 'stun':
        r.stun = true
        break
      case 'punishing':
        r.punishing = true
        break
      case 'blast':
        r.blast = max(r.blast, ref.inches ?? x)
        break
      case 'torrent':
        r.torrent = max(r.torrent, ref.inches ?? x)
        break
      case 'range':
        r.range = max(r.range, ref.inches ?? x)
        break
      case 'limited':
        r.limited = max(r.limited, x || 1)
        break
      case 'devastating': {
        // several instances: the player picks one x; the larger is never worse (R-10 intro)
        const inches = ref.inches ?? null
        if (!r.devastating || x > r.devastating.x || (x === r.devastating.x && inches !== null && r.devastating.inches === null)) {
          r.devastating = { x, inches }
        }
        break
      }
      case 'lethal': {
        const t = ref.target ?? ref.x ?? 6
        r.lethal = r.lethal === null ? t : Math.min(r.lethal, t)
        break
      }
      case 'piercing':
        if (ref.crits) r.piercingCrits = Math.max(r.piercingCrits, x || 1)
        else r.piercing = Math.max(r.piercing, x || 1)
        break
      case 'piercingcrits':
        r.piercingCrits = Math.max(r.piercingCrits, x || 1)
        break
      case 'heavy':
        r.heavy = { only: ref.only ?? null }
        break
      default:
        break
    }
  }
  return r
}

export function accurateTotal(x: number[]): number {
  if (x.length === 0) return 0
  return x.length >= 2 ? 2 : x[0]!
}

export function hasRule(rules: WeaponRuleRef[], key: string): boolean {
  return rules.some((r) => ruleKey(r.rule) === key)
}

export function weaponOf(state: GameState, weaponId: string): RuntimeWeapon {
  const w = state.data.weapons[weaponId]
  if (!w) throw new Error(`unknown weapon ${weaponId}`)
  return w
}

/** The weapon's rules after `modifyWeaponRules` hooks (R-10.25: changes apply immediately). */
export function effectiveRules(
  state: GameState,
  op: Operative,
  weapon: RuntimeWeapon,
  kind: 'shoot' | 'fight',
  targetId?: string,
  ctx?: Ctx,
): WeaponRuleRef[] {
  const rules = weapon.rules.map((r) => ({ ...r }))
  runHook('modifyWeaponRules', {
    seat: op.seat,
    state,
    ...(ctx ? { engine: ctx } : {}),
    operativeId: op.id,
    weaponId: weapon.id,
    ...(targetId ? { targetId } : {}),
    data: { kind, ...(targetId ? { targetId } : {}), rules },
  })
  return rules
}

/**
 * M9 prep: the Normal and Critical Dmg of a weapon against a target after `modifyDamage` hooks (Toxic).
 * Every place that turns attack dice into damage reads Dmg through this.
 */
export function weaponDamage(
  state: GameState,
  attackerId: string,
  weaponId: string,
  targetId: string,
  kind: 'shoot' | 'fight',
  ctx?: Ctx,
): { normal: number; crit: number } {
  const w = weaponOf(state, weaponId)
  const data = { kind, weaponId, dmg: { normal: w.dmg.normal, crit: w.dmg.crit } }
  const op = state.operatives[attackerId]
  runHook('modifyDamage', { seat: op?.seat ?? 'A', state, ...(ctx ? { engine: ctx } : {}), operativeId: attackerId, targetId, weaponId, data })
  return { normal: Math.max(0, Math.floor(data.dmg.normal)), crit: Math.max(0, Math.floor(data.dmg.crit)) }
}

export function ruleSetFor(state: GameState, op: Operative, weaponId: string, kind: 'shoot' | 'fight', targetId?: string, ctx?: Ctx): RuleSet {
  return { ...parseRules(effectiveRules(state, op, weaponOf(state, weaponId), kind, targetId, ctx)), weaponId }
}

// ---------------------------------------------------------------------------
// Movement-related weapon restrictions (Heavy, Limited, Silent)
// ---------------------------------------------------------------------------

export const MOVE_ACTIONS = ['reposition', 'dash', 'fallBack', 'charge']

/** Is the weapon barred right now? Heavy (R-10.9), Limited (R-10.11), Conceal without Silent (R-3.4). */
export function weaponUnusable(
  state: GameState,
  op: Operative,
  weaponId: string,
  performed: string[],
  kind: 'shoot' | 'fight',
): Rejection | null {
  const w = state.data.weapons[weaponId]
  if (!w) return { code: 'E_NOT_AN_OPTION', reason: `unknown weapon ${weaponId}` }
  const rules = parseRules(w.rules)
  if (rules.limited !== null && (op.usedLimited[weaponId] ?? 0) >= rules.limited) {
    return { code: 'E_ACTION_RESTRICTED', reason: `${w.name} has been used ${rules.limited} time(s) already (Limited)` }
  }
  // M9 batch C: team rules that bar a weapon (Concealed Position, Detonate without its marker) and PSYCHIC blocks (Null Rod)
  const barred = providerWeaponForbidden(state, op, weaponId, kind)
  if (barred) return { code: 'E_ACTION_RESTRICTED', reason: barred }
  if (w.type === 'ranged' && isPsychicWeapon(state, weaponId) && !psychicAllowed(state, op)) {
    return { code: 'E_ACTION_RESTRICTED', reason: `${w.name} is PSYCHIC and cannot be used here` }
  }
  if (kind === 'shoot') {
    if (op.order === 'conceal' && !rules.silent && !providerAny(state, op, 'shootUnderConceal')) {
      return { code: 'E_ACTION_RESTRICTED', reason: `${w.name} is not Silent` }
    }
    if (rules.heavy) {
      const moved = performed.filter((a) => MOVE_ACTIONS.includes(a))
      const allowed = rules.heavy.only
      if (moved.some((m) => m !== allowed)) {
        return { code: 'E_ACTION_RESTRICTED', reason: `${w.name} is Heavy and the operative moved` }
      }
    }
  }
  return null
}

/** Heavy: the operative cannot move in an activation in which it used the weapon (R-10.9). */
export function heavyBlocksMove(state: GameState, weaponsUsed: string[] | undefined, moveAction: string): string | null {
  for (const id of weaponsUsed ?? []) {
    const w = state.data.weapons[id]
    if (!w) continue
    const rules = parseRules(w.rules)
    if (rules.heavy && rules.heavy.only !== moveAction) return `${w.name} is Heavy and was used this activation`
  }
  return null
}

// ---------------------------------------------------------------------------
// Pools: attack and defence stats
// ---------------------------------------------------------------------------

export interface AttackStats {
  atk: number
  need: RollTarget
  lethal: number | null
  /** dice retained unrolled by Accurate */
  accurate: number
  grants: RerollGrant[]
  rules: RuleSet
  rawRules: WeaponRuleRef[]
  assists: string[]
}

export interface AttackStatOpts {
  kind: 'shoot' | 'fight'
  pointBlank?: boolean
  assists?: string[]
  /** Accurate x granted by Vantage (R-11.5a) */
  vantageAccurate?: number
}

function grantsFor(rules: RuleSet, source: string): RerollGrant[] {
  const out: RerollGrant[] = []
  if (rules.balanced) out.push({ id: 'balanced', source, mode: 'one', used: false })
  if (rules.ceaseless) out.push({ id: 'ceaseless', source, mode: 'result', used: false })
  if (rules.relentless) out.push({ id: 'relentless', source, mode: 'any', used: false })
  return out
}

export function attackStats(
  state: GameState,
  opId: string,
  weaponId: string,
  targetId: string,
  o: AttackStatOpts,
  ctx?: Ctx,
): AttackStats {
  const op = getOp(state, opId)
  const weapon = weaponOf(state, weaponId)
  const rawRules = effectiveRules(state, op, weapon, o.kind, targetId, ctx)
  const rules = parseRules(rawRules)
  const data = {
    kind: o.kind,
    weaponId,
    targetId,
    atk: weapon.atk,
    hitDelta: (hasInjuredPenalty(op) || providerAny(state, op, 'injuredEquivalent') ? 1 : 0) + (o.pointBlank ? 1 : 0) - (o.assists?.length ?? 0),
    accurate: [...rules.accurate, ...(o.vantageAccurate ? [o.vantageAccurate] : [])],
    lethal: rules.lethal,
    rerolls: grantsFor(rules, weapon.id),
    assists: [...(o.assists ?? [])],
  }
  runHook('modifyAttackDice', {
    seat: op.seat,
    state,
    ...(ctx ? { engine: ctx } : {}),
    operativeId: opId,
    targetId,
    weaponId,
    data,
  })
  // assists denied by a hook change the Hit
  const lost = (o.assists?.length ?? 0) - data.assists.length
  const atk = Math.max(0, data.atk)
  return {
    atk,
    need: clampTarget(weapon.hit + data.hitDelta + Math.max(0, lost)),
    lethal: data.lethal,
    accurate: Math.min(atk, accurateTotal(data.accurate)),
    // batch D prep: results a team rule bars from re-rolls narrow every grant (odds and policy included)
    grants: banGrantValues(data.rerolls, providerRerollBannedValues(state, { kind: o.kind, rollerId: opId, opponentId: targetId, defence: false })),
    rules,
    rawRules,
    assists: data.assists,
  }
}

export interface DefenceStats {
  collected: number
  need: RollTarget
  grants: RerollGrant[]
}

export function defenceStats(
  state: GameState,
  targetId: string,
  attackerId: string,
  weaponId: string,
  rules: RuleSet,
  critRetained: boolean,
  ctx?: Ctx,
): DefenceStats {
  const target = getOp(state, targetId)
  const data = { kind: 'shoot' as const, attackerId, weaponId, dice: 3, saveDelta: 0, rerolls: [] as RerollGrant[] }
  runHook('modifyDefenceDice', {
    seat: target.seat,
    state,
    ...(ctx ? { engine: ctx } : {}),
    operativeId: targetId,
    targetId: attackerId,
    weaponId,
    data,
  })
  const reduce = rules.piercing + (critRetained ? rules.piercingCrits : 0)
  return {
    collected: Math.max(0, data.dice - reduce),
    need: clampTarget(target.save + data.saveDelta),
    grants: banGrantValues(data.rerolls, providerRerollBannedValues(state, { kind: 'shoot', rollerId: targetId, opponentId: attackerId, defence: true })),
  }
}

/** batch D prep: grants limited to the results not in `banned` (a grant left with no result is dropped). */
export function banGrantValues(grants: RerollGrant[], banned: number[]): RerollGrant[] {
  if (banned.length === 0) return grants
  const out: RerollGrant[] = []
  for (const g of grants) {
    const values = (g.values ?? [1, 2, 3, 4, 5, 6]).filter((v) => !banned.includes(v))
    if (values.length > 0) out.push({ ...g, values })
  }
  return out
}

/**
 * batch D prep (rerollBannedValues): the die results no re-roll may touch for `side` of the attack in progress: the
 * roller is the side's operative, the opponent the other operative of the sequence.
 */
export function rerollBannedFor(state: GameState, side: DiceSide): number[] {
  const a = state.attack
  if (!a) return []
  const defender = a.seq?.targetId ?? a.fight?.targetId ?? a.targets?.[a.index]
  if (!defender) return []
  const isAttacker = side.operativeId === a.operativeId
  const defence = a.kind === 'shoot' && !isAttacker
  return providerRerollBannedValues(state, { kind: a.kind, rollerId: side.operativeId, opponentId: isAttacker ? defender : a.operativeId, defence })
}

// ---------------------------------------------------------------------------
// Dice sides
// ---------------------------------------------------------------------------

export function kindOf(value: number, need: number, lethal: number | null): DieKind {
  return classifyDie(value, need, lethal ?? undefined)
}

export function newSide(seat: Seat, operativeId: string, weaponId: string | null, need: number, lethal: number | null, grants: RerollGrant[]): DiceSide {
  return { seat, operativeId, weaponId, dice: [], need, lethal, grants, commandUsed: false, phase: 'grants' }
}

/** Re-derive the class of every rolled die from its value; a die with a tag was set by a rule or hook and is left alone. */
export function reclassify(side: DiceSide): void {
  for (const d of side.dice) if (d.value !== null && !d.tag) d.kind = kindOf(d.value, side.need, side.lethal)
}

export function pushRolled(side: DiceSide, values: number[]): void {
  for (const v of values) side.dice.push({ value: v, kind: kindOf(v, side.need, side.lethal), rerolled: false })
}

export function pushRetained(side: DiceSide, n: number, kind: DieKind, tag: string): void {
  for (let i = 0; i < n; i++) side.dice.push({ value: null, kind, rerolled: false, tag })
}

export function countKinds(dice: AttackDie[]): { normal: number; crit: number; fail: number } {
  let normal = 0
  let crit = 0
  let fail = 0
  for (const d of dice) {
    if (d.used) continue
    if (d.kind === 'normal') normal++
    else if (d.kind === 'crit') crit++
    else fail++
  }
  return { normal, crit, fail }
}

export function kindsOf(dice: AttackDie[]): DieKind[] {
  return dice.map((d) => d.kind)
}

export function valuesOf(dice: AttackDie[]): (number | null)[] {
  return dice.map((d) => d.value)
}

// ---------------------------------------------------------------------------
// Re-rolls (R-9.2, R-9.3): weapon-rule grants and the Command Re-roll
// ---------------------------------------------------------------------------

export function eligibleDice(side: DiceSide): number[] {
  const out: number[] = []
  side.dice.forEach((d, i) => {
    if (d.value !== null && !d.rerolled && !d.used) out.push(i)
  })
  return out
}

function firstOfEachValue(side: DiceSide, idx: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const i of idx) {
    const v = side.dice[i]!.value!
    if (seen.has(v)) continue
    seen.add(v)
    out.push(i)
  }
  return out
}

export interface RerollOptions {
  grants: OptionInput[]
  command: OptionInput[]
}

/** Enumerate the re-rolls a side can make right now. Equal results are equivalent, so one die per result is offered. */
export function rerollOptions(state: GameState, side: DiceSide): RerollOptions {
  // M9 prep: a rule can bar every re-roll of a side (Nightmare Shroud, Suppressing Fire)
  const banned = side.noRerolls === true || (state.attack ? providerRerollsBanned(state, side, state.attack) : false)
  // batch D prep: results a team rule bars from any re-roll (Sinister Trophies: 1s)
  const barred = banned ? [] : rerollBannedFor(state, side)
  const eligAll = banned ? [] : eligibleDice(side).filter((i) => !barred.includes(side.dice[i]!.value!))
  const grants: OptionInput[] = []
  const command: OptionInput[] = []
  if (eligAll.length === 0) return { grants, command }
  for (const g of side.grants) {
    if (g.used) continue
    // M9 batch B: a grant limited to some values (Omen: 1s only)
    const elig = g.values ? eligAll.filter((i) => g.values!.includes(side.dice[i]!.value!)) : eligAll
    if (elig.length === 0) continue
    if (g.mode === 'one') {
      for (const i of firstOfEachValue(side, elig)) {
        grants.push({ id: `${g.id}:${i}`, labelKey: `reroll.${g.id}`, type: 'dice.reroll', payload: { grant: g.id, dice: [i] }, data: { source: g.source, value: side.dice[i]!.value } })
      }
    } else if (g.mode === 'result') {
      const values = [...new Set(elig.map((i) => side.dice[i]!.value!))].sort((a, b) => a - b)
      for (const v of values) {
        const dice = elig.filter((i) => side.dice[i]!.value === v)
        grants.push({ id: `${g.id}:v${v}`, labelKey: `reroll.${g.id}`, type: 'dice.reroll', payload: { grant: g.id, result: v, dice }, data: { source: g.source, result: v, count: dice.length } })
      }
    } else {
      const fails = elig.filter((i) => side.dice[i]!.kind === 'fail')
      const nonCrit = elig.filter((i) => side.dice[i]!.kind !== 'crit')
      if (fails.length > 0) grants.push({ id: `${g.id}:fails`, labelKey: `reroll.${g.id}.fails`, type: 'dice.reroll', payload: { grant: g.id, dice: fails }, data: { source: g.source, count: fails.length } })
      if (nonCrit.length > fails.length) grants.push({ id: `${g.id}:nonCrit`, labelKey: `reroll.${g.id}.nonCrit`, type: 'dice.reroll', payload: { grant: g.id, dice: nonCrit }, data: { source: g.source, count: nonCrit.length } })
      for (const i of firstOfEachValue(side, elig)) {
        grants.push({ id: `${g.id}:${i}`, labelKey: `reroll.${g.id}`, type: 'dice.reroll', payload: { grant: g.id, dice: [i] }, data: { source: g.source, value: side.dice[i]!.value } })
      }
    }
  }
  const cost = commandRerollCost(state, side)
  if (!side.commandUsed && state.players[side.seat].cp >= cost) {
    for (const i of firstOfEachValue(side, eligAll)) {
      command.push({ id: `command:${i}`, labelKey: 'reroll.command', type: 'dice.commandReroll', payload: { command: true, dice: [i] }, data: { value: side.dice[i]!.value, cost } })
    }
  }
  return { grants, command }
}

/**
 * The re-roll the default policy makes (used by exact odds and the default bot): re-roll failed dice
 * with every grant; Ceaseless picks the failing result shown most often. Returns the indexes to
 * re-roll for the first usable grant, or null.
 */
export function policyReroll(dice: AttackDie[], grants: RerollGrant[]): { grant: string; dice: number[] } | null {
  const failed: number[] = []
  dice.forEach((d, i) => {
    if (d.value !== null && !d.rerolled && !d.used && d.kind === 'fail') failed.push(i)
  })
  if (failed.length === 0) return null
  for (const g of grants) {
    if (g.used) continue
    if (g.values) {
      // M9 batch B: a value-limited grant re-rolls the failed dice it allows
      const ok = failed.filter((i) => g.values!.includes(dice[i]!.value!))
      if (ok.length === 0) continue
      return { grant: g.id, dice: g.mode === 'one' ? [ok[0]!] : ok }
    }
    if (g.mode === 'one') return { grant: g.id, dice: [failed[0]!] }
    if (g.mode === 'any') return { grant: g.id, dice: failed }
    const tally = new Map<number, number[]>()
    for (const i of failed) {
      const v = dice[i]!.value!
      tally.set(v, [...(tally.get(v) ?? []), i])
    }
    let best: number[] = []
    let bestV = 7
    for (const [v, list] of tally) {
      if (list.length > best.length || (list.length === best.length && v < bestV)) {
        best = list
        bestV = v
      }
    }
    return { grant: g.id, dice: best }
  }
  return null
}

export interface RerollChoice {
  grantId: string | null
  command: boolean
  dice: number[]
}

/** Validate a re-roll payload against the side; returns the dice indexes and the grant (or command). */
export function parseReroll(
  state: GameState,
  side: DiceSide,
  payload: Record<string, unknown>,
): { rejection: Rejection } | RerollChoice {
  const dice = payload.dice
  if (!Array.isArray(dice) || dice.length === 0 || !dice.every((i) => Number.isInteger(i))) {
    return { rejection: { code: 'E_SCHEMA', reason: 'a re-roll names the dice to re-roll' } }
  }
  const elig = new Set(eligibleDice(side))
  if (!(dice as number[]).every((i) => elig.has(i))) {
    return { rejection: { code: 'E_NOT_AN_OPTION', reason: 'only dice that were rolled and not yet re-rolled can be re-rolled' } }
  }
  const barred = rerollBannedFor(state, side)
  if ((dice as number[]).some((i) => barred.includes(side.dice[i]!.value!))) {
    return { rejection: { code: 'E_NOT_AN_OPTION', reason: `dice showing ${barred.join(' or ')} cannot be re-rolled` } }
  }
  if (payload.command === true) {
    if (side.commandUsed) return { rejection: { code: 'E_PLOY_USED', reason: 'Command Re-roll was already used on this roll' } }
    const cost = commandRerollCost(state, side)
    if (state.players[side.seat].cp < cost) return { rejection: { code: 'E_INSUFFICIENT_CP', reason: `Command Re-roll costs ${cost} CP` } }
    if (dice.length !== 1) return { rejection: { code: 'E_NOT_AN_OPTION', reason: 'Command Re-roll re-rolls one die' } }
    return { grantId: null, command: true, dice: dice as number[] }
  }
  const grant = side.grants.find((g) => g.id === payload.grant && !g.used)
  if (!grant) return { rejection: { code: 'E_NOT_AN_OPTION', reason: 'that re-roll is not available' } }
  if (grant.values && !(dice as number[]).every((i) => grant.values!.includes(side.dice[i]!.value!))) {
    return { rejection: { code: 'E_NOT_AN_OPTION', reason: `that re-roll only re-rolls dice showing ${grant.values.join(' or ')}` } }
  }
  return { grantId: grant.id, command: false, dice: dice as number[] }
}

/** batch C shared: what a Command Re-roll of `side` costs now (team providers may make it free). */
export function commandRerollCost(state: GameState, side: DiceSide): number {
  return providerCommandRerollCost(state, side, state.attack ?? null)
}

/** Perform a validated re-roll: roll the dice, mark them, spend CP for a Command Re-roll. */
export function applyReroll(
  ctx: Ctx,
  side: DiceSide,
  parsed: RerollChoice,
  label: 'attack' | 'defence',
  prefix: string,
): void {
  const s = ctx.state
  const dice = parsed.dice
  const before = dice.map((i) => side.dice[i]!.value)
  if (parsed.command) {
    const cost = commandRerollCost(s, side)
    side.commandUsed = true
    if (cost > 0) {
      s.players[side.seat].cp -= cost
      ctx.emit({ type: 'CpChanged', delta: -cost, cp: s.players[side.seat].cp, reason: 'commandReroll' }, side.seat)
    }
    ctx.emit({ type: 'PloyUsed', ployId: 'core.command-reroll' }, side.seat)
    providerOnCommandReroll(ctx, side, cost)
  } else {
    const grant = side.grants.find((g) => g.id === parsed.grantId)
    if (grant) grant.used = true
  }
  const rolled = ctx.roll(`${prefix}.${label}.reroll`, dice.length)
  dice.forEach((i, k) => {
    const d = side.dice[i]!
    d.value = rolled[k]!
    d.rerolled = true
    d.kind = kindOf(d.value, side.need, side.lethal)
  })
  ctx.emit(
    { type: 'DiceRerolled', side: label, operativeId: side.operativeId, source: parsed.command ? 'command' : (parsed.grantId ?? 'unknown'), indexes: dice, before, after: rolled },
    side.seat,
  )
}

/**
 * M9 batch B: re-roll dice of a side because a rule forces it (Omen: re-roll 6s), outside any grant or Command
 * Re-roll. Only dice that were rolled and not yet re-rolled are touched; they count as re-rolled (R-9.2).
 */
export function forcedReroll(ctx: Ctx, side: DiceSide, indexes: number[], source: string, label: 'attack' | 'defence', prefix: string): number[] {
  const elig = new Set(eligibleDice(side))
  const dice = indexes.filter((i) => elig.has(i))
  if (dice.length === 0) return []
  const before = dice.map((i) => side.dice[i]!.value)
  const rolled = ctx.roll(`${prefix}.${label}.forced`, dice.length)
  dice.forEach((i, k) => {
    const d = side.dice[i]!
    d.value = rolled[k]!
    d.rerolled = true
    d.kind = kindOf(d.value, side.need, side.lethal)
  })
  ctx.emit({ type: 'DiceRerolled', side: label, operativeId: side.operativeId, source, indexes: dice, before, after: rolled }, side.seat)
  return dice
}

/** M9 batch B: run the diceRolled hook for a freshly rolled side. */
export function runDiceRolled(ctx: Ctx, kind: 'shoot' | 'fight', which: 'attack' | 'defence', side: DiceSide, opponentId: string): void {
  runHook('diceRolled', { seat: side.seat, state: ctx.state, engine: ctx, operativeId: side.operativeId, targetId: opponentId, ...(side.weaponId ? { weaponId: side.weaponId } : {}), data: { kind, side: which, diceSide: side } })
}

/** Index of the next option phase for a side, given that it has just made (or passed) a re-roll. */
export function sideHasRerolls(state: GameState, side: DiceSide): boolean {
  const o = rerollOptions(state, side)
  return o.grants.length > 0 || o.command.length > 0
}

// ---------------------------------------------------------------------------
// Retention (R-5.6 to R-5.8)
// ---------------------------------------------------------------------------

export interface RetainOutcome {
  critRetained: boolean
  converted: string[]
  obscuredDiscarded: boolean
}

/** batch C shared: tags of dice a rule has fixed in place (Warpcoven's set-aside Fate dice): Severe skips them. */
const FIXED_DIE_TAGS = new Set<string>()
export function registerFixedDieTag(tag: string): void {
  FIXED_DIE_TAGS.add(tag)
}
export function isFixedDie(d: { tag?: string }): boolean {
  return d.tag !== undefined && FIXED_DIE_TAGS.has(d.tag)
}

/**
 * Apply Punishing, Rending, Severe and the obscured effect to a rolled attack pool (mutates `dice`).
 * Dice are classified first (Hit and Lethal); retained-without-rolling dice are already normal.
 * Obscured (R-5.8) beats every other rule: crits become normals for good, one success is discarded,
 * and since no crit is retained Punishing, Rending and Severe cannot trigger.
 */
export function retainAttack(side: DiceSide, rules: RuleSet, obscured: boolean): RetainOutcome {
  const dice = side.dice
  reclassify(side)
  const converted: string[] = []
  if (obscured) {
    for (const d of dice) {
      if (d.kind === 'crit') {
        d.kind = 'normal'
        d.tag = 'obscured'
      }
    }
    // the attacker discards one success of their choice: every success is a normal now
    let discarded = false
    for (let i = dice.length - 1; i >= 0; i--) {
      if (dice[i]!.kind === 'normal') {
        dice[i]!.kind = 'fail'
        dice[i]!.tag = 'obscuredDiscard'
        discarded = true
        break
      }
    }
    return { critRetained: false, converted, obscuredDiscarded: discarded }
  }
  const naturalCrit = dice.some((d) => d.kind === 'crit')
  if (naturalCrit) {
    if (rules.punishing) {
      const f = dice.find((d) => d.kind === 'fail' && d.value !== null && !d.tag)
      if (f) {
        f.kind = 'normal'
        f.tag = 'punishing'
        converted.push('punishing')
      }
    }
    if (rules.rending) {
      const n = dice.find((d) => d.kind === 'normal' && d.value !== null && !d.tag)
      if (n) {
        n.kind = 'crit'
        n.tag = 'rending'
        converted.push('rending')
      }
    }
  } else if (rules.severe) {
    // batch C shared: a die a rule has fixed (registerFixedDieTag: Fate Itself) is never converted
    const n = dice.find((d) => d.kind === 'normal' && !isFixedDie(d))
    if (n) {
      n.kind = 'crit'
      n.tag = n.tag ?? 'severe'
      converted.push('severe')
    }
  }
  return { critRetained: dice.some((d) => d.kind === 'crit'), converted, obscuredDiscarded: false }
}

// ---------------------------------------------------------------------------
// Blocking (R-5.12)
// ---------------------------------------------------------------------------

export interface BlockPlan {
  unblockedNormal: number
  unblockedCrit: number
  blockedNormal: number
  blockedCrit: number
  damage: number
}

/**
 * Every maximal way to block: a normal blocks a normal, two normals block a crit, a crit blocks a
 * normal or a crit; Brutal lets only crits block. Plans leaving a superset of another plan's unblocked
 * dice are dominated and dropped. The first plan minimises damage (the `auto` block), then total
 * unblocked dice, then unblocked crits.
 */
export function blockPlans(
  an: number,
  ac: number,
  dn: number,
  dc: number,
  dmg: { normal: number; crit: number },
  brutal: boolean,
  cap = 12,
): BlockPlan[] {
  const seen = new Map<string, { rn: number; rc: number }>()
  const maxX1 = brutal ? 0 : Math.min(dn, an)
  for (let x1 = 0; x1 <= maxX1; x1++) {
    const maxX2 = brutal ? 0 : Math.min(Math.floor((dn - x1) / 2), ac)
    for (let x2 = 0; x2 <= maxX2; x2++) {
      const maxY1 = Math.min(dc, an - x1)
      for (let y1 = 0; y1 <= maxY1; y1++) {
        const maxY2 = Math.min(dc - y1, ac - x2)
        for (let y2 = 0; y2 <= maxY2; y2++) {
          const rn = an - x1 - y1
          const rc = ac - x2 - y2
          seen.set(`${rn},${rc}`, { rn, rc })
        }
      }
    }
  }
  const all = [...seen.values()]
  const minimal = all.filter((p) => !all.some((q) => q !== p && q.rn <= p.rn && q.rc <= p.rc))
  const plans: BlockPlan[] = minimal.map((p) => ({
    unblockedNormal: p.rn,
    unblockedCrit: p.rc,
    blockedNormal: an - p.rn,
    blockedCrit: ac - p.rc,
    damage: p.rn * dmg.normal + p.rc * dmg.crit,
  }))
  plans.sort(
    (a, b) =>
      a.damage - b.damage ||
      a.unblockedNormal + a.unblockedCrit - (b.unblockedNormal + b.unblockedCrit) ||
      a.unblockedCrit - b.unblockedCrit ||
      a.unblockedNormal - b.unblockedNormal,
  )
  return plans.slice(0, cap)
}

export function autoBlock(an: number, ac: number, dn: number, dc: number, dmg: { normal: number; crit: number }, brutal: boolean): BlockPlan {
  return blockPlans(an, ac, dn, dc, dmg, brutal)[0]!
}

// ---------------------------------------------------------------------------
// Target validity (R-5.2)
// ---------------------------------------------------------------------------

export interface TargetInfo {
  id: string
  verdict: TargetVerdict
  distance: number
  /** raw statuses */
  inCover: boolean
  obscured: boolean
  /** Conceal target is out of reach because of cover, after Seek, Seek Light and Vantage (R-5.2, R-10.18, R-11.5b) */
  coverBlocks: boolean
  /** the defender gets the improved Vantage cover save (R-11.5b) */
  improvedCover: boolean
}

/** Is the Conceal target "in cover" for selection once Seek, Seek Light and Vantage deny terrain? */
export function coverForSelection(state: GameState, verdict: TargetVerdict, rules: RuleSet): boolean {
  if (!verdict.inCover) return false
  if (rules.seek) return false
  let parts = verdict.coverParts
  if (rules.seekLight || verdict.vantage.denyLightCover) {
    const idx = terrainOf(state.map)
    parts = parts.filter((p) => !idx.byPart.get(p)?.light)
  }
  return parts.length > 0
}

/**
 * `target.status` hook (OPTICS, Auspex, Smoke): handlers may change the obscured / cover status of the
 * shooter-target pair after the terrain verdict. A forced cover-or-obscured choice that loses its
 * obscured half stops being a choice; a status set by a hook is final for both choices.
 */
function applyTargetStatus(state: GameState, shooter: Operative, target: Operative, verdict: TargetVerdict, weaponId?: string): TargetVerdict {
  const data = { obscured: verdict.obscured, inCover: verdict.inCover }
  // batch C shared: the weapon is named when known (Long-Sight odds), as HookContext.weaponId
  runHook('target.status', { seat: shooter.seat, state, operativeId: shooter.id, targetId: target.id, ...(weaponId ? { weaponId } : {}), data })
  if (data.obscured === verdict.obscured && data.inCover === verdict.inCover) return verdict
  const both = { inCover: data.inCover, obscured: data.obscured }
  return { ...verdict, inCover: data.inCover, obscured: data.obscured, forcedChoice: false, ifCover: { ...both }, ifObscured: { ...both } }
}

/**
 * Cover, obscured and visibility of `target` for `shooter`. M9 prep: `viewpoint` (Magnify's proxy) is the
 * operative the verdict is worked out from; the target.status hook still names the real shooter.
 */
export function targetInfo(state: GameState, shooter: Operative, target: Operative, rules: RuleSet, viewpoint?: Operative): TargetInfo {
  if (shooter.id === target.id) return selfInfo(state, shooter)
  const from = viewpoint ?? shooter
  const verdict = applyTargetStatus(state, shooter, target, targetVerdict(state, bodyOf(from), { ...bodyOf(target), order: target.order }), rules.weaponId)
  const coverBlocks = target.order === 'conceal' && coverForSelection(state, verdict, rules)
  return {
    id: target.id,
    verdict,
    distance: verdict.distance,
    inCover: verdict.inCover,
    obscured: verdict.obscured,
    coverBlocks,
    improvedCover: verdict.vantage.denyLightCover && verdict.inCover && !rules.seek && !rules.seekLight,
  }
}

/**
 * An operative shooting itself (the Bomb Squig's Explosive rule, R-5.16): always visible, never in cover
 * or obscured, no Vantage effects.
 */
export function selfInfo(state: GameState, op: Operative): TargetInfo {
  const b = bodyOf(op)
  const v = targetVerdict(state, b, { ...b, order: op.order })
  const none = { inCover: false, obscured: false }
  return {
    id: op.id,
    verdict: {
      ...v,
      visible: true,
      distance: 0,
      within2: true,
      inCover: false,
      obscured: false,
      coverParts: [],
      obscuringParts: [],
      forcedChoice: false,
      sharedFeatures: [],
      ifCover: none,
      ifObscured: none,
      vantage: { shooterOnVantage: false, lowerBy: 0, accurate: 0, denyLightCover: false },
    },
    distance: 0,
    inCover: false,
    obscured: false,
    coverBlocks: false,
    improvedCover: false,
  }
}

/**
 * Valid targets for a Shoot with `weaponId`: Range, no shooter-side operative in the target's control
 * range, visibility, and for Conceal targets not in cover (R-5.2). `beforeShootTargetSelect` may add
 * or remove candidates.
 */
export function validTargets(state: GameState, shooter: Operative, weaponId: string, ctx?: Ctx, viewpoint?: Operative): TargetInfo[] {
  const rules = ruleSetFor(state, shooter, weaponId, 'shoot', undefined, ctx)
  const infos = new Map<string, TargetInfo>()
  const ids: string[] = []
  const sb = bodyOf(shooter)
  for (const e of enemiesOf(state, shooter)) {
    if (e.wounds <= 0) continue
    // Range stays with the real shooter; validity, cover and obscured come from the viewpoint (Magnify)
    if (rules.range !== null && !isWithin(sb, bodyOf(e), rules.range)) continue
    if (enemiesInControlRange(state, e, e.seat).length > 0) continue
    const info = targetInfo(state, shooter, e, rules, viewpoint)
    if (!info.verdict.visible) continue
    if (viewpoint && !visible(state, sb, bodyOf(e))) continue
    if (info.coverBlocks) continue
    infos.set(e.id, info)
    ids.push(e.id)
  }
  const data = { weaponId, candidates: ids.slice(), secondary: false }
  runHook('beforeShootTargetSelect', {
    seat: shooter.seat,
    state,
    ...(ctx ? { engine: ctx } : {}),
    operativeId: shooter.id,
    weaponId,
    data,
  })
  const out: TargetInfo[] = []
  for (const id of data.candidates) {
    const known = infos.get(id)
    if (known) {
      out.push(known)
      continue
    }
    const t = state.operatives[id]
    if (!t || t.status !== 'active' || t.wounds <= 0) continue
    if (t.seat === shooter.seat && t.id !== shooter.id) continue
    out.push(targetInfo(state, shooter, t, rules, viewpoint))
  }
  return out
}

/**
 * M9 prep (generic capability "targetRedirect"): a defender's rule swaps the operative being attacked for
 * one of its own (Saviour Protocols, Unquestioning Loyalty). Call from a ploy or hook at the
 * `shoot.targetSelected` window (the current Shoot target) or at `fight.weaponsSelected` (the fight
 * opponent; the new defender retaliates with its first fight weapon). `status` replaces the shoot
 * sequence's cover / obscured verdict (copy the original target's, or AND it with the new one's).
 */
export function redirectAttack(ctx: Ctx, newTargetId: string, status?: { cover: boolean; obscured: boolean; improvedCover?: boolean }): boolean {
  const a = ctx.state.attack
  const t = ctx.state.operatives[newTargetId]
  if (!a || !t || t.status !== 'active') return false
  if (a.kind === 'shoot') {
    if (a.index >= a.targets.length) return false
    a.targets[a.index] = newTargetId
    if (status) a.status = { cover: status.cover, obscured: status.obscured, improvedCover: status.improvedCover ?? false }
    return true
  }
  if (!a.fight) return false
  a.fight.targetId = newTargetId
  a.targets = [newTargetId]
  const weapons = t.weapons.filter((w) => ctx.state.data.weapons[w]?.type === 'melee' && weaponUnusable(ctx.state, t, w, [], 'fight') === null)
  a.fight.weaponD = weapons[0] ?? null
  return true
}

/** Blast secondaries (R-10.3): operatives visible to and within x of the primary, friendly included, not the shooter. */
export function blastSecondaries(state: GameState, shooter: Operative, primary: Operative, inches: number): string[] {
  const pb = bodyOf(primary)
  const out: { id: string; d: number }[] = []
  for (const o of Object.values(state.operatives)) {
    if (o.status !== 'active' || o.id === primary.id || o.id === shooter.id || o.wounds <= 0) continue
    if (!isWithin(pb, bodyOf(o), inches)) continue
    if (!visible(state, pb, bodyOf(o)) && !visible(state, bodyOf(o), pb)) continue
    out.push({ id: o.id, d: distanceBetween(pb, bodyOf(o)) })
  }
  out.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
  return out.map((o) => o.id)
}

/** Torrent secondaries (R-10.23): other valid targets within x of the primary. */
export function torrentCandidates(state: GameState, shooter: Operative, weaponId: string, primaryId: string, inches: number, ctx?: Ctx, viewpoint?: Operative): string[] {
  if (inches <= 0) return []
  const pb = bodyOf(getOp(state, primaryId))
  return validTargets(state, shooter, weaponId, ctx, viewpoint)
    .filter((t) => t.id !== primaryId && isWithin(pb, bodyOf(getOp(state, t.id)), inches))
    .map((t) => t.id)
}

// ---------------------------------------------------------------------------
// Damage, injury, incapacitation and removal (R-7)
// ---------------------------------------------------------------------------

export function attackOf(ctx: Ctx): AttackState {
  const a = ctx.state.attack
  if (!a) throw new Error('no attack in progress')
  return a
}

/** Inflict damage; `onDamageInflicted` hooks may reduce it. Returns the damage actually dealt. */
export function inflict(
  ctx: Ctx,
  o: { targetId: string; attackerId: string; weaponId: string | null; amount: number; source: string; splash?: boolean },
): number {
  const s = ctx.state
  const target = getOp(s, o.targetId)
  // M9 batch C: `splash` marks x" Devastating damage on an operative that is not the target of the sequence (Void Armour)
  const data = { source: o.source, attackerId: o.attackerId, weaponId: o.weaponId, amount: o.amount, ...(o.splash ? { splash: true } : {}) }
  runHook('onDamageInflicted', {
    seat: target.seat,
    state: s,
    engine: ctx,
    operativeId: o.targetId,
    targetId: o.attackerId,
    ...(o.weaponId ? { weaponId: o.weaponId } : {}),
    data,
  })
  const amount = Math.max(0, Math.floor(data.amount))
  if (amount === 0) return 0
  const before = target.wounds
  target.wounds = Math.max(0, before - amount)
  // M9 prep: a rule may stop the incapacitation at this moment (Medic!): it sets the wounds back above 0
  if (before > 0 && target.wounds <= 0) {
    const save = { source: o.source, attackerId: o.attackerId, weaponId: o.weaponId, wounds: 0 }
    runHook('beforeIncapacitated', { seat: target.seat, state: s, engine: ctx, operativeId: target.id, targetId: o.attackerId, ...(o.weaponId ? { weaponId: o.weaponId } : {}), data: save })
    if (save.wounds > 0) target.wounds = Math.min(target.maxWounds, Math.floor(save.wounds))
    // batch D prep (killLog): the damage that took it to 0 names the killer, whatever the cause
    else target.incapacitatedBy = { id: o.attackerId, source: o.source }
  }
  ctx.emit({ type: 'DamageInflicted', operativeId: target.id, sourceId: o.attackerId, amount, source: o.source, wounds: target.wounds })
  // M9 prep: wounds actually lost, for rules that react to it (Grandfather's Blessing)
  runHook('damage.inflicted', {
    seat: target.seat,
    state: s,
    engine: ctx,
    operativeId: target.id,
    targetId: o.attackerId,
    ...(o.weaponId ? { weaponId: o.weaponId } : {}),
    data: { source: o.source, attackerId: o.attackerId, weaponId: o.weaponId, amount: before - target.wounds, woundsBefore: before, woundsAfter: target.wounds },
  })
  if (!target.flags.injured && isInjured(target) && target.wounds > 0) {
    target.flags.injured = true
    ctx.emit({ type: 'OperativeInjured', operativeId: target.id })
  }
  if (before > 0 && target.wounds <= 0) {
    ctx.emit({ type: 'OperativeIncapacitated', operativeId: target.id })
    const a = s.attack
    if (a && !a.incapacitated.includes(target.id)) a.incapacitated.push(target.id)
  }
  return amount
}

/**
 * Remove everything incapacitated by the action (R-5.14, R-5.18). Call with the attack already cleared
 * from the state. Each operative's `operative.incapacitated` hooks run first ("before removal" free
 * actions such as Boom!); if a hook raises a decision (a free action in a frame) the removal is
 * suspended and the owner of that decision calls `continueRemovals(ctx)` when it is finished.
 * Returns true when every operative has been removed.
 */
export function beginRemovals(ctx: Ctx, ids: string[], killers?: Record<string, string>): boolean {
  ctx.state.removal = { ids: ids.slice(), hooked: [], ...(killers && Object.keys(killers).length > 0 ? { killers: { ...killers } } : {}) }
  return processRemovals(ctx)
}

function processRemovals(ctx: Ctx): boolean {
  const s = ctx.state
  const r = s.removal
  if (!r) return true
  while (r.ids.length > 0) {
    const id = r.ids[0]!
    const op = s.operatives[id]
    if (op && op.status !== 'removed') {
      if (!r.hooked.includes(id)) {
        r.hooked.push(id)
        runHook('operative.incapacitated', { seat: op.seat, state: s, engine: ctx, operativeId: id })
        if (s.pending) return false
      }
      // M9 shared: then the owner's `operative.incapacitated` ploy window (Poisonous Demise style), before removal
      if (!(r.windowed ?? []).includes(id)) {
        r.windowed = [...(r.windowed ?? []), id]
        if (removalWindow?.(ctx, op)) return false
      }
      // M10 batch D shared: a before-removal decision saved it (saveFromRemoval: a Medic! taken at removal); plain
      // wounds regained before removal do not stop it (R-7.4)
      if ((r.saved ?? []).includes(id) && op.wounds > 0) {
        r.ids.shift()
        continue
      }
      op.status = 'removed'
      op.ready = false
      op.flags.guard = false
      ctx.emit({ type: 'OperativeRemoved', operativeId: id }, op.seat)
      // M10 batch D shared: the kill log at removal time, before this removal's windows
      noteRemoval(ctx, op)
      // M9 batch B: the killer's seat may answer the removal (operative.killed window)
      if (!(r.killWindowed ?? []).includes(id)) {
        r.killWindowed = [...(r.killWindowed ?? []), id]
        if (killWindow?.(ctx, op)) {
          r.ids.shift()
          return false
        }
      }
    }
    r.ids.shift()
  }
  s.removal = null
  return true
}

let removalsDone: ((ctx: Ctx) => void) | null = null
let removalWindow: ((ctx: Ctx, op: Operative) => boolean) | null = null
let killWindow: ((ctx: Ctx, op: Operative) => boolean) | null = null

/** M9 batch B: ploys.ts registers the `operative.killed` window, offered after a removal (true: the queue waits). */
export function registerKillWindow(fn: ((ctx: Ctx, op: Operative) => boolean) | null): void {
  killWindow = fn
}

/**
 * ploys.ts registers the `operative.incapacitated` ploy window of the removal queue: true when it raised a
 * decision (the queue then waits; closing the window calls continueRemovals).
 */
export function registerRemovalWindow(fn: ((ctx: Ctx, op: Operative) => boolean) | null): void {
  removalWindow = fn
}

/** shoot.ts registers what happens once every removal is finished (finishAction). */
export function registerRemovalsDone(fn: (ctx: Ctx) => void): void {
  removalsDone = fn
}

/** Resume a removal that a "before removal" free action suspended; finishes the original action afterwards. */
export function continueRemovals(ctx: Ctx): void {
  const r = ctx.state.removal
  if (!r) return
  if (!processRemovals(ctx)) return
  // M10 batch D shared: a deferred queue (removals outside an attack) gives the step's own decision back
  if (r.deferred) restoreParked(ctx, r.parked ?? null)
  else removalsDone?.(ctx)
}

// ---------------------------------------------------------------------------
// M10 batch D shared: removals outside an attack that can pause for a decision
// ---------------------------------------------------------------------------

/**
 * M10 batch D shared: a rule taken while `operativeId` waits in the removal queue (its `operative.incapacitated` hook
 * or a decision raised there) says it is not incapacitated after all (Medic! with a decline option): it keeps
 * `wounds` and the queue skips it. Regaining wounds alone does not stop a removal (R-7.4). False outside a queue.
 */
export function saveFromRemoval(ctx: Ctx, operativeId: string, wounds: number): boolean {
  const s = ctx.state
  const r = s.removal
  const op = s.operatives[operativeId]
  if (!r || !op || op.status === 'removed' || !r.ids.includes(operativeId)) return false
  op.wounds = Math.max(1, Math.min(op.maxWounds, Math.floor(wounds)))
  delete op.incapacitatedBy
  r.saved = [...(r.saved ?? []), operativeId]
  if (s.deferredRemovals) s.deferredRemovals = s.deferredRemovals.filter((id) => id !== operativeId)
  return true
}

let removalPauseCheck: ((state: GameState, op: Operative) => boolean) | null = null

/** ploys.ts registers whether a removal would offer a ploy window (operative.incapacitated, operative.killed). */
export function registerRemovalPauseCheck(fn: ((state: GameState, op: Operative) => boolean) | null): void {
  removalPauseCheck = fn
}

/**
 * Should the removal of `op` (incapacitated outside an attack, effects.removeNow) wait for the end of the step, where
 * it can pause for decisions? True when a team provider asks for it (`pausableRemoval`) or a ploy window would offer
 * something (the owner's `operative.incapacitated`, the killer's `operative.killed` for a rule kill).
 */
export function removalCanPause(state: GameState, op: Operative): boolean {
  if (state.attack || state.removal) return false
  return providerPausableRemoval(state, op) || (removalPauseCheck?.(state, op) ?? false)
}

/** Queue `op` for the deferred removal pass at the end of the step (effects.removeNow calls it). */
export function deferRemoval(ctx: Ctx, operativeId: string): void {
  const list = (ctx.state.deferredRemovals ??= [])
  if (!list.includes(operativeId)) list.push(operativeId)
}

/**
 * Run the deferred removals at the end of the step (apply.afterAction). The decision the step raised is parked on the
 * queue; the queue runs the before-removal hooks and windows (which may raise decisions of their own: the step then
 * ends on that decision and continueRemovals resumes later), removes, and gives the parked decision back. Inside an
 * attack or another removal queue the ids join that one instead. True when at least one operative was removed now
 * or a decision is waiting.
 */
export function runDeferredRemovals(ctx: Ctx): boolean {
  const s = ctx.state
  const ids = (s.deferredRemovals ?? []).filter((id) => {
    const op = s.operatives[id]
    return !!op && op.status !== 'removed' && op.wounds <= 0
  })
  delete s.deferredRemovals
  if (ids.length === 0) return false
  if (s.removal) {
    for (const id of ids) if (!s.removal.ids.includes(id) && !s.removal.hooked.includes(id)) s.removal.ids.push(id)
    return false
  }
  if (s.attack) {
    for (const id of ids) if (!s.attack.incapacitated.includes(id)) s.attack.incapacitated.push(id)
    return false
  }
  const killers: Record<string, string> = {}
  for (const id of ids) {
    const by = s.operatives[id]!.incapacitatedBy
    const k = by ? s.operatives[by.id] : undefined
    if (k && k.seat !== s.operatives[id]!.seat) killers[id] = k.id
  }
  const parked = s.pending
  s.pending = null
  s.removal = { ids, hooked: [], deferred: true, parked, ...(Object.keys(killers).length > 0 ? { killers } : {}) }
  if (processRemovals(ctx)) restoreParked(ctx, parked)
  return true
}

/** Give back the decision a deferred removal queue parked, without options that name an operative removed meanwhile. */
function restoreParked(ctx: Ctx, parked: PendingDecision | null): void {
  const s = ctx.state
  if (s.pending || !parked) return
  const gone = (id: unknown): boolean => typeof id === 'string' && s.operatives[id]?.status === 'removed'
  if (parked.options) {
    const keep = parked.options.filter((o) => {
      const p = (o.action as { payload?: Record<string, unknown> }).payload ?? {}
      return !gone(p.operativeId) && !gone(p.targetId)
    })
    if (keep.length > 0 && keep.length < parked.options.length) parked = { ...parked, options: keep }
  }
  s.pending = parked
}

/** Reduce an operative's APL by `delta` until the end of its next activation (Stun, R-10.22). */
export function applyAplEffect(ctx: Ctx, operativeId: string, delta: number, source: string, opts: { ceiling?: number } = {}): void {
  const op = getOp(ctx.state, operativeId)
  if (op.flags.ignoreApl) return
  op.aplMods += delta
  // batch C shared: a change "to a maximum of N" (aplCeiling) keeps its ceiling; effectiveApl applies it
  op.aplFx = [...(op.aplFx ?? []), { delta, source, ...(opts.ceiling !== undefined ? { ceiling: opts.ceiling } : {}) }]
  ctx.emit({ type: 'AplModified', operativeId, delta, reason: source })
}

/** Called when an operative's activation ends: timed APL effects expire. */
export function expireAplEffects(ctx: Ctx, operativeId: string): void {
  const op = getOp(ctx.state, operativeId)
  if (!op.aplFx || op.aplFx.length === 0) return
  for (const fx of op.aplFx) {
    op.aplMods -= fx.delta
    ctx.emit({ type: 'AplModified', operativeId, delta: -fx.delta, reason: `${fx.source}.expired` })
  }
  op.aplFx = []
}

// ---------------------------------------------------------------------------
// Ploy windows and the resume plumbing
// ---------------------------------------------------------------------------

type Resumer = (ctx: Ctx) => void
const resumers: { shoot?: Resumer; fight?: Resumer } = {}

export function registerResumer(kind: 'shoot' | 'fight', fn: Resumer): void {
  resumers[kind] = fn
}

/** Continue the suspended attack once a ploy decision opened in a window has been resolved. */
export function resumeAttack(ctx: Ctx): void {
  const a = ctx.state.attack
  if (!a) return
  resumers[a.kind]?.(ctx)
}

/** Offer a ploy window once; true when the opener raised a decision and the attack must wait. */
export function openWindow(ctx: Ctx, window: TimingWindowId, targetId: string): boolean {
  const opener = getWindowOpener()
  if (!opener) return false
  const a = attackOf(ctx)
  const key = `${a.index}:${targetId}:${window}`
  if (a.windows.includes(key)) return false
  a.windows.push(key)
  return opener(ctx, window, { kind: a.kind, attackerId: a.operativeId, targetId })
}

// ---------------------------------------------------------------------------
// Hook-requested choices (weapon.choice)
// ---------------------------------------------------------------------------

export function choiceOptions(requestId: string, options: { id: string; labelKey: string }[]): OptionInput[] {
  return options.map((o) => ({
    id: o.id,
    labelKey: o.labelKey,
    type: 'weapon.choice' as const,
    payload: { choice: requestId, option: o.id },
  }))
}

export function seqOf(ctx: Ctx): AttackSequence {
  const a = attackOf(ctx)
  if (!a.seq) throw new Error('no sequence in progress')
  return a.seq
}

export function sideSeat(seat: Seat): Seat {
  return otherSeat(seat)
}

export type { Action, PendingDecision }
