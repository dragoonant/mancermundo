// Maps engine events to sounds from public/audio. Pure (no AudioManager, no DOM) so it is unit-testable;
// `playEventSounds` is the only function that touches the manager. Weapon sounds are chosen per weapon id
// (explicit table, then the weapon flavour as a safety net), deaths by the dying operative's team, and the
// narrator speaks on the big moments only (phase, turning point, initiative, operative down, objective
// secured, counteract, final turning point, result).
import type { GameEvent, GameState, Seat } from '@/engine'
import { flavourOf, type WeaponFlavour } from '../weaponFlavour'
import type { PlayOptions } from './manager'
import type { SoundId } from './ids'
import { teamTable } from '../teams'

export interface EventSound {
  id: SoundId
  opts?: PlayOptions
}

/** What the mapper needs besides the event itself. */
export interface SoundContext {
  /** state after the step that produced the event (team and keyword lookups) */
  state: GameState | null
  /** the seat whose point of view victory / defeat is told from */
  perspective: Seat | null
  /** 'shoot' while a Shoot sequence plays, 'fight' during a Fight; the same dice events serve both */
  mode: 'shoot' | 'fight' | null
  /** weapons of the fight in progress, for the strike sounds */
  fight: { attackerId: string; attackerWeapon: string | null; defenderId: string; defenderWeapon: string | null } | null
}

export const EMPTY_CONTEXT: SoundContext = { state: null, perspective: null, mode: null, fight: null }

// ---------------------------------------------------------------- weapons

interface WeaponSfx {
  id: SoundId
  volume?: number
}

/** Every weapon id in both teams and the core list -> its mp3. tests/client/eventSounds.test.ts checks coverage. */
export const WEAPON_SOUND: Record<string, WeaponSfx> = {
  // Angels of Death
  'aod.w.hand-flamer': { id: 'wpn-hand-flamer' },
  'aod.w.heavy-bolt-pistol': { id: 'wpn-heavy-bolt-pistol' },
  'aod.w.plasma-pistol-standard': { id: 'wpn-plasma-pistol' },
  'aod.w.plasma-pistol-supercharge': { id: 'wpn-plasma-pistol-supercharge' },
  'aod.w.auto-bolt-rifle': { id: 'wpn-auto-bolt-rifle' },
  'aod.w.bolt-rifle': { id: 'wpn-bolt-rifle' },
  'aod.w.stalker-bolt-rifle-heavy': { id: 'wpn-stalker-bolt-rifle' },
  'aod.w.stalker-bolt-rifle-mobile': { id: 'wpn-stalker-bolt-rifle' },
  'aod.w.aux-grenade-launcher-frag': { id: 'wpn-grenade-frag' },
  'aod.w.aux-grenade-launcher-krak': { id: 'wpn-grenade-krak' },
  'aod.w.bolt-pistol': { id: 'wpn-bolt-pistol' },
  'aod.w.heavy-bolter-focused': { id: 'wpn-heavy-bolter' },
  'aod.w.heavy-bolter-sweeping': { id: 'wpn-heavy-bolter' },
  'aod.w.bolt-sniper-rifle-executioner': { id: 'wpn-bolt-sniper-rifle' },
  'aod.w.bolt-sniper-rifle-hyperfrag': { id: 'wpn-bolt-sniper-rifle' },
  'aod.w.bolt-sniper-rifle-mortis': { id: 'wpn-bolt-sniper-rifle' },
  'aod.w.chainsword-assault': { id: 'wpn-chainsword-rev' },
  'aod.w.chainsword-intercessor': { id: 'wpn-chainsword-rev' },
  'aod.w.power-fist-assault': { id: 'wpn-power-fist' },
  'aod.w.power-fist-captain': { id: 'wpn-power-fist' },
  'aod.w.power-fist-intercessor': { id: 'wpn-power-fist' },
  'aod.w.power-weapon-assault': { id: 'wpn-power-weapon' },
  'aod.w.power-weapon-intercessor': { id: 'wpn-power-weapon' },
  'aod.w.thunder-hammer-assault': { id: 'wpn-thunder-hammer' },
  'aod.w.thunder-hammer-intercessor': { id: 'wpn-thunder-hammer' },
  'aod.w.fists': { id: 'hit-flesh' },
  // Kommandos
  'kom.w.slugga': { id: 'wpn-slugga' },
  'kom.w.choppa': { id: 'wpn-choppa' },
  'kom.w.big-choppa': { id: 'wpn-big-choppa' },
  'kom.w.power-klaw': { id: 'wpn-power-klaw' },
  'kom.w.explosives': { id: 'wpn-explosives' },
  'kom.w.bite': { id: 'wpn-squig-bite' },
  'kom.w.breacha-ram': { id: 'wpn-breacha-ram' },
  'kom.w.burna-standard': { id: 'wpn-burna' },
  'kom.w.burna-deluge': { id: 'wpn-burna' },
  'kom.w.shokka-pistol': { id: 'wpn-shokka-pistol' },
  'kom.w.dakka-shoota-short': { id: 'wpn-dakka-shoota' },
  'kom.w.dakka-shoota-long': { id: 'wpn-dakka-shoota' },
  'kom.w.rokkit-launcha-aimed': { id: 'wpn-rokkit-launcha' },
  'kom.w.rokkit-launcha-mobile': { id: 'wpn-rokkit-launcha' },
  'kom.w.scoped-big-shoota-concealed': { id: 'wpn-scoped-big-shoota' },
  'kom.w.scoped-big-shoota-stationary': { id: 'wpn-scoped-big-shoota' },
  'kom.w.scoped-big-shoota-sweeping': { id: 'wpn-scoped-big-shoota' },
  'kom.w.throwing-knives': { id: 'wpn-throwing-knives' },
  'kom.w.twin-choppas': { id: 'wpn-twin-choppas' },
  'kom.w.grot-choppa': { id: 'wpn-grot-choppa' },
  'kom.w.fists': { id: 'hit-flesh' },
  'kom.w.choppas-equipment': { id: 'wpn-choppa' },
  'kom.w.dynamite': { id: 'wpn-dynamite' },
  'kom.w.harpoon': { id: 'wpn-harpoon' },
  // Core
  'core.w.frag-grenade': { id: 'wpn-grenade-frag' },
  'core.w.krak-grenade': { id: 'wpn-grenade-krak' },
}
// M9 prep: teams added later bring their own entries (src/client/teams)
Object.assign(WEAPON_SOUND, teamTable('sound'))

