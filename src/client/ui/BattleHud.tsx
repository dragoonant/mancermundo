// The battle HUD: scenario, round and phase, who holds Priority, whose turn it is and who is activating, each gang's standing / down /
// out counts, points and bottle state, camera presets, the scenario panel and the menu. Reads the DISPLAY state, so nothing shows
// before it has been played. Hover help comes from the shared glossary.
import type { CSSProperties } from 'react'
import { useDisplayState } from '../presentation/presentedStore'
import type { GameState, Seat } from '@/engine'
import { useGame } from '../store/game'
import { useSession } from '../store/session'
import { gangName } from '../game/labels'
import { bottleOdds, pct } from '../game/odds'
import { Keyword } from './Keyword'
import { Tooltip } from './Tooltip'
import { useFormFactor } from './formFactor'
import { colors, fontStack, panel } from './theme'
import { useUi } from './uiStore'
import { ApPips, Btn, seatColor } from './widgets'

const PHASE_NAME: Record<GameState['phase'], string> = { setup: 'Set-up', priority: 'Priority phase', action: 'Action phase', end: 'End phase', ended: 'Battle over' }
const PHASE_TERM: Partial<Record<GameState['phase'], string>> = { priority: 'Priority', action: 'Action phase', end: 'End phase' }

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

function BottleBadge({ state, seat }: { state: GameState; seat: Seat }) {
  const p = state.players[seat]
  const o = bottleOdds(state, seat)
  if (p.bottled) {
    return (
      <Tooltip title="Bottled out" body={`${gangName(state, seat)} lost its nerve${p.bottledVoluntarily ? ' by choice' : ''}. Its fighters now test Cool every End phase and flee on a failure.`}>
        <span data-testid={`bottled-${seat}`} style={{ marginLeft: 6, color: '#b46bff', fontSize: 11, cursor: 'help' }}>BOTTLED</span>
      </Tooltip>
    )
  }
  if (!o || o.down === 0) return null
  return (
    <Tooltip
      title="Bottle test"
      body={`${o.down} of ${o.crew} starting fighters are down. In the End phase the gang rolls a D6 and adds ${o.down}; a total above ${o.crew} bottles it out${o.pBottle !== null ? ` (${pct(o.pBottle)} now)` : ''}.`}
    >
      <span data-testid={`bottle-risk-${seat}`} style={{ marginLeft: 6, color: o.down * 2 >= (o.crew ?? 0) ? '#ff8a7a' : colors.muted, fontSize: 11, cursor: 'help' }}>
        {o.down}/{o.crew} down
      </span>
    </Tooltip>
  )
}

function SeatCard({ state, seat, compact }: { state: GameState; seat: Seat; compact: boolean }) {
  const t = tally(state, seat)
  const p = state.players[seat]
  const holder = state.priority === seat
  const seats = useGame((s) => s.seats)
  const both = seats.A === 'human' && seats.B === 'human'
  return (
    <div data-testid={`hud-seat-${seat}`} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '2px 10px', borderLeft: `4px solid ${seatColor(seat)}` }}>
      <div style={{ fontWeight: 700, fontSize: compact ? 12 : 13, whiteSpace: 'nowrap' }}>
        {p.gangName}
        <span style={{ fontWeight: 500, color: colors.muted }}> · {both ? `player ${seat}` : seats[seat] === 'human' ? 'you' : 'bot'}</span>
        {holder && (
          <Tooltip title="Priority" body="This gang holds Priority this round: it activates first in the Action phase.">
            <span data-testid={`priority-${seat}`} style={{ marginLeft: 6, color: colors.accent, fontSize: 11, cursor: 'help' }}>PRIORITY</span>
          </Tooltip>
        )}
        <BottleBadge state={state} seat={seat} />
      </div>
      <div style={{ fontSize: 11, color: colors.muted, whiteSpace: 'nowrap' }}>
        <Tooltip title="Fighters" body="Standing on the board, down on the floor (Pinned or Seriously Injured), and out (Out of Action or fled).">
          <span style={{ cursor: 'help' }}>
            {compact ? `${t.standing}/${t.down}/${t.out}` : `${t.standing} up · ${t.down} down · ${t.out} out`}
          </span>
        </Tooltip>{' '}
        · {p.points} pts
      </div>
    </div>
  )
}

