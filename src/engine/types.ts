// Contract types for the engine: the code form of docs/spec/00-architecture.md sections 3-7 (and 8 for rejection codes).
// Must not diverge from that file. Frozen after M2: changes are additive and get a dated row in its change log.
//
// The engine never imports src/data at runtime. It consumes a runtime-shaped bundle (the `Runtime*` records below and
// `EngineBundle` in bundle.ts); the data adapter (`bundleFromData`, S2) maps validated JSON records onto these shapes.

export interface RngState {
  s: [number, number, number, number]
}

export type Seat = 'A' | 'B'
export type Phase = 'setup' | 'priority' | 'action' | 'end' | 'ended'

export interface Vec2 {
  x: number
  z: number
}
export interface Vec3 {
  x: number
  y: number
  z: number
}
export type Polygon = Vec2[]
export interface Segment2 {
  a: Vec2
  b: Vec2
}

// ---------------------------------------------------------------------------
// Runtime data records (what the engine reads; 20-data-schema.md after parsing)
// ---------------------------------------------------------------------------

/** Characteristic keys; target numbers are stored as the number before '+' (BS 4+ -> 4). */
export type StatKey = 'M' | 'WS' | 'BS' | 'S' | 'T' | 'W' | 'I' | 'A' | 'Ld' | 'Cl' | 'Wil' | 'Int'

export type ActionCostType = 'simple' | 'basic' | 'double' | 'free'

/** One entry of core/actions.json (R-6.3). */
export interface RuntimeAction {
  id: string
  name: string
  type: ActionCostType
  /** derived statuses that may take it (`standingActive`, `standingEngaged`, `pinned`, `seriouslyInjured`, `broken`) */
  statuses: string[]
  requires?: string[]
}

/** Six-entry face tables (index = D6 result - 1) from core/dice.json. */
export interface RuntimeDice {
  firepower: string[]
  injury: string[]
  scatter: string[]
}

/** Rule numbers the engine reads (core/constants.json); keys are open. */
export type RuntimeConstants = Record<string, unknown>

export interface RuntimeTrait {
  id: string
  name: string
  param: 'none' | 'count' | 'inches' | 'target'
  implemented: boolean
}

export interface TraitRef {
  trait: string
  x?: number
  inches?: number
  target?: number
}

export type RangeLong = number | 'E' | 'T' | { strMultiplier: number }

export interface RuntimeProfile {
  id: string
  name: string | null
  range: { short: number | null; long: RangeLong }
  acc: { short: number | null; long: number | null }
  /** 'user' = the wielder's S plus `value` (0 for plain S); 'fixed' = `value` */
  str: { base: 'user' | 'fixed'; value: number }
  ap: number
  /** fixed damage, a dice expression ('D3'), or none ('-': no Wound loss, R-2.8) */
  dmg: { kind: 'fixed'; value: number } | { kind: 'dice'; expr: string } | { kind: 'none' }
  /** Ammo test target, or null ('-') */
  ammo: number | null
  traits: TraitRef[]
}

export interface RuntimeWeapon {
  id: string
  name: string
  class: 'pistol' | 'basic' | 'special' | 'heavy' | 'close' | 'grenade'
  cost: number
  profiles: RuntimeProfile[]
  flavour: string
  code?: string
}

export interface RuntimeWargear {
  id: string
  name: string
  kind: 'armour' | 'fieldArmour' | 'equipment' | 'chem'
  cost: number
  save?: number
  saveMods?: { vs: 'front' | 'template' | 'blast'; value: number }[]
  /** declarative effect list or code ref; interpreted by wargear.ts / skills.ts */
  effect?: unknown
  code?: string
}

/** A skill, fighter rule or house rule. */
export interface RuntimeSkill {
  id: string
  name: string
  kind: 'skill' | 'houseRule' | 'fighterRule'
  set?: string
  window?: TimingWindowId
  when?: Record<string, unknown>
  effect?: unknown
  limit?: 'oncePerActivation' | 'oncePerRound' | 'oncePerBattle' | 'unlimited'
  action?: { id: string; type: ActionCostType; statuses: string[]; requires?: string[] }
}

