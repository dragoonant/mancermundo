// Resolving hits (R-11; R-14.3 for the traits that change it): one hit on one fighter is a wound roll (S vs T), a save
// (armour with AP, Blast/Template cover bonus), then Damage: each point removes a Wound, the point that reaches 0 and every
// further point roll an Injury dice, all dice of one hit rolled together and applied with the N23 stacking (any Out of
// Action wins; the first Seriously Injured lays the fighter down, every further one is a Flesh Wound; Flesh Wounds lower T
// and T 0 is Out of Action). Gas, Toxin and Flash replace the wound roll; Melta turns the Injury dice into Out of Action;
// Scattershot, Shred, Rending, Knockback, Blaze and Concussion act on the hit; the close-combat traits that change it are
// Shock (no wound roll), Power (no save, +1 Damage, both set by fight.ts on a natural 6), Pulverise (a Flesh Wound becomes
// Seriously Injured) and Sever (every Injury dice is Out of Action). Also here: pinning (R-8.7), Blast markers (R-9.5), door
// targets (R-15.8), and the S2 ports (door closing on a fighter, frag-trap casket) get their resolver.
import { blockers, coverFrom, targetSamples } from './los'
import { damageDoor } from './board'
import { injuryFace, rollExpr, toxinPasses, woundNeed, d6TestPasses } from './dice'
import { markFired } from './code-hooks'
import { runHook } from './hooks'
import { inContact, refreshEngagement } from './measure'
import { afterInvoluntary, knockbackPush, slide, placeAlong } from './movement'
import { registerBlastPort, registerHitPort } from './ports'
import { stat, type StatVs } from './query'
import type { Ctx } from './registry'
import { ironManFlesh } from './skills/util'
import { constants, onBoard } from './state'
import { seriouslyInjure, takeOutOfAction } from './casualties'
import { setCondition, T } from './traits'
import { armourSave, extraSaves } from './wargear'
import { segmentCircleInterval, segmentPolygonIntervals } from './geometry'
import type { Fighter, GameState, RuntimeProfile, TraitRef, Vec2 } from './types'

export type DamageSpec = RuntimeProfile['dmg']

/** Everything one hit needs; built by shoot.ts (and fight.ts in S3b) or by a port. */
export interface HitInput {
  attackerId: string | null
  targetId: string
  weaponId: string | null
  strength: number
  ap: number
  damage: DamageSpec
  traits: readonly TraitRef[]
  /** the natural hit roll (Knockback compares it with the target's S); null when no hit roll was made */
  hitRoll: number | null
  /** the point Knockback pushes away from (the attacker, or the Blast centre) */
  knockFrom: Vec2 | null
  /** Melta applies (Short range or no Short range, R-11.11) */
  melta: boolean
  /** Blast or Template attack (flak armour, cover bonus) */
  saveVs: 'blast' | 'template' | null
  /** R-9.7 cover bonus to the save */
  coverBonus: number
  /** where the attack comes from for front-arc armour */
  from: Vec2 | null
  /** saves allowed */
  saves: boolean
  /** cause for the casualty log ('weapon id', 'door', 'casket', 'blaze', ...) */
  cause: string
  /** Shock on a natural 6 to hit: the hit wounds without a wound roll (R-14.3) */
  autoWound?: boolean
  /** extra Damage on the first wounding hit (Power on a natural 6) */
  extraDamage?: number
  /** a melee attacker that follows up a Knockback to stay in base contact (ruling: always, when in base contact) */
  followUp?: string | null
  /** a close combat attack (Iron Jaw, Dodge) */
  closeCombat?: boolean
}

const has = (h: HitInput, id: string) => h.traits.some((t) => t.trait === id)

function rollDamage(ctx: Ctx, dmg: DamageSpec): number {
  if (dmg.kind === 'none') return 0
  if (dmg.kind === 'fixed') return dmg.value
  return rollExpr(ctx, 'damage', dmg.expr)
}

// ---------------------------------------------------------------------------
// Pinning (R-8.7)
// ---------------------------------------------------------------------------

