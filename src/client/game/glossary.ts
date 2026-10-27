// Glossary: every game term a player can read in the UI, with a short "what it is and what it does" body in our own wording (never
// Games Workshop text). Statuses, characteristics, the dice chain, the round structure, every action and every weapon trait,
// skill, fighter rule and wargear item the starter gangs use are written here; any other record of the data bundle (a trait, skill,
// rule, wargear item or action added later) is picked up from its own `text`, so nothing the engine can show is left without help.
//
// API: lookupTerm (a term, tolerant of parameters such as "Rapid Fire (2)" or "Blast 3\""), allEntries, linkTerms (split free
// text into plain and matched segments), traitLabel / traitParts (a weapon trait with its parameter, for the profile tables).
// Pure TS, no React. The index and the matching regex are built once, lazily.
import { dataBundle } from './adapter'

export type GlossaryKind = 'stat' | 'status' | 'condition' | 'rule' | 'dice' | 'trait' | 'action' | 'skill' | 'wargear'

export interface GlossaryEntry {
  term: string
  kind: GlossaryKind
  body: string
  aliases?: string[]
}

export type LinkedSegment = string | { text: string; entry: GlossaryEntry }

/** Short label for the small muted line above a tooltip body. */
export const KIND_LABEL: Record<GlossaryKind, string> = {
  stat: 'Characteristic',
  status: 'Status',
  condition: 'Condition',
  rule: 'Rule',
  dice: 'Dice',
  trait: 'Weapon trait',
  action: 'Action',
  skill: 'Skill',
  wargear: 'Wargear',
}

type Entry = Omit<GlossaryEntry, 'kind'>
const mk = (kind: GlossaryKind, list: Entry[]): GlossaryEntry[] => list.map((e) => ({ ...e, kind }))

// ---------------------------------------------------------------- characteristics

const STATS = mk('stat', [
  { term: 'M', aliases: ['Movement', 'Move stat'], body: 'Movement: how many inches the fighter may walk with one Move action. Two Moves in a row make a run.' },
  { term: 'WS', aliases: ['Weapon Skill'], body: 'Weapon Skill: roll a D6 for each close combat attack; a result at or above this number hits (a 1 always misses). Lower is better, so 3+ beats 5+.' },
  { term: 'BS', aliases: ['Ballistic Skill'], body: 'Ballistic Skill: roll a D6 to hit with a ranged weapon; a result at or above this number hits after range, cover and other modifiers are applied (a 1 always misses). Lower is better.' },
  { term: 'S', aliases: ['Strength'], body: 'Strength: compared with the target\'s Toughness to decide what a hit needs to wound. Many melee weapons add to it.' },
  { term: 'T', aliases: ['Toughness'], body: 'Toughness: the harder it is for a hit to wound the fighter, and the more Injury dice it can shrug off. Each Flesh Wound lowers it by one for the rest of the battle.' },
  { term: 'W', aliases: ['Wounds'], body: 'Wounds: how much damage the fighter can take. When the last Wound is lost the Injury dice are rolled.' },
  { term: 'I', aliases: ['Initiative'], body: 'Initiative: the number to roll on a D6 for reflexes such as breaking away from a fight, closing a door on someone, or resisting a flash. Concussion lowers it.' },
  { term: 'A', aliases: ['Attacks'], body: 'Attacks: how many dice a fighter rolls when it fights in close combat. Each die is one chance to hit.' },
  { term: 'Ld', aliases: ['Leadership'], body: 'Leadership: rolled on 2D6 for command tests. A gang\'s leaders and champions use it to hold their fighters together.' },
  { term: 'Cl', aliases: ['Cool'], body: 'Cool: rolled on 2D6. It decides nerve tests, whether a fighter will pick a farther target than the closest, whether it flees, and whether a Broken fighter rallies.' },
  { term: 'Wil', aliases: ['Willpower'], body: 'Willpower: rolled on 2D6 to resist fear and madness-type effects.' },
  { term: 'Int', aliases: ['Intelligence'], body: 'Intelligence: rolled on 2D6 for technical jobs, such as working a door terminal or picking a casket lock.' },
])

// ---------------------------------------------------------------- statuses and conditions

