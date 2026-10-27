// Display text for engine facts: feed lines for events, labels for decision options, what a decision decides, and rejection text.
// All wording is our own. The engine owns every number; this file only names things. Pure (no store, no DOM): unit-testable.
import type { DecisionOption, GameEvent, GameState, PendingDecision, Rejection, Seat } from '@/engine'

export const SEAT_NAME: Record<Seat, string> = { A: 'Gang A', B: 'Gang B' }

// ---------------------------------------------------------------- names

export function fighterName(state: GameState | null, id: string | null | undefined): string {
  if (!id) return 'someone'
  return state?.fighters[id]?.name ?? id
}

export function weaponName(state: GameState | null, id: string | null | undefined): string {
  if (!id) return 'a weapon'
  return state?.data.weapons[id]?.name ?? id
}

export function actionName(state: GameState | null, id: string): string {
  const core = state?.data.actions[id]?.name
  if (core) return core
  // an action a skill grants (Headbutt, Hurl, Overseer ...) carries the skill's name
  const skill = state ? Object.values(state.data.skills).find((s) => s.action?.id === id) : undefined
  return skill?.name ?? humanize(id)
}

/** The name of the skill whose data record is implemented by the code hook `code` (`hitAndRun` -> "Hit and Run"). */
export function skillNameOf(state: GameState | null, code: string): string {
  const hit = state ? Object.values(state.data.skills).find((s) => JSON.stringify(s.effect ?? '').includes(`"code":"${code}"`)) : undefined
  return hit?.name ?? humanize(code)
}

export function gangName(state: GameState | null, seat: Seat | null): string {
  if (!seat) return 'Nobody'
  return state?.players[seat]?.gangName ?? SEAT_NAME[seat]
}

/** `camelCase` / `kebab-case` / `dotted.id` -> "Camel case". */
export function humanize(s: string): string {
  const last = s.split('.').pop() ?? s
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_:]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const COMPASS_NAMES = ['South', 'South-east', 'East', 'North-east', 'North', 'North-west', 'West', 'South-west']

/** The engine facing (radians from +z towards +x) as a map direction; north is the far edge as the camera first looks at the board. */
export function facingName(rad: number): string {
  const k = ((Math.round(rad / (Math.PI / 4)) % 8) + 8) % 8
  return COMPASS_NAMES[k]!
}

// ---------------------------------------------------------------- rejections

const REJECTION_HEAD: Record<string, string> = {
  E_WRONG_DECISION: 'That answer is for another decision',
  E_WRONG_SEAT: 'It is not that gang\'s decision',
  E_NOT_AN_OPTION: 'That is not one of the options',
  E_OUT_OF_RANGE: 'Out of reach',
  E_OVERLAP: 'No room there',
  E_ONE_INCH: 'Too close to an enemy',
  E_NO_PATH: 'No path',
  E_NO_ACTIONS: 'No actions left for that',
  E_ACTION_RESTRICTED: 'Not allowed right now',
  E_INVALID_TARGET: 'Invalid target',
  E_NOT_VISIBLE: 'Cannot see the target',
  E_OUT_OF_AMMO: 'Out of ammo',
  E_PASS_NOT_ALLOWED: 'You have to answer this one',
  E_GAME_OVER: 'The battle is over',
  E_SCHEMA: 'Bad input',
  E_TODO: 'Not in this build yet',
}

export function rejectionText(r: Pick<Rejection, 'code' | 'reason'>): string {
  const head = REJECTION_HEAD[r.code] ?? r.code
  return r.reason ? `${head}: ${r.reason}` : head
}

// ---------------------------------------------------------------- decisions