export interface RuntimeFighterType {
  id: string
  name: string
  houseId: string
  /** 'leader' | 'champion' | 'ganger' | 'juve' | 'specialist' | 'prospect' | ... (open) */
  role: string
  cost: number
  stats: Record<StatKey, number>
  /** base diameter in mm */
  baseMm: number
  rules: { id: string; x?: number }[]
  skillAccess: { primary: string[]; secondary: string[] }
  limits: { min: number; max: number | null }
  figureArchetype: string
}

export interface RuntimeHouse {
  id: string
  name: string
  prefix: string
  houseRules: string[]
  fighterTypes: string[]
  skillSets: string[]
  paint?: { major: { h: number; s: number; l: number }; minor: { h: number; s: number; l: number } }
}

export interface CrewMethod {
  method: 'custom' | 'random' | 'hybrid'
  x: number
  y?: string
}

export interface RuntimeScenario {
  id: string
  name: string
  layouts: ('2x3' | 'brick7')[]
  /** true: attacker / defender roles; false: the roll-off winner chooses first / second */
  roles: boolean
  crews: { attacker?: CrewMethod; defender?: CrewMethod; both?: CrewMethod }
  crewCap: { min: number; max: number; cap: number }[] | null
  deployment: { kind: 'standard' | 'tile'; minFromCentreline?: number; defenderFirst?: boolean; withinOfEdge?: number; enemyClearance?: number }
  caskets?: Record<string, unknown>
  scoring: Record<string, unknown>[]
  victory: { by: 'points' | 'caskets' } | { code: string }
  special: { code: string }[]
}

/** A pre-built starter gang (13-gangs.md): the data an engine-side `rosterFromStarter` turns into a `GameSetup` roster. */
export interface RuntimeStarterGang {
  id: string
  houseId: string
  name: string
  credits: number
  fighters: { name: string; typeId: string; weapons: string[]; wargear: string[]; skills: string[] }[]
}

/** Snapshot of every record a game uses; copied into the state so `step` needs no bundle. */
export interface GameData {
  dataVersion: string
  houses: Record<string, RuntimeHouse>
  fighterTypes: Record<string, RuntimeFighterType>
  weapons: Record<string, RuntimeWeapon>
  traits: Record<string, RuntimeTrait>
  skills: Record<string, RuntimeSkill>
  wargear: Record<string, RuntimeWargear>
  actions: Record<string, RuntimeAction>
  dice: RuntimeDice
  constants: RuntimeConstants
  scenario: RuntimeScenario
}

// ---------------------------------------------------------------------------
// Board (00 section 7.1); src/engine/board.ts (S1Z) compiles data boards into it
// ---------------------------------------------------------------------------

export interface BoardDef {
  id: string
  layout: '2x3' | 'brick7'
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  tiles: { id: string; tileId: string; centre: Vec2; rot: 0 | 90 | 180 | 270; rect: Polygon; floor: string }[]
  /** tile squares; their union is the playable area */
  outline: Polygon[]
  /** outline walls included */
  walls: { id: string; seg: Segment2; thickness: number; poly: Polygon }[]
  doors: { id: string; seg: Segment2; poly: Polygon; lockedAtStart: boolean; terminals: { id: string; pos: Vec2 }[] }[]
  ducts: { id: string; a: Vec2; b: Vec2 }[]
  obstacles: { id: string; kind: string; poly: Polygon }[]
  casketSpots: Vec2[]
  /** decoration only, never rules geometry */
  props: { model: string; pos: Vec2; yaw: number }[]
}

export type DoorState = 'closed' | 'open' | 'destroyed'
export type CasketStateName = 'closed' | 'opened' | 'ammoCache' | 'exhausted' | 'removed'

