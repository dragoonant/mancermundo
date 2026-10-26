// Small building blocks shared by the dedicated decision prompts: header, verdict pill, option card, dice row.
import type { CSSProperties, ReactNode } from 'react'
import type { PendingDecision } from '@/engine'
import { lookupTerm } from '../game/glossary'
import { decisionInfo } from '../game/labels'
import type { BadgeKind, DieView } from '../game/promptLabels'
import { KeywordText } from './Keyword'
import { colors, fontStack } from './theme'
import { Tooltip } from './Tooltip'
import { useFormFactor } from './formFactor'
import { Dot, Die, Muted } from './widgets'

/** The one-line "why this matters" under a prompt's hint. */
export function Why({ text }: { text?: string }) {
  if (!text) return null
  return (
    <div data-testid="prompt-why" style={{ fontSize: 12, color: colors.accent, marginTop: 3 }}>
      Why it matters: <span style={{ color: colors.text }}><KeywordText text={text} /></span>
    </div>
  )
}

export function PromptHeader({ pending, hint, title }: { pending: PendingDecision; hint?: string; title?: string }) {
  const info = decisionInfo(pending.kind)
  const compact = useFormFactor().compact
  // on a phone the sheet header already names the decision: keep the hint and the reason
  if (compact) {
    return (
      <div style={{ marginBottom: 6 }}>
        <Muted><KeywordText text={hint ?? info.hint} keywords={false} /></Muted>
        <Why text={info.why} />
      </div>
    )
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }} data-testid="prompt-title">
        <Dot seat={pending.seat} />
        {title ?? info.title}
      </div>
      <Muted><KeywordText text={hint ?? info.hint} keywords={false} /></Muted>
      <Why text={info.why} />
    </div>
  )
}

const PILL: Record<BadgeKind, { bg: string; fg: string }> = {
  valid: { bg: 'rgba(109,255,154,0.18)', fg: '#6dff9a' },
  cover: { bg: 'rgba(255,179,71,0.2)', fg: '#ffb347' },
  improved: { bg: 'rgba(255,140,60,0.22)', fg: '#ff9a3c' },
  obscured: { bg: 'rgba(197,140,255,0.2)', fg: '#c58cff' },
  choice: { bg: 'rgba(197,140,255,0.2)', fg: '#c58cff' },
  unseen: { bg: 'rgba(138,143,159,0.2)', fg: '#a3a8b8' },
}

export function Pill({ kind, label, meaning }: { kind: BadgeKind; label: string; meaning?: string }) {
  const c = PILL[kind]
  const pill = (
    <span
      data-testid="verdict-pill"
      data-verdict={kind}
      style={{ display: 'inline-block', background: c.bg, color: c.fg, border: `1px solid ${c.fg}55`, borderRadius: 10, padding: '0 8px', fontSize: 11, fontWeight: 800, letterSpacing: 0.2 }}
    >
      {label}
    </span>
  )
  // the verdict's own sentence (engine odds context) plus what the term means in the rules, when the glossary knows the label
  const rule = lookupTerm(label)
  const body = meaning ? (
    <>
      {meaning}
      {rule && <div style={{ marginTop: 4, color: colors.muted }}>{rule.body}</div>}
    </>
  ) : rule ? (
    rule.body
  ) : null
  return body ? <Tooltip title={label} body={body}>{pill}</Tooltip> : pill
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
  }
}

export function DiceRow({ dice, small, highlight, label }: { dice: DieView[]; small?: boolean; highlight?: number[]; label?: string }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }} data-testid="prompt-dice-row">
      {label && <span style={{ color: colors.muted, fontSize: 12, marginRight: 2 }}><KeywordText text={label} /></span>}
      {dice.map((d, i) => (
        <span
          key={i}
          data-kind={d.kind}
          data-used={d.used ? '1' : '0'}
          style={{
            opacity: d.used ? 0.3 : d.kind === 'fail' ? 0.6 : 1,
            outline: highlight?.includes(i) ? '2px solid #7fc8ff' : undefined,
            outlineOffset: 1,
            borderRadius: 7,
            textDecoration: d.used ? 'line-through' : undefined,
          }}
        >
          <Die n={d.value} small={small} kind={d.kind} />
        </span>
      ))}
    </div>
  )
}

/** A row of identical little dice for counts only (attack hits against defence saves). */
export function CountDice({ normal, crit, label }: { normal: number; crit: number; label: string }) {
  const dice: DieView[] = [...Array.from({ length: crit }, () => ({ value: null, kind: 'crit' as const, used: false })), ...Array.from({ length: normal }, () => ({ value: null, kind: 'normal' as const, used: false }))]
  return (
    <div>
      <div style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>
        <KeywordText text={`${label}: ${normal} normal, ${crit} critical`} />
      </div>
      <DiceRow dice={dice} small />
    </div>
  )
}

export function Section({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      {title && <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>{title}</div>}
      {children}
    </div>
  )
}
