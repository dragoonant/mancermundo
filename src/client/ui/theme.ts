// Shared inline-style tokens for src/client/ui/** — no CSS framework, matches App.tsx's existing
// dark overlay look (see the M0 title style) and Scene's #0a0a10 background.
import type { CSSProperties } from 'react'

export const fontStack = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export const colors = {
  bg: 'rgba(14, 15, 22, 0.92)',
  bgSolid: '#12131c',
  border: 'rgba(255, 255, 255, 0.12)',
  text: '#e8e8f2',
  muted: '#9aa0b8',
  accent: '#f5d95a',
  accentText: '#1a1a12',
  danger: '#ff6a5f',
  playerA: '#4fb0ff',
  playerB: '#ff6a4f',
}

export const panel: CSSProperties = {
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  color: colors.text,
  fontFamily: fontStack,
  boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
  backdropFilter: 'blur(6px)',
}

export const buttonBase: CSSProperties = {
  fontFamily: fontStack,
  fontSize: 13,
  fontWeight: 600,
  color: colors.text,
  background: 'rgba(255,255,255,0.08)',
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '7px 12px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export const buttonActive: CSSProperties = {
  ...buttonBase,
  background: colors.accent,
  color: colors.accentText,
  border: `1px solid ${colors.accent}`,
}

export const buttonPrimary: CSSProperties = {
  ...buttonBase,
  background: colors.accent,
  color: colors.accentText,
  border: `1px solid ${colors.accent}`,
  fontSize: 14,
}

export const buttonDanger: CSSProperties = {
  ...buttonBase,
  color: colors.danger,
  border: '1px solid rgba(255,106,95,0.5)',
}

export const mutedText: CSSProperties = { color: colors.muted, fontSize: 12 }

export const scrollList: CSSProperties = {
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}
