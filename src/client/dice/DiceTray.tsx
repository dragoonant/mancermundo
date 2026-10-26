// Dice tray: one row per step of the attack as the director plays it (hit, wound, save, Injury dice, Firepower dice, Ammo test,
// scatter). Normal dice show pips; the Firepower dice show bullets and an Ammo symbol; the Injury dice show a drop (Flesh
// Wound), a fallen figure (Seriously Injured) or a skull (Out of Action). Everything is read off the events - the tray never
// rolls. Docked in the right rail under the fighter card; on a phone it floats under the HUD.
import { useEffect, type CSSProperties } from 'react'
import { colors, fontStack, panel } from '../ui/theme'
import { CollapseButton, CollapsedTab, useCollapsed } from '../ui/collapse'
import { useFormFactor } from '../ui/formFactor'
import { seatColor } from '../ui/widgets'
import { useTray, type TrayDie, type TrayRow, type TrayState, type Tone } from './trayStore'

const STYLE_ID = 'ms-dice-tray-style'

function injectStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes ms-tray-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
    @keyframes ms-die-tumble { 0% { transform: rotate(-200deg) scale(0.3); opacity: 0 } 70% { transform: rotate(14deg) scale(1.12); opacity: 1 } 100% { transform: none } }
    @keyframes ms-row-in { from { opacity: 0; transform: translateX(10px) } to { opacity: 1; transform: none } }
  `
  document.head.appendChild(style)
}

// where the pips sit on a 3 x 3 grid, by result
const PIP_CELLS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

const TONE_COLOR: Record<Tone, string> = { pass: '#8be28b', fail: '#ff8a7f', info: colors.text }

function Pips({ n, ink }: { n: number; ink: string }) {
  const cells = PIP_CELLS[n] ?? []
  return (
    <svg viewBox="0 0 30 30" width="100%" height="100%" aria-hidden>
      {cells.map((c) => (
        <circle key={c} cx={7 + (c % 3) * 8} cy={7 + Math.floor(c / 3) * 8} r={2.9} fill={ink} />
      ))}
      {n > 6 && (
        <text x="15" y="21" textAnchor="middle" fontSize="16" fontWeight="800" fill={ink}>
          {n}
        </text>
      )}
    </svg>
  )
}

/** Firepower face: one to three bullets, and an Ammo symbol (a magazine with a spent round) on the face that forces an Ammo test. */
function FirepowerGlyph({ face }: { face: string }) {
  const m = /^hit(\d)(\+ammo)?$/.exec(face)
  const hits = m ? Number(m[1]) : 0
  const ammo = !!m?.[2]
  // the Ammo symbol takes the top right corner: the bullets shift left to make room
  const xs = ammo ? (hits === 1 ? [8] : hits === 2 ? [7, 14] : [5, 11, 17]) : hits === 1 ? [15] : hits === 2 ? [10, 20] : [7, 15, 23]
  return (
    <svg viewBox="0 0 30 30" width="100%" height="100%" aria-hidden>
      {xs.map((x, i) => (
        <g key={i}>
          <path d={`M${x - 2.4} 21 V12 Q${x} 5 ${x + 2.4} 12 V21 Z`} fill="#c98a2c" />
          <rect x={x - 2.4} y="21" width="4.8" height="3.4" rx="0.6" fill="#e6c26a" />
        </g>
      ))}
      {ammo && (
        <g>
          <rect x="17" y="2.5" width="11" height="9.5" rx="1.6" fill="#1a1a22" stroke="#d8443a" strokeWidth="1.4" />
          <path d="M19.4 9.8 L22.5 4.4 L25.6 9.8 Z" fill="#ff6a5f" />
        </g>
      )}
    </svg>
  )
}

/** Injury face: drop (Flesh Wound), fallen figure (Seriously Injured), skull (Out of Action). */
function InjuryGlyph({ face }: { face: string }) {
  if (face === 'outOfAction') {
    return (
      <svg viewBox="0 0 30 30" width="100%" height="100%" aria-hidden>
        <path d="M15 3.5 C8.4 3.5 5.6 8 5.6 12.6 C5.6 16 7.3 17.6 9 18.8 V23.5 H21 V18.8 C22.7 17.6 24.4 16 24.4 12.6 C24.4 8 21.6 3.5 15 3.5 Z" fill="#f2efe6" />
        <circle cx="11" cy="13" r="2.8" fill="#1a1a22" />
        <circle cx="19" cy="13" r="2.8" fill="#1a1a22" />
        <path d="M15 16 L13.6 19 H16.4 Z" fill="#1a1a22" />
        <path d="M12.6 23.5 V26.5 M15 23.5 V26.5 M17.4 23.5 V26.5" stroke="#f2efe6" strokeWidth="1.6" />
      </svg>
    )
  }
  if (face === 'seriouslyInjured') {
    return (
      <svg viewBox="0 0 30 30" width="100%" height="100%" aria-hidden>
        <circle cx="6.5" cy="17" r="3" fill="#e5a14a" />
        <rect x="10" y="14.5" width="12" height="5" rx="2.2" fill="#e5a14a" />
        <path d="M21 15 L27 11.5 M21 19 L27 22.5" stroke="#e5a14a" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M5 26 H25" stroke="#8a6a3a" strokeWidth="1.6" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 30 30" width="100%" height="100%" aria-hidden>
      <path d="M15 3.5 C15 3.5 6.5 13 6.5 18.2 A8.5 8.5 0 0 0 23.5 18.2 C23.5 13 15 3.5 15 3.5 Z" fill="#d6342a" />
      <path d="M11 19 A4.2 4.2 0 0 0 14.2 23" stroke="#ffb3a8" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}

const INJURY_SHORT: Record<string, string> = { fleshWound: 'Flesh', seriouslyInjured: 'Down', outOfAction: 'OoA' }

function dieBox(d: TrayDie, size: number): CSSProperties {
  const base: CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    flex: '0 0 auto',
    width: size,
    height: size,
    boxSizing: 'border-box',
    borderRadius: Math.round(size / 5),
    border: '1px solid rgba(0,0,0,0.55)',
    animation: 'ms-die-tumble 340ms ease-out',
  }
  if (d.shape === 'pips') {
    return { ...base, background: d.ok === false ? '#4b4f5c' : '#f3f3fb', opacity: d.ok === false ? 0.7 : 1, boxShadow: d.ok === true ? '0 0 0 2px rgba(139,226,139,0.75)' : 'none' }
  }
  if (d.shape === 'firepower') return { ...base, background: '#2c241a', border: '1px solid #8a5a1c' }
  return { ...base, background: '#241a1c', border: '1px solid #6a3a3a' }
}

function TrayDieView({ d, size, i }: { d: TrayDie; size: number; i: number }) {
  const label = d.shape === 'pips' ? `die ${i + 1}: ${d.value}` : `${d.shape} die ${i + 1}: ${d.face}`
  return (
    <span data-testid="tray-die" data-shape={d.shape} data-value={d.value ?? ''} data-face={d.face ?? ''} data-ok={d.ok === null ? '' : d.ok ? '1' : '0'} style={dieBox(d, size)} aria-label={label}>
      {d.shape === 'pips' && <Pips n={d.value ?? 0} ink={d.ok === false ? '#aeb2c0' : '#14141c'} />}
      {d.shape === 'firepower' && <FirepowerGlyph face={d.face ?? ''} />}
      {d.shape === 'injury' && <InjuryGlyph face={d.face ?? ''} />}
    </span>
  )
}

/** The scatter arrow: engine bearings run from +z (towards the camera, screen down) round towards +x (screen right). */
function ScatterArrow({ degrees }: { degrees: number }) {
  return (
    <span data-testid="tray-scatter" data-direction={Math.round(degrees)} style={{ display: 'inline-block', width: 30, height: 30, borderRadius: 15, background: '#1d2a38', border: '1px solid #3b5a7a', animation: 'ms-die-tumble 340ms ease-out' }}>
      <svg viewBox="0 0 30 30" width="100%" height="100%" aria-hidden style={{ transform: `rotate(${180 - degrees}deg)` }}>
        <path d="M15 4 L21 14 H17 V25 H13 V14 H9 Z" fill="#7fc8ff" />
      </svg>
    </span>
  )
}

function Row({ row }: { row: TrayRow }) {
  const n = row.dice.length
  const size = n > 8 ? 22 : n > 5 ? 26 : 30
  // a held save is the defender's win: blue, not the green of an attacker's success
  const verdictColor = row.kind === 'save' && row.tone === 'pass' ? '#9fe3ff' : TONE_COLOR[row.tone]
  return (
    <div data-testid="tray-row" data-kind={row.kind} data-tone={row.tone} style={{ animation: 'ms-row-in 200ms ease-out', padding: '5px 0', borderTop: `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, fontSize: 12, minWidth: 0 }}>
        {row.seat && <span style={{ width: 8, height: 8, borderRadius: 4, background: seatColor(row.seat), flex: '0 0 auto', alignSelf: 'center' }} />}
        <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{row.label}</span>
        {row.need !== null && <span style={{ color: colors.muted, flex: '0 0 auto' }}>{row.need}+</span>}
        {row.who && <span style={{ color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{row.who}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
          {row.arrow !== undefined && <ScatterArrow degrees={row.arrow} />}
          {row.dice.map((d, i) => (
            <span key={i} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <TrayDieView d={d} size={size} i={i} />
              {d.shape === 'injury' && <span style={{ fontSize: 9, color: colors.muted }}>{INJURY_SHORT[d.face ?? ''] ?? ''}</span>}
            </span>
          ))}
        </div>
        <span data-testid="tray-verdict" style={{ fontSize: 12, fontWeight: 800, color: verdictColor, textAlign: 'right', flex: '0 0 auto', maxWidth: '45%' }}>
          {row.verdict}
        </span>
      </div>
    </div>
  )
}

/** The tray box. Only the DOM view folds: the director writes trayStore on its own beats and never waits on this. */
export function DiceTrayView({ tray, compact }: { tray: TrayState; compact: boolean }) {
  const [collapsed] = useCollapsed('dicetray')
  if (tray.rows.length === 0) return null
  if (collapsed) {
    return <CollapsedTab id="dicetray" title="Dice tray" style={compact ? { position: 'absolute', top: 60, left: 8, zIndex: 35 } : { alignSelf: 'flex-end', flex: '0 0 auto' }} />
  }
  const style: CSSProperties = {
    ...panel,
    padding: '8px 10px 6px',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    fontFamily: fontStack,
    animation: 'ms-tray-in 180ms ease-out',
    ...(compact ? { position: 'absolute', top: 60, left: 8, width: 'min(300px, 52vw)', zIndex: 35 } : { width: 288, maxWidth: '100%', flex: '0 0 auto' }),
  }
  return (
    <div data-testid="dice-tray" style={style}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, paddingLeft: 2 }}>{tray.title}</div>
        <CollapseButton id="dicetray" title="dice tray" style={{ pointerEvents: 'auto', flex: '0 0 auto' }} />
      </div>
      {tray.rows.map((r) => (
        <Row key={r.id} row={r} />
      ))}
    </div>
  )
}

export function DiceTray() {
  const tray = useTray()
  const compact = useFormFactor().compact
  useEffect(injectStyle, [])
  return <DiceTrayView tray={tray} compact={compact} />
}
