// The battle screen: canvas, HUD, event feed, fighter card, decision prompt, banner and toasts. Phase changes and the Priority
// roll show as short banners; a plain result panel takes over when the battle is over and presented (S5c brings the full end screen).
import { useEffect, type CSSProperties } from 'react'
import { BoardCanvas } from '../board/Board'
import { cancelDecision, rotateFacing } from '../interaction/controller'
import { gangName } from '../game/labels'
import { useAnnouncementStore } from '../presentation/announceStore'
import { useFeedStore } from '../presentation/feedStore'
import { useDisplayState, useSettled } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { useSession } from '../store/session'
import { BattleHud } from './BattleHud'
import { DecisionPrompt } from './DecisionPrompt'
import { EventFeed } from './EventFeed'
import { FighterStrip } from './FighterStrip'
import { RotatePrompt } from './RotatePrompt'
import { useFormFactor } from './formFactor'
import { colors, fontStack, panel } from './theme'
import { useUi } from './uiStore'
import { Btn, Die, seatColor } from './widgets'

function Banner() {
  const a = useAnnouncementStore((s) => s.current)
  if (!a) return null
  return (
    <div
      key={a.id}
      data-testid="banner"
      style={{
        ...panel,
        position: 'absolute',
        top: '28%',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '12px 26px',
        textAlign: 'center',
        borderTop: `4px solid ${a.seat ? seatColor(a.seat) : colors.accent}`,
        fontFamily: fontStack,
        pointerEvents: 'none',
        zIndex: 40,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 20 }}>{a.title}</div>
      {a.subtitle && <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{a.subtitle}</div>}
      {a.dice && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8 }}>
          {a.dice.map((n, i) => (
            <Die key={i} n={n} kind={a.kinds?.[i]} />
          ))}
        </div>
      )}
    </div>
  )
}

function Toasts() {
  const toasts = useFeedStore((s) => s.toasts)
  return (
    <div style={{ position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 70, pointerEvents: 'none' }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          data-kind={t.kind}
          style={{ ...panel, padding: '6px 14px', fontSize: 13, fontFamily: fontStack, borderLeft: `4px solid ${t.kind === 'error' ? colors.danger : t.kind === 'warn' ? colors.accent : colors.muted}`, maxWidth: 440 }}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

/** A plain result panel (S5c replaces it with the end screen: casualties, points by source, replay). */
function ResultPanel() {
  const state = useDisplayState()
  const swapSeats = useSession((s) => s.swapSeats)
  const backToMenu = useSession((s) => s.backToMenu)
  if (!state?.result) return null
  const r = state.result
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(5,5,10,0.55)', zIndex: 60, fontFamily: fontStack }}>
      <div data-testid="result" style={{ ...panel, padding: '20px 28px', textAlign: 'center', minWidth: 300, borderTop: `4px solid ${r.winner === 'draw' ? colors.accent : seatColor(r.winner)}` }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{r.winner === 'draw' ? 'A draw' : `${gangName(state, r.winner)} wins`}</div>
        <div style={{ color: colors.muted, margin: '6px 0 14px', fontSize: 13 }}>
          {gangName(state, 'A')} {r.points.A} - {r.points.B} {gangName(state, 'B')} · {r.reason === 'scenario' ? 'by the scenario' : r.reason === 'roundLimit' ? 'at the round limit' : r.reason}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Btn variant="primary" data-testid="rematch" onClick={swapSeats}>Rematch (swap sides)</Btn>
          <Btn data-testid="to-menu" onClick={backToMenu}>Main menu</Btn>
        </div>
      </div>
    </div>
  )
}

export function BattleScreen() {
  const state = useDisplayState()
  const settled = useSettled()
  const ff = useFormFactor()
  const showCard = useUi((s) => s.selected !== null || s.hoverFighter !== null)
  // keyboard: Escape cancels a pending move, Q / E turn the facing a fighter is deployed with
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (e.key === 'Escape') {
        if (!cancelDecision()) useUi.setState({ selected: null })
      } else if (e.key === 'q' || e.key === 'Q') rotateFacing(-Math.PI / 4)
      else if (e.key === 'e' || e.key === 'E') rotateFacing(Math.PI / 4)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // a new decision clears the per-decision UI state (facing, hovered option, door focus)
  const decisionId = useGame((s) => s.pending?.id)
  useEffect(() => {
    useUi.getState().resetDecision()
  }, [decisionId])
  const over = !!state && state.phase === 'ended' && settled
  const column: CSSProperties = { position: 'absolute', left: 8, bottom: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 15, pointerEvents: 'none', maxWidth: 'calc(100vw - 16px)' }
  const rail: CSSProperties = { position: 'absolute', top: ff.compact ? 120 : 76, right: 8, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 20, pointerEvents: 'none' }
  return (
    <div data-testid="battle" data-phase={state?.phase} data-round={state?.round} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0a0a10' }}>
      <BoardCanvas />
      <div style={{ position: 'absolute', inset: 0, padding: 'var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)', pointerEvents: 'none' }}>
        <BattleHud />
        {!ff.compact && (
          <div style={column}>
            <EventFeed />
          </div>
        )}
        {showCard && (
          <div style={rail}>
            <FighterStrip />
          </div>
        )}
        <DecisionPrompt />
        <Banner />
        <Toasts />
      </div>
      <RotatePrompt />
      {over && <ResultPanel />}
    </div>
  )
}
