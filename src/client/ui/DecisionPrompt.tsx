// The decision prompt: names what the pending decision decides and shows the engine's numbers. Finite decisions are option
// buttons from `pending.options` with engine labels and odds (`optionLabel`, `optionFacts`); the continuous kinds are answered on
// the board (deploy, move.path, casket, aim) and the prompt carries their controls. Every decision kind renders through the
// generic option list, so a kind the engine adds later still plays. Shown only to a human seat, after the presentation caught up.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { act, query, suggest, type DecisionOption, type GameState, type PendingDecision } from '@/engine'
import { deployFacing, deployFighterFor, rotateFacing, cancelDecision } from '../interaction/controller'
import { facingName, fighterName, optionFacts, optionLabel, withheldText, actionName, humanize, postureWord } from '../game/labels'
import { decisionInfo } from '../game/promptLabels'
import { useSettled } from '../presentation/presentedStore'
import { humanToAct, useGame } from '../store/game'
import { AimPrompt, AllocatePrompt, FightAfterPrompt, FightSplitPrompt, FightWeaponsPrompt, TargetPrompt, WeaponPrompt } from './AttackPrompts'
import { AssistPrompt, BottlePrompt, ConfirmPrompt, CrewPrompt, RecoveryPickPrompt, RerollPrompt, RolePrompt, SkillChoicePrompt, ZonePrompt } from './GamePrompts'
import { Keyword, KeywordText } from './Keyword'
import { Why } from './promptParts'
import { Tooltip } from './Tooltip'
import { useFormFactor } from './formFactor'
import { colors, fontStack, panel } from './theme'
import { useUi } from './uiStore'
import { ApPips, Btn, seatColor } from './widgets'

const optionRow: CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left' }
const factStyle: CSSProperties = { fontSize: 11, fontWeight: 500, color: colors.muted }

function OptionButton({ opt, state, variant = 'base' }: { opt: DecisionOption; state: GameState; variant?: 'base' | 'primary' | 'danger' }) {
  const dispatch = useGame((s) => s.dispatch)
  const facts = optionFacts(opt)
  return (
    <Btn
      variant={variant}
      data-testid={`opt-${opt.id}`}
      onMouseEnter={() => useUi.setState({ hoverOption: opt.id })}
      onMouseLeave={() => useUi.setState({ hoverOption: null })}
      onFocus={() => useUi.setState({ hoverOption: opt.id })}
      onBlur={() => useUi.setState({ hoverOption: null })}
      onClick={() => {
        useUi.setState({ hoverOption: null })
        dispatch(opt.action)
      }}
      style={{ ...optionRow, whiteSpace: 'normal' }}
    >
      <span>
        {opt.action.type === 'action.choose' ? (
          <Keyword term={actionName(state, opt.action.payload.action)} kind="action">
            {optionLabel(opt, state)}
          </Keyword>
        ) : (
          optionLabel(opt, state)
        )}
      </span>
      {facts.length > 0 && <span style={factStyle}>{facts.join(' · ')}</span>}
    </Btn>
  )
}