const STATUSES = mk('status', [
  { term: 'Standing and Active', aliases: ['Standing Active', 'Standing'], body: 'On its feet and not in base contact with an enemy. Can do almost anything: move, charge, shoot, aim, work doors.' },
  { term: 'Standing and Engaged', aliases: ['Engaged', 'Engagement'], body: 'On its feet and in base contact with an enemy. It can only Fight or try to Retreat. It cannot be pinned.' },
  { term: 'Pinned', aliases: ['Pin'], body: 'Driven to the floor by incoming fire and lying face up, with no facing and no vision arc. A standing fighter hit by a ranged attack is pinned at once, even if the shot does no harm. A pinned fighter can Stand Up, Crawl, Blind Fire or Reload.' },
  { term: 'Prone', body: 'Lying down, either Pinned or Seriously Injured. A prone fighter does not block line of sight, and at long range it is harder to hit. In cover it cannot be shot at at all.' },
  { term: 'Seriously Injured', aliases: ['Serious Injury'], body: 'Badly hurt and lying face down. It cannot attack, cannot be Engaged and can only Crawl. An enemy beside it can finish it with Coup de Grace. In the End phase a recovery roll decides whether it gets up, stays down or is taken Out of Action.' },
  { term: 'Out of Action', aliases: ['OOA', 'Down and out', 'Casualty'], body: 'Taken off the board for the rest of the battle. Friends within 3 inches must take a nerve test, and in most scenarios the other gang scores for it.' },
  { term: 'Broken', aliases: ['Break', 'Breaks'], body: 'Nerve has failed. A Broken fighter can only Run for Cover (moving away from the enemy), and its reaction attacks are at -2, until it passes a Rally test in the End phase.' },
  { term: 'Fled', aliases: ['Flees', 'Flight'], body: 'Left the battlefield for good after the gang bottled out. A fled fighter counts as Out of Action for scoring.' },
  { term: 'Ready', body: 'Has not acted yet this round. Every fighter becomes Ready in the Priority phase and loses it when it activates.' },
  { term: 'Flesh Wound', aliases: ['Flesh Wounds'], body: 'A lasting injury from the Injury dice. Each Flesh Wound lowers Toughness by one for the rest of the battle, and at Toughness 0 the fighter is Out of Action.' },
  { term: 'Blaze', body: 'On fire. When the fighter activates it takes no normal actions: it takes a hit, scrambles about, and tries to put itself out (6+ on a D6, helped by Pinned and nearby friends).' },
  { term: 'Blind', body: 'Flashed. Until its next activation the fighter can make no attacks except reaction attacks, and those hit only on a natural 6.' },
  { term: 'Concussion', body: 'Stunned: -2 to Initiative (never worse than 6+) until the end of the round.' },
  { term: 'Insane', body: 'Gripped by madness when it activates: it may break, be controlled by the enemy for the turn, or act normally. Only the Cursed trait causes it.' },
  { term: 'Out of Ammo', aliases: ['Out of ammo'], body: 'The weapon has no usable ammunition. Reload it with an Ammo test, unless it is Scarce or Single Shot.' },
])

// ---------------------------------------------------------------- the dice chain, rounds and other rules

