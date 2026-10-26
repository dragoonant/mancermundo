// Top bar: both seats (team, CP, VP, operatives left), turning point, phase and initiative, plus panel
// toggles and camera buttons. Reads the DISPLAY state so numbers never show before the director reaches them.
// On touch devices the system overlay covers the top-right corner (about 110 x 120 CSS px, not in the safe-area
// insets), so there the bar leaves that corner free and the buttons sit in a toolbar row under the bar on the left,
// followed by the sight-line chip; the measure and sight-line panels open below that row.
import type { CSSProperties } from 'react'
import type { Seat } from '@/engine'
import { dataBundle } from '../game/adapter'
import { poolLabel, TEAM_PRESENTATION } from '../teams'
import { humanize } from '../game/labels'
import { useDisplayState } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { useFormFactor } from './formFactor'
import { OVERLAY_W, touchToolbar } from './hudLayout'
import { MeasureButton, MeasurePanel } from './MeasureTool'
import { SightlineChip, SightlinePanel } from './SightlinePanel'
import { colors, fontStack, panel } from './theme'
import { Keyword } from './Keyword'
import { useUi, type DrawerId } from './uiStore'
import { Btn, seatColor } from './widgets'

const barStyle: CSSProperties = {
  ...panel,
  position: 'absolute',
  top: 8,
  left: 8,
  right: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 8px',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  fontFamily: fontStack,
  zIndex: 20,
}

/** The seat's team pools (Faith...) as [kind, value]: the kinds the team declares show from the start, even at 0. */
export function poolEntries(teamId: string, pools: Record<string, number> | undefined): [string, number][] {
  const out = new Map<string, number>()
  for (const kind of Object.keys(TEAM_PRESENTATION[teamId]?.pools ?? {})) out.set(kind, 0)
  for (const [kind, value] of Object.entries(pools ?? {})) out.set(kind, value)
  return [...out]
}

function SeatBlock({ seat }: { seat: Seat }) {
  const state = useDisplayState()
  const mode = useGame((g) => g.seats[seat])
  const compact = useFormFactor().compact
  if (!state) return null
  const p = state.players[seat]
  const team = dataBundle().teams[p.teamId]
  const ops = Object.values(state.operatives).filter((o) => o.seat === seat)
  const alive = ops.filter((o) => o.status !== 'removed').length
  const holder = state.initiative === seat
  return (
    <div data-testid={`hud-seat-${seat}`} style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: `4px solid ${seatColor(seat)}`, paddingLeft: 8, minWidth: 0 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {compact ? seat : `${seat} · ${team?.name ?? p.teamId}`} {mode === 'bot' && <span style={{ color: colors.muted, fontWeight: 500 }}>(bot)</span>}
          {holder && (
            <span data-testid={`hud-initiative-${seat}`} style={{ marginLeft: 6, color: colors.accent }}>
              <Keyword term="Initiative">{'★'}</Keyword>
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: colors.muted, whiteSpace: 'nowrap' }}>
          <span data-testid={`hud-cp-${seat}`} style={{ color: colors.text, fontWeight: 700 }}>
            <Keyword term="CP" /> {p.cp}
          </span>
          {' · '}
          <span data-testid={`hud-vp-${seat}`} style={{ color: colors.text, fontWeight: 700 }}>
            <Keyword term="VP" /> {p.vp}
          </span>
          {poolEntries(p.teamId, p.pools).map(([kind, value]) => (
            <span key={kind} data-testid={`hud-pool-${seat}-${kind}`} style={{ color: colors.text, fontWeight: 700 }}>
              {' · '}
              <Keyword term={poolLabel(kind)} /> {value}
            </span>
          ))}
          {' · '}
          <span data-testid={`hud-ops-${seat}`}>
            {alive}/{ops.length} ops
          </span>
        </div>
      </div>
    </div>
  )
}

export function Hud() {
  const state = useDisplayState()
  const ff = useFormFactor()
  const drawer = useUi((s) => s.drawer)
  const panels = useUi((s) => s.panels)
  if (!state) return null
  const phase = state.phase === 'setup' ? humanize(state.setup.step) : humanize(state.phase)
  const touch = ff.touch
  const toggle = (id: Exclude<DrawerId, 'card'>, label: string, testId: string) => {
    const on = ff.compact ? drawer === id : id === 'settings' ? drawer === 'settings' : panels[id as 'feed' | 'log' | 'mission']
    return (
      <Btn
        key={id}
        data-testid={testId}
        variant={on ? 'active' : 'base'}
        style={{ padding: ff.compact ? '4px 6px' : touch ? '5px 10px' : '4px 8px', fontSize: ff.compact ? 11 : 12 }}
        onClick={() => (ff.compact || id === 'settings' ? useUi.getState().toggleDrawer(id) : useUi.getState().togglePanel(id as 'feed' | 'log' | 'mission'))}
      >
        {label}
      </Btn>
    )
  }
  const buttons = (
    <>
      <MeasureButton compact={ff.compact} />
      {toggle('mission', 'Mission', 'btn-mission')}
      {toggle('feed', 'Feed', 'btn-feed')}
      {toggle('log', 'Dice', 'btn-log')}
      {toggle('settings', 'Menu', 'btn-settings')}
    </>
  )
  const bar: CSSProperties = touch ? { ...barStyle, right: `calc(8px + ${OVERLAY_W}px + var(--safe-right))` } : barStyle
  const tb = touchToolbar(ff.compact)
  return (
    <>
    <SightlinePanel />
    <MeasurePanel />
    <div data-testid="hud" className="ms-touch" style={bar}>
      <SeatBlock seat="A" />
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <div data-testid="hud-tp" style={{ fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap' }}>
          {state.turningPoint > 0 ? (
            <>
              <Keyword term="Turning point">{ff.compact ? 'TP' : 'Turning point'}</Keyword> {state.turningPoint}/4
            </>
          ) : (
            'Set-up'
          )}
        </div>
        <div data-testid="hud-phase" style={{ fontSize: 12, color: colors.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {phase}
          {state.initiative ? (
            <>
              {' · '}
              <Keyword term="Initiative">initiative</Keyword> {state.initiative}
            </>
          ) : (
            ''
          )}
        </div>
      </div>
      <SeatBlock seat="B" />
      {!touch && <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>{buttons}</div>}
    </div>
    {touch && (
      <div
        data-testid="hud-toolbar"
        className="ms-touch"
        style={{ position: 'absolute', top: tb.top, left: 8, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none', zIndex: 21, fontFamily: fontStack }}
      >
        <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', pointerEvents: 'auto' }}>{buttons}</div>
        <SightlineChip inline />
      </div>
    )}
    </>
  )
}