export interface BoardState {
  def: BoardDef
  doors: Record<string, { state: DoorState; locked: boolean; wounds: number }>
  caskets: Record<string, { pos: Vec2; state: CasketStateName; carriedBy: string | null; openedBy?: Seat }>
  smoke: { id: string; pos: Vec2; radius: number; placedRound: number }[]
}

// ---------------------------------------------------------------------------
// Fighters (00 section 7.4)
// ---------------------------------------------------------------------------

export type Posture = 'standing' | 'pinned' | 'seriouslyInjured' // open union (edition-neutral)
export type Location = 'reserve' | 'board' | 'outOfAction' | 'fled'
export type AmmoState = 'ok' | 'out' | 'jammed' | 'spent' // spent = Single Shot / Scarce / grenade used up

export interface FighterWeapon {
  weaponId: string
  /** applies to every profile of the weapon (R-8.9) */
  ammo: AmmoState
  /** Limited profiles gone for the battle (R-14.3) */
  lostProfiles: string[]
}

export interface ConditionState {
  since: number
  source?: string
  data?: Record<string, unknown>
}

export interface Fighter {
  id: string
  seat: Seat
  typeId: string
  name: string
  /** 'leader' | 'champion' | 'ganger' | 'juve' | 'specialist' | ... (from data) */
  role: string
  location: Location
  pos: Vec3
  facing: number
  baseRadius: number
  posture: Posture
  /** printed profile; target numbers stored as the number before '+' */
  stats: Record<StatKey, number>
  wounds: number
  maxWounds: number
  /** each is -1 T for the battle; T 0 = Out of Action */
  fleshWounds: number
  ready: boolean
  /** broken, blind, concussion, blaze, insane, ammoCache ... (open set) */
  conditions: Record<string, ConditionState>
  weapons: FighterWeapon[]
  wargear: string[]
  skills: string[]
  /** fighter rules: groupActivation(x), leadingByExample ... */
  rules: { id: string; x?: number }[]
  /** derived cache of the engagement refresh (00 section 7.2) */
  engagedWith: string[]
  /** casket id */
  carrying: string | null
  /** Blind: "already activated" check */
  activatedThisRound: boolean
  /** for scoring and the end screen */
  downedBy?: { by: string | null; cause: string }
}

// ---------------------------------------------------------------------------
// Game state (00 section 7.5)
// ---------------------------------------------------------------------------

export interface RosterFighter {
  id: string
  typeId: string
  name: string
  weapons: string[]
  wargear: string[]
  skills: string[]
}

export interface GameSetup {
  ruleset: 'n23'
  scenarioId: string
  boardId: string
  gangs: Record<Seat, { houseId: string; name: string; starterId?: string; roster: RosterFighter[] }>
  options?: {
    /** the engine answers those set-up decisions */
    autoCrew?: boolean
    autoCaskets?: boolean
    autoDeploy?: boolean
    /** sims and tests only: end with reason 'roundLimit' after this round */
    maxRounds?: number
    /** tests only: skip the round-1 priority roll */
    firstPriority?: Seat
  }
}

export interface PlayerState {
  seat: Seat
  houseId: string
  gangName: string
  /** 'attacker' | 'defender' in scenarios with roles */
  role: 'attacker' | 'defender' | null
  startingCrew: number
  bottled: boolean
  bottledVoluntarily: boolean
  points: number
}

export interface SetupState {
  step: 'role' | 'crew' | 'casket' | 'zone' | 'deploy' | 'done'
  /** the seat that picks its half and deploys first (set once the role step is answered) */
  first: Seat | null
  /** crew selection order, the plan per seat (scenario method, Forgotten Riches cap applied) and the seats done */
  crewOrder: Seat[]
  crewPlan: Record<Seat, CrewMethod> | null
  crewDone: Seat[]
  /** the automatic roll-off: last dice per seat and the winner */
  rollOff: { rolls: Record<Seat, number>; winner: Seat } | null
  roleChoice: string | null
  crewPicks: Record<Seat, string[]>
  casketQueue: Seat[]
  zoneChoices: Partial<Record<Seat, string>>
  deployTurn: Seat | null
  deployLeft: Record<Seat, string[]>
}

