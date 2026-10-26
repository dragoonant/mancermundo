// Attack fixtures (S3a): the synthetic test bundle with the real special-dice faces (core/dice.json), a small armoury of
// trait weapons and armour for the shooting and hit tests, the hand-built boards, and helpers that strip a game down to the
// fighters a rules test names, give them an exact loadout, and run the engine's hit code directly on a draft.
import type { EngineBundle } from '@/engine/bundle'
import { createCtx, type Ctx } from '@/engine/registry'
import { cloneState } from '@/engine/state'
import { ScriptedRng } from '@/engine/rng'
import type { GameState, RuntimeProfile, RuntimeTrait, RuntimeWargear, RuntimeWeapon, TraitRef } from '@/engine/types'
import diceJson from '@/data/core/dice.json'
import { barricadePair, corridorWithDoor, ductwayWall, openBox } from './boards'
import { testBundle } from './gang'
import { activate, edit, place, startGame, type Spot } from './helpers'

const TRAIT_IDS = [
  'blast', 'template', 'rapid-fire', 'knockback', 'gas', 'toxin', 'flash', 'smoke', 'melta', 'plentiful', 'scarce', 'single-shot',
  'limited', 'unstable', 'grenade', 'scattershot', 'shred', 'rending', 'blaze', 'concussion', 'sidearm', 'unwieldy', 'silent', 'parry',
]
const traits: RuntimeTrait[] = TRAIT_IDS.map((t) => ({ id: `core.t.${t}`, name: t, param: t === 'rapid-fire' ? 'count' : t === 'blast' ? 'inches' : 'none', implemented: true }))

const fixed = (value: number) => ({ kind: 'fixed' as const, value })
const tr = (...names: (string | [string, Partial<TraitRef>])[]): TraitRef[] =>
  names.map((n) => (typeof n === 'string' ? { trait: `core.t.${n}` } : { trait: `core.t.${n[0]}`, ...n[1] }))

function gun(id: string, p: Partial<RuntimeProfile> & { traits?: TraitRef[] }, profiles?: RuntimeProfile[]): RuntimeWeapon {
  const base: RuntimeProfile = {
    id: 'std',
    name: null,
    range: { short: 12, long: 24 },
    acc: { short: null, long: null },
    str: { base: 'fixed', value: 3 },
    ap: 0,
    dmg: fixed(1),
    ammo: null,
    traits: [],
    ...p,
  }
  return { id, name: id, class: 'basic', cost: 0, flavour: 'stub', profiles: profiles ?? [base] }
}

/** Trait weapons; `ammo: null` unless a test needs Firepower dice, so most scripts hold only the dice the rule rolls. */
export const ATTACK_WEAPONS: RuntimeWeapon[] = [
  gun('atk.w.plain', {}),
  gun('atk.w.rf2', { str: { base: 'fixed', value: 4 }, ammo: 4, traits: tr(['rapid-fire', { x: 2 }]) }),
  gun('atk.w.knock', { traits: tr('knockback') }),
  gun('atk.w.gas', { str: { base: 'fixed', value: 0 }, dmg: { kind: 'none' }, traits: tr('gas') }),
  gun('atk.w.toxin', { str: { base: 'fixed', value: 0 }, dmg: { kind: 'none' }, traits: tr('toxin') }),
  gun('atk.w.melta', { range: { short: 6, long: 12 }, str: { base: 'fixed', value: 8 }, ap: -4, dmg: fixed(3), traits: tr('melta') }),
  gun('atk.w.blaze', { traits: tr('blaze') }),
  gun('atk.w.flash', { str: { base: 'fixed', value: 0 }, dmg: { kind: 'none' }, traits: tr('flash') }),
  gun('atk.w.concussion', { traits: tr('concussion') }),
  gun('atk.w.smoke', { str: { base: 'fixed', value: 0 }, dmg: { kind: 'none' }, traits: tr(['blast', { inches: 5 }], 'smoke') }),
  gun('atk.w.blast5', { range: { short: null, long: 24 }, traits: tr(['blast', { inches: 5 }]) }),
  gun('atk.w.frag', { range: { short: null, long: 24 }, traits: tr(['blast', { inches: 3 }], 'knockback') }),
  gun('atk.w.scarce', { ammo: 4, traits: tr('scarce') }),
  gun('atk.w.plentiful', { ammo: 4, traits: tr('plentiful') }),
  gun('atk.w.unstable', { ammo: 4, traits: tr('unstable') }),
  gun('atk.w.single', { ammo: 4, traits: tr('single-shot') }),
  gun('atk.w.limited', { ammo: 4, traits: tr('limited') }),
  gun('atk.w.scatter', { traits: tr('scattershot') }),
  gun('atk.w.shred', { ap: -1, traits: tr('shred') }),
  gun('atk.w.rending', { traits: tr('rending') }),
  gun('atk.w.heavy', { traits: tr('unwieldy') }),
  gun('atk.w.side1', { range: { short: 6, long: 12 }, traits: tr('sidearm') }),
  gun('atk.w.side2', { range: { short: 6, long: 12 }, traits: tr('sidearm') }),
  {
    ...gun('atk.w.grenade', {}),
    class: 'grenade',
    profiles: [{ id: 'std', name: null, range: { short: null, long: { strMultiplier: 3 } }, acc: { short: null, long: null }, str: { base: 'fixed', value: 3 }, ap: 0, dmg: fixed(1), ammo: 4, traits: tr(['blast', { inches: 3 }], 'grenade') }],
  },
  gun('atk.w.dual', {}, [
    { id: 'a', name: 'a', range: { short: 12, long: 24 }, acc: { short: null, long: null }, str: { base: 'fixed', value: 3 }, ap: 0, dmg: fixed(1), ammo: 5, traits: [] },
    { id: 'b', name: 'b', range: { short: 6, long: 12 }, acc: { short: null, long: null }, str: { base: 'fixed', value: 5 }, ap: -1, dmg: fixed(1), ammo: 5, traits: [] },
  ]),
]

