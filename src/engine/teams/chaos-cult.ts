// Chaos Cult (docs/spec/13-teams.md section 20, rule ids T-CC.n): the code hooks this team's data names, its team rule
// provider (team-rules.ts registerTeamRules), its hook handlers (hooks.ts registerHook) and its ploy rules
// (ploy-rules.ts registerPloyRule).
//
// Map of the rules to the code below:
//  - MUTATION (T-CC.19-21): the free gambit `cc.p.mutation` raises a loop of ability.choice decisions (hook ccMutation,
//    mode gambit); a Devotee's kill makes a "mutation right" (hook damage.inflicted) that the reaction round
//    after the action offers (providers ownReactions / reactions, same hook, `reaction` context). Both end in
//    performMutation: transformOperative (transform.ts) for Mutant and Torment, regainWounds for the third option.
//  - ACCURSED GIFTS (T-CC.22-28): the team ledger is plain keys in the seat's battle ledger (`cc.gift:...`), read through
//    giftsOf. Chitinous writes `op.save` after every transform and gift change (gap saveDelta). Deformed Wings and Fleet
//    are providers, Horned a 0 CP offer in the firefight.chargeMoved window, Sinewed and Barbed attack hooks.
//  - Mutant and Torment restrictions (T-CC.15-18): providers actionForbidden, actionCostDelta, weaponForbidden, and the
//    Brute hook beforeShootTargetSelect. Unnatural Regeneration and Vile Blessing share one onDamageInflicted handler.
//  - DARK COMMUNE rules: Incite (delegated free actions), Cut Them Down (action.declared), Attuned In Purpose (a 0 CP offer
//    at the activation start that calls joinActivation), Icon Bearer (controlApl), Ruinous Icon (a token on the Iconarch
//    read by modifyDamage), Heinous Deluge, Malefic Vortex (a team marker and a turningPoint.start hook).
//  - Ploys and equipment: strategy flag ploys are turning point effects read by the attack hooks; the firefight ploys and
//    equipment are code hooks and ploy rules named in the Engine map of the spec section.
import { hasRule, redirectAttack, ruleKey, ruleSetFor, targetInfo, type RuleSet } from '../attack-common'
import { allowedOrders } from '../abilities'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { commsBonus } from '../core-hooks'
import { hasKeyword } from '../conditions'
import { addEffect, addTpUse, addUse, aplChangeNextActivation, directDamage, markUsedBattle, markUsedTp, regainWounds, removeEffects, tpUsesOf, usedThisBattle, usedThisTp, usesOf } from '../effects'
import { canStartFreeAction, cancelAction, finishAction, joinActivation, reactionDone, startDelegatedAction, startFreeAction } from '../firefight'
import { distToPolygon, pointInPolygon } from '../geometry'
import { registerFrameResume, registerHook, type ActionDeclaredData, type DamageInflictedData } from '../hooks'
import { bodyOf, visible, type Body } from '../los'
import { newMarkerId, removeMarker } from '../markers'
import { distanceBetween, enemiesInControlRange, inControlRange, markerBody } from '../measure'
import { registerPloyRule, type PloyOffer } from '../ploy-rules'
import { psychicAllowed, psychicSelectable } from '../psychic'
import type { Ctx } from '../registry'
import { placementSpots } from '../reserve'
import { activeOps, enemiesOf, hasInjuredPenalty, otherSeat, readyOps } from '../state'
import { resumeGambit } from '../strategy'
import { providerAny, registerTeamRules, type ReactionOffer } from '../team-rules'
import { placementProblem, terrainOf } from '../terrain'
import { holdersOf, moveTokenTo } from '../tokens'
import { transformOperative } from '../transform'
import type { Activation, GameState, Operative, RollTarget, Seat, Vec2, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'chaos-cult'

const EPS = 1e-6

/** Datacard ids. */
export const CARD = {
  demagogue: 'cc.demagogue',
  blade: 'cc.blessed-blade',
  iconarch: 'cc.iconarch',
  mindwitch: 'cc.mindwitch',
  devotee: 'cc.devotee',
  mutant: 'cc.mutant',
  torment: 'cc.torment',
} as const

const A = (id: string) => `cc.a.${id}`
const P = (id: string) => `cc.p.${id}`
const E = (id: string) => `cc.e.${id}`
const W = (id: string) => `cc.w.${id}`

export const AB = {
  attuned: A('attuned-in-purpose'),
  horned: A('gift-horned'),
  inciteSlaughter: A('incite-slaughter'),
  inciteUrgency: A('incite-urgency'),
  ruinousIcon: A('ruinous-icon'),
  heinousDeluge: A('heinous-deluge'),
  maleficVortex: A('malefic-vortex'),
}
export const PL = {
  mutation: P('mutation'),
  exaltation: P('exaltation-in-pain'),
  fervent: P('fervent-onslaught'),
  creatures: P('creatures-of-nightmare'),
  sickening: P('sickening-aura'),
  follower: P('faithful-follower'),
  abhorrent: P('abhorrent-mutation'),
  demise: P('frenzied-demise'),
  unleash: P('unleash-the-daemon'),
  baleful: P('baleful-script'),
  guises: P('covert-guises'),
}
export const EQ = {
  baleful: E('baleful-script'),
  guises: E('covert-guises'),
  talisman: E('unholy-talisman'),
  vile: E('vile-blessing'),
}
const GAZE = W('infernal-gaze')

// tokens, markers and effect sources
const T_ICON = 'cc.ruinousIcon'
const VORTEX = 'cc.maleficVortex'
const FX_RIGHT = 'cc.mutRight'
const FX_VORTEX = 'cc.vortex'
const FX_UNLEASH = 'cc.unleash'
const FX_BARBED = 'cc.barbedFirst'
const FX_HORNED = 'cc.hornedUsed'
const FX_GUISE = 'cc.guiseMove'
const FX_GUISE_ROLL = 'cc.guises'

// Passive rules register their name so the data may reference them; the handlers below mark them fired when they
// actually apply in a game.
for (const name of ['ccUnholyTalisman', 'ccVileBlessing']) registerCodeHook({ name })

// ---------------------------------------------------------------------------
// Accursed gifts: the team ledger (keys in the seat's battle ledger)
// ---------------------------------------------------------------------------

export type Gift = 'deformed-wings' | 'fleet' | 'chitinous' | 'horned' | 'sinewed' | 'barbed'
/** The AI takes gifts in this order (RULING: fixed preference, reproducible simulations). */
export const GIFTS: Gift[] = ['chitinous', 'fleet', 'sinewed', 'horned', 'barbed', 'deformed-wings']
export const GIFT_NAME: Record<Gift, string> = {
  'deformed-wings': 'Deformed Wings',
  fleet: 'Fleet',
  chitinous: 'Chitinous',
  horned: 'Horned',
  sinewed: 'Sinewed',
  barbed: 'Barbed',
}
const KP = { primary: 'cc.gift:primary:', secondary: 'cc.gift:secondary:', sel: 'cc.gift:sel:' }
const KOP = (opId: string) => `cc.gift:op:${opId}:`

function ledgerValue(state: GameState, seat: Seat, prefix: string): Gift | undefined {
  const k = state.ledger[seat].battle.find((x) => x.startsWith(prefix))
  return k ? (k.slice(prefix.length) as Gift) : undefined
}

export const primaryGift = (state: GameState, seat: Seat): Gift | undefined => ledgerValue(state, seat, KP.primary)
export const secondaryGift = (state: GameState, seat: Seat): Gift | undefined => ledgerValue(state, seat, KP.secondary)
export const opGifts = (state: GameState, op: Operative): Gift[] =>
  state.ledger[op.seat].battle.filter((x) => x.startsWith(KOP(op.id))).map((x) => x.slice(KOP(op.id).length) as Gift)
/** Every gift selected in the battle by any rule, replaced ones included. */
export const selectedGifts = (state: GameState, seat: Seat): Gift[] =>
  state.ledger[seat].battle.filter((x) => x.startsWith(KP.sel)).map((x) => x.slice(KP.sel.length) as Gift)
export const availableGifts = (state: GameState, seat: Seat): Gift[] => {
  const taken = selectedGifts(state, seat)
  return GIFTS.filter((g) => !taken.includes(g))
}

export function isCc(op: Operative | undefined): boolean {
  return !!op && op.datacardId.startsWith('cc.')
}
const isCard = (op: Operative | undefined, card: string): boolean => !!op && op.datacardId === card
export const isDevotee = (op: Operative | undefined): boolean => isCard(op, CARD.devotee)
export const isMutant = (op: Operative | undefined): boolean => isCard(op, CARD.mutant)
export const isTorment = (op: Operative | undefined): boolean => isCard(op, CARD.torment)
const isBlade = (op: Operative | undefined): boolean => isCard(op, CARD.blade)
const isIconarch = (op: Operative | undefined): boolean => isCard(op, CARD.iconarch)
const isMutated = (op: Operative | undefined): boolean => isMutant(op) || isTorment(op)

/** The gifts an operative has now: its form's team gifts plus its own (Abhorrent Mutation). */
export function giftsOf(state: GameState, op: Operative): Gift[] {
  if (!isCc(op)) return []
  const out: Gift[] = []
  if (isMutant(op) || isTorment(op)) {
    const p = primaryGift(state, op.seat)
    if (p) out.push(p)
  }
  if (isTorment(op)) {
    const s = secondaryGift(state, op.seat)
    if (s) out.push(s)
  }
  for (const g of opGifts(state, op)) if (!out.includes(g)) out.push(g)
  return out
}
const hasGift = (state: GameState, op: Operative, g: Gift): boolean => isCc(op) && giftsOf(state, op).includes(g)

function addSelected(state: GameState, seat: Seat, g: Gift): void {
  const key = KP.sel + g
  if (!state.ledger[seat].battle.includes(key)) state.ledger[seat].battle.push(key)
}

type Slot = 'primary' | 'secondary' | `op:${string}`

/** Record a gift in a slot (team primary, team secondary, or one operative's own). */
export function setGift(state: GameState, seat: Seat, slot: Slot, gift: Gift): void {
  const b = state.ledger[seat].battle
  if (slot === 'primary' || slot === 'secondary') {
    const prefix = slot === 'primary' ? KP.primary : KP.secondary
    for (let i = b.length - 1; i >= 0; i--) if (b[i]!.startsWith(prefix)) b.splice(i, 1)
    b.push(prefix + gift)
  } else {
    b.push(`cc.gift:${slot}:${gift}`)
  }
  addSelected(state, seat, gift)
}

/** Baleful Script: the gift in `slot` (an operative slot names the old gift: `op:<id>:<gift>`) becomes `gift`. */
function replaceGift(state: GameState, seat: Seat, slot: string, gift: Gift): void {
  const b = state.ledger[seat].battle
  if (slot === 'primary' || slot === 'secondary') {
    setGift(state, seat, slot, gift)
    return
  }
  const key = `cc.gift:${slot}`
  const i = b.indexOf(key)
  if (i >= 0) b.splice(i, 1)
  const opId = slot.split(':')[1]!
  b.push(`${KOP(opId)}${gift}`)
  addSelected(state, seat, gift)
}

/** Chitinous: Save one better than the datacard's (writes `op.save`; transformOperative resets it from the card). */
export function syncSave(state: GameState, op: Operative): void {
  const card = state.data.datacards[op.datacardId]
  if (!card || !isCc(op)) return
  op.save = (hasGift(state, op, 'chitinous') ? Math.max(2, card.save - 1) : card.save) as RollTarget
}
function syncTeamSaves(state: GameState, seat: Seat): void {
  for (const o of Object.values(state.operatives)) if (o.seat === seat && isCc(o)) syncSave(state, o)
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

function live(o: Operative | undefined): o is Operative {
  return !!o && o.status === 'active' && o.wounds > 0
}

function ccOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && isCc(o))
}

