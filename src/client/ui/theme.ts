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

// ---- the underhive look of the menu screens (start, gangs, briefing, end): rust and brass on soot, hazard stripes, grating
export const hive = {
  soot: '#0b0a0c',
  steel: '#1a1a1f',
  rust: '#b4531f',
  rustDark: '#6e2f12',
  brass: '#d6a23a',
  chalk: '#e6dccb',
}

/** The page backdrop: a dark vignette with a faint grating, fixed behind the content. */
export const hivePage: CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflowY: 'auto',
  color: colors.text,
  fontFamily: fontStack,
  background: [
    'radial-gradient(ellipse at 50% -10%, rgba(180,83,31,0.28) 0%, rgba(11,10,12,0) 55%)',
    'repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 2px, rgba(0,0,0,0) 2px 14px)',
    'repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 2px, rgba(0,0,0,0) 2px 14px)',
    hive.soot,
  ].join(', '),
}

/** A yellow-and-black hazard rule, 8px tall. */
export const hazardStripe: CSSProperties = {
  height: 8,
  borderRadius: 2,
  background: `repeating-linear-gradient(-45deg, ${hive.brass} 0 10px, #15130f 10px 20px)`,
  opacity: 0.85,
}

/** A raised metal plate for menu sections. */
export const plate: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(34,33,38,0.96), rgba(22,21,26,0.96))',
  border: '1px solid rgba(214,162,58,0.22)',
  borderRadius: 8,
  boxShadow: '0 4px 18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
  color: colors.text,
  fontFamily: fontStack,
  boxSizing: 'border-box',
}

export const sectionTitle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: hive.brass,
  fontWeight: 800,
}
