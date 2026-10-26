// Weapon id -> attachment GLB slug(s) in public/assets/models/attachments (manifest `attachments` keys).
// Profile groups share one mesh; an empty list is an explicit "draws nothing" (natural weapons, bare fists,
// abstract explosives); two slugs draw a pair (twin choppas). An id absent from the table is unmapped: the
// renderer falls back to the hold-class box and tests/client/attachments.test.ts fails on it.
import { teamTable } from '../teams'
export type AttachmentSlug = string

export const ATTACHMENT_FOR: Record<string, AttachmentSlug[]> = {
  // Angels of Death
  'aod.w.hand-flamer': ['w-hand-flamer'],
  'aod.w.heavy-bolt-pistol': ['w-heavy-bolt-pistol'],
  'aod.w.plasma-pistol-standard': ['w-plasma-pistol'],
  'aod.w.plasma-pistol-supercharge': ['w-plasma-pistol'],
  'aod.w.auto-bolt-rifle': ['w-auto-bolt-rifle'],
  'aod.w.bolt-rifle': ['w-bolt-rifle'],
  'aod.w.stalker-bolt-rifle-heavy': ['w-stalker-bolt-rifle'],
  'aod.w.stalker-bolt-rifle-mobile': ['w-stalker-bolt-rifle'],
  'aod.w.aux-grenade-launcher-frag': ['w-auxiliary-grenade-launcher'],
  'aod.w.aux-grenade-launcher-krak': ['w-auxiliary-grenade-launcher'],
  'aod.w.bolt-pistol': ['w-bolt-pistol'],
  'aod.w.heavy-bolter-focused': ['w-heavy-bolter'],
  'aod.w.heavy-bolter-sweeping': ['w-heavy-bolter'],
  'aod.w.bolt-sniper-rifle-executioner': ['w-bolt-sniper-rifle'],
  'aod.w.bolt-sniper-rifle-hyperfrag': ['w-bolt-sniper-rifle'],
  'aod.w.bolt-sniper-rifle-mortis': ['w-bolt-sniper-rifle'],
  'aod.w.chainsword-assault': ['w-chainsword'],
  'aod.w.chainsword-intercessor': ['w-chainsword'],
  'aod.w.power-fist-assault': ['w-power-fist'],
  'aod.w.power-fist-captain': ['w-power-fist'],
  'aod.w.power-fist-intercessor': ['w-power-fist'],
  'aod.w.power-weapon-assault': ['w-power-sword'],
  'aod.w.power-weapon-intercessor': ['w-power-sword'],
  'aod.w.thunder-hammer-assault': ['w-thunder-hammer'],
  'aod.w.thunder-hammer-intercessor': ['w-thunder-hammer'],
  'aod.w.fists': [],
  // Kommandos
  'kom.w.slugga': ['w-slugga'],
  'kom.w.choppa': ['w-choppa'],
  'kom.w.big-choppa': ['w-big-choppa'],
  'kom.w.power-klaw': ['w-power-klaw'],
  'kom.w.explosives': [],
  'kom.w.bite': [],
  'kom.w.breacha-ram': ['w-breacha-ram'],
  'kom.w.burna-standard': ['w-burna'],
  'kom.w.burna-deluge': ['w-burna'],
  'kom.w.shokka-pistol': ['w-shokka-pistol'],
  'kom.w.dakka-shoota-short': ['w-dakka-shoota'],
  'kom.w.dakka-shoota-long': ['w-dakka-shoota'],
  'kom.w.rokkit-launcha-aimed': ['w-rokkit-launcha'],
  'kom.w.rokkit-launcha-mobile': ['w-rokkit-launcha'],
  'kom.w.scoped-big-shoota-concealed': ['w-scoped-big-shoota'],
  'kom.w.scoped-big-shoota-stationary': ['w-scoped-big-shoota'],
  'kom.w.scoped-big-shoota-sweeping': ['w-scoped-big-shoota'],
  'kom.w.throwing-knives': ['w-throwing-knife'],
  'kom.w.twin-choppas': ['w-choppa', 'w-choppa'],
  'kom.w.grot-choppa': ['w-grot-choppa'],
  'kom.w.fists': [],
  'kom.w.choppas-equipment': ['w-choppa'],
  'kom.w.dynamite': ['e-dynamite'],
  'kom.w.harpoon': ['e-harpoon'],
  // Core
  'core.w.frag-grenade': ['e-frag-grenade'],
  'core.w.krak-grenade': ['e-krak-grenade'],
}
// M9 prep: teams added later bring their own entries (src/client/teams)
Object.assign(ATTACHMENT_FOR, teamTable('attachments'))

