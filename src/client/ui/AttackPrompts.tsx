// The shoot and fight prompts: weapon profile cards, target cards with the engine's odds (hit, wound, save, pin, Seriously Injured,
// Out of Action, expected Wounds), the blast and template aims, Rapid Fire hit allocation, and the fight weapon / split / after
// choices. Every number comes from `query.*`, `option.data` or `pending.context` (game/odds.ts gathers them); the glossary
// explains each term on hover. A decision kind these prompts do not know falls back to the generic list in DecisionPrompt.
import type { CSSProperties } from 'react'
import { query, type DecisionOption, type GameState, type PendingDecision } from '@/engine'
import { fightOdds, lineFor, pct, plus, profileLines, shotOdds, shotSummary, strengthText, type ProfileLine, type ShotOdds } from '../game/odds'
import { fighterName, humanize, optionFacts, optionLabel, postureWord, weaponName } from '../game/labels'
import { useGame } from '../store/game'
import { Keyword } from './Keyword'
import { useFormFactor } from './formFactor'
import { OddsChip, Pill, cardStyle } from './promptParts'
import { WeaponTable } from './Panels'
import { colors } from './theme'
import { useUi } from './uiStore'
import { seatColor } from './widgets'

const small: CSSProperties = { fontSize: 11, color: colors.muted }

function hoverProps(opt: DecisionOption) {
  return {
    onMouseEnter: () => useUi.setState({ hoverOption: opt.id }),
    onMouseLeave: () => useUi.setState({ hoverOption: null }),
    onFocus: () => useUi.setState({ hoverOption: opt.id }),
    onBlur: () => useUi.setState({ hoverOption: null }),
  }
}

function useAnswer(opt: DecisionOption): () => void {
  const dispatch = useGame((s) => s.dispatch)
  return () => {
    useUi.setState({ hoverOption: null })
    dispatch(opt.action)
  }
}

// ---------------------------------------------------------------- shoot.weapon

