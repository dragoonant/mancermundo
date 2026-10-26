// Side panel for the sight-line tools: every enemy as seen from the operative's planned end point (or from where
// it stands), sorted by expected damage, plus the threat view (who could hit it back there, under Engage and under
// Conceal). On a phone the same list folds into a bottom sheet above the decision prompt. Read-only.
import { useEffect, type CSSProperties } from 'react'
import { SIGHT_COLOR, THREAT_COLOR } from '../board/Sightlines'
import { threatShowing, useSightData, type SightData } from '../interaction/sightData'
import { useSight } from '../interaction/sightStore'
import type { SightEntry, ThreatEntry, ThreatSet } from '../interaction/sightlines'
import { BottomSheet } from './BottomSheet'
import { Keyword, KeywordText } from './Keyword'
import { useFormFactor } from './formFactor'
import { colors, fontStack, panel } from './theme'
import { Tooltip } from './Tooltip'
import { useUi } from './uiStore'
import { Btn, Muted } from './widgets'

const f1 = (n: number): string => n.toFixed(1)
const pct = (v: number): string => `${Math.round(v * 100)}%`

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/** T toggles the threat view. Mounted once (the panel is always in the tree during a battle). */
function useThreatHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || e.key.toLowerCase() !== 't') return
      useSight.getState().toggleThreat(threatShowing())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function statusText(e: SightEntry): string {
  switch (e.status) {
    case 'valid':
      return 'clear shot'
    case 'cover':
      return e.forcedChoice ? 'in cover (or obscured)' : 'in cover'
    case 'obscured':
      return e.inCover ? 'in cover and obscured' : 'obscured'
    case 'blocked':
      return e.reason ?? 'no shot'
    default:
      return e.reason && e.reason !== 'not visible' ? e.reason : 'not visible'
  }
}

