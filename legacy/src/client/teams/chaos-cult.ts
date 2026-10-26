// Chaos Cult client presentation: weapon flavours, VFX families, sounds, attachments, glossary and figure stand-ins for
// this team's weapons and datacards (teams/types.ts). Owned by the team implementer. Figure archetypes use the concept
// slugs `cc-<operative>[-<variant>]` so the v2 body GLBs drop in by name (art/unit-concepts/v2/prompts/cc-prompts-gemini.json);
// until they exist every archetype is a stand-in. One body per mutation stage: Devotee, Mutant and Torment are three
// datacards, so an operative that Mutation changes into a new datacard changes figure with it (the figure follows
// `Operative.datacardId`). Every Chaos Cult datacard has a single fixed loadout, so there are no `loadoutBodies`.
// Shared meshes are reused only where the weapon is a plain standard-issue one; the rest use team slugs (`cc-w-*`) that
// draw the hold-class placeholder until their meshes are built. The infernal gaze, a psychic power, draws nothing in the
// hand, and so do bare fists. Psychic and mutant
// effects reuse the existing plasma, flame, blade and crush families; sounds reuse existing audio ids.
import { GIFT_NAME, giftsOf, isMutant, isTorment } from '@/engine/teams/chaos-cult'
import type { TeamPresentation } from './types'