const RULES = mk('rule', [
  { term: 'Round', aliases: ['Rounds'], body: 'One full cycle of a battle: a Priority phase, an Action phase where fighters take turns activating, and an End phase for nerve, recovery and rallying.' },
  { term: 'Priority', aliases: ['Priority phase', 'Priority roll'], body: 'Each round both gangs roll a die and the higher roll holds Priority: that gang activates first in the Action phase. A tie passes Priority to the gang that did not hold it last round.' },
  { term: 'Action phase', body: 'Gangs take turns activating one Ready fighter each, starting with the gang that holds Priority, until everyone has acted.' },
  { term: 'End phase', body: 'After the Action phase, in order: Bottle tests, fleeing, recovery for Seriously Injured fighters, rallying Broken fighters, then clean-up (smoke, Concussion).' },
  { term: 'Activation', aliases: ['Activate', 'Activates', 'Activated'], body: 'A fighter\'s turn: it chooses up to two actions, one at a time, then ends. A Double action takes both.' },
  { term: 'Group Activation', aliases: ['Group activation'], body: 'A leader or champion with this rule may bring along Ready friends within 3 inches. All are named first, then each fighter takes its own full activation in turn.' },
  { term: 'Simple action', aliases: ['Simple'], body: 'An action that costs one of the two actions. A Simple action may be done twice in one activation.' },
  { term: 'Basic action', aliases: ['Basic'], body: 'An action that costs one of the two actions, but only once per activation of the same kind.' },
  { term: 'Double action', aliases: ['Double'], body: 'An action that uses both of the fighter\'s actions.' },
  { term: 'Free action', aliases: ['Free'], body: 'An action that costs nothing, such as turning on the spot or ending the activation.' },
  { term: 'Vision arc', aliases: ['Facing', 'Front arc'], body: 'The 90 degree wedge in front of a fighter. It can only shoot or charge what it can see inside that wedge, and it may turn to face a new way before acting and after a move.' },
  { term: 'Cover', aliases: ['Partial cover', 'Full cover', 'In cover'], body: 'Something between the shooter and the target. Partial cover makes the hit roll 1 harder, full cover 2 harder. Against blasts and templates cover gives the target a better save instead. The engine works cover out from the line between the two bases.' },
  { term: 'Line of sight', aliases: ['LOS'], body: 'A straight line between the two bases that crosses no wall or closed door. Fighters and low obstacles never block it. Shooting also needs the target inside the vision arc.' },
  { term: 'Short range', aliases: ['Short'], body: 'The near band of a weapon\'s range. The hit roll gets the weapon\'s short-range accuracy modifier, which is often a bonus.' },
  { term: 'Long range', aliases: ['Long'], body: 'The far band of a weapon\'s range. The hit roll gets the long-range accuracy modifier, which is often a penalty. Past long range the shot misses.' },
  { term: 'Target priority', aliases: ['Closest target', 'Priority test'], body: 'A fighter must shoot the closest enemy it can see. To pick a farther one it must first pass a Cool test, unless the farther one is easier to hit or the closer one is Seriously Injured. A failed test sends the shot at the closest target.' },
  { term: 'Nerve test', aliases: ['Nerve', 'Nerve tests'], body: 'A Cool test (2D6, plus one for each steady friend within 3 inches) taken when a friend within 3 inches is Seriously Injured or goes Out of Action. A failure leaves the fighter Broken.' },
  { term: 'Bottle test', aliases: ['Bottle', 'Bottled', 'Bottles out', 'Bottle out'], body: 'In the End phase, a gang with fighters down rolls a D6 and adds the number of its fighters Seriously Injured or Out of Action. If the total beats the gang\'s starting crew, the gang bottles out for the rest of the battle and its fighters begin to flee.' },
  { term: 'Rally', aliases: ['Rally test'], body: 'In the End phase a Broken fighter takes a Cool test, helped by steady friends within 3 inches. A pass ends Broken.' },
  { term: 'Recovery test', aliases: ['Recovery'], body: 'In the End phase a Seriously Injured fighter rolls an Injury die: a Flesh Wound gets it up (pinned), Seriously Injured keeps it down with a Flesh Wound, Out of Action removes it. A friend beside it can assist.' },
  { term: 'Leading by Example', body: 'After the gang bottles out, a leader that passes its flee test steadies friends within 12 inches so they pass too (a champion does the same within 6 inches).' },
  { term: 'Hit roll', aliases: ['To hit', 'Hit chance'], body: 'A D6 against Ballistic Skill (ranged) or Weapon Skill (close combat), with modifiers for range, cover and the like. A natural 1 always misses.' },
  { term: 'Wound roll', aliases: ['To wound', 'Wound chance'], body: 'A D6 against a number set by Strength against Toughness: double or more needs 2+, higher 3+, equal 4+, lower 5+, half or less 6+. A natural 6 always wounds and a 1 never does.' },
  { term: 'Armour save', aliases: ['Save', 'Saves', 'Save chance'], body: 'A D6 against the target\'s armour, with the weapon\'s AP added to the roll. A pass stops the hit; a 1 always fails. Some hits allow no save.' },
  { term: 'AP', aliases: ['Armour piercing', 'Armour Piercing'], body: 'Armour penetration: added to the target\'s save roll. AP -1 turns a 4+ save into a 5+.' },
  { term: 'Damage', aliases: ['Dmg', 'D'], body: 'How many Wounds one unsaved hit takes off. When the last Wound is gone each extra point of Damage adds an Injury die.' },
  { term: 'Acc', aliases: ['Accuracy'], body: 'Accuracy: the modifier added to the hit roll at that range band. +1 is better, -1 is worse.' },
  { term: 'Am', aliases: ['Ammo', 'Ammo test'], body: 'Ammo: the number to roll on a D6 to keep the weapon loaded when the Ammo symbol shows. A fail marks it Out of Ammo. A dash means it never needs the roll.' },
  { term: 'Firepower dice', aliases: ['Firepower die', 'Firepower'], body: 'Special dice rolled whenever a weapon with an Ammo value attacks. Bullet holes are extra hits for Rapid Fire; the Ammo symbol forces an Ammo test.' },
  { term: 'Injury dice', aliases: ['Injury die', 'Injury roll', 'Injury'], body: 'Rolled when a fighter loses its last Wound. Each die shows a Flesh Wound (1-2), Seriously Injured (3-5) or Out of Action (6); Out of Action beats the rest.' },
  { term: 'Points', aliases: ['Gang points'], body: 'What a scenario awards for victory: usually for fighters put down or run off, and for objectives. The gang with more at the end wins.' },
  { term: 'Wargear', body: 'Armour and equipment a fighter carries. Armour gives an armour save; other items change how a fighter plays.' },
  { term: 'Gang', body: 'Your side. A gang has a leader, usually a champion or two, and ganger and juve fighters. It is built to a credit budget.' },
])

