// Glossary: every game term a player can read in the UI, with a one-to-three sentence "what it is and what it does"
// body in our own wording (never Games Workshop text). Core terms are written here from docs/spec/10-rules-core.md
// and 11-missions.md; weapon rules, operative keywords, abilities, ploys, equipment and unique actions are built
// from the data bundle, so a record added to the JSON data shows up with no change here.
//
// API: lookupTerm (exact term, tolerant of parameters), allEntries, linkTerms (split free text into plain and
// matched segments). Pure TS, no React. The index and the matching regex are built once, lazily.
import { ACTION_HELP, ACTION_LABEL, humanize } from './labels'
import { dataBundle } from './adapter'

export type GlossaryKind = 'stat' | 'status' | 'rule' | 'weaponRule' | 'keyword' | 'ability' | 'ploy' | 'equipment' | 'action'

export interface GlossaryEntry {
  term: string
  kind: GlossaryKind
  body: string
  aliases?: string[]
}

export type LinkedSegment = string | { text: string; entry: GlossaryEntry }

/** Short label for the small muted line above a tooltip body. */
export const KIND_LABEL: Record<GlossaryKind, string> = {
  stat: 'Stat',
  status: 'Status',
  rule: 'Rule',
  weaponRule: 'Weapon rule',
  keyword: 'Keyword',
  ability: 'Ability',
  ploy: 'Ploy',
  equipment: 'Equipment',
  action: 'Action',
}

// ---------------------------------------------------------------- core terms (own wording, spec R-/M- cited)

type Core = Omit<GlossaryEntry, 'kind'> & { kind?: GlossaryKind }

