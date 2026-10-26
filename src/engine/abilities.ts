// ABL: ability.* - unique actions, mission actions and datacard / team rules. Data stays declarative;
// `{ code }` effects resolve through src/engine/code-hooks.ts. This module offers the actions as
// options of a firefight.action decision, performs them, and answers the questions firefight.ts asks
// about team rules (repeat actions, counteract, orders, cost changes).
import './core-hooks'
import './handlers'
import './teams/angels-of-death'
import './teams/kommandos'
import { activeTactics, codeOf, codeParams, effectList, evalCondition, hasKeyword, inEnemyCr, normAction, rulesOf } from './conditions'
import { getCodeHook, markFired } from './code-hooks'
import { cancelAction } from './firefight'
import { markerOffers, performMarkerAction, PICK_UP, PLACE } from './markers'
import { missionActionIds } from './missions'
import { reject, type Ctx, type Handled, type ModuleDef } from './registry'
import { EngineInvariantError, getOp } from './state'
import { initEquipment } from './equipment'
import type { Activation, Condition, GameSetup, GameState, Operative, Order, Rejection, RuntimeAbility, Seat } from './types'

// ---------------------------------------------------------------------------
// Rules firefight.ts asks about
// ---------------------------------------------------------------------------

/** How many times an action may be performed in one activation (R-3.7; ASTARTES, Krumpin' Time). */
export function maxRepeats(state: GameState, op: Operative, actionId: string, performed: string[]): number {
  if (actionId !== 'shoot' && actionId !== 'fight') return 1
  const count = (a: string) => performed.filter((p) => p === a).length
  const other = actionId === 'shoot' ? 'fight' : 'shoot'
  if (codeParams(state, op, 'krumpinTime') && actionId === 'fight') {
    if (count('fight') >= 1) markFired('krumpinTime')
    return 2
  }
  if (codeParams(state, op, 'astartes')) {
    // either two Shoot or two Fight (T-AOD.15): the second of one kind bars a second of the other
    if (count(other) >= 2) return 1
    if (actionId === 'shoot') {
      const bolt = op.weapons.some((w) => isBolt(state, w))
      if (!bolt) return 1
    }
    if (count(actionId) >= 1) markFired('astartes')
    return 2
  }
  return 1
}

/** A ranged weapon whose name contains "bolt" (T-AOD.6). */
export function isBolt(state: GameState, weaponId: string): boolean {
  const w = state.data.weapons[weaponId]
  return !!w && w.type === 'ranged' && w.name.toLowerCase().includes('bolt')
}

/** AP the second Shoot costs extra when it uses the same bolt sniper rifle or heavy bolter (T-AOD.15); for weapon selection. */
export function repeatSurcharge(state: GameState, op: Operative, act: Activation | null, weaponId: string): number {
  const p = codeParams(state, op, 'astartes')
  if (!p || !act) return 0
  const names = ((p.repeatSurcharge as { nameContains?: string[] } | undefined)?.nameContains ?? []).map((s) => s.toLowerCase())
  const w = state.data.weapons[weaponId]
  if (!w || !names.some((n) => w.name.toLowerCase().includes(n))) return 0
  const prior = (act.weaponsUsed ?? []).includes(weaponId)
  if (!prior) return 0
  markFired('astartes')
  return (p.repeatSurcharge as { ap?: number }).ap ?? 1
}

/** May the operative counteract (R-3.11): Engage, or any order for ASTARTES; never the Grot (Sneaky Zogger). */
export function canCounteractWithOrder(state: GameState, op: Operative): boolean {
  if (codeParams(state, op, 'sneakyZogger')) return false
  if (op.order === 'engage') return true
  const p = codeParams(state, op, 'astartes')
  if (p?.counteractAnyOrder) {
    markFired('astartes')
    return true
  }
  return false
}

/** Orders an operative may choose (Stoopid: never Conceal; Sneaky Zogger: never Engage). */
export function allowedOrders(state: GameState, op: Operative): Order[] {
  if (codeParams(state, op, 'stoopid')?.noConceal) return ['engage']
  if (codeParams(state, op, 'sneakyZogger')?.neverEngage) {
    markFired('sneakyZogger')
    return ['conceal']
  }
  return ['engage', 'conceal']
}

/** THROAT SLITTAS: the operative may Charge under Conceal and keeps the order (T-KOM.19). */
export function chargeUnderConceal(state: GameState, op: Operative): boolean {
  const p = codeParams(state, op, 'throatSlittas')
  if (!p?.chargeWhileConceal) return false
  markFired('throatSlittas')
  return true
}

