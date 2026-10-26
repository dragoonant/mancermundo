// Narration pauses: the phase / turning-point banner and the dice-roll banner. A hold is deliberate dead
// time (the idle wait extends past its own cap for it). Any click or key ends the hold early.
import { create } from 'zustand'
import type { Seat } from '@/engine'

export interface Announcement {
  id: number
  title: string
  subtitle: string
  seat: Seat | null
  /** dice shown as pips under the title (roll banner) */
  dice?: (number | null)[]
  kinds?: string[]
  startedAt: number
  durationMs: number
}

export const useAnnouncementStore = create<{ current: Announcement | null }>(() => ({ current: null }))

let activeResolve: (() => void) | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null
let detachSkip: (() => void) | null = null
let nextId = 1

function attachSkip(): () => void {
  if (typeof window === 'undefined') return () => {}
  const skip = () => finish()
  window.addEventListener('pointerdown', skip, { capture: true })
  window.addEventListener('keydown', skip, { capture: true })
  return () => {
    window.removeEventListener('pointerdown', skip, { capture: true })
    window.removeEventListener('keydown', skip, { capture: true })
  }
}

function finish(): void {
  if (activeTimer !== null) {
    clearTimeout(activeTimer)
    activeTimer = null
  }
  if (detachSkip) {
    detachSkip()
    detachSkip = null
  }
  if (useAnnouncementStore.getState().current !== null) useAnnouncementStore.setState({ current: null })
  const r = activeResolve
  activeResolve = null
  if (r) r()
}

/** Show a banner and resolve when its pause is over. A zero duration is a no-op (no banner, no wait). */
export function holdAnnouncement(spec: Omit<Announcement, 'id' | 'startedAt'>): Promise<void> {
  finish()
  if (spec.durationMs <= 0) return Promise.resolve()
  useAnnouncementStore.setState({ current: { ...spec, id: nextId++, startedAt: Date.now() } })
  return new Promise<void>((resolve) => {
    activeResolve = resolve
    activeTimer = setTimeout(finish, spec.durationMs)
    detachSkip = attachSkip()
  })
}

export function clearAnnouncement(): void {
  finish()
}

export function announcementHoldRemainingMs(): number {
  const c = useAnnouncementStore.getState().current
  return c ? Math.max(0, c.startedAt + c.durationMs - Date.now()) : 0
}

export function isAnnouncementHolding(): boolean {
  return useAnnouncementStore.getState().current !== null
}
