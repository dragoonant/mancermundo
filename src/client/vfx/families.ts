// Weapon id -> effect family. Finer than the audio / hold `WeaponFlavour` (the shokka pistol, the harpoon and the
// throwing knives get their own looks), explicit for every weapon of both teams and the core grenades; a test
// fails when a weapon in the data has no entry. `vfxOf` classifies an unknown id by its flavour as a safety net.
import { flavourOf } from '../weaponFlavour'

export type VfxFamily = 'bolt' | 'plasma' | 'flame' | 'explosive' | 'slugga' | 'shokka' | 'harpoon' | 'knives' | 'blade' | 'crush'

export const VFX_FAMILIES: readonly VfxFamily[] = ['bolt', 'plasma', 'flame', 'explosive', 'slugga', 'shokka', 'harpoon', 'knives', 'blade', 'crush']

export const MELEE_FAMILIES: ReadonlySet<VfxFamily> = new Set<VfxFamily>(['blade', 'crush'])
export const isMeleeFamily = (f: VfxFamily): boolean => MELEE_FAMILIES.has(f)

export interface WeaponVfx {
  family: VfxFamily
  /** look within the family: 'rifle' | 'auto' | 'pistol' | 'heavyPistol' | 'stalker' | 'heavy' | 'sniper' | ... */
  variant: string
}

const w = (family: VfxFamily, variant: string): WeaponVfx => ({ family, variant })

export const WEAPON_VFX: Record<string, WeaponVfx> = {
  // Angels of Death
  'aod.w.hand-flamer': w('flame', 'hand'),
  'aod.w.heavy-bolt-pistol': w('bolt', 'heavyPistol'),
  'aod.w.plasma-pistol-standard': w('plasma', 'standard'),
  'aod.w.plasma-pistol-supercharge': w('plasma', 'supercharge'),
  'aod.w.auto-bolt-rifle': w('bolt', 'auto'),
  'aod.w.bolt-rifle': w('bolt', 'rifle'),
  'aod.w.stalker-bolt-rifle-heavy': w('bolt', 'stalker'),
  'aod.w.stalker-bolt-rifle-mobile': w('bolt', 'stalker'),
  'aod.w.aux-grenade-launcher-frag': w('explosive', 'frag'),
  'aod.w.aux-grenade-launcher-krak': w('explosive', 'krak'),
  'aod.w.bolt-pistol': w('bolt', 'pistol'),
  'aod.w.heavy-bolter-focused': w('bolt', 'heavy'),
  'aod.w.heavy-bolter-sweeping': w('bolt', 'heavy'),
  'aod.w.bolt-sniper-rifle-executioner': w('bolt', 'sniper'),
  'aod.w.bolt-sniper-rifle-hyperfrag': w('bolt', 'sniper'),
  'aod.w.bolt-sniper-rifle-mortis': w('bolt', 'sniper'),
  'aod.w.chainsword-assault': w('blade', 'chain'),
  'aod.w.chainsword-intercessor': w('blade', 'chain'),
  'aod.w.power-fist-assault': w('crush', 'fist'),
  'aod.w.power-fist-captain': w('crush', 'fist'),
  'aod.w.power-fist-intercessor': w('crush', 'fist'),
  'aod.w.power-weapon-assault': w('blade', 'power'),
  'aod.w.power-weapon-intercessor': w('blade', 'power'),
  'aod.w.thunder-hammer-assault': w('crush', 'thunder'),
  'aod.w.thunder-hammer-intercessor': w('crush', 'thunder'),
  'aod.w.fists': w('crush', 'fists'),
  // Kommandos
  'kom.w.slugga': w('slugga', 'slugga'),
  'kom.w.choppa': w('blade', 'choppa'),
  'kom.w.big-choppa': w('blade', 'big'),
  'kom.w.power-klaw': w('crush', 'klaw'),
  'kom.w.explosives': w('explosive', 'boom'),
  'kom.w.bite': w('crush', 'bite'),
  'kom.w.breacha-ram': w('crush', 'ram'),
  'kom.w.burna-standard': w('flame', 'burna'),
  'kom.w.burna-deluge': w('flame', 'deluge'),
  'kom.w.shokka-pistol': w('shokka', 'shokka'),
  'kom.w.dakka-shoota-short': w('slugga', 'dakka'),
  'kom.w.dakka-shoota-long': w('slugga', 'dakka'),
  'kom.w.rokkit-launcha-aimed': w('explosive', 'rokkit'),
  'kom.w.rokkit-launcha-mobile': w('explosive', 'rokkit'),
  'kom.w.scoped-big-shoota-concealed': w('slugga', 'bigShoota'),
  'kom.w.scoped-big-shoota-stationary': w('slugga', 'bigShoota'),
  'kom.w.scoped-big-shoota-sweeping': w('slugga', 'bigShoota'),
  'kom.w.throwing-knives': w('knives', 'knives'),
  'kom.w.twin-choppas': w('blade', 'twin'),
  'kom.w.grot-choppa': w('blade', 'grot'),
  'kom.w.fists': w('crush', 'fists'),
  'kom.w.choppas-equipment': w('blade', 'choppa'),
  'kom.w.dynamite': w('explosive', 'dynamite'),
  'kom.w.harpoon': w('harpoon', 'harpoon'),
  // Core
  'core.w.frag-grenade': w('explosive', 'frag'),
  'core.w.krak-grenade': w('explosive', 'krak'),
}

/** The effect family of a weapon: the explicit entry, else a best guess from the flavour / id. Never throws. */
export function vfxOf(weaponId: string | null | undefined): WeaponVfx {
  if (!weaponId) return w('crush', 'fists')
  const hit = WEAPON_VFX[weaponId]
  if (hit) return hit
  const t = weaponId.toLowerCase()
  if (/shokka/.test(t)) return w('shokka', 'shokka')
  if (/harpoon/.test(t)) return w('harpoon', 'harpoon')
  if (/knife|knives/.test(t)) return w('knives', 'knives')
  switch (flavourOf(weaponId)) {
    case 'bolter':
      return w('bolt', 'rifle')
    case 'slugga':
      return w('slugga', 'slugga')
    case 'flamer':
      return w('flame', 'burna')
    case 'plasma':
      return w('plasma', 'standard')
    case 'rokkit':
      return w('explosive', 'rokkit')
    case 'chain':
      return w('blade', 'chain')
    case 'blade':
      return w('blade', 'choppa')
    case 'bite':
      return w('crush', 'bite')
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
