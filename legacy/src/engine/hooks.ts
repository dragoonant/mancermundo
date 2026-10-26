// Hook names, contexts and results (frozen after M2). M2a declares them only; M2b rules modules
// (weapons.ts, abilities.ts, ploys.ts, equipment.ts) register implementations.
import type { Ctx } from './registry'
import type { AttackDie, DieKind, GameState, RerollGrant, Seat, TimingWindowId, WeaponRuleRef } from './types'

export const HOOK_NAMES = [
  'stat.apl',
  'stat.move',
  'stat.hit',
  'stat.save',
  'weapon.rules',
  'target.valid',
  'action.cost',
  'action.available',
  'attack.collected',
  'attack.rolled',
  'attack.retained',
  'defence.collected',
  'defence.rolled',
  'block.allowed',
  'damage.inflicted',
  'activation.start',
  'activation.end',
  'turningPoint.start',
  'turningPoint.end',
  'operative.incapacitated',
  // M2b-game: the cover/obscured status of a shooter-target pair (OPTICS, Auspex, Smoke); see TargetStatusData
  'target.status',
  // M9 prep: after any action of any operative has resolved (Tesla Weave, Markerlight decay); see ActionEndedData
  'action.ended',
  // M9 batch B: an action was just declared, before it resolves; a handler may cancel it (Daemonic Aura); see ActionDeclaredData
  'action.declared',
  // M9 batch B: a seat passed in the Gambit step (explicitly or with nothing usable); see GambitPassedData (Cunning)
  'gambit.passed',
  // batch D prep: an operative left the killzone for good, any cause (killLog); see OperativeRemovedData
  'operative.removed',
  // M10 batch D shared: a counteraction ended, before its expiry and the end-of-counteraction reaction point
  'counteraction.end',
] as const

/**
 * operative.removed (batch D prep): `operativeId` was removed from the killzone (attack, direct damage, mines, a
 * deadline out of the killzone) or scored as incapacitated while still in it (kills.scoreAsIncapacitated, Frenzy).
 * Runs once per operative and removal, after the step's action, with `engine` (no decisions: a rule that needs a
 * choice offers it at the next reaction point, reading kills.killsSince). `targetId` is the killer when known.
 */
export interface OperativeRemovedData {
  killerId: string | null
  cause: 'attack' | 'direct' | 'offboard' | 'scored'
}

/**
 * gambit.passed (M9 batch B): `seat` passed in the Gambit step. `explicit` is false for the implicit pass of a seat
 * with nothing usable; `usedThisStep` lists the gambit ids both seats used in this step so far, in order, with the
 * seat that used each. Runs with `engine` (CP may change; no decisions).
 */
export interface GambitPassedData {
  explicit: boolean
  usedThisStep: { seat: Seat; gambitId: string }[]
  passes: number
}

/*
 * M9 prep: lifecycle hook points that now run with `engine` (the step Ctx) so team files can act on them.
 * Handlers may change state through `engine`, roll dice, inflict damage (effects.directDamage) and emit
 * events, but must not raise decisions (a lifecycle point has no resume): rules that need a choice pick
 * the best option themselves (record a RULING) or open a ploy window elsewhere.
 *  - 'turningPoint.start': the Ready step of the Strategy phase, after the initiative roll-off and before CP
 *    are gained and operatives readied (Living Metal, Reanimation Protocols, Tesseract Cube). data: { turningPoint }
 *  - 'activation.start': an operative was activated and its order chosen, before its first action
 *    (Poison damage, Cult Ambush). operativeId = the activated operative; data: { previousOrder, order }.
 *    Not run for counteractions or free-action frames. If a handler incapacitates the operative its
 *    activation ends.
 *  - 'activation.end': the operative's activation ends, before "until the end of its activation" effects
 *    expire. operativeId; data: { counteract }
 *  - 'turningPoint.end': after the end-of-Firefight ploy window, before the TP's crit op scoring
 *    (Wyrmblade HIDING deadline). data: { turningPoint }
 *  - 'damage.inflicted': after wounds were lost (any source); operativeId = the operative that lost them,
 *    targetId = the attacker or rule source. data: DamageInflictedData
 *  - 'action.ended': see ActionEndedData
 */

/** damage.inflicted (M9 prep): the wounds actually lost, after onDamageInflicted reductions. */
export interface DamageInflictedData {
  source: string
  attackerId: string
  weaponId: string | null
  amount: number
  woundsBefore: number
  woundsAfter: number
}

