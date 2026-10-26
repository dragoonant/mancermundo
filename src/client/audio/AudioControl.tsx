// The sound control: a small button in the bottom-right corner of every screen (mute toggle) that opens volume sliders for the
// master mix, effects, voice and music. Settings persist through the AudioManager (localStorage, guarded).
import { useState, type CSSProperties } from 'react'
import { Btn } from '../ui/widgets'
import { colors, fontStack, panel } from '../ui/theme'
import { useAudioSettings } from './index'
import type { SoundChannel } from './ids'

const CHANNELS: { id: 'master' | SoundChannel; label: string }[] = [
  { id: 'master', label: 'Master' },
  { id: 'sfx', label: 'Effects' },
  { id: 'voice', label: 'Voice' },
  { id: 'music', label: 'Music' },
]

const dock: CSSProperties = { position: 'fixed', right: 'max(8px, var(--safe-right, 0px))', bottom: 'max(8px, var(--safe-bottom, 0px))', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, fontFamily: fontStack }

export function AudioControl() {
  const { settings, setVolume, setMuted } = useAudioSettings()
  const [open, setOpen] = useState(false)
  return (
    <div className="ms-touch" data-testid="audio-control" style={dock}>
      {open && (
        <div style={{ ...panel, padding: '8px 12px', display: 'grid', gridTemplateColumns: 'auto 120px', gap: '6px 10px', alignItems: 'center', fontSize: 12 }}>
          {CHANNELS.map((c) => (
            <label key={c.id} style={{ display: 'contents' }}>
              <span style={{ color: colors.muted }}>{c.label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(settings[c.id] * 100)}
                aria-label={`${c.label} volume`}
                data-testid={`volume-${c.id}`}
                onChange={(e) => setVolume(c.id, Number(e.target.value) / 100)}
              />
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        {open && (
          <Btn data-testid="audio-mute" variant={settings.muted ? 'danger' : 'base'} onClick={() => setMuted(!settings.muted)}>
            {settings.muted ? 'Unmute' : 'Mute'}
          </Btn>
        )}
        <Btn data-testid="audio-toggle" variant={open ? 'active' : 'base'} aria-label="Sound settings" onClick={() => setOpen(!open)}>
          {settings.muted ? 'Sound off' : 'Sound'}
        </Btn>
      </div>
    </div>
  )
}