const CORE: Core[] = [
  // stats
  { term: 'APL', kind: 'stat', aliases: ['Action point limit'], body: 'Action Point Limit: the most AP this operative may spend in one activation. Rules can add or remove APL, but never more than 1 away from the printed value.' },
  { term: 'AP', kind: 'stat', aliases: ['Action points', 'Action point'], body: 'Action points. Each action costs AP (usually 1) out of the activation budget set by APL; unspent AP is lost when the activation ends.' },
  { term: 'Move', kind: 'stat', aliases: ['Move stat'], body: 'How many inches the operative can travel with Reposition (Charge adds 2). Climbing and dropping cost extra, and Move is never reduced below 4 inches.' },
  { term: 'Save', kind: 'stat', aliases: ['Save stat'], body: 'The target number for defence dice: each defence die that rolls this or higher is a success, and a 6 is a critical success. Lower is better.' },
  { term: 'Wounds', kind: 'stat', aliases: ['Wound'], body: 'How much damage the operative can take. At 0 it is incapacitated and removed; below half it is Injured.' },
  { term: 'Atk', kind: 'stat', aliases: ['Attacks', 'Attack stat'], body: 'Attacks: how many attack dice the weapon rolls each time it is used.' },
  { term: 'Hit', kind: 'stat', aliases: ['Hit stat'], body: 'The target number for attack dice: a die at this value or higher is a success, a 6 is always a critical success and a 1 always fails. Lower is better.' },
  { term: 'Dmg', kind: 'stat', aliases: ['Damage'], body: 'Damage per successful attack die, shown as normal/critical. A normal success deals the first number and a critical success deals the second, taken off the target\'s Wounds.' },
  { term: 'Weapon rules', kind: 'rule', aliases: ['Weapon rule'], body: 'Special rules printed on a weapon profile, such as Piercing or Blast. They change how an attack with that weapon plays out; hover each one for its effect.' },

  // dice
  { term: 'Attack dice', kind: 'rule', aliases: ['Attack die'], body: 'The dice the attacker rolls, one per point of Atk. Each success that survives blocking deals damage.' },
  { term: 'Defence dice', kind: 'rule', aliases: ['Defence die', 'Defense dice'], body: 'The defender collects three defence dice when shot (fewer with Piercing). Each success can block an attack die, and a cover save keeps one without rolling.' },
  { term: 'Normal success', kind: 'rule', aliases: ['Normal successes', 'Normal hit', 'Normal hits', 'Normals'], body: 'A die that met its target number but is not a 6. It deals normal damage, or blocks one normal success.' },
  { term: 'Critical success', kind: 'rule', aliases: ['Critical successes', 'Critical', 'Crit', 'Crits', 'Critical hit', 'Critical hits', 'Critical damage'], body: 'A natural 6 (or a result a rule upgrades). It deals critical damage, can block either kind of success, and triggers rules that need a crit.' },
  { term: 'Fail', kind: 'rule', aliases: ['Fails', 'Failure'], body: 'A die below its target number, or any natural 1. A failed die is discarded and does nothing.' },
  { term: 'Block', kind: 'rule', aliases: ['Blocks', 'Blocked'], body: 'Spend a defence success to cancel an attack success. A normal blocks a normal, two normals block a crit, and a crit blocks either. Unblocked successes deal damage.' },
  { term: 'Retain', kind: 'rule', aliases: ['Retained', 'Retains'], body: 'A die that counts towards the result. Rolled successes are retained, failures are discarded, and some rules retain a die without rolling it (a cover save). A die can be retained only once.' },
  { term: 'Re-roll', kind: 'rule', aliases: ['Re-rolls', 'Reroll', 'Rerolls', 'Re-rolled'], body: 'Roll a die again and keep the new result, even if it is worse. A die can be re-rolled only once.' },
  { term: 'Cover save', kind: 'rule', aliases: ['Cover saves'], body: 'When the target is in cover, the defender keeps one defence die as a normal success without rolling it, then rolls the rest. Saturate weapons deny it.' },
  { term: 'D6', kind: 'rule', body: 'A six-sided die. Results are compared to a target such as 4+, which means a 4, 5 or 6.' },
  { term: 'D3', kind: 'rule', body: 'Roll a D6 and halve it, rounding up: 1-2 gives 1, 3-4 gives 2, 5-6 gives 3.' },
  { term: 'Strike', kind: 'rule', aliases: ['Strikes'], body: 'In a fight, spend one of your successes to hit the enemy at once for its damage, instead of using it to block.' },

  // orders and statuses
  { term: 'Order', kind: 'status', aliases: ['Orders'], body: 'Engage or Conceal, chosen at the start of each activation and kept until that operative next activates. Operatives are set up on Conceal.' },
  { term: 'Engage', kind: 'status', body: 'Order. The operative may take any action, including Charge, Guard and Shoot, and can counteract. Enemies can target it even while it is in cover, though it still gets the cover save.' },
  { term: 'Conceal', kind: 'status', body: 'Order. Hides the operative: it cannot Charge, cannot Shoot (unless the weapon is Silent) and cannot counteract, and it cannot be targeted while in cover. It can still Fight.' },
  { term: 'Ready', kind: 'status', body: 'Has not yet activated this turning point. All operatives become ready in the Ready step, and each ready operative activates once.' },
  { term: 'Expended', kind: 'status', body: 'Has finished its activation this turning point. An expended operative acts again only by counteracting (if it has Engage) or after the next Ready step.' },
  { term: 'Injured', kind: 'status', body: 'Below half its starting Wounds. An injured operative loses 2 inches of Move (never below 4) and worsens the Hit of all its weapons by 1.' },
  { term: 'Incapacitated', kind: 'status', aliases: ['Incapacitates'], body: 'Reduced to 0 Wounds. It is removed from the killzone once the current action finishes, and counts towards the opponent\'s kill op.' },
  { term: 'On Guard', kind: 'status', body: 'Holding position after a Guard action. After an enemy finishes an action, you may interrupt with a free Shoot or Fight from this operative. Guard ends when it acts, moves, changes order or the turning point ends.' },
  { term: 'Visible', kind: 'status', body: 'A clear straight line from the viewer\'s head to any part of the other operative, not blocked by terrain. Bases are ignored.' },
  { term: 'Obscured', kind: 'status', body: 'Heavy terrain stands between shooter and target. The attacker\'s crits count only as normal successes and one success of their choice is discarded.' },
  { term: 'In cover', kind: 'status', aliases: ['Cover'], body: 'Terrain stands between shooter and target within 1 inch of the target, and the shooter is more than 2 inches away. The defender may keep one defence die without rolling it. A Conceal operative in cover cannot be targeted.' },
  { term: 'Improved cover', kind: 'status', body: 'A cover save upgraded by Vantage or a similar rule: the defender may keep the saved die as a critical success, or take one extra cover save instead.' },
  { term: 'Valid target', kind: 'rule', aliases: ['Valid targets'], body: 'An enemy you may shoot: it has no friendly operative in its control range, is within the weapon\'s Range if it has one, and is visible (and, if it has Conceal, not in cover).' },
  { term: 'Control range', kind: 'rule', aliases: ['CR', 'Control ranges'], body: 'The area around an operative: anything it can see within 1 inch. An enemy inside it stops you using Reposition, Dash or Shoot, and is required for Fight and Fall Back.' },
  { term: 'Wholly within', kind: 'rule', body: 'Every part of the base lies inside the area. Plain "within" only needs any part of it inside.' },
  { term: 'Contest', kind: 'rule', aliases: ['Contests', 'Contesting'], body: 'An operative contests an objective marker when the marker is in its control range. Contesting operatives decide who controls the marker.' },
  { term: 'Control', kind: 'rule', aliases: ['Controls', 'Controlled', 'Controlling'], body: 'You control a marker when your contesting operatives have more total APL than the enemy\'s. Control is checked between actions.' },
  { term: 'Objective marker', kind: 'rule', aliases: ['Objective markers', 'Marker', 'Markers', 'Objective'], body: 'A 40mm marker on the killzone floor that the mission scores. Operatives near it contest it, and the side with more total APL controls it.' },
  { term: 'Killzone', kind: 'rule', body: 'The 30 inch by 22 inch play area, with its terrain, drop zones and objective markers.' },
  { term: 'Drop zone', kind: 'rule', aliases: ['Drop zones'], body: 'The strip along your edge of the killzone where your operatives are set up at the start of the battle.' },
  { term: 'Territory', kind: 'rule', aliases: ['Territories'], body: 'Your half of the killzone, on your side of the centreline. Equipment is set up inside it.' },

  // terrain
  { term: 'Light terrain', kind: 'rule', body: 'Terrain with no special rule of its own. It can give cover, and rules such as Seek Light and Vantage refer to it.' },
  { term: 'Heavy terrain', kind: 'rule', body: 'Solid terrain that can obscure a target when it stands between shooter and target (unless it is within 1 inch of either operative).' },
  { term: 'Vantage', kind: 'rule', body: 'A raised level operatives can stand on. Shooting from it at a target at least 2 inches lower gives Accurate 1 against Engage targets (Accurate 2 at 4 inches) and stops Conceal targets using Light terrain for cover, and Heavy terrain joined to the Vantage is ignored for obscured.' },
  { term: 'Accessible', kind: 'rule', body: 'Terrain operatives can move through, at 1 extra inch of movement. Only the centre of the base has to pass.' },
  { term: 'Exposed', kind: 'rule', body: 'Terrain that never counts as in the way: it gives no cover and cannot obscure.' },
  { term: 'Insignificant', kind: 'rule', body: 'Terrain ignored for climbing and dropping, so operatives cross it without going up and down.' },
  { term: 'Blocking', kind: 'rule', body: 'Terrain that stops sight lines and counts as in the way for cover and obscured.' },
  { term: 'Barred', kind: 'rule', body: 'Terrain nobody can see through unless the viewer or the viewed operative is within 1 inch of it.' },
  { term: 'Ceiling', kind: 'rule', body: 'Terrain with an underside that small-based operatives can still move beneath, whatever its height.' },
  { term: 'Support', kind: 'rule', body: 'Tag on actions that help friendly operatives, such as Get It Dun! and Listen In. A friendly Comms Device adds 3 inches to their distances.' },

  // sequence of play
  { term: 'Turning point', kind: 'rule', aliases: ['Turning points', 'TP'], body: 'One round of the battle: a Strategy phase, then a Firefight phase. A battle lasts four turning points.' },
  { term: 'Strategy phase', kind: 'rule', body: 'The first half of a turning point: roll for initiative, gain CP and ready everyone, then take turns using strategic gambits or passing.' },
  { term: 'Firefight phase', kind: 'rule', body: 'The second half of a turning point: players alternate activating one ready operative at a time until everyone is expended.' },
  { term: 'Initiative', kind: 'rule', body: 'Decided by a die roll each turning point. The initiative player acts first in the Firefight phase and gets less CP than their opponent; ties go to the player who did not hold it before.' },
  { term: 'Activation', kind: 'rule', aliases: ['Activate', 'Activates', 'Activations', 'Activated'], body: 'One operative\'s turn: pick an order, spend up to its APL in AP on actions, then become expended.' },
  { term: 'Counteract', kind: 'rule', aliases: ['Counteracts', 'Counteraction', 'Counteractions'], body: 'When all your operatives are expended and the enemy still has a ready one, you may pick an expended Engage operative to take one free 1 AP action (never Guard), moving at most 2 inches. Once per operative per turning point.' },
  { term: 'Interrupt', kind: 'rule', aliases: ['Interrupts'], body: 'Once per enemy activation, after an enemy finishes an action, a friendly On Guard operative may take a free Shoot or Fight. It then cannot counteract this turning point.' },
  { term: 'Assist', kind: 'rule', aliases: ['Assists', 'Assisting'], body: 'In a fight, each friendly operative in the enemy fighter\'s control range (and no other enemy\'s) improves the fighter\'s melee Hit by 1.' },
  { term: 'Retaliate', kind: 'rule', aliases: ['Retaliates', 'Retaliation'], body: 'When fought, the defending operative picks a melee weapon and rolls its own dice, and both sides then take turns striking or blocking.' },
  { term: 'Command points', kind: 'rule', aliases: ['Command point', 'CP'], body: 'The currency for ploys and Command Re-rolls. You gain CP each turning point and they carry over with no cap, but can never go below 0.' },
  { term: 'Victory points', kind: 'rule', aliases: ['Victory point', 'VP'], body: 'The score. The kill op and crit op award VP; the player with the most at the end of turning point 4 wins.' },
  { term: 'Strategy ploy', kind: 'ploy', aliases: ['Strategy ploys', 'Strategic gambit', 'Strategic gambits', 'Strategic Gambit'], body: 'A ploy used in the Strategy phase, once per turning point each, usually for 1 CP. Its effect lasts until the end of the turning point unless it says "immediately".' },
  { term: 'Firefight ploy', kind: 'ploy', aliases: ['Firefight ploys'], body: 'A ploy used during the Firefight phase, usually for 1 CP, at the moment its text names. Each can be used once per turning point, except Command Re-roll.' },
  { term: 'Ploy', kind: 'ploy', aliases: ['Ploys'], body: 'A special move paid for with CP: a Strategy ploy in the Strategy phase or a Firefight ploy in the Firefight phase.' },
  { term: 'Gambit', kind: 'ploy', aliases: ['Gambits'], body: 'Another name for a strategy ploy: during the Strategy phase players alternate using one or passing, and the step ends when both pass in a row.' },
  { term: 'Equipment', kind: 'equipment', body: 'Optional kit chosen when selecting your kill team: up to four options, each at most once per game. Some become markers or terrain set up in your territory.' },
  { term: 'Unique action', kind: 'action', aliases: ['Unique actions'], body: 'An action printed on a team or operative card rather than the universal list. It costs the AP it states and follows the usual limits.' },
  { term: 'Mission action', kind: 'action', aliases: ['Mission actions'], body: 'An action the mission gives every operative, such as Secure or Loot. It usually needs an objective marker you control and no enemy in control range.' },
  { term: 'Free action', kind: 'action', aliases: ['Free actions'], body: 'An action granted by a rule that costs no AP but still counts as having been performed.' },

  // missions
  { term: 'Kill op', kind: 'rule', aliases: ['Kill ops', 'Kill grade'], body: 'Scored every game: your kill grade rises (to 5) as enemy operatives are incapacitated and each new grade is 1 VP. If your grade ends higher than the enemy\'s, you score 1 more.' },
  { term: 'Crit op', kind: 'rule', aliases: ['Crit ops', 'Critical operation'], body: 'The mission\'s objective-marker scoring (Secure, Loot or Transmission), the same for both players, picked by a die roll at setup. It scores from the end of turning point 2.' },
  { term: 'Tac op', kind: 'rule', aliases: ['Tac ops', 'Tactical operation'], body: 'A secret goal tied to your team\'s archetype. Not in this build yet: only the kill op and crit op score.' },
  { term: 'Secured', kind: 'rule', aliases: ['Secure marker'], body: 'An objective marker marked as yours by the Secure action. It stays yours until the enemy secures it, and holding secured markers scores at the end of each turning point from the second.' },
  { term: 'Transmitting', kind: 'rule', aliases: ['Transmission', 'Transmissions'], body: 'An objective marker switched on by Initiate Transmission. It runs until the start of the next turning point, and controlling transmitting markers scores at turning point end.' },
  { term: 'Looted', kind: 'rule', aliases: ['Looted marker'], body: 'An objective marker already looted this turning point. Each marker can be looted once per turning point, and each loot scores 1 VP, up to 2 per turning point.' },
]