/** Mobile: the operative may Charge from inside an enemy control range (T-AOD.16). */
export function chargeFromControlRange(state: GameState, op: Operative): boolean {
  if (codeParams(state, op, 'ctMobileCharge') === null) return false
  markFired('ctMobileCharge')
  return true
}

/** Stoopid: a universal or unique action the operative can never take (T-KOM.9). */
export function actionForbidden(state: GameState, op: Operative, actionId: string): string | null {
  const p = codeParams(state, op, 'stoopid')
  if (!p) return null
  const allowed = (p.allowedActions as string[] | undefined) ?? []
  if (allowed.map(normAction).includes(actionId)) return null
  markFired('stoopid')
  return `${op.name} is Stoopid and cannot take ${actionId}`
}

/** Net AP change to an action from declarative costDelta effects (Mobile: Fall Back -1). */
export function actionCostDelta(state: GameState, op: Operative, key: string, act: Activation | null, mission = false): number {
  let delta = 0
  for (const d of rulesOf(state, op)) {
    for (const e of effectList(d.effect)) {
      const cd = e.costDelta
      if (!cd) continue
      const names = cd.actions.map(normAction)
      const hit = names.includes(key) || (mission && names.includes('mission-action'))
      if (!hit) continue
      if (d.limit === 'oncePerActivation') {
        if (act?.used?.includes(d.id)) continue
        // the discount is consumed when the action is declared (firefight.ts marks it used)
      }
      delta += cd.delta
    }
  }
  return delta
}

