/**
 * TypeScript mirror of docs/spec/schemas/*.schema.json (copied to src/data/schema/).
 * Hand-maintained: tests/data/schemas.test.ts and tools/validate-data.ts keep the
 * JSON in step with the schemas; any schema change must change this file in the same commit.
 */

// ---------------------------------------------------------------- primitives
/** Lowercase kebab, dot-namespaced: aod.intercessor-sergeant, core.wr.piercing, kz.volkus-ao25-1. */
export type Id = string
export type Slug = string
export type ActionId = string
export type Keyword = string
/** A D6 target such as "3+". */
export type RollTarget = string
export type Inches = number
/** D3, D6, 2D6, D3+3 or an integer in text. */
export type DiceExpr = string
export type Source = string
export type CodeName = string

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
export interface Segment {
  a: Vec2
  b: Vec2
}
export interface Hsl {
  h: number
  s: number
  l: number
}

export type Seat = 'A' | 'B'
export type Order = 'engage' | 'conceal'
export type WeaponType = 'ranged' | 'melee'
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

export type TimingWindowId =
  | 'turningPoint.start'
  | 'strategy.gambit'
  | 'firefight.start'
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
  | 'shoot.beforeDefenceRerolls'
  | 'fight.beforeRerolls'
  // M9 batch B
  | 'firefight.opponentActionDeclared'
  | 'firefight.beforeActivation'
  | 'ploy.opponentUsed'
  | 'operative.killed'
  | 'shoot.beforeAttackRerolls'
  | 'shoot.beforeDefenceRoll'
  | 'shoot.defenderBeforeRerolls'
  // M9 batch B shared: the attacker once the defence dice are final (Siphon Life)
  | 'shoot.attackerDefenceRolled'
  // batch C shared: the defender before attack re-rolls; the Fall Back mover after its move
  | 'shoot.defenderAttackRolled'
  | 'firefight.fallBackMoved'
  | 'firefight.chargeMoved'
  | 'shoot.beforeResolve'
  | 'operative.incapacitated'
  | 'firefight.activationEnded'
  | 'turningPoint.end'
  | 'battle.end'
  | `setup.${string}`
export type WindowSet = TimingWindowId | TimingWindowId[]

export type Limit = 'oncePerBattle' | 'oncePerTurningPoint' | 'oncePerActivation' | 'unlimited'
export type Duration =
  | 'action'
  | 'activation'
  | 'untilNextActivation'
  | 'endOfTargetNextActivation'
  | 'turningPoint'
  | 'battle'

// ------------------------------------------------------- conditions and effects
export interface Condition {
  notInEnemyControlRange?: boolean
  inEnemyControlRange?: boolean
  counteracting?: boolean
  notCounteracting?: boolean
  order?: Order
  action?: ActionId
  activationIncludes?: ActionId[]
  activationExcludes?: ActionId[]
  actionPerformed?: Id
  weaponType?: WeaponType
  weaponNameContains?: string
  weaponHasRule?: Id
  targetKeyword?: Keyword
  targetNotKeyword?: Keyword
  targetOrder?: Order
  targetDistanceMoreThan?: Inches
  targetDistanceWithin?: Inches
  attackFailsAtLeast?: number
  defenceFailsAtLeast?: number
  critRetained?: boolean
  turningPoint?: { min?: number; max?: number }
  firstShootOfBattle?: boolean
  survived?: boolean
  inKillzone?: boolean
  subjectKeyword?: Keyword
  subjectNotKeyword?: Keyword
  subjectOrder?: Order
  subjectNotValidTarget?: boolean
  subjectMoreThanFromEveryEnemy?: Inches
  ployUsedThisTurningPoint?: Id
  ployNotUsedThisTurningPoint?: Id
  allOf?: Condition[]
  anyOf?: Condition[]
  not?: Condition
}

export interface TargetSpec {
  side: 'self' | 'friendly' | 'enemy' | 'any'
  keyword?: Keyword
  notKeywords?: Keyword[]
  visible?: boolean
  withinInches?: Inches
  notSelf?: boolean
  count?: number
}

export interface WeaponFilter {
  weaponIds?: Id[]
  weaponType?: WeaponType
  nameContains?: string
  hasRule?: Id
}

/** One rule on a weapon profile. Which parameter is required is defined by the WeaponRuleData record. */
export interface WeaponRuleUse {
  rule: Id
  x?: number
  inches?: Inches
  target?: RollTarget
  crits?: boolean
  only?: 'dash' | 'reposition'
}