/** Single-word terms that are safe to link in lower case too (they are never ordinary prose). */
const LOWER_OK = new Set([
  'injured', 'expended', 'incapacitated', 'incapacitates', 'conceal', 'engage', 'obscured', 'vantage', 'counteract', 'counteracts', 'counteraction', 'counteractions',
  'critical', 'crit', 'crits', 're-roll', 're-rolls', 'reroll', 'rerolls', 'activation', 'activations', 'initiative', 'ploy', 'ploys', 'gambit', 'gambits',
  'interrupt', 'interrupts', 'assist', 'assists', 'retaliate', 'retaliates', 'strategy ploy', 'transmitting', 'secured', 'looted',
])

const ACTION_COST: Record<string, string> = { reposition: '1 AP', dash: '1 AP', charge: '1 AP', guard: '1 AP', shoot: '1 AP', fight: '1 AP' }

function actionEntries(): GlossaryEntry[] {
  const out: GlossaryEntry[] = []
  for (const id of Object.keys(ACTION_HELP)) {
    const term = ACTION_LABEL[id] ?? id
    const cost = ACTION_COST[id]
    out.push({ term, kind: 'action', body: cost ? `${cost}. ${ACTION_HELP[id]}` : ACTION_HELP[id]!, ...(id === 'end' ? { aliases: ['End activation'] } : {}) })
  }
  out.push(
    { term: 'Pick Up Marker', kind: 'action', aliases: ['Pick Up', 'Pick up marker'], body: '1 AP. Pick up a marker you control that this action may be used on; you now carry, contest and control it. Not in enemy control range or while already carrying one.' },
    { term: 'Place Marker', kind: 'action', aliases: ['Place', 'Place marker'], body: '1 AP. Put a marker you carry down within your control range. An operative incapacitated while carrying one must place it first, for free.' },
    { term: 'Door Fight', kind: 'action', body: '1 AP. Fight an enemy on the other side of a door you touch, within 2 inches; for this action you count as in each other\'s control range.' },
  )
  return out
}