function OptionList({ pending, state, options }: { pending: PendingDecision; state: GameState; options?: DecisionOption[] }) {
  const list = options ?? pending.options ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {list.map((o) => (
        <OptionButton key={o.id} opt={o} state={state} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- fighters to pick

function FighterRow({ opt, state }: { opt: DecisionOption; state: GameState }) {
  const dispatch = useGame((s) => s.dispatch)
  const id = (opt.action.payload as { fighterId?: string }).fighterId
  const f = id ? state.fighters[id] : undefined
  if (!f) return <OptionButton opt={opt} state={state} />
  const type = state.data.fighterTypes[f.typeId]
  return (
    <Btn
      data-testid={`opt-${opt.id}`}
      onMouseEnter={() => useUi.setState({ hoverFighter: f.id })}
      onMouseLeave={() => useUi.setState({ hoverFighter: null })}
      onClick={() => {
        useUi.setState({ hoverFighter: null, selected: f.id })
        dispatch(opt.action)
      }}
      style={{ ...optionRow, whiteSpace: 'normal' }}
    >
      <span>
        <b>{f.name}</b>
        {type && type.name !== f.name ? <span style={factStyle}> {type.name}</span> : null}
      </span>
      <span style={factStyle}>
        {f.wounds}/{f.maxWounds} W{f.posture !== 'standing' ? ` · ${postureWord(f.posture)}` : ''}
        {f.conditions.broken ? ' · broken' : ''}
      </span>
    </Btn>
  )
}

function FighterPick({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const opts = pending.options ?? []
  const fighters = opts.filter((o) => (o.action.payload as { fighterId?: string }).fighterId)
  const rest = opts.filter((o) => !(o.action.payload as { fighterId?: string }).fighterId)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: fighters.length > 4 ? '1fr 1fr' : '1fr', gap: 5, maxHeight: '34vh', overflowY: 'auto' }}>
      {fighters.map((o) => (
        <FighterRow key={o.id} opt={o} state={state} />
      ))}
      {rest.map((o) => (
        <OptionButton key={o.id} opt={o} state={state} variant="primary" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- action.choose

function arrowAngle(facing: number): number {
  // screen: +x right, +z down; the glyph points up at rotation 0, so up (-z) is facing PI
  return (Math.atan2(Math.sin(facing), -Math.cos(facing)) * 180) / Math.PI
}

function TurnPicker({ opts, state }: { opts: DecisionOption[]; state: GameState }) {
  const [open, setOpen] = useState(false)
  const dispatch = useGame((s) => s.dispatch)
  if (opts.length === 0) return null
  const compass = opts.filter((o) => !o.id.includes('face:'))
  const enemies = opts.filter((o) => o.id.includes('face:'))
  return (
    <div>
      <Btn data-testid="turn-toggle" onClick={() => setOpen((v) => !v)} style={{ width: '100%', ...optionRow }}>
        <span>Turn on the spot</span>
        <span style={factStyle}>free · {open ? 'hide' : 'show'}</span>
      </Btn>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
          {compass.map((o) => {
            const facing = (o.action.payload as { facing?: number }).facing ?? 0
            return (
              <Tooltip key={o.id} title={`Face ${facingName(facing)}`}>
                <Btn data-testid={`opt-${o.id}`} onClick={() => dispatch(o.action)} style={{ width: 34, height: 30, padding: 0 }} aria-label={`Face ${facingName(facing)}`}>
                  <span style={{ display: 'inline-block', transform: `rotate(${arrowAngle(facing)}deg)` }}>▲</span>
                </Btn>
              </Tooltip>
            )
          })}
          {enemies.map((o) => (
            <Btn key={o.id} data-testid={`opt-${o.id}`} onClick={() => dispatch(o.action)} onMouseEnter={() => useUi.setState({ hoverFighter: (o.action.payload as { targetId?: string }).targetId ?? null })} onMouseLeave={() => useUi.setState({ hoverFighter: null })}>
              {optionLabel(o, state)}
            </Btn>
          ))}
        </div>
      )}
    </div>
  )
}

function ChoosePrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const focus = useUi((s) => s.focusDoor)
  const id = String(pending.context.fighterId ?? '')
  const f = state.fighters[id]
  const opts = pending.options ?? []
  const turn = opts.filter((o) => (o.action.payload as { action?: string }).action === 'turn')
  const end = opts.find((o) => (o.action.payload as { action?: string }).action === 'end')
  const others = opts.filter((o) => o !== end && !turn.includes(o))
  const doorFirst = focus ? others.filter((o) => JSON.stringify(o.action.payload).includes(`"${focus}"`)) : []
  const ordered = [...doorFirst, ...others.filter((o) => !doorFirst.includes(o))]
  const withheld = (pending.context.withheld as { action: string; reason: string }[] | undefined) ?? []
  const left = Number(pending.context.actionsLeft ?? 0)
  const done = (pending.context.performed as string[] | undefined) ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colors.muted }} data-testid="activation-info">
        <ApPips total={2} left={left} />
        <span>
          {left} action{left === 1 ? '' : 's'} left{done.length > 0 ? ` · done: ${done.map((a) => actionName(state, a)).join(', ')}` : ''}
        </span>
        {f && <span style={{ marginLeft: 'auto' }}>{humanize(query.status(state, f.id))}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: ordered.length > 6 ? '1fr 1fr' : '1fr', gap: 5 }}>
        {ordered.map((o) => (
          <OptionButton key={o.id} opt={o} state={state} />
        ))}
      </div>
      <TurnPicker opts={turn} state={state} />
      {withheld.length > 0 && (
        <Tooltip
          title="Not available now"
          body={
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {withheld.map((w) => (
                <li key={`${w.action}:${w.reason}`}>
                  {actionName(state, w.action)}: {withheldText(w.reason)}
                </li>
              ))}
            </ul>
          }
        >
          <span style={{ ...factStyle, cursor: 'help', alignSelf: 'flex-start' }}>Unavailable actions ({withheld.length})</span>
        </Tooltip>
      )}
      {end && <OptionButton opt={end} state={state} variant="primary" />}
    </div>
  )
}

