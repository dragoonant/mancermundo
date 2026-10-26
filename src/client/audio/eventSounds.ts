// Maps engine events to sounds from public/audio. Pure (no AudioManager, no DOM) so it is unit-testable; `playEventSounds` is the
// only function that touches a play function. Event handlers live in one table keyed by event type (a Partial: an event with no
// handler is silent, so a new engine event never breaks the build), weapon sounds in a data table keyed by weapon id with the
// weapon's flavour as the safety net. The announcer speaks on the big moments only (priority, fighter down, out of action, bottle
// test, the result).
import type { GameEvent, GameState, Seat } from '@/engine'
import { flavourOf, type WeaponFlavour } from '../weaponFlavour'
import type { PlayOptions } from './manager'
import type { SoundId } from './ids'

export interface EventSound {
  id: SoundId
  opts?: PlayOptions
}

/** What the mapper needs besides the event itself. */
export interface SoundContext {
  /** state after the step that produced the event (house and weapon lookups) */
  state: GameState | null
  /** the seat whose point of view victory / defeat is told from */
  perspective: Seat | null
}

export const EMPTY_CONTEXT: SoundContext = { state: null, perspective: null }

// ---------------------------------------------------------------- weapons

export interface WeaponSfx {
  id: SoundId
  volume?: number
}

const sfx = (id: SoundId, volume?: number): WeaponSfx => (volume === undefined ? { id } : { id, volume })

/**
 * Weapon id -> sound; `<weapon id>#<profile id>` beats the plain id (the plasma weapons have a supercharged profile). Every weapon
 * of both gangs and the core list has a row; tests/client/eventSounds.test.ts fails on a weapon in the data without one.
 */
