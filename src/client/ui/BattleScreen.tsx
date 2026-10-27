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
import { isWatching } from '../store/pacing'
import { BattleHud } from './BattleHud'
import { BotDecisionCard } from './BotDecisionCard'
import { WatchControls } from './WatchControls'
import { Tooltip } from './Tooltip'
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
import { Die, seatColor } from './widgets'

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

/** The one button that stays when the panels are hidden (H does the same). 44 px on a phone. */
function UiToggle() {
  const hidden = useUi((s) => s.uiHidden)
  const ff = useFormFactor()
  const size = ff.compact ? 44 : 36
  return (
    <div style={{ position: 'absolute', left: 'max(8px, var(--safe-left, 0px))', bottom: 'max(8px, var(--safe-bottom, 0px))', zIndex: 60, pointerEvents: 'auto' }}>
      <Tooltip title={hidden ? 'Show the panels' : 'Hide the panels'} body="Hides every text window so only the board is left. Press H, or this button, to bring them back." placement="right">
        <button
          type="button"
          data-testid="ui-toggle"
          aria-label={hidden ? 'Show the panels' : 'Hide the panels'}
          aria-pressed={hidden}
          onClick={() => useUi.getState().toggleUi()}
          style={{ ...panel, width: size, height: size, minHeight: size, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer', color: hidden ? colors.accent : colors.text }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
            {hidden && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}

/** With the panels hidden and a human to decide, one small reminder so the game never looks stuck. */
function YourMoveChip() {
  const hidden = useUi((s) => s.uiHidden)
  const pending = useGame((s) => s.pending)
  const seats = useGame((s) => s.seats)
  const over = useGame((s) => s.state?.phase === 'ended')
  const settled = useSettled()
  if (!hidden || !pending || over || !settled || seats[pending.seat] !== 'human') return null
  return (
    <div data-testid="ui-chip" style={{ ...panel, position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)', padding: '5px 12px', fontSize: 12, color: colors.muted, pointerEvents: 'none', zIndex: 59, borderTop: `3px solid ${seatColor(pending.seat)}`, whiteSpace: 'nowrap' }}>
      Your move: press H to show
    </div>
  )
}

export function BattleScreen() {
  const state = useDisplayState()
  const settled = useSettled()
  const ff = useFormFactor()
  const showCard = useUi((s) => s.selected !== null || s.hoverFighter !== null)
  const hidden = useUi((s) => s.uiHidden)
  const watching = useGame((s) => isWatching(s.seats))
  // keyboard: H hides or shows every panel, Escape cancels a pending move, Q / E turn the facing a fighter is deployed with
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable)) return
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) useUi.getState().toggleUi()
      else if (e.key === 'Escape') {
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
  const column: CSSProperties = { position: 'absolute', left: 8, bottom: ff.compact ? 60 : 52, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 15, pointerEvents: 'none', maxWidth: 'calc(100vw - 16px)' }
  const rail: CSSProperties = { position: 'absolute', top: ff.compact ? 112 : 76, right: 8, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 20, pointerEvents: 'none' }
  return (
    <div data-testid="battle" data-phase={state?.phase} data-round={state?.round} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0a0a10' }}>
      <BoardCanvas />
      <div style={{ position: 'absolute', inset: 0, padding: 'var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)', pointerEvents: 'none' }}>
        {/* one flag hides every panel: they stay mounted (their state and effects keep running), only the display goes */}
        <div data-testid="panels" data-hidden={hidden ? '1' : '0'} style={hidden ? { display: 'none' } : { display: 'contents' }}>
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
          {/* nobody to prompt in a watched game: the decision card says what the AI is doing */}
          {!watching && <DecisionPrompt />}
          {watching && (
            <div style={{ position: 'absolute', left: '50%', bottom: ff.compact ? 6 : 12, transform: 'translateX(-50%)', width: 'max-content', maxWidth: ff.compact ? 'calc(100% - 150px)' : 'calc(100% - 24px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, zIndex: 32, pointerEvents: 'none' }}>
              <BotDecisionCard />
              <WatchControls />
            </div>
          )}
          <Banner />
          <Toasts />
        </div>
        <YourMoveChip />
        <UiToggle />
      </div>
      <RotatePrompt />
      {over && <EndScreen />}
    </div>
  )
}
