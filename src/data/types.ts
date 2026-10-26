/**
 * Hand-written mirror of the six JSON Schemas in ./schema (docs/spec/20-data-schema.md).
 * Where this file and a schema disagree the schema wins; tests/data/schemas.test.ts feeds the same records to both.
 */

// ------------------------------------------------------------------ primitives (common.schema.json)
export type Id = string
export type Slug = string
export type Source = string
export type Text = string
/** Multiples of 0.25. */
export type Inches = number
/** "2+" .. "12+" */
export type Target = string
export type Stat = 'M' | 'WS' | 'BS' | 'S' | 'T' | 'W' | 'I' | 'A' | 'Ld' | 'Cl' | 'Wil' | 'Int'
/** "D3", "D6", "2D6", "D3+1" or an integer. */
export type DiceExpr = number | string
export interface Vec2 {
  x: number
  z: number
}
export interface Segment {
  a: Vec2
  b: Vec2
}
export type Polygon = Vec2[]
export type Seat = 'A' | 'B'
export interface Hsl {
  h: number
  s: number
  l: number
}
export type Role = 'leader' | 'champion' | 'ganger' | 'juve' | 'specialist' | 'prospect'
export type WeaponClass = 'pistol' | 'basic' | 'special' | 'heavy' | 'close' | 'grenade'
/** The four derived statuses of R-3 (Broken is a condition). */
export type Status = 'standingActive' | 'standingEngaged' | 'pronePinned' | 'proneSeriouslyInjured'
export type ActionType = 'simple' | 'basic' | 'double' | 'free'
export type Phase = 'priority' | 'action' | 'end'
/** Engine action key such as `move`, `takeCover`, `crawlDuct`. */
export type ActionKey = string
export type CodeName = string

export type TimingWindowId =
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
  | `setup.${string}`

export type Limit = 'oncePerActivation' | 'oncePerRound' | 'oncePerBattle' | 'unlimited'

export interface CodeRef {
  code: CodeName
  params?: Record<string, unknown>
}

export interface WeaponFilter {
  ids?: Id[]
  classes?: WeaponClass[]
  traits?: Id[]
}

export interface Condition {
  status?: Status
  action?: ActionKey
  repeatInActivation?: boolean
  charging?: boolean
  engaged?: boolean
  targetStatus?: Status
  inVisionArcOfTarget?: boolean
  weaponClass?: WeaponClass
  weaponTrait?: Id
  withinOfFriend?: { inches: Inches; role?: Role }
  role?: Role
  phase?: Phase
  roundAtLeast?: number
}

export type TestName = 'nerve' | 'cool' | 'willpower' | 'leadership' | 'intelligence' | 'initiative' | 'strength' | 'toughness'

export interface Effect {
  modifyStat?: { stat: Stat; value?: number; mult?: number }
  modifyTest?: { test: TestName; value: number }
  modifyHit?: { kind: 'shoot' | 'fight'; value: number }
  modifyWound?: { value: number }
  modifySave?: { value: number }
  extraAttackDice?: { value: number }
  grantTrait?: { trait: Id; x?: number; weapons?: WeaponFilter }
  grantAction?: { action: ActionKey }
  actionType?: { action: ActionKey; type: ActionType }
  reroll?: { roll: 'hit' | 'wound' | 'save' | 'injury' | 'test' | 'charge'; which: 'one' | 'fails' | 'all'; grant: true }
  ignore?: { what: CodeName }
  injuryDice?: { delta: number }
  code?: CodeRef
}
export type EffectList = Effect | Effect[]

export interface SkillAction {
  id: ActionKey
  type: ActionType
  statuses: Status[]
  requires?: ActionKey[]
}

// ------------------------------------------------------------------ core (core.schema.json)
export type ActionRequirement =
  | 'broken'
  | 'notBroken'
  | 'rangedWeapon'
  | 'outOfAmmoWeapon'
  | 'nearDoor'
  | 'nearLockedDoor'
  | 'nearTerminal'
  | 'nearDuct'
  | 'enemyNearDuctExit'
  | 'nearCasket'
  | 'seriouslyInjuredEnemyNear'
  | 'enemyInVisionArc'

