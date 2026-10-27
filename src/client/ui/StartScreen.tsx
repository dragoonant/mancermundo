// Start screen: the title, Continue for a saved battle, then the setup of a skirmish: who sits opposite (the bot or a second player
// on this screen) and which seat you take, the scenario and board, and the two gangs (changed in the gang picker). "Briefing"
// leads on to the scenario briefing and the deployment. Wording is our own; the look is the underhive of the game.
import type { CSSProperties } from 'react'
import { dataBundle, scenarioPlayable } from '../game/adapter'
import { boardsForScenario, houseName, scenarioList } from '../game/defaults'
import { gangSummary } from '../game/gangs'
import { relativeTime } from '../store/saveGame'
import { randomSeed, useSession, type Opponent } from '../store/session'
import { colors, hazardStripe, hive, hivePage, plate, sectionTitle } from './theme'
import { Btn, seatColor } from './widgets'

const label: CSSProperties = { ...sectionTitle, marginBottom: 6 }
const inputStyle: CSSProperties = { font: `600 13px ${'system-ui, sans-serif'}`, color: colors.text, background: 'rgba(10,10,14,0.9)', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '8px 10px', width: '100%', boxSizing: 'border-box' }

function Segment<T extends string>({ value, options, onChange, testId }: { value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void; testId: string }) {
  return (
    <div role="radiogroup" data-testid={testId} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          data-testid={`${testId}-${o.id}`}
          onClick={() => onChange(o.id)}
          style={{ flex: '1 1 150px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: colors.text, padding: '8px 12px', borderRadius: 8, minHeight: 44, background: value === o.id ? 'rgba(214,162,58,0.16)' : 'rgba(255,255,255,0.04)', border: `1px solid ${value === o.id ? hive.brass : colors.border}` }}
        >
          <div style={{ fontWeight: 800 }}>{o.label}</div>
          {o.hint && <div style={{ fontSize: 11, color: colors.muted }}>{o.hint}</div>}
        </button>
      ))}
    </div>
  )
}