// ---------------------------------------------------------------- data-built entries

interface RecordLike { id: string; name?: string; text?: string; kind?: string; param?: string; ap?: number; cost?: number; type?: string; scope?: string; count?: number; critsVariant?: boolean; team?: string; stats?: unknown; keywords?: string[] }

const ROLE_KEYWORD: Record<string, string> = {
  LEADER: 'Role keyword: the one commander each kill team must include. Angels of Death take a Captain or a Sergeant, Kommandos take the Boss Nob. Leader abilities such as Heroic Leader build on it.',
  SERGEANT: 'Squad-leader role. Angels of Death Sergeants can fill the Leader slot and carry Doctrine Warfare and Chapter Veteran.',
  'SPACE MARINE CAPTAIN': 'The Angels of Death Captain: a Leader with Iron Halo and Heroic Leader, able to bend the team\'s ploys.',
  GRENADIER: 'Role keyword of the Assault Intercessor Grenadier, whose Grenadier ability sharpens frag and krak grenades.',
  WARRIOR: 'Basic trooper role. Warriors are the Angels of Death selections that may be taken more than once.',
  GUNNER: 'Heavy-weapon role (Intercessor and Heavy Intercessor Gunners). It identifies the operative type for roster selection; no rule refers to it directly.',
  SNIPER: 'Long-range marksman role: the Eliminator Sniper, who has Camo Cloak and the Optics action.',
  'ASSAULT INTERCESSOR': 'Operative type: close-range Intercessors. Identifies the datacard for roster selection; no rule refers to it directly.',
  INTERCESSOR: 'Operative type: bolt-rifle Intercessors. Identifies the datacard for roster selection; no rule refers to it directly.',
  'HEAVY INTERCESSOR': 'Operative type: Heavy Intercessors. Identifies the datacard for roster selection; no rule refers to it directly.',
  ELIMINATOR: 'Operative type: Eliminators, stealthy marksmen. Identifies the datacard for roster selection; no rule refers to it directly.',
  IMPERIUM: 'Allegiance keyword carried by every Angels of Death operative. Rules naming it would apply to all of them; no current rule does, so it only identifies the operative.',
  'ADEPTUS ASTARTES': 'Space Marine keyword carried by every Angels of Death operative. Rules naming it would apply to all of them; no current rule does, so it only identifies the operative.',
  ORK: 'Species keyword carried by every Kommando operative. Rules naming it would apply to all of them; no current rule does, so it only identifies the operative.',
  'BOSS NOB': 'The Kommando Leader. Krumpin\' Time lets it Fight twice in one activation, and Get It Dun! pushes another Kommando on.',
  'BOMB SQUIG': 'A walking explosive. It cannot take Conceal, is left out of Throat Slittas, is ignored by the opponent\'s kill op (Expendable), and can blow up (Boom!, Explosive).',
  BOY: 'Rank-and-file Kommando, the only selection that may be taken several times. Taktical Wot-notz lets one Boy throw a smoke grenade and one a stun grenade each turning point.',
  'BREACHA BOY': 'Kommando who carries the Breach unique action, which opens up terrain by marking it Accessible.',
  'BURNA BOY': 'Kommando flamer specialist. Identifies the datacard for roster selection; no rule refers to it directly.',
  'COMMS BOY': 'Kommando signaller: I Got a Plan, Ladz makes marker and mission actions cheaper, and Listen In boosts another Kommando\'s APL.',
  'DAKKA BOY': 'Kommando gunner with the Dakka Dash unique action (a free Dash and a free Shoot).',
  GROT: 'Small Kommando helper. It counts as half a selection, never takes Engage (so it cannot counteract), and has Sneaky Zogger and Grappling Hook.',
  'ROKKIT BOY': 'Kommando rocket specialist. Identifies the datacard for roster selection; no rule refers to it directly.',
  'SLASHA BOY': 'Kommando bruiser whose Dat All You Got? can deal extra damage after it fights and survives.',
  'SNIPA BOY': 'Kommando marksman whose Concealed Position profile can be used only on its first Shoot of the battle.',
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
}

