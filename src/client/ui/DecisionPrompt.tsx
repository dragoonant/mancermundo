// The decision prompt: names what is being decided and shows the engine's numbers. One body per decision
// kind (deploy, move path, activate, order, action bar); everything else (setup rolls, drop zones, gambits,
// shoot/fight/ploy kinds the engine adds later) renders through the generic option list, never a crash.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { act, suggestPlacement, type DecisionOption, type GameState, type PendingDecision } from '@/engine'
import * as firefight from '@/engine/firefight'
import { effectiveApl } from '@/engine/state'
import { ACTION_HELP, ACTION_LABEL, ACTION_ORDER_FALLBACK, contextFacts, decisionInfo, humanize, opName, optionDetail, optionLabel, ORDER_HELP, SEAT_NAME } from '../game/labels'
import { abilityActions, markerActionLabel } from '../game/promptLabels'
import { setAsideWording } from '../teams'
import { AbilityChoiceBody, EquipBody, GuardBody, MarkerPlaceBody, ObjectiveBody, PloyBody } from './GamePrompts'
import { BlockBody, CoverSaveBody, FightResolveBody, FightTargetBody, FightWeaponBody, RerollBody, ShootTargetBody, ShootWeaponBody } from './AttackPrompts'
import { activateOption, bearingTo, canFlyNow, cancelActivate, cancelPath, confirmActivate, confirmPath, deployAction, deployChoice, facingTowardEnemy, optionOperative, pendingPick, previewMove, turnedBy } from '../interaction/controller'
import { useSettled } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { BottomSheet } from './BottomSheet'
import { CollapseButton, CollapsedTab, useCollapse, useCollapsed } from './collapse'
import { Keyword, KeywordText } from './Keyword'
import { Why } from './promptParts'
import { useFormFactor } from './formFactor'
import { colors, fontStack, panel } from './theme'
import { Tooltip } from './Tooltip'
import { useUi } from './uiStore'
import { ApPips, Btn, Die, Dot, Muted } from './widgets'

const containerStyle = {
  ...panel,
  position: 'absolute' as const,
  left: '50%',
  bottom: 10,
  transform: 'translateX(-50%)',
  width: 'min(620px, calc(100% - 600px))',
  minWidth: 360,
  maxHeight: '44vh',
  overflowY: 'auto' as const,
  padding: 12,
  boxSizing: 'border-box' as const,
  pointerEvents: 'auto' as const,
  fontFamily: fontStack,
  zIndex: 25,
}

function Shell({ pending, children, title, footer }: { pending: PendingDecision; children: ReactNode; title: string; footer?: ReactNode }) {
  const ff = useFormFactor()
  if (ff.compact) {
    return (
      <BottomSheet testId="decision-prompt" title={title} auto={pending.kind === 'setup.deploy' || pending.kind === 'move.path'} autoKey={pending.id} footer={footer}>
        <div data-kind={pending.kind}>{children}</div>
      </BottomSheet>
    )
  }
  return <DesktopShell pending={pending} title={title} footer={footer}>{children}</DesktopShell>
}

/** The floating desktop prompt: a drawer button folds it down to a title pill (a new decision always opens it again). */
function DesktopShell({ pending, children, title, footer }: { pending: PendingDecision; children: ReactNode; title: string; footer?: ReactNode }) {
  const [collapsed] = useCollapsed('prompt')
  // a tapped operative waiting for its confirm must be seen
  const picked = useUi((s) => s.pendingActivate)
  useEffect(() => {
    if (picked) useCollapse.getState().setCollapsed('prompt', false)
  }, [picked])
  if (collapsed) {
    return (
      <div style={{ position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none' }}>
        <CollapsedTab id="prompt" title={title} testId="collapsed-prompt" />
      </div>
    )
  }
  return (
    <div data-testid="decision-prompt" data-kind={pending.kind} data-decision={pending.id} style={containerStyle}>
      <div style={{ position: 'absolute', top: 6, right: 6 }}>
        <CollapseButton id="prompt" title={title} />
      </div>
      {children}
      {footer && <div style={{ marginTop: 8 }}>{footer}</div>}
    </div>
  )
}

function Header({ pending, seat }: { pending: PendingDecision; seat?: boolean }) {
  const info = decisionInfo(pending.kind)
  const compact = useFormFactor().compact
  // on a phone the sheet header already names the decision (seat and title): keep only the one-line hint
  if (compact) return <div style={{ marginBottom: 6 }}><Muted><KeywordText text={info.hint} keywords={false} /></Muted><Why text={info.why} /></div>
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }} data-testid="prompt-title">
        {seat && <Dot seat={pending.seat} />}
        {info.title}
      </div>
      <Muted><KeywordText text={info.hint} keywords={false} /></Muted>
      <Why text={info.why} />
    </div>
  )
}

