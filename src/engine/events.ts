// Event union (00-architecture section 5). Frozen after M2. Every event carries the seq of the accepted action that
// caused it, the round and phase it happened in, and the seat it concerns.
import type { ActionCostType, CasketStateName, DecisionKind, DoorState, GameResult, Phase, Posture, Seat, TimingWindowId, Vec2, Vec3 } from './types'

export interface EventBase {
  seq: number
  round: number
  phase: Phase
  seat: Seat | null
}

export type MoveKind =
  | 'move'
  | 'charge'
  | 'takeCover'
  | 'crawl'
  | 'retreat'
  | 'consolidate'
  | 'carry'
  | 'runForCover'
  | 'knockback'
  | 'blaze'
  | 'doorPush'
  | 'duct'
  | 'pushedApart'
  | 'hurled'
  | 'pushed'
  | 'somersault'

export type DiceKind = 'd6' | 'd3' | '2d6' | 'firepower' | 'injury' | 'scatter'

export type RangeBand = 'short' | 'long'

export type GameEventBody =
  // game
  | { type: 'GameCreated'; seed: string; engineVersion: string }
  | { type: 'RoundStarted'; round: number }
  | { type: 'RoundEnded'; round: number }
  | { type: 'PhaseStarted'; name: Phase }
  | { type: 'PhaseEnded'; name: Phase }
  | { type: 'PriorityDecided'; holder: Seat; rolls: Record<Seat, number>; tieRule: boolean }
  | { type: 'GameEnded'; result: GameResult }
  // setup
  | { type: 'RoleChosen'; seat: Seat; choice: string }
  | { type: 'CrewCapRolled'; roll: number; cap: number }
  | { type: 'CrewChosen'; fighterIds: string[]; random: boolean }
  | { type: 'CasketPlaced'; casketId: string; pos: Vec2 }
  | { type: 'ZoneChosen'; zoneId: string }
  | { type: 'FighterDeployed'; fighterId: string; pos: Vec3; facing: number }
  // activation
  | { type: 'FightersReadied'; fighterIds: string[] }
  | { type: 'FighterActivated'; fighterId: string; group?: boolean; orderedBy?: string }
  | { type: 'GroupNominated'; leaderId: string; fighterIds: string[] }
  | { type: 'FighterTurned'; fighterId: string; from: number; to: number; free: boolean }
  | { type: 'ActionDeclared'; fighterId: string; action: string; actionType: ActionCostType }
  | { type: 'ActionResolved'; fighterId: string; action: string }
  | { type: 'ActionCancelled'; fighterId: string; action: string }
  | { type: 'ActivationEnded'; fighterId: string; actionsUsed: number }
  | { type: 'FighterFled'; fighterId: string; voluntary: boolean }
  // movement
  | { type: 'FighterMoved'; fighterId: string; kind: MoveKind; from: Vec3; to: Vec3; path: Vec2[]; length: number; maxInches: number }
  // status
  | { type: 'StatusChanged'; fighterId: string; from: Posture; to: Posture; reason: string }
  | { type: 'ConditionChanged'; fighterId: string; condition: string; on: boolean; reason: string }
  | { type: 'EngagementChanged'; fighterId: string; engagedWith: string[] }
  | { type: 'FleshWound'; fighterId: string; total: number; toughness: number }
  | { type: 'FighterOutOfAction'; fighterId: string; by: string | null; cause: string }
  // shooting
  | { type: 'ShootStarted'; fighterId: string; weaponId: string; profileId: string; mode: string }
  | {
      type: 'TargetDeclared'
      fighterId: string
      targetId?: string
      doorId?: string
      point?: Vec2
      distance: number
      band: RangeBand | null
      cover: 'none' | 'partial' | 'full'
      need: number | null
      modifiers: { label: string; value: number }[]
    }
  | { type: 'PriorityTest'; fighterId: string; roll: number; need: number; passed: boolean; redirectedTo?: string }
  | { type: 'HitRolled'; fighterId: string; targetId: string | null; dice: number[]; need: number; hit: boolean; improbable?: boolean }
  | { type: 'StrayShot'; fighterId: string; candidateId: string; roll: number; hit: boolean }
  | { type: 'BlastPlaced'; centre: Vec2; radius: number }
  | { type: 'BlastScattered'; from: Vec2; to: Vec2; distance: number; direction: number; misfire?: boolean }
  | { type: 'TemplatePlaced'; polygon: Vec2[] }
  | { type: 'FirepowerRolled'; fighterId: string; faces: string[]; hits: number; ammoSymbols: number }
  | { type: 'AmmoTest'; fighterId: string; weaponId: string; roll: number; need: number; passed: boolean; result: string }
  | { type: 'WeaponStateChanged'; fighterId: string; weaponId: string; ammo: string }
  | { type: 'FighterPinned'; fighterId: string }
  | { type: 'ShootEnded'; fighterId: string }
  // hits
  | { type: 'WoundRolled'; targetId: string; roll: number; need: number; wounded: boolean; auto?: boolean }
  | { type: 'SaveRolled'; targetId: string; roll: number; need: number; saved: boolean; item: string | null }
  | { type: 'DamageInflicted'; targetId: string; amount: number; wounds: number }
  | { type: 'InjuryRolled'; targetId: string; faces: string[]; applied: string }
  | { type: 'KnockedBack'; targetId: string }
  | { type: 'CaughtFire'; targetId: string }
  // fight
  | { type: 'FightStarted'; attackerId: string; targets: string[]; weapons: string[]; dice: number; charge: boolean }
  | { type: 'AttackDiceSplit'; attackerId: string; split: Record<string, number> }
  | { type: 'FightHitRolled'; weaponId: string; targetId: string; dice: number[]; need: number; modifiers: { label: string; value: number }[] }
  | { type: 'Parried'; by: string; rerolled: number[] }
  | { type: 'ReactionStarted'; fighterId: string }
  | { type: 'CoupDeGrace'; fighterId: string; targetId: string }
  | { type: 'Consolidated'; fighterId: string }
  // morale
  | { type: 'NerveTest'; fighterId: string; roll: number; need: number; passed: boolean }
  // the Initiative tests of Retreat / Running for Cover from combat and of the enemies reacting to them (additive, S3b)
  | { type: 'InitiativeTest'; fighterId: string; roll: number; need: number; passed: boolean; reason: string }
  | { type: 'RunningForCover'; fighterId: string }
  // skills and skill actions (additive, S4K-B): a skill took effect, and the characteristic tests it asks for
  | { type: 'SkillUsed'; fighterId: string; skill: string; targetId?: string; detail?: string; roll?: number; need?: number; passed?: boolean }
  | { type: 'SkillTest'; fighterId: string; test: 'Ld' | 'Wil' | 'S' | 'T' | 'I'; dice: number[]; need: number; passed: boolean; reason: string }
  | { type: 'BottleTest'; seat: Seat; roll: number; down: number; crew: number; bottled: boolean; voluntary: boolean; modifier?: number }
  | { type: 'FleeTest'; fighterId: string; roll: number; need: number; passed: boolean; auto?: string }
  | { type: 'RecoveryTest'; fighterId: string; faces: string[]; applied: string; assistedBy?: string }
  | { type: 'RallyTest'; fighterId: string; roll: number; need: number; passed: boolean }
  // board
  | { type: 'DoorChanged'; doorId: string; state: DoorState; locked: boolean }
  | { type: 'DoorDamaged'; doorId: string; wounds: number }
  | { type: 'TerminalAccessed'; fighterId: string; terminalId: string }
  | { type: 'DuctUsed'; fighterId: string; ductId: string }
  | { type: 'CasketOpened'; casketId: string; by: string; roll: number; result: CasketStateName | string }
  | { type: 'CasketMoved'; casketId: string; to: Vec2; carriedBy: string | null }
  | { type: 'SmokePlaced'; smokeId: string; pos: Vec2; radius: number }
  | { type: 'SmokeCleared'; smokeId: string }
  // scenario
  | { type: 'HorrorsInTheDark'; fighterId: string; roll: number; result: string }
  | { type: 'PointsScored'; seat: Seat; amount: number; reason: string }
  | { type: 'CasketSecured'; casketId: string; seat: Seat }
  | { type: 'ResultLocked'; winner: Seat; reason: string }
  // timed effects (additive, 00 section 11 row S1)
  | { type: 'EffectStarted'; effectId: string; source: string; kind: string }
  | { type: 'EffectEnded'; effectId: string; source: string }
  // dice: every physical roll; the tray renders `die`
  | { type: 'DiceRolled'; purpose: string; die: DiceKind; dice: number[]; faces?: string[]; final: boolean }
  // meta
  | { type: 'ActionRejected'; code: string; reason: string }
  | { type: 'DecisionRequested'; decisionId: string; kind: DecisionKind; window: TimingWindowId }

export type GameEvent = EventBase & GameEventBody
