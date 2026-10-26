// "Turn your phone sideways" overlay: shown only on a phone held in portrait while a game is on screen
// (App mounts it in the in-game branch, so the start screen / army picker stay usable in portrait).
import type { CSSProperties } from 'react'
import { colors, fontStack } from './theme'
import { useFormFactor } from './formFactor'

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 20,
  padding: 'var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)',
  boxSizing: 'border-box',
  background: '#0a0a10',
  color: colors.text,
  fontFamily: fontStack,
  textAlign: 'center',
  pointerEvents: 'auto',
  touchAction: 'none',
}

const css = `
@keyframes rp-turn { 0%, 25% { transform: rotate(0deg); } 65%, 100% { transform: rotate(-90deg); } }
.rp-phone { animation: rp-turn 2.4s ease-in-out infinite; transform-origin: 50% 50%; }
@media (prefers-reduced-motion: reduce) { .rp-phone { animation: none; transform: rotate(-90deg); } }
`

export function RotatePrompt() {
  const { phone, portrait } = useFormFactor()
  if (!phone || !portrait) return null
  return (
    <div style={overlay} data-testid="rotate-prompt" role="alert">
      <style>{css}</style>
      <svg className="rp-phone" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
        <rect x="29" y="10" width="38" height="76" rx="8" fill="none" stroke={colors.accent} strokeWidth="4" />
        <line x1="42" y1="18" x2="54" y2="18" stroke={colors.accent} strokeWidth="3" strokeLinecap="round" />
        <circle cx="48" cy="77" r="3" fill={colors.accent} />
      </svg>
      <div style={{ fontSize: 20, fontWeight: 600, maxWidth: 260, lineHeight: 1.3 }}>Turn your phone sideways to play</div>
    </div>
  )
}