export interface ActionData {
  id: Id
  key: ActionKey
  name: string
  cost: ActionType
  statuses: Status[]
  requires: ActionRequirement[]
  text: Text
  source: Source
}

export type InjuryResult = 'fleshWound' | 'seriouslyInjured' | 'outOfAction'
export interface DiceData {
  id: Id
  d3: { faces: number[] }
  firepower: { faces: { face: number; hits: number; ammo: boolean }[] }
  injury: { faces: { face: number; result: InjuryResult }[] }
  scatter: { faces: { face: number; kind: 'arrow' | 'hit' }[]; distance: DiceExpr }
  source: Source
}

export type CasketResult = 'fragTrap' | 'nothing' | 'ammoCache'
export interface ConstantsData {
  id: Id
  radii: {
    nerve: Inches
    nerveSupport: Inches
    groupActivation: Inches
    leadingByExampleLeader: Inches
    leadingByExampleChampion: Inches
    assist: Inches
    rally: Inches
    rallySupport: Inches
    interact: Inches
    oneInchRule: Inches
    rapidFireExtraHit: Inches
  }
  retreat: { moveDice: DiceExpr; brokenMoveDice: DiceExpr }
  runForCover: { moveDice: DiceExpr; proneMoveFraction: number; clearOfEnemies: Inches }
  strayShot: { radius: Inches; hitOnAtMost: number }
  hitModifiers: {
    partialCover: number
    fullCover: number
    targetEngaged: number
    targetProneAtLong: number
    aim: number
    blastAtPoint: number
    blindFire: number
    twinSidearm: number
    assist: number
    interference: number
    turnedToFace: number
    chargeWithoutSight: number
    brokenReaction: number
    ductway: Target
  }
  coverSave: { partial: number; full: number; noArmourSave: Target }
  closeDoor: { test: Stat; clearMove: Inches; strength: number; ap: number; damage: number }
  door: { toughness: number; wounds: number }
  forceDoor: { die: DiceExpr; stat: Stat; target: number; helperBonus: number }
  terminal: { stat: Stat; modifier: number }
  duct: { maxLength: Inches; hitOn: Target; templateRadius: Inches; exitRadius: Inches }
  casket: {
    smash: { die: DiceExpr; stat: Stat; target: number; contentsModifier: number }
    contents: { min: number; max: number; result: CasketResult }[]
    ammoCache: { radius: Inches; ammoBonus: number; exhaustedOn: number }
  }
  smoke: { radius: Inches; clearDie: DiceExpr; clearOnAtMost: number }
  blaze: {
    igniteOn: Target
    strength: number
    ap: number
    damage: number
    moveDice: DiceExpr
    extinguishTarget: number
    pinnedBonus: number
    friendBonus: number
    friendRadius: Inches
  }
  concussion: { initiativeModifier: number; worstInitiative: Target }
  knockback: { distance: Inches; blockedDamageBonus: number }
  unarmed: { strength: 'S'; ap: number; damage: number }
  obstacle: { height: Inches }
  template: { length: Inches; narrowWidth: number; wideWidth: number }
  loadout: { maxWeapons: number; unwieldySlots: number }
  statLimits: Record<Stat, { min: number; max: number }>
  crewCap: { min: number; max: number; cap: number }[]
  source: Source
}

export type TraitParam = 'none' | 'count' | 'inches' | 'target'
export interface TraitData {
  id: Id
  name: string
  param: TraitParam
  implemented: boolean
  text: Text
  source: Source
}

// ------------------------------------------------------------------ items (item.schema.json)
export interface TraitUse {
  trait: Id
  x?: number
  inches?: Inches
  target?: Target
}

export type WeaponLongRange = Inches | 'E' | 'T' | { strMultiplier: number }
export type WeaponFlavour = 'stub' | 'las' | 'bolter' | 'flamer' | 'plasma' | 'melta' | 'grenade' | 'chain' | 'blade' | 'maul' | 'whip' | 'crush'

