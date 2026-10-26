// Start screen: seats (human / bot / hot-seat), teams, mission, layout, map and seed. Continues to the team
// builder, or straight to the briefing with default rosters (Quick start).
import type { CSSProperties, ReactNode } from 'react'
import type { Seat } from '@/engine'
import { MATS, matThumbUrl } from '../board/mats'
import { BOT_TIERS, type BotTier } from '../bot/botTier'
import { dataBundle } from '../game/adapter'
import { layoutList, missionList, teamList } from '../game/defaults'
import { useSettings, type AnimSpeed } from '../presentation/settings'
import { randomSeed, useSession } from '../store/session'
import { colors, fontStack, panel } from './theme'
import { Tooltip } from './Tooltip'
import { Btn, Dot, Muted } from './widgets'

const page: CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflowY: 'auto',
  background: 'radial-gradient(ellipse at 50% 20%, #1c2030 0%, #0a0a10 70%)',
  color: colors.text,
  fontFamily: fontStack,
  display: 'flex',
  justifyContent: 'center',
  padding: 'max(16px, var(--safe-top)) 16px 24px',
  boxSizing: 'border-box',
}

const field: CSSProperties = {
  background: '#171a26',
  color: colors.text,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '7px 8px',
  fontFamily: fontStack,
  fontSize: 13,
  minHeight: 34,
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
      <span style={{ color: colors.muted }}>{label}</span>
      {children}
    </label>
  )
}

const TIER_INFO: Record<BotTier, { label: string; help: string }> = {
  random: { label: 'Random', help: 'Picks any legal action. A gentle first game.' },
  easy: { label: 'Easy', help: 'Plays the best single action and ignores longer plans.' },
  normal: { label: 'Normal', help: 'Plans a whole activation, weighs cover and exposure, and goes for the objectives.' },
}
const SPEED_INFO: { id: AnimSpeed; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
  { id: 'instant', label: 'Instant' },
]

/** A row of toggle buttons (one selected); every target is at least 44 px tall for touch. */
function Segmented<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: { id: T; label: string }[]; onChange(v: T): void }) {
  return (
    <span role="radiogroup" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <Btn key={o.id} role="radio" aria-checked={o.id === value} data-testid={`${id}-${o.id}`} variant={o.id === value ? 'active' : 'base'} style={{ minHeight: 44, minWidth: 64 }} onClick={() => onChange(o.id)}>
          {o.label}
        </Btn>
      ))}
    </span>
  )
}

function MatPicker() {
  const matId = useSession((s) => s.matId)
  const setMat = useSession((s) => s.setMat)
  const base = import.meta.env.BASE_URL
  const tile = (id: string, name: string, thumb: string | null) => {
    const on = id === matId
    return (
      <Tooltip key={id} title={name} body={id === 'random' ? 'A different floor each game, picked from the seed.' : 'Use this floor every game.'}>
        <button
          type="button"
          role="radio"
          aria-checked={on}
          aria-label={name}
          data-testid={`mat-${id}`}
          onClick={() => setMat(id)}
          style={{
            width: 58,
            height: 58,
            padding: 0,
            borderRadius: 8,
            cursor: 'pointer',
            overflow: 'hidden',
            color: colors.text,
            fontFamily: fontStack,
            fontSize: 24,
            fontWeight: 800,
            background: thumb ? `center / cover url(${thumb})` : '#171a26',
            border: `2px solid ${on ? colors.accent : colors.border}`,
            boxShadow: on ? `0 0 0 2px ${colors.accent}55` : 'none',
          }}
        >
          {thumb ? null : '?'}
        </button>
      </Tooltip>
    )
  }
  return (
    <span role="radiogroup" aria-label="Floor mat" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tile('random', 'Random', null)}
      {MATS.map((m) => tile(m.id, m.name, matThumbUrl(m.id, base)))}
    </span>
  )
}

function SeatRow({ seat }: { seat: Seat }) {
  const s = useSession()
  const teams = teamList(dataBundle())
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <Dot seat={seat} />
      <select data-testid={`team-${seat}`} style={field} value={s.builds[seat].teamId} onChange={(e) => s.setTeam(seat, e.target.value)}>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select data-testid={`mode-${seat}`} style={field} value={s.seats[seat]} onChange={(e) => s.setSeat(seat, e.target.value as 'human' | 'bot')}>
        <option value="human">{seat === 'A' ? 'Human' : 'Human (hot-seat)'}</option>
        <option value="bot">Bot</option>
      </select>
    </div>
  )
}

