// Prompt label builders: the sentences, badges and numbers the dedicated decision prompts show. Pure and
// state-injectable (no React, no store) so tests can run every decision kind of a real game through them.
// Every number comes from the engine (option data, pending.context, query.*, validate); this file only words it,
// in our own wording.
import type { Action, DecisionOption, GameState, PendingDecision, Seat } from '@/engine'
import { validate } from '@/engine'
import { findOffer } from '@/engine/abilities'
import { windowsOf } from '@/engine/ploys'
import { fightOutcome, hitOdds, type FightMove, type FightPosition, type FightSideState } from '@/engine/query'
import { dataBundle } from './adapter'
import { ployParamLabel } from '../teams'
import { decisionInfo, humanize, opName, rulesLine, SEAT_NAME, weaponName } from './labels'

export const pct = (v: number): string => `${Math.round(v * 100)}%`

type Dict = Record<string, unknown>
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

// ---------------------------------------------------------------- weapons (shoot.weapon, fight.weapon)

export interface RuleInfo {
  name: string
  text: string
}

export interface WeaponCardInfo {
  name: string
  /** "A4 · 3+ · 3/4" */
  stats: string
  atk: number | null
  hit: number | null
  normal: number | null
  crit: number | null
  rules: RuleInfo[]
  targets: number | null
  group: string | null
}

/** Name and one-sentence text of a weapon rule (the rule's own record in the data). */
export function ruleInfo(r: { rule: string; x?: number; inches?: number; target?: number }): RuleInfo {
  const rec = dataBundle().byId[r.rule] as { name?: string; text?: string } | undefined
  const val = r.inches !== undefined ? ` ${r.inches}″` : r.x !== undefined ? ` ${r.x}` : r.target !== undefined ? ` ${r.target}+` : ''
  return { name: `${rec?.name ?? humanize(r.rule)}${val}`, text: rec?.text ?? '' }
}

export function weaponCard(opt: DecisionOption): WeaponCardInfo {
  const d = (opt.data ?? {}) as Dict
  const dmg = d.dmg as { normal?: number; crit?: number } | undefined
  const atk = num(d.atk)
  const hit = num(d.hit)
  const normal = num(dmg?.normal)
  const crit = num(dmg?.crit)
  const rules = Array.isArray(d.rules) ? (d.rules as { rule: string }[]).map((r) => ruleInfo(r)) : []
  return {
    name: str(d.name) ?? humanize(String((opt.action.payload as Dict).weaponId ?? opt.id)),
    stats: `A${atk ?? '?'} · ${hit ?? '?'}+ · ${normal ?? '?'}/${crit ?? '?'}`,
    atk,
    hit,
    normal,
    crit,
    rules,
    targets: num(d.targets),
    group: str(d.profileGroup),
  }
}

// ---------------------------------------------------------------- targets (shoot.target, fight.target)

export type BadgeKind = 'valid' | 'cover' | 'improved' | 'obscured' | 'choice' | 'unseen'

export interface TargetBadge {
  kind: BadgeKind
  label: string
  /** one sentence saying what it means for the attack */
  meaning: string
}

export function targetBadge(d: Dict): TargetBadge {
  if (d.forcedChoice === true) {
    return { kind: 'choice', label: 'cover or obscured', meaning: 'The defender picks cover or obscured; the odds below assume the better one for them.' }
  }
  if (d.obscured === true) {
    return { kind: 'obscured', label: 'obscured', meaning: 'Obscured: one of your successes is discarded and critical hits count as normal hits.' }
  }
  if (d.inCover === true) {
    return d.improvedCover === true
      ? { kind: 'improved', label: 'improved cover', meaning: 'Improved cover: the defender keeps a cover save as a critical or keeps two.' }
      : { kind: 'cover', label: 'in cover', meaning: 'In cover: the defender may keep one defence die without rolling it.' }
  }
  return { kind: 'valid', label: 'clear shot', meaning: 'No cover and not obscured.' }
}

export interface TargetCardInfo {
  id: string
  name: string
  badge: TargetBadge
  distance: number | null
  expectedDamage: number | null
  killProbability: number | null
  line: string
  vantage: boolean
}

export function targetCard(opt: DecisionOption, state: GameState | null): TargetCardInfo {
  const d = (opt.data ?? {}) as Dict
  const id = str((opt.action.payload as Dict).targetId) ?? opt.id
  const distance = num(d.distance)
  const expectedDamage = num(d.expectedDamage)
  const killProbability = num(d.killProbability)
  const bits: string[] = []
  if (distance !== null) bits.push(`${distance.toFixed(1)}″`)
  if (expectedDamage !== null) bits.push(`expected damage ${expectedDamage.toFixed(1)}`)
  if (killProbability !== null) bits.push(`kill ${pct(killProbability)}`)
  if (d.vantageAccurate) bits.push(`Vantage: Accurate ${d.vantageAccurate}`)
  return { id, name: opName(state, id), badge: targetBadge(d), distance, expectedDamage, killProbability, line: bits.join(' · '), vantage: !!d.vantageAccurate }
}

export interface UnlistedTarget {
  id: string
  name: string
  badge: TargetBadge
  /** the engine's own reason this enemy cannot be targeted */
  reason: string
}