export const WEAPON_SOUND: Record<string, WeaponSfx> = {
  // core
  'core.w.stub-gun': sfx('wpn-slugga'),
  'core.w.stub-gun.dumdum': sfx('wpn-slugga'),
  'core.w.hand-flamer': sfx('wpn-hand-flamer'),
  'core.w.boltgun': sfx('wpn-bolt-rifle'),
  'core.w.shotgun': sfx('wpn-stalker-bolt-rifle'),
  'core.w.shotgun.acid-rounds': sfx('wpn-stalker-bolt-rifle', 0.8),
  'core.w.shotgun.executioner': sfx('wpn-stalker-bolt-rifle'),
  'core.w.shotgun.inferno': sfx('wpn-hand-flamer'),
  'core.w.flamer': sfx('wpn-burna'),
  'core.w.grenade-launcher': sfx('wpn-grenade-launcher'),
  'core.w.grenade-launcher.smoke': sfx('wpn-grenade-launcher', 0.8),
  'core.w.grenade-launcher.stun-rounds': sfx('wpn-grenade-launcher', 0.8),
  'core.w.meltagun': sfx('wpn-plasma-pistol-supercharge'),
  'core.w.heavy-stubber': sfx('wpn-heavy-bolter'),
  'core.w.chainaxe': sfx('wpn-chainsword-rev'),
  'core.w.chainsword': sfx('wpn-chainsword-rev'),
  'core.w.knife': sfx('wpn-throwing-knives'),
  'core.w.power-hammer': sfx('wpn-thunder-hammer'),
  'core.w.servo-claw': sfx('wpn-power-fist'),
  'core.w.frag-grenades': sfx('wpn-grenade-frag'),
  'core.w.krak-grenades': sfx('wpn-grenade-krak'),
  'core.w.smoke-grenades': sfx('esc-chem-hiss'),
  'core.w.stun-grenades': sfx('wpn-grenade-frag', 0.7),
  // Goliath
  'gol.w.bolt-pistol': sfx('wpn-bolt-pistol'),
  'gol.w.combat-shotgun': sfx('wpn-stalker-bolt-rifle'),
  'gol.w.combat-shotgun.firestorm': sfx('wpn-hand-flamer'),
  'gol.w.stub-cannon': sfx('wpn-heavy-bolt-pistol'),
  'gol.w.heavy-bolter': sfx('wpn-heavy-bolter'),
  'gol.w.heavy-flamer': sfx('wpn-burna'),
  'gol.w.krumper-rivet-cannon': sfx('wpn-dakka-shoota'),
  'gol.w.missile-launcher': sfx('wpn-rokkit-launcha'),
  'gol.w.multi-melta': sfx('wpn-plasma-pistol-supercharge'),
  'gol.w.assault-grenade-launchers': sfx('wpn-grenade-launcher'),
  'gol.w.assault-grenade-launchers.krak': sfx('wpn-grenade-krak'),
  'gol.w.assault-grenade-launchers.smoke': sfx('wpn-grenade-launcher', 0.8),
  'gol.w.axe': sfx('wpn-choppa'),
  'gol.w.brute-cleaver': sfx('wpn-big-choppa'),
  'gol.w.heavy-rock-saw': sfx('wpn-chainsword-rev'),
  'gol.w.maul': sfx('wpn-power-fist'),
  'gol.w.power-axe': sfx('wpn-power-weapon'),
  'gol.w.pulveriser-serrated-axe': sfx('wpn-thunder-hammer'),
  'gol.w.renderizer-serrated-axe': sfx('wpn-thunder-hammer'),
  'gol.w.spud-jacker': sfx('wpn-power-fist'),
  'gol.w.two-handed-axe': sfx('wpn-big-choppa'),
  'gol.w.two-handed-hammer': sfx('wpn-thunder-hammer'),
  'gol.w.paired-pulverisers': sfx('wpn-twin-choppas'),
  'gol.w.paired-spud-jackers': sfx('wpn-power-klaw'),
  'gol.w.blasting-charges': sfx('wpn-explosives'),
  'gol.w.incendiary-charges': sfx('wpn-hand-flamer'),
  'gol.w.melta-bombs': sfx('wpn-dynamite'),
  // Escher
  'esc.w.autopistol': sfx('wpn-bolt-pistol'),
  'esc.w.laspistol': sfx('wpn-plasma-pistol', 0.8),
  'esc.w.laspistol-hotshot': sfx('wpn-plasma-pistol'),
  'esc.w.needle-pistol': sfx('wpn-bolt-pistol', 0.5),
  'esc.w.plasma-pistol': sfx('wpn-plasma-pistol'),
  'esc.w.plasma-pistol#max': sfx('wpn-plasma-pistol-supercharge'),
  'esc.w.autogun': sfx('wpn-auto-bolt-rifle'),
  'esc.w.lasgun': sfx('wpn-plasma-pistol', 0.8),
  'esc.w.lasgun-hotshot': sfx('wpn-plasma-pistol'),
  'esc.w.sawn-off-shotgun': sfx('wpn-stalker-bolt-rifle'),
  'esc.w.wyld-bow': sfx('wpn-throwing-knives', 0.7),
  'esc.w.wyld-bow.poison': sfx('wpn-throwing-knives', 0.7),
  'esc.w.wyld-bow.explosive': sfx('wpn-throwing-knives', 0.7),
  'esc.w.wyld-bow.acid': sfx('wpn-throwing-knives', 0.7),
  'esc.w.nightshade-chem-thrower': sfx('esc-chem-hiss'),
  'esc.w.needle-rifle': sfx('wpn-bolt-sniper-rifle', 0.6),
  'esc.w.plasma-gun': sfx('wpn-plasma-pistol'),
  'esc.w.plasma-gun#max': sfx('wpn-plasma-pistol-supercharge'),
  'esc.w.plasma-cannon': sfx('wpn-plasma-pistol'),
  'esc.w.plasma-cannon#max': sfx('wpn-plasma-pistol-supercharge'),
  'esc.w.power-knife': sfx('wpn-power-weapon'),
  'esc.w.power-sword': sfx('wpn-power-weapon'),
  'esc.w.stiletto-knife': sfx('wpn-throwing-knives'),
  'esc.w.stiletto-sword': sfx('wpn-throwing-knives'),
  'esc.w.venom-claw': sfx('wpn-throwing-knives'),
  'esc.w.whip': sfx('esc-whip-crack'),
  'esc.w.shock-whip': sfx('esc-whip-crack'),
  'esc.w.choke-gas-grenades': sfx('esc-chem-hiss'),
  'esc.w.photon-flash-flares': sfx('wpn-explosives', 0.6),
}

const FLAVOUR_FALLBACK: Record<WeaponFlavour, SoundId> = {
  stub: 'wpn-auto-bolt-rifle',
  las: 'wpn-plasma-pistol',
  bolter: 'wpn-bolt-rifle',
  flamer: 'wpn-hand-flamer',
  plasma: 'wpn-plasma-pistol',
  melta: 'wpn-plasma-pistol-supercharge',
  grenade: 'wpn-grenade-frag',
  chain: 'wpn-chainsword-rev',
  blade: 'wpn-choppa',
  maul: 'wpn-thunder-hammer',
  whip: 'esc-whip-crack',
  crush: 'wpn-power-fist',
}

