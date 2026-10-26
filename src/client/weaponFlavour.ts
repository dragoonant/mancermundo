// One classification of "what does this weapon look and sound like", shared by audio, vfx and the figure stand-ins. The
// engine data names a flavour per weapon (`weapon.flavour`, validated against the schema enum), so this reads the state's weapon
// table; `flavourOf` guesses from the id only when the table has no such weapon (an old save, a test fixture). Never throws.
import type { GameState } from '@/engine'
import type { WeaponFlavour } from '@/data/types'

export type { WeaponFlavour }

export const FLAVOURS: readonly WeaponFlavour[] = ['stub', 'las', 'bolter', 'flamer', 'plasma', 'melta', 'grenade', 'chain', 'blade', 'maul', 'whip', 'crush']

const isFlavour = (s: string | undefined): s is WeaponFlavour => !!s && (FLAVOURS as readonly string[]).includes(s)

/** Best guess from the id alone. */
export function guessFlavour(weaponId: string): WeaponFlavour {
  const t = weaponId.toLowerCase()
  if (/flam|burna|chem-thrower/.test(t)) return 'flamer'
  if (/melta/.test(t)) return 'melta'
  if (/plasma/.test(t)) return 'plasma'
  if (/grenade|missile|launcher|charges|bomb|flare/.test(t)) return 'grenade'
  if (/chain|saw/.test(t)) return 'chain'
  if (/whip/.test(t)) return 'whip'
  if (/hammer|maul|spud|rock/.test(t)) return 'maul'
  if (/claw|fist/.test(t)) return 'crush'
  if (/axe|cleaver|knife|sword|blade|stiletto|cleav|pulveris|renderiz/.test(t)) return 'blade'
  if (/las/.test(t)) return 'las'
  if (/bolt/.test(t)) return 'bolter'
  return 'stub'
}

/** The flavour of a weapon: the data's own, else a guess from the id. */
export function flavourOf(state: GameState | null, weaponId: string): WeaponFlavour {
  const f = state?.data?.weapons?.[weaponId]?.flavour
  return isFlavour(f) ? f : guessFlavour(weaponId)
}

export const isMeleeFlavour = (f: WeaponFlavour): boolean => f === 'chain' || f === 'blade' || f === 'maul' || f === 'whip' || f === 'crush'
