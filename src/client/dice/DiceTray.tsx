// Dice tray: the attack pool and the defence pool side by side (in a fight: both fighters), critical successes
// glowing, re-rolled dice badged, blocks animated as pairs, strikes landing, and a one-line summary per pool
// so a big batch reads at a glance. Docked in the right rail under the dice log (BattleScreen); on a phone
// it floats under the HUD. It renders what the director has presented so far, never more.
import { useEffect, type CSSProperties } from 'react'
import { colors, fontStack, panel } from '../ui/theme'
import { useFormFactor } from '../ui/formFactor'
import { Keyword, KeywordText } from '../ui/Keyword'
import { seatColor } from '../ui/widgets'
import { poolSummary, useTray, type TrayDie, type TrayPool } from './trayStore'

const STYLE_ID = 'ms-dice-tray-style'

function injectStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes ms-tray-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
    @keyframes ms-die-tumble { 0% { transform: rotate(-200deg) scale(0.3); opacity: 0 } 70% { transform: rotate(14deg) scale(1.12); opacity: 1 } 100% { transform: none } }
    @keyframes ms-die-pair { 0% { box-shadow: 0 0 0 0 rgba(120,200,255,0.9) } 100% { box-shadow: 0 0 0 9px rgba(120,200,255,0) } }
    @keyframes ms-die-strike { 0% { transform: scale(1.5); filter: brightness(2) } 100% { transform: none; filter: none } }
    @keyframes ms-die-crit { 0%,100% { box-shadow: 0 0 6px 1px rgba(245,217,90,0.7) } 50% { box-shadow: 0 0 13px 4px rgba(245,217,90,0.95) } }
  `
  document.head.appendChild(style)
}

function dieStyle(d: TrayDie, size: number): CSSProperties {
  const crit = d.kind === 'crit'
  const fail = d.kind === 'fail'
  const base: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: Math.round(size / 5),
    background: crit ? colors.accent : fail ? '#4b4f5c' : '#e8e8f2',
    color: fail ? '#aeb2c0' : '#14141c',
    font: `800 ${Math.round(size * 0.55)}px ${fontStack}`,
    border: '1px solid rgba(0,0,0,0.45)',
    animation: 'ms-die-tumble 340ms ease-out',
    opacity: fail ? 0.65 : 1,
  }
  if (crit && !d.spent) base.animation = 'ms-die-tumble 340ms ease-out, ms-die-crit 1.4s ease-in-out 340ms infinite'
  if (d.spent === 'blocked') return { ...base, opacity: 0.4, outline: '2px solid #7fc8ff', animation: 'ms-die-pair 700ms ease-out' }
  if (d.spent === 'blocking') return { ...base, outline: '2px solid #7fc8ff', animation: 'ms-die-pair 700ms ease-out' }
  if (d.spent === 'struck') return { ...base, outline: '2px solid #ff6a5f', animation: 'ms-die-strike 420ms ease-out' }
  return base
}

function TrayDieView({ d, size, i }: { d: TrayDie; size: number; i: number }) {
  const mark = d.spent === 'blocked' ? 'x' : d.spent === 'blocking' ? 'B' : d.spent === 'struck' ? '!' : null
  return (
    <span data-testid="tray-die" data-kind={d.kind} data-spent={d.spent ?? ''} data-rerolled={d.rerolled ? '1' : '0'} data-pair={d.pair ?? ''} style={dieStyle(d, size)} aria-label={`die ${i + 1}: ${d.value ?? 'kept'} (${d.kind})`}>
      {d.value ?? '·'}
      {d.rerolled && (
        <span style={{ position: 'absolute', top: -5, right: -4, fontSize: 10, background: '#2b3c66', color: '#cfe0ff', borderRadius: 6, padding: '0 3px', lineHeight: '12px', fontWeight: 800 }}>
          re
        </span>
      )}
      {mark && (
        <span
          style={{
            position: 'absolute',
            bottom: -5,
            right: -4,
            fontSize: 10,
            lineHeight: '12px',
            fontWeight: 800,
            borderRadius: 6,
            padding: '0 3px',
            background: d.spent === 'struck' ? '#7a2018' : '#1f4a73',
            color: '#fff',
          }}
        >
          {mark}
        </span>
      )}
    </span>
  )
}

function Pool({ pool, testId }: { pool: TrayPool | null; testId: string }) {
  if (!pool) {
    return (
      <div data-testid={testId} style={{ flex: 1, minWidth: 0, opacity: 0.35, fontSize: 12, textAlign: 'center', padding: '6px 0' }}>
        {testId === 'tray-def' ? 'Defence' : 'Attack'}
      </div>
    )
  }
  const n = pool.dice.length
  const size = n > 10 ? 18 : n > 6 ? 22 : 28
  return (
    <div data-testid={testId} data-side={pool.side} style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, marginBottom: 4, minWidth: 0 }}>
        {pool.seat && <span style={{ width: 8, height: 8, borderRadius: 4, background: seatColor(pool.seat), flex: '0 0 auto' }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pool.label}</span>
        <span style={{ color: colors.muted, fontWeight: 600, flex: '0 0 auto', pointerEvents: 'auto' }}>
          <Keyword term={pool.word}>{pool.word}</Keyword> {pool.need}+
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {pool.dice.map((d, i) => (
          <TrayDieView key={`${i}-${d.value}-${d.rerolled ? 'r' : ''}`} d={d} size={size} i={i} />
        ))}
      </div>
      <div data-testid={`${testId}-summary`} style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
        <span style={{ pointerEvents: 'auto' }}>
          <KeywordText text={poolSummary(pool)} />
        </span>
      </div>
    </div>
  )
}

export function DiceTray() {
  const tray = useTray()
  const compact = useFormFactor().compact
  useEffect(injectStyle, [])
  if (!tray.atk) return null
  const style: CSSProperties = {
    ...panel,
    padding: '8px 10px 10px',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    fontFamily: fontStack,
    animation: 'ms-tray-in 180ms ease-out',
    ...(compact ? { position: 'absolute', top: 60, left: 8, width: 'min(300px, 52vw)', zIndex: 35 } : { width: '100%', flex: '0 0 auto' }),
  }
  return (
    <div data-testid="dice-tray" data-mode={tray.mode ?? ''} style={style}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>{tray.title}</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Pool pool={tray.atk} testId="tray-atk" />
        <div style={{ width: 1, alignSelf: 'stretch', background: colors.border }} />
        <Pool pool={tray.def} testId="tray-def" />
      </div>
      {tray.note && (
        <div data-testid="tray-note" style={{ fontSize: 12, marginTop: 6, textAlign: 'center', color: colors.text }}>
          {tray.note}
        </div>
      )}
    </div>
  )
}
