// Tray of the operatives that are out of the killzone (Wyrmblade HIDING, Aquilons above; the wording is the team's). They are not drawn on the board, so they
// live here: a chip each, clickable to select (and to activate when the engine offers it). HIDING is open
// information (docs/spec/13-teams.md section 6; operatives are revealed at selection and set aside in the open), so
// the opponent's hidden operatives show too, marked as theirs and listed after the viewer's own.
import type { Operative, Seat } from '@/engine'
import { clickOperative } from '../interaction/controller'
import { setAsideWording } from '../teams'
import { useDisplayState } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { CollapseButton, CollapsedTab, useCollapsed } from './collapse'
import { Keyword } from './Keyword'
import { colors, fontStack, panel } from './theme'
import { Tooltip } from './Tooltip'
import { seatColor } from './widgets'

/** The seats this viewer plays (both when spectating two bots): their hidden operatives are "yours" in the tray. */
export function viewerSeats(seats: Record<Seat, 'human' | 'bot'>, acting: Seat | null): Seat[] {
  const humans = (['A', 'B'] as Seat[]).filter((s) => seats[s] === 'human')
  if (humans.length === 0) return ['A', 'B']
  if (humans.length === 1) return humans
  return [acting && seats[acting] === 'human' ? acting : humans[0]!]
}

/** Every operative out of the killzone, the viewer's own first; `theirs` marks the opponent's. */
export function trayEntries(operatives: Record<string, Operative>, mine: Seat[]): { op: Operative; theirs: boolean }[] {
  return Object.values(operatives)
    .filter((o) => o.status === 'reserve' && o.offboard !== undefined)
    .map((op) => ({ op, theirs: !mine.includes(op.seat) }))
    .sort((a, b) => Number(a.theirs) - Number(b.theirs) || (a.op.id < b.op.id ? -1 : 1))
}

export function HiddenTray() {
  const state = useDisplayState()
  const seats = useGame((g) => g.seats)
  const acting = useGame((g) => g.pending?.seat ?? null)
  const [collapsed] = useCollapsed('hidden')
  if (!state) return null
  const hidden = trayEntries(state.operatives, viewerSeats(seats, acting))
  if (hidden.length === 0) return null
  const wording = (seat: Seat) => setAsideWording(state.players[seat]?.teamId)
  // one header when every chip reads alike, else the first viewer-owned team's
  const head = wording((hidden.find((h) => !h.theirs) ?? hidden[0]!).op.seat)
  if (collapsed) return <CollapsedTab id="hidden" title={`${head.term} (${hidden.length})`} style={{ position: 'absolute', top: 62, left: 8, zIndex: 18 }} />
  return (
    <div
      data-testid="hidden-tray"
      style={{ ...panel, position: 'absolute', top: 62, left: 8, padding: '5px 8px', fontFamily: fontStack, fontSize: 12, pointerEvents: 'auto', zIndex: 18, maxWidth: 260 }}
    >
      <div style={{ color: colors.muted, marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span>
          <Keyword term={head.term} /> {head.trayNote}
        </span>
        <CollapseButton id="hidden" title={head.term} style={{ flex: '0 0 auto' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {hidden.map(({ op: o, theirs }) => (
          <Tooltip
            key={o.id}
            title={`${theirs ? "Opponent's " : ''}${o.name} is ${wording(o.seat).state}`}
            body={theirs ? wording(o.seat).theirs(o.ready) : wording(o.seat).mine(o.ready)}
          >
            <button
              data-testid={`hidden-${o.id}`}
              data-theirs={theirs ? 'true' : undefined}
              onClick={() => clickOperative(o.id)}
              style={{ border: `1px solid ${colors.border}`, borderLeft: `4px solid ${seatColor(o.seat)}`, background: 'transparent', color: o.ready ? colors.text : colors.muted, borderRadius: 4, padding: '2px 6px', cursor: 'pointer', font: 'inherit', fontStyle: theirs ? 'italic' : undefined }}
            >
              {o.name}
              {theirs && <span style={{ color: colors.muted, marginLeft: 4 }}>(opponent)</span>}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
