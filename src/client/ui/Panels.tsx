// The fighter card and the weapon profile table. FighterCard shows one fighter from the DISPLAY state: all twelve characteristics
// (values the game has changed are highlighted, with the printed value in a tooltip), Wounds and Flesh Wounds, status and
// conditions, weapons with their full profiles and traits, wargear, skills and fighter rules. Every number is read through
// `query.*` or from the state; the glossary explains each term on hover. The same pieces draw the roster in the gang picker.
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { query, type Fighter, type GameState, type RuntimeWeapon, type StatKey } from '@/engine'
import { lookupTerm } from '../game/glossary'
import { humanize, postureWord } from '../game/labels'
import { lineFor, nerveOdds, pct, profileLines, STAT_KEYS, statText, strengthText, type ProfileLine } from '../game/odds'
import { CollapseButton, CollapsedTab, useCollapsed } from './collapse'
import { Keyword } from './Keyword'
import { TraitList } from './Keyword'
import { Pill } from './promptParts'
import { Tooltip } from './Tooltip'
import { useFormFactor } from './formFactor'
import { colors, fontStack, panel } from './theme'
import { Btn, seatColor } from './widgets'

// ---------------------------------------------------------------- statuses

const STATUS_WORD: Record<string, string> = {
  standingActive: 'Standing and Active',
  standingEngaged: 'Standing and Engaged',
  pinned: 'Pinned',
  seriouslyInjured: 'Seriously Injured',
  outOfAction: 'Out of Action',
}