export const PRESENTATION: TeamPresentation = {
  flavour: {
    'cc.w.diabolical-stave-ranged': 'plasma',
    'cc.w.pistol': 'slugga',
    'cc.w.burning-censer': 'flamer',
    'cc.w.infernal-gaze': 'plasma',
    'cc.w.diabolical-stave-melee': 'crush',
    'cc.w.commune-blade': 'blade',
    'cc.w.crude-melee-weapon-iconarch': 'crush',
    'cc.w.crude-melee-weapon': 'blade',
    'cc.w.fists': 'crush',
    'cc.w.blasphemous-appendages': 'bite',
    'cc.w.hideous-mutations': 'bite',
  },
  vfx: {
    'cc.w.diabolical-stave-ranged': { family: 'plasma', variant: 'standard' },
    'cc.w.pistol': { family: 'slugga', variant: 'slugga' },
    'cc.w.burning-censer': { family: 'flame', variant: 'burna' },
    'cc.w.infernal-gaze': { family: 'plasma', variant: 'supercharge' },
    'cc.w.diabolical-stave-melee': { family: 'crush', variant: 'thunder' },
    'cc.w.commune-blade': { family: 'blade', variant: 'power' },
    'cc.w.crude-melee-weapon-iconarch': { family: 'crush', variant: 'fist' },
    'cc.w.crude-melee-weapon': { family: 'blade', variant: 'choppa' },
    'cc.w.fists': { family: 'crush', variant: 'fists' },
    'cc.w.blasphemous-appendages': { family: 'crush', variant: 'bite' },
    'cc.w.hideous-mutations': { family: 'crush', variant: 'bite' },
  },
  sound: {
    'cc.w.diabolical-stave-ranged': { id: 'wpn-staff-beam' },
    'cc.w.pistol': { id: 'wpn-slugga' },
    'cc.w.burning-censer': { id: 'wpn-burna' },
    'cc.w.infernal-gaze': { id: 'wpn-staff-beam' },
    'cc.w.diabolical-stave-melee': { id: 'wpn-staff-strike' },
    'cc.w.commune-blade': { id: 'wpn-power-weapon' },
    'cc.w.crude-melee-weapon-iconarch': { id: 'wpn-choppa' },
    'cc.w.crude-melee-weapon': { id: 'wpn-choppa' },
    'cc.w.fists': { id: 'hit-flesh' },
    'cc.w.blasphemous-appendages': { id: 'wpn-claws-rend' },
    'cc.w.hideous-mutations': { id: 'wpn-claws-rend' },
  },
  attachments: {
    'cc.w.diabolical-stave-ranged': ['cc-w-diabolical-stave'],
    'cc.w.pistol': ['cc-w-pistol'],
    'cc.w.burning-censer': ['cc-w-burning-censer'],
    // a psychic power and bare limbs draw nothing in the hand
    'cc.w.infernal-gaze': [],
    'cc.w.diabolical-stave-melee': ['cc-w-diabolical-stave'],
    'cc.w.commune-blade': ['cc-w-commune-blade'],
    'cc.w.crude-melee-weapon-iconarch': ['cc-w-crude-melee-weapon'],
    'cc.w.crude-melee-weapon': ['cc-w-crude-melee-weapon'],
    'cc.w.fists': [],
    // the mutant bodies carry their own weapon limbs; the hold-class placeholder stands in until a mesh is built
    'cc.w.blasphemous-appendages': ['cc-w-blasphemous-appendages'],
    'cc.w.hideous-mutations': ['cc-w-hideous-mutations'],
  },
  standIns: [
    // the mutation stages: the Devotee's two later forms
  ],
  // wording for the options of ploys and reactions whose param is a gift, a pick or a spot rather than an operative
  ployParams: {
    'cc.p.abhorrent-mutation:chitinous': 'Chitinous: Save one better',
    'cc.p.abhorrent-mutation:fleet': 'Fleet: Move +1"',
    'cc.p.abhorrent-mutation:sinewed': 'Sinewed: melee ignores injury, Brutal',
    'cc.p.abhorrent-mutation:horned': 'Horned: gore after a Charge',
    'cc.p.abhorrent-mutation:barbed': 'Barbed: splash in a fight, no assists',
    'cc.p.abhorrent-mutation:deformed-wings': 'Deformed Wings: climbs cost 2", drops are free',
  },
  // the form a Devotee has reached and the gifts it carries, read from the engine (giftsOf), shown on the operative card
  cardChips: (state, op) => {
    const out: { label: string; title: string; body: string }[] = []
    if (isMutant(op) || isTorment(op)) {
      out.push({
        label: isTorment(op) ? 'Torment' : 'Mutant',
        title: isTorment(op) ? 'Torment (second Mutation)' : 'Mutant (first Mutation)',
        body: isTorment(op) ? 'This Devotee has mutated twice: 13 wounds, both team gifts, regeneration and Brute.' : 'This Devotee has mutated once: it regenerates against heavy blows and carries the team\'s primary gift.',
      })
    }
    for (const g of giftsOf(state, op)) {
      const rec = state.data.abilities[`cc.a.gift-${g}`]
      out.push({ label: GIFT_NAME[g], title: `${GIFT_NAME[g]} (Accursed Gift)`, body: rec?.text ?? 'An Accursed Gift of the cult.' })
    }
    return out
  },
  glossary: [
    { term: 'CHAOS CULT', kind: 'keyword', body: 'Faction keyword of the Chaos Cult kill team. Every operative has it, and Mutation, the gifts and most cult ploys and equipment name Chaos Cult operatives.' },
    { term: 'DARK COMMUNE', kind: 'keyword', body: 'The cult\'s inner circle: the Demagogue, the Blessed Blades, the Iconarch and the Mindwitch. Faithful Follower can step in for them, but they cannot take Abhorrent Mutation and can only mutate by regaining wounds.' },
    { term: 'CULT DEMAGOGUE', kind: 'keyword', body: 'Cult Leader. Incite Slaughter and Incite Urgency send a nearby follower into a free Fight, Charge or Dash.' },
    { term: 'BLESSED BLADE', kind: 'keyword', body: 'Cult bodyguard. It hurts enemies who Fall Back from its reach, and can activate together with the other Blessed Blade within 6 inches.' },
    { term: 'ICONARCH', kind: 'keyword', body: 'Cult standard-bearer. It counts 1 more APL for marker control, and Ruinous Icon toughens nearby cultists or weakens nearby foes.' },
    { term: 'MINDWITCH', kind: 'keyword', body: 'Cult psyker. Heinous Deluge lowers an enemy\'s APL, and Malefic Vortex leaves a marker that burns enemies near it every turning point.' },
    { term: 'DEVOTEE', kind: 'keyword', body: 'The cult\'s rank and file. When one is expended another ready Devotee must activate next, and a Devotee that incapacitates an enemy within its control range may mutate into a Mutant.' },
    { term: 'MUTANT', kind: 'keyword', body: 'A Devotee after Mutation. It regenerates against heavy blows and carries the team\'s primary gift, but cannot perform unique actions and pays extra for Pick Up Marker and mission actions.' },
    { term: 'TORMENT', kind: 'keyword', body: 'A Mutant after a second Mutation: 13 wounds on a 40mm base, both team gifts, regeneration and Brute. It can use only its own weapon and cannot pick up markers or use unique or mission actions.' },
    { term: 'Malefic Vortex marker', kind: 'status', aliases: ['Malefic Vortex'], body: 'The Mindwitch\'s marker. Enemies within 2 inches of it take 1 damage when it is placed and again in the Ready step of every later Strategy phase. Placing it again moves it.' },
    { term: 'Ruinous Icon token', kind: 'status', aliases: ['Ruinous Icon'], body: 'The Iconarch\'s effect is in force: Invigoration cuts Dmg of 4 or more on cultists within 4 inches of it by 1, Deterioration adds 1 to every Dmg dealt to enemies within 4 inches. It lasts until the Iconarch\'s next activation, its incapacitation or a new Ruinous Icon.' },
  ],
}