function equipped(state: GameState, seat: Seat, id: string): boolean {
  return state.players[seat].equipment.includes(id)
}

/** A strategy ploy of the seat that is in force this turning point. */
export function ployActive(state: GameState, seat: Seat, ployId: string): boolean {
  return state.effects.some((e) => e.source === ployId && e.seat === seat)
}

const gap = (a: Operative, b: Operative): number => distanceBetween(bodyOf(a), bodyOf(b))
const within = (a: Operative, b: Operative, inches: number): boolean => gap(a, b) <= inches + EPS
const sees = (state: GameState, a: Operative, b: Operative): boolean => a.id === b.id || visible(state, bodyOf(a), bodyOf(b))

/** The activation an action belongs to: the frame's owner activation for a free action. */
function baseActivation(state: GameState): Activation | null {
  const act = state.firefight.activation
  if (!act) return null
  return act.frame ? ((state.firefight.stack ?? []).at(-1) ?? null) : act
}

function d3(ctx: Ctx, purpose: string): number {
  const [r] = ctx.roll(purpose, 1)
  return Math.ceil(r! / 2)
}

function used(ctx: Ctx, op: Operative | null, abilityId: string, detail?: string): void {
  ctx.emit({ type: 'AbilityUsed', operativeId: op?.id ?? null, abilityId, ...(detail ? { detail } : {}) }, op?.seat)
}

/** A friendly Mutant or Torment of `seat` within 2" of `target`. */
function nearMutated(state: GameState, seat: Seat, target: Operative): boolean {
  return ccOps(state, seat).some((m) => isMutated(m) && m.id !== target.id && within(m, target, 2))
}

const isHatch = (abilityId: string): boolean => /hatch/i.test(abilityId)

function missionAbility(state: GameState, actionId: string): string | null {
  if (!actionId.startsWith('ability:')) return null
  const id = actionId.slice('ability:'.length)
  const def = state.data.abilities[id]
  return def && (def.keywords ?? []).includes('MISSION') ? id : null
}

// ---------------------------------------------------------------------------
// Mutation: options, caps, the transformation
// ---------------------------------------------------------------------------

const mutKey = (opId: string) => `cc.mutated:${opId}`
const TORMENT_TPS = 'cc.torments'
const MAX_MUTANTS = 5
const MAX_TORMENTS = 3
const MAX_TORMENTS_PER_TP = 2

export interface MutationOption {
  kind: 'mutant' | 'torment' | 'regain'
  gift?: Gift
}
export const mutationOptionId = (o: MutationOption): string => (o.gift ? `${o.kind}:${o.gift}` : o.kind)

function formCount(state: GameState, seat: Seat, card: string): number {
  return activeOps(state).filter((o) => o.seat === seat && live(o) && o.datacardId === card).length
}

/** How many operatives the Mutation gambit mutates in this turning point (T-CC.19). */
export function gambitAllowance(turningPoint: number): number {
  return turningPoint <= 2 ? 2 : turningPoint === 3 ? 3 : 4
}

/** What `op` could mutate into now: nothing when it already mutated this turning point. */
export function mutationOptions(state: GameState, op: Operative): MutationOption[] {
  if (!live(op) || !isCc(op) || usedThisTp(state, op.seat, mutKey(op.id))) return []
  const out: MutationOption[] = []
  const seat = op.seat
  // the first turn of each kind also picks the gift; with every gift already selected (Abhorrent Mutation) none is left
  // to pick, and the turn still happens (RULING: no gift left)
  const fresh = availableGifts(state, seat)
  if (isDevotee(op) && formCount(state, seat, CARD.mutant) < MAX_MUTANTS) {
    if (primaryGift(state, seat) || fresh.length === 0) out.push({ kind: 'mutant' })
    else for (const g of fresh) out.push({ kind: 'mutant', gift: g })
  }
  if (isMutant(op) && formCount(state, seat, CARD.torment) < MAX_TORMENTS && tpUsesOf(state, seat, TORMENT_TPS) < MAX_TORMENTS_PER_TP) {
    if (secondaryGift(state, seat) || fresh.length === 0) out.push({ kind: 'torment' })
    else for (const g of fresh) out.push({ kind: 'torment', gift: g })
  }
  out.push({ kind: 'regain' })
  return out
}

