// Dice tray state. Only the presentation director writes it (so a roll shows when its beat plays, never
// early). Two pools side by side: attack and defence (in a fight: the attacker's and the retaliator's), with
// per-die state for re-rolls, blocks (shown as pairs) and strikes landing.
import { create } from 'zustand'
import type { Seat } from '@/engine'
import { classifyDie } from '@/engine/dice'

export type DieKind = 'fail' | 'normal' | 'crit'
export type Spent = 'blocked' | 'blocking' | 'struck' | null

export interface TrayDie {
  value: number | null
  kind: DieKind
  rerolled: boolean
  spent: Spent
  /** dice that cancelled each other share a pair number (animated together) */
  pair: number | null
}

export interface TrayPool {
  operativeId: string
  seat: Seat | null
  label: string
  need: number
  lethal: number | null
  side: 'attack' | 'defence'
  /** what a success is called: attack pools and fight pools hit, defence pools save */
  word: 'hit' | 'save'
  dice: TrayDie[]
}

export interface TrayState {
  mode: 'shoot' | 'fight' | null
  title: string
  atk: TrayPool | null
  def: TrayPool | null
  note: string
  /** bumps on every change so the tray can restart small animations */
  rev: number
}

const EMPTY: TrayState = { mode: null, title: '', atk: null, def: null, note: '', rev: 0 }

export const useTray = create<TrayState>(() => ({ ...EMPTY }))

let pairCounter = 1

const bump = (s: TrayState): number => s.rev + 1

function toDice(values: (number | null)[], kinds: string[]): TrayDie[] {
  return values.map((value, i) => ({ value, kind: (kinds[i] as DieKind | undefined) ?? 'normal', rerolled: false, spent: null, pair: null }))
}

export function trayBegin(mode: 'shoot' | 'fight', title: string): void {
  useTray.setState((s) => ({ ...EMPTY, mode, title, rev: bump(s) }))
}

export function trayClear(): void {
  useTray.setState((s) => ({ ...EMPTY, rev: bump(s) }))
}

export interface PoolInput {
  operativeId: string
  seat: Seat | null
  label: string
  need: number
  lethal: number | null
  dice: (number | null)[]
  kinds: string[]
}

export function trayAttack(p: PoolInput, mode: 'shoot' | 'fight', title: string): void {
  useTray.setState((s) => {
    const pool: TrayPool = { ...p, side: 'attack', word: 'hit', dice: toDice(p.dice, p.kinds) }
    // a fight rolls two pools in a row: the first starts the tray, the second goes on the defence side
    if (mode === 'fight' && s.mode === 'fight' && s.atk && !s.def && s.atk.operativeId !== p.operativeId) {
      return { ...s, def: { ...pool, side: 'defence' }, rev: bump(s) }
    }
    // the sequence's own title (set at target selection / fight start) stays; a fresh pool starts empty on the other side
    if (s.mode === mode && s.title) return { ...s, atk: pool, def: null, note: '', rev: bump(s) }
    return { ...EMPTY, mode, title, atk: pool, rev: bump(s) }
  })
}

export function trayDefence(p: PoolInput): void {
  useTray.setState((s) => ({ ...s, def: { ...p, side: 'defence', word: 'save', dice: toDice(p.dice, p.kinds) }, rev: bump(s) }))
}

function poolFor(s: TrayState, side: 'attack' | 'defence'): TrayPool | null {
  return side === 'attack' ? s.atk : s.def
}

function withPool(s: TrayState, side: 'attack' | 'defence', pool: TrayPool): TrayState {
  return side === 'attack' ? { ...s, atk: pool, rev: bump(s) } : { ...s, def: pool, rev: bump(s) }
}

export function trayReroll(side: 'attack' | 'defence', indexes: number[], after: number[]): void {
  useTray.setState((s) => {
    const pool = poolFor(s, side)
    if (!pool) return s
    const dice = pool.dice.map((d) => ({ ...d }))
    indexes.forEach((idx, k) => {
      const d = dice[idx]
      const v = after[k]
      if (!d || v === undefined) return
      d.value = v
      d.kind = classifyDie(v, pool.need, pool.lethal ?? undefined)
      d.rerolled = true
    })
    return withPool(s, side, { ...pool, dice })
  })
}

function poolOfOperative(s: TrayState, operativeId: string): 'attack' | 'defence' | null {
  if (s.atk?.operativeId === operativeId) return 'attack'
  if (s.def?.operativeId === operativeId) return 'defence'
  return null
}

