// Contract types for the engine (code form of docs/spec/00-architecture.md sections 3-7).
// Frozen after M2: changes are additive and get a dated row in the 00-architecture change log.

// M2b-game: the engine reads data records through these type-only imports (allowed by 00-architecture section 1).
import type { Condition, Effect, EffectList, EquipmentData, MissionData, PloyData, TargetSpec } from '../data/types'
export type { Condition, Effect, EffectList, EquipmentData, MissionData, PloyData, TargetSpec }

export type Seat = 'A' | 'B'
export type Order = 'engage' | 'conceal'
export type Phase = 'setup' | 'strategy' | 'firefight' | 'ended'

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

export type RollTarget = 2 | 3 | 4 | 5 | 6

export type TerrainTrait =
  | 'light'
  | 'heavy'
  | 'blocking'
  | 'vantage'
  | 'accessible'
  | 'insignificant'
  | 'exposed'
  | 'ceiling'
  | 'barred'
  | 'wall'

// ---------------------------------------------------------------------------
// Runtime data shapes (the engine's own view of data; TODO(M2b) adapter fills them from src/data)
// ---------------------------------------------------------------------------

export interface WeaponRuleRef {
  rule: string
  x?: number
  inches?: number
  target?: RollTarget
  crits?: boolean
  /** Heavy (Dash only) / Heavy (Reposition only): the one move that stays allowed (M2b-attack) */
  only?: 'dash' | 'reposition'
}

export interface RuntimeWeapon {
  id: string
  name: string
  type: 'ranged' | 'melee'
  atk: number
  hit: RollTarget
  dmg: { normal: number; crit: number }
  rules: WeaponRuleRef[]
  profileGroup?: string
  code?: string
}

export interface RuntimeAbility {
  id: string
  name: string
  kind: 'ability' | 'uniqueAction' | 'weaponRule' | 'factionRule' | 'archetype'
  ap?: number
  keywords?: string[]
  /** declarative effect or `{ code }` escape hatch; interpreted in M2b */
  effect?: unknown
  conditions?: Record<string, unknown>
  code?: string
  // M2b-game: the rest of the data record, carried over by the adapter
  teamId?: string
  target?: TargetSpec
  window?: string | string[]
  when?: Condition
  limit?: 'oncePerBattle' | 'oncePerTurningPoint' | 'oncePerActivation' | 'unlimited'
  scope?: TargetSpec
  choiceGroup?: string
  text?: string
  /** code hook names found anywhere in `effect` (adapter fills this) */
  codes?: string[]
}

export interface WeaponOption {
  id: string
  pick: number
  min?: number
  from: string[]
}

export interface RuntimeDatacard {
  id: string
  name: string
  teamId: string
  apl: number
  move: number
  save: RollTarget
  wounds: number
  baseMm: number
  /** miniature height in inches; derived from the base when omitted */
  heightInches?: number
  keywords: string[]
  fixedWeapons: string[]
  weaponOptions: WeaponOption[]
  abilities: string[]
  uniqueActions: string[]
  expendable?: boolean
  nonOperativeForSelection?: boolean
  /** M2b-game: every legal chosen-weapon set (profile ids, fixed weapons excluded) when the card has a loadout choice tree */
  legalLoadouts?: string[][]
  figureArchetype?: string
}

export interface RuntimeTeam {
  id: string
  name: string
  factionKeyword: string
  operatives: number
  // M2b-game
  archetypes?: string[]
  /** team-level picks made at selection (Chapter Tactics): id, label, ability group, ids it must differ from */
  teamChoices?: { id: string; label: string; group: string; distinctFrom?: string[] }[]
  factionRules?: string[]
  ploys?: string[]
  equipment?: string[]
}

/** M2b-game: strategy and firefight ploys, equipment and missions are the data records themselves. */
export type RuntimePloy = PloyData
export type RuntimeEquipment = EquipmentData
export type RuntimeMission = MissionData

export interface RuntimeGambit {
  id: string
  name: string
  cost: number
  teamId?: string
}

/** The weapons an operative chose from its datacard options (fixed weapons are implied). */
export interface Loadout {
  weaponIds: string[]
}