// ---------------------------------------------------------------- actions (written for players; the data keeps its own copy)

const ACTIONS = mk('action', [
  { term: 'Move', body: 'Walk up to your Movement in inches along any clear path. Crossing a low obstacle costs an extra inch. You cannot end within an inch of an enemy unless you are charging.' },
  { term: 'Charge', body: 'A double action. Move your Movement plus a D3 and end in base contact with an enemy, then make a free Fight. Fall short and you stop an inch away.' },
  { term: 'Shoot', body: 'One ranged attack: pick a weapon, pick a target you can see, roll to hit, then wound, then the target saves. Unwieldy weapons take both actions.' },
  { term: 'Aim', body: 'Steady the weapon for +1 to the hit roll of a later Shoot in the same activation.' },
  { term: 'Take Cover', body: 'Move up to half your Movement, then become Pinned, going to ground behind what is there.' },
  { term: 'Reload', body: 'Roll the weapon\'s Ammo number to bring an Out of Ammo weapon back. Scarce and Single Shot weapons cannot be reloaded.' },
  { term: 'Coup de Grace', body: 'Finish a Seriously Injured enemy within an inch and in front of you, taking it Out of Action. You must not be Engaged.' },
  { term: 'Operate Door', body: 'Open or close an unlocked door within an inch of you.' },
  { term: 'Access Terminal', body: 'Test Intelligence at -2 beside a door terminal. A pass works that door for free.' },
  { term: 'Force Door', body: 'Heave a locked door open: a D6 plus your Strength must reach 9, and each friend in base contact with the door adds 2.' },
  { term: 'Crawl Through Ductway', body: 'A double action. Squeeze into a ductway and come out at its other end.' },
  { term: 'Fire Through Ductway', body: 'Shoot along a ductway at an enemy within an inch of its far end. Only a 5+ hits.' },
  { term: 'Smash Open Loot Casket', body: 'Break a loot casket open: a D6 plus your Strength must reach 6. What is inside is rolled for, at -1.' },
  { term: 'Bypass Loot Casket Lock', body: 'Pick a casket lock with an Intelligence test.' },
  { term: 'Carry Loot Casket / Ammo Cache', aliases: ['Carry Loot Casket'], body: 'Pick up a casket or ammo cache and move with it, setting it down in base contact at the end.' },
  { term: 'Fight', body: 'Close combat against enemies in base contact: roll your Attacks, then each enemy still standing hits back with a reaction attack.' },
  { term: 'Retreat', body: 'Break away from close combat. You test Initiative, every enemy touching you may test Initiative to strike first, and if you pass you move up to a D6.' },
  { term: 'Stand Up', body: 'Get off the floor and become Standing and Active, choosing which way to face.' },
  { term: 'Crawl', body: 'A double action. Crawl up to half your Movement and stay prone.' },
  { term: 'Blind Fire', body: 'A double action for a Pinned fighter. Shoot in any direction at -2 to hit.' },
  { term: 'Running for Cover', aliases: ['Run for Cover', 'Runs for cover'], body: 'The only thing a Broken fighter can do: run for safety, as far from the enemy as it can get, out of sight if it can.' },
  { term: 'Turn', body: 'A free action. Face a new way before acting or after a move.' },
  { term: 'End Activation', aliases: ['End activation'], body: 'Stop acting. Any actions you have left are lost.' },
])

