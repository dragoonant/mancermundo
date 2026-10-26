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
  /** batch D prep: false = never on a roster; snapshotted with its team for transformOperative (Mutant, Torment) */
  selectable?: boolean
  /** M2b-game: every legal chosen-weapon set (profile ids, fixed weapons excluded) when the card has a loadout choice tree */
  legalLoadouts?: string[][]
  figureArchetype?: string
  /** M9 batch B: extra equipment options the team may take while this operative is on the roster (Hearthkyn Lugger) */
  extraEquipment?: number
  /** M9 batch B: an oval base (mm), for every loadout or only loadouts with one of `weapons` (Hunter Clade arquebus GUNNER) */
  ovalBase?: { long: number; short: number; weapons?: string[] }
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
  /** M9 prep: false while the team is scaffolded (left out of the picker, sims and bench) */
  playable?: boolean
  /** M9 batch B: per-operative keyword picks made at selection (Legionaries Marks of Chaos); data OperativeChoice */
  operativeChoices?: {
    id: string
    label: string
    keywords: string[]
    forKeyword?: string
    exclude?: { datacards: string[]; keywords: string[] }[]
    /** M9 batch C: no two operatives of the roster take the same pick (Boons of Tzeentch) */
    unique?: boolean
    /** M9 batch C: the pick must differ from the same operative's picks for these choices (Custom: two different rules) */
    distinctFrom?: string[]
    /** M9 batch C: false makes the pick a tag read by team code, not a keyword (`hasKeyword` ignores it); default true */
    keyword?: boolean
    /** batch C shared: display label per pick (keywords stay uppercase; a label may read "ACCURATE 1 + PIERCING 1") */
    labels?: Record<string, string>
  }[]
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
  /** M9 batch B: operative choice id -> keyword (Marks of Chaos); missing picks take the first allowed keyword */
  picks?: Record<string, string>
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
  /** batch D prep: APL decreases are ignored, increases still count (Mirror-visor, Toxic Blessings) */
  ignoreAplDecreases?: boolean
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
  /**
   * M9 batch B: oval bases only (footprint.ts). The base is three discs of `baseRadius` on its long axis, which
   * lies along `facing`; this is the centre-to-end-disc distance in inches (half the long axis minus baseRadius).
   */
  ovalHalfAxis?: number
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
  /** batch C shared: `ceiling` caps the APL this change can bring the operative to (Battle Comms: "to a maximum of 3") */
  aplFx?: { delta: number; source: string; ceiling?: number }[]
  /** M2b-game: Chapter Veteran tactic ids this operative has in addition to the team's */
  extraTactics?: string[]
  /** M9 prep: tokens other rules put on this operative (Markerlight, Poison, Chronometron...); see tokens.ts */
  tokens?: OperativeToken[]
  /** M9 prep: inches of movement spent (climb, drop and Accessible costs included) in its current activation */
  movedThisActivation?: number
  /** M9 prep: every action it performed this turning point (activations, counteractions and free actions) */
  actionsThisTp?: string[]
  /**
   * M9 prep: why the operative is out of the killzone while `status` is 'reserve' after set-up (reserve.ts):
   * 'setAside' (set aside at set-up: Wyrmblade HIDING) or any kind a team rule passes to setAside()
   */
  offboard?: string
  /** M9 prep: an incapacitated operative that may still return (Reanimation Protocols); removed operatives keep it */
  returnable?: boolean
  /**
   * M9 batch B: keywords picked at selection, operative choice id -> keyword (Legionaries Marks of Chaos). Real
   * keywords for every rule (conditions.hasKeyword), public in view; changed only through operative-picks.setOperativePick
   */
  picks?: Record<string, string>
  /**
   * batch D prep (killLog): who dealt the damage that last took this operative to 0 wounds and of what kind
   * (`source` as passed to inflict: crit, normal, direct...); kept after removal
   */
  incapacitatedBy?: { id: string; source: string }
}

/** batch D prep (killLog): one removal from the killzone, any cause, in order (`GameState.kills`, kills.ts). */
export interface KillRecord {
  removedId: string
  victimSeat: Seat
  /** the operative whose damage incapacitated it, when that was an operative */
  killerId: string | null
  killerSeat: Seat | null
  /** attack dice, direct damage (mines, rules), out of the killzone at a deadline, or scored before removal (Frenzy) */
  cause: 'attack' | 'direct' | 'offboard' | 'scored'
  turningPoint: number
  /** state.seq of the step that recorded it */
  seq: number
  /** a `scored` record whose operative has since been removed */
  removedLater?: boolean
}

