// Operative token looks (Markerlight, Poison, Deathmarked, Soulsight...): the glyph each kind wears and its name. A leaf
// module with no imports, shared by the 3D marker over the figure (Operative.tsx), the DOM chip on the operative card
// (TokenChips.tsx), the hover wording (tokenInfo.ts) and the event feed (game/labels.ts). Counts, owners and expiry
// come from the engine (`Operative.tokens`); only the look and the name live here. Our own simple shapes.

export interface TokenGlyph {
  /** number of polygon sides (3 triangle, 4 diamond, 6 hexagon...); 24 reads as a disc */
  sides: number
  /** drawn as an outline instead of a filled shape */
  ring?: boolean
  color: string
  /** drawn larger with a halo, for a state the table must not miss (Frenzy) */
  badge?: boolean
}

export interface TokenDef {
  /** short name: "Markerlight" (the token is "Markerlight token") */
  label: string
  glyph: TokenGlyph
  /** the glossary term for the long explanation */
  term: string
  /** fallback body when the glossary has no entry */
  body: string
  /** extra line read from the token\'s engine `data` (the drug an operative has, the Imperative it took); null when none */
  detail?: (data: Record<string, unknown> | undefined) => string | null
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const DEFS: Record<string, TokenDef> = {
  'pf.markerlight': { label: 'Markerlight', glyph: { sides: 24, ring: true, color: '#ff5a4a' }, term: 'Markerlight token', body: 'A Pathfinder target marker on this operative. More tokens give the Pathfinders\' shots against it more benefits.' },
  'pf.photon': { label: 'Photon', glyph: { sides: 6, color: '#ffd24d' }, term: 'Photon token', body: 'Slowed by a Photon Grenade: Move reduced by 2 inches and no Dash until the end of its next activation.' },
  'pf.pulse': { label: 'Pulse accelerator', glyph: { sides: 3, color: '#4dd2ff' }, term: 'Pulse accelerator token', body: 'A Pulse Accelerator drone boost is active.' },
  'pm.poison': { label: 'Poison', glyph: { sides: 24, color: '#9be03a' }, term: 'Poison token', body: 'Poisoned: it takes 1 damage whenever it activates.' },
  'hie.deathmarked': { label: 'Deathmarked', glyph: { sides: 4, color: '#3dff9a' }, term: 'Deathmarked token', body: 'Marked for the Deathmarks: they shoot this operative with Seek.' },
  'hie.madness': { label: 'Madness', glyph: { sides: 5, color: '#c36bff' }, term: 'Madness token', body: 'Gripped by madness: it may be unable to activate.' },
  'hie.chronometron': { label: 'Chronometron', glyph: { sides: 24, ring: true, color: '#5ab0ff' }, term: 'Chronometron token', body: 'A Chronomancer\'s time boost is active on this operative.' },
  'hie.reinforce': { label: 'Reinforce', glyph: { sides: 4, ring: true, color: '#c4cce0' }, term: 'Reinforce token', body: 'Toughened by Reinforce Metal.' },
  'hie.augment': { label: 'Augment', glyph: { sides: 3, ring: true, color: '#ffa94d' }, term: 'Augment token', body: 'One of its weapons is changed by Augment Weapon.' },
  'hie.shroud': { label: 'Shroud', glyph: { sides: 6, ring: true, color: '#8f7ae0' }, term: 'Shroud token', body: 'Under a Nightmare Shroud.' },
  // batch B: Hand of the Archon
  'ha.pain': { label: 'Pain', glyph: { sides: 3, color: '#e0457b' }, term: 'Pain token', body: 'A Hand of the Archon operative has been hurting people. Each Pain token can be spent on an invigoration.' },
  'ha.poison': { label: 'Venom', glyph: { sides: 6, ring: true, color: '#7bd44a' }, term: 'Venom token', body: 'Poisoned by the Hand of the Archon: it takes D3 damage whenever it activates.' },
  'ha.drug': {
    label: 'Drug',
    glyph: { sides: 4, ring: true, color: '#4de1c1' },
    term: 'Drug token',
    body: 'A combat drug is in this operative\'s system.',
    detail: (d) => (typeof d?.drug === 'string' ? `Drug: ${cap(d.drug.replace(/^ha\.a\./, '').replace(/-/g, ' '))}.` : null),
  },
  'ha.omen': { label: 'Omen', glyph: { sides: 5, color: '#f0c24d' }, term: 'Omen token', body: 'Named by a hunter\'s Omen: an enemy re-rolls its 6s, a friend may re-roll its 1s.' },
  'ha.mark': { label: 'Marked', glyph: { sides: 4, ring: true, color: '#ff6a3d' }, term: 'Mark token', body: 'Marked by a Skysplinter Assassin: its ranged weapons have Seek Light against this operative and it is never obscured to them.' },
  'ha.brutal-display': { label: 'Cowed', glyph: { sides: 3, ring: true, color: '#c4506a' }, term: 'Cowed token', body: 'Cowed by a Brutal Display: it can contest but never control a marker, and cannot pick markers up or take mission actions until the next turning point.' },
  // batch B: Legionaries
  'lg.unleash': { label: 'Unleashed', glyph: { sides: 5, color: '#ff5a3a' }, term: 'Unleash token', body: 'The Anointed has unleashed its daemon for the rest of the battle.' },
  'lg.warded': { label: 'Warded', glyph: { sides: 6, ring: true, color: '#ffb347' }, term: 'Warded token', body: 'Warded Armour: its Save is 2+ until the Ready step of the next Strategy phase.' },
  // batch B: Hunter Clade
  'hc.spot': { label: 'Targeted', glyph: { sides: 3, ring: true, color: '#e8c34d' }, term: 'Targeted token', body: 'Spotted by a Surveyor: friendly Hunter Clade operatives near it shoot this enemy with Seek Light, and it cannot be obscured.' },
  'hc.doctrine': {
    label: 'Override',
    glyph: { sides: 4, color: '#59c3ff' },
    term: 'Override token',
    body: 'Command Override: this operative follows a different Imperative until the turning point ends.',
    detail: (d) => (typeof d?.mode === 'string' ? `Imperative: ${cap(d.mode)}.` : null),
  },
  'hc.omnissiah': {
    label: 'Omnissiah',
    glyph: { sides: 6, color: '#ff9a3d' },
    term: 'Omnissiah token',
    body: 'Omnissiah\'s Imperative: this operative has an extra rule from its current Imperative until the turning point ends.',
    detail: (d) => (typeof d?.mode === 'string' ? `Imperative: ${cap(d.mode)}.` : null),
  },
  // batch B: Hearthkyn Salvagers
  'hk.grudge': { label: 'Grudge', glyph: { sides: 4, color: '#d0873a' }, term: 'Grudge token', body: 'This enemy holds a Hearthkyn grudge: for each token, Hearthkyn Salvagers attacking it turn one normal success into a crit.' },
  'hk.system-jam': { label: 'System Jam', glyph: { sides: 6, color: '#7fa6ff' }, term: 'System Jam token', body: 'Jammed: it cannot be activated while its player still has a ready operative without a token.' },
  'hk.spot': { label: 'Spot', glyph: { sides: 24, ring: true, color: '#7be0a0' }, term: 'Spot token', body: 'Spotted by a Lokatr: Hearthkyn Salvagers near it shoot this enemy with Seek Light.' },
  'wyr.soulsight': { label: 'Soulsight', glyph: { sides: 6, color: '#ff7ad9' }, term: 'Soulsight token', body: 'Seen by the cult\'s familiar: the Sanctus operatives fight and shoot it with extra rules.' },
  // batch C: Kasrkin
  'ks.tacticalCommand': {
    label: 'Tactical Command',
    glyph: { sides: 5, color: '#6fd08c' },
    term: 'Tactical Command token',
    body: 'Tactical Command gave this operative an extra Skill at Arms until the next Ready step.',
    detail: (d) => (typeof d?.skill === 'string' ? `Skill: ${cap(d.skill.replace(/-/g, ' '))}.` : null),
  },
  'ks.auspexScan': { label: 'Auspex scan', glyph: { sides: 24, ring: true, color: '#58d0ff' }, term: 'Recon Auspex Scan token', body: 'The Recon-Trooper is scanning: nearby enemies cannot be obscured against friendly Kasrkin shooters.' },
  // batch C: Novitiates
  'nv.whip': { label: 'Whip', glyph: { sides: 4, color: '#e0457b' }, term: 'Whip token', body: 'Whip Into Frenzy: +1 APL, +1 inch of Move and two Fights in its next activation.' },
  'nv.blaze': { label: 'Blaze', glyph: { sides: 3, color: '#ff7a2a' }, term: 'Blaze token', body: 'Burning: it takes D3 damage whenever it activates.' },
  // batch C: Phobos Strike Team
  'ph.auspex': { label: 'Auspex scan', glyph: { sides: 24, ring: true, color: '#7be0ff' }, term: 'Voxbreaker Auspex Scan token', body: 'The Voxbreaker is scanning: enemies within 8 inches cannot be obscured against Phobos shooters.' },
  'ph.omni': { label: 'Omni-Scrambler', glyph: { sides: 6, color: '#b36bff' }, term: 'Omni-Scrambler token', body: 'Jammed: it cannot be activated until enough other operatives have activated.' },
  // batch C: Corsair Voidscarred
  'cv.osa': { label: 'One Step Ahead', glyph: { sides: 5, ring: true, color: '#7fe0ff' }, term: 'One Step Ahead token', body: 'The Felarch has not yet used One Step Ahead this battle.' },
  'cv.faolchu': { label: 'Faolchú\'s Bond', glyph: { sides: 3, color: '#9be03a' }, term: 'Faolchú\'s Bond token', body: 'The Kurnite Hunter has not yet retaliated this turning point.' },
  'cv.shield': { label: 'Warding Shield', glyph: { sides: 6, ring: true, color: '#c9a6ff' }, term: 'Warding Shield token', body: 'The next Normal Dmg attack die on this operative is ignored.' },
  'cv.erudite': { label: 'Erudite Hunter', glyph: { sides: 4, color: '#ff9a5a' }, term: 'Erudite Hunter token', body: 'Marked by the Erudite Hunter gambit: the Kurnite Hunter may pounce when it moves.' },
  'cv.runes': { label: 'Runes of Guidance', glyph: { sides: 5, color: '#a6ffd5' }, term: 'Runes of Guidance token', body: 'This psyker\'s PSYCHIC actions may reach 3 inches further, once this turning point.' },
  // batch C: Warpcoven
  'wc.protected': { label: 'Protected', glyph: { sides: 6, ring: true, color: '#7ab8ff' }, term: 'Protected token', body: 'Protected by Fate: its player may re-roll any of its defence dice when it is shot.' },
  'wc.ravaged': { label: 'Ravaged', glyph: { sides: 3, color: '#c0405a' }, term: 'Ravaged token', body: 'Ravage Destiny: it must re-roll attack dice showing 6 and counts 1 less APL for marker control.' },
  'wc.alight': { label: 'Alight', glyph: { sides: 5, color: '#ff8a3a' }, term: 'Alight token', body: 'Set alight: friendly Warpcoven weapons have Ceaseless against it.' },
  'wc.mindburn': { label: 'Mindburn', glyph: { sides: 4, ring: true, color: '#d06bff' }, term: 'Mindburn token', body: 'Scorched by mindburn: the Hit of its weapons is 1 worse until its next activation ends.' },
  // batch C: Farstalker Kinband
  'fk.victoryShriek': { label: 'Victory Shriek', glyph: { sides: 5, ring: true, color: '#e8c34d' }, term: 'Victory Shriek token', body: 'Picked by Victory Shriek: its weapons have Balanced for the rest of the battle.' },
  'fk.vengeance': { label: 'Vengeance', glyph: { sides: 4, color: '#d0873a' }, term: 'Vengeance token', body: 'Vengeance for the Kinband: Farstalker weapons have Relentless against it for the rest of the battle.' },
  // batch C: Imperial Navy Breachers
  'nb.spotted': { label: 'Spot', glyph: { sides: 24, ring: true, color: '#ffd24d' }, term: 'C.A.T. Spot token', body: 'Spotted by a C.A.T. Unit: friendly Breachers shoot it with Seek Light and it cannot be obscured.' },
  'nb.emboldened': { label: 'Emboldened', glyph: { sides: 3, ring: true, color: '#ff5a4a' }, term: 'Emboldened token', body: 'The Axejack has Charged: big attack dice may do 1 less damage to it.' },
  // batch D: Scout Squad
  'ss.optics': { label: 'Optics', glyph: { sides: 24, ring: true, color: '#9be0ff' }, term: 'Optics token', body: 'The Sniper is using Optics: until it next activates, enemies cannot be obscured while it shoots them.' },
  'ss.auspexScan': { label: 'Auspex scan', glyph: { sides: 24, ring: true, color: '#58f0c8' }, term: 'Scout Auspex Scan token', body: 'The Tracker is scanning: until it next activates, a Scout shooting an enemy within 8 inches of it ignores the obscured status, and an Optics Sniper also has Seek Light against that enemy.' },
  'ss.trackEnemy': { label: 'Tracked', glyph: { sides: 3, ring: true, color: '#e8c34d' }, term: 'Track Enemy token', body: 'Picked out by a Tracker: until the end of the turning point, friendly Scouts shooting it have Seek Light.' },
  'ss.target': { label: 'Designated', glyph: { sides: 4, ring: true, color: '#ff5a4a' }, term: 'Designate Target token', body: 'Chosen before the battle as the Scouts\' quarry: a Scout shooting, fighting or retaliating against it may re-roll one attack die.' },
  'ss.covertPosition': { label: 'Covert', glyph: { sides: 6, ring: true, color: '#6fb7ff' }, term: 'Covert Position token', body: 'While this Scout has a Conceal order and is in cover it cannot be picked as a target unless the shooter is within 2 inches.' },
  'ss.rawPhysiology': { label: 'Raw Physiology', glyph: { sides: 5, color: '#ffa94d' }, term: 'Raw Physiology token', body: 'Until this Scout next activates it has +1 inch of Move and ignores the Move and Hit penalties of being injured.' },
  // batch D: Blooded
  'bl.blooded': { label: 'Blooded', glyph: { sides: 4, color: '#d0332f' }, term: 'Blooded token', body: 'This operative holds a Blooded token: its weapons have Accurate 1, and several Blooded ploys and equipment name it.' },
  'bl.gaze': { label: 'Gaze', glyph: { sides: 5, ring: true, color: '#ffd24d' }, term: 'Gaze token', body: 'Under the Gaze of the Gods until the end of the turning point: one normal success it keeps through Accurate 1 is kept as a crit.' },
  'bl.name-whispered': { label: 'Name whispered', glyph: { sides: 3, color: '#b36bff' }, term: 'Name whispered token', body: 'A name whispered in blood: the Sharpshooter shooting this enemy counts as a holder under the Gaze, for the rest of the battle.' },
  'bl.glory-kill': { label: 'Glory kill', glyph: { sides: 24, color: '#ff7a2a' }, term: 'Glory kill token', body: 'Marked for a glory kill: friendly Blooded operatives shooting, fighting or retaliating against it have Ceaseless (Relentless for holders) until the end of the turning point.' },
  'bl.stimm-enraged': { label: 'Enraged', glyph: { sides: 3, color: '#ff4a3a' }, term: 'Stimm enraged token', body: 'Enraged by a stimm: its melee weapons have Relentless for the rest of the battle.' },
  'bl.stimm-fortified': { label: 'Fortified', glyph: { sides: 6, color: '#7fd0ff' }, term: 'Stimm fortified token', body: 'Fortified by a stimm: each attack die that would deal it 3 or more damage is cut by 1 on a D6 of 5 or more, for the rest of the battle.' },
  'bl.shielding': { label: 'Shielding', glyph: { sides: 6, ring: true, color: '#c4cce0' }, term: 'Shielding token', body: 'The Trench Sweeper is shielded: its Move is 2 inches less and its defence dice can be re-rolled until its next activation starts.' },
  // batch D: Fellgor Ravagers
  'fg.frenzy': { label: 'Frenzy', glyph: { sides: 5, color: '#ff2a2a', badge: true }, term: 'Frenzy token', body: 'Frenzied: it stays on 1 wound and dies only when its activation or counteraction ends, or to a critical strike, a second normal strike, critical shooting damage or two Normal Dmg dice in one Shoot. Engage only, no markers or unique actions.' },
  'fg.gongKnell': { label: 'Gong Knell', glyph: { sides: 24, ring: true, color: '#e0b04d' }, term: 'Gong Knell token', body: 'The Deathknell\'s Save is 1 better whenever it is shot, until its next activation starts.' },
  'fg.mantle': { label: 'Mantle', glyph: { sides: 6, color: '#7a5ae0' }, term: 'Mantle of Darkness token', body: 'The Shaman hides nearby friendly Fellgor Ravagers on Conceal and in cover: shooters cannot pick them unless within 2 inches. Lasts until the Shaman next activates.' },
  // batch D: Goremongers
  'gm.gore': { label: 'Gore', glyph: { sides: 24, color: '#c01820' }, term: 'Gore token', body: 'Shows a Goremonger\'s gore tank: one token is a half tank, two is a full tank, none is empty.' },
  'gm.bleeding': { label: 'Bleeding', glyph: { sides: 3, color: '#ff3a4a' }, term: 'Bleeding token', body: 'Wounded but not taken down by the Inciter\'s dual autopistols. A friendly Goremonger within 8 inches may remove the token to raise its own gore tank.' },
  'gm.apotheosis': { label: 'Apotheosis', glyph: { sides: 5, ring: true, color: '#ffb347' }, term: 'Apotheosis token', body: 'The Blood Herald has used Impending Apotheosis for this battle.' },
  'gm.gore-fuel': { label: 'Gore fuel', glyph: { sides: 4, color: '#ff6a3d' }, term: 'Gore fuel token', body: 'The Impaler\'s fleshskewer has Severe on both profiles until it next uses one of them.' },
  'gm.claim-skull': { label: 'Skull claimed', glyph: { sides: 6, ring: true, color: '#e8e2cc' }, term: 'Claim skull token', body: 'The Skullclaimer has claimed its skull for this turning point.' },
  // batch D: Chaos Cult
  'cc.ruinousIcon': { label: 'Ruinous Icon', glyph: { sides: 5, color: '#b44bff' }, term: 'Ruinous Icon token', body: 'The Iconarch\'s effect is in force: friendly cultists within 4 inches cut big Dmg by 1, or enemies within 4 inches take 1 more Dmg, until its next activation.' },
  // batch D: Exaction Squad
  'ex.marked-for-justice': { label: 'Marked for justice', glyph: { sides: 4, color: '#ffd24d', ring: true }, term: 'Marked for justice token', body: 'The enemy the squad marked this turning point: friendly Exaction Squad weapons have Punishing against it, and when it falls the squad may pick a new mark.' },
  'ex.medic': { label: 'Medic', glyph: { sides: 4, color: '#7be0a0' }, term: 'Medic token', body: 'Pulled back by Medic!: it was left on 1 wound and cannot be taken down for the rest of that action. It then dashes to the Chirurgant, and both have 1 less APL for a while.' },
  'ex.apprehend': { label: 'Apprehended', glyph: { sides: 6, color: '#ff7a3a' }, term: 'Apprehend token', body: 'Pinned by a Cyber-mastiff: its weapons hit 1 worse and it cannot Fall Back, while it stays in the mastiff\'s control range.' },
  'ex.veriscant': { label: 'Scanned', glyph: { sides: 24, ring: true, color: '#58d0ff' }, term: 'Veriscant token', body: 'Scanned by the Malocator: friendly Exaction Squad weapons have Lethal 5+ and Severe against it until the Malocator next activates or falls.' },
  'ex.revelatum-spot': { label: 'Spotted', glyph: { sides: 3, ring: true, color: '#e8c34d' }, term: 'Revelatum spot token', body: 'Spotted by the Revelatum: friendly Exaction Squad ranged weapons have Seek Light against it and it cannot be obscured, until the end of the turning point.' },
  'ex.marksman-optics': { label: 'Optics', glyph: { sides: 24, ring: true, color: '#9be0ff' }, term: 'Marksman optics token', body: 'The Marksman is lined up: its concealed and stationary shots have Lethal 5+ and enemies cannot be obscured to its executioner shotgun, until it next activates.' },
  'ex.aggressive': { label: 'Aggressive', glyph: { sides: 3, color: '#ff4a3a' }, term: 'Aggressive token', body: 'Attack Pattern: the mastiff\'s melee weapons have Relentless.' },
  'ex.swift': { label: 'Swift', glyph: { sides: 4, color: '#7bd44a' }, term: 'Swift token', body: 'Attack Pattern: the mastiff has +2 inches Move.' },
  'ex.defensive': { label: 'Defensive', glyph: { sides: 6, ring: true, color: '#c4cce0' }, term: 'Defensive token', body: 'Attack Pattern: the mastiff\'s Save is improved by 1.' },
  // batch D: Tempestus Aquilons
  'ta.detected': { label: 'Detected', glyph: { sides: 24, ring: true, color: '#6fd0ff' }, term: 'Detected token', body: 'Picked out by Eye Above for the turning point: when it shoots an Aquilon you may re-roll one defence die, and when it fights or retaliates against one, one of your blocks cancels two unresolved successes.' },
}

const FALLBACK_GLYPH: TokenGlyph = { sides: 24, color: '#d4d6e2' }

/** "pf.markerlight" -> "Markerlight", for kinds a later team adds before this table learns them. */
function kindLabel(kind: string): string {
  const raw = kind.includes('.') ? kind.slice(kind.indexOf('.') + 1) : kind
  return raw.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function tokenDef(kind: string): TokenDef {
  return DEFS[kind] ?? { label: kindLabel(kind), glyph: FALLBACK_GLYPH, term: `${kindLabel(kind)} token`, body: 'A token a team rule put on this operative.' }
}

/** SVG polygon points for a glyph of `sides` in a box of side `size` (a 4-sided glyph is a diamond). */
export function glyphPoints(sides: number, size: number): string {
  const r = size / 2
  const pts: string[] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2
    pts.push(`${(r + Math.cos(a) * (r - 0.5)).toFixed(2)},${(r + Math.sin(a) * (r - 0.5)).toFixed(2)}`)
  }
  return pts.join(' ')
}