// ---------------------------------------------------------------- weapon traits (the ones the starter gangs use)

const TRAITS = mk('trait', [
  { term: 'Melee', body: 'A close combat weapon. Fighters carry it for fighting, not shooting.' },
  { term: 'Sidearm', body: 'Usable in close combat as well as at range (one attack die per sidearm), and two sidearms can be fired together at -1 to hit each.' },
  { term: 'Parry', body: 'When attacked in close combat, the wielder forces the attacker to re-roll one successful hit. Only another Power weapon can parry a Power weapon.' },
  { term: 'Disarm', body: 'A natural 6 to hit leaves the target able to make only unarmed reaction attacks for the rest of the round.' },
  { term: 'Rending', body: 'A natural 6 on the wound roll adds +1 Damage to that hit.' },
  { term: 'Power', body: 'A natural 6 to hit ignores the target\'s save (except field armour) and adds +1 Damage. Only another Power weapon can parry it.' },
  { term: 'Shock', body: 'A natural 6 to hit wounds automatically, with no wound roll.' },
  { term: 'Paired', body: 'A matching pair, one in each hand. They count as dual weapons, and charging doubles the base Attacks.' },
  { term: 'Pulverise', body: 'After an Injury die, roll a D6; at the target\'s Toughness or better a Flesh Wound becomes Seriously Injured.' },
  { term: 'Knockback', body: 'If the hit roll is at least the target\'s Strength, the target is pushed 1 inch straight away. If something blocks the push it takes +1 Damage.' },
  { term: 'Plentiful', body: 'Plenty of ammunition: Reload tests pass without rolling.' },
  { term: 'Scarce', body: 'Very little ammunition: the weapon can never be reloaded.' },
  { term: 'Unstable', body: 'If the Ammo symbol shows, roll a D6: on 1-3 the shooter goes Out of Action.' },
  { term: 'Unwieldy', body: 'Takes two weapon slots. Shooting with it costs both actions, and it cannot be paired in melee (the Bulging Biceps skill lifts that for close combat weapons).' },
  { term: 'Rapid Fire', body: 'After a successful hit roll, up to X Firepower dice are rolled. Each bullet hole is a further hit, which can be spread to enemies close to the target.' },
  { term: 'Scattershot', body: 'A hit throws a spray of pellets: it makes a D6 wound rolls instead of one.' },
  { term: 'Template', body: 'A flame jet. No hit roll: every fighter under the template is hit, unless a wall or door is in the way. Check for friends.' },
  { term: 'Blast', body: 'Hits every fighter under a marker of the stated size. It can be placed on a target or a floor point, and it can scatter on a miss.' },
  { term: 'Smoke', body: 'No hit, wound or pin. Leaves a cloud 2.5 inches in radius that blocks sight into, out of and through it; each End phase it clears on a 1-4.' },
  { term: 'Backstab', body: 'An attacker outside the target\'s vision arc gains +1 Strength.' },
  { term: 'Versatile', body: 'Can fight at the weapon\'s reach, and the target counts as engaged only for that attack. Only fighters in base contact can assist.' },
  { term: 'Toxin', body: 'No wound roll: a D6 that meets the target\'s Toughness causes an Injury die. The target may still save.' },
  { term: 'Silent', body: 'Makes no noise. Matters only to sneak attacks, which this game does not use.' },
  { term: 'Limited', body: 'When this ammunition runs out it is gone for the battle, though the weapon\'s other profiles can still be reloaded.' },
  { term: 'Single Shot', body: 'One use per battle. The weapon is spent after it fires.' },
  { term: 'Twin-linked', body: 'Two barrels working as one weapon. Listed on a weapon profile as a variant of its base weapon.' },
])

// ---------------------------------------------------------------- skills, rules and wargear used by the starter gangs