const FLAVOUR_FALLBACK: Record<WeaponFlavour, SoundId> = {
  bolter: 'wpn-bolt-rifle',
  slugga: 'wpn-slugga',
  flamer: 'wpn-hand-flamer',
  plasma: 'wpn-plasma-pistol',
  rokkit: 'wpn-rokkit-launcha',
  chain: 'wpn-chainsword-rev',
  crush: 'wpn-power-fist',
  blade: 'wpn-choppa',
  bite: 'wpn-squig-bite',
}

/** The sound of a weapon: the explicit table, else its flavour. Never undefined. */
export function weaponSound(weaponId: string): WeaponSfx {
  return WEAPON_SOUND[weaponId] ?? { id: FLAVOUR_FALLBACK[flavourOf(weaponId)] }
}

// ---------------------------------------------------------------- teams

export type Faction = 'marine' | 'ork' | 'grot' | 'squig' | 'drone' | 'tau' | 'necron' | 'plague' | 'cultist' | 'other'

/**
 * Datacard keyword -> faction, first match wins (so a specific lineage listed earlier beats a broader one). A team
 * joins by adding a row here and a profile below; nothing else in this file compares team ids.
 */
const FACTION_KEYWORDS: readonly (readonly [keyword: string, faction: Faction])[] = [
  ['BOMB SQUIG', 'squig'],
  ['SQUIG', 'squig'],
  ['GROT', 'grot'],
  ['ORK', 'ork'],
  ['DRONE', 'drone'],
  ["T'AU EMPIRE", 'tau'],
  ['PATHFINDER', 'tau'],
  ['NECRON', 'necron'],
  ['PLAGUE MARINE', 'plague'],
  ['HERETIC ASTARTES', 'plague'],
  ['WYRMBLADE', 'cultist'],
  ['GENESTEALER CULTS', 'cultist'],
  ['ADEPTUS ASTARTES', 'marine'],
]

/** Faction of an operative from its datacard keywords (no team ids are compared; keywords carry the lineage). */
export function factionOf(state: GameState | null, operativeId: string): Faction {
  const op = state?.operatives?.[operativeId]
  const kw = op ? (state?.data?.datacards?.[op.datacardId]?.keywords ?? []).map((k) => k.toUpperCase()) : []
  for (const [keyword, faction] of FACTION_KEYWORDS) if (kw.includes(keyword)) return faction
  return 'other'
}

interface FactionSounds {
  /** death sound; a function varies it by the event's sequence number */
  death: SoundId | ((seq: number) => SoundId)
  shout?: SoundId
  steps?: SoundId
  /** the narrator line naming this side as the initiative holder */
  initiative?: SoundId
}

