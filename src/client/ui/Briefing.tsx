// Briefing: the mission text and scoring from data, the kill-grade table for both rosters, the map, and the controls.
import { useEffect, useRef, type CSSProperties } from 'react'
import { killGradeThresholds } from '@/data'
import { dataBundle, flattenRoster } from '../game/adapter'
import { buildProblems } from '../game/defaults'
import { humanize } from '../game/labels'
import { useSession } from '../store/session'
import { colors, fontStack, panel } from './theme'
import { Keyword, KeywordText } from './Keyword'
import { Btn, Dot, Muted } from './widgets'

const page: CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflowY: 'auto',
  background: 'radial-gradient(ellipse at 50% 10%, #1c2030 0%, #0a0a10 70%)',
  color: colors.text,
  fontFamily: fontStack,
  display: 'flex',
  justifyContent: 'center',
  padding: 'max(14px, var(--safe-top)) 14px 20px',
  boxSizing: 'border-box',
}

export function Briefing() {
  const s = useSession()
  const b = dataBundle()
  const mission = b.missions[s.missionId]!
  const layout = b.layouts[s.layoutId]!
  const controlsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (s.howTo) controlsRef.current?.scrollIntoView({ block: 'start' })
  }, [s.howTo])
  const problems = (['A', 'B'] as const).flatMap((sd) => buildProblems(b, s.builds[sd], mission.equipmentLimit).map((p) => `Seat ${sd}: ${p}`))
  return (
    <div className="ms-touch" style={page} data-testid="briefing">
      <div style={{ width: 'min(720px, 100%)' }}>
        <h2 style={{ margin: '8px 0 2px', fontSize: 26 }} data-testid="briefing-title">
          {mission.name}
        </h2>
        <Muted style={{ marginBottom: 10 }}>
          {layout.name} &middot; {mission.turningPoints} <Keyword term="Turning points">turning points</Keyword> &middot; seed {s.seed}
        </Muted>
        <div style={{ ...panel, padding: 14, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Objectives</div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <KeywordText text={mission.text} />
          </div>
          <div style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>Scoring</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {mission.scoring.map((r) => (
              <li key={r.id} style={{ marginBottom: 2 }}>
                <b><Keyword term={r.op === 'crit' ? 'Crit op' : 'Kill op'} /></b> &middot; <KeywordText text={humanize(r.id)} />: {r.vp} <Keyword term="VP" />. <KeywordText text={r.text} />
              </li>
            ))}
          </ul>
          <div style={{ fontSize: 12, color: colors.muted, margin: '8px 0 4px' }}>
            <Keyword term="Kill op" />: enemy operatives to take down for grades 1 to 5
          </div>
          {(['A', 'B'] as const).map((sd) => {
            const enemy = sd === 'A' ? 'B' : 'A'
            const n = flattenRoster(b.teams[s.builds[enemy].teamId]!, s.builds[enemy].roster).length
            return (
              <div key={sd} style={{ fontSize: 12 }}>
                <Dot seat={sd} />
                Seat {sd} faces {n} operatives: {killGradeThresholds(mission, n).join(', ')}
              </div>
            )
          })}
        </div>
        <div style={{ ...panel, padding: 14, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Rosters</div>
          {(['A', 'B'] as const).map((sd) => {
            const t = b.teams[s.builds[sd].teamId]!
            return (
              <div key={sd} style={{ fontSize: 12, marginBottom: 4 }}>
                <Dot seat={sd} />
                <b>{t.name}</b> ({s.seats[sd] === 'bot' ? 'bot' : 'human'}): {flattenRoster(t, s.builds[sd].roster).map((id) => (b.byId[id] as { name: string }).name).join(', ')}
              </div>
            )
          })}
        </div>
        <div ref={controlsRef} data-testid="briefing-controls" style={{ ...panel, padding: 14, marginBottom: 10, ...(s.howTo ? { borderColor: colors.accent } : {}) }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Controls</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            <li>Left click: choose, deploy, add a move step, or pick an operative.</li>
            <li>Right-drag: orbit. Middle-drag or W A S D: pan. Wheel: zoom. Two fingers on touch.</li>
            <li>Move: click the board for each straight step; each step is rounded up to a whole inch. Enter confirms, Esc cancels.</li>
            <li>Touch: tap to choose, drag to look around, pinch to zoom; the drawers along the edge open the feed, log, mission and settings.</li>
            <li>Every prompt says what it decides; hover (or long-press) a button for its rule.</li>
            <li>
              <KeywordText text="Each activation has 2 AP (APL): the action bar lists what you can do and what each action costs (hover or long-press for the rule). End the activation when you are done." />
            </li>
            <li>Dotted underlines mark game terms: hover one (or tap it on a touch screen) to see what it means and what it does.</li>
          </ul>
        </div>
        {problems.length > 0 && (
          <div data-testid="briefing-problems" style={{ color: '#ff8a80', fontSize: 12, marginBottom: 8 }}>
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn data-testid="briefing-back" onClick={() => s.setScreen(s.howTo ? 'start' : 'builder')}>
            Back
          </Btn>
          <Btn data-testid="briefing-start" variant="primary" style={{ padding: '10px 22px', fontSize: 15 }} disabled={problems.length > 0} onClick={() => s.launch()}>
            Deploy
          </Btn>
        </div>
      </div>
    </div>
  )
}