export const ATTACK_WARGEAR: RuntimeWargear[] = [
  { id: 'atk.g.flak', name: 'Flak', kind: 'armour', cost: 0, save: 6, saveMods: [{ vs: 'blast', value: 1 }, { vs: 'template', value: 1 }] },
  { id: 'atk.g.carapace', name: 'Carapace', kind: 'armour', cost: 0, save: 4 },
  { id: 'atk.g.great', name: 'Great armour', kind: 'armour', cost: 0, save: 2 },
  { id: 'atk.g.plates', name: 'Plates', kind: 'armour', cost: 0, save: 6, saveMods: [{ vs: 'front', value: 1 }] },
  { id: 'atk.g.undersuit', name: 'Undersuit', kind: 'equipment', cost: 0, effect: { modifySave: { value: 1 } } },
]

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((r) => [r.id, r]))

/** The test bundle with the real Firepower / Injury / Scatter faces, the attack armoury and the hand-built boards. */
export const attackBundle: EngineBundle = {
  ...testBundle,
  traits: { ...testBundle.traits, ...byId(traits) },
  weapons: { ...testBundle.weapons, ...byId(ATTACK_WEAPONS) },
  wargear: { ...testBundle.wargear, ...byId(ATTACK_WARGEAR) },
  dice: {
    firepower: diceJson.firepower.faces.map((f) => (f.hits === 1 && f.ammo ? 'hit1+ammo' : `hit${f.hits}`)),
    injury: diceJson.injury.faces.map((f) => f.result),
    scatter: diceJson.scatter.faces.map((f) => f.kind),
  },
  boards: { ...testBundle.boards, ...byId([openBox(), corridorWithDoor(), barricadePair(), ductwayWall()]) },
}

/**
 * A game in A's first activation choice: only the named fighters stay on the board (the rest go to reserve), at the given
 * spots; the whole armoury is in the snapshot so `loadout` can hand out any attack weapon. `active` is activated.
 */
export function shootingGame(opts: { board?: string; spots: Record<string, Spot>; active?: string; loadouts?: Record<string, { weapons?: string[]; wargear?: string[] }> }): GameState {
  const first = startGame({ bundle: attackBundle, setup: { boardId: opts.board ?? 'test.board' } }).state
  let s = edit(first, (d) => {
    d.data = { ...d.data, weapons: attackBundle.weapons, wargear: attackBundle.wargear, traits: attackBundle.traits }
    for (const f of Object.values(d.fighters)) if (!(f.id in opts.spots)) f.location = 'reserve'
    for (const [id, l] of Object.entries(opts.loadouts ?? {})) {
      const f = d.fighters[id]!
      if (l.weapons) f.weapons = l.weapons.map((weaponId) => ({ weaponId, ammo: 'ok' as const, lostProfiles: [] }))
      if (l.wargear) f.wargear = l.wargear.slice()
    }
  })
  s = place(s, opts.spots)
  if (opts.active) s = activate(s, opts.active).state
  return s
}

/** A draft and a step context over scripted dice, to run hit code directly (the draft is the ctx state). */
export function hitCtx(state: GameState, dice: number[]): { ctx: Ctx; rng: ScriptedRng } {
  const rng = new ScriptedRng(dice)
  const ctx = createCtx(cloneState(state), rng, null, state.seq)
  return { ctx, rng }
}

export const dice = (...v: number[]) => new ScriptedRng(v)