/** M9 prep: one stack of tokens of one kind, owned by one player, on an operative (tokens.ts). */
export interface OperativeToken {
  /** token kind, e.g. 'pf.markerlight', 'pm.poison' */
  kind: string
  /** the player whose rule placed it */
  owner: Seat
  count: number
  /** operative whose rule placed it (for expiry on its next activation or incapacitation) */
  sourceId?: string
  /** when it goes: 'battle' (default), 'turningPointEnd', 'sourceNextActivation', 'sourceIncapacitated', 'holderActivationEnd' */
  expires?: string[]
  /** state.seq of the step that first placed the stack (heldSinceActionStart: Toxic) */
  since?: number
  data?: Record<string, unknown>
}

export interface PlayerState {
  seat: Seat
  teamId: string
  cp: number
  vp: number
  equipment: string[]
  dropZoneId: string | null
  /** M9 batch C: team resource pools (pools.ts: Novitiates Faith points), kind -> value; public */
  pools?: Record<string, number>
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
  /** batch D prep: only this seat's operatives may Pick Up the marker (Bloody Cadaver) */
  pickableBy?: Seat
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

export type SetupStep = 'rollOff' | 'decideInitiative' | 'objectives' | 'dropZones' | 'equipment' | 'deploy' | 'preBattle' | 'done'

export interface SetupState {
  step: SetupStep
  rolls: { A?: number; B?: number }
  rollWinner: Seat | null
  setupInitiative: Seat | null
  /** seat to choose the next drop zone */
  dropZoneTurn: Seat | null
  /**
   * `aside` (batch D prep, setAsideBatches): this batch is being set aside (true) or deployed (false); unset until its
   * first answer
   */
  deploy: { turn: Seat; left: number; aside?: boolean }
  /** batch D prep (setAsideBatches): deploy batches each seat has started so far */
  batches?: Partial<Record<Seat, number>>
  /** batch D prep (preBattleChoices): whose turn it is to choose, and the seats that are finished */
  preBattle?: { turn: Seat; done: Seat[] }
}

export interface StrategyState {
  step: 'initiative' | 'decide' | 'ready' | 'gambit' | 'done'
  rolls: { A?: number; B?: number }
  /** M9 batch B: seats already asked whether to re-roll their initiative die this TP (Writ of Claim) */
  rerollAsked?: Seat[]
  /** `order` (M9 batch B): the gambits used in this step so far, in order (gambit.passed hook) */
  gambit: { turn: Seat; passes: number; used: Record<Seat, string[]>; order?: { seat: Seat; gambitId: string }[] }
  /** batch C shared: seats still to be asked for Ready-step choices (team-rules readyStepChoices), in order */
  readyChoices?: Seat[]
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
  /** M9 prep: state.seq of the step that declared the current action */
  declaredSeq?: number
  /** M9 prep: this activation was owed to a chain (Group Activation), so it cannot chain again */
  chained?: boolean
  /** M9 prep: performed.length when reactions were last offered (one reaction window per action) */
  reactedAt?: number
  /**
   * batch C shared: the reaction round of the action at `reactedAt`: whose turn it is to react (the active seat's
   * ownReactions first, then the other seat's reactions), the operatives that have reacted, and whether that seat passed
   */
  reacted?: { seat: Seat; ids: string[]; closed?: boolean }
  /** M9 shared: a rule ended the activation early (Medic!): it ends once the current action is done, AP untouched */
  endsAfterAction?: boolean
  /**
   * M9 batch B: actions (universal ids or `ability:<id>`) the operative cannot take for the rest of this activation
   * or counteraction, set by an `action.declared` hook that cancelled one (Daemonic Aura)
   */
  barred?: string[]
  /**
   * M9 batch B: a joint activation (Extremis Mind-Link): the other operative activated together with this one, with
   * its own AP, actions and restrictions. The player switches between them (`firefight.action` 'switch'); ending one
   * hands over to the other, and the activation is over when both have ended (firefight.joinActivation)
   */
  partner?: Activation
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
  /** M9 prep: a chained activation is owed (Group Activation): the seat must activate one of these next */
  chain?: { seat: Seat; ids: string[]; from: string } | null
  /** M9 prep: operatives a rule stopped from activating at this activate decision (Vision of Madness) */
  gated?: string[]
  /**
   * M9 shared: a reaction offered after a Strategy-phase move (no activation to go back to) is in progress;
   * firefight.reactionDone finishes closing the mover's frame with these (resume name, outcome, frame data)
   */
  reactionAfter?: {
    resume: string
    outcome: 'finished' | 'cancelled'
    data: Record<string, unknown>
    /** M10 batch D shared: the actor's own reaction comes first; then this seat's reactions are asked (reactionDone) */
    then?: { seat: Seat; info: Record<string, unknown>; window: TimingWindowId; filterFree: boolean }
  } | null
  /** M9 batch B: a reaction offered at the end of an activation or counteraction is in progress; reactionDone advances */
  reactionAtEnd?: boolean
  /** M9 batch B: a ploy in firefight.beforeActivation made this seat pass its activation this time (Heinous Arrogance) */
  skipping?: Seat | null
  /** M9 batch B: the firefight.beforeActivation window raised a decision for this seat's current turn (cleared when it activates or passes) */
  beforeActivationFor?: Seat | null
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
  removal?: {
    ids: string[]
    hooked: string[]
    /** M9 shared: ids whose operative.incapacitated ploy window was offered */
    windowed?: string[]
    /** M9 batch B: ids whose operative.killed window (the killer's seat, after removal) was offered */
    killWindowed?: string[]
    /** M9 batch B: removed operative id -> the operative whose attack incapacitated it */
    killers?: Record<string, string>
    /**
     * M10 batch D shared: a queue of removals outside an attack, deferred to the end of the step so it can pause for
     * decisions (attack-common.runDeferredRemovals); when it finishes, `parked` (the decision the step had raised)
     * is pending again instead of the attack's finishAction
     */
    deferred?: boolean
    parked?: PendingDecision | null
    /** M10 batch D shared: ids a before-removal rule saved (attack-common.saveFromRemoval); the queue skips them */
    saved?: string[]
  } | null
  /** M10 batch D shared: operatives incapacitated outside an attack whose removal waits for the end of the step */
  deferredRemovals?: string[]
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
  /** M9 batch B: windows suspended under a nested one (ploy.opponentUsed opened inside another window), innermost last */
  windowStack?: PloyWindowState[]
  /** counter for ActiveEffect ids */
  nextEffect: number
  /** batch D prep (killLog): every removal from the killzone, any cause, in order (kills.ts) */
  kills?: KillRecord[]
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
  /** M9 batch B: only dice showing one of these values may be re-rolled with this grant (Omen: re-roll any 1s) */
  values?: number[]
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
  /** M9 prep: no die of this side may be re-rolled by any rule (Nightmare Shroud, Suppressing Fire) */
  noRerolls?: boolean
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
  /**
   * batch D prep: the unblocked successes about to inflict damage, set once blocks are allocated; the
   * shoot.beforeResolve window (Drag) may lower them (discard) before damage reads them
   */
  unblocked?: { normal: number; crit: number }
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
  /** M9 batch C: the targets were fixed by a team rule (Detonate); forced statuses for every sequence */
  fixed?: { noCover?: boolean; noObscured?: boolean }
  /** M9 batch C: the most extra primary targets a team rule allows on top of the first (Salvo) */
  extraMax?: number
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
    /** M9 prep: resolutions owed out of the normal alternation (Bladed Stance, Assassinate), consumed first */
    queue?: { seat: Seat; blockOnly?: boolean; strikeOnly?: boolean; resume?: Seat }[]
    /** M9 prep: seats that cannot block in this sequence (Point-Blank Fusillade) */
    noBlock?: Seat[]
    /** M9 prep: fightResolveStart providers have run for this sequence */
    started?: boolean
  }
  /** M9 prep: the operative used as the active operative for target selection, cover and obscured (Magnify) */
  viewpointId?: string
}