export interface Activation {
  fighterId: string
  seat: Seat
  /** 2 at start (fewer after Horrors in the Dark) */
  actionsLeft: number
  /** the actions this activation started with when that is not 2 (Horrors in the Dark, M-4.5) */
  allowance?: number
  performed: { action: string; type: ActionCostType }[]
  /** true before the first action and after each move (R-4.1) */
  canTurn: boolean
  aimed: boolean
  charged: boolean
  turnedToFace: boolean
  /** set when activated as part of a group (cannot start its own group) */
  groupLeaderId?: string
  declared: { action: string; params?: Record<string, unknown> } | null
  /** length of the casualty log when the activation began (R-10.11: a free Coup de Grace on a fighter downed in this activation owes no extra nerve test) */
  casualtyMark?: number
  /** S4K-B: set when the fighter was ordered to activate by an Overseer; the Overseer's activation resumes the turn flow afterwards */
  orderedBy?: string
  /** S4K-B: the ordered fighter's Ready / activated flags before the order (restored when its activation ends: the order does not change them) */
  orderedFrom?: { ready: boolean; activated: boolean }
  /** S4K-B: Naaargah! was offered this activation (`attempted`) and its outcome owes a Pinned fighter at the end (`pinned`) */
  naaargah?: 'declined' | 'pinned'
}

export interface GroupState {
  leaderId: string
  seat: Seat
  members: string[]
  done: string[]
}

export interface ActionPhaseState {
  turn: Seat | null
  activation: Activation | null
  group: GroupState | null
  /** voluntary flight progress (R-13.4) */
  flightDone: Seat[]
  /** S4K-B: an Overseer's order awaiting the end of its own activation (the ordered fighter then activates at once) */
  order?: { overseerId: string; targetId: string } | null
}

export interface EndPhaseState {
  step: 'bottle' | 'flee' | 'recovery' | 'rally' | 'cleanup' | null
  bottleQueue: Seat[]
  fleeQueue: string[]
  recoveryQueue: string[]
  rallyQueue: string[]
  /** assisters already used this End phase (R-13.6) */
  assistsUsed: string[]
  /** S4: seats still to be asked for assistance, the recovering fighter -> assister pairs chosen, and the assisted roll awaiting `end.recoveryPick` */
  assistSeats: Seat[]
  assists: Record<string, string>
  pick: { fighterId: string; assisterId: string; faces: string[] } | null
}

/** The Shoot or Fight sequence in progress; stages and queues are owned by shoot.ts / fight.ts / hits.ts. */
export interface AttackState {
  kind: 'shoot' | 'fight'
  attackerId: string
  stage: string
  targets: string[]
  hitQueue: { targetId: string; weaponId: string; profileId: string | null }[]
  reactions: string[]
  /** Versatile engagement exists only inside the attack that uses it */
  versatile?: boolean
  data: Record<string, unknown>
}

/** A nerve test owed; resolved after the hit that caused it is fully resolved (R-12.1). */
export interface NerveCheck {
  fighterId: string
  reason: string
  modifier?: number
}

export interface ActiveEffect {
  id: string
  source: string
  seat: Seat
  kind: string
  fighterId?: string
  /** `activation` | `round` | `battle` | `startOfActivation:<fighterId>` */
  expires: string
  data?: Record<string, unknown>
}

export interface CasualtyRecord {
  fighterId: string
  by: string | null
  cause: string
  kind: 'seriouslyInjured' | 'outOfAction' | 'fled'
  round: number
}