const SKILLS = mk('skill', [
  { term: 'Nerves of Steel', body: 'When hit by a ranged attack, the fighter may pass a Cool test to avoid being pinned.' },
  { term: 'True Grit', body: 'One fewer Injury die is rolled for this fighter. If that would leave none, two are rolled and one is discarded.' },
  { term: 'Unstoppable', body: 'Before a Recovery test, roll a D6. On 4+ a Flesh Wound is removed, or with none the test gets an extra die and the worst is dropped.' },
  { term: 'Spring Up', body: 'A pinned fighter that activates may pass an Initiative test to stand up for free.' },
  { term: 'Dodge', body: 'A 6+ save that nothing can modify, usable against ranged and close attacks on top of the armour save. Against blasts and templates a pass also lets the fighter step up to 2 inches.' },
])

const FIGHTER_RULES = mk('skill', [
  { term: 'Gang Hierarchy', body: 'Marks a fighter as part of the command structure (a Leader or Champion). It carries Leading by Example: 12 inches for a Leader, 6 for a Champion.' },
  { term: 'Gang Leader', body: 'The one fighter every gang must have. It leads the gang and its death is a heavy blow.' },
  { term: 'Gang Fighter', body: 'A rank-and-file fighter. At least half of a gang must be gang fighters.' },
  { term: 'Group Activation (X)', aliases: ['Group Activation X'], body: 'When this fighter activates, up to X more Ready friends within 3 inches may activate with it. Name them all first, then each acts in full.' },
  { term: 'Combat Chems Stash', body: 'At the start of its activation roll a D6 to see which chem the fighter takes: from no change up to +3 Attacks until the end of the round.' },
  { term: 'Hot-headed', body: 'When this fighter is Seriously Injured or goes Out of Action, its friends skip the nerve test they would take for it.' },
  { term: 'Poison Blood', body: 'A Death-Maiden using a Toxin weapon may re-roll a natural 1 on its Toughness roll.' },
])

const WARGEAR = mk('wargear', [
  { term: 'Furnace plates', body: 'Heavy scrap plating, worn as the fighter\'s armour. The save is better against attacks from the front arc, and a prone fighter has no front arc.' },
  { term: 'Armoured undersuit', body: 'Adds one to the wearer\'s armour save and stacks with one other armour item. A fighter with no armour counts as having a 7+ save.' },
  { term: 'Mesh armour', body: 'Flexible mesh worn over the body for a modest save.' },
  { term: 'Flak armour', body: 'Basic body protection. The save is one better against blasts and flame templates.' },
  { term: 'Phelynx', body: 'An exotic pet. It is not part of the fight in this build and is only listed for the gang\'s cost.' },
])

// ---------------------------------------------------------------- index

let cachedEntries: GlossaryEntry[] | null = null
let index: Map<string, GlossaryEntry> | null = null
let matcher: RegExp | null = null

