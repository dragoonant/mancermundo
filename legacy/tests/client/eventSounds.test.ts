// Audio mapping: every weapon of both teams maps to an mp3 that exists, every engine event type has a sound or an
// explicit silence, a real game only ever asks for ids that exist, deaths and music follow the team and the score.
import { ALL_WEAPON_IDS, isPresented } from '../fixtures/presentation'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GameEvent, GameState } from '@/engine'
import { SOUND_IDS, channelFor } from '@/client/audio/ids'
import { EMPTY_CONTEXT, EVENT_POLICY, WEAPON_SOUND, deathSound, factionOf, playEventSounds, soundsForEvent, weaponSound, type SoundContext } from '@/client/audio/eventSounds'
import { musicPlan } from '@/client/audio/music'
import { DEFAULT_AUDIO_SETTINGS, parseAudioSettings } from '@/client/audio/settings'
import { dataBundle } from '@/client/game/adapter'
import { playGame } from './support'

const ROOT = join(__dirname, '..', '..')
const AUDIO_DIR = join(ROOT, 'public', 'audio')
const mp3 = (id: string) => join(AUDIO_DIR, `${id}.mp3`)

const weapons = Object.values(dataBundle().byId).filter((r) => 'atk' in r && 'dmg' in r && isPresented(r)) as unknown as { id: string; name: string }[]

describe('audio assets', () => {
  it('SOUND_IDS is exactly the set of mp3 files in public/audio', () => {
    const files = readdirSync(AUDIO_DIR)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => f.replace(/\.mp3$/, ''))
      .sort()
    expect([...SOUND_IDS].sort()).toEqual(files)
  })

  it('every id has a measured trim', () => {
    const trims = JSON.parse(readFileSync(join(AUDIO_DIR, 'trims.json'), 'utf8')) as Record<string, number>
    expect(SOUND_IDS.filter((id) => !(id in trims))).toEqual([])
    for (const id of SOUND_IDS) expect(trims[id]).toBeGreaterThan(0)
  })

  it('routes narrator lines to the voice bus, music to the music bus, the rest to effects', () => {
    expect(channelFor('narr-victory')).toBe('voice')
    expect(channelFor('music-title')).toBe('music')
    expect(channelFor('wpn-slugga')).toBe('sfx')
  })
})

describe('weapon sounds', () => {
  it('both teams and the core list are present in the data', () => {
    expect(weapons.some((w) => w.id.startsWith('aod.'))).toBe(true)
    expect(weapons.some((w) => w.id.startsWith('kom.'))).toBe(true)
  })

  it('every weapon id maps explicitly to an mp3 that exists', () => {
    const missing = weapons.filter((w) => !(w.id in WEAPON_SOUND)).map((w) => w.id)
    expect(missing).toEqual([])
    for (const w of weapons) {
      const s = weaponSound(w.id)
      expect(existsSync(mp3(s.id)), `${w.id} -> ${s.id}`).toBe(true)
      expect(SOUND_IDS).toContain(s.id)
    }
  })

  it('has no stale weapon entries', () => {
    const ids = ALL_WEAPON_IDS
    expect(Object.keys(WEAPON_SOUND).filter((id) => !ids.has(id))).toEqual([])
  })

  it('an unknown weapon falls back to its flavour sound instead of failing', () => {
    expect(weaponSound('future.w.mega-flamer').id).toBe('wpn-hand-flamer')
    expect(weaponSound('future.w.thing').id).toBeTruthy()
  })
})

// ---------------------------------------------------------------- event policy