/** The sound of a weapon (and profile): the explicit table, else its flavour. Never undefined. */
export function weaponSound(state: GameState | null, weaponId: string, profileId?: string | null): WeaponSfx {
  return (profileId ? WEAPON_SOUND[`${weaponId}#${profileId}`] : undefined) ?? WEAPON_SOUND[weaponId] ?? { id: FLAVOUR_FALLBACK[flavourOf(state, weaponId)] }
}

// ---------------------------------------------------------------- houses

/** The announcer line naming a gang, by its house. */
function houseLine(state: GameState | null, seat: Seat, goliath: SoundId, escher: SoundId): SoundId | null {
  const house = state?.players[seat]?.houseId
  return house === 'goliath' ? goliath : house === 'escher' ? escher : null
}

const withVoice = (sound: EventSound, line: SoundId | null, delayMs: number): EventSound[] => (line ? [sound, { id: line, opts: { delayMs } }] : [sound])

// ---------------------------------------------------------------- handlers

type Handler<K extends GameEvent['type']> = (ev: Extract<GameEvent, { type: K }>, ctx: SoundContext) => EventSound[]
export type EventSoundTable = { [K in GameEvent['type']]?: Handler<K> }

/** How a move sounds, by kind. */
function stepsFor(kind: string, state: GameState | null, fighterId: string): EventSound[] {
  switch (kind) {
    case 'duct':
      return [{ id: 'move-climb', opts: { volume: 0.8 } }]
    case 'knockback':
      return [{ id: 'move-drop', opts: { volume: 0.7 } }]
    case 'charge': {
      const house = state?.fighters[fighterId]?.seat ? state.players[state.fighters[fighterId]!.seat]?.houseId : null
      return [{ id: 'move-steps-heavy', opts: { volume: 0.8 } }, ...(house === 'goliath' ? [{ id: 'gol-roar-perc' as SoundId, opts: { volume: 0.7 } }] : [])]
    }
    case 'crawl':
      return [{ id: 'move-steps-rubble', opts: { volume: 0.5 } }]
    case 'doorPush':
    case 'pushedApart':
      return []
    default:
      return [{ id: 'move-steps-heavy', opts: { volume: 0.55 } }]
  }
}

/** A voice line on roughly a third of the fighters going down, so the announcer does not talk over every casualty. */
const downLine = (seq: number): SoundId | null => (seq % 3 === 0 ? 'vo-out-of-action' : seq % 3 === 1 ? 'vo-fighter-down' : null)

