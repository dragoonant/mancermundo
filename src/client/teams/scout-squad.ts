// Scout Squad client presentation: weapon flavours, VFX families, sounds, attachments, glossary, Forward Scouting wording
// and figure stand-ins for this team's weapons and datacards (teams/types.ts). Owned by the team implementer. Figure
// archetypes use the concept slugs `ss-<operative>[-<loadout or variant>]` (art/unit-concepts/v2/prompts/ss-prompts-gemini.json)
// so the v2 body GLBs drop in by name; until they exist every archetype is a stand-in. v2 bodies hold their weapons, so
// the Sergeant, the Heavy Gunner and the Warrior list one body per loadout (`loadoutBodies`). Shared meshes (bolt pistol,
// chainsword, heavy bolter, bolt sniper rifle) are reused where the weapon is the standard issue one; the shotgun,
// boltgun, missile launcher and combat blade use team slugs that draw the hold-class placeholder until their meshes are
// built. Sounds reuse existing audio ids.
import type { TeamPresentation } from './types'

export const PRESENTATION: TeamPresentation = {
  flavour: {
    'ss.w.astartes-shotgun': 'bolter',
    'ss.w.bolt-pistol': 'bolter',
    'ss.w.boltgun': 'bolter',
    'ss.w.heavy-bolter-focused': 'bolter',
    'ss.w.heavy-bolter-sweeping': 'bolter',
    'ss.w.missile-launcher-frag': 'rokkit',
    'ss.w.missile-launcher-krak': 'rokkit',
    'ss.w.sniper-rifle-mobile': 'bolter',
    'ss.w.sniper-rifle-stationary': 'bolter',
    'ss.w.chainsword': 'chain',
    'ss.w.combat-blade': 'blade',
    'ss.w.combat-blade-equipment': 'blade',
    'ss.w.fists-sergeant': 'crush',
    'ss.w.fists': 'crush',
  },
  vfx: {
    'ss.w.astartes-shotgun': { family: 'bolt', variant: 'rifle' },
    'ss.w.bolt-pistol': { family: 'bolt', variant: 'pistol' },
    'ss.w.boltgun': { family: 'bolt', variant: 'rifle' },
    'ss.w.heavy-bolter-focused': { family: 'bolt', variant: 'heavy' },
    'ss.w.heavy-bolter-sweeping': { family: 'bolt', variant: 'heavy' },
    'ss.w.missile-launcher-frag': { family: 'explosive', variant: 'frag' },
    'ss.w.missile-launcher-krak': { family: 'explosive', variant: 'krak' },
    'ss.w.sniper-rifle-mobile': { family: 'bolt', variant: 'sniper' },
    'ss.w.sniper-rifle-stationary': { family: 'bolt', variant: 'sniper' },
    'ss.w.chainsword': { family: 'blade', variant: 'chain' },
    'ss.w.combat-blade': { family: 'blade', variant: 'power' },
    'ss.w.combat-blade-equipment': { family: 'blade', variant: 'power' },
    'ss.w.fists-sergeant': { family: 'crush', variant: 'fists' },
    'ss.w.fists': { family: 'crush', variant: 'fists' },
  },
  sound: {
    'ss.w.astartes-shotgun': { id: 'wpn-bolt-rifle' },
    'ss.w.bolt-pistol': { id: 'wpn-bolt-pistol' },
    'ss.w.boltgun': { id: 'wpn-bolt-rifle' },
    'ss.w.heavy-bolter-focused': { id: 'wpn-heavy-bolter' },
    'ss.w.heavy-bolter-sweeping': { id: 'wpn-heavy-bolter' },
    'ss.w.missile-launcher-frag': { id: 'wpn-rokkit-launcha' },
    'ss.w.missile-launcher-krak': { id: 'wpn-rokkit-launcha' },
    'ss.w.sniper-rifle-mobile': { id: 'wpn-bolt-sniper-rifle' },
    'ss.w.sniper-rifle-stationary': { id: 'wpn-bolt-sniper-rifle' },
    'ss.w.chainsword': { id: 'wpn-chainsword-hit' },
    'ss.w.combat-blade': { id: 'wpn-plague-blade' },
    'ss.w.combat-blade-equipment': { id: 'wpn-plague-blade' },
    'ss.w.fists-sergeant': { id: 'hit-flesh' },
    'ss.w.fists': { id: 'hit-flesh' },
  },
  attachments: {
    'ss.w.astartes-shotgun': ['ss-w-astartes-shotgun'],
    'ss.w.bolt-pistol': ['w-bolt-pistol'],
    'ss.w.boltgun': ['ss-w-boltgun'],
    'ss.w.heavy-bolter-focused': ['w-heavy-bolter'],
    'ss.w.heavy-bolter-sweeping': ['w-heavy-bolter'],
    'ss.w.missile-launcher-frag': ['ss-w-missile-launcher'],
    'ss.w.missile-launcher-krak': ['ss-w-missile-launcher'],
    'ss.w.sniper-rifle-mobile': ['w-bolt-sniper-rifle'],
    'ss.w.sniper-rifle-stationary': ['w-bolt-sniper-rifle'],
    'ss.w.chainsword': ['w-chainsword'],
    'ss.w.combat-blade': ['ss-w-combat-blade'],
    'ss.w.combat-blade-equipment': ['ss-w-combat-blade'],
    // fists draw nothing
    'ss.w.fists-sergeant': [],
    'ss.w.fists': [],
  },
  // v2 bodies hold their weapons: one body per leader / Heavy Gunner / Warrior loadout (concept slugs in art/unit-concepts/v2/prompts)
  loadoutBodies: {
    'ss.sergeant': [
      { weapons: ['ss.w.astartes-shotgun', 'ss.w.fists-sergeant'], archetype: 'ss-sergeant-astartes-shotgun' },
      { weapons: ['ss.w.boltgun', 'ss.w.fists-sergeant'], archetype: 'ss-sergeant-boltgun' },
      { weapons: ['ss.w.bolt-pistol', 'ss.w.chainsword'], archetype: 'ss-sergeant-bolt-pistol-chainsword' },
    ],
    'ss.heavy-gunner': [
      { weapons: ['ss.wg.heavy-bolter'], archetype: 'ss-heavy-gunner-heavy-bolter' },
      { weapons: ['ss.wg.missile-launcher'], archetype: 'ss-heavy-gunner-missile-launcher' },
    ],
    'ss.warrior': [
      { weapons: ['ss.w.astartes-shotgun'], archetype: 'ss-warrior-shotgun' },
      { weapons: ['ss.w.boltgun'], archetype: 'ss-warrior-boltgun' },
      { weapons: ['ss.w.bolt-pistol', 'ss.w.combat-blade'], archetype: 'ss-warrior-bolt-pistol-blade' },
    ],
  },
  standIns: [
    'ss-sergeant',
  ],
  // Keywords, markers and rule terms in our own wording (game/glossary.ts merges them over the generic fallbacks). The role
  // keywords other teams share (SERGEANT, HEAVY GUNNER, TRACKER) are left to their entries; the abilities explain the Scout versions.
  glossary: [
    { term: 'SCOUT SQUAD', kind: 'keyword', body: 'Faction keyword of the Scout Squad kill team. Every operative has it, and Forward Scouting, Guidance and Experience and most Scout Squad ploys and equipment name Scout Squad operatives.' },
    { term: 'HUNTER', kind: 'keyword', body: 'Scout climber. Its Grapnel Launcher makes every climb cost 2 inches, and a Charge that climbs, drops, jumps or passes under Vantage gives its melee weapons Lethal 3+ for the activation.' },
    { term: 'SNIPER', kind: 'keyword', body: 'Scout marksman. Camo Cloak lets it ignore Saturate and keep one more cover save (or one as a crit) when shot, and Optics strips the obscured status from its own targets.' },
    { term: 'WARRIOR', kind: 'keyword', body: 'Line Scout. Adaptive Equipment lets one Warrior throw a smoke grenade and one a stun grenade each turning point without using your grenade equipment.' },
    { term: 'Forward Scouting', kind: 'rule', aliases: ['Forward Scouting picks'], body: 'After both kill teams are set up and before turning point 1, a Scout Squad player makes up to six picks, one at a time and alternating with any opponent who also has picks (the set-up initiative holder first): Redeploy once, Reposition twice, Trip Alarm twice, Booby Trap once, Tactical Manoeuvre once, Diversion once, Devise Plan once, Designate Target once. A pass ends your picks.' },
    { term: 'Bolt weapon', kind: 'rule', aliases: ['bolt weapons'], body: 'The Astartes shotgun, bolt pistol and boltgun. Astartes Training\'s shoot option needs one of its two Shoots to use a bolt weapon.' },
    { term: 'Heavy weapon', kind: 'rule', aliases: ['heavy weapons'], body: 'Any profile of the heavy bolter, missile launcher or sniper rifle. Astartes Training\'s heavy option needs both Shoots to use one, and the second costs 1 AP more.' },
    { term: 'Trip Alarm marker', kind: 'status', aliases: ['Trip Alarm markers', 'Trip Alarm'], body: 'A Scout Squad tripwire laid before the battle. In turning points 1 and 2 friendly Scouts shooting an enemy within 2 inches of it have Seek. It is removed at the Ready step of turning point 3.' },
    { term: 'Booby Trap marker', kind: 'status', aliases: ['Booby Trap markers', 'Booby Trap'], body: 'A public Scout Squad mine. The first enemy operative to come within its control range takes 2D3 damage and the marker is removed; a survivor\'s move stops there. Friendly operatives never set it off.' },
    { term: 'Designate Target token', kind: 'status', aliases: ['Designate Target tokens', 'Target token'], body: 'Marks the enemy chosen with Designate Target for the whole battle: a Scout shooting, fighting or retaliating against it may re-roll one attack die.' },
    { term: 'Track Enemy token', kind: 'status', aliases: ['Track Enemy tokens'], body: 'Marks the enemy a Tracker picked: until the end of the turning point friendly Scouts shooting it have Seek Light.' },
    { term: 'Scout Auspex Scan token', kind: 'status', aliases: ['Scout Auspex Scan tokens'], body: 'The Tracker is scanning: until it next activates, a Scout shooting an enemy within 8 inches of it ignores the obscured status, and an Optics Sniper also has Seek Light against that enemy.' },
    { term: 'Optics token', kind: 'status', aliases: ['Optics tokens'], body: 'The Sniper is using Optics: until it next activates, enemies cannot be obscured while it shoots them.' },
    { term: 'Covert Position token', kind: 'status', aliases: ['Covert Position tokens'], body: 'While this Scout has a Conceal order and is in cover it cannot be selected as a target unless the shooter is within 2 inches, whatever Seek or Vantage say.' },
    { term: 'Raw Physiology token', kind: 'status', aliases: ['Raw Physiology tokens'], body: 'Until this Scout next activates it has +1 inch of Move and ignores the Move and Hit penalties of being injured.' },
  ],
  // wording of the Tactical Manoeuvre / Diversion picks and of the Astartes Training options (ploy params)
  ployParams: {
    'ss.p.astartes-training:fight': 'Fight twice',
    'ss.p.astartes-training:shoot': 'Shoot twice (one bolt weapon)',
    'ss.p.astartes-training:heavy': 'Shoot twice with heavy weapons (second Shoot costs +1 AP)',
  },
}
