// Weapon -> effect family. The family says which recipe draws the shot (tracers, plasma bolt, flame stream, rocket, thrown knives,
// blade sweep, bash) and the variant which look within it. The weapon's data flavour (stub, las, bolter, flamer, plasma, melta,
// grenade, chain, blade, maul, whip, crush) picks the family; its class (pistol / heavy ...) and traits (rapid-fire, power,
// unwieldy, krak) pick the variant. A short override table holds the few weapons whose look differs from their flavour (the
// bows throw, the shotguns are not rapid-fire). `vfxOf` never throws.
import type { GameState } from '@/engine'
import { flavourOf } from '../weaponFlavour'

export type VfxFamily = 'bolt' | 'plasma' | 'flame' | 'explosive' | 'slugga' | 'shokka' | 'harpoon' | 'knives' | 'blade' | 'crush'

export const VFX_FAMILIES: readonly VfxFamily[] = ['bolt', 'plasma', 'flame', 'explosive', 'slugga', 'shokka', 'harpoon', 'knives', 'blade', 'crush']

export const MELEE_FAMILIES: ReadonlySet<VfxFamily> = new Set<VfxFamily>(['blade', 'crush'])
export const isMeleeFamily = (f: VfxFamily): boolean => MELEE_FAMILIES.has(f)

export interface WeaponVfx {
  family: VfxFamily
  /** look within the family: 'rifle' | 'auto' | 'pistol' | 'heavy' | 'las' | 'standard' | 'supercharge' | 'frag' | 'krak' | 'rokkit' | 'chain' | 'power' | ... */
  variant: string
}

const w = (family: VfxFamily, variant: string): WeaponVfx => ({ family, variant })

/** Weapons whose look is not what their flavour and class give; `<weapon id>#<profile id>` beats the plain id. */
export const WEAPON_VFX: Record<string, WeaponVfx> = {
  'core.w.shotgun': w('slugga', 'slugga'),
  'gol.w.combat-shotgun': w('slugga', 'slugga'),
  'gol.w.krumper-rivet-cannon': w('slugga', 'dakka'),
  'gol.w.missile-launcher': w('explosive', 'rokkit'),
  'gol.w.multi-melta': w('plasma', 'supercharge'),
  'esc.w.wyld-bow': w('knives', 'knives'),
  'esc.w.wyld-bow.poison': w('knives', 'knives'),
  'esc.w.wyld-bow.explosive': w('knives', 'knives'),
  'esc.w.wyld-bow.acid': w('knives', 'knives'),
  'esc.w.needle-pistol': w('bolt', 'pistol'),
  'esc.w.needle-rifle': w('bolt', 'stalker'),
  'esc.w.plasma-pistol#max': w('plasma', 'supercharge'),
  'esc.w.plasma-gun#max': w('plasma', 'supercharge'),
  'esc.w.plasma-cannon#max': w('plasma', 'supercharge'),
}

interface WeaponFacts {
  cls: string
  traits: ReadonlySet<string>
}

function factsOf(state: GameState | null, weaponId: string, profileId: string | null | undefined): WeaponFacts {
  const weapon = state?.data?.weapons?.[weaponId]
  const profiles = weapon ? (profileId ? weapon.profiles.filter((p) => p.id === profileId) : weapon.profiles) : []
  const traits = new Set<string>()
  for (const p of profiles) for (const t of p.traits) traits.add(t.trait.replace(/^core\.t\./, ''))
  return { cls: weapon?.class ?? 'basic', traits }
}

/** The effect family and look of a weapon (and the profile it fires). */
export function vfxOf(state: GameState | null, weaponId: string | null | undefined, profileId?: string | null): WeaponVfx {
  if (!weaponId) return w('crush', 'fists')
  const hit = (profileId ? WEAPON_VFX[`${weaponId}#${profileId}`] : undefined) ?? WEAPON_VFX[weaponId]
  if (hit) return hit
  const { cls, traits } = factsOf(state, weaponId, profileId)
  const id = weaponId.toLowerCase()
  switch (flavourOf(state, weaponId)) {
    case 'stub':
      return cls === 'heavy' ? w('slugga', 'bigShoota') : traits.has('rapid-fire') ? w('slugga', 'dakka') : w('slugga', 'slugga')
    case 'las':
      return w('bolt', 'las')
    case 'bolter':
      return cls === 'pistol' ? w('bolt', 'pistol') : cls === 'heavy' ? w('bolt', 'heavy') : traits.has('rapid-fire') ? w('bolt', 'auto') : w('bolt', 'rifle')
    case 'flamer':
      return w('flame', cls === 'pistol' ? 'hand' : 'burna')
    case 'plasma':
      return w('plasma', profileId === 'max' ? 'supercharge' : 'standard')
    case 'melta':
      return w('plasma', 'supercharge')
    case 'grenade':
      if (/missile|rokkit/.test(id)) return w('explosive', 'rokkit')
      if (/krak/.test(id) || profileId === 'krak' || (!traits.has('blast') && traits.has('grenade'))) return w('explosive', 'krak')
      return w('explosive', 'frag')
    case 'chain':
      return w('blade', 'chain')
    case 'blade':
      return w('blade', traits.has('power') ? 'power' : traits.has('paired') ? 'twin' : traits.has('unwieldy') ? 'big' : /knife|stiletto/.test(id) ? 'grot' : 'choppa')
    case 'whip':
      return w('blade', 'choppa')
    case 'maul':
      return w('crush', traits.has('power') ? 'thunder' : 'fist')
    default:
      return w('crush', 'fist')
  }
}

/** Effect layers every family must provide (checked against the recipes in tests/client/vfx.test.ts). */
export type FxLayer =
  | 'muzzle'
  | 'projectile'
  | 'trail'
  | 'impact'
  | 'miss'
  | 'flesh'
  | 'stream'
  | 'burning'
  | 'explosion'
  | 'shockwave'
  | 'debris'
  | 'dust'
  | 'scorch'
  | 'shake'
  | 'arc'
  | 'mark'
  | 'light'

export const REQUIRED_LAYERS: Record<VfxFamily, readonly FxLayer[]> = {
  bolt: ['muzzle', 'projectile', 'impact', 'miss', 'flesh'],
  plasma: ['muzzle', 'projectile', 'trail', 'impact', 'light'],
  flame: ['muzzle', 'stream', 'impact', 'burning', 'light'],
  explosive: ['projectile', 'trail', 'explosion', 'shockwave', 'debris', 'dust', 'scorch', 'shake', 'light'],
  slugga: ['muzzle', 'projectile', 'impact', 'miss'],
  shokka: ['muzzle', 'arc', 'impact'],
  harpoon: ['muzzle', 'projectile', 'impact'],
  knives: ['projectile', 'impact', 'miss'],
  blade: ['arc', 'impact', 'mark'],
  crush: ['impact', 'mark', 'shockwave', 'dust', 'shake'],
}

/** Kill animation by family: slump, burn down, knocked back, topple. */
export type DeathStyle = 'slump' | 'burn' | 'blast' | 'topple'
export function deathStyleFor(family: VfxFamily): DeathStyle {
  switch (family) {
    case 'bolt':
    case 'slugga':
    case 'harpoon':
    case 'knives':
      return 'slump'
    case 'flame':
      return 'burn'
    case 'explosive':
    case 'plasma':
    case 'shokka':
      return 'blast'
    default:
      return 'topple'
  }
}
