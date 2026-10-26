// Casualty tray: the fighters of each gang who are Seriously Injured, Out of Action or have fled, with who put them down and when.
// Read from the display state, so a casualty shows only once its beat has played. Collapsible; click a chip to see its card.
import { useState } from 'react'
import { useDisplayState } from '../presentation/presentedStore'
import type { CasualtyRecord, GameState, Seat } from '@/engine'
import { humanize } from '../game/labels'
import { CollapseButton, CollapsedTab, useCollapsed } from './collapse'
import { colors, fontStack, panel } from './theme'
import { Tooltip } from './Tooltip'
import { useFormFactor } from './formFactor'
import { useUi } from './uiStore'
import { seatColor } from './widgets'

export interface TrayEntry {
  fighterId: string
  seat: Seat
  kind: CasualtyRecord['kind']
  by: string | null
  cause: string
  round: number
}

/**
 * The tray's contents: the latest casualty record of each fighter that is still down (Seriously Injured fighters who have
 * got up again are dropped), the viewer's gang first.
 */
export function trayEntries(state: GameState, firstSeat: Seat = 'A'): TrayEntry[] {
  const latest = new Map<string, CasualtyRecord>()
  for (const c of state.casualties) latest.set(c.fighterId, c)
  const out: TrayEntry[] = []
  for (const c of latest.values()) {
    const f = state.fighters[c.fighterId]
    if (!f) continue
    const down = f.location === 'outOfAction' || f.location === 'fled' || (f.location === 'board' && f.posture === 'seriouslyInjured')
    if (!down) continue
    const kind: CasualtyRecord['kind'] = f.location === 'fled' ? 'fled' : f.location === 'outOfAction' ? 'outOfAction' : 'seriouslyInjured'
    out.push({ fighterId: f.id, seat: f.seat, kind, by: c.by, cause: c.cause, round: c.round })
  }
  return out.sort((a, b) => Number(b.seat === firstSeat) - Number(a.seat === firstSeat) || a.round - b.round)
}

const KIND_WORD: Record<CasualtyRecord['kind'], { label: string }> = {
  seriouslyInjured: { label: 'down' },
  outOfAction: { label: 'out' },
  fled: { label: 'fled' },
}

export function CasualtyTray() {
  const state = useDisplayState()
  const [stored] = useCollapsed('casualties')
  const ff = useFormFactor()
  const [phoneOpen, setPhoneOpen] = useState(false)
  const top = ff.compact ? 112 : 76
  if (!state) return null
  const entries = trayEntries(state)
  if (entries.length === 0) return null
  const collapsed = ff.compact ? !phoneOpen : stored
  if (collapsed) {
    return ff.compact ? (
      <button type="button" data-testid="casualty-tray" onClick={() => setPhoneOpen(true)} style={{ ...panel, position: 'absolute', top, left: 8, zIndex: 18, minHeight: 44, padding: '0 12px', font: 'inherit', fontSize: 13, color: colors.text, pointerEvents: 'auto', cursor: 'pointer' }}>
        Casualties ({entries.length})
      </button>
    ) : (
      <CollapsedTab id="casualties" title={`Casualties (${entries.length})`} testId="casualty-tray" style={{ position: 'absolute', top, left: 8, zIndex: 18 }} />
    )
  }
  return (
    <div className="ms-touch" data-testid="casualty-tray" style={{ ...panel, position: 'absolute', top, left: 8, padding: '5px 8px', fontFamily: fontStack, fontSize: 12, pointerEvents: 'auto', zIndex: 18, maxWidth: 270, maxHeight: '32vh', overflowY: 'auto' }}>
      <div style={{ color: colors.muted, marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span>Casualties</span>
        {ff.compact ? (
          <button type="button" onClick={() => setPhoneOpen(false)} style={{ font: 'inherit', color: colors.text, background: 'rgba(255,255,255,0.08)', border: `1px solid ${colors.border}`, borderRadius: 6, minHeight: 44, padding: '0 12px' }}>
            Hide
          </button>
        ) : (
          <CollapseButton id="casualties" title="Casualties" style={{ flex: '0 0 auto' }} />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {entries.map((e) => {
          const f = state.fighters[e.fighterId]!
          const by = e.by ? state.fighters[e.by]?.name : null
          const w = KIND_WORD[e.kind]
          return (
            <Tooltip key={e.fighterId} title={`${f.name}: ${humanize(e.kind)}`} body={`${by ? `Put down by ${by}` : humanize(e.cause)}${by && e.cause ? ` (${humanize(e.cause).toLowerCase()})` : ''} in round ${e.round}.`}>
              <button
                type="button"
                data-testid={`casualty-${e.fighterId}`}
                data-kind={e.kind}
                onClick={() => useUi.setState({ selected: e.fighterId })}
                style={{ border: `1px solid ${colors.border}`, borderLeft: `4px solid ${seatColor(e.seat)}`, background: 'transparent', color: e.kind === 'seriouslyInjured' ? colors.text : colors.muted, borderRadius: 4, padding: '2px 6px', cursor: 'pointer', font: 'inherit', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 8 }}
              >
                <span>{f.name}</span>
                <span style={{ color: e.kind === 'seriouslyInjured' ? '#ffb347' : '#ff8a7a' }}>
                  {w.label} · R{e.round}
                </span>
              </button>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