const KIND_TITLE: Record<string, string> = {
  'setup.role': 'Choose who sets up first',
  'setup.crew': 'Choose your crew',
  'setup.casket': 'Place a casket',
  'setup.zone': 'Choose your deployment half',
  'setup.deploy': 'Deploy your gang',
  'action.flee': 'Voluntary flight',
  'action.activate': 'Activate a fighter',
  'action.group': 'Add to the group activation',
  'action.choose': 'Choose an action',
  'move.path': 'Move',
  'shoot.weapon': 'Choose the weapon to shoot with',
  'shoot.target': 'Choose a target',
  'shoot.aim': 'Pick the aim point',
  'shoot.allocate': 'Allocate the extra hit',
  'fight.weapons': 'Choose fighting weapons',
  'fight.split': 'Split the attack dice',
  'fight.after': 'After the fight',
  'end.bottle': 'Bottle test',
  'end.assist': 'Assist a recovery',
  'end.recoveryPick': 'Pick a recovery die',
  'skill.choice': 'Skill choice',
  'dice.reroll': 'Re-roll',
  confirm: 'Continue',
}

/** What a decision decides, in one line (the prompt's title). */
export function decisionTitle(pending: PendingDecision, state: GameState | null): string {
  const base = KIND_TITLE[pending.kind] ?? humanize(pending.kind)
  const who = pending.context.fighterId
  if (pending.kind === 'move.path') {
    const kind = String((pending.constraints?.kind ?? pending.context.kind) || 'move')
    const verb = kind === 'takeCover' ? 'Take Cover' : kind === 'crawl' ? 'Crawl' : kind === 'carry' ? 'Carry' : kind === 'retreat' ? 'Retreat' : kind === 'consolidate' ? 'Consolidate' : kind === 'somersault' ? 'Somersault' : 'Move'
    return `${verb}: ${fighterName(state, String(pending.constraints?.fighterId ?? who ?? ''))}`
  }
  if (pending.kind === 'action.choose' && typeof who === 'string') return `${fighterName(state, who)}: choose an action`
  return base
}

/** One-line help under the title: what the player can do now. */
export function decisionHelp(pending: PendingDecision): string {
  switch (pending.kind) {
    case 'setup.role':
      return `Your gang won the roll-off (${rollsText(pending)}). Going first means choosing your half and deploying first.`
    case 'setup.zone':
      return 'Each half of the board is a deployment strip. The other gang takes the other half.'
    case 'setup.deploy':
      return 'Pick a fighter, then click inside your highlighted zone. Q and E turn the facing.'
    case 'action.activate':
      return 'Click a ready fighter on the board or in the list. Each fighter acts once per round.'
    case 'action.group':
      return 'Fighters within the group radius can activate together. Add one or stop.'
    case 'action.choose':
      return 'Each activation has two actions. Doors beside the fighter can be clicked on the board.'
    case 'move.path':
      if (pending.constraints?.kind === 'somersault') return 'Click a spot within reach that the fighter can see and that is more than an inch from every enemy. Right click or Escape cancels.'
      return 'Click the board: the fighter takes the shortest legal route, as far as the allowance reaches. Right click or Escape cancels.'
    case 'shoot.aim':
      return 'Click the board to aim, or pick a suggested aim point.'
    default:
      return ''
  }
}

function rollsText(pending: PendingDecision): string {
  const r = pending.context.rolls as Record<string, number> | undefined
  return r ? `A ${r.A}, B ${r.B}` : 'roll-off'
}

const WITHHELD: Record<string, string> = {
  later: 'not available in this build yet',
  noTarget: 'nothing in reach to do it to',
  noActions: 'no actions left',
  needsTwo: 'needs both actions',
  repeat: 'already done this activation',
  noTurn: 'cannot turn now',
}

export function withheldText(reason: string): string {
  return WITHHELD[reason] ?? reason
}

// ---------------------------------------------------------------- options

type Data = Record<string, unknown>

const pct = (n: unknown): string | null => (typeof n === 'number' ? `${Math.round(n * 100)}%` : null)
const inch = (n: unknown): string | null => (typeof n === 'number' ? `${Math.round(n * 100) / 100}"` : null)