/** Enemies that are not offered as shoot targets, with the engine's reason (from `validate` on a trial answer). */
export function unlistedTargets(state: GameState, pending: PendingDecision): UnlistedTarget[] {
  if (pending.kind !== 'shoot.target') return []
  const listed = new Set((pending.options ?? []).map((o) => String((o.action.payload as Dict).targetId)))
  const out: UnlistedTarget[] = []
  for (const op of Object.values(state.operatives)) {
    if (op.seat === pending.seat || op.status !== 'active' || listed.has(op.id)) continue
    const trial: Action = { type: 'shoot.target', seat: pending.seat, decisionId: pending.id, payload: { targetId: op.id } }
    const rej = validate(state, trial)
    out.push({
      id: op.id,
      name: opName(state, op.id),
      badge: { kind: 'unseen', label: 'not visible', meaning: 'Cannot be targeted.' },
      reason: rej?.reason ?? 'Not a legal target for this weapon.',
    })
  }
  return out
}

export interface FightTargetInfo {
  id: string
  name: string
  wounds: number | null
  maxWounds: number | null
  distance: number | null
  line: string
}

export function fightTargetCard(opt: DecisionOption, state: GameState | null): FightTargetInfo {
  const d = (opt.data ?? {}) as Dict
  const id = str((opt.action.payload as Dict).targetId) ?? opt.id
  const wounds = num(d.wounds)
  const maxWounds = num(d.maxWounds)
  const distance = num(d.distance)
  const bits: string[] = []
  if (wounds !== null) bits.push(`${wounds}${maxWounds !== null ? `/${maxWounds}` : ''} wounds left`)
  if (distance !== null) bits.push(`${distance.toFixed(1)}″ away`)
  return { id, name: opName(state, id), wounds, maxWounds, distance, line: bits.join(' · ') }
}

// ---------------------------------------------------------------- defence (shoot.coverSave, shoot.block)

export interface CoverSaveInfo {
  headline: string
  explain: string
  /** chance that one rolled defence die is a success */
  successChance: number | null
  expectedRolled: number | null
}

/** Explains the retained die: keeping a cover save is a sure success, rolling is a gamble on every die. */
export function coverSaveInfo(ctx: Dict, state?: GameState | null): CoverSaveInfo {
  const collected = num(ctx.collected) ?? 0
  const need = num(ctx.need)
  const improved = ctx.improved === true
  // the engine's own per-die odds for the save target: a success is a normal or a critical result
  const odds = need !== null ? hitOdds(need) : null
  const chance: number | null = odds ? odds.normal + odds.crit : null
  const target = state && ctx.targetId ? opName(state, String(ctx.targetId)) : 'The defender'
  const headline = `${target} has ${collected} defence ${collected === 1 ? 'die' : 'dice'} (save ${need ?? '?'}+) and is in ${improved ? 'improved ' : ''}cover.`
  const keep = improved
    ? 'Keeping a die as a critical success or keeping two normal successes is guaranteed; the rest are rolled.'
    : 'Keeping one die as a normal success is guaranteed; the rest are rolled.'
  const roll = chance !== null ? ` Rolling all ${collected} gives each die a ${pct(chance)} chance, about ${(collected * chance).toFixed(1)} successes in total.` : ''
  return { headline, explain: `${keep}${roll}`, successChance: chance, expectedRolled: chance !== null ? collected * chance : null }
}

export interface BlockOptionInfo {
  id: string
  isAuto: boolean
  label: string
  detail: string
  damage: number | null
  unblockedNormal: number | null
  unblockedCrit: number | null
}

export function blockOption(opt: DecisionOption): BlockOptionInfo {
  const d = (opt.data ?? {}) as Dict
  const damage = num(d.damage)
  const un = num(d.unblockedNormal)
  const uc = num(d.unblockedCrit)
  const isAuto = opt.id === 'auto'
  const through = un !== null && uc !== null ? `${un} normal and ${uc} critical get through` : ''
  return {
    id: opt.id,
    isAuto,
    label: isAuto ? 'Auto block (the engine picks the best block)' : `Leave ${un ?? '?'} normal and ${uc ?? '?'} critical unblocked`,
    detail: [damage !== null ? `takes ${damage} damage` : '', through].filter(Boolean).join(' · '),
    damage,
    unblockedNormal: un,
    unblockedCrit: uc,
  }
}

export function blockHeadline(ctx: Dict, state: GameState | null): string {
  const at = ctx.attack as { normal: number; crit: number } | undefined
  const df = ctx.defence as { normal: number; crit: number } | undefined
  const dmg = ctx.dmg as { normal: number; crit: number } | undefined
  const target = state && ctx.targetId ? opName(state, String(ctx.targetId)) : 'The defender'
  const parts = [
    at ? `${at.normal} normal and ${at.crit} critical attack hits` : '',
    df ? `${df.normal} normal and ${df.crit} critical saves` : '',
    dmg ? `each hit deals ${dmg.normal} (${dmg.crit} on a critical)` : '',
  ].filter(Boolean)
  return `${target}: ${parts.join('; ')}.`
}

// ---------------------------------------------------------------- fight (fight.resolve)

export interface DieView {
  value: number | null
  kind: 'fail' | 'normal' | 'crit'
  used: boolean
}

export interface FightView {
  mine: DieView[]
  theirs: DieView[]
  myName: string
  foeName: string
  myWounds: number
  foeWounds: number
  myDmg: { normal: number; crit: number } | null
  foeDmg: { normal: number; crit: number } | null
}

