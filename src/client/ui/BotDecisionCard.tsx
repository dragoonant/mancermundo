// "What the AI is deciding": in a watched game, the decision a bot is about to answer in words, the answer it chose and the engine's own
// numbers for it (the same ones the human prompts show), held up before the answer is applied. It stays up, marked as answered, while
// the results play, so the dice in the tray can be read against the odds. Wording comes from the shared label helpers.
import { useMemo, type CSSProperties } from 'react'
import { describeBotDecision } from '../game/botDecision'
import { gangName } from '../game/labels'
import { useGame } from '../store/game'
import { isWatching } from '../store/pacing'
import { useFormFactor } from './formFactor'
import { colors, panel } from './theme'
import { seatColor } from './widgets'

const chip: CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'baseline', padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,0.07)', fontSize: 12, whiteSpace: 'nowrap' }

export function BotDecisionCard() {
  const deciding = useGame((s) => s.deciding)
  const seats = useGame((s) => s.seats)
  const over = useGame((s) => s.state?.phase === 'ended')
  const ff = useFormFactor()
  const view = useMemo(() => (deciding ? describeBotDecision(deciding.state, deciding.pending, deciding.action) : null), [deciding])
  if (!deciding || !view || over || !isWatching(seats)) return null
  const compact = ff.compact
  const who = gangName(deciding.state, deciding.seat)
  return (
    <div
      data-testid="bot-card"
      data-decision={deciding.pending.kind}
      data-applied={deciding.applied ? '1' : '0'}
      aria-live="polite"
      style={{
        ...panel,
        width: compact ? 'min(430px, calc(100vw - 150px))' : 'min(560px, calc(100vw - 24px))',
        boxSizing: 'border-box',
        padding: compact ? '5px 10px' : '8px 12px',
        borderTop: `3px solid ${seatColor(deciding.seat)}`,
        pointerEvents: 'none',
        opacity: deciding.applied ? 0.82 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        <span>{deciding.applied ? `${who} chose` : `${who} is deciding`}{compact ? `: ${view.title}` : ''}</span>
        {view.optionCount > 1 && !compact && <span>{view.optionCount} options open</span>}
      </div>
      {!compact && <div style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{view.title}</div>}
      <div data-testid="bot-card-choice" style={{ fontSize: compact ? 14 : 16, fontWeight: 800, marginTop: 1 }}>
        {view.chosen}
      </div>
      {view.facts.length > 0 && !(compact && view.odds.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {view.facts.map((f) => (
            <span key={f} style={chip}>
              {f}
            </span>
          ))}
        </div>
      )}
      {view.odds.map((o, i) => (
        <div key={i} data-testid="bot-card-odds" style={{ marginTop: 4 }}>
          {o.who && <div style={{ fontSize: 11, color: colors.muted }}>{o.who}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {o.lines.map((l) => (
              <span key={l.label} style={chip}>
                <span style={{ color: colors.muted }}>{l.label}</span>
                <b>{l.value}</b>
              </span>
            ))}
          </div>
          {o.summary && !compact && <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{o.summary}</div>}
        </div>
      ))}
      {view.alternatives.length > 0 && !compact && (
        <div style={{ fontSize: 11, color: colors.muted, marginTop: 5 }}>Could also have: {view.alternatives.join(' · ')}</div>
      )}
    </div>
  )
}
