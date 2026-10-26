// Pure parts of the held shooting volley (see director.ts): a shot plays its dice first, then the shooter
// fires, one tracer per attack die, and each tracer's landing plays what that die did (a save shimmer, a
// wound, a fall). These helpers decide which landing plays what, and when the director must fire the volley.
import { classifyDie } from '@/engine/dice'

export type DieKind = 'fail' | 'normal' | 'crit'

export interface BlockCounts {
  blockedNormal: number
  blockedCrit: number
  unblockedNormal: number
  unblockedCrit: number
}

/** The attack dice after a re-roll (the engine reports the new physical values, not their kinds). */
export function rerollKinds(kinds: readonly DieKind[], indexes: readonly number[], after: readonly number[], need: number, lethal: number | null): DieKind[] {
  const out = kinds.slice()
  indexes.forEach((idx, k) => {
    const v = after[k]
    if (idx >= 0 && idx < out.length && v !== undefined) out[idx] = classifyDie(v, need, lethal ?? undefined)
  })
  return out
}

/** The attack dice as retained (obscured discards a success, some rules convert crits): successes beyond the
 *  retained counts fly as misses, and a die the rules promoted becomes a crit. Order of the dice is kept. */
export function finalKinds(kinds: readonly DieKind[], retained: { normal: number; crit: number } | null): DieKind[] {
  if (!retained) return kinds.slice()
  const out: DieKind[] = kinds.map(() => 'fail')
  let critLeft = retained.crit
  let normalLeft = retained.normal
  const rest: number[] = []
  kinds.forEach((k, i) => {
    if (k === 'crit' && critLeft > 0) {
      out[i] = 'crit'
      critLeft--
    } else if (k === 'normal' && normalLeft > 0) {
      out[i] = 'normal'
      normalLeft--
    } else if (k !== 'fail') rest.push(i)
  })
  for (const i of rest) {
    if (critLeft > 0) {
      out[i] = 'crit'
      critLeft--
    } else if (normalLeft > 0) {
      out[i] = 'normal'
      normalLeft--
    }
  }
  return out
}

/** True for slot `i` of `total` when `count` marks are spread evenly over the slots. */
export function spread(i: number, count: number, total: number): boolean {
  if (total <= 0) return false
  return Math.floor(((i + 1) * count) / total) > Math.floor((i * count) / total)
}

/** What a held event is, for pairing: damage dealt to the target, or its injury / incapacitation. */
export interface HeldItem {
  kind: 'damage' | 'injured' | 'down'
  operativeId: string
}

export interface ShotPlan {
  /** index of the attack die / tracer */
  die: number
  kind: DieKind
  /** a miss does nothing, a blocked success plays the save shimmer, an unblocked one plays its damage */
  outcome: 'miss' | 'blocked' | 'damage'
  /** indexes into the held items that play when this shot lands */
  items: number[]
}

export interface LandingPlan {
  shots: ShotPlan[]
  /** held items no shot could carry: they play right after the last landing */
  orphanItems: number[]
  /** blocked successes with no tracer of their own (the dice and the block disagree): shimmer after the last landing */
  orphanBlocked: number
}

/**
 * Assigns the sequence's outcome to its tracers. Each success is blocked or not (the block counts say how many of
 * each kind, spread evenly through the dice); unblocked successes, in tracer order, take the target's damage events in
 * engine order, so wounds only ever count down. An injury or incapacitation lands with the shot of the damage that
 * caused it. With no block counts every success is taken as unblocked.
 */