// ---------------------------------------------------------------- generic option list

function GenericBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const facts = contextFacts(pending.context, state).slice(0, 8)
  const detailed = (pending.options ?? []).some((o) => optionDetail(o) !== '')
  const rolls = pending.context.rolls as Record<string, number> | undefined
  return (
    <>
      <Header pending={pending} seat />
      {rolls && Object.keys(rolls).length > 0 && (
        <div style={{ marginBottom: 6, fontSize: 13 }} data-testid="prompt-rolls">
          {Object.entries(rolls).map(([seat, v]) => (
            <span key={seat} style={{ marginRight: 12 }}>
              {SEAT_NAME[seat as 'A' | 'B']} rolled <b>{v}</b>
            </span>
          ))}
        </div>
      )}
      {facts.length > 0 && !rolls && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', marginBottom: 8, fontSize: 12, color: colors.muted }} data-testid="prompt-facts">
          {facts.map((f) => (
            <span key={f.key}>
              <KeywordText text={f.key} keywords={false} />: <span style={{ color: colors.text }}><KeywordText text={f.value} keywords={false} /></span>
            </span>
          ))}
        </div>
      )}
      <DicePools context={pending.context} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexDirection: detailed ? 'column' : 'row', alignItems: detailed ? 'stretch' : undefined }}>
        {(pending.options ?? []).map((o) => (
          <OptionButton key={o.id} o={o} state={state} pending={pending} onPick={() => choose(o.id)} />
        ))}
        {pending.canPass && (
          <Btn data-testid="opt-pass" onClick={() => choose('pass')}>
            Pass
          </Btn>
        )}
        {!pending.options && !pending.canPass && <Muted>The engine is waiting for an input this client cannot build for {pending.kind}.</Muted>}
      </div>
    </>
  )
}

function OptionButton({ o, state, pending, onPick }: { o: DecisionOption; state: GameState; pending: PendingDecision; onPick(): void }) {
  const data = o.data ?? {}
  const body = typeof data.odds === 'string' ? data.odds : typeof data.text === 'string' ? data.text : undefined
  const isZone = o.action.type === 'setup.dropZone'
  const detail = optionDetail(o)
  const btn = (
    <Btn
      data-testid={`opt-${o.id}`}
      variant="primary"
      style={detail ? { width: '100%', textAlign: 'left', whiteSpace: 'normal' } : undefined}
      onClick={onPick}
      onMouseEnter={() => useUi.setState(isZone ? { hoverZone: (o.action.payload as { zoneId: string }).zoneId } : { hoverOp: optionOperative(o) })}
      onMouseLeave={() => useUi.setState({ hoverZone: null, hoverOp: null })}
    >
      {body ? optionLabel(o, state, pending) : <KeywordText text={optionLabel(o, state, pending)} keywords={false} />}
      {detail && <span style={{ display: 'block', fontWeight: 400, fontSize: 11, opacity: 0.85 }}>{body ? detail : <KeywordText text={detail} keywords={false} />}</span>}
    </Btn>
  )
  return body ? <Tooltip title={optionLabel(o, state, pending)} body={body}>{btn}</Tooltip> : btn
}

const KIND_BG: Record<string, string> = { crit: colors.accent, normal: '#e8e8f2', fail: '#6b6f7c' }

