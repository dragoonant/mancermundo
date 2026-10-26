// Side panels of the battle screen: operative card, event feed, dice log, mission panel, settings. On the
// compact (phone) layout they become right-edge drawers opened from the HUD menu; on desktop they stack in
// two columns. All numbers are read from the DISPLAY state.
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { DatacardData } from '@/data'
import type { Order, Seat } from '@/engine'
import { effectiveApl } from '@/engine/state'
import { killStatus, mission } from '../game/kill'
import { dataBundle } from '../game/adapter'
import { humanize, SEAT_NAME } from '../game/labels'
import { useAudioSettings } from '../audio'
import { groupFeed, useFeedStore } from '../presentation/feedStore'
import { useDisplayState } from '../presentation/presentedStore'
import { useSettings, type AnimSpeed } from '../presentation/settings'
import { useGame } from '../store/game'
import { useSession } from '../store/session'
import { useFormFactor } from './formFactor'
import { AP_DARK, AP_LIT, ORDER_COLOR, apTip, orderTip, woundTip } from './markerInfo'
import { colors, fontStack, panel } from './theme'
import { Keyword, KeywordText, WeaponRules } from './Keyword'
import { Tooltip } from './Tooltip'
import { useUi, type DrawerId } from './uiStore'
import { Btn, Die, Dot, Muted, seatColor } from './widgets'

const drawerStyle: CSSProperties = {
  ...panel,
  position: 'absolute',
  top: 60,
  right: 0,
  bottom: 0,
  width: 'min(330px, 60vw)',
  borderRadius: '10px 0 0 10px',
  background: colors.bgSolid,
  padding: 10,
  boxSizing: 'border-box',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  pointerEvents: 'auto',
  zIndex: 50,
  fontFamily: fontStack,
}

// Panels are flex columns so a scrolling child (feed, dice log) can fill the remaining height with
// `scrollFill` instead of guessing the chrome height; the box itself then never grows a second scroll bar.
const floatStyle: CSSProperties = { ...panel, padding: 10, boxSizing: 'border-box', pointerEvents: 'auto', fontFamily: fontStack, overflowY: 'auto', display: 'flex', flexDirection: 'column' }
export const scrollFill: CSSProperties = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }

/** One panel: a drawer on compact, a floating box on desktop. `open` is the desktop visibility. */
export function PanelBox({ id, title, testId, open, children, style }: { id: DrawerId; title: string; testId: string; open: boolean; children: ReactNode; style?: CSSProperties }) {
  const compact = useFormFactor().compact
  const drawer = useUi((s) => s.drawer)
  if (compact) {
    if (drawer !== id) return null
    return (
      <div data-testid={testId} className="ms-touch" style={drawerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flex: '0 0 auto' }}>
          <b>{title}</b>
          <Btn onClick={() => useUi.setState({ drawer: null })}>
            Close
          </Btn>
        </div>
        {children}
      </div>
    )
  }
  if (!open) return null
  return (
    <div data-testid={testId} style={{ ...floatStyle, ...style }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, flex: '0 0 auto' }}>{title}</div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- operative card

/** The order token as drawn over the figure: blue square for Conceal, orange diamond for Engage. */
function OrderGlyph({ order }: { order: Order }) {
  return <span aria-hidden style={{ display: 'inline-block', width: 9, height: 9, background: ORDER_COLOR[order], transform: order === 'engage' ? 'rotate(45deg) scale(0.85)' : undefined, verticalAlign: 0 }} />
}

/** The AP pips as drawn over the figure: yellow = still available. */
function ApDots({ total, lit }: { total: number; lit: number }) {
  return (
    <span aria-hidden style={{ display: 'inline-flex', gap: 2, verticalAlign: 1 }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i < lit ? AP_LIT : AP_DARK, border: '1px solid #55576a', boxSizing: 'border-box' }} />
      ))}
    </span>
  )
}