const norm = (s: string): string => s.trim().replace(/[″"]/g, '"').replace(/\s+/g, ' ').toLowerCase()

/** Records of the data bundle that the hand-written lists above do not cover, taken with their own text. */
function fromData(have: Set<string>): GlossaryEntry[] {
  const b = dataBundle()
  const out: GlossaryEntry[] = []
  const add = (kind: GlossaryKind, name: string, text: string) => {
    const k = norm(name)
    if (have.has(k) || !text) return
    have.add(k)
    out.push({ term: name, kind, body: text })
  }
  for (const t of Object.values(b.traits)) add('trait', t.name, t.text)
  for (const a of Object.values(b.actions)) add('action', a.name, a.text)
  for (const s of Object.values(b.skills)) add('skill', s.name, s.text)
  for (const r of Object.values(b.rules)) add('skill', r.name, r.text)
  for (const w of Object.values(b.wargear)) add('wargear', w.name, w.text)
  return out
}

function entries(): GlossaryEntry[] {
  if (cachedEntries) return cachedEntries
  const own = [...STATS, ...STATUSES, ...RULES, ...ACTIONS, ...TRAITS, ...SKILLS, ...FIGHTER_RULES, ...WARGEAR]
  const have = new Set<string>()
  for (const e of own) {
    have.add(norm(e.term))
    for (const a of e.aliases ?? []) have.add(norm(a))
  }
  cachedEntries = [...own, ...fromData(have)]
  return cachedEntries
}

function buildIndex(): Map<string, GlossaryEntry> {
  if (index) return index
  index = new Map()
  // earlier kinds win a shared name ("Move" is the action, not the stat key M; "Power" the trait)
  for (const e of entries()) {
    for (const t of [e.term, ...(e.aliases ?? [])]) {
      const k = norm(t)
      if (!index.has(k)) index.set(k, e)
    }
  }
  return index
}

export function allEntries(): GlossaryEntry[] {
  return entries().slice()
}

/** Remove a trailing parameter: "Rapid Fire (2)", "Rapid Fire 2", "Blast 3\"", "Plentiful 4+" -> the bare name. */
function stripParam(t: string): string {
  return t.replace(/\s*\(?\s*[\dXx]+(\.\d+)?\s*(["+]|″)?\s*\)?\s*$/, '').trim()
}

/** The entry for a term (exact, alias, or with its parameter stripped), preferring `kind` when a name is shared. */
export function lookupTerm(term: string, kind?: GlossaryKind): GlossaryEntry | null {
  const idx = buildIndex()
  const k = norm(term)
  if (kind) {
    const hit = entries().find((e) => e.kind === kind && [e.term, ...(e.aliases ?? [])].some((a) => norm(a) === k || norm(a) === norm(stripParam(term))))
    if (hit) return hit
  }
  return idx.get(k) ?? idx.get(norm(stripParam(term))) ?? null
}

// Terms too common as plain words to link inside running text; they still resolve when asked for directly.
const NO_LINK = new Set(['i', 'a', 'd', 'm', 's', 't', 'w', 'am', 'free', 'short', 'long', 'save', 'saves', 'move', 'turn', 'fight', 'shoot', 'aim', 'crawl', 'basic', 'simple', 'double', 'standing', 'ready', 'break', 'breaks', 'recovery', 'injury', 'gang', 'points', 'rally', 'pin', 'fled', 'flees', 'flight', 'activate', 'activates', 'activated', 'engagement', 'closest target', 'priority test', 'nerve'])

function buildMatcher(): RegExp {
  if (matcher) return matcher
  const terms: string[] = []
  for (const e of entries()) for (const t of [e.term, ...(e.aliases ?? [])]) if (t.length > 2 && !NO_LINK.has(norm(t))) terms.push(t)
  terms.sort((p, q) => q.length - p.length)
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
  matcher = new RegExp(`(?<![\\w-])(${esc.join('|')})(?:\\s*\\(?\\d+["+]?\\)?)?(?![\\w])`, 'g')
  return matcher
}

const linkCache = new Map<string, LinkedSegment[]>()

/** Split free text into plain strings and glossary terms (matched case-sensitively as written in the glossary, so everyday words stay plain). */
export function linkTerms(text: string, opts: { keywords?: boolean } = {}): LinkedSegment[] {
  const key = `${opts.keywords === false ? 'p' : 'k'}|${text}`
  const hit = linkCache.get(key)
  if (hit) return hit
  const re = buildMatcher()
  re.lastIndex = 0
  const out: LinkedSegment[] = []
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const entry = lookupTerm(m[1]!)
    // case-sensitive against the printed form so "move" in a sentence is not linked
    if (!entry || ![entry.term, ...(entry.aliases ?? [])].some((t) => m![1] === t)) continue
    if (opts.keywords === false && (entry.kind === 'stat' || entry.kind === 'skill')) continue
    if (m.index > at) out.push(text.slice(at, m.index))
    out.push({ text: m[0], entry })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  if (out.length === 0) out.push(text)
  if (linkCache.size > 600) linkCache.clear()
  linkCache.set(key, out)
  return out
}

// ---------------------------------------------------------------- weapon traits with their parameter

export interface TraitUseLike {
  trait: string
  x?: number
  inches?: number
  target?: number | string
}

/** The glossary term (trait name) and the label to print ("Rapid Fire (2)", "Blast (3\")", "Unstable"). */
export function traitParts(use: TraitUseLike, nameOf: (id: string) => string): { term: string; label: string } {
  const name = nameOf(use.trait)
  const param = use.x !== undefined ? `${use.x}` : use.inches !== undefined ? `${use.inches}"` : use.target !== undefined ? `${String(use.target).replace(/\+?$/, '+')}` : ''
  return { term: name, label: param ? `${name} (${param})` : name }
}

export function traitLabel(use: TraitUseLike, nameOf: (id: string) => string): string {
  return traitParts(use, nameOf).label
}