function optionName(state: GameState, op: Operative, o: MutationOption): string {
  const gift = o.gift ? ` with ${GIFT_NAME[o.gift]}` : ''
  if (o.kind === 'regain') return `${op.name} regains up to D3+1 wounds`
  return `${op.name} turns into a ${o.kind === 'mutant' ? 'Mutant' : 'Torment'}${gift}`
}

/**
 * Put the operative into the new form's base place: the nearest legal spot to where it stood, and if it stood in an
 * enemy's control range the nearest legal spot that keeps it in one when any exists (T-CC.21). transformOperative has
 * already moved it off overlaps; this only repairs the control range.
 */
function keepControlRange(ctx: Ctx, op: Operative, was: Vec3): void {
  const s = ctx.state
  if (enemiesInControlRange(s, op, op.seat).length > 0) return
  const spots = placementSpots(s, op, { around: was, radius: 6, step: 0.5, max: 400, levels: true })
  spots.sort((a, b) => Math.hypot(a.x - was.x, a.z - was.z) + Math.abs(a.y - was.y) - (Math.hypot(b.x - was.x, b.z - was.z) + Math.abs(b.y - was.y)) || a.x - b.x || a.z - b.z)
  const keep = spots.find((p) => enemiesInControlRange(s, { ...op, pos: p }, op.seat).length > 0)
  if (keep) op.pos = keep
}

/** Apply one mutation option to the operative. False (nothing changes) when the option is not legal now. */
export function performMutation(ctx: Ctx, op: Operative, option: string): boolean {
  const s = ctx.state
  const [kind, giftRaw] = option.split(':') as [MutationOption['kind'], Gift | undefined]
  const legal = mutationOptions(s, op).find((o) => o.kind === kind && (o.gift ?? '') === (giftRaw ?? ''))
  if (!legal) return false
  const seat = op.seat
  markUsedTp(s, seat, mutKey(op.id))
  if (kind === 'regain') {
    regainWounds(ctx, op.id, d3(ctx, 'cc.mutation.regain') + 1, 'cc.mutation')
    used(ctx, op, A('mutation'), 'regain')
    return true
  }
  const was = { ...op.pos }
  const wasCr = enemiesInControlRange(s, op, seat).length > 0
  if (legal.gift) setGift(s, seat, kind === 'mutant' ? 'primary' : 'secondary', legal.gift)
  if (kind === 'torment') addTpUse(s, seat, TORMENT_TPS)
  transformOperative(ctx, op.id, kind === 'mutant' ? CARD.mutant : CARD.torment)
  syncTeamSaves(s, seat)
  if (wasCr) keepControlRange(ctx, op, was)
  used(ctx, op, A('mutation'), legal.gift ? `${kind}:${legal.gift}` : kind)
  return true
}

const choiceOpt = (id: string, labelKey: string, data?: Record<string, unknown>) => ({ id, labelKey, type: 'ability.choice' as const, payload: { option: id }, ...(data ? { data } : {}) })

/** Operatives of the seat that can mutate and the options each has, in id order. */
function mutationCandidates(state: GameState, seat: Seat): { op: Operative; options: MutationOption[] }[] {
  return ccOps(state, seat)
    .map((op) => ({ op, options: mutationOptions(state, op) }))
    .filter((c) => c.options.length > 0)
    .sort((a, b) => (a.op.id < b.op.id ? -1 : 1))
}

/** The Mutation gambit's decision: one operative and option at a time, up to `left` mutations, then "done". */
function mutationGambitNext(ctx: Ctx, seat: Seat, left: number): void {
  const s = ctx.state
  const cands = left > 0 ? mutationCandidates(s, seat) : []
  if (cands.length === 0) {
    resumeGambit(ctx)
    return
  }
  const options = cands.flatMap((c) =>
    c.options.map((o) => choiceOpt(`${c.op.id}|${mutationOptionId(o)}`, 'cc.mutate', { name: optionName(s, c.op, o), operativeId: c.op.id, kind: o.kind, ...(o.gift ? { gift: o.gift } : {}) })),
  )
  options.push(choiceOpt('done', 'cc.mutate.done', { name: 'No more mutations' }))
  ctx.raise({ kind: 'ability.choice', seat, window: 'strategy.gambit', context: { hook: 'ccMutation', mode: 'gambit', operativeId: cands[0]!.op.id, seat, left }, options })
}

registerCodeHook({
  name: 'ccMutation',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return mutationCandidates(state, seat).length > 0 ? [{}] : []
    },
    apply(ctx, seat) {
      mutationGambitNext(ctx, seat, gambitAllowance(ctx.state.turningPoint))
    },
  },
  choice(ctx, op, option, context) {
    // the reaction after a kill (T-CC.19): the offer names its Devotee and option
    if (context.reaction === true) {
      const fresh = ctx.state.operatives[op.id]
      if (fresh) performMutation(ctx, fresh, option)
      removeEffects(ctx, (e) => e.kind === FX_RIGHT && e.operativeId === op.id)
      reactionDone(ctx)
      return
    }
    const seat = context.seat as Seat
    const left = Number(context.left ?? 0)
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const [opId, rest] = option.split('|')
    const target = opId ? ctx.state.operatives[opId] : undefined
    const done = !!target && !!rest && performMutation(ctx, target, rest)
    mutationGambitNext(ctx, seat, done ? left - 1 : left)
  },
})

/**
 * Mutation rights: a Devotee incapacitated an enemy within its control range (T-CC.19). Noted when the damage is dealt,
 * for every cause of kill (attack dice, strikes, Horned, Barbed). The kill log (written at removal time since batch D
 * shared) is not equivalent: a rule kill whose removal waits for the deferred end-of-step queue is logged after the
 * action's reaction round is offered, and the log keeps no positions to check the control range at the kill.
 */
registerHook(
  'damage.inflicted',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const d = c.data as unknown as DamageInflictedData | undefined
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const killer = s && d ? s.operatives[d.attackerId] : undefined
    if (!ctx || !s || !victim || !killer || !d || d.woundsBefore <= 0 || d.woundsAfter > 0) return null
    if (killer.seat === victim.seat || !live(killer) || !isDevotee(killer) || usedThisTp(s, killer.seat, mutKey(killer.id))) return null
    // the victim's position when it was incapacitated, visibility included
    if (!inControlRange(s, bodyOf(killer), bodyOf(victim))) return null
    if (s.effects.some((e) => e.kind === FX_RIGHT && e.operativeId === killer.id)) return null
    addEffect(ctx, { source: FX_RIGHT, seat: killer.seat, kind: FX_RIGHT, operativeId: killer.id, expires: 'turningPoint', data: { actionSeq: s.firefight.activation?.declaredSeq ?? s.seq } })
    return null
  },
  'cc.damage.inflicted',
)

// rights from earlier actions have had their reaction point
registerHook(
  'action.ended',
  (c) => {
    const ctx = c.engine
    const s = c.state
    if (!ctx || !s) return null
    const seq = s.firefight.activation?.declaredSeq ?? 0
    if (s.effects.some((e) => e.kind === FX_RIGHT && Number(e.data?.actionSeq ?? 0) < seq)) removeEffects(ctx, (e) => e.kind === FX_RIGHT && Number(e.data?.actionSeq ?? 0) < seq)
    return null
  },
  'cc.action.ended.rights',
)