/** action.ended (M9 prep): `operativeId` performed `action` (universal id or ability:<id>); the step Ctx is `engine`. */
export interface ActionEndedData {
  action: string
  counteract: boolean
  free: boolean
  /** seat of the activation the action belongs to (the frame's owner for free actions) */
  activeSeat: Seat
}

/**
 * target.status (M2b-game): `operativeId` is the shooter, `targetId` the target. Handlers may set
 * `obscured` to false (OPTICS, Auspex: enemies cannot be obscured) or true (Smoke, M-5.5). The attack
 * code runs it from `targetInfo` after the terrain verdict, before the forced cover/obscured choice.
 */
export interface TargetStatusData {
  obscured: boolean
  inCover: boolean
}

/**
 * action.declared (M9 batch B): `operativeId` has just declared `action` (universal id or ability:<id>), normal or
 * free, before any ploy window and before it resolves; the step Ctx is `engine` (dice may be rolled, no decisions).
 * A handler may set `cancel` (the action is cancelled as R-3.8: no AP spent) with a `reason`, and `bar` to stop the
 * operative taking that action again for the rest of its activation or counteraction (Daemonic Aura, Chain Snare).
 */
export interface ActionDeclaredData {
  action: string
  counteract: boolean
  free: boolean
  /** seat of the activation the action belongs to */
  activeSeat: Seat
  cancel: boolean
  bar: boolean
  reason?: string
}

export type HookName = (typeof HOOK_NAMES)[number]

export interface HookContext {
  hook: HookName | AttackHookName
  seat: Seat
  /** M2b-attack: the state the hook runs against (a draft during a step; mutate only `data` or use `engine`) */
  state?: GameState
  /** M2b-attack: the step context when running inside a step (absent for queries and validation) */
  engine?: Ctx
  operativeId?: string
  targetId?: string
  weaponId?: string
  action?: string
  data?: Record<string, unknown>
}

export interface HookResult {
  /** numeric delta applied to the stat or cost named by the hook */
  delta?: number
  /** set when a rule forbids or allows the thing being asked about */
  allow?: boolean
  reason?: string
  data?: Record<string, unknown>
}

export type HookFn = (ctx: HookContext) => HookResult | null

// TODO(M2b): registry of hook implementations keyed by HookName.

// ---------------------------------------------------------------------------
// M2b-attack: the hook registry and the attack-sequence hook points (additive).
//
// Handlers receive a HookContext whose `data` is the LIVE object for that hook point: they mutate it
// in place (push to `rules`, change `hitDelta`, lower `amount`) and may also return a HookResult
// (ignored by the engine unless a hook below says otherwise). `state` is the current state (a draft
// while a step runs, so handlers must only mutate `data`, or `engine` when present). Handlers must be
// idempotent: the engine re-runs a hook after a `weapon.choice` it requested was answered.
// Convention: `operativeId` is the subject of the hook (the shooter or fighter whose pool is modified,
// the striker, the operative taking the damage); `targetId` is its opponent in the sequence.
// ---------------------------------------------------------------------------

export const ATTACK_HOOKS = [
  'beforeShootTargetSelect',
  'modifyAttackDice',
  'modifyDefenceDice',
  'afterAttackRoll',
  'afterDefenceRoll',
  'modifyWeaponRules',
  'onDamageInflicted',
  'beforeStrike',
  'onFightResolved',
  'afterShootResolved',
  // M9 prep
  'modifyDamage',
  'beforeIncapacitated',
  // M9 batch B: a side has just been rolled, before any re-roll (Omen: the opponent must re-roll 6s); see DiceRolledData
  'diceRolled',
  // M9 batch C: a fighter has just blocked in the Resolve step (Riposte: a crit block also deals Critical Dmg); see AfterBlockData
  'afterBlock',
] as const

/**
 * afterBlock (M9 batch C): `operativeId` has just blocked with one of its dice in a fight (strike-or-block step);
 * `targetId` is its opponent. Runs with `engine`: a handler may inflict damage (attack-common.inflict with a
 * `strike-*` source, so per-die reductions apply) but must not raise decisions. When the opponent is incapacitated
 * the fight ends as after a strike.
 */
export interface AfterBlockData {
  /** the blocking die */
  die: DieKind
  /** the dice it cancelled (one, or two with a double block) */
  against: DieKind[]
  weaponId: string | null
}