/** The button text of a decision option. */
export function optionLabel(opt: DecisionOption, state: GameState | null): string {
  const a = opt.action
  const d = (opt.data ?? {}) as Data
  switch (a.type) {
    case 'action.activate':
      return fighterName(state, a.payload.fighterId)
    case 'action.group':
      return a.payload.done ? 'No more: start the group' : `Add ${fighterName(state, a.payload.fighterId)}`
    case 'action.flee':
      return a.payload.done ? 'Nobody flees' : `${fighterName(state, a.payload.fighterId)} flees`
    case 'setup.crew':
      return a.payload.done ? 'Crew chosen' : `Take ${fighterName(state, a.payload.fighterId)}`
    case 'setup.role': {
      const c = a.payload.choice
      return c === 'first' ? 'Set up first' : c === 'second' ? 'Set up second' : c === 'attacker' ? 'Be the attacker' : 'Be the defender'
    }
    case 'setup.zone':
      return a.payload.zoneId === 'low' ? 'Far half (top of the screen)' : a.payload.zoneId === 'high' ? 'Near half (bottom of the screen)' : tilePlace(state, a.payload.zoneId)
    case 'action.choose':
      return chooseLabel(a.payload, state, d)
    case 'shoot.weapon': {
      const profile = state?.data.weapons[a.payload.weaponId]?.profiles.find((p) => p.id === a.payload.profileId)
      const label = profile?.name ?? ((state?.data.weapons[a.payload.weaponId]?.profiles.length ?? 0) > 1 ? humanize(a.payload.profileId) : null)
      return `${weaponName(state, a.payload.weaponId)}${label ? ` (${label.toLowerCase()})` : ''}${a.payload.twinWith ? ` + ${weaponName(state, a.payload.twinWith)}` : ''}`
    }
    case 'shoot.target':
      return a.payload.targetId ? fighterName(state, a.payload.targetId) : a.payload.doorId ? `Door ${a.payload.doorId}` : 'A point on the floor'
    case 'shoot.allocate':
      return `Hit ${fighterName(state, a.payload.targetId)}`
    case 'fight.weapons':
      return a.payload.weaponIds.length === 0 ? 'Fight unarmed' : a.payload.weaponIds.map((w) => weaponName(state, w)).join(' + ')
    case 'fight.split':
      return Object.entries(a.payload.split)
        .map(([id, n]) => `${n} on ${fighterName(state, id)}`)
        .join(', ')
    case 'fight.after':
      return a.payload.choice === 'coupDeGrace' ? `Coup de Grace on ${fighterName(state, a.payload.targetId)}` : a.payload.choice === 'consolidate' ? 'Consolidate' : 'Do nothing'
    case 'end.bottle':
      return a.payload.choice === 'test' ? 'Take the Bottle test' : 'Bottle out now'
    case 'end.assist':
      return a.payload.none ? 'No assist' : `${fighterName(state, a.payload.assisterId)} helps ${fighterName(state, a.payload.recoveringId)}`
    case 'end.recoveryPick':
      return `Use die ${a.payload.index + 1}`
    case 'skill.choice':
      return skillChoiceLabel(opt, state, d)
    case 'dice.reroll':
      return `Re-roll ${a.payload.dieIndexes.length} dice`
    case 'confirm':
      return a.payload.choice === 'concede' ? 'Concede' : a.payload.choice === 'continue' ? 'Play on' : 'Continue'
    case 'pass':
      return 'Pass'
    default:
      return humanize(opt.labelKey)
  }
}