export function planLandings(kinds: readonly DieKind[], block: BlockCounts | null, items: readonly HeldItem[]): LandingPlan {
  const crits = kinds.flatMap((k, i) => (k === 'crit' ? [i] : []))
  const normals = kinds.flatMap((k, i) => (k === 'normal' ? [i] : []))
  const open = new Set<number>()
  crits.forEach((die, j) => {
    if (!block || spread(j, Math.min(block.unblockedCrit, crits.length), crits.length)) open.add(die)
  })
  normals.forEach((die, j) => {
    if (!block || spread(j, Math.min(block.unblockedNormal, normals.length), normals.length)) open.add(die)
  })
  const shots: ShotPlan[] = kinds.map((kind, die) => ({ die, kind, outcome: kind === 'fail' ? 'miss' : open.has(die) ? 'damage' : 'blocked', items: [] }))
  const damageShots = shots.filter((s) => s.outcome === 'damage')
  const orphanItems: number[] = []
  const shotOfDamage = new Map<string, ShotPlan>() // the shot that last damaged each operative
  let next = 0
  items.forEach((it, idx) => {
    if (it.kind === 'damage') {
      const s = damageShots[next++]
      if (!s) {
        orphanItems.push(idx)
        shotOfDamage.delete(it.operativeId)
        return
      }
      s.items.push(idx)
      shotOfDamage.set(it.operativeId, s)
      return
    }
    const s = shotOfDamage.get(it.operativeId)
    if (s) s.items.push(idx)
    else orphanItems.push(idx)
  })
  const blockedShots = shots.filter((s) => s.outcome === 'blocked').length
  const blockedTotal = block ? block.blockedNormal + block.blockedCrit : 0
  return { shots, orphanItems, orphanBlocked: Math.max(0, blockedTotal - blockedShots) }
}

export type HoldVerdict = 'hold' | 'fire-first' | 'play'

export interface HoldState {
  targetId: string
  /** the target's defence dice (or the block) have been reached: its damage waits for the volley */
  windowOpen: boolean
  /** the block has been reported: the sequence's outcome is known */
  outcomeKnown: boolean
}

/** Events that belong to the dice phase of a shot: they play in place, whenever they arrive. */
const DICE_EVENTS = new Set(['AttackDiceRolled', 'DefenceDiceRolled', 'DiceRerolled', 'CoverSaveRetained', 'AttackRetained', 'DiceBlocked', 'ShockDiscard'])
const TRAY_PURPOSE = /^(shoot|fight)\.(attack|defence)(\.|$)/
/** Events that close a shot or the action around it: a still-held volley fires before they play. */
const BOUNDARY = new Set(['TargetSelected', 'ShootEnded', 'ShootStarted', 'OperativeActivated', 'ActionDeclared', 'TurningPointStarted', 'PhaseStarted', 'FightStarted', 'GameEnded'])
const HELD_TYPES = new Set(['DamageInflicted', 'OperativeInjured', 'OperativeIncapacitated'])

/**
 * What the director does with the next event while a volley is held: hold it (the target's damage and fall, once the
 * defence is reached), fire the volley first and then play it (the next target, the end of the shot, or anything else
 * once the outcome is known: Hot damage on the shooter, a mine, a ploy), or just play it (dice-phase events).
 */
export function holdVerdict(h: HoldState, ev: { type: string; operativeId?: string; purpose?: string }): HoldVerdict {
  if (BOUNDARY.has(ev.type)) return 'fire-first'
  if (h.windowOpen && HELD_TYPES.has(ev.type) && ev.operativeId === h.targetId) return 'hold'
  if (DICE_EVENTS.has(ev.type)) return 'play'
  if (ev.type === 'DiceRolled' && TRAY_PURPOSE.test(ev.purpose ?? '')) return 'play'
  return h.outcomeKnown ? 'fire-first' : 'play'
}

/** Turns held events into pairing items (anything that is not a damage / injury / fall on the target is not held). */
export function heldItemOf(ev: { type: string; operativeId?: string }): HeldItem | null {
  if (!ev.operativeId) return null
  if (ev.type === 'DamageInflicted') return { kind: 'damage', operativeId: ev.operativeId }
  if (ev.type === 'OperativeInjured') return { kind: 'injured', operativeId: ev.operativeId }
  if (ev.type === 'OperativeIncapacitated') return { kind: 'down', operativeId: ev.operativeId }
  return null
}