function Row({ e, was, showWas }: { e: SightEntry; was: SightEntry | null; showWas: boolean }) {
  const color = SIGHT_COLOR[e.status]
  const wasText = showWas ? (was?.expected !== null && was?.expected !== undefined ? `was ${f1(was.expected)}` : 'was no shot') : null
  return (
    <div
      data-testid={`sight-row-${e.id}`}
      data-status={e.status}
      onMouseEnter={() => useUi.setState({ hoverOp: e.id })}
      onMouseLeave={() => useUi.setState({ hoverOp: null })}
      style={{ borderLeft: `4px solid ${color}`, padding: '3px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, opacity: e.status === 'unseen' ? 0.75 : 1 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
        <b style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.name} <span style={{ color: colors.muted, fontWeight: 500 }}>{e.id}</span>
        </b>
        <span data-testid={`sight-dmg-${e.id}`} style={{ color, fontWeight: 800, whiteSpace: 'nowrap' }}>
          {e.expected !== null ? (
            <>
              {f1(e.expected)} <Keyword term="Dmg">dmg</Keyword>
            </>
          ) : e.status === 'unseen' ? (
            'not visible'
          ) : (
            'no shot'
          )}
        </span>
      </div>
      <div style={{ fontSize: 11, color: colors.muted }}>
        {f1(e.distance)}″ · <KeywordText text={statusText(e)} keywords={false} />
        {e.kill !== null && ` · kill ${pct(e.kill)}`}
        {e.weaponName && e.expected !== null && ` · ${e.weaponName}`}
        {wasText && <span data-testid={`sight-was-${e.id}`}> · {wasText}</span>}
      </div>
    </div>
  )
}

function ThreatSummary({ label, set, wounds, testId, mine }: { label: string; set: ThreatSet; wounds: number; testId: string; mine: boolean }) {
  return (
    <div data-testid={testId} style={{ fontSize: 12, color: set.entries.length === 0 ? colors.muted : THREAT_COLOR }}>
      <b><KeywordText text={label} /></b>
      {mine && <span style={{ color: colors.muted }}> (current)</span>}
      {': '}
      {set.entries.length === 0
        ? 'nobody can shoot you'
        : `${set.entries.length} shooter${set.entries.length === 1 ? '' : 's'} · ${f1(set.total)} dmg (worst ${f1(set.max)}) of ${wounds} wounds`}
    </div>
  )
}

function ThreatRow({ t, c }: { t: ThreatEntry; c: ThreatEntry | undefined }) {
  return (
    <div
      data-testid={`threat-row-${t.id}`}
      onMouseEnter={() => useUi.setState({ hoverOp: t.id })}
      onMouseLeave={() => useUi.setState({ hoverOp: null })}
      style={{ borderLeft: `4px solid ${THREAT_COLOR}`, padding: '2px 6px', background: 'rgba(255,90,79,0.07)', borderRadius: 4 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.name} <span style={{ color: colors.muted, fontWeight: 500 }}>{t.id}</span>
        </b>
        <span style={{ color: THREAT_COLOR, fontWeight: 800, whiteSpace: 'nowrap' }}>
          {f1(t.expected)} / {c ? f1(c.expected) : '0.0'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: colors.muted }}>
        {f1(t.distance)}″ · {t.weaponName}
        <KeywordText text={`${t.inCover ? ' · you in cover' : ''}${t.obscured ? ' · obscured' : ''} · Engage / Conceal`} />
      </div>
    </div>
  )
}

function UnseenChips({ entries }: { entries: SightEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div data-testid="sight-unseen" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', borderLeft: `4px solid ${SIGHT_COLOR.unseen}`, padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, opacity: 0.6 }}>
      <span style={{ fontSize: 11, color: colors.muted }}>
        Not <Keyword term="Visible">visible</Keyword>:
      </span>
      {entries.map((e) => (
        <span
          key={e.id}
          data-testid={`sight-row-${e.id}`}
          data-status="unseen"
          onMouseEnter={() => useUi.setState({ hoverOp: e.id })}
          onMouseLeave={() => useUi.setState({ hoverOp: null })}
          style={{ fontSize: 11, color: colors.muted, background: 'rgba(255,255,255,0.07)', borderRadius: 4, padding: '0 5px' }}
        >
          {e.name} {e.id} {f1(e.distance)}″
        </span>
      ))}
    </div>
  )
}

function Body({ d, compact }: { d: SightData; compact: boolean }) {
  const threatToggle = useSight((s) => s.toggleThreat)
  const { sight, before, threat, threatOn, view } = d
  const staged = view.after !== null
  const beforeMap = new Map((before?.entries ?? []).map((e) => [e.id, e]))
  const conceal = new Map((threat?.conceal.entries ?? []).map((t) => [t.id, t]))
  const where = staged ? 'planned end point' : view.moving ? 'where it stands (no path staged)' : 'where it stands'
  const seen = sight.entries.filter((e) => e.status !== 'unseen')
  const unseen = sight.entries.filter((e) => e.status === 'unseen')
  return (
    <>
      <div data-testid="sight-top" style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 auto' }}>
        {!compact && (
          <div style={{ fontSize: 11, color: colors.muted }} data-testid="sight-where">
            {sight.name} {sight.opId} at {where}
            {view.moveKind && view.after ? ` after ${view.moveKind}` : ''}
          </div>
        )}
        {view.pathBlocked && (
          <div data-testid="sight-blocked" style={{ fontSize: 11, color: '#ff8a80' }}>
            The staged path is not allowed: showing the current position.
          </div>
        )}
        {sight.concealLocked && (
          <Muted>
            <KeywordText text="On Conceal only Silent weapons may fire: odds assume Engage." />
          </Muted>
        )}
        {sight.noWeapon && !sight.concealLocked && <Muted>No ranged weapon can be used from here.</Muted>}
        {sight.inControlRangeOf.length > 0 && (
          <Muted>
            <KeywordText text={`Inside the control range of ${sight.inControlRangeOf.join(', ')}.`} keywords={false} />
          </Muted>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Tooltip title="Threat view (T)" body="Who could see and target this operative at this spot, and the damage they would expect, if it ends on Engage and if it ends on Conceal.">
            <Btn data-testid="sight-threat-toggle" variant={threatOn ? 'active' : 'base'} style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => threatToggle(threatOn)}>
              Threat (T)
            </Btn>
          </Tooltip>
          <span style={{ fontSize: 11, color: colors.muted, display: compact ? 'none' : undefined }}>
            <span style={{ color: SIGHT_COLOR.valid }}>clear</span> ·{' '}
            <span style={{ color: SIGHT_COLOR.cover }}>
              <Keyword term="In cover">cover</Keyword> / <Keyword term="Obscured" />
            </span>{' '}
            · <span style={{ color: SIGHT_COLOR.unseen }}>unseen (no line)</span>
            {threatOn && <> · <span style={{ color: THREAT_COLOR }}>threat</span></>}
          </span>
        </div>
        {threatOn && threat && (
          <div data-testid="threat-block" style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '3px 6px', borderLeft: `4px solid ${THREAT_COLOR}`, background: 'rgba(255,90,79,0.08)', borderRadius: 4 }}>
            <ThreatSummary label="If Engage" set={threat.engage} wounds={threat.wounds} testId="threat-engage" mine={sight.order === 'engage'} />
            <ThreatSummary label="If Conceal" set={threat.conceal} wounds={threat.wounds} testId="threat-conceal" mine={sight.order === 'conceal'} />
          </div>
        )}
      </div>
      <div data-testid="sight-list" style={{ display: 'flex', flexDirection: 'column', gap: 3, ...(compact ? {} : { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }) }}>
        {sight.entries.length === 0 && <Muted>No enemies on the board.</Muted>}
        {seen.map((e) => (
          <Row key={e.id} e={e} was={beforeMap.get(e.id) ?? null} showWas={staged} />
        ))}
        <UnseenChips entries={unseen} />
        {threatOn && threat && threat.engage.entries.length > 0 && (
          <>
            <div style={{ fontWeight: 800, fontSize: 12, color: THREAT_COLOR, marginTop: 2 }}>
              <KeywordText text={`Could shoot ${sight.name} here (Engage / Conceal)`} keywords={false} />
            </div>
            {threat.engage.entries.map((t) => (
              <ThreatRow key={t.id} t={t} c={conceal.get(t.id)} />
            ))}
          </>
        )}
      </div>
    </>
  )
}