/** A `skill.choice` button: the answer to a skill's question, in words (Hit and Run, Lightning Reflexes, Naaargah!, Hurl). */
function skillChoiceLabel(opt: DecisionOption, state: GameState | null, d: Data): string {
  const option = (opt.action.payload as { option: string }).option
  switch (opt.labelKey) {
    case 'skill.hitAndRun.use':
      return 'Hit and Run: slip away with a free Retreat'
    case 'skill.lightningReflexes.use':
      return 'Lightning Reflexes: slip away before the blow lands'
    case 'skill.naaargah.attempt':
      return 'Naaargah!: try for a third action (you end the activation Pinned)'
    case 'skill.stimmSlugStash.use':
      return 'Stimm-slugs: +2 Movement, Strength and Toughness this round (once a battle; may hurt at round end)'
    case 'skill.chemSynth.use':
      return `Chem-synth: Intelligence test (${typeof d.chance === 'number' ? `${Math.round(d.chance * 100)}%` : `${String(d.need)}+`}) to weaken Gas and Toxin targets this activation`
    case 'skill.combatChemsStash.use':
      return `Combat chems: roll for Attacks (now ${String(d.attacks)}; a 1 drops it to 1, otherwise +1 to +3)`
    case 'skill.stimmSlugStash.decline':
    case 'skill.chemSynth.decline':
    case 'skill.combatChemsStash.decline':
    case 'skill.decline':
      return 'No, carry on'
    case 'skill.hurl.fight':
      return 'Fight as usual'
    case 'skill.hurl.use':
      return `Hurl ${fighterName(state, typeof d.targetId === 'string' ? d.targetId : option.slice(5))} instead of fighting`
    case 'skill.hurl.direction': {
      const contacts = Array.isArray(d.contacts) ? (d.contacts as string[]) : []
      const where = typeof d.angle === 'number' ? facingName(d.angle) : humanize(option)
      return `Hurl ${where}${contacts.length > 0 ? `, into ${contacts.map((id) => fighterName(state, id)).join(' and ')}` : d.stoppedShort === true ? ', against the terrain' : ''}`
    }
    default:
      return humanize(option)
  }
}

function chooseLabel(p: Extract<DecisionOption['action'], { type: 'action.choose' }>['payload'], state: GameState | null, d: Data): string {
  const name = actionName(state, p.action)
  switch (p.action) {
    case 'end':
      return 'End activation'
    case 'headbutt':
      return `Headbutt ${fighterName(state, p.targetId)}`
    case 'hurl':
      return `Hurl ${fighterName(state, p.targetId)}`
    case 'overseer':
      return `Order ${fighterName(state, p.targetId)} to act now`
    case 'immovableStance':
      return 'Brace: Immovable Stance'
    case 'unleashTheBeast':
      return 'Unleash the Beast'
    case 'somersault':
      return 'Somersault to a new spot'
    case 'turn':
      if (p.targetId) return `Face ${fighterName(state, p.targetId)}`
      return typeof p.facing === 'number' ? facingName(p.facing) : 'Turn'
    case 'operateDoor':
      return `${d.to === 'close' ? 'Close' : 'Open'} door`
    case 'forceDoor':
      return 'Force door open'
    case 'accessTerminal':
      return 'Access terminal'
    case 'reload':
      return `Reload ${weaponName(state, p.weaponId)}`
    case 'crawlDuct':
      return 'Crawl through the ductway'
    case 'smashCasket':
      return 'Smash the casket open'
    case 'bypassCasket':
      return 'Hack the casket lock'
    case 'carryCasket':
      return 'Pick up the casket'
    default:
      return p.targetId ? `${name}: ${fighterName(state, p.targetId)}` : name
  }
}