export function OperativeCard({ docked }: { docked?: boolean }) {
  const state = useDisplayState()
  const selected = useUi((s) => s.selectedOp)
  const hover = useUi((s) => s.hoverOp)
  const id = selected ?? hover
  const op = id && state ? state.operatives[id] : null
  const compactDrawer = useFormFactor().compact
  if (!state || !op) return null
  const card = dataBundle().byId[op.datacardId] as DatacardData | undefined
  const weapons = op.weapons.map((w) => state.data.weapons[w]).filter(Boolean)
  // the same three markers that float over the figure, each with its glyph and tooltip
  const act = state.firefight.activation
  const apSpent = act && act.operativeId === op.id && !act.counteract ? act.apSpent : null
  const apl = effectiveApl(op)
  const lit = apSpent !== null ? Math.max(0, apl - apSpent) : op.ready ? apl : 0
  const ot = orderTip(op.order)
  const at = apTip(apl, lit, apSpent !== null, op.ready)
  const wt = woundTip(op.wounds, op.maxWounds, op.flags.injured)
  const body = (
    <div data-testid="operative-card" data-op={op.id}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Dot seat={op.seat} />
        <b style={{ fontSize: 14 }}>{op.name}</b>
        <span style={{ color: colors.muted, fontSize: 12 }}>{op.id}</span>
      </div>
      <div style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginBottom: 6 }}>
        <Tooltip title={ot.title} body={ot.body}>
          <span data-testid="card-order">
            <OrderGlyph order={op.order} /> <b>{humanize(op.order)}</b> order &middot; {op.ready ? 'ready' : 'expended'}
          </span>
        </Tooltip>
        <Tooltip title={at.title} body={at.body}>
          <span data-testid="card-ap">
            <ApDots total={apl} lit={lit} /> APL <b>{apl}</b>
          </span>
        </Tooltip>
        <Tooltip title={wt.title} body={wt.body}>
          <span>
            Wounds <b>{op.wounds}/{op.maxWounds}</b>
          </span>
        </Tooltip>
        <span>
          <Keyword term="Move" /> <b>{op.move}&Prime;</b>
        </span>
        <span>
          <Keyword term="Save" /> <b>{op.save}+</b>
        </span>
        {op.flags.guard && <b style={{ color: colors.accent }}><Keyword term="On Guard" /></b>}
        {op.flags.injured && <b style={{ color: colors.danger }}><Keyword term="Injured" /></b>}
      </div>
      {!compactDrawer && (
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: colors.muted, textAlign: 'left' }}>
            <th>Weapon</th>
            <th><Keyword term="Atk">A</Keyword></th>
            <th><Keyword term="Hit" /></th>
            <th><Keyword term="Dmg" /></th>
          </tr>
        </thead>
        <tbody>
          {weapons.map((w) => (
            <tr key={w!.id} style={{ borderTop: `1px solid ${colors.border}` }}>
              <td style={{ padding: '2px 0' }}>
                {w!.name}
                {w!.type === 'melee' ? ' (melee)' : ''}
                {w!.rules.length > 0 && (
                  <div data-testid="weapon-rules" style={{ fontSize: 10, color: colors.muted }}>
                    <WeaponRules rules={w!.rules} />
                  </div>
                )}
              </td>
              <td>{w!.atk}</td>
              <td>{w!.hit}+</td>
              <td>
                {w!.dmg.normal}/{w!.dmg.crit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {card && !compactDrawer && (
        <Muted style={{ marginTop: 6 }}>
          <span data-testid="card-keywords">
            {card.keywords.map((k, i) => (
              <span key={k}>
                {i > 0 && ' · '}
                <Keyword term={k} kind="keyword" />
              </span>
            ))}
          </span>
        </Muted>
      )}
      {card && !compactDrawer && card.abilities.length + card.uniqueActions.length > 0 && (
        <Muted style={{ marginTop: 4 }}>
          <span data-testid="card-abilities">
            {[...card.abilities, ...card.uniqueActions].map((id, i) => {
              const name = (dataBundle().byId[id] as { name?: string } | undefined)?.name
              return name ? (
                <span key={id}>
                  {i > 0 && ', '}
                  <Keyword term={name} />
                </span>
              ) : null
            })}
          </span>
        </Muted>
      )}
    </div>
  )
  if (compactDrawer) {
    if (docked) return null
    // one line between the HUD and the prompt sheet: it never covers a control
    return (
      <div
        data-testid="operative-card"
        data-op={op.id}
        style={{ ...floatStyle, position: 'absolute', top: 62, right: 8, padding: '3px 10px', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 'calc(100% - 16px)', zIndex: 20, pointerEvents: 'none' }}
      >
        <Dot seat={op.seat} />
        <b>{op.name}</b> <span style={{ color: colors.muted }}>{op.id}</span> &middot; W <b>{op.wounds}/{op.maxWounds}</b> &middot; Save <b>{op.save}+</b> &middot; <OrderGlyph order={op.order} /> {humanize(op.order)} {op.ready ? '' : '(expended)'}
      </div>
    )
  }
  return (
    <div style={docked ? { ...floatStyle, width: '100%', maxHeight: '38vh', flex: '0 1 auto' } : { ...floatStyle, position: 'absolute', top: 66, right: 8, width: 290, maxHeight: '50vh', zIndex: 20 }}>
      {body}
    </div>
  )
}

// ---------------------------------------------------------------- feed + dice

export function EventFeed() {
  const feed = useFeedStore((s) => s.feed)
  const panels = useUi((s) => s.panels)
  const ref = useRef<HTMLDivElement | null>(null)
  // Pinned to the newest entry. Keyed on its id, not the length: the store caps the feed, so the length
  // stops changing while entries keep arriving. Pinned again whenever the list mounts: toggling the panel
  // (or opening the drawer) remounts the list but not this component, so the effect alone would miss it.
  const lastId = feed.length > 0 ? feed[feed.length - 1]!.id : -1
  const pin = (el: HTMLDivElement | null) => {
    if (el) el.scrollTop = el.scrollHeight
  }
  const attach = useCallback((el: HTMLDivElement | null) => {
    ref.current = el
    pin(el)
  }, [])
  useEffect(() => pin(ref.current), [lastId])
  return (
    <PanelBox id="feed" title="Event feed" testId="event-feed-panel" open={panels.feed} style={{ maxHeight: '28vh' }}>
      <div ref={attach} data-testid="event-feed" style={{ ...scrollFill, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {feed.length === 0 && <Muted>Nothing yet.</Muted>}
        {groupFeed(feed.slice(-80)).map((g) =>
          g.length > 1 && g[0]!.dice ? (
            <div key={g[0]!.id} data-testid="feed-dice-group" style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: '2px 6px', background: 'rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Dice ({g.length})</div>
              {g.map((f) => (
                <div key={f.id} style={{ borderLeft: `3px solid ${f.seat ? seatColor(f.seat) : colors.border}`, paddingLeft: 6 }}>
                  <KeywordText text={f.text} keywords={false} />
                </div>
              ))}
            </div>
          ) : (
            <div key={g[0]!.id} style={{ borderLeft: `3px solid ${g[0]!.seat ? seatColor(g[0]!.seat!) : colors.border}`, paddingLeft: 6 }}>
              <KeywordText text={g[0]!.text} keywords={false} />
            </div>
          ),
        )}
      </div>
    </PanelBox>
  )
}

export function DiceLog() {
  const dice = useFeedStore((s) => s.dice)
  const panels = useUi((s) => s.panels)
  return (
    <PanelBox id="log" title="Dice log" testId="dice-log-panel" open={panels.log} style={{ maxHeight: '24vh' }}>
      <div data-testid="dice-log" style={{ ...scrollFill, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {dice.length === 0 && <Muted>No rolls yet.</Muted>}
        {dice.slice(-30).map((d) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <Dot seat={d.seat ?? 'A'} />
            <span style={{ width: 120, color: colors.muted }}>
              <KeywordText text={humanize(d.purpose)} />
            </span>
            {d.dice.map((n, i) => (
              <Die key={i} n={n} small kind={d.kinds?.[i]} />
            ))}
          </div>
        ))}
      </div>
    </PanelBox>
  )
}

// ---------------------------------------------------------------- mission panel

export function MissionPanel() {
  const state = useDisplayState()
  const meta = useGame((g) => g.meta)
  const panels = useUi((s) => s.panels)
  if (!state || !meta) return null
  const def = meta.mission
  const view = mission(state)
  return (
    <PanelBox id="mission" title={def.name} testId="mission-panel" open={panels.mission} style={{ maxHeight: '34vh' }}>
      <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Muted>
          <KeywordText text={def.text} />
        </Muted>
        {view && (
          <div data-testid="mission-crit">
            <Keyword term="Crit op" />: <b><KeywordText text={humanize(view.critOp)} /></b> &middot; map {view.mapId}
          </div>
        )}
        {(['A', 'B'] as const).map((seat) => {
          const k = killStatus(state, seat)
          return (
            <div key={seat} data-testid={`mission-kill-${seat}`}>
              <Dot seat={seat} />
              <b>{SEAT_NAME[seat]}</b>: <Keyword term="Kill grade">kill grade</Keyword> <b>{k.grade}</b>/5 ({k.kills} down; grades at {k.thresholds.join(', ') || 'n/a'}
              {k.next !== null ? `; next at ${k.next}` : ''})
            </div>
          )
        })}
        {view && view.markers.length > 0 && (
          <div data-testid="mission-markers">
            {view.markers.map((k) => (
              <div key={k.id}>
                <KeywordText
                  text={`${humanize(k.id)}: ${k.controller ? `${SEAT_NAME[k.controller]} controls` : 'uncontrolled'}${k.securedBy ? `, secured by ${SEAT_NAME[k.securedBy]}` : ''}${k.transmitting ? ', transmitting' : ''}${k.looted ? ', looted' : ''}${k.contesting.A.length + k.contesting.B.length > 0 ? ` (${k.contesting.A.length} vs ${k.contesting.B.length} contesting)` : ''}`}
                />
              </div>
            ))}
          </div>
        )}
        <Muted>
          Layout {meta.layoutId.replace('kz.', '')} &middot; seed {meta.seed}
        </Muted>
      </div>
    </PanelBox>
  )
}

// ---------------------------------------------------------------- settings

const SPEEDS: { id: AnimSpeed; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
  { id: 'instant', label: 'Instant' },
]

const VOLUMES: { id: 'master' | 'sfx' | 'voice' | 'music'; label: string }[] = [
  { id: 'master', label: 'Master' },
  { id: 'sfx', label: 'Effects' },
  { id: 'voice', label: 'Narrator' },
  { id: 'music', label: 'Music' },
]

function AudioControls() {
  const { settings, setVolume, setMuted } = useAudioSettings()
  return (
    <div data-testid="audio-controls" style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, marginBottom: 4 }}>Sound</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
        <input data-testid="audio-mute" type="checkbox" checked={settings.muted} onChange={(e) => setMuted(e.target.checked)} />
        Mute everything
      </label>
      {VOLUMES.map((v) => (
        <label key={v.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 34px', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 2, opacity: settings.muted ? 0.5 : 1 }}>
          <span>{v.label}</span>
          <input data-testid={`vol-${v.id}`} type="range" min={0} max={100} step={1} value={Math.round(settings[v.id] * 100)} onChange={(e) => setVolume(v.id, Number(e.target.value) / 100)} />
          <span style={{ color: colors.muted, textAlign: 'right' }}>{Math.round(settings[v.id] * 100)}</span>
        </label>
      ))}
    </div>
  )
}

export function SettingsPanel() {
  const speed = useSettings((s) => s.animSpeed)
  const low = useSettings((s) => s.lowGraphics)
  const drawer = useUi((s) => s.drawer)
  const state = useGame((g) => g.state)
  if (drawer !== 'settings') return null
  return (
    <div data-testid="settings-panel" className="ms-touch" style={{ ...drawerStyle, top: 60, zIndex: 60 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b>Settings</b>
        <Btn onClick={() => useUi.setState({ drawer: null })}>Close</Btn>
      </div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>Animation speed</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {SPEEDS.map((s) => (
          <Btn key={s.id} data-testid={`speed-${s.id}`} variant={speed === s.id ? 'active' : 'base'} onClick={() => useSettings.getState().setAnimSpeed(s.id)}>
            {s.label}
          </Btn>
        ))}
      </div>
      <AudioControls />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
        <input data-testid="low-graphics" type="checkbox" checked={low} onChange={(e) => useSettings.getState().setLowGraphics(e.target.checked)} />
        Low graphics (no shadows, smaller mat texture)
      </label>
      <div style={{ fontSize: 12, marginBottom: 4 }}>Camera</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <Btn onClick={() => useUi.getState().requestCamera('home')}>Overview</Btn>
        <Btn onClick={() => useUi.getState().requestCamera('top')}>Top-down</Btn>
      </div>
      <Muted style={{ marginBottom: 10 }}>Right-drag orbit, middle-drag or WASD pan, wheel zoom. Two fingers on touch.</Muted>
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn
          data-testid="btn-resign"
          variant="danger"
          disabled={!state || state.phase === 'ended'}
          onClick={() => {
            const g = useGame.getState()
            if (g.pending) g.dispatch({ type: 'resign', seat: g.pending.seat, decisionId: g.pending.id, payload: {} })
          }}
        >
          Resign
        </Btn>
        <Btn data-testid="btn-menu" onClick={() => useSession.getState().backToMenu()}>
          Quit to menu
        </Btn>
      </div>
    </div>
  )
}