/** A Standing Active fighter hit by a ranged attack becomes Pinned at once; Engaged fighters never are. Returns true if pinned. */
export function pinTarget(ctx: Ctx, t: Fighter, by: string | null): boolean {
  if (t.location !== 'board' || t.posture !== 'standing' || t.engagedWith.length > 0) return false
  // a fighter that already avoided the Pin in this attack (Nerves of Steel) is not tested again by the same attack
  const attack = ctx.state.attack
  const tested = attack ? ((attack.data.pinTested as string[] | undefined) ?? (attack.data.pinTested = [])) : null
  if (tested?.includes(t.id)) return false
  const veto = runHook('pin.allowed', { seat: t.seat, state: ctx.state, engine: ctx, fighterId: t.id, ...(by ? { targetId: by } : {}) })
  if (veto.some((r) => r.allow === false)) {
    tested?.push(t.id)
    return false
  }
  t.posture = 'pinned'
  ctx.emit({ type: 'StatusChanged', fighterId: t.id, from: 'standing', to: 'pinned', reason: 'pinned' }, t.seat)
  ctx.emit({ type: 'FighterPinned', fighterId: t.id }, t.seat)
  return true
}

// ---------------------------------------------------------------------------
// Injury dice (R-11.7, R-11.8)
// ---------------------------------------------------------------------------

/** One Flesh Wound: -1 T for the battle; T 0 is Out of Action. */
export function fleshWound(ctx: Ctx, t: Fighter, by: string | null, cause: string): void {
  if (t.location !== 'board') return
  t.fleshWounds += 1
  const toughness = stat(ctx.state, t.id, 'T')
  ctx.emit({ type: 'FleshWound', fighterId: t.id, total: t.fleshWounds, toughness }, t.seat)
  // Iron Man: T is not lowered, but the fighter is Out of Action once its Flesh Wounds reach its Toughness
  const left = toughness - ironManFlesh(ctx.state, t)
  if (left <= 0) takeOutOfAction(ctx, t, by, 'fleshWounds')
}

/** The worse of two Injury results (Out of Action > Seriously Injured > Flesh Wound). */
const injurySeverity = (face: string): number => (face === 'fleshWound' ? 0 : face === 'seriouslyInjured' ? 1 : 2)

/** Apply the results of one roll of Injury dice (Out of Action first, then Seriously Injured, then Flesh Wounds). */
export function applyInjuries(ctx: Ctx, t: Fighter, results: readonly string[], by: string | null, cause: string): string {
  if (results.includes('outOfAction')) {
    takeOutOfAction(ctx, t, by, cause)
    return 'outOfAction'
  }
  let wounds = results.filter((r) => r === 'fleshWound').length
  const si = results.filter((r) => r === 'seriouslyInjured').length
  let applied = wounds > 0 ? 'fleshWound' : 'none'
  if (si > 0) {
    if (t.posture !== 'seriouslyInjured') {
      seriouslyInjure(ctx, t, by, cause)
      wounds += si - 1
      applied = 'seriouslyInjured'
    } else wounds += si
  }
  for (let i = 0; i < wounds && t.location === 'board'; i++) fleshWound(ctx, t, by, cause)
  if (t.location !== 'board') applied = 'outOfAction'
  return applied
}

type InjurySource = Pick<HitInput, 'attackerId' | 'cause' | 'melta' | 'weaponId'> & { traits?: readonly TraitRef[] }

/**
 * Roll `n` Injury dice together for one hit and apply them. Melta and Sever: every die is Out of Action, no roll (R-11.11).
 * Pulverise: after the roll a D6 >= the target's T (or a natural 6) turns one Flesh Wound into Seriously Injured (R-14.3).
 */