export function StartScreen() {
  const s = useSession()
  const speed = useSettings((x) => x.animSpeed)
  const setSpeed = useSettings((x) => x.setAnimSpeed)
  const b = dataBundle()
  const layout = b.layouts[s.layoutId]
  const mission = b.missions[s.missionId]
  const maps = mission && layout ? mission.maps.filter((m) => layout.maps.some((lm) => lm.id === m.id)) : []
  return (
    <div className="ms-touch" style={page} data-testid="start-screen">
      <div style={{ width: 'min(620px, 100%)' }}>
        <h1 data-testid="title" style={{ fontSize: 'clamp(30px, 6vw, 46px)', margin: '14px 0 2px', letterSpacing: 1 }}>
          Mancermundo
        </h1>
        <Muted style={{ marginBottom: 14 }}>A fan-made kill team skirmish in the browser. Not affiliated with Games Workshop.</Muted>
        <div style={{ ...panel, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Seats and teams</div>
          <SeatRow seat="A" />
          <SeatRow seat="B" />
          <Muted style={{ marginBottom: 12 }}>Two humans share this screen (hot-seat); a bot answers its seat after the animations finish.</Muted>
          <Row label="Mission">
            <select data-testid="mission" style={field} value={s.missionId} onChange={(e) => s.setMission(e.target.value)}>
              {missionList(b).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Killzone layout">
            <select data-testid="layout" style={field} value={s.layoutId} onChange={(e) => s.setLayout(e.target.value)}>
              {layoutList(b).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Map">
            <select data-testid="map" style={field} value={s.mapId} onChange={(e) => s.setMap(e.target.value)}>
              <option value="auto">Roll from the seed</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Seed">
            <span style={{ display: 'flex', gap: 6 }}>
              <input data-testid="seed" style={{ ...field, flex: 1, minWidth: 0 }} value={s.seed} onChange={(e) => s.setSeed(e.target.value)} />
              <Btn data-testid="seed-random" onClick={() => s.setSeed(randomSeed())}>
                Random
              </Btn>
            </span>
          </Row>
          <div style={{ fontWeight: 700, margin: '14px 0 8px' }}>Options</div>
          <Row label="Bot level">
            <span>
              <Segmented id="bot-tier" value={s.botTier} options={BOT_TIERS.map((t) => ({ id: t, label: TIER_INFO[t].label }))} onChange={s.setBotTier} />
              <Muted style={{ marginTop: 4 }}>{TIER_INFO[s.botTier].help}</Muted>
            </span>
          </Row>
          <Row label="Animation speed">
            <Segmented id="anim" value={speed} options={SPEED_INFO} onChange={setSpeed} />
          </Row>
          <Row label="Floor mat">
            <MatPicker />
          </Row>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 6, minHeight: 44 }}>
            <input data-testid="manual-placement" type="checkbox" checked={s.manualPlacement} onChange={(e) => s.setManualPlacement(e.target.checked)} />
            Place objective and equipment markers myself
          </label>
          {mission && <Muted style={{ marginTop: 4 }}>{mission.text}</Muted>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Btn data-testid="go-builder" variant="primary" style={{ padding: '10px 18px', fontSize: 15 }} onClick={() => s.setScreen('builder')}>
              Choose rosters
            </Btn>
            <Btn data-testid="quick-start" style={{ padding: '10px 18px', fontSize: 15 }} onClick={() => s.setScreen('briefing')}>
              Quick start (default rosters)
            </Btn>
          </div>
        </div>
        <Muted style={{ marginTop: 12, display: 'flex', gap: 18 }}>
          <a data-testid="how-to-play" style={{ color: colors.accent, padding: '10px 0' }} href="#how-to-play" onClick={(e) => { e.preventDefault(); s.openHowTo() }}>
            How to play
          </a>
          <a style={{ color: colors.muted, padding: '10px 0' }} href="?gallery">
            Figure gallery
          </a>
        </Muted>
      </div>
    </div>
  )
}