/** Chips for the fighter's status, Ready, Broken and every other condition; each is a glossary keyword. */
export function StatusChips({ state, f }: { state: GameState; f: Fighter }) {
  const chips: { term: string; label: string; kind: 'good' | 'warn' | 'bad' | 'info' | 'muted' }[] = []
  if (f.location === 'outOfAction') chips.push({ term: 'Out of Action', label: 'Out of Action', kind: 'bad' })
  else if (f.location === 'fled') chips.push({ term: 'Fled', label: 'Fled the field', kind: 'bad' })
  else if (f.location === 'reserve') chips.push({ term: 'Ready', label: 'In reserve', kind: 'muted' })
  else {
    const st = query.status(state, f.id)
    const label = STATUS_WORD[st] ?? humanize(st)
    chips.push({ term: label, label, kind: st === 'standingActive' ? 'good' : st === 'standingEngaged' ? 'warn' : 'bad' })
    if (f.ready && state.phase === 'action') chips.push({ term: 'Ready', label: 'Ready', kind: 'info' })
  }
  for (const c of Object.keys(f.conditions)) chips.push({ term: humanize(c), label: humanize(c), kind: c === 'broken' ? 'bad' : 'warn' })
  if (f.fleshWounds > 0) chips.push({ term: 'Flesh Wound', label: `${f.fleshWounds} Flesh Wound${f.fleshWounds === 1 ? '' : 's'}`, kind: 'bad' })
  if (f.carrying) chips.push({ term: 'Carry Loot Casket / Ammo Cache', label: 'Carrying a casket', kind: 'info' })
  return (
    <div data-testid="status-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {chips.map((c) => (
        <Pill key={c.label} kind={c.kind} label={c.label} term={c.term} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- characteristics

const statCell: CSSProperties = { background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 0', textAlign: 'center' }

/** The twelve characteristics in two rows of six. `printed` and `now` differ where the game has changed a value. */
export function StatGrid({ printed, now }: { printed: Record<StatKey, number>; now?: Record<StatKey, number> }) {
  return (
    <div data-testid="fighter-profile" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2 }}>
      {STAT_KEYS.map((k) => {
        const eff = now ? now[k] : printed[k]
        const changed = eff !== printed[k]
        if (!changed) {
          return (
            <div key={k} style={statCell} data-stat={k} data-changed="0">
              <div style={{ fontSize: 10, color: colors.muted }}>
                <Keyword term={k}>{k}</Keyword>
              </div>
              <div style={{ fontWeight: 700, color: colors.text }}>{statText(k, eff)}</div>
            </div>
          )
        }
        const rule = lookupTerm(k)
        return (
          <Tooltip
            key={k}
            title={`${rule?.aliases?.[0] ?? k} changed`}
            body={`Printed ${statText(k, printed[k])}, now ${statText(k, eff)}. Wounds, conditions and rules can change a characteristic for a while or for the rest of the battle.${rule ? ` ${rule.body}` : ''}`}
          >
            <div style={{ ...statCell, outline: `1px solid ${colors.accent}55` }} data-stat={k} data-changed="1">
              <div style={{ fontSize: 10, color: colors.muted }}>{k}</div>
              <div style={{ fontWeight: 700, color: colors.accent }}>{statText(k, eff)}</div>
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}

export function WoundPips({ wounds, max }: { wounds: number; max: number }) {
  return (
    <span aria-label={`${wounds} of ${max} Wounds`} style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
      {Array.from({ length: Math.min(max, 12) }, (_, i) => (
        <span key={i} style={{ width: 11, height: 11, borderRadius: 3, background: i < wounds ? '#ff6a5f' : '#33343c', border: '1px solid rgba(255,255,255,0.25)' }} />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- weapons

const th: CSSProperties = { fontSize: 10, color: colors.muted, fontWeight: 600, textAlign: 'left', padding: '1px 4px 1px 0', whiteSpace: 'nowrap' }
const td: CSSProperties = { fontSize: 11, padding: '2px 4px 2px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }

const AMMO_PILL: Record<string, { label: string; kind: 'bad' | 'warn' }> = {
  out: { label: 'Out of ammo', kind: 'bad' },
  jammed: { label: 'Jammed', kind: 'bad' },
  spent: { label: 'Spent', kind: 'warn' },
}

/** Weapon profiles with their full line: range S / L, accuracy S / L, S, AP, D, Am and traits. */
export function WeaponTable({ lines, traitNames }: { lines: ProfileLine[]; traitNames: Record<string, { name: string }> }) {
  const nameOf = (id: string) => traitNames[id]?.name ?? humanize(id)
  if (lines.length === 0) return <div style={{ fontSize: 12, color: colors.muted }}>Unarmed</div>
  return (
    <div style={{ overflowX: 'auto' }} data-testid="weapon-table">
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={th}>Weapon</th>
            <th style={th}><Keyword term="Short range">Range</Keyword></th>
            <th style={th}><Keyword term="Acc" /></th>
            <th style={th}><Keyword term="S" /></th>
            <th style={th}><Keyword term="AP" /></th>
            <th style={th}><Keyword term="Damage">D</Keyword></th>
            <th style={th}><Keyword term="Am" /></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <WeaponRows key={`${l.weaponId}:${l.profileId}`} l={l} nameOf={nameOf} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WeaponRows({ l, nameOf }: { l: ProfileLine; nameOf: (id: string) => string }) {
  const ammo = AMMO_PILL[l.ammoState]
  return (
    <>
      <tr data-testid={`weapon-${l.weaponId}`} style={{ opacity: l.lost ? 0.45 : 1 }}>
        <td style={{ ...td, whiteSpace: 'normal', fontWeight: 700 }}>
          {l.weaponName}
          {l.profileName ? <span style={{ color: colors.muted, fontWeight: 500 }}> ({l.profileName.toLowerCase()})</span> : null}
        </td>
        <td style={td}>{l.range}</td>
        <td style={td}>{l.acc}</td>
        <td style={td}>{l.strength}</td>
        <td style={td}>{l.ap}</td>
        <td style={td}>{l.damage}</td>
        <td style={td}>{l.ammo}</td>
      </tr>
      <tr>
        <td colSpan={7} style={{ ...td, whiteSpace: 'normal', color: colors.muted, paddingBottom: 5 }}>
          <span style={{ textTransform: 'capitalize' }}>{l.weaponClass}</span>
          {l.traits.length > 0 ? ' · ' : ''}
          <TraitList traits={l.traits} nameOf={nameOf} />
          {ammo && (
            <span style={{ marginLeft: 6 }}>
              <Pill kind={ammo.kind} label={ammo.label} term="Out of Ammo" />
            </span>
          )}
          {l.lost && <span style={{ marginLeft: 6 }}>(profile gone for the battle)</span>}
        </td>
      </tr>
    </>
  )
}

/** Profile lines for weapons with no wielder (the gang picker): Strength shown as printed. */
export function linesForWeapons(weapons: Record<string, RuntimeWeapon>, ids: string[]): ProfileLine[] {
  const out: ProfileLine[] = []
  for (const id of ids) {
    const w = weapons[id]
    if (w) for (const p of w.profiles) out.push(lineFor(w, p, strengthText(p, null)))
  }
  return out
}

// ---------------------------------------------------------------- the card

const section: CSSProperties = { marginTop: 7 }
const heading: CSSProperties = { fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }

function nameList(items: ReactNode[]): ReactNode {
  return items.map((n, i) => (
    <span key={i}>
      {i > 0 ? ', ' : ''}
      {n}
    </span>
  ))
}

export function FighterCard({ state, fighterId, width = 300, onClose }: { state: GameState; fighterId: string; width?: number | string; onClose?: () => void }) {
  const f = state.fighters[fighterId]
  const ff = useFormFactor()
  const [stored] = useCollapsed('fighter-card')
  const collapsed = stored && !ff.compact
  const lines = useMemo(() => (f ? profileLines(state, f.id) : []), [state, f])
  const nerve = f ? nerveOdds(state, f.id) : null
  if (!f) return null
  const type = state.data.fighterTypes[f.typeId]
  const now = Object.fromEntries(STAT_KEYS.map((k) => [k, query.stat(state, f.id, k)])) as Record<StatKey, number>
  const sk = (id: string) => state.data.skills[id]?.name ?? humanize(id)
  const gear = f.wargear.map((g) => state.data.wargear[g])
  if (collapsed) return <CollapsedTab id="fighter-card" title={f.name} testId="fighter-card" style={{ pointerEvents: 'auto' }} />
  const frame: CSSProperties = {
    ...panel,
    width,
    maxHeight: ff.compact ? 'calc(100vh - 24px)' : 'calc(100vh - 170px)',
    overflowY: 'auto',
    padding: '8px 10px',
    fontFamily: fontStack,
    fontSize: 12,
    pointerEvents: 'auto',
    boxSizing: 'border-box',
    borderTop: `4px solid ${seatColor(f.seat)}`,
    ...(onClose ? { background: colors.bgSolid } : {}),
  }
  return (
    <div data-testid="fighter-card" data-fighter={f.id} data-seat={f.seat} style={frame}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <b style={{ fontSize: 15 }}>{f.name}</b>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.muted }}>
          {type?.name ?? f.role}
          {onClose ? (
            <Btn data-testid="fighter-sheet-close" onClick={onClose} style={{ minHeight: 44, minWidth: 44 }}>
              Close
            </Btn>
          ) : (
            <CollapseButton id="fighter-card" title={f.name} />
          )}
        </span>
      </div>
      <div style={{ margin: '4px 0 6px' }}>
        <StatusChips state={state} f={f} />
      </div>
      <StatGrid printed={f.stats} now={now} />
      <div style={{ ...section, display: 'flex', alignItems: 'center', gap: 8 }} data-testid="card-wounds">
        <Keyword term="W">Wounds</Keyword>
        <WoundPips wounds={f.wounds} max={f.maxWounds} />
        <b>
          {f.wounds}/{f.maxWounds}
        </b>
        {f.posture !== 'standing' && <span style={{ color: colors.muted }}>{postureWord(f.posture)}</span>}
      </div>
      <div style={{ ...section, color: colors.muted }}>
        <Keyword term="Nerve test">Nerve</Keyword>: Cool {statText('Cl', now.Cl)}, +1 per steady friend within 3"
        {nerve?.pPass != null ? ` · ${pct(nerve.pPass)} to hold` : ''}
      </div>
      <div style={section}>
        <div style={heading}>Weapons</div>
        <WeaponTable lines={lines} traitNames={state.data.traits} />
      </div>
      {gear.length > 0 && (
        <div style={section} data-testid="card-wargear">
          <div style={heading}>Wargear</div>
          {nameList(
            gear.map((g, i) => (g ? <span key={g.id}><Keyword term={g.name}>{g.name}</Keyword>{g.save ? ` (${g.save}+ save)` : ''}</span> : <span key={i}>{f.wargear[i]}</span>)),
          )}
        </div>
      )}
      {f.skills.length > 0 && (
        <div style={section} data-testid="card-skills">
          <div style={heading}>Skills</div>
          {nameList(f.skills.map((id) => <Keyword key={id} term={sk(id)} />))}
        </div>
      )}
      {f.rules.length > 0 && (
        <div style={section} data-testid="card-rules">
          <div style={heading}>Fighter rules</div>
          {nameList(f.rules.map((r) => <Keyword key={r.id} term={`${sk(r.id).replace(/ \(X\)$/, '')}${r.x !== undefined ? ` (${r.x})` : ''}`} />))}
        </div>
      )}
    </div>
  )
}