/** The reaction offers for the seat's Devotees that earned a mutation by a kill. */
function mutationReactions(state: GameState, seat: Seat): ReactionOffer[] {
  const out: ReactionOffer[] = []
  for (const e of state.effects) {
    if (e.kind !== FX_RIGHT || e.seat !== seat || !e.operativeId) continue
    const op = state.operatives[e.operativeId]
    if (!live(op) || !isDevotee(op)) continue
    for (const o of mutationOptions(state, op)) {
      out.push({ hook: 'ccMutation', operativeId: op.id, option: mutationOptionId(o), labelKey: 'cc.mutate', repeat: true, data: { name: optionName(state, op, o), kind: o.kind, ...(o.gift ? { gift: o.gift } : {}) } })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Team rule provider
// ---------------------------------------------------------------------------

/** Unleash the Daemon's effect on the operative, if the ploy was used in this activation. */
const unleashFx = (state: GameState, op: Operative) => state.effects.find((e) => e.source === FX_UNLEASH && e.operativeId === op.id)

registerTeamRules({
  id: TEAM_ID,

  // Group Activation (T-CC.14): the DEVOTEE card's rule, so a Devotee that mutated in its activation does not chain
  chainActivation(state, expended, wasChained) {
    if (wasChained || !isDevotee(expended)) return null
    return readyOps(state, expended.seat)
      .filter((o) => o.id !== expended.id && isDevotee(o))
      .map((o) => o.id)
  },

  // Icon Bearer (T-CC.10) and Creatures of Nightmare (T-CC.31)
  controlApl(_state, op, _marker, apl) {
    return isIconarch(op) ? apl + 1 : null
  },
  controlTotal(state, seat, _marker, total, contesting) {
    const cult = otherSeat(seat)
    if (!ployActive(state, cult, PL.creatures)) return null
    if (!contesting.some((id) => nearMutated(state, cult, state.operatives[id]!))) return null
    markFired('ccFlagPloy')
    return Math.max(0, total - 1)
  },

  // Accursed Mutant and Accursed Torment (T-CC.15, T-CC.17)
  actionForbidden(state, op, actionId) {
    if (!isMutated(op)) return null
    if (isTorment(op) && actionId === 'marker:pickUp') return 'a Torment cannot Pick Up Marker'
    if (!actionId.startsWith('ability:')) return null
    const id = actionId.slice('ability:'.length)
    const def = state.data.abilities[id]
    if (!def || isHatch(id)) return null
    const mission = (def.keywords ?? []).includes('MISSION')
    if (isTorment(op)) return 'a Torment cannot perform unique or mission actions'
    return mission ? null : 'a Mutant cannot perform unique actions'
  },
  actionCostDelta(state, op, actionId) {
    if (!isCc(op)) return 0
    let d = 0
    if (isMutant(op)) {
      const mission = missionAbility(state, actionId)
      if (actionId === 'marker:pickUp' || (mission && !isHatch(mission))) d += 1
    }
    // Unleash the Daemon: the first Fight after the ploy is free (RULING)
    if (actionId === 'fight') {
      const fx = unleashFx(state, op)
      const act = baseActivation(state)
      if (fx && act && !act.counteract && act.operativeId === op.id && act.performed.filter((p) => p === 'fight').length === Number(fx.data?.fightsAtUse ?? 0)) d -= 1
    }
    return d
  },
  maxRepeats(state, op, actionId) {
    return actionId === 'fight' && isCc(op) && unleashFx(state, op) ? 2 : null
  },
  weaponForbidden(state, op, weaponId) {
    if (!isTorment(op)) return null
    return state.data.datacards[op.datacardId]?.fixedWeapons.includes(weaponId) ? null : 'a Torment can only use the weapons on its datacard'
  },

  // Fleet (T-CC.24)
  moveDelta(state, op) {
    return isCc(op) && hasGift(state, op, 'fleet') ? 1 : 0
  },
  // Deformed Wings (T-CC.23): a climb costs 2" whatever its height, drops cost nothing
  moveSurcharge(state, op, _kind, _points, b) {
    if (!isCc(op) || !hasGift(state, op, 'deformed-wings')) return 0
    let d = -b.drop
    for (const c of b.climbs ?? []) d += Math.min(0, 2 - c)
    return d
  },
  // Covert Guises (T-CC.38): the free Reposition must end wholly within 3" of the drop zone
  moveProblem(state, op, kind, points) {
    if (kind !== 'reposition' || !state.effects.some((e) => e.source === FX_GUISE && e.operativeId === op.id)) return null
    const end = points.at(-1)
    const zone = state.map.dropZones.find((z) => z.id === state.players[op.seat].dropZoneId)
    if (!end || !zone) return null
    return distToPolygon({ x: end.x, z: end.z }, zone.polygon) + op.baseRadius <= 3 + EPS ? null : 'this Reposition must end wholly within 3" of your drop zone'
  },

  // Mutation after a kill (T-CC.19): offered at the reaction point after the action
  ownReactions: (state, seat) => mutationReactions(state, seat),
  reactions: (state, seat) => mutationReactions(state, seat),
})

// ---------------------------------------------------------------------------
// Attack hooks: injury, gifts, ploys
// ---------------------------------------------------------------------------

/** The weapon's rule list gets an entry unless it already has the rule. */
function addRule(rules: WeaponRuleRef[], rule: WeaponRuleRef): void {
  if (!hasRule(rules, ruleKey(rule.rule))) rules.push(rule)
}

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; atk: number; hitDelta: number; assists: string[] }
    const weapon = s.data.weapons[c.weaponId]
    const foe = c.targetId ? s.operatives[c.targetId] : undefined
    if (isCc(op)) {
      // the injury Hit change is ignored by Exaltation in Pain (any weapon) and Sinewed (melee weapons): once (T-CC.29, 27)
      const exalt = ployActive(s, op.seat, PL.exaltation)
      const sinewed = weapon?.type === 'melee' && hasGift(s, op, 'sinewed')
      if ((exalt || sinewed) && hasInjuredPenalty(op)) data.hitDelta -= 1
    }
    // Barbed: enemy operatives cannot assist the operative's opponent (T-CC.28)
    if (data.kind === 'fight' && foe && isCc(foe) && foe.seat !== op.seat && hasGift(s, foe, 'barbed') && data.assists.length > 0) data.assists.length = 0
    // Sickening Aura: the Hit of an enemy near a Mutant or Torment is 1 worse, not on top of being injured (T-CC.32)
    // (the seat makes it an enemy: in a cult mirror match the other cult's operatives are worsened too)
    if (ployActive(s, otherSeat(op.seat), PL.sickening) && nearMutated(s, otherSeat(op.seat), op)) {
      if (!(hasInjuredPenalty(op) || providerAny(s, op, 'injuredEquivalent'))) data.hitDelta += 1
    }
    return null
  },
  'cc.modifyAttackDice',
)

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const w = s && c.weaponId ? s.data.weapons[c.weaponId] : undefined
    if (!s || !op || !w || !isCc(op) || w.type !== 'melee') return null
    const rules = (c.data as { rules: WeaponRuleRef[] }).rules
    if (ployActive(s, op.seat, PL.fervent)) addRule(rules, { rule: 'accurate', x: isMutated(op) ? 2 : 1 })
    if (hasGift(s, op, 'sinewed')) addRule(rules, { rule: 'brutal' })
    return null
  },
  'cc.modifyWeaponRules',
)

// Ruinous Icon (T-CC.11): the Dmg of a weapon against an operative near the Iconarch
registerHook(
  'modifyDamage',
  (c) => {
    const s = c.state
    const target = s && c.targetId ? s.operatives[c.targetId] : undefined
    if (!s || !target) return null
    const dmg = (c.data as { dmg: { normal: number; crit: number } }).dmg
    for (const holder of holdersOf(s, T_ICON)) {
      if (!psychicAllowed(s, holder) || !isIconarch(holder) || !within(holder, target, 4)) continue
      const effect = holder.tokens?.find((t) => t.kind === T_ICON)?.data?.effect
      if (effect === 'invigoration' && target.seat === holder.seat && isCc(target)) {
        if (dmg.normal >= 4) dmg.normal -= 1
        if (dmg.crit >= 4) dmg.crit -= 1
      } else if (effect === 'deterioration' && target.seat !== holder.seat) {
        dmg.normal += 1
        dmg.crit += 1
      }
    }
    return null
  },
  'cc.modifyDamage',
)

