// Briefing: what the chosen scenario asks of both gangs, in our own words: the objective, crews, deployment, scoring, how to win,
// and the round in five lines, with the two gangs and the board. `BriefingBody` is shared with the in-battle scenario panel.
import type { CSSProperties } from 'react'
import { dataBundle } from '../game/adapter'
import { houseName } from '../game/defaults'
import { briefingFor } from '../game/scenario'
import { useSession } from '../store/session'
import { KeywordText } from './Keyword'
import { colors, hazardStripe, hive, hivePage, plate, sectionTitle } from './theme'
import { Btn, Dot, seatColor } from './widgets'

export function BriefingBody({ scenarioId, compact }: { scenarioId: string; compact?: boolean }) {
  const scn = dataBundle().scenarios[scenarioId]
  if (!scn) return null
  const b = briefingFor(scn)
  const ul: CSSProperties = { margin: '4px 0 0', paddingLeft: 18, fontSize: compact ? 12 : 13, lineHeight: 1.5 }
  return (
    <div data-testid="briefing-body" style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12 }}>
      <section>
        <h3 style={sectionTitle}>The job</h3>
        <p style={{ margin: '4px 0 0', fontSize: compact ? 12 : 13, lineHeight: 1.5 }}>
          <KeywordText text={b.objective} />
        </p>
      </section>
      <section data-testid="briefing-win">
        <h3 style={sectionTitle}>How to win</h3>
        <p style={{ margin: '4px 0 0', fontSize: compact ? 12 : 13, lineHeight: 1.5 }}>
          <KeywordText text={b.howToWin} />
        </p>
        {b.scoring.length > 0 && (
          <ul style={ul}>
            {b.scoring.map((l) => (
              <li key={l}>
                <KeywordText text={l} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 style={sectionTitle}>Crews and deployment</h3>
        <ul style={ul}>
          {[...b.crew, ...b.deployment].map((l) => (
            <li key={l}>
              <KeywordText text={l} />
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="briefing-rounds">
        <h3 style={sectionTitle}>A round in five lines</h3>
        <ol style={ul}>
          {b.rounds.map((l) => (
            <li key={l}>
              <KeywordText text={l} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

/** Confirmation shown when a new battle would replace the game saved on this device. */
export function ReplaceDialog() {
  const s = useSession()
  if (!s.confirmReplace) return null
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="replace-title" data-testid="replace-save-dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,0.78)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ ...plate, width: 'min(420px, 100%)', padding: 18 }}>
        <div id="replace-title" style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>
          Replace your saved battle?
        </div>
        <div style={{ color: colors.muted, marginBottom: 14, fontSize: 13 }}>
          Only one battle is kept on this device. Starting a new one deletes the one in progress
          {s.savedGame ? ` (${s.savedGame.gangA} against ${s.savedGame.gangB}, ${s.savedGame.progress.toLowerCase()})` : ''}.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn data-testid="replace-save-confirm" variant="danger" onClick={s.confirmLaunch}>
            Replace it and deploy
          </Btn>
          <Btn data-testid="replace-save-cancel" variant="primary" onClick={s.cancelLaunch}>
            Keep my battle
          </Btn>
        </div>
      </div>
    </div>
  )
}

export function Briefing() {
  const s = useSession()
  const b = dataBundle()
  const scn = b.scenarios[s.scenarioId]
  const board = b.boards[s.boardId]
  if (!scn) return null
  return (
    <div className="ms-menu" data-testid="briefing" style={{ ...hivePage, display: 'flex', justifyContent: 'center', padding: 'max(14px, var(--safe-top)) 14px 24px', boxSizing: 'border-box' }}>
      <div style={{ width: 'min(760px, 100%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={hazardStripe} />
        <header>
          <div style={{ ...sectionTitle, color: colors.muted }}>Briefing</div>
          <h2 data-testid="briefing-title" style={{ margin: '2px 0 2px', fontSize: 28, letterSpacing: '0.06em', textTransform: 'uppercase', color: hive.chalk }}>
            {scn.name}
          </h2>
          <div style={{ color: colors.muted, fontSize: 13 }}>
            {board?.name ?? s.boardId} · {board?.layout === 'brick7' ? 'seven tiles' : '24 by 36 inches'} · seed {s.seed} ·{' '}
            {s.opponent === 'hotseat' ? 'two players, one screen' : `you command Gang ${s.humanSeat} against the bot`}
          </div>
        </header>
        <div style={{ ...plate, padding: 16 }}>
          <BriefingBody scenarioId={s.scenarioId} />
        </div>
        <div style={{ ...plate, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }} data-testid="briefing-gangs">
          {(['A', 'B'] as const).map((seat) => {
            const g = b.starterGangs[s.builds[seat].starterId]
            return (
              <div key={seat} style={{ borderLeft: `4px solid ${seatColor(seat)}`, paddingLeft: 10 }}>
                <div style={{ fontWeight: 800 }}>
                  <Dot seat={seat} />
                  Gang {seat}: {g?.name ?? '?'}
                </div>
                <div style={{ fontSize: 12, color: colors.muted }}>
                  {g ? houseName(b, g.house) : ''} · {s.seats[seat] === 'bot' ? 'the bot' : s.opponent === 'hotseat' ? 'a player' : 'you'}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>{g?.fighters.map((f) => f.name).join(', ')}</div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn data-testid="briefing-back" onClick={() => s.setScreen('start')}>
            Back
          </Btn>
          <Btn data-testid="briefing-start" variant="primary" style={{ padding: '11px 26px', fontSize: 16, marginLeft: 'auto' }} onClick={s.requestLaunch}>
            Deploy
          </Btn>
        </div>
      </div>
      <ReplaceDialog />
    </div>
  )
}