export function rollInjuries(ctx: Ctx, t: Fighter, n: number, h: InjurySource): void {
  let dice = n
  for (const r of runHook('injury.dice', { seat: t.seat, state: ctx.state, engine: ctx, fighterId: t.id, ...(h.attackerId ? { targetId: h.attackerId } : {}), data: { dice } })) {
    if (r.delta) dice += r.delta
  }
  // True Grit, Bio-booster: one die fewer; a single die becomes two dice of which the worse is discarded
  let discardWorst = false
  if (dice <= 0) {
    if (n <= 0 || dice === n) return
    dice = 2
    discardWorst = true
  }
  if (h.melta || h.traits?.some((x) => x.trait === T.sever)) {
    ctx.emit({ type: 'InjuryRolled', targetId: t.id, faces: Array.from({ length: dice }, () => 'outOfAction'), applied: 'outOfAction' }, t.seat)
    takeOutOfAction(ctx, t, h.attackerId, h.cause)
    return
  }
  const raw = ctx.roll('injury', dice, 'injury')
  const faces = raw.map((d) => injuryFace(ctx.state, d))
  const results = faces.slice()
  if (discardWorst) {
    const worst = results.reduce((w, f, i) => (injurySeverity(f) > injurySeverity(results[w]!) ? i : w), 0)
    results.splice(worst, 1)
  }
  if (h.traits?.some((x) => x.trait === T.pulverise) && results.includes('fleshWound')) {
    const roll = ctx.roll('pulverise', 1)[0]!
    if (roll === 6 || roll >= stat(ctx.state, t.id, 'T')) results[results.indexOf('fleshWound')] = 'seriouslyInjured'
  }
  runHook('injury.applied', { seat: t.seat, state: ctx.state, engine: ctx, fighterId: t.id, data: { results } })
  // emitted before the results apply so the client shows the dice first; `applied` is filled in once they have
  ctx.emit({ type: 'InjuryRolled', targetId: t.id, faces: faces.slice(), applied: '' }, t.seat)
  const ev = ctx.events[ctx.events.length - 1]!
  const applied = applyInjuries(ctx, t, results, h.attackerId, h.cause)
  if (ev.type === 'InjuryRolled') ev.applied = applied
}

/** Damage (R-11.7): each point removes a Wound; the point that reaches 0 and every further point is one Injury dice. */
export function applyDamage(ctx: Ctx, t: Fighter, amount: number, h: InjurySource): void {
  let dice = 0
  for (let i = 0; i < amount; i++) {
    if (t.wounds > 0) {
      t.wounds -= 1
      if (t.wounds === 0) dice += 1
    } else dice += 1
  }
  ctx.emit({ type: 'DamageInflicted', targetId: t.id, amount, wounds: t.wounds }, t.seat)
  if (dice > 0) rollInjuries(ctx, t, dice, h)
}

// ---------------------------------------------------------------------------
// Saves (R-11.3 to R-11.6)
// ---------------------------------------------------------------------------