// ---------------------------------------------------------------------------
// Decisions, actions, rejections
// ---------------------------------------------------------------------------

export type TimingWindowId =
  | 'setup.*'
  | 'turningPoint.start'
  | 'strategy.gambit'
  // M9 shared: the Firefight phase begins, before the first activation (A Worthy Cause)
  | 'firefight.start'
  | 'firefight.activationStart'
  | 'firefight.actionDeclared'
  // M9 batch B: any action was declared, offered to the other seat only, before it resolves (Scrapcode Overload)
  | 'firefight.opponentActionDeclared'
  // M9 batch B: the seat on turn is about to pick an operative to activate (offered to that seat only; Heinous Arrogance)
  | 'firefight.beforeActivation'
  // M9 batch B: the other seat has just used a ploy or gambit (info ployId, usedBy; Devious Scheme)
  | 'ploy.opponentUsed'
  // M9 batch B: an operative was removed after an attack; offered to the seat whose operative incapacitated it
  // (subjectId = that operative, removedId, removedPos; Vitalised Surge, Brutal Display)
  | 'operative.killed'
  | 'firefight.actionEnded'
  | 'shoot.targetSelected'
  | 'shoot.attackRolled'
  | 'shoot.defenceRolled'
  | 'shoot.resolved'
  | 'fight.weaponsSelected'
  | 'fight.rolled'
  | 'fight.resolved'
  // M9 shared: right after the dice are rolled, before any re-roll (Curse of Rot): the attacker after the defence
  // roll of a Shoot; both fighters after the fight roll
  | 'shoot.beforeDefenceRerolls'
  | 'fight.beforeRerolls'
  // M9 batch B: the attacker on the fresh attack roll of a Shoot before any re-roll (Engage to Acquire); the
  // defender once the attack dice are final, before defence dice are collected (Refractor Field)
  | 'shoot.beforeAttackRerolls'
  | 'shoot.beforeDefenceRoll'
  // M9 batch B: the defender on its own fresh defence roll, after the attacker's shoot.beforeDefenceRerolls
  | 'shoot.defenderBeforeRerolls'
  // M9 batch B shared: the attacker once the defence dice are final, before blocking (Siphon Life: shoot.defenceRolled
  // is the defender's)
  | 'shoot.attackerDefenceRolled'
  // batch C shared: the defender on the fresh attack roll of a Shoot, after the attacker's shoot.beforeAttackRerolls
  // and before attack re-rolls (Fate Itself is My Weapon edits seq.atk.dice)
  | 'shoot.defenderAttackRolled'
  // batch C shared: the Fall Back mover between its move and the end of the action (Cover Retreat)
  | 'firefight.fallBackMoved'
  | 'firefight.chargeMoved'
  | 'shoot.beforeResolve'
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
  /** M9 prep: `setAside: true` keeps the operative out of the killzone instead (reserve.ts; x and z are ignored) */
  /** M9 batch B: `facing` (radians, +Z = 0) orients an oval base; ignored for round bases (they face the killzone centre) */
  'setup.deploy': { operativeId: string; x: number; z: number; y?: number; setAside?: boolean; facing?: number }
  'setup.equipMarker': { x: number; z: number; yaw?: number }
  'setup.objective': { x: number; z: number }
  /** M9 batch B: `reroll` answers an initiative re-roll offer (true re-rolls the seat's die, false keeps it) */
  'strategy.initiative': { reroll?: boolean }
  'strategy.decideInitiative': { seat: Seat }
  'strategy.gambit': { gambitId: string; param?: string }
  'firefight.activate': { operativeId: string; counteract?: boolean; /** M9 batch C: index of a counteract alternative (team-rules counteractAlternatives) */ alternative?: number }
  'firefight.order': { order: Order }
  /** `action` is a universal action id, or `ability:<id>` / `marker:pickUp` / `marker:place` for the rest; the other fields pick targets */
  'firefight.action': { action: string; markerId?: string; targetId?: string; param?: string; x?: number; z?: number; y?: number }
  /**
   * M9 batch B: `facing` turns an oval base in place at the end of the move (radians, +Z = 0), paying the arc its
   * long-axis end sweeps (footprint.rotationCost); round bases ignore it and face along their last increment
   */
  'move.path': {
    waypoints: Waypoint[]
    facing?: number
    /** M9 batch B: FLY (Jump Pack): one waypoint, the operative is set up there instead of moving along a path */
    fly?: boolean
  }
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
  /** M9 prep: a Charge that must end in this particular enemy's control range (Assassinate, Quicksilver Strike) */
  mustEndInControlRangeOfId?: string
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
