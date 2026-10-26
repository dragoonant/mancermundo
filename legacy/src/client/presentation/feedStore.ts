// Event feed + dice log + toasts. Only the director writes feed / dice entries (so nothing shows early);
// toasts are written by the store and UI directly (they report rejections, which have no engine events).
import { create } from 'zustand'
import type { Seat } from '@/engine'

export interface FeedEntry {
  id: number
  seq: number
  seat: Seat | null
  text: string
  /** a dice line (roll, re-roll, block): consecutive ones are shown as one group */
  dice?: boolean
}
export interface DiceEntry {
  id: number
  seq: number
  seat: Seat | null
  purpose: string
  dice: (number | null)[]
  kinds?: string[]
}
export interface Toast {
  id: number
  text: string
  kind: 'info' | 'warn' | 'error'
}

interface FeedState {
  feed: FeedEntry[]
  dice: DiceEntry[]
  toasts: Toast[]
}

let nextId = 1
export const useFeedStore = create<FeedState>(() => ({ feed: [], dice: [], toasts: [] }))

/** Consecutive dice lines become one group; every other entry stands alone. */
export function groupFeed(feed: FeedEntry[]): FeedEntry[][] {
  const out: FeedEntry[][] = []
  for (const f of feed) {
    const last = out[out.length - 1]
    if (f.dice && last && last[0]!.dice) last.push(f)
    else out.push([f])
  }
  return out
}

export function pushFeed(seq: number, seat: Seat | null, text: string, dice = false): void {
  useFeedStore.setState((s) => ({ feed: [...s.feed, { id: nextId++, seq, seat, text, ...(dice ? { dice: true } : {}) }].slice(-300) }))
}

export function pushDice(seq: number, seat: Seat | null, purpose: string, dice: (number | null)[], kinds?: string[]): void {
  useFeedStore.setState((s) => ({ dice: [...s.dice, { id: nextId++, seq, seat, purpose, dice, ...(kinds ? { kinds } : {}) }].slice(-120) }))
}

export function pushToast(text: string, kind: Toast['kind'] = 'info', ttlMs = 4200): void {
  const id = nextId++
  useFeedStore.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }))
  if (typeof setTimeout !== 'undefined') {
    setTimeout(() => useFeedStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttlMs)
  }
}

/** Drop the toasts of one kind (default: rejection errors and warnings) so a new one replaces them instead of stacking. */
export function clearToasts(kinds: Toast['kind'][] = ['error', 'warn']): void {
  useFeedStore.setState((s) => ({ toasts: s.toasts.filter((t) => !kinds.includes(t.kind)) }))
}

export function clearFeed(): void {
  useFeedStore.setState({ feed: [], dice: [], toasts: [] })
}
