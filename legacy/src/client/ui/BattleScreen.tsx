// The battle screen: canvas, HUD, side panels, decision prompt, banner and toasts. Phase transitions and
// dice rolls show as short banners; the end screen takes over when the battle is over and presented.
import type { CSSProperties } from 'react'
import { BoardCanvas } from '../board/Board'
import { DiceTray } from '../dice/DiceTray'
import { useAnnouncementStore } from '../presentation/announceStore'
import { useFeedStore } from '../presentation/feedStore'
import { useDisplayState, useSettled } from '../presentation/presentedStore'
import { DecisionPrompt } from './DecisionPrompt'
import { EndScreen } from './EndScreen'
import { useBoardTip } from './markerInfo'
import { PointTooltip } from './Tooltip'
import { HiddenTray } from './HiddenTray'
import { Hud } from './Hud'
import { DiceLog, EventFeed, MissionPanel, OperativeCard, SettingsPanel } from './Panels'
import { RotatePrompt } from './RotatePrompt'
import { useFormFactor } from './formFactor'
import { OVERLAY_H, touchToolbar } from './hudLayout'
import { colors, fontStack, panel } from './theme'
import { Die, seatColor } from './widgets'

/** Tooltip for the marker the pointer is over on the board (order token, AP pips, wound bar). */
function BoardTooltip() {
  const tip = useBoardTip((s) => s.tip)
  if (!tip) return null
  return <PointTooltip x={tip.x} y={tip.y} title={tip.title} body={tip.body} />
}

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
        top: '30%',
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
          style={{
            ...panel,
            padding: '6px 14px',
            fontSize: 13,
            fontFamily: fontStack,
            borderLeft: `4px solid ${t.kind === 'error' ? colors.danger : t.kind === 'warn' ? colors.accent : colors.muted}`,
            maxWidth: 440,
          }}
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
  const column: CSSProperties = {
    position: 'absolute',
    left: 8,
    width: 270,
    bottom: 10,
    maxHeight: '58vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    gap: 6,
    pointerEvents: 'none',
    zIndex: 15,
    overflow: 'hidden',
  }
  const rail: CSSProperties = {
    position: 'absolute',
    top: ff.touch ? OVERLAY_H : 66,
    right: 8,
    bottom: 10,
    width: 290,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    pointerEvents: 'none',
    zIndex: 20,
    overflow: 'hidden',
  }
  const over = !!state && state.phase === 'ended' && settled
  return (
    <div data-testid="battle" data-phase={state?.phase} data-tp={state?.turningPoint} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0a0a10' }}>
      <BoardCanvas />
      <div style={{ position: 'absolute', inset: 0, padding: 'var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)', pointerEvents: 'none' }}>
        <Hud />
        {!ff.compact && (
          <>
            <div style={column}>
              <MissionPanel />
              <EventFeed />
            </div>
            <div style={rail} data-testid="right-rail">
              <OperativeCard docked />
              <div style={{ flex: 1 }} />
              <DiceLog />
              <DiceTray />
            </div>
          </>
        )}
        {ff.compact && (
          <>
            <MissionPanel />
            <EventFeed />
            <DiceLog />
            <DiceTray />
            {/* the one-line operative strip pins itself top-right (y 62): on touch it moves below the system overlay */}
            <div style={{ position: 'absolute', inset: 0, top: ff.touch ? OVERLAY_H - 66 : 0, pointerEvents: 'none' }}>
              <OperativeCard />
            </div>
          </>
        )}
        {/* pins itself at y 62, left: on touch it moves below the HUD toolbar row */}
        <div style={{ position: 'absolute', inset: 0, top: ff.touch ? touchToolbar(ff.compact).below - 62 : 0, pointerEvents: 'none' }}>
          <HiddenTray />
        </div>
        <SettingsPanel />
        <DecisionPrompt />
        <Banner />
        <Toasts />
        <BoardTooltip />
      </div>
      <RotatePrompt />
      {over && <EndScreen />}
    </div>
  )
}
