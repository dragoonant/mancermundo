// Small shared UI pieces: panel, buttons, AP pips, seat chip. Inline styles from theme.ts (no CSS framework).
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import type { Seat } from '@/engine'
import { buttonActive, buttonBase, buttonDanger, buttonPrimary, colors, mutedText, panel } from './theme'

export const seatColor = (seat: Seat): string => (seat === 'A' ? colors.playerA : colors.playerB)

export function Panel({ children, style, testId, ...rest }: { children: ReactNode; style?: CSSProperties; testId?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-testid={testId} style={{ ...panel, padding: 10, boxSizing: 'border-box', pointerEvents: 'auto', ...style }} {...rest}>
      {children}
    </div>
  )
}

type Variant = 'base' | 'primary' | 'active' | 'danger'
const VARIANT: Record<Variant, CSSProperties> = { base: buttonBase, primary: buttonPrimary, active: buttonActive, danger: buttonDanger }

export function Btn({ variant = 'base', style, children, ...rest }: { variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const disabled = rest.disabled
  return (
    <button
      type="button"
      {...rest}
      style={{ ...VARIANT[variant], ...(disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}), ...style }}
    >
      {children}
    </button>
  )
}

export function ApPips({ total, left }: { total: number; left: number }) {
  return (
    <span aria-label={`${left} of ${total} AP left`} style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{ width: 10, height: 10, borderRadius: 5, background: i < left ? colors.accent : '#33343c', border: '1px solid rgba(255,255,255,0.25)' }} />
      ))}
    </span>
  )
}

export function Muted({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...mutedText, ...style }}>{children}</div>
}

export function Dot({ seat }: { seat: Seat }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: seatColor(seat), marginRight: 6 }} />
}

export function Die({ n, small, kind }: { n: number | null; small?: boolean; kind?: string }) {
  const s = small ? 20 : 30
  const hit = kind ? kind === 'crit' : n === 6
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: s,
        height: s,
        borderRadius: 6,
        background: hit ? colors.accent : kind === 'fail' ? '#6b6f7c' : '#e8e8f2',
        color: '#14141c',
        font: `800 ${small ? 12 : 17}px system-ui`,
        border: '1px solid rgba(0,0,0,0.4)',
      }}
    >
      {n ?? '·'}
    </span>
  )
}