/** Both fighters' pools as the engine holds them (values, classes, which are spent), plus names and wounds. */
export function fightView(state: GameState, pending: PendingDecision): FightView | null {
  const seq = state.attack?.seq
  if (!seq) return null
  const mineSide = seq.atk.seat === pending.seat && seq.atk.weaponId ? seq.atk : seq.def
  const theirSide = mineSide === seq.atk ? seq.def : seq.atk
  if (!mineSide || !theirSide) return null
  const view = (side: typeof mineSide): DieView[] => side.dice.map((d) => ({ value: d.value, kind: d.kind, used: d.used === true }))
  const dmgOf = (side: typeof mineSide) => (side.weaponId ? (state.data.weapons[side.weaponId]?.dmg ?? null) : null)
  return {
    mine: view(mineSide),
    theirs: view(theirSide),
    myName: opName(state, mineSide.operativeId),
    foeName: opName(state, theirSide.operativeId),
    myWounds: state.operatives[mineSide.operativeId]?.wounds ?? 0,
    foeWounds: state.operatives[theirSide.operativeId]?.wounds ?? 0,
    myDmg: dmgOf(mineSide),
    foeDmg: dmgOf(theirSide),
  }
}

/** The fight as a position for `query.fightOutcome` (same reading of the dice and weapon rules as the engine's own default answer). */
export function fightPosition(state: GameState, pending: PendingDecision): FightPosition | null {
  const a = state.attack
  const seq = a?.seq
  const f = a?.fight
  if (!seq || !f) return null
  const mine = seq.atk.seat === pending.seat && seq.atk.weaponId ? seq.atk : seq.def
  if (!mine) return null
  const sideState = (side: typeof seq.atk): FightSideState => {
    let normals = 0
    let crits = 0
    for (const d of side.dice) {
      if (d.used) continue
      if (d.kind === 'normal') normals++
      else if (d.kind === 'crit') crits++
    }
    const w = side.weaponId ? state.data.weapons[side.weaponId] : undefined
    const has = (key: string) => !!w?.rules.some((r) => r.rule.toLowerCase().replace(/[^a-z]/g, '').endsWith(key))
    return {
      normals,
      crits,
      dmg: w?.dmg ?? { normal: 0, crit: 0 },
      wounds: state.operatives[side.operativeId]?.wounds ?? 0,
      shock: has('shock') && !f.shockUsed[side.seat],
      brutal: has('brutal'),
    }
  }
  return { a: sideState(seq.atk), d: seq.def ? sideState(seq.def) : sideState(seq.atk), turn: mine === seq.atk ? 'a' : 'd' }
}

export interface FightHint {
  /** final wounds with best play by both fighters */
  myWounds: number
  foeWounds: number
  moves: FightMove[]
  text: string
}

export function fightHint(state: GameState, pending: PendingDecision): FightHint | null {
  const pos = fightPosition(state, pending)
  const v = fightView(state, pending)
  if (!pos || !v) return null
  const out = fightOutcome(pos)
  const mineIsA = pos.turn === 'a'
  const myWounds = mineIsA ? out.aWounds : out.dWounds
  const foeWounds = mineIsA ? out.dWounds : out.aWounds
  const fate =
    foeWounds <= 0 && myWounds > 0
      ? `With best play ${v.foeName} falls and ${v.myName} is left on ${myWounds}.`
      : myWounds <= 0 && foeWounds > 0
        ? `With best play ${v.myName} falls and ${v.foeName} is left on ${foeWounds}.`
        : myWounds <= 0 && foeWounds <= 0
          ? 'With best play both fighters fall.'
          : `With best play ${v.myName} ends on ${myWounds} and ${v.foeName} on ${foeWounds}.`
  return { myWounds, foeWounds, moves: out.moves, text: fate }
}

export interface FightOptionInfo {
  id: string
  op: 'strike' | 'block'
  die: 'normal' | 'crit'
  against: 'normal' | 'crit' | null
  label: string
  effect: string
  /** engine value of this move with best play (higher is better for the mover) */
  value: number | null
  best: boolean
}

export function fightOption(opt: DecisionOption, view: FightView | null, hint: FightHint | null): FightOptionInfo {
  const d = (opt.data ?? {}) as Dict
  const payload = opt.action.payload as Dict
  const op = payload.op === 'block' ? 'block' : 'strike'
  const die = d.die === 'crit' ? 'crit' : 'normal'
  const against = d.against === 'crit' ? 'crit' : d.against === 'normal' ? 'normal' : null
  let label: string
  let effect: string
  if (op === 'strike') {
    const dmg = num(d.damage)
    label = `Strike with a ${die === 'crit' ? 'critical' : 'normal'} success`
    effect = `deals ${dmg ?? '?'} damage${view ? ` to ${view.foeName} (${view.foeWounds} wounds left)` : ''}`
  } else {
    const prevented = view?.foeDmg ? (against === 'crit' ? view.foeDmg.crit : view.foeDmg.normal) : null
    label = `Block their ${against === 'crit' ? 'critical' : 'normal'} success with your ${die === 'crit' ? 'critical' : 'normal'}`
    effect = `prevents ${prevented ?? '?'} damage`
  }
  const move = hint?.moves.find((m) => m.op === op && m.die === die && (op === 'strike' || m.against === against))
  const best = !!hint && hint.moves.length > 0 && move !== undefined && move.value === hint.moves[0]!.value
  return { id: opt.id, op, die, against, label, effect, value: move?.value ?? null, best }
}

// ---------------------------------------------------------------- re-rolls