/** The attachment slugs a weapon draws: [] draws nothing, undefined means the id is unmapped. */
export function attachmentFor(weaponId: string): AttachmentSlug[] | undefined {
  return ATTACHMENT_FOR[weaponId]
}

/** Every distinct slug the table can draw. */
export const MAPPED_SLUGS: readonly AttachmentSlug[] = [...new Set(Object.values(ATTACHMENT_FOR).flat())]

/** Every attachment mesh per team (the gallery's attachment pages and the manifest test use these). */
export const KOMMANDO_SLUGS: readonly AttachmentSlug[] = [
  'w-slugga', 'w-choppa', 'w-big-choppa', 'w-power-klaw', 'w-breacha-ram', 'w-burna', 'w-shokka-pistol', 'w-dakka-shoota',
  'w-rokkit-launcha', 'w-scoped-big-shoota', 'w-throwing-knife', 'w-grot-choppa', 'e-dynamite', 'e-harpoon', 'e-stikkbomb',
]
export const AOD_SLUGS: readonly AttachmentSlug[] = [
  'w-hand-flamer', 'w-heavy-bolt-pistol', 'w-plasma-pistol', 'w-auto-bolt-rifle', 'w-bolt-rifle', 'w-stalker-bolt-rifle',
  'w-auxiliary-grenade-launcher', 'w-bolt-pistol', 'w-heavy-bolter', 'w-bolt-sniper-rifle', 'w-chainsword', 'w-power-fist',
  'w-power-sword', 'w-thunder-hammer', 'e-frag-grenade', 'e-krak-grenade',
]
export const PF_SLUGS: readonly AttachmentSlug[] = [
  'pf-w-pulse-carbine', 'pf-w-suppressed-pulse-carbine', 'pf-w-twin-pulse-carbine', 'pf-w-ion-rifle', 'pf-w-rail-rifle',
  'pf-w-marksman-rail-rifle', 'pf-w-burst-cannon', 'pf-e-fusion-grenade',
]
export const HT_SLUGS: readonly AttachmentSlug[] = [
  'ht-w-gauss-blaster', 'ht-w-tesla-carbine', 'ht-w-arcane-conduit', 'ht-w-atomiser-beam', 'ht-w-spark', 'ht-w-entropic-lance',
  'ht-w-synaptic-disintegrator', 'ht-w-abyssal-lance', 'ht-w-aeonstave', 'ht-w-staff-of-light',
]
export const PM_SLUGS: readonly AttachmentSlug[] = [
  'pm-w-boltgun', 'pm-w-plague-spewer', 'pm-w-plague-sword', 'pm-w-plague-knife', 'pm-w-flail-of-corruption', 'pm-w-corrupted-staff',
]
export const WB_SLUGS: readonly AttachmentSlug[] = [
  'wb-w-autogun', 'wb-w-shotgun', 'wb-w-master-crafted-autopistol', 'wb-w-web-pistol', 'wb-w-liberator-autostubs', 'wb-w-flamer',
  'wb-w-grenade-launcher', 'wb-w-webber', 'wb-w-heavy-stubber', 'wb-w-mining-laser', 'wb-w-seismic-cannon', 'wb-w-sanctus-sniper-rifle',
  'wb-w-power-maul', 'wb-w-power-pick', 'wb-w-kelermorph-knife', 'wb-w-sanctus-bio-dagger', 'wb-w-locus-blades', 'wb-w-barbed-tail',
]