// Exaltation in Pain (T-CC.29): a wounded friendly cult operative being shot re-rolls one defence die
registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isCc(op) || op.wounds >= op.maxWounds || !ployActive(s, op.seat, PL.exaltation)) return null
    const rerolls = (c.data as { rerolls: { id: string; source: string; mode: 'one'; used: boolean }[] }).rerolls
    if (!rerolls.some((r) => r.id === 'cc.exaltation')) rerolls.push({ id: 'cc.exaltation', source: PL.exaltation, mode: 'one', used: false })
    return null
  },
  'cc.modifyDefenceDice',
)

// Unnatural Regeneration (T-CC.16) and Vile Blessing (T-CC.40)
registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !op || !isCc(op) || !c.engine) return null
    const d = c.data as { source: string; amount: number }
    const normal = d.source === 'normal' || d.source === 'strike-normal'
    const dice = normal || d.source === 'crit' || d.source === 'strike-crit'
    if (!dice || d.amount <= 0) return null
    // Vile Blessing is used on the first Normal Dmg die that would incapacitate a non-Devotee; it replaces the roll
    if (normal && !isDevotee(op) && d.amount >= op.wounds && equipped(s, op.seat, EQ.vile) && !usedThisBattle(s, op.seat, EQ.vile)) {
      markUsedBattle(s, op.seat, EQ.vile)
      d.amount = 0
      markFired('ccVileBlessing')
      used(c.engine, op, EQ.vile)
      return null
    }
    if (isMutated(op) && d.amount >= 3) {
      const [r] = c.engine.roll('cc.regeneration', 1)
      if (r! >= 5) d.amount -= 1
    }
    return null
  },
  'cc.onDamageInflicted',
)

// Barbed (T-CC.28): the first strike of a sequence splashes every other enemy in control range
registerHook(
  'beforeStrike',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const op = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!ctx || !s || !op || !isCc(op) || !hasGift(s, op, 'barbed')) return null
    if (s.effects.some((e) => e.source === FX_BARBED && e.operativeId === op.id)) return null
    addEffect(ctx, { source: FX_BARBED, seat: op.seat, kind: 'ployFlag', operativeId: op.id, expires: 'action' })
    for (const e of enemiesInControlRange(s, op, op.seat)) {
      if (e.id === c.targetId || e.wounds <= 0) continue
      directDamage(ctx, e.id, isTorment(op) ? d3(ctx, 'cc.barbed') : 1, op.id, 'cc.barbed')
    }
    return null
  },
  'cc.beforeStrike',
)

// Brute (T-CC.18): a Torment on Conceal gets no help from Light terrain when an enemy selects a valid target
registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const shooter = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean } | undefined
    if (!s || !shooter || !data || data.secondary) return null
    for (const t of enemiesOf(s, shooter)) {
      if (!isTorment(t) || t.order !== 'conceal' || t.wounds <= 0 || data.candidates.includes(t.id)) continue
      const rules = ruleSetFor(s, shooter, data.weaponId, 'shoot')
      if (rules.range !== null && distanceBetween(bodyOf(shooter), bodyOf(t)) > rules.range + EPS) continue
      if (enemiesInControlRange(s, t, t.seat).length > 0) continue
      const info = targetInfo(s, shooter, t, rules)
      if (!info.verdict.visible || bruteCover(s, info.verdict, rules)) continue
      data.candidates.push(t.id)
    }
    return null
  },
  'cc.beforeShootTargetSelect',
)

/** coverForSelection with Light terrain taken away: only Heavy parts still count as cover for the Torment. */
function bruteCover(state: GameState, verdict: { inCover: boolean; coverParts: string[] }, rules: RuleSet): boolean {
  if (!verdict.inCover || rules.seek) return false
  const idx = terrainOf(state.map)
  return verdict.coverParts.filter((p) => !idx.byPart.get(p)?.light).length > 0
}

// ---------------------------------------------------------------------------
// Cut Them Down (T-CC.8)
// ---------------------------------------------------------------------------

registerHook(
  'action.declared',
  (c) => {
    const ctx = c.engine
    const s = c.state
    const mover = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    const d = c.data as unknown as ActionDeclaredData | undefined
    if (!ctx || !s || !mover || !d || d.action !== 'fallBack' || !live(mover)) return null
    const blades = activeOps(s).filter((o) => o.seat !== mover.seat && isBlade(o) && live(o) && inControlRange(s, bodyOf(o), bodyOf(mover)))
    if (blades.length === 0) return null
    const dmg = blades.length >= 2 ? d3(ctx, 'cc.cutThemDown') + d3(ctx, 'cc.cutThemDown') + 2 : d3(ctx, 'cc.cutThemDown') + 1
    directDamage(ctx, mover.id, dmg, blades[0]!.id, 'cc.cutThemDown')
    if (mover.wounds <= 0) {
      d.cancel = true
      d.reason = 'incapacitated by Cut Them Down before it could move'
    }
    return null
  },
  'cc.action.declared',
)

// ---------------------------------------------------------------------------
// Incite Slaughter and Incite Urgency (T-CC.6, T-CC.7)
// ---------------------------------------------------------------------------