/** Snapshot of the data the game uses; copied into the state so `step` needs no bundle. */
export interface GameData {
  dataVersion: string
  datacards: Record<string, RuntimeDatacard>
  weapons: Record<string, RuntimeWeapon>
  abilities: Record<string, RuntimeAbility>
  teams: Record<string, RuntimeTeam>
  gambits: RuntimeGambit[]
  // M2b-game: optional so synthetic test bundles stay valid
  ploys?: Record<string, RuntimePloy>
  equipment?: Record<string, RuntimeEquipment>
  missions?: Record<string, RuntimeMission>
}

// ---------------------------------------------------------------------------
// Map and terrain
// ---------------------------------------------------------------------------

export interface TerrainPartDef {
  id: string
  footprint: Polygon
  /** top surface height in inches above the killzone floor */
  height: number
  /** underside of the solid; defaults to 0 (Ceiling parts default to height - 0.25) */
  bottom?: number
  traits: TerrainTrait[]
  /** extra placeable surface heights (Vantage floors) in addition to `height` for Vantage parts */
  vantageFloors?: number[]
  /** ignored when judging control range visibility (doors, low stronghold parts) */
  crTransparent?: boolean
  /** M2b-game: wall thickness in inches (Breach), and free tags such as 'obstructing' (Razor Wire), 'protective', 'portable' */
  thickness?: number
  tags?: string[]
}

export interface TerrainFeatureDef {
  id: string
  name?: string
  parts: TerrainPartDef[]
  /** M2b-game: set on features created from equipment (razor wire, barricades, ladders) */
  equipmentId?: string
  /** owner of an equipment feature */
  owner?: Seat
  /** ladders: the part id the ladder leans on */
  leansOn?: string
}

export interface DropZoneDef {
  id: string
  polygon: Polygon
  /** M2b-game: the half-board territory this drop zone lies in (Preliminary Ops maps) */
  territory?: Polygon
}

export interface MapDef {
  id: string
  size: { x: number; z: number }
  dropZones: DropZoneDef[]
  features: TerrainFeatureDef[]
  /** M2b-game: mission geometry carried by Preliminary Ops maps */
  meta?: MapMeta
  /** M2b-game: candidate objective spots per mission map id (from the killzone layout) */
  spotsByMap?: Record<string, ObjectiveSpotsDef>
}

export interface ObjectiveSpotsDef {
  centre: Vec2[]
  territoryA: Vec2[]
  territoryB: Vec2[]
  default: { centre: Vec2; a: Vec2; b: Vec2 }
}

export interface Segment2 {
  a: Vec2
  b: Vec2
}

/** M2b-game: geometry of the mission map (centreline, neutral edges, candidate objective spots). */
export interface MapMeta {
  missionMapId: string
  centreline: Segment2
  neutralEdges: Segment2[]
  centrePoint: Vec2
  territories: Polygon[]
  /** candidate objective spots from the killzone layout for this map */
  objectiveSpots?: ObjectiveSpotsDef
}

export interface RulesOptions {
  /** other operatives' cylinders block visibility (00-architecture section 7). Default true. */
  operativesBlockVisibility: boolean
}

export interface RosterEntry {
  datacardId: string
  loadout?: Loadout
  name?: string
  /** M2b-game: Chapter Veteran pick (a Chapter Tactic ability id) for this operative */
  chapterVeteran?: string
}

