// Audio mapping: the id list is exactly the mp3 folder, every weapon in the data maps explicitly to an mp3 that exists, every
// handler and silence names a real engine event, the announcer speaks on the big moments only, a real game only ever asks for
// ids that exist, and the music plan follows the screen, the round and the bottle state.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GameEvent, GameState } from '@/engine'
import { SOUND_IDS, channelFor } from '@/client/audio/ids'
import { EMPTY_CONTEXT, EVENT_SOUNDS, WEAPON_SOUND, playEventSounds, shotSound, soundsForEvent, weaponSound, type SoundContext } from '@/client/audio/eventSounds'
import { LATE_ROUND, musicPlan, type MusicInput } from '@/client/audio/music'
import { DEFAULT_AUDIO_SETTINGS, parseAudioSettings } from '@/client/audio/settings'
import { realBundle } from '../fixtures/real'
import { playGame } from '../fixtures/presentation'

const ROOT = join(__dirname, '..', '..')
const AUDIO_DIR = join(ROOT, 'public', 'audio')
const mp3 = (id: string) => join(AUDIO_DIR, `${id}.mp3`)

const weapons = Object.values(realBundle().weapons)

describe('audio assets', () => {
  it('SOUND_IDS is exactly the set of mp3 files in public/audio', () => {
    const files = readdirSync(AUDIO_DIR)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => f.replace(/\.mp3$/, ''))
      .sort()
    expect([...SOUND_IDS].sort()).toEqual(files)
    expect(SOUND_IDS.length).toBe(84)
  })

  it('every id has a measured trim', () => {
    const trims = JSON.parse(readFileSync(join(AUDIO_DIR, 'trims.json'), 'utf8')) as Record<string, number>
    expect(SOUND_IDS.filter((id) => !(id in trims))).toEqual([])
    for (const id of SOUND_IDS) expect(trims[id]).toBeGreaterThan(0)
  })

  it('routes announcer lines to the voice bus, music and ambience to the music bus, the rest to effects', () => {
    expect(channelFor('vo-fighter-down')).toBe('voice')
    expect(channelFor('music-title')).toBe('music')
    expect(channelFor('amb-hive-hum')).toBe('music')
    expect(channelFor('wpn-slugga')).toBe('sfx')
  })
})

describe('weapon sounds', () => {
  it('both gangs and the core list are in the data', () => {
    expect(weapons.some((w) => w.id.startsWith('gol.'))).toBe(true)
    expect(weapons.some((w) => w.id.startsWith('esc.'))).toBe(true)
    expect(weapons.some((w) => w.id.startsWith('core.'))).toBe(true)
  })

  it('every weapon id maps explicitly to an mp3 that exists', () => {
    const missing = weapons.filter((w) => !(w.id in WEAPON_SOUND)).map((w) => w.id)
    expect(missing).toEqual([])
    for (const w of weapons) {
      const s = weaponSound(null, w.id)
      expect(existsSync(mp3(s.id)), `${w.id} -> ${s.id}`).toBe(true)
      expect(SOUND_IDS).toContain(s.id)
    }
  })

  it('has no stale weapon entries', () => {
    const ids = new Set(weapons.map((w) => w.id))
    expect(Object.keys(WEAPON_SOUND).filter((k) => !ids.has(k.split('#')[0]!))).toEqual([])
    // a profile row names a profile the weapon really has
    for (const k of Object.keys(WEAPON_SOUND).filter((x) => x.includes('#'))) {
      const [id, profile] = k.split('#')
      expect(realBundle().weapons[id!]?.profiles.some((p) => p.id === profile), k).toBe(true)
    }
  })

  it('the supercharged plasma profile sounds different, an unknown weapon falls back to its flavour', () => {
    expect(weaponSound(null, 'esc.w.plasma-gun', 'low').id).toBe('wpn-plasma-pistol')
    expect(weaponSound(null, 'esc.w.plasma-gun', 'max').id).toBe('wpn-plasma-pistol-supercharge')
    expect(weaponSound(null, 'future.w.mega-flamer').id).toBe('wpn-hand-flamer')
    expect(weaponSound(null, 'future.w.thing').id).toBeTruthy()
  })
})

// ---------------------------------------------------------------- event table