export interface RerollOptionInfo {
  id: string
  label: string
  /** dice indexes the option re-rolls (for highlighting) */
  dice: number[]
  cost: number
  command: boolean
}

export function rerollOption(opt: DecisionOption, state: GameState | null): RerollOptionInfo {
  const d = (opt.data ?? {}) as Dict
  const p = opt.action.payload as { dice?: number[]; command?: boolean }
  const dice = Array.isArray(p.dice) ? p.dice : []
  const command = p.command === true || opt.action.type === 'dice.commandReroll'
  const value = d.value ?? d.result
  const count = num(d.count) ?? dice.length
  if (command) {
    return { id: opt.id, label: `Command Re-roll the ${String(value ?? '?')} (1 CP)`, dice, cost: 1, command: true }
  }
  const src = str(d.source)
  const srcName = src ? (state?.data.abilities[src]?.name ?? state?.data.weapons[src]?.name ?? humanize(src)) : 'an ability'
  const what = dice.length > 1 || count > 1 ? `${count} dice${value !== undefined ? ` showing ${String(value)}` : ''}` : `the ${String(value ?? 'die')}`
  return { id: opt.id, label: `Re-roll ${what} (${srcName})`, dice, cost: 0, command: false }
}

export function rerollHeadline(pending: PendingDecision, state: GameState | null): string {
  const side = String(pending.context.side ?? 'dice')
  const cp = num(pending.context.cp)
  const target = pending.context.targetId && state ? ` against ${opName(state, String(pending.context.targetId))}` : ''
  return pending.kind === 'dice.commandReroll'
    ? `Your ${side} dice${target}. Spend 1 CP to re-roll one die${cp !== null ? ` (you have ${cp} CP)` : ''}, or keep them.`
    : `Your ${side} dice${target}. An ability lets you re-roll some of them; each die can be re-rolled once.`
}

// ---------------------------------------------------------------- ploys and gambits

export interface PloyCardInfo {
  id: string
  ployId: string
  name: string
  cost: number | null
  text: string
  param: string | null
  /** rules text of the picked option when the param is an ability (a Chapter Tactic) */
  paramText: string | null
  /** the pick this option swaps out (Adaptive Tactics: the current secondary Chapter Tactic) */
  replaces: { name: string; text: string } | null
  affordable: boolean
}

type NamedRecord = { name?: string; text?: string } | undefined

function recordOf(id: string | null | undefined): NamedRecord {
  return id ? (dataBundle().byId[id] as NamedRecord) : undefined
}

export interface TeamPickLine {
  label: string
  name: string
  text: string
  /** set while a ploy has swapped this pick out (Adaptive Tactics) */
  swappedFrom: string | null
}

/** A seat's team-level picks (Chapter Tactics) with their rules; Adaptive Tactics' swap applied. */
export function teamPicks(state: GameState, seat: Seat): TeamPickLine[] {
  const team = dataBundle().teams[state.players[seat].teamId]
  const cfg = state.config[seat]
  return (team?.teamChoices ?? []).flatMap((tc) => {
    const picked = cfg.choices[tc.id]
    if (!picked) return []
    const live = tc.id === 'secondary-tactic' && cfg.adaptive ? cfg.adaptive : picked
    const rec = recordOf(live)
    return [{ label: tc.label, name: rec?.name ?? humanize(live), text: rec?.text ?? '', swappedFrom: live !== picked ? (recordOf(picked)?.name ?? humanize(picked)) : null }]
  })
}

function ployText(state: GameState, id: string): string {
  return state.data.ploys?.[id]?.text ?? (dataBundle().byId[id] as { text?: string } | undefined)?.text ?? ''
}

/** A ploy param that names a marker on the board (Drop and Secure): its kind and where it lies, else null. */
function markerParamLabel(state: GameState, param: string): string | null {
  const m = state.markers.find((k) => k.id === param)
  if (!m) return null
  const kind = m.kind === 'objective' ? 'Objective marker' : `${humanize(m.kind)} marker`
  return `${kind} at ${m.pos.x.toFixed(1)}, ${m.pos.z.toFixed(1)}`
}

/** Card for one offered ploy or gambit option. */
export function ployCard(opt: DecisionOption, state: GameState, seat: Seat): PloyCardInfo {
  const d = (opt.data ?? {}) as Dict
  const p = opt.action.payload as Dict
  const ployId = str(p.ployId) ?? str(p.gambitId) ?? opt.id
  const cost = num(d.cost)
  const name = str(d.name) ?? state.data.gambits.find((g) => g.id === ployId)?.name ?? state.data.ploys?.[ployId]?.name ?? humanize(ployId)
  const param = str(p.param)
  const paramRec = param && !state.operatives[param] ? recordOf(param) : undefined
  // a ploy that swaps one team pick for another names the pick it replaces (Adaptive Tactics)
  const replaceKey = ((state.data.ploys?.[ployId]?.effect as { params?: { replace?: string } } | undefined)?.params?.replace)
  let replaces: PloyCardInfo['replaces'] = null
  if (replaceKey && paramRec) {
    const cfg = state.config[seat]
    const cur = (replaceKey === 'secondary' ? cfg.adaptive : null) ?? cfg.choices[`${replaceKey}-tactic`]
    const r = recordOf(cur)
    if (cur) replaces = { name: r?.name ?? humanize(cur), text: r?.text ?? '' }
  }
  return {
    id: opt.id,
    ployId,
    name,
    cost,
    text: ployText(state, ployId),
    param: param ? (state.operatives[param] ? opName(state, param) : (ployParamLabel(ployId, param) ?? markerParamLabel(state, param) ?? paramRec?.name ?? humanize(param))) : null,
    paramText: paramRec?.text ?? null,
    replaces,
    affordable: cost === null || cost <= state.players[seat].cp,
  }
}

