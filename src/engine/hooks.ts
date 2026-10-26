// Hook names, contexts and results (frozen after M2). The registry lets rules modules (traits.ts, wargear.ts, skills.ts,
// gangs/*) attach handlers to named points; the engine calls `runHook` where the rule says (docs/spec/00-architecture.md
// section 4 names the timing windows, this file the code hook points).
import type { Ctx } from './registry'
import type { GameState, Seat, TimingWindowId } from './types'

export const HOOK_NAMES = [
  'stat.modify',
  'test.modify',
  'action.available',
  'action.type',
  'shoot.targets',
  'shoot.hitMods',
  'fight.hitMods',
  'fight.attackDice',
  'weapon.traits',
  'wound.mods',
  'save.mods',
  'damage.mods',
  'injury.dice',
  'injury.applied',
  'pin.allowed',
  'nerve.mods',
  'move.limit',
  'fighter.downed',
  'activation.start',
  'activation.end',
  'round.start',
  'round.end',
  'phase.end',
] as const

export type HookName = (typeof HOOK_NAMES)[number]

/*
 * Conventions (carried over from the Murder Squad contract):
 *  - A handler receives a HookContext whose `data` is the LIVE object for that hook point: it mutates it in place and
 *    may also return a HookResult (ignored unless the hook point says otherwise).
 *  - `state` is the current state (a draft while a step runs, so handlers only mutate `data`, or `engine` when present).
 *  - Lifecycle hook points (activation.*, round.*, phase.end, fighter.downed) run with `engine` and must not raise
 *    decisions; a rule that needs a choice asks through `skill.choice` at the next decision point.
 *  - Handlers must be idempotent: the engine may re-run a hook after a decision it requested was answered.
 *  - `fighterId` is the subject of the hook (the shooter, the fighter taking the test or the wound); `targetId` is its
 *    opponent in the sequence.
 */

export interface HookContext {
  hook: HookName
  seat: Seat
  /** the state the hook runs against */
  state?: GameState
  /** the step context when running inside a step (absent for queries and validation) */
  engine?: Ctx
  fighterId?: string
  targetId?: string
  weaponId?: string
  action?: string
  data?: Record<string, unknown>
}

export interface HookResult {
  /** numeric delta applied to the stat, test or cost named by the hook */
  delta?: number
  /** set when a rule forbids or allows the thing being asked about */
  allow?: boolean
  reason?: string
  data?: Record<string, unknown>
}

export type HookFn = (ctx: HookContext) => HookResult | null

export interface HookRegistration {
  id: string
  fn: HookFn
}

const hookRegistry = new Map<string, HookRegistration[]>()

/** Register a handler for a hook point. Re-registering the same `id` replaces the earlier handler. */
export function registerHook(name: HookName, fn: HookFn, id = `${name}#${(hookRegistry.get(name)?.length ?? 0) + 1}`): void {
  const list = hookRegistry.get(name) ?? []
  const at = list.findIndex((h) => h.id === id)
  if (at >= 0) list[at] = { id, fn }
  else list.push({ id, fn })
  hookRegistry.set(name, list)
}

export function unregisterHook(name: HookName, id: string): void {
  const list = hookRegistry.get(name)
  if (!list) return
  hookRegistry.set(
    name,
    list.filter((h) => h.id !== id),
  )
}

export function clearHooks(name?: HookName): void {
  if (name) hookRegistry.delete(name)
  else hookRegistry.clear()
}

export function hasHooks(name: HookName): boolean {
  return (hookRegistry.get(name)?.length ?? 0) > 0
}

/** Run every handler for a hook point in registration order and collect their non-null results. */
export function runHook(name: HookName, ctx: Omit<HookContext, 'hook'>): HookResult[] {
  const out: HookResult[] = []
  for (const h of hookRegistry.get(name) ?? []) {
    const r = h.fn({ ...ctx, hook: name })
    if (r) out.push(r)
  }
  return out
}

/**
 * Timing windows (00-architecture section 4). A sequence calls the opener at each window it passes; the opener may raise
 * a decision with `ctx.raise` (a `skill.choice` or `dice.reroll`) and return true, and the sequence then stays
 * suspended until whoever owns that decision resumes it. Each window is offered at most once per sequence.
 */
export type WindowOpener = (
  ctx: Ctx,
  window: TimingWindowId,
  info: { kind: 'shoot' | 'fight' | 'hit' | 'other'; fighterId: string; targetId?: string },
) => boolean

let windowOpener: WindowOpener | null = null

export function registerWindowOpener(fn: WindowOpener | null): void {
  windowOpener = fn
}

export function getWindowOpener(): WindowOpener | null {
  return windowOpener
}

// ---------------------------------------------------------------------------
// Frames: Shoot, Fight and free actions run as a temporary activation; the frame names a resume callback.
// ---------------------------------------------------------------------------

/** Called when a frame's action finishes or is cancelled. */
export type FrameResume = (ctx: Ctx, outcome: 'finished' | 'cancelled', data: Record<string, unknown>) => void

const frameResumes = new Map<string, FrameResume>()

export function registerFrameResume(name: string, fn: FrameResume): void {
  frameResumes.set(name, fn)
}

export function getFrameResume(name: string): FrameResume | null {
  return frameResumes.get(name) ?? null
}