const eventsSource = readFileSync(join(ROOT, 'src', 'engine', 'events.ts'), 'utf8')
const EVENT_TYPES = [...eventsSource.matchAll(/\{\s*type: '([A-Za-z]+)'/g)].map((m) => m[1]!).filter((t, i, a) => a.indexOf(t) === i)

const base = { seq: 7, round: 1, phase: 'action', seat: 'A' } as const
const ev = (body: Record<string, unknown>) => ({ ...base, ...body }) as unknown as GameEvent

/** A minimal state: a house per seat. */
const stub = (a: string, b: string) => ({ players: { A: { houseId: a }, B: { houseId: b } }, fighters: {} }) as unknown as GameState

/** One representative event for every handler in the table. */
const SAMPLES: Record<string, GameEvent> = {
  RoundStarted: ev({ type: 'RoundStarted', round: 1 }),
  RoundEnded: ev({ type: 'RoundEnded', round: 1 }),
  PriorityDecided: ev({ type: 'PriorityDecided', holder: 'A', rolls: { A: 5, B: 2 }, tieRule: false }),
  FightersReadied: ev({ type: 'FightersReadied', fighterIds: ['a1'] }),
  GameEnded: ev({ type: 'GameEnded', result: { winner: 'A', points: { A: 3, B: 1 }, reason: 'scenario' } }),
  FighterDeployed: ev({ type: 'FighterDeployed', fighterId: 'a1', pos: { x: 0, y: 0, z: 0 }, facing: 0 }),
  FighterMoved: ev({ type: 'FighterMoved', fighterId: 'a1', kind: 'move', from: {}, to: {}, path: [], length: 4, maxInches: 5 }),
  StatusChanged: ev({ type: 'StatusChanged', fighterId: 'b1', from: 'standing', to: 'pinned', reason: 'pinned' }),
  FighterOutOfAction: ev({ type: 'FighterOutOfAction', fighterId: 'b1', by: 'a1', cause: 'shot' }),
  BlastPlaced: ev({ type: 'BlastPlaced', centre: { x: 0, z: 0 }, radius: 3 }),
  AmmoTest: ev({ type: 'AmmoTest', fighterId: 'a1', weaponId: 'w', roll: 1, need: 4, passed: false, result: 'failed' }),
  SaveRolled: ev({ type: 'SaveRolled', targetId: 'b1', roll: 5, need: 4, saved: true, item: null }),
  DamageInflicted: ev({ type: 'DamageInflicted', targetId: 'b1', amount: 1, wounds: 1 }),
  KnockedBack: ev({ type: 'KnockedBack', targetId: 'b1' }),
  CaughtFire: ev({ type: 'CaughtFire', targetId: 'b1' }),
  FightStarted: ev({ type: 'FightStarted', attackerId: 'a1', targets: ['b1'], weapons: ['gol.w.axe'], dice: 2, charge: false }),
  FightHitRolled: ev({ type: 'FightHitRolled', weaponId: 'core.w.chainsword', targetId: 'b1', dice: [4, 2], need: 4, modifiers: [] }),
  Parried: ev({ type: 'Parried', by: 'b1', rerolled: [3] }),
  CoupDeGrace: ev({ type: 'CoupDeGrace', fighterId: 'a1', targetId: 'b1' }),
  BottleTest: ev({ type: 'BottleTest', seat: 'B', roll: 4, down: 3, crew: 6, bottled: true, voluntary: false }),
  DoorChanged: ev({ type: 'DoorChanged', doorId: 'd1', state: 'open', locked: false }),
  DoorDamaged: ev({ type: 'DoorDamaged', doorId: 'd1', wounds: 1 }),
  TerminalAccessed: ev({ type: 'TerminalAccessed', fighterId: 'a1', terminalId: 't1' }),
  DuctUsed: ev({ type: 'DuctUsed', fighterId: 'a1', ductId: 'x1' }),
  CasketOpened: ev({ type: 'CasketOpened', casketId: 'c1', by: 'a1', roll: 4, result: 'open' }),
  CasketMoved: ev({ type: 'CasketMoved', casketId: 'c1', to: { x: 0, z: 0 }, carriedBy: 'a1' }),
  CasketSecured: ev({ type: 'CasketSecured', casketId: 'c1', seat: 'A' }),
  SmokePlaced: ev({ type: 'SmokePlaced', smokeId: 's1', pos: { x: 0, z: 0 }, radius: 3 }),
  PointsScored: ev({ type: 'PointsScored', seat: 'A', amount: 1, reason: 'x' }),
  ResultLocked: ev({ type: 'ResultLocked', winner: 'A', reason: 'x' }),
  DiceRolled: ev({ type: 'DiceRolled', purpose: 'hit', die: 'd6', dice: [3], final: true }),
}

describe('event sound table', () => {
  it('every handler names a real engine event, and has a sample that makes a sound', () => {
    expect(EVENT_TYPES.length).toBeGreaterThan(60)
    for (const type of Object.keys(EVENT_SOUNDS)) {
      expect(EVENT_TYPES, `${type} is an engine event`).toContain(type)
      const sample = SAMPLES[type]
      expect(sample, `a sample event for ${type}`).toBeTruthy()
      const out = soundsForEvent(sample!, { ...EMPTY_CONTEXT, state: stub('goliath', 'escher'), perspective: 'A' })
      expect(out.length, `${type} should make a sound`).toBeGreaterThan(0)
      for (const s of out) expect(SOUND_IDS).toContain(s.id)
    }
  })

  it('an event with no handler is silent, and a new engine event cannot break the mapper', () => {
    expect(soundsForEvent(ev({ type: 'GameCreated', seed: 's', engineVersion: '1' }))).toEqual([])
    expect(soundsForEvent(ev({ type: 'SomethingNewFromS4' }))).toEqual([])
  })

  it('the shot sounds like the weapon, once, from the director', () => {
    expect(shotSound(null, 'esc.w.autogun').id).toBe('wpn-auto-bolt-rifle')
    expect(shotSound(null, 'esc.w.whip').id).toBe('esc-whip-crack')
    expect(soundsForEvent(ev({ type: 'ShootStarted', fighterId: 'a1', weaponId: 'esc.w.autogun', profileId: 'std', mode: 'normal' }))).toEqual([])
  })

  it('a fight starts with the sound of the first weapon', () => {
    expect(soundsForEvent(SAMPLES.FightStarted!, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['wpn-choppa'])
    expect(soundsForEvent(SAMPLES.FightHitRolled!, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['wpn-chainsword-hit'])
    expect(soundsForEvent(ev({ type: 'FightHitRolled', weaponId: 'gol.w.axe', targetId: 'b1', dice: [4], need: 4, modifiers: [] }), EMPTY_CONTEXT)).toEqual([])
  })

  it('priority and the result are voiced by house, and the stings follow the viewing seat', () => {
    const voice = (e: GameEvent, c: SoundContext) => soundsForEvent(e, c).filter((s) => channelFor(s.id) === 'voice').map((s) => s.id)
    const ctx = (a: string, b: string, perspective: 'A' | 'B'): SoundContext => ({ state: stub(a, b), perspective })
    expect(voice(SAMPLES.PriorityDecided!, ctx('goliath', 'escher', 'A'))).toEqual(['vo-priority-goliath'])
    expect(voice(ev({ type: 'PriorityDecided', holder: 'B', rolls: { A: 1, B: 6 }, tieRule: false }), ctx('goliath', 'escher', 'A'))).toEqual(['vo-priority-escher'])
    expect(voice(SAMPLES.GameEnded!, ctx('goliath', 'escher', 'A'))).toEqual(['vo-goliath-hold'])
    expect(soundsForEvent(SAMPLES.GameEnded!, ctx('goliath', 'escher', 'A'))[0]!.id).toBe('ui-victory-sting')
    expect(soundsForEvent(SAMPLES.GameEnded!, ctx('goliath', 'escher', 'B'))[0]!.id).toBe('ui-defeat-sting')
    const draw = ev({ type: 'GameEnded', result: { winner: 'draw', points: { A: 1, B: 1 }, reason: 'roundLimit' } })
    expect(voice(draw, EMPTY_CONTEXT)).toEqual(['vo-standoff'])
  })

  it('pinned and seriously injured have their cues, a bottled gang is announced as breaking', () => {
    expect(soundsForEvent(SAMPLES.StatusChanged!, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['status-pinned'])
    const hurt = ev({ type: 'StatusChanged', fighterId: 'b1', from: 'standing', to: 'seriouslyInjured', reason: 'x' })
    expect(soundsForEvent(hurt, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['status-injured'])
    const standUp = ev({ type: 'StatusChanged', fighterId: 'b1', from: 'pinned', to: 'standing', reason: 'standUp' })
    expect(soundsForEvent(standUp, EMPTY_CONTEXT)).toEqual([])
    expect(soundsForEvent(SAMPLES.BottleTest!, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['bottle-test', 'vo-bottle-test', 'vo-breaking'])
    const held = ev({ type: 'BottleTest', seat: 'B', roll: 1, down: 1, crew: 6, bottled: false, voluntary: false })
    expect(soundsForEvent(held, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['bottle-test', 'vo-bottle-test'])
  })

  it('doors open, close and lock', () => {
    const door = (state: string, locked: boolean) => soundsForEvent(ev({ type: 'DoorChanged', doorId: 'd', state, locked }), EMPTY_CONTEXT)[0]!.id
    expect(door('open', false)).toBe('zm-door-open')
    expect(door('closed', false)).toBe('zm-door-close')
    expect(door('closed', true)).toBe('zm-door-locked')
  })

  it('every roll gets the rattle and the land; plays through any play function', () => {
    expect(soundsForEvent(SAMPLES.DiceRolled!, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['ui-dice-rattle', 'ui-dice-land'])
    const heard: string[] = []
    playEventSounds((id) => heard.push(id), [SAMPLES.DiceRolled!, SAMPLES.FightersReadied!], EMPTY_CONTEXT)
    expect(heard).toEqual(['ui-dice-rattle', 'ui-dice-land', 'ready-markers'])
  })
})

describe('a real game', () => {
  it('only ever asks for ids that exist, and uses a weapon, the dice and the announcer', () => {
    const heard = new Set<string>()
    const listen = (state: GameState, events: GameEvent[]) => {
      for (const e of events) {
        const ctx = { state, perspective: 'A' as const }
        for (const s of soundsForEvent(e, ctx)) {
          expect(SOUND_IDS).toContain(s.id)
          heard.add(s.id)
        }
        if (e.type === 'ShootStarted') {
          const s = shotSound(state, e.weaponId, e.profileId)
          expect(SOUND_IDS).toContain(s.id)
          heard.add(s.id)
        }
      }
    }
    const played = playGame('audio-1', (s) => s.round >= 3, 2500)
    for (const st of played.steps) listen(st.state, st.events)
    const ids = [...heard]
    expect(played.steps.length).toBeGreaterThan(100)
    expect(ids.some((i) => i.startsWith('wpn-') || i.startsWith('esc-'))).toBe(true)
    expect(ids).toContain('ui-dice-rattle')
    expect(ids).toContain('ui-priority')
    expect(ids.some((i) => i.startsWith('vo-priority'))).toBe(true)
  }, 120000)
})

// ---------------------------------------------------------------- music and settings

describe('music plan', () => {
  const gang = (down: number, bottled = false) => ({ crew: 6, down, bottled })
  const battle = (over: Partial<MusicInput>): ReturnType<typeof musicPlan> =>
    musicPlan({ screen: 'battle', phase: 'action', round: 1, gangs: { A: gang(0), B: gang(0) }, result: null, perspective: 'A', ...over })

  it('plays the title on the menus and during set-up, with no ambience', () => {
    expect(musicPlan({ screen: 'start', phase: null, round: 0, gangs: null, result: null, perspective: 'A' })).toMatchObject({ id: 'music-title', ambience: null })
    expect(battle({ phase: 'setup', round: 0 }).id).toBe('music-title')
  })

  it('alternates battle-a and battle-b per round with the ambience bed under it', () => {
    expect(battle({ round: 1 })).toMatchObject({ id: 'music-battle-a', ambience: 'amb-hive-hum' })
    expect(battle({ round: 2 }).id).toBe('music-battle-b')
    expect(battle({ round: 3 }).id).toBe('music-battle-a')
  })

  it('goes tense when a gang has bottled, is half down, or the battle is late', () => {
    expect(battle({ round: 2, gangs: { A: gang(0), B: gang(3) } })).toMatchObject({ id: 'music-tense', tense: true })
    expect(battle({ round: 2, gangs: { A: gang(0), B: gang(2) } }).id).toBe('music-battle-b')
    expect(battle({ round: 2, gangs: { A: gang(0), B: gang(1, true) } }).id).toBe('music-tense')
    expect(battle({ round: LATE_ROUND }).id).toBe('music-tense')
  })

  it('ends with the victory or defeat piece, played once', () => {
    const won = battle({ phase: 'ended', round: 4, result: { winner: 'A', points: { A: 4, B: 2 }, reason: 'scenario' } })
    expect(won).toMatchObject({ id: 'music-victory', loop: false, ambience: null })
    const lost = battle({ phase: 'ended', round: 4, result: { winner: 'B', points: { A: 1, B: 2 }, reason: 'scenario' } })
    expect(lost).toMatchObject({ id: 'music-defeat', loop: false })
  })
})

describe('audio settings', () => {
  it('parses stored settings, clamps them and survives junk', () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS)
    expect(parseAudioSettings('{not json')).toEqual(DEFAULT_AUDIO_SETTINGS)
    const s = parseAudioSettings(JSON.stringify({ master: 2, sfx: -1, voice: 0.25, music: 'loud', muted: true }))
    expect(s.master).toBe(1)
    expect(s.sfx).toBe(0)
    expect(s.voice).toBe(0.25)
    expect(s.music).toBe(DEFAULT_AUDIO_SETTINGS.music)
    expect(s.muted).toBe(true)
  })
})