export interface UnavailablePloy {
  id: string
  name: string
  cost: number
  text: string
  reason: string
}

/** Ploys of the seat's team (and the core ones) that are not on offer, each with why. */
export function unavailablePloys(state: GameState, pending: PendingDecision): UnavailablePloy[] {
  const gambit = pending.kind === 'strategy.gambit'
  const seat = pending.seat
  const team = state.players[seat].teamId
  const offered = new Set((pending.options ?? []).map((o) => str((o.action.payload as Dict).ployId) ?? str((o.action.payload as Dict).gambitId) ?? ''))
  const out: UnavailablePloy[] = []
  for (const p of Object.values(state.data.ploys ?? {})) {
    if (p.type !== (gambit ? 'strategy' : 'firefight')) continue
    if (p.team && p.team !== team) continue
    if (offered.has(p.id)) continue
    if (!gambit && !windowsOf(p).includes(pending.window)) continue
    if (!gambit && p.id === 'core.p.command-re-roll') continue
    let reason = 'No legal use right now.'
    if (p.cost > state.players[seat].cp) reason = `Costs ${p.cost} CP; you have ${state.players[seat].cp}.`
    else if (state.ledger[seat].tp.includes(p.id) || state.strategy.gambit?.used?.[seat]?.includes(p.id)) reason = 'Already used this turning point.'
    else if (state.ledger[seat].battle?.includes?.(p.id)) reason = 'Already used this battle.'
    out.push({ id: p.id, name: p.name, cost: p.cost, text: p.text, reason })
  }
  return out
}

// ---------------------------------------------------------------- guard, abilities, markers, setup

export interface GuardOptionInfo {
  id: string
  who: string
  operativeId: string
  action: string
  label: string
  detail: string
}

export function guardOption(opt: DecisionOption, state: GameState | null): GuardOptionInfo {
  const p = opt.action.payload as { operativeId?: string; action?: string }
  const d = (opt.data ?? {}) as Dict
  const action = p.action ?? 'shoot'
  const who = opName(state, p.operativeId)
  return {
    id: opt.id,
    who,
    operativeId: p.operativeId ?? '',
    action,
    label: `${who}: ${action === 'fight' ? 'Fight' : 'Shoot'}`,
    detail: d.pointBlank === true ? 'Point blank: the target is in its control range, so the Hit roll is one worse and it cannot retaliate.' : action === 'fight' ? 'Strike the active enemy in control range.' : 'Fire at the active enemy.',
  }
}

export function guardHeadline(pending: PendingDecision, state: GameState | null): string {
  const actor = opName(state, String(pending.context.actorId ?? ''))
  const threatened = Array.isArray(pending.context.threatened) ? (pending.context.threatened as string[]) : []
  return `${actor} just acted. Interrupt with one operative on Guard, or decline${threatened.length ? ` (declining ends Guard for ${threatened.map((t) => opName(state, t)).join(', ')} next to it)` : ''}.`
}

export interface ChoiceOptionInfo {
  id: string
  label: string
  detail: string
  spot: { x: number; z: number } | null
}

const CHOICE_LABELS: Record<string, string> = {
  'dash-first': 'Dash first, then shoot',
  'shoot-first': 'Shoot first, then dash',
}

/** M10 batch D: option wording keyed by the engine's label key, for options that carry a name or a spot but need a verb (Scout Squad follow-ups). */
const LABEL_KEY_TEXT: Record<string, (d: Dict) => string> = {
  'ss.fs.done': () => 'Finish Forward Scouting',
  'ss.fs.redeployOp': (d) => `Redeploy ${str(d.name) ?? 'a Scout'}`,
  'ss.fs.repositionOp': (d) => `Reposition ${str(d.name) ?? 'a Scout'}`,
  'ss.fs.designate': (d) => `Designate ${str(d.name) ?? 'this enemy'}${num(d.wounds) !== null ? ` (${num(d.wounds)} wounds left)` : ''}`,
  'ss.fs.redeploySpot': (d) => `Set up at ${Number(d.x).toFixed(1)}, ${Number(d.z).toFixed(1)}`,
  'ss.fs.tripSpot': (d) => `Trip Alarm marker at ${Number(d.x).toFixed(1)}, ${Number(d.z).toFixed(1)}`,
  'ss.fs.boobySpot': (d) => `Booby Trap marker at ${Number(d.x).toFixed(1)}, ${Number(d.z).toFixed(1)}`,
  'ss.adaptable.done': () => 'Finish Adaptable Training',
  'ss.adaptable.flip': (d) => `${str(d.name) ?? 'A Scout'}: switch to ${d.order === 'engage' ? 'Conceal' : 'Engage'}`,
  'ss.stealth.done': () => 'No more Dashes',
  'ss.stealth.dash': (d) => `${str(d.name) ?? 'A Scout'} takes a free Dash`,
}