function summaryOf(d: SightData): string {
  const seen = d.sight.entries.filter((e) => e.visible).length
  const best = d.sight.entries.find((e) => e.expected !== null)
  const base = `${seen} visible${best?.expected != null ? ` · best ${f1(best.expected)} dmg` : ''}`
  return d.threat ? `${base} · threat ${f1(d.threat.engage.total)}/${f1(d.threat.conceal.total)}` : base
}

const floating: CSSProperties = {
  ...panel,
  position: 'absolute',
  top: 66,
  left: 8,
  width: 288,
  maxHeight: 'calc(100% - 300px)',
  minHeight: 0,
  overflow: 'hidden',
  padding: '8px 10px',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  fontFamily: fontStack,
  zIndex: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}

export function SightlinePanel() {
  useThreatHotkey()
  const compact = useFormFactor().compact
  const on = useSight((s) => s.on)
  const d = useSightData()
  if (!on) {
    return (
      <Btn
        data-testid="sight-show"
        style={{ position: 'absolute', top: compact ? 60 : 66, left: 8, padding: '3px 8px', fontSize: 12, pointerEvents: 'auto', zIndex: 18 }}
        onClick={() => useSight.getState().setOn(true)}
      >
        Sightlines: off
      </Btn>
    )
  }
  if (!d) return null
  if (compact) {
    return (
      <div className="ms-sight" style={{ position: 'absolute', left: 0, right: 0, bottom: 58, height: 0, zIndex: 29, pointerEvents: 'none' }}>
        <style>{'.ms-sight .ms-sheet { max-height: 46vh; max-height: 46dvh; }'}</style>
        <BottomSheet testId="sight-sheet" title={<span data-testid="sight-summary">Sightlines · {summaryOf(d)}</span>} auto autoKey={d.view.opId}>
          <div data-testid="sight-panel">
            <Body d={d} compact />
            <Btn style={{ marginTop: 6, fontSize: 12 }} onClick={() => useSight.getState().setOn(false)}>
              Hide sightlines
            </Btn>
          </div>
        </BottomSheet>
      </div>
    )
  }
  return (
    <div data-testid="sight-panel" className="ms-touch" style={floating}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: '0 0 auto' }}>
        <b style={{ fontSize: 14 }}>Sightlines</b>
        <Btn data-testid="sight-hide" style={{ padding: '1px 7px', fontSize: 11 }} onClick={() => useSight.getState().setOn(false)}>
          Hide
        </Btn>
      </div>
      <Body d={d} compact={false} />
    </div>
  )
}