function keywordEntries(): GlossaryEntry[] {
  const b = dataBundle()
  const out = new Map<string, GlossaryEntry>()
  for (const team of Object.values(b.teams)) {
    const fk = team.factionKeyword
    out.set(fk, {
      term: fk,
      kind: 'keyword',
      body: `Faction keyword of the ${team.name} kill team. Every operative on the team has it, and any rule that names ${titleCase(fk)} operatives applies to all of them.`,
    })
  }
  for (const rec of Object.values(b.byId) as RecordLike[]) {
    if (!rec.stats || !Array.isArray(rec.keywords)) continue
    for (const k of rec.keywords) {
      if (out.has(k)) continue
      out.set(k, { term: k, kind: 'keyword', body: ROLE_KEYWORD[k] ?? `Identifies the ${titleCase(k)} operative type. It is used by roster selection limits and by any rule that names it.` })
    }
  }
  return [...out.values()]
}

/** "Piercing" -> body text with a parameter slot x; derived per use in lookupTerm. */
function weaponRuleEntries(): GlossaryEntry[] {
  const out: GlossaryEntry[] = []
  for (const rec of Object.values(dataBundle().byId) as RecordLike[]) {
    if (typeof rec.param !== 'string' || !rec.name || !rec.text) continue
    out.push({ term: rec.name, kind: 'weaponRule', body: rec.text })
    if (rec.critsVariant) {
      out.push({
        term: `${rec.name} Crits`,
        kind: 'weaponRule',
        body: `${rec.text.replace(/\s*The Crits variant applies only if a crit was retained\.?/, '')} The Crits version only works if the attacker retained at least one critical success.`.trim(),
      })
    }
  }
  return out
}

