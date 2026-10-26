// Event union (frozen after M2). Every event carries the seq of the accepted action that caused it.
import type { DecisionKind, GameResult, Order, Phase, Seat, TimingWindowId, Vec3 } from './types'

export interface EventBase {
  seq: number
  turningPoint: number
  phase: Phase
  seat: Seat | null
}

export interface MoveSegmentEvent {
  from: Vec3
  to: Vec3
  /** straight-line horizontal length */
  length: number
  /** movement spent by this increment (rounded up, plus Accessible surcharges) */
  cost: number
  kind: 'walk' | 'climb' | 'drop' | 'jump'
}

export type GameEventBody =
  // game
  | { type: 'GameCreated'; seed: string; engineVersion: string }
  | { type: 'TurningPointStarted'; number: number }
  | { type: 'TurningPointEnded'; number: number }
  | { type: 'PhaseStarted'; name: Phase }
  | { type: 'PhaseEnded'; name: Phase }
  | { type: 'InitiativeDecided'; holder: Seat; setup: boolean }
  | { type: 'GameEnded'; result: GameResult }
  // setup (additive)
  | { type: 'DropZoneChosen'; zoneId: string }
  | { type: 'OperativeDeployed'; operativeId: string; pos: Vec3 }
  // strategy
  | { type: 'CpChanged'; delta: number; cp: number; reason: string }
  | { type: 'GambitUsed'; gambitId: string }
  | { type: 'GambitPassed' }
  | { type: 'PloyUsed'; ployId: string }
  | { type: 'OperativesReadied'; operativeIds: string[] }
  // activation
  | { type: 'OperativeActivated'; operativeId: string }
  | { type: 'OrderSet'; operativeId: string; order: Order }
  | { type: 'ActionDeclared'; operativeId: string; action: string; cost: number }
  | { type: 'ActionResolved'; operativeId: string; action: string }
  | { type: 'ActionCancelled'; operativeId: string; action: string }
  | { type: 'ApSpent'; operativeId: string; amount: number; total: number }
  | { type: 'OperativeExpended'; operativeId: string }
  | { type: 'Counteracted'; operativeId: string }
  | { type: 'CounteractSkipped' }
  | { type: 'GuardSet'; operativeId: string }
  | { type: 'GuardCleared'; operativeId: string; reason: string }
  | { type: 'GuardInterrupt'; operativeId: string }
  // movement
  | {
      type: 'OperativeMoved'
      operativeId: string
      action: string
      from: Vec3
      to: Vec3
      segments: MoveSegmentEvent[]
      cost: number
      maxInches: number
    }
  // shooting and fighting (M2b-attack)
  | { type: 'ShootStarted'; operativeId: string; weaponId: string }
  | {
      type: 'TargetSelected'
      operativeId: string
      targetId: string
      weaponId: string
      secondary: boolean
      distance: number
      inCover: boolean
      obscured: boolean
      improvedCover: boolean
    }
  | {
      type: 'AttackDiceRolled'
      operativeId: string
      targetId: string
      weaponId: string | null
      /** physical results; null for dice retained without rolling (Accurate) */
      dice: (number | null)[]
      kinds: ('fail' | 'normal' | 'crit')[]
      need: number
      lethal: number | null
    }
  | { type: 'DiceRerolled'; side: 'attack' | 'defence'; operativeId: string; source: string; indexes: number[]; before: (number | null)[]; after: number[] }
  | { type: 'AttackRetained'; operativeId: string; targetId: string; normal: number; crit: number; obscured: boolean; converted: string[] }
  | { type: 'CoverSaveRetained'; targetId: string; normal: number; crit: number }
  | { type: 'DefenceDiceRolled'; targetId: string; collected: number; dice: (number | null)[]; kinds: ('fail' | 'normal' | 'crit')[]; need: number }
  | { type: 'DiceBlocked'; targetId: string; blockedNormal: number; blockedCrit: number; unblockedNormal: number; unblockedCrit: number }
  | { type: 'DamageInflicted'; operativeId: string; sourceId: string; amount: number; source: string; wounds: number }
  | { type: 'FightStarted'; operativeId: string; targetId: string; attackerWeapon: string | null; defenderWeapon: string | null }
  | { type: 'Struck'; operativeId: string; targetId: string; die: 'normal' | 'crit'; amount: number }
  | { type: 'Blocked'; operativeId: string; die: 'normal' | 'crit'; against: 'normal' | 'crit' | null }
  | { type: 'ShockDiscard'; operativeId: string; discarded: 'normal' | 'crit' }
  | { type: 'ChoiceMade'; seat: Seat; choice: string; option: string }
  | { type: 'AplModified'; operativeId: string; delta: number; reason: string }
  | { type: 'WeaponLimited'; operativeId: string; weaponId: string; uses: number }
  | { type: 'OperativeInjured'; operativeId: string }
  | { type: 'OperativeIncapacitated'; operativeId: string }
  | { type: 'OperativeRemoved'; operativeId: string }
  | { type: 'ShootEnded'; operativeId: string; weaponId: string | null }
  | { type: 'FightEnded'; operativeId: string; targetId: string }
  // markers
  | { type: 'ControlChanged'; markerId: string; controller: Seat | null }
  // M2b-game: markers, mission, equipment, abilities
  | { type: 'MarkerPickedUp'; markerId: string; operativeId: string }
  | { type: 'MarkerPlaced'; markerId: string; operativeId: string | null; pos: { x: number; z: number } }
  | { type: 'MarkerRemoved'; markerId: string; reason: string }
  | { type: 'ObjectivePlaced'; markerId: string; pos: { x: number; z: number } }
  | { type: 'EquipmentPlaced'; equipmentId: string; key: string; pos: { x: number; z: number }; yaw: number; hidden: boolean }
  | { type: 'EquipmentSkipped'; equipmentId: string; key: string }
  | { type: 'MissionChosen'; missionId: string; mapId: string }
  | { type: 'MissionActionPerformed'; operativeId: string; action: string; markerId: string }
  | { type: 'KillGradeChanged'; grade: number; kills: number }
  | { type: 'VpScored'; amount: number; vp: number; ruleId: string }
  | { type: 'MineTriggered'; markerId: string; operativeId: string; damage: number }
  | { type: 'AbilityUsed'; operativeId: string | null; abilityId: string; detail?: string }
  | { type: 'ConfigChanged'; key: string; value: string | null }
  | { type: 'EffectStarted'; effectId: string; source: string; kind: string }
  | { type: 'EffectEnded'; effectId: string; source: string }
  // dice
  | { type: 'DiceRolled'; purpose: string; dice: number[]; final: boolean }
  // meta
  | { type: 'ActionRejected'; code: string; reason: string }
  | { type: 'DecisionRequested'; decisionId: string; kind: DecisionKind; window: TimingWindowId }

export type GameEvent = EventBase & GameEventBody
