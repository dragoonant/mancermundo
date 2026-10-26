// Public surface of the client audio module: one AudioManager per page, the event mapper, the music
// director and the settings hook.
import { useCallback, useSyncExternalStore } from 'react'

import type { AudioSettings } from './settings'
import type { SoundChannel } from './ids'

import { audio } from './instance'

export { audio }

export { AudioManager } from './manager'
export type { MusicRequest, PlayOptions } from './manager'
export type { AudioSettings } from './settings'
export { DEFAULT_AUDIO_SETTINGS } from './settings'
export { SOUND_IDS, audioUrl, channelFor } from './ids'
export type { SoundId, SoundChannel, MusicId } from './ids'
export { soundsForEvent, playEventSounds, weaponSound, EVENT_POLICY, EMPTY_CONTEXT } from './eventSounds'
export type { SoundContext, EventSound } from './eventSounds'
export { musicPlan, startMusicDirector } from './music'

/** React binding for the persisted volume and mute settings. */
export function useAudioSettings(): {
  settings: AudioSettings
  setVolume: (channel: 'master' | SoundChannel, value: number) => void
  setMuted: (muted: boolean) => void
} {
  const settings = useSyncExternalStore(
    useCallback((onChange: () => void) => audio.onSettingsChange(onChange), []),
    () => audio.getSettings(),
    () => audio.getSettings(),
  )
  const setVolume = useCallback((c: 'master' | SoundChannel, v: number) => audio.setVolume(c, v), [])
  const setMuted = useCallback((m: boolean) => audio.setMuted(m), [])
  return { settings, setVolume, setMuted }
}

/** UI click sound on any button press (capture phase, so it fires even when a handler stops propagation). */
let clicksInstalled = false
export function installClickSounds(): void {
  if (clicksInstalled || typeof document === 'undefined') return
  clicksInstalled = true
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('button:not(:disabled)')) audio.play('ui-ap-spend', { volume: 0.45 })
    },
    true,
  )
}
