// Shared helpers of the S4K-B skills (close combat passives and skill actions): finding a fighter's skill by the code hook
// name its data record carries, the actions skills grant, and the characteristic tests those skills ask for. Leaf module: it
// imports only types, state and dice helpers so fight.ts, activation.ts and movement.ts can use it without a cycle.
import { twoD6TestPasses, strengthTestPasses, d6TestPasses } from '../dice'
import { stat } from '../query'
import type { Ctx } from '../registry'
import type { Fighter, GameState, RuntimeAction, RuntimeSkill, StatKey } from '../types'

export interface SkillHit {
  skill: RuntimeSkill
  params: Record<string, unknown>
}

/** `{ code: { code, params } }` (or a list holding one) -> the code hook it names. */
function codeRef(effect: unknown): { code: string; params: Record<string, unknown> } | null {
  const list = Array.isArray(effect) ? effect : [effect]
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const c = (e as { code?: unknown }).code
    if (c && typeof c === 'object' && typeof (c as { code?: unknown }).code === 'string') {
      const ref = c as { code: string; params?: Record<string, unknown> }
      return { code: ref.code, params: ref.params ?? {} }
    }
  }
  return null
}

/** The skill of `f` whose data record is implemented by the code hook `code`, with its params; null when `f` lacks it. */
export function skillOf(state: GameState, f: Fighter, code: string): SkillHit | null {
  for (const id of f.skills) {
    const skill = state.data.skills[id]
    if (!skill) continue
    const ref = codeRef(skill.effect)
    if (ref && ref.code === code) return { skill, params: ref.params }
  }
  return null
}

export function hasSkill(state: GameState, f: Fighter, code: string): boolean {
  return skillOf(state, f, code) !== null
}

export function numParam(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// ---------------------------------------------------------------------------
// Actions granted by skills (skills.json `action`): they are not in core/actions.json
// ---------------------------------------------------------------------------

/**
 * Statuses a skill action is allowed from, where the printed record says less than the rule: Hurl may also target a
 * Seriously Injured enemy within 1" (who is never Engaged), so a Standing Active Hurler may use it too.
 */
const WIDER_STATUSES: Record<string, string[]> = { hurl: ['standingActive', 'standingEngaged'] }

/** The action a skill grants with this key (`headbutt`, `hurl`, `overseer`, `immovableStance`, `unleashTheBeast`, `somersault`). */
export function skillActionDef(state: GameState, key: string): RuntimeAction | undefined {
  for (const skill of Object.values(state.data.skills)) {
    const a = skill.action
    if (!a || a.id !== key) continue
    return { id: a.id, name: skill.name, type: a.type, statuses: WIDER_STATUSES[a.id] ?? a.statuses.slice(), ...(a.requires ? { requires: a.requires } : {}) }
  }
  return undefined
}

/** A core action or a skill action by key. */
export function actionDef(state: GameState, key: string): RuntimeAction | undefined {
  return state.data.actions[key] ?? skillActionDef(state, key)
}

// ---------------------------------------------------------------------------
// Characteristic tests (R-2.3 to R-2.5), rolled inside the step and reported as SkillTest
// ---------------------------------------------------------------------------

export interface TestResult {
  passed: boolean
  need: number
  total: number
}

/** Leadership / Willpower test: 2D6 + modifier >= characteristic (a total of 2 always fails). */
export function mentalTest(ctx: Ctx, f: Fighter, key: 'Ld' | 'Wil', reason: string, modifier = 0): TestResult {
  const need = stat(ctx.state, f.id, key as StatKey)
  const total = ctx.roll(reason, 1, '2d6')[0]!
  const passed = twoD6TestPasses(total, need, modifier)
  ctx.emit({ type: 'SkillTest', fighterId: f.id, test: key, dice: [total], need: need - modifier, passed, reason }, f.seat)
  return { passed, need, total }
}

/** Strength / Toughness test: a D6 at most the characteristic passes. */
export function strengthTest(ctx: Ctx, f: Fighter, key: 'S' | 'T', reason: string): TestResult {
  const need = stat(ctx.state, f.id, key as StatKey)
  const roll = ctx.roll(reason, 1)[0]!
  const passed = strengthTestPasses(roll, need)
  ctx.emit({ type: 'SkillTest', fighterId: f.id, test: key, dice: [roll], need, passed, reason }, f.seat)
  return { passed, need, total: roll }
}

/** Initiative test: a D6 of at least the characteristic (a 1 always fails). */
export function initiativeRoll(ctx: Ctx, f: Fighter, reason: string): TestResult {
  const need = stat(ctx.state, f.id, 'I')
  const roll = ctx.roll('initiative', 1)[0]!
  const passed = d6TestPasses(roll, need)
  ctx.emit({ type: 'InitiativeTest', fighterId: f.id, roll, need, passed, reason }, f.seat)
  return { passed, need, total: roll }
}
