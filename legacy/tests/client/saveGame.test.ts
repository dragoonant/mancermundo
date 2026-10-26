// Save game: autosave after every accepted action, exact restore (same hash, no replayed presentation), bad or old
// saves discarded with a notice, cleared when the game ends, replace confirmation, storage failures swallowed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { legalActions, step, type Action } from '@/engine'
import { RandomBot } from '@/client/bot/randomBot'
import { dataBundle } from '@/client/game/adapter'
import { defaultBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { usePresentedStore } from '@/client/presentation/presentedStore'
import { useGame } from '@/client/store/game'
import { SAVE_KEY, progressText, readSave, relativeTime, type SaveEnvelope } from '@/client/store/saveGame'
import { useSession } from '@/client/store/session'

function fakeStorage(failWrites = false) {
  const m = new Map<string, string>()
  return {
    map: m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (failWrites) throw new DOMException('quota', 'QuotaExceededError')
      m.set(k, v)
    },
    removeItem: (k: string) => void m.delete(k),
  }
}

function newHotSeat(seed = 'save-1') {
  const b = dataBundle()
  useGame.getState().newGame({
    builds: { A: defaultBuild(b, resolveTeam(b, 'aod')), B: defaultBuild(b, resolveTeam(b, 'kom')) },
    seats: { A: 'human', B: 'human' },
    seed,
    missionId: resolveMission(b, 'secure').id,
    layoutId: resolveLayout(b, '01').id,
    botTier: 'random',
  })
}

/** Answer the pending decision n times (both seats are human, so nothing else moves the game). */
function advance(n: number): void {
  const bots = { A: new RandomBot('adv:A'), B: new RandomBot('adv:B') }
  for (let i = 0; i < n; i++) {
    const { state, pending, dispatch } = useGame.getState()
    if (!state || !pending || state.phase === 'ended') return
    const candidates: Action[] = []
    try {
      candidates.push(bots[pending.seat].decide(state, pending))
    } catch {
      /* use the enumerated answers */
    }
    candidates.push(...(legalActions(state, pending) ?? []))
    const ok = candidates.find((a) => !step(state, a).rejection)
    if (!ok) throw new Error('no accepted answer')
    dispatch(ok)
  }
}

let store: ReturnType<typeof fakeStorage>

beforeEach(() => {
  store = fakeStorage()
  vi.stubGlobal('localStorage', store)
  useGame.getState().reset()
  useSession.setState({ screen: 'start', savedGame: null, saveNotice: null, confirmReplace: false })
})
afterEach(() => {
  useGame.getState().reset()
  vi.unstubAllGlobals()
})