/** Mark once-per-activation cost discounts as used for the key just declared. */
export function consumeDiscounts(state: GameState, op: Operative, act: Activation, key: string, mission = false): void {
  for (const d of rulesOf(state, op)) {
    if (d.limit !== 'oncePerActivation') continue
    for (const e of effectList(d.effect)) {
      const cd = e.costDelta
      if (!cd) continue
      const names = cd.actions.map(normAction)
      if (names.includes(key) || (mission && names.includes('mission-action'))) {
        act.used = [...(act.used ?? []), d.id]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Unique, mission and equipment actions as firefight.action options
// ---------------------------------------------------------------------------

export interface AbilityOffer {
  /** option id */
  id: string
  /** payload.action: `ability:<abilityId>`, `marker:pickUp` or `marker:place` */
  action: string
  abilityId: string
  cost: number
  params: Record<string, unknown>
  labelKey: string
  data?: Record<string, unknown>
}

export const ABILITY_PREFIX = 'ability:'

/** Ability ids whose actions an operative could take: its card, the mission's, and its equipment's. */
export function actionAbilityIds(state: GameState, op: Operative): string[] {
  const ids: string[] = []
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id)
  }
  for (const id of state.data.datacards[op.datacardId]?.uniqueActions ?? []) add(id)
  for (const id of missionActionIds(state)) add(id)
  for (const eqId of state.players[op.seat].equipment) {
    for (const a of state.data.equipment?.[eqId]?.actions ?? []) add(a)
  }
  // Taktical Wot-notz lets a Boy throw smoke and stun grenades without the team's picks (T-KOM.11)
  if (state.data.datacards[op.datacardId]?.abilities.includes('kom.a.taktical-wot-notz')) {
    add('core.a.smoke-grenade')
    add('core.a.stun-grenade')
  }
  for (const pick of Object.values(state.equipment.picks[op.seat] ?? {})) {
    for (const a of pick) if (state.data.abilities[a]?.kind === 'uniqueAction') add(a)
  }
  return ids
}

function offerCost(state: GameState, op: Operative, def: RuntimeAbility, seed: { cost?: number }, act: Activation | null): number {
  const base = seed.cost ?? def.ap ?? 1
  const mission = (def.keywords ?? []).includes('MISSION')
  const delta = actionCostDelta(state, op, def.id, act, mission)
  return Math.max(0, base + delta)
}

/** Why the generic conditions of a unique action fail, or null. */
function genericProblem(state: GameState, op: Operative, def: RuntimeAbility, act: Activation | null): string | null {
  const cond = def.conditions as Condition | undefined
  if (cond && !evalCondition(cond, { state, seat: op.seat, subjectId: op.id, actorId: op.id, activation: act, counteracting: act?.counteract })) {
    return `conditions of ${def.name} are not met`
  }
  if (act && !act.counteract && act.performed.includes(`${ABILITY_PREFIX}${def.id}`)) return `${def.name} cannot be performed twice in one activation`
  const stoop = actionForbidden(state, op, `${ABILITY_PREFIX}${def.id}`)
  if (stoop) return stoop
  return null
}

export function abilityOffers(state: GameState, op: Operative, act: Activation | null): AbilityOffer[] {
  const out: AbilityOffer[] = []
  for (const id of actionAbilityIds(state, op)) {
    const def = state.data.abilities[id]
    if (!def || def.kind !== 'uniqueAction') continue
    if (genericProblem(state, op, def, act)) continue
    const hook = codeOf(def) ? getCodeHook(codeOf(def)!) : undefined
    if (!hook?.action) continue
    for (const seed of hook.action.offers(state, op, def, act)) {
      const cost = offerCost(state, op, def, seed, act)
      if (act) {
        if (act.counteract && cost !== 1) continue
        if (!act.counteract && !act.frame) {
          const apl = op.apl + (op.flags.ignoreApl ? 0 : Math.max(-1, Math.min(1, op.aplMods)))
          if (act.apSpent + cost > Math.max(0, apl)) continue
        }
      }
      out.push({
        id: `${ABILITY_PREFIX}${def.id}${seed.key ? `:${seed.key}` : ''}`,
        action: `${ABILITY_PREFIX}${def.id}`,
        abilityId: def.id,
        cost,
        params: seed.params,
        labelKey: `ability.${def.id}`,
        ...(seed.data ? { data: seed.data } : {}),
      })
    }
  }
  for (const m of markerOffers(state, op, act)) {
    const delta = actionCostDelta(state, op, m.action === PICK_UP ? 'pick-up-marker' : 'place-marker', act)
    const cost = Math.max(0, m.cost + delta)
    if (act && !act.counteract && !act.frame) {
      const apl = op.apl + (op.flags.ignoreApl ? 0 : Math.max(-1, Math.min(1, op.aplMods)))
      if (act.apSpent + cost > Math.max(0, apl)) continue
    }
    if (act?.counteract && cost !== 1) continue
    out.push({ id: m.id, action: m.action, abilityId: m.action, cost, params: { markerId: m.markerId }, labelKey: m.action === PICK_UP ? 'action.pickUpMarker' : 'action.placeMarker' })
  }
  return out
}

/** The offer a firefight.action payload names, or a rejection explaining why it is unavailable. */
export function findOffer(
  state: GameState,
  op: Operative,
  act: Activation | null,
  payload: { action: string; markerId?: string; targetId?: string; param?: string; x?: number; z?: number },
): AbilityOffer | Rejection {
  const offers = abilityOffers(state, op, act).filter((o) => o.action === payload.action)
  const match = offers.find((o) =>
    (['markerId', 'targetId', 'param', 'x', 'z'] as const).every((k) => payload[k] === undefined || o.params[k] === payload[k]),
  )
  if (match) return match
  if (payload.action.startsWith(ABILITY_PREFIX)) {
    const def = state.data.abilities[payload.action.slice(ABILITY_PREFIX.length)]
    if (!def || !actionAbilityIds(state, op).includes(def.id)) return { code: 'E_NOT_AN_OPTION', reason: `${payload.action} is not an action of ${op.name}` }
    const problem = genericProblem(state, op, def, act)
    if (problem) return { code: 'E_ACTION_RESTRICTED', reason: problem }
    return { code: 'E_ACTION_RESTRICTED', reason: `${def.name} has no legal use right now` }
  }
  return { code: 'E_ACTION_RESTRICTED', reason: `${payload.action} has no legal use right now` }
}

/** Declare-time work of an offer: run the hook's action or the marker flow. */
export function performOffer(ctx: Ctx, op: Operative, offer: AbilityOffer): void {
  if (offer.action === PICK_UP || offer.action === PLACE) {
    performMarkerAction(ctx, op, offer.action, offer.params.markerId as string)
    return
  }
  const def = ctx.state.data.abilities[offer.abilityId]!
  const hook = getCodeHook(codeOf(def)!)
  if (!hook?.action) {
    cancelAction(ctx)
    return
  }
  hook.action.perform(ctx, op, def, offer.params)
}

// ---------------------------------------------------------------------------
// ability.choice
// ---------------------------------------------------------------------------

function handleChoice(state: GameState, action: { type: string; payload?: unknown }, context: Record<string, unknown>): Handled {
  const hookName = context.hook as string | undefined
  const hook = hookName ? getCodeHook(hookName) : undefined
  if (action.type === 'pass') return { run: (ctx) => cancelAction(ctx) }
  if (action.type !== 'ability.choice' || !hook?.choice) return reject('E_WRONG_DECISION', 'expected a choice')
  const opId = context.operativeId as string | undefined
  if (!opId || !state.operatives[opId]) return reject('E_WRONG_DECISION', 'the chooser is gone')
  const option = (action.payload as { option: string }).option
  return {
    run(ctx) {
      hook.choice!(ctx, getOp(ctx.state, opId), option, context)
    },
  }
}

export const abilitiesModule: ModuleDef = {
  id: 'abilities',
  namespaces: ['ability'],
  handle(state, action, pending) {
    return handleChoice(state, action, pending.context)
  },
}

export { codeOf, codeParams, effectList, hasKeyword, inEnemyCr, rulesOf, activeTactics }
export type { Seat }

// ---------------------------------------------------------------------------
// Team state at game creation, and flags derived from tactics and effects
// ---------------------------------------------------------------------------

/** Recompute ignoreApl (Resolute, Shake It Off) and ignoreInjured (And They Shall Know No Fear) from tactics and effects. */
export function refreshFlags(state: GameState): void {
  for (const op of Object.values(state.operatives)) {
    const resolute = activeTactics(state, op).includes('aod.a.ct-resolute')
    const shake = state.effects.some((e) => e.source === 'kom.p.shake-it-off' && e.operativeId === op.id)
    const ignoreApl = resolute || shake
    if (ignoreApl) {
      op.flags.ignoreApl = true
      if (resolute) markFired('ctResolute')
    } else delete op.flags.ignoreApl
    const atsknf =
      hasKeyword(state, op, 'ANGEL OF DEATH') && state.effects.some((e) => e.source === 'aod.p.and-they-shall-know-no-fear' && e.seat === op.seat)
    if (atsknf) op.flags.ignoreInjured = true
    else delete op.flags.ignoreInjured
  }
}

function tacticAbilities(state: GameState, group: string): string[] {
  return Object.values(state.data.abilities)
    .filter((a) => a.choiceGroup === group)
    .map((a) => a.id)
}

/** Team picks (Chapter Tactics), Chapter Veteran, equipment, then the flags the picks imply. */
export function initTeamState(ctx: Ctx, setup: GameSetup): void {
  const s = ctx.state
  for (const seat of ['A', 'B'] as const) {
    const team = s.data.teams[s.players[seat].teamId]
    const cfg = s.config[seat]
    const asked = setup.teamChoices?.[seat] ?? {}
    for (const tc of team?.teamChoices ?? []) {
      const pool = tacticAbilities(s, tc.group)
      const taken = new Set(Object.values(cfg.choices))
      const pick = asked[tc.id] ?? pool.find((id) => !taken.has(id))
      if (!pick) throw new EngineInvariantError(`invalid setup: no choice for ${tc.id}`)
      if (!pool.includes(pick)) throw new EngineInvariantError(`invalid setup: ${pick} is not a ${tc.group}`)
      for (const other of tc.distinctFrom ?? []) {
        if (cfg.choices[other] === pick) throw new EngineInvariantError(`invalid setup: ${tc.label} must differ from the ${other} pick`)
      }
      cfg.choices[tc.id] = pick
    }
    setup.rosters[seat].forEach((entry, i) => {
      if (!entry.chapterVeteran) return
      const op = s.operatives[`${seat}${i + 1}`]!
      if (!tacticAbilities(s, 'chapter-tactic').includes(entry.chapterVeteran)) {
        throw new EngineInvariantError(`invalid setup: ${entry.chapterVeteran} is not a Chapter Tactic`)
      }
      if (!s.data.datacards[op.datacardId]?.abilities.includes('aod.a.chapter-veteran')) {
        throw new EngineInvariantError(`invalid setup: ${op.name} has no Chapter Veteran pick`)
      }
      op.extraTactics = [entry.chapterVeteran]
    })
  }
  initEquipment(s, setup)
  // setup hooks of code hooks named by a team's rules (Chapter Veteran defaults)
  for (const seat of ['A', 'B'] as const) {
    const seen = new Set<string>()
    for (const op of Object.values(s.operatives)) {
      if (op.seat !== seat) continue
      for (const id of s.data.datacards[op.datacardId]?.abilities ?? []) {
        const def = s.data.abilities[id]
        const code = def ? codeOf(def) : undefined
        if (!code || seen.has(code)) continue
        seen.add(code)
        getCodeHook(code)?.setup?.(ctx, seat, id)
      }
    }
  }
  refreshFlags(s)
}
