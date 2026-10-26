// Dedicated prompts for the attack sequences: weapon profile cards with engine odds, target candidates with
// cover / obscured badges, the cover save explained, the defender's block choice, fight target / weapon, the
// alternating strike / block with the engine's minimax hint, and re-rolls. Every number is the engine's.
import { useMemo } from 'react'
import type { DecisionOption, GameState, PendingDecision } from '@/engine'
import { validTargets } from '@/engine/attack-common'
import { expectedDamage } from '@/engine/query'
import { optionOperative } from '../interaction/controller'
import { blockHeadline, blockOption, coverSaveInfo, fightHint, fightOption, fightTargetCard, fightView, passLabel, pct, rerollHeadline, rerollOption, targetCard, unlistedTargets, weaponCard } from '../game/promptLabels'
import { opName, weaponName } from '../game/labels'
import { useGame } from '../store/game'
import { colors } from './theme'
import { Keyword, KeywordText, WeaponRules } from './Keyword'
import { useUi } from './uiStore'
import { Btn, Muted } from './widgets'
import { cardStyle, CountDice, DiceRow, Pill, PromptHeader, Section } from './promptParts'

function hoverProps(id: string | null) {
  return {
    onMouseEnter: () => useUi.setState({ hoverOp: id }),
    onMouseLeave: () => useUi.setState({ hoverOp: null }),
  }
}

/** Atk / Hit / Dmg stat line of a weapon profile, each label a keyword (text stays "Atk 4 · Hit 3+ · Dmg 3/4"). */
function WeaponStats({ atk, hit, normal, crit, testId }: { atk: number | null; hit: number | null; normal: number | null; crit: number | null; testId?: string }) {
  return (
    <span data-testid={testId} style={{ fontVariantNumeric: 'tabular-nums', color: colors.accent, fontWeight: 700 }}>
      <Keyword term="Atk" /> {atk ?? '?'} · <Keyword term="Hit" /> {hit ?? '?'}+ · <Keyword term="Dmg" /> {normal ?? '?'}/{crit ?? '?'}
    </span>
  )
}

/** Raw rule uses of an option's weapon profile (the engine's own list, so Crits variants and Heavy exceptions show). */
function ruleUses(o: DecisionOption): { rule: string; x?: number; inches?: number; target?: number | string; crits?: boolean; only?: string }[] {
  const r = (o.data as { rules?: unknown } | undefined)?.rules
  return Array.isArray(r) ? (r as ReturnType<typeof ruleUses>) : []
}

function PassButton({ pending, label }: { pending: PendingDecision; label?: string }) {
  const choose = useGame((g) => g.choose)
  if (!pending.canPass) return null
  return (
    <Btn data-testid="opt-pass" onClick={() => choose('pass')}>
      {label ?? passLabel(pending.kind)}
    </Btn>
  )
}

// ---------------------------------------------------------------- shoot.weapon