const FACTION_SOUNDS: Record<Faction, FactionSounds> = {
  marine: { death: (seq) => (seq % 3 === 0 ? 'death-marine-classic' : 'death-marine'), shout: 'shout-marine', steps: 'move-marine-steps', initiative: 'narr-initiative-aod' },
  ork: { death: (seq) => (seq % 2 === 0 ? 'death-ork-roar' : 'death-ork'), shout: 'shout-ork', initiative: 'narr-initiative-kom' },
  grot: { death: 'death-grot', shout: 'shout-ork', initiative: 'narr-initiative-kom' },
  squig: { death: 'death-squig', initiative: 'narr-initiative-kom' },
  drone: { death: 'death-drone', initiative: 'narr-initiative-pf' },
  tau: { death: 'death-tau', initiative: 'narr-initiative-pf' },
  necron: { death: 'death-necron', initiative: 'narr-initiative-ht' },
  plague: { death: 'death-plague', initiative: 'narr-initiative-pm' },
  cultist: { death: 'death-cultist', shout: 'shout-brood-hiss', initiative: 'narr-initiative-wb' },
  other: { death: 'death-generic' },
}

export function deathSound(faction: Faction, seq: number): SoundId {
  const d = FACTION_SOUNDS[faction].death
  return typeof d === 'function' ? d(seq) : d
}

function shoutSound(faction: Faction): SoundId | null {
  return FACTION_SOUNDS[faction].shout ?? null
}

function stepsSound(faction: Faction): SoundId {
  return FACTION_SOUNDS[faction].steps ?? 'move-ork-boots'
}

/** The narrator line that names the side holding initiative, by that seat's team (derived from its operatives' lineage). */
function initiativeLine(state: GameState | null, holder: Seat): SoundId | null {
  if (!state) return null
  for (const op of Object.values(state.operatives ?? {})) {
    if (op.seat !== holder) continue
    const line = FACTION_SOUNDS[factionOf(state, op.id)].initiative
    if (line) return line
  }
  return null
}

// ---------------------------------------------------------------- team effects

/** Ploys that get a sound of their own on top of the ploy click (keyed by ploy id). */
const PLOY_SOUND: Record<string, SoundId> = {
  'pm.p.cloud-of-flies': 'fx-flies-swarm',
  'pm.p.contagion': 'fx-plague-bell',
}

/** Abilities and equipment that announce themselves with AbilityUsed (keyed by ability id). */
const ABILITY_SOUND: Record<string, SoundId> = {
  'pm.a.icon-of-contagion': 'fx-plague-bell',
  'pm.e.plague-bells': 'fx-plague-bell',
  'wyr.a.quicksilver-strike': 'shout-brood-hiss',
}

/** OperativeReturned by how it came back (the event's `kind`). */
const RETURN_SOUND: Record<string, SoundId> = {
  reanimated: 'fx-reanimate',
  emerge: 'fx-ambush-emerge',
}

/** Token kinds whose gain is heard (TokenChanged with a positive delta). */
const TOKEN_GAIN_SOUND: Record<string, SoundId> = {
  'pf.markerlight': 'ui-markerlight',
}

// ---------------------------------------------------------------- policy

/**
 * Every event type has a policy: 'sound' always maps to at least one sound, 'conditional' only for some payloads,
 * 'silent' is a deliberate silence (the sound belongs to a neighbouring event, or the event is bookkeeping).
 * Exhaustive over GameEvent['type']; tests/client/eventSounds.test.ts also checks it against events.ts.
 */