export function StartScreen() {
  const b = dataBundle()
  const s = useSession()
  const scenarios = scenarioList(b)
  const boards = boardsForScenario(b, s.scenarioId)
  const houses = [...new Set(Object.values(b.starterGangs).map((g) => g.house))].sort()
  const seatCard = (seat: 'A' | 'B') => {
    const gang = gangSummary(s.builds[seat].starterId)
    const g = b.starterGangs[s.builds[seat].starterId]
    const who = s.seats[seat] === 'bot' ? 'the bot' : s.opponent === 'hotseat' ? `player ${seat}` : 'you'
    return (
      <div key={seat} data-testid={`seat-${seat}`} style={{ ...plate, padding: 12, borderTop: `4px solid ${seatColor(seat)}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 11, color: colors.muted }}>
          Gang {seat} · played by {who}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{g?.name ?? '?'}</div>
        <div style={{ fontSize: 12, color: hive.brass }}>
          {g ? houseName(b, g.house) : ''} · {gang?.cost ?? 0} credits · {gang?.fighters.length ?? 0} fighters
        </div>
        <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.4 }}>{gang?.fighters.map((f) => f.name).join(', ')}</div>
      </div>
    )
  }
  return (
    <main className="ms-menu" data-testid="start-screen" style={{ ...hivePage, padding: 'max(18px, var(--safe-top)) 16px 36px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <header>
          <div style={hazardStripe} />
          <h1 data-testid="title" style={{ margin: '14px 0 2px', letterSpacing: '0.24em', textTransform: 'uppercase', fontSize: 'clamp(28px, 6vw, 46px)', color: hive.chalk, textShadow: `0 2px 0 ${hive.rustDark}` }}>
            Mancermundo
          </h1>
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>A fan-made skirmish in the dark corridors of a hive. Two gangs, one board, no mercy.</p>
        </header>

        {s.saveNotice && (
          <div style={{ ...plate, padding: '8px 12px', fontSize: 13, borderLeft: `4px solid ${colors.accent}` }}>
            {s.saveNotice} <Btn onClick={s.dismissSaveNotice} style={{ marginLeft: 8 }}>OK</Btn>
          </div>
        )}
        {s.savedGame && (
          <div data-testid="continue" style={{ ...plate, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <b>Continue your battle</b>
              <div style={{ fontSize: 12, color: colors.muted }}>
                {s.savedGame.gangA} against {s.savedGame.gangB} · {s.savedGame.mode} · {s.savedGame.progress} · {relativeTime(s.savedGame.savedAt, Date.now())}
              </div>
            </div>
            <Btn variant="primary" data-testid="continue-btn" onClick={() => s.continueSaved()}>Continue</Btn>
            <Btn variant="danger" onClick={s.abandonGame}>Discard</Btn>
          </div>
        )}

        <section style={{ ...plate, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={label}>Opponent</h2>
          <Segment<Opponent>
            testId="opponent"
            value={s.opponent}
            onChange={s.setOpponent}
            options={[
              { id: 'bot', label: 'Against the bot', hint: 'You command one gang; the bot plays the other.' },
              { id: 'hotseat', label: 'Two players, one screen', hint: 'Take turns on the same device.' },
            ]}
          />
          {s.opponent === 'bot' && (
            <>
              <h2 style={{ ...label, marginTop: 4 }}>Your seat</h2>
              <Segment<'A' | 'B'>
                testId="human-seat"
                value={s.humanSeat}
                onChange={s.setHumanSeat}
                options={[
                  { id: 'A', label: 'Gang A', hint: 'Blue. Listed first.' },
                  { id: 'B', label: 'Gang B', hint: 'Red. Listed second.' },
                ]}
              />
            </>
          )}
        </section>

        <section style={{ ...plate, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={label}>Scenario</h2>
          <div role="radiogroup" data-testid="scenario-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
            {scenarios.map((x) => {
              const ok = scenarioPlayable(x.id)
              const picked = s.scenarioId === x.id
              return (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={!ok}
                  data-testid={`scenario-${x.id.replace(/^scn\./, '')}`}
                  onClick={() => s.setScenario(x.id)}
                  style={{ textAlign: 'left', cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.5, font: 'inherit', color: colors.text, padding: '10px 12px', borderRadius: 8, background: picked ? 'rgba(214,162,58,0.16)' : 'rgba(255,255,255,0.04)', border: `1px solid ${picked ? hive.brass : colors.border}` }}
                >
                  <div style={{ fontWeight: 800 }}>{x.name}</div>
                  <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.4 }}>{x.text.split('. ')[0]}.</div>
                  {!ok && <div style={{ fontSize: 11, color: hive.brass, marginTop: 3 }}>Not playable yet</div>}
                </button>
              )
            })}
          </div>
          <h2 style={{ ...label, marginTop: 4 }}>Board</h2>
          <div role="radiogroup" data-testid="board-list" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {boards.map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={s.boardId === x.id}
                data-testid={`board-${x.id.replace(/^zm\.b\./, '')}`}
                onClick={() => s.setBoard(x.id)}
                style={{ cursor: 'pointer', font: 'inherit', color: colors.text, padding: '8px 12px', borderRadius: 8, minHeight: 44, textAlign: 'left', background: s.boardId === x.id ? 'rgba(214,162,58,0.16)' : 'rgba(255,255,255,0.04)', border: `1px solid ${s.boardId === x.id ? hive.brass : colors.border}` }}
              >
                <div style={{ fontWeight: 700 }}>{x.name}</div>
                <div style={{ fontSize: 11, color: colors.muted }}>{x.layout === '2x3' ? '24 by 36 inches' : 'seven tiles'}</div>
              </button>
            ))}
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <h2 style={label}>Gangs</h2>
            <Btn data-testid="choose-gangs" onClick={() => s.setScreen('gangs')}>
              Choose gangs
            </Btn>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>{(['A', 'B'] as const).map(seatCard)}</div>
        </section>

        <section data-testid="watch-setup" style={{ ...plate, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderLeft: `4px solid ${hive.brass}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={label}>Or just watch</h2>
            <Btn data-testid="watch-swap" onClick={() => useSession.setState((x) => ({ builds: { A: x.builds.B, B: x.builds.A } }))}>
              Swap sides
            </Btn>
          </div>
          <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.45 }}>
            Two AIs fight it out on the scenario and board above, with controls to pause, step one decision at a time and slow the dice down. Pick the house on each side.
          </div>
          {(['A', 'B'] as const).map((seat) => (
            <div key={seat}>
              <div style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Side {seat} ({seat === 'A' ? 'blue' : 'red'})</div>
              <Segment<string>
                testId={`watch-house-${seat}`}
                value={b.starterGangs[s.builds[seat].starterId]?.house ?? ''}
                onChange={(h) => s.setWatchHouse(seat, h)}
                options={houses.map((h) => ({ id: h, label: houseName(b, h) }))}
              />
            </div>
          ))}
          <Btn variant="primary" data-testid="watch-start" onClick={() => s.launchWatch()} style={{ fontSize: 16, padding: '11px 26px', minHeight: 44, alignSelf: 'flex-start' }}>
            Watch AI vs AI
          </Btn>
        </section>

        <section style={{ ...plate, padding: 14, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: colors.muted }}>
            Seed (the same seed and choices replay the same dice)
            <input aria-label="Seed" style={inputStyle} value={s.seed} onChange={(e) => s.setSeed(e.target.value)} />
          </label>
          <Btn onClick={() => s.setSeed(randomSeed())}>New seed</Btn>
          <Btn variant="primary" data-testid="to-briefing" onClick={() => s.setScreen('briefing')} style={{ fontSize: 16, padding: '11px 26px', minHeight: 44 }}>
            Briefing
          </Btn>
        </section>

        <footer style={{ fontSize: 11, color: colors.muted, lineHeight: 1.5 }}>
          Fan-made project, credited to evilgouki. Not affiliated with or endorsed by Games Workshop. Art, text and models are original. The lab viewer is at{' '}
          <a style={{ color: colors.muted }} href="?lab">
            ?lab
          </a>
          .
        </footer>
      </div>
    </main>
  )
}