function firstUnspent(pool: TrayPool, kind: DieKind): number {
  return pool.dice.findIndex((d) => d.kind === kind && d.spent === null && d.value !== null)
}

/** A strike lands (fight): the first unresolved success of that class in the striker's pool. */
export function trayStrike(operativeId: string, die: 'normal' | 'crit'): void {
  useTray.setState((s) => {
    const side = poolOfOperative(s, operativeId)
    const pool = side ? poolFor(s, side) : null
    if (!side || !pool) return s
    const i = firstUnspent(pool, die)
    if (i < 0) return s
    const dice = pool.dice.map((d, k) => (k === i ? { ...d, spent: 'struck' as Spent } : d))
    return withPool(s, side, { ...pool, dice })
  })
}

/** A block in a fight: the blocker's die and the die it cancels share a pair. */
export function trayFightBlock(operativeId: string, die: 'normal' | 'crit', against: 'normal' | 'crit' | null): void {
  useTray.setState((s) => {
    const mine = poolOfOperative(s, operativeId)
    if (!mine || !against) return s
    const theirs = mine === 'attack' ? 'defence' : 'attack'
    const a = poolFor(s, mine)
    const b = poolFor(s, theirs)
    if (!a || !b) return s
    const i = firstUnspent(a, die)
    const j = firstUnspent(b, against)
    if (i < 0 || j < 0) return s
    const pair = pairCounter++
    const next = withPool(s, mine, { ...a, dice: a.dice.map((d, k) => (k === i ? { ...d, spent: 'blocking' as Spent, pair } : d)) })
    return withPool(next, theirs, { ...b, dice: b.dice.map((d, k) => (k === j ? { ...d, spent: 'blocked' as Spent, pair } : d)) })
  })
}

/** Shoot: the defender's successes cancel attack dice, shown as pairs. */
export function trayShootBlock(blockedNormal: number, blockedCrit: number): void {
  useTray.setState((s) => {
    if (!s.atk || !s.def) return s
    const atk = s.atk.dice.map((d) => ({ ...d }))
    const def = s.def.dice.map((d) => ({ ...d }))
    const want: DieKind[] = [...Array<DieKind>(blockedCrit).fill('crit'), ...Array<DieKind>(blockedNormal).fill('normal')]
    for (const k of want) {
      const i = atk.findIndex((d) => d.kind === k && d.spent === null)
      // a normal success blocks normal dice; a critical success can block either (prefer the crit pool first)
      let j = def.findIndex((d) => d.kind === (k === 'crit' ? 'crit' : 'normal') && d.spent === null && d.value !== null)
      if (j < 0) j = def.findIndex((d) => d.kind !== 'fail' && d.spent === null && d.value !== null)
      if (i < 0 || j < 0) continue
      const pair = pairCounter++
      atk[i]!.spent = 'blocked'
      atk[i]!.pair = pair
      def[j]!.spent = 'blocking'
      def[j]!.pair = pair
    }
    return { ...s, atk: { ...s.atk, dice: atk }, def: { ...s.def, dice: def }, rev: bump(s) }
  })
}

/** Damage landing from a shoot: the unblocked attack dice are marked struck. */
export function trayShootStrikes(): void {
  useTray.setState((s) => {
    if (!s.atk) return s
    const dice = s.atk.dice.map((d) => (d.kind !== 'fail' && d.spent === null && d.value !== null ? { ...d, spent: 'struck' as Spent } : d))
    return { ...s, atk: { ...s.atk, dice }, rev: bump(s) }
  })
}

export function trayNote(note: string): void {
  useTray.setState((s) => ({ ...s, note, rev: bump(s) }))
}

/** "1 critical, 2 hits, 1 miss" for a pool. */
export function poolSummary(pool: TrayPool): string {
  const crit = pool.dice.filter((d) => d.kind === 'crit').length
  const hit = pool.dice.filter((d) => d.kind === 'normal').length
  const miss = pool.dice.filter((d) => d.kind === 'fail').length
  const word = pool.word
  const parts: string[] = []
  if (crit) parts.push(`${crit} critical`)
  if (hit) parts.push(`${hit} ${word}${hit === 1 ? '' : 's'}`)
  if (miss) parts.push(`${miss} miss${miss === 1 ? '' : 'es'}`)
  return `${pool.dice.length} di${pool.dice.length === 1 ? 'e' : 'ce'}: ${parts.join(', ') || 'none'}`
}
