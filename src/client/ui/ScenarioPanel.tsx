// The scenario panel of the battle: the objective and how to win (the same text as the briefing) and how the battle stands now
// (points, caskets, a locked result). Opened from the HUD; folds away again with the same button.
import { useDisplayState } from '../presentation/presentedStore'
import { dataBundle } from '../game/adapter'
import { scenarioProgress } from '../game/scenario'
import { gangName } from '../game/labels'
import { BriefingBody } from './Briefing'
import { Keyword } from './Keyword'
import { colors, fontStack, panel } from './theme'
import { useUi } from './uiStore'
import { Btn, seatColor } from './widgets'

export function ScenarioPanel() {
  const state = useDisplayState()
  const open = useUi((s) => s.scenarioOpen)
  if (!open || !state) return null
  const scenarioId = state.scenario.id
  const known = dataBundle().scenarios[scenarioId]
  const p = scenarioProgress(state)
  return (
    <div className="ms-touch" data-testid="scenario-panel" style={{ ...panel, position: 'absolute', top: 76, right: 8, width: 'min(380px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', padding: 12, fontFamily: fontStack, pointerEvents: 'auto', zIndex: 35, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ fontSize: 15 }}>{state.data.scenario.name}</b>
        <Btn data-testid="scenario-close" onClick={() => useUi.setState({ scenarioOpen: false })}>Close</Btn>
      </div>
      <div data-testid="scenario-score" style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10, fontSize: 13 }}>
        {(['A', 'B'] as const).map((seat) => (
          <div key={seat} style={{ borderLeft: `4px solid ${seatColor(seat)}`, paddingLeft: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>{gangName(state, seat)}</span>
            <b>
              {p.points[seat]} <Keyword term="Points">points</Keyword>
            </b>
          </div>
        ))}
        {p.caskets && (
          <div style={{ color: colors.muted }}>
            Caskets: {p.caskets.opened} cracked, {p.caskets.secured} secured
          </div>
        )}
        {p.lockedWinner && (
          <div style={{ color: colors.accent }}>
            {gangName(state, p.lockedWinner)} has the win locked up.
          </div>
        )}
      </div>
      {known && <BriefingBody scenarioId={scenarioId} compact />}
    </div>
  )
}
