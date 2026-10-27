// End screen: the winner, how the battle was decided, the rounds fought, each gang's points by source, and each gang's casualties
// (who fell, to whom, in which round). Play again keeps every setting; Swap sides trades the gangs and seats; View board hides the
// panel so the final position can be looked at. Read from the engine's result and casualty log, shown once the ending has played.
import { useMemo, useState } from 'react'
import type { GameEvent, GameState, Seat } from '@/engine'
import { dataBundle } from '../game/adapter'
import { gangName, humanize } from '../game/labels'
import { scenarioProgress } from '../game/scenario'
import { useGame } from '../store/game'
import { isWatching } from '../store/pacing'
import { useSession } from '../store/session'
import { trayEntries } from './CasualtyTray'
import { Keyword } from './Keyword'
import { colors, hazardStripe, hive, mutedText, plate } from './theme'
import { Tooltip } from './Tooltip'
import { Btn, Dot, Muted, seatColor } from './widgets'

export interface PointLine {
  reason: string
  points: number
}

/** Points per seat grouped by the reason the engine gave (`PointsScored` events), biggest first. */
export function pointsBySource(events: GameEvent[]): Record<Seat, PointLine[]> {
  const sums: Record<Seat, Map<string, number>> = { A: new Map(), B: new Map() }
  for (const ev of events) {
    if (ev.type !== 'PointsScored') continue
    sums[ev.seat].set(ev.reason, (sums[ev.seat].get(ev.reason) ?? 0) + ev.amount)
  }
  const lines = (m: Map<string, number>) => [...m.entries()].map(([reason, points]) => ({ reason, points })).sort((a, b) => b.points - a.points)
  return { A: lines(sums.A), B: lines(sums.B) }
}

const REASON_WORD: Record<string, string> = {
  fighterOutOfAction: 'Fighters put Out of Action',
  fighterFled: 'Fighters that fled',
  casketOpened: 'Caskets cracked open',
  casketSecured: 'Caskets secured',
  lastGangStanding: 'Last gang standing',
}

const REASON_BY: Record<string, string> = { scenario: 'by the scenario', roundLimit: 'at the round limit', resign: 'by resignation', concede: 'by concession' }

export function resultHeadline(state: GameState): { title: string; sub: string } {
  const r = state.result
  if (!r) return { title: '', sub: '' }
  const by = REASON_BY[r.reason] ?? r.reason
  const rounds = `${state.round} round${state.round === 1 ? '' : 's'} fought`
  const title = r.winner === 'draw' ? 'A draw' : `${gangName(state, r.winner)} wins`
  return { title, sub: `${state.data.scenario.name} · decided ${by} · ${rounds}` }
}