export const EVENT_POLICY: Record<GameEvent['type'], 'sound' | 'conditional' | 'silent'> = {
  GameCreated: 'silent',
  TurningPointStarted: 'sound',
  TurningPointEnded: 'silent',
  PhaseStarted: 'conditional',
  PhaseEnded: 'silent',
  InitiativeDecided: 'conditional',
  GameEnded: 'conditional',
  DropZoneChosen: 'silent',
  OperativeDeployed: 'sound',
  CpChanged: 'conditional',
  GambitUsed: 'sound',
  GambitPassed: 'silent',
  PloyUsed: 'sound',
  OperativesReadied: 'silent',
  OperativeActivated: 'silent',
  OrderSet: 'sound',
  ActionDeclared: 'silent',
  ActionResolved: 'silent',
  ActionCancelled: 'silent',
  ApSpent: 'sound',
  OperativeExpended: 'silent',
  Counteracted: 'sound',
  CounteractSkipped: 'silent',
  GuardSet: 'silent',
  GuardCleared: 'silent',
  GuardInterrupt: 'conditional',
  OperativeMoved: 'sound',
  ShootStarted: 'silent',
  TargetSelected: 'silent',
  AttackDiceRolled: 'conditional',
  DiceRerolled: 'sound',
  AttackRetained: 'silent',
  CoverSaveRetained: 'silent',
  DefenceDiceRolled: 'silent',
  DiceBlocked: 'conditional',
  DamageInflicted: 'sound',
  FightStarted: 'conditional',
  Struck: 'conditional',
  Blocked: 'sound',
  ShockDiscard: 'silent',
  ChoiceMade: 'silent',
  AplModified: 'silent',
  WeaponLimited: 'silent',
  OperativeInjured: 'silent',
  OperativeIncapacitated: 'sound',
  OperativeRemoved: 'silent',
  ShootEnded: 'silent',
  FightEnded: 'silent',
  ControlChanged: 'silent',
  MarkerPickedUp: 'sound',
  MarkerPlaced: 'sound',
  MarkerRemoved: 'silent',
  ObjectivePlaced: 'sound',
  EquipmentPlaced: 'sound',
  EquipmentSkipped: 'silent',
  MissionChosen: 'silent',
  MissionActionPerformed: 'sound',
  KillGradeChanged: 'sound',
  VpScored: 'conditional',
  MineTriggered: 'sound',
  AbilityUsed: 'conditional',
  ConfigChanged: 'silent',
  EffectStarted: 'silent',
  EffectEnded: 'silent',
  // M9 prep: generic team capabilities (bookkeeping until a team gives them a sound)
  TokenChanged: 'conditional',
  WoundsRegained: 'silent',
  OperativeSetAside: 'silent',
  OperativePickChanged: 'silent',
  OperativeTransformed: 'sound',
  PoolChanged: 'silent',
  OperativeReturned: 'conditional',
  ActivationChained: 'silent',
  ActivationGated: 'silent',
  DiceRolled: 'sound',
  ActionRejected: 'silent',
  DecisionRequested: 'silent',
}