const eventsSource = readFileSync(join(ROOT, 'src', 'engine', 'events.ts'), 'utf8')
const EVENT_TYPES = [...eventsSource.matchAll(/\{\s*type: '([A-Za-z]+)'/g)].map((m) => m[1]!).filter((t, i, a) => a.indexOf(t) === i)

const base = { seq: 7, turningPoint: 1, phase: 'firefight', seat: 'A' } as const
const ev = (body: Record<string, unknown>) => ({ ...base, ...body }) as unknown as GameEvent

/** One representative event for every type whose policy is 'sound'. */
const SAMPLES: Record<string, GameEvent> = {
  TurningPointStarted: ev({ type: 'TurningPointStarted', number: 1 }),
  OperativeDeployed: ev({ type: 'OperativeDeployed', operativeId: 'A1', pos: { x: 0, y: 0, z: 0 } }),
  GambitUsed: ev({ type: 'GambitUsed', gambitId: 'g' }),
  PloyUsed: ev({ type: 'PloyUsed', ployId: 'p' }),
  OperativeTransformed: ev({ type: 'OperativeTransformed', operativeId: 'A1', from: 'cc.devotee', to: 'cc.mutant' }),
  OrderSet: ev({ type: 'OrderSet', operativeId: 'A1', order: 'engage' }),
  ApSpent: ev({ type: 'ApSpent', operativeId: 'A1', amount: 1, total: 1 }),
  Counteracted: ev({ type: 'Counteracted', operativeId: 'A1' }),
  OperativeMoved: ev({ type: 'OperativeMoved', operativeId: 'A1', action: 'reposition', from: {}, to: {}, segments: [{ kind: 'walk' }], cost: 2, maxInches: 6 }),
  DiceRerolled: ev({ type: 'DiceRerolled', side: 'attack', operativeId: 'A1', source: 'x', indexes: [0], before: [1], after: [5] }),
  DamageInflicted: ev({ type: 'DamageInflicted', operativeId: 'B1', sourceId: 'A1', amount: 3, source: 'normal', wounds: 4 }),
  Blocked: ev({ type: 'Blocked', operativeId: 'A1', die: 'normal', against: 'normal' }),
  OperativeIncapacitated: ev({ type: 'OperativeIncapacitated', operativeId: 'B1' }),
  MarkerPickedUp: ev({ type: 'MarkerPickedUp', markerId: 'm', operativeId: 'A1' }),
  MarkerPlaced: ev({ type: 'MarkerPlaced', markerId: 'm', operativeId: 'A1', pos: { x: 0, z: 0 } }),
  ObjectivePlaced: ev({ type: 'ObjectivePlaced', markerId: 'm', pos: { x: 0, z: 0 } }),
  EquipmentPlaced: ev({ type: 'EquipmentPlaced', equipmentId: 'e', key: 'k', pos: { x: 0, z: 0 }, yaw: 0, hidden: false }),
  MissionActionPerformed: ev({ type: 'MissionActionPerformed', operativeId: 'A1', action: 'ability:core.a.secure', markerId: 'm' }),
  KillGradeChanged: ev({ type: 'KillGradeChanged', grade: 1, kills: 2 }),
  MineTriggered: ev({ type: 'MineTriggered', markerId: 'm', operativeId: 'A1', damage: 2 }),
  DiceRolled: ev({ type: 'DiceRolled', purpose: 'setup.rollOff', dice: [3], final: true }),
}

describe('event sound policy', () => {
  it('the policy lists exactly the engine event types (events.ts)', () => {
    expect(EVENT_TYPES.length).toBeGreaterThan(60)
    expect(Object.keys(EVENT_POLICY).sort()).toEqual([...EVENT_TYPES].sort())
  })

  it('every event type has a sound or an explicit silence, and the policy tells the truth', () => {
    for (const [type, policy] of Object.entries(EVENT_POLICY)) {
      if (policy === 'sound') {
        const sample = SAMPLES[type]
        expect(sample, `a sample event for ${type}`).toBeTruthy()
        const out = soundsForEvent(sample!, EMPTY_CONTEXT)
        expect(out.length, `${type} should make a sound`).toBeGreaterThan(0)
        for (const s of out) expect(SOUND_IDS).toContain(s.id)
      } else if (policy === 'silent') {
        const out = soundsForEvent(ev({ type }), EMPTY_CONTEXT)
        expect(out, `${type} is silent`).toEqual([])
      }
    }
  })

  it('maps the shot to the weapon, once, and the fight start to both weapons', () => {
    const shot = ev({ type: 'AttackDiceRolled', operativeId: 'A1', targetId: 'B1', weaponId: 'aod.w.bolt-rifle', dice: [4], kinds: ['normal'], need: 3, lethal: null })
    expect(soundsForEvent(shot, { ...EMPTY_CONTEXT, mode: 'shoot' }).map((s) => s.id)).toEqual(['wpn-bolt-rifle'])
    // the same dice event in a fight is silent (FightStarted voices the weapons)
    expect(soundsForEvent(shot, { ...EMPTY_CONTEXT, mode: 'fight' })).toEqual([])
    const fight = ev({ type: 'FightStarted', operativeId: 'A1', targetId: 'B1', attackerWeapon: 'aod.w.chainsword-assault', defenderWeapon: 'kom.w.choppa' })
    expect(soundsForEvent(fight, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['wpn-chainsword-rev', 'wpn-choppa'])
  })

  it('every roll gets the rattle and the land', () => {
    expect(soundsForEvent(SAMPLES.DiceRolled!, EMPTY_CONTEXT).map((s) => s.id)).toEqual(['ui-dice-rattle', 'ui-dice-land'])
  })

  it('the narrator speaks on the big moments only', () => {
    const voice = (e: GameEvent, c: SoundContext = EMPTY_CONTEXT) => soundsForEvent(e, c).filter((s) => channelFor(s.id) === 'voice').map((s) => s.id)
    expect(voice(ev({ type: 'PhaseStarted', name: 'strategy' }))).toEqual(['narr-strategy-phase'])
    expect(voice(ev({ type: 'PhaseStarted', name: 'firefight' }))).toEqual(['narr-firefight-phase'])
    expect(voice(ev({ type: 'TurningPointStarted', number: 1 }))).toEqual(['narr-turning-point-one'])
    expect(voice(ev({ type: 'TurningPointStarted', number: 2 }))).toEqual([])
    expect(voice(ev({ type: 'TurningPointStarted', number: 4 }))).toEqual(['narr-final-turning-point'])
    expect(voice(ev({ type: 'OperativeIncapacitated', operativeId: 'B1' }))).toEqual(['narr-operative-down'])
    expect(voice(ev({ type: 'Counteracted', operativeId: 'A1' }))).toEqual(['narr-counteract'])
    expect(voice(ev({ type: 'MissionActionPerformed', operativeId: 'A1', action: 'ability:core.a.secure', markerId: 'm' }))).toEqual(['narr-objective-secured'])
    expect(voice(ev({ type: 'GameEnded', result: { winner: 'A', vp: { A: 3, B: 1 }, reason: 'turningPoint', placeholder: false } }), { ...EMPTY_CONTEXT, perspective: 'A' })).toEqual(['narr-victory'])
    expect(voice(ev({ type: 'GameEnded', result: { winner: 'B', vp: { A: 1, B: 3 }, reason: 'turningPoint', placeholder: false } }), { ...EMPTY_CONTEXT, perspective: 'A' })).toEqual(['narr-defeat'])
    expect(voice(ev({ type: 'GameEnded', result: { winner: 'draw', vp: { A: 1, B: 1 }, reason: 'turningPoint', placeholder: false } }))).toEqual(['narr-draw'])
  })

  it('victory and defeat stings follow the viewing seat', () => {
    const win = ev({ type: 'GameEnded', result: { winner: 'B', vp: { A: 0, B: 2 }, reason: 'resign', placeholder: false } })
    expect(soundsForEvent(win, { ...EMPTY_CONTEXT, perspective: 'B' })[0]!.id).toBe('ui-victory-sting')
    expect(soundsForEvent(win, { ...EMPTY_CONTEXT, perspective: 'A' })[0]!.id).toBe('ui-defeat-sting')
  })

  it('plays through any play function', () => {
    const heard: string[] = []
    playEventSounds((id) => heard.push(id), [SAMPLES.DiceRolled!, SAMPLES.OrderSet!], EMPTY_CONTEXT)
    expect(heard).toEqual(['ui-dice-rattle', 'ui-dice-land', 'ui-order-engage'])
  })
})

// ---------------------------------------------------------------- a real game

describe('a whole game on the real engine', () => {
  it('only ever asks for ids that exist, and uses every family', () => {
    const heard = new Set<string>()
    const kindsSeen = new Set<string>()
    let mode: SoundContext['mode'] = null
    const listen = ({ state, events }: { state: GameState; events: GameEvent[] }) => {
      for (const e of events) {
        if (e.type === 'ShootStarted') mode = 'shoot'
        if (e.type === 'FightStarted') mode = 'fight'
        for (const s of soundsForEvent(e, { state, perspective: 'A', mode, fight: null })) {
          expect(SOUND_IDS).toContain(s.id)
          heard.add(s.id)
        }
        if (e.type === 'ShootEnded' || e.type === 'FightEnded') mode = null
        kindsSeen.add(e.type)
      }
    }
    const { final, steps } = playGame({ seed: 'audio-1', maxSteps: 2500 }, listen)
    // a seed whose game happens to end with nobody killed is topped up with a second game
    if (![...heard].some((i) => i.startsWith('death-'))) playGame({ seed: 'audio-2', maxSteps: 2500 }, listen)
    expect(steps).toBeGreaterThan(200)
    expect(final.seq).toBeGreaterThan(200)
    const ids = [...heard]
    expect(ids.some((i) => i.startsWith('wpn-'))).toBe(true)
    expect(ids).toContain('ui-dice-rattle')
    expect(ids.some((i) => i.startsWith('death-'))).toBe(true)
    expect(ids).toContain('narr-strategy-phase')
    expect(ids).toContain('narr-firefight-phase')
    expect(ids).toContain('ui-turning-point-sting')
    expect(ids.some((i) => i.startsWith('move-'))).toBe(true)
    expect(ids).toContain('ui-order-engage')
    expect(ids).toContain('ui-cp-gained')
  }, 120000)

  it('deaths follow the dying operative: marines and orks die differently', () => {
    let state: GameState | null = null
    playGame({ seed: 'audio-2', maxSteps: 40 }, (s) => {
      state = s.state
    })
    const ops = Object.values(state!.operatives)
    const marine = ops.find((o) => o.seat === 'A')!
    const ork = ops.find((o) => o.seat === 'B')!
    expect(factionOf(state, marine.id)).toBe('marine')
    expect(['ork', 'grot', 'squig']).toContain(factionOf(state, ork.id))
    const marineDeaths = new Set([0, 1, 2, 3].map((n) => deathSound('marine', n)))
    const orkDeaths = new Set([0, 1, 2, 3].map((n) => deathSound('ork', n)))
    for (const id of marineDeaths) expect(id.startsWith('death-marine')).toBe(true)
    for (const id of orkDeaths) expect(id.startsWith('death-ork')).toBe(true)
    expect(deathSound('grot', 1)).toBe('death-grot')
    expect(deathSound('squig', 1)).toBe('death-squig')
  })
})

// ---------------------------------------------------------------- batch A teams

/** A minimal state: one operative per seat with the given datacard keywords. */
function stubState(a: string[], b: string[]): GameState {
  return {
    operatives: { A1: { id: 'A1', seat: 'A', datacardId: 'dcA' }, B1: { id: 'B1', seat: 'B', datacardId: 'dcB' } },
    data: { datacards: { dcA: { keywords: a }, dcB: { keywords: b } } },
  } as unknown as GameState
}

const TEAM_KEYWORDS: Record<string, { kw: string[]; faction: string; death: string; initiative: string | null }> = {
  drone: { kw: ['PATHFINDER', "T'AU EMPIRE", 'DRONE', 'MB3 RECON'], faction: 'drone', death: 'death-drone', initiative: 'narr-initiative-pf' },
  tau: { kw: ['PATHFINDER', "T'AU EMPIRE", "SHAS'LA"], faction: 'tau', death: 'death-tau', initiative: 'narr-initiative-pf' },
  necron: { kw: ['HIEROTEK CIRCLE', 'NECRON', 'IMMORTAL'], faction: 'necron', death: 'death-necron', initiative: 'narr-initiative-ht' },
  plague: { kw: ['PLAGUE MARINE', 'CHAOS', 'HERETIC ASTARTES', 'FIGHTER'], faction: 'plague', death: 'death-plague', initiative: 'narr-initiative-pm' },
  cultist: { kw: ['WYRMBLADE', 'TYRANIDS', 'GENESTEALER CULTS'], faction: 'cultist', death: 'death-cultist', initiative: 'narr-initiative-wb' },
  marine: { kw: ['ADEPTUS ASTARTES', 'ANGEL OF DEATH'], faction: 'marine', death: 'death-marine', initiative: 'narr-initiative-aod' },
  ork: { kw: ['ORK', 'KOMMANDO'], faction: 'ork', death: 'death-ork', initiative: 'narr-initiative-kom' },
}

describe('batch A team sounds (Pathfinders, Hierotek Circle, Plague Marines, Wyrmblade)', () => {
  it('sorts operatives into factions by keyword, and deaths and initiative lines follow', () => {
    for (const [name, t] of Object.entries(TEAM_KEYWORDS)) {
      const state = stubState(t.kw, ['ORK'])
      expect(factionOf(state, 'A1'), name).toBe(t.faction)
      const death = soundsForEvent(ev({ type: 'OperativeIncapacitated', operativeId: 'A1', seq: 1 }), { ...EMPTY_CONTEXT, state })
      expect(death[0]!.id.startsWith(t.death), name).toBe(true)
      const init = soundsForEvent(ev({ type: 'InitiativeDecided', holder: 'A', setup: false }), { ...EMPTY_CONTEXT, state })
      expect(init.map((s) => s.id), name).toContain(t.initiative)
    }
    expect(factionOf(stubState(['SOMETHING ELSE'], []), 'A1')).toBe('other')
  })

  it('every new team death, initiative and effect id exists as an mp3', () => {
    const ids = ['death-drone', 'death-tau', 'death-necron', 'death-plague', 'death-cultist', 'fx-reanimate', 'fx-ambush-emerge', 'ui-markerlight', 'fx-flies-swarm', 'fx-plague-bell', 'shout-brood-hiss', 'narr-initiative-pf', 'narr-initiative-ht', 'narr-initiative-pm', 'narr-initiative-wb']
    for (const id of ids) {
      expect(SOUND_IDS).toContain(id)
      expect(existsSync(mp3(id)), id).toBe(true)
    }
  })

  it('a reanimated or emerging operative gets its sting; other returns are silent', () => {
    const back = (kind: string) => soundsForEvent(ev({ type: 'OperativeReturned', operativeId: 'A1', pos: { x: 0, y: 0, z: 0 }, wounds: 1, ready: true, kind }), EMPTY_CONTEXT).map((s) => s.id)
    expect(back('reanimated')).toEqual(['fx-reanimate'])
    expect(back('emerge')).toEqual(['fx-ambush-emerge'])
    expect(back('somethingElse')).toEqual([])
  })

  it('gaining a markerlight token pings; losing one or other tokens does not', () => {
    const token = (kind: string, delta: number) => soundsForEvent(ev({ type: 'TokenChanged', operativeId: 'B1', kind, owner: 'A', count: 1, delta, reason: 'markerlight' }), EMPTY_CONTEXT).map((s) => s.id)
    expect(token('pf.markerlight', 1)).toEqual(['ui-markerlight'])
    expect(token('pf.markerlight', -1)).toEqual([])
    expect(token('other.token', 1)).toEqual([])
  })

  it('Plague Marine and Wyrmblade moments add their effect on top of the ploy click', () => {
    const ploy = (ployId: string) => soundsForEvent(ev({ type: 'PloyUsed', ployId }), EMPTY_CONTEXT).map((s) => s.id)
    expect(ploy('pm.p.cloud-of-flies')).toEqual(['ui-order-engage', 'fx-flies-swarm'])
    expect(ploy('pm.p.contagion')).toEqual(['ui-order-engage', 'fx-plague-bell'])
    expect(ploy('other.p.x')).toEqual(['ui-order-engage'])
    const ability = (abilityId: string) => soundsForEvent(ev({ type: 'AbilityUsed', operativeId: 'A1', abilityId }), EMPTY_CONTEXT).map((s) => s.id)
    expect(ability('wyr.a.quicksilver-strike')).toEqual(['shout-brood-hiss'])
    expect(ability('pm.a.icon-of-contagion')).toEqual(['fx-plague-bell'])
    expect(ability('aod.a.optics')).toEqual([])
  })

  it('a Wyrmblade interrupt hisses', () => {
    const state = stubState(TEAM_KEYWORDS.cultist!.kw, ['ORK'])
    expect(soundsForEvent(ev({ type: 'GuardInterrupt', operativeId: 'A1' }), { ...EMPTY_CONTEXT, state }).map((s) => s.id)).toEqual(['shout-brood-hiss'])
  })
})

// ---------------------------------------------------------------- music and settings

describe('music plan', () => {
  const battle = (over: Partial<Parameters<typeof musicPlan>[0]>) =>
    musicPlan({ screen: 'battle', phase: 'firefight', turningPoint: 1, vp: { A: 0, B: 0 }, result: null, perspective: 'A', ...over })

  it('plays the title on the menus and during set-up', () => {
    expect(musicPlan({ screen: 'start', phase: null, turningPoint: 0, vp: null, result: null, perspective: 'A' }).id).toBe('music-title')
    expect(battle({ phase: 'setup', turningPoint: 0 }).id).toBe('music-title')
  })

  it('alternates battle-a and battle-b per turning point', () => {
    expect(battle({ turningPoint: 1 }).id).toBe('music-battle-a')
    expect(battle({ turningPoint: 2 }).id).toBe('music-battle-b')
    expect(battle({ turningPoint: 3 }).id).toBe('music-battle-a')
    expect(battle({ turningPoint: 2 }).rate).toBe(1)
  })

  it('goes tense (1.07 rate) when 3+ VP behind or in the last turning point', () => {
    expect(battle({ turningPoint: 2, vp: { A: 0, B: 3 } })).toMatchObject({ id: 'music-battle-b', rate: 1.07, tense: true })
    expect(battle({ turningPoint: 2, vp: { A: 1, B: 3 } }).rate).toBe(1)
    expect(battle({ turningPoint: 2, vp: { A: 5, B: 0 } }).rate).toBe(1)
    expect(battle({ turningPoint: 4 })).toMatchObject({ rate: 1.07, tense: true })
  })

  it('ends with the victory or defeat piece, played once', () => {
    const won = battle({ phase: 'ended', turningPoint: 4, result: { winner: 'A', vp: { A: 4, B: 2 }, reason: 'turningPoint', placeholder: false } })
    expect(won).toMatchObject({ id: 'music-victory', loop: false })
    const lost = battle({ phase: 'ended', turningPoint: 4, result: { winner: 'B', vp: { A: 1, B: 2 }, reason: 'turningPoint', placeholder: false } })
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

