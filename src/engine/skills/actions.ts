// Actions that skills grant (skills.json `action`): Headbutt (free), Hurl (Basic), Overseer (Double), Immovable Stance (Double),
// Unleash the Beast (Simple) and Somersault (Basic). activation.ts asks `skillMenu` for the options on top of the core actions and
// `handleSkillAction` for the closure that resolves one; the costs and the "once per activation" accounting are the core rules'
// (`economy`, `payAndContinue`), this file only knows what each skill does.
import { declareAction, economy, payAndContinue, type MenuOption, type Withheld } from '../activation'
import { addEffect } from '../effects'
import { markFired } from '../code-hooks'
import { twoD6TestChance } from '../dice'
import { resolveHit } from '../hits'
import { baseGap, CONTACT_EPS, refreshEngagement, withinPath } from '../measure'
import { pushApart } from '../movement'
import { stat } from '../query'
import { reject, type Ctx, type Handled } from '../registry'
import { friendsOf, getFighter } from '../state'
import type { ActionPayloadMap, Activation, Fighter, GameState } from '../types'
import { mentalTest, numParam, skillActionDef, skillOf, strengthTest } from './common'
import { hurlTargets, inBaseContact, pushAway, resolveHurl, unleashAvailable } from './hurl'
import { IMMOVABLE_EFFECT, isImmovable } from './stance'
import { raiseSomersault, somersaultRange } from './somersault'

type Choose = ActionPayloadMap['action.choose']

/** P(at least one of 2D6 reaches `toughness`) (Headbutt). */
export function headbuttChance(toughness: number): number {
  const one = toughness <= 1 ? 1 : toughness > 6 ? 0 : (7 - toughness) / 6
  return 1 - (1 - one) * (1 - one)
}

/** Enemies a Headbutt may hit: Engaged and in base contact. */
export function headbuttTargets(state: GameState, f: Fighter): Fighter[] {
  if (f.location !== 'board' || f.posture !== 'standing') return []
  return f.engagedWith.map((id) => state.fighters[id]).filter((e): e is Fighter => !!e && e.location === 'board' && baseGap(f, e) <= CONTACT_EPS)
}

/** Friends an Overseer may order: on the battlefield within the radius (path), not already part of the group in progress. */
export function overseerTargets(state: GameState, f: Fighter): Fighter[] {
  const hit = skillOf(state, f, 'overseer')
  if (!hit) return []
  const radius = numParam(hit.params, 'radius', 6)
  const group = state.action.group
  return friendsOf(state, f)
    .filter((g) => g.location === 'board' && withinPath(state, f, g, radius) && !(group && group.members.includes(g.id) && !group.done.includes(g.id)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** The skill-granted options of a fighter's action menu, with the reasons for those withheld. */
export function skillMenu(state: GameState, f: Fighter, act: Activation, st: string, blind: boolean): { options: MenuOption[]; withheld: Withheld[] } {
  const options: MenuOption[] = []
  const withheld: Withheld[] = []
  const seen = new Set<string>()
  for (const id of f.skills) {
    const key = state.data.skills[id]?.action?.id
    if (!key || seen.has(key)) continue
    seen.add(key)
    const def = skillActionDef(state, key)
    if (!def || !def.statuses.includes(st)) continue
    if (act.orderedBy && key === 'overseer') continue
    const verdict = economy(act, def)
    if (verdict !== 'ok') {
      withheld.push({ action: key, reason: verdict })
      continue
    }
    const before = options.length
    switch (key) {
      case 'headbutt':
        if (!blind)
          for (const t of headbuttTargets(state, f)) {
            const need = stat(state, t.id, 'T')
            options.push({ id: `headbutt:${t.id}`, payload: { action: 'headbutt', targetId: t.id }, data: { chance: headbuttChance(need), need } })
          }
        break
      case 'hurl':
        if (!blind)
          for (const h of hurlTargets(state, f)) options.push({ id: `hurl:${h.targetId}`, payload: { action: 'hurl', targetId: h.targetId }, data: { chance: h.chance, need: h.need } })
        break
      case 'overseer': {
        const need = stat(state, f.id, 'Ld')
        for (const g of overseerTargets(state, f)) options.push({ id: `overseer:${g.id}`, payload: { action: 'overseer', targetId: g.id }, data: { chance: twoD6TestChance(need), need, ready: g.ready } })
        break
      }
      case 'immovableStance':
        if (!isImmovable(state, f)) options.push({ id: 'immovableStance', payload: { action: 'immovableStance' }, data: { saveBonus: 2 } })
        break
      case 'unleashTheBeast':
        if (unleashAvailable(state, f)) options.push({ id: 'unleashTheBeast', payload: { action: 'unleashTheBeast' }, data: { targets: inBaseContact(state, f).length } })
        break
      case 'somersault':
        options.push({ id: 'somersault', payload: { action: 'somersault' }, data: { maxInches: somersaultRange(state, f) } })
        break
    }
    if (options.length === before) withheld.push({ action: key, reason: 'noTarget' })
  }
  return { options, withheld }
}

/** The closure that resolves a chosen skill action, or null when `p.action` is not one a skill grants. */
export function handleSkillAction(state: GameState, fighterId: string, p: Choose): Handled | null {
  if (!skillActionDef(state, p.action)) return null
  switch (p.action) {
    case 'headbutt':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fighterId)
          declareAction(ctx, f, 'headbutt', { targetId: p.targetId })
          headbutt(ctx, f, getFighter(ctx.state, p.targetId!))
          payAndContinue(ctx, f, 'headbutt')
        },
      }
    case 'hurl':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fighterId)
          declareAction(ctx, f, 'hurl', { targetId: p.targetId })
          if (resolveHurl(ctx, f, p.targetId!, false) === 'done') payAndContinue(ctx, f, 'hurl')
        },
      }
    case 'overseer':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fighterId)
          declareAction(ctx, f, 'overseer', { targetId: p.targetId })
          markFired('overseer')
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'overseer', targetId: p.targetId! }, f.seat)
          if (mentalTest(ctx, f, 'Ld', 'overseer').passed) ctx.state.action.order = { overseerId: f.id, targetId: p.targetId! }
          payAndContinue(ctx, f, 'overseer')
        },
      }
    case 'immovableStance':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fighterId)
          declareAction(ctx, f, 'immovableStance')
          addEffect(ctx, { source: 'immovableStance', seat: f.seat, kind: IMMOVABLE_EFFECT, fighterId: f.id, expires: `startOfActivation:${f.id}` })
          markFired('immovableStance')
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'immovableStance' }, f.seat)
          payAndContinue(ctx, f, 'immovableStance')
        },
      }
    case 'unleashTheBeast':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fighterId)
          declareAction(ctx, f, 'unleashTheBeast')
          unleash(ctx, f)
          payAndContinue(ctx, f, 'unleashTheBeast')
        },
      }
    case 'somersault':
      return {
        run(ctx) {
          const f = getFighter(ctx.state, fighterId)
          declareAction(ctx, f, 'somersault')
          raiseSomersault(ctx, f)
        },
      }
    default:
      return reject('E_TODO', `${p.action} is not implemented yet`)
  }
}