function GangColumn({ state, seat, lines }: { state: GameState; seat: Seat; lines: PointLine[] }) {
  const p = state.players[seat]
  const house = dataBundle().houses[p.houseId]?.name ?? p.houseId
  const result = state.result!
  const win = result.winner === seat
  const casualties = trayEntries(state, seat).filter((e) => e.seat === seat)
  const standing = Object.values(state.fighters).filter((f) => f.seat === seat && f.location === 'board' && f.posture === 'standing').length
  return (
    <div data-testid={`end-seat-${seat}`} data-winner={win ? '1' : '0'} style={{ borderTop: `4px solid ${seatColor(seat)}`, paddingTop: 8, minWidth: 0 }}>
      <div style={{ fontWeight: 800 }}>
        <Dot seat={seat} />
        {p.gangName}
        {win && <span style={{ color: colors.accent, marginLeft: 8, fontSize: 12 }}>WINNER</span>}
        {p.bottled && (
          <Tooltip title="Bottled out" body="This gang lost its nerve during the battle.">
            <span style={{ color: '#b46bff', marginLeft: 8, fontSize: 12, cursor: 'help' }}>BOTTLED</span>
          </Tooltip>
        )}
      </div>
      <Muted>{house}</Muted>
      <div style={{ fontSize: 30, fontWeight: 800, margin: '2px 0' }} data-testid={`end-points-${seat}`}>
        {result.points[seat]} <span style={{ fontSize: 13, color: colors.muted, fontWeight: 600 }}><Keyword term="Points">points</Keyword></span>
      </div>
      <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '6px 0 2px' }}>Points by source</div>
      {lines.length === 0 && <Muted>None scored.</Muted>}
      {lines.map((l) => (
        <div key={l.reason} data-testid={`end-source-${seat}-${l.reason}`} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{REASON_WORD[l.reason] ?? humanize(l.reason)}</span>
          <b>{l.points}</b>
        </div>
      ))}
      <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '8px 0 2px' }}>
        Casualties ({casualties.length}) · {standing} left standing
      </div>
      {casualties.length === 0 && <Muted>Nobody fell.</Muted>}
      {casualties.map((e) => {
        const f = state.fighters[e.fighterId]!
        const by = e.by ? state.fighters[e.by]?.name : null
        return (
          <div key={e.fighterId} data-testid={`end-casualty-${e.fighterId}`} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{f.name}</span>
            <span style={{ color: colors.muted, textAlign: 'right' }}>
              {e.kind === 'fled' ? 'fled' : e.kind === 'outOfAction' ? 'out' : 'down'}
              {by ? ` · ${by}` : ''} · R{e.round}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function EndScreen() {
  const state = useGame((g) => g.state)
  const meta = useGame((g) => g.meta)
  const events = useGame((g) => g.events)
  const watching = useGame((g) => isWatching(g.seats))
  const [hidden, setHidden] = useState(false)
  const lines = useMemo(() => pointsBySource(events), [events])
  if (!state || !state.result) return null
  if (hidden) {
    return (
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 90, pointerEvents: 'auto' }}>
        <Btn data-testid="end-show" variant="primary" onClick={() => setHidden(false)}>
          Show results
        </Btn>
      </div>
    )
  }
  const { title, sub } = resultHeadline(state)
  const r = state.result
  const prog = scenarioProgress(state)
  const save = () => {
    const file = useGame.getState().exportSave()
    if (!file) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `mancermundo-${meta?.seed ?? 'battle'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const session = useSession.getState()
  return (
    <div className="ms-touch" data-testid="end-screen" style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,10,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 10, boxSizing: 'border-box', pointerEvents: 'auto' }}>
      <div data-testid="result" style={{ ...plate, width: 'min(720px, 100%)', maxHeight: '94vh', overflowY: 'auto', padding: 18 }}>
        <div style={hazardStripe} />
        <h1 data-testid="end-title" style={{ margin: '10px 0 2px', fontSize: 28, letterSpacing: '0.04em', color: r.winner === 'draw' ? colors.accent : hive.chalk }}>
          {title}
        </h1>
        <div data-testid="end-sub" style={{ ...mutedText, marginBottom: 6 }}>{sub}</div>
        {prog.caskets && (
          <Muted style={{ marginBottom: 6 }}>
            Caskets: {prog.caskets.opened} cracked, {prog.caskets.secured} secured.
          </Muted>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 8 }}>
          <GangColumn state={state} seat="A" lines={lines.A} />
          <GangColumn state={state} seat="B" lines={lines.B} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Btn data-testid="end-again" variant="primary" onClick={() => session.playAgain()}>
            {watching ? 'Watch again' : 'Play again'}
          </Btn>
          <Tooltip
            title="Swap sides"
            body={watching ? 'Trade the two gangs between the sides and watch again. Same scenario and board, new seed.' : 'Trade the two gangs and who plays them: you take the other gang and the bot takes yours. Same scenario and board, new seed.'}
          >
            <Btn data-testid="end-swap" onClick={() => session.swapSeats()}>
              Swap sides
            </Btn>
          </Tooltip>
          <Btn data-testid="end-view" onClick={() => setHidden(true)}>
            View board
          </Btn>
          <Btn data-testid="end-save" onClick={save}>
            Save replay
          </Btn>
          <Btn data-testid="end-menu" onClick={() => session.backToMenu()}>
            {watching ? 'Back to start' : 'Main menu'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