export interface GameSetup {
  teams: Record<Seat, string>
  rosters: Record<Seat, RosterEntry[]>
  /** equipment option ids per seat (up to the mission limit, no repeats) */
  equipment?: Record<Seat, string[]>
  map: MapDef
  rules?: Partial<RulesOptions>
  // M2b-game (all optional; the synthetic fixtures use none of them)
  /** Preliminary Ops: omit a field to have the engine roll it (map D6, crit op D3) */
  mission?: { missionId?: string; mapId?: string }
  /** place the three objective markers from the layout's default spots instead of asking the players */
  autoObjectives?: boolean
  /** place equipment markers and terrain with the engine's suggestion instead of asking the players */
  autoEquipment?: boolean
  /** team-level picks per seat keyed by team choice id (primary-tactic, secondary-tactic) */
  teamChoices?: Record<Seat, Record<string, string>>
  /** grenade picks per seat: equipment id -> picked action/weapon ids (Utility and Explosive Grenades) */
  equipmentChoices?: Record<Seat, Record<string, string[]>>
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface RngState {
  s: [number, number, number, number]
}

export type OperativeStatus = 'reserve' | 'active' | 'removed'

export interface OperativeFlags {
  guard: boolean
  counteractedThisTP: boolean
  carrying: string | null
  injured: boolean
  /** cannot retaliate until the end of the interrupted activation (point-blank shot, R-4.11); M2b-attack */
  cannotRetaliate?: boolean
  /** M2b-game: every change to this operative's APL is ignored (Resolute until forever, Shake It Off until the next TP) */
  ignoreApl?: boolean
  /** M2b-game: injured stat penalties are ignored (And They Shall Know No Fear) */
  ignoreInjured?: boolean
}

export interface Operative {
  id: string
  seat: Seat
  datacardId: string
  name: string
  loadout: Loadout
  /** fixed + chosen weapon ids */
  weapons: string[]
  status: OperativeStatus
  /** pos.y = surface height under the base (Vantage floors) */
  pos: Vec3
  /** radians; bearing of the last move, +Z is 0 */
  facing: number
  baseRadius: number
  height: number
  wounds: number
  maxWounds: number
  order: Order
  ready: boolean
  /** printed APL */
  apl: number
  /** net APL modifiers, clamped to +/-1 when applied */
  aplMods: number
  move: number
  save: RollTarget
  flags: OperativeFlags
  usedLimited: Record<string, number>
  oncePerBattleUsed: string[]
  /** timed APL effects folded into aplMods; removed at the end of the operative's next activation (Stun); M2b-attack */
  aplFx?: { delta: number; source: string }[]
  /** M2b-game: Chapter Veteran tactic ids this operative has in addition to the team's */
  extraTactics?: string[]
}

export interface PlayerState {
  seat: Seat
  teamId: string
  cp: number
  vp: number
  equipment: string[]
  dropZoneId: string | null
}

export type MarkerKind = 'objective' | 'equipment'

export interface Marker {
  id: string
  kind: MarkerKind
  pos: Vec2
  owner: Seat | null
  carriedBy: string | null
  controller: Seat | null
  // M2b-game
  /** equipment id for equipment markers, 'smoke' / 'breach' for action markers */
  equipmentId?: string
  /** an operative may use Pick Up Marker on it (R-4.5); no v1 marker is pickable */
  pickable?: boolean
  /** Mines are hidden from the opponent until they trigger (view.ts) */
  hidden?: boolean
  /** Breach / Smoke markers: the operative that placed it */
  placedBy?: string
  /** turning point in which the marker was last used (Ammo Cache) or looted */
  usedTp?: number
  /** Smoke: activations of the next TP left before it clears (rolled in the Ready step); null until rolled */
  clearsAfter?: number | null
  /** Breach: the terrain feature the marker was placed against */
  featureId?: string
}

export type SetupStep = 'rollOff' | 'decideInitiative' | 'objectives' | 'dropZones' | 'equipment' | 'deploy' | 'done'

export interface SetupState {
  step: SetupStep
  rolls: { A?: number; B?: number }
  rollWinner: Seat | null
  setupInitiative: Seat | null
  /** seat to choose the next drop zone */
  dropZoneTurn: Seat | null
  deploy: { turn: Seat; left: number }
}

export interface StrategyState {
  step: 'initiative' | 'decide' | 'ready' | 'gambit' | 'done'
  rolls: { A?: number; B?: number }
  gambit: { turn: Seat; passes: number; used: Record<Seat, string[]> }
}

export interface Activation {
  operativeId: string
  seat: Seat
  counteract: boolean
  stage: 'order' | 'action'
  apSpent: number
  performed: string[]
  declared: { action: string; cost: number; free?: boolean; params?: Record<string, unknown> } | null
  /** weapon ids used by Shoot/Fight actions in this activation (Heavy bookkeeping); M2b-attack */
  weaponsUsed?: string[]
  /**
   * M2b-game: set on a temporary frame (Guard interrupt, free Dash, Wrath bonus, ...): the underlying
   * activation, if any, waits in `FirefightState.stack` and `frame.resume` says what to do once the
   * frame's single action finishes or is cancelled.
   */
  frame?: ActivationFrame
  /** M2b-game: extra free actions still allowed in a counteraction (Wrath of Vengeance) */
  bonus?: number
  /** M2b-game: a surcharge in AP to add when the declared action finishes (ASTARTES repeating a heavy weapon) */
  surcharge?: number
  /** M2b-game: once-per-activation features already used (I Got a Plan, Ladz) */
  used?: string[]
}

export interface ActivationFrame {
  kind: 'interrupt' | 'free'
  resume: string
  data?: Record<string, unknown>
}

export interface FirefightState {
  turn: Seat
  activation: Activation | null
  /** M2b-game: activations suspended under a frame (innermost last) */
  stack?: (Activation | null)[]
}

export interface GameResult {
  winner: Seat | 'draw'
  vp: Record<Seat, number>
  reason: 'turningPoint' | 'resign'
  /** true until M2b scoring replaces the placeholder */
  placeholder: boolean
}

export interface GameState {
  version: 1
  engineVersion: string
  seed: string
  phase: Phase
  turningPoint: number
  /** number of accepted actions so far; equals log.length */
  seq: number
  nextDecision: number
  pending: PendingDecision | null
  rng: RngState
  hash: string
  log: Action[]
  /** seq of the last accepted action that rolled dice (-1 when none) */
  lastRollSeq: number
  origin: { setup: GameSetup }
  rules: RulesOptions
  data: GameData
  map: MapDef
  players: Record<Seat, PlayerState>
  operatives: Record<string, Operative>
  markers: Marker[]
  /** seat currently holding initiative */
  initiative: Seat | null
  setup: SetupState
  strategy: StrategyState
  firefight: FirefightState
  result: GameResult | null
  /** the Shoot or Fight sequence in progress (M2b-attack); absent or null between actions */
  attack?: AttackState | null
  /** incapacitated operatives waiting for their "before removal" hooks and removal (R-5.18); M2b-attack */
  removal?: { ids: string[]; hooked: string[] } | null
  // M2b-game
  /** team configuration per seat: Chapter Tactics, Adaptive Tactics, Combat Doctrine */
  config: Record<Seat, TeamConfig>
  /** Preliminary Ops state; null when the game has no mission (synthetic fixtures) */
  mission: MissionState | null
  /** effects that last for a window (ploys, OPTICS, Auspex); expired by `expires` */
  effects: ActiveEffect[]
  /** per-seat usage ledger for ploys, equipment and team-wide limits */
  ledger: Record<Seat, Ledger>
  /** equipment selection, placement queue and everything placed */
  equipment: EquipmentState
  /** the ploy window currently being offered, if any */
  window: PloyWindowState | null
  /** counter for ActiveEffect ids */
  nextEffect: number
}

export interface TeamConfig {
  /** team choice id -> ability id (primary-tactic, secondary-tactic) */
  choices: Record<string, string>
  /** Adaptive Tactics: replacement secondary tactic until the end of the TP */
  adaptive: string | null
  /** Combat Doctrine picked this TP (devastator | tactical | assault) */
  doctrine: string | null
}

export interface ActiveEffect {
  id: string
  /** ploy, ability or equipment id */
  source: string
  seat: Seat
  kind: string
  operativeId?: string
  /** 'turningPoint' | 'action' | 'activation' | 'sequence' | `startOfActivation:<operativeId>` */
  expires: string
  data?: Record<string, unknown>
}

export interface Ledger {
  /** ploys / one-shot features used this battle */
  battle: string[]
  /** ploys / one-shot features used this turning point */
  tp: string[]
  /** remaining or consumed counts keyed by feature (grenade totals, Dynamite) */
  uses: Record<string, number>
  /** counts that reset every turning point (Harpoon, Purity Seals) */
  tpUses: Record<string, number>
}

export interface EquipItem {
  key: string
  equipmentId: string
  kind: 'marker' | 'terrain'
}

export interface PlacedEquipment {
  key: string
  equipmentId: string
  seat: Seat
  kind: 'marker' | 'terrain'
  pos: Vec2
  yaw: number
  featureId?: string
  markerId?: string
}

export interface EquipmentState {
  /** items each seat still has to place */
  queue: Record<Seat, EquipItem[]>
  turn: Seat | null
  placed: PlacedEquipment[]
  /** grenade picks etc. per seat, equipment id -> picked ids */
  picks: Record<Seat, Record<string, string[]>>
}

export interface MissionState {
  id: string
  mapId: string
  critOp: string
  /** non-Expendable operatives each seat started with */
  startCount: Record<Seat, number>
  /** enemy (non-Expendable) operatives each seat's side has incapacitated */
  kills: Record<Seat, number>
  grade: Record<Seat, number>
  /** objective marker id -> team that secured it */
  secured: Record<string, Seat>
  /** objective marker ids transmitting until the start of the next TP */
  transmitting: string[]
  /** objective marker ids looted this TP */
  looted: string[]
  /** VP awarded per scoring rule id per seat over the battle */
  scored: Record<string, Record<Seat, number>>
  /** VP awarded this TP per cap group (or rule id) per seat */
  scoredTp: Record<string, Record<Seat, number>>
  /** objective placement progress */
  objectiveStep: number
  /** removed operatives already counted for kill grades */
  counted: string[]
}

export interface PloyWindowState {
  id: TimingWindowId
  /** seats still to be asked, in order */
  seats: Seat[]
  info: Record<string, unknown>
  /** what resumes when the window closes: 'attack' or a firefight token */
  resume: string
  /** ploys used in this window (feeds the resume) */
  used: string[]
}

// ---------------------------------------------------------------------------
// Attack sequences (M2b-attack): dice pools and the Shoot/Fight state machine
// ---------------------------------------------------------------------------

export type DieKind = 'fail' | 'normal' | 'crit'

export interface AttackDie {
  /** physical result; null when retained without rolling (Accurate, cover save) */
  value: number | null
  kind: DieKind
  /** a re-roll was made on this die (cannot be re-rolled again, R-9.2) */
  rerolled: boolean
  /** how the die came to be retained or converted: accurate | cover | punishing | rending | severe | obscured */
  tag?: string
  /** fight: struck, blocked or discarded */
  used?: boolean
}

export interface RerollGrant {
  id: string
  source: string
  /** one: re-roll one die; result: re-roll every die showing one chosen result; any: re-roll any dice */
  mode: 'one' | 'result' | 'any'
  used: boolean
}

export interface DiceSide {
  seat: Seat
  operativeId: string
  weaponId: string | null
  dice: AttackDie[]
  /** Hit (attack pools) or Save (defence pools) after modifiers */
  need: number
  lethal: number | null
  grants: RerollGrant[]
  commandUsed: boolean
  /** re-roll window progress for this side */
  phase: 'grants' | 'command' | 'done'
}

export interface AttackSequence {
  targetId: string
  secondary: boolean
  cover: boolean
  obscured: boolean
  /** Vantage improved cover save (R-11.5b) */
  improvedCover: boolean
  atk: DiceSide
  def: DiceSide | null
  critRetained: boolean
  /** defence dice collected before the cover save */
  collected: number
  /** defender cover choice: retain | roll | retainCrit | retainTwo */
  coverMode?: string
  /** answered weapon.choice requests */
  choices: Record<string, string>
}

export type AttackStage =
  | 'weapon'
  | 'target'
  | 'secondary'
  | 'statusChoice'
  | 'hookChoice'
  | 'attackReroll'
  | 'cover'
  | 'defenceReroll'
  | 'block'
  | 'fightTarget'
  | 'fightWeapon'
  | 'fightReroll'
  | 'resolve'

export interface AttackState {
  kind: 'shoot' | 'fight'
  stage: AttackStage
  operativeId: string
  seat: Seat
  weaponId: string | null
  /** point-blank shot: Hit worsened by 1 */
  pointBlank: boolean
  /** shoot: primary then secondaries, resolved in order */
  targets: string[]
  /** torrent: valid secondaries not yet picked */
  candidates: string[]
  index: number
  seq: AttackSequence | null
  /** incapacitated during this action; removed when it finishes (R-5.14) */
  incapacitated: string[]
  /** operatives hit by Stun this action (APL change applies after the action) */
  stunned: string[]
  /** inherited cover/obscured for Blast secondaries */
  inherit: { cover: boolean; obscured: boolean; improvedCover: boolean } | null
  /** window ids already offered for ploys during this action */
  windows: string[]
  /** step to continue with when a ploy window decision hands control back (resumeAttack) */
  resume?: string
  /** cover/obscured decided for the sequence about to start (kept across the targetSelected window) */
  status?: { cover: boolean; obscured: boolean; improvedCover: boolean }
  /** fight */
  fight?: {
    targetId: string
    weaponA: string | null
    weaponD: string | null
    /** seat to act next: re-roll turn or strike/block */
    turn: Seat
    passes: number
    shockUsed: Record<Seat, boolean>
  }
}

// ---------------------------------------------------------------------------
// Decisions, actions, rejections
// ---------------------------------------------------------------------------

export type TimingWindowId =
  | 'setup.*'
  | 'turningPoint.start'
  | 'strategy.gambit'
  | 'firefight.activationStart'
  | 'firefight.actionDeclared'
  | 'firefight.actionEnded'
  | 'shoot.targetSelected'
  | 'shoot.attackRolled'
  | 'shoot.defenceRolled'
  | 'shoot.resolved'
  | 'fight.weaponsSelected'
  | 'fight.rolled'
  | 'fight.resolved'
  | 'operative.incapacitated'
  | 'firefight.activationEnded'
  | 'turningPoint.end'
  | 'battle.end'

export type DecisionKind =
  | 'setup.initiative'
  | 'setup.decideInitiative'
  | 'setup.dropZone'
  | 'setup.deploy'
  | 'setup.equipMarker'
  | 'setup.objective'
  | 'strategy.initiative'
  | 'strategy.decideInitiative'
  | 'strategy.gambit'
  | 'firefight.activate'
  | 'firefight.order'
  | 'firefight.action'
  | 'move.path'
  | 'shoot.weapon'
  | 'shoot.target'
  | 'shoot.coverSave'
  | 'shoot.block'
  | 'fight.target'
  | 'fight.weapon'
  | 'fight.resolve'
  | 'dice.reroll'
  | 'dice.commandReroll'
  | 'weapon.choice'
  | 'ploy.firefight'
  | 'guard.interrupt'
  | 'marker.pickUp'
  | 'marker.place'
  | 'mission.action'
  | 'ability.choice'
  | 'confirm'

export interface Waypoint {
  x: number
  z: number
  /** surface height the increment ends on; defaults to the previous waypoint's */
  y?: number
  /** this increment is a jump (R-12.4) */
  jump?: boolean
}

export interface ActionPayloadMap {
  'setup.initiative': Record<string, never>
  'setup.decideInitiative': { seat: Seat }
  'setup.dropZone': { zoneId: string }
  'setup.deploy': { operativeId: string; x: number; z: number; y?: number }
  'setup.equipMarker': { x: number; z: number; yaw?: number }
  'setup.objective': { x: number; z: number }
  'strategy.initiative': Record<string, never>
  'strategy.decideInitiative': { seat: Seat }
  'strategy.gambit': { gambitId: string; param?: string }
  'firefight.activate': { operativeId: string; counteract?: boolean }
  'firefight.order': { order: Order }
  /** `action` is a universal action id, or `ability:<id>` / `marker:pickUp` / `marker:place` for the rest; the other fields pick targets */
  'firefight.action': { action: string; markerId?: string; targetId?: string; param?: string; x?: number; z?: number; y?: number }
  'move.path': { waypoints: Waypoint[] }
  'shoot.weapon': Record<string, unknown>
  'shoot.target': Record<string, unknown>
  'shoot.coverSave': Record<string, unknown>
  'shoot.block': Record<string, unknown>
  'fight.target': Record<string, unknown>
  'fight.weapon': Record<string, unknown>
  'fight.resolve': Record<string, unknown>
  'dice.reroll': Record<string, unknown>
  'dice.commandReroll': Record<string, unknown>
  'weapon.choice': Record<string, unknown>
  'ploy.firefight': { ployId: string; param?: string; operativeId?: string }
  'guard.interrupt': { operativeId: string; action: 'shoot' | 'fight' }
  'marker.pickUp': { markerId: string }
  'marker.place': { x: number; z: number }
  'mission.action': { markerId: string }
  'ability.choice': { option: string }
  confirm: Record<string, unknown>
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

export interface MoveConstraints {
  kind: 'reposition' | 'dash' | 'fallBack' | 'charge' | 'deploy'
  operativeId?: string
  operativeIds?: string[]
  origin?: Vec3
  baseRadius?: number
  maxInches?: number
  allowClimb?: boolean
  allowEnterEnemyControlRange?: boolean
  mustEndInControlRangeOf?: 'enemy'
  mustEndOutsideControlRange?: boolean
  counteract?: boolean
  /** deploy: the polygon the base must lie wholly within */
  region?: Polygon
}

export interface PendingDecision {
  id: string
  seat: Seat
  kind: DecisionKind
  window: TimingWindowId
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
  | 'E_CONTROL_RANGE'
  | 'E_NO_PATH'
  | 'E_NO_AP'
  | 'E_ACTION_RESTRICTED'
  | 'E_INVALID_TARGET'
  | 'E_NOT_VISIBLE'
  | 'E_INSUFFICIENT_CP'
  | 'E_PLOY_USED'
  | 'E_PASS_NOT_ALLOWED'
  | 'E_GAME_OVER'
  | 'E_SCHEMA'
  /** the rule exists but is implemented in a later milestone (M2b stubs) */
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
