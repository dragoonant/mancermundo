// "Presented up to seq N" cursor. The engine resolves a step instantly; the director plays the beats
// afterwards. Anything that would give a result away early (HUD numbers, operative positions, decision
// prompts, the feed) is gated on this cursor instead of the live state.
import { create } from 'zustand'
import type { GameState } from '@/engine'

export interface StateSnapshot {
  lastSeq: number
  state: GameState
}

interface PresentedState {
  presentedSeq: number
  latestSeq: number
  snapshots: StateSnapshot[]
}

export const SNAPSHOT_LIMIT = 64
/** If nothing advances presentedSeq for this long it is caught up, so the UI can never stay behind a stalled director. */
export const PRESENTED_STALL_MS = 6000

export const usePresentedStore = create<PresentedState>(() => ({ presentedSeq: -1, latestSeq: -1, snapshots: [] }))

let stallTimer: ReturnType<typeof setTimeout> | null = null

function disarm(): void {
  if (stallTimer !== null) {
    clearTimeout(stallTimer)
    stallTimer = null
  }
}

function arm(): void {
  disarm()
  const { presentedSeq, latestSeq } = usePresentedStore.getState()
  if (presentedSeq >= latestSeq) return
  stallTimer = setTimeout(() => {
    stallTimer = null
    catchUpPresented()
  }, PRESENTED_STALL_MS)
}

export function pickDisplaySnapshot(snapshots: readonly StateSnapshot[], presentedSeq: number): GameState | null {
  if (snapshots.length === 0) return null
  for (let i = snapshots.length - 1; i >= 0; i--) if (snapshots[i]!.lastSeq <= presentedSeq) return snapshots[i]!.state
  return snapshots[0]!.state
}

export function pushSnapshot(lastSeq: number, state: GameState): void {
  usePresentedStore.setState((s) => ({
    latestSeq: Math.max(s.latestSeq, lastSeq),
    snapshots: [...s.snapshots, { lastSeq, state }].slice(-SNAPSHOT_LIMIT),
  }))
  arm()
}

export function resetPresentation(seq: number, state: GameState | null): void {
  usePresentedStore.setState({ presentedSeq: seq, latestSeq: seq, snapshots: state ? [{ lastSeq: seq, state }] : [] })
  disarm()
}

export function setPresentedSeq(seq: number): void {
  const s = usePresentedStore.getState()
  const next = Math.min(Math.max(s.presentedSeq, seq), s.latestSeq)
  if (next !== s.presentedSeq) usePresentedStore.setState({ presentedSeq: next })
  arm()
}

export function catchUpPresented(): void {
  const { latestSeq, presentedSeq } = usePresentedStore.getState()
  if (presentedSeq !== latestSeq) usePresentedStore.setState({ presentedSeq: latestSeq })
  disarm()
}

export function isSettled(): boolean {
  const s = usePresentedStore.getState()
  return s.presentedSeq >= s.latestSeq
}

/** The engine state as the player should currently see it. Null before any game exists. */
export function useDisplayState(): GameState | null {
  return usePresentedStore((s) => pickDisplaySnapshot(s.snapshots, s.presentedSeq))
}

/** True once the presentation has caught up with the live engine head (prompts may be shown). */
export function useSettled(): boolean {
  return usePresentedStore((s) => s.presentedSeq >= s.latestSeq)
}