function WeaponCard({ opt, state, pending }: { opt: DecisionOption; state: GameState; pending: PendingDecision }) {
  const answer = useAnswer(opt)
  const fighterId = String(pending.context.fighterId ?? '')
  const p = opt.action.payload as { weaponId: string; profileId: string; twinWith?: string }
  const wielderS = (() => {
    try {
      return query.stat(state, fighterId, 'S')
    } catch {
      return null
    }
  })()
  const w = state.data.weapons[p.weaponId]
  const prof = w?.profiles.find((x) => x.id === p.profileId)
  const line: ProfileLine | null = w && prof ? lineFor(w, prof, strengthText(prof, wielderS)) : null
  const d = (opt.data ?? {}) as { cost?: string; targets?: number; doors?: number; point?: boolean; template?: boolean }
  return (
    <button type="button" data-testid={`opt-${opt.id}`} onClick={answer} {...hoverProps(opt)} style={{ ...cardStyle(), font: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <b>{optionLabel(opt, state)}</b>
        <span style={small}>{optionFacts(opt).join(' · ')}</span>
      </div>
      {p.twinWith && <div style={small}>Fires both sidearms together at -1 to hit each.</div>}
      {line && (
        <div style={{ marginTop: 3 }}>
          <WeaponTable lines={[line]} traitNames={state.data.traits} />
        </div>
      )}
      <div style={{ ...small, marginTop: 2 }}>
        {d.template ? 'A flame template: no hit roll, everything under it is hit.' : d.point ? 'Can be aimed at a point on the floor.' : ''}
        {d.cost === 'double' ? ' Takes both actions.' : ''}
      </div>
    </button>
  )
}

export function WeaponPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  return (
    <div data-testid="weapon-cards" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {(pending.options ?? []).map((o) => (
        <WeaponCard key={o.id} opt={o} state={state} pending={pending} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- shoot.target

const PRIORITY: Record<string, { kind: 'good' | 'warn' | 'info'; label: string; meaning: string }> = {
  closest: { kind: 'good', label: 'Closest', meaning: 'The closest enemy in sight: no test needed.' },
  free: { kind: 'info', label: 'Free choice', meaning: 'A farther target that is easier to hit than the closest, or the closer one is Seriously Injured: no test needed.' },
  coolTest: { kind: 'warn', label: 'Cool test', meaning: 'A farther target. Pass a Cool test first; on a fail the shot goes at the closest enemy instead.' },
}

function Mods({ o }: { o: ShotOdds }) {
  if (o.modifiers.length === 0) return null
  return (
    <span style={small}>
      {o.modifiers.map((m, i) => (
        <span key={i}>
          {i > 0 ? ', ' : ''}
          {humanize(m.label).toLowerCase()} {m.value > 0 ? `+${m.value}` : m.value}
        </span>
      ))}
    </span>
  )
}

function OddsStrip({ o }: { o: ShotOdds }) {
  return (
    <div data-testid="odds" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
      <OddsChip label="Hit" term="Hit roll" value={pct(o.pHit)} sub={o.hitNeed !== null ? (o.hitNeed > 6 ? 'needs a 6, then 6' : `needs ${plus(o.hitNeed)}`) : undefined} tone={o.pHit >= 0.6 ? 'good' : o.pHit < 0.3 ? 'bad' : 'base'} testId="odds-hit" />
      <OddsChip label="Wound" term="Wound roll" value={pct(o.pWound)} sub={o.woundNeed ? `needs ${plus(o.woundNeed)}` : undefined} testId="odds-wound" />
      <OddsChip label="Save" term="Armour save" value={pct(o.pSave)} sub={o.saveNeed === null ? 'no save' : o.saveNeed > 6 ? 'no roll' : plus(o.saveNeed)} tone={o.pSave >= 0.5 ? 'bad' : 'base'} testId="odds-save" />
      {o.pPinned > 0 && <OddsChip label="Pinned" term="Pinned" value={pct(o.pPinned)} testId="odds-pin" />}
      <OddsChip label="Down" term="Seriously Injured" value={pct(o.pSeriouslyInjured)} testId="odds-si" />
      <OddsChip label="Out" term="Out of Action" value={pct(o.pOutOfAction)} tone={o.pOutOfAction >= 0.15 ? 'good' : 'base'} testId="odds-ooa" />
    </div>
  )
}

function TargetCard({ opt, state, pending }: { opt: DecisionOption; state: GameState; pending: PendingDecision }) {
  const answer = useAnswer(opt)
  const payload = opt.action.payload as { targetId?: string; doorId?: string; point?: boolean }
  const t = payload.targetId ? state.fighters[payload.targetId] : undefined
  const odds = shotOdds(state, pending, opt)
  const d = (opt.data ?? {}) as { distance?: number; band?: string; auto?: boolean }
  if (!t) {
    return (
      <button type="button" data-testid={`opt-${opt.id}`} onClick={answer} {...hoverProps(opt)} style={{ ...cardStyle(), font: 'inherit' }}>
        <b>{optionLabel(opt, state)}</b>
        <div style={small}>
          {typeof d.distance === 'number' ? `${Math.round(d.distance * 10) / 10}" away` : ''}
          {d.band ? ` · ${d.band} range` : ''}
          {d.auto ? ' · hit automatically' : payload.point ? ' · aim comes next, and a blast on the floor is harder to land' : ''}
        </div>
      </button>
    )
  }
  const pr = odds?.priority ? PRIORITY[odds.priority] : undefined
  return (
    <button type="button" data-testid={`opt-${opt.id}`} data-closest={odds?.priority === 'closest' ? '1' : '0'} onClick={answer} {...hoverProps(opt)} style={{ ...cardStyle(), font: 'inherit', borderLeft: `4px solid ${seatColor(t.seat)}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>
          <b>{t.name}</b>{' '}
          {(state.data.fighterTypes[t.typeId]?.name ?? t.role) !== t.name && <span style={small}>{state.data.fighterTypes[t.typeId]?.name ?? t.role}</span>}
        </span>
        <span style={small}>
          {t.wounds}/{t.maxWounds} <Keyword term="W">W</Keyword>
          {t.posture !== 'standing' ? ` · ${postureWord(t.posture)}` : ''}
          {t.conditions.broken ? ' · broken' : ''}
        </span>
      </div>
      {odds ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginTop: 3 }}>
            {pr && <Pill kind={pr.kind} label={odds.priority === 'coolTest' && odds.coolNeed ? `Cool ${odds.coolNeed}+ to pick` : pr.label} term="Target priority" meaning={pr.meaning} />}
            {odds.distance !== null && <Pill kind="muted" label={`${Math.round(odds.distance * 10) / 10}"`} />}
            {odds.band && <Pill kind="muted" label={`${odds.band} range`} term={odds.band === 'short' ? 'Short range' : 'Long range'} />}
            {odds.cover && odds.cover !== 'none' && <Pill kind="warn" label={`${odds.cover} cover`} term="Cover" />}
            <Mods o={odds} />
          </div>
          <OddsStrip o={odds} />
          <div data-testid="odds-summary" style={{ ...small, marginTop: 3 }}>
            {shotSummary(odds)}
          </div>
        </>
      ) : (
        <div style={small}>{optionFacts(opt).join(' · ')}</div>
      )}
    </button>
  )
}

export function TargetPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const ff = useFormFactor()
  const shooter = String(pending.context.fighterId ?? '')
  const weaponId = String(pending.context.weaponId ?? '')
  return (
    <div>
      {!ff.compact && (
        <div style={{ ...small, marginBottom: 5 }}>
          {fighterName(state, shooter)} fires {weaponName(state, weaponId)}. Odds are for one shot; a hit also pins a standing target.
        </div>
      )}
      <div data-testid="target-cards" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {(pending.options ?? []).map((o) => (
          <TargetCard key={o.id} opt={o} state={state} pending={pending} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- shoot.aim

interface Aim {
  aim: { x: number; z: number }
  enemies: string[]
  friends: string[]
}

function parseAims(raw: unknown): Aim[] {
  if (!Array.isArray(raw)) return []
  return (raw as Partial<Aim>[]).filter((a): a is Aim => !!a && typeof a.aim?.x === 'number' && typeof a.aim?.z === 'number').map((a) => ({ aim: a.aim, enemies: a.enemies ?? [], friends: a.friends ?? [] }))
}

export function AimPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const dispatch = useGame((s) => s.dispatch)
  const note = useUi((s) => s.hoverNote)
  const ctx = pending.context as { kind?: string; fighterId?: string; weaponId?: string; profileId?: string; mode?: string; radius?: number }
  const aims = parseAims(pending.context.suggestions)
  const blast = ctx.kind === 'blast'
  const preview = (a: Aim) => {
    if (!blast || !ctx.fighterId || !ctx.weaponId || !ctx.profileId) return null
    try {
      return query.blastPreview(state, ctx.fighterId, ctx.weaponId, ctx.profileId, a.aim, ctx.mode === 'blindFire' ? 'blindFire' : 'shoot')
    } catch {
      return null
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }} data-testid="aim-prompt">
      <div style={small}>
        {blast
          ? `A blast ${ctx.radius ? `${ctx.radius * 2}" across ` : ''}hits every fighter under it, friend or enemy. Hover the board to see who is under it and the chance to land it.`
          : 'A flame template: no hit roll, every fighter under it is hit. Aim it with the board; it must fit inside your vision arc.'}
      </div>
      {note && <div style={{ fontSize: 12, color: note.ok ? '#7fe3a0' : colors.danger }}>{note.text}</div>}
      {aims.map((a, i) => {
        const pv = preview(a)
        return (
          <button
            key={i}
            type="button"
            data-testid={`aim-${i}`}
            onClick={() => dispatch({ type: 'shoot.aim', seat: pending.seat, decisionId: pending.id, payload: { x: a.aim.x, z: a.aim.z } })}
            style={{ ...cardStyle(), font: 'inherit' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>Suggested aim {i + 1}</b>
              {pv && <span style={small}>{pct(pv.chance)} to land</span>}
            </div>
            <div style={{ fontSize: 12 }}>
              Enemies under it: {a.enemies.length === 0 ? 'none' : a.enemies.map((id) => fighterName(state, id)).join(', ')}
            </div>
            <div style={{ fontSize: 12, color: a.friends.length > 0 ? '#ff8a7a' : colors.muted }}>
              Friends under it: {a.friends.length === 0 ? 'none' : a.friends.map((id) => fighterName(state, id)).join(', ')}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- shoot.allocate

export function AllocatePrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const c = pending.context as { hits?: number; hit?: number; firstTarget?: string }
  return (
    <div>
      <div style={{ ...small, marginBottom: 5 }}>
        <Keyword term="Rapid Fire" /> gave {c.hits ?? 'extra'} hits. Choose who takes hit {c.hit ?? 'the next'}. The first hit always goes to {fighterName(state, c.firstTarget)}.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {(pending.options ?? []).map((o) => (
          <AllocateRow key={o.id} opt={o} state={state} />
        ))}
      </div>
    </div>
  )
}

function AllocateRow({ opt, state }: { opt: DecisionOption; state: GameState }) {
  const answer = useAnswer(opt)
  const id = (opt.action.payload as { targetId?: string }).targetId
  const t = id ? state.fighters[id] : undefined
  return (
    <button type="button" data-testid={`opt-${opt.id}`} onClick={answer} {...hoverProps(opt)} style={{ ...cardStyle(), font: 'inherit', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <b>{optionLabel(opt, state)}</b>
      {t && (
        <span style={small}>
          {t.wounds}/{t.maxWounds} W{t.posture !== 'standing' ? ` · ${postureWord(t.posture)}` : ''}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- fight

const r1 = (n: number): string => String(Math.round(n * 10) / 10)

function FightOddsView({ state, attacker, weaponIds, targets, charge }: { state: GameState; attacker: string; weaponIds: string[]; targets: string[]; charge: boolean }) {
  const o = fightOdds(state, attacker, weaponIds, targets.length > 0 ? targets : undefined, charge)
  if (!o || o.targets.length === 0) return null
  return (
    <div data-testid="fight-odds" style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {o.targets.map((t) => (
        <div key={t.targetId} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{ ...small, minWidth: 72 }}>{fighterName(state, t.targetId)}</span>
          <OddsChip label="Dice" term="A" value={String(t.dice)} sub={`hit on ${plus(t.need)}`} />
          <OddsChip label="Hits" term="Hit roll" value={r1(t.expectedHits)} sub="expected" />
          <OddsChip label="Wounds" term="W" value={r1(t.expectedWounds)} sub="expected" />
          <OddsChip label="Down" term="Seriously Injured" value={pct(t.pSeriouslyInjured)} />
          <OddsChip label="Out" term="Out of Action" value={pct(t.pOutOfAction)} tone={t.pOutOfAction >= 0.15 ? 'good' : 'base'} />
        </div>
      ))}
      {o.reactions.map((x) => (
        <div key={x.fighterId} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{ ...small, minWidth: 72 }}>{fighterName(state, x.fighterId)} strikes back</span>
          <OddsChip label="Dice" term="A" value={String(x.dice)} sub={`hit on ${plus(x.need)}`} />
          <OddsChip label="Wounds" term="W" value={r1(x.expectedWounds)} sub="expected" tone="bad" />
        </div>
      ))}
    </div>
  )
}

function FightCard({ opt, state, pending, targets }: { opt: DecisionOption; state: GameState; pending: PendingDecision; targets: string[] }) {
  const answer = useAnswer(opt)
  const attacker = String(pending.context.fighterId ?? '')
  const charge = pending.context.charge === true
  const p = opt.action.payload as { weaponIds?: string[] }
  const weaponIds = p.weaponIds ?? []
  const lines: ProfileLine[] = attacker && weaponIds.length > 0 ? profileLines(state, attacker).filter((l) => weaponIds.includes(l.weaponId)) : []
  return (
    <button type="button" data-testid={`opt-${opt.id}`} onClick={answer} {...hoverProps(opt)} style={{ ...cardStyle(), font: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>{optionLabel(opt, state)}</b>
        <span style={small}>{optionFacts(opt).join(' \u00b7 ')}</span>
      </div>
      {lines.length > 0 && <WeaponTable lines={lines} traitNames={state.data.traits} />}
      {attacker && <FightOddsView state={state} attacker={attacker} weaponIds={weaponIds} targets={targets} charge={charge} />}
    </button>
  )
}

export function FightWeaponsPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const targets = (pending.context.targets as string[] | undefined) ?? []
  const attacker = String(pending.context.fighterId ?? '')
  const reaction = pending.context.role === 'reaction'
  return (
    <div>
      <div style={{ ...small, marginBottom: 5 }}>
        {attacker ? `${fighterName(state, attacker)} ${reaction ? 'strikes back at' : 'fights'} ${targets.length > 0 ? targets.map((t) => fighterName(state, t)).join(', ') : 'whoever it is touching'}. ` : ''}
        Two weapons add an attack die; a charge adds another; sidearms take at most one die each.
      </div>
      <div data-testid="fight-cards" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {(pending.options ?? []).map((o) => (
          <FightCard key={o.id} opt={o} state={state} pending={pending} targets={targets} />
        ))}
      </div>
    </div>
  )
}

export function FightSplitPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  return (
    <div>
      <div style={{ ...small, marginBottom: 5 }}>
        You are touching more than one enemy. Choose how the {String(pending.context.dice ?? '')} attack dice are divided between them; each enemy shows what it needs to be hit.
      </div>
      <div data-testid="split-cards" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {(pending.options ?? []).map((o) => (
          <SplitRow key={o.id} opt={o} state={state} />
        ))}
      </div>
    </div>
  )
}

function SplitRow({ opt, state }: { opt: DecisionOption; state: GameState }) {
  const answer = useAnswer(opt)
  const split = (opt.action.payload as { split?: Record<string, number> }).split ?? {}
  const needs = ((opt.data ?? {}) as { needs?: Record<string, number> }).needs ?? {}
  return (
    <button type="button" data-testid={`opt-${opt.id}`} onClick={answer} onMouseEnter={() => useUi.setState({ hoverFighter: Object.keys(split)[0] ?? null })} onMouseLeave={() => useUi.setState({ hoverFighter: null })} style={{ ...cardStyle(), font: 'inherit', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <b>{optionLabel(opt, state)}</b>
      <span style={small}>
        {Object.keys(split)
          .map((id) => `${fighterName(state, id)} hit on ${plus(needs[id] ?? null)}`)
          .join(' \u00b7 ')}
      </span>
    </button>
  )
}

export function FightAfterPrompt({ pending, state }: { pending: PendingDecision; state: GameState }) {
  return (
    <div data-testid="after-cards" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {(pending.options ?? []).map((o) => (
        <AfterRow key={o.id} opt={o} state={state} />
      ))}
    </div>
  )
}

function AfterRow({ opt, state }: { opt: DecisionOption; state: GameState }) {
  const answer = useAnswer(opt)
  const choice = (opt.action.payload as { choice?: string }).choice
  const text = choice === 'coupDeGrace' ? 'Takes the Seriously Injured enemy Out of Action, for good.' : choice === 'consolidate' ? 'Move up to 2 inches in any direction, keeping an inch from enemies.' : 'Stay where you are.'
  return (
    <button type="button" data-testid={`opt-${opt.id}`} onClick={answer} {...hoverProps(opt)} style={{ ...cardStyle(choice === 'coupDeGrace' ? { primary: true } : {}), font: 'inherit' }}>
      <b>{optionLabel(opt, state)}</b>
      <div style={small}>{text}</div>
    </button>
  )
}
