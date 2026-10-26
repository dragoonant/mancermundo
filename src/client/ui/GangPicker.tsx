// Gang picker: the four starter gangs side by side (house, credits, fighters), pick one for each seat, and read the whole roster
// before committing: every fighter with role, cost, weapons, wargear and skills, and a full card (characteristics, weapon profiles
// with traits) behind a button. Names and numbers come from the engine's runtime data, the same records the battle uses.
import { useState } from 'react'
import type { Seat } from '@/engine'
import { dataBundle } from '../game/adapter'
import { starterList, houseName } from '../game/defaults'
import { gangSummary, roleRank, ROLE_WORD, type RosterEntry } from '../game/gangs'
import { engineBundle } from '../game/adapter'
import { useSession } from '../store/session'
import { Keyword } from './Keyword'
import { linesForWeapons, StatGrid, WeaponTable } from './Panels'
import { Pill } from './promptParts'
import { colors, hazardStripe, hive, hivePage, plate, sectionTitle } from './theme'
import { Btn, Dot, seatColor } from './widgets'

function FighterRow({ f, gangId, open, onToggle }: { f: RosterEntry; gangId: string; open: boolean; onToggle: () => void }) {
  const b = engineBundle()
  const key = `${gangId}:${f.name}`
  return (
    <div data-testid={`roster-${key}`} style={{ borderTop: `1px solid ${colors.border}`, padding: '7px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill kind={f.role === 'leader' ? 'warn' : f.role === 'champion' ? 'info' : 'muted'} label={ROLE_WORD[f.role] ?? f.role} />
        <b>{f.name}</b>
        <span style={{ color: colors.muted, fontSize: 12 }}>{f.typeName}</span>
        <span style={{ marginLeft: 'auto', fontWeight: 700, color: hive.brass }}>{f.cost} cr</span>
        <Btn data-testid={`roster-card-${key}`} onClick={onToggle} style={{ padding: '3px 9px', fontSize: 12 }}>
          {open ? 'Hide card' : 'Card'}
        </Btn>
      </div>
      <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
        {f.weapons.map((w) => w.name).join(', ') || 'Unarmed'}
        {f.wargear.length > 0 ? ` · ${f.wargear.map((g) => g.name).join(', ')}` : ''}
        {f.skills.length > 0 ? ` · ${f.skills.join(', ')}` : ''}
      </div>
      {open && (
        <div data-testid="roster-open-card" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: 8, marginTop: 6, fontSize: 12 }}>
          <StatGrid printed={f.stats} />
          <div style={{ margin: '8px 0 2px', fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Weapons</div>
          <WeaponTable lines={linesForWeapons(b.weapons, f.weapons.map((w) => w.id))} traitNames={b.traits} />
          {f.wargear.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: colors.muted }}>Wargear: </span>
              {f.wargear.map((g, i) => (
                <span key={g.id}>
                  {i > 0 ? ', ' : ''}
                  <Keyword term={g.name} />
                  {g.save ? ` (${g.save}+ save)` : ''}
                </span>
              ))}
            </div>
          )}
          {f.skills.length > 0 && (
            <div>
              <span style={{ color: colors.muted }}>Skills: </span>
              {f.skills.map((s, i) => (
                <span key={s}>
                  {i > 0 ? ', ' : ''}
                  <Keyword term={s} />
                </span>
              ))}
            </div>
          )}
          {f.rules.length > 0 && (
            <div>
              <span style={{ color: colors.muted }}>Rules: </span>
              {f.rules.map((r, i) => (
                <span key={r.name}>
                  {i > 0 ? ', ' : ''}
                  <Keyword term={`${r.name}${r.x !== undefined ? ` (${r.x})` : ''}`} />
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function GangPicker() {
  const s = useSession()
  const b = dataBundle()
  const [seat, setSeat] = useState<Seat>('A')
  const [open, setOpen] = useState<string | null>(null)
  const chosen = s.builds[seat].starterId
  const summary = gangSummary(chosen)
  const roster = summary ? [...summary.fighters].sort((x, y) => roleRank(x.role) - roleRank(y.role)) : []
  return (
    <div className="ms-menu" data-testid="gang-picker" style={{ ...hivePage, padding: 'max(14px, var(--safe-top)) 14px 28px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={hazardStripe} />
        <header style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 26, letterSpacing: '0.08em', textTransform: 'uppercase', color: hive.chalk }}>Choose your gangs</h2>
            <div style={{ color: colors.muted, fontSize: 13 }}>Four ready-made gangs, each built to 1000 credits. Pick one for each seat, then read its roster.</div>
          </div>
          <Btn data-testid="gangs-done" variant="primary" onClick={() => s.setScreen('start')}>
            Done
          </Btn>
        </header>

        <div role="tablist" style={{ display: 'flex', gap: 8 }}>
          {(['A', 'B'] as const).map((x) => {
            const g = b.starterGangs[s.builds[x].starterId]
            return (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={seat === x}
                data-testid={`seat-tab-${x}`}
                onClick={() => {
                  setSeat(x)
                  setOpen(null)
                }}
                style={{ flex: 1, textAlign: 'left', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', font: 'inherit', color: colors.text, background: seat === x ? 'rgba(214,162,58,0.14)' : 'rgba(255,255,255,0.04)', border: `1px solid ${seat === x ? hive.brass : colors.border}`, borderTop: `4px solid ${seatColor(x)}` }}
              >
                <div style={{ fontSize: 11, color: colors.muted }}>
                  Gang {x} · {s.seats[x] === 'bot' ? 'bot' : s.opponent === 'hotseat' ? `player ${x}` : 'you'}
                </div>
                <div style={{ fontWeight: 800 }}>{g?.name ?? '?'}</div>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {starterList(b).map((g) => {
            const sum = gangSummary(g.id)
            const picked = chosen === g.id
            return (
              <button
                key={g.id}
                type="button"
                data-testid={`gang-${g.id}`}
                aria-pressed={picked}
                onClick={() => {
                  s.setStarter(seat, g.id)
                  setOpen(null)
                }}
                style={{ ...plate, textAlign: 'left', padding: 12, cursor: 'pointer', font: 'inherit', borderColor: picked ? hive.brass : 'rgba(214,162,58,0.22)', outline: picked ? `2px solid ${hive.brass}` : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                <span style={{ ...sectionTitle, color: colors.muted }}>{houseName(b, g.house)}</span>
                <span style={{ fontSize: 17, fontWeight: 800 }}>{g.name}</span>
                <span style={{ fontSize: 12, color: hive.brass }}>
                  {sum?.cost ?? g.credits} of {g.credits} credits · {g.fighters.length} fighters
                </span>
                <span style={{ fontSize: 12, color: colors.muted, lineHeight: 1.4 }}>{g.text}</span>
                {picked && (
                  <span style={{ marginTop: 'auto', paddingTop: 4 }}>
                    <Dot seat={seat} />
                    <b style={{ fontSize: 12 }}>Chosen for Gang {seat}</b>
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {summary && (
          <div data-testid="gang-roster" style={{ ...plate, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={sectionTitle}>
                {summary.name} · {houseName(b, summary.houseId)}
              </h3>
              <span style={{ fontSize: 12, color: colors.muted }}>
                {summary.fighters.length} fighters · {summary.cost} credits
              </span>
            </div>
            {roster.map((f) => {
              const k = `${summary.id}:${f.name}`
              return <FighterRow key={k} f={f} gangId={summary.id} open={open === k} onToggle={() => setOpen(open === k ? null : k)} />
            })}
          </div>
        )}
      </div>
    </div>
  )
}