const bar: CSSProperties = { ...panel, display: 'flex', alignItems: 'center', gap: 14, padding: '6px 12px', pointerEvents: 'auto', fontFamily: fontStack }

export function BattleHud() {
  const state = useDisplayState()
  const ff = useFormFactor()
  const requestCamera = useUi((s) => s.requestCamera)
  const feedOpen = useUi((s) => s.feedOpen)
  const scenarioOpen = useUi((s) => s.scenarioOpen)
  const backToMenu = useSession((s) => s.backToMenu)
  if (!state) return null
  const act = state.action.activation
  const active = act ? state.fighters[act.fighterId] : null
  const scenario = state.data.scenario.name
  const phaseTerm = PHASE_TERM[state.phase]
  const cam: CSSProperties = ff.compact ? { padding: '5px 8px', fontSize: 12 } : {}
  return (
    <div className="ms-touch" style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 8, alignItems: 'flex-start', pointerEvents: 'none', zIndex: 20, flexWrap: 'wrap' }}>
      <div style={{ ...bar, gap: ff.compact ? 8 : 14, padding: ff.compact ? '4px 8px' : '6px 12px' }} data-testid="hud">
        <div>
          {!ff.compact && <Tooltip title={scenario} body="Open the scenario panel: the objective, how to win and the score.">
            <button
              type="button"
              data-testid="hud-scenario"
              onClick={() => useUi.setState({ scenarioOpen: !scenarioOpen })}
              style={{ all: 'unset', cursor: 'pointer', fontWeight: 800, letterSpacing: '0.12em', fontSize: 11, textTransform: 'uppercase', color: colors.muted, borderBottom: `1px dotted ${colors.muted}` }}
            >
              {scenario}
            </button>
          </Tooltip>}
          <div style={{ fontWeight: 800, fontSize: ff.compact ? 14 : 16 }}>
            <span data-testid="hud-round">{state.round > 0 ? `Round ${state.round}` : 'Set-up'}</span>
            <span data-testid="hud-phase" style={{ fontWeight: 600, fontSize: 13, color: colors.muted }}>
              {' '}
              · {phaseTerm ? <Keyword term={phaseTerm}>{PHASE_NAME[state.phase]}</Keyword> : PHASE_NAME[state.phase]}
            </span>
          </div>
        </div>
        <SeatCard state={state} seat="A" compact={ff.compact} />
        <SeatCard state={state} seat="B" compact={ff.compact} />
        {state.phase === 'action' && !ff.compact && (
          <div style={{ fontSize: 12 }} data-testid="hud-turn">
            <div style={{ color: colors.muted }}>
              Turn: <b style={{ color: state.action.turn ? seatColor(state.action.turn) : colors.text }}>{gangName(state, state.action.turn)}</b>
            </div>
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
        <Btn data-testid="cam-home" style={cam} onClick={() => requestCamera('home')}>Overview</Btn>
        <Btn data-testid="cam-top" style={cam} onClick={() => requestCamera('top')}>Top down</Btn>
        <Btn aria-label="Turn the view left" style={cam} onClick={() => requestCamera('left')}>⟲</Btn>
        <Btn aria-label="Turn the view right" style={cam} onClick={() => requestCamera('right')}>⟳</Btn>
        <Btn data-testid="scenario-toggle" style={cam} variant={scenarioOpen ? 'active' : 'base'} onClick={() => useUi.setState({ scenarioOpen: !scenarioOpen })}>Goal</Btn>
        <Btn data-testid="feed-toggle" style={cam} onClick={() => useUi.setState({ feedOpen: !feedOpen })}>{feedOpen ? 'Hide log' : 'Log'}</Btn>
        <Btn data-testid="menu" style={cam} onClick={backToMenu}>Menu</Btn>
      </div>
    </div>
  )
}