/** Headbutt: roll 2D6; if either die reaches the target's Toughness it takes a hit at Strength +2, Damage 2, else the Headbutter is hit. */
function headbutt(ctx: Ctx, f: Fighter, t: Fighter): void {
  const params = skillOf(ctx.state, f, 'headbutt')?.params ?? {}
  const dice = ctx.roll('headbutt', 2)
  const need = stat(ctx.state, t.id, 'T')
  const hit = Math.max(...dice) >= need
  markFired('headbutt')
  ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'headbutt', targetId: t.id, detail: hit ? 'hit' : 'fumble' }, f.seat)
  const S = stat(ctx.state, f.id, 'S')
  const base = {
    weaponId: null,
    ap: 0,
    traits: [],
    hitRoll: null,
    knockFrom: null,
    melta: false,
    saveVs: null,
    coverBonus: 0,
    from: null,
    saves: true,
    cause: 'headbutt',
  }
  if (hit) {
    resolveHit(ctx, { ...base, attackerId: f.id, targetId: t.id, strength: S + numParam(params, 'strengthBonus', 2), damage: { kind: 'fixed', value: numParam(params, 'damage', 2) } })
  } else {
    // both dice fell short: the Headbutter hurts itself (its own Strength, Damage 1)
    resolveHit(ctx, { ...base, attackerId: null, targetId: f.id, strength: S, damage: { kind: 'fixed', value: numParam(params, 'fumbleDamage', 1) } })
  }
  refreshEngagement(ctx)
}

/** Unleash the Beast: every fighter in base contact (friend or foe) passes a Strength test or is pushed D3" straight away. */
function unleash(ctx: Ctx, f: Fighter): void {
  markFired('unleashTheBeast')
  ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'unleashTheBeast' }, f.seat)
  const from = { x: f.pos.x, z: f.pos.z }
  // the order is the fighters' id order (the choice is automated, see the ruling)
  const inBaseContactBefore = inBaseContact(ctx.state, f)
  for (const e of inBaseContactBefore) {
    if (e.location !== 'board') continue
    if (isImmovable(ctx.state, e)) {
      markFired('immovableStance')
      continue
    }
    if (strengthTest(ctx, e, 'S', 'unleashTheBeast').passed) continue
    const distance = ctx.roll('unleashDistance', 1, 'd3')[0]!
    pushAway(ctx, e, from, distance)
    refreshEngagement(ctx)
  }
  // R-7.4: once every push is resolved, a pushed fighter left within 1" of an enemy is shifted clear
  for (const e of inBaseContactBefore) if (e.location === 'board') pushApart(ctx, e)
  refreshEngagement(ctx)
}