describe('save game', () => {
  it('the envelope round-trips through JSON and carries the client bits next to the engine file', () => {
    newHotSeat()
    advance(25)
    const raw = store.map.get(SAVE_KEY)!
    expect(raw).toBeTruthy()
    const env = JSON.parse(raw) as SaveEnvelope
    expect(env.kind).toBe('mancermundo-save')
    expect(env.v).toBe(1)
    expect(env.meta.seats).toEqual({ A: 'human', B: 'human' })
    expect(env.meta.teams).toEqual({ A: 'angels-of-death', B: 'kommandos' })
    expect(env.file.actions.length).toBe(useGame.getState().state!.log.length)
    expect(env.file.finalHash).toBe(useGame.getState().state!.hash)
    const r = readSave()
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(JSON.parse(JSON.stringify(r.env))).toEqual(env)
  })

  it('restore gives the same state hash and opens on the current board without replaying anything', () => {
    newHotSeat('save-2')
    advance(30)
    const before = useGame.getState().state!
    useGame.getState().reset()
    expect(useGame.getState().state).toBeNull()
    useSession.getState().refreshSave()
    expect(useSession.getState().savedGame).not.toBeNull()
    expect(useSession.getState().continueSaved()).toBe(true)
    const g = useGame.getState()
    expect(g.state!.hash).toBe(before.hash)
    expect(g.state!.seq).toBe(before.seq)
    expect(g.pending!.id).toBe(useGame.getState().pending!.id)
    expect(g.events).toEqual([]) // nothing replayed into the feed
    const p = usePresentedStore.getState()
    expect(p.presentedSeq).toBe(before.seq) // the board is already at the head
    expect(p.latestSeq).toBe(before.seq)
    expect(useSession.getState().screen).toBe('battle')
    expect(g.meta!.seed).toBe('save-2')
    // and the game carries on from there
    advance(3)
    expect(useGame.getState().state!.seq).toBeGreaterThan(before.seq)
  })

  it('a save from another engine version that replays to the same hash still loads', () => {
    newHotSeat('save-3')
    advance(12)
    const env = JSON.parse(store.map.get(SAVE_KEY)!) as SaveEnvelope
    env.file.engineVersion = 'ancient'
    store.map.set(SAVE_KEY, JSON.stringify(env))
    useGame.getState().reset()
    useSession.getState().refreshSave()
    expect(useSession.getState().continueSaved()).toBe(true)
    expect(useGame.getState().state!.hash).toBe(env.file.finalHash)
  })

  it('an unparsable, old-version, tampered or data-less save is discarded with the notice and the Start screen stays usable', () => {
    newHotSeat('save-4')
    advance(12)
    const good = JSON.parse(store.map.get(SAVE_KEY)!) as SaveEnvelope
    useGame.getState().reset()
    const session = useSession.getState

    // unparsable at startup
    store.map.set(SAVE_KEY, '{not json')
    session().refreshSave()
    expect(session().savedGame).toBeNull()
    expect(session().saveNotice).toMatch(/could not be read/)
    expect(store.map.has(SAVE_KEY)).toBe(false)

    // a different envelope version
    session().dismissSaveNotice()
    store.map.set(SAVE_KEY, JSON.stringify({ ...good, v: 2 }))
    session().refreshSave()
    expect(session().saveNotice).toMatch(/older version/)
    expect(store.map.has(SAVE_KEY)).toBe(false)

    // a team that no longer exists
    session().dismissSaveNotice()
    store.map.set(SAVE_KEY, JSON.stringify({ ...good, meta: { ...good.meta, teams: { A: 'gone', B: 'kom' } } }))
    session().refreshSave()
    expect(session().saveNotice).toMatch(/older version/)
    expect(store.map.has(SAVE_KEY)).toBe(false)

    // replay hash differs: the Continue card shows, clicking it discards
    session().dismissSaveNotice()
    store.map.set(SAVE_KEY, JSON.stringify({ ...good, file: { ...good.file, finalHash: 'deadbeef' } }))
    session().refreshSave()
    expect(session().savedGame).not.toBeNull()
    expect(session().continueSaved()).toBe(false)
    expect(session().savedGame).toBeNull()
    expect(session().saveNotice).toMatch(/older version/)
    expect(session().screen).toBe('start')
    expect(useGame.getState().state).toBeNull()
    expect(store.map.has(SAVE_KEY)).toBe(false)

    // a replay the engine rejects
    session().dismissSaveNotice()
    const bad = { ...good, file: { ...good.file, actions: good.file.actions.map((a, i) => (i === 3 ? { ...a, decisionId: 'nope' } : a)) } }
    store.map.set(SAVE_KEY, JSON.stringify(bad))
    session().refreshSave()
    expect(session().continueSaved()).toBe(false)
    expect(session().saveNotice).toMatch(/older version/)
    expect(session().screen).toBe('start')
  })

  it('the save is cleared when the game ends and when it is abandoned', () => {
    newHotSeat('save-5')
    advance(10)
    expect(store.map.has(SAVE_KEY)).toBe(true)
    const { pending, dispatch } = useGame.getState()
    expect(dispatch({ type: 'resign', seat: pending!.seat, decisionId: pending!.id, payload: {} })).toBeNull()
    expect(useGame.getState().state!.phase).toBe('ended')
    expect(store.map.has(SAVE_KEY)).toBe(false)

    newHotSeat('save-5b')
    advance(4)
    useSession.getState().refreshSave()
    expect(useSession.getState().savedGame).not.toBeNull()
    useSession.getState().abandonGame()
    expect(store.map.has(SAVE_KEY)).toBe(false)
    expect(useSession.getState().savedGame).toBeNull()
    expect(useSession.getState().screen).toBe('start')
  })

  it('quitting to the menu keeps the save; starting a new game over a save needs confirmation', () => {
    useSession.setState({ seats: { A: 'human', B: 'human' }, seed: 'save-6', botTier: 'random' })
    // nothing saved: starts at once
    useSession.getState().requestLaunch()
    expect(useSession.getState().screen).toBe('battle')
    expect(useSession.getState().confirmReplace).toBe(false)
    advance(6)
    useSession.getState().backToMenu()
    expect(useSession.getState().screen).toBe('start')
    expect(useSession.getState().savedGame).not.toBeNull()

    // a save exists: asks first, and cancelling changes nothing
    const kept = store.map.get(SAVE_KEY)
    useSession.setState({ screen: 'briefing', seed: 'save-6-new' })
    useSession.getState().requestLaunch()
    expect(useSession.getState().confirmReplace).toBe(true)
    expect(useSession.getState().screen).toBe('briefing')
    expect(useGame.getState().state).toBeNull()
    useSession.getState().cancelLaunch()
    expect(useSession.getState().confirmReplace).toBe(false)
    expect(store.map.get(SAVE_KEY)).toBe(kept)

    // confirming replaces it
    useSession.getState().requestLaunch()
    useSession.getState().confirmLaunch()
    expect(useSession.getState().screen).toBe('battle')
    expect(useGame.getState().meta!.seed).toBe('save-6-new')
    expect((JSON.parse(store.map.get(SAVE_KEY)!) as SaveEnvelope).meta.seed).toBe('save-6-new')
  })

  it('storage that throws on write or is missing does not break dispatch', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    newHotSeat('save-7')
    const seq0 = useGame.getState().state!.seq
    advance(8)
    expect(useGame.getState().state!.seq).toBeGreaterThan(seq0)
    vi.stubGlobal('localStorage', undefined)
    advance(2)
    expect(useSession.getState().refreshSave).not.toThrow()
  })

  it('progress and last-played wording', () => {
    expect(progressText(2, 'firefight')).toBe('Turning point 2, Firefight phase')
    expect(progressText(0, 'setup')).toBe('Setting up the battle')
    const now = 10_000_000_000
    expect(relativeTime(now - 5_000, now)).toBe('just now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('yesterday')
  })
})