export function abilityChoiceOption(opt: DecisionOption): ChoiceOptionInfo {
  const d = (opt.data ?? {}) as Dict
  const payload = opt.action.payload as { option?: string }
  const x = num(d.x)
  const z = num(d.z)
  const key = payload.option ?? opt.id
  const spot = x !== null && z !== null ? { x, z } : null
  return {
    id: opt.id,
    // a named option (a free Dash for one operative, a Skill at Arms) reads by its name even when it also carries a position
    label: CHOICE_LABELS[key] ?? LABEL_KEY_TEXT[opt.labelKey ?? '']?.(d) ?? str(d.name) ?? (spot ? `Spot ${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}` : humanize(opt.labelKey || key)),
    detail: spot ? 'Click the ringed spot on the board, or pick it here.' : '',
    spot,
  }
}

/** What a team hook's choice decides, in one sentence (M10 batch C hooks); null for hooks the default wording covers. */
function hookHeadline(pending: PendingDecision, state: GameState | null): string | null {
  const c = pending.context
  const op = opName(state, str(c.operativeId))
  switch (str(c.hook)) {
    case 'ksTacticalCommand':
      return c.mode === 'sweep' ? `${op}'s Tactical Command: choose where the Clearance Sweep marker goes.` : `${op}'s Tactical Command: choose the extra Skill at Arms for ${opName(state, str(c.targetId))}.`
    case 'ksPlaceMine':
      return `${op} places the Melta Mine: choose a spot. Any other operative that comes within its control range, friend or foe, sets it off.`
    case 'ksRelocate':
      return 'Relocate: choose who takes a free Dash next, or finish.'
    case 'nvAutoBroadcaster':
      return `${op}'s Auto-broadcaster: choose where the marker goes.`
    case 'nvRighteousAdvance':
      return 'Righteous Advance: choose which Novitiate takes a free Dash next, or stop.'
    case 'cvPlunderers':
      return 'Plunderers: choose which Voidscarred takes a free Dash next, or finish.'
    case 'fkReadyStep':
      return 'Farstalker: change an operative\'s order before the Strategy phase goes on, or finish.'
    case 'fkMarkedForTheHunt':
      return `${op} drops the Pech'ra marker: choose a spot.`
    case 'fkGather':
      return `${op} has finished the first move of GATHER: place the carried marker here, or keep carrying it.`
    case 'exDeployNuncio':
      return `${op} deploys the Nuncio-aquila: choose a spot within 6 inches of the Proctor, or of where the marker stands now.`
    case 'exMarkedForJustice':
      return 'Marked for Justice: the mark has fallen. Choose the enemy who is the new mark, or pass to leave it.'
    case 'preBattle': {
      const hooks = new Set((Array.isArray(c.offers) ? (c.offers as { hook?: string }[]) : []).map((o) => o.hook))
      if (hooks.has('ssForwardScouting')) return 'Before the battle: use a Forward Scouting option with your Scouts, or pass when you are finished.'
      if (hooks.has('blRegularDosage')) return 'Before the battle: the Corpseman may give a friend a stimm (Regular Dosage), or pass to start the battle.'
      return 'Before the battle starts: use a team rule, or pass.'
    }
    case 'ssForwardScouting': {
      const left = num(c.left)
      switch (str(c.step)) {
        case 'redeploy.op':
          return `Forward Scouting, Redeploy: choose a Scout to set up again${left !== null ? ` (${left} left)` : ''}, or finish.`
        case 'redeploy.spot':
          return `Forward Scouting, Redeploy: choose where ${opName(state, str(c.moverId))} goes, within your drop zone, or leave it where it is.`
        case 'reposition.op':
          return 'Forward Scouting, Reposition: choose the Scout that takes the free move. It must end wholly within 3 inches of your drop zone.'
        case 'marker':
          return c.kind === 'tripAlarm' ? 'Forward Scouting, Trip Alarm: choose where the marker goes. An enemy that comes close to it sets it off.' : 'Forward Scouting, Booby Trap: choose where the marker goes. An enemy that comes close to it sets it off.'
        case 'designate':
          return 'Forward Scouting, Designate Target: choose the enemy operative the Scouts mark.'
        default:
          return `${op}'s Forward Scouting: choose how it resolves.`
      }
    }
    case 'ssAdaptableTraining': {
      const left = num(c.left)
      return `Adaptable Training: choose a Scout to switch between Engage and Conceal${left !== null ? ` (${left} switch${left === 1 ? '' : 'es'} left)` : ''}, or finish.`
    }
    case 'ssStealthRelocation': {
      const left = num(c.left)
      return `Stealth Relocation: choose which concealed Scout takes a free Dash${left !== null ? ` (${left} left)` : ''}, or finish.`
    }
    default:
      return null
  }
}

export function abilityChoiceHeadline(pending: PendingDecision, state: GameState | null): string {
  const named = hookHeadline(pending, state)
  if (named) return named
  const op = opName(state, str(pending.context.operativeId))
  const ability = str(pending.context.abilityId)
  const name = ability ? (state?.data.abilities[ability]?.name ?? humanize(ability)) : 'an ability'
  return `${op} uses ${name}: choose how it resolves.`
}

export function markerPlaceHeadline(pending: PendingDecision, state: GameState | null): string {
  const op = opName(state, str(pending.context.operativeId))
  const marker = humanize(String(pending.context.markerId ?? 'marker'))
  const reach = num(pending.context.maxDistance) ?? 1
  return `${op} sets down ${marker}: click a spot within ${reach}″ of its base.`
}