function inciteTargets(state: GameState, op: Operative, kind: 'fight' | 'move'): Operative[] {
  const reach = 9 + commsBonus(state, op.seat, op)
  const foes = enemiesOf(state, op).filter((e) => live(e))
  return ccOps(state, op.seat)
    .filter((t) => {
      if (t.id === op.id || !within(op, t, reach) || !sees(state, op, t)) return false
      if (kind === 'fight') return canStartFreeAction(state, { operativeId: t.id, action: 'fight', resume: '' })
      if (canStartFreeAction(state, { operativeId: t.id, action: 'dash', resume: '' })) return true
      // a Charge of 3" at most must still end in an enemy's control range: an enemy has to be close enough
      return canStartFreeAction(state, { operativeId: t.id, action: 'charge', maxMove: 3, resume: '' }) && foes.some((e) => gap(t, e) <= 4.5)
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

registerCodeHook({
  name: 'ccIncite',
  action: {
    offers(state, op, def): OfferSeed[] {
      return inciteTargets(state, op, def.id === AB.inciteSlaughter ? 'fight' : 'move').map((t) => ({ key: t.id, params: { targetId: t.id } }))
    },
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[String(params.targetId)]
      if (!live(t) || t.seat !== op.seat) {
        cancelAction(ctx)
        return
      }
      const slaughter = def.id === AB.inciteSlaughter
      const started = startDelegatedAction(ctx, {
        operativeId: t.id,
        resume: 'cc.incite',
        rules: slaughter ? { allow: ['fight'], tag: 'ccIncite' } : { allow: ['charge', 'dash'], maxMove: 3, tag: 'ccIncite' },
        data: { demagogueId: op.id, abilityId: def.id },
      })
      if (!started) cancelAction(ctx)
      else used(ctx, op, def.id, t.id)
    },
  },
})

registerFrameResume('cc.incite', (ctx, outcome) => {
  if (outcome === 'finished') finishAction(ctx)
  else cancelAction(ctx)
})

// ---------------------------------------------------------------------------
// Ruinous Icon (T-CC.11)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'ccRuinousIcon',
  action: {
    offers: (): OfferSeed[] => [
      { key: 'invigoration', params: { param: 'invigoration' } },
      { key: 'deterioration', params: { param: 'deterioration' } },
    ],
    perform(ctx, op, def, params) {
      const effect = String(params.param)
      if (effect !== 'invigoration' && effect !== 'deterioration') {
        cancelAction(ctx)
        return
      }
      // lasts until the Iconarch's next activation starts, it is incapacitated, or it uses the action again
      moveTokenTo(ctx, T_ICON, op.seat, op.id, { cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'], data: { effect } }, 'cc.ruinousIcon')
      used(ctx, op, def.id, effect)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Heinous Deluge (T-CC.12)
// ---------------------------------------------------------------------------

/** Enemies that are a valid target for the Mindwitch: visible and, on Conceal, not in cover (no range). */
function deludeTargets(state: GameState, op: Operative): Operative[] {
  const rules = ruleSetFor(state, op, GAZE, 'shoot')
  return enemiesOf(state, op)
    .filter((e) => {
      if (!live(e) || !psychicSelectable(state, e)) return false
      const info = targetInfo(state, op, e, rules)
      return info.verdict.visible && !info.coverBlocks
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

registerCodeHook({
  name: 'ccHeinousDeluge',
  action: {
    offers: (state, op): OfferSeed[] => (op.weapons.includes(GAZE) ? deludeTargets(state, op).map((e) => ({ key: e.id, params: { targetId: e.id } })) : []),
    perform(ctx, op, def, params) {
      const t = ctx.state.operatives[String(params.targetId)]
      if (!live(t) || t.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      aplChangeNextActivation(ctx, t.id, -1, 'cc.heinousDeluge')
      used(ctx, op, def.id, t.id)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Malefic Vortex (T-CC.13)
// ---------------------------------------------------------------------------

const vortexFx = (state: GameState, seat: Seat) => state.effects.find((e) => e.kind === FX_VORTEX && e.seat === seat)
const MARKER_R = 0.4

/** The 3D body of the seat's Vortex marker (its floor height is kept on the effect), or null. */
export function vortexBody(state: GameState, seat: Seat): Body | null {
  const fx = vortexFx(state, seat)
  const m = fx ? state.markers.find((k) => k.id === fx.data?.markerId) : undefined
  if (!fx || !m) return null
  const b = markerBody(m)
  return { ...b, pos: { ...b.pos, y: Number(fx.data?.y ?? 0) } }
}

function vortexVictims(state: GameState, seat: Seat, body: Body): Operative[] {
  return activeOps(state)
    .filter((o) => o.seat !== seat && live(o) && distanceBetween(bodyOf(o), body) <= 2 + EPS)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

function vortexDamage(ctx: Ctx, seat: Seat, sourceId: string): void {
  const body = vortexBody(ctx.state, seat)
  if (!body) return
  for (const v of vortexVictims(ctx.state, seat, body)) directDamage(ctx, v.id, 1, sourceId, 'cc.vortex')
}

const probe = (pos: Vec3, r = MARKER_R, h = 0.1): Body => ({ id: 'cc-vortex-probe', pos, baseRadius: r, height: h })

/** Is the feature around an elevated spot visible to the viewer (any sampled point just outside one of its parts)? */
function featureVisible(state: GameState, viewer: Operative, featureId: string): boolean {
  const idx = terrainOf(state.map)
  for (const sol of idx.solids) {
    if (sol.featureId !== featureId) continue
    const cx = sol.polygon.reduce((n, p) => n + p.x, 0) / sol.polygon.length
    const cz = sol.polygon.reduce((n, p) => n + p.z, 0) / sol.polygon.length
    for (const p of sol.polygon) {
      const len = Math.hypot(p.x - cx, p.z - cz) || 1
      const out: Vec3 = { x: p.x + ((p.x - cx) / len) * 0.4, y: 0, z: p.z + ((p.z - cz) / len) * 0.4 }
      if (visible(state, bodyOf(viewer), probe(out, 0.1, 0.3))) return true
    }
  }
  return false
}

// spot lists per map (the map object is kept across steps, as terrainOf's index is), then per Mindwitch and positions
const spotCache = new WeakMap<object, Map<string, Vec3[]>>()

/** The Vortex marker's body at a spot (the shape vortexBody gives the placed marker). */
function vortexAt(pos: Vec3): Body {
  const b = markerBody({ id: 'cc-vortex-probe', kind: 'equipment', pos: { x: pos.x, z: pos.z } } as Parameters<typeof markerBody>[0])
  return { ...b, pos: { ...b.pos, y: pos.y } }
}

/**
 * Where the Mindwitch may place its Vortex: visible spots, or Vantage floors of visible features (levels, D11). The card
 * allows any such spot; the offers are (a) for every distinct set of enemy operatives a spot can put within 2" of the
 * marker, the legal spot (1" grid around each enemy) nearest that set's centre, and (b) a 2" grid over the killzone
 * spread to 24 spots, for a marker placed to deny ground rather than to hurt at once.
 */
export function vortexSpots(state: GameState, op: Operative): Vec3[] {
  const key = `${op.id}|${op.pos.x},${op.pos.z},${op.pos.y}|${activeOps(state).map((o) => `${o.id}:${o.pos.x},${o.pos.z},${o.pos.y},${o.baseRadius},${o.status}`).join(';')}`
  let perMap = spotCache.get(state.map)
  if (!perMap) spotCache.set(state.map, (perMap = new Map()))
  const hit = perMap.get(key)
  if (hit) return hit
  const idx = terrainOf(state.map)
  const featureSeen = new Map<string, boolean>()
  const body = { ...op, id: 'cc-vortex-probe', baseRadius: MARKER_R, height: 0.1 }
  const legal = (pos: Vec3): boolean => {
    if (visible(state, bodyOf(op), probe(pos))) return true
    if (pos.y <= 0.01) return false
    const sol = idx.solids.find((s) => s.vantage && s.floors.some((f) => Math.abs(f - pos.y) < 0.01) && pointInPolygon({ x: pos.x, z: pos.z }, s.polygon))
    if (!sol) return false
    if (!featureSeen.has(sol.featureId)) featureSeen.set(sol.featureId, featureVisible(state, op, sol.featureId))
    return featureSeen.get(sol.featureId)!
  }
  // (a) one spot per reachable set of enemy victims
  const foes = enemiesOf(state, op).filter((e) => live(e))
  const groups = new Map<string, { ids: string[]; cands: Vec3[] }>()
  const seen = new Set<string>()
  for (const e of foes) {
    for (const p of placementSpots(state, body, { around: e.pos, radius: e.baseRadius + 2 + MARKER_R, step: 1, max: 100000, levels: true })) {
      const k = `${p.x},${p.z},${p.y}`
      if (seen.has(k)) continue
      seen.add(k)
      const m = vortexAt(p)
      const ids = foes.filter((f) => distanceBetween(bodyOf(f), m) <= 2 + EPS).map((f) => f.id).sort()
      if (ids.length === 0) continue
      const g = ids.join(',')
      if (!groups.has(g)) groups.set(g, { ids, cands: [] })
      groups.get(g)!.cands.push(p)
    }
  }
  const strike: Vec3[] = []
  for (const g of [...groups.keys()].sort()) {
    const { ids, cands } = groups.get(g)!
    const cx = ids.reduce((n, id) => n + state.operatives[id]!.pos.x, 0) / ids.length
    const cz = ids.reduce((n, id) => n + state.operatives[id]!.pos.z, 0) / ids.length
    cands.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz) || a.y - b.y || a.x - b.x || a.z - b.z)
    const pick = cands.find((p) => legal(p))
    if (pick) strike.push(pick)
  }
  // (b) spread spots for ground denial
  const spread = placementSpots(state, body, { step: 2, max: 24, levels: true, test: legal })
  const spots = [...strike]
  for (const p of spread) if (!spots.some((q) => q.x === p.x && q.z === p.z && q.y === p.y)) spots.push(p)
  if (perMap.size > 12) perMap.clear()
  perMap.set(key, spots)
  return spots
}

registerCodeHook({
  name: 'ccMaleficVortex',
  action: {
    offers: (state, op): OfferSeed[] => vortexSpots(state, op).map((p) => ({ key: `${p.x},${p.z},${p.y}`, params: { param: `${p.x},${p.z},${p.y}` } })),
    perform(ctx, op, def, params) {
      const s = ctx.state
      const [x, z, y] = String(params.param ?? '').split(',').map(Number)
      if (x === undefined || z === undefined || y === undefined || ![x, z, y].every(Number.isFinite)) {
        cancelAction(ctx)
        return
      }
      // the old marker leaves the killzone first
      const old = vortexFx(s, op.seat)
      if (old) {
        removeMarker(ctx, String(old.data?.markerId), 'cc.vortex moved')
        removeEffects(ctx, (e) => e.id === old.id)
      }
      const marker = { id: newMarkerId(ctx, 'vortex'), kind: 'equipment' as const, pos: { x, z } as Vec2, owner: op.seat, carriedBy: null, controller: null, equipmentId: VORTEX, placedBy: op.id }
      s.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: marker.pos }, op.seat)
      addEffect(ctx, { source: VORTEX, seat: op.seat, kind: FX_VORTEX, expires: 'cc.never', data: { markerId: marker.id, y, mindwitchId: op.id } })
      vortexDamage(ctx, op.seat, op.id)
      used(ctx, op, def.id, `${x},${z}`)
      finishAction(ctx)
    },
  },
})

// the Ready step of each Strategy phase: the marker hurts again (a Null Rod does not stop it, RULING)
registerHook(
  'turningPoint.start',
  (c) => {
    const ctx = c.engine
    if (!ctx) return null
    for (const seat of ['A', 'B'] as const) {
      const fx = vortexFx(ctx.state, seat)
      if (fx) vortexDamage(ctx, seat, String(fx.data?.mindwitchId))
      // Covert Guises: the D3 is rolled at set-up (ccGuisesRoll); this only catches a game whose equipment changed later
      if (ctx.state.turningPoint === 1 && equipped(ctx.state, seat, EQ.guises) && usesOf(ctx.state, seat, FX_GUISE_ROLL) === 0) rollGuises(ctx, seat)
    }
    return null
  },
  'cc.turningPoint.start',
)

/** Covert Guises (T-CC.38): roll the D3 once and show it to both players. */
function rollGuises(ctx: Ctx, seat: Seat): void {
  const n = d3(ctx, 'cc.covertGuises')
  addUse(ctx.state, seat, FX_GUISE_ROLL, n)
  ctx.emit({ type: 'AbilityUsed', operativeId: null, abilityId: EQ.guises, detail: `D3: ${n}` }, null)
}

// The equipment is revealed when the game is created with it (equipment is part of the set-up), so the D3 is rolled
// then: the code hook is named by the Devotee's Group Activation record so the set-up pass runs it once per seat.
registerCodeHook({
  name: 'ccGuisesRoll',
  setup(ctx, seat) {
    if (!equipped(ctx.state, seat, EQ.guises) || usesOf(ctx.state, seat, FX_GUISE_ROLL) > 0) return
    rollGuises(ctx, seat)
    markFired('ccGuisesRoll')
  },
})

// ---------------------------------------------------------------------------
// Strategy flag ploys (Exaltation in Pain, Fervent Onslaught, Creatures of Nightmare, Sickening Aura)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'ccFlagPloy',
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

// FAITHFUL FOLLOWER (T-CC.33)
function followerCandidates(state: GameState, target: Operative): Operative[] {
  return ccOps(state, target.seat).filter((o) => o.id !== target.id && !hasKeyword(state, o, 'DARK COMMUNE') && within(target, o, 3) && sees(state, target, o))
}

registerCodeHook({
  name: 'ccFaithfulFollower',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const target = info.targetId ? state.operatives[info.targetId] : undefined
      const a = state.attack
      if (!a || !target || target.seat !== seat || info.subjectId !== target.id || !live(target) || !isCc(target) || !hasKeyword(state, target, 'DARK COMMUNE')) return []
      if (a.kind === 'shoot') {
        const attacker = state.operatives[a.operativeId]
        if (!attacker || !a.weaponId) return []
        const rules = ruleSetFor(state, attacker, a.weaponId, 'shoot', target.id)
        if (rules.blast !== null || rules.torrent !== null) return []
      }
      return followerCandidates(state, target).map((o) => ({ param: o.id, operativeId: o.id }))
    },
    apply(ctx, seat, _ploy, seed) {
      const s = ctx.state
      const a = s.attack
      const sub = seed.param ? s.operatives[seed.param] : undefined
      if (!a || !sub) return
      if (a.kind === 'shoot' && a.weaponId) {
        const attacker = s.operatives[a.operativeId]!
        const own = targetInfo(s, attacker, sub, ruleSetFor(s, attacker, a.weaponId, 'shoot', sub.id, ctx))
        const was = a.status ?? { cover: false, obscured: false, improvedCover: false }
        // in cover or obscured only if the original target was (and the stand-in's own spot allows it)
        redirectAttack(ctx, sub.id, { cover: was.cover && own.inCover, obscured: was.obscured && own.obscured, improvedCover: was.improvedCover && own.improvedCover })
      } else redirectAttack(ctx, sub.id)
      used(ctx, sub, PL.follower)
    },
  },
})

// ABHORRENT MUTATION (T-CC.34)
const abhorrentKey = (opId: string) => `cc.abhorrent:${opId}`

registerCodeHook({
  name: 'ccAbhorrentMutation',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!live(op) || op.seat !== seat || !isCc(op) || info.counteracting || hasKeyword(state, op, 'DARK COMMUNE') || usedThisBattle(state, seat, abhorrentKey(op.id))) return []
      return availableGifts(state, seat).map((g) => ({ param: g, operativeId: op.id }))
    },
    apply(ctx, seat, _ploy, seed, info) {
      const op = (seed.operativeId ?? info.subjectId) ? ctx.state.operatives[(seed.operativeId ?? info.subjectId)!] : undefined
      const gift = seed.param as Gift | undefined
      if (!op || !gift || !GIFTS.includes(gift)) return
      markUsedBattle(ctx.state, seat, abhorrentKey(op.id))
      setGift(ctx.state, seat, `op:${op.id}`, gift)
      syncSave(ctx.state, op)
      used(ctx, op, PL.abhorrent, gift)
    },
  },
})

// FRENZIED DEMISE (T-CC.35)
registerCodeHook({
  name: 'ccFrenziedDemise',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || !isMutated(op)) return []
      return enemiesOf(state, op)
        .filter((e) => live(e) && within(op, e, 2) && sees(state, op, e))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => ({ param: e.id }))
    },
    apply(ctx, _seat, _ploy, seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      const victim = seed.param ? ctx.state.operatives[seed.param] : undefined
      if (!op || !live(victim)) return
      const dmg = isTorment(op) ? ctx.roll('cc.frenziedDemise', 1)[0]! : d3(ctx, 'cc.frenziedDemise')
      directDamage(ctx, victim.id, dmg, op.id, 'cc.frenziedDemise')
      used(ctx, op, PL.demise, victim.id)
    },
  },
})

// UNLEASH THE DAEMON (T-CC.36)
registerCodeHook({
  name: 'ccUnleashTheDaemon',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      const act = state.firefight.activation
      if (!live(op) || op.seat !== seat || !isMutated(op) || info.counteracting || !act || act.frame || act.counteract || act.operativeId !== op.id || unleashFx(state, op)) return []
      return [{}]
    },
    apply(ctx, seat, _ploy, _seed, info) {
      const op = info.subjectId ? ctx.state.operatives[info.subjectId] : undefined
      const act = ctx.state.firefight.activation
      if (!op || !act) return
      addEffect(ctx, { source: FX_UNLEASH, seat, kind: 'ployFlag', operativeId: op.id, expires: 'activation', data: { fightsAtUse: act.performed.filter((p) => p === 'fight').length } })
      used(ctx, op, PL.unleash)
    },
  },
})

