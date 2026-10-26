// Fellgor Ravagers client presentation: weapon flavours, VFX families, sounds, attachments, glossary and figure
// stand-ins for this team's weapons and datacards (teams/types.ts). Owned by the team implementer. Figure archetypes use
// the concept slugs `fg-<operative>[-<loadout or variant>]` so the v2 body GLBs drop in by name; until they exist every
// archetype is a stand-in. v2 bodies hold their weapons, so the Ironhorn and the Warrior list one body per loadout
// (`loadoutBodies`). Shared meshes (plasma pistol, chainsword, power fist) are reused where the weapon is the standard
// issue one; the rest use team slugs (`fg-w-*`) that draw the hold-class placeholder until their meshes are built, and
// the tech-curse (PSYCHIC) draws nothing. Sounds reuse existing audio ids. The Frenzy badge is a token, drawn by the
// shared token markers (`fg.frenzy` in the glossary below).
import type { TeamPresentation } from './types'

const f = (id: string) => `fg.w.${id}`

export const PRESENTATION: TeamPresentation = {
  flavour: {
    [f('corrupted-pistol')]: 'slugga',
    [f('plasma-pistol-standard')]: 'plasma',
    [f('plasma-pistol-supercharge')]: 'plasma',
    [f('autopistol')]: 'slugga',
    [f('crackthorn-whip-ranged')]: 'blade',
    [f('tech-curse')]: 'plasma',
    [f('bludgeon')]: 'crush',
    [f('corrupted-chainsword')]: 'chain',
    [f('triple-cleavers')]: 'blade',
    [f('bionic-fist')]: 'crush',
    [f('skullcleaver')]: 'blade',
    [f('crackthorn-whip-melee')]: 'blade',
    [f('vicious-claws')]: 'bite',
    [f('braystave')]: 'crush',
    [f('cleaver')]: 'blade',
    [f('mancrusher')]: 'crush',
  },
  vfx: {
    [f('corrupted-pistol')]: { family: 'slugga', variant: 'slugga' },
    [f('plasma-pistol-standard')]: { family: 'plasma', variant: 'standard' },
    [f('plasma-pistol-supercharge')]: { family: 'plasma', variant: 'supercharge' },
    [f('autopistol')]: { family: 'slugga', variant: 'slugga' },
    // a lashing cord, not thrown blades: the tethered-line family
    [f('crackthorn-whip-ranged')]: { family: 'harpoon', variant: 'harpoon' },
    [f('tech-curse')]: { family: 'plasma', variant: 'standard' },
    [f('bludgeon')]: { family: 'crush', variant: 'fists' },
    [f('corrupted-chainsword')]: { family: 'blade', variant: 'chain' },
    [f('triple-cleavers')]: { family: 'blade', variant: 'twin' },
    [f('bionic-fist')]: { family: 'crush', variant: 'fist' },
    [f('skullcleaver')]: { family: 'blade', variant: 'choppa' },
    [f('crackthorn-whip-melee')]: { family: 'blade', variant: 'slash' },
    [f('vicious-claws')]: { family: 'crush', variant: 'bite' },
    [f('braystave')]: { family: 'crush', variant: 'thunder' },
    [f('cleaver')]: { family: 'blade', variant: 'choppa' },
    [f('mancrusher')]: { family: 'crush', variant: 'ram' },
  },
  sound: {
    [f('corrupted-pistol')]: { id: 'wpn-bolt-pistol' },
    [f('plasma-pistol-standard')]: { id: 'wpn-plasma-pistol' },
    [f('plasma-pistol-supercharge')]: { id: 'wpn-plasma-pistol-supercharge' },
    [f('autopistol')]: { id: 'wpn-slugga' },
    [f('crackthorn-whip-ranged')]: { id: 'wpn-flail-corruption' },
    [f('tech-curse')]: { id: 'wpn-staff-beam' },
    // a blunt club blow, not an energised fist
    [f('bludgeon')]: { id: 'wpn-staff-strike' },
    [f('corrupted-chainsword')]: { id: 'wpn-chainsword-hit' },
    [f('triple-cleavers')]: { id: 'wpn-twin-choppas' },
    [f('bionic-fist')]: { id: 'wpn-power-klaw' },
    [f('skullcleaver')]: { id: 'wpn-big-choppa' },
    [f('crackthorn-whip-melee')]: { id: 'wpn-flail-corruption' },
    [f('vicious-claws')]: { id: 'wpn-claws-rend' },
    [f('braystave')]: { id: 'wpn-staff-strike' },
    [f('cleaver')]: { id: 'wpn-choppa' },
    [f('mancrusher')]: { id: 'wpn-thunder-hammer' },
  },
  attachments: {
    [f('corrupted-pistol')]: ['fg-w-corrupted-pistol'],
    [f('plasma-pistol-standard')]: ['w-plasma-pistol'],
    [f('plasma-pistol-supercharge')]: ['w-plasma-pistol'],
    [f('autopistol')]: ['fg-w-autopistol'],
    [f('crackthorn-whip-ranged')]: ['fg-w-crackthorn-whip'],
    // a psychic curse: nothing in the hand
    [f('tech-curse')]: [],
    [f('bludgeon')]: ['fg-w-bludgeon'],
    [f('corrupted-chainsword')]: ['w-chainsword'],
    [f('triple-cleavers')]: ['fg-w-triple-cleavers'],
    [f('bionic-fist')]: ['w-power-fist'],
    [f('skullcleaver')]: ['fg-w-skullcleaver'],
    [f('crackthorn-whip-melee')]: ['fg-w-crackthorn-whip'],
    [f('vicious-claws')]: ['fg-w-vicious-claws'],
    [f('braystave')]: ['fg-w-braystave'],
    [f('cleaver')]: ['fg-w-cleaver'],
    [f('mancrusher')]: ['fg-w-mancrusher'],
  },
  // v2 bodies hold their weapons: one body per leader and Warrior loadout (concept slugs in art/unit-concepts/v2/prompts)
  loadoutBodies: {
    'fg.ironhorn': [
      { weapons: ['fg.w.corrupted-pistol', 'fg.w.corrupted-chainsword'], archetype: 'fg-ironhorn-corrupted-pistol-chainsword' },
      { weapons: ['fg.wg.plasma-pistol', 'fg.w.bludgeon'], archetype: 'fg-ironhorn-plasma-pistol-bludgeon' },
    ],
    'fg.warrior': [
      { weapons: ['fg.w.autopistol', 'fg.w.bludgeon'], archetype: 'fg-warrior-bludgeon' },
      { weapons: ['fg.w.autopistol', 'fg.w.cleaver'], archetype: 'fg-warrior-cleaver' },
    ],
  },
  standIns: [
    'fg-ironhorn',
  ],
  // Keywords and rule terms in our own wording (game/glossary.ts merges them over the generic fallbacks).
  glossary: [
    { term: 'FELLGOR RAVAGER', kind: 'keyword', body: 'Faction keyword of the Fellgor Ravagers kill team. Every operative has it, and Frenzy, the ploys and the equipment all name Fellgor Ravager operatives.' },
    { term: 'IRONHORN', kind: 'keyword', body: 'Fellgor Leader. Its Call the Attack gambit sends a group of the herd loping forward at the start of the turning point.' },
    { term: 'DEATHKNELL', kind: 'keyword', body: 'Fellgor gong-bearer. War Gong turns critical damage on nearby friends into normal damage, Icon Bearer helps hold markers, and Gong Knell makes it harder to shoot.' },
    { term: 'FLUXBRAY', kind: 'keyword', body: 'Fellgor blademaster. Blade Whirl lets it block first, and Cleaver Flurry carves a path through enemy control ranges.' },
    { term: 'GNARLSCAR', kind: 'keyword', body: 'Fellgor veteran who fights and shoots as one action (Uncompromising Attack) and can change its order when it finishes (Sagacious).' },
    { term: 'GOREHORN', kind: 'keyword', body: 'Fellgor trophy-taker: two Fights an activation, and every skull taken with the skullcleaver heals it and sharpens the blade.' },
    { term: 'HERD-GOAD', kind: 'keyword', body: 'Fellgor driver. Whip Control weakens and pins nearby enemies, and Incite Fury gives a friend an extra action point.' },
    { term: 'MANGLER', kind: 'keyword', body: 'Fellgor savage: it never shoots, strikes a second time for free after its first Fight, and punishes enemies that have already acted.' },
    { term: 'SHAMAN', kind: 'keyword', body: 'Fellgor mystic: Apoplectic Rejuvenation heals the herd and Mantle of Darkness hides concealed friends in cover from shooters.' },
    { term: 'TOXHORN', kind: 'keyword', body: 'Fellgor plague-bringer: it shrugs off APL loss, enemy Shock and some damage, and throws a Stun Grenade that also hurts.' },
    { term: 'VANDAL', kind: 'keyword', body: 'Fellgor wrecker whose mancrusher gains Ceaseless when it fights and whose Sweeping Blow hurts everything close, friend or foe.' },
    { term: 'Frenzy', kind: 'rule', aliases: ['FRENZY'], body: 'A Fellgor Ravager that would be incapacitated is not: it gains a Frenzy token, stays on 1 wound, goes to Engage, and every remaining attack die of that sequence is discarded. Your opponent counts it as a kill at once. A frenzied operative dies only when its activation or counteraction ends, a critical strike or critical shooting hit lands on it, a second normal strike lands on it, two normal shooting hits land in one Shoot, or the battle ends.' },
    { term: 'Frenzy token', kind: 'status', aliases: ['Frenzy tokens', 'frenzied'], body: 'The operative is frenzied: it stays on 1 wound and dies only when its activation or counteraction ends, when an enemy fighting it lands a critical strike or a second normal strike on it, or when an enemy shooting it deals critical damage or normal damage from two dice in one Shoot. It has no Conceal order, is injured (Warriors excepted), cannot pick up markers or take unique or mission actions (Sweeping Blow and Operate Hatch excepted), and counts as APL 1 for control (the Deathknell excepted). Your opponent already counted it as a kill.' },
    { term: 'Gong Knell token', kind: 'status', aliases: ['Gong Knell tokens', 'Gong Knell'], body: 'The Deathknell\'s Save is 1 better whenever it is shot, until its next activation starts.' },
    { term: 'Mantle of Darkness token', kind: 'status', aliases: ['Mantle of Darkness tokens'], body: 'The Shaman hides friendly Fellgor Ravagers near it that are on Conceal and in cover: shooters cannot pick them as targets unless the shooter is within 2 inches. Lasts until the Shaman next activates.' },
    { term: 'Chaos Sigil token', kind: 'status', aliases: ['Chaos Sigil tokens'], body: 'The Chaos Sigil equipment has been used this turning point.' },
    { term: 'Brass Adornments token', kind: 'status', aliases: ['Brass Adornments tokens'], body: 'A free use of Animalistic Fury or Wild Rage has been spent this battle.' },
    { term: 'Gore Marks token', kind: 'status', aliases: ['Gore Marks tokens'], body: 'Gore Marks has been used this turning point.' },
    { term: 'Pelting Firepower token', kind: 'status', aliases: ['Pelting Firepower tokens'], body: 'Pelting Firepower is in force this turning point: a Fellgor shooting an enemy another Fellgor already shot gains Ceaseless, or Relentless after two others.' },
  ],
}
