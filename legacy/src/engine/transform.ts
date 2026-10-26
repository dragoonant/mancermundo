// Operatives changing datacard mid-battle (batch D prep, generic capability "transformOperative"): Chaos Cult
// Mutation turns a Devotee into a Mutant and a Mutant into a Torment. The operative keeps its identity (id, seat,
// order, ready or expended, the activation it is in, APL effects, tokens, picks, flags, limited uses, carried
// marker, ledgers keyed by its id); its datacard, name (when it carried the card's name), printed stats, weapons,
// base and height become the new card's. Wounds already lost carry over (never below 1, so a change never
// incapacitates). Datacards marked `selectable: false` are never picked for a roster but are part of every game
// that has their team (bundle.snapshotData), so they are here to change into.
import { round3 } from './geometry'
import { placementProblem } from './terrain'
import { axisOf } from './footprint'
import { placementSpots } from './reserve'
import { getOp, isInjured } from './state'
import type { Ctx } from './registry'
import type { GameState, Operative, RuntimeDatacard } from './types'

export interface TransformOpts {
  /** wounds already lost carry over (default true); false: the operative starts the new card unhurt */
  keepWoundsLost?: boolean
  /** chosen weapons of the new card (one of its legal loadouts); default its first legal loadout */
  loadout?: string[]
}

function cardWeapons(card: RuntimeDatacard | undefined): Set<string> {
  if (!card) return new Set()
  return new Set([...card.fixedWeapons, ...(card.weaponOptions ?? []).flatMap((o) => o.from), ...(card.legalLoadouts?.flat() ?? [])])
}

/** Why `opId` cannot change into `toCardId` now, or null. */
export function transformProblem(state: GameState, opId: string, toCardId: string): string | null {
  const op = state.operatives[opId]
  if (!op || op.status !== 'active') return 'only an operative in the killzone can change datacard'
  const card = state.data.datacards[toCardId]
  if (!card) return `${toCardId} is not in this game's data`
  if (op.datacardId === toCardId) return 'it already has that datacard'
  return null
}

/**
 * Change `opId` into datacard `toCardId`. Returns false (nothing changes) when transformProblem says no. A bigger
 * base that no longer fits where it stands is moved to the nearest legal spot within 6" (any level); with none it
 * stays put.
 */
export function transformOperative(ctx: Ctx, opId: string, toCardId: string, opts: TransformOpts = {}): boolean {
  const s = ctx.state
  if (transformProblem(s, opId, toCardId)) return false
  const op = getOp(s, opId)
  const from = op.datacardId
  const oldCard = s.data.datacards[from]
  const card = s.data.datacards[toCardId]!
  // weapons that did not come from the old card (equipment grants) stay
  const oldOwn = cardWeapons(oldCard)
  const kept = op.weapons.filter((w) => !oldOwn.has(w))
  const chosen = opts.loadout ?? card.legalLoadouts?.[0] ?? (card.weaponOptions ?? []).flatMap((o) => o.from.slice(0, o.min ?? o.pick))
  const weapons = [...card.fixedWeapons, ...chosen]
  for (const w of kept) if (!weapons.includes(w)) weapons.push(w)
  const lost = Math.max(0, op.maxWounds - op.wounds)
  op.datacardId = card.id
  if (!oldCard || op.name === oldCard.name) op.name = card.name
  op.loadout = { weaponIds: [...chosen] }
  op.weapons = weapons
  op.apl = card.apl
  op.move = card.move
  op.save = card.save
  op.maxWounds = card.wounds
  op.wounds = opts.keepWoundsLost === false ? card.wounds : Math.max(1, card.wounds - lost)
  const oval = card.ovalBase && (!card.ovalBase.weapons || card.ovalBase.weapons.some((w) => weapons.includes(w))) ? card.ovalBase : undefined
  op.baseRadius = oval ? round3(oval.short / 25.4 / 2) : round3(card.baseMm / 25.4 / 2)
  if (oval && oval.long > oval.short) op.ovalHalfAxis = round3((oval.long - oval.short) / 25.4 / 2)
  else delete op.ovalHalfAxis
  op.height = card.heightInches ?? round3((card.baseMm / 25.4) * 1.15 + 0.1)
  op.flags.injured = isInjured(op)
  refit(s, op)
  ctx.emit({ type: 'OperativeTransformed', operativeId: op.id, from, to: card.id }, op.seat)
  return true
}

/** A changed base that overlaps terrain or another operative moves to the nearest legal spot within 6". */
function refit(s: GameState, op: Operative): void {
  if (!placementProblem(s, { id: op.id, pos: op.pos, radius: op.baseRadius, height: op.height, ...axisOf(op) })) return
  const at = op.pos
  const spots = placementSpots(s, op, { around: at, radius: 6, step: 0.5, max: 400, levels: true })
  if (spots.length === 0) return
  spots.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) + Math.abs(a.y - at.y) - (Math.hypot(b.x - at.x, b.z - at.z) + Math.abs(b.y - at.y)) || a.x - b.x || a.z - b.z)
  op.pos = spots[0]!
}