/** The armour save, then the invulnerable saves a skill grants (Dodge, `save.extra`), which no "no save" rule can stop. */
function saveRoll(ctx: Ctx, t: Fighter, h: HitInput, ap: number, armour = true): boolean {
  if (h.saves && armour) {
    const info = armourSave(ctx.state, t, { ap, from: h.from, vs: h.saveVs, coverBonus: h.coverBonus })
    if (info.need !== null && info.need <= 6) {
      const roll = ctx.roll('save', 1)[0]!
      const saved = d6TestPasses(roll, info.need)
      ctx.emit({ type: 'SaveRolled', targetId: t.id, roll, need: info.need, saved, item: info.item }, t.seat)
      if (saved) return true
    }
  }
  for (const ex of extraSaves(ctx.state, t, { attackerId: h.attackerId, melee: !!h.closeCombat, vs: h.saveVs })) {
    const roll = ctx.roll(ex.item, 1)[0]!
    const saved = d6TestPasses(roll, ex.need)
    ctx.emit({ type: 'SaveRolled', targetId: t.id, roll, need: ex.need, saved, item: ex.item }, t.seat)
    if (saved) {
      markFired(ex.code)
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// One hit
// ---------------------------------------------------------------------------

/** What the target's Toughness is judged against for this hit (Iron Jaw, Respirator, Chem-synth). */
function statVs(h: HitInput): StatVs {
  return { attackerId: h.attackerId, melee: !!h.closeCombat, ap: h.ap, gas: has(h, T.gas), toxin: has(h, T.toxin) }
}

/** Resolve one hit on one fighter (R-11.1). Pinning is the caller's business (it happens before any wound roll). */
export function resolveHit(ctx: Ctx, h: HitInput): void {
  const s = ctx.state
  const t = s.fighters[h.targetId]
  if (!t || t.location !== 'board') return
  let bonusDamage = 0

  // Flash: no wound roll; an Initiative test or Blind (R-3.11)
  if (has(h, T.flash)) {
    const roll = ctx.roll('flash', 1)[0]!
    let modifier = 0
    for (const r of runHook('test.modify', { seat: t.seat, state: s, engine: ctx, fighterId: t.id, data: { test: 'initiative', reason: 'flash' } })) if (r.delta) modifier += r.delta
    const passed = d6TestPasses(roll, stat(s, t.id, 'I'), modifier)
    if (!passed) {
      const already = t.activatedThisRound || !t.ready
      setCondition(ctx, t, 'blind', 'flash', already ? { skipNextReady: true } : undefined)
      t.ready = false
    }
    afterHit(ctx, t, h)
    return
  }

  // Knockback (R-14.3): hit roll >= target S pushes 1" away; a blocked push adds 1 Damage
  if (has(h, T.knockback) && h.hitRoll !== null && h.knockFrom) {
    if (h.hitRoll >= stat(s, t.id, 'S')) {
      const k = constants(s).knockback
      const follower = h.followUp ? s.fighters[h.followUp] : undefined
      // a melee attacker in base contact (not across a barricade) follows up by the same vector (ruling: it always does)
      const follows = !!follower && follower.location === 'board' && inContact(follower, t)
      const push = knockbackPush(ctx, t, h.knockFrom, k.distance)
      if (push.blocked) bonusDamage += k.blockedDamageBonus
      if (follows && push.moved > 0) {
        const len = Math.hypot(push.shift.x, push.shift.z)
        const to = slide(s, follower, push.shift.x / len, push.shift.z / len, len)
        if (Math.hypot(to.x - follower.pos.x, to.z - follower.pos.z) > 0) placeAlong(ctx, follower, 'knockback', to, len)
      }
      afterInvoluntary(ctx, t, follows ? [follower.id] : [])
      refreshEngagement(ctx)
    }
  }

  if (has(h, T.gas) || has(h, T.toxin)) {
    // Gas / Toxin: D6 >= T (natural 6 always) causes one Injury dice without touching Wounds; Gas allows no save
    const toughness = stat(s, t.id, 'T', statVs(h))
    const purpose = has(h, T.gas) ? 'gas' : 'toxin'
    let roll = ctx.roll(purpose, 1)[0]!
    // Poison Blood: a natural 1 on the Toughness roll may be re-rolled (judged before modifiers)
    const again = { purpose, roll, reroll: false }
    const shooter = h.attackerId ? s.fighters[h.attackerId] : undefined
    if (shooter) runHook('attack.reroll', { seat: shooter.seat, state: s, engine: ctx, fighterId: shooter.id, targetId: t.id, data: again })
    if (again.reroll) roll = ctx.roll(`${purpose}Reroll`, 1)[0]!
    const passed = toxinPasses(roll, toughness)
    ctx.emit({ type: 'WoundRolled', targetId: t.id, roll, need: Math.max(2, Math.min(6, toughness)), wounded: passed }, t.seat)
    if (passed) {
      const saved = saveRoll(ctx, t, h, h.ap, !has(h, T.gas))
      if (!saved) {
        ctx.emit({ type: 'DamageInflicted', targetId: t.id, amount: 0, wounds: t.wounds }, t.seat)
        rollInjuries(ctx, t, 1, h)
      }
    }
    afterHit(ctx, t, h)
    return
  }

  // Scattershot: D6 wound rolls instead of one
  const woundRolls = has(h, T.scattershot) ? ctx.roll('scattershot', 1)[0]! : 1
  for (let i = 0; i < woundRolls && t.location === 'board'; i++) {
    const toughness = stat(s, t.id, 'T', statVs(h))
    if (h.autoWound) {
      // Shock: a natural 6 to hit wounds automatically
      ctx.emit({ type: 'WoundRolled', targetId: t.id, roll: 0, need: 0, wounded: true, auto: true }, t.seat)
      if (saveRoll(ctx, t, h, h.ap)) continue
      let amount = rollDamage(ctx, h.damage)
      if (h.damage.kind !== 'none') {
        amount += bonusDamage + (h.extraDamage ?? 0)
        bonusDamage = 0
        for (const r of runHook('damage.mods', { seat: t.seat, state: s, engine: ctx, fighterId: t.id, data: { amount } })) if (r.delta) amount += r.delta
        applyDamage(ctx, t, Math.max(0, amount), h)
      }
      continue
    }
    let need = woundNeed(h.strength, toughness)
    for (const r of runHook('wound.mods', { seat: t.seat, state: s, engine: ctx, fighterId: t.id, ...(h.attackerId ? { targetId: h.attackerId } : {}), data: { need } })) {
      if (r.delta) need -= r.delta
    }
    const roll = ctx.roll('wound', 1)[0]!
    const wounded = roll === 6 || (roll !== 1 && roll >= need)
    ctx.emit({ type: 'WoundRolled', targetId: t.id, roll, need, wounded }, t.seat)
    if (!wounded) continue
    const ap = has(h, T.shred) && roll === 6 ? h.ap * 2 : h.ap
    if (saveRoll(ctx, t, h, ap)) continue
    let amount = rollDamage(ctx, h.damage)
    if (h.damage.kind !== 'none') {
      if (has(h, T.rending) && roll === 6) amount += 1
      amount += bonusDamage + (i === 0 ? (h.extraDamage ?? 0) : 0)
      bonusDamage = 0
      for (const r of runHook('damage.mods', { seat: t.seat, state: s, engine: ctx, fighterId: t.id, data: { amount } })) if (r.delta) amount += r.delta
      applyDamage(ctx, t, Math.max(0, amount), h)
    }
  }
  afterHit(ctx, t, h)
}

/** Effects of being hit at all: Blaze (4+ unless Out of Action), Concussion. */
function afterHit(ctx: Ctx, t: Fighter, h: HitInput): void {
  if (t.location !== 'board') return
  if (has(h, T.blaze) && !t.conditions.blaze) {
    const roll = ctx.roll('blaze', 1)[0]!
    const k = Number.parseInt(String(constants(ctx.state).blaze.igniteOn), 10)
    if (roll >= k) {
      setCondition(ctx, t, 'blaze', h.cause)
      ctx.emit({ type: 'CaughtFire', targetId: t.id }, t.seat)
    }
  }
  if (has(h, T.concussion)) setCondition(ctx, t, 'concussion', h.cause)
}

// ---------------------------------------------------------------------------
// Blast markers (R-9.5)
// ---------------------------------------------------------------------------

function crossesSolid(state: GameState, a: Vec2, b: Vec2, smoke: boolean): boolean {
  for (const poly of blockers(state)) if (segmentPolygonIntervals(a, b, poly).length > 0) return true
  if (smoke) for (const sm of state.board.smoke) if (segmentCircleInterval(a, b, sm.pos, sm.radius)) return true
  return false
}

/** True when some line from `from` to the fighter's base crosses no wall or closed door (and no smoke when asked). */
export function reachableFrom(state: GameState, from: Vec2, f: Fighter, smoke = false): boolean {
  return targetSamples(f).some((p) => !crossesSolid(state, from, p, smoke))
}

/** Segment clear of walls and closed doors (and smoke when asked). */
export function segmentClear(state: GameState, a: Vec2, b: Vec2, smoke = false): boolean {
  return !crossesSolid(state, a, b, smoke)
}

/** Fighters any part of whose base is under a marker, without a wall or closed door between them and its centre; nearest first. */
export function fightersUnderBlast(state: GameState, centre: Vec2, radius: number): Fighter[] {
  return onBoard(state)
    .map((f) => ({ f, d: Math.hypot(f.pos.x - centre.x, f.pos.z - centre.z) }))
    .filter(({ f, d }) => d < radius + f.baseRadius - 1e-9 && reachableFrom(state, centre, f))
    .sort((a, b) => a.d - b.d || (a.f.id < b.f.id ? -1 : 1))
    .map(({ f }) => f)
}

export interface AvoidSpec {
  kind: 'blast' | 'template'
  /** the attacker, or null */
  by: string | null
  /** would the fighter's base, centred at the point, still be covered by the marker or template? */
  hitAt: (f: Fighter, pos: Vec2) => boolean
}

/**
 * Fighters that may step clear of a Blast marker or Template before it is decided whether they are hit (Dodge, the
 * `blast.victims` hook): returns the victims that are still under it.
 */
export function avoidArea(ctx: Ctx, victims: Fighter[], spec: AvoidSpec): Fighter[] {
  if (victims.length === 0) return victims
  const data = { ids: victims.map((f) => f.id), kind: spec.kind, hitAt: spec.hitAt }
  const by = spec.by ? ctx.state.fighters[spec.by] : undefined
  runHook('blast.victims', { seat: by?.seat ?? ctx.state.priority ?? 'A', state: ctx.state, engine: ctx, ...(by ? { fighterId: by.id } : {}), data })
  return victims.filter((f) => data.ids.includes(f.id))
}

export interface BlastHit {
  centre: Vec2
  radius: number
  /** builds the hit for one fighter (the caller knows the weapon) */
  make: (t: Fighter) => HitInput
  /** ranged attacks pin (Gas never does) */
  pins: boolean
  by: string | null
}

/**
 * Resolve a Blast marker: every fighter under it is hit (friends too), Pinned first, then each hit resolved nearest to the
 * centre first (ruling). Knockback rolls a D6 per fighter and pushes away from the centre; cover is judged from the centre.
 */
export function resolveBlastMarker(ctx: Ctx, b: BlastHit): string[] {
  const s = ctx.state
  const under = avoidArea(
    ctx,
    fightersUnderBlast(s, b.centre, b.radius),
    { kind: 'blast', by: b.by, hitAt: (g, p) => Math.hypot(p.x - b.centre.x, p.z - b.centre.z) < b.radius + g.baseRadius - 1e-9 },
  )
  const inputs = under.map((t) => ({ t, h: b.make(t) }))
  for (const { t, h } of inputs) if (b.pins && !has(h, T.gas)) pinTarget(ctx, t, b.by)
  for (const { t, h } of inputs) {
    if (t.location !== 'board') continue
    // the fighters whose bases hold the centre do not shield anyone from it
    const atCentre = under.filter((g) => Math.hypot(g.pos.x - b.centre.x, g.pos.z - b.centre.z) < g.baseRadius).map((g) => g.id)
    const cover = coverFrom(s, b.centre, t, undefined, atCentre).cover
    const k = constants(s).coverSave
    const coverBonus = cover === 'full' ? k.full : cover === 'partial' ? k.partial : 0
    let hitRoll = h.hitRoll
    if (has(h, T.knockback)) hitRoll = ctx.roll('knockback', 1)[0]!
    resolveHit(ctx, { ...h, hitRoll, knockFrom: b.centre, coverBonus, saveVs: 'blast', from: b.centre })
  }
  return under.map((f) => f.id)
}

// ---------------------------------------------------------------------------
// Doors (R-15.8)
// ---------------------------------------------------------------------------

/** A hit on a closed door: automatic hit, normal wound table against T5, no save, Damage off its 4 Wounds; at 0 it is gone. */
export function hitDoor(ctx: Ctx, doorId: string, strength: number, damage: DamageSpec, traits: readonly TraitRef[] = []): void {
  const s = ctx.state
  const rec = s.board.doors[doorId]
  if (!rec || rec.state !== 'closed') return
  const k = constants(s).door
  const need = woundNeed(strength, k.toughness)
  const roll = ctx.roll('woundDoor', 1)[0]!
  const wounded = roll === 6 || (roll !== 1 && roll >= need)
  ctx.emit({ type: 'WoundRolled', targetId: doorId, roll, need, wounded }, null)
  if (!wounded) return
  let amount = rollDamage(ctx, damage)
  if (traits.some((t) => t.trait === T.rending) && roll === 6) amount += 1
  if (amount <= 0) return
  const { doors, destroyed } = damageDoor(s.board.doors, doorId, amount, k.wounds)
  s.board.doors = doors
  const now = s.board.doors[doorId]!
  ctx.emit({ type: 'DoorDamaged', doorId, wounds: Math.max(0, k.wounds - now.wounds) }, null)
  if (destroyed) ctx.emit({ type: 'DoorChanged', doorId, state: 'destroyed', locked: now.locked }, null)
}

// ---------------------------------------------------------------------------
// Ports from S2 (door closing on a fighter, frag-trap casket)
// ---------------------------------------------------------------------------

function portInput(targetId: string, spec: { strength: number; ap: number; damage: number; source: string; saves?: boolean; knockback?: boolean }): HitInput {
  return {
    attackerId: null,
    targetId,
    weaponId: null,
    strength: spec.strength,
    ap: spec.ap,
    damage: { kind: 'fixed', value: spec.damage },
    traits: spec.knockback ? [{ trait: T.knockback }] : [],
    hitRoll: null,
    knockFrom: null,
    melta: false,
    saveVs: null,
    coverBonus: 0,
    from: null,
    saves: spec.saves !== false,
    cause: spec.source,
  }
}

/** Register the real resolvers on the S2 ports (done at load; tests that swap in a spy call this to restore them). */
export function installAttackPorts(): void {
  registerHitPort((ctx, spec) => resolveHit(ctx, portInput(spec.targetId, spec)))
  registerBlastPort((ctx, spec) => {
    resolveBlastMarker(ctx, { centre: spec.centre, radius: spec.radius, pins: true, by: null, make: (t) => portInput(t.id, spec) })
  })
}

installAttackPorts()
