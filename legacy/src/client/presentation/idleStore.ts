// Presentation idle signal. director.ts is the sole writer (false the instant a batch is queued, true when
// the queue drains); the store's bot loop reads it so a bot never acts over animations still playing.
import { create } from 'zustand'
import { announcementHoldRemainingMs } from './announceStore'

const useIdleStore = create<{ idle: boolean }>(() => ({ idle: true }))

export function setPresentationIdle(idle: boolean): void {
  if (useIdleStore.getState().idle !== idle) useIdleStore.setState({ idle })
}

export function isPresentationIdle(): boolean {
  return useIdleStore.getState().idle
}

const MAX_HOLD_EXTENSION_MS = 15000

/** Resolves as soon as the queue is idle, or after `timeoutMs` (extended while a narration hold is on screen). */
export function waitForPresentationIdle(timeoutMs: number): Promise<void> {
  if (isPresentationIdle()) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    let extended = 0
    let timer: ReturnType<typeof setTimeout>
    let unsubscribe: () => void = () => {}
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    const onTimeout = () => {
      const remaining = announcementHoldRemainingMs()
      if (remaining > 0 && extended < MAX_HOLD_EXTENSION_MS) {
        const extra = Math.min(remaining + 50, MAX_HOLD_EXTENSION_MS - extended)
        extended += extra
        timer = setTimeout(onTimeout, extra)
        return
      }
      finish()
    }
    unsubscribe = useIdleStore.subscribe((s) => {
      if (s.idle) finish()
    })
    timer = setTimeout(onTimeout, timeoutMs)
  })
}
