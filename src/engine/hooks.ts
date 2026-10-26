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
] as const

/**
 * target.status (M2b-game): `operativeId` is the shooter, `targetId` the target. Handlers may set
 * `obscured` to false (OPTICS, Auspex: enemies cannot be obscured) or true (Smoke, M-5.5). The attack
 * code runs it from `targetInfo` after the terrain verdict, before the forced cover/obscured choice.
 */
export interface TargetStatusData {
  obscured: boolean
  inCover: boolean
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
] as const

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