const HANDLED_FACTS = new Set(['maxInches', 'chance', 'need', 'plentiful', 'helpers', 'distance', 'band', 'cover', 'priority', 'hit', 'pHit', 'weapons', 'targets', 'doors', 'point', 'template', 'cost', 'auto', 'bonus', 'to', 'doorId', 'exit', 'from', 'contentsModifier', 'pReach', 'visible', 'dice', 'reach', 'needs', 'perWeapon', 'weaponId', 'angle', 'moved', 'contacts', 'stoppedShort', 'saveBonus', 'ready'])
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Short engine facts to show beside an option's button: ranges, odds, needs (all read from `option.data`). */
export function optionFacts(opt: DecisionOption): string[] {
  const d = (opt.data ?? {}) as Data
  const out: string[] = []
  const add = (s: string | null) => {
    if (s) out.push(s)
  }
  if (typeof d.maxInches === 'number') add(`up to ${inch(d.maxInches)}`)
  if (d.chance !== undefined) add(`${pct(d.chance)} to succeed`)
  if (typeof d.need === 'number') add(`needs ${d.need}+`)
  if (d.plentiful === true) add('automatic')
  if (typeof d.helpers === 'number' && d.helpers > 0) add(`${d.helpers} helping`)
  if (typeof d.distance === 'number') add(inch(d.distance))
  if (typeof d.band === 'string') add(`${d.band} range`)
  if (typeof d.cover === 'string' && d.cover !== 'none') add(`${d.cover} cover`)
  if (typeof d.priority === 'string' && d.priority !== 'free') add(d.priority === 'closest' ? 'closest target' : 'priority test')
  if (typeof d.hit === 'number') add(`${pct(d.hit)} to hit`)
  if (typeof d.pHit === 'number') add(`${pct(d.pHit)} to hit`)
  if (typeof d.pReach === 'number') add(`${pct(d.pReach)} to reach`)
  if (d.visible === false) add('not in sight: -1 to hit')
  if (typeof d.dice === 'number') add(`${d.dice} attack dice`)
  if (d.reach === true) add('at weapon reach')
  if (typeof d.moved === 'number') add(`flies ${inch(d.moved)}`)
  if (typeof d.saveBonus === 'number') add(`+${d.saveBonus} to saves (best 2+), no Pinning, no shoving, until it next activates`)
  if (d.ready === false) add('has already acted this round')
  if (d.auto === true) add('no roll needed')
  if (typeof d.cost === 'string') add(`${humanize(d.cost).toLowerCase()} action`)
  if (typeof d.weapons === 'number') add(d.weapons === 0 ? 'no weapon ready' : plural(d.weapons, 'weapon'))
  if (typeof d.targets === 'number' || typeof d.doors === 'number') {
    const t = typeof d.targets === 'number' ? d.targets : 0
    const doors = typeof d.doors === 'number' ? d.doors : 0
    add(t + doors === 0 ? 'nothing to shoot at' : [t > 0 ? plural(t, 'target') : null, doors > 0 ? plural(doors, 'door') : null].filter(Boolean).join(', '))
  }
  if (out.length === 0) {
    // an engine number this build has no wording for yet: show it plainly rather than hide it
    for (const [k, v] of Object.entries(d)) {
      if (HANDLED_FACTS.has(k)) continue
      if (typeof v === 'number') out.push(`${humanize(k).toLowerCase()} ${Math.round(v * 100) / 100}`)
      else if (typeof v === 'string' || typeof v === 'boolean') out.push(`${humanize(k).toLowerCase()} ${String(v)}`)
      if (out.length >= 3) break
    }
  }
  return out
}

/** The fighter an option concerns (for hover highlights on the board), if any. */
export function optionFighter(opt: DecisionOption): string | null {
  const p = opt.action.payload as Record<string, unknown>
  const id = p.fighterId ?? p.targetId ?? p.recoveringId ?? (opt.data as Record<string, unknown> | undefined)?.targetId
  return typeof id === 'string' ? id : null
}

/** The door an option concerns, if any. */
export function optionDoor(opt: DecisionOption): string | null {
  const p = opt.action.payload as Record<string, unknown>
  return typeof p.doorId === 'string' ? p.doorId : null
}

// ---------------------------------------------------------------- events

const EVENT_NOISE = new Set([
  'DecisionRequested',
  'GameCreated',
  'EngagementChanged',
  'PhaseStarted',
  'PhaseEnded',
  'EffectStarted',
  'EffectEnded',
  'ActionResolved',
  'ActionDeclared',
  'ShootEnded',
  'WeaponStateChanged',
  'FighterTurned',
  'ActionCancelled',
])