export function ShootWeaponBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const hover = useUi((s) => s.hoverOp)
  const opId = String(pending.context.operativeId)
  const op = state.operatives[opId]
  // engine odds per weapon: against the hovered enemy when there is one, else against the best target
  const odds = useMemo(() => {
    const out: Record<string, { id: string; mean: number; kill: number }[]> = {}
    if (!op) return out
    for (const o of pending.options ?? []) {
      const w = String((o.action.payload as { weaponId: string }).weaponId)
      try {
        out[o.id] = validTargets(state, op, w).map((t) => {
          const e = expectedDamage(state, op.id, w, t.id)
          return { id: t.id, mean: e.mean, kill: e.killProbability }
        })
      } catch {
        out[o.id] = []
      }
    }
    return out
  }, [state, pending, op])
  const hovered = hover && state.operatives[hover] && state.operatives[hover]!.seat !== op?.seat ? hover : null
  return (
    <>
      <PromptHeader pending={pending} hint={`${opName(state, opId)} can fire one of these profiles. Hover an enemy on the board to see the odds against it.`} />
      <div style={{ display: 'grid', gap: 6 }} data-testid="weapon-cards">
        {(pending.options ?? []).map((o) => {
          const c = weaponCard(o)
          const list = odds[o.id] ?? []
          const vs = hovered ? list.find((t) => t.id === hovered) : undefined
          const best = list.reduce<(typeof list)[number] | null>((b, t) => (!b || t.mean > b.mean ? t : b), null)
          return (
            <button key={o.id} type="button" data-testid={`opt-${o.id}`} style={cardStyle()} onClick={() => choose(o.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <b style={{ fontSize: 14 }}>{c.name}</b>
                <WeaponStats testId="weapon-stats" atk={c.atk} hit={c.hit} normal={c.normal} crit={c.crit} />
              </div>
              {c.rules.length > 0 && (
                <div data-testid="weapon-rules" style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  <WeaponRules rules={ruleUses(o)} empty={c.rules.map((r) => r.name).join(', ')} />
                </div>
              )}
              <div style={{ fontSize: 12, marginTop: 4 }} data-testid="weapon-odds">
                {vs ? (
                  <>
                    Against {opName(state, vs.id)}: expected damage <b>{vs.mean.toFixed(1)}</b>, kill <b>{pct(vs.kill)}</b>
                  </>
                ) : best ? (
                  <>
                    Best target {opName(state, best.id)}: expected damage <b>{best.mean.toFixed(1)}</b>, kill <b>{pct(best.kill)}</b>
                    {c.targets !== null && c.targets > 1 ? ` (${c.targets} targets)` : ''}
                  </>
                ) : (
                  <span style={{ color: colors.muted }}>{c.targets === 0 ? 'No valid target' : `${c.targets ?? '?'} target${c.targets === 1 ? '' : 's'}`}</span>
                )}
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

// ---------------------------------------------------------------- shoot.target

export function ShootTargetBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const secondary = pending.context.secondary === true
  const weaponId = String(pending.context.weaponId ?? '')
  const w = state.data.weapons[weaponId]
  const unlisted = useMemo(() => unlistedTargets(state, pending), [state, pending])
  if (secondary) {
    return (
      <>
        <PromptHeader pending={pending} title="Add secondary targets" hint={`${weaponName(state, weaponId)} also hits what is near the target. Add any you want, then finish.`} />
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          {(pending.options ?? []).filter((o) => o.id !== 'done').map((o) => (
            <button key={o.id} type="button" data-testid={`opt-${o.id}`} style={cardStyle()} onClick={() => choose(o.id)} {...hoverProps(optionOperative(o))}>
              Add <b>{opName(state, optionOperative(o))}</b>
              {typeof o.data?.distance === 'number' ? <span style={{ color: colors.muted }}> · {o.data.distance.toFixed(1)}″ from the primary</span> : null}
            </button>
          ))}
        </div>
        <Btn data-testid="opt-done" variant="primary" onClick={() => choose('done')}>
          Done, roll the attack
        </Btn>
      </>
    )
  }
  return (
    <>
      <PromptHeader
        pending={pending}
        hint={`${opName(state, String(pending.context.operativeId))} shoots with ${w?.name ?? 'a weapon'}${w ? ` (Atk ${w.atk}, Hit ${w.hit}+, Dmg ${w.dmg.normal}/${w.dmg.crit})` : ''}. Click a target here or on the board.${typeof pending.context.barredId === 'string' ? ` Blinding Aura bars ${opName(state, pending.context.barredId)}: pick another target.` : ''}`}
      />
      <div style={{ display: 'grid', gap: 6 }} data-testid="target-cards">
        {(pending.options ?? []).map((o) => {
          const c = targetCard(o, state)
          return (
            <button key={o.id} type="button" data-testid={`opt-${o.id}`} data-verdict={c.badge.kind} style={cardStyle()} onClick={() => choose(o.id)} {...hoverProps(c.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <b>{c.name}</b>
                <Pill kind={c.badge.kind} label={c.badge.label} meaning={c.badge.meaning} />
              </div>
              <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} data-testid="target-line">
                <KeywordText text={c.line} keywords={false} />
              </div>
            </button>
          )
        })}
        {unlisted.map((u) => (
          <div key={u.id} data-testid={`unlisted-${u.id}`} style={{ ...cardStyle({ disabled: true }), cursor: 'default' }} {...hoverProps(u.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <b>{u.name}</b>
              <Pill kind="unseen" label={u.badge.label} />
            </div>
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
              <KeywordText text={u.reason} keywords={false} />
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

// ---------------------------------------------------------------- shoot.coverSave

export function CoverSaveBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const info = coverSaveInfo(pending.context, state)
  const collected = Number(pending.context.collected ?? 0)
  return (
    <>
      <PromptHeader pending={pending} hint={info.headline} />
      <div data-testid="cover-explain" style={{ fontSize: 13, marginBottom: 8 }}>
        <KeywordText text={info.explain} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }} aria-label={`${collected} defence dice collected`}>
        {Array.from({ length: collected }, (_, i) => (
          <span key={i} style={{ width: 22, height: 22, borderRadius: 6, border: `2px dashed ${colors.muted}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: colors.muted }}>
            ?
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {(pending.options ?? []).map((o, i) => {
          const retained = Number((o.data as { retained?: number } | undefined)?.retained ?? 0)
          return (
            <button key={o.id} type="button" data-testid={`opt-${o.id}`} style={cardStyle({ primary: i === 0 })} onClick={() => choose(o.id)}>
              <b>
                <KeywordText text={o.id === 'retain' ? 'Keep one cover save (no roll)' : o.id === 'roll' ? 'Roll all defence dice' : o.id === 'retainCrit' ? 'Keep one cover save as a critical' : 'Keep two cover saves'} />
              </b>
              <div style={{ fontSize: 12, color: colors.muted }}>
                <KeywordText text={retained > 0 ? `${retained} guaranteed ${o.id === 'retainCrit' ? 'critical ' : ''}success${retained === 1 ? '' : 'es'}; ${Math.max(0, collected - retained)} left to roll.` : `Every die is rolled${info.expectedRolled !== null ? ` (about ${info.expectedRolled.toFixed(1)} successes expected)` : ''}.`} />
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- shoot.block

export function BlockBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const at = (pending.context.attack as { normal: number; crit: number }) ?? { normal: 0, crit: 0 }
  const df = (pending.context.defence as { normal: number; crit: number }) ?? { normal: 0, crit: 0 }
  const infos = (pending.options ?? []).map(blockOption)
  return (
    <>
      <PromptHeader pending={pending} hint={blockHeadline(pending.context, state)} />
      <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <CountDice normal={at.normal} crit={at.crit} label="Attack hits" />
        <CountDice normal={df.normal} crit={df.crit} label="Your saves" />
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {infos.map((b, i) => (
          <button key={b.id} type="button" data-testid={`opt-${b.id}`} style={cardStyle({ primary: i === 0 })} onClick={() => choose(b.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>
                <KeywordText text={b.label} />
              </b>
              {b.damage !== null && (
                <span style={{ color: b.damage === 0 ? '#6dff9a' : '#ff8a80', fontWeight: 800 }} data-testid="block-damage">
                  {b.damage} damage
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: colors.muted }}>
              <KeywordText text={b.detail} />
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- fight.target / fight.weapon

export function FightTargetBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  return (
    <>
      <PromptHeader pending={pending} hint={`${opName(state, String(pending.context.operativeId))} is in control range of these enemies. Click one here or on the board.`} />
      <div style={{ display: 'grid', gap: 6 }} data-testid="fight-target-cards">
        {(pending.options ?? []).map((o) => {
          const c = fightTargetCard(o, state)
          const pctWounds = c.wounds !== null && c.maxWounds ? c.wounds / c.maxWounds : null
          return (
            <button key={o.id} type="button" data-testid={`opt-${o.id}`} style={cardStyle()} onClick={() => choose(o.id)} {...hoverProps(c.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <b>{c.name}</b>
                {pctWounds !== null && (
                  <span style={{ width: 70, height: 6, background: '#33343c', borderRadius: 3, overflow: 'hidden', display: 'inline-block' }}>
                    <span style={{ display: 'block', width: `${Math.round(pctWounds * 100)}%`, height: '100%', background: pctWounds > 0.5 ? '#6dff9a' : pctWounds > 0.25 ? '#ffb347' : '#ff6a5f' }} />
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: colors.muted }}>
                <KeywordText text={c.line} keywords={false} />
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

export function FightWeaponBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const retaliating = pending.context.retaliating === true
  return (
    <>
      <PromptHeader
        pending={pending}
        hint={`${opName(state, String(pending.context.operativeId))} ${retaliating ? 'retaliates' : 'attacks'}: pick the melee weapon. Both sides roll before anyone strikes.`}
      />
      <div style={{ display: 'grid', gap: 6 }}>
        {(pending.options ?? []).map((o) => {
          const c = weaponCard(o)
          return (
            <button key={o.id} type="button" data-testid={`opt-${o.id}`} style={cardStyle()} onClick={() => choose(o.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <b>{c.name}</b>
                <WeaponStats atk={c.atk} hit={c.hit} normal={c.normal} crit={c.crit} />
              </div>
              {c.rules.length > 0 && (
                <div data-testid="weapon-rules" style={{ fontSize: 11, color: colors.muted }}>
                  <WeaponRules rules={ruleUses(o)} empty={c.rules.map((r) => r.name).join(', ')} />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- fight.resolve

export function FightResolveBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const view = useMemo(() => fightView(state, pending), [state, pending])
  const hint = useMemo(() => fightHint(state, pending), [state, pending])
  const options = (pending.options ?? []).map((o) => ({ o, info: fightOption(o, view, hint) }))
  const strikes = options.filter((x) => x.info.op === 'strike')
  const blocks = options.filter((x) => x.info.op === 'block')
  const button = (x: (typeof options)[number]) => (
    <button
      key={x.o.id}
      type="button"
      data-testid={`opt-${x.o.id}`}
      data-op={x.info.op}
      data-best={x.info.best ? '1' : '0'}
      style={{ ...cardStyle({ primary: x.info.best }), borderColor: x.info.op === 'strike' ? 'rgba(255,106,95,0.7)' : 'rgba(127,200,255,0.7)' }}
      onClick={() => choose(x.o.id)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>
          <KeywordText text={x.info.label} />
        </b>
        {x.info.best && <span style={{ color: colors.accent, fontSize: 11, fontWeight: 800 }}>engine suggests</span>}
      </div>
      <div style={{ fontSize: 12, color: colors.muted }}>
        <KeywordText text={x.info.effect} />
      </div>
    </button>
  )
  return (
    <>
      <PromptHeader pending={pending} hint="Take turns spending one success each: strike to wound, or block to cancel one of theirs." />
      {view && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
          <Section title={`${view.myName} · ${view.myWounds} wounds`}>
            <DiceRow dice={view.mine} />
          </Section>
          <Section title={`${view.foeName} · ${view.foeWounds} wounds`}>
            <DiceRow dice={view.theirs} />
          </Section>
        </div>
      )}
      {hint && (
        <div data-testid="fight-hint" style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
          <KeywordText text={hint.text} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: strikes.length && blocks.length ? '1fr 1fr' : '1fr', gap: 8 }}>
        {strikes.length > 0 && <div style={{ display: 'grid', gap: 6 }}>{strikes.map(button)}</div>}
        {blocks.length > 0 && <div style={{ display: 'grid', gap: 6 }}>{blocks.map(button)}</div>}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- dice.reroll / dice.commandReroll

export function RerollBody({ pending, state }: { pending: PendingDecision; state: GameState }) {
  const choose = useGame((g) => g.choose)
  const hoverId = useUi((s) => s.hoverOption)
  const dice = (pending.context.dice as (number | null)[] | undefined) ?? []
  const kinds = (pending.context.kinds as ('fail' | 'normal' | 'crit')[] | undefined) ?? []
  const infos = (pending.options ?? []).map((o: DecisionOption) => ({ o, info: rerollOption(o, state) }))
  const hovered = infos.find((x) => x.o.id === hoverId)
  const command = pending.kind === 'dice.commandReroll'
  const cp = Number(pending.context.cp ?? state.players[pending.seat].cp)
  const view = dice.map((value, i) => ({ value, kind: kinds[i] ?? 'normal', used: false }))
  return (
    <>
      <PromptHeader pending={pending} hint={rerollHeadline(pending, state)} />
      <Section title={`${String(pending.context.side ?? 'dice')} dice${command ? ` · ${cp} CP available` : ''}`}>
        <DiceRow dice={view} highlight={hovered?.info.dice} />
      </Section>
      <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
        {infos.map(({ o, info }) => (
          <button
            key={o.id}
            type="button"
            data-testid={`opt-${o.id}`}
            style={cardStyle()}
            onClick={() => choose(o.id)}
            onMouseEnter={() => useUi.setState({ hoverOption: o.id })}
            onMouseLeave={() => useUi.setState({ hoverOption: null })}
          >
            <b>
              <KeywordText text={info.label} />
            </b>
            <div style={{ fontSize: 12, color: colors.muted }}>
              <KeywordText text={info.command ? `Costs ${info.cost} CP. The new result stands.` : 'Free. Each die can be re-rolled only once.'} />
            </div>
          </button>
        ))}
      </div>
      <PassButton pending={pending} />
      <Muted style={{ marginTop: 6 }}>Highlighted dice are the ones the option re-rolls.</Muted>
    </>
  )
}