export interface WeaponProfile {
  id: Slug
  name: string | null
  range: { short: Inches | null; long: WeaponLongRange }
  acc: { short: number | null; long: number | null }
  /** Integer, or "S" / "S+1" / "S-1" for the wielder's S. */
  str: number | string
  ap: number
  dmg: DiceExpr | '-'
  ammo: Target | '-'
  traits: TraitUse[]
}

export interface WeaponData {
  id: Id
  name: string
  class: WeaponClass
  cost: number
  rarity: string | null
  profiles: WeaponProfile[]
  flavour: WeaponFlavour
  text?: Text
  code?: CodeRef
  source: Source
}

export type WargearKind = 'armour' | 'fieldArmour' | 'equipment' | 'chem'
export interface WargearData {
  id: Id
  name: string
  kind: WargearKind
  cost: number
  save?: Target
  saveMods?: { vs: 'front' | 'template' | 'blast'; value: number }[]
  effect?: EffectList
  code?: CodeRef
  text: Text
  source: Source
}

// ------------------------------------------------------------------ gangs (gang.schema.json)
export interface RuleUse {
  rule: Id
  x?: number
}

export interface FighterTypeData {
  id: Id
  name: string
  house: Id
  role: Role
  cost: number
  stats: {
    M: number
    WS: Target
    BS: Target
    S: number
    T: number
    W: number
    I: Target
    A: number
    Ld: Target
    Cl: Target
    Wil: Target
    Int: Target
  }
  /** Base diameter in mm. */
  base: number
  rules: RuleUse[]
  skillAccess: { primary: Slug[]; secondary: Slug[] }
  equipmentList: Id
  limits?: { min?: number; max?: number }
  figure: { archetype: Slug; variant?: Slug }
  source: Source
}

export interface RoleCount {
  min?: number
  max?: number
}
export interface HouseData {
  id: Slug
  name: string
  prefix: Slug
  houseRules: Id[]
  fighterTypes: Id[]
  skillSets: Slug[]
  composition: {
    minFighters: number
    maxFighters?: number
    roles: Partial<Record<Role, RoleCount>>
    ratio?: { roles: Role[]; atLeastHalf: boolean }[]
  }
  paint: { major: Hsl; minor: Hsl }
  source: Source
}

export interface Priced {
  id: Id
  cost: number
}
export interface EquipmentListData {
  id: Id
  house: Id
  forTypes: Id[]
  weapons: Priced[]
  wargear: Priced[]
  source: Source
}

export interface StarterFighter {
  name: string
  type: Id
  weapons: Id[]
  wargear: Id[]
  skills: Id[]
}
export interface StarterGangData {
  id: Id
  house: Id
  name: string
  credits: number
  fighters: StarterFighter[]
  text: Text
  source: Source
}

export interface SkillData {
  id: Id
  name: string
  set: Slug
  window?: TimingWindowId
  when?: Condition
  effect?: EffectList
  limit?: Limit
  action?: SkillAction
  text: Text
  source: Source
}

export interface RuleData {
  id: Id
  name: string
  kind: 'houseRule' | 'fighterRule'
  window?: TimingWindowId
  when?: Condition
  effect?: EffectList
  limit?: Limit
  action?: SkillAction
  text: Text
  source: Source
}

// ------------------------------------------------------------------ Zone Mortalis (zm.schema.json)
export interface WallData {
  id: Slug
  a: Vec2
  b: Vec2
  thickness: number
}
export interface DoorData {
  id: Slug
  a: Vec2
  b: Vec2
  locked: boolean
}
export interface TerminalData {
  id: Slug
  door: Slug
  pos: Vec2
}
export interface DuctData {
  id: Slug
  a: Vec2
  b: Vec2
}
export interface ObstacleData {
  id: Slug
  kind: Slug
  footprint: Polygon
}
export interface PropData {
  model: Slug
  pos: Vec2
  yaw: number
}

export interface TileData {
  id: Id
  name: string
  walls: WallData[]
  doors: DoorData[]
  terminals: TerminalData[]
  ducts: DuctData[]
  obstacles: ObstacleData[]
  casketSpots: Vec2[]
  floor: { style: 'grate' | 'plate' | 'hazard'; props: PropData[] }
  source: Source
}

