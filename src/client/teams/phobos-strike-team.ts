// Phobos Strike Team client presentation: weapon flavours, VFX families, sounds, attachments, glossary and figure
// stand-ins for this team's weapons and datacards (teams/types.ts). Owned by the team implementer.
// Concept slugs use the ph- prefix: bodies ph-<operative>[-<loadout or variant>] and attachments ph-w-<weapon> are built
// from the concept art as they arrive; until a body GLB is in the manifest its archetype stays in `standIns`, and an
// attachment slug with no manifest entry draws the hold-class placeholder. Standard-issue bolt pistols and the stalker
// carbine reuse the shared meshes. The Reivers hold their weapons in the body (v2 bodies), so each Reiver card lists one
// body per loadout in `loadoutBodies`. Sounds reuse existing audio ids.
import type { TeamPresentation } from './types'

export const PRESENTATION: TeamPresentation = {
  flavour: {
    'ph.w.marksman-bolt-carbine': 'bolter',
    'ph.w.custom-bolt-carbine': 'bolter',
    'ph.w.stalker-marksman-bolt-carbine': 'bolter',
    'ph.w.occulus-bolt-carbine': 'bolter',
    'ph.w.bolt-carbine': 'bolter',
    'ph.w.special-issue-bolt-pistol': 'bolter',
    'ph.w.remote-detonator': 'rokkit',
    'ph.w.combat-knife': 'blade',
    'ph.w.fists': 'crush',
    'ph.w.combat-blade': 'blade',
  },
  vfx: {
    'ph.w.marksman-bolt-carbine': { family: 'bolt', variant: 'rifle' },
    'ph.w.custom-bolt-carbine': { family: 'bolt', variant: 'rifle' },
    'ph.w.stalker-marksman-bolt-carbine': { family: 'bolt', variant: 'stalker' },
    'ph.w.occulus-bolt-carbine': { family: 'bolt', variant: 'auto' },
    'ph.w.bolt-carbine': { family: 'bolt', variant: 'rifle' },
    'ph.w.special-issue-bolt-pistol': { family: 'bolt', variant: 'pistol' },
    'ph.w.remote-detonator': { family: 'explosive', variant: 'boom' },
    'ph.w.combat-knife': { family: 'blade', variant: 'choppa' },
    'ph.w.fists': { family: 'crush', variant: 'fists' },
    'ph.w.combat-blade': { family: 'blade', variant: 'choppa' },
  },
  sound: {
    'ph.w.marksman-bolt-carbine': { id: 'wpn-bolt-rifle' },
    'ph.w.custom-bolt-carbine': { id: 'wpn-bolt-rifle' },
    'ph.w.stalker-marksman-bolt-carbine': { id: 'wpn-stalker-bolt-rifle' },
    'ph.w.occulus-bolt-carbine': { id: 'wpn-auto-bolt-rifle' },
    'ph.w.bolt-carbine': { id: 'wpn-bolt-rifle' },
    'ph.w.special-issue-bolt-pistol': { id: 'wpn-bolt-pistol' },
    'ph.w.remote-detonator': { id: 'wpn-explosives' },
    'ph.w.combat-knife': { id: 'wpn-plague-blade' },
    'ph.w.fists': { id: 'hit-flesh' },
    'ph.w.combat-blade': { id: 'wpn-plague-blade' },
  },
  attachments: {
    'ph.w.marksman-bolt-carbine': ['ph-w-marksman-bolt-carbine'],
    'ph.w.custom-bolt-carbine': ['ph-w-marksman-bolt-carbine'],
    'ph.w.stalker-marksman-bolt-carbine': ['w-stalker-bolt-rifle'],
    'ph.w.occulus-bolt-carbine': ['ph-w-occulus-bolt-carbine'],
    'ph.w.bolt-carbine': ['ph-w-bolt-carbine'],
    'ph.w.special-issue-bolt-pistol': ['w-bolt-pistol'],
    'ph.w.remote-detonator': ['ph-w-remote-detonator'],
    'ph.w.combat-knife': ['ph-w-combat-knife'],
    'ph.w.fists': [],
    'ph.w.combat-blade': ['ph-w-combat-knife'],
  },
  standIns: [
  ],
  // One body per loadout for the Reivers: the pistol-and-knife kit is the card's own archetype, the carbine kit the second body
  loadoutBodies: {
    'ph.reiver-sergeant': [
      { weapons: ['ph.w.bolt-carbine'], archetype: 'ph-reiver-sergeant-carbine' },
      { weapons: ['ph.w.special-issue-bolt-pistol'], archetype: 'ph-reiver-sergeant-pistol-knife' },
    ],
    'ph.reiver-warrior': [
      { weapons: ['ph.w.bolt-carbine'], archetype: 'ph-reiver-warrior-carbine' },
      { weapons: ['ph.w.special-issue-bolt-pistol'], archetype: 'ph-reiver-warrior-pistol-knife' },
    ],
  },
  // Keywords and rule terms in our own wording (game/glossary.ts merges them over the generic fallbacks).
  glossary: [
    { term: 'PHOBOS STRIKE TEAM', kind: 'keyword', body: 'Faction keyword of the Phobos Strike Team kill team. Every operative has it. Astartes lets a Phobos operative take two Shoots (one with a bolt weapon) or two Fights in one activation, and any Phobos operative can counteract whatever its order.' },
    { term: 'INFILTRATOR', kind: 'keyword', body: 'Phobos Marine trained for ambush. Omni-Scrambler counts the Infiltrators in the killzone, and an Infiltrator must be able to see (or a Voxbreaker be near) the enemy it jams.' },
    { term: 'INCURSOR', kind: 'keyword', body: 'Phobos skirmisher with an auspex-guided carbine. Multi-Spectrum Array stops enemies being obscured against an Incursor, and Auspex Scan gives its weapons Seek Light.' },
    { term: 'REIVER', kind: 'keyword', body: 'Phobos terror trooper. Enemies within 3 inches pay 1 extra AP for Pick Up Marker and mission actions and count 1 lower when contesting a marker (Terror); its grav-chute makes climbs cost 2 inches and drops nothing.' },
    { term: 'COMMSMAN', kind: 'keyword', body: 'Phobos signaller. Strategic Oversight can earn an extra command point at each Ready step, and Comms Array swaps a strategy ploy you already used for another one, free of CP, once per turning point.' },
    { term: 'HELIX ADEPT', kind: 'keyword', body: 'Phobos medic. Medic! saves a friend within 3 inches from falling (it is left on D3 wounds) and Helix Gauntlet heals D3+3 wounds.' },
    { term: 'SABOTEUR', kind: 'keyword', body: 'Phobos demolitionist. It starts the battle carrying your Explosives marker; place it, step away, and the remote detonator shoots everything within 2 inches of it.' },
    { term: 'VOXBREAKER', kind: 'keyword', body: 'Phobos signals jammer. Enemies within 6 inches cannot re-roll any dice, and Auspex Scan strips obscuring from enemies within 8 inches.' },
    { term: 'MINELAYER', kind: 'keyword', body: 'Phobos trapper. It starts the battle carrying your Haywire Mine marker, which hurts the first operative other than the Minelayer to come within its control range.' },
    { term: 'Explosives marker', kind: 'status', aliases: ['Explosives'], body: 'The Saboteur starts the battle carrying it. Place Marker puts it down (with a free Dash after), only the Saboteur can pick it up, and the remote detonator shoots everyone within 2 inches of it before it leaves the killzone.' },
    { term: 'Haywire Mine marker', kind: 'status', aliases: ['Haywire Mine', 'Haywire Mine markers'], body: 'The Minelayer starts the battle carrying it and can never place it in an enemy control range. The first operative other than the Minelayer to come within its control range takes 2D3+3 damage, loses 1 APL and stops there.' },
    { term: 'Voxbreaker Auspex Scan token', kind: 'status', aliases: ['Voxbreaker Auspex Scan tokens'], body: 'The Voxbreaker has scanned: until its next activation or its incapacitation, the enemies within 8 inches of it cannot be obscured when a Phobos operative shoots them, and an Incursor shooting them also has Seek Light on its ranged weapons.' },
    { term: 'Omni-Scrambler token', kind: 'status', aliases: ['Omni token'], body: 'This enemy is jammed: it cannot be activated or take any action until your opponent has activated as many operatives as you had Infiltrators in the killzone, or it is their last operative left to activate.' },
  ],
}