/** The feed line of an event, or null for events that only drive the board. `state` supplies names. */
export function describeEvent(ev: GameEvent, state: GameState | null): string | null {
  if (EVENT_NOISE.has(ev.type)) return null
  const n = (id: string | null | undefined) => fighterName(state, id)
  switch (ev.type) {
    case 'RoundStarted':
      return `Round ${ev.round} begins.`
    case 'RoundEnded':
      return `Round ${ev.round} ends.`
    case 'PriorityDecided':
      return `${gangName(state, ev.holder)} takes Priority (${gangName(state, 'A')} rolled ${ev.rolls.A}, ${gangName(state, 'B')} rolled ${ev.rolls.B}${ev.tieRule ? '; tie rule' : ''}).`
    case 'RoleChosen':
      return `${gangName(state, ev.seat)} chose to set up ${ev.choice}.`
    case 'CrewCapRolled':
      return `Crew limit rolled: ${ev.cap} fighters (rolled ${ev.roll}).`
    case 'CrewChosen':
      return `${ev.fighterIds.length} fighters take the field${ev.random ? ' (drawn at random)' : ''}.`
    case 'ZoneChosen':
      return `Deployment half chosen: ${ev.zoneId === 'low' ? 'far' : ev.zoneId === 'high' ? 'near' : ev.zoneId}.`
    case 'CasketPlaced':
      return 'A casket is placed on the board.'
    case 'FighterDeployed':
      return `${n(ev.fighterId)} deploys.`
    case 'FightersReadied':
      return `${ev.fighterIds.length} fighters are ready.`
    case 'FighterActivated':
      return `${n(ev.fighterId)} activates${ev.group ? ' with the group' : ''}.`
    case 'GroupNominated':
      return `${n(ev.leaderId)} leads a group of ${ev.fighterIds.length + 1}.`
    case 'ActivationEnded':
      return ev.actionsUsed === 0 ? `${n(ev.fighterId)} holds position.` : `${n(ev.fighterId)} finishes (${ev.actionsUsed} action${ev.actionsUsed === 1 ? '' : 's'}).`
    case 'FighterFled':
      return `${n(ev.fighterId)} ${ev.voluntary ? 'flees the field' : 'runs from the fight'}.`
    case 'FighterMoved':
      return `${n(ev.fighterId)} ${moveVerb(ev.kind)} ${Math.round(ev.length * 10) / 10}".`
    case 'StatusChanged':
      return `${n(ev.fighterId)} is now ${postureWord(ev.to)}.`
    case 'ConditionChanged':
      return `${n(ev.fighterId)} ${ev.on ? 'gains' : 'loses'} ${humanize(ev.condition).toLowerCase()}.`
    case 'FleshWound':
      return `${n(ev.fighterId)} takes a Flesh Wound (Toughness ${ev.toughness}).`
    case 'FighterOutOfAction':
      return `${n(ev.fighterId)} is out of action${ev.by ? `, put down by ${n(ev.by)}` : ''}.`
    case 'ShootStarted':
      return `${n(ev.fighterId)} shoots with ${weaponName(state, ev.weaponId)}.`
    case 'TargetDeclared':
      return `Target: ${ev.targetId ? n(ev.targetId) : ev.doorId ? `door ${ev.doorId}` : 'the floor'} at ${Math.round(ev.distance * 10) / 10}"${ev.cover !== 'none' ? ` (${ev.cover} cover)` : ''}.`
    case 'PriorityTest':
      return `${n(ev.fighterId)} ${ev.passed ? 'passes' : 'fails'} the target priority test (${ev.roll} against ${ev.need}+).`
    case 'HitRolled':
      return `Hit roll ${ev.dice.join(', ')} against ${ev.need}+: ${ev.hit ? 'hit' : 'miss'}.`
    case 'StrayShot':
      return `Stray shot: ${ev.hit ? `hits ${n(ev.candidateId)}` : 'flies wide'}.`
    case 'BlastScattered':
      return `The blast scatters ${Math.round(ev.distance * 10) / 10}".`
    case 'FirepowerRolled':
      return `Firepower dice: ${ev.hits} hit${ev.hits === 1 ? '' : 's'}${ev.ammoSymbols > 0 ? `, ${ev.ammoSymbols} ammo symbol${ev.ammoSymbols === 1 ? '' : 's'}` : ''}.`
    case 'AmmoTest':
      return `${n(ev.fighterId)} ammo test: ${ev.passed ? 'passed' : 'failed, ' + humanize(ev.result).toLowerCase()}.`
    case 'FighterPinned':
      return `${n(ev.fighterId)} is pinned.`
    case 'WoundRolled':
      return `${n(ev.targetId)}: wound roll ${ev.roll} against ${ev.need}+ ${ev.wounded ? 'wounds' : 'fails'}.`
    case 'SaveRolled':
      return `${n(ev.targetId)}: save ${ev.roll} against ${ev.need}+ ${ev.saved ? 'holds' : 'fails'}.`
    case 'DamageInflicted':
      return `${n(ev.targetId)} takes ${ev.amount} damage (${ev.wounds} wounds left).`
    case 'InjuryRolled':
      return `${n(ev.targetId)}: Injury dice ${ev.faces.map(humanize).join(', ')} -> ${humanize(ev.applied).toLowerCase()}.`
    case 'KnockedBack':
      return `${n(ev.targetId)} is knocked back.`
    case 'CaughtFire':
      return `${n(ev.targetId)} catches fire.`
    case 'FightStarted':
      return `${n(ev.attackerId)} fights ${ev.targets.map(n).join(', ')}.`
    case 'Parried':
      return `${n(ev.by)} parries.`
    case 'CoupDeGrace':
      return `${n(ev.fighterId)} finishes ${n(ev.targetId)}.`
    case 'NerveTest':
      return `${n(ev.fighterId)} nerve test ${ev.roll} against ${ev.need}: ${ev.passed ? 'holds' : 'breaks'}.`
    case 'RunningForCover':
      return `${n(ev.fighterId)} runs for cover.`
    case 'SkillUsed': {
      const skill = skillNameOf(state, ev.skill)
      const who = ev.targetId ? ` on ${n(ev.targetId)}` : ''
      if (ev.skill === 'headbutt') return `${n(ev.fighterId)} headbutts${who}: ${ev.detail === 'hit' ? 'it connects' : 'it fumbles'}.`
      if (ev.skill === 'stepAside') return `${n(ev.fighterId)} steps aside from ${n(ev.targetId)}'s blow.`
      if (ev.skill === 'fearsome') return `${n(ev.fighterId)} is so fearsome that ${n(ev.targetId)} stops short.`
      if (ev.skill === 'regroup') return `${n(ev.fighterId)} rallies the gang (${skill}).`
      return `${n(ev.fighterId)} uses ${skill}${who}.`
    }
    case 'SkillTest': {
      const stat = ev.test === 'Ld' ? 'Leadership' : ev.test === 'Wil' ? 'Willpower' : ev.test === 'S' ? 'Strength' : ev.test === 'T' ? 'Toughness' : 'Initiative'
      return `${n(ev.fighterId)} ${stat} test (${humanize(ev.reason).toLowerCase()}): ${ev.dice.join(' + ')} against ${ev.need}${ev.test === 'S' || ev.test === 'T' ? ' or less' : '+'}: ${ev.passed ? 'passed' : 'failed'}.`
    }
    case 'BottleTest':
      return `${gangName(state, ev.seat)} bottle test: ${ev.bottled ? 'bottles out' : 'holds'} (${ev.down} of ${ev.crew} down).`
    case 'FleeTest':
      return `${n(ev.fighterId)} flee test: ${ev.passed ? 'stays' : 'flees'}.`
    case 'RecoveryTest':
      return `${n(ev.fighterId)} recovery: ${humanize(ev.applied).toLowerCase()}.`
    case 'RallyTest':
      return `${n(ev.fighterId)} rally ${ev.roll} against ${ev.need}: ${ev.passed ? 'rallies' : 'stays broken'}.`
    case 'DoorChanged':
      return `Door ${ev.doorId} is ${ev.state}${ev.locked ? ' and locked' : ''}.`
    case 'DoorDamaged':
      return `Door ${ev.doorId} is damaged.`
    case 'TerminalAccessed':
      return `${n(ev.fighterId)} works a terminal.`
    case 'DuctUsed':
      return `${n(ev.fighterId)} uses a ductway.`
    case 'CasketOpened':
      return `A casket opens: ${humanize(String(ev.result)).toLowerCase()}.`
    case 'CasketMoved':
      return ev.carriedBy ? `${n(ev.carriedBy)} picks up a casket.` : 'A casket is put down.'
    case 'SmokePlaced':
      return 'Smoke fills the air.'
    case 'SmokeCleared':
      return 'The smoke clears.'
    case 'HorrorsInTheDark':
      return `${n(ev.fighterId)} hears something in the dark: ${humanize(ev.result).toLowerCase()}.`
    case 'PointsScored':
      return `${gangName(state, ev.seat)} scores ${ev.amount} (${humanize(ev.reason).toLowerCase()}).`
    case 'CasketSecured':
      return `${gangName(state, ev.seat)} secures a casket.`
    case 'ResultLocked':
      return `${gangName(state, ev.winner)} has the win locked up.`
    case 'DiceRolled':
      return `${humanize(ev.purpose)} roll: ${ev.faces ? ev.faces.map(humanize).join(', ') : ev.dice.join(', ')}.`
    case 'GameEnded':
      return ev.result.winner === 'draw' ? 'The battle ends in a draw.' : `${gangName(state, ev.result.winner)} wins the battle.`
    case 'ActionCancelled':
      return `${n(ev.fighterId)} thinks better of it.`
    case 'ActionRejected':
      return null
    default:
      return null
  }
}

