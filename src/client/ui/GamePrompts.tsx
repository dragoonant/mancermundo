// Dedicated prompts for the rest of the game: ploy and gambit cards (cost, own-words text from data, why
// something is unavailable), Guard interrupts, ability choices, marker placement and the objective / equipment
// placement of set-up. Board clicks for the spot-style ones live in interaction/controller.ts.
import type { GameState, PendingDecision } from '@/engine'
import { abilityChoiceHeadline, abilityChoiceOption, equipHeadline, guardHeadline, guardOption, markerPlaceHeadline, objectiveHeadline, passLabel, ployCard, unavailablePloys } from '../game/promptLabels'
import { humanize, opName } from '../game/labels'
import { useGame } from '../store/game'
import { colors } from './theme'
import { useUi } from './uiStore'
import { Btn, Muted } from './widgets'
import { Keyword, KeywordText } from './Keyword'
import { cardStyle, PromptHeader, Section } from './promptParts'

function PassButton({ pending }: { pending: PendingDecision }) {
  const choose = useGame((g) => g.choose)
  if (!pending.canPass) return null
  return (
    <Btn data-testid="opt-pass" onClick={() => choose('pass')}>
      {passLabel(pending.kind)}
    </Btn>
  )
}

// ---------------------------------------------------------------- ploy.firefight / strategy.gambit