export interface Effect {
  modifyStat?: { stat: 'move' | 'hit' | 'atk'; value: number; cap?: number; filter?: WeaponFilter }
  grantWeaponRule?: WeaponRuleUse & { filter?: WeaponFilter }
  removeWeaponRule?: { rule: Id; filter?: WeaponFilter }
  reroll?: { dice: 'attack' | 'defence' | 'own'; which: 'one' | 'any' | 'result'; result?: number }
  ignoreDamage?: { kind: 'normal' | 'crit' | 'all'; once?: boolean }
  retainSuccess?: {
    kind: 'normal' | 'crit'
    count: number
    from?: 'fail' | 'normal'
    discardFails?: number
    withoutRolling?: boolean
  }
  extraAction?: { action: ActionId; count: number; free?: boolean; mustDiffer?: boolean }
  costDelta?: { actions: ActionId[]; delta: number }
  ployCost?: { ploy: Id; cost: number; when?: Condition }
  cp?: number
  vp?: number
  move?: { kind: 'dash' | 'reposition' | 'fall-back' | 'charge'; inches?: Inches; free?: boolean }
  setOrder?: Order
  apl?: { delta: number; until: Duration }
  damage?: { amount?: number; dice?: DiceExpr; target?: 'self' | 'opponent' | 'target' }
  /** Escape hatch: a hook registered in src/engine/code-hooks.ts. */
  code?: CodeName
  params?: Record<string, unknown>
  duration?: Duration
  trigger?: { window: WindowSet; when?: Condition }
  scope?: TargetSpec
}
export type EffectList = Effect | Effect[]

// ------------------------------------------------------------------- weapons
export type WeaponRuleParam = 'none' | 'inches' | 'count' | 'target'

export interface WeaponRuleData {
  id: Id
  name: string
  param: WeaponRuleParam
  critsVariant?: boolean
  distanceVariant?: boolean
  moveRestriction?: boolean
  ref?: string
  text: string
  source: Source
}

export interface WeaponData {
  id: Id
  name: string
  profile?: string
  team?: Id
  type: WeaponType
  atk: number
  hit: RollTarget
  dmg: { normal: number; crit: number }
  rules: WeaponRuleUse[]
  profileGroup?: Id
  text?: string
  code?: CodeName
  source: Source
}

// ------------------------------------------------------- abilities and ploys
export type AbilityKind = 'ability' | 'uniqueAction' | 'weaponRule' | 'factionRule' | 'archetype'

export interface AbilityData {
  id: Id
  kind: AbilityKind
  name: string
  team?: Id
  ap?: number
  keywords?: Keyword[]
  conditions?: Condition
  target?: TargetSpec
  window?: WindowSet
  when?: Condition
  effect?: EffectList
  limit?: Limit
  scope?: TargetSpec
  choiceGroup?: Slug
  weaponRule?: { param: WeaponRuleParam; critsVariant?: boolean; distanceVariant?: boolean; moveRestriction?: boolean }
  text: string
  source: Source
}

export interface PloyData {
  id: Id
  name: string
  team?: Id
  type: 'strategy' | 'firefight'
  cost: number
  window: WindowSet
  when?: Condition
  effect: EffectList
  limit?: Limit
  text: string
  source: Source
}

// ----------------------------------------------------------------- equipment
export type ClearanceFrom = 'otherMarkers' | 'accessPoints' | 'accessibleTerrain' | 'equipmentTerrain' | 'doors'

export interface EquipmentData {
  id: Id
  name: string
  scope: 'universal' | 'faction'
  team?: Id
  count: number
  enabled?: boolean
  /** M9 prep: the opponent cannot see its markers until they trigger (as Mines) */
  hidden?: boolean
  /** M9 prep: equipment ids this option cannot be taken with */
  excludes?: Id[]
  setup?: {
    type: 'marker' | 'terrain'
    markerMm?: number
    whollyWithinTerritory?: boolean
    withinDropZoneInches?: Inches
    onFloor?: boolean
    uprightAgainstMinHeight?: Inches
    /** M10 batch D shared: `except` lists markers the clearance ignores (equipment id, marker kind or marker id) */
    clearances?: { from: ClearanceFrom[]; moreThan: Inches; except?: string[] }[]
  }
  terrain?: { model?: Slug; traits?: TerrainTrait[]; tags?: Slug[]; height?: Inches }
  choice?: { pick: number; from: Id[]; repeatable?: boolean }
  grants?: { weapons?: Id[]; abilities?: Id[]; actions?: Id[]; to?: { keyword?: Keyword; notKeywords?: Keyword[] } }
  actions?: Id[]
  limits?: { uses: number; per: 'battle' | 'turningPoint'; scope?: 'team' | 'operative' }
  window?: WindowSet
  when?: Condition
  effect?: EffectList
  text: string
  source: Source
}