/** Sounds for one engine event. */
export function soundsForEvent(ev: GameEvent, ctx: SoundContext = EMPTY_CONTEXT): EventSound[] {
  const s = ctx.state
  switch (ev.type) {
    case 'TurningPointStarted': {
      const out: EventSound[] = [{ id: 'ui-turning-point-sting', opts: { volume: 0.8 } }]
      if (ev.number === 1) out.push({ id: 'narr-turning-point-one', opts: { delayMs: 700 } })
      else if (ev.number >= 4) out.push({ id: 'narr-final-turning-point', opts: { delayMs: 700 } })
      return out
    }
    case 'PhaseStarted':
      if (ev.name === 'strategy') return [{ id: 'narr-strategy-phase' }]
      if (ev.name === 'firefight') return [{ id: 'narr-firefight-phase' }]
      return []
    case 'InitiativeDecided': {
      if (ev.setup) return []
      const line = initiativeLine(s, ev.holder)
      return [{ id: 'ui-initiative-won', opts: { volume: 0.7 } }, ...(line ? [{ id: line, opts: { delayMs: 900 } }] : [])]
    }
    case 'GameEnded': {
      const win = ev.result.winner
      if (win === 'draw') return [{ id: 'narr-draw', opts: { delayMs: 500 } }]
      const me = ctx.perspective ?? 'A'
      return win === me
        ? [{ id: 'ui-victory-sting' }, { id: 'narr-victory', opts: { delayMs: 900 } }]
        : [{ id: 'ui-defeat-sting' }, { id: 'narr-defeat', opts: { delayMs: 900 } }]
    }
    case 'OperativeDeployed':
      return [{ id: 'ui-ap-spend', opts: { volume: 0.7 } }]
    case 'CpChanged':
      return ev.delta > 0 ? [{ id: 'ui-cp-gained' }] : ev.delta < 0 ? [{ id: 'ui-ap-spend', opts: { volume: 0.8 } }] : []
    case 'GambitUsed':
      return [{ id: 'ui-order-engage', opts: { volume: 0.8 } }]
    case 'PloyUsed': {
      const fx = PLOY_SOUND[ev.ployId]
      return [{ id: 'ui-order-engage', opts: { volume: 0.8 } }, ...(fx ? [{ id: fx, opts: { delayMs: 150 } }] : [])]
    }
    case 'AbilityUsed': {
      const fx = ABILITY_SOUND[ev.abilityId]
      return fx ? [{ id: fx, opts: { volume: 0.85 } }] : []
    }
    case 'OperativeReturned': {
      const fx = RETURN_SOUND[ev.kind]
      return fx ? [{ id: fx }] : []
    }
    case 'TokenChanged': {
      const fx = TOKEN_GAIN_SOUND[ev.kind]
      return fx && ev.delta > 0 ? [{ id: fx, opts: { volume: 0.8 } }] : []
    }
    case 'OrderSet':
      return [{ id: ev.order === 'engage' ? 'ui-order-engage' : 'ui-order-conceal' }]
    case 'ApSpent':
      return [{ id: 'ui-ap-spend', opts: { volume: 0.6 } }]
    case 'Counteracted':
      return [{ id: 'narr-counteract' }]
    case 'GuardInterrupt': {
      const shout = shoutSound(factionOf(s, ev.operativeId))
      return shout ? [{ id: shout, opts: { volume: 0.8 } }] : []
    }
    case 'OperativeMoved': {
      const kinds = new Set(ev.segments.map((g) => g.kind))
      const f = factionOf(s, ev.operativeId)
      const out: EventSound[] = [{ id: stepsSound(f), opts: { volume: 0.55 } }]
      if (kinds.has('climb')) out.push({ id: 'move-climb', opts: { volume: 0.7, delayMs: 200 } })
      if (kinds.has('drop') || kinds.has('jump')) out.push({ id: 'move-drop', opts: { volume: 0.7, delayMs: 350 } })
      return out
    }
    case 'AttackDiceRolled': {
      // a shot: the weapon sounds once, when the dice fly. In a fight FightStarted voices the weapons instead.
      if (ctx.mode === 'fight' || !ev.weaponId) return []
      const w = weaponSound(ev.weaponId)
      return [{ id: w.id, ...(w.volume !== undefined ? { opts: { volume: w.volume } } : {}) }]
    }
    case 'DiceRerolled':
      return [
        { id: 'ui-dice-rattle', opts: { volume: 0.9 } },
        { id: 'ui-dice-land', opts: { volume: 0.8, delayMs: 380 } },
      ]
    case 'DiceBlocked':
      return ev.blockedNormal + ev.blockedCrit > 0 ? [{ id: 'hit-armour' }] : []
    case 'DamageInflicted':
      return [{ id: 'hit-flesh', opts: { volume: ev.amount >= 4 ? 1 : 0.8 } }]
    case 'FightStarted': {
      const out: EventSound[] = []
      if (ev.attackerWeapon) out.push({ id: weaponSound(ev.attackerWeapon).id })
      if (ev.defenderWeapon) out.push({ id: weaponSound(ev.defenderWeapon).id, opts: { volume: 0.7, delayMs: 260 } })
      return out
    }
    case 'Struck': {
      const f = ctx.fight
      const weapon = f ? (ev.operativeId === f.attackerId ? f.attackerWeapon : f.defenderWeapon) : null
      return weapon && weaponSound(weapon).id === 'wpn-chainsword-rev' ? [{ id: 'wpn-chainsword-hit' }] : []
    }
    case 'Blocked':
      return [{ id: 'block-clang' }]
    case 'OperativeIncapacitated':
      return [
        { id: deathSound(factionOf(s, ev.operativeId), ev.seq) },
        { id: 'narr-operative-down', opts: { delayMs: 700 } },
      ]
    case 'MarkerPickedUp':
      return [{ id: 'ui-marker-pickup' }]
    case 'MarkerPlaced':
    case 'ObjectivePlaced':
    case 'EquipmentPlaced':
      return [{ id: 'ui-marker-pickup', opts: { volume: 0.7 } }]
    case 'MissionActionPerformed':
      return /secure/i.test(ev.action)
        ? [{ id: 'ui-marker-pickup' }, { id: 'narr-objective-secured', opts: { delayMs: 450 } }]
        : [{ id: 'ui-marker-pickup' }]
    case 'KillGradeChanged':
      return [{ id: 'ui-cp-gained', opts: { volume: 0.9 } }]
    case 'VpScored':
      return ev.amount > 0 ? [{ id: 'ui-vp-scored' }] : []
    case 'MineTriggered':
      return [{ id: 'wpn-grenade-frag' }]
    case 'OperativeTransformed':
      return [{ id: 'fx-reanimate', opts: { volume: 0.8 } }]
    case 'DiceRolled':
      return [
        { id: 'ui-dice-rattle' },
        { id: 'ui-dice-land', opts: { volume: 0.8, delayMs: 420 } },
      ]
    default:
      return []
  }
}

/** Sounds for a batch of events through any `play` function (the AudioManager in the app, a spy in tests). */
export function playEventSounds(
  play: (id: SoundId, opts?: PlayOptions) => void,
  events: readonly GameEvent[],
  ctx: SoundContext = EMPTY_CONTEXT,
): void {
  for (const ev of events) for (const s of soundsForEvent(ev, ctx)) play(s.id, s.opts)
}