export const EVENT_SOUNDS: EventSoundTable = {
  RoundStarted: (ev) => [{ id: 'ui-turning-point-sting', opts: { volume: 0.7 } }, ...(ev.round === 1 ? [{ id: 'vo-take-positions' as SoundId, opts: { delayMs: 700 } }] : [])],
  RoundEnded: () => [{ id: 'vo-round-over', opts: { delayMs: 200 } }],
  PriorityDecided: (ev, ctx) => withVoice({ id: 'ui-priority' }, houseLine(ctx.state, ev.holder, 'vo-priority-goliath', 'vo-priority-escher'), 900),
  FightersReadied: (ev) => (ev.fighterIds.length > 0 ? [{ id: 'ready-markers', opts: { volume: 0.8 } }] : []),
  GameEnded: (ev, ctx) => {
    const win = ev.result.winner
    if (win === 'draw') return [{ id: 'vo-standoff', opts: { delayMs: 500 } }]
    const sting: SoundId = win === (ctx.perspective ?? 'A') ? 'ui-victory-sting' : 'ui-defeat-sting'
    return withVoice({ id: sting }, houseLine(ctx.state, win, 'vo-goliath-hold', 'vo-escher-hold'), 1100)
  },
  FighterDeployed: () => [{ id: 'ui-ap-spend', opts: { volume: 0.7 } }],
  FighterMoved: (ev, ctx) => stepsFor(ev.kind, ctx.state, ev.fighterId),
  StatusChanged: (ev) => {
    if (ev.to === 'pinned' && ev.from === 'standing') return [{ id: 'status-pinned' }]
    if (ev.to === 'seriouslyInjured') return [{ id: 'status-injured' }]
    return []
  },
  FighterOutOfAction: (ev) => {
    const line = downLine(ev.seq)
    return [{ id: 'status-out-of-action' }, { id: 'death-generic', opts: { volume: 0.7, delayMs: 150 } }, ...(line ? [{ id: line, opts: { delayMs: 900 } }] : [])]
  },
  // the shot itself is voiced by the director when the volley fires (playShotSound); a blast then lands
  BlastPlaced: () => [{ id: 'wpn-explosives', opts: { volume: 0.8, delayMs: 250 } }],
  AmmoTest: (ev) => (ev.passed ? [] : [{ id: 'block-clang', opts: { volume: 0.5 } }]),
  SaveRolled: (ev) => (ev.saved ? [{ id: 'hit-armour' }] : []),
  DamageInflicted: (ev) => [{ id: 'hit-flesh', opts: { volume: ev.amount >= 3 ? 1 : 0.8 } }],
  KnockedBack: () => [{ id: 'move-drop', opts: { volume: 0.6, delayMs: 100 } }],
  CaughtFire: () => [{ id: 'wpn-hand-flamer', opts: { volume: 0.4 } }],
  FightStarted: (ev, ctx) => {
    const first = ev.weapons[0]
    if (!first) return [{ id: 'hit-flesh', opts: { volume: 0.7 } }]
    const w = weaponSound(ctx.state, first)
    return [{ id: w.id, ...(w.volume !== undefined ? { opts: { volume: w.volume } } : {}) }]
  },
  FightHitRolled: (ev, ctx) => (ev.dice.length > 0 && flavourOf(ctx.state, ev.weaponId) === 'chain' ? [{ id: 'wpn-chainsword-hit', opts: { delayMs: 150 } }] : []),
  Parried: () => [{ id: 'block-clang' }],
  CoupDeGrace: () => [{ id: 'hit-flesh' }],
  BottleTest: (ev) => {
    const out: EventSound[] = [{ id: 'bottle-test' }, { id: 'vo-bottle-test', opts: { delayMs: 300 } }]
    if (ev.bottled) out.push({ id: 'vo-breaking', opts: { delayMs: 1700 } })
    return out
  },
  DoorChanged: (ev) => [{ id: ev.state === 'closed' ? (ev.locked ? 'zm-door-locked' : 'zm-door-close') : 'zm-door-open' }],
  DoorDamaged: () => [{ id: 'block-clang', opts: { volume: 0.8 } }],
  TerminalAccessed: () => [{ id: 'ui-marker-pickup', opts: { volume: 0.7 } }],
  DuctUsed: () => [{ id: 'move-climb', opts: { volume: 0.7 } }],
  CasketOpened: () => [{ id: 'ui-marker-pickup' }],
  CasketMoved: () => [{ id: 'ui-marker-pickup', opts: { volume: 0.6 } }],
  CasketSecured: () => [{ id: 'ui-vp-scored' }],
  SmokePlaced: () => [{ id: 'esc-chem-hiss', opts: { volume: 0.8 } }],
  PointsScored: (ev) => (ev.amount > 0 ? [{ id: 'ui-vp-scored' }] : []),
  ResultLocked: () => [{ id: 'ui-turning-point-sting', opts: { volume: 0.9 } }],
  DiceRolled: () => [{ id: 'ui-dice-rattle' }, { id: 'ui-dice-land', opts: { volume: 0.8, delayMs: 420 } }],
}

/** Sounds for one engine event (none when the event has no handler). */
export function soundsForEvent(ev: GameEvent, ctx: SoundContext = EMPTY_CONTEXT): EventSound[] {
  const handler = EVENT_SOUNDS[ev.type] as ((e: GameEvent, c: SoundContext) => EventSound[]) | undefined
  return handler ? handler(ev, ctx) : []
}

/** The weapon sound of a shot as a play request (what the director plays when the volley fires). */
export function shotSound(state: GameState | null, weaponId: string, profileId?: string | null): EventSound {
  const w = weaponSound(state, weaponId, profileId)
  return { id: w.id, ...(w.volume !== undefined ? { opts: { volume: w.volume } } : {}) }
}

/** Sounds for a batch of events through any `play` function (the AudioManager in the app, a spy in tests). */
export function playEventSounds(play: (id: SoundId, opts?: PlayOptions) => void, events: readonly GameEvent[], ctx: SoundContext = EMPTY_CONTEXT): void {
  for (const ev of events) for (const s of soundsForEvent(ev, ctx)) play(s.id, s.opts)
}