export interface ScenarioState {
  id: string
  crewCap: number | null
  caskets: { opened: number; secured: number }
  points: Record<Seat, number>
  /** a result no longer in doubt (Smash & Grab: three caskets cracked); `asked` once the `confirm` decision was answered */
  locked: { winner: Seat; reason: string; asked?: boolean } | null
  deployTiles: Partial<Record<Seat, string>>
}

export interface GameResult {
  winner: Seat | 'draw'
  points: Record<Seat, number>
  reason: 'scenario' | 'resign' | 'concede' | 'roundLimit'
  /** S4: caskets secured per gang at the end (Forgotten Riches, Smash & Grab: cracked) */
  caskets?: Record<Seat, number>
}

export interface GameState {
  version: 1
  engineVersion: string
  seed: string
  ruleset: 'n23'
  phase: Phase
  round: number
  seq: number
  nextDecision: number
  pending: PendingDecision | null
  rng: RngState
  hash: string
  log: Action[]
  lastRollSeq: number
  origin: { setup: GameSetup }
  data: GameData
  board: BoardState
  players: Record<Seat, PlayerState>
  fighters: Record<string, Fighter>
  priority: Seat | null
  setup: SetupState
  action: ActionPhaseState
  end: EndPhaseState
  attack: AttackState | null
  nerve: NerveCheck[]
  effects: ActiveEffect[]
  nextEffect: number
  casualties: CasualtyRecord[]
  scenario: ScenarioState
  result: GameResult | null
}

// ---------------------------------------------------------------------------
// Decisions, actions, rejections (00 sections 3, 4, 5, 8)
// ---------------------------------------------------------------------------

export type TimingWindowId =
  | 'setup.*'
  | 'round.start'
  | 'priority.decided'
  | 'action.phaseStart'
  | 'activation.start'
  | 'activation.groupNominated'
  | 'action.declared'
  | 'move.ended'
  | 'action.resolved'
  | 'shoot.targetDeclared'
  | 'shoot.hitRolled'
  | 'shoot.firepowerRolled'
  | 'shoot.resolved'
  | 'fight.weaponsChosen'
  | 'fight.hitRolled'
  | 'fight.resolved'
  | 'fight.reactions'
  | 'hit.woundRolled'
  | 'hit.saveRolled'
  | 'hit.damage'
  | 'injury.rolled'
  | 'fighter.seriouslyInjured'
  | 'fighter.outOfAction'
  | 'nerve.test'
  | 'activation.end'
  | 'end.bottle'
  | 'end.flee'
  | 'end.recovery'
  | 'end.rally'
  | 'round.end'
  | 'battle.end'

export type DecisionKind =
  | 'setup.role'
  | 'setup.crew'
  | 'setup.casket'
  | 'setup.zone'
  | 'setup.deploy'
  | 'action.flee'
  | 'action.activate'
  | 'action.group'
  | 'action.choose'
  | 'move.path'
  | 'shoot.weapon'
  | 'shoot.target'
  | 'shoot.aim'
  | 'shoot.allocate'
  | 'fight.weapons'
  | 'fight.split'
  | 'fight.after'
  | 'end.bottle'
  | 'end.assist'
  | 'end.recoveryPick'
  | 'skill.choice'
  | 'dice.reroll'
  | 'confirm'

export interface Waypoint {
  x: number
  z: number
}