function moveVerb(kind: string): string {
  switch (kind) {
    case 'charge':
      return 'charges'
    case 'crawl':
      return 'crawls'
    case 'retreat':
      return 'retreats'
    case 'takeCover':
      return 'takes cover, moving'
    case 'runForCover':
      return 'runs for cover,'
    case 'knockback':
      return 'is knocked back'
    case 'duct':
      return 'crawls through a duct,'
    case 'doorPush':
      return 'is pushed clear,'
    case 'hurled':
      return 'is hurled'
    case 'pushed':
      return 'is shoved'
    case 'somersault':
      return 'somersaults'
    default:
      return 'moves'
  }
}

export function postureWord(p: string): string {
  return p === 'pinned' ? 'pinned' : p === 'seriouslyInjured' ? 'seriously injured' : p === 'standing' ? 'standing' : humanize(p).toLowerCase()
}

/** Events that carry dice faces, for the dice log: a purpose label and the faces to draw. */
export function diceOf(ev: GameEvent): { purpose: string; dice: number[]; faces?: string[] } | null {
  if (ev.type !== 'DiceRolled') return null
  return { purpose: humanize(ev.purpose), dice: ev.dice, ...(ev.faces ? { faces: ev.faces } : {}) }
}

/** A deployment tile named by where it sits as the camera first looks (far is the top of the screen). */
export function tilePlace(state: GameState | null | undefined, tileId: string): string {
  const t = state?.board.def.tiles.find((x) => x.id === tileId)
  if (!t) return humanize(tileId)
  const row = t.centre.z < -1 ? 'Far' : t.centre.z > 1 ? 'Near' : 'Middle'
  const col = t.centre.x < -1 ? 'left' : t.centre.x > 1 ? 'right' : 'centre'
  return `${row} ${col} tile`
}