export type BoardLayout = '2x3' | 'brick7'
export interface BoardData {
  id: Id
  name: string
  layout: BoardLayout
  tiles: { tile: Id; at: Vec2; rot: 0 | 90 | 180 | 270 }[]
  extra: {
    walls: WallData[]
    doors: DoorData[]
    terminals: TerminalData[]
    ducts: DuctData[]
    obstacles: ObstacleData[]
    caskets: Vec2[]
  }
  scenarios: Id[]
  source: Source
}

// ------------------------------------------------------------------ scenario (scenario.schema.json)
export interface CrewMethod {
  method: 'custom' | 'random' | 'hybrid'
  x: number
  y?: DiceExpr
}
export type ScenarioPoints = number | string | { byRole: Partial<Record<Role, number>> }
export interface ScenarioData {
  id: Id
  name: string
  layouts: BoardLayout[]
  roles: boolean
  crews: { attacker?: CrewMethod; defender?: CrewMethod; both?: CrewMethod }
  crewCap: { min: number; max: number; cap: number }[] | null
  deployment: {
    kind: 'standard' | 'tile'
    minFromCentreline?: Inches
    defenderFirst?: boolean
    withinOfEdge?: Inches
    enemyClearance?: Inches
  }
  caskets?: {
    count: number
    placer?: 'attacker' | 'defender' | 'alternate' | 'board'
    region: 'ownHalf' | 'centreTileFirst' | 'anyTile'
    minFromEdge: Inches
    minApart: Inches
    openBy?: 'attacker' | 'defender' | 'either'
    contents: Id | CodeRef
  }
  scoring: {
    on: 'fighterOutOfAction' | 'fighterFled' | 'casketOpened' | 'casketSecured' | 'lastGangStanding'
    seat?: 'attacker' | 'defender' | 'A' | 'B'
    points?: ScenarioPoints
    count?: boolean
  }[]
  victory: { by: 'points' | 'caskets' } | CodeRef
  special: CodeRef[]
  text: Text
  source: Source
}

// ------------------------------------------------------------------ files and bundle
export type SchemaName = 'core' | 'item' | 'gang' | 'zm' | 'scenario'

/** Record kinds; each is the `$defs` name a data file validates against. */
export type RecordType =
  | 'action'
  | 'dice'
  | 'constants'
  | 'trait'
  | 'weapon'
  | 'wargear'
  | 'house'
  | 'fighterType'
  | 'equipmentList'
  | 'starterGang'
  | 'skill'
  | 'rule'
  | 'tile'
  | 'board'
  | 'scenario'

export type DataRecord =
  | ActionData
  | DiceData
  | ConstantsData
  | TraitData
  | WeaponData
  | WargearData
  | HouseData
  | FighterTypeData
  | EquipmentListData
  | StarterGangData
  | SkillData
  | RuleData
  | TileData
  | BoardData
  | ScenarioData

/** One data file as listed by an area index: where it is, which schema def it validates against, and its parsed content. */
export interface DataFile {
  /** Relative to src/data, forward slashes. */
  path: string
  schema: SchemaName
  def: RecordType
  /** true: the file holds an array of records; false: a single record. */
  array: boolean
  data: unknown
}

export interface DataBundle {
  /** Every record of every file by id. */
  byId: Record<Id, DataRecord>
  actions: Record<Id, ActionData>
  traits: Record<Id, TraitData>
  weapons: Record<Id, WeaponData>
  wargear: Record<Id, WargearData>
  skills: Record<Id, SkillData>
  rules: Record<Id, RuleData>
  houses: Record<Id, HouseData>
  fighterTypes: Record<Id, FighterTypeData>
  equipmentLists: Record<Id, EquipmentListData>
  starterGangs: Record<Id, StarterGangData>
  tiles: Record<Id, TileData>
  boards: Record<Id, BoardData>
  scenarios: Record<Id, ScenarioData>
  dice: DiceData
  constants: ConstantsData
  dataVersion: string
}