/** Payload of the answer to each decision kind, plus `pass` and `resign`. */
export interface ActionPayloadMap {
  'setup.role': { choice: 'attacker' | 'defender' | 'first' | 'second' }
  'setup.crew': { fighterId?: string; done?: boolean }
  'setup.casket': { x: number; z: number }
  'setup.zone': { zoneId: string }
  'setup.deploy': { fighterId: string; x: number; z: number; facing: number }
  'action.flee': { fighterId?: string; done?: boolean }
  'action.activate': { fighterId: string }
  'action.group': { fighterId?: string; done?: boolean }
  'action.choose': {
    action: string
    targetId?: string
    weaponId?: string
    doorId?: string
    ductId?: string
    casketId?: string
    terminalId?: string
    spot?: Vec2
    facing?: number
  }
  'move.path': { waypoints: Waypoint[]; facing?: number }
  'shoot.weapon': { weaponId: string; profileId: string; twinWith?: string }
  'shoot.target': { targetId?: string; doorId?: string; point?: true }
  'shoot.aim': { x: number; z: number }
  'shoot.allocate': { targetId: string }
  'fight.weapons': { weaponIds: string[] }
  'fight.split': { split: Record<string, number> }
  'fight.after': { choice: 'coupDeGrace' | 'consolidate' | 'none'; targetId?: string }
  'end.bottle': { choice: 'test' | 'bottle' }
  'end.assist': { assisterId?: string; recoveringId?: string; none?: boolean }
  'end.recoveryPick': { index: number }
  'skill.choice': { option: string }
  'dice.reroll': { grantId: string; dieIndexes: number[] }
  confirm: { choice?: 'continue' | 'concede' }
  pass: Record<string, never>
  resign: Record<string, never>
}

export type ActionType = keyof ActionPayloadMap

export type ActionOf<K extends ActionType> = {
  type: K
  seat: Seat
  decisionId: string
  /** assigned on accept; optional on input */
  seq?: number
  payload: ActionPayloadMap[K]
}

/** Discriminated union generated from the payload map. */
export type Action = { [K in ActionType]: ActionOf<K> }[ActionType]

export interface DecisionOption {
  id: string
  labelKey: string
  action: Action
  data?: Record<string, unknown>
}

/** Continuous answers: where a path or set-up spot may go. */
export interface MoveConstraints {
  kind: 'move' | 'takeCover' | 'crawl' | 'retreat' | 'consolidate' | 'carry' | 'deploy' | 'casket' | 'somersault'
  fighterId?: string
  fighterIds?: string[]
  origin?: Vec3
  baseRadius?: number
  maxInches?: number
  /** the 1" rule mode (R-7.3): 'enemy' = keep 1" from Standing/Pinned enemies, 'none' = not checked */
  oneInch?: 'enemy' | 'none'
  /** set-up decisions: the polygon the base must lie wholly within */
  region?: Polygon
}

export interface PendingDecision {
  /** "d:<n>" monotonic */
  id: string
  seat: Seat
  kind: DecisionKind
  window: TimingWindowId
  /** ids and engine numbers for this choice (odds, needs, distances, suggestions) */
  context: Record<string, unknown>
  options?: DecisionOption[]
  constraints?: MoveConstraints
  canPass: boolean
}

export type RejectionCode =
  | 'E_WRONG_DECISION'
  | 'E_WRONG_SEAT'
  | 'E_NOT_AN_OPTION'
  | 'E_OUT_OF_RANGE'
  | 'E_OVERLAP'
  | 'E_ONE_INCH'
  | 'E_NO_PATH'
  | 'E_NO_ACTIONS'
  | 'E_ACTION_RESTRICTED'
  | 'E_INVALID_TARGET'
  | 'E_NOT_VISIBLE'
  | 'E_OUT_OF_AMMO'
  | 'E_PASS_NOT_ALLOWED'
  | 'E_GAME_OVER'
  | 'E_SCHEMA'
  /** a rule stubbed until a later stage */
  | 'E_TODO'

export interface Rejection {
  code: RejectionCode
  reason: string
  details?: Record<string, unknown>
}

/** Per-seat redacted view handed to deciders. */
export type PlayerView = Omit<GameState, 'rng' | 'log'> & { viewer: Seat }

export interface StepResult {
  state: GameState
  events: import('./events').GameEvent[]
  pending: PendingDecision | null
  rejection?: Rejection
}

export interface SaveFile {
  version: 1
  engineVersion: string
  setup: GameSetup
  seed: string
  actions: Action[]
  finalHash: string
}