function recordEntries(): GlossaryEntry[] {
  const out: GlossaryEntry[] = []
  const seen = new Map<string, GlossaryEntry>()
  const add = (e: GlossaryEntry) => {
    const key = `${e.kind}:${e.term.toLowerCase()}`
    const prev = seen.get(key)
    if (prev) {
      if (!prev.body.includes(e.body)) prev.body = `${prev.body} Other version: ${e.body}`
      return
    }
    seen.set(key, e)
    out.push(e)
  }
  for (const rec of Object.values(dataBundle().byId) as RecordLike[]) {
    if (!rec.name || !rec.text) continue
    if (typeof rec.param === 'string' || rec.stats) continue
    if (typeof rec.kind === 'string' && ['ability', 'uniqueAction', 'factionRule', 'archetype', 'weaponRule'].includes(rec.kind)) {
      if (rec.kind === 'weaponRule') add({ term: rec.name, kind: 'weaponRule', body: rec.text })
      else if (rec.kind === 'uniqueAction') add({ term: rec.name, kind: 'action', body: `${rec.ap !== undefined ? `Unique action, ${rec.ap} AP. ` : 'Unique action. '}${rec.text}` })
      else add({ term: rec.name, kind: 'ability', body: rec.text })
    } else if (rec.type === 'strategy' || rec.type === 'firefight') {
      add({ term: rec.name, kind: 'ploy', body: `${rec.type === 'strategy' ? 'Strategy' : 'Firefight'} ploy, ${rec.cost ?? 1} CP. ${rec.text}` })
    } else if (rec.scope === 'universal' || rec.scope === 'faction') {
      add({ term: rec.name, kind: 'equipment', body: rec.text })
    }
  }
  return out
}