export function PloyBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const cp = state.players[pending.seat].cp
  const gambit = pending.kind === 'strategy.gambit'
  const cards = (pending.options ?? []).map((o) => ({ o, c: ployCard(o, state, pending.seat) }))
  const off = unavailablePloys(state, pending)
  return (
    <>
      <PromptHeader
        pending={pending}
        hint={
          gambit
            ? `You have ${cp} CP. A gambit is played now, before the activations; the step ends after two passes in a row.`
            : `You have ${cp} CP. Use a ploy at this moment, or pass.`
        }
      />
      <div style={{ display: 'grid', gap: 6 }} data-testid="ploy-cards">
        {cards.map(({ o, c }) => (
          <button key={o.id} type="button" data-testid={`opt-${o.id}`} style={cardStyle({ disabled: !c.affordable })} onClick={() => choose(o.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <b style={{ fontSize: 14 }}>
                <Keyword term={c.name} kind="ploy" />
                {c.param ? <span style={{ color: colors.muted, fontWeight: 600 }}> · {c.param}</span> : null}
              </b>
              <span style={{ color: colors.accent, fontWeight: 800 }}>{c.cost !== null ? <>{c.cost} <Keyword term="CP" /></> : ''}</span>
            </div>
            {c.text && (
              <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                <KeywordText text={c.text} />
              </div>
            )}
          </button>
        ))}
        {off.map((u) => (
          <div key={u.id} data-testid={`ploy-off-${u.id}`} style={{ ...cardStyle({ disabled: true }), cursor: 'not-allowed' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>{u.name}</b>
              <span style={{ fontWeight: 800 }}>{u.cost} <Keyword term="CP" /></span>
            </div>
            <div style={{ fontSize: 12, color: '#ff8a80', marginTop: 2 }}>
              <KeywordText text={u.reason} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <PassButton pending={pending} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- guard.interrupt

export function GuardBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  return (
    <>
      <PromptHeader pending={pending} hint={guardHeadline(pending, state)} />
      <div style={{ display: 'grid', gap: 6 }}>
        {(pending.options ?? []).map((o) => {
          const g = guardOption(o, state)
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`opt-${o.id}`}
              style={cardStyle()}
              onClick={() => choose(o.id)}
              onMouseEnter={() => useUi.setState({ hoverOp: g.operativeId })}
              onMouseLeave={() => useUi.setState({ hoverOp: null })}
            >
              <b>{g.label}</b>
              <div style={{ fontSize: 12, color: colors.muted }}>
                <KeywordText text={g.detail} keywords={false} />
              </div>
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 8 }}>
        <PassButton pending={pending} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- ability.choice

export function AbilityChoiceBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  return (
    <>
      <PromptHeader pending={pending} hint={abilityChoiceHeadline(pending, state)} />
      <div style={{ display: 'grid', gap: 6 }}>
        {(pending.options ?? []).map((o) => {
          const c = abilityChoiceOption(o)
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`opt-${o.id}`}
              style={cardStyle()}
              onClick={() => choose(o.id)}
              onMouseEnter={() => useUi.setState({ hoverSpot: o.id })}
              onMouseLeave={() => useUi.setState({ hoverSpot: null })}
            >
              <b>
                <KeywordText text={c.label} />
              </b>
              {c.detail && (
                <div style={{ fontSize: 12, color: colors.muted }}>
                  <KeywordText text={c.detail} />
                </div>
              )}
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 8 }}>
        <PassButton pending={pending} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- marker.place

export function MarkerPlaceBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const note = useUi((s) => s.hoverNote)
  return (
    <>
      <PromptHeader pending={pending} hint={markerPlaceHeadline(pending, state)} />
      <div data-testid="place-note" style={{ fontSize: 12, marginBottom: 8, color: note ? (note.ok ? '#6dff9a' : '#ff8a80') : colors.muted }}>
        {note?.text ?? `The ring around ${opName(state, String(pending.context.operativeId))} shows how far the marker can go.`}
      </div>
      <PassButton pending={pending} />
    </>
  )
}

// ---------------------------------------------------------------- setup.objective / setup.equipMarker

export function ObjectiveBody({ pending }: { pending: PendingDecision }) {
  const choose = useGame((g) => g.choose)
  const opts = pending.options ?? []
  const shown = opts.slice(0, 8)
  return (
    <>
      <PromptHeader pending={pending} hint={objectiveHeadline(pending)} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <Btn data-testid="opt-auto" variant="primary" onClick={() => opts[0] && choose(opts[0].id)}>
          Let the engine choose
        </Btn>
        {shown.map((o, i) => {
          const p = o.action.payload as { x: number; z: number }
          return (
            <Btn
              key={o.id}
              data-testid={`opt-${o.id}`}
              onClick={() => choose(o.id)}
              onMouseEnter={() => useUi.setState({ hoverSpot: o.id })}
              onMouseLeave={() => useUi.setState({ hoverSpot: null })}
            >
              Spot {i + 1} ({p.x.toFixed(1)}, {p.z.toFixed(1)})
            </Btn>
          )
        })}
      </div>
      <Muted>
        {opts.length} legal spot{opts.length === 1 ? '' : 's'}; they are ringed on the board. Click the nearest ring to place the marker there.
      </Muted>
    </>
  )
}

export function EquipBody({ pending }: { pending: PendingDecision }) {
  const dispatch = useGame((g) => g.dispatch)
  const note = useUi((s) => s.hoverNote)
  const s = pending.context.suggestion as { x: number; z: number; yaw?: number } | undefined
  return (
    <>
      <PromptHeader pending={pending} hint={equipHeadline(pending)} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <Btn
          data-testid="opt-auto"
          variant="primary"
          disabled={!s}
          onClick={() => s && dispatch({ type: 'setup.equipMarker', seat: pending.seat, decisionId: pending.id, payload: { x: s.x, z: s.z, ...(s.yaw !== undefined ? { yaw: s.yaw } : {}) } })}
          onMouseEnter={() => useUi.setState({ hoverSpot: 'suggestion' })}
          onMouseLeave={() => useUi.setState({ hoverSpot: null })}
        >
          Use the suggested spot
        </Btn>
        <span data-testid="place-note" style={{ fontSize: 12, color: note ? (note.ok ? '#6dff9a' : '#ff8a80') : colors.muted }}>
          {note?.text ?? 'Hover the board to check a spot.'}
        </span>
      </div>
      <Section>
        <Muted>{humanize(String(pending.context.equipmentId ?? ''))} goes wholly inside the highlighted territory, clear of other markers.</Muted>
      </Section>
    </>
  )
}
