// Weapon traits (R-14.2, R-14.3). S3a holds the shooting traits: Blast, Template, Rapid Fire, Knockback, Gas, Toxin, Flash,
// Smoke, Melta, Plentiful, Scarce, Single Shot, Limited, Unstable, Grenade, Scattershot, Shred, Rending, Blaze, Concussion,
// Sidearm, Unwieldy, Silent. Most of them are read where the sequence needs them (shoot.ts, hits.ts) through the helpers
// below; the ones with a lifetime of their own (Concussion until the end of the round, Smoke clouds in the End phase,
// Blind until the next activation) are hook handlers installed here. S3b adds the close-combat traits: Parry, Power, Shock,
// Disarm, Entangle, Versatile, Paired and Backstab are read by fight.ts through the helpers below, Pulverise and Sever by
// hits.ts; Disarm's "rest of the round" is the `disarmed` condition, cleared at the end of the round here.
import { registerHook } from './hooks'
import { constants, getFighter } from './state'
import type { Ctx } from './registry'
import type { Fighter, GameState, RuntimeProfile, TraitRef } from './types'

export const T = {
  blast: 'core.t.blast',
  template: 'core.t.template',
  rapidFire: 'core.t.rapid-fire',
  knockback: 'core.t.knockback',
  gas: 'core.t.gas',
  toxin: 'core.t.toxin',
  flash: 'core.t.flash',
  smoke: 'core.t.smoke',
  melta: 'core.t.melta',
  plentiful: 'core.t.plentiful',
  scarce: 'core.t.scarce',
  singleShot: 'core.t.single-shot',
  limited: 'core.t.limited',
  unstable: 'core.t.unstable',
  grenade: 'core.t.grenade',
  scattershot: 'core.t.scattershot',
  shred: 'core.t.shred',
  rending: 'core.t.rending',
  blaze: 'core.t.blaze',
  concussion: 'core.t.concussion',
  sidearm: 'core.t.sidearm',
  unwieldy: 'core.t.unwieldy',
  silent: 'core.t.silent',
  melee: 'core.t.melee',
  versatile: 'core.t.versatile',
  parry: 'core.t.parry',
  power: 'core.t.power',
  shock: 'core.t.shock',
  disarm: 'core.t.disarm',
  entangle: 'core.t.entangle',
  paired: 'core.t.paired',
  backstab: 'core.t.backstab',
  pulverise: 'core.t.pulverise',
  sever: 'core.t.sever',
} as const

/** Traits whose rules the engine knows (S3a shooting set + S3b close-combat set, which are inert at range). */
const KNOWN: ReadonlySet<string> = new Set(Object.values(T))

type HasTraits = { traits: readonly TraitRef[] }

export function hasTrait(p: HasTraits, id: string): boolean {
  return p.traits.some((t) => t.trait === id)
}

export function traitOf(p: HasTraits, id: string): TraitRef | undefined {
  return p.traits.find((t) => t.trait === id)
}

/** R-16.2: a profile with a trait the engine does not implement is never offered. */
export function profileImplemented(state: GameState, p: HasTraits): boolean {
  return p.traits.every((t) => KNOWN.has(t.trait) && state.data.traits[t.trait]?.implemented !== false)
}

/** Rapid Fire (X): the number of Firepower dice after a hit (0 = not Rapid Fire). */
export function rapidFire(p: HasTraits): number {
  const t = traitOf(p, T.rapidFire)
  return t ? Math.max(1, t.x ?? 1) : 0
}

/** Blast (X"): the marker radius (half the printed diameter), or null. */
export function blastRadius(p: HasTraits): number | null {
  const t = traitOf(p, T.blast)
  if (!t) return null
  return (t.inches ?? t.x ?? 3) / 2
}

export function isTemplate(p: RuntimeProfile): boolean {
  return p.range.long === 'T' || hasTrait(p, T.template)
}

/** A profile used by Shoot: anything but an engaged-only ('E') melee profile; a Versatile reach is not a range (R-14.3). */
export function isRangedProfile(p: RuntimeProfile): boolean {
  if (p.range.long === 'E') return false
  if (hasTrait(p, T.versatile)) return false
  return true
}

/** A profile usable in close combat (R-10.3): Melee or Sidearm, an engaged-only ('E') profile, or a Versatile reach. */
export function isMeleeProfile(p: RuntimeProfile): boolean {
  return p.range.long === 'E' || hasTrait(p, T.melee) || hasTrait(p, T.sidearm) || hasTrait(p, T.versatile)
}

/** Versatile (R-14.3): the reach in inches (the profile's Long range), or null. */
export function versatileReach(p: RuntimeProfile): number | null {
  if (!hasTrait(p, T.versatile)) return null
  return typeof p.range.long === 'number' ? p.range.long : null
}