// ---------------------------------------------------------------- index

interface Index {
  all: GlossaryEntry[]
  byKey: Map<string, GlossaryEntry[]>
  re: RegExp
  /** match key (lower-case normalised) -> true when only a capitalised spelling may be linked in prose */
  capOnly: Map<string, boolean>
}

const PRIORITY: GlossaryKind[] = ['stat', 'status', 'rule', 'weaponRule', 'action', 'ploy', 'ability', 'equipment', 'keyword']

/** Lower-case, one space, curly quotes and inch marks folded, trailing "!" and "." stripped. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function bare(s: string): string {
  return s.replace(/[!.?:,;]+$/, '')
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let cache: Index | null = null

function build(): Index {
  const all: GlossaryEntry[] = [
    ...CORE.map((c) => ({ kind: 'rule' as GlossaryKind, ...c })),
    ...actionEntries(),
    ...weaponRuleEntries(),
    ...recordEntries(),
    ...keywordEntries(),
  ]
  const byKey = new Map<string, GlossaryEntry[]>()
  const add = (key: string, e: GlossaryEntry) => {
    const k = bare(norm(key))
    if (!k) return
    const list = byKey.get(k) ?? []
    if (!list.includes(e)) list.push(e)
    byKey.set(k, list)
  }
  for (const e of all) {
    add(e.term, e)
    for (const a of e.aliases ?? []) add(a, e)
  }
  for (const list of byKey.values()) list.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))

  const capOnly = new Map<string, boolean>()
  const patterns: { key: string; pat: string }[] = []
  for (const [key, list] of byKey) {
    const first = list[0]!
    const multi = key.includes(' ')
    const lowerOk = LOWER_OK.has(key) || (multi && first.kind !== 'keyword' && first.kind !== 'weaponRule')
    capOnly.set(key, !lowerOk)
    let pat = esc(key).replace(/\\?'/g, "['\\u2019]").replace(/ /g, '\\s+')
    if (first.kind === 'weaponRule') pat += '(?:\\s+Crits)?(?:\\s+\\d+(?:\\.\\d+)?(?:[\\u2033"\\u201D]|\\u2033)?\\+?)?'
    else if (!/s$/.test(key)) pat += 's?'
    if (/!$/.test(first.term)) pat += '!?'
    patterns.push({ key, pat })
  }
  patterns.sort((a, b) => b.key.length - a.key.length)
  const re = new RegExp(`(?<![A-Za-z0-9_'])(?:${patterns.map((p) => p.pat).join('|')})(?![A-Za-z0-9_])`, 'gi')
  return { all, byKey, re, capOnly }
}

function index(): Index {
  cache ??= build()
  return cache
}

export function allEntries(): GlossaryEntry[] {
  return index().all
}

// ---------------------------------------------------------------- lookup

const PARAM = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(["\u2033\u201D])?\s*(\+)?$/

function fmtParam(num: string, inch: string | undefined, plus: string | undefined): string {
  return `${num}${inch ? '\u2033' : ''}${plus ? '+' : ''}`
}

const derived = new Map<string, GlossaryEntry>()

function pick(list: GlossaryEntry[] | undefined, kind?: GlossaryKind): GlossaryEntry | null {
  if (!list || list.length === 0) return null
  return (kind && list.find((e) => e.kind === kind)) || list[0]!
}

/**
 * Find the entry for a term as the UI writes it. Case-insensitive; "Piercing 1", "Lethal 5+", "Blast 2\u2033" and "Range 6\"" resolve
 * to the rule with the parameter filled into its body; a plural "s" is forgiven. `kind` prefers one kind when a name is shared
 * (the Grenadier keyword and the Grenadier ability).
 */
