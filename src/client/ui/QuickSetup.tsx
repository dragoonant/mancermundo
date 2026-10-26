// Start screen and quick setup in one (S5c replaces it with StartScreen + GangPicker + Briefing): pick the scenario and board, a
// starter gang for each seat, who plays each seat (you or the random bot), a seed, then start the battle. Continue offers the
// game kept on this device. Wording is our own.
import type { CSSProperties } from 'react'
import { dataBundle, scenarioPlayable } from '../game/adapter'
import { boardsForScenario, houseName, scenarioList, starterList } from '../game/defaults'
import { relativeTime } from '../store/saveGame'
import { randomSeed, useSession } from '../store/session'
import { colors, fontStack, panel } from './theme'
import { Btn, seatColor } from './widgets'

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: colors.muted }
const select: CSSProperties = { font: `600 13px ${fontStack}`, color: colors.text, background: 'rgba(20,22,32,0.95)', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '7px 8px', width: '100%' }

export function QuickSetup() {
  const b = dataBundle()
  const s = useSession()
  const scenarios = scenarioList(b)
  const scenario = b.scenarios[s.scenarioId]
  const boards = boardsForScenario(b, s.scenarioId)
  const starters = starterList(b)
  const seatBox = (seat: 'A' | 'B') => {
    const gang = b.starterGangs[s.builds[seat].starterId]
    return (
      <div key={seat} data-testid={`seat-${seat}`} style={{ ...panel, padding: 12, borderTop: `4px solid ${seatColor(seat)}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 800 }}>Gang {seat}</div>
        <label style={field}>
          Starter gang
          <select aria-label={`Starter gang ${seat}`} style={select} value={s.builds[seat].starterId} onChange={(e) => s.setStarter(seat, e.target.value)}>
            {starters.map((g) => (
              <option key={g.id} value={g.id}>
                {houseName(b, g.house)}: {g.name} ({g.fighters.length} fighters)
              </option>
            ))}
          </select>
        </label>
        {gang && (
          <div style={{ fontSize: 11, color: colors.muted, lineHeight: 1.4 }}>
            {gang.fighters.map((f) => f.name).join(', ')}
          </div>
        )}
        <label style={field}>
          Played by
          <select aria-label={`Seat ${seat} player`} style={select} value={s.seats[seat]} onChange={(e) => s.setSeat(seat, e.target.value === 'human' ? 'human' : 'bot')}>
            <option value="human">You</option>
            <option value="bot">Random bot</option>
          </select>
        </label>
      </div>
    )
  }
  return (
    <main style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: '#0a0a10', color: colors.text, fontFamily: fontStack }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <header>
          <h1 style={{ margin: 0, letterSpacing: '0.22em', textTransform: 'uppercase', fontSize: 28 }}>Mancermundo</h1>
          <p style={{ margin: '4px 0 0', color: colors.muted, fontSize: 13 }}>A fan-made skirmish in the dark corridors of a hive. Pick a scenario and two gangs.</p>
        </header>

        {s.saveNotice && (
          <div style={{ ...panel, padding: '8px 12px', fontSize: 13, borderLeft: `4px solid ${colors.accent}` }}>
            {s.saveNotice} <Btn onClick={s.dismissSaveNotice} style={{ marginLeft: 8 }}>OK</Btn>
          </div>
        )}
        {s.savedGame && (
          <div data-testid="continue" style={{ ...panel, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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

        <section style={{ ...panel, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={field}>
            Scenario
            <select aria-label="Scenario" style={select} value={s.scenarioId} onChange={(e) => s.setScenario(e.target.value)}>
              {scenarios.map((x) => (
                <option key={x.id} value={x.id} disabled={!scenarioPlayable(x.id)}>
                  {x.name}
                  {scenarioPlayable(x.id) ? '' : ' (not playable yet)'}
                </option>
              ))}
            </select>
          </label>
          {scenario && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: colors.muted }}>{(scenario as { text?: string }).text}</p>}
          <label style={field}>
            Board
            <select aria-label="Board" style={select} value={s.boardId} onChange={(e) => s.setBoard(e.target.value)}>
              {boards.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.layout === '2x3' ? '24 x 36' : '7 tiles'})
                </option>
              ))}
            </select>
          </label>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>{(['A', 'B'] as const).map(seatBox)}</div>

        <section style={{ ...panel, padding: 12, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ ...field, flex: 1, minWidth: 160 }}>
            Seed (the same seed and choices replay the same dice)
            <input aria-label="Seed" style={select} value={s.seed} onChange={(e) => s.setSeed(e.target.value)} />
          </label>
          <Btn onClick={() => s.setSeed(randomSeed())}>New seed</Btn>
          <Btn variant="primary" data-testid="start-battle" onClick={s.requestLaunch} style={{ fontSize: 15, padding: '9px 20px' }}>
            Start the battle
          </Btn>
        </section>

        {s.confirmReplace && (
          <div style={{ ...panel, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: `4px solid ${colors.danger}` }}>
            <span style={{ flex: 1, fontSize: 13 }}>Starting a new battle replaces the one saved on this device.</span>
            <Btn variant="danger" onClick={s.confirmLaunch}>Replace it</Btn>
            <Btn onClick={s.cancelLaunch}>Keep it</Btn>
          </div>
        )}

        <footer style={{ fontSize: 11, color: colors.muted }}>
          Fan-made project. Not affiliated with or endorsed by Games Workshop. Art, text and models are original. The lab viewer is at <a style={{ color: colors.muted }} href="?lab">?lab</a>.
        </footer>
      </div>
    </main>
  )
}
