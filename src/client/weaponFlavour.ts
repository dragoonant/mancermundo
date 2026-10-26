// One classification of "what does this weapon look and sound like", shared by audio, vfx and the figure
// stand-ins (hold class). Explicit per weapon id for both teams and the core grenades; a test fails on any
// weapon in the data that has no entry, so a new weapon cannot ship unclassified. `flavourOf` also
// classifies an unknown id by name as a safety net for stale replays.
export type WeaponFlavour = 'bolter' | 'slugga' | 'flamer' | 'plasma' | 'rokkit' | 'chain' | 'crush' | 'blade' | 'bite'

export const FLAVOURS: readonly WeaponFlavour[] = ['bolter', 'slugga', 'flamer', 'plasma', 'rokkit', 'chain', 'crush', 'blade', 'bite']

export const WEAPON_FLAVOUR: Record<string, WeaponFlavour> = {
  // Angels of Death
  'aod.w.hand-flamer': 'flamer',
  'aod.w.heavy-bolt-pistol': 'bolter',
  'aod.w.plasma-pistol-standard': 'plasma',
  'aod.w.plasma-pistol-supercharge': 'plasma',
  'aod.w.auto-bolt-rifle': 'bolter',
  'aod.w.bolt-rifle': 'bolter',
  'aod.w.stalker-bolt-rifle-heavy': 'bolter',
  'aod.w.stalker-bolt-rifle-mobile': 'bolter',
  'aod.w.aux-grenade-launcher-frag': 'rokkit',
  'aod.w.aux-grenade-launcher-krak': 'rokkit',
  'aod.w.bolt-pistol': 'bolter',
  'aod.w.heavy-bolter-focused': 'bolter',
  'aod.w.heavy-bolter-sweeping': 'bolter',
  'aod.w.bolt-sniper-rifle-executioner': 'bolter',
  'aod.w.bolt-sniper-rifle-hyperfrag': 'bolter',
  'aod.w.bolt-sniper-rifle-mortis': 'bolter',
  'aod.w.chainsword-assault': 'chain',
  'aod.w.chainsword-intercessor': 'chain',
  'aod.w.power-fist-assault': 'crush',
  'aod.w.power-fist-captain': 'crush',
  'aod.w.power-fist-intercessor': 'crush',
  'aod.w.power-weapon-assault': 'blade',
  'aod.w.power-weapon-intercessor': 'blade',
  'aod.w.thunder-hammer-assault': 'crush',
  'aod.w.thunder-hammer-intercessor': 'crush',
  'aod.w.fists': 'crush',
  // Kommandos
  'kom.w.slugga': 'slugga',
  'kom.w.choppa': 'blade',
  'kom.w.big-choppa': 'blade',
  'kom.w.power-klaw': 'crush',
  'kom.w.explosives': 'rokkit',
  'kom.w.bite': 'bite',
  'kom.w.breacha-ram': 'crush',
  'kom.w.burna-standard': 'flamer',
  'kom.w.burna-deluge': 'flamer',
  'kom.w.shokka-pistol': 'plasma',
  'kom.w.dakka-shoota-short': 'slugga',
  'kom.w.dakka-shoota-long': 'slugga',
  'kom.w.rokkit-launcha-aimed': 'rokkit',
  'kom.w.rokkit-launcha-mobile': 'rokkit',
  'kom.w.scoped-big-shoota-concealed': 'slugga',
  'kom.w.scoped-big-shoota-stationary': 'slugga',
  'kom.w.scoped-big-shoota-sweeping': 'slugga',
  'kom.w.throwing-knives': 'blade',
  'kom.w.twin-choppas': 'blade',
  'kom.w.grot-choppa': 'blade',
  'kom.w.fists': 'crush',
  'kom.w.choppas-equipment': 'blade',
  'kom.w.dynamite': 'rokkit',
  'kom.w.harpoon': 'blade',
  // Core
  'core.w.frag-grenade': 'rokkit',
  'core.w.krak-grenade': 'rokkit',
}

/** The flavour of a weapon: the explicit entry, else a best guess from the id. Never throws. */
export function flavourOf(weaponId: string): WeaponFlavour {
  const hit = WEAPON_FLAVOUR[weaponId]
  if (hit) return hit
  const t = weaponId.toLowerCase()
  if (/flam|burna/.test(t)) return 'flamer'
  if (/plasma|shokka/.test(t)) return 'plasma'
  if (/rokkit|launcher|grenade|explos|dynamite/.test(t)) return 'rokkit'
  if (/chain/.test(t)) return 'chain'
  if (/fist|klaw|hammer|ram/.test(t)) return 'crush'
  if (/bite|fang|jaw/.test(t)) return 'bite'
  if (/choppa|blade|knife|knives|sword|axe|power-weapon/.test(t)) return 'blade'
  if (/slugga|shoota|dakka/.test(t)) return 'slugga'
  return 'bolter'
}

export const isMeleeFlavour = (f: WeaponFlavour): boolean => f === 'chain' || f === 'crush' || f === 'blade' || f === 'bite'