export function objectiveHeadline(pending: PendingDecision): string {
  const step = num(pending.context.step) ?? 0
  const of = num(pending.context.of) ?? 0
  return `Place objective marker ${step + 1} of ${of}: click one of the ringed spots the mission allows, or let the engine pick.`
}

export function equipHeadline(pending: PendingDecision): string {
  const name = str(pending.context.name) ?? humanize(String(pending.context.equipmentId ?? 'equipment'))
  const what = str(pending.context.placing)
  return `Place ${name}${what ? ` (${what})` : ''}: click inside your highlighted territory, or take the engine's suggestion.`
}

// ---------------------------------------------------------------- mission and ability actions

const CONDITION_TEXT: Record<string, (v: unknown) => string | null> = {
  notInEnemyControlRange: (v) => (v ? 'Not inside an enemy control range.' : null),
  notCounteracting: (v) => (v ? 'Not as a counteraction.' : null),
  turningPoint: (v) => {
    const t = v as { min?: number; max?: number }
    if (t.min !== undefined && t.max !== undefined) return `Only in turning points ${t.min} to ${t.max}.`
    if (t.min !== undefined) return t.min <= 1 ? null : `Not before turning point ${t.min}.`
    if (t.max !== undefined) return `Only up to turning point ${t.max}.`
    return null
  },
  activationExcludes: (v) => (Array.isArray(v) ? `Not in an activation that includes ${(v as string[]).map(humanize).join(' or ')}.` : null),
  order: (v) => (typeof v === 'string' ? `Only on ${humanize(v)}.` : null),
}