export function lookupTerm(term: string, kind?: GlossaryKind): GlossaryEntry | null {
  const { byKey } = index()
  const key = bare(norm(term))
  if (!key) return null
  const direct = pick(byKey.get(key), kind) ?? (key.endsWith('s') ? pick(byKey.get(key.slice(0, -1)), kind) : null)
  if (direct) return direct
  const m = PARAM.exec(key.replace(/[\u2033\u201D]/g, '"'))
  if (!m) return null
  const base = m[1]!
  const e = pick(byKey.get(base), kind) ?? (base.endsWith('s') ? pick(byKey.get(base.slice(0, -1)), kind) : null)
  if (!e || e.kind !== 'weaponRule') return e
  const value = fmtParam(m[2]!, m[3], m[4])
  const label = `${e.term} ${value}`
  const hit = derived.get(label)
  if (hit) return hit
  const out: GlossaryEntry = { ...e, term: label, body: e.body.replace(/\bx\b/g, value) }
  derived.set(label, out)
  return out
}

// ---------------------------------------------------------------- weapon rule uses

export interface WeaponRuleUseLike {
  rule: string
  x?: number
  inches?: number
  target?: number | string
  crits?: boolean
  only?: string
}

/** How one weapon rule on a weapon profile reads ("Piercing Crits 1", "Blast 2″", "Heavy (dash only)") and the glossary term to look up for it. */
export function weaponRuleParts(r: WeaponRuleUseLike): { term: string; label: string } {
  const rec = dataBundle().byId[r.rule] as { name?: string } | undefined
  const name = rec?.name ?? humanize(r.rule)
  const value = r.inches !== undefined ? ` ${r.inches}″` : r.x !== undefined ? ` ${r.x}` : r.target !== undefined ? ` ${String(r.target).replace(/\+?$/, '+')}` : ''
  const term = `${name}${r.crits ? ' Crits' : ''}${value}`
  return { term, label: r.only ? `${term} (${r.only} only)` : term }
}

// ---------------------------------------------------------------- linking free text

const linked = new Map<string, LinkedSegment[]>()

function isKeyword(entry: GlossaryEntry): boolean {
  return entry.kind === 'keyword'
}

/** Accept a regex hit only when its spelling fits the entry: ALL-CAPS keywords in caps or Title Case, common words only when capitalised. */
function spellingOk(text: string, entry: GlossaryEntry, capOnly: boolean): boolean {
  const word = text.replace(/\s+\d.*$/, '')
  if (isKeyword(entry)) return word === word.toUpperCase() || word === titleCase(word) || word === titleCase(word.replace(/s$/i, '')) + word.slice(-1)
  if (!capOnly) return true
  const c = word.charAt(0)
  return c !== c.toLowerCase()
}

/**
 * Split free text into plain strings and matched terms. Longest match first, whole words only. Common English words (Move,
 * Hit, Fight, Place, Ready, Block...) and weapon rules link only when capitalised; operative keywords only in CAPS or Title Case
 * (and not at all with `keywords: false`, for lines full of operative names such as the event feed).
 */
export function linkTerms(text: string, opts?: { keywords?: boolean }): LinkedSegment[] {
  const withKeywords = opts?.keywords !== false
  const cacheKey = withKeywords ? text : `nk:${text}`
  const hit = linked.get(cacheKey)
  if (hit) return hit
  const idx = index()
  const out: LinkedSegment[] = []
  const re = idx.re
  re.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const found = m[0]
    const entry = lookupTerm(found)
    const key = bare(norm(found)).replace(/\s+\d.*$/, '')
    const capOnly = idx.capOnly.get(key) ?? idx.capOnly.get(key.replace(/s$/, '')) ?? true
    if (!entry || (!withKeywords && isKeyword(entry)) || !spellingOk(found, entry, capOnly)) {
      re.lastIndex = m.index + 1
      continue
    }
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ text: found, entry })
    last = m.index + found.length
  }
  if (last < text.length) out.push(text.slice(last))
  const result = out.length === 0 ? [text] : out
  if (linked.size > 1500) linked.clear()
  linked.set(cacheKey, result)
  return result
}