// ---------------------------------------------------------------------------
// Equipment gambits: Baleful Script (T-CC.37) and Covert Guises (T-CC.38)
// ---------------------------------------------------------------------------

const BALEFUL_USED = 'cc.baleful'

/** Every gift change Baleful Script could make now, as `slot>gift` params. */
function balefulParams(state: GameState, seat: Seat): string[] {
  const fresh = availableGifts(state, seat)
  if (fresh.length === 0) return []
  const slots: string[] = []
  if (primaryGift(state, seat)) slots.push('primary')
  if (secondaryGift(state, seat)) slots.push('secondary')
  for (const o of Object.values(state.operatives)) if (o.seat === seat && isCc(o)) for (const g of opGifts(state, o)) slots.push(`op:${o.id}:${g}`)
  return slots.flatMap((slot) => fresh.map((g) => `${slot}>${g}`))
}

registerCodeHook({
  name: 'ccBalefulScript',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (!equipped(state, seat, EQ.baleful) || usedThisBattle(state, seat, BALEFUL_USED)) return []
      return balefulParams(state, seat).map((param) => ({ param }))
    },
    apply(ctx, seat, _ploy, seed) {
      const [slot, gift] = (seed.param ?? '').split('>') as [string, Gift | undefined]
      if (!slot || !gift || !GIFTS.includes(gift)) return
      markUsedBattle(ctx.state, seat, BALEFUL_USED)
      replaceGift(ctx.state, seat, slot, gift)
      syncTeamSaves(ctx.state, seat)
      used(ctx, null, PL.baleful, seed.param)
    },
  },
})

