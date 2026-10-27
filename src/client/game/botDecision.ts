// View model of the "what the AI is deciding" card: the decision in words, the answer the bot chose, the engine facts and odds that
// the human prompts show for the same choice, and what else it could have done. Pure: it reads the state the decision was taken in
// and uses only the label and odds helpers, so the wording and the numbers match the prompts exactly.
import type { Action, DecisionOption, GameState, PendingDecision } from '@/engine'
import { decisionTitle, fighterName, humanize, optionFacts, optionLabel } from './labels'
import { bottleOdds, fightOdds, pct, plus, shotOdds, shotSummary } from './odds'

export interface OddsLine {
  label: string
  value: string
}

export interface BotDecisionView {
  title: string
  /** the answer in words */
  chosen: string
  /** engine facts of the chosen option ("up to 6\"", "55% to hit") */
  facts: string[]
  /** odds the engine computes for the choice (hit, wound, save, down, out ...), one group per target */
  odds: { who: string | null; lines: OddsLine[]; summary: string | null }[]
  /** how many answers were open, and the labels of a few the bot did not take */
  optionCount: number
  alternatives: string[]
}

const key = (a: Action): string => `${a.type}:${JSON.stringify(a.payload)}`

/** The option the bot's action answers, if the decision lists options. */
export function optionOfAction(pending: PendingDecision, action: Action): DecisionOption | null {
  return pending.options?.find((o) => key(o.action) === key(action)) ?? null
}

const inch = (n: number): string => `${Math.round(n * 10) / 10}"`

/** An answer that is not one of a decision's listed options (a path, a deployment spot, an aim point, a pass). */
function describeFree(action: Action, pending: PendingDecision, state: GameState): string {
  switch (action.type) {
    case 'move.path': {
      const origin = pending.constraints?.origin
      let len = 0
      let prev = origin ? { x: origin.x, z: origin.z } : null
      for (const w of action.payload.waypoints) {
        if (prev) len += Math.hypot(w.x - prev.x, w.z - prev.z)
        prev = w
      }
      const last = action.payload.waypoints[action.payload.waypoints.length - 1]
      return `${fighterName(state, String(pending.constraints?.fighterId ?? pending.context.fighterId ?? ''))} moves ${origin ? inch(len) : 'along a route'}${last ? ` to ${inch(last.x)}, ${inch(last.z)} on the board` : ''}`
    }
    case 'setup.deploy':
      return `${fighterName(state, action.payload.fighterId)} sets up at ${inch(action.payload.x)}, ${inch(action.payload.z)}`
    case 'setup.casket':
      return `Places the casket at ${inch(action.payload.x)}, ${inch(action.payload.z)}`
    case 'shoot.aim':
      return `Aims at ${inch(action.payload.x)}, ${inch(action.payload.z)}`
    case 'pass':
      return 'Passes'
    case 'resign':
      return 'Resigns'
    default:
      return humanize(action.type)
  }
}

function oddsFor(state: GameState, pending: PendingDecision, action: Action, opt: DecisionOption | null): BotDecisionView['odds'] {
  const ctx = pending.context as Record<string, unknown>
  const out: BotDecisionView['odds'] = []
  if (action.type === 'shoot.target' && opt) {
    const o = shotOdds(state, pending, opt)
    if (o) {
      const lines: OddsLine[] = [
        { label: 'Hit', value: `${pct(o.pHit)}${o.hitNeed !== null ? ` (${o.hitNeed > 6 ? 'a 6, then a 6' : plus(o.hitNeed)})` : ''}` },
        { label: 'Wound', value: `${pct(o.pWound)}${o.woundNeed ? ` (${plus(o.woundNeed)})` : ''}` },
        { label: 'Save', value: `${pct(o.pSave)}${o.saveNeed === null ? ' (none)' : o.saveNeed > 6 ? ' (no roll)' : ` (${plus(o.saveNeed)})`}` },
      ]
      if (o.pPinned > 0) lines.push({ label: 'Pinned', value: pct(o.pPinned) })
      lines.push({ label: 'Down', value: pct(o.pSeriouslyInjured) }, { label: 'Out', value: pct(o.pOutOfAction) })
      out.push({ who: null, lines, summary: shotSummary(o) })
    }
  } else if (action.type === 'fight.weapons' || action.type === 'fight.split') {
    const attacker = String(ctx.fighterId ?? ctx.attackerId ?? '')
    const weaponIds = action.type === 'fight.weapons' ? action.payload.weaponIds : Array.isArray(ctx.weaponIds) ? (ctx.weaponIds as string[]) : undefined
    const targets = action.type === 'fight.split' ? Object.keys(action.payload.split) : Array.isArray(ctx.targets) ? (ctx.targets as string[]) : undefined
    const o = attacker ? fightOdds(state, attacker, weaponIds, targets && targets.length > 0 ? targets : undefined, ctx.charge === true) : null
    for (const t of o?.targets ?? []) {
      out.push({
        who: fighterName(state, t.targetId),
        summary: null,
        lines: [
          { label: 'Dice', value: `${t.dice}, hit on ${plus(t.need)}` },
          { label: 'Hits', value: `${Math.round(t.expectedHits * 10) / 10} expected` },
          { label: 'Wounds', value: `${Math.round(t.expectedWounds * 10) / 10} expected` },
          { label: 'Down', value: pct(t.pSeriouslyInjured) },
          { label: 'Out', value: pct(t.pOutOfAction) },
        ],
      })
    }
  } else if (action.type === 'end.bottle') {
    const o = bottleOdds(state, pending.seat)
    if (o && o.down > 0) out.push({ who: null, summary: null, lines: [{ label: 'Down', value: `${o.down} of ${o.crew} starting fighters` }, ...(o.pBottle !== null ? [{ label: 'Bottles now', value: pct(o.pBottle) }] : [])] })
  }
  return out
}

/** Short comparison hint for an option the bot passed over: its hit chance for a target, else its first engine fact. */
function altHint(state: GameState, pending: PendingDecision, opt: DecisionOption): string {
  if (opt.action.type === 'shoot.target') {
    const o = shotOdds(state, pending, opt)
    if (o) return `${pct(o.pHit)} to hit`
  }
  return optionFacts(opt)[0] ?? ''
}

export function describeBotDecision(state: GameState, pending: PendingDecision, action: Action): BotDecisionView {
  const opt = optionOfAction(pending, action)
  const others = (pending.options ?? []).filter((o) => o !== opt && o.action.type !== 'pass')
  return {
    title: decisionTitle(pending, state),
    chosen: opt ? optionLabel(opt, state) : describeFree(action, pending, state),
    facts: opt ? optionFacts(opt) : [],
    odds: oddsFor(state, pending, action, opt),
    optionCount: pending.options?.length ?? 0,
    alternatives: others.slice(0, 4).map((o) => {
      const hint = altHint(state, pending, o)
      return hint ? `${optionLabel(o, state)} (${hint})` : optionLabel(o, state)
    }),
  }
}