/** Dice shown by re-roll style prompts: the engine's values, coloured by what each die became. */
function DicePools({ context }: { context: Record<string, unknown> }) {
  const dice = context.dice
  if (!Array.isArray(dice) || !dice.every((d) => typeof d === 'number')) return null
  const kinds = Array.isArray(context.kinds) ? (context.kinds as string[]) : []
  return (
    <div data-testid="prompt-dice" style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
      <span style={{ color: colors.muted }}>{String(context.side ?? 'dice')}:</span>
      {(dice as number[]).map((n, i) => (
        <span key={i} style={{ opacity: kinds[i] === 'fail' ? 0.6 : 1 }}>
          <Die n={n} small />
          <span style={{ display: 'block', height: 3, borderRadius: 2, background: KIND_BG[kinds[i] ?? 'normal'] ?? '#e8e8f2', marginTop: 1 }} />
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- deploy

function DeployBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const picked = useUi((s) => s.deployOp)
  const note = useUi((s) => s.hoverNote)
  const dispatch = useGame((g) => g.dispatch)
  const ids = pending.constraints?.operativeIds ?? []
  const current = deployChoice(pending, picked)
  const left = Number(pending.context.left ?? 0)
  const facing = useUi((s) => s.facing)
  const currentOp = current ? state.operatives[current] : undefined
  const auto = () => {
    if (!current) return
    const spot = suggestPlacement(state, pending, current)
    if (spot) dispatch(deployAction(pending, current, { x: spot.x, z: spot.z, y: spot.y }, currentOp?.ovalHalfAxis ? facing : null))
  }
  return (
    <>
      <Header pending={pending} seat />
      <Muted style={{ marginBottom: 6 }}>
        Place {left} more operative{left === 1 ? '' : 's'} now; every operative starts on <Keyword term="Conceal" />. {ids.length} left in reserve.
      </Muted>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }} data-testid="deploy-tray">
        {ids.map((id) => (
          <Btn key={id} data-testid={`deploy-op-${id}`} variant={id === current ? 'active' : 'base'} onClick={() => useUi.setState({ deployOp: id, facing: null })}>
            {opName(state, id)}
          </Btn>
        ))}
      </div>
      <HidingControl pending={pending} state={state} />
      {currentOp?.ovalHalfAxis ? (
        <TurnControl
          current={facing ?? 0}
          chosen={facing !== null}
          label="Base facing"
          help="This operative stands on an oval base. It is set up with its long side along the facing you pick (default: towards the centre of the killzone)."
          onSet={(f) => useUi.setState({ facing: f })}
          onEnemy={null}
          onReset={() => useUi.setState({ facing: null })}
        />
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Btn data-testid="deploy-auto" onClick={auto}>
          Auto-place {current ?? ''}
        </Btn>
        <span data-testid="deploy-note" style={{ fontSize: 12, color: note ? (note.ok ? '#6dff9a' : '#ff8a80') : colors.muted }}>
          {note?.text ?? 'Hover the highlighted drop zone to check a spot.'}
        </span>
      </div>
    </>
  )
}

/** Set-up option for teams that may start operatives out of the killzone (Wyrmblade HIDING): one button per operative the engine allows. */
function HidingControl({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const dispatch = useGame((g) => g.dispatch)
  const allowed = Array.isArray(pending.context.setAsideIds) ? (pending.context.setAsideIds as string[]) : []
  const hidden = Object.values(state.operatives).filter((o) => o.seat === pending.seat && o.offboard !== undefined)
  if (allowed.length === 0 && hidden.length === 0) return null
  const wording = setAsideWording(state.players[pending.seat]?.teamId)
  return (
    <div data-testid="hiding-control" style={{ marginBottom: 8 }}>
      <Muted style={{ marginBottom: 4 }}>
        <KeywordText text={wording.intro} />
      </Muted>
      {hidden.length > 0 && (
        <div data-testid="hiding-list" style={{ fontSize: 12, marginBottom: 4 }}>
          <Keyword term={wording.term} />: {hidden.map((o) => o.name).join(', ')}
        </div>
      )}
      {allowed.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allowed.map((id) => (
            <Btn key={id} data-testid={`hide-op-${id}`} onClick={() => dispatch(act.setAside(pending, id))}>
              {wording.verb} {opName(state, id)}
            </Btn>
          ))}
        </div>
      ) : (
        <Muted>{wording.none}</Muted>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- oval base turn

/** Turn buttons for an oval base: 30 degree steps, face the nearest enemy, along the last step, and back to the default. */
function TurnControl({
  current,
  chosen,
  label,
  help,
  onSet,
  onEnemy,
  onAlong,
  onReset,
}: {
  current: number
  chosen: boolean
  label: string
  help: string
  onSet(f: number): void
  onEnemy: (() => void) | null
  onAlong?: () => void
  onReset(): void
}) {
  const step = Math.PI / 6
  const degrees = Math.round(((current * 180) / Math.PI + 360) % 360)
  return (
    <div data-testid="turn-control" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, margin: '4px 0 8px' }}>
      <Tooltip title={label} body={help}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {label}: <span data-testid="turn-facing">{chosen ? `${degrees}°` : 'as is'}</span>
        </span>
      </Tooltip>
      <Btn data-testid="turn-left" onClick={() => onSet(turnedBy(current, -step))}>
        ↶ 30°
      </Btn>
      <Btn data-testid="turn-right" onClick={() => onSet(turnedBy(current, step))}>
        30° ↷
      </Btn>
      {onEnemy && (
        <Btn data-testid="turn-enemy" onClick={onEnemy}>
          Face enemy
        </Btn>
      )}
      {onAlong && (
        <Btn data-testid="turn-along" onClick={onAlong}>
          Along move
        </Btn>
      )}
      <Btn data-testid="turn-reset" disabled={!chosen} onClick={onReset}>
        Default
      </Btn>
    </div>
  )
}

// ---------------------------------------------------------------- move path

function MoveBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const waypoints = useUi((s) => s.waypoints)
  const jumpNext = useUi((s) => s.jumpNext)
  const facing = useUi((s) => s.facing)
  const fly = useUi((s) => s.fly)
  const canFly = canFlyNow(state, pending)
  const c = pending.constraints
  const op = c?.operativeId ? state.operatives[c.operativeId] : null
  const preview = useMemo(() => previewMove(state, pending, waypoints, facing, fly), [state, pending, waypoints, facing, fly])
  const max = c?.maxInches ?? Number(pending.context.maxInches ?? 0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return
      if (e.key === 'Escape') cancelPath()
      if (e.key === 'Enter') confirmPath()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const plan = preview.plan
  const kindLabel = ACTION_LABEL[c?.kind ?? ''] ?? humanize(c?.kind ?? 'move')
  return (
    <>
      <Header pending={pending} seat />
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <b>{op ? opName(state, op.id) : ''}</b> <Keyword term={kindLabel} />: up to <b>{max}&Prime;</b>
        {c?.kind === 'charge' && <> and finish inside an enemy <Keyword term="Control range">control range</Keyword></>}
        {c?.mustEndOutsideControlRange && c.kind !== 'charge' && <>, finishing outside every enemy <Keyword term="Control range">control range</Keyword></>}.
      </div>
      <div data-testid="move-total" style={{ fontSize: 15, fontWeight: 800, color: plan ? colors.text : colors.muted }}>
        {plan ? `Path cost ${plan.cost}/${plan.maxInches}″ · ${plan.maxInches - plan.cost}″ left` : waypoints.length || facing !== null ? 'Path not allowed' : `Click the board to lay the first step (${max}″ available)`}
      </div>
      {plan && (
        <div style={{ fontSize: 12, color: colors.muted, margin: '2px 0 4px' }} data-testid="move-segments">
          {plan.segments.map((s, i) => (
            <span key={i} style={{ marginRight: 10 }}>
              {s.kind !== 'walk' ? `${s.kind} ` : 'step '}
              {s.length.toFixed(1)}&Prime; (cost {s.cost})
            </span>
          ))}
        </div>
      )}
      {!plan && preview.rejection && (
        <div data-testid="move-reason" style={{ color: '#ff8a80', fontSize: 12, margin: '2px 0 4px' }}>
          {preview.rejection.reason}
        </div>
      )}
      {op?.ovalHalfAxis ? (
        <TurnControl
          current={facing ?? plan?.facing ?? op.facing}
          chosen={facing !== null}
          label="Turn base"
          help="An oval base may turn on the spot at the end of a move. The end of its long side sweeps an arc, and that arc counts as one more step (rounded up to a whole inch) against the move."
          onSet={(f) => useUi.setState({ facing: f })}
          onEnemy={() => {
            const end = plan?.end ?? waypoints[waypoints.length - 1] ?? op.pos
            const f = facingTowardEnemy(state, op, end)
            if (f !== null) useUi.setState({ facing: f })
          }}
          onAlong={
            waypoints.length > 0
              ? () => {
                  const last = waypoints[waypoints.length - 1]!
                  const from = waypoints.length > 1 ? waypoints[waypoints.length - 2]! : op.pos
                  useUi.setState({ facing: bearingTo(from, last) })
                }
              : undefined
          }
          onReset={() => useUi.setState({ facing: null })}
        />
      ) : null}
      <Muted style={{ marginBottom: 8 }}>
        <KeywordText text="Each straight step is rounded up to a whole inch. Click ground for flat steps, click a Vantage platform to climb, click ground beside a tower to drop. Use Jump for a leap across a gap." />
      </Muted>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Btn data-testid="move-confirm" variant="primary" disabled={!plan} onClick={() => confirmPath()}>
          Confirm move
        </Btn>
        <Btn data-testid="move-undo" disabled={waypoints.length === 0} onClick={() => useUi.setState({ waypoints: waypoints.slice(0, -1) })}>
          Undo step
        </Btn>
        <Btn data-testid="move-clear" disabled={waypoints.length === 0} onClick={() => useUi.getState().resetPath()}>
          Clear
        </Btn>
        {canFly && (
          <Tooltip title="Fly" body="Jump pack: instead of walking, set the operative up again anywhere within its move, measured in a straight line. Terrain in between, climbs and drops cost nothing. Click the board to choose the spot.">
            <Btn data-testid="move-fly" variant={fly ? 'active' : 'base'} onClick={() => useUi.setState({ fly: !fly, waypoints: [] })}>
              Fly
            </Btn>
          </Tooltip>
        )}
        <Tooltip title="Jump" body="Mark the next step as a leap across a gap or down from a platform (up to 4 inches).">
          <Btn data-testid="move-jump" variant={jumpNext ? 'active' : 'base'} onClick={() => useUi.setState({ jumpNext: !jumpNext })}>
            Jump next
          </Btn>
        </Tooltip>
        <Btn data-testid="move-cancel" variant="danger" onClick={() => cancelPath()}>
          Cancel action
        </Btn>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- activate / order / action

/** One button per activation option: operatives (activate / counteract) or a team's alternative to counteracting. */
function ActivateButtons({ pending, state, alternatives }: { pending: PendingDecision; state: GameState; alternatives: boolean }) {
  const choose = useGame((g) => g.choose)
  return (
    <>
      {(pending.options ?? []).map((o) => {
        const p = o.action.payload as { operativeId: string; counteract?: boolean; alternative?: number }
        const op = state.operatives[p.operativeId]
        // M9 batch C: a team's alternative to counteracting
        if (p.alternative !== undefined) {
          if (!alternatives) return null
          return (
            <Btn key={o.id} data-testid={`alt-${p.alternative}`} onClick={() => choose(o.id)}>
              {optionLabel(o, state, pending)}
            </Btn>
          )
        }
        if (alternatives) return null
        return (
          <Btn
            key={o.id}
            data-testid={p.counteract ? `counteract-${p.operativeId}` : `activate-${p.operativeId}`}
            variant="primary"
            onClick={() => choose(o.id)}
            onMouseEnter={() => useUi.setState({ hoverOp: p.operativeId })}
            onMouseLeave={() => useUi.setState({ hoverOp: null })}
          >
            {p.counteract ? 'Counteract: ' : ''}
            {op ? `${op.name} (${op.id})` : p.operativeId}
          </Btn>
        )
      })}
    </>
  )
}

function SkipButton({ pending }: { pending: PendingDecision }) {
  const choose = useGame((g) => g.choose)
  if (!pending.canPass) return null
  return (
    <Tooltip title="Skip" body="No counteraction: the other side keeps going.">
      <Btn data-testid="opt-pass" onClick={() => choose('pass')}>
        Skip
      </Btn>
    </Tooltip>
  )
}

function ActivateBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const touch = useFormFactor().touch
  const compact = useFormFactor().compact
  const picked = useUi((s) => s.pendingActivate)
  const [listOpen, setListOpen] = useState(false)
  if (!touch) {
    return (
      <>
        <Header pending={pending} seat />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <ActivateButtons pending={pending} state={state} alternatives={false} />
          <ActivateButtons pending={pending} state={state} alternatives />
          <SkipButton pending={pending} />
        </div>
        <Muted style={{ marginTop: 6 }}>You can also click an operative on the board. Operatives you can pick pulse in yellow.</Muted>
      </>
    )
  }
  // touch: the board is the picker. A tap only marks an operative; the player confirms it here.
  const pick = pendingPick(pending, picked)
  const opt = pick ? activateOption(pending, pick) : null
  const op = pick ? state.operatives[pick] : undefined
  const counteract = !!(opt?.action.payload as { counteract?: boolean } | undefined)?.counteract
  return (
    <div data-testid="activate-bar">
      {!compact && (
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }} data-testid="prompt-title">
          <Dot seat={pending.seat} />
          {decisionInfo(pending.kind).title}
        </div>
      )}
      {pick ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }} data-testid="activate-confirm-text">
            {counteract ? 'Counteract with' : 'Activate'} {op ? `${op.name} (${op.id})` : pick}?
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Btn data-testid="confirm-activate" variant="primary" onClick={() => confirmActivate()}>
              {counteract ? 'Counteract' : 'Activate'}
            </Btn>
            <Btn data-testid="cancel-activate" onClick={() => cancelActivate()}>
              Cancel
            </Btn>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, marginBottom: 6 }} data-testid="activate-hint">
            Tap a glowing operative on the board to activate it.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Btn data-testid="activate-list-toggle" variant={listOpen ? 'active' : 'base'} aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
              {listOpen ? 'Hide list' : 'List'}
            </Btn>
            <ActivateButtons pending={pending} state={state} alternatives />
            <SkipButton pending={pending} />
          </div>
          {listOpen && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }} data-testid="activate-list">
              <ActivateButtons pending={pending} state={state} alternatives={false} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OrderBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const op = state.operatives[String(pending.context.operativeId)]
  return (
    <>
      <Header pending={pending} seat />
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <Keyword term="Order">Order</Keyword> for <b>{op ? opName(state, op.id) : ''}</b>
        {op && <> (currently <Keyword term={op.order}>{humanize(op.order)}</Keyword>)</>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {(['engage', 'conceal'] as const).map((order) => (
          <button
            key={order}
            type="button"
            data-testid={`order-${order}`}
            onClick={() => choose(order)}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              padding: 10,
              borderRadius: 8,
              border: `2px solid ${order === 'engage' ? '#ff8a2a' : '#6fb7ff'}`,
              background: 'rgba(255,255,255,0.05)',
              color: colors.text,
              fontFamily: fontStack,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 14 }}>{order === 'engage' ? 'Engage' : 'Conceal'}</div>
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
              <KeywordText text={ORDER_HELP[order]} />
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

const FALLBACK_ORDER = ACTION_ORDER_FALLBACK

function ActionBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const compact = useFormFactor().compact
  const ctx = pending.context as { operativeId?: string; apl?: number; apSpent?: number; apRemaining?: number; counteract?: boolean; performed?: string[] }
  const op = ctx.operativeId ? state.operatives[ctx.operativeId] : undefined
  const activation = state.firefight.activation
  const options = pending.options ?? []
  const byAction = new Map<string, DecisionOption>()
  for (const o of options) {
    const a = (o.action.payload as { action?: string }).action
    if (a) byAction.set(a, o)
  }
  const known: string[] = (firefight as { ACTION_ORDER?: string[] }).ACTION_ORDER ?? FALLBACK_ORDER
  const abilities = abilityActions(state, pending)
  const abilityKeys = new Set(abilities.map((a) => a.action))
  const markerOpts = options.filter((o) => {
    const a = (o.action.payload as { action?: string }).action
    return a === 'marker:pickUp' || a === 'marker:place'
  })
  const extras = [...byAction.keys()].filter((a) => a !== 'end' && !known.includes(a) && !abilityKeys.has(a) && a !== 'marker:pickUp' && a !== 'marker:place')
  const total = ctx.apl ?? (op ? effectiveApl(op) : 0)
  const left = ctx.apRemaining ?? Math.max(0, total - (ctx.apSpent ?? 0))
  const reasonFor = (id: string): string => {
    if (!op) return 'Not available'
    try {
      const rej = firefight.actionAvailability(state, op, id, activation)
      if (rej) return rej.reason
    } catch {
      /* fall through */
    }
    const def = (firefight.ACTIONS as Record<string, { implemented?: boolean } | undefined>)[id]
    if (def && def.implemented === false) return 'Not available yet: this arrives with the attack sequence.'
    return 'Not available right now.'
  }
  const renderAction = (id: string) => {
    const o = byAction.get(id)
    const cost = typeof o?.data?.cost === 'number' ? (o.data.cost as number) : (firefight.ACTIONS as Record<string, { cost?: number } | undefined>)[id]?.cost
    const label = ACTION_LABEL[id] ?? humanize(id)
    const help = ACTION_HELP[id] ?? 'A special action.'
    const costNote = cost !== undefined ? ` Costs ${cost} AP${left < cost ? `; you have ${left} left` : ''}.` : ''
    const btn = (
      <Btn
        key={id}
        data-testid={`act-${id}`}
        variant={o ? 'primary' : 'base'}
        disabled={!o}
        onClick={() => o && choose(o.id)}
      >
        {label}
        {cost !== undefined ? ` · ${cost} AP` : ''}
      </Btn>
    )
    return (
      <Tooltip key={id} title={`${label}${cost !== undefined ? ` · ${cost} AP` : ''}`} body={o ? `${help}${costNote}` : `${help}${costNote} Unavailable: ${reasonFor(id)}`} wrap={!o}>
        {btn}
      </Tooltip>
    )
  }
  const end = byAction.get('end')
  return (
    <>
      {!compact && <Header pending={pending} seat />}
      <div style={{ fontSize: 13, marginBottom: compact ? 4 : 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>{op ? opName(state, op.id) : ''}</b>
        {ctx.counteract ? (
          <span style={{ color: colors.accent }}>
            <KeywordText text="Counteract: one 1 AP action" />
          </span>
        ) : (
          <>
            <ApPips total={total} left={left} />
            <span data-testid="ap-left">
              {left}/{total} <Keyword term="AP" />
            </span>
          </>
        )}
        {op && (
          <span style={{ color: colors.muted }}>
            <Keyword term={op.order}>{humanize(op.order)}</Keyword>
          </span>
        )}
      </div>
      <div style={compact ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 } : { display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="action-bar">
        {known.filter((id) => id !== 'end').map(renderAction)}
        {extras.map(renderAction)}
        {end && !compact && (
          <Btn data-testid="act-end" variant="active" onClick={() => choose(end.id)}>
            {optionLabel(end, state, pending)}
          </Btn>
        )}
      </div>
      {(abilities.length > 0 || markerOpts.length > 0) && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>
            <Keyword term="Mission action">Mission</Keyword> and special actions
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="ability-bar">
            {abilities.map((a) => {
              const why = [a.text, ...a.conditions].filter(Boolean).join(' ')
              if (a.offers.length === 0) {
                return (
                  <Tooltip key={a.action} title={`${a.name}${a.mission ? ' (mission)' : ''}`} body={`${why} Unavailable: ${a.reason ?? 'not right now'}`} wrap>
                    <Btn data-testid={`act-${a.action}`} disabled>
                      {a.name}
                      {a.cost !== null ? ` · ${a.cost} AP` : ''}
                    </Btn>
                  </Tooltip>
                )
              }
              return a.offers.map((o) => {
                const p = o.action.payload as { markerId?: string; targetId?: string; param?: string }
                const which = p.markerId ? humanize(p.markerId) : p.targetId ? opName(state, p.targetId) : p.param ? humanize(p.param) : ''
                const cost = typeof o.data?.cost === 'number' ? (o.data.cost as number) : a.cost
                return (
                  <Tooltip key={o.id} title={`${a.name}${a.mission ? ' (mission)' : ''}`} body={why}>
                    <Btn data-testid={a.offers.length > 1 ? `act-${a.action}-${which || o.id}` : `act-${a.action}`} variant="primary" onClick={() => choose(o.id)}>
                      {a.name}
                      {which ? ` · ${which}` : ''}
                      {cost !== null && cost !== undefined ? ` · ${cost} AP` : ''}
                    </Btn>
                  </Tooltip>
                )
              })
            })}
            {markerOpts.map((o) => (
              <Tooltip key={o.id} title={markerActionLabel(o)} body="Pick the marker up, or set a carried marker down within 1 inch.">
                <Btn data-testid={`act-${o.id}`} variant="primary" onClick={() => choose(o.id)}>
                  {markerActionLabel(o)}
                  {typeof o.data?.cost === 'number' ? ` · ${o.data.cost} AP` : ''}
                </Btn>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
      {(ctx.performed?.length ?? 0) > 0 && (
        <Muted style={{ marginTop: 6 }}>
          <KeywordText text={`Done this activation: ${ctx.performed!.map((a) => ACTION_LABEL[a] ?? humanize(a)).join(', ')}`} />
        </Muted>
      )}
    </>
  )
}

// ---------------------------------------------------------------- root

function Waiting({ text }: { text: string }) {
  const ff = useFormFactor()
  return (
    <div
      data-testid="prompt-waiting"
      style={{ ...panel, position: 'absolute', left: '50%', bottom: ff.compact ? 8 : 10, transform: 'translateX(-50%)', padding: '8px 16px', fontSize: 13, fontFamily: fontStack, pointerEvents: 'none', zIndex: 25 }}
    >
      {text}
    </div>
  )
}

export function DecisionPrompt() {
  const pending = useGame((g) => g.pending)
  const state = useGame((g) => g.state)
  const seats = useGame((g) => g.seats)
  const settled = useSettled()
  const ff = useFormFactor()
  // Reset path / pick when the decision changes.
  const id = pending?.id
  useEffect(() => {
    // a new decision always opens the prompt again, so a required choice is never hidden
    if (id !== undefined && useCollapse.getState().collapsed.prompt) useCollapse.getState().setCollapsed('prompt', false)
    useUi.setState({ waypoints: [], jumpNext: false, facing: null, fly: false, deployOp: null, pendingActivate: null, hoverNote: null, hoverZone: null, hoverOp: null, hoverOption: null, hoverSpot: null })
  }, [id])
  if (!pending || !state || state.phase === 'ended') return null
  if (!settled) return <Waiting text="..." />
  if (seats[pending.seat] !== 'human') return <Waiting text={`${SEAT_NAME[pending.seat]} (bot) is thinking...`} />
  const info = decisionInfo(pending.kind)
  let body: ReactNode
  switch (pending.kind) {
    case 'setup.deploy':
      body = <DeployBody pending={pending} state={state} />
      break
    case 'move.path':
      body = <MoveBody pending={pending} state={state} />
      break
    case 'firefight.activate':
      body = <ActivateBody key={pending.id} pending={pending} state={state} />
      break
    case 'firefight.order':
      body = <OrderBody pending={pending} state={state} />
      break
    case 'firefight.action':
      body = <ActionBody pending={pending} state={state} />
      break
    case 'shoot.weapon':
      body = <ShootWeaponBody pending={pending} state={state} />
      break
    case 'shoot.target':
      body = <ShootTargetBody pending={pending} state={state} />
      break
    case 'shoot.coverSave':
      body = <CoverSaveBody pending={pending} state={state} />
      break
    case 'shoot.block':
      body = <BlockBody pending={pending} state={state} />
      break
    case 'fight.target':
      body = <FightTargetBody pending={pending} state={state} />
      break
    case 'fight.weapon':
      body = <FightWeaponBody pending={pending} state={state} />
      break
    case 'fight.resolve':
      body = <FightResolveBody pending={pending} state={state} />
      break
    case 'dice.reroll':
    case 'dice.commandReroll':
      body = <RerollBody pending={pending} state={state} />
      break
    case 'ploy.firefight':
    case 'strategy.gambit':
      body = <PloyBody pending={pending} state={state} />
      break
    case 'guard.interrupt':
      body = <GuardBody pending={pending} state={state} />
      break
    case 'ability.choice':
      body = <AbilityChoiceBody pending={pending} state={state} />
      break
    case 'marker.place':
      body = <MarkerPlaceBody pending={pending} state={state} />
      break
    case 'setup.objective':
      body = <ObjectiveBody pending={pending} />
      break
    case 'setup.equipMarker':
      body = <EquipBody pending={pending} />
      break
    default:
      body = <GenericBody pending={pending} state={state} />
  }
  // phones: End activation is pinned in the sheet footer so it is never scrolled out of reach
  const endOpt = pending.kind === 'firefight.action' ? (pending.options ?? []).find((o) => (o.action.payload as { action?: string }).action === 'end') : undefined
  const footer =
    endOpt && ff.compact ? (
      <Btn data-testid="act-end" variant="active" style={{ width: '100%' }} onClick={() => useGame.getState().choose(endOpt.id)}>
        {optionLabel(endOpt, state, pending)}
      </Btn>
    ) : undefined
  return (
    <Shell pending={pending} title={`${SEAT_NAME[pending.seat]}: ${info.title}`} footer={footer}>
      {body}
    </Shell>
  )
}