const GUISES_DONE = 'cc.guisesDone'

function dropZoneOf(state: GameState, seat: Seat) {
  return state.map.dropZones.find((z) => z.id === state.players[seat].dropZoneId)
}

/** Devotees wholly within the seat's drop zone that can still Reposition (Covert Guises). */
function guiseCandidates(state: GameState, seat: Seat): Operative[] {
  const zone = dropZoneOf(state, seat)
  if (!zone) return []
  return ccOps(state, seat)
    .filter((o) => isDevotee(o) && pointFullyIn(o, zone.polygon) && canStartFreeAction(state, { operativeId: o.id, action: 'reposition', resume: '' }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** The base lies wholly inside the polygon: its centre does, and the edge is at least a radius away. */
function pointFullyIn(op: Operative, poly: { x: number; z: number }[]): boolean {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((op.pos.x - a.x) * dx + (op.pos.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(op.pos.x - (a.x + t * dx), op.pos.z - (a.z + t * dz)))
  }
  return pointInPolygon({ x: op.pos.x, z: op.pos.z }, poly) && best >= op.baseRadius - EPS
}

function guisesNext(ctx: Ctx, seat: Seat, left: number, skip: string[]): void {
  const s = ctx.state
  const cands = left > 0 ? guiseCandidates(s, seat).filter((o) => !skip.includes(o.id)) : []
  if (cands.length === 0) {
    resumeGambit(ctx)
    return
  }
  const options = cands.map((o) => choiceOpt(o.id, 'cc.guises.reposition', { name: `${o.name} repositions` }))
  options.push(choiceOpt('done', 'cc.guises.done', { name: 'No more repositions' }))
  ctx.raise({ kind: 'ability.choice', seat, window: 'strategy.gambit', context: { hook: 'ccCovertGuises', operativeId: cands[0]!.id, seat, left, skip }, options })
}

registerCodeHook({
  name: 'ccCovertGuises',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (state.turningPoint !== 1 || !equipped(state, seat, EQ.guises) || usedThisBattle(state, seat, GUISES_DONE) || usesOf(state, seat, FX_GUISE_ROLL) <= 0) return []
      return guiseCandidates(state, seat).length > 0 ? [{}] : []
    },
    apply(ctx, seat) {
      markUsedBattle(ctx.state, seat, GUISES_DONE)
      guisesNext(ctx, seat, usesOf(ctx.state, seat, FX_GUISE_ROLL), [])
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const left = Number(context.left ?? 0)
    const skip = ((context.skip as string[] | undefined) ?? []).slice()
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const op = ctx.state.operatives[option]
    if (!op) {
      resumeGambit(ctx)
      return
    }
    addEffect(ctx, { source: FX_GUISE, seat, kind: 'ployFlag', operativeId: op.id, expires: 'cc.guiseMove' })
    const started = startFreeAction(ctx, { operativeId: op.id, action: 'reposition', resume: 'cc.guises', data: { seat, left: left - 1, skip: [...skip, op.id], opId: op.id } })
    if (!started) {
      removeEffects(ctx, (e) => e.source === FX_GUISE && e.operativeId === op.id)
      guisesNext(ctx, seat, left, [...skip, op.id])
    }
  },
})

registerFrameResume('cc.guises', (ctx, _outcome, data) => {
  removeEffects(ctx, (e) => e.source === FX_GUISE && e.operativeId === data.opId)
  guisesNext(ctx, data.seat as Seat, Number(data.left ?? 0), (data.skip as string[] | undefined) ?? [])
})

// ---------------------------------------------------------------------------
// Ploy rules: Attuned In Purpose, Horned, Unholy Talisman (0 CP offers)
// ---------------------------------------------------------------------------

function free(id: string, ployId: string, name: string, via: string, op: Operative, param?: string): PloyOffer {
  return { id, ployId, name, ...(param ? { param } : {}), operativeId: op.id, cost: 0, via, seed: param ? { param } : {} }
}

registerPloyRule({
  extraOffers(state, seat, window, info): PloyOffer[] {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!live(subject) || subject.seat !== seat || !isCc(subject)) return out
    // ATTUNED IN PURPOSE (T-CC.9): a joint activation with the other ready Blessed Blade within 6"
    if (window === 'firefight.activationStart' && isBlade(subject) && !info.counteracting) {
      const act = state.firefight.activation
      if (act && !act.frame && !act.counteract && !act.partner && act.operativeId === subject.id) {
        for (const p of readyOps(state, seat)) {
          if (p.id === subject.id || !isBlade(p) || !live(p) || !within(subject, p, 6)) continue
          for (const order of allowedOrders(state, p)) out.push(free(`${AB.attuned}:${p.id}:${order}`, AB.attuned, `Attuned In Purpose: ${p.name} (${order})`, 'cc.attuned', subject, `${p.id}:${order}`))
        }
      }
    }
    // HORNED (T-CC.26): after a Charge move, 1 damage (D3 for a Torment) on an enemy in control range
    if (window === 'firefight.chargeMoved' && hasGift(state, subject, 'horned') && !state.effects.some((e) => e.source === FX_HORNED && e.operativeId === subject.id)) {
      for (const e of enemiesInControlRange(state, subject, seat)) {
        if (e.wounds > 0) out.push(free(`${AB.horned}:${e.id}`, AB.horned, `Horned: gore ${e.name}`, 'cc.horned', subject, e.id))
      }
    }
    // UNHOLY TALISMAN (T-CC.39): in the Roll Defence Dice step, one normal success becomes a crit
    if (window === 'shoot.defenceRolled' && equipped(state, seat, EQ.talisman) && !usedThisTp(state, seat, EQ.talisman)) {
      const seq = state.attack?.seq
      if (seq?.def && seq.def.operativeId === subject.id && seq.def.dice.some((d) => d.kind === 'normal' && !d.used)) {
        out.push(free(EQ.talisman, EQ.talisman, 'Unholy Talisman: a normal success counts as a crit', 'cc.talisman', subject))
      }
    }
    return out
  },
  onUsed(ctx, seat, o) {
    const s = ctx.state
    const op = o.operativeId ? s.operatives[o.operativeId] : undefined
    switch (o.via) {
      case 'cc.attuned': {
        const [partnerId, order] = (o.param ?? '').split(':')
        if (partnerId) joinActivation(ctx, partnerId, (order as 'engage' | 'conceal' | undefined) ?? 'engage')
        break
      }
      case 'cc.horned': {
        const victim = o.param ? s.operatives[o.param] : undefined
        if (!op || !live(victim)) break
        addEffect(ctx, { source: FX_HORNED, seat, kind: 'ployFlag', operativeId: op.id, expires: 'action' })
        directDamage(ctx, victim.id, isTorment(op) ? d3(ctx, 'cc.horned') : 1, op.id, 'cc.horned')
        used(ctx, op, AB.horned, victim.id)
        break
      }
      case 'cc.talisman': {
        const die = s.attack?.seq?.def?.dice.find((d) => d.kind === 'normal' && !d.used)
        markUsedTp(s, seat, EQ.talisman)
        if (die) {
          die.kind = 'crit'
          die.tag = 'talisman'
        }
        markFired('ccUnholyTalisman')
        used(ctx, op ?? null, EQ.talisman)
        break
      }
      default:
        break
    }
  },
})