// ------------------------------------------------------------------ datacards
export interface LoadoutSlot {
  id: Slug
  label?: string
  /** How many to choose from `from`; default 1. */
  pick?: number
  /** Minimum chosen; default equals pick. */
  min?: number
  /** Weapon profile ids or profileGroup ids. */
  from?: Id[]
  /** Mutually exclusive sets; the slot is answered with the chosen set id. */
  sets?: LoadoutSet[]
}
export interface LoadoutSet {
  id: Slug
  name: string
  fixed?: Id[]
  options?: LoadoutSlot[]
}

/** Answers keyed by slot id: the chosen weapon (or group) ids, or [setId] for a sets slot. Nested slots are keyed by their own ids. */
export type LoadoutChoice = Record<string, string[]>

export interface DatacardData {
  id: Id
  name: string
  team: Id
  stats: { apl: number; move: Inches; save: RollTarget; wounds: number }
  base: number
  /** M9 batch B: extra equipment options the team may take while this operative is on the roster (Hearthkyn Lugger) */
  extraEquipment?: number
  /** M9 batch B: oval base in mm (long axis along the facing), optionally only for loadouts with one of `weapons` */
  ovalBase?: { long: number; short: number; weapons?: Id[] }
  keywords: Keyword[]
  weapons: { fixed: Id[]; options?: LoadoutSlot[] }
  abilities: Id[]
  uniqueActions: Id[]
  figure: { archetype: string; variant?: Slug }
  expendable?: boolean
  nonOperativeForSelection?: boolean
  /** batch D prep: false = never on a roster; reached only by changing datacard mid-battle (transformOperative) */
  selectable?: boolean
  text: string
  source: Source
}

// ---------------------------------------------------------------------- teams
export interface SelectionSlot {
  id: Slug
  label?: string
  count: number
  from: Id[]
  repeatable?: Id[]
  halfSelections?: Id[]
  /** M9 prep: datacard id -> selections it counts as (2 for the MB3 Recon Drone and Wyrmblade cult agents) */
  weights?: Record<Id, number>
  /** M9 prep: at most `max` operatives from `from` together */
  caps?: { label?: string; from: Id[]; max: number }[]
}
/**
 * M9 batch B: at most `max` operatives (over every slot) that have `keyword` or are one of `from`. M9 batch C: or at
 * least `min` of them (Warpcoven: at least one SORCERER); give `max`, `min` or both.
 */
export interface TeamCap {
  label?: string
  keyword?: Keyword
  from?: Id[]
  max?: number
  min?: number
}
/** M9 batch C: the roster may include `id` only if it also includes one of `needs` (a GHEISTSKULL needs a VOID-JAMMER). */
export interface RosterRequirement {
  label?: string
  id: Id
  needs: Id[]
}
/**
 * M9 batch B: at most `max` operatives of the roster carry any of `weapons` (profile or profileGroup ids), or, with
 * `each`, at most `max` carry each one of them. Fixed weapons count too.
 */
export interface LoadoutCap {
  label?: string
  weapons: Id[]
  max: number
  each?: boolean
}
export interface TeamChoice {
  id: Slug
  label: string
  group: Slug
  distinctFrom?: Slug[]
}
/**
 * M9 batch B: a keyword each operative of the team takes at selection (Legionaries Marks of Chaos). `forKeyword`
 * limits it to operatives with that keyword; `exclude` bars some keywords for some datacards.
 */
export interface OperativeChoice {
  id: Slug
  label: string
  keywords: Keyword[]
  forKeyword?: Keyword
  exclude?: { datacards: Id[]; keywords: Keyword[] }[]
  /** M9 batch C: no two operatives of the roster take the same pick (Boons of Tzeentch) */
  unique?: boolean
  /** M9 batch C: the pick must differ from the same operative's picks for these choices (Custom: two different rules) */
  distinctFrom?: Slug[]
  /** M9 batch C: false makes the pick a tag for team code instead of a keyword (hasKeyword ignores it); default true */
  keyword?: boolean
  /** batch C shared: display label per pick, keyed by keyword (labels may hold "+" and lower case; keywords may not) */
  labels?: Record<Keyword, string>
}
export interface TeamData {
  id: Id
  name: string
  factionKeyword: Keyword
  archetypes: Slug[]
  selection: {
    slots: SelectionSlot[]
    /** M9 batch B: caps counted over every slot (at most five SICARIAN operatives, the leader included) */
    caps?: TeamCap[]
    /** M9 batch B: caps on chosen weapons across the whole roster (one arc rifle, one plasma caliver, one arquebus) */
    loadoutCaps?: LoadoutCap[]
    /** M9 batch C: datacards that need another datacard on the roster (Gheistskull needs Void-Jammer) */
    requires?: RosterRequirement[]
  }
  teamChoices?: TeamChoice[]
  /** M9 batch B: per-operative keyword picks made at selection (Marks of Chaos) */
  operativeChoices?: OperativeChoice[]
  factionRules: Id[]
  ploys: Id[]
  equipment: Id[]
  /** false while the team is scaffolded: validated and loaded, but left out of the picker, sims and bench */
  playable?: boolean
  /** default roster (datacard ids, first legal loadout each), equipment and team picks for realSetup */
  defaults?: {
    roster?: Id[]
    equipment?: Id[]
    teamChoices?: Record<Slug, Id>
    /** M9 batch B: operative choice picks per default roster entry (same order); missing picks take the first allowed keyword */
    operativePicks?: Record<Slug, Keyword>[]
    /** M9 batch B: loadout answers per default roster entry (same order) where the first legal loadout will not do (loadout caps) */
    loadouts?: Record<Slug, Id[]>[]
  }
  paint: { major: Hsl; minor: Hsl }
  text: string
  source: Source
}