// ---------------------------------------------------------------- continuous decisions

function DeployPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const picked = useUi((s) => s.deployFighter)
  const facingChoice = useUi((s) => s.facing)
  const dispatch = useGame((s) => s.dispatch)
  const ids = pending.constraints?.fighterIds ?? []
  const current = deployFighterFor(pending, picked)
  const facing = deployFacing(pending, facingChoice)
  const placeRest = () => {
    for (let i = 0; i < 60; i++) {
      const { state: s, pending: p } = useGame.getState()
      if (!s || !p || p.kind !== 'setup.deploy' || humanToAct() !== p.seat) return
      const a = suggest(s, p)
      if (!a || dispatch(a)) return
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ ...factStyle }} data-testid="deploy-left">
        {ids.length} fighter{ids.length === 1 ? '' : 's'} still to place
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: '22vh', overflowY: 'auto' }}>
        {ids.map((id) => (
          <Btn
            key={id}
            variant={id === current ? 'active' : 'base'}
            data-testid={`deploy-${id}`}
            onMouseEnter={() => useUi.setState({ hoverFighter: id })}
            onMouseLeave={() => useUi.setState({ hoverFighter: null })}
            onClick={() => useUi.setState({ deployFighter: id, selected: id })}
          >
            {fighterName(state, id)}
          </Btn>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={factStyle}>Facing: {facingName(facing)}</span>
        <Tooltip title="Turn left" body="Q">
          <Btn data-testid="facing-left" onClick={() => rotateFacing(-Math.PI / 4)} aria-label="Turn the facing left">◀</Btn>
        </Tooltip>
        <Tooltip title="Turn right" body="E">
          <Btn data-testid="facing-right" onClick={() => rotateFacing(Math.PI / 4)} aria-label="Turn the facing right">▶</Btn>
        </Tooltip>
        <Btn variant="primary" data-testid="deploy-auto" onClick={placeRest} style={{ marginLeft: 'auto' }}>
          Place the rest for me
        </Btn>
      </div>
    </div>
  )
}

function MovePrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const note = useUi((s) => s.hoverNote)
  const dispatch = useGame((s) => s.dispatch)
  const c = pending.constraints
  const max = c?.maxInches ?? Number(pending.context.maxInches ?? 0)
  const kind = c?.kind ?? 'move'
  const fighter = c?.fighterId ? state.fighters[c.fighterId] : undefined
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13 }} data-testid="move-info">
        Allowance <b>{max}"</b>
        {pending.context.obstacleCost !== undefined && <span style={factStyle}> · crossing an obstacle costs {String(pending.context.obstacleCost)}"</span>}
        {c?.oneInch === 'enemy' && <span style={factStyle}> · stay 1" from enemies</span>}
      </div>
      <div style={{ fontSize: 12, color: note ? (note.ok ? '#7fe3a0' : colors.danger) : colors.muted }} data-testid="move-note">
        {note ? note.text : 'Hover the board to preview the route.'}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {kind === 'takeCover' && fighter && (
          <Btn data-testid="move-stay" onClick={() => dispatch(act.path(pending, []))}>
            Take Cover where {fighter.name} stands
          </Btn>
        )}
        {pending.canPass && (
          <Btn variant="danger" data-testid="move-cancel" onClick={() => cancelDecision()}>
            Cancel (no action spent)
          </Btn>
        )}
      </div>
    </div>
  )
}

function CasketPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const dispatch = useGame((s) => s.dispatch)
  return (
    <Btn variant="primary" data-testid="casket-auto" onClick={() => { const a = suggest(state, pending); if (a) dispatch(a) }}>
      Let the engine pick the spot
    </Btn>
  )
}

// ---------------------------------------------------------------- the prompt