/**
 * diceRolled (M9 batch B): `operativeId` has just rolled `dice` (shoot attack, shoot defence, or one fighter's dice),
 * before any re-roll window or grant. Runs with `engine`; a handler may re-roll dice at once with
 * attack-common.forcedReroll (which marks them re-rolled, R-9.2). `targetId` is its opponent in the sequence.
 */
export interface DiceRolledData {
  kind: 'shoot' | 'fight'
  side: 'attack' | 'defence'
  /** the live side (attack-common DiceSide) */
  diceSide: unknown
}

/**
 * modifyDamage (M9 prep): the Normal and Critical Dmg a weapon deals in this sequence (Toxic +1/+1).
 * `operativeId` is the attacker, `targetId` the operative the dice resolve against. Mutate `dmg`.
 */
export interface ModifyDamageData {
  kind: 'shoot' | 'fight'
  weaponId: string
  dmg: { normal: number; crit: number }
}

/**
 * beforeIncapacitated (M9 prep): damage has just taken `operativeId` to 0 wounds, before
 * OperativeIncapacitated is emitted. A handler may set `wounds` above 0 to stop the incapacitation
 * (Medic!); it must not raise a decision.
 */
export interface BeforeIncapacitatedData {
  source: string
  attackerId: string
  weaponId: string | null
  wounds: number
}

export type AttackHookName = (typeof ATTACK_HOOKS)[number]

/** beforeShootTargetSelect: add or remove ids in `candidates` (for example Grot: not targetable in cover beyond 2"). */
export interface BeforeShootTargetSelectData {
  weaponId: string
  /** ids of operatives that passed the core target rules; mutate to add or remove */
  candidates: string[]
  /** true while enumerating Blast/Torrent secondaries (rules that bar selection do not stop Blast secondaries) */
  secondary: boolean
}

/** modifyAttackDice: change the attack pool of the operative (`operativeId`) before it rolls (shoot and fight, also queries). */
export interface ModifyAttackDiceData {
  kind: 'shoot' | 'fight'
  weaponId: string
  targetId: string
  /** attack dice collected (starts at the weapon Atk) */
  atk: number
  /** net Hit change: negative improves, positive worsens (injury, point-blank, assists are already included) */
  hitDelta: number
  /** extra Accurate x values; two or more instances combine into Accurate 2 (R-10.1) */
  accurate: number[]
  /** set to a number to give the pool Lethal x+ (lowest wins) */
  lethal: number | null
  /** extra re-roll grants (Ammo Cache and the like) */
  rerolls: RerollGrant[]
  /** fight: friendly operatives assisting; remove ids to deny the assist (Siege Specialist) */
  assists: string[]
}

/** modifyDefenceDice: change the defence pool of `operativeId` (the target) before it is rolled. */
export interface ModifyDefenceDiceData {
  kind: 'shoot'
  attackerId: string
  weaponId: string
  /** dice collected before Piercing */
  dice: number
  /** net Save change: negative improves */
  saveDelta: number
  /** extra re-roll grants for the defender */
  rerolls: RerollGrant[]
}

/** afterAttackRoll / afterDefenceRoll: dice are rolled and re-rolled but not yet retained. `dice` is live. */
export interface AfterRollData {
  kind: 'shoot' | 'fight'
  side: 'attack' | 'defence'
  targetId: string
  dice: AttackDie[]
  /** push { id, seat, labelKey, options } to ask a player something; the answer arrives in `choices[id]` */
  requests: ChoiceRequest[]
  choices: Record<string, string>
  /** M9 batch B shared: the shoot target is obscured in this sequence (read this, not state.attack, so the odds agree) */
  obscured?: boolean
  /**
   * M9 batch B shared: query.* is running the hook on hypothetical dice for the odds (no `engine`): convert dice only,
   * never touch state, ask nothing
   */
  query?: boolean
}

export interface ChoiceRequest {
  id: string
  seat: 'A' | 'B'
  labelKey: string
  options: { id: string; labelKey: string }[]
}

/** modifyWeaponRules: `rules` is a live copy of the weapon rules; add, remove or alter entries (R-10.25). */
export interface ModifyWeaponRulesData {
  kind: 'shoot' | 'fight'
  targetId?: string
  rules: WeaponRuleRef[]
}

