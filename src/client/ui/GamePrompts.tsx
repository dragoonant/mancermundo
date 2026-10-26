// The set-up, nerve and End-phase prompts: who sets up first, which half, the crew, the Bottle test (with the engine's odds when it
// has them), recovery assistance and picks, skill choices, re-rolls and plain confirmations. Each names what it decides and says
// what each answer does; the numbers are the engine's.
import type { CSSProperties, ReactNode } from 'react'
import { type DecisionOption, type GameState, type PendingDecision } from '@/engine'
import { bottleOdds, pct } from '../game/odds'
import { fighterName, humanize, optionFacts, optionLabel } from '../game/labels'
import { useGame } from '../store/game'
import { Keyword } from './Keyword'
import { cardStyle } from './promptParts'
import { colors } from './theme'
import { useUi } from './uiStore'
import { Btn } from './widgets'

const small: CSSProperties = { fontSize: 11, color: colors.muted }

function useAnswer(opt: DecisionOption): () => void {
  const dispatch = useGame((s) => s.dispatch)
  return () => {
    useUi.setState({ hoverOption: null, hoverFighter: null })
    dispatch(opt.action)
  }
}

export function ChoiceCard({ opt, state, children, primary }: { opt: DecisionOption; state: GameState; children?: ReactNode; primary?: boolean }) {
  const answer = useAnswer(opt)
  const facts = optionFacts(opt)
  return (
    <button
      type="button"
      data-testid={`opt-${opt.id}`}
      onClick={answer}
      onMouseEnter={() => useUi.setState({ hoverOption: opt.id })}
      onMouseLeave={() => useUi.setState({ hoverOption: null })}
      style={{ ...cardStyle({ primary: !!primary }), font: 'inherit' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <b>{optionLabel(opt, state)}</b>
        {facts.length > 0 && <span style={small}>{facts.join(' · ')}</span>}
      </div>
      {children && <div style={{ ...small, marginTop: 2 }}>{children}</div>}
    </button>
  )
}

function Cards({ pending, state, note }: { pending: PendingDecision; state: GameState; note?: (o: DecisionOption) => ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {(pending.options ?? []).map((o) => (
        <ChoiceCard key={o.id} opt={o} state={state}>
          {note?.(o)}
        </ChoiceCard>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- set-up

export function RolePrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const rolls = pending.context.rolls as Record<string, number> | undefined
  return (
    <div>
      {rolls && (
        <div style={{ ...small, marginBottom: 5 }}>
          The roll-off: {state.players.A.gangName} rolled {rolls.A}, {state.players.B.gangName} rolled {rolls.B}.
        </div>
      )}
      <Cards
        pending={pending}
        state={state}
        note={(o) => {
          const c = (o.action.payload as { choice?: string }).choice
          return c === 'first'
            ? 'You pick your half and deploy first, but the other gang sees where you stand.'
            : c === 'second'
              ? 'The other gang picks its half and deploys first; you answer with your fighters in view.'
              : c === 'attacker'
                ? 'You raid: your crew, your goal. Check the briefing for what you must do.'
                : 'You hold the ground: you set the stakes first.'
        }}
      />
    </div>
  )
}

export function ZonePrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  return (
    <Cards
      pending={pending}
      state={state}
      note={(o) => ((o.action.payload as { zoneId?: string }).zoneId === 'low' ? 'The far half, at the top of the screen as the camera first looks.' : 'The near half, at the bottom of the screen.')}
    />
  )
}

export function CrewPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const dispatch = useGame((s) => s.dispatch)
  const c = pending.context as { x?: number; picked?: string[]; y?: string | null }
  const done = (pending.options ?? []).find((o) => (o.action.payload as { done?: boolean }).done)
  const picks = (pending.options ?? []).filter((o) => !(o.action.payload as { done?: boolean }).done)
  return (
    <div>
      <div style={{ ...small, marginBottom: 5 }}>
        Pick {c.x ?? 'your'} fighters{c.y ? ` (and ${c.y} more are drawn at random)` : ''}. Picked so far: {(c.picked ?? []).length === 0 ? 'none' : (c.picked ?? []).map((id) => fighterName(state, id)).join(', ')}.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: picks.length > 4 ? '1fr 1fr' : '1fr', gap: 5, maxHeight: '34vh', overflowY: 'auto' }}>
        {picks.map((o) => (
          <ChoiceCard key={o.id} opt={o} state={state} />
        ))}
      </div>
      {done && (
        <Btn variant="primary" data-testid="opt-done" style={{ marginTop: 6 }} onClick={() => dispatch(done.action)}>
          Crew chosen
        </Btn>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- nerve, bottle, flight, recovery

export function BottlePrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const seat = pending.seat
  const o = bottleOdds(state, seat)
  return (
    <div>
      <div data-testid="bottle-info" style={{ ...small, marginBottom: 5, lineHeight: 1.4 }}>
        {o ? `${o.down} of your ${o.crew} starting fighters are down (Seriously Injured, Out of Action or fled). ` : ''}
        <Keyword term="Bottle test">The Bottle test</Keyword> rolls a D6 and adds that number; a total above {o?.crew ?? 'the starting crew'} bottles the gang out
        {o?.pBottle != null ? `: ${pct(o.pBottle)} chance` : ''}.
      </div>
      <Cards
        pending={pending}
        state={state}
        note={(opt) => ((opt.action.payload as { choice?: string }).choice === 'test' ? 'Roll the test. If the gang holds, nothing more happens this round.' : 'Choose to fail the test. The gang bottles out now and its fighters start to flee.')}
      />
    </div>
  )
}

export function AssistPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  return (
    <Cards
      pending={pending}
      state={state}
      note={(o) => ((o.action.payload as { none?: boolean }).none ? 'Nobody helps; the recovering fighter rolls alone.' : 'The helper stays put. The recovering fighter rolls an extra Injury die, picks the better, and takes no Flesh Wound from the roll.')}
    />
  )
}

export function RecoveryPickPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const faces = pending.context.faces as string[] | undefined
  return (
    <div>
      {faces && (
        <div style={{ ...small, marginBottom: 5 }}>
          <Keyword term="Injury dice">Injury dice</Keyword> rolled: {faces.map((f) => humanize(f)).join(', ')}. Only one applies.
        </div>
      )}
      <Cards pending={pending} state={state} />
    </div>
  )
}

// ---------------------------------------------------------------- skills, re-rolls, confirmations

export function SkillChoicePrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const skill = pending.context.skill as string | undefined
  const name = skill ? (state.data.skills[skill]?.name ?? humanize(skill)) : null
  return (
    <div>
      {name && (
        <div style={{ ...small, marginBottom: 5 }}>
          <Keyword term={name} /> offers a choice.
        </div>
      )}
      <Cards pending={pending} state={state} />
    </div>
  )
}

export function RerollPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  return (
    <div>
      <div style={{ ...small, marginBottom: 5 }}>
        You may re-roll. The new result stands even if it is worse, and no die is re-rolled twice.
      </div>
      <Cards pending={pending} state={state} />
    </div>
  )
}

export function ConfirmPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const reason = pending.context.reason as string | undefined
  return (
    <div>
      {reason && <div style={{ ...small, marginBottom: 5 }}>{humanize(reason)}</div>}
      <Cards pending={pending} state={state} />
    </div>
  )
}