/** Plain sentences for an ability's `conditions` record. */
export function explainConditions(cond: Record<string, unknown> | undefined): string[] {
  if (!cond) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(cond)) {
    const t = CONDITION_TEXT[k]?.(v)
    out.push(t ?? `${humanize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  }
  return out.filter(Boolean)
}

export interface AbilityActionInfo {
  /** the firefight.action payload `action` string */
  action: string
  abilityId: string
  name: string
  text: string
  cost: number | null
  conditions: string[]
  mission: boolean
  /** options on offer for this action (one per marker or target) */
  offers: DecisionOption[]
  /** why it is not available, when it is not */
  reason: string | null
}

/** The mission and unique actions of an operative, offered or not, with their conditions explained. */
export function abilityActions(state: GameState, pending: PendingDecision): AbilityActionInfo[] {
  const opId = str(pending.context.operativeId)
  const op = opId ? state.operatives[opId] : undefined
  if (!op) return []
  const act = state.firefight.activation
  const ids = new Set<string>()
  for (const id of state.data.datacards[op.datacardId]?.uniqueActions ?? []) ids.add(id)
  const missionActions = state.mission ? (state.data.missions?.[state.mission.id]?.actions ?? []) : []
  for (const id of missionActions) ids.add(id)
  const options = pending.options ?? []
  const out: AbilityActionInfo[] = []
  for (const id of ids) {
    const def = state.data.abilities[id]
    if (!def || def.kind !== 'uniqueAction') continue
    const action = `ability:${id}`
    const offers = options.filter((o) => (o.action.payload as Dict).action === action)
    let reason: string | null = null
    if (offers.length === 0) {
      try {
        const r = findOffer(state, op, act, { action })
        reason = 'reason' in r ? r.reason : 'Not available right now.'
      } catch {
        reason = 'Not available right now.'
      }
      const need = num(def.ap)
      if (need !== null && act && act.apSpent + need > (pending.context.apl as number) && !act.counteract) reason = `Needs ${need} AP; not enough left.`
    }
    out.push({
      action,
      abilityId: id,
      name: def.name,
      text: def.text ?? '',
      cost: num((offers[0]?.data as Dict | undefined)?.cost) ?? num(def.ap),
      conditions: explainConditions(def.conditions),
      mission: missionActions.includes(id),
      offers,
      reason,
    })
  }
  return out
}

/** Pick Up / Place marker offers of the pending action decision, with the marker named. */
export function markerActionLabel(opt: DecisionOption): string {
  const p = opt.action.payload as { action?: string; markerId?: string }
  const what = p.action === 'marker:pickUp' ? 'Pick up' : p.action === 'marker:place' ? 'Place' : humanize(p.action ?? '')
  return `${what} ${humanize(String(p.markerId ?? 'marker'))}`
}

// ---------------------------------------------------------------- one entry point

export interface PromptSummary {
  title: string
  /** the dynamic sentence under the title */
  hint: string
  /** extra lines (options with their numbers) in reading order */
  lines: string[]
  /** one line on why the decision matters (cover save, block, re-roll and others) */
  why?: string
}

const ATTACK_KINDS = new Set([
  'shoot.weapon',
  'shoot.target',
  'shoot.coverSave',
  'shoot.block',
  'fight.target',
  'fight.weapon',
  'fight.resolve',
  'dice.reroll',
  'dice.commandReroll',
  'ploy.firefight',
  'strategy.gambit',
  'guard.interrupt',
  'ability.choice',
  'marker.place',
  'setup.objective',
  'setup.equipMarker',
])

/** Label of the pass button, by what passing means for the decision. */
export function passLabel(kind: string): string {
  switch (kind) {
    case 'shoot.weapon':
    case 'shoot.target':
      return 'Cancel the shot'
    case 'fight.target':
      return 'Cancel the fight'
    case 'dice.reroll':
    case 'dice.commandReroll':
      return 'Keep the dice'
    case 'guard.interrupt':
      return 'Decline'
    case 'ability.choice':
    case 'marker.place':
      return 'Cancel the action'
    default:
      return 'Pass'
  }
}

export function hasDedicatedPrompt(kind: string): boolean {
  return ATTACK_KINDS.has(kind)
}

/** One sentence plus the option lines for a decision, built from the same functions the prompt components use. */
export function promptSummary(state: GameState, pending: PendingDecision): PromptSummary {
  const s = promptSummaryBase(state, pending)
  const why = decisionInfo(pending.kind).why
  return why ? { ...s, why } : s
}

function promptSummaryBase(state: GameState, pending: PendingDecision): PromptSummary {
  const opts = pending.options ?? []
  const ctx = pending.context
  switch (pending.kind) {
    case 'shoot.weapon': {
      const lines = opts.map((o) => {
        const c = weaponCard(o)
        return `${c.name}: ${c.stats}${c.rules.length ? ` (${c.rules.map((r) => r.name).join(', ')})` : ''}${c.targets !== null ? `, ${c.targets} target${c.targets === 1 ? '' : 's'}` : ''}`
      })
      return { title: 'Choose a weapon', hint: `${opName(state, str(ctx.operativeId))} can shoot with one of these profiles.`, lines }
    }
    case 'shoot.target': {
      if (ctx.secondary === true) {
        return { title: 'Add targets', hint: 'The weapon can also hit these. Add any you want, then finish.', lines: opts.map((o) => humanize(o.id)) }
      }
      const lines = [
        ...opts.map((o) => {
          const c = targetCard(o, state)
          return `${c.name}: ${c.badge.label}${c.line ? `, ${c.line}` : ''}`
        }),
        ...unlistedTargets(state, pending).map((u) => `${u.name}: ${u.badge.label} (${u.reason})`),
      ]
      return { title: 'Choose a target', hint: `Shooting with ${weaponName(state, str(ctx.weaponId))}.`, lines }
    }
    case 'shoot.coverSave': {
      const c = coverSaveInfo(ctx, state)
      return { title: 'Cover save', hint: c.headline, lines: [c.explain, ...opts.map((o) => humanize(o.id))] }
    }
    case 'shoot.block':
      return { title: 'Block attacks', hint: blockHeadline(ctx, state), lines: opts.map((o) => `${blockOption(o).label}: ${blockOption(o).detail}`) }
    case 'fight.target':
      return { title: 'Choose a fight target', hint: `${opName(state, str(ctx.operativeId))} is in control range of these enemies.`, lines: opts.map((o) => `${fightTargetCard(o, state).name}: ${fightTargetCard(o, state).line}`) }
    case 'fight.weapon':
      return {
        title: 'Choose a melee weapon',
        hint: ctx.retaliating === true ? `${opName(state, str(ctx.operativeId))} retaliates.` : `${opName(state, str(ctx.operativeId))} attacks.`,
        lines: opts.map((o) => `${weaponCard(o).name}: ${weaponCard(o).stats}`),
      }
    case 'fight.resolve': {
      const v = fightView(state, pending)
      const h = fightHint(state, pending)
      return { title: 'Strike or block', hint: h?.text ?? 'Spend one success: strike or block.', lines: opts.map((o) => { const f = fightOption(o, v, h); return `${f.label}: ${f.effect}` }) }
    }
    case 'dice.reroll':
    case 'dice.commandReroll':
      return { title: pending.kind === 'dice.reroll' ? 'Re-roll offered' : 'Command re-roll', hint: rerollHeadline(pending, state), lines: opts.map((o) => rerollOption(o, state).label) }
    case 'ploy.firefight':
    case 'strategy.gambit': {
      const lines = [
        ...opts.map((o) => {
          const c = ployCard(o, state, pending.seat)
          const swap = c.replaces ? ` (swap ${c.replaces.name} for ${c.param})` : c.param ? ` on ${c.param}` : ''
          return `${c.name}${c.cost !== null ? ` (${c.cost} CP)` : ''}${swap}: ${c.text}${c.paramText ? ` ${c.param}: ${c.paramText}` : ''}`
        }),
        ...unavailablePloys(state, pending).map((u) => `${u.name} (${u.cost} CP): unavailable, ${u.reason}`),
      ]
      return { title: pending.kind === 'strategy.gambit' ? 'Strategic gambit' : 'Firefight ploy', hint: `You have ${state.players[pending.seat].cp} CP. Play one, or pass.`, lines }
    }
    case 'guard.interrupt':
      return { title: 'Guard interrupt', hint: guardHeadline(pending, state), lines: opts.map((o) => `${guardOption(o, state).label}: ${guardOption(o, state).detail}`) }
    case 'ability.choice':
      return { title: 'Make a choice', hint: abilityChoiceHeadline(pending, state), lines: opts.map((o) => abilityChoiceOption(o).label) }
    case 'marker.place':
      return { title: 'Place marker', hint: markerPlaceHeadline(pending, state), lines: [] }
    case 'setup.objective':
      return { title: 'Place an objective', hint: objectiveHeadline(pending), lines: opts.map((o) => o.id) }
    case 'setup.equipMarker':
      return { title: 'Place equipment', hint: equipHeadline(pending), lines: [] }
    default:
      return { title: humanize(pending.kind), hint: 'Choose one of the options below.', lines: opts.map((o) => humanize(o.labelKey || o.id)) }
  }
}

export { SEAT_NAME, rulesLine }
