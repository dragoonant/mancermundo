// Small building blocks shared by the dedicated decision prompts: the "why it matters" line, odds chips, verdict pills, option cards.
import type { CSSProperties, ReactNode } from 'react'
import { lookupTerm } from '../game/glossary'
import { Keyword, KeywordText } from './Keyword'
import { Tooltip } from './Tooltip'
import { colors, fontStack } from './theme'

/** The one-line "why this matters" under a prompt's hint. */
export function Why({ text }: { text?: string }) {
  if (!text) return null
  return (
    <div data-testid="prompt-why" style={{ fontSize: 12, color: colors.accent, marginTop: 3, lineHeight: 1.35 }}>
      Why it matters: <span style={{ color: colors.text }}><KeywordText text={text} /></span>
    </div>
  )
}

export type PillKind = 'good' | 'warn' | 'bad' | 'info' | 'muted'

const PILL: Record<PillKind, { bg: string; fg: string }> = {
  good: { bg: 'rgba(109,255,154,0.16)', fg: '#6dff9a' },
  warn: { bg: 'rgba(255,179,71,0.18)', fg: '#ffb347' },
  bad: { bg: 'rgba(255,106,95,0.18)', fg: '#ff8a7a' },
  info: { bg: 'rgba(127,200,255,0.16)', fg: '#7fc8ff' },
  muted: { bg: 'rgba(138,143,159,0.18)', fg: '#a3a8b8' },
}

/** A small rounded verdict label. `term` links the glossary entry when the label is a rules term; `meaning` adds the engine's own sentence. */
export function Pill({ kind, label, term, meaning }: { kind: PillKind; label: string; term?: string; meaning?: ReactNode }) {
  const c = PILL[kind]
  const pill = (
    <span
      data-testid="verdict-pill"
      data-verdict={kind}
      style={{ display: 'inline-block', background: c.bg, color: c.fg, border: `1px solid ${c.fg}55`, borderRadius: 10, padding: '0 8px', fontSize: 11, fontWeight: 800, letterSpacing: 0.2, whiteSpace: 'nowrap' }}
    >
      {label}
    </span>
  )
  const rule = term ? lookupTerm(term) : null
  const body = meaning ? (
    <>
      {meaning}
      {rule && <div style={{ marginTop: 4, color: colors.muted }}>{rule.body}</div>}
    </>
  ) : rule ? (
    rule.body
  ) : null
  return body ? <Tooltip title={term ?? label} body={body}>{pill}</Tooltip> : pill
}

/** One odds figure: a label (a keyword), the big number, and a smaller second line (what the dice need). */
export function OddsChip({ label, term, value, sub, tone = 'base', testId }: { label: string; term?: string; value: string; sub?: string; tone?: 'base' | 'good' | 'bad'; testId?: string }) {
  const color = tone === 'good' ? '#7fe3a0' : tone === 'bad' ? '#ff8a7a' : colors.text
  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 52, padding: '2px 4px', background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}>
      <span style={{ fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{term ? <Keyword term={term}>{label}</Keyword> : label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color, lineHeight: 1.15 }}>{value}</span>
      {sub && <span style={{ fontSize: 10, color: colors.muted }}>{sub}</span>}
    </div>
  )
}

export function cardStyle(opts: { primary?: boolean; disabled?: boolean } = {}): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    cursor: opts.disabled ? 'not-allowed' : 'pointer',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${opts.primary ? colors.accent : colors.border}`,
    background: opts.primary ? 'rgba(245,217,90,0.12)' : 'rgba(255,255,255,0.05)',
    color: colors.text,
    fontFamily: fontStack,
    opacity: opts.disabled ? 0.5 : 1,
    boxSizing: 'border-box',
  }
}

export function Section({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      {title && <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>{title}</div>}
      {children}
    </div>
  )
}
