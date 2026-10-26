// Presented-state cursor and director: results never show before the director reaches them.
import { beforeEach, describe, expect, it } from 'vitest'
import type { GameEvent, GameState } from '@/engine'
import { enqueueBatch, resetDirector } from '@/client/presentation/director'
import { isPresentationIdle, waitForPresentationIdle } from '@/client/presentation/idleStore'
import { catchUpPresented, pickDisplaySnapshot, pushSnapshot, resetPresentation, usePresentedStore } from '@/client/presentation/presentedStore'
import { useFeedStore } from '@/client/presentation/feedStore'
import { useSettings } from '@/client/presentation/settings'

const fakeState = (seq: number) => ({ seq, operatives: {} }) as unknown as GameState
const ev = (seq: number, body: Record<string, unknown>) => ({ seq, turningPoint: 1, phase: 'setup', seat: 'A', ...body }) as unknown as GameEvent

describe('presented cursor', () => {
  beforeEach(() => {
    resetDirector()
    resetPresentation(0, fakeState(0))
    useFeedStore.setState({ feed: [], dice: [], toasts: [] })
  })

  it('shows the newest snapshot at or before the cursor', () => {
    const snaps = [
      { lastSeq: 0, state: fakeState(0) },
      { lastSeq: 1, state: fakeState(1) },
      { lastSeq: 2, state: fakeState(2) },
    ]
    expect(pickDisplaySnapshot(snaps, 1)!.seq).toBe(1)
    expect(pickDisplaySnapshot(snaps, 5)!.seq).toBe(2)
    expect(pickDisplaySnapshot(snaps, -1)!.seq).toBe(0)
    expect(pickDisplaySnapshot([], 3)).toBeNull()
  })

  it('a pushed step is not presented until caught up', () => {
    pushSnapshot(1, fakeState(1))
    const s = usePresentedStore.getState()
    expect(s.latestSeq).toBe(1)
    expect(s.presentedSeq).toBe(0)
    catchUpPresented()
    expect(usePresentedStore.getState().presentedSeq).toBe(1)
  })

  it('the director holds the cursor and the dice log back until a roll has played, then releases them', async () => {
    useSettings.getState().setAnimSpeed('fast')
    pushSnapshot(1, fakeState(1))
    enqueueBatch({ seq: 1, state: fakeState(1), events: [ev(1, { type: 'DiceRolled', purpose: 'setup.rollOff', dice: [5], final: true })] })
    expect(isPresentationIdle()).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    // the roll banner is still playing: neither the cursor nor the log has moved
    expect(usePresentedStore.getState().presentedSeq).toBe(0)
    await waitForPresentationIdle(3000)
    expect(usePresentedStore.getState().presentedSeq).toBe(1)
    expect(useFeedStore.getState().dice.map((d) => d.dice)).toEqual([[5]])
    expect(useFeedStore.getState().feed.some((f) => f.text.includes('5'))).toBe(true)
  })

  it('instant speed plays a whole batch without waiting', async () => {
    useSettings.getState().setAnimSpeed('instant')
    pushSnapshot(2, fakeState(2))
    enqueueBatch({
      seq: 2,
      state: fakeState(2),
      events: [ev(2, { type: 'DiceRolled', purpose: 'x', dice: [1, 2], final: true }), ev(2, { type: 'GambitPassed' })],
    })
    await waitForPresentationIdle(500)
    expect(usePresentedStore.getState().presentedSeq).toBe(2)
    expect(useFeedStore.getState().feed.length).toBeGreaterThanOrEqual(2)
  })

  it('batches play in order', async () => {
    useSettings.getState().setAnimSpeed('instant')
    pushSnapshot(1, fakeState(1))
    pushSnapshot(2, fakeState(2))
    enqueueBatch({ seq: 1, state: fakeState(1), events: [ev(1, { type: 'GambitPassed' })] })
    enqueueBatch({ seq: 2, state: fakeState(2), events: [ev(2, { type: 'CounteractSkipped' })] })
    await waitForPresentationIdle(500)
    const seqs = useFeedStore.getState().feed.map((f) => f.seq)
    expect(seqs).toEqual([1, 2])
  })
})