/** Roster as picked by the team builder: datacard ids per selection slot (repeats allowed where the team allows). */
export type RosterSelection = Record<Slug, Id[]>

// ------------------------------------------------------------------- missions
export interface ScoringRule {
  id: Slug
  op: 'kill' | 'crit'
  window: WindowSet
  fromTurningPoint?: number
  metric: 'killGradeIncreased' | 'killGrade' | 'securedMarkers' | 'transmittingMarkersControlled' | 'lootPerformed'
  cmp: 'event' | 'gte' | 'gtEnemy'
  value?: number
  vp: number
  maxPerTurningPoint?: number
  capGroup?: Slug
  maxPerBattle?: number
  text: string
}

export interface ObjectiveConstraints {
  onCentreline?: boolean
  whollyWithinTerritory?: boolean
  differentTerritoryFromPrevious?: boolean
  withinCentrelineInches?: Inches
  minFromOtherMarkers?: Inches
  minFromNeutralEdges?: Inches
}

export interface MissionMap {
  id: Slug
  name: string
  mapRoll: { min: number; max: number }
  playerEdges: { A: Segment; B: Segment }
  dropZones: { A: Polygon; B: Polygon }
  territories: { A: Polygon; B: Polygon }
  centreline: Segment
  neutralEdges: Segment[]
  centrePoint: Vec2
}

export interface MissionData {
  id: Id
  name: string
  pack: Slug
  critOp: Slug
  critOpRoll: number
  turningPoints: number
  equipmentLimit: number
  killOp: { gradeTable: Record<string, number[]>; clamp: boolean }
  actions: Id[]
  scoring: ScoringRule[]
  objectiveSetup: {
    markerMm: number
    steps: { by: 'initiative' | 'other'; constraints: ObjectiveConstraints }[]
  }
  maps: MissionMap[]
  text: string
  source: Source
}

// ----------------------------------------------------------------- killzones
export interface TerrainPart {
  id: Slug
  /** Absolute killzone coordinates, inches. */
  footprint: Polygon
  height: number
  thickness?: number
  traits: TerrainTrait[]
  vantageFloors?: number[]
}
export interface TerrainPiece {
  id: Slug
  model: Slug
  pos: Vec2
  /** Degrees about +Y. */
  yaw: number
  parts: TerrainPart[]
}
export interface ObjectiveSpots {
  centre: Vec2[]
  territoryA: Vec2[]
  territoryB: Vec2[]
  default: { centre: Vec2; a: Vec2; b: Vec2 }
}
export interface KillzoneLayoutData {
  id: Id
  name: string
  size: { x: number; z: number }
  pieces: TerrainPiece[]
  maps: { id: Slug; objectiveSpots: ObjectiveSpots }[]
  text: string
  source: Source
}

// -------------------------------------------------------------------- bundle
export type DataRecord =
  | DatacardData
  | WeaponData
  | AbilityData
  | PloyData
  | EquipmentData
  | TeamData
  | WeaponRuleData
  | MissionData
  | KillzoneLayoutData

export interface DataBundle {
  /** Every record by id (datacards, weapons, abilities, ploys, equipment, teams, weapon rules, missions, layouts). */
  byId: Record<Id, DataRecord>
  teams: Record<Id, TeamData>
  missions: Record<Id, MissionData>
  layouts: Record<Id, KillzoneLayoutData>
  /** profileGroup id -> member weapon profile ids (additive helper for loadout resolution). */
  weaponGroups: Record<Id, Id[]>
  dataVersion: string
}
