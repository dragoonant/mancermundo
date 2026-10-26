/**
 * TypeScript mirror of docs/spec/schemas/*.schema.json (copied to src/data/schema/).
 * Hand-maintained: tests/data/schemas.test.ts and tools/validate-data.ts keep the
 * JSON in step with the schemas; any schema change must change this file in the same commit.
 */

// ---------------------------------------------------------------- primitives
/** Lowercase kebab, dot-namespaced: aod.intercessor-sergeant, core.wr.piercing, kz.volkus-01. */
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
  modifyStat?: { stat: 'apl' | 'move' | 'save' | 'wounds' | 'hit' | 'atk'; value: number; cap?: number; filter?: WeaponFilter }
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
  setup?: {
    type: 'marker' | 'terrain'
    markerMm?: number
    whollyWithinTerritory?: boolean
    withinDropZoneInches?: Inches
    onFloor?: boolean
    uprightAgainstMinHeight?: Inches
    clearances?: { from: ClearanceFrom[]; moreThan: Inches }[]
  }
  terrain?: { model?: Slug; traits?: TerrainTrait[]; tags?: Slug[]; height?: Inches }
  choice?: { pick: number; from: Id[]; repeatable?: boolean }
  grants?: { weapons?: Id[]; abilities?: Id[]; actions?: Id[] }
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
  keywords: Keyword[]
  weapons: { fixed: Id[]; options?: LoadoutSlot[] }
  abilities: Id[]
  uniqueActions: Id[]
  figure: { archetype: string; variant?: Slug }
  expendable?: boolean
  nonOperativeForSelection?: boolean
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
}
export interface TeamChoice {
  id: Slug
  label: string
  group: Slug
  distinctFrom?: Slug[]
}
export interface TeamData {
  id: Id
  name: string
  factionKeyword: Keyword
  archetypes: Slug[]
  selection: { slots: SelectionSlot[] }
  teamChoices?: TeamChoice[]
  factionRules: Id[]
  ploys: Id[]
  equipment: Id[]
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