/** Short and Long range in inches for this wielder (Grenade: Long = S x multiplier, no Short; Template: none). */
export function profileRanges(p: RuntimeProfile, wielderS: number): { short: number | null; long: number | null } {
  const long = p.range.long
  if (long === 'T' || long === 'E') return { short: null, long: null }
  if (typeof long === 'object') return { short: null, long: wielderS * long.strMultiplier }
  return { short: hasTrait(p, T.grenade) ? null : p.range.short, long }
}

/** Weapon Strength for this wielder ('S+n' adds to the wielder's printed-plus-modifiers S). */
export function profileStrength(p: RuntimeProfile, wielderS: number): number {
  return p.str.base === 'user' ? wielderS + p.str.value : p.str.value
}

/**
 * Firepower dice an attack rolls (R-8.9, R-14.3): Rapid Fire X rolls X; any other weapon with an Ammo value rolls one;
 * Ammo '-' rolls none; Grenades roll none (an automatic Ammo test instead); Single Shot rolls none unless also Rapid Fire.
 */
export function firepowerDice(p: RuntimeProfile): number {
  if (p.ammo === null) return 0
  const rf = rapidFire(p)
  if (rf > 0) return rf
  if (hasTrait(p, T.grenade) || hasTrait(p, T.singleShot)) return 0
  return 1
}

/** Melta applies at Short range, or at any range if the weapon has no Short range (R-11.11). */
export function meltaApplies(p: RuntimeProfile, distance: number, short: number | null): boolean {
  if (!hasTrait(p, T.melta)) return false
  return short === null || distance <= short + 1e-9
}

/** Profiles that roll no wound (Gas, Toxin, Flash) or make no hit at all (Smoke). */
export function makesWoundRoll(p: RuntimeProfile): boolean {
  return !hasTrait(p, T.gas) && !hasTrait(p, T.toxin) && !hasTrait(p, T.flash) && !hasTrait(p, T.smoke)
}

// ---------------------------------------------------------------------------
// Conditions with a lifetime (hook handlers)
// ---------------------------------------------------------------------------

export function clearCondition(ctx: Ctx, f: Fighter, condition: string, reason: string): void {
  if (!f.conditions[condition]) return
  delete f.conditions[condition]
  ctx.emit({ type: 'ConditionChanged', fighterId: f.id, condition, on: false, reason }, f.seat)
}

/** Put a condition on a fighter (no-op when it already has it). */
export function setCondition(ctx: Ctx, f: Fighter, condition: string, reason: string, data?: Record<string, unknown>): boolean {
  if (f.conditions[condition]) return false
  f.conditions[condition] = { since: ctx.state.round, source: reason, ...(data ? { data } : {}) }
  ctx.emit({ type: 'ConditionChanged', fighterId: f.id, condition, on: true, reason }, f.seat)
  return true
}

/** Smoke clouds (R-14.3): in each End phase roll a D6 per cloud, removed on 1-4. Called by the phase.end hook below, which the End phase runs in its clean-up step (after the Rally tests). */
export function clearSmoke(ctx: Ctx): void {
  const s = ctx.state
  const k = constants(s).smoke
  const keep: GameState['board']['smoke'] = []
  for (const cloud of s.board.smoke) {
    const roll = ctx.roll('smokeClear', 1)[0]!
    if (roll <= k.clearOnAtMost) ctx.emit({ type: 'SmokeCleared', smokeId: cloud.id }, null)
    else keep.push(cloud)
  }
  s.board.smoke = keep
}

/** Install the trait hook handlers (idempotent: fixed ids replace earlier registrations). */
export function installTraitHooks(): void {
  // Concussion lasts until the end of the round (R-3.12)
  registerHook(
    'round.end',
    (h) => {
      const ctx = h.engine
      if (!ctx) return null
      for (const f of Object.values(ctx.state.fighters)) clearCondition(ctx, f, 'concussion', 'roundEnd')
      return null
    },
    'trait.concussion.expire',
  )
  // Smoke clouds roll to clear in the End phase (R-5.7 clean-up)
  registerHook(
    'phase.end',
    (h) => {
      const ctx = h.engine
      if (!ctx || h.data?.name !== 'end' || ctx.state.board.smoke.length === 0) return null
      clearSmoke(ctx)
      return null
    },
    'trait.smoke.clear',
  )
  // Disarm lasts for the rest of the round (R-14.3)
  registerHook(
    'round.end',
    (h) => {
      const ctx = h.engine
      if (!ctx) return null
      for (const f of Object.values(ctx.state.fighters)) clearCondition(ctx, f, 'disarmed', 'roundEnd')
      return null
    },
    'trait.disarm.expire',
  )
  // Blind lasts until the fighter's next activation (R-3.11)
  registerHook(
    'activation.start',
    (h) => {
      const ctx = h.engine
      if (!ctx || !h.fighterId) return null
      const f = getFighter(ctx.state, h.fighterId)
      if (f.conditions.blind && !f.conditions.blind.data?.skipNextReady) clearCondition(ctx, f, 'blind', 'activated')
      return null
    },
    'trait.blind.expire',
  )
}

installTraitHooks()
