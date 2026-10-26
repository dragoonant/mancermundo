// The battle HUD: round, phase and Priority, whose turn it is and who is activating, the two gangs' standing / down / out of
// action counts and points, camera presets and the menu. Reads the DISPLAY state, so nothing shows before it has been played.
import type { CSSProperties } from 'react'
import { useDisplayState } from '../presentation/presentedStore'
import type { GameState, Seat } from '@/engine'
import { useGame } from '../store/game'
import { useSession } from '../store/session'
import { gangName } from '../game/labels'
import { colors, fontStack, panel } from './theme'
import { useUi } from './uiStore'
import { ApPips, Btn, seatColor } from './widgets'

const PHASE_NAME: Record<GameState['phase'], string> = { setup: 'Set-up', priority: 'Priority phase', action: 'Action phase', end: 'End phase', ended: 'Battle over' }

export interface Tally {
  standing: number
  down: number
  out: number
}

/** Counts of a gang's fighters by state: on their feet, pinned or seriously injured, out of action or fled. */
export function tally(state: GameState, seat: Seat): Tally {
  const t: Tally = { standing: 0, down: 0, out: 0 }
  for (const f of Object.values(state.fighters)) {
    if (f.seat !== seat) continue
    if (f.location === 'outOfAction' || f.location === 'fled') t.out++
    else if (f.location === 'board') {
      if (f.posture === 'standing') t.standing++
      else t.down++
    }
  }
  return t
}

function SeatCard({ state, seat }: { state: GameState; seat: Seat }) {
  const t = tally(state, seat)
  const p = state.players[seat]
  const holder = state.priority === seat
  const seats = useGame((s) => s.seats)
  return (
    <div data-testid={`hud-seat-${seat}`} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '2px 10px', borderLeft: `4px solid ${seatColor(seat)}` }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>
        {p.gangName}
        <span style={{ fontWeight: 500, color: colors.muted }}> · {seats[seat] === 'human' ? 'you' : 'bot'}</span>
        {holder && <span data-testid={`priority-${seat}`} style={{ marginLeft: 6, color: colors.accent, fontSize: 11 }}>PRIORITY</span>}
        {p.bottled && <span style={{ marginLeft: 6, color: '#b46bff', fontSize: 11 }}>BOTTLED</span>}
      </div>
      <div style={{ fontSize: 11, color: colors.muted }}>
        {t.standing} standing · {t.down} down · {t.out} out · {p.points} pts
      </div>
    </div>
  )
}

const bar: CSSProperties = { ...panel, display: 'flex', alignItems: 'center', gap: 14, padding: '6px 12px', pointerEvents: 'auto', fontFamily: fontStack }

export function BattleHud() {
  const state = useDisplayState()
  const requestCamera = useUi((s) => s.requestCamera)
  const feedOpen = useUi((s) => s.feedOpen)
  const backToMenu = useSession((s) => s.backToMenu)
  if (!state) return null
  const act = state.action.activation
  const active = act ? state.fighters[act.fighterId] : null
  const scenario = state.data.scenario.name
  return (
    <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 8, alignItems: 'flex-start', pointerEvents: 'none', zIndex: 20, flexWrap: 'wrap' }}>
      <div style={bar} data-testid="hud">
        <div>
          <div style={{ fontWeight: 800, letterSpacing: '0.12em', fontSize: 11, textTransform: 'uppercase', color: colors.muted }}>{scenario}</div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            <span data-testid="hud-round">{state.round > 0 ? `Round ${state.round}` : 'Set-up'}</span>
            <span data-testid="hud-phase" style={{ fontWeight: 600, fontSize: 13, color: colors.muted }}> · {PHASE_NAME[state.phase]}</span>
          </div>
        </div>
        <SeatCard state={state} seat="A" />
        <SeatCard state={state} seat="B" />
        {state.phase === 'action' && (
          <div style={{ fontSize: 12 }} data-testid="hud-turn">
            <div style={{ color: colors.muted }}>Turn: <b style={{ color: state.action.turn ? seatColor(state.action.turn) : colors.text }}>{gangName(state, state.action.turn)}</b></div>
            {active && act && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <b>{active.name}</b>
                <ApPips total={2} left={act.actionsLeft} />
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ ...bar, padding: '4px 8px', gap: 6 }}>
        <Btn data-testid="cam-home" onClick={() => requestCamera('home')}>Overview</Btn>
        <Btn data-testid="cam-top" onClick={() => requestCamera('top')}>Top down</Btn>
        <Btn aria-label="Turn the view left" onClick={() => requestCamera('left')}>⟲</Btn>
        <Btn aria-label="Turn the view right" onClick={() => requestCamera('right')}>⟳</Btn>
        <Btn data-testid="feed-toggle" onClick={() => useUi.setState({ feedOpen: !feedOpen })}>{feedOpen ? 'Hide log' : 'Log'}</Btn>
        <Btn data-testid="menu" onClick={backToMenu}>Menu</Btn>
      </div>
    </div>
  )
}