/**
 * onDamageInflicted: lower or zero `amount` (Iron Halo, Just a Scratch); fires for every damage source.
 * Devastating damage (`source: 'devastating'`) is not damage from an attack die (R-5.15), so rules that reduce a
 * die's damage must leave it alone. `operativeId` is the operative taking the damage, `targetId` the attacker.
 */
export interface OnDamageInflictedData {
  /** normal | crit | devastating | hot | strike-normal | strike-crit | direct */
  source: string
  attackerId: string
  weaponId: string | null
  amount: number
  /**
   * M9 batch C: x" Devastating damage on an operative other than the target of the sequence (Void Armour, Blast
   * Padding, Diuturnal Mantles ignore it); absent otherwise
   */
  splash?: boolean
}

/** beforeStrike: a fight die is about to strike. Mutate `amount` or set `cancel` to waste the strike. */
export interface BeforeStrikeData {
  die: DieKind
  amount: number
  cancel: boolean
}

export interface OnFightResolvedData {
  attackerId: string
  defenderId: string
  /** true when the named fighter was incapacitated */
  attackerIncapacitated: boolean
  defenderIncapacitated: boolean
}

export interface AfterShootResolvedData {
  weaponId: string | null
  targets: string[]
  incapacitated: string[]
}

export interface HookRegistration {
  id: string
  fn: HookFn
}

const hookRegistry = new Map<string, HookRegistration[]>()

/** Register a handler for a hook point. Re-registering the same `id` replaces the earlier handler. */
export function registerHook(name: HookName | AttackHookName, fn: HookFn, id = `${name}#${(hookRegistry.get(name)?.length ?? 0) + 1}`): void {
  const list = hookRegistry.get(name) ?? []
  const at = list.findIndex((h) => h.id === id)
  if (at >= 0) list[at] = { id, fn }
  else list.push({ id, fn })
  hookRegistry.set(name, list)
}

export function unregisterHook(name: HookName | AttackHookName, id: string): void {
  const list = hookRegistry.get(name)
  if (!list) return
  hookRegistry.set(
    name,
    list.filter((h) => h.id !== id),
  )
}

export function clearHooks(name?: HookName | AttackHookName): void {
  if (name) hookRegistry.delete(name)
  else hookRegistry.clear()
}

export function hasHooks(name: HookName | AttackHookName): boolean {
  return (hookRegistry.get(name)?.length ?? 0) > 0
}

/** Run every handler for a hook point in registration order and collect their non-null results. */
export function runHook(name: HookName | AttackHookName, ctx: Omit<HookContext, 'hook'>): HookResult[] {
  const out: HookResult[] = []
  for (const h of hookRegistry.get(name) ?? []) {
    const r = h.fn({ ...ctx, hook: name })
    if (r) out.push(r)
  }
  return out
}

/**
 * Ploy windows (00-architecture section 4). The shoot/fight sequences call the opener at
 * `shoot.targetSelected`, `shoot.attackRolled`, `shoot.defenceRolled`, `shoot.resolved`,
 * `fight.weaponsSelected`, `fight.rolled` and `fight.resolved`. An opener may raise a `ploy.firefight`
 * decision with `ctx.raise` and return true; the attack then stays suspended until whoever owns that
 * decision calls `resumeAttack(ctx)` (attack-common.ts) once it is answered. Each window is offered at
 * most once per sequence.
 */
export type WindowOpener = (ctx: Ctx, window: TimingWindowId, info: { kind: 'shoot' | 'fight'; attackerId: string; targetId: string }) => boolean

let windowOpener: WindowOpener | null = null

export function registerWindowOpener(fn: WindowOpener | null): void {
  windowOpener = fn
}

export function getWindowOpener(): WindowOpener | null {
  return windowOpener
}

// ---------------------------------------------------------------------------
// M2b-game: activation frames (additive). Shoot, Fight, free Dashes and Guard interrupts run as a
// temporary activation (firefight.ts startFreeAction); `Activation.frame.resume` names the callback.
// ---------------------------------------------------------------------------

/** Called when a frame's action finishes or is cancelled (see Activation.frame.resume). */
export type FrameResume = (ctx: Ctx, outcome: 'finished' | 'cancelled', data: Record<string, unknown>) => void

const frameResumes = new Map<string, FrameResume>()

export function registerFrameResume(name: string, fn: FrameResume): void {
  frameResumes.set(name, fn)
}

export function getFrameResume(name: string): FrameResume | null {
  return frameResumes.get(name) ?? null
}