function Body({ pending, state }: { pending: PendingDecision; state: GameState }) {
  switch (pending.kind) {
    case 'setup.deploy':
      return <DeployPrompt pending={pending} state={state} />
    case 'move.path':
      return <MovePrompt pending={pending} state={state} />
    case 'action.choose':
      return <ChoosePrompt pending={pending} state={state} />
    case 'action.activate':
    case 'action.group':
    case 'action.flee':
      return <FighterPick pending={pending} state={state} />
    case 'setup.role':
      return <RolePrompt pending={pending} state={state} />
    case 'setup.zone':
      return <ZonePrompt pending={pending} state={state} />
    case 'setup.crew':
      return <CrewPrompt pending={pending} state={state} />
    case 'setup.casket':
      return <CasketPrompt pending={pending} state={state} />
    case 'shoot.weapon':
      return <WeaponPrompt pending={pending} state={state} />
    case 'shoot.target':
      return <TargetPrompt pending={pending} state={state} />
    case 'shoot.aim':
      return <AimPrompt pending={pending} state={state} />
    case 'shoot.allocate':
      return <AllocatePrompt pending={pending} state={state} />
    case 'fight.weapons':
      return <FightWeaponsPrompt pending={pending} state={state} />
    case 'fight.split':
      return <FightSplitPrompt pending={pending} state={state} />
    case 'fight.after':
      return <FightAfterPrompt pending={pending} state={state} />
    case 'end.bottle':
      return <BottlePrompt pending={pending} state={state} />
    case 'end.assist':
      return <AssistPrompt pending={pending} state={state} />
    case 'end.recoveryPick':
      return <RecoveryPickPrompt pending={pending} state={state} />
    case 'skill.choice':
      return <SkillChoicePrompt pending={pending} state={state} />
    case 'dice.reroll':
      return <RerollPrompt pending={pending} state={state} />
    case 'confirm':
      return <ConfirmPrompt pending={pending} state={state} />
    default:
      // a decision kind the engine adds later still plays through the generic list
      return <OptionList pending={pending} state={state} />
  }
}

const frame: CSSProperties = {
  ...panel,
  position: 'absolute',
  left: '50%',
  bottom: 12,
  transform: 'translateX(-50%)',
  width: 'min(560px, calc(100vw - 24px))',
  maxHeight: '62vh',
  overflowY: 'auto',
  padding: '10px 12px',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  zIndex: 30,
  fontFamily: fontStack,
}

export function DecisionPrompt(): ReactNode {
  const state = useGame((s) => s.state)
  const pending = useGame((s) => s.pending)
  const seats = useGame((s) => s.seats)
  const settled = useSettled()
  const ff = useFormFactor()
  if (!state || !pending || state.phase === 'ended' || !settled) return null
  const human = seats[pending.seat] === 'human'
  if (!human) {
    return (
      <div data-testid="waiting" style={{ ...frame, width: 'auto', padding: '6px 14px', fontSize: 13, color: colors.muted, borderTop: `3px solid ${seatColor(pending.seat)}` }}>
        {state.players[pending.seat].gangName} is deciding...
      </div>
    )
  }
  const info = decisionInfo(pending, state)
  // a phone leaves the board its height: the prompt shrinks and sits lower
  const fit: CSSProperties = ff.compact ? { maxHeight: '54vh', bottom: 6, padding: '6px 10px' } : {}
  return (
    <div className="ms-touch" data-testid="prompt" data-kind={pending.kind} data-decision={pending.id} style={{ ...frame, ...fit, borderTop: `4px solid ${seatColor(pending.seat)}` }}>
      <div data-testid="prompt-title" style={{ fontWeight: 800, fontSize: 15, marginBottom: info.hint ? 2 : 8 }}>{info.title}</div>
      {info.hint && !(ff.compact && pending.kind === 'shoot.target') && (
        <div style={{ ...factStyle, marginBottom: ff.compact || !info.why ? 8 : 2, lineHeight: 1.35 }}>
          <KeywordText text={info.hint} keywords={false} />
        </div>
      )}
      {!ff.compact && info.why && <div style={{ marginBottom: 8 }}><Why text={info.why} /></div>}
      <Body pending={pending} state={state} />
      {pending.canPass && pending.kind !== 'move.path' && !(pending.options ?? []).some((o) => o.action.type === 'pass') && (
        <Btn data-testid="opt-pass" style={{ marginTop: 6 }} onClick={() => useGame.getState().pass()}>
          {/^(shoot|fight)\./.test(pending.kind) ? 'Cancel (no action spent)' : 'Pass'}
        </Btn>
      )}
    </div>
  )
}
