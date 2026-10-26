// Volume and mute settings, persisted in localStorage so a player's mix survives a reload. Every access is
// guarded: private windows and node tests have no storage.
export interface AudioSettings {
  master: number
  sfx: number
  voice: number
  music: number
  muted: boolean
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.9, sfx: 1, voice: 0.9, music: 0.5, muted: false }

export const AUDIO_SETTINGS_KEY = 'mancermundo.audio.v1'

const clamp01 = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback)

export function parseAudioSettings(raw: string | null): AudioSettings {
  if (!raw) return { ...DEFAULT_AUDIO_SETTINGS }
  try {
    const p = JSON.parse(raw) as Partial<AudioSettings>
    return {
      master: clamp01(p.master, DEFAULT_AUDIO_SETTINGS.master),
      sfx: clamp01(p.sfx, DEFAULT_AUDIO_SETTINGS.sfx),
      voice: clamp01(p.voice, DEFAULT_AUDIO_SETTINGS.voice),
      music: clamp01(p.music, DEFAULT_AUDIO_SETTINGS.music),
      muted: p.muted === true,
    }
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS }
  }
}

export function loadAudioSettings(): AudioSettings {
  try {
    return parseAudioSettings(typeof localStorage === 'undefined' ? null : localStorage.getItem(AUDIO_SETTINGS_KEY))
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS }
  }
}

export function saveAudioSettings(s: AudioSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* best effort */
  }
}
