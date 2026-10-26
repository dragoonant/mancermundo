// The battle screen: canvas, HUD, event feed, fighter card, decision prompt, banner and toasts. Phase changes and the Priority
// roll show as short banners; the end screen takes over when the battle is over and presented.
import { useEffect, type CSSProperties } from 'react'
import { BoardCanvas } from '../board/Board'
import { DiceTray } from '../dice/DiceTray'
import { cancelDecision, rotateFacing } from '../interaction/controller'
import { useAnnouncementStore } from '../presentation/announceStore'
import { useFeedStore } from '../presentation/feedStore'
import { useDisplayState, useSettled } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { BattleHud } from './BattleHud'
import { CasualtyTray } from './CasualtyTray'
import { DecisionPrompt } from './DecisionPrompt'
import { EndScreen } from './EndScreen'
import { EventFeed } from './EventFeed'
import { FighterStrip } from './FighterStrip'
import { RotatePrompt } from './RotatePrompt'
import { ScenarioPanel } from './ScenarioPanel'
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
  const rail: CSSProperties = { position: 'absolute', top: ff.compact ? 112 : 76, right: 8, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 20, pointerEvents: 'none' }
  return (
    <div data-testid="battle" data-phase={state?.phase} data-round={state?.round} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0a0a10' }}>
      <BoardCanvas />
      <div style={{ position: 'absolute', inset: 0, padding: 'var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)', pointerEvents: 'none' }}>
        <BattleHud />
        <CasualtyTray />
        <ScenarioPanel />
        {!ff.compact && (
          <div style={column}>
            <EventFeed />
          </div>
        )}
        <div style={rail}>
          {showCard && <FighterStrip />}
          <DiceTray />
        </div>
        <DecisionPrompt />
        <Banner />
        <Toasts />
      </div>
      <RotatePrompt />
      {over && <EndScreen />}
    </div>
  )
}
